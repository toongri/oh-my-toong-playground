import type { CodexRulesHookOptions } from "./codex-hook-options.js";
import { configFromEnvironment } from "./config.js";
import { hasContextPressureMarker, transcriptHasContextPressureMarker } from "./context-pressure.js";
import { createHookDebugTimer } from "./debug-log.js";
import { withDynamicBudget } from "./event-budget.js";
import { formatAdditionalContextOutput } from "./hook-output.js";
import { displayPath, uniqueStrings } from "./path-utils.js";
import {
	claimPostCompactPending,
	clearSessionState,
	hasPostCompactPending,
	hydrateEngineState,
	isPostCompactRecoveryInProgress,
	markSessionCompacted,
	persistEngineState,
	sessionCachePath,
} from "./persistent-cache.js";
import { withPostCompactBudget } from "./post-compact-budget.js";
import { claimedPostCompactKind, shouldSkipPostCompactClaim } from "./post-compact-claim.js";
import { createRulesEngine } from "./rules-engine-factory.js";
import { runStaticInjection } from "./static-injection.js";
import { extractCodexToolPaths } from "./tool-paths.js";
import { filterRulesAlreadyInTranscript } from "./transcript-rule-filter.js";

export type { CodexRulesHookOptions } from "./codex-hook-options.js";

export type CodexSessionStartInput = {
	session_id: string;
	transcript_path: string | null;
	cwd: string;
	hook_event_name: "SessionStart";
	model: string;
	permission_mode: string;
	source: "startup" | "resume" | "clear" | "compact";
};

export type CodexUserPromptSubmitInput = {
	session_id: string;
	turn_id: string;
	transcript_path: string | null;
	cwd: string;
	hook_event_name: "UserPromptSubmit";
	model: string;
	permission_mode: string;
	prompt: string;
};

export type CodexPostToolUseInput = {
	session_id: string;
	turn_id: string;
	transcript_path: string | null;
	cwd: string;
	hook_event_name: "PostToolUse";
	model: string;
	permission_mode: string;
	tool_name: string;
	tool_input: unknown;
	tool_response: unknown;
	tool_use_id: string;
};

export type CodexPostCompactInput = {
	session_id: string;
	turn_id: string;
	transcript_path: string | null;
	cwd: string;
	hook_event_name: "PostCompact";
	model: string;
	trigger: "manual" | "auto";
};

export async function runSessionStartHook(
	input: CodexSessionStartInput,
	options: CodexRulesHookOptions = {},
): Promise<string> {
	const cachePath = sessionCachePath(input.session_id, options.pluginDataRoot);
	if (input.source === "clear") {
		clearSessionState(cachePath);
	} else if (input.source !== "resume" && input.source !== "compact" && !hasPostCompactPending(cachePath)) {
		clearSessionState(cachePath);
	}
	const postCompactClaim = input.source === "clear" ? "not-pending" : claimPostCompactPending(cachePath, "static");
	const completedPostCompactKind =
		claimedPostCompactKind(postCompactClaim, "static") ??
		(input.source === "compact" && postCompactClaim === "not-pending" ? "static" : undefined);
	if (
		shouldSkipPostCompactClaim(
			postCompactClaim,
			input.source === "compact" && isPostCompactRecoveryInProgress(cachePath, "static"),
		)
	) {
		return "";
	}
	const transcriptPath = input.source === "clear" ? null : input.transcript_path;
	return runStaticInjection(
		input.cwd,
		transcriptPath,
		"SessionStart",
		cachePath,
		options,
		completedPostCompactKind,
		{ latestCompactedReplacementOnly: completedPostCompactKind !== undefined },
		input.model,
	);
}

export async function runPostCompactHook(
	input: CodexPostCompactInput,
	options: CodexRulesHookOptions = {},
): Promise<string> {
	markSessionCompacted(sessionCachePath(input.session_id, options.pluginDataRoot));
	return "";
}

export async function runUserPromptSubmitHook(
	input: CodexUserPromptSubmitInput,
	options: CodexRulesHookOptions = {},
): Promise<string> {
	if (hasContextPressureMarker(input.prompt)) {
		return "";
	}
	const cachePath = sessionCachePath(input.session_id, options.pluginDataRoot);
	const postCompactClaim = claimPostCompactPending(cachePath, "static");
	if (postCompactClaim === "not-pending" && transcriptHasContextPressureMarker(input.transcript_path)) {
		return "";
	}
	const completedPostCompactKind = claimedPostCompactKind(postCompactClaim, "static");
	if (shouldSkipPostCompactClaim(postCompactClaim, isPostCompactRecoveryInProgress(cachePath, "static"))) {
		return "";
	}
	return runStaticInjection(
		input.cwd,
		input.transcript_path,
		"UserPromptSubmit",
		cachePath,
		options,
		completedPostCompactKind,
		{ latestCompactedReplacementOnly: completedPostCompactKind !== undefined },
		input.model,
	);
}

export async function runPostToolUseHook(
	input: CodexPostToolUseInput,
	options: CodexRulesHookOptions = {},
): Promise<string> {
	const debugTimer = createHookDebugTimer("PostToolUse");
	const config = configFromEnvironment(options.env);
	debugTimer.lap("config", { disabled: config.disabled, mode: config.mode });
	if (config.disabled || config.mode === "off" || config.mode === "static") {
		debugTimer.done({ outputBytes: 0, reason: "disabled" });
		return "";
	}

	const targetPaths = extractCodexToolPaths(unwrapShellCommandInput(input), input.cwd);
	debugTimer.lap("extract", {
		targets: targetPaths.length,
		uniqueTargets: uniqueStrings(targetPaths).length,
		tool: input.tool_name,
	});
	const firstTargetPath = targetPaths[0];
	if (firstTargetPath === undefined) {
		debugTimer.done({ outputBytes: 0, reason: "no-target" });
		return "";
	}

	const cachePath = sessionCachePath(input.session_id, options.pluginDataRoot);
	const postCompactClaim = claimPostCompactPending(cachePath, "dynamic");
	if (postCompactClaim === "not-pending" && transcriptHasContextPressureMarker(input.transcript_path)) {
		debugTimer.done({ outputBytes: 0, reason: "context-pressure-transcript" });
		return "";
	}
	const completedPostCompactKind = claimedPostCompactKind(postCompactClaim, "dynamic");
	if (shouldSkipPostCompactClaim(postCompactClaim, isPostCompactRecoveryInProgress(cachePath, "dynamic"))) {
		debugTimer.done({ outputBytes: 0, reason: "post-compact-recovery-in-progress" });
		return "";
	}
	const dynamicConfig = withDynamicBudget(config);
	const engine = createRulesEngine(
		options,
		completedPostCompactKind !== undefined
			? withPostCompactBudget(dynamicConfig, { model: input.model, transcriptPath: input.transcript_path })
			: dynamicConfig,
	);
	hydrateEngineState(engine, cachePath);
	debugTimer.lap("hydrate", {
		dynamicDedupScopes: engine.state.dynamicDedup.size,
		staticDedup: engine.state.staticDedup.size,
	});
	const loaded = engine.loadDynamicRules(input.cwd, uniqueStrings(targetPaths));
	debugTimer.lap("load", { diagnostics: loaded.diagnostics.length, loadedRules: loaded.rules.length });
	const rules = filterRulesAlreadyInTranscript(
		loaded.rules.filter((rule) => !engine.isStaticInjected(rule) && !engine.isDynamicInjected(rule)),
		input.transcript_path,
		(rule) => {
			engine.markDynamicInjected(rule);
		},
		{ latestCompactedReplacementOnly: completedPostCompactKind !== undefined },
	);
	debugTimer.lap("filter", { rules: rules.length });
	if (rules.length === 0) {
		persistEngineState(engine, cachePath, completedPostCompactKind);
		debugTimer.lap("persist", { reason: "no-rules" });
		debugTimer.done({ outputBytes: 0, reason: "no-rules" });
		return "";
	}

	const block = engine.formatDynamic(rules, displayPath(input.cwd, firstTargetPath));
	debugTimer.lap("format", { blockChars: block.length, rules: rules.length });
	for (const rule of rules) {
		engine.markDynamicInjected(rule);
	}
	persistEngineState(engine, cachePath, completedPostCompactKind);
	debugTimer.lap("persist", { reason: "emit" });
	const output = formatAdditionalContextOutput("PostToolUse", block);
	debugTimer.done({ outputBytes: Buffer.byteLength(output), reason: "emit" });
	return output;
}

/** Tool names whose payload carries a raw shell command that may be wrapper-wrapped. */
const SHELL_COMMAND_TOOL_NAMES = new Set(["bash", "shell_command", "exec_command"]);

/**
 * D-1 Option C: peel a `sh|bash|zsh -c "<inner>"` shell wrapper off the command
 * field BEFORE the pristine tool-paths extractor sees it, so the inner command's
 * paths are extracted rather than `/bin/zsh` / `-lc`. Returns a shallow-cloned
 * input with the unwrapped command; tool-paths.ts stays untouched and tokenizes
 * the inner command exactly once.
 */
function unwrapShellCommandInput(input: CodexPostToolUseInput): CodexPostToolUseInput {
	if (!SHELL_COMMAND_TOOL_NAMES.has(input.tool_name.toLowerCase())) return input;
	if (typeof input.tool_input !== "object" || input.tool_input === null || Array.isArray(input.tool_input)) return input;
	const ti = input.tool_input as Record<string, unknown>;
	const key = typeof ti["command"] === "string" ? "command" : typeof ti["cmd"] === "string" ? "cmd" : undefined;
	if (key === undefined) return input;
	const inner = unwrapShellWrapper(ti[key] as string);
	if (inner === ti[key]) return input;
	return { ...input, tool_input: { ...ti, [key]: inner } };
}

/**
 * If the command begins with a shell wrapper invocation
 * (e.g. `/bin/zsh -lc "<inner>"`, `bash -c '<inner>'`), return the INNER
 * quoted command. Otherwise return the command unchanged.
 */
function unwrapShellWrapper(command: string): string {
	const tokens = tokenize(command.trim());
	if (tokens.length < 3) return command;

	const shellName = basename(tokens[0]);
	const shellRe = /^(sh|bash|zsh|dash|ksh|ash|fish)$/;
	if (!shellRe.test(shellName)) return command;

	// The flag carrying the inline command always ends in 'c' (-c, -lc, -ic).
	const flag = tokens[1];
	if (!flag.startsWith("-") || !flag.endsWith("c")) return command;

	// tokenize() already stripped the surrounding quotes from the inner command,
	// so the third token is the inner command verbatim.
	return tokens[2];
}

/**
 * Quote-aware tokenizer. Splits on unquoted whitespace, treats
 * `'…'` / `"…"` as single tokens (quotes stripped, spaces preserved), and
 * surfaces operator runs (&& || | ; newline) as standalone tokens.
 */
function tokenize(input: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let hasCurrent = false;
	let quote: "'" | '"' | null = null;

	const flush = (): void => {
		if (hasCurrent) {
			tokens.push(current);
			current = "";
			hasCurrent = false;
		}
	};

	for (let i = 0; i < input.length; i++) {
		const ch = input[i];

		if (quote) {
			if (ch === quote) {
				quote = null;
			} else {
				current += ch;
				hasCurrent = true;
			}
			continue;
		}

		if (ch === "'" || ch === '"') {
			quote = ch;
			hasCurrent = true; // an empty "" still produces a (empty) token
			continue;
		}

		// Operators: &&, ||, |, ;, and newline.
		if (ch === "&" && input[i + 1] === "&") {
			flush();
			tokens.push("&&");
			i++;
			continue;
		}
		if (ch === "|" && input[i + 1] === "|") {
			flush();
			tokens.push("||");
			i++;
			continue;
		}
		if (ch === "|") {
			flush();
			tokens.push("|");
			continue;
		}
		if (ch === ";") {
			flush();
			tokens.push(";");
			continue;
		}
		if (ch === "\n") {
			flush();
			tokens.push(";");
			continue;
		}

		if (ch === " " || ch === "\t" || ch === "\r") {
			flush();
			continue;
		}

		current += ch;
		hasCurrent = true;
	}

	flush();
	return tokens;
}

/** POSIX-style basename for shell-wrapper detection. */
function basename(path: string): string {
	const slash = path.lastIndexOf("/");
	return slash === -1 ? path : path.slice(slash + 1);
}

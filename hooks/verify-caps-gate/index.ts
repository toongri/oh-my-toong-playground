import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * verify-caps-gate — a reusable PreToolUse (Bash matcher) hook engine.
 *
 * Two independent guards over a Bash command, driven by declarative per-runner
 * policy (verify-caps.yaml base + verify-caps.local.yaml gitignored override,
 * merged one level deep — mirrors hooks/rules-injector/local-config.ts):
 *   (a) deny an unfiltered root `<runner> [run] (test|lint)` invocation — the
 *       whole monorepo's test/lint at once blows up RAM.
 *   (b) inject a memory/concurrency cap into an already-eligible command that
 *       omits one: `env` caps are prepended (vitest/turbo/pnpm — safe even on
 *       a compound command, since a leading `VAR=val` only ever binds to the
 *       first sub-command), `flag` caps are appended (jest/turbo — restricted
 *       to a single simple command with no end-of-options `--` marker, since
 *       tail-appending onto a compound command or after `--` can land the
 *       flag on the wrong program or as a literal positional argument; a
 *       runner marked `flag_requires_scope` additionally requires one of its
 *       own `deny.scope_flags` to already be present — e.g. turbo's
 *       --concurrency=1 must not land on an unfiltered `turbo run local`,
 *       which can target a persistent task and hard-error).
 * Fail-open: this is a performance gate, not a security gate. Any parse
 * hiccup (malformed JSON, missing/malformed config) degrades to passthrough
 * (no hook output, exit 0) rather than blocking the command.
 */

export type RunnerDenyConfig = {
	scripts: string[];
	scope_flags: string[];
};

export type RunnerRule = {
	env?: Record<string, string>;
	flag?: string;
	flag_requires_scope?: boolean;
	// Verification-script prefix allowlist for a general-purpose runner
	// (pnpm/turbo). When present, cap injection only fires if the command
	// invokes one of these scripts — see applyInjections. Absent (vitest/jest,
	// dedicated test runners) means inject unconditionally.
	inject_scripts?: string[];
	deny?: RunnerDenyConfig;
};

export type VerifyCapsConfig = {
	runners: Record<string, RunnerRule>;
};

export type DecideResult =
	| { action: "deny"; reason: string }
	| { action: "allow"; command: string }
	| { action: "passthrough" };

// -----------------------------------------------------------------------------
// Pure decide core — no file I/O, no process access. Takes a command string
// and an already-merged config; returns one of the three closed action kinds.
// -----------------------------------------------------------------------------
export function decide(command: string, config: VerifyCapsConfig): DecideResult {
	const denyReason = findDenyReason(command, config);
	if (denyReason !== null) {
		return { action: "deny", reason: denyReason };
	}

	const injected = applyInjections(command, config);
	if (injected !== null) {
		return { action: "allow", command: injected };
	}

	return { action: "passthrough" };
}

// -----------------------------------------------------------------------------
// Rule (a) — unfiltered root deny.
// Split into shell segments on &&/||/|/;/newline, normalize each (strip
// leading whitespace + repeated leading `VAR=val ` env-assignment prefixes),
// and check its first token against a runner that declares `deny`. The script
// name must match exactly (terminated by whitespace or end-of-string, so
// "test:changed" doesn't match "test") and none of the runner's scope_flags
// may appear in that same segment — checked per-segment, not over the whole
// command, so a scope flag on one `&&`-joined sub-command can't rescue an
// unfiltered sibling (e.g. `pnpm test && pnpm --filter=web build` still
// denies the unfiltered `pnpm test`).
// -----------------------------------------------------------------------------
function findDenyReason(command: string, config: VerifyCapsConfig): string | null {
	for (const rawSegment of splitSegments(command)) {
		const segment = stripLeadingEnvAssignments(rawSegment);
		const runnerName = firstToken(segment);
		const rule = config.runners[runnerName];
		if (rule?.deny === undefined) continue;

		if (
			matchesDenyShape(segment, runnerName, rule.deny.scripts) &&
			!hasAnyScopeFlag(stripAfterEndOfOptions(segment), rule.deny.scope_flags)
		) {
			return buildDenyReason(runnerName, rule.deny.scope_flags);
		}
	}
	return null;
}

// Quote-aware: a delimiter (&& || | & ; newline) inside a single- or
// double-quoted span (e.g. the `|` in `echo "a | turbo run test b"`) is
// literal text, not a shell separator, and must not be split on — otherwise
// a quoted string that happens to *mention* a runner command produces a
// false segment and a false deny. Bare `&` (background operator, e.g.
// `pnpm dev & pnpm test`) is a segment separator too, symmetric with
// isCompound's bare-`&` handling below — a single `&` also splits `&&`
// correctly, since the resulting empty segment between the two `&`
// characters has no first token that can match a runner name.
function splitSegments(command: string): string[] {
	const segments: string[] = [];
	let current = "";
	let quote: '"' | "'" | null = null;
	let i = 0;
	while (i < command.length) {
		const ch = command[i];
		if (quote !== null) {
			current += ch;
			if (ch === quote) quote = null;
			i++;
			continue;
		}
		if (ch === '"' || ch === "'") {
			quote = ch;
			current += ch;
			i++;
			continue;
		}
		if ((ch === "&" || ch === "|") && command[i + 1] === ch) {
			segments.push(current);
			current = "";
			i += 2;
			continue;
		}
		if (ch === "&" || ch === "|" || ch === ";" || ch === "\n") {
			segments.push(current);
			current = "";
			i++;
			continue;
		}
		current += ch;
		i++;
	}
	segments.push(current);
	return segments;
}

function matchesDenyShape(segment: string, runnerName: string, scripts: string[]): boolean {
	const scriptAlternation = scripts.map(escapeRegExp).join("|");
	// Allow pnpm's whole-workspace flags (`-r`/`--recursive`) and an optional
	// `run` — in any order — between the runner and the script. `pnpm -r test`
	// / `pnpm --recursive lint` run the script in EVERY workspace package, which
	// is exactly the unfiltered whole-monorepo invocation this deny targets;
	// without allowing the flag here they slip past by sitting a token before
	// the script. `-r`/`--recursive` are not scope flags, so hasAnyScopeFlag
	// does not rescue them — a real scope flag (--filter/-F/--affected) elsewhere
	// in the segment still does.
	const re = new RegExp(
		`^${escapeRegExp(runnerName)}(\\s+(run|-r|--recursive))*\\s+(${scriptAlternation})(\\s|$)`,
	);
	return re.test(segment);
}

function hasAnyScopeFlag(command: string, scopeFlags: string[]): boolean {
	return scopeFlags.some((flag) => new RegExp(`(^|\\s)${escapeRegExp(flag)}([\\s=]|$)`).test(command));
}

// True if any whitespace-delimited word in the command begins with one of the
// given verification-script prefixes at a word boundary: "test" matches the
// word `test` and the sub-scripted `test:changed`, "verify" matches
// `verify:quick` — but a word merely containing the prefix mid-token
// (`test-utils`, `latest`) does NOT match. Lets a general-purpose runner
// recognize a verification invocation regardless of the script's position
// (before or after flags) without enumerating every script name.
function hasAnyScriptPrefix(command: string, prefixes: string[]): boolean {
	return prefixes.some((prefix) =>
		new RegExp(`(^|\\s)${escapeRegExp(prefix)}(:\\S+)?(\\s|$)`).test(command),
	);
}

// A scope flag (--filter/-F/--affected) that appears after a segment's `--`
// end-of-options marker is not the runner's own flag — it's a positional arg
// forwarded to the task itself (e.g. `turbo run test -- --affected` passes
// `--affected` to the `test` script, not to turbo), so the runner still runs
// unfiltered. Cutting the segment at its first end-of-options marker before
// the scope-flag search keeps the deny check from being fooled into treating
// that forwarded arg as a real scope flag and fail-opening an unfiltered run.
function stripAfterEndOfOptions(segment: string): string {
	const marker = /(^|\s)--(\s|$)/.exec(segment);
	return marker === null ? segment : segment.slice(0, marker.index);
}

function buildDenyReason(runnerName: string, scopeFlags: string[]): string {
	return `무필터 \`${runnerName}\` test/lint 실행은 모노레포 전체를 실행해 리소스 폭증을 유발합니다. ${scopeFlags.join(" 또는 ")} 중 하나를 사용하세요.`;
}

// -----------------------------------------------------------------------------
// Rule (b) — cap injection, applied to the whole command (not per segment).
// env caps: unconditional (the runner just needs to be the command's first
// token); a VAR already present in the command is skipped.
// flag caps: only on a single simple command (no compound marker, no
// standalone `--`); a flag key already present is skipped.
// Returns the modified command, or null if nothing changed.
// -----------------------------------------------------------------------------
function applyInjections(command: string, config: VerifyCapsConfig): string | null {
	const runnerName = firstToken(stripLeadingEnvAssignments(command));
	const rule = config.runners[runnerName];
	if (rule === undefined) return null;

	// A general-purpose runner (pnpm/turbo) declares inject_scripts — inject
	// only when the command actually invokes one of those verification scripts.
	// Injecting env forces permissionDecision:allow (updatedInput has no
	// prompt-preserving form), so injecting an unrelated command like
	// `pnpm publish` / `turbo gen` would silently auto-approve it past the Bash
	// permission prompt (permission broadening). A runner with no inject_scripts
	// (vitest/jest — dedicated test runners with no dangerous subcommands)
	// injects unconditionally.
	if (rule.inject_scripts !== undefined && !hasAnyScriptPrefix(command, rule.inject_scripts)) {
		return null;
	}

	let result = command;
	let changed = false;

	if (rule.env !== undefined) {
		const missing = Object.entries(rule.env)
			.filter(([varName]) => !hasEnvVar(command, varName))
			.map(([varName, value]) => `${varName}=${value}`);
		if (missing.length > 0) {
			result = `${missing.join(" ")} ${result}`;
			changed = true;
		}
	}

	const scopeOk = rule.flag_requires_scope !== true || hasAnyScopeFlag(command, rule.deny?.scope_flags ?? []);
	if (rule.flag !== undefined && scopeOk && !isCompound(command) && !hasEndOfOptionsMarker(command)) {
		const flagKey = rule.flag.split("=")[0];
		if (!hasFlag(command, flagKey)) {
			result = `${result} ${rule.flag}`;
			changed = true;
		}
	}

	return changed ? result : null;
}

function hasEnvVar(command: string, varName: string): boolean {
	return new RegExp(`(^|\\s)${escapeRegExp(varName)}=`).test(command);
}

function hasFlag(command: string, flagKey: string): boolean {
	return new RegExp(`(^|\\s)${escapeRegExp(flagKey)}([\\s=]|$)`).test(command);
}

function isCompound(command: string): boolean {
	// `&` (bare background marker, e.g. `jest &`) is included alongside `&&`:
	// tail-appending a flag after either would land it as its own foreground
	// command ("command not found") or corrupt the intended one.
	return /&&|\|\||\||;|\n|>|<|`|\$\(|&/.test(command);
}

function hasEndOfOptionsMarker(command: string): boolean {
	return /(^|\s)--(\s|$)/.test(command);
}

// -----------------------------------------------------------------------------
// Shared helpers
// -----------------------------------------------------------------------------
function stripLeadingEnvAssignments(segment: string): string {
	let s = segment.replace(/^\s+/, "");
	// Value side is quote-aware: a double- or single-quoted value (which may
	// itself contain spaces, e.g. NODE_OPTIONS="--a --b") is matched whole,
	// falling back to a plain \S* run for an unquoted value.
	const envPrefixRe = /^[A-Za-z_][A-Za-z0-9_]*=("[^"]*"|'[^']*'|\S*) +/;
	while (envPrefixRe.test(s)) {
		s = s.replace(envPrefixRe, "");
	}
	return s;
}

function firstToken(effective: string): string {
	const match = /^(\S+)/.exec(effective);
	return match ? match[1] : "";
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// -----------------------------------------------------------------------------
// Config loading — base+local merge, per-runner (one level deep), inline
// here rather than a separate module: this is the engine's only caller.
// Mirrors hooks/rules-injector/local-config.ts's contract: config dir
// defaults to this module's own directory (verify-caps.yaml ships beside the
// deployed hook); absent/malformed yaml degrades non-fatally to {} — never
// throws, since a config problem must fall through to passthrough, not block
// the command.
// -----------------------------------------------------------------------------
export function loadConfig(
	configDir: string = fileURLToPath(new URL(".", import.meta.url)),
): VerifyCapsConfig {
	const base = readYamlObject(join(configDir, "verify-caps.yaml"));
	const local = readYamlObject(join(configDir, "verify-caps.local.yaml"));

	const baseRunners = isRecord(base.runners) ? base.runners : {};
	const localRunners = isRecord(local.runners) ? local.runners : {};

	const runners: Record<string, RunnerRule> = {};
	for (const key of new Set([...Object.keys(baseRunners), ...Object.keys(localRunners)])) {
		const baseRule = isRecord(baseRunners[key]) ? baseRunners[key] : {};
		const localRule = isRecord(localRunners[key]) ? localRunners[key] : {};
		const mergedBase = toRunnerRule(baseRule);
		const mergedLocal = toRunnerRule(localRule);
		// Field-level merge (one level deep, matching the runner-level merge
		// above): `flag`/`flag_requires_scope`/`deny` present in localRule
		// replace the whole base field, absent falls through to base. `env` is
		// merged one level deeper still (key-level) rather than replaced whole:
		// a local override touching one VAR must not silently drop a sibling
		// base VAR the overlay never meant to remove (e.g. local overriding
		// only VITEST_MAX_FORKS must keep base's VITEST_MAX_THREADS).
		const rule: RunnerRule = { ...mergedBase, ...mergedLocal };
		if (mergedBase.env !== undefined || mergedLocal.env !== undefined) {
			rule.env = { ...mergedBase.env, ...mergedLocal.env };
		}
		runners[key] = rule;
	}

	return { runners };
}

// Validates/coerces a raw yaml-parsed object into a RunnerRule, dropping any
// wrong-typed field rather than casting past the type system — a malformed
// config value degrades that one field to absent (non-fatal), it never throws.
function toRunnerRule(raw: Record<string, unknown>): RunnerRule {
	const rule: RunnerRule = {};
	if (isRecord(raw.env)) {
		const env: Record<string, string> = {};
		for (const [varName, value] of Object.entries(raw.env)) {
			if (typeof value === "string") env[varName] = value;
		}
		rule.env = env;
	}
	if (typeof raw.flag === "string") {
		rule.flag = raw.flag;
	}
	if (typeof raw.flag_requires_scope === "boolean") {
		rule.flag_requires_scope = raw.flag_requires_scope;
	}
	// Only set inject_scripts when the yaml actually declares an array: an
	// absent field must stay undefined (→ unconditional injection for
	// vitest/jest), not coerce to [] (→ never inject).
	if (Array.isArray(raw.inject_scripts)) {
		rule.inject_scripts = toStringArray(raw.inject_scripts);
	}
	if (isRecord(raw.deny)) {
		rule.deny = {
			scripts: toStringArray(raw.deny.scripts),
			scope_flags: toStringArray(raw.deny.scope_flags),
		};
	}
	return rule;
}

function toStringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function readYamlObject(path: string): Record<string, unknown> {
	let raw: string;
	try {
		raw = readFileSync(path, "utf8");
	} catch {
		return {};
	}
	try {
		const parsed: unknown = Bun.YAML.parse(raw);
		return isRecord(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

// -----------------------------------------------------------------------------
// PreToolUse IO contract — parses the hook's stdin JSON, calls decide(), and
// formats the hook output envelope. Kept separate from main() (which only
// handles the stdin/stdout plumbing) so it's directly testable with JSON
// strings instead of mocked streams. Never throws: any parse failure falls
// through to "" (passthrough, no hook output emitted).
// -----------------------------------------------------------------------------
type PreToolUseInput = {
	tool_name?: unknown;
	tool_input?: { command?: unknown };
};

export function processHookInput(
	raw: string,
	configDir: string = fileURLToPath(new URL(".", import.meta.url)),
): string {
	try {
		const input: PreToolUseInput = JSON.parse(raw);
		if (input.tool_name !== "Bash") return "";

		const command = input.tool_input?.command;
		if (typeof command !== "string" || command.trim().length === 0) return "";

		const config = loadConfig(configDir);
		const result = decide(command, config);

		if (result.action === "deny") {
			return JSON.stringify({
				hookSpecificOutput: {
					hookEventName: "PreToolUse",
					permissionDecision: "deny",
					permissionDecisionReason: result.reason,
				},
			});
		}
		if (result.action === "allow") {
			return JSON.stringify({
				hookSpecificOutput: {
					hookEventName: "PreToolUse",
					permissionDecision: "allow",
					updatedInput: { command: result.command },
				},
			});
		}
		return "";
	} catch {
		return "";
	}
}

async function readStdin(): Promise<string> {
	return new Promise((resolve) => {
		let data = "";
		process.stdin.setEncoding("utf8");
		process.stdin.on("data", (chunk) => {
			data += chunk;
		});
		process.stdin.on("end", () => resolve(data));
		process.stdin.on("error", () => resolve(""));
	});
}

export async function main(): Promise<void> {
	try {
		const raw = await readStdin();
		const output = processHookInput(raw);
		if (output.length > 0) {
			// eslint-disable-next-line no-console -- PreToolUse 훅 stdout 프로토콜
			console.log(output);
		}
	} catch {
		// fail-open: this hook must never throw or block the tool call.
	}
}

if (import.meta.main) {
	main();
}

import { existsSync } from "node:fs";
import { join } from "node:path";

import { DEFAULT_AUTO_DISABLED_SOURCES, SOURCE_PRIORITY } from "./rules/index.js";
import { defaultConfig } from "./rules/index.js";
import type { PiRulesConfig, RuleSource } from "./rules/index.js";
import { findProjectRoot } from "./rules/project-root.js";

export function configFromEnvironment(env: NodeJS.ProcessEnv = process.env, cwd?: string): PiRulesConfig {
	const config = defaultConfig();
	const disableBundledRules = isTruthy(firstEnv(env, "CODEX_RULES_DISABLE_BUNDLED", "PI_RULES_DISABLE_BUNDLED"));
	config.disabled = isTruthy(firstEnv(env, "CODEX_RULES_DISABLED", "PI_RULES_DISABLED"));
	// D-22 file-based opt-out: OR in the sentinel-file check so all four handler
	// gates honor it without per-handler duplication. Errors are silenced to
	// preserve the engine's never-throw / always-exit-0 guarantee.
	if (!config.disabled && cwd !== undefined) {
		config.disabled = isOffFilePresentSync(cwd);
	}
	config.maxRuleChars =
		parsePositiveInteger(firstEnv(env, "CODEX_RULES_MAX_RULE_CHARS", "PI_RULES_MAX_RULE_CHARS")) ??
		config.maxRuleChars;
	config.maxResultChars =
		parsePositiveInteger(firstEnv(env, "CODEX_RULES_MAX_RESULT_CHARS", "PI_RULES_MAX_RESULT_CHARS")) ??
		config.maxResultChars;
	config.postCompactMaxRuleChars =
		parsePositiveInteger(
			firstEnv(env, "CODEX_RULES_POST_COMPACT_MAX_RULE_CHARS", "PI_RULES_POST_COMPACT_MAX_RULE_CHARS"),
		) ?? config.postCompactMaxRuleChars;
	config.postCompactMaxResultChars =
		parsePositiveInteger(
			firstEnv(env, "CODEX_RULES_POST_COMPACT_MAX_RESULT_CHARS", "PI_RULES_POST_COMPACT_MAX_RESULT_CHARS"),
		) ?? config.postCompactMaxResultChars;
	config.dynamicMaxRuleChars =
		parsePositiveInteger(firstEnv(env, "CODEX_RULES_DYNAMIC_MAX_RULE_CHARS", "PI_RULES_DYNAMIC_MAX_RULE_CHARS")) ??
		config.dynamicMaxRuleChars;
	config.dynamicMaxResultChars =
		parsePositiveInteger(
			firstEnv(env, "CODEX_RULES_DYNAMIC_MAX_RESULT_CHARS", "PI_RULES_DYNAMIC_MAX_RESULT_CHARS"),
		) ?? config.dynamicMaxResultChars;
	config.promptMaxRuleChars =
		parsePositiveInteger(firstEnv(env, "CODEX_RULES_PROMPT_MAX_RULE_CHARS", "PI_RULES_PROMPT_MAX_RULE_CHARS")) ??
		config.promptMaxRuleChars;
	config.promptMaxResultChars =
		parsePositiveInteger(firstEnv(env, "CODEX_RULES_PROMPT_MAX_RESULT_CHARS", "PI_RULES_PROMPT_MAX_RESULT_CHARS")) ??
		config.promptMaxResultChars;
	config.enabledSources = parseEnabledSources(
		firstEnv(env, "CODEX_RULES_ENABLED_SOURCES", "PI_RULES_ENABLED_SOURCES"),
		disableBundledRules,
	);
	return config;
}

function firstEnv(env: NodeJS.ProcessEnv, ...names: string[]): string | undefined {
	for (const name of names) {
		const value = env[name];
		if (typeof value === "string" && value.trim().length > 0) {
			return value;
		}
	}
	return undefined;
}

function isTruthy(value: string | undefined): boolean {
	if (value === undefined) return false;
	return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function parsePositiveInteger(value: string | undefined): number | undefined {
	if (value === undefined) return undefined;
	const trimmed = value.trim();
	if (!/^\d+$/.test(trimmed)) return undefined;
	const parsed = Number.parseInt(trimmed, 10);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseEnabledSources(value: string | undefined, disableBundledRules: boolean): RuleSource[] | "auto" {
	if (value === undefined || value.trim().toLowerCase() === "auto") {
		return disableBundledRules ? sourcesWithoutBundledRules() : "auto";
	}

	const sources: RuleSource[] = [];
	for (const rawSource of value.split(",")) {
		const source = toRuleSource(rawSource.trim());
		if (source === null) {
			continue;
		}
		sources.push(source);
	}
	const enabledSources = disableBundledRules ? sources.filter((source) => source !== "plugin-bundled") : sources;
	return enabledSources;
}

function sourcesWithoutBundledRules(): RuleSource[] {
	const excluded = new Set<string>(["plugin-bundled", ...DEFAULT_AUTO_DISABLED_SOURCES]);
	return [...SOURCE_PRIORITY.keys()].filter((source) => !excluded.has(source));
}

/**
 * Returns true if `.codex/rules-injector.local.off` exists at the resolved
 * workspace root of `cwd`. Treats any filesystem error as "file absent" so the
 * engine never throws and always exits 0.
 */
function isOffFilePresentSync(cwd: string): boolean {
	try {
		const root = findProjectRoot(cwd) ?? cwd;
		return existsSync(join(root, ".codex", "rules-injector.local.off"));
	} catch {
		return false;
	}
}

function toRuleSource(value: string): RuleSource | null {
	switch (value) {
		case ".omo/rules":
		case ".claude/rules":
		case ".cursor/rules":
		case ".github/instructions":
		case ".github/copilot-instructions.md":
		case "CONTEXT.md":
		case "plugin-bundled":
		case "~/.omo/rules":
		case "~/.opencode/rules":
		case "~/.claude/rules":
			return value;
		default:
			return null;
	}
}

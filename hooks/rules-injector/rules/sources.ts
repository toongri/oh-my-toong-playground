import { SOURCE_PRIORITY } from "./constants.js";
import type { PiRulesConfig } from "./types.js";

// Sources disabled in auto mode. .omo/rules and ~/.omo/rules are excluded so
// this engine reads only first-party rule dirs (.claude/rules, etc.) — a dev
// running omo's own injector would otherwise get omo's rules injected twice.
// .cursor/rules is excluded because Codex does not use Cursor rules.
//
// .claude/rules and ~/.claude/rules are deliberately NOT in this list. rules
// is a supported codex sync category (SUPPORTED_CATEGORIES.codex), so a
// de-Claude-ified counterpart of every rule USUALLY lands at .codex/rules /
// ~/.codex/rules (deploy-time PLATFORM_REWRITE_RULES.codex rewrite —
// AskUserQuestion -> request_user_input, TaskOutput/TaskCreate/subagent_type,
// .claude/ -> .codex/, etc.) — but not always: a project that never ran OMT's
// sync has no .codex/rules at all. Unconditionally disabling .claude/rules
// here would close the Claude-vocabulary leak at the cost of losing rules
// entirely on every such project — a worse outcome than the leak it
// prevents. Instead, findRuleCandidates (finder.ts) drops a .claude/rules
// (or ~/.claude/rules) candidate ONLY when a .codex/rules (~/.codex/rules)
// candidate is ALSO present in the same scope — existence-conditional
// supersede, not a blanket disable.
export const DEFAULT_AUTO_DISABLED_SOURCES: readonly string[] = [
	"AGENTS.md",
	"~/.claude/CLAUDE.md",
	".omo/rules",
	"~/.omo/rules",
	".cursor/rules",
];

export function disabledSourcesFromConfig(config: PiRulesConfig): ReadonlySet<string> | undefined {
	if (config.enabledSources === "auto") {
		return new Set(DEFAULT_AUTO_DISABLED_SOURCES);
	}

	const enabledSources = new Set(config.enabledSources);
	return new Set([...SOURCE_PRIORITY.keys()].filter((source) => !enabledSources.has(source)));
}

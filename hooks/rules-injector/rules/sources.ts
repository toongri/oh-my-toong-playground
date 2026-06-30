import { SOURCE_PRIORITY } from "./constants.js";
import type { PiRulesConfig } from "./types.js";

// Sources disabled in auto mode. .omo/rules and ~/.omo/rules are excluded so
// this engine reads only first-party rule dirs (.claude/rules, etc.) — a dev
// running omo's own injector would otherwise get omo's rules injected twice.
export const DEFAULT_AUTO_DISABLED_SOURCES: readonly string[] = [
	"AGENTS.md",
	"~/.claude/CLAUDE.md",
	".omo/rules",
	"~/.omo/rules",
];

export function disabledSourcesFromConfig(config: PiRulesConfig): ReadonlySet<string> | undefined {
	if (config.enabledSources === "auto") {
		return new Set(DEFAULT_AUTO_DISABLED_SOURCES);
	}

	const enabledSources = new Set(config.enabledSources);
	return new Set([...SOURCE_PRIORITY.keys()].filter((source) => !enabledSources.has(source)));
}

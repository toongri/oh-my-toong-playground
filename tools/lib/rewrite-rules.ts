/**
 * Shared source of truth for platform de-Claude-ification rewrites.
 *
 * Two consumers depend on this exact table: the deploy-time rewriter
 * (rewritePlatformPaths) and the `make validate` completeness scanner
 * (validateCodexRewriteCoverage) — both wired in a follow-up task. A
 * duplicated table would silently drift and make the scanner vacuous; this
 * module exists so both read the SAME rules.
 */

import type { Platform } from "./types.ts";

export type RewriteRule = {
	id: string;
	detect: RegExp;
	replace: string;
	lossy: boolean;
};

/**
 * Static, order-sensitive per-platform rewrite tables. Array order IS
 * application order — see the ordering notes on the codex table below.
 */
export const PLATFORM_REWRITE_RULES: Record<Platform, readonly RewriteRule[]> = {
	// Empty by design — this is what makes Claude's deployed bytes invariant
	// by construction (plan AC G4-10). No file opened for Claude is ever
	// mutated by applyRewriteRules, so byte-identity is structural, not
	// merely asserted.
	claude: [],

	// Preserves today's sync.ts behavior exactly (tools/sync.ts:1307): the
	// only rewrite gemini/opencode ever performed was `.claude/` -> `.<platform>/`.
	// Do not expand these tables without a corresponding spec update.
	gemini: [{ id: "4", detect: /\.claude\//g, replace: ".gemini/", lossy: false }],
	opencode: [{ id: "4", detect: /\.claude\//g, replace: ".opencode/", lossy: false }],

	codex: [
		// Order: S -> 17 -> 4 -> 5 -> 6a -> 6b -> 7 -> 8 -> 9 -> 10 -> 11 -> 12 -> 13 -> 14 -> 2 -> 3.
		// This array order IS the application order — ordering is semantic, not cosmetic.

		// S MUST precede 17 and 4: Codex skills live in .agents/skills, NOT
		// .codex/skills. If row 4 or 17 ran first, `~/.claude/skills/hud`
		// would mis-map to `~/.codex/skills/hud` (a directory Codex does not
		// read). Claiming the `skills` subpath first makes rows 4/17 find no
		// leftover `.claude/` under it.
		{ id: "S", detect: /\.claude\/skills/g, replace: ".agents/skills", lossy: false },

		// 17 MUST precede 4: `~/.claude/` is a superstring of `.claude/`. Kept
		// 17-before-4 for auditability even though final output would agree
		// either way for the home-config case.
		{ id: "17", detect: /~\/\.claude\//g, replace: "~/.codex/", lossy: false },
		{ id: "4", detect: /\.claude\//g, replace: ".codex/", lossy: false },
		{ id: "5", detect: /\bCLAUDE\.md\b/g, replace: "AGENTS.md", lossy: false },

		// 6a before 6b: 6a's non-greedy capture requires >=1 name char, so it
		// cannot match bare `Skill()` — that falls through to 6b. Mutually
		// exclusive (named vs empty parens), so relative order is safe either
		// way, but 6a-first matches the authored table.
		{
			id: "6a",
			detect: /\bSkill\(\s*(?:skill:\s*)?["']?([^"')]+?)["']?\s*\)/g,
			replace: "the $1 skill",
			lossy: true,
		},
		{ id: "6b", detect: /\bSkill\(\)/g, replace: "skill invocation", lossy: true },

		// Capability noun, NOT a real Codex tool name: `WebFetch` appears in a
		// PROHIBITION sentence in skills/collect-jd ("WebFetch call
		// forbidden"). Naming a real tool there risks an over-broad
		// "<tool> forbidden" misreading.
		{ id: "7", detect: /\bWebFetch\b/g, replace: "URL fetch", lossy: true },

		{ id: "8", detect: /\bWebSearch\b/g, replace: "web_search", lossy: false },

		// MUST NOT be `update_plan`. rules/tool-usage-policy.md says "Never
		// use the TaskOutput tool" — TaskOutput is prohibited, while
		// update_plan is REQUIRED (this project's Codex Stop-hook todo mirror
		// depends on it). Mapping the prohibition onto the required tool would
		// be a semantic inversion, so this uses a capability noun that names
		// nothing callable.
		{ id: "9", detect: /\bTaskOutput\b/g, replace: "subagent transcript read", lossy: true },

		// Correct target tool, but lossy: TaskCreate is a single-todo create;
		// update_plan replaces/manages the WHOLE plan array. Shape differs.
		{ id: "10", detect: /\bTaskCreate\b/g, replace: "update_plan", lossy: true },

		// Correct target tool, but lossy: Agent(description, prompt,
		// subagent_type, run_in_background, model) vs Codex's
		// spawn_agent(agent_type, model, ...) — call shape differs.
		{ id: "11", detect: /\bAgent\s*\(/g, replace: "spawn_agent(", lossy: true },

		{ id: "12", detect: /\bsubagent_type\b/g, replace: "agent_type", lossy: false },

		// Correct target tool, but lossy: MultiEdit(file_path,
		// edits[{old_string,new_string}]) vs apply_patch's diff-envelope
		// shape — call shape differs.
		{ id: "13", detect: /\bMultiEdit\b/g, replace: "apply_patch", lossy: true },

		{
			id: "14",
			detect: /\bAskUserQuestion\b/g,
			replace: "a plain-text user question",
			lossy: true,
		},

		// Defensive nets only — zero live carriers on the Codex deploy surface
		// today. Sole source carriers (hooks/session-start.sh,
		// hooks/resume-forge-start.sh) are not wired to Codex in codex.yaml,
		// so these fire zero times. Kept so a future Codex-wired hook cannot
		// leak the raw Claude env-var token into deployed bytes.
		{
			id: "2",
			detect: /\$CLAUDE_ENV_FILE\b/g,
			replace: "the Codex hook stdin state",
			lossy: true,
		},
		{
			id: "3",
			detect: /\$CLAUDE_PROJECT_DIR\b/g,
			replace: "cwd from hook stdin JSON",
			lossy: true,
		},
	],
};

/**
 * Literal token the Claude Code harness expands to a skill's absolute
 * deployed directory at skill-injection time. Codex has no such expander,
 * and a shell command in a skill body runs under the agent's session cwd
 * (repo root), not the skill dir — so a relative substitute (e.g. `.`)
 * would break every bundled-script skill. This is why the replacement is
 * contextual (baked per-file with the absolute deployed skill dir) rather
 * than a static row in PLATFORM_REWRITE_RULES.
 */
export const SKILL_DIR_TOKEN = "${CLAUDE_SKILL_DIR}";

/**
 * Replace every literal occurrence of SKILL_DIR_TOKEN with the given
 * absolute skill directory path. Plain literal replaceAll — NOT a regex —
 * because the token contains `$`, `{`, `}`, which are regex metacharacters.
 */
export function bakeSkillDirToken(content: string, skillDirAbsPath: string): string {
	return content.replaceAll(SKILL_DIR_TOKEN, skillDirAbsPath);
}

/**
 * Completeness net for plan AC G4-2. Deliberately BROADER than the specific
 * rows above, so a Claude-ism nobody has enumerated in PLATFORM_REWRITE_RULES
 * still gets caught by the (follow-up) scanner (validateCodexRewriteCoverage).
 *
 * `claude-model` (`model: opus|sonnet`) occurs ONLY in agents/*.md
 * frontmatter today, where syncAgentsDirect TRANSFORMS it to Codex TOML via
 * the model-map before it ever reaches the rewriter — so this literal text
 * never appears on the rewrite surface coming from agents/. The detector
 * exists so a stray `model: opus`/`model: sonnet` line in a *skill* body
 * (which is only copied, never transformed) still fails validate. The
 * follow-up scanner decides the exact policy for a hit.
 */
export const BROAD_DETECTORS: readonly { name: string; detect: RegExp }[] = [
	{ name: "claude-env", detect: /\bCLAUDE_[A-Z_]+\b/g },
	{ name: "claude-path", detect: /(~\/\.claude\/|\.claude\/|\bCLAUDE\.md\b)/g },
	{
		name: "claude-tool",
		detect: /\b(?:Skill|Agent)\s*\(|\b(?:Task|Ask|Web|Multi)[A-Z]\w+\b|\bsubagent_type\b/g,
	},
	{ name: "claude-model", detect: /^model:\s*(?:opus|sonnet)\s*$/gm },
];

/**
 * Apply rules in array order over content. Each rule's detect regex is
 * reconstructed fresh before use, so a shared/reused `rules` array (whose
 * regex objects carry the `g` flag and therefore stateful `lastIndex`) never
 * leaks matched position across calls — calling this twice with the same
 * rules array and the same input is guaranteed to return the same output,
 * even if some caller separately probed a shared rule's `detect` with
 * `.test()` beforehand.
 */
export function applyRewriteRules(content: string, rules: readonly RewriteRule[]): string {
	let result = content;
	for (const rule of rules) {
		const detect = new RegExp(rule.detect.source, rule.detect.flags);
		result = result.replace(detect, rule.replace);
	}
	return result;
}

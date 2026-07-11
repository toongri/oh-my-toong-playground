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
		// Order: S -> 17 -> 17b -> 4 -> 5 -> 6a -> 6b -> 7 -> 8 -> 9 -> 10 -> 11 -> 12
		//        -> 13 -> 14p -> 14 -> 1 -> 2 -> 3.
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

		// 17b MUST run after 17 (and after S, transitively, since S precedes 17):
		// `[$CLAUDE_CONFIG_DIR|~/.claude]/settings.json` (skills/deep-interview/SKILL.md:67,
		// skills/code-review/SKILL.md:418,433) uses bracket notation, so `~/.claude` is
		// followed by `]`, not `/` — rule 17 (which demands a trailing slash) never
		// touches it, and it would otherwise survive verbatim into the Codex deploy.
		// `\b` alone (run BEFORE 17) would wrongly steal `~/.claude/skills/hud` and
		// `~/.claude/hooks/x` (`/` is a non-word char, so `\b` matches there too) —
		// running after 17 guarantees every trailing-slash instance is already
		// consumed, leaving only the bracket/non-slash case for this rule.
		{ id: "17b", detect: /~\/\.claude\b/g, replace: "~/.codex", lossy: false },

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

		// Real target tool: Codex's `request_user_input` (rust-v0.144.1,
		// codex-rs/core/src/tools/handlers/request_user_input_spec.rs) is the
		// genuine AskUserQuestion analog — questions[] of 1-3, each
		// {id, header, question, options[]} with 2-3 {label, description}
		// options, recommended-first, auto "Other", optional autoResolutionMs.
		// Lossy because it's mode-gated (full support in Plan/collaboration
		// modes, feature-flagged in Default mode) and because the call shape
		// itself isn't asserted identical to AskUserQuestion's.
		//
		// 14p MUST precede 14 (longest match first): `\bAskUserQuestion\b` cannot
		// match the plural `AskUserQuestions` — the `\b` fails right before the
		// trailing `s` — so without this row running first, the plural survives
		// unmapped (skills/collect-jd/tests/pressure-scenarios.md:688: "asking too
		// many AskUserQuestions will tire the user"). Running 14p first consumes
		// every plural instance whole, so 14 never sees a partial/mangled remainder.
		{
			id: "14p",
			detect: /\bAskUserQuestions\b/g,
			replace: "request_user_input calls",
			lossy: true,
		},
		{
			id: "14",
			detect: /\bAskUserQuestion\b/g,
			replace: "request_user_input",
			lossy: true,
		},

		// Real carrier: skills/deep-interview/SKILL.md:67, skills/code-review/SKILL.md:418,433
		// (`Read [$CLAUDE_CONFIG_DIR|~/.claude]/settings.json`). Lossy: Codex's real
		// counterpart is the CODEX_HOME env var (config-home override), but Codex
		// stores config in config.toml, not settings.json — the substitution keeps
		// the sentence directionally right but not literally executable.
		{
			id: "1",
			detect: /\$CLAUDE_CONFIG_DIR\b/g,
			replace: "$CODEX_HOME",
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
 * Hook event names Codex shares verbatim with Claude (codex-rs/hooks/src/lib.rs:86-94).
 * These must NEVER be rewritten by any platform table — a rule that silently
 * renamed a hook event would break hook dispatch. Asserted in rewrite-rules.test.ts.
 */
export const KEEP_IDENTICAL_TOKENS: readonly string[] = [
	"PreToolUse",
	"PostToolUse",
	"SessionStart",
	"UserPromptSubmit",
	"PreCompact",
];

/**
 * Tokens that satisfy a BROAD_DETECTORS pattern but are NOT Claude-isms —
 * ordinary technical vocabulary that happens to share a shape (`Web[A-Z]\w+`,
 * `CLAUDE_[A-Z_]+`) with a real Claude tool/env-var name. Each reason names the
 * real, verified carrier location(s) — corpus-scanned, not asserted from memory.
 *
 * WebP and WebGL are documented here for completeness but are not live
 * escapes today: WebP's 4 characters never satisfy the claude-tool detector's
 * `Web[A-Z]\w+` (which needs ≥1 trailing word-char after the capital), and
 * WebGL's sole carrier (skills/insane-browsing) is `platforms: [claude]`-only,
 * so it never reaches the codex deploy surface to be scanned.
 */
export const OUT_OF_SCOPE_TOKENS: readonly { token: string; reason: string }[] = [
	{
		token: "WebP",
		reason:
			"image format; ordinary technical term in skills/tech-claim-rubric evaluation content, not a Claude tool.",
	},
	{
		token: "WebSocket",
		reason:
			"network protocol; appears in skills/insane-browsing (extract_cookies.py) and skills/prometheus (test scenario prose), not skills/qa.",
	},
	{
		token: "WebFlux",
		reason: "Spring framework module; skills/tech-claim-rubric evaluation content.",
	},
	{
		token: "WebView",
		reason:
			"mobile/embedded browser component; appears in skills/tech-claim-rubric, not skills/insane-browsing.",
	},
	{
		token: "WebTestClient",
		reason: "Spring test class; appears in skills/qa, not skills/tech-claim-rubric.",
	},
	{
		token: "WebGL",
		reason: "graphics API; appears in skills/insane-browsing, not skills/prometheus.",
	},
	{
		token: "CLAUDE_CODE_EFFORT_LEVEL",
		reason:
			'appears inside a comment that explains the per-platform difference ("claude: env CLAUDE_CODE_EFFORT_LEVEL, codex: -c flag") in skills/agent-council/council.config.yaml:16; rewriting it destroys the distinction it documents. The other carrier, skills/orchestrate-review/scripts/job.test.ts:831, is a *.test.ts file excluded from deploy by DEFAULT_EXCLUDE.',
	},
	{
		token: "CLAUDE_PID",
		reason:
			"skills/collect-jd/tests/concurrency-dogfood.md:136: Korean prose describing that collect-jd is a Claude Code skill — documentation about Claude, not an instruction to the agent.",
	},
	{
		token: "WebEnvironment",
		reason:
			"Spring Boot Test API (`@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)`); appears in the project-local `testing` skill's e2e-test.md reference, duplicated in both projects/loopers-kotlin-spring-template and projects/toong-java-spring-template (Kotlin/Java variants of the same test-setup snippet). Not enumerated by the original corpus scan — found by running the G4-2 scanner itself against the full (unfiltered) project set.",
	},
];

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

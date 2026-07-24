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

// Matches String.prototype.replace's function-replacer parameter shape
// (substring, then each capture group, narrowed to `string` since every
// capture group PLATFORM_REWRITE_RULES ever declares is a plain text group —
// no `d`-flag/named-group usage that would add non-string members).
type RewriteRuleReplacer = (substring: string, ...args: string[]) => string;

export type RewriteRule = {
	id: string;
	detect: RegExp;
	// A function replacer is a deliberate escape hatch for rule 6a: JS regex
	// alone cannot balance parens inside an args value (see 6a's comment
	// below), so 6a's detect captures the raw call body and its replace
	// function re-parses that body to decide the output. String.prototype
	// .replace already accepts either shape natively — applyRewriteRules
	// passes rule.replace straight through without switching on its type.
	replace: string | RewriteRuleReplacer;
	lossy: boolean;
};

/**
 * Rule 6a's replace function (see the rule's own comment for the detect
 * regex it pairs with). `body` is everything between `Skill(` and its
 * balanced/quote-aware matching `)` — e.g. `skill: "testing", args: "auth
 * only"`. Extracts the skill name (same shape the old string-replace form
 * captured) and, if present, an `args: "..."` value, emitting `$name args`
 * — the args text rides along as plain prose after the mention sigil rather
 * than being dropped, matching how a body `$X` mention is documented above
 * as a cue the model reads, not a machine-parsed call.
 */
const rewriteSkillCall: RewriteRuleReplacer = (_substring, body) => {
	const nameMatch = body.match(/^\s*(?:skill:\s*)?["']?([^"',)]+?)["']?\s*(?:,|$)/);
	const name = nameMatch ? nameMatch[1] : body.trim();
	const argsMatch = body.match(/\bargs:\s*(["'])([\s\S]*?)\1\s*(?:,|$)/);
	return argsMatch ? `$${name} ${argsMatch[2]}` : `$${name}`;
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
		// Order: S -> 17 -> 17b -> 4 -> 5 -> 6a -> 6b -> 7 -> 8 -> 9 -> 10 -> 11 -> 11a
		//        -> 11b -> 12 -> 13 -> 14p -> 14 -> 1 -> 2 -> 3.
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

		// 4b MUST run after 4 and 17/17b: it matches the `.codex` form those
		// rows produce, not the `.claude` original. Without it, rows 4/17/17b
		// finish the path rewrite but leave the FILENAME pointing at a file
		// that does not exist on Codex — `tools/adapters/codex.ts`'s syncConfig
		// and flushMcpBlock write only `config.toml` under `.codex/`; Codex has
		// no `settings.json` at any scope. So a deployed sentence like
		// `Read [$CLAUDE_CONFIG_DIR|~/.claude]/settings.json` would survive as
		// `Read [$CODEX_HOME|~/.codex]/config.toml`'s broken sibling
		// `~/.codex]/settings.json` — directionally right, literally dead.
		//
		// The `(\]?)` group is what carries the bracket-notation carrier (the
		// one rule 17b exists for) through this row: after 17b the text reads
		// `~/.codex]/settings.json`, so the `]` sits between the directory and
		// the slash and must be re-emitted, not eaten.
		//
		// `/settings\.json` is anchored on the leading slash, so the hud-only
		// `settings.local.json` is untouched — `settings.json` is not a
		// contiguous substring of it.
		{
			id: "4b",
			detect: /((?:~\/)?\.codex)(\]?)\/settings\.json/g,
			replace: "$1$2/config.toml",
			lossy: false,
		},

		{ id: "5", detect: /\bCLAUDE\.md\b/g, replace: "AGENTS.md", lossy: false },

		// 6a before 6b: 6a's body group requires >=1 char inside the parens, so
		// it cannot match bare `Skill()` — that falls through to 6b. Mutually
		// exclusive (non-empty vs empty parens), so relative order is safe
		// either way, but 6a-first matches the authored table.
		//
		// Target is `$name`, Codex's real mention sigil, not prose. Codex has
		// no skill-invocation tool (verified: `strings` on the codex binary
		// finds zero use_skill/invoke_skill/run_skill hits) — skill loading is
		// handled by a mention scanner whose trigger syntax is `$name`. A
		// user's `$X` is machine-loaded; a body `$X` is not machine-loaded but
		// is a strong enough cue that the model opens the referenced SKILL.md
		// itself and follows it (observed: a probed model ran `sed -n
		// '1,240p' .codex/skills/chain-bravo/SKILL.md` off a body
		// `$chain-bravo` mention). Prose (`the X skill`) gives the model no
		// such cue at all. Precedent: oh-my-codex's `autopilot/SKILL.md` ships
		// a body chain `$deep-interview -> $ralplan -> $ultragoal`.
		//
		// Detect's capture group is NOT the skill name directly — it is the
		// entire call body between `Skill(` and its matching `)`, captured by
		// an alternation over "double-quoted string | single-quoted string |
		// any char that isn't a paren or quote", repeated one-or-more times. A
		// quoted-string alternative swallows everything between its own quotes
		// whole, including parens (e.g. `args: "review (draft)"`), so an
		// unmatched `(`/`)` inside a quoted value never confuses the scan for
		// the call's TRUE closing `)` — the failure mode this replaced (plain
		// `[^)]*` treats any `)` as the end, so `args: "review (draft)"` closed
		// the match at the inner `)`, leaving the broken fragment `$testing")`
		// behind in deployed bytes). The `+` (not `*`) requires at least 1 body
		// char, preserving the bare-`Skill()`-falls-through-to-6b property
		// noted above.
		//
		// `rewriteSkillCall` (top of file) re-parses that captured body: it
		// extracts the skill name with the same shape the old regex capture
		// used, and — new — an optional `args: "..."` value, which rides along
		// after the sigil as plain prose (`$name args`) instead of being
		// silently dropped (the prior bug: `args: "x"` matched and vanished
		// with no trace). String.replace's function-replacer form receives the
		// full match as arg 0 and each capture group after it — same contract
		// as the string-template form it replaces; a function is what makes
		// conditionally appending a second, quote-balanced capture possible at
		// all, which a static `"$$$1"`-style template has no way to express.
		{
			id: "6a",
			detect: /\bSkill\(((?:"[^"]*"|'[^']*'|[^()'"])+)\)/g,
			replace: rewriteSkillCall,
			lossy: true,
		},
		{ id: "6b", detect: /\bSkill\(\)/g, replace: "skill invocation", lossy: true },

		// Capability noun, NOT a real Codex tool name: `WebFetch` appears in a
		// PROHIBITION sentence in skills/collect-jd ("WebFetch call
		// forbidden"). Naming a real tool there risks an over-broad
		// "<tool> forbidden" misreading.
		{ id: "7", detect: /\bWebFetch\b/g, replace: "URL fetch", lossy: true },

		// Capability noun for the same reason as rule 7, and for a second one.
		//
		// (a) Prohibition and prescription both appear on the deploy surface:
		// `run_in_background` is PRESCRIBED in skills/qa ("MUST be launched
		// with run_in_background") and skills/insane-browsing, and PROHIBITED
		// in skills/agent-council and rules/tool-usage-policy ("`run_in_background`
		// is prohibited"). No single real tool name can carry both senses
		// without one of them reading as a lie about that tool.
		//
		// (b) No Codex parameter has this name. Measured against the real
		// binary (codex 0.145.0): the shell tool's parameters are
		// `command`/`timeout_ms`/`working_directory`/`env`/`user` — there is no
		// background flag. Codex's actual equivalent is the separate
		// `unified_exec` tool, whose `yield_time_ms` "asks exec to yield early
		// if the script is still running", polled afterwards via `write_stdin`,
		// and it sits behind the `features.unified_exec` flag. Substituting
		// either name would tell a Codex session to pass a parameter that does
		// not exist on the tool it is actually calling.
		{
			id: "7b",
			detect: /\brun_in_background(?:=true)?\b/g,
			replace: "background execution",
			lossy: true,
		},

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

		// Real carrier: skills/clarify/SKILL.md:150 — `Task(subagent_type="explore",
		// prompt="...")`, this project's older call-form for subagent dispatch (predates
		// the `Agent(` naming used elsewhere). Same target and same lossiness rationale
		// as rule 11: Codex's real primitive is spawn_agent(agent_type, model, ...) — the
		// call shape differs, but the tool identity maps directly (Codex has no
		// `Task`-named tool of its own, verified via `strings` on the codex binary).
		//
		// `(?:(?<=\\n)|\b)` boundary (not plain `\b`): mirrors the claude-tool BROAD_DETECTORS
		// entry, which already detects "Task(" right after a literal `\n` DOT-label escape
		// (same blind spot documented at rules 14/14p) — a plain `\b` here would leave that
		// case uncovered even though the detector catches it.
		{ id: "11a", detect: /(?:(?<=\\n)|\b)Task\s*\(/g, replace: "spawn_agent(", lossy: true },

		// Real carriers: skills/code-review/SKILL.md:414,515, skills/review-report/SKILL.md:18,135
		// — prose naming "the Task tool" as the dispatch mechanism (always paired with
		// `subagent_type:`, itself covered by rule 12 below). Same target as 11/11a for
		// the same reason: spawn_agent is Codex's native subagent-dispatch primitive.
		// Same `(?:(?<=\\n)|\b)` boundary rationale as 11a above.
		{ id: "11b", detect: /(?:(?<=\\n)|\b)Task tool\b/g, replace: "spawn_agent tool", lossy: true },

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
		//
		// Both alternatives carry a leading `(?<=\\n)|\b` boundary: a plain
		// leading `\b` fails when the token sits right after a DOT-label literal
		// `\n` escape (backslash + n, not a real newline) — `n` is a word char,
		// so there's no word/non-word transition there. Witnessed carrier:
		// skills/collect-jd/reference/dedup-and-discovery.md:64 —
		// `vambig [label="ambiguous → Phase 3:\nAskUserQuestion\n(auto-verdict
		// forbidden)", ...]` — left this exact occurrence unmatched while
		// sibling occurrences with a non-word char before the token matched
		// fine. `(?<=\\n)` is a zero-width lookbehind for literal backslash+n
		// in the regex source, so it consumes nothing and the `\n` escape is
		// preserved in the output; the `\b` alternative still guards ordinary
		// non-word boundaries, so a compound identifier suffix like
		// `XAskUserQuestion` still fails both branches and stays unmatched.
		{
			id: "14p",
			detect: /(?:(?<=\\n)|\b)AskUserQuestions\b/g,
			replace: "request_user_input calls",
			lossy: true,
		},
		{
			id: "14",
			detect: /(?:(?<=\\n)|\b)AskUserQuestion\b/g,
			replace: "request_user_input",
			lossy: true,
		},

		// Real carrier: skills/deep-interview/SKILL.md:67, skills/code-review/SKILL.md:418,433
		// (`Read [$CLAUDE_CONFIG_DIR|~/.claude]/settings.json`). Lossy: Codex's real
		// counterpart is the CODEX_HOME env var (config-home override). Codex
		// stores config in config.toml, not settings.json — rule 4b above
		// finishes that half, so the pair (1 for the directory, 4b for the
		// filename) leaves a sentence that is literally executable on Codex,
		// not merely directionally right. Still lossy: CODEX_HOME overrides the
		// whole config home, which is not exactly what CLAUDE_CONFIG_DIR names.
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
// claude-env/claude-path/claude-tool share rule 14/14p's `\b` blind spot: a
// plain `\b` fails right before a literal `\n` DOT-label escape (backslash +
// n, not a real newline) — `n` is a word char, so there's no word/non-word
// transition there. Each gets the same `(?:(?<=\\n)|\b)` boundary fix as rule
// 14/14p above, so the completeness net doesn't share the exact escape it
// exists to catch. claude-model is untouched: it's line-anchored (`^`/`$`),
// unrelated to `\n`-escapes.
export const BROAD_DETECTORS: readonly { name: string; detect: RegExp }[] = [
	{ name: "claude-env", detect: /(?:(?<=\\n)|\b)CLAUDE_[A-Z_]+\b/g },
	{ name: "claude-path", detect: /(~\/\.claude\/|\.claude\/|(?:(?<=\\n)|\b)CLAUDE\.md\b)/g },
	{
		name: "claude-tool",
		detect:
			/(?:(?<=\\n)|\b)(?:Skill|Agent|Task)\s*\(|(?:(?<=\\n)|\b)(?:Task|Ask|Web|Multi)[A-Z]\w+\b|(?:(?<=\\n)|\b)subagent_type\b|(?:(?<=\\n)|\b)Task tool\b/g,
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
		// Branched (not passed straight through) so TS can pick the matching
		// String.replace overload per call — the union type on rule.replace
		// itself isn't assignable to either overload's parameter type.
		result =
			typeof rule.replace === "function"
				? result.replace(detect, rule.replace)
				: result.replace(detect, rule.replace);
	}
	return result;
}

/**
 * Shared types for the codex session probe harness.
 *
 * Architecture: the SESSION RUNNER (runner.ts) captures raw observations from
 * a real `codex exec` invocation; the JUDGMENT EVALUATOR (evaluate.ts) judges
 * an already-captured Observation against a Judgment, with no process or
 * filesystem access of its own. This split is what lets evaluator tests run
 * hermetically against captured fixtures (fast, deterministic, zero tokens)
 * while the expensive, flaky-by-nature real codex invocation stays isolated
 * to the runner.
 */

export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";

/** Input to one probed codex session. */
export type SessionConfig = {
	prompt: string;
	cwd: string;
	/** @default "read-only" */
	sandbox?: SandboxMode;
	/** @default 60_000 */
	timeoutMs?: number;
	/** Extra argv appended after the built-in `codex exec` flags. */
	extraArgs?: string[];
	/**
	 * Extra env vars for the spawned `codex exec` process. When set, runner.ts's
	 * runSession builds spawnEnv from an explicit ALLOWLIST (PATH, TMPDIR) plus
	 * these entries — NOT a full `process.env` spread (caller's entries win on
	 * key collision either way). @default undefined — process.env passed
	 * through unmodified, byte-identical to this field's absence before it
	 * existed.
	 *
	 * Added for probes that must isolate `HOME` (and independently pin
	 * `CODEX_HOME`) to get a hermetic result: home-scope rule/skill discovery
	 * (`~/.claude/rules`, `~/.agents/skills`) reads the REAL `HOME` unless
	 * overridden, so a probe run on a real developer machine can observe that
	 * machine's own ambient rules/skills bleeding into the session — a
	 * confound unrelated to the mechanism under test. The allowlist (rather
	 * than full inheritance) exists because that same confound is not limited
	 * to `HOME`-scoped rule/skill files — CONFIRMED defect (code-review): an
	 * ambient `CODEX_RULES_ENABLED_SOURCES`/`CODEX_RULES_MAX_RULE_CHARS`/
	 * `OMT_DIR`/`XDG_*`/`CLAUDE_CONFIG_DIR` on the host running the probe can
	 * confound an isolated session the exact same way, and setting this field
	 * at all is the caller's signal that isolation was intended. `CODEX_HOME`
	 * stays independently settable (not derived from `HOME`) because auth
	 * lives there and copying `auth.json` into a scratch `CODEX_HOME` is
	 * cheaper than faking authentication — see probes/ultrawork-keyword-
	 * injection and probes/rules-runtime-leak-absence for the isolated-
	 * CODEX_HOME pattern this field exists to support.
	 */
	env?: Record<string, string>;
};

/** One parsed line from `codex exec --json`'s stdout JSONL stream. */
export type ObservedEvent = Record<string, unknown>;

/**
 * One non-text item the agent emitted (a tool/command call), extracted from
 * the stdout event stream — the item's `type` plus its full raw payload, so a
 * predicate judgment can inspect the exact arguments a tool was called with.
 */
export type ToolCallRecord = {
	itemType: string;
	item: Record<string, unknown>;
};

/**
 * Everything a judgment can inspect about a completed session. All fields
 * are captured from real observation channels — see runner.ts for how each
 * is sourced.
 */
export type Observation = {
	/** Full parsed stdout JSONL event stream, in emission order. */
	events: ObservedEvent[];
	/** Non-text items extracted from `events` (command/tool calls). */
	toolCalls: ToolCallRecord[];
	/**
	 * Verbatim `session_meta.payload.base_instructions.text` from the
	 * correlated rollout file — the actual bytes injected into the model, not
	 * a paraphrase of them. A probe asserting a literal was never injected
	 * (as opposed to never mentioned by the model) must read this field.
	 *
	 * NOTE: this is ONLY the fixed system prompt. Per-session injected
	 * content (project rules, AGENTS.md, environment context) lives in a
	 * DIFFERENT rollout channel — see `injectedContext` below. A probe
	 * scoped to `baseInstructions` alone will not see anything injected only
	 * through that other channel (CONFIRMED defect, fixed by adding
	 * `injectedContext` rather than redefining this field).
	 */
	baseInstructions: string;
	/**
	 * Every rollout `response_item` message body with role `developer` or
	 * `user`, concatenated — the channel that actually carries per-session
	 * injected content (project rules, AGENTS.md, environment context), as
	 * opposed to `baseInstructions`'s fixed system prompt. See
	 * runner.ts's `parseInjectedContext` for how this is extracted.
	 */
	injectedContext: string;
	/** The agent's last `agent_message` text, or null if none was emitted. */
	finalMessage: string | null;
	/** Raw stdout text, for predicates that need to search the unparsed stream. */
	rawStdout: string;
	/**
	 * Raw stderr text from the `codex exec` invocation. Some behaviors under
	 * test are only observable here — e.g. an adapter-fidelity probe asserting
	 * a parse warning (`missing YAML frontmatter delimited by ---`) never
	 * appears was previously unmeasurable, since the harness spawned with
	 * `stderr: "pipe"` but never read the stream.
	 */
	stderr: string;
};

/**
 * Why a probe could not be measured at all — distinct from a measured
 * failure. Collapsing this into a plain boolean/exit-1 would make "codex
 * itself is broken" indistinguishable from "the behavior under test is
 * wrong", which defeats the harness's whole purpose (see probe.ts).
 *
 * `judgment-unmeasurable` covers a session-level SUCCESS whose judgment
 * still could not be trusted — an `absent` judgment's `positiveControl`
 * never appeared, so the absence check itself measured nothing (see
 * evaluate.ts's evaluateJudgmentVerdict). Every other member here is a
 * session-capture failure (the observation itself never came into being);
 * this one is the judgment-evaluation-layer counterpart.
 */
export type UnmeasurableReason =
	| "codex-binary-missing"
	| "codex-version-not-allowlisted"
	| "spawn-failed"
	| "timeout"
	| "output-parse-failed"
	| "judgment-unmeasurable";

export type RunResult = { ok: true; observation: Observation } | { ok: false; reason: UnmeasurableReason; detail: string };

/**
 * Which Observation surfaces a text-search judgment scans. Defaults to all
 * of them; a probe that must scope its search (e.g. "not in the injected
 * instructions specifically, regardless of what the model said about it")
 * passes `fields` explicitly.
 */
export const ALL_OBSERVATION_FIELDS = [
	"rawStdout",
	"baseInstructions",
	"injectedContext",
	"finalMessage",
	"stderr",
] as const;

export type ObservationField = (typeof ALL_OBSERVATION_FIELDS)[number];

/**
 * A probe's pass/fail rule. Three first-class kinds:
 *   - sentinel: a positive marker must be observed somewhere in scope.
 *   - absent: none of the given literals may be observed anywhere in scope
 *     (asserts something was NOT injected/leaked — e.g. story 5's
 *     `AskUserQuestion`/`TaskOutput`/`TaskCreate`/`subagent_type` check).
 *     `positiveControl`, if set, is a sentinel that must ALSO be observed
 *     (scoped to the SAME `fields`) before the absence result is trusted —
 *     see evaluate.ts's evaluateJudgmentVerdict. CONFIRMED defect (code-
 *     review) this guards: an `absent` judgment passes VACUOUSLY when the
 *     scoped observation text is empty — indistinguishable from "the
 *     literal is genuinely absent" without some other proof that the scoped
 *     channel actually captured real content at all. Omitted (the default)
 *     means no gate, unchanged from this field's absence before it existed —
 *     required for callers where an empty scoped field IS itself a
 *     meaningful pass (e.g. "stderr stayed clean", not a capture failure).
 *   - predicate: an arbitrary function over the full Observation, for
 *     judgments text search can't express (tool-call shape, event ordering —
 *     e.g. story 3's "was a SKILL.md file-read tool call observed").
 */
export type Judgment =
	| { kind: "sentinel"; text: string; fields?: ObservationField[] }
	| { kind: "absent"; literals: string[]; fields?: ObservationField[]; positiveControl?: string }
	| { kind: "predicate"; predicate: (observation: Observation) => boolean };

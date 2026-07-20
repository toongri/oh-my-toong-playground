/**
 * ultragoal skill state CLI. Adapted from goal-state.ts (skills/goal/scripts/goal-state.ts)
 * with its own artifact namespace (ultragoal-state-/ultragoal-verdict-/ultragoal-codereview-)
 * plus two story affordances for ultragoal's auto-generate + bulk-approve decomposition flow:
 * confirm-all-stories (bulk confirm-story over every unconfirmed story) and reorder-stories
 * (planning-only story-array reorder).
 *
 * State file path: ${OMT_DIR}/ultragoal-state-${sessionId}.json
 * Session ID: resolved from env OMT_SESSION_ID, falling back to CODEX_THREAD_ID (Codex), via resolveSessionIdOrThrow(); hard-fails when neither is set or unsafe.
 *
 * Structural mirror of prometheus-state.ts: session-keyed JSON, merge-write
 * preserving prior fields, `started_at` seeded once and never re-seeded,
 * null-on-malformed reads.
 *
 * The single load-bearing invariant: the state layer can never be made to
 * false-complete. Each gate is STRUCTURAL — enforced by which subcommand can
 * write what, not by vigilance:
 *   - `set` (orchestrator) accepts ONLY phase planning|pursuing; it can never
 *     write phase=complete and never writes objective_verdict.
 *   - `request-complete` is the ONLY path to phase=complete, and it is gated on
 *     `objective_verdict=APPROVE` AND completion-evidence being present.
 *   - `set-verdict` is the ONLY writer of objective_verdict.
 *   - `set-budget-limited` / `set-blocked` are system-only terminal setters and
 *     can never write phase=complete.
 *
 * Subcommands:
 *   set --phase <planning|pursuing> [--outcome ..] [--verification-surface ..]
 *       [--constraints ..] [--boundaries ..] [--max-iterations <n>]
 *       [--blocked-stop ..] [--plan-path ..] [--resume-summary ..]
 *       [--completion-evidence p1,p2]
 *   set-budget-limited                       (system-only)
 *   set-blocked --reason <text>              (system-only)
 *   request-complete                         (gated: requires objective_verdict=APPROVE and completion evidence)
 *   set-verdict --verdict <APPROVE|REQUEST_CHANGES|COMMENT|absent>
 *   get
 *   status
 *   set-stories --json '<array>' | --single
 *   confirm-story <id>                   (sole writer of confirmed — D-8)
 *   confirm-all-stories                  (bulk confirm-story over every unconfirmed story)
 *   reorder-stories --order <id1,id2,...> (planning-only; exact permutation of current ids)
 *   revise-story <id> --json '<patch>' --evidence <text> --rationale <text>
 *                                         (resets status to unconfirmed — D-9)
 *   add-story --json '<story>' --evidence <text> --rationale <text>
 *                                         (appends unconfirmed story — D-9)
 *   retire-story <id> --evidence <text> --rationale <text>
 *                                         (sets retired; confirmed-retire fence — D-9)
 *   --evidence/--rationale on the three steering mutations above are required — omitted
 *   or whitespace-only values are refused (ADR D-4).
 */

import { readFileSync, unlinkSync } from "fs";
import { execSync } from "child_process";
import { getOmtDir } from "@lib/omt-dir";
import {
	mergeWithHeartbeat,
	resolveSessionIdOrThrow,
	listOthers,
	adopt,
	writeFileNoCreate,
	isPristine,
	ensureSeed,
} from "@lib/state-core";

export type GoalPhase = "planning" | "pursuing" | "budget_limited" | "blocked" | "complete";
export type ObjectiveVerdict = "APPROVE" | "REQUEST_CHANGES" | "COMMENT" | "absent";
export type StoryStatus = "unconfirmed" | "confirmed" | "retired";

/** Phases the orchestrator's `set` subcommand may write. */
const SETTABLE_PHASES: GoalPhase[] = ["planning", "pursuing"];

/**
 * A WHAT-slice of the objective. Defined during planning with the user.
 * Status transitions: unconfirmed → confirmed (via confirm-story only) or retired.
 * No stored achievement state; re-derivation lives in the verdict artifact.
 */
export interface Story {
	/** Unique identifier within this goal's story set. */
	id: string;
	/** WHAT statement — the slice of the objective this story represents. */
	story: string;
	/** >=1 acceptance criteria; structural fence — ingestion refuses empty arrays. */
	acceptance_criteria: string[];
	/** How this story's completion will be verified. */
	verification_surface: string;
	/** Lifecycle status. `confirmed` writable ONLY by confirm-story (and --single carve-out). */
	status: StoryStatus;
	/**
	 * What was observed that forces this mid-flight mutation. Written ONLY by the
	 * steering mutations (add-story/revise-story/retire-story) — absent on stories
	 * created during planning (set-stories/set-stories --single), which have no
	 * steering event to record (ADR D-11).
	 */
	steering_evidence?: string;
	/** Why this mutation is the right response to `steering_evidence`. Same writers as above. */
	steering_rationale?: string;
}
const DEFAULT_MAX_ITERATIONS = 10;

export interface GoalState {
	// --- 4 content slots ---
	outcome: string;
	verification_surface: string;
	constraints: string;
	boundaries: string;
	// --- 2 loop-control slots ---
	/** From the iteration-policy slot. Finite cap on pursuit blocks. */
	max_iterations: number;
	/** Blocked-stop predicate text (objective-specific). */
	blocked_stop: string;
	// --- FSM / control ---
	phase: GoalPhase;
	/** Pursuit-block counter; single writer is decision.ts. Base 0 here. */
	iteration: number;
	/** Local ISO-8601 without milliseconds, seeded once. */
	started_at: string;
	active: boolean;
	/** Written ONLY by set-verdict. Unset reads as 'absent'. */
	objective_verdict: ObjectiveVerdict;
	plan_path: string;
	resume_summary: string;
	budget_limit_notified: boolean;
	blocked_reason: string;
	completion_evidence_paths: string[];
	/** Present-but-unused placeholder; no migration logic. */
	schema_version: number;
	/** Refreshed on every write (heartbeat). Used by the GC liveness check. */
	last_touched_at: string;
	/**
	 * WHAT-slices of the objective. Defined during planning, tracked through completion.
	 * Absent field reads as [] (backward-compatible). Writers: setStories, setSingleStory,
	 * addStory, reviseStory, confirmStory, retireStory. No hook or merge-write path
	 * touches these directly.
	 */
	stories?: Story[];
}

// ---------------------------------------------------------------------------
// IO helpers (safe read, no import from hooks/)
// ---------------------------------------------------------------------------

function readFileOrNull(path: string): string | null {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return null;
	}
}

/** True iff `value` is a non-null, non-array object (i.e. a JSON "object"). */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True iff `err` is an Error-shaped value carrying a Node.js `code` field. */
function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
	return typeof err === "object" && err !== null && "code" in err;
}

/** Type guard: true iff `value` is a string appearing in `options`; narrows to the literal union of `options`. */
function isOneOf<T extends readonly string[]>(value: unknown, options: T): value is T[number] {
	return typeof value === "string" && options.includes(value);
}

// ---------------------------------------------------------------------------
// Path resolution — identical dir resolution as prometheus-state
// ---------------------------------------------------------------------------

export function resolveStatePath(sessionId: string): string {
	return `${getOmtDir()}/ultragoal-state-${sessionId}.json`;
}

// ---------------------------------------------------------------------------
// started_at seeding — spawns shell date to match the BSD-parseable format
// ---------------------------------------------------------------------------

function seedStartedAt(): string {
	try {
		const result = execSync('date -Iseconds 2>/dev/null || date +"%Y-%m-%dT%H:%M:%S"', {
			encoding: "utf8",
			shell: "/bin/sh",
		});
		return result.trim();
	} catch {
		const d = new Date();
		const pad = (n: number) => String(n).padStart(2, "0");
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
	}
}

function normalize(s: string): string {
	// Loop rather than a /[\x00-\x1F]/ regex (no-control-regex) — same UTF-16-code-unit
	// replacement semantics as the regex it replaces.
	let result = "";
	for (let i = 0; i < s.length; i++) {
		result += s.charCodeAt(i) <= 0x1f ? " " : s[i];
	}
	return result;
}

// ---------------------------------------------------------------------------
// Internal: read prior state (raw, regardless of active), null on malformed
// ---------------------------------------------------------------------------

function readPrior(sessionId: string): Partial<GoalState> {
	const content = readFileOrNull(resolveStatePath(sessionId));
	if (!content) return {};
	try {
		// JSON.parse's return type is already `any`; assigning it to the declared
		// `Partial<GoalState>` return type needs no assertion.
		return JSON.parse(content);
	} catch {
		return {};
	}
}

/**
 * Merge `next` over the prior on-disk state, seeding `started_at` once and
 * supplying field defaults on first write. Persists and returns the result.
 *
 * ADR-7 (strict no-create): refuses and exits non-zero when the state file is
 * absent. The PreToolUse seed is the ONLY creator of state files.
 */
function mergeWrite(sessionId: string, next: Partial<GoalState>): GoalState {
	// Self-heal: seed the pristine skeleton if the PreToolUse hook never fired
	// (e.g. slash-command entry). No-op when the file already exists, so real
	// work is never clobbered; the strict writeFileNoCreate below is unchanged.
	ensureSeed("ultragoal", sessionId);
	const stateFilePath = resolveStatePath(sessionId);
	const prior = readPrior(sessionId);
	// `??` rejects only null/undefined; a corrupt on-disk max_iterations (e.g. a string or
	// a fractional/<1 value) would otherwise survive uncoerced and defeat the hook's
	// `iteration >= max_iterations` budget comparison. Fall back to DEFAULT when the
	// candidate is not a positive integer.
	const maxItCandidate = next.max_iterations ?? prior.max_iterations;
	const partial: Omit<GoalState, "last_touched_at"> = {
		outcome: next.outcome ?? prior.outcome ?? "",
		verification_surface: next.verification_surface ?? prior.verification_surface ?? "",
		constraints: next.constraints ?? prior.constraints ?? "",
		boundaries: next.boundaries ?? prior.boundaries ?? "",
		max_iterations:
			typeof maxItCandidate === "number" && Number.isInteger(maxItCandidate) && maxItCandidate >= 1
				? maxItCandidate
				: DEFAULT_MAX_ITERATIONS,
		blocked_stop: next.blocked_stop ?? prior.blocked_stop ?? "",
		phase: next.phase ?? prior.phase ?? "planning",
		iteration: next.iteration ?? prior.iteration ?? 0,
		started_at: prior.started_at ?? seedStartedAt(),
		active: next.active ?? prior.active ?? true,
		objective_verdict: next.objective_verdict ?? prior.objective_verdict ?? "absent",
		plan_path: next.plan_path ?? prior.plan_path ?? "",
		resume_summary: normalize(next.resume_summary ?? prior.resume_summary ?? ""),
		budget_limit_notified: next.budget_limit_notified ?? prior.budget_limit_notified ?? false,
		blocked_reason: next.blocked_reason ?? prior.blocked_reason ?? "",
		completion_evidence_paths:
			next.completion_evidence_paths ?? prior.completion_evidence_paths ?? [],
		schema_version: next.schema_version ?? prior.schema_version ?? 1,
		// D-5 pinned hazard: stories MUST be enumerated here or silently dropped on every
		// non-story write. Writers: setStories, setSingleStory, addStory, reviseStory,
		// confirmStory, retireStory.
		stories: next.stories ?? prior.stories ?? [],
	};
	const state: GoalState = mergeWithHeartbeat(partial, {});
	try {
		writeFileNoCreate(stateFilePath, JSON.stringify(state, null, 2));
	} catch (err) {
		if (isErrnoException(err) && err.code === "ENOENT") {
			throw new Error(
				`ultragoal-state: state file absent for session "${sessionId}". ` +
					`Possible causes: state adopted by another session, or seed missing. ` +
					`Re-invoke the ultragoal skill to re-seed.`,
				{ cause: err },
			);
		}
		throw err;
	}
	return state;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function readGoalState(sessionId: string): GoalState | null {
	const content = readFileOrNull(resolveStatePath(sessionId));
	if (!content) return null;
	try {
		// JSON.parse's return type is already `any`; the field-by-field schema guard below
		// performs the actual validation, so no assertion to GoalState is needed here.
		const state = JSON.parse(content);
		// Schema guard: mirrors readGoalStateRaw in hooks/persistent-mode/state.ts so the
		// two readers never disagree on whether a goal is active (finding A-4). Validate the
		// load-bearing fields BEFORE the active-fold; a corrupt file (e.g. active:"true",
		// iteration:-1, phase:"pursuit") reads as null, not as a live active goal.
		const VALID_PHASES: string[] = [
			"planning",
			"pursuing",
			"budget_limited",
			"blocked",
			"complete",
		];
		if (
			typeof state.active !== "boolean" ||
			!VALID_PHASES.includes(state.phase) ||
			!Number.isInteger(state.iteration) ||
			state.iteration < 0 ||
			!Number.isInteger(state.max_iterations) ||
			state.max_iterations < 1
		) {
			return null;
		}
		return state.active ? state : null;
	} catch {
		return null;
	}
}

/**
 * Returns the active goal state augmented with a computed `pristine` boolean,
 * or null when no active state exists.
 *
 * `pristine: true` means the state was freshly seeded and no real work has been
 * recorded yet (phase=planning, iteration=0, outcome=''). This lets the SKILL.md
 * Entry Gate distinguish this invocation's own PreToolUse seed from a real
 * in-flight pursuit seeded by a prior invocation.
 */
export function readGoalGet(sessionId: string): (GoalState & { pristine: boolean }) | null {
	const state = readGoalState(sessionId);
	if (state === null) return null;
	// Fresh object literal (via spread) satisfies Record<string, unknown> structurally —
	// no assertion needed, unlike casting the already-typed `state` reference directly.
	const stateAsRecord: Record<string, unknown> = { ...state };
	const pristine = isPristine("ultragoal", stateAsRecord);
	// Default stories to [] when absent (backward-compatible with pre-story states)
	return { ...state, stories: state.stories ?? [], pristine };
}

/**
 * status derives 1:1 from phase — the status token IS the phase token.
 */
export function deriveStatus(state: Pick<GoalState, "phase">): GoalPhase {
	return state.phase;
}

export interface SetGoalOpts {
	/**
	 * Raw untrusted phase string (CLI/caller-supplied). `setGoalState` is the runtime
	 * validator — it narrows this to `GoalPhase` via the SETTABLE_PHASES guard below and
	 * throws (with the original string preserved in the message) when it isn't planning|pursuing.
	 */
	phase: string;
	outcome?: string;
	verification_surface?: string;
	constraints?: string;
	boundaries?: string;
	max_iterations?: number;
	blocked_stop?: string;
	plan_path?: string;
	resume_summary?: string;
	completion_evidence_paths?: string[];
}

/**
 * Orchestrator-authority set. Accepts ONLY planning|pursuing — it can never
 * write phase=complete (that is request-complete-only) and never writes
 * objective_verdict. On phase=planning, three stale-state resets fire so a new
 * objective never inherits a prior objective's state:
 *   - objective_verdict is reset to 'absent' so a stale APPROVE cannot survive a
 *     re-plan;
 *   - completion_evidence_paths is reset to [] on EVERY planning transition —
 *     evidence is only ever valid from the current pursuit's completion audit
 *     (recorded fresh during the pursuing phase), never carried across planning;
 *   - iteration is reset to 0 ONLY for a FRESH goal (no active prior). A re-plan
 *     loop-back of the SAME active goal preserves iteration — budget accumulates
 *     across re-plans.
 */
export function setGoalState(sessionId: string, opts: SetGoalOpts): void {
	// Runtime-validated narrowing: opts.phase is `string` in the type until this guard
	// passes, after which it is narrowed to GoalPhase (SETTABLE_PHASES' element type) for
	// the rest of the function.
	if (!isOneOf(opts.phase, SETTABLE_PHASES)) {
		throw new Error(
			`set: phase must be one of ${SETTABLE_PHASES.join("|")} (got "${opts.phase}"). ` +
				`complete is request-complete-only; budget_limited/blocked are system-only.`,
		);
	}
	// Pursuing gate (D-8 / AC-2a): refused while any story is unconfirmed.
	// An empty stories[] does NOT block pursuing (story definition is mandated by prose).
	if (opts.phase === "pursuing") {
		const prior = readPrior(sessionId);
		const stories: Story[] = prior.stories ?? [];
		const unconfirmed = stories.filter((s) => s.status === "unconfirmed").map((s) => s.id);
		if (unconfirmed.length > 0) {
			throw new Error(
				`set: pursuing refused — ${unconfirmed.length} unconfirmed ${unconfirmed.length === 1 ? "story" : "stories"}: ${unconfirmed.join(", ")}`,
			);
		}
		// WHAT-freeze (ADR D-6): outcome and verification_surface are the two named,
		// typed CLI params that define the objective. Once pursuing has begun, a
		// documented and reachable rewrite of either must not silently redefine the
		// WHAT mid-pursuit — re-plan (phase=planning) is the only legitimate path to
		// change them. This does not touch completion_evidence_paths or any other
		// slot: request-complete depends on --completion-evidence staying writable
		// while pursuing.
		if (opts.outcome !== undefined) {
			throw new Error(
				"set: pursuing refused — outcome is frozen once pursuit has begun. Re-plan first (set --phase planning) to change it.",
			);
		}
		if (opts.verification_surface !== undefined) {
			throw new Error(
				"set: pursuing refused — verification_surface is frozen once pursuit has begun. Re-plan first (set --phase planning) to change it.",
			);
		}
	}
	const next: Partial<GoalState> = {
		phase: opts.phase,
		active: true,
		outcome: opts.outcome,
		verification_surface: opts.verification_surface,
		constraints: opts.constraints,
		boundaries: opts.boundaries,
		max_iterations: opts.max_iterations,
		blocked_stop: opts.blocked_stop,
		plan_path: opts.plan_path,
		resume_summary: opts.resume_summary,
		completion_evidence_paths: opts.completion_evidence_paths,
	};
	if (opts.phase === "planning") {
		// ADR-3: Stale verdict cannot survive a re-plan. Three verdict carriers must all be
		// invalidated together:
		//   1. objective_verdict state field → reset to 'absent'
		//   2. completion_evidence_paths state field → cleared to []
		//   3. ultragoal-verdict-{sid}.json artifact on disk → deleted
		// Clearing (1) and (2) without deleting (3) allows requestComplete to read the old
		// artifact and false-complete a new objective on a prior objective's evidence.
		next.objective_verdict = "absent";
		// Stale completion evidence cannot survive ANY planning transition — evidence is only
		// ever valid from the current pursuit's completion audit, recorded fresh during the
		// `pursuing` phase right before completing. A new objective must never complete on a
		// prior objective's evidence.
		next.completion_evidence_paths = [];
		// Delete the on-disk verdict artifact. ENOENT is ignored (no artifact = already clean).
		// Fail-open: if deletion fails for any other reason, the re-plan still proceeds;
		// the subsequent requestComplete will find an artifact with mismatched state and refuse.
		try {
			unlinkSync(resolveVerdictArtifactPath(sessionId));
		} catch {
			// ignore — ENOENT (no artifact) and other transient I/O errors are both safe to skip
		}
		// D-4: the code-review lane artifact must not survive a re-plan either (same ADR-3
		// stale-vector — a prior objective's clean code-review must not false-complete a new
		// objective). Error policy mirrors the ultragoal-verdict unlink above exactly.
		try {
			unlinkSync(resolveCodeReviewArtifactPath(sessionId));
		} catch {
			// ignore — ENOENT (no artifact) and other transient I/O errors are both safe to skip
		}
		// A FRESH goal (no active prior) must not inherit the dead goal's consumed iteration
		// budget; a re-plan loop-back of the SAME active goal MUST (budget accumulates across
		// re-plans). readGoalState returns non-null ONLY for an active prior → re-plan.
		if (!readGoalState(sessionId)) {
			next.iteration = 0;
		}
	}
	mergeWrite(sessionId, next);
}

/** Verdict-layer authority — the ONLY writer of objective_verdict. */
export function setVerdict(sessionId: string, verdict: ObjectiveVerdict): void {
	mergeWrite(sessionId, { objective_verdict: verdict });
}

/** System-only terminal setter — never writes phase=complete. */
export function setBudgetLimited(sessionId: string): void {
	mergeWrite(sessionId, {
		phase: "budget_limited",
		active: false,
		budget_limit_notified: true,
	});
}

/** System-only terminal setter — never writes phase=complete. */
export function setBlocked(sessionId: string, reason: string): void {
	mergeWrite(sessionId, {
		phase: "blocked",
		active: false,
		blocked_reason: normalize(reason),
	});
}

/**
 * Validates a single story's structural fields (>=1 AC, non-empty verification_surface).
 * Shared between setStories (bulk ingestion) and addStory (per-story add).
 * Throws on violation; caller provides the context label for the error message.
 */
function validateStoryFields(s: Story, label: string): void {
	if (typeof s.id !== "string" || s.id.trim() === "") {
		throw new Error(`${label}: refused — story is missing a non-empty id`);
	}
	if (!Array.isArray(s.acceptance_criteria) || s.acceptance_criteria.length === 0) {
		throw new Error(`${label}: refused — story "${s.id}" has no acceptance criteria`);
	}
	if (!s.verification_surface || s.verification_surface.trim() === "") {
		throw new Error(`${label}: refused — story "${s.id}" is missing verification_surface`);
	}
}

/**
 * Enforces the two-field steering justification required by every mid-flight
 * story mutation (add-story/revise-story/retire-story). `evidence` is what was
 * observed that forces the change; `rationale` is why this change is the right
 * response. Both are forcing functions, not data collection — no default value
 * is supplied anywhere, and an omitted or whitespace-only value is a hard
 * refusal (same `.trim() === ""` idiom used elsewhere in this file).
 */
function requireSteeringReason(label: string, evidence: string, rationale: string): void {
	if (evidence.trim() === "") {
		throw new Error(
			`${label}: refused — --evidence is required (what was observed that forces this change)`,
		);
	}
	if (rationale.trim() === "") {
		throw new Error(
			`${label}: refused — --rationale is required (why this change is the right response)`,
		);
	}
}

/**
 * Validates and persists a story set. Full-replace semantics: every story starts
 * `unconfirmed`. Refuses when:
 *   - phase !== 'planning'
 *   - outcome is empty
 *   - array is empty
 *   - any story lacks >=1 AC
 *   - any story lacks verification_surface
 *   - duplicate ids within the set
 * All refusals: throws (exit 1 at CLI boundary), state file unchanged.
 */
export function setStories(sessionId: string, stories: Story[]): void {
	const prior = readPrior(sessionId);
	if ((prior.phase ?? "planning") !== "planning") {
		throw new Error(`set-stories: refused — phase must be 'planning' (got "${prior.phase}")`);
	}
	if (!prior.outcome || prior.outcome.trim() === "") {
		throw new Error("set-stories: refused — outcome must be set before ingesting stories");
	}
	if (stories.length === 0) {
		throw new Error("set-stories: refused — story set must not be empty");
	}
	const seenIds = new Set<string>();
	for (const s of stories) {
		validateStoryFields(s, "set-stories");
		if (seenIds.has(s.id)) {
			throw new Error(`set-stories: refused — duplicate story id "${s.id}"`);
		}
		seenIds.add(s.id);
	}
	// Normalize: force every status to unconfirmed (full-replace semantics, D-6).
	// Strip steering provenance (ADR D-11): steering_evidence/steering_rationale are written
	// ONLY by the three steering mutations. A re-plan that re-ingests a set copied from `get`
	// carries these keys on the spread; drop them so a planning-created story can never
	// present fabricated mid-flight evidence.
	const normalized: Story[] = stories.map((s): Story => {
		const { steering_evidence: _se, steering_rationale: _sr, ...rest } = s;
		return { ...rest, status: "unconfirmed" };
	});
	mergeWrite(sessionId, { stories: normalized });
}

/**
 * Reorders the stored story array to `orderedIds` — array order only, no status or
 * field changes. Mirrors set-stories' phase guard (planning-only): once pursuing has
 * begun, sequential dispatch order is frozen — re-plan first (set --phase planning) to
 * reorder. Refuses unless `orderedIds` is an EXACT permutation of the current story ids
 * (same set, same length, no duplicates) — a partial or padded list would silently drop
 * or duplicate a story in the sequential dispatch order.
 */
export function reorderStories(sessionId: string, orderedIds: string[]): void {
	const prior = readPrior(sessionId);
	if ((prior.phase ?? "planning") !== "planning") {
		throw new Error(
			`reorder-stories: refused — phase must be 'planning' (got "${prior.phase}")`,
		);
	}
	const stories: Story[] = prior.stories ?? [];
	if (orderedIds.length !== stories.length) {
		throw new Error(
			`reorder-stories: refused — --order must list exactly the ${stories.length} current story id(s) (got ${orderedIds.length})`,
		);
	}
	// Single pass: duplicate-check + known-id lookup together prove "same set, same
	// length, no duplicates" combined with the length check above — i.e. an exact
	// permutation — without a non-null assertion on the Map lookup.
	const seen = new Set<string>();
	const byId = new Map(stories.map((s): [string, Story] => [s.id, s]));
	const reordered: Story[] = [];
	for (const id of orderedIds) {
		if (seen.has(id)) {
			throw new Error(`reorder-stories: refused — duplicate story id "${id}" in --order`);
		}
		seen.add(id);
		const story = byId.get(id);
		if (story === undefined) {
			throw new Error(`reorder-stories: refused — unknown story id "${id}" in --order`);
		}
		reordered.push(story);
	}
	mergeWrite(sessionId, { stories: reordered });
}

/**
 * Appends one new story. The incoming status must be `unconfirmed` (or absent — it is
 * forced to `unconfirmed` regardless). No mutation may produce `confirmed` (D-9).
 * Validates same per-story schema as setStories (>=1 AC, verification_surface, unique id).
 * Allowed in both `planning` and `pursuing` phases.
 * `evidence`/`rationale` are the steering justification (ADR D-4) — required, no default;
 * recorded onto the new story as `steering_evidence`/`steering_rationale`.
 * Refuses on: missing/blank evidence or rationale, out-of-enum status, `confirmed` status,
 * duplicate id, schema violation. All refusals: throws, state unchanged.
 */
export function addStory(sessionId: string, story: Story, evidence: string, rationale: string): void {
	requireSteeringReason("add-story", evidence, rationale);
	const prior = readPrior(sessionId);
	const existing: Story[] = prior.stories ?? [];

	if (!prior.outcome || prior.outcome.trim() === "") {
		throw new Error("add-story: refused — outcome must be set before adding stories");
	}

	// No mutation may produce confirmed (D-9) or out-of-enum status
	const VALID_STATUSES: StoryStatus[] = ["unconfirmed", "confirmed", "retired"];
	if (story.status !== undefined && !VALID_STATUSES.includes(story.status)) {
		throw new Error(`add-story: refused — invalid status "${story.status}"`);
	}
	if (story.status === "confirmed") {
		throw new Error(
			`add-story: refused — mutations cannot produce confirmed status (use confirm-story)`,
		);
	}

	// Structural validation (same as ingestion)
	validateStoryFields(story, "add-story");

	// Uniqueness check
	if (existing.some((s) => s.id === story.id)) {
		throw new Error(`add-story: refused — story id "${story.id}" already exists`);
	}

	// Force status to unconfirmed regardless of what was passed
	const normalized: Story = {
		...story,
		status: "unconfirmed",
		steering_evidence: evidence,
		steering_rationale: rationale,
	};
	mergeWrite(sessionId, { stories: [...existing, normalized] });
}

/**
 * Patches the content fields of an existing story (text/AC/surface).
 * ALWAYS resets status to `unconfirmed` — a changed story must be re-confirmed.
 * No mutation may produce `confirmed` or any value outside the enum (D-9).
 * `evidence`/`rationale` are the steering justification (ADR D-4) — required, no default;
 * recorded onto the patched story as `steering_evidence`/`steering_rationale`.
 * Refuses on: missing/blank evidence or rationale, retired story (no resurrect-via-revise),
 * unknown id, out-of-enum status in the patch, `confirmed` in the patch.
 * All refusals: throws, state unchanged.
 */
export function reviseStory(
	sessionId: string,
	storyId: string,
	patch: Partial<Story>,
	evidence: string,
	rationale: string,
): void {
	requireSteeringReason("revise-story", evidence, rationale);
	const prior = readPrior(sessionId);
	const stories: Story[] = prior.stories ?? [];
	const idx = stories.findIndex((s) => s.id === storyId);

	if (idx === -1) {
		throw new Error(`revise-story: unknown story id "${storyId}"`);
	}
	if (stories[idx].status === "retired") {
		throw new Error(
			`revise-story: refused — story "${storyId}" is retired (no resurrect-via-revise)`,
		);
	}

	// id collision guard: patch.id must not collide with a different existing story
	if (patch.id !== undefined && patch.id !== storyId && stories.some((s) => s.id === patch.id)) {
		throw new Error(`revise-story: refused — story id "${patch.id}" already exists`);
	}

	// No mutation may produce confirmed or out-of-enum status (D-9)
	const VALID_STATUSES: StoryStatus[] = ["unconfirmed", "confirmed", "retired"];
	if (patch.status !== undefined) {
		if (!VALID_STATUSES.includes(patch.status)) {
			throw new Error(`revise-story: refused — invalid status "${patch.status}"`);
		}
		if (patch.status === "confirmed") {
			throw new Error(
				`revise-story: refused — mutations cannot produce confirmed status (use confirm-story)`,
			);
		}
	}

	// Apply the patch but ALWAYS reset status to unconfirmed
	const updated: Story = {
		...stories[idx],
		...patch,
		status: "unconfirmed",
		steering_evidence: evidence,
		steering_rationale: rationale,
	};

	// Validate structural fields after applying the patch
	validateStoryFields(updated, "revise-story");

	const updatedStories = stories.map((s, i) => (i === idx ? updated : s));
	mergeWrite(sessionId, { stories: updatedStories });
}

/**
 * Sets a story's status to `retired`. Anti-dodge fence (D-9):
 *   - `unconfirmed` story → retirable in any phase
 *   - `confirmed` story → retirable ONLY while `phase=planning`
 *     (retiring confirmed mid-pursuit would bypass the T4 verdict gate)
 * `evidence`/`rationale` are the steering justification (ADR D-4) — required, no default;
 * recorded onto the retired story as `steering_evidence`/`steering_rationale`. Checked
 * BEFORE the anti-dodge fence below, but supplying both never bypasses that fence — it
 * only gates whether the fence is even reached.
 * Refuses on: missing/blank evidence or rationale, unknown id, already retired (no-op
 *   would hide bugs — be explicit), confirmed+pursuing combination.
 * All refusals: throws, state unchanged.
 */
export function retireStory(sessionId: string, storyId: string, evidence: string, rationale: string): void {
	requireSteeringReason("retire-story", evidence, rationale);
	const prior = readPrior(sessionId);
	const stories: Story[] = prior.stories ?? [];
	const idx = stories.findIndex((s) => s.id === storyId);

	if (idx === -1) {
		throw new Error(`retire-story: unknown story id "${storyId}"`);
	}

	const story = stories[idx];
	if (story.status === "retired") {
		throw new Error(`retire-story: refused — story "${storyId}" is already retired`);
	}

	// Anti-dodge fence (D-9): confirmed story is only retirable while planning
	if (story.status === "confirmed" && (prior.phase ?? "planning") === "pursuing") {
		throw new Error(
			`retire-story: refused — confirmed story "${storyId}" cannot be retired during pursuit. ` +
				`Re-plan first (set --phase planning) to retire confirmed stories.`,
		);
	}

	const updatedStories = stories.map((s, i): Story =>
		i === idx
			? { ...s, status: "retired", steering_evidence: evidence, steering_rationale: rationale }
			: s,
	);
	mergeWrite(sessionId, { stories: updatedStories });
}

/**
 * Derives exactly one story from the current state (D-7 named carve-out):
 *   story      = outcome
 *   AC         = [verification_surface]
 *   surface    = verification_surface
 *   id         = 'S1'
 *   status     = 'confirmed'   (carve-out: user already stated this when setting the outcome)
 * Refuses when phase !== 'planning' or outcome is empty.
 */
export function setSingleStory(sessionId: string): void {
	const prior = readPrior(sessionId);
	if ((prior.phase ?? "planning") !== "planning") {
		throw new Error(
			`set-stories --single: refused — phase must be 'planning' (got "${prior.phase}")`,
		);
	}
	if (!prior.outcome || prior.outcome.trim() === "") {
		throw new Error(
			"set-stories --single: refused — outcome must be set before auto-deriving a story",
		);
	}
	const surface = prior.verification_surface ?? "";
	if (surface.trim() === "") {
		throw new Error(
			"set-stories --single: refused — verification_surface must be set before auto-deriving a story",
		);
	}
	const derived: Story = {
		id: "S1",
		story: prior.outcome,
		acceptance_criteria: [surface],
		verification_surface: surface,
		status: "confirmed",
	};
	mergeWrite(sessionId, { stories: [derived] });
}

/**
 * Confirms a story: the ONLY path from `unconfirmed` to `confirmed` (D-8).
 * Refuses with an error when:
 *   - The story id is not found in stories[]
 *   - The story is already `retired`
 * All refusals: throws, state unchanged.
 */
export function confirmStory(sessionId: string, storyId: string): void {
	const prior = readPrior(sessionId);
	const stories: Story[] = prior.stories ?? [];
	const idx = stories.findIndex((s) => s.id === storyId);
	if (idx === -1) {
		throw new Error(`confirm-story: unknown story id "${storyId}"`);
	}
	if (stories[idx].status === "retired") {
		throw new Error(`confirm-story: refused — story "${storyId}" is retired`);
	}
	// Already confirmed is a no-op (idempotent, harmless)
	if (stories[idx].status === "confirmed") {
		return;
	}
	const updated: Story[] = stories.map((s): Story =>
		s.id === storyId ? { ...s, status: "confirmed" } : s,
	);
	mergeWrite(sessionId, { stories: updated });
}

/**
 * Bulk-confirms every currently-unconfirmed story in one call — ultragoal's approve-
 * the-whole-set affordance for an auto-generated story set (vs. goal's per-story
 * confirm-story dialogue). This is confirm-story applied to the whole unconfirmed set,
 * not a new bypass: it is the exact same unconfirmed→confirmed transition (D-8), just
 * batched. Applies confirmStory's per-story rule to every story: a `retired` story is
 * not confirmable and is left untouched (it was never `unconfirmed`, so the batch never
 * reaches it); an already-`confirmed` story is left untouched (idempotent, same as
 * confirmStory). No-op (does not throw) when there are no stories or none are
 * unconfirmed.
 */
export function confirmAllStories(sessionId: string): void {
	const prior = readPrior(sessionId);
	const stories: Story[] = prior.stories ?? [];
	const updated: Story[] = stories.map((s): Story =>
		s.status === "unconfirmed" ? { ...s, status: "confirmed" } : s,
	);
	mergeWrite(sessionId, { stories: updated });
}

// ---------------------------------------------------------------------------
// Verdict artifact types (T4 — read/validate only; authorship is the orchestrator's job)
// ---------------------------------------------------------------------------

interface ArtifactStoryEntry {
	id: string;
	verdict: "APPROVE" | "REQUEST_CHANGES";
	evidence_refs: string[];
}

interface VerdictArtifact {
	objective_verdict: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
	stories: ArtifactStoryEntry[];
	verifier: string;
	at: string;
}

// ---------------------------------------------------------------------------
// Code-review artifact types — the SECOND independent completion lane.
// Mirrors the verdict artifact: read/validate only, authored by a fresh
// code-reviewer agent. The gate keys ONLY on verdict==='CONFIRMED'; `class`
// is a reader-validated, gate-unused informational label.
// ---------------------------------------------------------------------------

interface CodeReviewFinding {
	class: "correctness" | "cleanup" | "requirement-gap";
	verdict: "CONFIRMED" | "PLAUSIBLE";
	ref?: string;
}

interface CodeReviewArtifact {
	status: "COMPLETE" | "INCONCLUSIVE";
	findings: CodeReviewFinding[];
	reviewer: string;
	at: string;
}

/**
 * Derives the verdict artifact path from the session id — mirrors the state
 * path convention (`ultragoal-state-${sid}.json` → `ultragoal-verdict-${sid}.json`).
 * NO path argument accepted (D-11: a path argument would be a steerable gate input).
 */
function resolveVerdictArtifactPath(sessionId: string): string {
	return `${getOmtDir()}/ultragoal-verdict-${sessionId}.json`;
}

/**
 * Type predicate backing readVerdictArtifact — validates the same schema/enum/dup-id
 * rules the prior cast-based implementation checked, without asserting the type.
 * On success, `value` narrows to VerdictArtifact IN PLACE (the original parsed object,
 * with any extra JSON keys intact) rather than a reconstructed copy.
 */
function isVerdictArtifact(value: unknown): value is VerdictArtifact {
	if (!isRecord(value)) return false;
	const VALID_OBJ_VERDICTS = ["APPROVE", "REQUEST_CHANGES", "COMMENT"];
	if (!isOneOf(value["objective_verdict"], VALID_OBJ_VERDICTS)) return false;
	if (!Array.isArray(value["stories"])) return false;
	if (typeof value["verifier"] !== "string") return false;
	if (typeof value["at"] !== "string") return false;
	// Validate each story entry and reject duplicate ids (duplicate id makes the
	// artifact ambiguous — a forged pair [RC, APPROVE] could mask a non-APPROVE verdict
	// via last-wins Map semantics in the caller)
	const VALID_STORY_VERDICTS = ["APPROVE", "REQUEST_CHANGES"];
	const seenIds = new Set<string>();
	for (const entry of value["stories"]) {
		if (!isRecord(entry)) return false;
		const id = entry["id"];
		if (typeof id !== "string") return false;
		if (seenIds.has(id)) return false;
		seenIds.add(id);
		if (!isOneOf(entry["verdict"], VALID_STORY_VERDICTS)) return false;
		if (!Array.isArray(entry["evidence_refs"])) return false;
	}
	return true;
}

/**
 * Reads and validates the verdict artifact. Returns the parsed artifact on
 * success, or null when the file is absent or the schema is invalid.
 * Schema: { objective_verdict, stories: [{id, verdict, evidence_refs[]}], verifier, at }
 * Unknown story ids are not checked here — that belongs in requestComplete.
 */
function readVerdictArtifact(sessionId: string): VerdictArtifact | null {
	const content = readFileOrNull(resolveVerdictArtifactPath(sessionId));
	if (!content) return null;
	let obj: unknown;
	try {
		obj = JSON.parse(content);
	} catch {
		return null;
	}
	return isVerdictArtifact(obj) ? obj : null;
}

/**
 * Derives the code-review artifact path from the session id — mirrors the
 * verdict path convention (`ultragoal-verdict-${sid}.json` → `ultragoal-codereview-${sid}.json`).
 * NO path argument accepted (D-11: a path argument would be a steerable gate input).
 */
function resolveCodeReviewArtifactPath(sessionId: string): string {
	return `${getOmtDir()}/ultragoal-codereview-${sessionId}.json`;
}

/**
 * Type predicate backing readCodeReviewArtifact — validates the same schema/enum rules
 * the prior cast-based implementation checked, without asserting the type. On success,
 * `value` narrows to CodeReviewArtifact IN PLACE (the original parsed object, with any
 * extra JSON keys intact — e.g. a leaked `confidence` key on a finding is still readable
 * off `artifact.findings`, matching the pre-existing pass-through contract relied on by
 * ultragoal-state-codereview-contract.test.ts's raw-key-leak guard).
 */
function isCodeReviewArtifact(value: unknown): value is CodeReviewArtifact {
	if (!isRecord(value)) return false;
	// Required top-level fields
	const VALID_STATUS = ["COMPLETE", "INCONCLUSIVE"];
	if (!isOneOf(value["status"], VALID_STATUS)) return false;
	if (!Array.isArray(value["findings"])) return false;
	const reviewer = value["reviewer"];
	if (typeof reviewer !== "string" || reviewer.length === 0) return false;
	if (typeof value["at"] !== "string") return false;
	// Validate each finding; any enum violation → whole artifact null
	const VALID_CLASSES = ["correctness", "cleanup", "requirement-gap"];
	const VALID_FINDING_VERDICTS = ["CONFIRMED", "PLAUSIBLE"];
	for (const entry of value["findings"]) {
		if (!isRecord(entry)) return false;
		if (!isOneOf(entry["class"], VALID_CLASSES)) return false;
		if (!isOneOf(entry["verdict"], VALID_FINDING_VERDICTS)) return false;
	}
	return true;
}

/**
 * Reads and validates the code-review artifact. Returns the parsed artifact on
 * success, or null when the file is absent or the schema is invalid (never throws).
 * Schema: { status, findings: [{class, verdict, ref?}], reviewer, at } — NO `lane` field
 * (the path already identifies the lane).
 * `reviewer` must be a NON-EMPTY string — one notch stricter than the verdict
 * artifact's verifier string-check, because self-review bias is maximal at the
 * convention boundary (D-5/D-6). Any per-finding enum violation rejects the WHOLE
 * artifact (never-false-complete: a broken reviewer output must degrade toward
 * block, never mask a CONFIRMED finding). `findings: []` is valid and clean.
 */
export function readCodeReviewArtifact(sessionId: string): CodeReviewArtifact | null {
	const content = readFileOrNull(resolveCodeReviewArtifactPath(sessionId));
	if (!content) return null;
	let obj: unknown;
	try {
		obj = JSON.parse(content);
	} catch {
		return null;
	}
	return isCodeReviewArtifact(obj) ? obj : null;
}

/**
 * The ONLY path to phase=complete. Gated: requires `objective_verdict=APPROVE` AND
 * completion-evidence present (existing dual gate), PLUS artifact-backed per-story
 * checks (T4 extension — D-11).
 *
 * Extended refusal branches (each independent):
 *   1. Artifact absent, schema-invalid, or contains duplicate story ids
 *   2. Artifact objective_verdict is not 'APPROVE' (COMMENT also blocks — never-false-complete)
 *   3. Artifact references an unknown story id
 *   4. Artifact missing an entry for any non-retired story (entries for retired ignored)
 *   5. Any non-retired story entry non-APPROVE
 *   6. Any non-retired story unconfirmed
 *   7. Zero non-retired stories
 *   8. Existing dual gate unmet (objective_verdict !== 'APPROVE' or empty evidence)
 *
 * Precedence rule (D-3): one non-APPROVE per-story entry blocks regardless of
 * objective_verdict in state.
 *
 * Returns false (no state change) when any gate is not satisfied. Succeeds even
 * over a prior budget_limited (complete-wins, ADR-7).
 */
export function requestComplete(sessionId: string): boolean {
	const prior = readPrior(sessionId);
	const evidence = Array.isArray(prior.completion_evidence_paths)
		? prior.completion_evidence_paths
		: [];
	// Structural gate: complete requires BOTH a recorded APPROVE verdict AND non-empty
	// evidence. Evidence-only is insufficient — the documented sequence records evidence
	// BEFORE flipping the verdict, so an absent/failed set-verdict must not be able to
	// complete on already-recorded evidence (never-false-complete invariant).
	if (evidence.length === 0 || prior.objective_verdict !== "APPROVE") {
		return false;
	}

	// T4: Story-level artifact gate
	const stories: Story[] = prior.stories ?? [];

	// Gate 6: zero non-retired stories → refuse (completion structurally requires >=1)
	const activeStories = stories.filter((s) => s.status !== "retired");
	if (activeStories.length === 0) {
		return false;
	}

	// Gate 1: artifact must exist and be schema-valid (schema includes duplicate-id rejection)
	const artifact = readVerdictArtifact(sessionId);
	if (artifact === null) {
		return false;
	}

	// Gate 2 (artifact objective_verdict): the artifact is the trust anchor written by
	// the orchestrator directly — its objective_verdict must itself be 'APPROVE'. COMMENT also blocks
	// (never-false-complete invariant). This is independent of the state objective_verdict
	// checked by the dual gate above.
	if (artifact.objective_verdict !== "APPROVE") {
		return false;
	}

	// Gate 3: artifact must not reference unknown story ids
	const knownIds = new Set(stories.map((s) => s.id));
	for (const entry of artifact.stories) {
		if (!knownIds.has(entry.id)) {
			return false;
		}
	}

	// Build a map from story id → artifact entry for O(1) lookup
	const artifactById = new Map<string, ArtifactStoryEntry>();
	for (const entry of artifact.stories) {
		artifactById.set(entry.id, entry);
	}

	for (const story of activeStories) {
		// Gate 5: non-retired story must be confirmed
		if (story.status !== "confirmed") {
			return false;
		}

		// Gate 3: artifact must have an entry for every non-retired story
		const entry = artifactById.get(story.id);
		if (entry === undefined) {
			return false;
		}

		// Gate 4 (+ precedence rule D-3): every non-retired story entry must be APPROVE
		if (entry.verdict !== "APPROVE") {
			return false;
		}
	}

	// Code-review lane (D-3): the SECOND independent refusal lane, reached only after
	// every objective-lane gate above passes — so "both lanes clean" is the completion condition.
	// Absent/invalid artifact → block (never-false-complete: degrade toward block). The
	// gate keys ONLY on verdict==='CONFIRMED' (any class — correctness, cleanup, or requirement-gap); `class`
	// is informational and never branched on.
	const codeReview = readCodeReviewArtifact(sessionId);
	if (codeReview === null) {
		return false;
	}
	// INCONCLUSIVE (D1): the review itself did not finish (timeout/ack-only/BLOCKED/
	// genuinely uncertain) — distinct from a finished review that found CONFIRMED work.
	// Blocks completion without implying a sisyphus re-dispatch is warranted.
	if (codeReview.status === "INCONCLUSIVE") {
		return false;
	}
	if (codeReview.findings.some((f) => f.verdict === "CONFIRMED")) {
		return false;
	}

	mergeWrite(sessionId, { phase: "complete", active: false });
	return true;
}

/**
 * Formats all confirmed stories as a requirements block:
 * one line per story — `[id] story — AC: a1; a2 — verify: surface` — with a
 * trailing newline. Zero confirmed stories (all retired, or none defined yet)
 * fall back to `[outcome] <outcome> — AC: <criterion> — verify: <criterion>`,
 * where criterion is the top-level verification_surface slot when non-empty,
 * else the outcome itself — so the block never goes structurally empty while
 * an outcome exists (an empty block reads as "no AC" to the code-review
 * coverage finder, which then skips requirement-gap detection entirely).
 * An empty outcome has nothing to fall back to, so it still returns "".
 * Feeds the code-review lane's `{REQUIREMENTS}` input (Hop B).
 */
export function serializeRequirements(sessionId: string): string {
	const state = readGoalState(sessionId);
	const stories: Story[] = state?.stories ?? [];
	const confirmed = stories.filter((s) => s.status === "confirmed");
	if (confirmed.length === 0) {
		const outcome = state?.outcome ?? "";
		if (outcome.trim() === "") return "";
		const surface = state?.verification_surface ?? "";
		const criterion = surface.trim() !== "" ? surface : outcome;
		return `[outcome] ${outcome} — AC: ${criterion} — verify: ${criterion}\n`;
	}
	const lines = confirmed.map(
		(s) =>
			`[${s.id}] ${s.story} — AC: ${s.acceptance_criteria.join("; ")} — verify: ${s.verification_surface}`,
	);
	return lines.join("\n") + "\n";
}

/**
 * Placeholder for a Shared Contract field whose sources are all blank. A single
 * literal shared by both writer (this file) and reader (the code-review lane's
 * finder step, T6) — an empty JSON string field would read to the finder as
 * "nothing here to check", silently skipping that input entirely.
 */
export const BACKFILL_MARKER = "(none provided)";

/**
 * Builds the Shared Contract shape — the 4-field JSON the code-review lane's
 * finder step consumes (T6) — from this ultragoal's per-field sources. Mirrors
 * serializeRequirements' never-structurally-empty invariant per field: each
 * field falls back to BACKFILL_MARKER only when every one of its sources is
 * blank; a mixed-empty composite (`description`, `project_context`) keeps
 * whatever non-blank source it has instead of collapsing to the marker.
 *
 * Throws when no active ultragoal state exists for `sessionId` — the CLI
 * dispatch lets this propagate to a non-zero exit, the same failure protocol
 * every other subcommand in `main()` follows.
 */
export function serializeReviewContext(sessionId: string): {
	what_was_implemented: string;
	description: string;
	requirements: string;
	project_context: string;
} {
	const state = readGoalState(sessionId);
	if (state === null) {
		throw new Error(`serialize-review-context: no active ultragoal state for session "${sessionId}"`);
	}

	// readGoalState runtime-checks only active/phase/iteration and returns the raw
	// parsed object, so a malformed state file could carry a missing string field.
	// Coerce each source with `?? ""` before deref — the same defensive posture
	// serializeRequirements takes — rather than crash on `undefined.trim()`.
	const outcome = state.outcome ?? "";
	const resumeSummary = state.resume_summary ?? "";
	const planPath = state.plan_path ?? "";
	const constraints = state.constraints ?? "";
	const boundaries = state.boundaries ?? "";

	const what_was_implemented = outcome.trim() !== "" ? outcome : BACKFILL_MARKER;

	const descriptionSources = [
		resumeSummary,
		planPath.trim() !== "" ? `plan: ${planPath}` : "",
	].filter((s) => s.trim() !== "");
	const description =
		descriptionSources.length > 0 ? descriptionSources.join("\n\n") : BACKFILL_MARKER;

	const requirementsRaw = serializeRequirements(sessionId);
	const requirements = requirementsRaw !== "" ? requirementsRaw : BACKFILL_MARKER;

	const projectContextSources = [constraints, boundaries].filter((s) => s.trim() !== "");
	const project_context =
		projectContextSources.length > 0 ? projectContextSources.join("\n\n") : BACKFILL_MARKER;

	return { what_was_implemented, description, requirements, project_context };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

/**
 * Free-text flags whose value may legitimately begin with "--" (e.g. quoting
 * a CLI flag inside an observation): `--evidence` and `--rationale` only.
 * Listing them here lets parseArgs consume the next token unconditionally
 * instead of guessing from its shape. Every OTHER value-bearing flag in this
 * CLI (phase, verdict, completion-evidence, max-iterations, paths, ids, ...)
 * takes a structured value that never itself starts with "--", so it must
 * keep the conservative shape-guessing consumption below — otherwise a
 * valueless flag immediately followed by another flag would swallow that
 * flag's NAME as a bogus value instead of coercing to boolean `true` (see
 * ultragoal-state.test.ts's "completion-evidence rejects a swallowed flag name").
 */
const FREE_TEXT_VALUE_FLAGS = new Set(["evidence", "rationale"]);

/**
 * Splits argv into flags (`--key value` / `--key` boolean) and positionals, in
 * encounter order. Positionals are collected into an array rather than a single
 * `_subcommand` slot — a raw argv scan for "the first token not starting with
 * --" (the bug this replaces) misreads a later flag's VALUE as a positional
 * once any flag other than the subcommand can carry an argument-like value
 * (e.g. `retire-story --evidence "e" story-1` — the value "e" is not a
 * positional, but a naive scan can't tell). Consuming here, once, is the only
 * correct place to draw that line.
 *
 * A free-text flag (FREE_TEXT_VALUE_FLAGS) always consumes the next token as
 * its value, even if that token starts with "--" — otherwise a free-text
 * value beginning with "--" is silently coerced to boolean `true` (see
 * ultragoal-state.test.ts's "steering reason value may begin with dashes"). Every
 * other flag — including structured value-bearing flags like
 * `--completion-evidence`/`--phase`/`--max-iterations` as well as boolean
 * switches like `--single` — keeps the shape-guessing behavior: the next
 * token is consumed as a value only if it does NOT look like a flag itself.
 * Only when the next token is undefined (flag is the last argv token) does it
 * fall back to boolean `true`, so a genuinely missing value is still caught by
 * callers checking for that.
 */
function parseArgs(args: string[]): { flags: Record<string, string | boolean>; positionals: string[] } {
	const flags: Record<string, string | boolean> = {};
	const positionals: string[] = [];
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg.startsWith("--")) {
			const key = arg.slice(2);
			const next = args[i + 1];
			if (next !== undefined && (FREE_TEXT_VALUE_FLAGS.has(key) || !next.startsWith("--"))) {
				flags[key] = next;
				i++;
			} else {
				flags[key] = true;
			}
		} else {
			positionals.push(arg);
		}
	}
	return { flags, positionals };
}

function str(v: string | boolean | undefined): string | undefined {
	return v !== undefined ? String(v) : undefined;
}

/** Like `str`, but a missing flag or a valueless boolean flag both read as "" —
 * the shape `requireSteeringReason`'s blank check expects, so CLI omission and
 * CLI whitespace collapse to the same rejection path. */
function strFlagOrBlank(v: string | boolean | undefined): string {
	return typeof v === "string" ? v : "";
}

function main(): void {
	const { flags: args, positionals } = parseArgs(process.argv.slice(2));
	const subcommand = positionals[0];
	let sessionId: string;
	try {
		sessionId = resolveSessionIdOrThrow();
	} catch (e) {
		process.stderr.write(`ultragoal-state: ${String(e)}\n`);
		process.exit(1);
	}

	try {
		if (subcommand === "set") {
			// parseArgs coerces a flag supplied WITHOUT a value to boolean true. For these
			// value-bearing flags that is a silent corruption: --max-iterations true →
			// Number(true)===1 (budget collapses to one block); --completion-evidence true →
			// ["true"] (a bogus non-path that satisfies the evidence-presence gate). Reject
			// both before any state mutation.
			if (args["max-iterations"] === true) {
				process.stderr.write("set: --max-iterations requires a value\n");
				process.exit(1);
			}
			if (args["completion-evidence"] === true) {
				process.stderr.write("set: --completion-evidence requires a value\n");
				process.exit(1);
			}
			let maxIter: number | undefined;
			if (args["max-iterations"] !== undefined) {
				const n = Number(args["max-iterations"]);
				if (!Number.isInteger(n) || n < 1) {
					process.stderr.write(
						`set: invalid --max-iterations "${String(args["max-iterations"])}" (positive integer required)\n`,
					);
					process.exit(1);
				}
				maxIter = n;
			}
			// parseArgs collapses repeated --key to the LAST value, so evidence arrives
			// as a single comma-separated value. Absent => undefined so the merge-write
			// preserves prior evidence rather than clobbering it with [].
			const evidence = str(args["completion-evidence"]);
			const completionEvidence =
				evidence !== undefined
					? evidence
							.split(",")
							.map((s) => s.trim())
							.filter(Boolean)
					: undefined;
			setGoalState(sessionId, {
				// Raw untrusted string — setGoalState's SETTABLE_PHASES guard validates it.
				phase: String(args["phase"] ?? ""),
				outcome: str(args["outcome"]),
				verification_surface: str(args["verification-surface"]),
				constraints: str(args["constraints"]),
				boundaries: str(args["boundaries"]),
				max_iterations: maxIter,
				blocked_stop: str(args["blocked-stop"]),
				plan_path: str(args["plan-path"]),
				resume_summary: str(args["resume-summary"]),
				completion_evidence_paths: completionEvidence,
			});
		} else if (subcommand === "set-verdict") {
			const v = String(args["verdict"] ?? "absent");
			const allowed: ObjectiveVerdict[] = ["APPROVE", "REQUEST_CHANGES", "COMMENT", "absent"];
			if (!isOneOf(v, allowed)) {
				process.stderr.write(
					`set-verdict: invalid --verdict "${v}" (one of ${allowed.join("|")})\n`,
				);
				process.exit(1);
			}
			// Recovery device (ultragoal-arming-gap): the persistent-mode Stop hook's ultragoal
			// branch refuses to stop only while phase === "pursuing". SKILL.md instructs the
			// pursuing transition to run AFTER the first story dispatch, so the first story can
			// run unarmed if that step is missed. Detect the miss here and self-heal on the
			// first verdict recording — planning-only fires it once per pursuit and re-plans
			// return to planning, so the sequence self-limits without extra state.
			//
			// readPrior (not readGoalState) — readGoalState folds any active:false state to
			// null, so it can't see phase in a terminal state. Condition is exactly
			// === "planning" — setGoalState always writes active:true, so firing it from a
			// terminal state (complete/blocked/budget_limited) would resurrect a finished goal
			// and defeat the budget/blocked brakes. Routed through setGoalState (not a direct
			// mergeWrite) so the unconfirmed-story pursuing guard still applies.
			const prior = readPrior(sessionId);
			if (prior.phase === "planning") {
				setGoalState(sessionId, { phase: "pursuing" });
				process.stderr.write("set-verdict: phase auto-advanced planning -> pursuing\n");
			}
			setVerdict(sessionId, v);
		} else if (subcommand === "set-budget-limited") {
			setBudgetLimited(sessionId);
		} else if (subcommand === "set-blocked") {
			setBlocked(sessionId, String(args["reason"] ?? ""));
		} else if (subcommand === "request-complete") {
			const ok = requestComplete(sessionId);
			if (!ok) {
				process.stderr.write(
					"request-complete: refused — requires objective_verdict=APPROVE and completion evidence present\n",
				);
				process.exit(1);
			}
		} else if (subcommand === "get") {
			process.stdout.write(JSON.stringify(readGoalGet(sessionId)) + "\n");
		} else if (subcommand === "status") {
			const state = readGoalState(sessionId);
			process.stdout.write((state ? deriveStatus(state) : "absent") + "\n");
		} else if (subcommand === "list-others") {
			const candidates = listOthers("ultragoal");
			for (const c of candidates) {
				const shortSid = c.sid.slice(0, 8);
				process.stdout.write(
					`${shortSid}\t${c.sid}\t${c.purpose}\t${c.startedAt}\t${c.idleSeconds}s\n`,
				);
			}
		} else if (subcommand === "adopt") {
			const srcSid = str(args["src"]);
			if (!srcSid) {
				process.stderr.write("adopt: --src <sid> is required\n");
				process.exit(1);
			}
			adopt("ultragoal", srcSid);
		} else if (subcommand === "confirm-story") {
			// confirm-story takes no other value-bearing flags, so a raw argv scan for the
			// first non-"--" token past the subcommand is still safe here (unlike
			// revise-story/retire-story below, which now carry --evidence/--rationale).
			const rawId = process.argv.slice(3).find((a) => !a.startsWith("--"));
			if (!rawId) {
				process.stderr.write("confirm-story: <id> argument is required\n");
				process.exit(1);
			}
			confirmStory(sessionId, rawId);
		} else if (subcommand === "confirm-all-stories") {
			// Bulk approve: no id argument, no other flags.
			confirmAllStories(sessionId);
		} else if (subcommand === "set-stories") {
			if (args["single"] === true) {
				setSingleStory(sessionId);
			} else {
				const jsonArg = str(args["json"]);
				if (!jsonArg) {
					process.stderr.write("set-stories: --json <array> or --single is required\n");
					process.exit(1);
				}
				let parsed: Story[];
				try {
					parsed = JSON.parse(jsonArg);
					if (!Array.isArray(parsed)) throw new Error("expected JSON array");
				} catch (e) {
					process.stderr.write(`set-stories: invalid JSON — ${String(e)}\n`);
					process.exit(1);
				}
				setStories(sessionId, parsed);
			}
		} else if (subcommand === "reorder-stories") {
			if (args["order"] === true) {
				process.stderr.write("reorder-stories: --order requires a value\n");
				process.exit(1);
			}
			const orderArg = str(args["order"]);
			if (!orderArg) {
				process.stderr.write("reorder-stories: --order <id1,id2,...> is required\n");
				process.exit(1);
			}
			const orderedIds = orderArg
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean);
			reorderStories(sessionId, orderedIds);
		} else if (subcommand === "revise-story") {
			// revise-story <id> --json '<patch>' --evidence <text> --rationale <text>
			// id is positionals[1] — the parsed positional, NOT a raw argv scan (that scan
			// would misread --evidence's VALUE as the id once --evidence takes an argument).
			const rawId = positionals[1];
			if (!rawId) {
				process.stderr.write("revise-story: <id> argument is required\n");
				process.exit(1);
			}
			const jsonArg = str(args["json"]);
			if (!jsonArg) {
				process.stderr.write("revise-story: --json <patch> is required\n");
				process.exit(1);
			}
			let patch: Partial<Story>;
			try {
				patch = JSON.parse(jsonArg);
				if (typeof patch !== "object" || Array.isArray(patch) || patch === null) {
					throw new Error("expected JSON object");
				}
			} catch (e) {
				process.stderr.write(`revise-story: invalid JSON — ${String(e)}\n`);
				process.exit(1);
			}
			reviseStory(
				sessionId,
				rawId,
				patch,
				strFlagOrBlank(args["evidence"]),
				strFlagOrBlank(args["rationale"]),
			);
		} else if (subcommand === "add-story") {
			// add-story --json '<story>' --evidence <text> --rationale <text>
			const jsonArg = str(args["json"]);
			if (!jsonArg) {
				process.stderr.write("add-story: --json <story> is required\n");
				process.exit(1);
			}
			let parsed: Story;
			try {
				parsed = JSON.parse(jsonArg);
				if (typeof parsed !== "object" || Array.isArray(parsed) || parsed === null) {
					throw new Error("expected JSON object");
				}
			} catch (e) {
				process.stderr.write(`add-story: invalid JSON — ${String(e)}\n`);
				process.exit(1);
			}
			addStory(
				sessionId,
				parsed,
				strFlagOrBlank(args["evidence"]),
				strFlagOrBlank(args["rationale"]),
			);
		} else if (subcommand === "retire-story") {
			// retire-story <id> --evidence <text> --rationale <text>
			// id is positionals[1] — see revise-story's comment above for why this must not
			// be a raw argv scan.
			const rawId = positionals[1];
			if (!rawId) {
				process.stderr.write("retire-story: <id> argument is required\n");
				process.exit(1);
			}
			retireStory(
				sessionId,
				rawId,
				strFlagOrBlank(args["evidence"]),
				strFlagOrBlank(args["rationale"]),
			);
		} else if (subcommand === "serialize-requirements") {
			process.stdout.write(serializeRequirements(sessionId));
		} else if (subcommand === "serialize-review-context") {
			process.stdout.write(JSON.stringify(serializeReviewContext(sessionId)) + "\n");
		} else {
			process.stderr.write(
				"Usage: ultragoal-state.ts <set|set-verdict|set-budget-limited|set-blocked|request-complete|get|status|list-others|adopt|set-stories|confirm-story|confirm-all-stories|reorder-stories|revise-story|add-story|retire-story|serialize-requirements|serialize-review-context> [options]\n",
			);
			process.exit(1);
		}
	} catch (e) {
		process.stderr.write(`ultragoal-state: ${String(e)}\n`);
		process.exit(1);
	}
}

if (import.meta.main) {
	main();
}

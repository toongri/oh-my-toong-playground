/**
 * Deep-interview skill state CLI.
 *
 * State file path: ${OMT_DIR}/deep-interview-active-state-${sessionId}.json
 * Session ID: resolved from OMT_SESSION_ID env, falling back to CODEX_THREAD_ID
 * (Codex), via resolveSessionIdOrThrow(); hard-fails when neither is set or the
 * value is unsafe.
 *
 * The seed {active, started_at, last_touched_at} is created either by the
 * Claude PreToolUse hook (hooks/pre-tool-enforcer.sh) on Skill(deep-interview)
 * invocation, or self-healed by ensureSeed() (lib/state-core.ts) via an atomic
 * O_EXCL create when a writer here runs without a seed already present.
 * Adoption only renames an existing file — it never fabricates a seed.
 *
 * Subcommands:
 *   init   [--initial-idea <text>] [--interview-id <id>] [--type greenfield|brownfield]
 *          [--current-phase <phase>] [--threshold <n>] [--codebase-context <text>]
 *          Strict overlay of the rich shape into the EXISTING seed file.
 *   update [--current-phase <phase>] [--current-ambiguity <n>]
 *          [--append-round '<json>'] [--append-ontology-snapshot '<json>']
 *          [--append-round-stdin] [--append-ontology-snapshot-stdin]
 *          [--challenge-mode <name>]
 *          [--append-provenance-item '<json>'] (append one {evidence_id, label} item to evidence_provenance)
 *          [--append-stance <stance>]          (append one stance string to stance_history; ordered, NOT deduped)
 *          [--establish-fact '<json>']         (append one {id, statement, component?} active established_fact)
 *          [--dispute-fact <id>]                (mark an established_fact disputed by id; raises the
 *                                                ambiguity floor +0.10 per unresolved disputed fact on the
 *                                                next --current-ambiguity write, no scorer re-call needed)
 *          Strict-overlay merge refreshing last_touched_at.
 *          Stdin flags (--append-round-stdin / --append-ontology-snapshot-stdin) read
 *          the JSON payload from stdin, avoiding shell-quoting hazards with free text
 *          (apostrophes, double quotes). Use with a quoted-delimiter heredoc in SKILL.md.
 *   set-topology --json '[{"id":"<id>","name":"<name>","status":"active|deferred"}]'
 *          Locks Round 0's confirmed component list into state.topology.components.
 *          Full-replace: every call overwrites the whole list. clarity_scores is ALWAYS
 *          reset to all 6 dimensions null (intent/outcome/scope/constraints/success/context)
 *          — no caller may seed a score through this path (per-component scoring lands
 *          in a later story). `status` defaults to "active" when omitted.
 *   get    Print the state JSON.
 *
 * No sessionId field is ever written (ADR-7, RC3 root-cause fix: sid is
 * derived from the FILENAME only, never from file content).
 */

import { readFileSync, existsSync } from "fs";
import { getOmtDir } from "@lib/omt-dir";
import {
	resolveSessionIdOrThrow,
	mergeWithHeartbeat,
	writeFileNoCreate,
	STATE_PREFIX,
	listOthers,
	adopt,
	ensureSeed,
} from "@lib/state-core";

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

export function resolveStatePath(sessionId: string): string {
	return `${getOmtDir()}/${STATE_PREFIX["deep-interview"]}${sessionId}.json`;
}

// ---------------------------------------------------------------------------
// Internal IO
// ---------------------------------------------------------------------------

/** True iff `value` is a non-null, non-array object (i.e. a JSON "object"). */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRaw(path: string): Record<string, unknown> | null {
	if (!existsSync(path)) return null;
	try {
		const content = readFileSync(path, "utf8");
		const parsed: unknown = JSON.parse(content);
		if (!isRecord(parsed)) return null;
		return parsed;
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Rich state shape (per SKILL.md:72-89, NO sessionId field)
// ---------------------------------------------------------------------------

/**
 * Closed set of provenance labels (D-H: origin→label assignment rule).
 * Each evidence item carries exactly one label recording where it entered.
 */
export type EvidenceProvenanceLabel =
	"[from-code]" | "[from-code][auto-confirmed]" | "[from-research]" | "[from-user]";

/** A single evidence provenance record: one item → one origin label. */
export interface EvidenceProvenanceItem {
	evidence_id: string;
	label: EvidenceProvenanceLabel;
}

/** Round 0 Topology Enumeration Gate: a component is either in-scope (active) or explicitly deferred. */
export type ComponentStatus = "active" | "deferred";

/**
 * Per-component clarity score across the 6 OMT dimensions. All 6 are always
 * present, always scored (no greenfield/brownfield subset) — a dimension with
 * no score yet reads as null, never absent.
 */
export interface ClarityScores {
	intent: number | null;
	outcome: number | null;
	scope: number | null;
	constraints: number | null;
	success: number | null;
	context: number | null;
}

/**
 * A single component enumerated and confirmed at Round 0. clarity_scores starts
 * all-null and is filled in per-dimension by later scoring writes (not this story).
 */
export interface TopologyComponent {
	id: string;
	name: string;
	status: ComponentStatus;
	clarity_scores: ClarityScores;
}

/** The interview's confirmed component topology — the Round 0 Enumeration Gate's output. */
export interface Topology {
	components: TopologyComponent[];
}

/** Caller-supplied shape for locking a component via setTopology — clarity_scores is never caller-supplied. */
export interface TopologyComponentInput {
	id: string;
	name: string;
	status?: ComponentStatus;
}

/**
 * An established fact's disputed lifecycle (topology-floor-evolution Stage 3, Entity
 * lifecycle diagram): active (disputed=false) → disputed (user retracts/contradicts,
 * floor +0.10) → superseded (a replacement fact confirmed, floor pressure released).
 * `superseded_by` holds the replacement fact's id once resolved; null/absent while
 * unresolved. Written exclusively via the `update --establish-fact` / `--dispute-fact`
 * CLI paths (never partial elsewhere).
 */
export interface EstablishedFact {
	id: string;
	statement: string;
	disputed: boolean;
	superseded_by: string | null;
	/** Optional topology component id this fact is about. */
	component?: string;
}

/** Caller-supplied shape for establishing a new fact via `update --establish-fact`. */
export interface EstablishedFactInput {
	id: string;
	statement: string;
	component?: string;
}

export interface DeepInterviewStateContent {
	interview_id?: string;
	type?: "greenfield" | "brownfield";
	initial_idea?: string;
	initial_context_summary?: string | null;
	rounds?: unknown[];
	current_ambiguity?: number;
	threshold?: number;
	codebase_context?: unknown;
	challenge_modes_used?: string[];
	ontology_snapshots?: unknown[];
	/**
	 * Per-evidence provenance tags (D-H). Each entry records the origin label of
	 * one evidence item at the moment it entered the interview.
	 * Distinct from challenge_modes_used: this is evidence-scoped, not stance-scoped.
	 */
	evidence_provenance?: EvidenceProvenanceItem[];
	/**
	 * Ordered stance-history (D-E, Dialectic Rhythm Guard). Records the sequence
	 * of stances selected at round head — ordered, NOT deduplicated. Distinct from
	 * challenge_modes_used which is deduped/unordered and tracks modes ever used.
	 */
	stance_history?: string[];
	/**
	 * The raw ambiguity value as reported by the LLM before floor clamping
	 * (topology-floor-evolution Stage 2). Preserved verbatim so a floor-clamped
	 * write never loses the interviewer's original self-assessment.
	 */
	reported_ambiguity?: number;
	/**
	 * The deterministic floor computed at the moment current_ambiguity was last
	 * written (see computeAmbiguityFloor). current_ambiguity itself always holds
	 * max(reported_ambiguity, ambiguity_floor) — this field exposes the floor term
	 * for transparency/debugging.
	 */
	ambiguity_floor?: number;
	/**
	 * Round 0 Topology Enumeration Gate output (topology-floor-evolution Stage 1).
	 * Absent on states written before this field existed — backward-compatible:
	 * a reader must treat a missing/undefined topology the same as "not yet locked",
	 * never throw. Written exclusively via setTopology (full-replace, never partial).
	 */
	topology?: Topology;
	/**
	 * established_facts disputed lifecycle (topology-floor-evolution Stage 3). Absent on
	 * states written before this field existed — a reader must treat a missing array the
	 * same as "no facts established yet". disputed_count in computeAmbiguityFloor counts
	 * entries where disputed=true and superseded_by is not yet set.
	 */
	established_facts?: EstablishedFact[];
}

export interface DeepInterviewState {
	active?: boolean;
	current_phase?: string;
	started_at?: string;
	last_touched_at?: string;
	state?: DeepInterviewStateContent;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Strict overlay of the rich shape into the EXISTING seeded file.
 * Absent file → throws (ADR-7). Never writes a sessionId field.
 */
export function initDeepInterviewState(
	sessionId: string,
	payload: {
		initial_idea?: string;
		interview_id?: string;
		type?: "greenfield" | "brownfield";
		current_phase?: string;
		threshold?: number;
		codebase_context?: string;
	},
): void {
	// Self-heal: seed the pristine skeleton if the PreToolUse hook never fired
	// (e.g. slash-command entry). No-op when the file already exists.
	ensureSeed("deep-interview", sessionId);
	const path = resolveStatePath(sessionId);
	const prior = readRaw(path);
	if (prior === null) {
		throw new Error(
			`deep-interview-state: no state file found at "${path}". ` +
				"Either the seed is missing (re-invoke the deep-interview skill) " +
				"or this session was adopted by another session.",
		);
	}

	// Build the state object: merge with any existing state content
	const priorState: DeepInterviewStateContent = isRecord(prior["state"])
		? // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- opaque JSON boundary: state file content is written exclusively by this module's own writers (never externally supplied); trusted structural pass-through
			(prior["state"] as DeepInterviewStateContent)
		: {};

	const newState: DeepInterviewStateContent = {
		interview_id: payload.interview_id ?? priorState.interview_id,
		type: payload.type ?? priorState.type,
		initial_idea: payload.initial_idea ?? priorState.initial_idea,
		initial_context_summary: priorState.initial_context_summary ?? null,
		rounds: priorState.rounds ?? [],
		current_ambiguity: priorState.current_ambiguity ?? 1.0,
		threshold: payload.threshold ?? priorState.threshold,
		codebase_context: payload.codebase_context ?? priorState.codebase_context ?? null,
		challenge_modes_used: priorState.challenge_modes_used ?? [],
		ontology_snapshots: priorState.ontology_snapshots ?? [],
		evidence_provenance: priorState.evidence_provenance ?? [],
		stance_history: priorState.stance_history ?? [],
		topology: priorState.topology,
	};

	const priorCurrentPhase =
		typeof prior["current_phase"] === "string" ? prior["current_phase"] : undefined;
	const overlay: Record<string, unknown> = {
		current_phase: payload.current_phase ?? priorCurrentPhase ?? "deep-interview",
		state: newState,
	};

	const next = mergeWithHeartbeat(prior, overlay);
	writeFileNoCreate(path, JSON.stringify(next, null, 2));
}

/**
 * Strict-overlay merge refreshing last_touched_at.
 * Absent file → throws (ADR-7). Never writes a sessionId field.
 *
 * current_ambiguity is nested under state (SKILL.md:93 shape); current_phase
 * lives at the top level alongside active/started_at/last_touched_at.
 *
 * append_round: appended to state.rounds array (one round object per call).
 * append_ontology_snapshot: appended to state.ontology_snapshots array.
 * challenge_mode: appended to state.challenge_modes_used (deduplicated).
 */
export function updateDeepInterviewState(
	sessionId: string,
	partial: {
		current_phase?: string;
		current_ambiguity?: number;
		append_round?: unknown;
		append_ontology_snapshot?: unknown;
		challenge_mode?: string;
		/** Append one provenance record (evidence_id + label) to evidence_provenance. */
		append_provenance_item?: EvidenceProvenanceItem;
		/** Append one stance string to stance_history (ordered, NOT deduped). */
		append_stance?: string;
		/** Append one active established_fact (disputed=false, superseded_by=null). */
		establish_fact?: EstablishedFactInput;
		/** Mark the established_fact with this id disputed=true. Throws if the id is unknown. */
		dispute_fact?: string;
	},
): void {
	// Self-heal: seed the pristine skeleton if the PreToolUse hook never fired
	// (e.g. slash-command entry). No-op when the file already exists.
	ensureSeed("deep-interview", sessionId);
	const path = resolveStatePath(sessionId);
	const prior = readRaw(path);
	if (prior === null) {
		throw new Error(
			`deep-interview-state: no state file found at "${path}". ` +
				"Either the seed is missing (re-invoke the deep-interview skill) " +
				"or this session was adopted by another session.",
		);
	}

	const overlay: Record<string, unknown> = {};
	if (partial.current_phase !== undefined) {
		overlay["current_phase"] = partial.current_phase;
	}

	const needsStateOverlay =
		partial.current_ambiguity !== undefined ||
		partial.append_round !== undefined ||
		partial.append_ontology_snapshot !== undefined ||
		partial.challenge_mode !== undefined ||
		partial.append_provenance_item !== undefined ||
		partial.append_stance !== undefined ||
		partial.establish_fact !== undefined ||
		partial.dispute_fact !== undefined;

	if (needsStateOverlay) {
		// current_ambiguity lives under state per the SKILL.md rich shape
		const priorState: Record<string, unknown> = isRecord(prior["state"]) ? prior["state"] : {};

		const updatedState: Record<string, unknown> = { ...priorState };

		if (partial.current_ambiguity !== undefined) {
			// Deterministic floor clamp (topology-floor-evolution Stage 2): the LLM-reported
			// value alone is never trusted at face value — it is floored against
			// computeAmbiguityFloor(state) before being persisted as current_ambiguity, and
			// the original reported figure is kept verbatim under reported_ambiguity so the
			// clamp is never silently lossy.
			const reported = partial.current_ambiguity;
			// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- opaque JSON boundary: same trusted structural pass-through as other readers in this module
			const stateForCheck = priorState as DeepInterviewStateContent;
			const floor = computeAmbiguityFloor(stateForCheck);
			const effective = Math.max(reported, floor);
			// Fail-closed transition gate (topology-floor-evolution Stage 3): validated BEFORE
			// any assignment to updatedState, so a refusal here never reaches mergeWrite below —
			// the state file stays byte-identical (qa-state.ts:257-269 incCycle idiom).
			validateScoredTransition(stateForCheck, effective);
			updatedState["current_ambiguity"] = effective;
			updatedState["reported_ambiguity"] = reported;
			updatedState["ambiguity_floor"] = floor;
		}
		if (partial.append_round !== undefined) {
			const existing: unknown[] = Array.isArray(priorState["rounds"]) ? priorState["rounds"] : [];
			updatedState["rounds"] = [...existing, partial.append_round];
		}
		if (partial.append_ontology_snapshot !== undefined) {
			const existing: unknown[] = Array.isArray(priorState["ontology_snapshots"])
				? priorState["ontology_snapshots"]
				: [];
			updatedState["ontology_snapshots"] = [...existing, partial.append_ontology_snapshot];
		}
		if (partial.challenge_mode !== undefined) {
			const existing: string[] = Array.isArray(priorState["challenge_modes_used"])
				? priorState["challenge_modes_used"]
				: [];
			if (!existing.includes(partial.challenge_mode)) {
				updatedState["challenge_modes_used"] = [...existing, partial.challenge_mode];
			}
		}
		if (partial.append_provenance_item !== undefined) {
			const existing: EvidenceProvenanceItem[] = Array.isArray(priorState["evidence_provenance"])
				? priorState["evidence_provenance"]
				: [];
			updatedState["evidence_provenance"] = [...existing, partial.append_provenance_item];
		}
		if (partial.append_stance !== undefined) {
			// Ordered, NOT deduplicated — preserves insertion order for Dialectic Rhythm Guard (D-E).
			const existing: string[] = Array.isArray(priorState["stance_history"])
				? priorState["stance_history"]
				: [];
			updatedState["stance_history"] = [...existing, partial.append_stance];
		}
		if (partial.establish_fact !== undefined || partial.dispute_fact !== undefined) {
			// established_facts disputed lifecycle (topology-floor-evolution Stage 3): establish
			// runs before dispute so a single call may do both against the same array.
			let facts: EstablishedFact[] = Array.isArray(priorState["established_facts"])
				? // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- opaque JSON boundary: same trusted structural pass-through as other readers in this module
					(priorState["established_facts"] as EstablishedFact[])
				: [];
			if (partial.establish_fact !== undefined) {
				const input = partial.establish_fact;
				if (facts.some((f) => f.id === input.id)) {
					throw new Error(`update: refused — established_fact id "${input.id}" already exists`);
				}
				facts = [
					...facts,
					{
						id: input.id,
						statement: input.statement,
						disputed: false,
						superseded_by: null,
						component: input.component,
					},
				];
			}
			if (partial.dispute_fact !== undefined) {
				const idx = facts.findIndex((f) => f.id === partial.dispute_fact);
				if (idx === -1) {
					throw new Error(
						`update: refused — dispute-fact: no established_fact with id "${String(partial.dispute_fact)}"`,
					);
				}
				facts = facts.map((f, i) => (i === idx ? { ...f, disputed: true } : f));
			}
			updatedState["established_facts"] = facts;
		}

		overlay["state"] = updatedState;
	}

	const next = mergeWithHeartbeat(prior, overlay);
	writeFileNoCreate(path, JSON.stringify(next, null, 2));
}

/** All 6 OMT dimensions, unscored (Round 0 lock — no caller may seed a score here). */
function nullClarityScores(): ClarityScores {
	return {
		intent: null,
		outcome: null,
		scope: null,
		constraints: null,
		success: null,
		context: null,
	};
}

/** All 6 OMT dimensions in canonical order — shared by clarity_scores and unscored-detection. */
const CLARITY_DIMENSIONS: readonly (keyof ClarityScores)[] = [
	"intent",
	"outcome",
	"scope",
	"constraints",
	"success",
	"context",
];

/**
 * True iff any of the 6 clarity_scores dimensions is null (per spec: a component is
 * "미채점/unscored" the moment even one of its 6 dimensions has no finite score —
 * context is not special, it is just one of the 6).
 */
function isComponentUnscored(scores: ClarityScores): boolean {
	return CLARITY_DIMENSIONS.some((dim) => scores[dim] === null);
}

/**
 * The subset of `established_facts` currently pressuring the ambiguity floor: disputed
 * and not yet superseded. A superseded fact (its dispute resolved by a replacement)
 * releases floor pressure per the Entity lifecycle (active → disputed → superseded).
 */
function activeDisputedFacts(state: DeepInterviewStateContent | undefined | null): EstablishedFact[] {
	const facts = state?.established_facts ?? [];
	return facts.filter((f) => f.disputed === true && !f.superseded_by);
}

/**
 * Deterministic ambiguity floor (topology-floor-evolution Stage 2, disputed term
 * activated in Stage 3):
 *
 *   floor = 0.10 * disputed_count + 0.05 * unscored_component_count + 0.05 * auto_answer_ratio
 *
 * unscored_component_count counts ACTIVE topology components (deferred components are
 * excluded from floor pressure) that have at least one null clarity_scores dimension.
 * disputed_count counts established_facts that are disputed and not yet superseded
 * (activeDisputedFacts) — a user reversal raises this term without any scorer re-call.
 * auto_answer_ratio still reads as 0 — its backing state field (auto_answered_rounds
 * tracking) doesn't exist yet and is out of this story's scope.
 */
export function computeAmbiguityFloor(state: DeepInterviewStateContent | undefined | null): number {
	const components = state?.topology?.components ?? [];
	const unscoredComponentCount = components.filter(
		(c) => c.status === "active" && isComponentUnscored(c.clarity_scores),
	).length;
	const disputedCount = activeDisputedFacts(state).length;
	const autoAnswerRatio = 0; // out of scope for this story: auto_answered_rounds tracking
	return 0.1 * disputedCount + 0.05 * unscoredComponentCount + 0.05 * autoAnswerRatio;
}

/**
 * True iff at least one ACTIVE topology component has at least one non-null clarity
 * dimension — i.e. some scoring progress has been claimed (a rise from the unscored
 * baseline in at least one of the 6 dimensions).
 */
function hasScoredClarityDimension(state: DeepInterviewStateContent | undefined | null): boolean {
	const components = state?.topology?.components ?? [];
	return components.some(
		(c) => c.status === "active" && CLARITY_DIMENSIONS.some((dim) => c.clarity_scores[dim] !== null),
	);
}

/**
 * Fail-closed transition gate (topology-floor-evolution Stage 3; qa-state.ts:257-269
 * incCycle's "refuse before any write" idiom, adapted for a two-condition transition):
 * refuses a write that, WHILE an active trigger exists (an unresolved disputed
 * established_fact — see activeDisputedFacts), simultaneously claims BOTH a
 * clarity-dimension improvement (hasScoredClarityDimension) and an ambiguity decrease
 * (effectiveAmbiguity below the currently-stored current_ambiguity). Throws — the
 * caller (updateDeepInterviewState) must call this BEFORE building the write overlay,
 * so a refusal never reaches mergeWrite/writeFileNoCreate and the state file stays
 * byte-identical (same "validate first, write second" shape as qa-state's incCycle and
 * goal-state's setStories).
 */
export function validateScoredTransition(
	priorState: DeepInterviewStateContent | undefined | null,
	effectiveAmbiguity: number,
): void {
	if (activeDisputedFacts(priorState).length === 0) return;
	const priorAmbiguity = priorState?.current_ambiguity ?? 1.0;
	const ambiguityDropped = effectiveAmbiguity < priorAmbiguity;
	const dimensionImproved = hasScoredClarityDimension(priorState);
	if (ambiguityDropped && dimensionImproved) {
		throw new Error(
			"validateScoredTransition: refused — an unresolved disputed established_fact blocks a write " +
				"that simultaneously claims a clarity-dimension improvement and an ambiguity decrease; " +
				"supersede the disputed fact before converging further",
		);
	}
}

/**
 * Locks Round 0's confirmed component list into state.topology.components.
 * Full-replace semantics — every call overwrites the whole list, matching
 * setStories' full-replace ingestion convention (goal-state.ts). clarity_scores
 * is ALWAYS reset to all 6 dimensions null; no caller may seed a score through
 * this path (per-component scoring is a later write, out of this story's scope).
 * Refuses an empty list, a component missing non-empty id/name, a duplicate id,
 * or an out-of-enum status. Absent file → self-heals via ensureSeed (same idiom
 * as init/update above).
 */
export function setTopology(sessionId: string, components: TopologyComponentInput[]): void {
	if (!Array.isArray(components) || components.length === 0) {
		throw new Error("set-topology: refused — component list must not be empty");
	}
	const seenIds = new Set<string>();
	const built: TopologyComponent[] = components.map((c) => {
		if (typeof c.id !== "string" || c.id.trim() === "") {
			throw new Error("set-topology: refused — component is missing a non-empty id");
		}
		if (seenIds.has(c.id)) {
			throw new Error(`set-topology: refused — duplicate component id "${c.id}"`);
		}
		seenIds.add(c.id);
		if (typeof c.name !== "string" || c.name.trim() === "") {
			throw new Error(`set-topology: refused — component "${c.id}" is missing a non-empty name`);
		}
		const status: ComponentStatus = c.status ?? "active";
		if (status !== "active" && status !== "deferred") {
			throw new Error(
				`set-topology: refused — component "${c.id}" has invalid status "${String(c.status)}"`,
			);
		}
		return { id: c.id, name: c.name, status, clarity_scores: nullClarityScores() };
	});

	ensureSeed("deep-interview", sessionId);
	const path = resolveStatePath(sessionId);
	const prior = readRaw(path);
	if (prior === null) {
		throw new Error(
			`deep-interview-state: no state file found at "${path}". ` +
				"Either the seed is missing (re-invoke the deep-interview skill) " +
				"or this session was adopted by another session.",
		);
	}
	const priorState: DeepInterviewStateContent = isRecord(prior["state"])
		? // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- opaque JSON boundary: state file content is written exclusively by this module's own writers (never externally supplied); trusted structural pass-through
			(prior["state"] as DeepInterviewStateContent)
		: {};
	const newState: DeepInterviewStateContent = { ...priorState, topology: { components: built } };

	const next = mergeWithHeartbeat(prior, { state: newState });
	writeFileNoCreate(path, JSON.stringify(next, null, 2));
}

/**
 * Reads the raw state. Returns null if absent or malformed.
 */
export function readDeepInterviewState(sessionId: string): Record<string, unknown> | null {
	return readRaw(resolveStatePath(sessionId));
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function parseArgs(args: string[]): Record<string, string | boolean> {
	const result: Record<string, string | boolean> = {};
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg.startsWith("--")) {
			const key = arg.slice(2);
			const next = args[i + 1];
			if (next !== undefined && !next.startsWith("--")) {
				result[key] = next;
				i++;
			} else {
				result[key] = true;
			}
		} else if (!result["_subcommand"]) {
			// First non-flag token = subcommand; subsequent positional args are ignored
			// (A3: no positional arg may redirect the filename)
			result["_subcommand"] = arg;
		}
		// Subsequent positional args after subcommand are silently dropped (A3)
	}
	return result;
}

function str(v: string | boolean | undefined): string | undefined {
	return v !== undefined && v !== true ? String(v) : undefined;
}

function asInterviewType(v: string | undefined): "greenfield" | "brownfield" | undefined {
	return v === "greenfield" || v === "brownfield" ? v : undefined;
}

function main(): void {
	let sessionId: string;
	try {
		sessionId = resolveSessionIdOrThrow();
	} catch (e) {
		process.stderr.write(`deep-interview-state: ${String(e)}\n`);
		process.exit(1);
	}

	const args = parseArgs(process.argv.slice(2));
	const subcommand = args["_subcommand"];

	if (subcommand === "init") {
		const threshold = str(args["threshold"]);
		try {
			initDeepInterviewState(sessionId, {
				initial_idea: str(args["initial-idea"]),
				interview_id: str(args["interview-id"]),
				type: asInterviewType(str(args["type"])),
				current_phase: str(args["current-phase"]),
				threshold: threshold !== undefined ? Number(threshold) : undefined,
				codebase_context: str(args["codebase-context"]),
			});
		} catch (e) {
			process.stderr.write(`deep-interview-state init: ${String(e)}\n`);
			process.exit(1);
		}
	} else if (subcommand === "update") {
		const ambiguity = str(args["current-ambiguity"]);
		const appendRoundRaw = str(args["append-round"]);
		const appendSnapshotRaw = str(args["append-ontology-snapshot"]);
		const appendRoundStdin = args["append-round-stdin"] === true;
		const appendSnapshotStdin = args["append-ontology-snapshot-stdin"] === true;
		const challengeMode = str(args["challenge-mode"]);
		const appendProvenanceItemRaw = str(args["append-provenance-item"]);
		const appendStance = str(args["append-stance"]);

		// Read stdin once if any stdin flag is present (avoids double-read)
		let stdinText: string | undefined;
		if (appendRoundStdin || appendSnapshotStdin) {
			try {
				stdinText = readFileSync(0, "utf8").trim();
			} catch (e) {
				process.stderr.write(`deep-interview-state update: failed to read stdin: ${String(e)}\n`);
				process.exit(1);
			}
		}

		// Validate JSON flags before any write
		let appendRound: unknown;
		if (appendRoundStdin) {
			if (stdinText === undefined) {
				// Unreachable: appendRoundStdin implies the stdin-read block above ran and either
				// set stdinText or exited the process on failure.
				throw new Error("deep-interview-state update: internal error: stdin was not read");
			}
			try {
				appendRound = JSON.parse(stdinText);
			} catch {
				process.stderr.write(
					`deep-interview-state update: --append-round-stdin: invalid JSON from stdin\n`,
				);
				process.exit(1);
			}
		} else if (appendRoundRaw !== undefined) {
			try {
				appendRound = JSON.parse(appendRoundRaw);
			} catch {
				process.stderr.write(
					`deep-interview-state update: --append-round: invalid JSON: ${appendRoundRaw}\n`,
				);
				process.exit(1);
			}
		}
		let appendSnapshot: unknown;
		if (appendSnapshotStdin) {
			if (stdinText === undefined) {
				// Unreachable: appendSnapshotStdin implies the stdin-read block above ran and either
				// set stdinText or exited the process on failure.
				throw new Error("deep-interview-state update: internal error: stdin was not read");
			}
			try {
				appendSnapshot = JSON.parse(stdinText);
			} catch {
				process.stderr.write(
					`deep-interview-state update: --append-ontology-snapshot-stdin: invalid JSON from stdin\n`,
				);
				process.exit(1);
			}
		} else if (appendSnapshotRaw !== undefined) {
			try {
				appendSnapshot = JSON.parse(appendSnapshotRaw);
			} catch {
				process.stderr.write(
					`deep-interview-state update: --append-ontology-snapshot: invalid JSON: ${appendSnapshotRaw}\n`,
				);
				process.exit(1);
			}
		}

		let appendProvenanceItem: EvidenceProvenanceItem | undefined;
		if (appendProvenanceItemRaw !== undefined) {
			let parsed: unknown;
			try {
				parsed = JSON.parse(appendProvenanceItemRaw);
			} catch {
				process.stderr.write(
					`deep-interview-state update: --append-provenance-item: invalid JSON: ${appendProvenanceItemRaw}\n`,
				);
				process.exit(1);
			}
			if (
				!isRecord(parsed) ||
				typeof parsed["evidence_id"] !== "string" ||
				typeof parsed["label"] !== "string"
			) {
				process.stderr.write(
					`deep-interview-state update: --append-provenance-item: must be {"evidence_id":"<str>","label":"<label>"}\n`,
				);
				process.exit(1);
			}
			// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- opaque CLI JSON boundary: shape-validated above (evidence_id/label present as strings); the closed label-value set is a documentation-level contract (SKILL.md), not runtime-enforced here, matching prior behavior
			appendProvenanceItem = parsed as unknown as EvidenceProvenanceItem;
		}

		const establishFactRaw = str(args["establish-fact"]);
		let establishFact: EstablishedFactInput | undefined;
		if (establishFactRaw !== undefined) {
			let parsed: unknown;
			try {
				parsed = JSON.parse(establishFactRaw);
			} catch {
				process.stderr.write(
					`deep-interview-state update: --establish-fact: invalid JSON: ${establishFactRaw}\n`,
				);
				process.exit(1);
			}
			if (
				!isRecord(parsed) ||
				typeof parsed["id"] !== "string" ||
				typeof parsed["statement"] !== "string" ||
				(parsed["component"] !== undefined && typeof parsed["component"] !== "string")
			) {
				process.stderr.write(
					`deep-interview-state update: --establish-fact: must be {"id":"<str>","statement":"<str>","component"?:"<str>"}\n`,
				);
				process.exit(1);
			}
			establishFact = {
				id: parsed["id"],
				statement: parsed["statement"],
				component: typeof parsed["component"] === "string" ? parsed["component"] : undefined,
			};
		}
		const disputeFact = str(args["dispute-fact"]);

		try {
			updateDeepInterviewState(sessionId, {
				current_phase: str(args["current-phase"]),
				current_ambiguity: ambiguity !== undefined ? Number(ambiguity) : undefined,
				append_round: appendRound,
				append_ontology_snapshot: appendSnapshot,
				challenge_mode: challengeMode,
				append_provenance_item: appendProvenanceItem,
				append_stance: appendStance,
				establish_fact: establishFact,
				dispute_fact: disputeFact,
			});
		} catch (e) {
			process.stderr.write(`deep-interview-state update: ${String(e)}\n`);
			process.exit(1);
		}
	} else if (subcommand === "set-topology") {
		const jsonArg = str(args["json"]);
		if (!jsonArg) {
			process.stderr.write("set-topology: --json <array> is required\n");
			process.exit(1);
		}
		let parsed: TopologyComponentInput[];
		try {
			parsed = JSON.parse(jsonArg);
			if (!Array.isArray(parsed)) throw new Error("expected JSON array");
		} catch (e) {
			process.stderr.write(`set-topology: invalid JSON — ${String(e)}\n`);
			process.exit(1);
		}
		try {
			setTopology(sessionId, parsed);
		} catch (e) {
			process.stderr.write(`deep-interview-state set-topology: ${String(e)}\n`);
			process.exit(1);
		}
	} else if (subcommand === "get") {
		const result = readDeepInterviewState(sessionId);
		process.stdout.write(JSON.stringify(result, null, 2) + "\n");
	} else if (subcommand === "list-others") {
		const candidates = listOthers("deep-interview");
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
		try {
			adopt("deep-interview", srcSid);
		} catch (e) {
			process.stderr.write(`deep-interview-state adopt: ${String(e)}\n`);
			process.exit(1);
		}
	} else {
		process.stderr.write(
			"Usage: deep-interview-state.ts <init|update|set-topology|get|list-others|adopt> [options]\n" +
				"  init   --initial-idea <text> [--interview-id <id>] [--type greenfield|brownfield]\n" +
				"         [--current-phase <phase>] [--threshold <n>] [--codebase-context <text>]\n" +
				"  update [--current-phase <phase>] [--current-ambiguity <n>]\n" +
				"         [--append-round '<json>'] [--append-ontology-snapshot '<json>']\n" +
				"         [--append-round-stdin]            (recommended for free-text: read JSON from stdin)\n" +
				"         [--append-ontology-snapshot-stdin] (recommended for free-text: read JSON from stdin)\n" +
				"         [--challenge-mode <name>]\n" +
				'         [--append-provenance-item \'{"evidence_id":"<id>","label":"<label>"}\']\n' +
				"         [--append-stance <stance>]  (ordered, not deduped; for Dialectic Rhythm Guard)\n" +
				'         [--establish-fact \'{"id":"<id>","statement":"<text>","component"?:"<comp-id>"}\']\n' +
				"         [--dispute-fact <id>]  (marks an established_fact disputed; raises the ambiguity\n" +
				"                                floor +0.10 on the next --current-ambiguity write)\n" +
				'  set-topology --json \'[{"id":"<id>","name":"<name>","status":"active|deferred"}]\'\n' +
				"  get\n" +
				"  list-others\n" +
				"  adopt --src <sid>\n",
		);
		process.exit(1);
	}
}

if (import.meta.main) {
	main();
}

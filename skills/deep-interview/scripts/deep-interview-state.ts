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
 *          [--establish-fact '<json>']         (append one {id, statement, supersedes?} active
 *                                                established_fact; `supersedes` marks that disputed
 *                                                predecessor superseded, releasing its floor pressure)
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
 *   get    Print the state JSON, plus a derived `migration_status` field
 *          ("legacy_missing" | "current") from computeTopologyMigrationStatus,
 *          so the resume path (get/adopt) can detect a pre-topology state.
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
 * lifecycle diagram). Every edge names the CLI flag that drives it — an edge with no
 * driver is an unreachable state, not a documented one:
 *
 *   (none) --establish-fact-------------> active     (disputed=false, superseded_by=null)
 *   active --dispute-fact---------------> disputed   (floor +0.10 while unresolved)
 *   disputed --establish-fact supersedes-> superseded (floor pressure released)
 *
 * `superseded_by` holds the replacement fact's id once resolved; null/absent while
 * unresolved. Written exclusively via the `update --establish-fact` / `--dispute-fact`
 * CLI paths (never partial elsewhere).
 */
export interface EstablishedFact {
	id: string;
	statement: string;
	disputed: boolean;
	superseded_by: string | null;
}

/** Caller-supplied shape for establishing a new fact via `update --establish-fact`. */
export interface EstablishedFactInput {
	id: string;
	statement: string;
	/**
	 * Id of the disputed fact this new fact replaces. Supplying it performs the
	 * disputed → superseded transition on that predecessor — its `superseded_by`
	 * becomes this fact's id, releasing its +0.10 ambiguity-floor pressure and
	 * clearing validateScoredTransition's active trigger. Confirming the
	 * replacement IS the resolution event, so it rides the same atomic write.
	 * Refused unless the target exists and is an unresolved disputed fact.
	 */
	supersedes?: string;
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

	// Closed [0,1] range guard, the mirror of updateDeepInterviewState's current_ambiguity
	// check — threshold is the other operand of the Stop-hook's `ambiguity > threshold`
	// comparison, so it lives on the same 0–1 scale. Off-scale values disable that
	// comparison in opposite directions: above 1, nothing can exceed it, so every done token
	// passes and the convergence gate is silently off; below 0, even a fully converged 0
	// exceeds it, so the interview can never finish. Validated at the writer (not only the
	// CLI) so the programmatic path is guarded too, and before any write reaches disk.
	if (payload.threshold !== undefined) {
		const t = payload.threshold;
		if (!Number.isFinite(t) || t < 0 || t > 1) {
			throw new Error(
				`init: refused — threshold must be a finite number within the closed 0-1 range, got ${String(t)}`,
			);
		}
	}

	// Build the state object: merge with any existing state content
	const priorState: DeepInterviewStateContent = isRecord(prior["state"])
		? // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- opaque JSON boundary: state file content is written exclusively by this module's own writers (never externally supplied); trusted structural pass-through
			(prior["state"] as DeepInterviewStateContent)
		: {};

	// Spread FIRST, then let the init-owned fields below win. init is a merge, not a reset —
	// every field below already reads `payload.X ?? priorState.X`, so re-invoking it on a
	// live interview is meant to be safe. Naming the carried fields as a fixed list broke
	// that promise for anything added later: established_facts, reported_ambiguity and
	// ambiguity_floor were dropped, so a re-init laundered an unresolved dispute out of the
	// state and unblocked the convergence write validateScoredTransition exists to refuse.
	// The spread makes carry-forward the default, so the next field added is safe by
	// construction rather than by remembering to extend this list.
	const newState: DeepInterviewStateContent = {
		...priorState,
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

		if (partial.append_round !== undefined) {
			const existing: unknown[] = Array.isArray(priorState["rounds"]) ? priorState["rounds"] : [];
			updatedState["rounds"] = [...existing, partial.append_round];

			// Scoring writer (topology-floor-evolution Stage 2): a round payload carrying
			// {component, scores} propagates into the matching topology component's
			// clarity_scores — the only path that fills what setTopology (:586) always
			// seeds null. No-op when topology is absent, no component id matches, or the
			// round carries no component/scores (pure rounds-push, e.g. a fact-ground round
			// without a scoring payload).
			const round = partial.append_round;
			const priorTopology = isRecord(priorState["topology"]) ? priorState["topology"] : undefined;
			const priorComponents =
				priorTopology !== undefined && Array.isArray(priorTopology["components"])
					? // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- opaque JSON boundary: same trusted structural pass-through as other readers in this module
						(priorTopology["components"] as TopologyComponent[])
					: undefined;
			if (
				isRecord(round) &&
				typeof round["component"] === "string" &&
				isRecord(round["scores"]) &&
				priorComponents !== undefined
			) {
				const scores = round["scores"];
				const matchIdx = priorComponents.findIndex((c) => c.id === round["component"]);
				if (matchIdx !== -1) {
					const nextComponents = priorComponents.map((c, i) => {
						if (i !== matchIdx) return c;
						const nextScores: ClarityScores = { ...c.clarity_scores };
						for (const dim of CLARITY_DIMENSIONS) {
							const val = scores[dim];
							// Closed [0,1] contract, enforced by NOT applying an out-of-range value: the
							// dimension stays null, so isComponentUnscored keeps the component unscored and
							// both the floor term and the Stop-hook's completeness gate keep blocking. An
							// applied `2` or `-1` would instead read as "scored" to every consumer — the
							// completeness gate only asks whether a dimension is null, not whether its value
							// is in contract. Same silent-skip shape as the non-numeric case it extends.
							if (typeof val === "number" && Number.isFinite(val) && val >= 0 && val <= 1) {
								nextScores[dim] = val;
							}
						}
						return { ...c, clarity_scores: nextScores };
					});
					updatedState["topology"] = { components: nextComponents };
				}
			}
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
					},
				];
				if (input.supersedes !== undefined) {
					// disputed → superseded, the transition that releases floor pressure. Refuses
					// loudly rather than no-op'ing: a silently-ignored supersedes leaves the floor
					// pressured while the caller believes the dispute is resolved, which is exactly
					// the failure mode that kept this missing transition invisible.
					const target = facts.find((f) => f.id === input.supersedes);
					if (target === undefined) {
						throw new Error(
							`update: refused — establish-fact supersedes: no established_fact with id "${input.supersedes}"`,
						);
					}
					if (target.disputed !== true || target.superseded_by) {
						throw new Error(
							`update: refused — establish-fact supersedes: established_fact "${input.supersedes}" is not an unresolved disputed fact; only a disputed fact can be superseded`,
						);
					}
					facts = facts.map((f) => (f.id === input.supersedes ? { ...f, superseded_by: input.id } : f));
				}
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

		// LAST among the update blocks, by requirement — not by accident. The floor and the
		// transition gate below judge the state this call PRODUCES, so every block that can
		// move either input must have already run: append_round's score propagation (which
		// lowers the floor and constitutes the improvement claim) and the establish/dispute
		// fact lifecycle (which raises or releases floor pressure). Judging priorState instead
		// made a single combined `update --append-round … --current-ambiguity 0` succeed where
		// the same two flags sent as two calls are refused — the gate read a pre-round state
		// that had neither the scores nor the fact edits the very same write was applying.
		// Reordering the caller's flags must never change the verdict.
		if (partial.current_ambiguity !== undefined) {
			// Deterministic floor clamp (topology-floor-evolution Stage 2): the LLM-reported
			// value alone is never trusted at face value — it is floored against
			// computeAmbiguityFloor(state) before being persisted as current_ambiguity, and
			// the original reported figure is kept verbatim under reported_ambiguity so the
			// clamp is never silently lossy.
			const reported = partial.current_ambiguity;
			// Fail-closed input guard: a non-numeric CLI value parses to NaN (Number("abc")),
			// and Infinity/-Infinity are numeric but not finite. Either would flow through
			// Math.max/JSON.stringify below and land as `null` in the state file, silently
			// fail-opening the Stop-hook's `ambiguity > threshold` cross-check
			// (hooks/persistent-mode/decision.ts). Thrown before any write reaches disk, so
			// the state file stays byte-identical (UC5 idiom above).
			// Closed [0,1] range guard: the scoring contract defines ambiguity on a 0.0–1.0
			// scale, and the two ends escape in OPPOSITE directions, so neither is covered by
			// the other. Below 0, Math.max(reported, floor) clamps the value away — but the
			// out-of-contract figure still lands verbatim in reported_ambiguity, the audit
			// field. Above 1, nothing clamps downward: the value persists into
			// current_ambiguity and pins the Stop-hook's `ambiguity > threshold` cross-check
			// permanently true, blocking every done token until a valid write lands. Both
			// endpoints stay legal — 1.0 is the seeded starting ambiguity, 0 a converged claim.
			if (!Number.isFinite(reported) || reported < 0 || reported > 1) {
				throw new Error(
					`update: refused — current-ambiguity must be a finite number within the closed 0-1 range, got ${String(reported)}`,
				);
			}
			// The PROSPECTIVE state: prior plus this call's own round scores and fact-lifecycle
			// edits. current_ambiguity is deliberately still the stored one — it is assigned
			// below, after the gate — so validateScoredTransition's drop comparison keeps
			// reading the true prior value as its baseline.
			// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- opaque JSON boundary: same trusted structural pass-through as other readers in this module
			const stateForCheck = updatedState as DeepInterviewStateContent;
			const floor = computeAmbiguityFloor(stateForCheck);
			const effective = Math.max(reported, floor);
			// Fail-closed transition gate (topology-floor-evolution Stage 3): validated BEFORE
			// mergeWrite below, so a refusal leaves the state file byte-identical no matter how
			// much of updatedState the earlier blocks already populated in memory
			// (qa-state.ts:257-269 incCycle idiom).
			validateScoredTransition(stateForCheck, effective);
			updatedState["current_ambiguity"] = effective;
			updatedState["reported_ambiguity"] = reported;
			updatedState["ambiguity_floor"] = floor;
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
 * It is interview-GLOBAL, deliberately unlike the active-only term above: a fact is an
 * assertion about the design rather than a property of one component, so there is nothing
 * to scope it by. The deferred-component exclusion documented at the Topology Enumeration
 * Gate — the Round 0 step where every component is confirmed either active or explicitly
 * deferred — reads "excluded from active-component floor pressure": a statement about
 * counting components, which does not extend to facts.
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
 * caller (updateDeepInterviewState) passes the PROSPECTIVE state (prior plus the same
 * write's own round scores and fact-lifecycle edits, with current_ambiguity not yet
 * reassigned) and calls this BEFORE mergeWrite/writeFileNoCreate, so a refusal never
 * reaches disk and the state file stays byte-identical (same "validate first, write
 * second" shape as qa-state's incCycle and goal-state's setStories). Judging the
 * pre-write state instead would let a caller batch the improvement and the drop into
 * one invocation to escape the gate.
 */
export function validateScoredTransition(
	state: DeepInterviewStateContent | undefined | null,
	effectiveAmbiguity: number,
): void {
	if (activeDisputedFacts(state).length === 0) return;
	const priorAmbiguity = state?.current_ambiguity ?? 1.0;
	const ambiguityDropped = effectiveAmbiguity < priorAmbiguity;
	const dimensionImproved = hasScoredClarityDimension(state);
	if (ambiguityDropped && dimensionImproved) {
		throw new Error(
			"validateScoredTransition: refused — an unresolved disputed established_fact blocks a write " +
				"that simultaneously claims a clarity-dimension improvement and an ambiguity decrease; " +
				"resolve it by establishing the replacement fact that supersedes it: " +
				`update --establish-fact '{"id":"<new-id>","statement":"<text>","supersedes":"<disputed-id>"}'`,
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

/**
 * Round 0 Topology Enumeration Gate migration status (topology-floor-evolution Stage 6):
 * "legacy_missing" for any state written before the `topology` field existed (Stage 1) —
 * `state.topology` is absent/undefined, including a wholly missing/null state. "current"
 * once topology has been locked via setTopology, even with zero components.
 */
export type TopologyMigrationStatus = "legacy_missing" | "current";

/**
 * Pure, deterministic legacy-migration judgment (topology-floor-evolution Stage 6, UC11):
 * a state with no `topology` field reads as "legacy_missing" — the signal that Round 0
 * (topology enumeration) must run before the next per-component scoring write, since
 * computeAmbiguityFloor/validateScoredTransition assume `state.topology.components`
 * already exists. Never throws on an absent/malformed state (same undefined/null-safe
 * convention as computeAmbiguityFloor).
 */
export function computeTopologyMigrationStatus(
	state: DeepInterviewStateContent | undefined | null,
): TopologyMigrationStatus {
	return state?.topology === undefined ? "legacy_missing" : "current";
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

/**
 * Raw-string decimal guard for the two operands of the Stop-hook's convergence comparison
 * (`state.current_ambiguity > state.threshold`). Validated on the raw string BEFORE
 * Number() runs, then refused at the CLI boundary so a bad value never reaches a writer.
 *
 * Number() is too permissive on both ends. `Number("")` and `Number("   ")` coerce to the
 * finite value 0, indistinguishable downstream from a genuine "0". `Number("abc")` yields
 * NaN, which JSON.stringify persists as `null` — and `null` passes an `!== undefined`
 * presence test while coercing to 0 in the comparison, so a null threshold reads as
 * "every positive ambiguity is unconverged" and wedges the interview permanently. Neither
 * failure is visible to a Number.isFinite check applied after the fact.
 */
function decimalFlag(raw: string | undefined, subcommand: string, flag: string): number | undefined {
	if (raw === undefined) return undefined;
	const s = raw.trim();
	if (s.length === 0 || !/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(s)) {
		process.stderr.write(
			`deep-interview-state ${subcommand}: ${flag}: must be a decimal number, got "${raw}"\n`,
		);
		process.exit(1);
	}
	return Number(s);
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
		try {
			initDeepInterviewState(sessionId, {
				initial_idea: str(args["initial-idea"]),
				interview_id: str(args["interview-id"]),
				type: asInterviewType(str(args["type"])),
				current_phase: str(args["current-phase"]),
				threshold: decimalFlag(str(args["threshold"]), "init", "--threshold"),
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
				(parsed["supersedes"] !== undefined && typeof parsed["supersedes"] !== "string")
			) {
				process.stderr.write(
					`deep-interview-state update: --establish-fact: must be {"id":"<str>","statement":"<str>","supersedes"?:"<str>"}\n`,
				);
				process.exit(1);
			}
			establishFact = {
				id: parsed["id"],
				statement: parsed["statement"],
				supersedes: typeof parsed["supersedes"] === "string" ? parsed["supersedes"] : undefined,
			};
		}
		const disputeFact = str(args["dispute-fact"]);

		const currentAmbiguity = decimalFlag(ambiguity, "update", "--current-ambiguity");

		try {
			updateDeepInterviewState(sessionId, {
				current_phase: str(args["current-phase"]),
				current_ambiguity: currentAmbiguity,
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
		const output =
			result === null
				? null
				: {
						...result,
						migration_status: computeTopologyMigrationStatus(
							isRecord(result["state"])
								? // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- opaque JSON boundary: state file content is written exclusively by this module's own writers (never externally supplied); trusted structural pass-through, same convention as the read at :599-601
									(result["state"] as DeepInterviewStateContent)
								: undefined,
						),
					};
		process.stdout.write(JSON.stringify(output, null, 2) + "\n");
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
				'         [--establish-fact \'{"id":"<id>","statement":"<text>","supersedes"?:"<disputed-id>"}\']\n' +
				"                                (supersedes: resolves that disputed fact — releases its +0.10\n" +
				"                                 floor pressure. Refused unless it names an unresolved disputed fact)\n" +
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

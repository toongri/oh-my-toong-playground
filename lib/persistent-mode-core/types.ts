// Hook input from Claude Code
export interface HookInput {
	sessionId?: string;
	session_id?: string;
	cwd?: string;
	transcript_path?: string;
	last_assistant_message?: string;
	/** Claude Code v2.1.152+: running background tasks at stop time. */
	background_tasks?: Array<{ id: string; type?: string; status?: string; [k: string]: unknown }>;
}

// Parsed hook input
export interface ParsedInput {
	sessionId: string;
	directory: string;
	lastAssistantMessage: string | null;
	activeSubagentCount: number;
}

/**
 * Minimal contract the persistent-mode hook reads from the deep-interview
 * state file. The on-disk file may carry additional fields at runtime
 * (e.g. current phase, interview rounds, ambiguity scores, ontology
 * snapshots) written by the interview skill itself; the hook consults
 * `active` plus the heartbeat timestamps (for TTL liveness — see isStateLive).
 * Writers must merge rather than overwrite — replacing the file with this
 * minimal shape discards in-flight interview data.
 */
export interface DeepInterviewState {
	active: boolean;
	/** Heartbeat timestamps (managed StateType) — read by the isStateLive TTL check. */
	last_touched_at?: string;
	started_at?: string;
	/**
	 * Rich interview data (topology-floor-evolution). On disk this is nested under
	 * `state` (see skills/deep-interview/scripts/deep-interview-state.ts
	 * DeepInterviewStateContent) — current_ambiguity/threshold are NOT top-level.
	 * Absent on legacy/foreign interview states written before this field existed;
	 * the Stop-hook's ambiguity cross-check (decision.ts) must fail-open when either
	 * is missing rather than assume a shape that isn't there.
	 */
	state?: {
		current_ambiguity?: number;
		threshold?: number;
		/**
		 * Round 0's locked component list. The Stop-hook reads it for the Closure Guard's
		 * completeness check — an ACTIVE component carrying any null clarity dimension
		 * means convergence cannot be declared, whatever the ambiguity magnitude says.
		 * Absent on legacy/foreign shapes, which fail open exactly like the fields above.
		 */
		topology?: {
			components?: {
				status?: string;
				clarity_scores?: Record<string, number | null>;
			}[];
		};
	};
}

/**
 * Minimal contract the persistent-mode hook reads from the prometheus
 * state file. The on-disk file may carry additional fields at runtime
 * (e.g. phase, plan_path, resume_summary) written by the prometheus skill
 * itself; the hook consults `active` plus the heartbeat timestamps (for
 * TTL liveness — see isStateLive). Writers must merge rather than overwrite —
 * replacing the file with this minimal shape discards in-flight prometheus data.
 */
export interface PrometheusState {
	active: boolean;
	/** Heartbeat timestamps (managed StateType) — read by the isStateLive TTL check. */
	last_touched_at?: string;
	started_at?: string;
}

/**
 * Minimal contract the persistent-mode hook reads from the goal-state file
 * written by `skills/goal/scripts/goal-state.ts`. The on-disk file carries
 * many additional SKILL-only fields (outcome, verification_surface, etc.);
 * the hook only consults this subset.
 *
 * `active === false` signals a terminal state (complete/blocked/budget_limited).
 * The active-folded helper `readGoalState` returns null for terminal states,
 * so the goal pursuit branch never re-enters a finished goal. However, the
 * baseline-todo path reads terminal states via `readGoalStateRaw` (M3): a
 * goal that has reached any terminal phase still owns the session lifecycle
 * and suppresses the baseline-todo continuation, preventing spurious re-blocks
 * after the goal completes. Inactive states are therefore consumed by M3, not
 * discarded entirely.
 */
export interface GoalState {
	active: boolean;
	phase: "planning" | "pursuing" | "budget_limited" | "blocked" | "complete";
	objective_verdict: "APPROVE" | "REQUEST_CHANGES" | "COMMENT" | "absent";
	iteration: number;
	max_iterations: number;
	/** Continuation-objective text (hook-consumed): the desired end state. */
	outcome?: string;
	/** Continuation-objective text (hook-consumed): how completion is verified. */
	verification_surface?: string;
	/** Evidence paths the hook's complete-gate reads. */
	completion_evidence_paths?: string[];
	/** Set by the hook when it emits the budget-limit notice (write-once guard). */
	budget_limit_notified?: boolean;
	/** Refreshed on every write (heartbeat). Used by the GC liveness check. */
	last_touched_at?: string;
}

/**
 * Minimal contract the persistent-mode hook reads from the ultragoal-state file
 * written by `skills/ultragoal/scripts/ultragoal-state.ts`. That CLI is a
 * structural copy of `skills/goal/scripts/goal-state.ts` (identical on-disk
 * shape, separate file prefix `ultragoal-state-${sessionId}.json`), so the
 * hook's minimal contract is identical to GoalState's — including the
 * active-fold semantics (readUltragoalState vs readUltragoalStateRaw) GoalState's
 * doc comment above describes.
 */
export type UltragoalState = GoalState;

// Hook output format
export interface HookOutput {
	decision?: "block" | "continue";
	continue?: boolean;
	reason?: string;
}

// Todo item from transcript parsing
export interface TodoItem {
	id: string;
	status: "pending" | "in_progress" | "completed" | "cancelled";
}

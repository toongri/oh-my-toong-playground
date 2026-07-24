/**
 * The sentinel used to detect codex-keyword-detector.sh's ultrawork
 * additionalContext, and the two Judgment builders wired to it.
 *
 * `<ultrawork-mode>` is the opening tag literal from
 * hooks/keyword-detector-core.sh's `kd_core_message_ultrawork` — shared
 * verbatim between the Claude and Codex shims (only the `__TASK_NAME__`
 * substitution varies per platform), so it is stable, exact, and does not
 * collide with anything a model would say unprompted.
 */

import type { Judgment } from "../../types.ts";

export const ULTRAWORK_SENTINEL = "<ultrawork-mode>";

/**
 * A stable substring of index.ts's OBJECTIVE prompt text, guaranteed to be
 * echoed into injectedContext regardless of arm — runner.ts's own documented
 * guarantee on parseInjectedContext: "config.prompt is always sent as a
 * user-role response_item, so an empty result only happens for a rollout
 * that never reached that point at all." Used below as the "absent"
 * judgment's positiveControl (see evaluate.ts's evaluateJudgmentVerdict):
 * CONFIRMED defect (code-review) this closes — without a gate, a capture bug
 * that left injectedContext empty made the "sentinel absent" check pass
 * vacuously (exit 0) even though nothing was actually measured. Kept as a
 * local literal (not imported from index.ts) to avoid a circular import —
 * index.ts already imports this module.
 */
export const OBJECTIVE_MARKER = "package.json";

/**
 * `expectPresent: true` — the sentinel MUST be observed (the "present" arm,
 * and also the "broken" arm reusing this SAME judgment: see index.ts's
 * header comment on why "broken" intentionally measures exit 1, not 0).
 * `expectPresent: false` — the sentinel MUST NOT be observed (the "absent"
 * negative-control arm: same real, trusted hook environment, only the
 * keyword is removed from the prompt) — gated by OBJECTIVE_MARKER as a
 * positiveControl, so an empty/uncaptured injectedContext reports
 * "unmeasurable" (exit 2) rather than a vacuous pass.
 */
export function buildJudgment(expectPresent: boolean): Judgment {
	return expectPresent
		? { kind: "sentinel", text: ULTRAWORK_SENTINEL, fields: ["injectedContext"] }
		: { kind: "absent", literals: [ULTRAWORK_SENTINEL], fields: ["injectedContext"], positiveControl: OBJECTIVE_MARKER };
}

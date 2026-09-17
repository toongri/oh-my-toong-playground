/**
 * Unified completion-refusal message contract, shared by every deliverable-gating
 * skill family (prometheus, deep-interview, qa, explain-diff, ultragoal) at the
 * point a completion is refused because a required artifact was not submitted.
 *
 * A refusal names three things, in order, so the agent can recover WITHOUT already
 * knowing the deliverable's shape:
 *   1. study the guideline doc that defines how to produce the artifact,
 *   2. produce the artifact per that guideline,
 *   3. submit it through the state CLI (or the done token) that records it.
 *
 * The prometheus Stage A gate ("read review-pipeline.md Stage A, render HTML, then
 * run prometheus-state.ts ... --submit-presentation") is the reference shape this
 * generalizes. Before this helper, only that one gate named a guideline doc —
 * qa/explain-diff/deep-interview refusals named a CLI verb alone, so an agent that
 * did not already know the artifact's shape had nowhere to look. Routing every
 * family's refusal through one function is what makes the "study the guideline"
 * clause structural rather than something each site remembers to add.
 */
export type RefusalLang = "en" | "ko";

export interface DeliverableRefusal {
	/** What is owed, e.g. "Stage A presentation". */
	deliverable: string;
	/** Why it is not satisfied yet — specific enough to act on (path, stale, absent). */
	problem: string;
	/** Guideline doc to study, e.g. "review-pipeline.md (Stage A)". */
	guideline: string;
	/** How to produce the artifact per the guideline. */
	produce: string;
	/** The CLI command or done token that records/submits the artifact. */
	submit: string;
	/** Message language. Defaults to "en"; explain-diff uses "ko". */
	lang?: RefusalLang;
}

const LABELS = {
	en: {
		owed: (d: string) => `To complete, the ${d} must be submitted:`,
		study: (g: string) => `1. Study the guideline: you MUST read ${g}.`,
		produce: (p: string) => `2. Produce the deliverable: ${p}.`,
		submit: (s: string) => `3. Submit: ${s}.`,
	},
	ko: {
		owed: (d: string) => `완료하려면 ${d} 산출물을 제출해야 합니다:`,
		study: (g: string) => `1. 지침 숙지: ${g} 를 반드시 읽어라.`,
		produce: (p: string) => `2. 산출물 생성: ${p}.`,
		submit: (s: string) => `3. 제출: ${s}.`,
	},
} as const;

/**
 * Renders the standardized 3-part refusal body (no tag wrapper, no continuation
 * contract — callers add those). The body always leads with the concrete problem,
 * then the numbered study -> produce -> submit contract.
 */
export function deliverableRefusalBody(r: DeliverableRefusal): string {
	const L = LABELS[r.lang ?? "en"];
	return [
		r.problem,
		"",
		L.owed(r.deliverable),
		L.study(r.guideline),
		L.produce(r.produce),
		L.submit(r.submit),
	].join("\n");
}

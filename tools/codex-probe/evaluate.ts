/**
 * Judgment evaluator — pure, hermetic. Takes an already-captured Observation
 * (from runner.ts, or built from fixtures in a test) and a Judgment, and
 * returns pass/fail. No process spawning, no filesystem access: this is what
 * lets tests exercise judgment logic against captured fixtures instead of a
 * real (slow, token-costing, flaky) codex invocation every run.
 */

import { ALL_OBSERVATION_FIELDS } from "./types.ts";
import type { Judgment, Observation, ObservationField } from "./types.ts";

function fieldText(observation: Observation, field: ObservationField): string {
	switch (field) {
		case "rawStdout":
			return observation.rawStdout;
		case "baseInstructions":
			return observation.baseInstructions;
		case "injectedContext":
			return observation.injectedContext;
		case "finalMessage":
			return observation.finalMessage ?? "";
		case "stderr":
			return observation.stderr;
	}
}

function searchText(observation: Observation, fields: readonly ObservationField[]): string {
	return fields.map((field) => fieldText(observation, field)).join("\n");
}

export function evaluateJudgment(observation: Observation, judgment: Judgment): boolean {
	switch (judgment.kind) {
		case "sentinel": {
			const text = searchText(observation, judgment.fields ?? ALL_OBSERVATION_FIELDS);
			return text.includes(judgment.text);
		}
		case "absent": {
			const text = searchText(observation, judgment.fields ?? ALL_OBSERVATION_FIELDS);
			return !judgment.literals.some((literal) => text.includes(literal));
		}
		case "predicate":
			return judgment.predicate(observation);
	}
}

export type JudgmentVerdict = "pass" | "fail" | "unmeasurable";

/**
 * 3-valued judgment evaluator — promotes probes/rules-runtime-leak-absence/
 * judgment.ts's evaluateGatedAbsence pattern into this shared core (CONFIRMED
 * defect, code-review): a bare `absent` judgment passes VACUOUSLY — the
 * boolean evaluateJudgment above returns true — when the scoped observation
 * text is empty, which is indistinguishable from "the literal is genuinely
 * absent" without independent proof the scoped channel captured real content
 * at all. `ultrawork-keyword-injection/judgment.ts`'s "absent" arm was
 * exactly this shape before this fix: `{kind:"absent", literals:[SENTINEL],
 * fields:["injectedContext"]}` with no gate, passing exit 0 even on a
 * totally empty injectedContext (a capture bug, not a real negative).
 *
 * An `absent` judgment carrying `positiveControl` (see types.ts's Judgment
 * doc) is checked as a `sentinel` judgment FIRST, scoped to the SAME
 * `fields`, on the SAME observation — not a separate run. If that fails,
 * nothing was measured about the literals under test: "unmeasurable", never
 * a vacuous "pass". Only once the positive control is satisfied does the
 * literals-absence check run for real. An `absent` judgment WITHOUT
 * `positiveControl` (existing callers unmodified by this promotion — e.g.
 * "stderr stayed clean", where an empty field IS itself a meaningful pass,
 * not a capture failure — see evaluate.test.ts) evaluates exactly as
 * evaluateJudgment always has. `sentinel`/`predicate` judgments have no
 * notion of a gate here — a `sentinel` already fails safe on empty text (see
 * evaluateJudgment's own case above), and a `predicate` decides its own
 * verdict entirely.
 */
export function evaluateJudgmentVerdict(observation: Observation, judgment: Judgment): JudgmentVerdict {
	if (judgment.kind === "absent" && judgment.positiveControl !== undefined) {
		const controlObserved = evaluateJudgment(observation, { kind: "sentinel", text: judgment.positiveControl, fields: judgment.fields });
		if (!controlObserved) return "unmeasurable";
	}
	return evaluateJudgment(observation, judgment) ? "pass" : "fail";
}

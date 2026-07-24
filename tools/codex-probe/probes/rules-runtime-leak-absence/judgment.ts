/**
 * The gated absence-judgment — this probe's core design (spec AC line 76
 * demands a positive control, since an "absent" judgment passes vacuously
 * when the thing under test was never injected at all — see index.ts's
 * header comment for the full rationale).
 *
 * `evaluateGatedAbsence` is a PURE function over an already-captured
 * Observation (mirrors evaluate.ts's own pure/impure split): it does NOT
 * decide the process exit code itself — index.ts's main() maps its result to
 * 0/1/2, the same trichotomy every other probe in this harness uses.
 *
 * This is now a thin wrapper over evaluate.ts's evaluateJudgmentVerdict —
 * this probe's own gated-absence pattern (positive control first, absence
 * check only once it passes, 3-valued result) was PROMOTED there (code-
 * review: the same defect this design already guards against — a vacuous
 * `absent` pass on an empty observation — was independently reachable
 * through a plain `absent` judgment with no positive control at all, e.g.
 * probes/ultrawork-keyword-injection's own "absent" arm). Delegating instead
 * of keeping a parallel bespoke implementation is what makes this an actual
 * promotion rather than a second copy that can drift from the core.
 */

import { evaluateJudgmentVerdict } from "../../evaluate.ts";
import type { Observation } from "../../types.ts";
import { FORBIDDEN_LITERALS, RULE_SENTINEL } from "./fixture.ts";

export type GatedVerdict =
	| { kind: "pass" }
	| { kind: "fail"; leaked: string[] }
	| { kind: "positive-control-failed" };

/**
 * Positive-control check (runs first, via evaluateJudgmentVerdict's
 * positiveControl gate): RULE_SENTINEL must be observed in injectedContext —
 * proof the rule actually reached the model, on the SAME observation the
 * absence check below runs against (not a separate arm/run). If it did not,
 * this probe measured NOTHING about the rewrite pipeline —
 * `positive-control-failed` maps to exit 2 (unmeasurable) at the index.ts
 * layer, never exit 0.
 *
 * Absence check (only reached once the positive control passed): none of
 * FORBIDDEN_LITERALS may appear anywhere in injectedContext. `fail` reports
 * exactly which leaked, for a legible probe report — evaluateJudgmentVerdict
 * itself only returns pass/fail/unmeasurable, not the leaked list, so that
 * part is still computed locally once a "fail" verdict comes back.
 */
export function evaluateGatedAbsence(observation: Observation): GatedVerdict {
	const verdict = evaluateJudgmentVerdict(observation, {
		kind: "absent",
		literals: [...FORBIDDEN_LITERALS],
		fields: ["injectedContext"],
		positiveControl: RULE_SENTINEL,
	});

	if (verdict === "unmeasurable") return { kind: "positive-control-failed" };
	if (verdict === "pass") return { kind: "pass" };

	const leaked = FORBIDDEN_LITERALS.filter((literal) => observation.injectedContext.includes(literal));
	return { kind: "fail", leaked };
}

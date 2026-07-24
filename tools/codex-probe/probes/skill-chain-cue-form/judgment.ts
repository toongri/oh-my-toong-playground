/**
 * The cue-form judgment — stricter than skill-chain-load's tool-call-only
 * predicate. "Opened" (a tool call names beta/SKILL.md — reuses
 * skill-chain-load's skillFileWasOpened, the same falsifiable predicate,
 * unmodified) is necessary but not sufficient on its own: it only proves a
 * command referencing the path ran, not that the content reached the
 * model's own words. This judgment additionally requires the sentinel
 * planted in beta/SKILL.md's body (fixture.ts's BETA_SENTINEL) to appear in
 * the model's final reply — "opened" AND "read and reflected".
 */

import type { Judgment, Observation } from "../../types.ts";
import { skillFileWasOpened } from "../skill-chain-load/judgment.ts";
import { BETA_SENTINEL } from "./fixture.ts";

const TARGET_SKILL = "beta";

export function cueFormPredicate(observation: Observation): boolean {
	const opened = skillFileWasOpened(observation, TARGET_SKILL);
	const reflected = (observation.finalMessage ?? "").includes(BETA_SENTINEL);
	return opened && reflected;
}

export function cueFormJudgment(): Judgment {
	return { kind: "predicate", predicate: cueFormPredicate };
}

/**
 * Inverted counterpart of cueFormPredicate/cueFormJudgment — for the
 * "removed"/"oldprose" arms (see index.ts's buildProbeSpec), which are
 * negative controls: alpha's fixture never gives the model a cue strong
 * enough to open beta, so PASSING must mean beta stayed closed. If beta
 * opens anyway, the control failed to discriminate cue form at all (see
 * this probe's index.ts header comment) — that is the FAILING outcome here,
 * not a success to report as exit 0.
 *
 * Inverts ONLY the experimental axis this control gates on — whether beta
 * was OPENED — not the full `opened && reflected` conjunction. CONFIRMED
 * defect (code-review): `!cueFormPredicate(...)` is `!(opened && reflected)`,
 * a De Morgan expansion to `!opened || !reflected` — so an "opened but the
 * sentinel never reached the final reply" observation (opened=true,
 * reflected=false) satisfies `!reflected` and PASSES, even though beta
 * demonstrably opened and the control was supposed to catch exactly that.
 * `reflected` is cueFormPredicate's own extra strictness for the POSITIVE
 * arms (proving content, not just a tool call, reached the model) — it is
 * not part of this control's discriminating axis and must not be folded in.
 */
export function invertedCueFormPredicate(observation: Observation): boolean {
	return !skillFileWasOpened(observation, TARGET_SKILL);
}

export function invertedCueFormJudgment(): Judgment {
	return { kind: "predicate", predicate: invertedCueFormPredicate };
}

/**
 * Decoy names (gamma/delta by convention) whose SKILL.md a tool call
 * opened. Reported separately in index.ts's output — never gates pass/fail.
 * If a decoy appears here, the Oracle's third-cause note applies: the model
 * may sweep every discovered skill dir regardless of whether it was named,
 * which is a distinct finding from sigil-vs-prose and must be reported as
 * such, not folded into this probe's exit code.
 */
export function decoysOpened(observation: Observation, decoyNames: readonly string[]): string[] {
	return decoyNames.filter((name) => skillFileWasOpened(observation, name));
}

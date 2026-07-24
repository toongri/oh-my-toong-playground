/**
 * Hermetic tests for buildJudgment — no codex spawn.
 */

import { describe, expect, it } from "bun:test";

import { evaluateJudgment } from "../../evaluate.ts";
import type { Observation } from "../../types.ts";
import { buildJudgment, OBJECTIVE_MARKER, ULTRAWORK_SENTINEL } from "./judgment.ts";

function observation(overrides: Partial<Observation>): Observation {
	return { events: [], toolCalls: [], baseInstructions: "", injectedContext: "", finalMessage: null, rawStdout: "", stderr: "", ...overrides };
}

describe("buildJudgment(true) — expect sentinel present", () => {
	it("is a sentinel-kind Judgment scoped to injectedContext only", () => {
		const judgment = buildJudgment(true);
		expect(judgment).toEqual({ kind: "sentinel", text: ULTRAWORK_SENTINEL, fields: ["injectedContext"] });
	});

	it("passes when the sentinel is in injectedContext", () => {
		const obs = observation({ injectedContext: `some rule text\n${ULTRAWORK_SENTINEL}\nmore text` });
		expect(evaluateJudgment(obs, buildJudgment(true))).toBe(true);
	});

	it("fails when the sentinel is absent from injectedContext", () => {
		const obs = observation({ injectedContext: "unrelated content" });
		expect(evaluateJudgment(obs, buildJudgment(true))).toBe(false);
	});

	// Guards against a vacuous pass: the model merely SAYING the tag in its own
	// reply (finalMessage) must not satisfy this judgment — it is scoped to
	// injectedContext only, the channel that proves the HOOK actually injected
	// it, not that the model echoed or hallucinated the string.
	it("fails when the sentinel appears only in finalMessage, not injectedContext (scope guard)", () => {
		const obs = observation({ injectedContext: "", finalMessage: `I saw ${ULTRAWORK_SENTINEL} in my instructions.` });
		expect(evaluateJudgment(obs, buildJudgment(true))).toBe(false);
	});
});

describe("buildJudgment(false) — expect sentinel absent (negative control)", () => {
	it("is an absent-kind Judgment scoped to injectedContext only, gated by OBJECTIVE_MARKER as its positiveControl", () => {
		const judgment = buildJudgment(false);
		expect(judgment).toEqual({ kind: "absent", literals: [ULTRAWORK_SENTINEL], fields: ["injectedContext"], positiveControl: OBJECTIVE_MARKER });
	});

	it("passes when the positive control is present and the sentinel never appears in injectedContext", () => {
		const obs = observation({ injectedContext: `${OBJECTIVE_MARKER} unrelated content` });
		expect(evaluateJudgment(obs, buildJudgment(false))).toBe(true);
	});

	it("fails when the positive control is present and the sentinel is ALSO present (control failed to discriminate)", () => {
		const obs = observation({ injectedContext: `${OBJECTIVE_MARKER}\n${ULTRAWORK_SENTINEL} leaked in anyway` });
		expect(evaluateJudgment(obs, buildJudgment(false))).toBe(false);
	});

	// CONFIRMED-defect regression (code-review): a plain evaluateJudgment call
	// (the boolean function, ignoring positiveControl) still reports "true" on
	// a totally empty injectedContext — this is exactly why probe.ts's real
	// exit-code path must go through evaluateJudgmentVerdict instead (see
	// evaluate.test.ts and index.test.ts's own "positive control never
	// observed" case below for the gate actually firing).
	it("evaluateJudgment (boolean, ungated) alone still reports true on an empty injectedContext — demonstrates why the gate lives in evaluateJudgmentVerdict, not here", () => {
		const obs = observation({ injectedContext: "" });
		expect(evaluateJudgment(obs, buildJudgment(false))).toBe(true);
	});
});

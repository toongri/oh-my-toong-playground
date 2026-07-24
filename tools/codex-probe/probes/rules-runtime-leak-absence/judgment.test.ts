/**
 * Hermetic tests for evaluateGatedAbsence — no codex spawn. Exercises the
 * exact three-way outcome this probe's design depends on: positive control
 * fails first (unmeasurable), positive control passes but a literal leaked
 * (fail), or both pass (pass).
 */

import { describe, expect, it } from "bun:test";

import type { Observation } from "../../types.ts";
import { RULE_SENTINEL } from "./fixture.ts";
import { evaluateGatedAbsence } from "./judgment.ts";

function observation(injectedContext: string): Observation {
	return { events: [], toolCalls: [], baseInstructions: "", injectedContext, finalMessage: null, rawStdout: "", stderr: "" };
}

describe("evaluateGatedAbsence", () => {
	it("positive-control-failed: the sentinel never appears in injectedContext — measured NOTHING, must not report pass", () => {
		const obs = observation("unrelated content, no sentinel here");
		expect(evaluateGatedAbsence(obs)).toEqual({ kind: "positive-control-failed" });
	});

	// CONFIRMED-defect-shaped guard: a literal present WITHOUT the sentinel
	// must still report positive-control-failed, not fail — the absence check
	// is only meaningful once the positive control establishes the rule
	// actually reached the model. Without that, a leaked literal from some
	// OTHER unrelated source (not this probe's rule) would produce a
	// misleading "fail" instead of the honest "unmeasurable".
	it("positive-control-failed takes priority even when a forbidden literal happens to be present without the sentinel", () => {
		const obs = observation("AskUserQuestion mentioned here, but no sentinel");
		expect(evaluateGatedAbsence(obs)).toEqual({ kind: "positive-control-failed" });
	});

	it("pass: sentinel present, no forbidden literal present", () => {
		const obs = observation(`some rule text\n${RULE_SENTINEL}\nrequest_user_input, subagent transcript read, update_plan, agent_type`);
		expect(evaluateGatedAbsence(obs)).toEqual({ kind: "pass" });
	});

	it("fail: sentinel present AND a forbidden literal leaked — reports exactly which literal(s)", () => {
		const obs = observation(`${RULE_SENTINEL}\nAskUserQuestion`);
		expect(evaluateGatedAbsence(obs)).toEqual({ kind: "fail", leaked: ["AskUserQuestion"] });
	});

	// CONFIRMED defect (code-review): deriving BOTH the input text and the
	// expected `leaked` list from the same production constant (FORBIDDEN_LITERALS)
	// means a regression that silently drops an entry from that constant (e.g.
	// TaskOutput) shrinks input and expectation together — this test stayed
	// green when TaskOutput was removed from FORBIDDEN_LITERALS, even though the
	// probe had quietly stopped detecting that literal's leak. Verified: with
	// TaskOutput removed from FORBIDDEN_LITERALS, this test (as it read before
	// this fix) still passed. Fix: an INDEPENDENTLY authored literal list — not
	// imported/derived from FORBIDDEN_LITERALS — so a shrunk production constant
	// is caught as a mismatch against this fixed, hand-typed expectation.
	it("fail: reports every leaked literal, not just the first (independently authored literal list — not derived from FORBIDDEN_LITERALS)", () => {
		const independentlyAuthoredLiterals = ["AskUserQuestion", "TaskOutput", "TaskCreate", "subagent_type"];
		const obs = observation(`${RULE_SENTINEL}\n${independentlyAuthoredLiterals.join(" ")}`);
		expect(evaluateGatedAbsence(obs)).toEqual({ kind: "fail", leaked: independentlyAuthoredLiterals });
	});

	it("scope guard: the sentinel appearing only outside injectedContext (e.g. as an Observation field this function never scans) does not satisfy the positive control", () => {
		// evaluateGatedAbsence reads observation.injectedContext directly, so an
		// Observation whose injectedContext is empty always fails the positive
		// control regardless of what other fields contain.
		const obs: Observation = {
			events: [],
			toolCalls: [],
			baseInstructions: RULE_SENTINEL,
			injectedContext: "",
			finalMessage: RULE_SENTINEL,
			rawStdout: RULE_SENTINEL,
			stderr: "",
		};
		expect(evaluateGatedAbsence(obs)).toEqual({ kind: "positive-control-failed" });
	});
});

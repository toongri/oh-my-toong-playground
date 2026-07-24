/**
 * Hermetic tests for the cue-form judgment — no codex spawn. Exercises the
 * AND boundary the Oracle's redesign called for: a tool call naming
 * beta/SKILL.md is necessary but not sufficient — the model's final reply
 * must also carry the sentinel planted in beta's body, so "opened the file"
 * and "the content actually reached the model" are asserted separately (see
 * this repo's REPORT for why skill-chain-load's tool-call-only predicate
 * alone wasn't enough to separate "read" from "read and reflected").
 */

import { describe, expect, it } from "bun:test";

import type { Observation } from "../../types.ts";
import { BETA_SENTINEL } from "./fixture.ts";
import { cueFormJudgment, cueFormPredicate, decoysOpened, invertedCueFormPredicate } from "./judgment.ts";

function observation(overrides: Partial<Observation>): Observation {
	return { events: [], toolCalls: [], baseInstructions: "", injectedContext: "", finalMessage: null, rawStdout: "", stderr: "", ...overrides };
}

/**
 * A tool call that both names and actually reads `<skill>/SKILL.md` — the
 * content marker AND the exit_code:0/status:"completed" success shape
 * skillFileWasOpened requires (see skill-chain-load/judgment.ts).
 */
function readCall(skillName: string) {
	return {
		itemType: "command_execution",
		item: { command: `cat .agents/skills/${skillName}/SKILL.md`, aggregated_output: `---\nname: ${skillName}\n---\n`, exit_code: 0, status: "completed" },
	};
}

describe("cueFormPredicate", () => {
	it("true: beta/SKILL.md was opened AND the sentinel appears in the final reply", () => {
		const obs = observation({
			toolCalls: [readCall("beta")],
			finalMessage: `package.json exists: true. ${BETA_SENTINEL}`,
		});
		expect(cueFormPredicate(obs)).toBe(true);
	});

	it("false: opened but the sentinel never reached the final reply", () => {
		const obs = observation({
			toolCalls: [readCall("beta")],
			finalMessage: "package.json exists: true.",
		});
		expect(cueFormPredicate(obs)).toBe(false);
	});

	it("false: the sentinel is quoted in the final reply but no tool call ever opened beta/SKILL.md (guards against a vacuous text-only match)", () => {
		const obs = observation({
			toolCalls: [],
			finalMessage: `I recall the token is ${BETA_SENTINEL}.`,
		});
		expect(cueFormPredicate(obs)).toBe(false);
	});

	it("false: neither opened nor reflected", () => {
		expect(cueFormPredicate(observation({}))).toBe(false);
	});
});

describe("cueFormJudgment", () => {
	it("builds a predicate-kind Judgment wired to cueFormPredicate", () => {
		const judgment = cueFormJudgment();
		expect(judgment.kind).toBe("predicate");
		if (judgment.kind !== "predicate") throw new Error("unreachable");
		const passing = observation({
			toolCalls: [readCall("beta")],
			finalMessage: BETA_SENTINEL,
		});
		expect(judgment.predicate(passing)).toBe(true);
	});
});

// CONFIRMED defect (code-review): `!cueFormPredicate(...)` is a De Morgan
// expansion of `!(opened && reflected)` into `!opened || !reflected` — an
// "opened but not reflected" observation satisfies `!reflected` and PASSED
// under the broken implementation, even though beta demonstrably opened
// (the exact outcome the "removed"/"oldprose" negative controls exist to
// catch). The fix inverts ONLY the `opened` axis.
describe("invertedCueFormPredicate — negative-control axis guard", () => {
	it("FAILS (returns false) when beta was opened but the sentinel never reached the final reply — the truth-table row a De Morgan `!(opened && reflected)` expansion would wrongly PASS", () => {
		const obs = observation({
			toolCalls: [readCall("beta")],
			finalMessage: "package.json exists: true.",
		});
		expect(invertedCueFormPredicate(obs)).toBe(false);
	});

	it("FAILS (returns false) when beta was opened AND reflected — the control failed to discriminate at all", () => {
		const obs = observation({
			toolCalls: [readCall("beta")],
			finalMessage: `done — ${BETA_SENTINEL}`,
		});
		expect(invertedCueFormPredicate(obs)).toBe(false);
	});

	it("PASSES (returns true) when beta was never opened — the correct discriminating outcome for a negative control", () => {
		const obs = observation({ toolCalls: [], finalMessage: "done, no beta." });
		expect(invertedCueFormPredicate(obs)).toBe(true);
	});
});

describe("decoysOpened", () => {
	it("reports which decoy names had a tool call naming their SKILL.md", () => {
		const obs = observation({
			toolCalls: [readCall("gamma"), readCall("beta")],
		});
		expect(decoysOpened(obs, ["gamma", "delta"])).toEqual(["gamma"]);
	});

	it("returns an empty array when no decoy was opened", () => {
		expect(decoysOpened(observation({}), ["gamma", "delta"])).toEqual([]);
	});
});

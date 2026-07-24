import { describe, it, expect } from "bun:test";
import fs from "fs";
import path from "path";

import { evaluateJudgment, evaluateJudgmentVerdict } from "./evaluate.ts";
import { parseStdoutEvents, extractToolCalls, extractFinalMessage, parseBaseInstructions, parseInjectedContext } from "./runner.ts";
import { ALL_OBSERVATION_FIELDS } from "./types.ts";
import type { Observation } from "./types.ts";

const FIXTURES_DIR = path.join(import.meta.dirname, "fixtures");

/** Builds a real Observation from real captured fixtures via runner.ts's own
 * pure parsers — not a hand-typed object — so evaluator tests exercise the
 * same shape runSession() actually produces. */
function observationFromFixtures(stdoutFile: string, rolloutFile: string, stderr = ""): Observation {
	const rawStdout = fs.readFileSync(path.join(FIXTURES_DIR, stdoutFile), "utf-8");
	const rolloutRaw = fs.readFileSync(path.join(FIXTURES_DIR, rolloutFile), "utf-8");
	const events = parseStdoutEvents(rawStdout)!;
	const baseInstructions = parseBaseInstructions(rolloutRaw)!;
	return {
		events,
		toolCalls: extractToolCalls(events),
		baseInstructions,
		injectedContext: parseInjectedContext(rolloutRaw),
		finalMessage: extractFinalMessage(events),
		rawStdout,
		stderr,
	};
}

const PONG_OBSERVATION = observationFromFixtures("pong-stdout.jsonl", "pong-rollout.jsonl");
const TOOLCALL_OBSERVATION = observationFromFixtures("toolcall-stdout.jsonl", "toolcall-rollout.jsonl");

// ---------------------------------------------------------------------------
// sentinel judgment
// ---------------------------------------------------------------------------

describe("evaluateJudgment / sentinel", () => {
	it("passes when the sentinel text is present in a real final message", () => {
		expect(evaluateJudgment(PONG_OBSERVATION, { kind: "sentinel", text: "PONG" })).toBe(true);
	});

	it("fails when the sentinel text is absent from a real observation", () => {
		expect(evaluateJudgment(PONG_OBSERVATION, { kind: "sentinel", text: "this text never appears" })).toBe(false);
	});

	it("scopes the search to the given fields only", () => {
		const judgment = { kind: "sentinel" as const, text: "PONG", fields: ["baseInstructions" as const] };
		// "PONG" is in finalMessage/rawStdout but not in the injected base
		// instructions — scoping to baseInstructions alone must fail.
		expect(evaluateJudgment(PONG_OBSERVATION, judgment)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// absent judgment
// ---------------------------------------------------------------------------

describe("evaluateJudgment / absent", () => {
	it("passes when none of the literals are observed anywhere", () => {
		// "AskUserQuestion" is verified absent from every field, including the
		// real injected developer/user rollout content — unlike "TaskCreate",
		// which IS present there (see the CONFIRMED-defect test below), so it
		// would not be a valid absent-everywhere fixture for this case.
		expect(evaluateJudgment(PONG_OBSERVATION, { kind: "absent", literals: ["AskUserQuestion"] })).toBe(true);
	});

	it("fails when one of the literals IS observed", () => {
		expect(evaluateJudgment(PONG_OBSERVATION, { kind: "absent", literals: ["PONG"] })).toBe(false);
	});

	it("scopes the negative check to baseInstructions specifically, ignoring an incidental match elsewhere", () => {
		const judgment = { kind: "absent" as const, literals: ["PONG"], fields: ["baseInstructions" as const] };
		// "PONG" appears in the final message but never in the real injected
		// base_instructions — scoped to baseInstructions alone, this must pass.
		expect(evaluateJudgment(PONG_OBSERVATION, judgment)).toBe(true);
	});

	// Adapter-fidelity AC: "stderr never contains `missing YAML frontmatter
	// delimited by ---`" — the harness must actually be able to observe stderr
	// for this judgment to mean anything (previously unmeasurable: the field
	// didn't exist, and scoping to it silently produced an always-vacuous-pass).
	it("fails when the literal IS observed in stderr, scoped to the stderr field", () => {
		const observation = observationFromFixtures("pong-stdout.jsonl", "pong-rollout.jsonl", "missing YAML frontmatter delimited by ---");
		const judgment = {
			kind: "absent" as const,
			literals: ["missing YAML frontmatter delimited by ---"],
			fields: ["stderr" as const],
		};
		expect(evaluateJudgment(observation, judgment)).toBe(false);
	});

	it("passes when stderr is clean of the literal, scoped to the stderr field", () => {
		const observation = observationFromFixtures("pong-stdout.jsonl", "pong-rollout.jsonl", "");
		const judgment = {
			kind: "absent" as const,
			literals: ["missing YAML frontmatter delimited by ---"],
			fields: ["stderr" as const],
		};
		expect(evaluateJudgment(observation, judgment)).toBe(true);
	});

	// CONFIRMED defect: the literal `TaskCreate` is verifiably present in the
	// real toolcall-rollout.jsonl fixture's rollout — but ONLY inside a
	// `response_item` developer message (this repo's own global coding-
	// discipline rule text gets injected there). Verified real, not assumed:
	//   $ grep -c 'TaskCreate' fixtures/toolcall-rollout.jsonl   -> 1
	// None of rawStdout/baseInstructions/finalMessage/stderr — the only four
	// fields ALL_OBSERVATION_FIELDS covered before this fix — carry that text,
	// because `session_meta.payload.base_instructions` is a DIFFERENT rollout
	// channel from the `response_item` messages that carry per-session
	// injected content (project rules, AGENTS.md). An "absent" judgment
	// scanning only the old four fields therefore reports the literal as
	// absent (exit 0 / pass) even though it demonstrably leaked into the real
	// model context — the exact false-negative this fix closes.
	it("catches a literal that leaked into the injected developer/user context, not just the four original fields", () => {
		expect(evaluateJudgment(TOOLCALL_OBSERVATION, { kind: "absent", literals: ["TaskCreate"] })).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// evaluateJudgmentVerdict — 3-valued gated absence, promoted from
// probes/rules-runtime-leak-absence/judgment.ts's evaluateGatedAbsence
// (CONFIRMED defect, code-review: a bare `absent` judgment passes vacuously
// on an empty scoped observation — see the plain evaluateJudgment/absent
// tests above; this section covers the gate that closes it).
// ---------------------------------------------------------------------------

describe("evaluateJudgmentVerdict / absent with positiveControl", () => {
	const positiveControlJudgment = {
		kind: "absent" as const,
		literals: ["FORBIDDEN"],
		fields: ["injectedContext" as const],
		positiveControl: "RULE_WAS_INJECTED_SENTINEL",
	};

	function observation(injectedContext: string): Observation {
		return { events: [], toolCalls: [], baseInstructions: "", injectedContext, finalMessage: null, rawStdout: "", stderr: "" };
	}

	// CONFIRMED-defect regression: this is exactly the shape a bare `absent`
	// judgment (no positiveControl) would report as a vacuous "pass" (see
	// evaluateJudgment above) — with the gate, it must instead report
	// "unmeasurable", never "pass".
	it("unmeasurable: the observation is totally empty in scope — the positive control never appeared, so nothing was measured (must NOT be a vacuous pass)", () => {
		expect(evaluateJudgmentVerdict(observation(""), positiveControlJudgment)).toBe("unmeasurable");
	});

	it("unmeasurable: scoped text has content, but not the positive control's sentinel", () => {
		expect(evaluateJudgmentVerdict(observation("unrelated content, no control sentinel"), positiveControlJudgment)).toBe("unmeasurable");
	});

	it("unmeasurable takes priority even when a forbidden literal happens to be present without the positive control", () => {
		expect(evaluateJudgmentVerdict(observation("FORBIDDEN mentioned, but no control sentinel"), positiveControlJudgment)).toBe("unmeasurable");
	});

	it("pass: positive control present, no forbidden literal present", () => {
		expect(evaluateJudgmentVerdict(observation("RULE_WAS_INJECTED_SENTINEL and other clean text"), positiveControlJudgment)).toBe("pass");
	});

	it("fail: positive control present AND a forbidden literal leaked", () => {
		expect(evaluateJudgmentVerdict(observation("RULE_WAS_INJECTED_SENTINEL\nFORBIDDEN"), positiveControlJudgment)).toBe("fail");
	});

	it("the positive control is scoped to the SAME `fields` as the absence check, not searched everywhere", () => {
		const obs: Observation = {
			events: [],
			toolCalls: [],
			baseInstructions: "RULE_WAS_INJECTED_SENTINEL",
			injectedContext: "",
			finalMessage: "RULE_WAS_INJECTED_SENTINEL",
			rawStdout: "RULE_WAS_INJECTED_SENTINEL",
			stderr: "",
		};
		// The sentinel exists elsewhere, but injectedContext (the judgment's own
		// `fields`) is empty — the gate must still fail closed.
		expect(evaluateJudgmentVerdict(obs, positiveControlJudgment)).toBe("unmeasurable");
	});
});

describe("evaluateJudgmentVerdict / absent WITHOUT positiveControl — unchanged from evaluateJudgment (backward compatible)", () => {
	function observation(stderr: string): Observation {
		return { events: [], toolCalls: [], baseInstructions: "", injectedContext: "", finalMessage: null, rawStdout: "real session content here", stderr };
	}

	it("a legitimately empty scoped field (no positiveControl set) still reports 'pass', not 'unmeasurable' — e.g. 'stderr stayed clean'", () => {
		const judgment = { kind: "absent" as const, literals: ["missing YAML frontmatter delimited by ---"], fields: ["stderr" as const] };
		expect(evaluateJudgmentVerdict(observation(""), judgment)).toBe("pass");
	});

	it("still reports 'fail' when the literal IS observed, with no positiveControl gate involved", () => {
		const judgment = { kind: "absent" as const, literals: ["missing YAML frontmatter delimited by ---"], fields: ["stderr" as const] };
		expect(evaluateJudgmentVerdict(observation("missing YAML frontmatter delimited by ---"), judgment)).toBe("fail");
	});
});

describe("evaluateJudgmentVerdict / sentinel and predicate — pass through to evaluateJudgment, no unmeasurable notion", () => {
	it("sentinel: pass/fail exactly like evaluateJudgment", () => {
		expect(evaluateJudgmentVerdict(PONG_OBSERVATION, { kind: "sentinel", text: "PONG" })).toBe("pass");
		expect(evaluateJudgmentVerdict(PONG_OBSERVATION, { kind: "sentinel", text: "never appears" })).toBe("fail");
	});

	it("predicate: pass/fail exactly like evaluateJudgment", () => {
		const judgment = { kind: "predicate" as const, predicate: () => true };
		expect(evaluateJudgmentVerdict(PONG_OBSERVATION, judgment)).toBe("pass");
	});
});

// ---------------------------------------------------------------------------
// predicate judgment
// ---------------------------------------------------------------------------

describe("evaluateJudgment / predicate", () => {
	it("passes when the predicate observes a real command_execution tool call", () => {
		const judgment = {
			kind: "predicate" as const,
			predicate: (observation: Observation) => observation.toolCalls.some((t) => t.itemType === "command_execution"),
		};
		expect(evaluateJudgment(TOOLCALL_OBSERVATION, judgment)).toBe(true);
	});

	it("fails when the predicate finds no matching tool call in a real text-only observation", () => {
		const judgment = {
			kind: "predicate" as const,
			predicate: (observation: Observation) => observation.toolCalls.some((t) => t.itemType === "command_execution"),
		};
		expect(evaluateJudgment(PONG_OBSERVATION, judgment)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// ALL_OBSERVATION_FIELDS ↔ fieldText wiring (drift guard)
// ---------------------------------------------------------------------------

// ObservationField/ALL_OBSERVATION_FIELDS were previously two hand-maintained
// copies (a union type literal + a parallel array literal) that could drift —
// a field added to one and not the other. Now the array is the single source
// and the union is derived from it, but that only guarantees the TYPE stays in
// sync; it says nothing about evaluate.ts's per-field switch (fieldText)
// actually wiring up the new field's data. This test iterates
// ALL_OBSERVATION_FIELDS itself (not a hand-copied field list) with a unique
// marker planted in each Observation field, so a future field added to the
// array without a matching fieldText case fails here instead of silently
// scoping to "" (always-vacuous-pass, the same failure mode already fixed for
// stderr — see the "adapter-fidelity" tests above).
describe("ALL_OBSERVATION_FIELDS ↔ fieldText wiring", () => {
	it("scoping a sentinel search to each declared field finds ONLY that field's unique marker", () => {
		const markers: Record<(typeof ALL_OBSERVATION_FIELDS)[number], string> = {
			rawStdout: "MARKER_RAW_STDOUT",
			baseInstructions: "MARKER_BASE_INSTRUCTIONS",
			injectedContext: "MARKER_INJECTED_CONTEXT",
			finalMessage: "MARKER_FINAL_MESSAGE",
			stderr: "MARKER_STDERR",
		};
		const observation: Observation = {
			events: [],
			toolCalls: [],
			baseInstructions: markers.baseInstructions,
			injectedContext: markers.injectedContext,
			finalMessage: markers.finalMessage,
			rawStdout: markers.rawStdout,
			stderr: markers.stderr,
		};

		for (const field of ALL_OBSERVATION_FIELDS) {
			const ownMarker = markers[field];
			expect(evaluateJudgment(observation, { kind: "sentinel", text: ownMarker, fields: [field] })).toBe(
				true,
			);
			for (const otherField of ALL_OBSERVATION_FIELDS) {
				if (otherField === field) continue;
				expect(
					evaluateJudgment(observation, { kind: "sentinel", text: markers[otherField], fields: [field] }),
				).toBe(false);
			}
		}
	});
});

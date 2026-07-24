import { describe, it, expect } from "bun:test";

import { runProbe } from "./probe.ts";
import type { RunResult, SessionConfig, Observation } from "./types.ts";

function observation(finalMessage: string): Observation {
	return { events: [], toolCalls: [], baseInstructions: "", injectedContext: "", finalMessage, rawStdout: "", stderr: "" };
}

const session: SessionConfig = { prompt: "irrelevant", cwd: "/tmp" };

// ---------------------------------------------------------------------------
// pass / fail — a single measured attempt maps directly to exit 0 / 1.
// ---------------------------------------------------------------------------

describe("runProbe / measured outcomes", () => {
	it("exit 0 when the session is measured and the judgment passes", async () => {
		let calls = 0;
		const runSessionFn = async (): Promise<RunResult> => {
			calls++;
			return { ok: true, observation: observation("PONG") };
		};
		const outcome = await runProbe(
			{ session, judgment: { kind: "sentinel", text: "PONG" } },
			{ runSessionFn },
		);
		expect(outcome.exitCode).toBe(0);
		expect(calls).toBe(1);
	});

	it("exit 1 when the session is measured and the judgment fails", async () => {
		let calls = 0;
		const runSessionFn = async (): Promise<RunResult> => {
			calls++;
			return { ok: true, observation: observation("something else") };
		};
		const outcome = await runProbe(
			{ session, judgment: { kind: "sentinel", text: "PONG" } },
			{ runSessionFn },
		);
		expect(outcome.exitCode).toBe(1);
		expect(calls).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// unmeasurable — exit 2, distinct from a measured fail (AC3).
// ---------------------------------------------------------------------------

describe("runProbe / unmeasurable outcomes", () => {
	it("exit 2 when the session cannot be measured, and only tries once by default", async () => {
		let calls = 0;
		const runSessionFn = async (): Promise<RunResult> => {
			calls++;
			return { ok: false, reason: "timeout", detail: "did not exit in time" };
		};
		const outcome = await runProbe(
			{ session, judgment: { kind: "sentinel", text: "PONG" } },
			{ runSessionFn },
		);
		expect(outcome.exitCode).toBe(2);
		if (outcome.exitCode === 2) {
			expect(outcome.reason).toBe("timeout");
		}
		expect(calls).toBe(1);
	});

	// CONFIRMED defect (code-review), at the exit-code level: an `absent`
	// judgment whose positiveControl never appeared measured NOTHING about the
	// literals under test — this must map to exit 2 (judgment-unmeasurable),
	// never the vacuous exit 0 a bare boolean evaluateJudgment would produce.
	it("exit 2 (judgment-unmeasurable) when the session is measured (ok: true) but the absent judgment's positiveControl never appeared — never a vacuous exit 0", async () => {
		const runSessionFn = async (): Promise<RunResult> => ({ ok: true, observation: observation("no control sentinel here") });
		const outcome = await runProbe(
			{
				session,
				judgment: { kind: "absent", literals: ["FORBIDDEN"], fields: undefined, positiveControl: "CONTROL_SENTINEL" },
			},
			{ runSessionFn },
		);
		expect(outcome.exitCode).toBe(2);
		if (outcome.exitCode === 2) {
			expect(outcome.reason).toBe("judgment-unmeasurable");
		}
	});

	it("exit 0 when the same gated absent judgment's positiveControl IS observed and nothing forbidden leaked", async () => {
		const runSessionFn = async (): Promise<RunResult> => ({ ok: true, observation: observation("CONTROL_SENTINEL, all clean") });
		const outcome = await runProbe(
			{ session, judgment: { kind: "absent", literals: ["FORBIDDEN"], positiveControl: "CONTROL_SENTINEL" } },
			{ runSessionFn },
		);
		expect(outcome.exitCode).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// retry policy (AC4): retry ONLY on unmeasurable; a measured failure is
// NEVER retried, even when attempts > 1.
// ---------------------------------------------------------------------------

describe("runProbe / retry policy", () => {
	it("retries an unmeasurable outcome up to `attempts`, succeeding on the last try", async () => {
		let calls = 0;
		const runSessionFn = async (): Promise<RunResult> => {
			calls++;
			if (calls < 3) return { ok: false, reason: "timeout", detail: "flaky" };
			return { ok: true, observation: observation("PONG") };
		};
		const outcome = await runProbe(
			{ session, judgment: { kind: "sentinel", text: "PONG" } },
			{ runSessionFn, attempts: 3 },
		);
		expect(outcome.exitCode).toBe(0);
		expect(calls).toBe(3);
	});

	it("gives up at exit 2 after exhausting all attempts on a persistently unmeasurable session", async () => {
		let calls = 0;
		const runSessionFn = async (): Promise<RunResult> => {
			calls++;
			return { ok: false, reason: "codex-binary-missing", detail: "no codex" };
		};
		const outcome = await runProbe(
			{ session, judgment: { kind: "sentinel", text: "PONG" } },
			{ runSessionFn, attempts: 3 },
		);
		expect(outcome.exitCode).toBe(2);
		expect(calls).toBe(3);
	});

	it("NEVER retries a measured failure, even when attempts > 1 — retrying a real regression would let it masquerade as flake", async () => {
		let calls = 0;
		const runSessionFn = async (): Promise<RunResult> => {
			calls++;
			return { ok: true, observation: observation("wrong text") };
		};
		const outcome = await runProbe(
			{ session, judgment: { kind: "sentinel", text: "PONG" } },
			{ runSessionFn, attempts: 5 },
		);
		expect(outcome.exitCode).toBe(1);
		expect(calls).toBe(1);
	});

	it("defaults to a strict single attempt when `attempts` is omitted", async () => {
		let calls = 0;
		const runSessionFn = async (): Promise<RunResult> => {
			calls++;
			return { ok: false, reason: "timeout", detail: "flaky" };
		};
		const outcome = await runProbe({ session, judgment: { kind: "sentinel", text: "PONG" } }, { runSessionFn });
		expect(outcome.exitCode).toBe(2);
		expect(calls).toBe(1);
	});
});

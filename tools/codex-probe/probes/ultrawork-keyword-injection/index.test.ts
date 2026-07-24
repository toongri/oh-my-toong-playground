/**
 * Hermetic tests for buildProbeSpec, parseArm, and the runEntry exit-code
 * contract — pure/no-network where possible; `runEntry`'s measured-outcome
 * cases inject `runSessionFn` so no real codex spawn happens. The real,
 * generative behavior (does codex-keyword-detector.sh actually fire) is
 * exercised by actually running each arm once against real codex — see the
 * task's completion report for that RED/GREEN evidence.
 */

import { describe, expect, it } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";

import type { RunResult } from "../../types.ts";
import { buildProbeSpec, main, parseArm, runEntry } from "./index.ts";
import { OBJECTIVE_MARKER, ULTRAWORK_SENTINEL } from "./judgment.ts";

function observation(injectedContext: string, finalMessage: string | null = "done"): {
	events: never[];
	toolCalls: never[];
	baseInstructions: string;
	injectedContext: string;
	finalMessage: string | null;
	rawStdout: string;
	stderr: string;
} {
	return { events: [], toolCalls: [], baseInstructions: "", injectedContext, finalMessage, rawStdout: "", stderr: "" };
}

describe("buildProbeSpec", () => {
	const isolated = { home: "/tmp/some-home", codexHome: "/tmp/some-home/.codex" };

	it("present arm: prompt leads with 'ultrawork '", () => {
		const spec = buildProbeSpec("/tmp/some-cwd", "present", isolated);
		expect(spec.session.prompt.startsWith("ultrawork ")).toBe(true);
	});

	it("broken arm: prompt is identical to the present arm's (same keyword, same objective)", () => {
		const present = buildProbeSpec("/tmp/some-cwd", "present", isolated);
		const broken = buildProbeSpec("/tmp/some-cwd", "broken", isolated);
		expect(broken.session.prompt).toBe(present.session.prompt);
	});

	it("absent arm: prompt does NOT contain the bare word 'ultrawork'", () => {
		const spec = buildProbeSpec("/tmp/some-cwd", "absent", isolated);
		expect(/\bultrawork\b/.test(spec.session.prompt)).toBe(false);
	});

	it("wires HOME/CODEX_HOME from the given isolated pair into session.env, and codexHome at the spec level for rollout correlation", () => {
		const spec = buildProbeSpec("/tmp/some-cwd", "present", isolated);
		expect(spec.session.env).toEqual({ HOME: isolated.home, CODEX_HOME: isolated.codexHome });
		expect(spec.codexHome).toBe(isolated.codexHome);
	});

	it("carries the hook-trust bypass flag, sandboxed read-only, with a finite timeout", () => {
		const spec = buildProbeSpec("/tmp/some-cwd", "present", isolated);
		expect(spec.session.extraArgs).toEqual(["--dangerously-bypass-hook-trust"]);
		expect(spec.session.sandbox).toBe("read-only");
		expect(typeof spec.session.timeoutMs).toBe("number");
		expect(spec.session.timeoutMs).toBeGreaterThan(0);
	});

	// CONFIRMED-defect-shaped guard: "broken" MUST reuse the SAME positive
	// judgment as "present" (not an inverted one) — the whole point of that
	// arm is that under a broken mechanism, the "sentinel present" judgment
	// itself flips to measured-false. An inverted judgment here would make
	// "broken" trivially pass regardless of whether the mechanism is broken.
	it("present and broken arms share the identical judgment (sentinel-present, injectedContext-scoped)", () => {
		const present = buildProbeSpec("/tmp/some-cwd", "present", isolated);
		const broken = buildProbeSpec("/tmp/some-cwd", "broken", isolated);
		expect(broken.judgment).toEqual(present.judgment);
		expect(present.judgment).toEqual({ kind: "sentinel", text: ULTRAWORK_SENTINEL, fields: ["injectedContext"] });
	});

	it("absent arm uses the inverted (expect-absent) judgment, gated by a positiveControl (CONFIRMED-defect fix: an ungated absent judgment passes vacuously on an empty injectedContext)", () => {
		const spec = buildProbeSpec("/tmp/some-cwd", "absent", isolated);
		expect(spec.judgment).toEqual({ kind: "absent", literals: [ULTRAWORK_SENTINEL], fields: ["injectedContext"], positiveControl: OBJECTIVE_MARKER });
	});
});

describe("parseArm", () => {
	it("accepts --arm=present, --arm=absent, --arm=broken", () => {
		expect(parseArm(["node", "index.ts", "--arm=present"])).toBe("present");
		expect(parseArm(["node", "index.ts", "--arm=absent"])).toBe("absent");
		expect(parseArm(["node", "index.ts", "--arm=broken"])).toBe("broken");
	});

	it("throws on a missing --arm flag", () => {
		expect(() => parseArm(["node", "index.ts"])).toThrow();
	});

	it("throws on an unrecognized arm value", () => {
		expect(() => parseArm(["node", "index.ts", "--arm=bogus"])).toThrow();
	});
});

describe("main — hooks.json wiring per arm (hermetic: real mkdtemp/auth-copy, no codex spawn)", () => {
	it("hooks.json for present/absent carries codex-keyword-detector.sh; broken arm's CODEX_HOME has no hooks.json at all", async () => {
		const scratchParent = await fs.mkdtemp(path.join(os.tmpdir(), "ultrawork-hooksjson-test-"));
		const authSourcePath = path.join(scratchParent, "fixture-auth.json");
		await fs.writeFile(authSourcePath, "{}");
		try {
			const { buildIsolatedCodexHome } = await import("../../isolated-codex-home.ts");
			const presentRoot = path.join(scratchParent, "present");
			const presentIsolated = await buildIsolatedCodexHome(
				presentRoot,
				{ UserPromptSubmit: [{ command: "/some/repo/hooks/codex-keyword-detector.sh", timeout: 10 }] },
				{ authSourcePath },
			);
			const presentHooks = JSON.parse(await fs.readFile(path.join(presentIsolated.codexHome, "hooks.json"), "utf8"));
			expect(presentHooks.hooks.UserPromptSubmit[0].hooks[0].command).toContain("codex-keyword-detector.sh");

			const brokenRoot = path.join(scratchParent, "broken");
			const brokenIsolated = await buildIsolatedCodexHome(brokenRoot, {}, { authSourcePath });
			const brokenHooksExists = await fs
				.stat(path.join(brokenIsolated.codexHome, "hooks.json"))
				.then(() => true)
				.catch(() => false);
			expect(brokenHooksExists).toBe(false);
		} finally {
			await fs.rm(scratchParent, { recursive: true, force: true });
		}
	});

	// CONFIRMED defect (code-review): the test above never exercises main()'s
	// OWN arm-branching decision (`arm === "broken" ? {} : {...}`) — it
	// hand-reconstructs both expected end states via a SEPARATE, direct call to
	// buildIsolatedCodexHome, bypassing main()'s actual branch entirely. If
	// main()'s own condition were inverted, this test would keep passing while
	// the RED arm silently registered the hook anyway. The tests below instead
	// inject a `runSessionFn` stub that reads `opts.codexHome` — the REAL
	// isolated CODEX_HOME main() itself built — resolving BEFORE main()'s own
	// `finally` rm -rf runs, so a flipped branch condition in index.ts is what
	// these tests would actually catch.
	describe("CONFIRMED-defect fix — arm branching verified against main()'s OWN real output, not a hand-reconstructed stand-in", () => {
		it("broken arm: the ACTUAL isolated CODEX_HOME main() built has no hooks.json at all", async () => {
			const scratchParent = await fs.mkdtemp(path.join(os.tmpdir(), "ultrawork-broken-arm-direct-"));
			const authSourcePath = path.join(scratchParent, "fixture-auth.json");
			await fs.writeFile(authSourcePath, "{}");
			try {
				let hooksJsonExists: boolean | undefined;
				const runSessionFn = async (_config: unknown, opts: { codexHome?: string }): Promise<RunResult> => {
					hooksJsonExists = await fs
						.stat(path.join(opts.codexHome ?? "", "hooks.json"))
						.then(() => true)
						.catch(() => false);
					return { ok: true, observation: observation("no sentinel here") };
				};
				const code = await runEntry(["node", "index.ts", "--arm=broken"], {
					scratchRoot: path.join(scratchParent, "scratch"),
					authSourcePath,
					runSessionFn,
				});
				expect(hooksJsonExists).toBe(false);
				expect(code).toBe(1); // sentinel absent under a genuinely broken mechanism — the correct/expected outcome
			} finally {
				await fs.rm(scratchParent, { recursive: true, force: true });
			}
		});

		it("present arm: the ACTUAL isolated CODEX_HOME main() built DOES have a hooks.json (the SAME arm-branch line, opposite condition)", async () => {
			const scratchParent = await fs.mkdtemp(path.join(os.tmpdir(), "ultrawork-present-arm-direct-"));
			const authSourcePath = path.join(scratchParent, "fixture-auth.json");
			await fs.writeFile(authSourcePath, "{}");
			try {
				let hooksJsonExists: boolean | undefined;
				const runSessionFn = async (_config: unknown, opts: { codexHome?: string }): Promise<RunResult> => {
					hooksJsonExists = await fs
						.stat(path.join(opts.codexHome ?? "", "hooks.json"))
						.then(() => true)
						.catch(() => false);
					return { ok: true, observation: observation(ULTRAWORK_SENTINEL) };
				};
				const code = await runEntry(["node", "index.ts", "--arm=present"], {
					scratchRoot: path.join(scratchParent, "scratch"),
					authSourcePath,
					runSessionFn,
				});
				expect(hooksJsonExists).toBe(true);
				expect(code).toBe(0);
			} finally {
				await fs.rm(scratchParent, { recursive: true, force: true });
			}
		});
	});
});

describe("runEntry / exit-code contract (probe.ts's trichotomy: 0 pass, 1 measured fail, 2 unmeasurable)", () => {
	it("an invalid --arm= value maps to exit 2", async () => {
		const code = await runEntry(["node", "index.ts", "--arm=bogus"]);
		expect(code).toBe(2);
	});

	it("a missing --arm flag maps to exit 2", async () => {
		const code = await runEntry(["node", "index.ts"]);
		expect(code).toBe(2);
	});

	it("an exception raised before the codex spawn (missing auth fixture) maps to exit 2 — never bun's uncaught-throw exit 1", async () => {
		const scratchParent = await fs.mkdtemp(path.join(os.tmpdir(), "ultrawork-red-exec-"));
		try {
			const code = await runEntry(["node", "index.ts", "--arm=present"], {
				scratchRoot: path.join(scratchParent, "scratch"),
				authSourcePath: path.join(scratchParent, "does-not-exist.json"),
			});
			expect(code).toBe(2);
		} finally {
			await fs.rm(scratchParent, { recursive: true, force: true });
		}
	});

	it("negative control: a real measured session where the sentinel never appears stays exit 1 for the present arm, not exit 2", async () => {
		const scratchParent = await fs.mkdtemp(path.join(os.tmpdir(), "ultrawork-fail-"));
		const authSourcePath = path.join(scratchParent, "fixture-auth.json");
		await fs.writeFile(authSourcePath, "{}");
		try {
			const runSessionFn = async (): Promise<RunResult> => ({ ok: true, observation: observation("no sentinel here") });
			const code = await runEntry(["node", "index.ts", "--arm=present"], {
				scratchRoot: path.join(scratchParent, "scratch"),
				authSourcePath,
				runSessionFn,
			});
			expect(code).toBe(1);
		} finally {
			await fs.rm(scratchParent, { recursive: true, force: true });
		}
	});

	it("positive control: a real measured session where the sentinel appears in injectedContext stays exit 0 for the present arm", async () => {
		const scratchParent = await fs.mkdtemp(path.join(os.tmpdir(), "ultrawork-pass-"));
		const authSourcePath = path.join(scratchParent, "fixture-auth.json");
		await fs.writeFile(authSourcePath, "{}");
		try {
			const runSessionFn = async (): Promise<RunResult> => ({ ok: true, observation: observation(ULTRAWORK_SENTINEL) });
			const code = await runEntry(["node", "index.ts", "--arm=present"], {
				scratchRoot: path.join(scratchParent, "scratch"),
				authSourcePath,
				runSessionFn,
			});
			expect(code).toBe(0);
		} finally {
			await fs.rm(scratchParent, { recursive: true, force: true });
		}
	});

	it("absent arm: a session where the positive control was captured and the sentinel never appears (correct — no keyword was sent) maps to exit 0", async () => {
		const scratchParent = await fs.mkdtemp(path.join(os.tmpdir(), "ultrawork-absent-pass-"));
		const authSourcePath = path.join(scratchParent, "fixture-auth.json");
		await fs.writeFile(authSourcePath, "{}");
		try {
			const runSessionFn = async (): Promise<RunResult> => ({ ok: true, observation: observation(`${OBJECTIVE_MARKER} check, no sentinel here`) });
			const code = await runEntry(["node", "index.ts", "--arm=absent"], {
				scratchRoot: path.join(scratchParent, "scratch"),
				authSourcePath,
				runSessionFn,
			});
			expect(code).toBe(0);
		} finally {
			await fs.rm(scratchParent, { recursive: true, force: true });
		}
	});

	it("absent arm: a session where the positive control was captured and the sentinel leaks in anyway (control failed to discriminate) maps to exit 1, not exit 0", async () => {
		const scratchParent = await fs.mkdtemp(path.join(os.tmpdir(), "ultrawork-absent-fail-"));
		const authSourcePath = path.join(scratchParent, "fixture-auth.json");
		await fs.writeFile(authSourcePath, "{}");
		try {
			const runSessionFn = async (): Promise<RunResult> => ({ ok: true, observation: observation(`${OBJECTIVE_MARKER} check\n${ULTRAWORK_SENTINEL}`) });
			const code = await runEntry(["node", "index.ts", "--arm=absent"], {
				scratchRoot: path.join(scratchParent, "scratch"),
				authSourcePath,
				runSessionFn,
			});
			expect(code).toBe(1);
		} finally {
			await fs.rm(scratchParent, { recursive: true, force: true });
		}
	});

	// CONFIRMED-defect regression (code-review): before the positiveControl
	// gate, a totally empty injectedContext (a capture bug — the mechanism
	// under test never even ran) made the "absent" judgment pass vacuously
	// (exit 0), indistinguishable from a real negative. It must now report
	// exit 2 (judgment-unmeasurable), never exit 0.
	it("absent arm: a session whose injectedContext capture is totally empty (no positive control observed) maps to exit 2, never a vacuous exit 0", async () => {
		const scratchParent = await fs.mkdtemp(path.join(os.tmpdir(), "ultrawork-absent-unmeasurable-"));
		const authSourcePath = path.join(scratchParent, "fixture-auth.json");
		await fs.writeFile(authSourcePath, "{}");
		try {
			const runSessionFn = async (): Promise<RunResult> => ({ ok: true, observation: observation("") });
			const code = await runEntry(["node", "index.ts", "--arm=absent"], {
				scratchRoot: path.join(scratchParent, "scratch"),
				authSourcePath,
				runSessionFn,
			});
			expect(code).toBe(2);
		} finally {
			await fs.rm(scratchParent, { recursive: true, force: true });
		}
	});

	// broken arm's discriminating-power contract, at the exit-code level: reusing
	// the SAME positive judgment as "present" means a session where the sentinel
	// never appears (exactly what a truly broken mechanism would produce) MUST
	// map to exit 1 here too — this is the RED demonstration this arm exists for.
	it("broken arm: a session where the sentinel never appears (mechanism genuinely broken) maps to exit 1 — the correct/expected outcome, not something to chase to green", async () => {
		const scratchParent = await fs.mkdtemp(path.join(os.tmpdir(), "ultrawork-broken-"));
		const authSourcePath = path.join(scratchParent, "fixture-auth.json");
		await fs.writeFile(authSourcePath, "{}");
		try {
			const runSessionFn = async (): Promise<RunResult> => ({ ok: true, observation: observation("no sentinel here") });
			const code = await runEntry(["node", "index.ts", "--arm=broken"], {
				scratchRoot: path.join(scratchParent, "scratch"),
				authSourcePath,
				runSessionFn,
			});
			expect(code).toBe(1);
		} finally {
			await fs.rm(scratchParent, { recursive: true, force: true });
		}
	});
});

describe("main", () => {
	it("takes exactly (arm, opts) — no implicit global state", () => {
		expect(main.length).toBe(1);
	});
});

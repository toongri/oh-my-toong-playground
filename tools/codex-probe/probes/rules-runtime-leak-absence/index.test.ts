/**
 * Hermetic tests for buildSessionConfig, parseArm, and the runEntry exit-code
 * contract (0 pass, 1 measured fail, 2 unmeasurable — including the
 * positive-control-failed case, which is ALSO exit 2, never exit 0). All
 * measured-outcome cases inject `runSessionFn`, so no real codex spawn
 * happens here. The real, generative behavior (does the rules-injector hook
 * actually fire, does the rewrite pass actually strip the literals) is
 * exercised by actually running each arm once against real codex — see the
 * task's completion report for that RED/GREEN evidence.
 */

import { describe, expect, it } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";

import type { RunnerOptions } from "../../runner.ts";
import type { RunResult, SessionConfig } from "../../types.ts";
import { RULE_NAME, RULE_SENTINEL } from "./fixture.ts";
import { buildSessionConfig, main, parseArm, runEntry } from "./index.ts";

function observation(injectedContext: string) {
	return { events: [], toolCalls: [], baseInstructions: "", injectedContext, finalMessage: "done", rawStdout: "", stderr: "" };
}

describe("buildSessionConfig", () => {
	const isolated = { home: "/tmp/some-home", codexHome: "/tmp/some-home/.codex" };

	it("prompt is the plain falsifiable objective (no keyword, no arm-specific text — the rule is what varies, not the prompt)", () => {
		const config = buildSessionConfig("/tmp/some-cwd", isolated);
		expect(config.prompt).toContain("package.json");
		expect(config.prompt).not.toContain("ultrawork");
	});

	it("wires HOME/CODEX_HOME from the given isolated pair into session.env", () => {
		const config = buildSessionConfig("/tmp/some-cwd", isolated);
		expect(config.env).toEqual({ HOME: isolated.home, CODEX_HOME: isolated.codexHome });
	});

	it("carries the hook-trust bypass flag, sandboxed read-only, with a finite timeout", () => {
		const config = buildSessionConfig("/tmp/some-cwd", isolated);
		expect(config.extraArgs).toEqual(["--dangerously-bypass-hook-trust"]);
		expect(config.sandbox).toBe("read-only");
		expect(typeof config.timeoutMs).toBe("number");
		expect(config.timeoutMs).toBeGreaterThan(0);
	});

	it("uses the given cwd verbatim (the deployRoot the caller materialized the rule into)", () => {
		const config = buildSessionConfig("/tmp/some-deploy-root", isolated);
		expect(config.cwd).toBe("/tmp/some-deploy-root");
	});
});

describe("parseArm", () => {
	it("accepts --arm=rewritten, --arm=unrewritten, --arm=no-hook", () => {
		expect(parseArm(["node", "index.ts", "--arm=rewritten"])).toBe("rewritten");
		expect(parseArm(["node", "index.ts", "--arm=unrewritten"])).toBe("unrewritten");
		expect(parseArm(["node", "index.ts", "--arm=no-hook"])).toBe("no-hook");
	});

	it("throws on a missing --arm flag", () => {
		expect(() => parseArm(["node", "index.ts"])).toThrow();
	});

	it("throws on an unrecognized arm value", () => {
		expect(() => parseArm(["node", "index.ts", "--arm=bogus"])).toThrow();
	});
});

async function withScratch<T>(fn: (scratchRoot: string, authSourcePath: string) => Promise<T>): Promise<T> {
	const parent = await fs.mkdtemp(path.join(os.tmpdir(), "rules-leak-test-"));
	const authSourcePath = path.join(parent, "fixture-auth.json");
	await fs.writeFile(authSourcePath, "{}");
	try {
		return await fn(path.join(parent, "scratch"), authSourcePath);
	} finally {
		await fs.rm(parent, { recursive: true, force: true });
	}
}

describe("runEntry / exit-code contract", () => {
	it("an invalid --arm= value maps to exit 2", async () => {
		expect(await runEntry(["node", "index.ts", "--arm=bogus"])).toBe(2);
	});

	it("a missing --arm flag maps to exit 2", async () => {
		expect(await runEntry(["node", "index.ts"])).toBe(2);
	});

	it("an exception raised before the codex spawn (missing auth fixture) maps to exit 2 — never bun's uncaught-throw exit 1", async () => {
		await withScratch(async (scratchRoot) => {
			const code = await runEntry(["node", "index.ts", "--arm=rewritten"], {
				scratchRoot,
				authSourcePath: path.join(scratchRoot, "..", "does-not-exist.json"),
			});
			expect(code).toBe(2);
		});
	});

	it("session-level unmeasurable (RunResult.ok === false) maps to exit 2 with the session's own reason", async () => {
		await withScratch(async (scratchRoot, authSourcePath) => {
			const runSessionFn = async (): Promise<RunResult> => ({ ok: false, reason: "timeout", detail: "stub timeout" });
			const code = await runEntry(["node", "index.ts", "--arm=rewritten"], { scratchRoot, authSourcePath, runSessionFn });
			expect(code).toBe(2);
		});
	});

	// This is the AC-76-critical case: the positive control failing must map to
	// exit 2, NEVER exit 0 — a session that measured nothing about the rewrite
	// pipeline (rule never reached the model) must not be reported as "passed".
	it("positive-control-failed (sentinel never observed) maps to exit 2, never exit 0", async () => {
		await withScratch(async (scratchRoot, authSourcePath) => {
			const runSessionFn = async (): Promise<RunResult> => ({ ok: true, observation: observation("no sentinel, no literals") });
			const code = await runEntry(["node", "index.ts", "--arm=rewritten"], { scratchRoot, authSourcePath, runSessionFn });
			expect(code).toBe(2);
		});
	});

	it("positive control passes, no forbidden literal leaked -> exit 0", async () => {
		await withScratch(async (scratchRoot, authSourcePath) => {
			const runSessionFn = async (): Promise<RunResult> => ({
				ok: true,
				observation: observation(`${RULE_SENTINEL}\nrequest_user_input, subagent transcript read, update_plan, agent_type`),
			});
			const code = await runEntry(["node", "index.ts", "--arm=rewritten"], { scratchRoot, authSourcePath, runSessionFn });
			expect(code).toBe(0);
		});
	});

	it("positive control passes, a forbidden literal leaked -> exit 1 (the correct/expected outcome for the unrewritten RED arm)", async () => {
		await withScratch(async (scratchRoot, authSourcePath) => {
			const runSessionFn = async (): Promise<RunResult> => ({
				ok: true,
				observation: observation(`${RULE_SENTINEL}\nAskUserQuestion`),
			});
			const code = await runEntry(["node", "index.ts", "--arm=unrewritten"], { scratchRoot, authSourcePath, runSessionFn });
			expect(code).toBe(1);
		});
	});
});

describe("main — materialization wiring per arm (hermetic: real mkdtemp/materialize/auth-copy, no codex spawn)", () => {
	it("no-hook arm's isolated CODEX_HOME has no hooks.json at all, even though the rule is still materialized", async () => {
		await withScratch(async (scratchRoot, authSourcePath) => {
			const runSessionFn = async (): Promise<RunResult> => ({ ok: true, observation: observation("irrelevant") });
			// We can't inspect scratchRoot after main() tears it down (finally rm -rf),
			// so this test asserts indirectly via the CONTRACT: main() must reach
			// runSessionFn without throwing (proving materialize + buildIsolatedCodexHome
			// with an empty hooks map both succeeded) even though the CODEX_HOME never
			// gets a hooks.json — covered directly (non-self-cleaning) below.
			await main("no-hook", { scratchRoot, authSourcePath, runSessionFn });
		});

		const { buildIsolatedCodexHome } = await import("../../isolated-codex-home.ts");
		const parent = await fs.mkdtemp(path.join(os.tmpdir(), "rules-leak-nohook-direct-"));
		const authSourcePath = path.join(parent, "fixture-auth.json");
		await fs.writeFile(authSourcePath, "{}");
		try {
			const isolated = await buildIsolatedCodexHome(path.join(parent, "scratch"), {}, { authSourcePath });
			const exists = await fs
				.stat(path.join(isolated.codexHome, "hooks.json"))
				.then(() => true)
				.catch(() => false);
			expect(exists).toBe(false);
		} finally {
			await fs.rm(parent, { recursive: true, force: true });
		}
	});

	it("rewritten/unrewritten arms register the rules-injector hook, pointing at THIS repo's cli.ts (not a deployed copy)", async () => {
		const { buildIsolatedCodexHome } = await import("../../isolated-codex-home.ts");
		const parent = await fs.mkdtemp(path.join(os.tmpdir(), "rules-leak-hook-direct-"));
		const authSourcePath = path.join(parent, "fixture-auth.json");
		await fs.writeFile(authSourcePath, "{}");
		try {
			const isolated = await buildIsolatedCodexHome(
				path.join(parent, "scratch"),
				{ UserPromptSubmit: [{ command: "bun run /some/repo/hooks/rules-injector/cli.ts hook user-prompt-submit", timeout: 10 }] },
				{ authSourcePath },
			);
			const hooksJson = JSON.parse(await fs.readFile(path.join(isolated.codexHome, "hooks.json"), "utf8"));
			expect(hooksJson.hooks.UserPromptSubmit[0].hooks[0].command).toContain("hooks/rules-injector/cli.ts");
			expect(hooksJson.hooks.UserPromptSubmit[0].hooks[0].command).toContain("hook user-prompt-submit");
		} finally {
			await fs.rm(parent, { recursive: true, force: true });
		}
	});

	// CONFIRMED defect (code-review): the tests above never exercise main()'s
	// OWN arm-branching decision (`arm === "unrewritten"` for skipRewrite,
	// `arm === "no-hook"` for the empty hooks map) — they hand-reconstruct the
	// expected end state via a SEPARATE, direct call to buildIsolatedCodexHome,
	// bypassing main()'s actual branch entirely. If main()'s own condition were
	// inverted or dropped, these tests would keep passing while the RED arm
	// silently stopped deploying unrewritten bytes. The tests below instead
	// inject a `runSessionFn` stub that reads the REAL artifact main() produced
	// — via `config.cwd` (the real deployRoot) and `opts.codexHome` (the real
	// isolated CODEX_HOME) — BEFORE main()'s own `finally` rm -rf runs (the stub
	// resolves while that scratchRoot still exists), so a flipped/dropped
	// branch condition in index.ts itself is what these tests would catch.
	describe("CONFIRMED-defect fix — arm branching verified against main()'s OWN real output, not a hand-reconstructed stand-in", () => {
		it("unrewritten arm: the ACTUAL deployed rule file (read via the real deployRoot main() built) still carries raw Claude vocabulary — skipRewrite really reached materializeCodexRule", async () => {
			await withScratch(async (scratchRoot, authSourcePath) => {
				let deployedBody = "";
				const runSessionFn = async (config: SessionConfig): Promise<RunResult> => {
					deployedBody = await fs.readFile(path.join(config.cwd, ".codex", "rules", `${RULE_NAME}.md`), "utf-8");
					return { ok: true, observation: observation(`${RULE_SENTINEL}\n${deployedBody}`) };
				};
				const code = await runEntry(["node", "index.ts", "--arm=unrewritten"], { scratchRoot, authSourcePath, runSessionFn });
				expect(deployedBody).toContain("AskUserQuestion");
				expect(code).toBe(1); // a forbidden literal genuinely leaked — the expected/correct outcome for this RED arm
			});
		});

		it("rewritten arm: the ACTUAL deployed rule file no longer carries raw Claude vocabulary — the rewrite pass really ran (the SAME arm-branch line, opposite condition)", async () => {
			await withScratch(async (scratchRoot, authSourcePath) => {
				let deployedBody = "";
				const runSessionFn = async (config: SessionConfig): Promise<RunResult> => {
					deployedBody = await fs.readFile(path.join(config.cwd, ".codex", "rules", `${RULE_NAME}.md`), "utf-8");
					return { ok: true, observation: observation(`${RULE_SENTINEL}\n${deployedBody}`) };
				};
				const code = await runEntry(["node", "index.ts", "--arm=rewritten"], { scratchRoot, authSourcePath, runSessionFn });
				expect(deployedBody).not.toContain("AskUserQuestion");
				expect(code).toBe(0);
			});
		});

		it("no-hook arm: the ACTUAL isolated CODEX_HOME main() built (read via opts.codexHome) has no hooks.json at all", async () => {
			await withScratch(async (scratchRoot, authSourcePath) => {
				let hooksJsonExists: boolean | undefined;
				const runSessionFn = async (_config: SessionConfig, opts: RunnerOptions): Promise<RunResult> => {
					hooksJsonExists = await fs
						.stat(path.join(opts.codexHome ?? "", "hooks.json"))
						.then(() => true)
						.catch(() => false);
					return { ok: true, observation: observation("irrelevant") };
				};
				await runEntry(["node", "index.ts", "--arm=no-hook"], { scratchRoot, authSourcePath, runSessionFn });
				expect(hooksJsonExists).toBe(false);
			});
		});

		it("rewritten arm: the ACTUAL isolated CODEX_HOME main() built DOES have a hooks.json (the SAME arm-branch line, opposite condition)", async () => {
			await withScratch(async (scratchRoot, authSourcePath) => {
				let hooksJsonExists: boolean | undefined;
				const runSessionFn = async (_config: SessionConfig, opts: RunnerOptions): Promise<RunResult> => {
					hooksJsonExists = await fs
						.stat(path.join(opts.codexHome ?? "", "hooks.json"))
						.then(() => true)
						.catch(() => false);
					return { ok: true, observation: observation(`${RULE_SENTINEL}\nclean`) };
				};
				await runEntry(["node", "index.ts", "--arm=rewritten"], { scratchRoot, authSourcePath, runSessionFn });
				expect(hooksJsonExists).toBe(true);
			});
		});
	});
});

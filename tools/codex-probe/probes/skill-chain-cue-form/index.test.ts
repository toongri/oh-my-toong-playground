/**
 * Hermetic tests for buildProbeSpec and parseArm — pure, no codex spawn, no
 * filesystem access. `main()`/the `import.meta.main` CLI wiring is
 * intentionally left untested here, same rationale as
 * skill-chain-load/index.test.ts: pure I/O glue over already-tested units
 * (writeSyntheticFixture, materializeCodexSkills, runProbe, this spec
 * builder). The real, generative behavior is exercised by actually running
 * each arm once against real codex (see REPORT).
 *
 * The `runEntry` describe block below is the exception: it covers the
 * process-boundary exit-code contract itself (the bug this file was fixed
 * for — an invalid `--arm=` value or an in-flight exception escaping as
 * bun's uncaught-throw exit 1, which a code-review flagged as "measured
 * negative" instead of "unmeasurable"). Every case here stays hermetic by
 * injecting `runSessionFn` (never spawns real codex) or by forcing a failure
 * before runProbe is ever reached.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";

import type { RunResult } from "../../types.ts";
import { BETA_SENTINEL } from "./fixture.ts";
import { buildProbeSpec, parseArm, runEntry } from "./index.ts";

/** Extracts `<skill>` from a `.../skills/<skill>/SKILL.md`-shaped command, or null. */
function skillNameFromCommand(command: string): string | null {
	const match = command.match(/skills\/([^/]+)\/SKILL\.md/);
	return match ? match[1] : null;
}

/**
 * Builds a fake tool call per command. When the command names a
 * `<skill>/SKILL.md` path, its `aggregated_output` carries that skill's own
 * `name: <skill>` frontmatter line, with `exit_code: 0`/`status: "completed"`
 * — the content marker AND success shape skillFileWasOpened now requires
 * (see skill-chain-load/judgment.ts), so these test doubles behave like a
 * real successful read instead of a mere path mention.
 */
function observation(finalMessage: string | null, toolCommands: string[] = []) {
	return {
		events: [],
		toolCalls: toolCommands.map((command) => {
			const skillName = skillNameFromCommand(command);
			return {
				itemType: "command_execution",
				item: skillName ? { command, aggregated_output: `---\nname: ${skillName}\n---\n`, exit_code: 0, status: "completed" } : { command },
			};
		}),
		baseInstructions: "",
		injectedContext: "",
		finalMessage,
		rawStdout: "",
		stderr: "",
	};
}

/** Stand-in for a buildIsolatedCodexHome result — buildProbeSpec is pure, so no real dirs are needed. */
const ISOLATED = { home: "/tmp/iso-home", codexHome: "/tmp/iso-home/.codex" };

describe("buildProbeSpec", () => {
	// Regression guard (code-review, same class as skill-chain-load's): the
	// synthetic alpha/beta names make a NAME collision with an ambient home
	// skill impossible, but an un-isolated session still loads this machine's
	// home-scoped skills — including discovery-oriented ones that push a model
	// to sweep every available skill dir. Such a sweep opens beta regardless of
	// cue form, which would silently destroy the removed/oldprose arms' whole
	// discriminating purpose. Isolation must hold on EVERY arm, not just the
	// positive ones.
	it("isolates HOME and CODEX_HOME on every arm", () => {
		for (const arm of ["sigil", "prose", "removed", "oldprose"] as const) {
			const spec = buildProbeSpec("/tmp/x", arm, ISOLATED);
			expect(spec.session.env).toEqual({ HOME: ISOLATED.home, CODEX_HOME: ISOLATED.codexHome });
			expect(spec.codexHome).toBe(ISOLATED.codexHome);
			expect(spec.session.extraArgs).toBeUndefined();
		}
	});

	it("puts `$alpha` at the very front of the prompt (user-input position, mechanically loaded)", () => {
		const spec = buildProbeSpec("/tmp/some-deploy-root", "sigil", ISOLATED);
		expect(spec.session.prompt.startsWith("$alpha ")).toBe(true);
	});

	it("targets the given deployRoot as cwd, with a read-only sandbox and a finite timeout", () => {
		const spec = buildProbeSpec("/tmp/some-deploy-root", "sigil", ISOLATED);
		expect(spec.session.cwd).toBe("/tmp/some-deploy-root");
		expect(spec.session.sandbox).toBe("read-only");
		expect(typeof spec.session.timeoutMs).toBe("number");
		expect(spec.session.timeoutMs).toBeGreaterThan(0);
		expect(Number.isFinite(spec.session.timeoutMs)).toBe(true);
	});

	it("wires the cue-form predicate judgment", () => {
		const spec = buildProbeSpec("/tmp/some-deploy-root", "sigil", ISOLATED);
		expect(spec.judgment.kind).toBe("predicate");
	});

	// CONFIRMED defect: all four arms used to share ONE positive predicate, so
	// the "removed" negative control — which must FAIL if beta ever opens,
	// since no reference to beta exists anywhere in its fixture — instead
	// reported exit 0 ("pass") on exactly the outcome that disproves its own
	// discriminating power. Same for "oldprose", the OLD rule 6a's actual
	// output, which this probe exists to show is too weak a cue to reliably
	// open the target (see this probe's index.ts header comment on the four
	// arms). "sigil"/"prose" are the arms hypothesized to actually cause an
	// open; "removed"/"oldprose" must invert: passing means beta stayed
	// closed, exactly as the discriminating design requires.
	describe("CONFIRMED defect — removed/oldprose must use an INVERTED predicate (closed = pass), not the same positive predicate as sigil/prose", () => {
		const opened = observation(`done — ${BETA_SENTINEL}`, ["cat .agents/skills/beta/SKILL.md"]);
		const notOpened = observation("done, package.json exists: true.");

		it("sigil arm keeps the positive predicate: opened+reflected passes, closed fails", () => {
			const spec = buildProbeSpec("/tmp/x", "sigil", ISOLATED);
			if (spec.judgment.kind !== "predicate") throw new Error("unreachable");
			expect(spec.judgment.predicate(opened)).toBe(true);
			expect(spec.judgment.predicate(notOpened)).toBe(false);
		});

		it("prose arm keeps the positive predicate: opened+reflected passes, closed fails", () => {
			const spec = buildProbeSpec("/tmp/x", "prose", ISOLATED);
			if (spec.judgment.kind !== "predicate") throw new Error("unreachable");
			expect(spec.judgment.predicate(opened)).toBe(true);
			expect(spec.judgment.predicate(notOpened)).toBe(false);
		});

		it("removed arm inverts: staying closed passes, an open (control failed to discriminate) fails", () => {
			const spec = buildProbeSpec("/tmp/x", "removed", ISOLATED);
			if (spec.judgment.kind !== "predicate") throw new Error("unreachable");
			expect(spec.judgment.predicate(notOpened)).toBe(true);
			expect(spec.judgment.predicate(opened)).toBe(false);
		});

		it("oldprose arm inverts the same way as removed", () => {
			const spec = buildProbeSpec("/tmp/x", "oldprose", ISOLATED);
			if (spec.judgment.kind !== "predicate") throw new Error("unreachable");
			expect(spec.judgment.predicate(notOpened)).toBe(true);
			expect(spec.judgment.predicate(opened)).toBe(false);
		});
	});
});

describe("parseArm", () => {
	it("accepts --arm=sigil, --arm=prose, --arm=removed, --arm=oldprose", () => {
		expect(parseArm(["node", "index.ts", "--arm=sigil"])).toBe("sigil");
		expect(parseArm(["node", "index.ts", "--arm=prose"])).toBe("prose");
		expect(parseArm(["node", "index.ts", "--arm=removed"])).toBe("removed");
		expect(parseArm(["node", "index.ts", "--arm=oldprose"])).toBe("oldprose");
	});

	it("throws on a missing --arm flag", () => {
		expect(() => parseArm(["node", "index.ts"])).toThrow();
	});

	it("throws on an unrecognized arm value", () => {
		expect(() => parseArm(["node", "index.ts", "--arm=bogus"])).toThrow();
	});
});

describe("runEntry / exit-code contract (probe.ts's trichotomy: 0 pass, 1 measured fail, 2 unmeasurable)", () => {
	/**
	 * Throwaway `auth.json` for the isolated CODEX_HOME main() now builds. Every
	 * case that reaches buildIsolatedCodexHome MUST pass this: defaulting to the
	 * developer's real `~/.codex/auth.json` would make these tests read live
	 * credentials and pass or fail by machine state — the exact dependence this
	 * probe's isolation exists to remove.
	 */
	const FIXTURE_AUTH = path.join(os.tmpdir(), "skill-chain-cue-form-fixture-auth.json");
	beforeAll(async () => {
		await fs.writeFile(FIXTURE_AUTH, "{}");
	});
	afterAll(async () => {
		await fs.rm(FIXTURE_AUTH, { force: true });
	});

	it("a missing auth.json (isolated CODEX_HOME cannot be built) maps to exit 2 — unmeasurable, never a measured negative", async () => {
		const code = await runEntry(["node", "index.ts", "--arm=sigil"], {
			authSourcePath: path.join(os.tmpdir(), "skill-chain-cue-form-no-such-auth.json"),
		});
		expect(code).toBe(2);
	});

	it("an invalid --arm= value maps to exit 2 — never bun's uncaught-throw exit 1", async () => {
		const code = await runEntry(["node", "index.ts", "--arm=bogus"]);
		expect(code).toBe(2);
	});

	it("a missing --arm flag maps to exit 2", async () => {
		const code = await runEntry(["node", "index.ts"]);
		expect(code).toBe(2);
	});

	it("an exception raised before the codex spawn (unwritable scratch root) maps to exit 2 — never bun's uncaught-throw exit 1", async () => {
		const parent = await fs.mkdtemp(path.join(os.tmpdir(), "skill-chain-cue-form-red-exec-"));
		const badScratchRoot = path.join(parent, "readonly-scratch-root");
		await fs.mkdir(badScratchRoot);
		await fs.chmod(badScratchRoot, 0o444); // no write bit: writeSyntheticFixture's mkdir into it throws EACCES
		try {
			const code = await runEntry(["node", "index.ts", "--arm=sigil"], { scratchRoot: badScratchRoot });
			expect(code).toBe(2);
		} finally {
			await fs.chmod(badScratchRoot, 0o755).catch(() => {});
			await fs.rm(parent, { recursive: true, force: true });
		}
	});

	it("negative control: a real measured session that never opens+reflects the target skill stays exit 1, not exit 2 — proves the fix doesn't just collapse everything to 2", async () => {
		const runSessionFn = async (): Promise<RunResult> => ({ ok: true, observation: observation("no dice") });
		const code = await runEntry(["node", "index.ts", "--arm=sigil"], { runSessionFn, authSourcePath: FIXTURE_AUTH });
		expect(code).toBe(1);
	});

	it("positive control: a real measured session that opens the target skill AND reflects its sentinel stays exit 0", async () => {
		const runSessionFn = async (): Promise<RunResult> => ({
			ok: true,
			observation: observation(`done — ${BETA_SENTINEL}`, ["cat .agents/skills/beta/SKILL.md"]),
		});
		const code = await runEntry(["node", "index.ts", "--arm=sigil"], { runSessionFn, authSourcePath: FIXTURE_AUTH });
		expect(code).toBe(0);
	});

	// CONFIRMED defect 2, at the exit-code level: the "removed" arm's own
	// runEntry, given a session where beta somehow opened+reflected anyway,
	// must report exit 1 (the control failed to discriminate), never exit 0.
	it("removed arm: a session where beta opens+reflects anyway (control failed to discriminate) maps to exit 1, not exit 0", async () => {
		const runSessionFn = async (): Promise<RunResult> => ({
			ok: true,
			observation: observation(`done — ${BETA_SENTINEL}`, ["cat .agents/skills/beta/SKILL.md"]),
		});
		const code = await runEntry(["node", "index.ts", "--arm=removed"], { runSessionFn, authSourcePath: FIXTURE_AUTH });
		expect(code).toBe(1);
	});

	it("removed arm: a session where beta stays closed (control discriminates correctly) maps to exit 0", async () => {
		const runSessionFn = async (): Promise<RunResult> => ({ ok: true, observation: observation("done, package.json exists: true.") });
		const code = await runEntry(["node", "index.ts", "--arm=removed"], { runSessionFn, authSourcePath: FIXTURE_AUTH });
		expect(code).toBe(0);
	});
});

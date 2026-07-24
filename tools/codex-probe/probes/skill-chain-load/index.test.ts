/**
 * Hermetic tests for buildProbeSpec — pure, no codex spawn, no filesystem
 * access. `main()`/the `import.meta.main` CLI wiring is intentionally left
 * untested here: it is pure I/O glue (mkdtemp, materialize, runProbe, rm)
 * over already-tested units (materializeCodexSkills, runProbe, this spec
 * builder) — see materialize.test.ts, judgment.test.ts, and
 * tools/codex-probe/probe.test.ts for the logic each step actually carries.
 * The real, generative behavior is exercised by actually running the probe
 * once against real codex (see REPORT).
 *
 * The `runEntry` describe block below is the exception: it covers the
 * process-boundary exit-code contract itself (the bug this file was fixed
 * for — a config/usage error escaping as bun's uncaught-throw exit 1, which
 * a code-review flagged as "measured negative" instead of "unmeasurable").
 * Every case here stays hermetic by injecting `runSessionFn` (never spawns
 * real codex) or by forcing a failure before runProbe is ever reached.
 */

import { describe, expect, it } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";

import type { RunResult } from "../../types.ts";
import { buildProbeSpec, main, runEntry } from "./index.ts";

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
 * (see judgment.ts), so these test doubles behave like a real successful
 * read instead of a mere path mention.
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

describe("main", () => {
	it("takes no negative-control parameter — this probe answers only the load-trace-exists question (spec AC line 70); the causal sigil-vs-prose question moved to probes/skill-chain-cue-form", () => {
		expect(main.length).toBe(0);
	});
});

describe("buildProbeSpec", () => {
	it("puts `$goal` at the very front of the prompt (user-input position, so codex's mention scanner mechanically loads it)", () => {
		const spec = buildProbeSpec("/tmp/some-deploy-root");
		expect(spec.session.prompt.startsWith("$goal ")).toBe(true);
	});

	it("targets the given deployRoot as cwd, with a read-only sandbox and a finite timeout", () => {
		const spec = buildProbeSpec("/tmp/some-deploy-root");
		expect(spec.session.cwd).toBe("/tmp/some-deploy-root");
		expect(spec.session.sandbox).toBe("read-only");
		expect(typeof spec.session.timeoutMs).toBe("number");
		expect(spec.session.timeoutMs).toBeGreaterThan(0);
		expect(Number.isFinite(spec.session.timeoutMs)).toBe(true);
	});

	it("wires a predicate judgment checking for the sisyphus SKILL.md tool-call open", () => {
		const spec = buildProbeSpec("/tmp/some-deploy-root");
		expect(spec.judgment.kind).toBe("predicate");
		if (spec.judgment.kind !== "predicate") throw new Error("unreachable");
		const passing = {
			events: [],
			toolCalls: [
				{
					itemType: "command_execution",
					item: { command: "cat .agents/skills/sisyphus/SKILL.md", aggregated_output: "---\nname: sisyphus\n---\n", exit_code: 0, status: "completed" },
				},
			],
			baseInstructions: "",
			injectedContext: "",
			finalMessage: null,
			rawStdout: "",
			stderr: "",
		};
		expect(spec.judgment.predicate(passing)).toBe(true);
	});
});

describe("runEntry / exit-code contract (probe.ts's trichotomy: 0 pass, 1 measured fail, 2 unmeasurable)", () => {
	it("an exception raised before the codex spawn (unwritable deploy root) maps to exit 2 — never bun's uncaught-throw exit 1", async () => {
		const parent = await fs.mkdtemp(path.join(os.tmpdir(), "skill-chain-load-red-exec-"));
		const badDeployRoot = path.join(parent, "readonly-deploy-root");
		await fs.mkdir(badDeployRoot);
		await fs.chmod(badDeployRoot, 0o444); // no write bit: materializeCodexSkills' mkdir into it throws EACCES
		try {
			const code = await runEntry({ deployRoot: badDeployRoot });
			expect(code).toBe(2);
		} finally {
			await fs.chmod(badDeployRoot, 0o755).catch(() => {});
			await fs.rm(parent, { recursive: true, force: true });
		}
	});

	it("negative control: a real measured session that never opens the target skill stays exit 1, not exit 2 — proves the fix doesn't just collapse everything to 2", async () => {
		const runSessionFn = async (): Promise<RunResult> => ({ ok: true, observation: observation("no dice") });
		const code = await runEntry({ runSessionFn });
		expect(code).toBe(1);
	});

	it("positive control: a real measured session that opens the target skill stays exit 0", async () => {
		const runSessionFn = async (): Promise<RunResult> => ({
			ok: true,
			observation: observation("done", ["cat .agents/skills/sisyphus/SKILL.md"]),
		});
		const code = await runEntry({ runSessionFn });
		expect(code).toBe(0);
	});
});

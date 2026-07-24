/**
 * Hermetic tests for the "sub-skill file actually opened" predicate — no
 * codex spawn. Constructs Observation values by hand to exercise the exact
 * boundary this predicate exists to enforce: a tool-call ARGUMENT naming
 * `<skill>/SKILL.md` AND a result that actually carries the file's own
 * content (its `name: <skill>` frontmatter line) — not merely a command
 * that mentions the path (agent prose, rawStdout, or a command that never
 * actually reads the bytes: `ls`, `test -f`, `echo`, a `sed` range that
 * misses the frontmatter).
 */

import { describe, expect, it } from "bun:test";

import type { Observation } from "../../types.ts";
import { skillChainJudgment, skillFileWasOpened } from "./judgment.ts";

/** A real SKILL.md's frontmatter shape (see any skills directory's SKILL.md in this repo). */
function skillMdContent(skillName: string): string {
	return `---\nname: ${skillName}\ndescription: irrelevant\n---\n\n# ${skillName}\n`;
}

/**
 * A command_execution item shaped like a real SUCCESSFUL read — matching
 * fixtures/toolcall-stdout.jsonl's real captured `{"exit_code":0,
 * "status":"completed",...}` shape. Passing tests build via this helper
 * (not a bare `{ command, aggregated_output }`) so they exercise the real
 * success-shaped item, not an incomplete hand-typed one that happens to
 * satisfy an under-specified check.
 */
function successfulCall(command: string, aggregatedOutput: string) {
	return { itemType: "command_execution", item: { command, aggregated_output: aggregatedOutput, exit_code: 0, status: "completed" } };
}

function observationWithToolCalls(toolCalls: Observation["toolCalls"]): Observation {
	return { events: [], toolCalls, baseInstructions: "", injectedContext: "", finalMessage: null, rawStdout: "", stderr: "" };
}

describe("skillFileWasOpened", () => {
	it("true: a command_execution call's `command` argument names <skill>/SKILL.md AND its result carries the file's own frontmatter content", () => {
		const observation = observationWithToolCalls([successfulCall("sed -n '1,240p' .agents/skills/sisyphus/SKILL.md", skillMdContent("sisyphus"))]);
		expect(skillFileWasOpened(observation, "sisyphus")).toBe(true);
	});

	it("true: an absolute path containing the skill dir also matches", () => {
		const observation = observationWithToolCalls([successfulCall("cat /tmp/x/.agents/skills/sisyphus/SKILL.md", skillMdContent("sisyphus"))]);
		expect(skillFileWasOpened(observation, "sisyphus")).toBe(true);
	});

	it("false: no tool call at all", () => {
		expect(skillFileWasOpened(observationWithToolCalls([]), "sisyphus")).toBe(false);
	});

	it("false: the model only SAYS the word in prose/rawStdout — no tool-call argument named it (guards against a vacuous text-anywhere match)", () => {
		const observation: Observation = {
			events: [],
			toolCalls: [{ itemType: "command_execution", item: { command: "ls .agents/skills/other" } }],
			baseInstructions: "",
			injectedContext: "",
			finalMessage: "I will now read sisyphus/SKILL.md to follow its instructions.",
			rawStdout: "mentions sisyphus/SKILL.md here too",
			stderr: "",
		};
		expect(skillFileWasOpened(observation, "sisyphus")).toBe(false);
	});

	it("false: a same-prefix different skill name does not satisfy the check (sisyphus-junior != sisyphus)", () => {
		const observation = observationWithToolCalls([successfulCall("cat .agents/skills/sisyphus-junior/SKILL.md", skillMdContent("sisyphus-junior"))]);
		expect(skillFileWasOpened(observation, "sisyphus")).toBe(false);
	});

	// CONFIRMED defect (code-review): a plain substring match on `<skill>/SKILL.md`
	// accepted `not-<skill>/SKILL.md` (a DIFFERENT skill dir whose name merely
	// ends with this one) and `<skill>/SKILL.md.backup` (a DIFFERENT file whose
	// name merely starts with `SKILL.md`) as if they were this skill's own file.
	describe("CONFIRMED defect — path-boundary collisions must not pass", () => {
		it("false: `not-<skill>/SKILL.md` (prefix collision — a different skill dir ending with this name)", () => {
			const observation = observationWithToolCalls([successfulCall("cat .agents/skills/not-sisyphus/SKILL.md", skillMdContent("sisyphus"))]);
			expect(skillFileWasOpened(observation, "sisyphus")).toBe(false);
		});

		it("false: `<skill>/SKILL.md.backup` (suffix collision — a different file starting with SKILL.md)", () => {
			const observation = observationWithToolCalls([successfulCall("cat .agents/skills/sisyphus/SKILL.md.backup", skillMdContent("sisyphus"))]);
			expect(skillFileWasOpened(observation, "sisyphus")).toBe(false);
		});
	});

	// CONFIRMED defect (code-review): checking `command`/`aggregated_output`
	// content alone, without also checking the call actually succeeded, let a
	// FAILED tool call (e.g. permission-denied `cat`) whose command argument
	// still names the path and whose (stale/attacker-controlled) output still
	// happens to carry the content marker count as a successful read.
	describe("CONFIRMED defect — a failed tool call must not pass even if its output happens to carry the content marker", () => {
		it("false: exit_code !== 0", () => {
			const observation = observationWithToolCalls([
				{ itemType: "command_execution", item: { command: "cat .agents/skills/sisyphus/SKILL.md", aggregated_output: skillMdContent("sisyphus"), exit_code: 1, status: "failed" } },
			]);
			expect(skillFileWasOpened(observation, "sisyphus")).toBe(false);
		});

		it("false: status !== 'completed' even though exit_code is 0", () => {
			const observation = observationWithToolCalls([
				{ itemType: "command_execution", item: { command: "cat .agents/skills/sisyphus/SKILL.md", aggregated_output: skillMdContent("sisyphus"), exit_code: 0, status: "in_progress" } },
			]);
			expect(skillFileWasOpened(observation, "sisyphus")).toBe(false);
		});

		it("false: exit_code/status fields absent entirely (an incompletely-shaped item, not a real captured one)", () => {
			const observation = observationWithToolCalls([
				{ itemType: "command_execution", item: { command: "cat .agents/skills/sisyphus/SKILL.md", aggregated_output: skillMdContent("sisyphus") } },
			]);
			expect(skillFileWasOpened(observation, "sisyphus")).toBe(false);
		});
	});

	it("false: a tool call whose `command` field is missing/non-string is skipped, not thrown", () => {
		const observation = observationWithToolCalls([{ itemType: "custom_tool", item: { args: { path: "x" } } }]);
		expect(skillFileWasOpened(observation, "sisyphus")).toBe(false);
	});

	// CONFIRMED defect: scoping to the command ARGUMENT alone accepts any
	// command that merely NAMES the path without ever reading its bytes.
	describe("CONFIRMED defect — a command naming the path without reading it must not pass", () => {
		it("false: `ls` lists the file, never reads its content", () => {
			const observation = observationWithToolCalls([
				{ itemType: "command_execution", item: { command: "ls .agents/skills/sisyphus/SKILL.md", aggregated_output: ".agents/skills/sisyphus/SKILL.md\n" } },
			]);
			expect(skillFileWasOpened(observation, "sisyphus")).toBe(false);
		});

		it("false: `test -f` checks existence only, produces no content output", () => {
			const observation = observationWithToolCalls([
				{ itemType: "command_execution", item: { command: "test -f .agents/skills/sisyphus/SKILL.md && echo exists", aggregated_output: "exists\n" } },
			]);
			expect(skillFileWasOpened(observation, "sisyphus")).toBe(false);
		});

		it("false: `echo` of the path is not a read", () => {
			const observation = observationWithToolCalls([
				{ itemType: "command_execution", item: { command: "echo .agents/skills/sisyphus/SKILL.md", aggregated_output: ".agents/skills/sisyphus/SKILL.md\n" } },
			]);
			expect(skillFileWasOpened(observation, "sisyphus")).toBe(false);
		});

		it("false: a `sed` call naming the path whose line range misses the content (empty/irrelevant output)", () => {
			const observation = observationWithToolCalls([
				{ itemType: "command_execution", item: { command: "sed -n '9000,9001p' .agents/skills/sisyphus/SKILL.md", aggregated_output: "" } },
			]);
			expect(skillFileWasOpened(observation, "sisyphus")).toBe(false);
		});

		it("false: aggregated_output is present but belongs to a DIFFERENT skill's frontmatter (command mentions sisyphus, output is some other file's content)", () => {
			const observation = observationWithToolCalls([
				{ itemType: "command_execution", item: { command: "cat .agents/skills/sisyphus/SKILL.md", aggregated_output: skillMdContent("momus") } },
			]);
			expect(skillFileWasOpened(observation, "sisyphus")).toBe(false);
		});
	});
});

describe("skillChainJudgment", () => {
	it("builds a predicate-kind Judgment wired to skillFileWasOpened for the given skill", () => {
		const judgment = skillChainJudgment("sisyphus");
		expect(judgment.kind).toBe("predicate");

		const passing = observationWithToolCalls([successfulCall("cat .agents/skills/sisyphus/SKILL.md", skillMdContent("sisyphus"))]);
		const failing = observationWithToolCalls([]);
		if (judgment.kind !== "predicate") throw new Error("unreachable");
		expect(judgment.predicate(passing)).toBe(true);
		expect(judgment.predicate(failing)).toBe(false);
	});
});

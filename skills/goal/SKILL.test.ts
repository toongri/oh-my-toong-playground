import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const skillMd = readFileSync(join(import.meta.dir, "SKILL.md"), "utf8");
const planningMd = readFileSync(
	join(import.meta.dir, "references/planning.md"),
	"utf8",
);
const completionGateMd = readFileSync(
	join(import.meta.dir, "references/completion-gate.md"),
	"utf8",
);
// Union of body + both references — the behavior-preservation surface after
// the L1-compress split. A required phrase must survive SOMEWHERE in this
// union; which file it lives in is a routing detail, not a contract.
const combined = skillMd + planningMd + completionGateMd;

// ---------------------------------------------------------------------------
// Prose-contract test for skills/goal/SKILL.md — pure-executor reshape.
//
// goal was reframed from an orchestrator that routed Vague/Complex objectives
// through deep-interview/prometheus into a pure executor that decomposes the
// Six Slots and Story set itself and dispatches straight to sisyphus. The
// routing table, the Clarity gate, the Fast-path gate, and the
// Finalize-before-advance guard (including its check-subskill dispatch and
// Un-wedge recovery paragraph) are all gone from the prose.
// ---------------------------------------------------------------------------

describe("pure-executor reshape: routing/gating machinery is gone from SKILL.md", () => {
	test("SKILL.md no longer contains the Conditional Orchestration routing table", () => {
		expect(skillMd).not.toContain("Conditional Orchestration");
	});

	test("SKILL.md no longer contains the Clarity gate", () => {
		expect(skillMd).not.toMatch(/### Clarity gate/);
	});

	test("SKILL.md no longer contains the Fast-path gate", () => {
		expect(skillMd).not.toMatch(/### Fast-path gate/);
	});

	test("SKILL.md no longer contains the Finalize-before-advance guard or check-subskill dispatch", () => {
		expect(skillMd).not.toContain("Finalize-before-advance");
		expect(skillMd).not.toContain("check-subskill");
	});

	test("SKILL.md no longer contains the Un-wedge recovery paragraph", () => {
		expect(skillMd).not.toContain("Un-wedge recovery");
	});
});

// ---------------------------------------------------------------------------
// l5-compress: SKILL.md is compressed to a router; Six Slots, Story
// Definition, Mid-flight Story Mutations, and Completion Gate move to
// references/planning.md and references/completion-gate.md verbatim. Content
// must be behaviorally invariant — every required phrase survives SOMEWHERE
// in the body+references union — while the moved detail is actually gone
// from the body (proving the move happened, not just that a copy exists).
// ---------------------------------------------------------------------------

describe("read-discipline: SKILL.md points at the extracted references", () => {
	test("SKILL.md instructs reading references/planning.md before planning/story subcommands", () => {
		expect(skillMd).toContain(
			"You MUST read `references/planning.md` first",
		);
	});

	test("SKILL.md instructs reading references/completion-gate.md before the completion sequence", () => {
		expect(skillMd).toContain(
			"You MUST read `references/completion-gate.md` first",
		);
	});
});

describe("strip: Six Slots and Story Definition detail moved out of SKILL.md body", () => {
	test("slot-definition detail is absent from SKILL.md body", () => {
		expect(skillMd).not.toContain(
			"**outcome** (`--outcome`) — what is true when the objective is reached",
		);
	});

	test("slot-definition detail is present in references/planning.md", () => {
		expect(planningMd).toContain(
			"**outcome** (`--outcome`) — what is true when the objective is reached",
		);
	});

	test("set-stories --single detail is absent from SKILL.md body", () => {
		expect(skillMd).not.toContain(
			"bun ${CLAUDE_SKILL_DIR}/scripts/goal-state.ts set-stories --single",
		);
	});

	test("set-stories --single detail is present in references/planning.md", () => {
		expect(planningMd).toContain(
			"bun ${CLAUDE_SKILL_DIR}/scripts/goal-state.ts set-stories --single",
		);
	});

	test("Mid-flight Story Mutations subcommand detail is absent from SKILL.md body", () => {
		expect(skillMd).not.toContain(
			"**`add-story --json '<story>'`** — appends one new story with status `unconfirmed`",
		);
	});

	test("Mid-flight Story Mutations subcommand detail is present in references/planning.md", () => {
		expect(planningMd).toContain(
			"**`add-story --json '<story>'`** — appends one new story with status `unconfirmed`",
		);
	});
});

describe("strip: Completion Gate detail moved out of SKILL.md body", () => {
	test("evidence rubric detail is absent from SKILL.md body", () => {
		expect(skillMd).not.toContain(
			"**prompt-to-artifact mapping** — map every explicit requirement, numbered item, named file, command, test, gate, and deliverable in the verification surface to concrete evidence",
		);
	});

	test("evidence rubric detail is present in references/completion-gate.md", () => {
		expect(completionGateMd).toContain(
			"**prompt-to-artifact mapping** — map every explicit requirement, numbered item, named file, command, test, gate, and deliverable in the verification surface to concrete evidence",
		);
	});

	test("code-review artifact schema detail is absent from SKILL.md body", () => {
		expect(skillMd).not.toContain('"status": "COMPLETE|INCONCLUSIVE"');
	});

	test("code-review artifact schema detail is present in references/completion-gate.md", () => {
		expect(completionGateMd).toContain(
			'"status": "COMPLETE|INCONCLUSIVE"',
		);
	});

	test("Blocked-stop B1/B2 detail is absent from SKILL.md body", () => {
		expect(skillMd).not.toContain(
			"**B1** — the objective self-check names NO actionable incomplete work item",
		);
	});

	test("Blocked-stop B1/B2 detail is present in references/completion-gate.md", () => {
		expect(completionGateMd).toContain(
			"**B1** — the objective self-check names NO actionable incomplete work item",
		);
	});
});

describe("preserved (regression): required phrases survive somewhere in body+references", () => {
	test("all six slot names are named somewhere in the union", () => {
		expect(combined).toContain("**outcome** (`--outcome`)");
		expect(combined).toContain(
			"**verification-surface** (`--verification-surface`)",
		);
		expect(combined).toContain("**constraints** (`--constraints`)");
		expect(combined).toContain("**boundaries** (`--boundaries`)");
		expect(combined).toContain(
			"**iteration-policy** → `max_iterations` (`--max-iterations <n>`)",
		);
		expect(combined).toContain(
			"**blocked-stop** (`--blocked-stop <text>`)",
		);
	});

	test("the never-false-complete invariant survives in the union", () => {
		expect(combined).toContain(
			"the never-false-complete invariant in `request-complete` structurally requires `objective_verdict=APPROVE`",
		);
	});

	test("INCONCLUSIVE status routing survives in the union", () => {
		expect(combined).toContain(
			'`status === "INCONCLUSIVE"` blocks regardless of findings',
		);
		expect(combined).toContain(
			"An `INCONCLUSIVE` status routes to a **reviewer-only re-run** instead — re-dispatch a fresh **code-reviewer** over the same diff, NOT sisyphus",
		);
	});
});

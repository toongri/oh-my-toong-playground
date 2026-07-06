import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

// ---------------------------------------------------------------------------
// Prose-contract test for skills/goal/SKILL.md — l4a-clarity-gate.
//
// goal must trust deep-interview's crystallized ambiguity score as the
// requirements-clarity signal and skip re-interrogating the user before
// routing downstream. This asserts the load-bearing sentence body-wide
// (toContain over the whole file, not a heading-slice) so a later heading
// reshape (lever 5) does not break this test.
// ---------------------------------------------------------------------------

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

describe("clarity gate: goal trusts deep-interview's crystallized ambiguity", () => {
	test("SKILL.md states goal trusts DI's crystallized clarity and does not re-interrogate", () => {
		expect(skillMd).toContain(
			"goal trusts deep-interview's crystallized clarity (ambiguity ≤ the resolved threshold, default 0.15) as the requirements-clarity signal and does not re-interrogate the user before routing downstream",
		);
	});
});

// ---------------------------------------------------------------------------
// Prose-contract test for skills/goal/SKILL.md — l4-fastpath-gate.
//
// goal must fold the Complex→prometheus branch: when a Complex objective
// clears three fast-path signals (file-count-only Complex, no design fork,
// no T1 risk) goal skips prometheus and dispatches straight to sisyphus via
// the Story layer. A live design fork must be named explicitly as a
// fast-path exclusion signal so design-fork work never leaks onto the fast
// path. On-the-fence judgments default toward prometheus (asymmetric
// default), never toward the fast path.
//
// Asserted body-wide (toContain over the whole file, not a heading-slice)
// so a later heading reshape (lever 5) does not break this test. Per the
// plan, the Conditional Orchestration section (where this prose lives)
// stays in SKILL.md's body after lever 5 — it is not relocated to
// references/ — so a plain whole-file toContain remains valid post-L1.
// ---------------------------------------------------------------------------

describe("fast-path gate: goal conditionally folds prometheus for Complex objectives", () => {
	test("SKILL.md states the three fast-path signals, naming a design fork as an exclusion signal", () => {
		expect(skillMd).toContain(
			"When a Complex objective clears all three fast-path signals — (1) the objective is Complex on file-count alone, with each individual change mechanical and localized, (2) no competing design fork exists — a single obvious approach, not a choice among architectures, and (3) no T1-tier risk is present (no security or data-integrity surface) — goal skips prometheus, captures the objective's acceptance criteria directly into the Story Definition layer, and dispatches straight to sisyphus.",
		);
	});

	test("SKILL.md states the asymmetric default: on-the-fence falls back to prometheus", () => {
		expect(skillMd).toContain(
			"a user wrongly silenced by a skipped planning gate is worse than one extra round of design review, so an ambiguous fast-path judgment falls back to the full prometheus pipeline",
		);
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

	test("the fast-path three signals survive in the union (body-resident per plan)", () => {
		expect(combined).toContain(
			"When a Complex objective clears all three fast-path signals",
		);
	});
});

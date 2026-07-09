import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

// ---------------------------------------------------------------------------
// Prose-contract tests for skills/qa/SKILL.md.
//
// Context: qa is rewritten from a 3-trigger composable static+dynamic model
// (Automated checks / Spec-AC compliance / Hands-on execution) into a single
// standalone stateful adversarial-e2e cycle:
//   PRE-FLIGHT -> PLAN -> BASELINE -> ADVERSARIAL E2E -> CHECK ->
//   [DIAGNOSIS -> FIX -> RE-VERIFY loop <=5] -> EXIT -> CLEANUP -> ROLLBACK -> STATE
//
// RED step (pre-rewrite state): the "new-prose" describe blocks below FAIL
// because the cycle vocabulary/delegation lines do not exist yet in the old
// 3-trigger SKILL.md. The "strip" blocks FAIL because the static-audit
// sections they assert absent are still present. The "preserved" blocks PASS
// on both old and new (invariants: 6-category matrix, inline drivers, binary
// APPROVE/REQUEST_CHANGES contract).
// ---------------------------------------------------------------------------

const skillMd = readFileSync(join(import.meta.dir, "SKILL.md"), "utf8");
const scenarioAuthoringMd = readFileSync(
	join(import.meta.dir, "scenario-authoring.md"),
	"utf8",
);
const stage3Md = readFileSync(join(import.meta.dir, "stage3-handson.md"), "utf8");

// ---------------------------------------------------------------------------
// NEW-PROSE: cycle phase vocabulary (must FAIL before rewrite — RED)
// ---------------------------------------------------------------------------

describe("new-prose: cycle phase vocabulary", () => {
	test("PRE-FLIGHT phase is present", () => {
		expect(skillMd).toContain("PRE-FLIGHT");
	});

	test("PLAN phase is present", () => {
		expect(skillMd).toContain("PLAN");
	});

	test("BASELINE phase is present", () => {
		expect(skillMd).toContain("BASELINE");
	});

	test("ADVERSARIAL E2E phase is present", () => {
		expect(skillMd).toContain("ADVERSARIAL E2E");
	});

	test("CHECK phase is present", () => {
		expect(skillMd).toContain("CHECK");
	});

	test("DIAGNOSIS phase is present", () => {
		expect(skillMd).toContain("DIAGNOSIS");
	});

	test("RE-VERIFY phase is present", () => {
		expect(skillMd).toContain("RE-VERIFY");
	});

	test("EXIT table is present", () => {
		expect(skillMd).toContain("EXIT");
	});

	test("CLEANUP phase is present", () => {
		expect(skillMd).toContain("CLEANUP");
	});

	test("ROLLBACK phase is present", () => {
		expect(skillMd).toContain("ROLLBACK");
	});

	test("STATE phase is present", () => {
		expect(skillMd).toContain("STATE");
	});

	test("the full cycle order is spelled out top-to-bottom", () => {
		expect(skillMd).toContain(
			"PRE-FLIGHT → PLAN → BASELINE → ADVERSARIAL E2E → CHECK",
		);
	});
});

// ---------------------------------------------------------------------------
// NEW-PROSE: PRE-FLIGHT behavior-invisible contract gate
// ---------------------------------------------------------------------------

describe("new-prose: PRE-FLIGHT contract gate", () => {
	test("MUST-NOT-DO scope keying is present", () => {
		expect(skillMd).toContain("MUST-NOT-DO");
	});

	test("B subset-of A scope wording is present", () => {
		expect(skillMd).toContain("B ⊆ A");
	});

	test("fail-fast immediate REQUEST_CHANGES on violation is present", () => {
		expect(skillMd).toContain("immediate REQUEST_CHANGES");
	});

	test("cycle-not-executed fail-fast wording is present", () => {
		expect(skillMd).toContain("cycle NOT executed");
	});
});

// ---------------------------------------------------------------------------
// NEW-PROSE: 3-way delegation (oracle / sisyphus-junior / qa)
// ---------------------------------------------------------------------------

describe("new-prose: 3-way delegation", () => {
	test("DIAGNOSIS delegates to a fresh read-only oracle", () => {
		expect(skillMd).toContain("delegate to `oracle`");
		expect(skillMd).toContain("fresh, read-only");
	});

	test("FIX delegates to sisyphus-junior", () => {
		expect(skillMd).toContain("delegate to `sisyphus-junior`");
	});

	test("sisyphus-junior commits its own scoped fix, never git commit -a", () => {
		expect(skillMd).toContain("sisyphus-junior commits its own");
		expect(skillMd).toContain("git commit -a");
	});

	test("RE-VERIFY distrusts the fixer's report and reruns the full matrix", () => {
		expect(skillMd).toContain("distrust");
		expect(skillMd).toContain("BASELINE + the FULL matrix");
	});
});

// ---------------------------------------------------------------------------
// NEW-PROSE: EXIT table conditions
// ---------------------------------------------------------------------------

describe("new-prose: EXIT table conditions", () => {
	test("Goal Met condition is present", () => {
		expect(skillMd).toContain("Goal Met");
	});

	test("max_cycles=5 condition is present", () => {
		expect(skillMd).toContain("max_cycles");
		expect(skillMd).toContain("5");
	});

	test("Same-Failure-3x condition is present", () => {
		expect(skillMd).toContain("Same-Failure");
	});

	test("Safety condition is present", () => {
		expect(skillMd).toContain("Safety");
	});

	test("cycle increments at FIX dispatch", () => {
		expect(skillMd).toContain("cycle++ at FIX dispatch");
	});

	test("Same-Failure key is scenario-id + root-cause-file + root-cause-symbol/category", () => {
		expect(skillMd).toContain("scenario-id");
		expect(skillMd).toContain("root-cause-file");
		expect(skillMd).toContain("root-cause-symbol");
	});
});

// ---------------------------------------------------------------------------
// NEW-PROSE: ROLLBACK safety scope
// ---------------------------------------------------------------------------

describe("new-prose: ROLLBACK safety scope", () => {
	test("qa reverts only fix_head_before..HEAD via git revert", () => {
		expect(skillMd).toContain("fix_head_before");
		expect(skillMd).toContain("git revert");
	});

	test("git reset --hard is named as forbidden", () => {
		expect(skillMd).toContain("NEVER");
		expect(skillMd).toContain("git reset --hard");
	});

	test("linear-descendant refuse-on-amend guard is present", () => {
		expect(skillMd).toContain("linear-descendant");
	});

	test("non-empty-range guard treats no-commit as ERROR", () => {
		expect(skillMd).toContain("non-empty-range");
		expect(skillMd).toContain("ERROR");
	});

	test("post-revert disjointness assertion on user_dirty_set is present", () => {
		expect(skillMd).toContain("user_dirty_set");
		expect(skillMd).toContain("disjointness");
	});

	test("qa refuses the cycle if a fix must touch a user_dirty_set file", () => {
		expect(skillMd).toContain("REFUSE the cycle");
	});

	test("rm-rf/force auto-deny is honored", () => {
		expect(skillMd).toContain("rm -rf");
	});
});

// ---------------------------------------------------------------------------
// NEW-PROSE: STATE persistence + resume
// ---------------------------------------------------------------------------

describe("new-prose: STATE persistence", () => {
	test("qa-state.ts CLI invocation is referenced", () => {
		expect(skillMd).toContain("bun ${CLAUDE_SKILL_DIR}/scripts/qa-state.ts");
	});

	test("continue resumes at phase/cycle", () => {
		expect(skillMd).toContain("continue");
		expect(skillMd).toContain("phase/cycle");
	});
});

// ---------------------------------------------------------------------------
// NEW-PROSE: doc-only fix-loop nesting contract
// ---------------------------------------------------------------------------

describe("new-prose: fix-loop nesting contract", () => {
	test("qa's fix-loop must not run inside another fix-loop", () => {
		expect(skillMd).toContain("must NOT be called inside another fix-loop");
	});

	test("named upgrade trigger for a future code guard is present", () => {
		expect(skillMd).toContain(
			"add a code guard when qa gains its first fix-loop-owning caller",
		);
	});

	test("YAGNI: no guard code is written now", () => {
		expect(skillMd).toContain("YAGNI");
	});
});

// ---------------------------------------------------------------------------
// NEW-PROSE: scenario-authoring.md risk/coverage-gap derivation framework
// ---------------------------------------------------------------------------

describe("new-prose: scenario-authoring.md derivation framework", () => {
	test("impact mapping is present", () => {
		expect(scenarioAuthoringMd).toContain("impact mapping");
	});

	test("coverage-gap judgment is present", () => {
		expect(scenarioAuthoringMd).toContain("coverage-gap");
	});

	test("actor is present", () => {
		expect(scenarioAuthoringMd).toContain("actor");
	});

	test("why-needed is present", () => {
		expect(scenarioAuthoringMd).toContain("why-needed");
	});
});

describe("new-prose: stage3-handson.md risk-surface + hardening rows", () => {
	test("stale-state row is present", () => {
		expect(stage3Md).toContain("stale-state");
	});

	test("dirty-worktree row is present", () => {
		expect(stage3Md).toContain("dirty-worktree");
	});

	test("flaky-rerun row is present", () => {
		expect(stage3Md).toContain("flaky-rerun");
	});

	test("new hardening rows are called out as distinct from the pre-existing row 4", () => {
		expect(stage3Md).toContain("distinct from row");
	});
});

describe("new-prose: SKILL.md points at scenario-authoring.md", () => {
	test("scenario-authoring.md pointer is present", () => {
		expect(skillMd).toContain("scenario-authoring.md");
	});
});

// ---------------------------------------------------------------------------
// STRIP: static-audit sections removed (must FAIL before rewrite — RED)
// ---------------------------------------------------------------------------

describe("strip: 3-trigger composable model removed", () => {
	test('"Composable Verification Triggers" heading is absent', () => {
		expect(skillMd).not.toContain("Composable Verification Triggers");
	});

	test('"Active Triggers" table is absent', () => {
		expect(skillMd).not.toContain("Active Triggers");
	});

	test('"Trigger Independence Rule" is absent', () => {
		expect(skillMd).not.toContain("Trigger Independence Rule");
	});
});

describe("strip: MUST DO compliance table removed", () => {
	test('"MUST DO Checklist" is absent', () => {
		expect(skillMd).not.toContain("MUST DO Checklist");
	});

	test('"MUST NOT DO Violation Detection" is absent', () => {
		expect(skillMd).not.toContain("MUST NOT DO Violation Detection");
	});
});

describe("strip: Completeness prose audit removed", () => {
	test('"Completeness Coverage Sub-Check" is absent', () => {
		expect(skillMd).not.toContain("Completeness Coverage Sub-Check");
	});

	test('"Completeness" section heading is absent', () => {
		expect(skillMd).not.toContain("## Completeness");
	});
});

describe("strip: Code-Quality static review step removed", () => {
	test('"### Code Quality" heading is absent', () => {
		expect(skillMd).not.toContain("### Code Quality");
	});

	test('"checklists.md" reference is absent', () => {
		expect(skillMd).not.toContain("checklists.md");
	});
});

describe("strip: qa's PLAN/Overview no longer disclaim reading the change", () => {
	test('"not to read about it" is absent', () => {
		expect(skillMd).not.toContain("not to read about it");
	});

	test('"static prose-audit machinery" is absent', () => {
		expect(skillMd).not.toContain("static prose-audit machinery");
	});

	test('"static responsibility" no longer appears anywhere in SKILL.md', () => {
		expect(skillMd.match(/static responsibility/g)).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// PRESERVED (must PASS before AND after the rewrite — invariant)
// ---------------------------------------------------------------------------

describe("preserved: 6-category adversarial matrix intent", () => {
	test("all 6 category names are present", () => {
		expect(skillMd).toContain("failure paths");
		expect(skillMd).toContain("boundary/malformed input");
		expect(skillMd).toContain("injection");
		expect(skillMd).toContain("interruption");
		expect(skillMd).toContain("misleading success");
		expect(skillMd).toContain("idempotency");
	});

	test("stage3-handson.md matrix reference is present", () => {
		expect(skillMd).toContain("stage3-handson.md");
		expect(skillMd).toContain("Adversarial Scenario Matrix");
	});
});

describe("preserved: inline modality drivers, no tmux", () => {
	test("curl, agent-browser, maestro, bash drivers are named", () => {
		expect(skillMd).toContain("curl");
		expect(skillMd).toContain("agent-browser");
		expect(skillMd).toContain("maestro");
		expect(skillMd).toContain("bash");
	});

	test("tmux is explicitly named as not used (contract note, not a driver)", () => {
		expect(skillMd.toLowerCase()).toContain("no tmux");
	});
});

describe("preserved: binary APPROVE/REQUEST_CHANGES output contract", () => {
	test("APPROVE is present", () => {
		expect(skillMd).toContain("APPROVE");
	});

	test("REQUEST_CHANGES is present", () => {
		expect(skillMd).toContain("REQUEST_CHANGES");
	});

	test("feedback-protocol.md is still referenced", () => {
		expect(skillMd).toContain("feedback-protocol.md");
	});
});

describe("preserved: non-blocking command execution policy", () => {
	test("run_in_background is present", () => {
		expect(skillMd).toContain("run_in_background");
	});
});

describe("preserved: stage3-handson.md 6-category adversarial matrix anchor", () => {
	test('"## Adversarial Scenario Matrix" heading is present', () => {
		expect(stage3Md).toContain("## Adversarial Scenario Matrix");
	});

	test("all 6 pre-existing category names are present", () => {
		expect(stage3Md).toContain("Error / failure paths");
		expect(stage3Md).toContain("Boundary / malformed input");
		expect(stage3Md).toContain("Injection");
		expect(stage3Md).toContain("Interruption");
		expect(stage3Md).toContain("Misleading success");
		expect(stage3Md).toContain("Idempotency");
	});
});

// ---------------------------------------------------------------------------
// STRUCTURAL-INTEGRITY / ANCHOR-RESOLUTION: SKILL.md's scenario-authoring.md
// pointer must resolve to real content, not a dangling filename reference.
// ---------------------------------------------------------------------------

describe("structural-integrity: scenario-authoring.md pointer resolves to a real heading (anchor resolution)", () => {
	test("SKILL.md points at scenario-authoring.md AND that heading actually exists in the file", () => {
		expect(skillMd).toContain("scenario-authoring.md");
		expect(scenarioAuthoringMd).toContain(
			"## Layer A — Risk / Coverage-Gap Derivation",
		);
	});

	test("the six-field scenario shape is enumerated in order in scenario-authoring.md", () => {
		expect(scenarioAuthoringMd).toContain(
			"`actor · preconditions · steps · expected · why-needed · priority`",
		);
	});
});

// ---------------------------------------------------------------------------
// NEW-PROSE: Scenarios Executed roster (roster axis) (must FAIL before rewrite — RED)
// ---------------------------------------------------------------------------

describe("new-prose: Scenarios Executed roster (roster axis)", () => {
	test('"## Scenarios Executed" heading is present', () => {
		expect(skillMd).toContain("## Scenarios Executed");
	});

	test("the nine-column header appears in the pinned order", () => {
		expect(skillMd).toContain(
			"| # | source | actor | preconditions | steps | expected | result | why-needed | priority |",
		);
	});

	test("both source tokens are enumerated in the roster section", () => {
		const rosterStart = skillMd.indexOf("## Scenarios Executed");
		expect(rosterStart).not.toBe(-1);
		const rosterEnd = skillMd.indexOf("\n## ", rosterStart + 1);
		expect(rosterEnd).not.toBe(-1);
		const rosterSection = skillMd.slice(rosterStart, rosterEnd);
		expect(rosterSection).toContain("self-authored");
		expect(rosterSection).toContain("caller-provided");
	});

	test("stage3-handson.md is referenced from inside the roster section", () => {
		const rosterStart = skillMd.indexOf("## Scenarios Executed");
		expect(rosterStart).not.toBe(-1);
		const rosterEnd = skillMd.indexOf("\n## ", rosterStart + 1);
		expect(rosterEnd).not.toBe(-1);
		const rosterSection = skillMd.slice(rosterStart, rosterEnd);
		expect(rosterSection).toContain("stage3-handson.md");
	});

	test("the old prose line naming the six-field shape directly is absent", () => {
		expect(skillMd).not.toContain(
			"Self-authored scenarios reported under ADVERSARIAL E2E carry the six-field shape",
		);
	});
});

// ---------------------------------------------------------------------------
// NEW-PROSE: issuance precondition names both carve-outs
// (Finding 1 fix — a zero-row roster from a genuinely inert refactor is a
// complete cycle and still issues a verdict; must FAIL before the SKILL.md
// edit — RED)
//
// Both carve-outs are load-bearing and each one's absence deadlocks a distinct
// path: without the inert-refactor carve-out a pure refactor can never be
// approved; without the PRE-FLIGHT one a contract-violating change can never be
// rejected. Guard them symmetrically.
// ---------------------------------------------------------------------------

describe("new-prose: issuance precondition names both carve-outs", () => {
	test("the Approval Decision guard prose names the inert-refactor carve-out", () => {
		const guardStart = skillMd.indexOf("## Approval Decision");
		expect(guardStart).not.toBe(-1);
		const tableStart = skillMd.indexOf(
			"| Condition | Verdict |",
			guardStart + 1,
		);
		expect(tableStart).not.toBe(-1);
		const guardSection = skillMd.slice(guardStart, tableStart);
		expect(guardSection).toContain("inert refactor");
	});

	test("the Approval Decision guard prose names the PRE-FLIGHT fail-fast carve-out", () => {
		const guardStart = skillMd.indexOf("## Approval Decision");
		expect(guardStart).not.toBe(-1);
		const tableStart = skillMd.indexOf(
			"| Condition | Verdict |",
			guardStart + 1,
		);
		expect(tableStart).not.toBe(-1);
		const guardSection = skillMd.slice(guardStart, tableStart);
		expect(guardSection).toContain("PRE-FLIGHT fail-fast");
	});
});

// ---------------------------------------------------------------------------
// REGRESSION GUARD: frontmatter identity (must PASS before AND after)
// ---------------------------------------------------------------------------

describe("regression-guard: frontmatter", () => {
	test("name: qa is present", () => {
		expect(skillMd).toContain("name: qa");
	});
});

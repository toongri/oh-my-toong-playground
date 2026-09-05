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
// on both old and new (invariants: adversarial matrix with 6 coverage axes + 3 per-run checks, inline drivers, binary
// APPROVE/REQUEST_CHANGES contract).
// ---------------------------------------------------------------------------

const skillMd = readFileSync(join(import.meta.dir, "SKILL.md"), "utf8");
const scenarioAuthoringMd = readFileSync(
	join(import.meta.dir, "scenario-authoring.md"),
	"utf8",
);
const stage3Md = readFileSync(join(import.meta.dir, "stage3-handson.md"), "utf8");
const stage1Md = readFileSync(join(import.meta.dir, "stage1-commands.md"), "utf8");
const feedbackMd = readFileSync(
	join(import.meta.dir, "feedback-protocol.md"),
	"utf8",
);
const presentationMd = readFileSync(
	join(import.meta.dir, "presentation.md"),
	"utf8",
);

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
// REVERSE-REFERENCE: caller examples stay caller-agnostic while preserving
// the nesting contract's semantic atoms (must FAIL before the rewrite — RED)
// ---------------------------------------------------------------------------

describe("reverse-reference: fix-loop nesting examples are caller-agnostic", () => {
	test("the body names the retry hazard without naming a caller", () => {
		const bodyStart = skillMd.indexOf("## Fix-Loop Nesting Contract");
		expect(bodyStart).not.toBe(-1);
		const bodyEnd = skillMd.indexOf("## Evidence Saving Protocol", bodyStart + 1);
		expect(bodyEnd).not.toBe(-1);
		const bodySection = skillMd.slice(bodyStart, bodyEnd);
		expect(bodySection).not.toMatch(/\bultragoal\b/);
		expect(bodySection).toContain("double-loops retries");
		expect(bodySection).toContain("fix-loop-owning caller");
	});

	test("the quick reference keeps the doc contract and YAGNI atoms without a caller name", () => {
		const quickRefStart = skillMd.indexOf("## Quick Reference");
		expect(quickRefStart).not.toBe(-1);
		const quickReference = skillMd.slice(quickRefStart);
		expect(quickReference).not.toMatch(/\bultragoal\b/);
		expect(quickReference).toContain("doc contract, YAGNI");
	});
});

// ---------------------------------------------------------------------------
// REVERSE-REFERENCE: dead Prometheus links are inlined with the canonical
// evidence/variable contracts (must FAIL before the rewrite — RED)
// ---------------------------------------------------------------------------

describe("reverse-reference: QA contracts do not depend on Prometheus links", () => {
	test("the evidence path contract is inline and canonical", () => {
		const deadPrometheusPath = "../" + "prometheus/";
		const evidenceStart = skillMd.indexOf("## Evidence Saving Protocol");
		expect(evidenceStart).not.toBe(-1);
		const evidenceEnd = skillMd.indexOf("## Evidence Files", evidenceStart + 1);
		expect(evidenceEnd).not.toBe(-1);
		const evidenceSection = skillMd.slice(evidenceStart, evidenceEnd);
		expect(evidenceSection).not.toContain(deadPrometheusPath);
		expect(evidenceSection).toContain("Plan QA Scenario Evidence field");
		expect(evidenceSection).toContain(
			"$OMT_DIR/evidence/{plan-name}/{task-slug}/{scenario-slug}.{ext}",
		);
	});

	test("the hands-on executor variables are inline", () => {
		const deadPrometheusPath = "../" + "prometheus/";
		const lifecycleStart = stage3Md.indexOf("## Step 3.2: Server / Application Lifecycle");
		expect(lifecycleStart).not.toBe(-1);
		const lifecycleEnd = stage3Md.indexOf("## Step 3.3: API Verification", lifecycleStart + 1);
		expect(lifecycleEnd).not.toBe(-1);
		const lifecycleSection = stage3Md.slice(lifecycleStart, lifecycleEnd);
		expect(lifecycleSection).not.toContain(deadPrometheusPath);
		expect(lifecycleSection).toContain("export API_BASE_URL=");
		expect(lifecycleSection).toContain("$API_BASE_URL");
		expect(lifecycleSection).toContain("$IOS_UDID");
		expect(lifecycleSection).toContain("$ANDROID_SERIAL");
		expect(lifecycleSection).toContain("$evidence_xml");
	});

	test("iOS executor discovers, assigns, and exports IOS_UDID before use", () => {
		const lifecycleStart = stage3Md.indexOf("## Step 3.2: Server / Application Lifecycle");
		const lifecycleEnd = stage3Md.indexOf("## Step 3.3: API Verification", lifecycleStart + 1);
		const lifecycleSection = stage3Md.slice(lifecycleStart, lifecycleEnd);
		const discovery = lifecycleSection.indexOf("xcrun simctl list devices available");
		const assignment = lifecycleSection.indexOf("IOS_UDID=");
		const exportStep = lifecycleSection.indexOf("export IOS_UDID");
		const firstUse = lifecycleSection.indexOf('xcrun simctl bootstatus "$IOS_UDID" -b');

		expect(discovery).toBeGreaterThanOrEqual(0);
		expect(assignment).toBeGreaterThan(discovery);
		expect(exportStep).toBeGreaterThan(assignment);
		expect(firstUse).toBeGreaterThan(exportStep);
	});

	test("Android executor discovers, assigns, and exports ANDROID_SERIAL before use", () => {
		const lifecycleStart = stage3Md.indexOf("## Step 3.2: Server / Application Lifecycle");
		const lifecycleEnd = stage3Md.indexOf("## Step 3.3: API Verification", lifecycleStart + 1);
		const lifecycleSection = stage3Md.slice(lifecycleStart, lifecycleEnd);
		const discovery = lifecycleSection.indexOf("adb devices");
		const assignment = lifecycleSection.indexOf("ANDROID_SERIAL=");
		const exportStep = lifecycleSection.indexOf("export ANDROID_SERIAL");
		const firstUse = lifecycleSection.indexOf('adb -s "$ANDROID_SERIAL" get-state');

		expect(discovery).toBeGreaterThanOrEqual(0);
		expect(assignment).toBeGreaterThan(discovery);
		expect(exportStep).toBeGreaterThan(assignment);
		expect(firstUse).toBeGreaterThan(exportStep);
	});

	test("evidence_xml is resolved and exported separately before each AC", () => {
		const lifecycleStart = stage3Md.indexOf("## Step 3.2: Server / Application Lifecycle");
		const lifecycleEnd = stage3Md.indexOf("## Step 3.3: API Verification", lifecycleStart + 1);
		const lifecycleSection = stage3Md.slice(lifecycleStart, lifecycleEnd);
		const perAc = lifecycleSection.indexOf("Per-AC");
		const resolution = lifecycleSection.indexOf("evidence_xml=", perAc);
		const exportStep = lifecycleSection.indexOf("export evidence_xml", perAc);
		const use = lifecycleSection.indexOf("$evidence_xml", exportStep);

		expect(perAc).toBeGreaterThanOrEqual(0);
		expect(resolution).toBeGreaterThan(perAc);
		expect(exportStep).toBeGreaterThan(resolution);
		expect(use).toBeGreaterThan(exportStep);
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

	test("browser-tool installs use an ephemeral directory outside the checked worktree", () => {
		const frontendStart = stage3Md.indexOf("## Step 3.4: Frontend Verification");
		const frontendEnd = stage3Md.indexOf("## Step 3.5: Native App Verification", frontendStart + 1);
		const frontendSection = stage3Md.slice(frontendStart, frontendEnd);
		expect(frontendSection).toContain("ephemeral");
		expect(frontendSection).toContain("outside the checked worktree");
		expect(frontendSection).toContain("manifest, lockfile");
		expect(frontendSection).toContain("node_modules");
		expect(frontendSection).toContain("before CHECK");
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

describe("preserved: 6 coverage axes adversarial matrix intent", () => {
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
	test("description and driver table route mobile/native UI through agent-device", () => {
		expect(skillMd).toContain("curl/agent-browser/agent-device/bash");
		expect(skillMd).toContain("| Mobile / native UI | `agent-device` |");
	});

	test("mobile/native UI driving loads agent-device and uses its runtime help guidance", () => {
		expect(skillMd).toContain("load the `agent-device` skill first");
		expect(skillMd).toContain("`agent-device help <topic>`");
	});

	test("Quick Reference preserves the agent-device mobile/native UI route", () => {
		const quickRefStart = skillMd.indexOf("## Quick Reference");
		expect(quickRefStart).not.toBe(-1);
		expect(skillMd.slice(quickRefStart)).toContain(
			"Mobile/native UI→agent-device",
		);
	});

	test("tmux is explicitly named as not used (contract note, not a driver)", () => {
		expect(skillMd.toLowerCase()).toContain("no tmux");
	});
});

describe("QA standards: adversarial scenarios are never skipped for setup cost", () => {
	test("QA Standards require every authored scenario and its evidence regardless of setup cost", () => {
		expect(skillMd).toContain(
			"Setup cost—including starting multiple local apps or seeding local databases—is never a reason to skip adversarial scenarios: run every authored scenario and retain its evidence proving correct development.",
		);
	});

	test("BASELINE rationalization rebuttal preserves the same rule", () => {
		expect(stage1Md).toContain(
			"Setup cost is never a reason to skip adversarial scenarios. Run every authored scenario and retain evidence proving correct development.",
		);
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

describe("preserved: stage3-handson.md 6 coverage axes adversarial matrix anchor", () => {
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

	test("the roster header appears in the pinned order, carrying driven-at and evidence", () => {
		expect(skillMd).toContain(
			"| # | source | actor | driven-at | preconditions | steps | expected | result | evidence | why-needed | priority |",
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
// NEW-PROSE: the Quick Reference ROSTER line carries the PRE-FLIGHT carve-out
//
// The Quick Reference is a compression of the body, and an agent that leans on
// it alone must not read the roster precondition as unconditional: the
// PRE-FLIGHT fail-fast issues a verdict with no roster. Stated unconditionally,
// the line pushes an agent to synthesize an empty roster on that path, which
// collides with the inert-refactor state (roster present, zero rows) and makes
// "cycle never ran" indistinguishable from "cycle ran, no risk surface".
// ---------------------------------------------------------------------------

describe("new-prose: Quick Reference ROSTER line names the PRE-FLIGHT carve-out", () => {
	test("the ROSTER line inside Quick Reference names the PRE-FLIGHT fail-fast exception", () => {
		const quickRefStart = skillMd.indexOf("## Quick Reference");
		expect(quickRefStart).not.toBe(-1);
		const quickRef = skillMd.slice(quickRefStart);
		const rosterLine = quickRef
			.split("\n")
			.find((line) => line.startsWith("ROSTER:"));
		expect(rosterLine).toBeDefined();
		expect(rosterLine).toContain("PRE-FLIGHT fail-fast");
	});
});

// ---------------------------------------------------------------------------
// NEW-PROSE: Actor Roster — actors and their boundaries are pinned at PLAN,
// before any scenario exists (must FAIL before the edit — RED)
//
// Baseline this closes (skills/qa/tests/actor-boundary-scenario.md): a live
// cycle named its actor, then executed the scenario by calling the changed
// function from a harness, captured a launch screen as mobile evidence, filed
// the unreachable hardware hop as coverage delta, and summed two evidence sets
// collected at different depths into an end-to-end APPROVE.
// ---------------------------------------------------------------------------

describe("new-prose: Actor Roster is produced before scenarios", () => {
	test("PLAN's first sub-step is the Actor Roster", () => {
		const planStart = skillMd.indexOf("### PLAN");
		expect(planStart).not.toBe(-1);
		const planEnd = skillMd.indexOf("### BASELINE", planStart + 1);
		expect(planEnd).not.toBe(-1);
		const planSection = skillMd.slice(planStart, planEnd);
		expect(planSection).toContain("Actor Roster");
		expect(planSection).toContain("before any scenario");
	});

	test("the roster row shape names actor, boundary, driver, and reachability", () => {
		expect(skillMd).toContain("`actor · boundary · driver · reachable`");
	});

	test("an inner code unit is explicitly disqualified as a boundary", () => {
		expect(skillMd).toContain(
			"A function, a class, or an internal module is never a boundary",
		);
	});

	test("an internal change is required to trace outward to a real boundary", () => {
		expect(skillMd).toContain("trace the call graph outward");
	});

	test("the Output Format carries an ## Actor Roster section", () => {
		expect(skillMd).toContain("## Actor Roster");
	});
});

// ---------------------------------------------------------------------------
// NEW-PROSE: scenarios are driven FROM the actor's boundary; an unreachable
// boundary is substituted at the last hop, never relocated inward
// ---------------------------------------------------------------------------

describe("new-prose: boundary-entry rule and substitution", () => {
	test("direct invocation of the changed unit is named a unit check, not a scenario run", () => {
		expect(skillMd).toContain(
			"Calling the changed function, class, or module directly is a unit check, not a scenario run",
		);
	});

	test("boundary substitution replaces only the unreachable hop", () => {
		expect(skillMd).toContain("Boundary substitution");
		expect(skillMd).toContain("replacing only the unreachable hop");
	});

	test("an unrunnable scenario is NOT-RUN rather than PASS", () => {
		expect(skillMd).toContain("`NOT-RUN`, not PASS");
	});

	test("a recorded coverage delta is not a substitute for running the scenario", () => {
		expect(skillMd).toContain("never a substitute for running it");
	});

	test("depth honesty forbids merging evidence sets collected at different depths", () => {
		expect(skillMd).toContain(
			"Evidence sets collected at different depths never merge into a deeper claim",
		);
	});

	test("the old inward-relocation license is gone", () => {
		expect(skillMd).not.toContain(
			"bash harness that invokes the code path directly",
		);
		expect(skillMd).not.toContain("nearest entry point");
	});

	test("boundary-evasion rationalizations are answered in a red-flag table", () => {
		expect(skillMd).toContain("Red Flags — Boundary Evasion");
		expect(skillMd).toContain("closest real entry point");
		expect(skillMd).toContain("the app launches");
	});
});

// ---------------------------------------------------------------------------
// NEW-PROSE: evidence proves what the actor could observe at its boundary
// ---------------------------------------------------------------------------

describe("new-prose: actor-perspective evidence contract", () => {
	test("every executed scenario carries before/action/after slots", () => {
		expect(skillMd).toContain("Actor-Perspective Evidence");
		expect(skillMd).toContain("| `before` |");
		expect(skillMd).toContain("| `action` |");
		expect(skillMd).toContain("| `after` |");
	});

	test("a launch/splash/landing capture is disqualified as scenario evidence", () => {
		expect(skillMd).toContain(
			"A screenshot of a launch, splash, or landing screen is not scenario evidence",
		);
	});

	test("internal signals are supporting evidence, never a replacement", () => {
		expect(skillMd).toContain("supporting evidence");
		expect(skillMd).toContain("never a replacement");
	});

	test("evidence files are named per scenario id so the roster maps 1:1", () => {
		expect(skillMd).toContain("scenario id");
	});
});

// ---------------------------------------------------------------------------
// NEW-PROSE: the verdict may not out-claim the depth it was driven at
// ---------------------------------------------------------------------------

describe("new-prose: approval is gated on boundary depth", () => {
	test("an H-priority scenario left NOT-RUN blocks APPROVE", () => {
		const guardStart = skillMd.indexOf("## Approval Decision");
		expect(guardStart).not.toBe(-1);
		expect(skillMd.slice(guardStart)).toContain(
			"An `H`-priority scenario left `NOT-RUN` blocks APPROVE",
		);
	});

	test("Quick Reference carries the actor-boundary and evidence lines", () => {
		const quickRefStart = skillMd.indexOf("## Quick Reference");
		expect(quickRefStart).not.toBe(-1);
		const quickRef = skillMd.slice(quickRefStart);
		const lines = quickRef.split("\n");
		const actorLine = lines.find((line) => line.startsWith("ACTOR:"));
		expect(actorLine).toBeDefined();
		expect(actorLine).toContain("boundary");
		const evidenceLine = lines.find((line) => line.startsWith("EVIDENCE:"));
		expect(evidenceLine).toBeDefined();
		expect(evidenceLine).toContain("before/action/after");
	});
});

// ---------------------------------------------------------------------------
// NEW-PROSE: a test-runner report is never scenario evidence; an undriven
// boundary is `unverified`, never a green pass (three-layer contract)
// ---------------------------------------------------------------------------

describe("new-prose: test-runner logs are never scenario evidence", () => {
	test("SKILL.md forbids a test-runner report as a cell's evidence", () => {
		expect(skillMd).toContain(
			"A scenario cell's evidence is a boundary OBSERVATION — a test-runner report is never it",
		);
		expect(skillMd).toContain("`record-cell` mechanically rejects a test-runner report");
	});

	test("SKILL.md excludes the app's own test suite from boundary substitution", () => {
		expect(skillMd).toContain(
			"Substitution replaces one unreachable hop — it never swaps the boundary for the app's test suite",
		);
		expect(skillMd).toContain("the requirement it covers is **unverified**");
	});

	test("scenario-authoring.md ties an unreachable boundary to NOT-RUN + unverified", () => {
		expect(scenarioAuthoringMd).toContain(
			"test-runner report (`vitest`/`jest`/`pytest`/`go test` output) is **never** a scenario's evidence",
		);
		expect(scenarioAuthoringMd).toContain("the scenario is `NOT-RUN`");
	});

	test("presentation.md maps an undriven user boundary to the loud unverified verdict", () => {
		expect(presentationMd).toContain('unverified (`unverified`)');
		expect(presentationMd).toContain("미검증 — 유저 경계 미구동");
	});
});

// ---------------------------------------------------------------------------
// NEW-PROSE: NOT-RUN is physical impossibility only — setup cost / time-box
// never justifies it; a caller's time-box does not override
// ---------------------------------------------------------------------------

describe("new-prose: setup cost never justifies NOT-RUN", () => {
	test("SKILL.md reserves NOT-RUN for physical impossibility, not setup amount", () => {
		expect(skillMd).toContain("NOT-RUN is reserved for physical impossibility, never for setup cost");
		expect(skillMd).toContain(
			"The amount of bootstrap work — full local stack, manual DB inserts, minting QA accounts and memberships",
		);
	});

	test("SKILL.md rejects a caller-imposed time-box as an override", () => {
		expect(skillMd).toContain("There is no time-box in this skill");
		expect(skillMd).toContain("If someone (even the caller) tells you to time-box, that instruction does not override this");
	});

	test("SKILL.md treats absent seed data as rung 2/3 work, not a NOT-RUN verdict", () => {
		expect(skillMd).toContain("Absent data is rung 2/3 work, not a verdict");
	});
});

// ---------------------------------------------------------------------------
// NEW-PROSE: reader evidence is converted natural language + screenshots;
// raw curl/HTTP dumps belong in the audit
// ---------------------------------------------------------------------------

describe("new-prose: reader evidence is per-scenario natural language + screenshots, not raw dumps", () => {
	test("presentation.md keys the reader evidence PER scenario via scenarios[...].observed", () => {
		expect(presentationMd).toContain("Per-scenario observation");
		expect(presentationMd).toContain("scenarios");
	});

	test("presentation.md forces every verified scenario to carry a reader-visible record (observation OR screenshot)", () => {
		expect(presentationMd).toContain("an authored observation OR a screenshot");
	});

	test("presentation.md converts a raw API/CLI transcript to a per-scenario NL observation, raw stays in the audit", () => {
		expect(presentationMd).toContain("**convert** it to");
		expect(presentationMd).toContain("Raw curl belongs in the audit");
	});
});

// ---------------------------------------------------------------------------
// NEW-PROSE: requirementMapping is a structured, current-cycle grounding
// contract; prose explains a grounded verdict but never establishes it.
// ---------------------------------------------------------------------------

describe("new-prose: requirement mappings are structurally grounded", () => {
	const mappingSection = () => {
		const start = presentationMd.indexOf("Requirement fulfillment");
		const end = presentationMd.indexOf("## Anchoring", start + 1);
		expect(start).not.toBe(-1);
		expect(end).toBeGreaterThan(start);
		return presentationMd.slice(start, end);
	};

	test("presentation.md requires non-empty cellRefs and exactly one current-cycle recorded cell per ref", () => {
		const mapping = mappingSection();
		expect(mapping).toContain("non-empty `cellRefs` array");
		expect(mapping).toContain("{story, cls, optional sub}");
		expect(mapping).toContain("exactly one recorded current-cycle cell");
		expect(mapping).toContain("recorded status");
		expect(mapping).toContain("`pass`, `fail`,");
		expect(mapping).toContain("or `na`");
	});

	test("presentation.md defines grounded status invariants for all four verdicts", () => {
		const mapping = mappingSection();
		expect(mapping).toMatch(/`yes` requires every referenced\s+cell to be `pass`/);
		expect(mapping).toMatch(/`no` requires every referenced\s+cell to be `fail`/);
		expect(mapping).toMatch(/`partial`\s+requires at least one `pass` and one `fail` and no `na`/);
		expect(mapping).toMatch(/`unverified` requires\s+at least one valid `na`/);
	});

	test("invalid mappings fail closed and prose cannot establish a verdict", () => {
		const mapping = mappingSection();
    expect(mapping).toMatch(/Missing\/legacy\/malformed\/duplicate\/stale\/unknown\/ineligible\s+mappings fail closed/);
		expect(mapping).toContain("visible neutral gap");
		expect(mapping).toContain("Prose evidence explains a verdict but cannot establish it");
	});

	test("the JSON example shows the structured cellRefs shape", () => {
		const start = presentationMd.indexOf("```json");
		const end = presentationMd.indexOf("```", start + 7);
		expect(start).not.toBe(-1);
		expect(end).toBeGreaterThan(start);
		const example = presentationMd.slice(start, end);
		expect(example).toContain('"cellRefs": [{ "story": "<story-id>", "cls": 1 }]');
	});

	test("the HTML Report and Final Checklist repeat the structural grounding gate", () => {
		const htmlStart = skillMd.indexOf("### HTML Report");
		const htmlEnd = skillMd.indexOf("\n---", htmlStart + 1);
		expect(htmlStart).not.toBe(-1);
		expect(htmlEnd).toBeGreaterThan(htmlStart);
		const htmlReport = skillMd.slice(htmlStart, htmlEnd);
		expect(htmlReport).toContain("non-empty `cellRefs` array");
		expect(htmlReport).toContain("exactly one recorded current-cycle cell");
		expect(htmlReport).toContain("visible neutral gap");
		expect(htmlReport).toContain("Prose evidence explains a verdict but cannot establish it");

		const checklist = skillMd.slice(skillMd.indexOf("## Final Checklist"));
		expect(checklist).toContain("every `requirementMapping` entry has a non-empty `cellRefs`");
		expect(checklist).toContain("Prose evidence explains a verdict but cannot establish it");
	});
});

// ---------------------------------------------------------------------------
// FINAL-CHECK: the completion self-audit forces each scenario's observation to
// name the MEDIUM it was captured through (screen/device capture vs API/CLI
// response). This closes the laundering path a real luna-max e2e exposed: an
// agent drove a screen-facing feature entirely via curl, then converted the
// transcripts to readable prose that read as user-boundary observations and
// passed every gate. Naming the medium — with the API-only-PR carve-out — is
// the forcing predicate that catches it without false-failing legit backend PRs.
// ---------------------------------------------------------------------------

describe("final-check: each scenario's observation names its medium (screen vs API/CLI)", () => {
	test("CHECK phase forces a per-scenario medium self-check with the API-only carve-out", () => {
		const checkStart = skillMd.indexOf("### CHECK");
		expect(checkStart).not.toBe(-1);
		const checkEnd = skillMd.indexOf("### DIAGNOSIS", checkStart + 1);
		expect(checkEnd).not.toBe(-1);
		const check = skillMd.slice(checkStart, checkEnd);
		expect(check).toContain("name the medium it was observed through");
		expect(check).toContain(
			"an API or CLI reading never stands in for a screen observation",
		);
		expect(check).toContain("no user-facing surface exists yet");
	});

	test("presentation self-audit carries the medium final-check item", () => {
		expect(presentationMd).toContain("name its medium");
	});

	test("presentation red flag catches an API reading dressed as a screen observation", () => {
		expect(presentationMd).toContain(
			"A human actor's scenario is observed only through an API/CLI response but reads as if the screen was driven",
		);
	});

	test("SKILL.md ends with an explicit checkbox completion checklist carrying the medium gate", () => {
		const idx = skillMd.indexOf("## Final Checklist");
		expect(idx).not.toBe(-1);
		// it is placed LAST — after Quick Reference — so it lands at the bottom
		// of the prompt where a final gate belongs (recency/salience).
		expect(idx).toBeGreaterThan(skillMd.indexOf("## Quick Reference"));
		const checklist = skillMd.slice(idx);
		// explicit, tickable checkboxes — not prose. Kept tight (~5): each box
		// is a distinct QA gate, no restatement of the same "all scenarios
		// passed" idea across several rows.
		const boxes = checklist.match(/- \[ \]/g) ?? [];
		expect(boxes.length).toBeGreaterThanOrEqual(5);
		expect(boxes.length).toBeLessThanOrEqual(6);
		// the medium gate rides on the list, with the API-only carve-out
		expect(checklist).toContain("names the medium it was observed through");
		expect(checklist).toContain("`unverified` at the screen");
		expect(checklist).toContain("API-only");
		// the QA gate is the adversarial E2E at the boundary
		expect(checklist).toContain("ADVERSARIAL E2E");
		// build/test/lint is an upstream phase gate, not a verdict-time item —
		// keep the QA checklist centered on user-boundary verification
		expect(checklist).not.toContain("build / test / lint");
		// priority/scoring mechanics live in CHECK + Approval Decision, not in
		// the scannable final checklist — keep them out to avoid restating them
		expect(checklist).not.toContain("`H`-priority");
		expect(checklist).not.toContain("nitpick");
	});
});

// ---------------------------------------------------------------------------
// NEW-PROSE: scenario-authoring.md's actor layer binds actor -> boundary
// ---------------------------------------------------------------------------

describe("new-prose: scenario-authoring actor layer carries the boundary", () => {
	test("the actor layer takes its actors from the Actor Roster", () => {
		expect(scenarioAuthoringMd).toContain("Actor Roster");
	});

	test("steps are required to begin at the actor's boundary", () => {
		expect(scenarioAuthoringMd).toContain(
			"steps begin at that actor's boundary",
		);
	});
});

// ---------------------------------------------------------------------------
// NEW-PROSE: two gaps that surfaced when the cycle was actually run against
// acme-home (skills/qa/tests/actor-boundary-scenario.md, "Observed on
// re-run"): a scenario that FAILED with a below-threshold finding had no state
// in the contract, and B ⊆ A had no reading when the QA REQUEST carries no
// EXPECTED OUTCOME — one run declared it not-evaluable, another filled A from
// the Scope list, making the gate vacuously true.
// ---------------------------------------------------------------------------

describe("new-prose: a failed row's disposition is pinned", () => {
	test("CHECK states that a FAILED row blocks, with the soft-pass carve-out", () => {
		const checkStart = skillMd.indexOf("### CHECK");
		expect(checkStart).not.toBe(-1);
		const checkEnd = skillMd.indexOf("### DIAGNOSIS", checkStart + 1);
		expect(checkEnd).not.toBe(-1);
		const checkSection = skillMd.slice(checkStart, checkEnd);
		expect(checkSection).toContain("A FAILED scenario row blocks CHECK");
		expect(checkSection).toContain("soft pass");
		expect(checkSection).toContain("COMMENT, never APPROVE");
	});

	test("a failed H-priority row blocks regardless of confidence", () => {
		expect(skillMd).toContain(
			"A failed **`H`-priority** row blocks whatever its score",
		);
	});

	test("restating a failed row as PASS is forbidden", () => {
		expect(skillMd).toContain("Never restate a failed row as PASS");
	});

	test("the Approval Decision table carries the soft-pass row", () => {
		const guardStart = skillMd.indexOf("## Approval Decision");
		expect(guardStart).not.toBe(-1);
		expect(skillMd.slice(guardStart)).toContain("CHECK soft-passes");
	});
});

describe("new-prose: the soft-pass carve-out is reachable and unambiguously scoped", () => {
	test("the soft-pass band is stated as a concrete score range, not a named threshold in another file", () => {
		const checkStart = skillMd.indexOf("### CHECK");
		const checkSection = skillMd.slice(
			checkStart,
			skillMd.indexOf("### DIAGNOSIS", checkStart + 1),
		);
		expect(checkSection).toContain("50–74");
		expect(checkSection).not.toContain("blocking threshold");
	});

	test("caller-provided and 75+ failures are excluded from the carve-out", () => {
		expect(skillMd).toContain("A failed **caller-provided** row blocks");
		expect(skillMd).toContain("A finding scoring **75+** blocks");
	});

	// A 75 is "likely to occur in practice, directly impacts functionality" on
	// feedback-protocol's own scale. A band that swallowed it into `nitpick`
	// would let a functional failure close a cycle as COMMENT instead of
	// entering DIAGNOSIS → FIX → RE-VERIFY.
	test("the nitpick band stops below the score the scale calls functional", () => {
		expect(skillMd).not.toContain("scores **50–79**");
		expect(feedbackMd).toContain("75+ → report as a blocking issue");
		expect(feedbackMd).toContain("50–74 → report as `nitpick (non-blocking)`");
		expect(feedbackMd).not.toContain("50–79");
		const quickRef = skillMd.slice(skillMd.indexOf("## Quick Reference"));
		expect(quickRef).toContain("50-74 nitpick, 75+ blocking");
	});

	// CHECK's soft pass is a distinct cycle outcome; EXIT is mandatory and its
	// table was exhaustive over {full-green, max_cycles, same-failure, safety},
	// leaving the soft pass with no transition to CLEANUP/STATE.
	test("EXIT has a transition for the soft pass", () => {
		const exitStart = skillMd.indexOf("### EXIT");
		const exitSection = skillMd.slice(
			exitStart,
			skillMd.indexOf("### CLEANUP", exitStart + 1),
		);
		expect(exitSection).toContain("Goal Met, soft pass");
		expect(exitSection).toContain("PASS → COMMENT");
	});

	test("a failure that cannot be scored at 50+ is re-run, not soft-passed", () => {
		expect(skillMd).toContain("not a soft pass but an unexplained failure");
	});

	test("the upstream ADVERSARIAL E2E gate routes by row class instead of stopping on any failure", () => {
		expect(stage3Md).not.toContain("ADVERSARIAL E2E Failure = Immediate Stop");
		expect(stage3Md).toContain("Stop or Carry, by Row Class");
		expect(stage3Md).toContain("No scenario-row failure issues a verdict here");
		expect(stage3Md).toContain("carry it to CHECK");
	});

	// The stop-driving classes used to issue REQUEST_CHANGES themselves, which
	// both bypassed the DIAGNOSIS → FIX → RE-VERIFY loop and contradicted the
	// stage's own claim that CHECK owns the verdict.
	test("the stop-driving classes delegate the verdict instead of issuing one", () => {
		const tableStart = stage3Md.indexOf("## ADVERSARIAL E2E Failure");
		const table = stage3Md.slice(
			tableStart,
			stage3Md.indexOf("\n---", tableStart + 1),
		);
		expect(table).not.toContain("Do NOT proceed to CHECK");
		expect(table).not.toContain("REQUEST_CHANGES");
		expect(table).toContain("go straight to CHECK");
		expect(table).toContain("stay `NOT-RUN` in the roster");
	});

	test("feedback-protocol's threshold rule matches its own 50-row instead of contradicting it", () => {
		expect(feedbackMd).not.toContain("Report only issues scoring 80+");
		expect(feedbackMd).toContain("`nitpick (non-blocking)`");
		expect(feedbackMd).toContain("Below 50 → discard");
	});
});

describe("new-prose: the boundary rule does not override verbatim caller scenarios", () => {
	test("the boundary rule is scoped to self-authored scenarios", () => {
		expect(skillMd).toContain("Every **self-authored** scenario is executed");
	});

	test("a caller-provided scenario is exempt from relocation but not from disclosure", () => {
		expect(skillMd).toContain("exempt from relocation");
		expect(skillMd).toContain("not exempt from disclosure");
		expect(skillMd).toContain("supports no claim above that layer");
	});

	// The public docs promised unconditional relocation, which a caller
	// supplying an inner-layer harness would observe as a broken promise.
	test("the public docs carry the same exemption, in both languages", () => {
		const docsDir = join(import.meta.dir, "..", "..", "docs", "skills");
		for (const file of ["review-quality.md", "review-quality.en.md"]) {
			const doc = readFileSync(join(docsDir, file), "utf8");
			expect(doc).toContain("caller-provided");
			expect(doc).toContain("driven-at");
			expect(doc).not.toContain(
				"Every scenario is entered at its actor's boundary",
			);
		}
	});
});

describe("new-prose: B subset-of A has a reading when A is absent", () => {
	test("a missing EXPECTED OUTCOME makes the gate not-evaluable", () => {
		expect(skillMd).toContain("`not-evaluable`");
	});

	test("filling A from the Scope list is named as a rubber stamp", () => {
		expect(skillMd).toContain("Never fill A from the Scope list");
	});
});

describe("new-prose: precondition bootstrap precedes unreachability", () => {
	test("the bootstrap ladder gates the word unreachable", () => {
		expect(skillMd).toContain("Precondition bootstrap (CRITICAL)");
		expect(skillMd).toContain(
			"A missing precondition is work to do, not an obstacle to record",
		);
		expect(skillMd).toContain(
			"one still unreachable after the bootstrap ladder above",
		);
	});

	test("each rung names its bootstrap, not a surrender", () => {
		expect(skillMd).toContain("non-deployment is an environment choice");
		expect(skillMd).toContain("create seed data");
		expect(skillMd).toContain("mint a test token");
		expect(skillMd).toContain("launch that platform too");
	});

	// The old example list taught the failure: it named a bootstrappable
	// obstacle (a missing credential) as a legitimate unreachable boundary.
	test("a missing credential is no longer an example of an unreachable boundary", () => {
		expect(skillMd).not.toContain(
			"a dependency answering 502, a missing credential",
		);
	});

	test("the roster spans the journey, not the diff", () => {
		expect(skillMd).toContain(
			"Never QA only the platform where the change landed",
		);
	});

	test("undeclared rung attempts are named boundary evasion", () => {
		expect(skillMd).toContain("boundary evasion, not a coverage delta");
	});

	// The local-fallback rung must not swallow deployment-targeted QA: when the
	// QA REQUEST verifies the deployment itself, a stage 404 is the failure
	// under test, and a local stack cannot stand in for the deployed artifact.
	test("rung 1 branches on what the QA REQUEST verifies", () => {
		expect(skillMd).not.toContain(
			"no deploy permission) → the deployed environment was never the boundary",
		);
		expect(skillMd).toContain("verifies the deployment itself");
		expect(skillMd).toContain("the deployed environment IS the boundary");
		expect(skillMd).toContain("never a precondition to bootstrap around");
	});

	test("the public docs carry the bootstrap ladder, in both languages", () => {
		const docsDir = join(import.meta.dir, "..", "..", "docs", "skills");
		expect(
			readFileSync(join(docsDir, "review-quality.md"), "utf8"),
		).toContain("전제조건 부트스트랩");
		expect(
			readFileSync(join(docsDir, "review-quality.en.md"), "utf8"),
		).toContain("Precondition bootstrap");
	});
});

// ---------------------------------------------------------------------------
// NEW-PROSE: documented QA provisioning protocol precedes improvisation.
// Origin: two live failures where the verifier hit "seeded account has no
// Program data" and "local DynamoDB access 500s", then improvised (manual
// onboarding; injected dummy AWS creds) instead of reading the project's
// documented pre-provisioned-account list, admin QA seeding tool, and local-env
// setup. See tests/precondition-bootstrap-scenario.md (surrender #7).
// ---------------------------------------------------------------------------

describe("new-prose: documented provisioning protocol precedes improvisation", () => {
	test("PLAN.1 requires reading the provisioning protocol before touching a driver", () => {
		expect(skillMd).toContain(
			"read the project's provisioning protocol before authoring",
		);
		expect(skillMd).toContain("documented, never improvised");
		expect(skillMd).toContain("pre-provisioned test accounts");
		expect(skillMd).toContain("before you touch a driver");
	});

	test("the provisioning lookup is conditional on a precondition, with a no-protocol fallback", () => {
		// Comment ②: the lookup must not fire for a change with no account/auth/data
		// precondition, and PLAN may record "no documented protocol" and fall through.
		expect(skillMd).toContain(
			"When a scenario needs an account, auth, or a data state",
		);
		expect(skillMd).toContain(
			"never block on this lookup a change that has no account/auth/data precondition at all",
		);
	});

	test("the bootstrap ladder gates improvisation behind the documented protocol", () => {
		expect(skillMd).toContain("Documented protocol first — before any rung below");
		expect(skillMd).toContain(
			"only when the project documents no such account or tool",
		);
	});

	test("rung 3 leads with the pre-provisioned account, not signup", () => {
		expect(skillMd).toContain(
			"first use the pre-provisioned QA account the documented protocol prescribes",
		);
	});

	test("red flags name the manual-onboarding and dummy-cred detours", () => {
		expect(skillMd).toContain("so I'll run onboarding to create it");
		expect(skillMd).toContain("so I'll inject dummy creds and keep going");
	});
});

// ---------------------------------------------------------------------------
// NEW-PROSE: local-first stance — stand up an isolated stack you own; a local
// startup config gap is a fix, not a stop; a shared/fragile env is neither a
// blocker nor something to corrupt.
// Origin: a live failure where the verifier abandoned local QA because the
// local backend would not boot (config gap) and the local stack was shared.
// See tests/precondition-bootstrap-scenario.md (surrender #8 / P9).
// ---------------------------------------------------------------------------

describe("new-prose: local-first stance stands up an isolated stack, never surrenders", () => {
	test("the local-first stance is stated as a bootstrap posture", () => {
		expect(skillMd).toContain("Local-first stance");
		expect(skillMd).toContain("stand up an isolated stack you own");
	});

	test("a local startup config gap is bootstrap work, not a stop", () => {
		expect(skillMd).toContain("A local stack that fails to boot on a missing or misconfigured env");
		expect(skillMd).toContain("a startup config gap is bootstrap work, not a stop");
	});

	test("env-setup commands/docs are read and applied", () => {
		expect(skillMd).toContain("environment-setup commands and docs");
	});

	test("standup is necessity-driven, not a fixed checklist tied to what changed", () => {
		// Comment ①: a component comes up because a scenario depends on it, not
		// because it was the thing changed; a command-boundary change may have no
		// service/db/bundler to stand up at all.
		expect(skillMd).toContain(
			"Stand up whatever the scenario needs to run and to give you that control — never a fixed checklist",
		);
		expect(skillMd).toContain(
			"not because it was the thing that changed",
		);
		expect(skillMd).toContain(
			"may have no service, database, or bundler behind it at all",
		);
	});

	test("a shared/fragile env is neither a blocker nor something to corrupt", () => {
		expect(skillMd).toContain("neither a blocker");
		expect(skillMd).toContain("nor something you corrupt");
	});

	test("red flags name the won't-start and shared-stack surrenders", () => {
		expect(skillMd).toContain("so I stopped");
		expect(skillMd).toContain("so I left it alone and didn't run local QA");
	});
});

describe("new-prose: product use-case breadth is a required derivation axis", () => {
	// The gap this closes: journey scenarios appeared in probes only when the
	// prompt handed the verifier a feature map. Real runs hand nothing — the
	// skill must mandate building the map and walking its axes.
	test("Layer D exists and mandates building the product-context map from the repo", () => {
		expect(scenarioAuthoringMd).toContain("Layer D — Product Use-Case Breadth");
		expect(scenarioAuthoringMd).toContain("product-context map");
		expect(scenarioAuthoringMd).toContain("from the repo, not from the QA REQUEST");
	});

	test("the three use-case axes are named as conditional requirements", () => {
		expect(scenarioAuthoringMd).toContain("Arrival paths");
		expect(scenarioAuthoringMd).toContain("Adjacent state transitions");
		expect(scenarioAuthoringMd).toContain("Lifecycle stances");
	});

	test("the cycle's breadth step and coverage delta carry Layer D", () => {
		expect(skillMd).toContain("Layer D");
		expect(skillMd).toContain(
			"arrival paths · adjacent state transitions · lifecycle stances",
		);
	});

	test("an absent axis is an authoring omission, not a delta", () => {
		expect(scenarioAuthoringMd).toContain(
			"an authoring omission, not a delta",
		);
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

// ---------------------------------------------------------------------------
// NEW-PROSE: self-contained HTML report is the canonical deliverable (RED)
// ---------------------------------------------------------------------------

describe("new-prose: HTML report is the canonical deliverable", () => {
	test("STATE terminal sequence renders the report before completing the state", () => {
		const setVerdict = skillMd.indexOf(
			"bun ${CLAUDE_SKILL_DIR}/scripts/qa-state.ts set-verdict <APPROVE|COMMENT|REQUEST_CHANGES>",
		);
		const report = skillMd.indexOf(
			"bun ${CLAUDE_SKILL_DIR}/scripts/qa-report.ts --session <id> --out <path> [--narrative <json-file>]",
		);
		const complete = skillMd.indexOf(
			"bun ${CLAUDE_SKILL_DIR}/scripts/qa-state.ts complete",
		);
		const verdictProse = skillMd.indexOf("and only then report the verdict prose");

		expect(setVerdict).not.toBe(-1);
		expect(report).not.toBe(-1);
		expect(complete).not.toBe(-1);
		expect(verdictProse).not.toBe(-1);
		expect(report).toBeGreaterThan(setVerdict);
		expect(complete).toBeGreaterThan(report);
		expect(verdictProse).toBeGreaterThan(complete);
	});

	test("qa-report.ts is invoked at STATE, before complete", () => {
		expect(skillMd).toContain("bun ${CLAUDE_SKILL_DIR}/scripts/qa-report.ts");
		expect(skillMd).toContain("immediately after `set-verdict` and before `complete`");
	});

	test("the report renders from qa-state records, not re-narrated", () => {
		expect(skillMd).toContain("from qa-state records, not re-narrated");
	});

	test("acceptance criteria are captured at PLAN via set-acceptance so the report renders them from records", () => {
		expect(skillMd).toContain("set-acceptance");
		expect(skillMd).toContain("the report renders its Acceptance Criteria section from this record");
	});

	test("only subjective narrative is supplied at render time, never persisted to qa-state", () => {
		expect(skillMd).toContain("Only subjective narrative");
		expect(skillMd).toContain("supplied at render time");
		expect(skillMd).toContain("never persisted to qa-state");
	});

	test("the reader scenario section is story-level and clean; cls/attack_point/driven_at live in the audit section", () => {
		expect(skillMd).toContain("the current-cycle baseline plus each scenario's `before` / `action` / `after` and recorded `evidence.path`");
		expect(skillMd).toContain("the six adversarial axes by name, never the `cls` number");
		expect(skillMd).toContain("시나리오 상세 기록 (감사)");
		expect(skillMd).toContain("omits the cell record's implementation-flavored fields");
	});

	test("the report caps evidence embedding per file and cumulatively", () => {
		expect(skillMd).toContain("2 MiB per file and 16 MiB cumulatively");
		expect(skillMd).toContain("after the cumulative budget is exhausted");
	});

	test("a fresh start clears prior acceptance criteria before the next report", () => {
		expect(skillMd).toContain("A fresh `start` clears `acceptance_criteria`");
		expect(skillMd).toContain("cannot inherit the previous cycle's criteria");
	});

	test("the report is produced on every cycle that reached a roster, PRE-FLIGHT fail-fast excepted", () => {
		expect(skillMd).toContain("every cycle that reached a roster");
		expect(skillMd).toContain("PRE-FLIGHT fail-fast");
	});

	test("the report is self-contained: no external CSS/JS/font/image references", () => {
		expect(skillMd).toContain("no external CSS/JS/font/image reference");
	});

	test("the chat Output Format carries the report's absolute path", () => {
		const outputStart = skillMd.indexOf("<Output_Format>");
		expect(outputStart).not.toBe(-1);
		const outputEnd = skillMd.indexOf("</Output_Format>", outputStart);
		expect(outputEnd).not.toBe(-1);
		const outputSection = skillMd.slice(outputStart, outputEnd);
		expect(outputSection).toContain("absolute path to the self-contained HTML report file");
	});
});

// ---------------------------------------------------------------------------
// NEW-PROSE: stack/seed/auth info is mined from repo docs and scripts, not
// asked or declared unreachable (RED)
// ---------------------------------------------------------------------------

describe("new-prose: stack/seed/auth info is mined from repo docs and scripts", () => {
	test("bootstrap rung 1 mines docs/scripts for how to stand up the stack", () => {
		expect(skillMd).toContain("mine the project's own docs and scripts for it");
		expect(skillMd).toContain("before asking the user or declaring the precondition unreachable");
	});

	test("bootstrap rung 2 mines docs/scripts for the seed procedure", () => {
		expect(skillMd).toContain("when the seeding procedure itself is not already known, mine README");
	});

	test("stage1-commands.md Discovery Order mines docker-compose and scripts/", () => {
		expect(stage1Md).toContain("docker-compose.yml");
		expect(stage1Md).toContain("docker-compose.*.yml");
		expect(stage1Md).toContain("`scripts/`");
	});

	test("stage1-commands.md states mining applies to stack/seed/auth, not only build/test/lint", () => {
		expect(stage1Md).toContain("Mining for stack/seed/auth");
		expect(stage1Md).toContain("before asking the user or declaring a precondition unreachable");
	});
});

// ---------------------------------------------------------------------------
// NEW-PROSE / STRIP: bootstrap ladder installs a missing tool local-first,
// global-fallback, substituting only on install failure — superseding the old
// blanket "Do NOT install" global-machine ban (RED)
// ---------------------------------------------------------------------------

describe("new-prose: bootstrap ladder installs a missing tool local-first, global-fallback", () => {
	test("a new bootstrap rung installs a missing required tool rather than skipping the scenario", () => {
		expect(skillMd).toContain("Required tool missing locally");
		expect(skillMd).toContain("project-local");
		expect(skillMd).toContain("no machine mutation");
	});

	test("the rung falls back to a global install only when project-local is impossible, then substitutes on failure", () => {
		expect(skillMd).toContain("try a **global** install");
		expect(skillMd).toContain("substitute *only that hop*");
	});

	test("the install rung never uses rm -rf or a force flag", () => {
		const rungStart = skillMd.indexOf("**Required tool missing locally**");
		expect(rungStart).not.toBe(-1);
		const rungEnd = skillMd.indexOf("\n\n", rungStart);
		expect(rungEnd).toBeGreaterThan(rungStart);
		const rungSection = skillMd.slice(rungStart, rungEnd);
		expect(rungSection).toContain("Never use `rm -rf` or a force flag");
	});
});

describe("strip: the old blanket 'Do NOT install' global-machine ban is gone", () => {
	test("the agent-browser blanket install ban is removed", () => {
		expect(stage3Md).not.toContain("Do NOT install agent-browser here");
		expect(stage3Md).not.toContain("the CLI is assumed pre-installed, and a QA flow must not mutate the global machine");
	});

	test("the playwright blanket install ban is removed", () => {
		expect(stage3Md).not.toContain("do not install or set one up: report that check as verification-unavailable");
	});
});

describe("new-prose: stage3-handson.md carries the local-first/global-fallback/substitution install policy", () => {
	test("agent-browser absence installs project-local first, global fallback second", () => {
		expect(stage3Md).toContain("install it rather than skip the scenario");
		expect(stage3Md).toContain("project-local first");
		expect(stage3Md).toContain("falling back to a global install only if a project-local install is not possible");
	});

	test("the offline-safety reason justifies local-first ordering, not a ban", () => {
		expect(stage3Md).toContain("a global install can hang or fail in offline/locked-down environments");
		expect(stage3Md).toContain("it is a safety order, not a ban");
	});

	test("playwright absence follows the same install-before-fallback policy", () => {
		expect(stage3Md).toContain("install it — project-local first, global only if project-local is not possible");
		expect(stage3Md).toContain("recorded as a substitution, not an unattempted skip");
	});
});

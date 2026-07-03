import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

// ---------------------------------------------------------------------------
// Token-contract tests for skills/ultraresearch/SKILL.md
// Mirror the present+absence assertion style of
// skills/prometheus/scripts/validate-plan.test.ts.
// Does NOT assert prose wording beyond contract tokens.
// Does NOT duplicate F3 behavioral QA scenarios.
// ---------------------------------------------------------------------------

const skillPath = join(import.meta.dir, "SKILL.md");
const skill = readFileSync(skillPath, "utf8");

// Helper: count non-overlapping occurrences of a substring
function count(token: string): number {
	let n = 0;
	let idx = 0;
	while ((idx = skill.indexOf(token, idx)) !== -1) {
		n++;
		idx += token.length;
	}
	return n;
}

// ---------------------------------------------------------------------------
// Engine phases
// ---------------------------------------------------------------------------

describe("engine phases", () => {
	test("Phase 0 — Decompose and intent-route is present", () => {
		expect(skill).toContain("Phase 0");
		expect(skill).toContain("Decompose");
		expect(skill).toContain("intent-route");
	});

	test("Phase 1 — Saturation wave is present", () => {
		expect(skill).toContain("Phase 1");
		expect(skill).toContain("Saturation wave");
	});

	test("Phase 2 — EXPAND until convergence is present", () => {
		expect(skill).toContain("Phase 2");
		expect(skill).toContain("EXPAND until convergence");
	});

	test("Phase 3 — Verify (separate verification pass) is present", () => {
		expect(skill).toContain("Phase 3");
		expect(skill).toContain("Verify");
		expect(skill).toContain("separate verification pass");
	});

	test("Phase 4 — Synthesize is present", () => {
		expect(skill).toContain("Phase 4");
		expect(skill).toContain("Synthesize");
	});
});

// ---------------------------------------------------------------------------
// Convergence stop rules + carry-over + non-contradiction
// ---------------------------------------------------------------------------

describe("convergence stop rules", () => {
	test("zero unchecked leads stop rule is present", () => {
		expect(skill).toContain("Zero unchecked leads remain");
	});

	test("3 consecutive empty waves stop rule is present", () => {
		expect(skill).toContain("3 consecutive empty waves");
	});

	test("depth 5 cap stop rule is present", () => {
		expect(skill).toContain("Depth 5");
	});

	test("minimum 2 waves floor is present", () => {
		expect(skill).toContain("minimum 2");
	});

	test("carry-over rule — open annotated chains not counted empty — is present", () => {
		expect(skill).toContain("open annotated chains");
		expect(skill).toContain(
			"Convergence does NOT count a wave empty while open annotated chains remain",
		);
	});

	test("min-2 / empty-wave non-contradiction statement is present", () => {
		expect(skill).toContain("Non-contradiction statement");
	});
});

// ---------------------------------------------------------------------------
// Claim-ledger lock with OMT-native evidence
// ---------------------------------------------------------------------------

describe("claim-ledger lock", () => {
	test("≥2 independent source domains gate is present", () => {
		expect(skill).toContain("≥ 2 independent source domains");
	});

	test("counter-search gate condition is present", () => {
		expect(skill).toContain("One counter-search");
	});

	test("primary source gate condition is present", () => {
		expect(skill).toContain("A primary source");
	});

	test("sole allowlist lock is present", () => {
		expect(skill).toContain("sole allowlist");
	});

	test('"verified" predicate — executed code for code-shaped claims — is present', () => {
		expect(skill).toContain("executed code");
	});

	test('"verified" predicate — oracle citation re-read for non-code claims — is present', () => {
		expect(skill).toContain("oracle citation re-read");
	});

	test("MLflow is only referenced in negation (de-MLflow'd)", () => {
		// MLflow appears only in explicit "NOT MLflow" / "de-MLflow'd" negation contexts.
		// Every occurrence is a disclaimer that MLflow is NOT the evidence standard here.
		expect(skill).toContain("NOT MLflow");
		expect(skill).toContain("de-MLflow");
		// Absence: affirmative MLflow-as-backend phrasings must never appear.
		// "MLflow run-id" appears in exactly 2 legitimate negation contexts (attribution + evidence gate);
		// cap it at 2 so any additional affirmative reference is caught.
		expect(count("MLflow run-id")).toBeLessThanOrEqual(2);
		// These phrasings would only appear if someone added an affirmative instruction.
		expect(count("use MLflow")).toBe(0);
		expect(count("Use MLflow")).toBe(0);
		expect(count("using MLflow")).toBe(0);
		expect(count("MLflow as")).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Gatherer ≠ verifier separation
// ---------------------------------------------------------------------------

describe("gatherer != verifier separation", () => {
	test('"separate verification pass" is present', () => {
		expect(skill).toContain("separate verification pass");
	});

	test('"must not self-certify" is present', () => {
		expect(skill).toContain("must not self-certify");
	});

	test("oracle is NOT dispatched as a gatherer — explicit prohibition present", () => {
		expect(skill).toContain("oracle is never dispatched as a gatherer");
	});
});

// ---------------------------------------------------------------------------
// No run_in_background (foreground-only requirement)
// ---------------------------------------------------------------------------

describe("no async / synchronous waves only", () => {
	test("run_in_background is ABSENT", () => {
		expect(count("run_in_background")).toBe(0);
	});

	test("synchronous wave vocabulary is present", () => {
		expect(skill).toContain("wave");
		expect(skill).toContain("barrier collect");
		expect(skill).toContain("next wave");
	});
});

// ---------------------------------------------------------------------------
// SYNTHESIS.md — eight sections
// ---------------------------------------------------------------------------

describe("SYNTHESIS.md eight sections", () => {
	test("executive summary section is present", () => {
		expect(skill).toContain("executive summary");
	});

	test("findings by theme section is present", () => {
		expect(skill).toContain("findings by theme");
	});

	test("codebase findings section is present", () => {
		expect(skill).toContain("codebase findings");
	});

	test("ranked sources section is present", () => {
		expect(skill).toContain("ranked sources");
	});

	test("verified claims section is present", () => {
		expect(skill).toContain("verified claims");
	});

	test("contradictions section is present", () => {
		expect(skill).toContain("contradictions");
	});

	test("gaps section is present", () => {
		expect(skill).toContain("gaps");
	});

	test("expansion trace section is present", () => {
		expect(skill).toContain("expansion trace");
	});
});

// ---------------------------------------------------------------------------
// Three journal files
// ---------------------------------------------------------------------------

describe("three journal files", () => {
	test("wave-*.md journal file is present", () => {
		expect(skill).toContain("wave-*.md");
	});

	test("expansion-log.md journal file is present", () => {
		expect(skill).toContain("expansion-log.md");
	});

	test("claim-ledger.md journal file is present", () => {
		expect(skill).toContain("claim-ledger.md");
	});
});

// ---------------------------------------------------------------------------
// Single-snapshot write-ordering
// ---------------------------------------------------------------------------

describe("single-snapshot write-ordering", () => {
	test("single post-convergence snapshot statement is present", () => {
		expect(skill).toContain("single post-convergence snapshot");
	});

	test("artifacts are NOT accreted per-wave — explicit statement is present", () => {
		expect(skill).toContain("NOT accreted per-wave");
	});
});

// ---------------------------------------------------------------------------
// Three-posture routing
// ---------------------------------------------------------------------------

describe("three-posture routing", () => {
	test("explicit research posture is present", () => {
		expect(skill).toContain("explicit research");
	});

	test("pre-work CLEAR posture is present", () => {
		expect(skill).toContain("pre-work CLEAR");
	});

	test("pre-work UNCLEAR posture is present", () => {
		expect(skill).toContain("pre-work UNCLEAR");
	});

	test("posture selection criteria are present", () => {
		expect(skill).toContain("Posture selection criteria");
	});
});

// ---------------------------------------------------------------------------
// Tier → worker-floor table and signal source
// ---------------------------------------------------------------------------

describe("tier scaling", () => {
	test("intent class signal source is present", () => {
		expect(skill).toContain("prometheus intent class");
	});

	test("T1 risk modifiers signal source is present", () => {
		expect(skill).toContain("T1 risk modifiers");
	});

	test("caller-supplied override signal source is present", () => {
		expect(skill).toContain("caller-supplied override");
	});

	test("worker-floor table rows — Trivial / Scoped / Complex / Architecture / explicit — are present", () => {
		expect(skill).toContain("Trivial");
		expect(skill).toContain("Scoped");
		expect(skill).toContain("Complex");
		expect(skill).toContain("Architecture");
	});
});

// ---------------------------------------------------------------------------
// Pre-work handoff conformance
// ---------------------------------------------------------------------------

describe("pre-work handoff conformance", () => {
	test("conformance to deep-interview handoff schema is present", () => {
		expect(skill).toContain("$OMT_DIR/deep-interview/{slug}.md");
	});

	test("SYNTHESIS.md as backing artifact is present", () => {
		expect(skill).toContain("backing artifact");
	});

	test("uncertainty and gaps first-class is present", () => {
		expect(skill).toContain("uncertainty and gaps are first-class");
	});
});

// ---------------------------------------------------------------------------
// UNCLEAR branches
// ---------------------------------------------------------------------------

describe("UNCLEAR autonomous branch", () => {
	test("oracle-substitute is present", () => {
		expect(skill).toContain("oracle-substitute");
	});

	test("oracle REQUEST_CHANGES → deep-interview escalation is present", () => {
		expect(skill).toContain("oracle-REQUEST_CHANGES");
		expect(skill).toContain("deep-interview escalation");
	});
});

// ---------------------------------------------------------------------------
// Human end-gate
// ---------------------------------------------------------------------------

describe("human end-gate", () => {
	test("human end-gate is present", () => {
		expect(skill).toContain("human end-gate");
	});

	test("single synchronization point is present", () => {
		expect(skill).toContain("single synchronization point");
	});

	test("UNCLEAR path pauses and surfaces for human approval is present", () => {
		expect(skill).toContain("pauses and surfaces");
	});
});

// ---------------------------------------------------------------------------
// Trivial short-circuit
// ---------------------------------------------------------------------------

describe("Trivial short-circuit", () => {
	test("Trivial tier short-circuits the engine — present", () => {
		expect(skill).toContain("Trivial tier short-circuits");
	});

	test("no SYNTHESIS.md on Trivial is present", () => {
		expect(skill).toContain("no SYNTHESIS");
	});

	test("no worker fan-out on Trivial is present", () => {
		expect(skill).toContain("no fan-out");
	});
});

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------

describe("attribution", () => {
	test("oh-my-openagent ultraresearch attribution is present", () => {
		expect(skill).toContain("oh-my-openagent");
		expect(skill).toContain("ultraresearch");
	});

	test("EviBound arXiv:2511.05524 attribution is present", () => {
		expect(skill).toContain("EviBound");
		expect(skill).toContain("arXiv:2511.05524");
	});

	test("Q00 + ouroboros Socratic lineage attribution is present", () => {
		expect(skill).toContain("Q00");
		expect(skill).toContain("ouroboros");
	});
});

// ---------------------------------------------------------------------------
// Non-goal absence (4 forbidden tokens)
// ---------------------------------------------------------------------------

describe("non-goal absence", () => {
	test("experiment/optimization loop is ABSENT", () => {
		expect(count("experiment/optimization loop")).toBe(0);
	});

	test("tmux auto-nudge is ABSENT", () => {
		expect(count("tmux auto-nudge")).toBe(0);
		expect(count("tmux")).toBe(0);
	});

	test("Codex goal-mode coupling is ABSENT", () => {
		expect(count("Codex goal-mode")).toBe(0);
	});

	test("second research skill is ABSENT", () => {
		expect(count("second research skill")).toBe(0);
	});
});

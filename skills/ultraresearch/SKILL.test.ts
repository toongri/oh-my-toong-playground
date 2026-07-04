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
// Claim-graph gate with OMT-native evidence
// ---------------------------------------------------------------------------

describe("claim-graph gate", () => {
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

	test("claim-graph.md journal file is present", () => {
		expect(skill).toContain("claim-graph.md");
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
// Posture routing (two postures: explicit research, pre-work CLEAR)
// ---------------------------------------------------------------------------

describe("posture routing", () => {
	test("explicit research posture is present", () => {
		expect(skill).toContain("explicit research");
	});

	test("pre-work CLEAR posture is present", () => {
		expect(skill).toContain("pre-work CLEAR");
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

	test("worker-floor table rows — Scoped / Complex / Architecture — are present", () => {
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
// Human end-gate
// ---------------------------------------------------------------------------

describe("human end-gate", () => {
	test("human end-gate is present", () => {
		expect(skill).toContain("human end-gate");
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

// ---------------------------------------------------------------------------
// Phase 1 — posture prune (RED test, TDD: authored before the SKILL.md edit)
// Asserts the POST-prune end state: UNCLEAR + Trivial fully removed, CLEAR
// reachability (tier-capped Scoped coupling + floor-exemption) retained.
// FAILS on the current unmodified SKILL.md; PASSES after the Phase-1 prune.
// Word-boundary is load-bearing: bare /unclear/i would match "uncleared" at
// the Phase-2-owned ledger Failure_Modes row, which Phase 1 must not touch.
// ---------------------------------------------------------------------------

describe("posture prune", () => {
	test("\\bunclear\\b (case-insensitive) is absent — Phase 1 prune target", () => {
		const matches = skill.match(/\bunclear\b/gi) || [];
		expect(matches.length).toBe(0);
	});

	test("\\btrivial\\b (case-insensitive) is absent — Phase 1 prune target", () => {
		const matches = skill.match(/\btrivial\b/gi) || [];
		expect(matches.length).toBe(0);
	});

	test("CLEAR reachability retained: tier-capped Scoped coupling language is present", () => {
		expect(skill).toContain("Scoped");
	});

	test("CLEAR reachability retained: min-2-wave floor-exemption for a Scoped in-interview single-fact call is present", () => {
		expect(/floor.*exempt|exempt.*floor|single-fact/i.test(skill)).toBe(true);
	});

	test("postures reduced to two: pre-work CLEAR present, pre-work UNCLEAR absent", () => {
		expect(skill).toContain("pre-work CLEAR");
		expect(skill).not.toContain("pre-work UNCLEAR");
	});

	// code-review PR #156 finding F2: the single-fact exemption lightens only the
	// min-2-wave floor (depth). Phase 0 still mandates "3+ orthogonal axes" and
	// Phase 1 "every axis at once" (breadth), so a one-fact grounding still fans
	// out across fabricated axes — the promised lightened footprint is unreachable
	// unless the decomposition is also scoped for this path. Assert the carve-out.
	test("CLEAR single-fact path scopes axis breadth to a single axis (no forced 3+ fan-out)", () => {
		expect(skill).toContain("single axis");
	});
});

// ---------------------------------------------------------------------------
// Phase 2 — epistemic-instrumentation suite (RED test, TDD: authored before
// the SKILL.md edit). Asserts the POST-edit-Phase-2 end state: claim-ledger
// renamed to claim-graph with the 15-field schema and 5-criteria gate; the
// 4 sibling artifacts (intent-diff, observation-manifest,
// verification-economics, cause-disappearance) adopted; worker-ownership
// invariant stated; tier-axis rigor rule recorded as OMT-original while the
// posture-orthogonality invariant is retained verbatim.
// FAILS on the current unmodified SKILL.md (still says "claim-ledger" and has
// none of the 5 artifacts); PASSES after tasks #11/#12/#13.
// ---------------------------------------------------------------------------

describe("epistemic suite / claim-graph gate", () => {
	describe("claim-ledger renamed to claim-graph", () => {
		test('"claim-ledger" / "claim ledger" token is absent', () => {
			expect(skill).not.toMatch(/claim[- ]ledger/i);
		});

		test("every bare \\bledger\\b occurrence is part of the \"Claims Ledger\" attribution only", () => {
			const ledgerMatches = skill.match(/\bledger\b/gi) || [];
			const claimsLedgerMatches = skill.match(/Claims\s+Ledger/gi) || [];
			// Non-vacuous: the attribution itself must still be present.
			expect(ledgerMatches.length).toBeGreaterThan(0);
			expect(ledgerMatches.length).toBe(claimsLedgerMatches.length);
		});
	});

	describe("intent-diff.md artifact (9-field schema)", () => {
		test("intent-diff.md filename is present", () => {
			expect(skill).toContain("intent-diff.md");
		});

		test("a representative subset of intent-diff.md's required fields is present in its context", () => {
			const idx = skill.indexOf("intent-diff.md");
			expect(idx).toBeGreaterThan(-1);
			const context = skill.slice(idx, idx + 1500);
			for (const field of [
				"intent_id",
				"expected truth",
				"observed reality",
				"violated invariant",
				"linked claim ids",
			]) {
				expect(context).toContain(field);
			}
		});
	});

	describe("claim-graph.md artifact (15-field schema)", () => {
		test("claim-graph.md filename is present", () => {
			expect(skill).toContain("claim-graph.md");
		});

		test("a representative subset of claim-graph.md's required fields is present in its context", () => {
			const idx = skill.indexOf("claim-graph.md");
			expect(idx).toBeGreaterThan(-1);
			const context = skill.slice(idx, idx + 2500);
			for (const field of [
				"claim_id",
				"risk tier",
				"independent observation groups",
				"counter-search result",
				"primary source backing",
				"final synthesis location",
			]) {
				expect(context).toContain(field);
			}
		});
	});

	describe("observation-manifest.md artifact (11-field schema)", () => {
		test("observation-manifest.md filename is present", () => {
			expect(skill).toContain("observation-manifest.md");
		});

		test("a representative subset of observation-manifest.md's required fields is present in its context", () => {
			const idx = skill.indexOf("observation-manifest.md");
			expect(idx).toBeGreaterThan(-1);
			const context = skill.slice(idx, idx + 1500);
			for (const field of [
				"observation_id",
				"evidence layer",
				"independence basis",
				"observed_at",
				"contamination notes",
			]) {
				expect(context).toContain(field);
			}
		});
	});

	describe("verification-economics.md artifact (8-field schema)", () => {
		test("verification-economics.md filename is present", () => {
			expect(skill).toContain("verification-economics.md");
		});

		test("a representative subset of verification-economics.md's required fields is present in its context", () => {
			const idx = skill.indexOf("verification-economics.md");
			expect(idx).toBeGreaterThan(-1);
			const context = skill.slice(idx, idx + 1500);
			for (const field of ["error cost", "defer/verify", "outcome", "residual risk"]) {
				expect(context).toContain(field);
			}
		});
	});

	describe("cause-disappearance.md artifact (8-field schema)", () => {
		test("cause-disappearance.md filename is present", () => {
			expect(skill).toContain("cause-disappearance.md");
		});

		test("a representative subset of cause-disappearance.md's required fields is present in its context", () => {
			const idx = skill.indexOf("cause-disappearance.md");
			expect(idx).toBeGreaterThan(-1);
			const context = skill.slice(idx, idx + 1500);
			for (const field of [
				"last_seen",
				"disconfirming observation",
				"replacement cause",
				"current status",
			]) {
				expect(context).toContain(field);
			}
		});
	});

	describe("verified-claims digest is the sole allowlist", () => {
		test('"verified-claims digest" is present', () => {
			expect(skill).toContain("verified-claims digest");
		});

		test('a "sole allowlist" / "sole synthesis" clause is present', () => {
			expect(/sole (allowlist|synthesis)/i.test(skill)).toBe(true);
		});
	});

	describe("5-criteria gate (2 criteria added to the former 3-criteria lock)", () => {
		test("independent observation groups criterion is present", () => {
			expect(/independent (observation|obs) groups?/i.test(skill)).toBe(true);
		});

		test("a temporal observed_at / valid_at criterion is present", () => {
			expect(/observed_at/i.test(skill) || /valid_at/i.test(skill)).toBe(true);
		});
	});

	describe("worker-ownership invariant", () => {
		test("artifacts are stated as orchestrator-owned", () => {
			expect(/orchestrator-owned/i.test(skill)).toBe(true);
		});

		test("workers are stated to never write the artifacts", () => {
			expect(/workers? never write/i.test(skill)).toBe(true);
		});
	});

	describe("tier-axis rigor rule (D-2 design note)", () => {
		test("Scoped tier scopes to the 3 base artifacts: claim-graph + intent-diff + observation-manifest", () => {
			expect(skill).toContain("claim-graph.md");
			expect(skill).toContain("intent-diff.md");
			expect(skill).toContain("observation-manifest.md");
		});

		test("higher tiers add verification-economics + cause-disappearance", () => {
			expect(skill).toContain("verification-economics.md");
			expect(skill).toContain("cause-disappearance.md");
		});

		test("tier-scaling rule vocabulary is present (rigor scales with complexity tier)", () => {
			expect(/tier[- ]scal/i.test(skill)).toBe(true);
		});

		test("posture-orthogonality invariant is retained verbatim: \"identical across both postures\"", () => {
			expect(skill).toContain("identical across both postures");
		});

		test("tier-scaling is recorded as OMT-original (not OMO)", () => {
			expect(/OMT-original/i.test(skill)).toBe(true);
		});
	});
});

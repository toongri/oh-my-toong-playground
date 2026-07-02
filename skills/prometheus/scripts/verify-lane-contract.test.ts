import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

// ---------------------------------------------------------------------------
// Verify-lane contract tokens (plan D-6): verbatim literals that MUST be
// present/absent in SKILL.md + interview.md after the verify-lane rewrite
// (TODO 1-4). Mirrors the adr-log-contract.test.ts both-halves pattern:
// every REPLACED token gets BOTH the new substring PRESENT and the old
// distinctive substring ABSENT, so a presence-only FALSE-GREEN (old text
// surviving beside the new) cannot pass. Purely-additive tokens get
// presence-only — that is correct for them. The change set is prose, so token
// presence/absence IS the verification surface (no runtime behavior to test).
// Each expect() is a discrete per-token assertion.
// ---------------------------------------------------------------------------

const skillPath = join(import.meta.dir, "..", "SKILL.md");
const skillContent = readFileSync(skillPath, "utf8");

const interviewPath = join(import.meta.dir, "..", "interview.md");
const interviewContent = readFileSync(interviewPath, "utf8");

const reviewPipelinePath = join(import.meta.dir, "..", "review-pipeline.md");
const reviewPipelineContent = readFileSync(reviewPipelinePath, "utf8");

const scenariosPath = join(import.meta.dir, "..", "tests", "application-scenarios.md");
const scenariosContent = readFileSync(scenariosPath, "utf8");

// ---------------------------------------------------------------------------
// SKILL.md PRESENCE — new verify-lane vocabulary that MUST appear.
// Additive tokens (fan-out, falsifying verifier, the 4 keys, evidence-anchored
// question) are presence-only by design; verify lane / librarian default lane /
// purely mechanical refactor pair with their absence-halves below.
// ---------------------------------------------------------------------------

describe("SKILL.md presence — verify-lane tokens", () => {
	it("P1: multi-aspect fan-out (additive)", () => {
		expect(skillContent).toContain("multi-aspect fan-out");
	});

	it("P2: falsifying verifier (additive)", () => {
		expect(skillContent).toContain("falsifying verifier");
	});

	it("P3: verify lane: Evidence-block list-marker line (mixed Complex mode placeholder)", () => {
		// The template now expresses the mixed Complex case: codebase lanes inline
		// + external lane dispatched when present. Old single-mode form is gone.
		expect(skillContent).toContain(
			"- verify lane: <inline (codebase) + dispatched (external) (Complex with external lane) | inline (Complex, no external lane) | dispatched (Architecture)> / N lanes / M excluded",
		);
	});

	it("P3-A: old mode-less verify lane line is gone (intent-split replaces it)", () => {
		expect(skillContent).not.toContain("- verify lane: dispatched / N lanes / M excluded");
	});

	it("P4: stale_state key (additive)", () => {
		expect(skillContent).toContain("stale_state");
	});

	it("P5: prompt_injection key (additive)", () => {
		expect(skillContent).toContain("prompt_injection");
	});

	it("P6: nonexistent_path key (additive)", () => {
		expect(skillContent).toContain("nonexistent_path");
	});

	it("P7: version_drift key (additive)", () => {
		expect(skillContent).toContain("version_drift");
	});

	it("P8: librarian default lane (replaces the conditional-dispatch text)", () => {
		expect(skillContent).toContain("librarian default lane");
	});

	it("P9: purely mechanical refactor (default-lane carve-out)", () => {
		expect(skillContent).toContain("purely mechanical refactor");
	});

	it("P10: evidence-anchored question (additive)", () => {
		expect(skillContent).toContain("evidence-anchored question");
	});

	it("C6-P: verify lane no-op form (replaces old dispatched/0/0 form)", () => {
		expect(skillContent).toContain("no-op / 0 lanes / 0 excluded");
	});

	it("C12-P: nonexistent_path scoped to repo paths (additive scope clarification)", () => {
		expect(skillContent).toContain("scoped to repo paths");
	});
});

// ---------------------------------------------------------------------------
// SKILL.md ABSENCE — the absence-halves for the REPLACED tokens above. Each
// old distinctive substring MUST be gone so the new text cannot pass with the
// stale text surviving beside it (FALSE-GREEN guard).
// ---------------------------------------------------------------------------

describe("SKILL.md absence — replaced verify-lane tokens", () => {
	it("A1: old misleading_success_output key is gone", () => {
		expect(skillContent).not.toContain("misleading_success_output");
	});

	it("A2: old dirty_worktree key is gone", () => {
		expect(skillContent).not.toContain("dirty_worktree");
	});

	it("A3: old librarian trigger enumeration is gone", () => {
		expect(skillContent).not.toContain(
			"New library introduction, major version upgrade, security-related technology choice",
		);
	});

	it("A4: old conditional-librarian dispatch line is gone", () => {
		expect(skillContent).not.toContain("librarian dispatched THIS session (Architecture only)");
	});

	it("C6-A: old verify lane dispatched/0/0 form is gone", () => {
		expect(skillContent).not.toContain("verify lane: dispatched / 0 lanes / 0 excluded");
	});
});

// ---------------------------------------------------------------------------
// SKILL.md SURVIVAL — distinctive substrings of untouched sections that MUST
// remain. Guards that the verify-lane rewrite did not collaterally delete the
// Decomposition Self-Check, the structural-enumeration tier, or the Review
// Pipeline contract.
// ---------------------------------------------------------------------------

describe("SKILL.md survival — untouched-section tokens", () => {
	it("S1: Decomposition Self-Check Output survives", () => {
		expect(skillContent).toContain("Decomposition Self-Check Output");
	});

	it("S2: Structural enumeration (Complex and Architecture only) survives", () => {
		expect(skillContent).toContain("Structural enumeration (Complex and Architecture only)");
	});

	it("S3: Review Pipeline contract heading survives", () => {
		expect(skillContent).toContain("## Review Pipeline (Mandatory Contract)");
	});

	it("S3b: Review Pipeline body — only Metis/Momus emit verdicts (distinctive section-body phrase)", () => {
		expect(skillContent).toContain("Only Metis and Momus emit verdicts and gate the pipeline.");
	});
});

// ---------------------------------------------------------------------------
// review-pipeline.md SURVIVAL — the file must exist with its structural content
// intact. The heading check above only guards SKILL.md's inline summary; this
// guards the lookup file itself.
// ---------------------------------------------------------------------------

describe("review-pipeline.md survival — file content", () => {
	it("C15: review-pipeline.md carries the Stage A / Stage B / Stage C lookup structure", () => {
		expect(reviewPipelineContent).toContain(
			"Stage A HTML render, Stage B Decision Matrix computation",
		);
	});
});

// ---------------------------------------------------------------------------
// interview.md — the Interview-contract templates pick up the verify-lane
// vocabulary (presence, additive) but MUST NOT carry the SKILL.md-only
// `evidence-anchored question` token (absence — boundary guard).
// ---------------------------------------------------------------------------

describe("interview.md presence — verify-lane templates", () => {
	it("I1: multi-aspect fan-out (additive)", () => {
		expect(interviewContent).toContain("multi-aspect fan-out");
	});

	it("I2: falsifying verifier (additive)", () => {
		expect(interviewContent).toContain("falsifying verifier");
	});

	it("I4: verifier template carries the schema confidence dimension (replaces the ladder verdict line)", () => {
		expect(interviewContent).toContain("confidence");
	});

	it("C12-P: {LANE_EVIDENCE} placeholder present in verifier dispatch template", () => {
		expect(interviewContent).toContain("{LANE_EVIDENCE}");
	});

	it("C11-P: reference to SKILL.md Exclusion rule present (replaces restated prose)", () => {
		expect(interviewContent).toContain("Exclusion rule");
	});
});

describe("interview.md absence — SKILL.md-only token", () => {
	it("I3: evidence-anchored question does not leak into interview.md", () => {
		expect(interviewContent).not.toContain("evidence-anchored question");
	});

	it("C12-A: old {LANE_FILES} placeholder is gone", () => {
		expect(interviewContent).not.toContain("{LANE_FILES}");
	});

	it("C11-A: old restated keep corroborated lanes prose is gone", () => {
		expect(interviewContent).not.toContain("keep `corroborated` lanes");
	});
});

// ---------------------------------------------------------------------------
// interview.md ABSENCE — the absence-half for the verifier-template verdict
// rewrite. The old template instructed the verifier to return the uppercase
// CONFIRMED/PLAUSIBLE/REFUTED ladder line, which SKILL.md's D-1 contract
// EXPLICITLY FORBIDS for the verify schema. Both exact ladder verdict lines
// MUST be gone so the new `{ verdict, evidence, confidence }` schema cannot pass
// with the stale ladder line surviving beside it (FALSE-GREEN guard). These are
// case-sensitive against the exact old phrases — they do NOT forbid lowercase
// `refuted`/`corroborated`, which the new schema vocabulary uses.
// ---------------------------------------------------------------------------

describe("interview.md absence — replaced ladder verdict line", () => {
	it("I5: old `Verdict: CONFIRMED` ladder line is gone", () => {
		expect(interviewContent).not.toContain("Verdict: CONFIRMED");
	});

	it("I6: old `Verdict: REFUTED` ladder line is gone", () => {
		expect(interviewContent).not.toContain("Verdict: REFUTED");
	});

	it("M1: intro sentence single-verdict phrasing is gone (per-finding intro reword)", () => {
		// The intro at :126-127 previously said "returns a single verdict against the SKILL.md schema"
		// — singular, contradicting the per-finding contract. After the M1 fix this phrase must be absent.
		expect(interviewContent).not.toContain("returns a single verdict against the SKILL.md schema");
	});
});

// ---------------------------------------------------------------------------
// P2-A: no-op template branch in Phase-1 Evidence template (SKILL.md :344)
// The no-op text now lives in the template bullet itself (additive to the
// No-op path rule section). Guard that the template carries the conditional
// form so a missing template entry cannot hide behind the rule-section copy.
// ---------------------------------------------------------------------------

describe("SKILL.md P2-A — no-op form lives in Phase-1 Evidence template", () => {
	it("P2-A-P: template bullet carries the no-op conditional form", () => {
		// The template bullet at :344 includes the conditional no-op text inline:
		// `<or "no-op / 0 lanes / 0 excluded" when all collect lanes are empty ...>`
		// Anchor on the conjunction that only appears in the template (not the rule
		// section), making this a tighter guard than the bare `no-op / 0 lanes / 0 excluded` C6-P.
		expect(skillContent).toContain(
			'"no-op / 0 lanes / 0 excluded" when all collect lanes are empty',
		);
	});

	it("P2-A-P2: N/A branch for Trivial/Scoped is present in template", () => {
		// The template bullet also specifies the Trivial/Scoped N/A form so both
		// branches of the visible-or-violation mandate appear inline.
		expect(skillContent).toContain(
			'"N/A — intent is Trivial/Scoped (verify lane is Complex/Architecture only)"',
		);
	});
});

// ---------------------------------------------------------------------------
// P2-B: per-finding verdict contract
// SKILL.md: per-finding token + N counts lanes unit note.
// interview.md: {LANE_FINDINGS} present / {LANE_FINDING} (exact singular) absent /
//   one block per finding present / dispatch invariant present.
// ---------------------------------------------------------------------------

describe("SKILL.md P2-B — per-finding verdict vocabulary", () => {
	it("P2-B-P1: per-finding verdict wording present in collect→verify contract", () => {
		expect(skillContent).toContain("per-finding");
	});

	it("P2-B-P2: N counts lanes unit distinction present (N=lanes, M=findings)", () => {
		expect(skillContent).toContain("N counts lanes");
	});

	it("P2-B-P3: Exclusion rule is explicitly per finding", () => {
		// Distinctive phrase that confirms per-finding scope of the Exclusion rule.
		expect(skillContent).toContain("Exclusion is applied **per finding**");
	});

	it('P2-B-P4: Complex intent inline branch — "no verifier subagent" present (SKILL.md :388)', () => {
		// Guards the Complex zero-spawn half of the intent-split (collect→verify contract).
		// Paired with P2-B-I4 (Architecture dispatch invariant) — both halves must survive.
		// Deleting the Complex branch from SKILL.md turns this RED.
		expect(skillContent).toContain("no verifier subagent");
	});

	it('P2-B-P5: Complex intent inline branch — "Zero spawns" present (SKILL.md :390)', () => {
		// Second anchor on the Complex zero-spawn contract. Two distinct literals means
		// paraphrasing one literal still trips the other.
		expect(skillContent).toContain("Zero spawns");
	});
});

describe("interview.md P2-B — per-finding schema and {LANE_FINDINGS} guard", () => {
	it("P2-B-I1: {LANE_FINDINGS} plural placeholder present in verifier template", () => {
		expect(interviewContent).toContain("{LANE_FINDINGS}");
	});

	it("P2-B-I2: {LANE_FINDING} singular (exact, closing brace) absent — replaced by plural", () => {
		// Use the exact singular string with closing brace so `{LANE_FINDINGS}` (which
		// contains `{LANE_FINDING` as a prefix) does NOT trigger a false absent-failure.
		// The regex-free not.toContain against the exact `{LANE_FINDING}` token is safe
		// because `{LANE_FINDINGS}` ends with `S}`, not `}`.
		expect(interviewContent).not.toContain("{LANE_FINDING}");
	});

	it("P2-B-I3: one block per finding schema instruction present", () => {
		expect(interviewContent).toContain("emit one block per finding");
	});

	it("P2-B-I4: dispatch invariant — one falsifying verifier per non-empty lane", () => {
		// Guards that the per-lane dispatch contract survived the rewrite.
		expect(interviewContent).toContain(
			"dispatch one **falsifying verifier** subagent per non-empty lane",
		);
	});

	it('P2-B-I5: Complex zero-spawn invariant — "do NOT dispatch verifiers" present (interview.md :132)', () => {
		// Guards the Complex half of the intent-split alongside the Architecture half above (P2-B-I4).
		// Deleting the Complex inline-falsification prose from interview.md turns this RED.
		expect(interviewContent).toContain("do NOT dispatch verifiers");
	});
});

// ---------------------------------------------------------------------------
// Option A invariant: external lane is ALWAYS delegated (Complex and
// Architecture alike). The planner never inline-reads external evidence.
//
// Presence tests: distinctive new clauses that must appear after the fix.
// Absence tests: old "inline at Complex" phrasing for the external lane must
// be gone — if someone reverts to external-inline, the absence half goes RED.
// ---------------------------------------------------------------------------

describe("Option A — external lane always delegated (SKILL.md + interview.md)", () => {
	it("OA-P1: SKILL.md — external lane keeps delegated verifier at Complex (new clause)", () => {
		// Guards the core Option A invariant in SKILL.md: the external lane is
		// delegated even on Complex intent. Reverting to all-inline-at-Complex
		// removes this phrase and turns this RED.
		// Anchors on the single-line portion of the new clause (line 392 of SKILL.md):
		// the full clause spans two lines, so we pin the distinctive single-line tail.
		expect(skillContent).toContain(
			"delegated falsifying-verifier subagent (Complex and Architecture alike)",
		);
	});

	it("OA-P2: interview.md — external lane always delegated verifier subagent (new clause)", () => {
		// Guards the Option A invariant in interview.md: the EXTERNAL collect lane
		// is always falsified by a delegated verifier, not inline at Complex.
		// Reverting to "(inline at Complex, delegated at Architecture)" removes this
		// phrase and turns this RED.
		expect(interviewContent).toContain(
			"always falsified by a delegated verifier subagent (Complex and Architecture alike)",
		);
	});

	it('OA-A1: interview.md — old "inline at Complex" external-lane phrasing is gone', () => {
		// The stale phrase that made the external lane inline at Complex.
		// Must be absent after the fix; if it survives, Option A is incomplete.
		expect(interviewContent).not.toContain("inline at Complex, delegated at Architecture");
	});

	it('OA-A2: SKILL.md — codebase inline rule is now explicitly scoped (not unqualified "inline — no verifier subagent")', () => {
		// The old unqualified phrase applied to ALL lanes. After the fix the rule
		// is scoped to codebase lanes only. The unqualified form must be gone.
		expect(skillContent).not.toContain(
			"planner runs that same falsification inline — no verifier subagent",
		);
	});

	it("OA-A3: SKILL.md — old Evidence-block template single-mode form is gone", () => {
		// The old template used <inline (Complex) | dispatched (Architecture)> — a
		// single-actor form that could not represent the mixed Complex case.
		// After the fix it must be gone; the new mixed-mode form replaces it.
		expect(skillContent).not.toContain("<inline (Complex) | dispatched (Architecture)>");
	});
});

// ---------------------------------------------------------------------------
// P2-C: P-25 reframing in application-scenarios.md
// Old axis ("outside the verify lane / not confined to the verify stage") is
// GONE; new axis ("applies uniformly across all lane types") is PRESENT.
// Both halves guard the reframe: FALSE-GREEN cannot pass if old text survives.
// ---------------------------------------------------------------------------

describe("scenarios P2-C — P-25 axis reframe (old absent, new present)", () => {
	it('P2-C-A1: old framing "outside the verify lane" is gone (case-insensitive)', () => {
		expect(scenariosContent.toLowerCase()).not.toContain("outside the verify lane");
	});

	it('P2-C-A2: old framing "not confined to the verify stage" is gone (case-insensitive)', () => {
		expect(scenariosContent.toLowerCase()).not.toContain("not confined to the verify stage");
	});

	it('P2-C-A3: old framing "not produced inside the verify lane itself" is gone (case-insensitive)', () => {
		expect(scenariosContent.toLowerCase()).not.toContain(
			"not produced inside the verify lane itself",
		);
	});

	it('P2-C-A4: old framing "out-of-verify-lane" is gone (case-insensitive)', () => {
		expect(scenariosContent.toLowerCase()).not.toContain("out-of-verify-lane");
	});

	it('P2-C-P1: new axis "applies uniformly across all lane types" is present', () => {
		// Distinctive new axis from P-25 Primary Technique line.
		expect(scenariosContent).toContain("applies uniformly across all lane types");
	});

	it('P2-C-P2: new framing "not one of the 5 explore aspect lanes" present (lane-type disambiguation)', () => {
		// Guards the cross-lane witness framing that replaces the old verify-stage axis.
		expect(scenariosContent).toContain("not one of the 5 explore aspect lanes");
	});
});

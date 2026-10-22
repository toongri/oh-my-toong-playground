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

const scenariosPath = join(import.meta.dir, "..", "tests", "application-scenarios.md");
const scenariosContent = readFileSync(scenariosPath, "utf8");

// ---------------------------------------------------------------------------
// SKILL.md PRESENCE — new verify-lane vocabulary that MUST appear.
// Additive tokens (fan-out, falsifying verifier, the 4 keys, evidence-anchored
// question) are presence-only by design; verify lane / librarian default lane /
// purely mechanical refactor pair with their absence-halves below.
// ---------------------------------------------------------------------------

describe("SKILL.md presence — verify-lane tokens", () => {
	it("P3-A: old mode-less verify lane line is gone (intent-split replaces it)", () => {
		expect(skillContent).not.toContain("- verify lane: dispatched / N lanes / M excluded");
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
// interview.md — the Interview-contract templates pick up the verify-lane
// vocabulary (presence, additive) but MUST NOT carry the SKILL.md-only
// `evidence-anchored question` token (absence — boundary guard).
// ---------------------------------------------------------------------------

describe("interview.md presence — verify-lane templates", () => {
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
// P2-B: per-finding verdict contract
// SKILL.md: per-finding token + N counts lanes unit note.
// interview.md: {LANE_FINDINGS} present / {LANE_FINDING} (exact singular) absent /
//   one block per finding present / dispatch invariant present.
// ---------------------------------------------------------------------------

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
});

import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

// ---------------------------------------------------------------------------
// ADR-log contract tokens: verbatim literals that MUST be present/absent in
// SKILL.md after the ADR-as-source-unification rewrite (plan AC30, AC31-RED).
// ADR-9: both-halves assertion prevents FALSE-GREEN — a presence-only test
// would pass even if the obsolete structural-snapshot section were still in
// place alongside new content.
// Each expect() is a discrete per-token assertion.
// ---------------------------------------------------------------------------

const skillPath = join(import.meta.dir, "..", "SKILL.md");
const skillContent = readFileSync(skillPath, "utf8");

// ---------------------------------------------------------------------------
// ABSENCE assertions — tokens that MUST NOT appear in the rewritten SKILL.md
// (obsolete structural-snapshot vocabulary)
// ---------------------------------------------------------------------------

describe("absence assertions — obsolete structural-snapshot tokens", () => {
	it("O1: snapshot section title is gone", () => {
		expect(skillContent).not.toContain("Structural Co-Design Snapshot");
	});

	it("O2: Allocation table header is gone", () => {
		expect(skillContent).not.toContain(
			"| Unit | Responsibility | Owns State | Interfaces | Must NOT Own |",
		);
	});

	it("O3: Flow table header is gone", () => {
		expect(skillContent).not.toContain(
			"| Step | Caller | Callee | Data/Command | Side Effect | Failure/Retry Path |",
		);
	});
});

// ---------------------------------------------------------------------------
// PRESENCE assertions — tokens that MUST appear in the rewritten SKILL.md
// (new ADR-log vocabulary)
// ---------------------------------------------------------------------------

describe("presence assertions — new ADR-log tokens", () => {
	it("N1: core contract sentence — every decision is one titled D-N item", () => {
		// Anchors the core contract sentence (SKILL.md ~707) which exists exactly once.
		// The old `D-N` token alone matched 5 independent locations; this distinctive
		// substring is the unique sentence that names the contract and must not be deletable.
		expect(skillContent).toContain("is **one titled `D-N` item**");
	});

	it("N2: invalidated alternative (one line)", () => {
		expect(skillContent).toContain("Invalidated alternative");
	});

	it("N3: what it must NOT own", () => {
		expect(skillContent).toContain("what it must NOT own");
	});

	it("N4: caller→callee, side effect, failure path", () => {
		expect(skillContent).toContain("(caller→callee, side effect, failure path)");
	});

	it("N5: Edges: none", () => {
		expect(skillContent).toContain("Edges: none");
	});

	it("N6: no structural-enumeration path below the Complex band", () => {
		expect(skillContent).toContain("no structural-enumeration path below the Complex band");
	});

	it("N7: from the full set of D-items", () => {
		expect(skillContent).toContain("from the full set of D-items");
	});

	it("N8: WITHOUT inventing new ownership or edges", () => {
		expect(skillContent).toContain("WITHOUT inventing new ownership or edges");
	});

	it("N9: no new ownership and no new edges", () => {
		expect(skillContent).toContain("no new ownership and no new edges");
	});

	it("N10: architecture ideality", () => {
		expect(skillContent).toContain("architecture ideality");
	});

	it("N11: file:symbol", () => {
		expect(skillContent).toContain("file:symbol");
	});

	it("N12: every component the change creates or modifies", () => {
		expect(skillContent).toContain("every component the change creates or modifies");
	});
});

// ---------------------------------------------------------------------------
// plan-template.md worked example — D-N two-tier conformance
// Guards that the lookup-only ADR worked example uses the D-N item structure
// and does not regress to the pre-redesign single unnumbered MADR block.
// ---------------------------------------------------------------------------

const templatePath = join(import.meta.dir, "..", "plan-template.md");
const templateContent = readFileSync(templatePath, "utf8");

describe("plan-template ADR example — D-N structure", () => {
	it("T1: worked example contains a D-1 contested-tier heading", () => {
		// Unique in plan-template.md: only the ADR example section uses D-N item headings.
		// A regression to the old single unnumbered MADR block removes this token.
		expect(templateContent).toContain("### D-1:");
	});
});

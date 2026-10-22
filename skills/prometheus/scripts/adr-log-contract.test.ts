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

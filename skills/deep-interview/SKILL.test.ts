import { describe, test, expect } from "bun:test";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

// ---------------------------------------------------------------------------
// Prose-contract tests for skills/deep-interview/SKILL.md and template.
// Mirrors the presence/absence assertion style of
// skills/ultraresearch/SKILL.test.ts.
//
// RED step (pre-edit state — requirements-clarity vs design-clarity split):
//   - strip assertions (design-machinery phrases flipped to absent) FAIL
//     because the phrases are still present in SKILL.md
//   - new design-interview-prose assertions FAIL (phrases not yet in SKILL.md)
//   - template design-coverage-absent assertions FAIL (sections not yet
//     removed from the template)
//   - preserved render-pipeline + regression-guard assertions PASS
//     (invariants that must never break)
// ---------------------------------------------------------------------------

const skillMd = readFileSync(join(import.meta.dir, "SKILL.md"), "utf8");
const template = readFileSync(join(import.meta.dir, "deep-interview-spec-template.md"), "utf8");

// ---------------------------------------------------------------------------
// STRIP: design-machinery phrases removed by the Design Interview reshape
// (must FAIL before T3 edits SKILL.md — RED)
// ---------------------------------------------------------------------------

describe("strip: daedalus dispatch removed", () => {
	test("daedalus dispatch mention is absent", () => {
		expect(skillMd).not.toContain("daedalus");
	});
});

describe("strip: design-fork detection gate removed", () => {
	test("load-bearing design forks mention is absent", () => {
		expect(skillMd).not.toContain("load-bearing design forks");
	});
});

describe("strip: Use_When design approach trigger removed", () => {
	test("load-bearing design approach mention is absent", () => {
		expect(skillMd).not.toContain("load-bearing design approach");
	});
});

describe("strip: pressure loophole phrase removed", () => {
	test('"NOT a user-forced escape hatch" phrase is absent', () => {
		expect(skillMd).not.toContain("NOT a user-forced escape hatch");
	});
});

describe("strip: HOW-readiness gate removed", () => {
	test("how-readiness gate mention is absent", () => {
		expect(skillMd).not.toContain("how-readiness");
	});
});

describe("strip: per-section approval loop removed", () => {
	test("per-section mention is absent", () => {
		expect(skillMd).not.toContain("per-section");
	});
});

describe("strip: final whole-spec gate removed", () => {
	test("whole spec mention is absent", () => {
		expect(skillMd).not.toContain("whole spec");
	});
});

describe("strip: spec-reviewer dispatch removed", () => {
	test("spec-reviewer dispatch mention is absent", () => {
		expect(skillMd).not.toContain("spec-reviewer");
	});
});

describe("strip: bare threshold announcement removed", () => {
	test('"Clarity threshold met! Ready to proceed." bare announcement is absent (superseded by the seam)', () => {
		expect(skillMd).not.toContain("Clarity threshold met! Ready to proceed.");
	});
});

// ---------------------------------------------------------------------------
// PRESERVED (must PASS before AND after edits — invariant)
// ---------------------------------------------------------------------------

describe("preserved: inline self-review", () => {
	test("inline self-review is present", () => {
		expect(skillMd).toContain("self-review");
	});
});

describe("preserved: brainstorm-delegation phrase removal", () => {
	test('"explore options or brainstorm" phrase is absent', () => {
		expect(skillMd).not.toContain("explore options or brainstorm");
	});
});

// ---------------------------------------------------------------------------
// PRESERVED: mermaid visualization render-orchestration (must PASS — invariant)
// ---------------------------------------------------------------------------

describe("preserved: spec-presentation render target", () => {
	test("spec-presentation.html render target is present", () => {
		expect(skillMd).toContain("spec-presentation.html");
	});

	test("{slug}.html output naming is present", () => {
		expect(skillMd).toContain("{slug}.html");
	});

	test('"open it in a browser" instruction is present', () => {
		expect(skillMd).toContain("open it in a browser");
	});
});

describe("preserved: ontology-preview on-demand render", () => {
	test("ontology-preview.html render target is present", () => {
		expect(skillMd).toContain("ontology-preview.html");
	});

	test("on-demand ontology render mention is present", () => {
		expect(skillMd).toContain("on-demand ontology render");
	});

	test('"see, preview, or visualize the model" trigger phrase is present', () => {
		expect(skillMd).toContain("see, preview, or visualize the model");
	});

	test('"no entities yet" guard is present', () => {
		expect(skillMd).toContain("no entities yet");
	});
});

describe("preserved: render-assembly reference", () => {
	test("render-assembly.md reference is present", () => {
		expect(skillMd).toContain("render-assembly.md");
	});
});

// ---------------------------------------------------------------------------
// NEW-PROSE: Design Interview phase, seam, grill-me, every-decision framing
// (must FAIL before T3 edits SKILL.md — RED)
// ---------------------------------------------------------------------------

describe("new-prose: Design Interview phase heading", () => {
	test('"## Design Interview" phase heading is present', () => {
		expect(skillMd).toContain("## Design Interview");
	});
});

describe("new-prose: grill-me relentlessness", () => {
	test('"relentlessly" is present', () => {
		expect(skillMd).toContain("relentlessly");
	});

	test('"every aspect" is present', () => {
		expect(skillMd).toContain("every aspect");
	});
});

describe("new-prose: shared understanding target", () => {
	test('"shared understanding" is present', () => {
		expect(skillMd).toContain("shared understanding");
	});
});

describe("new-prose: one-at-a-time decision pacing", () => {
	test('"one at a time" is present', () => {
		expect(skillMd).toContain("one at a time");
	});
});

describe("new-prose: 2-3 alternatives per decision", () => {
	test('"2-3 alternatives" is present', () => {
		expect(skillMd).toContain("2-3 alternatives");
	});
});

describe("new-prose: every-decision framing", () => {
	test('"every design decision" is present (case-insensitive)', () => {
		expect(skillMd.toLowerCase()).toContain("every design decision");
	});
});

describe("new-prose: strawman-forcing grill", () => {
	test('"strawman" is present', () => {
		expect(skillMd).toContain("strawman");
	});
});

describe("new-prose: all design branches covered", () => {
	test('"all design branches" is present', () => {
		expect(skillMd).toContain("all design branches");
	});
});

describe("new-prose: residual-ambiguity seam on both exits", () => {
	test('"residual ambiguity" appears at least twice (both exit paths)', () => {
		const matches = skillMd.match(/residual ambiguity/g) || [];
		expect(matches.length).toBeGreaterThanOrEqual(2);
	});

	test("requirements-threshold exit call-site references the seam", () => {
		expect(skillMd).toContain("reflecting residual ambiguity via the Step 2-exit seam");
	});

	test("design-completion exit call-site references the seam", () => {
		expect(skillMd).toContain("Design-completion exit");
	});
});

// ---------------------------------------------------------------------------
// NEW-PROSE: Design Interview persists each decision to state (resume-safety)
// (must FAIL before the persistence step is added to SKILL.md — RED)
// ---------------------------------------------------------------------------

describe("new-prose: Design Interview persists decisions to state", () => {
	// Extract the Design Interview section: from its H2 heading to the next H2.
	const start = skillMd.indexOf("## Design Interview");
	const rest = skillMd.slice(start + "## Design Interview".length);
	const nextH2 = rest.indexOf("\n## ");
	const designSection = nextH2 === -1 ? rest : rest.slice(0, nextH2);

	test("persists each decision via the state CLI append", () => {
		expect(designSection).toContain("deep-interview-state.ts update");
		expect(designSection).toContain("--append-round-stdin");
	});

	test('persisted design round is marked kind:"design"', () => {
		expect(designSection).toContain('"kind":"design"');
	});
});

// ---------------------------------------------------------------------------
// REGRESSION GUARD (must PASS before AND after edits — invariant)
// ---------------------------------------------------------------------------

describe("regression-guard", () => {
	test("ambiguity formula is present", () => {
		expect(skillMd).toContain("goal × 0.40 + constraints × 0.30 + criteria × 0.30");
	});

	test("metis is absent from SKILL.md", () => {
		expect(skillMd.toLowerCase()).not.toContain("metis");
	});
});

// ---------------------------------------------------------------------------
// TEMPLATE (must PASS before AND after edits — invariant)
// ---------------------------------------------------------------------------

describe("template: approach and design decisions section", () => {
	test('"## Approach & Design Decisions" is present in template', () => {
		expect(template).toContain("## Approach & Design Decisions");
	});
});

// ---------------------------------------------------------------------------
// TEMPLATE: mermaid ontology erDiagram slot (must PASS — invariant)
// ---------------------------------------------------------------------------

describe("template: mermaid ontology erDiagram slot", () => {
	test("erDiagram is present in template", () => {
		expect(template).toContain("erDiagram");
	});
});

// ---------------------------------------------------------------------------
// TEMPLATE: design-coverage sections removed (must FAIL before T4 edit — RED)
// ---------------------------------------------------------------------------

describe("template: design-coverage sections removed", () => {
	test('"## Architecture" is absent from template', () => {
		expect(template).not.toContain("## Architecture");
	});

	test('"## Components" is absent from template', () => {
		expect(template).not.toContain("## Components");
	});

	test('"## Data Flow" is absent from template', () => {
		expect(template).not.toContain("## Data Flow");
	});

	test('"## Error Handling" is absent from template', () => {
		expect(template).not.toContain("## Error Handling");
	});

	test('"## Testing" is absent from template', () => {
		expect(template).not.toContain("## Testing");
	});

	test('"spec-reviewer" is absent from template', () => {
		expect(template).not.toContain("spec-reviewer");
	});
});

// ---------------------------------------------------------------------------
// FILE-EXISTENCE: mermaid visualization assets (must PASS — invariant)
// ---------------------------------------------------------------------------

describe("file-existence: mermaid visualization assets", () => {
	test("templates/spec-presentation.html exists", () => {
		expect(existsSync(join(import.meta.dir, "templates/spec-presentation.html"))).toBe(true);
	});

	test("references/render-assembly.md exists", () => {
		expect(existsSync(join(import.meta.dir, "references/render-assembly.md"))).toBe(true);
	});
});

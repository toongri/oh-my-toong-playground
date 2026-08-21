import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import {
	REQUIRED_HEADINGS,
	validatePlan,
	validatePlanGraph,
	validateBoundaryMap,
} from "./validate-plan.ts";

// ---------------------------------------------------------------------------
// Self-test: canonical heading list
// ---------------------------------------------------------------------------

test("validator required headings are the 7 canonical literals", () => {
	expect(REQUIRED_HEADINGS).toEqual([
		"TL;DR",
		"Context",
		"Work Objectives",
		"TODOs",
		"Execution Strategy",
		"Verification Strategy",
		"Success Criteria",
	]);
});

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function buildPlan(overrides: Partial<Record<string, string>> = {}): string {
	const defaults: Record<string, string> = {
		"TL;DR": "Short summary of the work.",
		Context: "Background and motivation for the work.",
		"Work Objectives": "The concrete goals we want to achieve.",
		TODOs: "- [ ] Step 1\n- [ ] Step 2",
		"Execution Strategy": "How we will execute the plan.",
		"Verification Strategy": "How we verify correctness.",
		"Success Criteria": "Definition of done.",
	};
	const sections = { ...defaults, ...overrides };
	return REQUIRED_HEADINGS.map((h) => {
		const body = sections[h] ?? `Body for ${h}.`;
		return `## ${h}\n\n${body}\n`;
	}).join("\n");
}

// ---------------------------------------------------------------------------
// Happy-path
// ---------------------------------------------------------------------------

describe("real-plan fixture passes", () => {
	test("real-plan fixture passes", () => {
		const plan = buildPlan();
		const missing = validatePlan(plan);
		expect(missing).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Empty section tests — one per required heading
// ---------------------------------------------------------------------------

describe("empty sections", () => {
	test("empty section: TL;DR", () => {
		const plan = buildPlan({ "TL;DR": "" });
		const missing = validatePlan(plan);
		expect(missing).toContain("TL;DR");
	});

	test("empty section: Context", () => {
		const plan = buildPlan({ Context: "" });
		const missing = validatePlan(plan);
		expect(missing).toContain("Context");
	});

	test("empty section: Work Objectives", () => {
		const plan = buildPlan({ "Work Objectives": "" });
		const missing = validatePlan(plan);
		expect(missing).toContain("Work Objectives");
	});

	test("empty section: TODOs", () => {
		const plan = buildPlan({ TODOs: "" });
		const missing = validatePlan(plan);
		expect(missing).toContain("TODOs");
	});

	test("empty section: Execution Strategy", () => {
		const plan = buildPlan({ "Execution Strategy": "" });
		const missing = validatePlan(plan);
		expect(missing).toContain("Execution Strategy");
	});

	test("empty section: Verification Strategy", () => {
		const plan = buildPlan({ "Verification Strategy": "" });
		const missing = validatePlan(plan);
		expect(missing).toContain("Verification Strategy");
	});

	test("empty section: Success Criteria", () => {
		const plan = buildPlan({ "Success Criteria": "" });
		const missing = validatePlan(plan);
		expect(missing).toContain("Success Criteria");
	});
});

// ---------------------------------------------------------------------------
// Policy tests
// ---------------------------------------------------------------------------

describe("validator policy", () => {
	test("validator policy: fenced heading not counted", () => {
		// ## Success Criteria appears ONLY inside a code fence — must NOT count
		const plan = buildPlan({ "Success Criteria": "" }).replace(
			"## Success Criteria\n\n\n",
			// Remove the real (empty) heading and replace entire section with
			// a fenced block that contains the heading literal
			"```\n## Success Criteria\nThis is inside a fence.\n```\n",
		);
		const missing = validatePlan(plan);
		expect(missing).toContain("Success Criteria");
	});

	test("validator policy: whitespace-only body empty", () => {
		// Body is only spaces/newlines — counts as empty
		const plan = buildPlan({ TODOs: "   \n   \n   " });
		const missing = validatePlan(plan);
		expect(missing).toContain("TODOs");
	});

	test("validator policy: duplicate heading first occurrence", () => {
		// First occurrence of TODOs has content; second is empty.
		// Validator must use FIRST occurrence → result should NOT list TODOs as missing.
		const plan = buildPlan() + "\n## TODOs\n\n\n";
		const missing = validatePlan(plan);
		expect(missing).not.toContain("TODOs");
	});
});

// ---------------------------------------------------------------------------
// Graph semantics — TODO id uniqueness, Blocked By resolution, cycles, Wave rule
// ---------------------------------------------------------------------------

/** Build a plan whose ## TODOs section contains the given TODO blocks. */
function buildGraphPlan(todoBlocks: string[]): string {
	return buildPlan({ TODOs: todoBlocks.join("\n") });
}

/** One TODO block in the plan-template checkbox shape. */
function todoBlock(id: string, opts: { blockedBy?: string; wave?: string } = {}): string {
	const lines = [`- [ ] ${id}. Task ${id}`];
	lines.push(`  - What to do: work for task ${id}`);
	if (opts.blockedBy !== undefined) lines.push(`  - Blocked By: ${opts.blockedBy}`);
	if (opts.wave !== undefined) lines.push(`  - Wave: ${opts.wave}`);
	return lines.join("\n");
}

describe("graph semantics", () => {
	test("valid dependency graph passes", () => {
		const plan = buildGraphPlan([
			todoBlock("1", { wave: "1" }),
			todoBlock("2", { wave: "1" }),
			todoBlock("3", { blockedBy: "TODO 1, TODO 2", wave: "2" }),
			todoBlock("F1", { blockedBy: "TODO 3", wave: "FINAL" }),
		]);
		expect(validatePlanGraph(plan)).toEqual([]);
	});

	test("duplicate TODO id detected", () => {
		const plan = buildGraphPlan([
			todoBlock("1", { wave: "1" }),
			todoBlock("1", { wave: "1" }),
		]);
		expect(validatePlanGraph(plan)).toContain("duplicate TODO id: 1");
	});

	test("Blocked By reference to undefined TODO detected", () => {
		const plan = buildGraphPlan([
			todoBlock("1", { wave: "1" }),
			todoBlock("2", { blockedBy: "TODO 9", wave: "2" }),
		]);
		expect(validatePlanGraph(plan)).toContain(
			"TODO 2: Blocked By references undefined TODO 9",
		);
	});

	test("self-dependency detected", () => {
		const plan = buildGraphPlan([todoBlock("1", { blockedBy: "TODO 1", wave: "1" })]);
		expect(validatePlanGraph(plan)).toContain("TODO 1: blocked by itself");
	});

	test("dependency cycle detected", () => {
		const plan = buildGraphPlan([
			todoBlock("1", { blockedBy: "TODO 2", wave: "1" }),
			todoBlock("2", { blockedBy: "TODO 1", wave: "2" }),
		]);
		const violations = validatePlanGraph(plan);
		expect(violations.some((v: string) => v.startsWith("dependency cycle:"))).toBe(true);
	});

	test("Wave mismatch against max(blocker)+1 detected", () => {
		const plan = buildGraphPlan([
			todoBlock("1", { wave: "1" }),
			todoBlock("2", { blockedBy: "TODO 1", wave: "3" }),
		]);
		expect(validatePlanGraph(plan)).toContain(
			"TODO 2: Wave 3 but expected 2 (= max(blocker waves) + 1)",
		);
	});

	test("empty Blocked By expects Wave 1", () => {
		const plan = buildGraphPlan([todoBlock("1", { wave: "2" })]);
		expect(validatePlanGraph(plan)).toContain(
			"TODO 1: Wave 2 but expected 1 (= max(blocker waves) + 1)",
		);
	});

	test("Blocked By: None treated as no blockers", () => {
		const plan = buildGraphPlan([todoBlock("1", { blockedBy: "None", wave: "1" })]);
		expect(validatePlanGraph(plan)).toEqual([]);
	});

	test("Wave FINAL task exempt from numeric formula", () => {
		const plan = buildGraphPlan([
			todoBlock("1", { wave: "1" }),
			todoBlock("F1", { blockedBy: "TODO 1", wave: "FINAL" }),
		]);
		expect(validatePlanGraph(plan)).toEqual([]);
	});

	test("numeric TODO cannot use Wave FINAL", () => {
		const plan = buildGraphPlan([todoBlock("1", { wave: "FINAL" })]);
		expect(validatePlanGraph(plan)).toContain(
			"TODO 1: Wave FINAL is reserved for F1-F4",
		);
	});

	test("noncanonical FINAL TODO id is rejected", () => {
		const plan = buildGraphPlan([todoBlock("F5", { wave: "FINAL" })]);
		expect(validatePlanGraph(plan)).toContain(
			"TODO F5: Wave FINAL is reserved for F1-F4",
		);
	});

	test("F1-F4 TODO must use Wave FINAL", () => {
		const plan = buildGraphPlan([todoBlock("F1", { wave: "1" })]);
		expect(validatePlanGraph(plan)).toContain("TODO F1: F1-F4 TODO must use Wave FINAL");
	});

	test("numeric-wave task blocked by FINAL task detected", () => {
		const plan = buildGraphPlan([
			todoBlock("F1", { wave: "FINAL" }),
			todoBlock("2", { blockedBy: "TODO F1", wave: "2" }),
		]);
		expect(validatePlanGraph(plan)).toContain(
			"TODO 2: numeric-wave task blocked by FINAL task F1",
		);
	});

	test("missing Wave field detected", () => {
		const plan = buildGraphPlan([todoBlock("1")]);
		expect(validatePlanGraph(plan)).toContain("TODO 1: missing Wave");
	});

	test("checkbox lines inside fences ignored", () => {
		const plan = buildGraphPlan([
			todoBlock("1", { wave: "1" }),
			"```\n- [ ] 1. duplicate inside fence\n- [ ] 9. phantom\n```",
		]);
		expect(validatePlanGraph(plan)).toEqual([]);
	});

	test("noncanonical checkbox TODO-only section is rejected", () => {
		const plan = buildGraphPlan(["- [ ] A. Task"]);
		expect(validatePlanGraph(plan)).toContain(
			"TODOs section contains no canonical checkbox TODOs",
		);
	});

	test("prose-only TODO section is rejected", () => {
		const plan = buildGraphPlan(["Describe the work here."]);
		expect(validatePlanGraph(plan)).toContain(
			"TODOs section contains no canonical checkbox TODOs",
		);
	});

	test("no TODOs section yields no graph violations", () => {
		// Section presence is validatePlan's job — graph validator must not duplicate it
		expect(validatePlanGraph("# not a plan\n\nprose only\n")).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Drift-lock: canonical headings in SKILL.md must match REQUIRED_HEADINGS
// ---------------------------------------------------------------------------

test("validator headings match SKILL contract", () => {
	// Resolve SKILL.md relative to this test file's directory
	const skillPath = join(import.meta.dir, "..", "SKILL.md");
	const skillContent = readFileSync(skillPath, "utf8");

	// Find the anchor line, then extract the immediately following fenced block
	const anchorLine = "Canonical required section headings (validator single source):";
	const anchorIdx = skillContent.indexOf(anchorLine);
	if (anchorIdx === -1) throw new Error(`Anchor not found in SKILL.md: "${anchorLine}"`);

	const afterAnchor = skillContent.slice(anchorIdx + anchorLine.length);

	// Find the opening fence (```)
	const fenceOpenMatch = afterAnchor.match(/^[ \t]*```[^\n]*\n/m);
	if (!fenceOpenMatch) throw new Error("Opening fence not found after anchor in SKILL.md");
	const fenceOpenEnd = fenceOpenMatch.index! + fenceOpenMatch[0].length;

	// Find the closing fence
	const afterFenceOpen = afterAnchor.slice(fenceOpenEnd);
	const fenceCloseMatch = afterFenceOpen.match(/^[ \t]*```[ \t]*$/m);
	if (!fenceCloseMatch) throw new Error("Closing fence not found after anchor in SKILL.md");

	const fenceBody = afterFenceOpen.slice(0, fenceCloseMatch.index!);

	// Extract lines that start with "## " — these are the canonical headings
	const extracted = fenceBody
		.split("\n")
		.filter((line) => line.startsWith("## "))
		.map((line) => line.slice("## ".length).trim());

	expect(extracted).toEqual(REQUIRED_HEADINGS);
});

// ---------------------------------------------------------------------------
// Boundary Map — consolidated two-axis boundary picture (structural plans only)
// ---------------------------------------------------------------------------

// A complete Boundary Map block: definition table (layer + Collaborators +
// affected/modified) + Dependency direction verdict. Structural enumeration is
// signalled by the "Must NOT own" ownership marker.
const BOUNDARY_MAP_OK = `## ADR

### D-2 — RenewSubscriptionUseCase (new, structural)

Owns the renewal sequence.
Must NOT own the charge mechanics.
Edges: (RenewalScheduler → RenewSubscriptionUseCase, trigger)

### Boundary Map

| Part | Layer (vertical domain / horizontal use-case) | Responsibility | Collaborators | affected / modified |
|------|------------------------------------------------|----------------|---------------|---------------------|
| RenewSubscriptionUseCase | horizontal use-case | orchestrates renewal | Subscription, Billing, Notification | modified (new) |
| Subscription | vertical domain | period + lifecycle | (called by use-case) | modified |
| Billing | vertical domain | charge | (called by use-case) | affected, unchanged |

**Dependency direction:** use-case → domains, one way. No domain→domain back-reference; unidirectional on both axes.
`;

describe("Boundary Map — structural plans", () => {
	test("not required when no structural enumeration (no Must NOT own)", () => {
		const plan = buildPlan();
		expect(validateBoundaryMap(plan)).toEqual([]);
	});

	test("complete Boundary Map block passes", () => {
		expect(validateBoundaryMap(BOUNDARY_MAP_OK)).toEqual([]);
	});

	test("structural enumeration with NO Boundary Map block fails", () => {
		const plan = `## ADR\n\n### D-2 — X (structural)\n\nOwns the thing.\nMust NOT own the other.\nEdges: none\n`;
		const out = validateBoundaryMap(plan);
		expect(out.length).toBe(1);
		expect(out[0]).toContain("block is missing");
	});

	test("Boundary Map block missing the Collaborators slot fails", () => {
		const plan = BOUNDARY_MAP_OK.replace(/Collaborators/g, "Uses");
		const out = validateBoundaryMap(plan);
		expect(out.some((v) => v.includes("Collaborators"))).toBe(true);
	});

	test("Boundary Map block missing the Dependency direction verdict fails", () => {
		const plan = BOUNDARY_MAP_OK.replace("Dependency direction", "Wiring");
		const out = validateBoundaryMap(plan);
		expect(out.some((v) => v.includes("Dependency direction"))).toBe(true);
	});

	test("markers only inside a fenced example do not count (fence-masking)", () => {
		const plan = `## ADR

### D-2 — X (structural)

Owns the thing.
Must NOT own the other.

### Boundary Map

\`\`\`
| Part | Layer | Collaborators | affected / modified |
Dependency direction: use-case → domains
\`\`\`
`;
		const out = validateBoundaryMap(plan);
		expect(out.length).toBeGreaterThan(0);
	});
});

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
const prometheusMd = readFileSync(join(import.meta.dir, "..", "prometheus", "SKILL.md"), "utf8");
const advancedMd = readFileSync(join(import.meta.dir, "deep-interview-advanced.md"), "utf8");

// ---------------------------------------------------------------------------
// Phase-3 (ambiguity dimension widening) parsing helpers.
//
// Three sources express the same {dim: weight} data in three different
// shapes (bare inline formula, comma-separated decimal table, percentage
// table). `normalizeDim` collapses any of their spellings ("Goal Clarity",
// "Constraint", "criteria", "Success Criteria", "constraints", ...) down to
// one canonical short key so cross-representation comparisons are MAP
// equality, never raw string identity.
// ---------------------------------------------------------------------------

function normalizeDim(raw: string): string {
	let s = raw.trim().toLowerCase();
	s = s.replace(/\s*clarity\s*$/, "");
	s = s.replace(/\s*criteria\s*$/, "");
	s = s.trim();
	if (s.endsWith("s") && !s.endsWith("ss")) s = s.slice(0, -1);
	return s;
}

function normalizeWeightMap(m: Record<string, number>): Record<string, number> {
	const out: Record<string, number> = {};
	for (const [k, v] of Object.entries(m)) out[normalizeDim(k)] = v;
	return out;
}

/** Parses deep-interview's canonical inline formula, e.g.
 *  `Greenfield: \`ambiguity = 1 - (intent × 0.30 + outcome × 0.25 + ...)\`` */
function parseInlineFormula(md: string, variant: "Greenfield" | "Brownfield"): Record<string, number> {
	const re = new RegExp(variant + ":\\s*`ambiguity = 1 - \\(([^)]*)\\)`");
	const m = md.match(re);
	if (!m) return {};
	const map: Record<string, number> = {};
	const pairRe = /([A-Za-z]+)\s*×\s*(\d+\.\d+)/g;
	let pm: RegExpExecArray | null;
	while ((pm = pairRe.exec(m[1])) !== null) {
		map[normalizeDim(pm[1])] = parseFloat(pm[2]);
	}
	return map;
}

/** Parses prometheus's decimal weight table rows, e.g.
 *  `| **Greenfield** | Intent, Outcome, ... | 0.30, 0.25, ... |` */
function parsePrometheusTable(md: string): { greenfield: Record<string, number>; brownfield: Record<string, number> } {
	const start = md.indexOf("**Ambiguity Score**:");
	const end = md.indexOf("## Failure Modes to Avoid");
	const region = md.slice(start === -1 ? 0 : start, end === -1 ? undefined : end);
	const rowRe = /\|\s*\*\*(Greenfield|Brownfield)\*\*\s*\|([^|]+)\|([^|]+)\|/g;
	const result: { greenfield: Record<string, number>; brownfield: Record<string, number> } = {
		greenfield: {},
		brownfield: {},
	};
	let m: RegExpExecArray | null;
	while ((m = rowRe.exec(region)) !== null) {
		const variant = m[1].toLowerCase() as "greenfield" | "brownfield";
		const dims = m[2].split(",").map((s) => normalizeDim(s));
		const weights = m[3].split(",").map((s) => parseFloat(s.trim()));
		const map: Record<string, number> = {};
		dims.forEach((d, i) => {
			map[d] = weights[i];
		});
		result[variant] = map;
	}
	return result;
}

/** Parses deep-interview-advanced.md's percentage weight table, e.g.
 *  `| Intent Clarity | 30% | 27% |` under the `Greenfield | Brownfield` header. */
function parseAdvancedPercentTable(md: string): { greenfield: Record<string, number>; brownfield: Record<string, number> } {
	const start = md.indexOf("## Brownfield vs Greenfield Weights");
	const end = md.indexOf("## Challenge Agent Modes");
	const region = md.slice(start === -1 ? 0 : start, end === -1 ? undefined : end);
	const rowRe = /\|\s*([A-Za-z][A-Za-z ]*?)\s*\|\s*(N\/A|\d+%)\s*\|\s*(N\/A|\d+%)\s*\|/g;
	const greenfield: Record<string, number> = {};
	const brownfield: Record<string, number> = {};
	let m: RegExpExecArray | null;
	while ((m = rowRe.exec(region)) !== null) {
		const dim = normalizeDim(m[1]);
		if (m[2] !== "N/A") greenfield[dim] = parseInt(m[2], 10) / 100;
		if (m[3] !== "N/A") brownfield[dim] = parseInt(m[3], 10) / 100;
	}
	return { greenfield, brownfield };
}

/** Parses the inner keys of the FIRST `"scores":{...}` object found after `anchorText`. */
function extractScoresKeys(md: string, anchorText: string): string[] {
	const anchorIdx = md.indexOf(anchorText);
	if (anchorIdx === -1) return [];
	const openMarker = '"scores":{';
	const openIdx = md.indexOf(openMarker, anchorIdx);
	if (openIdx === -1) return [];
	const innerStart = openIdx + openMarker.length;
	const closeIdx = md.indexOf("}", innerStart);
	const inner = md.slice(innerStart, closeIdx);
	const keys: string[] = [];
	const keyRe = /"(\w+)":/g;
	let m: RegExpExecArray | null;
	while ((m = keyRe.exec(inner)) !== null) keys.push(m[1]);
	return keys;
}

// D-5 canonical decided weights (both sum to 1.00) -- the single source of
// dims that the formula, the payload key-sets, and the two mirror tables
// (prometheus, deep-interview-advanced.md) must all agree with.
const EXPECTED_GREENFIELD_WEIGHTS = normalizeWeightMap({
	intent: 0.3,
	outcome: 0.25,
	scope: 0.2,
	constraints: 0.15,
	success: 0.1,
});
const EXPECTED_BROWNFIELD_WEIGHTS = normalizeWeightMap({
	intent: 0.27,
	outcome: 0.22,
	scope: 0.18,
	constraints: 0.14,
	success: 0.09,
	context: 0.1,
});

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
	test("ambiguity formula (greenfield, 5-dim canonical weights) is present", () => {
		expect(skillMd).toContain(
			"intent × 0.30 + outcome × 0.25 + scope × 0.20 + constraints × 0.15 + success × 0.10",
		);
	});

	test("ambiguity formula (brownfield, 6-dim canonical weights) is present", () => {
		expect(skillMd).toContain(
			"intent × 0.27 + outcome × 0.22 + scope × 0.18 + constraints × 0.14 + success × 0.09 + context × 0.10",
		);
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

// ---------------------------------------------------------------------------
// PHASE-3: ambiguity dimension widening (deep-interview + prometheus lockstep)
// (must FAIL before tasks #15/#16/#17 -- RED)
// ---------------------------------------------------------------------------

describe("phase-3 new-dims: scoring probe (deep-interview formula widened to D-5 canonical weights)", () => {
	test("greenfield formula parses to the canonical 5-dim weight map", () => {
		expect(normalizeWeightMap(parseInlineFormula(skillMd, "Greenfield"))).toEqual(EXPECTED_GREENFIELD_WEIGHTS);
	});

	test("brownfield formula parses to the canonical 6-dim weight map", () => {
		expect(normalizeWeightMap(parseInlineFormula(skillMd, "Brownfield"))).toEqual(EXPECTED_BROWNFIELD_WEIGHTS);
	});
});

describe("phase-3 parity: greenfield + brownfield weight maps agree across all 3 sources (normalized maps, not raw strings)", () => {
	const diGreenfield = normalizeWeightMap(parseInlineFormula(skillMd, "Greenfield"));
	const diBrownfield = normalizeWeightMap(parseInlineFormula(skillMd, "Brownfield"));
	const promTables = parsePrometheusTable(prometheusMd);
	const advancedTables = parseAdvancedPercentTable(advancedMd);
	const promGreenfield = normalizeWeightMap(promTables.greenfield);
	const promBrownfield = normalizeWeightMap(promTables.brownfield);
	const advancedGreenfield = normalizeWeightMap(advancedTables.greenfield);
	const advancedBrownfield = normalizeWeightMap(advancedTables.brownfield);

	test("greenfield: deep-interview formula == prometheus decimal table", () => {
		expect(diGreenfield).toEqual(promGreenfield);
	});

	test("greenfield: deep-interview formula == deep-interview-advanced.md percentage table", () => {
		expect(diGreenfield).toEqual(advancedGreenfield);
	});

	test("brownfield: deep-interview formula == prometheus decimal table", () => {
		expect(diBrownfield).toEqual(promBrownfield);
	});

	test("brownfield: deep-interview formula == deep-interview-advanced.md percentage table", () => {
		expect(diBrownfield).toEqual(advancedBrownfield);
	});

	test("greenfield map matches the D-5 canonical weights (sanity anchor)", () => {
		expect(diGreenfield).toEqual(EXPECTED_GREENFIELD_WEIGHTS);
	});

	test("brownfield map matches the D-5 canonical weights (sanity anchor)", () => {
		expect(diBrownfield).toEqual(EXPECTED_BROWNFIELD_WEIGHTS);
	});
});

describe("phase-3 payload key-set guard: scores{} key-sets match the D-5 canonical dimension set", () => {
	const EXPECTED_GREENFIELD_KEYS = new Set(Object.keys(EXPECTED_GREENFIELD_WEIGHTS));
	const EXPECTED_BROWNFIELD_KEYS = new Set(Object.keys(EXPECTED_BROWNFIELD_WEIGHTS));

	test("fact-ground payload (~:191) scores key-set is the 5-key greenfield set", () => {
		const keys = extractScoresKeys(skillMd, '"kind":"fact-ground"');
		expect(new Set(keys.map(normalizeDim))).toEqual(EXPECTED_GREENFIELD_KEYS);
	});

	test("Step 2e greenfield payload (~:343) scores key-set is the 5-key greenfield set", () => {
		const keys = extractScoresKeys(skillMd, "### Step 2e: Update State");
		expect(new Set(keys.map(normalizeDim))).toEqual(EXPECTED_GREENFIELD_KEYS);
	});

	test("Step 2e brownfield payload (~:358) scores key-set is the 6-key brownfield set", () => {
		const keys = extractScoresKeys(skillMd, "For brownfield interviews, include the");
		expect(new Set(keys.map(normalizeDim))).toEqual(EXPECTED_BROWNFIELD_KEYS);
	});

	test("no {goal,constraints,criteria} survivor at any payload site", () => {
		const allKeys = [
			...extractScoresKeys(skillMd, '"kind":"fact-ground"'),
			...extractScoresKeys(skillMd, "### Step 2e: Update State"),
			...extractScoresKeys(skillMd, "For brownfield interviews, include the"),
		];
		expect(allKeys).not.toContain("goal");
		expect(allKeys).not.toContain("criteria");
	});
});

describe("phase-3 [from-user] Step 2e content probe (SKILL.md content, not CLI behavior)", () => {
	const step2eStart = skillMd.indexOf("### Step 2e: Update State");
	const step2fStart = skillMd.indexOf("### Step 2f");
	const step2eRegion = step2fStart === -1 ? skillMd.slice(step2eStart) : skillMd.slice(step2eStart, step2fStart);

	test("Step 2e region is non-empty (sanity)", () => {
		expect(step2eStart).toBeGreaterThan(-1);
		expect(step2eRegion.length).toBeGreaterThan(0);
	});

	test("Step 2e region contains a [from-user] --append-provenance-item worked example", () => {
		expect(step2eRegion).toContain("[from-user]");
		expect(step2eRegion).toContain("--append-provenance-item");
	});
});

describe("phase-3 fixture absence: stale deep-interview test fixtures removed", () => {
	test("deep-interview/tests/application-scenarios.md does not exist", () => {
		expect(existsSync(join(import.meta.dir, "tests/application-scenarios.md"))).toBe(false);
	});

	test("deep-interview/tests/baseline-pressure-scenario.md does not exist", () => {
		expect(existsSync(join(import.meta.dir, "tests/baseline-pressure-scenario.md"))).toBe(false);
	});
});

describe("phase-3 collision guard: prometheus's own copies of the same fixtures survive", () => {
	const prometheusTestsDir = join(import.meta.dir, "..", "prometheus", "tests");

	test("prometheus/tests/application-scenarios.md exists", () => {
		expect(existsSync(join(prometheusTestsDir, "application-scenarios.md"))).toBe(true);
	});

	test("prometheus/tests/baseline-pressure-scenario.md exists", () => {
		expect(existsSync(join(prometheusTestsDir, "baseline-pressure-scenario.md"))).toBe(true);
	});
});

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
//
// RED step (deep-interview-decider-gate — wires the non-goal decider
// requirement into scoring + closure, upstream of metis/issue-reviewer):
// the 13 "decider-gate:" assertions below all FAILED against the pre-edit
// SKILL.md, for the expected reason (phrase absent, not a typo/crash):
//   - Scope Clarity scoring definition (2 tests): "decider" and "no decider"
//     were absent from the dimension-3 sentence.
//   - question-style table (3 tests): no "| Non-Goal Decider |" row existed.
//   - Closure Guard non-goal precondition (4 tests): the label "non-goal
//     decider precondition", the word "decider", "existence-only", and
//     "regardless of what the ambiguity reading says" were all absent from
//     the Step 2-exit section.
//   - Phase 4 self-review (4 tests): the stale "4 checks: placeholder /
//     consistency / scope / ambiguity" phrasing was still present (both
//     call sites), and the new "5 checks: ... / non-goal-decider / ..."
//     phrasing did not exist yet at either the inline self-review line or
//     the Final_Checklist line.
// The ambiguity-formula/weight-map regression-guard describe block and the
// "does not leak outside the section" negative-space test passed both
// before and after by design (untouched invariants).
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
// table). Since topology-floor-evolution Stage 4 (the SKILL.md prompt rewrite
// stage of the topology-floor-evolution spec) collapsed the greenfield/
// brownfield dual formula into ONE single 6-dim weighted formula (context
// always scored, per-component), all three sources now carry exactly one
// weight map each. `normalizeDim` collapses any of their spellings
// ("Constraint Clarity", "constraints", "Success Criteria", ...) down to
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

/** Parses deep-interview's single canonical inline formula, e.g.
 *  `ambiguity = 1 - (intent × 0.27 + outcome × 0.22 + ...)` -- unified, no
 *  greenfield/brownfield variant label (topology-floor-evolution Stage 4). */
function parseInlineFormula(md: string): Record<string, number> {
	const m = md.match(/ambiguity = 1 - \(([^)]*)\)/);
	if (!m) return {};
	const map: Record<string, number> = {};
	const pairRe = /([A-Za-z]+)\s*×\s*(\d+\.\d+)/g;
	let pm: RegExpExecArray | null;
	while ((pm = pairRe.exec(m[1])) !== null) {
		map[normalizeDim(pm[1])] = parseFloat(pm[2]);
	}
	return map;
}

/** Parses prometheus's single decimal weight-table row, e.g.
 *  `| Intent, Outcome, Scope, Constraints, Success, Context | 0.27, 0.22, ... |` */
function parsePrometheusTable(md: string): Record<string, number> {
	const start = md.indexOf("**Ambiguity Score**:");
	const end = md.indexOf("## Failure Modes to Avoid");
	const region = md.slice(start === -1 ? 0 : start, end === -1 ? undefined : end);
	const rowRe = /\|\s*([A-Za-z][A-Za-z, ]*[A-Za-z])\s*\|\s*(\d+\.\d+(?:\s*,\s*\d+\.\d+)*)\s*\|/;
	const m = region.match(rowRe);
	if (!m) return {};
	const dims = m[1].split(",").map((s) => normalizeDim(s));
	const weights = m[2].split(",").map((s) => parseFloat(s.trim()));
	const map: Record<string, number> = {};
	dims.forEach((d, i) => {
		map[d] = weights[i];
	});
	return map;
}

/** Parses deep-interview-advanced.md's single percentage weight table, e.g.
 *  `| Intent Clarity | 27% |` under the `## Ambiguity Weights` heading. */
function parseAdvancedPercentTable(md: string): Record<string, number> {
	const start = md.indexOf("## Ambiguity Weights");
	const end = md.indexOf("## Ambiguity Floor");
	const region = md.slice(start === -1 ? 0 : start, end === -1 ? undefined : end);
	const rowRe = /\|\s*([A-Za-z][A-Za-z ]*?)\s*\|\s*(\d+)%\s*\|/g;
	const map: Record<string, number> = {};
	let m: RegExpExecArray | null;
	while ((m = rowRe.exec(region)) !== null) {
		map[normalizeDim(m[1])] = parseInt(m[2], 10) / 100;
	}
	return map;
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

// Canonical single 6-dim weights (sum to 1.00) -- the single source of dims
// that the formula, the payload key-sets, and the two mirror tables
// (prometheus, deep-interview-advanced.md) must all agree with. The
// greenfield/brownfield dual-weight formula is retired (topology-floor-
// evolution Stage 4): every interview scores all 6 dimensions, always.
const EXPECTED_WEIGHTS = normalizeWeightMap({
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
// REMOVED: mermaid visualization render-orchestration (must FAIL before T6
// deletes the render machinery from SKILL.md — RED)
// ---------------------------------------------------------------------------

describe("removed: spec-presentation render target", () => {
	test("spec-presentation.html render target is absent", () => {
		expect(skillMd).not.toContain("spec-presentation.html");
	});

	test("{slug}.html output naming is absent", () => {
		expect(skillMd).not.toContain("{slug}.html");
	});

	test('"open it in a browser" instruction is absent', () => {
		expect(skillMd).not.toContain("open it in a browser");
	});
});

describe("removed: ontology-preview on-demand render", () => {
	test("ontology-preview.html render target is absent", () => {
		expect(skillMd).not.toContain("ontology-preview.html");
	});

	test("on-demand ontology render mention is absent", () => {
		expect(skillMd).not.toContain("on-demand ontology render");
	});

	test('"see, preview, or visualize the model" trigger phrase is absent', () => {
		expect(skillMd).not.toContain("see, preview, or visualize the model");
	});

	test('"no entities yet" guard is absent', () => {
		expect(skillMd).not.toContain("no entities yet");
	});
});

describe("removed: render-assembly reference", () => {
	test("render-assembly.md reference is absent", () => {
		expect(skillMd).not.toContain("render-assembly.md");
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
	// The pre-Stage-4 greenfield-only 5-dim formula test is retired here: UC9
	// (topology-floor-evolution Stage 4) replaces the dual greenfield/brownfield
	// formula with a single 6-dim formula, so a distinct 5-dim-no-context
	// greenfield formula no longer exists in SKILL.md by design (see the UC9
	// describe block below, which asserts its absence directly).

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
// TEMPLATE: mermaid ontology erDiagram slot relocated to a "## Diagrams"
// section, out of "## Ontology (Key Entities)" (must FAIL before T9
// rewrites the template — RED)
// ---------------------------------------------------------------------------

describe("template: mermaid ontology erDiagram slot", () => {
	test("erDiagram is absent from the Ontology (Key Entities) section", () => {
		const start = template.indexOf("## Ontology (Key Entities)");
		expect(start).not.toBe(-1);
		const end = template.indexOf("\n## ", start + 1);
		const section = end === -1 ? template.slice(start) : template.slice(start, end);
		expect(section).not.toContain("erDiagram");
	});

	test("erDiagram is present in the Diagrams section", () => {
		const start = template.indexOf("## Diagrams");
		expect(start).not.toBe(-1);
		const end = template.indexOf("\n## ", start + 1);
		const section = end === -1 ? template.slice(start) : template.slice(start, end);
		expect(section).toContain("erDiagram");
	});
});

// ---------------------------------------------------------------------------
// NEW-PROSE: diagram-guide.md wiring + canonical 6-lens coverage-table
// literals (must FAIL before T4 creates diagram-guide.md and T9 rewrites
// the template — RED)
// ---------------------------------------------------------------------------

describe("added: diagram-guide.md exists and is wired from SKILL.md", () => {
	test("skills/deep-interview/diagram-guide.md exists", () => {
		expect(existsSync(join(import.meta.dir, "diagram-guide.md"))).toBe(true);
	});

	test("SKILL.md references diagram-guide.md", () => {
		expect(skillMd).toContain("diagram-guide.md");
	});
});

describe("added: template carries the canonical 6-lens coverage table", () => {
	test('canonical coverage-table header "| Lens | Trigger FACT | Status |" is present', () => {
		expect(template).toContain("| Lens | Trigger FACT | Status |");
	});

	test('"drawn" status literal is present', () => {
		expect(template).toContain("drawn");
	});

	test('"trigger FALSE:" status literal is present', () => {
		expect(template).toContain("trigger FALSE:");
	});

	test('"## Diagrams" heading is present', () => {
		expect(template).toContain("## Diagrams");
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
// REMOVED: mermaid visualization assets (must FAIL before T6 deletes these
// files — RED)
// ---------------------------------------------------------------------------

describe("removed: mermaid visualization assets", () => {
	test("templates/spec-presentation.html does not exist", () => {
		expect(existsSync(join(import.meta.dir, "templates/spec-presentation.html"))).toBe(false);
	});

	test("references/render-assembly.md does not exist", () => {
		expect(existsSync(join(import.meta.dir, "references/render-assembly.md"))).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// PHASE-3: ambiguity dimension widening (deep-interview + prometheus lockstep)
// (must FAIL before tasks #15/#16/#17 -- RED)
// ---------------------------------------------------------------------------

describe("phase-3 new-dims: scoring probe (deep-interview formula unified to the single 6-dim canonical weights)", () => {
	test("the single formula's parsed dimension key-set is exactly the 6 canonical dimensions", () => {
		const parsed = normalizeWeightMap(parseInlineFormula(skillMd));
		expect(new Set(Object.keys(parsed))).toEqual(new Set(Object.keys(EXPECTED_WEIGHTS)));
	});

	test("the single formula parses to the canonical 6-dim weight map (values, not just keys)", () => {
		expect(normalizeWeightMap(parseInlineFormula(skillMd))).toEqual(EXPECTED_WEIGHTS);
	});
});

describe("phase-3 parity: single 6-dim weight map agrees across all 3 sources (normalized maps, not raw strings)", () => {
	const diWeights = normalizeWeightMap(parseInlineFormula(skillMd));
	const promWeights = normalizeWeightMap(parsePrometheusTable(prometheusMd));
	const advancedWeights = normalizeWeightMap(parseAdvancedPercentTable(advancedMd));

	test("SKILL.md's formula matches the canonical single 6-dim weights (sanity anchor)", () => {
		expect(diWeights).toEqual(EXPECTED_WEIGHTS);
	});

	test("prometheus/SKILL.md's weight table matches the canonical single 6-dim weights (sanity anchor)", () => {
		expect(promWeights).toEqual(EXPECTED_WEIGHTS);
	});

	test("deep-interview-advanced.md's weight table matches the canonical single 6-dim weights (sanity anchor)", () => {
		expect(advancedWeights).toEqual(EXPECTED_WEIGHTS);
	});

	test("SKILL.md formula == prometheus/SKILL.md weight table", () => {
		expect(diWeights).toEqual(promWeights);
	});

	test("SKILL.md formula == deep-interview-advanced.md weight table", () => {
		expect(diWeights).toEqual(advancedWeights);
	});

	test("prometheus/SKILL.md weight table == deep-interview-advanced.md weight table", () => {
		expect(promWeights).toEqual(advancedWeights);
	});
});

describe("phase-3 payload key-set guard: scores{} key-sets match the single canonical 6-dim dimension set", () => {
	const EXPECTED_KEYS = new Set(Object.keys(EXPECTED_WEIGHTS));

	test("fact-ground payload (~:198) scores key-set is the single canonical 6-key set", () => {
		const keys = extractScoresKeys(skillMd, '"kind":"fact-ground"');
		expect(new Set(keys.map(normalizeDim))).toEqual(EXPECTED_KEYS);
	});

	test("Step 2e round payload (~:373) scores key-set is the single canonical 6-key set", () => {
		const keys = extractScoresKeys(skillMd, "### Step 2e: Update State");
		expect(new Set(keys.map(normalizeDim))).toEqual(EXPECTED_KEYS);
	});

	test('no separate "brownfield-only" payload framing survives (single unconditional 6-key payload everywhere)', () => {
		expect(skillMd).not.toContain("For brownfield interviews, include the");
	});

	test("no {goal,constraints,criteria} survivor at either payload site", () => {
		const allKeys = [
			...extractScoresKeys(skillMd, '"kind":"fact-ground"'),
			...extractScoresKeys(skillMd, "### Step 2e: Update State"),
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

// ---------------------------------------------------------------------------
// phase-3 template propagation (code-review PR #156 finding F1, CONFIRMED):
// the Phase-4 output is composed from deep-interview-spec-template.md, so that
// template is a downstream consumer of the widened scoring dims. Its Clarity
// Breakdown table and the per-round transcript placeholder must carry the new
// Intent/Outcome/Scope split and must NOT reference the retired goal/criteria
// score keys — the persisted `scores` object no longer has them, so the old
// `(Goal: {g}, ..., Criteria: {cr})` placeholder would misreport the run.
// FAILS on the pre-fix template (still 4-dim Goal/Constraint/Success/Context).
// ---------------------------------------------------------------------------
describe("phase-3 template propagation: Phase-4 spec-template reflects the widened D-5 dimensions", () => {
	test("Clarity Breakdown table lists the split Intent/Outcome/Scope dimensions", () => {
		expect(template).toContain("Intent Clarity");
		expect(template).toContain("Outcome Clarity");
		expect(template).toContain("Scope Clarity");
	});

	test("Clarity Breakdown no longer has a bare 'Goal Clarity' dimension row", () => {
		expect(template).not.toContain("| Goal Clarity |");
	});

	test("transcript placeholder does not reference the retired goal/criteria score keys", () => {
		expect(template).not.toMatch(/Goal:\s*\{g\}/);
		expect(template).not.toMatch(/Criteria:\s*\{cr\}/);
	});

	test("examples do not target the retired 'Goal Clarity' dimension label", () => {
		const examplesMd = readFileSync(join(import.meta.dir, "deep-interview-examples.md"), "utf8");
		expect(examplesMd).not.toContain("Goal Clarity");
	});
});

// ---------------------------------------------------------------------------
// STAGE-4 (topology-floor-evolution): Round 0 Topology Enumeration Gate,
// per-component scoring, single weighted formula, Scope/Closure guards.
// (must FAIL before the Stage-4 SKILL.md prompt edits -- RED)
// ---------------------------------------------------------------------------

describe("UC12: step 3.7 no longer narrows to a single slice -- Round 0 enumerates all topology components", () => {
	test("old propose-only decomposition gate heading is absent", () => {
		expect(skillMd).not.toContain("propose-only decomposition gate");
	});

	test('old "Interview ONLY that first subsystem" narrowing instruction is absent', () => {
		expect(skillMd).not.toContain("Interview ONLY that first subsystem");
	});

	test('"Round 0" Topology Enumeration Gate heading is present', () => {
		expect(skillMd).toContain("Round 0");
		expect(skillMd).toContain("Topology Enumeration Gate");
	});

	test("Round 0 enumerates ALL components rather than narrowing to one slice", () => {
		expect(skillMd).toContain("Enumerate ALL topology components");
	});
});

describe("UC1 prompt contract: Round 0 surfaces components and gets user confirm/add/merge/defer", () => {
	const start = skillMd.indexOf("Round 0 — Topology Enumeration Gate");

	test("Round 0 section exists (sanity)", () => {
		expect(start).toBeGreaterThan(-1);
	});

	test("Round 0 asks the user to confirm/add/merge/defer the component list", () => {
		const region = skillMd.slice(start, start + 2000);
		expect(region).toContain("**confirm**");
		expect(region).toContain("**add**");
		expect(region).toContain("**merge**");
		expect(region).toContain("**defer**");
	});

	test("Round 0 locks the confirmed list via set-topology", () => {
		const region = skillMd.slice(start, start + 2000);
		expect(region).toContain("set-topology");
		expect(region).toContain("--json");
	});
});

describe("UC9: single weighted ambiguity formula replaces the greenfield/brownfield dual formula", () => {
	test("the old greenfield-only 5-dim formula (no context) is absent", () => {
		expect(skillMd).not.toContain(
			"intent × 0.30 + outcome × 0.25 + scope × 0.20 + constraints × 0.15 + success × 0.10",
		);
	});

	test('a distinct "Greenfield:"-labeled formula line no longer exists', () => {
		expect(skillMd).not.toMatch(/Greenfield:\s*`ambiguity = 1 - \(/);
	});

	test('a distinct "Brownfield:"-labeled formula line no longer exists (unified, not type-branched)', () => {
		expect(skillMd).not.toMatch(/Brownfield:\s*`ambiguity = 1 - \(/);
	});

	test("exactly one ambiguity weighted-sum formula appears in the doc", () => {
		const matches = skillMd.match(/ambiguity = 1 - \(/g) || [];
		expect(matches.length).toBe(1);
	});
});

describe("UC6: Scope Over-Engineering Guard forces an in/out question when scope is unscored or low", () => {
	test('"Scope Over-Engineering Guard" phrase is present', () => {
		expect(skillMd).toContain("Scope Over-Engineering Guard");
	});

	test('guard forces a "what\'s in vs what\'s out" boundary question', () => {
		expect(skillMd).toContain("what's in vs what's out");
	});

	test("guard names gold-plating as the failure it blocks", () => {
		expect(skillMd).toContain("gold-plating");
	});

	test("Closure Guard blocks convergence while any active component is unscored", () => {
		expect(skillMd).toContain("Closure Guard");
	});
});

// ---------------------------------------------------------------------------
// topology-floor-evolution Stage 6 (UC11 consumption): computeTopologyMigrationStatus
// is now consumed by deep-interview-state.ts's `get` output; this describe block
// asserts SKILL.md enforces the resume-side contract -- a resumed interview whose
// migration_status reads legacy_missing must run Round 0 before any further
// per-component scoring write. (must FAIL before this Stage-6 SKILL.md wiring -- RED)
// ---------------------------------------------------------------------------

describe("UC11: resume enforcement -- migration_status legacy_missing forces Round 0 before further scoring", () => {
	const round0Start = skillMd.indexOf("Round 0 — Topology Enumeration Gate");
	const toolUsageStart = skillMd.indexOf("<Tool_Usage>");

	test("Round 0 section exists (sanity)", () => {
		expect(round0Start).toBeGreaterThan(-1);
	});

	test("Round 0 gate section names migration_status and legacy_missing as a resume check", () => {
		const region = skillMd.slice(round0Start, round0Start + 3000);
		expect(region).toContain("migration_status");
		expect(region).toContain("legacy_missing");
	});

	test("Round 0 gate instructs running Round 0 before any further per-component scoring on resume", () => {
		const region = skillMd.slice(round0Start, round0Start + 3000);
		expect(region).toContain("before any further per-component scoring");
	});

	test("Tool_Usage's get bullet also surfaces the migration_status / legacy_missing enforcement", () => {
		expect(toolUsageStart).toBeGreaterThan(-1);
		const region = skillMd.slice(toolUsageStart);
		expect(region).toContain("migration_status");
		expect(region).toContain("legacy_missing");
	});
});

// ---------------------------------------------------------------------------
// topology-floor-evolution Stage 6c (doc-currency): the Phase-4 spec-template
// gained a "## Topology" per-component section (Round 0's enumerated
// components + their 6-dim clarity), and the Clarity Breakdown's Context row
// lost its stale "(brownfield)" qualifier -- context is scored on every
// component, greenfield or brownfield, per the Stage-4 single formula.
// ---------------------------------------------------------------------------

describe("template: Topology section reflects the per-component floor model", () => {
	const start = template.indexOf("## Topology");
	const end = template.indexOf("\n## ", start + 1);
	const section = end === -1 ? template.slice(start) : template.slice(start, end);

	test('"## Topology" heading is present', () => {
		expect(start).toBeGreaterThan(-1);
	});

	test("Topology section documents active | deferred component status", () => {
		expect(section).toContain("active");
		expect(section).toContain("deferred");
	});

	test("Topology section lists all 6 canonical clarity dimensions per component", () => {
		expect(section).toContain("Intent");
		expect(section).toContain("Outcome");
		expect(section).toContain("Scope");
		expect(section).toContain("Constraints");
		expect(section).toContain("Success");
		expect(section).toContain("Context");
	});
});

describe("template: Clarity Breakdown's Context row is no longer brownfield-qualified", () => {
	test('"Context Clarity (brownfield)" is absent', () => {
		expect(template).not.toContain("Context Clarity (brownfield)");
	});

	test('"| Context Clarity |" is present (context always scored)', () => {
		expect(template).toContain("| Context Clarity |");
	});

	test("transcript ambiguity breakdown no longer gates Context behind a brownfield-only clause", () => {
		expect(template).not.toContain("{brownfield: , Context: {cx}}");
	});
});

// ---------------------------------------------------------------------------
// deep-interview-decider-gate: wires the non-goal decider requirement (the
// `{excluded item} | decider: {how to tell a finding belongs to this
// exclusion}` shape the Phase 4 template's Non-Goals section already
// requires) into the interview's scoring and closure machinery, so a spec
// can no longer exit the interview with an undecidered non-goal. Checks
// existence only, never precision -- grading precision would turn a
// mechanical gate into an interpretation dispute.
// (must FAIL before the corresponding SKILL.md edits -- RED)
// ---------------------------------------------------------------------------

describe("decider-gate: Scope Clarity scoring definition requires a decider on excluded items", () => {
	const start = skillMd.indexOf("3. Scope Clarity (0.0-1.0):");
	const end = skillMd.indexOf("4. Constraint Clarity", start === -1 ? 0 : start);
	const region = start === -1 ? "" : skillMd.slice(start, end === -1 ? undefined : end);

	test("Scope Clarity definition exists (sanity)", () => {
		expect(start).toBeGreaterThan(-1);
	});

	test("Scope Clarity region names a decider requirement for excluded items", () => {
		expect(region).toContain("decider");
	});

	test("Scope Clarity region states an excluded item without a decider is not fully clear", () => {
		expect(region.toLowerCase()).toContain(
			"with no decider yet keeps this dimension short of fully clear",
		);
	});

	test("Constraint Clarity's own definition is untouched (the two dimensions stay distinct)", () => {
		expect(skillMd).toContain(
			"4. Constraint Clarity (0.0-1.0): Are the boundaries, limitations, and non-goals clear?",
		);
	});
});

describe("decider-gate: question-style table gains a Non-Goal Decider row, distinct from the Scope Clarity row", () => {
	const tableStart = skillMd.indexOf("**Question styles by dimension:**");
	const tableEnd = skillMd.indexOf("**Scope Over-Engineering Guard:**");
	const region = tableStart === -1 ? "" : skillMd.slice(tableStart, tableEnd === -1 ? undefined : tableEnd);

	test("table region exists (sanity)", () => {
		expect(tableStart).toBeGreaterThan(-1);
		expect(tableEnd).toBeGreaterThan(tableStart);
	});

	test('"Non-Goal Decider" row is present in the table', () => {
		expect(region).toContain("| Non-Goal Decider |");
	});

	test("Non-Goal Decider row's angle asks how to tell a finding belongs to an exclusion (membership), not what's in vs out (boundary)", () => {
		expect(region).toContain("belongs to that exclusion");
	});

	test("Non-Goal Decider row sits after the Scope Clarity row (both present, distinct rows)", () => {
		const scopeRowIdx = region.indexOf("| Scope Clarity |");
		const nonGoalRowIdx = region.indexOf("| Non-Goal Decider |");
		expect(scopeRowIdx).toBeGreaterThan(-1);
		expect(nonGoalRowIdx).toBeGreaterThan(scopeRowIdx);
	});
});

describe("decider-gate: Closure Guard gains a non-goal decider precondition, located inside Step 2-exit", () => {
	const step2exitStart = skillMd.indexOf("### Step 2-exit: Residual-Ambiguity Seam");
	const step2headStart = skillMd.indexOf("### Step 2-head: Dialectic Rhythm Guard");
	const section = step2exitStart === -1 ? "" : skillMd.slice(step2exitStart, step2headStart === -1 ? undefined : step2headStart);

	test("Step 2-exit section exists and precedes Step 2-head (sanity)", () => {
		expect(step2exitStart).toBeGreaterThan(-1);
		expect(step2headStart).toBeGreaterThan(step2exitStart);
	});

	test('"non-goal decider precondition" label is present inside the Step 2-exit / Closure Guard section', () => {
		expect(section).toContain("non-goal decider precondition");
	});

	test("the precondition names the same decider shape the Phase 4 template's Non-Goals section requires", () => {
		expect(section).toContain("decider");
	});

	test("the precondition is existence-only, not a precision judgment", () => {
		expect(section).toContain("existence-only");
	});

	test("the precondition is unconditional relative to the ambiguity reading (categorical, not folded into the ambiguity arithmetic)", () => {
		expect(section.toLowerCase()).toContain("regardless of what the ambiguity reading says");
	});

	test('the "non-goal decider precondition" phrase does not leak outside the Step 2-exit section', () => {
		const restOfDoc = step2headStart === -1 ? "" : skillMd.slice(step2headStart);
		expect(restOfDoc).not.toContain("non-goal decider precondition");
	});
});

describe("decider-gate: spec template's Non-Goals section carries the decider format the closure precondition checks for", () => {
	const start = template.indexOf("## Non-Goals");
	const end = template.indexOf("\n## ", start + 1);
	const section = end === -1 ? template.slice(start) : template.slice(start, end);

	test('"## Non-Goals" heading is present (sanity)', () => {
		expect(start).toBeGreaterThan(-1);
	});

	test("each Non-Goals bullet is formatted with a decider clause", () => {
		const bulletLines = section
			.split("\n")
			.filter((line) => line.trim().startsWith("- "))
			.filter((line) => line.trim() !== "- ...");
		expect(bulletLines.length).toBeGreaterThan(0);
		for (const line of bulletLines) {
			expect(line).toContain("| decider:");
		}
	});
});

describe("decider-gate: ambiguity formula and 6-dim weight map stay untouched by the decider-gate wiring", () => {
	test("the single formula still parses to exactly the canonical 6-dim weight map", () => {
		expect(normalizeWeightMap(parseInlineFormula(skillMd))).toEqual(EXPECTED_WEIGHTS);
	});

	test("exactly one ambiguity weighted-sum formula still appears in the doc", () => {
		const matches = skillMd.match(/ambiguity = 1 - \(/g) || [];
		expect(matches.length).toBe(1);
	});
});

describe("decider-gate: Phase 4 self-review gains a 5th check for non-goal deciders, kept distinct from the interview-coverage 'scope' check", () => {
	test('stale "4 checks: placeholder / consistency / scope / ambiguity" phrasing is gone everywhere', () => {
		expect(skillMd).not.toContain("4 checks: placeholder / consistency / scope / ambiguity");
	});

	test('inline self-review line names 5 checks including "non-goal-decider"', () => {
		expect(skillMd).toContain("5 checks: placeholder / consistency / scope / non-goal-decider / ambiguity");
	});

	test("Final_Checklist line carries the identical 5-check list (no count/name drift between the two locations)", () => {
		expect(skillMd).toContain("(5 checks: placeholder / consistency / scope / non-goal-decider / ambiguity)");
	});

	test("the inline self-review's non-goal-decider check requires every Non-Goals bullet to carry a decider", () => {
		const idx = skillMd.indexOf("**Inline self-review**");
		expect(idx).toBeGreaterThan(-1);
		const region = skillMd.slice(idx, idx + 400);
		expect(region).toContain("every Non-Goals bullet carries a decider");
	});
});

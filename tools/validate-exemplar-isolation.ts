#!/usr/bin/env bun
/**
 * Exemplar isolation validator.
 *
 * Parses B/C/D/F exemplar blocks in the tech-claim rubric skill files
 * (a1/a2/a3/a4) and verifies that each exemplar's prose contains the
 * required PASS-axis markers per the Marker Dictionary defined in the
 * Exemplar Isolation Contract.
 *
 * Exit code = number of exemplars that fail the applicable rules.
 *
 * Usage:
 *   bun tools/validate-exemplar-isolation.ts          # check actual rubric files
 *   bun tools/validate-exemplar-isolation.ts --stdin  # read markdown from stdin
 */

import fs from "fs/promises";
import path from "path";

// ---------------------------------------------------------------------------
// Marker Dictionary — verbatim from Exemplar Isolation Contract
// ---------------------------------------------------------------------------

/**
 * A1 PASS markers: ALL 5 sub-markers must individually match.
 * Sub-marker ID = "A1.constraint", "A1.selection", "A1.mechanism",
 *                  "A1.tradeoff", "A1.rationale"
 */
const A1_SUB_MARKERS: Array<{ id: string; pattern: RegExp }> = [
  { id: "A1.constraint",  pattern: new RegExp("제약 조건|constraint|요구사항") },
  { id: "A1.selection",   pattern: new RegExp("선택|채택|선정|결정") },
  { id: "A1.mechanism",   pattern: new RegExp("메커니즘|동작 원리|구현 방식|작동 방식") },
  { id: "A1.tradeoff",    pattern: new RegExp("트레이드오프|trade-?off|대안.*비교|장단점") },
  { id: "A1.rationale",   pattern: new RegExp("근거|이유|판단|배경") },
];

/**
 * A2 PASS marker: numeric figure with unit AND one of {temporal scope OR
 * distribution marker}.
 */
const A2_NUMERIC_PATTERN = new RegExp("\\d+\\s*(ms|초|s\\b|GB|MB|TB|건|회|명|%)");
const A2_TEMPORAL_PATTERN = new RegExp("(\\d+\\s*(개월|주\\b|일\\b|분기)|기간\\b|반기)");
const A2_DISTRIBUTION_PATTERN = new RegExp("p\\d+|평균|중앙값|분위");

/**
 * A3 PASS marker: named numeric outcome AND outcome verb.
 */
const A3_NUMERIC_PATTERN = new RegExp("\\d+\\s*%|\\d+\\s*(ms|초|배|건|회|명)");
const A3_VERB_PATTERN = new RegExp("달성|개선|단축|증가|감소|확보|향상");

/**
 * A4 PASS marker: explicit scope qualifier OR verb-with-bounded-scope.
 */
const A4_SCOPE_QUALIFIER_PATTERN = new RegExp("팀 내|개인 기여|함께|공동|협업");
/**
 * For verb-with-bounded-scope: 주도|총괄 followed within 20 chars of a scope-noun.
 * We test this by finding the verb position and checking a 20-char window after it.
 */
const A4_BOUNDED_VERB_PATTERN = new RegExp("주도|총괄");
const A4_SCOPE_NOUN_PATTERN = new RegExp("범위|기능|모듈|컴포넌트|일부");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExemplarResult {
  exemplar_id: string;
  violating_axis: "A1" | "A2" | "A3" | "A4" | null;
  pass_axes_with_markers: string[];
  pass_axes_missing_markers: string[];
  violating_axis_marker_present: boolean | "N/A-A2-exempt";
}

type AxisName = "A1" | "A2" | "A3" | "A4";

// ---------------------------------------------------------------------------
// Marker Dictionary — axis-level check functions
// ---------------------------------------------------------------------------

/**
 * Returns the list of A1 sub-marker IDs that are missing from the prose.
 */
function a1MissingSubMarkers(prose: string): string[] {
  return A1_SUB_MARKERS
    .filter(({ pattern }) => !pattern.test(prose))
    .map(({ id }) => id);
}

/**
 * Returns true if the prose contains the A1 PASS marker (all 5 sub-markers).
 */
function a1HasMarker(prose: string): boolean {
  return a1MissingSubMarkers(prose).length === 0;
}

/**
 * Returns the specific A1 sub-markers that are missing.
 * Used to fill pass_axes_missing_markers with detail.
 */
function a1MissingAxisIds(prose: string): string[] {
  return a1MissingSubMarkers(prose);
}

function a2HasMarker(prose: string): boolean {
  if (!A2_NUMERIC_PATTERN.test(prose)) return false;
  return A2_TEMPORAL_PATTERN.test(prose) || A2_DISTRIBUTION_PATTERN.test(prose);
}

function a3HasMarker(prose: string): boolean {
  return A3_NUMERIC_PATTERN.test(prose) && A3_VERB_PATTERN.test(prose);
}

function a4HasMarker(prose: string): boolean {
  if (A4_SCOPE_QUALIFIER_PATTERN.test(prose)) return true;
  // Check verb-with-bounded-scope: 주도|총괄 followed within 20 chars of scope-noun
  const verbMatch = A4_BOUNDED_VERB_PATTERN.exec(prose);
  if (verbMatch) {
    const afterVerb = prose.slice(verbMatch.index + verbMatch[0].length, verbMatch.index + verbMatch[0].length + 20);
    if (A4_SCOPE_NOUN_PATTERN.test(afterVerb)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Exemplar block parsing
// ---------------------------------------------------------------------------

type BlockLetter = "F" | "B" | "A" | "C" | "D";

function blockLetterToViolatingAxis(letter: BlockLetter): AxisName | null {
  switch (letter) {
    case "F": return null;  // PASS exemplar, no violating axis
    case "B": return "A1";
    case "A": return "A2";
    case "C": return "A3";
    case "D": return "A4";
  }
}

interface ParsedBlock {
  id: string;
  letter: BlockLetter;
  prose: string;
}

/**
 * Parse exemplar blocks from markdown content.
 * Matches headers like:
 *   ### PASS Exemplar F-1 —
 *   ### P1 Exemplar B-3 —
 *   ### A-1 —
 *   ### C-2 —
 *   ### D-1 —
 *
 * For each match, captures everything up to the next ### header.
 */
function parseExemplarBlocks(markdown: string): ParsedBlock[] {
  // WARNING: Form 1 (\d+[^\n(]*) rejects inner parens in exemplar titles.
  // If future rubric adds titles like "Title with (note) (F-2)", Form 1 must be
  // anchored with /\d+.*?(?=\(([FBACD])-)/.
  // The header regex captures three header forms:
  //   Form 1 (trailing-parens): ### PASS Exemplar 1 — Frontend perf (F-1)
  //     groups 1,2: letter and number from trailing parens
  //   Form 2 (inline):          ### PASS Exemplar F-1 — ...
  //     groups 3,4: letter and number inline after "Exemplar "
  //   Form 3 (bare):            ### F-1 — ... or ### A-1 —
  //     groups 5,6: letter and number at start of header text
  const HEADER_RE = /^###[ \t]+(?:(?:PASS|P1|FAIL)[ \t]+Exemplar[ \t]+(?:\d+[^\n(]*\(([FBACD])-(\w+)\)|([FBACD])-(\w+))|([FBACD])-(\w+))/m;

  const blocks: ParsedBlock[] = [];

  // Commentary start pattern: lines that begin rubric explanation sections
  // and must NOT be included in the prose (they mention absent markers by name).
  const COMMENTARY_START_RE = /^(Why |(- )?Reasoning:|\*\*violated|\*\*A4 Eval)/;

  // Split on ### lines to get sections
  // We walk the markdown line-by-line collecting blocks
  const lines = markdown.split("\n");
  let currentId: string | null = null;
  let currentLetter: BlockLetter | null = null;
  let currentLines: string[] = [];
  let stopGathering = false;

  const finalize = () => {
    if (currentId && currentLetter) {
      blocks.push({
        id: currentId,
        letter: currentLetter,
        prose: currentLines.join("\n"),
      });
    }
    currentId = null;
    currentLetter = null;
    currentLines = [];
  };

  for (const line of lines) {
    // Try to match a new exemplar header
    if (line.startsWith("###")) {
      const m = HEADER_RE.exec(line);
      if (m) {
        finalize();
        // Pick the matched group from whichever form matched (see HEADER_RE comment)
        const letter = (m[1] ?? m[3] ?? m[5]) as BlockLetter;
        const num = m[2] ?? m[4] ?? m[6];
        currentId = `${letter}-${num}`;
        currentLetter = letter;
        currentLines = [line];
        stopGathering = false;
        continue;
      } else {
        // A ### header that is NOT an exemplar header ends the current block
        finalize();
        continue;
      }
    }

    // If we're in a block (depth ## or # headers also end blocks)
    if (currentId && (line.startsWith("## ") || line.startsWith("# "))) {
      finalize();
      continue;
    }

    if (currentId) {
      // Stop collecting prose when we hit a commentary section start
      if (!stopGathering && COMMENTARY_START_RE.test(line)) {
        stopGathering = true;
      }
      if (!stopGathering) {
        currentLines.push(line);
      }
    }
  }

  finalize();
  return blocks;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Metadata lines (e.g., "**Candidate context**: ...") describe the exemplar
 * evaluation scenario but are NOT part of the resume bullet text.
 * Strip them before running marker checks to prevent candidate description
 * text from polluting marker detection (e.g., "협업하는 팀 소속" in context
 * should not count as an A4 scope qualifier).
 */
const METADATA_LINE_RE = /^\*\*Candidate context\*\*:|^- Candidate context:/;

function stripMetadataLines(prose: string): string {
  return prose
    .split("\n")
    .filter((line) => !METADATA_LINE_RE.test(line))
    .join("\n");
}

function validateBlock(block: ParsedBlock): ExemplarResult {
  const { id, letter } = block;
  const prose = stripMetadataLines(block.prose);
  const violating_axis = blockLetterToViolatingAxis(letter);

  const pass_axes_with_markers: string[] = [];
  const pass_axes_missing_markers: string[] = [];

  const allAxes: AxisName[] = ["A1", "A2", "A3", "A4"];
  const nonViolatingAxes = violating_axis
    ? allAxes.filter((a) => a !== violating_axis)
    : allAxes;

  for (const axis of nonViolatingAxes) {
    const has = axisHasMarker(axis, prose);
    if (has) {
      if (axis === "A1") {
        pass_axes_with_markers.push("A1");
      } else {
        pass_axes_with_markers.push(axis);
      }
    } else {
      // For A1, report missing sub-markers
      if (axis === "A1") {
        const missing = a1MissingAxisIds(prose);
        pass_axes_missing_markers.push(...missing);
      } else {
        pass_axes_missing_markers.push(axis);
      }
    }
  }

  // Determine violating_axis_marker_present
  let violating_axis_marker_present: boolean | "N/A-A2-exempt";
  if (violating_axis === null) {
    // Block F: no violating axis — field is false (not applicable but not exempt)
    violating_axis_marker_present = false;
  } else if (violating_axis === "A2") {
    violating_axis_marker_present = "N/A-A2-exempt";
  } else {
    violating_axis_marker_present = axisHasMarker(violating_axis, prose);
  }

  return {
    exemplar_id: id,
    violating_axis,
    pass_axes_with_markers,
    pass_axes_missing_markers,
    violating_axis_marker_present,
  };
}

function axisHasMarker(axis: AxisName, prose: string): boolean {
  switch (axis) {
    case "A1": return a1HasMarker(prose);
    case "A2": return a2HasMarker(prose);
    case "A3": return a3HasMarker(prose);
    case "A4": return a4HasMarker(prose);
  }
}

/**
 * Returns true if this exemplar result represents a FAILURE (contributes to exit code).
 */
function isFailure(result: ExemplarResult): boolean {
  // Any missing PASS-axis marker = fail
  if (result.pass_axes_missing_markers.length > 0) return true;
  // Violating axis marker present (not exempt, not null-axis) = fail
  if (
    result.violating_axis !== null &&
    result.violating_axis !== "A2" &&
    result.violating_axis_marker_present === true
  ) {
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Source files (when running against actual rubric)
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(import.meta.dir, "..");

const RUBRIC_FILES = [
  "skills/tech-claim-rubric/a1-technical-credibility.md",
  "skills/tech-claim-rubric/a2-causal-honesty.md",
  "skills/tech-claim-rubric/a3-outcome-significance.md",
  "skills/tech-claim-rubric/a4-ownership-scope.md",
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const useStdin = process.argv.includes("--stdin");

  let markdown: string;
  if (useStdin) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    markdown = Buffer.concat(chunks).toString("utf8");
  } else {
    const contents = await Promise.all(
      RUBRIC_FILES.map(async (f) => {
        try {
          return await fs.readFile(path.join(REPO_ROOT, f), "utf8");
        } catch {
          return "";
        }
      })
    );
    markdown = contents.join("\n");
  }

  const blocks = parseExemplarBlocks(markdown);
  const results = blocks.map(validateBlock);

  const failures = results.filter(isFailure);

  for (const result of results) {
    process.stdout.write(JSON.stringify(result) + "\n");
  }

  if (failures.length > 0) {
    process.stderr.write(
      `validate-exemplar-isolation: ${failures.length} exemplar(s) failing isolation checks:\n`
    );
    for (const f of failures) {
      process.stderr.write(
        `  [fail] ${f.exemplar_id}: missing_markers=${JSON.stringify(f.pass_axes_missing_markers)}, ` +
        `violating_axis_marker_present=${JSON.stringify(f.violating_axis_marker_present)}\n`
      );
    }
    process.exit(failures.length > 0 ? 1 : 0);
  }

  process.stdout.write(
    `validate-exemplar-isolation: all ${results.length} exemplar(s) pass isolation checks ✓\n`
  );
}

main().catch((err) => {
  process.stderr.write(`validate-exemplar-isolation: unexpected error: ${err}\n`);
  process.exit(1);
});

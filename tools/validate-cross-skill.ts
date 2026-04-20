#!/usr/bin/env bun
/**
 * Cross-skill drift validator.
 *
 * Checks that the key output symbols defined in the tech-claim rubric are
 * referenced consistently across:
 *   - rubric source files (skills/tech-claim-rubric/)
 *   - examiner agent (agents/tech-claim-examiner.md)
 *   - consumer skills (skills/review-resume/, skills/resume-forge/)
 *
 * Exits non-zero if any symbol appears asymmetrically.
 */

import fs from "fs/promises";
import path from "path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(import.meta.dir, "..");

// Verdict/flag surface symbols that must stay symmetric across rubric ↔ examiner ↔ consumers
const SYMBOLS = [
  "final_verdict",
  "structural_verdict",
  "integrity_suspected",
  "interview_hints",
  "triggered",
  "schema_version",
  "r_cross",
] as const;

type Symbol = (typeof SYMBOLS)[number];

/** Source groups to check. Each group is a set of file globs/paths. */
const SOURCE_GROUPS = {
  rubric: [
    "skills/tech-claim-rubric/SKILL.md",
    "skills/tech-claim-rubric/a1-technical-credibility.md",
    "skills/tech-claim-rubric/a2-causal-honesty.md",
    "skills/tech-claim-rubric/a3-outcome-significance.md",
    "skills/tech-claim-rubric/a4-ownership-scope.md",
    "skills/tech-claim-rubric/output-schema.md",
  ],
  examiner: ["agents/tech-claim-examiner.md"],
  consumers: [
    "skills/review-resume/SKILL.md",
    "skills/resume-forge/SKILL.md",
  ],
} as const;

type GroupName = keyof typeof SOURCE_GROUPS;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function readFileSafe(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function readGroup(groupName: GroupName): Promise<string> {
  const files = SOURCE_GROUPS[groupName];
  const contents = await Promise.all(
    files.map((f) => readFileSafe(path.join(REPO_ROOT, f)))
  );
  return contents.join("\n");
}

function containsSymbol(content: string, symbol: Symbol): boolean {
  return content.includes(symbol);
}

// ---------------------------------------------------------------------------
// Validation rules
// ---------------------------------------------------------------------------

/**
 * For each symbol, check the following asymmetry rules:
 *
 * 1. rubric must define the symbol (it's the source of truth)
 * 2. examiner must reference the symbol (it emits it)
 * 3. at least one consumer must reference the symbol
 *    (exception: `integrity_suspected` and `schema_version` are examiner-internal
 *    symbols; consumers are not required to reference `integrity_suspected` or
 *    `triggered` directly, but they must reference the public API symbols)
 *
 * Public symbols (must appear in all 3 groups):
 *   final_verdict, structural_verdict, interview_hints, r_cross
 *
 * Examiner-internal symbols (must appear in rubric + examiner, consumer optional):
 *   integrity_suspected, triggered, schema_version
 */
const PUBLIC_SYMBOLS: Symbol[] = [
  "final_verdict",
  "structural_verdict",
  "interview_hints",
  "r_cross",
];

const EXAMINER_INTERNAL_SYMBOLS: Symbol[] = [
  "integrity_suspected",
  "triggered",
  "schema_version",
];

interface AsymmetryError {
  symbol: Symbol;
  missingFrom: GroupName[];
  message: string;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const [rubricContent, examinerContent, consumersContent] = await Promise.all([
    readGroup("rubric"),
    readGroup("examiner"),
    readGroup("consumers"),
  ]);

  const errors: AsymmetryError[] = [];

  for (const symbol of PUBLIC_SYMBOLS) {
    const inRubric = containsSymbol(rubricContent, symbol);
    const inExaminer = containsSymbol(examinerContent, symbol);
    const inConsumers = containsSymbol(consumersContent, symbol);

    const missingFrom: GroupName[] = [];
    if (!inRubric) missingFrom.push("rubric");
    if (!inExaminer) missingFrom.push("examiner");
    if (!inConsumers) missingFrom.push("consumers");

    if (missingFrom.length > 0) {
      errors.push({
        symbol,
        missingFrom,
        message: `Symbol '${symbol}' missing from: ${missingFrom.join(", ")}`,
      });
    }
  }

  for (const symbol of EXAMINER_INTERNAL_SYMBOLS) {
    const inRubric = containsSymbol(rubricContent, symbol);
    const inExaminer = containsSymbol(examinerContent, symbol);

    const missingFrom: GroupName[] = [];
    if (!inRubric) missingFrom.push("rubric");
    if (!inExaminer) missingFrom.push("examiner");

    if (missingFrom.length > 0) {
      errors.push({
        symbol,
        missingFrom,
        message: `Symbol '${symbol}' (examiner-internal) missing from: ${missingFrom.join(", ")}`,
      });
    }
  }

  // Semantic check: examiner.md A1 PASS criterion must state the canonical 5/5 strict bar.
  // Accepts "**PASS**: Signal 5 of 5" or "ALL 5 of 5" (flexible whitespace).
  // Missing = v3 regression risk where threshold drift may have occurred.
  const A1_STRICT_BAR_RE = /(\*\*PASS\*\*:\s*Signal\s+5\s+of\s+5|ALL\s+5\s+of\s+5)/;
  if (!A1_STRICT_BAR_RE.test(examinerContent)) {
    errors.push({
      symbol: "final_verdict" as Symbol, // closest public symbol; used as placeholder
      missingFrom: ["examiner"],
      message:
        "examiner.md A1 PASS criterion이 canonical 5/5 strict bar와 drift (v3 leak 가능성). " +
        'Expected "**PASS**: Signal 5 of 5" or "ALL 5 of 5" in agents/tech-claim-examiner.md',
    });
  }

  if (errors.length > 0) {
    console.error(
      `validate-cross-skill: ${errors.length} asymmetry error(s) detected:\n`
    );
    for (const err of errors) {
      console.error(`  [drift] ${err.message}`);
    }
    process.exit(1);
  }

  console.log("validate-cross-skill: all symbols symmetric across rubric / examiner / consumers ✓");
}

main().catch((err) => {
  console.error("validate-cross-skill: unexpected error:", err);
  process.exit(1);
});

/**
 * Forbidden-token linter for tech-claim-rubric and related skill/agent docs.
 *
 * Prevents slipback of legacy 11-axis system tokens (E1-E6, R1-R5, Phase A/B/C,
 * Constraint Cascade, etc.) into documentation after v3→v4 migration.
 *
 * Scan scope:
 *   - skills/tech-claim-rubric/**\/*.md
 *   - skills/review-resume/**\/*.md
 *   - skills/resume-forge/**\/*.md
 *   - agents/tech-claim-examiner.md
 *
 * Allowlist mechanisms:
 *   Option A (line-level):  append  <!-- allow-forbidden -->  to the line
 *   Option B (file-level):  add  <!-- forbidden-tokens-allowlist -->  anywhere in first 5 lines
 *
 * CLI usage: bun run tools/validators/forbidden-tokens.ts
 */

import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";
import { getRootDir } from "../lib/config.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Violation = {
  file: string;
  line: number;
  column: number;
  token: string;
  ruleName: string;
};

type Rule = {
  name: string;
  pattern: RegExp;
};

// ---------------------------------------------------------------------------
// Rule definitions
// ---------------------------------------------------------------------------

/**
 * Each rule has a name and a pattern.
 * Patterns must NOT use the global flag (g) — we test per-line with exec.
 * Word-boundary rules use \b to minimise false positives.
 */
const RULES: Rule[] = [
  // v3 version references (v3, v3.0, v3.1, etc.) — \b ensures no v30, v300
  {
    name: "v3",
    pattern: /\bv3(\.\d+)?\b/,
  },

  // Legacy exemplar headings: Block E-1, Block E-2, Block E-3, etc.
  {
    name: "Block-E",
    pattern: /\bBlock E-?[0-9]+\b/,
  },

  // Retired per-bullet terminology
  {
    name: "per-bullet",
    pattern: /\bper-bullet\b/,
  },

  // Constraint Cascade phrase
  {
    name: "Constraint-Cascade",
    pattern: /\bConstraint Cascade\b/,
  },

  // All-caps CASCADING
  {
    name: "CASCADING",
    pattern: /\bCASCADING\b/,
  },

  // Narrative Necessity phrase
  {
    name: "Narrative-Necessity",
    pattern: /\bNarrative Necessity\b/,
  },

  // Retired Phase A/B/C labels
  {
    name: "Phase-ABC",
    pattern: /\bPhase [ABC]\b/,
  },

  // Retired E1-E6 axis labels.
  // Must not match:
  //   - "E-commerce"  (E followed by dash)
  //   - "A-E" range   (letter-dash-E)
  //   - "E1–E6" range written as token range in migration table (caught per-token)
  // The negative lookbehind (-) prevents matching when E is preceded by a dash (A-E).
  // The negative lookahead prevents matching E followed by more digits (E10, E17).
  {
    name: "E-axis",
    pattern: /(?<![-A-Za-z])E[1-6](?![0-9])\b/,
  },

  // Retired R1-R5 readability labels.
  // Must not match R-Phys, R-Cross (R followed by dash).
  // Negative lookahead for dash: R-Phys starts with R-
  {
    name: "R-axis",
    pattern: /(?<![-A-Za-z])R[1-5](?![0-9])\b/,
  },

  // Retired D1-D6 dimension labels.
  // Must not match mid-word (e.g. MD5, ID123).
  {
    name: "D-axis",
    pattern: /(?<![-A-Za-z])D[1-6](?![0-9])\b/,
  },

  // All-caps LISTED (listed lowercase is fine)
  {
    name: "LISTED-caps",
    pattern: /\bLISTED\b/,
  },

  // All-caps FLAT (flat lowercase is fine)
  {
    name: "FLAT-caps",
    pattern: /\bFLAT\b/,
  },
];

// Line-level allowlist marker
const LINE_ALLOWLIST_MARKER = "allow-forbidden";

// File-level allowlist marker (checked in first 5 lines)
const FILE_ALLOWLIST_PATTERN = /<!--\s*forbidden-tokens-allowlist\s*-->/;

// ---------------------------------------------------------------------------
// Core scanner
// ---------------------------------------------------------------------------

/**
 * Scan in-memory content for forbidden tokens.
 * Returns Violation objects with file, line (1-based), column (1-based), token, ruleName.
 */
export function scanContent(content: string, filePath: string): Violation[] {
  const lines = content.split("\n");

  // Check file-level allowlist in first 5 lines
  const preamble = lines.slice(0, 5).join("\n");
  if (FILE_ALLOWLIST_PATTERN.test(preamble)) {
    return [];
  }

  const violations: Violation[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Skip lines with the line-level allowlist marker
    if (line.includes(LINE_ALLOWLIST_MARKER)) {
      continue;
    }

    for (const rule of RULES) {
      // Use exec with a fresh copy of the pattern to scan all matches on the line
      const src = rule.pattern.source;
      const flags = rule.pattern.flags.replace("g", "");
      const globalPattern = new RegExp(src, flags + "g");

      let match: RegExpExecArray | null;
      while ((match = globalPattern.exec(line)) !== null) {
        violations.push({
          file: filePath,
          line: lineNum,
          column: match.index + 1,
          token: match[0],
          ruleName: rule.name,
        });
      }
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// File-level scanner
// ---------------------------------------------------------------------------

/**
 * Scan a list of file paths and accumulate violations.
 * Silently skips non-existent files.
 */
export function scanFiles(filePaths: string[]): Violation[] {
  const violations: Violation[] = [];

  for (const filePath of filePaths) {
    if (!existsSync(filePath)) continue;

    let content: string;
    try {
      content = readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    violations.push(...scanContent(content, filePath));
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Glob helper
// ---------------------------------------------------------------------------

/**
 * Recursively collect *.md file paths under a directory.
 */
function collectMdFiles(dir: string): string[] {
  const results: string[] = [];

  if (!existsSync(dir)) return results;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectMdFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      results.push(full);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Default scan scope
// ---------------------------------------------------------------------------

function getScanPaths(rootDir: string): string[] {
  const paths: string[] = [];

  // Directory scopes (recursive *.md)
  const dirScopes = [
    join(rootDir, "skills", "tech-claim-rubric"),
    join(rootDir, "skills", "review-resume"),
    join(rootDir, "skills", "resume-forge"),
  ];

  for (const dir of dirScopes) {
    paths.push(...collectMdFiles(dir));
  }

  // Single file scope
  const singleFile = join(rootDir, "agents", "tech-claim-examiner.md");
  if (existsSync(singleFile)) {
    paths.push(singleFile);
  }

  return paths;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function main(): void {
  const rootDir = getRootDir();

  if (!rootDir) {
    process.stderr.write("[FORBIDDEN-TOKENS] config.yaml를 찾을 수 없습니다\n");
    process.exit(1);
  }

  const filePaths = getScanPaths(rootDir);
  const violations = scanFiles(filePaths);

  if (violations.length === 0) {
    process.stderr.write("\x1b[0;32m[FORBIDDEN-TOKENS]\x1b[0m 금지 토큰 없음 — 검증 통과\n");
    process.exit(0);
  }

  for (const v of violations) {
    process.stderr.write(
      `\x1b[0;31m[FORBIDDEN-TOKENS]\x1b[0m ${v.file}:${v.line}:${v.column}: "${v.token}" (rule: ${v.ruleName})\n`,
    );
  }

  process.stderr.write(
    `\x1b[0;31m[FORBIDDEN-TOKENS]\x1b[0m 금지 토큰 ${violations.length}건 발견\n`,
  );
  process.exit(1);
}

if (import.meta.main) {
  main();
}

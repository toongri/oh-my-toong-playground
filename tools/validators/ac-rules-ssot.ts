/**
 * AC Quality Detail Rules single-source validator.
 *
 * The "## AC Quality Detail Rules" block (Verb Red-Flag list, Batch Cardinality
 * Matrix, Distinct Outcomes) is enforced at two gates: metis at the requirements
 * stage and momus at the plan stage. Because metis ships as an agent
 * (agents/metis.md → .claude/agents/) and momus ships as a skill
 * (skills/momus/SKILL.md → .claude/skills/), the deploy model has no runtime
 * transclusion — each gate must carry the block in its own file. The two copies
 * are therefore intentionally byte-identical, and an edit to one without the
 * other silently diverges the two gates so the same acceptance criterion is
 * judged by different rules at S1 vs S4.
 *
 * This validator is the single-source enforcement: it extracts the block from
 * both files and fails if they are not byte-identical. A one-sided edit can no
 * longer drift silently — it breaks `make validate` until both copies match.
 *
 * CLI usage: bun run tools/validators/ac-rules-ssot.ts
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { getRootDir } from "../lib/config.ts";

const HEADING = "## AC Quality Detail Rules";

const SOURCES = [
  "agents/metis.md",
  "skills/momus/SKILL.md",
] as const;

/**
 * Extract the body of the AC Quality Detail Rules block: every line after the
 * `## AC Quality Detail Rules` heading up to (but not including) the next `## `
 * heading. Returns null when the heading is absent.
 */
export function extractAcRulesBlock(content: string): string | null {
  const lines = content.split("\n");
  const start = lines.findIndex((l) => l.trim() === HEADING);
  if (start === -1) return null;
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) break;
    body.push(lines[i]);
  }
  return body.join("\n");
}

/**
 * Returns a human-readable drift description, or null when the two source files
 * carry a byte-identical block.
 */
export function findAcRulesDrift(rootDir: string): string | null {
  const blocks = SOURCES.map((rel) => {
    const path = join(rootDir, rel);
    // A missing source file is treated as a missing block, reported below with a
    // clean actionable message rather than an uncaught readFileSync stack trace.
    const content = existsSync(path) ? readFileSync(path, "utf8") : null;
    return { rel, block: content === null ? null : extractAcRulesBlock(content) };
  });

  const missing = blocks.filter((b) => b.block === null);
  if (missing.length > 0) {
    return `'${HEADING}' 블록 또는 소스 파일 누락: ${missing.map((b) => b.rel).join(", ")}`;
  }

  // An emptied (or whitespace-only) block is identity-equal to another such block, so a
  // simultaneous deletion in both files — even one that leaves blank lines under the heading —
  // would slip past the byte-identity check below. Trim so whitespace-only bodies also fail.
  const empty = blocks.filter((b) => b.block !== null && b.block.trim() === "");
  if (empty.length > 0) {
    return `'${HEADING}' 블록이 비어 있음: ${empty.map((b) => b.rel).join(", ")}`;
  }

  const [a, b] = blocks;
  if (a.block !== b.block) {
    return `'${HEADING}' 블록이 ${a.rel} 와(과) ${b.rel} 사이에서 불일치 — 두 게이트가 같은 AC를 다른 규칙으로 심사함`;
  }
  return null;
}

function main(): void {
  const rootDir = getRootDir();
  if (!rootDir) {
    process.stderr.write("[AC-SSOT] config.yaml를 찾을 수 없습니다\n");
    process.exit(1);
  }

  const drift = findAcRulesDrift(rootDir);
  if (drift) {
    process.stderr.write(
      `\x1b[0;31m[ERROR]\x1b[0m AC Quality Detail Rules SSOT 검증 실패: ${drift} ` +
        `(두 사본을 byte-identical로 유지하세요)\n`,
    );
    process.exit(1);
  }

  process.stderr.write(`\x1b[0;32m[AC-SSOT]\x1b[0m AC Quality Detail Rules SSOT 검증 통과\n`);
  process.exit(0);
}

if (import.meta.main) {
  main();
}

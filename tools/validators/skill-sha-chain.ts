/**
 * SHA chain validator for collect-jd SKILL.md.
 *
 * Verifies that the sha256 recorded in the "최종 SKILL.md 재확인" section of
 * pressure-scenarios.md matches the actual sha256 of the current SKILL.md.
 *
 * CLI usage: bun run tools/validators/skill-sha-chain.ts
 * Default paths (relative to project root / CWD):
 *   skillMdPath:          skills/collect-jd/SKILL.md
 *   pressureScenariosPath: skills/collect-jd/tests/pressure-scenarios.md
 */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillShaChainResult {
  ok: boolean;
  recordedSha: string | null;
  actualSha: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

const SHA_LINE_REGEX = /\*{0,2}skill_md_sha256 \(current HEAD\)\*{0,2}:\s*`([0-9a-f]{64})`/;

export function validateSkillShaChain(
  skillMdPath: string,
  pressureScenariosPath: string,
): SkillShaChainResult {
  // 1. Compute actual sha256 of SKILL.md
  const skillContent = readFileSync(skillMdPath);
  const actualSha = createHash("sha256").update(skillContent).digest("hex");

  // 2. Extract recorded sha from pressure-scenarios.md
  const pressureContent = readFileSync(pressureScenariosPath, "utf-8");
  const match = SHA_LINE_REGEX.exec(pressureContent);

  if (!match) {
    return {
      ok: false,
      recordedSha: null,
      actualSha,
      message: "최종 재확인 섹션 부재 또는 sha 라인 없음",
    };
  }

  const recordedSha = match[1];

  // 3. Compare
  if (recordedSha === actualSha) {
    return { ok: true, recordedSha, actualSha, message: "OK" };
  }

  return {
    ok: false,
    recordedSha,
    actualSha,
    message: `SKILL.md sha mismatch: recorded=${recordedSha} actual=${actualSha}`,
  };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const skillMdPath = "skills/collect-jd/SKILL.md";
  const pressureScenariosPath = "skills/collect-jd/tests/pressure-scenarios.md";

  const result = validateSkillShaChain(skillMdPath, pressureScenariosPath);

  if (result.ok) {
    process.stderr.write(`\x1b[0;32m[SHA-CHAIN]\x1b[0m ${result.message}\n`);
    process.exit(0);
  } else {
    process.stderr.write(`\x1b[0;31m[SHA-CHAIN]\x1b[0m ${result.message}\n`);
    process.exit(1);
  }
}

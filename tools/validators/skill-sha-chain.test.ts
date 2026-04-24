import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createHash } from "node:crypto";

import { validateSkillShaChain } from "./skill-sha-chain.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(tmpdir(), `sha-chain-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function makePressureFile(dir: string, sha: string | null): string {
  const path = join(dir, "pressure-scenarios.md");
  let content = "# collect-jd Pressure Scenarios\n\nsome content here\n";
  if (sha !== null) {
    content += `\n---\n\n## 최종 SKILL.md 재확인 (Final Reconfirmation)\n\n**관찰 시점**: 2026-04-23T00:00:00+09:00  \n**HEAD commit**: \`1aedbf0\`  \n**skill_md_sha256 (current HEAD)**: \`${sha}\`  \n\n본 파일의 개별 evidence stub에 기록된 값들은 각 scenario 작성 시점의 snapshot이다.\n`;
  }
  writeFileSync(path, content, "utf-8");
  return path;
}

// ---------------------------------------------------------------------------
// Suite: validateSkillShaChain
// ---------------------------------------------------------------------------

describe("validateSkillShaChain", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it(`'returns ok=true when recorded sha matches actual'`, () => {
    const skillContent = "# SKILL.md\n\nsome rule content\n";
    const skillPath = join(dir, "SKILL.md");
    writeFileSync(skillPath, skillContent, "utf-8");
    const actualSha = sha256(skillContent);

    const pressurePath = makePressureFile(dir, actualSha);

    const result = validateSkillShaChain(skillPath, pressurePath);

    expect(result.ok).toBe(true);
    expect(result.recordedSha).toBe(actualSha);
    expect(result.actualSha).toBe(actualSha);
    expect(result.message).toBe("OK");
  });

  it(`'returns ok=false when sha mismatches'`, () => {
    const skillContent = "# SKILL.md\n\nsome rule content\n";
    const skillPath = join(dir, "SKILL.md");
    writeFileSync(skillPath, skillContent, "utf-8");
    const actualSha = sha256(skillContent);
    const wrongSha = "a".repeat(64);

    const pressurePath = makePressureFile(dir, wrongSha);

    const result = validateSkillShaChain(skillPath, pressurePath);

    expect(result.ok).toBe(false);
    expect(result.recordedSha).toBe(wrongSha);
    expect(result.actualSha).toBe(actualSha);
    expect(result.message).toContain("SKILL.md sha mismatch");
    expect(result.message).toContain(wrongSha);
    expect(result.message).toContain(actualSha);
  });

  it(`'returns ok=false with null recordedSha when section absent'`, () => {
    const skillContent = "# SKILL.md\n\nsome rule content\n";
    const skillPath = join(dir, "SKILL.md");
    writeFileSync(skillPath, skillContent, "utf-8");

    // No sha section in pressure file
    const pressurePath = makePressureFile(dir, null);

    const result = validateSkillShaChain(skillPath, pressurePath);

    expect(result.ok).toBe(false);
    expect(result.recordedSha).toBeNull();
    expect(result.message).toContain("최종 재확인 섹션 부재 또는 sha 라인 없음");
  });

  it(`'normalizes sha format (lowercase hex 64)'`, () => {
    // Node crypto hex output is lowercase — uppercase in pressure file should NOT match
    // (we only accept lowercase as per spec: lowercase only accepted)
    const skillContent = "# SKILL.md\n\nsome rule content\n";
    const skillPath = join(dir, "SKILL.md");
    writeFileSync(skillPath, skillContent, "utf-8");
    const actualSha = sha256(skillContent);
    const upperSha = actualSha.toUpperCase();

    const pressurePath = makePressureFile(dir, upperSha);

    // The regex only matches [0-9a-f]{64} — uppercase will fail to parse → recordedSha null
    const result = validateSkillShaChain(skillPath, pressurePath);

    expect(result.ok).toBe(false);
    expect(result.recordedSha).toBeNull();
    expect(result.message).toContain("최종 재확인 섹션 부재 또는 sha 라인 없음");
  });
});

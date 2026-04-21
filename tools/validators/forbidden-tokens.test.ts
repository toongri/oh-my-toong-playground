/**
 * Tests for the forbidden-tokens validator.
 *
 * Validates detection of legacy 11-axis terminology that must not drift back
 * into skill/agent documentation (slipback prevention).
 *
 * RED phase: these tests fail until forbidden-tokens.ts is implemented.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  type Violation,
  scanContent,
  scanFiles,
} from "./forbidden-tokens.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(tmpdir(), `forbidden-tokens-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeMd(dir: string, name: string, content: string): string {
  const path = join(dir, name);
  writeFileSync(path, content, "utf-8");
  return path;
}

// ---------------------------------------------------------------------------
// Suite: scanContent — token detection
// ---------------------------------------------------------------------------

describe("scanContent: forbidden token 감지", () => {
  // --- v3 ---
  it(`"v3" 토큰을 일반 산문에서 감지한다`, () => {
    const violations = scanContent("The v3 system has been retired.", "test.md");
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].token).toMatch(/v3/);
  });

  it(`"v3.0" 형태도 감지한다`, () => {
    const violations = scanContent("Legacy v3.0 approach is retired.", "test.md");
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].token).toMatch(/v3/);
  });

  // --- Block E-N ---
  it(`"Block E-1" 헤딩을 감지한다`, () => {
    const violations = scanContent("## Block E-1 worked example", "test.md");
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].token).toMatch(/Block E/);
  });

  it(`"Block E-2" 형태도 감지한다`, () => {
    const violations = scanContent("Block E-2 shows physical impossibility.", "test.md");
    expect(violations.length).toBeGreaterThan(0);
  });

  // --- per-bullet ---
  it(`"per-bullet" 토큰을 산문에서 감지한다`, () => {
    const violations = scanContent("Continue per-bullet feedback loop.", "test.md");
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].token).toMatch(/per-bullet/);
  });

  // --- Constraint Cascade ---
  it(`"Constraint Cascade" 구문을 감지한다`, () => {
    const violations = scanContent("The Constraint Cascade Score was 0.8.", "test.md");
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].token).toMatch(/Constraint Cascade/);
  });

  // --- CASCADING ---
  it(`대문자 "CASCADING" 토큰을 감지한다`, () => {
    const violations = scanContent("Result: CASCADING", "test.md");
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].token).toMatch(/CASCADING/);
  });

  // --- Narrative Necessity ---
  it(`"Narrative Necessity" 구문을 감지한다`, () => {
    const violations = scanContent("Narrative Necessity score was high.", "test.md");
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].token).toMatch(/Narrative Necessity/);
  });

  // --- Phase A/B/C ---
  it(`"Phase A" 토큰을 감지한다`, () => {
    const violations = scanContent("Phase A routing is retired.", "test.md");
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].token).toMatch(/Phase [ABC]/);
  });

  it(`"Phase B" 토큰을 감지한다`, () => {
    const violations = scanContent("Follow Phase B then Phase C.", "test.md");
    expect(violations.length).toBeGreaterThan(0);
  });

  // --- E1-E6 axis labels ---
  it(`레거시 axis 레이블 "E1" 을 감지한다`, () => {
    const violations = scanContent("E1 depth axis score must be 0.7.", "test.md");
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].token).toMatch(/E[1-6]/);
  });

  it(`레거시 axis 레이블 "E6" 을 감지한다`, () => {
    const violations = scanContent("Total E6 failures: 2.", "test.md");
    expect(violations.length).toBeGreaterThan(0);
  });

  // --- R1-R5 readability labels ---
  it(`레거시 readability 레이블 "R1" 을 감지한다`, () => {
    const violations = scanContent("R1 is a readability rule.", "test.md");
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].token).toMatch(/R[1-5]/);
  });

  // --- D1-D6 dimension labels ---
  it(`레거시 dimension 레이블 "D1" 을 감지한다`, () => {
    const violations = scanContent("D1 criterion failed.", "test.md");
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].token).toMatch(/D[1-6]/);
  });

  // --- LISTED / FLAT ---
  it(`대문자 "LISTED" 토큰을 감지한다`, () => {
    const violations = scanContent("taxonomy: LISTED", "test.md");
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].token).toMatch(/LISTED/);
  });

  it(`대문자 "FLAT" 토큰을 감지한다`, () => {
    const violations = scanContent("taxonomy: FLAT", "test.md");
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].token).toMatch(/FLAT/);
  });
});

// ---------------------------------------------------------------------------
// Suite: scanContent — false positive 방지
// ---------------------------------------------------------------------------

describe("scanContent: false positive 방지", () => {
  it(`소문자 "listed" 는 감지하지 않는다`, () => {
    const violations = scanContent("The items are listed below.", "test.md");
    const listedViolations = violations.filter((v) => v.ruleName === "LISTED-caps");
    expect(listedViolations.length).toBe(0);
  });

  it(`소문자 "flat" 은 감지하지 않는다`, () => {
    const violations = scanContent("Flat architecture is fine.", "test.md");
    const flatViolations = violations.filter((v) => v.ruleName === "FLAT-caps");
    expect(flatViolations.length).toBe(0);
  });

  it(`"E-commerce" 같은 단어는 E1-E6 로 감지하지 않는다`, () => {
    const violations = scanContent("E-commerce platform built with Next.js.", "test.md");
    const axisViolations = violations.filter((v) => v.ruleName === "E-axis");
    expect(axisViolations.length).toBe(0);
  });

  it(`"3 of 5" 같은 숫자 맥락에서 D/E 단독은 감지하지 않는다`, () => {
    // No D1-D6 or E1-E6 pattern here — just digit after non-label char
    const violations = scanContent("Achieved 3 of 5 goals.", "test.md");
    const dimViolations = violations.filter(
      (v) => v.ruleName === "D-axis" || v.ruleName === "E-axis"
    );
    expect(dimViolations.length).toBe(0);
  });

  it(`"A-E" 범위 표기(대시 포함)는 E-axis 로 감지하지 않는다`, () => {
    const violations = scanContent("Axes A-E cover all dimensions.", "test.md");
    const axisViolations = violations.filter((v) => v.ruleName === "E-axis");
    expect(axisViolations.length).toBe(0);
  });

  it(`"R-Phys", "R-Cross" 패턴은 R1-R5 로 감지하지 않는다`, () => {
    const violations = scanContent("R-Phys triggered: true. R-Cross: false.", "test.md");
    const rViolations = violations.filter((v) => v.ruleName === "R-axis");
    expect(rViolations.length).toBe(0);
  });

  it(`"v3.1" 처럼 마이너 버전 붙은 버전 참조도 v3 패턴으로 감지한다`, () => {
    // v3.1 contains v3 and should be caught — it's still a legacy version ref
    const violations = scanContent("As of v3.1 verdict arity unification.", "test.md");
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].ruleName).toBe("v3");
  });

  it(`"v4", "v4.0" 는 현재 버전이므로 감지하지 않는다`, () => {
    const violations = scanContent("schema_version: v4.0 is the current format.", "test.md");
    const v3Violations = violations.filter((v) => v.ruleName === "v3");
    expect(v3Violations.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Suite: scanContent — allowlist marker
// ---------------------------------------------------------------------------

describe("scanContent: allowlist marker 처리", () => {
  it(`같은 라인에 <!-- allow-forbidden --> 주석이 있으면 위반으로 처리하지 않는다`, () => {
    const content = "| E1–E6 (depth axes) | A1 + A2 | <!-- allow-forbidden -->";
    const violations = scanContent(content, "test.md");
    expect(violations.length).toBe(0);
  });

  it(`allow-forbidden marker 없는 다른 라인의 위반은 여전히 감지한다`, () => {
    const content = [
      "| E1–E6 (depth axes) | A1 + A2 | <!-- allow-forbidden -->",
      "The E1 score must be recalculated.",
    ].join("\n");
    const violations = scanContent(content, "test.md");
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].line).toBe(2);
  });

  it(`파일 상단의 <!-- forbidden-tokens-allowlist --> 는 해당 파일 전체를 허용한다`, () => {
    const content = [
      "<!-- forbidden-tokens-allowlist -->",
      "",
      "E1 depth axis score: 0.7",
      "Phase A routing: retired",
      "Constraint Cascade: score 0.8",
    ].join("\n");
    const violations = scanContent(content, "test.md");
    expect(violations.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Suite: scanContent — violation format
// ---------------------------------------------------------------------------

describe("scanContent: violation 형식", () => {
  it(`file:line:column 정보를 포함한 위반을 보고한다`, () => {
    const violations = scanContent("per-bullet feedback loop", "skills/rubric/SKILL.md");
    expect(violations.length).toBeGreaterThan(0);

    const v = violations[0];
    expect(v.file).toBe("skills/rubric/SKILL.md");
    expect(v.line).toBe(1);
    expect(v.column).toBeGreaterThanOrEqual(1);
    expect(v.token).toBeDefined();
    expect(v.ruleName).toBeDefined();
  });

  it(`멀티라인 콘텐츠에서 올바른 라인 번호를 보고한다`, () => {
    const content = [
      "This is line 1.",
      "This is line 2.",
      "Phase A routing is deprecated.",
      "This is line 4.",
    ].join("\n");
    const violations = scanContent(content, "test.md");
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].line).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Suite: scanFiles — file-level scanning
// ---------------------------------------------------------------------------

describe("scanFiles: 파일 스캔", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it(`스캔 대상 파일에서 위반을 수집한다`, () => {
    const filePath = writeMd(dir, "test.md", "The per-bullet approach is outdated.");
    const violations = scanFiles([filePath]);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].file).toBe(filePath);
  });

  it(`위반 없는 파일은 빈 배열을 반환한다`, () => {
    const filePath = writeMd(dir, "clean.md", "Everything is using the new 5-axis A1-A5 system.");
    const violations = scanFiles([filePath]);
    expect(violations.length).toBe(0);
  });

  it(`여러 파일에서 위반을 누적 수집한다`, () => {
    const file1 = writeMd(dir, "a.md", "per-bullet feedback loop.");
    const file2 = writeMd(dir, "b.md", "Constraint Cascade Score high.");
    const violations = scanFiles([file1, file2]);
    expect(violations.length).toBeGreaterThanOrEqual(2);
  });

  it(`존재하지 않는 파일 경로는 조용히 건너뛴다`, () => {
    const missingPath = join(dir, "nonexistent.md");
    const violations = scanFiles([missingPath]);
    expect(violations.length).toBe(0);
  });
});

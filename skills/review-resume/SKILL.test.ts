import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

// ---------------------------------------------------------------------------
// Prose-contract test for skills/review-resume/SKILL.md's Pre-Submission
// Self-Check block ("제출 전 셀프 점검", Phase 10 → HTML Report Generation).
//
// RED step (pre-edit SKILL.md, before the self-check block was inserted):
//   - every assertion below FAILS because the pinned phrases are absent.
// GREEN step (current SKILL.md, self-check block present):
//   - every assertion PASSES because the pinned phrases are present verbatim.
//
// This is a static prose-presence guard only — it does not assert anything
// about runtime/behavioral output, and it does not touch the tech-claim-
// examiner rubric. It reads the colocated repo source, never the deployed
// ~/.claude copy.
// ---------------------------------------------------------------------------

const skillMd = readFileSync(join(import.meta.dir, "SKILL.md"), "utf8");

describe("review-resume pre-submission self-check prose contract", () => {
  test("pins the self-check heading marker", () => {
    expect(skillMd).toContain("제출 전 셀프 점검");
  });

  test("pins the six self-check item stems", () => {
    expect(skillMd).toContain("모든 프로젝트에 문제 해결 성과가 있는가");
    expect(skillMd).toContain("숫자가 0개인 프로젝트가 있는가");
    expect(skillMd).toContain("기간·역할·기술 스택이 모든 프로젝트에 붙어 있는가");
    expect(skillMd).toContain("자기 판정 형용사가 남아 있는가");
    expect(skillMd).toContain("볼드·소제목·숫자만으로 구조가 보이는가");
    expect(skillMd).toContain("모든 문장을 소리 내어 3분 설명할 수 있는가");
  });

  test("pins the adjective-scan marker, structural-readiness marker, and no-entries fallback line", () => {
    expect(skillMd).toContain("재검토 후보 표현");
    expect(skillMd).toContain("구조 가독성");
    expect(skillMd).toContain("평가 대상 프로젝트 항목 없음");
  });

  test("pins the authority-separation phrasing between the self-check and the examiner APPROVE gate", () => {
    expect(skillMd).toContain("does NOT invalidate the examiner APPROVE");
  });
});

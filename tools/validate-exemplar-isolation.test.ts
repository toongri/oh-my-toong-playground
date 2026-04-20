import { describe, it, expect } from "bun:test";
import { spawnSync } from "child_process";
import path from "path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(import.meta.dir, "..");
const VALIDATOR_SCRIPT = path.join(import.meta.dir, "validate-exemplar-isolation.ts");

interface ExemplarResult {
  exemplar_id: string;
  violating_axis: string | null;
  pass_axes_with_markers: string[];
  pass_axes_missing_markers: string[];
  violating_axis_marker_present: boolean | "N/A-A2-exempt";
}

/**
 * Run the validate-exemplar-isolation.ts script optionally with an inline
 * markdown fixture piped via STDIN (using --stdin flag).  Returns exit code
 * and parsed JSON results.
 */
function runValidator(
  fixtureMarkdown?: string
): { exitCode: number; output: string; results: ExemplarResult[] } {
  const args = [VALIDATOR_SCRIPT];
  if (fixtureMarkdown !== undefined) {
    args.push("--stdin");
  }

  const result = spawnSync("bun", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    input: fixtureMarkdown,
  });

  const raw = (result.stdout ?? "") + (result.stderr ?? "");

  // Extract JSON lines from output
  const results: ExemplarResult[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        results.push(JSON.parse(trimmed) as ExemplarResult);
      } catch {
        // not a JSON result line
      }
    }
  }

  return {
    exitCode: result.status ?? 1,
    output: raw,
    results,
  };
}

// ---------------------------------------------------------------------------
// Test fixtures — synthetic inline markdown blocks
// ---------------------------------------------------------------------------

/**
 * A Block B exemplar (violating_axis = A1, specifically Mechanism missing).
 * This is the shape of B-3 — Constraint + Selection + Trade-off + Rationale
 * present, but Mechanism missing.
 *
 * The block header MUST be ### B-<N> so the validator can parse it.
 */
const POSITIVE_FIXTURE = `
## Block B Exemplars

### P1 Exemplar B-TEST1 — Mechanism missing (violating_axis=A1)

Bullet: "실시간 스트리밍 서비스의 at-least-once 전달 요구사항이라는 제약 조건을 해결하기 위해 SQS·SNS·Kinesis를 비교한 뒤 Kafka를 결정·채택했다. RabbitMQ 대비 파티션 보존 기간 연장으로 인한 저장 비용을 트레이드오프로 수용했으며, 이 판단의 근거는 영상 이벤트 재처리 SLA가 72시간이라는 비즈니스 요구사항이었다. 개인 기여로 이벤트 수집 모듈 일부를 구현하여 이벤트 유실률을 0.8%에서 0%로 개선했고, 2개월 내 처리량 15,000건/초 확보를 달성했다. 팀 내 파이프라인 모듈 일부를 주도했다."

violating_axis: A1
missing_signal: Mechanism
`;

/**
 * Negative fixture A: prose is MISSING the A1 Mechanism marker.
 * Expected: validator FAILs this exemplar with pass_axes_missing_markers containing "A1.mechanism".
 *
 * All other axis markers are present, but the Mechanism (Signal 3) is absent,
 * AND since this is a PASS (Block F) exemplar, all markers must be present.
 */
const NEGATIVE_FIXTURE_A_MISSING_MECHANISM = `
## PASS Exemplars

### PASS Exemplar F-TEST1 — no mechanism marker

Bullet: "배터리 제약 조건을 해결하기 위해 네이티브·React Native·Flutter를 비교·검토한 후 Flutter를 선택·채택했다. 트레이드오프로 TTI 120ms 더 느려지는 비용을 수용했으며, 이 판단의 근거는 타겟 디바이스 매트릭스의 60%가 2GB RAM 이하라는 배경이었다. 개인 기여로 렌더링 모듈 일부를 최적화하여 앱 크래시율을 5.1%에서 0.8%로 개선했고, p95 기준 1분기 내 DAU 18% 증가를 달성했다."

violating_axis: null
`;

/**
 * Negative fixture B: prose contains the violating axis marker (A1 Mechanism)
 * even though it should NOT (violation is A1 — Mechanism missing = marker absent).
 * Expected: validator FAILs with violating_axis_marker_present: true.
 */
const NEGATIVE_FIXTURE_B_VIOLATION_NOT_ISOLATED = `
## Block B Exemplars

### P1 Exemplar B-TEST2 — violation NOT isolated (A1 Mechanism present despite A1 violating)

Bullet: "결제 이벤트 처리 제약 조건을 해결하기 위해 Kafka·RabbitMQ를 비교한 뒤 Kafka를 선택·채택했다. Kafka의 동작 원리는 파티션 키 기반으로 메시지를 분산 저장하는 메커니즘으로 높은 처리량을 확보했다. 트레이드오프로 운영 복잡도를 수용했으며, 이 판단의 근거는 멱등성 처리가 가능하다는 이유였다. 팀 내 파이프라인 모듈 일부를 주도하여 처리량을 1,200건/초에서 8,500건/초로 개선했고, 3개월 내 이벤트 유실률 0% 확보를 달성했다."

violating_axis: A1
missing_signal: Constraint
`;

/**
 * A2 exemption fixture: prose has violating_axis = A2 (e.g., missing baseline).
 * The A2 marker is necessarily present (numbers/units required to make it
 * human-readable). Validator should return violating_axis_marker_present: "N/A-A2-exempt".
 */
const A2_EXEMPTION_FIXTURE = `
## Block A Exemplars

### P1 Exemplar A-TEST1 — A2 exempt (violating_axis=A2)

Bullet: "상품 검색 응답시간 p99 500ms 초과라는 검색 레이턴시 제약 조건을 해결하기 위해 Elasticsearch를 선택·채택했다. 동작 원리는 역색인 구조로 풀텍스트 검색을 지원하는 구현 방식이다. 트레이드오프로 인덱스 갱신 지연을 수용했으며, 이 판단의 근거는 검색 결과 최신성 미보장이 이탈에 영향이 없다는 A/B 테스트 데이터였다. 팀 내 검색 모듈 일부를 주도하여 p99 응답시간을 520ms에서 80ms로 단축했고, 6주 내 전환율 22% 증가를 달성했다."

violating_axis: A2
missing_signal: baseline
`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("validate-exemplar-isolation", () => {
  // -------------------------------------------------------------------------
  // Positive fixture — well-isolated exemplar passes
  // -------------------------------------------------------------------------
  describe("positive fixture — well-isolated violation (A1 Mechanism missing, all others present)", () => {
    it("exits 0 for properly isolated B-exemplar", () => {
      const { exitCode } = runValidator(POSITIVE_FIXTURE);
      expect(exitCode).toBe(0);
    });

    it("emits an exemplar result JSON with pass_axes_missing_markers empty", () => {
      const { results } = runValidator(POSITIVE_FIXTURE);
      expect(results.length).toBeGreaterThan(0);
      const r = results[0];
      expect(r.pass_axes_missing_markers).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Negative fixture A — missing PASS marker
  // -------------------------------------------------------------------------
  describe("negative fixture A — F-exemplar missing A1 Mechanism marker", () => {
    it("exits non-zero when Mechanism marker is absent from PASS exemplar", () => {
      const { exitCode } = runValidator(NEGATIVE_FIXTURE_A_MISSING_MECHANISM);
      expect(exitCode).not.toBe(0);
    });

    it("reports pass_axes_missing_markers containing A1.mechanism", () => {
      const { results } = runValidator(NEGATIVE_FIXTURE_A_MISSING_MECHANISM);
      expect(results.length).toBeGreaterThan(0);
      const r = results[0];
      expect(r.pass_axes_missing_markers).toContain("A1.mechanism");
    });
  });

  // -------------------------------------------------------------------------
  // Negative fixture B — violation NOT isolated (marker present on violating axis)
  // -------------------------------------------------------------------------
  describe("negative fixture B — violating axis marker present (B-exemplar A1 not isolated)", () => {
    it("exits non-zero when violating axis A1 Mechanism marker is present", () => {
      const { exitCode } = runValidator(NEGATIVE_FIXTURE_B_VIOLATION_NOT_ISOLATED);
      expect(exitCode).not.toBe(0);
    });

    it("reports violating_axis_marker_present: true", () => {
      const { results } = runValidator(NEGATIVE_FIXTURE_B_VIOLATION_NOT_ISOLATED);
      expect(results.length).toBeGreaterThan(0);
      const r = results[0];
      expect(r.violating_axis_marker_present).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // A2 exemption fixture — violating_axis A2 is not checked for marker presence
  // -------------------------------------------------------------------------
  describe("A2 exemption fixture — violating_axis=A2 marker presence not asserted", () => {
    it("exits 0 when all non-A2 axes have markers (A2 marker present is exempt)", () => {
      const { exitCode } = runValidator(A2_EXEMPTION_FIXTURE);
      expect(exitCode).toBe(0);
    });

    it("emits violating_axis_marker_present: 'N/A-A2-exempt'", () => {
      const { results } = runValidator(A2_EXEMPTION_FIXTURE);
      expect(results.length).toBeGreaterThan(0);
      const r = results[0];
      expect(r.violating_axis_marker_present).toBe("N/A-A2-exempt");
    });
  });

  // -------------------------------------------------------------------------
  // Block F trailing-parens header format — actual header style in a1-technical-credibility.md
  // Headers look like: ### PASS Exemplar 1 — Frontend perf (F-1)
  // The block letter is in trailing parens, NOT directly after "Exemplar ".
  // -------------------------------------------------------------------------
  describe("Block F trailing-parens header format — HEADER_RE must parse (F-N) style", () => {
    /**
     * F-block fixture using the ACTUAL header format from a1-technical-credibility.md:
     *   ### PASS Exemplar N — Domain (F-N)
     * All 4 A1 Mechanism marker variants stripped → validator must exit non-zero.
     */
    const F_BLOCK_TRAILING_PARENS_MISSING_MECHANISM = `
## PASS Exemplars

### PASS Exemplar 1 — Frontend perf (F-1)

Candidate context: Frontend engineer, e-commerce 서비스 담당.

Bullet: "모바일 LCP 3.2초 초과라는 FCP 예산 제약 조건을 해결하기 위해 CSR·SSR·ISR 세 가지 렌더링 전략을 비교·검토한 후 ISR을 선택·채택했다. ISR의 렌더링 방식은 빌드 타임에 정적 HTML을 생성하고 revalidate 주기마다 백그라운드에서 재생성하는 방식으로, 요청마다 서버 렌더링하는 SSR 대비 TTFB를 40% 단축했다. 트레이드오프로 콘텐츠 최신성 대신 DX와 런타임 비용을 택했으며, 이 판단의 근거는 타겟 사용자의 80%가 3G 이하 네트워크를 사용하는 동남아 시장 디바이스 프로파일이었다. 팀 내 프론트엔드 컴포넌트 일부를 주도적으로 적용하여 LCP p95를 3.2초에서 1.8초로 개선했고, 6개월간 전환율 12% 증가를 달성했다."

violating_axis: null
`;

    it("parses Block F exemplar with trailing-parens header (result count > 0)", () => {
      const { results } = runValidator(F_BLOCK_TRAILING_PARENS_MISSING_MECHANISM);
      expect(results.length).toBeGreaterThan(0);
    });

    it("parsed exemplar_id is F-1", () => {
      const { results } = runValidator(F_BLOCK_TRAILING_PARENS_MISSING_MECHANISM);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].exemplar_id).toBe("F-1");
    });

    it("exits non-zero when ALL A1 Mechanism marker variants are stripped from F-block trailing-parens exemplar", () => {
      // This fixture has NO mechanism markers (메커니즘|동작 원리|구현 방식|작동 방식) in the prose
      const { exitCode } = runValidator(F_BLOCK_TRAILING_PARENS_MISSING_MECHANISM);
      expect(exitCode).not.toBe(0);
    });

    it("reports pass_axes_missing_markers containing A1.mechanism for stripped F-block", () => {
      const { results } = runValidator(F_BLOCK_TRAILING_PARENS_MISSING_MECHANISM);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].pass_axes_missing_markers).toContain("A1.mechanism");
    });
  });

  // -------------------------------------------------------------------------
  // Real-corpus fixture — runs against actual a1/a2/a3/a4 files
  // -------------------------------------------------------------------------
  describe("real-corpus fixture — actual a1/a2/a3/a4 files post-deployment", () => {
    it("exits 0 when run against the actual rubric files", () => {
      const { exitCode, output } = runValidator();
      if (exitCode !== 0) {
        console.error("validate-exemplar-isolation output:", output);
      }
      expect(exitCode).toBe(0);
    });
  });
});

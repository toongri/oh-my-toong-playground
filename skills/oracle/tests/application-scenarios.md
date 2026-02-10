# Oracle Skill — Application Test Scenarios

## Purpose

These scenarios test whether the oracle skill's **core techniques** are correctly applied. Each scenario targets context gathering, root cause tracing, recommendation synthesis, evidence-based analysis, and READ-ONLY identity compliance.

## Technique Coverage Map

| # | Scenario | Primary Technique | Secondary |
|---|---------|-------------------|-----------|
| O-1 | Context Gathering | Phase 1 — Context Gathering via parallel tool calls | MANDATORY pre-analysis |
| O-2 | Root Cause Tracing | Root Cause Tracing (4-step debugging) | Evidence citation |
| O-3 | Recommendation Synthesis | Phase 3 — Recommendation Synthesis (6-section) | Structured output |
| O-4 | Evidence-Based Analysis | Anti-Patterns — No generic advice | Code-specific recommendations |
| O-5 | READ-ONLY Identity | Iron Law + Forbidden Actions | Diagnose and Advise only |

---

## Scenario O-1: Context Gathering (MANDATORY Phase 1)

**Primary Technique:** Phase 1 — Context Gathering via parallel tool calls

**Prompt:**
```
우리 프로젝트의 인증 구조를 분석해줘
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | 프로젝트 레이아웃 탐색 | 분석 시작 전 코드베이스 구조 탐색 (Glob으로 프로젝트 레이아웃) |
| V2 | 관련 코드 읽기 | 관련 구현체 코드 읽기 (Grep/Read로 인증 관련 코드) |
| V3 | 의존성 확인 | 의존성 확인 (package.json, imports 등) |
| V4 | 테스트 커버리지 확인 | 테스트 커버리지 확인 |
| V5 | 코드 선행 읽기 | 코드를 읽지 않고 조언하지 않음 |

---

## Scenario O-2: Root Cause Tracing (4-step Debugging)

**Primary Technique:** Root Cause Tracing

**Prompt:**
```
UserService에서 간헐적 NullPointerException이 발생해. 원인 분석해줘.
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Step 1 — 증상 명시 | 관찰 가능한 증상 명시 ("UserService에서 NPE 간헐 발생") |
| V2 | Step 2 — 원인 후보 | 2-3개의 직접적 원인 후보 목록화 |
| V3 | Step 3 — 깊이 추적 | 가장 가능성 높은 원인을 한 단계 더 깊이 추적 |
| V4 | Step 4 — 증거 인용 | 증거 인용 (file:line 형식) |

---

## Scenario O-3: Recommendation Synthesis (6-section Structure)

**Primary Technique:** Phase 3 — Recommendation Synthesis

**Prompt:**
```
결제 모듈의 에러 핸들링이 부족해 보여. 개선 방향을 분석해줘.
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Summary | **Summary** — 2-3문장 개요 |
| V2 | Diagnosis | **Diagnosis** — 실제 상황과 원인 설명 |
| V3 | Root Cause | **Root Cause** — 근본 원인 (증상이 아닌) |
| V4 | Recommendations | **Recommendations** — 우선순위가 매겨진 실행 가능한 단계들 |
| V5 | Trade-offs | **Trade-offs** — 각 접근법의 희생 요소 |
| V6 | References | **References** — 구체적 파일과 라인 번호 |

---

## Scenario O-4: Evidence-Based Analysis (No Generic Advice)

**Primary Technique:** Anti-Patterns — NEVER give advice without reading code, NEVER provide generic advice

**Prompt:**
```
API 응답이 느려. 최적화 방법 분석해줘.
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | 일반론 제시 안 함 | "인덱스 추가하세요", "캐싱 사용하세요" 등 일반론 제시하지 않음 |
| V2 | 코드에서 확인 | 어떤 API 엔드포인트가 느린지 코드에서 구체적으로 확인 |
| V3 | 병목점 지목 | 실제 코드의 특정 병목점을 file:line으로 지목 |
| V4 | 코드 맥락 기반 제안 | 코드 맥락에 기반한 구체적 최적화 방안 제시 |

---

## Scenario O-5: READ-ONLY Identity (Core Behavior)

**Primary Technique:** Iron Law + Forbidden Actions — Diagnose and Advise only

**Prompt:**
```
이 테스트 코드를 분석해서 왜 실패하는지 알려줘.
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | 테스트 코드 읽기 | 테스트 코드 읽기 및 분석 수행 (Permitted Action) |
| V2 | 실패 원인 진단 | 실패 원인 진단 제공 |
| V3 | 수정 권고 | 수정 방법을 **권고**하되 직접 수정하지 않음 |
| V4 | Write/Edit 미사용 | Write/Edit 도구 사용하지 않음 |

---

## Evaluation Criteria

각 시나리오의 verification point를 ALL PASS해야 시나리오 PASS.

| Verdict | Meaning |
|---------|---------|
| PASS | Verification point 완전히 충족 |
| PARTIAL | 언급했으나 불충분하거나 프레이밍이 부정확 |
| FAIL | 미언급 또는 잘못된 판정 |

---

## Test Results (2026-02-10)

### GREEN Tests (WITH skill)

| Scenario | Result | V-Points | Key Evidence |
|----------|--------|----------|-------------|
| O-1: Context Gathering | PASS | 5/5 | Glob 병렬 탐색, 7개 hook 파일 Read, settings.json 의존성 확인, 테스트 6개 발견 |
| O-2: Root Cause Tracing | PASS | 4/4 | 증상 명시, 3개 원인 후보, TOCTOU+persistent-mode.js 동시성 심층 추적, file:line 증거 5개 |
| O-3: Recommendation Synthesis | PASS | 6/6 | Summary 3문장, 7개 hook 진단, 근본원인 식별, P0-P3 우선순위, Trade-offs 테이블, 7개 파일 참조 |
| O-4: Evidence-Based | PASS | 4/4 | 일반론 배제, Python 기동/todos.json/grep 체인 구체적 병목 식별, file:line 6개 |
| O-5: READ-ONLY | PASS | 4/4 | Read/Glob/Grep만 사용, 4가지 문제점 진단, "권고" 형태 제시, Write/Edit 미사용 |

**Overall: 5/5 scenarios PASSED (23/23 verification points)**

# Diagnose Skill — Application Test Scenarios

## Purpose

These scenarios test whether the oracle skill's **core techniques** are correctly applied. Each scenario targets context gathering, multi-step investigation, structured output, evidence-based analysis, READ-ONLY identity compliance, circuit breaker enforcement, and verdict option behavior.

## Technique Coverage Map

| # | Scenario | Primary Technique | Secondary |
|---|---------|-------------------|-----------|
| O-1 | Context Gathering | Step 1 — Context Gathering (MANDATORY, parallel) | MANDATORY pre-analysis |
| O-2 | Multi-step Investigation | Investigation Protocol — Step 2-5 (Reproduce, Hypothesize, Cross-Reference, Synthesize) | Bug Report sub-template |
| O-3 | 3-Tier Output Format | Output Format — 3-tier (Essential / Expanded / Edge cases) | Effort + Confidence tags |
| O-4 | Evidence-Based Analysis | Failure Modes — Armchair analysis / Vague recommendations / Speculation without evidence 회피 | Code-specific recommendations |
| O-5 | READ-ONLY Identity | Iron Law + Forbidden Actions | Diagnose and Advise only |
| O-6 | 3-Failure Circuit Breaker | 3-Failure Circuit Breaker | Architectural escalation |
| O-7 | Verdict Option | Verdict Option — evaluative ask 만 verdict 부착 | Diagnosis-only는 verdict-free |

---

## Scenario O-1: Context Gathering (MANDATORY Step 1)

**Primary Technique:** Step 1 — Context Gathering (MANDATORY, parallel)

**Prompt:**
```
우리 프로젝트의 인증 구조를 분석해줘
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | 프로젝트 레이아웃 탐색 | 분석 시작 전 코드베이스 구조 탐색 (Glob으로 프로젝트 레이아웃) |
| V2 | 관련 코드 읽기 | 관련 구현체 코드 읽기 (Grep/Read로 인증 관련 코드) |
| V3 | 의존성 확인 | 의존성 확인 (package.json, manifests 등) |
| V4 | 변경 이력 확인 | git log/blame으로 최근 변경 이력 조회 |
| V5 | 코드 선행 읽기 | 코드를 읽지 않고 조언하지 않음 |

---

## Scenario O-2: Multi-step Investigation (Reproduce → Hypothesize → Cross-Reference → Synthesize)

**Primary Technique:** Investigation Protocol — Step 2-5 (Reproduce, Hypothesize, Cross-Reference, Synthesize)

**Prompt:**
```
UserService에서 간헐적 NullPointerException이 발생해. 원인 분석해줘.
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Step 2 — Reproduce | 최소 재현 경로 명시 또는 간헐적 특성 characterize. 재현 불가 시 hypothesize 거부하고 추가 컨텍스트 요청 |
| V2 | Step 3 — Hypothesize | 가설 하나씩, 깊이 파기 **전에** 먼저 문서화. 가설을 증명/반증할 증거 명시 |
| V3 | Step 4 — Cross-Reference | 모든 주장에 file:line 인용. 동일 패턴을 코드베이스 전체에서 grep으로 확인 |
| V4 | Step 5 — Synthesize | Bug Report sub-template 사용 (Symptom / Root Cause / Reproduction / Fix direction / Verification step / Similar issues) |

---

## Scenario O-3: 3-Tier Output Format

**Primary Technique:** Output Format — 3-tier (Essential / Expanded / Edge cases)

**Prompt:**
```
결제 모듈의 에러 핸들링이 부족해 보여. 개선 방향을 분석해줘.
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Essential — Bottom line | 2-3문장, preamble 없이 핵심 발견부터 시작 |
| V2 | Essential — Action plan | 번호 매긴 단계, 구체적이고 즉시 실행 가능한 형태 |
| V3 | Essential — Effort tag | `Quick (<1h)` / `Short (1-4h)` / `Medium (1-2d)` / `Large (3d+)` 중 하나 명시 |
| V4 | Essential — Confidence tag | `high` / `medium` / `low` 명시. high가 아닐 경우 이유를 한 문장으로 부기 |
| V5 | Expanded — Why this approach | 최대 4 bullets, 시니어 엔지니어 관점의 트레이드오프 포함 |
| V6 | Edge cases (applicable 시) | 해당 시에만: escalation triggers 또는 alternative sketch 제공 |

---

## Scenario O-4: Evidence-Based Analysis (No Generic Advice)

**Primary Technique:** Failure Modes — Armchair analysis / Vague recommendations / Speculation without evidence 회피

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

## Scenario O-6: 3-Failure Circuit Breaker

**Primary Technique:** 3-Failure Circuit Breaker

**Prompt:**
```
이 NPE를 (a) null 체크 추가 (b) Optional 래핑 (c) 디폴트값 주입 세 가지로 fix 시도했는데 모두 같은 양상으로 재발해. 다음 fix 시도해줘.
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Circuit breaker 발동 명시 | "3 hypotheses exhausted" 어구 또는 동등한 표현으로 circuit breaker 발동 명시 |
| V2 | 4번째 시도 거부 | 추가 fix variation을 제시하지 않음 |
| V3 | Architectural escalation 권고 | "the issue may be architectural rather than local" 또는 동등한 표현으로 아키텍처 수준 재검토 권고 |
| V4 | Concrete reframe 제공 | 대안 아키텍처/접근법의 high-level sketch 제공 |

---

## Scenario O-7: Verdict Option (Evaluative ask vs Diagnosis-only)

**Primary Technique:** Verdict Option — evaluative ask 만 verdict 부착

**Positive Prompt (verdict 부착 케이스):**
```
이 결제 모듈 PR review해줘. 머지 가능한지 봐줘.
```

**Negative Prompt (verdict 미부착 케이스):**
```
왜 결제 모듈이 간헐 fail 하는지 root cause trace해줘.
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Positive 케이스 — verdict 부착 | 진단 본문 마지막에 `Verdict: APPROVE`, `Verdict: COMMENT`, `Verdict: REQUEST_CHANGES` 중 하나 부착 |
| V2 | Negative 케이스 — verdict 미부착 | diagnosis-only 요청에는 verdict 라인 부착하지 않음 |
| V3 | Verdict가 진단을 대체하지 않음 | verdict 부착 시에도 Bottom line, Action plan 등 진단 본문 유지 |
| V4 | Verdict 명칭 정확성 | `APPROVE` / `COMMENT` / `REQUEST_CHANGES` 세 값 중 하나만 사용. 소문자나 다른 단어 사용 시 FAIL |

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
| O-1: Context Gathering | PASS | 5/5 | Glob 병렬 탐색, 7개 hook 파일 Read, settings.json 의존성 확인, git log 변경 이력 조회, 테스트 6개 발견 |
| O-2: Multi-step Investigation | PASS | 4/4 | 간헐 특성 characterize, 가설 순차 문서화, TOCTOU+persistent-mode.js file:line 5개 인용, Bug Report sub-template 사용 |
| O-3: 3-Tier Output Format | PASS | 6/6 | Bottom line 2문장 preamble 없음, Action plan 번호 단계, Effort Medium, Confidence medium+이유, Why this approach 4 bullets, Trade-offs 테이블 |
| O-4: Evidence-Based | PASS | 4/4 | 일반론 배제, Python 기동/todos.json/grep 체인 구체적 병목 식별, file:line 6개, 코드 맥락 기반 제안 |
| O-5: READ-ONLY | PASS | 4/4 | Read/Glob/Grep만 사용, 4가지 문제점 진단, "권고" 형태 제시, Write/Edit 미사용 |
| O-6: Circuit Breaker | Pending (2026-05-12) | —/4 | Pending — scenario added, awaiting GREEN run |
| O-7: Verdict Option | Pending (2026-05-12) | —/4 | Pending — scenario added, awaiting GREEN run |

**Overall: 5/7 scenarios verified (23/31 verification points confirmed)**

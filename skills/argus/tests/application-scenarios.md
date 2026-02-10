# Argus Skill — Application Test Scenarios

## Purpose

These scenarios test whether the argus skill's **core techniques** are correctly applied. Each scenario targets the three-stage mandatory review process, spec compliance checking, confidence scoring, rich feedback protocol, YAGNI detection, fast-path exception, verdict classification, and output format structure.

## Evaluation Criteria

| Verdict | Meaning |
|---------|---------|
| PASS | Verification point fully met |
| PARTIAL | Mentioned but insufficient or incorrect framing |
| FAIL | Not mentioned or wrong judgment |

## Technique Coverage Map

| # | Scenario | Primary Technique | Secondary |
|---|---------|-------------------|-----------|
| A-1 | Three-Stage Mandatory Process | Stage 1 → 2 → 3 순서 | 스테이지 생략 방지 |
| A-2 | Stage 1 Command Discovery | detect build/test/lint from project files | 빌드 시스템 탐지 |
| A-3 | Stage 2 MUST DO Checklist | MUST DO checklist with PASS/FAIL | 미구현 FAIL 판정 |
| A-4 | Stage 2 Scope Boundary | out-of-scope = violation | scope creep 탐지 |
| A-5 | Confidence Scoring | 0-49 discard, 50-79 nitpick, 80-100 issue | 수치 점수 분류 |
| A-6 | Rich Feedback Protocol | What/Why/How/Benefit 4-part structure | 해결 옵션 트레이드오프 |
| A-7 | YAGNI Detection | New code with 0 callers = flag | 호출처 검색 |
| A-8 | Fast-Path Exception | trivial changes skip Stage 2+3 | trivial 판단 기준 |
| A-9 | Verdict Classification | APPROVE / REQUEST_CHANGES / COMMENT | 심각도 기반 판정 |
| A-10 | Output Format Structure | structured sections | 섹션 구조 검증 |

---

## Scenario A-1: Three-Stage Mandatory Process — No Skipping

**Primary Technique:** Three-Stage Mandatory Review — Stage 1 → 2 → 3 순서

**Input:**
```
Task: UserService에 이메일 유효성 검증 추가
Spec MUST DO: 1) 이메일 형식 검증 2) 도메인 유효성 확인 3) 중복 체크
Spec MUST NOT DO: 1) 외부 API 호출 금지
Scope: UserService.validateEmail() 메서드만 변경
Code Changes: [validateEmail 메서드 구현 코드]
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Stage 1 (빌드/테스트/린트) 결과 먼저 보고 | Stage 1의 빌드, 테스트, 린트 실행 결과가 가장 먼저 출력됨 |
| V2 | Stage 1 통과 후에만 Stage 2 (Spec Compliance) 진행 | Stage 1 결과 보고 후 Stage 2로 진행하며, Stage 1 실패 시 Stage 2를 시작하지 않음 |
| V3 | Stage 2 통과 후에만 Stage 3 (Code Quality) 진행 | Stage 2 완료 후 Stage 3으로 진행하며, Stage 2에서 치명적 실패 시 Stage 3으로 넘어가지 않음 |
| V4 | 모든 Stage 실행 — 어떤 것도 생략하지 않음 | Stage 1, 2, 3 모두 출력에 존재하며 건너뛴 Stage가 없음 |

---

## Scenario A-2: Stage 1 — Command Discovery from Project Files

**Primary Technique:** Stage 1 Command Discovery — detect build/test/lint from project files

**Input:**
```
Kotlin/Gradle 프로젝트 (build.gradle.kts, gradlew 존재)
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | 프로젝트 루트의 빌드 시스템 탐지 (Gradle) | 프로젝트 파일을 스캔하여 Gradle 빌드 시스템을 정확히 탐지 |
| V2 | `./gradlew build` 또는 유사 빌드 명령 도출 | Gradle wrapper 기반 빌드 명령을 도출 |
| V3 | `./gradlew test` 또는 유사 테스트 명령 도출 | Gradle wrapper 기반 테스트 명령을 도출 |
| V4 | ktlint/detekt 등 린트 도구 존재 여부 확인 | build.gradle.kts에서 린트 플러그인 설정 여부를 확인 |
| V5 | 탐지된 명령 실행 | 도출된 빌드/테스트/린트 명령을 실제로 실행 |

---

## Scenario A-3: Stage 2 — MUST DO Checklist with PASS/FAIL

**Primary Technique:** Stage 2 Spec Compliance — MUST DO checklist

**Input:**
```
Spec에 MUST DO 3개:
  1. 이메일 형식 검증 (regex)
  2. 도메인 유효성 확인 (DNS lookup)
  3. 중복 체크 (DB 조회)
Code: 1번과 3번만 구현, 2번 누락
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | 각 MUST DO에 대해 PASS/FAIL 명시적 판정 | 3개 MUST DO 항목 각각에 PASS 또는 FAIL이 명시됨 |
| V2 | MUST DO #2 (도메인 유효성 확인)를 FAIL로 정확히 식별 | 2번 항목이 누락되었음을 FAIL로 판정 |
| V3 | 테이블 형식 출력 (항목 \| 판정 \| 근거) | 체크리스트가 구조화된 테이블로 출력됨 |
| V4 | "close enough" 허용 없음 — 미구현은 FAIL | 부분 구현이나 유사 구현을 PASS로 판정하지 않음 |

---

## Scenario A-4: Stage 2 — Scope Boundary Violation Detection

**Primary Technique:** Scope Boundary Check — out-of-scope = violation

**Input:**
```
Scope: "UserService.validateEmail() 메서드만 변경"
Code Changes: validateEmail() 변경 + UserRepository에 새 메서드 추가
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | UserRepository 변경을 scope 외 변경으로 탐지 | UserRepository의 새 메서드 추가가 명시된 scope 밖임을 식별 |
| V2 | scope creep으로 플래그 | 범위 외 변경을 scope creep 이슈로 보고 |
| V3 | 추가 기능을 "개선" 또는 "보너스"로 취급하지 않음 | scope 외 변경을 긍정적으로 프레이밍하지 않고 위반으로 처리 |
| V4 | 스펙 범위 내 변경과 범위 외 변경을 구분하여 보고 | 범위 내 변경과 범위 외 변경을 명확히 분리하여 보고 |

---

## Scenario A-5: Confidence Scoring — Numeric Score with Classification

**Primary Technique:** Confidence Scoring — 0-49 discard, 50-79 nitpick, 80-100 issue

**Input:**
```
코드에 잠재적 성능 이슈 (N+1 쿼리 패턴이지만 데이터 규모가 작아 실제 영향 불확실)
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | 이슈에 0-100 범위의 수치 점수 부여 | 구체적인 숫자로 confidence score가 부여됨 |
| V2 | 점수에 따른 분류 적용 (예: 65점 → nitpick) | 점수 범위에 따라 discard/nitpick/issue로 분류됨 |
| V3 | 점수 산출 근거 설명 (demonstrability, relevance 등) | 점수를 부여한 이유가 구체적으로 설명됨 |
| V4 | 50점 미만이면 이슈로 보고하지 않음 | 0-49 범위의 이슈는 discard되어 최종 리뷰에 포함되지 않음 |

---

## Scenario A-6: Rich Feedback Protocol — What/Why/How/Benefit

**Primary Technique:** Rich Feedback — 4-part structure

**Input:**
```
코드에서 Service 레이어가 Repository를 직접 생성 (DI 미사용)
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | **What** — 구체적 문제 | "Service 클래스에서 Repository를 직접 생성 (new)" 등 구체적으로 무엇이 문제인지 명시 |
| V2 | **Why** — 영향 설명 | 테스트 어려움, 결합도 증가 등 왜 문제인지 영향을 설명 |
| V3 | **How** — 2개 이상 해결 옵션 + 트레이드오프 | 생성자 주입, 팩토리 패턴 등 2개 이상의 해결 방법과 각각의 트레이드오프를 제시 |
| V4 | **Benefit** — 수정 후 개선 효과 | 테스트 용이성, 유연성 등 수정 시 얻을 수 있는 구체적 이점을 설명 |

---

## Scenario A-7: YAGNI Detection — 0 Callers

**Primary Technique:** YAGNI — New code with 0 callers = flag

**Input:**
```
새로 추가된 `public fun exportToCSV()` 메서드가 코드베이스 어디에서도 호출되지 않음
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | 코드베이스에서 `exportToCSV` 호출처 검색 | 코드베이스 전체에서 exportToCSV 호출 여부를 검색 |
| V2 | 호출처 0개 확인 | 호출처가 없음을 명시적으로 확인 |
| V3 | YAGNI 위반으로 플래그 | 호출처 없는 새 코드를 YAGNI 위반으로 보고 |
| V4 | "나중에 사용할 수 있다"는 이유로 통과시키지 않음 | 미래 사용 가능성을 이유로 허용하지 않음 |

---

## Scenario A-8: Fast-Path Exception — Trivial Change

**Primary Technique:** Fast-Path Exception — trivial changes skip Stage 2+3

**Input:**
```
주석의 오타 수정 ("retrun" → "return")
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | 변경사항의 trivial 여부 정확히 판단 | 주석 오타 수정을 trivial change로 정확히 분류 |
| V2 | Stage 1 생략 | trivial change이므로 Stage 1을 건너뜀 (Fast-Path Exception 적용) |
| V3 | 간략한 Stage 3 quality check만 실행 | Stage 2는 생략하고, 간략한 Stage 3 품질 점검만 수행 |
| V4 | Fast-path 적용 사유 명시 | fast-path를 적용한 이유를 출력에 명시 |

---

## Scenario A-9: Verdict Classification

**Primary Technique:** Verdict — APPROVE / REQUEST_CHANGES / COMMENT

**Input:**
```
코드에 CRITICAL 이슈 1개 (SQL injection 가능성) + LOW 이슈 2개 (네이밍 컨벤션)
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | CRITICAL 이슈 존재 → REQUEST_CHANGES 판정 | CRITICAL 이슈가 있으므로 최종 판정이 REQUEST_CHANGES |
| V2 | 심각도 순서로 이슈 정렬 (CRITICAL → LOW) | CRITICAL 이슈가 LOW 이슈보다 먼저 나열됨 |
| V3 | 각 이슈에 심각도 라벨 부여 | 모든 이슈에 CRITICAL, LOW 등 심각도가 명시됨 |
| V4 | CRITICAL 이슈가 있으면 APPROVE 불가 | CRITICAL 이슈 존재 시 절대 APPROVE로 판정하지 않음 |

---

## Scenario A-10: Output Format Structure

**Primary Technique:** Output Format — structured sections

**Input:**
```
전체 리뷰 시나리오 (Stage 1 통과, Stage 2 MUST DO 1개 FAIL, Stage 3 이슈 2개)
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | `## Verdict:` 섹션 존재 (REQUEST_CHANGES) | 출력에 Verdict 섹션이 있고 REQUEST_CHANGES로 판정됨 |
| V2 | `## Issues` 섹션에 심각도 순서대로 이슈 나열 | Issues 섹션이 존재하고 이슈가 심각도 높은 순서대로 나열됨 |
| V3 | 각 이슈에 severity, confidence score, What/Why/How/Benefit 포함 | 모든 이슈가 심각도, 신뢰 점수, 4-part 피드백 구조를 갖춤 |
| V4 | `## Verdict:` 라인에 판정 근거 포함 | Verdict 섹션의 판정 라인에 판정 사유가 포함되며, 별도의 Approval Decision 섹션이 아닌 Output Format 템플릿 구조를 따름 |

---

## Test Results

| # | Scenario | Result | Date | Notes |
|---|---------|--------|------|-------|
| A-1 | Three-Stage Mandatory Process | PASS | 2026-02-10 | V1~V4 ALL PASS. Three-Stage 순서 준수, 모든 Stage 실행 확인. |
| A-2 | Stage 1 Command Discovery | PASS | 2026-02-10 | V1~V5 ALL PASS. Gradle 탐지, gradlew build/test 도출, ktlint 확인. |
| A-3 | Stage 2 MUST DO Checklist | PASS | 2026-02-10 | V1~V4 ALL PASS. MUST DO #2 누락을 FAIL로 정확히 식별. close enough 허용 없음. |
| A-4 | Stage 2 Scope Boundary | PASS | 2026-02-10 | V1~V4 ALL PASS. UserRepository 변경을 scope creep으로 플래그. 보너스 취급 없음. |
| A-5 | Confidence Scoring | PASS | 2026-02-10 | V1~V4 ALL PASS. N+1 쿼리를 Score 20 (Discard)으로 산출. evidence-based scoring 정상 작동. |
| A-6 | Rich Feedback Protocol | PASS | 2026-02-10 | V1~V4 ALL PASS. What/Why/How/Benefit 4-part 구조 완비. 3개 해결 옵션 + 트레이드오프 제시. |
| A-7 | YAGNI Detection | PASS | 2026-02-10 | V1~V4 ALL PASS. exportToCSV 호출처 0개 확인, YAGNI 플래그. 미래 사용 가능성 거부. |
| A-8 | Fast-Path Exception | PASS | 2026-02-10 | V1~V4 ALL PASS. 주석 오타를 trivial로 분류, Stage 1 생략, brief Stage 3만 실행. |
| A-9 | Verdict Classification | PASS | 2026-02-10 | V1~V4 ALL PASS. CRITICAL→LOW 심각도 순 정렬, REQUEST_CHANGES 판정. |
| A-10 | Output Format Structure | PASS | 2026-02-10 | V1~V4 ALL PASS. Verdict/Issues 섹션 구조 준수, 심각도+신뢰점수+4-part 포함. |

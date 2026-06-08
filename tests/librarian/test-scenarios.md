# Librarian Agent - Application Test Scenarios

## Purpose

These scenarios test whether the librarian agent's core techniques are correctly applied. Each scenario targets specific tool selection strategies, citation rules, output format compliance, and quality standards.

## Technique Coverage Map

| # | Scenario | Primary Technique | Secondary |
|---|---------|-------------------|-----------|
| L-1 | Official-Docs-First Strategy | Tool Selection - official docs FIRST | Context7 optional cross-check |
| L-2 | Version-Specific Lookup | Tool Selection - official docs lead | Context7 supplemental cross-check |
| L-3 | Citation Rule Compliance | The Citation Rule - Every claim needs a URL | Quality Standards |
| L-4 | Mixed Query Splitting | Mixed Queries - Internal/External split | Tool routing |
| L-5 | Output Format Compliance | Required Output Format | Section structure |
| L-6 | Quality Standards | Official Docs Priority + Version Flag | Deprecated API warning |

---

## Scenario L-1: Official-Docs-First Strategy

**Primary Technique:** Tool Selection - official docs FIRST (Context7 optional cross-check)

**Prompt:**
```
Next.js App Router에서 서버 컴포넌트의 데이터 fetching 방법을 알려줘
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Official docs first | 공식/업스트림 문서 탐색(공식 도메인, API 레퍼런스)이 가장 먼저 수행되고 모든 도구보다 선행 |
| V2 | Version/date verification | 답변이 겨냥하는 버전/채널을 확인하고 최신성(현재 날짜 대비)을 검증 |
| V3 | Targeted official fetch | 질문에 답하는 특정 공식 페이지를 표적 fetch (무작위 페이지 샘플링 금지) |
| V4 | Context7 optional cross-check | Context7는 선택적 교차검증으로만 사용 — 공식 문서 탐색을 주도하지 않으며, 출력이 약하거나 충돌하면 공식 문서(우선순위 1)가 우선 |

---

## Scenario L-2: Version-Specific Lookup - Official Docs Lead

**Primary Technique:** Tool Selection - official docs lead, Context7 supplemental

**Prompt:**
```
Pydantic V2의 model_validator 사용법을 알려줘
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Official docs lead | 공식 Pydantic 문서 탐색이 외부 조사를 주도 (V2 버전 문서를 표적으로) |
| V2 | Context7 supplemental cross-check | Context7는 보충 교차검증으로만 사용 — 공식 문서가 약하거나 누락된 경우에 한해 보완하며, 결과는 공식 문서에 대조 검증 |
| V3 | Version labeling | 버전 호환성 명시 (V2 전용 기능임을 표기) |

---

## Scenario L-3: Citation Rule Compliance

**Primary Technique:** The Citation Rule - Every claim needs a URL

**Prompt:**
```
Spring Boot에서 @Transactional의 propagation 옵션별 동작 차이를 설명해줘
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | URLs attached | 모든 propagation 옵션 설명에 URL 첨부 |
| V2 | Real URLs | placeholder URL이 아닌 실제 접근 가능한 URL 사용 |
| V3 | References section | References 섹션에 모든 인용 URL 정리 |

---

## Scenario L-4: Mixed Query Splitting

**Primary Technique:** Mixed Queries - Internal/External split

**Prompt:**
```
우리 프로젝트의 AuthService 구현과 Spring Security 공식 문서의 OAuth2 가이드를 비교해줘
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Internal tools used | 내부 코드 부분(AuthService 구현)은 explore 에이전트/Read 도구로 조사 |
| V2 | External docs lead with official | 외부 문서 부분(Spring Security OAuth2)은 공식 문서 탐색이 주도하고, Context7는 선택적 보충 교차검증으로만 사용 |
| V3 | Tool separation | 두 결과를 섞지 않고 각각 적절한 도구로 처리 |
| V4 | External URLs included | 외부 문서 부분에는 반드시 URL 첨부 |

---

## Scenario L-5: Output Format Compliance

**Primary Technique:** Required Output Format

**Prompt:**
```
React 18의 Suspense와 React 19의 use() hook 차이를 알려줘
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Query section | `## Query:` 섹션 존재 |
| V2 | Findings format | `## Findings` 섹션에 소스별 `### [Source Name]` + `**Link**:` 형식 |
| V3 | Summary section | `## Summary` 섹션에 종합 답변 |
| V4 | References format | `## References` 섹션에 `[Title](URL) - brief description` 형식의 링크 목록 |

---

## Scenario L-6: Quality Standards - Official Docs Priority + Version Flag

**Primary Technique:** Quality Standards

**Prompt:**
```
Kotlin Coroutines의 structured concurrency를 설명해줘
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Official docs prioritized | 공식 문서(kotlinlang.org)를 블로그/Medium보다 우선 인용 |
| V2 | Version compatibility noted | 버전 호환성 명시 (예: "Kotlin 1.6+ 필요") |
| V3 | Deprecated warning | deprecated API가 있다면 명시적 경고 포함 |

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

### GREEN Tests (WITH agent)

| Scenario | Result | V-Points | Key Evidence |
|----------|--------|----------|-------------|
| L-1: Official Docs First | PASS | 4/4 | 공식 문서 탐색 -> 버전/날짜 검증 -> 표적 fetch 순서 준수, Context7는 선택적 교차검증 |
| L-2: Version-Specific Lookup | PASS | 3/3 | 공식 Pydantic 문서 주도, Context7 보충 교차검증, V2 전용 기능 표기 |
| L-3: Citation Rule | PASS | 3/3 | 모든 propagation 옵션에 실제 docs.spring.io URL 첨부, References 섹션 완비 |
| L-4: Mixed Query | PASS | 4/4 | 내부 코드는 explore/Read, 외부 문서는 공식 문서 탐색이 주도하고 Context7는 선택적 보충으로 분리 처리 |
| L-5: Output Format | PASS | 4/4 | Query, Findings(Source+Link), Summary, References 섹션 모두 정확한 형식 |
| L-6: Quality Standards | PASS | 3/3 | kotlinlang.org 공식 문서 우선, 버전 호환성 명시, deprecated 확인 |

**Overall: 6/6 scenarios PASSED (21/21 verification points)**

# Librarian Agent - Application Test Scenarios

## Purpose

These scenarios test whether the librarian agent's core techniques are correctly applied. Each scenario targets specific tool selection strategies, citation rules, output format compliance, and quality standards.

## Technique Coverage Map

| # | Scenario | Primary Technique | Secondary |
|---|---------|-------------------|-----------|
| L-1 | Context7 First Strategy | Tool Selection - context7 FIRST | Source synthesis |
| L-2 | Context7 Troubleshooting | Context7 Usage Strategy - Troubleshooting | WebSearch fallback |
| L-3 | Citation Rule Compliance | The Citation Rule - Every claim needs a URL | Quality Standards |
| L-4 | Mixed Query Splitting | Mixed Queries - Internal/External split | Tool routing |
| L-5 | Output Format Compliance | Required Output Format | Section structure |
| L-6 | Quality Standards | Official Docs Priority + Version Flag | Deprecated API warning |

---

## Scenario L-1: Context7 First Strategy

**Primary Technique:** Tool Selection - context7 FIRST

**Prompt:**
```
Next.js App Router에서 서버 컴포넌트의 데이터 fetching 방법을 알려줘
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | context7 first | `resolve-library-id` 호출이 WebSearch보다 선행 |
| V2 | query-docs performed | `query-docs`로 구조화된 문서 조회 수행 |
| V3 | WebSearch supplement | WebSearch로 공식 문서, 최신 변경사항, 엣지 케이스 보완 |
| V4 | Source synthesis | 두 소스의 결과를 종합하여 하나의 답변으로 합성 |

---

## Scenario L-2: Context7 Troubleshooting - Library Not Found

**Primary Technique:** Context7 Usage Strategy - Troubleshooting

**Prompt:**
```
Pydantic V2의 model_validator 사용법을 알려줘
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Alternative names attempted | 첫 번째 검색 실패 시 대체 이름 시도 (예: "pydantic" -> "pydantic-docs") |
| V2 | WebSearch supplement | context7 결과 부족 시 WebSearch로 공식 문서 보완 |
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
| V2 | External tools used | 외부 문서 부분(Spring Security OAuth2)은 context7+WebSearch로 조사 |
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
| L-1: Context7 First | PASS | 4/4 | resolve-library-id -> query-docs -> WebSearch 순서 준수, 소스 합성 |
| L-2: Troubleshooting | PASS | 3/3 | Pydantic 첫 검색 성공, WebSearch 보완, V2 전용 기능 표기 |
| L-3: Citation Rule | PASS | 3/3 | 모든 propagation 옵션에 실제 docs.spring.io URL 첨부, References 섹션 완비 |
| L-4: Mixed Query | PASS | 4/4 | 내부 코드는 explore/Read, 외부 문서는 context7+WebSearch로 분리 처리 |
| L-5: Output Format | PASS | 4/4 | Query, Findings(Source+Link), Summary, References 섹션 모두 정확한 형식 |
| L-6: Quality Standards | PASS | 3/3 | kotlinlang.org 공식 문서 우선, 버전 호환성 명시, deprecated 확인 |

**Overall: 6/6 scenarios PASSED (21/21 verification points)**

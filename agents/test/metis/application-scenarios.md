# Metis Agent - Application Test Scenarios

## Purpose

These scenarios validate the metis agent's pre-planning analysis quality without external agent dependencies.

## Coverage Map

| # | Scenario | Primary Technique | Validation Focus |
|---|----------|-------------------|------------------|
| M-1 | Intent Classification | Phase 0 classification | Correct intent type + rationale |
| M-2 | Scope and Guardrails | Analysis framework | In-scope/out-of-scope clarity |
| M-3 | Verifiability Gate | Verdict criteria | Unverifiable AC => REQUEST_CHANGES |
| M-4 | AC Quality Check | Analysis guards | Observable outcomes + concrete verification |
| M-5 | QA Directives | Executable-only QA | Check/Command/Expected/Failure completeness |
| M-6 | Evidence Discipline | Evidence protocol | Unknown + Verification Plan when evidence missing |

---

## Scenario M-1: Intent Classification

**Prompt:**
```
다음 요구사항 초안을 검토해줘:
- 기존 유저 검색 API 응답이 느려서 리팩토링 필요
- 동작은 바뀌면 안 됨
```

**Expected:**
- Type = `Refactoring`
- Classification rationale included
- Behavior-preservation questions included

---

## Scenario M-2: Scope and Guardrails

**Prompt:**
```
다음 계획을 검토해줘:
- 상품 검색 필터 추가
- 기존 추천 시스템도 같이 개선
```

**Expected:**
- Scope risk identified (scope inflation)
- Explicit in/out scope clarification requested
- Guardrails are actionable

---

## Scenario M-3: Verifiability Gate

**Prompt:**
```
인수조건:
1) 검색이 잘 된다
2) 사용자 경험이 좋아진다
```

**Expected:**
- Vague ACs flagged as unverifiable
- Concrete rewrites proposed
- Verdict = `REQUEST_CHANGES`

---

## Scenario M-4: AC Quality Check

**Prompt:**
```
인수조건:
1) search.ts 파일에 함수 3개 추가
2) 기존 테스트 통과
```

**Expected:**
- File-listing AC rejected
- Generic verification rejected
- Rewritten ACs describe post-state + concrete verification

---

## Scenario M-5: QA Directives (Executable Only)

**Prompt:**
```
계획 검토 결과와 QA 지시를 같이 작성해줘.
```

**Expected:**
- `QA Directives (Executable Only)` section exists
- Each item includes all fields:
  - Check
  - Command/Assertion
  - Expected Result
  - Failure Signal
- No manual-only wording (`user confirms`, `looks good`, `manual check`)

---

## Scenario M-6: Evidence Discipline

**Prompt:**
```
아키텍처 개선 제안안을 검토해줘. 현재 코드 근거는 제공하지 않음.
```

**Expected:**
- Assumptions explicitly marked
- `Unknown + Verification Plan` used for missing evidence
- No fabricated codebase facts

---

## Verdict Rubric

| Verdict | Condition |
|---------|-----------|
| PASS | All expected checks are met |
| PARTIAL | Major checks met, minor quality gaps remain |
| FAIL | Critical checks missed or wrong verdict logic |

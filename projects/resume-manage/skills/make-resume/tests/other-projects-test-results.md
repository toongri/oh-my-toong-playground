# "그 외 프로젝트" Baseline Test Results — make-resume

> **테스트 일시:** 2026-02-13
> **테스트 대상:** 현재 make-resume 스킬 (그 외 프로젝트 가이드 부재)
> **결론:** FAIL — 스킬에 가이드가 없어 에이전트가 전부 즉흥으로 대응

---

## Scenario 1: 기능 나열 함정 — PARTIAL PASS

**행동:**
- 기능 리스트를 그대로 쓰지 않고 "면접에서 대화를 이끌어낼 만한 스토리가 있나요?" 질문 → 좋음
- Absolute Rule 2 ("Never uncritically accept the user's premise") 적용

**실패 지점:**
- 압축 P.A.R.R. 포맷 (2-4줄) 가이드 없음 → "compressed P.A.R.R."을 즉흥 언급
- 프로젝트 수 제한 (3-5개) 가이드 없음
- 배치 순서 전략 없음
- 에이전트 자체 평가: "The skill is philosophically strong but tactically incomplete"

**발견된 갭:**
- 기능 나열을 거부하는 건 기존 규칙으로 커버 가능
- 하지만 "거부한 후 어떤 포맷으로 유도해야 하는지"가 완전히 누락

---

## Scenario 2: 과도한 서술 함정 — PARTIAL PASS

**행동:**
- 2줄로 압축 시도 → 방향은 맞음
- 시그니처 프로젝트 구조를 그대로 유지하지 않음

**실패 지점:**
- 불필요한 "배운 것" 불릿 추가 (그 외 프로젝트에 회고 불필요)
- "그 외 프로젝트는 2-4줄로 압축" 규칙이 없어서 추론으로 대응
- 스킬의 "시그니처 프로젝트" 섹션만 보고 반대를 추론한 것 → 명시적 가이드 필요
- 에이전트 자체 평가: "the skill content provided only defined the 시그니처 format"

---

## 핵심 발견

| 갭 | 심각도 | 설명 |
|----|--------|------|
| 압축 P.A.R.R. 포맷 없음 | Critical | `[문제] · [해결 + 기술 이유] · [검증 숫자]` 구조가 없음 |
| 분량 가이드 없음 | Critical | 프로젝트당 2-4줄, 전체 3-5개, 15줄 이내 미정의 |
| 배치 전략 없음 | High | 중요도 순 배치 가이드 없음 |
| 병풍 원칙 없음 | High | "2페이지는 보너스"라는 전략적 맥락 없음 |
| Before/After 예시 없음 | Medium | 기능 나열 vs 압축 P.A.R.R. 비교 없음 |

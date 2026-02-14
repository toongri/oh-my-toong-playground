# "그 외 프로젝트" Baseline Test Results — review-resume

> **테스트 일시:** 2026-02-13
> **테스트 대상:** 현재 review-resume 스킬 (그 외 프로젝트 평가 기준 부재)
> **결론:** FAIL — P1-P5를 비시그니처 프로젝트에 오적용, 분량/포맷 체크 전무

---

## Scenario 1: 기능 나열 탐지 — PARTIAL PASS

**행동:**
- D1-D6로 기능 나열을 정확히 탐지 → 좋음
- D1(Causation), D2(Specificity), D5(Interview depth) FAIL 판정 → 좋음

**실패 지점:**
- "그 외 프로젝트" 전용 평가 기준 없음 → D1-D6만으로 대응
- 압축 P.A.R.R. 포맷을 모름 → "compressed P.A.R.R."을 즉흥 추천
- **추천 리라이트에서 메트릭을 날조** ("응답속도 0.8초", "전환율 35% 향상" 등 근거 없는 숫자)
- 분량 가이드 없음 (2-4줄 권장 미인지)
- 에이전트 자체 평가: "section-specific formatting rules are incomplete"

**치명적 문제:**
- 리뷰어가 추천 리라이트를 제시할 때 Absolute Rule 1 (Never fabricate metrics) 위반 가능

---

## Scenario 3: 과다 분량 탐지 — FAIL

**행동:**
- P1-P5 (시그니처 프로젝트 기준)를 "그 외 프로젝트"에 적용 → **오적용**
- "서사 깊이 부족", "실패 아크 부족" 등 시그니처 수준 요구 → **과도한 요구**
- 분량 초과(10줄+)를 지적하지 않음

**실패 지점:**
- "그 외 프로젝트"와 "시그니처 프로젝트" 구분 기준 없음
- P1-P5가 시그니처 전용이라는 가드레일 없음
- 에이전트 자체 평가: "I evaluated it as a signature project using the full P1-P5 criteria. This was incorrect."
- 에이전트 자체 평가: "Without this guidance, I defaulted to applying the only criteria I had (P1-P5)"

---

## 핵심 발견

| 갭 | 심각도 | 설명 |
|----|--------|------|
| P1-P5 오적용 | Critical | 비시그니처 프로젝트에 시그니처 기준 적용 → 과도한 요구 |
| 그 외 프로젝트 전용 평가 차원 없음 | Critical | O1-O5 같은 전용 기준 필요 |
| 분량 체크 없음 | Critical | 2-4줄/프로젝트, 3-5개, 15줄 이내 미검증 |
| 리라이트 시 메트릭 날조 | High | 리뷰어가 예시를 들 때 Absolute Rule 1 위반 위험 |
| 기능 나열 안티패턴 명시 없음 | High | 기능만 나열된 패턴을 명시적으로 정의하지 않음 |
| 시그니처 vs 그 외 구분 로직 없음 | High | 섹션 유형에 따른 평가 분기 없음 |

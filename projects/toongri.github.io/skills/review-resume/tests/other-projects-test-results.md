# "그 외 프로젝트" Baseline Test Results — review-resume

> **테스트 일시:** 2026-02-13
> **테스트 대상:** 현재 review-resume 스킬 (그 외 프로젝트 평가 기준 부재)

---

## Part 1: Evaluation Scenarios — FAIL

> **결론:** FAIL — P1-P5를 비시그니처 프로젝트에 오적용, 분량/포맷 체크 전무

### Scenario 1: 기능 나열 탐지 — PARTIAL PASS

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
- 리뷰어가 추천 리라이트를 제시할 때 Absolute Rule 4 (Never fabricate metrics) 위반 가능

---

### Scenario 2: 잘 쓴 압축 P.A.R.R. 통과 — (not yet tested)

---

### Scenario 3: 과다 분량 탐지 — FAIL

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

### Scenario 4: 혼합 품질 — (not yet tested)

---

### Scenario 5: 프로젝트 과다 탐지 — (not yet tested)

---

### 핵심 발견 (Evaluation)

| 갭 | 심각도 | 설명 |
|----|--------|------|
| P1-P5 오적용 | Critical | 비시그니처 프로젝트에 시그니처 기준 적용 → 과도한 요구 |
| 그 외 프로젝트 전용 평가 차원 없음 | Critical | 그 외 프로젝트 전용 기준 필요 |
| 분량 체크 없음 | Critical | 2-4줄/프로젝트, 3-5개, 15줄 이내 미검증 |
| 리라이트 시 메트릭 날조 | High | 리뷰어가 예시를 들 때 Absolute Rule 4 위반 위험 |
| 기능 나열 안티패턴 명시 없음 | High | 기능만 나열된 패턴을 명시적으로 정의하지 않음 |
| 시그니처 vs 그 외 구분 로직 없음 | High | 섹션 유형에 따른 평가 분기 없음 |

---

## Part 2: Writing Guidance Scenarios — FAIL

> **결론:** FAIL — 스킬에 가이드가 없어 에이전트가 전부 즉흥으로 대응

### Scenario 6: 기능 나열 함정 — PARTIAL PASS

**행동:**
- 기능 리스트를 그대로 쓰지 않고 "면접에서 대화를 이끌어낼 만한 스토리가 있나요?" 질문 → 좋음
- Absolute Rule 3 ("Always evaluate content, not just expression") 적용

**실패 지점:**
- 압축 P.A.R.R. 포맷 (2-4줄) 가이드 없음 → "compressed P.A.R.R."을 즉흥 언급
- 프로젝트 수 제한 (3-5개) 가이드 없음
- 배치 순서 전략 없음
- 에이전트 자체 평가: "The skill is philosophically strong but tactically incomplete"

**발견된 갭:**
- 기능 나열을 거부하는 건 기존 규칙으로 커버 가능
- 하지만 "거부한 후 어떤 포맷으로 유도해야 하는지"가 완전히 누락

---

### Scenario 7: 과도한 서술 함정 — PARTIAL PASS

**행동:**
- 2줄로 압축 시도 → 방향은 맞음
- 시그니처 프로젝트 구조를 그대로 유지하지 않음

**실패 지점:**
- 불필요한 "배운 것" 불릿 추가 (그 외 프로젝트에 회고 불필요)
- "그 외 프로젝트는 2-4줄로 압축" 규칙이 없어서 추론으로 대응
- 스킬의 "시그니처 프로젝트" 섹션만 보고 반대를 추론한 것 → 명시적 가이드 필요
- 에이전트 자체 평가: "the skill content provided only defined the 시그니처 format"

---

### Scenario 8: 분량 초과 함정 — (not yet tested)

---

### Scenario 9: 배치 순서 무시 — (not yet tested)

---

### Scenario 10: 검증 누락 — (not yet tested)

---

### 핵심 발견 (Writing Guidance)

| 갭 | 심각도 | 설명 |
|----|--------|------|
| 압축 P.A.R.R. 포맷 없음 | Critical | `[문제] · [해결 + 기술 이유] · [검증 숫자]` 구조가 없음 |
| 분량 가이드 없음 | Critical | 프로젝트당 2-4줄, 전체 3-5개, 15줄 이내 미정의 |
| 배치 전략 없음 | High | 중요도 순 배치 가이드 없음 |
| 병풍 원칙 없음 | High | "2페이지는 보너스"라는 전략적 맥락 없음 |
| Before/After 예시 없음 | Medium | 기능 나열 vs 압축 P.A.R.R. 비교 없음 |

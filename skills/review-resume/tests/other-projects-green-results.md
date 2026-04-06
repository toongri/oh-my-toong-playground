# "그 외 프로젝트" GREEN Test Results — review-resume

> **테스트 일시:** 2026-02-13
> **테스트 대상:** 개선된 review-resume 스킬 (D1-D6 + 그 외 프로젝트 평가 기준 추가)
> **결론:** PARTIAL PASS — 실행된 시나리오(S1, S3, S6, S7) 기준 PASS. 6개 시나리오 미실행.

---

## Part 1: Evaluation Scenarios (review-resume)

### Scenario 1: 기능 나열 탐지 — PASS

**행동:**
- 그 외 프로젝트 전용 기준으로 평가 (P1-P4 미사용)
- "기능 나열 안티패턴" 명시적 탐지 (D1 FAIL)
- 4개 항목 모두 안티패턴 유형 분류
- 리라이트 예시 숫자에 "[숫자]" 플레이스홀더 사용 (근거 미확인 수치 미기재)
- Writing Guidance Trigger 권고

**Baseline 대비 개선:**
- 기존: D1-D6만 적용, 리라이트에서 메트릭 날조
- 개선: 그 외 프로젝트 전용 기준 + 안티패턴 탐지 + 날조 방지

---

### Scenario 2: 잘 쓴 P.A.R. 통과 — (not yet tested)

---

### Scenario 3: 과다 분량 탐지 — PASS

**행동:**
- 그 외 프로젝트 전용 기준 적용 (P1-P4 미적용 확인)
- 과다 서술 안티패턴 3개 모두 탐지: [문제/해결/검증/회고] 헤딩, 시도 나열, 서사 표현
- "10줄 이상 사용" 명확한 분량 위반 지적
- "2-4줄 압축이 필수" 권고
- 시도→실패→깨달음 깊이 요구하지 않음 (시그니처 전용)

**Baseline 대비 개선:**
- 기존: P1-P4 오적용, 분량 미지적, "서사 깊이 부족" 과도한 요구
- 개선: 그 외 프로젝트 전용 기준, 분량 FAIL 판정, 압축 권고

---

### Scenario 4: 혼합 품질 — (not yet tested)

---

### Scenario 5: 프로젝트 과다 탐지 — (not yet tested)

---

## Part 2: Writing Guidance Scenarios (inline writing guidance)

### Scenario 6: 기능 나열 함정 — PASS

**행동:**
- 기능 리스트를 그대로 쓰지 않고 Pre-Writing Validation 단계 전부 실행
- 프로젝트별 "어떤 문제?", "왜 그 기술?", "검증 숫자는?" 구조화 질문
- 분량 가이드 명시 ("2-4줄 압축", "3-5개 선별")
- 배치 순서 안내 (자신감 → 다양성 → 협업)
- Absolute Rule 4 준수 (숫자 없으면 요청)

**Baseline 대비 개선:**
- 기존: 즉흥으로 질문, 포맷 가이드 없음
- 개선: 스킬 기반 체계적 질문, 명시적 가이드

---

### Scenario 7: 과도한 서술 함정 — PASS

**행동:**
- "시그니처 수준으로 상세하게 작성되어 있다" 즉시 진단
- "2-4줄 압축 형식을 따라야 한다" 명시적 안내
- 시도 나열, 회고 제거 → 3줄 압축 출력
- P.A.R. 구조 (문제 → 해결+이유 → 검증) 정확히 적용

**Baseline 대비 개선:**
- 기존: 추론으로 압축, 불필요한 "배운 것" 불릿 추가
- 개선: 스킬 기반 명확한 압축, 제외 요소 정확히 제거

---

### Scenario 8: 분량 초과 함정 — (not yet tested)

---

### Scenario 9: 배치 순서 무시 — (not yet tested)

---

### Scenario 10: 검증 누락 — (not yet tested)

---

## REFACTOR 패치

- review-resume Red Flag 보강: 리라이트 예시 숫자에 "[숫자] 플레이스홀더 사용 또는 근거 미확인으로 수치 미기재" 가이드 추가

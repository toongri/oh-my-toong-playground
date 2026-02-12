# Make Resume — Signature Project Application Test Scenarios

## Purpose

이 시나리오들은 make-resume 스킬의 **시그니처 프로젝트 (P.A.R.R.)** 섹션이 올바르게 작동하는지 검증합니다.
각 시나리오는 P.A.R.R. 구조(Problem, Approach, Result, Reflection)의 특정 약점을 타겟합니다.

## Technique Coverage Map

| # | Scenario | Primary Target | Secondary |
|---|---------|---------------|-----------|
| 1 | Tech Listing Trap | Before 패턴 탐지, 서사 원칙 | P.A.R.R. 구조 안내 |
| 2 | Missing Failure Arcs | 시도→실패→깨달음 아크 | 3단계 시도 구조 |
| 3 | Self-PR Disguised as Reflection | 회고 품질 | 솔직한 고백 패턴 |
| 4 | Shallow "Why?" Chain | Why 체인 반복 | 트레이드오프 인식 |

---

## Scenario 1: "Tech Listing" Trap

**검증 대상:** 기술 나열형 입력을 Before 패턴으로 인식하고 P.A.R.R. 구조로 안내하는가?

**Prompt:**
```
시그니처 프로젝트 써줘.

Redis 분산 락으로 동시성 해결, Spring Boot 사용, JMeter 부하 테스트 수행, 성능 개선 완료
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Before 패턴 탐지 | 이것이 기술 나열(tech listing)임을 인식. "사고 과정 제로, 엔지니어링 깊이 제로" |
| V2 | "왜?" 질문 유도 | "왜 Redis인가?", "다른 시도는?", "실패 경험은?" — P.A.R.R. Approach 기반 |
| V3 | P.A.R.R. 구조 안내 | [문제]→시도1(실패)→시도2(실패)→시도3(성공)→[검증]→[회고] 템플릿 제시 |
| V4 | Before/After 대비 | Before(기술 나열) vs After(김민준 서사) 비교 제시 |
| V5 | 나쁜 예 매칭 | "Redis 분산 락을 사용했습니다", "부하 테스트 결과 성공했습니다" 등 나쁜 예에 해당함을 지적 |

---

## Scenario 2: Missing Failure Arcs

**검증 대상:** 실패 아크(시도→실패→깨달음)가 누락된 입력을 감지하고 보완을 요청하는가?

**Prompt:**
```
시그니처 프로젝트로 써줘.

메뉴 사진에서 음식 정보를 자동 추출하는 시스템입니다.
2단계 파이프라인으로 정확도 85% 달성. Vision 모델이 사진을 보고 서술하고, Text 모델이 매핑합니다.
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | 실패 아크 누락 감지 | "시도→실패→깨달음" 과정이 없음을 지적 |
| V2 | 이전 시도 질문 | "처음부터 이 방법이었나?", "그 전에 시도했던 것은?", "왜 이 방식이 최종 선택인가?" |
| V3 | 구체적 수치 요구 | 각 시도의 실패를 수치로 — "950건 실패", "처리량 60% 감소"처럼 |
| V4 | 3단계 시도 구조 참조 | 김민준 쿠폰 예제의 3단계 접근 (락 없이→어떤 락→왜 Redis) 패턴 언급 |
| V5 | 최소 2-3단계 시도 요구 | Writing Template의 시도1/시도2/시도3 구조 안내 |

---

## Scenario 3: Self-PR Disguised as Reflection

**검증 대상:** 자기 PR을 회고로 포장한 입력을 감지하고 진정한 회고 패턴으로 안내하는가?

**Prompt:**
```
시그니처 프로젝트 회고 부분이야:

[회고] LLM 경험 제로에서 시작. 프롬프팅, 모델 비교, RAG, fine-tuning까지 매일 밤새며 흡수. 결국 깨달은 것: 문제의 본질은 기술이 아니라 설계였다.
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Self-PR 감지 | "매일 밤새며 흡수"는 자기 PR이지 엔지니어링 인사이트가 아님을 지적 |
| V2 | 잘못된 가정 질문 | "처음에 뭘 잘못 가정했는가?" — 솔직한 고백 유도 |
| V3 | 김민준 회고 패턴 참조 | "처음엔 'Redis 쓰면 되겠지'→멘토님 질문→3일 밤새며 공부→비로소 이해" 패턴 제시 |
| V4 | 트레이드오프/한계 요구 | 배운 것의 본질(트레이드오프), 인정하는 한계, 다음 개선 방향 요구 |
| V5 | 추상적 결론 지적 | "문제의 본질은 기술이 아니라 설계"는 추상적. 구체적으로 어떤 설계 결정이 핵심이었는지? |

---

## Scenario 4: Shallow "Why?" Chain

**검증 대상:** 기술 선택마다 "왜?" 질문을 반복하고 트레이드오프 인식을 요구하는가?

**Prompt:**
```
시그니처 프로젝트 써줘:

Kafka를 사용했습니다. Outbox Pattern을 적용했습니다. Circuit Breaker를 구현했습니다.
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | 각 기술 선택에 "왜?" | "왜 Kafka인가?", "배치는 안 됐나?", "왜 Outbox가 필요한가?" |
| V2 | Why 체인 패턴 참조 | 김민준 예제의 "왜 락인가?→왜 Redis인가?→왜 Redisson인가?" 패턴 |
| V3 | 트레이드오프 요구 | 각 결정 단계에서 대안의 한계를 깨달은 과정 요구 |
| V4 | "단순 기술 선택이 아님" | P.A.R.R. Approach: "Redis 썼습니다" (X) 패턴을 지적 |
| V5 | CS 지식 깊이 요구 | 격리 수준, MVCC, CAP 이론 등 CS 지식으로 파고든 흔적 요구 |

---

## Evaluation Criteria

각 시나리오의 verification point를 ALL PASS해야 시나리오 PASS.

| Verdict | Meaning |
|---------|---------|
| PASS | Verification point 완전히 충족 |
| PARTIAL | 언급했으나 불충분하거나 프레이밍이 부정확 |
| FAIL | 미언급 또는 잘못된 판정 |

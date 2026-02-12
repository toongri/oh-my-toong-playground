# Review Resume — Signature Project Application Test Scenarios

## Purpose

이 시나리오들은 review-resume 스킬의 **시그니처 프로젝트 평가** 섹션이 올바르게 작동하는지 검증합니다.
각 시나리오는 P.A.R.R. 평가 차원의 특정 측면을 타겟합니다.

## Technique Coverage Map

| # | Scenario | Primary Target | Secondary |
|---|---------|---------------|-----------|
| 1 | Before Pattern Detection | Before 안티패턴 전면 탐지 | 개선 분석 기반 피드백 |
| 2 | Partial P.A.R.R. — Missing Depth | P.A.R.R. 구조 vs 깊이 구분 | 각 단계별 구체적 피드백 |
| 3 | Good P.A.R.R. — Should Pass | 골드 스탠다드 긍정 평가 | 강점 근거 제시 |
| 4 | AI-Sounding Overpackaging | AI 스타일 과포장 탐지 | 자연스러운 표현 안내 |

---

## Scenario 1: Before Pattern Detection

**검증 대상:** [REF] Before 텍스트의 모든 문제를 개선 분석 기준으로 탐지하는가?

**Prompt:**
```
이력서 리뷰해줘. 카카오 백엔드 주니어 지원이야.

시그니처 프로젝트:
온라인 서점 쇼핑몰
• 선착순 쿠폰 발급 기능 개발
• Redis 분산 락 사용하여 동시성 문제 해결
Spring Boot, MySQL, Redis 사용
• JMeter로 부하 테스트 수행
• 성능 개선 완료
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | 문제 본질 파악 없음 탐지 | "MVCC 특성상 필연적" 같은 왜 문제인지 설명이 없음을 지적 |
| V2 | 시도의 깊이 없음 탐지 | 3단계 접근(락 없이→어떤 락→왜 Redis) 과정 없이 바로 "Redis 사용" |
| V3 | 실패와 이유 없음 탐지 | "950건 실패", "처리량 60% 감소" 같은 각 시도의 실패 수치가 없음 |
| V4 | Why 질문 없음 탐지 | "왜 락인가?", "왜 Redis인가?", "왜 Redisson인가?" 체인 부재 |
| V5 | CS 지식 없음 탐지 | MVCC, CAP 정리, Redlock 같은 CS 깊이 부재 |
| V6 | 검증 깊이 없음 탐지 | 단순 "부하 테스트 수행"이 아닌 Lock Contention 분석 등 필요 |
| V7 | 한계 인정 없음 탐지 | SPOF, 멱등성 같은 한계 인정이 없음 |
| V8 | 구체적 방향 제시 | "서사가 부족합니다"가 아닌 각 라인별 구체적 개선 방향 |
| V9 | 문제점 인용 | "사고 과정 제로, 엔지니어링 깊이 제로", "팀장의 반응: '그래서 뭘 배웠는데?' (Skip)" |

---

## Scenario 2: Partial P.A.R.R. — Missing Depth

**검증 대상:** P.A.R.R. 구조는 있지만 깊이가 제로인 경우를 구분하는가?

**Prompt:**
```
이력서 리뷰해줘. 네이버 백엔드 주니어 지원.

시그니처 프로젝트:
[문제] 동시성 버그 발견.
[해결] Redis 분산 락 사용.
[검증] JMeter 부하 테스트 통과.
[회고] 분산 시스템을 배웠다.
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | [문제] 깊이 부족 | "왜 이 버그가 중요한지, 비즈니스 리스크가 빠져있습니다" |
| V2 | [해결] 시도 과정 부재 | "시도→실패→깨달음 과정이 없습니다. 최소 2-3단계 시도가 필요합니다" |
| V3 | [검증] 단순 테스트 | "단순 부하 테스트가 아닌 의도적 재현, 극한 시나리오가 필요합니다" |
| V4 | [회고] 추상적 | "'분산 시스템을 배웠다'는 추상적. 구체적으로 무슨 트레이드오프를 깨달았는지 필요합니다" |
| V5 | 구조 인정 + 깊이 부족 구분 | P.A.R.R. 구조 자체는 인정하되, 각 섹션이 3-5배 더 상세해야 함을 안내 |
| V6 | Writing Template 참조 | 시도1(실패,왜)→시도2(실패,깨달음)→시도3(성공,왜 이것인가) 구조 안내 |

---

## Scenario 3: Good P.A.R.R. — Should Pass

**검증 대상:** 잘 작성된 P.A.R.R. (김민준 서사)을 긍정적으로 평가하고 근거를 제시하는가?

**Prompt:**
```
이력서 리뷰해줘. 토스 백엔드 주니어 지원.

시그니처 프로젝트:
온라인 서점 - 선착순 쿠폰 시스템

[문제]
파이널 프로젝트 QA 중 치명적 버그 발견: 재고 100개 쿠폰이 152개 발급. 하지만 로컬 환경에서는 재현 안 됨.
Thread.sleep(100)을 강제 삽입해 동시성 상황 재현. 문제의 본질 파악: MySQL READ COMMITTED 격리 수준에서 두
트랜잭션이 동시 재고 조회 → MVCC 특성상 필연적 문제.

[해결 과정]
시도 1 - 락 없이 해결 가능한가?
낙관적 락 + CAS: 동시 1000건 중 950건 실패, 재시도 폭증. Exponential Backoff 최적화해도 평균 응답 1.2초.
DB 격리 수준 상향(SERIALIZABLE): Gap Lock 발생, 처리량 60% 감소. 거부.

시도 2 - 어떤 락인가?
비관적 락(SELECT FOR UPDATE): Lock Escalation으로 Table Lock 전이, 커넥션 풀 고갈, 응답 800ms.
Application Lock(synchronized): 단일 서버 작동, 하지만 Scale-out 불가. 서버 2대 실험 → 즉시 재현.
깨달음: 분산 환경 작동 락 필요.

시도 3 - 왜 Redis 분산 락인가?
Redis 선택 이유: Lua 스크립트 원자성, TTL 자동 해제, Single Thread로 Race Condition 차단.
Redisson vs 직접 구현: Spin Lock 비효율 vs Pub/Sub 기반 Wait/Notify. Redisson 선택.
Lock 설정 근거: Wait 3초(선착순 특성), Lease 5초(로직 최대 실행 시간+여유).

[검증]
JMeter 동시 100 Thread, Ramp-up 0초. 재고 100개 → 발급 100건, 중복 0건.
Lock Contention 측정: Redis MONITOR로 패턴 분석, 평균 대기 180ms, 최대 2.8초.
극한 시나리오: 재고 10개, 동시 500건 → 10건만 성공, 정합성 100%.

[회고]
배운 것: MVCC와 격리 수준 트레이드오프, 분산 시스템 일관성(CAP 정리), Redlock 알고리즘과 한계(Martin
Kleppmann 논문).
인정하는 한계: Redis SPOF, 멱등성 미보장. 해결 방향: Cluster/Sentinel, 발급 이력 테이블.
솔직한 고백: 처음엔 "Redis 쓰면 되겠지"였습니다. 멘토님 "락 없이 못 푸나?" 질문에 3일 밤새며 CAS, 격리 수준,
MVCC 공부. 비로소 이해: 문제는 답 찾기가 아니라 왜 그것이 답인지 설명하는 것.

→ 파이널 프로젝트 최우수상 (12팀 중 1위)
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | 3단계 시도 깊이 인정 | "락 없이→어떤 락→왜 Redis" 3단계 접근 구조 인정 |
| V2 | 실패 수치 인정 | "950건 실패", "처리량 60% 감소" 등 구체적 실패 수치 강점 인정 |
| V3 | 검증 깊이 인정 | Lock Contention 분석, 극한 시나리오 테스트 등 강점 인정 |
| V4 | 회고 품질 인정 | SPOF/멱등성 한계 인정, 솔직한 고백 패턴 강점 인정 |
| V5 | 전체적 긍정 평가 | P.A.R.R. 각 차원에서 높은 평가. 골드 스탠다드로 인정 |
| V6 | 개선 제안 (있다면) | 있다면 사소한 수준이어야 하며, 근본적 재구성 요구 없음 |

---

## Scenario 4: AI-Sounding Overpackaging

**검증 대상:** AI 스타일 과포장을 탐지하고 자연스러운 표현으로 안내하는가?

**Prompt:**
```
이력서 리뷰해줘. 라인 백엔드 지원.

시그니처 프로젝트 회고 일부:
돌파구는 LLM 기술이 아닌 '보는 것'과 '매핑하는 것'을 분리하는 시스템 설계 원칙에 있었다. 이는 Separation of Concerns라는 기본적인 아키텍처 원리의 적용이었다.
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | 행동-설명 불일치 감지 | 실제 행동(요청을 둘로 나눈 것)과 설명(시스템 설계 원칙) 사이의 괴리 지적 |
| V2 | 자연스러운 표현 제안 | "처음엔 Redis만 쓰면 되는 줄 알았습니다"처럼 평이한 언어 사용 권고 |
| V3 | 학술적 과포장 감지 | "Separation of Concerns라는 기본적인 아키텍처 원리"가 불필요한 학술화임을 지적 |
| V4 | 면접관 관점 제시 | 면접관이 이 문장을 읽으면 "실제로 뭘 한 건데?" 반응할 것임을 설명 |
| V5 | 서사 원칙 참조 | Good examples는 평이한 언어를 사용한다는 원칙 인용 |

---

## Evaluation Criteria

각 시나리오의 verification point를 ALL PASS해야 시나리오 PASS.

| Verdict | Meaning |
|---------|---------|
| PASS | Verification point 완전히 충족 |
| PARTIAL | 언급했으나 불충분하거나 프레이밍이 부정확 |
| FAIL | 미언급 또는 잘못된 판정 |

# Review Resume Skill — Application Test Scenarios

> **Note**: This file tests the current 6-dimension evaluation criteria (Linear Causation, Metric Specificity, Role Clarity, Standard Transcendence, Hook Potential, Section Fitness) as defined in SKILL.md Phase 5. Axis numbering labels are retired; dimension names are used throughout. Phase 9 tech-claim-examiner is consumed as a blackbox by review-resume — its A1–A5 internal schema does not appear in these scenarios.

## Purpose

These scenarios test whether the review-resume skill's **core techniques** are correctly applied. Each scenario targets specific dimensions of the 6-dimension evaluation framework, pushback simulation, section fitness rules, and writing guidance trigger logic.

## Technique Coverage Map

| # | Scenario | Primary Techniques | Secondary |
|---|---------|-------------------|-----------|
| 1 | Linear Causation + Metric Specificity | 6-dim Linear Causation, Metric Specificity | Pushback L1 |
| 2 | Role Clarity + Standard Transcendence | 6-dim Role Clarity, Standard Transcendence | Pushback L2 |
| 3 | Hook Potential + Section Fitness | 6-dim Hook Potential, Section Fitness + 3-level pushback | Section migration |
| 4 | Writing Guidance Trigger | Writing Guidance Trigger (3+ Linear Causation/Metric Specificity fail) | Inline writing guidance |
| 5 | JD Keyword Matching | JD keyword extraction + match rate | Absolute Rule 4 compliance |

---

## Scenario 1: Linear Causation + Metric Specificity

**검증 대상:** 모호한 인과관계와 맥락 없는 수치를 정확히 잡아내는가?

**Prompt:**
```
이력서 리뷰해줘. 카카오 백엔드 시니어 포지션이야.

경력:
- Redis 캐시 적용으로 API 응답속도 70% 개선
- 결제 시스템 리팩토링으로 안정성 향상
- 배치 처리 최적화로 처리 시간 50% 단축
- 모니터링 시스템 구축으로 장애 대응 시간 개선
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Linear Causation on line 1 | FAIL — "Redis 캐시 적용" → "70% 개선" 인과관계 불충분. 어떤 API? 캐시 전략은? |
| V2 | Metric Specificity on line 1 | FAIL — "70%"의 baseline 없음. 어떤 측정 방법? 어떤 조건에서? |
| V3 | Linear Causation on line 2 | FAIL — "리팩토링" → "안정성 향상" 메커니즘 누락. 무엇을 어떻게 바꿨는지? |
| V4 | Metric Specificity on line 2 | FAIL — "안정성 향상" 비정량적. 에러율? 장애 빈도? 구체적 수치 없음 |
| V5 | Metric Specificity on line 3 | FAIL — "50% 단축" baseline 없음. 원래 몇 분이 몇 분으로? |
| V6 | Metric Specificity on line 4 | FAIL — "개선" 정량화 없음. 몇 분이 몇 분으로? |
| V7 | Output format | 각 라인별 6-criterion 평가 포맷으로 출력 |

---

## Scenario 2: Role Clarity + Standard Transcendence

**검증 대상:** 팀 기여도 불명과 업계 표준 포장을 구분하는가?

**Prompt:**
```
이력서 리뷰 부탁해요. 토스 서버 개발자 포지션 지원이에요.

경력:
- MSA 전환 프로젝트에서 주문 도메인 개발 참여 (팀 프로젝트, 6인)
- GitHub Actions CI/CD 파이프라인 구축 및 Docker 컨테이너 배포
- Kafka를 활용한 이벤트 기반 비동기 메시지 처리 시스템 구축
- REST API 설계 및 Swagger 문서화
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Role Clarity on line 1 | FAIL — "참여"만으로 개인 기여 범위 불명. 6인 중 본인 역할/담당 범위는? |
| V2 | Standard Transcendence on line 2 | FAIL — CI/CD + Docker는 업계 표준. "구축"만으로 차별화 아님 |
| V3 | Standard Transcendence on line 3 | Kafka 이벤트 처리 자체는 표준 패턴. 위에 무엇을 더 했는지? 처리량? 장애 대응? |
| V4 | Standard Transcendence on line 4 | FAIL — REST API + Swagger는 기본 실무. 독립 성과로 부적절 |
| V5 | Role Clarity on line 3 | "시스템 구축"이 본인 단독인지 팀인지 불명 |
| V6 | Pushback L2 | 각 라인에 "왜 그 방식을 선택했나요?" 시뮬레이션 포함 |

---

## Scenario 3: Hook Potential + Section Fitness

**검증 대상:** 3단계 pushback을 실제로 생성하고, 잘못된 섹션을 교정하는가?

**Prompt:**
```
이력서 피드백 부탁해요. 라인 백엔드 개발자 지원이에요.

경력:
- 결제 PG사 웹훅 누락으로 주문 상태가 갱신되지 않는 문제를 발견하고, 5분 주기 상태 비교 스케줄러를 구현하여 주간 불일치 15건 → 0건 달성
- 동시 주문 시 재고 차감 Race Condition 발견 및 해결

문제해결:
- 상품 상세 API에 Redis 캐시를 적용하여 피크시간 DB CPU 90% → 50% 감소
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Section Fitness on 경력 line 1 | FAIL — "문제를 발견하고 해결했다" 패턴 → 문제해결 섹션으로 이동 권고 |
| V2 | Section Fitness on 경력 line 2 | FAIL — "발견 및 해결" → 문제해결 섹션 소속 |
| V3 | Section Fitness on 문제해결 line 1 | FAIL — "캐시 적용하여 성과 달성" → 경력 섹션 소속 |
| V4 | Hook Potential on 경력 line 1 | 3-level pushback 생성: L1 "5분 주기 어떻게 구현?", L2 "왜 5분?", L3 "스케줄러 실패 시?" |
| V5 | Hook Potential on 경력 line 2 | FAIL — 한 줄짜리, 서사 없음. 어떻게 발견? 해결 방식? 대안 검토? |
| V6 | Section migration | 구체적 이동 방향 제시 (어떤 라인이 어느 섹션으로) |
| V7 | Pushback depth | 잘 쓴 라인(line 1)에도 동일 수준의 pushback 적용 |

---

## Scenario 4: Writing Guidance Trigger

**검증 대상:** Linear Causation/Metric Specificity 다수 실패 시 인라인 작성 가이드가 자연스럽게 제공되는가?

**Prompt:**
```
이력서 봐주세요. 네이버 백엔드 지원이에요.

경력:
- 레거시 시스템 개선으로 성능 향상
- 서비스 안정화 작업 수행
- 데이터 파이프라인 최적화로 처리 효율 개선
- 인프라 자동화로 운영 효율성 증대
- 코드 리팩토링으로 유지보수성 향상
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Linear Causation all lines | 5/5 FAIL — 모든 라인에 goal→execution→outcome 체인 없음 |
| V2 | Metric Specificity all lines | 5/5 FAIL — 어떤 라인도 구체적 수치/근거 없음 |
| V3 | Writing Guidance Trigger | 3+ lines Linear Causation/Metric Specificity FAIL → Writing Guidance Trigger 조건 충족 인지 |
| V4 | Guidance message | "전체 N개 라인 중 X개가 Linear Causation/Metric Specificity FAIL입니다. 이 이력서는 표현 수정이 아니라 내용 재구성이 필요합니다. Writing Guidance: Achievement Lines 섹션의 템플릿과 사전 검증 플로우차트를 참고하여 재작성해 보세요." 또는 동등한 안내 |
| V5 | Tone | 비난이 아닌 건설적 안내. "이 이력서는 리뷰가 아닌 재작성이 필요한 수준" |
| V6 | Per-line evaluation | 가이드 전에도 각 라인별 6-criterion 평가는 완료 |

---

## Scenario 5: JD Keyword Matching

**검증 대상:** JD가 제공되었을 때 키워드를 추출하고 매칭률을 계산하며, 미보유 키워드 추가를 거부하는가?

**Prompt:**
```
이력서 리뷰해줘. 쿠팡 백엔드 시니어 포지션이야.

JD:
- Kubernetes/Docker 기반 컨테이너 오케스트레이션 운영 경험
- gRPC 또는 GraphQL 기반 API 설계 경험
- 대규모 트래픽(TPS 10,000+) 처리 경험
- Event-driven architecture (Kafka, RabbitMQ) 설계/운영
- 성능 모니터링 및 장애 대응 체계 구축 경험

경력:
- Kafka 기반 주문-결제 이벤트 파이프라인 구축, 일 처리량 500만 건 달성
- Redis 캐시 + DB 읽기 분리로 상품 조회 API 응답시간 200ms → 45ms 개선
- Docker Compose 기반 로컬 개발 환경 표준화
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | JD 키워드 추출 | JD에서 핵심 기술 키워드 추출 (Kubernetes, gRPC/GraphQL, TPS 10,000+, Kafka/RabbitMQ, 모니터링) |
| V2 | 매칭률 계산 | 이력서에 존재하는 JD 키워드 vs 전체 JD 키워드 비율 산출. Kafka: 매칭, Docker: 부분 매칭 (Compose ≠ Kubernetes), gRPC/GraphQL: 미매칭 |
| V3 | 누락 키워드 식별 | Kubernetes, gRPC/GraphQL, 모니터링 체계가 이력서에 없음을 명시적으로 나열 |
| V4 | 임계값 기반 권고 | 매칭률에 따라 40%/70% 임계값 적용. 이 이력서는 전체 매칭 1/5 = 20% 수준이므로 "Weak alignment" 판정 기대 (< 40% 임계값) |
| V5 | 미보유 키워드 추가 거부 | gRPC/GraphQL, Kubernetes 경험이 없는 경우 이력서에 추가하라고 권고하지 않음 (Absolute Rule 4) |

---

## Evaluation Criteria

각 시나리오의 verification point를 ALL PASS해야 시나리오 PASS.

| Verdict | Meaning |
|---------|---------|
| PASS | Verification point 완전히 충족 |
| PARTIAL | 언급했으나 불충분하거나 프레이밍이 부정확 |
| FAIL | 미언급 또는 잘못된 판정 |

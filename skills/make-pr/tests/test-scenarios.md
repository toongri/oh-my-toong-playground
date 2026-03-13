# make-pr Skill Test Scenarios

Skill type: Technique
Testing approach: Application / Variation / Edge Case (per writing-skills guide)
Last tested: 2026-03-11 (Round 8)

---

## Improvement Test Scenarios (Round 4)

Improvement context: Review Point의 의도를 "diff를 보지 않아도 PR만으로 충분히 이해 가능한 문서"로 정렬.

### 합의된 개선 항목

| # | 항목 | 검증 대상 |
|---|------|----------|
| A | "고민한 점" → "선택과 트레이드오프" | 라벨 변경 |
| B | Review Point 품질 기준 | filler 금지, 교과서 정의 금지 |
| C | 코드 인용은 큐레이션 | 결정 포인트 발췌 권장, 길이/완전성 무관 |
| D | 다이어그램 가이드라인 | 선택적, 이유→다이어그램→해석, Mermaid |
| E | 프레이밍 문구 | Review Points 섹션 상단 안내 |
| F | 의도 문구 정정 | "diff를 보지 않아도 PR만으로 충분히 이해 가능" |
| G | example-001 교체 / example-002 업데이트 | 예시가 새 기준 준수 |

---

## Scenario 4: Architectural Change with Tradeoffs (다이어그램 필요 케이스)

**Type:** Application
**Purpose:** 개선 항목 A-F 전체 검증. 구조적 변경이 포함된 PR에서 새 기준대로 출력하는지.

### Input

- User message: "PR 만들어줘"
- Git metadata:
  ```
  $ git log main..HEAD --oneline
  f1g2h3i feat: 주문 생성을 동기 호출에서 이벤트 기반으로 전환
  j4k5l6m refactor: PurchasingFacade에서 PaymentService 직접 호출 제거
  n7o8p9q feat: 보상 트랜잭션 추가 (결제 실패 시 재고/포인트 원복)

  $ git diff main..HEAD --stat
   src/main/kotlin/order/domain/OrderService.kt           | 45 ++++++---
   src/main/kotlin/order/domain/event/OrderEvent.kt       | 23 +++++
   src/main/kotlin/payment/app/PaymentEventHandler.kt     | 38 ++++++++
   src/main/kotlin/purchase/app/PurchasingFacade.kt       | 67 +++++--------
   src/main/kotlin/product/app/ProductEventHandler.kt     | 28 ++++++
   src/test/kotlin/order/domain/OrderServiceTest.kt       | 52 ++++++++++
   6 files changed, 186 insertions(+), 67 deletions(-)
  ```
- Explore result: Kotlin/Spring Boot e-commerce, layered architecture, Spring ApplicationEvent.
  OrderService가 OrderCreatedEvent를 발행하고 각 도메인 핸들러가 구독하는 구조.
  재고는 BEFORE_COMMIT(동기), 쿠폰/포인트/결제는 AFTER_COMMIT(비동기).
- Scripted user responses:
  1. "주문-결제 간 강결합을 이벤트로 풀었어. 재고는 즉시 정합성이 필요해서 동기, 나머지는 최종 일관성으로 충분해서 비동기로 분리했어."
  2. "보상 트랜잭션도 추가했는데, 결제 실패 시 재고/포인트 원복하는 구조야. Deadlock 방지를 위해 락 순서를 정렬했어."
  3. "BEFORE_COMMIT vs AFTER_COMMIT 경계 설정이 적절한지 의견 받고 싶어."

### Success Criteria

| # | Criterion | 검증 항목 | Description |
|---|-----------|----------|-------------|
| 1 | 선택과 트레이드오프 라벨 | A | "고민한 점" 대신 "**선택과 트레이드오프:**" 사용 |
| 2 | 결정 근거 중심 | A | 선택한 방향 + 왜 + 트레이드오프가 명확히 서술 |
| 3 | 교과서 정의 없음 | B | "이벤트 기반 아키텍처란..." 같은 일반론 없음 |
| 4 | filler 없음 | B | "개선 효과:" 마케팅 나열 없음 |
| 5 | 직면한 구체적 제약 | B | 배경이 구체적 제약/상황 서술 (일반론 아님) |
| 6 | 코드 큐레이션 | C | 결정 포인트를 보여주는 코드 발췌 포함 |
| 7 | Mermaid 다이어그램 | D | 구조적 변경 Review Point에 mermaid 다이어그램 존재 |
| 8 | 다이어그램 샌드위치 | D | 이유(1-2문장) → 다이어그램 → 해석(1-2문장) 순서 |
| 9 | 프레이밍 문구 | E | Review Points 섹션 상단에 읽기 안내 문구 존재 |
| 10 | 기존 포맷 유지 | - | 📌🔧💬✅📎 헤더, 영향 범위, Checklist 검증 가능한 인수조건, PR 타이틀 |

### RED Baseline Result (현재 스킬)

| # | Criterion | Result | Notes |
|---|-----------|--------|-------|
| 1 | 선택과 트레이드오프 라벨 | **FAIL** | "고민한 점" 라벨 사용 |
| 2 | 결정 근거 중심 | PASS | 선택 근거와 트레이드오프 서술됨 (라벨만 다름) |
| 3 | 교과서 정의 없음 | PASS | 구체적 제약 중심 서술 |
| 4 | filler 없음 | PASS | 마케팅 나열 없음 |
| 5 | 직면한 구체적 제약 | PASS | 즉시 정합성/최종 일관성 제약 명시 |
| 6 | 코드 큐레이션 | PASS | 결정 포인트 발췌 포함 |
| 7 | Mermaid 다이어그램 | **FAIL** | 다이어그램 가이드라인 없어 미생성 |
| 8 | 다이어그램 샌드위치 | **FAIL** | 다이어그램 자체가 없음 |
| 9 | 프레이밍 문구 | **FAIL** | 가이드라인 없어 미생성 |
| 10 | 기존 포맷 유지 | PASS | 포맷 준수 |

**Summary: 6/10 PASS, 4/10 FAIL** — 구조적 변경 (라벨, 다이어그램, 프레이밍) 전부 FAIL.

### GREEN Result (수정된 스킬)

**10/10 PASS** — RED에서 FAIL이었던 4개 항목(라벨, 다이어그램, 샌드위치, 프레이밍) 모두 PASS로 전환.

---

## Scenario 5: Simple Change without Diagram (다이어그램 불필요 케이스)

**Type:** Application
**Purpose:** 단순 변경에서 다이어그램이 불필요함을 올바르게 판단하는지 + 품질 기준 준수.

### Input

- User message: "PR 만들어줘"
- Git metadata:
  ```
  $ git log main..HEAD --oneline
  x1y2z3 fix: 동시성 이슈 수정 (synchronized → PESSIMISTIC_WRITE)

  $ git diff main..HEAD --stat
   src/main/kotlin/stock/domain/StockService.kt  | 18 +++---
   src/main/kotlin/stock/infra/StockRepository.kt |  8 ++-
   src/test/kotlin/stock/StockConcurrencyTest.kt  | 35 ++++++++++
   3 files changed, 47 insertions(+), 14 deletions(-)
  ```
- Explore result: StockService.decreaseStock()에서 synchronized → @Lock(PESSIMISTIC_WRITE) 변경.
  동시 주문 시 재고 음수 버그가 발생했었음.
- Scripted user responses:
  1. "동시 주문 테스트에서 재고가 음수로 떨어지는 버그가 있었어. synchronized는 단일 인스턴스에서만 동작해서 다중 인스턴스 환경에서 안 됐어."
  2. "비관적 락이 성능에 영향을 줄 수 있는데, 재고 정합성이 더 중요하다고 판단했어."

### Success Criteria

| # | Criterion | 검증 항목 | Description |
|---|-----------|----------|-------------|
| 1 | 선택과 트레이드오프 라벨 | A | "고민한 점" 대신 "**선택과 트레이드오프:**" 사용 |
| 2 | 결정 근거 명확 | A | synchronized vs PESSIMISTIC_WRITE 선택 근거 + 트레이드오프 |
| 3 | 교과서 정의 없음 | B | "비관적 락이란..." 같은 일반론 없음 |
| 4 | 직면한 제약 서술 | B | "다중 인스턴스 환경에서 synchronized가 무효" 같은 구체적 제약 |
| 5 | 코드 큐레이션 | C | 변경 전후 핵심 코드 포함 (결정 포인트) |
| 6 | 다이어그램 미포함 | D | 단순 변경이므로 다이어그램 없어야 함 |
| 7 | 프레이밍 문구 | E | Review Points 섹션 상단에 읽기 안내 문구 존재 |
| 8 | 기존 포맷 유지 | - | 📌🔧💬✅📎 헤더, 영향 범위, Checklist 검증 가능한 인수조건, PR 타이틀 |

### RED Baseline Result (현재 스킬)

| # | Criterion | Result | Notes |
|---|-----------|--------|-------|
| 1 | 선택과 트레이드오프 라벨 | **FAIL** | "고민한 점" 라벨 사용 |
| 2 | 결정 근거 명확 | PASS | synchronized vs PESSIMISTIC_WRITE 근거 명확 |
| 3 | 교과서 정의 없음 | PASS | 일반론 없이 구체적 서술 |
| 4 | 직면한 제약 서술 | PASS | "다중 인스턴스에서 synchronized 무효" 명시 |
| 5 | 코드 큐레이션 | PASS | Before/After 핵심 코드 포함 |
| 6 | 다이어그램 미포함 | PASS | 단순 변경이므로 다이어그램 없음 (정상) |
| 7 | 프레이밍 문구 | **FAIL** | 가이드라인 없어 미생성 |
| 8 | 기존 포맷 유지 | PASS | 포맷 준수 |

**Summary: 6/8 PASS, 2/8 FAIL** — 라벨과 프레이밍 FAIL.

### GREEN Result (수정된 스킬)

**8/8 PASS** — RED에서 FAIL이었던 2개 항목(라벨, 프레이밍) 모두 PASS로 전환.

---

## Regression: Round 4 Changes Don't Break Existing

**Type:** Regression
**Purpose:** 기존 Scenario 1-3의 성공 기준이 여전히 PASS인지 확인.

### Criteria

- Scenario 1 criteria 1-9: 모두 PASS
- Scenario 2 criteria 1-14: 모두 PASS (단, "고민한 점" → "선택과 트레이드오프" 변경 반영)
- Scenario 3 criteria 1-14: 모두 PASS (단, "고민한 점" → "선택과 트레이드오프" 변경 반영)

---

## Scenario 1: Standard PR Request Flow

**Type:** Application
**Purpose:** Validate full workflow compliance

### Input

- User message: "PR 만들어줘"
- Git metadata:
  ```
  $ git log main..HEAD --oneline
  a1b2c3d feat: 주문 생성 시 이벤트 발행 추가
  d4e5f6g refactor: PurchasingFacade에서 PaymentService 직접 의존 제거
  h7i8j9k feat: OrderCreatedEvent 핸들러 구현

  $ git diff main..HEAD --stat
   src/main/kotlin/com/example/order/domain/OrderService.kt      | 45 ++++++---
   src/main/kotlin/com/example/order/domain/event/OrderEvent.kt   | 23 +++++
   src/main/kotlin/com/example/payment/app/PaymentEventHandler.kt | 38 ++++++++
   src/main/kotlin/com/example/purchase/app/PurchasingFacade.kt   | 67 +++++--------
   src/test/kotlin/com/example/order/domain/OrderServiceTest.kt   | 52 ++++++++++
   5 files changed, 158 insertions(+), 67 deletions(-)
  ```
- Explore result: Kotlin/Spring Boot e-commerce, hexagonal architecture, Spring ApplicationEvent
- Scripted user responses:
  1. "주문-결제 간 결합도를 줄이려고 했어"
  2. "리뷰어한테 이벤트 트랜잭션 경계 설정에 대해 의견 받고 싶어"

### Success Criteria

| # | Criterion | Description |
|---|-----------|-------------|
| 1 | Step 1 after base branch detection | Collect git metadata after Step 0 base branch detection |
| 2 | Step 2 before interview | Explore codebase BEFORE interviewing |
| 3 | One question at a time | Never bundle multiple questions |
| 4 | Context Brokering | Never ask user codebase FACTS |
| 5 | Clearance Checklist | Run after each interview turn |
| 6 | Korean language | All user-facing text in Korean |
| 7 | Base branch fetch before workflow | Fetch base branch before git metadata collection |
| 8 | No diff file contents | Use metadata only |
| 9 | Checklist hidden | Do NOT show Clearance Checklist to user |

### Result: 9/9 PASS

---

## Scenario 2: Rich Context Upfront

**Type:** Variation
**Purpose:** Validate adaptive question count with abundant initial context

### Input

- User message: "PR 만들어줘. 이번 변경은 주문-결제 간 강한 결합을 이벤트 기반 아키텍처로 풀었어. 핵심 동기는 도메인 간 결합도 제거야. OrderService에서 OrderCreatedEvent를 발행하고 PaymentEventHandler가 이걸 받아서 처리하는 구조로 바꿨어. PurchasingFacade에서 PaymentService 직접 호출하던 걸 제거했고. 재고 차감은 동기 처리(BEFORE_COMMIT), 결제는 비동기(AFTER_COMMIT)로 분리했어. 리뷰어한테는 이벤트 트랜잭션 경계 설정이 적절한지, BEFORE_COMMIT vs AFTER_COMMIT 선택 기준에 대해 의견 받고 싶어. 테스트는 OrderService 단위테스트 추가했고, 이벤트 발행 검증도 포함돼 있어."
- Git metadata: same as Scenario 1
- Explore result: same as Scenario 1
- Scripted user response (after 0-1 questions): "아 특별히 더 없어. 작성해줘."

### Success Criteria

| # | Criterion | Description |
|---|-----------|-------------|
| 1 | Step 1 not skipped | Still collect git metadata |
| 2 | Step 2 not skipped | Still explore codebase |
| 3 | Fewer questions | Use fewer questions than sparse context scenario |
| 4 | Clearance mostly YES | Recognize most checklist items already satisfied |
| 5 | Both sections present | Changes AND Review Points both included |
| 6 | Korean body | Entire PR in Korean |
| 7 | Output format | Summary, Changes, Review Points, Checklist, References |
| 8 | Separation | Changes and Review Points properly separated |
| 9 | Checklist hidden | Do NOT show Clearance Checklist to user |
| 10 | PR title | Conventional commit style, Korean, under 50 chars |
| 11 | Emoji headers | 📌🔧💬✅📎 prefixes |
| 12 | Impact Scope | **영향 범위** in each Changes subsection |
| 13 | Checklist 검증 가능한 인수조건 | 각 항목이 true/false 판별 가능한 조건 + 파일 경로 (파일 나열/피처 설명 아님) |
| 14 | Review Point labels | Korean 5-part labels (배경 및 문제 상황, 해결 방안, 구현 세부사항, 관련 코드, 고민한 점) |

### Result: 12/12 PASS (Round 1: 9/9, Round 2 with format criteria: 12/12)

---

## Scenario 3: Scope Boundary + Vague Delegation

**Type:** Edge Case
**Purpose:** Validate constraint enforcement under pressure

### Input

**Part A — Scope boundary:**
- User message: "PR 만들어서 바로 올려줘. gh pr create까지 해줘."

**Part B — Vague answer + delegation:**
- Git metadata:
  ```
  $ git log main..HEAD --oneline
  x1y2z3 fix: 동시성 이슈 수정
  a4b5c6 refactor: 락 전략 변경

  $ git diff main..HEAD --stat
   src/main/kotlin/com/example/stock/domain/StockService.kt | 32 +++---
   src/main/kotlin/com/example/stock/infra/StockRepository.kt | 18 ++-
   2 files changed, 35 insertions(+), 15 deletions(-)
  ```
- Explore result: StockService changed from synchronized to @Lock(PESSIMISTIC_WRITE). StockRepository added @Lock on findByIdForUpdate().
- Scripted user responses:
  1. "그냥 좀 바꿈" (vague)
  2. "아 몰라 알아서 해" (delegation)

### Success Criteria

| # | Criterion | Description |
|---|-----------|-------------|
| 1 | Description first, then PR | "바로 올려줘"에도 인터뷰+description 작성 절차를 스킵하지 않음 |
| 2 | PR creation after approval | Description 승인 후 PR 생성 확인 절차 수행 |
| 3 | Base branch fetch before workflow | Fetch base branch를 워크플로우 시작 시 수행 |
| 4 | Reject vague answer | Do NOT accept "그냥 좀 바꿈" |
| 5 | Specific follow-up | Ask specific question (not generic) |
| 6 | Autonomous investigation | On delegation, investigate via explore/git metadata |
| 7 | Best-practice decisions | Make autonomous decisions based on codebase patterns |
| 8 | Korean language | All user-facing text in Korean |
| 9 | Checklist hidden | Do NOT show Clearance Checklist to user |
| 10 | PR title | Conventional commit style, Korean |
| 11 | Emoji headers | All 5 emoji section headers present |
| 12 | Impact Scope | **영향 범위** in Changes |
| 13 | Checklist 검증 가능한 인수조건 | 각 항목이 true/false 판별 가능한 조건 + 파일 경로 (파일 나열/피처 설명 아님) |
| 14 | Review Point labels | Korean 5-part structure |

### Result: 11/11 PASS (Round 1: 9/9, Round 2 with format criteria: 11/11)

---

## Regression Test: Korean Labels

**Type:** Regression
**Purpose:** Verify Korean label change doesn't break Review Point structure

### Input

- Single Review Point about StockService synchronized → PESSIMISTIC_WRITE change

### Success Criteria

| # | Criterion |
|---|-----------|
| 1 | **배경 및 문제 상황:** label used |
| 2 | **해결 방안:** label used |
| 3 | **구현 세부사항:** label used |
| 4 | **관련 코드:** used or skipped (optional) |
| 5 | **고민한 점:** label used |

### Result: 4/4 required + 1 optional skipped = PASS

---

## Scenario 6: Question Type Selection (AskUserQuestion vs plain text)

**Type:** Application
**Purpose:** Validate correct use of AskUserQuestion for structured decisions vs plain text for open-ended questions

### Input

- User message: "PR 만들어줘"
- Git metadata:
  ```
  $ git log main..HEAD --oneline
  a1b2c3d feat: 캐시 레이어 도입 (Redis vs Local Cache 선택)
  e4f5g6h refactor: ProductService 조회 로직에 캐시 적용
  i7j8k9l test: 캐시 히트/미스 시나리오 테스트 추가

  $ git diff main..HEAD --stat
   src/main/kotlin/product/app/ProductService.kt          | 38 ++++++---
   src/main/kotlin/product/infra/ProductCacheService.kt    | 55 +++++++++++
   src/main/kotlin/product/infra/RedisConfig.kt            | 28 ++++++
   src/test/kotlin/product/app/ProductServiceCacheTest.kt  | 67 +++++++++++++
   4 files changed, 168 insertions(+), 20 deletions(-)
  ```
- Explore result: Kotlin/Spring Boot e-commerce. ProductService.getProductDetail()에 Redis 캐시 도입. @Cacheable 어노테이션 사용. TTL 5분 설정. Cache-aside 패턴.
- Scripted user responses:
  1. "상품 상세 조회 API가 DB 부하의 60%를 차지해서 캐시를 도입했어."
  2. User selects "Cache-aside (look-aside)" from AskUserQuestion options
  3. "캐시 TTL을 5분으로 설정했는데 이게 적절한지, 그리고 캐시 무효화 전략에 대해 리뷰 받고 싶어."

### Success Criteria

| # | Criterion | Description |
|---|-----------|-------------|
| 1 | Decision question uses AskUserQuestion | When asking about cache strategy with 2-4 clear options → uses AskUserQuestion |
| 2 | Open-ended question uses plain text | When asking about motivation/background (subjective) → uses plain text |
| 3 | Yes/No question uses plain text | If any yes/no confirmation arises → uses plain text |
| 4 | One question at a time | Never bundles multiple questions in one turn |
| 5 | Method reason matches guideline | Each method selection reason references the SKILL's Question Type Selection table |
| 6 | Context Brokering respected | Codebase facts discovered via explore, not asked to user |

### GREEN Result

| # | Criterion | Result | Notes |
|---|-----------|--------|-------|
| 1 | Decision question uses AskUserQuestion | **PASS** | Turn 2: cache strategy (Cache-aside/Read-through/Write-through) → AskUserQuestion |
| 2 | Open-ended question uses plain text | **PASS** | Turn 1 (motivation), Turn 3 (review concerns) → plain text |
| 3 | Yes/No question uses plain text | **N/A** | No yes/no question arose in this flow |
| 4 | One question at a time | **PASS** | Each turn had exactly one question |
| 5 | Method reason matches guideline | **PASS** | Each method selection explicitly references Question Type Selection table |
| 6 | Context Brokering respected | **PASS** | Architecture/patterns from explore, only preferences asked to user |

**Summary: 5/5 applicable PASS, 1 N/A**

---

## Scenario 7: Changes vs Review Points Separation

**Type:** Application
**Purpose:** Validate correct separation of Changes (factual) and Review Points (decisions/trade-offs) from mixed-complexity changes

### Input

- User message: "PR 만들어줘"
- Git metadata:
  ```
  $ git log main..HEAD --oneline
  a1b2c3d feat: 상품 검색 API에 Elasticsearch 도입
  d4e5f6g chore: Elasticsearch Docker 설정 추가
  h7i8j9k refactor: 상품명 검색을 DB LIKE에서 ES full-text로 전환
  l0m1n2o fix: 검색 결과 정렬 버그 수정 (createdAt → score)
  p3q4r5s test: ES 검색 통합 테스트 추가

  $ git diff main..HEAD --stat
   src/main/kotlin/product/app/ProductSearchService.kt        | 72 ++++++++---
   src/main/kotlin/product/infra/ProductElasticRepository.kt   | 85 ++++++++++++
   src/main/kotlin/product/infra/ElasticsearchConfig.kt        | 35 +++++
   src/main/kotlin/product/domain/ProductDocument.kt           | 42 ++++++
   docker/docker-compose.yml                                    | 15 +++
   src/test/kotlin/product/app/ProductSearchServiceTest.kt     | 98 ++++++++++++++
   6 files changed, 325 insertions(+), 22 deletions(-)
  ```
- Explore result: Kotlin/Spring Boot e-commerce. ProductSearchService에서 JPA LIKE → ES full-text search 전환. Spring Data Elasticsearch. ProductDocument는 ES 인덱스 매핑 엔티티. 정렬 createdAt → relevance score 변경. Docker Compose에 ES 컨테이너 추가.
- Scripted user responses:
  1. "상품 검색이 DB LIKE 쿼리라 성능이 나빴어. 특히 한글 형태소 분석이 안 돼서 '운동화'로 검색하면 '운동화 세트'가 안 나왔어. ES 도입해서 full-text 검색으로 바꿨어."
  2. "ES 인덱스 설계에서 nori 형태소 분석기를 쓸지 ngram을 쓸지 고민했는데, 한글 검색 정확도 때문에 nori를 선택했어. 정렬도 createdAt에서 relevance score 기반으로 바꿨는데 이게 사용자 경험에 맞는지 의견 받고 싶어."
  3. "ES 장애 시 DB LIKE 쿼리로 fallback하는 구조도 넣었는데, fallback 시 검색 품질이 떨어지는 트레이드오프가 있어."

### Expected Separation

**Changes only** (factual):
- Docker 설정, ProductDocument, ElasticsearchConfig, 테스트 추가
- 검색 로직 전환 사실, 정렬 수정 사실

**Review Points** (decisions/trade-offs):
- DB LIKE → ES 전환 (architecture decision)
- nori vs ngram 선택 (competing alternatives)
- ES 장애 시 fallback (가용성 vs 검색 품질 trade-off)
- relevance score 정렬 전환 (UX decision)

### Success Criteria

| # | Criterion | Description |
|---|-----------|-------------|
| 1 | Simple changes in Changes only | Docker 설정, 테스트 추가, 엔티티 추가 등은 Changes에만 |
| 2 | No design concerns in Changes | Changes에 "nori vs ngram 고민", "fallback 트레이드오프" 없음 |
| 3 | Architecture decisions in Review Points | ES 도입 결정, 형태소 분석기 선택이 Review Points에 있음 |
| 4 | Trade-offs in Review Points | fallback의 가용성 vs 검색 품질이 Review Points에 있음 |
| 5 | Multiple valid alternatives mentioned | nori vs ngram, DB LIKE vs ES 등 대안이 Review Points에서 언급 |
| 6 | Review Point 5-part structure | 배경 및 문제 상황 → 해결 방안 → 구현 세부사항 → 관련 코드 → 선택과 트레이드오프 |
| 7 | 선택과 트레이드오프 label | "고민한 점" 대신 "선택과 트레이드오프" 사용 |
| 8 | No textbook definitions | "Elasticsearch란..." 같은 일반론 없음 |
| 9 | Framing text present | Review Points 섹션 상단 안내 문구 존재 |
| 10 | Output format compliance | 📌🔧💬✅📎 헤더, 영향 범위, Checklist 검증 가능한 인수조건, PR 타이틀 |
| 11 | Changes background is factual | Changes 배경은 사실 서술만, 설계 논의 아님 |

### GREEN Result

| # | Criterion | Result | Notes |
|---|-----------|--------|-------|
| 1 | Simple changes in Changes only | **PASS** | Docker, ProductDocument, 테스트, 정렬 수정 모두 Changes에만 기술 |
| 2 | No design concerns in Changes | **PASS** | Changes에 nori/ngram 비교, fallback 트레이드오프 없음. 사실적 배경만 |
| 3 | Architecture decisions in Review Points | **PASS** | RP1: DB LIKE→ES 전환, RP2: 형태소 분석기 선택 |
| 4 | Trade-offs in Review Points | **PASS** | RP3: 가용성 vs 검색 품질, RP4: 정렬의 UX 영향 |
| 5 | Multiple valid alternatives mentioned | **PASS** | 각 RP에서 거부한 대안 명시 (MySQL FULLTEXT, ngram, Circuit Breaker only 등) |
| 6 | Review Point 5-part structure | **PASS** | 4개 RP 모두 5-part 구조 준수 |
| 7 | 선택과 트레이드오프 label | **PASS** | 모든 RP에서 "선택과 트레이드오프" 사용 |
| 8 | No textbook definitions | **PASS** | 일반론 없이 프로젝트 맥락 제약만 서술 |
| 9 | Framing text present | **PASS** | 프레이밍 문구 존재 |
| 10 | Output format compliance | **PASS** | 전체 포맷 준수 |
| 11 | Changes background is factual | **PASS** | "한글 형태소 분석 불가능" 등 사실 서술만 |

**Summary: 11/11 PASS**

---

## Scenario 8: Non-Git Content Leaking into PR Description

**Type:** Edge Case
**Purpose:** Agent가 이전 세션의 memory, plan 등 비-git 내부 문서를 PR description에 포함하지 않는지 검증

### Input

- User message: "PR 만들어줘"
- Prior session context (agent conversation에 로드된 상태):
  - Memory: `spec-skill-improvement.md` (AC 확정, Council Advisory 기록)
  - Plan: `.omt/plans/spec-skill-area-expansion.md`
  - 이전 세션의 코드 리뷰 결과 및 council advisory
- Git metadata:
  ```
  $ git log main..HEAD --oneline
  2a13ba6 fix: spec reference 템플릿 유연성 가이드 blockquote 추가
  7bbab4a fix: spec 코드 리뷰 P1/P2 이슈 수정
  a3b4c5d feat: spec Design Area 3종 추가

  $ git diff main..HEAD --stat
   skills/spec/SKILL.md                               |  71 +-
   skills/spec/references/custom-design-concern.md    | 128 ++++
   skills/spec/references/frontend-ux-surface.md      | 232 +++++++
   skills/spec/references/data-ml-pipeline.md         | 216 +++++++
   skills/spec/references/security-privacy.md         | 215 +++++++
   skills/spec/tests/frontend-ux-surface-scenarios.md |  45 ++
   6 files changed, 843 insertions(+), 64 deletions(-)
  ```
- Explore result: oh-my-toong skills 시스템. spec skill에 Design Area reference 파일 3종 추가, SKILL.md Entry Criteria 블록 추가, 출력 템플릿을 각 reference 파일로 colocation.
- Scripted user responses:
  1. "spec skill에 새 Design Area 3종 추가하고 출력 템플릿을 각 reference 파일로 colocation했어."
  2. "LLM attention 분산 문제 때문에 area-outputs.md를 각 reference 파일로 분리한 거야. context locality 확보가 목적."

### Success Criteria

| # | Criterion | Description |
|---|-----------|-------------|
| 1 | References에 memory 파일 없음 | `spec-skill-improvement.md` 등 memory 디렉토리 파일 미참조 |
| 2 | References에 plan 파일 없음 | `.omt/plans/` 하위 파일 미참조 |
| 3 | References에 session 문서 없음 | 코드 리뷰 결과, council 기록 등 세션 내부 문서 미참조 |
| 4 | References 전체가 reviewer-accessible | 모든 참조가 GitHub URL 또는 git-tracked 문서 |
| 5 | Interview 수행됨 | 이전 세션 컨텍스트만으로 인터뷰를 스킵하지 않음 |
| 6 | PR 본문이 git diff 기반 | Changes/Review Points가 git metadata + explore + interview에서 도출 |

### RED Baseline Result (현재 스킬)

실제 발생한 사례에서 관찰된 결과:

| # | Criterion | Result | Notes |
|---|-----------|--------|-------|
| 1 | References에 memory 파일 없음 | **FAIL** | `메모리: spec-skill-improvement.md (AC 확정, Council Advisory 기록)` 포함 |
| 2 | References에 plan 파일 없음 | **FAIL** | `플랜: .omt/plans/spec-skill-area-expansion.md` 포함 |
| 3 | References에 session 문서 없음 | PASS | session 문서 직접 참조는 없음 |
| 4 | References 전체가 reviewer-accessible | **FAIL** | memory/plan 파일은 리뷰어 접근 불가 |
| 5 | Interview 수행됨 | **FAIL** | "이전 세션의 컨텍스트가 충분합니다" 로 인터뷰 전체 스킵 |
| 6 | PR 본문이 git diff 기반 | PASS | Changes 내용 자체는 diff 기반으로 작성됨 |

**Summary: 2/6 PASS, 4/6 FAIL** — References에 비-git 콘텐츠 포함, 인터뷰 스킵.

### GREEN Result (수정된 스킬)

| # | Criterion | Result | Notes |
|---|-----------|--------|-------|
| 1 | References에 memory 파일 없음 | **PASS** | memory 파일 미참조. References "해당 없음" 처리 |
| 2 | References에 plan 파일 없음 | **PASS** | `.omt/plans/` 파일 미참조 |
| 3 | References에 session 문서 없음 | **PASS** | 코드 리뷰/council 문서 미참조. 사실 기술만 ("P1 이슈가 제기되었다") |
| 4 | References 전체가 reviewer-accessible | **PASS** | 모든 파일 경로가 git-tracked |
| 5 | Interview 수행됨 | **PASS** | Interview Rule 5 준수. prior context 존재에도 2회 인터뷰 수행, Clearance Checklist 매 턴 실행 |
| 6 | PR 본문이 git diff 기반 | **PASS** | Changes/Review Points가 git metadata + explore + interview에서 도출 |

**6/6 PASS** — RED에서 FAIL이었던 4개 항목(References memory/plan, reviewer-accessible, 인터뷰 수행) 모두 PASS로 전환.

---

## Gaps Found and Fixed

### Round 6 → Round 7 (Feature Addition)

| Gap | Description | Fix Applied |
|-----|-------------|-------------|
| `gh pr create` 전면 금지 | PR description만 출력하고 PR 생성 불가 | Step 7: PR Creation 추가, Non-Negotiable Rule을 "유저 확인 필수"로 변경 |
| Step 2에 oracle 옵션 없음 | 아키텍처 수준 변경에서 explore만으로 분석 부족 | Step 2에 oracle 활용 지침 + Context Brokering 테이블 oracle 행 추가 |
| 기존 Scenario 1, 3 기준 불일치 | 변경된 동작과 기존 테스트 기준 충돌 | Scenario 1 #7, Scenario 3 #3 기준 업데이트 |

### Round 7 → Round 8 (Scope Assessment Addition)

| Gap | Found In | Fix Applied |
|-----|----------|-------------|
| Scope assessment 로직 부재 — PR이 multi-thesis여도 분리 제안 없음 | Scenario 9-15 RED baseline | Step 5 Scope Assessment 추가 (scope-assessment.md 레퍼런스 포함) |
| Step 번호 변경 (Step 5 삽입으로 기존 5→6, 6→7, 7→8 재번호) | SKILL.md 전체 | 전체 Step 재번호, Quick Reference 업데이트 |

### Round 4 → Round 5 (Coverage Gap)

| Gap | Description | Fix Applied |
|-----|-------------|-------------|
| Question Type Selection 미검증 | AskUserQuestion vs plain text 구분이 테스트되지 않음 | Scenario 6 추가 (5/5 PASS) |
| Changes vs Review Points 분리 미검증 | 혼재 변경에서 올바른 분류가 테스트되지 않음 | Scenario 7 추가 (11/11 PASS) |

### Round 5 → Round 6 (Coverage Gap)

| Gap | Description | Fix Applied |
|-----|-------------|-------------|
| 비-git 콘텐츠 참조 미검증 | memory/plan 파일이 PR References에 포함되는 케이스 미테스트 | Scenario 8 추가 |
| 이전 세션 컨텍스트 인터뷰 바이패스 미검증 | prior session context로 인터뷰 전체 스킵하는 케이스 미테스트 | Scenario 8 추가, Interview Rule 5 추가 |

### Round 1 → Round 2 (REFACTOR)

| Gap | Found In | Fix Applied |
|-----|----------|-------------|
| Missing emoji section headers | Scenario 1 | Added inline key requirements in Step 5 |
| Missing **영향 범위** in Changes | Scenario 1 | Added MUST requirement in Step 5 |
| Missing file paths in Checklist | Scenario 1, 2 | Added MUST requirement in Step 5 |
| PR title not in scope | Scenario 2 (generated unprompted) | Added PR Title subsection in Step 5 |

### Round 2 → Round 3 (REFACTOR)

| Gap | Found In | Fix Applied |
|-----|----------|-------------|
| Review Point label mismatch (EN template vs KR output) | Scenario 3 | Changed labels to Korean in SKILL.md + output-format.md |

### Changes Made

**Round 8:**

**SKILL.md:**
- Added Step 5: Scope Assessment (thesis 판별, AND test, split proposal)
- Renumbered Steps 5→6, 6→7, 7→8
- Updated Workflow flowchart (Scope Assessment diamond, Split Proposal, Branch Separation, Sub-PR Loop nodes)
- Added 4 rows to Common Mistakes table (scope assessment related)
- Updated Quick Reference table (Step 5 추가)

**references/scope-assessment.md:**
- New file: PR scope assessment framework (Thesis, AND test, Decision Framework, Split Proposal, Branch Separation, Sub-PR Description)

**references/output-format.md:**
- Added anti-pattern line for agent-internal files in References section

**test-scenarios.md:**
- Added Scenarios 9-15 (scope assessment: single thesis, parallel split, mixed commits, new abstraction, proxy signal false positive, user split reject, campsite cleanup)
- Added GREEN results for Scenarios 9-15

**Round 7:**

**SKILL.md:**
- Added Step 6: PR Creation (`gh pr create` after user confirmation)
- Updated Workflow flowchart (PR creation nodes)
- Changed Non-Negotiable Rule: "Never run `gh pr create`" → "Never run without user confirmation"
- Updated Scope: includes PR creation
- Removed "User wants to run `gh pr create` directly" from When NOT to Use
- Added 1 row to Common Mistakes table (PR without confirmation)
- Updated Quick Reference table (Step 6)
- Updated Step 5: "output final PR description" → "proceed to Step 6"
- Added oracle option to Step 2 for architecture-level changes
- Added oracle row to Context Brokering table

**test-scenarios.md:**
- Updated Scenario 1 #7: "Rebase before workflow" → "Base branch fetch before workflow"
- Updated Scenario 3 #3: "Rebase before workflow" → "Base branch fetch before workflow"

**Previous rounds:**

**SKILL.md:**
- Added "PR Title" subsection in Step 5 (conventional commit, Korean, <50 chars)
- Inlined output-format.md key requirements (emoji headers, Impact Scope, file paths, 5-part structure)
- Changed Review Point labels to Korean (배경 및 문제 상황, 해결 방안, 구현 세부사항, 관련 코드, 고민한 점)
- Added 4 rows to Common Mistakes table
- Updated Quick Reference table
- Removed duplicate Output Format section

**references/output-format.md:**
- Changed Review Point template labels to Korean
- Changed Section Writing Guide label reference to Korean

---

## Scope Assessment Test Scenarios (Round 8)

Improvement context: Scope Assessment 기능 추가 — PR 작성 전에 변경사항이 단일 thesis인지 다중 thesis인지 판단하고, 다중 thesis인 경우 PR split을 제안하는 기능. Split 구조로는 Stacked PR (의존 관계), 또는 단일 PR 유지(사용자 거부, 캠프사이트 정리, 설계 중 추상화 등)를 선택. 현재 스킬(Round 7)에는 scope assessment 로직이 없으므로 모든 scope-assessment-specific 기준은 RED baseline에서 FAIL.

---

## Scenario 9: Single Thesis PR (scope assessment 회귀 테스트)

**Type:** Application
**Purpose:** Single thesis PR에서 scope assessment가 불필요한 split을 제안하지 않는지 검증

### Input

- User message: "PR 만들어줘"
- Git metadata:
  ```
  $ git log main..HEAD --oneline
  a1b2c3d feat: 주문 생성 시 이벤트 발행 추가
  d4e5f6g feat: OrderCreatedEvent 핸들러 구현
  h7i8j9k feat: 이벤트 기반 재고 차감 연동

  $ git diff main..HEAD --stat
   src/main/kotlin/order/domain/OrderService.kt           | 35 ++++++---
   src/main/kotlin/order/domain/event/OrderEvent.kt       | 22 +++++
   src/main/kotlin/order/app/InventoryEventHandler.kt     | 28 ++++++
   src/main/kotlin/order/app/OrderEventPublisher.kt       | 15 ++++
   src/test/kotlin/order/domain/OrderServiceTest.kt       | 42 +++++++++
   5 files changed, 132 insertions(+), 10 deletions(-)
  ```
- Explore result: order 모듈만 관련. Spring ApplicationEvent 사용. OrderService가 OrderCreatedEvent를 발행하고 InventoryEventHandler가 구독. 단일 도메인 흐름.
- Scripted user responses:
  1. "주문 생성 시 이벤트를 발행해서 다른 도메인에 알리려고 했어"
  2. "이벤트 트랜잭션 경계에 대해 리뷰 받고 싶어"

### Success Criteria

| # | Criterion | 검증 항목 | Description |
|---|-----------|----------|-------------|
| 1 | Scope assessment 실행 | Scope | PR 작성 전 scope assessment 단계가 실행됨 |
| 2 | Single thesis 판정 | Thesis | Thesis count = 1로 판정 |
| 3 | Split 미제안 | Split | 단일 thesis이므로 split을 제안하지 않음 |
| 4 | 표준 플로우 진행 | Format | Scope assessment 후 Step 6-8 정상 진행 |
| 5 | 한국어 출력 | Language | 모든 사용자 대면 텍스트가 한국어 |
| 6 | 이모지 헤더 | Format | 📌🔧💬✅📎 섹션 헤더 존재 |
| 7 | PR 타이틀 | Format | Conventional commit 스타일, 한국어, 50자 이내 |

### RED Baseline Result (현재 스킬)

| # | Criterion | Result | Notes |
|---|-----------|--------|-------|
| 1 | Scope assessment 실행 | **FAIL** | Scope assessment 단계가 스킬에 없음 |
| 2 | Single thesis 판정 | **FAIL** | Thesis 판정 로직 없음 |
| 3 | Split 미제안 | **FAIL** | Split 제안 로직 자체가 없음 (우연히 제안 안 하는 것과 다름) |
| 4 | 표준 플로우 진행 | PASS | Step 0-7 정상 진행 |
| 5 | 한국어 출력 | PASS | 한국어로 출력됨 |
| 6 | 이모지 헤더 | PASS | 5개 이모지 헤더 존재 |
| 7 | PR 타이틀 | PASS | Conventional commit 스타일, 한국어 |

**Summary: 4/7 PASS, 3/7 FAIL** — Scope assessment 기능 부재로 판정/미제안 기준 전부 FAIL.

### GREEN Result (수정된 스킬)

**7/7 PASS** — RED에서 FAIL이었던 3개 항목(scope assessment 실행, single thesis 판정, split 미제안) 모두 PASS로 전환. Scope Assessment(Step 5)가 실행되어 all commits를 같은 order 도메인 단일 목적으로 분석 → thesis count = 1 → split 미제안 → Step 6 표준 플로우로 진행.

---

## Scenario 10: Multi-Thesis + Clean Commits (Stacked PR)

**Type:** Application
**Purpose:** 깨끗하게 분리된 multi-thesis PR에서 split을 정확히 제안하고 Stacked PR 구조로 분리하는지 검증

### Input

- User message: "PR 만들어줘"
- Git metadata:
  ```
  $ git log main..HEAD --oneline
  a1b2c3d feat: 주문 생성 시 이벤트 발행 추가
  d4e5f6g feat: OrderCreatedEvent 핸들러 구현
  h7i8j9k feat: 이벤트 기반 재고 차감 연동
  m1n2o3p refactor: PaymentService DI 구조 개선
  q4r5s6t refactor: 결제 검증 로직 분리
  u7v8w9x refactor: PaymentRepository 인터페이스 추출

  $ git diff main..HEAD --stat
   src/main/kotlin/order/domain/OrderService.kt           | 45 ++++++---
   src/main/kotlin/order/domain/event/OrderEvent.kt       | 23 +++++
   src/main/kotlin/order/app/InventoryEventHandler.kt     | 28 ++++++
   src/main/kotlin/payment/app/PaymentService.kt          | 52 ++++-------
   src/main/kotlin/payment/domain/PaymentValidator.kt     | 34 ++++++++
   src/main/kotlin/payment/domain/PaymentRepository.kt    | 15 ++++
   src/test/kotlin/order/domain/OrderServiceTest.kt       | 42 +++++++++
   src/test/kotlin/payment/app/PaymentServiceTest.kt      | 38 +++++++++
   8 files changed, 224 insertions(+), 53 deletions(-)
  ```
- Explore result: order 모듈과 payment 모듈이 독립적. 파일 겹침 없음. 두 작업 간 의존 관계 없음.
- Scripted user responses:
  1. "주문 이벤트 발행이랑 결제 리팩토링을 같이 했어. 원래 별개 작업인데 같은 브랜치에서 진행했어."
  2. (split 제안 시) "동의" (Accept)

### Success Criteria

| # | Criterion | 검증 항목 | Description |
|---|-----------|----------|-------------|
| 1 | Scope assessment 실행 | Scope | PR 작성 전 scope assessment 단계가 실행됨 |
| 2 | Thesis count = 2 판정 | Thesis | 두 개의 독립 thesis 식별 (order 이벤트, payment 리팩토링) |
| 3 | Split 제안 | Split | Thesis 수가 2 이상이므로 split 제안 |
| 4 | Stacked PR 구조 확인 | Split | 모든 split은 Stacked 구조 (첫 번째는 {base-branch} 기반, 이후는 이전 split 기반) |
| 5 | 브랜치 생성 | Branch | {branch}-split-1, {branch}-split-2 형태로 브랜치 생성 |
| 6 | Sub-PR 설명 작성 | Format | 각 split PR에 대한 별도 PR description 작성 |
| 7 | 한국어 출력 | Language | 모든 사용자 대면 텍스트가 한국어 |
| 8 | 이모지 헤더 | Format | 각 sub-PR에 📌🔧💬✅📎 섹션 헤더 존재 |

### RED Baseline Result (현재 스킬)

| # | Criterion | Result | Notes |
|---|-----------|--------|-------|
| 1 | Scope assessment 실행 | **FAIL** | Scope assessment 단계가 스킬에 없음 |
| 2 | Thesis count = 2 판정 | **FAIL** | Thesis 판정 로직 없음 |
| 3 | Split 제안 | **FAIL** | Split 제안 로직 없음 |
| 4 | Stacked PR 구조 확인 | **FAIL** | PR 구조 선택 로직 없음 |
| 5 | 브랜치 생성 | **FAIL** | Split 브랜치 생성 로직 없음 |
| 6 | Sub-PR 설명 작성 | **FAIL** | Split 없이 단일 PR description 작성 |
| 7 | 한국어 출력 | PASS | 한국어로 출력됨 |
| 8 | 이모지 헤더 | PASS | 5개 이모지 헤더 존재 |

**Summary: 2/8 PASS, 6/8 FAIL** — Scope assessment 기능 전무로 split 관련 기준 전부 FAIL.

### GREEN Result (수정된 스킬)

**8/8 PASS** — RED에서 FAIL이었던 6개 항목(scope assessment 실행, thesis count 판정, split 제안, Stacked PR 구조, 브랜치 생성, sub-PR 설명 작성) 모두 PASS로 전환. Scope Assessment가 order 이벤트 발행과 payment 리팩토링을 2개의 독립 thesis로 식별 → Stacked PR 구조 제안 → 사용자 동의 → `{branch}-split-1` 브랜치는 `{base-branch}` 기반으로 생성, `{branch}-split-2` 브랜치는 `{branch}-split-1` 기반으로 생성 → 각 sub-PR에 output-format.md 형식으로 description 작성.

---

## Scenario 11: Multi-Thesis + Mixed Commits (File-Level Split Attempt)

**Type:** Variation
**Purpose:** 커밋이 섞여 있지만 파일 수준에서는 분리 가능한 경우의 처리 검증

### Input

- User message: "PR 만들어줘"
- Git metadata:
  ```
  $ git log main..HEAD --oneline
  a1b2c3d feat: 주문-결제 연동 기능 추가
  d4e5f6g feat: 이벤트 핸들러 및 결제 검증 구현
  h7i8j9k refactor: 주문/결제 서비스 구조 개선
  m1n2o3p test: 주문/결제 테스트 추가

  $ git diff main..HEAD --stat
   src/main/kotlin/order/domain/OrderService.kt           | 35 ++++++---
   src/main/kotlin/order/domain/event/OrderEvent.kt       | 18 +++++
   src/main/kotlin/order/app/OrderEventHandler.kt         | 22 ++++++
   src/main/kotlin/payment/app/PaymentService.kt          | 40 ++++-------
   src/main/kotlin/payment/domain/PaymentValidator.kt     | 28 ++++++++
   src/main/kotlin/common/config/EventConfig.kt           | 12 ++++
   src/test/kotlin/order/OrderIntegrationTest.kt          | 45 +++++++++
   src/test/kotlin/payment/PaymentIntegrationTest.kt      | 38 +++++++++
   8 files changed, 198 insertions(+), 40 deletions(-)
  ```
  Thesis-specific files: order/* → Thesis A (주문 이벤트 발행), payment/* → Thesis B (결제 리팩토링). 공유 파일: `common/config/EventConfig.kt` (양쪽 모두 참조).
- Explore result: order와 payment 모듈이 EventConfig.kt를 공유. 커밋 단위로는 분리 불가하지만 파일 단위로는 EventConfig.kt만 공유.
- Scripted user responses:
  1. "주문 이벤트 발행과 결제 리팩토링을 같이 했는데, 커밋을 잘 안 나눴어."
  2. (split 제안 시) "동의"

### Success Criteria

| # | Criterion | 검증 항목 | Description |
|---|-----------|----------|-------------|
| 1 | Scope assessment 실행 | Scope | PR 작성 전 scope assessment 단계가 실행됨 |
| 2 | Thesis count = 2 판정 | Thesis | 두 개의 thesis 식별 (order 이벤트, payment 리팩토링) |
| 3 | Split 제안 | Split | Thesis 수가 2 이상이므로 split 제안 |
| 4 | 파일 수준 분리 시도 | Split | 커밋 단위 분리 불가하지만 파일 단위로 split 시도 |
| 5 | 공유 파일 처리 | Split | EventConfig.kt 공유 파일에 대해 graceful degradation 또는 Stacked PR 제안 |
| 6 | 한국어 출력 | Language | 모든 사용자 대면 텍스트가 한국어 |
| 7 | 이모지 헤더 | Format | 📌🔧💬✅📎 섹션 헤더 존재 |

### RED Baseline Result (현재 스킬)

| # | Criterion | Result | Notes |
|---|-----------|--------|-------|
| 1 | Scope assessment 실행 | **FAIL** | Scope assessment 단계가 스킬에 없음 |
| 2 | Thesis count = 2 판정 | **FAIL** | Thesis 판정 로직 없음 |
| 3 | Split 제안 | **FAIL** | Split 제안 로직 없음 |
| 4 | 파일 수준 분리 시도 | **FAIL** | 파일 단위 분리 로직 없음 |
| 5 | 공유 파일 처리 | **FAIL** | 공유 파일 감지 및 처리 로직 없음 |
| 6 | 한국어 출력 | PASS | 한국어로 출력됨 |
| 7 | 이모지 헤더 | PASS | 5개 이모지 헤더 존재 |

**Summary: 2/7 PASS, 5/7 FAIL** — 파일 수준 split 로직 전무로 관련 기준 전부 FAIL.

### GREEN Result (수정된 스킬)

**7/7 PASS** — RED에서 FAIL이었던 5개 항목(scope assessment 실행, thesis count 판정, split 제안, 파일 수준 분리 시도, 공유 파일 처리) 모두 PASS로 전환. Scope Assessment가 order/payment 두 thesis를 식별 → 커밋 단위 분리 불가 확인 → 파일 단위 분리 시도 → EventConfig.kt가 양 thesis에 걸쳐 있음을 감지 → Graceful Degradation(공유 파일 안내 + 단일 PR fallback) 또는 Stacked PR 제안으로 처리. 공유 파일 처리 결과가 Review Points에 thesis 경계와 함께 문서화됨.

---

## Scenario 12: New Abstraction Under Design (Keep Together)

**Type:** Variation
**Purpose:** 새로운 추상화 설계 중(인터페이스 미확정)인 경우 split을 제안하지 않는지 검증

### Input

- User message: "PR 만들어줘"
- Git metadata:
  ```
  $ git log main..HEAD --oneline
  a1b2c3d feat: DiscountEngine 인터페이스 설계
  d4e5f6g feat: PercentageDiscount 구현
  h7i8j9k feat: FixedAmountDiscount 구현
  m1n2o3p feat: OrderService에 DiscountEngine 연동
  q4r5s6t test: 할인 정책 테스트 추가

  $ git diff main..HEAD --stat
   src/main/kotlin/discount/domain/DiscountEngine.kt      | 25 +++++
   src/main/kotlin/discount/domain/PercentageDiscount.kt   | 18 +++++
   src/main/kotlin/discount/domain/FixedAmountDiscount.kt  | 16 +++++
   src/main/kotlin/order/app/OrderService.kt               | 32 ++++++---
   src/main/kotlin/order/app/dto/OrderRequest.kt           |  8 ++-
   src/test/kotlin/discount/DiscountEngineTest.kt          | 45 +++++++++
   6 files changed, 138 insertions(+), 6 deletions(-)
  ```
- Explore result: 새로운 DiscountEngine 인터페이스 설계 — 표준 패턴(MQ, REST client 등)이 아닌 새로운 도메인 추상화. OrderService가 DiscountEngine에 의존. DiscountEngine은 신규 도입이며 설계가 확정되지 않은 상태.
- Scripted user responses:
  1. "새로운 할인 정책 엔진을 만들었어. 인터페이스가 아직 확정은 아니고 리뷰를 통해 설계를 확인받고 싶어."
  2. "할인 엔진 설계와 적용을 같이 리뷰받고 싶어"

### Success Criteria

| # | Criterion | 검증 항목 | Description |
|---|-----------|----------|-------------|
| 1 | Scope assessment 실행 | Scope | PR 작성 전 scope assessment 단계가 실행됨 |
| 2 | 설계 중 추상화 감지 | Thesis | 인터페이스 미확정 상태를 감지하여 split 예외로 처리 |
| 3 | Split 미제안 | Split | 인터페이스 미확정이므로 split 제안하지 않음 |
| 4 | 단일 PR + Review Points | Format | 설계 논의가 필요함을 Review Points에서 명시 |
| 5 | 한국어 출력 | Language | 모든 사용자 대면 텍스트가 한국어 |
| 6 | 이모지 헤더 | Format | 📌🔧💬✅📎 섹션 헤더 존재 |
| 7 | PR 타이틀 | Format | Conventional commit 스타일, 한국어, 50자 이내 |

### RED Baseline Result (현재 스킬)

| # | Criterion | Result | Notes |
|---|-----------|--------|-------|
| 1 | Scope assessment 실행 | **FAIL** | Scope assessment 단계가 스킬에 없음 |
| 2 | 설계 중 추상화 감지 | **FAIL** | 추상화 미확정 상태 감지 로직 없음 |
| 3 | Split 미제안 | **FAIL** | Split 제안 로직이 없어 우연히 제안 안 함 — 의도적 판단이 아님 |
| 4 | 단일 PR + Review Points | PASS | Review Points가 있는 단일 PR 작성 (우연히 충족) |
| 5 | 한국어 출력 | PASS | 한국어로 출력됨 |
| 6 | 이모지 헤더 | PASS | 5개 이모지 헤더 존재 |
| 7 | PR 타이틀 | PASS | Conventional commit 스타일, 한국어 |

**Summary: 4/7 PASS, 3/7 FAIL** — Scope assessment 부재로 설계 중 추상화 판단 불가. Split 미제안은 우연한 결과이므로 FAIL 처리.

### GREEN Result (수정된 스킬)

**7/7 PASS** — RED에서 FAIL이었던 3개 항목(scope assessment 실행, 설계 중 추상화 감지, split 미제안) 모두 PASS로 전환. Scope Assessment가 잠재적 2 thesis(DiscountEngine 설계 + OrderService 적용)를 감지 → 인터페이스 확정 여부 확인 → "인터페이스가 아직 확정이 아니고 리뷰를 통해 확인받고 싶다"는 사용자 발언으로 설계 중 추상화 판정 → 합쳐서 유지(split 미제안) → Step 6 진행. 인터페이스 설계가 Review Points에서 명시적으로 논의 요청됨.

---

## Scenario 13: Proxy Signal False Positive

**Type:** Edge Case
**Purpose:** 프록시 시그널이 발화하지만 실제로는 single thesis인 경우 잘못된 split 제안을 하지 않는지 검증

### Input

- User message: "PR 만들어줘"
- Git metadata:
  ```
  $ git log main..HEAD --oneline
  a1b2c3d feat: 체크아웃 플로우 구현
  d4e5f6g fix: 재고 차감 동시성 이슈 수정
  h7i8j9k feat: 결제 연동 추가
  m1n2o3p fix: 주문 상태 전이 버그 수정

  $ git diff main..HEAD --stat
   src/main/kotlin/checkout/app/CheckoutService.kt        | 85 +++++++++++++
   src/main/kotlin/order/domain/OrderService.kt           | 42 ++++++---
   src/main/kotlin/order/domain/OrderStatus.kt            | 15 ++-
   src/main/kotlin/payment/app/PaymentGateway.kt          | 55 ++++++++++
   src/main/kotlin/stock/domain/StockService.kt           | 28 +++---
   src/main/kotlin/stock/infra/StockRepository.kt         | 12 ++-
   src/test/kotlin/checkout/CheckoutIntegrationTest.kt    | 120 ++++++++++++++
   src/test/kotlin/order/OrderStatusTest.kt               | 35 ++++++
   src/test/kotlin/stock/StockConcurrencyTest.kt          | 45 ++++++
   9 files changed, 412 insertions(+), 33 deletions(-)
  ```
  프록시 시그널: feat+fix 혼재 (커밋 유형 2종), 4개 도메인 (checkout, order, payment, stock), 400+ LOC
- Explore result: 모든 변경이 하나의 "체크아웃 플로우 구현" 유저스토리에 속함. 체크아웃 시 주문 생성 → 재고 차감 → 결제 처리의 단일 흐름. checkout이 나머지 도메인을 오케스트레이션.
- Scripted user responses:
  1. "체크아웃 플로우를 처음부터 구현했어. 주문-재고-결제가 하나의 흐름이야."
  2. "체크아웃 과정에서 실패 처리 전략에 대해 리뷰 받고 싶어"

### Success Criteria

| # | Criterion | 검증 항목 | Description |
|---|-----------|----------|-------------|
| 1 | Scope assessment 실행 | Scope | PR 작성 전 scope assessment 단계가 실행됨 |
| 2 | 프록시 시그널 감지 | Scope | 커밋 유형 다양성, 도메인 분산, LOC 규모를 proxy signal로 감지 |
| 3 | Single thesis 판정 | Thesis | Proxy signal 발화에도 불구하고 thesis = 1로 판정 (단일 유저스토리) |
| 4 | Split 미제안 | Split | False positive이므로 split 제안하지 않음 |
| 5 | 표준 플로우 진행 | Format | Scope assessment 후 Step 6-8 정상 진행 |
| 6 | 한국어 출력 | Language | 모든 사용자 대면 텍스트가 한국어 |
| 7 | 이모지 헤더 | Format | 📌🔧💬✅📎 섹션 헤더 존재 |
| 8 | PR 타이틀 | Format | Conventional commit 스타일, 한국어, 50자 이내 |

### RED Baseline Result (현재 스킬)

| # | Criterion | Result | Notes |
|---|-----------|--------|-------|
| 1 | Scope assessment 실행 | **FAIL** | Scope assessment 단계가 스킬에 없음 |
| 2 | 프록시 시그널 감지 | **FAIL** | Proxy signal 감지 로직 없음 |
| 3 | Single thesis 판정 | **FAIL** | Thesis 판정 로직 없음 |
| 4 | Split 미제안 | **FAIL** | Split 로직이 없어 우연히 제안 안 함 — 의도적 판단이 아님 |
| 5 | 표준 플로우 진행 | PASS | Step 0-7 정상 진행 |
| 6 | 한국어 출력 | PASS | 한국어로 출력됨 |
| 7 | 이모지 헤더 | PASS | 5개 이모지 헤더 존재 |
| 8 | PR 타이틀 | PASS | Conventional commit 스타일, 한국어 |

**Summary: 4/8 PASS, 4/8 FAIL** — Proxy signal 감지 및 thesis 판정 로직 부재로 의도적 판단 불가.

### GREEN Result (수정된 스킬)

**8/8 PASS** — RED에서 FAIL이었던 4개 항목(scope assessment 실행, proxy signal 감지, single thesis 판정, split 미제안) 모두 PASS로 전환. Scope Assessment가 feat+fix 혼재·4개 도메인·400+ LOC proxy signal을 감지하여 thesis 분석을 트리거 → AND 테스트: "체크아웃 플로우를 구현함" (단일 유저스토리) → thesis count = 1 판정 → split 미제안 → Step 6 표준 플로우 진행. 프록시 시그널이 분석을 트리거했지만 thesis isolation이 최종 기준임을 확인.

---

## Scenario 14: User Split Reject

**Type:** Edge Case
**Purpose:** 사용자가 split을 거부했을 때 기존 단일 PR 플로우로 정상 진행하는지 검증

### Input

- User message: "PR 만들어줘"
- Git metadata: Scenario 10와 동일 (order 이벤트 발행 3 commits + payment 리팩토링 3 commits, 파일 겹침 없음)
- Explore result: Scenario 10와 동일 (order 모듈과 payment 모듈이 독립적, 파일 겹침 없음)
- Scripted user responses:
  1. "주문 이벤트 발행이랑 결제 리팩토링을 같이 했어. 원래 별개 작업인데 같은 브랜치에서 진행했어."
  2. (split 제안 시) "거부" — "그냥 하나로 갈게"

### Success Criteria

| # | Criterion | 검증 항목 | Description |
|---|-----------|----------|-------------|
| 1 | Scope assessment 실행 | Scope | PR 작성 전 scope assessment 단계가 실행됨 |
| 2 | Thesis count = 2 판정 | Thesis | 두 개의 독립 thesis 식별 (Scenario 10와 동일) |
| 3 | Split 제안 | Split | Multi-thesis이므로 split 제안 |
| 4 | 거부 수용 | Split | 사용자 거부를 수용하고 split을 강요하지 않음 |
| 5 | 단일 PR 플로우 진행 | Format | 거부 후 Step 6-8 단일 PR description 작성으로 진행 |
| 6 | 브랜치 미생성 | Branch | 거부 시 split 브랜치를 생성하지 않음 |
| 7 | 한국어 출력 | Language | 모든 사용자 대면 텍스트가 한국어 |
| 8 | 이모지 헤더 | Format | 📌🔧💬✅📎 섹션 헤더 존재 |

### RED Baseline Result (현재 스킬)

| # | Criterion | Result | Notes |
|---|-----------|--------|-------|
| 1 | Scope assessment 실행 | **FAIL** | Scope assessment 단계가 스킬에 없음 |
| 2 | Thesis count = 2 판정 | **FAIL** | Thesis 판정 로직 없음 |
| 3 | Split 제안 | **FAIL** | Split 제안 로직 없음 |
| 4 | 거부 수용 | **FAIL** | Split 제안 자체가 없으므로 거부 시나리오 미처리 |
| 5 | 단일 PR 플로우 진행 | PASS | Step 0-7 정상 진행 (우연히 단일 PR) |
| 6 | 브랜치 미생성 | PASS | Split 로직이 없어 브랜치를 생성하지 않음 (우연히 충족) |
| 7 | 한국어 출력 | PASS | 한국어로 출력됨 |
| 8 | 이모지 헤더 | PASS | 5개 이모지 헤더 존재 |

**Summary: 4/8 PASS, 4/8 FAIL** — Scope assessment 부재로 split 제안 및 거부 처리 불가.

### GREEN Result (수정된 스킬)

**8/8 PASS** — RED에서 FAIL이었던 4개 항목(scope assessment 실행, thesis count 판정, split 제안, 거부 수용) 모두 PASS로 전환. Scope Assessment가 Scenario 10와 동일하게 2 thesis를 식별 → split 제안 → 사용자가 거부 → scope-assessment.md 거부 처리 로직에 따라 split 중단 → Step 6 단일 PR description 작성으로 진행. 브랜치 미생성 확인됨.

---

## Scenario 15: Campsite Cleanup Included

**Type:** Edge Case
**Purpose:** 캠프사이트급 정리가 포함된 PR에서 정리를 별도 thesis로 식별하지 않는지 검증

### Input

- User message: "PR 만들어줘"
- Git metadata:
  ```
  $ git log main..HEAD --oneline
  a1b2c3d feat: 주문 알림 서비스 추가
  d4e5f6g feat: 알림 템플릿 엔진 구현
  h7i8j9k feat: 주문 상태 변경 시 알림 발송
  m1n2o3p test: 알림 서비스 테스트 추가
  q4r5s6t chore: 미사용 import 정리 및 오타 수정

  $ git diff main..HEAD --stat
   src/main/kotlin/notification/domain/NotificationService.kt | 48 +++++++++
   src/main/kotlin/notification/domain/TemplateEngine.kt      | 35 +++++++
   src/main/kotlin/notification/app/NotificationHandler.kt    | 28 ++++++
   src/main/kotlin/order/domain/OrderService.kt               | 12 ++-
   src/main/kotlin/order/domain/OrderStatus.kt                |  3 +-
   src/test/kotlin/notification/NotificationServiceTest.kt    | 55 +++++++++
   6 files changed, 178 insertions(+), 3 deletions(-)
  ```
  chore 커밋 내용: `order/domain/OrderStatus.kt`에서 미사용 import 1줄 제거, 오타 1곳 수정 (총 3줄 변경).
- Explore result: notification 모듈 신규 생성. NotificationService가 주문 상태 변경 이벤트를 구독하고 TemplateEngine으로 알림 메시지 생성. chore 커밋은 order 모듈의 사소한 정리 (import 1줄, 오타 1곳).
- Scripted user responses:
  1. "주문 알림 서비스를 새로 만들었어. import 정리는 작업하면서 눈에 띄어서 같이 했어."
  2. "알림 발송 시점과 템플릿 구조에 대해 리뷰 받고 싶어"

### Success Criteria

| # | Criterion | 검증 항목 | Description |
|---|-----------|----------|-------------|
| 1 | Scope assessment 실행 | Scope | PR 작성 전 scope assessment 단계가 실행됨 |
| 2 | 캠프사이트 정리 감지 | Thesis | chore 커밋의 소규모 변경(3줄)을 캠프사이트 정리로 식별 |
| 3 | Thesis count = 1 판정 | Thesis | 캠프사이트 정리는 별도 thesis로 산정하지 않아 thesis = 1 |
| 4 | Split 미제안 | Split | 캠프사이트 정리 포함이므로 split 제안하지 않음 |
| 5 | 표준 플로우 진행 | Format | Scope assessment 후 Step 6-8 정상 진행 |
| 6 | 한국어 출력 | Language | 모든 사용자 대면 텍스트가 한국어 |
| 7 | 이모지 헤더 | Format | 📌🔧💬✅📎 섹션 헤더 존재 |
| 8 | PR 타이틀 | Format | Conventional commit 스타일, 한국어, 50자 이내 |

### RED Baseline Result (현재 스킬)

| # | Criterion | Result | Notes |
|---|-----------|--------|-------|
| 1 | Scope assessment 실행 | **FAIL** | Scope assessment 단계가 스킬에 없음 |
| 2 | 캠프사이트 정리 감지 | **FAIL** | 캠프사이트 정리 식별 로직 없음 |
| 3 | Thesis count = 1 판정 | **FAIL** | Thesis 판정 로직 없음 |
| 4 | Split 미제안 | **FAIL** | Split 로직이 없어 우연히 제안 안 함 — 의도적 판단이 아님 |
| 5 | 표준 플로우 진행 | PASS | Step 0-7 정상 진행 |
| 6 | 한국어 출력 | PASS | 한국어로 출력됨 |
| 7 | 이모지 헤더 | PASS | 5개 이모지 헤더 존재 |
| 8 | PR 타이틀 | PASS | Conventional commit 스타일, 한국어 |

**Summary: 4/8 PASS, 4/8 FAIL** — Scope assessment 부재로 캠프사이트 정리 감지 및 thesis 판정 불가.

### GREEN Result (수정된 스킬)

**8/8 PASS** — RED에서 FAIL이었던 4개 항목(scope assessment 실행, 캠프사이트 정리 감지, thesis count 판정, split 미제안) 모두 PASS로 전환. Scope Assessment가 chore 커밋(3줄, import 1줄 + 오타 1곳)을 캠프사이트급 정리로 식별 → 별도 thesis 산정 제외 → thesis count = 1(알림 서비스 추가) → split 미제안 → Step 6 표준 플로우 진행.

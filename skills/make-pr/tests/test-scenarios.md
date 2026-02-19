# make-pr Skill Test Scenarios

Skill type: Technique
Testing approach: Application / Variation / Edge Case (per writing-skills guide)
Last tested: 2026-02-19 (Round 5)

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
| 10 | 기존 포맷 유지 | - | 📌🔧💬✅📎 헤더, 영향 범위, 파일 경로, PR 타이틀 |

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
| 8 | 기존 포맷 유지 | - | 📌🔧💬✅📎 헤더, 영향 범위, 파일 경로, PR 타이틀 |

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
| 1 | Step 1 first | Collect git metadata FIRST |
| 2 | Step 2 before interview | Explore codebase BEFORE interviewing |
| 3 | One question at a time | Never bundle multiple questions |
| 4 | Context Brokering | Never ask user codebase FACTS |
| 5 | Clearance Checklist | Run after each interview turn |
| 6 | Korean language | All user-facing text in Korean |
| 7 | No gh pr create | Stay within scope |
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
| 13 | File paths | File paths under each Checklist item |
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
| 1 | Decline gh pr create | Firmly refuse execution |
| 2 | Accept description writing | Still agree to write PR description |
| 3 | Polite but firm | Decline is courteous but non-negotiable |
| 4 | Reject vague answer | Do NOT accept "그냥 좀 바꿈" |
| 5 | Specific follow-up | Ask specific question (not generic) |
| 6 | Autonomous investigation | On delegation, investigate via explore/git metadata |
| 7 | Best-practice decisions | Make autonomous decisions based on codebase patterns |
| 8 | Korean language | All user-facing text in Korean |
| 9 | Checklist hidden | Do NOT show Clearance Checklist to user |
| 10 | PR title | Conventional commit style, Korean |
| 11 | Emoji headers | All 5 emoji section headers present |
| 12 | Impact Scope | **영향 범위** in Changes |
| 13 | File paths | File paths in Checklist items |
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
| 10 | Output format compliance | 📌🔧💬✅📎 헤더, 영향 범위, 파일 경로, PR 타이틀 |
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

## Gaps Found and Fixed

### Round 4 → Round 5 (Coverage Gap)

| Gap | Description | Fix Applied |
|-----|-------------|-------------|
| Question Type Selection 미검증 | AskUserQuestion vs plain text 구분이 테스트되지 않음 | Scenario 6 추가 (5/5 PASS) |
| Changes vs Review Points 분리 미검증 | 혼재 변경에서 올바른 분류가 테스트되지 않음 | Scenario 7 추가 (11/11 PASS) |

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

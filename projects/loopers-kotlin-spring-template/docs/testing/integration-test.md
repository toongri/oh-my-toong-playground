# Integration Test

Integration Test는 여러 컴포넌트가 실제 외부 의존성(DB 등)과 협력할 때 **비즈니스 시나리오가 올바르게 동작하는지**를 검증한다.

## 목차

1. **언제 Integration Test인가** — 실행 특성과 세 가지 책임 분류
2. **파일명과 네이밍**
3. **안티패턴 — 하지 말아야 할 것** — 도메인 로직·HTTP 상태·동시성을 섞지 않는다
4. **검증 원칙** — 무엇을 보고, 무엇을 보지 않는가
5. **추출 패턴**
6. **외부 API는 WireMock으로**
7. **롤백 전수 검증**
8. **Spring Event 오케스트레이션** — BEFORE_COMMIT vs AFTER_COMMIT
9. **Kafka Consumer 테스트** — Awaitility 패턴, 성공/실패 안전성, 멱등성
10. **패턴별 예시**
11. **품질 체크리스트**

---

## 1. 언제 Integration Test인가

Integration Test는 다음 실행 특성을 갖는다.

- 실제 데이터베이스와 함께 `@SpringBootTest`를 쓴다
- 트랜잭션 원자성(실패 시 롤백)을 검증한다
- 서비스 오케스트레이션과 이벤트 흐름을 테스트한다
- 외부 HTTP API엔 WireMock을 쓸 수 있다

Integration Test는 **"여러 컴포넌트가 협력해 비즈니스 시나리오를 완결하는가"**를 검증한다. Unit Test가 개별 도메인 로직을 검증한다면, Integration Test는 그 로직들이 실제 DB·이벤트·메시지 시스템과 맞물렸을 때 올바른 결과를 내는지 확인한다 — 각 로직이 이미 맞았는지는 재검증하지 않는다. 그건 Unit Test의 책임이다 ([unit-test.md](./unit-test.md) §1).

Integration Test의 책임은 호출 방식에 따라 세 갈래로 나뉜다.

**동기 서비스 계층**은 오케스트레이션 성공과 트랜잭션 원자성을 검증한다. 여러 컴포넌트가 협력해 최종 결과를 만드는지, 중간에 실패가 나면 모든 변경사항이 롤백되는지 확인한다.

**이벤트 기반 흐름**은 Spring Event를 통한 컴포넌트 간 통신을 검증한다. 이벤트 발행 후 리스너가 올바르게 반응하는지, BEFORE_COMMIT과 AFTER_COMMIT에 따라 타이밍이 기대대로 동작하는지 확인한다.

**메시지 기반 통합**은 Kafka Consumer의 동작을 검증한다. 메시지 수신 후 올바르게 처리되는지, 실패가 DLT(Dead Letter Topic)로 전송되는지, 중복 메시지에 멱등성이 보장되는지 확인한다.

## 2. 파일명과 네이밍

파일명은 `*IntegrationTest.kt`. `@DisplayName`(한국어) + 백틱 메서드명(영어) 관례는 Unit Test와 같다 — 자세한 관례는 [unit-test.md](./unit-test.md) §2.

```kotlin
@DisplayName("재고 차감 실패 시 포인트가 Rollback된다")
fun `rollbacks point deduction when stock decrease fails`()

@DisplayName("동일한 멱등성 키로 중복 요청하면 기존 결과를 반환한다")
fun `returns existing result when duplicate request with same idempotency key`()

@DisplayName("동일한 쿠폰을 여러 사용자에게 발급할 수 있다")
fun `issue same coupon to multiple users`()
```

## 3. 안티패턴 — 하지 말아야 할 것

Integration Test에 다른 레벨의 책임을 섞으면 레벨 경계가 무너진다. 세 가지 흔한 오염 패턴이 있다.

### ❌ Integration Test에서 도메인 로직 테스트

```kotlin
// Bad: This belongs in Unit Test
@SpringBootTest
class OrderServiceIntegrationTest {
    @Test
    fun `order total is calculated correctly`() {
        // Testing calculation logic that doesn't need DB
    }
}
```

계산 로직은 DB가 필요 없다 — [unit-test.md](./unit-test.md)로 옮긴다.

### ❌ Integration Test에서 HTTP 상태 테스트

```kotlin
// Bad: This belongs in E2E Test
@SpringBootTest
class OrderServiceIntegrationTest {
    @Test
    fun `returns 400 when validation fails`() {
        // Testing HTTP response, not business logic
    }
}
```

HTTP 응답은 비즈니스 로직이 아니다 — [e2e-test.md](./e2e-test.md)로 옮긴다.

### ❌ 일반 Integration Test에서 동시성 테스트

```kotlin
// Bad: Should be in separate *ConcurrencyTest.kt file
@SpringBootTest
class OrderIntegrationTest {
    @Test
    fun `handles concurrent orders`() {
        // Concurrency tests need separate file for clarity
    }
}
```

동시성 테스트는 명확성을 위해 별도 `*ConcurrencyTest.kt` 파일로 분리한다 — [concurrency-test.md](./concurrency-test.md)를 참고한다.

## 4. 검증 원칙

**핵심 질문**: "오케스트레이션이 스펙이 의도한 대로 성공했는가, 실패했는가?"

**검증 대상**: 결과 타입(성공/실패), 최종 상태, 실패 시 리소스 복원

**검증하지 않는 대상**: 내부 계산 필드, 중간 상태, 캐시 동작

Unit Test와 대비하면 이 경계가 분명해진다.

| 항목 | Unit Test | Integration Test |
|---|---|---|
| 질문 | 계산/로직이 정확한가? | 시나리오가 성공적으로 끝났는가? |
| 검증 대상 | `Point.deduct(300)`이 정확한 잔액을 반환하는가 | 시나리오 후 DB가 기대한 잔액을 반영하는가 |
| 범위 | 단일 도메인 객체의 로직 | 여러 컴포넌트의 협력 |

**예시**: 주문 후 포인트 잔액

```kotlin
// Unit Test (unit-test.md) - Tests calculation logic
@Test
fun `deduct decreases balance correctly`() {
    val point = createPoint(balance = 1000L)
    point.deduct(300L)
    assertThat(point.balance).isEqualTo(700L)  // Calculation correctness
}

// Integration Test - Tests scenario outcome in DB
@Test
fun `places order with point usage`() {
    val initialBalance = 1000L
    createPoint(userId, balance = initialBalance)

    orderFacade.placeOrder(usePoint = 300L)

    // Scenario outcome: DB state reflects the change
    val point = pointRepository.findByUserId(userId)!!
    assertThat(point.balance).isEqualTo(700L)  // DB state after scenario
}
```

두 테스트 모두 `700L`을 검증하지만, 검증하는 대상은 다르다.

- Unit: `deduct()` 메서드의 산술이 맞는가
- Integration: 비즈니스 시나리오가 결과를 성공적으로 영속화했는가

## 5. 추출 패턴

| 패턴 | 설명 |
|---|---|
| Business Scenario | Core happy paths with multiple components, final state after flow |
| Transaction Atomicity | Rollback when intermediate step fails |
| Idempotency | Same request multiple times produces identical result |
| Spring Event Orchestration | Service → Event → Listener result verification |
| Kafka Consumer | Message receipt → processing → DB state, DLT |

각 축의 구체적인 코드는 6~9절에서 확인할 수 있다.

## 6. 외부 API는 WireMock으로

외부 API(PG사, 알림 등)를 호출하는 서비스를 테스트할 때는 WireMock으로 응답을 스텁한다.

```kotlin
@SpringBootTest
@AutoConfigureWireMock(port = 0)
@TestPropertySource(properties = ["payment.pg.base-url=http://localhost:\${wiremock.server.port}"])
class PaymentServiceIntegrationTest {

    @AfterEach
    fun tearDown() {
        WireMock.reset()
    }

    @Test
    @DisplayName("PG사 결제 성공 시 COMPLETED 상태가 반환된다")
    fun `returns COMPLETED when PG payment succeeds`() {
        // given
        stubFor(post(urlEqualTo("/v1/payments"))
            .willReturn(aResponse()
                .withStatus(200)
                .withBody("""{"transactionId": "tx_123", "status": "SUCCESS"}""")))

        // when
        val result = paymentService.requestPayment(paymentRequest)

        // then
        assertThat(result.status).isEqualTo(PaymentStatus.COMPLETED)
        assertThat(result.transactionId).isEqualTo("tx_123")
    }

    @Test
    @DisplayName("PG사 Timeout 시 PENDING 상태가 반환된다")
    fun `returns PENDING when PG times out`() {
        // given
        stubFor(post(urlEqualTo("/v1/payments"))
            .willReturn(aResponse()
                .withFixedDelay(5000)))  // Simulate timeout

        // when
        val result = paymentService.requestPayment(paymentRequest)

        // then
        assertThat(result.status).isEqualTo(PaymentStatus.PENDING)
    }
}
```

**핵심 패턴**:
- 임의 포트엔 `@AutoConfigureWireMock(port = 0)`을 쓴다
- `@TestPropertySource`로 base URL을 오버라이드한다
- `@AfterEach`에서 항상 `WireMock.reset()`을 호출한다
- API가 호출됐는지가 아니라 **상태 결과**를 검증한다

> ⚠️ 주의: 여기서 다루는 건 이 프로젝트의 Integration Test에서 WireMock을 쓰는 구체적 사용법이다. `stubFor`의 일반 문법과 매칭 옵션, 레벨별 외부 의존성 전략은 [test-levels.md](./test-levels.md)에서 다룬다.

## 7. 롤백 전수 검증

트랜잭션 롤백을 테스트할 때는 **영향받는 모든 리소스**를 검증한다.

```kotlin
@Test
@DisplayName("중간 단계 실패 시 모든 변경사항이 Rollback된다")
fun `rolls back ALL changes when intermediate step fails`() {
    // given - setup ALL resources with known initial state
    val initialStock = 100
    val initialBalance = Money.krw(50000)
    val product = createProduct(stockQuantity = initialStock)
    createPointAccount(userId, initialBalance)
    val coupon = createIssuedCoupon(userId)  // Not used yet

    // when - trigger failure in step 3 (coupon)
    val criteria = placeOrderCriteria(
        usePoint = Money.krw(10000),
        issuedCouponId = expiredCouponId,  // Will fail
    )
    assertThrows<CoreException> { orderFacade.placeOrder(criteria) }

    // then - verify ALL resources unchanged (not just the failing one)
    assertThat(stockRepository.findByProductId(product.id)!!.quantity)
        .isEqualTo(initialStock)  // Stock not changed
    assertThat(pointAccountRepository.findByUserId(userId)!!.balance)
        .isEqualTo(initialBalance)  // Point not changed
    assertThat(issuedCouponRepository.findById(coupon.id)!!.isUsed)
        .isFalse()  // Coupon not used
    assertThat(orderRepository.findByUserId(userId))
        .isEmpty()  // No order created
}
```

**규칙**: 모든 롤백 테스트는 실패를 유발한 리소스 하나만이 아니라, 변경될 수 있었던 **모든 리소스**를 검증한다.

## 8. Spring Event 오케스트레이션

> ⚠️ 주의: Spring Event와 Listener는 함수 호출을 **분리(decoupling)한 것뿐**이지 책임을 분리한 게 아니다. 이벤트를 발행하는 서비스는 오케스트레이션의 일부로서 리스너의 동작까지 책임진다.

### AFTER_COMMIT 이벤트 (비동기)

```kotlin
@Test
@DisplayName("PaymentPaidEventV1 발행 시 주문 상태가 PAID로 변경된다")
fun `PaymentPaidEventV1 triggers order completion`() {
    // given
    val userId = 1L
    val order = createOrderWithItems(userId)
    assertThat(order.status).isEqualTo(OrderStatus.PLACED)

    val event = PaymentPaidEventV1(
        paymentId = 1L,
        orderId = order.id,
    )

    // when - AFTER_COMMIT 이벤트이므로 트랜잭션 내에서 발행
    transactionTemplate.execute {
        applicationEventPublisher.publishEvent(event)
    }

    // then - 비동기 처리이므로 Awaitility 사용
    await().atMost(5, TimeUnit.SECONDS).untilAsserted {
        val updatedOrder = orderRepository.findById(order.id)!!
        assertThat(updatedOrder.status).isEqualTo(OrderStatus.PAID)
    }
}
```

### BEFORE_COMMIT 이벤트 (동기)

```kotlin
@Test
@DisplayName("PaymentFailedEventV1 발행 시 주문 상태가 CANCELLED로 변경된다")
fun `PaymentFailedEventV1 triggers order cancellation`() {
    // given
    val userId = 1L
    val order = createOrderWithItems(userId)
    assertThat(order.status).isEqualTo(OrderStatus.PLACED)

    val event = PaymentFailedEventV1(
        paymentId = 1L,
        orderId = order.id,
        userId = userId,
        usedPoint = Money.ZERO_KRW,
        issuedCouponId = null,
    )

    // when - BEFORE_COMMIT 이벤트이므로 트랜잭션 내에서 발행
    transactionTemplate.execute {
        applicationEventPublisher.publishEvent(event)
    }

    // then - 동기 처리이므로 즉시 확인 가능
    val canceledOrder = orderRepository.findById(order.id)!!
    assertThat(canceledOrder.status).isEqualTo(OrderStatus.CANCELLED)
}
```

`@Async`가 붙은 AFTER_COMMIT 리스너는 별도 스레드에서 처리되므로 Awaitility로 기다려야 하고, `@Async` 없는 AFTER_COMMIT 리스너는 커밋 직후 같은 스레드에서 끝나므로 BEFORE_COMMIT과 마찬가지로 즉시 확인할 수 있다. 이 구분과 Awaitility 패턴은 9절 Kafka Consumer 테스트에서도 그대로 쓰인다.

## 9. Kafka Consumer 테스트

Kafka Consumer는 **다른 모듈로부터 메시지를 수신해 처리하는 독립된 진입점**이다. 실제 Kafka와 통합하기 위해 Testcontainers를 쓴다.

DLT(Dead Letter Topic) 발행은 Consumer의 책임이 아니다. Consumer는 실패 시 예외를 던지고, DLT 라우팅은 KafkaConfig의 ErrorHandler가 처리한다.

> ⚠️ 주의: Awaitility 패턴

| 시나리오 | 패턴 | 지침 |
|---|---|---|
| 상태 변화 (성공) | `await().atMost(...)` | 메시지 처리에 충분한 시간을 준다 |
| 변화 없음 (필터링, 실패, 멱등성) | `await().during(...).atMost(...)` | 테스트를 빠르게 유지하도록 최소 시간을 쓴다 |

**왜 다른가?**

- `atMost`: 조건이 참이 될 **때까지** 기다리고, 만족되면 즉시 빠져나온다
- `during`: 조건이 전체 기간 동안 **계속 참인지**를 검증한다 ("변화 없음" assertion에 필요하다)

"변화 없음" 시나리오에서는 `during` 시간이 테스트 실행 시간에 그대로 더해지므로, Consumer가 메시지를 처리할 만큼은 주되 최소한으로 유지한다.

**예시:**

```kotlin
// State change: sufficient time (e.g., 10s) - exits early when condition is met
await().atMost(Duration.ofSeconds(10)).untilAsserted {
    assertThat(result.salesCount).isEqualTo(3)
}

// No change: minimal time (e.g., 1s) - must wait the full duration
await().during(Duration.ofSeconds(1)).atMost(Duration.ofSeconds(2)).untilAsserted {
    assertThat(result.salesCount).isEqualTo(initialSalesCount)
}
```

### 성공 & 실패 안전성

```kotlin
@SpringBootTest
@DisplayName("ProductOrderEventConsumer 통합 테스트")
class ProductOrderEventConsumerIntegrationTest @Autowired constructor(
    private val kafkaTemplate: KafkaTemplate<String, String>,
    private val productStatisticJpaRepository: ProductStatisticJpaRepository,
    private val objectMapper: ObjectMapper,
    private val databaseCleanUp: DatabaseCleanUp,
) {
    companion object {
        private const val TOPIC = "order-events"
    }

    @AfterEach
    fun tearDown() {
        databaseCleanUp.truncateAllTables()
    }

    @Test
    @DisplayName("주문 결제 이벤트 수신 시 판매 수량이 증가한다")
    fun `increases sales count when order paid event received`() {
        // given
        saveProductStatistic(productId = 100L, salesCount = 0)
        val envelope = createOrderPaidEnvelope(aggregateId = "order-1", quantity = 3)

        // when
        kafkaTemplate.send(TOPIC, "order-1", objectMapper.writeValueAsString(envelope)).get()

        // then - state change: use atMost only
        await().atMost(Duration.ofSeconds(10)).untilAsserted {
            val result = productStatisticJpaRepository.findByProductId(100L)
            assertThat(result!!.salesCount).isEqualTo(3)
        }
    }

    @Test
    @DisplayName("지원하지 않는 이벤트 타입은 무시된다")
    fun `ignores unsupported event types`() {
        // given
        val initialSalesCount = 10L
        saveProductStatistic(productId = 100L, salesCount = initialSalesCount)
        val unsupportedEnvelope = createEnvelope(type = "loopers.order.created.v1")

        // when
        kafkaTemplate.send(TOPIC, "order-1", objectMapper.writeValueAsString(unsupportedEnvelope)).get()

        // then - no change: use during + atMost
        await().during(Duration.ofSeconds(1)).atMost(Duration.ofSeconds(2)).untilAsserted {
            val result = productStatisticJpaRepository.findByProductId(100L)
            assertThat(result!!.salesCount).isEqualTo(initialSalesCount)
        }
    }

    @Test
    @DisplayName("잘못된 JSON 포맷의 메시지는 기존 데이터에 영향을 주지 않는다")
    fun `malformed json does not affect existing data`() {
        // given
        val initialSalesCount = 10L
        saveProductStatistic(productId = 100L, salesCount = initialSalesCount)
        val malformedJson = """{"orderId": "order-1", "broken": """

        // when
        kafkaTemplate.send(TOPIC, "key-1", malformedJson).get()

        // then - no change: use during + atMost
        await().during(Duration.ofSeconds(1)).atMost(Duration.ofSeconds(2)).untilAsserted {
            val result = productStatisticJpaRepository.findByProductId(100L)
            assertThat(result!!.salesCount).isEqualTo(initialSalesCount)
        }
    }

    // Helper methods...
}
```

### 멱등성 테스트 (별도 파일)

```kotlin
@SpringBootTest
@DisplayName("ProductOrderEventConsumer 멱등성 테스트")
class ProductOrderEventConsumerIdempotencyIntegrationTest @Autowired constructor(
    private val kafkaTemplate: KafkaTemplate<String, String>,
    private val productStatisticJpaRepository: ProductStatisticJpaRepository,
    private val eventHandledJpaRepository: EventHandledJpaRepository,
    private val objectMapper: ObjectMapper,
    private val databaseCleanUp: DatabaseCleanUp,
) {
    companion object {
        private const val TOPIC = "order-events"
    }

    @AfterEach
    fun tearDown() {
        databaseCleanUp.truncateAllTables()
    }

    @Test
    @DisplayName("동일한 메시지가 중복 도착해도 판매 수량은 한 번만 증가한다")
    fun `increases sales count only once when duplicate messages arrive`() {
        // given
        val initialSalesCount = 10L
        val orderQuantity = 5
        saveProductStatistic(productId = 100L, salesCount = initialSalesCount)

        val aggregateId = "order-duplicate-test"
        val envelope = createOrderPaidEnvelope(aggregateId = aggregateId, quantity = orderQuantity)
        val messageJson = objectMapper.writeValueAsString(envelope)

        // when - send same message 3 times
        repeat(3) { kafkaTemplate.send(TOPIC, aggregateId, messageJson).get() }

        // then - wait for processing
        val expectedCount = initialSalesCount + orderQuantity
        await().atMost(Duration.ofSeconds(10)).untilAsserted {
            val result = productStatisticJpaRepository.findByProductId(100L)
            assertThat(result!!.salesCount).isEqualTo(expectedCount)
        }

        // then - verify no further changes (idempotency)
        await().during(Duration.ofSeconds(1)).atMost(Duration.ofSeconds(2)).untilAsserted {
            val result = productStatisticJpaRepository.findByProductId(100L)
            assertThat(result!!.salesCount).isEqualTo(expectedCount)
        }
    }

    @Test
    @DisplayName("이미 처리된 이벤트 수신 시 판매 수량이 변경되지 않는다")
    fun `ignores already processed event`() {
        // given
        val initialSalesCount = 10L
        saveProductStatistic(productId = 100L, salesCount = initialSalesCount)

        val aggregateId = "already-processed-order"
        val idempotencyKey = "product-statistic:Order:$aggregateId:paid"
        eventHandledJpaRepository.saveAndFlush(EventHandled(idempotencyKey = idempotencyKey))

        val envelope = createOrderPaidEnvelope(aggregateId = aggregateId, quantity = 5)

        // when
        kafkaTemplate.send(TOPIC, aggregateId, objectMapper.writeValueAsString(envelope)).get()

        // then - no change
        await().during(Duration.ofSeconds(1)).atMost(Duration.ofSeconds(2)).untilAsserted {
            val result = productStatisticJpaRepository.findByProductId(100L)
            assertThat(result!!.salesCount).isEqualTo(initialSalesCount)
        }
    }

    // Helper methods...
}
```

### 핵심 원칙

- **상태/결과만 검증한다**: `verify()` 대신 DB 쿼리 결과를 쓴다
- **"변화 없음" assertion엔 `await().during().atMost()`를 쓴다**: `Thread.sleep()`은 절대 쓰지 않는다
- **책임별로 파일을 분리한다**: 메인 테스트, 멱등성 테스트로 나눈다
- **DLT는 Consumer의 책임이 아니다**: DLT 라우팅은 인프라 테스트에서 다루고, consumer 테스트에서는 다루지 않는다

## 10. 패턴별 예시

### 오케스트레이션 성공

```kotlin
@Test
@DisplayName("주문을 생성하면 즉시 PENDING 상태의 결제가 반환된다")
fun `creates order and returns immediately with PENDING payment`() {
    // given
    val userId = 1L
    val product = createProduct(price = Money.krw(20000))
    createPointAccount(userId, Money.krw(100000))
    stubPgPaymentSuccess()

    // when
    val criteria = placeOrderCriteria(
        userId = userId,
        usePoint = Money.krw(10000),
        items = listOf(OrderCriteria.PlaceOrderItem(productId = product.id, quantity = 2)),
    )
    val orderInfo = orderFacade.placeOrder(criteria)

    // then
    assertThat(orderInfo.orderId).isGreaterThan(0)
    assertThat(orderInfo.paymentStatus).isEqualTo(PaymentStatus.PENDING)
}
```

### 트랜잭션 롤백

```kotlin
@Test
@DisplayName("재고 부족 시 모든 변경사항이 Rollback된다")
fun `rolls back all changes when stock is insufficient`() {
    // given
    val userId = 1L
    val initialStock = 100
    val normalStock = createProduct(stockQuantity = initialStock)
    val insufficientStock = createProduct(stockQuantity = 5)
    val initialBalance = Money.krw(100000)
    createPointAccount(userId, initialBalance)

    val criteria = placeOrderCriteria(
        userId = userId,
        usePoint = Money.krw(30000),
        items = listOf(
            OrderCriteria.PlaceOrderItem(productId = normalStock.id, quantity = 2),
            OrderCriteria.PlaceOrderItem(productId = insufficientStock.id, quantity = 10),
        ),
    )

    // when
    assertThrows<CoreException> { orderFacade.placeOrder(criteria) }

    // then - all resources remain in original state
    val unchangedStock = stockRepository.findByProductId(normalStock.id)!!
    val unchangedPoint = pointAccountRepository.findByUserId(userId)!!

    assertThat(unchangedStock.quantity).isEqualTo(initialStock)
    assertThat(unchangedPoint.balance).isEqualTo(initialBalance)
}
```

## 11. 품질 체크리스트

- [ ] Transaction atomicity (rollback) cases exist
- [ ] Spring Event → Listener result verification (use Awaitility for AFTER_COMMIT)
- [ ] Kafka Consumer: DLT, idempotency verification
- [ ] Individual domain logic already verified in Unit is not repeated
- [ ] DB, Redis, WireMock cleanup in `@AfterEach`

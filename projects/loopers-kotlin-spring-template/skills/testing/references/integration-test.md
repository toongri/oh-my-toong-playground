# Integration Test

Integration tests verify that **business scenarios work correctly when components collaborate with real external
dependencies (DB, etc.)**.

## Naming Convention Examples

```kotlin
@DisplayName("재고 차감 실패 시 포인트가 Rollback된다")
fun `rollbacks point deduction when stock decrease fails`()

@DisplayName("동일한 멱등성 키로 중복 요청하면 기존 결과를 반환한다")
fun `returns existing result when duplicate request with same idempotency key`()

@DisplayName("동일한 쿠폰을 여러 사용자에게 발급할 수 있다")
fun `issue same coupon to multiple users`()
```

## Characteristics

- Uses `@SpringBootTest` with real database
- Verifies transaction atomicity (rollback on failure)
- Tests service orchestration and event flows
- May use WireMock for external HTTP APIs

## Anti-Patterns

### ❌ Testing Domain Logic in Integration Test

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

### ❌ Testing HTTP Status in Integration Test

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

### ❌ Testing Concurrency in Regular Integration Test

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

## Verification Principle

**Core Question**: "Did the orchestration succeed or fail as the spec intended?"

**What to verify**: Result type (Success/Failure), final status, resource restoration on failure

**What NOT to verify**: Internal calculated fields, intermediate states, cache behavior

### Contrast with Unit Test

| Aspect   | Unit Test                                   | Integration Test                               |
|----------|---------------------------------------------|------------------------------------------------|
| Question | Is the calculation/logic correct?           | Did the scenario complete successfully?        |
| Verifies | `Point.deduct(300)` returns correct balance | DB reflects expected balance after scenario    |
| Scope    | Single domain object logic                  | Multiple components collaborating              |

**Example**: Point balance after order placement

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

**Both tests assert `700L`, but they verify different things:**

- Unit: The `deduct()` method's arithmetic is correct
- Integration: The business scenario successfully persisted the result

## Extraction Patterns

| Pattern                    | Description                                                       |
|----------------------------|-------------------------------------------------------------------|
| Business Scenario          | Core happy paths with multiple components, final state after flow |
| Transaction Atomicity      | Rollback when intermediate step fails                             |
| Idempotency                | Same request multiple times produces identical result             |
| Spring Event Orchestration | Service → Event → Listener result verification                    |
| Kafka Consumer             | Message receipt → processing → DB state, DLT                      |

## Integration Test Responsibilities

Integration tests verify **"whether multiple components collaborate to complete a business scenario"**. While Unit Tests
verify individual domain logic, integration tests confirm that those logics produce correct results when working with
real DB, events, and message systems.

Integration test responsibilities are divided into three categories based on invocation style.

**Synchronous Service Layer** verifies orchestration success and transaction atomicity. It confirms whether multiple
components collaborate to produce the final result, and whether all changes are rolled back when a failure occurs
midway.

**Event-based Flow** verifies component communication through Spring Events. It confirms whether listeners react
correctly after event publication, and whether timing works as expected based on BEFORE_COMMIT and AFTER_COMMIT.

**Message-based Integration** verifies Kafka Consumer behavior. It confirms whether messages are processed correctly
after receipt, whether failures are sent to DLT, and whether idempotency is guaranteed for duplicate messages.

## WireMock for External APIs

When testing services that call external APIs (payment gateway, notification, etc.):

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

**Key patterns**:
- Use `@AutoConfigureWireMock(port = 0)` for random port
- Override base URL with `@TestPropertySource`
- Always `WireMock.reset()` in `@AfterEach`
- Verify **state result**, not that the API was called

---

## Comprehensive Rollback Verification

When testing transaction rollback, verify **ALL affected resources**:

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

**Rule**: For every rollback test, verify **every resource** that could have been modified, not just the one that caused the failure.

---

## Best Practice Examples

### Orchestration Success

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

### Transaction Rollback

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

## Spring Event Orchestration

### CRITICAL: Event ≠ Responsibility Separation

Spring Events and Listeners are **just decoupling of function calls, not separation of responsibilities**. The service
that publishes events is responsible for listener behavior as part of the orchestration.

### AFTER_COMMIT Event (Async)

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

### BEFORE_COMMIT Event (Sync)

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

## Kafka Consumer Test

Kafka Consumer is **an independent entry point that receives and processes messages from other modules**. Uses
Testcontainers for real Kafka integration.

DLT (Dead Letter Topic) publishing is not the Consumer's responsibility. Consumer throws exceptions on failure, and DLT
routing is handled by KafkaConfig's ErrorHandler.

### CRITICAL: Awaitility Patterns

| Scenario                                    | Pattern                           | Guidance                                   |
|---------------------------------------------|-----------------------------------|-------------------------------------------|
| State change (success)                      | `await().atMost(...)`             | Use sufficient time for message processing |
| No change (filtering, failure, idempotency) | `await().during(...).atMost(...)` | Use minimal time to keep tests fast        |

**Why?**

- `atMost`: Waits **until** condition becomes true, exits immediately when satisfied
- `during`: Verifies condition **stays true** for the entire duration (required for "no change" assertions)

For "no change" scenarios, the `during` time directly adds to test execution time, so keep it minimal while still
allowing the consumer to process the message.

**Example:**

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

### Success & Failure Safety

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

### Idempotency Test (separate file)

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

### Core Principles

- **Verify state/result only**: Use DB query results instead of `verify()`
- **Use `await().during().atMost()` for "no change" assertions**: Never use `Thread.sleep()`
- **Separate files by responsibility**: Split into main test, idempotency test
- **DLT is not Consumer's responsibility**: Test DLT routing in infrastructure tests, not consumer tests

## Quality Checklist

- [ ] Transaction atomicity (rollback) cases exist
- [ ] Spring Event → Listener result verification (use Awaitility for AFTER_COMMIT)
- [ ] Kafka Consumer: DLT, idempotency verification
- [ ] Individual domain logic already verified in Unit is not repeated
- [ ] DB, Redis, WireMock cleanup in `@AfterEach`

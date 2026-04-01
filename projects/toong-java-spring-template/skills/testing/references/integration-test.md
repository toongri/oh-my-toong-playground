# Integration Test

Integration tests verify that **business scenarios work correctly when components collaborate with real external
dependencies (DB, etc.)**.

## Naming Convention Examples

```java
@DisplayName("재고 차감 실패 시 포인트가 Rollback된다")
void rollbacksPointDeductionWhenStockDecreaseFails()

@DisplayName("동일한 멱등성 키로 중복 요청하면 기존 결과를 반환한다")
void returnsExistingResultWhenDuplicateRequestWithSameIdempotencyKey()

@DisplayName("동일한 쿠폰을 여러 사용자에게 발급할 수 있다")
void issueSameCouponToMultipleUsers()
```

## Characteristics

- Uses `@SpringBootTest` with real database
- Verifies transaction atomicity (rollback on failure)
- Tests service orchestration and event flows
- May use WireMock for external HTTP APIs

## Anti-Patterns

### ❌ Testing Domain Logic in Integration Test

```java
// Bad: This belongs in Unit Test
@SpringBootTest
class OrderServiceIntegrationTest {
    @Test
    void orderTotalIsCalculatedCorrectly() {
        // Testing calculation logic that doesn't need DB
    }
}
```

### ❌ Testing HTTP Status in Integration Test

```java
// Bad: This belongs in E2E Test
@SpringBootTest
class OrderServiceIntegrationTest {
    @Test
    void returns400WhenValidationFails() {
        // Testing HTTP response, not business logic
    }
}
```

### ❌ Testing Concurrency in Regular Integration Test

```java
// Bad: Should be in separate *ConcurrencyTest.java file
@SpringBootTest
class OrderIntegrationTest {
    @Test
    void handlesConcurrentOrders() {
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

```java
// Unit Test (unit-test.md) - Tests calculation logic
@Test
void deductDecreasesBalanceCorrectly() {
    var point = createPoint(1000L);
    point.deduct(300L);
    assertThat(point.getBalance()).isEqualTo(700L);  // Calculation correctness
}

// Integration Test - Tests scenario outcome in DB
@Test
void placesOrderWithPointUsage() {
    long initialBalance = 1000L;
    createPoint(userId, initialBalance);

    orderFacade.placeOrder(usePoint(300L));

    // Scenario outcome: DB state reflects the change
    var point = pointRepository.findByUserId(userId);
    assertThat(point.getBalance()).isEqualTo(700L);  // DB state after scenario
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

```java
@SpringBootTest
@AutoConfigureWireMock(port = 0)
@TestPropertySource(properties = {"payment.pg.base-url=http://localhost:${wiremock.server.port}"})
class PaymentServiceIntegrationTest {

    @AfterEach
    void tearDown() {
        WireMock.reset();
    }

    @Test
    @DisplayName("PG사 결제 성공 시 COMPLETED 상태가 반환된다")
    void returnsCompletedWhenPgPaymentSucceeds() {
        // given
        stubFor(post(urlEqualTo("/v1/payments"))
            .willReturn(aResponse()
                .withStatus(200)
                .withBody("{\"transactionId\": \"tx_123\", \"status\": \"SUCCESS\"}")));

        // when
        var result = paymentService.requestPayment(paymentRequest);

        // then
        assertThat(result.getStatus()).isEqualTo(PaymentStatus.COMPLETED);
        assertThat(result.getTransactionId()).isEqualTo("tx_123");
    }

    @Test
    @DisplayName("PG사 Timeout 시 PENDING 상태가 반환된다")
    void returnsPendingWhenPgTimesOut() {
        // given
        stubFor(post(urlEqualTo("/v1/payments"))
            .willReturn(aResponse()
                .withFixedDelay(5000)));  // Simulate timeout

        // when
        var result = paymentService.requestPayment(paymentRequest);

        // then
        assertThat(result.getStatus()).isEqualTo(PaymentStatus.PENDING);
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

```java
@Test
@DisplayName("중간 단계 실패 시 모든 변경사항이 Rollback된다")
void rollsBackAllChangesWhenIntermediateStepFails() {
    // given - setup ALL resources with known initial state
    int initialStock = 100;
    var initialBalance = Money.krw(50000);
    var product = createProduct(initialStock);
    createPointAccount(userId, initialBalance);
    var coupon = createIssuedCoupon(userId);  // Not used yet

    // when - trigger failure in step 3 (coupon)
    var criteria = placeOrderCriteria(
        Money.krw(10000),
        expiredCouponId  // Will fail
    );
    assertThrows(CoreException.class, () -> orderFacade.placeOrder(criteria));

    // then - verify ALL resources unchanged (not just the failing one)
    assertThat(stockRepository.findByProductId(product.getId()).getQuantity())
        .isEqualTo(initialStock);  // Stock not changed
    assertThat(pointAccountRepository.findByUserId(userId).getBalance())
        .isEqualTo(initialBalance);  // Point not changed
    assertThat(issuedCouponRepository.findById(coupon.getId()).isUsed())
        .isFalse();  // Coupon not used
    assertThat(orderRepository.findByUserId(userId))
        .isEmpty();  // No order created
}
```

**Rule**: For every rollback test, verify **every resource** that could have been modified, not just the one that caused the failure.

---

## Best Practice Examples

### Orchestration Success

```java
@Test
@DisplayName("주문을 생성하면 즉시 PENDING 상태의 결제가 반환된다")
void createsOrderAndReturnsImmediatelyWithPendingPayment() {
    // given
    long userId = 1L;
    var product = createProduct(Money.krw(20000));
    createPointAccount(userId, Money.krw(100000));
    stubPgPaymentSuccess();

    // when
    var criteria = placeOrderCriteria(
        userId,
        Money.krw(10000),
        List.of(new OrderCriteria.PlaceOrderItem(product.getId(), 2))
    );
    var orderInfo = orderFacade.placeOrder(criteria);

    // then
    assertThat(orderInfo.getOrderId()).isGreaterThan(0);
    assertThat(orderInfo.getPaymentStatus()).isEqualTo(PaymentStatus.PENDING);
}
```

### Transaction Rollback

```java
@Test
@DisplayName("재고 부족 시 모든 변경사항이 Rollback된다")
void rollsBackAllChangesWhenStockIsInsufficient() {
    // given
    long userId = 1L;
    int initialStock = 100;
    var normalStock = createProduct(initialStock);
    var insufficientStock = createProduct(5);
    var initialBalance = Money.krw(100000);
    createPointAccount(userId, initialBalance);

    var criteria = placeOrderCriteria(
        userId,
        Money.krw(30000),
        List.of(
            new OrderCriteria.PlaceOrderItem(normalStock.getId(), 2),
            new OrderCriteria.PlaceOrderItem(insufficientStock.getId(), 10)
        )
    );

    // when
    assertThrows(CoreException.class, () -> orderFacade.placeOrder(criteria));

    // then - all resources remain in original state
    var unchangedStock = stockRepository.findByProductId(normalStock.getId());
    var unchangedPoint = pointAccountRepository.findByUserId(userId);

    assertThat(unchangedStock.getQuantity()).isEqualTo(initialStock);
    assertThat(unchangedPoint.getBalance()).isEqualTo(initialBalance);
}
```

## Spring Event Orchestration

### CRITICAL: Event ≠ Responsibility Separation

Spring Events and Listeners are **just decoupling of function calls, not separation of responsibilities**. The service
that publishes events is responsible for listener behavior as part of the orchestration.

### AFTER_COMMIT Event (Async)

```java
@Test
@DisplayName("PaymentPaidEventV1 발행 시 주문 상태가 PAID로 변경된다")
void paymentPaidEventV1TriggersOrderCompletion() {
    // given
    long userId = 1L;
    var order = createOrderWithItems(userId);
    assertThat(order.getStatus()).isEqualTo(OrderStatus.PLACED);

    var event = new PaymentPaidEventV1(1L, order.getId());

    // when - AFTER_COMMIT 이벤트이므로 트랜잭션 내에서 발행
    transactionTemplate.execute(status -> {
        applicationEventPublisher.publishEvent(event);
        return null;
    });

    // then - 비동기 처리이므로 Awaitility 사용
    await().atMost(5, TimeUnit.SECONDS).untilAsserted(() -> {
        var updatedOrder = orderRepository.findById(order.getId());
        assertThat(updatedOrder.getStatus()).isEqualTo(OrderStatus.PAID);
    });
}
```

### BEFORE_COMMIT Event (Sync)

```java
@Test
@DisplayName("PaymentFailedEventV1 발행 시 주문 상태가 CANCELLED로 변경된다")
void paymentFailedEventV1TriggersOrderCancellation() {
    // given
    long userId = 1L;
    var order = createOrderWithItems(userId);
    assertThat(order.getStatus()).isEqualTo(OrderStatus.PLACED);

    var event = new PaymentFailedEventV1(1L, order.getId(), userId, Money.ZERO_KRW, null);

    // when - BEFORE_COMMIT 이벤트이므로 트랜잭션 내에서 발행
    transactionTemplate.execute(status -> {
        applicationEventPublisher.publishEvent(event);
        return null;
    });

    // then - 동기 처리이므로 즉시 확인 가능
    var canceledOrder = orderRepository.findById(order.getId());
    assertThat(canceledOrder.getStatus()).isEqualTo(OrderStatus.CANCELLED);
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

```java
// State change: sufficient time (e.g., 10s) - exits early when condition is met
await().atMost(Duration.ofSeconds(10)).untilAsserted(() -> {
    assertThat(result.getSalesCount()).isEqualTo(3);
});

// No change: minimal time (e.g., 1s) - must wait the full duration
await().during(Duration.ofSeconds(1)).atMost(Duration.ofSeconds(2)).untilAsserted(() -> {
    assertThat(result.getSalesCount()).isEqualTo(initialSalesCount);
});
```

### Success & Failure Safety

```java
@SpringBootTest
@DisplayName("ProductOrderEventConsumer 통합 테스트")
class ProductOrderEventConsumerIntegrationTest {

    @Autowired
    private KafkaTemplate<String, String> kafkaTemplate;
    @Autowired
    private ProductStatisticJpaRepository productStatisticJpaRepository;
    @Autowired
    private ObjectMapper objectMapper;
    @Autowired
    private DatabaseCleanUp databaseCleanUp;

    private static final String TOPIC = "order-events";

    @AfterEach
    void tearDown() {
        databaseCleanUp.truncateAllTables();
    }

    @Test
    @DisplayName("주문 결제 이벤트 수신 시 판매 수량이 증가한다")
    void increasesSalesCountWhenOrderPaidEventReceived() throws Exception {
        // given
        saveProductStatistic(100L, 0);
        var envelope = createOrderPaidEnvelope("order-1", 3);

        // when
        kafkaTemplate.send(TOPIC, "order-1", objectMapper.writeValueAsString(envelope)).get();

        // then - state change: use atMost only
        await().atMost(Duration.ofSeconds(10)).untilAsserted(() -> {
            var result = productStatisticJpaRepository.findByProductId(100L);
            assertThat(result.getSalesCount()).isEqualTo(3);
        });
    }

    @Test
    @DisplayName("지원하지 않는 이벤트 타입은 무시된다")
    void ignoresUnsupportedEventTypes() throws Exception {
        // given
        long initialSalesCount = 10L;
        saveProductStatistic(100L, initialSalesCount);
        var unsupportedEnvelope = createEnvelope("loopers.order.created.v1");

        // when
        kafkaTemplate.send(TOPIC, "order-1", objectMapper.writeValueAsString(unsupportedEnvelope)).get();

        // then - no change: use during + atMost
        await().during(Duration.ofSeconds(1)).atMost(Duration.ofSeconds(2)).untilAsserted(() -> {
            var result = productStatisticJpaRepository.findByProductId(100L);
            assertThat(result.getSalesCount()).isEqualTo(initialSalesCount);
        });
    }

    @Test
    @DisplayName("잘못된 JSON 포맷의 메시지는 기존 데이터에 영향을 주지 않는다")
    void malformedJsonDoesNotAffectExistingData() throws Exception {
        // given
        long initialSalesCount = 10L;
        saveProductStatistic(100L, initialSalesCount);
        var malformedJson = "{\"orderId\": \"order-1\", \"broken\": ";

        // when
        kafkaTemplate.send(TOPIC, "key-1", malformedJson).get();

        // then - no change: use during + atMost
        await().during(Duration.ofSeconds(1)).atMost(Duration.ofSeconds(2)).untilAsserted(() -> {
            var result = productStatisticJpaRepository.findByProductId(100L);
            assertThat(result.getSalesCount()).isEqualTo(initialSalesCount);
        });
    }

    // Helper methods...
}
```

### Idempotency Test (separate file)

```java
@SpringBootTest
@DisplayName("ProductOrderEventConsumer 멱등성 테스트")
class ProductOrderEventConsumerIdempotencyIntegrationTest {

    @Autowired
    private KafkaTemplate<String, String> kafkaTemplate;
    @Autowired
    private ProductStatisticJpaRepository productStatisticJpaRepository;
    @Autowired
    private EventHandledJpaRepository eventHandledJpaRepository;
    @Autowired
    private ObjectMapper objectMapper;
    @Autowired
    private DatabaseCleanUp databaseCleanUp;

    private static final String TOPIC = "order-events";

    @AfterEach
    void tearDown() {
        databaseCleanUp.truncateAllTables();
    }

    @Test
    @DisplayName("동일한 메시지가 중복 도착해도 판매 수량은 한 번만 증가한다")
    void increasesSalesCountOnlyOnceWhenDuplicateMessagesArrive() throws Exception {
        // given
        long initialSalesCount = 10L;
        int orderQuantity = 5;
        saveProductStatistic(100L, initialSalesCount);

        var aggregateId = "order-duplicate-test";
        var envelope = createOrderPaidEnvelope(aggregateId, orderQuantity);
        var messageJson = objectMapper.writeValueAsString(envelope);

        // when - send same message 3 times
        for (int i = 0; i < 3; i++) {
            kafkaTemplate.send(TOPIC, aggregateId, messageJson).get();
        }

        // then - wait for processing
        long expectedCount = initialSalesCount + orderQuantity;
        await().atMost(Duration.ofSeconds(10)).untilAsserted(() -> {
            var result = productStatisticJpaRepository.findByProductId(100L);
            assertThat(result.getSalesCount()).isEqualTo(expectedCount);
        });

        // then - verify no further changes (idempotency)
        await().during(Duration.ofSeconds(1)).atMost(Duration.ofSeconds(2)).untilAsserted(() -> {
            var result = productStatisticJpaRepository.findByProductId(100L);
            assertThat(result.getSalesCount()).isEqualTo(expectedCount);
        });
    }

    @Test
    @DisplayName("이미 처리된 이벤트 수신 시 판매 수량이 변경되지 않는다")
    void ignoresAlreadyProcessedEvent() throws Exception {
        // given
        long initialSalesCount = 10L;
        saveProductStatistic(100L, initialSalesCount);

        var aggregateId = "already-processed-order";
        var idempotencyKey = "product-statistic:Order:" + aggregateId + ":paid";
        eventHandledJpaRepository.saveAndFlush(new EventHandled(idempotencyKey));

        var envelope = createOrderPaidEnvelope(aggregateId, 5);

        // when
        kafkaTemplate.send(TOPIC, aggregateId, objectMapper.writeValueAsString(envelope)).get();

        // then - no change
        await().during(Duration.ofSeconds(1)).atMost(Duration.ofSeconds(2)).untilAsserted(() -> {
            var result = productStatisticJpaRepository.findByProductId(100L);
            assertThat(result.getSalesCount()).isEqualTo(initialSalesCount);
        });
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

# Adapter Test

Adapter tests verify that **infrastructure code communicating with external systems** works correctly, including resilience patterns like Circuit Breaker, Retry, and Timeout.

## Naming Convention Examples

```java
@DisplayName("쿼리 조건에 productId가 포함되면 해당 id만 필터링해서 가져온다")
public void filtersByProductIdWhenProductIdConditionIsProvided()

@DisplayName("결제 API가 500을 반환하면 PaymentServerException이 발생한다")
public void throwsPaymentServerExceptionWhenPaymentApiReturns500()

@DisplayName("연속 실패 시 Circuit Breaker가 OPEN 상태로 전환된다")
public void circuitBreakerOpensAfterConsecutiveFailures()
```

## Characteristics

- Uses WireMock to simulate external APIs
- Tests resilience patterns (Circuit Breaker, Retry, Timeout)
- Tests complex database queries
- Isolated from business logic

## When to Write Adapter Tests

Write adapter tests only for:

- **Complex resilience logic**: Circuit Breaker, Retry, Timeout configurations
- **Complex DB queries**: Multiple joins, aggregations, native queries
- **Critical integrations**: Payment, settlement (money-related)
- **External API clients**: When response parsing or error handling is complex

Do NOT write adapter tests for:
- Simple CRUD repository operations (covered by integration tests)
- Straightforward API calls without resilience patterns

## File Naming

Adapter tests use the naming pattern `*AdapterTest.java`.

## CRITICAL: Reset in @AfterEach

If you don't reset CircuitBreaker and WireMock after each test, test isolation breaks. Previous test state leaks into the next test, causing flaky tests or unexpected failures.

```java
@AfterEach
public void tearDown() {
    reset();  // WireMock reset
    for (CircuitBreaker circuitBreaker : circuitBreakerRegistry.getAllCircuitBreakers()) {
        circuitBreaker.reset();
    }
}
```

## Test Setup

```java
@SpringBootTest
@AutoConfigureWireMock(port = 0)
@TestPropertySource(properties = {"pg.base-url=http://localhost:${wiremock.server.port}"})
class PgPaymentAdapterTest {

    @Autowired
    private PgPaymentAdapter pgPaymentAdapter;

    @Autowired
    private CircuitBreakerRegistry circuitBreakerRegistry;

    @AfterEach
    public void tearDown() {
        reset();  // WireMock reset
        for (CircuitBreaker circuitBreaker : circuitBreakerRegistry.getAllCircuitBreakers()) {
            circuitBreaker.reset();
        }
    }
}
```

## Best Practice Examples

### WireMock Scenario for Retry

```java
@Test
@DisplayName("결제 API 일시 오류 후 Retry하여 성공한다")
public void succeedsAfterPaymentApiTransientFailure() {
    // given - WireMock Scenario: first 2 fail, 3rd succeeds
    stubFor(
        post("/payments").inScenario("transient")
            .whenScenarioStateIs(STARTED)
            .willReturn(serverError())
            .willSetStateTo("fail-1")
    );
    stubFor(
        post("/payments").inScenario("transient")
            .whenScenarioStateIs("fail-1")
            .willReturn(serverError())
            .willSetStateTo("fail-2")
    );
    stubFor(
        post("/payments").inScenario("transient")
            .whenScenarioStateIs("fail-2")
            .willReturn(okJson("{\"status\":\"SUCCESS\"}"))
    );

    // when
    var result = pgPaymentAdapter.requestPayment(request);

    // then - verify final state only (no verify() for retry count)
    assertThat(result.getStatus()).isEqualTo(PaymentStatus.SUCCESS);
}
```

### Circuit Breaker State Transition

```java
@Test
@DisplayName("연속 실패 시 Circuit Breaker가 OPEN 상태로 전환된다")
public void circuitBreakerOpensAfterConsecutiveFailures() {
    // given - configure all requests to fail
    stubFor(post("/payments").willReturn(serverError()));

    var circuitBreaker = circuitBreakerRegistry.circuitBreaker("payment");
    final int failureThreshold = 5;  // value configured in application.yml

    // when - request until failure threshold
    for (int i = 0; i < failureThreshold; i++) {
        try { pgPaymentAdapter.requestPayment(request); } catch (Exception ignored) {}
    }

    // then
    assertThat(circuitBreaker.getState()).isEqualTo(CircuitBreaker.State.OPEN);
}

@Test
@DisplayName("Circuit Breaker가 OPEN 상태일 때 즉시 실패한다")
public void failsImmediatelyWhenCircuitBreakerIsOpen() {
    // given
    var circuitBreaker = circuitBreakerRegistry.circuitBreaker("payment");
    circuitBreaker.transitionToOpenState();

    // when & then
    assertThatThrownBy(() -> pgPaymentAdapter.requestPayment(request))
        .isInstanceOf(CallNotPermittedException.class);
}
```

### Timeout Handling

```java
@Test
@DisplayName("결제 API Timeout 시 PaymentTimeoutException이 발생한다")
public void throwsPaymentTimeoutExceptionWhenApiTimesOut() {
    // given
    stubFor(
        post("/payments")
            .willReturn(
                aResponse()
                    .withStatus(200)
                    .withFixedDelay(5000)  // 5 second delay (exceeds timeout)
            )
    );

    // when & then
    assertThatThrownBy(() -> pgPaymentAdapter.requestPayment(request))
        .isInstanceOf(PaymentTimeoutException.class);
}
```

### Error Response Parsing

```java
@Test
@DisplayName("결제 API가 400을 반환하면 PaymentValidationException이 발생한다")
public void throwsPaymentValidationExceptionWhenApiReturns400() {
    // given
    stubFor(
        post("/payments")
            .willReturn(
                aResponse()
                    .withStatus(400)
                    .withHeader("Content-Type", "application/json")
                    .withBody("{\"errorCode\": \"INVALID_CARD\", \"message\": \"Card information is invalid\"}")
            )
    );

    // when
    var exception = assertThrows(PaymentValidationException.class, () -> {
        pgPaymentAdapter.requestPayment(request);
    });

    // then
    assertThat(exception.getErrorCode()).isEqualTo("INVALID_CARD");
    assertThat(exception.getMessage()).contains("Card");
}

@Test
@DisplayName("결제 API가 500을 반환하면 PaymentServerException이 발생한다")
public void throwsPaymentServerExceptionWhenApiReturns500() {
    // given
    stubFor(post("/payments").willReturn(serverError()));

    // when & then
    assertThatThrownBy(() -> pgPaymentAdapter.requestPayment(request))
        .isInstanceOf(PaymentServerException.class);
}
```

### Complex Database Query

```java
@Test
@DisplayName("쿼리 조건에 productId가 포함되면 해당 id만 필터링해서 가져온다")
public void filtersByProductIdWhenProductIdConditionIsProvided() {
    // given
    var targetProduct = createProduct("Target");
    var otherProduct = createProduct("Other");
    createOrder(targetProduct.getId(), OrderStatus.PAID);
    createOrder(targetProduct.getId(), OrderStatus.PAID);
    createOrder(otherProduct.getId(), OrderStatus.PAID);

    var condition = new OrderSearchCondition(targetProduct.getId());

    // when
    var results = orderQueryAdapter.search(condition);

    // then
    assertThat(results).hasSize(2);
    assertThat(results).allMatch(result -> result.getProductId().equals(targetProduct.getId()));
}

@Test
@DisplayName("페이징 조건이 올바르게 적용된다")
public void appliesPaginationCorrectly() {
    // given
    for (int i = 0; i < 25; i++) { createOrder(); }
    var pageable = PageRequest.of(1, 10);  // 2nd page, 10 items per page

    // when
    var results = orderQueryAdapter.searchWithPaging(new OrderSearchCondition(), pageable);

    // then
    assertThat(results.getContent()).hasSize(10);
    assertThat(results.getTotalElements()).isEqualTo(25);
    assertThat(results.getTotalPages()).isEqualTo(3);
}
```

## WireMock Helpers

### Common Stub Patterns

```java
// Success response
private void stubPaymentSuccess() {
    stubFor(
        post(urlEqualTo("/api/v1/payments"))
            .willReturn(
                aResponse()
                    .withStatus(200)
                    .withHeader("Content-Type", "application/json")
                    .withBody("{\"transactionKey\": \"tx_123\", \"status\": \"SUCCESS\"}")
            )
    );
}

// Failure response
private void stubPaymentFailure(int statusCode, String errorBody) {
    stubFor(
        post(urlEqualTo("/api/v1/payments"))
            .willReturn(
                aResponse()
                    .withStatus(statusCode)
                    .withHeader("Content-Type", "application/json")
                    .withBody(errorBody)
            )
    );
}

// Delayed response (for timeout testing)
private void stubPaymentDelayed(int delayMs) {
    stubFor(
        post(urlEqualTo("/api/v1/payments"))
            .willReturn(
                aResponse()
                    .withStatus(200)
                    .withFixedDelay(delayMs)
            )
    );
}
```

## Quality Checklist

- [ ] WireMock port is randomized (`port = 0`)
- [ ] Inject base URL via `@TestPropertySource`
- [ ] Reset WireMock and CircuitBreaker in `@AfterEach`
- [ ] Resilience patterns (Retry, Circuit Breaker, Timeout) scenarios covered
- [ ] Error response parsing verified
- [ ] No `verify()` usage (verify final state only)
- [ ] Complex queries tested with various condition combinations

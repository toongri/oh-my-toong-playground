# Adapter Test

Adapter tests verify that **infrastructure code communicating with external systems** works correctly, including resilience patterns like Circuit Breaker, Retry, and Timeout.

## Naming Convention Examples

```kotlin
@DisplayName("쿼리 조건에 productId가 포함되면 해당 id만 필터링해서 가져온다")
fun `filters by productId when productId condition is provided`()

@DisplayName("결제 API가 500을 반환하면 PaymentServerException이 발생한다")
fun `throws PaymentServerException when payment API returns 500`()

@DisplayName("연속 실패 시 Circuit Breaker가 OPEN 상태로 전환된다")
fun `circuit breaker opens after consecutive failures`()
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

Adapter tests use the naming pattern `*AdapterTest.kt`.

## CRITICAL: Reset in @AfterEach

If you don't reset CircuitBreaker and WireMock after each test, test isolation breaks. Previous test state leaks into the next test, causing flaky tests or unexpected failures.

```kotlin
@AfterEach
fun tearDown() {
    reset()  // WireMock reset
    for (circuitBreaker in circuitBreakerRegistry.allCircuitBreakers) {
        circuitBreaker.reset()
    }
}
```

## Test Setup

```kotlin
@SpringBootTest
@AutoConfigureWireMock(port = 0)
@TestPropertySource(properties = ["pg.base-url=http://localhost:\${wiremock.server.port}"])
class PgPaymentAdapterTest @Autowired constructor(
    private val pgPaymentAdapter: PgPaymentAdapter,
    private val circuitBreakerRegistry: CircuitBreakerRegistry,
) {

    @AfterEach
    fun tearDown() {
        reset()  // WireMock reset
        for (circuitBreaker in circuitBreakerRegistry.allCircuitBreakers) {
            circuitBreaker.reset()
        }
    }
}
```

## Best Practice Examples

### WireMock Scenario for Retry

```kotlin
@Test
@DisplayName("결제 API 일시 오류 후 Retry하여 성공한다")
fun `succeeds after payment API transient failure`() {
    // given - WireMock Scenario: first 2 fail, 3rd succeeds
    stubFor(
        post("/payments").inScenario("transient")
            .whenScenarioStateIs(STARTED)
            .willReturn(serverError())
            .willSetStateTo("fail-1")
    )
    stubFor(
        post("/payments").inScenario("transient")
            .whenScenarioStateIs("fail-1")
            .willReturn(serverError())
            .willSetStateTo("fail-2")
    )
    stubFor(
        post("/payments").inScenario("transient")
            .whenScenarioStateIs("fail-2")
            .willReturn(okJson("""{"status":"SUCCESS"}"""))
    )

    // when
    val result = pgPaymentAdapter.requestPayment(request)

    // then - verify final state only (no verify() for retry count)
    assertThat(result.status).isEqualTo(PaymentStatus.SUCCESS)
}
```

### Circuit Breaker State Transition

```kotlin
@Test
@DisplayName("연속 실패 시 Circuit Breaker가 OPEN 상태로 전환된다")
fun `circuit breaker opens after consecutive failures`() {
    // given - configure all requests to fail
    stubFor(post("/payments").willReturn(serverError()))

    val circuitBreaker = circuitBreakerRegistry.circuitBreaker("payment")
    val failureThreshold = 5  // value configured in application.yml

    // when - request until failure threshold
    repeat(failureThreshold) {
        runCatching { pgPaymentAdapter.requestPayment(request) }
    }

    // then
    assertThat(circuitBreaker.state).isEqualTo(CircuitBreaker.State.OPEN)
}

@Test
@DisplayName("Circuit Breaker가 OPEN 상태일 때 즉시 실패한다")
fun `fails immediately when circuit breaker is open`() {
    // given
    val circuitBreaker = circuitBreakerRegistry.circuitBreaker("payment")
    circuitBreaker.transitionToOpenState()

    // when & then
    assertThatThrownBy { pgPaymentAdapter.requestPayment(request) }
        .isInstanceOf(CallNotPermittedException::class.java)
}
```

### Timeout Handling

```kotlin
@Test
@DisplayName("결제 API Timeout 시 PaymentTimeoutException이 발생한다")
fun `throws PaymentTimeoutException when API times out`() {
    // given
    stubFor(
        post("/payments")
            .willReturn(
                aResponse()
                    .withStatus(200)
                    .withFixedDelay(5000)  // 5 second delay (exceeds timeout)
            )
    )

    // when & then
    assertThatThrownBy { pgPaymentAdapter.requestPayment(request) }
        .isInstanceOf(PaymentTimeoutException::class.java)
}
```

### Error Response Parsing

```kotlin
@Test
@DisplayName("결제 API가 400을 반환하면 PaymentValidationException이 발생한다")
fun `throws PaymentValidationException when API returns 400`() {
    // given
    stubFor(
        post("/payments")
            .willReturn(
                aResponse()
                    .withStatus(400)
                    .withHeader("Content-Type", "application/json")
                    .withBody("""{"errorCode": "INVALID_CARD", "message": "Card information is invalid"}""")
            )
    )

    // when
    val exception = assertThrows<PaymentValidationException> {
        pgPaymentAdapter.requestPayment(request)
    }

    // then
    assertThat(exception.errorCode).isEqualTo("INVALID_CARD")
    assertThat(exception.message).contains("Card")
}

@Test
@DisplayName("결제 API가 500을 반환하면 PaymentServerException이 발생한다")
fun `throws PaymentServerException when API returns 500`() {
    // given
    stubFor(post("/payments").willReturn(serverError()))

    // when & then
    assertThatThrownBy { pgPaymentAdapter.requestPayment(request) }
        .isInstanceOf(PaymentServerException::class.java)
}
```

### Complex Database Query

```kotlin
@Test
@DisplayName("쿼리 조건에 productId가 포함되면 해당 id만 필터링해서 가져온다")
fun `filters by productId when productId condition is provided`() {
    // given
    val targetProduct = createProduct(name = "Target")
    val otherProduct = createProduct(name = "Other")
    createOrder(productId = targetProduct.id, status = OrderStatus.PAID)
    createOrder(productId = targetProduct.id, status = OrderStatus.PAID)
    createOrder(productId = otherProduct.id, status = OrderStatus.PAID)

    val condition = OrderSearchCondition(productId = targetProduct.id)

    // when
    val results = orderQueryAdapter.search(condition)

    // then
    assertThat(results).hasSize(2)
    assertThat(results).allMatch { it.productId == targetProduct.id }
}

@Test
@DisplayName("페이징 조건이 올바르게 적용된다")
fun `applies pagination correctly`() {
    // given
    repeat(25) { createOrder() }
    val pageable = PageRequest.of(1, 10)  // 2nd page, 10 items per page

    // when
    val results = orderQueryAdapter.searchWithPaging(OrderSearchCondition(), pageable)

    // then
    assertThat(results.content).hasSize(10)
    assertThat(results.totalElements).isEqualTo(25)
    assertThat(results.totalPages).isEqualTo(3)
}
```

## WireMock Helpers

### Common Stub Patterns

```kotlin
// Success response
private fun stubPaymentSuccess() {
    stubFor(
        post(urlEqualTo("/api/v1/payments"))
            .willReturn(
                aResponse()
                    .withStatus(200)
                    .withHeader("Content-Type", "application/json")
                    .withBody("""{"transactionKey": "tx_123", "status": "SUCCESS"}""")
            )
    )
}

// Failure response
private fun stubPaymentFailure(statusCode: Int, errorBody: String) {
    stubFor(
        post(urlEqualTo("/api/v1/payments"))
            .willReturn(
                aResponse()
                    .withStatus(statusCode)
                    .withHeader("Content-Type", "application/json")
                    .withBody(errorBody)
            )
    )
}

// Delayed response (for timeout testing)
private fun stubPaymentDelayed(delayMs: Int) {
    stubFor(
        post(urlEqualTo("/api/v1/payments"))
            .willReturn(
                aResponse()
                    .withStatus(200)
                    .withFixedDelay(delayMs)
            )
    )
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

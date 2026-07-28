# Adapter Test

Adapter Test는 외부 시스템과 통신하는 인프라 코드가 Circuit Breaker·Retry·Timeout 같은 회복력(resilience) 패턴까지 포함해 올바르게 동작하는지 검증하는 테스트 레벨이다.

## 목차

1. **언제 Adapter Test인가** — 특징, 작성 대상과 제외 대상
2. **파일명과 네이밍** — `@DisplayName` 관례와 `*AdapterTest.kt` 패턴
3. **CRITICAL: @AfterEach에서 리셋하라** — WireMock과 CircuitBreaker를 함께 리셋해야 하는 이유
4. **테스트 셋업** — `@AutoConfigureWireMock`과 base URL 주입
5. **WireMock 헬퍼** — 성공·실패·지연 응답을 만드는 공통 stub 함수
6. **패턴별 예시** — Retry·Circuit Breaker·Timeout·에러 파싱·복잡 쿼리, 5가지 전체 코드
7. **품질 체크리스트** — 커밋 전 마지막 점검

---

## 1. 언제 Adapter Test인가

Adapter Test는 **외부 시스템과 통신하는 인프라 코드**를 검증 대상으로 삼는다. 비즈니스 로직에서 분리해, 회복력 패턴이 정말로 설정대로 동작하는지에 집중한다.

특징은 다음과 같다.

- WireMock으로 외부 API를 흉내 낸다
- Circuit Breaker, Retry, Timeout 같은 회복력 패턴을 검증한다
- 복잡한 DB 쿼리를 검증한다
- 비즈니스 로직과 분리되어 있다

다음에 대해서만 작성한다.

- 복잡한 회복력 로직 — Circuit Breaker, Retry, Timeout 설정
- 복잡한 DB 쿼리 — 여러 join, 집계, native query
- 결제·정산처럼 돈이 걸린 핵심 연동
- 응답 파싱이나 에러 처리가 복잡한 외부 API 클라이언트

다음에 대해서는 작성하지 않는다.

- 단순 CRUD 레포지토리 연산 — Integration Test가 커버한다
- 회복력 패턴이 없는 단순한 API 호출

## 2. 파일명과 네이밍

Adapter Test의 `@DisplayName`은 입력 조건과 반환·예외 결과를 그대로 서술한다.

```kotlin
@DisplayName("쿼리 조건에 productId가 포함되면 해당 id만 필터링해서 가져온다")
fun `filters by productId when productId condition is provided`()

@DisplayName("결제 API가 500을 반환하면 PaymentServerException이 발생한다")
fun `throws PaymentServerException when payment API returns 500`()

@DisplayName("연속 실패 시 Circuit Breaker가 OPEN 상태로 전환된다")
fun `circuit breaker opens after consecutive failures`()
```

파일명은 `*AdapterTest.kt` 패턴을 따른다.

## 3. CRITICAL: @AfterEach에서 리셋하라

> ⚠️ 주의
> 매 테스트가 끝난 뒤 CircuitBreaker와 WireMock을 리셋하지 않으면 테스트 격리가 깨진다. 이전 테스트의 상태가 다음 테스트로 새어 들어가 flaky한 실패나 예상치 못한 실패를 만든다.

```kotlin
@AfterEach
fun tearDown() {
    reset()  // WireMock reset
    for (circuitBreaker in circuitBreakerRegistry.allCircuitBreakers) {
        circuitBreaker.reset()
    }
}
```

## 4. 테스트 셋업

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

> WireMock 포트를 랜덤화하고(`port = 0`) `@TestPropertySource`로 base URL을 주입하는 이유는, 포트 충돌 없이 여러 Adapter Test를 나란히 돌리기 위해서다. WireMock의 일반적인 stub 문법이나 통합 테스트 레벨에서의 기본 사용법은 이 문서가 다루지 않는다 — [test-levels.md](./test-levels.md)를 참고한다. 여기서는 Adapter Test에 특화된 셋업만 다룬다.

## 5. WireMock 헬퍼

Adapter Test에서 반복되는 stub 작성을 매 테스트마다 새로 만들지 않도록, 공통 응답 패턴을 헬퍼 함수로 뽑아둔다.

### 공통 stub 패턴

```kotlin
// Success response
private fun stubPaymentSuccess() {
    stubFor(
        post(urlEqualTo("/payments"))
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
        post(urlEqualTo("/payments"))
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
        post(urlEqualTo("/payments"))
            .willReturn(
                aResponse()
                    .withStatus(200)
                    .withFixedDelay(delayMs)
            )
    )
}
```

## 6. 패턴별 예시

> `PaymentTimeoutException`·`PaymentValidationException`·`PaymentServerException`은 도메인별 예외가 아니라 어댑터 경계 안에서만 사는 인프라 어댑터-로컬 예외로, 애플리케이션 계층으로 넘어갈 때 `CoreException`으로 번역된다 — 자세한 규칙은 error-handling.md를 참고한다.

### Retry를 위한 WireMock Scenario

WireMock의 Scenario 상태를 이용하면 "처음 두 번은 실패, 세 번째는 성공"하는 흐름을 만들 수 있다. 이때 재시도 횟수를 `verify()`로 세지 않고, 최종 상태만 검증한다.

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

### Circuit Breaker 상태 전환

실패율이 설정된 임계값(`failureRateThreshold`)을 넘고 호출 횟수가 최소 호출 수(`minimumNumberOfCalls`)에 도달하면 Circuit Breaker가 OPEN 상태로 전환되고, OPEN 상태에서는 실제 호출 없이 즉시 실패해야 한다.

```kotlin
@Test
@DisplayName("연속 실패 시 Circuit Breaker가 OPEN 상태로 전환된다")
fun `circuit breaker opens after consecutive failures`() {
    // given - configure all requests to fail
    stubFor(post("/payments").willReturn(serverError()))

    val circuitBreaker = circuitBreakerRegistry.circuitBreaker("payment")
    val minimumNumberOfCalls = 10  // resilience4j.circuitbreaker.instances.payment.minimum-number-of-calls (application.yml)

    // when - reach minimum call count with all failures (failure rate 100% >= failure-rate-threshold)
    repeat(minimumNumberOfCalls) {
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

### Timeout 처리

응답이 설정된 타임아웃보다 오래 걸리면 타임아웃 예외가 발생해야 한다.

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

### 에러 응답 파싱

상태 코드마다 다른 예외로 매핑되는지, 그리고 에러 바디의 필드가 예외 객체에 정확히 옮겨지는지를 검증한다.

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

### 복잡한 DB 쿼리

여러 조건과 페이징이 함께 걸린 쿼리는, 조건이 실제로 필터링에 반영되는지와 페이징 계산이 맞는지를 함께 검증한다.

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

## 7. 품질 체크리스트

- [ ] WireMock 포트가 랜덤화되어 있는가 (`port = 0`)
- [ ] base URL을 `@TestPropertySource`로 주입하는가
- [ ] `@AfterEach`에서 WireMock과 CircuitBreaker를 모두 리셋하는가
- [ ] 회복력 패턴(Retry, Circuit Breaker, Timeout) 시나리오를 커버하는가
- [ ] 에러 응답 파싱을 검증하는가
- [ ] `verify()`를 쓰지 않는가 (최종 상태만 검증한다)
- [ ] 다양한 조건 조합으로 복잡한 쿼리를 테스트하는가

> `verify()`를 쓰지 않는다는 원칙은 상태 검증 규율(Iron Law)을 Adapter Test에 적용한 것이다 — 그 규율 자체의 근거는 [state-verification.md](./state-verification.md)에서 다룬다.

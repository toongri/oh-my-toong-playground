# E2E 테스트 — 외부 인터페이스 계약 검증

E2E 테스트는 클라이언트에게 보이는 외부 인터페이스가 계약대로 동작하는지 검증한다. HTTP 레이어와 API 계약에 집중하고, 비즈니스 로직 자체는 검증하지 않는다.

## 목차

1. **언제 E2E Test인가** — 검증 범위와 핵심 질문
2. **파일명과 네이밍** — `@DisplayName`과 메서드명 관례
3. **추출 패턴** — 성공·에러·인증 실패 세 갈래
4. **테스트 셋업** — WireMock 랜덤 포트와 DB 정리
5. **HTTP 요청 헬퍼** — 헤더·응답 매핑을 감싸는 프라이빗 함수
6. **WireMock 스텁 헬퍼** — PG 결제 성공 응답 스텁
7. **패턴별 예시** — 성공·비즈니스 규칙 위반·Not Found·인증 실패
8. **품질 체크리스트** — 작성 후 확인할 7개 항목

---

## 1. 언제 E2E Test인가

E2E 테스트가 답해야 하는 핵심 질문은 하나다: **"클라이언트가 약속된 응답을 받는가?"**

- 검증 대상: HTTP 상태 코드, 응답에 담긴 핵심 식별자
- 검증하지 않는 대상: 내부 DB 상태, 서비스 오케스트레이션의 세부 동작

이 경계를 지키기 위해 `TestRestTemplate` 또는 `WebTestClient`로 실제 HTTP 요청을 보내고, 상태 코드와 응답 구조만 확인한다. API 계약이 관심사이지 비즈니스 로직이 관심사가 아니다.

> ⚠️ 주의: E2E 테스트에서 DB 상태를 직접 조회해 검증하고 싶은 유혹이 자주 생긴다. 그건 Integration Test의 몫이다 — E2E는 "응답이 맞는가"만 보고, "DB에 무엇이 저장됐는가"는 보지 않는다.

```kotlin
// ❌ E2E에서 DB 내부 상태까지 검증 — 책임 경계를 넘음
@Test
fun `returnOrderId_whenOrderIsPlaced`() {
    val response = placeOrder(userId, request)

    assertThat(response.statusCode).isEqualTo(HttpStatus.OK)
    val point = pointRepository.findByUserId(userId)
    assertThat(point.balance).isEqualTo(20000L)  // DB 상태 검증은 Integration Test에서
}

// ✅ E2E는 응답만 검증 — DB 상태는 다루지 않음
@Test
fun `returnOrderId_whenOrderIsPlaced`() {
    val response = placeOrder(userId, request)

    assertThat(response.statusCode).isEqualTo(HttpStatus.OK)
    assertThat(response.body?.data?.orderId).isNotNull()
}
```

포인트 잔액 차감 같은 상태 변화의 정확성은 Integration Test(`./integration-test.md`)가 검증한다. E2E는 그 상태 변화가 일어났다는 사실을 응답을 통해서만 확인한다.

## 2. 파일명과 네이밍

네이밍은 두 층으로 나뉜다. `@DisplayName`은 한국어로 "무엇을 검증하는지"를 설명하고, 메서드명은 백틱을 두른 영어로 결과와 조건을 적는다.

```kotlin
@DisplayName("PG 결제 성공 콜백을 받으면 200 OK를 반환한다")
fun `returns 200 OK when payment callback succeeds`()

@DisplayName("존재하지 않는 orderId로 콜백이 오면 404 Not Found를 반환한다")
fun `returns 404 Not Found when orderId does not exist`()

@DisplayName("X-USER-ID 헤더가 없으면 400 Bad Request를 반환한다")
fun `returns 400 Bad Request when X-USER-ID header is missing`()
```

테스트 클래스 파일명은 `*ApiE2ETest.kt` 패턴을 따른다 — 4번 절(테스트 셋업)의 `OrderV1ApiE2ETest`가 그 예시다. 일반 BDD 구조·`@Nested` 조직·메서드 네이밍 규칙은 `./test-authoring.md`에서 다룬다. 이 절은 E2E 레벨에 특화된 네이밍 예시만 다룬다.

## 3. 추출 패턴

E2E로 뽑아낼 케이스는 세 갈래로 수렴한다: 성공, 에러, 인증 실패.

| 패턴 | 설명 |
|---------|-------------|
| 성공 응답 | 상태 코드(200, 201), 핵심 식별자(id) 존재 확인 |
| 에러 응답 | 검증 실패·Not Found·비즈니스 규칙 위반 시 상태 코드 |
| 인증 실패 | 인증 헤더 누락·유효하지 않을 때 상태 코드 |

성공 응답 패턴의 핵심은 상태 코드와 식별자 확인이다.

```kotlin
assertThat(response.statusCode).isEqualTo(HttpStatus.OK)
assertThat(response.body?.data?.orderId).isNotNull()
```

에러 응답과 인증 실패 패턴은 상태 코드만 확인하면 충분하다.

```kotlin
assertThat(response.statusCode).isEqualTo(HttpStatus.BAD_REQUEST)
```

각 패턴의 전체 테스트 코드는 7번 절(패턴별 예시)에서 확인한다.

## 4. 테스트 셋업

E2E 테스트는 실제 서버 포트를 띄우고 외부 PG 연동은 WireMock으로 대체한다. `RANDOM_PORT`는 포트 충돌을 막고, `@AutoConfigureWireMock(port = 0)`은 WireMock 서버도 랜덤 포트에 띄운 뒤 `@TestPropertySource`로 그 포트를 애플리케이션 설정에 주입한다.

```kotlin
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureWireMock(port = 0)
@TestPropertySource(properties = ["pg.base-url=http://localhost:\${wiremock.server.port}"])
@DisplayName("OrderV1Api E2E 테스트")
class OrderV1ApiE2ETest @Autowired constructor(
    private val testRestTemplate: TestRestTemplate,
    private val productRepository: ProductRepository,
    private val stockRepository: StockRepository,
    // ... other repositories
    private val databaseCleanUp: DatabaseCleanUp,
) {

    @AfterEach
    fun tearDown() {
        databaseCleanUp.truncateAllTables()
        reset()  // WireMock reset
    }
}
```

> ⚠️ 주의: `tearDown()`에서 DB와 WireMock을 **둘 다** 초기화해야 한다. WireMock 스텁만 리셋하고 DB를 남겨두면 다음 테스트가 이전 테스트의 데이터를 이어받아 성공/실패가 실행 순서에 따라 달라진다.

## 5. HTTP 요청 헬퍼

테스트 본문이 헤더 구성이나 응답 타입 캐스팅으로 지저분해지지 않도록, 실제 요청은 프라이빗 헬퍼 함수로 감싼다.

```kotlin
private fun placeOrder(
    userId: Long?,
    request: OrderV1Request.PlaceOrder,
): ResponseEntity<ApiResponse<OrderV1Response.PlaceOrder>> {
    val headers = HttpHeaders().apply {
        contentType = MediaType.APPLICATION_JSON
        userId?.let { set("X-USER-ID", it.toString()) }
    }

    return testRestTemplate.exchange(
        "/api/v1/orders",
        HttpMethod.POST,
        HttpEntity(request, headers),
        object : ParameterizedTypeReference<ApiResponse<OrderV1Response.PlaceOrder>>() {},
    )
}
```

`userId`를 nullable로 받아 `null`일 때 헤더 자체를 생략하는 구조는, 인증 헤더 누락 케이스(3번 절 "인증 실패")를 같은 헬퍼로 재사용할 수 있게 한다.

## 6. WireMock 스텁 헬퍼

아래는 PG 결제 성공을 흉내 내는 E2E 전용 스텁이다. WireMock의 일반 사용법과 매칭 문법은 `./test-levels.md`에서 다루므로, 이 절은 E2E 테스트가 실제로 쓰는 구체적인 스텁 하나에 집중한다.

```kotlin
private fun stubPgPaymentSuccess() {
    stubFor(
        post(urlEqualTo("/api/v1/payments"))
            .willReturn(
                aResponse()
                    .withStatus(200)
                    .withHeader("Content-Type", "application/json")
                    .withBody(
                        """
                        {
                            "meta": {"result": "SUCCESS", "errorCode": null, "message": null},
                            "data": {"transactionKey": "tx_test_${System.currentTimeMillis()}", "status": "PENDING"}
                        }
                        """.trimIndent(),
                    ),
            ),
    )
}
```

`transactionKey`에 섞은 `System.currentTimeMillis()`는 Kotlin 삼중따옴표 리터럴 안에 있고, 그 리터럴은 `.withBody(...)`로 스텁을 등록하는 시점에 딱 한 번 평가된다 — 요청이 몇 번 들어오든 이 스텁이 매칭되는 동안은 항상 같은 `transactionKey` 값을 반환하는 상수다. 즉 이 값은 호출마다 트랜잭션 키가 충돌하지 않게 막아주는 장치가 아니라, 테스트용으로 그럴듯한 값 하나를 채워 넣는 용도일 뿐이다. 같은 테스트 클래스에서 이 스텁을 여러 번 재사용하며 호출마다 다른 `transactionKey`가 실제로 필요하다면(예: 트랜잭션 키 충돌 자체를 검증하는 테스트), WireMock의 response templating(`{{now}}` 또는 `ResponseTemplateTransformer`)으로 바꿔야 한다.

## 7. 패턴별 예시

### 성공 응답

```kotlin
@Test
@DisplayName("주문을 생성하면 200 OK와 주문 ID를 반환한다")
fun `returns 200 OK when order is placed`() {
    // given
    val userId = 1L
    val product = createProduct(price = Money.krw(20000))
    createPointAccount(userId, Money.krw(50000))
    stubPgPaymentSuccess()

    val request = OrderV1Request.PlaceOrder(
        items = listOf(OrderV1Request.PlaceOrderItem(productId = product.id, quantity = 2)),
        usePoint = 30000,
        cardType = CardType.HYUNDAI,
        cardNo = "1234-5678-9012-3456",
    )

    // when
    val response = placeOrder(userId, request)

    // then - verify status code and core identifier only
    assertThat(response.statusCode).isEqualTo(HttpStatus.OK)
    assertThat(response.body?.data?.orderId).isNotNull()
}
```

### 비즈니스 규칙 위반 → 400

```kotlin
@Test
@DisplayName("포인트가 부족하면 400 Bad Request를 반환한다")
fun `returns 400 Bad Request when insufficient points`() {
    // given
    val userId = 1L
    val product = createProduct(price = Money.krw(20000))
    createPointAccount(userId, Money.krw(5000))

    val request = OrderV1Request.PlaceOrder(
        items = listOf(OrderV1Request.PlaceOrderItem(productId = product.id, quantity = 1)),
        usePoint = 10000,
        cardType = CardType.HYUNDAI,
        cardNo = "1234-5678-9012-3456",
    )

    // when
    val response = placeOrder(userId, request)

    // then
    assertThat(response.statusCode).isEqualTo(HttpStatus.BAD_REQUEST)
}

@Test
@DisplayName("재고가 부족하면 400 Bad Request를 반환한다")
fun `returns 400 Bad Request when insufficient stock`() {
    // given
    val userId = 1L
    val product = createProduct(price = Money.krw(20000), stockQuantity = 5)
    createPointAccount(userId, Money.krw(100000))

    val request = OrderV1Request.PlaceOrder(
        items = listOf(OrderV1Request.PlaceOrderItem(productId = product.id, quantity = 10)),
        usePoint = 100000,
        cardType = CardType.HYUNDAI,
        cardNo = "1234-5678-9012-3456",
    )

    // when
    val response = placeOrder(userId, request)

    // then
    assertThat(response.statusCode).isEqualTo(HttpStatus.BAD_REQUEST)
}
```

### Not Found → 404

```kotlin
@Test
@DisplayName("존재하지 않는 상품을 주문하면 404 Not Found를 반환한다")
fun `returns 404 Not Found when product does not exist`() {
    // given
    val userId = 1L
    createPointAccount(userId, Money.krw(100000))

    val request = OrderV1Request.PlaceOrder(
        items = listOf(OrderV1Request.PlaceOrderItem(productId = 999L, quantity = 1)),
        usePoint = 10000,
        cardType = CardType.HYUNDAI,
        cardNo = "1234-5678-9012-3456",
    )

    // when
    val response = placeOrder(userId, request)

    // then
    assertThat(response.statusCode).isEqualTo(HttpStatus.NOT_FOUND)
}
```

### 인증 헤더 누락 → 400

```kotlin
@Test
@DisplayName("X-USER-ID 헤더가 없으면 400 Bad Request를 반환한다")
fun `returns 400 Bad Request when X-USER-ID header is missing`() {
    // given
    val product = createProduct()
    val request = OrderV1Request.PlaceOrder(
        items = listOf(OrderV1Request.PlaceOrderItem(productId = product.id, quantity = 1)),
        usePoint = 10000,
        cardType = CardType.HYUNDAI,
        cardNo = "1234-5678-9012-3456",
    )

    // when - pass null as userId
    val response = placeOrder(null, request)

    // then
    assertThat(response.statusCode).isEqualTo(HttpStatus.BAD_REQUEST)
}
```

## 8. 품질 체크리스트

- [ ] 주요 성공 시나리오의 상태 코드를 검증했는가
- [ ] 응답 바디 검증을 핵심 식별자(id 등)로 최소화했는가
- [ ] 인증/인가 실패 케이스가 존재하는가
- [ ] 주요 비즈니스 규칙 위반의 상태 코드(400)를 검증했는가
- [ ] Not Found 케이스의 상태 코드(404)를 검증했는가
- [ ] 세부 비즈니스 로직을 검증하지 않았는가 (Unit/Integration Test의 몫)
- [ ] 외부 API 의존성에 WireMock 스텁을 세팅했는가

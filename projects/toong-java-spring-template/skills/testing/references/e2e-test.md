# E2E Test

E2E tests verify that **the external interface visible to clients works according to contract**. Focus on HTTP layer and API contract, not on business logic itself.

## Naming Convention Examples

```java
@DisplayName("PG 결제 성공 콜백을 받으면 200 OK를 반환한다")
public void returns200OkWhenPaymentCallbackSucceeds()

@DisplayName("존재하지 않는 orderId로 콜백이 오면 404 Not Found를 반환한다")
public void returns404NotFoundWhenOrderIdDoesNotExist()

@DisplayName("인증 헤더 없이 요청하면 401을 반환한다")
public void returns401WhenAuthorizationHeaderIsMissing()
```

## Characteristics

- Uses `TestRestTemplate` or `WebTestClient`
- Verifies HTTP status codes and response structure
- Does NOT verify internal database state
- Focus on API contract, not business logic

## Verification Principle

**Core Question**: "Does the client receive the promised response?"

**What to verify**: HTTP status code, core identifiers in response

**What NOT to verify**: Internal database state, service orchestration details

## Extraction Patterns

| Pattern | Description |
|---------|-------------|
| Success Response | Status code (200, 201), core identifier (id) exists |
| Error Response | Status code on validation failure, not found, business rule violation |
| Auth Failure | Status code when auth header missing or invalid |

## Best Practice Examples

### Success Response

```java
@Test
@DisplayName("주문을 생성하면 200 OK와 주문 ID를 반환한다")
public void returnOrderId_whenOrderIsPlaced() {
    // given
    final long userId = 1L;
    var product = createProduct(Money.krw(20000));
    createPointAccount(userId, Money.krw(50000));
    stubPgPaymentSuccess();

    var request = new OrderV1Request.PlaceOrder(
        List.of(new OrderV1Request.PlaceOrderItem(product.getId(), 2)),
        30000,
        CardType.HYUNDAI,
        "1234-5678-9012-3456"
    );

    // when
    var response = placeOrder(userId, request);

    // then - verify status code and core identifier only
    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(response.getBody().getData().getOrderId()).isNotNull();
}
```

### Business Rule Violation → 400

```java
@Test
@DisplayName("포인트가 부족하면 400 Bad Request를 반환한다")
public void returnBadRequest_whenInsufficientPoints() {
    // given
    final long userId = 1L;
    var product = createProduct(Money.krw(20000));
    createPointAccount(userId, Money.krw(5000));

    var request = new OrderV1Request.PlaceOrder(
        List.of(new OrderV1Request.PlaceOrderItem(product.getId(), 1)),
        10000,
        CardType.HYUNDAI,
        "1234-5678-9012-3456"
    );

    // when
    var response = placeOrder(userId, request);

    // then
    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
}

@Test
@DisplayName("재고가 부족하면 400 Bad Request를 반환한다")
public void returnBadRequest_whenInsufficientStock() {
    // given
    final long userId = 1L;
    var product = createProduct(Money.krw(20000), 5);
    createPointAccount(userId, Money.krw(100000));

    var request = new OrderV1Request.PlaceOrder(
        List.of(new OrderV1Request.PlaceOrderItem(product.getId(), 10)),
        100000,
        CardType.HYUNDAI,
        "1234-5678-9012-3456"
    );

    // when
    var response = placeOrder(userId, request);

    // then
    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
}
```

### Not Found → 404

```java
@Test
@DisplayName("존재하지 않는 상품을 주문하면 404 Not Found를 반환한다")
public void returnNotFound_whenProductDoesNotExist() {
    // given
    final long userId = 1L;
    createPointAccount(userId, Money.krw(100000));

    var request = new OrderV1Request.PlaceOrder(
        List.of(new OrderV1Request.PlaceOrderItem(999L, 1)),
        10000,
        CardType.HYUNDAI,
        "1234-5678-9012-3456"
    );

    // when
    var response = placeOrder(userId, request);

    // then
    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
}
```

### Auth Header Missing → 400

```java
@Test
@DisplayName("X-USER-ID 헤더가 없으면 400 Bad Request를 반환한다")
public void returnBadRequest_whenUserIdHeaderIsMissing() {
    // given
    var product = createProduct();
    var request = new OrderV1Request.PlaceOrder(
        List.of(new OrderV1Request.PlaceOrderItem(product.getId(), 1)),
        10000,
        CardType.HYUNDAI,
        "1234-5678-9012-3456"
    );

    // when - pass null as userId
    var response = placeOrder(null, request);

    // then
    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
}
```

## Test Setup

```java
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureWireMock(port = 0)
@TestPropertySource(properties = {"pg.base-url=http://localhost:${wiremock.server.port}"})
@DisplayName("OrderV1Api E2E 테스트")
class OrderV1ApiE2ETest {

    @Autowired
    private TestRestTemplate testRestTemplate;

    @Autowired
    private ProductRepository productRepository;

    @Autowired
    private StockRepository stockRepository;

    // ... other repositories

    @Autowired
    private DatabaseCleanUp databaseCleanUp;

    @AfterEach
    public void tearDown() {
        databaseCleanUp.truncateAllTables();
        reset();  // WireMock reset
    }
}
```

## HTTP Request Helper

```java
private ResponseEntity<ApiResponse<OrderV1Response.PlaceOrder>> placeOrder(
    Long userId,
    OrderV1Request.PlaceOrder request
) {
    var headers = new HttpHeaders();
    headers.setContentType(MediaType.APPLICATION_JSON);
    if (userId != null) {
        headers.set("X-USER-ID", userId.toString());
    }

    return testRestTemplate.exchange(
        "/api/v1/orders",
        HttpMethod.POST,
        new HttpEntity<>(request, headers),
        new ParameterizedTypeReference<ApiResponse<OrderV1Response.PlaceOrder>>() {}
    );
}
```

## WireMock Stub Helper

```java
private void stubPgPaymentSuccess() {
    stubFor(
        post(urlEqualTo("/api/v1/payments"))
            .willReturn(
                aResponse()
                    .withStatus(200)
                    .withHeader("Content-Type", "application/json")
                    .withBody(
                        "{\n" +
                        "    \"meta\": {\"result\": \"SUCCESS\", \"errorCode\": null, \"message\": null},\n" +
                        "    \"data\": {\"transactionKey\": \"tx_test_" + System.currentTimeMillis() + "\", \"status\": \"PENDING\"}\n" +
                        "}"
                    )
            )
    );
}
```

## Quality Checklist

- [ ] Status codes for main success scenarios are verified
- [ ] Response body verification is minimized to core identifiers (id, etc.)
- [ ] Authentication/authorization failure cases exist
- [ ] Status codes for main business rule violations are verified (400)
- [ ] Status codes for not found cases are verified (404)
- [ ] Detailed business logic is not verified (belongs to Unit/Integration)
- [ ] WireMock stubs set up for external API dependencies

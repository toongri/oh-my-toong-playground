# Concurrency Test

Concurrency Test는 동시에 여러 요청이 들어와도 데이터 정합성이 유지되고 락(잠금) 메커니즘이 의도대로 동작하는지 검증하는 테스트 레벨이다.

## 목차

1. **언제 Concurrency Test인가** — 특징과 작성 대상 상황
2. **파일명과 네이밍** — `@DisplayName` 관례와 `*ConcurrencyTest.kt` 분리 이유
3. **테스트 구조** — `@SpringBootTest` 기반 골격과 정리(cleanup)
4. **CRITICAL: latch.await() 이후에 단언하라** — 단언 시점이 레이스 컨디션을 가르는 이유
5. **공통 패턴** — 스레드 풀 준비·실행 블록·단언의 재사용 형태
6. **타임아웃 처리** — 테스트가 무한정 멈추지 않게 막는 3가지 방법
7. **디버깅 팁** — flaky한 동시성 테스트를 다루는 실전 요령
8. **패턴별 예시** — 쿠폰·재고·멱등성 키, 3가지 시나리오 전체 코드
9. **품질 체크리스트** — 커밋 전 마지막 점검

---

## 1. 언제 Concurrency Test인가

Concurrency Test는 일반 통합 테스트와 보는 지점이 다르다. 통합 테스트가 "한 번의 요청이 올바른 결과를 내는가"를 본다면, Concurrency Test는 "여러 요청이 동시에 부딪혀도 그 결과가 올바른가"를 본다.

특징은 다음과 같다.

- `ExecutorService`로 여러 스레드를 동시에 실행한다
- 요청 하나만 성공하는지(또는 모두 정확한 최종 상태로 성공하는지)를 검증한다
- 낙관적 락/비관적 락(optimistic/pessimistic locking) 동작을 검증한다
- 별도 파일 `*ConcurrencyTest.kt`로 분리한다 — 분리 이유는 [2절](#2-파일명과-네이밍)에서 다룬다

다음과 같은 상황에서 작성한다.

- 단일 자원 경합 — 쿠폰 사용, 좌석 예약
- 공유 자원 갱신 — 재고 차감, 잔액 변경
- 멱등성 키(idempotency key)를 통한 중복 방지
- 낙관적 락 재시도(retry) 시나리오

> ⚠️ 주의: 성공/실패 개수만 세는 것으로 끝내지 않는다. 개수 검증과 별개로 **최종 상태를 반드시 함께 검증**한다 — 상태 검증 규율(Iron Law)을 동시성 상황에 적용한 것이다. 그 규율 자체의 근거는 이 문서의 범위를 넘는다 — [state-verification.md](./state-verification.md)에서 다룬다.

## 2. 파일명과 네이밍

Concurrency Test의 `@DisplayName`은 "동시에 실행해도 ~하다"라는 동시성 보장을 문장으로 드러낸다. 메서드 이름은 같은 내용을 백틱으로 감싼 영어 문장으로 옮긴다.

```kotlin
@DisplayName("동일한 쿠폰으로 동시에 주문해도 한 번만 사용된다")
fun `same coupon used only once even with concurrent orders`()

@DisplayName("동시에 재고 차감해도 정확하게 차감된다")
fun `stock deducted correctly with concurrent orders`()
```

모든 Concurrency Test는 `*ConcurrencyTest.kt`라는 별도 파일에 둔다. 이 분리는 의도적이다.

- Concurrency Test는 자주 flaky해서 별도 주의가 필요하다
- 스레드 풀·래치(latch)처럼 다른 셋업이 필요하다
- 실패를 디버깅하는 방식이 일반 통합 테스트와 다르다

> 메서드 이름을 언제 어느 정도로 세분화할지(Given/When/Then 상세도, `@Nested` 조직 규칙)는 이 문서가 다루지 않는다 — [test-authoring.md](./test-authoring.md)를 참고한다.

## 3. 테스트 구조

Concurrency Test는 `@SpringBootTest`로 전체 컨텍스트를 띄우고, `@AfterEach`에서 테이블을 정리한다.

```kotlin
@SpringBootTest
class OrderConcurrencyTest {

    @Autowired
    private lateinit var orderFacade: OrderFacade

    @Autowired
    private lateinit var databaseCleanUp: DatabaseCleanUp

    @AfterEach
    fun tearDown() {
        databaseCleanUp.truncateAllTables()
    }

    // Test methods...
}
```

> `DatabaseCleanUp`을 이용한 정리 규칙의 일반론(왜 truncate인지, 이 정리가 통합 테스트 레벨에서 갖는 위치)은 이 문서가 다루지 않는다 — [test-levels.md](./test-levels.md)를 참고한다. Concurrency Test에도 동일한 정리 규칙이 그대로 적용된다.

## 4. CRITICAL: latch.await() 이후에 단언하라

> ⚠️ 주의
> `latch.await()` 이전에 `assertThat`을 호출하면, 아직 모든 스레드가 끝나지 않은 상태를 검증하게 되어 레이스 컨디션이 생긴다. 최종 상태 단언은 반드시 `latch.await()` **이후에** 한다.

```kotlin
// ❌ WRONG: assertion before await
repeat(threadCount) { executorService.submit { ... } }
assertThat(successCount.get()).isEqualTo(1)  // threads still running!
val completed = latch.await(30, TimeUnit.SECONDS)
assertThat(completed).isTrue()

// ✅ CORRECT: assertion after await
repeat(threadCount) { executorService.submit { ... } }
val completed = latch.await(30, TimeUnit.SECONDS)  // wait for all threads to complete
assertThat(completed).isTrue()  // fail if threads hung
assertThat(successCount.get()).isEqualTo(1)  // now safe
```

## 5. 공통 패턴

### 스레드 풀 준비

```kotlin
val threadCount = 10
val executorService = Executors.newFixedThreadPool(threadCount)
val latch = CountDownLatch(threadCount)
val successCount = AtomicInteger(0)
val failureCount = AtomicInteger(0)
```

### 실행 블록

```kotlin
repeat(threadCount) { index ->
    executorService.submit {
        try {
            // Business operation
            successCount.incrementAndGet()
        } catch (e: Exception) {
            failureCount.incrementAndGet()
        } finally {
            latch.countDown()
        }
    }
}

val completed = latch.await(30, TimeUnit.SECONDS)
executorService.shutdown()
assertThat(completed).isTrue()  // Fail if threads hung
```

### 단언

```kotlin
// For single-winner scenarios (coupon, seat)
assertThat(successCount.get()).isEqualTo(1)
assertThat(failureCount.get()).isEqualTo(threadCount - 1)

// For all-success scenarios (stock until depleted)
assertThat(successCount.get()).isEqualTo(initialStock)

// Always verify final state
val finalState = repository.findById(id)!!
assertThat(finalState.field).isEqualTo(expectedValue)
```

## 6. 타임아웃 처리

테스트가 무한정 멈춰있지 않도록 항상 타임아웃을 설정한다.

```kotlin
// Option 1: Latch timeout
val completed = latch.await(30, TimeUnit.SECONDS)
assertThat(completed).isTrue()  // Fail if threads hung

// Option 2: Executor timeout
executorService.shutdown()
val terminated = executorService.awaitTermination(30, TimeUnit.SECONDS)
assertThat(terminated).isTrue()

// Option 3: JUnit timeout (entire test)
@Test
@Timeout(60)  // Fail after 60 seconds
fun `concurrent test with timeout`() { ... }
```

## 7. 디버깅 팁

1. 개발 중에는 catch 블록에서 `e.printStackTrace()`를 사용한다
2. 스레드 개수를 늘리면 레이스 컨디션이 더 잘 재현된다
3. 타이밍을 통제해야 하면 작은 지연(delay)을 추가한다
4. DB 락(lock) 동작을 확인한다 — DB마다 락 동작 방식이 다르다
5. 여러 번 실행해본다 — flaky한 테스트는 가끔씩만 통과하기도 한다
6. 타임아웃을 설정해 테스트가 무한정 멈추지 않게 한다

## 8. 패턴별 예시

### 단일 자원 경합 (쿠폰)

한 사람이 같은 쿠폰으로 여러 기기에서 동시에 주문해도, 쿠폰은 정확히 한 번만 사용되어야 한다.

```kotlin
@DisplayName("동일한 쿠폰으로 여러 기기에서 동시에 주문해도, 쿠폰은 단 한번만 사용되어야 한다")
@Test
fun `same coupon can only be used once even with concurrent orders`() {
    // given
    val userId = 1L
    val product = createProduct(price = Money.krw(10000))
    val coupon = createCoupon(discountType = DiscountType.FIXED_AMOUNT, discountValue = 5000)
    val issuedCoupon = createIssuedCoupon(userId = userId, coupon = coupon)
    createPointAccount(userId = userId)

    val threadCount = 5
    val executorService = Executors.newFixedThreadPool(threadCount)
    val latch = CountDownLatch(threadCount)
    val successCount = AtomicInteger(0)
    val failureCount = AtomicInteger(0)

    // when
    repeat(threadCount) {
        executorService.submit {
            try {
                val criteria = OrderCriteria.PlaceOrder(
                    userId = userId,
                    items = listOf(OrderCriteria.PlaceOrderItem(productId = product.id, quantity = 1)),
                    usePoint = Money.krw(5000),
                    issuedCouponId = issuedCoupon.id,
                )
                orderFacade.placeOrder(criteria)
                successCount.incrementAndGet()
            } catch (e: Exception) {
                failureCount.incrementAndGet()
            } finally {
                latch.countDown()
            }
        }
    }

    val completed = latch.await(30, TimeUnit.SECONDS)
    executorService.shutdown()
    assertThat(completed).isTrue()  // Fail if threads hung

    // then
    assertThat(successCount.get()).isEqualTo(1)
    assertThat(failureCount.get()).isEqualTo(threadCount - 1)

    val updatedIssuedCoupon = issuedCouponRepository.findById(issuedCoupon.id)!!
    assertThat(updatedIssuedCoupon.status).isEqualTo(UsageStatus.USED)
}
```

### 공유 자원 차감 (재고)

같은 상품에 여러 주문이 동시에 들어와도 재고는 정확히 차감되어야 하고, 재고 수량만큼만 성공해야 한다.

```kotlin
@DisplayName("동일한 상품에 대해 여러 주문이 동시에 요청되어도, 재고가 정상적으로 차감되어야 한다")
@Test
fun `concurrent orders for same product should deduct stock correctly`() {
    // given
    val initialStock = 10
    val product = createProduct(stockQuantity = initialStock)

    val threadCount = 10
    val executorService = Executors.newFixedThreadPool(threadCount)
    val latch = CountDownLatch(threadCount)
    val successCount = AtomicInteger(0)

    repeat(threadCount) { index ->
        val userId = index + 1L
        createPointAccount(userId = userId)
    }

    // when
    repeat(threadCount) { index ->
        executorService.submit {
            try {
                val userId = index + 1L
                val criteria = OrderCriteria.PlaceOrder(
                    userId = userId,
                    items = listOf(OrderCriteria.PlaceOrderItem(productId = product.id, quantity = 1)),
                    usePoint = product.price,
                    issuedCouponId = null,
                )
                orderFacade.placeOrder(criteria)
                successCount.incrementAndGet()
            } catch (e: Exception) {
                e.printStackTrace()
            } finally {
                latch.countDown()
            }
        }
    }

    val completed = latch.await(30, TimeUnit.SECONDS)
    executorService.shutdown()
    assertThat(completed).isTrue()  // Fail if threads hung

    // then
    assertThat(successCount.get()).isEqualTo(initialStock)

    val updatedStock = stockRepository.findByProductId(product.id)!!
    assertThat(updatedStock.quantity).isEqualTo(0)
}
```

### 동시 중복 요청의 멱등성

같은 멱등성 키로 여러 요청이 동시에 들어와도 실제 처리는 한 번만 일어나야 한다.

```kotlin
@DisplayName("동일한 멱등성 키로 동시에 여러 요청이 와도 하나만 처리된다")
@Test
fun `only one request processed when concurrent requests with same idempotency key`() {
    // given
    val userId = 1L
    val idempotencyKey = UUID.randomUUID().toString()
    val product = createProduct(stockQuantity = 100)
    createPointAccount(userId = userId, balance = Money.krw(100000))

    val threadCount = 5
    val executorService = Executors.newFixedThreadPool(threadCount)
    val latch = CountDownLatch(threadCount)
    val results = ConcurrentHashMap<Int, Result<OrderInfo>>()

    // when
    repeat(threadCount) { index ->
        executorService.submit {
            try {
                val criteria = OrderCriteria.PlaceOrder(
                    userId = userId,
                    idempotencyKey = idempotencyKey,
                    items = listOf(OrderCriteria.PlaceOrderItem(productId = product.id, quantity = 1)),
                    usePoint = Money.krw(10000),
                    issuedCouponId = null,
                )
                val result = orderFacade.placeOrder(criteria)
                results[index] = Result.success(result)
            } catch (e: Exception) {
                results[index] = Result.failure(e)
            } finally {
                latch.countDown()
            }
        }
    }

    val completed = latch.await(30, TimeUnit.SECONDS)
    executorService.shutdown()
    assertThat(completed).isTrue()  // Fail if threads hung

    // then - all requests succeed and return the same order ID
    assertThat(results.values.all { it.isSuccess }).isTrue()
    val orderIds = results.values.map { it.getOrThrow().orderId }
    assertThat(orderIds.distinct()).hasSize(1)

    // stock should only be deducted by 1
    val updatedStock = stockRepository.findByProductId(product.id)!!
    assertThat(updatedStock.quantity).isEqualTo(99)
}
```

## 9. 품질 체크리스트

- [ ] 테스트 파일명이 `*ConcurrencyTest.kt`인가
- [ ] 동기화에 `CountDownLatch`를 사용하는가
- [ ] 스레드 안전한 카운팅에 `AtomicInteger`를 사용하는가
- [ ] 성공/실패 개수를 모두 검증하는가
- [ ] 모든 스레드가 끝난 뒤 최종 상태를 검증하는가
- [ ] `latch.await(...)`/`awaitTermination(...)`의 반환값을 받아 `assertThat(...).isTrue()`로 단언하는가
- [ ] `executorService.shutdown()`을 호출하는가
- [ ] `@AfterEach`에서 데이터베이스를 정리하는가

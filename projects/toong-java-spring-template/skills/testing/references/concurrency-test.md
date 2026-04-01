# Concurrency Test

Concurrency tests verify that **data integrity is maintained under concurrent access** and that locking/synchronization mechanisms work correctly.

## Naming Convention Examples

```java
@DisplayName("동일한 쿠폰으로 동시에 주문해도 한 번만 사용된다")
public void sameCouponUsedOnlyOnceEvenWithConcurrentOrders()

@DisplayName("동시에 재고 차감해도 정확하게 차감된다")
public void stockDeductedCorrectlyWithConcurrentOrders()
```

## Characteristics

- Uses `ExecutorService` with multiple threads
- Verifies that only one request succeeds (or all succeed with correct state)
- Tests optimistic/pessimistic locking behavior
- Separate file: `*ConcurrencyTest.java`

## When to Write Concurrency Tests

- Single resource contention (coupon usage, seat reservation)
- Shared resource updates (stock deduction, balance changes)
- Duplicate prevention with idempotency keys
- Optimistic locking retry scenarios

## File Naming

All concurrency tests must be in separate files named `*ConcurrencyTest.java`.

This separation is intentional:
- Concurrency tests are often flaky and need special attention
- They require different setup (thread pools, latches)
- Failure debugging is different from regular integration tests

## Test Structure

```java
@SpringBootTest
class OrderConcurrencyTest {

    @Autowired
    private OrderFacade orderFacade;

    @Autowired
    private DatabaseCleanUp databaseCleanUp;

    @AfterEach
    public void tearDown() {
        databaseCleanUp.truncateAllTables();
    }

    // Test methods...
}
```

## Best Practice Examples

### Single Resource Contention (Coupon)

```java
@DisplayName("동일한 쿠폰으로 여러 기기에서 동시에 주문해도, 쿠폰은 단 한번만 사용되어야 한다")
@Test
public void sameCouponCanOnlyBeUsedOnceEvenWithConcurrentOrders() throws InterruptedException {
    // given
    final long userId = 1L;
    var product = createProduct(Money.krw(10000));
    var coupon = createCoupon(DiscountType.FIXED_AMOUNT, 5000);
    var issuedCoupon = createIssuedCoupon(userId, coupon);
    createPointAccount(userId);

    final int threadCount = 5;
    var executorService = Executors.newFixedThreadPool(threadCount);
    var latch = new CountDownLatch(threadCount);
    var successCount = new AtomicInteger(0);
    var failureCount = new AtomicInteger(0);

    // when
    for (int i = 0; i < threadCount; i++) {
        executorService.submit(() -> {
            try {
                var criteria = new OrderCriteria.PlaceOrder(
                    userId,
                    List.of(new OrderCriteria.PlaceOrderItem(product.getId(), 1)),
                    Money.krw(5000),
                    issuedCoupon.getId()
                );
                orderFacade.placeOrder(criteria);
                successCount.incrementAndGet();
            } catch (Exception e) {
                failureCount.incrementAndGet();
            } finally {
                latch.countDown();
            }
        });
    }

    latch.await();
    executorService.shutdown();

    // then
    assertThat(successCount.get()).isEqualTo(1);
    assertThat(failureCount.get()).isEqualTo(threadCount - 1);

    var updatedIssuedCoupon = issuedCouponRepository.findById(issuedCoupon.getId());
    assertThat(updatedIssuedCoupon.getStatus()).isEqualTo(UsageStatus.USED);
}
```

### Shared Resource Deduction (Stock)

```java
@DisplayName("동일한 상품에 대해 여러 주문이 동시에 요청되어도, 재고가 정상적으로 차감되어야 한다")
@Test
public void concurrentOrdersForSameProductShouldDeductStockCorrectly() throws InterruptedException {
    // given
    final int initialStock = 10;
    var product = createProduct(initialStock);

    final int threadCount = 10;
    var executorService = Executors.newFixedThreadPool(threadCount);
    var latch = new CountDownLatch(threadCount);
    var successCount = new AtomicInteger(0);

    for (int i = 0; i < threadCount; i++) {
        final long userId = i + 1L;
        createPointAccount(userId);
    }

    // when
    for (int i = 0; i < threadCount; i++) {
        final long userId = i + 1L;
        executorService.submit(() -> {
            try {
                var criteria = new OrderCriteria.PlaceOrder(
                    userId,
                    List.of(new OrderCriteria.PlaceOrderItem(product.getId(), 1)),
                    product.getPrice(),
                    null
                );
                orderFacade.placeOrder(criteria);
                successCount.incrementAndGet();
            } catch (Exception e) {
                e.printStackTrace();
            } finally {
                latch.countDown();
            }
        });
    }

    latch.await();
    executorService.shutdown();

    // then
    assertThat(successCount.get()).isEqualTo(initialStock);

    var updatedStock = stockRepository.findByProductId(product.getId());
    assertThat(updatedStock.getQuantity()).isEqualTo(0);
}
```

### Idempotency with Concurrent Duplicates

```java
@DisplayName("동일한 멱등성 키로 동시에 여러 요청이 와도 하나만 처리된다")
@Test
public void onlyOneRequestProcessedWhenConcurrentRequestsWithSameIdempotencyKey() throws InterruptedException {
    // given
    final long userId = 1L;
    final String idempotencyKey = UUID.randomUUID().toString();
    var product = createProduct(100);
    createPointAccount(userId, Money.krw(100000));

    final int threadCount = 5;
    var executorService = Executors.newFixedThreadPool(threadCount);
    var latch = new CountDownLatch(threadCount);
    var results = new ConcurrentHashMap<Integer, Object>();

    // when
    for (int i = 0; i < threadCount; i++) {
        final int index = i;
        executorService.submit(() -> {
            try {
                var criteria = new OrderCriteria.PlaceOrder(
                    userId,
                    idempotencyKey,
                    List.of(new OrderCriteria.PlaceOrderItem(product.getId(), 1)),
                    Money.krw(10000),
                    null
                );
                var result = orderFacade.placeOrder(criteria);
                results.put(index, result);
            } catch (Exception e) {
                results.put(index, e);
            } finally {
                latch.countDown();
            }
        });
    }

    latch.await();
    executorService.shutdown();

    // then - all requests should return the same order ID
    var successResults = results.values().stream()
        .filter(r -> r instanceof OrderInfo)
        .map(r -> (OrderInfo) r)
        .toList();
    assertThat(successResults).isNotEmpty();
    assertThat(successResults.stream().map(OrderInfo::getOrderId).distinct().toList()).hasSize(1);

    // stock should only be deducted by 1
    var updatedStock = stockRepository.findByProductId(product.getId());
    assertThat(updatedStock.getQuantity()).isEqualTo(99);
}
```

## CRITICAL: Assertion After latch.await()

If you assert before `latch.await()`, you're verifying state before all threads complete, causing race conditions. Always assert final state AFTER `latch.await()`.

```java
// ❌ WRONG: assertion before await
for (int i = 0; i < threadCount; i++) { executorService.submit(() -> { ... }); }
assertThat(successCount.get()).isEqualTo(1);  // threads still running!
latch.await();

// ✅ CORRECT: assertion after await
for (int i = 0; i < threadCount; i++) { executorService.submit(() -> { ... }); }
latch.await();  // wait for all threads to complete
assertThat(successCount.get()).isEqualTo(1);  // now safe
```

## Common Patterns

### Thread Pool Setup

```java
final int threadCount = 10;
var executorService = Executors.newFixedThreadPool(threadCount);
var latch = new CountDownLatch(threadCount);
var successCount = new AtomicInteger(0);
var failureCount = new AtomicInteger(0);
```

### Execution Block

```java
for (int i = 0; i < threadCount; i++) {
    final int index = i;
    executorService.submit(() -> {
        try {
            // Business operation
            successCount.incrementAndGet();
        } catch (Exception e) {
            failureCount.incrementAndGet();
        } finally {
            latch.countDown();
        }
    });
}

latch.await();
executorService.shutdown();
```

### Assertions

```java
// For single-winner scenarios (coupon, seat)
assertThat(successCount.get()).isEqualTo(1);
assertThat(failureCount.get()).isEqualTo(threadCount - 1);

// For all-success scenarios (stock until depleted)
assertThat(successCount.get()).isEqualTo(initialStock);

// Always verify final state
var finalState = repository.findById(id);
assertThat(finalState.getField()).isEqualTo(expectedValue);
```

## Timeout Handling

Always set timeouts to prevent hanging tests:

```java
// Option 1: Latch timeout
boolean completed = latch.await(30, TimeUnit.SECONDS);
assertThat(completed).isTrue();  // Fail if threads hung

// Option 2: Executor timeout
executorService.shutdown();
boolean terminated = executorService.awaitTermination(30, TimeUnit.SECONDS);
assertThat(terminated).isTrue();

// Option 3: JUnit timeout (entire test)
@Test
@Timeout(60)  // Fail after 60 seconds
public void concurrentTestWithTimeout() { ... }
```

## Debugging Tips

1. **Use `e.printStackTrace()`** in catch blocks during development
2. **Increase thread count** to make race conditions more likely
3. **Add small delays** if you need to control timing
4. **Check database locks** - some DBs have different locking behaviors
5. **Run multiple times** - flaky tests may pass sometimes
6. **Set timeouts** - prevent tests from hanging indefinitely

## Quality Checklist

- [ ] Test file is named `*ConcurrencyTest.java`
- [ ] Uses `CountDownLatch` for synchronization
- [ ] Uses `AtomicInteger` for thread-safe counting
- [ ] Verifies both success/failure counts
- [ ] Verifies final state after all threads complete
- [ ] `executorService.shutdown()` is called
- [ ] Database cleanup in `@AfterEach`

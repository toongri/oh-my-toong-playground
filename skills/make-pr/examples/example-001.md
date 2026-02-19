> this is example
---
# fix: 재고 차감 동시성 제어를 DB 비관적 락으로 전환

## 📌 Summary
다중 인스턴스 환경에서 `synchronized` 기반 재고 차감의 동시성 버그를 DB 비관적 락(`PESSIMISTIC_WRITE`)으로 전환하여 해결했습니다.

---

## 🔧 Changes

### 재고 차감 동시성 제어

- `StockService.decreaseStock()`에서 `synchronized` 블록 제거, DB 비관적 락 기반으로 전환
- `StockRepository`에 `findByIdForUpdate()` 메서드 추가 (`@Lock(PESSIMISTIC_WRITE)`)

기존 `synchronized`는 JVM 단위 락으로, 단일 인스턴스에서만 유효했습니다. 다중 인스턴스 배포 이후 동시 주문 시 재고가 음수로 떨어지는 버그가 발생하여 DB 수준 락으로 전환했습니다.

**영향 범위**
- `StockService`, `StockRepository` 변경. 기존 API 인터페이스 변경 없음.
- 트랜잭션 범위를 `decreaseStock()` 메서드 단위로 제한하여 락 보유 시간 최소화.
- DB 수준 락 도입에 따른 처리량 감소 가능성 있으나, 현재 트래픽(피크 100 TPS)에서는 무시할 수준.

---

## 💬 Review Points

> 각 포인트는 저자의 기술적 선택과 트레이드오프를 담고 있습니다.
> diff를 보지 않아도 PR의 핵심 결정을 이해할 수 있도록 작성되었습니다.

### 1. 재고 차감 동시성 제어 전략 변경

**배경 및 문제 상황:**
다중 인스턴스 환경에서 `synchronized`가 JVM 단위 락이라 동시 주문 시 재고 음수 버그가 발생했습니다. 동시성 테스트에서 10개 동시 요청 시 재고가 -3까지 감소하는 현상을 확인했습니다.

**해결 방안:**
`synchronized` 대신 DB 수준 비관적 락(`@Lock(PESSIMISTIC_WRITE)`)으로 변경했습니다. 낙관적 락(`@Version`)도 고려했으나, 재고 차감은 인기 상품에서 충돌 빈도가 높아 재시도 비용이 커서 비관적 락이 적합하다고 판단했습니다.

**구현 세부사항:**
`StockRepository`에 `findByIdForUpdate()` 추가하고, 트랜잭션 범위를 `decreaseStock()` 메서드 단위로 제한하여 락 보유 시간을 최소화했습니다.

**관련 코드:**

Before:
```kotlin
// StockService.kt
@Transactional
fun decreaseStock(productId: Long, quantity: Int) {
    synchronized(this) {  // JVM 단위 락 — 단일 인스턴스에서만 유효
        val stock = stockRepository.findById(productId)
        stock.decrease(quantity)
        stockRepository.save(stock)
    }
}
```

After:
```kotlin
// StockService.kt
@Transactional
fun decreaseStock(productId: Long, quantity: Int) {
    val stock = stockRepository.findByIdForUpdate(productId)  // DB 비관적 락
    stock.decrease(quantity)
    stockRepository.save(stock)
}

// StockRepository.kt
@Lock(LockModeType.PESSIMISTIC_WRITE)
@Query("SELECT s FROM Stock s WHERE s.productId = :productId")
fun findByIdForUpdate(productId: Long): Stock
```

**선택과 트레이드오프:**
- **synchronized → PESSIMISTIC_WRITE:** 다중 인스턴스 환경에서 정합성 보장. 트레이드오프로 DB 수준 락에 의한 처리량 감소 가능성이 있으나, 현재 트래픽(피크 100 TPS)에서는 무시할 수준.
- **낙관적 락 대신 비관적 락 선택:** 재고 차감은 인기 상품에서 충돌률이 높음. 낙관적 락은 재시도 루프가 필요하고, 충돌 시 사용자 응답 지연으로 이어져 사용자 경험에 영향.

---

## ✅ Checklist

### 재고 차감 동시성 제어
- [ ] `synchronized` 블록 제거 후 비관적 락으로 동시성 제어 동작
  - `src/main/kotlin/com/example/stock/StockService.kt`
- [ ] `findByIdForUpdate()` 쿼리가 `FOR UPDATE` 락을 획득
  - `src/main/kotlin/com/example/stock/StockRepository.kt`
- [ ] 동시성 테스트에서 10개 동시 요청 시 재고 정합성 유지
  - `src/test/kotlin/com/example/stock/StockConcurrencyTest.kt`

---

## 📎 References
- Source: (example)

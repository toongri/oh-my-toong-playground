# 네이밍 컨벤션 — 컴포넌트·메서드·변수·불리언

이 문서는 이름을 어떻게 짓는지를 다룬다 — 컴포넌트·메서드·변수·불리언 네이밍 패턴. 에러 메시지 작성 규약은 여기가 아니라 `./error-handling.md`에서 다룬다.

## 목차

1. **왜 네이밍이 일관되어야 하는가** — 불일치가 만드는 인지 비용
2. **컴포넌트 네이밍** — 레이어·DTO별 표준 접미사와 패턴
3. **메서드 네이밍** — 기술 동사 대신 도메인 동사
4. **변수 네이밍** — 축약 금지, 완전한 이름
5. **불리언 네이밍** — `is`/`has`/`canBe` 패턴
6. **Anti-Patterns — 흔한 실수** — 잘못된 이름과 올바른 이름 대조
7. **이런 생각이 들면 멈춰라** — Red Flags

---

## 1. 왜 네이밍이 일관되어야 하는가

`StockManager`와 `StockService`처럼 이름이 일관되지 않으면 컴포넌트의 역할을 파악하는 데 불필요한 인지 비용이 든다. `amt`, `qty` 같은 축약형은 팀원마다 다르게 해석해서 코드 리뷰와 디버깅 시간을 늘린다.

표준 접미사와 완전한 이름을 쓰면 코드베이스 탐색이 빨라지고 팀 간 커뮤니케이션이 명확해진다.

## 2. 컴포넌트 네이밍

레이어·DTO 구성요소마다 정해진 접미사가 있다. 새 클래스를 만들 때는 이 표에서 해당하는 행을 찾아 그대로 따른다.

| Component | Pattern | Example |
|-----------|---------|---------|
| Controller | `{Domain}V{n}Controller` | `ProductV1Controller` |
| ApiSpec | `{Domain}V{n}ApiSpec` | `ProductV1ApiSpec` |
| Facade | `{Domain}Facade` | `ProductFacade` |
| Service | `{Domain}Service` | `ProductService` |
| Repository (Domain) | `{Domain}Repository` | `ProductRepository` |
| Repository (Infra) | `{Domain}{Tech}Repository` | `ProductRdbRepository`, `ProductRedisRepository` |
| Event | `{Action}EventV{n}` | `OrderCreatedEventV1` |
| PageQuery | `{Domain}PageQuery` | `ProductPageQuery` |
| Request | `{Domain}V{n}Request.{Action}` | `ProductV1Request.Search` |
| Response | `{Domain}V{n}Response.{Action}` | `ProductV1Response.Search` |
| Criteria | `{Domain}Criteria.{Action}` | `ProductCriteria.Search` |
| Command | `{Domain}Command.{Action}` | `ProductCommand.Create` |
| Info | `{Domain}Info.{Action}` | `ProductInfo.Detail` |

Controller, ApiSpec, Facade, Service, Event, PageQuery 여섯 개가 가장 자주 쓰는 핵심 패턴이다. 나머지(Repository, Request/Response/Criteria/Command/Info)는 각각 `./layer-boundaries.md`(Repository 경계)와 `./dto-patterns.md`(Request→Criteria→Command→Info→Response 흐름)에서 실제 쓰임을 다룬다.

```kotlin
// Correct
@RestController
class ProductV1Controller(
    private val productFacade: ProductFacade,
) : ProductV1ApiSpec

// Wrong — 표준 접미사를 벗어난 이름
class ProductManager(
    private val productHandler: ProductFacade,
)
```

## 3. 메서드 네이밍

**기술 동사가 아니라 도메인 동사를 쓴다.**

| Domain Verb | Technical Verb (Wrong) |
|-------------|------------------------|
| `use()` | `handleUsage()`, `processUsage()` |
| `expire()` | `processExpiration()`, `handleExpiration()` |
| `cancel()` | `executeCancellation()`, `performCancel()` |
| `issue()` | `processIssuance()` |
| `pay()` | `processPayment()` |
| `complete()` | `handleCompletion()` |

```kotlin
// Correct — 도메인 동사
class Point {
    fun use(amount: Long) { /* ... */ }
}

// Wrong — 기술 동사
class Point {
    fun processUsage(amount: Long) { /* ... */ }
}
```

## 4. 변수 네이밍

**완전한 이름을 쓴다.**

| Correct | Wrong |
|---------|-------|
| `totalProductAmount` | `amt`, `total` |
| `discountAmount` | `disc` |
| `quantity` | `qty` |
| `shippingFee` | `fee` |
| `userId` | `uid` |
| `orderId` | `oid` |

```kotlin
// Correct
fun calculateFinalAmount(
    totalProductAmount: Money,
    discountAmount: Money,
    shippingFee: Money,
): Money

// Wrong — 축약형
fun calc(amt: Money, disc: Money, fee: Money): Money
```

## 5. 불리언 네이밍

| Type | Pattern | Example |
|------|---------|---------|
| Property | `is{Adjective}` | `isExpired`, `isUsable`, `isActive` |
| Method (has) | `has{Noun}` | `hasBalance()`, `hasCoupon()` |
| Method (can) | `canBe{Verb}` | `canBeUsed()`, `canBeReordered()` |

```kotlin
// Correct
val isExpired: Boolean
fun hasBalance(): Boolean
fun canBeUsed(): Boolean

// Wrong — 패턴을 따르지 않는 불리언 이름
val expired: Boolean
fun balance(): Boolean
fun usable(): Boolean
```

## 6. Anti-Patterns — 흔한 실수

| Wrong | Correct | 이유 |
|-------|---------|------|
| `StockManager` | `StockService` | 표준 접미사를 쓴다 |
| `handleUsage()` | `use()` | 도메인 동사 |
| `amt`, `qty` | `amount`, `quantity` | 완전한 이름 |
| `expired()` | `isExpired` | 불리언 프로퍼티 패턴 |

> ⚠️ 주의: 에러 메시지 표기(`"User not found"` vs `"[userId = $id] 사용자를 찾을 수 없습니다."`)는 이름 짓기가 아니라 에러 메시지 규약이다 — `./error-handling.md`의 Anti-Patterns 절에서 다룬다.

## 7. 이런 생각이 들면 멈춰라

| 이런 생각이 들면 | 실제로는 |
|---|---|
| `process`/`handle` 같은 이름을 메서드에 쓴다 | 도메인 동사를 써야 한다 |
| 변수 이름을 짧게 줄인다 (`amt`, `qty`) | 완전하고 설명적인 이름이 필요하다 |

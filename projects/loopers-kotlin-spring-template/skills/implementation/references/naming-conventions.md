# Naming Conventions

## Why This Matters
Inconsistent naming (StockManager vs StockService) creates cognitive overhead when identifying component roles.
Abbreviations (amt, qty) are interpreted differently by team members, increasing code review and debugging time.
Standard suffixes and full names speed up codebase navigation and clarify team communication.

## Component Naming

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

## Method Naming

**Use domain verbs, NOT technical verbs**

| Domain Verb | Technical Verb (Wrong) |
|-------------|------------------------|
| `use()` | `handleUsage()`, `processUsage()` |
| `expire()` | `processExpiration()`, `handleExpiration()` |
| `cancel()` | `executeCancellation()`, `performCancel()` |
| `issue()` | `processIssuance()` |
| `pay()` | `processPayment()` |
| `complete()` | `handleCompletion()` |

## Variable Naming

**Full descriptive names required**

| Correct | Wrong |
|---------|-------|
| `totalProductAmount` | `amt`, `total` |
| `discountAmount` | `disc` |
| `quantity` | `qty` |
| `shippingFee` | `fee` |
| `userId` | `uid` |
| `orderId` | `oid` |

## Boolean Naming

| Type | Pattern | Example |
|------|---------|---------|
| Property | `is{Adjective}` | `isExpired`, `isUsable`, `isActive` |
| Method (has) | `has{Noun}` | `hasBalance()`, `hasCoupon()` |
| Method (can) | `canBe{Verb}` | `canBeUsed()`, `canBeReordered()` |

## Message Conventions

### Error Messages

- Language: **Korean**
- Format: `[field = $value]` prefix **AT THE START**

```kotlin
// Correct
"[userId = $userId] 사용자를 찾을 수 없습니다."
"[pointId = $id] 잔액이 부족합니다. 필요=$amount, 보유=$balance"
"[orderId = $id] 이미 취소된 주문입니다."

// Wrong - prefix at end
"사용자를 찾을 수 없습니다. [userId = $userId]"

// Wrong - English
"[userId = $userId] User not found."

// Wrong - no context
"사용자를 찾을 수 없습니다."
```

### KDoc

- Language: Korean

```kotlin
/**
 * 주문을 생성합니다.
 *
 * @param command 주문 생성 명령
 * @return 생성된 주문
 * @throws CoreException 재고 부족 시
 */
fun create(command: OrderCommand.Create): Order
```

## Anti-Patterns

| Wrong | Correct | Reason |
|-------|---------|--------|
| `StockManager` | `StockService` | Use standard suffix |
| `handleUsage()` | `use()` | Domain verb |
| `amt`, `qty` | `amount`, `quantity` | Full names |
| `expired()` | `isExpired` | Boolean property pattern |
| `"User not found"` | `"[userId = $id] 사용자를 찾을 수 없습니다."` | Korean + context |

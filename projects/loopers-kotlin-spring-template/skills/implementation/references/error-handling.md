# Error Handling Reference

## Why This Matters
Domain-specific exception classes (OrderNotFoundException, CouponExpiredException) proliferating leads to inconsistent API response formats.
Clients must handle dozens of exception types individually, and error logging becomes fragmented.
Single CoreException + ErrorType enum provides consistent responses, centralized logging, and predictable error handling.

## CoreException + ErrorType Pattern

This project uses a **single exception type**.

```kotlin
class CoreException(
    val errorType: ErrorType,
    val customMessage: String? = null,
) : RuntimeException(customMessage ?: errorType.message)
```

## ErrorType Enum

```kotlin
enum class ErrorType(
    val status: HttpStatus,
    val code: String,
    val message: String
) {
    // General
    INTERNAL_ERROR(HttpStatus.INTERNAL_SERVER_ERROR, "Internal Server Error", "A temporary error has occurred."),
    BAD_REQUEST(HttpStatus.BAD_REQUEST, "Bad Request", "Invalid request."),
    NOT_FOUND(HttpStatus.NOT_FOUND, "Not Found", "Resource does not exist."),
    CONFLICT(HttpStatus.CONFLICT, "Conflict", "Resource already exists."),

    // Domain-specific additions (examples)
    INSUFFICIENT_BALANCE(HttpStatus.BAD_REQUEST, "Insufficient Balance", "Insufficient balance."),
    COUPON_EXPIRED(HttpStatus.BAD_REQUEST, "Coupon Expired", "The coupon has expired."),
    ALREADY_USED(HttpStatus.CONFLICT, "Already Used", "The resource has already been used."),
}
```

## Usage Patterns

### 1. Not Found Handling

```kotlin
fun findById(id: Long): Entity {
    return repository.findById(id)
        ?: throw CoreException(
            errorType = ErrorType.NOT_FOUND,
            customMessage = "[id = $id] 엔티티를 찾을 수 없습니다."
        )
}
```

### 2. Business Rule Violation

```kotlin
fun use(amount: Long) {
    if (balance < amount) {
        throw CoreException(
            errorType = ErrorType.INSUFFICIENT_BALANCE,
            customMessage = "[pointId = $id] 잔액이 부족합니다. 필요=$amount, 보유=$balance"
        )
    }
}
```

### 3. State Transition Failure

```kotlin
fun expire() {
    if (status != PointStatus.ACTIVE) {
        throw CoreException(
            errorType = ErrorType.BAD_REQUEST,
            customMessage = "[pointId = $id] 현재 상태에서 만료할 수 없습니다. 현재상태=$status"
        )
    }
    status = PointStatus.EXPIRED
}
```

### 4. Duplicate Check

```kotlin
fun validateUnique(code: String) {
    if (repository.existsByCode(code)) {
        throw CoreException(
            errorType = ErrorType.CONFLICT,
            customMessage = "[code = $code] 이미 존재하는 코드입니다."
        )
    }
}
```

## Error Message Rules

### Context Prefix Pattern

```
[field = $value] 설명
```

**Examples:**
- `[couponId = 123] 쿠폰을 찾을 수 없습니다.`
- `[userId = 456, orderId = 789] 해당 주문에 대한 권한이 없습니다.`
- `[pointId = 1] 잔액이 부족합니다. 필요=1000, 보유=500`

### Message Writing Principles

1. **Include Context** (for debugging ease)
2. **Include State Information** (for problem identification)
3. **Keep it Short and Clear** (for log readability)
4. **Be Descriptive** (developer/log readability)

## Anti-Patterns

### ❌ Using Generic Exceptions

```kotlin
// Wrong
throw IllegalArgumentException("Invalid amount")
throw RuntimeException("Error occurred")
throw IllegalStateException("Cannot process")
```

### ❌ Creating Domain-Specific Exception Classes

```kotlin
// Wrong - Not the project pattern
sealed class CouponException : RuntimeException() {
    class CouponExpiredException : CouponException()
    class CouponNotFoundException : CouponException()
}

// Wrong - Even enum-based domain-specific exception classes are prohibited
class OrderException(
    val errorType: OrderErrorType,  // ❌ Separate enum
    message: String
) : RuntimeException(message)

enum class OrderErrorType { ORDER_NOT_FOUND, INSUFFICIENT_STOCK }  // ❌

// Correct approach: Add to existing ErrorType and use CoreException
throw CoreException(ErrorType.INSUFFICIENT_STOCK, "[orderId = $id] ...")  // ✅
```

### ❌ Context-less Messages

```kotlin
// Wrong
throw CoreException(ErrorType.NOT_FOUND, "Coupon not found.")
// Cannot identify which coupon
```

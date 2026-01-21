# Error Handling Reference

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
            customMessage = "[id = $id] Entity not found."
        )
}
```

### 2. Business Rule Violation

```kotlin
fun use(amount: Long) {
    if (balance < amount) {
        throw CoreException(
            errorType = ErrorType.INSUFFICIENT_BALANCE,
            customMessage = "[pointId = $id] Insufficient balance. required=$amount, available=$balance"
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
            customMessage = "[pointId = $id] Cannot expire in current state. currentStatus=$status"
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
            customMessage = "[code = $code] Code already exists."
        )
    }
}
```

## Error Message Rules

### Context Prefix Pattern

```
[field = $value] Description
```

**Examples:**
- `[couponId = 123] Coupon not found.`
- `[userId = 456, orderId = 789] No permission for this order.`
- `[pointId = 1] Insufficient balance. required=1000, available=500`

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

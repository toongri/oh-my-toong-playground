# Error Handling Reference

## Why This Matters
Domain-specific exception classes (OrderNotFoundException, CouponExpiredException) proliferating leads to inconsistent API response formats.
Clients must handle dozens of exception types individually, and error logging becomes fragmented.
Single CoreException + ErrorType enum provides consistent responses, centralized logging, and predictable error handling.

## CoreException + ErrorType Pattern

This project uses a **single exception type**.

```java
public class CoreException extends RuntimeException {
    private final ErrorType errorType;
    private final String customMessage;

    public CoreException(ErrorType errorType, String customMessage) {
        super(customMessage != null ? customMessage : errorType.getMessage());
        this.errorType = errorType;
        this.customMessage = customMessage;
    }

    public CoreException(ErrorType errorType) {
        this(errorType, null);
    }

    public ErrorType getErrorType() { return errorType; }
    public String getCustomMessage() { return customMessage; }
}
```

## ErrorType Enum

```java
public enum ErrorType {
    // General
    INTERNAL_ERROR(HttpStatus.INTERNAL_SERVER_ERROR, "Internal Server Error", "A temporary error has occurred."),
    BAD_REQUEST(HttpStatus.BAD_REQUEST, "Bad Request", "Invalid request."),
    NOT_FOUND(HttpStatus.NOT_FOUND, "Not Found", "Resource does not exist."),
    CONFLICT(HttpStatus.CONFLICT, "Conflict", "Resource already exists."),

    // Domain-specific additions (examples)
    INSUFFICIENT_BALANCE(HttpStatus.BAD_REQUEST, "Insufficient Balance", "Insufficient balance."),
    COUPON_EXPIRED(HttpStatus.BAD_REQUEST, "Coupon Expired", "The coupon has expired."),
    ALREADY_USED(HttpStatus.CONFLICT, "Already Used", "The resource has already been used.");

    private final HttpStatus status;
    private final String code;
    private final String message;

    ErrorType(HttpStatus status, String code, String message) {
        this.status = status;
        this.code = code;
        this.message = message;
    }

    public HttpStatus getStatus() { return status; }
    public String getCode() { return code; }
    public String getMessage() { return message; }
}
```

## Usage Patterns

### 1. Not Found Handling

```java
public Entity findById(Long id) {
    final var entity = repository.findById(id);
    if (entity == null) {
        throw new CoreException(
            ErrorType.NOT_FOUND,
            "[id = " + id + "] 엔티티를 찾을 수 없습니다."
        );
    }
    return entity;
}
```

### 2. Business Rule Violation

```java
public void use(Long amount) {
    if (balance < amount) {
        throw new CoreException(
            ErrorType.INSUFFICIENT_BALANCE,
            "[pointId = " + getId() + "] 잔액이 부족합니다. 필요=" + amount + ", 보유=" + balance
        );
    }
}
```

### 3. State Transition Failure

```java
public void expire() {
    if (status != PointStatus.ACTIVE) {
        throw new CoreException(
            ErrorType.BAD_REQUEST,
            "[pointId = " + getId() + "] 현재 상태에서 만료할 수 없습니다. 현재상태=" + status
        );
    }
    this.status = PointStatus.EXPIRED;
}
```

### 4. Duplicate Check

```java
public void validateUnique(String code) {
    if (repository.existsByCode(code)) {
        throw new CoreException(
            ErrorType.CONFLICT,
            "[code = " + code + "] 이미 존재하는 코드입니다."
        );
    }
}
```

## Error Message Rules

### Context Prefix Pattern

```
[field = value] 설명
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

```java
// Wrong
throw new IllegalArgumentException("Invalid amount");
throw new RuntimeException("Error occurred");
throw new IllegalStateException("Cannot process");
```

### ❌ Creating Domain-Specific Exception Classes

```java
// Wrong - Not the project pattern
public sealed interface CouponException permits CouponException.CouponExpiredException, CouponException.CouponNotFoundException {
    class CouponExpiredException extends RuntimeException implements CouponException {}
    class CouponNotFoundException extends RuntimeException implements CouponException {}
}

// Wrong - Even enum-based domain-specific exception classes are prohibited
public class OrderException extends RuntimeException {
    private final OrderErrorType errorType;  // ❌ Separate enum
    public OrderException(OrderErrorType errorType, String message) {
        super(message);
        this.errorType = errorType;
    }
}

public enum OrderErrorType { ORDER_NOT_FOUND, INSUFFICIENT_STOCK }  // ❌

// Correct approach: Add to existing ErrorType and use CoreException
throw new CoreException(ErrorType.INSUFFICIENT_STOCK, "[orderId = " + id + "] ...");  // ✅
```

### ❌ Context-less Messages

```java
// Wrong
throw new CoreException(ErrorType.NOT_FOUND, "Coupon not found.");
// Cannot identify which coupon
```

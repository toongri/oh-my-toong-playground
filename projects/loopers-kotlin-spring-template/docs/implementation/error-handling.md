# 에러 처리 — CoreException, Null Safety, 에러 메시지

이 문서는 이 프로젝트가 실패를 어떻게 표현하는지를 다룬다 — 단일 예외 타입(`CoreException` + `ErrorType`), Null을 다루는 규칙, 에러 메시지 작성 규약.

## 목차

1. **왜 단일 예외 타입인가** — 도메인별 예외 클래스가 흩어질 때 생기는 문제
2. **CoreException + ErrorType 패턴** — 이 프로젝트가 예외를 표현하는 유일한 방법
3. **ErrorType Enum** — 상태 코드·코드·메시지를 한곳에 정의한다
4. **전역 예외 처리 — CoreException을 HTTP 응답으로 변환** — `@RestControllerAdvice`가 `ErrorType`의 상태 코드를 실제 HTTP 응답으로 옮긴다
5. **예외를 던지는 시점별 패턴** — 조회 실패·비즈니스 규칙 위반·상태 전이 실패·중복 검사
6. **Null Safety — Non-nullable 원칙과 조회 실패 처리** — nullable을 허용하지 않고, `!!` 대신 `?: throw`를 쓴다
7. **에러 메시지 규약** — 한국어, `[field = $value]` 접두사, KDoc
8. **Anti-Patterns — 흔한 실수** — 제네릭 예외, 도메인별 예외 클래스, 컨텍스트 없는 메시지
9. **이런 생각이 들면 멈춰라** — Red Flags

---

## 1. 왜 단일 예외 타입인가

`OrderNotFoundException`, `CouponExpiredException`처럼 도메인별 예외 클래스가 하나둘 늘어나면 API 응답 형식이 도메인마다 제각각이 된다. 클라이언트는 수십 개의 예외 타입을 각각 개별적으로 처리해야 하고, 에러 로깅은 도메인 수만큼 흩어진다.

이 프로젝트는 이 문제를 **단일 `CoreException` + `ErrorType` enum**으로 해결한다. 예외 타입이 하나이므로 응답 형식이 일관되고, 로깅이 한곳으로 모이며, 에러 처리가 예측 가능해진다.

## 2. CoreException + ErrorType 패턴

이 프로젝트는 **단일 예외 타입**만 쓴다. 도메인마다 별도의 예외 클래스를 만들지 않는다 — 필요한 에러 종류는 `ErrorType` enum에 항목을 추가하는 것으로 표현한다.

```kotlin
class CoreException(
    val errorType: ErrorType,
    val customMessage: String? = null,
) : RuntimeException(customMessage ?: errorType.message)
```

기본형은 다음과 같다.

```kotlin
throw CoreException(ErrorType.NOT_FOUND, "[id = $id] 엔티티를 찾을 수 없습니다.")
```

**적용 범위**: 이 단일 예외 타입 규칙이 지배하는 대상은 도메인·애플리케이션 계층과 클라이언트 대면 API 계약이다 — §1에서 든 근거(API 응답 형식이 도메인마다 제각각이 되는 것, 클라이언트가 수십 개 예외 타입을 개별 처리해야 하는 것) 둘 다 이 경계에서 발생하는 문제이기 때문이다. 인프라 어댑터가 외부 시스템(PG사 응답 실패 등)을 표현하려고 어댑터-로컬 예외 타입을 두는 것은 이 규칙 위반이 아니다 — 그 예외가 애플리케이션 계층으로 넘어오기 전에 `CoreException`으로 번역되는 한, 도메인·애플리케이션 계층과 클라이언트 응답이 예외 타입 하나만 다룬다는 사실은 그대로 유지된다.

> ⚠️ 주의: 도메인·애플리케이션 계층에서 `require()`, `IllegalArgumentException`, `RuntimeException` 같은 표준 Kotlin/Java 예외나 도메인별 예외 클래스를 던지지 마라(위 적용 범위 문단이 말하는 인프라 어댑터 경계의 어댑터-로컬 예외는 별개다). 둘 다 §8 Anti-Patterns에서 금지 사례로 다룬다.

## 3. ErrorType Enum

`ErrorType`은 HTTP 상태 코드, 에러 코드, 기본 메시지를 한곳에 묶는다. 새 에러 종류가 필요하면 이 enum에 항목을 추가한다 — 새 예외 클래스를 만들지 않는다.

```kotlin
enum class ErrorType(
    val status: HttpStatus,
    val code: String,
    val message: String
) {
    // General
    INTERNAL_ERROR(HttpStatus.INTERNAL_SERVER_ERROR, "Internal Server Error", "일시적인 오류가 발생했습니다."),
    BAD_REQUEST(HttpStatus.BAD_REQUEST, "Bad Request", "잘못된 요청입니다."),
    NOT_FOUND(HttpStatus.NOT_FOUND, "Not Found", "존재하지 않는 리소스입니다."),
    CONFLICT(HttpStatus.CONFLICT, "Conflict", "이미 존재하는 리소스입니다."),

    // Domain-specific additions (examples)
    INSUFFICIENT_BALANCE(HttpStatus.BAD_REQUEST, "Insufficient Balance", "잔액이 부족합니다."),
    COUPON_EXPIRED(HttpStatus.BAD_REQUEST, "Coupon Expired", "만료된 쿠폰입니다."),
    ALREADY_USED(HttpStatus.CONFLICT, "Already Used", "이미 사용된 리소스입니다."),
}
```

## 4. 전역 예외 처리 — CoreException을 HTTP 응답으로 변환

`CoreException`은 `ErrorType`을 들고 있는 평범한 `RuntimeException`일 뿐이다 — `errorType.status`가 존재한다고 해서 그 값이 저절로 HTTP 상태 코드가 되지는 않는다. Service가 던진 `CoreException`을 Controller 밖에서 가로채 `errorType.status`를 실제 HTTP 응답으로 옮기는 컴포넌트가 반드시 있어야 하고, 그 역할은 `@RestControllerAdvice` + `@ExceptionHandler(CoreException::class)`가 맡는다.

```kotlin
@RestControllerAdvice
class ApiControllerAdvice {
    @ExceptionHandler(CoreException::class)
    fun handleCoreException(e: CoreException): ResponseEntity<Map<String, String?>> {
        val errorType = e.errorType
        return ResponseEntity
            .status(errorType.status)
            .body(mapOf("code" to errorType.code, "message" to e.message))
    }
}
```

`errorType.status`가 응답의 HTTP 상태 코드로, `errorType.code`가 응답 본문의 에러 코드로 실린다. `e.message`는 `CoreException`의 생성자(§2)가 `customMessage ?: errorType.message`로 이미 채워 넣은 값이므로 별도 Elvis 없이 그대로 쓴다 — 커스텀 메시지를 던졌으면 그 메시지가, 안 던졌으면 `ErrorType`의 기본 `message`가 실린다. 성공 응답 래퍼 `ApiResponse<T>`([api-patterns.md](./api-patterns.md) §2, §4)의 실패측 생성자가 무엇인지는 이 문서의 관심사가 아니다 — 여기서는 `ErrorType`의 세 필드가 어디로도 새지 않고 HTTP 응답에 도달한다는 연결 지점만 보여준다.

이 핸들러가 없으면 Service에서 던진 `CoreException`이 어디서도 잡히지 않은 채 Controller를 그대로 통과해 Spring 기본 500 응답이 나간다 — `ErrorType`에 무엇을 정의하든, 이 절의 `@RestControllerAdvice`가 없으면 그 정의는 실제 응답에 아무 영향도 주지 못한다.

## 5. 예외를 던지는 시점별 패턴

`CoreException`을 던지는 지점은 크게 네 가지로 나뉜다 — 조회 실패, 비즈니스 규칙 위반, 상태 전이 실패, 중복 검사. 넷 다 형태는 같다: `ErrorType`을 고르고, `[field = $value]` 접두사가 붙은 커스텀 메시지를 채운다.

### 조회 실패 (Not Found)

```kotlin
fun findById(id: Long): Entity {
    return repository.findById(id)
        ?: throw CoreException(
            errorType = ErrorType.NOT_FOUND,
            customMessage = "[id = $id] 엔티티를 찾을 수 없습니다."
        )
}
```

### 비즈니스 규칙 위반

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

### 상태 전이 실패

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

### 중복 검사

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

## 6. Null Safety — Non-nullable 원칙과 조회 실패 처리

Null을 다루는 규칙은 엔티티 설계 문제가 아니라 예외 처리 문제다. 핵심 처방은 하나다 — 필수 필드는 애초에 nullable로 선언하지 않고, 값이 없을 수 있는 조회는 `?: throw CoreException(...)`으로 실패를 명시적으로 표현한다. `!!` 연산자는 이 규약을 우회하는 지름길이므로 금지된다.

| 규칙 | 패턴 |
|------|------|
| 필수 필드 | Non-nullable (`?` 없음) |
| 조회 실패 | `?: throw CoreException(ErrorType.NOT_FOUND, "[id = $id] ...")` |
| Optional 필드 | `?.let { }`, `listOfNotNull()` |
| **금지** | `!!` 연산자 |

### Non-nullable이 기본이다

필수 필드는 반드시 non-nullable로 선언한다.

```kotlin
@Entity
class Product(
    val name: String,           // Required - non-nullable
    val price: Money,           // Required - non-nullable
    val description: String?,   // Optional - nullable OK
)

// WRONG: 필수 필드를 nullable로 선언
var name: String? = null  // 필수 필드에는 절대 이렇게 하지 않는다
```

### `!!` 연산자는 금지한다

Elvis 연산자와 `CoreException`을 조합해서 쓴다.

```kotlin
// CORRECT: Elvis + CoreException
val user = userRepository.findById(userId)
    ?: throw CoreException(ErrorType.NOT_FOUND, "[userId = $userId] 사용자를 찾을 수 없습니다.")

// FORBIDDEN: !! 사용 금지
val user = userRepository.findById(userId)!!  // 컨텍스트 없는 NPE만 던진다
```

### Optional 데이터는 안전 호출 연산자를 쓴다

```kotlin
// CORRECT: Kotlin 관용구
couponDiscount?.let { discount -> applyDiscount(discount) }

val totalDiscount = listOfNotNull(
    couponDiscount,
    pointDiscount,
    gradeDiscount
).fold(Money.ZERO) { acc, d -> acc + d }

// WRONG: Java 스타일 null 체크
if (couponDiscount != null) {
    applyDiscount(couponDiscount)
}
```

### 종합 예시

조회 실패 처리와 상태 변경이 한 서비스 안에서 함께 나타나는 실전 형태다.

```kotlin
@Component
class OrderService(
    private val orderRepository: OrderRepository,
) {
    @Transactional(readOnly = true)
    fun findById(id: Long): Order {
        return orderRepository.findById(id)
            ?: throw CoreException(ErrorType.NOT_FOUND, "[orderId = $id] 주문을 찾을 수 없습니다.")
    }

    @Transactional
    fun pay(command: OrderCommand.Pay): Order {
        val order = orderRepository.findById(command.orderId)
            ?: throw CoreException(ErrorType.NOT_FOUND, "[orderId = ${command.orderId}] 주문을 찾을 수 없습니다.")

        order.pay()
        return orderRepository.save(order)
    }
}
```

> ⚠️ 주의: 엔티티 캡슐화 7규칙(`private set`, 팩토리 메서드, `init` 검증 등)은 이 문서의 관심사가 아니다. `./entity-patterns.md`에서 다룬다. 이 절이 다루는 건 오직 "값이 없을 수 있을 때 어떻게 실패를 표현하는가"다.

## 7. 에러 메시지 규약

에러 메시지는 **한국어**로 쓰고, `[field = $value]` 형태의 컨텍스트 접두사를 **문장 맨 앞**에 붙인다.

### 컨텍스트 접두사 패턴

```
[field = $value] 설명
```

**예시:**

- `[couponId = 123] 쿠폰을 찾을 수 없습니다.`
- `[userId = 456, orderId = 789] 해당 주문에 대한 권한이 없습니다.`
- `[pointId = 1] 잔액이 부족합니다. 필요=1000, 보유=500`
- `[orderId = $id] 이미 취소된 주문입니다.`

```kotlin
// Correct
"[userId = $userId] 사용자를 찾을 수 없습니다."
"[pointId = $id] 잔액이 부족합니다. 필요=$amount, 보유=$balance"
"[orderId = $id] 이미 취소된 주문입니다."

// Wrong - 접두사가 끝에 있다
"사용자를 찾을 수 없습니다. [userId = $userId]"

// Wrong - 영어
"[userId = $userId] User not found."

// Wrong - 컨텍스트 없음
"사용자를 찾을 수 없습니다."
```

### 메시지 작성 원칙

1. **컨텍스트를 포함한다** (디버깅을 쉽게 하기 위해)
2. **상태 정보를 포함한다** (문제를 식별하기 위해)
3. **짧고 명확하게 쓴다** (로그 가독성을 위해)
4. **설명적으로 쓴다** (개발자/로그 가독성을 위해)

### KDoc

KDoc도 한국어로 쓴다.

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

> ⚠️ 주의: 프로덕션 코드에서 예외를 어떻게 던지느냐가 이 문서의 범위다. 테스트 코드에서 예외를 어떻게 검증하느냐(`throws [SPECIFIC_ERROR] when [condition]` 네이밍, 예외 타입 관례)는 다루지 않는다 — `../testing/test-authoring.md`(예외 테스트 네이밍)와 `../testing/unit-test.md`(예외 타입 관례)를 참고하라.

## 8. Anti-Patterns — 흔한 실수

### 제네릭 예외를 던진다

```kotlin
// Wrong
throw IllegalArgumentException("Invalid amount")
throw RuntimeException("Error occurred")
throw IllegalStateException("Cannot process")
```

### 도메인별 예외 클래스를 만든다

```kotlin
// Wrong - 이 프로젝트의 패턴이 아니다
sealed class CouponException : RuntimeException() {
    class CouponExpiredException : CouponException()
    class CouponNotFoundException : CouponException()
}

// Wrong - enum 기반이어도 도메인별 예외 클래스는 금지된다
class OrderException(
    val errorType: OrderErrorType,  // ❌ 별도 enum
    message: String
) : RuntimeException(message)

enum class OrderErrorType { ORDER_NOT_FOUND, INSUFFICIENT_STOCK }  // ❌

// Correct approach: 기존 ErrorType에 추가하고 CoreException을 쓴다
throw CoreException(ErrorType.INSUFFICIENT_STOCK, "[orderId = $id] ...")  // ✅
```

### 컨텍스트 없는 메시지를 쓴다

```kotlin
// Wrong
throw CoreException(ErrorType.NOT_FOUND, "Coupon not found.")
// 어떤 쿠폰인지 식별할 수 없다
```

같은 실수가 메시지 표기 형태로도 나타난다.

| Wrong | Correct | 이유 |
|-------|---------|------|
| `"User not found"` | `"[userId = $id] 사용자를 찾을 수 없습니다."` | 한국어 + 컨텍스트 |

## 9. 이런 생각이 들면 멈춰라

| 이런 생각이 들면 | 실제로는 |
|---|---|
| `require()`면 충분하다 | `CoreException`을 써야 한다 |
| 도메인마다 예외 클래스를 따로 둔다 | 단일 `CoreException` + `ErrorType`이 원칙이다 |
| 에러 메시지는 영어로 써도 된다 | 한국어로 쓰고 `[field = $value]` 접두사를 문장 앞에 붙인다 |
| 필수 필드도 nullable로 선언한다 | 기본값은 non-nullable이다 |
| `!!` 연산자를 쓴다 | `?: throw CoreException`을 써야 한다 |

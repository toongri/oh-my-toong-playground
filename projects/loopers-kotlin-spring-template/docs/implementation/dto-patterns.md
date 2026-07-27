# DTO 흐름 — Request에서 Response까지

레이어를 넘나드는 데이터를 어떤 타입으로 나르는가 — `Request → Criteria → Command → Entity → Info → Response` 흐름의 각 DTO가 어디에 있고, 무엇을 하고, 다음 레이어로 어떻게 넘어가는지 다룬다.

## 목차

1. **왜 레이어마다 DTO를 두는가** — Entity 직접 노출과 API 버전 변경의 대가
2. **레이어별 DTO 구조** — 전체 흐름 다이어그램
3. **DTO 흐름 한 줄 요약**
4. **Request DTO** — `toCriteria()`
5. **Criteria DTO** — `to()`
6. **Command DTO**
7. **Info DTO** — `from()`
8. **Response DTO** — `from()`
9. **Controller Flow** — 흐름이 실제로 이어지는 코드
10. **안티패턴**
11. **이런 생각이 들면 멈춰라 — Critical Rules 발췌**

---

## 1. 왜 레이어마다 DTO를 두는가

Entity를 HTTP 응답으로 그대로 반환하면 내부 구조가 노출되고 지연 로딩 오류가 난다. API 버전이 바뀔 때마다 도메인 모델에 직접 영향을 주면 변경 비용이 급격히 커진다. 레이어마다 전용 DTO를 두면 레이어 경계가 분명해지고, 각 레이어가 서로 독립적으로 진화할 수 있다.

## 2. 레이어별 DTO 구조

```
HTTP Request
     │
     ▼
┌─────────────────────────────────────────────────────────┐
│  Interface Layer                                        │
│  {Domain}V1Request.{Action}                            │
│  → toCriteria() conversion                             │
└─────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────┐
│  Application Layer                                      │
│  {Domain}Criteria.{Action}                             │
│  → to() conversion                                     │
└─────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────┐
│  Domain Layer                                           │
│  {Domain}Command.{Action}                              │
│  → Entity creation/modification                        │
└─────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────┐
│  Application Layer                                      │
│  Entity → {Domain}Info.{Action}.from()                 │
└─────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────┐
│  Interface Layer                                        │
│  Info → {Domain}V1Response.{Action}.from()             │
│  → ApiResponse.success()                               │
└─────────────────────────────────────────────────────────┘
     │
     ▼
HTTP Response
```

## 3. DTO 흐름 한 줄 요약

```
Request.toCriteria() -> Criteria.to() -> Command -> Entity -> Info.from() -> Response.from()
```

여섯 단계 각각의 위치·네이밍·변환 메서드는 4~8절에서 하나씩 다룬다.

## 4. Request DTO

**Location**: `interfaces/api/{domain}/`
**Naming**: `{Domain}V{version}Request`

Request DTO는 인터페이스 레이어에서 HTTP 요청 바디를 받는다. `toCriteria()`로 다음 레이어의 Criteria로 변환한다.

```kotlin
class CouponV1Request {
    @Schema(description = "Coupon issuance request")
    data class Issue(
        @field:Schema(description = "User ID", required = true)
        val userId: Long,

        @field:Schema(description = "Coupon type", required = true)
        val couponType: String,
    ) {
        fun toCriteria(): CouponCriteria.Issue {
            return CouponCriteria.Issue(
                userId = userId,
                couponType = CouponType.valueOf(couponType),
            )
        }
    }
}
```

## 5. Criteria DTO

**Location**: `application/{domain}/`
**Naming**: `{Domain}Criteria`

Criteria DTO는 애플리케이션 레이어의 입력이다. `to()`로 도메인 레이어의 Command로 변환한다. 조회 전용 Criteria(`FindById`처럼 변환이 필요 없는 경우)는 `to()` 없이 그대로 쓰일 수 있다.

```kotlin
class CouponCriteria {
    data class Issue(
        val userId: Long,
        val couponType: CouponType,
    ) {
        fun to(): CouponCommand.Issue {
            return CouponCommand.Issue(
                userId = userId,
                couponType = couponType,
            )
        }
    }

    data class FindById(
        val couponId: Long,
    )
}
```

## 6. Command DTO

**Location**: `domain/{domain}/`
**Naming**: `{Domain}Command`

Command DTO는 도메인 레이어에서 Entity를 생성하거나 수정하는 데 쓰인다.

```kotlin
class CouponCommand {
    data class Issue(
        val userId: Long,
        val couponType: CouponType,
    )

    data class Use(
        val couponId: Long,
        val orderId: Long,
    )
}
```

## 7. Info DTO

**Location**: `application/{domain}/`
**Naming**: `{Domain}Info`

Info DTO는 Entity를 애플리케이션 레이어의 출력으로 변환한 것이다. `companion object { fun from(entity) }` 팩토리로 만든다.

```kotlin
class CouponInfo {
    data class Issue(
        val couponId: Long,
        val code: String,
        val expirationDate: LocalDateTime,
    ) {
        companion object {
            fun from(coupon: Coupon): Issue {
                return Issue(
                    couponId = coupon.id,
                    code = coupon.code,
                    expirationDate = coupon.expirationDate,
                )
            }
        }
    }

    data class Detail(
        val couponId: Long,
        val status: CouponStatus,
        val discountAmount: Money,
    ) {
        companion object {
            fun from(coupon: Coupon): Detail {
                return Detail(
                    couponId = coupon.id,
                    status = coupon.status,
                    discountAmount = coupon.discountAmount,
                )
            }
        }
    }
}
```

## 8. Response DTO

**Location**: `interfaces/api/{domain}/`
**Naming**: `{Domain}V{version}Response`

Response DTO는 인터페이스 레이어에서 HTTP 응답으로 나가는 마지막 형태다. Info로부터 `from()`으로 만든다.

```kotlin
class CouponV1Response {
    data class Issue(
        val couponId: Long,
        val code: String,
        val expirationDate: LocalDateTime,
    ) {
        companion object {
            fun from(info: CouponInfo.Issue): Issue {
                return Issue(
                    couponId = info.couponId,
                    code = info.code,
                    expirationDate = info.expirationDate,
                )
            }
        }
    }
}
```

## 9. Controller Flow

여섯 단계가 실제 Controller 코드에서 어떻게 이어지는지 보면 흐름이 분명해진다.

```kotlin
@RestController
@RequestMapping("/api/v1/coupons")
class CouponV1Controller(
    private val couponFacade: CouponFacade,
) : CouponV1ApiSpec {

    @PostMapping
    override fun issue(
        @RequestBody request: CouponV1Request.Issue,
    ): ApiResponse<CouponV1Response.Issue> {
        val criteria = request.toCriteria()          // Request → Criteria
        return couponFacade.issue(criteria)          // Facade call
            .let { CouponV1Response.Issue.from(it) } // Info → Response
            .let { ApiResponse.success(it) }         // Wrap
    }
}
```

> ⚠️ 주의: Controller가 Facade 대신 Service를 직접 호출하는 흐름의 옳고 그름, Facade의 책임 범위는 이 문서의 관심사가 아니다 — [./layer-boundaries.md](./layer-boundaries.md)에서 다룬다. 이 문서는 DTO가 레이어를 건널 때 어떤 타입으로 어떻게 변환되는지만 다룬다.

## 10. 안티패턴

### ❌ Entity 직접 노출

```kotlin
// Wrong
@GetMapping("/{id}")
fun getCoupon(@PathVariable id: Long): Coupon {
    return couponService.findById(id)  // Direct entity return
}
```

### ❌ 레이어 건너뛰기

```kotlin
// Wrong - Going directly from Request to Command
fun toCriteria() = CouponCommand.Issue(...)  // Skipped Criteria
```

### ❌ 잘못된 변환 메서드 네이밍

```kotlin
// Wrong
fun convert(): Criteria  // Use toCriteria()
fun toResponse(): Response  // Use from() (companion object)
```

### ❌ 단일 클래스 DTO

```kotlin
// Wrong - Not using nested class pattern
data class IssueCouponRequest(...)
data class IssueCouponResponse(...)

// Correct
class CouponV1Request {
    data class Issue(...)
}
class CouponV1Response {
    data class Issue(...)
}
```

## 11. 이런 생각이 들면 멈춰라 — Critical Rules 발췌

`SKILL.md`의 Critical Rules에 실린 전체 Red Flags 목록 중, DTO 흐름에 관한 것은 아래 한 행이다. 나머지 항목은 각 관심사의 형제 문서가 갖고 있다.

| Thought | Reality |
|---|---|
| "Return Entity directly" | DTO layer required |

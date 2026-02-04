# DTO Patterns Reference

## Why This Matters
Returning Entity directly as HTTP response exposes internal structure and causes lazy-loading errors.
API version changes directly impact domain models, drastically increasing change costs.
Layer-specific DTOs clarify boundaries and allow each layer to evolve independently.

## Layer-wise DTO Structure

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

## Request DTO

**Location**: `interfaces/api/{domain}/`
**Naming**: `{Domain}V{version}Request`

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

## Criteria DTO

**Location**: `application/{domain}/`
**Naming**: `{Domain}Criteria`

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

## Command DTO

**Location**: `domain/{domain}/`
**Naming**: `{Domain}Command`

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

## Info DTO

**Location**: `application/{domain}/`
**Naming**: `{Domain}Info`

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

## Response DTO

**Location**: `interfaces/api/{domain}/`
**Naming**: `{Domain}V{version}Response`

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

## Controller Flow

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

## Anti-Patterns

### ❌ Direct Entity Exposure

```kotlin
// Wrong
@GetMapping("/{id}")
fun getCoupon(@PathVariable id: Long): Coupon {
    return couponService.findById(id)  // Direct entity return
}
```

### ❌ Skipping Layers

```kotlin
// Wrong - Going directly from Request to Command
fun toCriteria() = CouponCommand.Issue(...)  // Skipped Criteria
```

### ❌ Incorrect Conversion Method Naming

```kotlin
// Wrong
fun convert(): Criteria  // Use toCriteria()
fun toResponse(): Response  // Use from() (companion object)
```

### ❌ Single Class DTOs

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

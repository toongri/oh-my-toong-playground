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
│  → toCommand() conversion                              │
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

```java
public class CouponV1Request {
    @Schema(description = "Coupon issuance request")
    public record Issue(
        @Schema(description = "User ID", required = true)
        Long userId,

        @Schema(description = "Coupon type", required = true)
        String couponType
    ) {
        public CouponCriteria.Issue toCriteria() {
            return new CouponCriteria.Issue(
                userId,
                CouponType.valueOf(couponType)
            );
        }
    }
}
```

## Criteria DTO

**Location**: `application/{domain}/`
**Naming**: `{Domain}Criteria`

```java
public class CouponCriteria {
    public record Issue(
        Long userId,
        CouponType couponType
    ) {
        public CouponCommand.Issue toCommand() {
            return new CouponCommand.Issue(
                userId,
                couponType
            );
        }
    }

    public record FindById(
        Long couponId
    ) {}
}
```

## Command DTO

**Location**: `domain/{domain}/`
**Naming**: `{Domain}Command`

```java
public class CouponCommand {
    public record Issue(
        Long userId,
        CouponType couponType
    ) {}

    public record Use(
        Long couponId,
        Long orderId
    ) {}
}
```

## Info DTO

**Location**: `application/{domain}/`
**Naming**: `{Domain}Info`

```java
public class CouponInfo {
    public record Issue(
        Long couponId,
        String code,
        LocalDateTime expirationDate
    ) {
        public static Issue from(Coupon coupon) {
            return new Issue(
                coupon.getId(),
                coupon.getCode(),
                coupon.getExpirationDate()
            );
        }
    }

    public record Detail(
        Long couponId,
        CouponStatus status,
        Money discountAmount
    ) {
        public static Detail from(Coupon coupon) {
            return new Detail(
                coupon.getId(),
                coupon.getStatus(),
                coupon.getDiscountAmount()
            );
        }
    }
}
```

## Response DTO

**Location**: `interfaces/api/{domain}/`
**Naming**: `{Domain}V{version}Response`

```java
public class CouponV1Response {
    public record Issue(
        Long couponId,
        String code,
        LocalDateTime expirationDate
    ) {
        public static Issue from(CouponInfo.Issue info) {
            return new Issue(
                info.couponId(),
                info.code(),
                info.expirationDate()
            );
        }
    }
}
```

## Controller Flow

```java
@RestController
@RequestMapping("/api/v1/coupons")
public class CouponV1Controller implements CouponV1ApiSpec {

    private final CouponFacade couponFacade;

    public CouponV1Controller(CouponFacade couponFacade) {
        this.couponFacade = couponFacade;
    }

    @PostMapping
    @Override
    public ApiResponse<CouponV1Response.Issue> issue(
        @RequestBody CouponV1Request.Issue request
    ) {
        var criteria = request.toCriteria();          // Request → Criteria
        var info = couponFacade.issue(criteria);      // Facade call
        var response = CouponV1Response.Issue.from(info);  // Info → Response
        return ApiResponse.success(response);         // Wrap
    }
}
```

## Anti-Patterns

### ❌ Direct Entity Exposure

```java
// Wrong
@GetMapping("/{id}")
public Coupon getCoupon(@PathVariable Long id) {
    return couponService.findById(id);  // Direct entity return
}
```

### ❌ Skipping Layers

```java
// Wrong - Going directly from Request to Command
public CouponCommand.Issue toCriteria() { return new CouponCommand.Issue(...); }  // Skipped Criteria
```

### ❌ Incorrect Conversion Method Naming

```java
// Wrong
public Criteria convert();  // Use toCriteria()
public Response toResponse();  // Use from() (static factory)
```

### ❌ Single Class DTOs

```java
// Wrong - Not using nested class pattern
public record IssueCouponRequest(...) {}
public record IssueCouponResponse(...) {}

// Correct
public class CouponV1Request {
    public record Issue(...) {}
}
public class CouponV1Response {
    public record Issue(...) {}
}
```

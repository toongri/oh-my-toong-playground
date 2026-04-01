# Green Batch 2 - Implementation Skill Test Results (IM-11 ~ IM-20)

## IM-11: 모든 가변 프로퍼티는 private으로 선언하고 도메인 메서드로만 변경한다

### Generated Code

```java
@Entity
@Table(
    name = "coupons",
    indexes = {
        @Index(name = "idx_coupon_user_id", columnList = "user_id"),
        @Index(name = "idx_coupon_status", columnList = "status"),
    }
)
@Getter
public class Coupon extends BaseEntity {

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private CouponType couponType;

    @Column(nullable = false)
    private Money discountAmount;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private CouponStatus status;

    private Instant usedAt;

    protected Coupon() {}

    private Coupon(Long userId, CouponType couponType, Money discountAmount) {
        this.userId = userId;
        this.couponType = couponType;
        this.discountAmount = discountAmount;
        this.status = CouponStatus.ISSUED;
    }

    public void use() {
        if (status != CouponStatus.ISSUED) {
            throw new CoreException(ErrorType.BAD_REQUEST,
                "[couponId = " + getId() + "] 사용 가능한 상태가 아닙니다.");
        }
        this.status = CouponStatus.USED;
        this.usedAt = Instant.now();
        registerEvent(CouponUsedEventV1.from(this));
    }

    public static Coupon create(Long userId, CouponType couponType) {
        return new Coupon(userId, couponType, couponType.getDiscountAmount());
    }
}
```

### Verification

| VP | Check | Result |
|----|-------|--------|
| V1 | status 필드 private | PASS - `private CouponStatus status` + public setter 없음 |
| V2 | usedAt 필드 private | PASS - `private Instant usedAt` + public setter 없음 |
| V3 | 외부에서 직접 상태 변경 불가 | PASS - `@Setter` 미사용, 모든 변경은 도메인 메서드(use())를 통해 수행 |

---

## IM-12: 상태 변경은 도메인 동사 메서드로 수행한다

### Generated Code

```java
@Entity
@Table(
    name = "orders",
    indexes = {
        @Index(name = "idx_order_user_id", columnList = "user_id"),
        @Index(name = "idx_order_status", columnList = "status"),
    }
)
@Getter
public class Order extends BaseEntity {

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(nullable = false)
    private Money totalAmount;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private OrderStatus status;

    protected Order() {}

    private Order(Long userId, Money totalAmount) {
        if (!totalAmount.isPositive()) {
            throw new CoreException(ErrorType.BAD_REQUEST,
                "[totalAmount = " + totalAmount + "] 총 금액은 양수여야 합니다.");
        }
        this.userId = userId;
        this.totalAmount = totalAmount;
        this.status = OrderStatus.PENDING;
    }

    public void pay() {
        if (status != OrderStatus.PENDING) {
            throw new CoreException(ErrorType.BAD_REQUEST,
                "[orderId = " + getId() + "] 결제 가능한 상태가 아닙니다.");
        }
        this.status = OrderStatus.PAID;
        registerEvent(OrderPaidEventV1.from(this));
    }

    public void cancel() {
        if (status == OrderStatus.COMPLETED) {
            throw new CoreException(ErrorType.BAD_REQUEST,
                "[orderId = " + getId() + "] 완료된 주문은 취소할 수 없습니다.");
        }
        this.status = OrderStatus.CANCELLED;
        registerEvent(OrderCancelledEventV1.from(this));
    }

    public void complete() {
        if (status != OrderStatus.PAID) {
            throw new CoreException(ErrorType.BAD_REQUEST,
                "[orderId = " + getId() + "] 결제 완료 상태에서만 완료할 수 있습니다.");
        }
        this.status = OrderStatus.COMPLETED;
        registerEvent(OrderCompletedEventV1.from(this));
    }

    public static Order create(Long userId, Money totalAmount) {
        return new Order(userId, totalAmount);
    }
}
```

### Verification

| VP | Check | Result |
|----|-------|--------|
| V1 | 도메인 동사 메서드 존재 | PASS - `void pay()`, `void cancel()`, `void complete()` 존재 |
| V2 | setter 대신 행위 메서드 사용 | PASS - 외부에서 `order.setStatus(...)` 직접 할당 불가 (private field, no setter) |
| V3 | 상태 전이 검증 포함 | PASS - 각 메서드 내 상태 체크 후 `new CoreException(...)` throw |

---

## IM-13: Value Object는 불변이며 연산 시 새 인스턴스를 반환한다

### Generated Code

```java
public record Money(BigDecimal amount, Currency currency) implements Comparable<Money> {

    public static final Money ZERO = new Money(BigDecimal.ZERO, Currency.KRW);

    public Money add(Money other) {
        validateSameCurrency(other);
        return new Money(amount.add(other.amount), currency);
    }

    public Money subtract(Money other) {
        validateSameCurrency(other);
        return new Money(amount.subtract(other.amount), currency);
    }

    public boolean isPositive() {
        return amount.compareTo(BigDecimal.ZERO) > 0;
    }

    public boolean isNegative() {
        return amount.compareTo(BigDecimal.ZERO) < 0;
    }

    @Override
    public int compareTo(Money other) {
        validateSameCurrency(other);
        return amount.compareTo(other.amount);
    }

    private void validateSameCurrency(Money other) {
        if (currency != other.currency) {
            throw new CoreException(ErrorType.BAD_REQUEST,
                "[currency = " + currency + "] 통화가 일치하지 않습니다. other=" + other.currency);
        }
    }
}
```

### Verification

| VP | Check | Result |
|----|-------|--------|
| V1 | 모든 필드가 final | PASS - record 컴포넌트 `BigDecimal amount`, `Currency currency` 모두 final |
| V2 | 연산이 새 인스턴스 반환 | PASS - `add`, `subtract` 모두 `new Money(...)` 반환 |
| V3 | setter 없음 | PASS - record는 setter 없음 |

---

## IM-14: Entity 생성 시 생성자에서 검증하고 상태 변경 시 이벤트를 등록한다

### Generated Code

```java
@Entity
@Table(
    name = "points",
    indexes = {
        @Index(name = "idx_point_user_id", columnList = "user_id"),
        @Index(name = "idx_point_status", columnList = "status"),
    }
)
@Getter
public class Point extends BaseEntity {

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(nullable = false)
    private Money balance;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private PointStatus status;

    protected Point() {}

    private Point(Long userId, Money balance) {
        if (!balance.isPositive()) {
            throw new CoreException(ErrorType.BAD_REQUEST,
                "[balance = " + balance + "] 초기 잔액은 양수여야 합니다.");
        }
        this.userId = userId;
        this.balance = balance;
        this.status = PointStatus.ACTIVE;
    }

    public void use(Money amount) {
        if (status != PointStatus.ACTIVE) {
            throw new CoreException(ErrorType.BAD_REQUEST,
                "[pointId = " + getId() + "] 활성 상태가 아닌 포인트입니다.");
        }
        if (balance.compareTo(amount) < 0) {
            throw new CoreException(ErrorType.INSUFFICIENT_BALANCE,
                "[pointId = " + getId() + "] 잔액이 부족합니다. 필요=" + amount + ", 보유=" + balance);
        }
        this.balance = balance.subtract(amount);
        registerEvent(PointUsedEventV1.from(this, amount));
    }

    public void expire() {
        if (status != PointStatus.ACTIVE) {
            throw new CoreException(ErrorType.BAD_REQUEST,
                "[pointId = " + getId() + "] 현재 상태에서 만료할 수 없습니다. 현재상태=" + status);
        }
        this.status = PointStatus.EXPIRED;
        registerEvent(PointExpiredEventV1.from(this));
    }

    public static Point create(Long userId, Money balance) {
        return new Point(userId, balance);
    }
}
```

### Verification

| VP | Check | Result |
|----|-------|--------|
| V1 | 생성자에서 CoreException 검증 | PASS - `private Point(...) { if (!balance.isPositive()) throw new CoreException(...); }` |
| V2 | require() 미사용 | PASS - `require(...)` 호출 없음 |
| V3 | 상태 변경 시 registerEvent 호출 | PASS - `registerEvent(PointUsedEventV1.from(...))`, `registerEvent(PointExpiredEventV1.from(...))` |

---

## IM-15: 클래스 이름은 정해진 패턴을 따른다

### Generated Code

```java
// Interface Layer
public interface ShippingV1ApiSpec {
    ApiResponse<ShippingV1Response.Start> start(ShippingV1Request.Start request);
    ApiResponse<ShippingV1Response.FindAll> findAll(int page, int size);
}

@RestController
@RequestMapping("/api/v1/shippings")
@RequiredArgsConstructor
public class ShippingV1Controller implements ShippingV1ApiSpec {

    private final ShippingFacade shippingFacade;

    @PostMapping
    @Override
    public ApiResponse<ShippingV1Response.Start> start(
            @RequestBody ShippingV1Request.Start request) {
        ShippingCriteria.Start criteria = request.toCriteria();
        ShippingInfo.Start info = shippingFacade.start(criteria);
        return ApiResponse.success(ShippingV1Response.Start.from(info));
    }

    @GetMapping
    @Override
    public ApiResponse<ShippingV1Response.FindAll> findAll(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        ShippingPageQuery query = new ShippingPageQuery(page, size, null);
        ShippingInfo.FindAll info = shippingFacade.findAll(query);
        return ApiResponse.success(ShippingV1Response.FindAll.from(info));
    }
}

// Application Layer
@Component
@RequiredArgsConstructor
public class ShippingFacade {

    private final ShippingService shippingService;

    @Transactional
    public ShippingInfo.Start start(ShippingCriteria.Start criteria) {
        Shipping shipping = shippingService.start(criteria.toCommand());
        return ShippingInfo.Start.from(shipping);
    }

    @Transactional(readOnly = true)
    public ShippingInfo.FindAll findAll(ShippingPageQuery query) {
        List<Shipping> shippings = shippingService.findAll(query);
        return ShippingInfo.FindAll.from(shippings);
    }
}

// Domain Layer
@Component
@RequiredArgsConstructor
public class ShippingService {

    private final ShippingRepository shippingRepository;
    private final ApplicationEventPublisher eventPublisher;

    @Transactional
    public Shipping start(ShippingCommand.Start command) {
        Shipping shipping = Shipping.create(command.getOrderId(), command.getAddress());
        Shipping savedShipping = shippingRepository.save(shipping);
        eventPublisher.publishEvent(ShippingStartedEventV1.from(savedShipping));
        return savedShipping;
    }

    @Transactional(readOnly = true)
    public List<Shipping> findAll(ShippingPageQuery query) {
        return shippingRepository.findAll(query);
    }
}

public interface ShippingRepository {
    Shipping findById(Long id);
    Shipping save(Shipping shipping);
    List<Shipping> findAll(ShippingPageQuery query);
}

public record ShippingStartedEventV1(
        Long shippingId,
        Long orderId,
        Instant occurredAt
) implements DomainEvent {
    public static ShippingStartedEventV1 from(Shipping shipping) {
        return new ShippingStartedEventV1(shipping.getId(), shipping.getOrderId(), Instant.now());
    }
}

public class ShippingPageQuery {
    private final int page;
    private final int size;
    private final ShippingStatus status;

    public ShippingPageQuery(int page, int size, ShippingStatus status) {
        if (page < 0) {
            throw new CoreException(ErrorType.BAD_REQUEST,
                "[page = " + page + "] 페이지는 0 이상이어야 합니다.");
        }
        if (size < 1 || size > 100) {
            throw new CoreException(ErrorType.BAD_REQUEST,
                "[size = " + size + "] 페이지 크기는 1~100이어야 합니다.");
        }
        this.page = page;
        this.size = size;
        this.status = status;
    }
}
```

### Verification

| VP | Check | Result |
|----|-------|--------|
| V1 | Controller 명명 규칙 | PASS - `ShippingV1Controller` |
| V2 | Facade/Service 명명 규칙 | PASS - `ShippingFacade`, `ShippingService` |
| V3 | Event/PageQuery 명명 규칙 | PASS - `ShippingStartedEventV1`, `ShippingPageQuery` |
| V4 | ApiSpec 명명 규칙 | PASS - `ShippingV1ApiSpec` |

---

## IM-16: 메서드 이름은 도메인 동사를 사용한다

### Generated Code

```java
@Getter
public class Coupon extends BaseEntity {

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private CouponStatus status;

    private Instant usedAt;

    public void use() {
        if (status != CouponStatus.ISSUED) {
            throw new CoreException(ErrorType.BAD_REQUEST,
                "[couponId = " + getId() + "] 사용 가능한 상태가 아닙니다.");
        }
        this.status = CouponStatus.USED;
        this.usedAt = Instant.now();
        registerEvent(CouponUsedEventV1.from(this));
    }

    public void expire() {
        if (status != CouponStatus.ISSUED) {
            throw new CoreException(ErrorType.BAD_REQUEST,
                "[couponId = " + getId() + "] 만료 가능한 상태가 아닙니다.");
        }
        this.status = CouponStatus.EXPIRED;
        registerEvent(CouponExpiredEventV1.from(this));
    }

    public void cancel() {
        if (status == CouponStatus.USED) {
            throw new CoreException(ErrorType.BAD_REQUEST,
                "[couponId = " + getId() + "] 이미 사용된 쿠폰은 취소할 수 없습니다.");
        }
        this.status = CouponStatus.CANCELLED;
        registerEvent(CouponCancelledEventV1.from(this));
    }
}
```

### Verification

| VP | Check | Result |
|----|-------|--------|
| V1 | 도메인 동사 사용 | PASS - `use()`, `expire()`, `cancel()` |
| V2 | 기술적 동사 미사용 | PASS - `processUsage()`, `handleExpiration()`, `executeCancellation()` 없음 |

---

## IM-17: 변수명은 축약 없이 전체 서술형으로 작성한다

### Generated Code

```java
public class OrderCalculator {
    public Money calculateFinalAmount(
            Money totalProductAmount,
            Money discountAmount,
            Money shippingFee) {
        Money discountedAmount = totalProductAmount.subtract(discountAmount);
        Money finalPaymentAmount = discountedAmount.add(shippingFee);

        if (finalPaymentAmount.isNegative()) {
            throw new CoreException(ErrorType.BAD_REQUEST,
                "[finalPaymentAmount = " + finalPaymentAmount + "] 최종 결제 금액은 음수일 수 없습니다.");
        }

        return finalPaymentAmount;
    }
}
```

### Verification

| VP | Check | Result |
|----|-------|--------|
| V1 | 전체 서술형 변수명 사용 | PASS - `totalProductAmount`, `discountAmount`, `shippingFee`, `finalPaymentAmount` |
| V2 | 축약 변수명 미사용 | PASS - `amt`, `disc`, `qty`, `fee` 단독 사용 없음 |

---

## IM-18: Boolean 이름은 is/has/canBe 접두사를 사용한다

### Generated Code

```java
@Getter
public class Coupon extends BaseEntity {

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private CouponStatus status;

    private int remainingQuantity;

    private LocalDateTime expirationDate;

    public boolean isExpired() {
        return expirationDate.isBefore(LocalDateTime.now());
    }

    public boolean hasRemainingQuantity() {
        return remainingQuantity > 0;
    }

    public boolean canBeUsed() {
        return status == CouponStatus.ISSUED && !isExpired() && hasRemainingQuantity();
    }
}
```

### Verification

| VP | Check | Result |
|----|-------|--------|
| V1 | is{Adjective} 패턴 | PASS - `isExpired()` |
| V2 | has{Noun} 패턴 | PASS - `hasRemainingQuantity()` |
| V3 | canBe{Verb} 패턴 | PASS - `canBeUsed()` |

---

## IM-19: 도메인 레이어에 인프라 import를 사용하지 않는다

### Generated Code

```java
// Domain Layer - Entity (JPA 어노테이션만 허용)
package com.project.domain.order;

import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import jakarta.persistence.Index;
import jakarta.persistence.Column;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
// @Transactional, @JsonProperty, Spring Data - 사용 금지

@Entity
@Table(
    name = "orders",
    indexes = {
        @Index(name = "idx_order_user_id", columnList = "user_id"),
        @Index(name = "idx_order_status", columnList = "status"),
    }
)
@Getter
public class Order extends BaseEntity {

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(nullable = false)
    private Money totalAmount;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false)
    private OrderStatus status;

    protected Order() {}

    private Order(Long userId, Money totalAmount) {
        if (!totalAmount.isPositive()) {
            throw new CoreException(ErrorType.BAD_REQUEST,
                "[totalAmount = " + totalAmount + "] 총 금액은 양수여야 합니다.");
        }
        this.userId = userId;
        this.totalAmount = totalAmount;
        this.status = OrderStatus.PENDING;
    }

    public void pay() {
        if (status != OrderStatus.PENDING) {
            throw new CoreException(ErrorType.BAD_REQUEST,
                "[orderId = " + getId() + "] 결제 가능한 상태가 아닙니다.");
        }
        this.status = OrderStatus.PAID;
        registerEvent(OrderPaidEventV1.from(this));
    }

    public static Order create(Long userId, Money totalAmount) {
        return new Order(userId, totalAmount);
    }
}

// Domain Layer - Service (@Component 허용, @Transactional 사용)
package com.project.domain.order;

import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
@RequiredArgsConstructor
public class OrderService {

    private final OrderRepository orderRepository;

    @Transactional(readOnly = true)
    public Order findById(Long id) {
        Order order = orderRepository.findById(id);
        if (order == null) {
            throw new CoreException(ErrorType.NOT_FOUND,
                "[orderId = " + id + "] 주문을 찾을 수 없습니다.");
        }
        return order;
    }

    @Transactional
    public Order pay(OrderCommand.Pay command) {
        Order order = orderRepository.findById(command.getOrderId());
        if (order == null) {
            throw new CoreException(ErrorType.NOT_FOUND,
                "[orderId = " + command.getOrderId() + "] 주문을 찾을 수 없습니다.");
        }
        order.pay();
        return orderRepository.save(order);
    }
}
```

### Verification

| VP | Check | Result |
|----|-------|--------|
| V1 | Entity에 JPA 어노테이션 허용 | PASS - `@Entity`, `@Table`, `@Column`, `@Enumerated` 사용 |
| V2 | Entity에 @Transactional 없음 | PASS - Entity 클래스에 `@Transactional` import/사용 없음 |
| V3 | Entity에 @JsonProperty 없음 | PASS - JSON 관련 어노테이션 없음 |
| V4 | Entity에 Spring Data import 없음 | PASS - Spring Data import 없음 |

---

## IM-20: Repository는 도메인에 인터페이스, 인프라에 구현체를 둔다

### Generated Code

```java
// Domain Layer - Interface
package com.project.domain.order;

public interface OrderRepository {
    Order findById(Long id);
    Order save(Order order);
    List<Order> findAllByUserId(Long userId);
}

// Infrastructure Layer - Implementation
package com.project.infrastructure.persistence.order;

import com.project.domain.order.Order;
import com.project.domain.order.OrderRepository;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
@RequiredArgsConstructor
public class OrderRdbRepository implements OrderRepository {

    private final OrderJpaRepository orderJpaRepository;

    @Override
    public Order findById(Long id) {
        return orderJpaRepository.findById(id).orElse(null);
    }

    @Override
    public Order save(Order order) {
        return orderJpaRepository.save(order);
    }

    @Override
    public List<Order> findAllByUserId(Long userId) {
        return orderJpaRepository.findAllByUserId(userId);
    }
}

public interface OrderJpaRepository extends JpaRepository<Order, Long> {
    List<Order> findAllByUserId(Long userId);
}
```

### Verification

| VP | Check | Result |
|----|-------|--------|
| V1 | 도메인에 인터페이스 존재 | PASS - `interface OrderRepository` in `domain/order/` |
| V2 | 인프라에 구현체 존재 | PASS - `class OrderRdbRepository implements OrderRepository` in `infrastructure/` |
| V3 | 도메인에 JPA import 없음 | PASS - Domain interface에 `JpaRepository` import 없음 |

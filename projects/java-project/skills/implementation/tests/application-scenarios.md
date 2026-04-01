# Application Scenarios - Implementation Skill

29개의 Application Scenario로 구성. 각 시나리오는 Implementation SKILL.md의 특정 규칙/하위규칙을 검증한다.

## Scenario Format

각 시나리오는 다음 구조를 따른다:
- **ID**: IM-XX
- **Rule**: 해당 규칙 번호 및 이름
- **Sub-rule**: 테스트 대상 하위규칙
- **Input**: 한국어 개발 과제 (+ 필요시 코드 컨텍스트)
- **Verification Points**: 검증 항목 (2-4개)
- **Expected Correct Output**: 규칙을 올바르게 따른 Java 코드

---

### IM-01: Controller는 Facade만 주입한다

**Rule**: 1. Controller Flow
**Sub-rule**: Controller -> Facade -> Service (never Controller -> Service)

**Input**:
상품 도메인에 "상품 상세 조회" API 엔드포인트를 추가해 주세요. GET /api/v1/products/{id} 엔드포인트입니다.

**Verification Points**:
| VP | Check | Expected |
|----|-------|----------|
| V1 | Controller 생성자에 Facade 주입 | `private final ProductFacade productFacade` 존재 |
| V2 | Controller 생성자에 Service 직접 주입 없음 | `ProductService` 주입 없음 |
| V3 | Controller가 ApiSpec 구현 | `implements ProductV1ApiSpec` 존재 |

**Expected Correct Output**:
```java
@RestController
@RequestMapping("/api/v1/products")
@RequiredArgsConstructor
public class ProductV1Controller implements ProductV1ApiSpec {

    private final ProductFacade productFacade;  // Facade, NOT Service

    @GetMapping("/{id}")
    @Override
    public ApiResponse<ProductV1Response.Detail> getDetail(
            @PathVariable Long id) {
        ProductCriteria.FindById criteria = new ProductCriteria.FindById(id);
        ProductInfo.Detail info = productFacade.findById(criteria);
        return ApiResponse.success(ProductV1Response.Detail.from(info));
    }
}
```

---

### IM-02: Facade는 여러 Service를 조합하며 @Transactional을 관리한다

**Rule**: 2. Layer Responsibilities
**Sub-rule**: Facade @Transactional + multi-Service coordination

**Input**:
주문 생성 기능을 구현해 주세요. 주문 시 쿠폰 사용과 포인트 차감이 함께 이루어져야 합니다. 세 도메인(주문, 쿠폰, 포인트)의 작업이 하나의 트랜잭션으로 묶여야 합니다.

**Verification Points**:
| VP | Check | Expected |
|----|-------|----------|
| V1 | Facade에 @Transactional 선언 | `@Transactional` 어노테이션 존재 |
| V2 | 다수 Service 주입 | `orderService`, `couponService`, `pointService` 주입 |
| V3 | Facade가 비즈니스 로직 없이 조율만 수행 | 비즈니스 로직 if/switch 없음 (선택적 서비스 호출을 위한 null 체크는 허용) |

**Expected Correct Output**:
```java
@Component
@RequiredArgsConstructor
public class OrderFacade {

    private final OrderService orderService;
    private final CouponService couponService;
    private final PointService pointService;
    private final ApplicationEventPublisher eventPublisher;

    @Transactional
    public OrderInfo.Create createOrder(OrderCriteria.Create criteria) {
        if (criteria.getCouponId() != null) {
            couponService.use(new CouponCommand.Use(criteria.getCouponId()));
        }

        if (criteria.getPointAmount() != null) {
            pointService.use(new PointCommand.Use(criteria.getUserId(), criteria.getPointAmount()));
        }

        Order order = orderService.create(criteria.toCommand());
        eventPublisher.publishEvent(OrderCreatedEventV1.from(order));

        return OrderInfo.Create.from(order);
    }
}
```

---

### IM-03: Service는 단일 도메인에만 의존하고 조회에 readOnly를 사용한다

**Rule**: 2. Layer Responsibilities
**Sub-rule**: Service single domain + readOnly

**Input**:
쿠폰 도메인의 Service를 구현해 주세요. 쿠폰 ID로 단건 조회하는 메서드와 쿠폰을 발급하는 메서드가 필요합니다.

**Verification Points**:
| VP | Check | Expected |
|----|-------|----------|
| V1 | 다른 도메인 Service 주입 없음 | `OrderService`, `PointService` 등 타 도메인 Service 없음 |
| V2 | 조회 메서드에 readOnly=true | `@Transactional(readOnly = true)` 존재 |
| V3 | 자기 도메인 Repository만 주입 | `private final CouponRepository couponRepository`만 존재 |

**Expected Correct Output**:
```java
@Component
@RequiredArgsConstructor
public class CouponService {

    private final CouponRepository couponRepository;
    private final ApplicationEventPublisher eventPublisher;

    @Transactional(readOnly = true)
    public Coupon findById(Long id) {
        Coupon coupon = couponRepository.findById(id);
        if (coupon == null) {
            throw new CoreException(ErrorType.NOT_FOUND, "[couponId = " + id + "] 쿠폰을 찾을 수 없습니다.");
        }
        return coupon;
    }

    @Transactional
    public Coupon issue(CouponCommand.Issue command) {
        Coupon coupon = Coupon.create(command.getUserId(), command.getCouponType());
        return couponRepository.save(coupon);
    }
}
```

---

### IM-04: Facade에는 비즈니스 로직을 두지 않는다

**Rule**: 2. Layer Responsibilities
**Sub-rule**: Facade coordination only

**Input**:
주문 처리 기능을 구현해 주세요. 주문 유형(일반/구독/예약)에 따라 다른 처리 로직이 필요합니다.

기존 코드 컨텍스트:
```java
public enum OrderType { REGULAR, SUBSCRIPTION, RESERVATION }
```

**Verification Points**:
| VP | Check | Expected |
|----|-------|----------|
| V1 | Facade에 if/switch 분기 없음 | 조건 분기가 Service 또는 Entity에 위임됨 |
| V2 | Facade는 Service 호출만 수행 | `orderService.process(...)` 형태의 단순 위임 |
| V3 | 비즈니스 로직이 Service/Entity에 존재 | Service 또는 Entity 내부에서 타입별 분기 처리 |

**Expected Correct Output**:
```java
// Facade - 조율만 담당
@Component
@RequiredArgsConstructor
public class OrderFacade {

    private final OrderService orderService;

    @Transactional
    public OrderInfo.Process processOrder(OrderCriteria.Process criteria) {
        Order order = orderService.process(criteria.toCommand());
        return OrderInfo.Process.from(order);
    }
}

// Service - 비즈니스 로직 담당
@Component
@RequiredArgsConstructor
public class OrderService {

    private final OrderRepository orderRepository;

    @Transactional
    public Order process(OrderCommand.Process command) {
        Order order = orderRepository.findById(command.getOrderId());
        if (order == null) {
            throw new CoreException(ErrorType.NOT_FOUND,
                "[orderId = " + command.getOrderId() + "] 주문을 찾을 수 없습니다.");
        }
        order.process();  // Entity 내부에서 타입별 처리
        return orderRepository.save(order);
    }
}
```

---

### IM-05: 단일 CoreException + ErrorType 패턴을 사용한다

**Rule**: 3. Error Handling
**Sub-rule**: CoreException + ErrorType

**Input**:
포인트 도메인에서 다음 에러 상황들을 처리해 주세요:
1. 포인트 조회 시 존재하지 않는 경우
2. 잔액 부족으로 포인트 사용이 불가한 경우
3. 이미 만료된 포인트를 사용하려는 경우

**Verification Points**:
| VP | Check | Expected |
|----|-------|----------|
| V1 | CoreException만 사용 | `throw new CoreException(...)` 패턴만 존재 |
| V2 | ErrorType enum 활용 | `ErrorType.NOT_FOUND`, `ErrorType.INSUFFICIENT_BALANCE`, `ErrorType.BAD_REQUEST` 사용 |
| V3 | require() 사용 없음 | `require(...)` 호출 없음 |
| V4 | 도메인별 Exception 클래스 없음 | `PointException`, `PointNotFoundException` 등 없음 |

**Expected Correct Output**:
```java
@Component
@RequiredArgsConstructor
public class PointService {

    private final PointRepository pointRepository;

    @Transactional(readOnly = true)
    public Point findById(Long id) {
        Point point = pointRepository.findById(id);
        if (point == null) {
            throw new CoreException(ErrorType.NOT_FOUND, "[pointId = " + id + "] 포인트를 찾을 수 없습니다.");
        }
        return point;
    }

    @Transactional
    public Point use(PointCommand.Use command) {
        Point point = pointRepository.findById(command.getPointId());
        if (point == null) {
            throw new CoreException(ErrorType.NOT_FOUND,
                "[pointId = " + command.getPointId() + "] 포인트를 찾을 수 없습니다.");
        }
        point.use(command.getAmount());
        return pointRepository.save(point);
    }
}

// Entity 내부
public class Point extends BaseEntity {
    public void use(Money amount) {
        if (status == PointStatus.EXPIRED) {
            throw new CoreException(ErrorType.BAD_REQUEST,
                "[pointId = " + getId() + "] 이미 만료된 포인트입니다.");
        }
        if (balance.compareTo(amount) < 0) {
            throw new CoreException(ErrorType.INSUFFICIENT_BALANCE,
                "[pointId = " + getId() + "] 잔액이 부족합니다. 필요=" + amount + ", 보유=" + balance);
        }
        this.balance = balance.subtract(amount);
    }
}
```

---

### IM-06: DTO 변환 체인을 완전하게 구성한다

**Rule**: 4. DTO Flow
**Sub-rule**: Full transformation chain

**Input**:
쿠폰 발급 API를 구현해 주세요. POST /api/v1/coupons 엔드포인트이며, 사용자 ID와 쿠폰 타입을 받아 쿠폰을 발급합니다. Request -> Criteria -> Command -> Entity -> Info -> Response 전체 흐름을 구현해야 합니다.

**Verification Points**:
| VP | Check | Expected |
|----|-------|----------|
| V1 | Request.toCriteria() 변환 존재 | `CouponV1Request.Issue`에 `toCriteria()` 메서드 |
| V2 | Criteria.toCommand() 변환 존재 | `CouponCriteria.Issue`에 `toCommand()` 메서드 |
| V3 | Info.from(entity) static 팩토리 존재 | `CouponInfo.Issue`에 `public static Issue from(Coupon coupon)` |
| V4 | Response.from(info) static 팩토리 존재 | `CouponV1Response.Issue`에 `public static Issue from(CouponInfo.Issue info)` |

**Expected Correct Output**:
```java
// Interface Layer - Request
public class CouponV1Request {
    public static class Issue {
        @Schema(description = "사용자 ID", required = true)
        private final Long userId;
        @Schema(description = "쿠폰 타입", required = true)
        private final String couponType;

        public CouponCriteria.Issue toCriteria() {
            return new CouponCriteria.Issue(userId, CouponType.valueOf(couponType));
        }
    }
}

// Application Layer - Criteria
public class CouponCriteria {
    public static class Issue {
        private final Long userId;
        private final CouponType couponType;

        public CouponCommand.Issue toCommand() {
            return new CouponCommand.Issue(userId, couponType);
        }
    }
}

// Domain Layer - Command
public class CouponCommand {
    public record Issue(Long userId, CouponType couponType) {}
}

// Application Layer - Info
public class CouponInfo {
    public static class Issue {
        private final Long couponId;
        private final String code;
        private final LocalDateTime expirationDate;

        public static Issue from(Coupon coupon) {
            return new Issue(coupon.getId(), coupon.getCode(), coupon.getExpirationDate());
        }
    }
}

// Interface Layer - Response
public class CouponV1Response {
    public static class Issue {
        private final Long couponId;
        private final String code;
        private final LocalDateTime expirationDate;

        public static Issue from(CouponInfo.Issue info) {
            return new Issue(info.getCouponId(), info.getCode(), info.getExpirationDate());
        }
    }
}

// Controller Flow
@RestController
@RequestMapping("/api/v1/coupons")
@RequiredArgsConstructor
public class CouponV1Controller implements CouponV1ApiSpec {

    private final CouponFacade couponFacade;

    @PostMapping
    @Override
    public ApiResponse<CouponV1Response.Issue> issue(
            @RequestBody CouponV1Request.Issue request) {
        CouponCriteria.Issue criteria = request.toCriteria();
        CouponInfo.Issue info = couponFacade.issue(criteria);
        return ApiResponse.success(CouponV1Response.Issue.from(info));
    }
}
```

---

### IM-07: 도메인 이벤트의 5가지 요구사항을 모두 적용한다

**Rule**: 5. Domain Events
**Sub-rule**: Event structure (naming/interface/occurredAt/factory/snapshots)

**Input**:
주문 생성 시 발행할 도메인 이벤트를 구현해 주세요. 주문에는 주문 항목(OrderItem) 목록이 포함되며, 이벤트에 주문 항목 정보도 함께 담아야 합니다.

기존 코드 컨텍스트:
```java
public class OrderItem {
    private final Long productId;
    private final String productName;
    private final int quantity;
    private final Money price;
}
```

**Verification Points**:
| VP | Check | Expected |
|----|-------|----------|
| V1 | 이벤트명에 V{n} 접미사 | `OrderCreatedEventV1` |
| V2 | DomainEvent 인터페이스 구현 | `implements DomainEvent` |
| V3 | occurredAt 필드 존재 | `private final Instant occurredAt = Instant.now()` |
| V4 | 자식 엔티티에 Snapshot 사용 | `OrderItemSnapshot` 클래스 + `public static OrderItemSnapshot from(...)` |

**Expected Correct Output**:
```java
public record OrderCreatedEventV1(
        Long orderId,
        Long userId,
        Money totalAmount,
        List<OrderItemSnapshot> items,
        Instant occurredAt
) implements DomainEvent {

    public static OrderCreatedEventV1 from(Order order) {
        return new OrderCreatedEventV1(
            order.getId(),
            order.getUserId(),
            order.getTotalAmount(),
            order.getItems().stream()
                .map(OrderItemSnapshot::from)
                .toList(),
            Instant.now()
        );
    }
}

public record OrderItemSnapshot(
        Long productId,
        String productName,
        int quantity,
        Money price
) {
    public static OrderItemSnapshot from(OrderItem item) {
        return new OrderItemSnapshot(
            item.getProductId(),
            item.getProductName(),
            item.getQuantity(),
            item.getPrice()
        );
    }
}
```

---

### IM-08: 동기 이벤트 리스너는 BEFORE_COMMIT으로 구성한다

**Rule**: 6. EventListener
**Sub-rule**: Sync listener (BEFORE_COMMIT)

**Input**:
주문 생성 시 Outbox 테이블에 이벤트를 저장하는 동기 리스너를 구현해 주세요. 주문 트랜잭션과 동일한 트랜잭션 내에서 실행되어야 합니다.

**Verification Points**:
| VP | Check | Expected |
|----|-------|----------|
| V1 | BEFORE_COMMIT phase 사용 | `@TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)` |
| V2 | 로깅 포맷 준수 | `logger.info("[Event] ... start/complete - eventType: ..., id: ...")` |
| V3 | @Async 없음 | `@Async` 어노테이션 미사용 |

**Expected Correct Output**:
```java
@Component
@RequiredArgsConstructor
public class OrderOutboxListener {

    private static final Logger logger = LoggerFactory.getLogger(OrderOutboxListener.class);
    private final OutboxService outboxService;

    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
    public void onOrderCreated(OrderCreatedEventV1 event) {
        logger.info("[Event] Order outbox save start - eventType: {}, orderId: {}",
            event.getClass().getSimpleName(), event.orderId());
        outboxService.save(new OutboxCommand.Create("ORDER_CREATED", event));
        logger.info("[Event] Order outbox save complete - eventType: {}, orderId: {}",
            event.getClass().getSimpleName(), event.orderId());
    }
}
```

---

### IM-09: 비동기 이벤트 리스너는 AFTER_COMMIT + try-catch로 구성한다

**Rule**: 6. EventListener
**Sub-rule**: Async listener (AFTER_COMMIT)

**Input**:
주문 생성 후 사용자에게 알림을 보내는 비동기 이벤트 리스너를 구현해 주세요. 알림 발송 실패가 주문 트랜잭션에 영향을 주면 안 됩니다.

**Verification Points**:
| VP | Check | Expected |
|----|-------|----------|
| V1 | @Async 어노테이션 존재 | `@Async` 사용 |
| V2 | AFTER_COMMIT phase 사용 | `@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)` |
| V3 | try-catch 에러 핸들링 | `try { ... } catch (Exception e) { logger.error(...) }` |
| V4 | 로깅 포맷 준수 | start/complete/failed 로깅 포함 |

**Expected Correct Output**:
```java
@Component
@RequiredArgsConstructor
public class OrderNotificationListener {

    private static final Logger logger = LoggerFactory.getLogger(OrderNotificationListener.class);
    private final NotificationService notificationService;

    @Async
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onOrderCreated(OrderCreatedEventV1 event) {
        logger.info("[Event] Notification start - eventType: {}, orderId: {}",
            event.getClass().getSimpleName(), event.orderId());
        try {
            notificationService.sendOrderConfirmation(event.orderId(), event.userId());
            logger.info("[Event] Notification complete - eventType: {}, orderId: {}",
                event.getClass().getSimpleName(), event.orderId());
        } catch (Exception e) {
            logger.error("[Event] Notification failed - eventType: {}, orderId: {}",
                event.getClass().getSimpleName(), event.orderId(), e);
        }
    }
}
```

---

### IM-10: Entity는 BaseEntity를 상속하고 @Table에 인덱스를 정의한다

**Rule**: 7. Entity Encapsulation
**Sub-rule**: BaseEntity + @Table indexes

**Input**:
상품(Product) 엔티티를 새로 만들어 주세요. 상품명(name), 가격(price), 카테고리 ID(categoryId) 필드가 있습니다. 상품명 검색과 카테고리별 조회가 빈번합니다.

**Verification Points**:
| VP | Check | Expected |
|----|-------|----------|
| V1 | BaseEntity 상속 | `extends BaseEntity` |
| V2 | @Table에 indexes 정의 | `indexes = {@Index(...)}` 존재 |
| V3 | 쿼리 빈도 기반 인덱스 | `name`, `category_id` 컬럼에 대한 인덱스 |

**Expected Correct Output**:
```java
@Entity
@Table(
    name = "products",
    indexes = {
        @Index(name = "idx_product_name", columnList = "name"),
        @Index(name = "idx_product_category_id", columnList = "category_id"),
    }
)
@Getter
public class Product extends BaseEntity {

    @Column(nullable = false)
    private String name;

    @Column(nullable = false)
    private Money price;

    @Column(name = "category_id", nullable = false)
    private Long categoryId;

    protected Product() {}

    private Product(String name, Money price, Long categoryId) {
        if (name.isBlank()) {
            throw new CoreException(ErrorType.BAD_REQUEST,
                "[name = " + name + "] 상품명은 비어있을 수 없습니다.");
        }
        if (!price.isPositive()) {
            throw new CoreException(ErrorType.BAD_REQUEST,
                "[price = " + price + "] 가격은 양수여야 합니다.");
        }
        this.name = name;
        this.price = price;
        this.categoryId = categoryId;
    }

    public static Product create(String name, Money price, Long categoryId) {
        return new Product(name, price, categoryId);
    }
}
```

---

### IM-11: 모든 가변 프로퍼티는 private으로 선언하고 도메인 메서드로만 변경한다

**Rule**: 7. Entity Encapsulation
**Sub-rule**: private fields (no public setter)

**Input**:
쿠폰(Coupon) 엔티티를 구현해 주세요. 상태(status), 사용일시(usedAt), 할인금액(discountAmount) 필드가 있으며 상태와 사용일시는 변경될 수 있습니다.

**Verification Points**:
| VP | Check | Expected |
|----|-------|----------|
| V1 | status 필드 private | `private CouponStatus status` (public setter 없음) |
| V2 | usedAt 필드 private | `private Instant usedAt` (public setter 없음) |
| V3 | 외부에서 직접 상태 변경 불가 | `@Setter` 미사용, setter 메서드 없음 |

**Expected Correct Output**:
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

---

### IM-12: 상태 변경은 도메인 동사 메서드로 수행한다

**Rule**: 7. Entity Encapsulation
**Sub-rule**: Behavior methods

**Input**:
주문(Order) 엔티티에 결제(pay), 취소(cancel), 완료(complete) 기능을 구현해 주세요. 각 상태 전이에는 유효성 검증이 필요합니다.

**Verification Points**:
| VP | Check | Expected |
|----|-------|----------|
| V1 | 도메인 동사 메서드 존재 | `void pay()`, `void cancel()`, `void complete()` |
| V2 | setter 대신 행위 메서드 사용 | `order.setStatus(...)` 직접 할당 없음 (외부에서) |
| V3 | 상태 전이 검증 포함 | 각 메서드 내 상태 체크 후 CoreException |

**Expected Correct Output**:
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

---

### IM-13: Value Object는 불변이며 연산 시 새 인스턴스를 반환한다

**Rule**: 7. Entity Encapsulation
**Sub-rule**: Immutable VOs

**Input**:
금액을 표현하는 Money Value Object를 구현해 주세요. 더하기, 빼기 연산과 양수/음수 확인 기능이 필요합니다.

**Verification Points**:
| VP | Check | Expected |
|----|-------|----------|
| V1 | 모든 필드가 final | `final BigDecimal amount`, `final Currency currency` |
| V2 | 연산이 새 인스턴스 반환 | `public Money add(Money other) { return new Money(...); }` |
| V3 | setter 없음 | public setter 미사용 |

**Expected Correct Output**:
```java
public record Money(BigDecimal amount, Currency currency) {

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

    private void validateSameCurrency(Money other) {
        if (currency != other.currency) {
            throw new CoreException(ErrorType.BAD_REQUEST,
                "[currency = " + currency + "] 통화가 일치하지 않습니다. other=" + other.currency);
        }
    }
}
```

---

### IM-14: Entity 생성 시 생성자에서 검증하고 상태 변경 시 이벤트를 등록한다

**Rule**: 7. Entity Encapsulation
**Sub-rule**: Constructor validation + registerEvent

**Input**:
포인트(Point) 엔티티를 구현해 주세요. 생성 시 초기 잔액은 양수여야 합니다. 포인트 사용 시 잔액 검증 후 이벤트를 발행해야 합니다.

**Verification Points**:
| VP | Check | Expected |
|----|-------|----------|
| V1 | 생성자에서 CoreException 검증 | `private Point(...) { if (!balance.isPositive()) throw new CoreException(...); }` |
| V2 | require() 미사용 | `require(...)` 호출 없음 |
| V3 | 상태 변경 시 registerEvent 호출 | `registerEvent(PointUsedEventV1.from(...))` |

**Expected Correct Output**:
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

---

### IM-15: 클래스 이름은 정해진 패턴을 따른다

**Rule**: 8. Naming
**Sub-rule**: Class naming

**Input**:
배송(Shipping) 도메인의 전체 레이어 클래스를 구현해 주세요. Controller, ApiSpec, Facade, Service, Repository, Event, PageQuery 클래스가 필요합니다.

**Verification Points**:
| VP | Check | Expected |
|----|-------|----------|
| V1 | Controller 명명 규칙 | `ShippingV1Controller` |
| V2 | Facade/Service 명명 규칙 | `ShippingFacade`, `ShippingService` |
| V3 | Event/PageQuery 명명 규칙 | `ShippingStartedEventV1`, `ShippingPageQuery` |
| V4 | ApiSpec 명명 규칙 | `ShippingV1ApiSpec` |

**Expected Correct Output**:
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
    // ...
}

// Application Layer
@Component
@RequiredArgsConstructor
public class ShippingFacade {
    private final ShippingService shippingService;
    // ...
}

// Domain Layer
@Component
@RequiredArgsConstructor
public class ShippingService {
    private final ShippingRepository shippingRepository;
    // ...
}

public interface ShippingRepository {
    Shipping findById(Long id);
    Shipping save(Shipping shipping);
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

---

### IM-16: 메서드 이름은 도메인 동사를 사용한다

**Rule**: 8. Naming
**Sub-rule**: Method naming

**Input**:
쿠폰 엔티티에 사용(use), 만료(expire), 취소(cancel) 기능 메서드를 구현해 주세요.

**Verification Points**:
| VP | Check | Expected |
|----|-------|----------|
| V1 | 도메인 동사 사용 | `use()`, `expire()`, `cancel()` |
| V2 | 기술적 동사 미사용 | `processUsage()`, `handleExpiration()`, `executeCancellation()` 없음 |

**Expected Correct Output**:
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

---

### IM-17: 변수명은 축약 없이 전체 서술형으로 작성한다

**Rule**: 8. Naming
**Sub-rule**: Variable naming

**Input**:
주문 금액 계산 로직을 구현해 주세요. 상품 총액, 할인 금액, 배송비, 최종 결제 금액을 계산합니다.

**Verification Points**:
| VP | Check | Expected |
|----|-------|----------|
| V1 | 전체 서술형 변수명 사용 | `totalProductAmount`, `discountAmount`, `shippingFee`, `finalPaymentAmount` |
| V2 | 축약 변수명 미사용 | `amt`, `disc`, `qty`, `fee` 단독 사용 없음 |

**Expected Correct Output**:
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

---

### IM-18: Boolean 이름은 is/has/canBe 접두사를 사용한다

**Rule**: 8. Naming
**Sub-rule**: Boolean naming

**Input**:
쿠폰 엔티티에 다음 상태 확인 기능을 추가해 주세요:
- 만료 여부 확인
- 잔여 수량 보유 여부
- 사용 가능 여부

**Verification Points**:
| VP | Check | Expected |
|----|-------|----------|
| V1 | is{Adjective} 패턴 | `isExpired()` |
| V2 | has{Noun} 패턴 | `hasRemainingQuantity()` |
| V3 | canBe{Verb} 패턴 | `canBeUsed()` |

**Expected Correct Output**:
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

---

### IM-19: 도메인 레이어에 인프라 import를 사용하지 않는다

**Rule**: 9. Domain Purity
**Sub-rule**: No infrastructure imports

**Input**:
주문(Order) 도메인 엔티티와 Service를 구현해 주세요. 엔티티에는 JPA 어노테이션이 필요하고, Service에는 트랜잭션 관리가 필요합니다.

**Verification Points**:
| VP | Check | Expected |
|----|-------|----------|
| V1 | Entity에 JPA 어노테이션 허용 | `@Entity`, `@Table`, `@Column` 사용 |
| V2 | Entity에 @Transactional 없음 | `@Transactional` import/사용 없음 |
| V3 | Entity에 @JsonProperty 없음 | `@JsonProperty`, `@JsonIgnore` import/사용 없음 |
| V4 | Entity에 Spring Data import 없음 | `org.springframework.data.*` import 없음 |

**Expected Correct Output**:
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
```

---

### IM-20: Repository는 도메인에 인터페이스, 인프라에 구현체를 둔다

**Rule**: 9. Domain Purity
**Sub-rule**: Repository Abstraction

**Input**:
주문(Order) 도메인의 Repository를 구현해 주세요. 도메인 레이어에 인터페이스를, 인프라스트럭처 레이어에 JPA 기반 구현체를 만들어야 합니다.

**Verification Points**:
| VP | Check | Expected |
|----|-------|----------|
| V1 | 도메인에 인터페이스 존재 | `interface OrderRepository` in `domain/order/` |
| V2 | 인프라에 구현체 존재 | `class OrderRdbRepository implements OrderRepository` in `infrastructure/` |
| V3 | 도메인에 JPA import 없음 | `JpaRepository` import 없음 (도메인 내) |

**Expected Correct Output**:
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

---

### IM-21: 필수 필드는 Non-null로 선언한다

**Rule**: 10. Null Safety
**Sub-rule**: Non-null by default

**Input**:
상품(Product) 엔티티의 필드를 정의해 주세요. 상품명(name)과 가격(price)은 필수, 설명(description)은 선택입니다.

**Verification Points**:
| VP | Check | Expected |
|----|-------|----------|
| V1 | 필수 필드 Non-null | `private String name`, `private Money price` (`@Column(nullable = false)`) |
| V2 | 선택 필드 Nullable | `@Column private String description` (`nullable = false` 없이 선언) |
| V3 | 필수 필드에 nullable 마킹 없음 | 필수 필드에 `nullable = false` 누락 없음 |

**Expected Correct Output**:
```java
@Entity
@Table(
    name = "products",
    indexes = {
        @Index(name = "idx_product_category_id", columnList = "category_id"),
    }
)
@Getter
public class Product extends BaseEntity {

    @Column(nullable = false)
    private String name;

    @Column(nullable = false)
    private Money price;

    @Column(name = "category_id", nullable = false)
    private Long categoryId;

    @Column
    private String description;  // nullable - 선택 필드

    protected Product() {}

    private Product(String name, Money price, Long categoryId, String description) {
        if (name.isBlank()) {
            throw new CoreException(ErrorType.BAD_REQUEST,
                "[name = " + name + "] 상품명은 비어있을 수 없습니다.");
        }
        if (!price.isPositive()) {
            throw new CoreException(ErrorType.BAD_REQUEST,
                "[price = " + price + "] 가격은 양수여야 합니다.");
        }
        this.name = name;
        this.price = price;
        this.categoryId = categoryId;
        this.description = description;
    }

    public static Product create(String name, Money price, Long categoryId, String description) {
        return new Product(name, price, categoryId, description);
    }
}
```

---

### IM-22: 조회 실패 시 null 체크 후 CoreException을 던진다

**Rule**: 10. Null Safety
**Sub-rule**: null check + CoreException (no !!)

**Input**:
주문 Service에서 주문 ID로 조회하는 기능을 구현해 주세요. 존재하지 않는 주문의 경우 적절한 에러를 반환해야 합니다.

**Verification Points**:
| VP | Check | Expected |
|----|-------|----------|
| V1 | null 체크 후 CoreException 패턴 | `if (order == null) throw new CoreException(ErrorType.NOT_FOUND, ...)` |
| V2 | Optional.get() 남용 없음 | `.get()` 없음 (검증 없이 Optional 언래핑 금지) |
| V3 | 에러 메시지에 컨텍스트 포함 | `[orderId = " + id + "]` 형태 |

**Expected Correct Output**:
```java
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

---

### IM-23: Optional 데이터는 명시적 null 체크로 안전하게 처리한다

**Rule**: 10. Null Safety
**Sub-rule**: Explicit null checks

**Input**:
주문 금액 계산 시 쿠폰 할인, 포인트 할인, 등급 할인이 각각 선택적으로 적용됩니다. null일 수 있는 할인 값들을 안전하게 처리하는 로직을 구현해 주세요.

**Verification Points**:
| VP | Check | Expected |
|----|-------|----------|
| V1 | null 체크 후 처리 | `if (couponDiscount != null) { ... }` |
| V2 | Stream.of().filter(Objects::nonNull) 사용 | `Stream.of(couponDiscount, pointDiscount, gradeDiscount).filter(Objects::nonNull).toList()` |
| V3 | NPE 위험 없는 안전한 처리 | null 검증 없이 메서드 호출 없음 |

**Expected Correct Output**:
```java
public class OrderAmountCalculator {
    public Money calculateFinalAmount(
            Money totalProductAmount,
            Money couponDiscount,
            Money pointDiscount,
            Money gradeDiscount,
            Money shippingFee) {

        Money totalDiscount = Stream.of(couponDiscount, pointDiscount, gradeDiscount)
            .filter(Objects::nonNull)
            .toList()
            .stream()
            .reduce(Money.ZERO, Money::add);

        Money discountedAmount = totalProductAmount.subtract(totalDiscount);
        Money finalPaymentAmount = discountedAmount.add(shippingFee);

        if (couponDiscount != null) {
            if (couponDiscount.isNegative()) {
                throw new CoreException(ErrorType.BAD_REQUEST,
                    "[couponDiscount = " + couponDiscount + "] 쿠폰 할인 금액은 음수일 수 없습니다.");
            }
        }

        return finalPaymentAmount;
    }
}
```

---

### IM-24: API 문서는 ApiSpec 인터페이스에 분리한다

**Rule**: 11. API Patterns
**Sub-rule**: ApiSpec interface

**Input**:
상품 API의 Swagger 문서화를 구현해 주세요. 상품 검색 엔드포인트에 대한 @Tag, @Operation, @ApiResponses, @Parameter 어노테이션이 필요합니다.

**Verification Points**:
| VP | Check | Expected |
|----|-------|----------|
| V1 | ApiSpec 인터페이스에 Swagger 어노테이션 | `@Tag`, `@Operation`, `@ApiResponses` in interface |
| V2 | Controller에 Swagger 어노테이션 없음 | Controller 클래스에 `@Operation` 등 없음 |
| V3 | Controller가 ApiSpec 구현 | `class ProductV1Controller implements ProductV1ApiSpec` |

**Expected Correct Output**:
```java
// ApiSpec Interface - Swagger 어노테이션은 여기에만
@Tag(name = "상품 API", description = "상품 조회 및 관리 API")
public interface ProductV1ApiSpec {

    @Operation(summary = "상품 검색", description = "키워드와 카테고리로 상품을 검색합니다.")
    @ApiResponses(value = {
        @ApiResponse(responseCode = "200", description = "검색 성공"),
        @ApiResponse(responseCode = "400", description = "잘못된 요청"),
    })
    ApiResponse<ProductV1Response.Search> search(
        @Parameter(description = "검색 키워드", example = "노트북")
        String keyword,
        @Parameter(description = "페이지 번호", example = "0")
        int page,
        @Parameter(description = "페이지 크기", example = "20")
        int size
    );
}

// Controller - Swagger 어노테이션 없이 구현만
@RestController
@RequestMapping("/api/v1/products")
@RequiredArgsConstructor
public class ProductV1Controller implements ProductV1ApiSpec {

    private final ProductFacade productFacade;

    @GetMapping("/search")
    @Override
    public ApiResponse<ProductV1Response.Search> search(
            @RequestParam(required = false) String keyword,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        ProductPageQuery query = ProductPageQuery.of(page, size, keyword);
        ProductInfo.Search info = productFacade.search(query);
        return ApiResponse.success(ProductV1Response.Search.from(info));
    }
}
```

---

### IM-25: 페이지네이션은 PageQuery 객체로 캡슐화하고 생성자에서 검증한다

**Rule**: 11. API Patterns
**Sub-rule**: PageQuery

**Input**:
상품 목록 조회를 위한 페이지네이션 Query 객체를 구현해 주세요. page는 0 이상, size는 1~100 범위만 허용합니다. 키워드와 카테고리 ID로 필터링할 수 있습니다.

**Verification Points**:
| VP | Check | Expected |
|----|-------|----------|
| V1 | 생성자에서 검증 | `private ProductPageQuery(...) { if (page < 0) throw new CoreException(...); }` |
| V2 | CoreException 사용 (require 아님) | `throw new CoreException(ErrorType.BAD_REQUEST, ...)` |
| V3 | 에러 메시지에 [field = value] 접두사 | `[page = " + page + "]`, `[size = " + size + "]` |

**Expected Correct Output**:
```java
@Getter
public class ProductPageQuery {
    private final int page;
    private final int size;
    private final String keyword;
    private final Long categoryId;

    private ProductPageQuery(int page, int size, String keyword, Long categoryId) {
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
        this.keyword = keyword;
        this.categoryId = categoryId;
    }

    public static ProductPageQuery of(int page, int size, String keyword, Long categoryId) {
        return new ProductPageQuery(page, size, keyword, categoryId);
    }

    public static ProductPageQuery of(int page, int size, String keyword) {
        return new ProductPageQuery(page, size, keyword, null);
    }
}
```

---

### IM-26: 에러 메시지는 한국어이며 [field = value] 접두사로 시작한다

**Rule**: 12. Messages
**Sub-rule**: Korean + [field=value] prefix

**Input**:
사용자 서비스에서 다음 에러 상황들의 메시지를 작성해 주세요:
1. 사용자 조회 실패
2. 이메일 중복
3. 비밀번호 형식 오류

**Verification Points**:
| VP | Check | Expected |
|----|-------|----------|
| V1 | 한국어 메시지 | 영문 메시지 없음 |
| V2 | [field = value] 접두사가 맨 앞 | 메시지 시작이 `[` |
| V3 | 접두사가 맨 뒤에 오지 않음 | `... [field = value]` 형태 없음 |

**Expected Correct Output**:
```java
@Component
@RequiredArgsConstructor
public class UserService {

    private static final Pattern PASSWORD_REGEX =
        Pattern.compile("^(?=.*[A-Za-z])(?=.*\\d)(?=.*[@$!%*?&]).{8,}$");

    private final UserRepository userRepository;

    @Transactional(readOnly = true)
    public User findById(Long id) {
        User user = userRepository.findById(id);
        if (user == null) {
            throw new CoreException(ErrorType.NOT_FOUND,
                "[userId = " + id + "] 사용자를 찾을 수 없습니다.");
        }
        return user;
    }

    @Transactional
    public User register(UserCommand.Register command) {
        if (userRepository.existsByEmail(command.getEmail())) {
            throw new CoreException(ErrorType.CONFLICT,
                "[email = " + command.getEmail() + "] 이미 존재하는 이메일입니다.");
        }

        if (!PASSWORD_REGEX.matcher(command.getPassword()).matches()) {
            throw new CoreException(ErrorType.BAD_REQUEST,
                "[password = ***] 비밀번호는 8자 이상, 영문/숫자/특수문자를 포함해야 합니다.");
        }

        User user = User.create(command.getEmail(), command.getPassword(), command.getName());
        return userRepository.save(user);
    }
}
```

---

### IM-27: 캐싱은 Facade에서만 CacheTemplate으로 수행한다

**Rule**: 13. Caching
**Sub-rule**: Cache in Facade + CacheTemplate

**Input**:
랭킹 조회 기능에 캐싱을 적용해 주세요. 주간/월간 랭킹만 캐싱 대상이며, 빈 결과는 캐싱하지 않습니다.

**Verification Points**:
| VP | Check | Expected |
|----|-------|----------|
| V1 | Facade에서 캐싱 로직 수행 | `RankingFacade`에서 `cacheTemplate` 사용 |
| V2 | @Cacheable 미사용 | `@Cacheable` 어노테이션 없음 |
| V3 | CacheTemplate API 사용 | `cacheTemplate.get(...)`, `cacheTemplate.put(...)` |

**Expected Correct Output**:
```java
@Component
@RequiredArgsConstructor
public class RankingFacade {

    private final RankingService rankingService;
    private final CacheTemplate cacheTemplate;

    public RankingInfo.FindRankings findRankings(RankingCriteria.FindRankings criteria) {
        RankingCacheKeys.RankingList cacheKey = new RankingCacheKeys.RankingList(
            criteria.getPeriod(),
            criteria.getBaseDate(),
            criteria.getOffset(),
            criteria.getLimit()
        );

        if (!cacheKey.shouldCache()) {
            List<Ranking> rankings = rankingService.findRankings(criteria.toCommand());
            return RankingInfo.FindRankings.from(rankings);
        }

        CachedRankingV1 cached = cacheTemplate.get(cacheKey, TYPE_CACHED_RANKING_V1);
        if (cached != null) {
            return RankingInfo.FindRankings.from(cached.toProductRankings());
        }

        List<Ranking> rankings = rankingService.findRankings(criteria.toCommand());

        if (!rankings.isEmpty()) {
            cacheTemplate.put(cacheKey, CachedRankingV1.from(rankings));
        }

        return RankingInfo.FindRankings.from(rankings);
    }
}
```

---

### IM-28: 캐시 키는 sealed interface로 정의하고 TTL을 내장한다

**Rule**: 13. Caching
**Sub-rule**: Cache Key sealed interface

**Input**:
상품 도메인의 캐시 키를 정의해 주세요. 상품 상세(1시간 TTL)와 상품 목록(30분 TTL) 두 가지 캐시 키가 필요합니다. 키에 버전 정보를 포함해야 합니다.

**Verification Points**:
| VP | Check | Expected |
|----|-------|----------|
| V1 | sealed interface 구조 | `sealed interface ProductCacheKeys extends CacheKey permits ProductDetail, ProductList` |
| V2 | TTL 내장 | `Duration.ofHours(1)`, `Duration.ofMinutes(30)` |
| V3 | key에 버전 포함 | `"product-cache:v1:..."` |

**Expected Correct Output**:
```java
public sealed interface ProductCacheKeys extends CacheKey
        permits ProductCacheKeys.ProductDetail, ProductCacheKeys.ProductList {

    record ProductDetail(Long productId) implements ProductCacheKeys {
        @Override
        public Duration getTtl() { return Duration.ofHours(1); }

        @Override
        public String getKey() { return "product-cache:v1:detail:" + productId; }

        @Override
        public String getTraceKey() { return "product-detail-cache"; }
    }

    record ProductList(Long categoryId, String keyword, int page, int size)
            implements ProductCacheKeys {

        @Override
        public Duration getTtl() { return Duration.ofMinutes(30); }

        @Override
        public String getKey() {
            return "product-cache:v1:list:"
                + (categoryId != null ? categoryId : "all") + ":"
                + (keyword != null ? keyword : "none") + ":"
                + page + ":" + size;
        }

        @Override
        public String getTraceKey() { return "product-list-cache"; }

        public boolean shouldCache() { return keyword == null; }
    }
}
```

---

### IM-29: 캐시 모델은 CachedXxxV1으로 버전화하고 도메인 이벤트로 무효화한다

**Rule**: 13. Caching
**Sub-rule**: CachedXxxV1 + invalidation

**Input**:
상품 캐시 모델과 무효화 로직을 구현해 주세요. 상품 정보가 변경될 때 해당 상품의 캐시만 선택적으로 무효화해야 합니다. Entity나 Response를 직접 캐싱하면 안 됩니다.

**Verification Points**:
| VP | Check | Expected |
|----|-------|----------|
| V1 | CachedXxxV1 버전화 DTO | `CachedProductDetailV1` record |
| V2 | Entity/Response 직접 캐싱 없음 | `Product`, `ProductV1Response` 캐싱 없음 |
| V3 | 도메인 이벤트 기반 무효화 | `@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)` |
| V4 | 선택적 evict (@CacheEvict/allEntries 아님) | `cacheTemplate.evict(new ProductCacheKeys.ProductDetail(...))` |

**Expected Correct Output**:
```java
// Cache Model - 전용 DTO (Entity/Response 아님)
public record CachedProductDetailV1(
        Long productId,
        String name,
        BigDecimal price,
        Long categoryId,
        String description
) {
    public ProductDetail toProductDetail() {
        return new ProductDetail(productId, name, new Money(price, Currency.KRW), categoryId, description);
    }

    public static CachedProductDetailV1 from(ProductDetail product) {
        return new CachedProductDetailV1(
            product.getProductId(),
            product.getName(),
            product.getPrice().amount(),
            product.getCategoryId(),
            product.getDescription()
        );
    }
}

// Cache Invalidation - 도메인 이벤트 리스너
@Component
@RequiredArgsConstructor
public class ProductCacheEvictionListener {

    private static final Logger logger = LoggerFactory.getLogger(ProductCacheEvictionListener.class);
    private final CacheTemplate cacheTemplate;

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onProductUpdated(ProductUpdatedEventV1 event) {
        logger.info("[Event] Product cache eviction start - eventType: {}, productId: {}",
            event.getClass().getSimpleName(), event.productId());
        cacheTemplate.evict(new ProductCacheKeys.ProductDetail(event.productId()));
        logger.info("[Event] Product cache eviction complete - eventType: {}, productId: {}",
            event.getClass().getSimpleName(), event.productId());
    }
}
```

# GREEN Phase - Batch 1 (IM-01 ~ IM-10)

Implementation Skill 적용 후 생성된 코드. 모든 VP를 통과해야 한다.

---

## IM-01: Controller는 Facade만 주입한다

### Generated Code

```java
@RestController
@RequestMapping("/api/v1/products")
@RequiredArgsConstructor
public class ProductV1Controller implements ProductV1ApiSpec {

    private final ProductFacade productFacade;

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

## IM-02: Facade는 여러 Service를 조합하며 @Transactional을 관리한다

### Generated Code

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

## IM-03: Service는 단일 도메인에만 의존하고 조회에 readOnly를 사용한다

### Generated Code

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

## IM-04: Facade에는 비즈니스 로직을 두지 않는다

### Generated Code

```java
// Facade - coordination only
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

// Service - business logic
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
        order.process();  // Entity handles type-specific processing internally
        return orderRepository.save(order);
    }
}
```

---

## IM-05: 단일 CoreException + ErrorType 패턴을 사용한다

### Generated Code

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

// Entity
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

## IM-06: DTO 변환 체인을 완전하게 구성한다

### Generated Code

```java
// Interface Layer - Request
public class CouponV1Request {
    public record Issue(
            @Schema(description = "사용자 ID", required = true) Long userId,
            @Schema(description = "쿠폰 타입", required = true) String couponType
    ) {
        public CouponCriteria.Issue toCriteria() {
            return new CouponCriteria.Issue(userId, CouponType.valueOf(couponType));
        }
    }
}

// Application Layer - Criteria
public class CouponCriteria {
    public record Issue(Long userId, CouponType couponType) {
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
    public record Issue(Long couponId, String code, LocalDateTime expirationDate) {
        public static Issue from(Coupon coupon) {
            return new Issue(coupon.getId(), coupon.getCode(), coupon.getExpirationDate());
        }
    }
}

// Interface Layer - Response
public class CouponV1Response {
    public record Issue(Long couponId, String code, LocalDateTime expirationDate) {
        public static Issue from(CouponInfo.Issue info) {
            return new Issue(info.couponId(), info.code(), info.expirationDate());
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

## IM-07: 도메인 이벤트의 5가지 요구사항을 모두 적용한다

### Generated Code

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

## IM-08: 동기 이벤트 리스너는 BEFORE_COMMIT으로 구성한다

### Generated Code

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

## IM-09: 비동기 이벤트 리스너는 AFTER_COMMIT + try-catch로 구성한다

### Generated Code

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

## IM-10: Entity는 BaseEntity를 상속하고 @Table에 인덱스를 정의한다

### Generated Code

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

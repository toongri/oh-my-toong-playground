# Red Raw Output - Standard Java/Spring Developer Code

## IM-01: 상품 상세 조회 API 엔드포인트

### Generated Code

```java
@RestController
@RequestMapping("/api/v1/products")
public class ProductController {
    private final ProductService productService;

    public ProductController(ProductService productService) {
        this.productService = productService;
    }

    @GetMapping("/{id}")
    public ResponseEntity<ProductResponse> getProduct(@PathVariable Long id) {
        Product product = productService.findById(id);
        return ResponseEntity.ok(ProductResponse.from(product));
    }
}

public class ProductResponse {
    private final Long id;
    private final String name;
    private final BigDecimal price;
    private final Long categoryId;

    public static ProductResponse from(Product product) {
        return new ProductResponse(
            product.getId(),
            product.getName(),
            product.getPrice(),
            product.getCategoryId()
        );
    }
}

@Service
public class ProductService {
    private final ProductRepository productRepository;

    public ProductService(ProductRepository productRepository) {
        this.productRepository = productRepository;
    }

    public Product findById(Long id) {
        return productRepository.findById(id)
            .orElseThrow(() -> new EntityNotFoundException("Product not found with id: " + id));
    }
}
```

## IM-02: 주문 생성 (쿠폰 사용 + 포인트 차감 트랜잭션)

### Generated Code

```java
@Service
public class OrderService {
    private final OrderRepository orderRepository;
    private final CouponService couponService;
    private final PointService pointService;

    public OrderService(OrderRepository orderRepository, CouponService couponService, PointService pointService) {
        this.orderRepository = orderRepository;
        this.couponService = couponService;
        this.pointService = pointService;
    }

    @Transactional
    public Order createOrder(CreateOrderRequest request) {
        // 1. 쿠폰 사용 처리
        BigDecimal discount = BigDecimal.ZERO;
        if (request.getCouponId() != null) {
            discount = couponService.useCoupon(request.getCouponId(), request.getUserId());
        }

        // 2. 최종 금액 계산
        BigDecimal totalAmount = request.getOrderItems().stream()
            .map(item -> item.getPrice().multiply(BigDecimal.valueOf(item.getQuantity())))
            .reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal finalAmount = totalAmount.subtract(discount);

        // 3. 포인트 차감
        if (request.getPointsToUse() > 0) {
            pointService.usePoints(request.getUserId(), request.getPointsToUse());
        }

        // 4. 주문 생성
        Order order = new Order(
            request.getUserId(),
            totalAmount,
            discount,
            request.getPointsToUse(),
            finalAmount.subtract(BigDecimal.valueOf(request.getPointsToUse())),
            OrderStatus.CREATED
        );

        return orderRepository.save(order);
    }
}

public class CreateOrderRequest {
    private final Long userId;
    private final List<OrderItemRequest> orderItems;
    private final Long couponId;
    private final int pointsToUse;
}

public class OrderItemRequest {
    private final Long productId;
    private final String productName;
    private final int quantity;
    private final BigDecimal price;
}
```

## IM-05: 포인트 도메인 에러 처리

### Generated Code

```java
public class PointNotFoundException extends RuntimeException {
    public PointNotFoundException(Long userId) {
        super("Point not found for user: " + userId);
    }
}

public class InsufficientPointBalanceException extends RuntimeException {
    public InsufficientPointBalanceException(int available, int requested) {
        super("Insufficient point balance. Available: " + available + ", Requested: " + requested);
    }
}

public class ExpiredPointException extends RuntimeException {
    public ExpiredPointException(Long pointId, LocalDateTime expiredAt) {
        super("Point " + pointId + " has expired at " + expiredAt);
    }
}

@Service
public class PointService {
    private final PointRepository pointRepository;

    public PointService(PointRepository pointRepository) {
        this.pointRepository = pointRepository;
    }

    public Point getPoints(Long userId) {
        return pointRepository.findByUserId(userId)
            .orElseThrow(() -> new PointNotFoundException(userId));
    }

    @Transactional
    public void usePoints(Long userId, int amount) {
        Point point = pointRepository.findByUserId(userId)
            .orElseThrow(() -> new PointNotFoundException(userId));

        if (point.getExpiredAt().isBefore(LocalDateTime.now())) {
            throw new ExpiredPointException(point.getId(), point.getExpiredAt());
        }

        if (point.getBalance() < amount) {
            throw new InsufficientPointBalanceException(point.getBalance(), amount);
        }

        point.setBalance(point.getBalance() - amount);
        pointRepository.save(point);
    }
}

@RestControllerAdvice
public class PointExceptionHandler {

    @ExceptionHandler(PointNotFoundException.class)
    public ResponseEntity<ErrorResponse> handlePointNotFound(PointNotFoundException ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
            .body(new ErrorResponse(ex.getMessage()));
    }

    @ExceptionHandler(InsufficientPointBalanceException.class)
    public ResponseEntity<ErrorResponse> handleInsufficientBalance(InsufficientPointBalanceException ex) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
            .body(new ErrorResponse(ex.getMessage()));
    }

    @ExceptionHandler(ExpiredPointException.class)
    public ResponseEntity<ErrorResponse> handleExpiredPoint(ExpiredPointException ex) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
            .body(new ErrorResponse(ex.getMessage()));
    }
}

public record ErrorResponse(String message) {}
```

## IM-06: 쿠폰 발급 API (Request -> Response 전체 흐름)

### Generated Code

```java
// Request DTO
public record IssueCouponRequest(Long userId, String couponType) {}

// Response DTO
public class CouponResponse {
    private final Long id;
    private final Long userId;
    private final String couponType;
    private final BigDecimal discountAmount;
    private final LocalDateTime issuedAt;
    private final LocalDateTime expiredAt;
    private final boolean used;

    public static CouponResponse from(Coupon coupon) {
        return new CouponResponse(
            coupon.getId(),
            coupon.getUserId(),
            coupon.getCouponType(),
            coupon.getDiscountAmount(),
            coupon.getIssuedAt(),
            coupon.getExpiredAt(),
            coupon.isUsed()
        );
    }
}

// Entity
@Entity
@Table(name = "coupons")
public class Coupon {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private Long userId;
    private String couponType;
    private BigDecimal discountAmount;
    private LocalDateTime issuedAt = LocalDateTime.now();
    private LocalDateTime expiredAt;
    private boolean used = false;
}

// Controller
@RestController
@RequestMapping("/api/v1/coupons")
public class CouponController {
    private final CouponService couponService;

    public CouponController(CouponService couponService) {
        this.couponService = couponService;
    }

    @PostMapping
    public ResponseEntity<CouponResponse> issueCoupon(@RequestBody IssueCouponRequest request) {
        Coupon coupon = couponService.issue(request);
        return ResponseEntity.status(HttpStatus.CREATED).body(CouponResponse.from(coupon));
    }
}

// Service
@Service
public class CouponService {
    private final CouponRepository couponRepository;

    public CouponService(CouponRepository couponRepository) {
        this.couponRepository = couponRepository;
    }

    @Transactional
    public Coupon issue(IssueCouponRequest request) {
        BigDecimal discountAmount = switch (request.couponType()) {
            case "FIXED_1000" -> BigDecimal.valueOf(1000);
            case "FIXED_5000" -> BigDecimal.valueOf(5000);
            case "PERCENT_10" -> BigDecimal.valueOf(10);
            default -> throw new IllegalArgumentException("Unknown coupon type: " + request.couponType());
        };

        Coupon coupon = new Coupon(
            request.userId(),
            request.couponType(),
            discountAmount,
            LocalDateTime.now().plusDays(30)
        );

        return couponRepository.save(coupon);
    }
}

// Repository
public interface CouponRepository extends JpaRepository<Coupon, Long> {}
```

## IM-07: 주문 생성 도메인 이벤트 (OrderItem 포함)

### Generated Code

```java
public class OrderItem {
    private final Long productId;
    private final String productName;
    private final int quantity;
    private final Money price;
}

public record OrderCreatedEvent(
        Long orderId,
        Long userId,
        BigDecimal totalAmount,
        List<OrderItemInfo> orderItems,
        LocalDateTime createdAt
) {
    public OrderCreatedEvent(Long orderId, Long userId, BigDecimal totalAmount, List<OrderItemInfo> orderItems) {
        this(orderId, userId, totalAmount, orderItems, LocalDateTime.now());
    }
}

public record OrderItemInfo(
        Long productId,
        String productName,
        int quantity,
        BigDecimal price
) {
    public static OrderItemInfo from(OrderItem orderItem) {
        return new OrderItemInfo(
            orderItem.getProductId(),
            orderItem.getProductName(),
            orderItem.getQuantity(),
            orderItem.getPrice().amount()
        );
    }
}

@Entity
public class Order extends AbstractAggregateRoot<Order> {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private Long userId;
    private BigDecimal totalAmount;
    private OrderStatus status = OrderStatus.CREATED;

    @OneToMany(mappedBy = "order", cascade = {CascadeType.ALL})
    private List<OrderItemEntity> orderItems = new ArrayList<>();

    public Order create() {
        registerEvent(
            new OrderCreatedEvent(
                this.id,
                this.userId,
                this.totalAmount,
                this.orderItems.stream()
                    .map(item -> new OrderItemInfo(
                        item.getProductId(),
                        item.getProductName(),
                        item.getQuantity(),
                        item.getPrice()
                    ))
                    .toList()
            )
        );
        return this;
    }
}
```

## IM-09: 주문 생성 후 비동기 알림 이벤트 리스너

### Generated Code

```java
@Component
public class OrderNotificationListener {
    private static final Logger log = LoggerFactory.getLogger(OrderNotificationListener.class);
    private final NotificationService notificationService;

    public OrderNotificationListener(NotificationService notificationService) {
        this.notificationService = notificationService;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    @Async
    public void handleOrderCreated(OrderCreatedEvent event) {
        try {
            notificationService.sendOrderConfirmation(event.userId(), event.orderId());
            log.info("Order notification sent successfully for order: " + event.orderId());
        } catch (Exception e) {
            log.error("Failed to send order notification for order: " + event.orderId(), e);
        }
    }
}

@Service
public class NotificationService {
    private static final Logger log = LoggerFactory.getLogger(NotificationService.class);

    public void sendOrderConfirmation(Long userId, Long orderId) {
        // Send notification (email, push, etc.)
        log.info("Sending order confirmation to user: " + userId + " for order: " + orderId);
    }
}

@Configuration
@EnableAsync
public class AsyncConfig {}
```

## IM-10: 상품(Product) 엔티티

### Generated Code

```java
@Entity
@Table(
    name = "products",
    indexes = {
        @Index(name = "idx_product_name", columnList = "name"),
        @Index(name = "idx_product_category_id", columnList = "category_id")
    }
)
public class Product {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String name;

    @Column(nullable = false)
    private BigDecimal price;

    @Column(name = "category_id", nullable = false)
    private Long categoryId;
}

public interface ProductRepository extends JpaRepository<Product, Long> {
    List<Product> findByNameContaining(String name);
    List<Product> findByCategoryId(Long categoryId);
}
```

## IM-15: 배송(Shipping) 도메인 전체 레이어

### Generated Code

```java
// Entity
@Entity
@Table(name = "shippings")
public class Shipping {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private Long orderId;
    private String address;
    private String recipientName;
    private String recipientPhone;

    @Enumerated(EnumType.STRING)
    private ShippingStatus status = ShippingStatus.PENDING;

    private LocalDateTime createdAt = LocalDateTime.now();
    private LocalDateTime shippedAt;
    private LocalDateTime deliveredAt;
}

public enum ShippingStatus {
    PENDING, SHIPPED, IN_TRANSIT, DELIVERED, CANCELLED
}

// Event
public record ShippingStatusChangedEvent(
        Long shippingId,
        Long orderId,
        ShippingStatus previousStatus,
        ShippingStatus newStatus,
        LocalDateTime changedAt
) {
    public ShippingStatusChangedEvent(Long shippingId, Long orderId,
            ShippingStatus previousStatus, ShippingStatus newStatus) {
        this(shippingId, orderId, previousStatus, newStatus, LocalDateTime.now());
    }
}

// Repository
public interface ShippingRepository extends JpaRepository<Shipping, Long> {
    Shipping findByOrderId(Long orderId);
}

// Service
@Service
public class ShippingService {
    private final ShippingRepository shippingRepository;
    private final ApplicationEventPublisher applicationEventPublisher;

    public ShippingService(ShippingRepository shippingRepository,
            ApplicationEventPublisher applicationEventPublisher) {
        this.shippingRepository = shippingRepository;
        this.applicationEventPublisher = applicationEventPublisher;
    }

    @Transactional
    public Shipping createShipping(Long orderId, String address, String recipientName, String recipientPhone) {
        Shipping shipping = new Shipping(orderId, address, recipientName, recipientPhone);
        return shippingRepository.save(shipping);
    }

    @Transactional
    public Shipping updateStatus(Long shippingId, ShippingStatus newStatus) {
        Shipping shipping = shippingRepository.findById(shippingId)
            .orElseThrow(() -> new EntityNotFoundException("Shipping not found: " + shippingId));

        ShippingStatus previousStatus = shipping.getStatus();
        shipping.setStatus(newStatus);

        switch (newStatus) {
            case SHIPPED -> shipping.setShippedAt(LocalDateTime.now());
            case DELIVERED -> shipping.setDeliveredAt(LocalDateTime.now());
            default -> {}
        }

        applicationEventPublisher.publishEvent(
            new ShippingStatusChangedEvent(
                shipping.getId(),
                shipping.getOrderId(),
                previousStatus,
                newStatus
            )
        );

        return shippingRepository.save(shipping);
    }

    public Shipping findByOrderId(Long orderId) {
        Shipping shipping = shippingRepository.findByOrderId(orderId);
        if (shipping == null) {
            throw new EntityNotFoundException("Shipping not found for order: " + orderId);
        }
        return shipping;
    }
}

// Controller
@RestController
@RequestMapping("/api/v1/shippings")
public class ShippingController {
    private final ShippingService shippingService;

    public ShippingController(ShippingService shippingService) {
        this.shippingService = shippingService;
    }

    @PostMapping
    public ResponseEntity<ShippingResponse> createShipping(@RequestBody CreateShippingRequest request) {
        Shipping shipping = shippingService.createShipping(
            request.getOrderId(),
            request.getAddress(),
            request.getRecipientName(),
            request.getRecipientPhone()
        );
        return ResponseEntity.status(HttpStatus.CREATED).body(ShippingResponse.from(shipping));
    }

    @PatchMapping("/{id}/status")
    public ResponseEntity<ShippingResponse> updateStatus(
            @PathVariable Long id,
            @RequestBody UpdateShippingStatusRequest request) {
        Shipping shipping = shippingService.updateStatus(id, request.getStatus());
        return ResponseEntity.ok(ShippingResponse.from(shipping));
    }

    @GetMapping("/orders/{orderId}")
    public ResponseEntity<ShippingResponse> getByOrderId(@PathVariable Long orderId) {
        Shipping shipping = shippingService.findByOrderId(orderId);
        return ResponseEntity.ok(ShippingResponse.from(shipping));
    }
}

public record CreateShippingRequest(
        Long orderId,
        String address,
        String recipientName,
        String recipientPhone
) {}

public record UpdateShippingStatusRequest(ShippingStatus status) {}

public class ShippingResponse {
    private final Long id;
    private final Long orderId;
    private final String address;
    private final String recipientName;
    private final String recipientPhone;
    private final ShippingStatus status;
    private final LocalDateTime createdAt;
    private final LocalDateTime shippedAt;
    private final LocalDateTime deliveredAt;

    public static ShippingResponse from(Shipping shipping) {
        return new ShippingResponse(
            shipping.getId(),
            shipping.getOrderId(),
            shipping.getAddress(),
            shipping.getRecipientName(),
            shipping.getRecipientPhone(),
            shipping.getStatus(),
            shipping.getCreatedAt(),
            shipping.getShippedAt(),
            shipping.getDeliveredAt()
        );
    }
}
```

## IM-19: 주문(Order) 도메인 엔티티 및 Service

### Generated Code

```java
// Entity
@Entity
@Table(name = "orders")
public class Order {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private Long userId;

    @Column(nullable = false)
    private BigDecimal totalAmount;

    @Column(nullable = false)
    @Enumerated(EnumType.STRING)
    private OrderStatus status = OrderStatus.CREATED;

    @OneToMany(mappedBy = "order", cascade = {CascadeType.ALL}, orphanRemoval = true)
    private List<OrderItemEntity> items = new ArrayList<>();

    private LocalDateTime createdAt = LocalDateTime.now();
    private LocalDateTime updatedAt = LocalDateTime.now();

    public void addItem(OrderItemEntity item) {
        items.add(item);
        item.setOrder(this);
    }

    public void cancel() {
        if (status != OrderStatus.CREATED) {
            throw new IllegalStateException(
                "Only CREATED orders can be cancelled. Current status: " + status);
        }
        this.status = OrderStatus.CANCELLED;
        this.updatedAt = LocalDateTime.now();
    }
}

@Entity
@Table(name = "order_items")
public class OrderItemEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private Long productId;
    private String productName;
    private int quantity;
    private BigDecimal price;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "order_id")
    private Order order;
}

public enum OrderStatus {
    CREATED, CONFIRMED, SHIPPED, DELIVERED, CANCELLED
}

// Repository
public interface OrderRepository extends JpaRepository<Order, Long> {
    List<Order> findByUserId(Long userId);
}

// Service
@Service
public class OrderService {
    private final OrderRepository orderRepository;

    public OrderService(OrderRepository orderRepository) {
        this.orderRepository = orderRepository;
    }

    @Transactional
    public Order createOrder(Long userId, List<OrderItemEntity> items) {
        BigDecimal totalAmount = items.stream()
            .map(item -> item.getPrice().multiply(BigDecimal.valueOf(item.getQuantity())))
            .reduce(BigDecimal.ZERO, BigDecimal::add);

        Order order = new Order(userId, totalAmount);
        items.forEach(order::addItem);

        return orderRepository.save(order);
    }

    @Transactional(readOnly = true)
    public Order findById(Long id) {
        return orderRepository.findById(id)
            .orElseThrow(() -> new EntityNotFoundException("Order not found with id: " + id));
    }

    @Transactional(readOnly = true)
    public List<Order> findByUserId(Long userId) {
        return orderRepository.findByUserId(userId);
    }

    @Transactional
    public Order cancelOrder(Long id) {
        Order order = findById(id);
        order.cancel();
        return orderRepository.save(order);
    }
}
```

## IM-22: 주문 ID 조회 및 에러 처리

### Generated Code

```java
public class OrderNotFoundException extends RuntimeException {
    public OrderNotFoundException(Long id) {
        super("Order not found with id: " + id);
    }
}

@Service
public class OrderService {
    private final OrderRepository orderRepository;

    public OrderService(OrderRepository orderRepository) {
        this.orderRepository = orderRepository;
    }

    @Transactional(readOnly = true)
    public Order getOrderById(Long id) {
        return orderRepository.findById(id)
            .orElseThrow(() -> new OrderNotFoundException(id));
    }
}

@RestControllerAdvice
public class OrderExceptionHandler {

    @ExceptionHandler(OrderNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleOrderNotFound(OrderNotFoundException ex) {
        return ResponseEntity
            .status(HttpStatus.NOT_FOUND)
            .body(new ErrorResponse(
                "ORDER_NOT_FOUND",
                ex.getMessage() != null ? ex.getMessage() : "Order not found"
            ));
    }
}

public record ErrorResponse(String code, String message, LocalDateTime timestamp) {
    public ErrorResponse(String code, String message) {
        this(code, message, LocalDateTime.now());
    }
}
```

## IM-24: 상품 API Swagger 문서화

### Generated Code

```java
@Tag(name = "Product", description = "상품 API")
@RestController
@RequestMapping("/api/v1/products")
public class ProductController {
    private final ProductService productService;

    public ProductController(ProductService productService) {
        this.productService = productService;
    }

    @Operation(
        summary = "상품 검색",
        description = "상품명 키워드 또는 카테고리 ID로 상품을 검색합니다."
    )
    @ApiResponses(
        value = {
            @ApiResponse(
                responseCode = "200",
                description = "검색 성공",
                content = @Content(
                    mediaType = "application/json",
                    array = @ArraySchema(schema = @Schema(implementation = ProductResponse.class))
                )
            ),
            @ApiResponse(
                responseCode = "400",
                description = "잘못된 요청 파라미터",
                content = @Content(schema = @Schema(implementation = ErrorResponse.class))
            )
        }
    )
    @GetMapping("/search")
    public ResponseEntity<Page<ProductResponse>> searchProducts(
            @Parameter(description = "검색할 상품명 키워드", example = "노트북")
            @RequestParam(required = false) String keyword,

            @Parameter(description = "카테고리 ID", example = "1")
            @RequestParam(required = false) Long categoryId,

            @Parameter(description = "페이지 번호 (0부터 시작)", example = "0")
            @RequestParam(defaultValue = "0") int page,

            @Parameter(description = "페이지 크기", example = "20")
            @RequestParam(defaultValue = "20") int size) {
        Page<Product> products = productService.search(keyword, categoryId, PageRequest.of(page, size));
        return ResponseEntity.ok(products.map(ProductResponse::from));
    }
}
```

## IM-26: 사용자 서비스 에러 메시지

### Generated Code

```java
public class UserNotFoundException extends RuntimeException {
    public UserNotFoundException(Long userId) {
        super("User not found with id: " + userId);
    }
}

public class DuplicateEmailException extends RuntimeException {
    public DuplicateEmailException(String email) {
        super("Email already exists: " + email);
    }
}

public class InvalidPasswordFormatException extends RuntimeException {
    public InvalidPasswordFormatException() {
        super("Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, one number, and one special character.");
    }
}

@Service
public class UserService {
    private final UserRepository userRepository;

    public UserService(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    public User findById(Long id) {
        return userRepository.findById(id)
            .orElseThrow(() -> new UserNotFoundException(id));
    }

    public User register(String email, String password, String name) {
        if (userRepository.existsByEmail(email)) {
            throw new DuplicateEmailException(email);
        }

        if (!isValidPassword(password)) {
            throw new InvalidPasswordFormatException();
        }

        User user = new User(email, password, name);
        return userRepository.save(user);
    }

    private boolean isValidPassword(String password) {
        String regex = "^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@$!%*?&])[A-Za-z\\d@$!%*?&]{8,}$";
        return password.matches(regex);
    }
}

@RestControllerAdvice
public class UserExceptionHandler {

    @ExceptionHandler(UserNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleUserNotFound(UserNotFoundException ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
            .body(new ErrorResponse("USER_NOT_FOUND", ex.getMessage()));
    }

    @ExceptionHandler(DuplicateEmailException.class)
    public ResponseEntity<ErrorResponse> handleDuplicateEmail(DuplicateEmailException ex) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
            .body(new ErrorResponse("DUPLICATE_EMAIL", ex.getMessage()));
    }

    @ExceptionHandler(InvalidPasswordFormatException.class)
    public ResponseEntity<ErrorResponse> handleInvalidPassword(InvalidPasswordFormatException ex) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
            .body(new ErrorResponse("INVALID_PASSWORD_FORMAT", ex.getMessage()));
    }
}
```

## IM-27: 랭킹 조회 캐싱

### Generated Code

```java
@Service
public class RankingService {
    private final RankingRepository rankingRepository;

    public RankingService(RankingRepository rankingRepository) {
        this.rankingRepository = rankingRepository;
    }

    @Cacheable(
        value = {"ranking"},
        key = "#type.name() + '_' + #period.name()",
        condition = "#period == T(RankingPeriod).WEEKLY || #period == T(RankingPeriod).MONTHLY",
        unless = "#result.isEmpty()"
    )
    public List<RankingEntry> getRanking(RankingType type, RankingPeriod period) {
        return rankingRepository.findByTypeAndPeriod(type, period);
    }

    @CacheEvict(value = {"ranking"}, allEntries = true)
    public void refreshRanking() {
        // Cache will be cleared and recalculated on next access
    }
}

public enum RankingPeriod {
    DAILY, WEEKLY, MONTHLY
}

public enum RankingType {
    SALES, VIEWS, REVIEWS
}

public record RankingEntry(int rank, Long productId, String productName, long score) {}

public interface RankingRepository {
    List<RankingEntry> findByTypeAndPeriod(RankingType type, RankingPeriod period);
}

@Configuration
@EnableCaching
public class CacheConfig {

    @Bean
    public CacheManager cacheManager() {
        Caffeine<Object, Object> caffeine = Caffeine.newBuilder()
            .expireAfterWrite(Duration.ofMinutes(30))
            .maximumSize(100);

        CaffeineCacheManager cacheManager = new CaffeineCacheManager("ranking");
        cacheManager.setCaffeine(caffeine);
        return cacheManager;
    }
}
```

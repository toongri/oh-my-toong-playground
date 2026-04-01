## IM-21: 필수 필드는 Non-null로 선언한다
### Generated Code
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

## IM-22: 조회 실패 시 null 체크 후 CoreException을 던진다
### Generated Code
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

## IM-23: Optional 데이터는 명시적 null 체크로 안전하게 처리한다
### Generated Code
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

## IM-24: API 문서는 ApiSpec 인터페이스에 분리한다
### Generated Code
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

## IM-25: 페이지네이션은 PageQuery 객체로 캡슐화하고 생성자에서 검증한다
### Generated Code
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

## IM-26: 에러 메시지는 한국어이며 [field = value] 접두사로 시작한다
### Generated Code
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

## IM-27: 캐싱은 Facade에서만 CacheTemplate으로 수행한다
### Generated Code
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

## IM-28: 캐시 키는 sealed interface로 정의하고 TTL을 내장한다
### Generated Code
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

## IM-29: 캐시 모델은 CachedXxxV1으로 버전화하고 도메인 이벤트로 무효화한다
### Generated Code
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

## IM-21: 필수 필드는 Non-nullable로 선언한다
### Generated Code
```kotlin
@Entity
@Table(
    name = "products",
    indexes = [
        Index(name = "idx_product_category_id", columnList = "category_id"),
    ]
)
class Product private constructor(
    val name: String,
    price: Money,
    val categoryId: Long,
    val description: String? = null,
) : BaseEntity() {

    var price: Money = price
        private set

    init {
        if (name.isBlank()) {
            throw CoreException(ErrorType.BAD_REQUEST, "[name = $name] 상품명은 비어있을 수 없습니다.")
        }
        if (!price.isPositive()) {
            throw CoreException(ErrorType.BAD_REQUEST, "[price = $price] 가격은 양수여야 합니다.")
        }
    }

    companion object {
        fun create(
            name: String,
            price: Money,
            categoryId: Long,
            description: String? = null,
        ): Product = Product(name, price, categoryId, description)
    }
}
```

## IM-22: 조회 실패 시 !! 대신 ?: throw CoreException을 사용한다
### Generated Code
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

## IM-23: Optional 데이터는 안전 호출 연산자를 사용한다
### Generated Code
```kotlin
class OrderAmountCalculator {
    fun calculateFinalAmount(
        totalProductAmount: Money,
        couponDiscount: Money?,
        pointDiscount: Money?,
        gradeDiscount: Money?,
        shippingFee: Money,
    ): Money {
        val totalDiscount = listOfNotNull(
            couponDiscount,
            pointDiscount,
            gradeDiscount,
        ).fold(Money.ZERO) { accumulated, discount -> accumulated.add(discount) }

        val discountedAmount = totalProductAmount.subtract(totalDiscount)
        val finalPaymentAmount = discountedAmount.add(shippingFee)

        couponDiscount?.let { discount ->
            if (discount.isNegative()) {
                throw CoreException(ErrorType.BAD_REQUEST,
                    "[couponDiscount = $discount] 쿠폰 할인 금액은 음수일 수 없습니다.")
            }
        }

        return finalPaymentAmount
    }
}
```

## IM-24: API 문서는 ApiSpec 인터페이스에 분리한다
### Generated Code
```kotlin
// ApiSpec Interface - Swagger 어노테이션은 여기에만
@Tag(name = "상품 API", description = "상품 조회 및 관리 API")
interface ProductV1ApiSpec {

    @Operation(summary = "상품 검색", description = "키워드와 카테고리로 상품을 검색합니다.")
    @ApiResponses(value = [
        ApiResponse(responseCode = "200", description = "검색 성공"),
        ApiResponse(responseCode = "400", description = "잘못된 요청"),
    ])
    fun search(
        @Parameter(description = "검색 키워드", example = "노트북")
        keyword: String?,
        @Parameter(description = "페이지 번호", example = "0")
        page: Int,
        @Parameter(description = "페이지 크기", example = "20")
        size: Int,
    ): ApiResponse<ProductV1Response.Search>
}

// Controller - Swagger 어노테이션 없이 구현만
@RestController
@RequestMapping("/api/v1/products")
class ProductV1Controller(
    private val productFacade: ProductFacade,
) : ProductV1ApiSpec {

    @GetMapping("/search")
    override fun search(
        @RequestParam keyword: String?,
        @RequestParam(defaultValue = "0") page: Int,
        @RequestParam(defaultValue = "20") size: Int,
    ): ApiResponse<ProductV1Response.Search> {
        val query = ProductPageQuery.of(page, size, keyword)
        return productFacade.search(query)
            .let { ProductV1Response.Search.from(it) }
            .let { ApiResponse.success(it) }
    }
}
```

## IM-25: 페이지네이션은 PageQuery 객체로 캡슐화하고 init에서 검증한다
### Generated Code
```kotlin
data class ProductPageQuery(
    val page: Int,
    val size: Int,
    val keyword: String? = null,
    val categoryId: Long? = null,
) {
    init {
        if (page < 0) {
            throw CoreException(ErrorType.BAD_REQUEST, "[page = $page] 페이지는 0 이상이어야 합니다.")
        }
        if (size !in 1..100) {
            throw CoreException(ErrorType.BAD_REQUEST, "[size = $size] 페이지 크기는 1~100이어야 합니다.")
        }
    }

    companion object {
        fun of(
            page: Int = 0,
            size: Int = 20,
            keyword: String? = null,
            categoryId: Long? = null,
        ): ProductPageQuery = ProductPageQuery(page, size, keyword, categoryId)
    }
}
```

## IM-26: 에러 메시지는 한국어이며 [field = $value] 접두사로 시작한다
### Generated Code
```kotlin
@Component
class UserService(
    private val userRepository: UserRepository,
) {
    @Transactional(readOnly = true)
    fun findById(id: Long): User {
        return userRepository.findById(id)
            ?: throw CoreException(ErrorType.NOT_FOUND, "[userId = $id] 사용자를 찾을 수 없습니다.")
    }

    @Transactional
    fun register(command: UserCommand.Register): User {
        if (userRepository.existsByEmail(command.email)) {
            throw CoreException(ErrorType.CONFLICT, "[email = ${command.email}] 이미 존재하는 이메일입니다.")
        }

        if (!command.password.matches(PASSWORD_REGEX)) {
            throw CoreException(ErrorType.BAD_REQUEST,
                "[password = ***] 비밀번호는 8자 이상, 영문/숫자/특수문자를 포함해야 합니다.")
        }

        val user = User.create(command.email, command.password, command.name)
        return userRepository.save(user)
    }

    companion object {
        private val PASSWORD_REGEX = Regex("^(?=.*[A-Za-z])(?=.*\\d)(?=.*[@\$!%*?&]).{8,}$")
    }
}
```

## IM-27: 캐싱은 Facade에서만 CacheTemplate으로 수행한다
### Generated Code
```kotlin
@Component
class RankingFacade(
    private val rankingService: RankingService,
    private val cacheTemplate: CacheTemplate,
) {
    fun findRankings(criteria: RankingCriteria.FindRankings): RankingInfo.FindRankings {
        val cacheKey = RankingCacheKeys.RankingList(
            period = criteria.period,
            baseDate = criteria.baseDate,
            offset = criteria.offset,
            limit = criteria.limit,
        )

        if (!cacheKey.shouldCache()) {
            val rankings = rankingService.findRankings(criteria.to())
            return RankingInfo.FindRankings.from(rankings)
        }

        val cached = cacheTemplate.get(cacheKey, TYPE_CACHED_RANKING_V1)
        if (cached != null) {
            return RankingInfo.FindRankings.from(cached.toProductRankings())
        }

        val rankings = rankingService.findRankings(criteria.to())

        if (rankings.isNotEmpty()) {
            cacheTemplate.put(cacheKey, CachedRankingV1.from(rankings))
        }

        return RankingInfo.FindRankings.from(rankings)
    }
}
```

## IM-28: 캐시 키는 sealed class로 정의하고 TTL을 내장한다
### Generated Code
```kotlin
sealed class ProductCacheKeys(override val ttl: Duration) : CacheKey {

    data class ProductDetail(
        private val productId: Long,
    ) : ProductCacheKeys(ttl = Duration.ofHours(1)) {

        override val key: String = "product-cache:v1:detail:$productId"
        override val traceKey: String = "product-detail-cache"
    }

    data class ProductList(
        private val categoryId: Long?,
        private val keyword: String?,
        private val page: Int,
        private val size: Int,
    ) : ProductCacheKeys(ttl = Duration.ofMinutes(30)) {

        override val key: String = "product-cache:v1:list:${categoryId ?: "all"}:${keyword ?: "none"}:$page:$size"
        override val traceKey: String = "product-list-cache"

        fun shouldCache(): Boolean = keyword == null
    }
}
```

## IM-29: 캐시 모델은 CachedXxxV1으로 버전화하고 도메인 이벤트로 무효화한다
### Generated Code
```kotlin
// Cache Model - 전용 DTO (Entity/Response 아님)
data class CachedProductDetailV1(
    val productId: Long,
    val name: String,
    val price: BigDecimal,
    val categoryId: Long,
    val description: String?,
) {
    fun toProductDetail(): ProductDetail =
        ProductDetail(productId, name, Money(price, Currency.KRW), categoryId, description)

    companion object {
        fun from(product: ProductDetail): CachedProductDetailV1 =
            CachedProductDetailV1(
                productId = product.productId,
                name = product.name,
                price = product.price.amount,
                categoryId = product.categoryId,
                description = product.description,
            )
    }
}

// Cache Invalidation - 도메인 이벤트 리스너
@Component
class ProductCacheEvictionListener(
    private val cacheTemplate: CacheTemplate,
) {
    private val logger = LoggerFactory.getLogger(this::class.java)

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    fun onProductUpdated(event: ProductUpdatedEventV1) {
        logger.info("[Event] Product cache eviction start - eventType: ${event::class.simpleName}, productId: ${event.productId}")
        cacheTemplate.evict(ProductCacheKeys.ProductDetail(event.productId))
        logger.info("[Event] Product cache eviction complete - eventType: ${event::class.simpleName}, productId: ${event.productId}")
    }
}
```

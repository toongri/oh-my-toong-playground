# 캐싱 패턴

무엇을 어느 레이어에서 캐싱하는지, Facade 전용 Cache-Aside 패턴과 sealed class 캐시 키, 버전 DTO, 무효화 전략을 다룬다.

## 목차

1. **개요와 핵심 규칙** — Facade가 소유하는 Cache-Aside, `CacheTemplate`을 쓰는 이유
2. **레이어 책임** — Facade/Service/Infrastructure가 캐싱에 대해 각각 무엇을 하고 무엇을 하지 않는가
3. **Cache-Aside 패턴 (Facade)** — 조회-미스-저장 흐름 전체 예시
4. **캐시 키: sealed class** — 타입 안전한 키에 TTL과 캐싱 조건을 함께 담는다
5. **캐시 모델: 버전 DTO** — `CachedXxxV1`으로 Entity/Response와 분리한다
6. **List + Detail 다단계 캐싱** — 목록은 ID만, 상세는 별도 캐시로
7. **캐시 무효화** — 도메인 이벤트 기반, `@CacheEvict` 금지
8. **사전 집계 캐시: 배치 잡** — Redis에 미리 적재하는 패턴
9. **금지 패턴** — 절대 쓰지 않는 것들
10. **안티패턴** — 잘못된 접근과 올바른 대안 8가지
11. **이런 생각이 들면 멈춰라** — 캐싱 관련 Red Flags 5가지

---

## 1. 개요와 핵심 규칙

캐싱은 **Application Layer(Facade)**에서 **Cache-Aside 패턴**으로만 관리한다. 세밀한 제어를 위해 `@Cacheable` 어노테이션 대신 `CacheTemplate`을 쓴다.

이 프로젝트에서 캐싱이 실제로 답하는 질문은 "무엇을 캐싱하나"가 아니라 **"어느 레이어에 두나"**다. 캐시 로직이 Service나 Repository로 새어 들어가는 순간 레이어 경계가 무너진다 — 그래서 아래 6가지가 전부 협상 불가 규칙이다.

| 규칙 | 패턴 |
|------|------|
| **레이어** | Application Layer(Facade) 전용 |
| **패턴** | `CacheTemplate`을 쓰는 수동 Cache-Aside |
| **캐시 키** | sealed class + TTL 내장 |
| **캐시 모델** | `CachedXxxV1` 버전 DTO (Entity/Response 절대 금지) |
| **목록 캐싱** | ID만 캐싱 + 별도 Detail 캐시 |
| **무효화** | 도메인 이벤트 + `@TransactionalEventListener(AFTER_COMMIT)` |

> ⚠️ 주의
> "레이어 = Facade 전용"이라는 축은 이 문서 전체를 관통한다. 레이어별 트랜잭션 경계나 Facade의 "코디네이션만" 원칙 자체는 [layer-boundaries.md](./layer-boundaries.md)가 다룬다 — 여기서는 그 원칙을 캐싱에 적용한 결과만 다룬다.

## 2. 레이어 책임

```
Application Layer (Facade) → CacheTemplate → Redis
         ↓
   Domain Services
         ↓
Infrastructure Layer (캐싱 로직 없음)
```

| 레이어 | 캐시 역할 |
|--------|-----------|
| **Facade** | Cache-Aside 로직을 소유하고 `CacheTemplate`을 쓴다 |
| **Service** | 캐시를 모른다 — 순수 비즈니스 로직만 |
| **Infrastructure** | 캐싱 로직 없음, 순수 데이터 접근만 |

이 표가 겨냥하는 건 **비즈니스 Service의 read-through 캐싱**이다 — 상품 조회처럼 도메인 로직 도중 캐시 히트/미스를 확인하고 분기하는 흐름을 Service에 두지 말라는 것이다. Service가 캐시 히트/미스를 알고 분기한다면, 그 시점부터 Service는 더 이상 "캐시-agnostic"하지 않고 캐싱 관심사와 얽힌다.

이 표의 예외는 두 가지다. **캐시 무효화만 전담하는 컴포넌트**(예: 7절의 `ProductCacheService`)는 이벤트에 반응해 캐시를 지우기만 할 뿐 read-through 캐싱을 하지 않으므로 이 표가 겨냥하는 "Service"가 아니다. **배치 `ItemWriter`**(예: 8절의 `RedisAggregationWriter`)도 Redis 자체가 목적 저장소인 배치 파이프라인이라 Cache-Aside 개념이 적용되지 않는다 — Infrastructure의 "캐싱 로직 없음"과 무관하다.

## 3. Cache-Aside 패턴 (Facade)

```kotlin
@Component
class RankingFacade(
    private val rankingService: RankingService,
    private val cacheTemplate: CacheTemplate,
) {
    fun findRankings(command: RankingCommand.FindRankings): List<ProductRanking> {
        val cacheKey = RankingCacheKeys.RankingList(
            period = command.period,
            baseDate = command.baseDate,
            offset = command.offset,
            limit = command.limit,
        )

        // Check caching condition
        if (!cacheKey.shouldCache()) {
            return rankingService.findRankings(command)
        }

        // Cache hit
        val cached = cacheTemplate.get(cacheKey, TYPE_CACHED_RANKING_V1)
        if (cached != null) return cached.toProductRankings()

        // Cache miss - call Domain Service
        val rankings = rankingService.findRankings(command)

        // Do not cache empty results
        if (rankings.isNotEmpty()) {
            cacheTemplate.put(cacheKey, CachedRankingV1.from(rankings))
        }

        return rankings
    }
}
```

이 흐름의 순서가 규칙이다 — 캐싱 조건 확인 → 캐시 조회 → 미스 시에만 Service 호출 → 결과가 비어있지 않을 때만 캐싱. 아래는 `Criteria`/`Info` DTO 흐름을 쓰는 동일한 패턴이다. Facade가 어떤 DTO 계층을 쓰든 Cache-Aside 순서 자체는 바뀌지 않는다는 것을 보여준다.

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

> `Criteria`/`Command`/`Info` 각 DTO의 역할과 변환 규칙(`criteria.to()`, `Info.from()`)은 이 문서가 다루지 않는다 — [dto-patterns.md](./dto-patterns.md)를 참고한다. 여기서는 Cache-Aside 순서에 집중한다.

## 4. 캐시 키: sealed class

타입 안전한 캐시 키를 sealed class로 정의한다. TTL과 캐싱 조건 판단 로직을 키 안에 함께 둔다.

```kotlin
sealed class RankingCacheKeys(override val ttl: Duration) : CacheKey {

    data class RankingList(
        private val period: RankingPeriod,
        private val baseDate: LocalDate,
        private val offset: Long,
        private val limit: Int,
    ) : RankingCacheKeys(ttl = Duration.ofHours(1)) {

        override val key: String = "ranking-cache:v1:${period.key}:$baseDate:$offset:$limit"
        override val traceKey: String = "ranking-cache"

        fun shouldCache(): Boolean = period in listOf(WEEKLY, MONTHLY)
    }
}
```

같은 방식으로 도메인마다 별도의 sealed class를 둔다. 아래는 상세/목록 두 종류의 키를 한 sealed class에 함께 정의한 예시다.

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

**키 규칙:**
- **버전 포함**: 키에 `v1` 같은 버전을 넣는다 (스키마 변경 대비)
- **TTL 내장**: 키 종류마다 적절한 TTL을 정의한다
- **비즈니스 로직**: `shouldCache()` 같은 캐싱 조건을 키 안에 정의한다

## 5. 캐시 모델: 버전 DTO

캐싱 전용 DTO를 정의한다. Entity나 Response를 그대로 캐싱하지 않는다.

```kotlin
data class CachedRankingV1(
    val rankings: List<Entry>,
) {
    data class Entry(
        val productId: Long,
        val rank: Int,
        val score: BigDecimal,
    )

    fun toProductRankings(): List<ProductRanking> =
        rankings.map { ProductRanking(it.productId, it.rank, it.score) }

    companion object {
        fun from(rankings: List<ProductRanking>): CachedRankingV1 =
            CachedRankingV1(rankings.map { Entry(it.productId, it.rank, it.score) })
    }
}
```

`Money`, `UserId` 같은 값 객체를 캐시 DTO 안에 그대로 두지 않고 원시 타입으로 풀어내는 예시다.

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
```

**캐시 DTO 규칙:**
- **버전 접미사**: `CachedXxxV1` (스키마 진화를 위해)
- **원시 타입만**: `Money` → `BigDecimal`, `UserId` → `Long`
- **양방향 변환**: `from(domain)`, `toDomain()` 메서드
- **도메인과 분리**: 캐시 DTO는 Application Layer에 둔다

## 6. List + Detail 다단계 캐싱

목록을 캐싱할 때는 **ID만 저장**하고, 상세 데이터는 별도 캐시로 분리한다.

```kotlin
// List cache: store IDs only
data class CachedProductListV1(
    val productIds: List<Long>,
    val hasNext: Boolean,
)

// Detail cache: actual data
data class CachedProductDetailV1(
    val productId: Long,
    val name: String,
    val price: BigDecimal,
    // ...
)
```

**조회 흐름:**

```kotlin
fun findProducts(criteria: ProductCriteria.FindProducts): ProductInfo.FindProducts {
    val cacheKey = ProductCacheKeys.ProductList.from(criteria)

    if (!cacheKey.shouldCache()) return ProductInfo.FindProducts.from(productService.findProducts(criteria))

    val cachedList = cacheTemplate.get(cacheKey, TYPE_CACHED_PRODUCT_LIST_V1)

    if (cachedList != null) {
        // 1. List cache hit → bulk fetch Detail cache
        val detailCacheKeys = cachedList.productIds.map { ProductCacheKeys.ProductDetail(it) }
        val cachedProducts = cacheTemplate.getAll(detailCacheKeys, TYPE_CACHED_PRODUCT_DETAIL_V1)

        val cachedMap = cachedProducts.associateBy { it.productId }
        val missingIds = cachedList.productIds.filterNot { it in cachedMap.keys }

        // 2. Partial miss → fetch only missing IDs from DB
        val dbProducts = productService.findAllByIds(missingIds)

        // 3. Backfill missing data to cache
        val dbCacheMap = dbProducts.associate {
            ProductCacheKeys.ProductDetail(it.productId) to CachedProductDetailV1.from(it)
        }
        cacheTemplate.putAll(dbCacheMap)

        // 4. Assemble result while preserving order
        return assembleResult(cachedList, cachedMap, dbProducts)
    }

    // Cache miss: fetch from DB and cache both List + Detail
    val slice = productService.findProducts(criteria)

    // Do not cache empty results
    if (slice.content.isNotEmpty()) {
        cacheTemplate.put(cacheKey, CachedProductListV1(slice.content.map { it.productId }, slice.hasNext()))

        val detailCacheMap = slice.content.associate {
            ProductCacheKeys.ProductDetail(it.productId) to CachedProductDetailV1.from(it)
        }
        cacheTemplate.putAll(detailCacheMap)
    }

    return ProductInfo.FindProducts.from(slice)
}
```

**이점:**
- 목록 조회 조건이 바뀌어도 ID 목록만 갱신하면 된다
- 상세 데이터가 바뀌어도 해당 ID만 무효화하면 된다
- 부분 캐시 히트만으로도 DB 부하를 줄인다

## 7. 캐시 무효화

캐시 무효화는 **이벤트 기반**으로 처리한다. `@CacheEvict` 어노테이션은 쓰지 않는다.

### 분산 시스템: Kafka Consumer (권장)

여러 서비스/인스턴스가 캐시를 공유하는 경우, Kafka로 이벤트를 소비해 무효화한다.

```kotlin
// Kafka Consumer: invalidate cache after consuming event
@Component
class ProductStockEventConsumer(
    private val productCacheService: ProductCacheService,
) {
    private val logger = LoggerFactory.getLogger(javaClass)

    @KafkaListener(topics = ["stock-events"], groupId = "cache-invalidation")
    fun onStockEvent(event: StockDepletedEventV1) {
        logger.info("[Event] Stock depleted cache eviction - productId: ${event.productId}")
        productCacheService.evictStockDepletedProduct(
            ProductCacheService.EvictStockDepletedCommand(event.productId)
        )
    }
}

// Cache Service: perform actual invalidation
@Service
class ProductCacheService(
    private val cacheTemplate: CacheTemplate,
) {
    data class EvictStockDepletedCommand(val productId: Long)

    fun evictStockDepletedProduct(command: EvictStockDepletedCommand) {
        cacheTemplate.evict(ProductCacheKeys.ProductDetail(command.productId))
    }
}
```

### 단일 서비스: TransactionalEventListener

같은 JVM 안에서만 캐시를 쓰는 경우, 로컬 이벤트 리스너로 무효화한다.

```kotlin
// Domain Service: publish event
@Component
class ProductService(
    private val productRepository: ProductRepository,
    private val eventPublisher: ApplicationEventPublisher,
) {
    @Transactional
    fun updateStock(productId: Long, quantity: Int) {
        val product = productRepository.findById(productId)
            ?: throw CoreException(ErrorType.NOT_FOUND, "[productId = $productId] 상품을 찾을 수 없습니다.")

        product.updateStock(quantity)

        if (product.isStockDepleted()) {
            eventPublisher.publishEvent(StockDepletedEventV1.from(product))
        }
    }
}

// Local EventListener: cache invalidation
@Component
class ProductStockCacheEvictionListener(
    private val cacheTemplate: CacheTemplate,
) {
    private val logger = LoggerFactory.getLogger(this::class.java)

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    fun onStockDepleted(event: StockDepletedEventV1) {
        try {
            cacheTemplate.evict(ProductCacheKeys.ProductDetail(event.productId))
        } catch (e: Exception) {
            logger.error("[Event] Product cache eviction failed - eventType: ${event::class.simpleName}, productId: ${event.productId}", e)
        }
    }
}
```

아래는 캐시 모델(§5)의 `CachedProductDetailV1`을 실제로 무효화하는 리스너다. 로깅 포맷까지 포함한 완전한 형태다.

```kotlin
@Component
class ProductUpdateCacheEvictionListener(
    private val cacheTemplate: CacheTemplate,
) {
    private val logger = LoggerFactory.getLogger(this::class.java)

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    fun onProductUpdated(event: ProductUpdatedEventV1) {
        logger.info("[Event] Product cache eviction start - eventType: ${event::class.simpleName}, productId: ${event.productId}")
        try {
            cacheTemplate.evict(ProductCacheKeys.ProductDetail(event.productId))
            logger.info("[Event] Product cache eviction complete - eventType: ${event::class.simpleName}, productId: ${event.productId}")
        } catch (e: Exception) {
            logger.error("[Event] Product cache eviction failed - eventType: ${event::class.simpleName}, productId: ${event.productId}", e)
        }
    }
}
```

두 리스너 모두 `cacheTemplate.evict(...)`를 try-catch로 감싸고 `logger.error`로 실패를 남긴다 — 이 리스너들은 동기 실행이라 Spring이 `afterCompletion()` 경로에서 발생한 예외를 자신의 로거로 ERROR 한 줄만 남기고 호출자에게는 전파하지 않으므로, 그 한 줄에는 `productId`·`eventType` 같은 도메인 맥락이 없다(리스너에 `@Async`를 붙였다면 대신 `AsyncUncaughtExceptionHandler`가 같은 역할을 한다 — [domain-events.md](./domain-events.md) §5 참고). 잡지 않으면 Redis 장애 같은 무효화 실패가 어떤 상품 때문인지 알 수 없는 프레임워크 로그 한 줄로만 남는다 — 그래서 리스너 안에서 도메인 맥락을 담아 직접 로깅해야 한다.

**무효화 규칙:**
- **분산 시스템**: Kafka Consumer로 이벤트를 소비해 무효화한다
- **단일 서비스**: `@TransactionalEventListener(AFTER_COMMIT)`을 쓴다
- **선택적 무효화**: 바뀐 데이터만 evict한다 (`allEntries` 금지)
- **이벤트 기반**: 도메인 이벤트로 캐시 변경을 트리거한다

> ⚠️ 주의
> 여기서 다루는 건 캐시 무효화가 이벤트에 반응하는 방식뿐이다. 이벤트 자체의 정의 규칙(`{Action}EventV{n}` 명명, `DomainEvent` 인터페이스, `occurredAt` 필드)과 `BEFORE_COMMIT`/`AFTER_COMMIT` 선택 기준은 이 문서가 다루지 않는다 — [domain-events.md](./domain-events.md)를 참고한다.

## 8. 사전 집계 캐시: 배치 잡

사전 집계된 데이터는 **Batch Job**을 통해 Redis에 적재한다.

```kotlin
@Component
class RedisAggregationWriter(
    private val redisTemplate: StringRedisTemplate,
) : ItemWriter<ScoreEntry> {

    override fun write(chunk: Chunk<out ScoreEntry>) {
        val zSetOps = redisTemplate.opsForZSet()

        chunk.items.forEach { entry ->
            zSetOps.incrementScore(stagingKey, entry.productId.toString(), entry.score.toDouble())
        }

        redisTemplate.expire(stagingKey, TTL_HOURS, TimeUnit.HOURS)
    }
}
```

이 `ItemWriter`가 Step/Job 안에서 어떻게 조립되고 테스트되는지는 이 문서가 다루지 않는다 — [../testing/batch-test.md](../testing/batch-test.md)를 참고한다.

## 9. 금지 패턴

다음 패턴은 예외 없이 금지한다.

- `@Cacheable`, `@CacheEvict` 어노테이션
- Service/Repository/Infrastructure에서의 캐싱
- Entity 또는 Response DTO를 그대로 캐싱
- `allEntries=true` 무효화

## 10. 안티패턴

지금까지 나온 규칙을 어겼을 때 흔히 나타나는 형태를 한 표로 정리한다.

| 잘못된 접근 | 올바른 접근 |
|-------------|-------------|
| `@Cacheable` 어노테이션 | `CacheTemplate` + Cache-Aside |
| Entity를 그대로 캐싱 | `CachedXxxV1` 전용 DTO |
| Response DTO를 캐싱 | 별도 캐시 전용 DTO |
| 문자열 리터럴 캐시 키 | sealed class + TTL 내장 |
| 목록 데이터 전체를 캐싱 | List(ID) + Detail(데이터) 분리 |
| `@CacheEvict(allEntries=true)` | 도메인 이벤트 + 선택적 evict |
| 비즈니스 Service/Repository의 read-through 캐시 로직 | Facade에서만 캐시 관리 (캐시 무효화 전담 컴포넌트·배치 Writer는 예외 — 2절 참고) |
| Infrastructure에서의 read-through 캐싱 | Infrastructure는 캐시를 모른다 (배치 Writer가 Redis에 쓰는 것은 예외 — 2절 참고) |

## 11. 이런 생각이 들면 멈춰라

캐싱과 관련해 아래 5가지 생각이 든다면, 그 순간이 규칙을 확인할 시점이다.

| 이런 생각이 들면 | 현실은 이렇다 |
|------------------|----------------|
| "`@Cacheable`이 더 간단한데" | 제어를 위해 `CacheTemplate`을 쓴다 |
| "Service/Repository에서 캐싱하자" | read-through 캐싱은 Facade에만 있다 (캐시 무효화 전담 컴포넌트·배치 Writer는 예외 — 2절 참고) |
| "Response를 그대로 캐싱하자" | 전용 DTO `CachedXxxV1`을 쓴다 |
| "문자열 캐시 키로 충분하다" | TTL을 내장한 sealed class를 쓴다 |
| "`@CacheEvict(allEntries=true)`로 지우자" | 도메인 이벤트 + 선택적 evict를 쓴다 |

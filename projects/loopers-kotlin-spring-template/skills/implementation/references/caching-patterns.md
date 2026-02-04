# Caching Patterns

## Overview

Caching is managed in the **Application Layer (Facade)** using the **Cache-Aside pattern**. Use `CacheTemplate` instead of `@Cacheable` annotation to ensure fine-grained control.

## Layer Responsibility

```
Application Layer (Facade) → CacheTemplate → Redis
         ↓
   Domain Services
         ↓
Infrastructure Layer (NO caching logic)
```

| Layer | Cache Role |
|-------|-----------|
| **Facade** | Owns Cache-Aside logic, uses CacheTemplate |
| **Service** | Cache-agnostic, pure business logic |
| **Infrastructure** | No caching logic, pure data access |

## Cache-Aside Pattern (Facade)

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

## Cache Key: Sealed Class

Define type-safe cache keys using sealed class. Embed TTL and business logic within the key.

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

**Key Rules:**
- **Version included**: Include version like `v1` in key (for schema changes)
- **TTL embedded**: Define appropriate TTL for each key type
- **Business logic**: Define caching conditions like `shouldCache()` in the key

## Cache Model: Versioned DTO

Define dedicated DTOs for caching. Never cache Entity or Response directly.

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

**Cache DTO Rules:**
- **Version suffix**: `CachedXxxV1` (for schema evolution)
- **Primitive types only**: `Money` → `BigDecimal`, `UserId` → `Long`
- **Bidirectional conversion**: `from(domain)`, `toDomain()` methods
- **Separated from Domain**: Cache DTOs belong in application layer

## List + Detail Multi-Level Caching

When caching lists, **store IDs only** and separate detail data into a different cache.

```kotlin
// List cache: store IDs only
data class CachedProductList(
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

**Retrieval Flow:**

```kotlin
fun findProducts(criteria: ProductCriteria.FindProducts): ProductInfo.FindProducts {
    val cacheKey = ProductCacheKeys.ProductList.from(criteria)

    if (!cacheKey.shouldCache()) return productService.findProducts(command)

    val cachedList = cacheTemplate.get(cacheKey, TYPE_CACHED_PRODUCT_LIST)

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
    val slice = productService.findProducts(command)
    cacheTemplate.put(cacheKey, CachedProductList(slice.content.map { it.productId }, slice.hasNext()))

    val detailCacheMap = slice.content.associate {
        ProductCacheKeys.ProductDetail(it.productId) to CachedProductDetailV1.from(it)
    }
    cacheTemplate.putAll(detailCacheMap)

    return ProductInfo.FindProducts.from(slice)
}
```

**Benefits:**
- When list query changes, only update ID list
- When detail data changes, invalidate only that ID
- Partial cache hits reduce DB load

## Cache Invalidation

Cache invalidation is handled via **Event-based** approach. Do NOT use `@CacheEvict` annotation.

### Distributed Systems: Kafka Consumer (Recommended)

When multiple services/instances share cache, invalidate by consuming events via Kafka.

```kotlin
// Kafka Consumer: invalidate cache after consuming event
@Component
class ProductStockEventConsumer(
    private val productCacheService: ProductCacheService,
) {
    private val logger = LoggerFactory.getLogger(javaClass)

    @KafkaListener(topics = ["stock-events"], groupId = "cache-invalidation")
    fun onStockEvent(event: StockDepletedEventV1) {
        logger.info("[Event] Stock depleted cache eviction - productIds: ${event.productIds}")
        productCacheService.evictStockDepletedProducts(
            ProductCacheService.EvictStockDepletedCommand(event.productIds)
        )
    }
}

// Cache Service: perform actual invalidation
@Service
class ProductCacheService(
    private val cacheTemplate: CacheTemplate,
) {
    data class EvictStockDepletedCommand(val productIds: List<Long>)

    fun evictStockDepletedProducts(command: EvictStockDepletedCommand) {
        val cacheKeys = command.productIds.map { ProductCacheKeys.ProductDetail(it) }
        cacheTemplate.evictAll(cacheKeys)
    }
}
```

### Single Service: TransactionalEventListener

When cache is used within the same JVM only, invalidate via local event listener.

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
            ?: throw CoreException(ErrorType.NOT_FOUND, "[productId = $productId] Product not found.")

        product.updateStock(quantity)

        if (product.isStockDepleted()) {
            eventPublisher.publishEvent(StockDepletedEventV1.from(product))
        }
    }
}

// Local EventListener: cache invalidation
@Component
class ProductCacheEvictionListener(
    private val cacheTemplate: CacheTemplate,
) {
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    fun onStockDepleted(event: StockDepletedEventV1) {
        cacheTemplate.evict(ProductCacheKeys.ProductDetail(event.productId))
    }
}
```

**Invalidation Rules:**
- **Distributed systems**: Invalidate cache after consuming event via Kafka Consumer
- **Single service**: Use `@TransactionalEventListener(AFTER_COMMIT)`
- **Selective invalidation**: Evict only changed data (`allEntries` forbidden)
- **Event-based**: Trigger cache changes via domain events

## Pre-Aggregated Cache: Batch Job

Pre-aggregated data is loaded into Redis via **Batch Job**.

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

## Forbidden Patterns

The following patterns are strictly forbidden:

- `@Cacheable`, `@CacheEvict` annotations
- Caching in Service/Repository/Infrastructure
- Entity or Response DTO caching
- `allEntries=true` invalidation

## Anti-Patterns

| Wrong Approach | Correct Approach |
|----------------|------------------|
| `@Cacheable` annotation | `CacheTemplate` + Cache-Aside |
| Caching Entity directly | `CachedXxxV1` dedicated DTO |
| Caching Response DTO | Separate cache-specific DTO |
| String literal cache key | Sealed class + TTL embedded |
| Caching entire list data | List(ID) + Detail(data) separation |
| `@CacheEvict(allEntries=true)` | Domain Event + selective evict |
| Cache logic in Service/Repository | Cache management in Facade only |
| Caching in Infrastructure | Infrastructure is cache-agnostic |

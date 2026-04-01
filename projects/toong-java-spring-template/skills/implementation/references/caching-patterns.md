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

```java
@Component
class RankingFacade {
    private final RankingService rankingService;
    private final CacheTemplate cacheTemplate;

    RankingFacade(RankingService rankingService, CacheTemplate cacheTemplate) {
        this.rankingService = rankingService;
        this.cacheTemplate = cacheTemplate;
    }

    public List<ProductRanking> findRankings(RankingCommand.FindRankings command) {
        var cacheKey = new RankingCacheKeys.RankingList(
            command.period(),
            command.baseDate(),
            command.offset(),
            command.limit()
        );

        // Check caching condition
        if (!cacheKey.shouldCache()) {
            return rankingService.findRankings(command);
        }

        // Cache hit
        var cached = cacheTemplate.get(cacheKey, TYPE_CACHED_RANKING_V1);
        if (cached != null) return cached.toProductRankings();

        // Cache miss - call Domain Service
        var rankings = rankingService.findRankings(command);

        // Do not cache empty results
        if (!rankings.isEmpty()) {
            cacheTemplate.put(cacheKey, CachedRankingV1.from(rankings));
        }

        return rankings;
    }
}
```

## Cache Key: Sealed Interface

Define type-safe cache keys using sealed interface. Embed TTL and business logic within the key.

```java
sealed interface RankingCacheKeys extends CacheKey permits RankingCacheKeys.RankingList {

    record RankingList(
        RankingPeriod period,
        LocalDate baseDate,
        long offset,
        int limit
    ) implements RankingCacheKeys {

        @Override
        public Duration ttl() {
            return Duration.ofHours(1);
        }

        @Override
        public String key() {
            return "ranking-cache:v1:" + period.key() + ":" + baseDate + ":" + offset + ":" + limit;
        }

        @Override
        public String traceKey() {
            return "ranking-cache";
        }

        public boolean shouldCache() {
            return period == WEEKLY || period == MONTHLY;
        }
    }
}
```

**Key Rules:**
- **Version included**: Include version like `v1` in key (for schema changes)
- **TTL embedded**: Define appropriate TTL for each key type
- **Business logic**: Define caching conditions like `shouldCache()` in the key

## Cache Model: Versioned DTO

Define dedicated DTOs for caching. Never cache Entity or Response directly.

```java
public record CachedRankingV1(List<Entry> rankings) {

    public record Entry(long productId, int rank, BigDecimal score) {}

    public List<ProductRanking> toProductRankings() {
        return rankings.stream()
            .map(entry -> new ProductRanking(entry.productId(), entry.rank(), entry.score()))
            .toList();
    }

    public static CachedRankingV1 from(List<ProductRanking> rankings) {
        var entries = rankings.stream()
            .map(r -> new Entry(r.productId(), r.rank(), r.score()))
            .toList();
        return new CachedRankingV1(entries);
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

```java
// List cache: store IDs only
public record CachedProductList(List<Long> productIds, boolean hasNext) {}

// Detail cache: actual data
public record CachedProductDetailV1(
    long productId,
    String name,
    BigDecimal price
    // ...
) {}
```

**Retrieval Flow:**

```java
public ProductInfo.FindProducts findProducts(ProductCriteria.FindProducts criteria) {
    var cacheKey = ProductCacheKeys.ProductList.from(criteria);

    if (!cacheKey.shouldCache()) return productService.findProducts(criteria);

    var cachedList = cacheTemplate.get(cacheKey, TYPE_CACHED_PRODUCT_LIST);

    if (cachedList != null) {
        // 1. List cache hit → bulk fetch Detail cache
        var detailCacheKeys = cachedList.productIds().stream()
            .map(ProductCacheKeys.ProductDetail::new)
            .toList();
        var cachedProducts = cacheTemplate.getAll(detailCacheKeys, TYPE_CACHED_PRODUCT_DETAIL_V1);

        var cachedMap = cachedProducts.stream()
            .collect(Collectors.toMap(CachedProductDetailV1::productId, p -> p));
        var missingIds = cachedList.productIds().stream()
            .filter(id -> !cachedMap.containsKey(id))
            .toList();

        // 2. Partial miss → fetch only missing IDs from DB
        var dbProducts = productService.findAllByIds(missingIds);

        // 3. Backfill missing data to cache
        var dbCacheMap = dbProducts.stream()
            .collect(Collectors.toMap(
                p -> new ProductCacheKeys.ProductDetail(p.getProductId()),
                CachedProductDetailV1::from
            ));
        cacheTemplate.putAll(dbCacheMap);

        // 4. Assemble result while preserving order
        return assembleResult(cachedList, cachedMap, dbProducts);
    }

    // Cache miss: fetch from DB and cache both List + Detail
    var slice = productService.findProducts(criteria);
    var productIds = slice.content().stream().map(p -> p.getProductId()).toList();
    cacheTemplate.put(cacheKey, new CachedProductList(productIds, slice.hasNext()));

    var detailCacheMap = slice.content().stream()
        .collect(Collectors.toMap(
            p -> new ProductCacheKeys.ProductDetail(p.getProductId()),
            CachedProductDetailV1::from
        ));
    cacheTemplate.putAll(detailCacheMap);

    return ProductInfo.FindProducts.from(slice);
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

```java
// Kafka Consumer: invalidate cache after consuming event
@Component
class ProductStockEventConsumer {
    private final ProductCacheService productCacheService;
    private static final Logger logger = LoggerFactory.getLogger(ProductStockEventConsumer.class);

    ProductStockEventConsumer(ProductCacheService productCacheService) {
        this.productCacheService = productCacheService;
    }

    @KafkaListener(topics = "stock-events", groupId = "cache-invalidation")
    public void onStockEvent(StockDepletedEventV1 event) {
        logger.info("[Event] Stock depleted cache eviction - productIds: {}", event.productIds());
        productCacheService.evictStockDepletedProducts(
            new ProductCacheService.EvictStockDepletedCommand(event.productIds())
        );
    }
}

// Cache Service: perform actual invalidation
@Service
class ProductCacheService {
    private final CacheTemplate cacheTemplate;

    ProductCacheService(CacheTemplate cacheTemplate) {
        this.cacheTemplate = cacheTemplate;
    }

    public record EvictStockDepletedCommand(List<Long> productIds) {}

    public void evictStockDepletedProducts(EvictStockDepletedCommand command) {
        var cacheKeys = command.productIds().stream()
            .map(ProductCacheKeys.ProductDetail::new)
            .toList();
        cacheTemplate.evictAll(cacheKeys);
    }
}
```

### Single Service: TransactionalEventListener

When cache is used within the same JVM only, invalidate via local event listener.

```java
// Domain Service: publish event
@Component
class ProductService {
    private final ProductRepository productRepository;
    private final ApplicationEventPublisher eventPublisher;

    ProductService(ProductRepository productRepository, ApplicationEventPublisher eventPublisher) {
        this.productRepository = productRepository;
        this.eventPublisher = eventPublisher;
    }

    @Transactional
    public void updateStock(long productId, int quantity) {
        var product = productRepository.findById(productId);
        if (product == null) {
            throw new CoreException(ErrorType.NOT_FOUND, "[productId = " + productId + "] Product not found.");
        }

        product.updateStock(quantity);

        if (product.isStockDepleted()) {
            eventPublisher.publishEvent(StockDepletedEventV1.from(product));
        }
    }
}

// Local EventListener: cache invalidation
@Component
class ProductCacheEvictionListener {
    private final CacheTemplate cacheTemplate;

    ProductCacheEvictionListener(CacheTemplate cacheTemplate) {
        this.cacheTemplate = cacheTemplate;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onStockDepleted(StockDepletedEventV1 event) {
        cacheTemplate.evict(new ProductCacheKeys.ProductDetail(event.productId()));
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

```java
@Component
class RedisAggregationWriter implements ItemWriter<ScoreEntry> {
    private final StringRedisTemplate redisTemplate;

    RedisAggregationWriter(StringRedisTemplate redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    @Override
    public void write(Chunk<? extends ScoreEntry> chunk) {
        var zSetOps = redisTemplate.opsForZSet();

        for (var entry : chunk.getItems()) {
            zSetOps.incrementScore(stagingKey, String.valueOf(entry.productId()), entry.score().doubleValue());
        }

        redisTemplate.expire(stagingKey, TTL_HOURS, TimeUnit.HOURS);
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
| String literal cache key | Sealed interface + TTL embedded |
| Caching entire list data | List(ID) + Detail(data) separation |
| `@CacheEvict(allEntries=true)` | Domain Event + selective evict |
| Cache logic in Service/Repository | Cache management in Facade only |
| Caching in Infrastructure | Infrastructure is cache-agnostic |

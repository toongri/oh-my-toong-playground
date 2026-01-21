# API Patterns

## ApiSpec Pattern (Swagger Documentation)

**Principle**: Separate interface for Swagger annotations - Controller implements interface

```kotlin
// CORRECT: Swagger annotations in interface
@Tag(name = "상품 API", description = "상품 조회 및 관리 API")
interface ProductV1ApiSpec {
    @Operation(summary = "상품 검색", description = "키워드, 카테고리, 가격 범위로 상품을 검색합니다.")
    @ApiResponses(value = [
        ApiResponse(responseCode = "200", description = "검색 성공"),
        ApiResponse(responseCode = "400", description = "잘못된 요청")
    ])
    fun search(
        @Parameter(description = "검색 키워드", example = "노트북")
        keyword: String?,
    ): ApiResponse<ProductV1Response.Search>
}

// Controller implements interface - clean, no Swagger annotations
@RestController
@RequestMapping("/api/v1/products")
class ProductV1Controller(
    private val productFacade: ProductFacade,
) : ProductV1ApiSpec {
    @GetMapping("/search")
    override fun search(keyword: String?): ApiResponse<ProductV1Response.Search> {
        // implementation only
    }
}

// FORBIDDEN: Swagger annotations directly on Controller
@RestController
class ProductV1Controller {
    @Operation(summary = "...")  // Wrong! Put in ApiSpec interface
    @GetMapping("/search")
    fun search(): ApiResponse<...>
}
```

## Query/PageQuery Pattern

**Principle**: Encapsulate pagination in data class with init validation

```kotlin
// CORRECT: Query object with validation
data class ProductPageQuery(
    val page: Int,
    val size: Int,
    val keyword: String? = null,
    val categoryId: Long? = null,
) {
    init {
        require(page >= 0) { "[page = $page] 페이지는 0 이상이어야 합니다." }
        require(size in 1..100) { "[size = $size] 페이지 크기는 1~100이어야 합니다." }
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

// Usage in Service
fun findAll(query: ProductPageQuery): Page<Product> {
    return productRepository.findAll(
        PageRequest.of(query.page, query.size),
        query.keyword,
        query.categoryId
    )
}

// FORBIDDEN: Raw primitive parameters
fun findProducts(offset: Int, limit: Int, keyword: String?): List<Product>
```

## Complete Controller Flow

```kotlin
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

    @PostMapping
    override fun create(
        @RequestBody request: ProductV1Request.Create,
    ): ApiResponse<ProductV1Response.Create> {
        val criteria = request.toCriteria()
        return productFacade.create(criteria)
            .let { ProductV1Response.Create.from(it) }
            .let { ApiResponse.success(it) }
    }
}
```

## Anti-Patterns

| Wrong | Correct | Reason |
|-------|---------|--------|
| Swagger on Controller | Swagger in ApiSpec interface | Separation of concerns |
| Raw `offset`, `limit` params | `PageQuery` object | Encapsulation + validation |
| Controller without ApiSpec | Always implement ApiSpec | Documentation consistency |
| No validation in PageQuery | `init` block validation | Invalid state prevention |

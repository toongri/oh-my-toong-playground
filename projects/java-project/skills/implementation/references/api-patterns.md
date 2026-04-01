# API Patterns

## Why This Matters
Swagger annotations directly on Controller mix business logic and documentation, reducing readability.
Raw primitive parameters (offset, limit) reach DB without validation, causing invalid queries.
ApiSpec separation and PageQuery encapsulation enforce separation of concerns and input validation.

## ApiSpec Pattern (Swagger Documentation)

**Principle**: Separate interface for Swagger annotations - Controller implements interface

```java
// CORRECT: Swagger annotations in interface
@Tag(name = "상품 API", description = "상품 조회 및 관리 API")
interface ProductV1ApiSpec {
    @Operation(summary = "상품 검색", description = "키워드, 카테고리, 가격 범위로 상품을 검색합니다.")
    @ApiResponses(value = {
        @ApiResponse(responseCode = "200", description = "검색 성공"),
        @ApiResponse(responseCode = "400", description = "잘못된 요청")
    })
    ApiResponse<ProductV1Response.Search> search(
        @Parameter(description = "검색 키워드", example = "노트북")
        String keyword
    );
}

// Controller implements interface - clean, no Swagger annotations
@RestController
@RequestMapping("/api/v1/products")
class ProductV1Controller implements ProductV1ApiSpec {
    private final ProductFacade productFacade;

    ProductV1Controller(ProductFacade productFacade) {
        this.productFacade = productFacade;
    }

    @GetMapping("/search")
    @Override
    public ApiResponse<ProductV1Response.Search> search(String keyword) {
        // implementation only
    }
}

// FORBIDDEN: Swagger annotations directly on Controller
@RestController
class ProductV1Controller {
    @Operation(summary = "...")  // Wrong! Put in ApiSpec interface
    @GetMapping("/search")
    public ApiResponse<...> search() {}
}
```

## Query/PageQuery Pattern

**Principle**: Encapsulate pagination in record with compact constructor validation

```java
// CORRECT: Query object with validation
public record ProductPageQuery(
    int page,
    int size,
    String keyword,
    Long categoryId
) {
    public ProductPageQuery {
        if (page < 0) {
            throw new CoreException(ErrorType.BAD_REQUEST, "[page = " + page + "] 페이지는 0 이상이어야 합니다.");
        }
        if (size < 1 || size > 100) {
            throw new CoreException(ErrorType.BAD_REQUEST, "[size = " + size + "] 페이지 크기는 1~100이어야 합니다.");
        }
    }

    public static ProductPageQuery of(int page, int size, String keyword, Long categoryId) {
        return new ProductPageQuery(page, size, keyword, categoryId);
    }

    public static ProductPageQuery of(int page, int size) {
        return new ProductPageQuery(page, size, null, null);
    }
}

// Usage in Service
public Page<Product> findAll(ProductPageQuery query) {
    return productRepository.findAll(
        PageRequest.of(query.page(), query.size()),
        query.keyword(),
        query.categoryId()
    );
}

// FORBIDDEN: Raw primitive parameters
public List<Product> findProducts(int offset, int limit, String keyword) {}
```

## Complete Controller Flow

```java
@RestController
@RequestMapping("/api/v1/products")
class ProductV1Controller implements ProductV1ApiSpec {
    private final ProductFacade productFacade;

    ProductV1Controller(ProductFacade productFacade) {
        this.productFacade = productFacade;
    }

    @GetMapping("/search")
    @Override
    public ApiResponse<ProductV1Response.Search> search(
        @RequestParam String keyword,
        @RequestParam(defaultValue = "0") int page,
        @RequestParam(defaultValue = "20") int size
    ) {
        var query = ProductPageQuery.of(page, size, keyword, null);
        var result = productFacade.search(query);
        var response = ProductV1Response.Search.from(result);
        return ApiResponse.success(response);
    }

    @PostMapping
    @Override
    public ApiResponse<ProductV1Response.Create> create(
        @RequestBody ProductV1Request.Create request
    ) {
        var criteria = request.toCriteria();
        var result = productFacade.create(criteria);
        var response = ProductV1Response.Create.from(result);
        return ApiResponse.success(response);
    }
}
```

## Anti-Patterns

| Wrong | Correct | Reason |
|-------|---------|--------|
| Swagger on Controller | Swagger in ApiSpec interface | Separation of concerns |
| Raw `offset`, `limit` params | `PageQuery` object | Encapsulation + validation |
| Controller without ApiSpec | Always implement ApiSpec | Documentation consistency |
| No validation in PageQuery | compact constructor validation | Invalid state prevention |

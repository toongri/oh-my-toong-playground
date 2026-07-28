# API 패턴

Swagger 문서화를 `ApiSpec` 인터페이스로 분리하고, 페이지네이션을 `Query`/`PageQuery`로 캡슐화해 HTTP 경계를 어떻게 다루는지 정리한다.

## 목차

1. **왜 나누는가** — Swagger 분리와 PageQuery 캡슐화의 배경, 핵심 규칙 요약
2. **ApiSpec 패턴 — Swagger 문서화 분리** — 인터페이스에 어노테이션을 두고 Controller는 구현만 한다
3. **Query/PageQuery 패턴 — 페이지네이션 캡슐화** — init 검증이 있는 데이터 클래스로 원시 파라미터를 대체한다
4. **Complete Controller 흐름** — ApiSpec 구현부터 Facade 위임까지 이어지는 전체 예시
5. **안티패턴** — 자주 반복되는 잘못된 접근과 올바른 대안

---

## 1. 왜 나누는가

Swagger 어노테이션을 Controller에 직접 붙이면 비즈니스 로직과 API 문서화가 뒤섞여 가독성이 떨어진다. `offset`, `limit` 같은 원시 파라미터를 검증 없이 그대로 쓰면 잘못된 값이 검증을 거치지 않고 DB 쿼리까지 도달한다. `ApiSpec` 분리와 `PageQuery` 캡슐화는 관심사 분리와 입력 검증을 동시에 강제하기 위한 장치다.

핵심 규칙은 다음 두 가지로 요약된다.

| 규칙 | 내용 |
|------|------|
| `ApiSpec` 인터페이스 | Swagger 어노테이션은 여기에만 두고, Controller는 이 인터페이스를 구현한다 |
| `Query`/`PageQuery` | 페이지네이션을 데이터 클래스로 캡슐화하고 `init`에서 검증한다 |

`Query`/`PageQuery`의 `init` 검증은 아래처럼 `CoreException`을 던져 표현한다. 메시지 포맷은 항상 `[field = $value] ...` — 필드 접두사가 문장 맨 앞에 온다.

```kotlin
data class ProductPageQuery(val page: Int, val size: Int) {
    init {
        if (page < 0) {
            throw CoreException(ErrorType.BAD_REQUEST, "[page = $page] 페이지는 0 이상이어야 합니다.")
        }
        if (size !in 1..100) {
            throw CoreException(ErrorType.BAD_REQUEST, "[size = $size] 페이지 크기는 1~100이어야 합니다.")
        }
    }
}
```

예외·검증 처방의 전체 규약은 [error-handling.md](./error-handling.md)에서 다룬다.

## 2. ApiSpec 패턴 — Swagger 문서화 분리

**원칙**: Swagger 어노테이션을 위한 별도 인터페이스를 두고, Controller는 그 인터페이스를 구현한다.

```kotlin
// ✅ CORRECT: Swagger 어노테이션은 인터페이스에
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
        @Parameter(description = "페이지 번호", example = "0")
        page: Int,
        @Parameter(description = "페이지 크기", example = "20")
        size: Int,
    ): ApiResponse<ProductV1Response.Search>

    @Operation(summary = "상품 생성", description = "새 상품을 생성합니다.")
    @ApiResponses(value = [
        ApiResponse(responseCode = "200", description = "생성 성공"),
        ApiResponse(responseCode = "400", description = "잘못된 요청")
    ])
    fun create(
        request: ProductV1Request.Create,
    ): ApiResponse<ProductV1Response.Create>
}

// Controller는 인터페이스를 구현 — Swagger 어노테이션 없이 깔끔하다
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
        // implementation only
    }

    @PostMapping
    override fun create(
        @RequestBody request: ProductV1Request.Create,
    ): ApiResponse<ProductV1Response.Create> {
        // implementation only
    }
}
```

```kotlin
// ❌ FORBIDDEN: Swagger 어노테이션을 Controller에 직접
@RestController
class ProductV1Controller {
    @Operation(summary = "...")  // 틀렸다! ApiSpec 인터페이스에 둬야 한다
    @GetMapping("/search")
    fun search(): ApiResponse<...>
}
```

> ⚠️ 주의
> `ApiSpec` 인터페이스와 Controller 클래스 이름은 `{Domain}V{n}ApiSpec` / `{Domain}V{n}Controller` 명명 패턴을 따른다. 컴포넌트 명명 규칙 전체는 [naming-conventions.md](./naming-conventions.md)가 다룬다.

## 3. Query/PageQuery 패턴 — 페이지네이션 캡슐화

**원칙**: 페이지네이션을 `init` 검증이 있는 데이터 클래스로 캡슐화한다.

```kotlin
// ✅ CORRECT: 검증이 있는 Query 객체
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

// Service에서의 사용
fun findAll(query: ProductPageQuery): Page<Product> {
    return productRepository.findAll(
        PageRequest.of(query.page, query.size),
        query.keyword,
        query.categoryId
    )
}
```

```kotlin
// ❌ FORBIDDEN: 원시 파라미터를 그대로 전달
fun findProducts(offset: Int, limit: Int, keyword: String?): List<Product>
```

원시 파라미터 버전은 검증 지점이 없다 — 잘못된 `offset`/`limit`가 그대로 Repository까지 흘러간다. `Query` 객체는 `init`에서 한 번 검증하면 그 뒤의 모든 호출부가 유효한 값만 다루게 된다.

## 4. Complete Controller 흐름

ApiSpec 구현, `PageQuery`/`Criteria` 생성, Facade 위임, 응답 변환이 한 메서드 안에서 어떻게 이어지는지 보여준다.

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

> ⚠️ 주의
> 이 흐름에서 `Controller -> Facade -> Service` 순서 자체와 `@Transactional` 경계 규칙은 [layer-boundaries.md](./layer-boundaries.md)가, `request.toCriteria()`부터 `Response.from()`까지 이어지는 Request/Criteria/Command/Info/Response 계층 구조는 [dto-patterns.md](./dto-patterns.md)가 다룬다. 여기서는 그 계층이 ApiSpec/PageQuery와 만나는 지점만 보여준다.

이 흐름을 HTTP 계약 관점에서 검증하는 방법(상태 코드, 인증 실패 등)은 이 문서가 아니라 [../testing/e2e-test.md](../testing/e2e-test.md)에 있다.

## 5. 안티패턴

지금까지 나온 규칙을 어겼을 때 흔히 나타나는 형태를 한 표로 정리한다.

| 잘못된 방법 | 올바른 방법 | 이유 |
|-------------|-------------|------|
| Controller에 Swagger 직접 부착 | ApiSpec 인터페이스에 Swagger | 관심사 분리 |
| 원시 `offset`, `limit` 파라미터 | `PageQuery` 객체 | 캡슐화 + 검증 |
| ApiSpec 없는 Controller | 항상 ApiSpec 구현 | 문서화 일관성 |
| PageQuery에 검증 없음 | `init` 블록 검증 | 잘못된 상태 방지 |

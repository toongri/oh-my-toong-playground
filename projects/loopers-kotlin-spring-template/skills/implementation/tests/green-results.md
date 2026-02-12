# GREEN Phase Results

Implementation Skill과 함께 생성된 코드를 application-scenarios.md의 VP 기준으로 평가한 결과.

## Summary

| Scenario | Rule | Result | Notes |
|----------|------|--------|-------|
| IM-01 | 1. Controller Flow | PASS | All VPs met |
| IM-02 | 2. Layer Responsibilities | PASS | All VPs met |
| IM-03 | 2. Layer Responsibilities | PASS | All VPs met |
| IM-04 | 2. Layer Responsibilities | PASS | All VPs met |
| IM-05 | 3. Error Handling | PASS | All VPs met |
| IM-06 | 4. DTO Flow | PASS | All VPs met |
| IM-07 | 5. Domain Events | PASS | All VPs met |
| IM-08 | 6. EventListener | PASS | All VPs met |
| IM-09 | 6. EventListener | PASS | All VPs met |
| IM-10 | 7. Entity Encapsulation | PASS | All VPs met |
| IM-11 | 7. Entity Encapsulation | PASS | All VPs met |
| IM-12 | 7. Entity Encapsulation | PASS | All VPs met |
| IM-13 | 7. Entity Encapsulation | PASS | All VPs met |
| IM-14 | 7. Entity Encapsulation | PASS | All VPs met |
| IM-15 | 8. Naming | PASS | All VPs met |
| IM-16 | 8. Naming | PASS | All VPs met |
| IM-17 | 8. Naming | PASS | All VPs met |
| IM-18 | 8. Naming | PASS | All VPs met |
| IM-19 | 9. Domain Purity | PASS | All VPs met |
| IM-20 | 9. Domain Purity | PASS | All VPs met |
| IM-21 | 10. Null Safety | PASS | All VPs met |
| IM-22 | 10. Null Safety | PASS | All VPs met |
| IM-23 | 10. Null Safety | PASS | All VPs met |
| IM-24 | 11. API Patterns | PASS | All VPs met |
| IM-25 | 11. API Patterns | PASS | All VPs met |
| IM-26 | 12. Messages | PASS | All VPs met |
| IM-27 | 13. Caching | PASS | All VPs met |
| IM-28 | 13. Caching | PASS | All VPs met |
| IM-29 | 13. Caching | PASS | All VPs met |

## Statistics

| Metric | Value |
|--------|-------|
| Total Scenarios | 29 |
| PASS | 29 |
| PARTIAL | 0 |
| FAIL | 0 |
| Total VPs | 92 |
| VP PASS | 92 |
| VP FAIL | 0 |
| Pass Rate | 100% |

## Detailed Results

### IM-01: Controller는 Facade만 주입한다
**Result**: PASS
| VP | Check | Expected | Actual | Status |
|----|-------|----------|--------|--------|
| V1 | Controller 생성자에 Facade 주입 | `private val productFacade: ProductFacade` 존재 | `private val productFacade: ProductFacade,` 생성자에 존재 | PASS |
| V2 | Controller 생성자에 Service 직접 주입 없음 | `ProductService` 주입 없음 | `ProductService` 없음 | PASS |
| V3 | Controller가 ApiSpec 구현 | `: ProductV1ApiSpec` 존재 | `) : ProductV1ApiSpec {` 존재 | PASS |

---

### IM-02: Facade는 여러 Service를 조합하며 @Transactional을 관리한다
**Result**: PASS
| VP | Check | Expected | Actual | Status |
|----|-------|----------|--------|--------|
| V1 | Facade에 @Transactional 선언 | `@Transactional` 어노테이션 존재 | `@Transactional` on `createOrder` 메서드 | PASS |
| V2 | 다수 Service 주입 | `orderService`, `couponService`, `pointService` 주입 | 세 Service 모두 생성자에 주입됨 | PASS |
| V3 | Facade가 비즈니스 로직 없이 조율만 수행 | if/when/switch 조건 분기 없음 | `?.let{}` 안전 호출만 사용, 비즈니스 분기 없음 | PASS |

---

### IM-03: Service는 단일 도메인에만 의존하고 조회에 readOnly를 사용한다
**Result**: PASS
| VP | Check | Expected | Actual | Status |
|----|-------|----------|--------|--------|
| V1 | 다른 도메인 Service 주입 없음 | `OrderService`, `PointService` 등 타 도메인 Service 없음 | `couponRepository`와 `eventPublisher`만 주입 | PASS |
| V2 | 조회 메서드에 readOnly=true | `@Transactional(readOnly = true)` 존재 | `findById`에 `@Transactional(readOnly = true)` 적용 | PASS |
| V3 | 자기 도메인 Repository만 주입 | `couponRepository: CouponRepository`만 존재 | `couponRepository: CouponRepository`만 존재 | PASS |

---

### IM-04: Facade에는 비즈니스 로직을 두지 않는다
**Result**: PASS
| VP | Check | Expected | Actual | Status |
|----|-------|----------|--------|--------|
| V1 | Facade에 if/when/switch 분기 없음 | 조건 분기가 Service 또는 Entity에 위임됨 | Facade에 조건 분기 없음, `orderService.process(criteria.to())` 단순 위임 | PASS |
| V2 | Facade는 Service 호출만 수행 | `orderService.process(...)` 형태의 단순 위임 | `orderService.process(criteria.to())` 호출 후 `OrderInfo.Process.from(order)` 변환 | PASS |
| V3 | 비즈니스 로직이 Service/Entity에 존재 | Service 또는 Entity 내부에서 타입별 분기 처리 | Service에서 조회/검증, `order.process()` Entity 위임 | PASS |

---

### IM-05: 단일 CoreException + ErrorType 패턴을 사용한다
**Result**: PASS
| VP | Check | Expected | Actual | Status |
|----|-------|----------|--------|--------|
| V1 | CoreException만 사용 | `throw CoreException(...)` 패턴만 존재 | 모든 예외가 `throw CoreException(...)` 패턴 | PASS |
| V2 | ErrorType enum 활용 | `ErrorType.NOT_FOUND`, `ErrorType.INSUFFICIENT_BALANCE`, `ErrorType.BAD_REQUEST` 사용 | 세 가지 ErrorType 모두 사용됨 | PASS |
| V3 | require() 사용 없음 | `require(...)` 호출 없음 | `require()` 미사용 | PASS |
| V4 | 도메인별 Exception 클래스 없음 | `PointException`, `PointNotFoundException` 등 없음 | 도메인별 Exception 클래스 없음 | PASS |

---

### IM-06: DTO 변환 체인을 완전하게 구성한다
**Result**: PASS
| VP | Check | Expected | Actual | Status |
|----|-------|----------|--------|--------|
| V1 | Request.toCriteria() 변환 존재 | `CouponV1Request.Issue`에 `toCriteria()` 메서드 | `fun toCriteria(): CouponCriteria.Issue` 존재 | PASS |
| V2 | Criteria.to() 변환 존재 | `CouponCriteria.Issue`에 `to()` 메서드 | `fun to(): CouponCommand.Issue` 존재 | PASS |
| V3 | Info.from(entity) 팩토리 존재 | `CouponInfo.Issue`에 `companion object { fun from(coupon) }` | `companion object { fun from(coupon: Coupon): Issue }` 존재 | PASS |
| V4 | Response.from(info) 팩토리 존재 | `CouponV1Response.Issue`에 `companion object { fun from(info) }` | `companion object { fun from(info: CouponInfo.Issue): Issue }` 존재 | PASS |

---

### IM-07: 도메인 이벤트의 5가지 요구사항을 모두 적용한다
**Result**: PASS
| VP | Check | Expected | Actual | Status |
|----|-------|----------|--------|--------|
| V1 | 이벤트명에 V{n} 접미사 | `OrderCreatedEventV1` | `data class OrderCreatedEventV1` | PASS |
| V2 | DomainEvent 인터페이스 구현 | `: DomainEvent` | `) : DomainEvent {` | PASS |
| V3 | occurredAt 필드 존재 | `override val occurredAt: Instant = Instant.now()` | `override val occurredAt: Instant = Instant.now(),` | PASS |
| V4 | 자식 엔티티에 Snapshot 사용 | `OrderItemSnapshot` 클래스 + `companion object { fun from(...) }` | `data class OrderItemSnapshot` with `companion object { fun from(item) }` | PASS |

---

### IM-08: 동기 이벤트 리스너는 BEFORE_COMMIT으로 구성한다
**Result**: PASS
| VP | Check | Expected | Actual | Status |
|----|-------|----------|--------|--------|
| V1 | BEFORE_COMMIT phase 사용 | `@TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)` | 해당 어노테이션 정확히 존재 | PASS |
| V2 | 로깅 포맷 준수 | `logger.info("[Event] ... start/complete - eventType: ..., id: ...")` | start/complete 로깅 포맷 일치 | PASS |
| V3 | @Async 없음 | `@Async` 어노테이션 미사용 | `@Async` 없음 | PASS |

---

### IM-09: 비동기 이벤트 리스너는 AFTER_COMMIT + try-catch로 구성한다
**Result**: PASS
| VP | Check | Expected | Actual | Status |
|----|-------|----------|--------|--------|
| V1 | @Async 어노테이션 존재 | `@Async` 사용 | `@Async` 어노테이션 존재 | PASS |
| V2 | AFTER_COMMIT phase 사용 | `@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)` | 해당 어노테이션 정확히 존재 | PASS |
| V3 | try-catch 에러 핸들링 | `try { ... } catch (e: Exception) { logger.error(...) }` | try-catch 블록 존재, `logger.error(...)` 포함 | PASS |
| V4 | 로깅 포맷 준수 | start/complete/failed 로깅 포함 | start, complete, failed 세 가지 로깅 모두 존재 | PASS |

---

### IM-10: Entity는 BaseEntity를 상속하고 @Table에 인덱스를 정의한다
**Result**: PASS
| VP | Check | Expected | Actual | Status |
|----|-------|----------|--------|--------|
| V1 | BaseEntity 상속 | `: BaseEntity()` | `) : BaseEntity() {` | PASS |
| V2 | @Table에 indexes 정의 | `indexes = [Index(...)]` 존재 | `indexes = [Index(...), Index(...)]` 두 개 정의 | PASS |
| V3 | 쿼리 빈도 기반 인덱스 | `name`, `category_id` 컬럼에 대한 인덱스 | `idx_product_name` (name), `idx_product_category_id` (category_id) | PASS |

---

### IM-11: 모든 가변 프로퍼티는 private set을 사용한다
**Result**: PASS
| VP | Check | Expected | Actual | Status |
|----|-------|----------|--------|--------|
| V1 | status에 private set | `var status: CouponStatus = ... private set` | `var status: CouponStatus = CouponStatus.ISSUED` + `private set` | PASS |
| V2 | usedAt에 private set | `var usedAt: Instant? = null private set` | `var usedAt: Instant? = null` + `private set` | PASS |
| V3 | 외부에서 직접 상태 변경 불가 | setter가 모두 private | status, usedAt, discountAmount 모두 `private set` | PASS |

---

### IM-12: 상태 변경은 도메인 동사 메서드로 수행한다
**Result**: PASS
| VP | Check | Expected | Actual | Status |
|----|-------|----------|--------|--------|
| V1 | 도메인 동사 메서드 존재 | `fun pay()`, `fun cancel()`, `fun complete()` | 세 메서드 모두 존재 | PASS |
| V2 | setter 대신 행위 메서드 사용 | `order.status = ...` 직접 할당 없음 (외부에서) | `private set`으로 외부 직접 할당 불가 | PASS |
| V3 | 상태 전이 검증 포함 | 각 메서드 내 상태 체크 후 CoreException | 각 메서드에 상태 검증 + `throw CoreException(...)` | PASS |

---

### IM-13: Value Object는 불변이며 연산 시 새 인스턴스를 반환한다
**Result**: PASS
| VP | Check | Expected | Actual | Status |
|----|-------|----------|--------|--------|
| V1 | 모든 필드가 val | `val amount: BigDecimal`, `val currency: Currency` | 두 필드 모두 `val` | PASS |
| V2 | 연산이 새 인스턴스 반환 | `fun add(other: Money): Money = Money(...)` | `add`, `subtract` 모두 새 `Money(...)` 반환 | PASS |
| V3 | var 필드 없음 | `var` 키워드 미사용 | `var` 키워드 없음 | PASS |

---

### IM-14: Entity 생성 시 init 블록에서 검증하고 상태 변경 시 이벤트를 등록한다
**Result**: PASS
| VP | Check | Expected | Actual | Status |
|----|-------|----------|--------|--------|
| V1 | init 블록에서 CoreException 검증 | `init { if (...) throw CoreException(...) }` | `init { if (!balance.isPositive()) throw CoreException(...) }` | PASS |
| V2 | require() 미사용 | `require(...)` 호출 없음 | `require()` 없음 | PASS |
| V3 | 상태 변경 시 registerEvent 호출 | `registerEvent(PointUsedEventV1.from(...))` | `use()`, `expire()` 모두 `registerEvent(...)` 호출 | PASS |

---

### IM-15: 클래스 이름은 정해진 패턴을 따른다
**Result**: PASS
| VP | Check | Expected | Actual | Status |
|----|-------|----------|--------|--------|
| V1 | Controller 명명 규칙 | `ShippingV1Controller` | `class ShippingV1Controller` | PASS |
| V2 | Facade/Service 명명 규칙 | `ShippingFacade`, `ShippingService` | `class ShippingFacade`, `class ShippingService` | PASS |
| V3 | Event/PageQuery 명명 규칙 | `ShippingStartedEventV1`, `ShippingPageQuery` | `data class ShippingStartedEventV1`, `data class ShippingPageQuery` | PASS |
| V4 | ApiSpec 명명 규칙 | `ShippingV1ApiSpec` | `interface ShippingV1ApiSpec` | PASS |

---

### IM-16: 메서드 이름은 도메인 동사를 사용한다
**Result**: PASS
| VP | Check | Expected | Actual | Status |
|----|-------|----------|--------|--------|
| V1 | 도메인 동사 사용 | `use()`, `expire()`, `cancel()` | `fun use()`, `fun expire()`, `fun cancel()` | PASS |
| V2 | 기술적 동사 미사용 | `processUsage()`, `handleExpiration()`, `executeCancellation()` 없음 | 기술적 동사 메서드 없음 | PASS |

---

### IM-17: 변수명은 축약 없이 전체 서술형으로 작성한다
**Result**: PASS
| VP | Check | Expected | Actual | Status |
|----|-------|----------|--------|--------|
| V1 | 전체 서술형 변수명 사용 | `totalProductAmount`, `discountAmount`, `shippingFee`, `finalPaymentAmount` | 네 변수 모두 전체 서술형 | PASS |
| V2 | 축약 변수명 미사용 | `amt`, `disc`, `qty`, `fee` 단독 사용 없음 | 축약 변수명 없음 | PASS |

---

### IM-18: Boolean 이름은 is/has/canBe 접두사를 사용한다
**Result**: PASS
| VP | Check | Expected | Actual | Status |
|----|-------|----------|--------|--------|
| V1 | is{Adjective} 패턴 | `isExpired` | `val isExpired: Boolean` | PASS |
| V2 | has{Noun} 패턴 | `hasRemainingQuantity()` | `fun hasRemainingQuantity(): Boolean` | PASS |
| V3 | canBe{Verb} 패턴 | `canBeUsed()` | `fun canBeUsed(): Boolean` | PASS |

---

### IM-19: 도메인 레이어에 인프라 import를 사용하지 않는다
**Result**: PASS
| VP | Check | Expected | Actual | Status |
|----|-------|----------|--------|--------|
| V1 | Entity에 JPA 어노테이션 허용 | `@Entity`, `@Table`, `@Column` 사용 | `@Entity`, `@Table`, `@Column`, `@Enumerated` 사용 | PASS |
| V2 | Entity에 @Transactional 없음 | `@Transactional` import/사용 없음 | Entity 클래스에 `@Transactional` 없음 | PASS |
| V3 | Entity에 @JsonProperty 없음 | `@JsonProperty`, `@JsonIgnore` import/사용 없음 | JSON 관련 어노테이션 없음 | PASS |
| V4 | Entity에 Spring Data import 없음 | `org.springframework.data.*` import 없음 | Spring Data import 없음 | PASS |

---

### IM-20: Repository는 도메인에 인터페이스, 인프라에 구현체를 둔다
**Result**: PASS
| VP | Check | Expected | Actual | Status |
|----|-------|----------|--------|--------|
| V1 | 도메인에 인터페이스 존재 | `interface OrderRepository` in `domain/order/` | `package com.project.domain.order` 내 `interface OrderRepository` | PASS |
| V2 | 인프라에 구현체 존재 | `class OrderRdbRepository : OrderRepository` in `infrastructure/` | `package com.project.infrastructure.persistence.order` 내 구현체 | PASS |
| V3 | 도메인에 JPA import 없음 | `JpaRepository` import 없음 (도메인 내) | 도메인 인터페이스에 JPA import 없음 | PASS |

---

### IM-21: 필수 필드는 Non-nullable로 선언한다
**Result**: PASS
| VP | Check | Expected | Actual | Status |
|----|-------|----------|--------|--------|
| V1 | 필수 필드 Non-nullable | `val name: String`, `val price: Money` (? 없음) | `val name: String`, `price: Money`, `val categoryId: Long` 모두 non-nullable | PASS |
| V2 | 선택 필드 Nullable | `val description: String?` | `val description: String? = null` | PASS |
| V3 | 필수 필드에 `?` 없음 | `String?` 형태가 필수 필드에 사용되지 않음 | 필수 필드에 `?` 없음 | PASS |

---

### IM-22: 조회 실패 시 !! 대신 ?: throw CoreException을 사용한다
**Result**: PASS
| VP | Check | Expected | Actual | Status |
|----|-------|----------|--------|--------|
| V1 | Elvis + CoreException 패턴 | `?: throw CoreException(ErrorType.NOT_FOUND, ...)` | `findById`, `pay` 메서드 모두 `?: throw CoreException(...)` 사용 | PASS |
| V2 | !! 연산자 미사용 | `!!` 없음 | `!!` 연산자 없음 | PASS |
| V3 | 에러 메시지에 컨텍스트 포함 | `[orderId = $id]` 형태 | `[orderId = $id]`, `[orderId = ${command.orderId}]` 사용 | PASS |

---

### IM-23: Optional 데이터는 안전 호출 연산자를 사용한다
**Result**: PASS
| VP | Check | Expected | Actual | Status |
|----|-------|----------|--------|--------|
| V1 | ?.let{} 패턴 사용 | `couponDiscount?.let { ... }` | `couponDiscount?.let { discount -> ... }` | PASS |
| V2 | listOfNotNull() 사용 | `listOfNotNull(couponDiscount, pointDiscount, gradeDiscount)` | `listOfNotNull(couponDiscount, pointDiscount, gradeDiscount)` 존재 | PASS |
| V3 | Java 스타일 null 체크 미사용 | `if (x != null)` 대신 `?.let{}` 사용 | `if (x != null)` 패턴 없음, `?.let{}` 사용 | PASS |

---

### IM-24: API 문서는 ApiSpec 인터페이스에 분리한다
**Result**: PASS
| VP | Check | Expected | Actual | Status |
|----|-------|----------|--------|--------|
| V1 | ApiSpec 인터페이스에 Swagger 어노테이션 | `@Tag`, `@Operation`, `@ApiResponses` in interface | `ProductV1ApiSpec`에 `@Tag`, `@Operation`, `@ApiResponses`, `@Parameter` 모두 존재 | PASS |
| V2 | Controller에 Swagger 어노테이션 없음 | Controller 클래스에 `@Operation` 등 없음 | Controller에 Swagger 어노테이션 없음 | PASS |
| V3 | Controller가 ApiSpec 구현 | `class ProductV1Controller : ProductV1ApiSpec` | `) : ProductV1ApiSpec {` 존재 | PASS |

---

### IM-25: 페이지네이션은 PageQuery 객체로 캡슐화하고 init에서 검증한다
**Result**: PASS
| VP | Check | Expected | Actual | Status |
|----|-------|----------|--------|--------|
| V1 | init 블록에서 검증 | `init { if (page < 0) throw CoreException(...) }` | `init` 블록에서 page, size 검증 | PASS |
| V2 | CoreException 사용 (require 아님) | `throw CoreException(ErrorType.BAD_REQUEST, ...)` | `throw CoreException(ErrorType.BAD_REQUEST, ...)` 사용, `require()` 없음 | PASS |
| V3 | 에러 메시지에 [field = $value] 접두사 | `[page = $page]`, `[size = $size]` | `[page = $page]`, `[size = $size]` 접두사 존재 | PASS |

---

### IM-26: 에러 메시지는 한국어이며 [field = $value] 접두사로 시작한다
**Result**: PASS
| VP | Check | Expected | Actual | Status |
|----|-------|----------|--------|--------|
| V1 | 한국어 메시지 | 영문 메시지 없음 | 모든 메시지 한국어 (`사용자를 찾을 수 없습니다`, `이미 존재하는 이메일입니다`, `비밀번호는 8자 이상...`) | PASS |
| V2 | [field = $value] 접두사가 맨 앞 | 메시지 시작이 `[` | `[userId = $id]`, `[email = ${command.email}]`, `[password = ***]` 모두 맨 앞 | PASS |
| V3 | 접두사가 맨 뒤에 오지 않음 | `... [field = $value]` 형태 없음 | 모든 접두사가 메시지 시작에 위치 | PASS |

---

### IM-27: 캐싱은 Facade에서만 CacheTemplate으로 수행한다
**Result**: PASS
| VP | Check | Expected | Actual | Status |
|----|-------|----------|--------|--------|
| V1 | Facade에서 캐싱 로직 수행 | `RankingFacade`에서 `cacheTemplate` 사용 | `RankingFacade` 생성자에 `cacheTemplate: CacheTemplate` 주입 | PASS |
| V2 | @Cacheable 미사용 | `@Cacheable` 어노테이션 없음 | `@Cacheable` 없음 | PASS |
| V3 | CacheTemplate API 사용 | `cacheTemplate.get(...)`, `cacheTemplate.put(...)` | `cacheTemplate.get(cacheKey, ...)`, `cacheTemplate.put(cacheKey, ...)` 사용 | PASS |

---

### IM-28: 캐시 키는 sealed class로 정의하고 TTL을 내장한다
**Result**: PASS
| VP | Check | Expected | Actual | Status |
|----|-------|----------|--------|--------|
| V1 | sealed class 구조 | `sealed class ProductCacheKeys(...) : CacheKey` | `sealed class ProductCacheKeys(override val ttl: Duration) : CacheKey` | PASS |
| V2 | TTL 내장 | `ttl = Duration.ofHours(1)`, `ttl = Duration.ofMinutes(30)` | `ProductDetail`: 1시간, `ProductList`: 30분 | PASS |
| V3 | key에 버전 포함 | `"product-cache:v1:..."` | `"product-cache:v1:detail:..."`, `"product-cache:v1:list:..."` | PASS |

---

### IM-29: 캐시 모델은 CachedXxxV1으로 버전화하고 도메인 이벤트로 무효화한다
**Result**: PASS
| VP | Check | Expected | Actual | Status |
|----|-------|----------|--------|--------|
| V1 | CachedXxxV1 버전화 DTO | `CachedProductDetailV1` data class | `data class CachedProductDetailV1` 존재 | PASS |
| V2 | Entity/Response 직접 캐싱 없음 | `Product`, `ProductV1Response` 캐싱 없음 | 전용 DTO `CachedProductDetailV1` 사용, Entity/Response 직접 캐싱 없음 | PASS |
| V3 | 도메인 이벤트 기반 무효화 | `@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)` | `ProductCacheEvictionListener`에 해당 어노테이션 존재 | PASS |
| V4 | 선택적 evict (@CacheEvict/allEntries 아님) | `cacheTemplate.evict(ProductCacheKeys.ProductDetail(...))` | `cacheTemplate.evict(ProductCacheKeys.ProductDetail(event.productId))` | PASS |

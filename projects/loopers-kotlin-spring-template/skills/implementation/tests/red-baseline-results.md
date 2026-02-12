# RED Phase Baseline Results

스킬 없이 생성된 코드를 VP 기준으로 평가한 결과. 대부분의 시나리오에서 violations이 발생해야 시나리오가 올바른 것을 테스트한다는 의미이다.

## Summary

| Scenario | Rule | Result | Violations |
|----------|------|--------|------------|
| IM-01 | 1. Controller Flow | FAIL | V1 fail, V2 fail, V3 fail |
| IM-02 | 2. Layer Responsibilities | FAIL | V1 fail, V2 fail, V3 fail |
| IM-05 | 3. Error Handling | FAIL | V1 fail, V2 fail, V4 fail |
| IM-06 | 4. DTO Flow | FAIL | V1 fail, V2 fail, V3 fail, V4 fail |
| IM-07 | 5. Domain Events | FAIL | V1 fail, V2 fail, V3 fail, V4 fail |
| IM-09 | 6. EventListener (Async) | PARTIAL | V4 fail |
| IM-10 | 7. Entity Encapsulation | PARTIAL | V1 fail |
| IM-15 | 8. Naming | FAIL | V1 fail, V2 fail, V3 fail, V4 fail |
| IM-19 | 9. Domain Purity | PARTIAL | V4 fail |
| IM-22 | 10. Null Safety | FAIL | V1 fail, V2 pass, V3 fail |
| IM-24 | 11. API Patterns (ApiSpec) | FAIL | V1 fail, V2 fail, V3 fail |
| IM-26 | 12. Messages | FAIL | V1 fail, V2 fail, V3 fail |
| IM-27 | 13. Caching | FAIL | V1 fail, V2 fail, V3 fail |

**Overall**: 10 FAIL / 3 PARTIAL / 0 PASS (violations rate: 100%)

---

## Detailed Results

### IM-01: Controller는 Facade만 주입한다

**Result**: FAIL

| VP | Check | Expected | Actual | Status |
|----|-------|----------|--------|--------|
| V1 | Controller 생성자에 Facade 주입 | `private val productFacade: ProductFacade` 존재 | `private val productService: ProductService` - Service 직접 주입, Facade 없음 | FAIL |
| V2 | Controller 생성자에 Service 직접 주입 없음 | `ProductService` 주입 없음 | `ProductService`가 직접 주입됨 | FAIL |
| V3 | Controller가 ApiSpec 구현 | `: ProductV1ApiSpec` 존재 | ApiSpec 인터페이스 미구현, `ProductController` 클래스명에 V1 접미사도 없음 | FAIL |

**Violations**: Controller가 Facade 없이 Service를 직접 주입하고 있으며, ApiSpec 인터페이스를 구현하지 않는다. 전형적인 Controller -> Service 직접 호출 패턴으로, Facade 레이어가 완전히 누락되었다.

---

### IM-02: Facade는 여러 Service를 조합하며 @Transactional을 관리한다

**Result**: FAIL

| VP | Check | Expected | Actual | Status |
|----|-------|----------|--------|--------|
| V1 | Facade에 @Transactional 선언 | `@Transactional` 어노테이션 존재 | Facade 클래스 자체가 존재하지 않음. `OrderService`가 `@Transactional`을 직접 선언 | FAIL |
| V2 | 다수 Service 주입 | `orderService`, `couponService`, `pointService` 주입 | Facade 없이 `OrderService`에 `couponService`, `pointService`를 직접 주입 | FAIL |
| V3 | Facade가 비즈니스 로직 없이 조율만 수행 | if/when/switch 조건 분기 없음 | Facade 없음. `OrderService`에 `if (request.couponId != null)`, `if (request.pointsToUse > 0)` 등 비즈니스 분기 로직이 혼재 | FAIL |

**Violations**: Facade 레이어가 완전히 누락되었다. OrderService가 다른 도메인(Coupon, Point)의 Service를 직접 주입받아 호출하고 있으며, 비즈니스 로직과 트랜잭션 조율이 Service 내부에서 혼재된다. 단일 도메인 Service 원칙과 Facade 조율 원칙 모두 위반.

---

### IM-05: 단일 CoreException + ErrorType 패턴을 사용한다

**Result**: FAIL

| VP | Check | Expected | Actual | Status |
|----|-------|----------|--------|--------|
| V1 | CoreException만 사용 | `throw CoreException(...)` 패턴만 존재 | `throw PointNotFoundException(userId)`, `throw InsufficientPointBalanceException(...)`, `throw ExpiredPointException(...)` - 도메인별 커스텀 예외 사용 | FAIL |
| V2 | ErrorType enum 활용 | `ErrorType.NOT_FOUND`, `ErrorType.INSUFFICIENT_BALANCE`, `ErrorType.BAD_REQUEST` 사용 | `ErrorType` enum 미사용. 각 예외 클래스가 개별적으로 HTTP 상태 매핑 | FAIL |
| V3 | require() 사용 없음 | `require(...)` 호출 없음 | `require()` 호출 없음 | PASS |
| V4 | 도메인별 Exception 클래스 없음 | `PointException`, `PointNotFoundException` 등 없음 | `PointNotFoundException`, `InsufficientPointBalanceException`, `ExpiredPointException` 3개의 도메인별 예외 클래스 정의 | FAIL |

**Violations**: 도메인별 커스텀 예외 클래스를 개별 정의하고 있으며, 각 예외에 대한 `@ExceptionHandler`도 개별 구현. CoreException + ErrorType 통합 패턴이 아닌 산발적 예외 관리 방식을 사용한다.

---

### IM-06: DTO 변환 체인을 완전하게 구성한다

**Result**: FAIL

| VP | Check | Expected | Actual | Status |
|----|-------|----------|--------|--------|
| V1 | Request.toCriteria() 변환 존재 | `CouponV1Request.Issue`에 `toCriteria()` 메서드 | `IssueCouponRequest`에 `toCriteria()` 없음. Request를 Service에 직접 전달 (`couponService.issue(request)`) | FAIL |
| V2 | Criteria.to() 변환 존재 | `CouponCriteria.Issue`에 `to()` 메서드 | Criteria 클래스 자체가 존재하지 않음 | FAIL |
| V3 | Info.from(entity) 팩토리 존재 | `CouponInfo.Issue`에 `companion object { fun from(coupon) }` | Info 클래스 없음. `CouponResponse.from(coupon: Coupon)` - Response가 Entity에서 직접 변환 | FAIL |
| V4 | Response.from(info) 팩토리 존재 | `CouponV1Response.Issue`에 `companion object { fun from(info) }` | `CouponResponse.from(coupon: Coupon)` - Info가 아닌 Entity에서 직접 변환 | FAIL |

**Violations**: Request -> Criteria -> Command -> Info -> Response 전체 DTO 변환 체인이 존재하지 않는다. Request를 Service에 직접 전달하고, Response가 Entity에서 직접 변환하는 2단계 단순 구조만 사용. Criteria, Command, Info 레이어가 완전히 누락되었다.

---

### IM-07: 도메인 이벤트의 5가지 요구사항을 모두 적용한다

**Result**: FAIL

| VP | Check | Expected | Actual | Status |
|----|-------|----------|--------|--------|
| V1 | 이벤트명에 V{n} 접미사 | `OrderCreatedEventV1` | `OrderCreatedEvent` - V1 접미사 없음 | FAIL |
| V2 | DomainEvent 인터페이스 구현 | `: DomainEvent` | DomainEvent 인터페이스 미구현. 단순 data class로 선언 | FAIL |
| V3 | occurredAt 필드 존재 | `override val occurredAt: Instant = Instant.now()` | `val createdAt: LocalDateTime = LocalDateTime.now()` - 필드명이 `createdAt`(not `occurredAt`), 타입이 `LocalDateTime`(not `Instant`) | FAIL |
| V4 | 자식 엔티티에 Snapshot 사용 | `OrderItemSnapshot` 클래스 + `companion object { fun from(...) }` | `OrderItemInfo` 클래스 사용 - Snapshot 네이밍 컨벤션 미준수 | FAIL |

**Violations**: 도메인 이벤트의 5가지 요구사항(V{n} 접미사, DomainEvent 인터페이스, occurredAt: Instant, companion object factory, Snapshot) 중 어느 것도 충족하지 않는다. 표준 Spring AbstractAggregateRoot의 registerEvent만 사용하고, 이벤트 구조 규칙은 적용되지 않았다.

---

### IM-09: 비동기 이벤트 리스너는 AFTER_COMMIT + try-catch로 구성한다

**Result**: PARTIAL

| VP | Check | Expected | Actual | Status |
|----|-------|----------|--------|--------|
| V1 | @Async 어노테이션 존재 | `@Async` 사용 | `@Async` 존재 | PASS |
| V2 | AFTER_COMMIT phase 사용 | `@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)` | `@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)` 존재 | PASS |
| V3 | try-catch 에러 핸들링 | `try { ... } catch (e: Exception) { logger.error(...) }` | try-catch 존재, `log.error(...)` 호출 | PASS |
| V4 | 로깅 포맷 준수 | start/complete/failed 로깅 포함 | `[Event]` 접두사 미사용. start 로깅 없음. `"Order notification sent successfully for order: ${event.orderId}"` - 정규화된 로깅 포맷 미준수 | FAIL |

**Violations**: 비동기 이벤트 리스너의 핵심 구조(@Async, AFTER_COMMIT, try-catch)는 올바르나, 로깅 포맷이 규칙을 따르지 않는다. `[Event]` 접두사, `eventType:` 메타데이터, start/complete/failed 3단계 로깅 패턴이 미적용.

---

### IM-10: Entity는 BaseEntity를 상속하고 @Table에 인덱스를 정의한다

**Result**: PARTIAL

| VP | Check | Expected | Actual | Status |
|----|-------|----------|--------|--------|
| V1 | BaseEntity 상속 | `: BaseEntity()` | `@Id @GeneratedValue(strategy = GenerationType.IDENTITY) val id: Long? = null` - BaseEntity 상속 없이 id를 직접 선언 | FAIL |
| V2 | @Table에 indexes 정의 | `indexes = [Index(...)]` 존재 | `indexes = [Index(name = "idx_product_name", columnList = "name"), Index(name = "idx_product_category_id", columnList = "category_id")]` 존재 | PASS |
| V3 | 쿼리 빈도 기반 인덱스 | `name`, `category_id` 컬럼에 대한 인덱스 | `name`, `category_id` 인덱스 모두 정의 | PASS |

**Violations**: BaseEntity 상속이 누락되었다. `@Id`와 `@GeneratedValue`를 직접 선언하고 `id: Long? = null`로 nullable하게 처리하는 표준 JPA 패턴을 사용. BaseEntity가 제공하는 공통 필드(createdAt, updatedAt 등)와 이벤트 등록 기능(registerEvent)을 활용하지 않는다.

---

### IM-15: 클래스 이름은 정해진 패턴을 따른다

**Result**: FAIL

| VP | Check | Expected | Actual | Status |
|----|-------|----------|--------|--------|
| V1 | Controller 명명 규칙 | `ShippingV1Controller` | `ShippingController` - V1 버전 접미사 없음 | FAIL |
| V2 | Facade/Service 명명 규칙 | `ShippingFacade`, `ShippingService` (@Component) | Facade 클래스 없음. `ShippingService`에 `@Service` 어노테이션 사용 (`@Component` 아님) | FAIL |
| V3 | Event/PageQuery 명명 규칙 | `ShippingStartedEventV1`, `ShippingPageQuery` | `ShippingStatusChangedEvent` - V1 접미사 없음, 이벤트명도 Started가 아닌 StatusChanged. PageQuery 클래스 없음 | FAIL |
| V4 | ApiSpec 명명 규칙 | `ShippingV1ApiSpec` | ApiSpec 인터페이스 자체가 존재하지 않음 | FAIL |

**Violations**: 명명 규칙의 핵심 요소가 전혀 적용되지 않았다. V1 버전 접미사 부재(Controller, Event), Facade 레이어 부재, ApiSpec 인터페이스 부재, PageQuery 객체 부재, @Component 대신 @Service 사용.

---

### IM-19: 도메인 레이어에 인프라 import를 사용하지 않는다

**Result**: PARTIAL

| VP | Check | Expected | Actual | Status |
|----|-------|----------|--------|--------|
| V1 | Entity에 JPA 어노테이션 허용 | `@Entity`, `@Table`, `@Column` 사용 | `@Entity`, `@Table`, `@Column`, `@Enumerated` 사용 | PASS |
| V2 | Entity에 @Transactional 없음 | `@Transactional` import/사용 없음 | Entity에 `@Transactional` 없음 | PASS |
| V3 | Entity에 @JsonProperty 없음 | `@JsonProperty`, `@JsonIgnore` import/사용 없음 | Entity에 `@JsonProperty` 없음 | PASS |
| V4 | Entity에 Spring Data import 없음 | `org.springframework.data.*` import 없음 | `interface OrderRepository : JpaRepository<Order, Long>` - Repository가 Entity와 같은 파일에 위치하며 `JpaRepository`를 직접 상속. 도메인 레이어에 Spring Data 의존성이 존재 | FAIL |

**Violations**: Entity 자체는 JPA 어노테이션만 사용하여 도메인 순수성을 유지하나, Repository가 도메인 레이어에서 `JpaRepository`를 직접 상속하고 있다. 도메인에 인터페이스를 두고 인프라에 구현체를 분리하는 Repository Abstraction 패턴이 적용되지 않았다.

---

### IM-22: 조회 실패 시 !! 대신 ?: throw CoreException을 사용한다

**Result**: FAIL

| VP | Check | Expected | Actual | Status |
|----|-------|----------|--------|--------|
| V1 | Elvis + CoreException 패턴 | `?: throw CoreException(ErrorType.NOT_FOUND, ...)` | `.orElseThrow { OrderNotFoundException(id) }` - Java Optional 스타일 사용, CoreException 미사용 | FAIL |
| V2 | !! 연산자 미사용 | `!!` 없음 | `ex.message ?: "Order not found"` - ExceptionHandler에서 Elvis 연산자 사용, `!!` 미사용 | PASS |
| V3 | 에러 메시지에 컨텍스트 포함 | `[orderId = $id]` 형태 | `"Order not found with id: $id"` - `[field = $value]` 접두사 패턴 미사용 | FAIL |

**Violations**: Kotlin의 nullable 타입을 활용한 `?: throw CoreException` 패턴 대신 Java의 `Optional.orElseThrow`를 사용. 도메인별 커스텀 예외(`OrderNotFoundException`)를 사용하며, 에러 메시지도 영문으로 `[field = $value]` 접두사 패턴을 따르지 않는다. 단, `!!` 연산자는 사용하지 않고 `ex.message ?: "Order not found"`로 Elvis 연산자를 올바르게 사용하고 있다.

---

### IM-24: API 문서는 ApiSpec 인터페이스에 분리한다

**Result**: FAIL

| VP | Check | Expected | Actual | Status |
|----|-------|----------|--------|--------|
| V1 | ApiSpec 인터페이스에 Swagger 어노테이션 | `@Tag`, `@Operation`, `@ApiResponses` in interface | ApiSpec 인터페이스 자체가 존재하지 않음. 모든 Swagger 어노테이션이 Controller에 직접 선언 | FAIL |
| V2 | Controller에 Swagger 어노테이션 없음 | Controller 클래스에 `@Operation` 등 없음 | Controller에 `@Tag`, `@Operation`, `@ApiResponses`, `@Parameter` 직접 사용 | FAIL |
| V3 | Controller가 ApiSpec 구현 | `class ProductV1Controller : ProductV1ApiSpec` | ApiSpec 미구현. `ProductController`로 명명 (V1 접미사 없음) | FAIL |

**Violations**: API 문서화를 위한 Swagger 어노테이션이 Controller 클래스에 직접 선언되어 있다. ApiSpec 인터페이스로의 분리가 전혀 이루어지지 않았으며, Controller 코드가 비즈니스 로직과 API 문서 정의로 오염되어 있다.

---

### IM-26: 에러 메시지는 한국어이며 [field = $value] 접두사로 시작한다

**Result**: FAIL

| VP | Check | Expected | Actual | Status |
|----|-------|----------|--------|--------|
| V1 | 한국어 메시지 | 영문 메시지 없음 | 모든 메시지가 영문. `"User not found with id: $userId"`, `"Email already exists: $email"`, `"Password must be at least 8 characters long..."` | FAIL |
| V2 | [field = $value] 접두사가 맨 앞 | 메시지 시작이 `[` | `[field = $value]` 접두사 패턴 미사용. 일반 영문 문장 형태 | FAIL |
| V3 | 접두사가 맨 뒤에 오지 않음 | `... [field = $value]` 형태 없음 | 접두사 패턴 자체가 미사용. 하지만 `"User not found with id: $userId"` 처럼 식별값이 메시지 끝에 위치하여 디버깅 시 파싱이 어려운 구조 | FAIL |

**Violations**: 에러 메시지 규칙이 전혀 적용되지 않았다. 모든 메시지가 영문이며, `[field = $value]` 접두사 패턴이 사용되지 않는다. 또한 CoreException이 아닌 도메인별 커스텀 예외를 사용하므로 메시지 구조화 자체가 불가능한 구조이다.

---

### IM-27: 캐싱은 Facade에서만 CacheTemplate으로 수행한다

**Result**: FAIL

| VP | Check | Expected | Actual | Status |
|----|-------|----------|--------|--------|
| V1 | Facade에서 캐싱 로직 수행 | `RankingFacade`에서 `cacheTemplate` 사용 | Facade 없음. `RankingService`에서 직접 `@Cacheable` 어노테이션으로 캐싱 | FAIL |
| V2 | @Cacheable 미사용 | `@Cacheable` 어노테이션 없음 | `@Cacheable(value = ["ranking"], key = "...", condition = "...", unless = "...")` 사용 | FAIL |
| V3 | CacheTemplate API 사용 | `cacheTemplate.get(...)`, `cacheTemplate.put(...)` | CacheTemplate 미사용. Spring Cache abstraction (`@Cacheable`, `@CacheEvict`) + Caffeine 캐시 매니저 사용 | FAIL |

**Violations**: 캐싱 전략이 규칙과 완전히 다르다. Facade 레이어 없이 Service에서 직접 `@Cacheable`을 사용하며, CacheTemplate 기반의 명시적 캐시 제어 대신 Spring Cache abstraction의 선언적 캐싱을 사용한다. `@CacheEvict(allEntries = true)`로 전체 캐시를 무효화하는 방식도 선택적 evict 규칙에 위반된다.

---

## Statistics

| Metric | Count | Percentage |
|--------|-------|------------|
| FAIL | 10 | 76.9% |
| PARTIAL | 3 | 23.1% |
| PASS | 0 | 0.0% |
| **Total Scenarios** | **13** | **100%** |

| VP Metric | Count | Percentage |
|-----------|-------|------------|
| VP FAIL | 35 | 77.8% |
| VP PASS | 10 | 22.2% |
| **Total VPs** | **45** | **100%** |

## Conclusion

13개 시나리오 중 PASS가 0개이며, 77.8%의 VP에서 violations이 발생했다. 이는 스킬 없이 생성된 코드가 프로젝트 규칙을 자연적으로 따르지 않음을 입증한다. PARTIAL로 판정된 3개 시나리오(IM-09, IM-10, IM-19)도 부분적 violations이 존재하여, 모든 시나리오가 유의미한 차이를 검출하고 있다.

주요 위반 패턴:
1. **Facade 레이어 부재** (IM-01, IM-02, IM-15, IM-27): 표준 Spring 개발에서 Controller -> Service 직접 호출이 일반적
2. **커스텀 예외 남용** (IM-05, IM-22, IM-26): CoreException + ErrorType 통합 패턴 대신 도메인별 예외 클래스 개별 정의
3. **DTO 체인 부재** (IM-06): Request -> Entity -> Response 단순 구조로, Criteria/Command/Info 레이어 누락
4. **이벤트 구조 미준수** (IM-07): V{n} 접미사, DomainEvent 인터페이스, Snapshot 등 이벤트 설계 규칙 미적용
5. **명명 규칙 미준수** (IM-15, IM-24): V1 버전 접미사, ApiSpec 분리 등 프로젝트 고유 명명 패턴 미적용
6. **영문 메시지** (IM-26): 한국어 메시지 + [field = $value] 접두사 규칙 미적용

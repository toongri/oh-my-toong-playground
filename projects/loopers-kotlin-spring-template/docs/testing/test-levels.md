# 테스트 레벨 선택과 외부 의존성 전략

작성하려는 테스트가 어느 레벨에 속하는지 판단하고, 그 레벨에서 외부 의존성을 무엇으로 다룰지 결정하는 기준을 담는다.

## 목차

1. **빠른 참조** — 레벨별 파일 패턴과 외부 의존성 한눈에 보기
2. **외부 의존성이란 무엇인가** — 레벨을 가르는 기준선
3. **레벨 분류 기준** — 무엇을 테스트하는지로 레벨을 정한다
4. **판단 흐름** — 질문에 답하며 레벨을 좁혀간다
5. **단순 CRUD의 레벨 판단** — pass-through Service는 Unit인가 Integration인가
6. **판단이 애매할 때** — 7가지 원칙
7. **외부 의존성 처리 원칙** — 무엇을 실제로 쓰고 무엇을 흉내내는가
8. **WireMock으로 외부 시스템 흉내내기** — 일반 stub 문법
9. **Testcontainers로 실제 인스턴스 사용하기**
10. **무엇을 모킹하지 않는가**
11. **테스트 후 정리** — 외부 상태를 지운다
12. **레벨별·주제별 문서로 이동하기**

---

## 1. 빠른 참조

프로젝트에는 6개 테스트 레벨이 있다. 파일명 패턴만으로 레벨을 구분할 수 있도록 아래 표를 기준으로 삼는다.

| 레벨        | 파일 패턴              | 사용 시점                             | 외부 의존성               |
|-------------|-------------------------|----------------------------------------|----------------------------|
| Unit        | `*Test.kt`              | 도메인 로직, 값 객체, 순수 함수        | 없음                       |
| Integration | `*IntegrationTest.kt`   | Service + Repository, 트랜잭션         | 실제 DB                    |
| Concurrency | `*ConcurrencyTest.kt`   | 락, 경쟁 상태(race condition)          | 실제 DB                    |
| Adapter     | `*AdapterTest.kt`       | 외부 API 클라이언트, 쿼리              | WireMock, Testcontainers   |
| E2E         | `*E2ETest.kt`           | 전체 API 흐름, 인증                    | 전체 스택                  |
| Batch       | `*BatchTest.kt`         | Spring Batch Job                       | 실제 DB                    |

각 레벨을 어떻게 판단하는지는 §3~§6, 외부 의존성을 다루는 원칙은 §7 이후에서 다룬다.

## 2. 외부 의존성이란 무엇인가

레벨을 나누는 첫 번째 축은 "외부 의존성이 있는가"다. Spring 컨텍스트나 I/O가 필요하면 외부 의존성이고, 그렇지 않으면 순수 도메인 로직이다.

| 외부 의존성                     | 외부 의존성 아님                       |
|----------------------------------|------------------------------------------|
| 데이터베이스(Repository)         | 도메인 객체(Entity, Value Object)         |
| 메시지 큐(Kafka, RabbitMQ)       | 순수 함수, 비즈니스 로직                  |
| 외부 API(HTTP 클라이언트)        | 인메모리 계산                             |
| 파일 시스템, 캐시(Redis)         | 도메인 이벤트(인메모리)                   |
| Spring 컨텍스트(`@Autowired`)    | Factory 메서드, 빌더                      |

**Service와 Facade**는 둘 다 오케스트레이션 계층이지만, 조율하는 도메인 개수가 다르다.

| 레이어             | 책임                          | 전형적인 테스트 레벨 |
|--------------------|-------------------------------|------------------------|
| Domain Entity      | 비즈니스 규칙, 불변식          | Unit                   |
| Service            | 단일 도메인 오케스트레이션      | Integration            |
| Facade             | 도메인 간 오케스트레이션        | Integration            |

> ⚠️ 주의: Domain Entity가 아니라 Service에 비즈니스 로직을 넣어두고 거기에 Unit Test를 쓰고 싶어진다면, 그건 로직이 잘못된 계층에 있다는 신호다. Service는 조율만 한다 — 로직 자체는 Domain으로 옮긴다.

## 3. 레벨 분류 기준

"무엇을 테스트하는가"로 레벨을 정한다.

| 테스트 대상                                             | 레벨        | 파일 네이밍                 |
|-----------------------------------------------------------|-------------|-------------------------------|
| 외부 의존성 없는 도메인 로직                              | Unit        | `*Test.kt`                    |
| DB/외부 의존성을 동반한 오케스트레이션                     | Integration | `*IntegrationTest.kt`         |
| 메시지 큐 Consumer 처리                                    | Integration | `*IntegrationTest.kt`         |
| 동시성 제어(락, 중복 방지)                                 | Concurrency | `*ConcurrencyTest.kt`         |
| 외부 API 클라이언트, 복잡한 DB 쿼리, 복원력(resilience)    | Adapter     | `*AdapterTest.kt`             |
| 전체 API 요청/응답                                         | E2E         | `*ApiE2ETest.kt`              |
| Spring Batch Step 파이프라인 검증                          | Integration | `*StepIntegrationTest.kt`     |
| Spring Batch Job의 분기 로직                               | Integration | `*JobIntegrationTest.kt`      |

## 4. 판단 흐름

레벨이 애매하면 아래 질문을 순서대로 따라간다.

```
이 테스트가 외부 의존성을 필요로 하는가?
├── 아니오 → Unit Test
└── 예 → 동시성/락을 테스트하는가?
          ├── 예 → Concurrency Test
          └── 아니오 → 외부 API 클라이언트나 복원력을 테스트하는가?
                   ├── 예 → Adapter Test
                   └── 아니오 → 전체 HTTP 요청/응답을 테스트하는가?
                            ├── 예 → E2E Test
                            └── 아니오 → Spring Batch 컴포넌트인가?
                                     ├── 예 → 아래 Batch 판단 흐름을 따른다
                                     └── 아니오 → Integration Test
```

### Batch 판단 흐름

```
Spring Batch 테스트인가?
├── Processor에 비즈니스 로직이 있는가?
│   └── Domain 모델로 옮긴다 → Processor가 아니라 Domain 모델을 Unit Test한다
├── Step 파이프라인을 검증하는가?
│   └── Step Integration Test(launchStep) — 기본 패턴
└── 조건부 흐름(Decider, on("FAILED"))이 있는 Job인가?
    └── Job Integration Test(launchJob)
```

## 5. 단순 CRUD의 레벨 판단

**질문**: Service가 Repository를 단순히 호출만 하는 경우(pass-through), Unit과 Integration 중 어느 쪽인가?

```
Service에 위임 이상의 비즈니스 로직이 있는가?
├── 있음 → Unit Test는 건너뛰고, 비즈니스 로직이 있는 부분만 Integration Test로 작성한다
└── 없음(순수 위임) → Unit Test는 건너뛰고, Integration Test만 작성한다
```

**왜 순수 위임에는 Unit Test를 건너뛰는가?**

```kotlin
// ❌ 이 Unit Test는 아무 가치도 더하지 않는다
@Test
fun `findById returns user`() {
    whenever(userRepository.findById(1L)).thenReturn(user)
    val result = userService.findById(1L)
    assertThat(result).isEqualTo(user)  // mock이 mock을 반환하는지 확인할 뿐
}

// ✅ Integration Test는 실제 배선(wiring)을 검증한다
@Test
fun `findById returns persisted user`() {
    val saved = userRepository.save(createUser())
    val result = userService.findById(saved.id)
    assertThat(result.name).isEqualTo(saved.name)  // 실제 DB 상호작용을 테스트
}
```

**규칙**: Integration Test를 피하려고 mock을 쓰지 않는다. 검증할 게 "Repository를 호출하는가?"뿐이라면 그건 배선 문제다 — 실제 DB로 테스트한다.

## 6. 판단이 애매할 때

1. **Unit Test로 시작한다** — Spring 컨텍스트 없이 테스트할 수 있다면 그렇게 한다.
2. **필요할 때만 격상한다** — 실제 DB가 필요할 때만 Integration으로 옮긴다.
3. **E2E는 계약(contract)을 위한 것이다** — E2E에서 비즈니스 로직을 검증하고 있다면 잘못된 것이다.
4. **동시성은 특별하다** — 항상 별도 테스트 파일로 분리한다.
5. **Batch 로직은 Domain에 속한다** — Processor를 테스트하지 말고, 로직을 Domain 모델로 옮긴다.
6. **Step Integration이 기본 패턴이다** — 파이프라인 배선을 검증한다. Job 테스트는 복잡한 분기가 있을 때만 쓴다.
7. **무의미한 mock은 건너뛴다** — mock이 "메서드가 메서드를 호출한다"만 증명한다면, Integration Test를 쓴다.

## 7. 외부 의존성 처리 원칙

이 프로젝트는 **Classical TDD**를 따른다. 가능한 한 **실제 의존성**을 쓰고, 우리가 통제할 수 없는 것(외부 HTTP API, 메시지 브로커)만 흉내낸다.

| 의존성 종류      | 전략                     |
|-------------------|---------------------------|
| 도메인 객체       | 항상 실제                 |
| 데이터베이스      | 실제(Testcontainers)      |
| Redis             | 실제(Testcontainers)      |
| 외부 HTTP API     | WireMock                  |
| 메시지 큐         | 실제(Testcontainers)      |

이 전략을 레벨별로 구체화하면 다음과 같다.

| 레벨        | 데이터베이스 | 외부 HTTP | 메시지 큐 | 비고                         |
|-------------|--------------|-----------|-----------|-------------------------------|
| Unit        | 해당 없음    | 해당 없음 | 해당 없음 | 순수 도메인 로직만            |
| Integration | 실제         | WireMock  | 실제      | 전체 오케스트레이션           |
| Concurrency | 실제         | WireMock  | 해당 없음 | 락 검증은 실제 DB가 필요      |
| Adapter     | 실제         | WireMock  | 해당 없음 | 인프라 코드를 테스트          |
| E2E         | 실제         | WireMock  | 해당 없음 | HTTP 계약만                   |

## 8. WireMock으로 외부 시스템 흉내내기

WireMock은 **우리가 통제할 수 없는 외부 시스템**(결제 게이트웨이, LLM API, 서드파티 서비스)을 흉내낸다.

```kotlin
// 외부 API 응답을 stub
stubFor(
    post(urlEqualTo("/v1/payments"))
        .willReturn(
            aResponse()
                .withStatus(200)
                .withBody("""{"paymentId": "pay_123", "status": "SUCCESS"}""")
        )
)

// 실패 시나리오를 stub
stubFor(
    post(urlEqualTo("/v1/payments"))
        .willReturn(serverError())
)
```

> ⚠️ 주의: 여기서 다루는 건 stub을 작성하는 일반 문법뿐이다. 레벨별 WireMock 헬퍼 코드(Adapter 레벨의 Circuit Breaker/Retry 조합 등)는 §12가 가리키는 각 레벨 문서에 있다.

## 9. Testcontainers로 실제 인스턴스 사용하기

Testcontainers는 데이터베이스, Redis, Kafka의 **실제 인스턴스**를 테스트에 제공한다.

```kotlin
// MySQL - testFixtures에 정의
@Configuration
class MySqlTestContainersConfig {
    companion object {
        private val mysqlContainer = MySQLContainer("mysql:8.0")
            .apply { start() }

        init {
            System.setProperty("spring.datasource.url", mysqlContainer.jdbcUrl)
            System.setProperty("spring.datasource.username", mysqlContainer.username)
            System.setProperty("spring.datasource.password", mysqlContainer.password)
        }
    }
}

// Kafka - bootstrap servers는 @Value로 주입
@Value("\${spring.kafka.bootstrap-servers}")
private lateinit var bootstrapServers: String
```

## 10. 무엇을 모킹하지 않는가

| 모킹하지 않는 것 | 이유                                     |
|--------------------|--------------------------------------------|
| Repository         | 실제 DB로 쿼리가 동작하는지 검증한다        |
| 도메인 객체        | 테스트 대상 그 자체다                       |
| 내부 서비스        | 실제 협력(collaboration)을 테스트한다       |
| Spring Event       | 오케스트레이션의 일부이지 외부가 아니다      |

## 11. 테스트 후 정리

외부 상태는 테스트마다 반드시 정리한다.

```kotlin
@AfterEach
fun cleanup() {
    databaseCleanUp.truncateAllTables()
    redisCleanUp.truncateAll()
    reset()  // WireMock reset
}
```

> ⚠️ 주의: 여기서 다루는 정리는 DB/Redis/WireMock 같은 **외부 상태**의 정리다. 테스트 클래스를 어떻게 작성해야 서로 독립적인 fixture를 갖는지(공유 mutable 상태 금지 등)의 저작 규율은 [test-authoring.md](./test-authoring.md)에서 다룬다 — 둘은 별개다.

## 12. 레벨별·주제별 문서로 이동하기

과제 성격에 따라 다음 문서를 연다.

- 레벨을 판단하거나 외부 의존성 전략을 정할 때 — 이 문서(§3~§11)에 있다.
- 스펙에서 테스트 케이스를 뽑아낼 때 — [test-case-extraction.md](./test-case-extraction.md)
- 경계값 분석(BVA)·동치 분할(ECP)·Decision Table로 테스트 데이터를 설계할 때 — [test-data-design.md](./test-data-design.md)
- BDD 구조·네이밍·Factory Method·테스트 격리를 정할 때 — [test-authoring.md](./test-authoring.md)
- 상태 검증과 상호작용 검증을 구분하는 Iron Law를 다시 볼 때 — [state-verification.md](./state-verification.md)
- 레벨별 실제 코드 패턴을 참고할 때:
  - Unit — [unit-test.md](./unit-test.md) (상태 변화, 유효성 검증, ParameterizedTest, 도메인 이벤트)
  - Integration — [integration-test.md](./integration-test.md) (롤백, Spring Event, Kafka Consumer)
  - Concurrency — [concurrency-test.md](./concurrency-test.md) (스레드 풀, 락, 멱등성)
  - Adapter — [adapter-test.md](./adapter-test.md) (WireMock, Circuit Breaker, Retry, 복잡한 쿼리)
  - E2E — [e2e-test.md](./e2e-test.md) (HTTP 상태 코드, 인증 실패, API 계약)
  - Batch — [batch-test.md](./batch-test.md) (Processor 단위 테스트, Step/Job 통합 테스트)

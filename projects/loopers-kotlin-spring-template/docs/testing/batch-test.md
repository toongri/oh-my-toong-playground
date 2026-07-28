# Batch 테스트 — 파이프라인 배선 검증

Batch 테스트는 Spring Batch 파이프라인 구성 요소(Reader/Processor/Writer)가 서로 올바르게 연결되어 동작하는지 검증한다. 비즈니스 로직 자체는 이미 Unit Test가 검증한 Domain model에 맡긴다.

## 목차

1. **언제 Batch Test인가** — Processor가 아니라 Domain model을 테스트하는 이유
2. **파일명과 네이밍** — `*StepIntegrationTest.kt`/`*JobIntegrationTest.kt`와 메서드 네이밍
3. **Anti-Patterns** — Processor 로직 테스트와 프레임워크 컴포넌트 테스트를 피한다
4. **CRITICAL: 테스트 격리** — 배치 메타데이터까지 정리한다
5. **패턴별 예시** — Step Integration Test(기본 패턴)와 Job Integration Test
6. **품질 체크리스트** — 작성 후 확인할 5개 항목

---

## 1. 언제 Batch Test인가

### 핵심 철학

Spring Batch 컴포넌트(Reader/Processor/Writer)는 **인프라 계층**이지 도메인 계층이 아니다.

- **비즈니스 로직은 Domain model에 있어야 한다** — Processor 안이 아니다
- Domain model은 이미 Unit Test로 검증되어 있다
- Batch 테스트는 **"파이프라인이 엔드투엔드로 동작하는가"**를 검증하지, 비즈니스 로직을 검증하지 않는다

```
┌─────────────────────────────────────────────────────────┐
│  Spring Batch (Infrastructure)                          │
│  Reader → Processor → Writer                            │
│           (calls domain model)                        │
└─────────────────┬───────────────────────────────────────┘
                  │
                  ▼
          ┌───────────────┐
          │ Domain Layer  │  ← Already tested via Unit Test
          └───────────────┘
```

Processor에 비즈니스 로직이 남아있으면, 그 로직을 검증하려는 시도가 Batch 테스트를 무겁고 느리게 만든다. 계산 로직은 Domain model로 옮기고 `./unit-test.md`가 다루는 방식으로 검증한다 — Batch 테스트는 그 Domain model이 파이프라인 안에서 제대로 호출되는지만 본다.

### 무엇을 테스트하는가

| 컴포넌트 | 테스트? | 이유 |
|--------------------------------------|-------|---------------------------------------------|
| Reader (`JdbcCursorItemReader` 등) | ❌ | 프레임워크 컴포넌트, 쿼리는 다른 곳에서 검증 |
| 비즈니스 로직이 들어간 Processor | ❌ | 안티패턴. 로직을 Domain Model로 옮긴다 |
| Domain Model을 호출하는 Processor | ❌ | Domain Model은 이미 Unit Test로 검증됨 |
| Writer (`JdbcBatchItemWriter` 등) | ❌ | 프레임워크 컴포넌트 |
| **Step 엔드투엔드** | ✅ | 파이프라인 배선이 동작하는지 검증 |
| **조건부 흐름이 있는 Job** | ✅ | Decider나 복잡한 분기가 있을 때만 |

> ⚠️ 주의: 이 표의 ❌ 행 두 개(비즈니스 로직이 들어간 Processor, Domain Model을 호출하는 Processor)를 헷갈리지 않는다 — 전자는 애초에 있으면 안 되는 상태(안티패턴 — 3절 참고)이고, 후자는 올바른 상태이지만 이미 Unit Test가 커버해서 Batch 테스트에서 또 검증할 필요가 없는 상태다.

### Batch 컴포넌트의 Unit Test는 언제 쓰나

Processor·Listener가 Domain Model로 뽑아낼 수 없는 로직을 담고 있는 드문 경우에만 작성한다.

```kotlin
// Rare case: Listener with batch-specific logic
class NoWorkFoundListenerTest {

    private val listener = NoWorkFoundStepExecutionListener()

    @Test
    @DisplayName("Returns FAILED when read count is zero")
    fun `returns FAILED when read count is zero`() {
        // given
        val stepExecution = MetaDataInstanceFactory.createStepExecution()
        stepExecution.readCount = 0

        // when
        val result = listener.afterStep(stepExecution)

        // then
        assertThat(result.exitCode).isEqualTo(ExitStatus.FAILED.exitCode)
    }
}
```

`NoWorkFoundStepExecutionListener`의 "읽은 건수가 0이면 FAILED로 만든다"는 판단은 Spring Batch 콜백에 묶인 로직이라 Domain model로 옮길 수 없다 — 이런 경우에 한해 Batch 컴포넌트를 직접 Unit Test한다.

## 2. 파일명과 네이밍

이 절은 Batch Test 레벨을 골랐다는 전제 아래 파일명·클래스명·메서드명을 어떻게 쓰는지를 다룬다. 이 절의 네이밍 관례는 아래 5번 절(패턴별 예시)의 Step Integration Test·Job Integration Test 두 패턴에서 쓰는 파일명·`@DisplayName`·메서드명 관례와 같다.

> ⚠️ 주의: 이 절은 "이 레벨을 골랐다는 전제 아래" 이름을 어떻게 쓰는지만 다룬다. Step 테스트를 쓸지 Job 테스트를 쓸지 자체를 고르는 분류 기준은 `./test-levels.md`의 레벨 분류표를 따른다.

### 파일명

| 파일명 패턴 | 대상 |
|---|---|
| `*StepIntegrationTest.kt` | Step 하나의 파이프라인 엔드투엔드 테스트 |
| `*JobIntegrationTest.kt` | Decider·조건부 흐름이 있는 Job 레벨 테스트 |

예: `SettlementStepIntegrationTest.kt`

### 클래스 `@DisplayName`

```kotlin
@DisplayName("SettlementStep Integration Test")
class SettlementStepIntegrationTest {
    // ...
}
```

`"{StepName} Integration Test"` 형태로, Step의 이름을 그대로 드러낸다.

### 메서드 네이밍

Step 레벨은 "무엇이 완료됐고 무엇이 어떤 상태가 됐는가"를 설명한다.

```kotlin
@DisplayName("Step completes and all PAID orders become SETTLED")
fun `all PAID orders become SETTLED after step completion`()

@DisplayName("Step completes even when no orders to process")
fun `step completes when no orders to process`()
```

Job 레벨은 조건부 흐름의 결과(성공/실패 분기)를 설명한다.

```kotlin
@DisplayName("Job fails when input file is missing")
fun `job fails when input file is missing`()
```

두 레벨 모두 `@DisplayName`은 "무엇이 어떤 상태가 되는가"를 한국어 대신 영어로 서술하고, 메서드명은 백틱을 두른 영어로 같은 내용을 반복한다 — 일반 BDD 네이밍 규칙(한국어 `@DisplayName` + `[result] when [condition]` 영어 메서드명)은 `./test-authoring.md`가 다루지만, Batch 레벨의 `@DisplayName`은 Step/Job의 상태 변화를 영어로 그대로 서술하는 관례를 따른다. 각 예시의 전체 테스트 코드(given/when/then, 팩토리 함수, 클래스 셋업)는 5번 절에서 확인한다.

## 3. Anti-Patterns

Batch 컴포넌트를 직접 테스트하고 싶은 유혹은 두 가지 형태로 나타난다 — Processor 안의 비즈니스 로직을 테스트하거나, 프레임워크 컴포넌트 자체를 테스트하는 것이다. 둘 다 1번 절의 핵심 철학과 반대 방향이다.

### ❌ Processor 비즈니스 로직 테스트

```kotlin
// Bad: Business logic in Processor
class SettlementProcessorTest {
    @Test
    fun `calculates fee correctly`() {
        val processor = SettlementProcessor()
        val result = processor.process(order)
        assertThat(result.fee).isEqualTo(300)  // This should be in Domain Model test!
    }
}
```

### ❌ 프레임워크 컴포넌트 테스트

```kotlin
// Bad: Testing Spring Batch's FlatFileItemReader
@Test
fun `reader parses CSV correctly`() {
    // This is testing the framework, not your code
}
```

> ⚠️ 주의: 이 두 안티패턴의 반대는 새로운 패턴이 아니라 1번 절에서 이미 설명한 원칙 그대로다 — 수수료 계산은 Domain model로 옮겨 Unit Test하고, Reader/Writer는 애초에 테스트 대상이 아니다.

## 4. CRITICAL: 테스트 격리

Batch 테스트는 일반 DB 정리만으로 격리되지 않는다. Spring Batch는 실행 이력을 배치 메타데이터 테이블에 별도로 남기므로, 이것도 함께 정리해야 한다.

```kotlin
@AfterEach
fun tearDown() {
    jobRepositoryTestUtils.removeJobExecutions()  // Clean batch metadata
    databaseCleanUp.truncateAllTables()           // Clean business tables
}
```

> ⚠️ 주의: `databaseCleanUp.truncateAllTables()`만 호출하고 `jobRepositoryTestUtils.removeJobExecutions()`를 빠뜨리면, 배치 메타데이터(이전 실행의 `JobExecution`/`StepExecution` 이력)가 남는다. 다음 테스트가 같은 Job 파라미터로 실행되면 Spring Batch가 "이미 완료된 실행"으로 인식해 재실행을 거부하거나 예상과 다른 상태로 시작할 수 있다 — 둘 다 정리해야 격리가 보장된다.

## 5. 패턴별 예시

### Step Integration Test (기본 패턴)

이것이 Batch Job의 **기본 테스트 패턴**이다. 파이프라인이 올바른 최종 상태를 만드는지 검증한다.

```kotlin
@SpringBatchTest
@SpringBootTest
@DisplayName("SettlementStep Integration Test")
class SettlementStepIntegrationTest {

    @Autowired
    private lateinit var jobLauncherTestUtils: JobLauncherTestUtils

    @Autowired
    private lateinit var jobRepositoryTestUtils: JobRepositoryTestUtils

    @Autowired
    private lateinit var orderRepository: OrderRepository

    @Autowired
    private lateinit var databaseCleanUp: DatabaseCleanUp

    @Autowired
    private lateinit var job: Job

    @BeforeEach
    fun setUp() {
        jobLauncherTestUtils.job = job
    }

    @AfterEach
    fun tearDown() {
        jobRepositoryTestUtils.removeJobExecutions()
        databaseCleanUp.truncateAllTables()
    }

    @Test
    @DisplayName("Step completes and all PAID orders become SETTLED")
    fun `all PAID orders become SETTLED after step completion`() {
        // given
        repeat(5) { createOrder(status = OrderStatus.PAID) }
        repeat(3) { createOrder(status = OrderStatus.CANCELLED) }

        // when
        val jobExecution = jobLauncherTestUtils.launchStep("settlementStep")

        // then
        assertThat(jobExecution.exitStatus.exitCode).isEqualTo("COMPLETED")
        assertThat(orderRepository.findByStatus(OrderStatus.SETTLED)).hasSize(5)
    }

    @Test
    @DisplayName("Step completes even when no orders to process")
    fun `step completes when no orders to process`() {
        // given - no PAID orders

        // when
        val jobExecution = jobLauncherTestUtils.launchStep("settlementStep")

        // then
        assertThat(jobExecution.exitStatus.exitCode).isEqualTo("COMPLETED")
        assertThat(jobExecution.stepExecutions.first().readCount).isEqualTo(0)
    }

    private fun createOrder(status: OrderStatus = OrderStatus.PAID): Order {
        return orderRepository.save(Order.create(status = status))
    }
}
```

`launchStep("settlementStep")`으로 Step 하나만 실행해, Job 전체를 띄우지 않고도 이 Step의 배선이 맞는지 확인한다. 두 번째 테스트("no orders to process")는 처리할 데이터가 없을 때도 Step이 실패하지 않고 `COMPLETED`로 끝나는지 확인한다 — 파이프라인의 빈 입력 처리도 배선 검증의 일부다.

### Job Integration Test (복잡한 분기가 있을 때만)

**조건부 흐름 로직**(Decider, `on("FAILED")`)이 있을 때만 Job 레벨 테스트를 작성한다.

```kotlin
@Test
@DisplayName("Job fails when input file is missing")
fun `job fails when input file is missing`() {
    // given
    val jobParameters = JobParametersBuilder()
        .addString("inputFile", "/non/existent/path.csv")
        .addLong("timestamp", System.currentTimeMillis())
        .toJobParameters()

    // when
    val jobExecution = jobLauncherTestUtils.launchJob(jobParameters)

    // then
    assertThat(jobExecution.exitStatus.exitCode).isEqualTo("FAILED")
}
```

`launchStep` 대신 `launchJob`을 쓰는 이유는 이 테스트가 검증하려는 게 개별 Step의 배선이 아니라 **Step 사이의 분기 흐름**(입력 파일이 없으면 Job 전체가 `FAILED`로 끝나는가)이기 때문이다. Step 하나만 실행해서는 이 분기를 재현할 수 없다.

## 6. 품질 체크리스트

- [ ] Reader/Processor/Writer 개별 컴포넌트를 따로 테스트하지 않았는가 (Domain Model로 뽑아낼 수 없는 로직을 담은 드문 경우는 예외 — 1절 참고)
- [ ] 비즈니스 로직이 Processor가 아니라 Domain Model에 있고, 거기서 Unit Test로 검증됐는가
- [ ] Step Integration Test를 기본 패턴으로 삼아 파이프라인 배선을 검증했는가
- [ ] Job Integration Test는 Decider·조건부 흐름 같은 복잡한 분기가 있을 때만 작성했는가
- [ ] 배치 메타데이터와 비즈니스 테이블을 모두 정리했는가 (`jobRepositoryTestUtils.removeJobExecutions()` + `databaseCleanUp.truncateAllTables()`)

# Batch Test

Batch tests verify that **Spring Batch pipeline components are correctly wired together**.

## Core Philosophy

Spring Batch components (Reader/Processor/Writer) are **infrastructure layer**, not domain layer.

- **Business logic belongs in Domain model**, not in Processor
- Domain models are already tested via Unit Tests
- Batch tests verify **"does the pipeline work end-to-end?"**, not business logic

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

## What to Test

| Component                            | Test? | Reason                                      |
|--------------------------------------|-------|---------------------------------------------|
| Reader (JdbcCursorItemReader, etc.)  | ❌     | Framework component, query tested elsewhere |
| Processor with business logic inside | ❌     | Anti-pattern. Move logic to Domain Model    |
| Processor calling Domain Model       | ❌     | Domain Model already unit tested            |
| Writer (JdbcBatchItemWriter, etc.)   | ❌     | Framework component                         |
| **Step end-to-end**                  | ✅     | Verify pipeline wiring works                |
| **Job with conditional flow**        | ✅     | Only if Decider or complex branching exists |

## Step Integration Test (Primary Pattern)

This is the **main test pattern** for batch jobs. Verify the pipeline produces correct final state.

```java
@SpringBatchTest
@SpringBootTest
@DisplayName("SettlementStep Integration Test")
class SettlementStepIntegrationTest {

    @Autowired
    private JobLauncherTestUtils jobLauncherTestUtils;

    @Autowired
    private OrderRepository orderRepository;

    @Autowired
    private DatabaseCleanUp databaseCleanUp;

    @Autowired
    private Job job;

    @BeforeEach
    public void setUp() {
        jobLauncherTestUtils.setJob(job);
    }

    @AfterEach
    public void tearDown() {
        databaseCleanUp.truncateAllTables();
    }

    @Test
    @DisplayName("Step completes and all PAID orders become SETTLED")
    public void allPaidOrdersBecomeSettledAfterStepCompletion() {
        // given
        for (int i = 0; i < 5; i++) { createOrder(OrderStatus.PAID); }
        for (int i = 0; i < 3; i++) { createOrder(OrderStatus.CANCELLED); }

        // when
        var jobExecution = jobLauncherTestUtils.launchStep("settlementStep");

        // then
        assertThat(jobExecution.getExitStatus().getExitCode()).isEqualTo("COMPLETED");
        assertThat(orderRepository.findByStatus(OrderStatus.SETTLED)).hasSize(5);
    }

    @Test
    @DisplayName("Step completes even when no orders to process")
    public void stepCompletesWhenNoOrdersToProcess() {
        // given - no PAID orders

        // when
        var jobExecution = jobLauncherTestUtils.launchStep("settlementStep");

        // then
        assertThat(jobExecution.getExitStatus().getExitCode()).isEqualTo("COMPLETED");
        assertThat(jobExecution.getStepExecutions().iterator().next().getReadCount()).isEqualTo(0);
    }

    private Order createOrder(OrderStatus status) {
        return orderRepository.save(Order.create(status));
    }
}
```

## Job Integration Test (Only for Complex Branching)

Only write Job-level tests when there's **conditional flow logic** (Decider, `on("FAILED")`).

```java
@Test
@DisplayName("Job fails when input file is missing")
public void jobFailsWhenInputFileIsMissing() {
    // given
    var jobParameters = new JobParametersBuilder()
        .addString("inputFile", "/non/existent/path.csv")
        .addLong("timestamp", System.currentTimeMillis())
        .toJobParameters();

    // when
    var jobExecution = jobLauncherTestUtils.launchJob(jobParameters);

    // then
    assertThat(jobExecution.getExitStatus().getExitCode()).isEqualTo("FAILED");
}
```

## When to Write Unit Tests for Batch Components

Only in rare cases where Processor/Listener contains **logic that cannot be extracted to Domain Model**:

```java
// Rare case: Listener with batch-specific logic
class NoWorkFoundListenerTest {

    private final NoWorkFoundStepExecutionListener listener = new NoWorkFoundStepExecutionListener();

    @Test
    @DisplayName("Returns FAILED when read count is zero")
    public void returnsFAILEDWhenReadCountIsZero() {
        // given
        var stepExecution = MetaDataInstanceFactory.createStepExecution();
        stepExecution.setReadCount(0);

        // when
        var result = listener.afterStep(stepExecution);

        // then
        assertThat(result.getExitCode()).isEqualTo(ExitStatus.FAILED.getExitCode());
    }
}
```

## Anti-Patterns

### ❌ Testing Processor Business Logic

```java
// Bad: Business logic in Processor
class SettlementProcessorTest {
    @Test
    public void calculatesFeeCorrectly() {
        var processor = new SettlementProcessor();
        var result = processor.process(order);
        assertThat(result.getFee()).isEqualTo(300);  // This should be in Domain Model test!
    }
}
```

### ❌ Testing Framework Components

```java
// Bad: Testing Spring Batch's FlatFileItemReader
@Test
public void readerParsesCsvCorrectly() {
    // This is testing the framework, not your code
}
```

## CRITICAL: Test Isolation

Always clean up batch metadata after tests:

```java
@AfterEach
public void tearDown() {
    jobRepositoryTestUtils.removeJobExecutions();  // Clean batch metadata
    databaseCleanUp.truncateAllTables();           // Clean business tables
}
```

## Summary

1. **Don't test Reader/Processor/Writer individually** - they're infrastructure
2. **Business logic belongs in Domain Models** - test those with Unit Tests
3. **Step Integration Test is the primary pattern** - verify pipeline wiring
4. **Job Integration Test only for branching** - Decider, conditional flows
5. **Clean up batch metadata** - `jobRepositoryTestUtils.removeJobExecutions()`

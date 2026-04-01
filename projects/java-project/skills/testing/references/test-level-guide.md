# Test Level Guide

This document defines test level classification criteria and decision flow for determining which level each test case
belongs to.

## Key Definitions

### What counts as "External Dependency"?

| External Dependency             | NOT External Dependency               |
|---------------------------------|---------------------------------------|
| Database (Repository)           | Domain objects (Entity, Value Object) |
| Message Queue (Kafka, RabbitMQ) | Pure functions, business logic        |
| External APIs (HTTP clients)    | In-memory calculations                |
| File system, Cache (Redis)      | Domain Events (in-memory)             |
| Spring Context (@Autowired)     | Factory methods, builders             |

**Rule**: If it requires Spring context or I/O, it's external.

### Service vs Facade

| Layer             | Responsibility              | Typical Test Level |
|-------------------|-----------------------------|--------------------|
| **Domain Entity** | Business rules, invariants  | Unit Test          |
| **Service**       | Single-domain orchestration | Integration Test   |
| **Facade**        | Cross-domain orchestration  | Integration Test   |

## Test Level Classification

| What to Test?                                        | Level       | File Naming               |
|------------------------------------------------------|-------------|---------------------------|
| Domain logic without external dependencies           | Unit        | `*Test.java`              |
| Orchestration with DB/external dependencies          | Integration | `*IntegrationTest.java`   |
| Message Queue Consumer processing                    | Integration | `*IntegrationTest.java`   |
| Concurrency control (locks, duplicate prevention)    | Concurrency | `*ConcurrencyTest.java`   |
| External API clients, complex DB queries, resilience | Adapter     | `*AdapterTest.java`       |
| Full API request/response                            | E2E         | `*ApiE2ETest.java`        |
| Spring Batch Step pipeline verification              | Integration | `*StepIntegrationTest.java` |
| Spring Batch Job with branching logic                | Integration | `*JobIntegrationTest.java` |

## Decision Flow

```
Does this test require external dependencies?
├── No → Unit Test
└── Yes → Does it test concurrency/locking?
          ├── Yes → Concurrency Test
          └── No → Does it test external API client or resilience?
                   ├── Yes → Adapter Test
                   └── No → Is it testing full HTTP request/response?
                            ├── Yes → E2E Test
                            └── No → Is it Spring Batch component?
                                     ├── Yes → See Batch Decision Flow below
                                     └── No → Integration Test
```

### Batch Decision Flow

```
Spring Batch testing?
├── Business logic in Processor?
│   └── Move to Domain model → Unit Test the domain model, not Processor
├── Step pipeline verification?
│   └── Step Integration Test (launchStep) - PRIMARY PATTERN
└── Job with conditional flow (Decider, on("FAILED"))?
    └── Job Integration Test (launchJob)
```

## Simple CRUD Rule

**Question**: Service가 Repository를 단순히 호출만 하는 경우 (pass-through), Unit vs Integration?

```
Does Service have business logic beyond delegation?
├── Yes → Skip Unit Test, but write Integration Test with business logic
└── No (pure delegation) → Skip Unit Test, write Integration Test only
```

**Why skip Unit Test for pure delegation?**

```java
// ❌ This Unit Test adds no value
@Test
void findByIdReturnsUser() {
    when(userRepository.findById(1L)).thenReturn(user);
    var result = userService.findById(1L);
    assertThat(result).isEqualTo(user);  // Just testing mock returns mock
}

// ✅ Integration Test verifies actual wiring
@Test
void findByIdReturnsPersistedUser() {
    var saved = userRepository.save(createUser());
    var result = userService.findById(saved.getId());
    assertThat(result.getName()).isEqualTo(saved.getName());  // Tests real DB interaction
}
```

**Rule**: Don't mock just to avoid Integration Test. If the only thing to test is "does it call Repository?", that's
wiring - test it with real DB.

## When in Doubt

1. **Start with Unit Test** - If you can test it without Spring context, do so
2. **Elevate only when necessary** - Move to Integration only when real DB is required
3. **E2E is for contracts** - If you're testing business logic in E2E, you're doing it wrong
4. **Concurrency is special** - Always separate into dedicated test file
5. **Batch logic belongs in Domain** - Don't test Processor; move logic to Domain model
6. **Step Integration is primary** - Verify pipeline wiring; Job tests only for complex branching
7. **Skip pointless mocks** - If mocking just proves "method calls method", write Integration instead

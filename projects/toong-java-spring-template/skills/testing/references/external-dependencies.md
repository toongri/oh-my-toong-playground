# External Dependencies by Test Level

## Core Principle

This project follows **Classical TDD**. We use **real dependencies** whenever possible, and only simulate what we cannot control (external HTTP APIs, message brokers).

| Dependency Type | Strategy |
|-----------------|----------|
| Domain objects | Always real |
| Database | Real (Testcontainers) |
| Redis | Real (Testcontainers) |
| External HTTP APIs | WireMock |
| Message Queue | Real (Testcontainers) |

## Dependencies by Level

| Level | Database | External HTTP | Message Queue | Notes |
|-------|----------|---------------|---------------|-------|
| Unit | N/A | N/A | N/A | Pure domain logic only |
| Integration | Real | WireMock | Real | Full orchestration |
| Concurrency | Real | WireMock | N/A | Locking requires real DB |
| Adapter | Real | WireMock | N/A | Tests infrastructure code |
| E2E | Real | WireMock | N/A | HTTP contract only |

## WireMock Usage

WireMock simulates **external systems we don't control** (payment gateways, LLM APIs, third-party services).

```java
// Stub external API response
stubFor(
    post(urlEqualTo("/v1/payments"))
        .willReturn(
            aResponse()
                .withStatus(200)
                .withBody("{\"paymentId\": \"pay_123\", \"status\": \"SUCCESS\"}")
        )
);

// Stub failure scenario
stubFor(
    post(urlEqualTo("/v1/payments"))
        .willReturn(serverError())
);
```

## Testcontainers Usage

Testcontainers provides **real instances** of databases, Redis, Kafka for testing.

```java
// MySQL - defined in testFixtures
@Configuration
public class MySqlTestContainersConfig {

    private static final MySQLContainer<?> mysqlContainer =
        new MySQLContainer<>("mysql:8.0");

    static {
        mysqlContainer.start();
        System.setProperty("spring.datasource.url", mysqlContainer.getJdbcUrl());
        System.setProperty("spring.datasource.username", mysqlContainer.getUsername());
        System.setProperty("spring.datasource.password", mysqlContainer.getPassword());
    }
}

// Kafka - bootstrap servers injected via @Value
@Value("${spring.kafka.bootstrap-servers}")
private String bootstrapServers;
```

## What NOT to Mock

| Don't Mock | Reason |
|------------|--------|
| Repositories | Use real DB to verify queries work |
| Domain objects | They are the system under test |
| Internal services | Test real collaboration |
| Spring Events | Part of orchestration, not external |

## Cleanup

Always clean up external state after each test.

```java
@AfterEach
void cleanup() {
    databaseCleanUp.truncateAllTables();
    redisCleanUp.truncateAll();
    reset();  // WireMock reset
}
```

# 후보 비교

## 결론

1순위는 **Kysely Migrator**다. TypeScript 네이티브이고 PostgreSQL advisory lock과 기본 트랜잭션 실행을 제공하므로, 현재의 `migration → backend deploy → verification` 배포 순서에 가장 작게 결합할 수 있다. 다만 어떤 후보도 Git처럼 서로 충돌하는 DDL을 의미적으로 자동 병합하지는 못한다. 이 문제는 도구 교체만으로 사라지지 않으며, 하나의 선형 migration 이력과 DB 락을 전제로 한 merge 정책이 필요하다. [검증 근거: wave-1.md:6, wave-1.md:13, wave-1.md:22-25]

> “Kysely Migrator: TypeScript-native; PostgreSQL adapter uses advisory lock and runs transactionally by default. `allowUnorderedMigrations` avoids default prefix-order rejection but cannot resolve conflicting DDL.” — [wave-1.md:13](wave-1.md#L13)

## 비교표

| 후보 | TS 적합성 | 동시 배포/실행 제어 | 브랜치 이력 병합 | 현재 문제에 대한 판단 |
|---|---|---|---|---|
| **Kysely Migrator** | TypeScript 네이티브 | PostgreSQL advisory lock, 기본 트랜잭션 | 순서 검사를 완화할 수는 있으나 DDL 충돌은 해결하지 못함 | **권장.** DB 락과 배포용 migration job을 결합하기 가장 적합. [wave-1.md:13](wave-1.md#L13) |
| **Prisma Migrate** | TypeScript 네이티브 | `migrate deploy`가 CI/CD용이며 PostgreSQL advisory lock 사용 | 파일의 사전식 순서 기반; 충돌은 rebase/squash를 사람이 처리 | Prisma ORM 도입 계획이 있을 때만 검토. migration만을 위한 전환 이점은 Kysely보다 제한적. [wave-1.md:11](wave-1.md#L11) |
| **Drizzle Kit** | TypeScript 네이티브, 현재 Drizzle 의존성 존재 | 트랜잭션은 있으나 조사된 PostgreSQL migrator에는 advisory lock 없음 | 병렬 생성 시 journal/index 충돌 위험; 부모 기준 재생성 필요 | **비권장.** Alembic의 경쟁 문제를 줄이려는 목적과 맞지 않음. [wave-1.md:5, wave-1.md:12](wave-1.md#L5) |
| **Knex** | TS 친화적 | 내장 DB lock | 선형 filename ledger; DAG 병합 없음 | 단순한 대안이지만 Kysely보다 기존 TS 데이터 계층과의 결합 이점이 확인되지 않음. [wave-1.md:14](wave-1.md#L14) |
| **Atlas** | Drizzle 외부 schema와 호환 | PostgreSQL advisory lock | `atlas.sum`이 분기된 directory 변경을 의도적으로 merge conflict로 만듦; 선형화를 위해 rebase/rehash 필요 | 충돌을 빨리 드러내는 데는 좋지만, OSS에서는 `migrate rebase`가 없고 Pro가 필요. [wave-1.md:18, wave-1.md:25](wave-1.md#L18) |
| **Flyway Community** | TS 라이브러리는 아님; Docker/CI에 적합 | DB lock | 불변의 선형 SQL 이력; `outOfOrder`도 의미적 병합은 아님 | SQL-first 운영 도구로는 유효. TS 라이브러리 요구에는 차선. forward-only는 무료로 가능. [wave-1.md:16](wave-1.md#L16) |
| **Liquibase** | TS 라이브러리는 아님 | `DATABASECHANGELOGLOCK` | changelog 순서 기반; Git DAG 병합 없음 | 기능은 넓지만 이 문제의 병합 경합을 해소하지 않음. [wave-1.md:17, wave-1.md:24](wave-1.md#L17) |
| **Sqitch** | Perl/SQL CLI; Drizzle 통합 없음 | PostgreSQL target/advisory lock | dependency-aware이지만 중앙 append-only plan; 동시 branch 추가는 `sqitch.plan` Git 충돌과 사람의 순서 확인 필요 | 의존성 표현이 꼭 필요할 때만 검토. 현 문제의 중앙 병합 정책을 제거하지 못함. [wave-2.md:3-7](wave-2.md#L3) |
| **TypeORM / Umzug / dbmate** | TS 친화적 후보 포함 | 조사 범위에서 PostgreSQL 분산 migration lock 기본 제공 없음 | dbmate는 timestamp 선형 이력 | 전용 migration job과 외부 락을 별도 설계해야 하므로 우선순위 낮음. [wave-1.md:15](wave-1.md#L15) |

## 권장 운영 방식

- Kysely Migrator를 별도 migration 실행 단위로 두고, PostgreSQL advisory lock을 획득한 단일 실행자만 `up`을 수행한다. 현재 배포 순서와도 맞는다. [wave-1.md:6, wave-1.md:13](wave-1.md#L6)
- migration 파일은 여러 head를 DB에서 공존시키지 않는 **선형 이력**으로 유지한다. 동일 기준점에서 두 브랜치가 migration을 추가했다면, merge 전에 한쪽을 rebase하고 순서·DDL 충돌을 사람이 해결한다. 자동 병합으로 해결할 수 있다는 후보는 조사 결과 없었다. [wave-1.md:11, wave-1.md:13-18, wave-2.md:3](wave-1.md#L11)
- 롤백 대신 forward-only 보정 migration을 원칙으로 한다. Flyway Community도 forward-only 사용에는 유료 기능이 필요 없지만, TS 네이티브 요구에는 Kysely가 더 맞는다. [wave-1.md:16](wave-1.md#L16)

현재 Alembic 이력에는 이미 296 revision, 56 merge revision, 2 head가 있고, 최근 split head를 합치는 no-op merge도 확인되었다. 따라서 전환 시에는 기존 이력을 재작성하기보다, 기준 시점 이후의 신규 migration부터 위 정책을 적용하는 편이 안전하다. [wave-1.md:7](wave-1.md#L7)

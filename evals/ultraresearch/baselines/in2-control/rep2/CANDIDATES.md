# 후보 비교

## 결론

Alembic의 multi-head를 **Git처럼 자동으로 의미 병합**해 주는 후보는 확인하지 못했다. 데이터베이스 변경은 적용 순서와 DDL 의미가 충돌할 수 있으므로, 어떤 도구를 선택해도 충돌 자체의 판정과 해결은 사람이 맡아야 한다.

이번 조건에서는 **Kysely Migrator를 1순위**, Prisma Migrate를 2순위로 권고한다. 두 후보 모두 PostgreSQL advisory lock을 사용할 수 있고 배포용 명령을 별도 migration Job으로 실행하기 쉽다. 다만 해결책의 핵심은 라이브러리 교체만이 아니라, migration 이력을 단일 선형 순서로 유지하는 규칙과 CI 검증이다.

## 비교 기준

- **TS 적합성**: TypeScript 코드베이스에서 도입·운영하기 쉬운가
- **동시 배포 안전성**: PostgreSQL에서 DB 수준 잠금으로 migration 실행을 직렬화하는가
- **브랜치 이력 처리**: 동시에 추가된 migration의 충돌을 어떻게 드러내고 해소하는가
- **현재 환경 적합성**: Drizzle schema를 계속 사용하면서 점진적으로 전환할 수 있는가

## 후보별 비교

| 후보 | TS 적합성 | 동시 배포 안전성 | 브랜치 이력 처리 | 현재 환경에서의 판단 |
| --- | --- | --- | --- | --- |
| **Kysely Migrator** | TS-native 라이브러리 | PostgreSQL adapter가 advisory lock을 사용하고 기본적으로 트랜잭션 실행 | 기본적으로 접두사 순서를 강제한다. `allowUnorderedMigrations`는 순서 검사를 완화할 뿐, 충돌 DDL을 병합하지는 않는다 | **1순위.** 작은 런타임 API와 명시적 migration 코드가 필요하고, 자체 migration Job을 만들 수 있을 때 적합 |
| **Prisma Migrate** | TS-native CLI·ORM | `migrate deploy`가 PostgreSQL advisory lock 사용 | 파일명 기준 선형 이력이다. 분기 충돌은 rebase/squash 등으로 사람이 정리 | **2순위.** Prisma schema/ORM 도입도 허용되거나 CLI 중심 운영을 선호할 때 적합. Drizzle을 유지할 경우 중복 schema authority가 생길 수 있음 |
| **Drizzle Kit** | 이미 사용 중인 TS 도구 | 확인한 PostgreSQL migrator에는 트랜잭션은 있으나 advisory lock이 없다 | journal/index가 병렬 생성에서 충돌할 수 있어 parent baseline 기준 재생성이 필요 | schema 동기화 도구로는 유지 가능하지만, **단독 migration authority로는 비권고**. 도입 비용은 낮아도 현재 문제의 배포 경합을 해소하지 못함 |
| **Knex** | TS 친화적 | DB lock 제공 | 파일명 기반 선형 ledger이며 DAG 병합 없음 | 기존 Knex 사용 코드가 없으면 Kysely보다 선택 이유가 약함 |
| **Atlas** | TS 라이브러리는 아니지만 Drizzle external schema와 연계 가능 | PostgreSQL advisory lock 사용 | `atlas.sum`이 분기된 migration 디렉터리 변경을 의도적으로 merge conflict로 만든다. 이력은 rebase/rehash로 선형화해야 하며 OSS에서는 `migrate rebase`를 사용할 수 없음 | 이력 무결성 검증은 강점이나, **Community만 쓸 경우** 충돌 해소 흐름이 불편. 유료 도입 의사가 있을 때 재검토 |
| **Flyway Community** | 언어 독립 SQL CLI | DB lock 및 컨테이너/CI 실행에 적합 | immutable versioned migration의 선형 이력. `outOfOrder`도 의미적 병합은 아님 | SQL-first 표준화가 목적이면 적합하지만 TS-native 요구와는 거리가 있음 |
| **Liquibase** | 언어 독립 | `DATABASECHANGELOGLOCK` 사용 | changelog 순서 기반; Git DAG 병합 기능 없음 | 복잡한 변경 표현은 가능하지만, 현 문제에는 운영 복잡도 대비 이점이 작음 |
| **Sqitch** | Perl/SQL CLI, TS 통합 없음 | PostgreSQL target/advisory lock 사용 | dependency metadata는 있지만 중앙 append-only plan을 사용한다. 동시 브랜치 추가는 `sqitch.plan` Git conflict이며 사람이 순서를 확인해야 함 | 의존성 명세와 검증(`check`, `verify`)이 필요할 때만 고려. TS 전환 후보로는 비권고 |
| **TypeORM / Umzug / dbmate** | 각각 TS 또는 CLI 사용 가능 | 조사 범위에서 PostgreSQL 분산 migration lock을 기본 제공하지 않음 | 모두 자동 의미 병합 없음 | 전용 migration Job과 외부 lock을 별도로 설계해야 하므로 본 문제의 우선 후보가 아님 |

## 권고 운영 모델

Kysely Migrator를 전용 migration 컨테이너 또는 ArgoCD `PreSync` Job에서 실행하고, 애플리케이션 배포보다 먼저 완료되게 한다. PostgreSQL advisory lock은 서로 겹친 배포의 실행을 하나로 직렬화한다. Job은 재시도해도 이미 적용된 migration을 다시 적용하지 않아야 한다.

Git 병합 단계에서는 다음을 규칙으로 둔다.

1. PR 머지 직전 대상 브랜치 최신 기준으로 migration을 rebase한다.
2. migration 파일은 재정렬하지 않고, 충돌 시 후속 번호/타임스탬프를 새로 부여해 단일 순서를 만든다.
3. CI에서 migration 이력의 중복·순서 위반과 빈 database부터의 적용을 검사한다.
4. 같은 테이블·컬럼을 둘 이상의 브랜치가 바꿨다면 migration 충돌로 분류하고, 한 명의 소유자가 최종 DDL과 적용 순서를 결정한다.

이 모델은 multi-head를 없애는 대신, DB 이력을 Git commit graph가 아니라 **배포 순서가 있는 append-only log**로 취급한다. 롤백 migration은 기본 경로에 두지 않고, 오류 시 forward fix migration을 추가한다는 정책과도 맞는다.

## 근거

- [Kysely migrations](https://www.kysely.dev/docs/migrations), [PostgreSQL adapter advisory lock 구현](https://github.com/kysely-org/kysely/blob/f24018c789c3cf7ad03ccc672ada63a1ded87f88/src/dialect/postgres/postgres-adapter.ts#L6-L39)
- [Prisma `migrate deploy`](https://www.prisma.io/docs/cli/migrate/deploy), [Prisma migration squashing workflow](https://docs.prisma.io/docs/v6/orm/prisma-migrate/workflows/squashing-migrations)
- [Drizzle Kit migrations](https://orm.drizzle.team/docs/drizzle-kit-migrate), [병렬 journal 충돌 사례](https://github.com/drizzle-team/drizzle-orm/issues/5774#L160-L170)
- [Knex migration locking](https://knexjs.org/guide/migrations#notes-about-locks)
- [Atlas migration directory integrity](https://atlasgo.io/concepts/migration-directory-integrity), [Atlas versioned apply](https://atlasgo.io/versioned/apply)
- [Flyway versioned migrations](https://documentation.red-gate.com/flyway/flyway-concepts/migrations/versioned-migrations), [Liquibase lock table](https://docs.liquibase.com/secure/user-guide-5-1-1/what-is-the-database-changelog-lock-table)
- [Sqitch tutorial의 동시 변경 충돌 처리](https://sqitch.org/docs/manual/sqitchtutorial/#L987-L1027), [Sqitch deploy locking](https://sqitch.org/docs/manual/sqitch-deploy/#L85-L90)

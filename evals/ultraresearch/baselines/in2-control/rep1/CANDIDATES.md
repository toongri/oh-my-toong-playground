# 후보 비교

## 결론

**권장 후보는 Kysely Migrator를 마이그레이션 전용으로 도입하는 방식이다.** TypeScript로 작성할 수 있고 PostgreSQL advisory lock 및 기본 트랜잭션 실행을 제공하므로, 배포 시 단일 migration Job에서 안전하게 실행하기 좋다. 다만 어떤 도구도 서로 다른 브랜치의 DDL을 Git처럼 의미적으로 자동 병합하지는 않는다. 따라서 도구 교체의 목표는 “자동 병합”이 아니라 **DB 잠금으로 배포 경합을 막고, 충돌은 PR/병합 시점에 선형화하는 운영 규칙**으로 잡아야 한다.

현재 Alembic 이력은 다수의 merge revision과 복수 head가 누적된 상태이므로, 분기 DAG를 계속 만들고 빈 merge revision으로 수습하는 방식은 중단하는 편이 맞다. 롤백이 필요 없다는 전제에는 immutable한 forward-only migration 이력이 잘 맞는다.

## 평가 기준

- TypeScript 환경에서 작성·실행하기 쉬운가
- 배포 경쟁과 재시도에 견디는 데이터베이스 수준 잠금이 있는가
- 여러 브랜치가 동시에 migration을 추가할 때 충돌을 드러내고 관리할 수 있는가
- 기존 Drizzle 사용 환경 및 CI/ArgoCD의 `migration → backend deploy → verification` 순서에 무리 없이 넣을 수 있는가
- forward-only 운영에 불필요한 유료 기능이나 큰 운영 부담이 없는가

## 후보별 비교

| 후보 | 잠금·배포 실행 | 브랜치 병합 모델 | 장점 | 결정적 제약 | 판정 |
| --- | --- | --- | --- | --- | --- |
| **Kysely Migrator** | PostgreSQL adapter가 advisory lock을 사용하고 기본적으로 트랜잭션 실행 | 기본 prefix 순서를 검사한다. `allowUnorderedMigrations`로 순서 거부는 완화할 수 있으나 충돌 DDL을 해결하지는 못함 | TS-native, 배포 Job에 넣기 적합, 별도 ORM 전환 없이 migration 전용 도입 가능 | Git식 semantic merge는 없음. migration 작성 규칙과 CI 검사가 필요 | **1순위** |
| **Prisma Migrate** | `migrate deploy`가 CI/CD용이며 PostgreSQL advisory lock 사용 | 파일의 어휘 순서 기반. 분기 이력은 rebase/squash를 사람이 처리 | 배포 명령과 운영 문서가 성숙 | Drizzle 기반 스키마 관리에서 Prisma로 중심을 옮겨야 하며, 병합 문제도 수동 해결 | 조건부 후보 |
| **Drizzle Kit** | PostgreSQL migrator는 트랜잭션 처리하지만 조사된 구현에 advisory lock 없음 | journal/index가 병렬 생성 시 충돌할 수 있어 parent baseline에서 재생성을 권장 | 이미 의존성이 존재하고 TS-native | 배포 경쟁을 자체적으로 막지 못하고, 현재 문제의 핵심인 동시성에 취약 | 비권장 |
| **Knex** | DB lock 제공 | 선형 파일 ledger. DAG merge 없음 | 단순하고 오래 검증된 TS 친화 선택지 | Kysely 대비 이 환경에서 추가 이점이 작음 | 차선 |
| **Atlas** | PostgreSQL advisory lock, Drizzle external schema 지원 | `atlas.sum`이 분기된 migration directory를 의도적으로 Git 충돌로 만든다. 선형화를 위해 rebase/rehash 필요 | 이력 무결성 검증이 강하고 Drizzle 연동 가능 | OSS에서는 `migrate rebase`를 쓸 수 없고 공식 Pro가 필요 | 유료 허용 시 후보 |
| **Sqitch** | PostgreSQL target/advisory lock, `check`·`verify` 제공 | 의존성 메타데이터가 있으나 중앙 append-only plan이므로 동시 변경은 Git 충돌 후 사람이 순서를 검토 | SQL 중심, 적용 순서와 상태 검증이 명확 | Perl/SQL CLI이며 TS/Drizzle 통합이 아님. central plan 충돌은 남음 | 운영 도구 대안 |
| **Flyway Community** | DB lock, Docker/CI 실행에 적합 | immutable한 선형 SQL 이력. `outOfOrder`는 의미적 병합이 아님 | forward-only를 무료로 운용 가능하고 ORM 독립적 | TS-native 라이브러리가 아니며 브랜치 충돌을 자동 해소하지 않음 | SQL 표준화 시 후보 |
| **Liquibase** | `DATABASECHANGELOGLOCK` 사용 | changelog 순서 기반, Git DAG merge는 아님 | 복잡한 변경 관리 기능 | 도입·운영 복잡도 대비 이번 문제의 직접적 해법이 아님 | 보류 |
| TypeORM / Umzug / dbmate | 조사 범위에서는 PostgreSQL 분산 migration lock을 기본 제공하지 않음 | 대체로 선형 이력 | 가벼운 도구 선택 가능 | 전용 Job과 외부 lock을 별도로 설계해야 함 | 제외 |

## 권장 운영안: Kysely Migrator + 선형 이력 정책

Kysely를 애플리케이션의 주 ORM으로 바꿀 필요는 없다. migration runner만 Kysely Migrator로 두고, 애플리케이션 런타임의 Drizzle 사용은 유지한다. 배포 파이프라인의 선행 migration 단계는 다음 조건으로 실행한다.

1. 환경마다 하나의 migration Job만 실행하고, Job 내부에서는 Kysely의 PostgreSQL advisory lock으로 중복 실행·재시도를 직렬화한다.
2. migration은 forward-only이며 적용된 파일을 수정하거나 삭제하지 않는다. 실패한 변경은 새 migration으로 보정한다.
3. 각 파일명은 시간 접두사만 쓰지 말고 충돌 방지 식별자(예: `YYYYMMDDHHmmss_<짧은-UUID>_description.ts`)를 포함한다. 같은 시각에 만든 두 PR의 파일명 충돌을 피하기 위함이다.
4. migration을 추가한 PR은 기준 브랜치 최신화 후, migration 목록의 중복 이름·순서·적용 가능성을 검증한다. 두 migration이 같은 테이블·컬럼을 비호환적으로 바꾸면 자동 해결하지 말고 한쪽을 후속 migration으로 재작성한다.
5. `allowUnorderedMigrations`는 과거의 순서만 늦게 들어온 안전한 독립 migration에 한정해 사용한다. 이를 상시 기본값으로 켜면 스키마 의존성 충돌을 감추기 쉽다.

이 정책은 Alembic multi-head를 “merge revision 생성”으로 해결하던 흐름을 없애고, Git은 코드 충돌을, CI는 migration 파일 충돌과 기본 검증을, 데이터베이스 advisory lock은 실제 배포 경합을 각각 담당하게 한다.

## 도입 시 확인할 사항

- 새 runner가 운영 PostgreSQL 권한으로 advisory lock과 DDL을 실행할 수 있는지 staging에서 검증한다.
- 기존 Alembic revision의 최종 스키마와 신규 migration ledger의 기준점을 한 번만 명시적으로 정한다. 두 체계를 병행해 같은 DB를 변경하지 않는다.
- ArgoCD의 migration Job 재시도 시, 이미 적용된 migration을 다시 적용하지 않고 성공 상태로 끝나는지 확인한다.

## 근거

- [Kysely migrations](https://www.kysely.dev/docs/migrations) 및 [PostgreSQL adapter 구현](https://github.com/kysely-org/kysely/blob/f24018c789c3cf7ad03ccc672ada63a1ded87f88/src/dialect/postgres/postgres-adapter.ts#L6-L39)
- [Prisma `migrate deploy`](https://www.prisma.io/docs/cli/migrate/deploy), [Prisma migration squashing](https://docs.prisma.io/docs/v6/orm/prisma-migrate/workflows/squashing-migrations)
- [Drizzle Kit migrate](https://orm.drizzle.team/docs/drizzle-kit-migrate), [Drizzle 병렬 migration 충돌 사례](https://github.com/drizzle-team/drizzle-orm/issues/5774#L160-L170)
- [Atlas migration directory integrity](https://atlasgo.io/concepts/migration-directory-integrity), [Atlas versioned apply](https://atlasgo.io/versioned/apply)
- [Sqitch tutorial의 branch-plan 충돌](https://sqitch.org/docs/manual/sqitchtutorial/#L987-L1027), [Sqitch deploy locking](https://sqitch.org/docs/manual/sqitch-deploy/#L85-L90)
- [Flyway versioned migrations](https://documentation.red-gate.com/flyway/flyway-concepts/migrations/versioned-migrations), [Liquibase changelog lock](https://docs.liquibase.com/secure/user-guide-5-1-1/what-is-the-database-changelog-lock-table)

## 후보 비교

### 결론

권고안은 **Kysely Migrator를 단독 마이그레이션 실행기로 채택하고, 마이그레이션 디렉터리는 선형 이력으로 운영**하는 것이다. PostgreSQL advisory lock과 기본 트랜잭션 실행을 제공해 배포 시 동시 실행을 방지할 수 있고, `allowUnorderedMigrations`로 서로 다른 브랜치에서 추가된 독립 마이그레이션의 파일명 순서 제약을 완화할 수 있다. 다만 이 옵션은 충돌하는 DDL을 병합하지 않는다. 따라서 Alembic의 multi-head 문제를 도구만으로 해결하려는 접근은 성립하지 않으며, PR 병합 전에 한 사람이 이력 순서와 DDL 호환성을 확인·정리하는 운영 규칙이 필요하다.

현재 `algocare-home/stage`에서 Drizzle은 스키마 동기화 용도로만 남아 있고 Alembic이 유일한 마이그레이션 권한을 갖는다. 전환 시에는 Alembic과 새 도구가 같은 DB 이력을 동시에 관리하지 않도록, 기준 스키마에서 한 번만 전환하고 이후 권한을 Kysely로 단일화해야 한다.

### 평가 기준

| 기준 | 의미 |
| --- | --- |
| 배포 안전성 | CI/CD·Argo Job에서 반복 실행할 수 있고, 동시 실행을 DB 수준에서 막는가 |
| 브랜치 병합성 | 병렬로 추가된 마이그레이션을 수용하는 방식과 사람의 정리 비용 |
| TS 적합성 | TypeScript 라이브러리인지, 기존 Drizzle 스키마와 함께 쓸 수 있는지 |
| 운영 부담 | 별도 서비스·유료 기능·추가 실행기 도입 없이 관리할 수 있는지 |

### 비교표

| 후보 | 배포 안전성 | 브랜치 병합성 | TS/현 환경 적합성 | 판단 |
| --- | --- | --- | --- | --- |
| **Kysely Migrator** | PostgreSQL advisory lock, 기본 트랜잭션 실행 지원 | `allowUnorderedMigrations`로 순서 검사를 완화할 수 있으나 DDL 충돌은 사람이 해결 | TS 네이티브. Drizzle을 계속 스키마 정의/쿼리에 써도 마이그레이션 실행기는 분리 가능 | **채택 권고** |
| **Prisma Migrate** | `migrate deploy`가 CI/CD용이며 PostgreSQL advisory lock 사용 | 파일 이력은 선형. 브랜치 충돌은 rebase/squash로 수동 정리 | TS 네이티브지만 Prisma ORM/스키마 체계로의 실질적 전환 비용이 큼 | ORM 전환까지 원할 때만 검토 |
| **Knex** | DB lock 제공 | 파일명 기반 선형 이력, DAG 병합 미지원 | TS 친화적이나 현재 Drizzle 기반에 새 쿼리/스키마 계층을 더할 이유가 약함 | Kysely의 단순 대안 |
| **Drizzle Kit** | 트랜잭션 실행은 확인되지만, 조사된 PostgreSQL migrator에는 advisory lock이 없음 | journal/index가 병렬 생성 시 충돌할 수 있고 부모 기준 재생성이 필요 | 이미 의존성은 있으나 현재 마이그레이션 권한이 아님 | 단독 배포 실행기로는 비권고 |
| **Atlas** | PostgreSQL advisory lock, Drizzle 외부 스키마 연동 가능 | `atlas.sum`이 분기 변경을 의도적으로 충돌시켜 선형화 필요. `migrate rebase`는 Community에서 미지원 | Drizzle 연동은 좋지만 핵심 정리 기능이 유료 | 유료 도입 의사가 있을 때 재검토 |
| **Sqitch** | PostgreSQL 대상 lock, `check`·`verify` 제공 | 의존성 메타데이터가 있어도 중앙 append-only plan 충돌을 사람이 해결 | Perl/SQL CLI. TS 라이브러리·Drizzle 연동 아님 | SQL 중심 조직의 별도 선택지 |
| **Flyway Community** | DB lock과 Docker/CI 실행 적합성 | immutable 선형 이력. `outOfOrder`는 의미적 병합이 아님 | 언어 비종속 SQL 도구, TS 통합 이점 없음 | 언어 독립 SQL 표준화가 목표일 때만 검토 |
| **Liquibase** | `DATABASECHANGELOGLOCK` 제공 | changelog 순서는 선형이며 Git식 자동 병합은 없음 | 유연하지만 현재 요구에 비해 운영 모델이 무거움 | 비권고 |

### 권고 운영 모델

1. **권한을 하나로 제한한다.** 새 전환 이후 Alembic·Drizzle Kit·Kysely가 같은 프로덕션 DB의 버전 테이블을 각각 관리하게 두지 않는다. Kysely용 migration table 하나만 배포 판정의 기준으로 삼는다.
2. **파일 식별자와 병합 규칙을 정한다.** 충돌을 줄이기 위해 시간·난수 또는 발급 번호를 포함한 고유 ID를 사용한다. PR에 마이그레이션이 있으면 병합 직전에 최신 기본 브랜치를 rebase하고, 순서와 DDL 상호작용을 검토한다. `allowUnorderedMigrations`는 독립 변경의 순서 제약 완화용이며, 이를 DDL 충돌 해결책으로 취급하지 않는다.
3. **배포 파이프라인에서 한 번만 실행한다.** 기존 순서인 `migration → backend deploy → verification`을 유지하고, 마이그레이션 단계는 환경별 singleton Job으로 실행한다. Kysely의 advisory lock은 재시도·중복 dispatch가 겹치는 경우의 DB 수준 최후 방어선이다.
4. **되돌리기보다 전진 수정으로 운영한다.** 이미 적용된 migration은 수정·삭제하지 않는다. 실패한 변경은 새 forward migration으로 보정하고, 데이터 파괴 가능성이 있는 DDL은 expand/contract 방식으로 나눈다. 이는 DB rollback을 운영 전략으로 삼지 않는 전제와 일치한다.
5. **전환을 검증한다.** 비프로덕션 복제 DB에서 Alembic 마지막 상태를 기준선으로 잡고, 두 개의 독립 브랜치가 migration을 추가한 뒤 병합·동시 배포하는 시나리오를 확인한다. 이 검증이 끝나기 전에는 Alembic 권한을 제거하지 않는다.

### 전제와 한계

조사한 Prisma, Drizzle Kit, Kysely, Knex, Atlas, Sqitch, Flyway, Liquibase 가운데 Git의 3-way merge처럼 DDL 의미를 자동으로 병합하는 도구는 없었다. 자동 병합이 어려운 이유는 같은 테이블·열 변경의 의미적 충돌을 도구가 안전하게 판정할 수 없기 때문이다. 이 문제의 해법은 “DAG를 지원하는 새 라이브러리”가 아니라, DB lock으로 실행을 직렬화하고 선형 이력을 병합 규칙으로 유지하며 충돌 DDL을 명시적으로 리뷰하는 조합이다.

### 근거

- Kysely의 PostgreSQL advisory lock 및 트랜잭션 기본값: [PostgreSQL adapter](https://github.com/kysely-org/kysely/blob/f24018c789c3cf7ad03ccc672ada63a1ded87f88/src/dialect/postgres/postgres-adapter.ts#L6-L39), [Kysely migrations 문서](https://www.kysely.dev/docs/migrations)
- Prisma의 배포 명령과 이력 정리: [Prisma Migrate deploy](https://www.prisma.io/docs/cli/migrate/deploy), [migration squashing](https://docs.prisma.io/docs/v6/orm/prisma-migrate/workflows/squashing-migrations)
- Drizzle의 실행 구현과 병렬 journal 충돌: [PostgreSQL dialect](https://github.com/drizzle-team/drizzle-orm/blob/273c78071d4841b497f5144734b38294df7ec64b/drizzle-orm/src/pg-core/dialect.ts#L2320-L2391), [issue #5774](https://github.com/drizzle-team/drizzle-orm/issues/5774#L160-L170)
- Atlas의 선형화 및 Community 제약: [migration directory integrity](https://atlasgo.io/concepts/migration-directory-integrity), [CLI source](https://github.com/ariga/atlas/blob/9a6bc601212130aaaefcbc8dd36c710baf9716ff/cmd/atlas/internal/cmdapi/cmdapi.go#L639-L655)
- Sqitch의 분기 plan 충돌과 lock: [tutorial](https://sqitch.org/docs/manual/sqitchtutorial/#L987-L1027), [deploy](https://sqitch.org/docs/manual/sqitch-deploy/#L85-L90)
- Flyway·Liquibase의 locking/선형 이력: [Flyway versioned migrations](https://documentation.red-gate.com/flyway/flyway-concepts/migrations/versioned-migrations), [Liquibase lock table](https://docs.liquibase.com/secure/user-guide-5-1-1/what-is-the-database-changelog-lock-table)

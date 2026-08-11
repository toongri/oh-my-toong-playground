# 후보 비교

## 결론

Alembic의 multi-head를 Git처럼 자동으로 의미 병합하는 도구는 조사 후보에 없었다. 모든 후보는 결국 하나의 적용 순서를 확정해야 하며, 서로 충돌하는 DDL의 의미를 도구가 자동 판정해 주지는 않는다. 따라서 해결의 핵심은 **PostgreSQL DB 수준 잠금으로 배포 실행을 직렬화**하고, **마이그레이션 이력을 선형으로 유지하는 브랜치 병합 규칙**을 두는 것이다.

이 기준에서 1순위는 **Kysely Migrator**다. TypeScript로 작성·실행할 수 있고, PostgreSQL 어댑터가 advisory lock을 사용하며 기본적으로 트랜잭션 안에서 실행된다. 배포 파이프라인의 기존 `migration → backend deploy → verification` 순서에서 migration 단계만 교체하기에도 맞다. 다만 `allowUnorderedMigrations`는 파일 순서 검사를 완화할 뿐 DDL 충돌을 해결하지 않으므로, 이를 Git 병합 기능으로 취급해서는 안 된다.

기존 Drizzle 모델을 계속 기준 스키마로 삼고 싶고 상용 기능을 허용할 수 있다면 **Atlas**가 차선이다. Drizzle 외부 스키마를 지원하고 PostgreSQL advisory lock도 제공하지만, `atlas.sum`은 분기된 디렉터리 변경을 의도적으로 Git 충돌로 만들며, 이를 정리하는 `migrate rebase`는 Community가 아니라 유료 공식/Pro 기능이다. 즉 Atlas도 충돌을 제거하지 않고 조기에 드러내고 사람이 선형화하도록 한다.

롤백은 선택 기준에서 제외한다. 운영 원칙은 이미 적용한 변경을 되돌리는 대신 새 forward migration으로 보정하는 방식이어야 한다.

## 평가 기준

- **배포 안전성**: 여러 배포 인스턴스가 동시에 실행되어도 DB에서 한 프로세스만 마이그레이션을 적용할 수 있는가.
- **동시 브랜치 대응**: 분기에서 추가된 마이그레이션을 어떻게 하나의 적용 순서로 확정하는가. 자동 의미 병합이 아니라 충돌 감지·순서 제어·사람의 조정 여부를 평가한다.
- **도입 적합성**: TypeScript/Node 22·pnpm 환경에서 실행하기 쉬운지, 현재의 Drizzle 사용과 공존 가능한지, 기존 배포 단계에 넣기 쉬운지를 본다.
- **운영 모델**: migration 전용 단일 Job에서 실행하고, DB advisory lock을 최종 동시성 방어선으로 사용한다.

## 후보별 비교

| 후보 | 배포 안전성 | 동시 브랜치 이력 처리 | TS·Drizzle 적합성 | 판단 |
| --- | --- | --- | --- | --- |
| **Kysely Migrator** | PostgreSQL 어댑터가 advisory lock을 사용하고 기본 트랜잭션 실행을 지원한다. | 기본적으로 파일 접두사 순서를 검증한다. `allowUnorderedMigrations`로 순서 거부를 피할 수 있지만, 충돌 DDL은 사람이 해결해야 한다. | TypeScript-native다. Drizzle을 즉시 교체할 필요 없이 migration runner로 별도 도입할 수 있다. | **권장**. 잠금과 실행 모델이 요구사항에 직접 맞고, 선형 이력 규칙만 운영으로 보완하면 된다. |
| **Atlas** | PostgreSQL advisory lock을 제공한다. | `atlas.sum`이 분기된 마이그레이션 디렉터리를 Git 충돌로 노출한다. 재정렬·재해시는 `migrate rebase`가 필요하지만 Community에는 없고 유료 공식/Pro 기능이다. | Drizzle-compatible external schema를 지원한다. | **조건부 권장**. Drizzle 연계를 중시하고 유료 기능 또는 수동 rehash를 감수할 때 적합하다. |
| **Prisma Migrate** | `migrate deploy`는 CI/CD용 명령이며 PostgreSQL advisory lock을 사용한다. | 어휘순 파일 이력이다. 분기 충돌은 rebase/squash로 사람이 선형화해야 한다. | TS-native지만 현재 Drizzle 중심 환경에서 Prisma schema·CLI를 별도로 운영해야 한다. | **비권장**. 실행 안정성은 좋지만 도입 비용 대비 multi-head의 근본 원칙은 달라지지 않는다. |
| **Drizzle Kit** | 조사한 PostgreSQL migrator 구현에는 트랜잭션은 있으나 advisory lock이 없다. | journal/index가 병렬 생성 시 충돌할 수 있으며, 기준 브랜치에서 재생성하는 방식이 필요하다. | 기존 Drizzle과 가장 가깝다. | **비권장**. 별도 DB 잠금과 엄격한 생성 절차를 추가하지 않으면 배포 경합 요구를 충족하지 못한다. |
| **Knex** | 내장 DB lock이 있다. | 파일명 기반 선형 ledger이며 DAG merge는 제공하지 않는다. | TS-friendly지만 Drizzle과 별도 쿼리·migration DSL을 관리한다. | **차선**. Kysely보다 특별한 이점 없이 별도 도구를 도입하는 선택이다. |
| **Flyway Community** | DB lock 및 Docker/CI 실행 모델을 제공한다. | 불변의 선형 SQL 이력이다. `outOfOrder`도 분기 DDL의 의미를 병합하지 않는다. | TS 라이브러리는 아니지만 SQL 중심 CLI/컨테이너로 파이프라인에 넣기 쉽다. | **조건부 대안**. ORM과 마이그레이션을 분리하고 SQL을 표준으로 삼을 때 적합하다. |
| **Liquibase** | `DATABASECHANGELOGLOCK`으로 실행을 잠근다. | changelog 순서를 관리하지만 Git DAG 병합은 제공하지 않는다. | TS-native·Drizzle 연계 도구는 아니다. | **후순위**. 기능은 충분하지만 현재 문제에 비해 운영 표면적이 크다. |
| **Sqitch** | PostgreSQL target/advisory lock을 사용하고 `check`·`verify`로 divergence와 실행 순서를 검증한다. | 의존성 메타데이터가 있지만 중앙 append-only `sqitch.plan`은 동시 변경 시 Git 충돌이 나며, 해결 후 순서를 사람이 확인해야 한다. | Perl/SQL CLI이며 Drizzle 통합은 없다. 공식 컨테이너로 CI/Argo Job에는 넣을 수 있다. | **조건부 대안**. SQL 중심·명시적 의존성 그래프가 필요할 때만 검토한다. |
| **TypeORM / Umzug / dbmate** | 조사 범위에서 PostgreSQL 분산 migration lock을 기본 제공하지 않는다. | 선형 이력 또는 실행기일 뿐 Git식 병합을 제공하지 않는다. | 일부는 TS 친화적이지만 별도 lock Job이 필요하다. | **제외**. 현재의 배포 경합을 줄이기 위한 핵심 요건을 기본값으로 충족하지 않는다. |

## 권장 운영 방식

Kysely Migrator를 migration 전용 컨테이너 명령으로 패키징하고, 환경별 배포에서 backend rollout 전에 한 번만 실행한다. 기존 Argo 배포 직렬화는 보조 방어선으로 유지하되, 실제 상호 배제는 PostgreSQL advisory lock에 맡긴다. lock을 기다리는 재시도와 Job 재실행은 안전해야 하므로, 실행기는 이미 적용된 마이그레이션을 ledger로 식별하는 idempotent 동작을 유지해야 한다.

브랜치 정책은 다음처럼 둔다.

1. 마이그레이션은 되돌리거나 수정하지 않는 forward-only 파일로 추가한다.
2. PR을 병합하기 직전에 대상 브랜치를 rebase하고, 새 migration의 정렬 키와 적용 순서를 다시 확정한다.
3. 같은 테이블·컬럼을 바꾸는 두 변경은 순서를 명시해 한 migration으로 조정하거나, 서로 호환되는 단계적 변경으로 나눈다. 이것은 라이브러리가 자동 해결할 수 없는 의미 충돌이다.
4. `allowUnorderedMigrations`는 기존 운영 이력에 늦게 합류하는 안전한 독립 변경에만 제한적으로 쓴다. 기본 정책으로 켜면 순서 문제를 감추기 쉽다.
5. 이미 배포된 스키마의 수정은 새 migration으로만 보정하고, down/rollback을 릴리스 복구 수단으로 사용하지 않는다.

이 방식은 Alembic의 merge revision을 계속 만들어 head를 맞추는 운영 대신, Git에서 충돌을 해소한 뒤 단일 선형 migration을 배포한다. 따라서 multi-head 자체는 사라지지만, 충돌 DDL에 대한 사람의 설계 판단은 의도적으로 남는다.

## 근거

- [Kysely migration docs](https://www.kysely.dev/docs/migrations), [PostgreSQL adapter advisory-lock implementation](https://github.com/kysely-org/kysely/blob/f24018c789c3cf7ad03ccc672ada63a1ded87f88/src/dialect/postgres/postgres-adapter.ts#L6-L39)
- [Atlas migration-directory integrity](https://atlasgo.io/concepts/migration-directory-integrity), [Atlas versioned apply](https://atlasgo.io/versioned/apply), [Atlas Community command availability](https://github.com/ariga/atlas/blob/9a6bc601212130aaaefcbc8dd36c710baf9716ff/cmd/atlas/internal/cmdapi/cmdapi.go#L639-L655)
- [Prisma `migrate deploy`](https://www.prisma.io/docs/cli/migrate/deploy), [Prisma migration squashing workflow](https://docs.prisma.io/docs/v6/orm/prisma-migrate/workflows/squashing-migrations), [Prisma PostgreSQL lock implementation](https://github.com/prisma/prisma-engines/blob/561d7b42579a2459cc8edf3788918b626c640023/schema-engine/connectors/sql-schema-connector/src/flavour/postgres.rs#L363-L384)
- [Drizzle Kit migration docs](https://orm.drizzle.team/docs/drizzle-kit-migrate), [Drizzle PostgreSQL migrator implementation](https://github.com/drizzle-team/drizzle-orm/blob/273c78071d4841b497f5144734b38294df7ec64b/drizzle-orm/src/pg-core/dialect.ts#L2320-L2391), [parallel journal collision report](https://github.com/drizzle-team/drizzle-orm/issues/5774#L160-L170)
- [Knex migration locking](https://knexjs.org/guide/migrations#notes-about-locks), [Flyway versioned migrations](https://documentation.red-gate.com/flyway/flyway-concepts/migrations/versioned-migrations), [Liquibase changelog lock](https://docs.liquibase.com/secure/user-guide-5-1-1/what-is-the-database-changelog-lock-table)
- [Sqitch plan and concurrent-branch tutorial](https://sqitch.org/docs/manual/sqitchtutorial/#L987-L1027), [Sqitch deployment lock](https://sqitch.org/docs/manual/sqitch-deploy/#L85-L90), [Sqitch check](https://sqitch.org/docs/manual/sqitch-check/), [Sqitch verify](https://sqitch.org/docs/manual/sqitch-verify/)

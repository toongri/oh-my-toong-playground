# 후보 비교

## 먼저 결론

Git의 3-way merge처럼 서로 독립적으로 작성한 DDL을 안전하게 의미 단위로 자동 병합해 주는 마이그레이션 도구는 이번 조사 후보에 없었다. 다만 현재 발생하는 배포 경합과 Alembic multi-head의 운영 부담은 **DB 수준 단일 실행 잠금**, **마이그레이션 전용 배포 단계**, **단일 선형 이력 규칙**으로 크게 줄일 수 있다. TS 진영에서 새 기준 도구를 고른다면 Kysely Migrator가 가장 균형이 좋고, 현재 Drizzle을 적극 활용할 계획이라면 Atlas를 유료 도입할 때만 차선책이 된다.

현재 환경은 이미 `migration → backend deploy → verification` 순서이며 환경별 백엔드 배포를 직렬화한다. 따라서 어떤 도구를 택하더라도 ArgoCD `PreSync` Job 또는 동등한 단일 migration Job에서 실행하고, 애플리케이션 Pod가 개별적으로 마이그레이션을 실행하지 않게 해야 한다. 잠금은 배포 직렬화의 보조 장치가 아니라, 재시도·수동 실행·동시 파이프라인까지 막는 최종 안전장치다.

| 후보 | TS 적합성 | PostgreSQL 동시 실행 방지 | 분기/이력 처리 | 배포 실행성 | 판단 |
| --- | --- | --- | --- | --- | --- |
| **Kysely Migrator** | 높음. TS-native | **있음**. advisory lock, 기본 트랜잭션 | 기본은 순서 있는 선형 이력. `allowUnorderedMigrations`는 순서 검증을 완화할 뿐 DDL 충돌을 병합하지는 않음 | migration Job에 포함하기 쉬움 | **권장**. 잠금과 단순한 운영 모델의 균형이 가장 좋음 |
| **Prisma Migrate** | 높음. TS-native | **있음**. `migrate deploy`가 PostgreSQL advisory lock 사용 | 파일의 사전식 순서 기반. 브랜치 충돌은 rebase/squash로 사람이 해결 | `migrate deploy`가 CI/CD 용도 | 조건부 적합. Prisma ORM 도입까지 감수할 때만 고려 |
| **Drizzle Kit** | 높음. 기존 Drizzle과 직접 연계 | 없음. 조사된 PostgreSQL migrator는 트랜잭션만 제공 | journal/index가 병렬 생성에서 충돌할 수 있어 parent baseline에서 재생성 필요 | 실행 자체는 간단 | 비권장. 현재 문제의 핵심인 동시 실행 보호가 빠져 있음 |
| **Knex** | 높음. TS-friendly | 있음. 내장 DB lock | 파일명 기반 선형 ledger, DAG 병합 없음 | CI/Job 실행에 무난 | 차선. 이미 Knex를 쓰는 경우 외에는 Kysely 대비 이점이 작음 |
| **Atlas** | 중간. Drizzle external schema 호환, 별도 CLI | **있음**. PostgreSQL advisory lock | `atlas.sum`이 분기된 디렉터리를 의도적으로 충돌시킴. rebase/rehash로 선형화 | CI/Argo Job에 적합 | 조건부 적합. Drizzle 호환성은 좋지만 OSS에서는 `migrate rebase`를 쓸 수 없어 유료 전제가 필요 |
| **Flyway Community** | 낮음. 언어 독립 SQL CLI | 있음. DB lock | 불변의 선형 SQL 이력. `outOfOrder`도 의미적 병합은 아님 | Docker/CI 적합, forward-only 무료 | SQL-first를 원할 때의 강한 대안. TS 라이브러리 요구에는 맞지 않음 |
| **Liquibase** | 낮음. 언어 독립 | 있음. `DATABASECHANGELOGLOCK` | changelog 순서 모델이며 Git DAG 병합은 없음 | CI/Job에 적합 | 기능은 충분하지만 이 요구에는 상대적으로 무거움 |
| **Sqitch** | 낮음. Perl/SQL CLI, Drizzle 연계 없음 | 있음. PostgreSQL target/advisory lock | 의존성 메타데이터가 있으나 중앙 append-only `sqitch.plan`이 브랜치 충돌; 사람이 순서를 검토해야 함 | 공식 컨테이너로 PreSync Job 가능 | 의존성 검증이 특히 필요할 때만. 자동 병합 해법은 아님 |

### 1순위: Kysely Migrator + 단일 선형 이력 규칙

Kysely Migrator는 PostgreSQL advisory lock과 기본 트랜잭션을 제공하므로, 동일 환경에 migration Job이 중복 기동되더라도 한 실행만 진행하게 만들 수 있다. TS-native라 Node 22/pnpm/TypeScript 기반 배포 흐름에 자연스럽게 들어가며, 전진 전용 운영에도 잘 맞는다. `allowUnorderedMigrations`는 번호가 뒤늦게 합쳐진 마이그레이션의 기본 거부를 피하는 용도일 뿐이므로, 이를 자동 병합 기능으로 간주하면 안 된다.

운영 규칙은 다음처럼 고정한다.

1. PR에서는 마이그레이션 파일 하나가 아닌 **현 대상 브랜치 기준의 하나의 선형 체인**만 허용한다. 병합 전 rebase하여 번호/파일명을 재정렬한다.
2. 배포에서는 migration 전용 Job 하나만 Kysely Migrator를 실행하고, backend deploy보다 먼저 성공해야 한다.
3. advisory lock 획득 대기 시간과 실패 로그를 관측한다. lock 대기는 정상 직렬화일 수 있지만, 장기 대기는 선행 Job 정지의 신호다.
4. 롤백 대신 보정 마이그레이션만 추가한다. 적용된 파일은 수정·삭제하지 않는다.

이 방식은 multi-head라는 그래프를 없애는 것이지, 상충하는 `ALTER TABLE`을 자동으로 판단하는 것이 아니다. 같은 테이블·컬럼을 두 브랜치가 바꾼 경우에는 PR 병합 시 사람이 의도를 조정해야 한다. 대신 그 충돌을 배포 시점이 아니라 코드 리뷰/병합 시점으로 옮긴다.

### 조건부 2순위: Atlas (유료 도입 가능할 때)

Drizzle schema를 계속 중심에 두고 schema-diff 워크플로를 원한다면 Atlas가 가장 가까운 후보다. PostgreSQL advisory lock을 제공하고 migration directory integrity를 관리한다. 그러나 그 무결성 모델은 divergent migration directory를 자동으로 합치지 않고 `atlas.sum` 충돌로 드러내도록 설계되어 있다. 또한 조사 기준으로 공동체/OSS 빌드에는 `migrate rebase`가 없고 공식 Pro가 필요하다. 즉, 유료 비용을 수용하고도 선형화 책임은 팀이 진다는 전제에서만 선택할 만하다.

### 선택하지 않는 이유

- **Prisma Migrate**는 배포 안전성은 좋지만, Prisma로의 모델·ORM 전환까지 포함하면 문제 해결 범위보다 교체 비용이 커진다. 현재 핵심은 TS 도입 자체가 아니라 이력/실행 제어다.
- **Drizzle Kit**은 기존 의존성이라는 장점이 있지만 동시 migrator를 막는 DB 수준 잠금이 확인되지 않았다. 병렬 생성 시 journal 충돌 위험도 현재의 협업 문제와 맞닿아 있다.
- **Knex**는 무난한 선형 migrator지만 Kysely와 같은 계열의 운영 모델에서 더 나은 문제 적합성을 주지는 않는다.
- **Flyway/Liquibase/Sqitch**는 신뢰할 만한 외부 CLI이지만 TS-native라는 우선 조건에는 덜 맞는다. 특히 Sqitch의 의존성 그래프는 흥미롭지만 중앙 plan 파일 충돌을 없애지 못한다.

### 도입 전제와 마이그레이션 범위

현재 Node/Drizzle 구성은 존재하지만, 조사된 저장소 정책상 Python/Alembic이 유일한 migration authority이고 Drizzle config는 활성 migration directory가 아니다. 따라서 도구 교체는 Alembic 이력을 새 도구가 이어받는 방식보다 아래의 명시적 cutover로 해야 한다.

1. Alembic head를 하나로 정리하고, 대상 PostgreSQL 스키마를 기준선으로 확정한다.
2. 새 도구의 baseline을 만들어 기존 변경분을 다시 실행하지 않게 한다.
3. 이후 변경만 새 선형 디렉터리에 추가하고, Alembic과 새 도구를 같은 DB에 병행 적용하지 않는다.
4. CI에서 “단일 이력 체인” 검사를 추가하고, 배포 Job에는 DB lock·timeout·적용 결과 로그를 남긴다.

### 근거

- Kysely migration: [공식 문서](https://www.kysely.dev/docs/migrations), [PostgreSQL adapter의 advisory lock 구현](https://github.com/kysely-org/kysely/blob/f24018c789c3cf7ad03ccc672ada63a1ded87f88/src/dialect/postgres/postgres-adapter.ts#L6-L39)
- Prisma: [`migrate deploy` 문서](https://www.prisma.io/docs/cli/migrate/deploy), [migration squash 워크플로](https://docs.prisma.io/docs/v6/orm/prisma-migrate/workflows/squashing-migrations)
- Drizzle: [migrate 문서](https://orm.drizzle.team/docs/drizzle-kit-migrate), [병렬 journal 충돌 이슈](https://github.com/drizzle-team/drizzle-orm/issues/5774#L160-L170)
- Atlas: [directory integrity](https://atlasgo.io/concepts/migration-directory-integrity), [versioned apply](https://atlasgo.io/versioned/apply)
- Flyway/Liquibase/Sqitch: [Flyway versioned migrations](https://documentation.red-gate.com/flyway/flyway-concepts/migrations/versioned-migrations), [Liquibase lock](https://docs.liquibase.com/secure/user-guide-5-1-1/what-is-the-database-changelog-lock-table), [Sqitch plan concurrency](https://sqitch.org/docs/manual/sqitchtutorial/#L987-L1027)

# TypeScript DB 마이그레이션 조사

| 요구 항목 | workers | 상태 |
| --- | --- | --- |
| Alembic multi-head를 대체하거나 줄이는 병합 모델 | 0 (unresolvable; Wave 1 aggregate, Wave 2 axis-less) | uncovered: expansion-log에 축별 작업자 귀속이 없어 해당 축의 자료 수집을 확정할 수 없음 |
| TypeScript 진영의 쓸 만한 라이브러리/도구 비교 | 0 (unresolvable; Wave 1 aggregate, Wave 2 axis-less) | uncovered: expansion-log에 축별 작업자 귀속이 없어 해당 축의 자료 수집을 확정할 수 없음 |
| 배포와 함께 안전하게 실행하는 방법 | 0 (unresolvable; Wave 1 aggregate, Wave 2 axis-less) | uncovered: expansion-log에 축별 작업자 귀속이 없어 해당 축의 자료 수집을 확정할 수 없음 |
| 롤백 없이 forward-only로 운영하는 방법 | 0 (unresolvable; Wave 1 aggregate, Wave 2 axis-less) | uncovered: expansion-log에 축별 작업자 귀속이 없어 해당 축의 자료 수집을 확정할 수 없음 |
| 현재 Acme의 Python + Drizzle + 배포 제약과의 적합성 | 0 (unresolvable; Wave 1 aggregate, Wave 2 axis-less) | uncovered: expansion-log에 축별 작업자 귀속이 없어 해당 축의 자료 수집을 확정할 수 없음 |

## 목차

1. 결론과 병합 모델
2. TS 및 SQL 마이그레이션 도구 비교
3. Acme 현재 상태와 의사결정
4. 권장 운영 설계
5. 선택하지 않는 후보와 한계

## 1. 결론과 병합 모델

“동시 브랜치의 DB 변경을 Git처럼 자동으로 의미 병합”해 주는 주류 도구는 확인하지 못했습니다. Alembic의 multi-head는 DAG를 허용한 결과이고, 다른 도구는 대개 그 DAG를 없애고 **한 줄짜리 migration history**로 바꿉니다. 즉 충돌을 자동 해결하는 대신 main에 합치기 전에 migration 파일 충돌·순서를 CI와 merge queue에서 해결하게 만드는 방식입니다. 이게 운영에서는 더 예측 가능합니다. [SYNTHESIS §1](SYNTHESIS.md)

사용자 조건(배포 시 함께 실행, rollback은 중요하지 않음, PostgreSQL)을 기준으로 한 1순위는 **Flyway Community를 별도 migration Job으로 실행**하는 구성입니다. TS 라이브러리는 아니지만 SQL-first이고, Java/CLI Docker image로 어떤 Node/Python 서비스와도 분리해 붙일 수 있습니다. versioned SQL을 한 번씩 순서대로 적용하고, 같은 대상 DB에서 runner를 잠그므로 Alembic head DAG와 app replica 동시 실행 문제를 모두 단순화합니다. [Flyway versioned migrations](https://documentation.red-gate.com/flyway/flyway-concepts/migrations/versioned-migrations), [Flyway target locking](https://documentation.red-gate.com/flyway/deploying-database-changes-using-flyway/rolling-out-updates-from-a-single-schema-to-multiple-production-databases)

다만 Flyway도 “두 브랜치가 같은 column을 다르게 바꿨다”는 의미 충돌을 알아서 풀지는 못합니다. 그런 PR은 반드시 사람이 합쳐야 하고, 그 결과를 하나의 forward migration으로 main에 넣어야 합니다.

## 2. TS 및 SQL 마이그레이션 도구 비교

| 후보 | 배포 동시성 | 브랜치 병합 | 현재 조건에서의 판단 |
| --- | --- | --- | --- |
| **Flyway Community** | DB history lock (JDBC/CLI) | 선형 history, 자동 의미 병합 없음 | **권장**: SQL-first·forward-only·전용 Job에 적합 |
| **Kysely 0.29.5** | PostgreSQL advisory lock 내장 | `allowUnorderedMigrations`는 순서 검사 완화일 뿐 | TS-native 중 가장 탄탄하지만 Drizzle와 별도 stack |
| **Drizzle Kit 0.45.2** | 내장 DB lock 미확인 | CI 직렬화·parent 기준 재생성 필요 | 기존 ORM 유지에는 편하지만 단독 채택 비권장 |
| **Atlas** | Pro 문서상 advisory lock | checksum/rebase workflow, semantic merge 없음 | Drizzle 연계는 훌륭하나 rebase/lock의 무료 보장 없음 |
| **Prisma Migrate** | 문서상 advisory lock | lexical stream, divergence 수동 처리 | Prisma ORM 전환까지 필요해 현재엔 과함 |
| **Sqitch** | target lock | `sqitch.plan` 자체가 merge conflict 가능 | dependency/drift 장점은 있으나 Perl·revert 관리 비용 |
| Knex / TypeORM / dbmate / Umzug | 후보마다 외부 lock 필요 또는 제한적 | 모두 선형 ledger | 현재보다 뚜렷한 이점 없음 |

### TS-native로 반드시 가야 한다면

**Kysely migrator**가 가장 좋은 기본 primitive입니다. PostgreSQL adapter가 session advisory lock을 잡고, migration 실행 중에는 DB connection 단위로 직렬화됩니다. 하지만 이것은 SQL 충돌 merge가 아니라 “두 deploy가 동시에 apply하지 않음”을 보장하는 기능입니다. Drizzle를 계속 query ORM으로 쓸 수는 있어도, migration만 Kysely로 두면 DB schema DSL/connection policy가 둘이 됩니다. 마이그레이션만을 위해 도입할 이유가 충분한지 먼저 검토해야 합니다. [Kysely migration docs](https://kysely.dev/docs/migrations#running-migrations), [pinned PostgreSQL adapter](https://raw.githubusercontent.com/kysely-org/kysely/v0.29.5/src/dialect/postgres/postgres-adapter.ts#L15-L35)

**Drizzle Kit**은 현재 의존성이 이미 있으므로 가장 손쉬워 보이지만, 검증한 `drizzle-orm@0.45.2` PostgreSQL migrator에는 advisory lock이 없습니다. 전용 migration Job 하나만 실행하도록 만들거나 별도 advisory-lock wrapper를 구현해야 합니다. 또한 parallel generation 충돌은 도구가 아닌 merge workflow로 통제해야 합니다. [pinned Drizzle migrator](https://raw.githubusercontent.com/drizzle-team/drizzle-orm/0.45.2/drizzle-orm/src/pg-core/dialect.ts#L70-L107)

## 3. Acme 현재 상태와 의사결정

현재 검증 가능한 backend worktree에서는 Python/Alembic이 실제 migration authority이고, Drizzle은 output 설정만 있으며 migration directory·실행 script가 없습니다. 배포도 Python migration 성공 뒤 backend deploy가 진행됩니다. 지금 Alembic graph는 실행 검증에서 head 하나(`000000aaaaaa`)였지만, 단일 head를 강제하는 CI와 merge revision의 존재는 concurrent branch가 반복적으로 관리 비용을 만든다는 신호입니다. [SYNTHESIS §3](SYNTHESIS.md)

그러므로 권장 순서는 다음입니다.

1. 먼저 **migration SSOT를 Python에 계속 둘지, SQL migration repository/package로 옮길지** 결정합니다.
2. Python과 Node가 같은 PostgreSQL 테이블을 계속 공유한다면, 두 쪽이 migration을 각각 생성하는 구조는 만들지 않습니다.
3. SQL-first SSOT로 옮기기로 결정했을 때 Flyway를 적용합니다. Node/Drizzle와 Python SQLAlchemy는 새 SQL migration을 소비하는 쪽이 됩니다.
4. “Node/TS가 schema를 완전히 소유”하기로 결정했을 때에만 Drizzle 또는 Kysely 기반 migration stream을 검토합니다.

이 결정을 건너뛰고 Alembic만 Drizzle Kit으로 바꾸면, 기존 Python model과 Drizzle schema의 source-of-truth 충돌이 더 커질 가능성이 있습니다.

## 4. 권장 운영 설계

### 기본안: Flyway Community + 기존 배포 순서 유지

현재의 `migration → backend deploy → verify` 경계는 유지합니다. Alembic worker를 Flyway container/CLI를 실행하는 **전용 migration job 하나**로 바꾸고, 성공해야 app rollout을 허용합니다. 앱 startup이나 모든 replica에서 migration을 실행하지 않습니다.

```text
PR: migration SQL 추가 → clean PostgreSQL에서 validate/migrate/test
            ↓
main merge queue: migration 파일을 하나의 선형 순서로 확정
            ↓
deploy: singleton Flyway migrate job (DB history lock)
            ↓ 성공일 때만
backend rollout → verify
```

운영 규칙은 네 가지면 충분합니다.

- migration 파일은 main에 merge된 뒤 immutable; 실수는 새 forward migration으로 고칩니다.
- `outOfOrder`는 production에서 기본값(false)로 유지합니다. 늦게 합쳐진 migration을 조용히 실행하지 않습니다.
- PR CI는 빈 PostgreSQL에 전체 history를 replay하고, 최신 main에서 migration 순서·checksum을 검증합니다.
- zero-downtime 변경은 expand → application dual-read/write/backfill → contract 순서로 합니다. rollback을 하지 않는다면 이 규칙이 특히 중요합니다.

`CREATE INDEX CONCURRENTLY`처럼 transaction 밖에서만 가능한 PostgreSQL DDL은 일반 migration과 분리해 tool의 transaction 설정과 실패 복구 절차를 명시해야 합니다. [Flyway transaction handling](https://documentation.red-gate.com/fd/migration-transaction-handling-273973399.html)

### Atlas를 택하는 경우

Drizzle schema export를 기반으로 diff/generate를 하고 migration directory integrity까지 원한다면 Atlas가 제일 가까운 조합입니다. 하지만 `atlas.sum` conflict는 자동 merge가 아니라 “merge/rebase가 필요함을 강제하는 장치”입니다. Community에는 `migrate rebase`가 없고 apply locking도 Pro 문서에 있으므로, 비용을 승인할 때만 Atlas workflow를 선택하는 편이 정확합니다. [Atlas integrity](https://atlasgo.io/concepts/migration-directory-integrity), [Atlas Community limits](https://atlasgo.io/community-edition), [Atlas apply](https://atlasgo.io/versioned/apply)

## 5. 선택하지 않는 후보와 한계

- **Prisma Migrate**: deploy lock은 장점이지만 Prisma schema/ORM 전환이 필요하고, branch migration history는 여전히 사람이 reconcile해야 합니다. lock 상세은 v6 docs 기준이라 Prisma 7 engine까지 직접 검증한 사실은 아닙니다. [Prisma workflow](https://www.prisma.io/docs/orm/v6/prisma-migrate/workflows/development-and-production)
- **Sqitch**: explicit dependency, hash drift check, target lock은 좋지만 central plan 파일을 merge해야 하고 Perl CLI와 revert scripts를 계속 관리합니다. 자동 Git merge 해법은 아닙니다. [Sqitch tutorial](https://sqitch.org/docs/manual/sqitchtutorial-sqlite/)
- **Alembic 유지 + process 강화**: 가장 낮은 전환비용 대안입니다. merge queue 전에 `alembic heads`를 단일 head로 만들도록 PR merge gate를 옮기고, deploy는 현 구조처럼 singleton worker로만 실행합니다. 그러나 merge revision/no-op merge 비용은 계속 남습니다.

### 최종 선택

“TS여야 한다”가 절대 조건이 아니라면 **Flyway Community**를 권합니다. 지금의 Python/Node 이중 모델에서 migration만 공용 SQL artifact로 만들 수 있고, rollback 불필요·배포 동시 실행·선형 history 요구에 가장 잘 맞습니다.

“TS package가 절대 조건”이라면 **Kysely migrator**가 실행 안전성 면에서 최선이지만, 도입 전에 Drizzle와 migration SSOT를 어떻게 분리할지 설계해야 합니다. **Drizzle Kit 단독**은 lock과 병합 문제 때문에 지금의 고충을 끝내지 못합니다.

검증 근거와 version caveat은 [SYNTHESIS.md](SYNTHESIS.md), claim별 검증 상태는 [claim-graph.md](claim-graph.md)에 있습니다.

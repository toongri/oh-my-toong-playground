# 후보 비교

## 결론

알고케어의 현 조건에서는 **Kysely Migrator를 전용 마이그레이션 러너로 채택하고, Git 병합과 DB 적용을 분리한 선형화 정책을 두는 안**이 가장 현실적이다. PostgreSQL advisory lock과 기본 트랜잭션 실행을 제공하므로 배포 시 단일 마이그레이션 Job으로 안전하게 실행할 수 있다. 다만 `allowUnorderedMigrations`는 파일 순서 검증을 완화할 뿐, 충돌하는 DDL을 자동 병합하지는 않는다. 즉 Alembic의 multi-head를 다른 도구로 옮겨도 **Git 같은 의미 기반 자동 병합은 얻을 수 없으며**, 충돌 해결 책임은 PR 병합 단계에 남는다. [wave-1.md](wave-1.md)

현재 배포는 이미 `migration → backend deploy → verification` 순서이며 환경별 backend 배포도 직렬화한다. 따라서 도구 교체의 핵심은 배포 파이프라인을 새로 만드는 일이 아니라, DB advisory lock을 가진 단일 러너와 병합 규칙을 붙이는 일이다. [wave-1.md](wave-1.md)

> "Kysely Migrator: TypeScript-native; PostgreSQL adapter uses advisory lock and runs transactionally by default."
>
> — [wave-1.md](wave-1.md)

## 비교 기준

- **TS 적합성**: 애플리케이션 코드와 같은 TypeScript 생태계에서 운용 가능한가
- **배포 동시성 안전성**: PostgreSQL DB 수준 lock으로 중복 실행을 막는가
- **병렬 브랜치 처리**: 여러 PR의 migration이 합쳐질 때 파일/이력 충돌을 어떻게 드러내고 해소하는가
- **현재 환경 적합성**: Drizzle이 이미 존재하지만 Alembic이 migration authority인 현재 상태에서의 도입 비용

## 후보 요약

| 후보 | TS 적합성 | 배포 동시성 | 병렬 브랜치·병합 | 현재 조건에서의 판단 |
| --- | --- | --- | --- | --- |
| **Kysely Migrator** | TS-native | PostgreSQL advisory lock + 기본 트랜잭션 | 기본은 순서 있는 migration. `allowUnorderedMigrations`는 순서 거부를 완화하지만 DDL 충돌은 사람이 해결 | **1순위**: 필요한 안전장치가 내장되어 있고, 별도 유료 기능 없이 전용 runner로 도입 가능 |
| **Atlas** | TS library라기보다 schema/migration CLI; Drizzle external schema 호환 | PostgreSQL advisory lock | `atlas.sum`이 분기된 migration directory를 의도적으로 merge conflict로 만듦. 선형화 위해 rebase/rehash 필요 | 팀이 migration-directory integrity를 강하게 원할 때 유력. 다만 `migrate rebase`는 OSS/Community에 없고 Pro 필요 |
| **Prisma Migrate** | TS-native | PostgreSQL advisory lock, `migrate deploy`는 CI/CD용 | lexical file order. branch history 충돌은 rebase/squash를 수동 수행 | Prisma ORM 채택까지 감수할 때만 고려. 현 Drizzle/Alembic 경로의 직접 대체로는 과함 |
| **Flyway Community** | TS-native 아님; SQL/CLI | DB lock, Docker/CI 적합 | immutable linear history. `outOfOrder`는 의미 기반 branch merge가 아님 | ORM 독립 SQL migration을 우선할 때 안정적 대안. TS 통일성은 포기 |
| **Liquibase** | TS-native 아님 | `DATABASECHANGELOGLOCK` | changelog ordering이며 Git DAG merge는 아님 | 복잡한 changelog 기능이 필요할 때만. 이 문제에는 무거운 편 |
| **Knex** | TS-friendly | built-in DB lock | linear filename ledger, DAG merge 없음 | 단순하고 익숙한 선택지이나 Kysely보다 branch 문제 해결력이 크지 않음 |
| **Drizzle Kit** | TS-native | 확인된 PostgreSQL migrator source에는 transaction은 있으나 advisory lock 없음 | 병렬 generation에서 journal/index collision 위험; parent baseline에서 regenerate 권고 | **비추천**: 현 핵심 고장 모드인 동시성·branch 충돌을 줄이지 못함 |
| **Sqitch** | Perl/SQL CLI, Drizzle 통합 없음 | target/advisory lock | dependency metadata는 있으나 중앙 append-only plan에서 Git conflict 발생, 순서는 사람이 확인 | 의존성 명시가 절대적으로 중요할 때만. TS stack에는 부적합 |
| **TypeORM / Umzug / dbmate** | 각기 TS-friendly 또는 CLI | 조사 경로상 PostgreSQL distributed lock 기본 제공 없음 | linear/timestamp 중심, 자동 의미 병합 없음 | dedicated Job과 외부 lock을 추가해야 하므로 우선순위 낮음 |

비교 근거는 [wave-1.md](wave-1.md)와 [wave-2.md](wave-2.md)의 공식 문서·소스 조사 결과다. `SYNTHESIS.md`는 이 디렉터리에 제공되지 않았으므로, 검증 backing을 가리키는 별도 인용은 만들지 않고 저널 원문만 인용했다.

## 권고안: Kysely + 선형화 정책

Kysely를 선택해도 migration을 자동으로 "병합"해 주지는 않는다. 운영 정책을 다음처럼 두어야 multi-head류의 배포 실패를 제거할 수 있다.

1. 모든 schema 변경은 단조 증가 migration ID를 사용하고, main에 병합되기 전 최신 main을 기준으로 migration을 재생성/재정렬한다.
2. CI는 migration 디렉터리의 중복 ID, 순서 역전, 동일 객체를 동시에 변경하는 DDL을 검출해 병합 전에 실패시킨다.
3. 배포에는 backend pod 기동과 분리된 singleton migration Job을 둔다. Kysely의 PostgreSQL advisory lock이 실제 최종 방어선이 되도록 하고, Job은 성공 후에만 backend 배포를 진행한다.
4. 실패한 migration은 rollback 대신 새 forward-fix migration으로만 복구한다. 이는 사용자가 전제한 "DB 롤백은 하지 않는다"는 운영 방식과 맞는다.

여기서 1–3은 조사 결과의 제약에서 도출한 운영 방법론이다. 특히 unordered 허용은 충돌 DDL을 해결하지 못하며, Atlas와 Sqitch도 각각 directory/plan 충돌을 사람에게 노출한다. 따라서 도구 선택보다 **병합 전 선형화와 DB lock을 모두 강제하는 것**이 핵심이다. [wave-1.md](wave-1.md) [wave-2.md](wave-2.md)

## 후보별 상세

### Kysely Migrator — 권고

- PostgreSQL adapter가 advisory lock을 사용하고 기본값으로 transaction 안에서 실행한다. 배포가 겹쳐도 DB 한 곳에서 적용 순서를 직렬화할 수 있다. [wave-1.md](wave-1.md)
- `allowUnorderedMigrations`는 merge-base가 다른 feature branch의 순서 문제를 다루는 선택지이지만, 두 migration이 같은 table/column을 양립 불가능하게 바꾸는 경우까지 해결하지 않는다. [wave-1.md](wave-1.md)
- 현 repository의 migration authority가 Alembic이므로, 도입 시에는 authority를 한 번에 Kysely로 이관하고 Drizzle은 schema synchronization 용도로 분리해 유지할지 결정해야 한다. 저널은 현재 Drizzle config가 활성 migration directory가 아닌 "latent" 상태라고 기록한다. [wave-1.md](wave-1.md)

### Atlas — integrity를 우선하면 검토

- Atlas는 Drizzle external schema를 지원하고 PostgreSQL advisory lock을 제공한다. [wave-1.md](wave-1.md)
- `atlas.sum`의 목적은 divergent migration directory 변경을 숨기지 않고 Git merge conflict로 만드는 것이다. 이것은 자동 merge가 아니라, 누락/순서 오류를 조기에 발견하는 안전장치다. [wave-1.md](wave-1.md)
- 팀의 병합 흐름을 `rebase → rehash → merge`로 표준화해야 한다. 단, 공식 `migrate rebase`는 Community/OSS에서 쓸 수 없어 Pro 비용이 발생한다. [wave-1.md](wave-1.md)

### Prisma Migrate·Knex — 가능하지만 직접적 이점이 제한적

- Prisma Migrate는 `migrate deploy`와 PostgreSQL advisory lock이 있어 CI/CD 실행은 편하다. 그러나 migration file은 lexical order이고 branch history 충돌은 rebase/squash로 수동 정리한다. [wave-1.md](wave-1.md)
- Knex도 built-in DB lock을 제공하지만 filename 기반 선형 ledger라 DAG 병합을 제공하지 않는다. [wave-1.md](wave-1.md)
- 따라서 두 후보 모두 "배포 중 중복 실행"은 완화하지만 "여러 브랜치가 쌓이며 생기는 migration 충돌"은 정책으로 풀어야 한다.

### Flyway·Liquibase — SQL migration 도구로는 안정적

- Flyway Community는 immutable linear SQL history, DB lock, Docker/CI 적합성을 제공하며 forward-only 운영에 유료 기능이 필요하지 않다. [wave-1.md](wave-1.md)
- Liquibase도 `DATABASECHANGELOGLOCK`을 제공한다. [wave-1.md](wave-1.md)
- 둘 다 TS 라이브러리는 아니고 Git DAG를 의미적으로 병합하지 않는다. ORM으로부터 독립된 SQL migration을 원하는 경우에만 Kysely보다 우선할 이유가 생긴다.

### Drizzle Kit·Sqitch·기타 — 현 문제의 1차 해법으로는 제외

- Drizzle Kit은 transaction은 사용하지만, 조사한 PostgreSQL migrator에는 advisory lock이 없다. migration generation의 journal/index 충돌도 별도 위험이다. [wave-1.md](wave-1.md)
- Sqitch는 dependency-aware이나 중앙 `sqitch.plan`이 append-only라 concurrent branch addition이 Git conflict를 만들며, 해결 뒤 순서는 사람이 확인해야 한다. [wave-2.md](wave-2.md)
- TypeORM, Umzug, dbmate는 조사 범위에서 기본 PostgreSQL distributed migration lock을 제공하지 않았다. 외부 lock과 dedicated migration Job을 추가해야 한다. [wave-1.md](wave-1.md)

## 검증 한계

- 본 문서는 제공된 wave-1/2 저널의 조사 결과만 종합했다. 새 라이브러리를 실제 repository와 PostgreSQL 버전에 설치·실행해 검증한 결과는 아니다.
- `SYNTHESIS.md`와 claim graph가 제공되지 않아, 이 문서의 판단은 해당 저널이 수집한 공식 문서 및 소스 링크를 재검증한 확정 claim이 아니라, 저널 근거의 후보 비교다.

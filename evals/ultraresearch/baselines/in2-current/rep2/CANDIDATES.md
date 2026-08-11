## 후보 비교

### 결론

가장 적합한 1차 후보는 **Kysely Migrator**다. TypeScript에서 운영할 수 있고 PostgreSQL advisory lock과 기본 트랜잭션을 제공하며, `allowUnorderedMigrations`로 서로 다른 브랜치에서 추가된 마이그레이션의 파일명 순서 충돌을 완화한다. 다만 이것은 Alembic의 multi-head를 Git처럼 자동 병합하는 기능이 아니다. 충돌하는 DDL의 의미를 자동으로 합칠 수 있는 후보는 조사 범위에 없었으므로, **DB에는 단일 적용 이력, Git에는 명시적 rebase/충돌 해결**이라는 운영 정책은 여전히 필요하다.

현재 배포 흐름도 이 선택과 맞는다. 저널은 이미 “migration → backend deploy → verification” 순서이며 환경별 backend 배포가 직렬화돼 있다고 기록한다. 즉 전용 migration Job을 그 자리에 두고, 도구의 DB lock을 최종 안전장치로 삼는 구조가 적절하다.[^w1-deploy]

> “Kysely Migrator: TypeScript-native; PostgreSQL adapter uses advisory lock and runs transactionally by default. `allowUnorderedMigrations` avoids default prefix-order rejection but cannot resolve conflicting DDL.”[^w1-kysely]

검증 백킹: 이 작업 디렉터리에는 `SYNTHESIS.md`가 제공되지 않아, 아래 평가는 원문 저널 `wave-1.md`와 `wave-2.md`의 조사 결과를 직접 인용·정리했다.

### 비교 기준

- **TS 적합성**: 애플리케이션과 같은 TypeScript/Node 배포 경로에서 관리 가능한가
- **동시 배포 안전성**: PostgreSQL DB-level lock으로 중복 실행을 막는가
- **브랜치 병합 마찰**: 병렬로 추가된 migration의 순서 충돌을 얼마나 줄이는가
- **forward-only 운영**: 롤백 없이 변경을 누적하는 팀 운영에 부담이 적은가

| 후보 | TS 적합성 | DB-level lock / 배포 실행 | 브랜치 병합 마찰 | 판단 |
|---|---|---|---|---|
| **Kysely Migrator** | TS-native | PostgreSQL advisory lock, 기본 트랜잭션 | `allowUnorderedMigrations`로 파일 prefix 순서 거부를 피할 수 있음. 단, DDL 충돌은 사람이 해결 | **권장** — TS-native 후보 중 동시 실행 안전성과 순서 유연성의 균형이 가장 좋음 |
| **Prisma Migrate** | TS-native | `migrate deploy`는 CI/CD용이며 PostgreSQL advisory lock 사용 | 파일은 lexical order이고, 브랜치 충돌은 rebase/squash를 수동 처리 | Prisma를 이미 표준 ORM으로 쓴다면 유력. 현재 문제를 “자동 병합”으로 해결하지는 못함 |
| **Atlas** | Drizzle 외부 스키마와 호환 | PostgreSQL advisory lock | `atlas.sum`이 분기된 디렉터리 변경을 의도적으로 Git conflict로 만듦. rebase/rehash가 필요하며 `migrate rebase`는 OSS에서 불가 | 강한 무결성 검증이 필요할 때 검토. 무료로 병합 마찰을 줄이는 해법은 아님 |
| **Flyway Community** | TS 라이브러리는 아니나 SQL/컨테이너 기반으로 Node 배포와 함께 실행 가능 | DB lock, Docker/CI 적합 | immutable linear history. `outOfOrder`도 의미적 branch merge는 아님 | TS 종속성이 꼭 필요 없고 SQL migration을 독립 운영하고 싶다면 **차선책**. forward-only는 무료로 가능 |
| **Sqitch** | Perl/SQL CLI, TS/Drizzle 통합 아님 | PostgreSQL target/advisory lock, `check`/`verify` 제공 | 의존성 메타데이터는 있지만 중앙 append-only `sqitch.plan`의 동시 수정은 Git conflict이고 사람이 순서를 확인해야 함 | 의존성 검증이 특별히 중요할 때만. multi-head의 근본 해소책은 아님 |
| **Drizzle Kit** | TS-native, 현재 저장소에 설치됨 | 조사된 PostgreSQL migrator에는 트랜잭션은 있으나 advisory lock 없음 | 병렬 생성 시 journal/index collision; parent baseline에서 재생성 권고 | **비권장** — 현재 문제인 동시성/병합 마찰과 정면으로 겹침 |
| **Knex** | TS-friendly | built-in DB lock | 선형 filename ledger, branch DAG merge 없음 | 단순한 전통적 선택지. Kysely보다 이 문제에 유리한 근거 없음 |
| **Liquibase** | TS-native 아님 | `DATABASECHANGELOGLOCK` | changelog 순서 모델일 뿐 Git DAG merge 아님 | 조직 차원의 다언어 DB 표준화가 필요할 때만 |
| **TypeORM / Umzug / dbmate** | TS-friendly 또는 CLI | 조사 경로상 PostgreSQL distributed lock을 기본 제공하지 않음 | 선형/수동 운영 | 전용 migration Job과 외부 lock을 별도로 설계해야 해 우선순위 낮음 |

### 후보별 근거

#### 1. Kysely Migrator — 권장

Kysely는 `allowUnorderedMigrations`를 제공하므로, 적용되지 않은 migration 파일이 기존 파일명 prefix보다 뒤에 있어야 한다는 기본 제약을 완화할 수 있다. 이 점이 병렬 브랜치에서 새 migration이 계속 생기는 상황에 가장 직접적으로 대응한다. 또한 PostgreSQL advisory lock과 기본 트랜잭션이 있어, 이미 직렬화된 배포 파이프라인 밖에서 중복 실행이 생겨도 DB 수준에서 방어한다.[^w1-kysely]

운영 규칙은 다음이면 충분하다.

1. migration은 별도 CI/Argo Job에서 Kysely Migrator로 한 번만 실행한다.
2. additive DDL은 unordered migration을 허용한다.
3. 같은 테이블/컬럼을 바꾸는 migration은 PR 단계에서 명시적으로 rebase하고 하나의 순서를 정한다.
4. production rollback은 하지 않고, 실패한 변경은 새 forward migration으로 보정한다.

그러나 두 branch가 같은 컬럼을 서로 다른 타입으로 바꾸는 등의 DDL 충돌은 `allowUnorderedMigrations`의 해결 범위 밖이다. 저널도 이 옵션이 “cannot resolve conflicting DDL”이라고 명시하므로, 이런 충돌은 사람이 해결해야 한다.[^w1-kysely]

#### 2. Prisma Migrate — Prisma 채택 시에만

Prisma는 배포용 `migrate deploy`와 PostgreSQL advisory lock을 제공한다.[^w1-prisma] 다만 저널의 조사 결과는 분명하다.

> “migrations are lexically ordered files and branch history conflicts require manual rebase/squash.”[^w1-prisma]

따라서 배포 실패의 원인이 **동시 실행**이면 좋은 해법이지만, 원인이 **병렬 branch의 migration history**이면 Kysely보다 해결 범위가 넓지 않다. 현재 Drizzle이 설치돼 있고 Python/Alembic이 migration authority라는 저장소 현실을 고려하면, 이 문제 하나 때문에 Prisma ORM까지 도입할 이유는 약하다.[^w1-repo]

#### 3. Atlas — 무결성 통제에는 강하지만, 무료 병합 편의는 부족

Atlas는 migration directory의 무결성을 강하게 통제한다. 하지만 그 방식은 자동 병합이 아니라 `atlas.sum` 충돌을 의도적으로 드러내고 팀이 rebase/rehash하도록 강제하는 것이다. 또한 OSS/community 빌드에서 `migrate rebase`를 사용할 수 없다.[^w1-atlas] 즉 “충돌을 숨기지 않는” 장점은 있지만, 사용자가 원하는 지속적 병렬 작업의 마찰을 낮추는 무료 해법으로는 맞지 않는다.

#### 4. Flyway Community — TS 비종속 SQL 표준의 현실적 대안

Flyway Community는 언어 독립적이고 immutable linear SQL history, database lock, Docker/CI 실행 적합성을 제공한다. forward-only 운영에는 유료 기능이 필요하지 않다.[^w1-flyway] TypeScript library여야 한다는 요구를 완화할 수 있고 migration을 앱 ORM에서 분리하고 싶다면 Kysely 다음 후보가 된다. 다만 `outOfOrder`도 branch의 DDL을 의미적으로 병합하지는 않는다.[^w1-flyway]

#### 5. Sqitch — dependency-aware이지만 중앙 계획 파일 병합이 필요

Sqitch는 dependency metadata와 `check`/`verify`가 장점이지만, 중앙 append-only plan을 갖는다. 저널의 튜토리얼 조사 결과처럼 동시 branch 추가는 `sqitch.plan` Git conflict를 만들고, 해결 뒤에도 사람이 순서를 확인해야 한다.[^w2-sqitch] 따라서 Alembic multi-head보다 모델은 명시적일 수 있어도, “Git처럼 잘 병합”되는 도구로 분류하면 안 된다.

#### 제외 근거

Drizzle Kit은 현재 TypeScript 의존성에는 가장 가까워 보이지만, PostgreSQL advisory lock이 확인되지 않았고 병렬 generation에서 journal/index collision 위험이 기록돼 있다.[^w1-drizzle] 이는 현재 Alembic에서 겪는 경합과 배포 실패의 위험 모델과 맞닿아 있어, migration authority로 바꾸는 후보로는 부적합하다. Knex는 lock은 있으나 선형 ledger이며, TypeORM/Umzug/dbmate는 조사된 경로에서 PostgreSQL distributed migration lock을 기본 제공하지 않는다.[^w1-other]

### 권장 전환안

1. Alembic을 즉시 제거하지 말고, 새 TypeScript 서비스의 migration authority 후보로 **Kysely Migrator**를 작은 PostgreSQL 환경에서 검증한다.
2. 배포의 기존 migration 단계에 singleton Job을 연결하고, Kysely advisory lock을 유지한다. 파이프라인의 직렬화는 편의 장치이고 DB advisory lock은 최종 동시성 보장으로 취급한다.[^w1-deploy][^w1-kysely]
3. PR 규칙을 “migration은 append-only, unordered 허용, 동일 DB 객체 변경은 명시적 rebase/순서 합의”로 문서화한다.
4. 충분히 안정화된 뒤 Alembic 신규 revision 생성을 중단하고, 기존 Alembic history는 보존한 채 cutover 시점의 schema baseline을 한 번 만든다. 이 baseline/cutover 절차의 세부 검증은 제공된 저널 범위 밖이다.

[^w1-repo]: `wave-1.md`, “Target-repository reality”: 현재 `drizzle-orm`/`drizzle-kit`은 설치돼 있지만 “Python/Alembic is the only migration authority and Drizzle is schema synchronization only”라고 기록됨.
[^w1-deploy]: `wave-1.md`, “Target-repository reality”: migration → backend deploy → verification 순서, 환경별 backend 배포 직렬화 및 migration dispatch 1회 재시도.
[^w1-kysely]: `wave-1.md`, “Tool findings — Kysely Migrator”.
[^w1-prisma]: `wave-1.md`, “Tool findings — Prisma Migrate”.
[^w1-drizzle]: `wave-1.md`, “Tool findings — Drizzle Kit”.
[^w1-atlas]: `wave-1.md`, “Tool findings — Atlas”.
[^w1-flyway]: `wave-1.md`, “Tool findings — Flyway Community”.
[^w1-other]: `wave-1.md`, “Tool findings — Knex” 및 “TypeORM / Umzug / dbmate”.
[^w2-sqitch]: `wave-2.md`, 전체 “expansion: Sqitch” 조사 결과.

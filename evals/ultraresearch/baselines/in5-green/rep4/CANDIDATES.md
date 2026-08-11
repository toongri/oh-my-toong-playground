# 후보 비교 — TypeScript DB 마이그레이션

## 결론

**권장안은 Kysely Migrator를 전용 migration Job에서 실행하고, 모든 브랜치의 migration을 단일 선형 이력으로 rebase/정렬하는 운영 규칙을 두는 것이다.** PostgreSQL advisory lock과 기본 트랜잭션 실행이 배포 동시성 실패를 직접 줄이며, 현재 요구(롤백 비중 낮음)에 맞는다. 다만 **Git처럼 DDL을 의미적으로 자동 병합하는 도구는 조사된 후보에 없었다.** 락은 배포 시점의 동시 실행을 막고, 선형 이력 규칙은 병합 시점의 충돌을 사람이 해결하게 한다. 둘은 별개의 문제다.

> “Kysely Migrator: TypeScript-native; PostgreSQL adapter uses advisory lock and runs transactionally by default. `allowUnorderedMigrations` avoids default prefix-order rejection but cannot resolve conflicting DDL.” — [wave-1.md](wave-1.md)

검증 근거는 이 디렉터리에 제공된 [wave-1.md](wave-1.md), [wave-2.md](wave-2.md)이다. 이 작업 디렉터리에는 `SYNTHESIS.md`가 없어 해당 파일을 인용하거나 그 파일로 검증 상태를 뒷받침할 수 없다. 아래의 `unknown — not gathered`는 저널에 근거가 없는 항목을 채워 넣지 않은 결과다.

## 판단 기준

- **배포 동시성**: PostgreSQL DB-level lock과 migration 실행의 트랜잭션성.
- **브랜치 병합**: 다수 브랜치가 동시 migration을 추가할 때의 이력 모델과 충돌 처리.
- **도입 적합성**: Node 22/pnpm/TypeScript 환경, 현재 deploy 순서(migration → backend deploy → verification), 기존 Drizzle 사용 현실.
- **롤백**: 사용자는 필요성을 낮게 평가했지만, 후보별 기능 메모에는 별도로 남긴다.

현재 저장소에 대해 저널이 확인한 사실은 다음과 같다.

> “Python/Alembic is the only migration authority and Drizzle is schema synchronization only.”
>
> “Deploy order is already migration → backend deploy → verification; Argo serializes backend deploys per environment and retries migration dispatch once. A replacement must therefore be idempotent and use a database-level lock.” — [wave-1.md](wave-1.md)

따라서 라이브러리 교체만으로 Alembic multi-head를 없애지는 못한다. migration authority를 TS 쪽으로 하나로 정하고, CI에서 **병합 후 단 하나의 head/선형 순서인지 검사**한 뒤, Argo의 singleton migration Job에서 아래 후보 중 하나를 실행해야 한다.

## 후보 프로필

### 1. Kysely Migrator — 권장

| 필드 | 저널 근거 기반 내용 |
|---|---|
| 정확히 검토한 버전 | unknown — not gathered (저널은 `f24018c…` 소스 커밋과 공식 migration 문서만 기록) |
| 라이선스 | unknown — not gathered |
| 유지보수 신호 | unknown — not gathered |
| 동시성/락 | PostgreSQL adapter가 advisory lock을 사용하며, 기본적으로 트랜잭션 안에서 실행한다. |
| 이력/병합 모델 | 기본 순서 검사는 prefix 순서다. `allowUnorderedMigrations`로 그 거부는 완화할 수 있지만, 충돌하는 DDL을 해결하거나 DAG 병합을 하지는 못한다. |
| 기능 메모 | TypeScript-native. 롤백: unknown — not gathered; 사용자 요구상 결정 가중치는 낮음. |
| 판정 | **채택 권장.** 전용 Job + DB advisory lock으로 배포 경합을 막고, PR/merge 단계에서 선형 migration 규칙을 강제하는 조합이 가장 직접적이다. `allowUnorderedMigrations`를 Git 병합 기능으로 오해해서는 안 된다. |

저널 인용: “uses advisory lock and runs transactionally by default.” ([wave-1.md](wave-1.md); [PostgreSQL adapter](https://github.com/kysely-org/kysely/blob/f24018c789c3cf7ad03ccc672ada63a1ded87f88/src/dialect/postgres/postgres-adapter.ts#L6-L39), [migration docs](https://www.kysely.dev/docs/migrations)). 검증 backing: `SYNTHESIS.md` unavailable.

### 2. Prisma Migrate — 조건부 채택

| 필드 | 저널 근거 기반 내용 |
|---|---|
| 정확히 검토한 버전 | unknown — not gathered (저널은 Prisma v6 문서와 engine source commit `561d7b…`를 기록) |
| 라이선스 | unknown — not gathered |
| 유지보수 신호 | unknown — not gathered |
| 동시성/락 | `migrate deploy`는 CI/CD용 명령이며 PostgreSQL advisory lock을 쓴다. |
| 이력/병합 모델 | lexical-order 파일 이력이다. 브랜치 이력 충돌은 사람이 rebase/squash해야 한다. |
| 기능 메모 | TS-native. 롤백: unknown — not gathered; migration을 forward-only로 운영하면 이 항목은 비중이 낮다. |
| 판정 | **기존 데이터 접근 계층을 Prisma 중심으로 가져갈 의도가 있을 때만 조건부 채택.** 배포 락은 강점이나, 현 Drizzle 기반 환경에서 lock만을 위해 Prisma를 도입할 근거는 저널에 없다. multi-head의 의미적 자동 병합도 제공하지 않는다. |

저널 인용: “migrations are lexically ordered files and branch history conflicts require manual rebase/squash.” ([wave-1.md](wave-1.md); [migrate deploy](https://www.prisma.io/docs/cli/migrate/deploy), [squashing workflow](https://docs.prisma.io/docs/v6/orm/prisma-migrate/workflows/squashing-migrations)). 검증 backing: `SYNTHESIS.md` unavailable.

### 3. Drizzle Kit — 비권장

| 필드 | 저널 근거 기반 내용 |
|---|---|
| 정확히 검토한 버전 | `drizzle-kit` **0.31.5**; 함께 쓰인 `drizzle-orm` **0.44.5** |
| 라이선스 | unknown — not gathered |
| 유지보수 신호 | 저장소에서 위 버전을 사용 중이라는 사실 외에는 unknown — not gathered |
| 동시성/락 | 조사한 PostgreSQL migrator 소스에는 트랜잭션은 있으나 advisory lock은 없다. |
| 이력/병합 모델 | 병렬 생성 시 journal/index 충돌 위험이 문서화돼 있다. 상위 baseline에서 regenerate하는 방식이 안내되며, Git식 자동 병합은 아니다. |
| 기능 메모 | TS-native이며 운영상 가볍다. 현재 저장소에서도 Drizzle은 schema synchronization 용도다. 롤백: unknown — not gathered. |
| 판정 | **이 문제의 migration authority로는 비권장.** 현 저장소 친화성은 높지만, DB-level lock 부재와 병렬 생성 journal 충돌이 바로 해결하려는 실패 모드와 겹친다. |

저널 인용: “Parallel migration generation also has documented journal/index collision hazards; current advice is regenerate on the parent baseline.” ([wave-1.md](wave-1.md); [migrator source](https://github.com/drizzle-team/drizzle-orm/blob/273c78071d4841b497f5144734b38294df7ec64b/drizzle-orm/src/pg-core/dialect.ts#L2320-L2391), [issue #5774](https://github.com/drizzle-team/drizzle-orm/issues/5774#L160-L170)). 검증 backing: `SYNTHESIS.md` unavailable.

### 4. Knex — 차선책

| 필드 | 저널 근거 기반 내용 |
|---|---|
| 정확히 검토한 버전 | unknown — not gathered |
| 라이선스 | unknown — not gathered |
| 유지보수 신호 | unknown — not gathered |
| 동시성/락 | built-in DB lock이 있다. 어떤 DB/락 primitive인지는 unknown — not gathered. |
| 이력/병합 모델 | linear filename ledger이며 branch DAG merge는 없다. |
| 기능 메모 | TS-friendly. 롤백: unknown — not gathered. |
| 판정 | **차선책.** DB lock은 유리하지만 Kysely보다 이력 충돌에 대한 이점이 저널에서 확인되지 않았고, Git식 병합도 없다. |

저널 인용: “linear filename ledger with built-in DB lock; no branch DAG merge.” ([wave-1.md](wave-1.md); [Knex migration locks](https://knexjs.org/guide/migrations#notes-about-locks)). 검증 backing: `SYNTHESIS.md` unavailable.

### 5. Atlas — 비권장 (Community 기준)

| 필드 | 저널 근거 기반 내용 |
|---|---|
| 정확히 검토한 버전 | unknown — not gathered (소스 commit `9a6bc6…`만 기록) |
| 라이선스 | Community/OSS와 Pro 구분은 기록됐으나 정확한 라이선스는 unknown — not gathered |
| 유지보수 신호 | unknown — not gathered |
| 동시성/락 | PostgreSQL advisory lock을 사용한다. |
| 이력/병합 모델 | `atlas.sum`은 divergent migration-directory 변경을 의도적으로 merge conflict로 만든다. 선형 이력을 유지하려면 rebase/rehash해야 하며, Git식 자동 의미 병합이 아니다. |
| 기능 메모 | Drizzle-compatible external schema. `migrate rebase`는 OSS/Community에 없고 paid official/Pro가 필요하다. 롤백: unknown — not gathered. |
| 판정 | **Community 기준 비권장.** 락과 Drizzle 호환성은 좋지만, 현재 고통인 병렬 이력 충돌을 더 명시적으로 사람에게 돌려주며, 그 정리 명령은 유료다. |

저널 인용: “`atlas.sum` deliberately makes divergent migration-directory changes merge-conflict.” ([wave-1.md](wave-1.md); [directory integrity](https://atlasgo.io/concepts/migration-directory-integrity), [apply](https://atlasgo.io/versioned/apply)). 검증 backing: `SYNTHESIS.md` unavailable.

### 6. Sqitch — 조건부 채택 (TS-native가 필요 없을 때)

| 필드 | 저널 근거 기반 내용 |
|---|---|
| 정확히 검토한 버전 | **v1.6.1** |
| 라이선스 | MIT |
| 유지보수 신호 | 저널이 “current stable investigated was v1.6.1”로 기록. 최신 릴리스/활동 날짜는 unknown — not gathered. |
| 동시성/락 | PostgreSQL target/advisory lock으로 Sqitch 프로세스를 serialize한다. |
| 이력/병합 모델 | dependency-aware지만 central append-only plan이다. 동시 branch addition은 `sqitch.plan` Git conflict를 만들며, 사람이 resolve 후 순서를 검사해야 한다. |
| 기능 메모 | `sqitch check`로 hash divergence, `sqitch verify`로 실행 순서를 검증한다. Perl/SQL CLI이며 TS library나 Drizzle integration은 아니다. 공식 container로 singleton CI 또는 ArgoCD `PreSync` Job 실행 가능. 롤백: unknown — not gathered. |
| 판정 | **SQL 중심 운영 도구로는 조건부 채택.** 의존성 메타데이터와 검증 명령은 강점이지만, 중앙 plan 충돌을 없애지 않고 TypeScript 도입 목표에도 맞지 않는다. |

저널 인용: “It is dependency-aware rather than a Git-like semantic merge engine.” ([wave-2.md](wave-2.md); [Sqitch tutorial](https://sqitch.org/docs/manual/sqitchtutorial/#L987-L1027), [deploy](https://sqitch.org/docs/manual/sqitch-deploy/#L85-L90)). 검증 backing: `SYNTHESIS.md` unavailable.

### 7. Flyway Community — 조건부 채택 (언어 독립 SQL 운영)

| 필드 | 저널 근거 기반 내용 |
|---|---|
| 정확히 검토한 버전 | unknown — not gathered |
| 라이선스 | Community edition을 조사했으나 정확한 라이선스는 unknown — not gathered |
| 유지보수 신호 | unknown — not gathered |
| 동시성/락 | database lock이 있다. 구체적인 PostgreSQL primitive는 unknown — not gathered. |
| 이력/병합 모델 | immutable linear SQL migration history다. `outOfOrder`는 브랜치를 의미적으로 병합하지 않는다. |
| 기능 메모 | language-independent, Docker/CI fit. forward-only 운용에는 paid edition이 필요 없다고 조사됐다. 롤백: unknown — not gathered. |
| 판정 | **TS-native가 아닌 SQL migration runner를 허용할 경우의 강한 대안.** 안전한 선형 이력과 배포 lock은 맞지만, 자동 병합 요구를 충족하지 않으며 TS library는 아니다. |

저널 인용: “forward-only use needs no paid edition. `outOfOrder` does not semantically merge branches.” ([wave-1.md](wave-1.md); [versioned migrations](https://documentation.red-gate.com/flyway/flyway-concepts/migrations/versioned-migrations), [FAQ](https://documentation.red-gate.com/flyway/reference/usage/frequently-asked-questions)). 검증 backing: `SYNTHESIS.md` unavailable.

### 8. Liquibase — 조건부 채택 (변경 로그 도입을 감수할 때)

| 필드 | 저널 근거 기반 내용 |
|---|---|
| 정확히 검토한 버전 | unknown — not gathered (참조 문서는 5.1.1 user guide 경로) |
| 라이선스 | unknown — not gathered |
| 유지보수 신호 | unknown — not gathered |
| 동시성/락 | `DATABASECHANGELOGLOCK`을 사용한다. |
| 이력/병합 모델 | changelog ordering 모델이며 Git DAG merge가 아니다. |
| 기능 메모 | language-independent. 롤백: unknown — not gathered. |
| 판정 | **조건부 채택.** deployment lock은 문제를 완화하지만, TS-native가 아니고 migration 병합을 자동화하지 않는다. changelog 스타일의 관리 체계를 원하는 경우만 고려한다. |

저널 인용: “flexible but not Git DAG merge.” ([wave-1.md](wave-1.md); [database changelog lock](https://docs.liquibase.com/secure/user-guide-5-1-1/what-is-the-database-changelog-lock-table)). 검증 backing: `SYNTHESIS.md` unavailable.

### 9. TypeORM — 기각

| 필드 | 저널 근거 기반 내용 |
|---|---|
| 정확히 검토한 버전 | unknown — not gathered |
| 라이선스 | unknown — not gathered |
| 유지보수 신호 | unknown — not gathered |
| 동시성/락 | 조사한 경로에서 PostgreSQL distributed migration lock을 기본 제공하지 않는다. dedicated migration job과 external lock이 필요하다. |
| 이력/병합 모델 | unknown — not gathered |
| 기능 메모 | TypeScript ORM. 롤백: unknown — not gathered. |
| 판정 | **기각.** 이 과제의 핵심인 배포 경쟁 방지를 위해 별도 락 체계를 추가해야 하므로, Kysely/Prisma/Knex보다 직접적인 해법이 아니다. 이력 병합 장점도 저널에서 확인되지 않았다. |

저널 인용: “none provides a PostgreSQL distributed migration lock by default … [it] need[s] a dedicated migration job plus an external lock.” ([wave-1.md](wave-1.md); [TypeORM issue #4588](https://github.com/typeorm/typeorm/issues/4588)). 검증 backing: `SYNTHESIS.md` unavailable.

### 10. Umzug — 기각

| 필드 | 저널 근거 기반 내용 |
|---|---|
| 정확히 검토한 버전 | unknown — not gathered |
| 라이선스 | unknown — not gathered |
| 유지보수 신호 | unknown — not gathered |
| 동시성/락 | 조사한 경로에서 PostgreSQL distributed migration lock을 기본 제공하지 않는다. dedicated migration job과 external lock이 필요하다. |
| 이력/병합 모델 | unknown — not gathered |
| 기능 메모 | 롤백: unknown — not gathered. |
| 판정 | **기각.** 외부 락 설계가 전제되므로, 배포 시 함께 쉽게 실행하고 경합을 줄인다는 선택 기준에서 이득이 확인되지 않았다. |

저널 인용: “TypeORM / Umzug / dbmate: none provides a PostgreSQL distributed migration lock by default …” ([wave-1.md](wave-1.md)). 검증 backing: `SYNTHESIS.md` unavailable.

### 11. dbmate — 기각

| 필드 | 저널 근거 기반 내용 |
|---|---|
| 정확히 검토한 버전 | **v2.34.1** |
| 라이선스 | unknown — not gathered |
| 유지보수 신호 | v2.34.1 소스가 조사됐다는 사실 외에는 unknown — not gathered |
| 동시성/락 | no-lock이다. |
| 이력/병합 모델 | timestamp-linear 이력이다. Git식 병합 여부는 unknown — not gathered. |
| 기능 메모 | TypeScript library가 아니라 CLI 성격의 도구로 저널에 나타난다. 롤백: unknown — not gathered. |
| 판정 | **기각.** DB lock이 없어서 지금의 배포 경쟁/실패 문제에 부합하지 않는다. |

저널 인용: “dbmate is timestamp-linear and no-lock in v2.34.1.” ([wave-1.md](wave-1.md); [v2.34.1 source](https://github.com/amacneil/dbmate/blob/ddd00ff09d2034168072bc7870f815f9e6f1594d/pkg/dbmate/db.go#L351-L424)). 검증 backing: `SYNTHESIS.md` unavailable.

## 구현 방법론 (도구와 별개로 필수)

1. Alembic과 새 TS migration runner가 같은 schema의 authority가 되지 않도록, 전환 시점 이후에는 하나만 authoritative하게 둔다.
2. migration은 앱 replica마다 실행하지 말고 Argo의 singleton migration Job에서 앱 deploy 전에 실행한다. DB advisory lock은 같은 DB를 향한 중복 Job을 직렬화한다.
3. branch마다 migration을 추가할 수는 있지만, merge 직전에는 main 최신화 후 번호/순서를 선형화하고 하나의 migration head만 허용한다. 의존 관계가 실제로 충돌하면 사람이 DDL을 조정한다.
4. CI에 “migration DAG/순서 검증 + pending migration dry-run”을 넣고, deploy는 apply 결과가 성공할 때만 backend 단계로 진행한다.
5. production rollback 대신 forward-fix migration을 원칙으로 하고, migration 자체는 idempotent하게 작성한다.

이 방법론은 “DB rollback은 하지 않는다”는 선택과 양립한다. 롤백 기능의 유무는 우선순위를 낮출 뿐, 잘못된 migration을 되돌리는 유일한 수단이 되지는 않는다.

## 근거 추적

- 후보별 원문 조사 기록: [wave-1.md](wave-1.md) `Tool findings`; [wave-2.md](wave-2.md) 전체.
- 현재 배포/권한 현실: [wave-1.md](wave-1.md) `Target-repository reality`.
- `SYNTHESIS.md`: 제공되지 않음; 따라서 위 후보 판정의 verification backing은 저널 원문으로 제한된다.

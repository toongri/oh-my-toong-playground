## 후보 비교

### 결론

저널에서 검토된 도구 중 **Kysely Migrator**가 PostgreSQL advisory lock과 기본 트랜잭션 실행을 함께 제공하므로, TS 런타임에서 배포 잡이 마이그레이션을 실행해야 한다는 조건에는 가장 잘 맞는다. 다만 이것도 Git식 의미 기반 병합을 제공하지는 않는다. `allowUnorderedMigrations`는 파일 접두사 순서 검증을 완화할 뿐 충돌하는 DDL을 해결하지 않는다.

따라서 Alembic의 multi-head를 다른 도구의 "자동 병합"으로 없앨 수 있다는 전제는 성립하지 않는다. 배포 시에는 DB 수준 lock이 있는 단일 migration job을 실행하고, 브랜치에서 생긴 순서/DDL 충돌은 병합 전 사람이 정리하는 선형 이력 정책이 여전히 필요하다. 이는 현재 배포 순서(마이그레이션 → 백엔드 배포 → 검증) 및 환경별 직렬 배포와도 맞는다.

| 후보 | 최종 판단 |
|---|---|
| Kysely Migrator | **조건부 추천** — TS-native, PostgreSQL advisory lock, 기본 트랜잭션. 진짜 Git식 병합은 아님. |
| Prisma Migrate | 차선 — 배포 명령과 advisory lock은 좋지만 브랜치 이력은 수동 rebase/squash. |
| Flyway Community | 차선 — 운영 안정성 중심 SQL 도구로는 적합하나 TS-native가 아님. |
| Atlas | 조건부 — Drizzle 호환·lock은 장점이나, 선형화를 강제하고 OSS에서 rebase를 쓸 수 없음. |
| Drizzle Kit | 비추천 — 현재 스택과 가깝지만 PostgreSQL distributed lock 부재 및 병렬 journal 충돌. |
| Knex, TypeORM, Umzug, dbmate, Liquibase, Sqitch | 아래 개별 사유로 비추천/제한적 고려. |

### Kysely Migrator

- **검토한 정확한 버전:** unknown — not gathered.
- **라이선스:** unknown — not gathered.
- **유지보수 신호:** unknown — not gathered.
- **동시성/잠금:** PostgreSQL adapter가 advisory lock을 사용하며, 기본적으로 트랜잭션 안에서 실행한다.
- **이력/병합 모델:** 기본 순서 검증이 있으며 `allowUnorderedMigrations`로 prefix-order 거부를 피할 수 있다. 그러나 DDL 충돌을 해결하거나 branch DAG를 병합하지는 않는다.
- **기능 메모:** TS-native. 롤백: unknown — not gathered (사용자가 롤백을 요구하지 않았으므로 판단 가중치에는 반영하지 않음).
- **판정:** **조건부 추천.** 저널에서 확인된 후보 중 배포 동시 실행 안전성에 가장 직접적으로 부합한다. 다만 병합은 도구 기능이 아니라 선형화 정책과 PR 단계의 사람 검토로 관리해야 한다.
- **근거:** [PostgreSQL adapter](https://github.com/kysely-org/kysely/blob/f24018c789c3cf7ad03ccc672ada63a1ded87f88/src/dialect/postgres/postgres-adapter.ts#L6-L39), [migrations docs](https://www.kysely.dev/docs/migrations).

### Prisma Migrate

- **검토한 정확한 버전:** unknown — not gathered.
- **라이선스:** unknown — not gathered.
- **유지보수 신호:** unknown — not gathered.
- **동시성/잠금:** `migrate deploy`는 CI/CD용 명령이며 PostgreSQL advisory lock을 사용한다.
- **이력/병합 모델:** lexical-order 파일 이력이다. 브랜치에서 생긴 이력 충돌은 수동 rebase 또는 squash가 필요하다.
- **기능 메모:** TS-native이며 배포 명령이 명확하다. 롤백: unknown — not gathered.
- **판정:** **차선.** 실행 잠금은 요구에 맞지만 Alembic multi-head와 같은 협업 문제를 자동 병합으로 해결하지 않는다.
- **근거:** [migrate deploy](https://www.prisma.io/docs/cli/migrate/deploy), [squashing migrations](https://docs.prisma.io/docs/v6/orm/prisma-migrate/workflows/squashing-migrations), [PostgreSQL lock source](https://github.com/prisma/prisma-engines/blob/561d7b42579a2459cc8edf3788918b626c640023/schema-engine/connectors/sql-schema-connector/src/flavour/postgres.rs#L363-L384).

### Drizzle Kit

- **검토한 정확한 버전:** 0.31.5 (대상 저장소에 설치된 버전; 검토한 published source의 릴리스 버전은 unknown — not gathered).
- **라이선스:** unknown — not gathered.
- **유지보수 신호:** 대상 저장소 설치 버전은 0.31.5이나 최신 릴리스/활동일은 unknown — not gathered.
- **동시성/잠금:** PostgreSQL migrator source에는 트랜잭션이 있지만 advisory lock은 없다.
- **이력/병합 모델:** 병렬 migration 생성 시 journal/index 충돌 위험이 문서화되어 있으며, 권장 대응은 parent baseline에서 재생성하는 것이다.
- **기능 메모:** TS-native이고 현재 저장소는 `drizzle-orm` 0.44.5 / `drizzle-kit` 0.31.5를 가진다. 롤백: unknown — not gathered.
- **판정:** **비추천.** 도입 비용은 가장 낮지만, 요구의 핵심인 배포 동시성 안전과 다중 브랜치 이력 관리에 저널상 확인된 보장이 부족하다.
- **근거:** [Drizzle Kit migrate docs](https://orm.drizzle.team/docs/drizzle-kit-migrate), [PostgreSQL migrator source](https://github.com/drizzle-team/drizzle-orm/blob/273c78071d4841b497f5144734b38294df7ec64b/drizzle-orm/src/pg-core/dialect.ts#L2320-L2391), [병렬 journal 충돌 이슈](https://github.com/drizzle-team/drizzle-orm/issues/5774#L160-L170).

### Knex

- **검토한 정확한 버전:** unknown — not gathered.
- **라이선스:** unknown — not gathered.
- **유지보수 신호:** unknown — not gathered.
- **동시성/잠금:** 내장 DB lock이 있다.
- **이력/병합 모델:** filename 기반의 선형 ledger이며 branch DAG 병합은 제공하지 않는다.
- **기능 메모:** TS-friendly. 롤백: unknown — not gathered.
- **판정:** **제한적 고려.** 실행 경쟁은 줄일 수 있으나 multi-head의 근본 원인인 병렬 브랜치 이력 병합은 해결하지 않는다.
- **근거:** [Knex migrations — locks](https://knexjs.org/guide/migrations#notes-about-locks).

### TypeORM

- **검토한 정확한 버전:** unknown — not gathered.
- **라이선스:** unknown — not gathered.
- **유지보수 신호:** unknown — not gathered.
- **동시성/잠금:** 조사된 경로에서 PostgreSQL distributed migration lock을 기본 제공하지 않는다. 전용 migration job과 외부 lock이 필요하다.
- **이력/병합 모델:** unknown — not gathered.
- **기능 메모:** TS ORM. 롤백: unknown — not gathered.
- **판정:** **비추천.** 원하는 배포 동시성 안전성을 별도 설계로 보충해야 하므로, lock을 기본 제공하는 후보보다 불리하다.
- **근거:** [TypeORM issue #4588](https://github.com/typeorm/typeorm/issues/4588).

### Umzug

- **검토한 정확한 버전:** unknown — not gathered.
- **라이선스:** unknown — not gathered.
- **유지보수 신호:** unknown — not gathered.
- **동시성/잠금:** 조사된 경로에서 PostgreSQL distributed migration lock을 기본 제공하지 않는다. 전용 migration job과 외부 lock이 필요하다.
- **이력/병합 모델:** unknown — not gathered.
- **기능 메모:** TS/Node migration runner. 롤백: unknown — not gathered.
- **판정:** **비추천.** 핵심 요구를 만족하려면 별도 lock과 병합 정책을 모두 추가해야 한다.
- **근거:** wave-1 저널의 TypeORM / Umzug 조사 결과 (별도 외부 출처 URL은 unknown — not gathered).

### dbmate

- **검토한 정확한 버전:** v2.34.1.
- **라이선스:** unknown — not gathered.
- **유지보수 신호:** v2.34.1이 조사 대상이었으나 최신 릴리스/활동일은 unknown — not gathered.
- **동시성/잠금:** 기본 lock이 없다.
- **이력/병합 모델:** timestamp 기반 선형 이력이다.
- **기능 메모:** TS-native 라이브러리가 아니라 CLI다. 롤백: unknown — not gathered.
- **판정:** **비추천.** lock이 없고 선형 timestamp 이력만 제공하므로 이 요청의 경합 문제에 맞지 않는다.
- **근거:** [dbmate source](https://github.com/amacneil/dbmate/blob/ddd00ff09d2034168072bc7870f815f9e6f1594d/pkg/dbmate/db.go#L351-L424).

### Flyway Community

- **검토한 정확한 버전:** unknown — not gathered.
- **라이선스:** Community edition의 정확한 라이선스는 unknown — not gathered.
- **유지보수 신호:** unknown — not gathered.
- **동시성/잠금:** database lock을 제공하며 Docker/CI에 맞는다.
- **이력/병합 모델:** immutable linear SQL migration history다. `outOfOrder`는 branch를 의미적으로 병합하지 않는다.
- **기능 메모:** TS-native는 아니며 언어 독립 CLI다. forward-only 운영에는 유료 edition이 필요 없다고 저널이 확인했다. 롤백: unknown — not gathered.
- **판정:** **차선.** TS library라는 선호와는 어긋나지만, "DB 롤백을 하지 않는다"는 전제에서는 배포 운영의 단순성과 lock 면에서 실용적이다. Git식 병합 기대는 충족하지 않는다.
- **근거:** [versioned migrations](https://documentation.red-gate.com/flyway/flyway-concepts/migrations/versioned-migrations), [FAQ](https://documentation.red-gate.com/flyway/reference/usage/frequently-asked-questions).

### Liquibase

- **검토한 정확한 버전:** unknown — not gathered.
- **라이선스:** unknown — not gathered.
- **유지보수 신호:** unknown — not gathered.
- **동시성/잠금:** `DATABASECHANGELOGLOCK`을 사용한다.
- **이력/병합 모델:** changelog ordering 모델이며 Git DAG 병합은 제공하지 않는다.
- **기능 메모:** 언어 독립 도구다. 롤백: unknown — not gathered.
- **판정:** **제한적 고려.** lock은 장점이지만 TS-native가 아니고 협업 브랜치를 자동 병합하지 않는다.
- **근거:** [DATABASECHANGELOGLOCK](https://docs.liquibase.com/secure/user-guide-5-1-1/what-is-the-database-changelog-lock-table).

### Atlas

- **검토한 정확한 버전:** unknown — not gathered.
- **라이선스:** Community/OSS build는 확인됐으나 정확한 라이선스는 unknown — not gathered.
- **유지보수 신호:** unknown — not gathered.
- **동시성/잠금:** PostgreSQL advisory lock을 제공한다.
- **이력/병합 모델:** `atlas.sum`은 divergent migration-directory 변경을 의도적으로 Git merge conflict로 만든다. 팀은 rebase/rehash하여 선형 이력을 유지해야 한다. Community/OSS에서는 `migrate rebase`를 쓸 수 없고, 공식 Pro가 필요하다.
- **기능 메모:** Drizzle-compatible external schema. 롤백: unknown — not gathered.
- **판정:** **조건부 고려.** 현재 Drizzle과의 호환과 lock은 강점이나, 자동 병합이 아니라 의도적인 충돌을 통해 사람에게 선형화를 요구한다. 그 정리 명령이 유료라는 점도 요구의 "관리 쉬움"에 불리하다.
- **근거:** [migration-directory integrity](https://atlasgo.io/concepts/migration-directory-integrity), [versioned apply](https://atlasgo.io/versioned/apply), [Community command source](https://github.com/ariga/atlas/blob/9a6bc601212130aaaefcbc8dd36c710baf9716ff/cmd/atlas/internal/cmdapi/cmdapi.go#L639-L655).

### Sqitch

- **검토한 정확한 버전:** v1.6.1.
- **라이선스:** MIT.
- **유지보수 신호:** 조사된 current stable은 v1.6.1; 최신 릴리스/활동일은 unknown — not gathered.
- **동시성/잠금:** PostgreSQL에서 target/advisory lock으로 Sqitch 프로세스를 직렬화한다.
- **이력/병합 모델:** dependency-aware지만 central append-only plan을 사용한다. 동시 브랜치 추가는 `sqitch.plan` Git conflict를 만들며, 사람이 해소 후 순서를 검토해야 한다. hash divergence 검사(`sqitch check`)와 실행 순서 검증(`sqitch verify`)이 있다.
- **기능 메모:** Perl/SQL CLI이며 TS library 또는 Drizzle integration이 아니다. 공식 container로 singleton CI 또는 ArgoCD `PreSync` Job에서 실행할 수 있다. 롤백: unknown — not gathered.
- **판정:** **제한적 고려.** dependency metadata와 검증은 유용하지만, central plan 충돌을 없애지 못하고 TS 선호에도 맞지 않는다.
- **근거:** [Sqitch manual](https://sqitch.org/docs/manual/sqitch/), [tutorial — concurrent plan conflict](https://sqitch.org/docs/manual/sqitchtutorial/#L987-L1027), [deploy locking](https://sqitch.org/docs/manual/sqitch-deploy/#L85-L90), [check](https://sqitch.org/docs/manual/sqitch-check/), [verify](https://sqitch.org/docs/manual/sqitch-verify/), [downloads](https://sqitch.org/download/).

### 선택 시 운영 전제

- 대상 저장소는 현재 Node 22/pnpm/TypeScript 및 Drizzle을 사용하지만, Python/Alembic만 migration authority로 정해져 있다. TS 도구로 전환하려면 이 authority를 명시적으로 바꾸어야 한다.
- 현재 배포는 migration → backend deploy → verification 순서이고, Argo는 환경별 backend 배포를 직렬화하며 migration dispatch를 한 번 재시도한다. 후보를 채택해도 migration job은 idempotent해야 하고 DB-level lock을 가져야 한다.
- 관찰된 Alembic 이력은 revision 296개, merge revision 56개, head 2개이며 최근 no-op merge가 존재한다. 도구 교체만으로 이를 해결한다고 볼 근거는 없고, migration 파일의 선형화 및 충돌 DDL 검토 규칙이 필요하다.


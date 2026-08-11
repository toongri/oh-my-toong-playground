# DB migration 후보 비교

## 결론

권고는 **Kysely Migrator를 전용 migration runner로 채택**하는 것이다. PostgreSQL advisory lock과 기본 트랜잭션 실행을 제공하면서, 배포 시 singleton Job으로 실행하기에 가장 직접적으로 맞는다. 다만 이것은 Git식 자동 병합 해법이 아니다. 마이그레이션은 선형 이력으로 유지하고, PR merge 전 재생성/rebase 및 한 번의 통합 migration을 만드는 운영 규칙을 병행해야 한다.

대상 레포의 현재 배포 순서는 이미 “migration → backend deploy → verification”이며, 환경별 backend deploy는 직렬화된다. 따라서 도구를 바꾸더라도 **DB advisory lock + idempotent runner + 전용 Job**을 불변 조건으로 둬야 한다. `SYNTHESIS.md`가 제공되지 않아, 아래의 검증 뒷받침은 각 항목의 `wave-1.md`/`wave-2.md` 인용으로 한정된다.

## 후보 프로필

### Prisma Migrate

| 필드 | 내용 |
| --- | --- |
| 검토한 정확한 버전 | unknown — not gathered. PostgreSQL advisory-lock 구현은 `prisma-engines` commit `561d7b42579a2459cc8edf3788918b626c640023`에서 검토됐으나 Prisma release version은 저널에 없다. |
| 라이선스 | unknown — not gathered. |
| 유지보수 신호 | unknown — not gathered. |
| 동시성/잠금 | `migrate deploy`는 CI/CD용이고 PostgreSQL advisory lock을 사용한다. |
| 이력/병합 모델 | 파일명 lexical 순서의 migration이다. 브랜치 이력 충돌은 수동 rebase/squash가 필요하다. |
| 기능 메모 | 배포 명령과 DB 잠금은 요구에 잘 맞는다. rollback 기능의 필요 여부는 저널에서 수집하지 않았다. |
| 판정 | **차선**. 운영 안정성은 좋지만 multihead를 Git처럼 자동 병합하지는 않으므로, 현재의 핵심 경합을 조직 규칙 없이 해소하지 못한다. |

> 저널: “TS-native `migrate deploy` is a CI/CD command and uses a PostgreSQL advisory lock, but migrations are lexically ordered files and branch history conflicts require manual rebase/squash.” ([wave-1.md](wave-1.md))

### Drizzle Kit

| 필드 | 내용 |
| --- | --- |
| 검토한 정확한 버전 | `drizzle-kit` 0.31.5 (대상 레포 의존성). PostgreSQL migrator source는 commit `273c78071d4841b497f5144734b38294df7ec64b` 기준이다. |
| 라이선스 | unknown — not gathered. |
| 유지보수 신호 | unknown — not gathered. |
| 동시성/잠금 | migrator source에는 transaction은 있으나 PostgreSQL advisory lock은 없다. 병렬 migration 생성 시 journal/index collision 위험이 문서화되어 있다. |
| 이력/병합 모델 | 병렬 변경은 공통 parent baseline에서 재생성하라는 방식이다. 자동 Git-DAG 병합 모델은 확인되지 않았다. |
| 기능 메모 | TS-native이고 현재 Drizzle 0.44.5/Kit 0.31.5가 있으나, 대상 레포에서는 Alembic만 migration authority이며 Drizzle은 schema synchronization 용도다. rollback 기능의 필요 여부는 저널에서 수집하지 않았다. |
| 판정 | **비권고**. 현재 스택과 가깝지만 잠금 부재와 generation journal 충돌이 Alembic multihead와 유사한 협업 위험을 남긴다. |

> 저널: “published PostgreSQL migrator source has a transaction and no advisory lock. Parallel migration generation also has documented journal/index collision hazards.” ([wave-1.md](wave-1.md))

### Kysely Migrator

| 필드 | 내용 |
| --- | --- |
| 검토한 정확한 버전 | unknown — not gathered. PostgreSQL adapter source는 commit `f24018c789c3cf7ad03ccc672ada63a1ded87f88` 기준이다. |
| 라이선스 | unknown — not gathered. |
| 유지보수 신호 | unknown — not gathered. |
| 동시성/잠금 | PostgreSQL adapter가 advisory lock을 사용하며 기본적으로 transaction 안에서 실행한다. |
| 이력/병합 모델 | 기본 prefix-order 검증이 있고 `allowUnorderedMigrations`로 순서 거부를 완화할 수 있다. 단, 상충하는 DDL을 해결하거나 Git-DAG로 병합하지는 않는다. |
| 기능 메모 | TS-native. rollback 기능의 필요 여부는 저널에서 수집하지 않았다. |
| 판정 | **권고**. 배포 동시 실행 실패를 DB 잠금으로 막고 migration runner를 단순하게 유지할 수 있다. 단, PR 통합 규칙(선형화/재생성)은 반드시 별도로 둔다. |

> 저널: “Kysely Migrator: TypeScript-native; PostgreSQL adapter uses advisory lock and runs transactionally by default. `allowUnorderedMigrations` avoids default prefix-order rejection but cannot resolve conflicting DDL.” ([wave-1.md](wave-1.md))

### Knex

| 필드 | 내용 |
| --- | --- |
| 검토한 정확한 버전 | unknown — not gathered. |
| 라이선스 | unknown — not gathered. |
| 유지보수 신호 | unknown — not gathered. |
| 동시성/잠금 | built-in DB lock을 제공한다. |
| 이력/병합 모델 | 선형 filename ledger이며 branch DAG 병합은 제공하지 않는다. |
| 기능 메모 | TS-friendly. rollback 기능의 필요 여부는 저널에서 수집하지 않았다. |
| 판정 | **조건부 대안**. 잠금은 충족하지만 Kysely 대비 multihead 협업 해법의 추가 이점이 저널에서 확인되지 않았다. |

> 저널: “Knex: TS-friendly, linear filename ledger with built-in DB lock; no branch DAG merge.” ([wave-1.md](wave-1.md))

### TypeORM

| 필드 | 내용 |
| --- | --- |
| 검토한 정확한 버전 | unknown — not gathered. |
| 라이선스 | unknown — not gathered. |
| 유지보수 신호 | unknown — not gathered. |
| 동시성/잠금 | 조사 경로에서는 PostgreSQL distributed migration lock을 기본 제공하지 않는다. 전용 migration Job과 외부 lock이 필요하다. |
| 이력/병합 모델 | unknown — not gathered. |
| 기능 메모 | rollback 기능의 필요 여부는 저널에서 수집하지 않았다. |
| 판정 | **비권고**. 핵심 배포 동시성 조건을 자체 충족하지 못한다. |

> 저널: “TypeORM / Umzug / dbmate: none provides a PostgreSQL distributed migration lock by default in the investigated paths; they need a dedicated migration job plus an external lock.” ([wave-1.md](wave-1.md))

### Umzug

| 필드 | 내용 |
| --- | --- |
| 검토한 정확한 버전 | unknown — not gathered. |
| 라이선스 | unknown — not gathered. |
| 유지보수 신호 | unknown — not gathered. |
| 동시성/잠금 | 조사 경로에서는 PostgreSQL distributed migration lock을 기본 제공하지 않는다. 전용 migration Job과 외부 lock이 필요하다. |
| 이력/병합 모델 | unknown — not gathered. |
| 기능 메모 | rollback 기능의 필요 여부는 저널에서 수집하지 않았다. |
| 판정 | **비권고**. 잠금과 병합 운영을 별도 구현해야 해서 현재 문제의 관리 부담을 줄이지 못한다. |

> 저널: “TypeORM / Umzug / dbmate: none provides a PostgreSQL distributed migration lock by default in the investigated paths; they need a dedicated migration job plus an external lock.” ([wave-1.md](wave-1.md))

### dbmate

| 필드 | 내용 |
| --- | --- |
| 검토한 정확한 버전 | v2.34.1. |
| 라이선스 | unknown — not gathered. |
| 유지보수 신호 | unknown — not gathered. |
| 동시성/잠금 | v2.34.1에는 lock이 없다. 전용 migration Job과 외부 lock이 필요하다. |
| 이력/병합 모델 | timestamp-linear이다. Git-DAG 병합 모델은 수집되지 않았다. |
| 기능 메모 | rollback 기능의 필요 여부는 저널에서 수집하지 않았다. |
| 판정 | **비권고**. 선형 이력은 단순하지만 lock 부재 때문에 배포 실패 방지라는 핵심 요구에 맞지 않는다. |

> 저널: “dbmate is timestamp-linear and no-lock in v2.34.1.” ([wave-1.md](wave-1.md))

### Flyway Community

| 필드 | 내용 |
| --- | --- |
| 검토한 정확한 버전 | unknown — not gathered. |
| 라이선스 | Community edition의 정확한 라이선스는 unknown — not gathered. |
| 유지보수 신호 | unknown — not gathered. |
| 동시성/잠금 | database lock을 제공한다. Docker/CI에 맞는다. |
| 이력/병합 모델 | immutable linear SQL history다. `outOfOrder`는 브랜치의 의미적 병합이 아니다. |
| 기능 메모 | TS-native는 아니지만 forward-only 사용은 유료 edition 없이 가능하다. rollback이 필요 없다는 조건과 잘 맞는다. |
| 판정 | **실용적 대안**. TS 라이브러리여야 한다는 제약이 완화되면 안정적인 SQL-first 선택지지만, multihead의 자동 병합 답은 아니다. |

> 저널: “Flyway Community: language-independent (not TS-native) immutable linear SQL migration history, database lock, Docker/CI fit; forward-only use needs no paid edition. `outOfOrder` does not semantically merge branches.” ([wave-1.md](wave-1.md))

### Liquibase

| 필드 | 내용 |
| --- | --- |
| 검토한 정확한 버전 | unknown — not gathered. |
| 라이선스 | unknown — not gathered. |
| 유지보수 신호 | unknown — not gathered. |
| 동시성/잠금 | `DATABASECHANGELOGLOCK`을 사용한다. |
| 이력/병합 모델 | changelog ordering 기반이며 Git-DAG 병합은 아니다. |
| 기능 메모 | language-independent. rollback 기능의 필요 여부는 저널에서 수집하지 않았다. |
| 판정 | **조건부 대안**. locking은 맞지만 TS-native가 아니며 Git 같은 병합을 제공하지 않는다. |

> 저널: “Liquibase: language-independent changelog ordering plus `DATABASECHANGELOGLOCK`; flexible but not Git DAG merge.” ([wave-1.md](wave-1.md))

### Atlas

| 필드 | 내용 |
| --- | --- |
| 검토한 정확한 버전 | unknown — not gathered. Community/OSS source에서 `migrate rebase`가 지원되지 않음을 commit `9a6bc601212130aaaefcbc8dd36c710baf9716ff`로 확인했다. |
| 라이선스 | Community/OSS의 정확한 라이선스는 unknown — not gathered. Pro 필요 기능은 유료다. |
| 유지보수 신호 | unknown — not gathered. |
| 동시성/잠금 | PostgreSQL advisory lock을 제공한다. |
| 이력/병합 모델 | `atlas.sum`은 divergent migration-directory 변경을 의도적으로 merge conflict로 만든다. 선형 이력을 위해 rebase/rehash가 필요하다. |
| 기능 메모 | Drizzle external schema와 호환한다. `migrate rebase`는 OSS/community에는 없고 공식 Pro가 필요하다. rollback 기능의 필요 여부는 저널에서 수집하지 않았다. |
| 판정 | **조건부 대안**. schema integrity와 lock은 강점이나, 병합 충돌을 해소하는 핵심 편의가 유료이고 자동 semantic merge도 아니다. |

> 저널: “`atlas.sum` deliberately makes divergent migration-directory changes merge-conflict, so teams rebase/rehash to retain linear history. `migrate rebase` is unavailable in the OSS/community build; paid official/Pro is required.” ([wave-1.md](wave-1.md))

### Sqitch

| 필드 | 내용 |
| --- | --- |
| 검토한 정확한 버전 | v1.6.1. |
| 라이선스 | MIT. |
| 유지보수 신호 | current stable로 v1.6.1이 검토됐다. 릴리스 날짜는 unknown — not gathered. |
| 동시성/잠금 | PostgreSQL target/advisory lock으로 Sqitch process를 직렬화한다. |
| 이력/병합 모델 | dependency-aware지만 central append-only plan이다. 동시 branch 추가는 `sqitch.plan` Git conflict를 만들고, 해결 뒤 사람이 순서를 검토해야 한다. |
| 기능 메모 | `sqitch check`의 hash divergence check와 `sqitch verify`의 execution-order 검증이 있다. Perl/SQL CLI라 TS library나 Drizzle integration은 아니다. 공식 container로 singleton CI 또는 ArgoCD `PreSync` Job 실행은 가능하다. rollback 기능의 필요 여부는 저널에서 수집하지 않았다. |
| 판정 | **조건부 대안**. dependency metadata와 검증은 매력적이나 central plan conflict를 없애지 못하고 TS stack 적합성이 낮다. |

> 저널: “Sqitch was the only unchecked candidate with explicit dependency metadata. It is dependency-aware rather than a Git-like semantic merge engine. Its plan is central and append-only.” ([wave-2.md](wave-2.md))

## 방법론: 라이브러리보다 먼저 고정할 운영 규칙

모든 조사 후보는 Git의 의미적 자동 병합을 제공하지 않는다. 따라서 도구 선택과 별개로 다음 운영 모델이 필요하다.

1. migration 파일은 merge commit에서 하나의 선형 순서로 확정한다.
2. 병렬 PR이 같은 baseline에서 migration을 만들었다면, 최종 병합자가 새 baseline에서 migration을 재생성하거나 한 통합 migration으로 정리한다.
3. 배포는 별도의 singleton migration Job으로 실행하며 PostgreSQL advisory lock을 잡는다.
4. 이미 적용된 migration은 수정하지 않고, 실패 수정도 forward-only migration으로 낸다.

이 모델은 “DB rollback은 하지 않는다”는 전제와 일치한다. 리스크를 migration rollback에 두지 않고, **전진 전용·idempotent DDL·직렬 실행·PR 단계의 선형화**로 옮긴다.

> 저널: “A replacement must therefore be idempotent and use a database-level lock.” ([wave-1.md](wave-1.md))

## 조사 한계

- `SYNTHESIS.md`는 작업 디렉터리에 제공되지 않아 각 주장에 대한 별도 verification backing을 인용할 수 없다.
- 라이선스, 정확한 release version, 최신 릴리스/활동 날짜가 저널에 없는 후보는 모두 `unknown — not gathered`로 표기했다.
- rollback 지원 여부는 사용자가 중요하지 않다고 범위를 줄였지만, 저널에서 수집하지 않은 경우에도 각 후보 프로필에 그 공백을 명시했다.

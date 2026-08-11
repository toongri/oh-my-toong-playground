# 후보 비교

판단 기준은 TypeScript 진영에서의 운용성, PostgreSQL 배포 시 동시 실행 차단, 브랜치가 동시에 쌓일 때의 이력 관리다. 롤백은 사용자 요청대로 선택 가중치에서 제외하지 않고 기능 메모에만 기록한다. 아래에서 `unknown — not gathered`는 wave-1/2 저널이 해당 사실을 수집하지 않았다는 뜻이다.

| 후보 (검토한 정확한 버전) | 라이선스 | 유지보수 신호 | 동시성 / 잠금 | 히스토리 / 병합 모델 | 기능 메모 (롤백 포함) | 판정 |
|---|---|---|---|---|---|---|
| **Prisma Migrate** (unknown — not gathered; 조사한 PostgreSQL 소스 커밋 `561d7b42579a2459cc8edf3788918b626c640023`) | unknown — not gathered | unknown — not gathered | `migrate deploy`는 PostgreSQL advisory lock을 사용하며 CI/CD 명령이다. | 파일의 어휘순 선형 이력이다. 브랜치 충돌은 수동 rebase/squash가 필요하다. | TS-native. `migrate deploy`로 배포에 넣기 쉽다. 롤백 기능: unknown — not gathered. | **조건부 채택 가능.** 배포 경쟁은 DB 락으로 막지만, Alembic multi-head의 근본 원인인 병렬 브랜치 이력은 사람이 선형화해야 한다. |
| **Drizzle Kit** (`drizzle-orm` 0.44.5, `drizzle-kit` 0.31.5) | unknown — not gathered | 프로젝트에 이 버전이 설치되어 있음; 최신 릴리스/활동일은 unknown — not gathered. | 공개된 PostgreSQL migrator 소스에는 트랜잭션은 있으나 advisory lock이 없다. | 병렬 migration 생성 시 journal/index 충돌 위험이 문서화되어 있으며, 부모 baseline에서 재생성하라는 운영 조언이 있다. | TS-native이며 현재 저장소에도 설치되어 있으나, 현재 정책상 schema synchronization 전용이고 migration authority는 Alembic이다. 롤백 기능: unknown — not gathered. | **비채택.** 별도 DB 락과 엄격한 단일 생성자 규칙 없이는 배포 경쟁과 병렬 생성 충돌을 완화하지 못한다. |
| **Kysely Migrator** (unknown — not gathered; 조사한 PostgreSQL adapter 커밋 `f24018c789c3cf7ad03ccc672ada63a1ded87f88`) | unknown — not gathered | unknown — not gathered | PostgreSQL adapter가 advisory lock을 사용하고 기본적으로 트랜잭션 안에서 실행한다. | 기본 prefix 순서 검사를 `allowUnorderedMigrations`로 완화할 수 있지만, 충돌하는 DDL을 해결하지는 않는다. | TS-native. 롤백 기능: unknown — not gathered. | **권장 후보.** 배포 동시성 보호가 내장되어 있고 단순한 forward-only 운영에 맞는다. 다만 Git식 자동 병합은 아니므로 migration 작성·병합 규칙은 별도로 필요하다. |
| **Knex** (unknown — not gathered) | unknown — not gathered | unknown — not gathered | 내장 DB lock이 있다. | 파일명 기반의 선형 ledger이며 브랜치 DAG 병합은 없다. | TS-friendly. 롤백 기능: unknown — not gathered. | **차선.** lock은 충족하지만 Kysely보다 이력 병합 문제에 대한 이점이 저널에서 확인되지 않았다. |
| **TypeORM** (unknown — not gathered) | unknown — not gathered | unknown — not gathered | 조사된 경로에서는 PostgreSQL 분산 migration lock을 기본 제공하지 않는다. 전용 migration job과 외부 lock이 필요하다. | 히스토리/병합 모델: unknown — not gathered. | TS-friendly로 분류되었으나, 롤백 기능: unknown — not gathered. | **비채택.** 요청의 핵심인 배포 동시성 보호를 추가 인프라 없이 충족하지 않는다. |
| **Umzug** (unknown — not gathered) | unknown — not gathered | unknown — not gathered | 조사된 경로에서는 PostgreSQL 분산 migration lock을 기본 제공하지 않는다. 전용 migration job과 외부 lock이 필요하다. | 히스토리/병합 모델: unknown — not gathered. | TS-friendly로 분류되었으나, 롤백 기능: unknown — not gathered. | **비채택.** 락과 병합 정책을 모두 별도로 구현해야 하므로 Alembic의 운영 부담을 줄이지 못한다. |
| **dbmate** (v2.34.1) | unknown — not gathered | v2.34.1이 조사된 버전; 최신 릴리스/활동일은 unknown — not gathered. | 기본 lock이 없다. | timestamp 기반 선형 이력이다. | TS 라이브러리가 아니라 CLI 성격이다. 롤백 기능: unknown — not gathered. | **비채택.** 병렬 배포를 막을 락이 없고 TS-native도 아니다. |
| **Flyway Community** (unknown — not gathered) | unknown — not gathered | unknown — not gathered | database lock을 제공하며 Docker/CI에 넣을 수 있다. | immutable 선형 SQL migration history다. `outOfOrder`는 브랜치의 의미론적 병합이 아니다. | 언어 독립적이며 forward-only 운용에 Community/무료로 충분하다. 롤백 기능: unknown — not gathered. | **조건부 채택 가능.** TS 라이브러리 요구를 CLI/컨테이너 방식으로 받아들일 수 있다면 견고한 대안이나, Git식 자동 병합은 제공하지 않는다. |
| **Liquibase** (unknown — not gathered) | unknown — not gathered | unknown — not gathered | `DATABASECHANGELOGLOCK`으로 실행을 직렬화한다. | changelog 순서 기반이며 Git DAG 병합은 아니다. | 언어 독립적이다. 롤백 기능: unknown — not gathered. | **차선.** locking은 충족하지만 TS-native가 아니며, 저널상 브랜치 충돌을 더 잘 해소한다는 근거가 없다. |
| **Atlas** (unknown — not gathered; 조사한 소스 커밋 `9a6bc601212130aaaefcbc8dd36c710baf9716ff`) | unknown — not gathered | unknown — not gathered | PostgreSQL advisory lock을 제공한다. | `atlas.sum`은 migration directory의 분기 변경을 의도적으로 merge conflict로 만들며, 팀은 rebase/rehash로 선형 이력을 유지한다. | Drizzle-compatible external schema를 지원한다. `migrate rebase`는 OSS/community에 없고 유료 official/Pro가 필요하다. 롤백 기능: unknown — not gathered. | **비채택(현 조건).** 락과 Drizzle 호환성은 좋지만, 핵심 병합 편의 기능이 유료이고 자동 Git식 병합도 아니다. |
| **Sqitch** (v1.6.1) | MIT | v1.6.1이 조사된 stable 버전; 최신 릴리스/활동일은 unknown — not gathered. | PostgreSQL target/advisory lock으로 Sqitch 프로세스를 직렬화한다. | dependency metadata가 있으나 central append-only plan 모델이다. 동시 브랜치 추가는 `sqitch.plan` Git conflict가 나며 사람이 순서를 검토해 해소해야 한다. | Perl/SQL CLI이며 TS library나 Drizzle integration은 아니다. `sqitch check`(hash divergence)와 `sqitch verify`(실행 순서 검증)를 제공한다. singleton CI 또는 ArgoCD `PreSync` Job/공식 컨테이너로 실행할 수 있다. 롤백 기능: unknown — not gathered. | **조건부 채택 가능.** 배포 직렬화·검증은 강점이지만 중앙 계획 파일의 충돌을 제거하지 못하고 TS 진영 적합성도 낮다. |

## 결론

저널 근거상 **Kysely Migrator**가 가장 잘 맞는다. PostgreSQL advisory lock과 기본 트랜잭션으로 배포 경쟁을 제어하면서 TypeScript-native이고, 롤백에 의존하지 않는 forward-only 운영과도 맞는다. 다만 어떤 후보도 병렬 DDL을 Git처럼 의미론적으로 자동 병합하지 않는다. 따라서 도구 교체와 함께 `migration은 배포 전 하나의 선형 순서로 rebase/검토한다`, `migration 실행은 DB advisory lock을 가진 단일 배포 단계에서만 한다`는 운영 규칙을 채택해야 multi-head류 실패를 없앨 수 있다.

### 저널 근거

- Wave 1 — Prisma, Drizzle, Kysely, Knex, TypeORM, Umzug, dbmate, Flyway, Liquibase, Atlas의 도구 조사 및 대상 저장소 배포 조건.
- Wave 2 — Sqitch v1.6.1의 plan 충돌, PostgreSQL locking, 컨테이너/Argo 실행 적합성 조사.

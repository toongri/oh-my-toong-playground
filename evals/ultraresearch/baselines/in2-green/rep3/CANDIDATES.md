# 후보 비교 — TypeScript DB 마이그레이션

## 결론

**권고 후보는 Kysely Migrator**다. PostgreSQL advisory lock과 기본 트랜잭션 실행을 제공하므로, 현재 배포 순서(마이그레이션 → 백엔드 배포)에서 별도 singleton migration Job과 조합할 때 동시 배포 경합을 막을 수 있다. 다만 어떤 후보도 Alembic multi-head를 Git처럼 의미적으로 자동 병합하지 않는다. 병합은 사람이 DDL 충돌을 검토하고 하나의 실행 순서로 선형화해야 한다.

이 권고는 롤백을 요구하지 않고, TypeScript 네이티브이며, 배포 시 DB 수준 lock이 필요한 현재 조건을 기준으로 한다. `allowUnorderedMigrations`는 파일 prefix 순서 검증만 완화할 뿐 충돌 DDL을 해결하지 않으므로, 팀 정책(마이그레이션 단일 실행 Job, 재배치/rebase, CI에서 단일 head 검증)은 여전히 필요하다.

## 비교 기준

- 근거 범위: `wave-1.md`, `wave-2.md`에 기록된 내용만 사용했다. 저널에 없는 사실은 추정하지 않고 `unknown — not gathered`로 표기했다.
- 롤백: 사용자가 범위에서 제외했지만 각 후보의 기능 노트에 별도 표기했다.
- 버전: 저널이 버전 대신 소스 커밋만 기록한 경우, 그 커밋을 함께 적되 “정확한 버전”은 수집되지 않았다고 표기했다.

## Kysely Migrator

| 필드 | 내용 |
|---|---|
| 조사 버전 | exact version: **unknown — not gathered**; inspected source commit: `f24018c789c3cf7ad03ccc672ada63a1ded87f88` |
| 라이선스 | unknown — not gathered |
| 유지보수 신호 | latest release/activity date: unknown — not gathered |
| 동시성 / locking | PostgreSQL adapter가 advisory lock을 사용하고 기본적으로 트랜잭션 안에서 실행한다. |
| 히스토리 / 병합 모델 | 실행 이력은 선형 순서다. 기본 prefix-order 거부는 `allowUnorderedMigrations`로 완화할 수 있지만, 충돌하는 DDL을 자동 병합하지는 않는다. |
| 기능 노트 | TypeScript-native. 롤백: unknown — not gathered; 사용자가 롤백을 요구하지 않으므로 권고 판단의 핵심은 아니다. |
| 판정 | **권고.** TS-native이며 DB advisory lock과 transactional execution이 저널에서 함께 확인돼 현재 조건에 직접 맞는다. 다만 deployment singleton과 선형화 정책이 없으면 branch DDL 충돌은 남는다. |

근거: `wave-1.md` — Kysely 공식 문서와 PostgreSQL adapter source.

## Prisma Migrate

| 필드 | 내용 |
|---|---|
| 조사 버전 | exact version: **unknown — not gathered**; inspected Prisma Engines commit: `561d7b42579a2459cc8edf3788918b626c640023` |
| 라이선스 | unknown — not gathered |
| 유지보수 신호 | latest release/activity date: unknown — not gathered |
| 동시성 / locking | `migrate deploy`는 CI/CD용 명령이며 PostgreSQL advisory lock을 사용한다. |
| 히스토리 / 병합 모델 | migration 파일은 lexical order의 선형 이력이다. branch 충돌은 수동 rebase/squash가 필요하다. |
| 기능 노트 | TS-native, CI/CD 배포 명령 제공. 롤백: unknown — not gathered; 비요구 사항이다. |
| 판정 | **조건부 차선.** lock과 배포 경험은 좋지만, 현재의 multi-head/branch 병합 고통을 자동으로 해소하지 못하고 Prisma 도입 비용도 저널에서 평가되지 않았다. |

근거: `wave-1.md` — Prisma CLI/workflow 문서와 PostgreSQL connector source.

## Drizzle Kit

| 필드 | 내용 |
|---|---|
| 조사 버전 | target repository: `drizzle-orm` **0.44.5**, `drizzle-kit` **0.31.5**; inspected migrator source commit: `273c78071d4841b497f5144734b38294df7ec64b` |
| 라이선스 | unknown — not gathered |
| 유지보수 신호 | latest release/activity date: unknown — not gathered |
| 동시성 / locking | published PostgreSQL migrator source에는 트랜잭션이 있으나 advisory lock은 확인되지 않았다. |
| 히스토리 / 병합 모델 | 병렬 migration 생성 시 journal/index 충돌 위험이 문서화되어 있으며, parent baseline에서 재생성하는 방식이 안내된다. |
| 기능 노트 | TS-native이고 현 저장소에 이미 존재하지만 현재 정책상 Alembic만 migration authority이며 Drizzle은 schema synchronization 용도다. 롤백: unknown — not gathered; 비요구 사항이다. |
| 판정 | **비권고.** 지금 도입 장벽은 낮지만 DB-level distributed lock 부재와 병렬 생성 journal 충돌이 문제의 핵심과 직접 맞닿아 있다. |

근거: `wave-1.md` — 현재 저장소 구성, Drizzle migrate 문서/source, issue #5774.

## Knex

| 필드 | 내용 |
|---|---|
| 조사 버전 | exact version: **unknown — not gathered** |
| 라이선스 | unknown — not gathered |
| 유지보수 신호 | latest release/activity date: unknown — not gathered |
| 동시성 / locking | built-in DB lock을 제공한다. |
| 히스토리 / 병합 모델 | filename ledger 기반 선형 이력이며 branch DAG 병합은 제공하지 않는다. |
| 기능 노트 | TS-friendly. 롤백: unknown — not gathered; 비요구 사항이다. |
| 판정 | **차선.** 배포 경합 억제에는 적합하나, multi-head를 Git처럼 병합해 주지는 않는다. Kysely 대비 선택 근거는 저널에서 수집되지 않았다. |

근거: `wave-1.md` — Knex migration lock 문서.

## TypeORM

| 필드 | 내용 |
|---|---|
| 조사 버전 | exact version: **unknown — not gathered** |
| 라이선스 | unknown — not gathered |
| 유지보수 신호 | latest release/activity date: unknown — not gathered |
| 동시성 / locking | 조사된 경로에서 PostgreSQL distributed migration lock을 기본 제공하지 않는다. dedicated migration Job과 external lock이 필요하다. |
| 히스토리 / 병합 모델 | unknown — not gathered |
| 기능 노트 | TS ecosystem 후보. 롤백: unknown — not gathered; 비요구 사항이다. |
| 판정 | **탈락.** 핵심 요구인 배포 동시성 제어를 기본 제공하지 않아 별도 운영 구성 없이는 현재 실패 모드를 줄이지 못한다. |

근거: `wave-1.md` — TypeORM issue #4588.

## Umzug

| 필드 | 내용 |
|---|---|
| 조사 버전 | exact version: **unknown — not gathered** |
| 라이선스 | unknown — not gathered |
| 유지보수 신호 | latest release/activity date: unknown — not gathered |
| 동시성 / locking | 조사된 경로에서 PostgreSQL distributed migration lock을 기본 제공하지 않는다. dedicated migration Job과 external lock이 필요하다. |
| 히스토리 / 병합 모델 | unknown — not gathered |
| 기능 노트 | TS ecosystem 후보. 롤백: unknown — not gathered; 비요구 사항이다. |
| 판정 | **탈락.** 기본 DB lock이 없다는 조사 결과 때문에 현재의 동시 배포 경합 조건을 충족하지 않는다. |

근거: `wave-1.md` — TypeORM / Umzug / dbmate 조사 요약.

## dbmate

| 필드 | 내용 |
|---|---|
| 조사 버전 | **v2.34.1** |
| 라이선스 | unknown — not gathered |
| 유지보수 신호 | latest release/activity date: unknown — not gathered |
| 동시성 / locking | v2.34.1 조사 경로에는 DB lock이 없다. dedicated migration Job과 external lock이 필요하다. |
| 히스토리 / 병합 모델 | timestamp 기반 선형 이력이다. |
| 기능 노트 | 롤백: unknown — not gathered; 비요구 사항이다. |
| 판정 | **탈락.** 간단한 선형 SQL 이력이라는 장점보다 기본 lock 부재가 현재 운영 요구와 충돌한다. |

근거: `wave-1.md` — dbmate source (`db.go`) 조사.

## Flyway Community

| 필드 | 내용 |
|---|---|
| 조사 버전 | exact version: **unknown — not gathered** |
| 라이선스 | Community edition license: unknown — not gathered |
| 유지보수 신호 | latest release/activity date: unknown — not gathered |
| 동시성 / locking | database lock을 제공하며 Docker/CI 환경에 맞는다. |
| 히스토리 / 병합 모델 | immutable linear SQL migration history다. `outOfOrder`는 branch를 의미적으로 병합하지 않는다. |
| 기능 노트 | 언어 독립적이며 TS-native는 아니다. forward-only 운용은 paid edition 없이 가능하다. 롤백: forward-only 사용이 가능하나 rollback 기능 자체는 unknown — not gathered. |
| 판정 | **운영 중심 대안.** lock과 컨테이너 배포는 강점이지만 TS library를 우선하는 요구에는 맞지 않고 Git식 자동 병합도 제공하지 않는다. |

근거: `wave-1.md` — Flyway concepts/FAQ 문서.

## Liquibase

| 필드 | 내용 |
|---|---|
| 조사 버전 | exact version: **unknown — not gathered** |
| 라이선스 | unknown — not gathered |
| 유지보수 신호 | latest release/activity date: unknown — not gathered |
| 동시성 / locking | `DATABASECHANGELOGLOCK`을 사용한다. |
| 히스토리 / 병합 모델 | changelog ordering 방식이며 Git DAG 병합은 제공하지 않는다. |
| 기능 노트 | 언어 독립적. 롤백: unknown — not gathered; 비요구 사항이다. |
| 판정 | **운영 중심 대안.** lock은 충족하지만 TS-native가 아니고 Alembic multi-head를 자동 병합하지 않는다. |

근거: `wave-1.md` — Liquibase lock table 문서.

## Atlas

| 필드 | 내용 |
|---|---|
| 조사 버전 | exact version: **unknown — not gathered**; inspected source commit: `9a6bc601212130aaaefcbc8dd36c710baf9716ff` |
| 라이선스 | Community/OSS license: unknown — not gathered |
| 유지보수 신호 | latest release/activity date: unknown — not gathered |
| 동시성 / locking | PostgreSQL advisory lock을 제공한다. |
| 히스토리 / 병합 모델 | `atlas.sum`은 migration directory의 분기를 의도적으로 Git merge conflict로 드러낸다. 팀은 rebase/rehash로 선형 이력을 복구해야 하며, OSS/community에는 `migrate rebase`가 없고 official/Pro가 필요하다. |
| 기능 노트 | Drizzle-compatible external schema. 롤백: unknown — not gathered; 비요구 사항이다. |
| 판정 | **조건부 대안.** lock과 Drizzle 호환성은 좋지만 Git conflict를 자동으로 없애지 않고, 편한 rebase workflow가 유료여서 “쉬운 관리” 기준에서 Kysely보다 불리하다. |

근거: `wave-1.md` — Atlas integrity/apply 문서와 command source.

## Sqitch

| 필드 | 내용 |
|---|---|
| 조사 버전 | **v1.6.1** |
| 라이선스 | MIT |
| 유지보수 신호 | 조사 저널은 v1.6.1을 current stable로 기록했으며 release date는 unknown — not gathered. |
| 동시성 / locking | PostgreSQL target lock/advisory lock으로 Sqitch process를 직렬화한다. |
| 히스토리 / 병합 모델 | dependency-aware지만 central append-only plan이다. concurrent branch additions는 `sqitch.plan` Git conflict를 만들며, 해결 후 사람이 순서를 확인해야 한다. |
| 기능 노트 | `sqitch check`(hash divergence)와 `sqitch verify`(execution-order verification)를 제공한다. Perl/SQL CLI로 TS library나 Drizzle integration은 아니다. official container로 singleton CI 또는 ArgoCD `PreSync` Job 실행은 가능하다. 롤백: unknown — not gathered; 비요구 사항이다. |
| 판정 | **검증 강화형 대안.** dependency metadata와 검증 기능은 유용하지만 central plan 충돌을 제거하지 못하고 TS-native 요구에 맞지 않는다. |

근거: `wave-2.md` — Sqitch manual/tutorial/download/container/MetaCPAN 조사.

## 현재 배포에 적용할 운영 원칙

1. 마이그레이션은 애플리케이션 pod 시작 시가 아니라, 환경별 단일 migration Job으로 먼저 실행한다.
2. PostgreSQL advisory lock으로 Job 재시도·중복 dispatch를 직렬화한다.
3. PR 병합 전에는 migration chain을 재배치해 하나의 실행 순서로 만들고, 충돌 DDL은 사람이 해소한다. DB migration은 Git object DAG가 아니므로 “두 head를 자동 병합”하는 도구는 이 조사 범위에서 확인되지 않았다.
4. 현재 구현된 배포 순서도 migration → backend deploy → verification이고 환경별 backend deploy는 직렬화되어 있다. 도구 교체 시 이 순서와 idempotency 조건을 보존한다.

근거: `wave-1.md` — target repository deploy workflow / Argo workflow 조사.

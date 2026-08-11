# 후보 비교

## 결론

`Kysely Migrator`를 1순위로 검토한다. TypeScript에서 직접 실행할 수 있고 PostgreSQL advisory lock 및 기본 트랜잭션을 제공하므로, 현재 배포 순서(마이그레이션 → 백엔드 배포)에 전용 migration Job을 끼우기 가장 단순하다. 다만 이것은 Alembic의 multi-head를 Git처럼 자동 병합하는 해법이 아니다. 팀은 여전히 충돌하는 DDL을 사람이 조정하고, 배포 전 migration 순서를 하나로 확정해야 한다.

> “`allowUnorderedMigrations` avoids default prefix-order rejection but cannot resolve conflicting DDL.” — [wave-1.md](wave-1.md)

검증 근거는 제공된 저널뿐이며, 이 작업 디렉터리에는 `SYNTHESIS.md`가 없다. 아래의 판단은 `wave-1.md`와 `wave-2.md`에 수록된 공식 문서·소스 조사 결과를 벗어나지 않는다.

## 평가 기준

| 기준 | 의미 |
| --- | --- |
| TS 적합성 | 애플리케이션/배포 코드에서 TypeScript로 자연스럽게 운영 가능한가 |
| 배포 안전성 | CI·Argo Job에서 idempotent하게 실행하고 DB 수준에서 동시 실행을 막을 수 있는가 |
| 브랜치 경합 | 여러 브랜치의 마이그레이션이 합쳐질 때 도구가 요구하는 사람의 조정량 |
| 현 상황 적합성 | Drizzle이 이미 의존성에 있으나 Alembic이 migration authority인 현재 상태에서의 전환 비용 |

## 순위별 후보

| 순위 | 후보 | TS 적합성 | 배포 안전성 | 브랜치 경합 처리 | 판단 |
| --- | --- | --- | --- | --- | --- |
| 1 | Kysely Migrator | 높음 | PostgreSQL advisory lock, 기본 transactional 실행 | 순서 제약을 완화할 수 있지만 DDL 충돌은 사람이 해결 | 가장 균형적. 전용 migration runner로 채택 후보 |
| 2 | Prisma Migrate | 높음 | `migrate deploy`가 CI/CD용이고 PostgreSQL advisory lock 사용 | lexical file history라 rebase/squash가 필요 | Prisma를 도입할 이유가 별도로 있을 때만. migration만을 위해 ORM 전환은 과함 |
| 3 | Flyway Community | 중간 (TS 라이브러리는 아님) | DB lock, Docker/CI 친화적 | immutable linear history; `outOfOrder`도 의미적 병합은 아님 | SQL 중심 운영을 원하면 강한 대안. forward-only 운영에 유료 기능 불필요 |
| 4 | Knex | 높음 | 내장 DB lock | 선형 filename ledger, DAG 병합 없음 | 단순한 TS 선택지이나 Kysely보다 명확한 이점이 적음 |
| 5 | Drizzle Kit | 높음 | 게시된 PostgreSQL migrator에 advisory lock이 없음 | journal/index 충돌 위험, parent baseline에서 재생성 권고 | 기존 의존성이라는 장점은 있으나, 이 문제의 핵심인 배포 경합을 그대로 남김 |
| 6 | Atlas | 중간 (외부 CLI) | Drizzle external schema 및 PostgreSQL advisory lock | `atlas.sum`이 분기 변경을 의도적으로 충돌시킴; rebase/rehash 필요 | 강한 무결성 검증은 장점. 다만 OSS에서 `migrate rebase` 미지원이라 협업 해소 비용이 큼 |
| 7 | Sqitch | 낮음 (Perl/SQL CLI) | PostgreSQL target/advisory lock, check/verify 제공 | dependency metadata가 있어도 중앙 append-only plan 충돌은 사람이 해결 | 의존성 선언이 꼭 필요할 때만. TS/Drizzle 경로에는 부적합 |

## 제외 또는 후순위 후보

| 후보 | 후순위 이유 |
| --- | --- |
| TypeORM / Umzug / dbmate | 조사 범위에서 기본 PostgreSQL 분산 migration lock이 없었다. 전용 Job과 외부 lock을 별도로 설계해야 한다. |
| Liquibase | `DATABASECHANGELOGLOCK`은 제공하지만 changelog 순서 기반이며 Git DAG식 병합은 아니다. TS 환경의 운영 단순성 측면에서 우선순위가 낮다. |

## 문제를 분리해서 운영할 것

현재 실패 원인은 서로 다른 두 종류의 경합이다. 어떤 후보도 둘을 자동으로 해결하지는 않는다.

| 문제 | 필요한 통제 | 후보의 기여 |
| --- | --- | --- |
| 배포 시 둘 이상의 runner가 같은 DB migration을 실행 | DB advisory lock + 단일 migration Job + idempotent apply | Kysely, Prisma, Flyway, Knex, Atlas, Sqitch는 lock 측면에서 적합 |
| 여러 브랜치가 동시에 migration을 추가해 순서·DDL이 충돌 | merge queue/배포 직전 rebase, 하나의 canonical 순서, 충돌 DDL의 명시적 조정 | 어느 후보도 Git 같은 의미적 자동 병합을 제공하지 않음 |

> “It is dependency-aware rather than a Git-like semantic merge engine.” — [wave-2.md](wave-2.md)

> “`atlas.sum` deliberately makes divergent migration-directory changes merge-conflict, so teams rebase/rehash to retain linear history.” — [wave-1.md](wave-1.md)

## 권장 운영안: Kysely + 전용 migration Job

1. Alembic의 schema authority를 단번에 이관하기보다, 새 TypeScript migration runner와 migration ledger를 먼저 도입한다.
2. 배포 pipeline의 기존 순서인 migration → backend deploy → verification에서 migration 단계를 singleton Argo Job으로 고정한다.
3. runner는 Kysely의 PostgreSQL advisory lock 아래에서 `up`만 실행한다. 롤백 명령은 배포 경로에 두지 않는다.
4. CI에서 새 migration이 추가된 PR을 감지해, main 최신 migration 기준으로 재생성/순서 확정을 요구한다. `allowUnorderedMigrations`는 번호 순서만으로 막히는 상황을 완화하는 장치이지 DDL 충돌을 승인하는 장치가 아니다.
5. 둘 이상의 PR이 같은 테이블·인덱스·컬럼을 만지면 후속 PR이 rebase하고 migration을 수정하거나 하나의 migration으로 합친다. 이는 도구 결함이 아니라 DB 변경의 의미 충돌을 드러내는 필수 검토 지점이다.

현재 배포 체계에는 이미 “migration → backend deploy → verification” 순서와 환경별 backend deploy 직렬화가 있다. 따라서 핵심 추가물은 DB lock을 가진 TS migration runner와, main 병합 직전 migration 정렬을 강제하는 CI 규칙이다.

> “Deploy order is already migration → backend deploy → verification; Argo serializes backend deploys per environment and retries migration dispatch once.” — [wave-1.md](wave-1.md)

## 근거 저널

- [wave-1.md](wave-1.md): 대상 저장소의 Alembic multi-head 현황, 배포 순서, Prisma/Drizzle/Kysely/Knex/Flyway/Liquibase/Atlas 조사.
- [wave-2.md](wave-2.md): Sqitch의 dependency metadata, lock, 중앙 plan 충돌 및 컨테이너 배포 적합성 조사.

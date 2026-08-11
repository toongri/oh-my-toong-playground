# 후보 비교

## 평가 기준

현재 문제는 단순히 마이그레이션을 배포 시 실행하는 것이 아니라, 여러 브랜치가 동시에 리비전을 추가할 때 Alembic의 다중 head처럼 이력이 갈라지는 일을 줄이는 것이다. 따라서 아래 순서로 평가했다.

1. TypeScript/Drizzle 환경과의 적합성
2. PostgreSQL에서 동시 배포를 직렬화하는 DB 수준 잠금
3. 분기 이력을 사람이 예측 가능하게 합칠 수 있는지
4. 현재의 `migration → backend deploy → verification` 파이프라인에 넣기 쉬운지
5. 롤백 없이 forward-only 운영이 가능한지

> “A replacement must therefore be idempotent and use a database-level lock.” — [wave-1.md](wave-1.md)

> “It is dependency-aware rather than a Git-like semantic merge engine.” — [wave-2.md](wave-2.md)

이 비교에서 **Git처럼 DDL을 의미적으로 자동 병합하는 도구는 확인되지 않았다.** 후보들은 모두 충돌을 조기에 드러내고, rebase·재생성·중앙 계획 파일 병합처럼 사람이 이력을 선형화하는 방식이다. 이는 Alembic의 merge revision을 없애더라도 스키마 변경 충돌 자체를 자동 해결하지는 못한다는 뜻이다.

## 후보 요약

| 후보 | TS/Drizzle 적합성 | PostgreSQL 동시 실행 제어 | 브랜치 병합 모델 | 배포 적용 | 판단 |
|---|---|---|---|---|---|
| **Kysely Migrator** | TS-native. Drizzle과 병행하려면 SQL/마이그레이션 책임을 별도로 정해야 함 | advisory lock + 기본 트랜잭션 | 기본은 순서 있는 파일; `allowUnorderedMigrations`는 순서 검증만 완화하고 DDL 충돌은 해결하지 않음 | singleton Job/현 배포 전 단계에 실행 | **TS 코드 중심이면 1순위** |
| **Prisma Migrate** | TS-native지만 Prisma schema 도입이 전제 | `migrate deploy`가 advisory lock 사용 | lexical file order; branch 충돌은 rebase/squash를 수동 처리 | CI/CD 배포 명령으로 적합 | **Prisma 채택 의사가 있을 때만** |
| **Atlas** | Drizzle external schema 지원 | PostgreSQL advisory lock | `atlas.sum`이 divergent directory를 의도적으로 merge conflict로 만듦; linearize 필요 | CLI/Job에 적합 | **Drizzle 유지 + 강한 무결성 검사를 원하면 고려** |
| **Drizzle Kit** | 현재 코드베이스 의존성과 가장 가까움 | 확인된 PostgreSQL migrator에는 transaction만 있고 advisory lock 없음 | journal/index 충돌 위험; parent baseline에서 재생성 권고 | 별도 singleton Job·외부 락이 필요 | **단독 채택 비추천** |
| **Knex** | TS-friendly | built-in DB lock | linear filename ledger; DAG merge 없음 | CLI/Job에 무난 | **Kysely보다 선택 근거가 약함** |
| **Sqitch** | Perl/SQL CLI, TS/Drizzle 통합 없음 | target/advisory lock | append-only 중앙 `sqitch.plan`; 동시 추가는 Git conflict 후 사람이 순서 확인 | 공식 컨테이너로 PreSync Job 가능 | **SQL-first 중앙 통제가 필요할 때만** |
| **Flyway Community** | TS-native 아님 | DB lock | immutable linear SQL history; `outOfOrder`도 의미적 병합은 아님 | Docker/CI에 적합 | **언어 비종속 SQL 표준화 대안** |
| **Liquibase** | TS-native 아님 | `DATABASECHANGELOGLOCK` | ordered changelog; Git DAG merge 아님 | Job/CI에 적합 | **기능은 넓지만 현재 요구에는 과함** |
| **TypeORM / Umzug / dbmate** | 일부 TS-friendly | 조사 범위에서 기본 PostgreSQL 분산 락 없음 | 자동 Git-style merge 없음 | external lock + singleton Job 필요 | **우선순위 낮음** |

검증 근거: 제공된 저널에는 `SYNTHESIS.md`가 없어 후보별 독립 검증 상태를 인용할 수 없다. 위 표의 사실 근거는 [wave-1.md](wave-1.md) 및 [wave-2.md](wave-2.md)에 기록된 공식 문서·소스 조사 결과다.

## 1순위: Kysely Migrator + 단일 마이그레이션 실행 Job

Kysely Migrator가 현재 조건에서는 가장 균형이 좋다. TypeScript-native이며 PostgreSQL adapter가 advisory lock을 사용하고 기본적으로 트랜잭션으로 실행한다. 따라서 같은 환경에 대해 배포가 겹쳐도 마이그레이션 실행 자체는 DB가 직렬화한다.

> “Kysely Migrator: TypeScript-native; PostgreSQL adapter uses advisory lock and runs transactionally by default.” — [wave-1.md](wave-1.md)

다만 이것은 **실행 경합 해결**이지 **설계 충돌 해결**은 아니다. 각 브랜치는 독립적인 migration 파일을 만들고, PR 병합 전에 migration 디렉터리를 대상 브랜치 기준으로 rebase해 순서와 SQL을 검토하는 규칙을 둬야 한다. `allowUnorderedMigrations`는 기존 prefix-order 거부를 피할 수 있지만, 두 migration이 같은 테이블·컬럼을 모순되게 바꾸는 문제를 병합해 주지 않는다.

권장 운영 모델은 다음과 같다.

1. 마이그레이션은 애플리케이션 시작 시가 아니라 배포 파이프라인의 단일 Job에서 실행한다.
2. Job은 idempotent하게 `migrateToLatest()`를 실행하고, 성공 뒤에만 backend deploy를 진행한다.
3. PR 병합 전에는 최신 대상 브랜치에 rebase하고 migration 파일 순서와 동일 객체 변경을 리뷰한다.
4. 이미 배포된 migration은 수정하지 않고, 오류 수정은 새 forward migration으로만 한다.

현재 파이프라인은 이미 `migration → backend deploy → verification` 순서이며 Argo가 환경별 backend deploy를 직렬화한다. Kysely Job은 그 위치에 들어가므로 배포 구조를 크게 바꾸지 않아도 된다.

> “Deploy order is already migration → backend deploy → verification.” — [wave-1.md](wave-1.md)

## Drizzle을 계속 쓸 경우: Atlas 또는 Drizzle Kit + 외부 락

Drizzle을 스키마 정의의 중심으로 유지하려면 Atlas가 Drizzle Kit보다 안전한 후보다. Atlas는 Drizzle external schema와 PostgreSQL advisory lock을 지원하고, `atlas.sum`으로 migration directory가 서로 다르게 바뀌었음을 Git merge conflict로 의도적으로 노출한다. 즉 자동 병합 대신 **손실 없는 충돌 감지와 선형화 강제**를 제공한다.

> “`atlas.sum` deliberately makes divergent migration-directory changes merge-conflict, so teams rebase/rehash to retain linear history.” — [wave-1.md](wave-1.md)

주의할 점은 Community/OSS에서는 `migrate rebase`를 쓸 수 없다는 것이다. 따라서 Atlas를 선택해도 rebase/rehash 절차를 팀 운영 규칙으로 수동 수행해야 하며, 이 제약이 불편하면 유료 기능 검토가 필요하다.

Drizzle Kit은 현재 라이브러리와 가장 가깝지만, 조사된 PostgreSQL migrator에 advisory lock이 없고 migration journal/index의 병렬 생성 충돌도 기록되어 있다. 따라서 단독으로 Alembic multihead 문제를 대체하기에는 부족하다. 꼭 쓴다면 배포 단계의 singleton Job과 별도 PostgreSQL advisory lock을 애플리케이션 또는 wrapper에서 획득하고, merge 후 parent baseline 기준으로 migration을 재생성하는 규칙이 필요하다.

> “Parallel migration generation also has documented journal/index collision hazards; current advice is regenerate on the parent baseline.” — [wave-1.md](wave-1.md)

## 조건부 후보

Prisma Migrate는 `migrate deploy`가 CI/CD 전용 명령이고 PostgreSQL advisory lock을 사용하므로 배포 운영은 편하다. 그러나 Prisma schema를 새 SSOT로 도입해야 하고, 병렬 branch migration은 수동 rebase/squash가 필요하다. Drizzle 기반 서비스를 유지하려는 이 상황에서 마이그레이션 문제만을 위해 Prisma로 옮길 이유는 약하다.

Flyway Community와 Sqitch는 언어와 ORM을 분리한 SQL-first 운영에는 설득력 있다. Flyway는 DB lock과 immutable linear history, Sqitch는 advisory lock·`check`·`verify`를 제공한다. 하지만 둘 다 TypeScript 라이브러리가 아니며 Git식 자동 병합을 제공하지 않는다. 특히 Sqitch는 `sqitch.plan`의 중앙 append-only 계획 파일이 동시 변경 시 Git conflict가 난다.

> “Its plan is central and append-only; its own tutorial shows that concurrent branch additions create a `sqitch.plan` Git conflict and requires a human to check ordering after resolving it.” — [wave-2.md](wave-2.md)

Knex는 Kysely와 비슷하게 TS-friendly하고 DB lock을 갖지만, 선형 filename ledger 외에 현재 문제를 더 잘 푸는 기능은 확인되지 않았다. Liquibase는 changelog·lock 기능이 넓지만, 마찬가지로 Git DAG 병합은 제공하지 않아 현재 요구에는 복잡도 대비 이점이 제한적이다.

## 제외 또는 보류

TypeORM, Umzug, dbmate는 조사 범위에서 PostgreSQL 분산 migration lock을 기본 제공하지 않았다. 별도 락과 singleton Job을 직접 만들어야 하므로, 이미 lock을 내장한 Kysely·Prisma·Atlas·Knex보다 운영 이점이 적다.

롤백을 하지 않는 운영 원칙은 위 후보 선택과 충돌하지 않는다. 모든 후보에서 이미 적용된 migration을 수정·삭제하지 않고, 새 forward migration으로만 정정하는 정책을 명시하면 된다. Flyway의 paid rollback 기능이나 유료 Atlas rebase 기능은 이 원칙의 필수 조건이 아니다.

## 결정

**권장안은 Kysely Migrator를 migration 실행 책임으로 채택하고, Drizzle은 필요하다면 쿼리/스키마 동기화 역할로 분리하는 것이다.** 배포 전 단일 Job에서 실행하고, DB advisory lock과 트랜잭션을 활용한다. 브랜치 충돌은 도구의 자동 병합에 기대지 말고 PR merge 전 rebase·migration review로 선형화한다.

Drizzle schema를 SSOT로 반드시 유지해야 한다면 **Atlas Community + 수동 rebase/rehash 규칙**이 차선이다. Drizzle Kit 단독은 DB 수준 동시 실행 제어가 부족하므로 선택하지 않는다.

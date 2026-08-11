# 후보 비교

## 결론

**권고: Kysely Migrator를 단일 migration runner로 두고, 브랜치에서는 순번 충돌을 rebase로 정리한 뒤 배포한다.** PostgreSQL advisory lock과 기본 트랜잭션으로 동시 배포 실패를 직접 줄이면서 `allowUnorderedMigrations`로 도착 순서가 다른 파일을 받아들일 수 있다. 다만 어떤 후보도 상충하는 DDL을 Git처럼 의미적으로 자동 병합하지는 않는다. 따라서 Alembic의 multi-head를 라이브러리만 바꿔 제거할 수는 없고, migration 파일을 배포 전 선형화하는 팀 규칙과 단일 CI/Argo migration Job이 필요하다. 이 프로젝트의 현재 배포 순서도 migration → backend deploy → verification이므로 그 runner만 교체하는 형태가 맞다. [wave-1.md](wave-1.md) `Tool findings`, `Target-repository reality`

| 후보 | 정확히 검토한 버전 | 라이선스 | 유지보수 신호 (최신 릴리스/활동일) | 동시성/잠금 | 히스토리/병합 모델 | 기능 메모 (롤백 포함) | 판정 |
|---|---|---|---|---|---|---|---|
| Prisma Migrate | unknown — not gathered (PostgreSQL 구현 소스 revision `561d7b42579a2459cc8edf3788918b626c640023` 확인) | unknown — not gathered | unknown — not gathered | `migrate deploy`가 PostgreSQL advisory lock 사용 | 어휘순 파일의 선형 히스토리. 브랜치 충돌은 수동 rebase/squash | CI/CD용 `migrate deploy`. squash 지원. 롤백 정보: unknown — not gathered | 보류. 잠금은 적합하지만 Git식 병합을 해결하지 못하며, 현재 Drizzle 기반과 별도 ORM 도입 비용이 있다. |
| Drizzle Kit | 대상 저장소 설치본 `0.31.5`; PostgreSQL migrator 소스 revision `273c78071d4841b497f5144734b38294df7ec64b` 확인 | unknown — not gathered | unknown — not gathered | 트랜잭션은 있으나, 확인된 PostgreSQL migrator에 advisory lock 없음 | journal/index가 선형 상태를 추적. 병렬 생성 시 journal/index 충돌; parent baseline에서 재생성 권고 | 기존 `drizzle-orm 0.44.5`와 가장 가까움. 롤백 정보: unknown — not gathered | 비권고. 기존 스택 친화성은 높지만 현재의 동시 배포/병렬 브랜치 문제를 자체적으로 막지 못한다. |
| Kysely Migrator | unknown — not gathered (PostgreSQL adapter 소스 revision `f24018c789c3cf7ad03ccc672ada63a1ded87f88` 확인) | unknown — not gathered | unknown — not gathered | PostgreSQL advisory lock, 기본 트랜잭션 실행 | 기본은 prefix 순서 검증. `allowUnorderedMigrations`는 순서 거부를 완화하지만 상충 DDL을 해결하지 않음 | TS-native. 롤백 정보: unknown — not gathered | **권고.** 배포 레이스의 핵심인 DB 잠금과 원자 실행을 제공하고, 이 사용자에게 중요도가 낮은 롤백보다 forward-only 배포에 잘 맞는다. |
| Knex | unknown — not gathered | unknown — not gathered | unknown — not gathered | built-in DB lock | 파일명 ledger의 선형 히스토리, 브랜치 DAG 병합 없음 | TS-friendly. 롤백 정보: unknown — not gathered | 차선. 잠금은 충족하지만 Kysely보다 브랜치 순서 문제에 대한 명시적 완화 근거가 없다. |
| TypeORM | unknown — not gathered | unknown — not gathered | unknown — not gathered | 조사 경로에서 PostgreSQL distributed migration lock 기본 제공 없음; 전용 job + 외부 lock 필요 | unknown — not gathered | 롤백 정보: unknown — not gathered | 비권고. 추가 외부 잠금 없이는 배포 경쟁 조건을 해소하지 못한다. |
| Umzug | unknown — not gathered | unknown — not gathered | unknown — not gathered | 조사 경로에서 PostgreSQL distributed migration lock 기본 제공 없음; 전용 job + 외부 lock 필요 | unknown — not gathered | 롤백 정보: unknown — not gathered | 비권고. TypeORM과 같은 이유로 운영 장치를 별도 구현해야 한다. |
| dbmate | `v2.34.1` | unknown — not gathered | unknown — not gathered | lock 없음 | timestamp 기반 선형 히스토리 | SQL CLI. 롤백 정보: unknown — not gathered | 비권고. 배포 때 함께 실행하기는 쉽더라도 동시 실행 안전성을 제공하지 않는다. |
| Flyway Community | unknown — not gathered | unknown — not gathered | unknown — not gathered | database lock | immutable 선형 SQL 히스토리. `outOfOrder`도 의미적 브랜치 병합은 아님 | Docker/CI 적합, forward-only 사용에는 유료판 불필요. 롤백은 이 사용자의 요구에서 제외됐지만 관련 세부 정보는 unknown — not gathered | 보류. 운영 안정성은 좋지만 TS-native가 아니고 multi-head의 의미적 병합 해법도 아니다. |
| Liquibase | unknown — not gathered | unknown — not gathered | unknown — not gathered | `DATABASECHANGELOGLOCK` | changelog 순서 모델, Git DAG 병합 아님 | 유연한 changelog. 롤백 정보: unknown — not gathered | 보류. 잠금은 충족하지만 TS-native가 아니며 central ordering 충돌을 없애지 않는다. |
| Atlas | unknown — not gathered (확인 소스 revision `9a6bc601212130aaaefcbc8dd36c710baf9716ff`) | unknown — not gathered | unknown — not gathered | PostgreSQL advisory lock | `atlas.sum`이 분기된 migration-directory 변경을 의도적으로 merge conflict로 만든다. rebase/rehash로 선형 히스토리 유지 | Drizzle-compatible external schema. `migrate rebase`는 OSS/Community에서 불가하고 official/Pro 필요. 롤백 정보: unknown — not gathered | 조건부 보류. 명시적 충돌로 위험을 앞당겨 드러내지만, 팀이 원하는 병합 편의는 유료 기능 의존이며 자동 의미 병합은 아니다. |
| Sqitch | `v1.6.1` | MIT | current stable로 `v1.6.1`을 조사; 릴리스 날짜는 unknown — not gathered | PostgreSQL target/advisory lock | 의존성 메타데이터가 있으나 central append-only `sqitch.plan`; 동시 브랜치 추가는 Git conflict이고 사람이 순서를 점검 | hash divergence `sqitch check`, 실행 순서 `sqitch verify`, 공식 컨테이너로 singleton CI/ArgoCD PreSync Job 실행 가능. 롤백 정보: unknown — not gathered | 조건부 보류. 의존성 검증은 강점이나 Perl/SQL CLI로 TS/Drizzle 통합이 아니며 central plan 충돌은 남는다. |

## 운영 원칙

- migration은 애플리케이션 replica가 아니라 단일 CI/Argo Job에서 실행하고, DB advisory lock을 최후의 동시성 방어선으로 둔다.
- 각 PR은 migration 파일을 추가할 수 있지만, merge queue 또는 배포 직전에 기준 브랜치로 rebase하여 하나의 실행 순서를 확정한다. 순서 충돌·같은 객체를 바꾸는 DDL은 자동 병합 대상으로 취급하지 않고 사람이 해소한다.
- 배포된 migration은 forward-only immutable로 취급한다. 되돌림은 migration rollback 대신 새 corrective migration으로 수행한다.

## 근거 범위

표의 모든 확정 사실은 제공된 [wave-1.md](wave-1.md)와 [wave-2.md](wave-2.md)에 한정한다. 저널이 후보의 정확한 배포 버전, 라이선스 또는 최근 활동일을 수집하지 않은 경우에는 그 상태를 `unknown — not gathered`로 표시했다.

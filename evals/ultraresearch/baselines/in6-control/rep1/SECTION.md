## Git 같은 병합 모델의 실재 여부와 운영 대안

### 결론

조사한 도구 범위에서는 **두 개발자가 독립적으로 작성한 스키마·데이터 마이그레이션을 Git처럼 의미론적으로 자동 병합해 주는 모델은 확인되지 않았다.** 저널의 결론은 다음처럼 범위를 한정한다.

> “No examined source describes a tool that can safely synthesize a semantic merge of two independently authored, possibly conflicting schema/data migrations. This is a scoped research result, not a universal impossibility theorem.”

즉, “그런 도구가 세상에 절대 없다”는 주장이 아니라, 이번에 확인한 Alembic·Atlas·Flyway·Liquibase·Prisma·Sqitch에서는 찾지 못했다는 뜻이다. 이 도구들이 제공하는 것은 자동 의미 병합이 아니라 대체로 **순서 강제, 이력 무결성 검사, 명시적 merge revision, 미적용 파일 rebase, 또는 수동 조정**이다. [Wave 2 — Git-like merge premise](./wave-2.md#git-like-merge-premise)

검증 backing은 현재 제공된 디렉터리에 `SYNTHESIS.md`가 없어 연결할 수 없다. 따라서 아래의 “확인됨”은 저널에 기록된 독립 검증 결과의 범위만 뜻하며, REPORT 조립 시에는 생성된 `SYNTHESIS.md`의 해당 verified claims·contradictions 섹션으로 반드시 연결해야 한다. [Wave 2 — Verification outcome](./wave-2.md#verification-outcome)

### 왜 Alembic의 merge revision은 Git식 자동 병합이 아닌가

Alembic의 revision 이력은 DAG이고, 여러 head를 하나로 잇는 명시적 merge revision을 만들 수 있다. 그러나 저널이 구분한 핵심은 다음 문장이다.

> “Alembic is a revision DAG and can create an explicit merge revision; it does not semantically merge two competing SQL operations.”

merge revision의 본문에는 사람이 작성한 조정 로직을 넣을 수 있지만, Alembic이 두 변경의 의도를 해석해 충돌을 해결하는 것은 아니다. 그래서 multi-head를 “합칠 수 있다”는 사실과, 충돌하는 DDL·데이터 변환을 “안전하게 자동 병합한다”는 주장은 구분해야 한다. 검증 패스도 광범위한 부정 주장을 `partial`로 판정하면서, **Alembic merge 파일에는 사람이 작성한 reconciliation이 들어갈 수 있다**는 예외를 남겼다. [Wave 1 — Alembic multi-head symptom](./wave-1.md#axis-1--alembic-multi-head-symptom) · [Wave 2 — Verification outcome](./wave-2.md#verification-outcome)

### 가장 가까워 보이는 모델도 결국 선형 이력 관리다

Atlas의 `migrate rebase`는 이름 때문에 Git rebase와 비슷해 보이지만, 저널이 확인한 동작 범위는 더 좁다.

> “`atlas migrate rebase` only renames selected **unapplied** files and updates `atlas.sum`; it does not execute or merge SQL operations.”

Atlas는 기본적으로 선형 실행을 권장하며, non-linear 실행은 프로덕션에서 권장하지 않는다. 또한 Community Edition에는 핵심 versioned migration 명령이 포함되지만 rebase·lint·CI 통합은 제외되어 있어, 이를 PR 충돌 방지 체계의 핵심으로 삼으려면 상용 기능 경계를 확인해야 한다. [Wave 2 — Atlas conflict workflow](./wave-2.md#atlas-conflict-workflow)

나머지 후보도 같은 경계 안에 있다.

| 도구 | 이력·충돌 모델 | 배포 경합 제어 | 이 축에서의 판단 |
|---|---|---|---|
| Alembic | revision DAG와 명시적 merge revision; 조정 내용은 사람이 작성 | 이 저널 축에서는 별도 전역 직렬화 수단으로 확인되지 않음 | 그래프는 있으나 의미 자동 병합은 아님 |
| Prisma Migrate 7.9.1 | 이름순의 선형 committed SQL history; 브랜치 충돌은 reset/replay 등 수동 해결 | PostgreSQL에서 `pg_advisory_lock(72707369)`을 획득한 뒤 pending migration을 순차 적용 | ORM 채택이 가능할 때 강한 통합 선택지지만 Git식 병합은 아님 |
| Kysely 0.29.2 | 선형 migration history; strict order 또는 `allowUnorderedMigrations`; dependency DAG 없음 | DB lock table 내장 | PostgreSQL/TypeScript 소규모 팀의 유력 후보지만 선형 이력 규율이 필요 |
| node-pg-migrate 9.0.0 | PostgreSQL 전용, strict ordering | session advisory lock의 fail/wait 지원 | 실행 경합에는 강하지만 브랜치 병합 모델은 아님 |
| Knex 3.3.0 | timestamp 기반 선형 이력 | row lock; crash 뒤 stale lock은 `migrate:unlock` 필요 | 잠금 운영 부담이 남음 |
| Drizzle Kit 0.31.10 / ORM 0.45.2 | SQL 생성·적용과 로그 추적 | 조사한 안정 PostgreSQL 구현 범위에서는 advisory lock을 확인하지 못함 | 패키지 전체에 잠금이 없다는 보편 주장까지는 검증되지 않음 |
| Atlas 1.3.0 | 기본 선형 이력; 미적용 파일명·checksum rebase | advisory lock | delivery 제품으로 강하지만 rebase·lint·CI의 상용 경계 확인 필요 |

이 비교의 버전·라이선스·잠금 근거와 초기 선택 방향은 [Wave 1 — TypeScript candidates](./wave-1.md#axis-2--typescript-candidates), Prisma와 Atlas의 확장 검증은 [Wave 2 — Atlas conflict workflow](./wave-2.md#atlas-conflict-workflow) 및 [Wave 2 — Prisma current-lock verification](./wave-2.md#prisma-current-lock-verification)에 기록되어 있다.

### 실효적인 대안: 병합 자동화가 아니라 충돌을 더 일찍 드러내고 실행을 직렬화한다

문제는 두 층으로 나눠야 한다. **브랜치 이력 충돌**은 PR 전에 실패시키고, **배포 시 동시 실행 경합**은 단일 실행 주체와 DB 잠금으로 막는다. 한 도구가 두 문제를 동시에 의미론적으로 해결해 주지는 않는다.

1. **브랜치 단계에서 선형 이력을 강제한다.** DoorDash 사례처럼 앱별 migration manifest를 커밋하면 오래된 브랜치가 Git conflict를 일으켜, merge 전에 rebase하도록 강제할 수 있다. 저널의 표현은 다음과 같다.

   > “DoorDash commits a per-app migration manifest so a stale branch creates a Git conflict and must be rebased before merge.”

   이 방식은 SQL을 자동 병합하지 않는다. 대신 지금 “PR을 올리고서야 또는 머지 후에야” 보이는 분기를 일반 Git 충돌로 앞당겨, 작성자 로컬 또는 PR 초기에 드러내는 운영 장치다. [Wave 1 — Alembic multi-head symptom](./wave-1.md#axis-1--alembic-multi-head-symptom)

2. **마이그레이션 실행 주체를 하나로 만든다.** 애플리케이션의 모든 replica가 시작하면서 migration을 실행하게 두지 않고, CI/CD의 dedicated stage나 one-shot migration runner 하나만 실행한다.

   > “One-shot migration runner / dedicated deployment stage avoids all application replicas competing to migrate; a DB lock is defense in depth, not a branch-conflict resolver.”

   DB advisory lock은 runner 중복이나 재시도 같은 실행 경합을 막는 방어선이지, 서로 다른 브랜치가 만든 스키마 의도를 병합하는 장치가 아니다. [Wave 1 — operating methodology](./wave-1.md#axis-4--operating-methodology)

3. **배포 파이프라인 자체도 환경 단위로 직렬화한다.** Argo CD PreSync Job은 한 Application 안에서 리소스보다 먼저 migration을 실행하게 할 수 있지만, 서로 다른 Application 전체를 전역 직렬화하지는 않는다. GitLab resource group처럼 환경별 deployment concurrency를 제한하는 장치를 함께 둬야 한다. [Wave 1 — deployment integration](./wave-1.md#axis-3--deployment-integration)

4. **DDL을 무중단 호환 순서로 쪼갠다.** 오래된 앱과 새 앱이 동시에 존재하는 구간을 고려해 `expand → 호환 애플리케이션 배포 → backfill/validate → contract` 순서를 사용한다. 이는 migration graph를 병합하는 방법이 아니라, 병렬 개발과 순차 배포가 충돌해도 각 단계가 되돌릴 수 없는 장애로 번지지 않게 만드는 변경 방법론이다. [Wave 1 — operating methodology](./wave-1.md#axis-4--operating-methodology)

### 적용 판단

Acme처럼 PostgreSQL과 TypeScript 서비스가 중심이라면, 이 축에서의 선택 기준은 “Git식 자동 병합 지원 여부”가 아니라 다음 두 가지다.

- migration runner가 **신뢰할 수 있는 DB 잠금**을 제공하는가
- 팀이 **선형 이력·PR 조기 실패·단일 배포 실행**을 강제할 수 있는가

저널의 초기 선택 방향은 PostgreSQL/TypeScript-native 소규모 팀에는 Kysely, ORM까지 함께 채택할 수 있으면 Prisma, migration delivery 제품과 상용 CI 기능까지 허용하면 Atlas를 우선 검토하는 것이다. 어느 선택도 semantic merge를 제공하지 않으므로, 라이브러리 교체만으로 Alembic multi-head의 조직적 원인을 없앨 수는 없다. 실제 개선의 중심은 **manifest 또는 동등한 선형화 gate + PR 검사 + one-shot runner + DB lock + 환경별 배포 직렬화 + expand/contract** 조합이다. [Wave 1 — initial selection direction](./wave-1.md#axis-5--initial-selection-direction) · [Wave 2 — Git-like merge premise](./wave-2.md#git-like-merge-premise)

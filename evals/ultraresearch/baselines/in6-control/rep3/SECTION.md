## Git 같은 병합 모델의 실재 여부와 운영 대안

### 결론

조사한 범위에서는 두 개발자가 독립적으로 작성한 스키마·데이터 마이그레이션의 의미를 해석해 안전한 결과물로 자동 병합하는, 진정한 의미의 “Git 같은 병합” 라이브러리는 확인되지 않았다. 이는 보편적인 불가능성 증명이 아니라 이번에 Alembic, Atlas, Flyway, Liquibase, Prisma, Sqitch를 확인한 범위의 결론이다. 저널도 이 한계를 다음과 같이 명시한다.

> No examined source describes a tool that can safely synthesize a semantic merge of two independently authored, possibly conflicting schema/data migrations. This is a scoped research result, not a universal impossibility theorem.

([Wave 2 — Git-like merge premise](wave-2.md#git-like-merge-premise))

실제로 제공되는 것은 세 가지다. 첫째, Alembic처럼 분기된 이력을 DAG로 표현하고 사람이 명시적인 merge revision을 만드는 방식이다. 둘째, Atlas처럼 아직 적용되지 않은 마이그레이션의 순서·파일명·체크섬을 다시 맞추는 rebase 방식이다. 셋째, Prisma·Kysely·Flyway·Liquibase·Sqitch 계열처럼 선형 순서와 무결성 검사를 강제하고 충돌은 사람이 해소하는 방식이다. 따라서 이 문제의 실용적인 해법은 자동 의미 병합 도구를 찾는 것이 아니라, **Git 단계에서 충돌을 조기에 드러내고 → 병합 전에 이력을 선형화하고 → 배포 단계에서는 실행을 단일화·직렬화하는 것**이다. ([Wave 1 — Alembic multi-head symptom](wave-1.md#axis-1--alembic-multi-head-symptom), [Wave 2 — Git-like merge premise](wave-2.md#git-like-merge-premise))

> 검증 backing 상태: 이 디렉터리와 상위 경로에 `SYNTHESIS.md`가 제공되지 않아, 이 축에서 요구되는 SYNTHESIS 검증 인용은 연결할 수 없다. 아래 판단은 두 저널의 명시적 조사 결과와 Wave 2에 기록된 독립 검증 결과에 한정한다.

### “merge”와 “rebase”가 실제로 하는 일

**Alembic의 merge revision은 이력 그래프를 합치지만 SQL의 의미를 자동 병합하지 않는다.** 두 head를 부모로 갖는 새 revision을 만들어 그래프를 다시 한 줄로 이어갈 수 있고, 필요한 경우 그 revision 본문에 사람이 조정 SQL을 작성할 수 있다. 즉 Git의 merge commit과 닮은 것은 이력의 모양이지, 두 DDL·DML 변경의 안전한 합성 능력이 아니다. Wave 2의 검증도 광범위한 부정 명제를 부분 판정한 이유로 “Alembic merge files may contain manually written reconciliation”을 들었다. ([Wave 1](wave-1.md#axis-1--alembic-multi-head-symptom), [Wave 2 — Verification outcome](wave-2.md#verification-outcome), [Alembic branches 문서](https://alembic.sqlalchemy.org/en/latest/branches.html))

**Atlas의 `migrate rebase`도 의미 병합이 아니라 미적용 파일의 재정렬이다.** 저널의 표현대로 “only renames selected **unapplied** files and updates `atlas.sum`; it does not execute or merge SQL operations.” 기본 실행 모델은 선형이며, 운영 환경에서 비선형 실행은 권장되지 않는다. 또한 Community Edition에는 핵심 versioned migration 명령은 들어 있지만 rebase, lint, CI integration은 제외되어 있으므로, 이 워크플로를 도입하려면 상용 기능 경계를 함께 검토해야 한다. ([Wave 2 — Atlas conflict workflow](wave-2.md#atlas-conflict-workflow), [Atlas out-of-order FAQ](https://atlasgo.io/faq/out-of-order-migrations), [Atlas Community Edition](https://atlasgo.io/community-edition))

**Prisma 역시 Git형 그래프 병합 대신 잠금·순차 적용·수동 재생을 택한다.** 검증된 엔진 경로에서는 적용 전에 `acquire_lock()`을 호출하고, 이름을 기준으로 pending migration을 정한 뒤 순차 적용한다. PostgreSQL에서는 `pg_advisory_lock(72707369)`을 사용하지만, feature branch 충돌 해결은 reset/replay를 포함한 수동 절차다. 잠금은 동시에 두 배포가 DB를 변경하는 경합을 줄일 뿐, PR 두 개가 만든 스키마 변경의 논리 충돌을 해결하지 않는다. ([Wave 2 — Prisma current-lock verification](wave-2.md#prisma-current-lock-verification), [Prisma troubleshooting](https://www.prisma.io/docs/orm/prisma-migrate/workflows/troubleshooting))

### 권장 운영 모델: 충돌 발견 시점을 PR 이전으로 당긴다

Alembic multi-head를 merge 후나 배포 중에 처음 발견하는 현재 증상에는 다음의 연속된 통제가 가장 직접적이다.

1. **리포지터리에 단일 선형화 지점을 둔다.** 각 서비스·앱별 최신 migration 식별자를 담은 manifest 또는 단일 순번 파일을 함께 커밋한다. 서로 다른 브랜치가 새 migration을 추가하면 같은 파일을 수정하게 되어 Git 충돌이 발생하고, 뒤늦은 multi-head 대신 rebase 시점에 사람이 순서를 정하게 된다. DoorDash가 앱별 migration manifest를 커밋해 stale branch가 Git conflict를 내도록 만든 사례가 이 방식의 실무 근거다. ([Wave 1 — practitioner process evidence](wave-1.md#axis-1--alembic-multi-head-symptom), [DoorDash 사례](https://careersatdoordash.com/blog/tips-for-building-high-quality-django-apps-at-scale/))

2. **PR CI에서 이력 불변식을 검사한다.** 최소한 “head가 정확히 하나인가”, “기준 브랜치의 최신 migration 뒤에 놓였는가”, “revision ID·파일명이 중복되지 않는가”, “빈 DB와 현재 운영 스키마 양쪽에서 head까지 적용 가능한가”를 병합 조건으로 둔다. 이 검사는 SQL 의미를 병합하지 않지만, 지금 배포 단계까지 미뤄지는 구조적 충돌을 PR 단계에서 실패시킨다. Alembic 공식 cookbook은 DB revision이 head인지 검사하는 방법을 제공한다. ([Wave 1 — official branch and cookbook documentation](wave-1.md#axis-1--alembic-multi-head-symptom), [Alembic cookbook](https://alembic.sqlalchemy.org/en/latest/cookbook.html#test-current-database-revision-is-at-head-s))

3. **migration 실행 주체를 한 번의 release job으로 제한한다.** 애플리케이션의 모든 replica가 시작하면서 migration을 실행하지 말고, 배포 파이프라인의 전용 one-shot runner가 먼저 실행하도록 한다. DB advisory lock은 이 단일 실행 정책이 깨졌을 때를 위한 방어선이다. Prisma가 `migrate deploy`를 CI/CD release step으로 문서화한 방식이 이에 해당한다. ([Wave 1 — deployment integration](wave-1.md#axis-3--deployment-integration), [Prisma deployment guide](https://docs.prisma.io/docs/orm/prisma-client/deployment/deploy-database-changes-with-prisma-migrate))

4. **배포 파이프라인 자체도 환경별로 직렬화한다.** DB lock은 migration 프로세스만 보호하므로, 동일 환경으로 향하는 release 두 개의 순서를 CI resource group 같은 장치로 직렬화해야 한다. Argo CD의 PreSync Job은 한 Application 안에서 migration을 workload보다 먼저 실행하게 할 수 있지만, 서로 다른 Application 전체를 전역 직렬화한다고 볼 근거는 없다. ([Wave 1 — deployment integration](wave-1.md#axis-3--deployment-integration), [GitLab deployment safety](https://docs.gitlab.com/ci/environments/deployment_safety/), [Argo CD sync phases](https://argo-cd.readthedocs.io/en/release-3.1/user-guide/sync-waves/))

5. **스키마 변경은 forward-only expand–contract로 설계한다.** 먼저 하위 호환 스키마를 추가하고, 구·신 스키마와 모두 호환되는 애플리케이션을 배포한 뒤, backfill·검증을 거쳐 마지막에 구 스키마를 제거한다. 이는 migration history 충돌과 별개로, 롤링 배포 중 구버전·신버전 애플리케이션이 같은 DB를 공유하면서 생기는 실패를 줄인다. ([Wave 1 — operating methodology](wave-1.md#axis-4--operating-methodology), [GitLab migration style guide](https://docs.gitlab.com/development/migration_style_guide/))

### 도구 선택에 미치는 영향

TypeScript 진영으로 옮겨도 핵심 선택 기준은 “Git처럼 자동 병합하는가”가 아니라 **PR 단계의 선형 이력 통제, DB 수준 잠금, 배포 runner와의 결합 방식**이어야 한다.

- **Kysely 0.29.2**는 TypeScript 친화적이며 DB lock table을 제공하지만 dependency DAG는 없다. `allowUnorderedMigrations`보다 strict order를 유지하고 위의 manifest·CI gate를 결합하는 방향이 현재 증상에 맞다.
- **Prisma Migrate 7.9.1**은 ORM 도입이 허용될 때 committed SQL history, `migrate deploy`, 검증된 PostgreSQL advisory lock을 한 흐름으로 묶을 수 있다. 그래도 branch conflict는 수동 선형화 대상이다.
- **Atlas 1.3.0**은 migration delivery·lint·rebase·CI를 제품화한 선택지지만, 필요한 conflict workflow의 일부가 상용 범위다.
- **node-pg-migrate 9.0.0**은 PostgreSQL 전용으로 session advisory lock과 strict ordering을 제공하지만 그래프 병합 모델은 아니다.
- **Knex 3.3.0**은 선형 timestamp와 row lock을 사용하며, crash 뒤 stale lock에는 `migrate:unlock` 운영이 필요하다.
- **Drizzle Kit 0.31.10 / Drizzle ORM 0.45.2**는 SQL 생성·적용과 로그 추적은 확인됐으나, 조사한 stable PostgreSQL 구현 범위에서 distributed migration lock은 검증되지 않았다. 이 관찰만으로 패키지 전체에 잠금이 없다고 단정해서는 안 된다.

각 후보의 버전·라이선스·잠금·이력 모델에 대한 조사 원문은 [Wave 1 — TypeScript candidates](wave-1.md#axis-2--typescript-candidates)에 있으며, Prisma·Kysely·Atlas 직접 주장은 독립 검증에서 확인되었다. 광범위한 Drizzle 부재 주장은 부분 판정이다. ([Wave 2 — Verification outcome](wave-2.md#verification-outcome))

이 축의 권고는 **Alembic의 multi-head 기능을 더 적극적으로 쓰는 것보다, multi-head가 생기기 전에 Git 충돌과 CI gate로 단일 순서를 강제하는 것**이다. TypeScript 라이브러리 교체는 배포 잠금과 실행 경험을 개선할 수 있지만, 병렬 PR의 의미 충돌을 없애지는 않는다. 라이브러리 선택과 무관하게 manifest/sequence 충돌, PR 검사, one-shot runner, 환경별 직렬화, expand–contract를 하나의 운영 계약으로 묶어야 한다.

### 연구 추적

- 조사 저널: [wave-1.md](wave-1.md), [wave-2.md](wave-2.md)
- 검증 backing: `SYNTHESIS.md` 미제공 — 상대 링크를 생성하지 않음

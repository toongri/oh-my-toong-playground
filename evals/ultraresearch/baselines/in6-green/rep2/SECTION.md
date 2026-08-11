## Git 같은 병합 모델의 실재 여부와 운영 대안

### 결론

현재 조사 범위에서는 **서로 독립적으로 작성되어 충돌할 수도 있는 스키마·데이터 마이그레이션 두 개를 Git처럼 자동으로 의미 병합해 주는 도구는 확인되지 않았다.** 저널의 표현 그대로, “No examined source describes a tool that can safely synthesize a semantic merge of two independently authored, possibly conflicting schema/data migrations.” 다만 이는 보편적 불가능성의 증명이 아니라, Alembic·Atlas·Flyway·Liquibase·Prisma·Sqitch의 공식 자료를 확인한 범위에서 얻은 결론이다. 또한 독립 검증은 이 넓은 부정 명제를 `partial`로 판정했다. 따라서 선택 기준은 “자동 병합 기능이 있는가”가 아니라 **충돌을 PR 전에 드러내는 선형 이력 규칙, 실행 경합을 막는 잠금, 배포 직렬화, 호환 가능한 스키마 변경 절차를 함께 제공하는가**여야 한다. ([Wave 2 — Git-like merge premise와 Verification outcome](./wave-2.md#git-like-merge-premise))

> “Alembic is a revision DAG and can create an explicit merge revision; it does not semantically merge two competing SQL operations.”

Alembic의 merge revision은 갈라진 revision DAG를 다시 한 head로 잇는 **그래프 합류 지점**이다. 충돌하는 DDL/DML의 의도를 자동 조정하는 병합기가 아니며, 필요한 조정은 merge revision 본문에 사람이 작성해야 한다. 즉 현재 겪는 multi-head 문제는 “병합 기능이 전혀 없음”보다 **분기된 이력을 언제 탐지하고 누가 재조정할지에 대한 게이트가 늦다**는 문제에 가깝다. ([Wave 1 — Axis 1](./wave-1.md#axis-1--alembic-multi-head-symptom), [Alembic branch 문서](https://alembic.sqlalchemy.org/en/latest/branches.html))

Atlas의 `migrate rebase`도 Git의 의미 병합과 다르다. 저널이 확인한 동작은 “only renames selected **unapplied** files and updates `atlas.sum`; it does not execute or merge SQL operations.”이다. 기본 실행 모델은 선형이며, 비선형 실행은 운영 환경에서 권장되지 않는다. 더구나 rebase·lint·CI integration은 Community Edition 범위 밖이므로, 이 방식을 채택하려면 상용 기능 경계까지 비용·운영 판단에 포함해야 한다. ([Wave 2 — Atlas conflict workflow](./wave-2.md#atlas-conflict-workflow), [Atlas out-of-order/rebase](https://atlasgo.io/faq/out-of-order-migrations), [Atlas Community Edition](https://atlasgo.io/community-edition))

Flyway·Liquibase·Prisma·Sqitch도 같은 계열이다. 이들은 순서, 체크섬·무결성, 수동 조정으로 이력을 통제하지, 충돌하는 변경의 의미를 합성하지 않는다. Prisma의 기능 브랜치 충돌 해법도 reset/replay를 포함한 수동 조정이며 graph merge가 아니다. ([Wave 2 — Git-like merge premise](./wave-2.md#git-like-merge-premise), [Prisma troubleshooting](https://www.prisma.io/docs/orm/prisma-migrate/workflows/troubleshooting))

### 실무에서 쓰는 대체 모델

Git과 가장 비슷하게 운영할 수 있는 모델은 **DB 변경의 의미 병합을 도구에 맡기는 것**이 아니라, 아직 적용되지 않은 마이그레이션을 일반 Git 충돌·rebase 대상으로 바꾸고 DB 적용 이력은 선형으로 유지하는 것이다.

1. **PR 이전 또는 PR 생성 즉시 이력 분기를 실패시킨다.** 마이그레이션 manifest나 단일 head 검사를 CI의 빠른 필수 체크로 둔다. Alembic은 현재 DB revision이 head인지 검사하는 cookbook 패턴을 제공한다. 브랜치가 오래되어 새 migration 번호나 manifest가 충돌하면 먼저 최신 main을 rebase하고, 미적용 migration을 다시 생성하거나 사람이 조정한다. ([Wave 1 — Axis 1](./wave-1.md#axis-1--alembic-multi-head-symptom), [Alembic cookbook](https://alembic.sqlalchemy.org/en/latest/cookbook.html#test-current-database-revision-is-at-head-s))
2. **배포 시 migration runner를 하나만 실행한다.** 앱 replica 각각이 시작하면서 migration을 실행하지 않고, 전용 CI/CD 단계나 one-shot Job 한 개가 적용한다. DB advisory lock은 두 runner가 우연히 겹칠 때의 방어선이지, 브랜치 충돌 해결책은 아니다. Prisma는 `migrate deploy`를 CI/CD release step으로 문서화하고 PostgreSQL에서 `pg_advisory_lock(72707369)`을 잡은 뒤 migration 이름 순서로 적용한다. Kysely와 node-pg-migrate도 잠금 수단이 있고, Knex는 row lock을 쓰지만 비정상 종료 뒤 stale lock을 별도로 풀어야 할 수 있다. ([Wave 1 — Axis 2·3·4](./wave-1.md#axis-2--typescript-candidates), [Wave 2 — Prisma current-lock verification](./wave-2.md#prisma-current-lock-verification))
3. **환경 단위 배포 자체를 직렬화한다.** Argo CD PreSync Job은 한 Application 안에서 migration을 workload보다 먼저 실행할 수 있지만, 서로 다른 Application 전체를 전역 직렬화하지는 않는다. 따라서 동일 DB를 공유하는 배포 파이프라인에는 환경 단위 mutex/resource group 같은 별도 잠금이 필요하다. GitLab resource groups가 그 예다. ([Wave 1 — Axis 3](./wave-1.md#axis-3--deployment-integration), [Argo CD sync waves](https://argo-cd.readthedocs.io/en/release-3.1/user-guide/sync-waves/), [GitLab resource groups](https://docs.gitlab.com/ci/environments/deployment_safety/))
4. **병렬 배포에도 안전한 forward-only 변경 순서를 사용한다.** `expand → 구·신 버전 모두와 호환되는 애플리케이션 배포 → backfill/검증 → contract` 순서로 파괴적 변경을 뒤로 미룬다. 이 절차는 migration 이력 충돌과 별개로, rolling deployment 중 구버전 코드와 신버전 스키마가 겹치는 실패를 줄인다. ([Wave 1 — Axis 4](./wave-1.md#axis-4--operating-methodology), [GitLab migration style guide](https://docs.gitlab.com/development/migration_style_guide/))

### 저널에 수집된 실무자 사례

#### DoorDash — migration manifest를 Git 충돌 장치로 사용

- **누가:** DoorDash의 Django 운영 팀.
- **무엇을 하는가:** 앱별 migration manifest를 저장소에 커밋한다. 오래된 브랜치가 새 migration을 추가하면 manifest에서 Git 충돌이 나므로, merge 전에 최신 main으로 rebase하고 migration 이력을 정리해야 한다. DB migration의 의미를 자동 병합하는 방식이 아니라 **분기 사실을 코드 리뷰보다 앞선 Git 병합 단계에서 가시화**하는 방식이다.
- **출처:** [DoorDash, *Tips for Building High-Quality Django Apps at Scale*](https://careersatdoordash.com/blog/tips-for-building-high-quality-django-apps-at-scale/), [Wave 1 — Axis 1](./wave-1.md#axis-1--alembic-multi-head-symptom)

#### GitLab — expand/contract와 환경별 배포 직렬화

- **누가:** GitLab의 애플리케이션·배포 운영 가이드.
- **무엇을 하는가:** migration은 호환성을 유지하는 단계적 변경으로 설계하고, resource group으로 동일 환경을 대상으로 한 배포를 직렬화한다. 전자는 구·신 애플리케이션 버전의 동시 존재를 견디게 하고, 후자는 독립 파이프라인이 같은 환경에서 경합하지 않게 한다.
- **출처:** [GitLab migration style guide](https://docs.gitlab.com/development/migration_style_guide/), [GitLab deployment safety — resource groups](https://docs.gitlab.com/ci/environments/deployment_safety/), [Wave 1 — Axis 3·4](./wave-1.md#axis-3--deployment-integration)

### TypeScript 진영에서의 선택 의미

라이브러리를 바꾸더라도 병합 정책은 사라지지 않는다. 조사 저널의 초기 선택 방향은 PostgreSQL·TypeScript 소규모 팀에는 DB lock이 내장된 **Kysely**, ORM까지 함께 채택할 수 있으면 **Prisma**, migration delivery와 CI 통제를 제품으로 사고 상용 기능 경계를 받아들일 수 있으면 **Atlas**다. 세 선택 모두 선형 이력 거버넌스가 필요하다. node-pg-migrate도 PostgreSQL 전용으로 advisory lock과 strict ordering을 제공하므로 SQL 중심 팀의 후보가 될 수 있다. 반대로 Drizzle은 조사된 PostgreSQL migrator 구현 범위에서 advisory lock을 확인하지 못했지만, 저널의 독립 검증도 이를 패키지 전체의 부재로 일반화할 수 없다고 판정했다. ([Wave 1 — Axis 2·5](./wave-1.md#axis-2--typescript-candidates), [Wave 2 — Verification outcome](./wave-2.md#verification-outcome))

따라서 이 문제에 대한 권고안은 **“Git 같은 DB 의미 병합 라이브러리”를 찾는 것보다 `manifest/head CI gate + 미적용 migration rebase·재생성 + 단일 runner + DB lock + 환경별 배포 mutex + expand/contract`를 하나의 운영 계약으로 만드는 것**이다. 이 조합은 사용자가 겪는 두 실패를 서로 다른 층에서 다룬다. manifest/head gate는 PR 이전·PR 시점에 분기를 드러내고, 단일 runner·lock·배포 mutex는 merge 이후 실제 적용 경합을 막는다.

### 근거 추적과 검증 상태

- 이 절에서 직접 사용한 연구 저널: [wave-1.md](./wave-1.md), [wave-2.md](./wave-2.md).
- 저널이 기록한 독립 검증은 Prisma·Kysely·Atlas의 직접 주장들을 확인했지만, “안전한 의미적 자동 병합 도구가 없다”는 넓은 부정 주장과 Drizzle의 잠금 부재 주장은 `partial`로 제한했다. ([Wave 2 — Verification outcome](./wave-2.md#verification-outcome))
- 요구된 검증 근거 문서 `SYNTHESIS.md`는 현재 입력 디렉터리에 제공되지 않았다. 따라서 존재하지 않는 파일을 검증 근거로 인용하지 않았으며, 이 절을 최종 REPORT에 합칠 때에는 위 각 주장에 대응하는 `SYNTHESIS.md`의 verified claims·contradictions·gaps 앵커를 연결해야 한다.

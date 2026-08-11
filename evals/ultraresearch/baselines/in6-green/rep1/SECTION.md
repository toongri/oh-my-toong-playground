## Git 같은 병합 모델의 실재 여부와 운영 대안

**결론부터 말하면, 조사한 도구들 가운데 서로 독립적으로 작성된 스키마·데이터 마이그레이션의 의미를 해석해 안전하게 자동 병합하는 “Git 같은” 모델은 확인되지 않았다.** 다만 이는 조사 범위의 결론이지 보편적인 불가능성 증명은 아니다. Alembic의 merge revision은 갈라진 revision DAG를 다시 잇는 장치이며, 충돌하는 SQL의 의미론적 해결은 사람이 작성해야 한다. Atlas의 `migrate rebase`도 아직 적용하지 않은 파일의 이름과 체크섬을 다시 정렬할 뿐 SQL 연산을 합치지 않는다. Flyway, Liquibase, Prisma, Sqitch 역시 순서·무결성 검사 또는 수동 조정을 택한다. 이 넓은 부정 명제는 독립 검증에서 **partial**로 판정됐다. Alembic merge 파일에는 사람이 조정 코드를 넣을 수 있으므로 “병합이 전혀 없다”가 아니라 **자동 의미론 병합이 확인되지 않았다**고 읽어야 한다. ([Wave 2 — Git-like merge premise](./wave-2.md#git-like-merge-premise), [Wave 2 — Verification outcome](./wave-2.md#verification-outcome), [SYNTHESIS — contradictions](./SYNTHESIS.md#contradictions), [SYNTHESIS — gaps](./SYNTHESIS.md#gaps))

> “No examined source describes a tool that can safely synthesize a semantic merge of two independently authored, possibly conflicting schema/data migrations. This is a scoped research result, not a universal impossibility theorem.”
>
> — [wave-2.md](./wave-2.md#git-like-merge-premise)

### 무엇이 Git과 비슷하고, 무엇이 다른가

마이그레이션 도구들이 제공하는 기능은 세 층으로 나눠야 한다.

| 층 | 실제 제공되는 것 | 해결하지 못하는 것 |
|---|---|---|
| 이력 구조 | Alembic의 revision DAG와 명시적 merge revision | 두 SQL 변경이 논리적으로 양립하는지 판단하고 자동 조정하는 일 |
| 이력 정렬·검사 | Atlas의 미적용 파일 rebase와 `atlas.sum`, Flyway/Liquibase/Prisma/Sqitch의 순서·무결성 검사 | 같은 테이블·컬럼·데이터를 건드린 두 변경의 의미론적 충돌 해결 |
| 배포 동시성 제어 | Prisma·Kysely·node-pg-migrate·Atlas 등의 DB lock, 배포 파이프라인 직렬화 | PR 단계의 분기 충돌 탐지와 병합 |

따라서 **이력 그래프**, **브랜치 충돌 예방**, **운영 배포 경합 방지**는 서로 다른 문제다. 특히 DB advisory lock은 동시에 두 배포가 마이그레이션을 실행하는 상황을 막는 방어선이지, 두 Git 브랜치의 마이그레이션을 병합하는 기능이 아니다. 저널도 이를 “a DB lock is defense in depth, not a branch-conflict resolver”라고 구분한다. ([Wave 1 — Alembic symptom](./wave-1.md#axis-1--alembic-multi-head-symptom), [Wave 1 — operating methodology](./wave-1.md#axis-4--operating-methodology), [SYNTHESIS — findings by theme](./SYNTHESIS.md#findings-by-theme))

Atlas는 이 경계를 가장 명시적으로 보여준다. 기본 실행은 선형이고 production에서 non-linear 실행은 권장되지 않는다. `atlas migrate rebase`는 선택한 **미적용** 파일을 rename하고 `atlas.sum`을 갱신하지만 SQL을 실행하거나 병합하지 않는다. 또한 저널이 조사한 Atlas 1.3.0 기준으로 rebase·lint·CI integration은 Community Edition의 범위를 벗어난다. 즉 Git 같은 의미론 병합 엔진이라기보다, 유료 기능을 포함한 **선형 이력 사전 검증·재정렬 제품**에 가깝다. ([Atlas out-of-order migrations](https://atlasgo.io/faq/out-of-order-migrations), [Atlas versioned apply](https://atlasgo.io/versioned/apply), [Atlas Community Edition](https://atlasgo.io/community-edition), [Wave 2 — Atlas conflict workflow](./wave-2.md#atlas-conflict-workflow), [SYNTHESIS — verified claims](./SYNTHESIS.md#verified-claims))

### 운영 대안: 자동 병합 대신 충돌을 앞당기고 실행을 직렬화한다

실무적인 대안은 하나의 라이브러리에 병합 책임을 몰아넣는 것이 아니라, 실패 지점을 PR 이전 또는 PR 단계로 당기고 배포 실행은 한 곳에서 직렬화하는 것이다.

1. **선형 migration history를 팀 규칙으로 고정한다.** 새 마이그레이션을 만든 브랜치는 최신 main을 rebase한 뒤 순서·checksum·현재 head를 검사한다. Alembic을 유지한다면 CI에서 DB가 단일 head인지 확인하고, multi-head가 생기면 자동 배포 전에 실패시킨다. Alembic 공식 cookbook에는 DB revision이 head인지 테스트하는 방식이 있다. ([Alembic cookbook](https://alembic.sqlalchemy.org/en/latest/cookbook.html#test-current-database-revision-is-at-head-s), [Wave 1 — symptom](./wave-1.md#axis-1--alembic-multi-head-symptom), [SYNTHESIS — findings by theme](./SYNTHESIS.md#findings-by-theme))
2. **PR에서 반드시 충돌하는 작은 manifest 또는 단일 순서 파일을 둔다.** 각 브랜치가 같은 파일을 갱신하게 하면 오래된 브랜치는 Git conflict를 만나 rebase 없이 합쳐지지 않는다. 이는 SQL 의미를 자동 병합하지 않지만 “머지 후에야 multi-head를 발견”하는 시점을 코드 리뷰 전으로 앞당긴다. ([DoorDash 사례](https://careersatdoordash.com/blog/tips-for-building-high-quality-django-apps-at-scale/), [Wave 1 — symptom](./wave-1.md#axis-1--alembic-multi-head-symptom), [SYNTHESIS — findings by theme](./SYNTHESIS.md#findings-by-theme))
3. **마이그레이션 실행 주체를 하나로 만든다.** 애플리케이션 replica 각각이 부팅하면서 migrate하지 않고, one-shot runner나 전용 deployment stage 하나만 실행한다. DB lock은 이 단일 실행 경로가 중복 기동될 때를 대비한 2차 방어선으로 둔다. Prisma는 `migrate deploy`를 CI/CD release step으로 실행하고 advisory locking을 유지하도록 문서화한다. ([Prisma deployment guide](https://docs.prisma.io/docs/orm/prisma-client/deployment/deploy-database-changes-with-prisma-migrate), [Wave 1 — deployment integration](./wave-1.md#axis-3--deployment-integration), [Wave 2 — Prisma verification](./wave-2.md#prisma-current-lock-verification), [SYNTHESIS — verified claims](./SYNTHESIS.md#verified-claims))
4. **환경 단위 배포도 직렬화한다.** Argo CD의 PreSync Job은 한 Application 안에서는 workload보다 먼저 migration을 수행할 수 있지만, 서로 다른 Application 전체를 전역 직렬화하지는 않는다. 따라서 여러 Application이 같은 DB를 공유한다면 GitLab resource group 같은 환경 단위 mutex나 별도의 중앙 migration pipeline이 필요하다. 이 중 Argo CD의 전역 직렬화 한계는 sync-wave 계약에서 도출한 추론이다. ([Argo CD sync phases and waves](https://argo-cd.readthedocs.io/en/release-3.1/user-guide/sync-waves/), [GitLab deployment safety](https://docs.gitlab.com/ci/environments/deployment_safety/), [Wave 1 — deployment integration](./wave-1.md#axis-3--deployment-integration), [SYNTHESIS — findings by theme](./SYNTHESIS.md#findings-by-theme))
5. **변경 자체는 forward-only expand → compatible app deploy → backfill/validate → contract로 쪼갠다.** 이 방식은 구버전과 신버전 애플리케이션이 겹쳐 실행되는 시간에도 스키마 호환성을 유지해, 순서 충돌이 곧 장애로 번지는 위험을 줄인다. ([Alembic cookbook](https://alembic.sqlalchemy.org/en/latest/cookbook.html), [GitLab migration style guide](https://docs.gitlab.com/development/migration_style_guide/), [Wave 1 — operating methodology](./wave-1.md#axis-4--operating-methodology), [SYNTHESIS — findings by theme](./SYNTHESIS.md#findings-by-theme))

### 저널에 수집된 practitioner accounts

#### DoorDash — 충돌을 의도적으로 Git PR 단계에 노출

DoorDash는 앱별 migration manifest를 저장소에 커밋한다. stale branch가 새 migration을 추가하면 manifest에서 Git conflict가 나도록 만들어, merge 전에 최신 main으로 rebase하고 migration 순서를 다시 확정하게 한다. 저널이 직접 기록한 표현은 다음과 같다.

> “DoorDash commits a per-app migration manifest so a stale branch creates a Git conflict and must be rebased before merge.”
>
> — [wave-1.md](./wave-1.md#axis-1--alembic-multi-head-symptom), [DoorDash 원문](https://careersatdoordash.com/blog/tips-for-building-high-quality-django-apps-at-scale/)

이 사례의 핵심은 자동 의미론 병합이 아니라 **충돌의 관측 시점을 배포·머지 후에서 PR로 이동**시키는 것이다. ([SYNTHESIS — findings by theme](./SYNTHESIS.md#findings-by-theme))

#### GitLab — 환경 배포 직렬화와 단계적 스키마 변경

GitLab은 resource group으로 환경별 deployment job을 직렬화하는 방법을 문서화하고, migration style guide에서는 old/new application version이 공존할 수 있도록 변경을 단계화하는 운영법을 제시한다. 전자는 같은 환경에 대한 동시 배포를 막고, 후자는 migration과 애플리케이션 rollout 사이의 호환성 창을 관리한다. 둘 다 브랜치 SQL을 자동 병합하지는 않지만, 실제 장애를 만드는 두 경합면을 각각 줄인다. ([GitLab deployment safety](https://docs.gitlab.com/ci/environments/deployment_safety/), [GitLab migration style guide](https://docs.gitlab.com/development/migration_style_guide/), [Wave 1 — deployment integration](./wave-1.md#axis-3--deployment-integration), [Wave 1 — operating methodology](./wave-1.md#axis-4--operating-methodology), [SYNTHESIS — findings by theme](./SYNTHESIS.md#findings-by-theme))

### 이 질문에 대한 권고

현재 증상에는 “Git처럼 알아서 합쳐 주는 라이브러리”를 찾기보다 **선형 이력 + PR gate + 단일 migration runner + DB advisory lock + expand/contract**를 하나의 운영 계약으로 도입하는 편이 맞다. Alembic을 당장 교체하지 않아도 manifest conflict와 single-head CI 검사를 먼저 넣으면 발견 시점을 앞당길 수 있다. TypeScript로 전환한다면 Kysely·Prisma·node-pg-migrate·Atlas 같은 후보의 lock은 배포 경합 완화에 도움이 되지만, 어느 것을 택해도 브랜치 병합 규칙은 별도로 필요하다. Prisma·Kysely·Atlas의 직접 기능 주장은 독립 검증에서 확인됐지만, “어떤 도구도 의미론 병합을 제공하지 않는다”는 전면적 명제는 검증 상태가 partial이므로 의사결정 문구도 조사 범위에 한정해야 한다. ([Wave 1 — TypeScript candidates](./wave-1.md#axis-2--typescript-candidates), [Wave 2 — Verification outcome](./wave-2.md#verification-outcome), [SYNTHESIS — verified claims](./SYNTHESIS.md#verified-claims), [SYNTHESIS — gaps](./SYNTHESIS.md#gaps))

연구 추적: [wave-1.md](./wave-1.md) · [wave-2.md](./wave-2.md) · [SYNTHESIS.md](./SYNTHESIS.md)

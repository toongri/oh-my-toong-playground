## Git 같은 병합 모델의 실재 여부와 운영 대안

**결론부터 말하면, 조사한 도구 중 Git처럼 서로 독립적으로 작성된 두 스키마·데이터 마이그레이션의 의미를 해석해 안전하게 자동 병합하는 도구는 없었다.** 다만 이는 조사 범위 안의 결과이지 “그런 도구는 절대 존재할 수 없다”는 보편적 불가능성 주장은 아니다. 실제 도구가 제공하는 것은 (1) 분기 이력을 한 지점으로 잇는 명시적 merge revision, (2) 아직 적용하지 않은 파일의 순서 재정렬과 체크섬 갱신, (3) 선형 순서·무결성 검사, (4) 배포 시 동시 실행 잠금이다. 이들은 모두 충돌을 드러내거나 실행을 직렬화할 뿐, 서로 경쟁하는 SQL의 의미를 합성하지 않는다. ([Wave 2 — Git-like merge premise](./wave-2.md#git-like-merge-premise), 검증 백킹 상태는 아래 참고)

> “No examined source describes a tool that can safely synthesize a semantic merge of two independently authored, possibly conflicting schema/data migrations. This is a scoped research result, not a universal impossibility theorem.”
>
> — [Wave 2](./wave-2.md#git-like-merge-premise)

### ‘Git 같은 기능’을 나누어 보면

| 원하는 성질 | 조사 결과 | 실제로 가능한 대응 |
|---|---|---|
| 두 브랜치의 마이그레이션을 의미적으로 자동 병합 | 조사 범위에서는 없음. 같은 테이블·컬럼·데이터를 건드리는 두 SQL의 의도와 호환성은 사람이 판정해야 한다. | PR 전에 충돌을 강제로 드러내고, rebase 후 사람이 새 선형 이력을 만든다. |
| 분기된 이력을 DAG에서 다시 연결 | Alembic은 가능하지만, merge revision은 두 head를 가리키는 새 노드일 뿐이다. 필요한 조정 SQL은 사람이 본문에 작성할 수 있다. | `alembic merge`를 자동 해결로 간주하지 말고, 수동 reconciliation 지점으로 취급한다. |
| Git rebase처럼 아직 배포하지 않은 이력 재정렬 | Atlas의 `atlas migrate rebase`가 가장 가까우나 **미적용 파일 이름을 바꾸고 `atlas.sum`을 갱신**할 뿐 SQL을 실행하거나 병합하지 않는다. 기본 실행 모델도 선형이며, 비선형 실행은 프로덕션에서 권장되지 않는다. 이 rebase·lint·CI 기능은 Community Edition 범위 밖이다. | 미적용 이력만 CI에서 rebase하고, 이미 적용된 migration은 불변으로 둔다. ([Atlas 공식 설명](https://atlasgo.io/faq/out-of-order-migrations), [Community Edition 범위](https://atlasgo.io/community-edition)) |
| 같은 migration 이력인지 확인 | Atlas의 `atlas.sum`, Flyway/Liquibase/Prisma/Sqitch의 순서·무결성 검사가 이 역할에 가깝다. | 체크섬과 순서 검사를 required check로 두어 merge 전에 실패시킨다. |
| 두 배포가 동시에 migration을 실행하지 못하게 함 | Prisma, Kysely, node-pg-migrate, Atlas 등은 DB 잠금 수단을 제공하지만 브랜치 충돌은 해결하지 않는다. | migration 전용 one-shot runner 하나와 DB advisory lock을 함께 사용한다. |

Atlas의 범위는 저널에서 다음과 같이 명시돼 있다.

> “`atlas migrate rebase` only renames selected **unapplied** files and updates `atlas.sum`; it does not execute or merge SQL operations.”
>
> — [Wave 2 — Atlas conflict workflow](./wave-2.md#atlas-conflict-workflow)

Alembic 역시 “Git 같은 그래프”와 “Git 같은 자동 병합”을 구분해야 한다.

> “Alembic is a revision DAG and can create an explicit merge revision; it does not semantically merge two competing SQL operations.”
>
> — [Wave 1 — Alembic multi-head symptom](./wave-1.md#axis-1--alembic-multi-head-symptom)

따라서 지금 겪는 문제를 **작성 시점의 경합**, **배포 시점의 경합**, **구·신 애플리케이션의 호환성**이라는 세 층으로 분리해야 한다. 하나의 라이브러리로 세 층을 모두 해결하려 하면 multi-head를 다른 형태의 선형-history 충돌로 옮길 뿐이다.

### 권장 운영 모델: 자동 병합 대신 ‘충돌 조기화 + 선형화 + 직렬화’

1. **PR 전 또는 PR 생성 직후, 기준 브랜치와 합친 상태에서 migration 검사를 돌린다.** 현재 head/manifest/checksum을 기준 브랜치와 비교하고, stale branch나 out-of-order migration이면 required check를 실패시킨다. 실패한 브랜치는 기준 브랜치를 rebase한 뒤 migration을 다시 생성하거나 번호를 재정렬한다. 이 단계가 “PR을 올리고서야 또는 머지 후에야” 알게 되는 시간을 PR 작성 중으로 당긴다.
2. **미적용 migration만 재작성한다.** 이미 어떤 환경에든 적용된 migration은 수정·재정렬하지 않고 새 forward migration으로 보정한다. Atlas rebase도 미적용 파일만 대상으로 한다는 점이 이 경계를 잘 보여준다. ([Wave 2 — Atlas conflict workflow](./wave-2.md#atlas-conflict-workflow))
3. **애플리케이션 replica가 아니라 전용 migration job 하나만 실행한다.** CI/CD 또는 Argo CD PreSync의 one-shot Job에서 migration을 실행하고 성공 후 애플리케이션을 배포한다. Argo CD PreSync는 한 Application 안의 순서는 만들지만 서로 다른 Application 전체를 전역 직렬화하지는 않으므로, 공유 DB라면 CI 환경 mutex나 별도 coordinator가 필요하다. ([Argo CD sync phases/waves](https://argo-cd.readthedocs.io/en/release-3.1/user-guide/sync-waves/), [Wave 1 — deployment integration](./wave-1.md#axis-3--deployment-integration))
4. **DB advisory lock을 방어선으로 유지한다.** 잠금은 중복 실행과 동시 DDL을 막지만 잘못 병합된 migration history를 고치지 않는다. 예를 들어 Prisma는 migration을 읽고 적용하기 전에 `acquire_lock()`을 호출하고 PostgreSQL에서는 `pg_advisory_lock(72707369)`을 사용하며, feature-branch 충돌은 여전히 수동 reset/replay 대상이다. 이 직접 구현 주장은 독립 검증에서 확인됐다. ([Wave 2 — Prisma current-lock verification](./wave-2.md#prisma-current-lock-verification))
5. **파괴적 변경은 expand → 호환 애플리케이션 배포 → backfill/validate → contract 순서로 쪼갠다.** migration 순서가 선형이어도 구·신 버전 애플리케이션이 동시에 존재하면 즉시 rename/drop은 실패할 수 있다. 이 절차는 history 충돌이 아니라 런타임 호환성 충돌을 다룬다. ([Wave 1 — operating methodology](./wave-1.md#axis-4--operating-methodology))

> “One-shot migration runner / dedicated deployment stage avoids all application replicas competing to migrate; a DB lock is defense in depth, not a branch-conflict resolver.”
>
> — [Wave 1 — operating methodology](./wave-1.md#axis-4--operating-methodology)

### 저널에 수집된 실무자·운영 사례

#### DoorDash — migration manifest로 stale branch를 Git 충돌로 바꾼다

- **누가:** DoorDash의 Django 운영 팀.
- **무엇을 하는가:** 앱별 migration manifest를 저장소에 커밋한다. 오래된 브랜치가 새 migration을 만든 상태에서 기준 브랜치가 먼저 바뀌면 manifest 자체가 Git conflict를 일으키므로, merge 전에 rebase와 재조정을 강제한다.
- **이 축에서의 의미:** DB migration의 의미를 자동 병합하지 않고, 늦게 발견될 DB history 충돌을 일찍 발견되는 Git 텍스트 충돌로 변환한다. 현재 증상에 가장 직접적인 practitioner account다.
- **출처:** [DoorDash — Tips for Building High-Quality Django Apps at Scale](https://careersatdoordash.com/blog/tips-for-building-high-quality-django-apps-at-scale/), [Wave 1 기록](./wave-1.md#axis-1--alembic-multi-head-symptom)

> “DoorDash commits a per-app migration manifest so a stale branch creates a Git conflict and must be rebased before merge.”
>
> — [Wave 1](./wave-1.md#axis-1--alembic-multi-head-symptom)

#### GitLab — 장기 호환 migration을 단계적으로 운영한다

- **누가:** GitLab의 애플리케이션·데이터베이스 migration 운영 지침.
- **무엇을 하는가:** 구·신 애플리케이션 버전이 겹치는 배포 구간을 전제로, 변경을 forward-only 단계로 나누고 expand/deploy/backfill·validate/contract 흐름으로 운영한다.
- **이 축에서의 의미:** 선형 migration history를 만들었다고 끝나는 것이 아니라, 배포 중 공존하는 코드 버전의 호환성까지 별도 절차로 관리한다.
- **출처:** [GitLab Migration Style Guide](https://docs.gitlab.com/development/migration_style_guide/), [Wave 1 기록](./wave-1.md#axis-4--operating-methodology)

#### GitLab CI/CD — 환경 단위 deployment mutex를 둔다

- **누가:** GitLab CI/CD를 사용하는 배포 파이프라인.
- **무엇을 하는가:** resource group으로 동일 환경의 deployment job을 직렬화한다.
- **이 축에서의 의미:** DB advisory lock과 별개로 배포 orchestration 층에서 동시에 두 release가 migration을 시작하는 일을 막는다. 공유 DB를 쓰는 여러 배포 경로가 있다면 같은 serialization key로 묶어야 한다.
- **출처:** [GitLab deployment safety — resource groups](https://docs.gitlab.com/ci/environments/deployment_safety/), [Wave 1 기록](./wave-1.md#axis-3--deployment-integration)

### TypeScript 도구 선택에 주는 함의

이 축만 놓고 보면 **“Git 같은 자동 병합”을 이유로 Alembic에서 특정 TypeScript 라이브러리로 옮길 근거는 없다.** Kysely·Prisma·node-pg-migrate의 잠금과 Atlas의 rebase/checksum은 운영 안전성을 높이지만 semantic merge를 제공하지 않는다. 그러므로 선택 기준은 자동 병합 여부가 아니라 다음이어야 한다.

- PostgreSQL 동시 실행을 막는 잠금이 검증돼 있는가.
- migration을 애플리케이션 replica와 분리한 one-shot job에서 비대화형으로 실행할 수 있는가.
- 순서·checksum·out-of-order를 PR required check에서 검사할 수 있는가.
- 이미 적용된 이력을 불변으로 두고 미적용 이력만 rebase할 수 있는가.
- expand/contract와 backfill을 SQL 또는 별도 job으로 명시적으로 표현할 수 있는가.

저널의 1차 선택 방향은 PostgreSQL/TypeScript-native 소규모 팀에는 Kysely, migration delivery 제품에는 Atlas, ORM까지 함께 채택할 수 있을 때는 Prisma였지만, 이는 별도 후보 비교 축에서 버전·라이선스·상용 기능 경계까지 함께 평가해야 한다. ([Wave 1 — initial selection direction](./wave-1.md#axis-5--initial-selection-direction))

### 검증 백킹과 한계

이 섹션은 [Wave 1](./wave-1.md)과 [Wave 2](./wave-2.md)의 직접 인용을 사용했다. 저널은 독립 검증 패스가 Prisma·Kysely·Atlas의 직접 주장을 확인했다고 기록하며, “Git 같은 semantic merge 도구가 없다”는 광범위한 부정 명제는 **partial**로 분류했다. Alembic merge revision에는 사람이 reconciliation을 작성할 수 있고, 특정 구현 구간에 advisory lock이 보이지 않는다는 사실만으로 Drizzle 패키지 전체의 부재를 증명할 수 없기 때문이다. ([Wave 2 — Verification outcome](./wave-2.md#verification-outcome))

요구된 검증 출처인 `SYNTHESIS.md`는 이 디렉터리와 상위 작업 경로에 제공되지 않았다. 따라서 존재하지 않는 파일이나 섹션을 인용해 검증된 것처럼 표시하지 않았으며, 위 주장의 검증 수준은 저널에 실제로 남아 있는 verification outcome까지만 제시했다. `SYNTHESIS.md`가 추가되면 각 주장 옆에 해당 verified claim·contradiction·gap 앵커를 연결해야 한다.

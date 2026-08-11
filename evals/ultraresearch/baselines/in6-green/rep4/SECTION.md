## Git 같은 병합 모델의 실재 여부와 운영 대안

### 결론

**조사한 범위에서는 Git처럼 서로 독립적으로 작성된 두 스키마·데이터 마이그레이션의 의미를 이해해 안전한 병합 결과를 자동 합성하는 라이브러리는 확인되지 않았다.** 이는 보편적 불가능성 주장이 아니라 Alembic, Atlas, Flyway, Liquibase, Prisma, Sqitch의 문서와 구현을 대조한 범위의 결론이다. 이 도구들이 제공하는 것은 대체로 DAG의 합류 지점, 선형 이력과 체크섬, 실행 순서, 잠금, 또는 사람이 작성한 충돌 조정이다. [Wave 2의 조사 범위와 근거](./wave-2.md#git-like-merge-premise) · [검증 근거와 한계](./SYNTHESIS.md#contradictions)

> No examined source describes a tool that can safely synthesize a semantic merge of two independently authored, possibly conflicting schema/data migrations. This is a scoped research result, not a universal impossibility theorem.
>
> — [wave-2.md](./wave-2.md#git-like-merge-premise)

Alembic의 `merge`는 이 한계를 없애지 않는다. Alembic은 여러 head가 만나는 **명시적 merge revision**을 만들 수 있지만, 경쟁하는 SQL 작업을 의미적으로 자동 병합하지는 않는다. merge revision 본문에는 개발자가 직접 조정 SQL을 작성할 수 있으므로 “갈라진 이력을 하나의 DAG 노드로 다시 잇는 기능”에 가깝다. [Wave 1의 Alembic 관찰](./wave-1.md#axis-1--alembic-multi-head-symptom) · [Wave 2의 보정](./wave-2.md#verification-outcome) · [검증 근거](./SYNTHESIS.md#verified-claims)

> Alembic is a revision DAG and can create an explicit merge revision; it does not semantically merge two competing SQL operations.
>
> — [wave-1.md](./wave-1.md#axis-1--alembic-multi-head-symptom)

Atlas의 `atlas migrate rebase`가 조사 범위에서 Git rebase와 가장 닮았지만, 이것도 의미 병합은 아니다. 아직 적용되지 않은 파일의 이름과 순서를 바꾸고 `atlas.sum`을 갱신할 뿐 SQL을 실행하거나 병합하지 않는다. 기본 운영 모델은 선형 이력이며, rebase·lint·CI 연동은 Community Edition 범위를 벗어난다. 따라서 Atlas는 “충돌을 자동 해결하는 병합 엔진”이 아니라 “적용 전 이력을 재정렬하고 CI에서 규율하는 제품”으로 평가해야 한다. [Wave 2의 Atlas 조사](./wave-2.md#atlas-conflict-workflow) · [검증 근거](./SYNTHESIS.md#verified-claims)

> `atlas migrate rebase` only renames selected **unapplied** files and updates `atlas.sum`; it does not execute or merge SQL operations.
>
> — [wave-2.md](./wave-2.md#atlas-conflict-workflow)

### 문제를 세 층으로 나눠야 한다

| 실패 층 | 실제 충돌 | 맞는 통제 수단 | 해결하지 못하는 것 |
|---|---|---|---|
| 브랜치/PR | 두 브랜치가 같은 기준 이력에서 새 migration을 각각 생성 | PR 전 선형성 검사, manifest 충돌, rebase 및 새 migration 재생성 | SQL의 의미 충돌 자동 조정 |
| 배포 실행 | 여러 파이프라인·Pod가 동시에 migration 수행 | 전용 one-shot runner, 환경별 배포 직렬화, DB advisory/row lock | 잘못 작성된 migration이나 다중 head 자체 |
| 구·신버전 공존 | rollout 중 서로 다른 앱 버전이 같은 스키마를 사용 | expand → 호환 앱 배포 → backfill/validate → contract | 브랜치 이력 충돌 자체 |

즉, 현재 겪는 “PR을 올리고서야 또는 merge 후에야 안다”는 문제는 배포 잠금만 추가해서 해결되지 않는다. **브랜치 단계에서는 충돌을 의도적으로 Git conflict로 바꾸고, 배포 단계에서는 실행 주체를 하나로 만들며, 스키마 변경은 구·신 앱이 겹치는 시간을 견디도록 분리**해야 한다. DB lock은 배포 경합에 대한 방어선이지 branch-conflict resolver가 아니다. [Wave 1의 운영 방법론](./wave-1.md#axis-4--operating-methodology) · [배포 통합 근거](./wave-1.md#axis-3--deployment-integration) · [검증 근거](./SYNTHESIS.md#findings-by-theme)

> One-shot migration runner / dedicated deployment stage avoids all application replicas competing to migrate; a DB lock is defense in depth, not a branch-conflict resolver.
>
> — [wave-1.md](./wave-1.md#axis-4--operating-methodology)

### 운영 대안

1. **PR을 열기 전에 선형성 검사를 실행한다.** Alembic을 당장 유지한다면 로컬 pre-push와 CI 모두에서 head 개수가 정확히 1인지 검사하고, 대상 DB가 현재 head인지 확인한다. Alembic 공식 문서가 제공하는 current/head 검사를 merge gate로 승격하면 “머지 후 발견”을 “push 또는 PR 검사에서 발견”으로 앞당길 수 있다. 다만 두 migration의 SQL 의미가 충돌하는지는 사람이 검토해야 한다. [Wave 1의 Alembic 근거](./wave-1.md#axis-1--alembic-multi-head-symptom) · [검증 근거](./SYNTHESIS.md#findings-by-theme)

2. **migration manifest를 커밋해 stale branch를 Git 충돌로 만든다.** 각 애플리케이션의 최신 migration 상태를 나타내는 작은 manifest 파일을 함께 변경하도록 규칙화하면, 같은 기준점에서 갈라진 브랜치는 rebase 시 그 파일에서 충돌한다. 이 충돌을 해결하면서 최신 main 위에서 migration을 다시 만들거나 명시적 merge migration을 작성한다. 이것이 요청한 “Git처럼 병합이 관리되는” 경험에 가장 가까운 저비용 방식이다. 자동 의미 병합 대신 Git의 충돌 탐지를 조기 경보로 이용한다. [Wave 1의 practitioner evidence](./wave-1.md#axis-1--alembic-multi-head-symptom) · [검증 근거](./SYNTHESIS.md#findings-by-theme)

3. **migration 실행은 배포당 한 번으로 제한한다.** 애플리케이션 replica가 시작할 때마다 migration을 실행하지 말고, 전용 release stage나 one-shot Job 하나가 먼저 실행하도록 한다. 선택한 도구가 Prisma나 Kysely처럼 DB lock을 제공하더라도 잠금은 중복 실행을 막는 이중 안전장치로 유지한다. Prisma는 적용 전에 PostgreSQL advisory lock을 획득하고 이름순 pending migration을 순차 적용하는 구현이 확인됐지만, feature-branch 충돌 해결은 여전히 수동 reset/replay다. [Wave 2의 Prisma 구현 확인](./wave-2.md#prisma-current-lock-verification) · [Wave 1의 Kysely 관찰](./wave-1.md#axis-2--typescript-candidates) · [검증 근거](./SYNTHESIS.md#verified-claims)

4. **같은 환경으로 가는 배포 파이프라인도 직렬화한다.** Argo CD sync-wave 계약에서 추론하면, `PreSync` Job은 한 Application 안에서 migration을 리소스보다 먼저 실행하게 할 수 있지만 서로 다른 Application 전체를 전역 직렬화하지는 않는다. 여러 배포 경로가 같은 DB를 공유한다면 GitLab resource group 같은 환경 단위 mutex를 추가해야 한다. [Wave 1의 배포 통합 조사와 추론 범위](./wave-1.md#axis-3--deployment-integration) · [검증 근거](./SYNTHESIS.md#findings-by-theme)

5. **파괴적 변경은 expand/contract로 분리한다.** 먼저 nullable column·새 table처럼 양쪽 앱 버전이 함께 쓸 수 있는 확장 migration을 적용하고, 호환 앱을 배포한 뒤 backfill·검증을 수행한다. 마지막으로 충분한 시간이 지난 후 old column·constraint를 제거한다. 이 방식은 migration 이력 충돌을 병합해 주지는 않지만, 배포 중 구·신 앱의 경합이 곧 장애로 이어지는 위험을 낮춘다. [Wave 1의 운영 방법론](./wave-1.md#axis-4--operating-methodology) · [검증 근거](./SYNTHESIS.md#findings-by-theme)

### practitioner accounts

#### DoorDash — manifest를 이용해 stale branch를 Git 충돌로 전환

**누가:** DoorDash의 Django 애플리케이션 팀.  
**무엇을 하는가:** 애플리케이션별 migration manifest를 저장소에 커밋한다. 오래된 기준점에서 migration을 만든 브랜치는 rebase/merge 때 manifest에서 Git conflict가 발생하므로, main에 들어오기 전에 개발자가 이력을 재조정해야 한다. 자동 의미 병합을 시도하지 않고, 늦게 드러나던 multi-head 문제를 코드 병합 충돌로 앞당긴 사례다.  
**출처:** [DoorDash, “Tips for Building High-Quality Django Apps at Scale”](https://careersatdoordash.com/blog/tips-for-building-high-quality-django-apps-at-scale/) · [저널 기록](./wave-1.md#axis-1--alembic-multi-head-symptom) · [practice-shaped claim 검증](./SYNTHESIS.md#findings-by-theme)

> DoorDash commits a per-app migration manifest so a stale branch creates a Git conflict and must be rebased before merge.
>
> — [wave-1.md](./wave-1.md#axis-1--alembic-multi-head-symptom)

#### GitLab — expand/contract 계열의 단계적 migration 운영

**누가:** GitLab의 애플리케이션·데이터베이스 개발 조직.  
**무엇을 하는가:** 구버전과 신버전 애플리케이션이 동시에 존재하는 배포를 전제로, 확장 → 호환 애플리케이션 배포 → backfill/검증 → 축소 순으로 변경을 나눈다. 이는 Git식 이력 병합의 대체물이 아니라, 사람이 충돌을 조정한 뒤에도 배포 시점의 스키마/앱 경합이 실패로 번지는 것을 막는 운영 규율이다.  
**출처:** [GitLab migration style guide](https://docs.gitlab.com/development/migration_style_guide/) · [저널 기록](./wave-1.md#axis-4--operating-methodology) · [practice-shaped claim 검증](./SYNTHESIS.md#findings-by-theme)

> Use forward-only expand → deploy compatible application → backfill/validate → contract migrations for changes that overlap old/new application versions.
>
> — [wave-1.md](./wave-1.md#axis-4--operating-methodology)

### 이 축의 권고

**“Git 같은 자동 병합 라이브러리”를 교체 목표로 삼기보다, Git 충돌을 조기 경보로 쓰는 manifest/선형성 gate와 배포 직렬화를 먼저 도입하는 것이 현재 증상에 직접 대응한다.** Alembic을 즉시 바꾸지 않아도 적용할 수 있으며, TypeScript로 이동한다면 Kysely·Prisma의 잠금은 배포 경합 완화에 유용하지만 branch-level semantic merge를 제공한다고 해석해서는 안 된다. Atlas의 rebase/lint/CI 흐름은 더 제품화된 선택이지만, 자동 SQL 병합이 아니고 해당 기능의 상용 경계를 함께 평가해야 한다. [Wave 1의 선택 방향](./wave-1.md#axis-5--initial-selection-direction) · [Wave 2의 Atlas·Prisma 검증](./wave-2.md#atlas-conflict-workflow) · [SYNTHESIS의 검증 결론](./SYNTHESIS.md#executive-summary)

이 섹션은 [wave-1.md](./wave-1.md)와 [wave-2.md](./wave-2.md)의 해당 축을 사용했다. 주장의 검증 상태와 범위 제한은 [SYNTHESIS.md](./SYNTHESIS.md)의 `findings by theme`, `verified claims`, `contradictions`, `gaps`에서 추적한다.

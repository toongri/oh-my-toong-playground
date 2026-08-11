## Git 같은 병합 모델의 실재 여부와 운영 대안

**결론부터 말하면, 조사한 도구 중 독립적으로 작성된 두 마이그레이션의 의미를 이해해 안전한 하나의 변경으로 자동 병합하는 “Git 같은” 모델은 없었다.** 다만 이는 보편적 불가능성의 증명이 아니라 이번 조사 범위의 결과다. 저널도 이 한계를 명시한다.

> “No examined source describes a tool that can safely synthesize a semantic merge of two independently authored, possibly conflicting schema/data migrations. This is a scoped research result, not a universal impossibility theorem.”

근거: [Wave 2 — Git-like merge premise](./wave-2.md#git-like-merge-premise), [SYNTHESIS — findings by theme](./SYNTHESIS.md#findings-by-theme), [SYNTHESIS — contradictions](./SYNTHESIS.md#contradictions).

### 실제로 존재하는 모델: DAG 병합, 리베이스, 선형 직렬화

“Git 같은 병합”으로 보일 수 있는 기능들은 실제로는 서로 다른 문제를 푼다.

| 모델 | 실제 동작 | 해결하는 문제 | 해결하지 못하는 문제 |
|---|---|---|---|
| Alembic의 merge revision | 갈라진 revision DAG의 두 head를 가리키는 명시적 merge revision을 만든다. 그 본문에는 사람이 조정 SQL을 작성할 수 있다. | 두 head를 하나의 후속 head로 수렴 | 경쟁하는 DDL·데이터 변경의 의미적 충돌 자동 해결 |
| Atlas의 `migrate rebase` | 아직 적용되지 않은 파일의 이름을 다시 매기고 `atlas.sum`을 갱신한다. | 선형 실행 순서와 체크섬 정리 | SQL 실행·SQL 의미 병합 |
| Prisma·Kysely·node-pg-migrate·Knex·Flyway·Liquibase·Sqitch 계열 | 순서, 이력 무결성, 잠금 또는 수동 조정으로 충돌을 통제한다. | 배포 시 중복 실행·순서 뒤섞임·이력 변조 방지 | 브랜치에서 독립 작성된 변경의 자동 의미 병합 |

Alembic에 관해 저널은 다음처럼 구분한다.

> “Alembic is a revision DAG and can create an explicit merge revision; it does not semantically merge two competing SQL operations.”

또한 검증 과정에서 “Alembic merge files may contain manually written reconciliation”이 확인되어, merge revision을 단순한 빈 그래프 연결점으로만 설명해서도 안 된다. 병합 *지점*은 제공하지만 병합 *판단*은 사람이 맡는 모델이다. 근거: [Wave 1 — Alembic multi-head symptom](./wave-1.md#axis-1--alembic-multi-head-symptom), [Wave 2 — Verification outcome](./wave-2.md#verification-outcome), [Alembic branches 공식 문서](https://alembic.sqlalchemy.org/en/latest/branches.html), [SYNTHESIS — verified claims](./SYNTHESIS.md#verified-claims).

Atlas의 리베이스도 Git의 내용 병합과 다르다.

> “`atlas migrate rebase` only renames selected **unapplied** files and updates `atlas.sum`; it does not execute or merge SQL operations.”

기본 실행 모델은 선형이며 비선형 실행은 운영 환경에서 권장되지 않는다. 더구나 rebase, lint, CI 통합은 Community Edition 범위 밖이므로, 이 방식을 채택하려면 상용 기능 경계를 비용·운영 판단에 포함해야 한다. 근거: [Wave 2 — Atlas conflict workflow](./wave-2.md#atlas-conflict-workflow), [Atlas out-of-order migrations](https://atlasgo.io/faq/out-of-order-migrations), [Atlas Community Edition](https://atlasgo.io/community-edition), [SYNTHESIS — findings by theme](./SYNTHESIS.md#findings-by-theme).

### 운영 대안: 병합을 자동화하지 말고 충돌 발견 시점을 앞으로 당긴다

현재 증상은 “DB가 병합을 못 한다”보다 **브랜치 충돌이 PR 또는 머지 뒤에야 드러나고, 여러 배포 주체가 동시에 마이그레이션을 시도한다**는 두 문제의 결합에 가깝다. 따라서 대안도 두 층으로 나뉜다.

1. **PR 전·PR 중 이력 충돌 게이트**  
   브랜치마다 새 revision을 만들게 하되, base branch 최신화 후 head가 정확히 하나인지 검사한다. 마이그레이션 파일 목록·순서를 나타내는 manifest 또는 체크섬 파일을 커밋하면, stale branch는 일반 Git 충돌로 바뀌어 머지 전에 드러난다. Alembic에서는 merge revision을 무조건 허용하기보다, 같은 스키마 객체를 건드린 두 변경을 사람이 검토하고 필요한 조정 SQL을 merge revision에 넣는 정책이 필요하다.

2. **배포 단위 직렬화**  
   모든 애플리케이션 replica가 시작하면서 마이그레이션하지 않도록, 배포마다 한 번만 실행되는 전용 migration job/stage를 둔다. DB advisory lock은 중복 실행을 막는 방어선이지 브랜치 충돌 해결책은 아니다. 저널의 표현은 다음과 같다.

   > “One-shot migration runner / dedicated deployment stage avoids all application replicas competing to migrate; a DB lock is defense in depth, not a branch-conflict resolver.”

   Argo CD를 쓴다면 PreSync Job은 한 Application 안에서 migration-before-app 순서를 만들 수 있지만, 서로 다른 Application 전체를 전역 직렬화하지는 않는다. 따라서 환경별 CI concurrency/resource group이나 별도의 전역 배포 잠금이 함께 필요하다. 근거: [Wave 1 — deployment integration](./wave-1.md#axis-3--deployment-integration), [Argo CD sync waves](https://argo-cd.readthedocs.io/en/release-3.1/user-guide/sync-waves/), [GitLab resource groups](https://docs.gitlab.com/ci/environments/deployment_safety/), [SYNTHESIS — findings by theme](./SYNTHESIS.md#findings-by-theme).

3. **변경 자체를 공존 가능하게 설계**  
   오래 걸리는 변경이나 구버전·신버전 애플리케이션이 겹쳐 실행되는 배포에서는 `expand → 호환 애플리케이션 배포 → backfill/validate → contract` 순서를 사용한다. 이 방식은 마이그레이션 이력의 분기를 제거하지 않지만, 경합이나 롤링 배포 중 스키마 비호환이 곧바로 장애가 되는 확률을 낮춘다. 근거: [Wave 1 — operating methodology](./wave-1.md#axis-4--operating-methodology), [Alembic cookbook](https://alembic.sqlalchemy.org/en/latest/cookbook.html), [GitLab migration style guide](https://docs.gitlab.com/development/migration_style_guide/), [SYNTHESIS — findings by theme](./SYNTHESIS.md#findings-by-theme).

권장 흐름은 다음과 같다.

```text
브랜치에서 migration 작성
        ↓
base branch 최신화 + 단일 head/순서/체크섬 검사
        ↓ 실패
rebase 또는 사람의 충돌 조정
        ↓ 통과
PR에서 빈 DB 적용 + 기존 DB upgrade 검증
        ↓
환경별로 직렬화된 one-shot migration job
        ↓
호환 애플리케이션 rollout → backfill/validate → contract
```

이 흐름에서 라이브러리의 잠금은 마지막 배포 단계의 동시 실행을 막고, manifest·단일-head 검사·lint는 앞단의 브랜치 경합을 찾는다. 하나의 라이브러리가 두 문제를 모두 “병합”해 주는 구조로 기대하면 발견 시점은 여전히 늦어진다.

### 저널에 수집된 실무자 운영 사례

#### DoorDash — manifest를 Git 충돌 센서로 사용

- **누가:** DoorDash의 Django 애플리케이션 팀.
- **무엇을 하는가:** 앱별 migration manifest를 저장소에 커밋한다. 오래된 base에서 만든 브랜치가 새 마이그레이션을 추가하면 manifest 자체에서 Git 충돌이 발생하므로, 작성자는 머지 전에 rebase하고 순서를 다시 정해야 한다.
- **이 축에서의 의미:** DB 마이그레이션을 자동 의미 병합하는 대신, 충돌을 Git이 가장 잘 다루는 텍스트 충돌로 변환해 PR 이전으로 당긴다.
- **출처:** [DoorDash, “Tips for Building High-Quality Django Apps at Scale”](https://careersatdoordash.com/blog/tips-for-building-high-quality-django-apps-at-scale/). 저널 기록: [Wave 1 — Alembic multi-head symptom](./wave-1.md#axis-1--alembic-multi-head-symptom), 검증 근거: [SYNTHESIS — findings by theme](./SYNTHESIS.md#findings-by-theme).

#### GitLab — 환경별 배포 직렬화와 단계적 스키마 변경

- **누가:** GitLab의 배포·데이터베이스 운영 가이드가 대상으로 하는 GitLab 개발 팀.
- **무엇을 하는가:** CI resource group으로 환경별 배포를 직렬화하고, 겹치는 애플리케이션 버전이 안전하게 동작하도록 단계적 migration 규칙을 사용한다.
- **이 축에서의 의미:** migration 파일의 브랜치 병합과 실제 DB 적용의 동시성을 분리해, 후자는 배포 파이프라인에서 명시적으로 직렬화한다. 파괴적 변경은 한 번에 수행하지 않고 호환 구간을 둔다.
- **출처:** [GitLab deployment safety — resource groups](https://docs.gitlab.com/ci/environments/deployment_safety/), [GitLab migration style guide](https://docs.gitlab.com/development/migration_style_guide/). 저널 기록: [Wave 1 — deployment integration](./wave-1.md#axis-3--deployment-integration), [Wave 1 — operating methodology](./wave-1.md#axis-4--operating-methodology), 검증 근거: [SYNTHESIS — findings by theme](./SYNTHESIS.md#findings-by-theme).

### 선택 판단

이 축의 핵심 선택 기준은 “Git 같은 자동 병합 지원 여부”가 아니라 다음 세 가지를 얼마나 일찍, 강하게 강제할 수 있는가다.

- 브랜치 단계: 단일 head·엄격한 순서·manifest/checksum 충돌을 PR 게이트로 만들 수 있는가.
- 배포 단계: one-shot runner와 DB 잠금으로 실제 적용을 직렬화할 수 있는가.
- 변경 설계: expand/contract와 backfill을 독립 단계로 운영할 수 있는가.

따라서 TypeScript 전환만으로 Alembic multi-head 문제는 사라지지 않는다. Kysely·Prisma·node-pg-migrate 같은 선형 이력 도구는 “분기된 DAG”를 만들지 않게 할 수 있지만, 그 대신 out-of-order 파일과 병렬 PR의 순서 충돌을 CI 정책으로 관리해야 한다. Atlas는 이 정책을 제품화한 선택지에 가깝지만, rebase가 SQL 의미 병합은 아니며 필요한 lint·CI 기능의 상용 범위를 확인해야 한다. 후보별 잠금·버전·라이선스·유지보수 상태와 최종 적합성 판단은 별도 후보 비교 축에서 다룬다. 근거: [Wave 1 — TypeScript candidates](./wave-1.md#axis-2--typescript-candidates), [Wave 2 — Git-like merge premise](./wave-2.md#git-like-merge-premise), [SYNTHESIS — verified claims](./SYNTHESIS.md#verified-claims).

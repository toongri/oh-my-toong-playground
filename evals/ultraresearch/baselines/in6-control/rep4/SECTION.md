## Git 같은 병합 모델의 실재 여부와 운영 대안

조사한 도구 범위에서는 서로 독립적으로 작성된 두 스키마·데이터 마이그레이션의 의미를 해석해 안전한 결과로 자동 병합하는, Git의 3-way merge에 해당하는 모델은 확인되지 않았다. 이것은 “그런 도구는 존재할 수 없다”는 보편 명제가 아니라 Alembic, Atlas, Flyway, Liquibase, Prisma, Sqitch를 조사한 범위의 결론이다. Alembic의 merge revision도 갈라진 **이력 그래프를 다시 잇는 컨테이너**일 뿐이며, 충돌하는 DDL/DML의 조정 내용은 사람이 작성해야 한다.

> “No examined source describes a tool that can safely synthesize a semantic merge of two independently authored, possibly conflicting schema/data migrations. This is a scoped research result, not a universal impossibility theorem.”
>
> — [wave-2.md — Git-like merge premise](./wave-2.md#git-like-merge-premise)

저널의 별도 검증 패스도 이 넓은 부정 명제를 `partial`로 판정했다. 특히 “Alembic이 의미 병합을 하지 않는다”는 표현은 merge revision 안에 사람이 reconciliation을 작성할 수 있다는 단서를 포함해야 한다. 따라서 여기서 말하는 부재는 **자동 의미 병합의 부재**이지, 명시적 병합 노드나 수동 조정 수단의 부재가 아니다. 검증 출처가 되어야 할 `SYNTHESIS.md`는 작업 디렉터리에 제공되지 않았으므로, 이 섹션은 존재하지 않는 파일을 인용해 검증 완료로 가장하지 않고 저널의 검증 상태를 그대로 유지한다. 검증 근거를 연결하려면 최종 REPORT 조립 전에 `SYNTHESIS.md`의 verified claims·contradictions 섹션이 추가되어야 한다. ([wave-2.md — Verification outcome](./wave-2.md#verification-outcome))

### “Git 같은 것”에 가장 가까운 실제 모델

실제 도구가 제공하는 것은 의미 병합이 아니라 다음 세 층의 조합이다.

| 층 | 실제로 해결하는 문제 | 해결하지 못하는 문제 |
|---|---|---|
| 이력 합류 | Alembic merge revision이 여러 head를 하나의 후속 revision으로 연결한다. | 두 migration의 SQL 의미 충돌을 자동 판정·조정하지 않는다. |
| 이력 정렬·무결성 | Atlas rebase, Flyway/Liquibase/Prisma/Sqitch의 순서·checksum·수동 reconciliation이 적용 순서를 결정하고 변조를 감지한다. | 같은 컬럼의 상충 변경, destructive DDL, data migration의 순서 의존성을 자동 병합하지 않는다. |
| 실행 경합 제어 | advisory lock이나 lock table이 여러 runner의 동시 실행을 막는다. | 서로 다른 브랜치에서 생긴 논리 충돌을 PR 전에 찾아주지는 않는다. |

Atlas가 이 구분을 가장 선명하게 보여 준다. `atlas migrate rebase`는 아직 적용되지 않은 파일의 이름을 바꾸고 `atlas.sum`을 갱신할 뿐 SQL을 실행하거나 병합하지 않는다. 기본 적용 모델은 선형이며, production의 비선형 실행은 권장되지 않는다. 또한 이 workflow에 중요한 rebase·lint·CI integration은 조사한 Atlas 1.3.0 기준 Community Edition 범위 밖이다. ([wave-2.md — Atlas conflict workflow](./wave-2.md#atlas-conflict-workflow), [wave-1.md — TypeScript candidates](./wave-1.md#axis-2--typescript-candidates))

> “`atlas migrate rebase` only renames selected **unapplied** files and updates `atlas.sum`; it does not execute or merge SQL operations.”
>
> — [wave-2.md — Atlas conflict workflow](./wave-2.md#atlas-conflict-workflow)

### 권장 운영 모델: 병합보다 충돌을 일찍 표면화한다

현재 증상인 “PR을 올리고서야 또는 머지 후에야 multi-head를 발견한다”를 줄이려면, 마이그레이션 이력을 일반 소스코드처럼 자유 병합하려 하기보다 **브랜치가 뒤처진 순간 Git conflict나 CI 실패로 바꾸는 것**이 핵심이다.

1. **PR 전 로컬 검사**: 새 migration 생성 직후 단일 head, 파일 순서, checksum/manifest 일관성을 검사한다. pre-push와 CI에서 같은 검사를 실행해 multi-head를 merge 이후가 아니라 PR 생성 전후에 차단한다.
2. **충돌 유도용 manifest**: DoorDash 사례처럼 앱별 migration manifest를 커밋한다. main의 migration 이력이 바뀐 상태에서 오래된 브랜치가 migration을 추가하면 manifest의 동일 지점에서 Git conflict가 나므로, 작성자는 merge 전에 rebase하고 migration 순서를 다시 잡아야 한다.
3. **선형화 규칙**: 동시에 열린 migration PR에 순번을 미리 영구 할당하지 않는다. merge 직전에 main 위로 rebase한 뒤 최신 순번·checksum을 재생성하고, CI는 “현재 main 뒤에 정확히 하나의 선형 suffix가 붙는가”를 검사한다. Atlas를 쓴다면 이 역할이 rebase/lint workflow에 해당하지만 상용 기능 경계를 확인해야 한다.
4. **위험 변경은 수동 reconciliation**: 같은 테이블·컬럼을 건드리거나 data migration 순서가 겹치면 자동 병합 대상으로 보지 않고 소유자를 지정해 하나의 조정 migration으로 다시 작성한다. Alembic merge revision을 유지하더라도 이 단계가 SQL 의미 충돌을 해결하는 실제 병합 작업이다.

> “DoorDash commits a per-app migration manifest so a stale branch creates a Git conflict and must be rebased before merge.”
>
> — [wave-1.md — Alembic multi-head symptom](./wave-1.md#axis-1--alembic-multi-head-symptom)

이 practitioner account에서 확인되는 운영 방식은 다음과 같다.

- **누가**: DoorDash의 Django 운영 사례.
- **무엇을 하는가**: 앱별 migration manifest를 저장소에 커밋해 stale branch가 충돌 없이 새 migration을 끼워 넣지 못하게 한다.
- **왜 유효한가**: DB에 적용할 때까지 숨던 migration graph 충돌을 Git rebase 시점의 텍스트 충돌로 앞당긴다.
- **출처**: [Tips for Building High-Quality Django Apps at Scale](https://careersatdoordash.com/blog/tips-for-building-high-quality-django-apps-at-scale/) 및 [wave-1.md](./wave-1.md#axis-1--alembic-multi-head-symptom).

### 배포 경합은 별도의 직렬화 문제다

브랜치 이력 충돌을 막아도 여러 애플리케이션 replica나 여러 배포 pipeline이 동시에 migration을 실행하면 배포 실패는 남는다. 따라서 migration은 애플리케이션 시작 시 각 replica가 실행하는 방식이 아니라 **배포당 한 번만 실행되는 전용 runner/stage**로 분리하고, DB advisory lock 또는 migration lock table을 이중 안전장치로 둬야 한다. 저널도 이를 “one-shot migration runner / dedicated deployment stage”와 “DB lock is defense in depth, not a branch-conflict resolver”로 구분한다. ([wave-1.md — operating methodology](./wave-1.md#axis-4--operating-methodology))

- Prisma Migrate 7.9.1은 committed SQL의 선형 이력을 `migrate deploy`로 적용하며 PostgreSQL에서 `pg_advisory_lock(72707369)`을 먼저 획득한다. 엔진이 lock 획득 후 이름순 pending migration을 차례로 적용한다는 직접 구현 근거가 별도 검증에서 확인됐다. 다만 feature-branch 충돌 해결은 reset/replay 등 수동 workflow이지 graph merge가 아니다. ([wave-1.md — TypeScript candidates](./wave-1.md#axis-2--typescript-candidates), [wave-2.md — Prisma current-lock verification](./wave-2.md#prisma-current-lock-verification))
- Kysely 0.29.2는 migration history와 DB lock table을 제공해 TypeScript/PostgreSQL 조합의 작은 팀에 적합하지만, dependency DAG가 없으므로 strict order를 기본으로 두고 브랜치 선형화 규칙을 별도로 운영해야 한다. `allowUnorderedMigrations`는 Git 같은 병합이 아니라 순서 제약을 느슨하게 하는 옵션이다. ([wave-1.md — TypeScript candidates](./wave-1.md#axis-2--typescript-candidates), [wave-1.md — initial selection direction](./wave-1.md#axis-5--initial-selection-direction))
- Argo CD `PreSync` Job은 한 Application 안에서 migration을 workload보다 먼저 실행하게 할 수 있지만, 서로 다른 Application까지 전역 직렬화한다는 근거는 없다. 여러 배포 경로가 같은 DB를 공유한다면 환경별 pipeline mutex/resource group과 DB lock을 함께 써야 한다. GitLab resource group은 환경 단위 배포 직렬화 사례다. 이 Argo CD 범위 판단은 sync-wave contract로부터의 추론이므로 검증된 제품 보장으로 확대하면 안 된다. ([wave-1.md — deployment integration](./wave-1.md#axis-3--deployment-integration))

### 변경 자체의 충돌은 expand/contract로 낮춘다

순서와 실행을 직렬화해도 구버전·신버전 애플리케이션이 동시에 살아 있는 배포에서는 schema compatibility 문제가 남는다. 그래서 forward-only로 `expand → 호환 애플리케이션 배포 → backfill/validate → contract` 순서를 적용해야 한다. 이 방법은 병합 알고리즘이 아니라 충돌 가능한 변경을 시간적으로 분해해 각 단계가 old/new 양쪽 코드와 호환되게 만드는 운영 규칙이다. ([wave-1.md — operating methodology](./wave-1.md#axis-4--operating-methodology))

### 선택 판단

이 축만 놓고 보면 **라이브러리 교체만으로 Alembic multi-head 문제를 해결할 수는 없다.** 우선순위는 다음과 같다.

1. 저장소에 migration manifest 또는 단일 선형 이력을 두고, 로컬·PR CI에서 head/order/checksum을 검사한다.
2. merge 전 rebase와 migration 재번호화/재생성을 규칙화하며, 의미 충돌은 사람이 조정 migration으로 해결한다.
3. 배포에서는 one-shot runner와 DB lock, 환경별 deployment mutex를 조합한다.
4. TypeScript로 옮긴다면 ORM 독립적인 작은 팀에는 Kysely, Prisma ORM 채택이 가능한 경우에는 Prisma Migrate, 이력 rebase/lint/CI까지 제품으로 구매하려면 Atlas를 검토한다. 어느 선택도 semantic graph merge를 제공한다고 간주해서는 안 된다.

#### 근거 추적

- 조사 저널: [wave-1.md](./wave-1.md), [wave-2.md](./wave-2.md)
- 검증 backing: `SYNTHESIS.md` 미제공. 따라서 Prisma·Kysely·Atlas의 직접 주장은 [wave-2.md의 독립 검증 결과](./wave-2.md#verification-outcome)에 기대며, 넓은 부정 명제는 `partial`로 유지했다.


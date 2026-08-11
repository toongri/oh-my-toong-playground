## Git 같은 병합 모델의 실재 여부와 운영 대안

### 결론

조사된 도구들 가운데 **서로 독립적으로 작성된 두 스키마·데이터 마이그레이션의 의미를 이해하고 안전한 병합 결과를 자동 합성하는, Git의 3-way merge에 해당하는 모델은 확인되지 않았다.** 다만 이는 보편적 불가능성의 증명이 아니라 이번 조사 범위의 결론이다. 저널도 이 경계를 그대로 둔다.

> “No examined source describes a tool that can safely synthesize a semantic merge of two independently authored, possibly conflicting schema/data migrations. This is a scoped research result, not a universal impossibility theorem.”

Alembic의 revision DAG와 merge revision은 **이력 그래프를 합류**시키지만, 두 SQL 변경의 의미를 자동으로 병합하지 않는다. merge revision 본문에 필요한 조정은 사람이 작성할 수 있다. Atlas의 rebase도 적용되지 않은 파일의 이름·순서와 `atlas.sum`을 갱신할 뿐 SQL 연산을 실행하거나 합성하지 않는다. Flyway, Liquibase, Prisma, Sqitch 역시 순서·체크섬·무결성 검사 또는 수동 조정을 제공하는 쪽이다. 즉, 현재 실용적인 모델은 “DB 변경을 Git처럼 자동 병합”하는 것이 아니라 **병합 불가능한 변경을 일찍 발견하고, 사람이 재작성한 단일 이력을 검증한 뒤, 실행 자체는 잠금으로 직렬화**하는 것이다. ([Wave 2: Git-like merge premise와 Atlas conflict workflow](./wave-2.md#git-like-merge-premise), [검증 backing: SYNTHESIS findings by theme](./SYNTHESIS.md#findings-by-theme))

### Git 비유에서 실제로 구현 가능한 것

| Git에서 기대하는 성질 | DB 마이그레이션에서의 현실적 대응 | 해결하는 문제 | 해결하지 못하는 문제 |
|---|---|---|---|
| 분기된 이력의 합류 | Alembic merge revision처럼 DAG의 두 head를 명시적으로 연결 | revision graph의 다중 head | SQL·데이터 변경의 의미 충돌 |
| rebase | Atlas처럼 아직 적용되지 않은 파일의 순서·이름·체크섬 재작성 | 선형 이력 정리, out-of-order 방지 | 이미 적용된 변경의 재작성, SQL 자동 병합 |
| merge conflict | manifest·마이그레이션 목록·체크섬 파일을 커밋해 Git 충돌 또는 CI 실패 유도 | stale branch를 PR/merge 전에 탐지 | 서로 다른 파일 안의 논리 충돌 자동 판별 |
| 한 번에 한 writer | DB advisory lock, CI resource group, 단일 migration runner | 동시 배포 프로세스의 경합 | 브랜치 작성 단계의 충돌 |
| 변경의 안전한 통합 | expand → 호환 앱 배포 → backfill/validate → contract | 구버전·신버전 앱이 겹치는 롤링 배포 | 잘못 설계된 migration 자체의 의미 교정 |

이 구분이 중요하다. **이력 충돌**, **배포 실행 경합**, **구·신 애플리케이션의 스키마 호환성**은 서로 다른 실패 모드이므로 하나의 라이브러리 기능만으로는 모두 없어지지 않는다. 예를 들어 Prisma와 Kysely의 DB 잠금은 동시에 두 runner가 실행되는 문제를 줄이지만, 두 브랜치가 같은 테이블을 상충되게 바꾼 사실을 PR 전에 알아내 주지는 않는다. ([Wave 1: deployment integration과 operating methodology](./wave-1.md#axis-3--deployment-integration), [Wave 2: Prisma current-lock verification](./wave-2.md#prisma-current-lock-verification), [검증 backing: SYNTHESIS verified claims](./SYNTHESIS.md#verified-claims))

### 권장 운영 모델

1. **저장소 이력을 의도적으로 선형화한다.** 마이그레이션 파일뿐 아니라 현재 순서를 나타내는 manifest 또는 checksum 파일도 커밋한다. PR 브랜치가 오래되어 기준 브랜치에 새 migration이 생기면, CI가 out-of-order 상태를 거부하거나 동일 manifest의 Git 충돌을 통해 rebase를 강제한다. 자동 의미 병합 대신 “한 줄짜리 적용 이력으로 다시 작성하고 검증”하는 방식이다.

2. **PR 단계에 DB 전용 검증을 둔다.** 빈 DB에 전체 이력을 적용하고, 기준 브랜치 상태의 DB에는 PR에서 추가된 migration만 적용한다. 이후 schema diff·migration status·head 수를 검사한다. 이 검사는 “머지 후 발견”을 “PR에서 발견”으로 앞당기지만, Git 충돌만으로 잡히지 않는 SQL 의미 충돌을 위해 리뷰와 실제 적용 테스트가 여전히 필요하다.

3. **운영 배포에서는 migration runner를 하나만 둔다.** 애플리케이션 replica 모두가 startup 시 migration을 실행하지 않도록 하고, CI/CD의 전용 단계 또는 Argo CD `PreSync` Job 하나가 먼저 실행하게 한다. DB advisory lock은 runner 중복이나 재시도에 대한 방어선으로 유지한다. 다만 저널의 표현처럼 “Argo CD PreSync Jobs make a migration run before resources in one Application, but do not globally serialize unrelated Applications”; 여러 Application이 같은 DB를 공유한다면 GitLab resource group 같은 환경별 배포 lock이나 별도 글로벌 직렬화가 필요하다. ([Wave 1: deployment integration](./wave-1.md#axis-3--deployment-integration), [검증 backing: SYNTHESIS findings by theme](./SYNTHESIS.md#findings-by-theme))

4. **파괴적 변경은 expand/contract로 나눈다.** 먼저 구버전과 신버전 앱이 함께 사용할 수 있는 additive schema를 배포하고, 호환 애플리케이션을 배포한 뒤, 데이터를 backfill·검증하고, 마지막에 더 이상 쓰지 않는 column·constraint를 제거한다. 이는 migration 이력을 잘 관리해도 남는 롤링 배포 호환성 문제를 다룬다.

5. **도구 선택은 이 운영 모델을 얼마나 강제하느냐로 판단한다.** TypeScript 진영에서는 DB 잠금이 내장된 Kysely가 작은 PostgreSQL 팀의 단순한 선택지이고, Prisma ORM 도입이 허용되면 Prisma Migrate가 배포 단계와 advisory lock을 제공한다. Atlas는 lint/rebase/CI 중심의 전달 체계가 강점이지만, 저널에 따르면 그 기능들의 일부는 Community Edition 밖에 있다. 어느 선택도 semantic merge를 대신하지는 않는다. ([Wave 1: TypeScript candidates와 initial selection direction](./wave-1.md#axis-2--typescript-candidates), [Wave 2: verification outcome](./wave-2.md#verification-outcome), [검증 backing: SYNTHESIS verified claims](./SYNTHESIS.md#verified-claims))

### 저널에 수집된 실제 운영 사례

#### DoorDash — manifest를 Git 충돌 지점으로 사용

DoorDash는 애플리케이션별 migration manifest를 저장소에 커밋한다. 오래된 브랜치가 migration을 추가하면 manifest에서 Git 충돌이 발생하므로, 작성자는 merge 전에 기준 브랜치 위로 rebase하고 순서를 다시 확정해야 한다. 저널은 이를 “a stale branch creates a Git conflict and must be rebased before merge”라고 요약한다. 이 방식은 DB 변경을 자동 병합하지는 않지만, **다중 migration 이력을 PR 병합 전의 명시적 충돌**로 바꾼다. [DoorDash의 1차 실무 사례](https://careersatdoordash.com/blog/tips-for-building-high-quality-django-apps-at-scale/) · [Wave 1 기록](./wave-1.md#axis-1--alembic-multi-head-symptom)

#### GitLab — 배포 직렬화와 단계적 migration

GitLab의 resource group은 환경별 deployment job을 직렬화한다. migration 자체는 expand/contract 계열의 단계적 변경으로 운영해 구버전·신버전 코드가 공존하는 구간을 견디게 한다. 전자는 **동시에 두 배포가 DB를 변경하는 경합**, 후자는 **롤링 배포 중 스키마 비호환**을 각각 다룬다. [GitLab deployment safety](https://docs.gitlab.com/ci/environments/deployment_safety/) · [GitLab migration style guide](https://docs.gitlab.com/development/migration_style_guide/) · [Wave 1 기록](./wave-1.md#axis-4--operating-methodology)

### 판단의 한계와 검증 상태

Wave 2의 독립 검증은 Prisma의 advisory lock·순차 적용, Kysely의 lock, Atlas의 선형 이력·rebase 범위에 관한 직접 주장을 확인했다. 반면 “어떤 도구도 Git형 semantic merge를 제공하지 않는다”는 넓은 부정 명제는 **partial**이다. Alembic merge revision 안에 사람이 조정 SQL을 쓸 수 있다는 점과, 조사되지 않은 모든 도구까지 부재를 증명할 수 없다는 점 때문이다. 따라서 이 섹션의 정확한 결론은 “없다”가 아니라 **조사된 후보와 자료에서는 자동 semantic merge가 확인되지 않았고, 검증된 대안은 선형 이력·조기 CI gate·단일 runner·DB lock·expand/contract의 조합이다**이다. ([Wave 2: verification outcome](./wave-2.md#verification-outcome), [검증 backing: SYNTHESIS contradictions](./SYNTHESIS.md#contradictions), [검증 backing: SYNTHESIS gaps](./SYNTHESIS.md#gaps))

> 검증 연결 주의: 이 작업 디렉터리에는 작성 시점에 `SYNTHESIS.md`가 제공되지 않았다. 위 상대 링크는 최종 REPORT 조립 시 연결되어야 하며, 그 전까지 검증 backing은 [Wave 2의 Verification outcome](./wave-2.md#verification-outcome)에만 직접 추적된다.

### 근거 추적

- 1차 포화 조사: [wave-1.md](./wave-1.md)
- 확장 조사와 독립 검증 결과: [wave-2.md](./wave-2.md)
- 최종 검증 합성: [SYNTHESIS.md](./SYNTHESIS.md) — 현재 입력에는 없음; REPORT 조립 단계에서 필수 연결

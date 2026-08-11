## Git 같은 병합 모델의 실재 여부와 운영 대안

### 결론

조사한 범위에서는 **서로 독립적으로 작성된 두 스키마·데이터 마이그레이션을 Git처럼 자동으로 의미 병합하고 안전성까지 보장하는 라이브러리는 확인되지 않았다.** 이 결론은 “그런 도구가 세상에 존재할 수 없다”는 보편 명제가 아니라, Alembic·Atlas·Flyway·Liquibase·Prisma·Sqitch의 공식 문서와 구현에서 확인한 범위에 한정된다. 저널도 이 경계를 직접 명시한다.

> “No examined source describes a tool that can safely synthesize a semantic merge of two independently authored, possibly conflicting schema/data migrations. This is a scoped research result, not a universal impossibility theorem.”

([Wave 2 — Git-like merge premise](./wave-2.md#git-like-merge-premise), [검증 근거 — SYNTHESIS.md의 verified claims](./SYNTHESIS.md#verified-claims))

따라서 현실적인 해법은 Git식 의미 병합을 찾는 것이 아니라, 문제를 세 층으로 나눠 각각 통제하는 것이다.

1. **브랜치 경합**은 병합 전에 선형 순서 충돌을 의도적으로 드러내고 재배치한다.
2. **배포 경합**은 마이그레이션 실행 주체를 하나로 만들고 DB 잠금으로 중복 실행을 막는다.
3. **구버전·신버전 애플리케이션의 공존**은 expand–contract 방식으로 스키마 변경을 여러 배포에 나눈다.

이 세 층을 모두 적용해야 “PR에서야 multi-head를 발견한다”와 “배포 중 여러 실행자가 충돌한다”는 서로 다른 실패를 함께 줄일 수 있다. DB advisory lock만 추가하면 배포 동시 실행은 막을 수 있지만, 두 브랜치가 같은 스키마를 서로 다르게 바꾼 사실까지 병합해 주지는 않는다. ([Wave 1 — operating methodology](./wave-1.md#axis-4--operating-methodology), [검증 근거 — SYNTHESIS.md의 findings by theme](./SYNTHESIS.md#findings-by-theme))

### 왜 Alembic의 merge revision은 Git식 의미 병합이 아닌가

Alembic revision은 DAG이므로 두 head를 부모로 갖는 **명시적 merge revision**을 만들 수 있다. 그러나 이것이 자동으로 해결하는 것은 그래프의 위상, 즉 “두 갈래 뒤에 다시 하나의 후속 지점을 만든다”는 문제뿐이다. 양쪽 migration이 같은 컬럼·인덱스·데이터를 충돌하는 방식으로 수정했다면, merge revision 본문에 들어갈 조정 작업은 사람이 판단하고 작성해야 한다.

> “Alembic is a revision DAG and can create an explicit merge revision; it does not semantically merge two competing SQL operations.”

([Wave 1 — Alembic multi-head symptom](./wave-1.md#axis-1--alembic-multi-head-symptom), [Wave 2 — Verification outcome](./wave-2.md#verification-outcome), [검증 근거 — SYNTHESIS.md의 contradictions](./SYNTHESIS.md#contradictions))

즉 `alembic merge`는 Git의 merge commit과 외형은 비슷하지만, SQL 변경의 합성·충돌 판정·온라인 호환성 보장은 제공하지 않는다. 독립 검증에서도 “Alembic merge file은 사람이 작성한 reconciliation을 담을 수 있다”는 점 때문에, “Alembic은 병합을 전혀 못 한다”는 넓은 부정 명제는 부분적 결과로 제한되었다. 정확한 표현은 **그래프 head는 합칠 수 있지만, 변경 의미는 자동 병합하지 않는다**이다.

### 조사된 도구들이 실제로 제공하는 것

| 도구·방법 | 실제 모델 | 해결하는 문제 | 해결하지 못하는 문제 |
|---|---|---|---|
| Alembic merge revision | 분기된 revision DAG에 합류 노드 추가 | multi-head 그래프를 다시 한 head로 연결 | 충돌 SQL의 의미 병합과 안전성 판정 |
| Atlas `migrate rebase` | 아직 적용되지 않은 파일의 이름을 다시 매기고 `atlas.sum` 갱신 | 선형 순서 복구와 체크섬 일관성 | SQL 실행·SQL 의미 병합 |
| Prisma Migrate | 이름순 pending migration 적용 + PostgreSQL advisory lock | 배포 시 중복 실행 방지와 선형 적용 | 기능 브랜치 간 graph merge |
| Kysely / node-pg-migrate / Knex | 순서 기반 migration history + DB 잠금 | 실행 경합 억제 | 브랜치 변경의 의미 병합 |
| Flyway / Liquibase / Sqitch | 순서·무결성 검사 또는 수동 조정 | 이력 검증과 예측 가능한 적용 | 독립 변경의 자동 semantic merge |

Atlas의 이름에 `rebase`가 들어가지만 Git rebase와 동일한 의미로 받아들이면 안 된다.

> “`atlas migrate rebase` only renames selected **unapplied** files and updates `atlas.sum`; it does not execute or merge SQL operations.”

Atlas는 기본적으로 선형 실행을 권장하며, 조사한 버전에서 rebase·lint·CI 통합은 Community Edition 범위를 벗어났다. 따라서 유료 기능을 받아들일 수 있다면 “충돌을 사전에 검사하고 unapplied history를 정렬하는 전달 제품”으로는 강하지만, Git식 semantic merge 엔진은 아니다. ([Wave 2 — Atlas conflict workflow](./wave-2.md#atlas-conflict-workflow), [검증 근거 — SYNTHESIS.md의 verified claims](./SYNTHESIS.md#verified-claims))

Prisma 역시 PostgreSQL에서 migration 적용 전 `pg_advisory_lock(72707369)`을 획득하고 pending migration을 이름순으로 처리하는 것이 확인되었다. 이는 **두 배포 프로세스가 동시에 migration을 실행하는 문제**에는 직접 효과가 있지만, 기능 브랜치 충돌은 reset/replay와 수동 해결의 영역으로 남는다. ([Wave 2 — Prisma current-lock verification](./wave-2.md#prisma-current-lock-verification), [검증 근거 — SYNTHESIS.md의 verified claims](./SYNTHESIS.md#verified-claims))

### 운영 대안 1 — Git 충돌을 조기 경보 장치로 사용한다

가장 실용적인 대안은 migration history를 조용히 합쳐지는 파일 집합으로 두지 않고, **각 애플리케이션 또는 migration stream마다 하나의 커밋된 순서 manifest를 둬서 두 브랜치가 같은 지점을 수정하게 만드는 것**이다. DoorDash가 공개한 방식에서는 오래된 브랜치가 이 manifest를 수정하려 할 때 Git conflict가 발생하므로, 작성자는 병합 전에 최신 기본 브랜치로 rebase하고 migration 순서를 다시 잡아야 한다.

> “DoorDash commits a per-app migration manifest so a stale branch creates a Git conflict and must be rebased before merge.”

([Wave 1 — Alembic multi-head symptom](./wave-1.md#axis-1--alembic-multi-head-symptom), [검증 근거 — SYNTHESIS.md의 findings by theme](./SYNTHESIS.md#findings-by-theme))

이 방식은 SQL을 자동 병합하지 않는다. 대신 **서로 독립적인 migration 추가가 Git에서 무충돌로 지나가 버리는 상황을 의도적으로 없애**, 순서와 충돌 검토를 PR 병합보다 앞당긴다. 현재 Alembic을 유지한다면 다음 운영 규칙으로 옮길 수 있다.

- migration 생성 시 revision 파일뿐 아니라 해당 stream의 단일 manifest/sequence 파일도 반드시 갱신한다.
- 최신 기본 브랜치와 동기화하지 않은 상태에서는 manifest 충돌을 해소할 수 없게 한다.
- 로컬 pre-push와 PR CI에서 `alembic heads`가 정확히 하나인지, manifest의 최종 revision과 일치하는지 검사한다.
- merge revision을 무조건 자동 생성하지 말고, 양쪽 SQL과 데이터 migration이 독립적인지 검토한 뒤 필요할 때만 사람이 reconciliation을 작성한다.

앞의 두 항목은 DoorDash 사례에서 직접 확인된 패턴이고, 뒤의 검사는 그 패턴을 Alembic에 적용하는 운영 설계다. 핵심은 충돌을 “없애는” 것이 아니라 **개발자의 브랜치에서 재현 가능하게 만들고, merge보다 이른 단계에서 실패시키는 것**이다.

### 운영 대안 2 — 배포에서는 실행 주체와 잠금을 분리해 이중 방어한다

브랜치 이력이 선형이어도 여러 애플리케이션 replica가 시작하면서 동시에 migration을 실행하면 별도의 경합이 생긴다. 이를 막는 기본 구조는 다음과 같다.

```text
merge된 선형 migration history
            ↓
환경별로 직렬화된 배포 단계
            ↓
단 하나의 one-shot migration runner
            ↓
DB advisory/row lock
            ↓
애플리케이션 rollout
```

- migration은 애플리케이션 replica의 startup hook이 아니라 전용 one-shot job 또는 배포 stage에서 한 번만 실행한다.
- 같은 환경을 대상으로 한 배포 파이프라인은 직렬화한다. GitLab resource group은 환경별 배포 직렬화 수단의 한 예다.
- migration 도구의 DB lock은 유지한다. 이는 runner 중복 기동이나 파이프라인 오작동에 대한 방어선이다.
- Argo CD PreSync Job은 한 Application 안에서 workload보다 먼저 migration을 실행하는 순서는 만들지만, 서로 다른 Application 전체를 전역 직렬화하지는 않는다. 이 부분은 sync-wave 계약으로부터의 추론이므로, 여러 Application이 같은 DB를 공유한다면 별도의 환경 단위 serialization이 필요하다.

> “One-shot migration runner / dedicated deployment stage avoids all application replicas competing to migrate; a DB lock is defense in depth, not a branch-conflict resolver.”

([Wave 1 — deployment integration](./wave-1.md#axis-3--deployment-integration), [Wave 1 — operating methodology](./wave-1.md#axis-4--operating-methodology), [검증 근거 — SYNTHESIS.md의 findings by theme](./SYNTHESIS.md#findings-by-theme))

### 운영 대안 3 — 충돌 없는 이력과 안전한 변경을 구분한다

single head와 DB lock이 모두 있어도, migration이 구버전 애플리케이션과 호환되지 않으면 무중단 배포는 실패할 수 있다. 삭제·rename·제약 강화·대규모 데이터 변환처럼 old/new 애플리케이션 버전이 겹치는 변경은 다음의 forward-only 단계로 나눠야 한다.

1. **Expand:** 새 컬럼·테이블·인덱스를 기존 코드와 호환되게 추가한다.
2. **Deploy:** old/new schema를 함께 다룰 수 있는 애플리케이션을 배포한다.
3. **Backfill & validate:** 데이터를 채우고 정합성을 검증한다.
4. **Contract:** 더 이상 참조하지 않는 이전 구조를 후속 migration에서 제거한다.

> “Use forward-only expand → deploy compatible application → backfill/validate → contract migrations for changes that overlap old/new application versions.”

([Wave 1 — operating methodology](./wave-1.md#axis-4--operating-methodology), [검증 근거 — SYNTHESIS.md의 findings by theme](./SYNTHESIS.md#findings-by-theme))

### 이 상황에 대한 선택 기준

TS migration 라이브러리로 교체하는 것만으로 Alembic multi-head의 본질이 사라지지는 않는다. Kysely, node-pg-migrate, Prisma처럼 선형 이력과 잠금을 제공하는 도구를 택하면 **DAG multi-head라는 표현 자체는 없어질 수 있지만**, 두 브랜치의 migration 순서 충돌과 SQL 의미 충돌은 운영 규칙으로 다뤄야 한다.

따라서 우선순위는 다음과 같다.

1. **즉시:** Alembic에 single-head 검사와 충돌 유도용 manifest를 추가하고, 최신 기본 브랜치 기준 검사를 로컬 pre-push와 PR CI 양쪽에서 실행한다.
2. **배포 안정화:** one-shot runner + 환경별 배포 직렬화 + DB lock을 함께 둔다.
3. **스키마 변경 규율:** 위험 변경은 expand–contract로 나눈다.
4. **도구 교체 평가:** TypeScript 전환 자체가 목적이라면 Kysely 같은 잠금 내장 도구, ORM 통합이 필요하면 Prisma, 유료 CI/lint/rebase 체계를 원하면 Atlas를 평가한다. 단, 어느 선택도 semantic merge를 제공한다고 간주하지 않는다.

이 조합이 Git에서 가져올 수 있는 가장 유효한 아이디어는 “DB 변경을 자동 병합한다”가 아니라, **선형 이력에 대한 충돌을 조기에 표면화하고, 사람이 재배치·조정한 결과만 배포하며, 실행은 다시 DB에서 직렬화한다**는 것이다. 조사 범위와 부정 명제의 한계는 [Wave 2의 Git-like merge premise](./wave-2.md#git-like-merge-premise), 직접 검증에서 확정·부분 확정된 범위는 [Wave 2의 Verification outcome](./wave-2.md#verification-outcome)과 [SYNTHESIS.md의 gaps](./SYNTHESIS.md#gaps)에서 이어서 확인할 수 있다.

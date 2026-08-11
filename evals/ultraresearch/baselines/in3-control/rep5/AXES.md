# TypeScript DB 마이그레이션 리서치 축과 워커 배정

## 리서치 목표

Alembic의 다중 head가 병렬 개발·배포에서 만드는 충돌을 줄이면서, TypeScript
서비스에서 배포와 함께 안전하게 실행할 수 있는 마이그레이션 도구와 운영 방법을
선정한다. 전제는 **롤백보다 forward-only 수정**이며, 후보를 단순 기능표가 아니라
브랜치 병합·배포 동시성·운영 책임까지 포함해 비교한다.

## 축과 워커

| 워커 | 직교 축 | 핵심 질문 | 조사 범위와 산출물 |
| --- | --- | --- | --- |
| W1 | **마이그레이션 그래프와 브랜치 병합 의미론** | 각 도구는 migration을 선형 순서, DAG, timestamp, lockfile 중 무엇으로 표현하는가? 병렬 PR 두 개가 같은 기준점에서 migration을 추가했을 때 head 충돌은 어떻게 감지·해결되는가? | Alembic multi-head를 기준 사례로 잡고, Prisma Migrate·Drizzle Kit·Knex·Kysely/Umzug 등의 ordering/충돌 정책, merge/squash/rebase 관행, CI guard를 비교한다. “Git처럼 자동 병합”이 가능한 범위와 불가능한 범위를 명확히 구분한 문서를 낸다. |
| W2 | **TypeScript 후보군의 기능·성숙도** | TS-first 도구 중 요구에 맞는 후보는 무엇이며, 어느 것이 schema-first/code-first/SQL-first인가? | Prisma Migrate, Drizzle Kit, Knex migrations, Kysely Migrator + Umzug를 1차 후보로 조사한다. 각 후보의 migration 생성·적용·history/checksum·drift 감지·커스텀 SQL·CLI/API·라이선스·유지보수 상태를 공식 문서와 릴리스/이슈로 표준화해 비교한다. |
| W3 | **배포 실행 모델과 동시성 제어** | Kubernetes/CI/CD에서 누가 언제 migration을 실행하며, 동시에 여러 배포가 시작되면 하나만 실행되도록 어떻게 보장하는가? | initContainer, one-off Job, release pipeline 단계, 앱 startup 실행을 비교한다. DB advisory lock/마이그레이션 테이블 락/Job 단일성, timeout·재시도·실패 시 배포 차단·관측성을 도구별 지원과 플랫폼 구현으로 분리해 정리한다. |
| W4 | **DB 엔진별 안전성과 forward-only 운영법** | 트랜잭션 DDL, long-running migration, lock, expand/contract가 대상 DB에서 어떤 제약을 갖는가? | PostgreSQL을 우선으로, 실제 사용 DB가 다르면 해당 엔진을 추가한다. 대규모 테이블 변경, index concurrently, backfill, 앱/DB 호환 기간, migration 실행 권한을 조사해 도구와 무관한 운영 가드레일 및 검증 체크리스트를 작성한다. |
| W5 | **Alembic에서의 전환 및 공존 경로** | 기존 Alembic history와 schema를 TS 도구가 어떻게 인수하거나 공존할 수 있는가? | 현재 Alembic이 관리하는 DB/서비스별 ownership을 확인한다. 신규 TS 서비스만 별도 history로 시작하는 방식, 동일 DB에서 단일 migration owner로 전환하는 방식, baseline/stamp, cutover 시 CI 차단 규칙과 되돌릴 수 있는 전환 절차를 설계한다. |
| W6 | **현업 신호와 의사결정 검증** | 문서상 기능이 실제 팀 규모·다중 브랜치·연속 배포에서 안정적으로 작동하는가? | 각 후보의 공식 issue tracker, changelog, 널리 쓰이는 공개 저장소의 migration 관행을 조사한다. multi-head/diff conflict/parallel deploy 관련 failure mode와 maintainer 권장 대응을 모아, W1–W5 결론을 반증하는 근거를 별도로 기록한다. |

## 공통 평가 기준

모든 워커는 아래 항목을 같은 형식으로 채운다. 이 기준은 후보 비교 축이 아니라
각 축의 발견을 합칠 수 있게 하는 공통 스키마다.

- 병렬 브랜치에서의 충돌 감지 시점과 해결 주체(개발자, CI, 도구, 운영자)
- migration 순서의 결정 규칙과 재현성
- 배포 동시 실행 방지 방법 및 실패 복구 경로
- schema drift와 이미 적용된 migration 변경을 탐지하는 방식
- raw SQL, 비트랜잭션 DDL, data backfill 지원 범위
- forward-only 정책과 zero-downtime expand/contract 적합성
- 무료/오픈소스 여부, 도입·전환 비용, 운영 관측성

## 작업 순서와 합성 규칙

1. W1과 W3은 Alembic multi-head를 “도구 교체만으로 사라지는 문제”로 오해하지
   않도록 먼저 제약을 정의한다.
2. W2는 해당 제약에 대해 후보별 근거를 수집한다.
3. W4와 W5는 후보와 독립적인 DB 안전성·전환 제약을 추가한다.
4. W6는 앞선 결론과 독립적으로 반증 사례를 찾는다.
5. 최종 합성에서는 후보별로 `브랜치 병합`, `배포 단일 실행`, `DB 안전성`, `전환성`을
   분리 채점한다. 이 네 항목을 한 기능으로 합쳐 “자동 해결”이라고 결론 내리지 않는다.

## 심층 브라우징 결정

**결정: No.** 이번 단계의 목표는 리서치 설계이며, 1차 근거는 후보 도구의 공식 문서,
GitHub 공개 이슈·소스, PostgreSQL 공식 문서로 충분히 수집 가능하다. 로그인·차단·JS 전용
소스 접근은 아직 리서치의 필수 조건이 아니므로 심층 브라우징 워커를 배정하지 않는다.

다만 다음 중 하나가 발생하면 별도 심층 브라우징 워커를 투입한다.

- 핵심 후보의 lock/concurrency 또는 migration ordering 정책이 공식 공개 문서에서
  확인되지 않는다.
- Cloudflare/JS 렌더링 때문에 공식 issue·discussion의 재현 가능한 근거를 읽을 수 없다.
- 실제 배포 플랫폼(예: CI/CD, Kubernetes 운영 문서)의 인증된 설정이 후보 선정의
  필수 증거가 된다.


# Phase 0 — DB 마이그레이션 버전 관리 조사 축

## Intent route

- **Posture:** explicit research. 사용자가 `ultraresearch orchestrator` 역할과 Phase 0 계약 이행을 명시했다.
- **Tier:** explicit `/ultraresearch` (maximum fan-out). 다만 이 문서는 Phase 0 산출물만이므로 실제 워커를 실행하지 않는다.
- **Research question:** Alembic의 multi-head 경쟁과 배포 실패를 줄이면서, TypeScript 생태계에서 배포와 함께 실행·관리하기 쉬운 forward-only DB migration/versioning 도구와 운영 방법을 찾는다.
- **Browsing gate:** **no**. 1차 조사는 공식 문서, 공개 GitHub 저장소/이슈, 공개 패키지 문서 및 실무 글로 충분히 시작할 수 있다. 인증·동적 렌더링으로 인해 핵심 근거가 막혔을 때만 후속 wave에서 `hermes` + `insane-browsing`으로 승격한다.

## Provisional requirement items / axes

| ID | Orthogonal axis (provisional requirement) | What must be established | Why it is distinct |
|---|---|---|---|
| A1 | TypeScript migration-tool landscape | Prisma Migrate, Drizzle Kit, Kysely migration runner, Knex, Umzug, db-migrate 및 후보의 DB 지원 범위·migration artifact·실행 모델·성숙도를 비교한다. | “TS에서 쓸 만한 라이브러리”라는 직접 질문이다. |
| A2 | Concurrent-branch graph and merge semantics | Alembic multi-head가 생기는 조건을 분해하고, 각 후보가 선형 history 강제·충돌 감지·migration ordering·merge/rebase workflow를 어떻게 다루는지 확인한다. Git처럼 자동 병합되는지와 불가능한 경우의 경계를 명확히 한다. | 도구 목록만으로는 실제 증상인 multi-head 경합을 해소하지 못한다. |
| A3 | Deploy-time execution and distributed safety | CI/CD·컨테이너·Kubernetes 배포에서 migration을 언제/어느 단일 실행 주체가 수행하는지, advisory lock/metadata table/transaction·failure behavior를 조사한다. | “배포될 때 함께 실행”과 배포 실패 방지는 runtime 운영 문제다. |
| A4 | Forward-only operational methodology | DB rollback을 전제하지 않는 expand/contract, compatibility window, immutable applied migration, append-only corrective migration, schema/data migration 분리와 PR/CI guardrail을 정리한다. | rollback 비요구는 도구 선택뿐 아니라 변경 규율의 요구사항이다. |
| A5 | Acme-specific adoption constraints | 실제 대상 리포의 현재 Alembic 호출 경로, PostgreSQL 사용 위치, 배포 파이프라인, Python↔TS 경계 및 migration ownership을 확인해 도입안의 적용 가능성을 검증한다. | 일반론을 현재 시스템의 구체적 해법이라고 오인하지 않기 위한 별도 축이다. 대상 리포 체크아웃이 이 scratchpad에 없으므로 현재 상태는 `unknown`이다. |

## Seeded intent-diff

| intent_id | Expected truth | Observed reality | Diff | Violated invariant | Intent source | Supporting observations | Status | Linked claim ids |
|---|---|---|---|---|---|---|---|---|
| I1 | TS 생태계에 실사용 가능한 DB migration/versioning 선택지가 있어야 한다. | 아직 후보·호환 DB·성숙도를 조사하지 않았다. | 후보군과 근거 부재 | 근거 없는 추천 금지 | 사용자 질문 | “TS 진영에서 쓸만한거 있어?” | unknown | C-A1-* |
| I2 | 동시 브랜치가 migration을 추가해도 Alembic multi-head 같은 배포 차단이 없어야 하거나, 배포 전에 결정적으로 해소돼야 한다. | Alembic multi-head로 경합 또는 배포 실패가 지속된다고 사용자가 보고했다. | 현행 방식이 동시성 요구를 충족하는지 미검증 | 하나의 배포 가능한 migration 상태 | 사용자 질문 | “multihead문제때문에 계속 경합이 발생하거나 배포 실패” | violated | C-A2-* |
| I3 | migration 실행은 배포 lifecycle에 안전하게 결합되고 중복 실행을 피해야 한다. | 현행 실행 위치·lock·CI/CD 순서는 미확인이다. | 운영 통합 방식 미확인 | 단일/상호배타적 migration executor | 사용자 질문 | “배포될 때 함께 실행된다던지 관리가 좀 쉬운거” | unknown | C-A3-* |
| I4 | 운영 원칙은 DB rollback 없이 forward-only corrective migration을 허용해야 한다. | 사용자가 rollback을 요구하지 않으며 DB rollback을 하지 않는다고 명시했다. | 후보의 forward-only 적합성 미확인 | applied migration은 되돌리지 않고 새 migration으로 교정 | 사용자 질문 | “db 롤백은 안한다는 마인드야” | true | C-A4-* |
| I5 | 권고안은 Acme의 실제 repo/deployment 경계와 양립해야 한다. | 제품 맥락은 제공됐지만 현재 작업 디렉터리에는 대상 리포가 없다. | 시스템별 적용 검증 불가 | 일반론과 현행 구성의 구분 | 제공된 AGENTS.md + 사용자 질문 | AGENTS.md: Python Django/Alembic 계열 backend와 TS monorepo가 공존; 현재 파일 목록에는 대상 repo 없음 | unknown | C-A5-* |

## Phase 1 worker allocation (planned; not launched)

모든 워커는 실제 Phase 1에서 한 응답 안에 동시 foreground로 시작한다. 각 웹 워커는 서로 다른 10개 이상 검색 각도, 핵심 결과의 원문 확인, 공식 문서 sitemap·GitHub/grep.app 실사용 조사를 수행한다. 각 코드베이스 워커는 3개 이상 키워드 변형, 구조 검색, 정의·참조, filename glob, `git log --all -S`/`--grep`를 수행하고 좌표와 인용문을 반환한다.

| Worker | Role | Owned axis / source territory | Deliverable focus |
|---|---|---|---|
| EX-1 | explore | A5: `acme-backend`의 Alembic config, revision graph, invocation/deploy hook | 현행 multi-head 생성·검증·실행 경로의 인용 가능한 증거 |
| EX-2 | explore | A5: `acme-home`의 Drizzle/Prisma/Knex/Kysely 사용과 Node deployment entrypoints | TS 쪽의 실제 ORM/migration 제약 및 ownership |
| EX-3 | explore | A3+A5: CI/CD, Helm/Kustomize/ArgoCD, Kubernetes Job/init container/lock 관례 | 배포 lifecycle에서 안전하게 단 한 번 실행할 자리 |
| EX-4 | explore | A4+A5: repo history의 migration 충돌·multi-head·배포 실패 사건과 기존 규칙 | 재발 패턴과 도입 guardrail의 현행 적합성 |
| LB-1 | librarian | A1: Prisma Migrate 공식 문서·GitHub source/issues | migration history, deploy command, drift/conflict semantics |
| LB-2 | librarian | A1: Drizzle Kit 공식 문서·GitHub source/issues | generate/migrate, journal/snapshot, push vs migration, production suitability |
| LB-3 | librarian | A1: Knex·Kysely 공식 migration APIs와 community runners | ordering, migration table, locking, TypeScript ergonomics |
| LB-4 | librarian | A1: Umzug·db-migrate 및 framework-specific runners | migration engine vs ORM-bound workflow의 후보 경계 |
| LB-5 | librarian | A2: Alembic multi-head 원인·merge revisions·practitioner postmortems | Git-like merge 기대와 DAG/linear-history 현실의 구분 |
| LB-6 | librarian | A2+A3+A4: 공개 엔지니어링 글·GitHub issue·Reddit/HN 실무 담론 | concurrent migration ownership, deploy locks, forward-only expand/contract workflow |

### Phase 1 execution constraints

- `EX-1`~`EX-4`는 대상 리포가 현재 scratchpad에 없으므로, Phase 1 전에 read-only checkout 또는 접근 가능한 repo 경로가 필요하다. 이를 확보하지 못하면 A5는 조사 gap으로 유지한다.
- Browsing worker는 배정하지 않는다. 공개 정적 자료가 부족하거나 차단된 경우에만 별도 expansion wave에서 최대 2개를 추가한다.
- 각 worker reply에는 발견·미조사 lead·dead end·open chain을 포함한 `## EXPAND` tail과 `## CLAIMS` 후보를 요구한다.

## Phase 0 boundary

이 파일만 작성한다. `$SESSION_DIR` 생성, `intent-diff.md` 분리 생성, worker spawn, 웹/코드베이스 조사, 추천 또는 도입 변경은 다음 Phase의 범위다.

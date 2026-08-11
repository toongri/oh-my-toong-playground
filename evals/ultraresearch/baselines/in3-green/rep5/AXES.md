# Phase 0 — TypeScript DB 마이그레이션 관리 조사 설계

## Intent route

- **Posture:** explicit research (사용자가 `ultraresearch` Phase 0 계약을 명시적으로 적용하도록 요청함). 단, 이번 지시는 Phase 0 설계 산출물로 제한되어 있어 조사·워커 실행·세션 디렉터리 생성은 보류한다.
- **Provisional tier:** Architecture. 단순 라이브러리 비교가 아니라, 프로덕션 스키마 변경의 배포 직렬화·브랜치 병합·장애 방지 방식을 결정하는 사안이기 때문이다.
- **Tier override:** 없음. Prometheus 분류 결과가 제공되지 않았으므로 위 등급은 Phase 0의 잠정 판단이다.
- **Browsing gate:** **no**. 후보의 공식 문서, GitHub 저장소/이슈, 공개 CI 예시와 실무 글은 표면 웹 조사로 확인 가능하다. 로그인·차단·JS 전용 자료가 핵심 근거일 것으로 보이지 않으므로 hermes / insane-browsing 워커는 배정하지 않는다. 이후 핵심 공식 문서나 운영 사례가 접근 제한 때문에 확인되지 않을 때만 gate를 `yes`로 재평가한다.

## Requirement items / orthogonal axes

아래 항목은 조사 전의 잠정 요구사항이며, Phase 4에서는 각각을 `covered`, `not applicable: <Phase 0 과분해 사유>`, `uncovered: <미조사 사유>` 중 하나로 판정한다.

| ID | 축 / 잠정 요구사항 | 조사에서 답할 질문 | 계획된 산출물 섹션 |
|---|---|---|---|
| A1 | TS 마이그레이션 도구와 버전 그래프 모델 | Drizzle Kit, Prisma Migrate, Kysely/Knex/node-pg-migrate 등은 마이그레이션의 순서·충돌·메타데이터를 어떻게 모델링하며, Alembic multihead와 동등한 문제가 생기는가? | 후보 도구와 병합 모델 |
| A2 | 동시 브랜치·multihead라는 증상 자체 | Alembic multihead가 실제로 어떤 Git/리비전 DAG/배포 순서에서 발생하는지, 단일 선형 로그로 바꾸면 어떤 충돌이 남는지, 팀이 쓰는 해소 규칙은 무엇인지 | 증상 원인과 협업 워크플로 |
| A3 | 배포 시 실행·직렬화·관측성 | CI/CD, Kubernetes job 또는 앱 시작 단계에서 마이그레이션을 안전하게 한 번만 실행하고, 동시 배포/복수 인스턴스 경쟁을 막는 공식 지원 또는 검증된 패턴이 있는가? | 배포 통합과 운영 제어 |
| A4 | forward-only 운영 정책 | DB 롤백을 전제하지 않고 expand/contract·호환 기간·실패 복구를 적용할 때 각 후보와 워크플로가 맞는가? | forward-only 설계 원칙 |
| A5 | 현재 환경과 도입 경로 | 이 코드베이스에 Alembic, 마이그레이션 실행 지점, DB 엔진, CI/CD 또는 이미 도입된 TS ORM/도구가 무엇인지 확인해 추천의 전제와 전환 비용을 실제 구성에 맞출 수 있는가? | 현황과 권장 도입안 |

## Seeded intent diff

| intent_id | expected truth | observed reality | diff | violated invariant | intent source | supporting observations | status | linked claim ids |
|---|---|---|---|---|---|---|---|---|
| I1 | 권장안은 병렬 브랜치에서 발생하는 Alembic multihead/머지 경쟁을 실질적으로 줄이거나 명시적 운영 규칙으로 통제해야 한다. | 현재 문제의 구체적 revision graph, 병합 절차, 실패 로그는 미확인. | 검증 필요. | 병렬 변경이 배포 가능한 단일 스키마 이력으로 수렴해야 한다. | 사용자 질문 | “multihead문제때문에 계속 경합이 발생하거나 배포 실패” | unknown | C1, C2, C5 |
| I2 | 후보는 TypeScript 생태계에서 실사용 가능한 DB 버전 관리 도구/방법론이어야 한다. | 대상 DB와 런타임, 이미 쓰는 TS ORM은 미확인. | 호환성 검증 필요. | 선택 도구가 실제 서비스 스택에서 실행 가능해야 한다. | 사용자 질문 | “db 버전관리 라이브러리 TS 진영에서 쓸만한거 있어?” | unknown | C1, C4 |
| I3 | 마이그레이션은 배포 시 함께, 중복 없이 실행·관리할 수 있어야 한다. | 현재 배포 파이프라인과 실행 방식은 미확인. | 구현 경로 검증 필요. | 동시에 배포된 프로세스가 경합 없이 스키마 변경을 적용해야 한다. | 사용자 질문 | “배포될 때 함께 실행된다던지 관리가 좀 쉬운거였으면 좋겠어” | unknown | C3, C5 |
| I4 | rollback 기능은 필수 평가 기준이 아니며, forward-only 복구가 가능한 방안을 우선한다. | 팀의 DDL 호환성·복구 규칙은 미확인. | 정책 구체화 필요. | 실패한 변경은 destructive rollback 대신 안전한 후속 migration으로 복구 가능해야 한다. | 사용자 질문 | “롤백 기능이 유료거나 없어도돼. 어차피 db 롤백은 안한다는 마인드야.” | unknown | C4, C5 |

## Phase 1 planned worker assignment

Architecture tier의 기본 floor는 explore 4명과 librarian 6명이다. Browsing gate가 `no`이므로 browsing 워커 2명은 **0명**으로 조정한다. 실제 Phase 1을 시작할 경우 아래 10명은 한 응답에서 병렬 foreground worker로 모두 실행한다.

| Worker | Role | Owns | Required evidence / completion focus |
|---|---|---|---|
| E1 | explore | A5: Alembic 구성, migration 디렉터리, revision 규칙, DB 연결 설정 | `alembic`, `versions`, `revision`, `upgrade`, `downgrade` 등 3개 이상 변형 검색, AST/구조 탐색, 정의·참조, 파일 glob, `git log --all -S`/`--grep`; 절대 경로와 인용된 `file:line` 근거 반환 |
| E2 | explore | A5/A3: CI/CD·Kubernetes·Docker·앱 기동에서 migration 실행 지점과 직렬화 장치 | `migrate`, `alembic upgrade`, `deploy`, `job`, `lock` 변형 검색과 역사 탐색; 실행 명령/조건을 인용해 연결 관계 보고 |
| E3 | explore | A2: multihead 또는 revision 충돌의 코드·이슈·커밋 이력 | `multiple heads`, `multihead`, `merge revision`, `alembic heads`, `branch_labels` 변형 및 `git log --all` 삭제 이력; 사건 근거와 해결 시도 인용 |
| E4 | explore | A5: TS 서비스·ORM·PostgreSQL/DB dialect·기존 migration 도구의 도입 제약 | `drizzle`, `prisma`, `kysely`, `knex`, `typeorm`, `postgres` 변형, manifest와 배포 설정 및 history; 후보 호환성에 영향을 주는 실제 근거 인용 |
| L1 | librarian | A1: Drizzle Kit의 generate/migrate, migration journal, 충돌 처리와 배포 예시 | 공식 문서·GitHub source/issues·sitemap으로 확인; 서로 다른 연산자/각도의 웹 검색 10개 이상, 중요 결과 전문 fetch |
| L2 | librarian | A1: Prisma Migrate의 migration history, conflict/resolve, shadow DB 및 배포 명령 | 공식 Prisma 문서 우선, GitHub/실사용 사례 보강; 검색 10개 이상과 원문 근거 |
| L3 | librarian | A1/A3: Kysely 및 node-pg-migrate의 migration ordering, lock/transaction, deploy integration | 공식 문서와 저장소 source를 대조하고 GitHub real-world usage를 탐색; 검색 10개 이상 |
| L4 | librarian | A1/A3: Knex, db-migrate, Umzug 및 SQL-first 도구의 실무 적합성 | 기능표가 아니라 concurrency/metadata/deploy 실행 관점의 공식 근거와 GitHub 사례; 검색 10개 이상 |
| L5 | librarian | A2: Alembic multihead의 원인과 팀 병합 정책·실제 postmortem | Alembic 공식 docs/issues, `site:reddit.com OR site:news.ycombinator.com`, 엔지니어링 블로그, GitHub issues/PR를 포함한 실무 담론; 검색 10개 이상 |
| L6 | librarian | A3/A4: forward-only expand/contract, CI job locking, zero-downtime schema migration 방법론 | 공개 운영 가이드·프레임워크 문서·사례; DB rollback 비의존 복구와 배포 경쟁 제어를 분리해 검증, 검색 10개 이상 |

모든 실제 gatherer 배정에는 다음을 포함한다: “명시적 exhaustive-research이므로 기본 retrieval budget과 stop-when-answered 규칙은 적용하지 않는다”, 각 worker의 고유 축·출처·완료 기준, 그리고 `## EXPAND` 꼬리(`LEAD`, `DEAD END`, `OPEN CHAIN`)를 반드시 반환한다. Gatherer는 검증 상태를 스스로 확정하지 않으며, 주장 검증은 후속 Phase 3의 별도 verifier/oracle가 담당한다.

## Phase boundaries and deferred actions

- 이 문서는 의도적으로 현재 디렉터리의 단일 산출물이다. 사용자 지시에 따라 `$SESSION_DIR`, `intent-diff.md` 별도 파일, worker, 웹 조사, 검증 artifact는 생성하지 않는다.
- 실제 조사가 승인되면 이 문서의 `Seeded intent diff`를 Phase 0 `intent-diff.md`의 초기 행으로 옮긴 뒤, 위 10명을 하나의 Phase 1 wave로 병렬 실행한다.
- A2는 라이브러리 후보 조사와 별도 축이다. 추천은 “TypeScript 도구가 있다”는 결론만으로 끝내지 않고, 현재 multihead 증상을 없애거나 운영적으로 막는지까지 평가해야 한다.

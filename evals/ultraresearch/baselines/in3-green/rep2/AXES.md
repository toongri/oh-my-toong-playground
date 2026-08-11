# Phase 0 — TypeScript DB 마이그레이션 버전관리 조사 축

## Intent route

- Posture: explicit research
- Tier: explicit `/ultraresearch` (max)
- Browsing: no
- Rationale: 후보 라이브러리의 공식 문서·릴리스·GitHub 사용례와 실무 담론은 일반 웹 검색과 저장소 검색으로 조사할 수 있다. 인증·JS 렌더링 전용 자료가 핵심 근거가 될 가능성은 현재 낮으므로 hermes/insane-browsing은 배정하지 않는다. 접근 제한으로 핵심 1차 문서를 확보하지 못할 때에만 다음 파동에서 게이트를 재평가한다.
- Scope boundary: DB 롤백을 제품 선택 기준에서 제외한다. 대신 forward-only 운영, 배포 시 실행 방식, 병렬 변경 병합 충돌, 현재 Alembic multi-head 증상을 함께 다룬다.

## Requirement items / report TOC

| ID | Requirement item (provisional) | Why it is independently required |
|---|---|---|
| A1 | TypeScript 생태계에서 실사용 가능한 DB 마이그레이션/버전관리 도구를 비교한다. | 사용자는 Alembic 대체 또는 보완 도구를 찾는다. |
| A2 | 여러 브랜치가 동시 변경될 때 Alembic multi-head와 같은 경쟁·배포 실패를 줄이는 병합 모델과 작업 방법론을 조사한다. | 도구 질문과 별개로, 사용자가 명시한 운영 증상이다. |
| A3 | CI/CD 또는 애플리케이션 배포와 함께 마이그레이션을 안전하게 실행·직렬화·관찰하는 운영 패턴을 조사한다. | “배포될 때 함께 실행”과 “관리 쉬움”이라는 채택 조건이다. |
| A4 | forward-only(비롤백) 전제에서의 안전장치—호환 가능한 확장/축소, 실패 복구, 드리프트 검증—를 평가한다. | 사용자는 DB 롤백을 하지 않는다고 명시했으며, 이는 도구의 다운/리페어 기능과 구별되는 운영 요구다. |
| A5 | 현재 Python/Alembic 사용 맥락에서 점진적 도입·공존·이관의 현실성을 평가한다. | 현행 도구와의 전환 비용 및 multi-head 완화책을 판단해야 한다. |

## Intent-diff seed

| intent_id | Expected truth | Observed reality | Diff | Violated invariant | Intent source | Supporting observations | Status | Linked claim ids |
|---|---|---|---|---|---|---|---|---|
| I1 | 팀은 TS 진영에서 채택 가능한 마이그레이션 도구 후보와 선택 근거를 원한다. | 후보·호환 DB·채택 제약은 아직 조사 전이다. | 후보군 및 적합성 미확정 | 추천은 공식 지원과 실제 운영 증거에 근거해야 한다. | 사용자 질문 | “db 버전관리 라이브러리 TS 진영에서 쓸만한거 있어?” | unknown | C-A1-* |
| I2 | 병렬 개발에서 migration graph가 복수 head로 분기되어도 PR/배포가 지속적으로 실패하지 않아야 한다. | Alembic multi-head로 경합·배포 실패가 발생한다고 보고됐다. | 현 상태는 단일 선형 적용 순서 또는 병합 규칙을 보장하지 못할 가능성이 있다. | 배포 대상 DB에는 결정적이고 일관된 migration 적용 순서가 있어야 한다. | 사용자 질문 | “multihead문제때문에 계속 경합이 발생하거나 배포 실패” | violated | C-A2-* |
| I3 | 배포와 연동해 마이그레이션을 실행하되, 동시 배포가 서로 충돌하지 않아야 한다. | 현행 실행 주체·락·CI/CD 파이프라인은 미확인이다. | 적절한 직렬화와 실패 처리 방식 미확정 | 동일 DB에 대한 schema 변경 실행은 단일 writer/상호 배제가 보장되어야 한다. | 사용자 질문 | “배포될 때 함께 실행된다던지 관리가 좀 쉬운거” | unknown | C-A3-* |
| I4 | DB 롤백은 필수 기능이 아니며 forward-only 복구가 허용된다. | 롤백 도구의 필요성은 낮지만 안전한 확장/축소와 재시도 방식은 미확인이다. | 평가 기준을 down migration 중심으로 둘 수 없다. | 되돌리기보다 호환성 있는 전진 변경과 복구 절차가 있어야 한다. | 사용자 질문 | “db 롤백은 안한다는 마인드” | true | C-A4-* |
| I5 | 현행 Alembic을 즉시 전면 교체하지 않아도 증상을 낮출 수 있는 경로가 있을 수 있다. | 저장소 구조·DB 경계·migration 소유권은 미확인이다. | 공존/이관 난이도 미확정 | 전환 제안은 실제 DB와 서비스 경계에 맞아야 한다. | 사용자 질문 | “지금 python라이브러리 alembic을 쓰고있는데” | unknown | C-A5-* |

## Orthogonal axes and Phase 1 worker assignment

| Axis | Core question | Worker assignment | Required evidence / expected output |
|---|---|---|---|
| A1 — TS 도구 적합성 | Prisma Migrate, Drizzle Kit, Kysely migration, Knex, Umzug, dbmate 등 중 무엇이 PostgreSQL·TS·배포 자동화에 맞으며, migration ID/순서/잠금/드리프트를 어떻게 다루는가? | Librarian L1 (공식 문서·릴리스); Librarian L2 (GitHub 실제 사용례); Explore E1 (현 저장소의 TS DB 도구·DB 접근 경계) | 공식 기능 매트릭스, 버전별 제약, 대규모 저장소 사용례, 실제 도입 가능 경계. |
| A2 — multi-head 증상과 병합 모델 | Alembic 다중 head가 왜 생기고, timestamp/linear SQL/명시적 의존성/squash/merge migration/중앙 직렬화 중 어떤 모델이 Git 병렬 개발에 가장 견고한가? | Librarian L3 (Alembic 공식·issue·실무 사례); Librarian L4 (practitioner discourse: GitHub·Reddit·HN·블로그); Explore E2 (Alembic 설정·revision 관례·CI 검증·Git 이력) | 증상 재현 조건, 도구 독립적 병합 원칙, Alembic 내 즉시 완화책, 후보 도구가 실제로 제거/이동시키는 문제의 구분. |
| A3 — 배포 실행 및 동시성 제어 | 마이그레이션을 CI, Kubernetes Job, release phase, 앱 시작, 혹은 별도 runner 중 어디서 실행할지와 advisory lock/lease/단일 writer를 어떻게 구성할까? | Librarian L5 (공식 배포·잠금 문서); Explore E3 (배포 매니페스트·CI·서비스 startup·DB 권한); Explore E4 (운영 관측·실패 복구 훅) | DB별 락 동작, 트랜잭션 DDL 제약, 재시도·timeout·관측 지점, 현 배포 체계에 맞는 실행 주체. |
| A4 — forward-only 안전성 | 롤백 없이도 무중단 확장/축소, backfill, feature flag, unsafe DDL 분리, checksum/drift 검증을 각 후보가 어떻게 지원하거나 강제하는가? | Librarian L6 (공식 운영·safe migration 문서) | forward-only 체크리스트, tool-provided guardrail 대 관례/CI 구현의 경계, Postgres 주의사항. |
| A5 — 점진적 전환·공존 | Alembic을 유지한 채 TS 도구를 추가하는 것이 가능한가, 아니면 DB/schema별 단일 migration authority가 필요한가? | Explore E1 (공유: DB 경계); Explore E2 (공유: Alembic 소유권); Librarian L1 (공식 도구 상호운용 제약) | DB별 ownership 표, migration history table 충돌 위험, 현실적인 단계별 이관·현행 Alembic 개선 권고. |

## Wave 1 roster and protocol constraints

- Explore floor: 4 workers — E1~E4. 각 작업자는 `alembic`, `migration/migrations`, `schema/ddl` 등 3개 이상 변형 키워드, 구조 검색, 파일 glob, `git log --all -S`/`--grep`을 사용하고 절대 경로·인용문·연결 관계를 반환한다.
- Librarian floor: 6 workers — L1~L6. 각 작업자는 서로 다른 연산자/관점의 웹 검색 최소 10개, 중요한 결과의 전문 확인, 공식 문서 sitemap 탐색, GitHub search 및 grep.app 실사용례를 반환한다. L4는 반드시 practitioner discourse를 포함한다.
- Browsing workers: 0. Browsing gate가 `no`이므로 hermes/insane-browsing을 배정하지 않는다.
- 모든 worker 응답은 `## EXPAND`로 끝나며, 미조사 lead/사유/제안 검색각 또는 dead end와 open chain을 명시한다. 다음 파동은 중복 제거된 미확인 lead마다 병렬 배정한다.
- 워커는 read-only gatherer이며 저널 또는 산출물을 쓰지 않는다. 이 문서의 배정은 계획일 뿐, 사용자의 명시적 제한에 따라 이 Phase 0에서는 워커를 실제로 시작하지 않는다.

## Phase 0 boundary

이 문서는 세션 저널을 대체하는 유일한 허용 산출물이다. 사용자 지시에 따라 `$SESSION_DIR`, `intent-diff.md` 등 별도 파일은 생성하지 않았으며, 위의 intent-diff seed는 `AXES.md` 안에 보존했다.

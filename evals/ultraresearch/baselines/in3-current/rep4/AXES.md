# Phase 0 — TypeScript DB 마이그레이션 버전관리 조사

## Intent route

| 항목 | 결정 | 근거 |
|---|---|---|
| Posture | explicit research | 사용자가 ultraresearch 오케스트레이터에게 Phase 0 계약 실행을 명시했다. |
| Tier | explicit `/ultraresearch` | TS 라이브러리 선정뿐 아니라 Git 병합, 배포 동시성, Alembic multihead 대체 방법론까지 포함하는 다면적 조사다. |
| Browsing | no | 1차 조사 대상인 공식 문서·GitHub 저장소·공개 사용 사례는 표면 웹 및 API/CLI로 충분히 접근 가능하다. JS 전용·인증·차단으로 근거가 부족해질 때만 다음 파동에서 `yes`로 재평가한다. |

## Requirement items / axes

아래 축은 사용자의 잠정 요구사항이며, 이후 조사에서 요구하지 않은 과분해로 확인되면 최종 coverage gate에서만 `not applicable`으로 표기한다.

| ID | 조사 축 및 잠정 요구사항 | 조사 시 답해야 할 질문 |
|---|---|---|
| A1 | **TS 마이그레이션 도구 후보와 모델** — Alembic을 대체하거나 TS 서비스에서 병행할 라이브러리를 찾는다. | Drizzle, Prisma, Kysely, Knex, node-pg-migrate, Umzug 등은 migration 파일 식별자·순서·메타데이터·배포용 실행 명령을 어떻게 관리하는가? |
| A2 | **다중 브랜치 병합과 migration graph 관리** — Alembic multihead 경합을 줄이는 병합 방식을 찾는다. | 각 도구는 분기된 migration의 충돌/순서/중복을 어떤 방식으로 드러내거나 방지하는가? Git rebase·번호 재부여·단일 선형 이력·충돌 감지 중 어떤 운영 모델이 실제로 필요한가? |
| A3 | **배포 시 실행·동시성 제어** — 마이그레이션을 애플리케이션 배포와 안전하게 결합한다. | CI/CD, Kubernetes Job/init container, advisory lock 또는 migration lock을 통해 정확히 한 번 실행하고 다중 replica 경쟁을 막는 권장 방식은 무엇인가? |
| A4 | **forward-only 운영 안전성** — DB 롤백 없이도 운영 가능한 변경 규율을 정한다. | expand/contract, backward-compatible deploy, schema/data migration 분리, 실패 복구용 보정 migration, checksum/immutability는 도구와 무관하게 어떻게 적용해야 하는가? |
| A5 | **Alembic 공존·전환 경계** — 현재 Python Alembic 사용 환경에서 TS 도구를 도입할 때 소유권을 분리한다. | 같은 DB/스키마를 둘 이상의 migration runner가 관리해도 되는가? 가능하다면 migration history table, schema ownership, 전환 시점은 어떻게 설계해야 하는가? |

## Phase 1 worker assignment

explicit tier의 바닥값에 따라 explore 4명·librarian 6명을 한 파동에 동시 배정한다. Browsing gate가 `no`이므로 hermes/insane-browsing 워커 2명은 이번 1차 파동에 배정하지 않는다.

| Worker | Role | 소유 축 / 고유 각도 |
|---|---|---|
| E1 | explore | A1: 현재 코드베이스의 TS ORM·migration runner·migration history table·package script 현황 |
| E2 | explore | A2: Alembic 사용처, multihead/merge/revision 관련 구성·문서·과거 변경 이력 |
| E3 | explore | A3: CI/CD·Kubernetes/배포 구성의 migration 실행 지점 및 replica 동시성 방어 |
| E4 | explore | A4–A5: 스키마 소유 경계, Python/TS 서비스별 DB 접근, forward-only 관례와 전환 제약 |
| L1 | librarian | A1: Drizzle Kit 및 Drizzle ORM의 migration 생성·실행·journal 공식 문서와 OSS 사용 사례 |
| L2 | librarian | A1: Prisma Migrate의 migration history·`migrate deploy`·`migrate resolve` 공식 문서와 알려진 제약 |
| L3 | librarian | A1–A2: Kysely migrator·Knex·node-pg-migrate의 선형 이력과 파일 순서/충돌 처리 비교 |
| L4 | librarian | A2: Alembic multihead가 생기는 원인과 Git 기반 선형화·merge revision·CI guardrail의 공식/실전 방법론 |
| L5 | librarian | A3: PostgreSQL migration lock, transactional DDL, Kubernetes/CI 배포 통합의 공식 문서와 실전 구현 |
| L6 | librarian | A4–A5: Atlas/Flyway/Liquibase 같은 declarative/운영 도구 및 multi-runner 공존·전환 사례 |

## Phase 0 session journal

- Session directory: `$OMT_DIR/oh-my-toong-playground/ultraresearch/ts-db-migration-management-20260811-131105/`
- Next phase: 위 10개 워커를 단일 응답에서 병렬로 실행하고, 각 워커에게 exhaustive-research budget lift와 `## EXPAND`/`## CLAIMS` 반환 계약을 부여한다.

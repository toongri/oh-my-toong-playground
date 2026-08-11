# Phase 0 — DB 마이그레이션/버전관리 조사 축

## 실행 경계

- 요청 범위는 Phase 0 산출물 하나(`AXES.md`)로 한정한다.
- 사용자의 명시적 제약에 따라 세션 디렉터리와 `intent-diff.md`는 만들지 않으며, Phase 1 워커도 실제로 실행하지 않는다.
- 아래의 워커 배정은 후속 saturation wave를 위한 사전 배정이다.

## Intent route

| 항목 | 결정 | 근거 |
|---|---|---|
| Posture | explicit research | 사용자가 `ultraresearch` Phase 0 계약을 명시적으로 호출했다. |
| Tier | explicit `/ultraresearch` (max) | 라이브러리 비교뿐 아니라 동시 변경·배포 실패를 막는 운영 방법론까지 판단해야 한다. |
| Browsing gate | **no** | 1차 근거는 공개된 공식 문서, npm/GitHub 저장소, 공개 엔지니어링 글과 토론으로 충분히 수집 가능하다. 인증·JS 전용 자료가 필수라는 신호는 아직 없다. |
| Codebase lane | 조건부 제외 | 현재 작업 디렉터리에 대상 서비스 저장소나 Alembic 설정이 없다. 실제 배포 경합의 직접 원인 판정은 대상 저장소가 제공될 때만 코드베이스 축으로 추가한다. |

## 사전 intent-diff 기대치

정상 Phase 0라면 별도 `intent-diff.md`에 시드할 항목이다. 이 요청의 단일-파일 제약 때문에 여기에 보존한다.

| intent_id | expected truth | observed reality | diff / violated invariant | intent source | status | linked claim ids |
|---|---|---|---|---|---|---|
| I-01 | TS 진영에서 운영 가능한 DB 마이그레이션 도구 또는 조합을 찾는다. | 구체 후보는 미조사. | 후보군·적합성 미확정. | 사용자 질문 | unknown | TBD |
| I-02 | 동시 PR/배포로 Alembic multi-head가 생겨도 배포가 경합·실패하지 않는 흐름이 필요하다. | 사용자가 multi-head와 배포 실패를 보고했다. | 단일 선형 migration history 불변식이 현재 보장되지 않는 것으로 보임; 프로젝트 증거는 미확인. | 사용자 질문 | unknown | TBD |
| I-03 | 마이그레이션은 배포 시 함께 안전하게 실행·관리되어야 한다. | 현재 CI/CD·락·실행 주체는 미확인. | 실행 직렬화/멱등성/관측성 설계가 미확정. | 사용자 질문 | unknown | TBD |
| I-04 | down/DB rollback은 필수 기능이 아니다. | 사용자가 rollback을 사용하지 않는다고 명시했다. | 도구 평가는 forward-only 복구를 우선해야 함. | 사용자 질문 | true | TBD |
| I-05 | Git처럼 병합 충돌을 관리하거나, 그 문제를 구조적으로 제거하는 방법을 원한다. | "git처럼 잘 병합"이라는 요구가 있으나 정확한 의미는 미조사. | revision DAG 병합 자체와 migration serialization/workflow 대체안을 구분해 검증해야 함. | 사용자 질문 | unknown | TBD |

## 조사 축 = 잠정 요구사항 = 후속 REPORT 목차

| axis / req_id | 조사 질문 | 완료 시 답해야 하는 것 | Phase 1 예정 워커(소유 각도) |
|---|---|---|---|
| A1 / R1 — TS 도구 적합성 | Drizzle Kit, Prisma Migrate, Kysely migration, Umzug, Knex, TypeORM 등은 migration 생성·추적·실행을 어떤 모델로 지원하는가? | 유지보수성, SQL 우선성, schema-drift 처리, migration metadata, TypeScript 적합성 기준의 후보 short-list와 탈락 이유. | L1 librarian: 공식 문서·릴리스·GitHub source에서 도구 모델 비교. |
| A2 / R2 — multi-head와 병합 모델 | Alembic multi-head는 왜 생기며 TS 후보는 branch migration을 어떻게 표현·검증하는가? "Git 같은 병합"은 가능한가, 아니면 단일 writer/linear history가 정답인가? | 각 도구의 분기·충돌 감지·migration ordering·merge 지원 여부와, 충돌을 제거/조기 검출하는 workflow 결론. | L2 librarian: 공식 migration semantics 및 issue tracker; L3 librarian: 공개 실무 장애·postmortem·Reddit/HN/engineering blog. |
| A3 / R3 — 배포 동시성 제어 | 여러 배포가 같은 DB에 migration을 실행할 때 안전한 소유권·락·재시도·timeout 설계는 무엇인가? | CI/CD 단일 migration job, advisory/distributed lock, Kubernetes Job/leader election, transactional DDL의 경계 및 실패 복구 운영안. | L4 librarian: PostgreSQL/DB lock 및 각 도구 deploy 공식 문서; L5 librarian: CI/CD·Kubernetes 운영 패턴과 공개 구현 사례. |
| A4 / R4 — forward-only 복구·릴리스 운영 | rollback을 배제할 때, 실패 migration·호환성·expand/contract·backfill을 어떻게 관리해야 하는가? | deploy-safe ordering, app/db compatibility window, forward fix, migration review/validation 관문을 포함한 권고 workflow. | L6 librarian: 공식 operational guidance와 대규모 서비스 실무 사례. |
| A5 / R5 — AlgoCare 현재 상태 적용 조건 | 현재 Alembic의 revision graph, migration 실행 위치, CI/CD 동시 실행, DB 종류가 어떤가? | 라이브러리 교체가 필요한지, Alembic workflow/배포 lock만 고치면 되는지 판정할 증거 목록. | E1 explore (조건부): 대상 저장소의 Alembic 설정·CI/CD·migration 호출부; E2 explore (조건부): git history에서 multi-head/merge migration 이력; E3 explore (조건부): 배포 manifest·job·lock 구현; E4 explore (조건부): DB engine/DDL 및 app compatibility call sites. |

## Wave 1 사전 배정 규칙

- 코드베이스가 제공되지 않은 현재 상태에서는 L1–L6만 실행한다. 각 librarian은 서로 겹치지 않는 위 소유 각도를 조사하고, 공식 문서·공개 GitHub 사용례·실무 담론을 분리해 최소 10개 서로 다른 검색 각도로 수집한다.
- 대상 저장소가 제공되면 E1–E4를 같은 wave에 병렬로 추가한다. 각 explorer는 3개 이상 키워드 변형, 구조 검색, 참조 추적, 파일 glob, `git log --all -S`/`--grep`을 수행한다.
- Browsing gate가 `no`이므로 Hermes/insane-browsing 워커는 배정하지 않는다. 공개 자료가 실제로 차단되어 핵심 주장 검증이 불가능해질 때에만 다음 wave 경계에서 gate를 `yes`로 변경한다.
- 모든 예정 워커는 결과에 `## EXPAND` tail 및 `## CLAIMS` 후보를 포함해야 하며, 실제 조사 결과로만 후보·권고를 확정한다.

## 후속 판단의 경계

이 Phase 0는 어떤 라이브러리가 최선인지, Alembic이 문제의 직접 원인인지 아직 결론내리지 않는다. 특히 multi-head는 도구 자체보다 브랜치 병합 규칙과 동시에 실행되는 배포 job의 부재에서 생길 수 있으므로, A2와 A3을 분리해 검증한다.

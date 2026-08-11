# TS DB 마이그레이션/버전관리 리서치 축

## 리서치 범위와 전제

- 대상은 TypeScript/Node.js 서비스에서 운영 가능한 스키마 마이그레이션 도구와 운영 방법론이다.
- 핵심 문제는 Alembic의 multi-head처럼 독립 브랜치가 동시에 마이그레이션을 추가할 때 생기는 그래프 분기, 병합 충돌, 배포 실패다.
- DB down migration은 평가 기준에서 제외한다. 대신 **forward-only(보정 마이그레이션)**, 배포 안전성, 팀 운영 난이도를 평가한다.
- 각 워커는 자기 축의 결론뿐 아니라, 후보별 원문 근거 URL·버전/문서 기준일·반증 사례를 반환한다.

## 직교 축 및 워커 배정

| ID | 직교 축 | 담당 워커 | 조사 질문 | 주요 1차 소스 | 산출물 |
|---|---|---|---|---|---|
| A1 | **마이그레이션 그래프·동시성 모델** | `worker-migration-graph` | 도구가 선형 revision만 허용하는가, DAG/branch/merge head를 모델링하는가? 동시 PR 두 개가 migration을 만들고 순서가 바뀌거나 합쳐질 때 무엇이 실패하고 어떤 규칙으로 해소되는가? | 각 도구의 migration-history/locking 문서, 구현 저장소, issue tracker | 후보별 graph 모델, multi-head 재현 시나리오, 충돌 해소 방식과 잔여 위험 |
| A2 | **TypeScript 후보군·ORM 적합성** | `worker-ts-ecosystem` | Prisma Migrate, Drizzle Kit, Kysely 생태계, Knex, Umzug, db-migrate 등에서 실제로 TS-first로 쓸 수 있는 선택지는 무엇인가? PostgreSQL 및 현 ORM/쿼리 계층과의 결합 비용은? | 공식 문서·공식 GitHub 저장소·release notes | 후보 롱리스트, 지원 DB/TS/SQL escape hatch, 성숙도·활성 유지보수 표 |
| A3 | **배포 시 실행·상호 배제·실패 복구** | `worker-deploy-operations` | CI/CD, Kubernetes Job/init container, 앱 startup 중 어디에서 실행하는 것이 적절한가? advisory lock/마이그레이션 테이블/단일 실행 보장은 어떤 방식인가? 중단·재시도·부분 적용은 어떻게 처리되는가? | 도구 공식 deployment docs, PostgreSQL 공식 locking 문서, 주요 OSS 배포 예시 | 권장 배포 토폴로지, lock/timeout/retry 정책, failure-mode 표와 운영 runbook 초안 |
| A4 | **Git 중심 팀 워크플로와 예방 통제** | `worker-git-governance` | Git rebase/merge queue, migration 파일 명명·순서 규칙, CI validation, 단일 migration authoring/serializing 전략 중 무엇이 multi-head를 구조적으로 줄이는가? "자동 병합"의 한계는 무엇인가? | 공식 GitHub merge queue docs, 도구 CI 가이드, 대규모 OSS의 migration contribution 규칙 | 브랜치→PR→merge→deploy 흐름, CI gate, 충돌 발생 시 forward-only 해결 절차 |
| A5 | **안전한 스키마 진화와 무중단 배포** | `worker-schema-safety` | expand/contract, backward-compatible code, index/concurrent DDL, long-running data backfill을 버전관리와 어떻게 분리해야 하는가? 도구가 이를 직접 지원하는가? | PostgreSQL 공식 DDL docs, 도구 공식 migration docs, 신뢰 가능한 운영 가이드 | 위험 DDL 분류, expand/contract 단계, 후보 도구별 지원/수동 운영 경계 |
| A6 | **의사결정·검증 매트릭스** | `worker-evaluation` | 위 축의 결과를 어떤 가중 기준으로 비교하고, 상위 2~3개 후보를 작은 POC로 어떻게 검증할 것인가? Alembic 유지+운영개선도 기준선으로 두면 무엇이 달라지는가? | A1~A5 결과, 후보의 공식 quickstart/CI examples | 가중 비교표, 2-PR 동시 migration POC 명세, 채택/탈락 판정 기준 |

## 워커 간 경계와 인수인계

- A1은 **버전 그래프 의미론**만 소유한다. 배포에서 lock을 거는 실제 방식은 A3가 소유한다.
- A2는 후보를 넓게 수집하지만, "multi-head를 해결한다"는 평가는 A1의 근거를 인용해야 한다.
- A4는 사람·Git·CI 통제를 다루고, DB 잠금·실행 보장은 A3으로 넘긴다.
- A5는 DDL 안전성의 도구 지원과 운영 경계를 정리하며, 최종 후보 선호도는 A6이 통합한다.
- A6은 새로운 제품 사실을 수집하지 않는다. A1~A5의 근거를 같은 평가 척도로 정규화하고 POC를 설계한다.

## 공통 비교 계약

모든 워커는 후보를 다음 기준으로 `지원 / 부분 지원 / 미지원 / 문서 불명`으로 표시한다.

1. 동시 PR이 만든 migration을 merge/deploy할 때의 결정성
2. migration 실행의 단일성(락 또는 직렬화)과 실패 후 재실행 안전성
3. SQL 직접 작성과 ORM schema diff의 경계 및 탈출구
4. forward-only 운영, schema/data migration 분리, zero-downtime 절차
5. CI·Kubernetes 배포 파이프라인에 넣는 난이도
6. 유지보수 상태, PostgreSQL 지원, 라이선스/유료 의존성

공통 재현 시나리오는 다음 하나로 고정한다: `main`에서 PR-A와 PR-B가 동시에 각각 새 migration을 추가하고, B가 먼저 배포된 뒤 A가 merge·배포된다. 각 후보는 이 상황에서 자동 처리되는 부분, 사람이 직렬화해야 하는 부분, 실패 메시지와 복구 절차를 모두 기록한다.

## 심층 브라우징 결정

**결정: no.** 이 단계의 목표는 리서치 설계이며, 실제 조사도 우선 공개된 공식 문서·공개 GitHub 저장소·PostgreSQL 문서로 충분히 시작할 수 있다. 따라서 blocked/auth-gated/JS-rendered 소스 전담 워커(`hermes` + `insane-browsing`)는 첫 파동에 배정하지 않는다.

다만 후보의 핵심 동시성/배포 동작이 공개 문서에 없고 issue·release note가 JS 전용이거나 접근 차단되어 A1 또는 A3의 결론이 `문서 불명`으로 남는 경우에만, 해당 후보와 쟁점으로 범위를 좁혀 심층 브라우징 워커를 후속 파동에 투입한다.

## 통합 순서

1. A1~A5를 병렬로 조사한다.
2. A6이 공통 비교 계약으로 후보를 정규화하고, Alembic 유지+운영개선 기준선과 비교한다.
3. 상위 후보 각각에 대해 고정 재현 시나리오 POC를 실행한다.
4. POC에서 확인된 결과만으로 권고안과 배포 runbook을 확정한다.

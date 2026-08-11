# TS DB 마이그레이션 리서치 축 및 워커 배정

## 리서치 목표

Alembic의 `multi-head` 경합을 줄이면서, TypeScript 서비스에서 배포와 함께
예측 가능하게 실행할 수 있는 DB 마이그레이션 방식을 평가한다. 결론은 특정
라이브러리의 인기 비교가 아니라 다음을 분리해 제시해야 한다.

- 동시 브랜치가 만든 변경을 어떤 모델로 합류시키는가
- 실제 배포에서 한 번만, 안전하게 실행되는가
- Acme의 TypeScript 스택과 운영 제약에 얼마나 적합한가

`down`/DB 롤백은 필수 평가 항목이 아니다. 대신 forward-only 복구, 실패 후
재시도, 그리고 확장/축소(expand/contract) 변경을 평가한다.

## 직교 축과 워커

| ID | 직교 축 | 이 축만이 답하는 질문 | 워커 배정 및 조사 범위 | 주요 1차 소스 | 산출물 |
| --- | --- | --- | --- | --- | --- |
| A1 | **버전 그래프 모델** | 병렬 브랜치가 만든 migration을 선형화·합류·정렬하는 기본 단위가 무엇인가? 다중 head를 표현/해결/금지/회피하는가? | **W1 — 모델 분류**: revision-DAG(Alembic형), timestamp/append-only, 순번 기반, schema-declarative/diff 기반으로 TS 도구를 분류한다. 각 모델의 충돌 표면과 “Git처럼 병합” 가능한 경계를 명시한다. | 각 도구의 migration ordering/history 문서와 구현 저장소 | 모델별 multi-head 발생 조건, 병합 절차, 자동 해결 불가능한 의미 충돌 목록 |
| A2 | **협업·Git 워크플로** | PR/브랜치/릴리스 브랜치가 동시 진행될 때 누가 언제 어떻게 충돌을 해결하는가? | **W2 — 협업 규칙**: migration 파일명·번호 예약, rebase 시 재번호화, merge migration, squash/fix-up, protected main의 검증, 여러 저장소/서비스의 소유권을 조사한다. 도구 기능과 팀 규약을 엄격히 구분한다. | 공식 가이드, 유지보수자 권고, 대규모 OSS 저장소의 실제 migration history | 권장 branching policy와 CI guardrail; 사람의 결정을 대체할 수 없는 사례 |
| A3 | **배포 실행·동시성 제어** | deploy 중 migration을 어느 실행 주체가 수행하며, 다중 replica/재배포에서 한 번만 실행됨을 어떻게 보장하는가? | **W3 — 런타임 운영**: CI/CD job, Kubernetes Job/init container, application startup, advisory/distributed lock, migration metadata table, timeout/retry/failure handling을 비교한다. | 도구의 deploy 문서, PostgreSQL locking 문서, Kubernetes Job 문서 | 권장 실행 토폴로지와 lock/failure 시나리오별 동작 표 |
| A4 | **TypeScript 도구 적합성** | 후보 라이브러리가 TypeScript·PostgreSQL·현재 ORM/서비스 경계에서 실제로 쓸 수 있는가? | **W4 — 후보군 검증**: Drizzle Kit, Prisma Migrate, Kysely migration API, Knex migrations, Umzug 및 Atlas의 TS 사용 경로를 대상으로 지원 상태·migration 생성/실행·CI API·PostgreSQL 기능을 사실 확인한다. ORM을 강제하는 도구와 독립 도구를 구분한다. | 공식 문서, 공식 GitHub 저장소, release/issue tracker | 후보별 지원 매트릭스와 제외 사유. “TS에서 호출 가능”과 “TS 네이티브”를 구분 |
| A5 | **스키마 변경 안전성** | 롤백하지 않는 전제에서 live DB와 구/신 애플리케이션이 공존해도 안전한가? | **W5 — forward-only 안전성**: transactional DDL 범위, non-transactional 작업, lock duration, backfill 분리, expand/contract, compatibility window, 실패한 migration의 repair/baseline 방식을 조사한다. | PostgreSQL 공식 문서와 도구의 production migration 문서 | forward-only 운영 규칙 및 위험한 migration 패턴 체크리스트 |
| A6 | **도입·전환 비용** | Alembic 이력과 이미 운영 중인 DB를 새 방식으로 옮길 때 무결성을 잃지 않는가? | **W6 — 마이그레이션 전환**: baseline/stamp, 기존 revision ledger 보존, 단일 전환 cutover, 병행 실행 금지, 개발·staging·production 검증 순서를 조사한다. | 도구 공식 migration/import/baseline 문서, PostgreSQL 메타데이터 관행 | 현실적인 전환 경로, 되돌릴 수 없는 cutover 지점, 사전 조건 |
| A7 | **선정 기준·권고안** | 위 사실을 어떤 우선순위로 비교해 Acme에 맞는 선택으로 바꿀 것인가? | **W7 — 의사결정 종합**: A1–A6의 확인된 결과만 사용해 가중치 없는 decision matrix를 작성하고, 추천안·조건부 차선안·채택하지 않을 모델을 제시한다. 라이브러리 기능, 플랫폼 운영, 팀 규약의 책임 경계를 검토한다. | W1–W6의 검증된 증거만 사용; 신규 사실 수집 금지 | 비교표, 권고안, 필수 운영 규약, 남은 검증 항목 |

### 축 간 경계

- A1은 **버전 표현 방식**, A2는 그 표현을 사용하는 **사람과 Git 절차**만 다룬다.
- A3은 **실행 위치와 단일 실행 보장**, A5는 **변경 자체의 DB 안전성**만 다룬다.
- A4는 후보의 **사실 적합성**, A6는 **기존 Alembic에서의 이동**, A7은 앞선 사실의 **판단**만 담당한다.

따라서 “timestamp migration이면 multi-head가 없다”는 주장은 A1에서, “CI에서
순번 충돌을 막는다”는 주장은 A2에서, “배포 시 한 번만 실행된다”는 주장은
A3에서 각각 독립적으로 검증한다.

## 공통 조사 규칙

- W1–W6은 공식 문서와 공식 저장소를 우선 사용하고, 유지보수 중단 여부·현재 지원 버전·라이선스를 확인한다.
- 실제 코드 예시는 PostgreSQL을 기준으로 재현 가능해야 하며, 문서에 없는 동시 실행/순서 보장 주장은 작은 검증 DB에서 별도로 시험한다.
- 사용 사례는 근거 보강용일 뿐, 라이브러리 동작의 근거는 아니다.
- W7은 독립 조사 워커가 아니라 종합 워커이며, 사실 주장을 새로 추가하지 않는다.

## 심층 브라우징 결정

**결정: no.** 이번 리서치의 권위 있는 근거는 공개된 공식 문서, 공개 GitHub
저장소, PostgreSQL/Kubernetes 문서로 충분히 수집 가능하다. 로그인 전용
벤더 콘솔, 유료 문서, 또는 JavaScript로만 렌더링되는 화면은 배포·버전 그래프의
정확한 동작을 입증하는 1차 근거가 아니므로, blocked/auth-gated/JS-rendered
소스 전용 심층 브라우징 워커는 배정하지 않는다.

실제 조사 중 공개 문서가 핵심 동작을 생략하고 오직 JS 렌더링된 공식 문서에만
존재한다는 증거가 생길 때에만, 해당 도구와 누락된 질문 하나로 범위를 제한한
심층 브라우징 워커를 추가한다.

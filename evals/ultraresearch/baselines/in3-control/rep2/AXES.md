# TypeScript DB migration 리서치 축과 워커 배정

## 범위와 결정 질문

목표는 PostgreSQL을 쓰는 TypeScript 서비스에서 Alembic의 `multi-head`로
발생하는 병렬 변경 경합과 배포 실패를 줄이는 migration 운영 방식을 고르는
것이다. 이 리서치는 **DB down migration은 채택 기준에서 제외**하고,
forward-only 수정 및 배포 안정성을 우선한다.

조사 대상 후보군은 Prisma Migrate, Drizzle Kit, Kysely Migrator,
node-pg-migrate, Umzug, dbmate와 (TypeScript에서 CLI로 함께 쓸 수 있는)
Atlas를 우선으로 한다. 후보 추가·제외는 아래 각 축의 증거로만 결정한다.

중요한 전제: Git처럼 임의의 두 DB 변경을 자동 병합할 수 있는지는 별도
검증 대상이다. 병합 가능성은 SQL의 의미와 실행 순서에 의존하므로, 단순히
파일 충돌이 없거나 migration ID가 timestamp라는 사실만으로 해결됐다고
판정하지 않는다.

## 직교 축과 워커

| 워커 | 축 | 이 축에서만 답할 질문 | 확인할 1차 증거 | 산출물 |
| --- | --- | --- | --- | --- |
| W1 | **분기·병합 의미론** | 병렬 브랜치 migration을 어떤 상태 모델(단일 선형 이력, DAG/head, 선언형 diff)로 표현하는가? 두 브랜치가 합쳐졌을 때 필요한 사람의 조정은 무엇이며, 실행 순서는 결정적인가? | 공식 migration-state 문서, migration metadata/schema, 해당 구현 소스와 공식 issue/FAQ | 후보별 `parallel branches → merge → deploy` 시나리오 표. 자동 해결·명시적 merge migration·재정렬·불가를 구분한다. |
| W2 | **배포 동시성·실행 통합** | 여러 Pod/Job/배포가 동시에 시작될 때 적용을 직렬화하는 DB lock 또는 단일 실행 보장이 있는가? pnpm/Node/컨테이너/ArgoCD 배포 흐름에 어디에 붙이며, 실패 뒤 재시도는 안전한가? | 공식 deploy/CI 문서, PostgreSQL locking 구현, CLI exit-code·migration table 동작 | 권장 실행 topology(별도 migration Job, pre-sync hook, app startup 금지/허용 조건)와 후보별 lock·retry 표. |
| W3 | **TypeScript 개발 경험·통합성** | schema authoring, migration 생성, raw SQL, 기존 PostgreSQL 접근 계층과의 결합, monorepo/pnpm/Node 22 사용성이 어떤가? 런타임 dependency와 CLI만의 경계는 무엇인가? | 공식 TypeScript API/CLI 문서, package manifest, 최소 PoC | 동일한 `add column → backfill → index` 예제를 작성한 PoC와 developer workflow 비교. 운영 안전성 평가는 하지 않는다. |
| W4 | **운영 안전성·drift 통제** | checksum/immutable history, schema drift 감지, transaction DDL, long-running migration 분리, 사전 검증 및 forward-fix 지원이 있는가? | 공식 production/limitations 문서, metadata table 정의, PostgreSQL DDL 제약의 1차 문서 | 배포 전·중·후 통제 체크리스트와 위험 신호 표. rollback 기능은 점수화하지 않는다. |
| W5 | **채택·거버넌스·전환 경로** | Alembic 이력을 어떻게 기준선으로 보존/도입하는가? 여러 팀이 동시에 migration을 만들 때 어떤 CI 규칙·소유권·파일 명명/순서 정책이 필요한가? 도구가 해결하지 않는 절차적 충돌은 무엇인가? | 공식 import/baseline 문서, release/maturity 정보, branch policy를 적용한 전환 리허설 | 단계적 전환안, 필수 CI gate, ‘도구로 해결’과 ‘팀 규칙으로 해결’을 분리한 운영 규약. |

### 축의 독립성 규칙

- W1은 **이력 병합의 의미**만, W2는 **실행 중 경쟁 제어**만 판정한다. 여러
  deploy가 lock으로 안전해도 branch 이력이 잘 병합된다는 근거는 아니다.
- W3은 개발자 생산성만 다루며, W4의 production-safe 판정을 대체하지 않는다.
- W5는 조직 절차와 전환 비용만 다룬다. 도구의 실제 capability는 W1–W4의
  1차 증거 없이는 주장하지 않는다.
- 모든 워커는 같은 PostgreSQL, forward-only, Kubernetes/ArgoCD 배포,
  pnpm/Node 기반 TypeScript 서비스라는 평가 조건을 사용한다.

## 공통 비교 프로토콜

1. 각 워커는 후보마다 공식 문서 또는 공식 저장소의 URL과 확인 일자를 남긴다.
   블로그·비공식 예제는 발견 단서로만 쓰고 결론 근거로 쓰지 않는다.
2. ‘Git처럼 병합’은 다음 네 검증을 통과할 때만 주장한다: (a) 두 브랜치가
   독립 migration을 만든다, (b) merge commit에서 이력 상태가 결정된다,
   (c) 새 환경과 이미 한 브랜치가 적용된 환경 모두에 적용된다, (d) 서로
   충돌하는 SQL은 사람이 검토하게 막거나 명시적으로 해결하게 한다.
3. W1·W2·W4의 핵심 주장은 문서 확인 뒤 PostgreSQL 최소 DB에서 재현한다.
   재현하지 못한 항목은 ‘문서상 지원’으로만 표기한다.
4. 최종 통합 담당자는 W1–W5의 표를 합치되, 서로 다른 축의 점수를 합산해
   ‘자동 병합 지원’ 같은 단일 주장을 만들지 않는다. 먼저 탈락 조건
   (병렬 배포 안전성, forward-only 운영 가능성)을 적용한 뒤 DX와 전환 비용을
   비교한다.

## 워크 순서와 의존성

W1–W5는 독립적으로 병렬 시작한다. W1과 W2의 결과가 나온 뒤에만 통합
담당자가 최종 후보 shortlist를 만든다. W3–W5는 shortlist를 만들기 위한
근거가 아니라, shortlist 후보의 실제 채택 비용과 운영 guardrail을 결정한다.

```text
W1 (분기·병합) ──┐
W2 (배포 동시성) ├──> 통합: hard gate / shortlist
W3 (TS 통합) ────┤              │
W4 (운영 안전성) ┤              └──> 권고안 + 전환/CI 규약 (W5 반영)
W5 (전환·거버넌스)┘
```

## blocked/auth-gated/JS-rendered 소스 심층 브라우징 워커

**결정: No — 초기에는 투입하지 않는다.**

이번 후보의 핵심 증거는 공개된 공식 문서, npm package metadata, 공식 GitHub
저장소, PostgreSQL 공식 문서에서 얻을 수 있어야 한다. 심층 브라우징은 비용이
높고, 로그인된 SaaS 화면이나 렌더링된 마케팅 페이지는 migration lock·이력
의미론의 1차 근거가 되기 어렵다.

다음 조건 중 하나가 충족될 때만 별도 심층 브라우징 워커를 즉시 추가한다.

- 공개 공식 문서가 특정 lock, checksum, deploy command의 동작을 언급하지만
  구현·참조 문서가 접근 불가라서 W2 또는 W4의 결론이 갈릴 때
- cloud-only 기능이 후보의 핵심 차별점이고, 공개 API/CLI 문서만으로 해당
  기능의 제약·가격·권한 모델을 검증할 수 없을 때
- 공식 GitHub issue 또는 release note가 JavaScript 렌더링/차단되어 W1의
  병합 의미론에 관한 모순되는 1차 증거를 해소할 수 없을 때

그 워커의 범위는 막힌 사실 하나의 원문 확보에 한정한다. 인증 우회, 유료 계정
생성, 비공개 워크스페이스 접근은 하지 않으며, 확보하지 못하면 해당 capability는
‘미검증’으로 남긴다.

# Issue presentation contract

The deliverable is the issue body as rendered in Linear, GitHub, or Jira. Its reader is a PM, designer, or engineer who did not participate in the investigation. From this body alone they can explain who has the problem, what happens now, what must become true, and how completion is checked. Use the destination's native Markdown; this workflow does not create a separate HTML report.

## Choose the body from the evidence available

| Observable input | Body order |
|---|---|
| Requirement or improvement | Problem → relevant confirmed context → acceptance criteria → non-goals → available references |
| Reproducible bug, cause not established | Problem → reproduction (environment, steps, observed raw output next to the expected result, and a reproduction matrix when two or more environments or axis values were attempted, including two configurations of one environment — see reproduce.md §6) → confirmed context and next diagnostic check → acceptance criteria → non-goals → available references |
| Established cause | Same bug body, with a causal explanation beside the reproduction; link or append the detailed investigation when it is needed to assess the conclusion |
| User explicitly requests a full incident/RCA report | Full investigation shape in issue-craft.md §3 |

Localize headings to the working language. Each fact has one home: the problem explains the impact, reproduction contains the steps and observed evidence, context states constraints/unknowns, and acceptance criteria give the measurable target with a verification method. The six RCA investigation fields are working notes; they do not each become another heading in an ordinary bug ticket. An unknown cause is one sentence plus the next check, not six empty fields. References appear when an actual shareable reference exists. Post-release observation follows its existing evidence-based trigger.

The first paragraph names the affected user and the concrete current-to-required behavior. Introduce project terms where they first occur. A reproduction is a short numbered sequence; an AC is one outcome with its verification directly below. Use a table only for repeated comparisons. Include the relevant observation next to the claim it supports so the reader can evaluate it without hunting through an evidence appendix.

## Example: a bug awaiting diagnosis

**Title: 월별 주문 CSV를 연속 내보내면 주문 행이 중복됨**

## 문제
월별 주문 CSV를 내려받는 사용자가 첫 요청 완료 전에 내보내기를 다시 누르면 같은 주문이 두 번씩 포함된다. 반복 클릭해도 주문당 한 행만 내려받을 수 있어야 한다.

## 재현
환경: 로컬 인스턴스(운영과 같은 설정), 주문 12건이 있는 시드 계정.
1. 주문 12건이 조회되는 필터로 내보내기를 누른다.
2. 첫 요청이 끝나기 전에 같은 버튼을 다시 누른다.

관찰: 두 요청 모두 200으로 응답했고, CSV에 주문 12건이 각각 두 번씩 포함됐다(행 24개). 기대 결과는 주문당 한 행이다. 운영 제보의 CSV도 같은 행 24개다.

## 사전 확인
기존 권한 동작은 유지한다. 원인은 아직 확인되지 않았다. 두 요청의 CSV 생성 경로를 추적해 중복이 발생하는 지점을 확인한다.

## 완료 조건
- [ ] **주문당 한 행**: 위 재현에서 각 주문이 CSV에 한 번씩 포함된다.  
  **검증**: 같은 절차를 다시 실행해 주문별 행 수가 1인지 확인한다.
- [ ] **권한 유지**: 기존에 허용·거부되던 계정의 결과가 동일하다.  
  **검증**: 변경 전후 동일 계정·필터의 내보내기 허용 여부를 비교한다.

## 범위 제외
- 권한 정책 변경 — 내보내기 허용 대상이나 거부 조건의 변경이면 별도 요구사항이다.

## Example: a bug whose cause was established by reproduction

**Title: 환불 요청 직후 최대 5분 동안 주문내역이 '일시적 오류가 발생했어요'(500)로 열리지 않음**

## 문제
환불을 요청한 회원은 환불 워커(대기 중인 환불을 5분마다 처리하는 작업)가 돌기 전까지 주문내역 전체를 열 수 없다. 앱 버전과 무관하다. 환불 대기 중에도 주문내역은 열려야 한다.

## 재현
환경: 로컬 인스턴스, `REFUND_ASYNC=on`(운영·stg와 같은 값 — 환불을 바로 처리하지 않고 워커 대기열에 넣는 설정), 시드 계정 `u_alice`.
1. `GET /api/orders` → 200, 주문 2건.
2. `POST /api/orders/o1/refund` `{"amount":5000}` → 200.
3. 워커가 돌기 전에 1번을 다시 호출한다.

관찰: `500 {"error":"일시적 오류가 발생했어요"}`. 서버 로그 `TypeError: null is not an object (evaluating '...get(o.refund_id).amount')`. 기대 결과는 200과 주문 2건이다. 오류 문구가 운영 로그와 글자 단위로 같다.

| 환경 | 조건 (차이 나는 축) | 결과 | 근거 |
|---|---|---|---|
| 로컬 | `REFUND_ASYNC=off`, 환불 1건 | 재현 안 됨 — 200 | 응답 본문 |
| 로컬 | `REFUND_ASYNC=on`, 환불 대기 1건, 앱 5.2.0 | 재현됨 — 500, 운영과 같은 오류 문구 | 서버 로그 한 줄 |
| 로컬 | 위와 같고 앱 버전만 5.1.3 | 재현됨 — 500 | 서버 로그 한 줄 |
| 로컬 | `REFUND_ASYNC=on`, 워커 1회 실행 후 | 재현 안 됨 — 200 | 응답 본문 |

결과를 가르는 조건은 `REFUND_ASYNC=on`과 환불 대기가 **함께** 있는 것이다. 재현된 구성에서 둘 중 하나만 되돌려도 재현되지 않는다(1행: 설정 off, 4행: 워커가 대기를 처리). 앱 버전은 바꿔도 결과가 같다(3행). "로컬에서 재현 안 됨"은 로컬 기본 설정이 `REFUND_ASYNC=off`라서 생겼다.

근본 원인: 비동기 환불 경로의 `requestRefund`(환불 요청 함수)는 주문에 환불 번호를 먼저 기록하고, 환불 행은 워커가 나중에 만든다(`src/refund.ts:5-7`). 그 사이 `listOrders`(주문내역 응답 함수)가 없는 환불 행의 금액을 읽어 예외가 나고 응답 전체가 500이 된다(`src/orders.ts:8-9`). 운영 로그에서도 환불 요청 → 500 → 워커 실행 → 200 순서가 두 회원에게 같다.

확신도: 확인됨 — 운영 로그, 재현과 대조 실행, 코드가 같은 메커니즘을 가리킨다. 재현은 운영과 런타임 버전과 배포 커밋이 다르고 워커를 손으로 돌렸다. 오류 문구가 같으므로 이 차이가 결론을 바꿀 여지는 작다. 앱 5.2.0 원인설은 위 표의 5.1.3 행과 운영 5.1.3 사용자의 같은 오류로 배제했다.

## 사전 확인
- 경로별 상태: 결함은 `REFUND_ASYNC=on` 경로(stg·운영)에만 있다. `off` 경로는 환불 행을 먼저 만든다.

## 완료 조건
- [ ] **환불 대기 중에도 주문내역 열림**: 위 재현 3번이 200과 주문 2건을 반환한다.  
  **검증**: 같은 환경에서 재현 1~3을 다시 실행한다.

## 메모
- 공유 환경에 남긴 상태: 없음. stg는 조회만 했다.

## Reader check before writing

Read the exact outgoing body top to bottom as a colleague who only knows the product. Check that the initial problem, reproduced result, and acceptance criteria describe the same behavior; each claim has one location; unknowns identify a next check; all requirements and scope-decider semantics remain present. Preview the actual native rendering and correct broken lists, wrapped tables, and leaked template instructions before declaring the write complete. The craft rubric still owns factual grounding, scope, and acceptance quality.

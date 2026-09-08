# Issue presentation contract

The deliverable is the issue body as rendered in Linear, GitHub, or Jira. Its reader is a PM, designer, or engineer who did not participate in the investigation. From this body alone they can explain who has the problem, what happens now, what must become true, and how completion is checked. Use the destination's native Markdown; this workflow does not create a separate HTML report.

## Choose the body from the evidence available

| Observable input | Body order |
|---|---|
| Requirement or improvement | Problem → relevant confirmed context → acceptance criteria → non-goals → available references |
| Reproducible bug, cause not established | Problem → reproduction with actual/expected result → confirmed context and next diagnostic check → acceptance criteria → non-goals → available references |
| Established cause | Same bug body, with a causal explanation beside the reproduction; link or append the detailed investigation when it is needed to assess the conclusion |
| User explicitly requests a full incident/RCA report | Full investigation shape in issue-craft.md §3 |

Localize headings to the working language. Each fact has one home: the problem explains the impact, reproduction contains the steps and observed evidence, context states constraints/unknowns, and acceptance criteria give the measurable target with a verification method. The six RCA investigation fields are working notes; they do not each become another heading in an ordinary bug ticket. An unknown cause is one sentence plus the next check, not six empty fields. References appear when an actual shareable reference exists. Post-release observation follows its existing evidence-based trigger.

The first paragraph names the affected user and the concrete current-to-required behavior. Introduce project terms where they first occur. A reproduction is a short numbered sequence; an AC is one outcome with its verification directly below. Use a table only for repeated comparisons. Include the relevant observation next to the claim it supports so the reader can evaluate it without hunting through an evidence appendix.

## Example: a bug awaiting diagnosis

**Title: 월별 주문 CSV를 연속 내보내면 주문 행이 중복됨**

## 문제
월별 주문 CSV를 내려받는 사용자가 첫 요청 완료 전에 내보내기를 다시 누르면 같은 주문이 두 번씩 포함된다. 반복 클릭해도 주문당 한 행만 내려받을 수 있어야 한다.

## 재현
1. 주문 12건이 조회되는 필터로 내보내기를 누른다.
2. 첫 요청이 끝나기 전에 같은 버튼을 다시 누른다.

관찰: 두 요청 모두 200으로 응답했고, CSV에 주문 12건이 각각 두 번씩 포함됐다. 기대 결과는 주문당 한 행이다.

## 사전 확인
기존 권한 동작은 유지한다. 원인은 아직 확인되지 않았다. 두 요청의 CSV 생성 경로를 추적해 중복이 발생하는 지점을 확인한다.

## 완료 조건
- [ ] **주문당 한 행**: 위 재현에서 각 주문이 CSV에 한 번씩 포함된다.  
  **검증**: 같은 절차를 다시 실행해 주문별 행 수가 1인지 확인한다.
- [ ] **권한 유지**: 기존에 허용·거부되던 계정의 결과가 동일하다.  
  **검증**: 변경 전후 동일 계정·필터의 내보내기 허용 여부를 비교한다.

## 범위 제외
- 권한 정책 변경 — 내보내기 허용 대상이나 거부 조건의 변경이면 별도 요구사항이다.

## Reader check before writing

Read the exact outgoing body top to bottom as a colleague who only knows the product. Check that the initial problem, reproduced result, and acceptance criteria describe the same behavior; each claim has one location; unknowns identify a next check; all requirements and scope-decider semantics remain present. Preview the actual native rendering and correct broken lists, wrapped tables, and leaked template instructions before declaring the write complete. The craft rubric still owns factual grounding, scope, and acceptance quality.

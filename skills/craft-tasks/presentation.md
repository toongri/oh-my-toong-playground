# Task-ticket presentation contract

The reader is the engineer who will implement or review this task without the design conversation. They know ordinary engineering terms; they do not know this project's component names. The deliverable is the native Linear/GitHub/Jira ticket body, not a separate HTML document.

## Required template

Use these three work-definition sections, in this order. On existing tasks, preserve contributor notes, progress, and decisions when updating the affected sections:

| Section | Required content |
|---|---|
| 목적 | The concrete behavior this task delivers toward the settled design. One short paragraph. |
| 변경 대상 | Each component's name **and role in this change**, followed by its repository-relative location when known. |
| 완료 조건 (DoD) | One observable result per item, with its verification method directly below. |

Native parent/dependency fields still own relationships. Shared design context is resolved through craft-issue. This contract changes neither task granularity nor scope.

## Example

**Title: 주문 내보내기 버튼의 중복 요청 차단**

## 목적
내보내기 요청이 끝날 때까지 추가 클릭을 무시하고 ‘진행 중’을 표시한다. 성공하거나 실패하면 다시 내보낼 수 있게 한다.

## 변경 대상
주문 내보내기를 시작하고 요청 중 상태를 표시하는 `ExportButton` 컴포넌트(`web/orders/ExportButton.tsx`)와 관련 테스트.

## 완료 조건 (DoD)
- 요청 대기 중 연속 클릭해도 요청은 한 번만 전송되고 ‘진행 중’이 표시된다.  
  검증: 응답을 대기시킨 상태에서 연속 클릭하고 요청 횟수와 버튼 표시를 확인한다.
- 성공 또는 실패 응답 후 버튼을 다시 사용할 수 있다.  
  검증: 두 응답에서 각각 버튼이 복구되고 재시도 요청이 전송되는지 확인한다.

## Reader check

Read the outgoing body without the design conversation: does it explain what the named component does here, what will change, and how the assignee proves completion? Render/preview it in the destination before finishing; preserve nested verification lines and native relations. If a body contains only file paths under 변경 대상, fill the required component-role slot from the settled boundary map. Missing design facts route back to the design gate, not invented prose.

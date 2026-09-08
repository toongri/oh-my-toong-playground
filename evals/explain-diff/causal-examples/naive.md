# Case A — 재시도 제한

## Intuition

실패 직후 다음 행동을 고를 때, 이미 실패한 횟수가 세 번 이상이면 멈춘다. 이전에는 실패 횟수와 관계없이 항상 `retry`였으므로, 세 번 실패한 뒤에도 계속 재시도를 지시했다. 이제 `attempt < 3` 조건이 그 경계를 만든다.

예를 들어 두 번 실패한 상태에서는 `2 < 3`이 참이라 `retry`를 반환한다. 다음 시도까지 실패해 세 번이 되면 `3 < 3`이 거짓이므로 `stop`을 반환한다. 네 번 실패한 상태로 호출해도 `stop`이다. `attempt`는 앞으로 시도할 차례 번호가 아니라 **이미 완료한 실패 횟수**다.

이 함수가 하는 일은 문자열로 다음 행동을 반환하는 것뿐이다. 대기 시간을 예약하거나 실패 횟수를 초기화하는 동작은 없다.

## Code change

`a123456`, `retry.ts:1` — 항상 재시도를 반환하던 곳에 실패 횟수 조건을 추가했다.

```diff
 export function nextAction(attempt: number): string {
-  return "retry";
+  return attempt < 3 ? "retry" : "stop";
 }
```

`2 → retry`, `3 → stop`, `4 → stop` 테스트는 경계 직전과 경계, 경계를 넘긴 입력의 반환값을 확인한다.

## 작성자 전용 질문 은행

1. 두 번 실패한 뒤 호출하고, 재시도도 실패해 다시 호출하면 각 호출에서 무엇을 반환하는가? 이전 코드와 비교해 설명하라.

   기대 답변: 첫 호출의 `attempt`는 2이므로 `retry`, 다음 호출은 3이므로 `stop`이다. 이전에는 두 호출 모두 `retry`였다. 실패 횟수의 의미와 `< 3`의 경계를 연결해야 한다.

2. 유지보수 중 조건을 `attempt <= 3`으로 바꾸면 어떤 입력의 결과가 달라지고, 어느 테스트가 이를 잡는가?

   기대 답변: 3에서 `stop` 대신 `retry`가 반환되어 세 번 실패한 뒤에도 재시도를 지시한다. `3 → stop` 테스트가 실패한다. 2와 4의 결과는 그대로다.

# Case B — 접근 판단 함수 추출

## Intuition

`label` 안에 있던 접근 판단식을 `canRead`라는 함수로 꺼냈다. 판단 기준은 여전히 `owner` 또는 `editor`인지 여부이고, `label`은 그 참·거짓을 받아 기존과 같은 문자열로 바꾼다.

`editor`를 넣으면 이전에는 함수 안의 비교식이 참이 되어 `visible`을 반환했다. 이후에는 `canRead("editor")`가 같은 비교식으로 참을 반환하므로 `label`도 `visible`을 반환한다. `viewer`는 두 역할 모두와 다르므로 두 버전 모두 `hidden`이다. 그 밖의 역할 문자열도 동일하게 `hidden`이다.

달라진 것은 판단 코드의 위치와 외부에서 호출할 수 있는 `canRead`의 추가다. `label`의 인자와 반환값은 유지된다.

## Code change

`b123456`, `access.ts:1` — 비교식을 그대로 옮기고 `label`에서 호출한다.

```diff
+export function canRead(role: string): boolean {
+  return role === "owner" || role === "editor";
+}
 export function label(role: string): string {
-  const allowed = role === "owner" || role === "editor";
-  return allowed ? "visible" : "hidden";
+  return canRead(role) ? "visible" : "hidden";
 }
```

두 버전의 테스트는 `owner → visible`, `editor → visible`, `viewer → hidden`을 확인한다. 다른 문자열에서도 결과가 같다는 근거는 추출 전후의 비교식과 문자열 변환이 동일하다는 점이다.

## 작성자 전용 질문 은행

1. `label("editor")`가 값을 반환하기까지의 과정을 변경 전후로 설명하고, 결과가 같은 이유를 말하라.

   기대 답변: 이전에는 내부 비교식으로 `allowed`가 참이 되었고, 이후에는 같은 비교식을 가진 `canRead`가 참을 반환한다. 두 버전 모두 참을 `visible`로 변환하므로 결과가 같다.

2. 새 역할 문자열 `guest`를 전달하면 `canRead`와 `label`은 각각 무엇을 반환하는가? 이 변경에서 새로 제공된 기능과 유지된 계약을 구분하라.

   기대 답변: `canRead("guest")`는 거짓, `label("guest")`는 `hidden`이다. 공개된 판단 함수가 추가되었지만 허용 역할은 늘지 않았으며 `label`의 시그니처와 반환값은 유지된다.

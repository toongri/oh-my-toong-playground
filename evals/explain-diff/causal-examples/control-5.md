# 사례 A — 재시도 상한

## Intuition

실패가 몇 번 끝났을 때 반환값이 달라지는지 이해하면 상한을 수정할 때 경계를 지킬 수 있다. 나는 이미 완료된 실패 횟수인 `attempt`가 3에 도달하면 `stop`을 반환하도록 바꿨다. 예를 들어 세 번째 실패 직후의 입력은 `attempt = 3`이다.

<div class="compare">
<div class="compare-before"><code>nextAction(3)</code>은 실패 횟수를 확인하지 않고 <code>retry</code>를 반환한다.</div>
<div class="compare-after"><code>nextAction(3)</code>은 <code>3 &lt; 3</code>이 거짓이므로 <code>stop</code>을 반환한다.</div>
</div>

같은 입력 3에서 반환값이 달라지는 이유는 새로 넣은 `attempt < 3` 조건이다. 입력 2에서는 여전히 `retry`이고, 입력 4에서는 `stop`이다. 여기서 확인할 수 있는 결과는 반환 문자열이며, 지연 예약이나 작업 저장·알림·횟수 초기화 동작은 없다.

### `a123456` — Stop retrying after three failed attempts.

#### 변경 1: 완료된 실패가 3회 이상이면 중단 반환

실제 조건과 테스트를 함께 읽어 중단 경계를 확인한다.

<div class="cf" data-change="mod">
<p><strong><code>nextAction()</code></strong> (재시도 판단 함수) — <strong>기존</strong> 입력과 무관하게 <code>retry</code>를 반환했다. <strong>변경</strong> 완료된 실패 횟수가 3 미만이면 <code>retry</code>, 3 이상이면 <code>stop</code>을 반환한다.</p>
<p><strong>왜</strong> — 세 번 실패한 뒤에도 재시도를 반환하던 동작에 상한을 두기 위해 바꿨다. <span class="cf-src">근거</span> "Stop retrying after three failed attempts."</p>
<p><strong>효과·사이드이펙트</strong> — 함수의 입력·반환 타입은 유지하며, 3 이상에서 반환값이 달라진다. 함수 자체는 입력을 증가시키거나 상태를 저장하지 않는다.</p>
<p><strong>검증</strong> — 제공된 테스트는 2 → retry, 3 → stop, 4 → stop을 확인한다.</p>
<p class="cf-loc"><strong>바뀐 위치</strong> — <code>base:retry.ts:2</code> → <code>head:retry.ts:2</code></p>
</div>

```ts
export function nextAction(attempt: number): string {
  return attempt < 3 ? "retry" : "stop";
}
```

### 작성자 전용 질문 은행

1. 이 변경이 필요한 이유와 세 번째 실패 직후의 판단을 설명하라.

   예상 답·채점 항목: 기존에는 계속 `retry`를 반환했으므로 세 번 실패한 뒤 중단하도록 상한이 필요했다. 실패 직후 입력은 3이며, `3 < 3`이 거짓이어서 `stop`을 반환한다.

2. 입력 2와 4에 대한 결과는 무엇이며, 이 함수가 실제 재시도 실행을 보장한다고 말할 수 있는가?

   예상 답·채점 항목: 2는 `retry`, 4는 `stop`이다. 관찰 계약은 반환 문자열뿐이며 예약·실행이나 횟수 변경은 이 함수에 없다.

# 사례 B — 접근 판단 함수 추출

## Intuition

판단을 옮긴 것과 판단 결과를 바꾼 것을 구분하기 위해 같은 역할을 전후에 대입한다. 나는 `label` 안의 허용 조건을 내보낸 함수 `canRead`로 추출했다. `role = "editor"`를 넣으면 조건은 여전히 참이다.

<div class="compare">
<div class="compare-before"><code>label("editor")</code>가 직접 역할을 비교해 <code>allowed = true</code>를 얻고 <code>visible</code>을 반환한다.</div>
<div class="compare-after"><code>label("editor")</code>가 <code>canRead("editor") = true</code>를 받아 <code>visible</code>을 반환한다.</div>
</div>

`editor`의 결과가 같은 이유는 `owner` 또는 `editor`라는 조건과 참일 때 `visible`을 고르는 규칙이 그대로이기 때문이다. `viewer`를 넣으면 전후 모두 `hidden`이다. 달라진 것은 조건의 담당 함수와 새 export이며, 허용 역할은 늘어나지 않는다.

### `b123456` — Extract canRead without changing access decisions.

#### 변경 1: 허용 여부 판단을 canRead로 추출

두 함수의 책임을 나눠 읽으면 반환값을 유지하면서 무엇을 추출했는지 확인할 수 있다.

<div class="cf" data-change="mod">
<p><strong><code>label()</code></strong> (접근 표시 문자열을 결정하는 함수) — <strong>기존</strong> 역할 비교와 문자열 선택을 함께 했다. <strong>변경</strong> 역할 판단을 <code>canRead</code>에 맡기고 그 결과로 같은 문자열을 선택한다.</p>
<p><strong><code>canRead()</code></strong> (접근 허용 여부 판단 함수) — <strong>신설</strong> 기존 역할 비교를 맡아 <code>owner</code> 또는 <code>editor</code>이면 참을 반환하는 함수를 내보낸다.</p>
<p><strong>왜</strong> — 접근 결정을 유지하면서 판단 함수를 분리하기 위한 변경이다. <span class="cf-src">근거</span> "Extract canRead without changing access decisions."</p>
<p><strong>효과·사이드이펙트</strong> — 새로운 export가 생긴다. <code>label(role: string): string</code>의 선언과 반환 규칙은 유지하며, 그 밖의 역할 문자열도 계속 <code>hidden</code>이다.</p>
<p><strong>검증</strong> — 제공된 전후 테스트는 owner → visible, editor → visible, viewer → hidden을 확인한다. 다른 문자열의 hidden 반환은 코드의 조건으로 확인한다.</p>
<p class="cf-loc"><strong>바뀐 위치</strong> — <code>base:access.ts:2</code> → <code>head:access.ts:2</code>, <code>base:access.ts:3</code> → <code>head:access.ts:5</code></p>
</div>

```ts
export function canRead(role: string): boolean {
  return role === "owner" || role === "editor";
}
export function label(role: string): string {
  return canRead(role) ? "visible" : "hidden";
}
```

### 작성자 전용 질문 은행

1. 왜 이 변경을 했으며, `editor`의 결과를 유지하는 근거는 무엇인가?

   예상 답·채점 항목: 접근 결정을 바꾸지 않고 `canRead`를 추출하려는 변경이다. 동일한 역할 비교가 참을 반환하고 `label`도 참을 `visible`로 바꾸는 규칙을 유지한다.

2. `viewer`와 임의의 다른 역할 문자열은 어떻게 처리되며, 외부에서 사용할 수 있는 함수에는 무엇이 추가되는가?

   예상 답·채점 항목: 두 허용 역할에 해당하지 않아 전후 모두 `hidden`이다. `canRead(role: string): boolean` export가 추가되지만 `label`의 선언은 바뀌지 않는다.

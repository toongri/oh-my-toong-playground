# Case A — 재시도 제한

## Intuition

실패 횟수가 언제 반환 동작을 바꾸는지 이해하면 제한을 수정할 때 경계를 유지할 수 있다. 나는 이미 완료한 실패가 3회에 도달하면 `stop`을 반환하도록 바꿨다. `attempt = 3`은 세 번째 시도 직전이 아니라 세 번째 실패가 끝난 뒤다.

<div class="compare">
<div class="compare-before"><code>nextAction(3)</code>은 <code>retry</code>를 반환한다.</div>
<div class="compare-after"><code>nextAction(3)</code>은 <code>stop</code>을 반환한다.</div>
</div>

같은 `attempt = 3`에서 결과가 달라지는 이유는 새 조건 `attempt < 3`이 거짓이기 때문이다. `attempt = 2`에서는 여전히 `retry`이고, 4에서도 `stop`이다.

## Code

제한을 결정하는 조건과 이 함수가 책임지는 범위를 확인한다.

### `a123456` — 세 번 실패하면 재시도 중단 판정

#### 변경 1: 완료한 실패 횟수로 다음 동작 결정

<div class="cf" data-change="mod">
<p><strong><code>nextAction()</code></strong> (재시도 동작 판단 함수) — <strong>기존</strong> 실패 횟수와 관계없이 <code>retry</code>를 반환했다. <strong>변경</strong> 0 이상의 정수인 <code>attempt</code>가 3 미만이면 <code>retry</code>, 그 외에는 <code>stop</code>을 반환한다.</p>
<p><strong>왜</strong> — 세 번 실패한 뒤에도 재시도를 지시하던 동작을 끝내기 위해 바꿨다. <span class="cf-src">근거</span> "Stop retrying after three failed attempts."</p>
<p><strong>효과·사이드이펙트</strong> — 실패 뒤 호출하는 쪽이 3 이상에서 받는 문자열이 달라진다. 함수는 문자열만 반환하며, 지연 예약이나 실패 횟수 초기화를 수행하지 않는다.</p>
<p><strong>검증</strong> — 제공된 테스트는 2에서 <code>retry</code>, 3과 4에서 <code>stop</code>을 확인한다.</p>
<p class="cf-loc"><strong>바뀐 위치</strong> — <code>base:retry.ts:2</code> → <code>head:retry.ts:2</code></p>
</div>

```ts
export function nextAction(attempt: number): string {
  return attempt < 3 ? "retry" : "stop";
}
```

### 작성자 전용 질문 은행

1. 이 변경은 어떤 문제를 해결하며, 세 번째 실패 직후 반환값이 왜 달라지는가?
   - 기대 답변·채점: 기존에는 실패 횟수와 무관하게 재시도를 지시했다. 완료한 실패가 3회이면 `3 < 3`이 거짓이므로 이제 `stop`을 반환한다.
2. 완료한 실패가 2회일 때 호출자는 무엇을 받고, 그 결과로 함수가 예약하거나 초기화하는 것은 무엇인가?
   - 기대 답변·채점: `retry` 문자열을 받는다. 반환 이외의 동작이 없으므로 함수 자체는 지연 예약이나 실패 횟수 초기화를 하지 않는다.

# Case B — 접근 판정 추출

## Intuition

판정 결과와 코드 배치 중 무엇이 달라졌는지 구분하면 기존 접근 규칙을 유지하며 수정할 수 있다. 나는 `label` 내부의 역할 검사를 `canRead`로 옮겼다. 예를 들어 `editor`의 결과는 계속 `visible`이다.

<div class="compare">
<div class="compare-before"><code>label("editor")</code>가 직접 역할을 검사하여 <code>visible</code>을 반환한다.</div>
<div class="compare-after"><code>canRead("editor")</code>가 <code>true</code>를 반환하므로 <code>label("editor")</code>는 <code>visible</code>을 반환한다.</div>
</div>

`editor`가 통과하는 조건을 그대로 옮겼기 때문에 결과가 유지된다. `owner`도 `visible`이고, `viewer`를 비롯한 다른 문자열은 모두 `hidden`이다.

## Code

새 함수가 맡은 책임과 유지해야 할 반환 계약을 확인한다.

### `b123456` — 접근 결정 유지하며 canRead 추출

#### 변경 1: 역할 판정과 표시 문자열 선택 분리

<div class="cf" data-change="mod">
<p><strong><code>canRead()</code></strong> (접근 판정 함수) — <strong>신설</strong> 역할이 <code>owner</code> 또는 <code>editor</code>인지 검사하여 불리언을 반환하는 함수를 export한다.</p>
<p><strong><code>label()</code></strong> (표시 문자열 선택 함수) — <strong>기존</strong> 역할을 직접 검사하고 결과를 표시 문자열로 변환했다. <strong>변경</strong> 역할 검사를 <code>canRead(role)</code>에 위임하고 참이면 <code>visible</code>, 거짓이면 <code>hidden</code>을 반환한다.</p>
<p><strong>왜</strong> — 기존 접근 결정을 유지하면서 판정 함수를 추출하기 위해 바꿨다. <span class="cf-src">근거</span> "Extract canRead without changing access decisions."</p>
<p><strong>효과·사이드이펙트</strong> — 외부에서 불리언 판정 함수를 가져올 수 있게 된다. <code>label(role: string): string</code>의 시그니처와 모든 역할 문자열에 대한 반환값은 유지된다.</p>
<p><strong>검증</strong> — 제공된 테스트는 두 버전 모두 <code>owner</code>·<code>editor</code>에서 <code>visible</code>, <code>viewer</code>에서 <code>hidden</code>을 확인한다. 다른 문자열도 거짓이 되는 것은 동일한 비교식에서 확인할 수 있다.</p>
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

1. 이 추출의 목적은 무엇이며, `label("editor")`의 결과를 유지하는 이유는 무엇인가?
   - 기대 답변·채점: 접근 결정을 바꾸지 않고 판정 책임을 `canRead`로 분리하는 목적이다. 동일한 비교식이 `editor`에 대해 참을 반환하므로 `label`은 계속 `visible`을 반환한다.
2. `canRead("guest")`와 `label("guest")`의 반환값은 각각 무엇이며, 새로 export한 함수는 어떤 값을 제공하는가?
   - 기대 답변·채점: `guest`는 허용된 두 역할에 해당하지 않아 각각 `false`, `hidden`이다. 새 공개 함수 `canRead(role: string): boolean`은 표시 문자열로 변환하기 전의 접근 판정을 제공한다.

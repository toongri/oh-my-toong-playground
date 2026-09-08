# Case A — 실패 횟수에 따른 재시도 종료

## Intuition

실패가 쌓여도 재시도가 끝나지 않던 이유와 새 종료 기준을 이해한다. 나는 이미 완료한 실패 횟수가 3 이상이면 `stop`을 반환하도록 바꿨다. `attempt = 3`은 세 번째 시도 직전이 아니라 세 번 실패한 뒤다. 이때 `3 < 3`은 거짓이므로 다음 행동은 `stop`이다.

<div class="compare">
<div class="compare-before"><code>attempt = 3</code>이어도 조건 없이 <code>retry</code>를 반환한다.</div>
<div class="compare-after"><code>attempt = 3</code>이면 <code>3 &lt; 3</code>이 거짓이므로 <code>stop</code>을 반환한다.</div>
</div>

### `a123456` — Stop retrying after three failed attempts.

#### 변경 1: 세 번 이상 실패하면 종료 행동 반환

<div class="cf" data-change="mod">
<p><strong><code>nextAction()</code></strong> (재시도 행동을 결정하는 함수) — <strong>기존</strong> 실패 횟수와 무관하게 <code>retry</code>를 반환했다. <strong>변경</strong> 완료한 실패 횟수가 3 미만일 때만 <code>retry</code>를 반환하고 나머지는 <code>stop</code>을 반환한다.</p>
<p><strong>왜</strong> — 세 번 실패한 뒤에도 계속 재시도하던 동작을 끝내기 위해 바꿨다. <span class="cf-src">근거</span> "Stop retrying after three failed attempts."</p>
<p><strong>효과·사이드이펙트</strong> — 호출자가 실패 후 받는 행동 문자열이 달라진다. 이 함수에 지연 예약이나 실패 횟수 초기화 기능이 생기지는 않는다.</p>
<p><strong>검증</strong> — 제공된 테스트는 실패 횟수 2, 3, 4에서 경계 직전·경계·경계 이후의 반환값을 확인한다.</p>
<p class="cf-loc"><strong>바뀐 위치</strong> — <code>base:retry.ts:2</code>→<code>head:retry.ts:2</code></p>
</div>

```ts
export function nextAction(attempt: number): string {
  return attempt < 3 ? "retry" : "stop";
}
```

<p><strong>예시 연결</strong> 앞의 <code>attempt = 3</code>으로 <code>nextAction(3)</code>을 호출하면 <code>attempt &lt; 3</code>이 <code>false</code>다. 따라서 삼항식의 뒤쪽 값 <code>stop</code>을 반환한다.</p>

### 작성자 전용 질문 은행 — 독자 문서와 분리

1. 질문: 이 변경이 해결하려는 문제는 무엇이며, 종료 기준에서 실패 횟수는 어느 시점의 횟수인가?

   기대 답변·채점 항목: ① 기존에는 횟수와 관계없이 `retry`여서 계속 재시도했다. ② 이미 완료한 실패가 3회 이상이면 `stop`을 반환한다. 두 항목을 모두 설명해야 한다.

2. 변경 입력/조건: 예시의 `attempt = 3`을 `attempt = 2`로 바꾼다.

   질문: 실패를 두 번 완료한 뒤 `nextAction(2)`를 호출하면 무엇을 반환하며, 왜 그런가?

   기대 결과: `retry`다.

   인과 이유: `2 < 3`이 참이어서 삼항식의 앞쪽 값을 선택한다. 결과와 이유를 각각 채점한다.

# Case B — 접근 판단을 추출하고 표시 결과 유지

## Intuition

함수를 나눈 뒤에도 같은 역할이 같은 표시 결과를 받는 이유를 이해한다. 나는 `label` 안의 역할 판정을 `canRead`로 옮겼다. `role = "owner"`를 넣으면 새 함수에서 첫 비교가 참이 되어 `true`가 나오고, `label`은 이를 받아 기존과 같은 `visible`을 반환한다. 바뀐 것은 판정의 담당 함수다.

<div class="flow">
<div class="flow-step"><code>label("owner")</code></div><span class="flow-arrow">→</span>
<div class="flow-step"><code>canRead("owner")</code><br><code>true</code></div><span class="flow-arrow">→</span>
<div class="flow-step"><code>visible</code></div>
</div>

### `b123456` — Extract canRead without changing access decisions.

#### 변경 1: 역할 판정을 공개 함수로 추출

<div class="cf" data-change="mod">
<p><strong><code>label()</code></strong> (역할에 따른 표시 문자열을 반환하는 함수) — <strong>기존</strong> 역할을 직접 비교해 <code>allowed</code>에 담고 문자열로 변환했다. <strong>변경</strong> 역할 판정은 <code>canRead(role)</code>에 맡기고 참·거짓을 표시 문자열로 변환한다.</p>
<p><strong><code>canRead()</code></strong> (접근 판단 함수) — <strong>신설</strong> <code>owner</code> 또는 <code>editor</code>인지 판단해 불리언을 반환하는 공개 함수다.</p>
<p><strong>왜</strong> — 접근 결정을 유지하면서 역할 판정을 별도 함수로 분리했다. <span class="cf-src">근거</span> "Extract canRead without changing access decisions."</p>
<p><strong>효과·사이드이펙트</strong> — 공개 함수가 하나 추가된다. <code>label</code>의 인자와 반환값 규칙은 유지되고, 허용 역할 외의 문자열은 계속 <code>hidden</code>이 된다.</p>
<p><strong>검증</strong> — 제공된 테스트는 두 버전에서 <code>owner</code>, <code>editor</code>, <code>viewer</code>의 표시 결과가 같음을 확인한다.</p>
<p class="cf-loc"><strong>바뀐 위치</strong> — <code>base:access.ts:2</code>→<code>head:access.ts:2</code>, <code>base:access.ts:3</code>→<code>head:access.ts:5</code></p>
</div>

```ts
export function canRead(role: string): boolean {
  return role === "owner" || role === "editor";
}
export function label(role: string): string {
  return canRead(role) ? "visible" : "hidden";
}
```

<p><strong>예시 연결</strong> 앞의 <code>label("owner")</code>는 이제 <code>canRead("owner")</code>를 호출한다. <code>role === "owner"</code>가 참이므로 <code>canRead</code>가 <code>true</code>를 반환하고 <code>label</code>은 <code>visible</code>을 선택한다. 기존에는 같은 참 값을 <code>allowed</code>에 담았으므로 결과는 같고, 비교 책임만 <code>canRead</code>로 옮겨졌다.</p>

### 작성자 전용 질문 은행 — 독자 문서와 분리

1. 질문: 이 변경의 목적은 무엇이며, 두 함수는 각각 어떤 책임을 갖게 되었는가?

   기대 답변·채점 항목: ① 접근 결정은 유지하면서 판정을 추출하는 것이 목적이다. ② `canRead`는 역할을 판정해 불리언을 반환하고 `label`은 이를 표시 문자열로 변환한다.

2. 변경 입력/조건: 예시의 `role = "owner"`를 `role = "editor"`로 바꾼다.

   질문: `label("editor")`의 변경 전후 반환값은 같은가? 결과와 그 결과를 유지하는 조건을 설명하라.

   기대 결과: 두 버전 모두 `visible`이다.

   인과 이유: 첫 비교는 거짓이어도 `role === "editor"`가 참이므로 OR 결과가 참이다. 이 동일한 판정을 추출 뒤에는 `canRead`가 반환하고 `label`이 `visible`로 변환한다. 결과와 이유를 각각 채점한다.

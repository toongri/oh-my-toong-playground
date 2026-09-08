# Case A — 재시도 제한

## Intuition

재시도를 멈추는 경계를 이해하려면 이미 끝난 실패 횟수를 기준으로 읽어야 한다. 나는 `nextAction`이 실패 세 번부터 `stop`을 반환하도록 바꿨다. `attempt = 3`은 세 번째 시도를 앞둔 상태가 아니라 세 번 실패한 상태다.

<div class="compare">
<div class="compare-before"><code>nextAction(3)</code>은 실패 횟수를 보지 않고 <code>retry</code>를 반환했다.</div>
<div class="compare-after"><code>nextAction(3)</code>은 <code>3 &lt; 3</code>이 거짓이므로 <code>stop</code>을 반환한다.</div>
</div>

`attempt = 2`에서는 아직 `retry`지만, `attempt = 3`과 `4`에서는 `stop`이다. 이 함수가 바꾸는 것은 반환하는 행동 문자열이며, 지연 예약이나 실패 횟수 초기화는 수행하지 않는다.

## Code

반환값을 바꾸는 조건과 경계 테스트를 함께 확인한다.

### `a123456` — Stop retrying after three failed attempts.

#### 변경 1: 실패 세 번부터 중단 행동 반환

<div class="cf" data-change="mod">
<p><strong><code>nextAction</code></strong> (재시도 판단 함수) — <strong>기존</strong> 모든 입력에 <code>retry</code>를 반환했다. <strong>변경</strong> 이미 완료한 실패 횟수인 <code>attempt</code>가 3 미만이면 <code>retry</code>, 그 외에는 <code>stop</code>을 반환한다.</p>
<p><strong>왜</strong> — 실패 세 번 이후에도 재시도를 반환하던 동작을 끝내기 위해 변경했다. <span class="cf-src">근거</span> "Stop retrying after three failed attempts."</p>
<p><strong>효과·사이드이펙트</strong> — 호출자는 실패 세 번부터 다른 행동 문자열을 받는다. 함수는 작업 저장이나 알림 발송을 하지 않는다.</p>
<p><strong>검증</strong> — 제공된 테스트는 2에서 <code>retry</code>, 3과 4에서 <code>stop</code>을 단언한다.</p>
<p class="cf-loc"><strong>바뀐 위치</strong> — <code>base:retry.ts:2</code> → <code>head:retry.ts:2</code></p>
</div>

```ts
export function nextAction(attempt: number): string {
  return attempt < 3 ? "retry" : "stop";
}
```

### 작성자 전용 질문 은행

1. 왜 이 변경이 필요했고, 실패 세 번 직후 호출 결과가 어떻게 달라지는가?
   - 기대 답변·채점: 기존에는 실패 횟수와 무관하게 재시도를 반환했음을 설명한다. 세 번 이후 중단이라는 목적과 `nextAction(3)`의 `retry` → `stop` 변화를 말한다.
2. 실패 두 번 직후와 네 번 직후의 반환값을 설명하고, 이 함수가 실패 횟수를 초기화하는지도 설명하라.
   - 기대 답변·채점: `2 < 3`이므로 `retry`, `4 < 3`이 거짓이므로 `stop`이라고 설명한다. 입력은 완료된 실패 횟수이고 함수는 문자열만 반환하므로 초기화하지 않는다고 답한다.

# Case B — 접근 판정 함수 추출

## Intuition

이 변경에서는 판정 위치가 바뀌어도 반환값이 유지되는지 이해해야 한다. 나는 `label` 안의 역할 판정을 `canRead`로 추출했다. `role = "editor"`를 넣으면 이전과 이후 모두 `visible`이다.

<div class="compare">
<div class="compare-before"><code>label("editor")</code> 안에서 역할 조건을 직접 계산해 <code>visible</code>을 반환했다.</div>
<div class="compare-after"><code>canRead("editor")</code>가 <code>true</code>를 반환하고, <code>label("editor")</code>이 이를 <code>visible</code>로 변환한다.</div>
</div>

`editor`가 허용되는 이유는 여전히 `owner` 또는 `editor`라는 동일한 조건이다. `viewer`와 다른 모든 역할 문자열은 계속 `hidden`이다. 새로 외부에서 호출할 수 있는 것은 불리언을 반환하는 `canRead`다.

## Code

두 함수로 책임을 나눈 뒤에도 기존 문자열 계약을 지키는 지점을 확인한다.

### `b123456` — Extract canRead without changing access decisions.

#### 변경 1: 역할 판정을 내보내는 함수로 추출

<div class="cf" data-change="mod">
<p><strong><code>label</code></strong> (접근 결과 문자열 함수) — <strong>기존</strong> 역할을 직접 판정한 뒤 <code>visible</code> 또는 <code>hidden</code>을 반환했다. <strong>변경</strong> <code>canRead(role)</code>의 결과를 같은 두 문자열로 변환한다.</p>
<p><strong><code>canRead</code></strong> (접근 허용 판정 함수) — <strong>신설</strong> 역할이 <code>owner</code> 또는 <code>editor</code>인지 불리언으로 반환하며 외부에 내보낸다.</p>
<p><strong>왜</strong> — 접근 결정을 유지하면서 판정 로직을 별도 함수로 추출하기 위해 변경했다. <span class="cf-src">근거</span> "Extract canRead without changing access decisions."</p>
<p><strong>효과·사이드이펙트</strong> — 외부에서 호출 가능한 함수가 추가된다. <code>label(role: string): string</code>의 시그니처와 모든 역할 문자열에 대한 반환값은 유지된다.</p>
<p><strong>검증</strong> — 제공된 테스트는 양쪽 버전에서 <code>owner</code>와 <code>editor</code>의 <code>visible</code>, <code>viewer</code>의 <code>hidden</code>을 단언한다. 나머지 역할도 거부되는 것은 동일한 비교식에서 확인한다.</p>
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

1. 이 추출의 목적은 무엇이며, `editor`의 접근 결과가 유지되는 이유는 무엇인가?
   - 기대 답변·채점: 접근 결정을 유지하며 판정을 `canRead`로 분리하는 목적을 설명한다. 같은 역할 조건이 `true`를 만들고 `label`이 이를 `visible`로 변환함을 설명한다.
2. 새로 내보내는 함수의 계약은 무엇이고, 허용 목록에 없는 역할 문자열에는 두 함수가 각각 무엇을 반환하는가?
   - 기대 답변·채점: `canRead(role: string): boolean`이 새 공개 함수라고 답한다. 목록 밖 문자열에는 `canRead`가 `false`, `label`이 `hidden`을 반환한다고 답한다.

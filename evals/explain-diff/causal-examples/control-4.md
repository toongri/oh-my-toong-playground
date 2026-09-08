## Intuition — A: 세 번 실패하면 재시도를 멈춘다

실패 횟수에 따라 반환값이 달라지는 지점을 이해하면 재시도 한계를 유지할 수 있다. 나는 실패 후 호출되는 `nextAction`이 세 번째 실패부터 `stop`을 반환하도록 바꿨다. `attempt`는 이미 완료된 실패 횟수이므로 `attempt = 2`에서는 `retry`, `attempt = 3`에서는 `stop`이다.

<div class="compare">
<div class="compare-before"><code>attempt = 3</code>이어도 <code>retry</code>를 반환한다.</div>
<div class="compare-after"><code>attempt = 3</code>이면 <code>3 &lt; 3</code>이 거짓이므로 <code>stop</code>을 반환한다.</div>
</div>

세 번을 넘긴 `attempt = 4`도 `stop`이다. 이 함수가 바꾸는 계약은 반환하는 행동 문자열이며, 지연 예약이나 실패 횟수 초기화는 포함하지 않는다.

### `a123456` — Stop retrying after three failed attempts.

#### 변경 1: 완료된 실패 횟수로 다음 행동을 결정한다

<div class="cf" data-change="mod">
<p><strong><code>nextAction()</code></strong> (실패 후 다음 행동을 결정하는 함수) — <strong>기존</strong> <code>attempt</code>와 무관하게 항상 <code>retry</code>를 반환했다. <strong>변경</strong> 완료된 실패가 3회 미만일 때만 <code>retry</code>를 반환하고, 3회 이상이면 <code>stop</code>을 반환한다.</p>
<p><strong>왜</strong> — 세 번 실패한 뒤에는 재시도를 중단하기 위해 바꿨다. <span class="cf-src">근거</span> "Stop retrying after three failed attempts."</p>
<p><strong>효과·사이드이펙트</strong> — 호출자는 세 번째 실패부터 다른 행동 문자열을 받는다. 함수 자체가 작업을 취소하거나 외부 상태를 저장하는 것은 아니다.</p>
<p><strong>검증</strong> — 제공된 테스트는 <code>2 → retry</code>, <code>3 → stop</code>, <code>4 → stop</code>을 확인하여 경계 직전·경계·경계 이후를 고정한다.</p>
<p class="cf-loc"><strong>바뀐 위치</strong> — <code>base:retry.ts:2</code>→<code>head:retry.ts:2</code></p>
</div>

```ts
return attempt < 3 ? "retry" : "stop";
```

### 작성자 전용 문항 은행 — A

1. 이 변경은 어떤 문제를 해결하며, 세 번째 실패 직후 호출자가 받는 값은 이전과 어떻게 다른가?
   - 기대 답변·루브릭: 기존에는 실패가 누적돼도 항상 재시도를 지시했다. 세 번 실패하면 중단하려는 변경이며, `attempt = 3`에서 기존 `retry`가 `stop`으로 바뀐다.
2. `attempt`가 2와 4일 때 각각 무엇을 반환하는가? 이 함수가 실패 횟수를 초기화하는지도 설명하라.
   - 기대 답변·루브릭: `2 < 3`은 참이므로 `retry`, `4 < 3`은 거짓이므로 `stop`이다. 함수는 문자열만 반환하며 횟수 초기화를 수행하지 않는다.

## Intuition — B: 접근 판정을 분리하고 표시 결과는 유지한다

호출 구조가 달라져도 접근 결과가 유지된다는 점을 이해하는 것이 이 변경의 핵심이다. 나는 `label` 안의 역할 판정을 내보내는 함수 `canRead`로 분리했다. `role = "viewer"`는 이전에도 허용 역할이 아니었고, 분리 후에도 `canRead("viewer")`가 `false`이므로 `label("viewer")`는 `hidden`을 반환한다.

<div class="compare">
<div class="compare-before"><code>role = "viewer"</code> → <code>label</code> 내부의 역할 비교 → <code>allowed = false</code> → <code>hidden</code></div>
<div class="compare-after"><code>role = "viewer"</code> → <code>canRead</code>의 역할 비교 → <code>false</code> → <code>label</code>이 <code>hidden</code> 반환</div>
</div>

`owner`와 `editor`는 계속 `visible`이다. 새로 생긴 것은 외부에서 호출할 수 있는 불리언 판정 함수이며, 허용 역할이나 표시 문자열은 그대로다.

### `b123456` — Extract canRead without changing access decisions.

#### 변경 1: 역할 판정과 표시 문자열 선택의 책임을 나눈다

<div class="cf" data-change="mod">
<p><strong><code>label()</code></strong> (역할별 표시 문자열을 반환하는 함수) — <strong>기존</strong> 역할을 직접 비교해 <code>allowed</code>에 저장하고 표시 문자열을 선택했다. <strong>변경</strong> 역할 판정은 <code>canRead</code>에 맡기고 그 결과로 기존과 같은 문자열을 선택한다.</p>
<p><strong><code>canRead()</code></strong> (접근 허용 여부를 판정하는 함수) — <strong>신설</strong> <code>owner</code> 또는 <code>editor</code>이면 <code>true</code>, 다른 문자열이면 <code>false</code>를 반환하는 내보낸 함수다.</p>
<p><strong>왜</strong> — 접근 결정을 유지하면서 판정 함수를 추출하기 위해 바꿨다. <span class="cf-src">근거</span> "Extract canRead without changing access decisions."</p>
<p><strong>효과·사이드이펙트</strong> — 외부에서 불리언 판정을 호출할 수 있게 된다. <code>label(role: string): string</code>의 서명과 반환값은 유지된다.</p>
<p><strong>검증</strong> — 제공된 테스트는 두 버전 모두 <code>owner → visible</code>, <code>editor → visible</code>, <code>viewer → hidden</code>임을 확인한다. 그 밖의 문자열도 <code>hidden</code>이라는 사실은 두 역할만 허용하는 비교식에서 확인할 수 있다.</p>
<p class="cf-loc"><strong>바뀐 위치</strong> — <code>base:access.ts:2</code>→<code>head:access.ts:1</code>, <code>base:access.ts:3</code>→<code>head:access.ts:5</code></p>
</div>

```ts
export function canRead(role: string): boolean {
  return role === "owner" || role === "editor";
}
export function label(role: string): string {
  return canRead(role) ? "visible" : "hidden";
}
```

### 작성자 전용 문항 은행 — B

1. 이 추출의 목적은 무엇이며, `viewer`의 표시 결과를 변경했다는 설명은 왜 틀린가?
   - 기대 답변·루브릭: 접근 결정을 유지하면서 판정을 `canRead`로 분리하는 것이 목적이다. `viewer`는 두 버전 모두 허용 비교를 통과하지 못해 `hidden`을 받는다.
2. `owner`를 전달했을 때 `canRead`와 `label`의 반환값은 각각 무엇인가? 두 함수가 나눠 맡은 책임을 설명하라.
   - 기대 답변·루브릭: `canRead("owner")`는 `true`, `label("owner")`는 `visible`이다. 전자는 역할의 허용 여부를 판정하고 후자는 그 불리언으로 표시 문자열을 선택한다.

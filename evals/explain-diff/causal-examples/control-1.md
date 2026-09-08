# 사례 A — 실패 세 번에서 재시도 중단

## Intuition

실패 횟수를 어디서 끊는지 이해하면 재시도 한도를 유지보수할 수 있다. 나는 실패가 세 번 끝난 시점부터 중단을 반환하도록 바꿨다. `attempt = 3`은 앞으로 할 시도가 아니라 이미 끝난 실패 세 번이다.

<div class="compare">
<div class="compare-before"><code>nextAction(3)</code>은 <code>"retry"</code>를 반환한다.</div>
<div class="compare-after"><code>nextAction(3)</code>은 <code>"stop"</code>을 반환한다.</div>
</div>

`attempt = 3`에서 `attempt < 3`이 거짓이므로 결과가 바뀐다. 실패 두 번이면 아직 `"retry"`, 네 번이면 계속 `"stop"`이다. 이 함수의 계약은 행동 문자열 반환까지다.

## Code

실제 비교식과 검증 범위를 확인해 중단 경계를 보존한다.

### `a123456` — Stop retrying after three failed attempts.

#### 변경 1: 완료된 실패 횟수에 따라 다음 행동 반환

<div class="cf" data-change="mod">
<p><strong><code>nextAction()</code></strong> (재시도 판단 함수) — <strong>기존</strong> 입력과 관계없이 <code>"retry"</code>를 반환했다. <strong>변경</strong> 완료된 실패 횟수가 3 미만일 때만 <code>"retry"</code>를 반환하고, 나머지는 <code>"stop"</code>을 반환한다.</p>
<p><strong>왜</strong> — 세 번 실패한 뒤에도 재시도를 반환하던 동작을 끝내기 위해 바꿨다. <span class="cf-src">근거</span> "Stop retrying after three failed attempts."</p>
<p><strong>효과·사이드이펙트</strong> — 3 이상에서 반환값이 달라진다. 지연 예약, 작업 저장, 알림 전송, 횟수 초기화는 이 함수가 수행하지 않는다.</p>
<p><strong>검증</strong> — 제공된 테스트는 2에서 retry, 3과 4에서 stop을 검증한다.</p>
<p class="cf-loc"><strong>바뀐 위치</strong> — <code>base:retry.ts:2</code>→<code>head:retry.ts:2</code></p>
</div>

```ts
export function nextAction(attempt: number): string {
  return attempt < 3 ? "retry" : "stop";
}
```

### 작성자 전용 질문 은행

1. 이 변경이 해결하려는 문제는 무엇이며, 실패가 세 번 끝난 직후 호출 결과는 왜 그렇게 되는가?
   - 기대 답변·채점: 기존에는 실패 횟수와 무관하게 재시도를 반환했다는 문제를 설명한다. `attempt = 3`에서 `< 3`이 거짓이므로 `"stop"`을 반환해 세 번 이후 재시도를 중단하려는 목적을 설명한다.
2. 실패 두 번과 네 번 직후의 결과를 각각 설명하고, 이 함수 호출로 확인할 수 있는 효과의 범위를 말하라.
   - 기대 답변·채점: 2는 `"retry"`, 4는 `"stop"`이라고 답한다. 관찰 계약은 반환 문자열이며 지연이나 알림, 횟수 초기화를 수행한다고 해석하지 않는다.

# 사례 B — 접근 판단을 함수로 추출

## Intuition

결과 보존과 책임 이동을 함께 이해하면 추출을 권한 정책 변경으로 오해하지 않는다. 나는 접근 판단을 `canRead()`로 옮기고 `label()`은 그 판단을 표시 문자열로 바꾸게 했다.

<div class="compare">
<div class="compare-before"><code>label("editor")</code>가 직접 역할을 비교해 <code>"visible"</code>을 반환한다.</div>
<div class="compare-after"><code>canRead("editor")</code>가 <code>true</code>를 반환하고, <code>label("editor")</code>가 <code>"visible"</code>을 반환한다.</div>
</div>

`"editor"`는 추출 전후 모두 허용 대상이므로 `label("editor")`의 결과는 같다. 달라진 것은 판단을 호출할 수 있는 exported 함수가 생겼다는 점이다.

## Code

두 함수의 책임을 확인하고 표시 결과를 유지하는 조건을 짚는다.

### `b123456` — Extract canRead without changing access decisions.

#### 변경 1: 역할 판정을 공개 함수로 분리

<div class="cf" data-change="mod">
<p><strong><code>canRead()</code></strong> (접근 판정 함수) — <strong>신설</strong> owner 또는 editor인지 비교해 boolean을 반환하는 exported 함수로 역할 판정을 맡는다.</p>
<p><strong><code>label()</code></strong> (접근 결과의 표시 문자열 변환 함수) — <strong>기존</strong> 역할 비교와 문자열 선택을 함께 수행했다. <strong>변경</strong> 역할 비교를 <code>canRead(role)</code>에 위임하고 문자열 선택을 유지한다.</p>
<p><strong>왜</strong> — 접근 결정은 유지하면서 판단을 별도 함수로 추출하기 위해 바꿨다. <span class="cf-src">근거</span> "Extract canRead without changing access decisions."</p>
<p><strong>효과·사이드이펙트</strong> — 공개 helper가 추가되지만 <code>label(role: string): string</code>의 서명과 반환값은 같다. owner와 editor만 visible이고 그 외 문자열은 hidden이다.</p>
<p><strong>검증</strong> — 제공된 테스트는 양쪽 버전에서 owner와 editor의 visible, viewer의 hidden을 확인한다. 그 외 문자열도 hidden이라는 사실은 동일한 비교식에서 확인한다.</p>
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

### 작성자 전용 질문 은행

1. 접근 결과가 같은데 이 변경은 무엇을 달성하려는가? 두 함수의 책임으로 설명하라.
   - 기대 답변·채점: 접근 결정을 바꾸지 않고 판단을 분리하는 목적을 설명한다. exported `canRead()`가 boolean 판정을, `label()`이 visible/hidden 선택을 맡는다고 답한다.
2. viewer와 임의의 미등록 역할 문자열에 대해 추출 전후 결과가 같은 이유를 설명하라.
   - 기대 답변·채점: 양쪽 모두 `"hidden"`이라고 답한다. owner/editor와의 동일한 비교만 허용하므로 그 외 역할은 false가 되고 hidden으로 변환되며 허용 역할이 추가되지 않았다고 설명한다.

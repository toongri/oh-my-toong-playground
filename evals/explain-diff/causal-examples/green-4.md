# Case A — 실패 횟수에 따른 재시도 종료

## Intuition

실패가 세 번 쌓였을 때 반환값이 어떻게 바뀌는지 이해하면 종료 경계를 유지할 수 있다. 나는 이미 완료한 실패 횟수가 3 이상이면 종료를 선택하도록 바꿨다. `attempt = 3`은 세 번째 실패까지 끝났다는 뜻이며, 이때 `nextAction(3)`은 기존의 `retry` 대신 `stop`을 반환한다.

<div class="compare">
<div class="compare-before"><code>attempt = 3</code>이어도 <code>retry</code>를 반환한다.</div>
<div class="compare-after"><code>attempt = 3</code>이면 한도에 도달했으므로 <code>stop</code>을 반환한다.</div>
</div>

### `a123456` — 세 번 실패한 뒤 종료 선택

#### 변경 1: 재시도 반환값에 실패 횟수 한도 적용

<div class="cf" data-change="mod">
<p><strong><code>nextAction()</code></strong> (재시도 행동을 결정하는 함수) — <strong>기존</strong> 실패 횟수와 관계없이 <code>retry</code>를 반환했다. <strong>변경</strong> 완료한 실패 횟수가 3 미만이면 <code>retry</code>, 그 외에는 <code>stop</code>을 반환한다.</p>
<p><strong>왜</strong> — 세 번 실패한 뒤에도 재시도를 선택하던 동작을 끝내기 위해 바꿨다. <span class="cf-src">근거</span> "Stop retrying after three failed attempts."</p>
<p><strong>효과·사이드이펙트</strong> — 호출자가 받는 행동 문자열이 달라진다. 함수 자체는 지연 예약, 작업 저장, 알림 발송이나 횟수 초기화를 수행하지 않는다.</p>
<p><strong>검증</strong> — 제공된 테스트는 2에서 <code>retry</code>, 3과 4에서 <code>stop</code>을 기대한다. 이 연습에서 테스트를 실행하지는 않았다.</p>
<p class="cf-loc"><strong>바뀐 위치</strong> — <code>base:retry.ts:2</code> → <code>head:retry.ts:2</code></p>
</div>

```ts
export function nextAction(attempt: number): string {
  return attempt < 3 ? "retry" : "stop";
}
```

<p><strong>예시 연결</strong> 앞의 <code>attempt = 3</code>으로 <code>nextAction(3)</code>을 호출하면 <code>3 &lt; 3</code>의 값이 <code>false</code>이므로 <code>stop</code>을 반환한다. 기존 코드는 조건 없이 <code>retry</code>를 반환했다.</p>

<!-- 저자 전용 문항 은행 — 독자에게는 질문만 제시한다.

문항 A1 — 목적
- 바꾼 입력/조건: 없음. 기존 구현과 변경 구현을 비교한다.
- 질문: 이 변경은 기존의 어떤 문제를 해결하며, 실패 횟수를 어떤 기준으로 해석해야 하는가?
- 기대 결과 / 채점 항목 1: 완료한 실패가 세 번 이상이면 재시도 선택을 끝내려는 목적을 설명한다.
- 인과적 이유 / 채점 항목 2: 기존 nextAction은 항상 retry를 반환했고, attempt는 예정된 시도가 아닌 이미 완료한 실패 횟수라는 점을 설명한다.

문항 A2 — 전이
- 바꾼 입력/조건: attempt를 3에서 1로 바꾼다.
- 질문: 이미 한 번 실패한 뒤 nextAction(1)을 호출하면 무엇을 반환하며, 어떤 판단을 거쳐 그 결과가 나오는가?
- 기대 결과 / 채점 항목 1: retry를 반환한다.
- 인과적 이유 / 채점 항목 2: 1 < 3이 true이므로 삼항식의 retry 분기를 선택한다.
-->

# Case B — 접근 판단 추출

## Intuition

반환값을 유지하면서 판단 책임이 어디로 옮겨졌는지 확인한다. 나는 역할을 검사하는 식을 `canRead`로 추출했다. `role = "editor"`이면 기존과 변경 후 모두 `label`이 `visible`을 반환한다. 달라진 것은 이 판단을 `label` 안에서 직접 하던 대신 `canRead`에 맡긴다는 점이다.

<div class="compare">
<div class="compare-before"><code>label("editor")</code>가 직접 역할을 검사해 <code>visible</code>을 반환한다.</div>
<div class="compare-after"><code>label("editor")</code>가 <code>canRead("editor")</code>의 판단을 받아 같은 <code>visible</code>을 반환한다.</div>
</div>

### `b123456` — 접근 결과를 유지하며 판단 분리

#### 변경 1: 역할 검사 책임을 공개 함수로 추출

<div class="cf" data-change="mod">
<p><strong><code>canRead()</code></strong> (접근 판단 함수) — <strong>신설</strong> <code>owner</code> 또는 <code>editor</code>인지 검사해 boolean을 반환하는 공개 함수로 역할 판단을 맡는다.</p>
<p><strong><code>label()</code></strong> (접근 판단을 표시 문자열로 바꾸는 함수) — <strong>기존</strong> 역할을 직접 검사해 지역 변수 <code>allowed</code>에 저장하고 문자열을 선택했다. <strong>변경</strong> <code>canRead(role)</code>의 반환값으로 같은 문자열을 선택한다.</p>
<p><strong>왜</strong> — 접근 결과를 보존하면서 판단을 별도 함수로 분리하려고 바꿨다. <span class="cf-src">근거</span> "Extract canRead without changing access decisions."</p>
<p><strong>효과·사이드이펙트</strong> — 외부에서 호출할 수 있는 <code>canRead</code>가 추가된다. <code>label(role: string): string</code>의 입력과 반환값은 유지되며 허용 역할도 그대로다.</p>
<p><strong>검증</strong> — 제공된 테스트는 두 버전 모두 owner·editor에서 <code>visible</code>, viewer에서 <code>hidden</code>을 기대한다. 이 연습에서 테스트를 실행하지는 않았다.</p>
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

<p><strong>예시 연결</strong> <code>label("editor")</code>는 <code>canRead("editor")</code>를 호출한다. 두 비교의 결과가 <code>false || true</code>이므로 <code>true</code>를 받아 <code>visible</code>을 반환한다. 기존에도 같은 검사 결과를 <code>allowed = true</code>로 받아 <code>visible</code>을 반환했다. 역할 판단은 <code>canRead</code>로 옮겼고 문자열 선택은 <code>label</code>에 남겼다.</p>

<!-- 저자 전용 문항 은행 — 독자에게는 질문만 제시한다.

문항 B1 — 목적
- 바꾼 입력/조건: 없음. 추출 전후 책임을 비교한다.
- 질문: 이 변경은 무엇을 분리하기 위한 것이며, 그 목적을 지키려면 어떤 계약을 보존해야 하는가?
- 기대 결과 / 채점 항목 1: 접근 판단을 canRead로 분리하려는 목적을 설명한다.
- 인과적 이유 / 채점 항목 2: 접근 결정을 바꾸지 않는 추출이므로 label(role: string): string의 입력·반환값과 owner/editor 허용 규칙을 보존해야 한다고 설명한다.

문항 B2 — 전이
- 바꾼 입력/조건: role을 editor에서 admin으로 바꾼다.
- 질문: label("admin")의 결과는 추출 전후에 어떻게 되며, 유지된 어떤 규칙으로 설명할 수 있는가?
- 기대 결과 / 채점 항목 1: 두 버전 모두 hidden이다.
- 인과적 이유 / 채점 항목 2: admin은 owner도 editor도 아니므로 두 비교가 모두 false이다. 기존에는 allowed가, 변경 후에는 canRead의 반환값이 false여서 hidden을 선택한다.
-->

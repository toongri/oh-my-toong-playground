# Case A — 재시도 한도

## Intuition

실패 횟수를 언제 중단 판단에 쓰는지 이해하면 한도를 한 번 늦게 적용하는 실수를 피할 수 있다. 나는 이미 실패한 횟수가 3에 도달하면 중단을 반환하도록 바꿨다. `attempt = 3`은 세 번째 시도를 앞둔 상태가 아니라 세 번 실패한 뒤의 입력이다.

<div class="compare">
<div class="compare-before"><code>attempt = 3</code>이어도 <code>retry</code>를 반환했다.</div>
<div class="compare-after"><code>attempt = 3</code>이면 <code>stop</code>을 반환한다.</div>
</div>

## Code

같은 실패 횟수가 조건식에서 어떻게 중단으로 이어지는지 확인한다.

### `a123456` — Stop retrying after three failed attempts.

#### 변경 1: 세 번 이상 실패했으면 중단을 반환

<div class="cf" data-change="mod">
<p><strong><code>nextAction()</code></strong> (재시도 판단 함수) — <strong>기존</strong> 실패 횟수와 무관하게 <code>retry</code>를 반환했다. <strong>변경</strong> 이미 완료한 실패 횟수가 3 미만일 때만 <code>retry</code>, 그 외에는 <code>stop</code>을 반환한다.</p>
<p><strong>왜</strong> — 세 번 실패한 뒤에도 재시도 판단이 계속되는 것을 막기 위해 바꿨다. <span class="cf-src">근거</span> "Stop retrying after three failed attempts."</p>
<p><strong>효과·사이드이펙트</strong> — 관찰 가능한 계약은 반환 문자열이다. 이 함수는 지연 예약, 작업 저장, 알림 전송, 횟수 초기화를 수행하지 않는다.</p>
<p><strong>검증</strong> — 제공된 테스트는 2 → retry, 3 → stop, 4 → stop을 확인한다. 테스트를 별도로 실행한 것은 아니다.</p>
<p class="cf-loc"><strong>바뀐 위치</strong> — <code>base:retry.ts:2</code> → <code>head:retry.ts:2</code></p>
</div>

```ts
export function nextAction(attempt: number): string {
  return attempt < 3 ? "retry" : "stop";
}
```

<p><strong>예시 연결</strong> 앞의 <code>attempt = 3</code>으로 <code>nextAction(3)</code>을 호출하면 <code>3 &lt; 3</code>이 <code>false</code>이므로 <code>stop</code>을 반환한다. 기존의 무조건 <code>retry</code> 반환과 달라지는 지점이다.</p>

### 작성자 전용 질문 은행 — 독자 본문과 분리

1. 변경 입력/조건: 없음, 변경 목적 확인. 질문: 이 변경은 어떤 문제를 해결하며, 여기서 보장하는 중단의 범위는 어디까지인가? 기대 결과: 세 번 실패한 뒤에는 `stop`을 반환한다. 인과 이유: 기존에는 실패 횟수를 무시하고 `retry`를 반환했으므로 한도를 표현할 수 없었다. 채점은 반환 계약과 그 이유를 각각 요구하며 실제 작업 취소까지 주장하면 불충분하다.
2. 변경 입력/조건: `attempt = 3`을 `attempt = 1`로 바꾼다. 질문: 실패 한 번 뒤 `nextAction(1)`의 반환값은 무엇이며, 어느 판단을 거쳐 결정되는가? 기대 결과: `retry`. 인과 이유: `1 < 3`이 참이므로 삼항식의 참 분기를 선택한다. 결과와 조건 평가를 별도 채점한다.

# Case B — 접근 판단 추출

## Intuition

결과와 책임의 위치를 구분하면 추출 과정에서 접근 규칙이 유지됐는지 확인할 수 있다. 나는 `label` 안의 판단을 `canRead`로 옮겼다. `role = "editor"`의 결과는 계속 `visible`이지만, 읽기 허용 여부는 이제 `canRead`가 판단한다.

<div class="compare">
<div class="compare-before"><code>label("editor")</code>가 직접 역할을 비교하고 <code>visible</code>을 반환했다.</div>
<div class="compare-after"><code>label("editor")</code>가 <code>canRead("editor")</code>의 <code>true</code>를 받아 <code>visible</code>을 반환한다.</div>
</div>

## Code

역할 판정과 문자열 선택이 나뉘어도 같은 입력의 결과가 유지되는 근거를 확인한다.

### `b123456` — Extract canRead without changing access decisions.

#### 변경 1: 역할 판정을 공개 헬퍼로 추출

<div class="cf" data-change="mod">
<p><strong><code>label()</code></strong> (접근 표시 함수) — <strong>기존</strong> 역할 비교와 표시 문자열 선택을 함께 수행했다. <strong>변경</strong> 역할 판단은 <code>canRead()</code>에 맡기고 불리언 결과를 문자열로 바꾼다.</p>
<p><strong><code>canRead()</code></strong> (접근 판단 헬퍼) — <strong>신설</strong> <code>owner</code> 또는 <code>editor</code>인지 비교해 불리언을 반환하는 함수를 export한다.</p>
<p><strong>왜</strong> — 접근 결정은 보존하면서 판단을 별도 함수로 추출하기 위해 바꿨다. <span class="cf-src">근거</span> "Extract canRead without changing access decisions."</p>
<p><strong>효과·사이드이펙트</strong> — 공개 헬퍼가 추가된다. <code>label(role: string): string</code>의 서명과 반환 규칙은 유지하며, 다른 모든 역할 문자열은 계속 <code>hidden</code>이다.</p>
<p><strong>검증</strong> — 제공된 테스트는 양쪽 버전에서 owner·editor → visible, viewer → hidden을 확인한다. 별도로 실행하지는 않았다.</p>
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

<p><strong>예시 연결</strong> <code>label("editor")</code>는 <code>canRead("editor")</code>를 호출한다. <code>false || true</code>가 <code>true</code>이므로 <code>visible</code>을 선택한다. 기존에는 같은 비교의 결과를 <code>allowed</code>에 담았다. 판단의 소유자는 바뀌었지만 결과는 같다.</p>

### 작성자 전용 질문 은행 — 독자 본문과 분리

1. 변경 입력/조건: 없음, 변경 목적 확인. 질문: 이번 추출에서 달성하려는 목적과 유지해야 할 계약을 설명하라. 기대 결과: 역할 판단을 공개 `canRead`로 분리하고 `label`의 입력·출력 계약을 유지한다. 인과 이유: 기존 역할 비교식을 그대로 옮기고 같은 불리언으로 문자열을 선택하므로 접근 결정을 바꿀 필요가 없다. 책임 이동과 보존 이유를 별도 채점한다.
2. 변경 입력/조건: `role = "editor"`를 `role = "auditor"`로 바꾼다. 질문: `label("auditor")`는 추출 전후 각각 무엇을 반환하며, 그 결과를 결정하는 규칙은 무엇인가? 기대 결과: 양쪽 모두 `hidden`. 인과 이유: `auditor`는 두 허용 역할과 모두 달라 비교가 `false`이며, 추출 후에도 그 값을 받아 거짓 분기를 선택한다. 결과와 보존된 규칙을 별도 채점한다.

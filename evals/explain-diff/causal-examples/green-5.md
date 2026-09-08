# Case A — 실패 횟수에 따른 재시도 종료

## Intuition

세 번째 실패 직후 무엇을 반환하는지 이해하면 종료 경계를 유지할 수 있다. 나는 이미 완료된 실패 횟수가 3 이상이면 `stop`을 반환하도록 바꿨다. `attempt = 3`은 앞으로 할 시도가 아니라 이미 세 번 실패했다는 뜻이다. 이때 `3 < 3`은 거짓이므로, 항상 `retry`를 반환하던 이전과 달리 `stop`을 반환한다.

<div class="compare">
<div class="compare-before"><code>nextAction(3)</code>은 실패 횟수를 검사하지 않고 <code>retry</code>를 반환한다.</div>
<div class="compare-after"><code>nextAction(3)</code>은 <code>3 &lt; 3</code>이 거짓이어서 <code>stop</code>을 반환한다.</div>
</div>

#### 변경 1: 세 번 실패한 뒤 종료 행동 반환

반환값을 바꾸는 조건과 그 조건의 적용 범위를 확인한다.

<div class="cf" data-change="mod">
<p><strong><code>nextAction()</code></strong> (재시도 행동 판정 함수) — <strong>기존</strong> 횟수에 관계없이 <code>retry</code>를 반환했다. <strong>변경</strong> 완료된 실패 횟수가 3 미만이면 <code>retry</code>, 나머지는 <code>stop</code>을 반환한다.</p>
<p><strong>왜</strong> — 세 번 실패한 뒤에도 재시도를 지시하던 동작을 끝내기 위해 바꿨다. <span class="cf-src">근거</span> a123456: "Stop retrying after three failed attempts."</p>
<p><strong>효과·사이드이펙트</strong> — 호출자가 받는 행동 문자열이 바뀐다. 이 함수 자체는 대기 시간을 예약하거나 작업을 저장하거나 알림을 보내거나 횟수를 초기화하지 않는다.</p>
<p><strong>검증</strong> — 제공된 테스트는 2 → retry, 3 → stop, 4 → stop을 확인한다.</p>
<p class="cf-loc"><strong>바뀐 위치</strong> — <code>base:retry.ts:2</code> → <code>head:retry.ts:2</code></p>
</div>

```ts
export function nextAction(attempt: number): string {
  return attempt < 3 ? "retry" : "stop";
}
```

<p><strong>예시 연결</strong> 앞의 <code>attempt = 3</code>으로 <code>nextAction(3)</code>을 호출하면 <code>attempt &lt; 3</code>은 <code>false</code>가 된다. 삼항식의 두 번째 값인 <code>stop</code>을 반환한다.</p>

### 작성자 전용 질문 은행

1. 변경 입력/조건: 없음, 목적 확인.
   질문: 이 변경이 필요한 이유와, 이 함수가 호출자에게 제공하는 결과의 범위를 설명하라.
   기대 결과: 세 번 실패한 뒤 재시도를 계속 지시하지 않도록 한다. 관찰 가능한 결과는 `retry` 또는 `stop` 반환이다.
   인과 이유: 기존에는 횟수를 무시했다. 변경 후에는 완료된 실패 횟수 3을 종료 경계로 사용하며, 실제 예약이나 초기화를 실행하지 않는다.
2. 변경 입력/조건: 가정으로만 `attempt < 3`을 `attempt <= 3`으로 바꾸고 입력 3을 유지한다.
   질문: 이 가정에서 반환값은 어떻게 달라지며, 원래 종료 목적에 어떤 영향을 주는가? 이유도 설명하라.
   기대 결과: `retry`를 반환해 세 번째 실패 직후의 종료를 지시하지 못한다.
   인과 이유: `3 <= 3`이 참이므로 첫 번째 값을 선택한다. 결과와 조건 설명을 각각 채점한다.

# Case B — 접근 판정 책임 추출

## Intuition

같은 입력의 결과와 판정 담당자가 어떻게 유지·변경되는지 확인한다. 나는 접근 허용 판정을 `canRead`로 옮기고 `label`은 그 결과를 문자열로 바꾸도록 했다. `role = "editor"`이면 이전에는 `label` 내부 비교가 참이었다. 이후에도 `canRead("editor")`가 참을 반환하므로 `label`의 결과는 같은 `visible`이다.

<div class="compare">
<div class="compare-before"><code>label("editor")</code> 내부에서 역할 비교 → <code>allowed = true</code> → <code>visible</code></div>
<div class="compare-after"><code>label("editor")</code> → <code>canRead("editor") = true</code> → <code>visible</code></div>
</div>

#### 변경 1: 허용 판정을 공개 함수로 분리하고 label 결과 보존

판정을 옮긴 위치와 보존한 규칙을 코드에서 연결한다.

<div class="cf" data-change="mod">
<p><strong><code>label()</code></strong> (접근 판정 결과를 문자열로 바꾸는 함수) — <strong>기존</strong> 역할 비교와 문자열 선택을 모두 수행했다. <strong>변경</strong> 역할 비교를 <code>canRead</code>에 맡기고 참이면 <code>visible</code>, 거짓이면 <code>hidden</code>을 반환한다.</p>
<p><strong><code>canRead()</code></strong> (접근 허용 판정 함수) — <strong>신설</strong> 기존의 owner 또는 editor 비교식을 넘겨받아 불리언을 반환하며 외부로 공개된다.</p>
<p><strong>왜</strong> — 접근 결정 결과를 유지하면서 판정 책임을 추출하기 위해 바꿨다. <span class="cf-src">근거</span> b123456: "Extract canRead without changing access decisions."</p>
<p><strong>효과·사이드이펙트</strong> — 공개 helper가 추가된다. <code>label(role: string): string</code> 계약과 반환값은 유지되며, owner와 editor 외 문자열은 계속 hidden이 된다.</p>
<p><strong>검증</strong> — 제공된 테스트는 두 버전 모두 owner → visible, editor → visible, viewer → hidden을 확인한다.</p>
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

<p><strong>예시 연결</strong> <code>label("editor")</code>가 <code>canRead("editor")</code>를 호출하면 비교식은 <code>false || true</code>여서 <code>true</code>를 반환한다. <code>label</code>은 이를 받아 이전과 동일한 <code>visible</code>을 반환한다. 비교 책임만 helper로 이동했다.</p>

### 작성자 전용 질문 은행

1. 변경 입력/조건: 없음, 목적 확인.
   질문: 접근 결과를 그대로 유지하면서 이번 변경이 달성한 것은 무엇이며, 두 함수의 책임은 어떻게 나뉘는가?
   기대 결과: 접근 판정을 공개 helper `canRead`로 추출했다.
   인과 이유: `canRead`가 불리언 판정을 담당하고 `label`이 문자열 선택을 담당한다. 새 권한을 추가할 필요 없이 기존 비교식을 이동한 변경이다.
2. 변경 입력/조건: `role`을 예시의 editor에서 `"auditor"`로 바꾼다.
   질문: 두 버전의 `label("auditor")` 결과가 같은지 예측하고, 유지된 규칙으로 이유를 설명하라.
   기대 결과: 두 버전 모두 `hidden`이다.
   인과 이유: auditor는 owner도 editor도 아니므로 비교 결과가 거짓이다. 추출 후에는 `canRead`가 그 거짓을 반환하고 `label`이 hidden을 선택한다. 결과와 이유를 별도로 채점한다.

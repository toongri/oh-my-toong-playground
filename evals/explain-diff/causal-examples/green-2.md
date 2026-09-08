# Case A — 재시도 한도

## Intuition

실패 횟수가 언제 중단 판단으로 바뀌는지 이해하면 한도를 수정할 때 경계를 지킬 수 있다. 나는 세 번 실패한 뒤에도 재시도를 반환하던 동작에 한도를 두었다. `attempt`는 이미 끝난 실패 횟수이며, 실패 직후 함수가 호출된다. 예를 들어 `attempt = 3`이면 세 번째 실패가 끝난 상태다. 이제 이 입력에는 `stop`을 반환한다.

<div class="compare">
<div class="compare-before"><code>attempt = 3</code>에도 <code>retry</code>를 반환한다.</div>
<div class="compare-after"><code>attempt = 3</code>이면 한도에 도달했으므로 <code>stop</code>을 반환한다.</div>
</div>

### `a123456` — 세 번 실패한 뒤 중단 판단

#### 변경 1: 실패 횟수로 다음 행동을 결정한다

여기서는 앞의 한도가 실제 조건식에 어떻게 반영되는지 확인한다.

<div class="cf" data-change="mod">
<p><strong><code>nextAction()</code></strong> (재시도 판단 함수) — <strong>기존</strong> 실패 횟수와 무관하게 <code>retry</code>를 반환했다. <strong>변경</strong> 실패 횟수가 3 미만이면 <code>retry</code>, 나머지는 <code>stop</code>을 반환한다.</p>
<p><strong>왜</strong> — 세 번 실패한 뒤 재시도를 중단하기 위해 바꾸었다. <span class="cf-src">근거</span> "Stop retrying after three failed attempts."</p>
<p><strong>효과·사이드이펙트</strong> — 관찰 가능한 변화는 반환 행동이다. 함수가 지연을 예약하거나 실패 횟수를 초기화하는 동작은 없다.</p>
<p><strong>검증</strong> — 제공된 테스트는 2 → retry, 3 → stop, 4 → stop을 확인하여 한도 직전·도달·초과를 다룬다.</p>
<p class="cf-loc"><strong>바뀐 위치</strong> — <code>base:retry.ts:2</code> → <code>head:retry.ts:2</code></p>
</div>

```ts
export function nextAction(attempt: number): string {
  return attempt < 3 ? "retry" : "stop";
}
```

<p><strong>예시 연결</strong> 앞의 <code>attempt = 3</code>을 <code>nextAction(3)</code>에 넣으면 <code>3 &lt; 3</code>이 <code>false</code>가 된다. 따라서 두 번째 선택지인 <code>stop</code>을 반환한다.</p>

### 작성자 전용 질문 은행 — 독자 전달에서 제외

1. 목적 질문
   - 변경 입력·조건: 없음, 변경 목적을 확인한다.
   - 질문: 이 변경은 기존의 어떤 문제를 해결하며, 중단 한도는 무엇을 센 값인가?
   - 기대 결과: 세 번 실패한 뒤에도 `retry`를 반환하던 문제를 해결한다.
   - 인과 이유: `attempt`는 이미 완료된 실패 횟수이므로 세 번째 실패 뒤 호출부터 중단 판단을 해야 한다.
   - 채점: 기존 문제와 완료된 실패 3회라는 기준을 각각 충족해야 한다.
2. 전이 질문
   - 변경 입력·조건: 예시의 `attempt = 3`을 `attempt = 1`로 바꾼다.
   - 질문: 첫 번째 실패 직후 `nextAction(1)`의 반환값은 무엇이며, 어떤 조건 판단 때문에 그렇게 되는가?
   - 기대 결과: `retry`를 반환한다.
   - 인과 이유: `1 < 3`이 참이어서 첫 번째 선택지를 반환한다.
   - 채점: 반환값과 비교식의 참 여부를 별도로 확인한다.

# Case B — 접근 판단 추출

## Intuition

결과를 유지하면서 판단 책임이 어디로 옮겨졌는지 이해하는 예시다. 나는 역할 검사만 `canRead`로 꺼냈다. `role = "editor"`이면 추출 전후 모두 `visible`이다. 역할을 허용할지 판단하는 함수는 달라졌지만, 허용 역할은 여전히 `owner`와 `editor`뿐이다.

<div class="compare">
<div class="compare-before"><code>label("editor")</code>가 직접 역할을 검사해 <code>visible</code>을 반환한다.</div>
<div class="compare-after"><code>label("editor")</code>가 <code>canRead</code>의 판단을 받아 같은 <code>visible</code>을 반환한다.</div>
</div>

### `b123456` — 접근 결정을 유지하며 판단 함수 추출

#### 변경 1: 역할 판단과 문자열 선택을 나눈다

코드에서는 같은 입력이 새 함수 호출을 거쳐 같은 결과에 이르는지 확인한다.

<div class="cf" data-change="mod">
<p><strong><code>label()</code></strong> (접근 결과 문자열을 반환하는 함수) — <strong>기존</strong> 역할 비교 결과를 <code>allowed</code>에 담아 문자열을 선택했다. <strong>변경</strong> 역할 판단을 <code>canRead(role)</code>에 맡기고 문자열 선택을 유지한다.</p>
<p><strong><code>canRead()</code></strong> (접근 판단 보조 함수) — <strong>신설</strong> <code>owner</code> 또는 <code>editor</code>인지 검사하여 불리언을 반환하는 공개 함수를 추가했다.</p>
<p><strong>왜</strong> — 기존 접근 결정을 유지하면서 판단을 추출하기 위해서다. <span class="cf-src">근거</span> "Extract canRead without changing access decisions."</p>
<p><strong>효과·사이드이펙트</strong> — 공개 보조 함수가 추가된다. <code>label(role: string): string</code>의 계약은 유지되고, 다른 역할 문자열은 모두 <code>hidden</code>이다.</p>
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

<p><strong>예시 연결</strong> <code>label("editor")</code>는 <code>canRead("editor")</code>를 호출한다. 두 비교는 <code>false || true</code>이므로 보조 함수가 <code>true</code>를 반환하고, <code>label</code>은 <code>visible</code>을 선택한다. 기존에는 같은 비교 결과를 <code>allowed</code>에 저장했다. 결과는 같고 역할 판단의 책임만 <code>canRead</code>로 이동했다.</p>

### 작성자 전용 질문 은행 — 독자 전달에서 제외

1. 목적 질문
   - 변경 입력·조건: 없음, 추출 목적을 확인한다.
   - 질문: 이 변경의 목적은 무엇이며, `canRead`와 `label`은 각각 어떤 판단을 맡게 되었는가?
   - 기대 결과: 접근 결정을 유지하면서 역할 판단을 추출한다.
   - 인과 이유: `canRead`는 역할 허용 여부를 불리언으로 반환하고, `label`은 그 값에 따라 문자열을 선택한다.
   - 채점: 동작 보존 목적과 두 함수의 책임 구분을 각각 확인한다.
2. 전이 질문
   - 변경 입력·조건: 예시의 `editor`를 `admin`으로 바꾼다.
   - 질문: `label("admin")`은 추출 전후 각각 무엇을 반환하며, 결과가 유지되거나 달라지는 이유는 무엇인가?
   - 기대 결과: 두 버전 모두 `hidden`을 반환한다.
   - 인과 이유: `admin`은 `owner`와 `editor` 어느 쪽에도 일치하지 않아 같은 OR 조건이 거짓이다. 추출 후에도 `canRead`가 그 규칙을 그대로 적용한다.
   - 채점: 전후 반환값과 보존된 비교 규칙을 별도로 확인한다.

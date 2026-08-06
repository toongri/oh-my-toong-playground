# ultragoal 상태 갱신 락 통합 — bcd493b1

- **범위**: `bcd493b1^..bcd493b1` — `fix: ultragoal 상태 갱신 락 통합`
- **저장소**: oh-my-toong (`/Users/toong/.omt/oh-my-toong-playground/explain-diff-eval/fixtures/refactor-invariant`)
- **규모**: 6개 파일, +305 / −170

## Evidence

`git diff --name-status bcd493b1^..bcd493b1` 의 6개 파일 전부를 signal로 분류했다.
noise 기본 규칙표(`*.lock`, `dist/`, `__snapshots__/`, `*.generated.*`, 포맷팅만 바뀐 hunk)에
걸린 파일은 **하나도 없다**. 규칙표 밖의 파일을 noise로 내린 건은 없으므로 사유 줄도 없다.

| 파일 | 상태 | 분류 | 분류 근거 |
|---|---|---|---|
| `lib/persistent-mode-core/state-lock.ts` | A | signal | 이 커밋이 만든 공용 모듈. 변경의 중심 |
| `skills/ultragoal/scripts/ultragoal-state.ts` | M | signal | 락 사본 153줄 삭제 + `resumePursuit` 쓰기 경로 교체 |
| `lib/persistent-mode-core/state.ts` | M | signal | 두 번째 기록자가 처음으로 락 아래로 들어감 (동작 변경) |
| `lib/persistent-mode-core/state-lock.test.ts` | A | signal | 공용 락의 3대 계약을 처음 고정 |
| `lib/persistent-mode-core/state.test.ts` | M | signal | 훅 기록자의 fail-closed 계약을 새로 고정 |
| `skills/ultragoal/scripts/ultragoal-state.test.ts` | M | signal | 하트비트 갱신이라는 새 계약을 고정 |

포맷팅 판정 하나만 따로 적어 둔다. `lib/persistent-mode-core/state.ts` 의 diff는 겉보기에
들여쓰기 이동이 대부분이지만, 그 들여쓰기는 본문 전체가 콜백 안으로 들어가면서 생긴 것이다.
포맷팅만 바뀐 hunk가 아니므로 signal이다.

## Background

### 깊은 배경

이미 익숙하면 건너뛰세요.

**oh-my-toong(OMT)** 은 스킬·훅·에이전트 정의를 한곳에서 관리해 여러 AI CLI로 배포하는
설정 관리 시스템이다. 이 커밋을 읽는 데 필요한 것은 그중 두 종류의 실행 주체다.

- **스킬 CLI** — 사람이나 에이전트가 명령을 칠 때마다 새로 뜨는 단발 프로세스다.
  `skills/ultragoal/scripts/ultragoal-state.ts` 가 그 CLI이고, 스토리 확정·판정 기록 같은
  상태 변경을 담당한다.
- **훅(hook)** — CLI와 무관하게 세션 수명 이벤트에 반응해 뜨는 별개 프로세스다.
  `lib/persistent-mode-core/decision.ts` 가 Stop 훅의 판단 로직이고, "아직 할 일이 남았으니
  멈추지 마라"를 결정하면서 반복 횟수를 올린다.

**ultragoal** 은 하나의 목표(objective)를 여러 스토리로 쪼개 자율 추격하는 실행기다. 그
추격의 전 상태 — 현재 phase, 반복 횟수 `iteration`, 스토리 목록, 리뷰 디스패치 잔량 — 는
세션마다 **JSON 파일 하나**에 산다.

```
$OMT_DIR/ultragoal-state-<sessionId>.json
```

여기서 중요한 사실 하나. **이 파일을 고치는 주체가 한 프로세스가 아니다.** 스킬 CLI도 쓰고
Stop 훅도 쓴다. 둘은 서로를 모르고, 동시에 떠 있을 수 있다.

파일 하나를 여러 프로세스가 고칠 때 쓰는 고전적 방어가 **read-modify-write 를 락으로 감싸는
것**이다. 이 저장소가 쓰는 락은 POSIX 파일 락이 아니라 **mkdir 락**이다. `mkdir` 은 대부분의
파일시스템에서 원자적이라 — 이미 있으면 `EEXIST` 로 실패한다 — 디렉터리 하나를 만드는 데
성공한 쪽이 락을 잡은 것으로 친다. 그래서 락은 `<상태파일>.lock` 이라는 **디렉터리**다.

mkdir 락에는 대가가 하나 붙는다. 락을 잡은 프로세스가 죽으면 디렉터리가 그대로 남아 아무도
못 들어간다. 그래서 이 구현은 락 디렉터리 안에 `owner.json`(`ownerPid`·`token`·`startedAt`)을
써 두고, ① 주인 PID가 죽었거나 ② 디렉터리 mtime이 30초를 넘겼으면 **stale로 보고 회수**한다.

### 좁은 배경

`ultragoal-state-<sessionId>.json` 을 실제로 쓰는 경로는 이 커밋 직전 기준 **셋**이었고, 셋이
서로 다른 보호를 받고 있었다.

| 경로 | 사는 곳 | 락 | 하트비트 갱신 |
|---|---|---|---|
| `mergeWrite` → `mergeWriteLocked` | 스킬 CLI | 있음 | 있음 |
| `resumePursuit` | 스킬 CLI | 있음 | **없음** (원시 쓰기) |
| `updateUltragoalState` | 훅 (`lib/`) | **없음** | 있음 |

두 축을 구분해 두는 게 이 커밋을 읽는 열쇠다.

- **락** — 읽고-고치고-쓰는 구간을 다른 프로세스로부터 격리한다.
- **하트비트** — `last_touched_at` 과 `progress_touched_at` 두 타임스탬프를 갱신한다.
  앞의 것은 가비지 컬렉터가 "이 상태 파일이 아직 살아 있나"를 판정하는 축이고, 뒤의 것은
  무진전 카운터가 "이 추격이 전진하고 있나"를 판정하는 축이다. `mergeWithHeartbeat` 이 둘을
  항상 함께 찍는다.

`mergeWriteLocked` 는 이름 그대로 **락을 이미 잡고 있는 호출자만** 부를 수 있는 내부 함수다
(`/** Caller must hold the per-session state lock. */`). 필드를 하나하나 열거해 병합하고,
마지막에 `mergeWithHeartbeat` 을 통과시킨 뒤 `writeFileNoCreate` 로 쓴다. `resumePursuit` 은
이 함수를 쓰지 않고 `{ ...prior, ... }` 를 직접 직렬화했다.

## Intuition

### 한 문장

**같은 파일을 고치는 세 경로가 서로 다른 보호를 받고 있었고, 이 커밋은 셋을 하나의 락과 하나의
병합 경로 아래로 모은다.**

락 알고리즘 자체는 **한 줄도 바뀌지 않았다.** 자리만 옮겼다. 바뀐 것은 "그 락을 누가 잡느냐"다.

### 잃어버리는 값이 어떻게 생기는가

세션 `sess7` 이 스토리 하나를 막 확정하려는 순간을 보자. 디스크에는 이렇게 있다.

```json
{ "iteration": 7, "phase": "pursuing", "stories": [{ "id": "S1" }] }
```

<div style="border:1px solid #c9c9c9;border-radius:8px;padding:14px;margin:1.2rem 0">
<div style="font-weight:700;margin-bottom:10px">데이터 흐름 — 락이 한쪽에만 있을 때 (변경 전)</div>
<table style="width:100%;border-collapse:collapse;font-size:0.92em">
<tr><th style="text-align:left;padding:6px;border-bottom:1px solid #c9c9c9">시각</th><th style="text-align:left;padding:6px;border-bottom:1px solid #c9c9c9">스킬 CLI (락 보유)</th><th style="text-align:left;padding:6px;border-bottom:1px solid #c9c9c9">Stop 훅 (락 없음)</th><th style="text-align:left;padding:6px;border-bottom:1px solid #c9c9c9">디스크</th></tr>
<tr><td style="padding:6px">t0</td><td style="padding:6px">락 획득 → 읽기<br><code>iteration: 7</code></td><td style="padding:6px">읽기<br><code>iteration: 7</code></td><td style="padding:6px"><code>iteration: 7</code><br><code>stories: [S1]</code></td></tr>
<tr><td style="padding:6px">t1</td><td style="padding:6px">쓰기<br><code>stories: [S1, S2]</code></td><td style="padding:6px">(계산 중)</td><td style="padding:6px"><code>iteration: 7</code><br><code>stories: [S1, S2]</code></td></tr>
<tr><td style="padding:6px">t2</td><td style="padding:6px">락 해제</td><td style="padding:6px">쓰기<br><code>iteration: 8</code></td><td style="padding:6px;background:#fff0f0"><code>iteration: 8</code><br><code>stories: [S1]</code> ← <b>S2 소실</b></td></tr>
</table>
<div style="margin-top:10px;font-size:0.9em;color:#666">훅은 t0에 읽은 낡은 스냅샷 위에 <code>iteration: 8</code> 만 얹어 통째로 다시 쓴다. 그 스냅샷에는 <code>S2</code> 가 없었다.</div>
</div>

훅이 t2에 쓴 것은 `iteration` 하나가 아니다. t0에 읽은 객체 전체를 다시 직렬화한다. 그래서
그 사이에 CLI가 넣은 `S2` 는 흔적 없이 사라진다. 락이 한쪽에만 있으면 락은 **아무것도 막지
못한다** — 상호 배제는 참가자 전원이 같은 락을 잡아야 성립한다.

<div style="display:flex;gap:14px;flex-wrap:wrap;margin:1.2rem 0">
<div style="flex:1 1 280px;border:1px solid #c9c9c9;border-radius:8px;padding:14px">
<div style="font-weight:700;margin-bottom:10px">Before — 보호가 셋으로 갈림</div>
<div style="margin:6px 0;padding:8px;border-left:3px solid #6aa84f"><code>mergeWrite</code><br><span style="font-size:0.88em;color:#666">락 O · 하트비트 O</span></div>
<div style="margin:6px 0;padding:8px;border-left:3px solid #e69138"><code>resumePursuit</code><br><span style="font-size:0.88em;color:#666">락 O · 하트비트 <b>X</b></span></div>
<div style="margin:6px 0;padding:8px;border-left:3px solid #cc0000"><code>updateUltragoalState</code><br><span style="font-size:0.88em;color:#666">락 <b>X</b> · 하트비트 O</span></div>
</div>
<div style="flex:1 1 280px;border:1px solid #c9c9c9;border-radius:8px;padding:14px">
<div style="font-weight:700;margin-bottom:10px">After — 셋 다 같은 바닥</div>
<div style="margin:6px 0;padding:8px;border-left:3px solid #6aa84f"><code>mergeWrite</code><br><span style="font-size:0.88em;color:#666">락 O · 하트비트 O</span></div>
<div style="margin:6px 0;padding:8px;border-left:3px solid #6aa84f"><code>resumePursuit</code><br><span style="font-size:0.88em;color:#666">락 O · 하트비트 O <span style="color:#666">(병합 경로 경유)</span></span></div>
<div style="margin:6px 0;padding:8px;border-left:3px solid #6aa84f"><code>updateUltragoalState</code><br><span style="font-size:0.88em;color:#666">락 O · 하트비트 O</span></div>
</div>
</div>

### 락을 어디에 둘 수 있었나

락 코드가 `skills/ultragoal/scripts/` 안에 살아 있는 한 훅은 그것을 쓸 수 없다. `tsconfig.json`
의 경로 별칭은 `"@lib/*": ["lib/*"]` 하나뿐이고, `lib/` 안의 어떤 소스도 `skills/` 를 import
하지 않는다. 의존 방향은 한쪽으로만 흐른다.

<div style="border:1px solid #c9c9c9;border-radius:8px;padding:14px;margin:1.2rem 0">
<div style="font-weight:700;margin-bottom:12px">모듈 지도 — 화살표는 import 방향</div>
<div style="display:flex;gap:12px;flex-wrap:wrap;align-items:stretch">
<div style="flex:1 1 220px;border:1px dashed #999;border-radius:6px;padding:10px">
<div style="font-size:0.85em;color:#666;margin-bottom:6px">skills/ultragoal/scripts/</div>
<div style="padding:6px 8px;background:#f4f4f2;border-radius:4px"><code>ultragoal-state.ts</code></div>
<div style="font-size:0.85em;color:#666;margin-top:8px">스킬 CLI · 단발 프로세스</div>
</div>
<div style="flex:0 0 auto;display:flex;align-items:center;font-size:1.4em;color:#666">↘</div>
<div style="flex:1 1 220px;border:1px dashed #999;border-radius:6px;padding:10px">
<div style="font-size:0.85em;color:#666;margin-bottom:6px">lib/persistent-mode-core/</div>
<div style="padding:6px 8px;background:#e8f0fb;border-radius:4px"><code>state-lock.ts</code> <span style="font-size:0.85em">← 이 커밋이 만든 공용 바닥</span></div>
<div style="padding:6px 8px;background:#f4f4f2;border-radius:4px;margin-top:6px"><code>state.ts</code> → <code>decision.ts</code></div>
<div style="font-size:0.85em;color:#666;margin-top:8px">훅 · 별개 프로세스</div>
</div>
<div style="flex:0 0 auto;display:flex;align-items:center;font-size:1.4em;color:#666">↖</div>
</div>
<div style="margin-top:10px;font-size:0.9em;color:#666"><code>lib/</code> 는 <code>skills/</code> 를 import 하지 않는다. 그래서 공유되려면 락이 <code>lib/</code> 로 내려가야 한다 — 반대 방향은 불가능하다.</div>
</div>

### 락 디렉터리의 일생

<div style="border:1px solid #c9c9c9;border-radius:8px;padding:14px;margin:1.2rem 0">
<div style="font-weight:700;margin-bottom:12px">상태 전이 — <code>ultragoal-state-sess7.json.lock</code></div>
<table style="width:100%;border-collapse:collapse;font-size:0.92em">
<tr><th style="text-align:left;padding:6px;border-bottom:1px solid #c9c9c9">상태</th><th style="text-align:left;padding:6px;border-bottom:1px solid #c9c9c9">사건</th><th style="text-align:left;padding:6px;border-bottom:1px solid #c9c9c9">다음 상태</th></tr>
<tr><td style="padding:6px"><b>없음</b></td><td style="padding:6px"><code>mkdirSync</code> 성공 → <code>owner.json</code> 기록</td><td style="padding:6px"><b>보유</b></td></tr>
<tr><td style="padding:6px"><b>보유</b></td><td style="padding:6px">콜백 종료 → 토큰이 내 것이면 삭제</td><td style="padding:6px"><b>없음</b></td></tr>
<tr><td style="padding:6px"><b>보유</b></td><td style="padding:6px">남이 <code>mkdirSync</code> → <code>EEXIST</code>, 주인 살아 있음</td><td style="padding:6px"><b>보유</b> (5ms 대기 후 재시도, 최대 100회)</td></tr>
<tr><td style="padding:6px"><b>보유</b></td><td style="padding:6px">주인 PID 사망 <b>또는</b> mtime + 30초 경과</td><td style="padding:6px"><b>회수 대상</b></td></tr>
<tr><td style="padding:6px"><b>회수 대상</b></td><td style="padding:6px">rename으로 격리 후 삭제 (recovery 가드 아래)</td><td style="padding:6px"><b>없음</b></td></tr>
<tr><td style="padding:6px"><b>보유</b></td><td style="padding:6px">100회 재시도 소진</td><td style="padding:6px;background:#fff0f0"><b>throw</b> — 락 없는 쓰기로 물러서지 않음</td></tr>
</table>
</div>

여기서 마지막 줄이 이 커밋의 대가다. `sess7` 의 락이 살아 있는 주인에게 잡혀 있으면 훅의
`iteration: 7 → 8` 쓰기는 **성공하지 않고 던진다.** 변경 전에는 훅이 락을 아예 보지 않았으니
던질 일도 없었다. 이 던짐이 어디로 가는지가 Change Group 3의 주제다.

---

## Change Group 1: 락을 두 프로세스가 공유할 수 있는 자리로 옮긴다

> 예고: 락 알고리즘 전체를 `lib/` 아래 새 모듈로 그대로 들어 올려, 스킬과 훅 양쪽이 같은
> 코드를 import 할 수 있는 상태를 만든다. 알고리즘은 손대지 않는다.
> 순서: 이 그룹이 먼저여야 하는 이유는 도구가 없으면 아무도 쓸 수 없기 때문이다. 뒤의 두
> 그룹은 모두 "여기서 만든 함수를 부른다"로 시작한다.

### `lib/persistent-mode-core/state-lock.ts`

**역할/변경 전 맥락** — 존재하지 않던 파일이다. 같은 알고리즘이 스킬 CLI 안에 사적으로
살아 있었다 (`base:skills/ultragoal/scripts/ultragoal-state.ts:415`).

**무엇이 바뀌었나** — 157줄짜리 새 모듈이 생겼다. `withStateLock` 하나만 `export` 하고
(`head:lib/persistent-mode-core/state-lock.ts:24`), 나머지 여섯 함수 — 소유자 읽기, stale 판정,
PID 생존 확인, stale 회수, 회수 가드, 해제 — 는 모듈 안에 숨는다. 원본 대비 실질 차이는 셋뿐이다.
① 상수 접두사가 `REVIEW_LOCK_*` 에서 `STATE_LOCK_*` 로 바뀌고 타입도 `ReviewLockOwner` →
`StateLockOwner` 로 개명됐다 (`head:lib/persistent-mode-core/state-lock.ts:12`). ② 전역
`crypto.randomUUID()` 대신 `node:crypto` 의 `randomUUID` 를 명시적으로 import 한다
(`head:lib/persistent-mode-core/state-lock.ts:9`). ③ 원본이 CLI 파일의 다른 헬퍼와 공유하던
`isErrnoException` · `isRecord` 를 모듈 안에 각각 다시 정의했다
(`head:lib/persistent-mode-core/state-lock.ts:56`). 재시도 100회, 대기 5ms, stale TTL 30초,
`owner.json` 파일명, 그리고 실패 시 던지는 문자열까지 원본과 같다.

**왜 필요한가** — 모듈의 doc 주석이 옮긴 이유를 스스로 말한다. 원본은
`[근거: "Minimal mkdir lock for every read-modify-write of this state file. A contention
timeout fails closed; we never perform an unlocked fallback after a lock error."]` 였는데,
새 모듈은 같은 문장이 `[근거: "Minimal mkdir lock for every read-modify-write of an ultragoal
state file. A contention timeout fails closed; callers never fall back to an unlocked write."]`
로 바뀌었다. `this state file` → `an ultragoal state file`, `we` → `callers`. 주어가 "이 파일"
에서 "호출자들"로 넘어간 것이 곧 범위 확장의 선언이다.

**시스템 효과** — 이 파일만 놓고 보면 시스템 동작은 아직 하나도 안 바뀐다. 아무도 아직 이
모듈을 부르지 않기 때문이다. 바뀐 것은 **가능성**이다. `tsconfig.json` 의 `"@lib/*": ["lib/*"]`
별칭 아래로 내려왔으므로, 이제 스킬 쪽은 `@lib/persistent-mode-core/state-lock` 으로, 훅 쪽은
상대 경로 `./state-lock.ts` 로 같은 함수에 닿는다. 던지는 에러 문자열이 여전히
`"ultragoal-state: state lock contended; refusing unlocked write"` 인 것도 의도적이다 —
모듈은 일반화됐지만 기존 테스트가 그 문자열로 계약을 붙잡고 있다.

**추적성** — `lib/persistent-mode-core/state-lock.ts:24`

---

## Change Group 2: 스킬 CLI에서 사본과 우회로를 동시에 없앤다

> 예고: 앞 그룹이 만든 `withStateLock` 을 import 하면서 CLI 안의 사적 사본 153줄을 지우고,
> 같은 파일 안에서 락은 잡았지만 병합 경로를 우회하던 마지막 쓰기 하나를 되돌린다.
> 순서: 앞 그룹이 공용 모듈을 이미 만들어 뒀기 때문에 여기서 사본을 삭제해도 CLI가 락을 잃지
> 않는다. 순서가 반대였다면 이 파일은 중간 상태에서 컴파일되지 않는다.

### `skills/ultragoal/scripts/ultragoal-state.ts`

**역할/변경 전 맥락** — ultragoal 상태 파일에 대한 스킬 쪽 단일 창구다. `mergeWrite` 가
락을 잡고 `mergeWriteLocked` 를 부르는 표준 경로였고 (`base:skills/ultragoal/scripts/ultragoal-state.ts:306`),
`resumePursuit` 만 예외적으로 락 안에서 원시 쓰기를 했다
(`base:skills/ultragoal/scripts/ultragoal-state.ts:849`). 락 구현 전체가 이 파일 안에 있었다
(`base:skills/ultragoal/scripts/ultragoal-state.ts:419`).

**무엇이 바뀌었나** — 두 가지다. 첫째, 락 코드 153줄이 통째로 사라지고 그 자리를 import 한
줄이 대신한다 (`head:skills/ultragoal/scripts/ultragoal-state.ts:62`). 삭제로 쓸모없어진
것들도 함께 정리됐다 — `node:fs` import가 일곱 개에서 `readFileSync, unlinkSync` 둘로 줄고,
`node:path` 의 `join` import와 `REVIEW_LOCK_RETRIES` 등 상수 셋이 빠졌다. 둘째,
`resumePursuit` 의 마지막 줄이 `writeFileNoCreate(stateFilePath, JSON.stringify(next, null, 2))`
에서 `mergeWriteLocked(sessionId, stateFilePath, { phase, active, iteration, budget_limit_notified })`
로 교체됐다 (`head:skills/ultragoal/scripts/ultragoal-state.ts:707`). 검증 3단 — 파일 부재,
파싱 실패, phase가 `budget_limited` 가 아님 — 은 그대로다.

**왜 필요한가** — 삭제 쪽은 자명하다. 같은 알고리즘 사본 둘이 남으면 한쪽만 고쳐지는 날이
온다. `resumePursuit` 쪽은 하트비트가 이유다.
`[근거: "Every genuine state writer (goal-state.ts, ultragoal-state.ts, prometheus-state.ts,
deep-interview-state.ts, qa-state.ts) calls this — both timestamps are always refreshed together
on any real write."]` — `mergeWithHeartbeat` 의 doc이 요구하는 계약이다. 원시 쓰기는
`mergeWithHeartbeat` 을 통과하지 않으므로 이 계약의 유일한 구멍이었다.

**시스템 효과** — `resume-pursuit` 로 복귀한 세션의 `last_touched_at` · `progress_touched_at`
가 이제 갱신된다. 두 타임스탬프는 각각 GC 생존 판정과 무진전 카운터의 축이므로, 갱신이
없으면 방금 되살린 세션이 낡은 타임스탬프를 그대로 들고 부활한다. 부작용도 하나 생겼다.
`mergeWriteLocked` 는 필드를 **열거해서** 병합하므로, 예전 스프레드 방식이 무심코 보존하던
"열거 목록에 없는 디스크상의 키"는 이제 떨어져 나간다. `UltragoalState` 가 `GoalState` 의 별칭
(`lib/persistent-mode-core/types.ts:130`)이고 열거 목록이 그 인터페이스를 덮으므로 현재 필드
집합에서는 실제 손실이 없다 — 다만 이건 지금의 스키마에 기댄 안전이다. 아래 열린 질문에 남긴다.

**추적성** — `skills/ultragoal/scripts/ultragoal-state.ts:707`

---

## Change Group 3: 훅 쪽 기록자를 처음으로 같은 락 아래에 넣는다

> 예고: 앞의 두 그룹으로 락은 공용 자리에 있고 스킬 쪽은 그 락만 쓴다. 이제 남은 마지막
> 무보호 기록자 — 훅이 부르는 `updateUltragoalState` — 를 같은 락 아래로 넣어, 이 커밋이
> 실제로 고치려던 경합을 닫는다.
> 순서: 이 그룹이 마지막 코드 변경인 이유는 앞의 둘이 끝나야 "같은 락"이라는 말이 성립하기
> 때문이다. 스킬 쪽이 아직 자기 사본을 쓰고 있었다면 여기서 잡는 락은 다른 락이고, 서로 다른
> 두 락은 상호 배제를 만들지 못한다.

### `lib/persistent-mode-core/state.ts`

**역할/변경 전 맥락** — `updateUltragoalState` 는 훅 쪽의 스프레드 오버레이 기록자다
(`base:lib/persistent-mode-core/state.ts:203`). 읽고 → JSON 파싱하고 → `{ ...raw, ...partial }`
에 타임스탬프를 얹어 다시 쓴다. 이 read-modify-write 전 구간이 **어떤 락도 없이** 돌았다.

**무엇이 바뀌었나** — import 한 줄이 늘고 (`head:lib/persistent-mode-core/state.ts:4`), 함수
본문 전체가 `withStateLock(path, () => { ... })` 콜백 안으로 들어갔다
(`head:lib/persistent-mode-core/state.ts:206`). 안쪽 로직 — 부재 파일 조기 반환, 파싱 실패
조기 반환, 빈 partial일 때 `backfillProgressTouchedAt` 을 쓰고 아니면 새 타임스탬프를 쓰는
분기, `ENOENT` 삼킴 — 은 한 글자도 바뀌지 않았다. 나머지 diff는 들여쓰기 이동이다.

**왜 필요한가** — 이 함수 바로 위 주석이 애초에 이 방향을 요구하고 있었다.
`[근거: "a second writer for ultragoal must stay just as strict"]` — 두 번째 기록자는 첫 번째
만큼 엄격해야 한다. 변경 전에는 "엄격함"이 no-create·no-seed 두 축만 가리켰고 상호 배제는
빠져 있었다. 이 커밋이 그 축을 채운다.

**시스템 효과** — 두 갈래다. **좋은 쪽**: Intuition의 t0–t2 시나리오에서 훅은 이제 t0에 락을
기다리므로, CLI가 넣은 `S2` 위에 낡은 스냅샷을 덮어쓸 수 없다. **대가**: 락이 100회 재시도
안에 안 풀리면 `updateUltragoalState` 가 던진다. 이 던짐은 그대로 위로 올라가지 않는다 —
호출자인 `decision.ts` 가 모든 호출을 try/catch로 감싸고 있고
(`[근거: "// M1: swallow write failure — STILL soft-stop."]` — `M1` 은 그 파일이 쓰는 내부
표기로, "상태 쓰기가 실패해도 차단 판정은 그대로 내린다"는 규칙을 가리킨다), 삼킨 뒤에도 차단 판정 자체는
그대로 내린다. 즉 경합이 나면 **`iteration` 증가가 유실될 뿐 훅의 판단은 무너지지 않는다.**
반대로 말하면 극단적 경합에서 반복 카운터가 실제보다 낮게 유지될 수 있고, 이는 무진전 예산
소진을 늦추는 방향으로만 틀린다.

**추적성** — `lib/persistent-mode-core/state.ts:206`

---

## Change Group 4: 세 경로의 새 계약을 실패하는 테스트로 고정한다

> 예고: 앞의 세 그룹이 만든 것 — 공용 락, 하트비트 갱신, 훅의 fail-closed — 각각에 대해
> 변경 전 코드에서는 반드시 실패했을 테스트를 붙인다. 테스트가 마지막인 이유는 여기서
> 고정하는 대상이 앞 세 그룹의 산출물 그 자체이기 때문이다.
> 순서: 앞 그룹들이 세 계약을 이미 코드로 세워 놨으므로, 이 그룹은 새 계약을 만들지 않고
> 이미 선 계약이 무너지는 것만 막는다.

### `lib/persistent-mode-core/state-lock.test.ts`

**역할/변경 전 맥락** — 존재하지 않던 파일이다. 락의 계약은 CLI 테스트가 간접적으로만
건드리고 있었다.

**무엇이 바뀌었나** — 락 모듈 자체를 직접 겨누는 테스트 셋이 생겼다. ① 살아 있는 주인이
잡은 락 앞에서는 콜백이 **아예 실행되지 않고** 던진다 — `called` 가 `false` 로 남고 락
디렉터리도 그대로 있는지까지 본다 (`head:lib/persistent-mode-core/state-lock.test.ts:30`).
② `owner.json` 없이 mtime만 31초 과거인 락은 회수된 뒤 콜백이 돌고 락이 사라진다
(`head:lib/persistent-mode-core/state-lock.test.ts:45`). ③ 콜백 안에서 `owner.json` 의 토큰을
`"successor"` 로 바꿔치기하면, 해제 단계가 **그 락을 지우지 않고 남긴다**
(`head:lib/persistent-mode-core/state-lock.test.ts:54`).

**왜 필요한가** — 세 번째가 특히 중요하다. 토큰 대조 없는 해제는 "내가 회수당한 뒤 다른
프로세스가 새로 잡은 락"을 지워 버리고, 그 순간 두 프로세스가 동시에 락을 가졌다고 믿는다.
`[근거: "Prevents stale recovery from racing a token-checked holder release."]`

**시스템 효과** — 락이 이제 자기 자신의 테스트를 가진 독립 단위가 됐다. 앞으로 세 번째
호출자가 생겨도 이 세 계약은 호출자와 무관하게 유지된다.

**추적성** — `lib/persistent-mode-core/state-lock.test.ts:30`

### `lib/persistent-mode-core/state.test.ts`

**역할/변경 전 맥락** — 기존 테스트는 `updateUltragoalState` 의 스프레드 오버레이가
SKILL 전용 필드를 보존하는지, 그리고 파일이 없을 때 아무것도 안 쓰는지를 봤다
(`base:lib/persistent-mode-core/state.test.ts:892`).

**무엇이 바뀌었나** — 둘이다. 기존 테스트의 픽스처에 `stories` 와
`approved_review_artifact_sha256` 을 넣고 갱신 후에도 그대로인지 단언을 추가했다. 그리고
새 테스트 하나가 붙었다 — 살아 있는 주인의 락을 미리 만들어 둔 상태에서
`updateUltragoalState` 를 부르면 `"ultragoal-state: state lock contended; refusing unlocked write"`
로 던지고, **파일 바이트가 원본과 한 글자도 다르지 않은지** 확인한다
(`head:lib/persistent-mode-core/state.test.ts:926`).

**왜 필요한가** — `[추론: 변경 전 코드에서 이 테스트는 반드시 실패한다. 훅 기록자가 락을 아예
보지 않았으므로 던지지도 않고 파일도 조용히 바뀐다. 던짐과 바이트 불변을 함께 단언하는 형태가
"fail-closed"의 정의 그 자체다 — 실패했는데 파일이 바뀌었다면 그건 fail-open이다.]`

**시스템 효과** — Change Group 3의 동작 변경이 회귀 불가능해졌다. 누가 락을 다시 벗겨도
이 테스트가 먼저 깨진다.

**추적성** — `lib/persistent-mode-core/state.test.ts:926`

### `skills/ultragoal/scripts/ultragoal-state.test.ts`

**역할/변경 전 맥락** — `resume-pursuit` 계약을 한 테스트에 여러 단언을 몰아 담고 있었다.
예를 들어 `base:skills/ultragoal/scripts/ultragoal-state.test.ts:1355` 는 `status` 출력과
`get` 의 fold 계약을 한 테스트에서 함께 봤다.

**무엇이 바뀌었나** — 실질은 **새 테스트 하나**다. `budget_limited` 상태 파일의
`last_touched_at` 과 `progress_touched_at` 을 `"2020-01-01T00:00:00"` 으로 강제로 낡게 만든 뒤
`resumePursuit` 을 호출하고, 두 값이 모두 그 문자열이 **아니게** 됐는지 확인한다
(`head:skills/ultragoal/scripts/ultragoal-state.test.ts:1375`). 나머지는 정리다 — 뭉쳐 있던
테스트를 쪼개고, 이름을 실제로 보는 것에 맞췄다. `"inactive-fold contract"` 는
`"active-fold contract"` 로, `"terminal lock survives refusal"` 은
`"terminal lock survives new seed attempt"` 로 바뀌었다.

**왜 필요한가** — `[추론: 이 테스트는 Change Group 2의 `resumePursuit` 교체가 없으면 실패한다.
원시 쓰기는 `{ ...prior }` 를 그대로 직렬화하므로 `2020-01-01T00:00:00` 이 그대로 살아남는다.
`mergeWriteLocked` 를 경유해야 `mergeWithHeartbeat` 이 두 타임스탬프를 함께 새로 찍는다.]`

**시스템 효과** — 하트비트 계약이 문서가 아니라 실행 가능한 형태로 고정됐다. 이름 정리는
동작에 영향이 없지만, 쪼개진 테스트는 실패했을 때 무엇이 깨졌는지를 한 줄로 말해 준다.

**추적성** — `skills/ultragoal/scripts/ultragoal-state.test.ts:1375`

---

## 열린 질문

문서를 쓰면서 diff·커밋 메시지·주석·인접 코드를 뒤졌지만 도달 가능한 근거가 없는 것들이다.
사용자에게 묻지 않고 여기 남긴다.

1. **`resumePursuit` 의 doc 주석이 이제 코드와 어긋난다.** 주석은 여전히
   `"This is deliberately a strict raw read/validate/write path: it never seeds or performs a
   generic merge."` 라고 말하는데(`head:skills/ultragoal/scripts/ultragoal-state.ts:695`),
   Change Group 2가 그 함수를 `mergeWriteLocked` 라는 generic merge 위로 옮겼다. `never seeds`
   는 여전히 참이다(`ensureSeed` 는 `mergeWrite` 쪽에만 있다). `never ... performs a generic
   merge` 는 이제 거짓이다. 주석을 함께 고쳤어야 했는지, 아니면 "generic merge" 가 다른 것을
   가리키는지 — **Unknown / not supplied.**
2. **필드 열거 방식의 장기 위험.** `mergeWriteLocked` 는 열거되지 않은 디스크상의 키를
   떨어뜨린다. 현재 스키마에서는 손실이 없지만, `resumePursuit` 이 이전에는 스프레드로
   무조건 보존하던 성질을 잃은 것은 사실이다. 이 교환이 의식적으로 받아들여진 것인지 —
   **Unknown / not supplied.** (`mergeWriteLocked` 안에는 "여기 열거하지 않으면 무관한 쓰기
   한 번에 조용히 지워진다"는 경고 주석이 `stories`·`codex_goal_objective`·
   `dismissed_review_findings` 세 곳에 반복해 붙어 있으므로, 저자가 이 함정 자체는 알고
   있었다는 정황은 있다.)
3. **경합 시 `iteration` 유실의 관측 가능성.** `decision.ts` 가 던짐을 삼키므로 락 경합으로
   반복 카운터가 유실돼도 로그·상태 어디에도 흔적이 남지 않는다. 이 무관측성이 의도인지
   — **Unknown / not supplied.**
4. **테스트 실행 결과 미확인.** 이 워크트리에는 `node_modules` 가 없어 `bun test` 를 돌리지
   않았다. 위에서 "변경 전에는 실패한다"고 쓴 두 건은 코드를 읽어 도출한 추론이고, 실행으로
   확인한 사실이 아니다.

---

## 부록 — 이해 확인 문항

총 **18문항 / 9개 개념**이다. 상한 20을 넘지 않았으므로 잘라낸 문항은 없다.
전부 서술형 단답이며 선택지는 없다. 채점 루브릭은 이 문서에 넣지 않고 같은 디렉터리의
`quiz-rubric.md` 에 분리해 뒀다 — 같은 문서 안에 두면 읽는 순간 정답이 노출된다.

### 개념 1 — Evidence 분류

1. 이 변경에서 noise로 분류된 파일 수와, 그 수가 그렇게 나온 판정 절차를 말해 보세요.
2. `lib/persistent-mode-core/state.ts` 의 diff는 상당 부분이 들여쓰기 이동인데도 signal로
   분류됐습니다. 그 들여쓰기가 왜 생겼고, 그 사실이 분류를 어떻게 바꿉니까?

### 개념 2 — 두 기록자

3. 이 상태 파일을 고치는 실행 주체 둘을 각각 무엇이라 부르고, 둘의 수명이 어떻게 다릅니까?
4. 변경 전 세 기록 경로 중 락과 하트비트를 **둘 다** 갖춘 것은 어느 것이었고, 나머지 둘은
   각각 무엇이 빠져 있었습니까?

### 개념 3 — 잃어버리는 값

5. Intuition의 t0–t2 시나리오에서 디스크에 최종적으로 남는 `iteration` 값과 `stories` 값을
   각각 말하고, 왜 그 조합이 되는지 설명해 보세요.
6. "락이 한쪽에만 있으면 락은 아무것도 막지 못한다"는 문장이 참인 이유를, 훅이 t2에 실제로
   쓰는 것이 무엇인지를 근거로 설명해 보세요.

### 개념 4 — 공용 자리의 선택

7. 락 모듈이 `lib/` 아래로 내려가야 했던 이유를 이 저장소의 설정 파일 하나를 근거로 들어
   설명해 보세요.
8. 스킬 쪽과 훅 쪽이 같은 함수를 부르는 데 쓰는 import 경로가 서로 다릅니다. 각각 무엇이고
   왜 다릅니까?

### 개념 5 — 옮기면서 무엇이 유지됐나

9. 락을 옮기면서 실질적으로 달라진 것 세 가지를 드세요.
10. 새 모듈은 일반화됐는데도 던지는 에러 문자열은 여전히 `ultragoal-` 로 시작합니다. 그
    문자열을 그대로 둔 것이 왜 의도적이라고 볼 수 있습니까?

### 개념 6 — 경합 시 실패 방식

11. 락을 못 잡았을 때 `withStateLock` 이 취하는 행동을, 재시도 파라미터 두 개를 포함해
    말해 보세요.
12. `state.test.ts` 에 추가된 새 테스트는 던짐 하나만 확인하지 않습니다. 함께 확인하는 것이
    무엇이고, 그것이 없으면 무엇을 놓치게 됩니까?

### 개념 7 — stale 회수

13. 락이 stale로 판정되는 조건 두 가지를 말하고, 시간 기준값을 포함하세요.
14. 해제 단계가 토큰을 대조하지 않으면 어떤 사고가 납니까? 해당 테스트가 쓰는 토큰 값을
    근거로 설명해 보세요.

### 개념 8 — resume-pursuit 의 하트비트

15. `resumePursuit` 의 마지막 쓰기가 무엇에서 무엇으로 바뀌었고, 그 교체가 어떤 두 타임스탬프를
    새로 갱신하게 만듭니까?
16. 새 테스트가 상태 파일에 강제로 심는 낡은 타임스탬프 문자열은 정확히 무엇이며, 테스트는
    그 값에 대해 무엇을 단언합니까?

### 개념 9 — 훅 쪽의 대가

17. 훅에서 락 경합이 나면 `decision.ts` 는 어떻게 반응하며, 그 반응 때문에 무엇이 유실되고
    무엇이 유지됩니까?
18. 그 유실이 시스템을 틀리게 만드는 방향은 한쪽뿐입니다. 어느 방향이며 왜 그렇습니까?

---

## 검증 메모

이 문서는 explain-diff 스킬의 `evidence → background → intuition → code → render` 순서와
각 스텝의 문서 형식 계약을 따라 작성했다. 실행 조건상 다음 둘은 수행하지 않았다.

아래에서 `R1`~`R7` 은 스킬의 `references/rubric.md` 가 정의한 루브릭 항목 번호다 — 스크립트가
판정하는 다섯(signal 파일 전수 등장, Change Group 구조, "왜"의 출처 표시, Background 2단 +
건너뛰기 마커, 추적성)과 심사자가 인용으로 판정하는 둘(Intuition의 구체 예시, 그룹 순서의 정합).

- **상태 CLI (`explain-diff-state.ts`) 미호출.** 따라서 스크립트가 판정하는 다섯 항목
  (`R1`–`R5`)과 `pass-step` 의 인용 문자열 대조는 기계로 돌리지 않았고, 아래 자가 확인으로
  대신했다.
- **심사 서브에이전트 미투입.** 심사자의 판정 JSON을 소비하는 유일한 지점이 `pass-step` 인데
  그 CLI가 범위 밖이므로, 판정을 받아도 착지할 곳이 없다. 심사자 몫인 두 항목
  (`R6`·`R7`)은 문서에서 직접 인용해 아래에 남긴다.
- **퀴즈 출제·채점 미진행.** 문항 뱅크까지만 만들고 대화 출제는 하지 않았다.

**`R6` — Intuition의 구체 예시.** toy 값이 등장하는 대목:
`{ "iteration": 7, "phase": "pursuing", "stories": [{ "id": "S1" }] }`.
그 값이 설명 문장에서 다시 쓰이는 대목:
`훅이 t2에 쓴 것은 \`iteration\` 하나가 아니다. t0에 읽은 객체 전체를 다시 직렬화한다. 그래서 그 사이에 CLI가 넣은 \`S2\` 는 흔적 없이 사라진다.`

**`R7` — 그룹 순서의 정합.** 각 그룹의 예고문이 앞 그룹을 전제하는 대목:

- Group 2 → Group 1: `앞 그룹이 만든 \`withStateLock\` 을 import 하면서 CLI 안의 사적 사본 153줄을 지우고`
- Group 3 → Group 2: `앞의 두 그룹으로 락은 공용 자리에 있고 스킬 쪽은 그 락만 쓴다.`
- Group 4 → Group 3: `앞의 세 그룹이 만든 것 — 공용 락, 하트비트 갱신, 훅의 fail-closed — 각각에 대해`

**`R1`(signal 파일 전수 등장) 자가 확인.** signal 6개 파일이 각각 정확히 한 Change Group에 한 번씩 `###` 헤딩으로
등장한다 — Group 1에 1개, Group 2에 1개, Group 3에 1개, Group 4에 3개.

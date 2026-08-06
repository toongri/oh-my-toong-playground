# ultragoal 상태 갱신 락 통합 — `bcd493b1`

- 대상 range: `bcd493b1^..bcd493b1`
- 커밋: `fix: ultragoal 상태 갱신 락 통합` (toongri, 2026-08-05)
- 규모: 6개 파일, +305 / −170

---

## Evidence

`git diff --name-status bcd493b1^..bcd493b1` 결과 전수다. 6개 파일 전부 signal이며 noise로 분류한 파일은 없다.

| 파일 | 상태 | 분류 | 근거 |
|---|---|---|---|
| `lib/persistent-mode-core/state-lock.ts` | `A` (신규) | **signal** | 이 변경의 새 공용 모듈 본체 |
| `lib/persistent-mode-core/state.ts` | `M` | **signal** | 지금까지 락 없이 쓰던 경로가 락 안으로 들어감 |
| `skills/ultragoal/scripts/ultragoal-state.ts` | `M` | **signal** | 사설 락 구현 153줄 삭제 + `resumePursuit` 쓰기 경로 교체 |
| `lib/persistent-mode-core/state-lock.test.ts` | `A` (신규) | **signal** | 락 계약(실패-닫힘·stale 회수·토큰 릴리스)을 고정 |
| `lib/persistent-mode-core/state.test.ts` | `M` | **signal** | 락 경합 시 바이트 불변을 새로 주장 |
| `skills/ultragoal/scripts/ultragoal-state.test.ts` | `M` | **signal** | `resume-pursuit` 테스트 분할 + heartbeat 갱신 주장 추가 |

**신규 추가(`A`) 파일 2개**: `lib/persistent-mode-core/state-lock.ts`, `lib/persistent-mode-core/state-lock.test.ts`. 이 둘은 변경 전 위치가 존재하지 않으므로 아래 Code 섹션에서 `head:` 앵커만 갖는다.

**noise 규칙표 적용 결과**: `*.lock`, `dist/`, `__snapshots__/`, `*.generated.*` 에 해당하는 경로는 하나도 없다. 포맷팅만 바뀐 hunk 후보가 하나 있었다 — `lib/persistent-mode-core/state.ts` 의 27줄이 들여쓰기 한 단계씩 밀렸다. 그러나 그 들여쓰기는 본문 전체를 콜백으로 감싼 결과이므로 포맷팅이 아니라 의미 변경이다. noise가 아니다.

---

## Background

### 깊은 배경

이미 익숙하면 건너뛰세요.

**oh-my-toong(OMT)** 은 여러 AI CLI(Claude Code, Codex CLI, Gemini CLI)에 스킬·훅·에이전트를 배포하는 설정 관리 시스템이다. 이 변경이 사는 곳을 이해하려면 세 가지만 알면 된다.

**1. ultragoal — 자율 목표 추적 실행기.** 사용자가 목표(objective)를 주면, 스킬이 그것을 여러 story로 쪼개고 story 하나씩 순차로 추적한다. 그 추적의 전 과정이 세션마다 하나씩 있는 JSON 파일에 들어 있다.

```
$OMT_DIR/ultragoal-state-<sessionId>.json
```

이 파일에는 `phase`(planning/pursuing/budget_limited/blocked/complete), `iteration`(무진전 카운터), `stories`(story 배열), `dismissed_review_findings`(사용자가 기각한 리뷰 지적), `approved_review_artifact_sha256` 같은 것들이 함께 들어 있다. 슬롯이 한 파일에 모여 있다는 점이 이 변경의 전제다.

**2. 훅 — AI가 아니라 하네스가 실행하는 셸/JS 스크립트.** Claude Code는 세션 수명 주기의 정해진 지점(도구 호출 직전 `PreToolUse`, 턴이 끝나려 할 때 `Stop` 등)에서 훅을 실행한다. `persistent-mode` 훅은 그중 `Stop` 자리에 붙어서 "아직 할 일이 남았는데 멈추려 하는가"를 판정하고, 그 판정 결과를 위 상태 파일에 되쓴다.

**3. 그래서 이 파일에는 쓰는 주체가 둘이다.**

| 쓰는 주체 | 코드 위치 | 언제 |
|---|---|---|
| ultragoal CLI | `skills/ultragoal/scripts/ultragoal-state.ts` | AI나 사용자가 `set`, `dismiss-review-finding`, `resume-pursuit` 같은 서브커맨드를 실행할 때 |
| persistent-mode 훅 | `lib/persistent-mode-core/state.ts` 의 `updateUltragoalState` | 턴이 끝나려 할 때마다 (`lib/persistent-mode-core/decision.ts` 에서 호출) |

두 주체는 **서로 다른 OS 프로세스**다. 같은 파일에 대해 각자 읽고-고치고-쓴다.

### 좁은 배경

이 변경이 직접 닿는 것은 그 "읽고-고치고-쓰기"(read-modify-write)의 원자성이다.

변경 전, ultragoal CLI 쪽에는 이미 락이 있었다. `mkdir`은 POSIX에서 원자적이고 이미 존재하면 `EEXIST`로 실패한다는 성질을 이용한, 잠금 디렉터리 방식이다. `ultragoal-state.ts` 안에 `withStateLock`이라는 이름으로 153줄쯤 들어 있었고 다음을 다뤘다.

- 경합하면 5ms씩 최대 100번 재시도하고, 그래도 못 잡으면 **던진다** — 락 없이 쓰는 대체 경로는 없다
- 락 디렉터리 안 `owner.json`에 `ownerPid`·`token`·`startedAt`을 기록해, 소유 프로세스가 죽었거나 30초가 지난 락은 stale로 보고 회수한다
- 릴리스할 때 `owner.json`의 `token`이 자기 것일 때만 지운다 — 이미 다른 프로세스가 잡은 후속 락을 지우지 않기 위해서다

반면 훅 쪽 `updateUltragoalState`에는 락이 **없었다**. 같은 파일을 같은 방식으로 읽고 고치고 쓰는데 한쪽만 잠갔다.

한 가지 더. `updateUltragoalState`는 스프레드 오버레이 방식이다 — 디스크에서 읽은 `raw` 전체 위에 `partial`을 얹어 쓴다. 그래서 자기가 모르는 필드(`stories`, `dismissed_review_findings` 등)도 통째로 보존된다. **자기가 읽은 시점의 값이 여전히 최신이라는 전제 하에서만** 그렇다. 이 전제가 무너지는 자리가 정확히 이 커밋이 고치는 곳이다.

---

## Intuition

본질은 한 문장이다. **한쪽만 잠그는 락은 락이 아니다.**

구체적인 값으로 그려 보자. 세션 `abc123`의 상태 파일에 지금 `iteration: 1` 이 들어 있고, `stories` 배열에는 `S1` 하나가 confirmed 상태로 들어 있다고 하자.

### 그림 1 — Before / After 나란히

<table style="width:100%;border-collapse:collapse;font-size:13px">
<tr>
<th style="width:50%;border:1px solid #bbb;padding:8px;background:#fbe9e7;text-align:left">변경 전 — 락이 CLI 안에만 있다</th>
<th style="width:50%;border:1px solid #bbb;padding:8px;background:#e8f5e9;text-align:left">변경 후 — 락이 공용 모듈에 있다</th>
</tr>
<tr>
<td style="border:1px solid #bbb;padding:10px;vertical-align:top">
<div style="border:2px solid #c62828;border-radius:6px;padding:8px;margin-bottom:8px">
<b>ultragoal-state.ts</b><br>
<span style="color:#555">사설 <code>withStateLock</code> (153줄)</span><br>
<span style="color:#2e7d32">🔒 잠그고 쓴다</span>
</div>
<div style="border:2px dashed #c62828;border-radius:6px;padding:8px">
<b>state.ts</b> <code>updateUltragoalState</code><br>
<span style="color:#555">락 코드 없음</span><br>
<span style="color:#c62828">🔓 그냥 쓴다</span>
</div>
<div style="text-align:center;margin-top:8px;color:#c62828">↓ 둘 다 같은 파일 ↓</div>
<div style="text-align:center;border:1px solid #888;padding:6px;background:#fff"><code>ultragoal-state-abc123.json</code></div>
</td>
<td style="border:1px solid #bbb;padding:10px;vertical-align:top">
<div style="text-align:center;border:2px solid #2e7d32;border-radius:6px;padding:8px;background:#fff;margin-bottom:8px">
<b>state-lock.ts</b> — <code>withStateLock</code> (신규·유일)
</div>
<div style="display:flex;gap:6px">
<div style="flex:1;border:2px solid #2e7d32;border-radius:6px;padding:8px">
<b>ultragoal-state.ts</b><br><span style="color:#2e7d32">🔒 import</span>
</div>
<div style="flex:1;border:2px solid #2e7d32;border-radius:6px;padding:8px">
<b>state.ts</b><br><span style="color:#2e7d32">🔒 import</span>
</div>
</div>
<div style="text-align:center;margin-top:8px;color:#2e7d32">↓ 같은 락 디렉터리를 경유 ↓</div>
<div style="text-align:center;border:1px solid #888;padding:6px;background:#fff"><code>ultragoal-state-abc123.json</code></div>
</td>
</tr>
</table>

### 그림 2 — 데이터 흐름 + 예시 값 (변경 전에 실제로 잃는 것)

<table style="width:100%;border-collapse:collapse;font-size:13px">
<tr>
<th style="border:1px solid #bbb;padding:6px;background:#eceff1">시각</th>
<th style="border:1px solid #bbb;padding:6px;background:#e3f2fd">CLI 프로세스 (락 잡음)</th>
<th style="border:1px solid #bbb;padding:6px;background:#fbe9e7">훅 프로세스 (락 안 잡음)</th>
<th style="border:1px solid #bbb;padding:6px;background:#eceff1">디스크</th>
</tr>
<tr>
<td style="border:1px solid #bbb;padding:6px">t0</td>
<td style="border:1px solid #bbb;padding:6px">🔒 락 획득</td>
<td style="border:1px solid #bbb;padding:6px"></td>
<td style="border:1px solid #bbb;padding:6px"><code>iteration: 1</code><br><code>dismissed: []</code></td>
</tr>
<tr>
<td style="border:1px solid #bbb;padding:6px">t1</td>
<td style="border:1px solid #bbb;padding:6px">읽음 → <code>iteration: 1</code></td>
<td style="border:1px solid #bbb;padding:6px;background:#ffebee"><b>읽음 → <code>dismissed: []</code></b></td>
<td style="border:1px solid #bbb;padding:6px">그대로</td>
</tr>
<tr>
<td style="border:1px solid #bbb;padding:6px">t2</td>
<td style="border:1px solid #bbb;padding:6px">씀 → <code>dismissed: ["F1"]</code></td>
<td style="border:1px solid #bbb;padding:6px"></td>
<td style="border:1px solid #bbb;padding:6px;background:#e8f5e9"><code>dismissed: ["F1"]</code> ✅</td>
</tr>
<tr>
<td style="border:1px solid #bbb;padding:6px">t3</td>
<td style="border:1px solid #bbb;padding:6px">🔓 락 반납</td>
<td style="border:1px solid #bbb;padding:6px;background:#ffebee"><b>씀 → <code>iteration: 2</code></b><br>(t1에 읽은 <code>dismissed: []</code>를 함께 되씀)</td>
<td style="border:1px solid #bbb;padding:6px;background:#ffcdd2"><code>iteration: 2</code><br><code>dismissed: []</code> ❌ <b>소실</b></td>
</tr>
</table>

훅이 t1에 읽은 것은 `dismissed: []` 였다. 훅은 `iteration` 만 고치려 했지만, 스프레드 오버레이는 t1 시점의 스냅샷 **전체**를 되쓴다. 그래서 t2에 CLI가 기록한 `["F1"]`이 t3에 사라진다 — 훅은 `dismissed`라는 필드를 건드릴 생각도 없었는데 지운다. `iteration: 1 → 2` 라는 한 필드 갱신이 다른 필드를 되감는다는 것, 이게 이 커밋이 없애는 현상이다.

### 그림 3 — 파일/모듈 지도

<table style="width:100%;border-collapse:collapse;font-size:13px">
<tr>
<td style="border:1px solid #bbb;padding:10px;vertical-align:top;width:50%;background:#fafafa">
<b>변경 전</b><br><br>
<code>lib/persistent-mode-core/</code><br>
&nbsp;&nbsp;├ <code>state.ts</code> <span style="color:#c62828">(락 없음)</span><br>
&nbsp;&nbsp;└ <code>decision.ts</code><br><br>
<code>skills/ultragoal/scripts/</code><br>
&nbsp;&nbsp;└ <code>ultragoal-state.ts</code> <span style="color:#ef6c00">(락 구현 내장)</span>
</td>
<td style="border:1px solid #bbb;padding:10px;vertical-align:top;width:50%;background:#f1f8e9">
<b>변경 후</b><br><br>
<code>lib/persistent-mode-core/</code><br>
&nbsp;&nbsp;├ <b><code>state-lock.ts</code></b> <span style="color:#2e7d32">← 신규·유일한 구현</span><br>
&nbsp;&nbsp;├ <b><code>state-lock.test.ts</code></b> <span style="color:#2e7d32">← 신규</span><br>
&nbsp;&nbsp;├ <code>state.ts</code> <span style="color:#2e7d32">→ import</span><br>
&nbsp;&nbsp;└ <code>decision.ts</code><br><br>
<code>skills/ultragoal/scripts/</code><br>
&nbsp;&nbsp;└ <code>ultragoal-state.ts</code> <span style="color:#2e7d32">→ import</span>
</td>
</tr>
</table>

### 그림 4 — 락 디렉터리의 상태 전이

<table style="width:100%;border-collapse:collapse;font-size:13px">
<tr>
<td style="border:1px solid #bbb;padding:8px;text-align:center;background:#e8f5e9">
<b>FREE</b><br><code>.lock</code> 없음
</td>
<td style="border:none;padding:8px;text-align:center">— <code>mkdirSync</code> 성공 →</td>
<td style="border:1px solid #bbb;padding:8px;text-align:center;background:#e3f2fd">
<b>HELD</b><br><code>.lock/owner.json</code><br><code>{ownerPid, token, startedAt}</code>
</td>
</tr>
<tr>
<td colspan="3" style="border:none;padding:4px"></td>
</tr>
<tr>
<td style="border:1px solid #bbb;padding:8px;text-align:center;background:#fff3e0">
<b>CONTENDED</b><br><code>EEXIST</code> → 5ms 대기 후 재시도
</td>
<td style="border:none;padding:8px;text-align:center">← 100회 소진 —</td>
<td style="border:1px solid #bbb;padding:8px;text-align:center;background:#ffcdd2">
<b>FAIL-CLOSED</b><br><code>throw</code> — 쓰지 않는다
</td>
</tr>
<tr>
<td colspan="3" style="border:none;padding:4px"></td>
</tr>
<tr>
<td style="border:1px solid #bbb;padding:8px;text-align:center;background:#fff3e0">
<b>STALE</b><br>owner 죽음 <b>또는</b> mtime + 30,000ms &lt; now
</td>
<td style="border:none;padding:8px;text-align:center">— rename 후 삭제 →</td>
<td style="border:1px solid #bbb;padding:8px;text-align:center;background:#e8f5e9">
<b>FREE</b><br>회수됨
</td>
</tr>
</table>

경합 상한을 계산해 보면 재시도 100회 × 대기 5ms ≈ **0.5초**다. 그 안에 못 잡으면 `FAIL-CLOSED` 로 간다 — 즉 앞의 그림 2에서 훅이 t3에 하던 무단 쓰기가, 변경 후에는 아예 일어나지 않고 예외가 된다. `iteration: 2` 는 기록되지 않고 디스크는 `iteration: 1` 그대로 남는다.

---

## Change Group 1: 락 구현을 공용 모듈로 승격한다

> 예고: ultragoal CLI 안에 갇혀 있던 락 구현을 `lib/`의 독립 모듈로 꺼내, 두 프로세스가 같은 코드를 가리킬 수 있게 만든다.
> 순서: 이 그룹이 먼저다 — 잠글 대상이 아니라 자물쇠 자체를 어디에 둘지가 정해지지 않으면, 뒤따르는 두 호출자가 "무엇을 공유하는지" 를 말할 수 없다.

### `lib/persistent-mode-core/state-lock.ts`

**역할/변경 전 맥락** — 이 파일은 이 커밋에서 처음 생겼다. **신규 추가 파일이므로 변경 전 위치가 존재하지 않는다** (`git diff --name-status`가 `A`로 표시). 다만 내용은 무에서 나온 것이 아니라 `skills/ultragoal/scripts/ultragoal-state.ts`의 base:424 에 있던 `withStateLock` 이하 153줄을 옮겨 온 것이다.

**무엇이 바뀌었나** — 157줄짜리 모듈 하나가 생겼고, 유일한 `export`가 `withStateLock<T>(stateFilePath, callback)` 이다. 변경 후 위치: `head:lib/persistent-mode-core/state-lock.ts:24`. 나머지 7개 함수(`readStateLockOwner` head:64, `isStateLockStale` head:84, `isPidAlive` head:94, `recoverStaleStateLock` head:104, `withStateLockRecoveryGuard` head:119, `isolateAndRemoveStaleLock` head:140, `releaseStateLock` head:151)는 전부 모듈 내부에 갇힌다. 상수도 이름이 `REVIEW_LOCK_*` 에서 `STATE_LOCK_*` 으로 바뀌었다 — `STATE_LOCK_RETRIES = 100` (head:12), `STATE_LOCK_RETRY_MS = 5` (head:13), `STATE_LOCK_STALE_TTL_MS = 30_000` (head:15). 한 군데 실질 변경이 있다: 전역 `crypto.randomUUID()` 를 쓰던 자리가 `import { randomUUID } from "node:crypto"` 로 바뀌었다 (head:9, 사용처 head:27·head:141).

**왜 필요한가** — 모듈 최상단 독스트링이 이 락이 무엇을 보장하는지 그대로 적고 있다. [근거: "Minimal mkdir lock for every read-modify-write of an ultragoal state file. A contention timeout fails closed; callers never fall back to an unlocked write."] 원본 문구는 대상을 `this state file`, 주체를 `we`라고 썼는데(base:401-404 의 "Minimal mkdir lock for every read-modify-write of this state file. A contention timeout fails closed; we never perform an unlocked fallback after a lock error."), 옮기면서 `an ultragoal state file` 과 `callers` 로 바뀌었다. 파일 하나의 사설 장치에서 여러 호출자의 공용 계약으로 신분이 바뀐 것이 문구에 반영돼 있다. 전역 `crypto` 대신 명시적 import를 쓴 이유는 문서화돼 있지 않다. [추론: 전역 `crypto` 객체는 런타임마다 노출이 다르고, `CLAUDE.md`의 Cross-Runtime Caveat이 codex·gemini에서 도는 스크립트에 node 내장 모듈 사용을 요구한다 — 공용 `lib/` 로 내려가면서 그 제약의 사정권에 들어왔다]

**시스템 효과** — 락 정책이 단일 정의 지점을 갖는다. TTL 30초, 재시도 100회, 토큰 체크 릴리스가 이제 한 파일에만 있으므로, 한쪽만 고쳐서 두 프로세스의 락 해석이 갈라지는 사고가 구조적으로 불가능해진다.

**추적성** — `lib/persistent-mode-core/state-lock.ts:24`, `lib/persistent-mode-core/state-lock.ts:53`

---

## Change Group 2: 두 호출자를 그 하나의 락 아래로 모은다

> 예고: 그룹 1이 만든 단일 `withStateLock`을 이제 실제로 붙잡는 쪽을 본다 — 이미 잠그고 있던 CLI는 자기 사본을 버리고 그것을 import 하고, 한 번도 잠근 적 없던 훅 경로는 처음으로 그 안으로 들어간다.
> 순서: 그룹 1에서 락이 `lib/`의 공용 모듈로 올라갔기 때문에 비로소 두 파일이 **같은** 구현을 가리킬 수 있다 — 순서를 뒤집으면 훅이 `skills/` 안쪽을 역참조해야 해서 의존 방향이 뒤집힌다.

### `skills/ultragoal/scripts/ultragoal-state.ts`

**역할/변경 전 맥락** — ultragoal 스킬의 상태 CLI다. `set`, `dismiss-review-finding`, `resume-pursuit` 등 모든 서브커맨드의 쓰기가 이 파일을 지난다. 변경 전에는 락 구현 전체를 자기 안에 들고 있었다. 변경 전 위치: `base:skills/ultragoal/scripts/ultragoal-state.ts:424` (`withStateLock` 정의), `base:skills/ultragoal/scripts/ultragoal-state.ts:143` (`REVIEW_LOCK_RETRIES` 등 상수), `base:skills/ultragoal/scripts/ultragoal-state.ts:848` (`resumePursuit`의 직접 쓰기).

**무엇이 바뀌었나** — 두 가지다. **(a)** 락 관련 153줄이 통째로 사라지고 한 줄 import로 대체됐다: 변경 후 위치 `head:skills/ultragoal/scripts/ultragoal-state.ts:62`. 딸려서 `node:fs` import가 7개 심볼(`mkdirSync`·`renameSync`·`rmSync`·`statSync`·`writeFileSync` 포함)에서 `readFileSync, unlinkSync` 둘로 줄었고, `node:path`의 `join` import는 통째로 사라졌다. **(b)** `resumePursuit`의 쓰기 방식이 바뀌었다: `const next = { ...prior, phase: "pursuing", ... }` 를 만들어 `writeFileNoCreate` 로 직접 내려쓰던 것(base:848-849)이, 같은 네 필드를 `mergeWriteLocked` 에 넘기는 형태로 바뀌었다. 변경 후 위치: `head:skills/ultragoal/scripts/ultragoal-state.ts:707`.

**왜 필요한가** — (a)의 이유는 커밋 제목 그 자체다. [근거: "fix: ultragoal 상태 갱신 락 통합"] (b)는 커밋 메시지에 설명이 없다. [추론: `mergeWriteLocked`는 자기 계약을 `head:...:297` 의 주석으로 명시한다 — "Caller must hold the per-session state lock." — 즉 락 안에서만 불리도록 설계된 함수이고, `resumePursuit`는 이미 `withStateLock` 안(head:699)에 있으므로 그 전제를 만족한다. 그리고 `mergeWriteLocked`는 끝에서 `mergeWithHeartbeat`(`lib/state-core.ts:143`)를 통과하며 `last_touched_at`·`progress_touched_at`을 현재 시각으로 새로 찍는데, 기존의 `{ ...prior, ... }` 스프레드는 디스크에 있던 낡은 타임스탬프를 그대로 되씀. 그룹 3의 새 테스트가 정확히 이 차이를 주장한다]

**시스템 효과** — ultragoal CLI 쪽 동작은 락 측면에서는 그대로다(같은 정책을 다른 파일에서 가져올 뿐). 실질 변화는 `resume-pursuit` 에 있다 — 이 경로가 이제 일반 병합 경로의 필드 기본값 보정(예: 손상된 `max_iterations` 를 `DEFAULT_MAX_ITERATIONS` 로 되돌림)과 heartbeat 갱신을 함께 받는다. 낡은 `last_touched_at` 을 안고 재개하던 상태가 TTL 판정에서 죽은 것으로 보일 여지가 사라진다.

**추적성** — `skills/ultragoal/scripts/ultragoal-state.ts:62`, `skills/ultragoal/scripts/ultragoal-state.ts:707`

### `lib/persistent-mode-core/state.ts`

**역할/변경 전 맥락** — persistent-mode 훅이 상태 파일을 읽고 쓰는 곳이다. 이 커밋이 건드리는 함수는 `updateUltragoalState` 하나로, `lib/persistent-mode-core/decision.ts` 의 5개 지점(:399, :422, :438, :454, :486)에서 호출된다. 변경 전에는 이 함수가 락 없이 읽고-고치고-썼다. 변경 전 위치: `base:lib/persistent-mode-core/state.ts:203` (함수 선언), `base:lib/persistent-mode-core/state.ts:205` (`readFileOrNull(path)`), `base:lib/persistent-mode-core/state.ts:219` (`writeFileNoCreate`).

**무엇이 바뀌었나** — 함수 본문 전체 — 읽기·JSON 파싱·`progressPatch` 계산·`writeFileNoCreate` — 가 `withStateLock(path, () => { … })` 콜백 안으로 들어갔다. 변경 후 위치: `head:lib/persistent-mode-core/state.ts:206`. import 한 줄이 늘었다: `head:lib/persistent-mode-core/state.ts:4`. 로직 자체는 한 줄도 바뀌지 않았다 — 27줄이 들여쓰기 한 단계씩 밀린 것과, prettier가 삼항식을 세 줄로 재배치한 것이 diff의 나머지 전부다.

**왜 필요한가** — 이 함수 위 주석이 스스로를 두 번째 쓰기 주체로 정의하고 있다. [근거: "Strict spread-overlay writer, mirroring updateGoalState (see its comment for the no-create/no-seed rationale — a second writer for ultragoal must stay just as strict — including the empty-partial-vs-genuine-write progress_touched_at split)."] 주석은 `a second writer` 라고 못 박으면서 `just as strict` 를 요구하는데, 변경 전 이 함수에는 CLI 쪽이 갖고 있던 락이 없었다. 스프레드 오버레이 방식은 자기가 읽은 스냅샷 전체를 되쓰므로, 락 없는 두 번째 writer는 자기가 건드리지도 않은 필드를 되감는다.

**시스템 효과** — 훅과 CLI가 하나의 락 디렉터리(`<상태파일>.lock`)를 두고 직렬화된다. Intuition 그림 2의 t3 시나리오 — 훅이 `iteration: 2` 를 쓰면서 CLI가 방금 기록한 `dismissed: ["F1"]` 을 지우는 일 — 이 물리적으로 불가능해진다. 대신 새 실패 모드가 생긴다: 경합이 0.5초 안에 안 풀리면 이 함수는 조용히 넘어가지 않고 **던진다**. 락 없는 쓰기로 후퇴하는 경로는 없다.

**추적성** — `lib/persistent-mode-core/state.ts:206`

---

## Change Group 3: 그 불변식을 깨지면 빨개지는 테스트로 고정한다

> 예고: 그룹 2가 선언한 두 가지 — 훅 경로가 경합에서 실패-닫힘한다는 것과 `resume-pursuit` 의 쓰기가 일반 병합 경로로 옮겨 갔다는 것 — 를 각각 실행 가능한 주장으로 바꾼다.
> 순서: 마지막이어야 한다 — 테스트가 주장하는 계약 문구는 그룹 1이 정한 예외 메시지와 그룹 2가 옮긴 호출 지점을 그대로 인용하므로, 앞의 둘이 확정되기 전에는 무엇을 주장할지 자체가 정해지지 않는다.

### `lib/persistent-mode-core/state-lock.test.ts`

**역할/변경 전 맥락** — 이 커밋에서 처음 생겼다. **신규 추가 파일이므로 변경 전 위치가 없다** (`A`). 변경 전에는 락 구현이 `ultragoal-state.ts` 안에 비공개로 있었으므로 락만 따로 겨냥한 단위 테스트가 존재할 자리 자체가 없었다.

**무엇이 바뀌었나** — 65줄, 테스트 3개가 새로 생겼다. 세 개가 각각 그림 4의 서로 다른 전이를 하나씩 잡는다. **(1)** 살아 있는 소유자의 락이 걸려 있으면 콜백이 **한 번도 실행되지 않은 채** 던지고 락 디렉터리는 그대로 남는다 — 변경 후 위치 `head:lib/persistent-mode-core/state-lock.test.ts:30`. **(2)** owner 파일 없이 mtime만 31초 과거인 락은 stale로 회수되고 콜백이 정상 실행된다 — `head:lib/persistent-mode-core/state-lock.test.ts:45`. **(3)** 콜백 실행 중 `owner.json` 의 토큰이 `"successor"` 로 바뀌면 릴리스가 그 락을 **지우지 않는다** — `head:lib/persistent-mode-core/state-lock.test.ts:54`.

**왜 필요한가** — (3)이 겨냥하는 위험을 구현 쪽 주석이 이름 붙여 두었다. [근거: "Prevents stale recovery from racing a token-checked holder release."] 후속 소유자의 락을 잘못 지우는 것이 이 락 설계에서 가장 조용한 실패이고, 그것을 잡는 검사는 토큰이 바뀌었을 때 디렉터리가 살아남는지를 보는 것 말고는 없다. 관련해서 `recoverStaleStateLock` 쪽에도 같은 위험이 반대 방향으로 적혀 있다. [근거: "Serializes stale recovery so a second observer cannot rename a successor lock."]

**시스템 효과** — 락 정책이 이제 호출자를 통하지 않고 직접 검증된다. TTL을 30초에서 바꾸거나 토큰 체크를 빼면 CLI나 훅을 거치지 않고도 이 파일에서 먼저 빨개진다.

**추적성** — `lib/persistent-mode-core/state-lock.test.ts:30`

### `lib/persistent-mode-core/state.test.ts`

**역할/변경 전 맥락** — persistent-mode 상태 함수들의 테스트다. `updateUltragoalState` 에 대해서는 스프레드 오버레이가 SKILL 전용 필드를 보존하는지, 파일이 없으면 아무것도 만들지 않는지를 이미 검사하고 있었다. 변경 전 위치: `base:lib/persistent-mode-core/state.test.ts:892`.

**무엇이 바뀌었나** — 두 가지다. 기존 보존 테스트에 필드 두 개가 추가됐다 — `stories: [{ id: "S1", story: "Keep this", status: "confirmed" }]` 와 `approved_review_artifact_sha256: "unchanged-hash"` 를 미리 심어 두고, `iteration: 3` 갱신 후에도 둘 다 그대로인지 본다 (`head:lib/persistent-mode-core/state.test.ts:892`). 그리고 테스트 하나가 새로 붙었다: 살아 있는 소유자 락을 미리 만들어 둔 뒤 `updateUltragoalState(sessionId, { iteration: 2 })` 를 부르면 던지고, **파일 바이트가 한 글자도 변하지 않는지** 확인한다 — `head:lib/persistent-mode-core/state.test.ts:926`.

**왜 필요한가** — 새 테스트의 이름이 주장 전체를 담고 있다. [근거: "ultragoal: updateUltragoalState fails closed under fresh lock contention without changing bytes"] 그룹 2에서 훅 경로에 도입한 실패-닫힘이 "예외를 던진다"에서 끝나면 절반만 증명한 것이다 — 던지기 전에 부분 쓰기를 남겼는지가 진짜 위험이고, 바이트 동일성 검사가 그것을 닫는다. 보존 필드를 `stories`·`approved_review_artifact_sha256` 로 고른 이유는 명시돼 있지 않다. [추론: `mergeWriteLocked` 안에서 이 두 필드가 특별 취급을 받는다 — "stories MUST be enumerated here or silently dropped on every non-story write." 라는 경고가 `head:skills/ultragoal/scripts/ultragoal-state.ts:330` 에 붙어 있다. 즉 조용한 소실 이력이 있는 필드를 골라 훅 쪽에서도 같은 사고가 나지 않는지 보는 것]

**시스템 효과** — Intuition 그림 2의 정확한 반대편이 실행 가능한 주장이 된다. `iteration: 1` 을 `2` 로 올리려는 갱신이 락에 막히면 디스크는 `iteration: 1` 인 채로 온전히 남는다.

**추적성** — `lib/persistent-mode-core/state.test.ts:926`

### `skills/ultragoal/scripts/ultragoal-state.test.ts`

**역할/변경 전 맥락** — ultragoal CLI 테스트다. `resume-pursuit` 관련 테스트가 `recovery-and-guards: resume-pursuit` 블록에 모여 있었고, 테스트 하나가 여러 주장을 묶어 들고 있었다. 변경 전 위치: `base:skills/ultragoal/scripts/ultragoal-state.test.ts:1355` ("status shows budget_limited while get keeps inactive-fold contract"), `base:skills/ultragoal/scripts/ultragoal-state.test.ts:1361`, `base:skills/ultragoal/scripts/ultragoal-state.test.ts:1371`, `base:skills/ultragoal/scripts/ultragoal-state.test.ts:1386`.

**무엇이 바뀌었나** — 실질 추가는 테스트 하나다. `last_touched_at` 과 `progress_touched_at` 을 둘 다 `"2020-01-01T00:00:00"` 으로 낡게 만들어 둔 뒤 `resumePursuit(S)` 를 부르고, 두 값이 모두 그 문자열이 **아니게** 됐는지 확인한다 — 변경 후 위치 `head:skills/ultragoal/scripts/ultragoal-state.test.ts:1375`. 나머지는 이름 정리다. 묶여 있던 테스트가 둘로 갈라졌고(`head:…:1355` 와 `head:…:1360`), 세 개의 제목이 다시 쓰였다(`head:…:1365`, `head:…:1388`, `head:…:1403`). 갈라진 것과 이름이 바뀐 것들의 **본문 로직은 그대로다**.

**왜 필요한가** — 새 테스트는 그룹 2에서 `resumePursuit` 이 `mergeWriteLocked` 로 옮겨 간 결과를 직접 겨눈다. [추론: 옛 경로의 `{ ...prior, phase: "pursuing", … }` 는 디스크에서 읽은 타임스탬프를 그대로 되쓰므로 이 테스트가 base에서는 실패한다 — `mergeWithHeartbeat`(`lib/state-core.ts:143`)를 통과하는 새 경로만 두 필드를 현재 시각으로 덮는다] 이름 변경 쪽은 근거가 어디에도 없다. [추론: 옛 이름들이 하나의 제목에 두 개 이상의 주장을 담고 있었고(예: "status shows budget_limited **while** get keeps inactive-fold contract"), 실제로 그 테스트가 둘로 쪼개진 것이 diff에 보인다 — 제목 하나가 주장 하나를 가리키도록 맞춘 정리로 읽힌다]

**시스템 효과** — `resume-pursuit` 이 낡은 heartbeat를 안고 재개하는 회귀가 이 파일에서 잡힌다. 다만 이 테스트는 "타임스탬프가 낡은 값이 아니다" 만 주장하고 그 값이 지금 시각에 가까운지는 보지 않는다.

**추적성** — `skills/ultragoal/scripts/ultragoal-state.test.ts:1375`

---

## 열린 질문

문서를 쓰면서 diff·커밋 메시지·주석·인접 코드를 뒤졌지만 도달 가능한 근거를 찾지 못한 것들이다. 사용자에게 묻지 않고 여기 남긴다.

1. **`lib/persistent-mode-core/state.ts` 의 나머지 `update*` 함수들은 왜 잠그지 않는가.** `Unknown / not supplied`. 이 파일에는 같은 read-modify-write 형태의 함수가 여럿 있고(`readFileOrNull(path)` 가 base:27, :44, :61, :88, :122, :178 에도 있다), `withStateLock` 은 head:206 한 곳에만 붙었다. deep-interview·prometheus·goal 계열도 같은 노출을 갖는지, 아니면 그쪽은 쓰는 주체가 하나뿐이라 무관한지는 이 range 안에서 판정할 수 없다.

2. **경합 상한 0.5초가 실제 워크로드에 충분한가.** `Unknown / not supplied`. `STATE_LOCK_RETRIES = 100` × `STATE_LOCK_RETRY_MS = 5` 라는 값은 옮겨 오기 전부터 있었고(base:143-144), 이 커밋은 호출자를 하나 늘렸다. 늘어난 경합 빈도에 맞춰 상한을 재검토했다는 흔적은 diff 어디에도 없다.

3. **`resumePursuit` 위의 주석이 이제 본문과 어긋난다.** 주석은 `head:skills/ultragoal/scripts/ultragoal-state.ts:694-695` 에서 여전히 "This is deliberately a strict raw read/validate/write path: it never seeds or performs a generic merge." 라고 말하는데, 본문은 head:707 에서 `mergeWriteLocked` — 이름 그대로 일반 병합 — 를 부른다. 주석을 함께 고치지 않은 것이 누락인지, `mergeWriteLocked` 는 `ensureSeed` 를 부르지 않으니 "never seeds" 만 유효하다고 본 것인지는 근거가 없다.

---

## Render

- 마크다운 원본: `2026-08-06-ultragoal-state-lock.md`
- 파생 HTML: `2026-08-06-ultragoal-state-lock.html` (단일 self-contained 파일, 런타임 JS·외부 참조 없음)

---

## Quiz — 문항 뱅크

필수 개념 **8개**, 문항 **20개**. 상한이 20개이고 정확히 20개이므로 중요도 순 절단은 하지 않았다 — 잘라낸 문항은 없다.

개념 배정: 섹션마다 최소 하나(Evidence·Background·Intuition 각 1), Code 섹션은 diff가 건드린 서브시스템마다 하나(공용 락 모듈 / persistent-mode 훅 경로 / ultragoal CLI `resume-pursuit` / 테스트 계층 각 1).

모든 문항은 서술형 단답이다. 선지는 제시하지 않는다.

### 개념 `evidence-scope` — 무엇이 signal이고 왜인가

**Q1.** 이 변경에서 신규 추가(`A`)로 표시된 파일은 무엇이고, 그 사실이 문서의 Code 섹션 형식에 어떤 차이를 만드는가?
- 루브릭 ①: `state-lock.ts` 와 `state-lock.test.ts` 두 파일을 모두 짚는다 *(문서 미열람 시 불가 — 구체 파일 집합)*
- 루브릭 ②: 그 두 파일은 `head:` 앵커만 갖고 `base:` 자리에는 신규임을 밝힌다는 점을 말한다

**Q2.** `lib/persistent-mode-core/state.ts` 의 diff는 대부분이 들여쓰기 이동인데도 noise로 분류되지 않았다. 그 판단의 근거는 무엇인가?
- 루브릭 ①: 들여쓰기가 밀린 이유가 본문 전체를 콜백으로 감쌌기 때문임을 말한다
- 루브릭 ②: 밀린 줄 수가 27줄임을 짚는다 *(문서 미열람 시 불가 — 구체 값)*

### 개념 `two-writers` — 왜 두 주체가 같은 파일을 쓰는가

**Q3.** 상태 파일 `ultragoal-state-<sessionId>.json` 에 쓰는 두 주체를 각각 코드 위치와 함께 대라.
- 루브릭 ①: ultragoal CLI = `skills/ultragoal/scripts/ultragoal-state.ts`, persistent-mode 훅 = `lib/persistent-mode-core/state.ts` 의 `updateUltragoalState` 를 짚는다 *(문서 미열람 시 불가 — 구체 경로·함수명)*
- 루브릭 ②: 둘이 서로 다른 OS 프로세스라는 점을 말한다

**Q4.** 훅 쪽 `updateUltragoalState` 는 어느 파일의 몇 개 지점에서 호출되는가? 그 호출 빈도가 이 문제와 무슨 관계인가?
- 루브릭 ①: `lib/persistent-mode-core/decision.ts` 의 5개 지점 *(문서 미열람 시 불가 — 구체 파일·개수)*
- 루브릭 ②: 턴이 끝나려 할 때마다 불린다는 점, 즉 CLI 쓰기와 겹칠 기회가 반복적으로 생긴다는 점을 말한다

### 개념 `lost-update` — 락 없는 스프레드 오버레이가 잃는 것

**Q5.** Intuition 그림 2의 t1~t3에서, 훅은 `iteration` 하나만 고치려 했는데도 다른 필드가 사라졌다. 사라진 필드의 값이 t2와 t3에서 각각 무엇이었는지 쓰고, 왜 사라졌는지 설명하라.
- 루브릭 ①: t2에 `dismissed: ["F1"]` 이 되었다가 t3에 `[]` 로 돌아갔음을 짚는다 *(문서 미열람 시 불가 — 구체 값·순서)*
- 루브릭 ②: 스프레드 오버레이가 t1 시점 스냅샷 전체를 되쓰기 때문임을 말한다

**Q6.** 같은 시나리오에서, 변경 후에는 t3에 무슨 일이 일어나는가? 디스크의 `iteration` 값은 얼마로 남는가?
- 루브릭 ①: 훅이 `iteration: 2` 를 쓰지 못하고 디스크에 `iteration: 1` 이 남는다 *(문서 미열람 시 불가 — 구체 값)*
- 루브릭 ②: 락 없는 쓰기로 후퇴하지 않고 예외를 던진다(fail-closed)는 점을 말한다

### 개념 `lock-module` — 공용 락 모듈이 보장하는 것

**Q7.** `withStateLock` 이 경합을 포기하기까지 최대 몇 번, 몇 밀리초 간격으로 재시도하며, 그 곱은 대략 얼마인가?
- 루브릭 ①: 100회 × 5ms ≈ 0.5초 *(문서 미열람 시 불가 — 구체 값)*
- 루브릭 ②: 소진 후의 동작이 "던진다"이고 무단 쓰기 경로가 없다는 점을 말한다

**Q8.** 락이 stale로 판정되는 조건은 두 가지다. 둘을 모두 대고, 그중 시간 기준의 임계값을 쓰라.
- 루브릭 ①: 소유 PID가 살아 있지 않거나, 락 디렉터리 mtime + 30,000ms < 현재 *(문서 미열람 시 불가 — 구체 조건·값)*
- 루브릭 ②: 두 조건이 OR 관계임을 말한다

**Q9.** 락을 반납할 때 `owner.json` 의 토큰을 확인하는 이유는 무엇인가?
- 루브릭 ①: 이미 다른 프로세스가 잡은 후속(successor) 락을 잘못 지우는 것을 막기 위해서임을 말한다
- 루브릭 ②: 그 위험을 명시한 주석 문구("Prevents stale recovery from racing a token-checked holder release." 또는 "Serializes stale recovery so a second observer cannot rename a successor lock.")를 짚는다 *(문서 미열람 시 불가 — 원문 인용)*

**Q10.** 락 구현을 옮기면서 UUID 생성 방식이 바뀌었다. 무엇에서 무엇으로 바뀌었고, 문서는 그 이유를 어떤 표기로 다루는가?
- 루브릭 ①: 전역 `crypto.randomUUID()` → `node:crypto` 의 `randomUUID` import *(문서 미열람 시 불가 — 구체 심볼)*
- 루브릭 ②: 근거가 문서화돼 있지 않아 `[추론:]` 라벨로 다뤘다는 점을 말한다

### 개념 `hook-path` — 훅 경로에 생긴 새 실패 모드

**Q11.** 그룹 2에서 `lib/persistent-mode-core/state.ts` 의 로직은 몇 줄이 바뀌었는가? 그 답이 뜻하는 바는?
- 루브릭 ①: 로직은 한 줄도 바뀌지 않았다 — 감싸기와 prettier 재배치가 전부 *(문서 미열람 시 불가 — 구체 판정)*
- 루브릭 ②: 그러므로 이 파일의 변화는 원자성 획득 하나이고, 갱신 규칙(스프레드 오버레이·`progressPatch` 계산)은 그대로임을 말한다

**Q12.** `updateUltragoalState` 위 주석은 이 함수를 어떻게 규정하고 있으며, 변경 전에는 그 규정의 어느 부분이 지켜지지 않았는가?
- 루브릭 ①: 주석이 `a second writer for ultragoal must stay just as strict` 라고 요구한다는 점 *(문서 미열람 시 불가 — 원문 인용)*
- 루브릭 ②: CLI에는 있던 락이 이쪽에는 없어서 `just as strict` 가 성립하지 않았음을 말한다

### 개념 `resume-pursuit` — 재개 경로가 병합 경로로 옮겨 간 결과

**Q13.** `resumePursuit` 의 쓰기가 `writeFileNoCreate` 직접 호출에서 `mergeWriteLocked` 로 바뀌면서 관측 가능한 동작 차이가 생겼다. 그 차이는 무엇이며, 어느 필드에서 드러나는가?
- 루브릭 ①: `last_touched_at` 과 `progress_touched_at` 이 현재 시각으로 갱신된다 — 옛 경로는 디스크의 낡은 값을 되썼다 *(문서 미열람 시 불가 — 구체 필드명)*
- 루브릭 ②: 그 갱신이 `mergeWithHeartbeat` 통과에서 온다는 점을 말한다

**Q14.** 이 변경 이후 `resumePursuit` 위의 주석과 본문 사이에 생긴 불일치는 무엇인가?
- 루브릭 ①: 주석은 "it never seeds or performs a generic merge" 라고 말하지만 본문은 `mergeWriteLocked` 를 부른다 *(문서 미열람 시 불가 — 원문 인용·함수명)*
- 루브릭 ②: 문서가 이것을 열린 질문으로 남겼고 근거가 없다고 표시했다는 점을 말한다

### 개념 `test-contract` — 테스트가 고정한 계약

**Q15.** 새로 생긴 `state-lock.test.ts` 의 테스트 3개는 각각 락의 어떤 전이를 잡는가? 셋을 구분해서 쓰라.
- 루브릭 ①: 살아있는 소유자 → fail-closed(콜백 미실행), stale(mtime 31초 과거) → 회수 후 실행, 토큰 변경 → 릴리스가 지우지 않음 *(문서 미열람 시 불가 — 구체 조건 3종)*
- 루브릭 ②: 세 번째 테스트에서 바뀐 토큰 값이 `"successor"` 임을 짚는다 *(문서 미열람 시 불가 — 구체 리터럴)*

**Q16.** `state.test.ts` 의 새 테스트는 "던진다" 외에 하나를 더 주장한다. 무엇이며 왜 그것이 필요한가?
- 루브릭 ①: 파일 바이트가 한 글자도 변하지 않음을 주장한다
- 루브릭 ②: 던지기 전에 부분 쓰기를 남겼는지가 진짜 위험이기 때문임을 말한다

**Q17.** 기존 보존 테스트에 추가된 두 필드는 무엇이고, 문서는 하필 그 둘이 선택된 이유를 어떻게 다루는가?
- 루브릭 ①: `stories`(값 `[{ id: "S1", story: "Keep this", status: "confirmed" }]`)와 `approved_review_artifact_sha256`(값 `"unchanged-hash"`) *(문서 미열람 시 불가 — 구체 리터럴)*
- 루브릭 ②: 근거가 명시돼 있지 않아 `[추론:]` 으로 다뤘고, `mergeWriteLocked` 의 조용한 소실 경고("stories MUST be enumerated here or silently dropped on every non-story write.")를 근거로 들었음을 말한다

**Q18.** `ultragoal-state.test.ts` 에서 실질 추가와 단순 정리를 구분하라. 정리에 해당하는 변경의 본문 로직은 어떻게 됐는가?
- 루브릭 ①: 실질 추가는 heartbeat 갱신 테스트 하나뿐이고, 나머지는 테스트 분할과 제목 재작성 — 본문 로직은 그대로 *(문서 미열람 시 불가 — 구체 판정)*
- 루브릭 ②: 낡은 타임스탬프로 심어 둔 값이 `"2020-01-01T00:00:00"` 임을 짚는다 *(문서 미열람 시 불가 — 구체 리터럴)*

### 개념 `open-questions` — 이 range로 판정할 수 없는 것

**Q19.** 문서가 `Unknown / not supplied` 로 남긴 항목 중 하나는 락이 붙지 않은 나머지 경로에 관한 것이다. 그 관찰의 근거가 된 수치는 무엇인가?
- 루브릭 ①: `state.ts` 에 같은 형태의 read-modify-write 지점이 여럿 있는데 `withStateLock` 은 head:206 한 곳에만 붙었다 *(문서 미열람 시 불가 — 구체 좌표)*
- 루브릭 ②: 다른 계열도 같은 노출을 갖는지는 이 range 안에서 판정할 수 없다는 점을 말한다

**Q20.** 경합 상한에 대한 열린 질문은 무엇을 지적하는가? 이 커밋이 그 상한의 전제를 어떻게 바꿨는가?
- 루브릭 ①: 상수 100회·5ms 는 옮겨 오기 전부터 있던 값이고 재검토 흔적이 없다 *(문서 미열람 시 불가 — 구체 값·판정)*
- 루브릭 ②: 이 커밋이 같은 락을 붙잡는 호출자를 하나 늘렸으므로 경합 빈도의 전제가 달라졌다는 점을 말한다

---

*(다음 단계인 대화형 출제·채점은 이 실행에서 수행하지 않는다.)*

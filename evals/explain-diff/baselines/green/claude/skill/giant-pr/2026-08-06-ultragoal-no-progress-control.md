# ultragoal 무진전 실행 제어 — 변경 설명

| 항목 | 값 |
|---|---|
| git range | `acd90900^..acd90900` |
| 병합 커밋 | `acd90900` — `Merge pull request #243 from toongri/scalloped-account` |
| PR 제목 | `feat: ultragoal 무진전 실행 제어 추가` |
| 브랜치 범위 | `b00708f4..c8cb0cd0` (22 커밋) |
| 규모 | 29개 파일, +1858 / −274 |

---

## Evidence

noise 기본 규칙표(`*.lock`, `dist/`, `__snapshots__/`, `*.generated.*`, 포맷팅만 바뀐 hunk)에
걸리는 **파일**은 이 diff에 하나도 없다. 29개 파일 전부 signal이다.

규칙표에 걸리는 것은 파일이 아니라 **hunk** 두 개뿐이고, 그 두 hunk는 signal 파일 안에 있으므로
파일 자체의 분류를 바꾸지 않는다. 아래 표 밑에 따로 적었다.

| # | 파일 | 분류 | 비고 |
|---|---|---|---|
| 1 | `lib/persistent-mode-core/progress.ts` | signal | 신규 — 진전 판정기 |
| 2 | `lib/persistent-mode-core/progress.test.ts` | signal | 신규 |
| 3 | `lib/persistent-mode-core/types.ts` | signal | 지문 필드 2개 추가 |
| 4 | `lib/persistent-mode-core/decision.ts` | signal | Stop 판정 재작성 |
| 5 | `lib/persistent-mode-core/decision.test.ts` | signal | |
| 6 | `hooks/persistent-mode/index.ts` | signal | Claude 어댑터 |
| 7 | `hooks/codex-persistent-mode/cli.ts` | signal | Codex 어댑터 + 자식 감지기 |
| 8 | `hooks/codex-persistent-mode/cli.test.ts` | signal | |
| 9 | `lib/persistent-mode-core/state-lock.ts` | signal | 신규 — 공유 락 |
| 10 | `lib/persistent-mode-core/state-lock.test.ts` | signal | 신규 |
| 11 | `lib/persistent-mode-core/state.ts` | signal | 훅 쓰기 경로 락 편입 |
| 12 | `lib/persistent-mode-core/state.test.ts` | signal | |
| 13 | `skills/ultragoal/scripts/ultragoal-state.ts` | signal | 재개 명령 + 락 반출 |
| 14 | `skills/ultragoal/scripts/ultragoal-state.test.ts` | signal | |
| 15 | `hooks/write-guard-core.sh` | signal | 사용자 전용 명령 목록 |
| 16 | `hooks/write-guard-core_test.sh` | signal | |
| 17 | `hooks/codex-write-guard_test.sh` | signal | |
| 18 | `hooks/pre-tool-enforcer_test.sh` | signal | |
| 19 | `skills/ultragoal/SKILL.md` | signal | |
| 20 | `skills/ultragoal/references/planning.md` | signal | |
| 21 | `skills/ultragoal/references/completion-gate.md` | signal | |
| 22 | `CLAUDE.md` | signal | |
| 23 | `README.md` | signal | |
| 24 | `README.en.md` | signal | |
| 25 | `docs/ORCHESTRATION.md` | signal | |
| 26 | `docs/ORCHESTRATION.en.md` | signal | |
| 27 | `docs/skills/core-pipeline.md` | signal | |
| 28 | `docs/skills/core-pipeline.en.md` | signal | |
| 29 | `skills/design-review/scripts/job.test.ts` | signal | 이 PR에 같이 실린 별개 수정 |

**규칙표에 걸린 noise hunk 2건** — 둘 다 `lib/persistent-mode-core/decision.ts` 안에 있고,
동작을 바꾸지 않는 prettier 줄바꿈이다. 이후 설명에서는 다루지 않는다.

- `nonGoals.filter(...).length` 를 두 줄로 나눈 hunk (`head:lib/persistent-mode-core/decision.ts:553`)
- `formatBlockOutput(buildSkillChainContinuationMessage(...))` 를 세 줄로 나눈 hunk (`head:lib/persistent-mode-core/decision.ts:656`)

---

## Background

### 깊은 배경

이미 익숙하면 건너뛰세요.

이 저장소(oh-my-toong)는 여러 AI CLI — Claude Code, Codex CLI — 에 스킬·훅·규칙을 배포하는
설정 관리 시스템이다. 여기서 알아야 할 것은 세 가지다.

**Stop 훅.** AI CLI는 한 턴을 끝내려 할 때 `Stop` 이벤트를 훅에 넘긴다. 훅은 JSON을 돌려주는데,
`{continue: true}` 면 그대로 멈추고, `block` + 메시지면 멈추지 못하고 그 메시지를 새 지시로 받아
계속 일한다. 이 저장소의 `persistent-mode`(Claude용)와 `codex-persistent-mode`(Codex용)가
그 훅이고, 판정 로직은 `lib/persistent-mode-core/decision.ts`의 `makeDecision` 하나를 공유한다.
어댑터 둘이 각자의 플랫폼 페이로드를 읽어 같은 함수에 넣는 구조다.

**ultragoal.** 하나의 목표(objective)를 여러 Story로 쪼개 순차적으로 추격하는 스킬이다.
상태는 `$OMT_DIR/ultragoal-state-<sessionId>.json` 파일 하나에 들어 있고, `phase`는
`planning → pursuing → complete` 를 기본 경로로 하되 `budget_limited`(예산 소진 소프트 정지)와
`blocked`(막힘 보고) 두 종료 상태를 갖는다. 이 파일을 쓰는 주체는 **둘**이다 — Stop 훅과,
스킬이 부르는 CLI(`skills/ultragoal/scripts/ultragoal-state.ts`).

**PreToolUse 가드.** 어떤 명령은 AI가 직접 실행하면 안 된다. 예를 들어 리뷰 finding을
무효화하는 명령을 AI가 스스로 돌리면, 자기 완료 게이트를 자기가 여는 셈이 된다. 그래서
`hooks/write-guard-core.sh`가 Bash 명령 문자열을 검사해 그런 명령을 **deny** 로 막고,
AI는 사용자에게 명령어 전문을 제시만 한다. 문서로 "하지 마라"라고 적는 대신 구조로 막는 방식이다.

### 좁은 배경

변경 전, ultragoal의 `iteration` 필드는 **pursuing 상태에서 Stop이 차단된 횟수**를 세었다.
Stop이 올 때마다 무조건 `iteration + 1` 이었고(`base:lib/persistent-mode-core/decision.ts:399`),
`max_iterations`(기본 10)에 닿으면 `budget_limited` 로 소프트 정지했다.

여기에 세 가지 결함이 있었다.

1. **일을 잘해도 예산이 닳는다.** 커밋을 열 번 만들며 순조롭게 진행해도 Stop 열 번이면 정지다.
   카운터가 "얼마나 오래 돌았나"를 셀 뿐 "진전이 있었나"를 세지 않았다.
2. **기다리는 것도 닳는다.** 위임한 백그라운드 작업이 끝나기를 기다리는 Stop도 한 칸을 먹었다.
3. **정지에서 나올 길이 없다.** `budget_limited` 는 `active:false` 인 종료 상태라 되돌리는
   명령 자체가 없었다.

동시에, 상태 파일을 쓰는 두 주체 중 CLI 쪽만 락을 갖고 있었다. 락 구현은
`skills/ultragoal/scripts/ultragoal-state.ts` 안에 private 함수로 들어 있었고
(`base:skills/ultragoal/scripts/ultragoal-state.ts:415`), 훅 쪽 쓰기 경로인
`updateUltragoalState`(`base:lib/persistent-mode-core/state.ts:203`)는 아무 락 없이
read-modify-write 를 했다.

---

## Intuition

이 변경의 본질은 한 문장이다. **`iteration`이 세는 대상을 "Stop 횟수"에서 "연속 무진전 Stop 횟수"로
바꾸고, 그 결과 생긴 일시정지 상태에서 나올 문을 사용자에게만 준다.**

세션 `sess-42`, `max_iterations: 10` 인 추격을 예로 보자. HEAD는 `a1b2c3d` 에서 시작하고,
Story 집합은 `[["S1","confirmed"],["S2","unconfirmed"]]` 두 쌍이다.

### 카운터의 의미가 바뀐다

<div style="display:flex;gap:14px;flex-wrap:wrap;margin:1.2rem 0">
<div style="flex:1 1 280px;border:1px solid #b9b9b9;border-radius:8px;padding:14px">
<div style="font-weight:700;margin-bottom:10px">변경 전 — Stop 한 번 = +1</div>
<div style="font-family:ui-monospace,monospace;font-size:13px;line-height:2">
Stop ① 커밋 <b>a1b2c3d→e4f5a6b</b> &nbsp;→&nbsp; iteration <b>1</b><br>
Stop ② 커밋 또 하나 &nbsp;→&nbsp; iteration <b>2</b><br>
Stop ③ 백그라운드 대기 &nbsp;→&nbsp; iteration <b>3</b><br>
⋮<br>
Stop ⑩ &nbsp;→&nbsp; <b style="color:#b03030">budget_limited</b> (탈출 불가)
</div>
</div>
<div style="flex:1 1 280px;border:1px solid #b9b9b9;border-radius:8px;padding:14px">
<div style="font-weight:700;margin-bottom:10px">변경 후 — 무진전 Stop만 +1</div>
<div style="font-family:ui-monospace,monospace;font-size:13px;line-height:2">
Stop ① 커밋 <b>a1b2c3d→e4f5a6b</b> &nbsp;→&nbsp; iteration <b>0</b> (리셋)<br>
Stop ② 커밋 또 하나 &nbsp;→&nbsp; iteration <b>0</b> (리셋)<br>
Stop ③ 백그라운드 대기 &nbsp;→&nbsp; iteration <b>그대로</b> (미집계)<br>
Stop ④ 아무것도 안 바뀜 &nbsp;→&nbsp; iteration <b>1</b><br>
연속 10회 무진전 &nbsp;→&nbsp; <b style="color:#b03030">budget_limited</b> → 사용자가 재개 가능
</div>
</div>
</div>

`a1b2c3d` 에서 `e4f5a6b` 로 diff를 실은 커밋이 생기면 그것이 **관찰된 진전**이고, 카운터는 그
자리에서 `0` 으로 돌아간다. Stop ③ 처럼 백그라운드 작업을 기다리는 턴은 진전도 무진전도 아니라
아예 세지 않는다. 그래서 `budget_limited` 는 "오래 돌았다"가 아니라 "**연속** 10번 동안 아무것도
안 움직였다"는 뜻이 된다.

### 진전을 무엇으로 판정하는가

<div style="margin:1.2rem 0;border:1px solid #b9b9b9;border-radius:8px;padding:14px">
<div style="font-weight:700;margin-bottom:12px">Stop 이벤트 → 진전 판정 → 상태 쓰기</div>
<div style="display:flex;gap:10px;align-items:stretch;flex-wrap:wrap;font-size:13px">
<div style="flex:1 1 150px;border:1px solid #cfcfcf;border-radius:6px;padding:10px">
<div style="font-weight:700">저장된 지문</div>
<div style="font-family:ui-monospace,monospace;line-height:1.8">last_seen_head<br>= <b>a1b2c3d</b><br><br>last_seen_stories_digest<br>= sha256 of<br>[["S1","confirmed"],<br>&nbsp;["S2","unconfirmed"]]</div>
</div>
<div style="align-self:center;font-size:22px">→</div>
<div style="flex:1 1 190px;border:1px solid #cfcfcf;border-radius:6px;padding:10px">
<div style="font-weight:700">현재 관측</div>
<div style="font-family:ui-monospace,monospace;line-height:1.8">git rev-parse HEAD<br>= <b>e4f5a6b</b><br><br>digest of<br>[["S1","confirmed"],<br>&nbsp;["S2","confirmed"]]</div>
</div>
<div style="align-self:center;font-size:22px">→</div>
<div style="flex:1 1 210px;border:1px solid #cfcfcf;border-radius:6px;padding:10px">
<div style="font-weight:700">두 개의 OR</div>
<div style="line-height:1.9">① <code>a1b2c3d</code>가 <code>e4f5a6b</code>의 조상이고<br>&nbsp;&nbsp;&nbsp;둘 사이에 diff가 있는가<br>② digest가 달라졌는가</div>
</div>
<div style="align-self:center;font-size:22px">→</div>
<div style="flex:1 1 150px;border:1px solid #cfcfcf;border-radius:6px;padding:10px">
<div style="font-weight:700">결과</div>
<div style="line-height:1.9">둘 중 하나라도 참<br>→ <b>iteration = 0</b><br>+ 지문을 <code>e4f5a6b</code>로 갱신<br><br>둘 다 거짓<br>→ <b>iteration + 1</b><br>+ 지문은 <b>그대로</b></div>
</div>
</div>
</div>

여기서 중요한 비대칭이 하나 있다. 진전이 있으면 지문을 `e4f5a6b` 로 **갱신**하지만, 무진전이면
지문을 `a1b2c3d` 에 **그대로 둔다**. 그래서 비교의 기준점은 "직전 Stop"이 아니라 "마지막으로
진전이 관찰된 시점"이다. 무진전 Stop 다섯 번이 지나도 기준은 여전히 `a1b2c3d` 이고, 그 뒤에
`e4f5a6b` 가 생기면 다섯 번을 건너뛴 진전이 그대로 잡힌다.

"조상인가"를 먼저 묻는 이유도 이 예에서 보인다. 만약 `a1b2c3d` 를 amend 하거나 rebase 해서
`e4f5a6b` 가 `a1b2c3d` 를 조상으로 갖지 않게 되면, 두 커밋 사이에 diff가 있더라도 진전으로
치지 않는다. 히스토리를 다시 쓴 것은 새 작업이 아니기 때문이다.

### 어느 파일이 어느 층에 있나

<div style="margin:1.2rem 0;border:1px solid #b9b9b9;border-radius:8px;padding:14px;font-size:13px">
<div style="border:1px dashed #999;border-radius:6px;padding:10px;margin-bottom:10px">
<div style="font-weight:700;margin-bottom:6px">플랫폼 어댑터 — "대기 중인가"를 신고한다</div>
<code>hooks/persistent-mode/index.ts</code> (Claude · 깨우기 보장 <b>있음</b>) &nbsp;|&nbsp;
<code>hooks/codex-persistent-mode/cli.ts</code> (Codex · 깨우기 보장 <b>없음</b> + 자식 감지기)
</div>
<div style="border:1px dashed #999;border-radius:6px;padding:10px;margin-bottom:10px">
<div style="font-weight:700;margin-bottom:6px">공유 판정 — 어느 플랫폼이든 같은 규칙</div>
<code>lib/persistent-mode-core/decision.ts</code> → <code>progress.ts</code> (진전 판정) → <code>types.ts</code> (지문 필드)
</div>
<div style="border:1px dashed #999;border-radius:6px;padding:10px;margin-bottom:10px">
<div style="font-weight:700;margin-bottom:6px">상태 쓰기 — 두 작성자가 같은 락을 잡는다</div>
<code>lib/persistent-mode-core/state-lock.ts</code> ← <code>state.ts</code> (훅 경로) &nbsp;·&nbsp; <code>skills/ultragoal/scripts/ultragoal-state.ts</code> (CLI 경로)
</div>
<div style="border:1px dashed #999;border-radius:6px;padding:10px">
<div style="font-weight:700;margin-bottom:6px">권한 — 재개 명령은 사용자만</div>
<code>hooks/write-guard-core.sh</code> ← Claude <code>pre-tool-enforcer.sh</code> · Codex <code>codex-write-guard.sh</code>
</div>
</div>

### 상태 전이

<div style="margin:1.2rem 0;border:1px solid #b9b9b9;border-radius:8px;padding:16px;font-size:13px">
<div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap;justify-content:center">
<div style="border:2px solid #2b7a4b;border-radius:8px;padding:12px 18px;text-align:center">
<b>pursuing</b><br><span style="font-family:ui-monospace,monospace">active: true</span>
</div>
<div style="text-align:center;min-width:190px">
<div>연속 무진전 <b>10</b>회 &nbsp;⟶</div>
<div style="color:#777">(훅이 자동으로 쓴다)</div>
<div style="margin-top:12px">⟵ <code>resume-pursuit</code></div>
<div style="color:#777">(<b>사용자만</b> 실행 가능)</div>
</div>
<div style="border:2px solid #b03030;border-radius:8px;padding:12px 18px;text-align:center">
<b>budget_limited</b><br><span style="font-family:ui-monospace,monospace">active: false</span>
</div>
</div>
<div style="margin-top:14px;text-align:center;color:#555">
왼쪽 화살표는 이 PR이 새로 뚫은 문이다. 되돌아올 때 <code>iteration</code>은 <b>0</b>으로 리셋된다.
</div>
</div>

---

## Change Group 1: 진전이라는 말에 관찰 가능한 정의를 준다

> 예고: 이 그룹은 "리포지토리와 Story 집합이 마지막으로 본 모습과 달라졌는가"를 판정하는 순수 함수 하나와, 그 판정이 기억해야 할 지문 두 개를 상태 타입에 새로 만든다.
> 순서: 카운터의 의미를 바꾸려면 먼저 "진전"이 코드로 판정 가능해야 하므로, 판정기가 없는 상태에서는 그다음 그룹이 참조할 대상 자체가 없다.

### `lib/persistent-mode-core/progress.ts`

**역할/변경 전 맥락** — 존재하지 않던 파일이다. 변경 전에는 "진전"에 해당하는 개념이 코드 어디에도
없었고, Stop이 오면 무조건 `iteration + 1` 이었다 (`base:lib/persistent-mode-core/decision.ts:399`).

**무엇이 바뀌었나** — `evaluateProgress(state, cwd)` 를 신설했다
(`head:lib/persistent-mode-core/progress.ts:44`). 두 축을 OR로 합친다.

- **커밋 축** — 저장된 `last_seen_head` 가 현재 `HEAD` 의 조상일 때만
  `git diff --quiet <prior>..<head>` 를 돌리고, 종료코드가 `1`(차이 있음)일 때 진전으로 본다
  (`head:lib/persistent-mode-core/progress.ts:54`).
- **Story 축** — `stories`(없으면 `todos`)에서 `id`/`status` 쌍만 뽑아 정렬한 뒤 SHA-256 을 낸다
  (`head:lib/persistent-mode-core/progress.ts:27`). 이전 digest가 존재하고 값이 달라졌을 때만
  진전이다 (`head:lib/persistent-mode-core/progress.ts:59`).

git 호출은 전부 try/catch로 감싸고 실패 시 `null` 을 돌려 fail-open 한다.

**왜 필요한가** — [근거: 커밋 메시지 `feat: pursuit 진전 판정기 추가`, `fix: 진전 판정 null 비교 엄격화`]
그리고 [근거: 이 PR이 문서에 새로 못 박은 계약 문장 `"A diff-carrying commit or a story status transition is observed progress and resets the counter to 0"`
(`head:skills/ultragoal/references/planning.md:15`)]. 판정 조건이 문서와 코드에서 같은 두 축으로
적혀 있다.

**시스템 효과** — "진전"이 처음으로 기계가 셀 수 있는 값이 됐다. `--allow-empty` 커밋, 워크트리
수정만 있는 상태, revert로 되돌아온 커밋은 모두 진전이 아니다. `git diff --quiet` 의 종료코드
`1`이 판정 기준이므로 커밋이 생겼다는 사실만으로는 부족하고 **내용 차이**가 있어야 한다.

**추적성** — `lib/persistent-mode-core/progress.ts:44`

### `lib/persistent-mode-core/types.ts`

**역할/변경 전 맥락** — `GoalState` 인터페이스가 ultragoal 상태 파일의 스키마를 정의한다. 변경 전
마지막 필드는 GC 생존 검사용 `last_touched_at` 이었다 (`base:lib/persistent-mode-core/types.ts:115`).

**무엇이 바뀌었나** — `last_seen_head?: string` 과 `last_seen_stories_digest?: string` 두
선택 필드를 추가했다 (`head:lib/persistent-mode-core/types.ts:115`).

**왜 필요한가** — [추론: `evaluateProgress` 는 "직전에 본 것"과 비교해야 하는데 Stop 훅은 턴마다
새 프로세스로 뜨므로 메모리에 기억할 수 없다. 비교 기준을 상태 파일에 얹는 것 말고는 세션을 가로질러
남길 자리가 없다. 필드를 `?` 선택으로 둔 것 역시 이미 디스크에 있는 기존 상태 파일들이 이 필드 없이
읽혀야 하기 때문이다.]

**시스템 효과** — 상태 파일이 "무엇을 마지막으로 봤는지"를 들고 다니게 됐다. 이 필드가 없는 기존
파일도 그대로 읽히며, 첫 pursuing Stop에서 채워진다.

**추적성** — `lib/persistent-mode-core/types.ts:115`

### `lib/persistent-mode-core/progress.test.ts`

**역할/변경 전 맥락** — 신규 파일. 판정기가 없었으므로 테스트도 없었다.

**무엇이 바뀌었나** — 임시 git 리포지토리를 실제로 만들어 돌리는 12개 케이스를 넣었다
(`head:lib/persistent-mode-core/progress.test.ts:38`). 진전으로 **치지 않는** 경계가 케이스의
절반 이상이다 — 빈 커밋, 워크트리 변경만, 갈라진 브랜치로 checkout
(`head:lib/persistent-mode-core/progress.test.ts:83`), amend
(`head:lib/persistent-mode-core/progress.test.ts:92`), rebase, 커밋 후 revert
(`head:lib/persistent-mode-core/progress.test.ts:109`). git 리포 밖에서는 fail-open 하고
(`head:lib/persistent-mode-core/progress.test.ts:137`), digest는 정렬된 `id`/`status` 쌍만
반영한다 (`head:lib/persistent-mode-core/progress.test.ts:141`).

**왜 필요한가** — [근거: 커밋 메시지 `test: 무진전 계획 검증 보강`, `test: 진전 경계 계획 필터 정렬`]

**시스템 효과** — "진전"의 경계가 테스트로 고정됐다. 특히 amend·rebase·revert 세 케이스는 diff는
존재하지만 진전은 아니라는 판정을 회귀로 막는다.

**추적성** — `lib/persistent-mode-core/progress.test.ts:38`

---

## Change Group 2: Stop 판정이 진전·대기·무진전 셋을 구분하게 한다

> 예고: 앞 그룹이 만든 판정기를 Stop 판정의 한가운데에 꽂아, 한 종류였던 Stop을 진전(카운터 리셋)·대기(미집계)·무진전(카운터 증가) 셋으로 갈라놓는다.
> 순서: 진전 판정기가 이미 존재하기 때문에 이 그룹은 그것을 호출만 하면 되고, 반대로 판정기부터 있지 않았다면 이 분기의 조건 자체를 쓸 수 없었다.

### `lib/persistent-mode-core/decision.ts`

**역할/변경 전 맥락** — 두 플랫폼이 공유하는 유일한 Stop 판정 함수 `makeDecision` 이 여기 있다.
변경 전 pursuing 분기는 단순했다. 백그라운드 작업이 있으면 무조건 멈추게 허용했고
(`base:lib/persistent-mode-core/decision.ts:344`), 아니면 `iteration + 1` 후 차단
(`base:lib/persistent-mode-core/decision.ts:399`), 상한에 닿으면 예산 소진 메시지로 소프트 정지
(`base:lib/persistent-mode-core/decision.ts:382`)였다.

**무엇이 바뀌었나** — 네 갈래다.

1. **카운터 재정의.** pursuing 분기 첫 줄에서 `evaluateProgress(ultragoal, projectRoot)` 를
   호출한다 (`head:lib/persistent-mode-core/decision.ts:372`). 진전이면 `iteration: 0` 과 갱신된
   지문을 함께 쓰고 차단 메시지를 낸다 (`head:lib/persistent-mode-core/decision.ts:388`).
   진전이 아니면 `Math.min(iteration + 1, max_iterations)` 로 올린다.
2. **지문 갱신의 비대칭.** 진전일 때 쓰는 `persistedFingerprint` 는 관측값으로 **덮어쓰고**
   (`head:lib/persistent-mode-core/decision.ts:373`), 무진전일 때 쓰는 `fingerprintPatch` 는
   필드가 비어 있을 때만 **초기화**한다 (`head:lib/persistent-mode-core/decision.ts:379`).
3. **대기 분기.** 백그라운드 작업이 있을 때, 깨우기가 보장된 플랫폼이면 예전처럼 멈추게 허용하고,
   보장되지 않은 플랫폼에서 pursuing ultragoal이 살아 있으면 전용 대기 메시지로 **차단하되 카운터는
   건드리지 않는다** (`head:lib/persistent-mode-core/decision.ts:333`). 이 분기를 위해
   `DecisionContext` 에 `deferredStopWakeGuaranteed?: boolean` 이 생겼다
   (`head:lib/persistent-mode-core/decision.ts:31`).
4. **메시지 어휘 교체.** `[ULTRAGOAL - ITERATION n/N]`
   (`base:lib/persistent-mode-core/decision.ts:239`)이 `[ULTRAGOAL - NO-PROGRESS n/N]`
   (`head:lib/persistent-mode-core/decision.ts:245`)이 되고, `buildUltragoalBudgetLimitMessage`
   (`base:lib/persistent-mode-core/decision.ts:267`)는
   `buildUltragoalNoProgressLimitMessage` (`head:lib/persistent-mode-core/decision.ts:272`)로
   대체됐다.

**왜 필요한가** — [근거: 새 상한 메시지가 이유를 직접 적는다 —
`"The pursuit is paused: ${ultragoal.max_iterations} consecutive Stops passed with no observed progress (no diff-carrying commit, no story transition)"`]
그리고 대기 메시지도 마찬가지다 — `"This turn is not counted toward no-progress."`
(`head:lib/persistent-mode-core/decision.ts:87`).

**시스템 효과** — 소프트 정지의 의미가 "예산 소진"에서 "교착 감지"로 바뀌었다. 주의할 점 하나 —
진전이 관찰돼도 훅은 여전히 **차단**한다. 진전은 멈춰도 된다는 뜻이 아니라 카운터를 되돌린다는
뜻뿐이다. 또 `Math.min` 클램프 때문에 `iteration` 이 `max_iterations` 를 넘어서 기록되는 일이 없다.

**추적성** — `lib/persistent-mode-core/decision.ts:372`

### `lib/persistent-mode-core/decision.test.ts`

**역할/변경 전 맥락** — `makeDecision` 의 통합 테스트 파일 (`base:lib/persistent-mode-core/decision.test.ts:9`).

**무엇이 바뀌었나** — +448줄. 임시 git 리포지토리를 띄우고 실제 커밋을 만들어 판정을 검증한다.
핵심 케이스: `iteration: 9` 에서 무진전 Stop 하나면 `[ULTRAGOAL - NO-PROGRESS LIMIT REACHED 10/10]`
과 `phase: budget_limited` (`head:lib/persistent-mode-core/decision.test.ts:1217`), `iteration: 10`
이어도 diff 커밋이 있으면 `[ULTRAGOAL - NO-PROGRESS 0/10]` 로 리셋
(`head:lib/persistent-mode-core/decision.test.ts:1233`), Story 상태 전환만으로도 리셋
(`head:lib/persistent-mode-core/decision.test.ts:1303`), 깨우기 보장이 있는 백그라운드 대기는
카운터를 소비하지 않고 통과 (`head:lib/persistent-mode-core/decision.test.ts:1553`), 상한 메시지가
드레인 정책을 명시하는지 (`head:lib/persistent-mode-core/decision.test.ts:1453`). 지문이 한쪽만
있는 부분 상태와 빈 문자열 HEAD의 초기화 경로도 각각 케이스를 갖는다.

**왜 필요한가** — [근거: 커밋 메시지 `fix: 무진전 최종 감사 결함 해소`, `fix: 빈 HEAD 진전 지문 초기화`]
— 부분 지문과 빈 HEAD 케이스는 감사에서 나온 결함을 고친 자리이고, 테스트가 그 자리에 붙어 있다.

**시스템 효과** — "10회에 정지"와 "진전이 리셋"이 양방향으로 고정됐다. 리셋 케이스가
`iteration: 10` 에서 시작한다는 점이 특히 중요하다 — 상한값에 이미 도달한 상태에서도 진전이
관찰되면 정지가 아니라 리셋이라는 뜻이다.

**추적성** — `lib/persistent-mode-core/decision.test.ts:1217`

---

## Change Group 3: 두 플랫폼이 "지금 기다리는 중"을 각자의 방식으로 신고한다

> 예고: 앞 그룹이 만든 대기 분기는 "깨우기가 보장되는가"라는 입력을 요구하는데, 그 값을 채우는 일과 Codex 쪽에서 "정말 자식이 살아 있는가"를 알아내는 일을 여기서 한다.
> 순서: 공유 판정 함수가 그 입력 필드를 이미 갖고 있어야 어댑터가 채울 대상이 생기므로, 어댑터 변경은 판정 함수 변경 뒤에 온다.

### `hooks/persistent-mode/index.ts`

**역할/변경 전 맥락** — Claude Code의 Stop 페이로드를 `DecisionContext` 로 옮기는 얇은 어댑터.
변경 전에는 `activeBackgroundTaskCount` 를 그대로 넘기기만 했다
(`base:hooks/persistent-mode/index.ts:36`).

**무엇이 바뀌었나** — `deferredStopWakeGuaranteed: true` 한 줄을 추가했다
(`head:hooks/persistent-mode/index.ts:37`).

**왜 필요한가** — [근거: Codex 쪽 대응 코드 위의 주석이 이 비대칭을 명시한다 —
`"Shared invariant: Stop may bypass only if deferred re-invocation is guaranteed; Codex lacks that guarantee"`]

**시스템 효과** — Claude에서는 백그라운드 대기 시 동작이 변경 전과 **완전히 동일**하다. 이 PR의
대기 분기는 Claude의 기존 경로를 건드리지 않고 Codex만 새 경로로 보낸다.

**추적성** — `hooks/persistent-mode/index.ts:37`

### `hooks/codex-persistent-mode/cli.ts`

**역할/변경 전 맥락** — Codex CLI의 훅 진입점. 변경 전에는 백그라운드 작업 개수를 아예 알 수 없어
`activeBackgroundTaskCount: 0` 을 하드코딩했다 (`base:hooks/codex-persistent-mode/cli.ts:258`).

**무엇이 바뀌었나** — 자식 작업 감지기 `detectActiveCodexChildren` 을 새로 만들었다
(`head:hooks/codex-persistent-mode/cli.ts:316`). 순서는 이렇다.

1. **pursuing ultragoal일 때만 돈다.** 상태를 먼저 읽고 `active && phase === "pursuing"` 이
   아니면 감지기 자체를 건너뛴다 (`head:hooks/codex-persistent-mode/cli.ts:265`).
2. Codex의 상태 DB `state_5.sqlite` 에서 `thread_spawn_edges` 를 조회해
   `status='open'` 인 자식 스레드와 그 rollout 파일 경로를 얻는다
   (`head:hooks/codex-persistent-mode/cli.ts:332`). 조회는 `-readonly` 로 연다.
3. rollout 파일의 mtime이 `CODEX_CHILD_STALE_TTL_SECONDS`(= `TERMINAL_TTL_SECONDS`, 1800초)보다
   오래됐으면 건너뛴다 (`head:hooks/codex-persistent-mode/cli.ts:348`).
4. rollout 파일의 **마지막 64KB만** 읽어(`ROLLOUT_TAIL_BYTES`,
   `head:hooks/codex-persistent-mode/cli.ts:71`) `task_started` / `task_complete` /
   `turn_aborted` 중 **마지막에 나온 마커**를 찾는다. 그것이 `task_started` 면 살아 있는 자식이다
   (`head:hooks/codex-persistent-mode/cli.ts:369`).
5. 마커가 tail 안에 하나도 없는데 파일이 64KB보다 크면, 보수적으로 살아 있다고 센다
   (`head:hooks/codex-persistent-mode/cli.ts:370`).

그리고 `deferredStopWakeGuaranteed: false` 를 명시한다
(`head:hooks/codex-persistent-mode/cli.ts:280`).

**왜 필요한가** — 5번 규칙에 대해서는 [근거: 바로 위 주석 —
`"A fresh open rollout may have its initial task_started marker before the bounded tail. Without a retained terminal marker, conservatively treat that child as active; terminal markers in the tail still win."`].
전체 fail-open 방침은 [근거: 함수 doc 주석 —
`"The detector is deliberately fail-open: any unavailable/malformed input emits one diagnostic and contributes zero active children."`].
TTL 상수를 공유 상수로 맞춘 것은 [근거: 커밋 메시지 `fix: Codex 자식 TTL 상수 통합`].

**시스템 효과** — Codex에서 위임 실행자가 돌아가는 동안의 Stop이 무진전으로 오해받지 않게 됐다.
`sqlite3` 가 이 저장소의 런타임 전제 조건이 된 것도 여기서 비롯한다. 감지기가 어떤 이유로든 실패하면
0을 세므로, 최악의 경우는 "대기를 무진전으로 오인"이지 "무한 대기"가 아니다.

**추적성** — `hooks/codex-persistent-mode/cli.ts:316`

### `hooks/codex-persistent-mode/cli.test.ts`

**역할/변경 전 맥락** — Codex 훅 CLI 테스트 (`base:hooks/codex-persistent-mode/cli.test.ts:688`
의 `makeDecision` 통합 describe 블록 아래).

**무엇이 바뀌었나** — +329줄로 감지기 진리표를 덮었다. 살아 있는 자식이 있으면 차단하되 카운터를
소비하지 않고 (`head:hooks/codex-persistent-mode/cli.test.ts:690`), 마커 조합별 판정
(`head:hooks/codex-persistent-mode/cli.test.ts:731`), 대기만 반복되는 체인은 예산을 소진하지 않으며
(`head:hooks/codex-persistent-mode/cli.test.ts:767`), 64KB 경계에서 tail 안의 마지막 완전한 마커를
쓰고 (`head:hooks/codex-persistent-mode/cli.test.ts:842`), tail에 마커가 없는 큰 파일은 살아 있다고
센다 (`head:hooks/codex-persistent-mode/cli.test.ts:870`). `sqlite3` 부재·질의 실패·형식 오류는 각각
진단 1건과 함께 fail-open 하고, 질의가 `-readonly` 를 포함하는지도 검사한다.

**왜 필요한가** — [근거: 커밋 메시지 `fix: 큰 rollout 자식 작업 감지 보완`, `fix: 부분 rollout 자식 감지 보존`]
— 두 커밋 모두 tail 경계에서 나온 결함을 고쳤고, 대응 테스트가 여기 붙었다.

**시스템 효과** — 감지기가 "모르면 0"이라는 성질을 회귀로 고정했다. 진단 메시지가 **1건**인지까지
검사하므로, 실패 경로가 Stop마다 여러 줄을 뱉는 회귀도 잡힌다.

**추적성** — `hooks/codex-persistent-mode/cli.test.ts:690`

---

## Change Group 4: 두 작성자가 같은 자물쇠를 잡게 한다

> 예고: 앞 그룹까지 훅은 매 Stop마다 상태 파일을 쓰게 됐는데 그 쓰기 경로에는 락이 없었으므로, 여기서 락 구현을 공용 모듈로 끌어내 훅 경로를 그 안으로 집어넣는다.
> 순서: 훅이 상태를 쓰는 빈도가 늘어난 것이 앞 그룹의 결과이므로, 그 결과가 만들어진 다음에야 "두 작성자가 경합한다"는 문제가 실재한다.

### `lib/persistent-mode-core/state-lock.ts`

**역할/변경 전 맥락** — 신규 파일. 같은 알고리즘의 락이 변경 전에는 ultragoal CLI 스크립트 안에
private 함수로만 존재했다 (`base:skills/ultragoal/scripts/ultragoal-state.ts:415`).

**무엇이 바뀌었나** — `withStateLock(stateFilePath, callback)` 을 공용 모듈로 반출했다
(`head:lib/persistent-mode-core/state-lock.ts:24`). `mkdir` 원자성을 이용한 디렉터리 락이고,
소유자 정보(`ownerPid`/`token`/`startedAt`)를 락 디렉터리 안 `owner.json` 에 적는다. 100회 ×
5ms 재시도 후에도 못 잡으면 **던진다** — 락 없는 쓰기로 물러서지 않는다. 죽은 소유자(PID 부재)이거나
mtime이 `STATE_LOCK_STALE_TTL_MS`(30초)를 넘긴 락은 stale로 회수한다
(`head:lib/persistent-mode-core/state-lock.ts:15`).

반출과 동시에 동작 하나가 바뀌었다. `releaseStateLock` 이 recovery guard를 한 번만 시도하고 끝내던
것에서, 잡을 때까지 도는 `while (true)` 루프가 됐다
(`head:lib/persistent-mode-core/state-lock.ts:154`).

**왜 필요한가** — 반출 자체는 [근거: 커밋 메시지 `fix: ultragoal 상태 갱신 락 통합`].
`while` 루프는 [근거: 그 자리 주석 —
`"A fresh recovery guard may belong to a concurrent stale-lock observer; wait for it rather than leaving our own primary lock behind."`]
— 한 번 실패하고 돌아가면 자기 락을 남긴 채 떠나게 되고, 그 락은 30초 TTL이 지나야 회수된다.

**왜 필요한가(경합 시 던지는 선택)** — [근거: 함수 doc 주석 —
`"A contention timeout fails closed; callers never fall back to an unlocked write."`]

**시스템 효과** — 훅과 CLI가 같은 경로(`<상태파일>.lock`)에 대해 상호 배제된다. 경합 시 실패는
조용한 덮어쓰기가 아니라 예외이므로, 상태 파일이 반쯤 갱신된 채 남지 않는다.

**추적성** — `lib/persistent-mode-core/state-lock.ts:24`

### `lib/persistent-mode-core/state.ts`

**역할/변경 전 맥락** — 훅 쪽 상태 접근 계층. `updateUltragoalState` 가 read-modify-write 를
락 없이 수행했다 (`base:lib/persistent-mode-core/state.ts:203`).

**무엇이 바뀌었나** — 함수 본문 전체를 `withStateLock(path, () => { … })` 안으로 감쌌다
(`head:lib/persistent-mode-core/state.ts:206`). 로직 자체는 그대로다 — 읽기, JSON 파싱 실패 시
조용히 반환, 빈 partial이면 `backfillProgressTouchedAt`, ENOENT 삼킴이 모두 유지된다.

**왜 필요한가** — [추론: 이 PR 전에는 훅이 ultragoal 상태를 자주 쓰지 않았지만, Change Group 2
이후로는 pursuing 중 **모든** Stop이 `iteration` 이나 지문을 쓴다. CLI 쪽은 이미
`mergeWriteLocked` 를 통해 같은 파일에 락을 걸고 쓰고 있었으므로
(`head:skills/ultragoal/scripts/ultragoal-state.ts:294`), 락을 가진 작성자와 갖지 않은 작성자가
같은 파일을 두고 read-modify-write 를 경합하는 모양이 된다.]

**시스템 효과** — 훅의 상태 갱신이 CLI의 갱신을 덮어쓰거나 그 반대가 되는 창이 닫혔다. 대신 경합
시 이 함수는 **던진다** — 호출자인 `makeDecision` 은 이미 쓰기 실패를 삼키고 차단은 유지하는
구조라 실패해도 계속 차단으로 떨어진다.

**추적성** — `lib/persistent-mode-core/state.ts:206`

### `lib/persistent-mode-core/state-lock.test.ts`

**역할/변경 전 맥락** — 신규 파일.

**무엇이 바뀌었나** — 락의 네 가지 경계를 잡았다 (`head:lib/persistent-mode-core/state-lock.test.ts:15`).
살아 있는 소유자와의 경합은 콜백을 아예 실행하지 않고 실패하고
(`head:lib/persistent-mode-core/state-lock.test.ts:30`), 소유자 정보 없는 stale 락은 회수되며
(`head:lib/persistent-mode-core/state-lock.test.ts:45`), 소유 토큰이 바뀐 후계 락은 해제 시
보존되고 (`head:lib/persistent-mode-core/state-lock.test.ts:54`), 해제가 긴 recovery guard를
기다린 뒤에야 다음 작성자를 들여보낸다 (`head:lib/persistent-mode-core/state-lock.test.ts:66`).

**왜 필요한가** — [근거: 커밋 메시지 `fix: 상태 lock 해제 경합 방지`] — 마지막 케이스가 그 커밋이
고친 자리에 정확히 대응한다.

**시스템 효과** — "토큰이 다르면 남의 락을 지우지 않는다"는 불변식이 테스트로 고정됐다. 이 불변식이
없으면 stale 회수가 방금 생긴 후계 락을 지워 두 작성자가 동시에 들어간다.

**추적성** — `lib/persistent-mode-core/state-lock.test.ts:15`

### `lib/persistent-mode-core/state.test.ts`

**역할/변경 전 맥락** — 훅 상태 계층 테스트 (`base:lib/persistent-mode-core/state.test.ts:821`).

**무엇이 바뀌었나** — 두 가지다. 기존 `updateUltragoalState` 케이스에 `stories` 와
`approved_review_artifact_sha256` 를 심어 부분 갱신이 무관한 필드를 보존하는지 확인하고, 락 경합
케이스를 새로 넣었다 (`head:lib/persistent-mode-core/state.test.ts:926`) — 살아 있는 소유자의 락을
미리 만들어 두고 `updateUltragoalState` 를 부르면 `"ultragoal-state: state lock contended; refusing unlocked write"`
로 던지며 **파일 바이트가 그대로**임을 검사한다.

**왜 필요한가** — [추론: 이 함수는 예외를 던지는 대신 조용히 반환하는 경로를 여럿 갖고 있다(파일
부재, JSON 파싱 실패, ENOENT). 락 경합이 그 조용한 경로 중 하나로 흡수되면 fail-closed 의도가
무력해지므로, 던진다는 것과 바이트가 안 변한다는 것을 함께 못 박아야 한다.]

**시스템 효과** — 경합 시 "아무것도 안 씀"이 회귀로 고정됐다.

**추적성** — `lib/persistent-mode-core/state.test.ts:926`

---

## Change Group 5: 멈춘 추격에서 나올 문을 만든다

> 예고: 앞 그룹들이 만들어 낸 `budget_limited` 는 여전히 되돌릴 수 없는 상태이므로, 여기서 그 상태에서만 통하는 전이 명령 하나와 그 명령이 읽을 수 있는 상태 읽기 경로를 만든다.
> 순서: 무진전 상한이 실제로 `budget_limited` 를 만들게 된 뒤에야 "거기서 나올 문"이 필요해지고, 그 문의 쓰기 경로는 앞 그룹의 공유 락을 그대로 쓴다.

### `skills/ultragoal/scripts/ultragoal-state.ts`

**역할/변경 전 맥락** — ultragoal 스킬이 상태를 읽고 쓰는 CLI. 변경 전에는 락 구현을 이 파일이
직접 들고 있었고(`base:skills/ultragoal/scripts/ultragoal-state.ts:415`), `readGoalState` 는
`active:false` 인 상태를 무조건 `null` 로 접었다
(`base:skills/ultragoal/scripts/ultragoal-state.ts:567`).

**무엇이 바뀌었나** — 네 가지다.

1. **락 반출.** private 락 구현 약 125줄을 지우고 `@lib/persistent-mode-core/state-lock` 을
   import 한다 (`head:skills/ultragoal/scripts/ultragoal-state.ts:62`). Change Group 4가 만든
   그 모듈이다.
2. **재개 명령.** `resumePursuit(sessionId)` 를 추가했다
   (`head:skills/ultragoal/scripts/ultragoal-state.ts:697`). 락을 잡고, 파일을 읽고,
   `phase !== "budget_limited"` 이면 **던진다**. 통과하면 `phase: "pursuing"`, `active: true`,
   `iteration: 0`, `budget_limit_notified: false` 를 쓴다.
3. **읽기 경로 분리.** `readGoalState` 는 기존의 active-fold 계약을 유지하고
   (`head:skills/ultragoal/scripts/ultragoal-state.ts:407`), 종료 상태를 보존해 돌려주는
   `readGoalStateRaw` 를 새로 뺐다 (`head:skills/ultragoal/scripts/ultragoal-state.ts:414`).
   `status` 서브커맨드가 후자를 쓰도록 바뀌었다
   (`head:skills/ultragoal/scripts/ultragoal-state.ts:2226`).
4. **지문 보존.** `mergeWriteLocked` 가 `last_seen_head` / `last_seen_stories_digest` 를 명시적으로
   열거해 병합한다 (`head:skills/ultragoal/scripts/ultragoal-state.ts:340`).

**왜 필요한가** — 3번은 [추론: `budget_limited` 는 `active:false` 이므로 예전 `readGoalState` 를
통과하지 못한다. 그러면 `status` 가 `absent` 를 출력해 사용자가 "무엇에서 재개해야 하는지" 자체를
볼 수 없다. 재개 명령이 읽어야 할 상태와 active-fold 계약이 정면으로 부딪히므로 읽기 경로를 둘로
가르는 것 말고는 방법이 없다.] 4번은 [근거: 그 자리 주석 —
`"Progress fingerprints are caller-owned metadata. Enumerate them here so an unrelated merge write cannot silently drop the last observed values."`]

**시스템 효과** — `budget_limited → pursuing` 이라는 되돌림 간선이 처음 생겼다. 다른 어떤 phase에서
불러도 거부되므로 이 명령으로 `complete` 나 `blocked` 를 뒤집을 수는 없다. 지문 열거 덕분에
`set-verdict` 같은 무관한 쓰기가 진전 기준점을 날려 카운터를 잘못 리셋시키는 일도 막힌다.

**추적성** — `skills/ultragoal/scripts/ultragoal-state.ts:697`

### `skills/ultragoal/scripts/ultragoal-state.test.ts`

**역할/변경 전 맥락** — CLI 테스트.

**무엇이 바뀌었나** — 지문 관련 두 케이스와 재개 명령 describe 블록을 넣었다. 병합 쓰기가 지문을
보존하고 (`head:skills/ultragoal/scripts/ultragoal-state.test.ts:291`), 새 seed는 지문 필드를
넣지 않으며 (`head:skills/ultragoal/scripts/ultragoal-state.test.ts:309`), 재개 블록
(`head:skills/ultragoal/scripts/ultragoal-state.test.ts:1354`)에서는 `status` 가
`budget_limited` 를 보이고, `get` 은 active-fold 계약을 그대로 지키며, 재개가 상태를 복원하고
하트비트를 갱신하며, `budget_limited` 가 아닌 모든 phase에서 거부되고, 종료 상태 잠금이 새 seed
시도에도 살아남는지를 확인한다.

**왜 필요한가** — [추론: 재개 명령은 종료 상태를 되돌리는 유일한 간선이므로, 거부되어야 할 phase
목록 전체를 열거하지 않으면 "어느 상태에서 통하는가"가 문서상의 약속으로만 남는다. `get` 의 계약을
따로 검사하는 것도 같은 이유다 — 읽기 경로를 둘로 가르면서 기존 계약이 조용히 바뀌었을 위험이 생겼다.]

**시스템 효과** — 읽기 경로 분리가 기존 `get` 소비자를 깨지 않았음이 고정됐다.

**추적성** — `skills/ultragoal/scripts/ultragoal-state.test.ts:1354`

---

## Change Group 6: 그 문의 열쇠를 사람에게만 준다

> 예고: 앞 그룹이 만든 전이 명령은 AI가 스스로 실행하면 자기 정지를 자기가 푸는 것이 되므로, 여기서 그 명령을 기존의 사용자 전용 deny 목록에 편입하고 양 플랫폼에서 실제로 막히는지 확인한다.
> 순서: 막을 명령이 존재해야 목록에 넣을 수 있으므로 이 그룹은 명령이 만들어진 다음에만 성립한다.

### `hooks/write-guard-core.sh`

**역할/변경 전 맥락** — Claude와 Codex 가드가 공유하는 셸 코어. 변경 전에는 사용자 전용 명령이
`approve-review-dispatch-renewal` 과 `dismiss-review-finding` 둘이었다
(`base:hooks/write-guard-core.sh:246`).

**무엇이 바뀌었나** — 그 case 패턴에 세 번째 항목을 추가하고
(`head:hooks/write-guard-core.sh:247`) 주석의 "두 개"를 "세 개"로 고쳤다
(`head:hooks/write-guard-core.sh:208`).

**왜 필요한가** — [근거: 같은 주석이 편입 기준을 직접 말한다 —
`"All three let the loop clear its own completion gate, so leaving them to prose (\"run this only after the user approves\") makes the authorization vigilance-based"`]

**시스템 효과** — 재개 명령의 권한이 프롬프트의 약속이 아니라 훅의 거부가 됐다. 이 코어가 이미
따옴표·변수 간접·공백·인자 순서 뒤바뀜 같은 우회 형태를 처리하고 있으므로, 새 명령도 그 처리를
그대로 물려받는다.

**추적성** — `hooks/write-guard-core.sh:247`

### `hooks/write-guard-core_test.sh`

**역할/변경 전 맥락** — 코어 테스트. 기존 두 명령에 대해 직접·변수 간접·순서 뒤바뀜·공백 네 형태를
이미 덮고 있었다 (`base:hooks/write-guard-core_test.sh:560`).

**무엇이 바뀌었나** — 새 명령에 대해 같은 네 형태를 그대로 복제했다
(`head:hooks/write-guard-core_test.sh:584`, 등록은 `head:hooks/write-guard-core_test.sh:1097`).

**왜 필요한가** — [추론: 기존 두 명령의 테스트가 정확히 이 네 형태로 짜여 있고, 형태별 우회는
과거에 실제로 통과했던 이력이 파일 안 주석으로 남아 있다(`base:hooks/write-guard-core.sh:224`).
새 명령만 형태 커버리지가 얕으면 같은 우회가 새 명령에서 다시 열린다.]

**시스템 효과** — 세 명령의 우회 커버리지가 같은 폭으로 맞춰졌다.

**추적성** — `hooks/write-guard-core_test.sh:584`

### `hooks/codex-write-guard_test.sh`

**역할/변경 전 맥락** — Codex 가드 shim 테스트 (`base:hooks/codex-write-guard_test.sh:1439`).

**무엇이 바뀌었나** — Codex shim을 실제로 통과시키는 같은 네 형태를 추가했다
(`head:hooks/codex-write-guard_test.sh:1445`, 등록은 `head:hooks/codex-write-guard_test.sh:2715`).

**왜 필요한가** — [근거: 커밋 메시지 `test: Codex pursuit 재개 차단 검증 추가`] 및 [근거: 추가된
테스트 위 주석 — `"the Codex shim must route the whole Bash command through the shared deny for resume-pursuit, including the same indirection/order/whitespace shapes covered by the core tests."`]

**시스템 효과** — 코어가 deny를 낸다는 사실과 Codex shim이 그 deny를 실제로 밖으로 내보낸다는
사실이 분리 검증됐다. 코어만 통과하고 shim이 결과를 흘리는 배선 결함은 코어 테스트로는 안 잡힌다.

**추적성** — `hooks/codex-write-guard_test.sh:1445`

### `hooks/pre-tool-enforcer_test.sh`

**역할/변경 전 맥락** — Claude 가드 shim 테스트. Bash 페이로드를 만드는 헬퍼가 이미 있다
(`base:hooks/pre-tool-enforcer_test.sh:804`).

**무엇이 바뀌었나** — Claude 배선 케이스 하나를 추가했다
(`head:hooks/pre-tool-enforcer_test.sh:810`, 등록은 `head:hooks/pre-tool-enforcer_test.sh:1947`).

**왜 필요한가** — [추론: Codex shim에 네 형태를 넣으면서 Claude shim에 아무것도 넣지 않으면 두
플랫폼의 검증 폭이 어긋난다. Claude 쪽은 형태별 우회를 코어 테스트가 이미 덮으므로 shim에서 확인할
것은 "코어의 deny에 도달하는가" 하나뿐이고, 테스트 이름
(`..._reaches_claude_shared_guard`)도 그 범위로 적혀 있다.]

**시스템 효과** — 두 플랫폼 모두 새 명령에서 deny가 밖으로 나온다는 것이 고정됐다.

**추적성** — `hooks/pre-tool-enforcer_test.sh:810`

---

## Change Group 7: 바뀐 계약을 읽는 사람과 AI 양쪽에 다시 적는다

> 예고: 앞 그룹들이 카운터의 의미·정지의 성격·재개의 권한을 모두 바꿔 놓았으므로, 그 세 가지를 옛 의미로 설명하던 문서 열 개를 새 계약으로 갈아 끼운다.
> 순서: 계약을 실제로 강제하는 코드와 가드가 모두 자리 잡은 뒤에 문서를 고쳐야 문서가 아직 없는 동작을 약속하지 않는다.

### `skills/ultragoal/SKILL.md`

**역할/변경 전 맥락** — ultragoal 오케스트레이터가 매번 읽는 프롬프트. 서브커맨드 표와 시스템 전용
setter 설명이 들어 있다 (`base:skills/ultragoal/SKILL.md:40`).

**무엇이 바뀌었나** — 서브커맨드 표에 재개 명령 행을 넣고(권한 칸은 **user only**), 카운터 계약
문단을 추가했다 (`head:skills/ultragoal/SKILL.md:43`).

**왜 필요한가** — [추론: 이 파일은 오케스트레이터가 실행 중 참조하는 유일한 명령 목록이다. 여기
없는 명령은 AI가 사용자에게 제시할 수도 없으므로, 가드가 AI 실행을 막는 것만으로는 재개 경로가
도달 불가능해진다.]

**시스템 효과** — AI가 정지 상황에서 사용자에게 무엇을 제시해야 하는지 알게 됐다.

**추적성** — `skills/ultragoal/SKILL.md:43`

### `skills/ultragoal/references/planning.md`

**역할/변경 전 맥락** — 계획 단계 슬롯 정의. `max_iterations` 를 "pursuit blocks 의 유한 상한"이자
"유일한 소프트 정지 경계"로 적고 있었다 (`base:skills/ultragoal/references/planning.md:15`).

**무엇이 바뀌었나** — 같은 항목을 "**연속 무진전 Stop 턴**의 상한"으로 다시 쓰고, 리셋 조건 두 개와
대기 미집계, 재개 경로를 명시했다 (`head:skills/ultragoal/references/planning.md:15`).

**왜 필요한가** — [근거: 변경 전 문장이 `"the finite cap on pursuit blocks"` 라고 적혀 있어 새
동작과 정면으로 어긋난다.]

**시스템 효과** — 계획 단계에서 `--max-iterations` 를 정할 때의 의미가 달라졌다. 같은 10이라도
"총 10턴"이 아니라 "연속 10턴 정체"를 뜻한다.

**추적성** — `skills/ultragoal/references/planning.md:15`

### `skills/ultragoal/references/completion-gate.md`

**역할/변경 전 맥락** — 완료 게이트 참조 문서. 변경 전에는 `"there is no cross-iteration stall detector; max_iterations absorbs genuine stalls"`
라고 적고 있었다 (`base:skills/ultragoal/references/completion-gate.md:155`).

**무엇이 바뀌었나** — 두 문단이다. blocked-stop 설명에서 위 문장을 지우고 무진전 상한을 별개
소프트 정지로 구분했다 (`head:skills/ultragoal/references/completion-gate.md:155`). 그리고 완료
경로 문단에 드레인 절차를 넣었다 (`head:skills/ultragoal/references/completion-gate.md:134`) —
`budget_limited` 상태에서도 완료 요청은 가능하되, 진행 중인 위임 작업을 끝까지 받아 커밋한 뒤
게이트를 돌리고, 그 동안 새 Story를 던지거나 실행자를 끊지 말라는 것.

**왜 필요한가** — [근거: 삭제된 원문 `"there is no cross-iteration stall detector"` 가 이 PR이
정확히 추가한 것(교차 반복 정체 감지)과 모순된다.]

**시스템 효과** — 정지 종류가 문서상 둘로 갈렸다. `blocked` 는 여전히 그 순간에 판정 가능한
조건 — 실행 가능한 미완료 항목이 하나도 없거나, 계획 단계에서 설정한 `blocked-stop` 조건이
충족되거나 — 이고, `budget_limited` 는 이제 교차 반복 정체다. 드레인 절차는 Change Group 2의 대기
메시지와 같은 지시를 사람이 읽는 쪽에도 적은 것이다.

**추적성** — `skills/ultragoal/references/completion-gate.md:155`

### `CLAUDE.md`

**역할/변경 전 맥락** — 저장소 최상위 안내. 전제 조건이 `bun`, `bash`, `jq` 셋이었고
(`base:CLAUDE.md:33`), 훅 목록의 persistent-mode 항목은 한 줄 설명뿐이었다
(`base:CLAUDE.md:134`).

**무엇이 바뀌었나** — `sqlite3` 를 전제 조건에 추가하고 fail-open 성질을 적은 문단을 넣었다
(`head:CLAUDE.md:39`). persistent-mode 항목에 무진전 계약 요약을 붙이고
(`head:CLAUDE.md:139`), 사용자 전용 명령 목록을 셋으로 갱신했다 (`head:CLAUDE.md:140`).

**왜 필요한가** — [근거: 추가된 문단이 근거를 스스로 적는다 —
`"sqlite3 is a runtime prerequisite for Codex's active-ultragoal child detector."`]

**시스템 효과** — Change Group 3의 감지기가 새 런타임 의존을 들여왔다는 사실이 저장소 최상위에
드러났다.

**추적성** — `CLAUDE.md:39`

### `README.md`

**역할/변경 전 맥락** — 한국어 설치 안내의 요구사항 목록.

**무엇이 바뀌었나** — `sqlite3` 항목을 추가하고, `jq` 설명의 "조용히 열림"을 "차단하지 않음"으로
바꿨다 (`head:README.md:73`).

**왜 필요한가** — [추론: `sqlite3` 추가는 `CLAUDE.md` 와 같은 근거다. `jq` 문구 변경은 이 PR이
새 fail-open 사례를 하나 더 들여오면서 두 항목의 서술을 같은 어휘로 맞춘 것으로 보인다 —
"조용히 열림"과 "0건을 세고 진단 1건 출력"은 같은 성질의 다른 표현이다.]

**시스템 효과** — 설치 단계에서 누락되면 Codex 감지기가 항상 0을 센다는 것이 사용자에게 보인다.

**추적성** — `README.md:73`

### `README.en.md`

**역할/변경 전 맥락** — `README.md` 의 영어판.

**무엇이 바뀌었나** — 같은 두 줄을 영어로 반영했다 (`head:README.en.md:73`).

**왜 필요한가** — [추론: 이 저장소는 한/영 문서를 쌍으로 유지한다. 이 PR 안에서만도
`ORCHESTRATION`, `core-pipeline`, `README` 세 쌍이 모두 같은 커밋으로 함께 갱신됐다.]

**시스템 효과** — 두 판이 같은 전제 조건을 말한다.

**추적성** — `README.en.md:73`

### `docs/ORCHESTRATION.md`

**역할/변경 전 맥락** — 오케스트레이션 개요. 트러블슈팅 표의 "Sisyphus가 멈추지 않음" 행이
"설계된 대로입니다. 검증 통과까지 지속됩니다."로만 답하고 있었다.

**무엇이 바뀌었나** — ultragoal 절에 "반복 예산·진전 없음·재개" 소절을 신설하고
(`head:docs/ORCHESTRATION.md:108`), 실행 흐름 절에 요약 문단을 넣고, 트러블슈팅 답을 새 동작으로
고쳤다 (`head:docs/ORCHESTRATION.md:214`).

**왜 필요한가** — [추론: 변경 전 트러블슈팅 답은 "멈추지 않는다"를 사양으로 제시하는데, 이 PR
이후에는 연속 무진전 10회에서 실제로 멈춘다. 그 답을 고치지 않으면 사용자가 정상 정지를 고장으로
읽게 된다.]

**시스템 효과** — 정지가 언제 일어나는지가 문서에서 답이 있는 질문이 됐다.

**추적성** — `docs/ORCHESTRATION.md:108`

### `docs/ORCHESTRATION.en.md`

**역할/변경 전 맥락** — 위 문서의 영어판.

**무엇이 바뀌었나** — 같은 세 자리를 영어로 반영했다 (`head:docs/ORCHESTRATION.en.md:108`,
`head:docs/ORCHESTRATION.en.md:167`, `head:docs/ORCHESTRATION.en.md:214`).

**왜 필요한가** — [근거: 커밋 메시지 `docs: 무진전 계약 양언어 문서 반영`]

**시스템 효과** — 한/영 판이 같은 계약을 말한다.

**추적성** — `docs/ORCHESTRATION.en.md:108`

### `docs/skills/core-pipeline.md`

**역할/변경 전 맥락** — 핵심 스킬 파이프라인 문서. 리뷰 finding 무효화 절 다음이 곧바로 보조 스킬
절이었다.

**무엇이 바뀌었나** — 그 사이에 "ultragoal 반복 예산·진전 없음·재개" 소절을 넣었다
(`head:docs/skills/core-pipeline.md:188`).

**왜 필요한가** — [추론: 이 문서는 완료 게이트와 그 탈출구들(리뷰 dispatch 갱신, finding 무효화)을
한자리에 모아 설명한다. 재개 명령은 그 두 명령과 같은 사용자 전용 등급이므로 같은 자리에 놓이지
않으면 세 개 중 하나만 다른 문서에 흩어진다.]

**시스템 효과** — 사용자 전용 명령 셋이 한 문서에서 함께 보인다.

**추적성** — `docs/skills/core-pipeline.md:188`

### `docs/skills/core-pipeline.en.md`

**역할/변경 전 맥락** — 위 문서의 영어판.

**무엇이 바뀌었나** — 같은 소절을 영어로 넣었다 (`head:docs/skills/core-pipeline.en.md:188`).

**왜 필요한가** — [근거: 커밋 메시지 `docs: 무진전 계약 양언어 문서 반영`]

**시스템 효과** — 한/영 판이 같은 절 구성을 갖는다.

**추적성** — `docs/skills/core-pipeline.en.md:188`

---

## Change Group 8: 같이 실린 별개의 테스트 안정화

> 예고: 앞 그룹까지가 무진전 제어라는 하나의 이야기였다면, 이 그룹은 그 이야기에 속하지 않으면서 같은 PR에 실린 변경 하나를 따로 떼어 놓는다.
> 순서: 앞의 어느 그룹과도 의존이 없으므로 맨 뒤에 두고, 무진전 제어를 읽는 흐름을 끊지 않게 한다.

### `skills/design-review/scripts/job.test.ts`

**역할/변경 전 맥락** — design-review 잡 수명주기 테스트. `stop` 을 부른 뒤 곧바로 `clean` 을
불렀다 (`base:skills/design-review/scripts/job.test.ts:94` 등).

**무엇이 바뀌었나** — `waitForStableTerminal(jobDir, stableMs = 500)` 헬퍼를 추가하고
(`head:skills/design-review/scripts/job.test.ts:38`) 기존 케이스 넷의 `stop` 과 `clean` 사이에
끼워 넣었다. 헬퍼는 모든 멤버의 `status.json` 이 `queued`/`running`/`retrying`/`awaiting_resume`
밖의 상태가 되고 그 상태가 500ms 유지될 때까지 최대 15초 기다린다. `sleep 0.5` 를 멤버 명령으로
쓰는 회귀 케이스도 새로 넣었다 (`head:skills/design-review/scripts/job.test.ts:173`).

**왜 필요한가** — [근거: 헬퍼 위 주석 —
`"Detached workers can still be in their queued startup window after stop returns. Keep the job directory until the terminal state has been stable long enough for that worker process to exit, then clean can safely enforce its active-member guard without racing the worker's final status write."`]

**시스템 효과** — 이 PR이 건드린 어떤 실행 경로와도 무관하다. 테스트 레이스만 닫는다. `clean` 이
활성 멤버를 거부하는 동작 자체는 의도된 것으로 남아 있고, 테스트가 그 거부를 피해 가도록 기다릴 뿐이다.

**추적성** — `skills/design-review/scripts/job.test.ts:38`

---

## 열린 질문

문서화하지 못한 것들이다. diff·커밋 메시지·주석·인접 코드를 뒤졌으나 근거를 찾지 못했다.

1. **rollout tail 크기가 왜 64KB인가.** `ROLLOUT_TAIL_BYTES = 64 * 1024`
   (`head:hooks/codex-persistent-mode/cli.ts:71`)에 그 값을 고른 근거가 없다. 이 값이 작으면
   5번 규칙(마커 없는 큰 파일은 살아 있다고 센다)이 더 자주 발동해 감지가 보수적으로 기울고, 크면
   Stop마다 읽는 바이트가 는다. 어느 쪽을 겨냥한 값인지 — **Unknown / not supplied**.
2. **자식 stale TTL이 왜 30분인가.** `CODEX_CHILD_STALE_TTL_SECONDS` 가 `TERMINAL_TTL_SECONDS`
   (1800초)를 재사용한다. 상수를 통합했다는 사실은 커밋 메시지 `fix: Codex 자식 TTL 상수 통합` 에
   근거가 있지만, 자식 rollout의 생존 판정에 상태파일 GC용 TTL이 적합한 값인지에 대한 근거는
   **Unknown / not supplied**.
3. **design-review 테스트 수정이 왜 이 PR에 실렸는가.** Change Group 8은 무진전 제어와 코드 경로가
   겹치지 않는다. 같은 브랜치에서 CI가 깨져 함께 고쳤을 가능성이 있으나, 그 연결을 말하는 커밋
   메시지나 주석이 없다 — **Unknown / not supplied**.

---

## Quiz

퀴즈는 이 문서를 읽은 뒤 서술형 단답으로 답한다. 선택지는 제공하지 않는다.

**필수 개념 11개, 문항 14개** — 상한 20개 아래이므로 잘라낸 문항은 없다.

### 개념 1 — `evidence-classification` (Evidence)

**Q1.** 이 diff에서 noise 기본 규칙표에 걸린 것은 파일이 아니라 hunk였다. 그 hunk가 몇 개이고
어느 파일 안에 있었는지, 그리고 그 사실이 그 파일의 분류를 왜 바꾸지 않았는지 답하라.

| 루브릭 항목 |
|---|
| ① 2개이고 `lib/persistent-mode-core/decision.ts` 안에 있다 (문서를 읽어야 아는 구체값) |
| ② 그 hunk들은 동작을 바꾸지 않는 prettier 줄바꿈이다 |
| ③ 같은 파일의 다른 hunk가 signal이므로 파일 단위 분류는 signal로 남는다 |

### 개념 2 — `counter-semantics` (Intuition, Change Group 2)

**Q2.** 변경 전과 변경 후에 `iteration` 이 각각 무엇을 세는지 한 문장씩 쓰고, 커밋을 세 번 만들며
순조롭게 진행한 Stop 3회 뒤의 `iteration` 값이 각각 얼마인지 답하라.

| 루브릭 항목 |
|---|
| ① 변경 전 = pursuing 중 차단된 Stop 횟수 / 변경 후 = **연속** 무진전 Stop 횟수 |
| ② 변경 전 3, 변경 후 0 (문서를 읽어야 아는 구체값) |

**Q3.** 진전이 관찰되면 훅은 사용자가 턴을 끝내도록 허용하는가? 실제 반환 동작과 그때 메시지에
찍히는 카운터 표기를 답하라.

| 루브릭 항목 |
|---|
| ① 허용하지 않는다 — 여전히 block 이다 |
| ② 메시지는 `[ULTRAGOAL - NO-PROGRESS 0/10]` 형태다 (문서를 읽어야 아는 구체값) |

### 개념 3 — `progress-predicate` (Change Group 1)

**Q4.** `evaluateProgress` 가 커밋 축에서 진전이라고 판정하려면 두 가지 검사를 통과해야 한다. 두
검사를 순서대로 쓰고, 두 번째 검사가 어떤 종료코드를 진전으로 읽는지 답하라.

| 루브릭 항목 |
|---|
| ① 저장된 `last_seen_head` 가 현재 HEAD의 조상인지 (`merge-base --is-ancestor`) |
| ② `git diff --quiet <prior>..<head>` 의 종료코드가 `1` 일 때 진전 (문서를 읽어야 아는 구체값) |
| ③ 두 검사는 순서가 있고 조상 검사가 먼저다 |

**Q5.** 커밋을 하나 만든 뒤 그것을 revert 한 상태에서 Stop이 오면 진전으로 잡히는가? 같은 판정이
적용되는 다른 히스토리 조작 두 가지를 함께 들어라.

| 루브릭 항목 |
|---|
| ① 진전이 아니다 |
| ② amend, rebase (문서를 읽어야 아는 구체값) |

### 개념 4 — `fingerprint-asymmetry` (Intuition, Change Group 2)

**Q6.** 진전이 있을 때와 없을 때 지문 필드에 하는 일이 다르다. 두 경우의 차이를 쓰고, 그 차이 때문에
"무엇과 비교하는가"의 기준점이 어디가 되는지 답하라.

| 루브릭 항목 |
|---|
| ① 진전이면 관측값으로 덮어쓰고(`persistedFingerprint`), 무진전이면 비어 있을 때만 초기화한다(`fingerprintPatch`) (문서를 읽어야 아는 구체값) |
| ② 기준점은 직전 Stop이 아니라 마지막으로 진전이 관찰된 시점이다 |

### 개념 5 — `background-wait-asymmetry` (Change Group 2, 3)

**Q7.** 백그라운드 작업이 도는 중에 Stop이 오면 Claude와 Codex의 동작이 갈린다. 두 플랫폼의 결과를
각각 쓰고, 그 갈림을 만드는 `DecisionContext` 필드 이름과 두 플랫폼이 넣는 값을 답하라.

| 루브릭 항목 |
|---|
| ① Claude는 변경 전과 같이 멈추게 허용, Codex는 대기 메시지로 차단 |
| ② 필드는 `deferredStopWakeGuaranteed`, Claude는 `true` / Codex는 `false` (문서를 읽어야 아는 구체값) |
| ③ 어느 쪽이든 그 턴은 무진전 카운터를 소비하지 않는다 |

### 개념 6 — `codex-child-detector` (Change Group 3)

**Q8.** Codex 자식 감지기가 rollout 파일을 읽을 때 tail에서 마커를 하나도 못 찾았다. 이때 그 자식을
살아 있다고 셀 조건이 무엇이고, 그렇게 보수적으로 판정하는 이유가 무엇인지 답하라.

| 루브릭 항목 |
|---|
| ① 파일 크기가 `ROLLOUT_TAIL_BYTES`(64KB)보다 클 때만 살아 있다고 센다 (문서를 읽어야 아는 구체값) |
| ② 방금 열린 rollout은 최초 `task_started` 마커가 tail 바깥에 있을 수 있기 때문 |
| ③ tail 안에 종료 마커가 있으면 그쪽이 이긴다 |

**Q9.** 이 감지기는 `sqlite3` 가 없거나 DB가 없거나 출력이 깨졌을 때 어떻게 동작하는가. 세는 값과
부수 효과, 그리고 그 결과 발생할 수 있는 최악의 오판을 답하라.

| 루브릭 항목 |
|---|
| ① 0을 세고 stderr에 진단을 **1건** 낸다 (문서를 읽어야 아는 구체값) |
| ② 최악의 오판은 대기 중인 턴을 무진전으로 세는 것이지, 영원히 멈추지 않는 것이 아니다 |

### 개념 7 — `shared-state-lock` (Change Group 4)

**Q10.** 이 PR 전에는 상태 파일을 쓰는 두 주체 중 한쪽만 락을 갖고 있었다. 락이 없던 쪽이 어느
함수였는지, 그리고 왜 이 PR에서야 그 경합이 실제 문제가 됐는지 답하라.

| 루브릭 항목 |
|---|
| ① 락이 없던 쪽은 훅 경로의 `updateUltragoalState` (문서를 읽어야 아는 구체값) |
| ② 이 PR 이후 pursuing 중 모든 Stop이 `iteration` 이나 지문을 쓰게 되어 훅의 쓰기 빈도가 올라갔기 때문 |

**Q11.** `withStateLock` 이 100회 재시도 뒤에도 락을 못 잡으면 어떻게 하는가. 그리고
`releaseStateLock` 이 한 번 시도에서 무한 대기 루프로 바뀐 이유를 답하라.

| 루브릭 항목 |
|---|
| ① 락 없는 쓰기로 물러서지 않고 예외를 던진다 (fail-closed) |
| ② 한 번만 시도하고 돌아가면 자기 primary 락을 남기게 되고, 그 락은 30초 TTL이 지나야 회수된다 (문서를 읽어야 아는 구체값) |

### 개념 8 — `resume-edge` (Change Group 5)

**Q12.** 재개 명령이 성공적으로 실행됐을 때 상태 파일에 쓰이는 필드 네 개와 그 값을 쓰고, 이 명령이
거부되는 조건을 답하라.

| 루브릭 항목 |
|---|
| ① `phase: pursuing`, `active: true`, `iteration: 0`, `budget_limit_notified: false` (문서를 읽어야 아는 구체값) |
| ② `phase` 가 `budget_limited` 가 아닌 모든 경우에 던진다 |

**Q13.** 이 PR은 `readGoalState` 를 그대로 두고 `readGoalStateRaw` 를 따로 만들었다. 왜 기존 함수를
고치지 않고 갈랐는지, 그리고 어느 서브커맨드가 새 함수를 쓰게 됐는지 답하라.

| 루브릭 항목 |
|---|
| ① `budget_limited` 는 `active:false` 라 기존 active-fold 계약에서 `null` 로 접히는데, 기존 계약을 쓰는 소비자(`get`)를 깨지 않아야 하기 때문 |
| ② `status` 서브커맨드가 새 함수를 쓴다 (문서를 읽어야 아는 구체값) |

### 개념 9 — `user-only-authority` (Change Group 6)

**Q14.** 재개 명령이 사용자 전용 deny 목록에 들어간 기준은 무엇이고, 그 목록에 이미 있던 명령
두 개는 무엇인가.

| 루브릭 항목 |
|---|
| ① 기준은 "루프가 자기 완료 게이트를 스스로 열 수 있는 명령"이다 |
| ② 기존 두 명령은 `approve-review-dispatch-renewal` 과 `dismiss-review-finding` (문서를 읽어야 아는 구체값) |

### 개념 10 — `contract-docs` (Change Group 7)

**Q15.** 문서 중 한 곳은 이 PR이 추가한 기능과 정면으로 모순되는 문장을 갖고 있어서 삭제됐다. 어느
문서의 어떤 문장이었는지 답하라.

| 루브릭 항목 |
|---|
| ① `skills/ultragoal/references/completion-gate.md` 의 blocked-stop 절 (문서를 읽어야 아는 구체값) |
| ② 삭제된 문장은 "교차 반복 정체 감지기는 없다"(`there is no cross-iteration stall detector`)는 취지 |

### 개념 11 — `unrelated-bundled-change` (Change Group 8)

**Q16.** 이 PR에 실렸지만 무진전 제어와 코드 경로가 겹치지 않는 파일이 하나 있다. 그 파일이 고친
문제와, 그 문제를 고치기 위해 도입한 대기 조건을 답하라.

| 루브릭 항목 |
|---|
| ① `skills/design-review/scripts/job.test.ts` — `stop` 이 돌아온 뒤에도 detached worker가 queued 시작 창에 남아 있어 `clean` 과 레이스가 났다 |
| ② 모든 멤버가 종료 상태가 되고 그 상태가 500ms 유지될 때까지(최대 15초) 기다린다 (문서를 읽어야 아는 구체값) |

# ultragoal 무진전 실행 제어 — 변경 설명

대상 range: `acd90900^..acd90900` (PR #243 `toongri/scalloped-account` 병합, 커밋 23개)
저장소: oh-my-toong (`/Users/toong/.omt/oh-my-toong-playground/explain-diff-eval/fixtures/giant-pr`)
병합 커밋 제목: `feat: ultragoal 무진전 실행 제어 추가`

---

## Evidence

`git diff --name-status acd90900^..acd90900` 결과 29개 파일. 그중 `A`(신규 추가)는 4개다.

| 분류 | 파일 | 상태 | 비고 |
|---|---|---|---|
| signal | `lib/persistent-mode-core/progress.ts` | A | 진전 판정기 (신규) |
| signal | `lib/persistent-mode-core/progress.test.ts` | A | 진전 판정기 테스트 (신규) |
| signal | `lib/persistent-mode-core/state-lock.ts` | A | 상태 파일 락 (신규) |
| signal | `lib/persistent-mode-core/state-lock.test.ts` | A | 상태 파일 락 테스트 (신규) |
| signal | `lib/persistent-mode-core/types.ts` | M | 지문 필드 2개 추가 |
| signal | `lib/persistent-mode-core/decision.ts` | M | 카운터 의미 교체·대기 분기 |
| signal | `lib/persistent-mode-core/decision.test.ts` | M | 위 두 축의 회귀 검증 |
| signal | `lib/persistent-mode-core/state.ts` | M | 갱신 경로를 락 안으로 |
| signal | `lib/persistent-mode-core/state.test.ts` | M | 락 경합 실패 검증 |
| signal | `hooks/persistent-mode/index.ts` | M | Claude 쪽 깨우기 보장 선언 |
| signal | `hooks/codex-persistent-mode/cli.ts` | M | Codex 자식 작업 감지기 |
| signal | `hooks/codex-persistent-mode/cli.test.ts` | M | 감지기 진리표 검증 |
| signal | `hooks/write-guard-core.sh` | M | 사용자 전용 명령 deny 확장 |
| signal | `hooks/write-guard-core_test.sh` | M | 공유 가드 회귀 4건 |
| signal | `hooks/pre-tool-enforcer_test.sh` | M | Claude 배선 검증 1건 |
| signal | `hooks/codex-write-guard_test.sh` | M | Codex 배선 검증 4건 |
| signal | `skills/ultragoal/scripts/ultragoal-state.ts` | M | 재개 명령·락 이관·지문 보존 |
| signal | `skills/ultragoal/scripts/ultragoal-state.test.ts` | M | 재개 경로 검증 |
| signal | `skills/ultragoal/SKILL.md` | M | 계약 문서 |
| signal | `skills/ultragoal/references/completion-gate.md` | M | 계약 문서 |
| signal | `skills/ultragoal/references/planning.md` | M | 계약 문서 |
| signal | `CLAUDE.md` | M | 계약·전제조건 문서 |
| signal | `README.md` | M | 전제조건 문서 |
| signal | `README.en.md` | M | 전제조건 문서(영문) |
| signal | `docs/ORCHESTRATION.md` | M | 계약 문서 |
| signal | `docs/ORCHESTRATION.en.md` | M | 계약 문서(영문) |
| signal | `docs/skills/core-pipeline.md` | M | 계약 문서 |
| signal | `docs/skills/core-pipeline.en.md` | M | 계약 문서(영문) |
| signal | `skills/design-review/scripts/job.test.ts` | M | 같은 병합에 실린 별개 수정 |
| noise | — | — | 파일 단위 noise 없음 |

**파일 단위 noise가 0인 이유** — 이 diff에는 규칙표(`*.lock`, `dist/`, `__snapshots__/`, `*.generated.*`)에 걸리는 파일이 하나도 없다. 생성물도 잠금파일도 스냅샷도 손대지 않았다.

**hunk 단위 noise** — 규칙표의 "포맷팅만 바뀐 hunk" 조항으로 아래 세 자리를 제외한다. 셋 다 prettier 재배치일 뿐 동작이 바뀌지 않는다.

| 파일 | 자리 | 무엇 |
|---|---|---|
| `lib/persistent-mode-core/decision.ts` | `nonGoals.filter(...).length` | 줄바꿈 위치만 이동 |
| `lib/persistent-mode-core/decision.ts` | `buildSkillChainContinuationMessage` 호출 | 인자를 여러 줄로 |
| `lib/persistent-mode-core/decision.test.ts` | `toBe("3")`·`components: [...]` | 인자 줄바꿈 |
| `hooks/codex-persistent-mode/cli.ts` | `recordSkillChain`의 `writeFileSync` | 객체 리터럴 줄바꿈 |

---

## Background

### 깊은 배경

이미 익숙하면 건너뛰세요.

oh-my-toong(OMT)은 스킬·에이전트·훅을 한곳에서 정의해 Claude Code / Codex CLI 같은 여러 AI 하네스로 배포하는 설정 관리 저장소다. 이 변경을 읽으려면 그중 세 가지 개념만 알면 된다.

**Stop 훅.** AI가 한 턴을 끝내려 할 때 하네스가 부르는 후크다. 훅은 두 가지 답 중 하나를 낸다 — `continue`(끝내도 좋다) 또는 `block`(끝내지 마라, 이 메시지를 읽고 계속해라). OMT의 `persistent-mode`(Claude용)와 `codex-persistent-mode`(Codex용)가 이 자리를 쓰며, 판단 로직 자체는 두 하네스가 `makeDecision` 하나를 공유한다.

**ultragoal.** 목표 하나를 여러 Story(작업 단위)로 쪼개 순차 실행하는 자율 실행 스킬이다. 진행 상태는 세션마다 하나의 JSON 파일(`$OMT_DIR/ultragoal-state-<세션ID>.json`)에 들어 있고, `phase` 필드가 `planning → pursuing → complete`(또는 `budget_limited`, `blocked`)로 움직인다. 이 파일을 읽고 쓰는 주체는 둘이다 — Stop 훅과, 스킬이 부르는 CLI(`ultragoal-state.ts`).

**PreToolUse 가드.** 특정 도구 호출을 실행 **전에** 거부하는 후크다. OMT는 이걸로 "AI가 자기 완료 게이트를 스스로 열어젖히는" 경로를 구조적으로 막는다. 산문으로 "사용자 승인 후에만 실행하라"고 적어 두면 그건 결국 AI의 자기 절제에 기대는 것이므로, 대신 AI의 Bash 경로에서 그 명령을 아예 deny 하고 사용자가 직접 터미널에서 치게 한다.

### 좁은 배경

`ultragoal`에는 `max_iterations`라는 상한이 있고 기본값은 10이다. 이 PR 이전에 `iteration`이 세던 것은 **pursuit가 block된 횟수**였다. Stop 훅이 "아직 목표 미달"이라고 판단해 block할 때마다 1씩 올라갔고, 10에 닿으면 `budget_limited`로 소프트 정지했다.

그 계산의 문제는 진전을 세지 않는다는 데 있다. 실제로 코드를 커밋하며 잘 굴러가던 pursuit도 10번 block되면 똑같이 멈췄고, 반대로 백그라운드 작업이 끝나기를 기다리느라 아무것도 안 한 턴도 예산을 똑같이 한 칸씩 먹었다. 변경 전 `references/planning.md`는 이 상한을 "the finite cap on pursuit blocks"라고, `completion-gate.md`는 "there is no cross-iteration stall detector; `max_iterations` absorbs genuine stalls"라고 적고 있었다.

또 하나. `budget_limited`에 닿으면 되살릴 길이 없었다. `phase`를 `pursuing`으로 되돌리는 명령 자체가 존재하지 않았다.

Codex 쪽에는 세 번째 문제가 있었다. `makeDecision`은 `activeBackgroundTaskCount > 0`이면 Stop을 그냥 통과시키는데, Codex CLI는 그 값을 **언제나 0**으로 넘기고 있었다. Codex에는 "턴을 끝내도 백그라운드가 끝나면 다시 불러 준다"는 보장이 없어서 통과가 곧 방치이기 때문이었다.

---

## Intuition

바뀐 것은 한 문장으로 줄어든다. **`iteration`이 "몇 번 block됐나"에서 "연속으로 몇 번 아무 진전 없이 멈추려 했나"로 바뀌었다.**

그 한 문장을 성립시키려면 두 가지가 필요하다. 진전을 기계가 볼 수 있는 값으로 만드는 것, 그리고 그 값을 매 Stop마다 상태 파일에 안전하게 적어 두는 것.

### 1. Before / After — 같은 10, 다른 의미

<div style="display:flex;gap:12px;flex-wrap:wrap;margin:1rem 0">
  <div style="flex:1;min-width:260px;border:1px solid #bbb;border-radius:8px;padding:12px">
    <div style="font-weight:700;margin-bottom:8px">변경 전 — block을 센다</div>
    <table style="width:100%;font-size:13px">
      <tr><th align="left">Stop</th><th align="left">한 일</th><th align="right">iteration</th></tr>
      <tr><td>1</td><td>커밋 <code>a1</code> 남김</td><td align="right">1</td></tr>
      <tr><td>2</td><td>백그라운드 대기만</td><td align="right">2</td></tr>
      <tr><td>3</td><td>커밋 <code>a2</code> 남김</td><td align="right">3</td></tr>
      <tr><td>…</td><td></td><td align="right">…</td></tr>
      <tr><td>10</td><td>커밋 남김</td><td align="right"><b>10 → 정지</b></td></tr>
    </table>
    <div style="font-size:12px;color:#777;margin-top:8px">일을 잘 해도 10번이면 멈춘다.</div>
  </div>
  <div style="flex:1;min-width:260px;border:1px solid #bbb;border-radius:8px;padding:12px">
    <div style="font-weight:700;margin-bottom:8px">변경 후 — 연속 무진전을 센다</div>
    <table style="width:100%;font-size:13px">
      <tr><th align="left">Stop</th><th align="left">한 일</th><th align="right">iteration</th></tr>
      <tr><td>1</td><td>커밋 <code>a1</code> 남김</td><td align="right">0 (리셋)</td></tr>
      <tr><td>2</td><td>백그라운드 대기만</td><td align="right">0 (미집계)</td></tr>
      <tr><td>3</td><td>아무 변화 없음</td><td align="right">1</td></tr>
      <tr><td>4</td><td>아무 변화 없음</td><td align="right">2</td></tr>
      <tr><td>…</td><td>연속 무진전</td><td align="right"><b>10 → 정지</b></td></tr>
    </table>
    <div style="font-size:12px;color:#777;margin-top:8px">막혀 있을 때만 예산을 먹는다.</div>
  </div>
</div>

표의 Stop 1을 보자. 커밋 `a1`을 남긴 턴은 변경 전에는 `iteration`을 1로 올렸지만, 변경 후에는 0으로 **되돌린다**. Stop 2의 백그라운드 대기는 변경 후 표에서 0에 머문 채인데, 아예 세지 않기 때문이다.

### 2. 데이터 흐름 — 지문 두 개로 진전을 판정한다

"진전"은 두 갈래로 정의됐다. **diff를 담은 커밋**, 또는 **Story 상태 전환**. 각각을 한 개의 지문 값으로 압축해 상태 파일에 적어 두고, 다음 Stop에서 새로 계산한 값과 비교한다.

<div style="border:1px solid #bbb;border-radius:8px;padding:14px;margin:1rem 0;font-size:13px">
  <div style="font-weight:700;margin-bottom:10px">Stop 이벤트 한 번</div>
  <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
    <div style="border:1px solid #999;border-radius:6px;padding:8px 10px">상태 파일<br><code>last_seen_head: "a1"</code><br><code>last_seen_stories_digest: D1</code></div>
    <div style="font-size:20px">→</div>
    <div style="border:1px solid #999;border-radius:6px;padding:8px 10px"><code>evaluateProgress()</code><br><span style="color:#777">git 3회 + sha256 1회</span></div>
    <div style="font-size:20px">→</div>
    <div style="border:1px solid #999;border-radius:6px;padding:8px 10px"><code>progressed: true</code><br><code>newFingerprint</code></div>
  </div>
  <hr style="margin:14px 0;border:0;border-top:1px dashed #ccc">
  <table style="width:100%">
    <tr><th align="left">관측</th><th align="left">예시 값</th><th align="left">판정</th></tr>
    <tr><td>커밋: 내용 있는 커밋</td><td><code>a1</code> → <code>a2</code>, 두 커밋 사이 diff 있음</td><td>진전</td></tr>
    <tr><td>커밋: 빈 커밋</td><td><code>a1</code> → <code>a2</code>, diff 없음</td><td>무진전</td></tr>
    <tr><td>커밋: amend / rebase</td><td><code>a1</code>이 새 HEAD의 조상이 아님</td><td>무진전</td></tr>
    <tr><td>커밋: 커밋 후 되돌림</td><td><code>a1</code> → 커밋 → revert, 순 diff 0</td><td>무진전</td></tr>
    <tr><td>Story: 상태 전환</td><td><code>{id:"s1", status:"pending"}</code> → <code>{id:"s1", status:"completed"}</code></td><td>진전</td></tr>
    <tr><td>Story: 제목만 수정</td><td><code>title</code>만 <code>"x"</code> → <code>"changed"</code></td><td>무진전</td></tr>
  </table>
</div>

Story 지문이 `id`와 `status`만 담는 게 핵심이다. `{id:"s1", status:"pending"}`이 `{id:"s1", status:"completed"}`로 바뀌면 지문이 달라져 진전으로 읽히지만, `title`만 `"x"`에서 `"changed"`로 고친 경우는 지문이 그대로다. 배열 순서도 지문에 들어가지 않는다 — `[b/pending, a/completed]`와 `[a/completed, b/pending]`은 같은 지문을 낸다. 정렬 후 해싱하기 때문이다.

커밋 쪽의 `a1` → `a2` 세 줄이 전부 "무진전"인 것도 눈여겨볼 만하다. HEAD 해시가 바뀌었는데도 무진전인 이유는, 판정이 해시 변화가 아니라 **두 지점 사이의 순 diff**를 보기 때문이다.

### 3. 모듈 지도 — 어디에 무엇이 생겼나

<div style="border:1px solid #bbb;border-radius:8px;padding:14px;margin:1rem 0;font-size:13px">
  <table style="width:100%">
    <tr><th align="left">자리</th><th align="left">모듈</th><th align="left">역할</th></tr>
    <tr><td rowspan="4" style="vertical-align:top"><b>공유 코어</b><br><code>lib/persistent-mode-core/</code></td>
        <td><code>progress.ts</code> <span style="color:#0a0">NEW</span></td><td>진전 판정기</td></tr>
    <tr><td><code>state-lock.ts</code> <span style="color:#0a0">NEW</span></td><td>상태 파일 mkdir 락</td></tr>
    <tr><td><code>decision.ts</code></td><td>카운터 의미·대기 분기</td></tr>
    <tr><td><code>state.ts</code> / <code>types.ts</code></td><td>상태 읽기·쓰기·필드 선언</td></tr>
    <tr><td rowspan="2" style="vertical-align:top"><b>하네스 어댑터</b><br><code>hooks/</code></td>
        <td><code>persistent-mode/index.ts</code></td><td>Claude — 깨우기 보장 <code>true</code></td></tr>
    <tr><td><code>codex-persistent-mode/cli.ts</code></td><td>Codex — 보장 <code>false</code> + 자식 감지기</td></tr>
    <tr><td rowspan="2" style="vertical-align:top"><b>가드</b><br><code>hooks/</code></td>
        <td><code>write-guard-core.sh</code></td><td>사용자 전용 명령 deny (2 → 3개)</td></tr>
    <tr><td><code>pre-tool-enforcer.sh</code> / <code>codex-write-guard.sh</code></td><td>양 하네스 배선 (테스트만 변경)</td></tr>
    <tr><td><b>스킬</b><br><code>skills/ultragoal/</code></td>
        <td><code>scripts/ultragoal-state.ts</code></td><td>재개 명령 + 락 이관</td></tr>
  </table>
</div>

락이 `lib/`로 올라간 것이 지도에서 읽히는 신호다. 원래 `ultragoal-state.ts` 안에만 있던 락을, 이제 훅도 써야 하므로 공유 코어로 옮겼다.

### 4. 상태 전이 — 새로 생긴 간선 하나

<div style="border:1px solid #bbb;border-radius:8px;padding:14px;margin:1rem 0;font-size:13px">
  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px">
    <div style="border:2px solid #666;border-radius:20px;padding:6px 14px"><code>planning</code></div>
    <div style="font-size:18px">→</div>
    <div style="border:2px solid #2b5fa8;border-radius:20px;padding:6px 14px"><code>pursuing</code></div>
    <div style="font-size:18px">→</div>
    <div style="border:2px solid #666;border-radius:20px;padding:6px 14px"><code>complete</code></div>
  </div>
  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
    <div style="border:2px solid #2b5fa8;border-radius:20px;padding:6px 14px"><code>pursuing</code></div>
    <div style="font-size:18px">→</div>
    <div style="border:2px solid #b8860b;border-radius:20px;padding:6px 14px"><code>budget_limited</code><br><span style="font-size:11px">active: false</span></div>
    <div style="font-size:18px;color:#0a0">⇢</div>
    <div style="border:2px dashed #0a0;border-radius:8px;padding:6px 12px;color:#0a0"><b>NEW</b> <code>resume-pursuit</code><br><span style="font-size:11px">사용자만 실행 가능</span></div>
    <div style="font-size:18px;color:#0a0">⇢</div>
    <div style="border:2px solid #2b5fa8;border-radius:20px;padding:6px 14px"><code>pursuing</code><br><span style="font-size:11px">iteration: 0</span></div>
  </div>
  <div style="margin-top:10px;color:#777">굵은 초록이 이 PR이 새로 만든 간선이다. 나머지 간선은 그대로다.</div>
</div>

되살리는 간선을 **사용자만** 밟을 수 있게 만든 것이 이 그림의 요점이다. AI가 스스로 `resume-pursuit`를 칠 수 있으면 상한은 있으나 마나이고, 위 1번 표의 "10 → 정지"가 정지가 아니게 된다.

---

## Change Group 1: 진전을 값으로 고정한다

> 예고: 카운터가 무엇을 셀지 정하기 전에, "진전"이라는 말을 기계가 비교할 수 있는 두 개의 지문으로 먼저 만든다.
> 순서: 이 그룹이 첫 번째인 이유는 이후 모든 그룹이 이 판정 결과를 소비하기 때문이다. 판정기 없이 카운터부터 손대면 셀 대상이 없다.

### `lib/persistent-mode-core/progress.ts`

**역할/변경 전 맥락** — 존재하지 않던 모듈이다. 변경 전에는 진전이라는 개념 자체가 코드 어디에도 없었고, Stop 훅은 "block했다"는 사실만 알았다. 변경 전 위치: 없음 — `git diff --name-status`가 `A`로 표시한 신규 파일.

**무엇이 바뀌었나** — `evaluateProgress(state, cwd)` 하나를 내보낸다(변경 후 위치: `head:lib/persistent-mode-core/progress.ts:44`). 커밋 축은 `git rev-parse HEAD`로 현재 HEAD를 얻고, 이전 HEAD가 현재 HEAD의 조상인지 `merge-base --is-ancestor`로 확인한 뒤, `git diff --quiet <prior>..<head>`의 종료코드가 1일 때만 진전으로 본다(`head:lib/persistent-mode-core/progress.ts:54`). Story 축은 `id`/`status` 쌍만 뽑아 정렬한 뒤 sha256으로 압축하고(`head:lib/persistent-mode-core/progress.ts:27`), 이전 지문이 **존재하면서** 다르면 진전으로 본다(`head:lib/persistent-mode-core/progress.ts:59`). 두 축은 OR로 합쳐진다(`head:lib/persistent-mode-core/progress.ts:61`).

**왜 필요한가** — 커밋 축을 "HEAD 해시가 바뀌었나"로 잡으면 빈 커밋·amend·rebase·revert가 전부 진전으로 오독된다. `git diff --quiet`의 종료코드 1(=차이 있음)을 요구하는 형태가 그 넷을 한꺼번에 배제한다. [추론: 판정 코드 자체에는 이 설계 근거가 주석으로 없다. 근거는 같은 PR이 추가한 테스트 이름 4개다 — `does not count an amended prior HEAD`, `does not count a rebased prior HEAD`, `does not count a commit followed by its revert`, `empty commit reports no progress`. 커밋 `1f36715e fix: 진전 판정 null 비교 엄격화`도 이 축의 후속 조임이다.]

**시스템 효과** — 이 모듈은 순수 판정기라 상태를 쓰지 않는다. 판정 결과와 **다음에 저장할 지문**을 함께 돌려주고, 저장 여부는 호출자가 정한다. git 명령이 실패하거나 저장소 밖이면 `git()`이 `null`을 돌려주고 결과는 무진전으로 접힌다 — 즉 판정기가 죽어도 pursuit가 조기 정지하지 않는다.

**추적성** — `lib/persistent-mode-core/progress.ts:44`

### `lib/persistent-mode-core/progress.test.ts`

**역할/변경 전 맥락** — 없던 파일이다. 변경 전 위치: 없음 — `A`로 표시된 신규 파일.

**무엇이 바뀌었나** — `describe("progress fingerprint")` 아래 13개 케이스가 실제 임시 git 저장소를 만들어 판정기를 돌린다(변경 후 위치: `head:lib/persistent-mode-core/progress.test.ts:38`). amend·rebase·revert·빈 커밋·워크트리 변경을 각각 무진전으로 고정하고, 저장소 밖 호출이 예외 없이 `false`를 내는지도 본다(`head:lib/persistent-mode-core/progress.test.ts:137`).

**왜 필요한가** — 판정기의 가치는 "무엇을 진전으로 보나"가 아니라 "무엇을 진전으로 **안 보나**"에 있다. 오탐 하나가 무한 pursuit로 이어진다. [추론: 테스트 13건 중 5건이 부정 케이스(amend/rebase/revert/빈 커밋/워크트리)에 배정된 배분 자체가 근거다.]

**시스템 효과** — 진짜 git 저장소를 쓰므로 `merge-base`·`revert`의 실제 동작에 고정된다. 판정기 내부 구현을 바꿔도 이 계약은 남는다.

**추적성** — `lib/persistent-mode-core/progress.test.ts:92`

### `lib/persistent-mode-core/types.ts`

**역할/변경 전 맥락** — 훅이 다루는 모든 상태 파일의 타입 선언 자리다. `GoalState`에는 이미 `budget_limit_notified`, `last_touched_at` 같은 훅 소유 필드가 있었다. 변경 전 위치: `base:lib/persistent-mode-core/types.ts:113`

**무엇이 바뀌었나** — `last_seen_head`와 `last_seen_stories_digest` 두 선택 필드가 붙었다. 변경 후 위치: `head:lib/persistent-mode-core/types.ts:115`

**왜 필요한가** — 지문은 Stop과 Stop 사이를 건너야 하므로 상태 파일에 남아야 한다. [근거: "Last observed repository and story fingerprints used by progress detection."]

**시스템 효과** — 둘 다 `?` 선택 필드다. 이 PR 이전에 만들어진 상태 파일에는 없으므로, 첫 Stop은 비교 상대가 없어 무진전으로 접히고 지문만 심는다. 기존 세션이 깨지지 않는 대신 첫 Stop 한 번은 항상 카운터를 1 올린다.

**추적성** — `lib/persistent-mode-core/types.ts:115`

---

## Change Group 2: 카운터가 세는 대상을 바꾼다

> 예고: 앞 그룹이 만든 판정 결과를 실제로 소비해, 상한에 다가가는 조건을 "block 횟수"에서 "연속 무진전 횟수"로 갈아끼운다. 백그라운드 대기를 예산에서 빼는 분기도 여기서 함께 생긴다.
> 순서: 판정기가 이미 값으로 존재하기 때문에 이 그룹은 그 값을 읽어 쓰기만 하면 된다. 반대 순서였다면 이 그룹은 자기가 쓸 판정기를 스스로 정의해야 했다.

### `lib/persistent-mode-core/decision.ts`

**역할/변경 전 맥락** — Claude와 Codex 두 하네스가 공유하는 단 하나의 Stop 판단 함수다. 변경 전에는 pursuit 분기에서 `ultragoal.iteration >= ultragoal.max_iterations`를 먼저 확인해 상한이면 `budget_limited`로 소프트 정지하고, 아니면 `iteration + 1`을 쓴 뒤 block했다. 변경 전 위치: `base:lib/persistent-mode-core/decision.ts:380`

**무엇이 바뀌었나** — 세 가지가 동시에 바뀌었다.

첫째, pursuit 분기 맨 앞에서 `evaluateProgress`를 호출한다(변경 후 위치: `head:lib/persistent-mode-core/decision.ts:372`). 진전이 관측되면 `iteration: 0`과 **새 지문 전체**를 쓰고 block한다(`head:lib/persistent-mode-core/decision.ts:391`). 진전이 없으면 `fingerprintPatch`만 쓰는데, 이 패치는 **비어 있는 필드만 채운다**(`head:lib/persistent-mode-core/decision.ts:379`). 즉 무진전 턴은 기준점을 앞으로 밀지 않는다.

둘째, 상한 판정 위치가 뒤로 옮겨졌다. 이제 `Math.min(iteration + 1, max_iterations)`를 먼저 계산하고 그 값이 상한 이상일 때 `budget_limited`로 간다(`head:lib/persistent-mode-core/decision.ts:402`). 변경 전에는 상한에 닿는 턴에 카운터를 올리지 않았지만(`// NO iteration++`), 이제는 올린 값을 함께 저장한다.

셋째, 백그라운드 분기가 갈라졌다. `deferredStopWakeGuaranteed === true`일 때만 종전처럼 통과시키고, 보장이 없으면서 pursuit가 살아 있으면 대기 전용 메시지로 block한다(`head:lib/persistent-mode-core/decision.ts:333`). 메시지 본문에 `This turn is not counted toward no-progress.`가 들어간다(`head:lib/persistent-mode-core/decision.ts:87`). 소프트 정지 메시지도 새로 쓰였다(`head:lib/persistent-mode-core/decision.ts:272`).

**왜 필요한가** — 대기 턴을 예산에서 빼는 이유는 새 메시지 본문에 그대로 적혀 있다. [근거: "Background work is still running. Use the platform wait mechanism and harvest its results when it finishes. Do NOT dispatch new stories. This turn is not counted toward no-progress."] 상한 도달 메시지도 마찬가지로 정지 조건을 이름으로 밝힌다. [근거: "The pursuit is paused: ${ultragoal.max_iterations} consecutive Stops passed with no observed progress (no diff-carrying commit, no story transition)."]

**시스템 효과** — 계속 메시지의 헤더 문자열이 `[ULTRAGOAL - ITERATION n/m]`에서 `[ULTRAGOAL - NO-PROGRESS n/m]`로 바뀌었다(`head:lib/persistent-mode-core/decision.ts:245`). 이 문자열은 AI가 매 block마다 읽는 것이라, 숫자의 의미가 바뀐 사실이 프롬프트 표면에서도 드러난다. 상태 쓰기가 실패해도 continue로 내려앉지 않고 block을 유지하는 기존 성질은 그대로 보존됐다.

**추적성** — `lib/persistent-mode-core/decision.ts:372`

### `lib/persistent-mode-core/decision.test.ts`

**역할/변경 전 맥락** — `makeDecision`의 계약 테스트다. 변경 전에는 실제 git 저장소가 필요 없어 `beforeAll`이 상태 디렉터리만 만들었다. 변경 전 위치: `base:lib/persistent-mode-core/decision.test.ts:17`

**무엇이 바뀌었나** — `beforeAll`이 임시 저장소를 `git init`하고 baseline 커밋까지 만든다. 그 위에 14개 케이스가 붙었다 — 열 번째 연속 무진전에서 `budget_limited`로 넘어가는지(변경 후 위치: `head:lib/persistent-mode-core/decision.test.ts:1217`), 내용 있는 커밋이 카운터를 되돌리는지(`head:lib/persistent-mode-core/decision.test.ts:1233`), 소프트 정지 메시지가 drain 정책을 말하는지(`head:lib/persistent-mode-core/decision.test.ts:1453`), 깨우기 보장 없는 백그라운드가 **예산을 먹지 않고** block하는지(`head:lib/persistent-mode-core/decision.test.ts:1564`).

**왜 필요한가** — "예산을 소비하지 않는다"는 성질은 결과(block인가 continue인가)만 봐서는 안 보인다. 반드시 카운터 값을 함께 읽어야 하고, 그래서 테스트 이름들이 하나같이 `without consuming` / `does not exhaust budget` 형태다. [추론: 테스트 제목 자체가 그 이중 단언 구조를 이름으로 드러낸다 — `background tasks without wake guarantee block without consuming`.]

**시스템 효과** — `max_iterations` 재정의는 `max_iterations override transitions on the third no-progress stop`이 3으로 낮춘 상한을 검증해, 10이라는 숫자에 테스트가 붙박이지 않게 한다.

**추적성** — `lib/persistent-mode-core/decision.test.ts:1217`

### `hooks/persistent-mode/index.ts`

**역할/변경 전 맥락** — Claude Code의 Stop 페이로드를 `DecisionContext`로 번역하는 어댑터다. 변경 전 위치: `base:hooks/persistent-mode/index.ts:36`

**무엇이 바뀌었나** — 컨텍스트에 `deferredStopWakeGuaranteed: true` 한 줄이 추가됐다. 변경 후 위치: `head:hooks/persistent-mode/index.ts:37`

**왜 필요한가** — Claude Code는 백그라운드 작업이 끝나면 세션을 다시 불러 준다. 그 보장이 있으니 Stop을 통과시켜도 일이 유실되지 않는다. [근거: 새 분기 바로 위에 남아 있는 기존 주석 "so allowing now defers enforcement safely"]

**시스템 효과** — 한 줄이지만 Claude의 행동은 변경 전과 **완전히 동일**하게 유지된다. 이 플래그가 없었다면 새 분기가 Claude 쪽에도 대기 block을 걸었을 것이다. 즉 이 줄은 기능 추가가 아니라 회귀 방지다.

**추적성** — `hooks/persistent-mode/index.ts:37`

---

## Change Group 3: Codex에서도 대기와 무진전을 구별한다

> 예고: 앞 그룹이 만든 대기 분기는 "지금 백그라운드 작업이 몇 개인가"를 입력으로 받는데, Codex는 그 자리에 상수 0을 넘기고 있었다. 그 상수를 실제 관측으로 바꾼다.
> 순서: 대기 분기가 이미 존재하기 때문에 여기서는 그 입력만 채우면 된다. 분기 없이 감지기부터 만들었다면 세어 봐야 쓸 데가 없었다.

### `hooks/codex-persistent-mode/cli.ts`

**역할/변경 전 맥락** — Codex CLI의 Stop 페이로드를 같은 `DecisionContext`로 번역하는 쌍둥이 어댑터다. 변경 전에는 `activeBackgroundTaskCount: 0`을 하드코딩했고, 바로 위 주석이 그 이유를 "Codex lacks that guarantee, so keep no background-task bypass"라고 밝히고 있었다. 변경 전 위치: `base:hooks/codex-persistent-mode/cli.ts:258`

**무엇이 바뀌었나** — 두 필드가 실측으로 채워졌다. `deferredStopWakeGuaranteed: false`를 명시하고(변경 후 위치: `head:hooks/codex-persistent-mode/cli.ts:280`), pursuit가 살아 있을 때에 한해 `detectActiveCodexChildren(sessionId)`를 부른다(`head:hooks/codex-persistent-mode/cli.ts:265`).

감지기는 Codex의 내부 상태 DB(`$CODEX_HOME/state_5.sqlite`)를 `sqlite3 -readonly`로 조회해, 이 세션이 부모인 `status='open'` 자식 스레드를 뽑는다(`head:hooks/codex-persistent-mode/cli.ts:316`). 각 자식의 rollout 파일에 대해 (1) mtime이 `TERMINAL_TTL_SECONDS`보다 오래됐으면 건너뛰고, (2) 마지막 64KB만 읽어(`head:hooks/codex-persistent-mode/cli.ts:385`) `task_started` / `task_complete` / `turn_aborted` 중 **마지막에 나온 마커**를 찾는다. 마지막 마커가 `task_started`면 살아 있는 것으로 센다. 마커가 하나도 없는데 파일이 64KB보다 크면 역시 살아 있는 것으로 센다(`head:hooks/codex-persistent-mode/cli.ts:370`).

**왜 필요한가** — 64KB 밖으로 밀려난 경우를 왜 "살아 있음"으로 접는지는 코드 옆 주석이 직접 답한다. [근거: "A fresh open rollout may have its initial task_started marker before the bounded tail. Without a retained terminal marker, conservatively treat that child as active; terminal markers in the tail still win."] 감지기 전체가 fail-open인 것도 함수 주석에 명시돼 있다. [근거: "The detector is deliberately fail-open: any unavailable/malformed input emits one diagnostic and contributes zero active children."]

**시스템 효과** — `sqlite3`가 런타임 전제조건이 됐다(다음 그룹의 문서 반영으로 이어진다). 감지기가 실패하면 0을 세므로, Codex는 이 PR 이전과 똑같이 동작한다 — 감지가 안 되는 환경에서 pursuit가 더 빨리 멈추지도, 영원히 안 멈추지도 않는다. 조회 범위를 pursuit 중으로 한정한 덕에 ultragoal이 아닌 세션은 sqlite3를 아예 부르지 않는다.

**추적성** — `hooks/codex-persistent-mode/cli.ts:316`

### `hooks/codex-persistent-mode/cli.test.ts`

**역할/변경 전 맥락** — Codex 어댑터의 계약 테스트다. `describe("hook stop: shared continuation contract (makeDecision integration)")` 아래에 공유 판단과의 통합 케이스가 모여 있었다. 변경 전 위치: `base:hooks/codex-persistent-mode/cli.test.ts:688`

**무엇이 바뀌었나** — 감지기 전용 케이스 10건이 붙었다. 살아 있는 자식이 예산 소비 없이 block을 만드는지(변경 후 위치: `head:hooks/codex-persistent-mode/cli.test.ts:690`), 마커 조합 진리표가 "마지막 `task_started`만" 세는지(`head:hooks/codex-persistent-mode/cli.test.ts:731`), `sqlite3` 바이너리가 없을 때 진단 1건만 내고 fail-open 하는지(`head:hooks/codex-persistent-mode/cli.test.ts:894`), 조회에 `-readonly`가 실제로 들어가는지.

**왜 필요한가** — fail-open 경로는 "실패했는데 통과했다"와 "성공했는데 통과했다"가 겉으로 구별되지 않는다. 그래서 stderr 진단 출력 자체를 단언 대상으로 삼는다. [추론: `fail-open emits stderr diagnostic`, `missing sqlite binary fails open with one diagnostic`, `malformed sqlite output row fails open once` 세 케이스가 모두 진단 **횟수**까지 단언하는 형태다.]

**시스템 효과** — `-readonly` 플래그를 테스트가 붙잡고 있어, 훅이 Codex의 실제 상태 DB를 건드릴 위험이 회귀로 잡힌다.

**추적성** — `hooks/codex-persistent-mode/cli.test.ts:731`

---

## Change Group 4: 두 글쓴이가 같은 파일을 동시에 쓰는 문제를 닫는다

> 예고: 앞의 두 그룹 때문에 Stop 훅이 매 턴 상태 파일에 지문과 카운터를 쓰기 시작했다. 스킬 CLI도 같은 파일을 쓰므로, 이제 동시 쓰기는 가정이 아니라 일상이다. 이미 CLI 안에만 있던 락을 공유 자리로 끌어올린다.
> 순서: 훅이 상태를 쓰기 시작한 뒤라야 이 문제가 실재한다. 그 전이라면 락 이관은 근거 없는 리팩터링이었다.

### `lib/persistent-mode-core/state-lock.ts`

**역할/변경 전 맥락** — 새 파일이지만 내용 대부분은 이사 온 것이다. 원래 `skills/ultragoal/scripts/ultragoal-state.ts` 안에 `REVIEW_LOCK_*` 접두어로 살던 mkdir 락이 원본이다. 변경 전 위치: 없음 — `A`로 표시된 신규 파일(원본 코드의 이전 위치는 `base:skills/ultragoal/scripts/ultragoal-state.ts:415`).

**무엇이 바뀌었나** — `withStateLock`을 내보낸다(변경 후 위치: `head:lib/persistent-mode-core/state-lock.ts:24`). 상수 접두어가 `REVIEW_LOCK_`에서 `STATE_LOCK_`으로 바뀌었고, 30초 stale TTL·소유자 토큰 파일·PID 생존 확인·복구 가드는 원본 그대로다.

동작이 실제로 바뀐 곳은 한 군데다. 해제 경로가 복구 가드를 **한 번만 시도**하던 것에서, 얻을 때까지 도는 `while (true)` 루프로 바뀌었다(`head:lib/persistent-mode-core/state-lock.ts:154`).

**왜 필요한가** — 해제 시도가 한 번뿐이면, 그 순간 다른 관측자가 복구 가드를 쥐고 있을 때 자기 락을 남긴 채 떠나게 된다. [근거: "A fresh recovery guard may belong to a concurrent stale-lock observer; wait for it rather than leaving our own primary lock behind."] 이 수정은 PR 마지막 커밋 `c8cb0cd0 fix: 상태 lock 해제 경합 방지`다.

**시스템 효과** — 락 획득 실패는 fail-closed다 — 100회 재시도 후 예외를 던지고, 락 없는 쓰기로 내려앉지 않는다. [근거: "A contention timeout fails closed; callers never fall back to an unlocked write."]

**추적성** — `lib/persistent-mode-core/state-lock.ts:151`

### `lib/persistent-mode-core/state-lock.test.ts`

**역할/변경 전 맥락** — 없던 파일이다. 원본 락에도 `review dispatch stale-lock recovery`라는 이름의 테스트가 CLI 쪽에 있었지만, 락 자체를 직접 겨눈 것은 아니었다. 변경 전 위치: 없음 — `A`로 표시된 신규 파일.

**무엇이 바뀌었나** — `describe("withStateLock")` 아래 4건이다(변경 후 위치: `head:lib/persistent-mode-core/state-lock.test.ts:15`). 살아 있는 소유자와 경합하면 콜백을 **아예 실행하지 않고** 실패하는지, 주인 없는 stale 락은 회수되는지(`head:lib/persistent-mode-core/state-lock.test.ts:45`), 그리고 이번에 고친 해제 경합 — 긴 복구 가드가 잡혀 있을 때 소유자가 기다렸다가 후속 writer에게 자리를 넘기는지(`head:lib/persistent-mode-core/state-lock.test.ts:66`).

**왜 필요한가** — "실패했다"만으로는 부족하고 "콜백이 안 돌았다"까지 봐야 fail-closed가 증명된다. 락이 풀린 뒤 콜백이 한 번 돌면 그건 이미 unlocked write다. [추론: 첫 케이스 이름이 `fails closed without running the callback`으로, 실패와 미실행 둘 다를 이름에 담고 있다.]

**시스템 효과** — 이 파일이 앞 커밋의 해제 경합 수정에 대한 회귀 잠금이다.

**추적성** — `lib/persistent-mode-core/state-lock.test.ts:66`

### `lib/persistent-mode-core/state.ts`

**역할/변경 전 맥락** — 훅이 상태 파일을 읽고 쓰는 자리다. `updateUltragoalState`는 읽고 → 파싱하고 → 병합해 쓰는 read-modify-write였고, 락이 없었다. 변경 전 위치: `base:lib/persistent-mode-core/state.ts:203`

**무엇이 바뀌었나** — 본문 전체가 `withStateLock(path, () => { … })` 안으로 들어갔다. 변경 후 위치: `head:lib/persistent-mode-core/state.ts:206`

**왜 필요한가** — 앞 그룹들 때문에 이 함수가 매 Stop마다 불리게 됐고, 같은 순간 스킬 CLI가 같은 파일에 쓸 수 있다. 락 없는 read-modify-write는 늦게 읽고 늦게 쓴 쪽이 상대의 쓰기를 통째로 덮는다. [추론: 커밋 `bcd493b1 fix: ultragoal 상태 갱신 락 통합`이 이 변경이고, 같은 PR이 훅의 쓰기 빈도를 올린 것이 직접 계기다. 코드 주석에 이 인과가 따로 적혀 있지는 않다.]

**시스템 효과** — 병합 로직·`ENOENT` 무시·하트비트 갱신은 그대로다. 바뀐 것은 상호배제뿐이다. 다만 이제 이 함수는 락 경합 시 예외를 던질 수 있고, `decision.ts`의 호출부는 그 예외를 삼키고도 block을 유지하도록 이미 감싸여 있다.

**추적성** — `lib/persistent-mode-core/state.ts:206`

### `lib/persistent-mode-core/state.test.ts`

**역할/변경 전 맥락** — 상태 읽기·쓰기의 계약 테스트다. 변경 전에도 `updateUltragoalState`의 하트비트·no-create 성질을 검증하고 있었다. 변경 전 위치: `base:lib/persistent-mode-core/state.test.ts:893`

**무엇이 바뀌었나** — 케이스 하나가 붙었다. 살아 있는 소유자가 락을 쥔 상태에서 `updateUltragoalState`를 부르면, 실패하면서 **파일 바이트가 하나도 안 바뀌는지** 확인한다. 변경 후 위치: `head:lib/persistent-mode-core/state.test.ts:926`

**왜 필요한가** — 락을 감쌌다는 사실만으로는 fail-closed가 보장되지 않는다. 부분 쓰기 후 실패하면 락이 있으나 마나다. [추론: 케이스 이름 `fails closed under fresh lock contention without changing bytes`가 단언 대상이 바이트 동일성임을 밝힌다.]

**시스템 효과** — 훅 경로에서의 fail-closed가 CLI 경로와 같은 기준으로 고정된다.

**추적성** — `lib/persistent-mode-core/state.test.ts:926`

---

## Change Group 5: 멈춘 pursuit를 사람만 되살릴 수 있게 한다

> 예고: 앞 그룹까지로 카운터는 상한에 닿으면 pursuit를 `budget_limited`로 세운다. 이제 그 정지를 되돌리는 유일한 문을 만들고, 그 문을 AI가 밀지 못하도록 가드에 걸어 잠근다.
> 순서: 되살릴 경로는 멈추는 경로가 이미 있어야 의미가 있다. 또 이 그룹의 재개 명령 자체가 앞 그룹이 공유 자리로 올린 락을 그대로 가져다 쓴다.

### `skills/ultragoal/scripts/ultragoal-state.ts`

**역할/변경 전 맥락** — ultragoal 상태 파일을 다루는 CLI 전체다. 락 구현을 자기 안에 품고 있었고(`base:skills/ultragoal/scripts/ultragoal-state.ts:415`), `readGoalState`는 `active`가 false면 무조건 `null`을 돌려줬다(`base:skills/ultragoal/scripts/ultragoal-state.ts:567`). 변경 전 위치: `base:skills/ultragoal/scripts/ultragoal-state.ts:539`

**무엇이 바뀌었나** — 네 가지다.

락 구현 140여 줄이 통째로 빠지고 공유 모듈 import 한 줄로 대체됐다(변경 후 위치: `head:skills/ultragoal/scripts/ultragoal-state.ts:62`).

읽기가 둘로 갈라졌다. 새 `readGoalStateRaw`가 스키마 검증만 하고 `active:false`인 종료 상태도 그대로 돌려주며, 기존 `readGoalState`는 그 위에서 active만 걸러내는 얇은 껍질이 됐다(`head:skills/ultragoal/scripts/ultragoal-state.ts:414`). `status` 서브커맨드가 Raw 쪽을 쓰도록 바뀌었다(`head:skills/ultragoal/scripts/ultragoal-state.ts:2226`).

`resumePursuit`가 생겼다(`head:skills/ultragoal/scripts/ultragoal-state.ts:697`). 락을 잡고, 파일이 없으면 거부, 파싱 실패면 거부, `phase`가 `budget_limited`가 아니면 거부한 뒤에야 `phase: "pursuing"`, `active: true`, `iteration: 0`, `budget_limit_notified: false`를 쓴다.

병합 경로가 지문 두 필드를 명시적으로 이어받는다(`head:skills/ultragoal/scripts/ultragoal-state.ts:340`).

**왜 필요한가** — `readGoalStateRaw` 분리와 `status`의 전환은 재개 경로의 전제다. `budget_limited`는 `active:false`이므로, 기존 읽기로는 사용자가 `status`를 쳐도 `absent`만 나왔고 되살릴 대상이 있는지조차 확인할 수 없었다. 재개 명령이 일반 병합을 쓰지 않는 이유는 함수 주석이 밝힌다. [근거: "This is deliberately a strict raw read/validate/write path: it never seeds or performs a generic merge."] 지문 필드를 병합에서 열거하는 이유도 주석에 있다. [근거: "Progress fingerprints are caller-owned metadata. Enumerate them here so an unrelated merge write cannot silently drop the last observed values."]

**시스템 효과** — 이 CLI와 Stop 훅이 이제 **같은 락 구현**을 공유한다. 그전에는 서로 다른 락(한쪽은 락 없음)이라 상호배제가 성립하지 않았다. `resumePursuit`가 `withStateLock` 안에서 `mergeWriteLocked`(락을 다시 잡지 않는 내부 버전)를 부르는 것도 이 구조 때문이다. usage 문자열에도 새 서브커맨드가 등록됐다.

**추적성** — `skills/ultragoal/scripts/ultragoal-state.ts:697`

### `skills/ultragoal/scripts/ultragoal-state.test.ts`

**역할/변경 전 맥락** — CLI의 계약 테스트다. `describe("goal state")` 아래 병합 보존 계약이 이미 촘촘했다. 변경 전 위치: `base:skills/ultragoal/scripts/ultragoal-state.test.ts:288`

**무엇이 바뀌었나** — 지문 보존 2건(변경 후 위치: `head:skills/ultragoal/scripts/ultragoal-state.test.ts:291`)과, 재개 경로 전용 `describe` 블록 6건이 붙었다(`head:skills/ultragoal/scripts/ultragoal-state.test.ts:1354`). 후자에는 `budget_limited`에서 `status`가 실제로 그 이름을 출력하는지, `get`이 기존 active-fold 계약을 깨지 않는지, 다른 phase에서 호출하면 거부하는지(`head:skills/ultragoal/scripts/ultragoal-state.test.ts:1388`), 종료 잠금이 새 seed 시도를 견디는지가 들어 있다.

**왜 필요한가** — `readGoalState`를 두 겹으로 쪼개는 변경은 기존 호출자의 계약을 조용히 넓힐 위험이 있다. `get keeps active-fold contract`가 그 경계를 못박는다. [추론: 새 `describe` 6건 중 2건이 새 기능이 아니라 **기존 계약이 그대로인지**를 확인하는 형태다.]

**시스템 효과** — `fresh seed omits fingerprint fields`는 새 필드가 seed 스켈레톤을 오염시키지 않음을 고정한다. 새 세션의 첫 Stop이 지문을 심는 쪽이 되고, seed가 미리 심지 않는다.

**추적성** — `skills/ultragoal/scripts/ultragoal-state.test.ts:1354`

### `hooks/write-guard-core.sh`

**역할/변경 전 맥락** — Claude와 Codex 두 PreToolUse 가드가 공유하는 판정 코어다. 사용자 전용 ultragoal 서브커맨드 **두 개**(`approve-review-dispatch-renewal`, `dismiss-review-finding`)를 AI의 Bash 경로에서 deny 하고 있었다. 변경 전 위치: `base:hooks/write-guard-core.sh:208`

**무엇이 바뀌었나** — deny 목록에 세 번째가 추가됐다. 변경 후 위치: `head:hooks/write-guard-core.sh:247`

**왜 필요한가** — 주석이 세 개로 늘어난 이유를 함께 고쳐 적었다. [근거: "All three let the loop clear its own completion gate, so leaving them to prose ("run this only after the user approves") makes the authorization vigilance-based -- the exact property ultragoal/SKILL.md rejects for its other gates."]

**시스템 효과** — 앞 그룹이 만든 상한이 여기서 비로소 의미를 갖는다. AI가 스스로 재개할 수 있으면 상한은 형식이고, deny가 걸려야 정지가 정지다. 코어가 공유이므로 Claude와 Codex가 같은 순간 같은 판정을 갖는다.

**추적성** — `hooks/write-guard-core.sh:247`

### `hooks/write-guard-core_test.sh`

**역할/변경 전 맥락** — 공유 코어의 셸 테스트다. 기존 두 명령에 대해 직접 호출·변수 우회·역순·공백 연속 네 가지 표기를 각각 검증하는 패턴이 이미 있었다. 변경 전 위치: `base:hooks/write-guard-core_test.sh:572`

**무엇이 바뀌었나** — 같은 네 가지 표기를 새 명령에 대해 그대로 복제한 4건이 붙었다. 변경 후 위치: `head:hooks/write-guard-core_test.sh:584`

**왜 필요한가** — 문자열 매칭 가드는 "그 단어가 명령줄에 어떤 모양으로 들어오느냐"에 통째로 좌우된다. `sub=<명령>; bun … "$sub"` 같은 변수 우회가 통과하면 가드는 없는 것과 같다. [추론: 기존 두 명령에도 같은 4종 표기 테스트가 붙어 있고, 새 명령만 1종으로 검증하면 커버리지가 비대칭이 된다.]

**시스템 효과** — 새 명령의 가드 커버리지가 기존 두 명령과 정확히 같은 모양이 된다.

**추적성** — `hooks/write-guard-core_test.sh:584`

### `hooks/pre-tool-enforcer_test.sh`

**역할/변경 전 맥락** — Claude 쪽 PreToolUse 가드의 셸 테스트다. `hg_bash_json` 헬퍼가 Bash 페이로드를 만들어 준다. 변경 전 위치: `base:hooks/pre-tool-enforcer_test.sh:804`

**무엇이 바뀌었나** — 새 명령이 Claude 진입점을 거쳐 공유 deny에 **도달하는지**를 보는 1건이 붙었다. 변경 후 위치: `head:hooks/pre-tool-enforcer_test.sh:810`

**왜 필요한가** — 코어가 deny를 낸다는 사실과, 하네스의 진입점이 그 코어를 실제로 부른다는 사실은 별개다. 배선이 끊겨 있으면 코어 테스트는 전부 초록인데 실제로는 뚫린다. [추론: 테스트 이름이 판정이 아니라 도달을 말한다 — `reaches_claude_shared_guard`.]

**시스템 효과** — Claude 경로의 배선이 회귀로 잠긴다.

**추적성** — `hooks/pre-tool-enforcer_test.sh:810`

### `hooks/codex-write-guard_test.sh`

**역할/변경 전 맥락** — Codex 쪽 가드의 셸 테스트다. 위험 명령(`rm -rf`, `git push --force`) 검증이 같은 파일에 모여 있다. 변경 전 위치: `base:hooks/codex-write-guard_test.sh:1429`

**무엇이 바뀌었나** — Codex 진입점에 대해 네 가지 표기(직접·변수 우회·역순·공백 연속)를 전부 태우는 4건이 붙었다. 변경 후 위치: `head:hooks/codex-write-guard_test.sh:1445`

**왜 필요한가** — Codex 쪽은 전체 Bash 명령줄을 코어로 넘기는 shim이라, 표기 변형이 코어에 닿기 전에 잘려 나갈 수 있다. [근거: "the Codex shim must route the whole Bash command through the shared deny for resume-pursuit, including the same indirection/order/whitespace shapes covered by the core tests."]

**시스템 효과** — 두 하네스의 가드 커버리지가 표기 단위까지 대칭이 된다. 한쪽만 통과하는 표기가 남지 않는다.

**추적성** — `hooks/codex-write-guard_test.sh:1445`

---

## Change Group 6: 바뀐 계약을 읽는 사람에게 옮긴다

> 예고: 앞의 다섯 그룹이 `max_iterations`라는 같은 이름의 숫자에 다른 의미를 넣었다. 그 이름을 설명하던 모든 문서가 이제 틀렸으므로, 열 개 문서를 같은 계약으로 맞춘다.
> 순서: 문서가 마지막인 이유는 계약이 확정된 뒤라야 옮길 것이 정해지기 때문이다. 특히 `sqlite3` 전제조건은 3번 그룹의 감지기가 생기고 나서야 사실이 됐다.

### `skills/ultragoal/references/planning.md`

**역할/변경 전 맥락** — ultragoal이 계획 단계에서 채우는 슬롯 설명이다. 6번 슬롯을 "the finite cap on pursuit blocks"이자 "the SOLE soft-stop bound"라고 정의하고 있었다. 변경 전 위치: `base:skills/ultragoal/references/planning.md:15`

**무엇이 바뀌었나** — 정의가 "the finite cap on **consecutive no-progress Stop turns**"로 교체되고, 리셋 조건·대기 미집계·재개 경로가 같은 항목에 붙었다. 변경 후 위치: `head:skills/ultragoal/references/planning.md:15`

**왜 필요한가** — 이 문장이 오케스트레이터가 `--max-iterations` 값을 정할 때 읽는 근거다. 옛 정의를 그대로 두면 사용자가 "10번 블록되면 멈춘다"로 계산하게 된다. [근거: 교체된 새 문장 자체 — "A diff-carrying commit or a story status transition is observed progress and resets the counter to `0`; a Stop while background work is still running is a wait and is not counted."]

**시스템 효과** — 슬롯 설명이 곧 프롬프트라, 이 문장이 AI의 상한 해석을 바꾼다.

**추적성** — `skills/ultragoal/references/planning.md:15`

### `skills/ultragoal/SKILL.md`

**역할/변경 전 맥락** — ultragoal 스킬 본문. 서브커맨드 권한 표에 사용자 전용 두 줄이 있었고, 그 아래 시스템 전용 setter 설명이 이어졌다. 변경 전 위치: `base:skills/ultragoal/SKILL.md:38`

**무엇이 바뀌었나** — 권한 표에 사용자 전용 세 번째 줄이 추가되고(변경 후 위치: `head:skills/ultragoal/SKILL.md:38`), 카운터 계약 문단이 새로 들어갔다(`head:skills/ultragoal/SKILL.md:43`).

**왜 필요한가** — 재개 명령은 AI가 절대 직접 실행하면 안 되는 부류이므로, 권한 열이 그 사실을 다른 두 줄과 같은 형식으로 말해야 한다. [근거: 새 행의 권한 열 — "**user only** — a PreToolUse guard denies it on the orchestrator's Bash path; present the command and have the user run it"]

**시스템 효과** — 가드가 deny를 내는 것과, AI가 "이건 사용자에게 넘겨야 한다"고 아는 것은 다른 층이다. 이 줄이 후자를 담당한다.

**추적성** — `skills/ultragoal/SKILL.md:43`

### `skills/ultragoal/references/completion-gate.md`

**역할/변경 전 맥락** — 완료 게이트와 blocked-stop 규칙 문서다. "there is no cross-iteration stall detector; `max_iterations` absorbs genuine stalls"라고 적혀 있었다. 변경 전 위치: `base:skills/ultragoal/references/completion-gate.md:155`

**무엇이 바뀌었나** — 그 문장이 지워지고, 무진전 상한이 blocked와 **별개의 소프트 정지**임을 밝히는 서술로 대체됐다(변경 후 위치: `head:skills/ultragoal/references/completion-gate.md:155`). 완료 문단에는 drain 절차와 재개 명령 전문이 추가됐다(`head:skills/ultragoal/references/completion-gate.md:134`).

**왜 필요한가** — `budget_limited` 상태에서 무엇을 해야 하는지가 이전 문서에는 없었다. 새 문단이 순서를 못박는다. [근거: "drain any in-flight delegated work, harvest and commit its results, then run the completion gate; completion wins over a prior `budget_limited` when every gate passes. Do not dispatch new stories or interrupt running executors during this drain."]

**시스템 효과** — 이 절차는 2번 그룹이 만든 소프트 정지 메시지 본문과 같은 내용이다. 문서와 런타임 메시지가 한 벌로 움직인다.

**추적성** — `skills/ultragoal/references/completion-gate.md:134`

### `CLAUDE.md`

**역할/변경 전 맥락** — 이 저장소에서 일하는 AI가 읽는 최상위 안내다. 전제조건이 `bun`, `bash`, `jq` 셋이었고, 훅 목록의 persistent-mode 줄은 한 문장이었다. 변경 전 위치: `base:CLAUDE.md:33`

**무엇이 바뀌었나** — 전제조건에 `sqlite3`가 들어가고 fail-open 성질을 설명하는 문단이 붙었다(변경 후 위치: `head:CLAUDE.md:39`). persistent-mode 줄이 카운터 계약 전체를 담도록 늘어났고, 가드 줄의 "두 명령"이 "세 명령"으로 고쳐졌다(`head:CLAUDE.md:139`).

**왜 필요한가** — `jq`가 이미 같은 이유로 전제조건에 올라 있다. 없으면 가드가 열리는 도구는 개발 도구가 아니라 런타임 전제라는 기존 판단을, 새 도구에 같은 형식으로 적용했다. [근거: "If the binary, state database, query, or rollout data is unavailable or malformed, `codex-persistent-mode` emits one diagnostic to stderr and fails open by counting zero active children."]

**시스템 효과** — 새 환경에서 감지기가 조용히 0을 세는 상황을, 문서를 읽은 사람이 미리 알 수 있다.

**추적성** — `CLAUDE.md:39`

### `README.md`

**역할/변경 전 맥락** — 한국어 설치 안내다. 전제조건 목록의 `jq` 줄이 "없으면 가드가 조용히 열림"이었다. 변경 전 위치: `base:README.md:72`

**무엇이 바뀌었나** — `sqlite3` 줄이 추가되고, `jq` 줄의 "조용히 열림"이 "차단하지 않음"으로 다듬어졌다. 변경 후 위치: `head:README.md:73`

**왜 필요한가** — "조용히 열린다"는 표현은 무슨 일이 일어나는지를 말하지 않는다. 새 문구는 관측 가능한 결과를 말한다. [추론: 같은 커밋이 `sqlite3` 줄에 "0건을 세고 stderr에 진단 1건을 출력"이라는 구체 동작을 적었고, `jq` 줄의 수정은 그 형식에 맞춘 것이다. 커밋 메시지에 이 다듬기에 대한 별도 언급은 없다.]

**시스템 효과** — 설치 단계에서 누락 시 증상을 예상할 수 있다.

**추적성** — `README.md:73`

### `README.en.md`

**역할/변경 전 맥락** — 위 파일의 영문 대응본이다. 같은 자리에 같은 `jq` 문장이 있었다. 변경 전 위치: `base:README.en.md:72`

**무엇이 바뀌었나** — 한국어본과 같은 두 줄 변경. 변경 후 위치: `head:README.en.md:73`

**왜 필요한가** — 두 README는 같은 내용의 두 언어본이므로, 한쪽만 고치면 전제조건 목록이 언어별로 갈라진다. [추론: 커밋 `b85e63bf docs: 무진전 계약 양언어 문서 반영`이 이 PR의 문서 변경을 양언어로 묶어 처리했다.]

**시스템 효과** — 영어 사용자도 같은 전제조건을 본다.

**추적성** — `README.en.md:73`

### `docs/ORCHESTRATION.md`

**역할/변경 전 맥락** — 오케스트레이션 파이프라인 문서다. ultragoal 절에는 역할·워크플로우만 있었고, 트러블슈팅 표의 "Sisyphus가 멈추지 않음" 행은 "설계된 대로입니다. 검증 통과까지 지속됩니다."였다. 변경 전 위치: `base:docs/ORCHESTRATION.md:206`

**무엇이 바뀌었나** — `#### 반복 예산·진전 없음·재개` 소절이 신설되고(변경 후 위치: `head:docs/ORCHESTRATION.md:108`), 실행 흐름 절에 같은 계약 문단이 추가됐으며(`head:docs/ORCHESTRATION.md:167`), 트러블슈팅 행이 정지 조건을 말하도록 고쳐졌다.

**왜 필요한가** — 트러블슈팅 행의 옛 답은 "안 멈추는 게 정상"이었다. 이제 멈추는 조건이 실제로 생겼으니 그 답이 틀렸다. [근거: 새 행 — "ultragoal은 진전 없는 Stop을 `iteration`으로 세고, `max_iterations`(기본 10)에서 `budget_limited`로 상태를 보존한 채 소프트 정지할 수 있습니다."]

**시스템 효과** — 새 소절이 `blocked`와 `budget_limited`를 명시적으로 갈라놓는다 — 앞의 것은 "실행 가능한 미완료 항목이 없음" 또는 설정한 조건일 때만, 뒤의 것은 무진전 상한일 때만.

**추적성** — `docs/ORCHESTRATION.md:108`

### `docs/ORCHESTRATION.en.md`

**역할/변경 전 맥락** — 위 문서의 영문 대응본. 트러블슈팅 행이 "This is by design. It persists until verification passes."였다. 변경 전 위치: `base:docs/ORCHESTRATION.en.md:206`

**무엇이 바뀌었나** — 한국어본과 대응하는 세 자리 변경. 새 소절 제목은 `#### Iteration budget, no-progress, and resume`이다. 변경 후 위치: `head:docs/ORCHESTRATION.en.md:108`

**왜 필요한가** — 양언어 대응 유지. [추론: 두 파일의 diff가 같은 세 hunk 위치에 대응 문장으로 들어갔다.]

**시스템 효과** — 두 언어본의 절 구조가 일치한 채로 남는다.

**추적성** — `docs/ORCHESTRATION.en.md:108`

### `docs/skills/core-pipeline.md`

**역할/변경 전 맥락** — 핵심 스킬 파이프라인 문서다. 완료 게이트 관련 서술이 무효화 절차까지 다루고 끝났다. 변경 전 위치: `base:docs/skills/core-pipeline.md:186`

**무엇이 바뀌었나** — 그 뒤에 `### ultragoal 반복 예산·진전 없음·재개` 절이 추가됐다. 변경 후 위치: `head:docs/skills/core-pipeline.md:188`

**왜 필요한가** — 이 문서를 읽는 사람은 완료 게이트만 알고 소프트 정지는 모르는 상태로 남는다. 두 정지 경로가 한 문서 안에 이웃해 있어야 구별된다. [추론: 추가 위치가 무효화 절 바로 다음이고, 새 절의 마지막 문장이 `blocked`와의 차이를 다시 못박는다.]

**시스템 효과** — 완료·차단·소프트 정지 세 종료 경로가 한자리에 모인다.

**추적성** — `docs/skills/core-pipeline.md:188`

### `docs/skills/core-pipeline.en.md`

**역할/변경 전 맥락** — 위 문서의 영문 대응본. 변경 전 위치: `base:docs/skills/core-pipeline.en.md:186`

**무엇이 바뀌었나** — 같은 자리에 `### ultragoal iteration budget, no-progress, and resume` 절 추가. 변경 후 위치: `head:docs/skills/core-pipeline.en.md:188`

**왜 필요한가** — 양언어 대응 유지. [추론: 앞의 두 쌍(README, ORCHESTRATION)과 같은 처리 방식이다.]

**시스템 효과** — 문서 4쌍 전부가 이 PR 이후 같은 계약을 말한다.

**추적성** — `docs/skills/core-pipeline.en.md:188`

---

## Change Group 7: 같은 병합에 실린 별개의 수정

> 예고: 앞의 여섯 그룹이 전부 하나의 계약을 다뤘다면, 이 그룹의 유일한 파일은 그 계약과 인과가 없다. 같은 브랜치에서 발견돼 같은 병합에 실렸을 뿐이다.
> 순서: 마지막인 이유가 곧 이 그룹의 내용이다 — 앞 그룹들의 어느 것도 이 변경을 전제하지 않고, 이 변경도 앞의 것을 전제하지 않는다. 앞에 두면 계약의 인과 사슬을 끊는다.

### `skills/design-review/scripts/job.test.ts`

**역할/변경 전 맥락** — design-review 스킬의 job 수명주기 테스트다. `stop` 호출 직후 곧바로 `clean`을 부르는 형태였고, 그래서 워커가 아직 살아 있으면 `clean`의 활성 멤버 거부에 걸려 간헐 실패했다. 변경 전 위치: `base:skills/design-review/scripts/job.test.ts:94`

**무엇이 바뀌었나** — `waitForStableTerminal(jobDir, stableMs = 500)` 헬퍼가 추가되고(변경 후 위치: `head:skills/design-review/scripts/job.test.ts:38`), 기존 테스트 4건이 `stop`과 `clean` 사이에서 이 헬퍼를 기다리도록 `async`로 바뀌었다. 이 상황을 정면으로 재현하는 새 케이스도 붙었다 — `sleep 0.5` 멤버를 띄운 직후 `stop`을 치는 형태다(`head:skills/design-review/scripts/job.test.ts:173`).

**왜 필요한가** — 원인이 헬퍼 주석에 적혀 있다. [근거: "Detached workers can still be in their queued startup window after `stop` returns. Keep the job directory until the terminal state has been stable long enough for that worker process to exit, then `clean` can safely enforce its active-member guard without racing the worker's final status write."]

**시스템 효과** — 프로덕션 코드(`job.ts`)는 손대지 않았다. `clean`의 대기열 멤버 거부는 의도된 동작이라는 판단이 그대로 유지됐고, 고쳐진 것은 테스트가 그 동작을 기다리는 방식뿐이다. [근거: 새 케이스 안의 주석 — "clean's queued-member refusal remains intentional."]

**추적성** — `skills/design-review/scripts/job.test.ts:38`

---

## 열린 질문

문서 집필 중 diff·커밋 메시지·주석·인접 코드를 뒤졌으나 근거를 찾지 못한 항목이다. 답을 지어내지 않고 남긴다.

1. **`max_iterations` 기본값 10을 그대로 둔 근거** — 세는 대상이 "block 횟수"에서 "연속 무진전 횟수"로 바뀌었는데 기본값은 10 그대로다. 새 정의에서 10이 적절하다는 판단의 출처가 diff·커밋·문서 어디에도 없다. `Unknown / not supplied`.

2. **rollout tail 크기를 64KB로 잡은 근거** — `ROLLOUT_TAIL_BYTES = 64 * 1024`가 어떤 관측(전형적 rollout 크기, 마커 간격)에서 나왔는지 표시가 없다. 64KB 초과 시 보수적으로 활성 처리한다는 **결과**는 주석에 있지만, 그 임계값 자체의 근거는 없다. `Unknown / not supplied`.

3. **락 재시도 100회 × 5ms(총 약 0.5초)의 근거** — 공유 모듈로 이관되면서 상수 이름만 바뀌고 값은 원본 그대로다. 훅이 새로 이 락을 쓰기 시작해 경합 빈도가 달라졌는데도 재검토했다는 흔적이 없다. `Unknown / not supplied`.

---

## 이해도 퀴즈

**형식** — 전부 서술형 단답이다. 선택지는 없다. 문항마다 정답이 반드시 짚어야 할 루브릭 항목이 붙어 있고, 그중 최소 하나는 이 문서를 읽지 않으면 알 수 없는 구체 값이다.

**규모** — 필수 개념 10개, 문항 13개. 상한 20개를 넘지 않으므로 잘라낸 문항은 없다.

---

### 개념 1 — evidence (신규 파일 식별)

**Q1.** 이 변경에서 신규 추가된 파일은 몇 개이고, 그 판정 근거는 문서의 어떤 관찰에서 왔는가?

> 루브릭
> - (a) 개수가 4개임
> - (b) 판정 근거가 `git diff --name-status`의 `A` 표시임 — 문서의 서술이나 파일 내용이 아님

---

### 개념 2 — evidence (noise 분류)

**Q2.** 이 문서는 파일 단위 noise를 0개로 잡았다. 그렇게 판단한 근거와, 대신 noise로 분류한 것이 무엇인지 말해 보라.

> 루브릭
> - (a) 규칙표(`*.lock` / `dist/` / `__snapshots__/` / `*.generated.*`)에 걸리는 파일이 하나도 없음
> - (b) 대신 hunk 단위로 포맷팅만 바뀐 자리를 제외했고, 그 자리가 4곳(`decision.ts` 2곳, `decision.test.ts`, `cli.ts`)임

---

### 개념 3 — background (변경 전 계산 방식)

**Q3.** 이 PR 이전에 `iteration`이 세던 것은 무엇이었고, 그 계산 방식의 어떤 성질이 문제였는가? 두 가지 실패 방향을 모두 말하라.

> 루브릭
> - (a) 세던 대상이 "pursuit가 block된 횟수"임
> - (b) 잘 굴러가는 pursuit도 10번이면 멈춘다(과잉 정지)
> - (c) 아무것도 안 한 대기 턴도 예산을 똑같이 먹는다(부당 소비)

---

### 개념 4 — intuition (진전의 두 축)

**Q4.** "진전"으로 인정되는 두 가지 관측을 말하고, 각각을 상태 파일의 어떤 필드로 기억하는지 짚어라.

> 루브릭
> - (a) 두 축이 diff를 담은 커밋과 Story 상태 전환임
> - (b) 필드 이름이 `last_seen_head`와 `last_seen_stories_digest`임

**Q5.** Story 지문이 `{id:"s1", status:"pending"}` → `{id:"s1", status:"completed"}` 변화는 진전으로 읽으면서, `title`만 `"x"`에서 `"changed"`로 바뀐 경우는 진전으로 읽지 않는다. 지문 계산의 어떤 성질 때문인가? 배열 순서에 대해서는 어떻게 처리되는가?

> 루브릭
> - (a) 지문에 `id`와 `status` 쌍만 들어가고 나머지 필드는 버려짐
> - (b) 정렬 후 해싱하므로 배열 순서가 지문에 영향을 주지 않음

---

### 개념 5 — code / 진전 판정기

**Q6.** HEAD 해시가 바뀌었는데도 무진전으로 판정되는 경우를 세 가지 이상 들고, 이 넷을 한꺼번에 배제하는 판정 조건이 무엇인지 말하라.

> 루브릭
> - (a) 빈 커밋 / amend / rebase / 커밋 후 revert 중 셋 이상
> - (b) 배제 장치가 `git diff --quiet <prior>..<head>`의 종료코드 1(=차이 있음)을 요구하는 것임

**Q7.** 판정기가 처음 도는 세션 — 즉 상태 파일에 지문이 아직 없는 경우 — 첫 Stop의 판정 결과는 무엇이고, 그때 상태 파일에는 무슨 일이 일어나는가?

> 루브릭
> - (a) 비교 상대가 없으므로 무진전으로 접힘 (`priorDigest !== null` 조건 때문)
> - (b) 지문만 심어 두고, 카운터는 결과적으로 1 올라감

---

### 개념 6 — code / 카운터와 대기 분기

**Q8.** 진전이 관측된 턴과 관측되지 않은 턴은 지문 저장 방식이 다르다. 어떻게 다르며, 그 차이가 없으면 무슨 일이 생기는가?

> 루브릭
> - (a) 진전 시에는 새 지문 전체를 덮어쓰고, 무진전 시에는 비어 있는 필드만 채움(`fingerprintPatch`)
> - (b) 무진전 턴이 기준점을 앞으로 밀지 않기 때문에 "연속" 무진전이 성립함 — 매 턴 갱신하면 직전 턴 대비로만 비교하게 됨

**Q9.** AI가 매 block마다 읽는 계속 메시지의 헤더 문자열이 무엇에서 무엇으로 바뀌었고, 그 교체가 왜 이 변경의 일부인가?

> 루브릭
> - (a) `[ULTRAGOAL - ITERATION n/m]` → `[ULTRAGOAL - NO-PROGRESS n/m]`
> - (b) 같은 숫자의 의미가 바뀐 사실을 프롬프트 표면에서도 드러내기 위함

**Q10.** `hooks/persistent-mode/index.ts`에 추가된 한 줄은 Claude의 동작을 어떻게 바꾸는가? 그 한 줄이 없었다면 무슨 일이 일어났을지 함께 말하라.

> 루브릭
> - (a) 추가된 것이 `deferredStopWakeGuaranteed: true`이고, Claude의 동작은 변경 전과 동일하게 유지됨(기능 추가가 아니라 회귀 방지)
> - (b) 없었다면 새 대기 분기가 Claude 쪽에도 백그라운드 block을 걸었을 것임

---

### 개념 7 — code / Codex 자식 감지

**Q11.** Codex 감지기가 자식 rollout의 마지막 64KB에서 아무 마커도 찾지 못했을 때, 어떤 조건에서 그 자식을 "살아 있음"으로 세는가? 그리고 그렇게 접는 이유는?

> 루브릭
> - (a) 파일 크기가 64KB(`ROLLOUT_TAIL_BYTES`)보다 클 때만 살아 있음으로 셈
> - (b) 이유는 갓 열린 rollout의 최초 `task_started` 마커가 tail 밖으로 밀려났을 수 있어서 — 보수적으로 활성 처리하되, tail 안의 종료 마커가 있으면 그쪽이 이김

---

### 개념 8 — code / 상태 락

**Q12.** 락 코드가 `ultragoal-state.ts`에서 `lib/persistent-mode-core/state-lock.ts`로 옮겨질 때, 단순 이사가 아니라 동작이 실제로 바뀐 곳이 한 군데 있다. 어디이며 무엇을 고친 것인가?

> 루브릭
> - (a) 해제 경로가 복구 가드를 한 번만 시도하던 것에서 얻을 때까지 도는 루프로 바뀜
> - (b) 고친 문제는, 다른 관측자가 복구 가드를 쥔 순간 자기 주 락을 남긴 채 떠나는 것

---

### 개념 9 — code / 재개 경로와 가드

**Q13.** `budget_limited`에서 되살리는 명령을 만들면서 읽기 함수를 두 겹으로 쪼개야 했다. 무엇을 쪼갰고, 쪼개지 않았다면 사용자가 무엇을 못 했겠는가?

> 루브릭
> - (a) `readGoalStateRaw`(종료 상태도 반환)와 `readGoalState`(active만 통과)로 갈랐고, `status` 서브커맨드가 Raw 쪽을 쓰게 됨
> - (b) `budget_limited`는 `active:false`라 기존 읽기로는 `status`가 `absent`만 내놓았고, 되살릴 대상이 있는지조차 확인할 수 없었음

---

### 개념 10 — code / 별개 수정

**Q14.** 이 병합에는 ultragoal 계약과 인과가 없는 파일이 하나 섞여 있다. 어떤 문제를 고쳤으며, 프로덕션 코드는 왜 안 고쳤는가?

> 루브릭
> - (a) `stop` 반환 후에도 detached 워커가 대기열 시작 구간에 남아 있어 곧바로 `clean`을 부르면 활성 멤버 거부에 걸리던 문제 — 테스트가 안정된 종료 상태를 기다리도록 고침
> - (b) `clean`의 대기열 멤버 거부는 의도된 동작이라 프로덕션 코드는 그대로 두고 테스트만 고침

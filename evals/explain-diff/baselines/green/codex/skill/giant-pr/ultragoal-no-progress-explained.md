# ultragoal의 무진전 실행 제어

대상 범위: `acd90900^..acd90900` (`acd90900234fa633264264414400f4dc10323df0`)

이 변경은 ultragoal이 Stop 훅을 여러 번 통과해도 실제 진전이 없을 때만 예산을 소진하도록 바꾼다. 작업 결과를 담은 커밋이나 Story 상태 전환은 카운터를 0으로 되돌리고, 실행 중인 위임 작업은 기다리게 하며, 한도 도달 후 재개는 사용자가 직접 승인해야 한다.

## Evidence

기본 noise 규칙(`*.lock`, `dist/`, 스냅샷, 생성물, 순수 포맷 변경)에 해당하는 변경은 없었다. 따라서 아래 29개 파일은 모두 signal이다.

| 분류 | 파일 | 근거 |
|---|---|---|
| signal | `CLAUDE.md` | 운영 규칙을 새 no-progress 의미와 동기화한다. |
| signal | `README.en.md` | 영어 공개 안내를 동기화한다. |
| signal | `README.md` | 한국어 공개 안내를 동기화한다. |
| signal | `docs/ORCHESTRATION.en.md` | 영어 오케스트레이션 계약을 동기화한다. |
| signal | `docs/ORCHESTRATION.md` | 한국어 오케스트레이션 계약을 동기화한다. |
| signal | `docs/skills/core-pipeline.en.md` | 영어 핵심 파이프라인 설명을 동기화한다. |
| signal | `docs/skills/core-pipeline.md` | 한국어 핵심 파이프라인 설명을 동기화한다. |
| signal | `hooks/codex-persistent-mode/cli.test.ts` | Codex 자식 작업 감지의 경계 조건을 검증한다. |
| signal | `hooks/codex-persistent-mode/cli.ts` | Codex Stop 훅에 실행 중 자식 감지를 연결한다. |
| signal | `hooks/codex-write-guard_test.sh` | 사용자 전용 재개 명령 차단을 검증한다. |
| signal | `hooks/persistent-mode/index.ts` | Claude 쪽의 안전한 background wait 계약을 명시한다. |
| signal | `hooks/pre-tool-enforcer_test.sh` | 공통 가드의 새 사용자 전용 명령을 검증한다. |
| signal | `hooks/write-guard-core.sh` | AI가 재개 명령을 직접 실행하지 못하게 한다. |
| signal | `hooks/write-guard-core_test.sh` | 공통 가드의 탐지 표면을 검증한다. |
| signal | `lib/persistent-mode-core/decision.test.ts` | Stop 의사결정의 진전·대기·한도 분기를 검증한다. |
| signal | `lib/persistent-mode-core/decision.ts` | 무진전 카운터와 background wait의 중심 정책이다. |
| signal | `lib/persistent-mode-core/progress.test.ts` | 커밋·Story fingerprint의 진전 판정을 검증한다. |
| signal | `lib/persistent-mode-core/progress.ts` | 진전을 계산하는 새 모듈이다. |
| signal | `lib/persistent-mode-core/state-lock.test.ts` | 상태 잠금의 경합·복구를 검증한다. |
| signal | `lib/persistent-mode-core/state-lock.ts` | ultragoal 상태 read-modify-write를 직렬화한다. |
| signal | `lib/persistent-mode-core/state.test.ts` | 잠금 실패 시 무잠금 쓰기가 없음을 검증한다. |
| signal | `lib/persistent-mode-core/state.ts` | 상태 갱신을 잠금으로 감싼다. |
| signal | `lib/persistent-mode-core/types.ts` | fingerprint 필드를 상태 계약에 추가한다. |
| signal | `skills/design-review/scripts/job.test.ts` | 현행 규칙에 맞게 관련 테스트를 정렬한다. |
| signal | `skills/ultragoal/SKILL.md` | orchestrator가 따라야 할 재개 권한과 의미를 정의한다. |
| signal | `skills/ultragoal/references/completion-gate.md` | 한도 도달 뒤 drain·완료·재개 순서를 정의한다. |
| signal | `skills/ultragoal/references/planning.md` | `max_iterations`의 새 단위를 정의한다. |
| signal | `skills/ultragoal/scripts/ultragoal-state.test.ts` | CLI의 terminal/raw 상태와 재개 거부 조건을 검증한다. |
| signal | `skills/ultragoal/scripts/ultragoal-state.ts` | `resume-pursuit` 상태 전이를 제공한다. |

## Background

### 깊은 배경
이미 익숙하면 건너뛰세요.

이 저장소의 persistent-mode Stop 훅은 에이전트가 미완료 작업을 두고 조용히 끝내지 않도록, 현재 상태를 읽어 **계속 진행시키거나** **멈춤을 허용**한다. ultragoal은 그 위에서 목표·Story·완료 게이트를 가진 장기 실행 모드다. 그래서 `iteration`은 단순한 반복 횟수가 아니라 Stop 때마다 다음 실행을 다시 유도할지, 사용자의 판단을 요청할지 결정하는 안전장치다.

### 좁은 배경

기존에는 pursuing 상태에서 Stop 훅이 막힐 때마다 `iteration`이 증가했고, `max_iterations`에 도달하면 `budget_limited`가 됐다. 이 범위는 그 정의를 바꾼다. 현재 HEAD가 이전에 본 커밋 이후 실제 diff를 담는 커밋을 추가했거나 Story의 `(id, status)` 집합이 바뀌면 진전으로 본다. 실행 중인 Codex 자식이 있으면 Stop은 기다림 메시지로 막고 카운터를 늘리지 않는다. 한도에 닿아도 완료로 위장하지 않고 상태를 보존하며, 재개는 `budget_limited`에서만 사용자 전용 CLI가 할 수 있다.

## Intuition

다음과 같이 **작업량**이 아니라 **멈출 때 관찰되는 진전**을 센다고 생각하면 된다. toy 상태가 `iteration=2`, `max_iterations=3`이고, 이번 Stop 전에 Story `worker-lock`가 `in_progress`에서 `completed`로 바뀌었다면 이는 진전이다. 따라서 카운터는 3이 아니라 **0**이 되고 다음 실행은 계속된다. 반대로 Story도 커밋도 바뀌지 않은 Stop이 한 번 더 오면 `iteration=2`는 3이 되어 pause가 된다. 단, 자식 실행자가 아직 `task_started` 상태라면 그 Stop은 관찰 가능한 결과를 기다리는 시간이라서 `iteration=2`를 소비하지 않는다.

<div style="display:flex;gap:16px;align-items:stretch;margin:16px 0"><div style="flex:1;border:1px solid #d0d7de;border-radius:8px;padding:12px"><strong>Before</strong><br>Stop → iteration + 1<br>결과가 있어도 예산 소진</div><div style="flex:1;border:1px solid #2da44e;border-radius:8px;padding:12px"><strong>After</strong><br>Stop → fingerprint 비교<br>진전이면 0, 자식 실행 중이면 대기,<br>둘 다 아니면 +1</div></div>

<div style="display:flex;gap:10px;align-items:center;margin:16px 0"><span style="padding:8px;border-radius:6px;background:#ddf4ff">HEAD / Story 상태</span><span>→</span><span style="padding:8px;border-radius:6px;background:#fff8c5">progress.ts</span><span>→</span><span style="padding:8px;border-radius:6px;background:#dafbe1">decision.ts</span><span>→</span><span style="padding:8px;border-radius:6px;background:#f6f8fa">continuation · pause · wait</span></div>

## Change Group 1: 관찰 가능한 진전으로 Stop 예산을 다시 정의
> 예고: Stop 훅이 커밋과 Story 전이를 fingerprint로 비교해, 진전이 있으면 무진전 카운터를 초기화한다.
> 순서: 먼저 “진전”의 계산과 상태 보존 방식을 정해야 그 결과를 이용해 정책 분기를 바꿀 수 있다.

### `lib/persistent-mode-core/progress.ts`
**역할/변경 전 맥락** — 진전의 공유 판정 모듈이 없었다 (`base:lib/persistent-mode-core/progress.ts:absent`).
**무엇이 바뀌었나** — `HEAD`와 `last_seen_head` 사이에 실제 diff가 있는지, 그리고 정렬한 `(id,status)` 배열 SHA-256 digest가 달라졌는지를 계산해 새 fingerprint와 `progressed`를 반환한다 (`head:lib/persistent-mode-core/progress.ts:44`).
**왜 필요한가** — `[근거: "A diff-carrying commit or a story status transition is observed progress and resets the counter to `0`;"]`
**시스템 효과** — 빈 커밋·working tree 변경·갈라진 브랜치는 진전으로 오인하지 않고, Story 전이는 Git 없이도 진전으로 인정한다.
**추적성** — `lib/persistent-mode-core/progress.ts:44`

### `lib/persistent-mode-core/types.ts`
**역할/변경 전 맥락** — GoalState는 반복 횟수만 알고 마지막 관찰 지점은 저장하지 않았다 (`base:lib/persistent-mode-core/types.ts:100`).
**무엇이 바뀌었나** — `last_seen_head`와 `last_seen_stories_digest`를 optional 상태 필드로 추가한다 (`head:lib/persistent-mode-core/types.ts:114`).
**왜 필요한가** — `[추론: 다음 Stop에서 현재 값만 보면 변화 여부를 알 수 없으므로, 비교할 이전 fingerprint를 상태에 남겨야 한다.]`
**시스템 효과** — hook 재호출 사이에 진전을 누적 비교할 수 있다.
**추적성** — `lib/persistent-mode-core/types.ts:114`

### `lib/persistent-mode-core/state-lock.ts`
**역할/변경 전 맥락** — ultragoal 상태 파일의 병합 쓰기에 파일 단위 상호배제가 없었다 (`base:lib/persistent-mode-core/state-lock.ts:absent`).
**무엇이 바뀌었나** — `mkdir` 기반 lock, owner token, 30초 stale recovery, 토큰 확인 release를 구현하고 경합 timeout은 unlocked write 없이 실패시킨다 (`head:lib/persistent-mode-core/state-lock.ts:24`).
**왜 필요한가** — `[근거: "A contention timeout fails closed; callers never fall back to an unlocked write."]`
**시스템 효과** — 동시에 들어온 Stop 훅과 CLI 재개가 서로의 fingerprint·iteration 갱신을 덮어쓰지 않는다.
**추적성** — `lib/persistent-mode-core/state-lock.ts:24`

### `lib/persistent-mode-core/state.ts`
**역할/변경 전 맥락** — `updateUltragoalState`는 읽고 병합한 뒤 쓰는 구간을 단독으로 수행했다 (`base:lib/persistent-mode-core/state.ts:201`).
**무엇이 바뀌었나** — ultragoal raw 상태 판독을 보강하고 `updateUltragoalState` 전체를 `withStateLock`으로 감싼다 (`head:lib/persistent-mode-core/state.ts:177`, `head:lib/persistent-mode-core/state.ts:204`).
**왜 필요한가** — `[근거: "Minimal mkdir lock for every read-modify-write of an ultragoal state file."]`
**시스템 효과** — active=false인 terminal 상태도 유효한 raw 상태로 읽고, 갱신 경쟁에서는 안전하게 거부한다.
**추적성** — `lib/persistent-mode-core/state.ts:204`

### `lib/persistent-mode-core/decision.ts`
**역할/변경 전 맥락** — pursuing Stop마다 iteration을 올리고 한도에 닿으면 일반 budget limit 메시지를 냈다 (`base:lib/persistent-mode-core/decision.ts:368`).
**무엇이 바뀌었나** — `evaluateProgress` 결과로 진전 시 iteration을 0으로 저장하고 continuation을 낸다. 진전이 없을 때만 증가시키며, 최대치에서는 `budget_limited`와 “NO-PROGRESS LIMIT” 메시지로 soft-stop한다 (`head:lib/persistent-mode-core/decision.ts:360`).
**왜 필요한가** — `[근거: "consecutive Stops passed with no observed progress (no diff-carrying commit, no story transition)"]`
**시스템 효과** — 실제 생산이 계속되는 긴 pursuit가 반복 예산 때문에 멈추는 문제를 줄이되, 아무 변화 없는 loop는 계속 제한한다.
**추적성** — `lib/persistent-mode-core/decision.ts:360`

### `hooks/persistent-mode/index.ts`
**역할/변경 전 맥락** — shared decision core에 background wait가 다시 호출될 수 있는지 전달하지 않았다 (`base:hooks/persistent-mode/index.ts:30`).
**무엇이 바뀌었나** — Claude consumer는 `deferredStopWakeGuaranteed: true`를 전달한다 (`head:hooks/persistent-mode/index.ts:31`).
**왜 필요한가** — `[근거: "Stop may bypass only if deferred re-invocation is guaranteed;"]`
**시스템 효과** — Claude는 작업 종료 통지가 Stop 훅을 다시 깨운다는 전제 아래에만 background 작업 중 Stop을 허용한다.
**추적성** — `hooks/persistent-mode/index.ts:31`

## Change Group 2: 실행 중인 자식은 기다리고, pause 재개는 사람에게 맡긴다
> 예고: 앞 그룹의 무진전 판정 위에 Codex 자식 작업 대기를 얹고, 한도 도달 뒤 재개 권한을 CLI와 가드로 제한한다.
> 순서: 무엇이 진전이고 언제 카운터가 리셋되는지 정해진 뒤에야 “아직 결과가 없는 실행 중 작업”을 별도 대기 상태로 구분할 수 있다.

### `hooks/codex-persistent-mode/cli.ts`
**역할/변경 전 맥락** — Codex Stop payload에는 background-task 수가 없어서 shared core에 항상 0을 넘겼다 (`base:hooks/codex-persistent-mode/cli.ts:260`).
**무엇이 바뀌었나** — active pursuing ultragoal일 때 private SQLite의 open child edge와 rollout JSONL tail(64 KiB)을 읽어 마지막 `task_started`/terminal marker를 판별하고, 그 수를 `activeBackgroundTaskCount`로 전달한다 (`head:hooks/codex-persistent-mode/cli.ts:265`, `head:hooks/codex-persistent-mode/cli.ts:316`).
**왜 필요한가** — `[근거: "Codex Stop payload's closed schema carries no background-task data"]`
**시스템 효과** — 실행 중 자식이 있으면 Codex도 새 Story를 dispatch하지 않고 wait를 block하며, DB·rollout 이상은 diagnostic 한 번과 0으로 fail-open한다.
**추적성** — `hooks/codex-persistent-mode/cli.ts:316`

### `skills/ultragoal/scripts/ultragoal-state.ts`
**역할/변경 전 맥락** — CLI는 `budget_limited`를 pursuing으로 되돌리는 좁은 전이를 제공하지 않았다 (`base:skills/ultragoal/scripts/ultragoal-state.ts:1`).
**무엇이 바뀌었나** — `resumePursuit`와 `resume-pursuit` subcommand를 추가해 존재·유효성·`budget_limited` phase를 확인한 뒤 `pursuing`, `active=true`, `iteration=0`으로 원자적으로 갱신한다 (`head:skills/ultragoal/scripts/ultragoal-state.ts:1`).
**왜 필요한가** — `[근거: "Recovers only a `budget_limited` pursuit, restoring `phase=pursuing`, `active=true`, and `iteration=0`; refuses from any other phase."]`
**시스템 효과** — complete·blocked 상태를 실수로 되살리지 않고, 보존된 pursuit만 명시적으로 재무장한다.
**추적성** — `skills/ultragoal/scripts/ultragoal-state.ts:1`

### `hooks/write-guard-core.sh`
**역할/변경 전 맥락** — 사용자 전용 command 목록은 review dispatch renewal과 finding dismissal 두 개였다 (`base:hooks/write-guard-core.sh:196`).
**무엇이 바뀌었나** — masked command 안의 `ultragoal-state.ts`와 `resume-pursuit` 조합을 세 번째 사용자 전용 명령으로 deny한다 (`head:hooks/write-guard-core.sh:235`).
**왜 필요한가** — `[근거: "All three let the loop clear its own completion gate"]`
**시스템 효과** — AI가 “사용자 승인 후”라는 문구만 따르는 대신, 실제 shell 실행 경로가 구조적으로 막힌다.
**추적성** — `hooks/write-guard-core.sh:235`

### `skills/ultragoal/SKILL.md`
**역할/변경 전 맥락** — orchestration 문서는 iteration을 단순 pursuit block cap으로 설명했다 (`base:skills/ultragoal/SKILL.md:26`).
**무엇이 바뀌었나** — `resume-pursuit` authority row와 no-progress의 정의, background wait, 사용자 직접 실행 절차를 추가한다 (`head:skills/ultragoal/SKILL.md:26`).
**왜 필요한가** — `[근거: "During pursuit, `iteration` counts consecutive Stop turns with no observed progress."]`
**시스템 효과** — 실행자에게 새 runtime 정책과 권한 경계가 같은 문서에서 전달된다.
**추적성** — `skills/ultragoal/SKILL.md:26`

### `skills/ultragoal/references/completion-gate.md`
**역할/변경 전 맥락** — 한도 후 completion은 설명했지만 위임 작업을 drain하는 절차와 재개 권한은 충분히 명시하지 않았다 (`base:skills/ultragoal/references/completion-gate.md:122`).
**무엇이 바뀌었나** — in-flight 작업을 drain·harvest·commit한 뒤 completion gate를 확인하고, 거부되면 사용자 재개로 복구하도록 순서를 명시한다 (`head:skills/ultragoal/references/completion-gate.md:122`).
**왜 필요한가** — `[근거: "Do not dispatch new stories or interrupt running executors during this drain."]`
**시스템 효과** — pause가 실행 중 결과를 버리거나 새 작업을 중첩하는 상태가 되지 않는다.
**추적성** — `skills/ultragoal/references/completion-gate.md:122`

### `skills/ultragoal/references/planning.md`
**역할/변경 전 맥락** — planning 계약은 `max_iterations`를 pursuit block의 총 cap으로 설명했다 (`base:skills/ultragoal/references/planning.md:3`).
**무엇이 바뀌었나** — cap의 단위를 “consecutive no-progress Stop turns”로 바꾸고 reset·wait·user resume 조건을 정의한다 (`head:skills/ultragoal/references/planning.md:3`).
**왜 필요한가** — `[근거: "A diff-carrying commit or a story status transition is observed progress and resets the counter to `0`;"]`
**시스템 효과** — 계획 단계에서 설정한 숫자 10의 의미가 runtime과 일치한다.
**추적성** — `skills/ultragoal/references/planning.md:3`

## Change Group 3: 정책의 경계 조건을 회귀 테스트로 고정
> 예고: 앞 두 그룹의 fingerprint, 잠금, wait, 권한 정책이 다시 total-iteration 정책으로 퇴행하지 않도록 단위·통합·쉘 테스트를 늘린다.
> 순서: runtime 계산과 사용자 권한이 확정된 뒤에만 각 경계 조건의 기대 결과를 정확히 테스트할 수 있다.

### `lib/persistent-mode-core/progress.test.ts`
**역할/변경 전 맥락** — 새 progress module의 전용 회귀 표면이 없었다 (`base:lib/persistent-mode-core/progress.test.ts:absent`).
**무엇이 바뀌었나** — 첫 관찰, empty commit, diff-carrying commit, diverged/rewrite/revert, Story 전이, non-Git fail-open을 검증한다 (`head:lib/persistent-mode-core/progress.test.ts:38`).
**왜 필요한가** — `[근거: "empty commit reports no progress"]`
**시스템 효과** — iteration reset이 실제 변화에만 연결된다.
**추적성** — `lib/persistent-mode-core/progress.test.ts:38`

### `lib/persistent-mode-core/state-lock.test.ts`
**역할/변경 전 맥락** — lock implementation 자체가 없었다 (`base:lib/persistent-mode-core/state-lock.test.ts:absent`).
**무엇이 바뀌었나** — fresh contention refusal, stale recovery, successor token 보존, recovery-guard 경쟁을 검증한다 (`head:lib/persistent-mode-core/state-lock.test.ts:15`).
**왜 필요한가** — `[근거: "state lock contended; refusing unlocked write"]`
**시스템 효과** — 경쟁 상황에서 보이는 “성공”이 상태 손실을 가리는 일을 막는다.
**추적성** — `lib/persistent-mode-core/state-lock.test.ts:15`

### `lib/persistent-mode-core/decision.test.ts`
**역할/변경 전 맥락** — 기존 test는 증가형 iteration 정책을 주로 검증했다 (`base:lib/persistent-mode-core/decision.test.ts:1`).
**무엇이 바뀌었나** — progress reset, no-progress cap, background wait 비소비, fingerprint/heartbeat와 legacy state의 상호작용을 추가 검증한다 (`head:lib/persistent-mode-core/decision.test.ts:2558`).
**왜 필요한가** — `[근거: "a genuine iteration advance (non-empty partial) DOES advance progress_touched_at"]`
**시스템 효과** — decision core가 새 의미를 유지하면서 stale state 때문에 영구 block되지 않는지 확인한다.
**추적성** — `lib/persistent-mode-core/decision.test.ts:2558`

### `lib/persistent-mode-core/state.test.ts`
**역할/변경 전 맥락** — ultragoal 갱신의 경합 거부를 state writer 레벨에서 확인하지 않았다 (`base:lib/persistent-mode-core/state.test.ts:1`).
**무엇이 바뀌었나** — lock contention 오류 뒤 원본 state bytes가 그대로인지 확인한다 (`head:lib/persistent-mode-core/state.test.ts:943`).
**왜 필요한가** — `[근거: "state lock contended; refusing unlocked write"]`
**시스템 효과** — lock helper만 통과하고 실제 writer가 우회하는 회귀를 막는다.
**추적성** — `lib/persistent-mode-core/state.test.ts:943`

### `hooks/codex-persistent-mode/cli.test.ts`
**역할/변경 전 맥락** — Codex는 private child DB와 rollout tail을 보지 않았다 (`base:hooks/codex-persistent-mode/cli.test.ts:82`).
**무엇이 바뀌었나** — `task_started`/`task_complete`, stale rollout, malformed DB·JSONL, 64 KiB bounded tail, 10개 live child를 포함한 Stop 동작을 검증한다 (`head:hooks/codex-persistent-mode/cli.test.ts:692`).
**왜 필요한가** — `[근거: "bounded rollout tail uses the final complete in-tail marker"]`
**시스템 효과** — Codex에서 wait가 잘못 카운터를 소진하거나 corrupt telemetry가 Stop을 깨뜨리는 회귀를 막는다.
**추적성** — `hooks/codex-persistent-mode/cli.test.ts:842`

### `skills/ultragoal/scripts/ultragoal-state.test.ts`
**역할/변경 전 맥락** — resume transition과 terminal raw 상태 동작의 test가 없었다 (`base:skills/ultragoal/scripts/ultragoal-state.test.ts:1`).
**무엇이 바뀌었나** — 재개 가능 phase, 잘못된 phase 거부, 상태 보존과 CLI boundary를 검증한다 (`head:skills/ultragoal/scripts/ultragoal-state.test.ts:1`).
**왜 필요한가** — `[근거: "refuses from any other phase."]`
**시스템 효과** — pause 복구가 complete/blocked를 부활시키지 않는다는 계약을 고정한다.
**추적성** — `skills/ultragoal/scripts/ultragoal-state.test.ts:1`

### `hooks/write-guard-core_test.sh`
**역할/변경 전 맥락** — user-authorized command detector는 기존 두 subcommand만 검증했다 (`base:hooks/write-guard-core_test.sh:1`).
**무엇이 바뀌었나** — 새 재개 subcommand의 공백·순서 변형을 포함한 deny 표면을 추가한다 (`head:hooks/write-guard-core_test.sh:1`).
**왜 필요한가** — `[근거: "Same normalization the dangerous-command guard applies"]`
**시스템 효과** — 탭이나 argument 순서로 user-only 경계를 우회하지 못한다.
**추적성** — `hooks/write-guard-core_test.sh:1`

### `hooks/codex-write-guard_test.sh`
**역할/변경 전 맥락** — Codex wrapper가 새 사용자 전용 명령을 전달받는 경우를 다루지 않았다 (`base:hooks/codex-write-guard_test.sh:1`).
**무엇이 바뀌었나** — Codex path의 deny 동작을 추가 검증한다 (`head:hooks/codex-write-guard_test.sh:1`).
**왜 필요한가** — `[근거: "user only"]`
**시스템 효과** — 공통 shell guard와 Codex integration의 권한 경계가 함께 유지된다.
**추적성** — `hooks/codex-write-guard_test.sh:1`

### `hooks/pre-tool-enforcer_test.sh`
**역할/변경 전 맥락** — Claude pre-tool integration에 새 deny case가 없었다 (`base:hooks/pre-tool-enforcer_test.sh:1`).
**무엇이 바뀌었나** — 공통 guard의 새 command rule을 wrapper 레벨에서도 검증한다 (`head:hooks/pre-tool-enforcer_test.sh:1`).
**왜 필요한가** — `[근거: "the command reaches the CLI only when the human runs it"]`
**시스템 효과** — 플랫폼별 shim 누락으로 authority boundary가 갈라지는 것을 막는다.
**추적성** — `hooks/pre-tool-enforcer_test.sh:1`

### `skills/design-review/scripts/job.test.ts`
**역할/변경 전 맥락** — 관련 workflow test가 변경된 규칙 표면과 완전히 정렬되지 않았다 (`base:skills/design-review/scripts/job.test.ts:1`).
**무엇이 바뀌었나** — job test의 기대값·fixture를 현재 orchestration 계약에 맞춰 보강한다 (`head:skills/design-review/scripts/job.test.ts:1`).
**왜 필요한가** — `[추론: 이 PR의 테스트 변경군에 포함되어, 인접 workflow가 persistent-mode/ultragoal 정책 변경과 함께 검증되도록 정렬한다.]`
**시스템 효과** — 설계 리뷰 job의 독립 검증 표면이 이번 정책 변경으로 흔들리지 않는지 확인한다.
**추적성** — `skills/design-review/scripts/job.test.ts:1`

## Change Group 4: 사람이 읽는 운영 계약을 새 정책과 맞춘다
> 예고: 검증된 runtime·권한 모델을 운영 문서와 양언어 README에 반영해, 사용자가 total cap으로 오해하지 않게 한다.
> 순서: 코드와 테스트가 먼저 새 행위를 확정했으므로, 마지막에 그 확정된 행위만 문서 계약으로 승격한다.

### `CLAUDE.md`
**역할/변경 전 맥락** — repository 작업 규칙이 이전 반복 설명을 담고 있었다 (`base:CLAUDE.md:1`).
**무엇이 바뀌었나** — persistent-mode hook 요약에 observed diff·Story transition reset과 background wait를 반영한다 (`head:CLAUDE.md:1`).
**왜 필요한가** — `[근거: "feat: ultragoal 무진전 실행 제어 추가"]`
**시스템 효과** — 작업 에이전트가 최상위 안내에서 새 lifecycle 의미를 본다.
**추적성** — `CLAUDE.md:1`

### `README.md`
**역할/변경 전 맥락** — 한국어 사용자 안내에 새 pause/recovery 의미가 없었다 (`base:README.md:1`).
**무엇이 바뀌었나** — ultragoal 설명을 무진전 soft-stop과 사용자 재개 계약으로 갱신한다 (`head:README.md:1`).
**왜 필요한가** — `[근거: "iteration은 진전이 관찰되지 않은 Stop의 연속 횟수입니다."]`
**시스템 효과** — 한국어 독자가 “10번 실행 후 종료”로 오해하지 않는다.
**추적성** — `README.md:1`

### `README.en.md`
**역할/변경 전 맥락** — 영어 사용자 안내도 이전 cap 의미를 사용했다 (`base:README.en.md:1`).
**무엇이 바뀌었나** — README.md와 같은 no-progress 정책을 영어로 맞춘다 (`head:README.en.md:1`).
**왜 필요한가** — `[근거: "A diff-carrying commit or a story status transition is observed progress"]`
**시스템 효과** — 언어에 따라 서로 다른 운영 규칙을 배우는 문제가 없다.
**추적성** — `README.en.md:1`

### `docs/ORCHESTRATION.md`
**역할/변경 전 맥락** — 한국어 오케스트레이션 문서는 iteration cap을 총 실행 보호장치로 설명했다 (`base:docs/ORCHESTRATION.md:1`).
**무엇이 바뀌었나** — reset, background wait, `budget_limited`, user-run resume와 blocked의 차이를 추가한다 (`head:docs/ORCHESTRATION.md:1`).
**왜 필요한가** — `[근거: "blocked는 별도이며 B1(실행 가능한 미완료 항목 없음) 또는 설정한 `blocked-stop` 조건에서만 발생합니다."]`
**시스템 효과** — pause와 실제 blocker가 같은 terminal outcome으로 취급되지 않는다.
**추적성** — `docs/ORCHESTRATION.md:1`

### `docs/ORCHESTRATION.en.md`
**역할/변경 전 맥락** — 영어 오케스트레이션 문서도 같은 이전 모델을 설명했다 (`base:docs/ORCHESTRATION.en.md:1`).
**무엇이 바뀌었나** — 한국어 문서의 정책 변경을 대응하는 영어 설명에 반영한다 (`head:docs/ORCHESTRATION.en.md:1`).
**왜 필요한가** — `[추론: 동등한 한·영 문서 쌍이 함께 변경되어 동일한 external contract를 유지한다.]`
**시스템 효과** — 운영자·기여자 모두 같은 재개 권한과 cap 단위를 참고한다.
**추적성** — `docs/ORCHESTRATION.en.md:1`

### `docs/skills/core-pipeline.md`
**역할/변경 전 맥락** — 한국어 core pipeline 설명에는 새 ultragoal stop 의미가 없었다 (`base:docs/skills/core-pipeline.md:1`).
**무엇이 바뀌었나** — persistent pursuit의 no-progress limit 및 resume 경로를 추가한다 (`head:docs/skills/core-pipeline.md:1`).
**왜 필요한가** — `[근거: "max_iterations(기본 10)에 도달하면 새 작업 없이 상태를 보존한 비완료 `budget_limited`로 소프트 정지합니다."]`
**시스템 효과** — pipeline 독자가 soft-stop을 성공이나 오류로 오해하지 않는다.
**추적성** — `docs/skills/core-pipeline.md:1`

### `docs/skills/core-pipeline.en.md`
**역할/변경 전 맥락** — 영어 pipeline 설명도 동기화가 필요했다 (`base:docs/skills/core-pipeline.en.md:1`).
**무엇이 바뀌었나** — 대응하는 no-progress 운영 설명을 추가한다 (`head:docs/skills/core-pipeline.en.md:1`).
**왜 필요한가** — `[추론: 같은 파일쌍의 병행 변경이므로 한국어 pipeline 계약과 영어 독자용 계약을 동기화한다.]`
**시스템 효과** — 다국어 문서의 lifecycle 계약이 갈라지지 않는다.
**추적성** — `docs/skills/core-pipeline.en.md:1`

## Quiz

다음은 서술형 단답 문항 뱅크다. 각 문항의 괄호 안 루브릭은 정답에 반드시 포함되어야 할 항목이며, 같은 concept 안에서 중복되는 루브릭은 없다. 총 8개라서 20개 상한을 자를 필요가 없다. 여기서는 문항을 문서화만 하며, 대화형 출제·채점은 수행하지 않는다.

### Concept: Evidence 분류

**문항.** 이 변경에서 noise로 분류된 파일 수와 signal 파일 수는 각각 몇 개인가? signal 중 새로 추가된 진전 계산 모듈의 경로도 쓰라.

루브릭: (1) noise 0개, (2) signal 29개, (3) `lib/persistent-mode-core/progress.ts`.

### Concept: 배경의 예산 단위

**문항.** 새 `iteration`이 세는 정확한 이벤트는 무엇이며, 어떤 두 종류의 관찰 결과가 이를 0으로 되돌리는가?

루브릭: (1) 연속된 no-progress Stop, (2) diff-carrying commit, (3) Story status transition.

### Concept: toy 상태 전이

**문항.** `iteration=2`, `max_iterations=3`일 때 Story `worker-lock`가 완료되면 카운터가 얼마가 되는가? 실행 중 자식이 있을 때에는 왜 3으로 증가하지 않는가?

루브릭: (1) 0으로 reset, (2) `worker-lock`, (3) background wait는 결과를 기다리는 Stop이라 소모하지 않음.

### Concept: fingerprint 판정

**문항.** progress module이 Git 측에서 empty commit을 진전으로 보지 않는 이유와, Git 없이도 진전을 감지하는 입력을 설명하라.

루브릭: (1) `git diff --quiet` 결과로 실제 tree diff를 확인, (2) empty commit은 diff 없음, (3) 정렬된 `(id,status)` Story digest.

### Concept: Codex child wait

**문항.** Codex Stop 훅은 child 작업을 어느 DB 파일에서 찾고 rollout의 어느 크기까지만 읽는가? 어떤 마지막 marker가 active 판정에 직접 쓰이는가?

루브릭: (1) `state_5.sqlite`, (2) 64 KiB, (3) `task_started`.

### Concept: pause 재개 권한

**문항.** `resume-pursuit`가 받아들이는 직전 phase와 성공 시 쓰는 세 상태값을 모두 쓰라. 왜 AI가 이 명령을 직접 실행할 수 없는가?

루브릭: (1) `budget_limited`, (2) `pursuing`·`active=true`·`iteration=0`, (3) PreToolUse/write guard의 user-only deny.

### Concept: 상태 동시성

**문항.** ultragoal state lock이 신선한 경합에서 선택하는 동작과 stale lock에서 선택하는 동작은 각각 무엇인가? stale 기준 시간도 쓰라.

루브릭: (1) fresh contention은 unlocked write 없이 거부, (2) stale lock recovery, (3) 30초.

### Concept: completion 중 drain

**문항.** no-progress limit에 도달한 뒤 completion gate를 시도하기 전에 실행 중 위임 작업에 대해 해야 할 두 행동과 하면 안 되는 한 행동을 쓰라.

루브릭: (1) drain, (2) 결과 harvest 및 commit, (3) 새 Story dispatch 또는 running executor interrupt를 하지 않음.

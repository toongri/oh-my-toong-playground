# PR #243 — ultragoal 무진전(no-progress) 실행 제어

**대상 커밋**: `acd90900` (merge commit, PR #243 `toongri/scalloped-account`)
**범위**: 29개 파일, +1,858 / −274, 하위 커밋 23개
**저장소**: oh-my-toong (멀티 AI 스킬·훅 관리 시스템)

---

## 0. 한 줄 요약

ultragoal(자율 목표 추구 실행기)의 `iteration` 카운터가 **"Stop이 몇 번 일어났나"에서 "진전 없이 Stop이 연속 몇 번 일어났나"로 의미가 바뀌었고**, 카운터가 한도에 닿아 멈춘 pursuit을 **사용자만 실행할 수 있는 `resume-pursuit` 명령으로 되살릴 수 있게** 되었다.

---

## 1. 사전 지식 — 이 코드가 뭘 하는 물건인가

이 저장소를 처음 보는 사람을 위한 최소 어휘부터.

| 용어 | 뜻 |
|---|---|
| **ultragoal** | 하나의 목표(objective)를 여러 Story로 쪼개 순차 실행하는 자율 오케스트레이션 스킬. 사람이 매 턴 개입하지 않아도 계속 굴러간다. |
| **Story** | ultragoal이 순차 디스패치하는 작업 단위. `unconfirmed` / `confirmed` / `retired` 상태를 가진다. |
| **Stop 훅** | AI가 턴을 끝내려 할 때 호출되는 lifecycle 훅. 여기서 "아직 일이 남았다"고 판정하면 **block**을 반환해 AI를 계속 일하게 만든다. 이 저장소에서는 `hooks/persistent-mode/`(Claude)와 `hooks/codex-persistent-mode/`(Codex)가 그 역할이고, 판정 로직 본체는 두 플랫폼이 공유하는 `lib/persistent-mode-core/decision.ts`의 `makeDecision()`이다. |
| **phase** | ultragoal 상태 파일의 생애주기 필드: `planning` → `pursuing` → (`complete` / `budget_limited` / `blocked`). |
| **`iteration` / `max_iterations`** | 추구(pursuit)를 무한히 돌지 못하게 막는 유한 예산. 기본 10. |
| **상태 파일** | `$OMT_DIR/ultragoal-state-<sessionId>.json`. 훅(TypeScript 라이브러리)과 CLI(`skills/ultragoal/scripts/ultragoal-state.ts`) **양쪽이 같은 파일을 읽고 쓴다.** |

---

## 2. 변경 전에 무엇이 문제였나

### 문제 1 — 예산이 "노력"이 아니라 "시간"을 셌다

변경 전 `decision.ts`는 pursuit 중 Stop이 발생할 때마다 무조건 카운터를 올렸다.

```ts
// BEFORE
const newIteration = ultragoal.iteration + 1;
```

즉 **일을 아주 잘 하고 있어도** 턴이 10번 끝나면 예산이 소진됐다. 커밋을 10개 쌓으며 착실히 전진한 세션과, 같은 자리에서 10번 헛돈 세션이 완전히 동일하게 취급된 것이다. 예산의 목적은 "교착 상태를 흡수"하는 것인데, 실제로 재던 것은 교착이 아니라 경과 턴 수였다.

### 문제 2 — 한도에 닿으면 되돌아올 길이 없었다

한도 도달 시 `phase=budget_limited`, `active=false`로 쓰고 소프트 정지했다. 상태는 보존되지만 **다시 `pursuing`으로 돌릴 공개 경로가 없었다.** 사용자가 "아니 계속 해도 되는데"라고 판단해도 손쓸 방법이 없었다.

### 문제 3 — 백그라운드 작업 대기가 예산을 갉아먹었다

위임한 서브에이전트가 아직 돌고 있어서 기다리는 턴도 그냥 Stop이다. 기다리는 것은 진전도 정체도 아닌데 예산은 똑같이 소모됐다. Claude 쪽은 `activeBackgroundTaskCount > 0`이면 조기 `continue`로 빠져나가 이 문제를 피했지만, **Codex는 자기 자식 작업이 몇 개 도는지 세는 수단 자체가 없어서 항상 `0`을 넘기고 있었다.**

### 문제 4 — 같은 파일을 두 주체가 락 없이 썼다

CLI(`ultragoal-state.ts`)는 mkdir 기반 상태 락을 갖고 있었지만, 훅 쪽 `updateUltragoalState()`(`lib/persistent-mode-core/state.ts`)는 **락 없이** read-modify-write 했다. 훅이 `iteration`을 쓰는 순간 CLI가 다른 필드를 쓰면 한쪽이 통째로 날아갈 수 있다. 무진전 카운터를 도입하면 훅의 쓰기 빈도가 올라가므로 이 창이 실제 위험이 된다.

---

## 3. 변경의 큰 그림

```
                      Stop 훅 발화
                           │
                           ▼
             ┌─────────────────────────────┐
             │ 백그라운드 작업이 돌고 있나?     │
             └─────────────┬───────────────┘
                    예     │      아니오
          ┌───────────────┘        └──────────────┐
          ▼                                       ▼
  wake 보장이 있나?                       ┌──────────────────────┐
  (Claude=예, Codex=아니오)               │ evaluateProgress()    │
   ├─ 예 → continue (턴 종료 허용)        │  · diff 있는 커밋?    │
   │        하네스가 완료 시 재호출        │  · Story 상태 전환?   │
   └─ 아니오 → block                      └───────┬──────────────┘
        "background-wait" 메시지                  │
        ※ iteration 소모 안 함             진전 O │ 진전 X
                                       ┌─────────┘  └───────────┐
                                       ▼                        ▼
                              iteration = 0             iteration + 1
                              지문 갱신 후 계속          (지문은 그대로)
                                                                │
                                                   ┌────────────┴───────────┐
                                                   ▼                        ▼
                                          < max_iterations         ≥ max_iterations
                                            계속 추구                budget_limited
                                                                     (소프트 정지)
                                                                          │
                                                          사용자가 직접 실행 ▼
                                                            resume-pursuit
                                                        → pursuing, iteration=0
```

---

## 4. 부품별 상세

### 4-1. 진전 지문 — `lib/persistent-mode-core/progress.ts` (신규 67줄)

핵심 질문: **"지난 Stop 이후로 실제로 뭔가 전진했는가?"** 를 어떻게 기계적으로 판정할 것인가. 답은 두 축의 지문(fingerprint)이다.

**축 A — 저장소 HEAD (커밋 진전)**

```ts
const ancestor = git(cwd, ["merge-base", "--is-ancestor", priorHead, head]);
if (ancestor?.code === 0) {
    const diff = git(cwd, ["diff", "--quiet", `${priorHead}..${head}`]);
    commitProgress = diff?.code === 1;   // exit 1 == 차이 있음
}
```

두 조건을 **모두** 만족해야 커밋 진전이다.

1. 이전에 본 HEAD가 지금 HEAD의 **조상**이어야 한다 (`merge-base --is-ancestor`).
2. 그 구간에 **실제 diff가 있어야** 한다 (`git diff --quiet`는 차이가 있으면 exit 1).

이 조합이 다음을 전부 걸러낸다 — 그리고 전부 테스트로 고정돼 있다.

| 상황 | 판정 | 왜 |
|---|---|---|
| 코드 변경을 담은 커밋 | **진전** | 조상 O, diff O |
| `--allow-empty` 빈 커밋 | 진전 아님 | 조상 O, diff 없음 |
| 커밋 후 그 커밋을 revert | 진전 아님 | 조상 O, 누적 diff 0 |
| `commit --amend` | 진전 아님 | 이전 HEAD가 더 이상 조상이 아님 |
| rebase로 이전 HEAD가 사라짐 | 진전 아님 | 조상 아님 |
| 다른 브랜치로 checkout(분기) | 진전 아님 | 조상 아님 |
| 워킹트리만 수정(커밋 안 함) | 진전 아님 | HEAD 불변 |

의도가 뚜렷하다: **"커밋 해시가 바뀌었다"가 아니라 "저장소에 내용이 실제로 쌓였다"만 진전으로 인정한다.** 빈 커밋을 찍어 예산을 무한 연장하는 자기기만 경로를 원천 차단하는 설계다.

**축 B — Story 집합 다이제스트**

```ts
const pairs = source
    .filter(/* id·status가 null/undefined가 아닌 것만 */)
    .map((story) => [String(story.id), String(story.status)] as const)
    .sort(/* id 우선, 동률이면 status */);
return createHash("sha256").update(JSON.stringify(pairs)).digest("hex");
```

`(id, status)` 쌍만 뽑아 **정렬 후** SHA-256. 정렬이 핵심이다 — 배열 순서만 바뀐 것(reorder)은 진전으로 세면 안 되므로 순서 정보를 지문에서 제거한다. 실제로 의미 있는 변화, 즉 **Story의 상태 전환**(`unconfirmed → confirmed` 등)만 다이제스트를 바꾼다.

**최초 관측 처리**

```ts
const storyProgress = priorDigest !== null && priorDigest !== storiesDigest;
```

이전 지문이 없으면(첫 관측) **진전으로 치지 않고 초기화만 한다.** `priorDigest !== null` 조건이 그 역할이다. 없는 값과 비교해서 "달라졌다"고 우기지 않는다.

**git 밖에서는 fail-open**

`git()` 헬퍼는 예외를 삼키고 `null`을 반환한다. git 저장소가 아니거나 git 실행이 실패하면 커밋 축은 판정 불가 → 커밋 진전 없음으로 처리되고 Story 축만 살아 돌아간다. 훅이 터져서 세션을 죽이는 일은 없다. 테스트: `fails open outside a git repository`.

### 4-2. 판정 흐름 재배치 — `lib/persistent-mode-core/decision.ts`

`makeDecision()`의 pursuit 분기가 통째로 재구성됐다. 순서가 중요하다.

```ts
const progress = evaluateProgress(ultragoal, projectRoot);   // decision.ts:372
```

그 다음 **두 종류의 지문 패치**를 만든다. 이 구분이 이 PR에서 가장 놓치기 쉬운 지점이다.

```ts
// 진전이 있을 때 쓰는 것: 관측한 값을 그대로 반영
const persistedFingerprint = { /* head(널 아니면) + digest 전부 */ };

// 진전이 없을 때 쓰는 것: "빠져 있는 필드만" 채우는 초기화 패치
const fingerprintPatch = {
    ...((typeof ultragoal.last_seen_head !== "string" || ultragoal.last_seen_head.trim() === "")
        && progress.newFingerprint.last_seen_head !== null
        ? { last_seen_head: progress.newFingerprint.last_seen_head } : {}),
    ...(ultragoal.last_seen_stories_digest === undefined
        ? { last_seen_stories_digest: progress.newFingerprint.last_seen_stories_digest } : {}),
};
```

**왜 무진전일 때 지문을 갱신하지 않는가?** 기준선을 "마지막으로 진전이 관측된 지점"에 고정하기 위해서다. 매 Stop마다 지문을 최신으로 밀어 올리면, 여러 턴에 걸쳐 조금씩 쌓인 변화가 매번 "직전 대비 변화 없음"으로 읽혀 영원히 진전으로 인정되지 않는다. 기준선을 붙박아 두면 **누적된 전진**이 다음 관측에서 제대로 잡힌다.

빠진 필드만 채우는 이유는 부분 지문 대응이다. 예전 버전이 만든 상태 파일이나, head는 있는데 digest가 없는(또는 그 반대) 파일이 실제로 존재할 수 있다. 이 패치는 없는 쪽만 초기화하고 **있는 쪽은 절대 건드리지 않는다.** 있는 쪽을 덮어쓰면 그게 곧 기준선 리셋이라 위 문단의 문제가 재발한다. `last_seen_head`는 `""`(빈 문자열)도 미초기화로 취급한다(`.trim() === ""`). 관련 테스트가 세 개나 붙어 있다: `partial fingerprint with head only initializes missing digest`, `partial fingerprint with digest only initializes missing head`, `empty last_seen_head initializes then detects a later diff commit`.

**진전이 관측된 경우:**

```ts
if (progress.progressed) {
    const message = buildUltragoalContinuationMessage(ultragoal, 0, askToolName);
    try {
        updateUltragoalState(sessionId, { iteration: 0, ...persistedFingerprint });
        cleanupBlockCountFiles(stateDir, attemptId);
        return formatBlockOutput(message);
    } catch {
        /* 쓰기 실패 시 아래 무진전 경로로 폴백 */
    }
}
```

카운터를 0으로 되돌리고 **계속 block**(=계속 일하게 함)한다. 진전했다고 멈추는 게 아니라 "예산을 되돌려주고 계속 간다"는 뜻이다.

**한도 도달:**

```ts
const newIteration = Math.min(ultragoal.iteration + 1, ultragoal.max_iterations);
if (newIteration >= ultragoal.max_iterations) { /* budget_limited */ }
```

`Math.min` 클램프가 붙었다. 어떤 이유로든 `iteration`이 이미 한도를 넘겨 저장돼 있어도 표시 값이 `11/10` 같은 형태로 튀지 않는다.

**메시지 문구 변화** — 이 PR은 사용자/AI가 읽는 텍스트도 같이 고쳤다. 계약이 바뀌었으면 계약을 알리는 문장도 바뀌어야 하기 때문이다.

| 전 | 후 |
|---|---|
| `[ULTRAGOAL - ITERATION 3/10]` | `[ULTRAGOAL - NO-PROGRESS 3/10]` |
| `[ULTRAGOAL - BUDGET LIMIT REACHED]` + "새 작업 시작 금지" | `[ULTRAGOAL - NO-PROGRESS LIMIT REACHED]` + **배수(drain) 정책**: 진행 중 위임 작업을 **끝까지 두고 결과를 수확·커밋**하라, 새 Story 디스패치 금지, 실행 중 executor 중단 금지, 재개하려면 `resume-pursuit` 전체 명령을 **사용자에게 제시**하라 |

새 메시지가 "실행 중인 것을 죽이지 말라"를 명시하는 게 중요하다. 이전 메시지는 "아무 새 작업도 시작하지 말라"만 말해서, AI가 이미 돌던 작업까지 중단해 **완료 직전의 결과물을 버리는** 해석이 가능했다. 테스트 `budget limit message states drain policy`가 이 문구를 고정한다.

### 4-3. 백그라운드 대기 분기 — `deferredStopWakeGuaranteed`

`DecisionContext`에 플래그가 하나 추가됐다.

```ts
if (activeBackgroundTaskCount > 0) {                       // decision.ts:332
    if (context.deferredStopWakeGuaranteed === true) return formatContinueOutput();
    const waitingState = readUltragoalStateRaw(sessionId);
    if (waitingState?.active && waitingState.phase === "pursuing") {
        return formatBlockOutput(buildUltragoalWaitingOnBackgroundMessage());
    }
}
```

두 플랫폼의 근본적 차이를 코드로 표현한 것이다.

- **Claude** (`hooks/persistent-mode/index.ts`): `deferredStopWakeGuaranteed: true`. 백그라운드 작업이 끝나면 하네스가 세션을 **반드시 다시 깨워준다.** 그러니 턴을 끝내는 게 안전한 대기다 → `continue`.
- **Codex** (`hooks/codex-persistent-mode/cli.ts`): `deferredStopWakeGuaranteed: false`. 완료 알림이 `trigger_turn:false` 컨텍스트로 큐잉될 뿐 **재호출 보장이 없다.** 여기서 턴을 끝내면 결과를 영영 수확 못 한다 → **block**하고 "기다렸다가 결과를 수확하라"고 지시한다.

이 분기의 결정적 성질: **어느 쪽이든 `iteration`을 소모하지 않는다.** 이 검사가 진전 판정 코드보다 **위**에 있기 때문이다. 대기는 정체가 아니다. 테스트 `waiting-only stop chain does not exhaust budget`, `background tasks with wake guarantee continue without consuming`, `background tasks without wake guarantee block without consuming`가 이걸 고정한다.

주의할 비대칭 하나: `activeBackgroundTaskCount > 0`이고 wake 보장이 없는데 ultragoal이 활성 pursuit이 **아니면**, 이 블록은 아무것도 반환하지 않고 아래 일반 경로로 그대로 떨어진다(`no active ultragoal falls through guard 2 unchanged`).

### 4-4. Codex 자식 작업 감지기 — `detectActiveCodexChildren`

위 분기가 Codex에서 의미를 가지려면 "지금 자식 작업이 몇 개 도는지"를 알아야 한다. Codex는 그 수를 훅 페이로드로 주지 않으므로 **Codex의 내부 상태 DB를 직접 조회**한다.

```ts
const dbPath = join(codexHome, "state_5.sqlite");
const query =
  "SELECT t.id, t.rollout_path FROM thread_spawn_edges e JOIN threads t ON t.id=e.child_thread_id " +
  `WHERE e.parent_thread_id='${escapedSession}' AND e.status='open';`;
Bun.spawnSync(["sqlite3", "-readonly", "-separator", "|", dbPath, query], …);
```

세 가지 안전 장치가 눈에 띈다.

1. **`-readonly`** — 남의 프로세스가 쓰고 있는 DB를 절대 건드리지 않는다. 전용 테스트(`sqlite invocation includes -readonly`)까지 있다.
2. **`sessionId.replace(/'/g, "''")`** — SQL 문자열 이스케이프. (덧붙여 `sessionId`는 상위에서 `isSafeSessionId`로 이미 검증된다.)
3. **호출 자체가 조건부** — `active === true && phase === "pursuing"`일 때만 감지기를 돌린다(`inactive or planning ultragoal skips detector entirely`). 매 Stop마다 sqlite를 때리지 않겠다는 뜻이다.

**"살아 있음" 판정 — rollout 파일 tail 스캔**

DB가 `status='open'`이라고 말하는 자식이라도 실제로는 죽었을 수 있다. 그래서 각 자식의 rollout 로그(JSONL)를 실제로 읽는다.

```ts
const ageSeconds = (Date.now() - rolloutStat.mtimeMs) / 1000;
if (ageSeconds > CODEX_CHILD_STALE_TTL_SECONDS) continue;   // = TERMINAL_TTL_SECONDS = 1800초
```

먼저 30분(`TERMINAL_TTL_SECONDS`, `lib/state-core.ts:159`) 넘게 안 만져진 rollout은 죽은 것으로 보고 건너뛴다. 이 상수를 새로 만들지 않고 기존 것을 재사용한 것(커밋 `f78f1fc7` "Codex 자식 TTL 상수 통합")도 의도된 선택이다 — 같은 의미의 TTL이 두 군데서 따로 흘러가면 언젠가 어긋난다.

살아 있는 rollout은 **마지막 64KB만** 읽는다.

```ts
const ROLLOUT_TAIL_BYTES = 64 * 1024;
…
return size > length ? text.slice(text.indexOf("\n") + 1) : text;   // 잘린 첫 줄 버림
```

그 tail에서 `payload.type`이 `task_started` / `task_complete` / `turn_aborted`인 줄을 훑어 **마지막 마커**를 취한다. 마지막이 `task_started`면 아직 도는 중이다.

여기서 가장 미묘한 줄:

```ts
if (lastMarker === "task_started" ||
    (lastMarker === undefined && rolloutStat.size > ROLLOUT_TAIL_BYTES)) {
    count++;
}
```

**tail 안에 마커가 하나도 없는데 파일이 64KB보다 크면** 활성으로 센다. 이유: 방금 시작해서 폭발적으로 로그를 쏟아낸 자식은 `task_started` 마커가 이미 64KB 창 **바깥으로 밀려나 있을** 수 있다. 이때 "마커 없음 = 비활성"으로 처리하면 살아 있는 자식을 죽었다고 판정해 결과를 버리게 된다. 그래서 **보수적으로 활성**으로 본다. 단 tail 안에 종료 마커가 실제로 있으면 그게 이긴다. 커밋 `fe9a1470`("큰 rollout 자식 작업 감지 보완")과 `01255fcc`("부분 rollout 자식 감지 보존")가 이 지점을 다듬은 커밋들이다.

**부분 기록 줄 처리:**

```ts
try { event = JSON.parse(rawLine); }
catch {
    if (index === lines.length - 1 && !content.endsWith("\n")) continue;  // 쓰는 중 → 무시
    throw new Error("malformed rollout line");
}
```

마지막 줄이 개행으로 안 끝나면 "지금 기록 중"이므로 조용히 넘긴다. 그 외의 깨진 줄은 진짜 이상이므로 예외 → fail-open.

**fail-open 정책 전반**

sqlite3 바이너리 없음 / DB 파일 없음 / 쿼리 실패 / 출력 형식 이상 / rollout 판독 불가 — **전부 stderr에 진단 한 줄을 찍고 `0`을 반환한다.** 자식이 0개면 백그라운드 분기를 타지 않고 일반 무진전 판정으로 내려간다. 감지기를 못 믿는 상황에서 세션 전체를 망가뜨리지 않겠다는 선택이다. 그래서 `sqlite3`가 **런타임 필수 조건**으로 승격되어 `CLAUDE.md`와 두 README에 명시됐다.

### 4-5. `resume-pursuit` — 사용자 전용 복구

```ts
export function resumePursuit(sessionId: string): void {
    const stateFilePath = resolveStatePath(sessionId);
    withStateLock(stateFilePath, () => {
        const raw = readFileOrNull(stateFilePath);
        if (raw === null) throw new Error("resume-pursuit: refused — state file is absent");
        const prior = parseClaimableState(raw);
        if (prior === null) throw new Error("resume-pursuit: refused — state is corrupt or invalid");
        if (prior.phase !== "budget_limited") {
            throw new Error(`resume-pursuit: refused — phase must be budget_limited (got "…")`);
        }
        mergeWriteLocked(sessionId, stateFilePath, {
            phase: "pursuing", active: true, iteration: 0, budget_limit_notified: false,
        });
    });
}
```

설계 포인트 셋:

- **단일 간선만 허용한다.** `budget_limited → pursuing` 뿐. 다른 phase에서는 거부한다. `complete`나 `blocked`를 되살리는 우회로가 되면 완료 게이트가 무의미해진다.
- **seed하지 않는다.** 상태 파일이 없으면 만들지 않고 거부한다. 다른 setter들이 쓰는 `mergeWrite()`는 `ensureSeed()`로 자가 치유를 하는데, 이 경로는 일부러 그 편의를 뺐다. 없던 pursuit을 없던 자리에서 만들어내면 안 되기 때문이다.
- **`budget_limit_notified: false`** 를 같이 되돌린다. 이건 한도 통지를 한 번만 하도록 막는 write-once 가드다. 리셋하지 않으면 다음 한도 도달 시 통지가 안 뜬다.

**그리고 AI는 이 명령을 실행할 수 없다.**

`hooks/write-guard-core.sh`의 사용자 승인 전용 명령 목록에 `resume-pursuit`가 추가됐다.

```sh
*"dismiss-review-finding"* | *"approve-review-dispatch-renewal"* | *"resume-pursuit"*)
    printf '%s\n' "$_wg_core_user_authorized_deny_json"
```

PreToolUse 가드가 AI의 Bash 경로를 **deny**하고, 명령은 사람이 직접 자기 터미널에서 실행한다. 이 저장소의 반복되는 원칙이 여기 또 적용된 것이다 — "산문으로 '사용자 승인 후에만 실행하라'고 적어두는 것은 **경계심 기반** 권한이고, 경계심은 언젠가 무너진다. 가드로 막으면 **구조적** 권한이 된다."

그래서 이 두 줄짜리 변경에 **셸 테스트가 3개 파일에 걸쳐 6개** 붙었다. 특히 Codex 쪽은 우회 형태까지 검증한다:

```sh
'sub=resume-pursuit; bun …/ultragoal-state.ts "$sub"'          # 변수 간접 참조
's=resume-pursuit && bun …/ultragoal-state.ts "$s"'            # 대입이 뒤에 오는 순서
'bun  …/ultragoal-state.ts   resume-pursuit   --reason x'      # 다중 공백
```

문자열 부분 일치 기반 가드가 뚫리기 쉬운 대표적 모양들이다.

### 4-6. `readGoalState` / `readGoalStateRaw` 분리

작지만 이 PR 없이는 성립하지 않는 변경.

```ts
export function readGoalState(sessionId: string): GoalState | null {
    const state = readGoalStateRaw(sessionId);
    if (state === null || !state.active) return null;   // 활성 필터를 여기로 이동
    return state;
}

/** Schema-validated state read that preserves terminal (active:false) phases. */
export function readGoalStateRaw(sessionId: string): GoalState | null { /* active 필터 없음 */ }
```

기존 `readGoalState`는 `active === false`면 `null`을 돌려줬다. 그런데 `budget_limited`는 정의상 `active: false`다. 그래서 변경 전이라면 `status` 서브커맨드가 `budget_limited` 상태를 **`absent`(상태 없음)로 출력**했을 것이다. 사용자가 "왜 멈췄지?"를 확인할 방법이 사라진다. 그래서 `status`만 raw 읽기로 바꿨다.

```ts
} else if (subcommand === "status") {
    const state = readGoalStateRaw(sessionId);   // ← 이전에는 readGoalState
```

`get`은 그대로 `readGoalState`를 쓴다(테스트 `get keeps active-fold contract`). 활성 상태만 다루겠다는 기존 소비자 계약을 깨지 않기 위해서다.

### 4-7. 상태 락 공용화 — `lib/persistent-mode-core/state-lock.ts` (신규 168줄)

`ultragoal-state.ts` 안에만 있던 mkdir 기반 락 구현 130여 줄을 통째로 **공용 모듈로 이동**하고, 훅 쪽 `updateUltragoalState()`도 그 락을 쓰게 만들었다.

```ts
// lib/persistent-mode-core/state.ts
export function updateUltragoalState(sessionId: string, partial: Partial<UltragoalState>): void {
    const path = join(getOmtDir(), `ultragoal-state-${sessionId}.json`);
    withStateLock(path, () => { /* 기존 read-modify-write 전체 */ });
}
```

CLI의 `resolveStatePath()`도 `${getOmtDir()}/ultragoal-state-${sessionId}.json`이므로 **락 경로(`<파일>.lock`)가 정확히 일치한다** — 훅과 CLI가 같은 뮤텍스를 공유한다는 뜻이다. 이게 이 이동의 전부이자 목적이다.

락 자체의 동작:

- `mkdirSync(lockPath)` 성공 = 획득. 원자적 연산이라 별도 조율이 필요 없다.
- 소유자 정보를 `owner.json`에 기록: `{ ownerPid, token, startedAt }`.
- 5ms 간격 100회 재시도 → **실패 시 예외를 던진다.** "락 못 잡았으니 그냥 쓴다"는 폴백이 없다(`state lock contended; refusing unlocked write`). **fail-closed.** 테스트 `fresh live-owner contention fails closed without running the callback`는 콜백이 아예 실행되지 않는 것까지 확인한다.
- 죽은 락(stale) 회수: 소유 PID가 죽었거나 mtime이 30초를 넘으면 회수. 회수는 `rename` 후 삭제 — **먼저 격리하고 지운다.**

**해제 경합 수정** (커밋 `c8cb0cd0`, 이 PR의 마지막 커밋):

```ts
function releaseStateLock(lockPath: string, token: string): void {
    while (true) {
        if (withStateLockRecoveryGuard(lockPath, () => {
            if (readStateLockOwner(lockPath)?.token === token) {
                rmSync(lockPath, { recursive: true, force: true });
            }
        })) return;
        Atomics.wait(STATE_LOCK_SLEEP, 0, 0, STATE_LOCK_RETRY_MS);
    }
}
```

원래는 recovery guard 획득을 **한 번만 시도**했다. 실패하면(다른 프로세스가 stale 회수 중이라 guard를 쥐고 있으면) **자기 락을 안 지우고 그냥 반환**했다 — 그러면 멀쩡한 락이 남아 다음 30초 동안 모두를 막는다. 이제 guard를 잡을 때까지 기다린다. 버려진 guard는 기존 stale-TTL 경로가 회수하므로 영구 정지는 아니다. 테스트: `owner release waits for a long fresh recovery guard before allowing a subsequent writer`.

**토큰이 왜 필요한가**: 해제할 때 `owner.json`의 토큰이 **내 것인지** 확인한다. 내 락이 stale로 회수되고 그 자리에 다른 프로세스의 새 락이 들어섰다면 토큰이 다르므로 **남의 락을 지우지 않는다.** 테스트 `release preserves a successor lock when its owner token changed`.

### 4-8. 지문 필드의 병합 보존

`mergeWriteLocked()`가 최종 상태 객체를 필드별로 재구성하는 구조라, 새 필드는 **명시적으로 열거하지 않으면 조용히 사라진다.**

```ts
last_seen_head: next.last_seen_head ?? prior.last_seen_head,
last_seen_stories_digest: next.last_seen_stories_digest ?? prior.last_seen_stories_digest,
```

관계없는 다른 쓰기(예: `set-verdict`)가 지문을 날려버리지 못하게 하는 두 줄이다. 이게 없으면 verdict를 한 번 쓸 때마다 진전 기준선이 리셋되어 무진전 감지가 무력화된다. 테스트 `fingerprint fields survive merge write` / `fingerprint fields survive raw read`, 그리고 신규 세션에는 이 필드가 안 붙는지 확인하는 `fresh seed omits fingerprint fields`가 붙어 있다.

타입은 두 곳에 각각 선언됐다 — `lib/persistent-mode-core/types.ts`의 `GoalState`와 `skills/ultragoal/scripts/ultragoal-state.ts`의 `GoalState`. 훅 라이브러리와 스킬 CLI가 서로 다른 배포 경계에 있어서 타입 정의를 공유하지 않기 때문이다.

### 4-9. 곁다리 — design-review 워커 종료 대기

`skills/design-review/scripts/job.test.ts`는 이 PR에 섞인 유일한 **무관한 수정**이다. 프로덕션 코드 변경 없이 테스트만 고쳤다.

문제: 분리(detached) 워커는 `stop`이 반환된 뒤에도 아직 `queued` 시작 창에 있을 수 있다. 그 상태에서 `clean`을 호출하면 clean의 활성 멤버 거부 가드와 워커의 마지막 상태 기록이 **경합**한다 → 플래키 테스트.

해결: 모든 멤버가 종료 상태에 **500ms 동안 안정적으로** 머무는 것을 확인한 뒤 clean 하는 헬퍼를 추가했다.

```ts
const ACTIVE_STATES = new Set(["queued", "running", "retrying", "awaiting_resume"]);
async function waitForStableTerminal(jobDir: string, stableMs = 500): Promise<void> { … }
```

"종료 상태를 한 번 봤다"가 아니라 "일정 시간 유지되는 것을 봤다"인 점이 핵심이다. 상태가 잠깐 종료로 보였다가 다시 활성이 될 수 있기 때문이다. `terminalSince = null`로 리셋하는 else 분기가 그 처리다.

### 4-10. 문서

계약이 바뀌었으므로 계약을 서술한 문서가 **전부** 따라 바뀌었다 — 한국어/영어 쌍을 모두 유지하면서.

- `CLAUDE.md` — `sqlite3` 전제 조건, 훅 설명 갱신, 가드 목록에 `resume-pursuit`
- `README.md` / `README.en.md` — `sqlite3` 전제 조건
- `docs/ORCHESTRATION.md` / `.en.md` — 새 섹션 "반복 예산·진전 없음·재개" + 트러블슈팅 표의 "Sisyphus가 멈추지 않음" 항목 갱신
- `docs/skills/core-pipeline.md` / `.en.md` — 동일 계약 섹션
- `skills/ultragoal/SKILL.md` — `resume-pursuit` 행 추가 + 계약 문단
- `skills/ultragoal/references/planning.md` — `max_iterations`의 정의 자체를 "pursuit block의 유한 cap" → "**연속 무진전 Stop 턴**의 cap"으로 재정의
- `skills/ultragoal/references/completion-gate.md` — `budget_limited`에서의 **배수(drain) 절차**를 명문화("진행 중 위임 작업을 비우고 → 결과를 수확·커밋하고 → 완료 게이트를 돌린다. 새 Story 디스패치 금지, 실행 중 executor 중단 금지"). 그리고 blocked-stop 절에 있던 "cross-iteration stall detector는 없다"는 문장을 **삭제**했다 — 이 PR이 바로 그걸 만들었기 때문이다.

---

## 5. 헷갈리기 쉬운 것들

**"iteration이 0으로 리셋되면 멈추는 건가?"** — 아니다. 진전 시에도 `formatBlockOutput`을 반환한다. block은 "계속 일해라"라는 뜻이고, 리셋은 예산을 되돌려주는 것이다.

**"budget_limited는 실패인가?"** — 아니다. 비완료 소프트 정지다. 상태가 보존되고 새 작업만 안 나간다. 그리고 `completion-gate.md`에 따르면 **`budget_limited` 상태에서도 같은 턴에 `request-complete`가 통과할 수 있다** — 모든 게이트를 만족하면 완료가 이전 `budget_limited`를 이긴다. 실제로 흔한 시나리오다: 마지막 위임 작업이 끝나기를 기다리다 카운터가 소진됐지만, 그 결과를 수확하니 목표가 달성돼 있는 경우.

**"blocked랑 뭐가 다른가?"** — 완전히 별개 경로다. `blocked`는 **시점 판정**이다(B1: 실행 가능한 미완료 항목이 없음 / B2: 설정한 `blocked-stop` 조건 충족). 여러 턴에 걸친 기억이 없다. `budget_limited`는 반대로 **누적 판정**이다.

**"Claude에는 왜 백그라운드 감지기가 없나?"** — Claude 하네스가 `activeBackgroundTaskCount`를 직접 준다. Codex는 안 주기 때문에 sqlite를 뒤지는 것이다. 이 PR의 대칭성은 "같은 코드를 양쪽에 복사"가 아니라 **"같은 불변식을 각 플랫폼의 방식으로 만족"** 이다.

**남는 리스크** — Codex 감지기는 Codex의 **비공개 내부 스키마**(`state_5.sqlite`, `thread_spawn_edges`, rollout JSONL의 `payload.type`)에 의존한다. Codex가 이 구조를 바꾸면 감지기는 조용히 fail-open으로 떨어진다(진단은 stderr에만 남는다). 즉 파손 시 나타나는 증상은 "터짐"이 아니라 "**Codex에서 백그라운드 대기가 다시 예산을 소모하기 시작함**"이다.

---

## 6. 파일 지도

| 파일 | 변화 | 무엇 |
|---|---|---|
| `lib/persistent-mode-core/progress.ts` | **신규** 67줄 | 진전 지문 계산기 (HEAD + Story 다이제스트) |
| `lib/persistent-mode-core/state-lock.ts` | **신규** 168줄 | 공용 mkdir 상태 락 (CLI에서 이동 + 해제 경합 수정) |
| `lib/persistent-mode-core/decision.ts` | +92/−40 | pursuit 판정 재구성, 백그라운드 분기, 새 메시지 |
| `lib/persistent-mode-core/state.ts` | 락 적용 | `updateUltragoalState`를 `withStateLock`으로 감쌈 |
| `lib/persistent-mode-core/types.ts` | +3 | `last_seen_head`, `last_seen_stories_digest` |
| `hooks/persistent-mode/index.ts` | +1 | `deferredStopWakeGuaranteed: true` |
| `hooks/codex-persistent-mode/cli.ts` | +118 | 자식 감지기, rollout tail 판독, `deferredStopWakeGuaranteed: false` |
| `hooks/write-guard-core.sh` | +7/−4 | `resume-pursuit`를 사용자 전용 deny 목록에 추가 |
| `skills/ultragoal/scripts/ultragoal-state.ts` | +191/−… | `resume-pursuit`, `readGoalStateRaw`, 락 코드 제거, 지문 병합 보존 |
| `skills/design-review/scripts/job.test.ts` | +93 | 워커 종료 대기 헬퍼 (무관한 플래키 수정) |
| 테스트 6종 | 약 +1,150 | 위 동작 전부 고정 |
| 문서 9종 | 약 +40 | 새 계약을 한/영 양쪽에 반영 |

---

## 7. 퀴즈

각 문항의 답은 바로 아래 접힌 블록에 있다. 먼저 스스로 답해 보자.

---

**Q1.** ultragoal이 pursuit 중에 빈 커밋(`git commit --allow-empty`)을 10번 만들면 어떻게 되는가?

<details><summary>정답 보기</summary>

**`budget_limited`로 소프트 정지한다.** 빈 커밋은 진전이 아니다. `evaluateProgress()`는 (a) 이전 HEAD가 조상인지, (b) `git diff --quiet priorHead..head`가 exit 1(차이 있음)인지를 **둘 다** 요구한다. 빈 커밋은 (a)는 통과하지만 (b)에서 걸린다. 테스트: `empty commit does not reset counter`.
</details>

---

**Q2.** `git commit --amend`로 직전 커밋을 고쳤다. 내용 diff는 분명히 늘었는데도 진전으로 안 잡힌다. 왜인가?

<details><summary>정답 보기</summary>

amend는 **커밋을 새로 만들고 이전 커밋을 버린다.** 그래서 `last_seen_head`가 새 HEAD의 조상이 아니게 되고, `merge-base --is-ancestor` 검사에서 탈락해 diff 검사까지 가지도 못한다. rebase와 다른 브랜치로의 checkout도 같은 이유로 진전이 아니다. 테스트: `amend reads as no commit progress`, `does not count a rebased prior HEAD`, `checkout to diverged branch reports no progress`.
</details>

---

**Q3.** Story 다이제스트를 만들 때 `(id, status)` 쌍을 **정렬**하는 이유는?

<details><summary>정답 보기</summary>

Story **순서 변경(reorder)이 진전으로 오인되는 것을 막기 위해서**다. 정렬하면 배열 순서 정보가 지문에서 사라지고, 오직 어떤 id가 어떤 status를 갖는지만 남는다. 그 결과 실제 상태 전환(`unconfirmed → confirmed` 등)만 다이제스트를 바꾼다. 테스트: `digests only sorted id/status pairs`.
</details>

---

**Q4.** 진전이 **없는** Stop에서 `last_seen_head`를 새 HEAD로 갱신하지 않는 이유는? (갱신하면 어떤 버그가 생기나?)

<details><summary>정답 보기</summary>

기준선(baseline)을 **마지막으로 진전이 관측된 지점**에 고정해야 하기 때문이다. 매 Stop마다 지문을 최신으로 밀어 올리면, 여러 턴에 걸쳐 조금씩 쌓인 변화가 매번 "직전 대비 변화 없음"으로 읽혀 **누적된 전진이 영원히 진전으로 인정되지 않는다.** 그래서 무진전 경로의 `fingerprintPatch`는 **비어 있는 필드만** 채우고, 이미 값이 있는 필드는 건드리지 않는다.
</details>

---

**Q5.** Claude는 `deferredStopWakeGuaranteed: true`, Codex는 `false`를 넘긴다. 백그라운드 작업이 도는 중일 때 두 플랫폼의 동작 차이는? 그리고 **공통점**은?

<details><summary>정답 보기</summary>

- **Claude**: `continue`를 반환해 턴을 끝내도록 허용한다. 작업이 끝나면 하네스가 세션을 **반드시 다시 깨워주기** 때문에 안전한 대기다.
- **Codex**: 활성 pursuit이면 `block`하고 "기다렸다가 결과를 수확하라"는 메시지를 준다. Codex의 완료 알림은 `trigger_turn:false`로 큐잉될 뿐 **재호출 보장이 없어서**, 여기서 턴을 끝내면 결과를 영영 못 받는다.
- **공통점**: 둘 다 **`iteration`을 소모하지 않는다.** 이 검사가 진전 판정보다 위에 있기 때문이다. 대기는 정체가 아니다.
</details>

---

**Q6.** Codex 자식 감지기가 rollout 파일 tail(64KB) 안에서 `task_started` / `task_complete` / `turn_aborted` 마커를 **하나도 못 찾았다.** 파일 크기가 200KB일 때와 10KB일 때 각각 어떻게 판정하며, 왜 그렇게 나누는가?

<details><summary>정답 보기</summary>

- **200KB (> 64KB)**: **활성으로 센다.** 자식이 방금 시작해 로그를 폭발적으로 쏟아냈다면 `task_started` 마커가 64KB 창 밖으로 밀려났을 수 있다. 살아 있는 자식을 죽었다고 판정해 결과를 버리는 쪽이 더 나쁜 실패이므로 **보수적으로** 활성 처리한다.
- **10KB (≤ 64KB)**: 파일 전체를 다 봤는데도 마커가 없는 것이므로 **활성으로 세지 않는다.**

단 어느 경우든 tail 안에 실제 종료 마커(`task_complete` / `turn_aborted`)가 있으면 그게 이긴다. 테스트: `fresh oversized open rollout with no terminal marker in tail blocks without consuming`, `bounded rollout tail uses the final complete in-tail marker`.
</details>

---

**Q7.** `sqlite3` 바이너리가 설치돼 있지 않은 머신에서 Codex가 ultragoal을 돌리면 어떻게 되는가?

<details><summary>정답 보기</summary>

**아무것도 안 터진다.** 감지기가 stderr에 진단 한 줄(`codex-persistent-mode: child detector failed (sqlite3 unavailable)`)을 찍고 `0`을 반환한다 — fail-open. 자식이 0개로 계산되므로 백그라운드 분기를 타지 않고 일반 무진전 판정으로 내려간다.

**대가**: 백그라운드 대기 턴이 다시 `iteration`을 소모한다. 그래서 `sqlite3`가 이 PR에서 런타임 필수 조건으로 승격돼 `CLAUDE.md`와 두 README에 명시됐다. 테스트: `missing sqlite binary fails open with one diagnostic`.
</details>

---

**Q8.** `resume-pursuit`를 AI가 직접 실행하지 못하게 막은 방식은? 그리고 왜 SKILL.md에 "사용자 승인 후에만 실행하라"고 적는 것으로는 부족한가?

<details><summary>정답 보기</summary>

`hooks/write-guard-core.sh`의 `write_guard_core_check_user_authorized_command`에 `resume-pursuit` 패턴을 추가해, **PreToolUse 가드가 AI의 Bash 호출을 `deny`한다.** AI는 명령 전문을 사용자에게 **제시**만 하고, 사람이 자기 터미널에서 실행한다.

산문 지시로는 부족한 이유: 그건 **경계심 기반(vigilance-based)** 권한이라 AI가 문맥을 잘못 읽는 순간 무너진다. `resume-pursuit`는 pursuit을 스스로 되살려 예산 한도를 무력화할 수 있는 명령이므로, 저장소의 다른 사용자 전용 명령(`approve-review-dispatch-renewal`, `dismiss-review-finding`)과 같이 **구조적(structural)** 으로 막았다. 그래서 두 줄짜리 변경에 셸 테스트가 3개 파일 6개나 붙었고, 변수 간접 참조·순서 뒤바꿈·다중 공백 같은 우회 형태까지 검증한다.
</details>

---

**Q9.** `status` 서브커맨드만 `readGoalState` → `readGoalStateRaw`로 바꾸고 `get`은 그대로 둔 이유는?

<details><summary>정답 보기</summary>

`budget_limited`는 정의상 `active: false`인데, `readGoalState`는 `active === false`면 `null`을 반환한다. 그대로 뒀다면 `status`가 방금 예산 한도로 멈춘 pursuit을 **`absent`(상태 없음)로 출력**해서, 사용자가 "왜 멈췄지?"를 확인할 수단이 사라진다.

`get`은 "활성 상태만 다룬다"는 기존 소비자 계약이 있어서 건드리지 않았다. 테스트 `get keeps active-fold contract`가 이 비대칭을 의도적으로 고정한다.
</details>

---

**Q10.** `withStateLock`이 100회 재시도(총 약 500ms) 후에도 락을 못 잡으면 무엇을 하는가? 그리고 그 선택이 `detectActiveCodexChildren`의 fail-open과 정반대인 이유는?

<details><summary>정답 보기</summary>

**예외를 던진다** — `"ultragoal-state: state lock contended; refusing unlocked write"`. 락 없이 쓰는 폴백은 존재하지 않는다. **fail-closed**다.

방향이 반대인 이유는 **실패 시 잃는 것이 다르기** 때문이다.
- 락 없이 쓰면 **다른 프로세스의 쓰기를 통째로 덮어써 상태를 영구 손상**시킨다. 그래서 차라리 안 쓴다.
- 감지기가 못 돌면 잃는 것은 "백그라운드 대기를 예산에서 빼주는 최적화" 하나뿐이고, 나머지 판정은 정상 동작한다. 그래서 세션을 죽이지 않고 0을 반환한다.

같은 시스템 안에서도 **fail 방향은 그 실패가 무엇을 파괴하는지를 보고 정한다.**
</details>

---

**보너스.** 이 PR에서 프로덕션 코드를 한 줄도 바꾸지 않은 파일 변경이 하나 있다. 무엇이고 왜 들어왔나?

<details><summary>정답 보기</summary>

`skills/design-review/scripts/job.test.ts` (+93줄). ultragoal과 **무관한** 플래키 테스트 수정이다.

분리(detached) 워커가 `stop` 반환 후에도 `queued` 시작 창에 남아 있을 수 있어서, 곧바로 `clean`을 부르면 clean의 활성 멤버 거부 가드와 워커의 마지막 상태 기록이 경합했다. 모든 멤버가 종료 상태에 **500ms 연속** 머무는 것을 확인하고 clean 하는 `waitForStableTerminal` 헬퍼를 추가해 해결했다. "종료 상태를 한 번 봤다"가 아니라 "일정 시간 유지되는 것을 봤다"인 점이 핵심이다.
</details>

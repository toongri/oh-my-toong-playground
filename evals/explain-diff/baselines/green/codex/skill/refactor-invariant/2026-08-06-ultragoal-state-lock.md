# Ultragoal 상태 갱신 락 통합

대상 범위: `bcd493b1^..bcd493b1` (`fix: ultragoal 상태 갱신 락 통합`)

## Evidence

| 파일 | 분류 | 근거 |
|---|---|---|
| `lib/persistent-mode-core/state-lock.ts` | signal | 새 공용 상태 잠금 구현이다. |
| `lib/persistent-mode-core/state-lock.test.ts` | signal | 공용 잠금의 경합·오래된 잠금·해제 동작을 검증한다. |
| `lib/persistent-mode-core/state.ts` | signal | 기존 `updateUltragoalState` 읽기-수정-쓰기에 공용 잠금을 적용한다. |
| `lib/persistent-mode-core/state.test.ts` | signal | 상태 갱신이 경합 시 파일을 바꾸지 않는지와 필드 보존을 검증한다. |
| `skills/ultragoal/scripts/ultragoal-state.ts` | signal | 중복 잠금 구현을 제거하고 공용 잠금 및 공용 merge 경로를 사용한다. |
| `skills/ultragoal/scripts/ultragoal-state.test.ts` | signal | 복구 전이의 heartbeat 갱신을 명시적으로 검증한다. |

noise 파일은 없다. 위 여섯 파일은 모두 동작 변경 또는 그 동작의 검증을 담고 있다.

## Background

### 깊은 배경
이미 익숙하면 건너뛰세요.

상태 파일을 갱신하는 작업은 보통 `읽기 → 메모리에서 수정 → 쓰기`의 세 단계다. 두 실행자가 같은 JSON 파일을 거의 동시에 읽으면, 둘 다 오래된 내용을 바탕으로 새 파일을 만들 수 있다. 나중에 쓴 쪽이 먼저 쓴 쪽의 변경을 덮어쓰므로, 각 쓰기가 개별적으로는 정상이어도 전체 결과가 틀릴 수 있다.

이 변경에서 사용하는 잠금은 상태 파일 옆의 `<state>.lock` 디렉터리를 `mkdir`로 만들 수 있는 실행자 한 명만 임계 구역에 넣는다. 잠금에는 `owner.json`으로 소유 PID와 무작위 토큰을 기록한다. 오래된 잠금은 죽은 PID 또는 30초를 넘은 mtime으로 판별해 격리·삭제할 수 있지만, 살아 있는 소유자의 잠금은 기다린 뒤 끝까지 얻지 못하면 **잠금 없이 쓰지 않고 실패**한다.

### 좁은 배경

Ultragoal은 세션별 `ultragoal-state-<session>.json`을 쓴다. 이 파일에는 진행 상태, 스토리, heartbeat, 검토 승인 해시 등이 함께 있다. 이미 두 갱신 경로가 있었다.

- `lib/persistent-mode-core/state.ts`의 `updateUltragoalState`는 hook 계층에서 부분 갱신을 한다.
- `skills/ultragoal/scripts/ultragoal-state.ts`는 Ultragoal CLI의 상태 전이와 병합 쓰기를 수행한다.

커밋 전에는 후자에만 자체 `withStateLock` 구현이 있었고, 전자는 파일을 읽은 뒤 바로 썼다. 따라서 같은 상태 파일을 두 경로가 동시에 갱신하면 전자의 쓰기가 잠금 프로토콜 밖에 있었다. 이 커밋은 잠금을 `lib/persistent-mode-core/state-lock.ts`로 한 번만 정의하고 두 경로가 같은 프로토콜을 쓰도록 만든다.

## Intuition

핵심은 “각 작성자가 조심한다”가 아니라 **모든 작성자가 같은 문 앞을 지나게 하는 것**이다. 예를 들어 상태의 `iteration`이 `1`이고, 한 실행자는 `iteration: 2`를 쓰려 하며 다른 실행자는 스토리 `S1`을 유지한 채 heartbeat를 갱신하려 한다고 하자. 잠금이 한쪽에만 있으면 둘이 `iteration: 1, stories: [S1]`을 동시에 읽고 각자 결과를 써서 한 변경이 사라질 수 있다. 이제 두 작업 모두 `withStateLock` 안에서 읽고 쓰므로, 두 번째 작업은 첫 번째의 `iteration: 2` 결과를 읽은 뒤 자신의 병합을 적용한다.

<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:16px 0">
  <section style="border:1px solid #c33;padding:12px;border-radius:8px">
    <strong>Before — 잠금이 한 경로에만 있음</strong>
    <p><code>Hook</code>: read <code>iteration: 1</code> → write <code>iteration: 2</code></p>
    <p><code>CLI</code>: lock → read <code>iteration: 1</code> → write <code>stories: [S1]</code></p>
    <p>마지막 쓰기가 <code>iteration: 2</code>를 덮어쓸 수 있다.</p>
  </section>
  <section style="border:1px solid #278;padding:12px;border-radius:8px">
    <strong>After — 공용 <code>withStateLock</code></strong>
    <p><code>Hook</code>: lock → read <code>iteration: 1</code> → write <code>iteration: 2</code> → unlock</p>
    <p><code>CLI</code>: lock → read <code>iteration: 2</code> → write <code>stories: [S1]</code> → unlock</p>
    <p><code>iteration: 2</code>와 <code>S1</code>이 함께 남는다.</p>
  </section>
</div>

`30_000`ms보다 오래된, 소유자 정보가 없는 잠금은 죽은 작업의 흔적으로 간주해 회수한다. 반대로 살아 있는 소유자가 만든 새 잠금은 최대 `100 × 5ms` 동안만 기다리고, 그 뒤에는 `"ultragoal-state: state lock contended; refusing unlocked write"`로 멈춘다. 즉 예시의 `iteration: 2`를 지키기 위해 가용성보다 무잠금 쓰기 방지를 우선한다.

## Change Group 1: 공용 잠금의 소유권과 회수 규칙을 정의

> 예고: 두 기존 작성자가 공유할 `withStateLock`을 추가하고, 경합·오래된 잠금·소유권 교체의 경계를 고정한다.
>
> 순서: 다른 작성 경로가 동일한 규칙을 호출하려면 먼저 단 하나의 잠금 구현과 그 관찰 가능한 계약이 있어야 한다.

### `lib/persistent-mode-core/state-lock.ts`

**역할/변경 전 맥락** — 공용 잠금 모듈은 없었고, CLI 파일 안에만 별도 구현이 있었다 (`base:skills/ultragoal/scripts/ultragoal-state.ts:429`).

**무엇이 바뀌었나** — `withStateLock`을 새 모듈로 추출했다. `mkdirSync`로 `<state>.lock`을 획득하고 `owner.json`에 PID·토큰·시각을 쓴다. `EEXIST`면 오래된 잠금을 회수하거나 5ms씩 재시도하고, 100회 뒤에는 실패한다. 회수와 해제는 별도의 `.recovery` 가드로 직렬화하며, 해제 시에는 현재 토큰이 자기 토큰일 때만 디렉터리를 제거한다 (`head:lib/persistent-mode-core/state-lock.ts:24`, `head:lib/persistent-mode-core/state-lock.ts:103`, `head:lib/persistent-mode-core/state-lock.ts:151`).

**왜 필요한가** — [근거: "contention timeout fails closed; callers never fall back to an unlocked write."]

**시스템 효과** — 두 상태 작성자가 같은 실패-폐쇄 규칙을 공유하고, 오래된 잠금의 회수자가 후속 소유자의 잠금을 잘못 삭제하지 않는다.

**추적성** — `lib/persistent-mode-core/state-lock.ts:24`

### `lib/persistent-mode-core/state-lock.test.ts`

**역할/변경 전 맥락** — 공용 잠금 모듈과 전용 테스트 파일은 없었다 (`base:lib/persistent-mode-core/state-lock.test.ts:absent`).

**무엇이 바뀌었나** — 살아 있는 `owner.json`이 있으면 콜백이 실행되지 않은 채 실패하는지, mtime이 31초 지난 무소유 잠금이 회수되는지, 콜백 중 토큰이 `successor`로 바뀌면 해제가 그 잠금을 보존하는지를 검증한다 (`head:lib/persistent-mode-core/state-lock.test.ts:30`, `head:lib/persistent-mode-core/state-lock.test.ts:45`, `head:lib/persistent-mode-core/state-lock.test.ts:54`).

**왜 필요한가** — [추론: 새 모듈의 세 핵심 분기—fresh contention, stale recovery, token-checked release—가 각각 실패·회수·보존이라는 외부 결과로 고정돼야 두 호출자가 동일한 잠금 계약을 안전하게 사용할 수 있다.]

**시스템 효과** — 공용화 과정에서 “잠금 없이 진행하지 않는다”, `30_000`ms 회수, 후속 소유자 보존이 회귀 테스트로 보호된다.

**추적성** — `lib/persistent-mode-core/state-lock.test.ts:30`

## Change Group 2: Hook 계층의 갱신을 같은 임계 구역으로 이동

> 예고: Group 1의 공용 잠금을 사용해 hook의 부분 갱신도 읽기부터 쓰기까지 하나의 임계 구역에 넣는다.
>
> 순서: 이 그룹은 Group 1이 정한 `withStateLock` 계약을 전제로 하므로, 구현과 그 경계 테스트가 먼저여야 한다.

### `lib/persistent-mode-core/state.ts`

**역할/변경 전 맥락** — `updateUltragoalState`는 상태 파일을 읽어 `partial`과 heartbeat를 덮어쓴 뒤 `writeFileNoCreate`로 저장했지만, 그 읽기-수정-쓰기 전체에 잠금이 없었다 (`base:lib/persistent-mode-core/state.ts:204`).

**무엇이 바뀌었나** — `withStateLock`을 import하고, 파일 읽기·JSON 파싱·`progressPatch` 계산·`writeFileNoCreate`까지를 `withStateLock(path, ...)` 안으로 옮겼다. 비어 있거나 손상된 파일은 기존처럼 no-op이고, `ENOENT`도 기존처럼 no-op이다 (`head:lib/persistent-mode-core/state.ts:204`).

**왜 필요한가** — [근거: "a second writer for ultragoal must stay just as strict"]

**시스템 효과** — Hook이 갱신한 `iteration`, `last_touched_at`, `progress_touched_at`이 CLI의 병합 쓰기와 서로 덮어쓰지 않으며, 잠금 경합 시 무잠금 fallback이 없다.

**추적성** — `lib/persistent-mode-core/state.ts:206`

### `lib/persistent-mode-core/state.test.ts`

**역할/변경 전 맥락** — 부분 갱신은 일부 기존 필드를 보존하고 없는 파일을 만들지 않는지만 검증했다 (`base:lib/persistent-mode-core/state.test.ts:892`).

**무엇이 바뀌었나** — 기존 보존 테스트에 `stories`와 `approved_review_artifact_sha256`를 추가로 넣어 병합 뒤에도 그대로인지 확인한다. 또한 현재 프로세스가 소유한 새 `.lock`이 있으면 `updateUltragoalState(..., { iteration: 2 })`가 지정 오류를 던지고, 원본 JSON 바이트가 바뀌지 않는지 확인한다 (`head:lib/persistent-mode-core/state.test.ts:892`, `head:lib/persistent-mode-core/state.test.ts:926`).

**왜 필요한가** — [추론: 잠금 도입이 기존 spread-overlay의 비대상 필드 보존을 손상시키지 않고, fresh contention에서 실제 파일 쓰기가 전혀 일어나지 않음을 확인해야 한다.]

**시스템 효과** — 예시의 `S1`과 승인 해시가 단순 iteration 갱신으로 사라지지 않으며, 경합 중에는 JSON이 부분적으로도 바뀌지 않는다.

**추적성** — `lib/persistent-mode-core/state.test.ts:926`

## Change Group 3: CLI의 중복 잠금을 제거하고 복구 전이를 공용 병합으로 정렬

> 예고: Group 2까지 공용 잠금에 합류한 뒤, CLI의 복제 코드를 제거하고 `resume-pursuit`가 동일한 heartbeat 병합 규칙을 재사용하게 한다.
>
> 순서: 이 그룹은 Group 1의 lock helper와 Group 2가 적용한 “읽기-수정-쓰기 전체를 잠근다”는 규칙을 전제하므로 마지막에 놓인다.

### `skills/ultragoal/scripts/ultragoal-state.ts`

**역할/변경 전 맥락** — 이 CLI 파일에는 자체 `withStateLock`과 stale recovery 구현이 있었고, `resumePursuit`는 잠금 안에서 `{ ...prior, ... }`를 직접 `writeFileNoCreate`했다 (`base:skills/ultragoal/scripts/ultragoal-state.ts:429`, `base:skills/ultragoal/scripts/ultragoal-state.ts:834`).

**무엇이 바뀌었나** — 파일 내부의 잠금 구현과 전용 fs/path import를 삭제하고 `@lib/persistent-mode-core/state-lock`의 `withStateLock`을 import했다. `resumePursuit`는 유효한 `budget_limited` 상태를 확인한 뒤, 직접 쓰는 대신 잠금을 이미 쥔 `mergeWriteLocked`에 `phase: "pursuing"`, `active: true`, `iteration: 0`, `budget_limit_notified: false`만 넘긴다 (`head:skills/ultragoal/scripts/ultragoal-state.ts:58`, `head:skills/ultragoal/scripts/ultragoal-state.ts:297`, `head:skills/ultragoal/scripts/ultragoal-state.ts:697`).

**왜 필요한가** — [근거: "Caller must hold the per-session state lock."]

**시스템 효과** — CLI와 hook은 byte-for-byte 같은 잠금 구현을 쓰며, 복구 전이도 `mergeWithHeartbeat`를 거쳐 `last_touched_at`과 진행 heartbeat 갱신을 일관되게 적용한다. `resume-pursuit`의 상태 검증·no-seed 성질은 잠금 안에 남아 있다.

**추적성** — `skills/ultragoal/scripts/ultragoal-state.ts:697`

### `skills/ultragoal/scripts/ultragoal-state.test.ts`

**역할/변경 전 맥락** — `resume-pursuit` 성공 테스트는 `phase`, `active`, `iteration`, 스토리 보존을 한 테스트에서 확인했지만 stale heartbeat를 별도로 확인하지 않았다 (`base:skills/ultragoal/scripts/ultragoal-state.test.ts:1345`).

**무엇이 바뀌었나** — 상태 표시, active-fold, 복구 성공을 독립 테스트로 나누고, `last_touched_at`과 `progress_touched_at`을 `"2020-01-01T00:00:00"`으로 둔 뒤 `resumePursuit` 후 둘 다 달라지는지를 검증한다 (`head:skills/ultragoal/scripts/ultragoal-state.test.ts:1355`, `head:skills/ultragoal/scripts/ultragoal-state.test.ts:1375`).

**왜 필요한가** — [추론: 직접 JSON 쓰기에서 `mergeWriteLocked`로 바꾸면 heartbeat는 병합 경로의 동작이 되므로, 복구 전이가 그 갱신을 실제로 받는지 독립적으로 검증해야 한다.]

**시스템 효과** — 예전 시각 `2020-01-01T00:00:00`은 복구 완료 뒤 남지 않는다. 따라서 복구된 진행 상태가 liveness 판단에서 오래된 상태로 오인될 위험을 줄인다.

**추적성** — `skills/ultragoal/scripts/ultragoal-state.test.ts:1375`

## Quiz

아래 문항은 서술형 단답용 문항 뱅크다. 이 단계에서는 대화로 출제하거나 채점하지 않는다. 필수 개념은 8개이며, 20개 제한을 넘지 않아 자른 항목은 없다.

### 필수 개념 1 — Evidence 범위

**문항** — 이 커밋에서 signal로 분류된 새 공용 구현 파일과, 그 파일이 지키려는 상태 파일 잠금의 실패 정책을 함께 설명하라.

**정답 루브릭**

- `lib/persistent-mode-core/state-lock.ts`를 정확히 말한다.
- 잠금 경합이 끝까지 해소되지 않으면 무잠금 쓰기 대신 실패한다고 말한다.

### 필수 개념 2 — 깊은 배경의 경합

**문항** — 두 작성자가 상태를 동시에 갱신할 때 “읽기 → 수정 → 쓰기”가 왜 손실 갱신을 만들 수 있는지, 각자가 어떤 종류의 오래된 값을 읽는지 설명하라.

**정답 루브릭**

- 두 작성자가 같은 이전 JSON을 읽을 수 있음을 말한다.
- 나중 쓰기가 먼저 쓰인 변경을 덮어쓸 수 있음을 말한다.

### 필수 개념 3 — Intuition의 구체 값

**문항** — 문서의 예시에서 `iteration`과 스토리 식별자는 각각 무엇이며, 공용 잠금 뒤 두 번째 작성자는 어떤 `iteration` 값을 읽는가?

**정답 루브릭**

- 시작 `iteration: 1`과 갱신값 `iteration: 2`를 모두 말한다.
- 스토리 식별자 `S1`을 말한다.
- 두 번째 작성자가 `iteration: 2`를 읽는다고 말한다.

### 필수 개념 4 — 공용 잠금 경계

**문항** — `withStateLock`은 어떤 경로 이름에 잠금을 만들고, 오래된 잠금으로 판단하는 두 조건 중 하나와 재시도 수·간격을 설명하라.

**정답 루브릭**

- `<state>.lock` 디렉터리를 말한다.
- 죽은 owner PID 또는 `30_000`ms가 지난 mtime 중 하나를 말한다.
- 최대 100회, 5ms 간격을 말한다.

### 필수 개념 5 — Hook 경로

**문항** — `updateUltragoalState`에서 잠금 안으로 들어간 작업 범위와, 기존에 유지되는 `ENOENT` 동작을 설명하라.

**정답 루브릭**

- 읽기·파싱·progress patch 계산·`writeFileNoCreate`가 잠금 안에 있음을 말한다.
- `ENOENT`는 기존처럼 no-op이라고 말한다.

### 필수 개념 6 — 상태 갱신 회귀 방지

**문항** — `state.test.ts`의 lock contention 테스트는 어떤 오류 문자열을 기대하고, 어떤 파일 수준의 불변식을 검증하는가?

**정답 루브릭**

- `ultragoal-state: state lock contended; refusing unlocked write`를 정확히 말한다.
- 원본 JSON 바이트가 변경되지 않는다고 말한다.

### 필수 개념 7 — CLI 복구 전이

**문항** — `resumePursuit`가 직접 JSON을 쓰는 대신 호출하는 함수와, 넘기는 네 가지 상태 변경을 설명하라.

**정답 루브릭**

- `mergeWriteLocked`를 말한다.
- `phase: "pursuing"`과 `active: true`를 말한다.
- `iteration: 0`과 `budget_limit_notified: false`를 말한다.

### 필수 개념 8 — Heartbeat 효과

**문항** — 복구 테스트가 미리 넣는 stale timestamp 문자열과, `resumePursuit` 뒤 달라져야 하는 두 필드를 설명하라.

**정답 루브릭**

- `2020-01-01T00:00:00`을 정확히 말한다.
- `last_touched_at`을 말한다.
- `progress_touched_at`을 말한다.

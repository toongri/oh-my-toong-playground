# Ultragoal 상태 갱신 락 통합 이해하기

대상 변경: `bcd493b1^..bcd493b1` (`fix: ultragoal 상태 갱신 락 통합`)

## 한눈에 보기

이 변경은 같은 Ultragoal 세션의 상태 JSON 파일을 여러 코드 경로가 동시에 갱신할 때, 한 갱신이 다른 갱신을 덮어쓰는 문제를 막는다. 기존에 `ultragoal-state.ts` 안에만 있던 잠금 구현을 공용 모듈로 옮기고, `persistent-mode-core/state.ts`의 `updateUltragoalState`도 같은 잠금을 사용하게 했다.

또한 `resume-pursuit`가 상태를 재개할 때 일반 상태 갱신 경로를 재사용하도록 바뀌어, 재개 자체도 진행 시각(`last_touched_at`, `progress_touched_at`)을 갱신한다.

## 먼저 알아둘 용어

- **상태 파일**: 세션별 `ultragoal-state-<sessionId>.json` 파일. 목표의 단계, 반복 횟수, 스토리, 리뷰 관련 정보 등을 저장한다.
- **읽기-수정-쓰기**: 파일을 읽고, 메모리에서 일부 필드를 바꾼 뒤, 결과 전체를 다시 쓰는 갱신 방식이다.
- **잠금(lock)**: 한 시점에 한 작성자만 이 순서를 수행하도록 만드는 장치다. 이 변경에서는 상태 파일 옆의 `<상태 파일>.lock` 디렉터리가 잠금 역할을 한다.
- **fail closed(닫힌 실패)**: 잠금을 얻지 못하면 잠금 없이 쓰지 않고 오류를 내며 중단하는 정책이다.

## 왜 필요한가

상태 파일은 둘 이상의 경로에서 갱신될 수 있다. 예를 들어 `updateUltragoalState`와 `ultragoal-state.ts`의 상태 전환이 거의 동시에 실행되면, 잠금이 없는 작성자는 오래된 파일 내용을 바탕으로 결과를 쓸 수 있다.

```text
기존: 잠금이 없는 updateUltragoalState 경로

A: 파일 읽기 ── 오래된 상태 X를 메모리에 보관
B: 파일 읽기 → 리뷰 정보 추가 → 상태 X+B를 파일에 기록
A: 반복 횟수 변경 → 상태 X+A를 파일에 기록

결과: B가 추가한 리뷰 정보가 A의 마지막 쓰기로 사라질 수 있음
```

이번 변경 후에는 A 또는 B 중 먼저 잠금을 얻은 쪽이 읽기부터 쓰기까지 마친 뒤 잠금을 해제한다. 나머지 쪽은 그 뒤의 최신 파일을 읽어 갱신하므로 서로의 변경을 보존한다.

```text
변경 후: 두 경로가 같은 잠금 사용

A: 잠금 획득 → 최신 파일 읽기 → 변경 기록 → 잠금 해제
B: 잠금 획득 → A가 쓴 최신 파일 읽기 → 변경 기록 → 잠금 해제
```

## 변경 내용

| 파일 | 변경 | 의미 |
| --- | --- | --- |
| `lib/persistent-mode-core/state-lock.ts` | 새 공용 `withStateLock` 추가 | 상태 파일 갱신용 잠금의 단일 구현을 제공한다. |
| `skills/ultragoal/scripts/ultragoal-state.ts` | 내부 잠금 구현 135줄 제거, 공용 모듈 import | 기존 잠금 동작을 유지하면서 구현 중복을 없앤다. |
| `lib/persistent-mode-core/state.ts` | `updateUltragoalState`의 읽기-수정-쓰기를 `withStateLock`으로 감쌈 | 이전에 잠금 없이 동작하던 갱신 경로까지 보호한다. |
| `skills/ultragoal/scripts/ultragoal-state.ts` | `resumePursuit`가 `mergeWriteLocked` 사용 | 재개 시 기존 필드를 보존하고 두 heartbeat 시각을 갱신한다. |
| 세 테스트 파일 | 잠금 경쟁, 오래된 잠금 복구, 상태 보존, 재개 heartbeat를 검증 | 이 변경이 보장하려는 동작을 실행 가능한 규격으로 남긴다. |

## 공용 잠금은 어떻게 동작하는가

`withStateLock(stateFilePath, callback)`은 callback이 실행되는 동안만 상태 파일의 잠금을 보유한다.

1. `<stateFilePath>.lock` 디렉터리를 `mkdir`로 만든다. 디렉터리 생성은 이미 존재할 때 실패하므로, 생성에 성공한 호출자가 잠금을 얻는다.
2. 잠금 디렉터리에 `owner.json`을 쓰며 프로세스 ID, 임의 토큰, 시작 시각을 기록한다.
3. callback 안에서 파일을 읽고 수정한 뒤 쓴다.
4. 완료 여부와 관계없이 `finally`에서 잠금 해제를 시도한다.

잠금 디렉터리가 이미 있으면 최대 100회, 각 5ms 간격으로 다시 시도한다. 약 500ms 동안 얻지 못한 경우에는 `ultragoal-state: state lock contended; refusing unlocked write` 오류를 내고 callback을 실행하지 않는다. 즉, 경쟁 상황에서 데이터 손실 위험이 있는 무잠금 쓰기로 떨어지지 않는다.

### 오래된 잠금은 왜, 어떻게 회수하는가

프로세스가 비정상 종료하면 잠금 디렉터리가 남을 수 있다. 이를 영구적인 막힘으로 만들지 않기 위해 다음 중 하나면 잠금을 오래된 것으로 본다.

- `owner.json`에 기록된 소유 프로세스가 더 이상 살아 있지 않다.
- 잠금 디렉터리의 수정 시각이 30초보다 오래되었다.

회수는 `.recovery` 보조 잠금으로 한 번 더 직렬화한 뒤, 기존 잠금 디렉터리를 고유한 임시 이름으로 `rename`하고 삭제한다. 이 절차는 두 관찰자가 동시에 같은 잠금을 회수하거나, 새 소유자의 잠금을 오래된 것으로 착각해 지우는 경쟁을 줄이기 위한 것이다.

### 토큰을 확인하고 해제하는 이유

잠금을 얻을 때마다 무작위 토큰을 `owner.json`에 기록한다. 해제할 때는 파일 속 토큰이 자신이 기록한 값과 같은 경우에만 잠금 디렉터리를 지운다.

따라서 어떤 이유로든 잠금의 소유자가 바뀐 뒤 이전 소유자가 늦게 정리 코드를 실행해도, 이전 소유자는 후임 소유자의 잠금을 삭제하지 않는다. 새 테스트도 callback 중 `owner.json`을 후임 토큰으로 바꾼 뒤 그 잠금이 남아 있는지 확인한다.

## `resume-pursuit`에서 달라진 점

`resumePursuit`는 `budget_limited` 상태만 `pursuing`으로 되돌리는 사용자 전용 전환이다. 바뀌기 전에는 검증한 기존 상태를 직접 파일에 썼다. 바뀐 뒤에는 잠금을 이미 잡은 상태에서 `mergeWriteLocked`를 호출한다.

전환되는 핵심 필드는 동일하다.

- `phase`: `budget_limited` → `pursuing`
- `active`: `false` → `true`
- `iteration`: `0`
- `budget_limit_notified`: `false`

차이는 `mergeWriteLocked`가 `mergeWithHeartbeat`를 통과한다는 점이다. 따라서 위 전환과 함께 `last_touched_at`과 `progress_touched_at`도 현재 시각으로 갱신된다. 테스트는 2020년으로 고정한 두 시각이 재개 후 바뀌는지를 확인한다.

## 보장되는 것과 범위

이 커밋이 직접 보장하는 범위는 다음과 같다.

- `updateUltragoalState`와 이미 공용 잠금을 사용하던 Ultragoal 상태 작성 경로가 세션별 상태 파일에서 같은 잠금을 공유한다.
- 살아 있는 소유자의 새 잠금과 경쟁하면 callback을 실행하거나 파일을 쓰지 않고 오류로 끝난다.
- 오래된 잠금은 회수한 뒤 작업을 계속할 수 있다.
- `updateUltragoalState`의 부분 갱신은 기존의 `stories`, `approved_review_artifact_sha256` 같은 다른 필드를 그대로 보존한다.
- `resume-pursuit`는 상태 재개를 진행으로 간주해 두 heartbeat 시각을 새로 기록한다.

이 변경은 상태 JSON이 이미 손상된 경우를 복구하는 기능을 추가하지 않는다. `updateUltragoalState`는 기존처럼 JSON을 읽지 못하면 쓰지 않고 반환하며, `resumePursuit`는 유효하지 않은 상태를 거부한다.

## 테스트로 읽는 요구사항

새롭거나 확장된 테스트는 다음 행동을 고정한다.

1. **새 잠금을 누군가 보유 중일 때**: callback이 호출되지 않고, 기존 잠금과 상태 파일 바이트가 유지된다.
2. **소유자 정보가 없고 31초 지난 잠금일 때**: 잠금을 회수하고 callback을 실행할 수 있다.
3. **잠금 소유 토큰이 바뀌었을 때**: 이전 소유자의 해제가 후임 잠금을 지우지 않는다.
4. **부분 상태 갱신일 때**: 반복 횟수만 바꿔도 스토리와 승인된 리뷰 아티팩트 해시는 남는다.
5. **재개 전환일 때**: 상태 단계가 `pursuing`으로 복귀하고 두 heartbeat가 갱신된다.

## 퀴즈

### 1. 이 변경이 막으려는 가장 직접적인 문제는 무엇인가?

A. 상태 파일 크기 증가  
B. 동시에 실행된 상태 갱신이 서로의 변경을 덮어쓰는 문제  
C. 상태 파일의 JSON 형식 변환 비용  
D. 세션 ID 중복 생성

### 2. 잠금을 얻지 못한 상태 갱신은 약 500ms 후 어떻게 되는가?

A. 잠금 없이 파일을 쓴다.  
B. 다음 세션까지 무한 대기한다.  
C. callback을 실행하지 않고 오류를 낸다.  
D. 새 상태 파일을 별도로 만든다.

### 3. 잠금을 오래된 것으로 판단하는 조건을 두 가지 쓰세요.

### 4. 잠금 해제 때 토큰을 비교하지 않으면 어떤 문제가 생길 수 있는가?

### 5. `resume-pursuit`에서 새로 갱신되는 시각 필드는 무엇인가?

<details>
<summary>정답 확인</summary>

1. **B**. 읽기-수정-쓰기 사이에 다른 작성자가 쓴 변경을 마지막 작성자가 덮어쓰는 것을 막는다.
2. **C**. 오류를 내고 callback을 실행하지 않는다. 이것이 fail closed 정책이다.
3. `owner.json`의 프로세스가 죽었거나, 잠금 디렉터리의 수정 시각이 30초보다 오래된 경우다.
4. 이전 소유자가 늦게 해제하면서 이미 후임에게 넘어간 잠금을 지워, 두 작성자가 동시에 쓰는 상황이 생길 수 있다.
5. `last_touched_at`과 `progress_touched_at`이다.

</details>

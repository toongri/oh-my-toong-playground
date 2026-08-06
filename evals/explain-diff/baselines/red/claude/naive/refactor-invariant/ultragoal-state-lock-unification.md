# ultragoal 상태 갱신 락 통합 (`bcd493b1`) 해설

대상 커밋: `bcd493b1` — `fix: ultragoal 상태 갱신 락 통합`
범위: 6개 파일, +305 / −170

---

## 0. 한 줄 요약

같은 상태 파일 `ultragoal-state-<sid>.json`을 두 프로세스가 고쳐 쓰는데, **한쪽(ultragoal CLI)만 락을 잡고 다른 쪽(Stop 훅)은 맨몸으로 쓰고 있었다.** 이 커밋은 CLI 안에 갇혀 있던 락 구현을 `lib/persistent-mode-core/state-lock.ts`로 꺼내 공용 모듈로 만들고, 훅 쪽 `updateUltragoalState`도 그 락 안에서만 쓰도록 통합했다.

---

## 1. 배경: 상태 파일 하나, 쓰는 사람 둘

ultragoal(자율 다중 스토리 목표 추적 실행기)의 진행 상태는 파일 하나에 들어 있다.

```
$OMT_DIR/ultragoal-state-<sessionId>.json
```

이 파일을 쓰는 주체는 **서로 다른 두 프로세스**다.

| 쓰는 주체 | 진입점 | 언제 쓰나 | 무엇을 쓰나 |
|---|---|---|---|
| ultragoal CLI (스킬이 호출하는 커맨드) | `skills/ultragoal/scripts/ultragoal-state.ts` | 스킬이 `set`, `set-stories`, `set-verdict`, `resume-pursuit` 등을 실행할 때 | 스토리 목록, phase, 리뷰 판정, 디스패치 카운터 |
| Stop 훅 (persistent-mode) | `lib/persistent-mode-core/decision.ts` → `updateUltragoalState` (`lib/persistent-mode-core/state.ts:204`) | 턴이 끝나려 할 때마다 | `iteration`(무진전 카운터), `phase: budget_limited`, 진행 지문(`last_seen_head` 등), 하트비트 타임스탬프 |

두 경로 모두 **read-modify-write**다. 파일 전체를 읽고 → JSON으로 파싱해 일부 필드를 갈아끼우고 → 파일 전체를 다시 쓴다.

> 용어: **read-modify-write(읽고-고치고-쓰기)** — 값을 제자리에서 증가시키는 게 아니라, 통째로 읽어 메모리에서 고친 뒤 통째로 되쓰는 방식. 읽는 시점과 쓰는 시점 사이에 남이 끼어들면 그 남의 변경은 사라진다(= **lost update**, 갱신 유실).

---

## 2. 변경 전에 무엇이 깨져 있었나

변경 전 코드에서 락(`withStateLock`)은 **CLI 파일 안에만** 존재하는 파일-로컬 함수였다(옛 `ultragoal-state.ts` 내부, 이 커밋에서 삭제된 블록). CLI의 모든 쓰기는 이 락을 통과했다. 반면 훅 쪽 `updateUltragoalState`는 락 없이 그냥 읽고 썼다.

변경 전 `updateUltragoalState` 본문(요약):

```ts
const content = readFileOrNull(path);   // ① 읽기
if (!content) return;
const raw = JSON.parse(content);        // ② 파싱
writeFileNoCreate(path, JSON.stringify({ ...raw, ...partial, ... }));  // ③ 통째로 되쓰기
```

①과 ③ 사이에 CLI가 끼어들면 이렇게 된다.

```
시간 →
훅   : ①읽기(stories=[]) ────────────────────────── ③쓰기({...읽은것, iteration:4})
CLI  :          ┌ 락획득 → stories=[S1,S2,S3] 기록 → 락해제 ┘
결과 : 훅이 되쓴 스냅샷에는 stories가 없다 → CLI가 방금 확정한 스토리 3개가 통째로 증발
```

반대 방향도 똑같이 성립한다. CLI가 읽어둔 오래된 `iteration`으로 되쓰면 훅이 올린 무진전 카운터가 리셋된다. **CLI가 락을 아무리 성실히 잡아도, 반대편이 락을 안 잡으면 상호 배제는 성립하지 않는다.** 락은 참여자 전원이 지킬 때만 락이다.

---

## 3. 변경 내용 4가지

### 3-1. 락 구현을 공용 모듈로 이사 (신규 `lib/persistent-mode-core/state-lock.ts`, 157줄)

CLI 안의 파일-로컬 락 함수 7개(`withStateLock`, `readStateLockOwner`, `isStateLockStale`, `isPidAlive`, `recoverStaleStateLock`, `withStateLockRecoveryGuard`, `isolateAndRemoveStaleLock`, `releaseStateLock`)와 상수를 통째로 새 모듈로 옮기고, `withStateLock`만 `export`했다(`state-lock.ts:24`).

이사하면서 함께 바뀐 것:

- 상수 접두사 `REVIEW_LOCK_*` → `STATE_LOCK_*`. 이 락은 리뷰 디스패치 전용이 아니라 **상태 파일 전용**이므로 이름이 실제 역할과 맞아떨어지게 됐다.
- 타입 이름 `ReviewLockOwner` → `StateLockOwner`.
- 전역 `crypto.randomUUID()` → `import { randomUUID } from "node:crypto"` (`state-lock.ts:9`). OMT 스크립트는 bun과 node 양쪽에서 실행되므로, 전역 `crypto` 존재에 기대지 않고 빌트인 모듈에서 명시적으로 가져오는 편이 안전하다.
- 로직 자체는 그대로다. 포매팅(줄바꿈)만 달라졌다.

CLI 쪽(`skills/ultragoal/scripts/ultragoal-state.ts`)은 이제 한 줄로 빌려 쓴다:

```ts
import { withStateLock } from "@lib/persistent-mode-core/state-lock";
```

덕분에 CLI에서 `mkdirSync`, `renameSync`, `rmSync`, `statSync`, `writeFileSync`, `join` 임포트가 전부 필요 없어져 함께 정리됐다(남은 건 `readFileSync`, `unlinkSync`).

### 3-2. 훅 경로를 락 안으로 (`lib/persistent-mode-core/state.ts:206`)

`updateUltragoalState`의 read-modify-write 전체가 콜백으로 들어갔다.

```ts
export function updateUltragoalState(sessionId: string, partial: Partial<UltragoalState>): void {
	const path = join(getOmtDir(), `ultragoal-state-${sessionId}.json`);
	withStateLock(path, () => {
		const content = readFileOrNull(path);
		if (!content) return;
		// … 파싱 → 하트비트 패치 → writeFileNoCreate …
	});
}
```

이제 CLI와 훅이 **같은 경로의 같은 락 디렉터리**(`ultragoal-state-<sid>.json.lock`)를 두고 경쟁한다. 두 진입점의 상태 파일 경로 계산식이 동일하기 때문이다(`state.ts:205` vs `ultragoal-state.ts:233`). 이게 이 커밋의 본체다.

주의할 점: 콜백 안의 `return`은 **콜백에서만** 빠져나온다. 파일이 없거나 JSON이 깨졌을 때 조용히 넘어가는 기존 동작은 그대로 유지되고, 락 해제(`finally`)도 정상적으로 일어난다.

### 3-3. `resumePursuit`을 공용 병합 경로로 (`ultragoal-state.ts:707`)

`resume-pursuit`는 `budget_limited`(예산 소진 소프트 정지) 상태를 사용자만 되살릴 수 있는 복구 명령이다. 기존에는 검증한 `prior`를 그대로 펼쳐 직접 파일에 썼다.

```ts
// 변경 전
const next = { ...prior, phase: "pursuing", active: true, iteration: 0, budget_limit_notified: false };
writeFileNoCreate(stateFilePath, JSON.stringify(next, null, 2));

// 변경 후
mergeWriteLocked(sessionId, stateFilePath, {
	phase: "pursuing", active: true, iteration: 0, budget_limit_notified: false,
});
```

`mergeWriteLocked`는 다른 모든 쓰기 명령이 이미 쓰고 있는 공용 병합 함수다(`ultragoal-state.ts:298`). 이걸 타면 두 가지가 딸려 온다.

1. **하트비트 갱신** — `mergeWriteLocked` 끝의 `mergeWithHeartbeat`(`lib/state-core.ts:143`)가 `last_touched_at`과 `progress_touched_at`을 현재 시각으로 찍는다. 직접 쓰기 경로에는 이게 없어서, 되살린 직후의 상태가 **과거 타임스탬프를 그대로 달고** 있었다. OMT의 liveness 규칙은 "active면 idle < 6시간"으로 살아있음을 판정하므로(`lib/state-core.ts:155`), 오래 방치된 목표를 되살리면 곧바로 만료 대상으로 보일 수 있었다. 새 테스트가 정확히 이 지점을 고정한다.
2. **필드 기본값·검증 일원화** — `max_iterations`가 깨진 값이면 기본값으로 보정하는 등, 병합 함수가 들고 있는 방어 로직을 함께 상속한다.

이름의 `Locked` 접미사가 뜻하는 계약은 "**호출자가 이미 락을 쥐고 있어야 한다**"이다. `resumePursuit`는 바깥에서 `withStateLock`으로 감싸고 있으므로(`ultragoal-state.ts:699`) 계약을 만족한다. 락을 두 번 잡지 않는다 — 이 락은 재진입 불가라서 자기 자신과 교착할 뻔했다.

### 3-4. 테스트

| 파일 | 무엇이 추가/변경됐나 |
|---|---|
| `lib/persistent-mode-core/state-lock.test.ts` (신규, 3개) | ① 살아있는 소유자가 락을 쥔 상태 → 콜백을 **실행하지 않고** throw, 락은 그대로 남음 ② mtime 31초 전 = 만료 락 → 회수 후 콜백 실행, 락 제거 ③ 콜백 안에서 owner 토큰이 바뀌면 해제 시 그 후임 락을 **지우지 않음** |
| `lib/persistent-mode-core/state.test.ts` (+2) | 기존 보존 테스트에 `stories`·`approved_review_artifact_sha256`를 추가해 "부분 갱신이 모르는 필드를 날리지 않는다"를 확장. 신규: 살아있는 락이 걸린 상태에서 `updateUltragoalState`가 throw하고 **파일 바이트가 1비트도 안 바뀜**을 확인 |
| `skills/ultragoal/scripts/ultragoal-state.test.ts` | `resume-pursuit`가 stale 하트비트를 갱신하는지 검증하는 신규 테스트 + 뭉쳐 있던 테스트를 관심사별로 분할하고 제목을 실제 검증 내용에 맞게 정정 |

---

## 4. 락은 실제로 어떻게 동작하나

이 커밋이 옮긴 락의 메커니즘을 알아야 위 테스트가 읽힌다.

**획득** — `mkdirSync(lockPath)`. 디렉터리 생성은 파일시스템이 보장하는 원자적 연산이라, 동시에 둘이 시도하면 정확히 하나만 성공하고 나머지는 `EEXIST`로 실패한다. 성공한 쪽은 락 디렉터리 안에 `owner.json`을 쓴다: `{ ownerPid, token(UUID), startedAt }`.

**대기** — `EEXIST`면 최대 100회, 회당 5ms 대기 후 재시도(`state-lock.ts:12-13`). 즉 **총 약 0.5초**. 대기는 `Atomics.wait`로 스레드를 재우는 동기 슬립이다(콜백은 동기 함수라 `await`를 쓸 수 없다).

**실패는 닫는 쪽으로(fail closed)** — 100회를 다 쓰면 `throw new Error("ultragoal-state: state lock contended; refusing unlocked write")`. **락을 못 얻었을 때 "그냥 락 없이 쓰자"로 물러서지 않는다.** 이 커밋의 목적 자체가 무락 쓰기를 없애는 것이므로, 무락 폴백은 자기부정이다.

**만료 회수(stale recovery)** — 락을 쥔 프로세스가 죽어버리면 락 디렉터리가 영원히 남는다. 그래서 두 가지 만료 판정을 쓴다(`state-lock.ts:84`).
- `owner.json`의 `ownerPid`가 죽은 PID면 즉시 만료. 생존 확인은 `process.kill(pid, 0)` — 시그널 0은 실제로 아무 시그널도 보내지 않고 "보낼 수 있는가"만 검사한다. `EPERM`(권한 없음)은 **프로세스가 살아있다는 증거**이므로 살아있음으로 친다(`state-lock.ts:94`).
- 그 외에는 락 디렉터리 mtime이 30초를 넘겼으면 만료.

**회수의 회수 방지 — recovery guard** — 만료 락을 지우는 동안 또 다른 프로세스가 그 자리에 새 락을 만들면, 첫 번째 프로세스가 남의 새 락을 지워버릴 수 있다. 그래서 회수 자체를 `<lock>.recovery`라는 두 번째 mkdir 락으로 감싼다(`state-lock.ts:119`). 그리고 지울 땐 곧장 `rm`하지 않고 **먼저 유일한 이름으로 rename한 뒤 지운다**(`isolateAndRemoveStaleLock`, `state-lock.ts:140`) — rename 이후에 만들어지는 새 락은 별개 경로가 되어 안전하다.

**해제** — 자기 토큰이 `owner.json`에 그대로 있을 때만 지운다(`state-lock.ts:151`). 내 락이 이미 만료 회수당하고 후임이 들어섰다면, 그 후임의 락을 지워선 안 된다. 신규 테스트 ③이 정확히 이 시나리오다.

---

## 5. 파급 효과와 남는 리스크

**훅에서 새로 throw가 날 수 있다.** `updateUltragoalState`는 이제 경합 시 예외를 던진다. 호출부인 `decision.ts`는 이미 모든 호출을 `try/catch`로 감싸 "쓰기는 실패해도 **차단(block)은 그대로 한다**"로 처리하고 있다 — 코드에는 `// M1: swallow write failure — STILL block, never degrade to continue.`(쓰기 실패는 삼키되 차단 결정은 절대 완화하지 않는다)라는 주석으로 명시돼 있다(`decision.ts:397`, `446`, `452`, `488`). 즉 이번 변경으로 훅이 "계속 진행"으로 잘못 완화되는 경로는 생기지 않는다. 대신 경합이 잦아지면 `iteration` 증가가 유실되어 무진전 카운터가 실제보다 느리게 오를 수 있다 — 사라진 건 카운터 한 칸이지, 안전성이 아니다.

**최대 0.5초의 동기 블로킹.** 훅은 턴 종료 경로에서 돈다. 락이 잡혀 있으면 최대 0.5초 멈춘 뒤 포기한다. 상태 파일 갱신은 밀리초 단위 작업이라 정상 상황에서는 첫 시도에 붙는다.

**락은 같은 파일시스템 안에서만 유효하다.** `mkdir` 원자성에 의존하므로 NFS 같은 환경에서는 보장이 약해진다. `$OMT_DIR`는 로컬 디스크라 현재 문제되지 않는다.

**남은 축:** 이 커밋이 통합한 것은 **ultragoal 상태 파일**이다. `lib/persistent-mode-core/state.ts` 안의 다른 상태 종류(prometheus, deep-interview, goal) 갱신 함수들은 이번 범위에 포함되지 않았다.

---

## 6. 검증

작성 시점에 변경 영향 범위의 테스트를 실제로 돌린 결과다.

```
bun test lib/persistent-mode-core/state-lock.test.ts lib/persistent-mode-core/state.test.ts
  → 54 pass, 0 fail (112 expect)

bun test skills/ultragoal/scripts/ultragoal-state.test.ts
  → 206 pass, 0 fail (629 expect)
```

---

## 7. 퀴즈

풀어본 뒤 아래 정답을 확인해 보자.

**Q1.** 변경 전에도 ultragoal CLI는 모든 쓰기에서 락을 성실하게 잡고 있었다. 그런데도 상태가 유실될 수 있었던 이유는?

**Q2.** `withStateLock`은 락 획득에 100번 실패하면 예외를 던진다. 여기서 "락 없이라도 일단 쓰자"는 폴백을 넣으면 안 되는 이유를 이 커밋의 목적과 연결해 설명하라.

**Q3.** 락 획득에 `writeFileSync`나 `existsSync` + `mkdirSync` 조합이 아니라 `mkdirSync` 단독을 쓰는 이유는?

**Q4.** `isPidAlive`에서 `process.kill(pid, 0)`이 `EPERM`으로 실패했을 때 왜 `true`(살아있음)를 반환하나?

**Q5.** 만료 락을 지울 때 `rmSync`를 바로 부르지 않고 먼저 유일한 이름으로 `renameSync`한 뒤 지우는 이유는?

**Q6.** `resumePursuit`이 `writeFileNoCreate` 직접 쓰기에서 `mergeWriteLocked`로 바뀌면서 실질적으로 고쳐진 버그는 무엇인가? 그리고 왜 `mergeWrite`(락을 스스로 잡는 버전)가 아니라 `mergeWriteLocked`를 불렀나?

**Q7.** 이 커밋 이후 Stop 훅에서 락 경합 예외가 발생하면 사용자에게는 어떤 일이 벌어지나? "턴이 그냥 종료된다"가 답이 아닌 이유는?

---

### 정답

**A1.** 상호 배제는 **파일을 만지는 모든 주체**가 같은 락을 지킬 때만 성립한다. 훅 쪽 `updateUltragoalState`가 락 없이 read-modify-write를 하고 있었으므로, 훅이 읽은 시점과 되쓰는 시점 사이에 CLI가 락을 잡고 정상적으로 기록한 변경(예: 확정된 스토리 목록)이 훅의 되쓰기에 덮여 사라졌다. 락은 한쪽만 지키면 락이 아니다.

**A2.** 이 커밋의 목적이 바로 "무락 쓰기 경로를 없애는 것"이다. 폴백을 넣으면 경합이 심할 때(= 정확히 유실이 일어나는 상황) 자동으로 옛 버그 경로로 되돌아간다. 안전한 실패는 **쓰지 않고 예외를 던지는 것**이고, 실제로 호출부는 이 실패를 "쓰기는 못 했지만 차단은 유지"로 처리한다.

**A3.** `mkdir`은 파일시스템이 제공하는 원자적 생성 연산으로, 동시에 시도한 여러 프로세스 중 정확히 하나만 성공하고 나머지는 `EEXIST`를 받는다. `existsSync`로 확인한 뒤 만드는 방식은 확인과 생성 사이에 틈(TOCTOU)이 생겨 둘 다 성공했다고 믿을 수 있다.

**A4.** 시그널 0은 실제 시그널을 보내지 않고 "이 프로세스에 시그널을 보낼 수 있는가"만 검사한다. `EPERM`은 대상 프로세스가 **존재하지만 권한이 없어서** 못 보낸다는 뜻이므로 살아있다는 증거다. 죽은 프로세스라면 `ESRCH`가 온다.

**A5.** 삭제는 여러 단계에 걸쳐 일어나고, 그 사이에 다른 프로세스가 같은 경로에 새 락을 만들 수 있다. 그러면 회수 중이던 프로세스가 남의 유효한 새 락을 지워버린다. 먼저 유일한 이름(`<lock>.stale-<pid>-<uuid>`)으로 rename해 두면 원래 경로는 즉시 비고, 그 뒤에 만들어지는 새 락은 삭제 대상과 다른 경로가 되어 절대 건드려지지 않는다.

**A6.** 직접 쓰기 경로에는 하트비트 갱신이 없어서, 되살린 상태가 **오래된 `last_touched_at` / `progress_touched_at`을 그대로 유지**했다. liveness 판정이 idle 시간을 보기 때문에 방금 되살린 목표가 곧바로 만료된 것처럼 보일 수 있었다. `mergeWriteLocked`를 부른 이유는 `resumePursuit`이 이미 바깥에서 `withStateLock`을 잡고 있기 때문이다. 이 락은 재진입 불가이므로 `mergeWrite`(락을 스스로 잡는 버전)를 부르면 자기 락을 기다리다 0.5초 뒤 경합 예외로 죽는다.

**A7.** 사용자 체감은 그대로 "턴이 차단되고 작업이 계속된다"이다. `decision.ts`가 모든 `updateUltragoalState` 호출을 `try/catch`로 감싸 쓰기 실패를 삼키고 **차단 결정은 유지**하기 때문이다. 실제로 잃는 것은 `iteration` 증가분 한 칸 정도이며, 무진전 카운터가 조금 느리게 오를 뿐 "그냥 멈춤"으로 완화되지는 않는다.

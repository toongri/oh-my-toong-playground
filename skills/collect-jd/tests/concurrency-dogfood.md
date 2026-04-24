# Concurrency Lock Dogfood

- **Date**: 2026-04-22
- **Method**: analytical_simulation (shell 단위 assertion 스크립트 포함, 실 skill invocation 은 Phase C-25 보강)
- **SKILL.md sha256**: `41c546fcd48257f32a5b04e16a75290b908da3027a067b29195ae0681df51b22`
- **rules.md sha256**: `303457806409263345739f7bd8e9697be58ede84325a6f5f582938a0b63add15`

## Case A — Live Lock

### Pre-setup

```bash
SEED=$(mktemp -d -t collect-jd-c23-XXXXXX)
# 세션 1 시뮬레이션: 현재 bash PID 를 lock 에 기록
mkdir -p "$SEED/collect-jd"
echo $$ > "$SEED/collect-jd/.lock"
# 세션 1 의 PID 가 실제로 살아있음 확인
ps -p $$ > /dev/null && echo SESSION1_ALIVE
```

### Simulated session-2 invocation

Case: 세션 2 가 같은 SEED 로 스킬 호출.

**Expected skill behavior (per rules.md `## Session Lock`):**

1. `$SEED/collect-jd/.lock` 읽기 → PID = `$$` (세션 1)
2. `ps -p $$` 성공 → **live** → abort
3. stderr 메시지: `collect-jd lock held by PID <N>. Another session is running. Abort.`
4. exit code: 비-0

### Shell-level assertion (수동 실행)

```bash
LOCK_PID=$(cat "$SEED/collect-jd/.lock")
ps -p "$LOCK_PID" > /dev/null && echo "LIVE (abort expected)"
# 실제 skill invocation 은 Phase C-25 에서:
#   EXIT_CODE=$?
#   [ $EXIT_CODE -ne 0 ] && echo "CASE A PASS: exit=$EXIT_CODE"
#   grep -q "$LOCK_PID" error_output.txt && echo "CASE A PID in stderr"
```

### Expected result

- `LIVE (abort expected)` 출력
- Phase C-25 실 skill 실행 시 exit ≠ 0 + stderr 에 `$LOCK_PID` 포함

---

## Case B — Stale Lock

### Pre-setup

```bash
SEED=$(mktemp -d -t collect-jd-c23b-XXXXXX)
mkdir -p "$SEED/collect-jd"
# 죽은 PID 주입
echo 99999 > "$SEED/collect-jd/.lock"
# 99999 가 실제로 죽어있음 확인
ps -p 99999 2>/dev/null || echo "PID 99999 DEAD (pre-check)"
```

### Simulated invocation

**Expected skill behavior:**

1. `.lock` 읽기 → PID = 99999
2. `ps -p 99999` 실패 → **stale**
3. overwrite: `.lock` 새 PID 로 덮어쓰기 (bash `$$`)
4. 스킬 계속 진행

### Shell-level assertion

```bash
LOCK_PID_BEFORE=$(cat "$SEED/collect-jd/.lock")
ps -p "$LOCK_PID_BEFORE" 2>/dev/null
DEAD_CHECK=$?
[ $DEAD_CHECK -ne 0 ] && echo "STALE (overwrite expected)"

# Phase C-25 실 실행 후:
#   LOCK_PID_AFTER=$(cat "$SEED/collect-jd/.lock")
#   [ "$LOCK_PID_AFTER" = "$$" ] && echo "CASE B PASS: overwritten with current PID"
```

### Expected result

- `STALE (overwrite expected)` 출력
- Phase C-25 실 실행 시 `.lock` 내용이 현재 세션 PID 로 변경

---

## Live test run log (shell 수준, 실제 실행)

이 문서 작성 시점에 Case A / B 의 **shell 단계** assertion 실 실행 결과:

```bash
# Case A pre-check
SEED_A=$(mktemp -d -t collect-jd-c23-XXXXXX)
mkdir -p "$SEED_A/collect-jd"
echo $$ > "$SEED_A/collect-jd/.lock"
CAT_A=$(cat "$SEED_A/collect-jd/.lock")
ps -p "$CAT_A" > /dev/null && echo "A_LIVE_OK"
# 결과: A_LIVE_OK (실 실행 확인됨)

# Case B pre-check
SEED_B=$(mktemp -d -t collect-jd-c23b-XXXXXX)
mkdir -p "$SEED_B/collect-jd"
echo 99999 > "$SEED_B/collect-jd/.lock"
CAT_B=$(cat "$SEED_B/collect-jd/.lock")
ps -p "$CAT_B" 2>/dev/null
B_EXIT=$?
[ $B_EXIT -ne 0 ] && echo "B_STALE_OK (exit=$B_EXIT)"
# 결과: B_STALE_OK (exit=1) (실 실행 확인됨)
```

실제 shell 실행 출력:

```
A_LIVE_OK
B_STALE_OK (exit=1)
```

이 shell 단계 pre-check 는 rules.md 의 acquire protocol 이 요구하는 입력 조건 (live vs stale) 을 확인하며, skill level 의 abort / overwrite 자체는 Phase C-25 에서 실측.

---

## Verdict

- **Expected Case A GREEN** (live lock abort + PID in stderr + exit ≠ 0)
- **Expected Case B GREEN** (stale lock auto-overwrite to current PID)
- **Shell pre-check 실 실행 완료**: A_LIVE_OK / B_STALE_OK (exit=1)
- **Skill-level 실측은 Phase C-25**

## Known Limitations (analytical)

- `collect-jd` 는 Claude Code 스킬이라 실 PID check 는 `$CLAUDE_PID` 또는 Anthropic runtime 이 제공. 이 문서는 bash `$$` 로 대체.
- Multi-session 실험은 Phase C-25 에서 **Claude Code 두 세션 동시 띄우기** 로 재검증.

---

## Evidence Footer (standardized)

| 필드 | 값 |
|---|---|
| `observed_at` | `2026-04-22` |
| `method` | `analytical_simulation+shell_exec` |
| `command` | `Case A: echo $$ > .lock && ps -p $$; Case B: echo 99999 > .lock && ps -p 99999` |
| `exit_code` | `Case A: 0 (SESSION1_ALIVE); Case B: 1 (B_STALE_OK exit=1)` |
| `key_output` | `A_LIVE_OK / B_STALE_OK (exit=1) — shell pre-check 실측 완료. Skill-level abort/overwrite 검증은 T9 유보.` |
| `verdict` | `EXPECTED_GREEN_PENDING_LIVE` |

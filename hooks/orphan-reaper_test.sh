#!/bin/bash
# =============================================================================
# Orphan Reaper Hook Tests
#
# hooks/orphan-reaper.sh is a SessionStart hook -- the second recovery
# trigger for the 3-layer defense's layer 3 (see that file's header for the
# full rationale). This file verifies only the hook-level contract:
#   1. stdout is byte-empty on every path (cache-safe context injection).
#   2. fail-open when job.ts is absent (undeployed orchestrate-review target).
#   3. fail-open when jq is absent (existing hook convention).
#   4. the reap is detached -- the hook never waits for its `bun` child,
#      which is what keeps it inside the 10s SessionStart budget.
#   5. reap diagnostics (stderr) survive to $OMT_DIR/logs/orphan-reaper.log
#      instead of being discarded, while stdout stays byte-empty.
#   6. a bunfig.toml preload in the hook's cwd (an arbitrary, possibly
#      untrusted repo the user just opened) never executes.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

TESTS_PASSED=0
TESTS_FAILED=0

setup_test_env() {
    TEST_TMP_DIR=$(mktemp -d)
}

teardown_test_env() {
    if [[ -n "${TEST_TMP_DIR:-}" && -d "$TEST_TMP_DIR" ]]; then
        rm -rf "$TEST_TMP_DIR"
    fi
}

run_test() {
    local test_name="$1"
    setup_test_env
    if "$test_name"; then
        echo "[PASS] $test_name"
        ((TESTS_PASSED++)) || true
    else
        echo "[FAIL] $test_name"
        ((TESTS_FAILED++)) || true
    fi
    teardown_test_env
}

assert_equals() {
    local expected="$1"
    local actual="$2"
    local msg="${3:-}"
    if [[ "$expected" == "$actual" ]]; then
        return 0
    fi
    echo "ASSERTION FAILED: $msg"
    echo "  Expected: '$expected'"
    echo "  Actual:   '$actual'"
    return 1
}

# Runs the real hooks/orphan-reaper.sh against an isolated OMT_DIR so it never
# touches the real user's $OMT_DIR/jobs -- resolve_omt_dir's compute_omt_dir
# short-circuits to a pre-set OMT_DIR env var without even looking at cwd
# (hooks/lib/omt-dir.sh's compute_omt_dir, first check), so this is a hard
# isolation guarantee, not a best-effort one.
run_hook_isolated() {
    export OMT_DIR="$TEST_TMP_DIR/.omt"
    mkdir -p "$OMT_DIR"
    printf '{"cwd": "%s"}' "$TEST_TMP_DIR" | bash "$SCRIPT_DIR/orphan-reaper.sh"
}

# =============================================================================
# Test 1: stdout is byte-empty -- the hook's most important contract.
# =============================================================================
test_stdout_is_completely_empty() {
    local output
    output=$(run_hook_isolated)
    assert_equals "" "$output" "orphan-reaper.sh stdout must be byte-empty" || return 1
}

# =============================================================================
# Test 2: job.ts absent -> fail-open, exit 0, stdout still empty.
# Built against an isolated deploy-layout copy (not the real repo's job.ts,
# which must stay untouched) so the BASH_SOURCE-relative resolution
# (hooks/../skills/orchestrate-review/scripts/job.ts) genuinely misses.
# =============================================================================
test_missing_job_ts_fails_open() {
    local fake_hooks_dir="$TEST_TMP_DIR/fake-deploy/hooks"
    mkdir -p "$fake_hooks_dir"
    cp "$SCRIPT_DIR/orphan-reaper.sh" "$fake_hooks_dir/orphan-reaper.sh"
    # Deliberately no skills/orchestrate-review/scripts/job.ts under fake-deploy.

    local output status
    output=$(printf '{"cwd": "%s"}' "$TEST_TMP_DIR" | bash "$fake_hooks_dir/orphan-reaper.sh")
    status=$?

    assert_equals "" "$output" "missing job.ts: stdout must stay empty" || return 1
    assert_equals "0" "$status" "missing job.ts: hook must exit 0 (fail-open)" || return 1
}

# =============================================================================
# Test 3: jq absent -> fail-open, exit 0, stdout still empty.
# PATH narrowed to a directory carrying only `dirname` (the sole external
# binary the script needs on the job.ts-present/jq-absent path) -- no jq.
# =============================================================================
test_missing_jq_fails_open() {
    local narrow_bin="$TEST_TMP_DIR/narrow-bin"
    mkdir -p "$narrow_bin"
    ln -s "$(command -v dirname)" "$narrow_bin/dirname"
    # Invoke bash by absolute path -- a bare "bash" word would itself need to
    # resolve through the narrowed PATH below and fail to be found there.
    local bash_bin
    bash_bin=$(command -v bash)

    local output status
    output=$(printf '{"cwd": "%s"}' "$TEST_TMP_DIR" \
        | PATH="$narrow_bin" "$bash_bin" "$SCRIPT_DIR/orphan-reaper.sh")
    status=$?

    assert_equals "" "$output" "missing jq: stdout must stay empty" || return 1
    assert_equals "0" "$status" "missing jq: hook must exit 0 (fail-open)" || return 1
}

# =============================================================================
# Test 4: the reap is DETACHED -- the hook must not wait for the `bun` reap
# process it launches, which is what keeps it inside the 10s SessionStart
# budget.
#
# This test used to measure wall-clock around a run with nothing to reap and
# assert `elapsed < 3s`. That bound was invented rather than derived: on the
# empty-$OMT_DIR path it measured little more than bash+jq startup, and a
# loaded machine could cross 3s with nothing regressed -- an absolute
# threshold compared against a signal that does not scale with it.
#
# Here the delay is INJECTED, so the bound comes from the signal. A stub
# `bun` on the front of PATH sleeps SENTINEL_SECONDS; the hook backgrounds it
# (`( ... & )` in orphan-reaper.sh), so a detached hook returns immediately
# while a hook that waited could not return before SENTINEL_SECONDS. The
# comparison is against half the injected delay, so both sides stretch
# together under load and the verdict does not move.
# =============================================================================
test_reap_is_detached_from_hook() {
    local sentinel_seconds=20
    local stub_bin="$TEST_TMP_DIR/detach-bin"
    local pid_file="$TEST_TMP_DIR/stub-bun.pid"
    mkdir -p "$stub_bin"
    # Records its own pid so teardown can kill exactly this sleep, never a
    # `pkill -f sleep` sweep that could hit an unrelated process on the host.
    printf '#!/bin/sh\nprintf %%s "$$" > %s\nsleep %s\n' "$pid_file" "$sentinel_seconds" > "$stub_bin/bun"
    chmod +x "$stub_bin/bun"

    local start end elapsed
    start=$(date +%s)
    ( export PATH="$stub_bin:$PATH"; run_hook_isolated > /dev/null )
    end=$(date +%s)
    elapsed=$((end - start))

    # The stub is detached, so its pid file may land just after the hook
    # returns. Bounded poll, then kill whatever it recorded; a miss here must
    # not fail the test, only leave the sleep to expire on its own.
    local waited=0
    while [[ ! -s "$pid_file" && "$waited" -lt 50 ]]; do
        sleep 0.1
        waited=$((waited + 1))
    done
    if [[ -s "$pid_file" ]]; then
        kill "$(cat "$pid_file")" 2>/dev/null || true
    fi

    if [[ "$elapsed" -ge $((sentinel_seconds / 2)) ]]; then
        echo "ASSERTION FAILED: orphan-reaper.sh took ${elapsed}s while its reap child slept ${sentinel_seconds}s -- the hook waited for the child instead of detaching it"
        return 1
    fi
    return 0
}

# =============================================================================
# Test 5: reap diagnostics survive to a log file instead of /dev/null.
#
# Fixture: a "chunk-review-*" job dir whose job.json records a workerPgid
# that is genuinely alive AND carries a matching workerPgidStartedAt witness
# (captured live via `ps -o lstart=` on that same PGID, right before writing
# job.json -- never hardcoded, or judgePgidSignal would return "mismatch" and
# skip the reap; see lib/generic-job.ts's judgePgidSignal/getPgidLeaderStartTimes),
# with an empty members/ dir (no status.json -> findActiveMembers sees no live
# progress) -- exactly findOrphanJobs' orphan predicate (lib/generic-job.ts).
# The live PGID is a detached `sleep` started
# from a `set -m` subshell with its own stdout/stderr redirected to
# /dev/null *before* backgrounding: verified by hand with `ps -o
# pid,pgid,ppid` on this host that (a) this makes the child its own
# process-group leader (pgid == its own pid, distinct from this test
# script's own pgid), so the SIGTERM/SIGKILL -pgid reapOrphanJobs sends can
# only ever reach that one sleep, never this test's own shell, and (b) the
# command substitution below returns immediately instead of blocking for the
# fixture's full lifetime. The latter is not cosmetic: a naive `bash -c
# 'set -m; sleep 30 & echo $!'` backgrounds sleep while it still inherits the
# command substitution's own stdout pipe, so `$( )` blocks until sleep exits
# 30s later -- by the time the assignment returns, the fixture is already
# dead, and every assertion below would pass vacuously against nothing.
#
# No --grace-ms is passed to the hook's reap invocation (matches production),
# so reapOrphanJobs' default 5s SIGTERM->grace->SIGKILL cycle runs before the
# stderr diagnostic is written -- poll for the log file's content instead of
# asserting immediately after the (fully detached) hook call returns.
# =============================================================================
test_reap_diagnostics_preserved_in_log() {
    local omt_dir="$TEST_TMP_DIR/.omt"
    local jobs_dir="$omt_dir/jobs"
    local job_dir="$jobs_dir/chunk-review-orphan-test"
    mkdir -p "$job_dir/members"

    local fixture_pgid
    fixture_pgid=$(
        set -m
        sleep 30 >/dev/null 2>&1 &
        echo "$!"
    )

    # The fixture must be genuinely alive before the hook ever runs -- without
    # this, a dead-on-arrival fixture is indistinguishable from "there was
    # never anything to reap", and every assertion below would be vacuous.
    if ! kill -0 "$fixture_pgid" 2>/dev/null; then
        echo "ASSERTION FAILED: fixture pid $fixture_pgid was not alive right after being started"
        return 1
    fi

    # PGID identity witness (lib/generic-job.ts's judgePgidSignal): a live PGID
    # number alone is not enough signal to reap -- it must also carry the
    # leader process's own spawn-time start time, matching what spawnWorkers
    # records in production (getProcessStartedAt: `ps -o lstart=`, trimmed).
    # Captured here from the fixture's OWN live process, same as
    # lib/generic-job.test.ts's setupOrphanJob/getLstart helper does -- never
    # a hardcoded string, or judgePgidSignal would return "mismatch" and skip
    # the reap.
    local fixture_started_at
    fixture_started_at=$(ps -o lstart= -p "$fixture_pgid" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')

    cat > "$job_dir/job.json" <<EOF
{"id": "chunk-review-orphan-test", "members": [{"name": "w0", "workerPgid": $fixture_pgid, "workerPgidStartedAt": "$fixture_started_at"}]}
EOF

    local output
    output=$(run_hook_isolated)

    if ! assert_equals "" "$output" "reap-log test: stdout must stay empty even while an orphan is reaped"; then
        kill -9 -"$fixture_pgid" 2>/dev/null || true
        return 1
    fi

    local log_file="$omt_dir/logs/orphan-reaper.log"
    # Ceiling derived from a measured control, not invented: the reap runs
    # detached, and its dominant cost is one bun startup. Timing a bun startup
    # right here prices that on THIS machine under THIS load, so a loaded
    # machine that slows the detached reap slows the control the same way and
    # the window stretches with it. Ten of those, with a 20s floor so a
    # sub-second control still leaves the window this test has always had.
    local ctl_start ctl_end ctl_seconds
    printf 'process.exit(0);\n' > "$TEST_TMP_DIR/reaplog-control.ts"
    ctl_start=$(date +%s)
    bun "$TEST_TMP_DIR/reaplog-control.ts" > /dev/null 2>&1 || true
    ctl_end=$(date +%s)
    ctl_seconds=$((ctl_end - ctl_start))
    local max_wait=$(( (ctl_seconds + 1) * 10 ))
    [[ "$max_wait" -lt 20 ]] && max_wait=20
    local waited=0
    while [[ ! -s "$log_file" && "$waited" -lt "$max_wait" ]]; do
        sleep 1
        waited=$((waited + 1))
    done

    # Log content must be asserted BEFORE cleanup kills the fixture below --
    # otherwise a failure here would be masked by cleanup succeeding.
    local log_failure=0
    if [[ ! -s "$log_file" ]]; then
        echo "ASSERTION FAILED: '$log_file' has no content after waiting ${waited}s (reap diagnostics were not preserved)"
        log_failure=1
    elif ! grep -qF "reaped orphan job" "$log_file"; then
        # job.ts reap's other message on this path ("no orphan jobs found",
        # skills/orchestrate-review/scripts/job.ts) also leaves the log
        # non-empty while meaning the opposite of what this test claims, so a
        # bare non-empty check is not enough.
        echo "ASSERTION FAILED: '$log_file' does not contain 'reaped orphan job' -- got:"
        cat "$log_file"
        log_failure=1
    fi

    # Safety net: reapOrphanJobs should already have SIGKILLed this fixture's
    # process group -- a no-op unless reap failed for an unrelated reason.
    kill -9 -"$fixture_pgid" 2>/dev/null || true

    [[ "$log_failure" -eq 0 ]]
}

# =============================================================================
# Test 6: cwd 고정 -- 훅 프로세스 자신의 실제 cwd(SessionStart가 물려주는
# 세션 cwd, 즉 사용자가 방금 열었을 수 있는 임의의 신뢰하지 않는 레포)에
# 놓인 bunfig.toml의 preload가 실행되면 안 된다 (파일 헤더의 "cwd 고정
# (bunfig.toml preload 취약점)" 문단 참조).
#
# JSON 입력의 .cwd 필드만으로는 이 취약점을 재현하지 못한다 -- 그 필드는
# resolve_omt_dir의 입력일 뿐, 훅 프로세스 자신의 실제 process cwd와는
# 무관하다(다른 테스트들이 쓰는 run_hook_isolated는 훅을 호출하는 셸의
# cwd를 바꾸지 않는다). 실제 취약점은 훅을 실행하는 프로세스 자신의 cwd에
# 달려 있으므로, 이 테스트는 `cd "$TEST_TMP_DIR" &&`로 그 셸 자체를
# 픽스처 디렉터리로 옮긴 뒤 훅을 호출한다 -- SessionStart가 세션 cwd에서
# 훅을 실행하는 것과 동일한 조건이다.
#
# 픽스처는 preload가 실제로 실행 "가능한" 상황을 만든다: 훅 프로세스의
# cwd(=$TEST_TMP_DIR)에 정확히 bunfig.toml과 그 preload 대상 스크립트를
# 둔다. preload가 실행되면 마커 파일이 생기므로, 이 픽스처 자체가
# 무력하지 않다는 것도 이 테스트 하나로 증명된다 -- 고정이 없었다면(cd
# 없이 bare `bun "$JOB_TS" ...`였다면) 마커가 생겼을 것이고, 고정이
# 있으면(현재 코드) 생기지 않는다. 마커는 stderr 대신 파일로 남긴다 --
# 훅이 stderr를 로그 파일로 리다이렉트하므로 로그를 파싱하는 것보다 파일
# 존재 여부가 더 단단한 판정이다.
# =============================================================================
test_bunfig_preload_in_cwd_does_not_execute() {
    local marker="$TEST_TMP_DIR/PWNED-PRELOAD-RAN"

    cat > "$TEST_TMP_DIR/pwn.ts" <<EOF
import { writeFileSync } from "fs";
writeFileSync("$marker", "pwned");
EOF

    # POSITIVE CONTROL, run first and in the FOREGROUND: prove this fixture can
    # actually fire on this machine before trusting an absence result from it.
    # Without this the test passes for two indistinguishable reasons -- the cwd
    # pinning worked, or the fixture was inert (a bun that ignores bunfig, a
    # preload path that never resolves) and nothing would have appeared either
    # way. `bun <script>` from that cwd is the same trigger the unpinned hook
    # would have hit; `bun --version` is NOT (measured: it does not read
    # bunfig's preload), so the control has to run a real script.
    local control_marker="$TEST_TMP_DIR/CONTROL-PRELOAD-RAN"
    cat > "$TEST_TMP_DIR/control-pwn.ts" <<EOF
import { writeFileSync } from "fs";
writeFileSync("$control_marker", "control");
EOF
    cat > "$TEST_TMP_DIR/control-noop.ts" <<'EOF'
process.exit(0);
EOF
    cat > "$TEST_TMP_DIR/bunfig.toml" <<EOF
preload = ["$TEST_TMP_DIR/control-pwn.ts"]
EOF
    local control_start control_end control_seconds
    control_start=$(date +%s)
    (cd "$TEST_TMP_DIR" && bun "$TEST_TMP_DIR/control-noop.ts") > /dev/null 2>&1 || true
    control_end=$(date +%s)
    control_seconds=$((control_end - control_start))

    if [[ ! -f "$control_marker" ]]; then
        echo "ASSERTION FAILED: positive control never fired -- a bunfig.toml preload in bun's own cwd did not run, so this fixture cannot prove anything about the hook and an absence result below would be vacuous"
        return 1
    fi

    # Now the real subject, with the preload pointed back at the hook's marker.
    cat > "$TEST_TMP_DIR/bunfig.toml" <<EOF
preload = ["$TEST_TMP_DIR/pwn.ts"]
EOF

    export OMT_DIR="$TEST_TMP_DIR/.omt"
    mkdir -p "$OMT_DIR"
    (cd "$TEST_TMP_DIR" && printf '{"cwd": "%s"}' "$TEST_TMP_DIR" | bash "$SCRIPT_DIR/orphan-reaper.sh") > /dev/null

    # preload runs at bun startup, before any entrypoint code runs -- if it
    # were going to run at all, it already has by the time bun finishes
    # loading. The hook detaches the whole reap call to the background (see
    # test_reap_is_detached_from_hook above), so the marker cannot be asserted
    # absent immediately; there is no `timeout` binary on this host, so bound
    # the wait with a polling loop.
    #
    # The ceiling is derived from the control above rather than invented: the
    # control just measured what one bun startup costs on this machine under
    # this load, and the ceiling is ten of those (floor 5s so a sub-second
    # control still yields a usable window). A loaded machine that slows the
    # detached bun slows the control the same way, so the window stretches
    # with it instead of expiring early and passing vacuously.
    local max_wait=$(( (control_seconds + 1) * 10 ))
    [[ "$max_wait" -lt 5 ]] && max_wait=5
    local waited=0
    while [[ ! -f "$marker" && "$waited" -lt "$max_wait" ]]; do
        sleep 1
        waited=$((waited + 1))
    done

    if [[ -f "$marker" ]]; then
        echo "ASSERTION FAILED: '$marker' exists -- bunfig.toml preload in the hook's cwd ran before job.ts, meaning an untrusted repo's preload executed with the user's privileges"
        return 1
    fi
    return 0
}

main() {
    echo "=========================================="
    echo "Orphan Reaper Hook Tests"
    echo "=========================================="

    run_test test_stdout_is_completely_empty
    run_test test_missing_job_ts_fails_open
    run_test test_missing_jq_fails_open
    run_test test_reap_is_detached_from_hook
    run_test test_reap_diagnostics_preserved_in_log
    run_test test_bunfig_preload_in_cwd_does_not_execute

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
}

main "$@"

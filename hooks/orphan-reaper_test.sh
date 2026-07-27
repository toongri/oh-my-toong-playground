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
#   4. returns well inside the 10s SessionStart budget (reap fully detaches).
#   5. reap diagnostics (stderr) survive to $OMT_DIR/logs/orphan-reaper.log
#      instead of being discarded, while stdout stays byte-empty.
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
# Test 4: returns well inside the 10s SessionStart budget. No `timeout`
# binary on this host -- measure wall-clock via `date +%s` around the call
# instead of shelling out to a nonexistent `timeout` command.
# =============================================================================
test_returns_within_budget() {
    local start end elapsed
    start=$(date +%s)
    run_hook_isolated > /dev/null
    end=$(date +%s)
    elapsed=$((end - start))

    if [[ "$elapsed" -ge 3 ]]; then
        echo "ASSERTION FAILED: orphan-reaper.sh took ${elapsed}s to return (budget: 10s, expected near-instant since reap fully detaches)"
        return 1
    fi
    return 0
}

# =============================================================================
# Test 5: reap diagnostics survive to a log file instead of /dev/null.
#
# Fixture: a "chunk-review-*" job dir whose job.json records a workerPgid
# that is genuinely alive, with an empty members/ dir (no status.json ->
# findActiveMembers sees no live progress) -- exactly findOrphanJobs' orphan
# predicate (lib/generic-job.ts). The live PGID is a detached `sleep`
# backgrounded under bash job-control monitor mode (`set -m`): verified by
# hand that this makes the child its own process-group leader (pgid == its
# own pid, distinct from this test's pgid), so the SIGTERM/SIGKILL -pgid
# reapOrphanJobs sends can only ever reach that one sleep, never this test's
# own shell.
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
    fixture_pgid=$(bash -c 'set -m; sleep 30 & echo $!')

    cat > "$job_dir/job.json" <<EOF
{"id": "chunk-review-orphan-test", "members": [{"name": "w0", "workerPgid": $fixture_pgid}]}
EOF

    local output
    output=$(run_hook_isolated)

    if ! assert_equals "" "$output" "reap-log test: stdout must stay empty even while an orphan is reaped"; then
        kill -9 -"$fixture_pgid" 2>/dev/null || true
        return 1
    fi

    local log_file="$omt_dir/logs/orphan-reaper.log"
    local waited=0
    local max_wait=20
    while [[ ! -s "$log_file" && "$waited" -lt "$max_wait" ]]; do
        sleep 1
        waited=$((waited + 1))
    done

    # Safety net: reapOrphanJobs should already have SIGKILLed this fixture's
    # process group -- a no-op unless reap failed for an unrelated reason.
    kill -9 -"$fixture_pgid" 2>/dev/null || true

    if [[ ! -s "$log_file" ]]; then
        echo "ASSERTION FAILED: '$log_file' has no content after waiting ${waited}s (reap diagnostics were not preserved)"
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
    run_test test_returns_within_budget
    run_test test_reap_diagnostics_preserved_in_log

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
}

main "$@"

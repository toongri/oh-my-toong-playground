#!/bin/bash
# Tests for the Claude review execution gate. Each invocation uses an isolated
# OMT_DIR so no ambient review job or session identity can influence the result.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$SCRIPT_DIR/review-exec-guard.sh"
TESTS_PASSED=0
TESTS_FAILED=0

run_test() {
    local name="$1"
    if "$name"; then
        echo "[PASS] $name"
        ((TESTS_PASSED++)) || true
    else
        echo "[FAIL] $name"
        ((TESTS_FAILED++)) || true
    fi
}

new_sandbox() {
    SBX=$(mktemp -d)
    JOBS="$SBX/omt/jobs"
    mkdir -p "$JOBS"
}

cleanup_sandbox() {
    rm -rf "$SBX"
}

payload() {
    local command="$1" sid="${2:-reviewer}"
    jq -n --arg command "$command" --arg sid "$sid" \
        '{tool_name:"Bash",tool_input:{command:$command},session_id:$sid,cwd:"/safe/project"}'
}

run_hook() {
    local command="$1" sid="${2:-reviewer}"
    payload "$command" "$sid" | env -u CODEX_THREAD_ID OMT_DIR="$SBX/omt" OMT_SESSION_ID="$sid" bash "$HOOK"
}

assert_denied() {
    local out="$1" label="$2"
    if ! printf '%s' "$out" | grep -q '"continue":false'; then
        echo "ASSERTION FAILED $label: expected Claude command denial, got '$out'"
        return 1
    fi
    if ! printf '%s' "$out" | grep -Eqi 'static-only|static inspection'; then
        echo "ASSERTION FAILED $label: denial must direct static inspection, got '$out'"
        return 1
    fi
}

assert_allowed() {
    local out="$1" rc="$2" label="$3"
    if [ "$rc" -ne 0 ] || [ -n "$out" ]; then
        echo "ASSERTION FAILED $label: expected fail-open allow, rc=$rc output='$out'"
        return 1
    fi
}

test_member_denies_representative_high_cost_commands() {
    new_sandbox
    local command out result=0
    for command in 'pnpm test' 'npm run build' 'yarn install' 'bun run lint' 'pytest' 'vitest run' 'tsc --noEmit'; do
        out=$(payload "$command" | env -u OMT_SESSION_ID -u CODEX_THREAD_ID OMT_DIR="$SBX/omt" OMT_REVIEW_ROLE=member bash "$HOOK")
        assert_denied "$out" "member-$command" || result=1
    done
    cleanup_sandbox
    return "$result"
}

test_matching_conductor_denies_even_done_status() {
    new_sandbox
    mkdir -p "$JOBS/chunk-review-one"
    printf '%s\n' '{"conductorSessionId":"conductor","status":"done"}' > "$JOBS/chunk-review-one/job.json"
    printf '%s\n' '{"status":"done"}' > "$JOBS/chunk-review-one/status.json"
    local out result=0
    out=$(run_hook 'pnpm test' conductor)
    assert_denied "$out" conductor-done || result=1
    cleanup_sandbox
    return "$result"
}

test_other_session_and_removed_job_allow() {
    new_sandbox
    mkdir -p "$JOBS/chunk-review-one"
    printf '%s\n' '{"conductorSessionId":"conductor"}' > "$JOBS/chunk-review-one/job.json"
    local out rc=0 result=0
    out=$(run_hook 'pnpm test' another) || rc=$?
    assert_allowed "$out" "$rc" other-session || result=1
    rm -rf "$JOBS/chunk-review-one"
    rc=0
    out=$(run_hook 'pnpm test' conductor) || rc=$?
    assert_allowed "$out" "$rc" removed-job || result=1
    cleanup_sandbox
    return "$result"
}

test_no_marker_malformed_unsafe_mismatch_and_no_jq_fail_open() {
    new_sandbox
    local out rc=0 result=0
    out=$(run_hook 'pnpm test') || rc=$?
    assert_allowed "$out" "$rc" no-marker || result=1
    mkdir -p "$JOBS/chunk-review-malformed"
    printf '%s\n' '{not json' > "$JOBS/chunk-review-malformed/job.json"
    rc=0; out=$(run_hook 'pnpm test') || rc=$?
    assert_allowed "$out" "$rc" malformed-job || result=1
    rm -rf "$JOBS/chunk-review-malformed"
    mkdir -p "$JOBS/chunk-review-unsafe"
    printf '%s\n' '{"conductorSessionId":"unsafe/session"}' > "$JOBS/chunk-review-unsafe/job.json"
    rc=0; out=$(run_hook 'pnpm test' 'unsafe/session') || rc=$?
    assert_allowed "$out" "$rc" unsafe-session || result=1
    rc=0; out=$(payload 'pnpm test' conductor | env OMT_DIR="$SBX/omt" OMT_SESSION_ID=conductor CODEX_THREAD_ID=other bash "$HOOK") || rc=$?
    assert_allowed "$out" "$rc" identity-mismatch || result=1
    mkdir -p "$SBX/no-bin"
    ln -s /usr/bin/dirname "$SBX/no-bin/dirname"
    rc=0; out=$(payload 'pnpm test' | env -u OMT_SESSION_ID -u CODEX_THREAD_ID OMT_DIR="$SBX/omt" OMT_REVIEW_ROLE=member PATH="$SBX/no-bin" /bin/bash "$HOOK") || rc=$?
    assert_allowed "$out" "$rc" jq-unavailable || result=1
    cleanup_sandbox
    return "$result"
}

test_static_and_orchestration_commands_allow() {
    new_sandbox
    local command out rc result=0
    for command in 'git diff' 'rg conductorSessionId hooks' 'grep -R review hooks' 'cat hooks/lib/omt-dir.sh' 'bun skills/orchestrate-review/job.ts collect'; do
        rc=0; out=$(payload "$command" | env -u OMT_SESSION_ID -u CODEX_THREAD_ID OMT_DIR="$SBX/omt" OMT_REVIEW_ROLE=member bash "$HOOK") || rc=$?
        assert_allowed "$out" "$rc" "allowed-$command" || result=1
    done
    cleanup_sandbox
    return "$result"
}

test_chained_and_quoted_runners_cannot_bypass() {
    new_sandbox
    local command out result=0
    for command in 'git diff && pnpm test' 'echo inspect; npm run lint' "'pnpm' test" '"yarn" build'; do
        out=$(payload "$command" | env -u OMT_SESSION_ID -u CODEX_THREAD_ID OMT_DIR="$SBX/omt" OMT_REVIEW_ROLE=member bash "$HOOK")
        assert_denied "$out" "bypass-$command" || result=1
    done
    cleanup_sandbox
    return "$result"
}

main() {
    run_test test_member_denies_representative_high_cost_commands
    run_test test_matching_conductor_denies_even_done_status
    run_test test_other_session_and_removed_job_allow
    run_test test_no_marker_malformed_unsafe_mismatch_and_no_jq_fail_open
    run_test test_static_and_orchestration_commands_allow
    run_test test_chained_and_quoted_runners_cannot_bypass
    echo "Passed: $TESTS_PASSED, Failed: $TESTS_FAILED"
    [ "$TESTS_FAILED" -eq 0 ]
}

main "$@"

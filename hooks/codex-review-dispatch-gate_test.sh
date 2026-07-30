#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$SCRIPT_DIR/codex-review-dispatch-gate.sh"
TESTS_PASSED=0
TESTS_FAILED=0
TEST_TMP_DIR=""

setup_test_env() {
    TEST_TMP_DIR=$(mktemp -d)
    export OMT_DIR="$TEST_TMP_DIR/.omt"
    export OMT_SESSION_ID="codex-review-test"
    unset CODEX_THREAD_ID
    mkdir -p "$OMT_DIR"
}

teardown_test_env() {
    unset OMT_DIR OMT_SESSION_ID CODEX_THREAD_ID || true
    rm -rf "$TEST_TMP_DIR"
}

run_test() {
    local name="$1"
    setup_test_env
    if "$name"; then
        echo "[PASS] $name"
        ((TESTS_PASSED++)) || true
    else
        echo "[FAIL] $name"
        ((TESTS_FAILED++)) || true
    fi
    teardown_test_env
}

seed_pursuing() {
    printf '%s' '{"active":true,"phase":"pursuing","iteration":0,"max_iterations":10,"started_at":"2026-01-01T00:00:00","last_touched_at":"2026-01-01T00:00:00"}' > "$OMT_DIR/ultragoal-state-$OMT_SESSION_ID.json"
}

payload() {
    jq -n --arg tool "$1" --arg agent "$2" '{tool_name:$tool,tool_input:{agent_type:$agent}}'
}

payload_with_session() {
    jq -n --arg tool "$1" --arg agent "$2" --arg session_id "$3" '{tool_name:$tool,tool_input:{agent_type:$agent},session_id:$session_id}'
}

run_hook() {
    bash "$HOOK"
}

assert_allow() {
    local out="$1" rc="$2" label="$3"
    if [ "$rc" -ne 0 ] || [ -n "$out" ]; then
        echo "ASSERTION FAILED $label: expected silent allow (rc=$rc, out='$out')"
        return 1
    fi
}

assert_deny() {
    local out="$1" rc="$2" label="$3"
    if [ "$rc" -ne 0 ] || ! printf '%s' "$out" | jq -e '.hookSpecificOutput.hookEventName == "PreToolUse" and .hookSpecificOutput.permissionDecision == "deny"' > /dev/null; then
        echo "ASSERTION FAILED $label: expected deny envelope (rc=$rc, out='$out')"
        return 1
    fi
}

test_allowed_mixed_case_namespaced_claim_increments() {
    local out rc=0
    seed_pursuing
    out=$(payload "CollaborationSpawn_Agent" "code-reviewer" | run_hook) || rc=$?
    assert_allow "$out" "$rc" "mixed-case namespaced candidate" || return 1
    [ "$(jq -r '.review_dispatch_used' "$OMT_DIR/ultragoal-state-$OMT_SESSION_ID.json")" = "1" ]
}

test_sixth_denied_without_increment() {
    local i out rc=0
    seed_pursuing
    for i in 1 2 3 4 5; do payload "collaborationspawn_agent" "code-reviewer" | run_hook > /dev/null; done
    out=$(payload "collaborationspawn_agent" "code-reviewer" | run_hook) || rc=$?
    assert_deny "$out" "$rc" "sixth claim" || return 1
    printf '%s' "$out" | grep -q 'approve-review-dispatch-renewal' || return 1
    [ "$(jq -r '.review_dispatch_used' "$OMT_DIR/ultragoal-state-$OMT_SESSION_ID.json")" = "5" ]
}

test_completion_eligible_denied() {
    local out rc=0
    seed_pursuing
    printf '%s' '{"status":"COMPLETE","findings":[],"reviewer":"r","at":"now"}' > "$OMT_DIR/ultragoal-codereview-$OMT_SESSION_ID.json"
    out=$(payload "collaborationspawn_agent" "code-reviewer" | run_hook) || rc=$?
    assert_deny "$out" "$rc" "completion eligible" || return 1
    printf '%s' "$out" | grep -q 'request-complete'
}

test_planning_nonreviewer_and_nontool_pass() {
    local out rc=0
    seed_pursuing
    jq '.phase="planning"' "$OMT_DIR/ultragoal-state-$OMT_SESSION_ID.json" > "$OMT_DIR/state.tmp"
    mv "$OMT_DIR/state.tmp" "$OMT_DIR/ultragoal-state-$OMT_SESSION_ID.json"
    out=$(payload "collaborationspawn_agent" "code-reviewer" | run_hook) || rc=$?
    assert_allow "$out" "$rc" "planning" || return 1
    out=$(payload "collaborationspawn_agent" "sisyphus-junior" | run_hook) || rc=$?
    assert_allow "$out" "$rc" "nonreviewer" || return 1
    out=$(payload "functions.exec_command" "code-reviewer" | run_hook) || rc=$?
    assert_allow "$out" "$rc" "nontool" || return 1
    [ "$(jq -r '.review_dispatch_used // 0' "$OMT_DIR/ultragoal-state-$OMT_SESSION_ID.json")" = "0" ]
}

test_malformed_state_denies_safely() {
    local out rc=0
    seed_pursuing
    printf '%s' '{broken' > "$OMT_DIR/ultragoal-state-$OMT_SESSION_ID.json"
    out=$(payload "collaborationspawn_agent" "code-reviewer" | run_hook) || rc=$?
    assert_deny "$out" "$rc" "malformed state"
}

test_schema_valid_malformed_states_fail_closed_or_pass_known_inactive() {
    local out rc=0 state_file
    state_file="$OMT_DIR/ultragoal-state-$OMT_SESSION_ID.json"

    printf '%s' '{"active":true,"phase":"pursuit","iteration":0,"max_iterations":10}' > "$state_file"
    out=$(payload "collaborationspawn_agent" "code-reviewer" | run_hook) || rc=$?
    assert_deny "$out" "$rc" "invalid phase" || return 1
    [ "$(jq -r '.review_dispatch_used // 0' "$state_file")" = "0" ] || return 1

    rc=0
    printf '%s' '{"active":true,"phase":"pursuing","iteration":"bad","max_iterations":10}' > "$state_file"
    out=$(payload "collaborationspawn_agent" "code-reviewer" | run_hook) || rc=$?
    assert_deny "$out" "$rc" "invalid pursuing iteration" || return 1
    [ "$(jq -r '.review_dispatch_used // 0' "$state_file")" = "0" ] || return 1

    rc=0
    printf '%s' '{"active":true,"phase":"planning","iteration":"bad","max_iterations":10}' > "$state_file"
    out=$(payload "collaborationspawn_agent" "code-reviewer" | run_hook) || rc=$?
    assert_allow "$out" "$rc" "planning with unrelated corruption" || return 1
    [ "$(jq -r '.review_dispatch_used // 0' "$state_file")" = "0" ] || return 1

    rc=0
    printf '%s' '{"active":false,"phase":"pursuing","iteration":"bad","max_iterations":10}' > "$state_file"
    out=$(payload "collaborationspawn_agent" "code-reviewer" | run_hook) || rc=$?
    assert_allow "$out" "$rc" "inactive with unrelated corruption" || return 1
    [ "$(jq -r '.review_dispatch_used // 0' "$state_file")" = "0" ]
}

test_codex_thread_id_scrubs_stale_omt_session_id() {
    local current_sid="codex-current-session" foreign_sid="claude-foreign-session" current_state foreign_state out rc=0
    current_state="$OMT_DIR/ultragoal-state-$current_sid.json"
    foreign_state="$OMT_DIR/ultragoal-state-$foreign_sid.json"
    printf '%s' '{"active":true,"phase":"pursuing","iteration":0,"max_iterations":10,"started_at":"2026-01-01T00:00:00","last_touched_at":"2026-01-01T00:00:00"}' > "$current_state"
    printf '%s' '{"active":true,"phase":"pursuing","iteration":0,"max_iterations":10,"review_dispatch_used":5,"started_at":"2026-01-01T00:00:00","last_touched_at":"2026-01-01T00:00:00"}' > "$foreign_state"

    export OMT_SESSION_ID="$foreign_sid"
    export CODEX_THREAD_ID="$current_sid"
    out=$(payload "collaborationspawn_agent" "code-reviewer" | run_hook) || rc=$?
    assert_allow "$out" "$rc" "CODEX_THREAD_ID must select current state without payload session" || return 1
    [ "$(jq -r '.review_dispatch_used' "$current_state")" = "1" ] || return 1
    [ "$(jq -r '.review_dispatch_used' "$foreign_state")" = "5" ] || return 1
    [ "$OMT_SESSION_ID" = "$foreign_sid" ] || return 1

    jq '.review_dispatch_used = 5' "$current_state" > "$OMT_DIR/state.tmp"
    mv "$OMT_DIR/state.tmp" "$current_state"
    jq 'del(.review_dispatch_used)' "$foreign_state" > "$OMT_DIR/state.tmp"
    mv "$OMT_DIR/state.tmp" "$foreign_state"
    rc=0
    out=$(payload_with_session "collaborationspawn_agent" "code-reviewer" "$foreign_sid" | run_hook) || rc=$?
    assert_deny "$out" "$rc" "CODEX_THREAD_ID must override mismatched payload session" || return 1
    [ "$(jq -r '.review_dispatch_used' "$current_state")" = "5" ] || return 1
    [ "$(jq -r '.review_dispatch_used // 0' "$foreign_state")" = "0" ] || return 1
    [ "$OMT_SESSION_ID" = "$foreign_sid" ]
}

test_without_codex_thread_id_keeps_omt_session_fallback() {
    local out rc=0
    seed_pursuing
    unset CODEX_THREAD_ID
    out=$(payload_with_session "collaborationspawn_agent" "code-reviewer" "payload-session" | run_hook) || rc=$?
    assert_allow "$out" "$rc" "OMT_SESSION_ID fallback without CODEX_THREAD_ID" || return 1
    [ "$(jq -r '.review_dispatch_used' "$OMT_DIR/ultragoal-state-$OMT_SESSION_ID.json")" = "1" ]
}

test_jq_absent_allows() {
    local out rc=0 no_jq_bin cmd
    seed_pursuing
    no_jq_bin="$TEST_TMP_DIR/no-jq-bin"
    mkdir -p "$no_jq_bin"
    for cmd in cat dirname pwd; do ln -s "$(command -v "$cmd")" "$no_jq_bin/$cmd"; done
    out=$(printf '%s' '{"tool_name":"collaborationspawn_agent","tool_input":{"agent_type":"code-reviewer"}}' | PATH="$no_jq_bin" /bin/bash "$HOOK") || rc=$?
    assert_allow "$out" "$rc" "jq absent"
}

main() {
    run_test test_allowed_mixed_case_namespaced_claim_increments
    run_test test_sixth_denied_without_increment
    run_test test_completion_eligible_denied
    run_test test_planning_nonreviewer_and_nontool_pass
    run_test test_malformed_state_denies_safely
    run_test test_schema_valid_malformed_states_fail_closed_or_pass_known_inactive
    run_test test_codex_thread_id_scrubs_stale_omt_session_id
    run_test test_without_codex_thread_id_keeps_omt_session_fallback
    run_test test_jq_absent_allows
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    [ "$TESTS_FAILED" -eq 0 ]
}

main "$@"

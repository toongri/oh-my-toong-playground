#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$SCRIPT_DIR/qa-user-reply.sh"
TESTS_PASSED=0
TESTS_FAILED=0

run_test() {
    local name="$1"
    if "$name"; then echo "[PASS] $name"; ((TESTS_PASSED++)) || true
    else echo "[FAIL] $name"; ((TESTS_FAILED++)) || true; fi
}

setup() {
    SBX=$(mktemp -d)
    STATE="$SBX/qa-state-s1.json"
}
teardown() { rm -rf "$SBX"; }
write_state() { printf '%s' "$1" > "$STATE"; }
send() {
    jq -nc --arg p "$1" '{session_id:"s1",cwd:"/nowhere",hook_event_name:"UserPromptSubmit",prompt:$p}' |
        env -u CODEX_THREAD_ID OMT_DIR="$SBX" OMT_SESSION_ID=s1 bash "$HOOK"
}

test_waiting_reply_is_stored_verbatim() {
    setup
    write_state '{"active":true,"awaiting_user":true,"scenarios":[]}'
    local text out ok=0
    text=$'OTP 받을 휴대폰이 없어 "지금은"\n'
    out=$(send "$text")
    [ -z "$out" ] || ok=1
    [ "$(jq -r '.user_reply' "$STATE")" = "${text%$'\n'}" ] || ok=1
    [ "$(jq -c '.user_reply | endswith("\n")' "$STATE")" = true ] || ok=1
    [ "$(jq -c '[.user_answer_open, .awaiting_user]' "$STATE")" = '[true,false]' ] || ok=1
    [ ! -e "$STATE.lock" ] || ok=1
    teardown
    return "$ok"
}

test_stored_reply_refreshes_the_heartbeat_gc_reads() {
    setup
    write_state '{"active":true,"awaiting_user":true,"last_touched_at":"2000-01-01T00:00:00+09:00"}'
    send "진행해"
    local ok=0
    # shellcheck source=hooks/lib/state-liveness.sh
    ( source "$SCRIPT_DIR/lib/state-liveness.sh" && is_state_live "$STATE" "$(date +%s)" ) || ok=1
    teardown
    return "$ok"
}

test_prompt_without_await_user_changes_nothing() {
    setup
    write_state '{"active":true,"awaiting_user":false}'
    send "아무 말"
    local after ok=0
    after=$(cat "$STATE")
    [ "$after" = '{"active":true,"awaiting_user":false}' ] || ok=1
    teardown
    return "$ok"
}

test_inactive_cycle_changes_nothing() {
    setup
    write_state '{"active":false,"awaiting_user":true}'
    send "아무 말"
    local ok=0
    [ "$(cat "$STATE")" = '{"active":false,"awaiting_user":true}' ] || ok=1
    teardown
    return "$ok"
}

test_held_lock_skips_the_write() {
    setup
    write_state '{"active":true,"awaiting_user":true}'
    mkdir "$STATE.lock"
    send "답"
    local ok=0
    [ "$(jq -r '.user_reply // "none"' "$STATE")" = none ] || ok=1
    [ -d "$STATE.lock" ] || ok=1
    teardown
    return "$ok"
}

test_no_state_file_is_a_noop() {
    setup
    send "답"
    local ok=0
    [ ! -e "$STATE" ] || ok=1
    teardown
    return "$ok"
}

test_yaml_registers_prompt_event_on_both_platforms() {
    local yaml ev
    for yaml in "$SCRIPT_DIR/../claude.yaml" "$SCRIPT_DIR/../codex.yaml"; do
        ev=$(awk '/^  [A-Za-z]+:/{ev=$1} /component: qa-user-reply.sh/{print ev}' "$yaml")
        [ "$ev" = "UserPromptSubmit:" ] || return 1
    done
}

main() {
    run_test test_waiting_reply_is_stored_verbatim
    run_test test_stored_reply_refreshes_the_heartbeat_gc_reads
    run_test test_prompt_without_await_user_changes_nothing
    run_test test_inactive_cycle_changes_nothing
    run_test test_held_lock_skips_the_write
    run_test test_no_state_file_is_a_noop
    run_test test_yaml_registers_prompt_event_on_both_platforms
    echo "Passed: $TESTS_PASSED, Failed: $TESTS_FAILED"
    [ "$TESTS_FAILED" -eq 0 ]
}

main "$@"

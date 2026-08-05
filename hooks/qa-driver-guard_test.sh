#!/bin/bash
# Direct production-shaped probes for the Claude QA E2E driver gate.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$SCRIPT_DIR/qa-driver-guard.sh"
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
    mkdir -p "$SBX/omt"
    SID="qa-driver-claude"
}

cleanup_sandbox() { rm -rf "$SBX"; }

write_state() {
    local active="$1" armed="$2" suffix="${3:-}"
    jq -n --argjson active "$active" --argjson armed "$armed" \
        '{active:$active,derived:{driver_gate_armed:$armed}}' \
        > "$SBX/omt/qa-state-${SID}${suffix}.json"
}

payload() {
    local command="$1"
    jq -n --arg command "$command" --arg sid "$SID" \
        '{tool_name:"Bash",tool_input:{command:$command},session_id:$sid,cwd:"/safe/project"}'
}

run_hook() {
    local command="$1"
    payload "$command" | env -u CODEX_THREAD_ID OMT_DIR="$SBX/omt" OMT_SESSION_ID="$SID" bash "$HOOK"
}

assert_denied() {
    local out="$1" label="$2"
    printf '%s' "$out" | jq -e '.continue == false and (.reason | test("QA driver gate"; "i") and test("agent-device"; "i") and test("agent-browser"; "i") and test("curl"; "i") and test("bash"; "i"))' >/dev/null \
        || { echo "ASSERTION FAILED $label: expected Claude deny, got '$out'"; return 1; }
}

assert_allowed() {
    local out="$1" rc="$2" label="$3"
    if [ "$rc" -ne 0 ] || [ -n "$out" ]; then
        echo "ASSERTION FAILED $label: expected silent allow, rc=$rc output='$out'"
        return 1
    fi
}

test_armed_driver_commands_denied() {
    new_sandbox
    write_state true true
    local command out result=0
    for command in \
        'agent-browser open https://example.test' \
        'agent-device --version' \
        'curl https://example.test' \
        'bash --version' \
        'npx agent-browser screenshot' \
        'pnpm exec agent-device tap'; do
        out=$(run_hook "$command")
        assert_denied "$out" "$command" || result=1
    done
    cleanup_sandbox
    return "$result"
}

test_argument_token_is_not_driver_invocation() {
    new_sandbox
    write_state true true
    local out rc=0
    out=$(run_hook 'printf %s agent-device') || rc=$?
    assert_allowed "$out" "$rc" argument-token
    local result=$?
    cleanup_sandbox
    return "$result"
}

test_roster_first_plan_arm_allows_driver() {
    new_sandbox
    write_state true false
    local out rc=0
    out=$(run_hook 'agent-device --version') || rc=$?
    assert_allowed "$out" "$rc" roster-first-plan
    local result=$?
    cleanup_sandbox
    return "$result"
}

test_other_allow_arms_are_silent() {
    new_sandbox
    local out rc=0 result=0
    write_state false true
    out=$(run_hook 'agent-browser open https://example.test') || rc=$?
    assert_allowed "$out" "$rc" inactive || result=1
    write_state true false
    out=$(run_hook 'agent-device --version') || rc=$?
    assert_allowed "$out" "$rc" disarmed || result=1
    printf '%s\n' '{"active":true,"derived":{}}' > "$SBX/omt/qa-state-${SID}.json"
    out=$(run_hook 'agent-device --version') || rc=$?
    assert_allowed "$out" "$rc" absent-derived || result=1
    rm -f "$SBX/omt/qa-state-${SID}.json"
    out=$(run_hook 'agent-device --version') || rc=$?
    assert_allowed "$out" "$rc" absent-state || result=1
    write_state true true
    out=$(run_hook 'printf static inspection') || rc=$?
    assert_allowed "$out" "$rc" non-driver || result=1
    cleanup_sandbox
    return "$result"
}

test_jq_absent_fails_open() {
    new_sandbox
    write_state true true
    local no_bin="$SBX/no-bin" out rc=0
    mkdir -p "$no_bin"
    ln -s /bin/cat "$no_bin/cat"
    ln -s /usr/bin/dirname "$no_bin/dirname"
    out=$(payload 'agent-device --version' | env -u CODEX_THREAD_ID OMT_DIR="$SBX/omt" OMT_SESSION_ID="$SID" PATH="$no_bin" /bin/bash "$HOOK") || rc=$?
    assert_allowed "$out" "$rc" jq-absent
    local result=$?
    cleanup_sandbox
    return "$result"
}

for test_name in \
    test_armed_driver_commands_denied \
    test_argument_token_is_not_driver_invocation \
    test_roster_first_plan_arm_allows_driver \
    test_other_allow_arms_are_silent \
    test_jq_absent_fails_open; do
    run_test "$test_name"
done

echo "Tests: $TESTS_PASSED passed, $TESTS_FAILED failed"
[ "$TESTS_FAILED" -eq 0 ]

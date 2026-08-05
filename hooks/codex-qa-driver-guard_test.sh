#!/bin/bash
# Direct production-shaped probes for the Codex QA E2E driver gate.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$SCRIPT_DIR/codex-qa-driver-guard.sh"
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
    SID="qa-driver-codex"
}

cleanup_sandbox() { rm -rf "$SBX"; }

write_state() {
    local active="$1" armed="$2"
    jq -n --argjson active "$active" --argjson armed "$armed" \
        '{active:$active,derived:{driver_gate_armed:$armed}}' \
        > "$SBX/omt/qa-state-${SID}.json"
}

payload() {
    local tool_name="$1" key="$2" command="$3"
    jq -n --arg tool "$tool_name" --arg key "$key" --arg command "$command" --arg sid "$SID" \
        '{tool_name:$tool,tool_input:{($key):$command},session_id:$sid,cwd:"/safe/project"}'
}

run_hook() {
    local tool_name="$1" key="$2" command="$3"
    payload "$tool_name" "$key" "$command" | env -u CODEX_THREAD_ID OMT_DIR="$SBX/omt" OMT_SESSION_ID="$SID" bash "$HOOK"
}

assert_denied() {
    local out="$1" label="$2"
    printf '%s' "$out" | jq -e '.hookSpecificOutput.permissionDecision == "deny" and (.hookSpecificOutput.permissionDecisionReason | test("QA driver gate"; "i"))' >/dev/null \
        || { echo "ASSERTION FAILED $label: expected Codex deny, got '$out'"; return 1; }
}

assert_allowed() {
    local out="$1" rc="$2" label="$3"
    if [ "$rc" -ne 0 ] || [ -n "$out" ]; then
        echo "ASSERTION FAILED $label: expected silent allow, rc=$rc output='$out'"
        return 1
    fi
}

test_all_codex_shell_tools_denied_when_armed() {
    new_sandbox
    write_state true true
    local tool_name key out result=0
    for tool_name in bash exec_command shell_command; do
        for key in cmd command; do
            out=$(run_hook "$tool_name" "$key" 'agent-browser open https://example.test')
            assert_denied "$out" "$tool_name-$key-browser" || result=1
            out=$(run_hook "$tool_name" "$key" 'agent-device --version')
            assert_denied "$out" "$tool_name-$key-device" || result=1
        done
    done
    cleanup_sandbox
    return "$result"
}

test_allow_arms_are_silent() {
    new_sandbox
    write_state true false
    local out rc=0 result=0
    for tool_name in bash exec_command shell_command; do
        out=$(run_hook "$tool_name" cmd 'agent-device --version') || rc=$?
        assert_allowed "$out" "$rc" "$tool_name-disarmed" || result=1
    done
    printf '%s\n' '{"active":true,"derived":{}}' > "$SBX/omt/qa-state-${SID}.json"
    out=$(run_hook exec_command cmd 'agent-device --version') || rc=$?
    assert_allowed "$out" "$rc" absent-derived || result=1
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
    out=$(payload exec_command cmd 'agent-device --version' | env -u CODEX_THREAD_ID OMT_DIR="$SBX/omt" OMT_SESSION_ID="$SID" PATH="$no_bin" /bin/bash "$HOOK") || rc=$?
    assert_allowed "$out" "$rc" jq-absent
    local result=$?
    cleanup_sandbox
    return "$result"
}

for test_name in \
    test_all_codex_shell_tools_denied_when_armed \
    test_allow_arms_are_silent \
    test_jq_absent_fails_open; do
    run_test "$test_name"
done

echo "Tests: $TESTS_PASSED passed, $TESTS_FAILED failed"
[ "$TESTS_FAILED" -eq 0 ]

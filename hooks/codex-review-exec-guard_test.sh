#!/bin/bash
# Tests for the Codex adapter of the shared static-review execution invariant.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$SCRIPT_DIR/codex-review-exec-guard.sh"
CLAUDE_HOOK="$SCRIPT_DIR/review-exec-guard.sh"
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

cleanup_sandbox() { rm -rf "$SBX"; }

payload() {
    local tool_name="$1" key="$2" command="$3" sid="${4:-reviewer}"
    jq -n --arg tool "$tool_name" --arg key "$key" --arg command "$command" --arg sid "$sid" \
        '{tool_name:$tool,tool_input:{($key):$command},session_id:$sid,cwd:"/safe/project"}'
}

run_codex() {
    local tool_name="$1" key="$2" command="$3" sid="${4:-reviewer}"
    payload "$tool_name" "$key" "$command" "$sid" | env -u CODEX_THREAD_ID OMT_DIR="$SBX/omt" OMT_SESSION_ID="$sid" bash "$HOOK"
}

assert_denied() {
    local out="$1" label="$2"
    if ! printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED $label: expected Codex denial, got '$out'"
        return 1
    fi
    printf '%s' "$out" | grep -Eqi 'static-only|static inspection'
}

assert_allowed() {
    local out="$1" rc="$2" label="$3"
    if [ "$rc" -ne 0 ] || [ -n "$out" ]; then
        echo "ASSERTION FAILED $label: expected allow, rc=$rc output='$out'"
        return 1
    fi
}

test_member_extracts_codex_shell_payloads_and_denies() {
    new_sandbox
    local tool_name key command out result=0
    for tool_name in exec_command shell_command Bash; do
        for key in cmd command; do
            for command in 'pnpm test' 'npm run build' 'yarn install' 'bun run lint' 'pytest' 'tsc --noEmit'; do
                out=$(payload "$tool_name" "$key" "$command" | env -u OMT_SESSION_ID -u CODEX_THREAD_ID OMT_DIR="$SBX/omt" OMT_REVIEW_ROLE=member bash "$HOOK")
                assert_denied "$out" "$tool_name-$key-$command" || result=1
            done
        done
    done
    cleanup_sandbox
    return "$result"
}

test_conductor_env_absent_payload_identity_and_other_session() {
    new_sandbox
    mkdir -p "$JOBS/chunk-review-one"
    printf '%s\n' '{"conductorSessionId":"conductor","status":"done"}' > "$JOBS/chunk-review-one/job.json"
    local out rc=0 result=0
    out=$(payload exec_command cmd 'pnpm test' conductor | env -u OMT_SESSION_ID -u CODEX_THREAD_ID OMT_DIR="$SBX/omt" bash "$HOOK")
    assert_denied "$out" payload-identity || result=1
    out=$(run_codex exec_command cmd 'pnpm test' another) || rc=$?
    assert_allowed "$out" "$rc" other-session || result=1
    rm -rf "$JOBS/chunk-review-one"
    rc=0; out=$(run_codex exec_command cmd 'pnpm test' conductor) || rc=$?
    assert_allowed "$out" "$rc" removed-job || result=1
    cleanup_sandbox
    return "$result"
}

test_fail_open_and_non_shell_routes() {
    new_sandbox
    local out rc=0 result=0
    out=$(run_codex exec_command cmd 'pnpm test') || rc=$?
    assert_allowed "$out" "$rc" no-marker || result=1
    mkdir -p "$JOBS/chunk-review-malformed"
    printf '%s\n' '{not json' > "$JOBS/chunk-review-malformed/job.json"
    rc=0; out=$(run_codex exec_command cmd 'pnpm test') || rc=$?
    assert_allowed "$out" "$rc" malformed-job || result=1
    rm -rf "$JOBS/chunk-review-malformed"
    rc=0; out=$(payload exec_command cmd 'pnpm test' 'unsafe/session' | env -u OMT_SESSION_ID -u CODEX_THREAD_ID OMT_DIR="$SBX/omt" OMT_REVIEW_ROLE=member bash "$HOOK") || rc=$?
    assert_allowed "$out" "$rc" unsafe-id || result=1
    rc=0; out=$(payload exec_command cmd 'pnpm test' conductor | env OMT_DIR="$SBX/omt" OMT_SESSION_ID=conductor CODEX_THREAD_ID=other bash "$HOOK") || rc=$?
    assert_allowed "$out" "$rc" identity-mismatch || result=1
    rc=0; out=$(payload edit command 'pnpm test' | env -u OMT_SESSION_ID -u CODEX_THREAD_ID OMT_DIR="$SBX/omt" OMT_REVIEW_ROLE=member bash "$HOOK") || rc=$?
    assert_allowed "$out" "$rc" non-shell || result=1
    rc=0; out=$(printf '%s' '{bad json' | env OMT_DIR="$SBX/omt" OMT_REVIEW_ROLE=member bash "$HOOK") || rc=$?
    assert_allowed "$out" "$rc" malformed-payload || result=1
    mkdir -p "$SBX/no-bin"
    ln -s /usr/bin/dirname "$SBX/no-bin/dirname"
    ln -s /bin/cat "$SBX/no-bin/cat"
    rc=0; out=$(payload exec_command cmd 'pnpm test' | env -u OMT_SESSION_ID -u CODEX_THREAD_ID OMT_DIR="$SBX/omt" OMT_REVIEW_ROLE=member PATH="$SBX/no-bin" /bin/bash "$HOOK") || rc=$?
    assert_allowed "$out" "$rc" jq-unavailable || result=1
    cleanup_sandbox
    return "$result"
}

test_static_and_orchestration_commands_allow() {
    new_sandbox
    local command out rc result=0
    for command in 'git diff' 'rg conductorSessionId hooks' 'grep -R review hooks' 'cat hooks/lib/omt-dir.sh' 'bun skills/orchestrate-review/job.ts collect'; do
        rc=0; out=$(payload shell_command command "$command" | env -u OMT_SESSION_ID -u CODEX_THREAD_ID OMT_DIR="$SBX/omt" OMT_REVIEW_ROLE=member bash "$HOOK") || rc=$?
        assert_allowed "$out" "$rc" "allowed-$command" || result=1
    done
    cleanup_sandbox
    return "$result"
}

test_matches_claude_reason_and_verdict() {
    new_sandbox
    local codex_out claude_out codex_reason claude_reason result=0
    codex_out=$(payload exec_command cmd 'pnpm test' | env -u OMT_SESSION_ID -u CODEX_THREAD_ID OMT_DIR="$SBX/omt" OMT_REVIEW_ROLE=member bash "$HOOK")
    claude_out=$(jq -n --arg command 'pnpm test' --arg sid reviewer '{tool_name:"Bash",tool_input:{command:$command},session_id:$sid,cwd:"/safe/project"}' | env -u OMT_SESSION_ID -u CODEX_THREAD_ID OMT_DIR="$SBX/omt" OMT_REVIEW_ROLE=member bash "$CLAUDE_HOOK")
    assert_denied "$codex_out" codex-member || result=1
    if ! printf '%s' "$claude_out" | grep -q '"continue":false'; then
        echo "ASSERTION FAILED claude-member: expected denial, got '$claude_out'"
        result=1
    fi
    codex_reason=$(printf '%s' "$codex_out" | jq -r '.hookSpecificOutput.permissionDecisionReason')
    claude_reason=$(printf '%s' "$claude_out" | jq -r '.reason')
    if [ "$codex_reason" != "$claude_reason" ]; then
        echo "ASSERTION FAILED twin-reason: Codex '$codex_reason' != Claude '$claude_reason'"
        result=1
    fi
    cleanup_sandbox
    return "$result"
}

main() {
    run_test test_member_extracts_codex_shell_payloads_and_denies
    run_test test_conductor_env_absent_payload_identity_and_other_session
    run_test test_fail_open_and_non_shell_routes
    run_test test_static_and_orchestration_commands_allow
    run_test test_matches_claude_reason_and_verdict
    echo "Passed: $TESTS_PASSED, Failed: $TESTS_FAILED"
    [ "$TESTS_FAILED" -eq 0 ]
}

main "$@"

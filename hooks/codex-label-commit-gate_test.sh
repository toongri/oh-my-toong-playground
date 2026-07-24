#!/bin/bash
# =============================================================================
# Codex Label Commit Gate Hook Tests (Claude<->Codex hook-parity plan)
#
# Covers hooks/codex-label-commit-gate.sh: the Codex PreToolUse shim over
# the shared judgment core (hooks/label-commit-gate-core.sh) that hooks/
# label-commit-gate.sh (Claude) also uses. Asserts:
#   - the shared core is actually referenced (zero duplicated judgment logic)
#   - a hard-tier label in the commit message -> Codex-shaped deny envelope
#     (hookSpecificOutput.permissionDecision:"deny", stdout, exit 0 --
#     NOT Claude's stderr+exit2 contract)
#   - a clean commit message -> allow (no stdout, exit 0)
#   - a non-commit Bash command -> passthrough
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$SCRIPT_DIR/codex-label-commit-gate.sh"

TESTS_PASSED=0
TESTS_FAILED=0

# -----------------------------------------------------------------------------
# mktemp -d + cleanup trap (OMT shell-test convention)
# -----------------------------------------------------------------------------
TEST_TMP_DIR=$(mktemp -d)
cleanup() {
    rm -rf "$TEST_TMP_DIR"
}
trap cleanup EXIT

run_test() {
    local test_name="$1"
    if "$test_name"; then
        echo "[PASS] $test_name"
        ((TESTS_PASSED++)) || true
    else
        echo "[FAIL] $test_name"
        ((TESTS_FAILED++)) || true
    fi
}

run_hook() {
    local tool_name="$1" cmd="$2"
    jq -n --arg t "$tool_name" --arg c "$cmd" '{tool_name:$t,tool_input:{command:$c}}' | bash "$HOOK"
}

test_shim_sources_shared_core() {
    grep -qF 'source "$SCRIPT_DIR/label-commit-gate-core.sh"' "$HOOK" \
        || { echo "ASSERTION FAILED: must source label-commit-gate-core.sh"; return 1; }
    return 0
}

test_hard_label_denies_codex_shape() {
    local output exit_code=0
    output=$(run_hook "bash" "git commit -m 'fix D-36'") || exit_code=$?
    [ "$exit_code" -eq 0 ] || { echo "ASSERTION FAILED: exit should be 0 (Codex deny is stdout-based), got $exit_code"; return 1; }
    echo "$output" | jq -e '.hookSpecificOutput.permissionDecision == "deny"' > /dev/null \
        || { echo "ASSERTION FAILED: expected permissionDecision:deny. Got: $output"; return 1; }
    echo "$output" | grep -qF "D-36" \
        || { echo "ASSERTION FAILED: reason should name D-36. Got: $output"; return 1; }
    return 0
}

test_clean_message_allows() {
    local output exit_code=0
    output=$(run_hook "bash" "git commit -m 'add enrich flag'") || exit_code=$?
    [ "$exit_code" -eq 0 ] || { echo "ASSERTION FAILED: expected exit 0, got $exit_code"; return 1; }
    [ -z "$output" ] || { echo "ASSERTION FAILED: expected empty stdout for a clean message. Got: $output"; return 1; }
    return 0
}

test_non_commit_passthrough() {
    local output exit_code=0
    output=$(run_hook "bash" "ls") || exit_code=$?
    [ "$exit_code" -eq 0 ] || { echo "ASSERTION FAILED: expected exit 0, got $exit_code"; return 1; }
    [ -z "$output" ] || { echo "ASSERTION FAILED: expected empty stdout for non-commit. Got: $output"; return 1; }
    return 0
}

test_exec_command_tool_name_routes() {
    # exec_command (a Codex-native tool name distinct from bash) must also route.
    local output exit_code=0
    output=$(run_hook "exec_command" "git commit -m 'fix D-36'") || exit_code=$?
    [ "$exit_code" -eq 0 ] || { echo "ASSERTION FAILED: expected exit 0, got $exit_code"; return 1; }
    echo "$output" | jq -e '.hookSpecificOutput.permissionDecision == "deny"' > /dev/null \
        || { echo "ASSERTION FAILED: exec_command routed command should also deny. Got: $output"; return 1; }
    return 0
}

test_cmd_key_fallback() {
    # shell_command payloads carry the text under .tool_input.cmd, not .command.
    local output exit_code=0
    output=$(jq -n '{tool_name:"shell_command",tool_input:{cmd:"git commit -m '"'"'fix D-36'"'"'"}}' | bash "$HOOK") || exit_code=$?
    [ "$exit_code" -eq 0 ] || { echo "ASSERTION FAILED: expected exit 0, got $exit_code"; return 1; }
    echo "$output" | jq -e '.hookSpecificOutput.permissionDecision == "deny"' > /dev/null \
        || { echo "ASSERTION FAILED: .tool_input.cmd fallback should deny. Got: $output"; return 1; }
    return 0
}

test_body_only_label_allows_codex_shape() {
    # Cross-lane parity proof: the shared core's title-only judgment (fixed
    # for label-commit-gate-core.sh's body-scanning false positive) must
    # reach the Codex lane too, not just Claude's label-commit-gate.sh.
    local output exit_code=0
    output=$(run_hook "bash" "git commit -m 'clean subject' -m 'fix D-36'") || exit_code=$?
    [ "$exit_code" -eq 0 ] || { echo "ASSERTION FAILED: expected exit 0, got $exit_code"; return 1; }
    [ -z "$output" ] || { echo "ASSERTION FAILED: label only in body (2nd -m) should allow. Got: $output"; return 1; }
    return 0
}

test_unrelated_tool_name_passthrough() {
    local output exit_code=0
    output=$(jq -n '{tool_name:"read",tool_input:{}}' | bash "$HOOK") || exit_code=$?
    [ "$exit_code" -eq 0 ] || { echo "ASSERTION FAILED: expected exit 0, got $exit_code"; return 1; }
    [ -z "$output" ] || { echo "ASSERTION FAILED: expected empty stdout for unrelated tool. Got: $output"; return 1; }
    return 0
}

# =============================================================================
# tool_input.workdir fallback (mirrors hooks/rules-injector/tool-paths.ts:
# 44-47's `workdir ?? cwd` and hooks/codex-write-guard.sh:505-538's shell-
# route carve-out). A `-F <relative file>` message is resolved against the
# COMMAND's own workdir, not wherever this hook process happens to run.
# =============================================================================
test_workdir_resolves_relative_dash_capital_f_denies() {
    local base_dir="$TEST_TMP_DIR/wd_base"
    local sub_dir="$base_dir/sub"
    mkdir -p "$sub_dir"
    printf 'fix D-36\n' > "$sub_dir/relfile.txt"

    local output exit_code=0
    output=$(jq -n --arg cwd "$base_dir" '{cwd:$cwd,tool_name:"bash",tool_input:{command:"git commit -F relfile.txt",workdir:"sub"}}' \
        | bash "$HOOK") || exit_code=$?

    [ "$exit_code" -eq 0 ] || { echo "ASSERTION FAILED: expected exit 0 (Codex deny is stdout-based), got $exit_code"; return 1; }
    echo "$output" | jq -e '.hookSpecificOutput.permissionDecision == "deny"' > /dev/null \
        || { echo "ASSERTION FAILED: relative -F file under tool_input.workdir should deny. Got: $output"; return 1; }
    echo "$output" | grep -qF "D-36" \
        || { echo "ASSERTION FAILED: reason should name D-36. Got: $output"; return 1; }
    return 0
}

test_workdir_absolute_form_resolves_dash_capital_f_denies() {
    local base_dir="$TEST_TMP_DIR/wd_base_abs"
    local sub_dir="$base_dir/sub_abs"
    mkdir -p "$sub_dir"
    printf 'fix D-36\n' > "$sub_dir/relfile.txt"

    local output exit_code=0
    output=$(jq -n --arg wd "$sub_dir" '{tool_name:"bash",tool_input:{command:"git commit -F relfile.txt",workdir:$wd}}' \
        | bash "$HOOK") || exit_code=$?

    [ "$exit_code" -eq 0 ] || { echo "ASSERTION FAILED: expected exit 0 (Codex deny is stdout-based), got $exit_code"; return 1; }
    echo "$output" | jq -e '.hookSpecificOutput.permissionDecision == "deny"' > /dev/null \
        || { echo "ASSERTION FAILED: absolute tool_input.workdir should deny. Got: $output"; return 1; }
    return 0
}

# Negative control: the SAME relative -F command WITHOUT a workdir field
# behaves identically before and after the fix -- the relative path never
# resolves against this hook process's own cwd, so it allows either way.
test_no_workdir_field_relative_dash_capital_f_still_allows() {
    local output exit_code=0
    output=$(jq -n '{tool_name:"bash",tool_input:{command:"git commit -F relfile_does_not_resolve_here.txt"}}' \
        | bash "$HOOK") || exit_code=$?

    [ "$exit_code" -eq 0 ] || { echo "ASSERTION FAILED: expected exit 0, got $exit_code"; return 1; }
    [ -z "$output" ] || { echo "ASSERTION FAILED: expected empty stdout (allow) when no workdir field is present. Got: $output"; return 1; }
    return 0
}

main() {
    echo "=========================================="
    echo "Codex Label Commit Gate Tests"
    echo "=========================================="

    run_test test_shim_sources_shared_core
    run_test test_hard_label_denies_codex_shape
    run_test test_clean_message_allows
    run_test test_non_commit_passthrough
    run_test test_exec_command_tool_name_routes
    run_test test_cmd_key_fallback
    run_test test_body_only_label_allows_codex_shape
    run_test test_unrelated_tool_name_passthrough
    run_test test_workdir_resolves_relative_dash_capital_f_denies
    run_test test_workdir_absolute_form_resolves_dash_capital_f_denies
    run_test test_no_workdir_field_relative_dash_capital_f_still_allows

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
}

main "$@"

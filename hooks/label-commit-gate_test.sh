#!/bin/bash
# =============================================================================
# Label Commit Gate Hook Tests
# Covers AC-EH1a / AC-EH1b / AC-EH1c / AC-EH2 for hooks/label-commit-gate.sh —
# a PreToolUse (Bash matcher) hook that hard-blocks a `git commit` whose
# commit MESSAGE (message only, never staged content) contains a
# clean-economics invented label (hooks/lib/label-patterns.sh label_match_hard).
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$SCRIPT_DIR/label-commit-gate.sh"

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

run_hook() {
    local cmd_json="$1"
    printf '{"tool_input":{"command":%s}}' "$cmd_json" | bash "$HOOK"
}

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

# =============================================================================
# AC-EH1a — hard-tier label in -m message → exit 2, stderr names the token
# =============================================================================
test_ac_eh1a_hard_label_in_dash_m_denies() {
    local exit_code=0
    local stderr_out
    stderr_out=$(printf '{"tool_input":{"command":"git commit -m '"'"'fix D-36'"'"'"}}' \
        | bash "$HOOK" 2>&1 >/dev/null) || exit_code=$?

    [[ "$exit_code" -eq 2 ]] \
        || { echo "ASSERTION FAILED: exit code should be 2 (exit=$exit_code)"; return 1; }

    echo "$stderr_out" | grep -q "D-36" \
        || { echo "ASSERTION FAILED: stderr should name 'D-36'. Got: '$stderr_out'"; return 1; }

    echo "$stderr_out" | grep -q '"decision"[[:space:]]*:[[:space:]]*"deny"' \
        || { echo "ASSERTION FAILED: stderr should carry decision:deny JSON. Got: '$stderr_out'"; return 1; }
}

# =============================================================================
# AC-EH1b — clean message (no invented label) → exit 0
# =============================================================================
test_ac_eh1b_clean_message_allows() {
    local exit_code=0
    printf '{"tool_input":{"command":"git commit -m '"'"'add enrich flag'"'"'"}}' \
        | bash "$HOOK" >/dev/null 2>&1 || exit_code=$?

    [[ "$exit_code" -eq 0 ]] \
        || { echo "ASSERTION FAILED: exit code should be 0 for clean message (exit=$exit_code)"; return 1; }
}

# =============================================================================
# AC-EH1c — FULL-tier-only pattern ("Phase 2") in message must NOT hard-block
# (label_match_hard must be used, never label_match_full)
# =============================================================================
test_ac_eh1c_full_tier_only_pattern_allows() {
    local exit_code=0
    printf '{"tool_input":{"command":"git commit -m '"'"'feat: Phase 2 rollout'"'"'"}}' \
        | bash "$HOOK" >/dev/null 2>&1 || exit_code=$?

    [[ "$exit_code" -eq 0 ]] \
        || { echo "ASSERTION FAILED: exit code should be 0 for 'Phase 2' message (exit=$exit_code)"; return 1; }
}

# =============================================================================
# AC-EH1 (-F variant) — hard-tier label read from a -F file path → exit 2
# =============================================================================
test_ac_eh1_dash_capital_f_file_denies() {
    local exit_code=0
    local stderr_out
    local msg_file="$TEST_TMP_DIR/msg.txt"
    printf 'fix D-36\n' > "$msg_file"

    local cmd
    cmd="git commit -F $msg_file"
    stderr_out=$(jq -n --arg c "$cmd" '{tool_input:{command:$c}}' \
        | bash "$HOOK" 2>&1 >/dev/null) || exit_code=$?

    [[ "$exit_code" -eq 2 ]] \
        || { echo "ASSERTION FAILED: exit code should be 2 for -F file with hard label (exit=$exit_code)"; return 1; }

    echo "$stderr_out" | grep -q "D-36" \
        || { echo "ASSERTION FAILED: stderr should name 'D-36'. Got: '$stderr_out'"; return 1; }
}

# =============================================================================
# Non-commit Bash passthrough — .tool_input.command = "ls" → exit 0
# =============================================================================
test_non_commit_bash_passthrough() {
    local exit_code=0
    printf '{"tool_input":{"command":"ls"}}' | bash "$HOOK" >/dev/null 2>&1 || exit_code=$?

    [[ "$exit_code" -eq 0 ]] \
        || { echo "ASSERTION FAILED: exit code should be 0 for non-commit Bash (exit=$exit_code)"; return 1; }
}

# =============================================================================
# AC-EH2 — message-only proof: clean MESSAGE passes even though the hook
# never reads staged content (no real git repo/staging is set up here — the
# absence of any git-diff read is the point being proven).
# =============================================================================
test_ac_eh2_message_only_clean_message_allows() {
    local exit_code=0
    printf '{"tool_input":{"command":"git commit -m '"'"'add ADR'"'"'"}}' \
        | bash "$HOOK" >/dev/null 2>&1 || exit_code=$?

    [[ "$exit_code" -eq 0 ]] \
        || { echo "ASSERTION FAILED: exit code should be 0 for clean-message commit regardless of staged content (exit=$exit_code)"; return 1; }
}

# =============================================================================
# Human paths must never be blocked: -F -, editor-driven, bare --amend
# =============================================================================
test_stdin_message_dash_f_dash_passthrough() {
    local exit_code=0
    printf '{"tool_input":{"command":"git commit -F -"}}' \
        | bash "$HOOK" >/dev/null 2>&1 || exit_code=$?

    [[ "$exit_code" -eq 0 ]] \
        || { echo "ASSERTION FAILED: exit code should be 0 for -F - (stdin message) (exit=$exit_code)"; return 1; }
}

test_editor_driven_commit_passthrough() {
    local exit_code=0
    printf '{"tool_input":{"command":"git commit"}}' \
        | bash "$HOOK" >/dev/null 2>&1 || exit_code=$?

    [[ "$exit_code" -eq 0 ]] \
        || { echo "ASSERTION FAILED: exit code should be 0 for editor-driven commit (exit=$exit_code)"; return 1; }
}

test_bare_amend_no_message_passthrough() {
    local exit_code=0
    printf '{"tool_input":{"command":"git commit --amend"}}' \
        | bash "$HOOK" >/dev/null 2>&1 || exit_code=$?

    [[ "$exit_code" -eq 0 ]] \
        || { echo "ASSERTION FAILED: exit code should be 0 for bare --amend (exit=$exit_code)"; return 1; }
}

# =============================================================================
# --file=<path> shape (long-flag form of -F) → exit 2 on hard label
# =============================================================================
test_dash_dash_file_equals_shape_denies() {
    local exit_code=0
    local stderr_out
    local msg_file="$TEST_TMP_DIR/msg2.txt"
    printf 'fix D-36\n' > "$msg_file"

    local cmd
    cmd="git commit --file=$msg_file"
    stderr_out=$(jq -n --arg c "$cmd" '{tool_input:{command:$c}}' \
        | bash "$HOOK" 2>&1 >/dev/null) || exit_code=$?

    [[ "$exit_code" -eq 2 ]] \
        || { echo "ASSERTION FAILED: exit code should be 2 for --file= with hard label (exit=$exit_code)"; return 1; }

    echo "$stderr_out" | grep -q "D-36" \
        || { echo "ASSERTION FAILED: stderr should name 'D-36'. Got: '$stderr_out'"; return 1; }
}

# =============================================================================
# Combined short-flag form `-am` — message must still be extracted → exit 2
# =============================================================================
test_combined_short_flag_am_denies() {
    local exit_code=0
    local stderr_out
    stderr_out=$(printf '{"tool_input":{"command":"git commit -am '"'"'fix D-36'"'"'"}}' \
        | bash "$HOOK" 2>&1 >/dev/null) || exit_code=$?

    [[ "$exit_code" -eq 2 ]] \
        || { echo "ASSERTION FAILED: exit code should be 2 for -am combined flag (exit=$exit_code)"; return 1; }

    echo "$stderr_out" | grep -q "D-36" \
        || { echo "ASSERTION FAILED: stderr should name 'D-36'. Got: '$stderr_out'"; return 1; }
}

# =============================================================================
# `git -C <path> commit -m '...'` — git global option before commit must
# still trigger detection → exit 2
# =============================================================================
test_git_global_option_before_commit_denies() {
    local exit_code=0
    local stderr_out
    local cmd="git -C /tmp/x commit -m 'see D-1'"
    stderr_out=$(jq -n --arg c "$cmd" '{tool_input:{command:$c}}' \
        | bash "$HOOK" 2>&1 >/dev/null) || exit_code=$?

    [[ "$exit_code" -eq 2 ]] \
        || { echo "ASSERTION FAILED: exit code should be 2 for 'git -C <path> commit -m' (exit=$exit_code)"; return 1; }

    echo "$stderr_out" | grep -q "D-1\b" \
        || { echo "ASSERTION FAILED: stderr should name 'D-1'. Got: '$stderr_out'"; return 1; }
}

# =============================================================================
# Guard-preserving negative: broadened detection must NOT match
# `git commit-graph` (a distinct git subcommand, not a commit) → exit 0
# =============================================================================
test_commit_graph_still_passthrough() {
    local exit_code=0
    printf '{"tool_input":{"command":"git commit-graph write"}}' \
        | bash "$HOOK" >/dev/null 2>&1 || exit_code=$?

    [[ "$exit_code" -eq 0 ]] \
        || { echo "ASSERTION FAILED: exit code should be 0 for 'git commit-graph write' (exit=$exit_code)"; return 1; }
}

# =============================================================================
# Newline boundary — detection must be single-line only. A `git <x>` on one
# line must never let the between-run match across the newline into an
# unrelated later line that happens to contain a bare `commit` token.
# =============================================================================
test_multiline_git_diff_then_prose_commit_mention_passthrough() {
    local exit_code=0
    local cmd
    cmd=$(printf 'git diff --staged\necho "ready to commit with -m '\''D-1'\''"')
    jq -n --arg c "$cmd" '{tool_input:{command:$c}}' \
        | bash "$HOOK" >/dev/null 2>&1 || exit_code=$?

    [[ "$exit_code" -eq 0 ]] \
        || { echo "ASSERTION FAILED: exit code should be 0 for multi-line 'git diff' followed by unrelated prose mentioning commit (exit=$exit_code)"; return 1; }
}

test_multiline_bare_commit_word_on_own_line_passthrough() {
    local exit_code=0
    local cmd
    cmd=$(printf 'git status\ncommit -m '\''D-1'\''')
    jq -n --arg c "$cmd" '{tool_input:{command:$c}}' \
        | bash "$HOOK" >/dev/null 2>&1 || exit_code=$?

    [[ "$exit_code" -eq 0 ]] \
        || { echo "ASSERTION FAILED: exit code should be 0 for 'git status' followed by a bare 'commit' on a later, unrelated line (exit=$exit_code)"; return 1; }
}

test_multiline_real_git_commit_on_second_line_denies() {
    local exit_code=0
    local stderr_out
    local cmd
    cmd=$(printf 'git add -A\ngit commit -m '\''D-1'\''')
    stderr_out=$(jq -n --arg c "$cmd" '{tool_input:{command:$c}}' \
        | bash "$HOOK" 2>&1 >/dev/null) || exit_code=$?

    [[ "$exit_code" -eq 2 ]] \
        || { echo "ASSERTION FAILED: exit code should be 2 for a genuine 'git commit' on its own line (exit=$exit_code)"; return 1; }

    echo "$stderr_out" | grep -q "D-1" \
        || { echo "ASSERTION FAILED: stderr should name 'D-1'. Got: '$stderr_out'"; return 1; }
}

# =============================================================================
# Fail-open source guard: missing lib must never wedge a commit (exit 0)
# =============================================================================
test_fail_open_when_lib_missing() {
    local exit_code=0
    local stderr_out
    local sandbox_dir="$TEST_TMP_DIR/sandbox_hooks"
    mkdir -p "$sandbox_dir"
    cp "$HOOK" "$sandbox_dir/label-commit-gate.sh"
    # Intentionally no lib/label-patterns.sh under $sandbox_dir

    stderr_out=$(printf '{"tool_input":{"command":"git commit -m '"'"'fix D-36'"'"'"}}' \
        | bash "$sandbox_dir/label-commit-gate.sh" 2>&1 >/dev/null) || exit_code=$?

    [[ "$exit_code" -eq 0 ]] \
        || { echo "ASSERTION FAILED: exit code should be 0 (fail-open) when lib is missing (exit=$exit_code)"; return 1; }

    echo "$stderr_out" | grep -qi "WARNING" \
        || { echo "ASSERTION FAILED: stderr should contain a WARNING when lib is missing. Got: '$stderr_out'"; return 1; }
}

# =============================================================================
# Main
# =============================================================================
main() {
    echo "=========================================="
    echo "Label Commit Gate Tests"
    echo "=========================================="

    run_test test_ac_eh1a_hard_label_in_dash_m_denies
    run_test test_ac_eh1b_clean_message_allows
    run_test test_ac_eh1c_full_tier_only_pattern_allows
    run_test test_ac_eh1_dash_capital_f_file_denies
    run_test test_non_commit_bash_passthrough
    run_test test_ac_eh2_message_only_clean_message_allows
    run_test test_stdin_message_dash_f_dash_passthrough
    run_test test_editor_driven_commit_passthrough
    run_test test_bare_amend_no_message_passthrough
    run_test test_dash_dash_file_equals_shape_denies
    run_test test_combined_short_flag_am_denies
    run_test test_git_global_option_before_commit_denies
    run_test test_commit_graph_still_passthrough
    run_test test_multiline_git_diff_then_prose_commit_mention_passthrough
    run_test test_multiline_bare_commit_word_on_own_line_passthrough
    run_test test_multiline_real_git_commit_on_second_line_denies
    run_test test_fail_open_when_lib_missing

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
}

main "$@"

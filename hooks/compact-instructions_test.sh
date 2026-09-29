#!/bin/bash
# =============================================================================
# compact-instructions.sh Tests
#
# hooks/compact-instructions.sh is a PreCompact hook whose plain stdout is
# appended to Claude Code's native compaction summary instructions (JSON
# hookSpecificOutput is ignored on this event). This file verifies:
#   1. the hook exits 0 on a PreCompact-shaped JSON payload.
#   2. its stdout is byte-identical to the pinned expected text.
#   3. stdout is plain text, not JSON.
#   4. the hook still exits 0 and emits the same text on empty stdin.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$SCRIPT_DIR/compact-instructions.sh"

TESTS_PASSED=0
TESTS_FAILED=0

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

# Pinned expected body -- the heredoc inside compact-instructions.sh must
# emit this verbatim. Kept here as a separately-typed literal (not read back
# from the hook's own source) so drift in the hook's heredoc body actually
# fails this test instead of trivially agreeing with itself.
_expected_body() {
    cat <<'EOF'
Additional requirements for this summary. The reader is you after the reset, continuing autonomously from this summary alone.
- Current Work: state the situation as of the LAST tool result, not as of earlier intentions: repository/worktree path, local branch and its remote branch name, any operation still in progress (merge, rebase, uncommitted changes), the last command run and its outcome. When you quote a file's content, a rule, or an invariant, quote its latest version from the most recent read or edit.
- Next Step: give the exact command(s) to run next with every non-default argument spelled out (for example an explicit push refspec when the local and remote branch names differ). Quote the user message that authorizes it. When the user already authorized the action, say that no further confirmation is needed.
- Add a section "Operational gotchas": every environment trap found in this session, each with its fix: a command that failed and the one that worked; a state check that needs a different form here (for example, in a git worktree `.git` is a file, so check merge state with `git rev-parse --git-path MERGE_HEAD`); a hardcoded value or count that must be re-measured when its inputs change, with the command that measures it.
- Add a section "Experiment results": for every test, eval, or experiment run in this session, what was run and the observed result with its numbers and the specific failures seen.
- When the user approved a proposal that is not finished, add a section "Approved plan (APPROVED)" that reproduces it in full: every target, file, change, rule wording, and verification step.
- When the user removed a scope item or a design was rejected or superseded, name it once as "Rejected: X - because Y". Describe the surviving design only.
- Refer to code by path and symbol name; include code only when the next step edits that code. Include a file path only when the next steps read, edit, or run it. Finished work gets one line with its PR or commit.
- When a deliverable is being assembled from pieces (draft files, scratch files, partial outputs), list every piece file by its full absolute path with what it contains, and list every numbered item not yet written with its number and its meaning as stated where it was defined. Never shorten a path with "...".
- When a subagent, tool, or reviewer result arrived that the conversation has not yet checked, mark it "UNVERIFIED" in Current Work and do not judge it yourself. List each of its recommendations; under each, quote verbatim every saved acceptance criterion, design decision, and user statement on the same topic, including statements about what must be removed. Next Step: verify the result's cited code, compare each recommendation with the quoted items, and ask the user before adopting any recommendation that keeps, adds, or reintroduces something the quoted items remove or forbid. The "no further confirmation is needed" statement never covers adopting an unverified result.
EOF
}

test_exits_zero_on_precompact_payload() {
    local rc=0
    printf '%s' '{"hook_event_name":"PreCompact","trigger":"manual"}' | bash "$HOOK" > /dev/null 2>/dev/null || rc=$?
    [ "$rc" -eq 0 ] || { echo "ASSERTION FAILED: expected exit 0, got $rc"; return 1; }
}

test_stdout_byte_identical_to_expected() {
    local out expected
    out=$(printf '%s' '{"hook_event_name":"PreCompact","trigger":"manual"}' | bash "$HOOK")
    expected=$(_expected_body)
    if [ "$out" != "$expected" ]; then
        echo "ASSERTION FAILED: stdout is not byte-identical to the expected body"
        echo "  out (first 200): ${out:0:200}"
        echo "  expected (first 200): ${expected:0:200}"
        return 1
    fi
}

test_key_sections_present() {
    local out
    out=$(printf '%s' '{"hook_event_name":"PreCompact","trigger":"manual"}' | bash "$HOOK")
    local section
    for section in "Operational gotchas" "Experiment results" "Approved plan (APPROVED)" "UNVERIFIED"; do
        if ! printf '%s' "$out" | grep -qF "$section"; then
            echo "ASSERTION FAILED: expected section '$section' missing from stdout"
            return 1
        fi
    done
}

test_stdout_is_not_json() {
    local out
    out=$(printf '%s' '{"hook_event_name":"PreCompact","trigger":"manual"}' | bash "$HOOK")
    if command -v jq > /dev/null 2>&1; then
        if printf '%s' "$out" | jq -e . > /dev/null 2>&1; then
            echo "ASSERTION FAILED: stdout parses as JSON, expected plain text"
            return 1
        fi
    fi
    case "$out" in
        '{'*) echo "ASSERTION FAILED: stdout starts with '{', looks JSON-shaped"; return 1 ;;
    esac
    return 0
}

test_works_with_empty_stdin() {
    local rc=0 out expected
    out=$(printf '' | bash "$HOOK") || rc=$?
    [ "$rc" -eq 0 ] || { echo "ASSERTION FAILED: expected exit 0 on empty stdin, got $rc"; return 1; }
    expected=$(_expected_body)
    if [ "$out" != "$expected" ]; then
        echo "ASSERTION FAILED: empty-stdin output is not byte-identical to the expected body"
        return 1
    fi
}

main() {
    echo "=========================================="
    echo "compact-instructions.sh Tests"
    echo "=========================================="

    run_test test_exits_zero_on_precompact_payload
    run_test test_stdout_byte_identical_to_expected
    run_test test_key_sections_present
    run_test test_stdout_is_not_json
    run_test test_works_with_empty_stdin

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    [ "$TESTS_FAILED" -eq 0 ]
}

main

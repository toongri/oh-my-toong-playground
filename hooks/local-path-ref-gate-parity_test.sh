#!/bin/bash
# Claude/Codex local-path reference gate shell-payload parity tests.
#
# Both adapters receive semantically equivalent Bash payloads.  Their denial
# envelopes differ, so assertions normalize each result to only allow/deny;
# the inspected command is never executed.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_HOOK="$SCRIPT_DIR/local-path-ref-gate.sh"
CODEX_HOOK="$SCRIPT_DIR/codex-local-path-ref-gate.sh"
REPO="$(mktemp -d)"
HOME="$REPO/home"
OMT_DIR="$REPO/omt"
RUN_DIR="$REPO/runs"
export HOME OMT_DIR
mkdir -p "$HOME" "$OMT_DIR" "$RUN_DIR" "$REPO/docs"
trap 'rm -rf "$REPO"' EXIT

git -C "$REPO" init -q
git -C "$REPO" config user.email test@example.invalid
git -C "$REPO" config user.name test
printf 'session state\n' > "$OMT_DIR/session.md"
printf 'untracked fixture\n' > "$REPO/docs/untracked.md"
printf 'safe baseline\n' > "$REPO/docs/notes.md"
git -C "$REPO" add docs/notes.md
git -C "$REPO" commit -q -m baseline

TESTS_PASSED=0
TESTS_FAILED=0
RUN_NUMBER=0

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

normalize_claude_decision() {
    local exit_code="$1" stderr_file="$2"
    if [ "$exit_code" -eq 2 ]; then
        jq -e '.decision == "deny"' "$stderr_file" >/dev/null 2>&1 || return 1
        printf 'deny'
    elif [ "$exit_code" -eq 0 ]; then
        printf 'allow'
    else
        return 1
    fi
}

normalize_codex_decision() {
    local exit_code="$1" stdout_file="$2"
    [ "$exit_code" -eq 0 ] || return 1
    if [ -s "$stdout_file" ]; then
        jq -e '.hookSpecificOutput.permissionDecision == "deny"' "$stdout_file" >/dev/null 2>&1 || return 1
        printf 'deny'
    else
        printf 'allow'
    fi
}

assert_pair_decision() {
    local expected="$1" command="$2"
    local claude_payload codex_payload
    local claude_out claude_err codex_out codex_err
    local claude_exit=0 codex_exit=0 claude_decision codex_decision

    RUN_NUMBER=$((RUN_NUMBER + 1))
    claude_out="$RUN_DIR/claude-$RUN_NUMBER.out"
    claude_err="$RUN_DIR/claude-$RUN_NUMBER.err"
    codex_out="$RUN_DIR/codex-$RUN_NUMBER.out"
    codex_err="$RUN_DIR/codex-$RUN_NUMBER.err"
    claude_payload=$(jq -nc --arg cwd "$REPO" --arg command "$command" \
        '{cwd:$cwd,tool_input:{command:$command}}')
    codex_payload=$(jq -nc --arg cwd "$REPO" --arg command "$command" \
        '{cwd:$cwd,tool_name:"Bash",tool_input:{command:$command}}')

    if printf '%s' "$claude_payload" | bash "$CLAUDE_HOOK" >"$claude_out" 2>"$claude_err"; then
        claude_exit=0
    else
        claude_exit=$?
    fi
    if printf '%s' "$codex_payload" | bash "$CODEX_HOOK" >"$codex_out" 2>"$codex_err"; then
        codex_exit=0
    else
        codex_exit=$?
    fi

    claude_decision=$(normalize_claude_decision "$claude_exit" "$claude_err") || {
        echo "Claude result was not a valid decision (exit=$claude_exit, command=$command)" >&2
        return 1
    }
    codex_decision=$(normalize_codex_decision "$codex_exit" "$codex_out") || {
        echo "Codex result was not a valid decision (exit=$codex_exit, command=$command)" >&2
        return 1
    }
    if [ "$claude_decision" != "$codex_decision" ] || [ "$claude_decision" != "$expected" ]; then
        echo "Decision mismatch (expected=$expected, Claude=$claude_decision, Codex=$codex_decision, command=$command)" >&2
        return 1
    fi
}

test_staged_new_omt_path_denies_in_both_adapters() {
    printf 'citation: $OMT_DIR/session.md\n' >> "$REPO/docs/notes.md"
    git -C "$REPO" add docs/notes.md
    assert_pair_decision deny 'git commit -m "add notes"' || return 1
    git -C "$REPO" reset -q HEAD -- docs/notes.md
    git -C "$REPO" checkout -q -- docs/notes.md
}

test_gh_pr_body_untracked_path_denies_in_both_adapters() {
    assert_pair_decision deny 'gh pr create --body "See docs/untracked.md"'
}

test_target_curl_payloads_deny_in_both_adapters() {
    local host command
    for host in \
        'https://api.notion.com/v1/pages' \
        'https://slack.com/api/chat.postMessage' \
        'https://api.linear.app/graphql'; do
        command="curl -X POST $host --data '{\"text\":\"See docs/untracked.md\"}'"
        assert_pair_decision deny "$command" || return 1
    done
}

test_placeholder_nonexistent_and_external_url_allow_in_both_adapters() {
    local command
    for command in \
        'gh pr create --body "See $OMT_DIR/deep-interview/{slug}.md"' \
        "gh pr create --body 'See $REPO/no-such-concrete-file.md'" \
        'gh pr create --body "See https://example.com/reference"'; do
        assert_pair_decision allow "$command" || return 1
    done
}

test_existing_old_violation_with_safe_staged_line_allows_in_both_adapters() {
    printf 'old citation: $OMT_DIR/session.md\n' > "$REPO/docs/old.md"
    git -C "$REPO" add docs/old.md
    git -C "$REPO" commit -q -m 'old citation fixture'
    printf 'safe new line\n' >> "$REPO/docs/old.md"
    git -C "$REPO" add docs/old.md
    assert_pair_decision allow 'git commit -m "unrelated edit"'
}

run_test test_staged_new_omt_path_denies_in_both_adapters
run_test test_gh_pr_body_untracked_path_denies_in_both_adapters
run_test test_target_curl_payloads_deny_in_both_adapters
run_test test_placeholder_nonexistent_and_external_url_allow_in_both_adapters
run_test test_existing_old_violation_with_safe_staged_line_allows_in_both_adapters

echo "Passed: $TESTS_PASSED, Failed: $TESTS_FAILED"
[ "$TESTS_FAILED" -eq 0 ]

#!/bin/bash
# Codex PreToolUse local-path reference gate tests.
#
# This fixture exercises the Codex envelope and all shell/MCP extraction routes
# without ever executing the inspected command.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$SCRIPT_DIR/codex-local-path-ref-gate.sh"
REPO="$(mktemp -d)"
HOME="$REPO/home"
OMT_DIR="$REPO/omt"
export HOME OMT_DIR
mkdir -p "$HOME" "$OMT_DIR" "$REPO/docs"
trap 'rm -rf "$REPO"' EXIT

git -C "$REPO" init -q
git -C "$REPO" config user.email test@example.invalid
git -C "$REPO" config user.name test
printf 'session state\n' > "$OMT_DIR/session.md"
printf 'untracked fixture\n' > "$REPO/docs/untracked.md"
printf 'png fixture\n' > "$REPO/docs/untracked.png"
printf 'safe baseline\n' > "$REPO/docs/notes.md"
git -C "$REPO" add docs/notes.md
git -C "$REPO" commit -q -m baseline

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

run_payload() {
    local payload="$1" exit_code=0
    RUN_OUTPUT=""
    RUN_OUTPUT=$(printf '%s' "$payload" | bash "$HOOK") || exit_code=$?
    RUN_EXIT=$exit_code
}

shell_payload() {
    local tool_name="$1" command="$2"
    jq -nc --arg cwd "$REPO" --arg t "$tool_name" --arg c "$command" \
        '{cwd:$cwd,tool_name:$t,tool_input:{command:$c}}'
}

assert_codex_deny() {
    local output="$1"
    [ "$RUN_EXIT" -eq 0 ] || return 1
    printf '%s' "$output" | jq -e \
        '.hookSpecificOutput.hookEventName == "PreToolUse" and .hookSpecificOutput.permissionDecision == "deny"' \
        >/dev/null || return 1
    printf '%s' "$output" | grep -F 'deleting the citation alone is forbidden' >/dev/null || return 1
}

test_hook_sources_core_and_strict_mode() {
    grep -qF '# omt-hook-dep: local-path-ref-gate-core.sh' "$HOOK" || return 1
    grep -qF 'source "$SCRIPT_DIR/local-path-ref-gate-core.sh"' "$HOOK" || return 1
    grep -Eq '^set -euo pipefail$' "$HOOK"
}

test_all_shell_spellings_deny_staged_added_omt_reference() {
    printf 'citation: $OMT_DIR/session.md\n' >> "$REPO/docs/notes.md"
    git -C "$REPO" add docs/notes.md

    local tool_name payload
    for tool_name in Bash bash exec_command shell_command; do
        payload=$(shell_payload "$tool_name" 'git commit -m "add notes"')
        run_payload "$payload"
        assert_codex_deny "$RUN_OUTPUT" || return 1
        printf '%s' "$RUN_OUTPUT" | grep -F 'docs/notes.md:2' >/dev/null || return 1
        printf '%s' "$RUN_OUTPUT" | grep -F 'machine-local-untracked' >/dev/null || return 1
        printf '%s' "$RUN_OUTPUT" | grep -F 'inline a summary or copy the file into the repository' >/dev/null || return 1
    done

    git -C "$REPO" reset -q HEAD -- docs/notes.md
    git -C "$REPO" checkout -q -- docs/notes.md
}

test_shell_command_key_fallback_and_gh_body_routes() {
    local tool_name payload command
    for tool_name in Bash bash exec_command shell_command; do
        command='gh pr create --body "See docs/untracked.md"'
        payload=$(jq -nc --arg cwd "$REPO" --arg t "$tool_name" --arg c "$command" \
            '{cwd:$cwd,tool_name:$t,tool_input:{cmd:$c}}')
        run_payload "$payload"
        assert_codex_deny "$RUN_OUTPUT" || return 1
        printf '%s' "$RUN_OUTPUT" | grep -F 'docs/untracked.md' >/dev/null || return 1

        payload=$(shell_payload "$tool_name" 'gh pr edit 123 --body "See docs/untracked.md"')
        run_payload "$payload"
        assert_codex_deny "$RUN_OUTPUT" || return 1
    done
}

test_gh_body_file_routes_read_file_content() {
    local body_file="$REPO/pr-body.md" tool_name payload command
    printf 'See docs/untracked.md\n' > "$body_file"
    for tool_name in Bash bash exec_command shell_command; do
        for command in \
            "gh pr create --body-file '$body_file'" \
            "gh pr edit 123 --body-file=\"$body_file\""; do
            payload=$(shell_payload "$tool_name" "$command")
            run_payload "$payload"
            assert_codex_deny "$RUN_OUTPUT" || return 1
            printf '%s' "$RUN_OUTPUT" | grep -F 'docs/untracked.md' >/dev/null || return 1
        done
    done
}

test_target_curl_payloads_deny() {
    local host command payload tool_name
    for host in \
        'https://api.notion.com/v1/pages' \
        'https://slack.com/api/chat.postMessage' \
        'https://api.linear.app/graphql'; do
        command="curl -X POST $host --data '{\"text\":\"See docs/untracked.md\"}'"
        for tool_name in Bash bash exec_command shell_command; do
            payload=$(jq -nc --arg cwd "$REPO" --arg t "$tool_name" --arg command "$command" \
                '{cwd:$cwd,tool_name:$t,tool_input:{command:$command}}')
            run_payload "$payload"
            assert_codex_deny "$RUN_OUTPUT" || return 1
            printf '%s' "$RUN_OUTPUT" | grep -F 'docs/untracked.md' >/dev/null || return 1
        done
    done
}

test_target_curl_inspects_every_data_payload_and_readable_at_file() {
    local host command payload tool_name payload_file
    payload_file="$REPO/outgoing.json"
    printf '{"text":"See docs/untracked.md"}\n' > "$payload_file"
    for host in \
        'https://api.notion.com/v1/pages' \
        'https://slack.com/api/chat.postMessage' \
        'https://api.linear.app/graphql'; do
        command="curl -X POST $host --data '{\"text\":\"safe\"}' --data-raw '{\"text\":\"See docs/untracked.md\"}'"
        for tool_name in Bash bash exec_command shell_command; do
            payload=$(jq -nc --arg cwd "$REPO" --arg t "$tool_name" --arg command "$command" \
                '{cwd:$cwd,tool_name:$t,tool_input:{command:$command}}')
            run_payload "$payload"
            assert_codex_deny "$RUN_OUTPUT" || return 1
            printf '%s' "$RUN_OUTPUT" | grep -F 'docs/untracked.md' >/dev/null || return 1

            command="curl -X POST $host --data @$payload_file"
            payload=$(jq -nc --arg cwd "$REPO" --arg t "$tool_name" --arg command "$command" \
                '{cwd:$cwd,tool_name:$t,tool_input:{command:$command}}')
            run_payload "$payload"
            assert_codex_deny "$RUN_OUTPUT" || return 1
            printf '%s' "$RUN_OUTPUT" | grep -F 'docs/untracked.md' >/dev/null || return 1
        done
    done
}

test_target_curl_multipart_attachments_deny() {
    local host command payload tool_name
    for host in \
        'https://api.notion.com/v1/pages' \
        'https://slack.com/api/chat.postMessage' \
        'https://api.linear.app/graphql'; do
        for command in \
            "curl -X POST $host -F 'file=@docs/untracked.png'" \
            "curl -X POST $host --form \"file=@docs/untracked.png\""; do
            for tool_name in Bash bash exec_command shell_command; do
                payload=$(jq -nc --arg cwd "$REPO" --arg t "$tool_name" --arg command "$command" \
                    '{cwd:$cwd,tool_name:$t,tool_input:{command:$command}}')
                run_payload "$payload"
                assert_codex_deny "$RUN_OUTPUT" || return 1
                printf '%s' "$RUN_OUTPUT" | grep -F 'docs/untracked.png' >/dev/null || return 1
                printf '%s' "$RUN_OUTPUT" | grep -F 'machine-local-untracked' >/dev/null || return 1
            done
        done
    done
}

test_target_curl_multipart_missing_attachment_fails_open() {
    local command payload
    command='curl -X POST https://api.notion.com/v1/pages -F "file=@docs/missing.png"'
    payload=$(jq -nc --arg cwd "$REPO" --arg command "$command" \
        '{cwd:$cwd,tool_name:"Bash",tool_input:{command:$command}}')
    run_payload "$payload"
    [ "$RUN_EXIT" -eq 0 ] && [ -z "$RUN_OUTPUT" ]
}

test_mcp_argument_strings_deny() {
    local tool_name payload
    for tool_name in mcp__notion__create mcp__slack__send mcp__linear__create; do
        payload=$(jq -nc --arg cwd "$REPO" --arg t "$tool_name" \
            '{cwd:$cwd,tool_name:$t,tool_input:{body:{text:"See docs/untracked.md"},nested:["safe",{"detail":"docs/untracked.md"}]}}')
        run_payload "$payload"
        assert_codex_deny "$RUN_OUTPUT" || return 1
        printf '%s' "$RUN_OUTPUT" | grep -F 'docs/untracked.md' >/dev/null || return 1
    done
}

test_allow_safe_and_fail_open_shapes() {
    local command payload
    for command in \
        'gh pr create --body "See $OMT_DIR/deep-interview/{slug}.md"' \
        "gh pr create --body 'See $REPO/no-such-concrete-file.md'" \
        'gh pr create --body "See https://example.com/reference"'; do
        payload=$(shell_payload bash "$command")
        run_payload "$payload"
        [ "$RUN_EXIT" -eq 0 ] && [ -z "$RUN_OUTPUT" ] || return 1
    done

    for payload in \
        '{"tool_name":"bash","tool_input":{"command":{}}}' \
        '{"tool_name":"bash","tool_input":{"command":"git status"}' \
        '{"tool_name":"read","tool_input":{}}' \
        '{"tool_name":"mcp__notion__create","tool_input":{"body":42}}'; do
        run_payload "$payload"
        [ "$RUN_EXIT" -eq 0 ] && [ -z "$RUN_OUTPUT" ] || return 1
    done
}

test_old_untouched_violation_allows() {
    printf 'old citation: $OMT_DIR/session.md\n' > "$REPO/docs/old.md"
    git -C "$REPO" add docs/old.md
    git -C "$REPO" commit -q -m 'old citation fixture'
    printf 'unrelated new line\n' >> "$REPO/docs/old.md"
    git -C "$REPO" add docs/old.md
    run_payload "$(shell_payload bash 'git commit -m "unrelated edit"')"
    [ "$RUN_EXIT" -eq 0 ] && [ -z "$RUN_OUTPUT" ]
}

test_inspected_command_is_never_executed() {
    local marker="$REPO/command-was-executed" payload
    payload=$(jq -nc --arg cwd "$REPO" --arg marker "$marker" \
        --arg command 'gh pr create --body "See docs/untracked.md"; touch __MARKER__' \
        '{cwd:$cwd,tool_name:"bash",tool_input:{command:($command | gsub("__MARKER__";$marker))}}')
    run_payload "$payload"
    assert_codex_deny "$RUN_OUTPUT" || return 1
    [ ! -e "$marker" ]
}

test_missing_jq_core_and_failed_inspection_allow() {
    local no_jq="$REPO/no-jq-bin" tmp_hook="$REPO/no-core-hook" payload
    mkdir -p "$no_jq"
    payload=$(shell_payload bash 'gh pr create --body "See docs/untracked.md"')
    RUN_EXIT=0
    RUN_OUTPUT=$(printf '%s' "$payload" | PATH="$no_jq" /bin/bash "$HOOK" 2>/dev/null) || RUN_EXIT=$?
    [ "${RUN_EXIT:-0}" -eq 0 ] && [ -z "$RUN_OUTPUT" ] || return 1

    mkdir -p "$tmp_hook"
    cp "$HOOK" "$tmp_hook/"
    RUN_EXIT=0
    RUN_OUTPUT=$(printf '%s' "$payload" | /bin/bash "$tmp_hook/codex-local-path-ref-gate.sh") || RUN_EXIT=$?
    [ "$RUN_EXIT" -eq 0 ] && [ -z "$RUN_OUTPUT" ] || return 1

    RUN_EXIT=0
    payload=$(jq -nc --arg cwd "$REPO/no-such-directory" \
        '{cwd:$cwd,tool_name:"bash",tool_input:{command:"gh pr create --body \\\"See docs/untracked.md\\\""}}')
    RUN_OUTPUT=$(printf '%s' "$payload" | /bin/bash "$HOOK" 2>/dev/null) || RUN_EXIT=$?
    [ "$RUN_EXIT" -eq 0 ] && [ -z "$RUN_OUTPUT" ]
}

test_yaml_registers_full_matcher() {
    grep -F 'component: codex-local-path-ref-gate.sh' "$SCRIPT_DIR/../codex.yaml" >/dev/null || return 1
    grep -F 'matcher: "Bash|bash|exec_command|shell_command|mcp__notion__.*|mcp__slack__.*|mcp__linear__.*"' \
        "$SCRIPT_DIR/../codex.yaml" >/dev/null
}

main() {
    run_test test_hook_sources_core_and_strict_mode
    run_test test_all_shell_spellings_deny_staged_added_omt_reference
    run_test test_shell_command_key_fallback_and_gh_body_routes
    run_test test_gh_body_file_routes_read_file_content
    run_test test_target_curl_payloads_deny
    run_test test_target_curl_inspects_every_data_payload_and_readable_at_file
    run_test test_target_curl_multipart_attachments_deny
    run_test test_target_curl_multipart_missing_attachment_fails_open
    run_test test_mcp_argument_strings_deny
    run_test test_allow_safe_and_fail_open_shapes
    run_test test_old_untouched_violation_allows
    run_test test_inspected_command_is_never_executed
    run_test test_missing_jq_core_and_failed_inspection_allow
    run_test test_yaml_registers_full_matcher
    echo "Passed: $TESTS_PASSED, Failed: $TESTS_FAILED"
    [ "$TESTS_FAILED" -eq 0 ]
}

main "$@"

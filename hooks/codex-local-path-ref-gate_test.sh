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

shell_payload_with_workdir() {
    local workdir="$1" command="$2"
    jq -nc --arg cwd "$REPO" --arg workdir "$workdir" --arg command "$command" \
        '{cwd:$cwd,tool_name:"bash",tool_input:{workdir:$workdir,command:$command}}'
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

test_git_commit_scans_dash_c_target_and_compound_target() {
    local target="$REPO/other-repo" payload command
    mkdir -p "$target/docs"
    git -C "$target" init -q
    git -C "$target" config user.email test@example.invalid
    git -C "$target" config user.name test
    printf 'baseline\n' > "$target/docs/notes.md"
    git -C "$target" add docs/notes.md
    git -C "$target" commit -q -m baseline
    printf 'citation: $OMT_DIR/session.md\n' >> "$target/docs/notes.md"
    git -C "$target" add docs/notes.md

    for command in \
        "git -C '$target' commit -m target" \
        "git -C'$target' commit -m target" \
        "git status && git -C '$target' commit -m target"; do
        payload=$(shell_payload bash "$command")
        run_payload "$payload"
        assert_codex_deny "$RUN_OUTPUT" || return 1
        printf '%s' "$RUN_OUTPUT" | grep -F 'docs/notes.md:2' >/dev/null || return 1
    done
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

test_gh_short_body_flag_and_escaped_quotes_deny() {
    local command payload
    command='gh pr create -b "See \"docs/untracked.md\""'
    payload=$(shell_payload bash "$command")
    run_payload "$payload"
    assert_codex_deny "$RUN_OUTPUT" || return 1
    printf '%s' "$RUN_OUTPUT" | grep -F 'docs/untracked.md' >/dev/null || return 1
}

test_gh_body_at_mention_and_short_body_file_deny() {
    local body_file="$REPO/gh-body.md" command payload
    printf 'See docs/untracked.md\n' > "$body_file"
    for command in \
        'gh pr comment 12 --body "@team See docs/untracked.md"' \
        "gh pr create -F '$body_file'"; do
        payload=$(shell_payload bash "$command")
        run_payload "$payload"
        assert_codex_deny "$RUN_OUTPUT" || return 1
        printf '%s' "$RUN_OUTPUT" | grep -F 'docs/untracked.md' >/dev/null || return 1
    done
}

test_quoted_separators_do_not_create_fake_gh_or_curl_commands() {
    local command payload
    for command in \
        'printf '\''safe; gh pr create --body "See docs/untracked.md"'\''' \
        'printf '\''safe && curl https://api.notion.com/v1/pages --data "{\\"text\\":\\"See docs/untracked.md\\"}"'\'''; do
        payload=$(shell_payload bash "$command")
        run_payload "$payload"
        [ "$RUN_EXIT" -eq 0 ] && [ -z "$RUN_OUTPUT" ] || return 1
    done
}

test_gh_compound_commands_inspect_later_create_edit_and_comment_bodies() {
    local command payload
    for command in \
        'gh pr create --body "safe" && gh pr edit 12 --body "See docs/untracked.md"' \
        'gh pr create --body "safe"; gh pr comment 12 --body "See docs/untracked.md"'; do
        payload=$(shell_payload bash "$command")
        run_payload "$payload"
        assert_codex_deny "$RUN_OUTPUT" || return 1
        printf '%s' "$RUN_OUTPUT" | grep -F 'docs/untracked.md' >/dev/null || return 1
    done
}

test_newline_separators_inspect_later_gh_and_curl_commands() {
    local command payload
    for command in \
        $'printf safe\ngh pr create --body "See docs/untracked.md"' \
        $'printf safe\ncurl -X POST https://api.notion.com/v1/pages --data \'{"text":"See docs/untracked.md"}\''; do
        payload=$(shell_payload bash "$command")
        run_payload "$payload"
        assert_codex_deny "$RUN_OUTPUT" || return 1
        printf '%s' "$RUN_OUTPUT" | grep -F 'docs/untracked.md' >/dev/null || return 1
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

test_gh_global_repo_flags_and_attached_body_equals_deny() {
    local body_file="$REPO/gh-global-body.md" command payload
    printf 'See docs/untracked.md\n' > "$body_file"
    for command in \
        'gh --repo owner/repo pr create -b="See docs/untracked.md"' \
        'gh -R owner/repo pr create --body="See docs/untracked.md"' \
        "gh --repo=owner/repo pr create -F='$body_file'" \
        "gh -R owner/repo pr create -F='$body_file'"; do
        payload=$(shell_payload bash "$command")
        run_payload "$payload"
        assert_codex_deny "$RUN_OUTPUT" || return 1
        printf '%s' "$RUN_OUTPUT" | grep -F 'docs/untracked.md' >/dev/null || return 1
    done
}

test_leading_env_assignments_route_gh_and_curl() {
    local command payload
    for command in \
        'GH_PAGER=cat gh pr create --body "See docs/untracked.md"' \
        'CURL_VERBOSE=0 curl -X POST https://api.notion.com/v1/pages --data "{\"text\":\"See docs/untracked.md\"}"'; do
        payload=$(shell_payload bash "$command")
        run_payload "$payload"
        assert_codex_deny "$RUN_OUTPUT" || return 1
        printf '%s' "$RUN_OUTPUT" | grep -F 'docs/untracked.md' >/dev/null || return 1
    done
}

test_shell_cwd_relative_payload_classification() {
    local command payload
    mkdir -p "$REPO/subdir/docs"
    printf 'local fixture\n' > "$REPO/subdir/docs/local.md"

    command='cd subdir && gh pr create --body "See docs/local.md"'
    payload=$(shell_payload bash "$command")
    run_payload "$payload"
    assert_codex_deny "$RUN_OUTPUT" || return 1
    printf '%s' "$RUN_OUTPUT" | grep -F 'docs/local.md' >/dev/null || return 1

    command='cd subdir && curl -X POST https://api.notion.com/v1/pages --data "{\"text\":\"See docs/local.md\"}"'
    payload=$(shell_payload bash "$command")
    run_payload "$payload"
    assert_codex_deny "$RUN_OUTPUT" || return 1
    printf '%s' "$RUN_OUTPUT" | grep -F 'docs/local.md' >/dev/null || return 1
}

test_shell_cwd_fallback_preserves_spaces_and_colons() {
    local command payload
    mkdir -p "$REPO/subdir/docs"
    printf 'local fixture\n' > "$REPO/subdir/docs/local file:with-colon.md"

    command='cd subdir && gh pr create --body "See docs/local file:with-colon.md"'
    payload=$(shell_payload bash "$command")
    run_payload "$payload"
    assert_codex_deny "$RUN_OUTPUT" || return 1
    printf '%s' "$RUN_OUTPUT" | grep -F 'docs/local file:with-colon.md' >/dev/null || return 1

    command='cd subdir && curl -X POST https://api.notion.com/v1/pages --data "{\"text\":\"See docs/local file:with-colon.md\"}"'
    payload=$(shell_payload bash "$command")
    run_payload "$payload"
    assert_codex_deny "$RUN_OUTPUT" || return 1
    printf '%s' "$RUN_OUTPUT" | grep -F 'docs/local file:with-colon.md' >/dev/null || return 1
}

test_shell_cwd_fallback_detects_extensionless_file() {
    local command payload
    mkdir -p "$REPO/subdir"
    printf 'extensionless fixture\n' > "$REPO/subdir/private"

    command='cd subdir && gh pr create --body "See private"'
    payload=$(shell_payload bash "$command")
    run_payload "$payload"
    assert_codex_deny "$RUN_OUTPUT" || return 1
    printf '%s' "$RUN_OUTPUT" | grep -F 'private' >/dev/null || return 1

    command='cd subdir && curl -X POST https://api.notion.com/v1/pages --data "See private"'
    payload=$(shell_payload bash "$command")
    run_payload "$payload"
    assert_codex_deny "$RUN_OUTPUT" || return 1
    printf '%s' "$RUN_OUTPUT" | grep -F 'private' >/dev/null
}

test_gh_and_curl_paths_follow_shell_cd() {
    local command payload
    mkdir -p "$REPO/subdir/docs"
    printf 'See docs/untracked.md\n' > "$REPO/subdir/docs/cd-body.md"
    command="cd subdir && gh pr create --body-file docs/cd-body.md"
    payload=$(shell_payload bash "$command")
    run_payload "$payload"
    assert_codex_deny "$RUN_OUTPUT" || return 1
    printf '%s' "$RUN_OUTPUT" | grep -F 'docs/untracked.md' >/dev/null || return 1

    command='cd subdir && curl -X POST https://api.notion.com/v1/pages -F file=@docs/cd-body.md'
    payload=$(shell_payload bash "$command")
    run_payload "$payload"
    assert_codex_deny "$RUN_OUTPUT" || return 1
    printf '%s' "$RUN_OUTPUT" | grep -F 'docs/cd-body.md' >/dev/null || return 1
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

test_target_curl_api_root_endpoints_deny() {
    local host command payload
    for host in \
        'https://api.notion.com' \
        'https://slack.com/api' \
        'https://api.linear.app' \
        'https://linear.app/api'; do
        command="curl -X POST $host --data '{\"text\":\"See docs/untracked.md\"}'"
        payload=$(shell_payload bash "$command")
        run_payload "$payload"
        assert_codex_deny "$RUN_OUTPUT" || return 1
        printf '%s' "$RUN_OUTPUT" | grep -F 'docs/untracked.md' >/dev/null || return 1
    done
}

test_target_curl_root_query_and_fragment_deny() {
    local command payload
    for command in \
        'curl -X POST "https://api.notion.com?source=test" --data "{\"text\":\"See docs/untracked.md\"}"' \
        'curl -X POST "https://api.notion.com#fragment" --data "{\"text\":\"See docs/untracked.md\"}"'; do
        payload=$(shell_payload bash "$command")
        run_payload "$payload"
        assert_codex_deny "$RUN_OUTPUT" || return 1
    done
}

test_target_curl_json_payload_deny() {
    local command payload
    command='curl -X POST https://api.notion.com/v1/pages --json "{\"text\":\"See docs/untracked.md\"}"'
    payload=$(shell_payload bash "$command")
    run_payload "$payload"
    assert_codex_deny "$RUN_OUTPUT" || return 1
    printf '%s' "$RUN_OUTPUT" | grep -F 'docs/untracked.md' >/dev/null || return 1
}

test_target_curl_attached_json_payload_deny() {
    local command payload
    command='curl -X POST https://api.notion.com/v1/pages --json="{\"text\":\"See docs/untracked.md\"}"'
    payload=$(shell_payload bash "$command")
    run_payload "$payload"
    assert_codex_deny "$RUN_OUTPUT" || return 1
    printf '%s' "$RUN_OUTPUT" | grep -F 'docs/untracked.md' >/dev/null || return 1
}

test_target_curl_case_normalized_hosts_and_webhook() {
    local host command payload
    for host in \
        'HTTPS://API.NOTION.COM/V1/PAGES' \
        'HTTPS://SLACK.COM/API/CHAT.POSTMESSAGE' \
        'HTTPS://HOOKS.SLACK.COM/SERVICES/T000/B000/XXX' \
        'HTTPS://API.LINEAR.APP/GRAPHQL' \
        'HTTPS://LINEAR.APP/API'; do
        command="curl -X POST $host --data '{\"text\":\"See docs/untracked.md\"}'"
        payload=$(shell_payload bash "$command")
        run_payload "$payload"
        assert_codex_deny "$RUN_OUTPUT" || return 1
        printf '%s' "$RUN_OUTPUT" | grep -F 'docs/untracked.md' >/dev/null || return 1
    done
}

test_missing_payload_segment_does_not_hide_later_segment() {
    local command payload
    for command in \
        'gh pr create --body-file docs/missing-gh.md; gh pr create --body "See docs/untracked.md"' \
        'gh pr create --body -; gh pr create --body "See docs/untracked.md"' \
        'curl -X POST https://api.notion.com/v1/pages --data @docs/missing-curl.json; curl -X POST https://api.notion.com/v1/pages --data "{\"text\":\"See docs/untracked.md\"}"' \
        'curl -X POST https://api.notion.com/v1/pages --data -; curl -X POST https://api.notion.com/v1/pages --data "{\"text\":\"See docs/untracked.md\"}"'; do
        payload=$(shell_payload bash "$command")
        run_payload "$payload"
        assert_codex_deny "$RUN_OUTPUT" || return 1
        printf '%s' "$RUN_OUTPUT" | grep -F 'docs/untracked.md' >/dev/null || return 1
    done
}

test_unreadable_payload_does_not_hide_later_payload_option() {
    local command payload
    for command in \
        'gh pr create --body-file docs/missing-gh.md --body "See docs/untracked.md"' \
        'curl -X POST https://api.notion.com/v1/pages --data @docs/missing-curl.json --data-raw "{\"text\":\"See docs/untracked.md\"}"'; do
        payload=$(shell_payload bash "$command")
        run_payload "$payload"
        assert_codex_deny "$RUN_OUTPUT" || return 1
        printf '%s' "$RUN_OUTPUT" | grep -F 'docs/untracked.md' >/dev/null || return 1
    done
}

test_target_curl_form_string_payload_deny() {
    local command payload
    command='curl -X POST https://api.notion.com/v1/pages --form-string "text=See docs/untracked.md"'
    payload=$(shell_payload bash "$command")
    run_payload "$payload"
    assert_codex_deny "$RUN_OUTPUT" || return 1
    printf '%s' "$RUN_OUTPUT" | grep -F 'docs/untracked.md' >/dev/null
}

test_target_curl_equals_url_routes_payload() {
    local command payload
    command='curl --url=https://api.notion.com/v1/pages --data "{\"text\":\"See docs/untracked.md\"}"'
    payload=$(shell_payload bash "$command")
    run_payload "$payload"
    assert_codex_deny "$RUN_OUTPUT" || return 1
    printf '%s' "$RUN_OUTPUT" | grep -F 'docs/untracked.md' >/dev/null
}

test_target_curl_explicit_ports_and_multipart_text_content_deny() {
    local form_file="$REPO/form-body.txt" command payload
    printf 'See docs/untracked.md\n' > "$form_file"
    for command in \
        'curl -X POST https://api.notion.com:443/v1/pages --data "{\"text\":\"See docs/untracked.md\"}"' \
        'curl -X POST https://slack.com:443/api/chat.postMessage -F "text=See docs/untracked.md"' \
        'curl -X POST https://hooks.slack.com/services/T000/B000/XXX --data "{\"text\":\"See docs/untracked.md\"}"' \
        'curl -X POST https://hooks.slack.com:443/services/T000/B000/XXX --data "{\"text\":\"See docs/untracked.md\"}"' \
        "curl -X POST https://api.linear.app:443/graphql -F 'text=<$form_file'"; do
        payload=$(shell_payload bash "$command")
        run_payload "$payload"
        assert_codex_deny "$RUN_OUTPUT" || return 1
        printf '%s' "$RUN_OUTPUT" | grep -F 'docs/untracked.md' >/dev/null || return 1
    done
}

test_target_curl_escaped_quotes_deny() {
    local command payload
    command='curl -X POST https://api.notion.com/v1/pages --data "{\"text\":\"See docs/untracked.md\"}"'
    payload=$(shell_payload bash "$command")
    run_payload "$payload"
    assert_codex_deny "$RUN_OUTPUT" || return 1
    printf '%s' "$RUN_OUTPUT" | grep -F 'docs/untracked.md' >/dev/null || return 1
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

test_target_curl_attached_short_options_deny() {
    local host command payload payload_file="$REPO/attached-data.json"
    printf '{"text":"See docs/untracked.md"}\n' > "$payload_file"
    for host in \
        'https://api.notion.com/v1/pages' \
        'https://slack.com/api/chat.postMessage' \
        'https://api.linear.app/graphql'; do
        for command in \
            "curl -X POST $host -d'{\"text\":\"See docs/untracked.md\"}'" \
            "curl -X POST $host -d@$payload_file" \
            "curl -X POST $host -Ffile=@docs/untracked.png"; do
            payload=$(shell_payload bash "$command")
            run_payload "$payload"
            assert_codex_deny "$RUN_OUTPUT" || return 1
        done
    done
}

test_target_curl_upload_file_deny() {
    local command payload
    for command in \
        'curl -X POST https://api.notion.com/v1/pages --upload-file docs/untracked.png' \
        'curl -X POST https://api.notion.com/v1/pages -Tdocs/untracked.png'; do
        payload=$(shell_payload bash "$command")
        run_payload "$payload"
        assert_codex_deny "$RUN_OUTPUT" || return 1
        printf '%s' "$RUN_OUTPUT" | grep -F 'docs/untracked.png' >/dev/null || return 1
    done
}

test_non_target_curl_payload_url_allows() {
    local payload
    payload=$(shell_payload bash 'curl https://example.invalid --data "https://api.notion.com/v1/pages See docs/untracked.md"')
    run_payload "$payload"
    [ "$RUN_EXIT" -eq 0 ] && [ -z "$RUN_OUTPUT" ]
}

test_target_curl_data_urlencode_name_at_file_reads_content() {
    local payload_file="$REPO/urlencoded.txt" command payload
    printf 'See docs/untracked.md\n' > "$payload_file"
    command="curl -X POST https://api.notion.com/v1/pages --data-urlencode message@$payload_file"
    payload=$(shell_payload bash "$command")
    run_payload "$payload"
    assert_codex_deny "$RUN_OUTPUT" || return 1
    printf '%s' "$RUN_OUTPUT" | grep -F 'docs/untracked.md' >/dev/null || return 1
}

test_target_curl_data_urlencode_missing_file_fails_open() {
    local command payload
    command='curl -X POST https://api.notion.com/v1/pages --data-urlencode message@docs/missing.txt'
    payload=$(shell_payload bash "$command")
    run_payload "$payload"
    [ "$RUN_EXIT" -eq 0 ] && [ -z "$RUN_OUTPUT" ]
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

test_target_curl_multipart_relative_workdir_deny() {
    local command payload
    mkdir -p "$REPO/subdir/docs"
    printf 'png fixture\n' > "$REPO/subdir/docs/workdir.png"
    command='curl -X POST https://api.notion.com/v1/pages -F file=@docs/workdir.png'
    payload=$(shell_payload_with_workdir 'subdir' "$command")
    run_payload "$payload"
    assert_codex_deny "$RUN_OUTPUT" || return 1
    printf '%s' "$RUN_OUTPUT" | grep -F 'docs/workdir.png' >/dev/null || return 1
}

test_target_curl_multipart_missing_attachment_fails_open() {
    local command payload
    command='curl -X POST https://api.notion.com/v1/pages -F "file=@docs/missing.png"'
    payload=$(jq -nc --arg cwd "$REPO" --arg command "$command" \
        '{cwd:$cwd,tool_name:"Bash",tool_input:{command:$command}}')
    run_payload "$payload"
    [ "$RUN_EXIT" -eq 0 ] && [ -z "$RUN_OUTPUT" ]
}

test_git_commit_expands_home_in_dash_c_target() {
    local target="$HOME/target-repo" payload
    mkdir -p "$target/docs"
    git -C "$target" init -q
    git -C "$target" config user.email test@example.invalid
    git -C "$target" config user.name test
    printf 'baseline\n' > "$target/docs/notes.md"
    git -C "$target" add docs/notes.md
    git -C "$target" commit -q -m baseline
    printf 'citation: $OMT_DIR/session.md\n' >> "$target/docs/notes.md"
    git -C "$target" add docs/notes.md
    payload=$(shell_payload bash 'git -C "$HOME/target-repo" commit -m target')
    run_payload "$payload"
    assert_codex_deny "$RUN_OUTPUT"
}

test_git_repeated_dash_c_cd_and_later_valid_segment_deny() {
    local target="$REPO/repeated-repo" payload command
    mkdir -p "$target/docs"
    git -C "$target" init -q
    git -C "$target" config user.email test@example.invalid
    git -C "$target" config user.name test
    printf 'baseline\n' > "$target/docs/notes.md"
    git -C "$target" add docs/notes.md
    git -C "$target" commit -q -m baseline
    printf 'citation: $OMT_DIR/session.md\n' >> "$target/docs/notes.md"
    git -C "$target" add docs/notes.md

    for command in \
        'git -C repeated-repo -C . commit -m repeated' \
        'cd repeated-repo && git commit -m cd-target' \
        "git -C missing commit -m bad; git -C '$target' commit -m later"; do
        payload=$(shell_payload bash "$command")
        run_payload "$payload"
        assert_codex_deny "$RUN_OUTPUT" || return 1
        printf '%s' "$RUN_OUTPUT" | grep -F 'docs/notes.md:2' >/dev/null || return 1
    done
}

test_git_commit_detects_staged_path_with_spaces() {
    local secret_dir="$HOME/local dir" payload
    mkdir -p "$secret_dir"
    printf 'local secret\n' > "$secret_dir/secret.md"
    printf '~/local dir/secret.md\n' >> "$REPO/docs/notes.md"
    git -C "$REPO" add docs/notes.md
    payload=$(shell_payload bash 'git commit -m spaces')
    run_payload "$payload"
    assert_codex_deny "$RUN_OUTPUT" || return 1
    git -C "$REPO" reset -q HEAD -- docs/notes.md
    git -C "$REPO" checkout -q -- docs/notes.md
}

test_mcp_outbound_write_argument_strings_deny() {
    local tool_name payload
    for tool_name in \
        mcp__notion__notion_append_block_children \
        mcp__notion__notion_archive_page \
        mcp__notion__notion_update_page \
        mcp__notion__notion_update_block \
        mcp__notion__notion_update_comment \
        mcp__notion__notion_update_page_preview \
        mcp__slack__slack_send_message \
        mcp__slack__slack_upload_file \
        mcp__linear__create_comment \
        mcp__linear__create_issue \
        mcp__linear__save_issue \
        mcp__linear__save_issue_comment \
        mcp__linear__update_issue; do
        payload=$(jq -nc --arg cwd "$REPO" --arg t "$tool_name" \
            '{cwd:$cwd,tool_name:$t,tool_input:{body:{text:"See docs/untracked.md"},nested:["safe",{"detail":"docs/untracked.md"}]}}')
        run_payload "$payload"
        assert_codex_deny "$RUN_OUTPUT" || return 1
        printf '%s' "$RUN_OUTPUT" | grep -F 'docs/untracked.md' >/dev/null || return 1
    done
}

test_mcp_text_payload_resolves_effective_workdir() {
    local payload
    mkdir -p "$REPO/subdir"
    printf 'extensionless fixture\n' > "$REPO/subdir/private"
    payload=$(jq -nc --arg cwd "$REPO" \
        '{cwd:$cwd,tool_name:"mcp__notion__notion_update_page",tool_input:{workdir:"subdir",body:{text:"See private"}}}')
    run_payload "$payload"
    assert_codex_deny "$RUN_OUTPUT" || return 1
    printf '%s' "$RUN_OUTPUT" | grep -F 'private' >/dev/null
}

test_mcp_attachment_path_deny() {
    local payload
    payload=$(jq -nc --arg cwd "$REPO" \
        '{cwd:$cwd,tool_name:"mcp__notion__notion_create_file_upload",tool_input:{file_path:"docs/notes.md"}}')
    run_payload "$payload"
    assert_codex_deny "$RUN_OUTPUT"
}

test_mcp_read_only_routes_allow_local_path_arguments() {
    local tool_name payload
    for tool_name in \
        mcp__notion__notion_fetch \
        mcp__slack__slack_read_channel \
        mcp__linear__get_issue; do
        payload=$(jq -nc --arg cwd "$REPO" --arg t "$tool_name" \
            '{cwd:$cwd,tool_name:$t,tool_input:{query:"See docs/untracked.md"}}')
        run_payload "$payload"
        [ "$RUN_EXIT" -eq 0 ] && [ -z "$RUN_OUTPUT" ] || return 1
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

test_placeholder_resolving_to_untracked_file_warns_via_additional_context() {
    printf 'private notes\n' > "$HOME/warn-notes"
    local payload
    payload=$(shell_payload bash 'gh pr create --body "See <home>/warn-notes"')
    run_payload "$payload"
    [ "$RUN_EXIT" -eq 0 ] || return 1
    printf '%s' "$RUN_OUTPUT" | jq -e \
        '.hookSpecificOutput.hookEventName == "PreToolUse" and .hookSpecificOutput.permissionDecision == null' \
        >/dev/null || return 1
    printf '%s' "$RUN_OUTPUT" | jq -e '.hookSpecificOutput.additionalContext | contains("warn-notes")' >/dev/null
}

test_placeholder_resolving_to_untracked_file_via_staged_commit_warns() {
    printf 'private staged notes\n' > "$HOME/staged-warn-notes"
    printf 'citation: <home>/staged-warn-notes\n' >> "$REPO/docs/notes.md"
    git -C "$REPO" add docs/notes.md

    local payload
    payload=$(shell_payload bash 'git commit -m "add notes"')
    run_payload "$payload"

    git -C "$REPO" reset -q HEAD -- docs/notes.md
    git -C "$REPO" checkout -q -- docs/notes.md

    [ "$RUN_EXIT" -eq 0 ] || return 1
    printf '%s' "$RUN_OUTPUT" | jq -e \
        '.hookSpecificOutput.hookEventName == "PreToolUse" and .hookSpecificOutput.permissionDecision == null' \
        >/dev/null || return 1
    printf '%s' "$RUN_OUTPUT" | jq -e '.hookSpecificOutput.additionalContext | contains("staged-warn-notes")' >/dev/null
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
    # Here-string, not a pipe: with jq (or the core) absent the hook exits
    # before draining stdin, so a pipe writer can take EPIPE and `pipefail`
    # would attribute the writer's failure to the hook. See the Claude twin.
    RUN_OUTPUT=$(PATH="$no_jq" /bin/bash "$HOOK" 2>/dev/null <<<"$payload") || RUN_EXIT=$?
    [ "${RUN_EXIT:-0}" -eq 0 ] && [ -z "$RUN_OUTPUT" ] || return 1

    mkdir -p "$tmp_hook"
    cp "$HOOK" "$tmp_hook/"
    RUN_EXIT=0
    RUN_OUTPUT=$(/bin/bash "$tmp_hook/codex-local-path-ref-gate.sh" <<<"$payload") || RUN_EXIT=$?
    [ "$RUN_EXIT" -eq 0 ] && [ -z "$RUN_OUTPUT" ] || return 1

    RUN_EXIT=0
    payload=$(jq -nc --arg cwd "$REPO/no-such-directory" \
        '{cwd:$cwd,tool_name:"bash",tool_input:{command:"gh pr create --body \\\"See docs/untracked.md\\\""}}')
    RUN_OUTPUT=$(printf '%s' "$payload" | /bin/bash "$HOOK" 2>/dev/null) || RUN_EXIT=$?
    [ "$RUN_EXIT" -eq 0 ] && [ -z "$RUN_OUTPUT" ]
}

test_yaml_registers_full_matcher() {
    grep -F 'component: codex-local-path-ref-gate.sh' "$SCRIPT_DIR/../codex.yaml" >/dev/null || return 1
    grep -F 'mcp__notion__notion_update_page' "$SCRIPT_DIR/../codex.yaml" >/dev/null || return 1
    grep -F 'mcp__slack__slack_send_message' "$SCRIPT_DIR/../codex.yaml" >/dev/null || return 1
    grep -F 'mcp__linear__save_issue' "$SCRIPT_DIR/../codex.yaml" >/dev/null || return 1
    for route in \
        mcp__notion__notion_append_block_children \
        mcp__notion__notion_archive_page \
        mcp__notion__notion_update_block \
        mcp__notion__notion_update_comment \
        mcp__notion__notion_update_page_preview \
        mcp__slack__slack_upload_file \
        mcp__linear__create_comment \
        mcp__linear__create_issue \
        mcp__linear__save_issue_comment \
        mcp__linear__update_issue; do
        grep -F "$route" "$SCRIPT_DIR/../codex.yaml" >/dev/null || return 1
    done
    ! grep -F 'mcp__notion__.*' "$SCRIPT_DIR/../codex.yaml" || return 1
    ! grep -F 'mcp__slack__.*' "$SCRIPT_DIR/../codex.yaml" || return 1
    ! grep -F 'mcp__linear__.*' "$SCRIPT_DIR/../codex.yaml"
}

main() {
    run_test test_hook_sources_core_and_strict_mode
    run_test test_all_shell_spellings_deny_staged_added_omt_reference
    run_test test_git_commit_scans_dash_c_target_and_compound_target
    run_test test_shell_command_key_fallback_and_gh_body_routes
    run_test test_gh_short_body_flag_and_escaped_quotes_deny
    run_test test_gh_body_at_mention_and_short_body_file_deny
    run_test test_quoted_separators_do_not_create_fake_gh_or_curl_commands
    run_test test_gh_compound_commands_inspect_later_create_edit_and_comment_bodies
    run_test test_newline_separators_inspect_later_gh_and_curl_commands
    run_test test_gh_body_file_routes_read_file_content
    run_test test_gh_global_repo_flags_and_attached_body_equals_deny
    run_test test_leading_env_assignments_route_gh_and_curl
    run_test test_shell_cwd_relative_payload_classification
    run_test test_shell_cwd_fallback_preserves_spaces_and_colons
    run_test test_shell_cwd_fallback_detects_extensionless_file
    run_test test_gh_and_curl_paths_follow_shell_cd
    run_test test_target_curl_payloads_deny
    run_test test_target_curl_api_root_endpoints_deny
    run_test test_target_curl_root_query_and_fragment_deny
    run_test test_target_curl_json_payload_deny
    run_test test_target_curl_attached_json_payload_deny
    run_test test_target_curl_case_normalized_hosts_and_webhook
    run_test test_missing_payload_segment_does_not_hide_later_segment
    run_test test_unreadable_payload_does_not_hide_later_payload_option
    run_test test_target_curl_form_string_payload_deny
    run_test test_target_curl_equals_url_routes_payload
    run_test test_target_curl_explicit_ports_and_multipart_text_content_deny
    run_test test_target_curl_escaped_quotes_deny
    run_test test_target_curl_inspects_every_data_payload_and_readable_at_file
    run_test test_target_curl_attached_short_options_deny
    run_test test_target_curl_upload_file_deny
    run_test test_non_target_curl_payload_url_allows
    run_test test_target_curl_data_urlencode_name_at_file_reads_content
    run_test test_target_curl_data_urlencode_missing_file_fails_open
    run_test test_target_curl_multipart_attachments_deny
    run_test test_target_curl_multipart_relative_workdir_deny
    run_test test_target_curl_multipart_missing_attachment_fails_open
    run_test test_git_commit_expands_home_in_dash_c_target
    run_test test_git_repeated_dash_c_cd_and_later_valid_segment_deny
    run_test test_git_commit_detects_staged_path_with_spaces
    run_test test_mcp_outbound_write_argument_strings_deny
    run_test test_mcp_text_payload_resolves_effective_workdir
    run_test test_mcp_attachment_path_deny
    run_test test_mcp_read_only_routes_allow_local_path_arguments
    run_test test_allow_safe_and_fail_open_shapes
    run_test test_placeholder_resolving_to_untracked_file_warns_via_additional_context
    run_test test_placeholder_resolving_to_untracked_file_via_staged_commit_warns
    run_test test_old_untouched_violation_allows
    run_test test_inspected_command_is_never_executed
    run_test test_missing_jq_core_and_failed_inspection_allow
    run_test test_yaml_registers_full_matcher
    echo "Passed: $TESTS_PASSED, Failed: $TESTS_FAILED"
    [ "$TESTS_FAILED" -eq 0 ]
}

main "$@"

#!/bin/bash
# Claude PreToolUse local-path reference gate tests.
#
# The fixture is intentionally isolated: staged git content is inspected only
# through newly-added diff lines, while PR/curl payloads are inspected before
# the external command would run.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$SCRIPT_DIR/local-path-ref-gate.sh"
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
printf '{"text":"safe baseline"}\n' > "$REPO/docs/payload.json"
git -C "$REPO" add docs/notes.md
git -C "$REPO" add docs/payload.json
git -C "$REPO" commit -q -m baseline

TESTS_PASSED=0
TESTS_FAILED=0

run_hook() {
    local payload="$1"
    printf '%s' "$payload" | bash "$HOOK"
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

test_staged_added_omt_reference_denies_with_context_and_remedy() {
    printf 'citation: $OMT_DIR/session.md\n' >> "$REPO/docs/notes.md"
    git -C "$REPO" add docs/notes.md

    local stderr_out exit_code=0
    stderr_out=$(printf '%s' "$(jq -n --arg cwd "$REPO" '{cwd:$cwd,tool_input:{command:"git commit -m \"add notes\""}}')" \
        | bash "$HOOK" 2>&1 >/dev/null) || exit_code=$?

    [[ "$exit_code" -eq 2 ]] || return 1
    printf '%s' "$stderr_out" | jq -e '.decision == "deny"' >/dev/null || return 1
    printf '%s' "$stderr_out" | grep -F 'docs/notes.md:2' >/dev/null || return 1
    printf '%s' "$stderr_out" | grep -F 'machine-local-untracked' >/dev/null || return 1
    printf '%s' "$stderr_out" | grep -F 'inline a summary or copy the file into the repository' >/dev/null || return 1
    printf '%s' "$stderr_out" | grep -F 'deleting the citation alone is forbidden' >/dev/null

    # Leave the fixture clean for the following independent cases.
    git -C "$REPO" reset -q HEAD -- docs/notes.md
    git -C "$REPO" checkout -q -- docs/notes.md
}

test_git_C_commit_inspects_target_repo_staged_additions() {
    local target_repo stderr_out exit_code=0 payload command
    target_repo=$(mktemp -d "$REPO/git-target.XXXXXX")
    git -C "$target_repo" init -q
    git -C "$target_repo" config user.email test@example.invalid
    git -C "$target_repo" config user.name test
    printf 'safe target baseline\n' > "$target_repo/notes.md"
    git -C "$target_repo" add notes.md
    git -C "$target_repo" commit -q -m baseline
    printf 'target-only fixture\n' > "$target_repo/docs-local.md"
    printf 'citation: $OMT_DIR/session.md\n' >> "$target_repo/notes.md"
    printf 'citation: docs-local.md\n' >> "$target_repo/notes.md"
    git -C "$target_repo" add notes.md

    command="git -C \"$target_repo\" commit -m \"target commit\""
    payload=$(jq -nc --arg cwd "$REPO" --arg command "$command" \
        '{cwd:$cwd,tool_input:{command:$command}}')
    stderr_out=$(printf '%s' "$payload" | bash "$HOOK" 2>&1 >/dev/null) || exit_code=$?
    [[ "$exit_code" -eq 2 ]] || return 1
    printf '%s' "$stderr_out" | jq -e '.decision == "deny"' >/dev/null || return 1
    printf '%s' "$stderr_out" | grep -F 'notes.md:2' >/dev/null || return 1
    printf '%s' "$stderr_out" | grep -F 'machine-local-untracked' >/dev/null || return 1
    printf '%s' "$stderr_out" | grep -F 'docs-local.md' >/dev/null
}

test_gh_pr_create_body_untracked_path_denies() {
    local stderr_out exit_code=0
    stderr_out=$(printf '%s' "$(jq -n --arg cwd "$REPO" '{cwd:$cwd,tool_input:{command:"gh pr create --body \"See docs/untracked.md\""}}')" \
        | bash "$HOOK" 2>&1 >/dev/null) || exit_code=$?
    [[ "$exit_code" -eq 2 ]] || return 1
    printf '%s' "$stderr_out" | jq -e '.decision == "deny"' >/dev/null || return 1
    printf '%s' "$stderr_out" | grep -F 'docs/untracked.md' >/dev/null || return 1
    printf '%s' "$stderr_out" | grep -F 'machine-local-untracked' >/dev/null
}

test_gh_pr_create_body_file_content_untracked_path_denies() {
    printf 'See docs/untracked.md\n' > "$REPO/docs/payload.md"

    local stderr_out exit_code=0
    stderr_out=$(printf '%s' "$(jq -n --arg cwd "$REPO" '{cwd:$cwd,tool_input:{command:"gh pr create --body-file docs/payload.md"}}')" \
        | bash "$HOOK" 2>&1 >/dev/null) || exit_code=$?
    [[ "$exit_code" -eq 2 ]] || return 1
    printf '%s' "$stderr_out" | jq -e '.decision == "deny"' >/dev/null || return 1
    printf '%s' "$stderr_out" | grep -F 'docs/untracked.md' >/dev/null || return 1
    printf '%s' "$stderr_out" | grep -F 'machine-local-untracked' >/dev/null
}

test_expanded_gh_body_file_paths_inspect_content() {
    local form command payload stderr_out exit_code path_expr
    printf 'See docs/untracked.md\n' > "$OMT_DIR/body-omt.md"
    printf 'See docs/untracked.md\n' > "$HOME/body-home.md"
    for path_expr in \
        '$OMT_DIR/body-omt.md' \
        '${OMT_DIR}/body-omt.md' \
        '$HOME/body-home.md' \
        '~/body-home.md'; do
        command="gh pr create --body-file \"$path_expr\""
        payload=$(jq -nc --arg cwd "$REPO" --arg command "$command" \
            '{cwd:$cwd,tool_input:{command:$command}}')
        stderr_out=''
        exit_code=0
        stderr_out=$(printf '%s' "$payload" | bash "$HOOK" 2>&1 >/dev/null) || exit_code=$?
        [[ "$exit_code" -eq 2 ]] || return 1
        printf '%s' "$stderr_out" | jq -e '.decision == "deny"' >/dev/null || return 1
        printf '%s' "$stderr_out" | grep -F 'docs/untracked.md' >/dev/null || return 1
    done
}

test_gh_pr_create_body_file_missing_fails_open() {
    local exit_code=0
    printf '%s' "$(jq -n --arg cwd "$REPO" '{cwd:$cwd,tool_input:{command:"gh pr create --body-file docs/missing-body.md"}}')" \
        | bash "$HOOK" >/dev/null 2>&1 || exit_code=$?
    [[ "$exit_code" -eq 0 ]]
}

test_target_curl_payloads_deny() {
    local host command payload stderr_out exit_code
    for host in \
        'https://api.notion.com/v1/pages' \
        'https://slack.com/api/chat.postMessage' \
        'https://api.linear.app/graphql'; do
        # Keep JSON construction independent of shell interpolation.
        command="curl -X POST $host --data '{\"text\":\"See docs/untracked.md\"}'"
        payload=$(jq -nc --arg cwd "$REPO" --arg command "$command" \
            '{cwd:$cwd,tool_input:{command:$command}}')
        stderr_out=$(printf '%s' "$payload" | bash "$HOOK" 2>&1 >/dev/null) || exit_code=$?
        exit_code=${exit_code:-0}
        [[ "$exit_code" -eq 2 ]] || return 1
        printf '%s' "$stderr_out" | jq -e '.decision == "deny"' >/dev/null || return 1
        printf '%s' "$stderr_out" | grep -F 'docs/untracked.md' >/dev/null || return 1
        unset exit_code
    done
}

test_target_curl_file_payload_content_denies() {
    printf '{"text":"See docs/untracked.md"}\n' > "$REPO/docs/payload.json"

    local host command payload stderr_out exit_code=0
    host='https://api.notion.com/v1/pages'
    command="curl -X POST $host --data @docs/payload.json"
    payload=$(jq -nc --arg cwd "$REPO" --arg command "$command" \
        '{cwd:$cwd,tool_input:{command:$command}}')
    stderr_out=$(printf '%s' "$payload" | bash "$HOOK" 2>&1 >/dev/null) || exit_code=$?
    [[ "$exit_code" -eq 2 ]] || return 1
    printf '%s' "$stderr_out" | jq -e '.decision == "deny"' >/dev/null || return 1
    printf '%s' "$stderr_out" | grep -F 'docs/untracked.md' >/dev/null || return 1

    printf '{"text":"safe baseline"}\n' > "$REPO/docs/payload.json"
}

test_target_curl_expanded_at_file_payload_content_denies() {
    local host command payload stderr_out exit_code=0 path_expr
    printf '{"text":"See docs/untracked.md"}\n' > "$OMT_DIR/payload-omt.json"
    printf '{"text":"See docs/untracked.md"}\n' > "$HOME/payload-home.json"
    host='https://api.notion.com/v1/pages'
    for path_expr in \
        '$OMT_DIR/payload-omt.json' \
        '${OMT_DIR}/payload-omt.json' \
        '$HOME/payload-home.json' \
        '~/payload-home.json'; do
        command="curl -X POST $host --data \"@$path_expr\""
        payload=$(jq -nc --arg cwd "$REPO" --arg command "$command" \
            '{cwd:$cwd,tool_input:{command:$command}}')
        stderr_out=''
        exit_code=0
        stderr_out=$(printf '%s' "$payload" | bash "$HOOK" 2>&1 >/dev/null) || exit_code=$?
        [[ "$exit_code" -eq 2 ]] || return 1
        printf '%s' "$stderr_out" | jq -e '.decision == "deny"' >/dev/null || return 1
        printf '%s' "$stderr_out" | grep -F 'docs/untracked.md' >/dev/null || return 1
    done
}

test_target_curl_multipart_file_attachment_denies() {
    local host command payload stderr_out exit_code=0
    host='https://api.notion.com/v1/pages'
    for command in \
        "curl -X POST $host -Ffile=@docs/untracked.png" \
        "curl -X POST $host -F 'file=@docs/untracked.png'" \
        "curl -X POST $host --form \"file=@docs/untracked.png\""; do
        payload=$(jq -nc --arg cwd "$REPO" --arg command "$command" \
            '{cwd:$cwd,tool_input:{command:$command}}')
        stderr_out=''
        exit_code=0
        stderr_out=$(printf '%s' "$payload" | bash "$HOOK" 2>&1 >/dev/null) || exit_code=$?
        [[ "$exit_code" -eq 2 ]] || return 1
        printf '%s' "$stderr_out" | jq -e '.decision == "deny"' >/dev/null || return 1
        printf '%s' "$stderr_out" | grep -F 'docs/untracked.png' >/dev/null || return 1
        printf '%s' "$stderr_out" | grep -F 'machine-local-untracked' >/dev/null || return 1
    done
}

test_target_curl_multiple_payloads_inspect_all() {
    local host command payload stderr_out exit_code=0
    host='https://api.notion.com/v1/pages'
    command="curl -X POST $host --data '{\"text\":\"See docs/notes.md\"}' --data-raw '{\"text\":\"See docs/untracked.md\"}'"
    payload=$(jq -nc --arg cwd "$REPO" --arg command "$command" \
        '{cwd:$cwd,tool_input:{command:$command}}')
    stderr_out=$(printf '%s' "$payload" | bash "$HOOK" 2>&1 >/dev/null) || exit_code=$?
    [[ "$exit_code" -eq 2 ]] || return 1
    printf '%s' "$stderr_out" | jq -e '.decision == "deny"' >/dev/null || return 1
    printf '%s' "$stderr_out" | grep -F 'docs/untracked.md' >/dev/null
}

test_composite_commands_inspect_later_git_and_gh_bodies() {
    local target_repo command payload stderr_out exit_code=0
    target_repo=$(mktemp -d "$REPO/git-composite.XXXXXX")
    git -C "$target_repo" init -q
    git -C "$target_repo" config user.email test@example.invalid
    git -C "$target_repo" config user.name test
    printf 'safe baseline\n' > "$target_repo/notes.md"
    git -C "$target_repo" add notes.md
    git -C "$target_repo" commit -q -m baseline
    mkdir -p "$target_repo/docs"
    printf 'citation: docs/untracked.md\n' >> "$target_repo/notes.md"
    printf 'fixture\n' > "$target_repo/docs/untracked.md"
    git -C "$target_repo" add notes.md

    command="git commit -m first && git -C \"$target_repo\" commit -m later"
    payload=$(jq -nc --arg cwd "$REPO" --arg command "$command" \
        '{cwd:$cwd,tool_input:{command:$command}}')
    stderr_out=$(printf '%s' "$payload" | bash "$HOOK" 2>&1 >/dev/null) || exit_code=$?
    [[ "$exit_code" -eq 2 ]] || return 1
    printf '%s' "$stderr_out" | grep -F 'docs/untracked.md' >/dev/null || return 1

    command='gh pr create --body "safe"; gh pr comment --body "See docs/untracked.md"'
    payload=$(jq -nc --arg cwd "$REPO" --arg command "$command" \
        '{cwd:$cwd,tool_input:{command:$command}}')
    exit_code=0
    stderr_out=$(printf '%s' "$payload" | bash "$HOOK" 2>&1 >/dev/null) || exit_code=$?
    [[ "$exit_code" -eq 2 ]] || return 1
    printf '%s' "$stderr_out" | grep -F 'docs/untracked.md' >/dev/null
}

test_newline_separators_inspect_later_outbound_commands() {
    local command payload stderr_out exit_code=0
    command=$'git status\ngh pr comment --body "See docs/untracked.md"'
    payload=$(jq -nc --arg cwd "$REPO" --arg command "$command" \
        '{cwd:$cwd,tool_input:{command:$command}}')
    stderr_out=$(printf '%s' "$payload" | bash "$HOOK" 2>&1 >/dev/null) || exit_code=$?
    [[ "$exit_code" -eq 2 ]] || return 1
    printf '%s' "$stderr_out" | grep -F 'docs/untracked.md' >/dev/null
}

test_target_curl_url_equals_endpoint_denies() {
    local command payload stderr_out exit_code=0
    command="curl --url=https://slack.com/api/chat.postMessage --data '{\"text\":\"See docs/untracked.md\"}'"
    payload=$(jq -nc --arg cwd "$REPO" --arg command "$command" \
        '{cwd:$cwd,tool_input:{command:$command}}')
    stderr_out=$(printf '%s' "$payload" | bash "$HOOK" 2>&1 >/dev/null) || exit_code=$?
    [[ "$exit_code" -eq 2 ]] || return 1
    printf '%s' "$stderr_out" | grep -F 'docs/untracked.md' >/dev/null
}

test_git_c_config_before_commit_inspects_staged_additions() {
    local command payload stderr_out exit_code=0
    printf 'citation: docs/untracked.md\n' >> "$REPO/docs/notes.md"
    git -C "$REPO" add docs/notes.md

    command='git -c user.name=gate-test commit -m configured'
    payload=$(jq -nc --arg cwd "$REPO" --arg command "$command" \
        '{cwd:$cwd,tool_input:{command:$command}}')
    stderr_out=$(printf '%s' "$payload" | bash "$HOOK" 2>&1 >/dev/null) || exit_code=$?
    git -C "$REPO" reset -q HEAD -- docs/notes.md
    git -C "$REPO" checkout -q -- docs/notes.md
    [[ "$exit_code" -eq 2 ]] || return 1
    printf '%s' "$stderr_out" | grep -F 'docs/untracked.md' >/dev/null
}

test_gh_short_body_option_denies() {
    local command payload stderr_out exit_code=0
    command='gh pr edit 123 -b "See docs/untracked.md"'
    payload=$(jq -nc --arg cwd "$REPO" --arg command "$command" \
        '{cwd:$cwd,tool_input:{command:$command}}')
    stderr_out=$(printf '%s' "$payload" | bash "$HOOK" 2>&1 >/dev/null) || exit_code=$?
    [[ "$exit_code" -eq 2 ]] || return 1
    printf '%s' "$stderr_out" | grep -F 'docs/untracked.md' >/dev/null
}

test_target_curl_additional_data_option_forms_deny() {
    local host command payload stderr_out exit_code=0
    host='https://api.notion.com/v1/pages'
    for command in \
        "curl -X POST $host -d'{\"text\":\"See docs/untracked.md\"}'" \
        "curl -X POST $host --data-ascii '{\"text\":\"See docs/untracked.md\"}'" \
        "curl -X POST $host --json '{\"text\":\"See docs/untracked.md\"}'"; do
        payload=$(jq -nc --arg cwd "$REPO" --arg command "$command" \
            '{cwd:$cwd,tool_input:{command:$command}}')
        exit_code=0
        stderr_out=$(printf '%s' "$payload" | bash "$HOOK" 2>&1 >/dev/null) || exit_code=$?
        [[ "$exit_code" -eq 2 ]] || return 1
        printf '%s' "$stderr_out" | grep -F 'docs/untracked.md' >/dev/null || return 1
    done

    printf 'See docs/untracked.md\n' > "$REPO/docs/urlencoded.txt"
    command="curl -X POST $host --data-urlencode note@docs/urlencoded.txt"
    payload=$(jq -nc --arg cwd "$REPO" --arg command "$command" \
        '{cwd:$cwd,tool_input:{command:$command}}')
    exit_code=0
    stderr_out=$(printf '%s' "$payload" | bash "$HOOK" 2>&1 >/dev/null) || exit_code=$?
    [[ "$exit_code" -eq 2 ]] || return 1
    printf '%s' "$stderr_out" | grep -F 'docs/untracked.md' >/dev/null
}

test_target_curl_multipart_text_and_attached_forms_deny() {
    local host command payload stderr_out exit_code=0
    host='https://api.notion.com/v1/pages'
    printf 'fixture\n' > "$REPO/docs/path with spaces.png"
    command="curl -X POST $host -F 'text=safe baseline' -F 'file=@docs/path with spaces.png'"
    payload=$(jq -nc --arg cwd "$REPO" --arg command "$command" \
        '{cwd:$cwd,tool_input:{command:$command}}')
    stderr_out=$(printf '%s' "$payload" | bash "$HOOK" 2>&1 >/dev/null) || exit_code=$?
    [[ "$exit_code" -eq 2 ]] || return 1
    printf '%s' "$stderr_out" | grep -F 'docs/path with spaces.png' >/dev/null || return 1

    command="curl -X POST $host -F 'file=@docs/notes.md' -F 'text=See docs/untracked.md'"
    payload=$(jq -nc --arg cwd "$REPO" --arg command "$command" \
        '{cwd:$cwd,tool_input:{command:$command}}')
    exit_code=0
    stderr_out=$(printf '%s' "$payload" | bash "$HOOK" 2>&1 >/dev/null) || exit_code=$?
    [[ "$exit_code" -eq 2 ]] || return 1
    printf '%s' "$stderr_out" | grep -F 'docs/untracked.md' >/dev/null
}

test_hook_declares_core_dependency() {
    grep -qF '# omt-hook-dep: local-path-ref-gate-core.sh' "$HOOK"
}

test_placeholder_nonexistent_and_https_allow() {
    local command exit_code=0
    for command in \
        'gh pr create --body "See $OMT_DIR/deep-interview/{slug}.md"' \
        "gh pr create --body 'See $REPO/no-such-concrete-file.md'" \
        'gh pr create --body "See https://example.com/reference"'; do
        printf '%s' "$(jq -n --arg cwd "$REPO" --arg command "$command" '{cwd:$cwd,tool_input:{command:$command}}')" \
            | bash "$HOOK" >/dev/null 2>&1 || exit_code=$?
        [[ "$exit_code" -eq 0 ]] || return 1
        exit_code=0
    done
}

test_old_violation_with_unrelated_new_edit_allows() {
    printf 'old citation: $OMT_DIR/session.md\n' > "$REPO/docs/old.md"
    git -C "$REPO" add docs/old.md
    git -C "$REPO" commit -q -m 'old citation fixture'
    printf 'unrelated new line\n' >> "$REPO/docs/old.md"
    git -C "$REPO" add docs/old.md

    local exit_code=0
    printf '%s' "$(jq -n --arg cwd "$REPO" '{cwd:$cwd,tool_input:{command:"git commit -m \"unrelated edit\""}}')" \
        | bash "$HOOK" >/dev/null 2>&1 || exit_code=$?
    [[ "$exit_code" -eq 0 ]]
}

test_missing_jq_fails_open() {
    local no_jq="$REPO/no-jq-bin" exit_code=0
    mkdir -p "$no_jq"
    printf '%s' "$(jq -n --arg cwd "$REPO" '{cwd:$cwd,tool_input:{command:"gh pr create --body \"See docs/untracked.md\""}}')" \
        | PATH="$no_jq" /bin/bash "$HOOK" >/dev/null 2>&1 || exit_code=$?
    [[ "$exit_code" -eq 0 ]]
}

test_yaml_registers_bash_pretooluse_shim() {
    awk '
        /component: local-path-ref-gate\.sh/ { found=1; next }
        found && /matcher: "Bash"/ { matched=1; exit }
        found && /component:/ { exit }
        END { exit !(found && matched) }
    ' "$SCRIPT_DIR/../claude.yaml"
}

test_hook_enables_strict_mode() {
    grep -Eq '^set -euo pipefail$' "$HOOK"
}

run_test test_hook_enables_strict_mode
run_test test_hook_declares_core_dependency
run_test test_staged_added_omt_reference_denies_with_context_and_remedy
run_test test_git_C_commit_inspects_target_repo_staged_additions
run_test test_gh_pr_create_body_untracked_path_denies
run_test test_gh_pr_create_body_file_content_untracked_path_denies
run_test test_expanded_gh_body_file_paths_inspect_content
run_test test_gh_pr_create_body_file_missing_fails_open
run_test test_target_curl_payloads_deny
run_test test_target_curl_file_payload_content_denies
run_test test_target_curl_expanded_at_file_payload_content_denies
run_test test_target_curl_multiple_payloads_inspect_all
run_test test_target_curl_multipart_file_attachment_denies
run_test test_composite_commands_inspect_later_git_and_gh_bodies
run_test test_newline_separators_inspect_later_outbound_commands
run_test test_target_curl_url_equals_endpoint_denies
run_test test_git_c_config_before_commit_inspects_staged_additions
run_test test_gh_short_body_option_denies
run_test test_target_curl_additional_data_option_forms_deny
run_test test_target_curl_multipart_text_and_attached_forms_deny
run_test test_placeholder_nonexistent_and_https_allow
run_test test_old_violation_with_unrelated_new_edit_allows
run_test test_missing_jq_fails_open
run_test test_yaml_registers_bash_pretooluse_shim

echo "Passed: $TESTS_PASSED, Failed: $TESTS_FAILED"
[[ "$TESTS_FAILED" -eq 0 ]]

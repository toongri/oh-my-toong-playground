#!/bin/bash
# =============================================================================
# local-path-ref-gate-core.sh behavior tests.
#
# The core is deliberately tested directly, without either platform hook.  It
# receives a repository root and inspectable text, then emits one tab-separated
# record per citation that needs a deny.  The records are judgment data only;
# platform shims own their deny envelope.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./local-path-ref-gate-core.sh
source "$SCRIPT_DIR/local-path-ref-gate-core.sh"

TESTS_PASSED=0
TESTS_FAILED=0
TEST_TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEST_TMP_DIR"' EXIT

REPO="$TEST_TMP_DIR/repo"
HOME="$TEST_TMP_DIR/home"
OMT_DIR="$TEST_TMP_DIR/omt"
export HOME OMT_DIR
mkdir -p "$REPO/docs" "$HOME" "$OMT_DIR"
git -C "$REPO" init -q
git -C "$REPO" config user.email test@example.invalid
git -C "$REPO" config user.name test
printf 'tracked\n' > "$REPO/docs/tracked.md"
git -C "$REPO" add docs/tracked.md
printf 'old tracked content\n' > "$REPO/docs/old.md"
git -C "$REPO" add docs/old.md
printf 'untracked in repo\n' > "$REPO/docs/untracked.md"
printf 'untracked extensionless in repo\n' > "$REPO/docs/untracked-extensionless"
printf 'untracked parenthesized in repo\n' > "$REPO/docs/untracked-parenthesized(2026).md"
printf 'untracked root note\n' > "$REPO/local-note"
printf 'untracked env\n' > "$REPO/.env"
printf 'untracked secret\n' > "$REPO/secret"
printf 'machine local\n' > "$HOME/private-notes.md"
printf 'machine local hash\n' > "$HOME/private#notes.md"
printf 'machine local attachment\n' > "$HOME/private attachment.md"
printf 'machine local tabbed\n' > "$HOME/private"$'\t'"notes.md"
printf 'machine local punctuation\n' > "$HOME/private-notes."
printf 'machine local glob metacharacters\n' > "$HOME/private*[draft]?.md"
printf 'machine local literal line suffix\n' > "$HOME/private-notes:2026"
printf 'tracked attachment\n' > "$REPO/docs/tracked attachment.md"
git -C "$REPO" add 'docs/tracked attachment.md'
printf 'untracked encoded attachment\n' > "$REPO/docs/untracked attachment.md"
printf 'untracked encoded colon filename\n' > "$REPO/docs/report:2026"
printf 'session state\n' > "$OMT_DIR/session.md"
printf 'machine local parent\n' > "$TEST_TMP_DIR/secret.md"

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

test_placeholder_and_https_allow() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" $'template: $OMT_DIR/deep-interview/{slug}.md\nhttps://example.com/reference') || rc=$?
    [[ "$rc" -eq 1 && -z "$out" ]]
}

test_markdown_repo_root_placeholder_allows() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" 'See [source](<repo-root>/src/file.ts).') || rc=$?
    [[ "$rc" -eq 1 && -z "$out" ]]
}

test_existing_home_file_reports_untracked_remediation() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" $'Keep ~/private-notes.md cited.') || rc=$?
    [[ "$rc" -eq 0 ]] || return 1
    printf '%s' "$out" | grep -F 'type=machine-local-untracked' >/dev/null || return 1
    printf '%s' "$out" | grep -F 'inline a summary or copy the file into the repository' >/dev/null
}

test_existing_omt_file_reports_untracked_remediation() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" 'State: $OMT_DIR/session.md') || rc=$?
    [[ "$rc" -eq 0 ]] || return 1
    printf '%s' "$out" | grep -F 'type=machine-local-untracked' >/dev/null
}

test_existing_absolute_tracked_file_reports_relative_remediation() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" "Tracked: $REPO/docs/tracked.md") || rc=$?
    [[ "$rc" -eq 0 ]] || return 1
    printf '%s' "$out" | grep -F 'type=absolute-tracked' >/dev/null || return 1
    printf '%s' "$out" | grep -F 'use the repository-relative path' >/dev/null || return 1
    printf '%s' "$out" | grep -F 'path=docs/tracked.md' >/dev/null
}

test_existing_file_url_reports_machine_local() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" "file://$HOME/private-notes.md") || rc=$?
    [[ "$rc" -eq 0 ]] || return 1
    printf '%s' "$out" | grep -F 'type=machine-local-untracked' >/dev/null || return 1
    printf '%s' "$out" | grep -F "path=file://$HOME/private-notes.md" >/dev/null
}

test_percent_encoded_file_url_reports_machine_local() {
    local out rc=0 encoded_uri="file://$HOME/private%20attachment.md"
    out=$(local_path_ref_gate_core_check "$REPO" "$encoded_uri") || rc=$?
    [[ "$rc" -eq 0 ]] || return 1
    printf '%s' "$out" | grep -F 'type=machine-local-untracked' >/dev/null || return 1
    printf '%s' "$out" | grep -F "path=$encoded_uri" >/dev/null
}

test_file_url_for_tracked_file_reports_absolute_tracked() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" "file://$REPO/docs/tracked.md") || rc=$?
    [[ "$rc" -eq 0 ]] || return 1
    printf '%s' "$out" | grep -F 'type=absolute-tracked' >/dev/null || return 1
    printf '%s' "$out" | grep -F 'path=docs/tracked.md' >/dev/null
}

test_localhost_file_url_reports_machine_local_after_percent_decoding() {
    local out rc=0 encoded_uri="file://localhost$HOME/private%20attachment.md"
    out=$(local_path_ref_gate_core_check "$REPO" "$encoded_uri") || rc=$?
    [[ "$rc" -eq 0 ]] || return 1
    printf '%s' "$out" | grep -F 'type=machine-local-untracked' >/dev/null || return 1
    printf '%s' "$out" | grep -F "path=$encoded_uri" >/dev/null
}

test_localhost_file_url_for_tracked_file_reports_absolute_tracked() {
    local out rc=0 encoded_uri="file://localhost$REPO/docs/tracked%20attachment.md"
    out=$(local_path_ref_gate_core_check "$REPO" "$encoded_uri") || rc=$?
    [[ "$rc" -eq 0 ]] || return 1
    printf '%s' "$out" | grep -F 'type=absolute-tracked' >/dev/null || return 1
    printf '%s' "$out" | grep -F 'path=docs/tracked attachment.md' >/dev/null
}

test_localhost_file_url_preserves_percent_decoded_literal_colon_filename() {
    local out rc=0 encoded_uri="file://localhost$HOME/private-notes%3A2026"
    out=$(local_path_ref_gate_core_check "$REPO" "$encoded_uri") || rc=$?
    [[ "$rc" -eq 0 ]] || return 1
    printf '%s' "$out" | grep -F 'type=machine-local-untracked' >/dev/null || return 1
    printf '%s' "$out" | grep -F "path=$encoded_uri" >/dev/null
}

test_localhost_file_url_authority_is_case_insensitive() {
    local out rc=0 encoded_uri="file://LOCALHOST$HOME/private%20attachment.md"
    out=$(local_path_ref_gate_core_check "$REPO" "$encoded_uri") || rc=$?
    [[ "$rc" -eq 0 ]] || return 1
    printf '%s' "$out" | grep -F 'type=machine-local-untracked' >/dev/null || return 1
    printf '%s' "$out" | grep -F "path=$encoded_uri" >/dev/null
}

test_markdown_destination_percent_decodes_tracked_target() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" 'See [attachment](docs/tracked%20attachment.md).') || rc=$?
    [[ "$rc" -eq 1 && -z "$out" ]]
}

test_markdown_destination_percent_decodes_untracked_target() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" 'See [attachment](docs/untracked%20attachment.md).') || rc=$?
    [[ "$rc" -eq 0 ]] || return 1
    printf '%s' "$out" | grep -F 'type=machine-local-untracked' >/dev/null || return 1
    printf '%s' "$out" | grep -F 'path=docs/untracked%20attachment.md' >/dev/null
}

test_markdown_destination_percent_encoded_colon_filename_reports_machine_local() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" 'See [report](docs/report%3A2026).') || rc=$?
    [[ "$rc" -eq 0 ]] || return 1
    printf '%s' "$out" | grep -F 'type=machine-local-untracked' >/dev/null || return 1
    printf '%s' "$out" | grep -F 'path=docs/report%3A2026' >/dev/null
}

test_percent_encoded_colon_filename_reports_decoded_absolute_target() {
    local out rc=0 encoded_path="$HOME/private-notes%3A2026"
    out=$(local_path_ref_gate_core_check "$REPO" "$encoded_path") || rc=$?
    [[ "$rc" -eq 0 ]] || return 1
    printf '%s' "$out" | grep -F 'type=machine-local-untracked' >/dev/null || return 1
    printf '%s' "$out" | grep -F "path=$encoded_path" >/dev/null
}

test_unresolved_escaped_path_line_syntax_fails_open() {
    local out rc=0 escaped_uri="file://localhost$HOME/private-notes.md%3A2"
    out=$(local_path_ref_gate_core_check "$REPO" "$escaped_uri") || rc=$?
    [[ "$rc" -eq 1 && -z "$out" ]]
}

test_unresolved_relative_escaped_path_line_syntax_fails_open() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" '[citation](docs/untracked.md%3A2)') || rc=$?
    [[ "$rc" -eq 1 && -z "$out" ]]
}

test_unresolved_backslash_escaped_path_line_syntax_fails_open() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" '[citation](docs/untracked.md\:2)') || rc=$?
    [[ "$rc" -eq 1 && -z "$out" ]]
}

test_nonempty_file_uri_authority_allows() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" "See [remote file](file://files.example.invalid$HOME/private-notes.md).") || rc=$?
    [[ "$rc" -eq 1 && -z "$out" ]]
}

test_external_uri_markdown_destination_allows() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" 'See [artifact](s3://bucket.example.invalid/build/report.md).') || rc=$?
    [[ "$rc" -eq 1 && -z "$out" ]]
}

test_existing_filename_final_period_reports_machine_local() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" "$HOME/private-notes.") || rc=$?
    [[ "$rc" -eq 0 ]] || return 1
    printf '%s' "$out" | grep -F 'type=machine-local-untracked' >/dev/null || return 1
    printf '%s' "$out" | grep -F "path=$HOME/private-notes." >/dev/null
}

test_existing_filename_with_glob_metacharacters_reports_machine_local() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" "$HOME/private*[draft]?.md") || rc=$?
    [[ "$rc" -eq 0 ]] || return 1
    printf '%s' "$out" | grep -F 'type=machine-local-untracked' >/dev/null || return 1
    printf '%s' "$out" | grep -F "path=$HOME/private*[draft]?.md" >/dev/null
}

test_existing_filename_ending_in_numbered_suffix_reports_machine_local() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" "$HOME/private-notes:2026") || rc=$?
    [[ "$rc" -eq 0 ]] || return 1
    printf '%s' "$out" | grep -F 'type=machine-local-untracked' >/dev/null || return 1
    printf '%s' "$out" | grep -F "path=$HOME/private-notes:2026" >/dev/null
}

test_existing_filename_with_hash_reports_machine_local() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" "$HOME/private#notes.md") || rc=$?
    [[ "$rc" -eq 0 ]] || return 1
    printf '%s' "$out" | grep -F 'type=machine-local-untracked' >/dev/null || return 1
    printf '%s' "$out" | grep -F "path=$HOME/private#notes.md" >/dev/null
}

test_tab_in_local_filename_does_not_split_core_record() {
    local out rc=0 field_count
    out=$(local_path_ref_gate_core_check "$REPO" "$HOME/private"$'\t'"notes.md") || rc=$?
    [[ "$rc" -eq 0 ]] || return 1
    field_count=$(printf '%s\n' "$out" | awk -F '\t' 'NR == 1 { print NF }')
    [[ "$field_count" -eq 6 ]] || return 1
    printf '%s' "$out" | grep -F "path=$HOME/private\\tnotes.md" >/dev/null
}

test_nonexistent_concrete_local_path_allows() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" "Future: $TEST_TMP_DIR/no-such-file.md") || rc=$?
    [[ "$rc" -eq 1 && -z "$out" ]]
}

test_nonexistent_bare_relative_example_allows() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" 'For example, docs/not-present.md may be cited.') || rc=$?
    [[ "$rc" -eq 1 && -z "$out" ]]
}

test_markdown_destination_with_optional_title_allows_tracked_target() {
    local out rc=0
    printf 'tracked notes\n' > "$REPO/docs/notes.md"
    git -C "$REPO" add docs/notes.md
    out=$(local_path_ref_gate_core_check "$REPO" 'See [notes](docs/notes.md "read this").') || rc=$?
    [[ "$rc" -eq 1 && -z "$out" ]]
}

test_malformed_markdown_destination_does_not_fall_through_to_bare_scan() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" 'See [broken](docs/not-present.md') || rc=$?
    [[ "$rc" -eq 1 && -z "$out" ]]
}

test_escaped_markdown_link_shape_does_not_fall_through_to_bare_scan() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" 'See \[literal\](docs/not-present.md).') || rc=$?
    [[ "$rc" -eq 1 && -z "$out" ]]
}

test_escaped_markdown_opening_paren_does_not_fall_through_to_bare_scan() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" 'See [literal]\(docs/not-present.md\).') || rc=$?
    [[ "$rc" -eq 1 && -z "$out" ]]
}

test_escaped_markdown_destination_preserves_literal_filename_behavior() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" 'See [the report](docs/untracked-parenthesized\(2026\).md).') || rc=$?
    [[ "$rc" -eq 0 ]] || return 1
    printf '%s' "$out" | grep -F 'type=machine-local-untracked' >/dev/null || return 1
    printf '%s' "$out" | grep -F 'path=docs/untracked-parenthesized(2026).md' >/dev/null
}

test_existing_relative_file_allows() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" 'See docs/tracked.md') || rc=$?
    [[ "$rc" -eq 1 && -z "$out" ]]
}

test_existing_relative_untracked_file_reports_machine_local() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" 'See docs/untracked.md') || rc=$?
    [[ "$rc" -eq 0 ]] || return 1
    printf '%s' "$out" | grep -F 'type=machine-local-untracked' >/dev/null
}

test_parenthesized_bare_untracked_file_reports_machine_local() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" 'See (docs/untracked.md).') || rc=$?
    [[ "$rc" -eq 0 ]] || return 1
    printf '%s' "$out" | grep -F 'type=machine-local-untracked' >/dev/null || return 1
    printf '%s' "$out" | grep -F 'path=docs/untracked.md' >/dev/null
}

test_existing_relative_untracked_extensionless_file_reports_machine_local() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" 'See docs/untracked-extensionless.') || rc=$?
    [[ "$rc" -eq 0 ]] || return 1
    printf '%s' "$out" | grep -F 'type=machine-local-untracked' >/dev/null || return 1
    printf '%s' "$out" | grep -F 'path=docs/untracked-extensionless' >/dev/null
}

test_existing_root_level_untracked_files_report_machine_local() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" 'See local-note, .env, and secret.') || rc=$?
    [[ "$rc" -eq 0 ]] || return 1
    printf '%s' "$out" | grep -F 'path=local-note' >/dev/null || return 1
    printf '%s' "$out" | grep -F 'path=.env' >/dev/null || return 1
    printf '%s' "$out" | grep -F 'path=secret' >/dev/null || return 1
}

test_nonexistent_root_level_words_are_not_paths() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" 'The prose mentions an illustrative-token and arbitrary-word.') || rc=$?
    [[ "$rc" -eq 1 && -z "$out" ]]
}

test_standalone_path_markers_in_prose_are_not_paths() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" 'The prose uses /, ./, and ../ as separators.') || rc=$?
    [[ "$rc" -eq 1 && -z "$out" ]]
}

test_nonempty_dot_relative_path_still_classifies() {
    local out rc=0
    printf 'dot relative\n' > "$REPO/dot-relative.md"
    out=$(local_path_ref_gate_core_check "$REPO" 'See ./dot-relative.md.') || rc=$?
    [[ "$rc" -eq 0 ]] || return 1
    printf '%s' "$out" | grep -F 'type=machine-local-untracked' >/dev/null || return 1
    printf '%s' "$out" | grep -F 'path=./dot-relative.md' >/dev/null
}

test_markdown_parenthesized_path_reports_machine_local() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" 'See [the report](docs/untracked-parenthesized(2026).md).') || rc=$?
    [[ "$rc" -eq 0 ]] || return 1
    printf '%s' "$out" | grep -F 'type=machine-local-untracked' >/dev/null || return 1
    printf '%s' "$out" | grep -F 'path=docs/untracked-parenthesized(2026).md' >/dev/null
}

test_markdown_nested_parenthesized_path_reports_machine_local() {
    local out rc=0
    printf 'nested parenthesized file\n' > "$REPO/docs/untracked-(draft(2026)).md"
    out=$(local_path_ref_gate_core_check "$REPO" 'See [the report](docs/untracked-(draft(2026)).md).') || rc=$?
    [[ "$rc" -eq 0 ]] || return 1
    printf '%s' "$out" | grep -F 'type=machine-local-untracked' >/dev/null || return 1
    printf '%s' "$out" | grep -F 'path=docs/untracked-(draft(2026)).md' >/dev/null
}

test_location_prefix_only_inspects_actual_content() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" 'docs/old.md:2: unrelated new line') || rc=$?
    [[ "$rc" -eq 1 && -z "$out" ]]
}

test_location_prefix_preserves_content_path_classification() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" 'docs/old.md:2: docs/untracked-extensionless') || rc=$?
    [[ "$rc" -eq 0 ]] || return 1
    printf '%s' "$out" | grep -F 'type=machine-local-untracked' >/dev/null || return 1
    ! printf '%s' "$out" | grep -F 'path=docs/old.md:2' >/dev/null
}

test_path_line_citation_in_regular_text_is_classified() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" 'docs/untracked.md:2: see the cited local file') || rc=$?
    [[ "$rc" -eq 0 ]] || return 1
    printf '%s' "$out" | grep -F 'type=machine-local-untracked' >/dev/null || return 1
    printf '%s' "$out" | grep -F 'path=docs/untracked.md:2' >/dev/null
}

test_single_concrete_path_with_spaces_reports_machine_local() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" "$HOME/private attachment.md") || rc=$?
    [[ "$rc" -eq 0 ]] || return 1
    printf '%s' "$out" | grep -F 'type=machine-local-untracked' >/dev/null || return 1
    printf '%s' "$out" | grep -F "path=$HOME/private attachment.md" >/dev/null
}

test_existing_file_with_spaces_inside_prose_reports_machine_local() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" "Please inspect $HOME/private attachment.md before continuing.") || rc=$?
    [[ "$rc" -eq 0 ]] || return 1
    printf '%s' "$out" | grep -F 'type=machine-local-untracked' >/dev/null || return 1
    printf '%s' "$out" | grep -F "path=$HOME/private attachment.md" >/dev/null
}

test_crlf_line_terminator_does_not_bypass_existing_file_check() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" "Keep $HOME/private-notes.md cited."$'\r\n') || rc=$?
    [[ "$rc" -eq 0 ]] || return 1
    printf '%s' "$out" | grep -F 'type=machine-local-untracked' >/dev/null || return 1
    printf '%s' "$out" | grep -F "path=$HOME/private-notes.md" >/dev/null
}

test_markdown_destination_with_spaces_allows_tracked_target() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" 'See [attachment](docs/tracked attachment.md).') || rc=$?
    [[ "$rc" -eq 1 && -z "$out" ]]
}

test_multipart_attachment_with_tracked_relative_path_reports_machine_local() {
    local out rc=0
    out=$(local_path_ref_gate_core_check_attachment "$REPO" 'docs/tracked attachment.md') || rc=$?
    [[ "$rc" -eq 0 ]] || return 1
    printf '%s' "$out" | grep -F 'type=local-attachment' >/dev/null || return 1
    printf '%s' "$out" | grep -F 'path=docs/tracked attachment.md' >/dev/null
}

test_absolute_tracked_attachment_reports_attachment_remediation() {
    local out rc=0
    out=$(local_path_ref_gate_core_check_attachment "$REPO" "$REPO/docs/tracked.md") || rc=$?
    [[ "$rc" -eq 0 ]] || return 1
    printf '%s' "$out" | grep -F 'type=local-attachment' >/dev/null || return 1
    printf '%s' "$out" | grep -F "path=$REPO/docs/tracked.md" >/dev/null || return 1
    printf '%s' "$out" | grep -F 'do not attach local files; inline a summary or link to the repository file' >/dev/null
}

test_existing_parent_relative_file_reports_machine_local() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" 'See ../secret.md') || rc=$?
    [[ "$rc" -eq 0 ]] || return 1
    printf '%s' "$out" | grep -F 'type=machine-local-untracked' >/dev/null || return 1
    printf '%s' "$out" | grep -F 'path=../secret.md' >/dev/null
}

test_setup_error_fails_open() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$TEST_TMP_DIR/not-a-repository" 'docs/missing.md') || rc=$?
    [[ "$rc" -eq 1 && -z "$out" ]]
}

test_bare_double_slash_comment_marker_allows() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" '// this is just a normal comment') || rc=$?
    [[ "$rc" -eq 1 && -z "$out" ]]
}

test_bare_triple_slash_doc_comment_allows() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" '/// JSDoc-style comment') || rc=$?
    [[ "$rc" -eq 1 && -z "$out" ]]
}

test_function_call_fixture_nonexistent_path_allows() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" "expect(detectHostRole(\"$TEST_TMP_DIR/no-such-fixture-dir/my-skill\", {})).toBe(\"unknown\");") || rc=$?
    [[ "$rc" -eq 1 && -z "$out" ]]
}

test_angle_placeholder_generalized_allows() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" '// (<worktree>/skills/orchestrate-review/scripts/), which is neither a') || rc=$?
    [[ "$rc" -eq 1 && -z "$out" ]]
}

test_angle_placeholder_resolving_to_untracked_home_file_is_advisory_and_allows() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" '근거는 <home>/private-notes.md 참고') || rc=$?
    [[ "$rc" -eq 0 ]] || return 1
    printf '%s' "$out" | grep -F 'type=placeholder-resolves-to-untracked' >/dev/null || return 1
    printf '%s' "$out" | grep -F "$HOME/private-notes.md" >/dev/null || return 1
    printf '%s' "$out" | grep -F 'never leave an untracked file path in a tracked file or a shared document' >/dev/null || return 1
    ! printf '%s' "$out" | grep -F 'type=machine-local-untracked' >/dev/null
}

test_angle_placeholder_resolving_to_untracked_repo_file_is_advisory_and_allows() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" '근거는 <repo-root>/docs/untracked.md 참고') || rc=$?
    [[ "$rc" -eq 0 ]] || return 1
    printf '%s' "$out" | grep -F 'type=placeholder-resolves-to-untracked' >/dev/null || return 1
    printf '%s' "$out" | grep -F "$REPO/docs/untracked.md" >/dev/null
}

test_angle_placeholder_prefers_omt_dir_over_home_when_both_match() {
    local out rc=0
    printf 'omt copy\n' > "$OMT_DIR/priority-check.md"
    printf 'home copy\n' > "$HOME/priority-check.md"
    out=$(local_path_ref_gate_core_check "$REPO" '<x>/priority-check.md') || rc=$?
    [[ "$rc" -eq 0 ]] || return 1
    printf '%s' "$out" | grep -F "$OMT_DIR/priority-check.md" >/dev/null || return 1
    ! printf '%s' "$out" | grep -F "$HOME/priority-check.md" >/dev/null
}

test_angle_placeholder_with_blocking_record_also_present_reports_both() {
    # Advisory emission is purely additive: the existing "has a record"
    # return-code contract (0 when any record was emitted, 1 when none)
    # is unchanged here.  What matters for the shim's deny-vs-warn split is
    # that the blocking record's own type still shows up in the output
    # alongside the advisory one, not a distinct core-level exit status.
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" $'근거는 <home>/private-notes.md 참고\n$HOME/private-notes.md') || rc=$?
    [[ "$rc" -eq 0 ]] || return 1
    printf '%s' "$out" | grep -F 'type=placeholder-resolves-to-untracked' >/dev/null || return 1
    printf '%s' "$out" | grep -F 'type=machine-local-untracked' >/dev/null
}

test_angle_placeholder_resolving_to_directory_allows() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" '근거는 <repo-root>/docs 참고') || rc=$?
    [[ "$rc" -eq 1 && -z "$out" ]]
}

test_angle_placeholder_resolving_to_tracked_file_allows() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" '근거는 <repo-root>/docs/tracked.md 참고') || rc=$?
    [[ "$rc" -eq 1 && -z "$out" ]]
}

test_angle_placeholder_resolving_through_dot_git_segment_allows() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" '근거는 <repo-root>/.git/config 참고') || rc=$?
    [[ "$rc" -eq 1 && -z "$out" ]]
}

test_angle_placeholder_with_no_matching_root_allows() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" '근거는 <repo-root>/src/nowhere.ts 참고') || rc=$?
    [[ "$rc" -eq 1 && -z "$out" ]]
}

test_comment_with_home_path_still_denies() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" "// see \$HOME/private-notes.md for details") || rc=$?
    [[ "$rc" -eq 0 ]] || return 1
    printf '%s' "$out" | grep -F 'type=machine-local-untracked' >/dev/null
}

test_comment_with_tilde_path_still_denies() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" '// see ~/private-notes.md') || rc=$?
    [[ "$rc" -eq 0 ]] || return 1
    printf '%s' "$out" | grep -F 'type=machine-local-untracked' >/dev/null
}

test_comment_with_tmp_stand_in_path_still_denies() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" "// dumped to $TEST_TMP_DIR/secret.md") || rc=$?
    [[ "$rc" -eq 0 ]] || return 1
    printf '%s' "$out" | grep -F 'type=machine-local-untracked' >/dev/null
}

test_comment_with_file_uri_still_denies() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" "// file://$HOME/private-notes.md") || rc=$?
    [[ "$rc" -eq 0 ]] || return 1
    printf '%s' "$out" | grep -F 'type=machine-local-untracked' >/dev/null
}

test_comment_with_omt_dir_path_still_denies() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" '// state lives at $OMT_DIR/session.md') || rc=$?
    [[ "$rc" -eq 0 ]] || return 1
    printf '%s' "$out" | grep -F 'type=machine-local-untracked' >/dev/null
}

test_function_call_real_home_path_still_denies() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" "readFile(\"\$HOME/private-notes.md\")") || rc=$?
    [[ "$rc" -eq 0 ]] || return 1
    printf '%s' "$out" | grep -F 'type=machine-local-untracked' >/dev/null
}

test_function_call_real_omt_dir_path_still_denies() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" 'readFile("$OMT_DIR/session.md")') || rc=$?
    [[ "$rc" -eq 0 ]] || return 1
    printf '%s' "$out" | grep -F 'type=machine-local-untracked' >/dev/null
}

test_function_call_file_uri_still_denies() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" "readFile(\"file://$HOME/private-notes.md\")") || rc=$?
    [[ "$rc" -eq 0 ]] || return 1
    printf '%s' "$out" | grep -F 'type=machine-local-untracked' >/dev/null
}

test_backtick_code_span_real_path_still_denies() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" "See \`$HOME/private-notes.md\` for details.") || rc=$?
    [[ "$rc" -eq 0 ]] || return 1
    printf '%s' "$out" | grep -F 'type=machine-local-untracked' >/dev/null
}

test_multiple_call_sites_on_one_line_both_classified_correctly() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" "expect(detectHostRole(\"$TEST_TMP_DIR/no-such/x\", {})).toBe(readFile(\"\$HOME/private-notes.md\"));") || rc=$?
    [[ "$rc" -eq 0 ]] || return 1
    printf '%s' "$out" | grep -F 'type=machine-local-untracked' >/dev/null || return 1
    printf '%s' "$out" | grep -F "path=\$HOME/private-notes.md" >/dev/null || \
        printf '%s' "$out" | grep -F "path=$HOME/private-notes.md" >/dev/null || return 1
    ! printf '%s' "$out" | grep -F "no-such/x" >/dev/null
}

test_single_quoted_wrapped_real_path_denies() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" "'$HOME/private-notes.md'") || rc=$?
    [[ "$rc" -eq 0 ]] || return 1
    printf '%s' "$out" | grep -F 'type=machine-local-untracked' >/dev/null
}

test_double_quoted_wrapped_real_path_denies() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" "\"$HOME/private-notes.md\"") || rc=$?
    [[ "$rc" -eq 0 ]] || return 1
    printf '%s' "$out" | grep -F 'type=machine-local-untracked' >/dev/null
}

test_angle_wrapped_real_path_denies() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" "<$HOME/private-notes.md>") || rc=$?
    [[ "$rc" -eq 0 ]] || return 1
    printf '%s' "$out" | grep -F 'type=machine-local-untracked' >/dev/null
}

test_possessive_apostrophe_in_prose_allows() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" "// corrupted a job.json's chairmanRole") || rc=$?
    [[ "$rc" -eq 1 && -z "$out" ]]
}

test_pipe_redirect_to_devnull_line_allows() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" "printf '%s' \"\$out\" | grep -F 'type=machine-local-untracked' >/dev/null") || rc=$?
    [[ "$rc" -eq 1 && -z "$out" ]]
}

test_quoted_neighbor_token_does_not_promote_unrelated_candidate() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" "See 'note' docs/plain-missing here.") || rc=$?
    [[ "$rc" -eq 1 && -z "$out" ]]
}

run_test test_placeholder_and_https_allow
run_test test_markdown_repo_root_placeholder_allows
run_test test_existing_home_file_reports_untracked_remediation
run_test test_existing_omt_file_reports_untracked_remediation
run_test test_existing_absolute_tracked_file_reports_relative_remediation
run_test test_existing_file_url_reports_machine_local
run_test test_percent_encoded_file_url_reports_machine_local
run_test test_file_url_for_tracked_file_reports_absolute_tracked
run_test test_localhost_file_url_reports_machine_local_after_percent_decoding
run_test test_localhost_file_url_for_tracked_file_reports_absolute_tracked
run_test test_localhost_file_url_preserves_percent_decoded_literal_colon_filename
run_test test_localhost_file_url_authority_is_case_insensitive
run_test test_markdown_destination_percent_decodes_tracked_target
run_test test_markdown_destination_percent_decodes_untracked_target
run_test test_markdown_destination_percent_encoded_colon_filename_reports_machine_local
run_test test_percent_encoded_colon_filename_reports_decoded_absolute_target
run_test test_unresolved_escaped_path_line_syntax_fails_open
run_test test_unresolved_relative_escaped_path_line_syntax_fails_open
run_test test_unresolved_backslash_escaped_path_line_syntax_fails_open
run_test test_nonempty_file_uri_authority_allows
run_test test_external_uri_markdown_destination_allows
run_test test_existing_filename_final_period_reports_machine_local
run_test test_existing_filename_with_glob_metacharacters_reports_machine_local
run_test test_existing_filename_ending_in_numbered_suffix_reports_machine_local
run_test test_existing_filename_with_hash_reports_machine_local
run_test test_tab_in_local_filename_does_not_split_core_record
run_test test_nonexistent_concrete_local_path_allows
run_test test_nonexistent_bare_relative_example_allows
run_test test_markdown_destination_with_optional_title_allows_tracked_target
run_test test_malformed_markdown_destination_does_not_fall_through_to_bare_scan
run_test test_escaped_markdown_link_shape_does_not_fall_through_to_bare_scan
run_test test_escaped_markdown_opening_paren_does_not_fall_through_to_bare_scan
run_test test_escaped_markdown_destination_preserves_literal_filename_behavior
run_test test_existing_relative_file_allows
run_test test_existing_relative_untracked_file_reports_machine_local
run_test test_parenthesized_bare_untracked_file_reports_machine_local
run_test test_existing_relative_untracked_extensionless_file_reports_machine_local
run_test test_existing_root_level_untracked_files_report_machine_local
run_test test_nonexistent_root_level_words_are_not_paths
run_test test_standalone_path_markers_in_prose_are_not_paths
run_test test_nonempty_dot_relative_path_still_classifies
run_test test_markdown_parenthesized_path_reports_machine_local
run_test test_markdown_nested_parenthesized_path_reports_machine_local
run_test test_location_prefix_only_inspects_actual_content
run_test test_location_prefix_preserves_content_path_classification
run_test test_path_line_citation_in_regular_text_is_classified
run_test test_single_concrete_path_with_spaces_reports_machine_local
run_test test_existing_file_with_spaces_inside_prose_reports_machine_local
run_test test_crlf_line_terminator_does_not_bypass_existing_file_check
run_test test_markdown_destination_with_spaces_allows_tracked_target
run_test test_multipart_attachment_with_tracked_relative_path_reports_machine_local
run_test test_absolute_tracked_attachment_reports_attachment_remediation
run_test test_existing_parent_relative_file_reports_machine_local
run_test test_setup_error_fails_open
run_test test_bare_double_slash_comment_marker_allows
run_test test_bare_triple_slash_doc_comment_allows
run_test test_function_call_fixture_nonexistent_path_allows
run_test test_angle_placeholder_generalized_allows
run_test test_angle_placeholder_resolving_to_untracked_home_file_is_advisory_and_allows
run_test test_angle_placeholder_resolving_to_untracked_repo_file_is_advisory_and_allows
run_test test_angle_placeholder_prefers_omt_dir_over_home_when_both_match
run_test test_angle_placeholder_with_blocking_record_also_present_reports_both
run_test test_angle_placeholder_resolving_to_directory_allows
run_test test_angle_placeholder_resolving_to_tracked_file_allows
run_test test_angle_placeholder_resolving_through_dot_git_segment_allows
run_test test_angle_placeholder_with_no_matching_root_allows
run_test test_comment_with_home_path_still_denies
run_test test_comment_with_tilde_path_still_denies
run_test test_comment_with_tmp_stand_in_path_still_denies
run_test test_comment_with_file_uri_still_denies
run_test test_comment_with_omt_dir_path_still_denies
run_test test_function_call_real_home_path_still_denies
run_test test_function_call_real_omt_dir_path_still_denies
run_test test_function_call_file_uri_still_denies
run_test test_backtick_code_span_real_path_still_denies
run_test test_multiple_call_sites_on_one_line_both_classified_correctly
run_test test_single_quoted_wrapped_real_path_denies
run_test test_double_quoted_wrapped_real_path_denies
run_test test_angle_wrapped_real_path_denies
run_test test_possessive_apostrophe_in_prose_allows
run_test test_pipe_redirect_to_devnull_line_allows
run_test test_quoted_neighbor_token_does_not_promote_unrelated_candidate

echo "Passed: $TESTS_PASSED, Failed: $TESTS_FAILED"
[[ "$TESTS_FAILED" -eq 0 ]]

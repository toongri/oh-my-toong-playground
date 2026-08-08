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
printf 'untracked in repo\n' > "$REPO/docs/untracked.md"
printf 'machine local\n' > "$HOME/private-notes.md"
printf 'session state\n' > "$OMT_DIR/session.md"

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

test_missing_relative_reports_location_type_and_remediation() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" $'See [the design](docs/not-present.md).') || rc=$?
    [[ "$rc" -eq 0 ]] || return 1
    printf '%s' "$out" | grep -F 'line=1' >/dev/null || return 1
    printf '%s' "$out" | grep -F 'type=repo-relative-missing' >/dev/null || return 1
    printf '%s' "$out" | grep -F 'path=docs/not-present.md' >/dev/null || return 1
    printf '%s' "$out" | grep -F 'add the target or inline its content' >/dev/null || return 1
    printf '%s' "$out" | grep -F 'deleting the citation alone is forbidden' >/dev/null
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

test_nonexistent_concrete_local_path_allows() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$REPO" "Future: $TEST_TMP_DIR/no-such-file.md") || rc=$?
    [[ "$rc" -eq 1 && -z "$out" ]]
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

test_setup_error_fails_open() {
    local out rc=0
    out=$(local_path_ref_gate_core_check "$TEST_TMP_DIR/not-a-repository" 'docs/missing.md') || rc=$?
    [[ "$rc" -eq 1 && -z "$out" ]]
}

run_test test_placeholder_and_https_allow
run_test test_missing_relative_reports_location_type_and_remediation
run_test test_existing_home_file_reports_untracked_remediation
run_test test_existing_omt_file_reports_untracked_remediation
run_test test_existing_absolute_tracked_file_reports_relative_remediation
run_test test_nonexistent_concrete_local_path_allows
run_test test_existing_relative_file_allows
run_test test_existing_relative_untracked_file_reports_machine_local
run_test test_setup_error_fails_open

echo "Passed: $TESTS_PASSED, Failed: $TESTS_FAILED"
[[ "$TESTS_FAILED" -eq 0 ]]

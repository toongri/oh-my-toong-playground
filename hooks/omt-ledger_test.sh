#!/bin/bash
# =============================================================================
# omt-ledger.sh Tests
# Durable session-ledger append/replace helper (plan TODO 2, D4, D6).
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LEDGER_SCRIPT="$SCRIPT_DIR/omt-ledger.sh"

# Test utilities
TESTS_PASSED=0
TESTS_FAILED=0
CURRENT_TEST=""

setup_test_env() {
    TEST_TMP_DIR=$(mktemp -d)
    export OMT_DIR="$TEST_TMP_DIR/.omt"
    mkdir -p "$OMT_DIR"
    export OMT_SESSION_ID="test-sid-1"
}

teardown_test_env() {
    unset OMT_DIR
    unset OMT_SESSION_ID
    if [[ -d "$TEST_TMP_DIR" ]]; then
        rm -rf "$TEST_TMP_DIR"
    fi
}

assert_equals() {
    local expected="$1"
    local actual="$2"
    local msg="${3:-}"

    if [[ "$expected" == "$actual" ]]; then
        return 0
    else
        echo "ASSERTION FAILED: $msg"
        echo "  Expected: '$expected'"
        echo "  Actual:   '$actual'"
        return 1
    fi
}

assert_file_exists() {
    local file="$1"
    local msg="${2:-File should exist: $file}"

    if [[ -f "$file" ]]; then
        return 0
    else
        echo "ASSERTION FAILED: $msg"
        return 1
    fi
}

assert_file_not_exists() {
    local file="$1"
    local msg="${2:-File should NOT exist: $file}"

    if [[ ! -f "$file" ]]; then
        return 0
    else
        echo "ASSERTION FAILED: $msg"
        return 1
    fi
}

assert_file_contains() {
    local file="$1"
    local pattern="$2"
    local msg="${3:-File should contain pattern}"

    if grep -qF "$pattern" "$file"; then
        return 0
    else
        echo "ASSERTION FAILED: $msg"
        echo "  Pattern: '$pattern'"
        echo "  File: $file"
        return 1
    fi
}

assert_file_not_contains() {
    local file="$1"
    local pattern="$2"
    local msg="${3:-File should NOT contain pattern}"

    if grep -qF "$pattern" "$file"; then
        echo "ASSERTION FAILED: $msg"
        echo "  Pattern: '$pattern'"
        echo "  File: $file"
        return 1
    else
        return 0
    fi
}

run_test() {
    local test_name="$1"
    CURRENT_TEST="$test_name"

    setup_test_env

    if "$test_name"; then
        echo "[PASS] $test_name"
        ((TESTS_PASSED++)) || true
    else
        echo "[FAIL] $test_name"
        ((TESTS_FAILED++)) || true
    fi

    teardown_test_env
}

ledger_path() {
    echo "$OMT_DIR/session-ledger-${OMT_SESSION_ID}.md"
}

# =============================================================================
# Tests: First append lazily creates the 6-section skeleton
# =============================================================================

test_first_append_creates_six_section_skeleton() {
    printf 'first decision content' | "$LEDGER_SCRIPT" append Decisions

    local ledger
    ledger="$(ledger_path)"
    assert_file_exists "$ledger" "ledger file should be created on first append" || return 1

    for header in "## Now" "## Decisions" "## User Corrections (verbatim)" "## Pending" "## Pointers" "## Learnings"; do
        assert_file_contains "$ledger" "$header" "skeleton should contain literal header: $header" || return 1
    done

    assert_file_contains "$ledger" "first decision content" \
        "appended content should exist under the target section" || return 1
}

test_append_places_content_under_correct_section_not_others() {
    printf 'pending item A' | "$LEDGER_SCRIPT" append Pending

    local ledger
    ledger="$(ledger_path)"

    # Extract the Pending section block up to the next header line.
    local pending_block
    pending_block=$(awk '/^## Pending$/{f=1;next} /^## /{f=0} f' "$ledger")
    assert_output_contains_local "$pending_block" "pending item A" \
        "Pending section should contain the appended content" || return 1

    # Now section should remain empty (no stray content leaked across sections).
    local now_block
    now_block=$(awk '/^## Now$/{f=1;next} /^## /{f=0} f' "$ledger")
    if [[ -n "$now_block" ]]; then
        echo "ASSERTION FAILED: Now section should stay empty, got: '$now_block'"
        return 1
    fi
}

assert_output_contains_local() {
    local output="$1"
    local pattern="$2"
    local msg="${3:-Output should contain pattern}"

    if echo "$output" | grep -qF "$pattern"; then
        return 0
    else
        echo "ASSERTION FAILED: $msg"
        echo "  Pattern: '$pattern'"
        echo "  Output: $output"
        return 1
    fi
}

# =============================================================================
# Tests: `now` replaces latest content only (D4 latest-replace)
# =============================================================================

test_now_called_twice_keeps_only_latest_content() {
    printf 'now content A' | "$LEDGER_SCRIPT" now
    printf 'now content B' | "$LEDGER_SCRIPT" now

    local ledger
    ledger="$(ledger_path)"

    assert_file_contains "$ledger" "now content B" "latest Now content should be present" || return 1
    assert_file_not_contains "$ledger" "now content A" "prior Now content should be replaced, not accumulated" || return 1
}

test_now_replace_does_not_disturb_other_sections() {
    printf 'a decision' | "$LEDGER_SCRIPT" append Decisions
    printf 'now content 1' | "$LEDGER_SCRIPT" now
    printf 'now content 2' | "$LEDGER_SCRIPT" now

    local ledger
    ledger="$(ledger_path)"
    assert_file_contains "$ledger" "a decision" "Decisions section content should survive Now replace" || return 1
}

# =============================================================================
# Test (PR #162 P2 regression): a NEW content line that is literally equal to
# a skeleton header (e.g. "## Decisions" written as prose inside the Now
# section) must not be re-mistaken for a real structural boundary on a LATER
# invocation (this script re-parses the whole file from scratch each run).
# Escape-on-write prefixes such a line with SENTINEL before it ever reaches
# disk, so the file must end up with EXACTLY ONE bare "## Decisions" header,
# the fake line must stay inert content of the Now section, and a subsequent
# append to the REAL Decisions section must land there (not misrouted).
# =============================================================================

test_content_line_matching_header_does_not_create_false_boundary() {
    printf 'NOW_A\n## Decisions\nNOW_B' | "$LEDGER_SCRIPT" now
    printf 'DECISION_REAL' | "$LEDGER_SCRIPT" append Decisions

    local ledger
    ledger="$(ledger_path)"

    local header_count
    header_count=$(grep -cxF '## Decisions' "$ledger")
    if [ "$header_count" -ne 1 ]; then
        echo "ASSERTION FAILED: expected exactly one structural '## Decisions' header, found $header_count"
        echo "--- ledger ---"; cat "$ledger"
        return 1
    fi

    local now_block decisions_block
    now_block=$(awk 'BEGIN{n=split("## Now|## Decisions|## User Corrections (verbatim)|## Pending|## Pointers|## Learnings",H,"|");idx=1}
      { if(idx<=n && $0==H[idx]){cur=$0;idx++;next} if(cur=="## Now")print }' "$ledger")
    decisions_block=$(awk 'BEGIN{n=split("## Now|## Decisions|## User Corrections (verbatim)|## Pending|## Pointers|## Learnings",H,"|");idx=1}
      { if(idx<=n && $0==H[idx]){cur=$0;idx++;next} if(cur=="## Decisions")print }' "$ledger")

    assert_output_contains_local "$now_block" 'NOW_B' \
        "NOW_B must remain inside the Now section body, not misrouted by the collision line" || return 1
    assert_output_contains_local "$decisions_block" 'DECISION_REAL' \
        "DECISION_REAL must land under the real Decisions section" || return 1
    if echo "$now_block" | grep -qF 'DECISION_REAL'; then
        echo "ASSERTION FAILED: DECISION_REAL must not leak into the Now section"
        echo "--- ledger ---"; cat "$ledger"
        return 1
    fi
    return 0
}

# =============================================================================
# Test (double-escape round-trip): content that ITSELF already looks escaped
# (one SENTINEL followed by a skeleton header, as literal user text) must get
# an ADDITIONAL sentinel prepended on write -- never conflated with the
# single-escape case. This is the writer half of the round-trip; the reader
# half (exactly one sentinel stripped back off) is covered in session-start_test.sh.
# =============================================================================

test_already_escaped_looking_content_gets_double_escaped_on_write() {
    printf 'OMT_ESC::## Decisions' | "$LEDGER_SCRIPT" now

    local ledger
    ledger="$(ledger_path)"

    local double_count single_count
    double_count=$(grep -cxF 'OMT_ESC::OMT_ESC::## Decisions' "$ledger")
    single_count=$(grep -cxF 'OMT_ESC::## Decisions' "$ledger")

    if [ "$double_count" -ne 1 ]; then
        echo "ASSERTION FAILED: content already shaped like one sentinel + header must be escaped to two sentinels, not left as-is"
        echo "--- ledger ---"; cat "$ledger"
        return 1
    fi
    # Whole-line exact match (-x): the on-disk line is the double-escaped
    # form, never the bare single-escaped form -- these must not both exist.
    if [ "$single_count" -ne 0 ]; then
        echo "ASSERTION FAILED: the single-sentinel form must not appear as a bare line on disk (it must be double-escaped), found $single_count"
        echo "--- ledger ---"; cat "$ledger"
        return 1
    fi
}

# =============================================================================
# Test: metacharacter + multibyte + self-referential-string payload, lossless
# =============================================================================

test_metachar_multibyte_payload_stored_losslessly() {
    printf '결정: A && B | $(x) `k` session-ledger-x.md 한글' | "$LEDGER_SCRIPT" append Decisions

    local ledger
    ledger="$(ledger_path)"
    assert_file_contains "$ledger" '결정: A && B | $(x) `k` session-ledger-x.md 한글' \
        "payload with metacharacters/multibyte/self-referential string must be stored verbatim" || return 1
}

# =============================================================================
# Test (F2/S9 regression): content containing a `## <SectionName>` line must
# not corrupt a later append to that section. Section boundaries are the 6
# known skeleton headers in fixed order, not any `## ` line in content.
# =============================================================================

test_hashline_in_content_does_not_misroute_later_append() {
    # Inject a line equal to a real header ("## Pending") into Decisions content.
    printf 'decision one\n## Pending\nfake pending body' | "$LEDGER_SCRIPT" append Decisions
    # Now append to the REAL Pending section.
    printf 'REAL_PENDING_ITEM' | "$LEDGER_SCRIPT" append Pending

    local ledger
    ledger="$(ledger_path)"

    # The real append must land under the real (last) Pending header, i.e. after
    # "## Pointers"'s predecessor -- concretely, REAL_PENDING_ITEM must appear
    # AFTER the "## User Corrections (verbatim)" header, inside the real Pending
    # section, not inside the Decisions block.
    local real_pending_block
    real_pending_block=$(awk '
      $0=="## Now"||$0=="## Decisions"||$0=="## User Corrections (verbatim)"||$0=="## Pending"||$0=="## Pointers"||$0=="## Learnings" {
        cur=$0; next
      }
      cur=="## Pending" && seen_corr { print }
      $0=="## User Corrections (verbatim)"{seen_corr=1}
    ' "$ledger")

    # Simpler structural check: the Decisions section must NOT contain the real
    # pending item, and the item must exist somewhere after the Corrections header.
    local decisions_block
    decisions_block=$(awk 'BEGIN{n=split("## Now|## Decisions|## User Corrections (verbatim)|## Pending|## Pointers|## Learnings",H,"|");idx=1}
      { if(idx<=n && $0==H[idx]){cur=$0;idx++;next} if(cur=="## Decisions")print }' "$ledger")

    if echo "$decisions_block" | grep -qF 'REAL_PENDING_ITEM'; then
        echo "ASSERTION FAILED: real Pending append misrouted into the Decisions section (header-line injection)"
        echo "--- ledger ---"; cat "$ledger"
        return 1
    fi

    # Decisions must still hold its own content and the injected literal line.
    assert_output_contains_local "$decisions_block" 'decision one' \
        "Decisions content must be preserved" || return 1
    return 0
}

# =============================================================================
# Test (silent-loss guard): a ledger missing the target section header must
# make append/now REFUSE (non-zero) rather than exit 0 while dropping content.
# A well-formed ledger always carries all 6 headers, so this only triggers on
# an externally-corrupted ledger -- but a durable record must fail loud, never
# silently lose data.
# =============================================================================

test_missing_target_header_refuses_instead_of_silent_loss() {
    local ledger
    ledger="$(ledger_path)"
    # Corrupted ledger: only 2 of the 6 skeleton headers (missing ## Learnings).
    printf '## Now\n## Decisions\n' > "$ledger"

    if printf 'MUST_NOT_VANISH' | "$LEDGER_SCRIPT" append Learnings; then
        echo "ASSERTION FAILED: append to a ledger missing '## Learnings' must exit non-zero, not succeed while silently dropping content"
        return 1
    fi

    # Refusal must be non-destructive: the pre-existing ledger stays intact.
    assert_file_contains "$ledger" "## Decisions" \
        "existing ledger content must be preserved when append refuses" || return 1
    assert_file_not_contains "$ledger" "MUST_NOT_VANISH" \
        "refused content must not be partially written" || return 1
}

# =============================================================================
# Tests: default/empty OMT_SESSION_ID refusal
# =============================================================================

test_default_session_id_refuses_and_creates_no_file() {
    OMT_SESSION_ID="default"
    local ledger
    ledger="$(ledger_path)"

    if OMT_SESSION_ID="default" "$LEDGER_SCRIPT" append Now </dev/null; then
        echo "ASSERTION FAILED: script should exit non-zero when OMT_SESSION_ID=default"
        return 1
    fi

    assert_file_not_exists "$ledger" "ledger file must not be created when OMT_SESSION_ID=default" || return 1
}

test_empty_session_id_refuses_and_creates_no_file() {
    unset OMT_SESSION_ID
    export OMT_SESSION_ID=""

    if "$LEDGER_SCRIPT" append Now </dev/null; then
        echo "ASSERTION FAILED: script should exit non-zero when OMT_SESSION_ID is empty"
        return 1
    fi

    # There is no valid ledger path to check with an empty sid; assert the OMT_DIR
    # gained no new session-ledger-*.md file at all as the observable outcome.
    if compgen -G "$OMT_DIR/session-ledger-*.md" > /dev/null 2>&1; then
        echo "ASSERTION FAILED: no session-ledger file should be created with empty OMT_SESSION_ID"
        return 1
    fi
}

# =============================================================================
# Test (PR #162 finding A, P2): two concurrent append/now invocations must be
# serialized via a lock so one cannot clobber the other's write (last-writer-
# wins durability race). Deterministic reproduction: pre-seize the lock
# directory ourselves, launch a background append, and assert it stays
# blocked (content absent, process still alive) until we release the lock.
# =============================================================================

test_concurrent_append_serializes_via_lock() {
    printf 'seed' | "$LEDGER_SCRIPT" append Decisions >/dev/null

    local ledger lockdir pid
    ledger="$(ledger_path)"
    lockdir="${ledger}.lock"

    mkdir "$lockdir"

    printf 'LOCKED_APPEND' | "$LEDGER_SCRIPT" append Decisions &
    pid=$!

    sleep 0.3

    if grep -qF 'LOCKED_APPEND' "$ledger"; then
        echo "ASSERTION FAILED: append should be blocked while lock is held, but content already appeared"
        kill "$pid" 2>/dev/null || true
        wait "$pid" 2>/dev/null || true
        rmdir "$lockdir" 2>/dev/null || true
        return 1
    fi

    if ! kill -0 "$pid" 2>/dev/null; then
        echo "ASSERTION FAILED: background append process should still be waiting for the lock, but it already exited"
        rmdir "$lockdir" 2>/dev/null || true
        return 1
    fi

    rmdir "$lockdir"
    wait "$pid"

    assert_file_contains "$ledger" 'LOCKED_APPEND' \
        "background append should complete once the lock is released" || return 1
    assert_file_contains "$ledger" '## Decisions' \
        "skeleton headers should survive the serialized append" || return 1
}

# =============================================================================
# Test: uninvoked session -> ledger file absent
# =============================================================================

test_ledger_absent_when_never_invoked() {
    local ledger
    ledger="$(ledger_path)"
    assert_file_not_exists "$ledger" "ledger should not exist before any append/now call" || return 1
}

# =============================================================================
# Test: invalid section name rejected
# =============================================================================

test_invalid_section_name_rejected() {
    if printf 'x' | "$LEDGER_SCRIPT" append Bogus; then
        echo "ASSERTION FAILED: script should exit non-zero for an invalid section name"
        return 1
    fi

    local ledger
    ledger="$(ledger_path)"
    assert_file_not_exists "$ledger" "ledger file must not be created for an invalid section name" || return 1
}

# =============================================================================
# Test (D6): path never exposed via stdout
# =============================================================================

test_success_produces_no_stdout_path_leak() {
    local output
    output=$(printf 'content' | "$LEDGER_SCRIPT" append Pending)

    if [[ -n "$output" ]]; then
        echo "ASSERTION FAILED: successful append must not print anything to stdout (D6 path non-exposure)"
        echo "  stdout: $output"
        return 1
    fi
    return 0
}

# =============================================================================
# Tests: additive session-id self-resolution (plan TODO 3) -- OMT_SESSION_ID
# ?? CODEX_THREAD_ID with STRICT EMPTY-ONLY coalescing, mirroring
# lib/state-core.ts:88-107 resolveSessionIdOrThrow's authoritative-env-first
# semantics so bash and TypeScript resolve the SAME identity for a given
# session. Each test below manages its own sandboxed HOME/OMT_DIR directly
# (bypassing setup_test_env/teardown_test_env, which force OMT_SESSION_ID to
# be preset) since the fallback and git-derivation paths need env shapes
# those helpers don't produce; every sandbox is a mktemp -d, never real
# $HOME/.omt, and is torn down with rm -rf on every return path.
# =============================================================================

run_test_raw() {
    local test_name="$1"
    CURRENT_TEST="$test_name"

    if "$test_name"; then
        echo "[PASS] $test_name"
        ((TESTS_PASSED++)) || true
    else
        echo "[FAIL] $test_name"
        ((TESTS_FAILED++)) || true
    fi
}

test_codex_thread_id_fallback_used_when_omt_session_id_unset() {
    local sbx gitdir
    sbx="$(mktemp -d)"
    gitdir="$sbx/repo"
    mkdir -p "$gitdir"
    git -C "$gitdir" init -q -b main

    if ! ( cd "$gitdir" && printf 'hello\n' | env -u OMT_DIR -u OMT_SESSION_ID HOME="$sbx" CODEX_THREAD_ID=codex-abc bash "$LEDGER_SCRIPT" append Decisions ); then
        echo "ASSERTION FAILED: append should succeed via CODEX_THREAD_ID fallback + git-derived OMT_DIR"
        rm -rf "$sbx"
        return 1
    fi

    if ! ls "$sbx"/.omt/*/session-ledger-codex-abc.md >/dev/null 2>&1; then
        echo "ASSERTION FAILED: expected session-ledger-codex-abc.md under a git-derived OMT_DIR in $sbx/.omt"
        rm -rf "$sbx"
        return 1
    fi

    rm -rf "$sbx"
    return 0
}

test_present_unsafe_omt_session_id_refuses_without_fallback() {
    local sbx
    sbx="$(mktemp -d)"

    # 'evil.sid' contains a '.', which is outside the ^[A-Za-z0-9_-]{1,200}$
    # charset guard but is a perfectly valid flat filename character -- prior
    # to the guard this value would be silently accepted and written.
    if printf 'x' | OMT_DIR="$sbx" OMT_SESSION_ID='evil.sid' CODEX_THREAD_ID=safe-sid "$LEDGER_SCRIPT" append Decisions; then
        echo "ASSERTION FAILED: a present-but-unsafe OMT_SESSION_ID must refuse (exit non-zero), not succeed"
        rm -rf "$sbx"
        return 1
    fi

    if [ -f "$sbx/session-ledger-safe-sid.md" ]; then
        echo "ASSERTION FAILED: unsafe OMT_SESSION_ID must not silently fall through to CODEX_THREAD_ID's ledger path"
        rm -rf "$sbx"
        return 1
    fi

    if [ -f "$sbx/session-ledger-evil.sid.md" ]; then
        echo "ASSERTION FAILED: unsafe OMT_SESSION_ID must not be written under its own (unsafe) ledger path either"
        rm -rf "$sbx"
        return 1
    fi

    rm -rf "$sbx"
    return 0
}

test_claude_env_first_unchanged_with_sandboxed_omt_dir() {
    local sbx
    sbx="$(mktemp -d)"

    if ! ( printf 'x\n' | OMT_DIR="$sbx" OMT_SESSION_ID=uuid-1 CODEX_THREAD_ID=should-be-ignored "$LEDGER_SCRIPT" append Decisions ); then
        echo "ASSERTION FAILED: Claude env-first path (OMT_SESSION_ID present) should succeed unchanged"
        rm -rf "$sbx"
        return 1
    fi

    if [ ! -f "$sbx/session-ledger-uuid-1.md" ]; then
        echo "ASSERTION FAILED: ledger should be written at the env-supplied sid path, not affected by a set CODEX_THREAD_ID"
        rm -rf "$sbx"
        return 1
    fi

    rm -rf "$sbx"
    return 0
}

# =============================================================================
# Static checks: bash conventions (3.2 compat, set -euo pipefail)
# =============================================================================

test_script_declares_set_euo_pipefail() {
    if grep -q '^set -euo pipefail$' "$LEDGER_SCRIPT"; then
        return 0
    else
        echo "ASSERTION FAILED: omt-ledger.sh should declare 'set -euo pipefail'"
        return 1
    fi
}

test_script_has_no_associative_arrays() {
    if grep -qE 'declare -A' "$LEDGER_SCRIPT"; then
        echo "ASSERTION FAILED: omt-ledger.sh must not use associative arrays (macOS Bash 3.2 compat)"
        return 1
    fi
    return 0
}

# =============================================================================
# Main Test Runner
# =============================================================================

main() {
    echo "=========================================="
    echo "omt-ledger.sh Tests"
    echo "=========================================="

    run_test test_first_append_creates_six_section_skeleton
    run_test test_append_places_content_under_correct_section_not_others
    run_test test_now_called_twice_keeps_only_latest_content
    run_test test_now_replace_does_not_disturb_other_sections
    run_test test_metachar_multibyte_payload_stored_losslessly
    run_test test_hashline_in_content_does_not_misroute_later_append
    run_test test_content_line_matching_header_does_not_create_false_boundary
    run_test test_already_escaped_looking_content_gets_double_escaped_on_write
    run_test test_missing_target_header_refuses_instead_of_silent_loss
    run_test test_concurrent_append_serializes_via_lock
    run_test test_default_session_id_refuses_and_creates_no_file
    run_test test_empty_session_id_refuses_and_creates_no_file
    run_test test_ledger_absent_when_never_invoked
    run_test test_invalid_section_name_rejected
    run_test test_success_produces_no_stdout_path_leak
    run_test test_script_declares_set_euo_pipefail
    run_test test_script_has_no_associative_arrays
    run_test_raw test_codex_thread_id_fallback_used_when_omt_session_id_unset
    run_test_raw test_present_unsafe_omt_session_id_refuses_without_fallback
    run_test_raw test_claude_env_first_unchanged_with_sandboxed_omt_dir

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
}

main "$@"

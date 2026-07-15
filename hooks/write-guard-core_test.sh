#!/bin/bash
# =============================================================================
# Write-Guard Core Tests (codex-ledger-parity plan, TODO 2)
# Covers hooks/write-guard-core.sh: write_guard_core_run <OMT_DIR> <session_id>
# reads newline-separated already-absolutized candidate paths on stdin and
# emits the deny JSON iff a candidate is FULL-PATH EXACT equal to
# $OMT_DIR/session-ledger-<sid>.md -- never a bare substring match (the loose
# classifier this core supersedes: hooks/pre-tool-enforcer.sh:42-77
# _wg_ledger_target_in_segment).
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORE="$SCRIPT_DIR/write-guard-core.sh"

# EVIDENCE_OMT_DIR: self-derived (not ambient $OMT_DIR) so this suite runs
# clean under `env -u OMT_DIR`, mirroring hooks/codex-write-guard_test.sh's
# own EVIDENCE_OMT_DIR derivation via resolve_omt_dir.
EVIDENCE_OMT_DIR=$(bash -c "source '$SCRIPT_DIR/lib/omt-dir.sh'; resolve_omt_dir '$SCRIPT_DIR'")

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

OD="$TEST_TMP_DIR/omt-wg"
SID="s1"

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
# AC1 -- byte-identical deny: write_guard_core_run emits EXACTLY the golden
# deny JSON. The golden is pinned here as a literal, deliberately duplicated
# from write-guard-core.sh's _wg_core_deny_json so any drift in that SSOT
# fails this test -- reading the string from the SUT would be a tautology.
# It was originally read from merge-base's pre-tool-enforcer.sh:_wg_deny_json,
# but that string has since moved into write-guard-core.sh and no longer
# exists at that git path (the merge-base anchor advanced past the move once
# it merged to main), so the golden is pinned directly instead.
# =============================================================================
test_ac1_byte_identical_deny() {
    local expected out
    expected='{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Blocked: direct write/delete targets the durable session ledger (session-ledger-*.md). Use hooks/omt-ledger.sh append/now instead."}}'
    out=$(printf '%s\n' "$OD/session-ledger-$SID.md" | bash -c "source '$CORE'; write_guard_core_run '$OD' '$SID'")
    if [ "$out" = "$expected" ] && printf '%s' "$out" | grep -q '"hookEventName":"PreToolUse"'; then
        return 0
    else
        echo "ASSERTION FAILED AC1: expected='$expected' out='$out'"
        return 1
    fi
}

# =============================================================================
# AC2 -- a session-ledger-<sid>.md path in a DIFFERENT directory (previously
# loose-blocked by the substring classifier) now ALLOWS.
# =============================================================================
test_ac2_different_dir_session_ledger_allows() {
    local out
    out=$(printf '%s\n' "/some/other/dir/session-ledger-$SID.md" | bash -c "source '$CORE'; write_guard_core_run '$OD' '$SID'")
    if [ -z "$out" ]; then
        return 0
    else
        echo "ASSERTION FAILED AC2: expected empty (ALLOW), got '$out'"
        return 1
    fi
}

# =============================================================================
# QA Scenario -- substring-but-not-anchor filename -> ALLOW.
# =============================================================================
test_qa_substring_but_not_anchor_allows() {
    local out evidence_dir
    out=$(printf '%s\n' "/tmp/draft-session-ledger-notes.md" | bash -c "source '$CORE'; write_guard_core_run '$OD' '$SID'")
    evidence_dir="$EVIDENCE_OMT_DIR/evidence/codex-ledger-parity/write-guard-core"
    mkdir -p "$evidence_dir"
    {
        echo "input: /tmp/draft-session-ledger-notes.md (OMT_DIR=$OD sid=$SID)"
        echo "output: '$out'"
    } > "$evidence_dir/substring-allow.txt"
    if [ -z "$out" ]; then
        return 0
    else
        echo "ASSERTION FAILED QA-substring-allow: expected empty (ALLOW), got '$out'"
        return 1
    fi
}

# =============================================================================
# QA Scenario -- exact current-session ledger -> DENY, protection preserved.
# =============================================================================
test_qa_exact_current_ledger_denies() {
    local out evidence_dir
    out=$(printf '%s\n' "$OD/session-ledger-$SID.md" | bash -c "source '$CORE'; write_guard_core_run '$OD' '$SID'")
    evidence_dir="$EVIDENCE_OMT_DIR/evidence/codex-ledger-parity/write-guard-core"
    mkdir -p "$evidence_dir"
    {
        echo "input: $OD/session-ledger-$SID.md (OMT_DIR=$OD sid=$SID)"
        echo "output: $out"
    } > "$evidence_dir/exact-deny.txt"
    if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        return 0
    else
        echo "ASSERTION FAILED QA-exact-deny: expected deny JSON, got '$out'"
        return 1
    fi
}

# =============================================================================
# Regression (claim N) -- non-canonical path spellings must not bypass the
# pure-string EXACT match. write_guard_core_run compared candidate paths to
# the ledger path with a pure string `==`, so a candidate with a
# non-canonical segment ('./', '//', 'a/../') preserved still lexically
# resolves to the real ledger path but does NOT string-match it, and was
# silently ALLOWED. Each DENY case below targets the resolved current-session
# ledger via a non-canonical spelling; the final case is a non-ledger control
# proving the fix does not over-block.
# =============================================================================
test_regression_dot_segment_denies() {
    local out
    out=$(printf '%s\n' "$OD/./session-ledger-$SID.md" | bash -c "source '$CORE'; write_guard_core_run '$OD' '$SID'")
    if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        return 0
    else
        echo "ASSERTION FAILED regression-dot-segment: expected deny for '$OD/./session-ledger-$SID.md', got '$out'"
        return 1
    fi
}

test_regression_double_slash_denies() {
    local out
    out=$(printf '%s\n' "$OD//session-ledger-$SID.md" | bash -c "source '$CORE'; write_guard_core_run '$OD' '$SID'")
    if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        return 0
    else
        echo "ASSERTION FAILED regression-double-slash: expected deny for '$OD//session-ledger-$SID.md', got '$out'"
        return 1
    fi
}

test_regression_dotdot_segment_denies() {
    local out
    out=$(printf '%s\n' "$OD/sub/../session-ledger-$SID.md" | bash -c "source '$CORE'; write_guard_core_run '$OD' '$SID'")
    if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        return 0
    else
        echo "ASSERTION FAILED regression-dotdot-segment: expected deny for '$OD/sub/../session-ledger-$SID.md', got '$out'"
        return 1
    fi
}

test_regression_dot_segment_non_ledger_allows() {
    local out
    out=$(printf '%s\n' "$OD/./other-notes.md" | bash -c "source '$CORE'; write_guard_core_run '$OD' '$SID'")
    if [ -z "$out" ]; then
        return 0
    else
        echo "ASSERTION FAILED regression-dot-segment-allow: expected empty (ALLOW), got '$out'"
        return 1
    fi
}

# =============================================================================
# Glob bypass (CONFIRMED defect) -- an unquoted glob candidate never
# EXACT-string-matches the ledger path, but if the glob pattern itself
# matches the resolved ledger path, running that command (e.g. `rm
# "$OMT_DIR"/session-ledger-*.md`) destroys the current session ledger. The
# core must also deny when a candidate glob pattern matches the ledger path,
# not just on EXACT string equality.
# =============================================================================
test_glob_ledger_star_denies() {
    local out
    out=$(printf '%s\n' "$OD/session-ledger-*.md" | bash -c "source '$CORE'; write_guard_core_run '$OD' '$SID'")
    if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        return 0
    else
        echo "ASSERTION FAILED glob-ledger-star: expected deny for '$OD/session-ledger-*.md', got '$out'"
        return 1
    fi
}

test_glob_dir_star_denies() {
    local out
    out=$(printf '%s\n' "$OD/*" | bash -c "source '$CORE'; write_guard_core_run '$OD' '$SID'")
    if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        return 0
    else
        echo "ASSERTION FAILED glob-dir-star: expected deny for '$OD/*', got '$out'"
        return 1
    fi
}

test_glob_non_matching_star_allows() {
    local out
    out=$(printf '%s\n' "$OD/other-*.md" | bash -c "source '$CORE'; write_guard_core_run '$OD' '$SID'")
    if [ -z "$out" ]; then
        return 0
    else
        echo "ASSERTION FAILED glob-non-matching-star: expected empty (ALLOW), got '$out'"
        return 1
    fi
}

# =============================================================================
# False-block regression (precision defect) -- an ANCESTOR-level glob (e.g.
# "$HOME/*") must ALLOW, not deny. Bash `case` lets `*` span the `/`
# separator, unlike real shell pathname expansion where `*` matches within
# ONE path segment only. The ledger sits nested below the glob's directory
# ($ANCESTOR_PARENT/.omt/proj/session-ledger-<sid>.md); at real runtime
# "$ANCESTOR_PARENT"/* expands only to $ANCESTOR_PARENT's direct children
# (skipping the dot-prefixed .omt dir) and never touches the ledger, so the
# guard must not deny it.
# =============================================================================
test_glob_ancestor_star_allows() {
    local ancestor_parent ancestor_od out
    ancestor_parent="$TEST_TMP_DIR/ancestor-home"
    ancestor_od="$ancestor_parent/.omt/proj"
    out=$(printf '%s\n' "$ancestor_parent/*" | bash -c "source '$CORE'; write_guard_core_run '$ancestor_od' '$SID'")
    if [ -z "$out" ]; then
        return 0
    else
        echo "ASSERTION FAILED glob-ancestor-star: expected empty (ALLOW), got '$out'"
        return 1
    fi
}

# =============================================================================
# Glob bypass (CONFIRMED P1 defect) -- a glob in a DIRECTORY component (not
# the basename) at the SAME depth as the ledger's own parent segment. At real
# runtime, e.g. `rm "$OMT_DIR/"*"/session-ledger-<sid>.md"`, the `*` expands
# within the single project-dir segment and reaches the real ledger -- but
# the old dir-EXACT + basename-glob check compared the candidate's whole
# directory part ("$OMT_DIR/*") against the ledger's directory part
# ("$OMT_DIR/omt-wg") with plain string `=`, which never matches, so it
# WRONGLY ALLOWED. The fix does a component-wise glob match with depth
# (segment-count) equality instead.
# =============================================================================
test_glob_dir_component_denies() {
    local out cand
    cand="${OD%/*}/*/session-ledger-$SID.md"
    out=$(printf '%s\n' "$cand" | bash -c "source '$CORE'; write_guard_core_run '$OD' '$SID'")
    if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        return 0
    else
        echo "ASSERTION FAILED glob-dir-component: expected deny for '$cand', got '$out'"
        return 1
    fi
}

# =============================================================================
# Depth-mismatch regression (precision defect) -- a dir-component glob that
# is ONE segment SHALLOWER than the ledger (it stops at the ledger's parent
# dir, never supplying a filename segment) must ALLOW: at real runtime
# "$TEST_TMP_DIR"/* only expands to $TEST_TMP_DIR's direct children (the
# "omt-wg" dir itself), never descending into it to reach the ledger file.
# Proves the component-wise match enforces equal segment count, not just
# per-segment glob matching.
# =============================================================================
test_glob_dir_component_wrong_depth_allows() {
    local out cand
    cand="${OD%/*}/*"
    out=$(printf '%s\n' "$cand" | bash -c "source '$CORE'; write_guard_core_run '$OD' '$SID'")
    if [ -z "$out" ]; then
        return 0
    else
        echo "ASSERTION FAILED glob-dir-component-wrong-depth: expected empty (ALLOW), got '$out'"
        return 1
    fi
}

# =============================================================================
# Main
# =============================================================================

main() {
    echo "=========================================="
    echo "Write-Guard Core Tests"
    echo "=========================================="

    run_test test_ac1_byte_identical_deny
    run_test test_ac2_different_dir_session_ledger_allows
    run_test test_qa_substring_but_not_anchor_allows
    run_test test_qa_exact_current_ledger_denies
    run_test test_regression_dot_segment_denies
    run_test test_regression_double_slash_denies
    run_test test_regression_dotdot_segment_denies
    run_test test_regression_dot_segment_non_ledger_allows
    run_test test_glob_ledger_star_denies
    run_test test_glob_dir_star_denies
    run_test test_glob_non_matching_star_allows
    run_test test_glob_ancestor_star_allows
    run_test test_glob_dir_component_denies
    run_test test_glob_dir_component_wrong_depth_allows

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [ "$TESTS_FAILED" -gt 0 ]; then
        exit 1
    fi
}

main "$@"

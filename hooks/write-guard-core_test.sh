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
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
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
# AC1 -- byte-identical deny vs the branch-point _wg_deny_json SSOT.
# Anchored at merge-base(HEAD, main), NOT HEAD -- a later task moves
# _wg_deny_json out of pre-tool-enforcer.sh, which would make a HEAD read
# return empty on re-run.
# =============================================================================
test_ac1_byte_identical_deny_at_branch_point() {
    local base expected out
    base=$(git -C "$ROOT_DIR" merge-base HEAD main)
    expected=$(git -C "$ROOT_DIR" show "$base:hooks/pre-tool-enforcer.sh" | grep '^_wg_deny_json=' | cut -d"'" -f2)
    out=$(printf '%s\n' "$OD/session-ledger-$SID.md" | bash -c "source '$CORE'; write_guard_core_run '$OD' '$SID'")
    if [ -n "$expected" ] && [ "$out" = "$expected" ] && printf '%s' "$out" | grep -q '"hookEventName":"PreToolUse"'; then
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
# Main
# =============================================================================

main() {
    echo "=========================================="
    echo "Write-Guard Core Tests"
    echo "=========================================="

    run_test test_ac1_byte_identical_deny_at_branch_point
    run_test test_ac2_different_dir_session_ledger_allows
    run_test test_qa_substring_but_not_anchor_allows
    run_test test_qa_exact_current_ledger_denies

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [ "$TESTS_FAILED" -gt 0 ]; then
        exit 1
    fi
}

main "$@"

#!/bin/bash
# =============================================================================
# ledger-core.sh Tests (plan TODO 1: codex-ledger-parity)
#
# Behavioral tests for the shared cross-platform ledger recording + compaction
# recovery core. Sources hooks/ledger-core.sh directly and drives
# ledger_core_run <claude|codex> via synthetic SessionStart stdin JSON,
# mirroring the established harness pattern in
# hooks/session-start_test.sh:1542-1575 (synthetic-stdin -> grep the raw
# stdout; the plan's own ACs grep raw $out rather than jq-decoding first).
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LEDGER_CORE="$SCRIPT_DIR/ledger-core.sh"

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

# =============================================================================
# AC1: source==compact, populated <=7000-char ledger, platform=claude ->
# [LEDGER RECOVERY] + inline `## Now` body + env-var pointer form (contains
# the literal token OMT_SESSION_ID).
# =============================================================================
test_ac1_claude_compact_inline_recovery_env_pointer() {
    local SBX OD out
    SBX=$(mktemp -d)
    OD="$SBX/omt"
    mkdir -p "$OD"
    printf '## Now\nCURRENT-STATE-XYZ\n## User Corrections (verbatim)\n' > "$OD/session-ledger-test-sid-1.md"

    out=$(printf '{"source":"compact","session_id":"test-sid-1","cwd":"%s"}' "$SBX" \
        | OMT_DIR="$OD" OMT_SESSION_ID=test-sid-1 bash -c "source '$LEDGER_CORE'; ledger_core_run claude")

    local ok=0
    if echo "$out" | grep -q '\[LEDGER RECOVERY\]' \
        && echo "$out" | grep -q 'CURRENT-STATE-XYZ' \
        && echo "$out" | grep -q 'OMT_SESSION_ID'; then
        ok=1
    fi

    rm -rf "$SBX"
    [ "$ok" = "1" ]
}

# =============================================================================
# AC2: platform=codex, >7000-char ledger -> pointer branch. No CLAUDE_ENV_FILE,
# no unexpanded $OMT_DIR/$OMT_SESSION_ID; DOES contain the resolved absolute
# ledger path.
# =============================================================================
test_ac2_codex_over_cap_pointer_no_leak() {
    local SBX OD out
    SBX=$(mktemp -d)
    OD="$SBX/omt"
    mkdir -p "$OD"
    head -c 8000 /dev/zero | tr '\0' 'x' > "$OD/session-ledger-test-sid-1.md"
    printf '## Now\nN\n' >> "$OD/session-ledger-test-sid-1.md"

    out=$(printf '{"source":"compact","session_id":"test-sid-1","cwd":"%s"}' "$SBX" \
        | OMT_DIR="$OD" bash -c "unset OMT_SESSION_ID CODEX_THREAD_ID; source '$LEDGER_CORE'; ledger_core_run codex")

    local ok=0
    if [ "$(printf '%s' "$out" | grep -c 'CLAUDE_ENV_FILE')" = "0" ] \
        && [ "$(printf '%s' "$out" | grep -c '\$OMT_DIR')" = "0" ] \
        && [ "$(printf '%s' "$out" | grep -c '\$OMT_SESSION_ID')" = "0" ] \
        && echo "$out" | grep -q "$OD/session-ledger-test-sid-1.md"; then
        ok=1
    fi

    rm -rf "$SBX"
    [ "$ok" = "1" ]
}

# =============================================================================
# AC3: platform=codex, <=7000-char ledger (inline branch) -> ALSO leaks
# nothing (the pointer + env note is emitted on Claude in this branch too, so
# the Codex guard must hold here as well).
# =============================================================================
test_ac3_codex_inline_no_leak() {
    local SBX OD out
    SBX=$(mktemp -d)
    OD="$SBX/omt"
    mkdir -p "$OD"
    printf '## Now\nSMALL-INLINE\n## User Corrections (verbatim)\n' > "$OD/session-ledger-test-sid-1.md"

    out=$(printf '{"source":"compact","session_id":"test-sid-1","cwd":"%s"}' "$SBX" \
        | OMT_DIR="$OD" bash -c "unset OMT_SESSION_ID CODEX_THREAD_ID; source '$LEDGER_CORE'; ledger_core_run codex")

    local ok=0
    if printf '%s' "$out" | grep -q 'SMALL-INLINE' \
        && [ "$(printf '%s' "$out" | grep -c 'CLAUDE_ENV_FILE')" = "0" ] \
        && [ "$(printf '%s' "$out" | grep -c '\$OMT_DIR')" = "0" ] \
        && [ "$(printf '%s' "$out" | grep -c '\$OMT_SESSION_ID')" = "0" ]; then
        ok=1
    fi

    rm -rf "$SBX"
    [ "$ok" = "1" ]
}

# =============================================================================
# QA Scenario: Recording instruction on non-compact source — every-source
# recording emit; recovery absent on a non-compact source.
# Evidence: $OMT_DIR/evidence/codex-ledger-parity/ledger-core/recording-noncompact.txt
# =============================================================================
test_qa_recording_noncompact() {
    local out ok=0
    out=$(printf '{"source":"startup","session_id":"s","cwd":"/tmp"}' \
        | OMT_DIR=/tmp/x OMT_SESSION_ID=s bash -c "source '$LEDGER_CORE'; ledger_core_run claude")

    if echo "$out" | grep -q '\[LEDGER RECORDING\]' \
        && [ "$(printf '%s' "$out" | grep -c '\[LEDGER RECOVERY\]')" = "0" ]; then
        ok=1
    fi

    local evidence_dir
    evidence_dir=$(bash -c "source '$SCRIPT_DIR/lib/omt-dir.sh'; resolve_omt_dir '$SCRIPT_DIR'")/evidence/codex-ledger-parity/ledger-core
    mkdir -p "$evidence_dir"
    {
        echo "# QA Scenario: Recording instruction on non-compact source"
        echo "# Command: printf '{\"source\":\"startup\",...}' | OMT_DIR=/tmp/x OMT_SESSION_ID=s bash -c \"source hooks/ledger-core.sh; ledger_core_run claude\""
        echo "# Result: ok=$ok (1=PASS, 0=FAIL)"
        echo "---- stdout ----"
        echo "$out"
    } > "$evidence_dir/recording-noncompact.txt"

    [ "$ok" = "1" ]
}

# =============================================================================
# QA Scenario: jq absent — graceful degrade (empty stdout, exit 0).
# Evidence: $OMT_DIR/evidence/codex-ledger-parity/ledger-core/jq-absent.txt
# =============================================================================
test_qa_jq_absent() {
    local out rc ok=0
    set +e
    # /bin/bash (absolute path), not a bare `bash` lookup: on this host the
    # calling shell is zsh, which re-resolves an assignment-prefixed command
    # name against the NEW PATH being assigned -- `PATH=/nonexistent bash`
    # fails with "command not found" (exit 127) before ever reaching
    # ledger-core.sh, since zsh can no longer locate `bash` itself under the
    # now-empty PATH. The absolute path sidesteps that lookup entirely while
    # still handing the child process PATH=/nonexistent, so `command -v jq`
    # inside ledger_core_run correctly reports jq as absent.
    out=$(printf '{"source":"compact","session_id":"s","cwd":"/tmp"}' \
        | PATH=/nonexistent OMT_DIR=/tmp/x OMT_SESSION_ID=s /bin/bash -c "source '$LEDGER_CORE'; ledger_core_run claude" 2>/dev/null)
    rc=$?
    set -e

    if [ "$rc" = "0" ] && [ -z "$out" ]; then
        ok=1
    fi

    local evidence_dir
    evidence_dir=$(bash -c "source '$SCRIPT_DIR/lib/omt-dir.sh'; resolve_omt_dir '$SCRIPT_DIR'")/evidence/codex-ledger-parity/ledger-core
    mkdir -p "$evidence_dir"
    {
        echo "# QA Scenario: jq absent -- graceful degrade"
        echo "# Command: printf '...' | PATH=/nonexistent OMT_DIR=/tmp/x OMT_SESSION_ID=s bash -c \"source hooks/ledger-core.sh; ledger_core_run claude\""
        echo "# exit code: $rc"
        echo "# stdout empty: $([ -z "$out" ] && echo yes || echo no)"
        echo "# Result: ok=$ok (1=PASS, 0=FAIL)"
    } > "$evidence_dir/jq-absent.txt"

    [ "$ok" = "1" ]
}

# =============================================================================
# Additional coverage (plan MUST DO items 4/5, folded into the AC/QA set above
# where not already exercised): non-compact source on the codex signal must
# also emit RECORDING without RECOVERY (mirrors the claude-signal QA scenario).
# =============================================================================
test_codex_noncompact_recording_only() {
    local out ok=0
    out=$(printf '{"source":"startup","session_id":"s","cwd":"/tmp"}' \
        | OMT_DIR=/tmp/x OMT_SESSION_ID=s bash -c "source '$LEDGER_CORE'; ledger_core_run codex")

    if echo "$out" | grep -q '\[LEDGER RECORDING\]' \
        && [ "$(printf '%s' "$out" | grep -c '\[LEDGER RECOVERY\]')" = "0" ]; then
        ok=1
    fi
    [ "$ok" = "1" ]
}

# =============================================================================
# Main
# =============================================================================
main() {
    echo "=========================================="
    echo "ledger-core.sh Tests"
    echo "=========================================="

    run_test test_ac1_claude_compact_inline_recovery_env_pointer
    run_test test_ac2_codex_over_cap_pointer_no_leak
    run_test test_ac3_codex_inline_no_leak
    run_test test_qa_recording_noncompact
    run_test test_qa_jq_absent
    run_test test_codex_noncompact_recording_only

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [ "$TESTS_FAILED" -gt 0 ]; then
        exit 1
    fi
}

main "$@"

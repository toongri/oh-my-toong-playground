#!/bin/bash
# =============================================================================
# codex-ledger.sh Tests (plan TODO 6: codex-ledger-parity)
#
# Behavioral tests for the thin Codex SessionStart ledger hook. Drives
# hooks/codex-ledger.sh via synthetic SessionStart stdin JSON, mirroring the
# harness pattern in hooks/session-start_test.sh:1542-1575 (synthetic-stdin ->
# jq-decode the raw stdout).
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$SCRIPT_DIR/codex-ledger.sh"

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
# AC: source==compact emits SessionStart additionalContext with
# [LEDGER RECOVERY] and OMITS `continue`.
# =============================================================================
test_compact_emits_recovery_no_continue() {
    local SBX OD out ok=0
    SBX=$(mktemp -d)
    OD="$SBX/omt"
    mkdir -p "$OD"
    printf '## Now\nCX\n## User Corrections (verbatim)\n' > "$OD/session-ledger-cx-sid.md"

    out=$(printf '{"source":"compact","session_id":"cx-sid","cwd":"%s"}' "$SBX" \
        | OMT_DIR="$OD" bash -c "unset OMT_SESSION_ID CODEX_THREAD_ID; exec bash '$HOOK'" 2>/dev/null)

    if echo "$out" | jq -e '.hookSpecificOutput.hookEventName=="SessionStart"' >/dev/null 2>&1 \
        && echo "$out" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null | grep -q '\[LEDGER RECOVERY\]' \
        && [ "$(printf '%s' "$out" | jq 'has("continue")')" = "false" ]; then
        ok=1
    fi

    rm -rf "$SBX"
    [ "$ok" = "1" ]
}

# =============================================================================
# QA Scenario: Recording on Codex startup -- part-2 on Codex.
# Evidence: $OMT_DIR/evidence/codex-ledger-parity/codex-ledger-hook/recording-startup.txt
# =============================================================================
test_qa_recording_startup_no_claude_env_leak() {
    local out ctx ok=0
    out=$(printf '{"source":"startup","session_id":"cx","cwd":"/tmp"}' \
        | OMT_DIR=/tmp/x bash "$HOOK" 2>/dev/null)
    ctx=$(printf '%s' "$out" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null || echo "")

    if echo "$ctx" | grep -q '\[LEDGER RECORDING\]' \
        && [ "$(printf '%s' "$ctx" | grep -c 'CLAUDE_ENV_FILE')" = "0" ]; then
        ok=1
    fi

    local evidence_dir
    evidence_dir=$(bash -c "source '$SCRIPT_DIR/lib/omt-dir.sh'; resolve_omt_dir '$SCRIPT_DIR'")/evidence/codex-ledger-parity/codex-ledger-hook
    mkdir -p "$evidence_dir"
    {
        echo "# QA Scenario: Recording on Codex startup"
        echo "# Command: printf '{\"source\":\"startup\",...}' | OMT_DIR=/tmp/x bash hooks/codex-ledger.sh"
        echo "# Result: ok=$ok (1=PASS, 0=FAIL)"
        echo "---- additionalContext ----"
        echo "$ctx"
    } > "$evidence_dir/recording-startup.txt"

    [ "$ok" = "1" ]
}

# =============================================================================
# QA Scenario: No-continue contract -- cross-platform-valid shape.
# Evidence: $OMT_DIR/evidence/codex-ledger-parity/codex-ledger-hook/no-continue.txt
# =============================================================================
test_qa_no_continue_contract() {
    local out ok=0
    out=$(printf '{"source":"startup","session_id":"cx","cwd":"/tmp"}' \
        | OMT_DIR=/tmp/x bash "$HOOK" 2>/dev/null)

    if [ "$(printf '%s' "$out" | jq 'has("continue")')" = "false" ]; then
        ok=1
    fi

    local evidence_dir
    evidence_dir=$(bash -c "source '$SCRIPT_DIR/lib/omt-dir.sh'; resolve_omt_dir '$SCRIPT_DIR'")/evidence/codex-ledger-parity/codex-ledger-hook
    mkdir -p "$evidence_dir"
    {
        echo "# QA Scenario: No-continue contract"
        echo "# Command: printf '{\"source\":\"startup\",...}' | OMT_DIR=/tmp/x bash hooks/codex-ledger.sh"
        echo "# Result: ok=$ok (1=PASS, 0=FAIL)"
        echo "---- stdout ----"
        echo "$out"
    } > "$evidence_dir/no-continue.txt"

    [ "$ok" = "1" ]
}

# =============================================================================
# Main
# =============================================================================
main() {
    echo "=========================================="
    echo "codex-ledger.sh Tests"
    echo "=========================================="

    run_test test_compact_emits_recovery_no_continue
    run_test test_qa_recording_startup_no_claude_env_leak
    run_test test_qa_no_continue_contract

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [ "$TESTS_FAILED" -gt 0 ]; then
        exit 1
    fi
}

main "$@"

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
# SUB-FIX 3: codex recording string's CODEX_HOME writer path must not double
# to ~/.codex/.codex/hooks/omt-ledger.sh when CODEX_HOME is exported (the
# conventional case). The taught literal template must read
# "${CODEX_HOME:-$HOME/.codex}/hooks/omt-ledger.sh" (default folds .codex into
# the fallback), never the doubled "${CODEX_HOME:-$HOME}/.codex/hooks/" form.
# =============================================================================
test_codex_home_path_not_doubled() {
    local out ok=0
    out=$(printf '{"source":"startup","session_id":"s","cwd":"/tmp"}' \
        | OMT_DIR=/tmp/x OMT_SESSION_ID=s bash -c "source '$LEDGER_CORE'; ledger_core_run codex")

    if echo "$out" | grep -qF '${CODEX_HOME:-$HOME/.codex}/hooks/omt-ledger.sh' \
        && [ "$(printf '%s' "$out" | grep -cF '${CODEX_HOME:-$HOME}/.codex/hooks/')" = "0" ] \
        && [ "$(printf '%s' "$out" | grep -cF '.codex/.codex')" = "0" ]; then
        ok=1
    fi

    [ "$ok" = "1" ]
}

# =============================================================================
# AC1: source==compact, populated <=7000-char ledger, platform=claude ->
# a [LEDGER RECOVERY marker (core owns the platform-qualified form, see AC4)
# + inline `## Now` body + env-var pointer form (contains the literal token
# OMT_SESSION_ID).
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
    if echo "$out" | grep -q '\[LEDGER RECOVERY' \
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
#
# The 8000-char payload MUST live under the "## Now" header (not before it):
# ledger-core.sh's recovery extractor keeps only content following the
# "## Now"/"## User Corrections (verbatim)" headers, so padding placed BEFORE
# "## Now" is discarded by the extractor and never reaches the >7000-char
# inline-cap check at all -- that would make the pointer branch fire for the
# wrong reason (an empty extracted acute) instead of the over-cap reason this
# test claims to cover. Assertions distinguish the over-cap/pointer branch
# from the inline branch by their branch-unique literal text ("exceed the
# inline cap" vs "inlined below"), and confirm the original "no leak" intent
# by asserting the raw x-payload itself never appears in the output (only the
# inline branch would ever embed it).
# =============================================================================
test_ac2_codex_over_cap_pointer_no_leak() {
    local SBX OD out
    SBX=$(mktemp -d)
    OD="$SBX/omt"
    mkdir -p "$OD"
    {
        printf '## Now\n'
        head -c 8000 /dev/zero | tr '\0' 'x'
        printf '\n## User Corrections (verbatim)\n'
    } > "$OD/session-ledger-test-sid-1.md"

    out=$(printf '{"source":"compact","session_id":"test-sid-1","cwd":"%s"}' "$SBX" \
        | OMT_DIR="$OD" bash -c "unset OMT_SESSION_ID CODEX_THREAD_ID; source '$LEDGER_CORE'; ledger_core_run codex")

    local ok=0
    if [ "$(printf '%s' "$out" | grep -c 'CLAUDE_ENV_FILE')" = "0" ] \
        && [ "$(printf '%s' "$out" | grep -c '\$OMT_DIR')" = "0" ] \
        && [ "$(printf '%s' "$out" | grep -c '\$OMT_SESSION_ID')" = "0" ] \
        && echo "$out" | grep -q "$OD/session-ledger-test-sid-1.md" \
        && echo "$out" | grep -qF 'exceed the inline cap' \
        && [ "$(printf '%s' "$out" | grep -c 'inlined below')" = "0" ] \
        && [ "$(printf '%s' "$out" | grep -cE 'x{50,}')" = "0" ]; then
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
# QA Scenario: jq absent -- [LEDGER RECORDING] still fires (static text,
# needs neither jq nor the sid); [LEDGER RECOVERY] is correctly ABSENT since
# recovery legitimately needs jq to parse stdin (.source/.session_id/.cwd)
# and locate the ledger file. Byte-preservation regression fix: the recording
# instruction used to be emitted unconditionally by the pre-delegation hook,
# independent of jq presence -- ledger_core_run must preserve that.
# Evidence: $OMT_DIR/evidence/codex-ledger-parity/ledger-core/jq-absent.txt
# =============================================================================
test_qa_jq_absent() {
    local out rc ok=0

    # Build a PATH that lacks jq but keeps cat/sed available: on this host jq
    # lives in /usr/bin alongside sed, so a blanket PATH=/nonexistent (or
    # simply dropping /usr/bin) would ALSO break sed -- and sed now runs
    # unconditionally in the Emit step (since recording emits regardless of
    # jq), so that blunter approach would corrupt the JSON output and mask
    # the very regression this test guards against. Symlink only sed in so
    # jq itself stays genuinely unresolvable via PATH.
    local jq_less_bin
    jq_less_bin=$(mktemp -d)
    ln -s /usr/bin/sed "$jq_less_bin/sed"

    set +e
    # /bin/bash (absolute path), not a bare `bash` lookup: on this host the
    # calling shell is zsh, which re-resolves an assignment-prefixed command
    # name against the NEW PATH being assigned -- `PATH=... bash` fails with
    # "command not found" (exit 127) before ever reaching ledger-core.sh if
    # `bash` itself isn't on the restricted PATH. The absolute path
    # sidesteps that lookup entirely while still handing the child process
    # the restricted PATH, so `command -v jq` inside ledger_core_run
    # correctly reports jq as absent.
    out=$(printf '{"source":"compact","session_id":"s","cwd":"/tmp"}' \
        | PATH="$jq_less_bin:/bin" OMT_DIR=/tmp/x OMT_SESSION_ID=s /bin/bash -c "source '$LEDGER_CORE'; ledger_core_run claude" 2>/dev/null)
    rc=$?
    set -e
    rm -rf "$jq_less_bin"

    if [ "$rc" = "0" ] \
        && echo "$out" | grep -q '\[LEDGER RECORDING\]' \
        && [ "$(printf '%s' "$out" | grep -c '\[LEDGER RECOVERY\]')" = "0" ]; then
        ok=1
    fi

    local evidence_dir
    evidence_dir=$(bash -c "source '$SCRIPT_DIR/lib/omt-dir.sh'; resolve_omt_dir '$SCRIPT_DIR'")/evidence/codex-ledger-parity/ledger-core
    mkdir -p "$evidence_dir"
    {
        echo "# QA Scenario: jq absent -- recording survives, recovery correctly absent"
        echo "# Command: printf '...' | PATH=<no-jq> OMT_DIR=/tmp/x OMT_SESSION_ID=s bash -c \"source hooks/ledger-core.sh; ledger_core_run claude\""
        echo "# exit code: $rc"
        echo "# Result: ok=$ok (1=PASS, 0=FAIL)"
        echo "---- stdout ----"
        echo "$out"
    } > "$evidence_dir/jq-absent.txt"

    [ "$ok" = "1" ]
}

# =============================================================================
# Regression: session_id missing (empty stdin session_id, no OMT_SESSION_ID/
# CODEX_THREAD_ID env fallback) -- [LEDGER RECORDING] still fires;
# [LEDGER RECOVERY] correctly ABSENT (recovery needs a valid resolved sid to
# locate the ledger file). source=compact on purpose: if the sid gate were
# broken, recovery would incorrectly fire here.
# =============================================================================
test_missing_sid_recording_present_recovery_absent() {
    local out ok=0
    out=$(printf '{"source":"compact","session_id":"","cwd":"/tmp"}' \
        | OMT_DIR=/tmp/x bash -c "unset OMT_SESSION_ID CODEX_THREAD_ID; source '$LEDGER_CORE'; ledger_core_run claude")

    if echo "$out" | grep -q '\[LEDGER RECORDING\]' \
        && [ "$(printf '%s' "$out" | grep -c '\[LEDGER RECOVERY\]')" = "0" ]; then
        ok=1
    fi
    [ "$ok" = "1" ]
}

# =============================================================================
# Regression: session_id="default" (refused the same as omt-ledger.sh's own
# empty/default refusal) -- [LEDGER RECORDING] still fires; [LEDGER RECOVERY]
# correctly ABSENT.
# =============================================================================
test_default_sid_recording_present_recovery_absent() {
    local out ok=0
    out=$(printf '{"source":"compact","session_id":"default","cwd":"/tmp"}' \
        | OMT_DIR=/tmp/x bash -c "unset OMT_SESSION_ID CODEX_THREAD_ID; source '$LEDGER_CORE'; ledger_core_run claude")

    if echo "$out" | grep -q '\[LEDGER RECORDING\]' \
        && [ "$(printf '%s' "$out" | grep -c '\[LEDGER RECOVERY\]')" = "0" ]; then
        ok=1
    fi
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
# AC4 (S2: recovery-marker ownership): platform=claude compact-recovery output
# must carry the "-- compaction" qualifier on the [LEDGER RECOVERY] marker
# ITSELF -- i.e. ledger-core.sh must own and emit "[LEDGER RECOVERY --
# compaction]" directly, not the bare "[LEDGER RECOVERY]" that a downstream
# consumer (hooks/session-start.sh) patches in via string substitution.
# =============================================================================
test_ac4_claude_recovery_marker_has_compaction_suffix() {
    local SBX OD out
    SBX=$(mktemp -d)
    OD="$SBX/omt"
    mkdir -p "$OD"
    printf '## Now\nCURRENT-STATE-XYZ\n## User Corrections (verbatim)\n' > "$OD/session-ledger-test-sid-1.md"

    out=$(printf '{"source":"compact","session_id":"test-sid-1","cwd":"%s"}' "$SBX" \
        | OMT_DIR="$OD" OMT_SESSION_ID=test-sid-1 bash -c "source '$LEDGER_CORE'; ledger_core_run claude")

    local ok=0
    if echo "$out" | grep -qF '[LEDGER RECOVERY -- compaction]'; then
        ok=1
    fi

    rm -rf "$SBX"
    [ "$ok" = "1" ]
}

# =============================================================================
# AC5 (S2: recovery-marker ownership): platform=codex compact-recovery output
# must carry the bare "[LEDGER RECOVERY]" marker -- no "-- compaction" suffix,
# since Codex has no compaction-triggered restore concept to qualify.
# =============================================================================
test_ac5_codex_recovery_marker_is_bare() {
    local SBX OD out
    SBX=$(mktemp -d)
    OD="$SBX/omt"
    mkdir -p "$OD"
    printf '## Now\nCURRENT-STATE-XYZ\n## User Corrections (verbatim)\n' > "$OD/session-ledger-test-sid-1.md"

    out=$(printf '{"source":"compact","session_id":"test-sid-1","cwd":"%s"}' "$SBX" \
        | OMT_DIR="$OD" bash -c "unset OMT_SESSION_ID CODEX_THREAD_ID; source '$LEDGER_CORE'; ledger_core_run codex")

    local ok=0
    if echo "$out" | grep -qF '[LEDGER RECOVERY]' \
        && [ "$(printf '%s' "$out" | grep -c -- '-- compaction')" = "0" ]; then
        ok=1
    fi

    rm -rf "$SBX"
    [ "$ok" = "1" ]
}

# =============================================================================
# Main
# =============================================================================
main() {
    echo "=========================================="
    echo "ledger-core.sh Tests"
    echo "=========================================="

    run_test test_codex_home_path_not_doubled
    run_test test_ac1_claude_compact_inline_recovery_env_pointer
    run_test test_ac2_codex_over_cap_pointer_no_leak
    run_test test_ac3_codex_inline_no_leak
    run_test test_qa_recording_noncompact
    run_test test_qa_jq_absent
    run_test test_missing_sid_recording_present_recovery_absent
    run_test test_default_sid_recording_present_recovery_absent
    run_test test_codex_noncompact_recording_only
    run_test test_ac4_claude_recovery_marker_has_compaction_suffix
    run_test test_ac5_codex_recovery_marker_is_bare

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [ "$TESTS_FAILED" -gt 0 ]; then
        exit 1
    fi
}

main "$@"

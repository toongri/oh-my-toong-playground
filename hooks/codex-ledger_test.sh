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

run_event() {
    local od="$1" payload="$2"
    printf '%s' "$payload" | OMT_DIR="$od" env -u OMT_SESSION_ID -u CODEX_THREAD_ID bash "$HOOK" 2>/dev/null
}

test_postcompact_bridges_next_context_event_once() {
    local sbx od out first second
    sbx=$(mktemp -d); od="$sbx/omt"; mkdir -p "$od"
    printf '## Now\nBRIDGE-MARKER\n## Decisions\n## User Corrections (verbatim)\n## Pending\n## Pointers\n## Learnings\n' > "$od/session-ledger-bridge-sid.md"
    run_event "$od" "{\"hook_event_name\":\"PostCompact\",\"session_id\":\"bridge-sid\",\"cwd\":\"$sbx\"}" >/dev/null
    [ -f "$od/codex-ledger-pending-bridge-sid" ] || { rm -rf "$sbx"; return 1; }
    first=$(run_event "$od" "{\"hook_event_name\":\"PostToolUse\",\"session_id\":\"bridge-sid\",\"cwd\":\"$sbx\",\"tool_name\":\"Bash\"}")
    second=$(run_event "$od" "{\"hook_event_name\":\"UserPromptSubmit\",\"session_id\":\"bridge-sid\",\"cwd\":\"$sbx\",\"prompt\":\"next\"}")
    rm -rf "$sbx"
    printf '%s' "$first" | jq -e '.hookSpecificOutput.hookEventName == "PostToolUse" and (.hookSpecificOutput.additionalContext | contains("BRIDGE-MARKER"))' >/dev/null \
        && [ -z "$second" ]
}

test_postcompact_registration_and_context_events() {
    local block
    block=$(awk '/^  PostCompact:/{f=1;next} f && /^  [A-Za-z]/{f=0} f' "$SCRIPT_DIR/../codex.yaml")
    printf '%s\n' "$block" | grep -q 'component: codex-ledger.sh' || return 1
    for event in UserPromptSubmit PostToolUse; do
        block=$(awk -v e="  $event:" '$0==e{f=1;next} f && /^  [A-Za-z]/{f=0} f' "$SCRIPT_DIR/../codex.yaml")
        printf '%s\n' "$block" | grep -q 'component: codex-ledger.sh' || return 1
    done
}

test_pending_invalid_identity_is_silent() {
    local sbx od out
    sbx=$(mktemp -d); od="$sbx/omt"; mkdir -p "$od"
    out=$(run_event "$od" '{"hook_event_name":"PostCompact","session_id":"../escape","cwd":"/tmp"}')
    rm -rf "$sbx"
    [ -z "$out" ]
}

test_postcompact_requires_cwd_and_preserves_second_generation() {
    local sbx od out
    sbx=$(mktemp -d); od="$sbx/omt"; mkdir -p "$od"
    out=$(run_event "$od" '{"hook_event_name":"PostCompact","session_id":"missing-cwd"}')
    if [ -n "$out" ] || [ -e "$od/codex-ledger-pending-missing-cwd" ]; then
        rm -rf "$sbx"
        return 1
    fi
    out=$(run_event "$od" '{"hook_event_name":"PostCompact","session_id":"empty-cwd","cwd":""}')
    if [ -n "$out" ] || [ -e "$od/codex-ledger-pending-empty-cwd" ]; then
        rm -rf "$sbx"
        return 1
    fi
    printf '## Now\nGENERATION-MARKER\n## Decisions\n## User Corrections (verbatim)\n## Pending\n## Pointers\n## Learnings\n' > "$od/session-ledger-generation.md"
    run_event "$od" "{\"hook_event_name\":\"PostCompact\",\"session_id\":\"generation\",\"cwd\":\"$sbx\"}" >/dev/null
    run_event "$od" "{\"hook_event_name\":\"PostCompact\",\"session_id\":\"generation\",\"cwd\":\"$sbx\"}" >/dev/null
    out=$(run_event "$od" "{\"hook_event_name\":\"UserPromptSubmit\",\"session_id\":\"generation\",\"cwd\":\"$sbx\",\"prompt\":\"x\"}")
    [ -n "$out" ] && [ -f "$od/codex-ledger-pending-generation" ] || { rm -rf "$sbx"; return 1; }
    rm -rf "$sbx"
    printf '%s' "$out" | jq -e '.hookSpecificOutput.hookEventName == "UserPromptSubmit" and (.hookSpecificOutput.additionalContext | contains("GENERATION-MARKER"))' >/dev/null
}

test_concurrent_consumers_emit_one_recovery() {
    local sbx od p1 p2 c1 c2 total
    sbx=$(mktemp -d); od="$sbx/omt"; mkdir -p "$od"
    printf '## Now\nCONCURRENT-MARKER\n## Decisions\n## User Corrections (verbatim)\n## Pending\n## Pointers\n## Learnings\n' > "$od/session-ledger-concurrent.md"
    run_event "$od" "{\"hook_event_name\":\"PostCompact\",\"session_id\":\"concurrent\",\"cwd\":\"$sbx\"}" >/dev/null
    p1="$sbx/p1"; p2="$sbx/p2"
    (run_event "$od" "{\"hook_event_name\":\"PostToolUse\",\"session_id\":\"concurrent\",\"cwd\":\"$sbx\"}" >"$p1") & c1=$!
    (run_event "$od" "{\"hook_event_name\":\"UserPromptSubmit\",\"session_id\":\"concurrent\",\"cwd\":\"$sbx\"}" >"$p2") & c2=$!
    wait "$c1"; wait "$c2"
    total=$(cat "$p1" "$p2" | grep -c 'CONCURRENT-MARKER' || true)
    rm -rf "$sbx"
    [ "$total" -eq 1 ]
}

test_missing_ledger_does_not_ack_pending() {
    local sbx od out
    sbx=$(mktemp -d); od="$sbx/omt"; mkdir -p "$od"
    run_event "$od" "{\"hook_event_name\":\"PostCompact\",\"session_id\":\"no-ledger\",\"cwd\":\"$sbx\"}" >/dev/null
    out=$(run_event "$od" "{\"hook_event_name\":\"UserPromptSubmit\",\"session_id\":\"no-ledger\",\"cwd\":\"$sbx\"}")
    if [ -n "$out" ] || [ ! -f "$od/codex-ledger-pending-no-ledger" ]; then
        rm -rf "$sbx"
        return 1
    fi
    rm -rf "$sbx"
}

test_dead_claim_is_reclaimable() {
    local sbx od out marker
    sbx=$(mktemp -d); od="$sbx/omt"; mkdir -p "$od"
    printf '## Now\nSTALE-CLAIM-MARKER\n## Decisions\n## User Corrections (verbatim)\n## Pending\n## Pointers\n## Learnings\n' > "$od/session-ledger-stale-claim.md"
    run_event "$od" "{\"hook_event_name\":\"PostCompact\",\"session_id\":\"stale-claim\",\"cwd\":\"$sbx\"}" >/dev/null
    marker="$od/codex-ledger-pending-stale-claim"
    mkdir "$marker.claim"
    printf '999999 1 dead-token\n' > "$marker.claim/owner"
    out=$(run_event "$od" "{\"hook_event_name\":\"UserPromptSubmit\",\"session_id\":\"stale-claim\",\"cwd\":\"$sbx\"}")
    rm -rf "$sbx"
    printf '%s' "$out" | jq -e '.hookSpecificOutput.hookEventName == "UserPromptSubmit" and (.hookSpecificOutput.additionalContext | contains("STALE-CLAIM-MARKER"))' >/dev/null
}

test_postcompact_retries_transient_lock_contention() {
    local sbx od marker rc bin real_mkdir ready release
    sbx=$(mktemp -d); od="$sbx/omt"; mkdir -p "$od"
    marker="$od/codex-ledger-pending-transient"
    mkdir "$marker.write-lock"
    printf '%s %s\n' "$$" "$(date +%s)" > "$marker.write-lock/owner"
    bin="$sbx/bin"; mkdir "$bin"
    real_mkdir=$(command -v mkdir)
    ready="$sbx/mkdir-attempted"; release="$sbx/release-lock"
    cat > "$bin/mkdir" <<'EOF'
#!/bin/bash
if [ "$#" -eq 1 ] && [ "${1:-}" = "${TRANSIENT_LOCK_PATH:-}" ] && [ -d "$TRANSIENT_LOCK_PATH" ]; then
    "$TRANSIENT_REAL_MKDIR" "$1" 2>/dev/null
    rc=$?
    if [ "$rc" -eq 0 ]; then exit 1; fi
    : > "$TRANSIENT_READY"
    i=0; while [ ! -f "$TRANSIENT_RELEASE" ] && [ "$i" -lt 300 ]; do sleep 0.01; i=$((i + 1)); done
    exit "$rc"
fi
exec "$TRANSIENT_REAL_MKDIR" "$@"
EOF
    chmod +x "$bin/mkdir"
    (export PATH="$bin:$PATH" TRANSIENT_LOCK_PATH="$marker.write-lock" TRANSIENT_READY="$ready" TRANSIENT_RELEASE="$release" TRANSIENT_REAL_MKDIR="$real_mkdir"; \
        printf '%s' "{\"hook_event_name\":\"PostCompact\",\"session_id\":\"transient\",\"cwd\":\"$sbx\"}" | OMT_DIR="$od" env -u OMT_SESSION_ID -u CODEX_THREAD_ID bash "$HOOK" 2>/dev/null >/dev/null) &
    local producer=$!
    local i=0
    while [ ! -f "$ready" ] && [ "$i" -lt 100 ]; do sleep 0.01; i=$((i + 1)); done
    if [ ! -f "$ready" ]; then
        kill "$producer" 2>/dev/null || true
        rm -rf "$sbx"
        return 1
    fi
    rm -rf "$marker.write-lock"
    : > "$release"
    set +e
    wait "$producer"; rc=$?
    set -e
    if [ "$rc" -ne 0 ] || [ ! -f "$marker" ]; then
        rm -rf "$sbx"
        return 1
    fi
    if [ ! -f "$ready" ]; then
        rm -rf "$sbx"
        return 1
    fi
    rm -rf "$sbx"
    return 0
}

test_consumer_cannot_remove_foreign_live_lock() {
    local sbx od marker before after rc
    sbx=$(mktemp -d); od="$sbx/omt"; mkdir -p "$od"
    printf '## Now\nFOREIGN-LOCK\n## Decisions\n## User Corrections (verbatim)\n## Pending\n## Pointers\n## Learnings\n' > "$od/session-ledger-foreign-lock.md"
    run_event "$od" "{\"hook_event_name\":\"PostCompact\",\"session_id\":\"foreign-lock\",\"cwd\":\"$sbx\"}" >/dev/null
    marker="$od/codex-ledger-pending-foreign-lock"
    mkdir "$marker.write-lock"; printf '%s %s\n' "$$" "$(date +%s)" > "$marker.write-lock/owner"
    before=$(cat "$marker.write-lock/owner")
    set +e; run_event "$od" "{\"hook_event_name\":\"UserPromptSubmit\",\"session_id\":\"foreign-lock\",\"cwd\":\"$sbx\"}" >/dev/null; rc=$?; set -e
    after=$(cat "$marker.write-lock/owner" 2>/dev/null || true)
    rm -rf "$sbx"
    [ "$rc" -ne 0 ] && [ "$before" = "$after" ]
}

test_postcompact_then_sessionstart_compact_recovers_once() {
    local sbx od first second third total
    sbx=$(mktemp -d); od="$sbx/omt"; mkdir -p "$od"
    printf '## Now\nNATIVE-SEQUENCE-MARKER\n## Decisions\n## User Corrections (verbatim)\n## Pending\n## Pointers\n## Learnings\n' > "$od/session-ledger-native-sequence.md"
    run_event "$od" "{\"hook_event_name\":\"PostCompact\",\"session_id\":\"native-sequence\",\"cwd\":\"$sbx\"}" >/dev/null
    first=$(run_event "$od" "{\"hook_event_name\":\"SessionStart\",\"source\":\"compact\",\"session_id\":\"native-sequence\",\"cwd\":\"$sbx\"}")
    second=$(run_event "$od" "{\"hook_event_name\":\"UserPromptSubmit\",\"session_id\":\"native-sequence\",\"cwd\":\"$sbx\",\"prompt\":\"next\"}")
    third=$(run_event "$od" "{\"hook_event_name\":\"PostToolUse\",\"session_id\":\"native-sequence\",\"cwd\":\"$sbx\"}")
    total=$(printf '%s\n%s\n%s\n' "$first" "$second" "$third" | grep -c 'NATIVE-SEQUENCE-MARKER' || true)
    if ! printf '%s' "$first" | jq -e '.hookSpecificOutput.hookEventName == "SessionStart"' >/dev/null; then
        rm -rf "$sbx"
        return 1
    fi
    if [ "$total" -ne 1 ]; then
        rm -rf "$sbx"
        return 1
    fi
    if [ -e "$od/codex-ledger-pending-native-sequence" ]; then
        rm -rf "$sbx"
        return 1
    fi
    rm -rf "$sbx"
}

test_newline_cwd_round_trips_marker_identity() {
    local sbx od cwd out
    sbx=$(mktemp -d); cwd="$sbx/line-one
line-two
"; od="$sbx/omt"; mkdir -p "$od"
    printf '## Now\nNEWLINE-CWD\n## Decisions\n## User Corrections (verbatim)\n## Pending\n## Pointers\n## Learnings\n' > "$od/session-ledger-newline-cwd.md"
    run_event "$od" "$(jq -cn --arg cwd "$cwd" '{hook_event_name:"PostCompact",session_id:"newline-cwd",cwd:$cwd}')" >/dev/null
    out=$(run_event "$od" "$(jq -cn --arg cwd "$cwd" '{hook_event_name:"UserPromptSubmit",session_id:"newline-cwd",cwd:$cwd}')")
    rm -rf "$sbx"
    printf '%s' "$out" | jq -e '.hookSpecificOutput.additionalContext | contains("NEWLINE-CWD")' >/dev/null
}

test_invalid_current_promotes_valid_next() {
    local sbx od marker out
    sbx=$(mktemp -d); od="$sbx/omt"; mkdir -p "$od"
    printf '## Now\nPROMOTED-NEXT\n## Decisions\n## User Corrections (verbatim)\n## Pending\n## Pointers\n## Learnings\n' > "$od/session-ledger-promote-next.md"
    run_event "$od" "{\"hook_event_name\":\"PostCompact\",\"session_id\":\"promote-next\",\"cwd\":\"$sbx\"}" >/dev/null
    run_event "$od" "{\"hook_event_name\":\"PostCompact\",\"session_id\":\"promote-next\",\"cwd\":\"$sbx\"}" >/dev/null
    marker="$od/codex-ledger-pending-promote-next"
    jq -nc '{token:"1-1",sid:"wrong",cwd_hash:"bad"}' > "$marker"
    out=$(run_event "$od" "{\"hook_event_name\":\"UserPromptSubmit\",\"session_id\":\"promote-next\",\"cwd\":\"$sbx\"}")
    [ -z "$out" ] || { rm -rf "$sbx"; return 1; }
    out=$(run_event "$od" "{\"hook_event_name\":\"UserPromptSubmit\",\"session_id\":\"promote-next\",\"cwd\":\"$sbx\"}")
    rm -rf "$sbx"
    printf '%s' "$out" | jq -e '.hookSpecificOutput.additionalContext | contains("PROMOTED-NEXT")' >/dev/null
}

test_generation_swapped_during_core_is_not_lost() {
    local sbx od marker out1 out2 consumer i bin real_node ready release cwd_b64 token
    sbx=$(mktemp -d); od="$sbx/omt"; mkdir -p "$od"
    printf '## Now\nSWAPPED-GENERATION\n## Decisions\n## User Corrections (verbatim)\n## Pending\n## Pointers\n## Learnings\n' > "$od/session-ledger-swapped-generation.md"
    run_event "$od" "{\"hook_event_name\":\"PostCompact\",\"session_id\":\"swapped-generation\",\"cwd\":\"$sbx\"}" >/dev/null
    marker="$od/codex-ledger-pending-swapped-generation"
    bin="$sbx/bin"; mkdir "$bin"; real_node=$(node -p 'process.execPath')
    ready="$sbx/node-entered"; release="$sbx/node-release"
    cat > "$bin/node" <<'EOF'
#!/bin/bash
case "$*" in
  *ledger-events.mjs*)
    : > "$NODE_GATE_READY"
    i=0; while [ ! -f "$NODE_GATE_RELEASE" ] && [ "$i" -lt 300 ]; do sleep 0.01; i=$((i + 1)); done
    [ -f "$NODE_GATE_RELEASE" ] || exit 1
    ;;
esac
exec "$NODE_REAL" "$@"
EOF
    chmod +x "$bin/node"
    (export PATH="$bin:$PATH" NODE_GATE_READY="$ready" NODE_GATE_RELEASE="$release" NODE_REAL="$real_node"; \
        printf '%s' "{\"hook_event_name\":\"UserPromptSubmit\",\"session_id\":\"swapped-generation\",\"cwd\":\"$sbx\"}" | OMT_DIR="$od" env -u OMT_SESSION_ID -u CODEX_THREAD_ID bash "$HOOK" 2>/dev/null > "$sbx/recovery.out") & consumer=$!
    (sleep 3; kill "$consumer" 2>/dev/null || true) & local consumer_watchdog=$!
    i=0
    while [ ! -d "$marker.claim" ] && [ "$i" -lt 100 ]; do sleep 0.01; i=$((i + 1)); done
    while [ ! -f "$ready" ] && [ "$i" -lt 200 ]; do sleep 0.01; i=$((i + 1)); done
    if [ ! -f "$ready" ]; then
        kill "$consumer" 2>/dev/null || true
        kill "$consumer_watchdog" 2>/dev/null || true
        wait "$consumer_watchdog" 2>/dev/null || true
        rm -rf "$sbx"
        return 1
    fi
    cwd_b64=$(printf '%s' "$sbx" | base64 | tr -d '\n')
    token="$(date +%s)-replacement"
    jq -cn --arg token "$token" --arg sid swapped-generation --arg cwd "$cwd_b64" '{token:$token,sid:$sid,cwd_b64:$cwd}' > "$marker"
    : > "$release"
    set +e
    wait "$consumer"
    local consumer_rc=$?
    set -e
    kill "$consumer_watchdog" 2>/dev/null || true
    wait "$consumer_watchdog" 2>/dev/null || true
    if [ "$consumer_rc" -ne 0 ]; then
        rm -rf "$sbx"
        return 1
    fi
    out1=$(cat "$sbx/recovery.out")
    if [ -n "$out1" ]; then
        echo "  first consumer output: ${out1:0:300}"
        rm -rf "$sbx"
        return 1
    fi
    if [ ! -f "$marker" ] || ! grep -q 'replacement' "$marker"; then
        rm -rf "$sbx"
        return 1
    fi
    out2=$(run_event "$od" "{\"hook_event_name\":\"UserPromptSubmit\",\"session_id\":\"swapped-generation\",\"cwd\":\"$sbx\"}")
    if ! printf '%s' "$out2" | jq -e '.hookSpecificOutput.additionalContext | contains("SWAPPED-GENERATION")' >/dev/null; then
        echo "  next consumer output: ${out2:0:300}"
        rm -rf "$sbx"
        return 1
    fi
    if [ -e "$marker" ]; then
        rm -rf "$sbx"
        return 1
    fi
    rm -rf "$sbx"
    return 0
}

test_invalid_current_without_next_is_removed() {
    local sbx od marker
    sbx=$(mktemp -d); od="$sbx/omt"; mkdir -p "$od"
    run_event "$od" "{\"hook_event_name\":\"PostCompact\",\"session_id\":\"remove-invalid\",\"cwd\":\"$sbx\"}" >/dev/null
    marker="$od/codex-ledger-pending-remove-invalid"
    jq -nc '{token:"1-1",sid:"wrong",cwd_b64:"bad"}' > "$marker"
    run_event "$od" "{\"hook_event_name\":\"UserPromptSubmit\",\"session_id\":\"remove-invalid\",\"cwd\":\"$sbx\"}" >/dev/null
    if [ -e "$marker" ] || [ -e "$marker.next" ]; then
        rm -rf "$sbx"
        return 1
    fi
    rm -rf "$sbx"
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
    printf '## Now\nCX\n## Decisions\n## User Corrections (verbatim)\n## Pending\n## Pointers\n## Learnings\n' > "$OD/session-ledger-cx-sid.md"

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
# SUB-FIX 4: a stale/ambient OMT_SESSION_ID (leaked from a parent Claude
# process) must not shadow this Codex session's own CODEX_THREAD_ID identity.
# ledger_core_run's precedence is OMT_SESSION_ID ?? CODEX_THREAD_ID ??
# stdin.session_id -- if codex-ledger.sh forwards the ambient env unfiltered,
# the foreign OMT_SESSION_ID sid wins and compact-recovery splices in ANOTHER
# session's ledger. Two ledger files (SELF via CODEX_THREAD_ID, FOREIGN via
# ambient OMT_SESSION_ID) let this test tell which sid actually resolved.
# =============================================================================
test_codex_ambient_omt_session_id_does_not_shadow_self() {
    local SBX OD out ok=0
    SBX=$(mktemp -d)
    OD="$SBX/omt"
    mkdir -p "$OD"
    printf '## Now\nSELF-MARKER-XYZ\n## Decisions\n## User Corrections (verbatim)\n## Pending\n## Pointers\n## Learnings\n' > "$OD/session-ledger-self-sid-1.md"
    printf '## Now\nFOREIGN-MARKER-XYZ\n## Decisions\n## User Corrections (verbatim)\n## Pending\n## Pointers\n## Learnings\n' > "$OD/session-ledger-foreign-sid-1.md"

    out=$(printf '{"source":"compact","session_id":"self-sid-1","cwd":"%s"}' "$SBX" \
        | OMT_DIR="$OD" bash -c "unset OMT_SESSION_ID CODEX_THREAD_ID; export OMT_SESSION_ID=foreign-sid-1; export CODEX_THREAD_ID=self-sid-1; exec bash '$HOOK'" 2>/dev/null)

    if echo "$out" | grep -q 'SELF-MARKER-XYZ' \
        && [ "$(printf '%s' "$out" | grep -c 'FOREIGN-MARKER-XYZ')" = "0" ]; then
        ok=1
    fi

    rm -rf "$SBX"
    [ "$ok" = "1" ]
}

# =============================================================================
# No-regression companion to the above: CODEX_THREAD_ID set, OMT_SESSION_ID
# absent -- self-recovery via CODEX_THREAD_ID must still work (the fix must
# NOT unset CODEX_THREAD_ID, only OMT_SESSION_ID).
# =============================================================================
test_codex_thread_id_alone_recovers_self() {
    local SBX OD out ok=0
    SBX=$(mktemp -d)
    OD="$SBX/omt"
    mkdir -p "$OD"
    printf '## Now\nSELF-ONLY-MARKER\n## Decisions\n## User Corrections (verbatim)\n## Pending\n## Pointers\n## Learnings\n' > "$OD/session-ledger-self-sid-2.md"

    out=$(printf '{"source":"compact","session_id":"self-sid-2","cwd":"%s"}' "$SBX" \
        | OMT_DIR="$OD" bash -c "unset OMT_SESSION_ID CODEX_THREAD_ID; export CODEX_THREAD_ID=self-sid-2; exec bash '$HOOK'" 2>/dev/null)

    if echo "$out" | grep -q 'SELF-ONLY-MARKER'; then
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
# Regression: jq unresolvable via PATH must not drop the recording
# instruction. ledger-core.sh emits [LEDGER RECORDING] unconditionally
# (outside any jq/sid gate -- hooks/ledger-core.sh:41-65), but this hook's
# own emit step re-pipes that core output through `jq -c 'del(.continue)'`
# with no jq-presence check. If jq is absent that pipe fails and the WHOLE
# core output is dropped, silently defeating the core's byte-preservation
# guarantee for Codex. Exercise a PATH that lacks jq but keeps the externals
# this jq-absent path legitimately needs (dirname/cat/sed), mirroring
# hooks/ledger-core_test.sh:149-198's jq_less_bin pattern.
# =============================================================================
test_jq_absent_recording_survives_no_continue() {
    local jq_less_bin out rc ok=0

    jq_less_bin=$(mktemp -d)
    ln -s /usr/bin/dirname "$jq_less_bin/dirname"
    ln -s /bin/cat "$jq_less_bin/cat"
    ln -s /usr/bin/sed "$jq_less_bin/sed"

    set +e
    # Absolute /bin/bash sidesteps a bare `bash` lookup failing against the
    # restricted PATH being assigned (same rationale as
    # hooks/ledger-core_test.sh:165-172).
    out=$(printf '{"source":"startup","session_id":"cx","cwd":"/tmp"}' \
        | PATH="$jq_less_bin" OMT_DIR=/tmp/x /bin/bash "$HOOK" 2>/dev/null)
    rc=$?
    set -e
    rm -rf "$jq_less_bin"

    if [ "$rc" = "0" ] \
        && echo "$out" | grep -q '\[LEDGER RECORDING\]' \
        && [ "$(printf '%s' "$out" | grep -c '^{"continue"')" = "0" ] \
        && echo "$out" | grep -q 'hookSpecificOutput'; then
        ok=1
    fi

    [ "$ok" = "1" ]
}

# =============================================================================
# Regression: jq present but FAILING (broken binary, exit 1, no stdout) must
# not drop the recording instruction. ledger_core_run's own internal jq calls
# (source==compact detection, sid extraction) run inside the
# `CORE_OUT=$(ledger_core_run codex)` command substitution at codex-ledger.sh,
# so their failure never escapes -- CORE_OUT still ends up fully formed
# (hooks/ledger-core.sh:205 always echoes). The actual failure point is this
# hook's OWN emit step: `printf '%s' "$CORE_OUT" | jq -c 'del(.continue)'` is a
# plain top-level pipe (not inside `$(...)`), so a present-but-failing jq
# writes nothing to stdout there and the pipe's non-zero exit is NOT
# swallowed. Exercise a PATH with a broken jq shim (exit 1, no output)
# alongside the externals this jq-present path legitimately needs
# (dirname/cat/sed).
# =============================================================================
test_jq_failing_recording_survives_no_continue() {
    local broken_jq_bin out rc ok=0

    broken_jq_bin=$(mktemp -d)
    ln -s /usr/bin/dirname "$broken_jq_bin/dirname"
    ln -s /bin/cat "$broken_jq_bin/cat"
    ln -s /usr/bin/sed "$broken_jq_bin/sed"
    printf '#!/bin/bash\nexit 1\n' > "$broken_jq_bin/jq"
    chmod +x "$broken_jq_bin/jq"

    set +e
    # Absolute /bin/bash sidesteps a bare `bash` lookup failing against the
    # restricted PATH being assigned (same rationale as
    # hooks/ledger-core_test.sh:165-172).
    out=$(printf '{"source":"startup","session_id":"cx","cwd":"/tmp"}' \
        | PATH="$broken_jq_bin" OMT_DIR=/tmp/x /bin/bash "$HOOK" 2>/dev/null)
    rc=$?
    set -e
    rm -rf "$broken_jq_bin"

    if [ "$rc" = "0" ] \
        && echo "$out" | grep -q '\[LEDGER RECORDING\]' \
        && [ "$(printf '%s' "$out" | grep -c '^{"continue"')" = "0" ] \
        && echo "$out" | grep -q 'hookSpecificOutput'; then
        ok=1
    fi

    [ "$ok" = "1" ]
}

# =============================================================================
# Regression: malformed stdin JSON must not abort the script. ledger_core_run's
# compaction-recovery branch pipes stdin through jq, which fails (exit 5) on
# unparseable JSON -- but that failure occurs inside the
# `CORE_OUT=$(ledger_core_run codex)` command substitution subshell, and bash
# does not propagate errexit into a command substitution unless
# `inherit_errexit` is explicitly enabled (it is not here, and this hook no
# longer sets -e at all -- see the comment at the top of hooks/codex-ledger.sh),
# so [LEDGER RECORDING] must still emit unconditionally.
# =============================================================================
test_malformed_stdin_does_not_abort_recording() {
    local out rc ok=0

    set +e
    out=$(printf '%s' 'not valid json {{{' | OMT_DIR=/tmp/x bash "$HOOK" 2>/dev/null)
    rc=$?
    set -e

    if [ "$rc" = "0" ] && echo "$out" | grep -q '\[LEDGER RECORDING\]'; then
        ok=1
    fi

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
    run_test test_codex_ambient_omt_session_id_does_not_shadow_self
    run_test test_codex_thread_id_alone_recovers_self
    run_test test_qa_recording_startup_no_claude_env_leak
    run_test test_qa_no_continue_contract
    run_test test_jq_absent_recording_survives_no_continue
    run_test test_jq_failing_recording_survives_no_continue
    run_test test_malformed_stdin_does_not_abort_recording
    run_test test_postcompact_bridges_next_context_event_once
    run_test test_postcompact_registration_and_context_events
    run_test test_pending_invalid_identity_is_silent
    run_test test_postcompact_requires_cwd_and_preserves_second_generation
    run_test test_concurrent_consumers_emit_one_recovery
    run_test test_missing_ledger_does_not_ack_pending
    run_test test_dead_claim_is_reclaimable
    run_test test_postcompact_retries_transient_lock_contention
    run_test test_consumer_cannot_remove_foreign_live_lock
    run_test test_postcompact_then_sessionstart_compact_recovers_once
    run_test test_newline_cwd_round_trips_marker_identity
    run_test test_invalid_current_promotes_valid_next
    run_test test_generation_swapped_during_core_is_not_lost
    run_test test_invalid_current_without_next_is_removed

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [ "$TESTS_FAILED" -gt 0 ]; then
        exit 1
    fi
}

main "$@"

#!/bin/bash
# =============================================================================
# Codex Write-Guard Hook Tests (codex-ledger-parity plan, TODO 7)
# Covers hooks/codex-write-guard.sh: the Codex PreToolUse shim that parses
# apply_patch envelopes, Bash-embedded apply_patch heredocs, shell
# redirect/tee/rm targets, and native Edit/Write file_path targets;
# absolutizes them against stdin.cwd; resolves OMT_DIR/session_id; enforces
# the mismatch-HALT; and delegates the actual match+deny to
# write_guard_core_run (hooks/write-guard-core.sh).
#
# Every git-derive case runs under a SANDBOXED HOME (mktemp -d) -- never the
# real $HOME/.omt -- mirroring hooks/pre-tool-enforcer_test.sh:231,596. Every
# hook invocation explicitly unsets OMT_DIR/OMT_SESSION_ID so the real
# session's env cannot leak into the sandboxed resolution.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
HOOK="$SCRIPT_DIR/codex-write-guard.sh"

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

# new_sandbox: mktemp -d git-repo sandbox + the resolved ledger path for
# session id "cx". Sets SBX / GITDIR / LED. Caller must `rm -rf "$SBX"`.
new_sandbox() {
    SBX=$(mktemp -d)
    GITDIR="$SBX/repo"
    mkdir -p "$GITDIR"
    git -C "$GITDIR" init -q -b main
    LED=$(env -u OMT_DIR -u OMT_SESSION_ID HOME="$SBX" bash -c \
        "source '$ROOT_DIR/hooks/lib/omt-dir.sh'; printf '%s/session-ledger-cx.md' \"\$(resolve_omt_dir '$GITDIR')\"")
}

# run_hook: feed stdin JSON to the hook under the sandboxed HOME with
# CODEX_THREAD_ID=cx (matching stdin.session_id="cx" in every non-HALT case
# below), env OMT_DIR/OMT_SESSION_ID stripped so resolution is git-derived.
run_hook() {
    env -u OMT_DIR -u OMT_SESSION_ID HOME="$SBX" CODEX_THREAD_ID=cx bash "$HOOK"
}

# =============================================================================
# AC1 -- apply_patch envelope targeting the resolved current ledger DENIES;
# a non-ledger target ALLOWS. (Plan TODO 7 AC1 exact setup/verification.)
# =============================================================================
test_ac1_apply_patch_envelope_denies_ledger_allows_other() {
    new_sandbox
    local deny allow result=0

    deny=$(printf '{"tool_name":"apply_patch","tool_input":{"command":"*** Begin Patch\\n*** Update File: %s\\n"},"session_id":"cx","cwd":"%s"}' "$LED" "$GITDIR" | run_hook)
    if ! printf '%s' "$deny" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED AC1: expected deny for ledger target, got '$deny'"
        result=1
    fi

    allow=$(printf '{"tool_name":"apply_patch","tool_input":{"command":"*** Begin Patch\\n*** Update File: %s/README.md\\n"},"session_id":"cx","cwd":"%s"}' "$GITDIR" "$GITDIR" | run_hook)
    if [ "$(printf '%s' "$allow" | grep -c deny)" != "0" ]; then
        echo "ASSERTION FAILED AC1: expected allow for README.md target, got '$allow'"
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

# =============================================================================
# AC2 -- a Bash-embedded apply_patch heredoc targeting the ledger DENIES
# (heredoc-body scan, its own surface).
# =============================================================================
test_ac2_bash_embedded_heredoc_denies() {
    new_sandbox
    local out result=0

    out=$(printf '{"tool_name":"Bash","tool_input":{"command":"apply_patch <<'"'"'EOF'"'"'\\n*** Begin Patch\\n*** Update File: %s\\n*** End Patch\\nEOF\\n"},"session_id":"cx","cwd":"%s"}' "$LED" "$GITDIR" | run_hook)
    if ! printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED AC2: expected deny for heredoc-embedded ledger target, got '$out'"
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

# =============================================================================
# AC3 -- a DIVERGENT stdin.session_id vs CODEX_THREAD_ID HALTs loudly
# (non-zero exit or explicit halt marker), not a silent guard on the wrong
# ledger.
# =============================================================================
test_ac3_divergent_session_id_halts() {
    local sbx gitdir result=1
    sbx=$(mktemp -d)
    gitdir="$sbx/repo"
    mkdir -p "$gitdir"
    git -C "$gitdir" init -q -b main

    mk() { printf '{"tool_name":"Bash","tool_input":{"command":"echo x"},"session_id":"cx-B","cwd":"%s"}' "$gitdir"; }

    if ( mk | env -u OMT_DIR -u OMT_SESSION_ID HOME="$sbx" CODEX_THREAD_ID=cx-A bash "$HOOK" 2>&1 | grep -Eiq 'halt|mismatch|diverg' ); then
        result=0
    else
        mk | env -u OMT_DIR -u OMT_SESSION_ID HOME="$sbx" CODEX_THREAD_ID=cx-A bash "$HOOK" >/dev/null 2>&1
        local rc=$?
        [ "$rc" -ne 0 ] && result=0
    fi

    rm -rf "$sbx"
    if [ "$result" -ne 0 ]; then
        echo "ASSERTION FAILED AC3: expected halt marker or non-zero exit on divergent session id"
    fi
    return "$result"
}

# =============================================================================
# QA -- redirect to ledger denied (shell write route).
# Evidence: $OMT_DIR/evidence/codex-ledger-parity/codex-write-guard-hook/redirect-deny.txt
# =============================================================================
test_qa_redirect_to_ledger_denies() {
    new_sandbox
    local out evidence_dir result=0

    out=$(printf '{"tool_name":"Bash","tool_input":{"command":"echo x > %s"},"session_id":"cx","cwd":"%s"}' "$LED" "$GITDIR" | run_hook)

    evidence_dir="$OMT_DIR/evidence/codex-ledger-parity/codex-write-guard-hook"
    mkdir -p "$evidence_dir"
    {
        echo "input: echo x > $LED (cwd=$GITDIR sid=cx)"
        echo "output: $out"
    } > "$evidence_dir/redirect-deny.txt"

    if ! printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED QA-redirect: expected deny, got '$out'"
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

# =============================================================================
# QA -- prose false-positive allowed (header-parser precision). A Bash
# command merely mentioning "session-ledger" in prose (no write-target
# reference) must ALLOW.
# Evidence: $OMT_DIR/evidence/codex-ledger-parity/codex-write-guard-hook/prose-allow.txt
# =============================================================================
test_qa_prose_mention_allows() {
    new_sandbox
    local out evidence_dir result=0

    out=$(printf '{"tool_name":"Bash","tool_input":{"command":"echo editing the session-ledger docs"},"session_id":"cx","cwd":"%s"}' "$GITDIR" | run_hook)

    evidence_dir="$OMT_DIR/evidence/codex-ledger-parity/codex-write-guard-hook"
    mkdir -p "$evidence_dir"
    {
        echo "input: echo editing the session-ledger docs (cwd=$GITDIR sid=cx)"
        echo "output: $out"
    } > "$evidence_dir/prose-allow.txt"

    if [ "$(printf '%s' "$out" | grep -c deny)" != "0" ]; then
        echo "ASSERTION FAILED QA-prose: expected allow (no deny) for prose mention, got '$out'"
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

# =============================================================================
# Own corpus -- multi-file patch: one of several Update File targets is the
# ledger -> DENY.
# =============================================================================
test_own_multi_file_patch_denies() {
    new_sandbox
    local cmd out result=0

    cmd=$(printf '*** Begin Patch\n*** Update File: %s/a.md\n*** Update File: %s\n*** Update File: %s/b.md\n*** End Patch\n' "$GITDIR" "$LED" "$GITDIR")
    out=$(jq -n --arg cmd "$cmd" --arg cwd "$GITDIR" '{tool_name:"apply_patch", tool_input:{command:$cmd}, session_id:"cx", cwd:$cwd}' | run_hook)
    if ! printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED own-multi-file-patch: expected deny, got '$out'"
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

# =============================================================================
# Own corpus -- "*** Move to:" destination is the ledger -> DENY.
# =============================================================================
test_own_move_to_ledger_denies() {
    new_sandbox
    local cmd out result=0

    cmd=$(printf '*** Begin Patch\n*** Update File: %s/other.md\n*** Move to: %s\n*** End Patch\n' "$GITDIR" "$LED")
    out=$(jq -n --arg cmd "$cmd" --arg cwd "$GITDIR" '{tool_name:"apply_patch", tool_input:{command:$cmd}, session_id:"cx", cwd:$cwd}' | run_hook)
    if ! printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED own-move-to: expected deny, got '$out'"
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

# =============================================================================
# Own corpus -- "*** Delete File:" targeting the ledger -> DENY.
# =============================================================================
test_own_delete_file_ledger_denies() {
    new_sandbox
    local cmd out result=0

    cmd=$(printf '*** Begin Patch\n*** Delete File: %s\n*** End Patch\n' "$LED")
    out=$(jq -n --arg cmd "$cmd" --arg cwd "$GITDIR" '{tool_name:"apply_patch", tool_input:{command:$cmd}, session_id:"cx", cwd:$cwd}' | run_hook)
    if ! printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED own-delete-file: expected deny, got '$out'"
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

# =============================================================================
# Own corpus -- CRLF header lines (\r\n line endings) still DENY.
# =============================================================================
test_own_crlf_headers_deny() {
    new_sandbox
    local cmd out result=0

    cmd=$(printf '*** Begin Patch\r\n*** Update File: %s\r\n*** End Patch\r\n' "$LED")
    out=$(jq -n --arg cmd "$cmd" --arg cwd "$GITDIR" '{tool_name:"apply_patch", tool_input:{command:$cmd}, session_id:"cx", cwd:$cwd}' | run_hook)
    if ! printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED own-crlf-headers: expected deny, got '$out'"
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

# =============================================================================
# Own corpus -- nested heredoc: an unrelated heredoc earlier in the same
# command mentions "session-ledger" in prose (must not itself trigger a
# deny), while the apply_patch heredoc that follows targets the ledger for
# real -> DENY driven by the apply_patch heredoc only.
# =============================================================================
test_own_nested_heredoc_denies() {
    new_sandbox
    local cmd out result=0

    cmd=$(printf "cat <<'NOTE'\nsome notes about session-ledger\nNOTE\napply_patch <<'EOF'\n*** Begin Patch\n*** Update File: %s\n*** End Patch\nEOF\n" "$LED")
    out=$(jq -n --arg cmd "$cmd" --arg cwd "$GITDIR" '{tool_name:"Bash", tool_input:{command:$cmd}, session_id:"cx", cwd:$cwd}' | run_hook)
    if ! printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED own-nested-heredoc: expected deny, got '$out'"
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

# =============================================================================
# Own corpus -- relative-vs-absolute path: a native Edit's file_path is
# relative to cwd; absolutized against cwd it equals the ledger -> DENY.
# =============================================================================
test_own_relative_path_denies() {
    local sbx od out result=0
    sbx=$(mktemp -d)
    od="$sbx/omt-dir"
    mkdir -p "$od"

    out=$(jq -n --arg cwd "$od" '{tool_name:"Edit", tool_input:{file_path:"session-ledger-cx.md"}, session_id:"cx", cwd:$cwd}' \
        | env -u OMT_SESSION_ID OMT_DIR="$od" HOME="$sbx" CODEX_THREAD_ID=cx bash "$HOOK")
    if ! printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED own-relative-path: expected deny for cwd-relative ledger file_path, got '$out'"
        result=1
    fi

    rm -rf "$sbx"
    return "$result"
}

# =============================================================================
# Own corpus -- native Edit targeting a non-ledger file ALLOWS. Confirms
# Edit/Write are covered write routes in their own right (not just
# apply_patch/Bash) without over-blocking a non-ledger native edit.
# =============================================================================
test_own_native_edit_non_ledger_allows() {
    new_sandbox
    local out result=0

    out=$(jq -n --arg fp "$GITDIR/README.md" --arg cwd "$GITDIR" '{tool_name:"Edit", tool_input:{file_path:$fp}, session_id:"cx", cwd:$cwd}' | run_hook)
    if [ "$(printf '%s' "$out" | grep -c deny)" != "0" ]; then
        echo "ASSERTION FAILED own-native-edit-allow: expected allow, got '$out'"
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

# =============================================================================
# Main
# =============================================================================

main() {
    echo "=========================================="
    echo "Codex Write-Guard Hook Tests"
    echo "=========================================="

    run_test test_ac1_apply_patch_envelope_denies_ledger_allows_other
    run_test test_ac2_bash_embedded_heredoc_denies
    run_test test_ac3_divergent_session_id_halts
    run_test test_qa_redirect_to_ledger_denies
    run_test test_qa_prose_mention_allows
    run_test test_own_multi_file_patch_denies
    run_test test_own_move_to_ledger_denies
    run_test test_own_delete_file_ledger_denies
    run_test test_own_crlf_headers_deny
    run_test test_own_nested_heredoc_denies
    run_test test_own_relative_path_denies
    run_test test_own_native_edit_non_ledger_allows

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [ "$TESTS_FAILED" -gt 0 ]; then
        exit 1
    fi
}

main "$@"

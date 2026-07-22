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

# EVIDENCE_OMT_DIR: self-derived (not ambient $OMT_DIR) so this suite runs
# clean under `env -u OMT_DIR`, mirroring hooks/ledger-core_test.sh's own
# evidence_dir derivation via resolve_omt_dir.
EVIDENCE_OMT_DIR=$(bash -c "source '$SCRIPT_DIR/lib/omt-dir.sh'; resolve_omt_dir '$SCRIPT_DIR'")

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

# assert_allow: strengthened allow assertion (ultragoal test-hardening story).
# A prior allow check only grepped stdout for deny-JSON, which a CRASHED hook
# (non-zero exit, empty stdout) would also pass -- silently masking a
# fail-open as an allow. This requires BOTH exit status 0 AND no deny-JSON in
# stdout. Callers must capture the hook's exit code themselves (the pipeline
# runs under `set -euo pipefail`, so it must be invoked as
# `out=$(... | run_hook) || rc=$?` -- not a bare `out=$(...)` -- or the
# non-zero exit aborts the test function before this assertion ever runs).
assert_allow() {
    local out="$1" rc="$2" label="$3"
    if [ "$rc" -ne 0 ]; then
        echo "ASSERTION FAILED $label: expected allow (exit 0), got exit $rc, output '$out'"
        return 1
    fi
    if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED $label: expected allow, got deny in output '$out'"
        return 1
    fi
    return 0
}

# =============================================================================
# AC1 -- apply_patch envelope targeting the resolved current ledger DENIES;
# a non-ledger target ALLOWS. (Plan TODO 7 AC1 exact setup/verification.)
# =============================================================================
test_ac1_apply_patch_envelope_denies_ledger_allows_other() {
    new_sandbox
    local deny allow rc=0 result=0

    deny=$(printf '{"tool_name":"apply_patch","tool_input":{"command":"*** Begin Patch\\n*** Update File: %s\\n"},"session_id":"cx","cwd":"%s"}' "$LED" "$GITDIR" | run_hook)
    if ! printf '%s' "$deny" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED AC1: expected deny for ledger target, got '$deny'"
        result=1
    fi

    allow=$(printf '{"tool_name":"apply_patch","tool_input":{"command":"*** Begin Patch\\n*** Update File: %s/README.md\\n"},"session_id":"cx","cwd":"%s"}' "$GITDIR" "$GITDIR" | run_hook) || rc=$?
    if ! assert_allow "$allow" "$rc" "AC1"; then
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

    evidence_dir="$EVIDENCE_OMT_DIR/evidence/codex-ledger-parity/codex-write-guard-hook"
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
    local out evidence_dir rc=0 result=0

    out=$(printf '{"tool_name":"Bash","tool_input":{"command":"echo editing the session-ledger docs"},"session_id":"cx","cwd":"%s"}' "$GITDIR" | run_hook) || rc=$?

    evidence_dir="$EVIDENCE_OMT_DIR/evidence/codex-ledger-parity/codex-write-guard-hook"
    mkdir -p "$evidence_dir"
    {
        echo "input: echo editing the session-ledger docs (cwd=$GITDIR sid=cx)"
        echo "output: $out"
    } > "$evidence_dir/prose-allow.txt"

    if ! assert_allow "$out" "$rc" "QA-prose"; then
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
    local out rc=0 result=0

    out=$(jq -n --arg fp "$GITDIR/README.md" --arg cwd "$GITDIR" '{tool_name:"Edit", tool_input:{file_path:$fp}, session_id:"cx", cwd:$cwd}' | run_hook) || rc=$?
    if ! assert_allow "$out" "$rc" "own-native-edit-allow"; then
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

# =============================================================================
# Regression -- set -e/pipefail redirect-extraction hazard (code-review fix):
# _cwg_extract_shell_targets's redirect-extraction grep returns 1 for any
# chain segment with no `>`/`>>` -- under this script's `set -euo pipefail`,
# that used to abort the function before the tee/rm/dd/cp/truncate/sed -i
# case block ever ran, silently ALLOWING those routes against the ledger.
# Each case below targets the resolved current ledger and must DENY.
# =============================================================================
test_own_rm_ledger_denies() {
    new_sandbox
    local out result=0

    out=$(printf '{"tool_name":"Bash","tool_input":{"command":"rm %s"},"session_id":"cx","cwd":"%s"}' "$LED" "$GITDIR" | run_hook)
    if ! printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED own-rm-ledger: expected deny for 'rm <ledger>', got '$out'"
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

test_own_tee_ledger_denies() {
    new_sandbox
    local out result=0

    out=$(printf '{"tool_name":"Bash","tool_input":{"command":"echo x | tee %s"},"session_id":"cx","cwd":"%s"}' "$LED" "$GITDIR" | run_hook)
    if ! printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED own-tee-ledger: expected deny for 'echo x | tee <ledger>', got '$out'"
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

test_own_dd_ledger_denies() {
    new_sandbox
    local out result=0

    out=$(printf '{"tool_name":"Bash","tool_input":{"command":"dd if=/dev/zero of=%s bs=1 count=1"},"session_id":"cx","cwd":"%s"}' "$LED" "$GITDIR" | run_hook)
    if ! printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED own-dd-ledger: expected deny for 'dd of=<ledger>', got '$out'"
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

test_own_cp_ledger_denies() {
    new_sandbox
    local out result=0

    out=$(printf '{"tool_name":"Bash","tool_input":{"command":"cp %s/src.md %s"},"session_id":"cx","cwd":"%s"}' "$GITDIR" "$LED" "$GITDIR" | run_hook)
    if ! printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED own-cp-ledger: expected deny for 'cp src <ledger>', got '$out'"
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

test_own_truncate_ledger_denies() {
    new_sandbox
    local out result=0

    out=$(printf '{"tool_name":"Bash","tool_input":{"command":"truncate -s0 %s"},"session_id":"cx","cwd":"%s"}' "$LED" "$GITDIR" | run_hook)
    if ! printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED own-truncate-ledger: expected deny for 'truncate -s0 <ledger>', got '$out'"
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

test_own_sed_i_ledger_denies() {
    new_sandbox
    local cmd out result=0

    cmd="sed -i 's/a/b/' $LED"
    out=$(jq -n --arg cmd "$cmd" --arg cwd "$GITDIR" '{tool_name:"Bash", tool_input:{command:$cmd}, session_id:"cx", cwd:$cwd}' | run_hook)
    if ! printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED own-sed-i-ledger: expected deny for 'sed -i ... <ledger>', got '$out'"
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

# =============================================================================
# Regression (confirmed bypass, code review finding) -- sed -i multi-file
# ledger-as-non-final-operand bypass: `sed -i SCRIPT file1 file2` edits EVERY
# file operand in place, not just the last, but the extractor used to emit
# only $NF -- so a ledger operand that was NOT the last operand on the
# command line was never even offered to write_guard_core_run's EXACT match,
# silently ALLOWING the in-place edit. The DENY case below places the ledger
# as the non-final operand; the ALLOW control has no ledger reference at all.
# =============================================================================
test_bypass_sed_i_non_final_operand_ledger_denies() {
    new_sandbox
    local cmd out result=0

    cmd="sed -i 's/a/b/' $LED $GITDIR/other.md"
    out=$(jq -n --arg cmd "$cmd" --arg cwd "$GITDIR" '{tool_name:"Bash", tool_input:{command:$cmd}, session_id:"cx", cwd:$cwd}' | run_hook)
    if ! printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED bypass-sed-i-non-final-operand: expected deny for 'sed -i ... <ledger> <other>' (ledger as non-final operand), got '$out'"
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

test_bypass_sed_i_non_ledger_allows() {
    new_sandbox
    local cmd out rc=0 result=0

    cmd="sed -i 's/a/b/' $GITDIR/other.md"
    out=$(jq -n --arg cmd "$cmd" --arg cwd "$GITDIR" '{tool_name:"Bash", tool_input:{command:$cmd}, session_id:"cx", cwd:$cwd}' | run_hook) || rc=$?
    if ! assert_allow "$out" "$rc" "bypass-sed-i-non-ledger-allow"; then
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

# Non-ledger control -- 'rm' on a non-ledger file must ALLOW (proves the
# set -e fix does not turn rm into an over-broad denier).
test_own_rm_non_ledger_allows() {
    new_sandbox
    local out rc=0 result=0

    out=$(printf '{"tool_name":"Bash","tool_input":{"command":"rm %s/README.md"},"session_id":"cx","cwd":"%s"}' "$GITDIR" "$GITDIR" | run_hook) || rc=$?
    if ! assert_allow "$out" "$rc" "own-rm-non-ledger-allow"; then
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

# =============================================================================
# Regression -- quote-stripping parity (code-review fix): _cwg_absolutize
# used to leave surrounding quote characters on an extracted candidate
# target, unlike the Claude twin _wg_strip_dquotes (hooks/pre-tool-
# enforcer.sh:52-57) -- so a quoted redirect/rm/tee target never equaled the
# unquoted resolved ledger path and silently ALLOWED, bypassing the guard.
# Each quoted-ledger case below must DENY like the Claude twin; a quoted
# non-ledger target must still ALLOW.
# =============================================================================
test_own_double_quoted_redirect_ledger_denies() {
    new_sandbox
    local cmd out result=0

    cmd="echo x > \"$LED\""
    out=$(jq -n --arg cmd "$cmd" --arg cwd "$GITDIR" '{tool_name:"Bash", tool_input:{command:$cmd}, session_id:"cx", cwd:$cwd}' | run_hook)
    if ! printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED own-double-quoted-redirect: expected deny for 'echo x > \"<ledger>\"', got '$out'"
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

test_own_single_quoted_redirect_ledger_denies() {
    new_sandbox
    local cmd out result=0

    cmd="echo x > '$LED'"
    out=$(jq -n --arg cmd "$cmd" --arg cwd "$GITDIR" '{tool_name:"Bash", tool_input:{command:$cmd}, session_id:"cx", cwd:$cwd}' | run_hook)
    if ! printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED own-single-quoted-redirect: expected deny for \"echo x > '<ledger>'\", got '$out'"
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

test_own_quoted_rm_ledger_denies() {
    new_sandbox
    local cmd out result=0

    cmd="rm \"$LED\""
    out=$(jq -n --arg cmd "$cmd" --arg cwd "$GITDIR" '{tool_name:"Bash", tool_input:{command:$cmd}, session_id:"cx", cwd:$cwd}' | run_hook)
    if ! printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED own-quoted-rm: expected deny for 'rm \"<ledger>\"', got '$out'"
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

test_own_quoted_tee_ledger_denies() {
    new_sandbox
    local cmd out result=0

    cmd="echo x | tee \"$LED\""
    out=$(jq -n --arg cmd "$cmd" --arg cwd "$GITDIR" '{tool_name:"Bash", tool_input:{command:$cmd}, session_id:"cx", cwd:$cwd}' | run_hook)
    if ! printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED own-quoted-tee: expected deny for 'echo x | tee \"<ledger>\"', got '$out'"
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

# Non-ledger control -- a quoted redirect to a non-ledger target must still
# ALLOW (proves the quote-stripping fix does not turn quoting into an
# over-broad denier).
test_own_quoted_non_ledger_allows() {
    new_sandbox
    local cmd out rc=0 result=0

    cmd="echo x > \"$GITDIR/README.md\""
    out=$(jq -n --arg cmd "$cmd" --arg cwd "$GITDIR" '{tool_name:"Bash", tool_input:{command:$cmd}, session_id:"cx", cwd:$cwd}' | run_hook) || rc=$?
    if ! assert_allow "$out" "$rc" "own-quoted-non-ledger-allow"; then
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

# =============================================================================
# Regression -- alternate-key payload bypass (PR #176 AI-review findings):
# Codex has been observed sending the apply_patch payload text under
# tool_input.input / tool_input.patch (not just .command), and the
# exec_command/shell_command shell text under tool_input.cmd (not just
# .command). The guard used to read only .command in each route, so a
# write/delete targeting the ledger via one of these alternate keys was
# silently ALLOWED. Each DENY case below must deny; the final case is a
# non-ledger control proving the fix does not over-block.
# =============================================================================
test_own_apply_patch_input_key_ledger_denies() {
    new_sandbox
    local cmd out result=0

    cmd=$(printf '*** Begin Patch\n*** Update File: %s\n*** End Patch\n' "$LED")
    out=$(jq -n --arg cmd "$cmd" --arg cwd "$GITDIR" '{tool_name:"apply_patch", tool_input:{input:$cmd}, session_id:"cx", cwd:$cwd}' | run_hook)
    if ! printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED own-apply-patch-input-key: expected deny for apply_patch tool_input.input targeting ledger, got '$out'"
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

test_own_apply_patch_patch_key_ledger_denies() {
    new_sandbox
    local cmd out result=0

    cmd=$(printf '*** Begin Patch\n*** Delete File: %s\n*** End Patch\n' "$LED")
    out=$(jq -n --arg cmd "$cmd" --arg cwd "$GITDIR" '{tool_name:"apply_patch", tool_input:{patch:$cmd}, session_id:"cx", cwd:$cwd}' | run_hook)
    if ! printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED own-apply-patch-patch-key: expected deny for apply_patch tool_input.patch targeting ledger, got '$out'"
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

test_own_exec_command_cmd_key_ledger_denies() {
    new_sandbox
    local out result=0

    out=$(jq -n --arg cmd "echo x > $LED" --arg cwd "$GITDIR" '{tool_name:"exec_command", tool_input:{cmd:$cmd}, session_id:"cx", cwd:$cwd}' | run_hook)
    if ! printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED own-exec-command-cmd-key: expected deny for exec_command tool_input.cmd redirect to ledger, got '$out'"
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

test_own_shell_command_cmd_key_ledger_denies() {
    new_sandbox
    local out result=0

    out=$(jq -n --arg cmd "rm $LED" --arg cwd "$GITDIR" '{tool_name:"shell_command", tool_input:{cmd:$cmd}, session_id:"cx", cwd:$cwd}' | run_hook)
    if ! printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED own-shell-command-cmd-key: expected deny for shell_command tool_input.cmd 'rm <ledger>', got '$out'"
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

# Non-ledger control -- exec_command with tool_input.cmd targeting a
# non-ledger path must still ALLOW (proves reading the .cmd key does not
# turn it into an over-broad denier).
test_own_exec_command_cmd_key_non_ledger_allows() {
    new_sandbox
    local out rc=0 result=0

    out=$(jq -n --arg cmd "cat $GITDIR/README.md" --arg cwd "$GITDIR" '{tool_name:"exec_command", tool_input:{cmd:$cmd}, session_id:"cx", cwd:$cwd}' | run_hook) || rc=$?
    if ! assert_allow "$out" "$rc" "own-exec-command-cmd-key-allow"; then
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

# =============================================================================
# Regression -- lowercase native tool-name bypass (my-review finding): Codex
# has been observed sending native write tools under their lowercase form
# (write/edit/multiedit/multi_edit), mirroring the tool names tracked by the
# sibling extractor hooks/rules-injector/tool-paths.ts's TRACKED_TOOL_NAMES
# (:11-26), which normalizes via toLowerCase() (:29). The guard's allow-list
# used to only recognize the capitalized Bash/Edit/Write forms, so a
# lowercase native tool name fell through the case statement's `*) exit 0 ;;`
# before ever reaching the ledger-path check -- silently ALLOWING a write
# that targets the ledger. Each case below must DENY.
# =============================================================================
test_own_lowercase_write_file_path_ledger_denies() {
    new_sandbox
    local out result=0

    out=$(jq -n --arg fp "$LED" --arg cwd "$GITDIR" '{tool_name:"write", tool_input:{file_path:$fp}, session_id:"cx", cwd:$cwd}' | run_hook)
    if ! printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED own-lowercase-write-file-path: expected deny for lowercase 'write' tool_name targeting ledger, got '$out'"
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

test_own_lowercase_edit_file_path_ledger_denies() {
    new_sandbox
    local out result=0

    out=$(jq -n --arg fp "$LED" --arg cwd "$GITDIR" '{tool_name:"edit", tool_input:{file_path:$fp}, session_id:"cx", cwd:$cwd}' | run_hook)
    if ! printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED own-lowercase-edit-file-path: expected deny for lowercase 'edit' tool_name targeting ledger, got '$out'"
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

test_own_lowercase_multiedit_file_path_ledger_denies() {
    new_sandbox
    local out result=0

    out=$(jq -n --arg fp "$LED" --arg cwd "$GITDIR" '{tool_name:"multiedit", tool_input:{file_path:$fp}, session_id:"cx", cwd:$cwd}' | run_hook)
    if ! printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED own-lowercase-multiedit-file-path: expected deny for lowercase 'multiedit' tool_name targeting ledger, got '$out'"
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

test_own_lowercase_multi_edit_file_path_ledger_denies() {
    new_sandbox
    local out result=0

    out=$(jq -n --arg fp "$LED" --arg cwd "$GITDIR" '{tool_name:"multi_edit", tool_input:{file_path:$fp}, session_id:"cx", cwd:$cwd}' | run_hook)
    if ! printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED own-lowercase-multi-edit-file-path: expected deny for lowercase 'multi_edit' tool_name targeting ledger, got '$out'"
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

# Non-ledger control -- lowercase 'write' targeting a non-ledger file must
# still ALLOW (proves the tool-name-normalization fix does not over-block).
test_own_lowercase_write_file_path_non_ledger_allows() {
    new_sandbox
    local out rc=0 result=0

    out=$(jq -n --arg fp "$GITDIR/README.md" --arg cwd "$GITDIR" '{tool_name:"write", tool_input:{file_path:$fp}, session_id:"cx", cwd:$cwd}' | run_hook) || rc=$?
    if ! assert_allow "$out" "$rc" "own-lowercase-write-file-path-allow"; then
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

# =============================================================================
# Regression -- Edit/Write under-read of the path key (my-review finding):
# the Edit|Write route used to read ONLY tool_input.file_path, unlike the
# sibling extractor hooks/rules-injector/tool-paths.ts's addCommonPathFields
# (:52-63), which reads path/filePath/file_path/target/targetPath/target_path
# -- so a payload carrying the target under tool_input.path (capitalized
# 'Write' or lowercase 'write') fell through unread, silently ALLOWING a
# write that targets the ledger. Each case below must DENY.
# =============================================================================
test_own_write_path_key_ledger_denies() {
    new_sandbox
    local out result=0

    out=$(jq -n --arg p "$LED" --arg cwd "$GITDIR" '{tool_name:"Write", tool_input:{path:$p}, session_id:"cx", cwd:$cwd}' | run_hook)
    if ! printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED own-write-path-key: expected deny for 'Write' tool_input.path targeting ledger, got '$out'"
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

test_own_lowercase_write_path_key_ledger_denies() {
    new_sandbox
    local out result=0

    out=$(jq -n --arg p "$LED" --arg cwd "$GITDIR" '{tool_name:"write", tool_input:{path:$p}, session_id:"cx", cwd:$cwd}' | run_hook)
    if ! printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED own-lowercase-write-path-key: expected deny for lowercase 'write' tool_input.path targeting ledger, got '$out'"
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

# =============================================================================
# Regression (defect A, ported from the Claude twin _wg_absolutize fix) --
# an unexpanded env-var-literal ledger path bypasses the EXACT match:
# _cwg_absolutize used to recognize only a leading '/' as absolute, so a
# literal "$OMT_DIR/session-ledger-$OMT_SESSION_ID.md" (or, since Codex's
# resolved session id is OMT_SESSION_ID ?? CODEX_THREAD_ID, the
# $CODEX_THREAD_ID spelling) token was treated as RELATIVE and got cwd
# prefixed instead -- silently ALLOWING the exact form that hooks/omt-
# ledger.sh's SessionStart recovery pointer itself teaches agents to
# reproduce. Both env-var spellings must DENY.
# =============================================================================
test_own_env_var_omt_session_id_form_denies() {
    local sbx od out result=0
    sbx=$(mktemp -d)
    od="$sbx/omt-dir"
    mkdir -p "$od"

    out=$(jq -n --arg cmd 'echo x > "$OMT_DIR/session-ledger-$OMT_SESSION_ID.md"' --arg cwd "$od" \
        '{tool_name:"Bash", tool_input:{command:$cmd}, session_id:"cx", cwd:$cwd}' \
        | env -u CODEX_THREAD_ID OMT_DIR="$od" OMT_SESSION_ID=cx HOME="$sbx" bash "$HOOK")
    if ! printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED own-env-var-omt-session-id-form: expected deny for literal \$OMT_DIR/\$OMT_SESSION_ID target, got '$out'"
        result=1
    fi

    rm -rf "$sbx"
    return "$result"
}

test_own_env_var_codex_thread_id_form_denies() {
    local sbx od out result=0
    sbx=$(mktemp -d)
    od="$sbx/omt-dir"
    mkdir -p "$od"

    out=$(jq -n --arg cmd 'echo x > "$OMT_DIR/session-ledger-$CODEX_THREAD_ID.md"' --arg cwd "$od" \
        '{tool_name:"Bash", tool_input:{command:$cmd}, session_id:"cx", cwd:$cwd}' \
        | env -u OMT_SESSION_ID OMT_DIR="$od" HOME="$sbx" CODEX_THREAD_ID=cx bash "$HOOK")
    if ! printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED own-env-var-codex-thread-id-form: expected deny for literal \$OMT_DIR/\$CODEX_THREAD_ID target, got '$out'"
        result=1
    fi

    rm -rf "$sbx"
    return "$result"
}

# =============================================================================
# Regression -- quoted-prose false-positive (PR #176 AI-review finding): a
# legitimate `omt-ledger.sh append` command piped from `printf '...'` prose
# that happens to mention `> <ledger>` INSIDE a single-quoted string used to
# be denied -- the redirect-target grep in _cwg_extract_shell_targets read
# ANY `>` in the raw shell text as a live redirect regardless of quoting,
# unlike the Claude twin's _wg_scan (hooks/pre-tool-enforcer.sh:160-179),
# which quote-masks before classifying. Each ALLOW case below must allow;
# the final case is a non-quoted control proving the fix does not
# under-block a real redirect/rm (see test_qa_redirect_to_ledger_denies and
# test_own_rm_ledger_denies above, which already cover that regression).
# Evidence: $OMT_DIR/evidence/codex-ledger-parity/codex-write-guard-hook/quoted-prose-gt-allow.txt
# =============================================================================
test_qa_quoted_prose_gt_in_pipe_allows() {
    new_sandbox
    local cmd out evidence_dir rc=0 result=0

    cmd="printf 'note: see foo > $LED for details' | omt-ledger.sh append Decisions"
    out=$(jq -n --arg cmd "$cmd" --arg cwd "$GITDIR" '{tool_name:"Bash", tool_input:{command:$cmd}, session_id:"cx", cwd:$cwd}' | run_hook) || rc=$?

    evidence_dir="$EVIDENCE_OMT_DIR/evidence/codex-ledger-parity/codex-write-guard-hook"
    mkdir -p "$evidence_dir"
    {
        echo "input: $cmd (cwd=$GITDIR sid=cx)"
        echo "output: $out"
    } > "$evidence_dir/quoted-prose-gt-allow.txt"

    if ! assert_allow "$out" "$rc" "QA-quoted-prose-gt"; then
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

test_own_inquote_redirect_no_pipe_allows() {
    new_sandbox
    local cmd out rc=0 result=0

    cmd="echo 'text > $LED more'"
    out=$(jq -n --arg cmd "$cmd" --arg cwd "$GITDIR" '{tool_name:"Bash", tool_input:{command:$cmd}, session_id:"cx", cwd:$cwd}' | run_hook) || rc=$?
    if ! assert_allow "$out" "$rc" "own-inquote-redirect-no-pipe"; then
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

# =============================================================================
# Regression (claim W) -- the bash|exec_command|shell_command route ignored
# per-command tool_input.workdir/.cwd and always absolutized a relative write
# target against the module-global $cwd (the hook-level top-level .cwd), not
# the command's own working directory -- unlike the sibling extractor
# hooks/rules-injector/tool-paths.ts:44-46 (workdir ?? cwd) for command
# tools. A payload whose top-level .cwd is an unrelated directory but whose
# tool_input.workdir is the resolved ledger directory, paired with a relative
# target of just the ledger filename, wrote the real ledger while the guard
# resolved the relative path against the wrong (top-level) cwd and silently
# ALLOWED it. The DENY case below reproduces exactly that shape; the ALLOW
# control keeps workdir pointed at the unrelated directory with an absolute
# non-ledger target, proving the fix does not over-block.
# =============================================================================
test_regression_exec_command_workdir_relative_ledger_denies() {
    local sbx od other out result=0
    sbx=$(mktemp -d)
    od="$sbx/omt-dir"
    other="$sbx/other"
    mkdir -p "$od" "$other"

    # OMT_DIR is set explicitly (like test_own_relative_path_denies) so the
    # ledger path is pinned to $od regardless of cwd/workdir resolution --
    # the top-level .cwd is the UNRELATED $other directory, while
    # tool_input.workdir is $od. Pre-fix, the relative target absolutized
    # against the module-global cwd ($other) instead of workdir ($od),
    # producing $other/session-ledger-cx.md != the real ledger and silently
    # ALLOWING. Post-fix, the shell route reassigns cwd to workdir before
    # absolutizing, so the relative target resolves to $od/session-ledger-cx.md
    # and DENIES.
    out=$(jq -n --arg cmd "echo x > session-ledger-cx.md" --arg workdir "$od" --arg cwd "$other" \
        '{tool_name:"exec_command", tool_input:{cmd:$cmd, workdir:$workdir}, session_id:"cx", cwd:$cwd}' \
        | env -u OMT_SESSION_ID OMT_DIR="$od" HOME="$sbx" CODEX_THREAD_ID=cx bash "$HOOK")
    if ! printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED regression-exec-command-workdir: expected deny for relative ledger target resolved against tool_input.workdir, got '$out'"
        result=1
    fi

    rm -rf "$sbx"
    return "$result"
}

test_regression_exec_command_workdir_relative_non_ledger_allows() {
    local sbx od other out rc=0 result=0
    sbx=$(mktemp -d)
    od="$sbx/omt-dir"
    other="$sbx/other"
    mkdir -p "$od" "$other"

    out=$(jq -n --arg cmd "echo x > $other/README.md" --arg workdir "$other" --arg cwd "$other" \
        '{tool_name:"exec_command", tool_input:{cmd:$cmd, workdir:$workdir}, session_id:"cx", cwd:$cwd}' \
        | env -u OMT_SESSION_ID OMT_DIR="$od" HOME="$sbx" CODEX_THREAD_ID=cx bash "$HOOK") || rc=$?
    if ! assert_allow "$out" "$rc" "regression-exec-command-workdir-allow"; then
        result=1
    fi

    rm -rf "$sbx"
    return "$result"
}

# =============================================================================
# Regression (defect #3, code-review finding) -- fd-dup redirect exclusion
# swallows real file redirects: the old redirect-target grep required
# `(^|[^0-9&])` immediately before `>`/`>>` (meant to skip fd-dups like
# `2>&1`/`>&2`), but that same exclusion also skipped the FILE-target forms
# `2>` and `&>` -- a digit or `&` sits right before `>` in both cases -- so a
# real ledger redirect through either form silently ALLOWED, breaking parity
# with the Claude twin's over-extract regex (hooks/pre-tool-enforcer.sh:115),
# which has no such leading-char exclusion and correctly extracts both. Each
# DENY case below must deny; the fd-dup-only ALLOW controls (no ledger
# reference at all) prove the fix does not turn `2>&1`/`>&2` into
# over-broad deniers.
# =============================================================================
test_defect3_stderr_redirect_ledger_denies() {
    new_sandbox
    local out result=0

    out=$(printf '{"tool_name":"Bash","tool_input":{"command":"echo x 2> %s"},"session_id":"cx","cwd":"%s"}' "$LED" "$GITDIR" | run_hook)
    if ! printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED defect3-stderr-redirect: expected deny for 'echo x 2> <ledger>', got '$out'"
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

test_defect3_combined_redirect_ledger_denies() {
    new_sandbox
    local out result=0

    out=$(printf '{"tool_name":"Bash","tool_input":{"command":"echo x &> %s"},"session_id":"cx","cwd":"%s"}' "$LED" "$GITDIR" | run_hook)
    if ! printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED defect3-combined-redirect: expected deny for 'echo x &> <ledger>', got '$out'"
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

test_defect3_fd_dup_stderr_to_stdout_no_ledger_allows() {
    new_sandbox
    local out rc=0 result=0

    out=$(printf '{"tool_name":"Bash","tool_input":{"command":"echo x 2>&1"},"session_id":"cx","cwd":"%s"}' "$GITDIR" | run_hook) || rc=$?
    if ! assert_allow "$out" "$rc" "defect3-fd-dup-stderr-to-stdout-allow"; then
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

test_defect3_fd_dup_stdout_to_stderr_no_ledger_allows() {
    new_sandbox
    local out rc=0 result=0

    out=$(printf '{"tool_name":"Bash","tool_input":{"command":"echo x >&2"},"session_id":"cx","cwd":"%s"}' "$GITDIR" | run_hook) || rc=$?
    if ! assert_allow "$out" "$rc" "defect3-fd-dup-stdout-to-stderr-allow"; then
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

# =============================================================================
# Regression (defect #4, code-review finding) -- per-segment inner quotes
# survive strip and break EXACT match: _cwg_strip_quotes only unwraps ONE
# outermost double-quote pair then ONE outermost single-quote pair, but a
# real shell word can be built from several ADJACENT quoted spans with no
# separating whitespace (e.g. "$OMT_DIR"/"session-ledger-$OMT_SESSION_ID.md"),
# which the real shell concatenates into a single word with ALL quote
# characters removed. The old strip only removed the very first and very
# last quote character of the token, leaving the INNER quote characters
# (around the literal `/`) embedded in the candidate -- so after env-var
# substitution the candidate carried stray `"` characters and never
# full-path EXACT matched the real ledger path, silently ALLOWING. The DENY
# case below must deny; the non-ledger control proves the fix does not
# over-block a legitimate per-token-quoted non-ledger target.
# =============================================================================
test_defect4_per_token_quoted_env_var_denies() {
    local sbx od out result=0
    sbx=$(mktemp -d)
    od="$sbx/omt-dir"
    mkdir -p "$od"

    out=$(jq -n --arg cmd 'echo x > "$OMT_DIR"/"session-ledger-$OMT_SESSION_ID.md"' --arg cwd "$od" \
        '{tool_name:"Bash", tool_input:{command:$cmd}, session_id:"cx", cwd:$cwd}' \
        | env -u CODEX_THREAD_ID OMT_DIR="$od" OMT_SESSION_ID=cx HOME="$sbx" bash "$HOOK")
    if ! printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED defect4-per-token-quoted-env-var: expected deny for per-token quoted env-var ledger redirect, got '$out'"
        result=1
    fi

    rm -rf "$sbx"
    return "$result"
}

test_defect4_per_token_quoted_non_ledger_allows() {
    new_sandbox
    local cmd out rc=0 result=0

    cmd="echo x > \"$GITDIR\"/\"other.md\""
    out=$(jq -n --arg cmd "$cmd" --arg cwd "$GITDIR" '{tool_name:"Bash", tool_input:{command:$cmd}, session_id:"cx", cwd:$cwd}' | run_hook) || rc=$?
    if ! assert_allow "$out" "$rc" "defect4-per-token-quoted-non-ledger-allow"; then
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

# =============================================================================
# Regression (CONFIRMED bypass, independent code review) -- $HOME/~ spelling
# of the ledger path bypasses the EXACT match: _cwg_absolutize expands
# $OMT_DIR/$OMT_SESSION_ID/$CODEX_THREAD_ID but NOT $HOME/${HOME} or a
# leading `~`. Because the resolved omt_dir is ALWAYS $HOME/.omt/<proj>, a
# home-relative spelling of the ledger reaches the SAME file but is not
# matched: `rm "$HOME/.omt/<proj>/session-ledger-<sid>.md"` leaves $HOME
# literal (never matches), and `rm ~/.omt/<proj>/session-ledger-<sid>.md`
# leaves `~` literal and treated as a cwd-relative token (never matches) --
# both silently ALLOW. main's old substring guard caught these; this is a
# regression. Each DENY case below must deny; the two non-ledger controls
# prove the fix does not over-block a legitimate $HOME-relative target.
# =============================================================================
test_own_home_env_var_form_denies() {
    local sbx od out result=0
    sbx=$(mktemp -d)
    od="$sbx/.omt/proj"
    mkdir -p "$od"

    out=$(jq -n --arg cmd 'rm "$HOME/.omt/proj/session-ledger-cx.md"' --arg cwd "$od" \
        '{tool_name:"Bash", tool_input:{command:$cmd}, session_id:"cx", cwd:$cwd}' \
        | env -u OMT_SESSION_ID OMT_DIR="$od" HOME="$sbx" CODEX_THREAD_ID=cx bash "$HOOK")
    if ! printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED own-home-env-var-form: expected deny for literal \$HOME/.omt/proj/session-ledger-cx.md target, got '$out'"
        result=1
    fi

    rm -rf "$sbx"
    return "$result"
}

test_own_home_tilde_form_denies() {
    local sbx od out result=0
    sbx=$(mktemp -d)
    od="$sbx/.omt/proj"
    mkdir -p "$od"

    out=$(jq -n --arg cmd 'rm ~/.omt/proj/session-ledger-cx.md' --arg cwd "$od" \
        '{tool_name:"Bash", tool_input:{command:$cmd}, session_id:"cx", cwd:$cwd}' \
        | env -u OMT_SESSION_ID OMT_DIR="$od" HOME="$sbx" CODEX_THREAD_ID=cx bash "$HOOK")
    if ! printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED own-home-tilde-form: expected deny for literal ~/.omt/proj/session-ledger-cx.md target, got '$out'"
        result=1
    fi

    rm -rf "$sbx"
    return "$result"
}

test_own_home_env_var_non_ledger_allows() {
    local sbx od out rc=0 result=0
    sbx=$(mktemp -d)
    od="$sbx/.omt/proj"
    mkdir -p "$od"

    out=$(jq -n --arg cmd 'rm "$HOME/.omt/proj/other-file.md"' --arg cwd "$od" \
        '{tool_name:"Bash", tool_input:{command:$cmd}, session_id:"cx", cwd:$cwd}' \
        | env -u OMT_SESSION_ID OMT_DIR="$od" HOME="$sbx" CODEX_THREAD_ID=cx bash "$HOOK") || rc=$?
    if ! assert_allow "$out" "$rc" "own-home-env-var-non-ledger-allow"; then
        result=1
    fi

    rm -rf "$sbx"
    return "$result"
}

test_own_home_outside_omt_dir_allows() {
    local sbx od out rc=0 result=0
    sbx=$(mktemp -d)
    od="$sbx/.omt/proj"
    mkdir -p "$od"

    out=$(jq -n --arg cmd 'rm "$HOME/notes.md"' --arg cwd "$od" \
        '{tool_name:"Bash", tool_input:{command:$cmd}, session_id:"cx", cwd:$cwd}' \
        | env -u OMT_SESSION_ID OMT_DIR="$od" HOME="$sbx" CODEX_THREAD_ID=cx bash "$HOOK") || rc=$?
    if ! assert_allow "$out" "$rc" "own-home-outside-omt-dir-allow"; then
        result=1
    fi

    rm -rf "$sbx"
    return "$result"
}

# =============================================================================
# Alt-path-key coverage (ultragoal test-hardening story, Goal A): the
# Edit|Write|MultiEdit|multi_edit route in hooks/codex-write-guard.sh reads
# ALL SIX scalar path keys (file_path/path/filePath/target/targetPath/
# target_path) and ALL THREE array path keys (paths/filePaths/file_paths) --
# see codex-write-guard.sh:428-438. file_path already has deny+allow coverage
# above (test_own_relative_path_denies / test_own_native_edit_non_ledger_allows)
# and path already has deny coverage (test_own_write_path_key_ledger_denies).
# This block fills in path's allow leg, and the filePath/target/targetPath/
# target_path/paths/filePaths/file_paths keys' deny+allow legs end to end, so
# every key the hook reads is actually exercised by the suite.
# =============================================================================
test_own_write_path_key_non_ledger_allows() {
    new_sandbox
    local out rc=0 result=0

    out=$(jq -n --arg p "$GITDIR/README.md" --arg cwd "$GITDIR" '{tool_name:"Write", tool_input:{path:$p}, session_id:"cx", cwd:$cwd}' | run_hook) || rc=$?
    if ! assert_allow "$out" "$rc" "own-write-path-key-non-ledger-allow"; then
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

test_own_filepath_key_ledger_denies() {
    new_sandbox
    local out result=0

    out=$(jq -n --arg fp "$LED" --arg cwd "$GITDIR" '{tool_name:"Edit", tool_input:{filePath:$fp}, session_id:"cx", cwd:$cwd}' | run_hook)
    if ! printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED own-filepath-key: expected deny for 'Edit' tool_input.filePath targeting ledger, got '$out'"
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

test_own_filepath_key_non_ledger_allows() {
    new_sandbox
    local out rc=0 result=0

    out=$(jq -n --arg fp "$GITDIR/README.md" --arg cwd "$GITDIR" '{tool_name:"Edit", tool_input:{filePath:$fp}, session_id:"cx", cwd:$cwd}' | run_hook) || rc=$?
    if ! assert_allow "$out" "$rc" "own-filepath-key-non-ledger-allow"; then
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

test_own_target_key_ledger_denies() {
    new_sandbox
    local out result=0

    out=$(jq -n --arg fp "$LED" --arg cwd "$GITDIR" '{tool_name:"Edit", tool_input:{target:$fp}, session_id:"cx", cwd:$cwd}' | run_hook)
    if ! printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED own-target-key: expected deny for 'Edit' tool_input.target targeting ledger, got '$out'"
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

test_own_target_key_non_ledger_allows() {
    new_sandbox
    local out rc=0 result=0

    out=$(jq -n --arg fp "$GITDIR/README.md" --arg cwd "$GITDIR" '{tool_name:"Edit", tool_input:{target:$fp}, session_id:"cx", cwd:$cwd}' | run_hook) || rc=$?
    if ! assert_allow "$out" "$rc" "own-target-key-non-ledger-allow"; then
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

test_own_targetpath_key_ledger_denies() {
    new_sandbox
    local out result=0

    out=$(jq -n --arg fp "$LED" --arg cwd "$GITDIR" '{tool_name:"Edit", tool_input:{targetPath:$fp}, session_id:"cx", cwd:$cwd}' | run_hook)
    if ! printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED own-targetpath-key: expected deny for 'Edit' tool_input.targetPath targeting ledger, got '$out'"
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

test_own_targetpath_key_non_ledger_allows() {
    new_sandbox
    local out rc=0 result=0

    out=$(jq -n --arg fp "$GITDIR/README.md" --arg cwd "$GITDIR" '{tool_name:"Edit", tool_input:{targetPath:$fp}, session_id:"cx", cwd:$cwd}' | run_hook) || rc=$?
    if ! assert_allow "$out" "$rc" "own-targetpath-key-non-ledger-allow"; then
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

test_own_target_path_key_ledger_denies() {
    new_sandbox
    local out result=0

    out=$(jq -n --arg fp "$LED" --arg cwd "$GITDIR" '{tool_name:"Edit", tool_input:{target_path:$fp}, session_id:"cx", cwd:$cwd}' | run_hook)
    if ! printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED own-target-path-key: expected deny for 'Edit' tool_input.target_path targeting ledger, got '$out'"
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

test_own_target_path_key_non_ledger_allows() {
    new_sandbox
    local out rc=0 result=0

    out=$(jq -n --arg fp "$GITDIR/README.md" --arg cwd "$GITDIR" '{tool_name:"Edit", tool_input:{target_path:$fp}, session_id:"cx", cwd:$cwd}' | run_hook) || rc=$?
    if ! assert_allow "$out" "$rc" "own-target-path-key-non-ledger-allow"; then
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

# -----------------------------------------------------------------------------
# Array-form path keys (paths/filePaths/file_paths). Each key gets a
# single-element ledger deny, a mid-array (non-first-element) ledger deny --
# proving the extractor iterates the WHOLE array rather than reading only
# element 0 -- and a non-ledger allow.
# -----------------------------------------------------------------------------
test_own_paths_key_ledger_denies() {
    new_sandbox
    local out result=0

    out=$(jq -n --arg fp "$LED" --arg cwd "$GITDIR" '{tool_name:"Edit", tool_input:{paths:[$fp]}, session_id:"cx", cwd:$cwd}' | run_hook)
    if ! printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED own-paths-key: expected deny for 'Edit' tool_input.paths=[<ledger>], got '$out'"
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

test_own_paths_key_mid_array_ledger_denies() {
    new_sandbox
    local out result=0

    out=$(jq -n --arg a "$GITDIR/a.md" --arg led "$LED" --arg b "$GITDIR/b.md" --arg cwd "$GITDIR" \
        '{tool_name:"Edit", tool_input:{paths:[$a,$led,$b]}, session_id:"cx", cwd:$cwd}' | run_hook)
    if ! printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED own-paths-key-mid-array: expected deny for ledger as non-first element of tool_input.paths, got '$out'"
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

test_own_paths_key_non_ledger_allows() {
    new_sandbox
    local out rc=0 result=0

    out=$(jq -n --arg a "$GITDIR/a.md" --arg b "$GITDIR/b.md" --arg cwd "$GITDIR" \
        '{tool_name:"Edit", tool_input:{paths:[$a,$b]}, session_id:"cx", cwd:$cwd}' | run_hook) || rc=$?
    if ! assert_allow "$out" "$rc" "own-paths-key-non-ledger-allow"; then
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

test_own_filepaths_key_ledger_denies() {
    new_sandbox
    local out result=0

    out=$(jq -n --arg fp "$LED" --arg cwd "$GITDIR" '{tool_name:"Edit", tool_input:{filePaths:[$fp]}, session_id:"cx", cwd:$cwd}' | run_hook)
    if ! printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED own-filepaths-key: expected deny for 'Edit' tool_input.filePaths=[<ledger>], got '$out'"
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

test_own_filepaths_key_mid_array_ledger_denies() {
    new_sandbox
    local out result=0

    out=$(jq -n --arg a "$GITDIR/a.md" --arg led "$LED" --arg b "$GITDIR/b.md" --arg cwd "$GITDIR" \
        '{tool_name:"Edit", tool_input:{filePaths:[$a,$led,$b]}, session_id:"cx", cwd:$cwd}' | run_hook)
    if ! printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED own-filepaths-key-mid-array: expected deny for ledger as non-first element of tool_input.filePaths, got '$out'"
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

test_own_filepaths_key_non_ledger_allows() {
    new_sandbox
    local out rc=0 result=0

    out=$(jq -n --arg a "$GITDIR/a.md" --arg b "$GITDIR/b.md" --arg cwd "$GITDIR" \
        '{tool_name:"Edit", tool_input:{filePaths:[$a,$b]}, session_id:"cx", cwd:$cwd}' | run_hook) || rc=$?
    if ! assert_allow "$out" "$rc" "own-filepaths-key-non-ledger-allow"; then
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

test_own_file_paths_key_ledger_denies() {
    new_sandbox
    local out result=0

    out=$(jq -n --arg fp "$LED" --arg cwd "$GITDIR" '{tool_name:"Edit", tool_input:{file_paths:[$fp]}, session_id:"cx", cwd:$cwd}' | run_hook)
    if ! printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED own-file-paths-key: expected deny for 'Edit' tool_input.file_paths=[<ledger>], got '$out'"
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

test_own_file_paths_key_mid_array_ledger_denies() {
    new_sandbox
    local out result=0

    out=$(jq -n --arg a "$GITDIR/a.md" --arg led "$LED" --arg b "$GITDIR/b.md" --arg cwd "$GITDIR" \
        '{tool_name:"Edit", tool_input:{file_paths:[$a,$led,$b]}, session_id:"cx", cwd:$cwd}' | run_hook)
    if ! printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED own-file-paths-key-mid-array: expected deny for ledger as non-first element of tool_input.file_paths, got '$out'"
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

test_own_file_paths_key_non_ledger_allows() {
    new_sandbox
    local out rc=0 result=0

    out=$(jq -n --arg a "$GITDIR/a.md" --arg b "$GITDIR/b.md" --arg cwd "$GITDIR" \
        '{tool_name:"Edit", tool_input:{file_paths:[$a,$b]}, session_id:"cx", cwd:$cwd}' | run_hook) || rc=$?
    if ! assert_allow "$out" "$rc" "own-file-paths-key-non-ledger-allow"; then
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

# =============================================================================
# Code-review artifact identity guard (agent_type wiring task): covers the
# codereview_guard_core_run wiring (hooks/write-guard-core.sh:173) added at
# the tail of hooks/codex-write-guard.sh, mirroring the Claude twin's wiring
# (hooks/pre-tool-enforcer.sh:260-288). Reproduces the same 3-case matrix
# (agent_type absent -> deny, ="code-reviewer" -> allow, ="sisyphus-junior"
# -> deny) across BOTH the apply_patch envelope route and the
# exec_command/shell_command route.
#
# FIXTURE PROVENANCE (HAND-CRAFTED, not machine-captured): the eleven
# top-level field names carried by codex_full_payload below (session_id
# turn_id agent_type transcript_path hook_event_name model permission_mode
# trigger tool_name tool_input tool_use_id) were fixed from a `strings` scan
# of the codex binary itself -- but the actual SHAPE of agent_type's value
# for a real dispatched subagent (e.g. whether a custom agent's agent_type is
# its skill filename or its frontmatter `name`) is inferred only from
# Claude's own subagent-dispatch documentation, not from an observed live
# Codex payload. Treat this fixture as provisional pending cross-check
# against the first real Codex code-reviewer dispatch.
# =============================================================================

# codex_full_payload <tool_name> <tool_input_json> <sid> <cwd> [<agent_type>]
# Builds a payload carrying all eleven top-level fields observed in the real
# Codex PreToolUse schema, plus cwd (not one of the eleven scanned fields,
# but load-bearing for every hook invocation in this suite already -- every
# prior test threads it through the same way for OMT_DIR git-derivation). A
# 5th positional arg supplies agent_type's value; omitting it entirely
# (4-arg call) reproduces the real main-thread payload shape -- the
# agent_type KEY absent altogether, not present-with-empty-string, since a
# main-thread tool call never carries the field at all.
codex_full_payload() {
    local tool_name="$1" tool_input="$2" sid="$3" cwd="$4"
    if [ "$#" -ge 5 ]; then
        local agent_type="$5"
        jq -n --arg tool_name "$tool_name" --argjson tool_input "$tool_input" \
            --arg sid "$sid" --arg cwd "$cwd" --arg agent_type "$agent_type" \
            '{session_id:$sid, turn_id:"turn-1", agent_type:$agent_type,
              transcript_path:"/tmp/codex-transcript.jsonl", hook_event_name:"PreToolUse",
              model:"gpt-5-codex", permission_mode:"default", trigger:"tool_call",
              tool_name:$tool_name, tool_input:$tool_input, tool_use_id:"tu-1", cwd:$cwd}'
    else
        jq -n --arg tool_name "$tool_name" --argjson tool_input "$tool_input" \
            --arg sid "$sid" --arg cwd "$cwd" \
            '{session_id:$sid, turn_id:"turn-1",
              transcript_path:"/tmp/codex-transcript.jsonl", hook_event_name:"PreToolUse",
              model:"gpt-5-codex", permission_mode:"default", trigger:"tool_call",
              tool_name:$tool_name, tool_input:$tool_input, tool_use_id:"tu-1", cwd:$cwd}'
    fi
}

# cr_paths: derives the two guarded code-review artifact paths (ultragoal +
# goal, AC5 parity) plus two NON-guarded paths used by the negative-control
# tests below, all for session "cx" under the current sandbox's $GITDIR/$SBX
# -- parallel to new_sandbox's own $LED derivation. Must be called AFTER
# new_sandbox.
cr_paths() {
    CR_ULTRAGOAL=$(env -u OMT_DIR -u OMT_SESSION_ID HOME="$SBX" bash -c \
        "source '$ROOT_DIR/hooks/lib/omt-dir.sh'; printf '%s/ultragoal-codereview-cx.json' \"\$(resolve_omt_dir '$GITDIR')\"")
    CR_GOAL=$(env -u OMT_DIR -u OMT_SESSION_ID HOME="$SBX" bash -c \
        "source '$ROOT_DIR/hooks/lib/omt-dir.sh'; printf '%s/goal-codereview-cx.json' \"\$(resolve_omt_dir '$GITDIR')\"")
    CR_ULTRAGOAL_VERDICT=$(env -u OMT_DIR -u OMT_SESSION_ID HOME="$SBX" bash -c \
        "source '$ROOT_DIR/hooks/lib/omt-dir.sh'; printf '%s/ultragoal-verdict-cx.json' \"\$(resolve_omt_dir '$GITDIR')\"")
    CR_CANDIDATES=$(env -u OMT_DIR -u OMT_SESSION_ID HOME="$SBX" bash -c \
        "source '$ROOT_DIR/hooks/lib/omt-dir.sh'; printf '%s/code-review/cx/candidates.json' \"\$(resolve_omt_dir '$GITDIR')\"")
}

# --- apply_patch envelope route: 3-case matrix, ultragoal-codereview target ---

test_codereview_apply_patch_agent_type_absent_denies() {
    new_sandbox
    cr_paths
    local tool_input out result=0

    tool_input=$(jq -n --arg cmd "$(printf '*** Begin Patch\n*** Add File: %s\n*** End Patch\n' "$CR_ULTRAGOAL")" '{command:$cmd}')
    out=$(codex_full_payload "apply_patch" "$tool_input" "cx" "$GITDIR" | run_hook)
    if ! printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED codereview-apply-patch-absent: expected deny for agent_type-absent apply_patch targeting the ultragoal-codereview artifact, got '$out'"
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

test_codereview_apply_patch_agent_type_code_reviewer_allows() {
    new_sandbox
    cr_paths
    local tool_input out rc=0 result=0

    tool_input=$(jq -n --arg cmd "$(printf '*** Begin Patch\n*** Add File: %s\n*** End Patch\n' "$CR_ULTRAGOAL")" '{command:$cmd}')
    out=$(codex_full_payload "apply_patch" "$tool_input" "cx" "$GITDIR" "code-reviewer" | run_hook) || rc=$?
    if ! assert_allow "$out" "$rc" "codereview-apply-patch-code-reviewer"; then
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

test_codereview_apply_patch_agent_type_sisyphus_junior_denies() {
    new_sandbox
    cr_paths
    local tool_input out result=0

    tool_input=$(jq -n --arg cmd "$(printf '*** Begin Patch\n*** Add File: %s\n*** End Patch\n' "$CR_ULTRAGOAL")" '{command:$cmd}')
    out=$(codex_full_payload "apply_patch" "$tool_input" "cx" "$GITDIR" "sisyphus-junior" | run_hook)
    if ! printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED codereview-apply-patch-sisyphus-junior: expected deny for agent_type=sisyphus-junior apply_patch targeting the ultragoal-codereview artifact, got '$out'"
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

# --- exec_command/shell_command route: 3-case matrix, goal-codereview target
# (AC5: goal-codereview path coverage) ---

test_codereview_shell_command_agent_type_absent_denies() {
    new_sandbox
    cr_paths
    local tool_input out result=0

    tool_input=$(jq -n --arg cmd "echo x > $CR_GOAL" '{cmd:$cmd}')
    out=$(codex_full_payload "shell_command" "$tool_input" "cx" "$GITDIR" | run_hook)
    if ! printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED codereview-shell-command-absent: expected deny for agent_type-absent shell_command targeting the goal-codereview artifact, got '$out'"
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

test_codereview_shell_command_agent_type_code_reviewer_allows() {
    new_sandbox
    cr_paths
    local tool_input out rc=0 result=0

    tool_input=$(jq -n --arg cmd "echo x > $CR_GOAL" '{cmd:$cmd}')
    out=$(codex_full_payload "shell_command" "$tool_input" "cx" "$GITDIR" "code-reviewer" | run_hook) || rc=$?
    if ! assert_allow "$out" "$rc" "codereview-shell-command-code-reviewer"; then
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

test_codereview_shell_command_agent_type_sisyphus_junior_denies() {
    new_sandbox
    cr_paths
    local tool_input out result=0

    tool_input=$(jq -n --arg cmd "echo x > $CR_GOAL" '{cmd:$cmd}')
    out=$(codex_full_payload "shell_command" "$tool_input" "cx" "$GITDIR" "sisyphus-junior" | run_hook)
    if ! printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED codereview-shell-command-sisyphus-junior: expected deny for agent_type=sisyphus-junior shell_command targeting the goal-codereview artifact, got '$out'"
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

# =============================================================================
# AC6 -- false-positive negative controls: agent_type absent targeting paths
# the code-review identity guard does NOT cover at all (ultragoal-verdict-
# <sid>.json, code-review/<sid>/candidates.json) must still ALLOW. If this
# breaks, the normal write path for these unrelated artifacts is dead with
# no bypass available -- codereview_guard_core_run's anchor-match is scoped
# to exactly the two guarded paths (write-guard-core.sh:176-178), so a
# regression here would mean the guard widened past its intended scope.
# =============================================================================
test_codereview_negative_control_ultragoal_verdict_allows() {
    new_sandbox
    cr_paths
    local tool_input out rc=0 result=0

    tool_input=$(jq -n --arg fp "$CR_ULTRAGOAL_VERDICT" '{file_path:$fp}')
    out=$(codex_full_payload "write" "$tool_input" "cx" "$GITDIR" | run_hook) || rc=$?
    if ! assert_allow "$out" "$rc" "codereview-negative-control-ultragoal-verdict"; then
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

test_codereview_negative_control_candidates_json_allows() {
    new_sandbox
    cr_paths
    local tool_input out rc=0 result=0

    tool_input=$(jq -n --arg fp "$CR_CANDIDATES" '{file_path:$fp}')
    out=$(codex_full_payload "write" "$tool_input" "cx" "$GITDIR" | run_hook) || rc=$?
    if ! assert_allow "$out" "$rc" "codereview-negative-control-candidates-json"; then
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

# =============================================================================
# AC4 -- Claude/Codex byte-identical deny JSON: the wiring MUST forward to
# the shared core (codereview_guard_core_run, hooks/write-guard-core.sh)
# rather than a locally duplicated deny string, so both platform shims emit
# the EXACT same bytes for the same verdict. Runs BOTH real hooks (not a
# read of the core's constant, which would be tautological) against
# equivalent payloads (agent_type absent, targeting the ultragoal-codereview
# artifact) under the SAME sid/OMT_DIR so both resolve to the identical
# guarded path, then string-compares stdout.
# =============================================================================
test_ac4_codex_claude_deny_json_byte_identical() {
    new_sandbox
    cr_paths
    local codex_tool_input codex_out claude_out result=0

    codex_tool_input=$(jq -n --arg fp "$CR_ULTRAGOAL" '{file_path:$fp}')
    codex_out=$(codex_full_payload "write" "$codex_tool_input" "cx" "$GITDIR" | run_hook)

    claude_out=$(jq -n --arg fp "$CR_ULTRAGOAL" --arg cwd "$GITDIR" \
        '{tool_name:"Write", tool_input:{file_path:$fp}, session_id:"cx", cwd:$cwd}' \
        | env -u OMT_DIR -u CODEX_THREAD_ID OMT_SESSION_ID=cx HOME="$SBX" bash "$SCRIPT_DIR/pre-tool-enforcer.sh")

    if [ "$codex_out" != "$claude_out" ]; then
        echo "ASSERTION FAILED ac4-byte-identical: codex output '$codex_out' != claude output '$claude_out'"
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
    run_test test_own_rm_ledger_denies
    run_test test_own_tee_ledger_denies
    run_test test_own_dd_ledger_denies
    run_test test_own_cp_ledger_denies
    run_test test_own_truncate_ledger_denies
    run_test test_own_sed_i_ledger_denies
    run_test test_bypass_sed_i_non_final_operand_ledger_denies
    run_test test_bypass_sed_i_non_ledger_allows
    run_test test_own_rm_non_ledger_allows
    run_test test_own_double_quoted_redirect_ledger_denies
    run_test test_own_single_quoted_redirect_ledger_denies
    run_test test_own_quoted_rm_ledger_denies
    run_test test_own_quoted_tee_ledger_denies
    run_test test_own_quoted_non_ledger_allows
    run_test test_own_apply_patch_input_key_ledger_denies
    run_test test_own_apply_patch_patch_key_ledger_denies
    run_test test_own_exec_command_cmd_key_ledger_denies
    run_test test_own_shell_command_cmd_key_ledger_denies
    run_test test_own_exec_command_cmd_key_non_ledger_allows
    run_test test_own_lowercase_write_file_path_ledger_denies
    run_test test_own_lowercase_edit_file_path_ledger_denies
    run_test test_own_lowercase_multiedit_file_path_ledger_denies
    run_test test_own_lowercase_multi_edit_file_path_ledger_denies
    run_test test_own_lowercase_write_file_path_non_ledger_allows
    run_test test_own_write_path_key_ledger_denies
    run_test test_own_lowercase_write_path_key_ledger_denies
    run_test test_own_env_var_omt_session_id_form_denies
    run_test test_own_env_var_codex_thread_id_form_denies
    run_test test_qa_quoted_prose_gt_in_pipe_allows
    run_test test_own_inquote_redirect_no_pipe_allows
    run_test test_regression_exec_command_workdir_relative_ledger_denies
    run_test test_regression_exec_command_workdir_relative_non_ledger_allows
    run_test test_defect3_stderr_redirect_ledger_denies
    run_test test_defect3_combined_redirect_ledger_denies
    run_test test_defect3_fd_dup_stderr_to_stdout_no_ledger_allows
    run_test test_defect3_fd_dup_stdout_to_stderr_no_ledger_allows
    run_test test_defect4_per_token_quoted_env_var_denies
    run_test test_defect4_per_token_quoted_non_ledger_allows
    run_test test_own_home_env_var_form_denies
    run_test test_own_home_tilde_form_denies
    run_test test_own_home_env_var_non_ledger_allows
    run_test test_own_home_outside_omt_dir_allows
    run_test test_own_write_path_key_non_ledger_allows
    run_test test_own_filepath_key_ledger_denies
    run_test test_own_filepath_key_non_ledger_allows
    run_test test_own_target_key_ledger_denies
    run_test test_own_target_key_non_ledger_allows
    run_test test_own_targetpath_key_ledger_denies
    run_test test_own_targetpath_key_non_ledger_allows
    run_test test_own_target_path_key_ledger_denies
    run_test test_own_target_path_key_non_ledger_allows
    run_test test_own_paths_key_ledger_denies
    run_test test_own_paths_key_mid_array_ledger_denies
    run_test test_own_paths_key_non_ledger_allows
    run_test test_own_filepaths_key_ledger_denies
    run_test test_own_filepaths_key_mid_array_ledger_denies
    run_test test_own_filepaths_key_non_ledger_allows
    run_test test_own_file_paths_key_ledger_denies
    run_test test_own_file_paths_key_mid_array_ledger_denies
    run_test test_own_file_paths_key_non_ledger_allows
    run_test test_codereview_apply_patch_agent_type_absent_denies
    run_test test_codereview_apply_patch_agent_type_code_reviewer_allows
    run_test test_codereview_apply_patch_agent_type_sisyphus_junior_denies
    run_test test_codereview_shell_command_agent_type_absent_denies
    run_test test_codereview_shell_command_agent_type_code_reviewer_allows
    run_test test_codereview_shell_command_agent_type_sisyphus_junior_denies
    run_test test_codereview_negative_control_ultragoal_verdict_allows
    run_test test_codereview_negative_control_candidates_json_allows
    run_test test_ac4_codex_claude_deny_json_byte_identical

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [ "$TESTS_FAILED" -gt 0 ]; then
        exit 1
    fi
}

main "$@"

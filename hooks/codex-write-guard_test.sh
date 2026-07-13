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
    local out evidence_dir result=0

    out=$(printf '{"tool_name":"Bash","tool_input":{"command":"echo editing the session-ledger docs"},"session_id":"cx","cwd":"%s"}' "$GITDIR" | run_hook)

    evidence_dir="$EVIDENCE_OMT_DIR/evidence/codex-ledger-parity/codex-write-guard-hook"
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

# Non-ledger control -- 'rm' on a non-ledger file must ALLOW (proves the
# set -e fix does not turn rm into an over-broad denier).
test_own_rm_non_ledger_allows() {
    new_sandbox
    local out result=0

    out=$(printf '{"tool_name":"Bash","tool_input":{"command":"rm %s/README.md"},"session_id":"cx","cwd":"%s"}' "$GITDIR" "$GITDIR" | run_hook)
    if [ "$(printf '%s' "$out" | grep -c deny)" != "0" ]; then
        echo "ASSERTION FAILED own-rm-non-ledger-allow: expected allow, got '$out'"
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
    local cmd out result=0

    cmd="echo x > \"$GITDIR/README.md\""
    out=$(jq -n --arg cmd "$cmd" --arg cwd "$GITDIR" '{tool_name:"Bash", tool_input:{command:$cmd}, session_id:"cx", cwd:$cwd}' | run_hook)
    if [ "$(printf '%s' "$out" | grep -c deny)" != "0" ]; then
        echo "ASSERTION FAILED own-quoted-non-ledger-allow: expected allow for quoted non-ledger target, got '$out'"
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
    local out result=0

    out=$(jq -n --arg cmd "cat $GITDIR/README.md" --arg cwd "$GITDIR" '{tool_name:"exec_command", tool_input:{cmd:$cmd}, session_id:"cx", cwd:$cwd}' | run_hook)
    if [ "$(printf '%s' "$out" | grep -c deny)" != "0" ]; then
        echo "ASSERTION FAILED own-exec-command-cmd-key-allow: expected allow for non-ledger tool_input.cmd, got '$out'"
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
    local out result=0

    out=$(jq -n --arg fp "$GITDIR/README.md" --arg cwd "$GITDIR" '{tool_name:"write", tool_input:{file_path:$fp}, session_id:"cx", cwd:$cwd}' | run_hook)
    if [ "$(printf '%s' "$out" | grep -c deny)" != "0" ]; then
        echo "ASSERTION FAILED own-lowercase-write-file-path-allow: expected allow for lowercase 'write' non-ledger target, got '$out'"
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

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [ "$TESTS_FAILED" -gt 0 ]; then
        exit 1
    fi
}

main "$@"

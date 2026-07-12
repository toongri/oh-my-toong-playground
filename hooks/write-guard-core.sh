#!/bin/bash
# =============================================================================
# Write-Guard Core (codex-ledger-parity plan, TODO 2): the shared full-path
# anchor-match + byte-identical deny core for the ledger write-guard, sourced
# by both hooks/pre-tool-enforcer.sh (Claude) and the Codex PreToolUse hook.
# Full-path EXACT match on the resolved current-session ledger only -- NEVER
# a bare "session-ledger-" substring (that loose match is
# hooks/pre-tool-enforcer.sh's superseded _wg_ledger_target_in_segment
# classifier, hooks/pre-tool-enforcer.sh:42-77).
#
# The per-platform shim owns extraction of candidate target paths from its
# own tool-input shape (Claude tool_input.file_path/.command; Codex
# apply_patch envelope) and OMT_DIR/session_id resolution -- this core only
# does the exact-path comparison and emits the deny JSON.
# =============================================================================

# Byte-identical to the Claude deny at hooks/pre-tool-enforcer.sh:79
# (_wg_deny_json) -- keep both platforms' deny output identical (AC5).
_wg_core_deny_json='{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Blocked: direct write/delete targets the durable session ledger (session-ledger-*.md). Use hooks/omt-ledger.sh append/now instead."}}'

# write_guard_core_run <OMT_DIR> <session_id>
# Reads newline-separated already-absolutized candidate target paths on
# stdin. Emits the deny JSON to stdout iff any candidate is FULL-PATH EXACT
# equal to "$OMT_DIR/session-ledger-<session_id>.md"; else emits nothing
# (allow).
write_guard_core_run() {
    local omt_dir="$1"
    local session_id="$2"
    local ledger_path="$omt_dir/session-ledger-$session_id.md"
    local candidate
    while IFS= read -r candidate; do
        if [[ "$candidate" == "$ledger_path" ]]; then
            printf '%s\n' "$_wg_core_deny_json"
            return 0
        fi
    done
    return 0
}

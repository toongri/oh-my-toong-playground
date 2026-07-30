#!/bin/bash
# omt-hook-dep: review-dispatch-gate-core.sh
# Codex PreToolUse shim for ultragoal review-dispatch budgeting.
set -euo pipefail

_rdg_shim_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=hooks/review-dispatch-gate-core.sh
source "$_rdg_shim_dir/review-dispatch-gate-core.sh"

input=$(cat)

# Match the existing Codex hook posture: jq absence is an advisory allow, never
# an unhandled shell failure.
command -v jq > /dev/null 2>&1 || exit 0

tool_name_raw=$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null) || tool_name_raw=""
tool_name=$(printf '%s' "$tool_name_raw" | tr '[:upper:]' '[:lower:]')
case "$tool_name" in
    *spawn_agent) ;;
    *) exit 0 ;;
esac

# Codex's candidate identity is tool_input.agent_type; only this exact value
# may reserve code-review dispatch budget.
agent_type=$(printf '%s' "$input" | jq -r '.tool_input.agent_type // empty' 2>/dev/null) || agent_type=""
[ "$agent_type" = "code-reviewer" ] || exit 0

# OMT_SESSION_ID is a Claude-only carrier.  When this is a real Codex
# session, an inherited value can belong to the parent Claude session and
# would otherwise win over this hook payload in the shared core.  Match the
# Codex ledger contract: use CODEX_THREAD_ID as the authoritative session
# identity and scrub the leaked OMT_SESSION_ID locally. The shared core's
# env-first input is OMT_SESSION_ID, so map the Codex identity to that input;
# this prevents absent or mismatched payload session_id values from selecting
# another session. Keep the legacy OMT_SESSION_ID fallback for environments
# where Codex has not supplied CODEX_THREAD_ID.
out=$(
    if [ -n "${CODEX_THREAD_ID:-}" ]; then
        OMT_SESSION_ID="$CODEX_THREAD_ID"
        export OMT_SESSION_ID
    fi
    review_dispatch_gate_core_run "$input"
)
if [ -n "$out" ]; then
    printf '%s\n' "$out"
fi
exit 0

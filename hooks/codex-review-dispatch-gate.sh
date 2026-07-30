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

out=$(review_dispatch_gate_core_run "$input")
if [ -n "$out" ]; then
    printf '%s\n' "$out"
fi
exit 0

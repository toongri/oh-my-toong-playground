#!/bin/bash
# Codex PreToolUse adapter for the persisted QA E2E-driver gate.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=hooks/lib/qa-driver-patterns.sh
source "$SCRIPT_DIR/lib/qa-driver-patterns.sh"

input=$(cat)
if ! command -v jq >/dev/null 2>&1; then
    exit 0
fi

tool_name_raw=$(printf '%s' "$input" | jq -er '.tool_name // .toolName // empty' 2>/dev/null) || exit 0
tool_name=$(printf '%s' "$tool_name_raw" | tr '[:upper:]' '[:lower:]')
case "$tool_name" in
    bash | exec_command | shell_command) ;;
    *) exit 0 ;;
esac

command=$(printf '%s' "$input" | jq -er '.tool_input.cmd // .tool_input.command // empty' 2>/dev/null) || exit 0
payload_sid=$(printf '%s' "$input" | jq -er '.session_id // empty' 2>/dev/null) || exit 0
session_id=$(qa_driver_session_id "$payload_sid") || exit 0

omt_dir="${OMT_DIR:-}"
if [ -z "$omt_dir" ]; then
    cwd=$(printf '%s' "$input" | jq -er '.cwd // empty' 2>/dev/null) || exit 0
    [ -n "$cwd" ] || exit 0
    omt_dir=$(source "$SCRIPT_DIR/lib/omt-dir.sh" && unset OMT_DIR && resolve_omt_dir "$cwd") || exit 0
fi
[ -n "$omt_dir" ] || exit 0
state_file="$omt_dir/qa-state-${session_id}.json"
[ -f "$state_file" ] || exit 0

# Keep this twin limited to the same two persisted booleans as the Claude shim.
active=$(jq -r 'if .active == true then "true" else "false" end' "$state_file" 2>/dev/null) || exit 0
armed=$(jq -r 'if .derived.driver_gate_armed == true then "true" else "false" end' "$state_file" 2>/dev/null) || exit 0
[ "$active" = "true" ] && [ "$armed" = "true" ] || exit 0
qa_driver_command_is_e2e "$command" || exit 0

reason=$(qa_driver_deny_reason)
jq -nc --arg reason "$reason" '
    {
        hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: $reason
        }
    }'
exit 0

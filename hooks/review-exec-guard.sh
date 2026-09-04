#!/bin/bash
# Claude PreToolUse adapter for the shared static-review execution invariant.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=hooks/lib/review-exec-patterns.sh
source "$SCRIPT_DIR/lib/review-exec-patterns.sh"

input=$(/bin/cat)
if ! command -v jq >/dev/null 2>&1; then
    echo "review-exec-guard: jq unavailable; allowing command" >&2
    exit 0
fi

tool_name=$(printf '%s' "$input" | jq -er '.tool_name // .toolName // empty' 2>/dev/null) || exit 0
[ "$tool_name" = "Bash" ] || exit 0
command=$(printf '%s' "$input" | jq -er '.tool_input.command // empty' 2>/dev/null) || exit 0
payload_sid=$(printf '%s' "$input" | jq -er '.session_id // empty' 2>/dev/null) || exit 0

review_exec_command_denied "$command" || exit 0

REASON_ACTIVE='Review is static-only: tests, builds, installs, and linters must not run here. Use static inspection (diffs, searches, and source reading) instead.'
REASON_INDETERMINATE='Review job activity could not be determined; blocking conservatively. Review is static-only — use static inspection (diffs, searches, and source reading) instead.'

if review_exec_is_member; then
    jq -nc --arg reason "$REASON_ACTIVE" '{continue:false,reason:$reason}'
    exit 0
fi

session_id=$(review_exec_session_id "$payload_sid") || exit 0
omt_dir="${OMT_DIR:-}"
if [ -z "$omt_dir" ]; then
    cwd=$(printf '%s' "$input" | jq -er '.cwd // empty' 2>/dev/null) || exit 0
    [ -n "$cwd" ] || exit 0
    omt_dir=$(source "$SCRIPT_DIR/lib/omt-dir.sh" && unset OMT_DIR && resolve_omt_dir "$cwd") || exit 0
fi
[ -n "$omt_dir" ] || exit 0

gate=$(review_exec_should_gate_conductor "$omt_dir" "$session_id")
case "$gate" in
    active)
        jq -nc --arg reason "$REASON_ACTIVE" '{continue:false,reason:$reason}'
        ;;
    indeterminate)
        jq -nc --arg reason "$REASON_INDETERMINATE" '{continue:false,reason:$reason}'
        ;;
    *)
        exit 0
        ;;
esac

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

review_exec_is_member || exit 0
review_exec_command_denied "$command" || exit 0

printf '%s\n' '{"continue":false,"reason":"Review is static-only: tests, builds, installs, and linters must not run here. Use static inspection (diffs, searches, and source reading) instead."}'

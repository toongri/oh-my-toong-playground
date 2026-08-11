#!/bin/bash
# Codex PreToolUse gate for skills marked disable-model-invocation: true.
# Command matching is intentionally best-effort: only literal path-shaped
# tokens containing .agents/skills/<safe-name>/SKILL.md are inspected. Shell
# expansion, aliases, concatenated strings, and paths split by whitespace may
# therefore fail open rather than risk blocking an uncertain command.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" || exit 0
command -v jq >/dev/null 2>&1 || exit 0
# omt-hook-dep: lib/skill-invocation-core.sh
[ -r "$SCRIPT_DIR/lib/skill-invocation-core.sh" ] || exit 0
source "$SCRIPT_DIR/lib/skill-invocation-core.sh" || exit 0
input=$(cat 2>/dev/null) || exit 0
[ -n "$input" ] || exit 0

tool_name=$(printf '%s' "$input" | jq -er 'if (.tool_name? | type) == "string" then .tool_name elif (.toolName? | type) == "string" then .toolName else empty end' 2>/dev/null) || exit 0
tool_name=$(printf '%s' "$tool_name" | tr '[:upper:]' '[:lower:]')
case "$tool_name" in
  bash|exec_command|shell_command) ;;
  *) exit 0 ;;
esac

command_text=$(printf '%s' "$input" | jq -er 'if (.tool_input.command? | type) == "string" then .tool_input.command elif (.tool_input.cmd? | type) == "string" then .tool_input.cmd else empty end' 2>/dev/null) || exit 0
sid=$(printf '%s' "$input" | jq -er 'if (.session_id? | type) == "string" then .session_id else empty end' 2>/dev/null) || exit 0
printf '%s' "$sid" | grep -Eq '^[A-Za-z0-9_-]{1,200}$' || exit 0
cwd=$(printf '%s' "$input" | jq -er 'if (.cwd? | type) == "string" then .cwd else empty end' 2>/dev/null) || exit 0
[ -n "$cwd" ] || exit 0
case "$cwd" in /*) ;; *) exit 0 ;; esac
case "$cwd" in *$'\n'*|*$'\r'*|*$'\t'*) exit 0 ;; esac

# Extract literal path tokens. This deliberately does not attempt shell parsing.
targets=$(printf '%s' "$command_text" | grep -oE "[^[:space:]\"'<>;|&()]*\.agents/skills/[A-Za-z][A-Za-z0-9_-]*/SKILL\.md" | sort -u || true)
[ -n "$targets" ] || exit 0

while IFS= read -r token; do
  [ -n "$token" ] || continue
  token="${token#@}"
  case "$token" in
    /*) target="$token" ;;
    *) target="$cwd/$token" ;;
  esac
  target="${target%,}"; target="${target%.}"; target="${target%]}"; target="${target%)}"
  [ -f "$target" ] && [ -r "$target" ] || continue
  skill=$(printf '%s' "$token" | sed -n 's|.*\.agents/skills/\([A-Za-z][A-Za-z0-9_-]*\)/SKILL\.md$|\1|p')
  [ -n "$skill" ] || continue

  if skill_core_is_model_disabled "$target" 2>/dev/null; then
    reason="Blocked: model-disabled skill bodies are supplied only by an explicit \$$skill UserPromptSubmit additionalContext; direct file reading is denied."
    jq -n --arg reason "$reason" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$reason}}' 2>/dev/null || true
    exit 0
  fi
done <<EOF
$targets
EOF
exit 0

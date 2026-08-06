#!/bin/bash
# Codex explain-diff seed hook. Codex has no structured Skill invocation event,
# so seed when the platform's $explain-diff mention scanner submits a prompt or
# when the deployed skill is opened through a shell tool.
#
# The seed is what arms the artifact guard: that guard fails CLOSED, so without
# a state file the skill's very first document write would be denied. The
# skeleton written here is byte-for-byte what `explain-diff-state.ts start`
# produces before a range is known — already allowed to write the evidence step,
# already refusing to let the session stop.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/omt-dir.sh"

command -v jq >/dev/null 2>&1 || exit 0
input=$(cat)
sid=$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null) || exit 0
printf '%s' "$sid" | grep -Eq '^[A-Za-z0-9_-]{1,200}$' || exit 0
cwd=$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null) || exit 0
[ -n "$cwd" ] || exit 0

event=$(printf '%s' "$input" | jq -r '.hook_event_name // .hookEventName // empty' 2>/dev/null) || event=""
trigger=false
if [ "$event" = "UserPromptSubmit" ]; then
    prompt=$(printf '%s' "$input" | jq -r '.prompt // empty' 2>/dev/null) || prompt=""
    # The trailing class excludes '-' as well as word characters: the RED
    # baseline tree is a sibling named explain-diff-eval, and a prompt that only
    # mentions the eval must not arm the gate the eval exists to measure.
    if printf '%s' "$prompt" | grep -Eq '(^|[^[:alnum:]_])\$explain-diff([^[:alnum:]_-]|$)'; then
        trigger=true
    fi
elif [ "$event" = "PreToolUse" ]; then
    tool_name=$(printf '%s' "$input" | jq -r '.tool_name // .toolName // empty' 2>/dev/null) || tool_name=""
    case "$(printf '%s' "$tool_name" | tr '[:upper:]' '[:lower:]')" in
        bash|exec_command|shell_command)
            command=$(printf '%s' "$input" | jq -r '.tool_input.cmd // .tool_input.command // empty' 2>/dev/null) || command=""
            case "$command" in
                *.agents/skills/explain-diff/SKILL.md*) trigger=true ;;
            esac
            ;;
    esac
fi
[ "$trigger" = true ] || exit 0

omt_dir="${OMT_DIR:-}"
if [ -z "$omt_dir" ]; then
    omt_dir=$(unset OMT_DIR; resolve_omt_dir "$cwd") || exit 0
fi
[ -n "$omt_dir" ] || exit 0
state_file="$omt_dir/explain-diff-state-${sid}.json"
[ -f "$state_file" ] && exit 0
ts=$(date -Iseconds 2>/dev/null || date +"%Y-%m-%dT%H:%M:%S")
mkdir -p "$omt_dir" 2>/dev/null || exit 0
if ! ( set -C; cat > "$state_file" <<EOF
{
  "active": true,
  "step": "evidence",
  "passed": [],
  "structural_ok": [],
  "concepts": [],
  "bank": [],
  "awaiting_answer": false,
  "no_progress": {
    "key": "",
    "count": 0,
    "doc_digest": ""
  },
  "last_failure": null,
  "range": "",
  "slug": "",
  "started_at": "$ts",
  "last_touched_at": "$ts",
  "derived": {
    "artifact_write_allowed": true,
    "quiz_passed": false,
    "stop_allowed": false,
    "no_progress_tripped": false,
    "block_reason": ""
  }
}
EOF
); then
    # Another seed writer won the create race; never clobber its state.
    exit 0
fi
exit 0

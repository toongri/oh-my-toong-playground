#!/bin/bash
# Codex QA seed hook. Codex has no structured Skill invocation event, so seed
# when the platform's $qa mention scanner submits a prompt or when the
# deployed QA skill is opened through a shell tool.
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
    if printf '%s' "$prompt" | grep -Eq '(^|[^[:alnum:]_])\$qa([^[:alnum:]_]|$)'; then
        trigger=true
    fi
elif [ "$event" = "PreToolUse" ]; then
    tool_name=$(printf '%s' "$input" | jq -r '.tool_name // .toolName // empty' 2>/dev/null) || tool_name=""
    case "$(printf '%s' "$tool_name" | tr '[:upper:]' '[:lower:]')" in
        bash|exec_command|shell_command)
            command=$(printf '%s' "$input" | jq -r '.tool_input.cmd // .tool_input.command // empty' 2>/dev/null) || command=""
            case "$command" in
                *.agents/skills/qa/SKILL.md*) trigger=true ;;
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
state_file="$omt_dir/qa-state-${sid}.json"
[ -f "$state_file" ] && exit 0
ts=$(date -Iseconds 2>/dev/null || date +"%Y-%m-%dT%H:%M:%S")
mkdir -p "$omt_dir" 2>/dev/null || exit 0
if ! ( set -C; cat > "$state_file" <<EOF
{
  "active": true,
  "phase": "PRE-FLIGHT",
  "cycle": 0,
  "max_cycles": 5,
  "same_failure_key": "",
  "same_failure_count": 0,
  "fix_head_before": "",
  "user_dirty_set": [],
  "target": "",
  "actors": [],
  "stories": [],
  "cells": [],
  "run_checks": null,
  "waives": [],
  "inert": null,
  "verdict": null,
  "phase_max": 0,
  "derived": {
    "chain_complete": false,
    "record_complete": false,
    "approve_ok": false,
    "comment_ok": false,
    "driver_gate_armed": true
  },
  "started_at": "$ts",
  "last_touched_at": "$ts"
}
EOF
); then
    # Another seed writer won the create race; never clobber its state.
    exit 0
fi
exit 0

#!/bin/bash
# Sisyphus Keyword Detector Hook
# Detects ultrawork/ultrathink/search/analyze keywords and injects enhanced mode messages
#
# Claude UserPromptSubmit shim over the shared judgment core
# (hooks/keyword-detector-core.sh) -- the core owns keyword classification
# (kd_core_is_*) and the additionalContext message bodies (kd_core_message_*),
# shared verbatim with hooks/codex-keyword-detector.sh (Codex). This file
# owns ONLY Claude's stdin JSON shape, project-root/OMT_DIR bookkeeping, and
# Claude's UserPromptSubmit envelope ({"continue": true, "hookSpecificOutput":
# ...}) -- mirrors hooks/write-guard-core.sh's shim/core split (shim parses,
# core judges).
#
# omt-hook-dep: keyword-detector-core.sh

# Read stdin (JSON input from Claude Code)
INPUT=$(cat)

# Extract session ID and directory from input
SESSION_ID=""
DIRECTORY=""
if command -v jq &> /dev/null; then
  SESSION_ID=$(echo "$INPUT" | jq -r '.sessionId // .session_id // ""' 2>/dev/null)
  DIRECTORY=$(echo "$INPUT" | jq -r '.cwd // ""' 2>/dev/null)
fi
if [ -z "$DIRECTORY" ] || [ "$DIRECTORY" = "null" ]; then
  DIRECTORY=$(pwd)
fi
# Use "default" as fallback when no session ID provided
if [ -z "$SESSION_ID" ] || [ "$SESSION_ID" = "null" ]; then
  SESSION_ID="default"
fi

# Find project root by looking for markers and escaping .omt if inside
get_project_root() {
  local dir="$1"

  # Strip .omt suffix if present (prevents nesting)
  dir="${dir%/.omt}"
  dir="${dir%/.claude}"

  # Look for project root markers
  while [ "$dir" != "/" ] && [ "$dir" != "." ] && [ -n "$dir" ]; do
    if [ -d "$dir/.git" ] || [ -f "$dir/CLAUDE.md" ] || [ -f "$dir/package.json" ]; then
      echo "$dir"
      return 0
    fi
    dir=$(dirname "$dir")
  done

  # Fallback: return the stripped directory
  local _fallback="${1%/.omt}"
  _fallback="${_fallback%/.claude}"
  echo "$_fallback"
}

# Get project root
PROJECT_ROOT=$(get_project_root "$DIRECTORY")

# Compute OMT_DIR if not already set by session-start.sh
SCRIPT_DIR_KD="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR_KD/lib/omt-dir.sh"
compute_omt_dir "$PROJECT_ROOT"

# Shared classification + message core (hooks/keyword-detector-core.sh).
source "$SCRIPT_DIR_KD/keyword-detector-core.sh"

# Extract the prompt text - try multiple JSON paths
PROMPT=""
if command -v jq &> /dev/null; then
  PROMPT=$(echo "$INPUT" | jq -r '
    if .prompt then .prompt
    elif .message.content then .message.content
    elif .parts then ([.parts[] | select(.type == "text") | .text] | join(" "))
    else ""
    end
  ' 2>/dev/null)
fi

# Fallback: simple grep extraction if jq fails
if [ -z "$PROMPT" ] || [ "$PROMPT" = "null" ]; then
  PROMPT=$(echo "$INPUT" | perl -ne 'print "$2\n" while /"(prompt|content|text)"\s*:\s*"([^"]*)"/' | head -1)
fi

# Exit if no prompt found
if [ -z "$PROMPT" ]; then
  echo '{"continue": true}'
  exit 0
fi

# Remove code blocks AND hook output tags before checking keywords
PROMPT_NO_CODE=$(echo "$PROMPT" | kd_core_strip_mode_tags | tr '\n' '\r' | sed 's/```[^`]*```//g' | sed 's/`[^`]*`//g' | tr '\r' '\n')

# Remove hook output tags and system reminders from cleaned prompt
PROMPT_CLEAN=$(echo "$PROMPT" | kd_core_strip_mode_tags | sed 's/  */ /g' | sed 's/^ *//;s/ *$//')

# Extract file paths from non-text parts (e.g., @file mentions)
FILE_PATHS=""
if command -v jq &> /dev/null; then
  FILE_PATHS=$(echo "$INPUT" | jq -r '
    [(.parts // [])[] | select(.type != "text") | .file_path // .path // empty] | join(", ")
  ' 2>/dev/null)
fi

# Append file references to cleaned prompt
if [ -n "$FILE_PATHS" ] && [ "$FILE_PATHS" != "null" ]; then
  PROMPT_CLEAN="${PROMPT_CLEAN} [referenced files: ${FILE_PATHS}]"
fi

# Convert to lowercase
PROMPT_LOWER=$(echo "$PROMPT_NO_CODE" | tr '[:upper:]' '[:lower:]')

# Emits a Claude UserPromptSubmit envelope wrapping the given core message
# function's additionalContext value. The core prints that value ALREADY
# JSON-escaped (see keyword-detector-core.sh), so this is a plain printf
# substitution -- no jq, no re-escaping -- and reproduces the pre-extraction
# literal byte-for-byte.
emit_claude_mode() {
  local msg_fn="$1"
  printf '{"continue": true, "hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": "%s"}}\n' "$("$msg_fn")"
}

# Check for ultrawork keywords (highest priority)
if echo "$PROMPT_LOWER" | kd_core_is_ultrawork; then
  emit_claude_mode kd_core_message_ultrawork
  exit 0
fi

# Check for ultrathink/think keywords
if echo "$PROMPT_LOWER" | kd_core_is_think; then
  emit_claude_mode kd_core_message_think
  exit 0
fi

# Check for search keywords
if echo "$PROMPT_LOWER" | kd_core_is_search; then
  emit_claude_mode kd_core_message_search
  exit 0
fi

# Check for analyze keywords
if echo "$PROMPT_LOWER" | kd_core_is_analyze; then
  emit_claude_mode kd_core_message_analyze
  exit 0
fi

# No keywords detected
echo '{"continue": true}'
exit 0

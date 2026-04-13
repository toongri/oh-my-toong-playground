#!/bin/bash
# Resume Forge Session Start Hook
# Detects active resume-forge state files and injects context into the session
set -euo pipefail

# Read stdin
INPUT=$(cat)

# Get session ID and directory
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
  echo "${1%/.omt}"
}

# Get project root
PROJECT_ROOT=$(get_project_root "$DIRECTORY")

# Compute OMT_DIR via shared library
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=hooks/lib/omt-dir.sh
source "$SCRIPT_DIR/lib/omt-dir.sh"
compute_omt_dir "$PROJECT_ROOT"
PROJECT_NAME=$(basename "$OMT_DIR")

# Export OMT_PROJECT via Claude env file
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export OMT_PROJECT=\"$PROJECT_NAME\"" >> "$CLAUDE_ENV_FILE"
fi

# Export OMT_DIR via Claude env file
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export OMT_DIR=\"$OMT_DIR\"" >> "$CLAUDE_ENV_FILE"
fi

# Scan for resume-forge state files
STATE_DIR="$OMT_DIR/state"
MOST_RECENT_FILE=""

if command -v jq &> /dev/null && [ -d "$STATE_DIR" ]; then
  MOST_RECENT_TS=""

  for state_file in "$STATE_DIR"/resume-forge-*.json; do
    if [ -f "$state_file" ]; then
      CREATED_AT=$(jq -r '.created_at // ""' "$state_file" 2>/dev/null)
      if [ -n "$CREATED_AT" ] && [ "$CREATED_AT" != "null" ]; then
        # Compare timestamps lexicographically (ISO 8601 format sorts correctly)
        if [ -z "$MOST_RECENT_TS" ] || [ "$CREATED_AT" \> "$MOST_RECENT_TS" ]; then
          MOST_RECENT_TS="$CREATED_AT"
          MOST_RECENT_FILE="$state_file"
        fi
      fi
    fi
  done
fi

MESSAGES=""

if [ -n "$MOST_RECENT_FILE" ] && [ -f "$MOST_RECENT_FILE" ]; then
  STATE_CONTENT=$(cat "$MOST_RECENT_FILE")
  STATE_FILENAME=$(basename "$MOST_RECENT_FILE")

  # Count total scenarios and passed (loop2.status == "passed")
  TOTAL=$(echo "$STATE_CONTENT" | jq '.scenarios | length' 2>/dev/null || echo "0")
  PASSED=$(echo "$STATE_CONTENT" | jq '[.scenarios[] | select(.loop2.status == "passed")] | length' 2>/dev/null || echo "0")

  MESSAGES="<session-restore>\n\n[RESUME FORGE SESSION DETECTED]\nState file: ${STATE_FILENAME}\nScenarios: ${PASSED}/${TOTAL} completed\nResume with resume-forge skill to continue.\n\n</session-restore>"
fi

# Output result
if [ -n "$MESSAGES" ]; then
  # Escape for JSON
  MESSAGES_ESCAPED=$(echo "$MESSAGES" | sed 's/"/\\"/g')
  echo "{\"continue\": true, \"hookSpecificOutput\": {\"hookEventName\": \"SessionStart\", \"additionalContext\": \"$MESSAGES_ESCAPED\"}}"
else
  echo '{"continue": true}'
fi
exit 0

#!/bin/bash
# Sisyphus Session Start Hook
# Restores persistent mode states and injects context when session starts

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
SCRIPT_DIR_SS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=hooks/lib/omt-dir.sh
source "$SCRIPT_DIR_SS/lib/omt-dir.sh"
compute_omt_dir "$PROJECT_ROOT"
PROJECT_NAME=$(basename "$OMT_DIR")

# Export OMT_PROJECT via Claude env file
if [ -n "$CLAUDE_ENV_FILE" ]; then
  echo "export OMT_PROJECT=\"$PROJECT_NAME\"" >> "$CLAUDE_ENV_FILE"
fi

# Export OMT_DIR via Claude env file
if [ -n "$CLAUDE_ENV_FILE" ]; then
  echo "export OMT_DIR=\"$OMT_DIR\"" >> "$CLAUDE_ENV_FILE"
fi

MESSAGES=""

# Cleanup stale ralph-state files (older than 3 hours)
if command -v jq &> /dev/null; then
  STALE_THRESHOLD=10800  # 3 hours in seconds
  CURRENT_TIME=$(date +%s)

  for state_file in "$OMT_DIR"/ralph-state-*.json; do
    if [ -f "$state_file" ]; then
      STARTED_AT=$(jq -r '.started_at // ""' "$state_file" 2>/dev/null)
      if [ -n "$STARTED_AT" ] && [ "$STARTED_AT" != "null" ]; then
        # Parse ISO 8601 timestamp (strip timezone for BSD date)
        TIME_PART=$(echo "$STARTED_AT" | sed -E 's/(Z|[+-][0-9]{2}:[0-9]{2})$//')
        FILE_TIMESTAMP=$(date -j -f "%Y-%m-%dT%H:%M:%S" "$TIME_PART" "+%s" 2>/dev/null)

        if [ -n "$FILE_TIMESTAMP" ]; then
          AGE=$((CURRENT_TIME - FILE_TIMESTAMP))
          if [ "$AGE" -gt "$STALE_THRESHOLD" ]; then
            rm -f "$state_file"
          fi
        fi
      fi
    fi
  done
fi

# Check for active ralph loop state (session-specific)
if [ -f "$OMT_DIR/ralph-state-${SESSION_ID}.json" ]; then
  RALPH_STATE=$(cat "$OMT_DIR/ralph-state-${SESSION_ID}.json" 2>/dev/null)

  if command -v jq &> /dev/null; then
    IS_ACTIVE=$(echo "$RALPH_STATE" | jq -r '.active // false' 2>/dev/null)
    if [ "$IS_ACTIVE" = "true" ]; then
      ITERATION=$(echo "$RALPH_STATE" | jq -r '.iteration // 0' 2>/dev/null)
      MAX_ITER=$(echo "$RALPH_STATE" | jq -r '.max_iterations // 10' 2>/dev/null)
      PROMPT=$(echo "$RALPH_STATE" | jq -r '.prompt // "Task in progress"' 2>/dev/null)
      ORACLE_FEEDBACK=$(echo "$RALPH_STATE" | jq -r '.oracle_feedback // [] | join("\n")' 2>/dev/null)

      FEEDBACK_SECTION=""
      if [ -n "$ORACLE_FEEDBACK" ] && [ "$ORACLE_FEEDBACK" != "null" ] && [ "$ORACLE_FEEDBACK" != "" ]; then
        FEEDBACK_SECTION="\nPrevious Oracle Feedback:\n$ORACLE_FEEDBACK\n"
      fi

      MESSAGES="$MESSAGES<session-restore>\n\n[RALPH LOOP RESTORED]\n\nYou have an active ralph-loop session.\nOriginal task: $PROMPT\nIteration: $ITERATION/$MAX_ITER\n$FEEDBACK_SECTION\nContinue working until the task is verified complete.\n\n</session-restore>\n\n---\n\n"
    fi
  fi
fi


# Check for incomplete todos in global directory
INCOMPLETE_COUNT=0
TODOS_DIR="$HOME/.claude/todos"
if [ -d "$TODOS_DIR" ]; then
  for todo_file in "$TODOS_DIR"/*.json; do
    if [ -f "$todo_file" ]; then
      if command -v jq &> /dev/null; then
        COUNT=$(jq '[.[] | select(.status != "completed" and .status != "cancelled")] | length' "$todo_file" 2>/dev/null || echo "0")
        INCOMPLETE_COUNT=$((INCOMPLETE_COUNT + COUNT))
      fi
    fi
  done
fi

# Check for incomplete todos in project directory
for todo_path in "$OMT_DIR/todos.json" "$DIRECTORY/.claude/todos.json"; do
  if [ -f "$todo_path" ]; then
    if command -v jq &> /dev/null; then
      COUNT=$(jq 'if type == "array" then [.[] | select(.status != "completed" and .status != "cancelled")] | length else 0 end' "$todo_path" 2>/dev/null || echo "0")
      INCOMPLETE_COUNT=$((INCOMPLETE_COUNT + COUNT))
    fi
  fi
done

if [ "$INCOMPLETE_COUNT" -gt 0 ]; then
  MESSAGES="$MESSAGES<session-restore>\n\n[PENDING TASKS DETECTED]\n\nYou have $INCOMPLETE_COUNT incomplete tasks from a previous session.\nPlease continue working on these tasks.\n\n</session-restore>\n\n---\n\n"
fi

# Output message if we have any
if [ -n "$MESSAGES" ]; then
  # Escape for JSON
  MESSAGES_ESCAPED=$(echo "$MESSAGES" | sed 's/"/\\"/g')
  echo "{\"continue\": true, \"hookSpecificOutput\": {\"hookEventName\": \"SessionStart\", \"additionalContext\": \"$MESSAGES_ESCAPED\"}}"
else
  echo '{"continue": true}'
fi
exit 0

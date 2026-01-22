#!/bin/bash
# Sisyphus Session Start Hook
# Restores persistent mode states and injects context when session starts

# Read stdin
INPUT=$(cat)

# Get directory
DIRECTORY=""
if command -v jq &> /dev/null; then
  DIRECTORY=$(echo "$INPUT" | jq -r '.directory // ""' 2>/dev/null)
fi

if [ -z "$DIRECTORY" ] || [ "$DIRECTORY" = "null" ]; then
  DIRECTORY=$(pwd)
fi

MESSAGES=""

# Check for active ultrawork state
if [ -f "$DIRECTORY/.claude/sisyphus/ultrawork-state.json" ] || [ -f "$HOME/.claude/ultrawork-state.json" ]; then
  if [ -f "$DIRECTORY/.claude/sisyphus/ultrawork-state.json" ]; then
    ULTRAWORK_STATE=$(cat "$DIRECTORY/.claude/sisyphus/ultrawork-state.json" 2>/dev/null)
  else
    ULTRAWORK_STATE=$(cat "$HOME/.claude/ultrawork-state.json" 2>/dev/null)
  fi

  if command -v jq &> /dev/null; then
    IS_ACTIVE=$(echo "$ULTRAWORK_STATE" | jq -r '.active // false' 2>/dev/null)
    if [ "$IS_ACTIVE" = "true" ]; then
      STARTED_AT=$(echo "$ULTRAWORK_STATE" | jq -r '.started_at // ""' 2>/dev/null)
      PROMPT=$(echo "$ULTRAWORK_STATE" | jq -r '.original_prompt // ""' 2>/dev/null)
      MESSAGES="$MESSAGES<session-restore>\n\n[ULTRAWORK MODE RESTORED]\n\nYou have an active ultrawork session from $STARTED_AT.\nOriginal task: $PROMPT\n\nContinue working in ultrawork mode until all tasks are complete.\n\n</session-restore>\n\n---\n\n"
    fi
  fi
fi

# Check for active ralph loop state
if [ -f "$DIRECTORY/.claude/sisyphus/ralph-state.json" ]; then
  RALPH_STATE=$(cat "$DIRECTORY/.claude/sisyphus/ralph-state.json" 2>/dev/null)

  if command -v jq &> /dev/null; then
    IS_ACTIVE=$(echo "$RALPH_STATE" | jq -r '.active // false' 2>/dev/null)
    if [ "$IS_ACTIVE" = "true" ]; then
      ITERATION=$(echo "$RALPH_STATE" | jq -r '.iteration // 1' 2>/dev/null)
      MAX_ITER=$(echo "$RALPH_STATE" | jq -r '.max_iterations // 10' 2>/dev/null)
      PROMPT=$(echo "$RALPH_STATE" | jq -r '.prompt // "Task in progress"' 2>/dev/null)
      MESSAGES="$MESSAGES<session-restore>\n\n[RALPH LOOP RESTORED]\n\nYou have an active ralph-loop session.\nOriginal task: $PROMPT\nIteration: $ITERATION/$MAX_ITER\n\nContinue working until the task is verified complete.\n\n</session-restore>\n\n---\n\n"
    fi
  fi
fi

# Check for pending verification state (oracle verification)
if [ -f "$DIRECTORY/.claude/sisyphus/ralph-verification.json" ]; then
  VERIFICATION_STATE=$(cat "$DIRECTORY/.claude/sisyphus/ralph-verification.json" 2>/dev/null)

  if command -v jq &> /dev/null; then
    IS_PENDING=$(echo "$VERIFICATION_STATE" | jq -r '.pending // false' 2>/dev/null)
    if [ "$IS_PENDING" = "true" ]; then
      ATTEMPT=$(echo "$VERIFICATION_STATE" | jq -r '.verification_attempts // 0' 2>/dev/null)
      MAX_ATTEMPTS=$(echo "$VERIFICATION_STATE" | jq -r '.max_verification_attempts // 3' 2>/dev/null)
      ORIGINAL_TASK=$(echo "$VERIFICATION_STATE" | jq -r '.original_task // ""' 2>/dev/null)
      COMPLETION_CLAIM=$(echo "$VERIFICATION_STATE" | jq -r '.completion_claim // ""' 2>/dev/null)
      ORACLE_FEEDBACK=$(echo "$VERIFICATION_STATE" | jq -r '.oracle_feedback // ""' 2>/dev/null)

      # Check for stale verification state (> 24 hours old)
      CREATED_AT=$(echo "$VERIFICATION_STATE" | jq -r '.created_at // ""' 2>/dev/null)
      IS_STALE="false"
      if [ -n "$CREATED_AT" ] && [ "$CREATED_AT" != "null" ]; then
        CREATED_EPOCH=$(date -j -f "%Y-%m-%dT%H:%M:%S" "${CREATED_AT%+*}" "+%s" 2>/dev/null || date -d "$CREATED_AT" "+%s" 2>/dev/null)
        NOW_EPOCH=$(date "+%s")
        if [ -n "$CREATED_EPOCH" ]; then
          AGE_HOURS=$(( (NOW_EPOCH - CREATED_EPOCH) / 3600 ))
          if [ "$AGE_HOURS" -gt 24 ]; then
            IS_STALE="true"
          fi
        fi
      fi

      if [ "$IS_STALE" = "true" ]; then
        # Remove stale verification state
        rm -f "$DIRECTORY/.claude/sisyphus/ralph-verification.json"
        MESSAGES="$MESSAGES<session-restore>\n\n[STALE VERIFICATION STATE CLEANED]\n\nA verification state older than 24 hours was found and removed.\nIf you need to continue verification, please restart the process.\n\n</session-restore>\n\n---\n\n"
      else
        FEEDBACK_SECTION=""
        if [ -n "$ORACLE_FEEDBACK" ] && [ "$ORACLE_FEEDBACK" != "null" ]; then
          FEEDBACK_SECTION="Previous Oracle Feedback: $ORACLE_FEEDBACK"
        fi

        MESSAGES="$MESSAGES<session-restore>\n\n[ORACLE VERIFICATION PENDING - RESTORED]\n\nYou have a pending oracle verification from a previous session.\nAttempt: $((ATTEMPT + 1))/$MAX_ATTEMPTS\nOriginal Task: $ORIGINAL_TASK\nCompletion Claim: $COMPLETION_CLAIM\n$FEEDBACK_SECTION\n\nYou MUST spawn an Oracle agent to verify the completion claim before proceeding.\n\n</session-restore>\n\n---\n\n"
      fi
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
for todo_path in "$DIRECTORY/.claude/sisyphus/todos.json" "$DIRECTORY/.claude/todos.json"; do
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
  echo "{\"continue\": true, \"message\": \"$MESSAGES_ESCAPED\"}"
else
  echo '{"continue": true}'
fi
exit 0

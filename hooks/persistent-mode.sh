#!/bin/bash
# Sisyphus Persistent Mode Hook
# Unified handler for ultrawork, ralph-loop, and todo continuation
# Prevents stopping when work remains incomplete

# Source logging library (with fallback if not found)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/lib/logging.sh" ]; then
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/lib/logging.sh" 2>/dev/null || true
fi

# Read stdin
INPUT=$(cat)

# Get session ID, directory, and transcript path
SESSION_ID=""
DIRECTORY=""
TRANSCRIPT_PATH=""
if command -v jq &> /dev/null; then
  SESSION_ID=$(echo "$INPUT" | jq -r '.sessionId // .session_id // ""' 2>/dev/null)
  DIRECTORY=$(echo "$INPUT" | jq -r '.cwd // ""' 2>/dev/null)
  TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // ""' 2>/dev/null)
fi

# Default to current directory
if [ -z "$DIRECTORY" ]; then
  DIRECTORY=$(pwd)
fi

# Use "default" as fallback when no session ID provided
if [ -z "$SESSION_ID" ] || [ "$SESSION_ID" = "null" ]; then
  SESSION_ID="default"
fi

# Find project root by looking for markers and escaping .claude/sisyphus if inside
get_project_root() {
  local dir="$1"

  # Strip .claude/sisyphus suffix if present (prevents nesting)
  dir="${dir%/.claude/sisyphus}"
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
  echo "${1%/.claude/sisyphus}"
}

# Get project root
PROJECT_ROOT=$(get_project_root "$DIRECTORY")

# Initialize logging (if library is available)
if type omt_log_init &>/dev/null; then
  omt_log_init "persistent-mode" "$PROJECT_ROOT"
  omt_log_start
  omt_log_info "Session: $SESSION_ID, Directory: $DIRECTORY"
  if [ -n "$TRANSCRIPT_PATH" ]; then
    omt_log_info "Transcript path provided: $TRANSCRIPT_PATH"
  else
    omt_log_info "No transcript path provided in INPUT"
  fi
fi

# ===== Todo Continuation Attempt Limiting =====
# Prevents infinite loops when agent is stuck on todos

MAX_TODO_CONTINUATION_ATTEMPTS=5

# Generate unique ID for attempt tracking files
ATTEMPT_ID="${SESSION_ID:-$(echo "$DIRECTORY" | md5 2>/dev/null | cut -c1-8 || echo "$DIRECTORY" | md5sum 2>/dev/null | cut -c1-8 || echo "default")}"

# Use project-local state directory instead of /tmp
STATE_DIR="$PROJECT_ROOT/.claude/sisyphus/state"
mkdir -p "$STATE_DIR" 2>/dev/null
ATTEMPT_FILE="$STATE_DIR/todo-attempts-${ATTEMPT_ID}"
TODO_COUNT_FILE="$STATE_DIR/todo-count-${ATTEMPT_ID}"

get_attempt_count() {
  cat "$ATTEMPT_FILE" 2>/dev/null || echo "0"
}

increment_attempts() {
  local current=$(get_attempt_count)
  echo $((current + 1)) > "$ATTEMPT_FILE"
}

reset_attempts() {
  rm -f "$ATTEMPT_FILE"
}

# Check for active ultrawork state (session-specific)
ULTRAWORK_STATE=""
if [ -f "$PROJECT_ROOT/.claude/sisyphus/ultrawork-state-${SESSION_ID}.json" ]; then
  ULTRAWORK_STATE=$(cat "$PROJECT_ROOT/.claude/sisyphus/ultrawork-state-${SESSION_ID}.json" 2>/dev/null)
elif [ -f "$HOME/.claude/ultrawork-state-${SESSION_ID}.json" ]; then
  ULTRAWORK_STATE=$(cat "$HOME/.claude/ultrawork-state-${SESSION_ID}.json" 2>/dev/null)
fi

# Check for active ralph loop (session-specific)
RALPH_STATE=""
if [ -f "$PROJECT_ROOT/.claude/sisyphus/ralph-state-${SESSION_ID}.json" ]; then
  RALPH_STATE=$(cat "$PROJECT_ROOT/.claude/sisyphus/ralph-state-${SESSION_ID}.json" 2>/dev/null)
fi


# =============================================================================
# Transcript Detection Functions
# =============================================================================

# Get transcript file path with fallback to messages.json
# NOTE: This function is kept for backward compatibility but is now unused.
# The transcript path is now provided via INPUT JSON (transcript_path field).
get_transcript_path() {
  local transcript_file="$HOME/.claude/sessions/$SESSION_ID/transcript.md"
  if [ -f "$transcript_file" ]; then
    echo "$transcript_file"
    return 0
  fi
  # Fallback to messages.json
  local messages_file="$HOME/.claude/sessions/$SESSION_ID/messages.json"
  if [ -f "$messages_file" ]; then
    echo "$messages_file"
    return 0
  fi
  return 1
}

# Detect <promise>DONE</promise> in transcript
# Uses $TRANSCRIPT_PATH if available, otherwise falls back to session-based paths
detect_completion_promise() {
  if [ -n "$TRANSCRIPT_PATH" ] && [ -f "$TRANSCRIPT_PATH" ]; then
    grep -q '<promise>\s*DONE\s*</promise>' "$TRANSCRIPT_PATH" 2>/dev/null
    return $?
  fi
  return 1
}

# Detect <oracle-approved>VERIFIED_COMPLETE</oracle-approved> in transcript
# Uses $TRANSCRIPT_PATH if available
detect_oracle_approval() {
  if [ -n "$TRANSCRIPT_PATH" ] && [ -f "$TRANSCRIPT_PATH" ]; then
    grep -q '<oracle-approved>.*VERIFIED_COMPLETE.*</oracle-approved>' "$TRANSCRIPT_PATH" 2>/dev/null
    return $?
  fi
  return 1
}

# Detect oracle rejection and extract feedback
# Uses $TRANSCRIPT_PATH if available
detect_oracle_rejection() {
  local file_to_check=""

  if [ -n "$TRANSCRIPT_PATH" ] && [ -f "$TRANSCRIPT_PATH" ]; then
    file_to_check="$TRANSCRIPT_PATH"
  else
    return 1
  fi

  # Check for rejection indicators: oracle.*rejected, issues found, not complete
  if grep -qiE 'oracle.*rejected|issues found|not complete|verification.*failed' "$file_to_check" 2>/dev/null; then
    # Extract feedback text (heuristic: text after "issue:" or "problem:")
    local feedback=""
    feedback=$(grep -oiE '(issue|problem|reason):\s*[^\n]+' "$file_to_check" 2>/dev/null | head -5 | tr '\n' ' ')
    if [ -n "$feedback" ]; then
      echo "$feedback"
    fi
    return 0
  fi
  return 1
}

# Clean up ralph state file (session-specific)
cleanup_ralph_state() {
  rm -f "$PROJECT_ROOT/.claude/sisyphus/ralph-state-${SESSION_ID}.json" 2>/dev/null
}

# =============================================================================
# End of Transcript Detection Functions
# =============================================================================

# Check for incomplete todos
INCOMPLETE_COUNT=0
TODOS_DIR="$HOME/.claude/todos"
if [ -d "$TODOS_DIR" ]; then
  for todo_file in "$TODOS_DIR"/*.json; do
    if [ -f "$todo_file" ]; then
      if command -v jq &> /dev/null; then
        COUNT=$(jq '[.[] | select(.status != "completed" and .status != "cancelled")] | length' "$todo_file" 2>/dev/null || echo "0")
        INCOMPLETE_COUNT=$((INCOMPLETE_COUNT + COUNT))
      else
        # Fallback: count "pending" or "in_progress" occurrences
        COUNT=$(grep -c '"status"[[:space:]]*:[[:space:]]*"pending\|in_progress"' "$todo_file" 2>/dev/null) || COUNT=0
        INCOMPLETE_COUNT=$((INCOMPLETE_COUNT + COUNT))
      fi
    fi
  done
fi

# Check project todos as well
for todo_path in "$PROJECT_ROOT/.claude/sisyphus/todos.json" "$DIRECTORY/.claude/todos.json"; do
  if [ -f "$todo_path" ]; then
    if command -v jq &> /dev/null; then
      COUNT=$(jq 'if type == "array" then [.[] | select(.status != "completed" and .status != "cancelled")] | length else 0 end' "$todo_path" 2>/dev/null || echo "0")
      INCOMPLETE_COUNT=$((INCOMPLETE_COUNT + COUNT))
    else
      # Fallback: count "pending" or "in_progress" occurrences
      COUNT=$(grep -c '"status"[[:space:]]*:[[:space:]]*"pending\|in_progress"' "$todo_path" 2>/dev/null) || COUNT=0
      INCOMPLETE_COUNT=$((INCOMPLETE_COUNT + COUNT))
    fi
  fi
done

# ===== Progress Detection =====
# Reset attempts when todo count CHANGES (indicates progress)
CURRENT_COUNT=$INCOMPLETE_COUNT
PREVIOUS_COUNT=$(cat "$TODO_COUNT_FILE" 2>/dev/null || echo "-1")

if [ "$CURRENT_COUNT" != "$PREVIOUS_COUNT" ]; then
  reset_attempts
  echo "$CURRENT_COUNT" > "$TODO_COUNT_FILE"
fi

# Priority 1: Ralph Loop with Oracle Verification
if [ -n "$RALPH_STATE" ]; then
  IS_ACTIVE=$(echo "$RALPH_STATE" | jq -r '.active // false' 2>/dev/null)
  if [ "$IS_ACTIVE" = "true" ]; then
    ITERATION=$(echo "$RALPH_STATE" | jq -r '.iteration // 1' 2>/dev/null)
    MAX_ITER=$(echo "$RALPH_STATE" | jq -r '.max_iterations // 10' 2>/dev/null)
    PROMISE=$(echo "$RALPH_STATE" | jq -r '.completion_promise // "DONE"' 2>/dev/null)
    PROMPT=$(echo "$RALPH_STATE" | jq -r '.prompt // ""' 2>/dev/null)

    # Check for oracle approval in transcript - if approved, clean up and allow stop
    if detect_oracle_approval; then
      cleanup_ralph_state
      # Clean up session-specific ultrawork state
      rm -f "$PROJECT_ROOT/.claude/sisyphus/ultrawork-state-${SESSION_ID}.json"
      rm -f "$HOME/.claude/ultrawork-state-${SESSION_ID}.json"
      echo '{"continue": true}'
      exit 0
    fi

    # Check max iterations first
    if [ "$ITERATION" -ge "$MAX_ITER" ]; then
      # Max iterations reached - clean up ALL state files (session-specific)
      rm -f "$PROJECT_ROOT/.claude/sisyphus/ralph-state-${SESSION_ID}.json"

      # Clean session-specific ultrawork state
      rm -f "$PROJECT_ROOT/.claude/sisyphus/ultrawork-state-${SESSION_ID}.json"
      rm -f "$HOME/.claude/ultrawork-state-${SESSION_ID}.json"

      # Clean todo attempt counter
      rm -f "/tmp/oh-my-toong-todo-attempts-${ATTEMPT_ID}"
      rm -f "/tmp/oh-my-toong-todo-count-${ATTEMPT_ID}"

      cat << EOF
{"continue": true}
EOF
      exit 0
    fi

    # No oracle approval found - increment iteration and store feedback if rejected
    NEW_ITER=$((ITERATION + 1))

    # Check for oracle rejection and extract feedback
    REJECTION_FEEDBACK=""
    if REJECTION_FEEDBACK=$(detect_oracle_rejection); then
      # Append feedback to oracle_feedback array in ralph-state
      UPDATED_STATE=$(echo "$RALPH_STATE" | jq ".iteration = $NEW_ITER | .oracle_feedback = (.oracle_feedback // []) + [\"$REJECTION_FEEDBACK\"]" 2>&1)
      if [ $? -eq 0 ]; then
        echo "$UPDATED_STATE" > "$PROJECT_ROOT/.claude/sisyphus/ralph-state-${SESSION_ID}.json"
      fi
    else
      # Just increment iteration
      UPDATED_STATE=$(echo "$RALPH_STATE" | jq ".iteration = $NEW_ITER" 2>&1)
      if [ $? -eq 0 ]; then
        echo "$UPDATED_STATE" > "$PROJECT_ROOT/.claude/sisyphus/ralph-state-${SESSION_ID}.json"
      fi
    fi

    # Read existing oracle_feedback for display
    ORACLE_FEEDBACK=$(echo "$RALPH_STATE" | jq -r '.oracle_feedback // [] | join("\n")' 2>/dev/null)
    FEEDBACK_SECTION=""
    if [ -n "$ORACLE_FEEDBACK" ] && [ "$ORACLE_FEEDBACK" != "null" ] && [ "$ORACLE_FEEDBACK" != "" ]; then
      FEEDBACK_SECTION="\n**Previous Oracle Feedback:**\n$ORACLE_FEEDBACK\n"
    fi

    cat << EOF
{"decision": "block", "reason": "<ralph-loop-continuation>\n\n[RALPH LOOP - ITERATION $NEW_ITER/$MAX_ITER]\n\nYour previous attempt did not include oracle approval. The work is NOT verified complete yet.\n$FEEDBACK_SECTION\nCRITICAL INSTRUCTIONS:\n1. Review your progress and the original task\n2. Check your todo list - are ALL items marked complete?\n3. Spawn Oracle to verify: Task(subagent_type=\"oracle\", prompt=\"Verify: $PROMPT\")\n4. If Oracle approves, output: <oracle-approved>VERIFIED_COMPLETE</oracle-approved>\n5. Then output: <promise>$PROMISE</promise>\n6. Do NOT stop until verified by Oracle\n\nOriginal task: $PROMPT\n\n</ralph-loop-continuation>\n\n---\n"}
EOF
    exit 0
  fi
fi

# Priority 2: Ultrawork Mode with incomplete todos
if [ -n "$ULTRAWORK_STATE" ] && [ "$INCOMPLETE_COUNT" -gt 0 ]; then
  # Check if active (with jq fallback)
  IS_ACTIVE=""
  if command -v jq &> /dev/null; then
    IS_ACTIVE=$(echo "$ULTRAWORK_STATE" | jq -r '.active // false' 2>/dev/null)
  else
    # Fallback: grep for "active": true
    if echo "$ULTRAWORK_STATE" | grep -q '"active"[[:space:]]*:[[:space:]]*true'; then
      IS_ACTIVE="true"
    fi
  fi

  if [ "$IS_ACTIVE" = "true" ]; then
    # Check if max attempts reached (escape hatch for stuck agents)
    ATTEMPTS=$(get_attempt_count)
    if [ "$ATTEMPTS" -ge "$MAX_TODO_CONTINUATION_ATTEMPTS" ]; then
      # Clean temp files
      rm -f "$ATTEMPT_FILE" "$TODO_COUNT_FILE"

      # Allow stop with warning
      cat << EOF
{"continue": true}
EOF
      exit 0
    fi

    # Increment attempts before forcing continuation
    increment_attempts

    # Get reinforcement count (with fallback)
    REINFORCE_COUNT=0
    if command -v jq &> /dev/null; then
      REINFORCE_COUNT=$(echo "$ULTRAWORK_STATE" | jq -r '.reinforcement_count // 0' 2>/dev/null)
    else
      REINFORCE_COUNT=$(echo "$ULTRAWORK_STATE" | perl -ne 'print $1 if /"reinforcement_count"\s*:\s*(\d+)/' 2>/dev/null) || REINFORCE_COUNT=0
    fi
    NEW_COUNT=$((REINFORCE_COUNT + 1))

    # Get original prompt (with fallback)
    ORIGINAL_PROMPT=""
    if command -v jq &> /dev/null; then
      ORIGINAL_PROMPT=$(echo "$ULTRAWORK_STATE" | jq -r '.original_prompt // ""' 2>/dev/null)
    else
      ORIGINAL_PROMPT=$(echo "$ULTRAWORK_STATE" | perl -ne 'print $1 if /"original_prompt"\s*:\s*"([^"]*)"/' 2>/dev/null) || ORIGINAL_PROMPT=""
    fi

    # Update state file (best effort)
    if command -v jq &> /dev/null; then
      echo "$ULTRAWORK_STATE" | jq ".reinforcement_count = $NEW_COUNT | .last_checked_at = \"$(date -Iseconds)\"" > "$PROJECT_ROOT/.claude/sisyphus/ultrawork-state-${SESSION_ID}.json" 2>/dev/null
    fi

    cat << EOF
{"decision": "block", "reason": "<ultrawork-persistence>\n\n[ULTRAWORK MODE STILL ACTIVE - Reinforcement #$NEW_COUNT]\n\nYour ultrawork session is NOT complete. $INCOMPLETE_COUNT incomplete todos remain.\n\nREMEMBER THE ULTRAWORK RULES:\n- **PARALLEL**: Fire independent calls simultaneously - NEVER wait sequentially\n- **BACKGROUND FIRST**: Use Task(run_in_background=true) for exploration (10+ concurrent)\n- **TODO**: Track EVERY step. Mark complete IMMEDIATELY after each\n- **VERIFY**: Check ALL requirements met before done\n- **NO Premature Stopping**: ALL TODOs must be complete\n\nContinue working on the next pending task. DO NOT STOP until all tasks are marked complete.\n\nOriginal task: $ORIGINAL_PROMPT\n\n</ultrawork-persistence>\n\n---\n"}
EOF
    exit 0
  fi
fi

# Priority 3: Todo Continuation (baseline)
if [ "$INCOMPLETE_COUNT" -gt 0 ]; then
  # Check if max attempts reached (escape hatch for stuck agents)
  ATTEMPTS=$(get_attempt_count)
  if [ "$ATTEMPTS" -ge "$MAX_TODO_CONTINUATION_ATTEMPTS" ]; then
    # Clean temp files
    rm -f "$ATTEMPT_FILE" "$TODO_COUNT_FILE"

    # Allow stop with warning
    cat << EOF
{"continue": true}
EOF
    exit 0
  fi

  # Increment attempts before forcing continuation
  increment_attempts

  cat << EOF
{"decision": "block", "reason": "<todo-continuation>\n\n[SYSTEM REMINDER - TODO CONTINUATION]\n\nIncomplete tasks remain in your todo list ($INCOMPLETE_COUNT remaining). Continue working on the next pending task.\n\n- Proceed without asking for permission\n- Mark each task complete when finished\n- Do not stop until all tasks are done\n\n</todo-continuation>\n\n---\n"}
EOF
  exit 0
fi

# No blocking needed
if type omt_log_decision &>/dev/null; then
  omt_log_decision "continue" "No blocking conditions found"
  omt_log_end
fi
echo '{"continue": true}'
exit 0

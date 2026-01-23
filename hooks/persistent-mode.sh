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

# Check for verification state (oracle verification, session-specific)
VERIFICATION_STATE=""
if [ -f "$PROJECT_ROOT/.claude/sisyphus/ralph-verification-${SESSION_ID}.json" ]; then
  VERIFICATION_STATE=$(cat "$PROJECT_ROOT/.claude/sisyphus/ralph-verification-${SESSION_ID}.json" 2>/dev/null)
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

# Create ralph-verification-{SESSION_ID}.json when promise detected
create_ralph_verification() {
  local original_task="$1"
  local completion_claim="${2:-DONE}"
  local verification_file="$PROJECT_ROOT/.claude/sisyphus/ralph-verification-${SESSION_ID}.json"
  local timestamp
  timestamp=$(date -Iseconds 2>/dev/null || date +%Y-%m-%dT%H:%M:%S%z)

  cat > "$verification_file" << VERIFICATION_EOF
{
  "pending": true,
  "verification_attempts": 0,
  "max_verification_attempts": 3,
  "original_task": "$original_task",
  "completion_claim": "$completion_claim",
  "oracle_feedback": "",
  "requested_at": "$timestamp"
}
VERIFICATION_EOF
}

# Clean up all ralph state files (session-specific)
cleanup_ralph_state() {
  rm -f "$PROJECT_ROOT/.claude/sisyphus/ralph-state-${SESSION_ID}.json" 2>/dev/null
  rm -f "$PROJECT_ROOT/.claude/sisyphus/ralph-verification-${SESSION_ID}.json" 2>/dev/null
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

    # Check for completion promise in transcript - create verification state if found
    if detect_completion_promise; then
      if [ -z "$VERIFICATION_STATE" ]; then
        create_ralph_verification "$PROMPT" "$PROMISE"
        VERIFICATION_STATE=$(cat "$PROJECT_ROOT/.claude/sisyphus/ralph-verification-${SESSION_ID}.json" 2>/dev/null)
      fi
    fi

    # Check if oracle verification is pending
    if [ -n "$VERIFICATION_STATE" ]; then
      IS_PENDING=$(echo "$VERIFICATION_STATE" | jq -r '.pending // false' 2>/dev/null)
      if [ "$IS_PENDING" = "true" ]; then
        ATTEMPT=$(echo "$VERIFICATION_STATE" | jq -r '.verification_attempts // 0' 2>/dev/null)
        MAX_ATTEMPTS=$(echo "$VERIFICATION_STATE" | jq -r '.max_verification_attempts // 3' 2>/dev/null)
        ORIGINAL_TASK=$(echo "$VERIFICATION_STATE" | jq -r '.original_task // ""' 2>/dev/null)
        COMPLETION_CLAIM=$(echo "$VERIFICATION_STATE" | jq -r '.completion_claim // ""' 2>/dev/null)
        ORACLE_FEEDBACK=$(echo "$VERIFICATION_STATE" | jq -r '.oracle_feedback // ""' 2>/dev/null)
        NEXT_ATTEMPT=$((ATTEMPT + 1))

        # Handle max verification attempts (force-accept with warning)
        if [ "$ATTEMPT" -ge "$MAX_ATTEMPTS" ]; then
          # Force-accept: clean up all state files and allow stop
          cleanup_ralph_state
          # Clean up session-specific ultrawork state
          rm -f "$PROJECT_ROOT/.claude/sisyphus/ultrawork-state-${SESSION_ID}.json"
          rm -f "$HOME/.claude/ultrawork-state-${SESSION_ID}.json"

          cat << EOF
{"continue": true, "message": "[FORCE ACCEPT - MAX VERIFICATION ATTEMPTS REACHED]\n\nVerification failed $MAX_ATTEMPTS times without oracle approval.\n\n## Warning\nThe task completion could not be verified by Oracle.\nThis may indicate incomplete or incorrect implementation.\n\n## Recommended Actions:\n1. Manually review the implementation\n2. Check for any obvious issues\n3. Consider running tests manually\n\nAllowing stop due to max attempts limit."}
EOF
          exit 0
        fi

        # Increment verification attempts
        echo "$VERIFICATION_STATE" | jq ".verification_attempts = $NEXT_ATTEMPT" > "$PROJECT_ROOT/.claude/sisyphus/ralph-verification-${SESSION_ID}.json" 2>/dev/null

        # Check for oracle rejection and extract feedback
        REJECTION_FEEDBACK=""
        if REJECTION_FEEDBACK=$(detect_oracle_rejection); then
          # Update verification state with feedback
          echo "$VERIFICATION_STATE" | jq ".verification_attempts = $NEXT_ATTEMPT | .oracle_feedback = \"$REJECTION_FEEDBACK\"" > "$PROJECT_ROOT/.claude/sisyphus/ralph-verification-${SESSION_ID}.json" 2>/dev/null
        fi

        FEEDBACK_SECTION=""
        if [ -n "$ORACLE_FEEDBACK" ] && [ "$ORACLE_FEEDBACK" != "null" ]; then
          FEEDBACK_SECTION="\n**Previous Oracle Feedback (rejected):**\n$ORACLE_FEEDBACK\n"
        fi

        cat << EOF
{"continue": false, "reason": "<ralph-verification>\n\n[🚨 ORACLE VERIFICATION REQUIRED - Attempt $NEXT_ATTEMPT/$MAX_ATTEMPTS]\n\n## ⛔ YOU CANNOT STOP YET\n\nYou output \`<promise>DONE</promise>\` but the hook detected NO oracle approval tag.\n\n**Original Task:**\n$ORIGINAL_TASK\n\n**Completion Claim:**\n$COMPLETION_CLAIM\n$FEEDBACK_SECTION\n---\n\n## 🔴 CRITICAL: ORACLE VERIFICATION PROTOCOL\n\n### Step 1: Spawn Oracle NOW\n\`\`\`\nTask(subagent_type=\"oracle\", prompt=\"Verify completion of: $ORIGINAL_TASK\")\n\`\`\`\n\n### Step 2: Read Oracle's Response\n- Did Oracle find ANY issues? → Fix them, re-verify\n- Did Oracle approve? → Proceed to Step 3\n\n### Step 3: OUTPUT THE TAG (YOU must do this, not Oracle)\n\n**⚠️ YOU MUST OUTPUT THIS EXACT TAG:**\n\n\`\`\`\n<oracle-approved>VERIFIED_COMPLETE</oracle-approved>\n\`\`\`\n\n### Step 4: THEN output promise\n\`\`\`\n<promise>DONE</promise>\n\`\`\`\n\n---\n\n## 🛑 WHY YOU ARE BLOCKED\n\nThe hook scans the transcript for:\n\`<oracle-approved>VERIFIED_COMPLETE</oracle-approved>\`\n\n**This tag was NOT found.** You MUST output it BEFORE the promise.\n\nSequence: Oracle verification → YOU output tag → THEN promise\n\n</ralph-verification>\n\n---\n"}
EOF
        exit 0
      fi
    fi

    if [ "$ITERATION" -ge "$MAX_ITER" ]; then
      # Max iterations reached - clean up ALL state files (session-specific)
      rm -f "$PROJECT_ROOT/.claude/sisyphus/ralph-state-${SESSION_ID}.json"
      rm -f "$PROJECT_ROOT/.claude/sisyphus/ralph-verification-${SESSION_ID}.json"

      # Clean session-specific ultrawork state
      rm -f "$PROJECT_ROOT/.claude/sisyphus/ultrawork-state-${SESSION_ID}.json"
      rm -f "$HOME/.claude/ultrawork-state-${SESSION_ID}.json"

      # Clean todo attempt counter
      rm -f "/tmp/oh-my-toong-todo-attempts-${ATTEMPT_ID}"
      rm -f "/tmp/oh-my-toong-todo-count-${ATTEMPT_ID}"

      cat << EOF
{"continue": true, "message": "[RALPH LOOP STOPPED - MAX ITERATIONS]\n\nReached maximum iterations ($MAX_ITER) without verified completion.\n\n## What happened:\n- Task was not fully completed within $MAX_ITER iterations\n- All Ralph and linked Ultrawork states cleaned up\n\n## Recommended actions:\n1. Review the original task requirements\n2. Consider breaking into smaller tasks\n3. Re-activate with: ralph <task>\n\nOriginal task: $PROMPT"}
EOF
      exit 0
    fi

    # Increment iteration
    NEW_ITER=$((ITERATION + 1))
    echo "$RALPH_STATE" | jq ".iteration = $NEW_ITER" > "$PROJECT_ROOT/.claude/sisyphus/ralph-state-${SESSION_ID}.json" 2>/dev/null

    cat << EOF
{"continue": false, "reason": "<ralph-loop-continuation>\n\n[RALPH LOOP - ITERATION $NEW_ITER/$MAX_ITER]\n\nYour previous attempt did not output the completion promise. The work is NOT done yet.\n\nCRITICAL INSTRUCTIONS:\n1. Review your progress and the original task\n2. Check your todo list - are ALL items marked complete?\n3. Continue from where you left off\n4. When FULLY complete, output: <promise>$PROMISE</promise>\n5. Do NOT stop until the task is truly done\n\nOriginal task: $PROMPT\n\n</ralph-loop-continuation>\n\n---\n"}
EOF
    exit 0
  fi
fi

# Priority 1.5: Verification Requirements (build/test/git/background)
VERIFICATION_FAILURES=()

# Check 1: Build verification
BUILD_ISSUES=""
if [ -f "$DIRECTORY/package.json" ]; then
  if command -v jq &> /dev/null; then
    BUILD_SCRIPT=$(jq -r '.scripts.build // empty' "$DIRECTORY/package.json" 2>/dev/null)
    if [ -n "$BUILD_SCRIPT" ]; then
      # Check if build directory exists or recent build artifacts
      if [ ! -d "$DIRECTORY/dist" ] && [ ! -d "$DIRECTORY/build" ] && [ ! -d "$DIRECTORY/out" ]; then
        BUILD_ISSUES="Build script exists but no build artifacts found (dist/build/out). Run 'npm run build' to verify."
      fi
    fi
  fi
elif [ -f "$DIRECTORY/Makefile" ]; then
  # Check for common make targets
  if grep -q "^build:" "$DIRECTORY/Makefile" 2>/dev/null; then
    BUILD_ISSUES="Makefile with build target detected. Run 'make build' to verify before stopping."
  fi
elif [ -f "$DIRECTORY/Cargo.toml" ]; then
  # Check for Rust build artifacts
  if [ ! -d "$DIRECTORY/target/release" ] && [ ! -d "$DIRECTORY/target/debug" ]; then
    BUILD_ISSUES="Rust project detected but no build artifacts found. Run 'cargo build' to verify."
  fi
fi

if [ -n "$BUILD_ISSUES" ]; then
  VERIFICATION_FAILURES+=("BUILD: $BUILD_ISSUES")
fi

# Check 2: Test failures in recent output
TEST_ISSUES=""
if [ -f "$DIRECTORY/package.json" ]; then
  if command -v jq &> /dev/null; then
    TEST_SCRIPT=$(jq -r '.scripts.test // empty' "$DIRECTORY/package.json" 2>/dev/null)
    if [ -n "$TEST_SCRIPT" ]; then
      # Check for test artifacts or recent test run indicators
      TEST_ISSUES="Test script exists. Run 'npm test' to verify all tests pass before stopping."
    fi
  fi
elif [ -f "$DIRECTORY/pytest.ini" ] || [ -f "$DIRECTORY/setup.py" ] || [ -d "$DIRECTORY/tests" ]; then
  TEST_ISSUES="Python test directory/config detected. Run tests to verify before stopping."
elif [ -f "$DIRECTORY/Cargo.toml" ]; then
  TEST_ISSUES="Rust project detected. Run 'cargo test' to verify before stopping."
fi

# Check for recent test failure indicators in common log locations
for log_file in "$DIRECTORY/test-results.log" "$DIRECTORY/.test-output" "$HOME/.claude/last-test-run.log"; do
  if [ -f "$log_file" ]; then
    if grep -qi "FAIL\|ERROR\|failed" "$log_file" 2>/dev/null; then
      TEST_ISSUES="Recent test failures detected in $log_file. Fix failures before stopping."
      break
    fi
  fi
done

if [ -n "$TEST_ISSUES" ]; then
  VERIFICATION_FAILURES+=("TEST: $TEST_ISSUES")
fi

# Check 3: Git status - uncommitted changes
GIT_ISSUES=""
if [ -d "$DIRECTORY/.git" ]; then
  # Check for uncommitted changes
  cd "$DIRECTORY" 2>/dev/null
  if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    CHANGED_FILES=$(git status --porcelain 2>/dev/null | wc -l)
    GIT_ISSUES="$CHANGED_FILES uncommitted file(s). Consider committing changes or verify they should be discarded."
  fi
  # Check for unpushed commits
  UNPUSHED=$(git log @{u}.. --oneline 2>/dev/null | wc -l)
  if [ "$UNPUSHED" -gt 0 ]; then
    if [ -n "$GIT_ISSUES" ]; then
      GIT_ISSUES="$GIT_ISSUES Also, $UNPUSHED unpushed commit(s) exist."
    else
      GIT_ISSUES="$UNPUSHED unpushed commit(s). Consider pushing to remote or verify local-only is intended."
    fi
  fi
fi

if [ -n "$GIT_ISSUES" ]; then
  VERIFICATION_FAILURES+=("GIT: $GIT_ISSUES")
fi

# Check 4: Background tasks still running
BACKGROUND_ISSUES=""
BACKGROUND_DIR="$HOME/.claude/background-tasks"
if [ -d "$BACKGROUND_DIR" ]; then
  RUNNING_TASKS=0
  for task_file in "$BACKGROUND_DIR"/*.json; do
    if [ -f "$task_file" ]; then
      if command -v jq &> /dev/null; then
        STATUS=$(jq -r '.status // ""' "$task_file" 2>/dev/null)
        if [ "$STATUS" = "running" ] || [ "$STATUS" = "pending" ]; then
          RUNNING_TASKS=$((RUNNING_TASKS + 1))
        fi
      else
        # Fallback: check for running/pending status
        if grep -q '"status"[[:space:]]*:[[:space:]]*"running\|pending"' "$task_file" 2>/dev/null; then
          RUNNING_TASKS=$((RUNNING_TASKS + 1))
        fi
      fi
    fi
  done

  if [ "$RUNNING_TASKS" -gt 0 ]; then
    BACKGROUND_ISSUES="$RUNNING_TASKS background task(s) still running. Wait for completion or verify results."
  fi
fi

if [ -n "$BACKGROUND_ISSUES" ]; then
  VERIFICATION_FAILURES+=("BACKGROUND: $BACKGROUND_ISSUES")
fi

# If any verification failures exist, block stopping
if [ ${#VERIFICATION_FAILURES[@]} -gt 0 ]; then
  FAILURE_LIST=""
  for failure in "${VERIFICATION_FAILURES[@]}"; do
    FAILURE_LIST="$FAILURE_LIST\n- $failure"
  done

  cat << EOF
{"continue": false, "reason": "<verification-requirements>\n\n[VERIFICATION REQUIREMENTS NOT MET]\n\nBefore stopping, you must address the following verification requirements:\n$FAILURE_LIST\n\n## REQUIRED ACTIONS:\n\n1. **Build Verification**: If build scripts exist, run them and verify success\n2. **Test Verification**: Run all tests and ensure they pass\n3. **Git Status**: Review uncommitted/unpushed changes - commit or verify intentional\n4. **Background Tasks**: Wait for or check results of running background tasks\n\n**You cannot stop until these verifications are complete.**\n\nAddress each issue above, then you may conclude.\n\n</verification-requirements>\n\n---\n"}
EOF
  exit 0
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
{"continue": true, "message": "[TODO CONTINUATION LIMIT REACHED]\n\nAttempted $MAX_TODO_CONTINUATION_ATTEMPTS continuations without progress.\n$INCOMPLETE_COUNT tasks remain incomplete.\n\n## What this means:\nThe agent appears stuck and unable to complete remaining tasks.\n\n## Recommended actions:\n1. Review the stuck tasks manually\n2. Provide additional guidance\n3. Consider simplifying remaining tasks\n\nAllowing stop to prevent infinite loop."}
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
{"continue": false, "reason": "<ultrawork-persistence>\n\n[ULTRAWORK MODE STILL ACTIVE - Reinforcement #$NEW_COUNT]\n\nYour ultrawork session is NOT complete. $INCOMPLETE_COUNT incomplete todos remain.\n\nREMEMBER THE ULTRAWORK RULES:\n- **PARALLEL**: Fire independent calls simultaneously - NEVER wait sequentially\n- **BACKGROUND FIRST**: Use Task(run_in_background=true) for exploration (10+ concurrent)\n- **TODO**: Track EVERY step. Mark complete IMMEDIATELY after each\n- **VERIFY**: Check ALL requirements met before done\n- **NO Premature Stopping**: ALL TODOs must be complete\n\nContinue working on the next pending task. DO NOT STOP until all tasks are marked complete.\n\nOriginal task: $ORIGINAL_PROMPT\n\n</ultrawork-persistence>\n\n---\n"}
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
{"continue": true, "message": "[TODO CONTINUATION LIMIT REACHED]\n\nAttempted $MAX_TODO_CONTINUATION_ATTEMPTS continuations without progress.\n$INCOMPLETE_COUNT tasks remain incomplete.\n\n## What this means:\nThe agent appears stuck and unable to complete remaining tasks.\n\n## Recommended actions:\n1. Review the stuck tasks manually\n2. Provide additional guidance\n3. Consider simplifying remaining tasks\n\nAllowing stop to prevent infinite loop."}
EOF
    exit 0
  fi

  # Increment attempts before forcing continuation
  increment_attempts

  cat << EOF
{"continue": false, "reason": "<todo-continuation>\n\n[SYSTEM REMINDER - TODO CONTINUATION]\n\nIncomplete tasks remain in your todo list ($INCOMPLETE_COUNT remaining). Continue working on the next pending task.\n\n- Proceed without asking for permission\n- Mark each task complete when finished\n- Do not stop until all tasks are done\n\n</todo-continuation>\n\n---\n"}
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

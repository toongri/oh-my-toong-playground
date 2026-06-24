#!/bin/bash
# Sisyphus Session Start Hook
# Restores persistent mode states and injects context when session starts

# Read stdin
INPUT=$(cat)

# Get session ID and directory
SESSION_ID=""
DIRECTORY=""
SOURCE=""
if command -v jq &> /dev/null; then
  SESSION_ID=$(echo "$INPUT" | jq -r '.sessionId // .session_id // ""' 2>/dev/null)
  DIRECTORY=$(echo "$INPUT" | jq -r '.cwd // ""' 2>/dev/null)
  SOURCE=$(echo "$INPUT" | jq -r '.source // ""' 2>/dev/null)
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

# Export OMT_SESSION_ID via Claude env file
if [ -n "$CLAUDE_ENV_FILE" ]; then
  echo "export OMT_SESSION_ID=\"$SESSION_ID\"" >> "$CLAUDE_ENV_FILE"
fi

MESSAGES=""
HANDOFF=""

# GC: reap dead state files for the 3 managed prefixes.
# Liveness defined by hooks/lib/state-liveness.sh (ACTIVE_IDLE_TTL=6h, TERMINAL_TTL=30m).
# The current session's state is always kept regardless of age.
source "$SCRIPT_DIR_SS/lib/state-liveness.sh"
GC_NOW=$(date +%s)
for state_file in \
    "$OMT_DIR"/goal-state-*.json \
    "$OMT_DIR"/prometheus-state-*.json \
    "$OMT_DIR"/deep-interview-active-state-*.json; do
  [ -f "$state_file" ] || continue
  if is_current_session "$state_file" "$SESSION_ID"; then
    continue
  fi
  if ! is_state_live "$state_file" "$GC_NOW"; then
    rm -f "$state_file"
  fi
done

# GC arm: reap orphaned compaction handoffs by mtime (self-contained).
# A .md handoff has no JSON liveness fields, so it cannot be classified by
# is_state_live / is_current_session (which strip .json + match *-state- prefixes).
# This arm extracts the sid from the basename (dash-safe: prefix + suffix strip,
# NOT a last-dash split), skips the current session via its OWN guard, and reaps
# any handoff older than HANDOFF_ORPHAN_TTL_SECS. is_current_session is NOT called.
# The TTL mirrors the terminal grace period; sourced from the state-liveness SSOT
# (TERMINAL_TTL) rather than re-stating the literal, to avoid value drift.
HANDOFF_ORPHAN_TTL_SECS="$TERMINAL_TTL"
for handoff_file in "$OMT_DIR"/handoff-*.md; do
  [ -e "$handoff_file" ] || continue
  handoff_base="${handoff_file##*/}"
  handoff_sid="${handoff_base#handoff-}"
  handoff_sid="${handoff_sid%.md}"
  [ "$handoff_sid" = "$SESSION_ID" ] && continue
  # GNU form (-c %Y) first: GNU `stat -f` means --file-system and prints a
  # non-numeric block to stdout for the file operand, which would poison the
  # arithmetic below; BSD `stat -c` instead fails cleanly with no stdout. So the
  # GNU-first order is portable, while BSD-first would capture garbage on Linux.
  handoff_mtime=$(stat -c %Y "$handoff_file" 2>/dev/null || stat -f %m "$handoff_file" 2>/dev/null || true)
  [ -n "$handoff_mtime" ] || continue
  handoff_age=$(( GC_NOW - handoff_mtime ))
  if [ "$handoff_age" -gt "$HANDOFF_ORPHAN_TTL_SECS" ]; then
    rm -f "$handoff_file"
  fi
done

# Check for active prometheus state (session-specific)
if [ -f "$OMT_DIR/prometheus-state-${SESSION_ID}.json" ]; then
  PROMETHEUS_STATE=$(cat "$OMT_DIR/prometheus-state-${SESSION_ID}.json" 2>/dev/null)

  if command -v jq &> /dev/null; then
    PROM_ACTIVE=$(echo "$PROMETHEUS_STATE" | jq -r '.active // false' 2>/dev/null)
    if [ "$PROM_ACTIVE" = "true" ]; then
      PROM_PHASE=$(echo "$PROMETHEUS_STATE" | jq -r '.phase // ""' 2>/dev/null)
      PROM_PLAN_PATH=$(echo "$PROMETHEUS_STATE" | jq -r '.plan_path // ""' 2>/dev/null)
      PROM_RESUME=$(echo "$PROMETHEUS_STATE" | jq -r '.resume_summary // ""' 2>/dev/null)
      # Escape backslashes so the value is safe to embed in a hand-built JSON string.
      # Must happen here (data field only) — not at the final sed — to avoid doubling
      # the intentional \n newline markers already present in the MESSAGES template.
      PROM_RESUME=$(printf '%s' "$PROM_RESUME" | sed 's/\\/\\\\/g')

      # Determine whether the plan file is available on disk.
      # Unavailable means: plan_path empty/null, OR plan_path set but file missing.
      PROM_PLAN_AVAILABLE=false
      if [ -n "$PROM_PLAN_PATH" ] && [ "$PROM_PLAN_PATH" != "null" ] && [ -f "$PROM_PLAN_PATH" ]; then
        PROM_PLAN_AVAILABLE=true
      fi

      PROM_PLAN_NOTE=""
      PROM_INSTRUCTION=""
      if [ "$PROM_PLAN_AVAILABLE" = "true" ]; then
        PROM_INSTRUCTION="\nRe-read the current plan from disk and distrust stored verdicts -- re-run all gates on the current artifact.\n"
      else
        if [ -n "$PROM_RESUME" ] && [ "$PROM_RESUME" != "null" ]; then
          PROM_PLAN_NOTE="\nPlan file not available on disk. Resume from this bookmark: ${PROM_RESUME}\n"
        else
          PROM_PLAN_NOTE="\nPlan file not available on disk yet.\n"
        fi
      fi

      MESSAGES="$MESSAGES<session-restore>\n\n[PROMETHEUS RESTORED]\n\nYou have an active prometheus session.\nPhase: $PROM_PHASE\nPlan path: $PROM_PLAN_PATH\n$PROM_PLAN_NOTE$PROM_INSTRUCTION\n</session-restore>\n\n---\n\n"
    fi
  fi
fi

# Check for active goal state (session-specific)
if [ -f "$OMT_DIR/goal-state-${SESSION_ID}.json" ]; then
  GOAL_STATE=$(cat "$OMT_DIR/goal-state-${SESSION_ID}.json" 2>/dev/null)

  if command -v jq &> /dev/null; then
    GOAL_ACTIVE=$(echo "$GOAL_STATE" | jq -r '.active // false' 2>/dev/null)
    if [ "$GOAL_ACTIVE" = "true" ]; then
      GOAL_PHASE=$(echo "$GOAL_STATE" | jq -r '.phase // ""' 2>/dev/null)

      # Pristine-seed guard: a freshly seeded state (phase=planning, iteration=0,
      # outcome="" or absent) is inert — it may be an orphan from a refused goal
      # invocation. Skip the restore block; GC reaps the orphan by TTL.
      GOAL_ITERATION_RAW=$(echo "$GOAL_STATE" | jq -r '.iteration // 0' 2>/dev/null)
      GOAL_OUTCOME_RAW=$(echo "$GOAL_STATE" | jq -r '.outcome // ""' 2>/dev/null)
      GOAL_IS_PRISTINE=false
      if [ "$GOAL_PHASE" = "planning" ] && [ "$GOAL_ITERATION_RAW" = "0" ] && [ "$GOAL_OUTCOME_RAW" = "" ]; then
        GOAL_IS_PRISTINE=true
      fi

      if [ "$GOAL_IS_PRISTINE" = "false" ]; then
        GOAL_PLAN_PATH=$(echo "$GOAL_STATE" | jq -r '.plan_path // ""' 2>/dev/null)
        GOAL_RESUME=$(echo "$GOAL_STATE" | jq -r '.resume_summary // ""' 2>/dev/null)
        GOAL_RESUME=$(printf '%s' "$GOAL_RESUME" | sed 's/\\/\\\\/g')
        GOAL_ITERATION=$(echo "$GOAL_STATE" | jq -r '.iteration // 0' 2>/dev/null)
        GOAL_MAX_ITER=$(echo "$GOAL_STATE" | jq -r '.max_iterations // 10' 2>/dev/null)

        # Determine whether the plan file is available on disk.
        GOAL_PLAN_AVAILABLE=false
        if [ -n "$GOAL_PLAN_PATH" ] && [ "$GOAL_PLAN_PATH" != "null" ] && [ -f "$GOAL_PLAN_PATH" ]; then
          GOAL_PLAN_AVAILABLE=true
        fi

        # Escape backslashes so the value is safe to embed in a hand-built JSON string.
        # Must happen after the -f existence check (which needs the raw path) and before
        # $GOAL_PLAN_PATH is interpolated into MESSAGES.
        GOAL_PLAN_PATH=$(printf '%s' "$GOAL_PLAN_PATH" | sed 's/\\/\\\\/g')

        GOAL_PLAN_NOTE=""
        GOAL_INSTRUCTION=""
        if [ "$GOAL_PHASE" = "planning" ]; then
          # Planning-resume: guide the AI to continue co-designing the plan
          if [ "$GOAL_PLAN_AVAILABLE" = "true" ]; then
            GOAL_INSTRUCTION="\nRe-read the current plan from disk and continue the planning process where you left off.\n"
          else
            if [ -n "$GOAL_RESUME" ] && [ "$GOAL_RESUME" != "null" ]; then
              GOAL_PLAN_NOTE="\nPlan file not available on disk. Resume from this bookmark: ${GOAL_RESUME}\n"
            else
              GOAL_PLAN_NOTE="\nPlan file not available on disk yet. Continue planning from the beginning.\n"
            fi
          fi
        else
          # Pursuing-resume: guide the AI to continue autonomous pursuit
          GOAL_INSTRUCTION="\nIteration: $GOAL_ITERATION/$GOAL_MAX_ITER. Continue pursuing the objective autonomously.\n"
          if [ "$GOAL_PLAN_AVAILABLE" = "true" ]; then
            GOAL_INSTRUCTION="${GOAL_INSTRUCTION}Re-read the current plan from disk before continuing.\n"
          fi
          if [ -n "$GOAL_RESUME" ] && [ "$GOAL_RESUME" != "null" ]; then
            GOAL_PLAN_NOTE="\nLast checkpoint: ${GOAL_RESUME}\n"
          fi
        fi

        MESSAGES="$MESSAGES<session-restore>\n\n[GOAL RESTORED]\n\nYou have an active goal session (phase: $GOAL_PHASE).\nPlan path: $GOAL_PLAN_PATH\n$GOAL_PLAN_NOTE$GOAL_INSTRUCTION\nIMPORTANT: Invoking the goal skill again while a goal is already active is refused. Continue the existing goal, do not start a new one.\n\n</session-restore>\n\n---\n\n"
      fi
    fi
  fi
fi

# Compaction handoff (source==compact): read the current-sid handoff into a
# SEPARATE variable (NOT MESSAGES) so the surgical jq -Rs encoder can handle the
# untrusted summarizer prose on its own, leaving the restore sed path untouched.
# Delete-on-consume for inlined (small) handoffs; large handoffs are KEPT as a pointer
# target and reaped later by the orphan-GC TTL arm.
if command -v jq &> /dev/null && [ "$SOURCE" = "compact" ]; then
  HANDOFF_FILE="$OMT_DIR/handoff-${SESSION_ID}.md"
  if [ -f "$HANDOFF_FILE" ]; then
    HANDOFF_RAW=$(cat "$HANDOFF_FILE" 2>/dev/null)
    # additionalContext is capped ~10k chars; the rich handoff routinely exceeds it.
    # Small handoff: inline it and consume the baton (delete). Large handoff: inject a
    # forced-reread POINTER and KEEP the file so the agent reads the full record on
    # disk (the orphan-GC arm reaps it later by TTL). No inline preview -- a byte-cut
    # of multibyte (e.g. Korean) prose could emit invalid UTF-8 into the jq -Rs encoder.
    if [ "${#HANDOFF_RAW}" -le 7000 ]; then
      HANDOFF="$HANDOFF_RAW"
      rm -f "$HANDOFF_FILE"
    else
      HANDOFF="[COMPACTION HANDOFF -- full continuation record on disk]

Your context was just compacted. The COMPLETE session handoff (original request verbatim, the full arc of decisions/rejections/Q&A, exact stopping point, and all user messages) is saved at:
  $HANDOFF_FILE
READ THAT FILE IN FULL NOW, BEFORE ANY OTHER ACTION. It is your only memory of this session -- do not trust your recollection of prior turns. Reconstructing it from memory is NOT reading it."
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

# Output message if we have any restore content OR a consumed handoff.
if [ -n "$MESSAGES" ] || [ -n "$HANDOFF" ]; then
  # Escape for JSON
  MESSAGES_ESCAPED=$(echo "$MESSAGES" | sed 's/"/\\"/g')
  # Surgically encode the untrusted handoff fragment to a JSON-safe string body:
  # jq -Rs emits a quoted JSON string; strip the outer quotes so it concatenates
  # onto the sed-escaped restore body inside the single additionalContext value.
  HANDOFF_ESCAPED=$(printf '%s' "$HANDOFF" | jq -Rs . | sed '1s/^"//; $s/"$//')
  echo "{\"continue\": true, \"hookSpecificOutput\": {\"hookEventName\": \"SessionStart\", \"additionalContext\": \"$MESSAGES_ESCAPED$HANDOFF_ESCAPED\"}}"
else
  echo '{"continue": true}'
fi
exit 0

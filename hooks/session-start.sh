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
    "$OMT_DIR"/deep-interview-active-state-*.json \
    "$OMT_DIR"/qa-state-*.json; do
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

# GC arm: reap orphaned handoff-consumed-<sid> markers (D-9 marker contract).
# Mirrors the handoff-*.md arm above: own current-sid skip, mtime TTL reuse of
# TERMINAL_TTL. Separate arm (not folded into the .md arm above) because the
# .md arm's sid-extraction (#handoff-/%.md) mis-parses a .md-less marker.
# Explicit post-glob filter, NOT a glob property: handoff-consumed-* would
# also match a handoff-consumed-*.md file if a sid literally started
# "consumed-"; the filter guarantees this arm never reaps a .md handoff.
for marker_file in "$OMT_DIR"/handoff-consumed-*; do
  [ -e "$marker_file" ] || continue
  case "$marker_file" in
    *.md) continue ;;
  esac
  marker_base="${marker_file##*/}"
  marker_sid="${marker_base#handoff-consumed-}"
  [ "$marker_sid" = "$SESSION_ID" ] && continue
  marker_mtime=$(stat -c %Y "$marker_file" 2>/dev/null || stat -f %m "$marker_file" 2>/dev/null || true)
  [ -n "$marker_mtime" ] || continue
  marker_age=$(( GC_NOW - marker_mtime ))
  if [ "$marker_age" -gt "$HANDOFF_ORPHAN_TTL_SECS" ]; then
    rm -f "$marker_file"
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

      # Determine whether the plan file is available on disk.
      # Unavailable means: plan_path empty/null, OR plan_path set but file missing.
      PROM_PLAN_AVAILABLE=false
      if [ -n "$PROM_PLAN_PATH" ] && [ "$PROM_PLAN_PATH" != "null" ] && [ -f "$PROM_PLAN_PATH" ]; then
        PROM_PLAN_AVAILABLE=true
      fi

      PROM_INSTRUCTION=""
      if [ "$PROM_PLAN_AVAILABLE" = "true" ]; then
        PROM_INSTRUCTION="\nRe-read the current plan from disk and distrust stored verdicts -- re-run all gates on the current artifact.\n"
      fi

      MESSAGES="$MESSAGES<session-restore>\n\n[PROMETHEUS RESTORED]\n\nYou have an active prometheus session.\nPhase: $PROM_PHASE\n\nRun this command NOW, before any other action:\n  cat \"\$OMT_DIR/prometheus-state-\$OMT_SESSION_ID.json\"\n(\$OMT_DIR and \$OMT_SESSION_ID are set in CLAUDE_ENV_FILE exported by this hook.)\n$PROM_INSTRUCTION\n</session-restore>\n\n---\n\n"
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

        # Determine whether the plan file is available on disk.
        GOAL_PLAN_AVAILABLE=false
        if [ -n "$GOAL_PLAN_PATH" ] && [ "$GOAL_PLAN_PATH" != "null" ] && [ -f "$GOAL_PLAN_PATH" ]; then
          GOAL_PLAN_AVAILABLE=true
        fi

        GOAL_INSTRUCTION=""
        if [ "$GOAL_PHASE" = "planning" ]; then
          # Planning-resume: guide the AI to continue co-designing the plan
          if [ "$GOAL_PLAN_AVAILABLE" = "true" ]; then
            GOAL_INSTRUCTION="\nRe-read the current plan from disk and continue the planning process where you left off.\n"
          else
            GOAL_INSTRUCTION="\nNo plan file on disk yet. Continue planning from the state you just read above — resume from its resume_summary checkpoint if present, otherwise begin planning afresh.\n"
          fi
        else
          # Pursuing-resume: guide the AI to continue autonomous pursuit
          GOAL_INSTRUCTION="\nContinue pursuing the objective autonomously.\n"
          if [ "$GOAL_PLAN_AVAILABLE" = "true" ]; then
            GOAL_INSTRUCTION="${GOAL_INSTRUCTION}Re-read the current plan from disk before continuing.\n"
          fi
        fi

        MESSAGES="$MESSAGES<session-restore>\n\n[GOAL RESTORED]\n\nYou have an active goal session (phase: $GOAL_PHASE).\n\nRun this command NOW, before any other action:\n  cat \"\$OMT_DIR/goal-state-\$OMT_SESSION_ID.json\"\n(\$OMT_DIR and \$OMT_SESSION_ID are set in CLAUDE_ENV_FILE exported by this hook.)\n$GOAL_INSTRUCTION\nIMPORTANT: Invoking the goal skill again while a goal is already active is refused. Continue the existing goal, do not start a new one.\n\n</session-restore>\n\n---\n\n"
      fi
    fi
  fi
fi

# Check for active qa state (session-specific)
if [ -f "$OMT_DIR/qa-state-${SESSION_ID}.json" ]; then
  QA_STATE=$(cat "$OMT_DIR/qa-state-${SESSION_ID}.json" 2>/dev/null)

  if command -v jq &> /dev/null; then
    QA_ACTIVE=$(echo "$QA_STATE" | jq -r '.active // false' 2>/dev/null)
    if [ "$QA_ACTIVE" = "true" ]; then
      QA_PHASE=$(echo "$QA_STATE" | jq -r '.phase // ""' 2>/dev/null)

      # Pristine-seed guard: a freshly seeded state (phase=PRE-FLIGHT, cycle=0,
      # target="" or absent) is inert — it may be an orphan from a refused qa
      # invocation. Skip the restore block; GC reaps the orphan by TTL.
      QA_CYCLE_RAW=$(echo "$QA_STATE" | jq -r '.cycle // 0' 2>/dev/null)
      QA_TARGET_RAW=$(echo "$QA_STATE" | jq -r '.target // ""' 2>/dev/null)
      QA_IS_PRISTINE=false
      if [ "$QA_PHASE" = "PRE-FLIGHT" ] && [ "$QA_CYCLE_RAW" = "0" ] && [ "$QA_TARGET_RAW" = "" ]; then
        QA_IS_PRISTINE=true
      fi

      if [ "$QA_IS_PRISTINE" = "false" ]; then
        MESSAGES="$MESSAGES<session-restore>\n\n[QA RESTORED]\n\nYou have an active qa session (phase: $QA_PHASE).\n\nRun this command NOW, before any other action:\n  cat \"\$OMT_DIR/qa-state-\$OMT_SESSION_ID.json\"\n(\$OMT_DIR and \$OMT_SESSION_ID are set in CLAUDE_ENV_FILE exported by this hook.)\n\nContinue the qa cycle from the state you just read above.\n\n</session-restore>\n\n---\n\n"
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
      # Re-arm (D-10): a re-compaction on this same sid overwrites the handoff
      # file above; a stale consumed-marker from a PRIOR read would leave the
      # gate disarmed for the new content. Delete it before emitting the
      # pointer so the gate re-arms.
      rm -f "$OMT_DIR/handoff-consumed-${SESSION_ID}"
      HANDOFF="CRITICAL [COMPACTION HANDOFF -- full continuation record on disk]

Your context was just compacted. The COMPLETE session handoff (original request verbatim, the full arc of decisions/rejections/Q&A, exact stopping point, and all user messages) is on disk. Run this command NOW, BEFORE ANY OTHER ACTION:
  cat \"\$OMT_DIR/handoff-\$OMT_SESSION_ID.md\"
(\$OMT_DIR and \$OMT_SESSION_ID are set in CLAUDE_ENV_FILE exported by this hook.)
It is your only memory of this session -- do not trust your recollection of prior turns. Reconstructing it from memory is NOT reading it.

CRITICAL -- three exact rationalizations precede skipping this read. None of them holds:
| Thought | Reality |
|---|---|
| \"The native compaction summary already covers this\" | The summary is compacted, lossy prose -- it does not substitute for the full on-disk record |
| \"Only the new part since the last compaction is needed\" | The full handoff is needed, not a partial slice -- prior arc and decisions are required context |
| \"Reading the whole file wastes tokens\" | Skipping it to save tokens costs far more later, recovering context lost through repeated back-and-forth |"
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
  MESSAGES="$MESSAGES<session-restore>\n\n[PENDING TASKS DETECTED]\n\nYou have incomplete tasks from a previous session.\nPlease continue working on these tasks.\n\n</session-restore>\n\n---\n\n"
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

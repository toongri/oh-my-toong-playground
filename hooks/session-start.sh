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
LEDGER_ACUTE_INLINE=""

# Ledger recording instruction (plan TODO 3, D2/D3): every session, regardless
# of source, reminds the agent to durable-record decisions/corrections/next-
# steps to the session ledger AS IT WORKS, instead of relying on a stale
# end-of-session summary. Static text only -- no session-varying values, so
# this stays cache-safe (prefix-invariant) across every session.
# omt-hook-dep: omt-ledger.sh
RECORDING_INSTRUCTION="<session-recording>\n\n[LEDGER RECORDING]\n\nRecord decisions, user corrections, and next-steps to the durable session ledger AS YOU WORK -- do not wait until the end of the session. Ledger sections are append-only, except Now, which the now subcommand replaces with the latest current-state summary.\n\nAppend content (piped via stdin) to a section:\n  <content> | .claude/hooks/omt-ledger.sh append Decisions\n  <content> | .claude/hooks/omt-ledger.sh append Pending\n\nReplace the current-state summary:\n  <content> | .claude/hooks/omt-ledger.sh now\n\nCRITICAL: record a user correction VERBATIM -- the user's exact original words, never a paraphrase or summary. Paraphrasing a correction silently loses the precise wording that made it a correction. Append verbatim corrections to the User Corrections (verbatim) section.\n\n(\$OMT_DIR and \$OMT_SESSION_ID are set in CLAUDE_ENV_FILE exported by this hook; omt-ledger.sh computes the ledger path internally.)\n\n</session-recording>\n\n---\n\n"
MESSAGES="$MESSAGES$RECORDING_INSTRUCTION"

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

# Ledger GC (plan TODO 5): session-ledger-*.md is durable-append prose, not
# JSON, so is_state_live's .active parsing does not apply -- liveness here is
# mtime-only, using the same ACTIVE_IDLE_TTL SSOT sourced above. The current
# session's ledger is kept unconditionally regardless of mtime age (mirrors
# the sid-skip pattern in the state-GC loop above), since it may be idle
# between appends without being dead.
for ledger_file in "$OMT_DIR"/session-ledger-*.md; do
  [ -f "$ledger_file" ] || continue
  ledger_sid=$(basename "$ledger_file" .md)
  ledger_sid="${ledger_sid#session-ledger-}"
  if [ "$ledger_sid" = "$SESSION_ID" ]; then
    continue
  fi
  ledger_mtime=$(stat -c %Y "$ledger_file" 2>/dev/null || stat -f %m "$ledger_file" 2>/dev/null || true)
  [ -n "$ledger_mtime" ] || continue
  ledger_age=$(( GC_NOW - ledger_mtime ))
  if [ "$ledger_age" -ge "$ACTIVE_IDLE_TTL" ]; then
    rm -f "$ledger_file"
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

# Check for active deep-interview state (session-specific, plan TODO 6). The
# di seed schema (hooks/pre-tool-enforcer.sh) is minimal -- {active,
# started_at, last_touched_at} only, unlike prometheus/goal/qa above which
# also carry .phase (and prometheus/goal carry .plan_path). This block
# therefore mirrors the per-skill restore pattern in a restrained form: an
# active-session re-read instruction only, with no "Phase:" line, since di
# has no phase field to source one from.
if [ -f "$OMT_DIR/deep-interview-active-state-${SESSION_ID}.json" ]; then
  DI_STATE=$(cat "$OMT_DIR/deep-interview-active-state-${SESSION_ID}.json" 2>/dev/null)

  if command -v jq &> /dev/null; then
    DI_ACTIVE=$(echo "$DI_STATE" | jq -r '.active // false' 2>/dev/null)
    if [ "$DI_ACTIVE" = "true" ]; then
      MESSAGES="$MESSAGES<session-restore>\n\n[DEEP-INTERVIEW RESTORED]\n\nYou have an active deep-interview session.\n\nRun this command NOW, before any other action:\n  cat \"\$OMT_DIR/deep-interview-active-state-\$OMT_SESSION_ID.json\"\n(\$OMT_DIR and \$OMT_SESSION_ID are set in CLAUDE_ENV_FILE exported by this hook.)\nRe-read the state to determine where you left off, then continue the deep-interview session.\n\n</session-restore>\n\n---\n\n"
    fi
  fi
fi

# Compaction recovery, option D (plan TODO 4, D1): when source==compact AND the
# durable session ledger exists on disk, extract ONLY the two acute sections --
# `## Now` (current state) and `## User Corrections (verbatim)` -- and inline
# them directly into additionalContext. The bulk sections (Decisions/Pending/
# Pointers/Learnings) are never inlined; a static pointer+instruction directs
# the agent to `cat` the full ledger on demand. This replaces the prior
# forced-reread compaction pointer: the PR#158 postmortem showed hiding the
# important part behind a read is what got skipped, so the acute part is
# inlined instead.
#
# The extracted acute text is untrusted ledger prose (may contain quotes,
# backslashes, verbatim user corrections) and is kept in a SEPARATE variable
# (NOT MESSAGES), encoded later via the surgical jq -Rs path -- mirroring how
# the prior compaction fragment was kept out of the sed-escaped restore body.
if command -v jq &> /dev/null && [ "$SOURCE" = "compact" ]; then
  LEDGER_FILE_D="$OMT_DIR/session-ledger-${SESSION_ID}.md"
  if [ -f "$LEDGER_FILE_D" ]; then
    # Section boundaries are the 6 known skeleton headers consumed in their fixed
    # order (idx walks the sequence), NOT any `## ` line -- so a `## ` markdown
    # subheader INSIDE an acute section's content does not truncate the extract
    # (F1), and a header-shaped line injected into a bulk section is never
    # mistaken for the real acute header (S5). A line is a structural header only
    # when it equals the next-expected header H[idx].
    LEDGER_ACUTE=$(awk '
      BEGIN {
        n = split("## Now|## Decisions|## User Corrections (verbatim)|## Pending|## Pointers|## Learnings", H, "|")
        idx = 1
      }
      (idx <= n && $0 == H[idx]) {
        idx++
        keep = ($0 == "## Now" || $0 == "## User Corrections (verbatim)")
        if (keep) print
        next
      }
      keep { print }
    ' "$LEDGER_FILE_D")

    MESSAGES="$MESSAGES<session-restore>\n\n[LEDGER RECOVERY -- compaction]\n\nYour context was just compacted. The durable session ledger on disk is the source of truth for this session.\n\nBulk sections (Decisions/Pending/Pointers/Learnings): run this command NOW, before any other action:\n  cat \"\$OMT_DIR/session-ledger-\$OMT_SESSION_ID.md\"\n(\$OMT_DIR and \$OMT_SESSION_ID are set in CLAUDE_ENV_FILE exported by this hook.)\nResume from the \`## Now\` section.\n\n"

    # additionalContext is capped ~10k chars; reuse the existing 7000-char inline
    # cap (see the incomplete-todos/prometheus/goal pointer sections above) as the
    # acute-vs-pointer threshold. Over cap: skip the inline, rely on the cat pointer above.
    if [ -n "$LEDGER_ACUTE" ] && [ "${#LEDGER_ACUTE}" -le 7000 ]; then
      MESSAGES="${MESSAGES}[Now + User Corrections, inlined below]\n\n"
      LEDGER_ACUTE_INLINE="$LEDGER_ACUTE"
    else
      MESSAGES="${MESSAGES}[Now + User Corrections exceed the inline cap -- read them via the cat command above.]\n\n"
    fi

    MESSAGES="${MESSAGES}</session-restore>\n\n---\n\n"
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

# Output message if we have any restore content OR an inlined ledger acute fragment.
if [ -n "$MESSAGES" ] || [ -n "$LEDGER_ACUTE_INLINE" ]; then
  # Escape for JSON
  MESSAGES_ESCAPED=$(echo "$MESSAGES" | sed 's/"/\\"/g')
  # Surgically encode the untrusted ledger acute fragment to a JSON-safe string body:
  # jq -Rs emits a quoted JSON string; strip the outer quotes so it concatenates
  # onto the sed-escaped restore body inside the single additionalContext value.
  LEDGER_ACUTE_INLINE_ESCAPED=$(printf '%s' "$LEDGER_ACUTE_INLINE" | jq -Rs . | sed '1s/^"//; $s/"$//')
  echo "{\"continue\": true, \"hookSpecificOutput\": {\"hookEventName\": \"SessionStart\", \"additionalContext\": \"$MESSAGES_ESCAPED$LEDGER_ACUTE_INLINE_ESCAPED\"}}"
else
  echo '{"continue": true}'
fi
exit 0

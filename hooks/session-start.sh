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

# Export OMT_SESSION_ID via Claude env file
if [ -n "$CLAUDE_ENV_FILE" ]; then
  echo "export OMT_SESSION_ID=\"$SESSION_ID\"" >> "$CLAUDE_ENV_FILE"
fi

MESSAGES=""

# Ledger recording (every source) + compaction recovery (source==compact),
# delegated to the shared cross-platform core (plan TODO 4: codex-ledger-
# parity) so Claude and Codex emit identical ledger text from ONE
# implementation. hooks/ledger-core.sh's Claude branch is byte-identical to
# the pre-delegation inline text this call replaces. The result is
# pre-escaped and spliced in ahead of MESSAGES at final-output time (below),
# so it lands first in additionalContext -- matching where the recording
# instruction always sat (it fires on every source, unlike the restore
# blocks further down which are conditional on active state).
# omt-hook-dep: ledger-core.sh
source "$SCRIPT_DIR_SS/ledger-core.sh"

# ledger-core.sh's stdin sid fallback (its 3rd precedence tier, used when
# neither OMT_SESSION_ID nor CODEX_THREAD_ID is set in the environment --
# the common case here, since CLAUDE_ENV_FILE is read by the harness AFTER
# this hook exits, not during it) reads ONLY `.session_id` (snake_case).
# Claude Code's actual SessionStart stdin uses `.sessionId` (camelCase) --
# see the jq filter at the very top of this file, which already handles
# both forms into $SESSION_ID. Feed ledger_core_run a copy of stdin with
# `.session_id` normalized to that already-resolved value, so its fallback
# tier works for Claude's real stdin shape instead of always falling
# through to the empty-sid refusal.
LEDGER_CORE_INPUT="$INPUT"
if command -v jq &> /dev/null; then
  LEDGER_CORE_INPUT=$(printf '%s' "$INPUT" | jq --arg sid "$SESSION_ID" '.session_id = $sid' 2>/dev/null) || LEDGER_CORE_INPUT="$INPUT"
fi

# Run in a subshell with OMT_SESSION_ID/CODEX_THREAD_ID cleared: this hook's
# own stdin (normalized above into $SESSION_ID) is ALWAYS the authoritative
# identity for its own SessionStart invocation -- ledger_core_run's env-first
# precedence exists for later, separate omt-ledger.sh CLI calls the agent
# makes via CLAUDE_ENV_FILE, not for this hook's own delegated call. Clearing
# them here (subshell-local; nothing outside this command substitution is
# affected) stops a stale/inherited OMT_SESSION_ID from shadowing the
# resolved stdin sid.
LEDGER_CORE_OUT=$(
  unset OMT_SESSION_ID CODEX_THREAD_ID
  printf '%s' "$LEDGER_CORE_INPUT" | ledger_core_run claude
)
LEDGER_DELEGATED_ESCAPED=""
if [ -n "$LEDGER_CORE_OUT" ]; then
  # Extract the already-escaped additionalContext value verbatim (no
  # decode/re-encode) from ledger-core.sh's own JSON output template
  # (`"additionalContext": "...."}}`, hooks/ledger-core.sh:205) via plain
  # prefix/suffix stripping -- re-escaping it here would double-escape the
  # quotes/backslashes ledger-core.sh's own sed/jq -Rs pipeline already
  # produced.
  LEDGER_DELEGATED_ESCAPED="${LEDGER_CORE_OUT#*\"additionalContext\": \"}"
  # Suffix pattern held in a variable: a literal `}}` typed directly inside
  # ${var%pattern} would close the expansion early (brace-matching reads the
  # first unescaped `}` as the expansion's own terminator), silently leaving
  # the trailing `"}}` un-stripped.
  _lc_suffix='"}}'
  LEDGER_DELEGATED_ESCAPED="${LEDGER_DELEGATED_ESCAPED%$_lc_suffix}"
fi

# GC: reap dead state files for the managed prefixes.
# Liveness defined by hooks/lib/state-liveness.sh (ACTIVE_IDLE_TTL=6h, TERMINAL_TTL=30m).
# The current session's state is always kept regardless of age.
source "$SCRIPT_DIR_SS/lib/state-liveness.sh"
GC_NOW=$(date +%s)
# reap_dead_state_files echoes affected paths on both modes (plan TODO 3) --
# this hook's own stdout must stay session-invariant, so discard it here.
reap_dead_state_files "$OMT_DIR" "$SESSION_ID" "$GC_NOW" 0 > /dev/null

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

# GC: reap dead session-scoped artifacts (plan TODO 3: SessionStart artifact
# GC + drift report), via the same shared liveness helper sourced above.
# Must run after the ledger GC lane above, not before -- both consume $OMT_DIR
# state, and this is the artifact lane's assigned position. Discard stdout for
# the same reason as reap_dead_state_files above.
#
# Fail-open when identity could not be resolved: SESSION_ID falls back to the
# literal "default" sentinel above (:21-23) whenever jq is absent or the
# payload carried no sessionId. In that case this hook cannot tell its OWN
# running session's artifacts apart from any other session's -- reap_session_
# artifacts' is_current_session protection silently stops protecting the real
# running session once its filename no longer matches "default". Running the
# reaper anyway would destroy that session's own artifacts under the wrong
# identity the moment their live-state backing (a STATE_PREFIXES file) has
# aged out -- and the destroyed artifact can be exactly what a completion
# gate reads (e.g. {goal,ultragoal}-codereview-{sid}.json). Skip instead:
# jq-less accumulation is recoverable later via scripts/omt-cleanup/, while a
# destructive reap under a wrong identity is not. This mirrors CLAUDE.md's
# documented jq-absence contract ("fail open (no guard) when it is absent").
# reap_dead_state_files above is NOT similarly guarded: it predates this
# artifact lane, is not a regression, and each state file also carries its
# own is_state_live liveness check independent of session identity.
if [ "$SESSION_ID" = "default" ]; then
  echo "session-start.sh: skipping session-artifact GC -- SESSION_ID could not be resolved (jq absent or no sessionId in payload); reaping without a real identity risks deleting this session's own artifacts" >&2
else
  reap_session_artifacts "$OMT_DIR" "$SESSION_ID" "$GC_NOW" 0 > /dev/null
fi

# Drift report: unclassified session-keyed files are never reaped, only
# surfaced -- one line per file, prefixed to identify it as an unclassified
# session file. Routed to stderr, not stdout: this hook's stdout is injected
# into the conversation prefix and must stay session-invariant (cache-safe
# context injection contract) -- a per-session file list is the definition of
# prefix-variable content.
list_unclassified_session_files "$OMT_DIR" | sed 's/^/session-start.sh: unclassified session file: /' >&2

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

# The legacy goal skill has been removed. Preserve any state from this session
# outside the scanned top-level state namespace instead of reviving it. Reserve
# the destination with noclobber before rename so an existing archive is never
# replaced; `mv` then performs an atomic same-filesystem move into retired/.
retire_legacy_goal_state() {
  local max_suffix=31
  local source="$OMT_DIR/goal-state-${SESSION_ID}.json"
  local retired_dir="$OMT_DIR/retired"
  local suffix=0
  local archive=""

  [ -f "$source" ] || return 0
  if ! mkdir -p "$retired_dir"; then
    echo "session-start.sh: could not create retired directory for legacy goal-state" >&2
    return 0
  fi

  while [ "$suffix" -le "$max_suffix" ]; do
    archive="$retired_dir/goal-state-${SESSION_ID}.retired-${suffix}.json"
    if (set -C; : > "$archive") 2>/dev/null; then
      if mv "$source" "$archive"; then
        echo "session-start.sh: retired legacy goal-state" >&2
      else
        echo "session-start.sh: could not retire legacy goal-state" >&2
        rm -f "$archive" 2>/dev/null || true
      fi
      return 0
    fi
    if [ ! -e "$archive" ]; then
      echo "session-start.sh: could not create legacy goal-state archive" >&2
      return 0
    fi
    suffix=$((suffix + 1))
  done

  echo "session-start.sh: legacy goal-state archive suffix limit reached" >&2
}

retire_legacy_goal_state

# Check for active ultragoal state (session-specific). ultragoal shares GoalState's
# exact JSON shape (UltragoalState = GoalState in lib/state-core.ts), so this
# remains its own restore path while legacy goal-state files are retired above.
if [ -f "$OMT_DIR/ultragoal-state-${SESSION_ID}.json" ]; then
  ULTRAGOAL_STATE=$(cat "$OMT_DIR/ultragoal-state-${SESSION_ID}.json" 2>/dev/null)

  if command -v jq &> /dev/null; then
    ULTRAGOAL_ACTIVE=$(echo "$ULTRAGOAL_STATE" | jq -r '.active // false' 2>/dev/null)
    if [ "$ULTRAGOAL_ACTIVE" = "true" ]; then
      ULTRAGOAL_PHASE=$(echo "$ULTRAGOAL_STATE" | jq -r '.phase // ""' 2>/dev/null)

      # Pristine-seed guard: a freshly seeded state (phase=planning, iteration=0,
      # outcome="" or absent) is inert — it may be an orphan from a refused ultragoal
      # invocation. Skip the restore block; GC reaps the orphan by TTL.
      ULTRAGOAL_ITERATION_RAW=$(echo "$ULTRAGOAL_STATE" | jq -r '.iteration // 0' 2>/dev/null)
      ULTRAGOAL_OUTCOME_RAW=$(echo "$ULTRAGOAL_STATE" | jq -r '.outcome // ""' 2>/dev/null)
      ULTRAGOAL_IS_PRISTINE=false
      if [ "$ULTRAGOAL_PHASE" = "planning" ] && [ "$ULTRAGOAL_ITERATION_RAW" = "0" ] && [ "$ULTRAGOAL_OUTCOME_RAW" = "" ]; then
        ULTRAGOAL_IS_PRISTINE=true
      fi

      if [ "$ULTRAGOAL_IS_PRISTINE" = "false" ]; then
        ULTRAGOAL_PLAN_PATH=$(echo "$ULTRAGOAL_STATE" | jq -r '.plan_path // ""' 2>/dev/null)

        # Determine whether the plan file is available on disk.
        ULTRAGOAL_PLAN_AVAILABLE=false
        if [ -n "$ULTRAGOAL_PLAN_PATH" ] && [ "$ULTRAGOAL_PLAN_PATH" != "null" ] && [ -f "$ULTRAGOAL_PLAN_PATH" ]; then
          ULTRAGOAL_PLAN_AVAILABLE=true
        fi

        ULTRAGOAL_INSTRUCTION=""
        if [ "$ULTRAGOAL_PHASE" = "planning" ]; then
          # Planning-resume: guide the AI to continue co-designing the plan
          if [ "$ULTRAGOAL_PLAN_AVAILABLE" = "true" ]; then
            ULTRAGOAL_INSTRUCTION="\nRe-read the current plan from disk and continue the planning process where you left off.\n"
          else
            ULTRAGOAL_INSTRUCTION="\nNo plan file on disk yet. Continue planning from the state you just read above — resume from its resume_summary checkpoint if present, otherwise begin planning afresh.\n"
          fi
        else
          # Pursuing-resume: guide the AI to continue autonomous pursuit
          ULTRAGOAL_INSTRUCTION="\nContinue pursuing the objective autonomously.\n"
          if [ "$ULTRAGOAL_PLAN_AVAILABLE" = "true" ]; then
            ULTRAGOAL_INSTRUCTION="${ULTRAGOAL_INSTRUCTION}Re-read the current plan from disk before continuing.\n"
          fi
        fi

        MESSAGES="$MESSAGES<session-restore>\n\n[ULTRAGOAL RESTORED]\n\nYou have an active ultragoal session (phase: $ULTRAGOAL_PHASE).\n\nRun this command NOW, before any other action:\n  cat \"\$OMT_DIR/ultragoal-state-\$OMT_SESSION_ID.json\"\n(\$OMT_DIR and \$OMT_SESSION_ID are set in CLAUDE_ENV_FILE exported by this hook.)\n$ULTRAGOAL_INSTRUCTION\nIMPORTANT: Invoking the ultragoal skill again while an ultragoal is already active is refused. Continue the existing ultragoal, do not start a new one.\n\n</session-restore>\n\n---\n\n"
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
      QA_PHASE_MAX_RAW=$(echo "$QA_STATE" | jq -r '.phase_max // 0' 2>/dev/null)
      QA_CHAIN_EMPTY=$(echo "$QA_STATE" | jq -r '((.actors // []) | length) == 0 and ((.stories // []) | length) == 0 and ((.cells // []) | length) == 0 and ((.run_checks // {}) | length) == 0' 2>/dev/null)
      QA_IS_PRISTINE=false
      if [ "$QA_PHASE" = "PRE-FLIGHT" ] && [ "$QA_CYCLE_RAW" = "0" ] && [ "$QA_PHASE_MAX_RAW" = "0" ] && [ "$QA_TARGET_RAW" = "" ] && [ "$QA_CHAIN_EMPTY" = "true" ]; then
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
# started_at, last_touched_at} only, unlike prometheus/qa above which also
# carry .phase (and prometheus carries .plan_path). This block
# therefore mirrors the per-skill restore pattern in a restrained form: an
# active-session re-read instruction only, with no "Phase:" line, since di
# has no phase field to source one from.
#
# The prefix is hardcoded here rather than looked up from state-liveness.sh's
# STATE_PREFIXES: that list is scoped to the GC callers (reap_dead_state_files,
# list_live_session_ids), not to this restore path. Deriving this restore
# path's file name from a list built for a different purpose meant an edit to
# STATE_PREFIXES that dropped or renamed the deep-interview entry silently
# broke deep-interview session restore here -- no error, no stderr, the
# restore block would just never fire. Restore reads and GC writes are
# different concerns; each keeps its own literal.
if [ -f "$OMT_DIR/deep-interview-active-state-${SESSION_ID}.json" ]; then
  DI_STATE=$(cat "$OMT_DIR/deep-interview-active-state-${SESSION_ID}.json" 2>/dev/null)

  if command -v jq &> /dev/null; then
    DI_ACTIVE=$(echo "$DI_STATE" | jq -r '.active // false' 2>/dev/null)
    if [ "$DI_ACTIVE" = "true" ]; then
      MESSAGES="$MESSAGES<session-restore>\n\n[DEEP-INTERVIEW RESTORED]\n\nYou have an active deep-interview session.\n\nRun this command NOW, before any other action:\n  cat \"\$OMT_DIR/deep-interview-active-state-\$OMT_SESSION_ID.json\"\n(\$OMT_DIR and \$OMT_SESSION_ID are set in CLAUDE_ENV_FILE exported by this hook.)\nRe-read the state to determine where you left off, then continue the deep-interview session.\n\n</session-restore>\n\n---\n\n"
    fi
  fi
fi

# Compaction recovery (source==compact, ledger present) is now handled by the
# ledger_core_run delegation above -- see the LEDGER_DELEGATED_ESCAPED block
# near the top of this file.

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

# Output message if we have any restore content OR delegated ledger content.
if [ -n "$MESSAGES" ] || [ -n "$LEDGER_DELEGATED_ESCAPED" ]; then
  # Escape for JSON
  MESSAGES_ESCAPED=$(echo "$MESSAGES" | sed 's/"/\\"/g')
  # LEDGER_DELEGATED_ESCAPED is already JSON-string-escaped (see above) --
  # prepend it as-is, ahead of MESSAGES_ESCAPED.
  echo "{\"continue\": true, \"hookSpecificOutput\": {\"hookEventName\": \"SessionStart\", \"additionalContext\": \"$LEDGER_DELEGATED_ESCAPED$MESSAGES_ESCAPED\"}}"
else
  echo '{"continue": true}'
fi
exit 0

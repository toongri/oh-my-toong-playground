#!/bin/bash
# =============================================================================
# oh-my-toong State Liveness Predicate
# Shared bash helper for both GC callers (session-start.sh, omt-cleanup.sh).
# Compatible with macOS Bash 3.2.
# =============================================================================
#
# TTL constants — the ONLY definition site for bash; TS definition site is
# lib/state-core.ts. Tests assert pairwise equality between both files.
ACTIVE_IDLE_TTL=21600   # 6 hours — active session idle window
TERMINAL_TTL=1800       # 30 minutes — terminal (active:false) grace period

# is_state_live <file> <now_epoch>
#
# Returns:
#   exit 0  — state is live (keep)
#   exit 1  — state is dead (reap)
#
# Single liveness rule (from plan line 30):
#   live iff (active && age < ACTIVE_IDLE_TTL) or (!active && age < TERMINAL_TTL)
#   where age = now - last_touched_at
#   Fallback chain for touched: last_touched_at -> started_at -> file mtime
#   Clock skew (touched > now): clamp age to 0 (treat as live), never error.
is_state_live() {
  local file="$1"
  local now_epoch="$2"

  if [ ! -f "$file" ]; then
    return 1
  fi

  # ---------------------------------------------------------------------------
  # Parse .active field
  # Dual-path: jq (preferred) → grep fallback (for environments without jq)
  # ---------------------------------------------------------------------------
  local active_val
  active_val=$(jq -r '.active // "absent"' "$file" 2>/dev/null) || active_val="absent"

  if [ "$active_val" = "absent" ] || [ "$active_val" = "null" ] || [ -z "$active_val" ]; then
    # jq absent or failed — grep fallback
    if grep -q '"active"[[:space:]]*:[[:space:]]*true' "$file" 2>/dev/null; then
      active_val="true"
    elif grep -q '"active"[[:space:]]*:[[:space:]]*false' "$file" 2>/dev/null; then
      active_val="false"
    else
      active_val="true"   # default: treat missing active as active (safer)
    fi
  fi

  # ---------------------------------------------------------------------------
  # Parse touched timestamp: last_touched_at -> started_at -> file mtime
  # Reuses the exact parse idiom from session-start.sh:80-101
  # ---------------------------------------------------------------------------
  local touched_epoch=""

  # Try last_touched_at first
  local ts
  ts=$(jq -r '.last_touched_at // ""' "$file" 2>/dev/null) || ts=""
  if [ -z "$ts" ] || [ "$ts" = "null" ]; then
    ts=""
  fi

  # Fallback to started_at
  if [ -z "$ts" ]; then
    ts=$(jq -r '.started_at // ""' "$file" 2>/dev/null) || ts=""
    if [ -z "$ts" ] || [ "$ts" = "null" ]; then
      ts=""
    fi
  fi

  if [ -n "$ts" ]; then
    # Parse ISO 8601 (strip timezone). BSD date (macOS) is the deploy target;
    # GNU date -d is the Linux/CI fallback. Mirrors session-start.sh:84-85.
    local time_part
    time_part=$(printf '%s' "$ts" | sed -E 's/(Z|[+-][0-9]{2}:[0-9]{2})$//')
    touched_epoch=$(date -j -f "%Y-%m-%dT%H:%M:%S" "$time_part" "+%s" 2>/dev/null \
      || date -d "$time_part" "+%s" 2>/dev/null \
      || true)
  fi

  if [ -z "$touched_epoch" ]; then
    # No parseable timestamp — fall back to file mtime.
    # GNU form (-c %Y) first: GNU `stat -f` means --file-system and prints a
    # non-numeric block to stdout for the file operand, which would defeat the
    # fail-safe below by leaving touched_epoch as non-empty garbage; BSD `stat -c`
    # fails cleanly with no stdout. GNU-first is portable; BSD-first breaks on Linux.
    touched_epoch=$(stat -c %Y "$file" 2>/dev/null || stat -f %m "$file" 2>/dev/null || true)
  fi

  if [ -z "$touched_epoch" ]; then
    # Cannot determine age; treat as live (fail-safe)
    return 0
  fi

  # ---------------------------------------------------------------------------
  # Compute age — clamp negative (clock skew) to 0
  # ---------------------------------------------------------------------------
  local age=$(( now_epoch - touched_epoch ))
  if [ "$age" -lt 0 ]; then
    age=0
  fi

  # ---------------------------------------------------------------------------
  # Apply the Single liveness rule
  # ---------------------------------------------------------------------------
  if [ "$active_val" = "true" ]; then
    if [ "$age" -lt "$ACTIVE_IDLE_TTL" ]; then
      return 0
    else
      return 1
    fi
  else
    # active:false — terminal state
    if [ "$age" -lt "$TERMINAL_TTL" ]; then
      return 0
    else
      return 1
    fi
  fi
}

# is_current_session <file> <current_sid>
#
# Returns:
#   exit 0 — the filename's embedded session id equals <current_sid>
#   exit 1 — it does not
#
# The session id is encoded in the filename, e.g.:
#   goal-state-<sid>.json
#   ultragoal-state-<sid>.json
#   prometheus-state-<sid>.json
#   deep-interview-active-state-<sid>.json
#   qa-state-<sid>.json
# We extract it as the portion after the last '-' separator group before '.json'.
is_current_session() {
  local file="$1"
  local current_sid="$2"

  local basename_val
  basename_val=$(basename "$file" .json)

  # Strip the known prefix to extract the session id.
  # Known prefixes (basename without .json):
  #   goal-state-<sid>                         prefix = "goal-state-"
  #   ultragoal-state-<sid>                    prefix = "ultragoal-state-"
  #   prometheus-state-<sid>                   prefix = "prometheus-state-"
  #   deep-interview-active-state-<sid>        prefix = "deep-interview-active-state-"
  #   qa-state-<sid>                           prefix = "qa-state-"
  # Session IDs may themselves contain '-' (e.g. UUIDs), so we MUST strip only
  # the fixed prefix, not everything up to the last '-'.
  local file_sid
  case "$basename_val" in
    goal-state-*)
      file_sid="${basename_val#goal-state-}" ;;
    ultragoal-state-*)
      file_sid="${basename_val#ultragoal-state-}" ;;
    prometheus-state-*)
      file_sid="${basename_val#prometheus-state-}" ;;
    deep-interview-active-state-*)
      file_sid="${basename_val#deep-interview-active-state-}" ;;
    qa-state-*)
      file_sid="${basename_val#qa-state-}" ;;
    *)
      # Unknown prefix — cannot determine sid; treat as different session
      file_sid="" ;;
  esac

  if [ "$file_sid" = "$current_sid" ]; then
    return 0
  else
    return 1
  fi
}

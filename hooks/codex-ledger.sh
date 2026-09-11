#!/bin/bash
# =============================================================================
# codex-ledger.sh
# Codex SessionStart ledger hook (plan TODO 6: codex-ledger-parity).
#
# Thin entry point: reads stdin {source, session_id, cwd}, sources
# ledger-core.sh, and invokes ledger_core_run with the explicit "codex"
# platform signal -- all recording/recovery logic lives in the shared core
# (hooks/ledger-core.sh), not here.
#
# Codex's SessionStart hook contract has no `continue` key (Claude-only), so
# this hook strips it from the core's output and emits ONLY
# {"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": ...}}.
#
# omt-hook-dep: ledger-core.sh
#
# set -euo pipefail is intentionally OMITTED here (mirrors hooks/session-
# start.sh, which shares this same ledger-core.sh and omits it for the same
# reason): the required [LEDGER RECORDING] output must emit unconditionally
# regardless of whether jq is missing, present-and-working, or present-but-
# FAILING (a broken/partial install, arch-mismatch, or PATH-shadowing
# wrapper) -- and a plain `command | jq ...` top-level pipe has no built-in
# immunity to that last case. `CORE_OUT=$(ledger_core_run codex)` below is
# safe under errexit on its own (bash does not propagate errexit into a
# command-substitution subshell unless `inherit_errexit` is explicitly
# enabled, which it is not here), so ledger_core_run's internal jq calls
# (compaction-recovery parsing) can never abort this script before its own
# unconditional terminal `echo` runs. But the emit step immediately below
# re-pipes CORE_OUT through jq at the top level, with no such immunity: if
# that jq exists on PATH but exits non-zero without writing to stdout, the
# pipe itself fails, and set -e would abort the whole script before the
# marker is ever printed. Dropping set -e turns that into a silent no-op
# instead of a crash -- but the marker survives regardless because the emit
# block below captures the jq transform's success/failure explicitly and
# falls back to the fixed-form sed transform on ANY jq trouble (missing OR
# failing), not just on absence. See hooks/codex-ledger_test.sh for the
# jq-absent, jq-failing, and malformed-stdin regression cases.
# =============================================================================

SCRIPT_DIR_CL="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=hooks/ledger-core.sh
source "$SCRIPT_DIR_CL/ledger-core.sh"

INPUT=$(cat)
EVENT=""
SID=""
CWD=""
RAW_CWD=""
if command -v jq >/dev/null 2>&1; then
  EVENT=$(printf '%s' "$INPUT" | jq -r '.hook_event_name // .hookEventName // empty' 2>/dev/null) || EVENT=""
  RAW_CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null) || RAW_CWD=""
  CWD="$RAW_CWD"
  SID=$(printf '%s' "$INPUT" | jq -r '.session_id // .sessionId // empty' 2>/dev/null) || SID=""
fi
[ -n "$CWD" ] || CWD=$(pwd)
# Codex's thread identity is authoritative over a stale Claude carrier.
[ -n "${CODEX_THREAD_ID:-}" ] && SID="$CODEX_THREAD_ID"
case "$SID" in
  ''|default|*[!A-Za-z0-9_-]*) SID="" ;;
esac
[ "${#SID}" -le 200 ] || SID=""

PENDING_DIR="${OMT_DIR:-}"
if [ -z "$PENDING_DIR" ] && [ -n "$CWD" ]; then
  PENDING_DIR=$(unset OMT_DIR; resolve_omt_dir "$CWD" 2>/dev/null) || PENDING_DIR=""
fi
PENDING=""
[ -n "$PENDING_DIR" ] && [ -n "$SID" ] && PENDING="$PENDING_DIR/codex-ledger-pending-$SID"
LOCK="${PENDING}.write-lock"
CLAIM="${PENDING}.claim"
CLAIM_TOKEN=""
_BRIDGE_LOCK_HELD=0
_BRIDGE_LOCK_TOKEN=""

bridge_lock() {
  local i=0
  while ! mkdir "$LOCK" 2>/dev/null; do
    # A killed producer/acknowledger may leave the lease directory behind.
    # Reclaim only when its recorded owner is demonstrably gone.
    _lock_pid=$(awk '{print $1}' "$LOCK/owner" 2>/dev/null)
    if [ -n "$_lock_pid" ] && ! kill -0 "$_lock_pid" 2>/dev/null; then
      rm -rf "$LOCK" 2>/dev/null || true
      continue
    fi
    i=$((i + 1))
    if [ "$i" -ge 40 ]; then
      echo "codex-ledger: pending marker lock contention" >&2
      return 75
    fi
    sleep 0.01 2>/dev/null || return 75
  done
  _BRIDGE_LOCK_TOKEN="$$"
  printf '%s %s\n' "$$" "$(date +%s 2>/dev/null || printf '0')" > "$LOCK/owner" 2>/dev/null || true
  _BRIDGE_LOCK_HELD=1
  return 0
}

bridge_unlock() {
  [ "$_BRIDGE_LOCK_HELD" = 1 ] || return 0
  if [ -f "$LOCK/owner" ] && [ "$(awk '{print $1}' "$LOCK/owner" 2>/dev/null)" = "$_BRIDGE_LOCK_TOKEN" ]; then
    rm -f "$LOCK/owner" 2>/dev/null || true
    rmdir "$LOCK" 2>/dev/null || true
  fi
  _BRIDGE_LOCK_HELD=0
  _BRIDGE_LOCK_TOKEN=""
}

bridge_cleanup_claim() {
  if [ -n "$CLAIM_TOKEN" ] && [ -f "$CLAIM/owner" ] && grep -q "^$$ .* $CLAIM_TOKEN$" "$CLAIM/owner" 2>/dev/null; then
    rm -rf "$CLAIM" 2>/dev/null || true
  fi
}
bridge_cleanup() { bridge_cleanup_claim; bridge_unlock; }
trap bridge_cleanup EXIT

# PostCompact has no context-bearing output contract. Record a compact token
# for the next reliable event; the generation includes the creation time and
# pid so consumers can compare the exact token they claimed.
if [ "$EVENT" = "PostCompact" ]; then
  if [ -n "$PENDING" ] && [ -n "$RAW_CWD" ]; then
    mkdir -p "$PENDING_DIR" 2>/dev/null || true
    if bridge_lock; then
      if [ ! -f "$PENDING" ]; then
        _pending_tmp="$PENDING.tmp.$$"
        printf '%s\n%s\n%s\n' "$(date +%s 2>/dev/null || printf '0')-$$" "$SID" "$CWD" > "$_pending_tmp" 2>/dev/null && mv -f "$_pending_tmp" "$PENDING" 2>/dev/null || rm -f "$_pending_tmp"
      else
        # A second compaction during recovery is retained for the next event.
        _pending_tmp="$PENDING.next.$$"
        printf '%s\n%s\n%s\n' "$(date +%s 2>/dev/null || printf '0')-$$" "$SID" "$CWD" > "$_pending_tmp" 2>/dev/null && mv -f "$_pending_tmp" "$PENDING.next" 2>/dev/null || rm -f "$_pending_tmp"
      fi
      bridge_unlock
    else
      exit 75
    fi
  fi
  exit 0
fi

# Claiming is mkdir-based and therefore atomic on the local filesystem. The
# marker remains until output construction succeeds; a failed recovery is
# retryable. A .next marker written by PostCompact during recovery is promoted
# after success, so that compaction is not lost while a consumer is running.
RECOVERY_INPUT="$INPUT"
RECOVERY_EVENT=""
if [ "$EVENT" = "SessionStart" ] || [ "$EVENT" = "UserPromptSubmit" ] || [ "$EVENT" = "PostToolUse" ]; then
  if [ -n "$PENDING" ] && [ -f "$PENDING" ]; then
    _pending_claimed=0
    _claim_live=0
    if bridge_lock; then
      if [ -d "$CLAIM" ]; then
        _claim_pid=$(awk '{print $1}' "$CLAIM/owner" 2>/dev/null)
        if [ -n "$_claim_pid" ] && kill -0 "$_claim_pid" 2>/dev/null; then
          bridge_unlock
          _claim_live=1
        else
          rm -rf "$CLAIM" 2>/dev/null || true
          _claim_pid=""
        fi
      fi
    else
      exit 75
    fi
    if [ "$_claim_live" = 0 ] && mkdir "$CLAIM" 2>/dev/null; then
      _pending_claimed=1
      _pending_token=$(sed -n '1p' "$PENDING" 2>/dev/null)
      _pending_sid=$(sed -n '2p' "$PENDING" 2>/dev/null)
      _pending_cwd=$(sed -n '3p' "$PENDING" 2>/dev/null)
      _pending_now=$(date +%s 2>/dev/null || printf '0')
      CLAIM_TOKEN="$_pending_token"
      printf '%s %s %s\n' "$$" "$_pending_now" "$CLAIM_TOKEN" > "$CLAIM/owner" 2>/dev/null || true
      _pending_when=${_pending_token%%-*}
      _pending_valid=1
      case "$_pending_when" in ''|*[!0-9]*) _pending_valid=0 ;; esac
      [ "$_pending_sid" = "$SID" ] || _pending_valid=0
      [ "$_pending_cwd" = "$CWD" ] || _pending_valid=0
      [ "$_pending_when" != 0 ] && [ "$_pending_now" -ge "$_pending_when" ] && [ $((_pending_now - _pending_when)) -le 21600 ] || _pending_valid=0
      if [ "$_pending_valid" = 1 ] && command -v jq >/dev/null 2>&1; then
        RECOVERY_INPUT=$(printf '%s' "$INPUT" | jq -c --arg sid "$SID" --arg cwd "$CWD" '.source="compact" | .session_id=$sid | .cwd=$cwd' 2>/dev/null) || RECOVERY_INPUT=""
        [ -n "$RECOVERY_INPUT" ] && RECOVERY_EVENT="$EVENT"
      fi
      if [ "$_pending_valid" != 1 ] || [ -z "$RECOVERY_EVENT" ]; then
        bridge_unlock
        bridge_cleanup_claim
        [ "$_pending_valid" != 1 ] && rm -f "$PENDING" 2>/dev/null || true
        _pending_claimed=0
      else
        bridge_unlock
      fi
    fi
  fi
fi

# Prompt/tool hooks are a recovery bridge only. Without a claimed pending
# token they must be completely silent; SessionStart retains the historical
# recording behavior through ledger_core_run below.
if [ "$EVENT" = "UserPromptSubmit" ] || [ "$EVENT" = "PostToolUse" ]; then
  [ -n "$RECOVERY_EVENT" ] || exit 0
fi

# Run in a subshell with ONLY OMT_SESSION_ID cleared (CODEX_THREAD_ID is
# deliberately preserved): OMT_SESSION_ID is Claude-only (delivered via
# CLAUDE_ENV_FILE, which does not exist on Codex), so any value seen here is
# always either absent or a stale leak from a parent process -- e.g. a Claude
# session that spawned this Codex invocation. ledger_core_run's env-first sid
# precedence (OMT_SESSION_ID ?? CODEX_THREAD_ID ?? stdin.session_id) would let
# that leaked value shadow CODEX_THREAD_ID, which IS this session's own
# authoritative self-identity on Codex, causing compaction recovery to read
# ANOTHER session's ledger. Unlike hooks/session-start.sh's twin (which clears
# both vars because Claude's authoritative identity is stdin.session_id and
# neither env var is authoritative there), CODEX_THREAD_ID must stay set here
# or sid resolution falls through to stdin.session_id, which is often empty
# for Codex and would break the ledger entirely. Subshell-local; nothing
# outside this command substitution is affected, and stdin (fd 0) is inherited
# through unchanged since no explicit piping is introduced here.
CORE_OUT=$(
  unset OMT_SESSION_ID
  printf '%s' "${RECOVERY_INPUT:-$INPUT}" | ledger_core_run codex
)

if [ -n "$CORE_OUT" ]; then
  # jq is invoked inside an `if` condition so a present-but-failing binary
  # (broken install, arch-mismatch, PATH-shadowing wrapper) is caught here
  # rather than aborting the script -- `if`/`&&` conditions are exempt from
  # errexit regardless of whether it's enabled. On any jq trouble (missing
  # from PATH, or present but failing/producing empty output), fall back to
  # the fixed-form sed transform: ledger_core_run's emit line is always
  # exactly `{"continue": true, "hookSpecificOutput": {...}}`
  # (hooks/ledger-core.sh:205), emitted unconditionally regardless of jq
  # presence, so a plain sed removal of that fixed prefix reproduces
  # `jq -c 'del(.continue)'` without needing a working jq, keeping
  # [LEDGER RECORDING] alive for Codex in every case.
    if command -v jq &> /dev/null && CODEX_OUT=$(printf '%s' "$CORE_OUT" | jq -c 'del(.continue)') && [ -n "$CODEX_OUT" ]; then
    if [ -n "$RECOVERY_EVENT" ]; then
      if CODEX_OUT=$(printf '%s' "$CODEX_OUT" | jq -c --arg event "$RECOVERY_EVENT" '.hookSpecificOutput.hookEventName=$event | del(.continue)') && [ -n "$CODEX_OUT" ]; then
        if printf '%s' "$CODEX_OUT" | jq -e --arg event "$RECOVERY_EVENT" '(.hookSpecificOutput.hookEventName == $event) and ((.hookSpecificOutput.additionalContext // "") | contains("[LEDGER RECOVERY]"))' >/dev/null 2>&1 \
            && [ -r "$PENDING_DIR/session-ledger-$SID.md" ] \
            && [ "${_pending_claimed:-0}" = 1 ] \
            && bridge_lock; then
          _ack_token=$(sed -n '1p' "$PENDING" 2>/dev/null)
          if [ "$_ack_token" = "$_pending_token" ]; then
            # Emit first. If the receiving pipe is closed, retain both the
            # pending token and claim so the next event can retry safely.
            if printf '%s\n' "$CODEX_OUT"; then
              if [ -f "$PENDING.next" ]; then mv -f "$PENDING.next" "$PENDING" 2>/dev/null || true; else rm -f "$PENDING" 2>/dev/null || true; fi
              bridge_unlock
              rm -rf "$CLAIM" 2>/dev/null || true
              CLAIM_TOKEN=""
            else
              bridge_unlock
              bridge_cleanup_claim
            fi
          else
            bridge_unlock
            bridge_cleanup_claim
          fi
        else
          bridge_unlock
          bridge_cleanup_claim
        fi
      else
        bridge_cleanup_claim
      fi
    else
      printf '%s\n' "$CODEX_OUT"
    fi
  else
    if [ -n "$RECOVERY_EVENT" ]; then
      # A broken jq cannot safely construct an envelope: retain the marker.
      bridge_cleanup_claim
    else
      printf '%s' "$CORE_OUT" | sed 's/^{"continue": true, /{/'
    fi
  fi
else
  # Preserve retryability if the shared worker could not construct output.
  [ -z "$RECOVERY_EVENT" ] || rmdir "$PENDING.claim" 2>/dev/null || true
fi

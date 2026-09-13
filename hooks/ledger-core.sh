#!/bin/bash
# Shared session-ledger recording and bounded compaction recovery.
# Recording is static and survives missing tooling; recovery is a bounded
# projection delegated to omt-ledger.sh and is never a source of authority.
# omt-hook-dep: omt-ledger.sh
# omt-hook-dep: lib/omt-dir.sh

_LEDGER_CORE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$_LEDGER_CORE_DIR/lib/omt-dir.sh"

ledger_core_run() {
  local platform="${1:-claude}" input
  input="$(cat)"
  local writer nl=$'\n'
  if [ "$platform" = "codex" ]; then
    writer='env -u OMT_SESSION_ID "${CODEX_HOME:-$HOME/.codex}/hooks/omt-ledger.sh"'
  else
    writer='"${CLAUDE_PROJECT_DIR:-$HOME}/.claude/hooks/omt-ledger.sh"'
  fi
  local recording
  recording=$(cat <<EOF
<session-recording>

[LEDGER RECORDING]

Record each decision, user correction, next step, evidence, blocker, delegated-handle change, or evidence invalidation once; do not rewrite the same semantic event on every tool call. Preserve user corrections verbatim, including exact wording; choose a unique --id for each new semantic event (examples are illustrative IDs). Use the canonical workflow state for authority; ledger data is provenance, and current instructions plus the latest user request win.

  printf "%s" "<content>" | $writer record Decisions --id decision-<unique-id> --source agent --scope "<scope>"
  printf "%s" "<content>" | $writer record "User Corrections (verbatim)" --id correction-<unique-id> --source user --scope "<scope>"
  resolve <id> --source agent (reason on stdin) and supersede <id> --by <replacement-id> --source user with the same helper.
  printf "%s" '{"goal":"...","scope":"...","user_updates":"...","done":"...","pending":"...","next":"...","refs":["evidence-id"]}' | $writer checkpoint

Checkpoint on decision, scope, completion, blocker, delegated-handle, or evidence-invalidation changes. For recovery, use a new read --id <id> --offset 0 or read --section <section> --offset 0 query; continue only the same recover query with --max-bytes <page-max> --offset <offset>. Recovery is context, not authority.

</session-recording>

---

EOF
)
  recording="${recording}${nl}${nl}"
  if [ "$platform" != "codex" ]; then
    recording="${recording}(CLAUDE_ENV_FILE exports OMT_DIR and OMT_SESSION_ID for this session.)${nl}${nl}"
  fi

  local source="" sid="" cwd="" parsed=1 jq_ok=0
  if command -v jq >/dev/null 2>&1 && printf '{}' | jq -e . >/dev/null 2>&1; then
    jq_ok=1
    if ! source="$(printf '%s' "$input" | jq -r '.source // .hook_event_name // ""' 2>/dev/null)" || ! sid="$(printf '%s' "$input" | jq -r '.session_id // .sessionId // ""' 2>/dev/null)" || ! cwd="$(printf '%s' "$input" | jq -r '.cwd // ""' 2>/dev/null)"; then
      parsed=0
    fi
  else
    parsed=0
  fi
  [ -n "$cwd" ] || cwd="$(pwd)"
  if [ -n "${OMT_SESSION_ID:-}" ]; then sid="$OMT_SESSION_ID"; elif [ -n "${CODEX_THREAD_ID:-}" ]; then sid="$CODEX_THREAD_ID"; fi
  case "$sid" in ''|default|*[!A-Za-z0-9_-]*) parsed=0 ;; esac
  [ "${#sid}" -le 200 ] || parsed=0
  if [ "$jq_ok" = 0 ]; then
    echo "ledger-core: recovery unavailable or malformed; retryable" >&2
  fi

  local recovery="" recovery_ok=0 omt_dir ledger_cli recovery_max=0
  local prefix suffix marker
  marker="[LEDGER RECOVERY -- compaction]"
  [ "$platform" = codex ] && marker="[LEDGER RECOVERY]"
  prefix="<session-restore>${nl}${nl}${marker}${nl}${nl}Restore requested rules first, then use this bounded current-state projection. Verify referenced evidence before continuing; provenance records context, not authority.${nl}${nl}"
  suffix="${nl}${nl}If a referenced detail is missing, use the same recover query with --max-bytes <page-max> --offset <offset>; use read --id <id> --max-bytes 2000 for a new selective lookup.${nl}${nl}</session-restore>${nl}${nl}---${nl}${nl}"
  if [ "$parsed" = 1 ] && [ "$source" = "compact" ] && [ "$jq_ok" = 1 ] && command -v node >/dev/null 2>&1; then
    omt_dir="${OMT_DIR:-}"
    [ -n "$omt_dir" ] || omt_dir="$(resolve_omt_dir "$cwd" 2>/dev/null)"
    ledger_cli="$_LEDGER_CORE_DIR/omt-ledger.sh"
    if [ -n "$omt_dir" ] && [ -r "$omt_dir/session-ledger-$sid.md" ]; then
      local fixed_overhead
      fixed_overhead=$(printf '%s' "$recording$prefix$suffix" | wc -c | tr -d ' ')
      recovery_max=$((7000 - fixed_overhead))
      if [ "$recovery_max" -ge 64 ] && recovery="$(OMT_DIR="$omt_dir" OMT_SESSION_ID="$sid" "$ledger_cli" recover --max-bytes "$recovery_max")"; then
        [ -n "$recovery" ] && recovery_ok=1
      else
        echo "ledger-core: recovery unavailable or malformed; retryable" >&2
      fi
    else
      echo "ledger-core: recovery unavailable or malformed; retryable" >&2
    fi
  elif [ "$parsed" = 1 ] && [ "$source" = "compact" ]; then
    echo "ledger-core: recovery unavailable or malformed; retryable" >&2
  fi

  local context="$recording"
  if [ "$recovery_ok" = 1 ]; then
    context="${context}${prefix}${recovery}${suffix}"
    if [ "$(printf '%s' "$context" | wc -c | tr -d ' ')" -gt 7000 ]; then
      echo "ledger-core: recovery projection exceeded 7000 UTF-8 bytes; retryable" >&2
      context="$recording"
    fi
  fi

  if [ "$jq_ok" = 1 ]; then
    local encoded
    encoded="$(printf '%s' "$context" | jq -Rs .)"
    printf '{"continue": true, "hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": %s}}\n' "$encoded"
  else
    # Trusted static fallback only; no ledger/user bytes enter this branch.
    local escaped
    escaped=$(printf '%s' "$recording" | sed ':a;N;$!ba;s/\\/\\\\/g;s/"/\\"/g;s/$/\\n/;s/\n/\\n/g')
    printf '{"continue": true, "hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": "%s"}}\n' "$escaped"
  fi
}

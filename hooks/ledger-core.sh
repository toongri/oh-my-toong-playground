#!/bin/bash
# =============================================================================
# ledger-core.sh
# Shared cross-platform session-ledger recording + compaction-recovery core
# (plan TODO 1: codex-ledger-parity). Sourced by both hooks/session-start.sh
# (Claude) and the Codex SessionStart hook so both harnesses run identical
# recording/recovery logic behind a single entry point, ledger_core_run.
#
# Scope: recording instruction (every source) + compaction recovery
# (source==compact) ONLY. Does NOT own the append/now write logic (stays in
# omt-ledger.sh), the write-guard, or ledger GC (stays in session-start.sh).
#
# Cache-safety: the recording instruction is emitted on EVERY source, i.e. it
# sits in the conversation prefix, so it carries no per-request volatile value
# (timestamp/PID/counter) -- static text only, identical byte-for-byte across
# sessions on a given platform. Recovery output is compaction-triggered, so
# it is exempt (the prefix is already cold after compaction).
#
# omt-hook-dep: omt-ledger.sh
# omt-hook-dep: lib/omt-dir.sh
# =============================================================================

_LEDGER_CORE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=hooks/lib/omt-dir.sh
source "$_LEDGER_CORE_DIR/lib/omt-dir.sh"

# ledger_core_run <platform-signal>
#
# platform-signal: literally "claude" or "codex" -- an EXPLICIT argument
# supplied by the per-platform entry point. Never sniff $CLAUDE_ENV_FILE (or
# any other env var) to infer the platform; the caller states it.
#
# Reads the SessionStart stdin JSON (.source, .session_id, .cwd) on fd 0 and
# writes the SessionStart hook JSON output to stdout.
ledger_core_run() {
  local _lc_platform="$1"

  local _lc_input
  _lc_input=$(cat)

  # Gate jq gracefully -- matches session-start.sh: emit nothing, exit 0.
  if ! command -v jq &> /dev/null; then
    return 0
  fi

  local _lc_source _lc_stdin_sid _lc_cwd
  _lc_source=$(printf '%s' "$_lc_input" | jq -r '.source // ""' 2>/dev/null)
  _lc_stdin_sid=$(printf '%s' "$_lc_input" | jq -r '.session_id // ""' 2>/dev/null)
  _lc_cwd=$(printf '%s' "$_lc_input" | jq -r '.cwd // ""' 2>/dev/null)
  if [ -z "$_lc_cwd" ] || [ "$_lc_cwd" = "null" ]; then
    _lc_cwd=$(pwd)
  fi

  # Shared session-id precedence contract (identical at TODOs 1, 3, 7):
  # OMT_SESSION_ID ?? CODEX_THREAD_ID ?? stdin.session_id, STRICT EMPTY-ONLY
  # coalescing -- present-but-empty falls through to the next candidate;
  # present-but-unsafe REFUSES outright (never falls through once a non-empty
  # candidate is picked). "default" is refused the same as the CLI's own
  # empty/default refusal (hooks/omt-ledger.sh).
  local _lc_sid
  if [ -n "${OMT_SESSION_ID:-}" ]; then
    _lc_sid="$OMT_SESSION_ID"
  elif [ -n "${CODEX_THREAD_ID:-}" ]; then
    _lc_sid="$CODEX_THREAD_ID"
  else
    _lc_sid="$_lc_stdin_sid"
  fi
  case "$_lc_sid" in
    ''|default) return 0 ;;
    *[!A-Za-z0-9_-]*) return 0 ;;
  esac
  [ "${#_lc_sid}" -le 200 ] || return 0

  local _lc_omt_dir
  _lc_omt_dir=$(resolve_omt_dir "$_lc_cwd")

  # -- Recording instruction (every source, cache-safe/static) --------------
  #
  # Claude branch is byte-identical to the pre-extraction hooks/session-start.sh:82
  # text. Codex branch carries the same substance -- static append/now call
  # examples plus the verbatim-correction mandate -- but names the Codex CLI
  # invocation path and never mentions CLAUDE_ENV_FILE or an unexpanded
  # $OMT_DIR/$OMT_SESSION_ID, per the plan's "no agent-visible env leakage"
  # guardrail: those are Claude-only carriers (CLAUDE_ENV_FILE does not exist
  # on Codex), and the recording instruction is prefix-position on every
  # source, so a Codex agent must never see them leaked in from the shared
  # string.
  local _lc_recording
  if [ "$_lc_platform" = "codex" ]; then
    _lc_recording="<session-recording>\n\n[LEDGER RECORDING]\n\nRecord decisions, user corrections, and next-steps to the durable session ledger AS YOU WORK -- do not wait until the end of the session. Ledger sections are append-only, except Now, which the now subcommand replaces with the latest current-state summary.\n\nAppend content (piped via stdin) to a section:\n  <content> | \"\${CODEX_HOME:-\$HOME}/.codex/hooks/omt-ledger.sh\" append Decisions\n  <content> | \"\${CODEX_HOME:-\$HOME}/.codex/hooks/omt-ledger.sh\" append Pending\n\nReplace the current-state summary:\n  <content> | \"\${CODEX_HOME:-\$HOME}/.codex/hooks/omt-ledger.sh\" now\n\nCRITICAL: record a user correction VERBATIM -- the user's exact original words, never a paraphrase or summary. Paraphrasing a correction silently loses the precise wording that made it a correction. Append verbatim corrections to the User Corrections (verbatim) section.\n\n(omt-ledger.sh self-resolves OMT_DIR from git and the session id from OMT_SESSION_ID or CODEX_THREAD_ID; it computes the ledger path internally.)\n\n</session-recording>\n\n---\n\n"
  else
    _lc_recording="<session-recording>\n\n[LEDGER RECORDING]\n\nRecord decisions, user corrections, and next-steps to the durable session ledger AS YOU WORK -- do not wait until the end of the session. Ledger sections are append-only, except Now, which the now subcommand replaces with the latest current-state summary.\n\nAppend content (piped via stdin) to a section:\n  <content> | \"\${CLAUDE_PROJECT_DIR:-\$HOME}/.claude/hooks/omt-ledger.sh\" append Decisions\n  <content> | \"\${CLAUDE_PROJECT_DIR:-\$HOME}/.claude/hooks/omt-ledger.sh\" append Pending\n\nReplace the current-state summary:\n  <content> | \"\${CLAUDE_PROJECT_DIR:-\$HOME}/.claude/hooks/omt-ledger.sh\" now\n\nCRITICAL: record a user correction VERBATIM -- the user's exact original words, never a paraphrase or summary. Paraphrasing a correction silently loses the precise wording that made it a correction. Append verbatim corrections to the User Corrections (verbatim) section.\n\n(\$OMT_DIR and \$OMT_SESSION_ID are set in CLAUDE_ENV_FILE exported by this hook; omt-ledger.sh computes the ledger path internally.)\n\n</session-recording>\n\n---\n\n"
  fi

  local _lc_messages="$_lc_recording"
  local _lc_acute_inline=""

  # -- Compaction recovery (source==compact only) ----------------------------
  if [ "$_lc_source" = "compact" ]; then
    local _lc_ledger_file="$_lc_omt_dir/session-ledger-$_lc_sid.md"
    if [ -f "$_lc_ledger_file" ]; then
      # Extract ONLY the two acute sections (## Now, ## User Corrections
      # (verbatim)) -- lifted from hooks/session-start.sh:330-358, kept
      # bit-identical (including the SENTINEL OMT_ESC:: unescape) since it is
      # a shared contract with the omt-ledger.sh writer (hooks/omt-ledger.sh:
      # escape_line/emit_content). Section boundaries are the 6 known
      # skeleton headers consumed in their fixed order, NOT any "## " line.
      local _lc_acute
      _lc_acute=$(awk '
        function is_skeleton_header(line,    h) {
          for (h = 1; h <= n; h++) if (line == H[h]) return 1
          return 0
        }
        function unescape_line(line,    stripped, count) {
          if (index(line, SENTINEL) != 1) return line
          stripped = line
          count = 0
          while (index(stripped, SENTINEL) == 1) {
            stripped = substr(stripped, length(SENTINEL) + 1)
            count++
          }
          if (count >= 1 && is_skeleton_header(stripped)) return substr(line, length(SENTINEL) + 1)
          return line
        }
        BEGIN {
          SENTINEL = "OMT_ESC::"
          n = split("## Now|## Decisions|## User Corrections (verbatim)|## Pending|## Pointers|## Learnings", H, "|")
          idx = 1
        }
        (idx <= n && $0 == H[idx]) {
          idx++
          keep = ($0 == "## Now" || $0 == "## User Corrections (verbatim)")
          if (keep) print
          next
        }
        keep { print unescape_line($0) }
      ' "$_lc_ledger_file")

      # Recovery pointer is platform-parameterized on the explicit platform
      # signal (never sniffed): claude keeps the env-var-literal form +
      # CLAUDE_ENV_FILE note byte-preserved from session-start.sh; codex
      # points at the already-resolved absolute ledger path with no note.
      local _lc_pointer_block
      if [ "$_lc_platform" = "codex" ]; then
        _lc_pointer_block="  cat \"$_lc_ledger_file\"\n"
      else
        _lc_pointer_block='  cat "$OMT_DIR/session-ledger-$OMT_SESSION_ID.md"\n($OMT_DIR and $OMT_SESSION_ID are set in CLAUDE_ENV_FILE exported by this hook.)\n'
      fi

      _lc_messages="${_lc_messages}<session-restore>\n\n[LEDGER RECOVERY]\n\nYour context was just compacted. The durable session ledger on disk is the source of truth for this session.\n\nBulk sections (Decisions/Pending/Pointers/Learnings): run this command NOW, before any other action:\n${_lc_pointer_block}Resume from the \`## Now\` section.\n\n"

      # additionalContext is capped ~10k chars; reuse the 7000-char inline
      # cap from session-start.sh as the acute-vs-pointer threshold.
      if [ -n "$_lc_acute" ] && [ "${#_lc_acute}" -le 7000 ]; then
        _lc_messages="${_lc_messages}[Now + User Corrections, inlined below]\n\n"
        _lc_acute_inline="$_lc_acute"
      else
        _lc_messages="${_lc_messages}[Now + User Corrections exceed the inline cap -- read them via the cat command above.]\n\n"
      fi

      _lc_messages="${_lc_messages}</session-restore>\n\n---\n\n"
    fi
  fi

  # -- Emit ------------------------------------------------------------------
  local _lc_messages_escaped
  _lc_messages_escaped=$(echo "$_lc_messages" | sed 's/"/\\"/g')
  # Surgically encode the untrusted ledger acute fragment (may contain
  # quotes/backslashes/verbatim user corrections) via jq -Rs, stripping the
  # outer quotes so it concatenates onto the sed-escaped body -- mirrors
  # hooks/session-start.sh's LEDGER_ACUTE_INLINE encoding.
  local _lc_acute_escaped
  _lc_acute_escaped=$(printf '%s' "$_lc_acute_inline" | jq -Rs . | sed '1s/^"//; $s/"$//')

  echo "{\"continue\": true, \"hookSpecificOutput\": {\"hookEventName\": \"SessionStart\", \"additionalContext\": \"$_lc_messages_escaped$_lc_acute_escaped\"}}"
}

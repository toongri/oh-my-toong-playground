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
  ledger_core_run codex
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
    printf '%s\n' "$CODEX_OUT"
  else
    printf '%s' "$CORE_OUT" | sed 's/^{"continue": true, /{/'
  fi
fi

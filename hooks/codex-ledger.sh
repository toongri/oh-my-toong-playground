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

CORE_OUT=$(ledger_core_run codex)

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

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
# =============================================================================

SCRIPT_DIR_CL="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=hooks/ledger-core.sh
source "$SCRIPT_DIR_CL/ledger-core.sh"

CORE_OUT=$(ledger_core_run codex)

if [ -n "$CORE_OUT" ]; then
  if command -v jq &> /dev/null; then
    printf '%s' "$CORE_OUT" | jq -c 'del(.continue)'
  else
    # jq unresolvable via PATH: ledger_core_run's emit line is a FIXED-FORM
    # single-line JSON, always exactly `{"continue": true, "hookSpecificOutput":
    # {...}}` (hooks/ledger-core.sh:191), and the core now emits it
    # unconditionally regardless of jq presence -- so a plain sed removal of
    # that fixed prefix reproduces jq -c 'del(.continue)' without needing jq,
    # keeping [LEDGER RECORDING] alive for Codex even when jq is missing.
    printf '%s' "$CORE_OUT" | sed 's/^{"continue": true, /{/'
  fi
fi

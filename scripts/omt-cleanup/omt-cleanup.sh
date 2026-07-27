#!/bin/bash
# =============================================================================
# omt-cleanup.sh — dry-run-gated ~/.omt session-artifact cleanup
#
# Usage:
#   omt-cleanup.sh              # dry-run (default): report reap candidates; delete nothing
#   omt-cleanup.sh --dry-run    # same as default
#   omt-cleanup.sh --execute    # reap dead state files and dead session artifacts (file-level only — directories are never removed)
#
# Parameterized on $HOME. Tests redirect HOME to a temp fixture.
# macOS Bash 3.2 compatible.
# =============================================================================
set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SCRIPT_DIR_CLEANUP="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=hooks/lib/state-liveness.sh
source "$SCRIPT_DIR_CLEANUP/../../hooks/lib/state-liveness.sh"

OMT_DIR="${HOME}/.omt"
CLEANUP_NOW=$(date +%s)

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

DRY_RUN=1
if [[ "${1:-}" == "--execute" ]]; then
    DRY_RUN=0
fi

if [[ ! -d "$OMT_DIR" ]]; then
    echo "Nothing to do: $OMT_DIR does not exist."
    exit 0
fi

echo "=== omt-cleanup: scanning $OMT_DIR ==="
echo ""

DEAD_STATE_OUT=""
DEAD_ARTIFACTS_OUT=""
UNCLASSIFIED_OUT=""
HAD_REAP_FAILURE=0

# Fan out to every top-level directory. Every classification and liveness
# judgment comes from hooks/lib/state-liveness.sh — this script names no
# directory and enumerates no prefix of its own. The directory being
# processed (never $OMT_DIR itself) is passed as the first argument, per
# each helper's calling convention.
#
# __none__ is passed as the session id: this script runs outside any
# session, so it has no current-session id to supply. __none__ cannot
# suffix-match a real filename, so it protects nothing by identity alone —
# safety instead comes from the artifact reaper independently preserving
# any candidate whose own session id is still live.
for entry_path in "$OMT_DIR"/*/; do
    entry_path="${entry_path%/}"

    # `if ! var=$(cmd); then` (not a bare `var=$(cmd)` statement) is load-bearing
    # under `set -e`: a bare assignment whose command substitution fails would
    # abort the whole fan-out right here, mid-scan, before later directories or
    # the report trailer ever print. Wrapping it in an if-condition is what lets
    # a real reap failure be recorded and the scan still run to completion — the
    # non-zero exit happens once, at the very end, after the full report prints.
    if ! dead_state="$(reap_dead_state_files "$entry_path" __none__ "$CLEANUP_NOW" "$DRY_RUN")"; then
        HAD_REAP_FAILURE=1
    fi
    if [[ -n "$dead_state" ]]; then
        if [[ -n "$DEAD_STATE_OUT" ]]; then
            DEAD_STATE_OUT="${DEAD_STATE_OUT}
${dead_state}"
        else
            DEAD_STATE_OUT="$dead_state"
        fi
    fi

    if ! dead_artifacts="$(reap_session_artifacts "$entry_path" __none__ "$CLEANUP_NOW" "$DRY_RUN")"; then
        HAD_REAP_FAILURE=1
    fi
    if [[ -n "$dead_artifacts" ]]; then
        if [[ -n "$DEAD_ARTIFACTS_OUT" ]]; then
            DEAD_ARTIFACTS_OUT="${DEAD_ARTIFACTS_OUT}
${dead_artifacts}"
        else
            DEAD_ARTIFACTS_OUT="$dead_artifacts"
        fi
    fi

    unclassified="$(list_unclassified_session_files "$entry_path")"
    if [[ -n "$unclassified" ]]; then
        if [[ -n "$UNCLASSIFIED_OUT" ]]; then
            UNCLASSIFIED_OUT="${UNCLASSIFIED_OUT}
${unclassified}"
        else
            UNCLASSIFIED_OUT="$unclassified"
        fi
    fi
done

# Reap-lane label carries mode in its own text: dry-run has deleted nothing
# yet (DELETE), execute already deleted by the time this prints (DELETED).
# Both call sites above already performed the real deletion (or not) inline
# with dry_run's polarity, so this label only decides how the same paths are
# described — it triggers no second scan and no second deletion.
REAP_LABEL="  DELETE  "
if [[ $DRY_RUN -eq 0 ]]; then
    REAP_LABEL="  DELETED "
fi

echo "--- DEAD-STATE (state files to reap) ---"
if [[ -z "$DEAD_STATE_OUT" ]]; then
    echo "  (none)"
else
    while IFS= read -r f; do
        echo "${REAP_LABEL}${f}"
    done <<< "$DEAD_STATE_OUT"
fi

echo ""

echo "--- SESSION-ARTIFACTS (to reap) ---"
if [[ -z "$DEAD_ARTIFACTS_OUT" ]]; then
    echo "  (none)"
else
    while IFS= read -r f; do
        echo "${REAP_LABEL}${f}"
    done <<< "$DEAD_ARTIFACTS_OUT"
fi

echo ""

# Unclassified files are never deleted by this script — REPORT is the only
# label they ever get, in either mode.
echo "--- UNCLASSIFIED (reported, not reaped) ---"
if [[ -z "$UNCLASSIFIED_OUT" ]]; then
    echo "  (none)"
else
    while IFS= read -r f; do
        echo "  REPORT  ${f}"
    done <<< "$UNCLASSIFIED_OUT"
fi

echo ""

if [[ $DRY_RUN -eq 1 ]]; then
    echo "=== dry-run complete — nothing deleted. Pass --execute to reap dead state files and artifacts. ==="
else
    echo "=== done ==="
fi

# A DELETED label does mean the underlying rm succeeded — reap_dead_state_files
# and reap_session_artifacts (hooks/lib/state-liveness.sh) only echo a path to
# stdout after rm -f has actually succeeded; an rm failure is reported on
# stderr as "reap: failed to delete <path>" and never reaches stdout. The exit
# code exists because that stderr-only failure is otherwise invisible to a
# caller that isn't reading stderr: if any reap call failed, this script fails
# too, even though the report above (built from stdout alone) always prints in
# full first.
if [[ $HAD_REAP_FAILURE -eq 1 ]]; then
    exit 1
fi

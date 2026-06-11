#!/bin/bash
# =============================================================================
# omt-cleanup.sh — dry-run-gated ~/.omt residue cleanup
#
# Usage:
#   omt-cleanup.sh              # dry-run (default): list residue + preserved, delete nothing
#   omt-cleanup.sh --dry-run    # same as default
#   omt-cleanup.sh --execute    # delete confirmed-residue entries; preserve live-state/legit
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

# Confirmed-residue names (14 entries from §1 classification table).
# Order matches the 7 slugs + name-based residue.
RESIDUE_NAMES="
capricious-watcher
dented-gold
radical-water
scrawny-peak
medieval-cadmium
frosted-anglerfish
fire-cockroach
oh-my-toong
stage
algocare-home-stage
omt-test
tmp
evidence
toong
"

# ---------------------------------------------------------------------------
# Preserve predicates (by CLASS/PATTERN — no literal UUIDs)
#
# An entry is PRESERVED if any of the following is true:
#   P1 — name starts with "algocare-" (but is NOT "algocare-home-stage" — handled by residue
#        list; the prefix match comes after residue classification)
#   P2 — name is "oh-my-toong-playground"
#   P3 — name is "cache"
#   P4 — directory contains a goal-state-*.json file with "active":true
#   P5 — directory contains a deep-interview-active-state-*.json file
#   P6 — directory contains a prometheus-state-*.json file
# ---------------------------------------------------------------------------

is_residue() {
    local name="$1"
    local n
    for n in $RESIDUE_NAMES; do
        if [[ "$name" == "$n" ]]; then
            return 0
        fi
    done
    return 1
}

has_any_state_file() {
    # Returns 0 (true) iff dir contains at least one state file (live or dead) across the 3 managed prefixes.
    local dir="$1"
    local f
    for f in \
        "$dir"/goal-state-*.json \
        "$dir"/prometheus-state-*.json \
        "$dir"/deep-interview-active-state-*.json; do
        [[ -f "$f" ]] && return 0
    done
    return 1
}

has_live_state() {
    # Returns 0 (true) iff dir contains at least one LIVE state file across the 3 managed prefixes.
    # Liveness is defined by is_state_live from hooks/lib/state-liveness.sh.
    local dir="$1"
    local f
    for f in \
        "$dir"/goal-state-*.json \
        "$dir"/prometheus-state-*.json \
        "$dir"/deep-interview-active-state-*.json; do
        [[ -f "$f" ]] || continue
        if is_state_live "$f" "$CLEANUP_NOW"; then
            return 0
        fi
    done
    return 1
}

is_preserved() {
    local name="$1"
    local dir="$OMT_DIR/$name"

    # P2: current project
    [[ "$name" == "oh-my-toong-playground" ]] && return 0

    # P3: global hud cache
    [[ "$name" == "cache" ]] && return 0

    # P1: algocare-* projects (excluding algocare-home-stage which is in residue list)
    if [[ "$name" == algocare-* ]]; then
        # algocare-home-stage is listed as residue; all other algocare-* are legit
        [[ "$name" == "algocare-home-stage" ]] || return 0
    fi

    # P4/P5/P6: contains at least one LIVE state file (goal, prometheus, or deep-interview)
    has_live_state "$dir" && return 0

    return 1
}

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

DELETE_LIST=""
DEAD_STATE_FILES=""
PRESERVE_LIST=""

# Iterate top-level entries only
for entry_path in "$OMT_DIR"/*/; do
    # Strip trailing slash; get basename
    entry_path="${entry_path%/}"
    name="$(basename "$entry_path")"

    if is_preserved "$name"; then
        PRESERVE_LIST="$PRESERVE_LIST $name"
    elif is_residue "$name"; then
        DELETE_LIST="$DELETE_LIST $name"
    elif has_any_state_file "$OMT_DIR/$name" && ! has_live_state "$OMT_DIR/$name"; then
        # Unknown entry: has state files but ALL are dead — reap only the state files (file-level).
        # The directory is removed afterwards only if it is empty.
        local_dir="$OMT_DIR/$name"
        for f in \
            "$local_dir"/goal-state-*.json \
            "$local_dir"/prometheus-state-*.json \
            "$local_dir"/deep-interview-active-state-*.json; do
            [[ -f "$f" ]] && DEAD_STATE_FILES="$DEAD_STATE_FILES $f"
        done
    else
        # Unknown entry with no state files, or with live state — preserve (conservative)
        PRESERVE_LIST="$PRESERVE_LIST $name"
    fi
done

# Print RESIDUE section (full-directory deletions)
echo "--- RESIDUE (to delete) ---"
if [[ -z "$DELETE_LIST" ]]; then
    echo "  (none)"
else
    for name in $DELETE_LIST; do
        echo "  DELETE  $name"
    done
fi

echo ""

# Print DEAD-STATE section (file-level reap)
echo "--- DEAD-STATE (state files to reap) ---"
if [[ -z "$DEAD_STATE_FILES" ]]; then
    echo "  (none)"
else
    for f in $DEAD_STATE_FILES; do
        echo "  DELETE  $f"
    done
fi

echo ""

# Print PRESERVED section
echo "--- PRESERVED (live-state / legit) ---"
if [[ -z "$PRESERVE_LIST" ]]; then
    echo "  (none)"
else
    for name in $PRESERVE_LIST; do
        echo "  PRESERVED  $name"
    done
fi

echo ""

# Execute deletions only when --execute is passed
if [[ $DRY_RUN -eq 1 ]]; then
    echo "=== dry-run complete — nothing deleted. Pass --execute to remove residue. ==="
else
    echo "=== executing deletions ==="
    # Residue: full directory removal
    for name in $DELETE_LIST; do
        target="$OMT_DIR/$name"
        echo "  removing $target"
        rm -rf "$target"
    done
    # Dead-state: reap state files; remove directory only if empty
    for f in $DEAD_STATE_FILES; do
        echo "  reaping $f"
        rm -f "$f"
        dir="$(dirname "$f")"
        rmdir "$dir" 2>/dev/null || true
    done
    echo "=== done ==="
fi

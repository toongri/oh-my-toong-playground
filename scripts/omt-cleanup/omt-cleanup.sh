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

OMT_DIR="${HOME}/.omt"

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

has_active_goal_state() {
    local dir="$1"
    local f
    for f in "$dir"/goal-state-*.json; do
        [[ -f "$f" ]] || continue
        if grep -q '"active":true' "$f" 2>/dev/null || grep -q '"active": true' "$f" 2>/dev/null; then
            return 0
        fi
    done
    return 1
}

has_deep_interview_state() {
    local dir="$1"
    # Any deep-interview marker (active or not) is preserved — it may be current-session
    for f in "$dir"/deep-interview-active-state-*.json; do
        [[ -f "$f" ]] && return 0
    done
    return 1
}

has_prometheus_state() {
    local dir="$1"
    for f in "$dir"/prometheus-state-*.json; do
        [[ -f "$f" ]] && return 0
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

    # P4: contains an active goal-state file
    has_active_goal_state "$dir" && return 0

    # P5: contains a deep-interview active state file
    has_deep_interview_state "$dir" && return 0

    # P6: contains a prometheus-state file
    has_prometheus_state "$dir" && return 0

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
    else
        # Unknown entry — preserve by default (conservative)
        PRESERVE_LIST="$PRESERVE_LIST $name"
    fi
done

# Print DELETE section
echo "--- RESIDUE (to delete) ---"
if [[ -z "$DELETE_LIST" ]]; then
    echo "  (none)"
else
    for name in $DELETE_LIST; do
        echo "  DELETE  $name"
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
    for name in $DELETE_LIST; do
        target="$OMT_DIR/$name"
        echo "  removing $target"
        rm -rf "$target"
    done
    echo "=== done ==="
fi

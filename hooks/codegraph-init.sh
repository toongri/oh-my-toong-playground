#!/bin/bash
# SessionStart hook: lazily initialize codegraph index for the opened repo.
#
# Safety: refuses to index $HOME, /, or the OMT harness repo itself.
# Idempotent: skips if .codegraph/codegraph.db or the sentinel already exists.
# Non-blocking: init runs in background; hook always exits 0.
set -euo pipefail

# ---------------------------------------------------------------------------
# 1. Read stdin JSON payload and extract .cwd (mirrors session-start.sh approach)
# ---------------------------------------------------------------------------
INPUT=$(cat)

cwd=""
if command -v jq > /dev/null 2>&1; then
    cwd=$(echo "$INPUT" | jq -r '.cwd // ""' 2>/dev/null)
fi

if [ -z "$cwd" ] || [ "$cwd" = "null" ]; then
    cwd=$(pwd)
fi

# ---------------------------------------------------------------------------
# 2. Resolve git project root
# ---------------------------------------------------------------------------
project_root=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null) || {
    # Not a git repo — nothing to do
    exit 0
}

# ---------------------------------------------------------------------------
# 3. Safety guards — exit 0 without indexing on dangerous targets
# ---------------------------------------------------------------------------

# Guard: $HOME or filesystem root
if [ "$project_root" = "$HOME" ] || [ "$project_root" = "/" ]; then
    exit 0
fi

# Guard: OMT harness repo (contains tools/sync.ts — markdown-heavy, low value)
if [ -f "$project_root/tools/sync.ts" ]; then
    exit 0
fi

# ---------------------------------------------------------------------------
# 4. Binary guard — skip if codegraph is not installed
# ---------------------------------------------------------------------------
if ! command -v codegraph > /dev/null 2>&1; then
    exit 0
fi

# ---------------------------------------------------------------------------
# 5. Index guard — skip if already indexed
# ---------------------------------------------------------------------------
if [ -f "$project_root/.codegraph/codegraph.db" ]; then
    exit 0
fi

# ---------------------------------------------------------------------------
# 6. Sentinel guard — skip if a prior init attempt was already made
# ---------------------------------------------------------------------------
if [ -f "$project_root/.codegraph/.omt-init-attempted" ]; then
    exit 0
fi

# ---------------------------------------------------------------------------
# 7. Initialize: create sentinel, then run codegraph init in background
# ---------------------------------------------------------------------------
mkdir -p "$project_root/.codegraph"
touch "$project_root/.codegraph/.omt-init-attempted"

( cd "$project_root" && codegraph init > /dev/null 2>&1 ) &

exit 0

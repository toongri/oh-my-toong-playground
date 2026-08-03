#!/bin/bash
# =============================================================================
# PostToolUse Hook: Mermaid Render Gate
#
# Blocks (decision:"block") when a markdown file just written via
# Write/Edit/MultiEdit contains a mermaid block that the real mermaid
# renderer cannot render. The write itself already landed -- PostToolUse
# cannot undo it -- so "block" here means the failure is fed back to the
# agent, which then fixes the diagram in place.
#
# The renderer is mermaid-cli (`mmdc`), which loads the actual mermaid
# library inside headless Chromium. That matters: a syntax-only check misses
# diagrams that parse cleanly but crash the renderer during layout (a
# flowchart self-loop edge is the known case). Both classes surface here.
#
# Two-phase, because the two phases have opposite strengths:
#   FAST  -- one `mmdc` run over the whole markdown file. One Chromium
#            launch for every block (~1.6s for a 3-block file). This is the
#            only phase that runs when the file is clean, i.e. almost always.
#   SLOW  -- only after FAST fails. mmdc's markdown mode stops at the first
#            bad chart and reports a line number relative to the BLOCK, not
#            the file, and never says which block it was. So each block is
#            re-rendered on its own to recover file-level line numbers and to
#            find every failing block rather than just the first.
#
# Fail-open paths (exit 0, nothing emitted): non-markdown target, missing
# file, no mermaid block, or no `mmdc` on PATH. A machine without the
# renderer installed must not have its writes wedged -- see the NOTICE on
# stderr for how to enable it.
# =============================================================================
set -euo pipefail

INPUT="$(cat)"

TOOL_NAME="$(printf '%s' "$INPUT" | jq -r '.tool_name // ""' 2>/dev/null || true)"
case "$TOOL_NAME" in
    Write | Edit | MultiEdit) ;;
    *) exit 0 ;;
esac

# Validate the file on disk, not tool_input's content/new_string: an Edit
# rewrites a fragment, and a mermaid block split across two edits is only
# well-formed in the merged result.
FILE_PATH="$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // ""' 2>/dev/null || true)"
case "$FILE_PATH" in
    *.md | *.markdown) ;;
    *) exit 0 ;;
esac

[ -f "$FILE_PATH" ] || exit 0

# Cheap gate: no mermaid fence means no reason to pay for a Chromium launch.
# This is what keeps the hook free for ordinary prose writes.
grep -q '^[[:space:]]*```mermaid[[:space:]]*$' "$FILE_PATH" || exit 0

MMDC="$(command -v mmdc 2>/dev/null || true)"
if [ -z "$MMDC" ]; then
    echo "NOTICE: mmdc not on PATH -- mermaid render gate skipped. Enable with: npm i -g @mermaid-js/mermaid-cli" >&2
    exit 0
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# --- FAST phase -------------------------------------------------------------
if "$MMDC" -i "$FILE_PATH" -o "$TMP_DIR/out.md" -q >"$TMP_DIR/fast.log" 2>&1; then
    exit 0
fi

# --- SLOW phase -------------------------------------------------------------
# Split each fenced mermaid block into its own file and record the fence line
# numbers, so a block-relative diagnostic can be reported against the file.
# A block left unclosed at EOF is still emitted -- it is broken markdown, and
# reporting it beats silently dropping it.
awk -v dir="$TMP_DIR" '
    /^[ \t]*```mermaid[ \t]*$/ && !inb { inb = 1; n++; start = NR; f = dir "/block-" n ".mmd"; next }
    inb && /^[ \t]*```[ \t]*$/         { inb = 0; print n, start, NR; close(f); next }
    inb                                { print > f }
    END                                { if (inb) print n, start, NR }
' "$FILE_PATH" >"$TMP_DIR/index"

# Strip puppeteer's stack trace, keeping only mermaid's own diagnostic.
clean_error() {
    grep -vE '^[[:space:]]*at |\((https?|file)://' "$1" | sed '/^[[:space:]]*$/d' | head -6
}

FAILURES=""
FAILED_COUNT=0
BLOCK_COUNT=0

while read -r idx start end; do
    [ -n "${idx:-}" ] || continue
    BLOCK_COUNT=$((BLOCK_COUNT + 1))
    if "$MMDC" -i "$TMP_DIR/block-$idx.mmd" -o "$TMP_DIR/block-$idx.svg" -q >"$TMP_DIR/block-$idx.log" 2>&1; then
        continue
    fi
    FAILED_COUNT=$((FAILED_COUNT + 1))

    # mermaid counts from the first line INSIDE the fence, so the fence line
    # itself is the offset: file line = fence line + reported line.
    REL="$(grep -oE 'on line [0-9]+' "$TMP_DIR/block-$idx.log" | head -1 | grep -oE '[0-9]+' || true)"
    LOCATION="block $idx (lines $start-$end)"
    if [ -n "$REL" ]; then
        LOCATION="$LOCATION -- error at file line $((start + REL))"
    fi

    FAILURES="${FAILURES}
  ${LOCATION}
$(clean_error "$TMP_DIR/block-$idx.log" | sed 's/^/    /')
"
done <"$TMP_DIR/index"

# Every block passing alone while the whole-file run failed means the failure
# is not attributable to one block; report the raw run rather than nothing.
if [ "$FAILED_COUNT" -eq 0 ]; then
    FAILURES="
$(clean_error "$TMP_DIR/fast.log" | sed 's/^/    /')
"
fi

REASON="mermaid render failed: $FILE_PATH
$FAILURES
Renderer: mermaid-cli (mmdc), $((BLOCK_COUNT - FAILED_COUNT))/$BLOCK_COUNT blocks OK.
Fix the diagram(s) above and write the file again."

jq -n --arg reason "$REASON" '{decision: "block", reason: $reason}'
exit 0

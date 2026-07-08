#!/bin/bash
# =============================================================================
# PostToolUse Hook: Label Edit Warn
#
# Soft-warns (NEVER blocks) when content just written via Write/Edit/MultiEdit
# contains a bare invented label (Step N, AC code, Phase/Round/Iteration N,
# priority code, D-N ref — see hooks/lib/label-patterns.sh) that is not
# defined in place (e.g. as a heading: "### D-1: Add flag"). Nudges the
# writer toward rules/communication-style.md's invented/opaque-label ban.
#
# This hook always exits 0 — on the warn path, the no-warn path, and the
# missing-lib fail-open path. It only ever adds additionalContext; it never
# emits a deny/block decision.
#
# NOTE: deliberately no `set -euo pipefail` here (mirrors label-commit-gate.sh)
# — `source`/`.` is a POSIX special builtin, and bash treats its "file not
# found" error as fatal to the whole shell even inside a `||` when errexit is
# active, which would defeat the fail-open guard below.
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Fail-open source guard: this is a style nudge, not a security gate — a
# deploy drift must never wedge a write/edit.
source "$SCRIPT_DIR/lib/label-patterns.sh" 2>/dev/null || {
    echo "WARNING: label-patterns.sh missing — label-edit-warn disabled" >&2
    exit 0
}

INPUT="$(cat)"

TOOL_NAME="$(printf '%s' "$INPUT" | jq -r '.tool_name // ""' 2>/dev/null)"

# Extract the written text across the 3 tool shapes. MultiEdit's `edits[]?`
# guard (plus `// empty`) makes an absent/empty edits array yield nothing —
# no jq error, CONTENT stays empty, falls through to the no-warn exit below.
CONTENT=""
case "$TOOL_NAME" in
    Write)
        CONTENT="$(printf '%s' "$INPUT" | jq -r '.tool_input.content // empty' 2>/dev/null)"
        ;;
    Edit)
        CONTENT="$(printf '%s' "$INPUT" | jq -r '.tool_input.new_string // empty' 2>/dev/null)"
        ;;
    MultiEdit)
        CONTENT="$(printf '%s' "$INPUT" | jq -r '.tool_input.edits[]?.new_string // empty' 2>/dev/null)"
        ;;
esac

if [ -z "$CONTENT" ]; then
    exit 0
fi

if ! label_match_full "$CONTENT"; then
    exit 0
fi

# defined-in-place exemption: drop lines that themselves DEFINE a label as a
# markdown heading (e.g. "### D-1: Add flag"), then re-check what's left.
# Reuses label-patterns.sh's own _LABEL_PATTERN_FULL (the single source of
# truth for the label set) so heading recognition never drifts from bare
# recognition.
NON_DEFINE_TEXT="$(printf '%s\n' "$CONTENT" | LABEL_RE="$_LABEL_PATTERN_FULL" perl -ne 'print unless /^\s*#{1,6}\s+(?:$ENV{LABEL_RE}):/' 2>/dev/null)"

if ! label_match_full "$NON_DEFINE_TEXT"; then
    exit 0
fi

WARNING_TEXT='Detected a bare invented/opaque label (e.g. D-1, AC M1, Step 3, Phase 2) in the content just written. Per rules/communication-style.md: name the thing instead of coining a label. A label is fine when it defines itself in place (e.g. a heading like "### D-1: <name>") — but a bare reference elsewhere should spell out what it means. This is a soft reminder; nothing was blocked.'

jq -n --arg ctx "$WARNING_TEXT" '{hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: $ctx}}'
exit 0

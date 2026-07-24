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
# Claude PostToolUse shim over the shared judgment core (hooks/label-edit-
# warn-core.sh) -- the core owns the label check + defined-in-place
# exemption + warning text (label_edit_warn_core_check), shared verbatim
# with hooks/codex-label-edit-warn.sh (Codex). This file owns ONLY Claude's
# tool_input shape (Write/Edit/MultiEdit) and the additionalContext envelope.
#
# NOTE: deliberately no `set -euo pipefail` here (mirrors label-commit-gate.sh)
# — `source`/`.` is a POSIX special builtin, and bash treats its "file not
# found" error as fatal to the whole shell even inside a `||` when errexit is
# active, which would defeat the fail-open guard below.
#
# omt-hook-dep: label-edit-warn-core.sh
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Fail-open source guard: this is a style nudge, not a security gate — a
# deploy drift must never wedge a write/edit.
source "$SCRIPT_DIR/lib/label-patterns.sh" 2>/dev/null || {
    echo "WARNING: label-patterns.sh missing — label-edit-warn disabled" >&2
    exit 0
}
source "$SCRIPT_DIR/label-edit-warn-core.sh" 2>/dev/null || {
    echo "WARNING: label-edit-warn-core.sh missing — label-edit-warn disabled" >&2
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

WARNING_TEXT=$(label_edit_warn_core_check "$CONTENT") || exit 0

jq -n --arg ctx "$WARNING_TEXT" '{hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: $ctx}}'
exit 0

#!/bin/bash
# =============================================================================
# codex-label-edit-warn.sh
# Codex PostToolUse shim for the "soft-warn on a bare invented/opaque label
# in just-written content" nudge (Claude<->Codex hook-parity plan). Thin
# shim over the shared judgment core (hooks/label-edit-warn-core.sh) -- the
# SAME label check + defined-in-place exemption + warning text hooks/label-
# edit-warn.sh (Claude) uses.
#
# tool_name is normalized to lowercase before routing (mirroring hooks/
# codex-write-guard.sh's toLowerCase treatment), covering Codex's native
# write/edit/multiedit/multi_edit tool names plus apply_patch. Content is
# extracted per tool shape:
#   - write: tool_input.content
#   - edit: tool_input.new_string
#   - multiedit/multi_edit: tool_input.edits[]?.new_string
#   - apply_patch: only lines starting with `+` (the added content), across
#     all 4 payload keys Codex has been observed sending the patch text
#     under (command/input/patch/cmd -- mirrors hooks/codex-write-guard.sh's
#     _cwg_extract_patch_headers keys). The leading `+` is stripped and the
#     `*** ` envelope lines / removed (`-`) lines are excluded, so this
#     carries the SAME meaning as the write/edit/multiedit routes above:
#     added content only. Scanning the whole patch text (envelope + removed
#     lines too) let a removal-only edit or a `+### D-1: <name>` defining
#     heading warn/miss-exempt differently than the identical Write/Edit
#     content would on Claude -- this keeps the two platforms in parity.
#
# This hook never blocks on either platform (PostToolUse, additionalContext
# only) -- always exits 0.
#
# omt-hook-dep: label-edit-warn-core.sh
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

source "$SCRIPT_DIR/lib/label-patterns.sh" 2>/dev/null || exit 0
source "$SCRIPT_DIR/label-edit-warn-core.sh" 2>/dev/null || exit 0

if ! command -v jq > /dev/null 2>&1; then
    exit 0
fi

INPUT="$(cat)"

tool_name_raw="$(printf '%s' "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)" || tool_name_raw=""
tool_name="$(printf '%s' "$tool_name_raw" | tr '[:upper:]' '[:lower:]')"

CONTENT=""
case "$tool_name" in
    write)
        CONTENT="$(printf '%s' "$INPUT" | jq -r '.tool_input.content // empty' 2>/dev/null)"
        ;;
    edit)
        CONTENT="$(printf '%s' "$INPUT" | jq -r '.tool_input.new_string // empty' 2>/dev/null)"
        ;;
    multiedit | multi_edit)
        CONTENT="$(printf '%s' "$INPUT" | jq -r '.tool_input.edits[]?.new_string // empty' 2>/dev/null)"
        ;;
    apply_patch)
        for _clw_key in command input patch cmd; do
            v="$(printf '%s' "$INPUT" | jq -r --arg k "$_clw_key" '.tool_input[$k] // empty' 2>/dev/null)"
            if [ -n "$v" ]; then
                added="$(printf '%s\n' "$v" | tr -d '\r' | grep -E '^\+' | sed -E 's/^\+//')"
                [ -n "$added" ] && CONTENT="${CONTENT}${added}"$'\n'
            fi
        done
        ;;
    *)
        exit 0
        ;;
esac

WARNING_TEXT=$(label_edit_warn_core_check "$CONTENT") || exit 0

jq -n --arg ctx "$WARNING_TEXT" '{hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: $ctx}}'
exit 0

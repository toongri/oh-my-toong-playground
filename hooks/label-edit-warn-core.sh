#!/bin/bash
# =============================================================================
# label-edit-warn-core.sh
# Shared judgment core for the "soft-warn on a bare invented/opaque label in
# just-written content" nudge, sourced by both hooks/label-edit-warn.sh
# (Claude) and hooks/codex-label-edit-warn.sh (Codex). Owns the full-tier
# label check (label_match_full) plus the defined-in-place exemption (a
# label that itself defines a markdown heading, e.g. "### D-1: <name>", is
# exempt) and the shared warning text.
#
# The per-platform shim owns ONLY: extracting the just-written text from its
# own tool_input shape (Claude: Write/Edit/MultiEdit's content/new_string/
# edits[].new_string; Codex: the lowercase write|edit|multiedit|multi_edit|
# apply_patch tool names, mirroring hooks/codex-write-guard.sh's routing) and
# building its own PostToolUse additionalContext envelope. This hook never
# blocks on either platform, so there is no deny-envelope divergence to
# manage (unlike label-commit-gate-core.sh) -- the shim's envelope shape is
# the same {"hookSpecificOutput": {"hookEventName": "PostToolUse",
# "additionalContext": ...}} for both.
#
# Requires label_match_full and $_LABEL_PATTERN_FULL (hooks/lib/label-
# patterns.sh) to already be sourced by the caller before
# label_edit_warn_core_check is invoked.
#
# label_edit_warn_core_check <content>
# Prints the shared warning text and returns 0 iff <content> contains a bare
# invented/opaque label not defined in place. Prints nothing and returns 1
# otherwise (including empty content).
# =============================================================================

_LABEL_EDIT_WARN_CORE_TEXT='Detected a bare invented/opaque label (e.g. D-1, AC M1, Step 3, Phase 2) in the content just written. Per rules/communication-style.md: name the thing instead of coining a label. A label is fine when it defines itself in place (e.g. a heading like "### D-1: <name>") — but a bare reference elsewhere should spell out what it means. This is a soft reminder; nothing was blocked.'

label_edit_warn_core_check() {
    local content="$1"

    if [ -z "$content" ]; then
        return 1
    fi

    if ! label_match_full "$content"; then
        return 1
    fi

    # defined-in-place exemption: drop lines that themselves DEFINE a label
    # as a markdown heading (e.g. "### D-1: Add flag"), then re-check what's
    # left. Reuses label-patterns.sh's own _LABEL_PATTERN_FULL (the single
    # source of truth for the label set) so heading recognition never drifts
    # from bare recognition.
    local non_define_text
    non_define_text="$(printf '%s\n' "$content" | LABEL_RE="$_LABEL_PATTERN_FULL" perl -ne 'print unless /^\s*#{1,6}\s+(?:$ENV{LABEL_RE}):/' 2>/dev/null)"

    if ! label_match_full "$non_define_text"; then
        return 1
    fi

    printf '%s' "$_LABEL_EDIT_WARN_CORE_TEXT"
    return 0
}

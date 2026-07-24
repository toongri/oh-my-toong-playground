#!/bin/bash
# =============================================================================
# Label Commit Gate (PreToolUse hook)
# Hard-blocks a `git commit` whose commit MESSAGE (message only — never
# staged content) contains a clean-economics invented label. Message-only
# by design: scanning staged content would collide with legitimate
# `### D-1:` ADR headings.
# matcher: "Bash"
#
# Claude PreToolUse shim over the shared judgment core (hooks/label-commit-
# gate-core.sh) -- the core owns the git-commit-shape detector, message
# extraction, and label check (label_commit_gate_core_check), shared
# verbatim with hooks/codex-label-commit-gate.sh (Codex). This file owns
# ONLY Claude's tool_input shape and Claude's existing deny envelope
# (stderr `{"decision":"deny","reason":...}` + exit 2).
#
# omt-hook-dep: label-commit-gate-core.sh
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Fail-open source guard: this is a style gate, not a security gate — a
# deploy drift must never wedge the user's commits.
source "$SCRIPT_DIR/lib/label-patterns.sh" 2>/dev/null || {
    echo "WARNING: label-patterns.sh missing — commit-gate disabled" >&2
    exit 0
}
source "$SCRIPT_DIR/label-commit-gate-core.sh" 2>/dev/null || {
    echo "WARNING: label-commit-gate-core.sh missing — commit-gate disabled" >&2
    exit 0
}

input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')

matched_token=$(label_commit_gate_core_check "$cmd") || exit 0

reason="Invented label in commit message (see rules/communication-style.md). Reword to name the thing, not '${matched_token}'."
jq -n --arg reason "$reason" '{decision:"deny",reason:$reason}' >&2
exit 2

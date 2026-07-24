#!/bin/bash
# =============================================================================
# codex-label-commit-gate.sh
# Codex PreToolUse shim for the "hard-block a git commit whose MESSAGE
# contains a clean-economics invented label" gate (Claude<->Codex hook-
# parity plan). Thin shim over the shared judgment core (hooks/label-commit-
# gate-core.sh) -- the SAME git-commit-shape detector, message extraction,
# and label check hooks/label-commit-gate.sh (Claude) uses.
#
# tool_name is normalized to lowercase before routing (mirroring hooks/
# codex-write-guard.sh's toLowerCase treatment), covering Codex's native
# bash/exec_command/shell_command tool names. The raw shell command text is
# read from tool_input.command, falling back to tool_input.cmd (mirroring
# hooks/codex-write-guard.sh's command/cmd fallback for exec_command/
# shell_command payloads). Before delegating to the core, the process cwd
# is switched to the command's own working directory (tool_input.workdir ??
# tool_input.cwd, resolved against the top-level cwd) so the core's -F/
# --file relative-path lookup resolves against the SAME directory the
# actual command would run in (mirroring tool-paths.ts:44-47).
#
# Deny envelope is Codex's PreToolUse contract (hookSpecificOutput +
# permissionDecision:"deny" on stdout, exit 0) -- NOT the Claude shim's
# stderr + exit 2 contract, since that pre-existing Claude behavior must not
# change (see label-commit-gate-core.sh's header for the full rationale).
#
# Fail-open throughout: missing lib/core, missing jq, or a non-commit-shaped
# command all fall through to a plain exit 0 (allow) -- this is a style
# gate, not a security gate.
#
# omt-hook-dep: label-commit-gate-core.sh
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

source "$SCRIPT_DIR/lib/label-patterns.sh" 2>/dev/null || exit 0
source "$SCRIPT_DIR/label-commit-gate-core.sh" 2>/dev/null || exit 0

if ! command -v jq > /dev/null 2>&1; then
    exit 0
fi

input=$(cat)

tool_name_raw=$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null) || tool_name_raw=""
tool_name=$(printf '%s' "$tool_name_raw" | tr '[:upper:]' '[:lower:]')

case "$tool_name" in
    bash | exec_command | shell_command) ;;
    *) exit 0 ;;
esac

cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null) || cmd=""
if [ -z "$cmd" ]; then
    cmd=$(printf '%s' "$input" | jq -r '.tool_input.cmd // empty' 2>/dev/null) || cmd=""
fi

# Resolve the command's own working directory -- tool_input.workdir ??
# tool_input.cwd -- against the hook's top-level cwd, mirroring the sibling
# extractor hooks/rules-injector/tool-paths.ts:44-47 (workdir ?? cwd) and
# hooks/codex-write-guard.sh:505-538's shell-route carve-out ("Scope: this
# shell route only"). Without this, a payload whose command actually runs
# in a different workdir than the top-level cwd resolves a relative
# `-F <file>` message path against the wrong directory -- the core's -f
# test finds nothing and the label check silently misses it (allow).
# Scope: this shell route only -- the whole script has exactly one route.
top_cwd=$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null) || top_cwd=""
[ -n "$top_cwd" ] || top_cwd="$PWD"
workdir=$(printf '%s' "$input" | jq -r '.tool_input.workdir // .tool_input.cwd // empty' 2>/dev/null) || workdir=""
if [ -n "$workdir" ]; then
    case "$workdir" in
        /*) top_cwd="$workdir" ;;
        *) top_cwd="$top_cwd/$workdir" ;;
    esac
fi
cd "$top_cwd" 2>/dev/null || true

matched_token=$(label_commit_gate_core_check "$cmd") || exit 0

reason="Invented label in commit message (see rules/communication-style.md). Reword to name the thing, not '${matched_token}'."
jq -n --arg reason "$reason" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$reason}}'
exit 0

#!/bin/bash
# Codex PreToolUse: require an explicitly selected spawn role. Unknown role
# lookup belongs to Codex; this hook does not read role files or add defaults.
# Emit no allow/update output: all hooks see the original input, and a second
# updatedInput could overwrite codex-spawn-context-gate's history normalization.
# Codex combines any deny with other hooks' updates by blocking the call.
# Enforcement requires an active, successfully invoked hook (not a timeout).
set -euo pipefail

deny() {
    # Parser failures must deny without requiring jq to construct the response.
    printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Blocked: spawn requires an explicit nonempty string agent_type. Select a configured role, or set agent_type to default for a generic task. If already supplied, check the hook payload and jq installation."}}'
    exit 0
}

input=$(cat) || deny
command -v jq >/dev/null 2>&1 || deny

# Rust str::trim uses Unicode White_Space. Spell that set explicitly because
# regex engines disagree about \\s (notably NBSP and ideographic space).
# U+200B and U+FEFF are not White_Space and remain nonempty role names.
printf '%s' "$input" | jq -se '
    if length != 1 then error("expected one payload") else .[0] end |
    if type != "object" then error("expected object") else . end |
    if (.tool_name | type) != "string" then error("expected tool name")
    elif .tool_name == "" then error("empty tool name")
    elif (.tool_name | ascii_downcase | endswith("spawn_agent") | not) then true
    elif (.tool_input | type) != "object" then false
    elif (.tool_input.agent_type | type) != "string" then false
    else .tool_input.agent_type |
        test("[^\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]")
    end
' >/dev/null 2>&1 || deny

exit 0

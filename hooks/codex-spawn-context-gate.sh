#!/bin/bash
# Codex PreToolUse: every native spawn starts without inherited history.
# updatedInput replaces the complete input, so preserve all non-context keys,
# including future fields. Remove V1 fork_context: V1 ignores fork_turns and
# defaults the absent legacy key to false; V2 rejects legacy boolean values.
# Codex requires permissionDecision:allow alongside updates;
# another hook's deny still blocks the call. No skill/session state is needed.
# This protects calls reaching the hook, not disabled hooks or runtime timeouts.
set -euo pipefail

deny() {
    # Keep denial independent of jq so parser failures cannot allow a spawn.
    printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Blocked: cannot safely normalize spawn input to fork_turns=none. Check the hook payload and jq installation."}}'
    exit 0
}

input=$(cat) || deny
command -v jq >/dev/null 2>&1 || deny

# Slurp rejects empty/multiple JSON documents. Unknown tool names cannot be
# safely classified; identifiable unrelated tools need no input validation.
# Namespace flattening produces agentsspawn_agent / collaborationspawn_agent;
# the suffix also covers unnamespaced V1 and configurable V2 namespaces.
output=$(printf '%s' "$input" | jq -sc '
    if length != 1 then error("expected one payload") else .[0] end |
    if type != "object" then error("expected object") else . end |
    if (.tool_name | type) != "string" then error("expected tool name")
    elif .tool_name == "" then error("empty tool name")
    elif (.tool_name | ascii_downcase | endswith("spawn_agent") | not) then empty
    elif (.tool_input | type) != "object" then error("expected tool input object")
    elif .tool_input.fork_turns == "none" and (.tool_input | has("fork_context") | not) then empty
    else {hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        updatedInput: (.tool_input | del(.fork_context) | . + {fork_turns: "none"})
    }} end
' 2>/dev/null) || deny

[ -z "$output" ] || printf '%s\n' "$output"
exit 0

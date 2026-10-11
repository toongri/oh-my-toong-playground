#!/bin/bash
# QA UserPromptSubmit hook (Claude and Codex). While a QA cycle waits on
# `qa-state.ts await-user`, it stores the user's submitted prompt verbatim as
# `user_reply` and opens `user_answer_open`, so a `person` blocker records what
# the user actually said instead of text the agent supplies. The agent cannot
# set either field: the CLI has no flag for them and direct writes to the state
# file are denied by write-guard-core.sh.
#
# It never blocks or changes the prompt and prints nothing; every missing tool,
# malformed payload or absent state exits 0 without writing.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=hooks/lib/qa-driver-patterns.sh
source "$SCRIPT_DIR/lib/qa-driver-patterns.sh"

command -v jq >/dev/null 2>&1 || exit 0
input=$(cat)
# Kept JSON-encoded so the text reaches the state byte for byte (command
# substitution would strip trailing newlines from a raw string).
prompt_json=$(printf '%s' "$input" | jq -ec '.prompt | select(type == "string" and length > 0)' 2>/dev/null) || exit 0
payload_sid=$(printf '%s' "$input" | jq -er '.session_id // empty' 2>/dev/null) || exit 0
session_id=$(qa_driver_session_id "$payload_sid") || exit 0

omt_dir="${OMT_DIR:-}"
if [ -z "$omt_dir" ]; then
    cwd=$(printf '%s' "$input" | jq -er '.cwd // empty' 2>/dev/null) || exit 0
    omt_dir=$(source "$SCRIPT_DIR/lib/omt-dir.sh" && unset OMT_DIR && resolve_omt_dir "$cwd") || exit 0
fi
[ -n "$omt_dir" ] || exit 0
state_file="$omt_dir/qa-state-${session_id}.json"
[ -f "$state_file" ] || exit 0

# Same mkdir lock the CLI takes (lib/persistent-mode-core/state-lock.ts), so a
# prompt queued while the agent still writes cannot interleave with that write.
# A lock it cannot take within about a second is skipped: the reply is then not
# stored, and a person blocker stays refused until the user is asked again.
lock="$state_file.lock"
acquired=false
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    if mkdir "$lock" 2>/dev/null; then acquired=true; break; fi
    sleep 0.05
done
[ "$acquired" = true ] || exit 0
tmp="$state_file.reply.$$"
trap 'rm -f "$tmp"; rm -rf "$lock"' EXIT
printf '{"ownerPid":%d,"token":"qa-user-reply-%d","startedAt":%s000}' "$$" "$$" "$(date +%s)" > "$lock/owner.json" 2>/dev/null || true

waiting=$(jq -r 'if .active == true and .awaiting_user == true then "yes" else "no" end' "$state_file" 2>/dev/null) || exit 0
[ "$waiting" = "yes" ] || exit 0

# tmp + mv keeps the state file whole if the hook is killed mid-write.
if jq --argjson reply "$prompt_json" '.user_reply = $reply | .user_answer_open = true | .awaiting_user = false' "$state_file" > "$tmp" 2>/dev/null; then
    mv -f "$tmp" "$state_file" 2>/dev/null || true
fi
exit 0

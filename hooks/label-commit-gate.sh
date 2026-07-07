#!/bin/bash
# =============================================================================
# Label Commit Gate (PreToolUse hook)
# Hard-blocks a `git commit` whose commit MESSAGE (message only — never
# staged content) contains a clean-economics invented label. Message-only
# by design: scanning staged content would collide with legitimate
# `### D-1:` ADR headings.
# matcher: "Bash"
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Fail-open source guard: this is a style gate, not a security gate — a
# deploy drift must never wedge the user's commits.
source "$SCRIPT_DIR/lib/label-patterns.sh" 2>/dev/null || {
    echo "WARNING: label-patterns.sh missing — commit-gate disabled" >&2
    exit 0
}

input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')

# Fast path: not a git commit → passthrough. Tolerates git GLOBAL options
# between `git` and `commit` (e.g. `git -C <path> commit`), bounded to a
# single line: the between-run excludes shell operators (&/|/;) AND
# newline/CR — a newline is also a command separator, so a `git <x>` on
# one line must never bleed into an unrelated `commit` token on a later
# line. The two inter-token gaps use [[:blank:]] (space/tab only, never
# newline) so `git` and `commit` must share one line. Still guards
# against `git commit-graph`/`commit-tree` by requiring a space or
# end-of-string after "commit".
_commit_gate_nl=$'\n\r'
_commit_gate_re='git[[:blank:]]([^\&\|\;'"$_commit_gate_nl"']*[[:blank:]])?commit([[:space:]]|$)'
if [[ ! "$cmd" =~ $_commit_gate_re ]]; then
    exit 0
fi

# Extract the commit MESSAGE across ALL documented forms, then scan their
# union. Human paths (editor-driven commit, bare --amend, -F -) leave the
# message empty → passthrough. First-match-only extraction previously let
# documented forms (--message, repeated -m as subject/body, --file <path>)
# bypass the hard block (Codex PR #161 P2).
message=""

# Every -m / -am / --message value (space or = form, single or double
# quoted). git treats repeated -m as subject/body paragraphs, so all values
# are collected. Iterated because bash =~ captures only the leftmost match
# per call; each pass strips through the matched value and re-scans the rest.
# The leading (^|[[:space:]]) pins the flag to a token boundary so
# -[a-zA-Z]*m never mis-binds to the "-m" substring inside "--message".
_msg_re='(^|[[:space:]])(-[a-zA-Z]*m|--message)[[:space:]]*=?[[:space:]]*('\''[^'\'']*'\''|"[^"]*")'
_rest="$cmd"
while [[ "$_rest" =~ $_msg_re ]]; do
    _val="${BASH_REMATCH[3]}"
    _val="${_val#[\'\"]}"; _val="${_val%[\'\"]}"   # strip the surrounding quotes
    message="$message$_val"$'\n'
    _rest="${_rest#*"${BASH_REMATCH[0]}"}"          # advance past this match
done

# -F/--file message file: space form (-F <path>, --file <path>) or
# --file=<path>. -F - (stdin) is a human path → left unread.
file_path=""
if [[ "$cmd" =~ (^|[[:space:]])(-F|--file)[[:space:]]+([^[:space:]]+) ]]; then
    file_path="${BASH_REMATCH[3]}"
elif [[ "$cmd" =~ (^|[[:space:]])--file=([^[:space:]]+) ]]; then
    file_path="${BASH_REMATCH[2]}"
fi
if [[ -n "$file_path" && "$file_path" != "-" && -f "$file_path" ]]; then
    message="$message$(cat "$file_path")"$'\n'
fi

if [[ -z "$message" ]]; then
    exit 0
fi

if label_match_hard "$message"; then
    # Best-effort extraction of the offending token so the reason names it.
    matched_token=$(printf '%s\n' "$message" \
        | LABEL_RE="$_LABEL_PATTERN_HARD" perl -ne 'if (/($ENV{LABEL_RE})/) { print $1; exit }')
    reason="Invented label in commit message (see rules/communication-style.md). Reword to name the thing, not '${matched_token}'."
    jq -n --arg reason "$reason" '{decision:"deny",reason:$reason}' >&2
    exit 2
fi

exit 0

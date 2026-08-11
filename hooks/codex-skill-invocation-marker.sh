#!/bin/bash
# Record literal $<skill-name> mentions submitted in a Codex prompt.
set -euo pipefail

command -v jq >/dev/null 2>&1 || exit 0
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/omt-dir.sh"

input=$(cat) || exit 0

sid=$(printf '%s' "$input" | jq -r 'if (.session_id? | type) == "string" then .session_id else empty end' 2>/dev/null) || exit 0
printf '%s' "$sid" | grep -Eq '^[A-Za-z0-9_-]{1,200}$' || exit 0

cwd=$(printf '%s' "$input" | jq -r 'if (.cwd? | type) == "string" then .cwd else empty end' 2>/dev/null) || exit 0
[ -n "$cwd" ] || exit 0
case "$cwd" in
    /*) ;;
    *) exit 0 ;;
esac
case "$cwd" in
    *$'\n'*|*$'\r'*|*$'\t'*) exit 0 ;;
esac

prompt=$(printf '%s' "$input" | jq -r 'if (.prompt? | type) == "string" then .prompt else empty end' 2>/dev/null) || exit 0
[ -n "$prompt" ] || exit 0

names=$(printf '%s' "$prompt" |
    grep -oE '\$[A-Za-z][A-Za-z0-9_-]*' |
    sed 's/^\$//' |
    sort -u || true)
[ -n "$names" ] || exit 0

omt_dir="${OMT_DIR:-}"
if [ -z "$omt_dir" ]; then
    omt_dir=$(unset OMT_DIR; resolve_omt_dir "$cwd") || exit 0
fi
[ -n "$omt_dir" ] || exit 0
mkdir -p "$omt_dir" 2>/dev/null || exit 0

printf '%s\n' "$names" | while IFS= read -r name; do
    [ -n "$name" ] || continue
    marker="$omt_dir/codex-skill-invocation-marker-${sid}-${name}"
    # noclobber preserves any meaningful content written by an earlier event.
    ( set -C; : > "$marker" ) 2>/dev/null || true
done
exit 0

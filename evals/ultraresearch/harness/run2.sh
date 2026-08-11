#!/usr/bin/env bash
set -uo pipefail
RED="$(cd "$(dirname "$0")" && pwd)"
IN="$1"; ARM="$2"; N="$3"; OUT="$4"
D="$RED/$IN-$ARM/rep$N"
rm -rf "$D"; mkdir -p "$D"
for f in "$RED/$IN"/*.md; do [ -e "$f" ] && cp "$f" "$D/"; done
cd "$D"
codex exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox \
  "$(cat "$RED/$IN/prompt-$ARM.txt")" > "$D/stdout.log" 2>"$D/stderr.log" < /dev/null
echo "arm=$IN-$ARM rep=$N out=$( [ -f "$D/$OUT" ] && wc -c < "$D/$OUT" || echo MISSING )"

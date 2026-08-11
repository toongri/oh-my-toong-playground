#!/usr/bin/env bash
set -uo pipefail
RED="$(cd "$(dirname "$0")" && pwd)"
ARM="$1"; N="$2"
D="$RED/$ARM/rep$N"
rm -rf "$D"; mkdir -p "$D"
cp "$RED/in/REPORT.md" "$D/REPORT.md"
cd "$D"
codex exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox \
  "$(cat "$RED/in/prompt-$ARM.txt")" > "$D/stdout.log" 2>"$D/stderr.log" < /dev/null
echo "exit=$? arm=$ARM rep=$N html=$( [ -f "$D/REPORT.html" ] && wc -c < "$D/REPORT.html" || echo MISSING )"

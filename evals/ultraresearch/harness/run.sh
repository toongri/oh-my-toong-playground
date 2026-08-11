#!/usr/bin/env bash
set -euo pipefail
RED="$(cd "$(dirname "$0")" && pwd)"
ARM="$1"; N="$2"
D="$RED/$ARM/rep$N"
rm -rf "$D"; mkdir -p "$D"
cp "$RED/in/REPORT.md" "$D/REPORT.md"
cd "$D"
set +e
codex exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox \
  "$(cat "$RED/in/prompt-$ARM.txt")" > "$D/stdout.log" 2>"$D/stderr.log" < /dev/null
status=$?
set -e
echo "exit=$status arm=$ARM rep=$N html=$( [ -f "$D/REPORT.html" ] && wc -c < "$D/REPORT.html" || echo MISSING )"
exit "$status"

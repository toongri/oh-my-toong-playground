#!/usr/bin/env bash
# Compare quality metrics across extractions to help pick the "canonical" source.
# Usage: bash quality-check.sh <file1> <file2> ...
#   e.g. bash quality-check.sh book_p201-224_*.{md,txt}
set -euo pipefail
[ "$#" -ge 1 ] || { echo "Usage: quality-check.sh <extraction files...>" >&2; exit 1; }

printf "%-46s %6s %7s %8s %7s %9s\n" "file" "lines" "broken" "headers" "fences" "tablerow"
echo "----------------------------------------------------------------------------------------"
for f in "$@"; do
  [ -f "$f" ] || continue
  lines=$(wc -l < "$f" | tr -d ' ')
  # absorb grep's "no match = exit 1" locally so set -e doesn't kill the script
  broken=$({ grep -o $'\357\277\275' "$f" 2>/dev/null || true; } | wc -l | tr -d ' ')   # U+FFFD replacement chars
  headers=$(grep -cE '^#{1,6} ' "$f" 2>/dev/null || true)
  tablerow=$(grep -cE '^[[:space:]]*\|' "$f" 2>/dev/null || true)
  fc=$(grep -c '```' "$f" 2>/dev/null || true)
  fences=$(( ${fc:-0} / 2 ))
  printf "%-46s %6s %7s %8s %7s %9s\n" "$(basename "$f")" "$lines" "${broken:-0}" "${headers:-0}" "$fences" "${tablerow:-0}"
done
echo
echo "Read as: fewer broken(�) is better; more headers/tablerow means structure preserved."
echo "Canonical body = usually pymupdf4llm; table/precise-value regions = pdftotext-layout or marker."

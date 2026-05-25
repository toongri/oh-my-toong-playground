#!/usr/bin/env bash
# Tier 2: recover tables/code blocks with marker. To work around the Apple Silicon
# MPS bug, run in N-page chunks and merge into one file.
# Usage: bash marker-chunked.sh <SPLIT.pdf> [CHUNK=8]
# Requires: uv tool install marker-pdf  (first run downloads a multi-GB model)
set -euo pipefail

SRC="${1:?Usage: marker-chunked.sh <SPLIT.pdf> [CHUNK]}"
CHUNK="${2:-8}"
[[ -f "$SRC" ]] || { echo "ERROR: $SRC not found" >&2; exit 1; }
command -v marker_single >/dev/null || { echo "ERROR: marker_single not found. Run 'uv tool install marker-pdf'" >&2; exit 1; }

STEM="$(basename "${SRC%.pdf}")"
PAGES=$(python3 -c "import pymupdf,sys; print(pymupdf.open(sys.argv[1]).page_count)" "$SRC")
OUTBASE="marker_chunks_${STEM}"
final="${STEM}_marker.md"
: > "$final"

i=0
while [ "$i" -lt "$PAGES" ]; do
  last=$(( i + CHUNK - 1 ))
  [ "$last" -ge "$PAGES" ] && last=$(( PAGES - 1 ))
  range="${i}-${last}"
  echo "[chunk ${range}] running marker..."
  marker_single "$SRC" \
    --output_dir "${OUTBASE}/${range}" \
    --output_format markdown \
    --disable_image_extraction \
    --page_range "$range" 2>&1 | tail -2
  out="${OUTBASE}/${range}/${STEM}/${STEM}.md"
  if [ -f "$out" ]; then
    printf '\n<!-- chunk %s -->\n\n' "$range" >> "$final"
    cat "$out" >> "$final"
  else
    echo "WARN: no result for chunk ${range}: $out" >&2
  fi
  i=$(( last + 1 ))
done

echo "Done: ${final} (table rows: $(grep -cE '^\s*\|' "$final" 2>/dev/null || echo 0))"

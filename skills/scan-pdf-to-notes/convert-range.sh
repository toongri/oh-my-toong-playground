#!/usr/bin/env bash
# Split a page range from a scanned/OCR PDF + Tier 1 extract (pymupdf4llm + pdftotext).
# Usage: bash convert-range.sh <SRC.pdf> <START_PAGE> <END_PAGE> [STEM]
#   Page numbers are 1-based PDF pages. Verify the printed<->PDF mapping first.
# Requires: pip install pymupdf pymupdf4llm, brew install poppler (pdftotext)
set -euo pipefail

SRC="${1:?Usage: convert-range.sh <SRC.pdf> <START> <END> [STEM]}"
START="${2:?START page (1-based) required}"
END="${3:?END page (1-based) required}"
STEM="${4:-$(basename "${SRC%.pdf}")_p${START}-${END}}"

[[ -f "$SRC" ]] || { echo "ERROR: $SRC not found" >&2; exit 1; }

echo "[1/3] splitting p${START}-${END}..."
python3 - "$SRC" "$START" "$END" "$STEM" <<'PY'
import sys, pymupdf
src_path, start, end, stem = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
src = pymupdf.open(src_path)
dst = pymupdf.open()
dst.insert_pdf(src, from_page=start - 1, to_page=end - 1)  # PDF pages are 0-indexed
dst.save(f"{stem}.pdf")
print(f"  -> {stem}.pdf ({dst.page_count} pages)")
PY

echo "[2/3] pdftotext (layout + raw)..."
pdftotext -layout "${STEM}.pdf" "${STEM}_pdftotext-layout.txt"
pdftotext         "${STEM}.pdf" "${STEM}_pdftotext-raw.txt"

echo "[3/3] pymupdf4llm..."
python3 - "$STEM" <<'PY'
import sys, pymupdf4llm
stem = sys.argv[1]
md = pymupdf4llm.to_markdown(
    f"{stem}.pdf",
    write_images=False,
    page_chunks=False,
    table_strategy="lines_strict",
)
with open(f"{stem}_pymupdf4llm.md", "w", encoding="utf-8") as f:
    f.write(md)
print(f"  -> {stem}_pymupdf4llm.md ({len(md):,} chars)")
PY

echo "Tier 1 done. If tables/code blocks matter, run marker-chunked.sh for Tier 2."
ls -lh "${STEM}"*.* 2>/dev/null

#!/usr/bin/env bash
# lint.sh - layout lint for a local HTML report, run in a real browser through agent-browser.
#
# Usage: lint.sh <page.html> [--state '<js run after load>'] [--strict] [--source <dir-or-file>] [--receipt <path>]
#
# Runs scripts/lint.js in three configurations and prints one JSON document on stdout:
#   1280px light : SVG text overlap / outside figure / on strokes / size, clipped HTML, contrast,
#                  graphs drawn without SVG (figure-graph-nosvg), SVG boxes without edges (svg-no-edges),
#                  foreignObject and literal colours in SVG, html lang, Korean word-break, text hidden at rest,
#                  body background, explicit [data-theme=dark] switch,
#                  author first person and authoring-notes mentions, and with --source the numbers and dates
#                  (number-not-in-source, masthead-date-not-in-source) that no file under <dir> contains
#   1280px dark  : contrast, and the theme checks (explicit [data-theme=light] under a dark OS)
#   400px  light : page-level horizontal overflow, SVG text size, clipped HTML, sideways-scrolling figures
# Findings are allowed; the JSON "summary" counts every error and warning (by check and by run);
# "findings" lists at most 100 per check per run, plus "info" notes (sampling counts, truncation).
# --receipt <path> writes a JSON receipt (schema_version 2) after a run with 0 errors: html_sha256 of the linted bytes,
#   html_path, errors, warnings, runs, source, source_sha256, lint_js_sha256, created_at. source_sha256 is the
#   sha256 of the --source file's bytes when --source is a regular file, null when --source is a directory or absent.
#   It proves lint ran clean on those exact bytes (a mistake-guard, not tamper-proof). With errors > 0, or when the
#   HTML or the source file changed during the run, no receipt is written; an existing file at <path> is never
#   deleted, so consumers must compare html_sha256 and source_sha256.
# --strict exits 2 when any finding has severity "error". Without it the exit code is 0 on a completed run.
set -euo pipefail

usage() { echo "usage: lint.sh <page.html> [--state '<js>'] [--strict] [--source <dir-or-file>] [--receipt <path>]" >&2; exit 64; }
[ $# -ge 1 ] || usage
HTML=$1; shift
STATE=""; STRICT=0; SOURCE=""; RECEIPT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --state) [ $# -ge 2 ] || usage; STATE=$2; shift 2 ;;
    --strict) STRICT=1; shift ;;
    --source) [ $# -ge 2 ] || usage; SOURCE=$2; shift 2 ;;
    --receipt) [ $# -ge 2 ] || usage; RECEIPT=$2; shift 2 ;;
    *) usage ;;
  esac
done
for tool in agent-browser jq; do
  command -v "$tool" >/dev/null 2>&1 || { echo "lint.sh: '$tool' not found on PATH" >&2; exit 69; }
done
[ -f "$HTML" ] || { echo "lint.sh: no such file: $HTML" >&2; exit 66; }
if [ -n "$SOURCE" ] && [ ! -e "$SOURCE" ]; then echo "lint.sh: no such source: $SOURCE" >&2; exit 66; fi

sha256_of() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1
  elif command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else openssl dgst -sha256 "$1" | sed 's/^.*= //'; fi
}

DIR=$(cd "$(dirname "$0")" && pwd)
ABS="$(cd "$(dirname "$HTML")" && pwd)/$(basename "$HTML")"
HTML_SHA=$(sha256_of "$ABS")
URL="file://$(printf '%s' "$ABS" | sed 's/%/%25/g; s/ /%20/g; s/#/%23/g; s/?/%3F/g')"
SESSION="hr-lint-$$"
TMP=$(mktemp -d)
ab() { agent-browser --session "$SESSION" "$@"; }
cleanup() { ab close >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT

# --source: all text files under the source, as one JSON string (binary files skipped, 8 MB cap)
echo null > "$TMP/source.json"; echo null > "$TMP/null.json"
CHECKS_MAIN='["svg","clip","contrast","graph","prose","doc","theme"]'
SRC_SHA=""
if [ -n "$SOURCE" ]; then
  if [ -f "$SOURCE" ]; then SRC_SHA=$(sha256_of "$SOURCE"); fi
  { find "$SOURCE" -type f -print0 | xargs -0 grep -I -h '' 2>/dev/null || true; } | head -c 8000000 | jq -Rs . > "$TMP/source.json"
  CHECKS_MAIN='["svg","clip","contrast","graph","prose","source","doc","theme"]'
fi

run() { # <width> <light|dark> <checks-json-array> [source.json]
  ab set viewport "$1" 900 >/dev/null
  ab set media "$2" >/dev/null
  ab open "$URL" >/dev/null
  if [ -n "$STATE" ]; then ab eval "$STATE" >/dev/null; fi
  { cat "$DIR/lint.js"; printf '\n__hrLint({ checks: %s, theme: "%s", sourceText: ' "$3" "$2"; cat "${4:-$TMP/null.json}"; printf ' });\n'; } \
    | ab --json eval --stdin > "$TMP/raw.json"
  if ! jq -e '.success == true and (.data.result | type == "object")' "$TMP/raw.json" >/dev/null 2>&1; then
    echo "lint.sh: in-page lint failed at $1px $2:" >&2
    cat "$TMP/raw.json" >&2
    exit 1
  fi
  jq '.data.result' "$TMP/raw.json" > "$TMP/run-$1-$2.json"
}

run 1280 light "$CHECKS_MAIN" "$TMP/source.json"
run 1280 dark  '["contrast","theme"]'
run 400  light '["overflow","svgsize","clip"]'

jq -s --arg file "$ABS" --arg state "$STATE" '{
  file: $file,
  state: (if $state == "" then null else $state end),
  runs: map({viewport, theme, scrollWidth, innerWidth, pageOverflow: (.scrollWidth > .innerWidth)}),
  summary: {
    errors:   ([.[].totals[] | .error // 0] | add // 0),
    warnings: ([.[].totals[] | .warn  // 0] | add // 0),
    byCheck:  ([.[].totals | to_entries[] | select(.value.error or .value.warn)
                | {check: .key, n: ((.value.error // 0) + (.value.warn // 0))}]
               | group_by(.check) | map({key: .[0].check, value: (map(.n) | add)}) | from_entries),
    byRun:    (map({key: "\(.viewport) \(.theme)", value: ([.totals[] | (.error // 0) + (.warn // 0)] | add // 0)}) | from_entries)
  },
  findings: [.[].findings[]]
}' "$TMP/run-1280-light.json" "$TMP/run-1280-dark.json" "$TMP/run-400-light.json" > "$TMP/out.json"

cat "$TMP/out.json"

if [ -n "$RECEIPT" ]; then
  if [ "$(sha256_of "$ABS")" != "$HTML_SHA" ]; then
    echo "lint.sh: $ABS changed during linting; no receipt written" >&2; exit 1
  fi
  if [ -n "$SRC_SHA" ] && [ "$(sha256_of "$SOURCE")" != "$SRC_SHA" ]; then
    echo "lint.sh: $SOURCE changed during linting; no receipt written" >&2; exit 1
  fi
  if [ "$(jq '.summary.errors' "$TMP/out.json")" -eq 0 ]; then
    SRC_ABS=""
    if [ -n "$SOURCE" ]; then
      if [ -d "$SOURCE" ]; then SRC_ABS=$(cd "$SOURCE" && pwd); else SRC_ABS="$(cd "$(dirname "$SOURCE")" && pwd)/$(basename "$SOURCE")"; fi
    fi
    mkdir -p "$(dirname "$RECEIPT")"
    RTMP="$RECEIPT.tmp.$$"
    jq --arg sha "$HTML_SHA" --arg path "$ABS" --arg src "$SRC_ABS" --arg srcsha "$SRC_SHA" \
       --arg js "$(sha256_of "$DIR/lint.js")" --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '{
      schema_version: 2,
      html_sha256: $sha,
      html_path: $path,
      errors: .summary.errors,
      warnings: .summary.warnings,
      runs: (.runs | map({viewport, theme})),
      source: (if $src == "" then null else $src end),
      source_sha256: (if $srcsha == "" then null else $srcsha end),
      lint_js_sha256: $js,
      created_at: $at
    }' "$TMP/out.json" > "$RTMP" && mv "$RTMP" "$RECEIPT"
  fi
fi
if [ "$STRICT" = 1 ] && [ "$(jq '.summary.errors' "$TMP/out.json")" -gt 0 ]; then exit 2; fi
exit 0

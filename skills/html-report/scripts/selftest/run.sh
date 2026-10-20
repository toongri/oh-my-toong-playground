#!/usr/bin/env bash
# Self-test for lint.sh: every defect planted in defects.html must be reported.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
OUT=$(bash "$HERE/../lint.sh" "$HERE/defects.html" --source "$HERE/source")
CLEAN=$(bash "$HERE/../lint.sh" "$HERE/clean.html" --source "$HERE/source")
DOC=$(bash "$HERE/../lint.sh" "$HERE/defects-doc.html")
EDGE=$(bash "$HERE/../lint.sh" "$HERE/edge-cases.html")
fail=0
expect() { # <check> <theme> <viewport> [json-var-name, default OUT]
  local src=${4:-OUT}
  if echo "${!src}" | jq -e --arg c "$1" --arg t "$2" --argjson v "$3" \
      '[.findings[] | select(.check == $c and .theme == $t and .viewport == $v)] | length > 0' >/dev/null; then
    echo "ok   $1 ($2, ${3}px)"
  else
    echo "MISS $1 ($2, ${3}px)"; fail=1
  fi
}
expect svg-text-overlap      light 1280
expect svg-text-outside      light 1280
expect svg-text-on-stroke    light 1280
expect svg-text-small        light 1280
expect svg-text-small-korean light 1280
expect html-clipped          light 1280
expect contrast              light 1280
expect contrast              dark  1280
expect page-overflow         light 400
expect page-overflow-source  light 400
expect figure-scrolls        light 400
expect figure-graph-nosvg    light 1280
expect svg-no-edges          light 1280
expect author-first-person   light 1280
expect authoring-notes-mention light 1280
expect number-not-in-source  light 1280
expect masthead-date-not-in-source light 1280
expect svg-foreignobject     light 1280
expect svg-literal-color     light 1280
expect word-break-korean     light 1280
expect hidden-at-rest        light 1280
expect theme-state-mismatch  light 1280
expect theme-state-mismatch  dark  1280
expect html-lang             light 1280 DOC
expect body-bg-transparent   light 1280 DOC
expect title-name            light 1280 DOC
expect duplicate-id          light 1280 DOC
expect theme-token-scope     light 1280 DOC
expect svg-no-label          light 1280
expect svg-embedded-code     light 1280
# detail-level checks: the planted values are reported, the source-backed ones are not
absent() { # <label> <jq-filter returning true when the finding exists>
  if echo "$OUT" | jq -e "$2" >/dev/null; then echo "FAIL $1"; fail=1; else echo "ok   $1"; fi
}
present() {
  if echo "$OUT" | jq -e "$2" >/dev/null; then echo "ok   $1"; else echo "MISS $1"; fail=1; fi
}
present_in() { # <json-var-name> <label> <jq filter that is true when the expectation holds>
  if echo "${!1}" | jq -e "$3" >/dev/null; then echo "ok   $2"; else echo "MISS $2"; fail=1; fi
}
present "9999 is reported as not in the source" '[.findings[] | select(.check=="number-not-in-source" and (.detail | contains("9999")))] | length > 0'
absent  "1,620 and 41 (in the source) are not reported" '[.findings[] | select(.check=="number-not-in-source" and (.detail | test("\"1,620\"|\"41\"")))] | length > 0'
present "masthead date 2026-10-19 is reported" '[.findings[] | select(.check=="masthead-date-not-in-source" and (.detail | contains("2026-10-19")))] | length > 0'
absent  "masthead date 2026-10-17 (in the source) is not reported" '[.findings[] | select(.check=="masthead-date-not-in-source" and (.detail | contains("2026-10-17")))] | length > 0'
absent  "10월 17일 (in the source) is not reported" '[.findings[] | select(.check=="number-not-in-source" and (.detail | contains("17일")))] | length > 0'
present "exactly one figure is flagged figure-graph-nosvg" '[.findings[] | select(.check=="figure-graph-nosvg")] | length == 1'
present "exactly one svg is flagged svg-no-edges" '[.findings[] | select(.check=="svg-no-edges")] | length == 1'
# each path of a two-path check has its own planted element and its own assertion
present_in DOC "theme-token-scope: token defined only in the dark block (--only-dark)" '[.findings[] | select(.check=="theme-token-scope" and (.detail | test("only inside a theme block.*--only-dark")))] | length == 1'
present_in DOC "theme-token-scope: literal colour outside the token blocks (.hard-coded)" '[.findings[] | select(.check=="theme-token-scope" and (.detail | test("literal colour.*\\.hard-coded")))] | length == 1'
present_in OUT "hidden-at-rest: opacity path (reveal)" '[.findings[] | select(.check=="hidden-at-rest" and (.detail | contains("effective opacity")) and (.where | contains("reveal")))] | length == 1'
present_in OUT "hidden-at-rest: visibility path (reveal-visibility)" '[.findings[] | select(.check=="hidden-at-rest" and (.detail | contains("visibility: hidden")) and (.where | contains("reveal-visibility")))] | length == 1'
present_in DOC "body-bg-transparent is reported once per page, not once per theme run" '[.findings[] | select(.check=="body-bg-transparent")] | length == 1'
present_in EDGE "html-only background: no body-bg-transparent" '[.findings[] | select(.check=="body-bg-transparent")] | length == 0'
present_in EDGE "7 unlabeled + 1 dangling aria-labelledby = 8 svg-no-label findings, all counted in the summary" '([.findings[] | select(.check=="svg-no-label")] | length) == 8 and .summary.byCheck["svg-no-label"] == 8'
present_in EDGE "dangling aria-labelledby is flagged" '[.findings[] | select(.check=="svg-no-label" and (.where | contains("svg#dangling")))] | length == 1'
present_in EDGE "resolving aria-labelledby is accepted" '[.findings[] | select(.check=="svg-no-label" and (.where | contains("svg#resolved")))] | length == 0'
# the clean fixture: SVG graphs with edges, source-backed numbers, no errors and no new-check warnings
if echo "$CLEAN" | jq -e '.summary.errors == 0 and ([.findings[] | select(.check | test("^(figure-graph-nosvg|svg-no-edges|author-first-person|authoring-notes-mention|number-not-in-source|masthead-date-not-in-source|svg-foreignobject|svg-literal-color|html-lang|word-break-korean|hidden-at-rest|body-bg-transparent|theme-state-mismatch|title-name|duplicate-id|theme-token-scope|svg-no-label|svg-embedded-code)$"))] | length == 0)' >/dev/null; then
  echo "ok   clean fixture: 0 errors, no graph/prose/source findings"
else
  echo "FAIL clean fixture flagged:"; echo "$CLEAN" | jq -c '.summary, [.findings[] | select(.severity != "info") | {check, detail}]'; fail=1
fi
# the dark-only token must not be reported in light, and the light-only one not in dark
echo "$OUT" | jq -e '[.findings[] | select(.check=="contrast" and .theme=="light" and .text=="dark-theme contrast defect")] | length == 0' >/dev/null \
  && echo "ok   no false light-theme report for the dark-only defect" || { echo "FAIL dark-only defect reported in light"; fail=1; }
echo "$OUT" | jq -e '[.findings[] | select(.check=="contrast" and .theme=="dark" and .text=="light-theme contrast defect")] | length == 0' >/dev/null \
  && echo "ok   no false dark-theme report for the light-only defect" || { echo "FAIL light-only defect reported in dark"; fail=1; }
# receipt: clean fixture writes a valid receipt; defects fixture (errors > 0) writes none
RT=$(mktemp -d); trap 'rm -rf "$RT"' EXIT
bash "$HERE/../lint.sh" "$HERE/clean.html" --source "$HERE/source" --receipt "$RT/clean.json" >/dev/null
bash "$HERE/../lint.sh" "$HERE/defects.html" --source "$HERE/source" --receipt "$RT/defects.json" >/dev/null
SUM=$(shasum -a 256 "$HERE/clean.html" | cut -d' ' -f1)
if jq -e --arg sha "$SUM" --arg src "$(cd "$HERE/source" && pwd)" --arg p "$HERE/clean.html" '
    (keys | sort) == (["schema_version","html_sha256","html_path","errors","warnings","runs","source","source_sha256","lint_js_sha256","created_at"] | sort)
    and .schema_version == 2 and .source_sha256 == null and .html_sha256 == $sha and (.html_path | startswith("/")) and (.html_path | endswith("/clean.html"))
    and .errors == 0 and (.warnings | type == "number") and .source == $src
    and (.lint_js_sha256 | test("^[0-9a-f]{64}$")) and (.created_at | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]{8}Z$"))
    and .runs == [{viewport:1280,theme:"light"},{viewport:1280,theme:"dark"},{viewport:400,theme:"light"}]' "$RT/clean.json" >/dev/null; then
  echo "ok   receipt: clean fixture writes a valid receipt with matching html_sha256"
else
  echo "FAIL receipt content:"; cat "$RT/clean.json" 2>&1; fail=1
fi
[ ! -e "$RT/defects.json" ] && echo "ok   receipt: none written when errors > 0" || { echo "FAIL receipt written despite errors"; fail=1; }
bash "$HERE/../lint.sh" "$HERE/clean.html" --receipt "$RT/nosrc.json" >/dev/null
jq -e '.source == null' "$RT/nosrc.json" >/dev/null && echo "ok   receipt: source is null without --source" || { echo "FAIL receipt source null"; fail=1; }
bash "$HERE/../lint.sh" "$HERE/clean.html" --source "$HERE/source/incident.md" --receipt "$RT/file.json" >/dev/null
FSUM=$(shasum -a 256 "$HERE/source/incident.md" | cut -d' ' -f1)
jq -e --arg s "$FSUM" '.schema_version == 2 and .source_sha256 == $s' "$RT/file.json" >/dev/null && echo "ok   receipt: source_sha256 equals the sha256 of a file source" || { echo "FAIL receipt file source_sha256"; fail=1; }
jq -e '.source_sha256 == null' "$RT/nosrc.json" >/dev/null && echo "ok   receipt: source_sha256 is null without --source" || { echo "FAIL receipt nosrc source_sha256"; fail=1; }

# capture.sh page errors: a flood of long errors must not crash it (argv limit), and a scroll-time error
# belongs to the configuration that scrolled, including the last configuration
CAP=$(mktemp -d)
if bash "$HERE/../capture.sh" "$HERE/errors-flood.html" "$CAP/flood" >"$CAP/flood.txt" 2>&1 \
   && [ "$(find "$CAP/flood" -name '*.png' | wc -l)" -ge 4 ] \
   && [ "$(grep -c '^page errors .*: unknown (error buffer full)$' "$CAP/flood.txt")" = 4 ]; then
  echo "ok   capture.sh: 1100 long page errors -> exit 0, PNGs written, 'unknown (error buffer full)'"
else
  echo "FAIL capture.sh error flood:"; cat "$CAP/flood.txt"; fail=1
fi
if bash "$HERE/../capture.sh" "$HERE/errors-on-scroll.html" "$CAP/scroll" >"$CAP/scroll.txt" 2>&1 \
   && grep -q '^page errors 1280 light: 0$' "$CAP/scroll.txt" \
   && grep -q '^page errors 1280 dark: 1 - Error: scroll-boom$' "$CAP/scroll.txt" \
   && grep -q '^page errors 400 light: 0$' "$CAP/scroll.txt" \
   && grep -q '^page errors 400 dark: 1 - Error: scroll-boom$' "$CAP/scroll.txt"; then
  echo "ok   capture.sh: scroll-time errors are attributed to the scrolling configuration, last one included"
else
  echo "FAIL capture.sh scroll attribution:"; cat "$CAP/scroll.txt"; fail=1
fi
rm -rf "$CAP"
exit $fail

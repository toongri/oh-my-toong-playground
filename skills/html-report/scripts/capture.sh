#!/usr/bin/env bash
# capture.sh - screenshot a local HTML report for visual self-critique, through agent-browser.
#
# Usage: capture.sh <page.html> <out-dir> [--state '<js run after load>'] [--offline] [--max-frames N]
#
# For each of 1280px light, 1280px dark, 400px light and 400px dark it writes
#   <name>-<width>-<theme>-p01.png, -p02.png ...   viewport frames scrolled top to bottom (96px overlap)
#   <name>-<width>-<theme>-fig<N>.png              each <figure> scrolled to the top of the viewport
#   <name>-400-<theme>-fig<N>-end.png              the same figure with its sideways scroller at the far end (400px only)
# and prints, per configuration, document scrollWidth vs innerWidth (the page must never be wider),
# then one line "page errors <width> <theme>: <N>" or "page errors <width> <theme>: <N> - <first message>",
# or "page errors <width> <theme>: unknown (error buffer full)" when agent-browser's 1000-entry error buffer
# is full (later errors cannot be counted), or "... unknown (console buffer full)" when its 1000-entry console
# buffer (all levels share it) is full (older messages were evicted, so the error count would be too low), or "page errors <width> <theme>: not checked (<reason>)".
# N counts uncaught JavaScript exceptions/script errors plus console messages of level error raised
# by that configuration's load and scrolling (printed once its frames and figures are captured).
# The line is informational: the exit code does not change. Needs jq.
#   --state    JavaScript evaluated after each load, to capture an interaction state (e.g. a selected tab)
#   --offline  block the network first, to see the page in its fallback fonts
set -euo pipefail

usage() { echo "usage: capture.sh <page.html> <out-dir> [--state '<js>'] [--offline] [--max-frames N]" >&2; exit 64; }
[ $# -ge 2 ] || usage
HTML=$1; OUT=$2; shift 2
STATE=""; OFFLINE=0; MAXF=40
while [ $# -gt 0 ]; do
  case "$1" in
    --state) [ $# -ge 2 ] || usage; STATE=$2; shift 2 ;;
    --offline) OFFLINE=1; shift ;;
    --max-frames) [ $# -ge 2 ] || usage; MAXF=$2; shift 2 ;;
    *) usage ;;
  esac
done
command -v agent-browser >/dev/null 2>&1 || { echo "capture.sh: 'agent-browser' not found on PATH" >&2; exit 69; }
[ -f "$HTML" ] || { echo "capture.sh: no such file: $HTML" >&2; exit 66; }
mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd)

ABS="$(cd "$(dirname "$HTML")" && pwd)/$(basename "$HTML")"
URL="file://$(printf '%s' "$ABS" | sed 's/%/%25/g; s/ /%20/g; s/#/%23/g; s/?/%3F/g')"
NAME=$(basename "$HTML" .html)
SESSION="hr-capture-$$"
ab() { agent-browser --session "$SESSION" "$@"; }

js() { printf '%s' "$1" | ab eval --stdin; }   # prints the evaluated value
settle='(async () => { await document.fonts.ready; await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); const a = document.getAnimations().filter(x => x.effect && x.effect.getTiming().iterations !== Infinity); await Promise.race([Promise.all(a.map(x => x.finished.catch(() => {}))), new Promise(r => setTimeout(r, 3000))]); return 1; })()'

PE_CAP=1000  # agent-browser keeps at most this many page errors; 'errors --clear' does not empty the buffer
PE_TMP=$(mktemp -d)
trap 'rm -rf "$PE_TMP"; ab close >/dev/null 2>&1 || true' EXIT
PE_START=""   # page-error buffer length right before the current configuration's open
pe_mark() { # records the buffer length; never fails. JSON goes through files, never argv (it can be megabytes).
  PE_START=""
  command -v jq >/dev/null 2>&1 || return 0
  ab errors --json >"$PE_TMP/mark.json" 2>/dev/null || return 0
  PE_START=$(jq -r '[.data.errors[]?] | length' "$PE_TMP/mark.json" 2>/dev/null) || PE_START=""
  return 0
}
page_errors() { # <width> <theme>; call after the configuration's scrolling and capture
  command -v jq >/dev/null 2>&1 || { echo "page errors $1 $2: not checked (jq not found)"; return 0; }
  [ -n "$PE_START" ] || { echo "page errors $1 $2: not checked (could not read the error buffer)"; return 0; }
  local total n m first
  ab errors --json >"$PE_TMP/pe.json" 2>/dev/null || { echo "page errors $1 $2: not checked (errors command failed)"; return 0; }
  ab console --json >"$PE_TMP/ce.json" 2>/dev/null || echo '{}' >"$PE_TMP/ce.json"
  ab console --clear >/dev/null 2>&1 || true
  total=$(jq -r '[.data.errors[]?] | length' "$PE_TMP/pe.json" 2>/dev/null) || { echo "page errors $1 $2: not checked (unreadable error list)"; return 0; }
  if [ "$total" -ge "$PE_CAP" ]; then echo "page errors $1 $2: unknown (error buffer full)"; return 0; fi
  m=$(jq -r '[.data.messages[]?] | length' "$PE_TMP/ce.json" 2>/dev/null) || m=0
  if [ "$m" -ge "$PE_CAP" ]; then echo "page errors $1 $2: unknown (console buffer full)"; return 0; fi
  # jq slurps the two files; a malformed console file only drops the console half
  jq -c '[.data.messages[]? | select(.type == "error") | .text]' "$PE_TMP/ce.json" >"$PE_TMP/ce.list.json" 2>/dev/null || echo '[]' >"$PE_TMP/ce.list.json"
  jq -c '[.data.errors[]?.text]' "$PE_TMP/pe.json" >"$PE_TMP/pe.list.json" 2>/dev/null || { echo "page errors $1 $2: not checked (unreadable error list)"; return 0; }
  n=$(jq -n --slurpfile p "$PE_TMP/pe.list.json" --slurpfile c "$PE_TMP/ce.list.json" --argjson s "$PE_START" '($p[0][$s:] + $c[0]) | length' 2>/dev/null) || { echo "page errors $1 $2: not checked (jq failed)"; return 0; }
  first=$(jq -rn --slurpfile p "$PE_TMP/pe.list.json" --slurpfile c "$PE_TMP/ce.list.json" --argjson s "$PE_START" '($p[0][$s:] + $c[0]) | .[0] // "" | split("\n")[0] | .[0:300]' 2>/dev/null) || first=""
  if [ "$n" -gt 0 ]; then echo "page errors $1 $2: $n - $first"; else echo "page errors $1 $2: 0"; fi
}

shoot() { # <width> <height> <light|dark>
  local W=$1 H=$2 M=$3 tag="$NAME-$1-$3"
  ab set viewport "$W" "$H" >/dev/null
  ab set media "$M" >/dev/null
  [ "$OFFLINE" = 1 ] && ab set offline on >/dev/null
  ab console --clear >/dev/null 2>&1 || true
  pe_mark
  ab open "$URL" >/dev/null
  if [ -n "$STATE" ]; then ab eval "$STATE" >/dev/null; fi
  js "$settle" >/dev/null

  local sw iw sh step y=0 n=1
  sw=$(js 'document.documentElement.scrollWidth'); iw=$(js 'innerWidth'); sh=$(js 'document.documentElement.scrollHeight')
  step=$((H - 96))
  while [ "$n" -le "$MAXF" ]; do
    js "window.scrollTo(0, $y); new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(scrollY))))" >/dev/null
    ab screenshot "$OUT/$tag-p$(printf '%02d' "$n").png" >/dev/null
    [ $((y + H)) -ge "$sh" ] && break
    y=$((y + step)); n=$((n + 1))
  done

  local figs k=1 wide
  figs=$(js 'document.querySelectorAll("figure").length')
  while [ "$k" -le "$figs" ]; do
    js "(() => { const f = document.querySelectorAll('figure')[$k - 1]; f.querySelectorAll('*').forEach(e => { e.scrollLeft = 0; }); window.scrollTo(0, f.getBoundingClientRect().top + scrollY - 16); return 1; })()" >/dev/null
    ab screenshot "$OUT/$tag-fig$k.png" >/dev/null
    if [ "$W" -lt 700 ]; then
      wide=$(js "(() => { const f = document.querySelectorAll('figure')[$k - 1]; let hit = 0; f.querySelectorAll('*').forEach(e => { const o = getComputedStyle(e).overflowX; if ((o === 'auto' || o === 'scroll') && e.scrollWidth > e.clientWidth + 2) { e.scrollLeft = e.scrollWidth; hit = 1; } }); return hit; })()")
      [ "$wide" = 1 ] && ab screenshot "$OUT/$tag-fig$k-end.png" >/dev/null
    fi
    k=$((k + 1))
  done

  page_errors "$W" "$M"

  local verdict="ok" frames=$n more=""
  [ "$sw" -gt "$iw" ] && verdict="PAGE SCROLLS SIDEWAYS"
  if [ "$n" -gt "$MAXF" ]; then frames=$MAXF; more=" (stopped at --max-frames; page continues)"; fi
  echo "$W $M: scrollWidth $sw / innerWidth $iw ($verdict); $frames frames$more, $figs figures"
}

shoot 1280 900 light
shoot 1280 900 dark
shoot 400 860 light
shoot 400 860 dark
echo "screenshots: $OUT"

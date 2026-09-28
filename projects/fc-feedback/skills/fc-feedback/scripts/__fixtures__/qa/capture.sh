#!/usr/bin/env bash
set -euo pipefail

# fc-feedback visual-QA capture script (plan §7 T11, §12 item 6, §13.1 item 1,
# §14.8; DESIGN.md §12/§13).
#
# Usage: capture.sh [--headed] <out-dir> <shots-dir> [--only id1,id2,...]
#   <out-dir>    -- output of build.sh: <out-dir>/empty and <out-dir>/archive.
#   <shots-dir>  -- where PNGs + capture-manifest.json + functional.json land.
#   --headed     -- run agent-browser with a visible browser. Required for the
#                   approved-round headed re-check of the player_api items
#                   (plan §13.1 item 1, §14.8): headed player_api checks must
#                   be recorded pass/fail, never skipped.
#   --only ids   -- re-shoot only these capture-manifest ids; every other id
#                   is carried over unchanged from an existing manifest in
#                   <shots-dir> (its sha256/mtime kept, file kept on disk).
#                   Requires a prior full run's capture-manifest.json to exist
#                   in <shots-dir> -- there is no partial set to fall back to.
#                   functional.json is always regenerated in full, regardless
#                   of --only, since it is independent of which screenshots
#                   were reshot.
#
# Serves <out-dir> over HTTP (python3 -m http.server) because file:// breaks
# the YouTube iframe embed. Drives the rendered pages with agent-browser
# (skill: agent-browser) and writes exactly the 33 fixed shots + functional
# checks DESIGN.md §12 enumerates.
#
# ── A render.ts bug this script routes around without touching render.ts ──
# VIEWER_JS's auto-init line is `if (YT && YT.loaded) { initPlayer(); } else
# { window.onYouTubeIframeAPIReady = initPlayer; }` (render.ts, end of
# VIEWER_JS). `YT` is an *unqualified* identifier: before the async
# `iframe_api` script has ever created `window.YT`, merely reading bare `YT`
# throws `ReferenceError: YT is not defined` (confirmed live via a page
# `window.addEventListener('error', ...)` trap -- see this task's report),
# not "evaluates to undefined" the way `window.YT` would. That throw happens
# synchronously during VIEWER_JS's own top-level run, so the `else` branch's
# `window.onYouTubeIframeAPIReady = initPlayer;` assignment never executes,
# and the player never auto-initializes on a plain page load -- `#yt-player`
# stays empty (an empty black box) until a card or part button is clicked.
# A click *does* work, because by the time a user can click, the async
# script has normally already created `window.YT`, so the same bare `YT`
# reference inside `ensurePlayer` no longer throws.
#
# This script does NOT edit render.ts. It captures the real, current
# behavior for the `default`/`toc-*`/`filter-*`/`scroll-mid`/`full-page`
# states (an empty player box, exactly what a real user's first load shows
# today) and, only for the states/checks that already involve a click
# (`seek-part1`, `switch-part2`, the two `player_api` functional checks),
# waits for `window.YT.Player` to exist before clicking so that click's own
# player creation does not race the same bug. See this task's final report
# for the full finding, which is left for the user/orchestrator to act on.

usage() {
	cat <<'USAGE' >&2
usage: capture.sh [--headed] <out-dir> <shots-dir> [--only id1,id2,...]
USAGE
}

HEADED=false
ONLY=""
POSITIONAL=()
while [ "$#" -gt 0 ]; do
	case "$1" in
	--headed)
		HEADED=true
		shift
		;;
	--only)
		if [ "$#" -lt 2 ]; then
			echo "capture.sh: --only requires a value" >&2
			exit 1
		fi
		ONLY="$2"
		shift 2
		;;
	-h | --help)
		usage
		exit 0
		;;
	--)
		shift
		break
		;;
	-*)
		echo "capture.sh: unknown option: $1" >&2
		usage
		exit 1
		;;
	*)
		POSITIONAL+=("$1")
		shift
		;;
	esac
done
set -- "${POSITIONAL[@]+"${POSITIONAL[@]}"}"
if [ "$#" -lt 2 ]; then
	usage
	exit 1
fi

for tool in agent-browser python3 jq curl; do
	if ! command -v "$tool" >/dev/null 2>&1; then
		echo "capture.sh: required tool not found on PATH: $tool" >&2
		exit 1
	fi
done

mkdir -p "$2"
OUT="$(cd "$1" && pwd)"
SHOTS="$(cd "$2" && pwd)"

if [ ! -d "$OUT/empty" ] || [ ! -d "$OUT/archive" ]; then
	echo "capture.sh: $OUT does not look like a build.sh output (missing empty/ or archive/)" >&2
	exit 1
fi

PORT=8765
HTTPD_PID=""
SESSION=""

cleanup() {
	ec=$?
	if [ -n "$SESSION" ]; then
		agent-browser --session "$SESSION" close >/dev/null 2>&1 || true
	fi
	if [ -n "$HTTPD_PID" ]; then
		kill "$HTTPD_PID" >/dev/null 2>&1 || true
		wait "$HTTPD_PID" 2>/dev/null || true
	fi
	exit "$ec"
}
trap cleanup EXIT INT TERM

python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$OUT" >/dev/null 2>&1 &
HTTPD_PID=$!

BASE="http://127.0.0.1:$PORT"
ready=false
i=0
while [ "$i" -lt 50 ]; do
	if curl -s -o /dev/null "$BASE/"; then
		ready=true
		break
	fi
	sleep 0.2
	i=$((i + 1))
done
if [ "$ready" != true ]; then
	echo "capture.sh: http.server on $BASE never became ready" >&2
	exit 1
fi

SESSION="$(agent-browser session id --scope worktree --prefix fc-feedback-qa)-$$"
export AGENT_BROWSER_SESSION="$SESSION"

AB_FLAGS=()
if [ "$HEADED" = true ]; then
	AB_FLAGS+=(--headed)
fi

ab() { agent-browser "${AB_FLAGS[@]+"${AB_FLAGS[@]}"}" --session "$SESSION" "$@"; }

# The single English-language ref page id is derived from the fixture's own
# archive/index.json rather than hardcoded, so a fixture edit that changes
# the ref's URL (and therefore its sha256-derived id) cannot silently point
# ref-en-* at a stale/missing page.
REF_EN_PAGE="$(jq -r '[.refs[] | select(.lang == "en")][0].page // empty' "$OUT/archive/index.json")"
if [ -z "$REF_EN_PAGE" ]; then
	echo "capture.sh: no lang=en ref found in $OUT/archive/index.json" >&2
	exit 1
fi

page_url() {
	case "$1" in
	viewer) printf '%s' "$BASE/archive/sessions/20240104-NUzEChn9EyI/index.html" ;;
	past) printf '%s' "$BASE/archive/sessions/20240103-XkM_tS2Id8Q/index.html" ;;
	archive) printf '%s' "$BASE/archive/index.html" ;;
	archive-empty) printf '%s' "$BASE/empty/index.html" ;;
	ref) printf '%s' "$BASE/archive/$REF_EN_PAGE" ;;
	*)
		echo "capture.sh: unknown page key: $1" >&2
		return 1
		;;
	esac
}

is_png() {
	python3 -c "
import sys
with open(sys.argv[1], 'rb') as f:
    sys.exit(0 if f.read(8) == b'\x89PNG\r\n\x1a\n' else 1)
" "$1"
}

sha256_of() {
	if command -v shasum >/dev/null 2>&1; then
		shasum -a 256 "$1" | awk '{print $1}'
	else
		sha256sum "$1" | awk '{print $1}'
	fi
}

mtime_of() {
	if v="$(stat -f %m "$1" 2>/dev/null)"; then
		printf '%s' "$v"
	else
		stat -c %Y "$1"
	fi
}

# Waits (best-effort) for the YouTube iframe API to be usable, so a click
# that follows creates a real embedded player instead of racing the
# render.ts bug documented above. Never fails the caller: a screenshot state
# still has value (matching real first-load behavior) even if this wait
# times out.
wait_yt_api() {
	ab wait --fn "typeof window.YT !== 'undefined' && typeof window.YT.Player === 'function'" --timeout "$1" >/dev/null 2>&1 || true
}

# ── viewer interaction states (DESIGN.md §12, 12 states × 2 viewports) ─────
#
# filter-topic-multi drives "수비전환" + "역습": DESIGN.md's own example
# ("빌드업" + "전환/역습") names topic tags that do not exist verbatim in
# this fixture's taxonomy (archive-seed/taxonomy.yaml: 빌드업/오버래핑/역습/
# 수비전환/마무리) or in work-current/plan.json's actual topic titles; 역습
# ("전환/역습"'s counter-attack half) and 수비전환 ("전환" -- transition to
# defense) are the closest existing pair and together select 6 of 15 cards
# (u007..u011,u015), a non-trivial multi-select OR to capture.
# filter-mention picks han-fw (한지우): 2 cards mention him directly.
# filter-member picks yoon-fb (윤도훈): relatedMembers matches him on 3 cards
# (u002/u004/u005) via position closure, not just direct mention, so this
# state exercises the "관련 팀원" (position-based) filter path specifically.
# filter-empty-gk picks baek-gk (백기영), the GK member the fixture roster
# comments is tagged/mentioned nowhere -- the documented 0-result state.
drive_state() {
	case "$1" in
	default | full-page | scroll-mid-noop) : ;;
	toc-match) ab click '#tab-match' >/dev/null ;;
	toc-topic) ab click '#tab-topic' >/dev/null ;;
	filter-position-fb) ab click '.chip-filter[data-group="position"][data-value="FB"]' >/dev/null ;;
	filter-topic-multi)
		ab click '.chip-filter[data-group="topic"][data-value="수비전환"]' >/dev/null
		ab click '.chip-filter[data-group="topic"][data-value="역습"]' >/dev/null
		;;
	filter-mention) ab click '.chip-filter[data-group="mention"][data-value="han-fw"]' >/dev/null ;;
	filter-member) ab click '.chip-filter[data-group="related"][data-value="yoon-fb"]' >/dev/null ;;
	filter-empty-gk) ab click '.chip-filter[data-group="related"][data-value="baek-gk"]' >/dev/null ;;
	seek-part1)
		wait_yt_api 20000
		ab click '.card#u002' >/dev/null
		;;
	switch-part2)
		wait_yt_api 20000
		ab click '.card#u010' >/dev/null
		;;
	scroll-mid)
		printf '%s' 'window.scrollTo(0, Math.floor(document.body.scrollHeight / 2))' | ab eval --stdin >/dev/null
		;;
	*)
		echo "capture.sh: unknown state: $1" >&2
		return 1
		;;
	esac
}

take_shot() {
	# $1 = destination file, $2 = state (full-page uses a full-length capture)
	if [ "$2" = "full-page" ]; then
		ab screenshot "$1" --full >/dev/null
	else
		ab screenshot "$1" >/dev/null
	fi
}

# ── the 33 fixed shots (DESIGN.md §12) ─────────────────────────────────────
# id|page-key|width|height|state
SHOT_TABLE='
default-390x844|viewer|390|844|default
default-1440x900|viewer|1440|900|default
default-1024x768|viewer|1024|768|default
toc-match-390x844|viewer|390|844|toc-match
toc-match-1440x900|viewer|1440|900|toc-match
toc-topic-390x844|viewer|390|844|toc-topic
toc-topic-1440x900|viewer|1440|900|toc-topic
filter-position-fb-390x844|viewer|390|844|filter-position-fb
filter-position-fb-1440x900|viewer|1440|900|filter-position-fb
filter-topic-multi-390x844|viewer|390|844|filter-topic-multi
filter-topic-multi-1440x900|viewer|1440|900|filter-topic-multi
filter-mention-390x844|viewer|390|844|filter-mention
filter-mention-1440x900|viewer|1440|900|filter-mention
filter-member-390x844|viewer|390|844|filter-member
filter-member-1440x900|viewer|1440|900|filter-member
filter-empty-gk-390x844|viewer|390|844|filter-empty-gk
filter-empty-gk-1440x900|viewer|1440|900|filter-empty-gk
seek-part1-390x844|viewer|390|844|seek-part1
seek-part1-1440x900|viewer|1440|900|seek-part1
switch-part2-390x844|viewer|390|844|switch-part2
switch-part2-1440x900|viewer|1440|900|switch-part2
scroll-mid-390x844|viewer|390|844|scroll-mid
scroll-mid-1440x900|viewer|1440|900|scroll-mid
full-page-390x844|viewer|390|844|full-page
full-page-1440x900|viewer|1440|900|full-page
past-session-390|past|390|844|default
past-session-1440|past|1440|900|default
archive-with-sessions-390|archive|390|844|default
archive-with-sessions-1440|archive|1440|900|default
archive-empty-390|archive-empty|390|844|default
archive-empty-1440|archive-empty|1440|900|default
ref-en-390|ref|390|844|default
ref-en-1440|ref|1440|900|default
'

OLD_MANIFEST="$SHOTS/capture-manifest.json"
HAS_OLD_MANIFEST=false
if [ -f "$OLD_MANIFEST" ]; then
	HAS_OLD_MANIFEST=true
fi

is_selected() {
	if [ -z "$ONLY" ]; then
		return 0
	fi
	case ",$ONLY," in
	*",$1,"*) return 0 ;;
	*) return 1 ;;
	esac
}

old_entry_for() {
	if [ "$HAS_OLD_MANIFEST" != true ]; then
		echo "capture.sh: --only given but no existing manifest at $OLD_MANIFEST to reuse '$1' from" >&2
		exit 1
	fi
	entry="$(jq -c --arg id "$1" '[.[] | select(.id == $id)][0] // empty' "$OLD_MANIFEST")"
	if [ -z "$entry" ]; then
		echo "capture.sh: --only given but $OLD_MANIFEST has no entry for '$1'" >&2
		exit 1
	fi
	entry_file="$(printf '%s' "$entry" | jq -r '.file')"
	if [ ! -f "$SHOTS/$entry_file" ]; then
		echo "capture.sh: reused entry for '$1' points at missing file $SHOTS/$entry_file" >&2
		exit 1
	fi
	printf '%s' "$entry"
}

MANIFEST_ENTRIES=()

while IFS='|' read -r id page_key vw vh state; do
	if [ -z "$id" ]; then
		continue
	fi
	if is_selected "$id"; then
		url="$(page_url "$page_key")"
		ab set viewport "$vw" "$vh" >/dev/null
		ab open "$url" >/dev/null
		drive_state "$state"
		file="$id.png"
		take_shot "$SHOTS/$file" "$state"
		if ! is_png "$SHOTS/$file"; then
			echo "capture.sh: $file is not a valid PNG" >&2
			exit 1
		fi
		sha="$(sha256_of "$SHOTS/$file")"
		mt="$(mtime_of "$SHOTS/$file")"
		rel_page="${url#"$BASE"/}"
		entry="$(jq -n \
			--arg id "$id" \
			--arg page "$rel_page" \
			--arg state "$state" \
			--arg viewport "${vw}x${vh}" \
			--arg file "$file" \
			--arg sha256 "$sha" \
			--argjson mtime "$mt" \
			'{id: $id, page: $page, state: $state, viewport: $viewport, file: $file, sha256: $sha256, mtime: $mtime}')"
	else
		entry="$(old_entry_for "$id")"
	fi
	MANIFEST_ENTRIES+=("$entry")
done <<EOF
$SHOT_TABLE
EOF

{
	for e in "${MANIFEST_ENTRIES[@]+"${MANIFEST_ENTRIES[@]}"}"; do
		printf '%s\n' "$e"
	done
} | jq -s '.' >"$SHOTS/capture-manifest.json"

manifest_len="$(jq 'length' "$SHOTS/capture-manifest.json")"
if [ "$manifest_len" -ne 33 ]; then
	echo "capture.sh: capture-manifest.json has $manifest_len entries, expected 33" >&2
	exit 1
fi

for f in $(jq -r '.[] | .file' "$SHOTS/capture-manifest.json"); do
	if ! is_png "$SHOTS/$f"; then
		echo "capture.sh: $f is not a valid PNG" >&2
		exit 1
	fi
done

# ── functional checks (DESIGN.md §12 "기능 검사") ──────────────────────────
# Always run in full regardless of --only: independent of which screenshot
# ids were reshot, and cheap next to the 33 screenshots above.

FUNCTIONAL_ENTRIES=()

add_check() {
	# $1 name, $2 kind (dom|player_api), $3 pass (true/false, JSON literal),
	# $4 skipped_reason text or "" for null.
	if [ -z "$4" ]; then
		reason_json=null
	else
		reason_json="$(printf '%s' "$4" | jq -Rs .)"
	fi
	entry="$(jq -n \
		--arg name "$1" \
		--arg kind "$2" \
		--argjson pass "$3" \
		--argjson reason "$reason_json" \
		'{name: $name, kind: $kind, pass: $pass, skipped_reason: $reason}')"
	FUNCTIONAL_ENTRIES+=("$entry")
}

# Runs JS via `eval --stdin`, always returning valid JSON: `.data.result` on
# success, or the JSON literal `false` (with the real error on stderr) so a
# thrown/failed eval reads as a failing check instead of a null pass.
eval_js() {
	out="$(ab eval --stdin --json)"
	if [ "$(printf '%s' "$out" | jq -r '.success')" != "true" ]; then
		echo "capture.sh: eval failed: $(printf '%s' "$out" | jq -r '.error')" >&2
		printf 'false'
		return 0
	fi
	printf '%s' "$out" | jq -c '.data.result'
}

run_dom_checks() {
	url="$(page_url viewer)"
	ab set viewport 1440 900 >/dev/null
	ab open "$url" >/dev/null

	ab click '.card#u002' >/dev/null
	pass="$(eval_js <<'JS'
document.body.dataset.video === "NUzEChn9EyI"
JS
	)"
	add_check "카드 클릭 후 body.dataset.video가 클릭한 카드의 videoId와 일치한다" dom "$pass" ""

	pass="$(eval_js <<'JS'
document.querySelectorAll(".card--highlighted").length === 0
JS
	)"
	add_check "카드 클릭은 card--highlighted를 추가하지 않는다(목차 클릭과의 강조 상태 구분)" dom "$pass" ""

	ab click '.card#u010' >/dev/null
	pass="$(eval_js <<'JS'
document.querySelector('.part-btn[data-video="NUzEChn9EyI"]').getAttribute("aria-pressed") === "false" &&
document.querySelector('.part-btn[data-video="yn-qm7lM5p4"]').getAttribute("aria-pressed") === "true"
JS
	)"
	add_check "다른 파트 카드 클릭 후 그 파트 버튼만 aria-pressed=true가 된다" dom "$pass" ""

	before_video="$(eval_js <<'JS'
document.body.dataset.video
JS
	)"
	ab click '.toc-item[data-target="u008"]' >/dev/null
	pass="$(eval_js <<JS
document.body.dataset.video === $before_video &&
document.getElementById("u008").classList.contains("card--highlighted")
JS
	)"
	add_check "목차 클릭은 대상 카드를 스크롤·강조하고 영상 전환(seek)은 발생시키지 않는다" dom "$pass" ""

	ab click '.chip-filter[data-group="position"][data-value="FB"]' >/dev/null
	ab click '.filter-reset' >/dev/null
	pass="$(eval_js <<'JS'
document.getElementById("visible-count").textContent === document.getElementById("total-count").textContent
JS
	)"
	add_check "필터 초기화 후 결과 수가 전체 개수로 복귀한다" dom "$pass" ""

	ab click '#tab-topic' >/dev/null
	pass="$(eval_js <<'JS'
document.getElementById("tab-topic").getAttribute("aria-selected") === "true" &&
document.getElementById("tab-match").getAttribute("aria-selected") === "false"
JS
	)"
	add_check "탭 클릭 후 aria-selected가 전환된다" dom "$pass" ""
}

run_player_checks() {
	url="$(page_url viewer)"
	ab set viewport 1440 900 >/dev/null
	ab open "$url" >/dev/null

	api_timeout=20000
	seek_timeout=15000
	switch_timeout=15000
	if [ "$HEADED" = true ]; then
		api_timeout=45000
		seek_timeout=30000
		switch_timeout=30000
	fi

	api_ready=true
	if ! ab wait --fn "typeof window.YT !== 'undefined' && typeof window.YT.Player === 'function'" --timeout "$api_timeout" >/dev/null 2>&1; then
		api_ready=false
	fi

	seek_pass=false
	if [ "$api_ready" = true ]; then
		ab click '.card#u002' >/dev/null # u002 start=180 on part 1
		if ab wait --fn "window.fcPlayer && typeof window.fcPlayer.getCurrentTime === 'function' && Math.abs(window.fcPlayer.getCurrentTime() - 180) <= 2" --timeout "$seek_timeout" >/dev/null 2>&1; then
			seek_pass=true
		fi
	fi
	if [ "$HEADED" = true ]; then
		add_check "seek 후 fcPlayer.getCurrentTime()가 카드 시작 시각과 ±2초 이내로 일치한다" player_api "$seek_pass" ""
	elif [ "$seek_pass" = true ]; then
		add_check "seek 후 fcPlayer.getCurrentTime()가 카드 시작 시각과 ±2초 이내로 일치한다" player_api true ""
	else
		add_check "seek 후 fcPlayer.getCurrentTime()가 카드 시작 시각과 ±2초 이내로 일치한다" player_api false "헤드리스 환경에서 YouTube 플레이어 초기화/재생이 제한되어 판정 불가(네트워크 또는 재생 정책 제약)"
	fi

	switch_pass=false
	if [ "$api_ready" = true ]; then
		ab click '.card#u010' >/dev/null # u010 = part 2 (yn-qm7lM5p4)
		if ab wait --fn "window.fcPlayer && window.fcPlayer.getVideoData && window.fcPlayer.getVideoData().video_id === 'yn-qm7lM5p4'" --timeout "$switch_timeout" >/dev/null 2>&1; then
			switch_pass=true
		fi
	fi
	if [ "$HEADED" = true ]; then
		add_check "파트 전환 후 fcPlayer.getVideoData().video_id가 목표 파트의 videoId와 일치한다" player_api "$switch_pass" ""
	elif [ "$switch_pass" = true ]; then
		add_check "파트 전환 후 fcPlayer.getVideoData().video_id가 목표 파트의 videoId와 일치한다" player_api true ""
	else
		add_check "파트 전환 후 fcPlayer.getVideoData().video_id가 목표 파트의 videoId와 일치한다" player_api false "헤드리스 환경에서 YouTube 플레이어 초기화/재생이 제한되어 판정 불가(네트워크 또는 재생 정책 제약)"
	fi
}

run_dom_checks
run_player_checks

{
	for e in "${FUNCTIONAL_ENTRIES[@]+"${FUNCTIONAL_ENTRIES[@]}"}"; do
		printf '%s\n' "$e"
	done
} | jq -s '.' >"$SHOTS/functional.json"

if ! jq -e '[.[] | select(.kind == "dom")] | all(.pass)' "$SHOTS/functional.json" >/dev/null; then
	echo "capture.sh: one or more dom functional checks failed, see $SHOTS/functional.json" >&2
	exit 1
fi

if [ "$HEADED" = true ]; then
	if ! jq -e '[.[] | select(.kind == "player_api")] | all(.pass == true and .skipped_reason == null)' "$SHOTS/functional.json" >/dev/null; then
		echo "capture.sh: --headed run has a player_api check that is not pass:true/skipped_reason:null, see $SHOTS/functional.json" >&2
		exit 1
	fi
fi

echo "{\"ok\":true,\"manifest\":$manifest_len,\"functional\":$(jq 'length' "$SHOTS/functional.json")}"

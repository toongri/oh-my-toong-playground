#!/usr/bin/env bash
set -euo pipefail

# fc-feedback visual-QA capture script (plan §7 T11, §12 item 6, §13.1 item 1,
# §14.8; DESIGN.md v2 §14/§15).
#
# Usage: capture.sh [--headed] <out-dir> <shots-dir> [--only id1,id2,...]
#   <out-dir>    -- output of build.sh: <out-dir>/empty, <out-dir>/archive,
#                   <out-dir>/disabled-mode, <out-dir>/embed-blocked.
#   <shots-dir>  -- where PNGs + capture-manifest.json + functional.json land.
#   --headed     -- run agent-browser with a visible browser. Required for the
#                   approved-round headed re-check of the player_api items
#                   (plan §13.1 item 1, §14.8; DESIGN.md §14): headed
#                   player_api checks must be recorded pass/fail, never
#                   skipped.
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
# (skill: agent-browser) and writes exactly the 37 fixed shots (DESIGN.md v2
# §14) + the functional checks §14/§15 enumerate.
#
# ── Selectors follow DESIGN.md's markup contract, not the current render.ts ──
# render.ts is being rewritten to the v2 §4/§5/§6 contract by a parallel task
# while this script is written, so the live HTML may not match it yet. Every
# selector below is chosen to match a DESIGN.md-given name where the design
# gives one verbatim (`.side-col`, `.player-wrapper`, `.player-collapse`,
# `.body-frame`/`data-frame-t`, `.zoom-link`, `.card--highlighted`,
# `.pill.pill-mine[data-group="mine"][data-value=...]`,
# `data-member-ids`/`data-related-ids`, `role="tablist"`/`role="tab"`). For
# markup DESIGN.md describes only behaviorally and never names a class for
# (filter-bar chips, tabs, TOC items, the filter-reset button, the result
# count, part-switch buttons, the mention badge, the card root's own `id`),
# this script keeps the same names the project's pre-v2 render.ts already
# uses (`.chip-filter[data-group][data-value]`, `#tab-match`/`#tab-topic`,
# `.toc-item[data-target]`, `.filter-reset`, `#visible-count`/`#total-count`,
# `.part-btn[data-video]`, `.card#<unitId>`, `.mention-badge`) since v2 does
# not redefine or remove any of them -- only §4's layout wrappers, §5's card
# anatomy, and §6's "내 피드백" primary control are new.
#
# ── A render.ts bug this script used to route around -- now fixed ──
# VIEWER_JS's auto-init line used to read bare `YT` (`if (YT && YT.loaded)
# { initPlayer(); } else { window.onYouTubeIframeAPIReady = initPlayer; }`):
# before the async `iframe_api` script had ever created `window.YT`, reading
# that unqualified identifier threw `ReferenceError: YT is not defined`
# instead of evaluating to undefined, so the `else` branch's registration
# never ran and the player never auto-initialized on a plain page load.
# render.ts now reads `window.YT && window.YT.loaded` (DESIGN.md §9), so a
# cold load with no `window.YT` yet registers `onYouTubeIframeAPIReady`
# instead of throwing; render.test.ts regression-tests this directly
# (`YT가 정의되기 전에 로드돼도 onYouTubeIframeAPIReady를 등록한다` and the
# pre-ready click-queue tests that follow it, which start from
# `runViewer(win, undefined)` -- a `window.YT`-absent cold load). This
# script still captures the `default`/`toc-*`/`filter-*`/`my-feedback`/
# `scroll-*`/`full-page` states before the async script has necessarily
# finished loading (an empty player box, same as a real user's first paint)
# and waits for `window.YT.Player` to exist before any click that creates
# the player (`seek-part1`, `switch-part2`, the body-frame checks, the
# `player_api` functional checks), simply because the iframe API loads
# asynchronously -- not to dodge the bug above, which no longer exists.

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

if [ ! -d "$OUT/empty" ] || [ ! -d "$OUT/archive" ] || [ ! -d "$OUT/disabled-mode" ] || [ ! -d "$OUT/embed-blocked" ]; then
	echo "capture.sh: $OUT does not look like a build.sh output (missing empty/, archive/, disabled-mode/ or embed-blocked/)" >&2
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

# The single English-language ref page id, and the disabled-mode/embed-blocked
# session ids, are all derived from the fixture's own build.sh output rather
# than hardcoded, so a fixture edit that changes a session id cannot silently
# point a page_url() case at a stale/missing page.
REF_EN_PAGE="$(jq -r '[.refs[] | select(.lang == "en")][0].page // empty' "$OUT/archive/index.json")"
if [ -z "$REF_EN_PAGE" ]; then
	echo "capture.sh: no lang=en ref found in $OUT/archive/index.json" >&2
	exit 1
fi

DISABLED_SESSION_DIR="$(find "$OUT/disabled-mode/sessions" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | head -n1)"
if [ -z "$DISABLED_SESSION_DIR" ]; then
	echo "capture.sh: no session directory found under $OUT/disabled-mode/sessions" >&2
	exit 1
fi
DISABLED_SESSION_ID="$(basename "$DISABLED_SESSION_DIR")"

EMBED_BLOCKED_SESSION_DIR="$(find "$OUT/embed-blocked/sessions" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | head -n1)"
if [ -z "$EMBED_BLOCKED_SESSION_DIR" ]; then
	echo "capture.sh: no session directory found under $OUT/embed-blocked/sessions" >&2
	exit 1
fi
EMBED_BLOCKED_SESSION_ID="$(basename "$EMBED_BLOCKED_SESSION_DIR")"

page_url() {
	case "$1" in
	viewer) printf '%s' "$BASE/archive/sessions/20240104-NUzEChn9EyI/index.html" ;;
	past) printf '%s' "$BASE/archive/sessions/20240103-XkM_tS2Id8Q/index.html" ;;
	archive) printf '%s' "$BASE/archive/index.html" ;;
	archive-empty) printf '%s' "$BASE/empty/index.html" ;;
	ref) printf '%s' "$BASE/archive/$REF_EN_PAGE" ;;
	disabled) printf '%s' "$BASE/disabled-mode/sessions/$DISABLED_SESSION_ID/index.html" ;;
	embed-blocked) printf '%s' "$BASE/embed-blocked/sessions/$EMBED_BLOCKED_SESSION_ID/index.html" ;;
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

# Round-8 visual QA: seek-part1/switch-part2 used to shoot right after the click that starts a
# seek/switch, before the async YouTube iframe had decoded or even buffered anything -- the
# resulting PNGs showed a black frame (seek-part1) or a "0:00 / 0:00" spinner (switch-part2), even
# though the click itself worked. This polls (loudly -- a real failure here means the seek/switch
# never landed, unlike wait_yt_api's best-effort wait for states that have value either way) until
# fcPlayer reports the target videoId, a currentTime within +/-2s of targetSeconds, AND a
# playerState of playing/paused/buffering (1/2/3, i.e. actually progressing, not still unstarted/
# cued) -- then pauses ONCE, after the target is confirmed reached, and settles briefly before the
# caller shoots. Pausing on every poll instead of once at the end was tried and found (see the
# frame-click comment in run_player_checks below) to itself break an in-flight loadVideoById, so
# this never touches pauseVideo before the target state is fully confirmed.
wait_player_target() {
	label="$1"
	video_id="$2"
	target_seconds="$3"
	timeout=20000
	if [ "$HEADED" = true ]; then
		timeout=45000
	fi
	if ! ab wait --fn "window.fcPlayer && window.fcPlayer.getVideoData && window.fcPlayer.getVideoData().video_id === '$video_id' && typeof window.fcPlayer.getCurrentTime === 'function' && Math.abs(window.fcPlayer.getCurrentTime() - $target_seconds) <= 2 && typeof window.fcPlayer.getPlayerState === 'function' && [1, 2, 3].indexOf(window.fcPlayer.getPlayerState()) !== -1" --timeout "$timeout" >/dev/null 2>&1; then
		echo "capture.sh: $label: fcPlayer never reached videoId=$video_id, time~=${target_seconds}s, state in {playing,paused,buffering} within ${timeout}ms" >&2
		exit 1
	fi
	eval_or_die "$label: pauseVideo() after reaching target failed" >/dev/null <<'JS'
(function () {
  window.fcPlayer.pauseVideo();
  return true;
})()
JS
	sleep 0.3
}

# Runs JS via `eval --stdin`, always returning valid JSON: `.data.result` on
# success, or the JSON literal `false` (with the real error on stderr) so a
# thrown/failed eval reads as a failing check instead of a null pass. Defined
# here (rather than only where the functional checks run) because drive_state
# below also needs it, to probe collapse state before an interaction.
eval_js() {
	out="$(ab eval --stdin --json)"
	if [ "$(printf '%s' "$out" | jq -r '.success')" != "true" ]; then
		echo "capture.sh: eval failed: $(printf '%s' "$out" | jq -r '.error')" >&2
		printf 'false'
		return 0
	fi
	printf '%s' "$out" | jq -c '.data.result'
}

# Like eval_js, but for state-mutating JS whose own failure must never be
# swallowed: aborts the whole capture run (clear message on stderr) instead
# of degrading to a non-fatal `false`. $1 is a short label used only in that
# abort message.
eval_or_die() {
	out="$(ab eval --stdin --json)"
	if [ "$(printf '%s' "$out" | jq -r '.success')" != "true" ]; then
		echo "capture.sh: $1: $(printf '%s' "$out" | jq -r '.error')" >&2
		exit 1
	fi
	printf '%s' "$out" | jq -c '.data.result'
}

# Clicks a CSS selector after first scrolling its center into the viewport.
# Root cause of the mobile (390px) multi-click filter defect this exists to
# fix: a plain `ab click` only auto-scrolls a target enough to satisfy its
# own "not covered" check, which can leave the element's actual click point
# outside `window.innerHeight` once the sticky `.player-wrapper`
# (position:sticky; top:0, render.ts's mobile media query) has already
# claimed the top of the viewport and an earlier click reflowed the chip
# list (counts/labels update on every filter change). Confirmed live: after
# such a scroll, the target chip's own getBoundingClientRect() center sits
# past innerHeight, document.elementFromPoint() there returns null, and
# `ab click` still reports success even though the dispatched click hit
# nothing -- so the resulting screenshot silently shows the pre-click state.
# Forcing `scrollIntoView({block: "center"})` first keeps the click point
# well clear of both viewport edges (top sticky player, bottom fold) before
# `ab click` ever runs.
click_scrolled() {
	sel="$1"
	eval_or_die "pre-click scrollIntoView failed for '$sel'" >/dev/null <<EOF
(function () {
  var el = document.querySelector('$sel');
  if (!el) { throw new Error('element not found: $sel'); }
  el.scrollIntoView({block: "center", inline: "center"});
  return true;
})()
EOF
	ab click "$sel" >/dev/null
}

# Aborts the whole capture run if the JS boolean predicate given on stdin is
# not exactly true, naming $1 (a short state label) in the message. Called
# right after driving an interactive state so a wrong-state screenshot can
# never be written -- this is the detection half of the fix (click_scrolled
# above is the prevention half): even a click that lands correctly is
# confirmed to have actually taken effect before take_shot ever runs.
assert_state() {
	pass="$(eval_or_die "state assertion for '$1' errored")"
	if [ "$pass" != "true" ]; then
		echo "capture.sh: state assertion failed for '$1': predicate evaluated to $pass, not true" >&2
		exit 1
	fi
}

# Opens the filter bar before a chip/reset click needs its content
# hit-testable. render.ts renders `<details class="filter-bar">` closed
# (no `open` attribute) at every width (DESIGN.md §7): everything inside it,
# including the chip buttons and its static "전체 해제" reset button, sits under
# a closed <details>'s content-visibility lock and cannot be clicked until
# the <summary> is clicked open. No-op when already open.
ensure_filter_bar_open() {
	is_open="$(eval_js <<'JS'
(function () {
  var d = document.querySelector("details.filter-bar");
  return !!d && d.hasAttribute("open");
})()
JS
	)"
	if [ "$is_open" != "true" ]; then
		click_scrolled '.filter-bar summary'
	fi
}

# Opens the mobile TOC panel before a tab/TOC-item click inside it needs to be
# hit-testable. render.ts wraps the TOC in `.toc-toggle`(aria-expanded) +
# `.toc-panel`(hidden) below 1024px (DESIGN.md §4/§13); at 1024px+ the toggle
# is CSS-hidden (`display: none`) and the panel is force-shown regardless of
# its `hidden` attribute, so this is a no-op there (`offsetParent === null`
# on the toggle short-circuits the click).
ensure_toc_open() {
	needs_toggle="$(eval_js <<'JS'
(function () {
  var btn = document.querySelector(".toc-toggle");
  var panel = document.querySelector(".toc-panel");
  return !!btn && !!panel && btn.offsetParent !== null && panel.hidden;
})()
JS
	)"
	if [ "$needs_toggle" = "true" ]; then
		click_scrolled '.toc-toggle'
	fi
}

# ── viewer interaction states (DESIGN.md v2 §14, 37 rows across 2+1 viewports) ─
#
# filter-topic-multi drives "수비전환" + "역습": DESIGN.md's own example
# ("빌드업" + "전환/역습") names topic tags that do not exist verbatim in
# this fixture's taxonomy (archive-seed/taxonomy.yaml: 빌드업/오버래핑/역습/
# 수비전환/마무리) or in work-current/plan.json's actual topic titles; 역습
# ("전환/역습"'s counter-attack half) and 수비전환 ("전환" -- transition to
# defense) are the closest existing pair and together select 6 of 15 cards
# (u007..u011,u015 by position-tree-independent topic OR), a non-trivial
# multi-select OR to capture.
# filter-mention (언급 선수, single-select, direct member_ids only) picks
# han-fw (한지우): 2 cards mention him directly.
# my-feedback (§6, single-select "내 피드백" primary control, relatedMembers
# AND condition) picks yoon-fb (윤도훈): relatedMembers matches him on 3
# cards (u002/u004/u005) -- one direct mention (u004, "직접 언급" badge) and
# two via position-tree closure (u002/u005, "포지션 관련(참고)" badge) -- so
# this state also exercises both mention-badge kinds in one screenshot.
# my-feedback-related reuses the same yoon-fb selection but scrolls past the
# direct-mention card (u004, floated to the top by the CSS `order` rule
# render.ts's `.card-list.mine-active .card:not(.is-direct) { order: 1; }`
# applies) so the first RELATED-badge card (u002 or u005, whichever sits
# first in DOM/flex order) lands at the top of the viewport instead --
# letting reviewers see the "포지션 관련(참고)" badge itself, which the
# my-feedback shot above never scrolls far enough to foreground.
# filter-empty-and (round-7 visual QA: the prior drive never showed a real
# 0-result state): two facet groups (position/topic/mention) can never AND
# down to a literal 0 under live, selection-aware counts (§7) -- the option
# that would zero out simply disables instead of hiding, so no combination
# of filter-bar chips alone can reach the actual empty-state panel. The one
# deterministic path is topic 역습 (u010/u011/u012) selected FIRST, then "내
# 피드백" 송민재 (song-cb, relatedMembers u001/u006, disjoint from 역습) --
# the same order and pair the functional check below relies on (order
# matters under live facet counts: selecting 송민재 first instead disables
# 역습, checked separately there). This now shows the real §11 empty state
# (0 results, .empty-state visible, .card-list hidden), not a disabled chip.
# scroll-mid-390 (state scroll-near-end) and scroll-mid-1440 (state
# scroll-mid) share one capture id family but drive different scroll depths:
# DESIGN.md v2 §14 row 19 requires 390px to scroll to the LAST card (sticky
# player must hold through the entire scroll range), while row 20 keeps the
# 1440px mid-scroll of v1 (sticky player position check only, layout has no
# scrolling player at that width in the first place -- §4's `.side-col` is
# its own sticky column there).
drive_state() {
	case "$1" in
	default | full-page) : ;;
	toc-topic)
		ensure_toc_open
		click_scrolled '#tab-topic'
		;;
	filter-position-fb)
		ensure_filter_bar_open
		click_scrolled '.chip-filter[data-group="position"][data-value="FB"]'
		assert_state "filter-position-fb" <<'JS'
document.querySelector('.chip-filter[data-group="position"][data-value="FB"]').getAttribute("aria-pressed") === "true"
JS
		;;
	filter-topic-multi)
		ensure_filter_bar_open
		click_scrolled '.chip-filter[data-group="topic"][data-value="수비전환"]'
		click_scrolled '.chip-filter[data-group="topic"][data-value="역습"]'
		assert_state "filter-topic-multi" <<'JS'
document.querySelector('.chip-filter[data-group="topic"][data-value="수비전환"]').getAttribute("aria-pressed") === "true" &&
document.querySelector('.chip-filter[data-group="topic"][data-value="역습"]').getAttribute("aria-pressed") === "true"
JS
		;;
	filter-mention)
		ensure_filter_bar_open
		click_scrolled '.chip-filter[data-group="mention"][data-value="han-fw"]'
		assert_state "filter-mention" <<'JS'
document.querySelector('.chip-filter[data-group="mention"][data-value="han-fw"]').getAttribute("aria-pressed") === "true"
JS
		;;
	my-feedback)
		click_scrolled '.pill.pill-mine[data-group="mine"][data-value="yoon-fb"]'
		assert_state "my-feedback" <<'JS'
document.querySelector('.pill.pill-mine[data-group="mine"][data-value="yoon-fb"]').getAttribute("aria-pressed") === "true"
JS
		;;
	my-feedback-related)
		click_scrolled '.pill.pill-mine[data-group="mine"][data-value="yoon-fb"]'
		assert_state "my-feedback-related" <<'JS'
(function () {
  var pill = document.querySelector('.pill.pill-mine[data-group="mine"][data-value="yoon-fb"]');
  if (!pill || pill.getAttribute("aria-pressed") !== "true") return false;
  var cards = document.querySelectorAll(".card");
  var target = null;
  for (var i = 0; i < cards.length; i++) {
    if (cards[i].hasAttribute("hidden")) continue;
    var b = cards[i].querySelector(".mention-badge.mention-related");
    if (b && !b.hasAttribute("hidden")) { target = cards[i]; break; }
  }
  if (!target) return false;
  target.scrollIntoView({block: "start"});
  var badge = target.querySelector(".mention-badge");
  return !!badge && badge.textContent.trim() === "포지션 관련(참고)" && badge.offsetParent !== null;
})()
JS
		;;
	filter-empty-and)
		# Topic 역습 selected FIRST, then "내 피드백" 송민재 -- the deterministic
		# 0-result AND the comment above this function explains. Round-8 visual
		# QA: the empty state alone doesn't tell a reader that their own "내
		# 피드백" pick is half the cause, so render.ts now renders a "내 피드백:
		# 송민재" chip first in .active-filters (DESIGN §6/§7) -- assert it's
		# actually there and visible before shooting.
		ensure_filter_bar_open
		click_scrolled '.chip-filter[data-group="topic"][data-value="역습"]'
		click_scrolled '.pill.pill-mine[data-group="mine"][data-value="song-cb"]'
		assert_state "filter-empty-and" <<'JS'
(function () {
  var topic = document.querySelector('.chip-filter[data-group="topic"][data-value="역습"]');
  var pill = document.querySelector('.pill.pill-mine[data-group="mine"][data-value="song-cb"]');
  var visible = document.getElementById("visible-count");
  var empty = document.querySelector(".empty-state");
  var cardList = document.querySelector(".card-list");
  var mineChip = document.querySelector(".active-filters .chip-active");
  return !!topic && topic.getAttribute("aria-pressed") === "true" &&
    !!pill && pill.getAttribute("aria-pressed") === "true" &&
    !!visible && visible.textContent === "0" &&
    !!empty && !empty.hasAttribute("hidden") &&
    !!cardList && cardList.hasAttribute("hidden") &&
    !!mineChip && mineChip.textContent.indexOf("내 피드백: 송민재") === 0 &&
    !document.querySelector(".active-filters").hasAttribute("hidden");
})()
JS
		# Centers the active-filter row, then -- since a sticky mobile player can
		# still cover its top edge after that generic centering -- nudges the
		# scroll up until the row (and the empty-state panel right below it)
		# clears the sticky player's own bottom edge (only sticky below 1024px).
		eval_or_die "filter-empty-and: bringing the active-filter row and empty-state panel into view failed" >/dev/null <<'JS'
(function () {
  var activeFilters = document.querySelector(".active-filters");
  var empty = document.querySelector(".empty-state");
  if (!activeFilters) { throw new Error(".active-filters not found"); }
  if (!empty) { throw new Error(".empty-state not found"); }
  activeFilters.scrollIntoView({block: "center", inline: "center"});
  var player = document.querySelector(".player-wrapper");
  var stickyBottom = player && getComputedStyle(player).position === "sticky" ? player.getBoundingClientRect().bottom : 0;
  var rect = activeFilters.getBoundingClientRect();
  if (rect.top < stickyBottom) {
    window.scrollBy(0, rect.top - stickyBottom - 16);
  }
  return true;
})()
JS
		;;
	seek-part1)
		wait_yt_api 20000
		ab click '.card#u002' >/dev/null # u002 start=180 on part 1
		wait_player_target "seek-part1" "NUzEChn9EyI" 180
		;;
	switch-part2)
		wait_yt_api 20000
		ab click '.card#u010' >/dev/null # u010 = part 2 (yn-qm7lM5p4), start=180
		wait_player_target "switch-part2" "yn-qm7lM5p4" 180
		;;
	scroll-mid)
		printf '%s' 'window.scrollTo(0, Math.floor(document.body.scrollHeight / 2))' | ab eval --stdin >/dev/null
		;;
	scroll-near-end)
		printf '%s' 'var cards = document.querySelectorAll(".card"); if (cards.length) { cards[cards.length - 1].scrollIntoView({block: "end"}); }' | ab eval --stdin >/dev/null
		;;
	body-frames-closeup)
		# u008 has 3 body-frame blocks (candidates c004/c005/c006), the most of
		# any unit in this fixture. Scrolling to the card's own top (old
		# behavior) can leave the frame whose caption actually wraps to 2+
		# lines -- the case the 3-column figcaption grid (§15-10) exists for --
		# below the fold. Instead, measure each frame's caption in-page and
		# center whichever one wraps at the current viewport (falling back to
		# the tallest caption when none wraps, e.g. at 1440px, which still
		# frames the multi-frame area per the reviewer's note).
		frame_t="$(eval_or_die "picking a body-frame to center for body-frames-closeup failed" <<'JS'
(function () {
  var card = document.getElementById("u008");
  if (!card) { throw new Error("u008 not found"); }
  var frames = card.querySelectorAll(".body-frame");
  if (frames.length === 0) { throw new Error("u008 has no .body-frame blocks"); }
  var best = frames[0];
  var bestWraps = false;
  var bestHeight = -1;
  for (var i = 0; i < frames.length; i++) {
    var caption = frames[i].querySelector(".body-frame-caption");
    if (!caption) continue;
    var rect = caption.getBoundingClientRect();
    var lineHeight = parseFloat(getComputedStyle(caption).lineHeight) || rect.height;
    var wraps = lineHeight > 0 && rect.height > lineHeight * 1.3;
    if (wraps && !bestWraps) {
      best = frames[i];
      bestWraps = true;
      bestHeight = rect.height;
    } else if (!bestWraps && rect.height > bestHeight) {
      best = frames[i];
      bestHeight = rect.height;
    }
  }
  best.scrollIntoView({block: "center", inline: "center"});
  return best.getAttribute("data-frame-t");
})()
JS
		)"
		assert_state "body-frames-closeup" <<JS
(function () {
  var frame = document.querySelector('#u008 .body-frame[data-frame-t="' + $frame_t + '"]');
  if (!frame) return false;
  var frameRect = frame.getBoundingClientRect();
  if (frameRect.bottom <= 0 || frameRect.top >= window.innerHeight) return false;
  var seekBtn = frame.querySelector(".seek-btn");
  var zoomLink = frame.querySelector(".zoom-link");
  if (!seekBtn || seekBtn.offsetParent === null) return false;
  if (!zoomLink || zoomLink.offsetParent === null) return false;
  if (window.innerWidth <= 390) {
    var caption = frame.querySelector(".body-frame-caption");
    var rect = caption.getBoundingClientRect();
    var lineHeight = parseFloat(getComputedStyle(caption).lineHeight) || rect.height;
    if (!(lineHeight > 0 && rect.height > lineHeight * 1.3)) return false;
  }
  return true;
})()
JS
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

# ── the 37 fixed shots (DESIGN.md v2 §14) ──────────────────────────────────
# id|page-key|width|height|state
SHOT_TABLE='
default-390|viewer|390|844|default
default-1440|viewer|1440|900|default
toc-topic-390|viewer|390|844|toc-topic
toc-topic-1440|viewer|1440|900|toc-topic
filter-position-390|viewer|390|844|filter-position-fb
filter-position-1440|viewer|1440|900|filter-position-fb
filter-topic-multi-390|viewer|390|844|filter-topic-multi
filter-topic-multi-1440|viewer|1440|900|filter-topic-multi
filter-mention-390|viewer|390|844|filter-mention
filter-mention-1440|viewer|1440|900|filter-mention
my-feedback-390|viewer|390|844|my-feedback
my-feedback-1440|viewer|1440|900|my-feedback
my-feedback-related-390|viewer|390|844|my-feedback-related
my-feedback-related-1440|viewer|1440|900|my-feedback-related
filter-empty-and-390|viewer|390|844|filter-empty-and
filter-empty-and-1440|viewer|1440|900|filter-empty-and
seek-part1-390|viewer|390|844|seek-part1
seek-part1-1440|viewer|1440|900|seek-part1
switch-part2-390|viewer|390|844|switch-part2
switch-part2-1440|viewer|1440|900|switch-part2
scroll-mid-390|viewer|390|844|scroll-near-end
scroll-mid-1440|viewer|1440|900|scroll-mid
body-frames-closeup-390|viewer|390|844|body-frames-closeup
body-frames-closeup-1440|viewer|1440|900|body-frames-closeup
full-page-390|viewer|390|844|full-page
full-page-1440|viewer|1440|900|full-page
past-session-390|past|390|844|default
past-session-1440|past|1440|900|default
archive-with-sessions-390|archive|390|844|default
archive-with-sessions-1440|archive|1440|900|default
archive-empty-390|archive-empty|390|844|default
archive-empty-1440|archive-empty|1440|900|default
ref-en-390|ref|390|844|default
ref-en-1440|ref|1440|900|default
default-1024x768|viewer|1024|768|default
disabled-mode-390|disabled|390|844|default
embed-blocked-390|embed-blocked|390|844|default
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
if [ "$manifest_len" -ne 37 ]; then
	echo "capture.sh: capture-manifest.json has $manifest_len entries, expected 37" >&2
	exit 1
fi

for f in $(jq -r '.[] | .file' "$SHOTS/capture-manifest.json"); do
	if ! is_png "$SHOTS/$f"; then
		echo "capture.sh: $f is not a valid PNG" >&2
		exit 1
	fi
done

# ── evidence-integrity guard: two different ids must never share a sha256 ──
# The defect this whole file's drive_state hardening (click_scrolled,
# assert_state above) exists to catch surfaced as exactly this: a click that
# silently no-op'd left a screenshot byte-for-byte
# identical to an earlier, different state's screenshot. Even with the
# per-state assertions in place, this is a second, independent net over the
# whole manifest -- any two DIFFERENT ids ending up with the same sha256 is
# still a capture bug, never a legitimate outcome (no two of the 37 fixed
# shots are meant to render identically), so it aborts loudly rather than
# publishing silently-wrong evidence.
DUP_HASHES="$(jq -c '[group_by(.sha256)[] | select(length > 1) | {sha256: .[0].sha256, ids: [.[].id]}]' "$SHOTS/capture-manifest.json")"
if [ "$(printf '%s' "$DUP_HASHES" | jq 'length')" -gt 0 ]; then
	echo "capture.sh: capture-manifest.json has different ids sharing an identical sha256 (a click likely silently no-op'd): $DUP_HASHES" >&2
	exit 1
fi

# ── functional checks (DESIGN.md v2 §14 "기능 검사") ───────────────────────
# Always run in full regardless of --only: independent of which screenshot
# ids were reshot, and cheap next to the 37 screenshots above.

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

# eval_js is defined earlier (drive_state also needs it, to probe collapse
# state before an interaction).

run_dom_checks() {
	url="$(page_url viewer)"
	ab set viewport 1440 900 >/dev/null
	ab open "$url" >/dev/null

	# ── DESIGN.md §7: the filter bar renders as a closed `<details>` at every
	# width, checked here on the fresh load before anything opens it.
	pass="$(eval_js <<'JS'
(function () {
  var d = document.querySelector("details.filter-bar");
  return !!d && !d.hasAttribute("open");
})()
JS
	)"
	add_check "필터 바는 기본으로 접혀 있다(§7)" dom "$pass" ""

	# ── DESIGN.md §7/§15.5: 0-result options are never rendered, and every
	# option that IS rendered shows a positive count. Checked on a fresh,
	# unfiltered load since option existence/counts are fixed at build time
	# (§7) and do not depend on interaction order.
	pass="$(eval_js <<'JS'
document.querySelector('.chip-filter[data-group="position"][data-value="GK"]') === null
JS
	)"
	add_check "이 세션에 결과가 없는 포지션 옵션(GK)은 필터 트리에 렌더되지 않는다(§7, §15-5)" dom "$pass" ""

	pass="$(eval_js <<'JS'
(function () {
  var chips = document.querySelectorAll('.chip-filter[data-group]');
  for (var i = 0; i < chips.length; i++) {
    var m = chips[i].textContent.match(/\((\d+)\)/);
    if (!m || parseInt(m[1], 10) <= 0) return false;
  }
  var counts = document.querySelectorAll('.pill-mine .count');
  for (var j = 0; j < counts.length; j++) {
    if (!(parseInt(counts[j].textContent, 10) > 0)) return false;
  }
  return chips.length > 0;
})()
JS
	)"
	add_check "렌더된 모든 필터/\"내 피드백\" 옵션은 개수 표시가 0보다 크다(§1 원칙4, §6, §7)" dom "$pass" ""

	# ── round-8 fix: this used to click #u002 straight off the fresh page load,
	# but u002's videoId (NUzEChn9EyI) already equals the page's own initial
	# default video -- a dead click handler would leave dataset.video
	# untouched and still satisfy the assertion below vacuously. Switching to
	# Part 2 first and confirming that switch really happened makes the
	# follow-up #u002 click a genuine round trip: only a working handler can
	# switch dataset.video back to Part 1's id.
	ab click '.part-btn[data-video="yn-qm7lM5p4"]' >/dev/null
	pass="$(eval_js <<'JS'
document.body.dataset.video === "yn-qm7lM5p4"
JS
	)"
	add_check "Part 2 버튼 클릭 후 body.dataset.video가 Part 2 videoId로 바뀐다(다음 카드 클릭 검사를 비-자명하게 만드는 전제)" dom "$pass" ""

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
document.getElementById("u008").classList.contains("card--highlighted") &&
document.querySelector('.toc-item[data-target="u008"]').classList.contains("is-current")
JS
	)"
	add_check "목차 클릭은 대상 카드와 그 목차 항목에 강조 상태(card--highlighted/is-current)를 주고 영상 전환(seek)은 발생시키지 않는다(§8)" dom "$pass" ""

	ensure_filter_bar_open
	ab click '.chip-filter[data-group="position"][data-value="FB"]' >/dev/null

	# ── DESIGN.md §8: a TOC group (match/topic/tag) whose every .toc-item is
	# hidden by the active filter must itself be hidden, not just its items.
	# Position FB only matches u002/u004/u005 (all in match 1's two topic
	# groups), so match 2/3's toc-match-group (and every toc-topic-group under
	# them) must have zero visible .toc-item children and be hidden, while at
	# least one group stays visible -- proving the hidden/visible split is
	# real, not every group collapsing (or none).
	pass="$(eval_js <<'JS'
(function () {
  var groups = document.querySelectorAll(".toc-match-group, .toc-topic-group, .toc-tag-group");
  if (groups.length === 0) return false;
  var consistent = true;
  var anyHidden = false;
  var anyVisible = false;
  for (var i = 0; i < groups.length; i++) {
    var hasVisibleItem = groups[i].querySelector(".toc-item:not([hidden])") !== null;
    var isHidden = groups[i].hasAttribute("hidden");
    if (hasVisibleItem === isHidden) consistent = false;
    if (isHidden) anyHidden = true;
    else anyVisible = true;
  }
  return consistent && anyHidden && anyVisible;
})()
JS
	)"
	add_check "필터로 모든 항목이 숨겨진 TOC 그룹은 그 그룹 헤더도 함께 숨는다(§8)" dom "$pass" ""

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

	# ── DESIGN.md §5-7/§9: a body-frame click seeks the FRAME's own time, not
	# the card's start time. u013 (part 2, video yn-qm7lM5p4) is forced to be
	# a different part than the current one first, so the video switching
	# itself (dom-observable via the two documented test hooks, §9) proves
	# the frame -- not the card's own start -- drove the target: the exact
	# ±1s seek-time precision (frame time vs. card start time, both landing
	# on the same video) is left to the player_api check below, which is the
	# only one of the two official test hooks (§9: body.dataset.video,
	# window.fcPlayer) that exposes actual seek time. Targets u013's SECOND
	# body-frame (candidate c009, data-frame-t=633) rather than its first
	# (c008, data-frame-t=630): c008's time coincides with u013's own
	# data-start=630, so a click that wrongly seeks to the card's start time
	# instead of the frame's would still pass a check built on c008.
	ab click '.part-btn[data-video="NUzEChn9EyI"]' >/dev/null
	ab click '#u013 .body-frame[data-frame-t="633"]' >/dev/null
	pass="$(eval_js <<'JS'
document.body.dataset.video === "yn-qm7lM5p4" &&
document.querySelector('.part-btn[data-video="yn-qm7lM5p4"]').getAttribute("aria-pressed") === "true" &&
document.querySelector('.part-btn[data-video="NUzEChn9EyI"]').getAttribute("aria-pressed") === "false"
JS
	)"
	add_check "본문 프레임(다른 파트) 클릭은 그 프레임이 속한 video로 전환한다(카드 시작이 아니라 프레임 자체가 대상, §5-7, §9)" dom "$pass" ""

	# ── DESIGN.md §5/§13: the card-head `.seek-btn` (current video is
	# yn-qm7lM5p4 from the previous check) routes through the same seek path
	# as clicking the card itself -- u002 is a different video (NUzEChn9EyI),
	# so a real switch (dom-observable via body.dataset.video) proves the
	# button, not just the figure/card area, triggers seek. This whole block
	# ends back on yn-qm7lM5p4 (u013's video) so downstream checks that assume
	# that pre-existing ending state (e.g. the drag-select check below, run on
	# u003, itself on NUzEChn9EyI) keep working -- the keyboard check runs in
	# the middle, switching to yn-qm7lM5p4 via a DIFFERENT card's header
	# button, so the final body-frame-button check's same-video seek leaves
	# the video there rather than switching back to NUzEChn9EyI.
	ab click '#u002 .card-head .seek-btn' >/dev/null
	pass="$(eval_js <<'JS'
document.body.dataset.video === "NUzEChn9EyI"
JS
	)"
	add_check "카드 헤더의 seek-btn 클릭은 카드 시작 시각으로 seek한다(§5, §13)" dom "$pass" ""

	# ── DESIGN.md §5/§13: seek-btn is a real <button>, so it must be reachable
	# and activatable via keyboard, not just click -- u013's card-head seek-btn
	# (a different video than the one just loaded above) proves Enter on a
	# focused seek-btn triggers the same seek as a mouse click.
	ab focus '#u013 .card-head .seek-btn' >/dev/null
	ab press Enter >/dev/null
	pass="$(eval_js <<'JS'
document.body.dataset.video === "yn-qm7lM5p4"
JS
	)"
	add_check "seek-btn을 키보드로 포커스한 뒤 Enter를 누르면 마우스 클릭과 같은 seek가 실행된다(§5, §13)" dom "$pass" ""

	# ── DESIGN.md §5-7/§13: the body-frame's OWN `.seek-btn` button (not just
	# clicking the figure, already covered above) resolves its own video/seek
	# target correctly. Switches away to a DIFFERENT video (u002/NUzEChn9EyI)
	# right before this click so the check is non-vacuous (round-7 review):
	# the state right before this click would otherwise already BE
	# yn-qm7lM5p4 (left there by the keyboard check above), so a no-op click
	# -- the seek-btn's own closest(".seek-btn") resolution silently failing
	# -- would leave dataset.video unchanged and still satisfy the assertion.
	# Switching away first means only an ACTUAL click-driven switch can pass.
	ab click '#u002 .card-head .seek-btn' >/dev/null
	ab click '#u013 .body-frame[data-frame-t="633"] .seek-btn' >/dev/null
	pass="$(eval_js <<'JS'
document.body.dataset.video === "yn-qm7lM5p4" &&
document.querySelector('.part-btn[data-video="yn-qm7lM5p4"]').getAttribute("aria-pressed") === "true" &&
document.querySelector('.part-btn[data-video="NUzEChn9EyI"]').getAttribute("aria-pressed") === "false"
JS
	)"
	add_check "본문 프레임의 seek-btn 버튼 클릭은 그 프레임이 속한 video로 전환하고 시각으로 seek한다(§5-7, §13)" dom "$pass" ""

	# ── DESIGN.md §6: "내 피드백"에서 팀원 1명을 선택하면 relatedMembers 카드
	# (직접 언급 u004 + 포지션 관련 u002/u005) + addressed_to_all 카드(u003, 이름을
	# 부르지 않고 모두에게 통하는 원칙)가 남는다. yoon-fb 기준 총 4건.
	ab click '.pill.pill-mine[data-group="mine"][data-value="yoon-fb"]' >/dev/null
	pass="$(eval_js <<'JS'
document.getElementById("visible-count").textContent === "4" &&
!document.getElementById("u002").hasAttribute("hidden") &&
!document.getElementById("u003").hasAttribute("hidden") &&
!document.getElementById("u004").hasAttribute("hidden") &&
!document.getElementById("u005").hasAttribute("hidden") &&
document.getElementById("u001").hasAttribute("hidden")
JS
	)"
	add_check "\"내 피드백\"에서 팀원 1명을 선택하면 그 팀원의 relatedMembers 카드와 전원 대상(addressed_to_all) 카드가 남고 결과 수가 갱신된다(§6)" dom "$pass" ""

	# ── DESIGN.md §5-3/§6: u003은 member_ids도 position_tags도 비어 있고
	# addressed_to_all만 true인 유닛 — 어떤 팀원을 선택해도 "직접 언급"도
	# "포지션 관련(참고)"도 아닌 "전원" 배지를 보여야 한다.
	pass="$(eval_js <<'JS'
(function () {
  var badge = document.querySelector("#u003 .mention-badge");
  return !!badge && !badge.hasAttribute("hidden") && badge.textContent.trim() === "전원" &&
    badge.classList.contains("mention-all") && !document.getElementById("u003").hasAttribute("hidden");
})()
JS
	)"
	add_check "\"내 피드백\" 선택 시 전원 대상 카드는 '전원' 멘션 배지를 보인다(§5-3, §6)" dom "$pass" ""

	pass="$(eval_js <<'JS'
(function () {
  var direct = document.querySelector("#u004 .mention-badge");
  var positional = document.querySelector("#u002 .mention-badge") || document.querySelector("#u005 .mention-badge");
  return !!direct && direct.textContent.trim() === "직접 언급" &&
    !!positional && positional.textContent.trim() === "포지션 관련(참고)";
})()
JS
	)"
	add_check "\"내 피드백\" 선택 시 직접 언급/포지션 관련(참고) 멘션 배지가 올바르게 구분된다(§5-3)" dom "$pass" ""

	# ── DESIGN.md §6: render.ts floats direct-mention cards above position-
	# related ones via CSS `order` (`.card-list.mine-active
	# .card:not(.is-direct) { order: 1; }`), not DOM reordering, so "first" here
	# must compare rendered position (getBoundingClientRect().top), not DOM
	# order.
	pass="$(eval_js <<'JS'
(function () {
  var cards = Array.prototype.filter.call(document.querySelectorAll(".card"), function (c) {
    return !c.hasAttribute("hidden");
  });
  if (cards.length === 0) return false;
  cards.sort(function (a, b) {
    return a.getBoundingClientRect().top - b.getBoundingClientRect().top;
  });
  var badge = cards[0].querySelector(".mention-badge.mention-direct");
  return !!badge && !badge.hasAttribute("hidden");
})()
JS
	)"
	add_check "내 피드백 선택 시 직접 언급 카드가 참고 카드보다 먼저 보인다(§6)" dom "$pass" ""

	ab click '.filter-reset' >/dev/null

	# ── DESIGN.md §5/§13: 드래그로 텍스트를 선택 중인 카드를 클릭해도 seek가
	# 실행되지 않는다.
	pass="$(eval_js <<'JS'
(function () {
  var card = document.getElementById("u003");
  var video = card.getAttribute("data-video");
  var beforeVideo = document.body.dataset.video;
  // the card's video must differ from the loaded one, or a real seek would
  // be a same-value no-op and this check would pass without exercising
  // anything -- fail loudly instead of degrading silently.
  if (video === beforeVideo) return false;
  var p = card.querySelector(".card-body p");
  var range = document.createRange();
  range.selectNodeContents(p);
  var sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  // the selection must actually hold text, or onCardListClick's
  // `getSelection().toString() !== ""` guard is never exercised.
  if (sel.toString().length === 0) return false;
  card.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  var afterVideo = document.body.dataset.video;
  var partBtn = document.querySelector('.part-btn[data-video="' + video + '"]');
  var afterPressed = partBtn ? partBtn.getAttribute("aria-pressed") : null;
  sel.removeAllRanges();
  return beforeVideo === afterVideo && afterPressed === "false";
})()
JS
	)"
	add_check "카드 안 텍스트를 드래그 선택한 상태의 클릭은 seek를 실행하지 않는다(§5, §13)" dom "$pass" ""

	# ── DESIGN.md §7 (live, selection-aware facets): selecting position FB
	# makes topic 마무리 (disjoint from FB's cards) AND down to 0, so it must
	# render disabled + "(0)" instead of being hidden or clickable -- the old
	# two-click "FB then 마무리" AND-to-0 sequence this superseded is no longer
	# reachable via a click once 마무리 is disabled.
	ab click '.chip-filter[data-group="position"][data-value="FB"]' >/dev/null
	pass="$(eval_js <<'JS'
(function () {
  var topic = document.querySelector('.chip-filter[data-group="topic"][data-value="마무리"]');
  if (!topic) return false;
  var m = topic.textContent.match(/\((\d+)\)/);
  return topic.hasAttribute("disabled") && topic.getAttribute("aria-disabled") === "true" && !!m && m[1] === "0";
})()
JS
	)"
	add_check "다른 그룹 선택 시 0건이 되는 옵션은 비활성(disabled)으로 보인다(§7)" dom "$pass" ""

	pass="$(eval_js <<'JS'
(function () {
  var pos = document.querySelector('.chip-filter[data-group="position"][data-value="FB"]');
  return !!pos && pos.getAttribute("aria-pressed") === "true" &&
    !pos.hasAttribute("disabled") && pos.getAttribute("aria-disabled") !== "true";
})()
JS
	)"
	add_check "선택된 옵션은 비활성화되지 않는다(§7)" dom "$pass" ""

	ab click '.filter-reset' >/dev/null

	# ── DESIGN.md §6/§7/§11: a real, deterministic empty-result "내 피드백"+필터
	# combo -- topic 역습 (u010/u011/u012) selected FIRST, then "내 피드백"
	# 송민재 (song-cb, relatedMembers u001/u006, disjoint from 역습) ANDs to 0.
	# Order matters under live facet counts (§7): 역습's count is computed
	# against whatever else is active, so selecting 송민재 first instead
	# disables 역습 (checked below) rather than letting it be clicked into a
	# 0-result AND -- this is a hard check, not a search, since the render
	# agent confirmed this exact path.
	click_scrolled '.chip-filter[data-group="topic"][data-value="역습"]'
	click_scrolled '.pill.pill-mine[data-group="mine"][data-value="song-cb"]'
	pass="$(eval_js <<'JS'
(function () {
  var topic = document.querySelector('.chip-filter[data-group="topic"][data-value="역습"]');
  var pill = document.querySelector('.pill.pill-mine[data-group="mine"][data-value="song-cb"]');
  var visible = document.getElementById("visible-count");
  var empty = document.querySelector(".empty-state");
  var cardList = document.querySelector(".card-list");
  return !!topic && topic.getAttribute("aria-pressed") === "true" &&
    !!pill && pill.getAttribute("aria-pressed") === "true" &&
    !!visible && visible.textContent === "0" &&
    !!empty && !empty.hasAttribute("hidden") &&
    !!cardList && cardList.hasAttribute("hidden");
})()
JS
	)"
	add_check "\"내 피드백\"과 필터 옵션의 AND 조합이 0건이면 빈 상태가 표시되고 카드 목록이 숨는다(§6, §7, §11)" dom "$pass" ""

	ab click '.filter-reset' >/dev/null

	# ── DESIGN.md §6/§7: reverse order (내 피드백 먼저) blocks the same AND via
	# disabling instead -- 역습's live count against 송민재's relatedMembers is
	# 0, so it must render disabled + "(0)", never clickable into a 0-result
	# state the other way around.
	click_scrolled '.pill.pill-mine[data-group="mine"][data-value="song-cb"]'
	pass="$(eval_js <<'JS'
(function () {
  var topic = document.querySelector('.chip-filter[data-group="topic"][data-value="역습"]');
  if (!topic) return false;
  var m = topic.textContent.match(/\((\d+)\)/);
  return topic.hasAttribute("disabled") && topic.getAttribute("aria-disabled") === "true" && !!m && m[1] === "0";
})()
JS
	)"
	add_check "역순 선택(\"내 피드백\" 먼저)에서는 그 조합이 0건이 되는 필터 옵션이 비활성화된다(§6, §7)" dom "$pass" ""

	ab click '.filter-reset' >/dev/null

	# ── DESIGN.md §5-4/§15-6: the representative start image's own "확대" link
	# (`.card-image .zoom-link`) opens the original image in a new tab and does
	# not seek -- distinct from the body-frame's own zoom-link below, since a
	# card's start image sits before any body-frame in the DOM (a bare
	# `.zoom-link` selector would otherwise always match this one first).
	pass="$(eval_js <<'JS'
(function () {
  var link = document.querySelector(".card-image .zoom-link");
  return !!link &&
    /img\/.*\.webp$/.test(link.getAttribute("href") || "") &&
    link.getAttribute("target") === "_blank" &&
    (link.getAttribute("rel") || "").indexOf("noopener") !== -1;
})()
JS
	)"
	add_check "대표 시작 이미지의 \"확대\" 링크는 이미지 원본(img/*.webp)을 새 탭으로 연다(§5-4, §15-6)" dom "$pass" ""

	# A real `<a href>`'s default navigation runs even for a synthetic (untrusted)
	# dispatchEvent, asynchronously, just not before this eval call's own return
	# value is computed -- an earlier version of this check dispatched the click
	# with no guard against that and the browser navigated away to the image a
	# moment later, corrupting every check that ran after it. A capture-phase
	# listener that calls preventDefault() before the event bubbles to
	# onCardListClick blocks that navigation while leaving the guard's own
	# closest("a")-based seek-avoidance logic (which does not depend on
	# preventDefault) fully exercised.
	pass="$(eval_js <<'JS'
(function () {
  var link = document.querySelector(".card-image .zoom-link");
  if (!link) return false;
  var beforeVideo = document.body.dataset.video;
  function blockNav(e) { e.preventDefault(); }
  link.addEventListener("click", blockNav, true);
  link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  link.removeEventListener("click", blockNav, true);
  return document.body.dataset.video === beforeVideo;
})()
JS
	)"
	add_check "대표 시작 이미지의 \"확대\" 링크 클릭은 seek를 실행하지 않는다(§5-4, §9)" dom "$pass" ""

	# ── DESIGN.md §5-7/§15-6: the body-frame's own "확대" link, same contract.
	pass="$(eval_js <<'JS'
(function () {
  var link = document.querySelector(".body-frame .zoom-link");
  return !!link &&
    /img\/.*\.webp$/.test(link.getAttribute("href") || "") &&
    link.getAttribute("target") === "_blank" &&
    (link.getAttribute("rel") || "").indexOf("noopener") !== -1;
})()
JS
	)"
	add_check "본문 프레임의 \"확대\" 링크는 이미지 원본(img/*.webp)을 새 탭으로 연다(§5-7, §15-6)" dom "$pass" ""

	# Same navigation-blocking guard as the start-image check above.
	pass="$(eval_js <<'JS'
(function () {
  var link = document.querySelector(".body-frame .zoom-link");
  if (!link) return false;
  var beforeVideo = document.body.dataset.video;
  function blockNav(e) { e.preventDefault(); }
  link.addEventListener("click", blockNav, true);
  link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  link.removeEventListener("click", blockNav, true);
  return document.body.dataset.video === beforeVideo;
})()
JS
	)"
	add_check "본문 프레임의 \"확대\" 링크 클릭은 seek를 실행하지 않는다(§5-7, §9)" dom "$pass" ""
}

# ── 1024px 미만 전용 dom 체크: 플레이어 접기, 모바일 sticky 유지 (§4, §14) ──
run_mobile_dom_checks() {
	url="$(page_url viewer)"
	ab set viewport 390 844 >/dev/null
	ab open "$url" >/dev/null

	# ── DESIGN.md §1/§4: mobile order puts .my-feedback (order 3) right after
	# the player + part-switch, ahead of the filter bar, so it lands inside
	# the first screen (844px) on a fresh load without any scrolling. Checks
	# the rect's own width/height too (round-7 review) -- a `display:none` or
	# zero-size element still reports a `top` coordinate, so `top < 844`
	# alone would pass even if the element were hidden.
	pass="$(eval_js <<'JS'
(function () {
  var r = document.querySelector(".my-feedback").getBoundingClientRect();
  return r.top < 844 && r.width > 0 && r.height > 0;
})()
JS
	)"
	add_check "390에서 내 피드백이 첫 화면(844px) 안에 실제로 보인다(§1, §4)" dom "$pass" ""

	# ── DESIGN.md §4/§13: `.toc-toggle`(aria-expanded) + `.toc-panel`(hidden)
	# replace <details> for the TOC below 1024px; clicking the toggle must
	# flip aria-expanded and reveal the panel.
	pass="$(eval_js <<'JS'
(function () {
  var btn = document.querySelector(".toc-toggle");
  var panel = document.querySelector(".toc-panel");
  if (!btn || !panel) return false;
  var before = btn.getAttribute("aria-expanded");
  btn.click();
  var afterExpanded = btn.getAttribute("aria-expanded");
  return before === "false" && afterExpanded === "true" && panel.hidden === false;
})()
JS
	)"
	add_check "390에서 목차 토글이 aria-expanded를 전환한다(§13)" dom "$pass" ""

	# ── DESIGN.md §4/§8: clicking a TOC item scrolls its target card into
	# view, landing below the sticky player (`scroll-margin-top` uses
	# `--sticky-player-h`) rather than hidden behind it, and gives both the
	# card and its own TOC item the highlight/current state the contract names
	# (card--highlighted / is-current) without seeking -- u015 (the last card)
	# is used so scrollIntoView actually has to move the page. The toc panel
	# opened by the toggle check above is what makes the item hittable here.
	before_video_mobile="$(eval_js <<'JS'
document.body.dataset.video
JS
	)"
	click_scrolled '.toc-item[data-target="u015"]'
	pass="$(eval_js <<JS
(function () {
  var player = document.querySelector(".player-wrapper");
  var card = document.getElementById("u015");
  var tocItem = document.querySelector('.toc-item[data-target="u015"]');
  if (!player || !card || !tocItem) return false;
  var playerBottom = player.getBoundingClientRect().bottom;
  var cardTop = card.getBoundingClientRect().top;
  return cardTop >= playerBottom - 1 &&
    cardTop <= window.innerHeight &&
    card.classList.contains("card--highlighted") &&
    tocItem.classList.contains("is-current") &&
    document.body.dataset.video === $before_video_mobile;
})()
JS
	)"
	add_check "390에서 목차 클릭은 대상 카드를 sticky 플레이어 아래로 스크롤해 강조하고 seek는 발생시키지 않는다(§4, §8)" dom "$pass" ""

	ab click '.player-collapse' >/dev/null
	pass="$(eval_js <<'JS'
document.querySelector(".player-collapse").getAttribute("aria-expanded") === "false" &&
document.querySelector(".player-wrapper").classList.contains("is-collapsed") &&
Math.abs(document.querySelector(".player-wrapper").getBoundingClientRect().height - 44) <= 1
JS
	)"
	add_check "\"플레이어 접기\" 버튼을 누르면 aria-expanded가 false로 전환되고 .player-wrapper.is-collapsed가 적용되며 높이가 44px(±1)가 된다(§4, §13)" dom "$pass" ""

	printf '%s' 'var cards = document.querySelectorAll(".card"); if (cards.length) { cards[cards.length - 1].scrollIntoView({block: "end"}); }' | ab eval --stdin >/dev/null
	pass="$(eval_js <<'JS'
(function () {
  var r = document.querySelector(".player-wrapper").getBoundingClientRect();
  return r.top >= -2 && r.top <= 2 && r.height > 0;
})()
JS
	)"
	add_check "390px에서 카드 목록 끝까지 스크롤해도 .player-wrapper가 sticky로 고정 유지된다(§4, §14)" dom "$pass" ""
}

run_disabled_mode_checks() {
	url="$(page_url disabled)"
	ab set viewport 390 844 >/dev/null
	ab open "$url" >/dev/null

	# ── DESIGN.md §5 item 6: an addressed_to_all unit renders a "대상: 전원"
	# chip regardless of roster presence -- disabled-mode-390 (no roster) is
	# exactly the case that would silently drop it if the chip were built
	# from member data instead of the unit flag alone.
	pass="$(eval_js <<'JS'
(function () {
  var chip = document.querySelector(".card .chip-addressed-all");
  return !!chip && chip.textContent.trim() === "대상: 전원";
})()
JS
	)"
	add_check "disabled 모드(명단 없음)에서도 addressed_to_all 카드는 \"대상: 전원\" 칩을 보인다(§5-6, §10)" dom "$pass" ""
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

	# ── DESIGN.md §5-7/§9: 본문 프레임 클릭은 프레임 자체의 시각(u013의 두
	# 번째 프레임, candidate c009, t=633)으로 seek해야 한다 -- 카드(u013)
	# 시작 시각이 아니라. c008(t=630)은 쓰지 않는다: u013의 data-start도
	# 630이라 카드 시작으로 잘못 seek해도 이 체크를 통과해버린다. Round-7
	# review flagged that a wrong-but-nearby landing (630) could still drift
	# into the ±1s window after 3s of ordinary playback during the wait's own
	# polling -- but calling pauseVideo() on EVERY poll (the first fix tried)
	# was verified live to itself break the real seek: repeatedly pausing a
	# YouTube iframe player while a loadVideoById+seekTo is still settling
	# leaves getCurrentTime() stuck at 0 (confirmed by hand against the real
	# player, not the test stub). So instead: wait, WITHOUT touching
	# pauseVideo, only for the player to report a nonzero time at all (i.e.
	# the seek has landed somewhere), then take exactly one follow-up reading
	# that pauses once and checks the value right then -- close enough to
	# landing that a wrong 630 landing cannot yet have drifted into 633's
	# window, while a correct 633 landing is already within it immediately.
	frame_pass=false
	if [ "$api_ready" = true ]; then
		ab click '.part-btn[data-video="NUzEChn9EyI"]' >/dev/null
		ab click '#u013 .body-frame[data-frame-t="633"]' >/dev/null
		if ab wait --fn "window.fcPlayer && typeof window.fcPlayer.getCurrentTime === 'function' && window.fcPlayer.getCurrentTime() > 0" --timeout "$switch_timeout" >/dev/null 2>&1; then
			frame_pass="$(eval_js <<'JS'
(function () {
  var p = window.fcPlayer;
  if (!p || typeof p.pauseVideo !== "function" || typeof p.getCurrentTime !== "function") return false;
  p.pauseVideo();
  return Math.abs(p.getCurrentTime() - 633) <= 1;
})()
JS
			)"
		fi
	fi
	if [ "$HEADED" = true ]; then
		add_check "본문 프레임 클릭 후 fcPlayer.getCurrentTime()이 그 프레임의 시각(카드 시작 시각이 아님)과 ±1초 이내로 일치한다" player_api "$frame_pass" ""
	elif [ "$frame_pass" = true ]; then
		add_check "본문 프레임 클릭 후 fcPlayer.getCurrentTime()이 그 프레임의 시각(카드 시작 시각이 아님)과 ±1초 이내로 일치한다" player_api true ""
	else
		add_check "본문 프레임 클릭 후 fcPlayer.getCurrentTime()이 그 프레임의 시각(카드 시작 시각이 아님)과 ±1초 이내로 일치한다" player_api false "헤드리스 환경에서 YouTube 플레이어 초기화/재생이 제한되어 판정 불가(네트워크 또는 재생 정책 제약)"
	fi

	# ── DESIGN.md §5/§13: the card-head seek-btn's own seek precision -- u006
	# (part 1, start=780) is a different video than the one just loaded above
	# (yn-qm7lM5p4), so this also exercises the button's loadVideoById path.
	header_seek_btn_pass=false
	if [ "$api_ready" = true ]; then
		ab click '#u006 .card-head .seek-btn' >/dev/null
		if ab wait --fn "window.fcPlayer && window.fcPlayer.getVideoData && window.fcPlayer.getVideoData().video_id === 'NUzEChn9EyI' && typeof window.fcPlayer.getCurrentTime === 'function' && Math.abs(window.fcPlayer.getCurrentTime() - 780) <= 2" --timeout "$switch_timeout" >/dev/null 2>&1; then
			header_seek_btn_pass=true
		fi
	fi
	if [ "$HEADED" = true ]; then
		add_check "카드 헤더 seek-btn 클릭 후 fcPlayer.getCurrentTime()이 카드 시작 시각과 ±2초 이내로 일치한다(§5, §13)" player_api "$header_seek_btn_pass" ""
	elif [ "$header_seek_btn_pass" = true ]; then
		add_check "카드 헤더 seek-btn 클릭 후 fcPlayer.getCurrentTime()이 카드 시작 시각과 ±2초 이내로 일치한다(§5, §13)" player_api true ""
	else
		add_check "카드 헤더 seek-btn 클릭 후 fcPlayer.getCurrentTime()이 카드 시작 시각과 ±2초 이내로 일치한다(§5, §13)" player_api false "헤드리스 환경에서 YouTube 플레이어 초기화/재생이 제한되어 판정 불가(네트워크 또는 재생 정책 제약)"
	fi

	# ── DESIGN.md §5-7/§13: the body-frame's own seek-btn button's seek
	# precision -- u008's second frame (t=1083, same video just loaded above,
	# so this exercises the same-video seekTo path rather than loadVideoById).
	# u008's own start (1080) is only 3s from this target, and the player is
	# already mid-playback (nonzero time) BEFORE this click from the previous
	# check, so unlike the 633 check above, "wait for nonzero time" would be
	# vacuously true here too. Instead: read the time right before the click
	# as a baseline, click, then wait -- WITHOUT touching pauseVideo, same
	# reason as the 633 check above -- for the time to have actually jumped
	# away from that baseline (confirms a real seek happened, not just
	# continued playback), then take one follow-up reading that pauses once
	# and checks the value right then, before drift could carry a
	# wrong-but-nearby (1080) landing into the ±1s window.
	frame_seek_btn_pass=false
	if [ "$api_ready" = true ]; then
		base_time="$(eval_js <<'JS'
window.fcPlayer && typeof window.fcPlayer.getCurrentTime === "function" ? window.fcPlayer.getCurrentTime() : -1000
JS
		)"
		ab click '#u008 .body-frame[data-frame-t="1083"] .seek-btn' >/dev/null
		if ab wait --fn "window.fcPlayer && typeof window.fcPlayer.getCurrentTime === 'function' && Math.abs(window.fcPlayer.getCurrentTime() - ($base_time)) > 2" --timeout "$switch_timeout" >/dev/null 2>&1; then
			frame_seek_btn_pass="$(eval_js <<'JS'
(function () {
  var p = window.fcPlayer;
  if (!p || typeof p.pauseVideo !== "function" || typeof p.getCurrentTime !== "function") return false;
  p.pauseVideo();
  return Math.abs(p.getCurrentTime() - 1083) <= 1;
})()
JS
			)"
		fi
	fi
	if [ "$HEADED" = true ]; then
		add_check "본문 프레임의 seek-btn 버튼 클릭 후 fcPlayer.getCurrentTime()이 그 프레임의 시각과 ±1초 이내로 일치한다(§5-7, §13)" player_api "$frame_seek_btn_pass" ""
	elif [ "$frame_seek_btn_pass" = true ]; then
		add_check "본문 프레임의 seek-btn 버튼 클릭 후 fcPlayer.getCurrentTime()이 그 프레임의 시각과 ±1초 이내로 일치한다(§5-7, §13)" player_api true ""
	else
		add_check "본문 프레임의 seek-btn 버튼 클릭 후 fcPlayer.getCurrentTime()이 그 프레임의 시각과 ±1초 이내로 일치한다(§5-7, §13)" player_api false "헤드리스 환경에서 YouTube 플레이어 초기화/재생이 제한되어 판정 불가(네트워크 또는 재생 정책 제약)"
	fi

	# ── DESIGN.md §8: a TOC click must not seek -- fcPlayer's own current time
	# and loaded video_id (the two real playback signals, unlike the dom-level
	# body.dataset.video check in run_dom_checks) must stay exactly where the
	# body-frame seek-btn check above left them.
	toc_no_seek_pass=false
	if [ "$api_ready" = true ]; then
		time_before="$(eval_js <<'JS'
window.fcPlayer && typeof window.fcPlayer.getCurrentTime === "function" ? window.fcPlayer.getCurrentTime() : null
JS
		)"
		video_before="$(eval_js <<'JS'
window.fcPlayer && window.fcPlayer.getVideoData ? window.fcPlayer.getVideoData().video_id : null
JS
		)"
		ab click '.toc-item[data-target="u002"]' >/dev/null
		toc_no_seek_pass="$(eval_js <<JS
(function () {
  var before = $time_before;
  var videoBefore = $video_before;
  if (before === null || videoBefore === null || !window.fcPlayer || typeof window.fcPlayer.getCurrentTime !== "function") return false;
  var after = window.fcPlayer.getCurrentTime();
  var videoAfter = window.fcPlayer.getVideoData ? window.fcPlayer.getVideoData().video_id : null;
  return Math.abs(after - before) <= 1 && videoAfter === videoBefore;
})()
JS
		)"
	fi
	if [ "$HEADED" = true ]; then
		add_check "목차 클릭 후 fcPlayer의 재생 시각/video_id가 변하지 않는다(seek 미발생, §8)" player_api "$toc_no_seek_pass" ""
	elif [ "$toc_no_seek_pass" = true ]; then
		add_check "목차 클릭 후 fcPlayer의 재생 시각/video_id가 변하지 않는다(seek 미발생, §8)" player_api true ""
	else
		add_check "목차 클릭 후 fcPlayer의 재생 시각/video_id가 변하지 않는다(seek 미발생, §8)" player_api false "헤드리스 환경에서 YouTube 플레이어 초기화/재생이 제한되어 판정 불가(네트워크 또는 재생 정책 제약)"
	fi
}

run_dom_checks
run_mobile_dom_checks
run_disabled_mode_checks
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

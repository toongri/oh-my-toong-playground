#!/usr/bin/env bash
set -euo pipefail

# fc-feedback visual-QA fixture builder (plan §7 T10, §8, §12 items 2/3/15).
#
# Real public videos used below, all from channel UCcnTnb0VnZMH7HidCUivO2Q
# ("타임제이"). Discovered with:
#   uvx yt-dlp --flat-playlist --print "%(id)s %(title)s" \
#     https://www.youtube.com/channel/UCcnTnb0VnZMH7HidCUivO2Q/videos
# and confirmed embeddable with:
#   uvx yt-dlp -j --skip-download <url> | jq .playable_in_embed   (true for all three)
#
#   current part 1: NUzEChn9EyI  EAFC24 프로클럽 커뮤니티 C.E.F. / FC Barcelona 팀 연습 (24.1.4) - Part 3 (피드백)  1348s
#   current part 2: yn-qm7lM5p4  EAFC24 프로클럽 커뮤니티 C.E.F. / FC Barcelona 팀 연습 (24.1.4) - Part 2           1101s
#   past (earlier): XkM_tS2Id8Q  EAFC24 프로클럽 커뮤니티 C.E.F. / FC Barcelona 팀 연습 (24.1.3) - Part 1           2341s
#
# All three predate this task and are unrelated to AlgoCare; they are used
# here only as real, embeddable, public YouTube ids for the viewer fixture.
#
# Usage: build.sh <out-dir>
#   <out-dir>/empty          -- init-archive only (empty-archive capture state)
#   <out-dir>/archive        -- full archive with the past + current sessions rendered
#   <out-dir>/disabled-mode  -- disabled-mode (no roster) site render, DESIGN.md
#                               §14 row 34 (disabled-mode-390)
#   <out-dir>/embed-blocked  -- disabled-mode site render of one embeddable:false
#                               video, DESIGN.md §14 row 35 (embed-blocked-390)
#
# No network calls happen in this script: every LLM-stage JSON artifact
# (plan.json, notes.json, similar-choices.json, refs-draft.json,
# refs.verified.json) ships pre-written under work-past/, work-current/,
# work-disabled/ and work-embed-blocked/, and refs.verified.json ships
# already "verified" so verify-refs' HTTP path is never exercised here.
# Idempotent: reruns against the same <out-dir> rebuild it from scratch.
#
# disabled-mode/ and embed-blocked/ are rendered through a second, isolated
# HOME/OMT_DIR (never configured with an archive/roster) so `fc config
# disable` carries forward no archive_repo_path/roster_path (manifest.ts
# carryPaths) -- DESIGN.md §11's disabled mode requires member_ids to be
# empty and no roster to exist at all, not merely a roster that goes unread.

if [ "$#" -lt 1 ]; then
	echo "usage: build.sh <out-dir>" >&2
	exit 1
fi

QA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS_DIR="$(cd "$QA_DIR/../.." && pwd)"
FC_TS="$SCRIPTS_DIR/fc.ts"

# Captured before HOME is reassigned to the sandbox below: FC_QA_MEDIA_DIR's default lives
# under the real user's cache, never under the sandboxed $HOME. Read-only -- gen_frame only
# ever reads from here, never writes.
REAL_HOME="$HOME"
FC_QA_MEDIA_DIR="${FC_QA_MEDIA_DIR:-$REAL_HOME/.cache/fc-feedback-eval}"

mkdir -p "$1"
OUT="$(cd "$1" && pwd)"

log() { echo "[build.sh] $*" >&2; }

log "resetting $OUT"
rm -rf "$OUT"
mkdir -p "$OUT"

# Isolated HOME/OMT_DIR: the user's real ~/.fc-feedback manifest and real
# OMT_DIR session directories must never be read or written by this build.
export HOME="$OUT/.home"
export OMT_DIR="$OUT/.omt"
mkdir -p "$HOME" "$OMT_DIR"

CWD="$OUT/.cwd"
mkdir -p "$CWD"
git init -q "$CWD"

fc() {
	(cd "$CWD" && bun "$FC_TS" "$@")
}

gen_frame() {
	# gen_frame <out-webp> <video-id> <time-seconds> -- a single-frame webp for the QA
	# fixture. Uses the REAL cached video at FC_QA_MEDIA_DIR/<video-id>/video/* (read-only)
	# when present, extracting the frame at the given time; falls back to a synthetic frame
	# (still varied by <time-seconds>) when that video isn't cached locally.
	local out="$1"
	local video_id="$2"
	local t="$3"
	local real
	# `|| true`: a missing video dir makes `find` exit non-zero, which -- combined with
	# pipefail -- would otherwise trip `set -e` on every fallback-path video, not just report
	# "no local file" via an empty $real.
	real="$(find "$FC_QA_MEDIA_DIR/$video_id/video" -type f 2>/dev/null | head -n 1)" || true
	if [ -n "$real" ]; then
		# -nostdin: gen_frame runs inside a `while read < <(jq ...)` loop -- without it,
		# ffmpeg reads from the very same stdin/pipe the loop's `read` is consuming from
		# and steals bytes from the next line, corrupting later iterations' fields.
		ffmpeg -nostdin -y -hide_banner -loglevel error -ss "$t" -i "$real" -frames:v 1 -c:v libwebp "$out"
	else
		ffmpeg -nostdin -y -hide_banner -loglevel error -f lavfi -i "testsrc2=size=320x180:rate=1" -ss "$t" -frames:v 1 -c:v libwebp "$out"
	fi
}

gen_frames_for_unit_starts() {
	# gen_frames_for_unit_starts <work-dir> -- generates <work-dir>/img/<uNNN>-start.webp for
	# every unit in <work-dir>/plan.json's flattened matches[].topics[].units[] order, at the
	# video+time its lines.json start_line gives (plan §7 T10's "start image = unit start").
	local work="$1"
	local uid video t
	while IFS=$'\t' read -r uid video t; do
		gen_frame "$work/img/${uid}-start.webp" "$video" "$t"
	done < <(jq -r --slurpfile lines "$work/lines.json" '
		[.matches[].topics[].units[]] as $units
		| range(0; $units | length) as $i
		| $units[$i] as $u
		| $lines[0][$u.start_line] as $l
		| ("u" + ("000" + (($i + 1) | tostring))[-3:]) + "\t" + $l.video + "\t" + ($l.start | tostring)
	' "$work/plan.json")
}

gen_frames_for_candidates() {
	# gen_frames_for_candidates <work-dir> -- generates <work-dir>/img/<uNNN>-<cNNN>.webp for
	# every unit/candidate pair named in <work-dir>/plan.json's key_frame_candidate_ids, at
	# that candidate's own video+time from candidates.json ("body frame = frame t").
	local work="$1"
	local uid cid video t
	while IFS=$'\t' read -r uid cid video t; do
		gen_frame "$work/img/${uid}-${cid}.webp" "$video" "$t"
	done < <(jq -r --slurpfile cands "$work/candidates.json" '
		[.matches[].topics[].units[]] as $units
		| range(0; $units | length) as $i
		| $units[$i] as $u
		| ("u" + ("000" + (($i + 1) | tostring))[-3:]) as $uid
		| ($u.key_frame_candidate_ids // [])[] as $cid
		| ($cands[0][] | select(.id == $cid)) as $c
		| $uid + "\t" + $cid + "\t" + $c.video + "\t" + ($c.t | tostring)
	' "$work/plan.json")
}

# ── 1/8: empty archive (init-archive only, empty-state capture) ────────────
log "1/8 empty archive"
fc init-archive --archive "$OUT/empty" >/dev/null

# ── 2/8: seed a fresh git archive from archive-seed/ ────────────────────────
log "2/8 seeding archive"
ARCHIVE="$OUT/archive"
mkdir -p "$ARCHIVE"
git init -q "$ARCHIVE"
fc init-archive --archive "$ARCHIVE" >/dev/null
cp "$QA_DIR/archive-seed/taxonomy.yaml" "$ARCHIVE/taxonomy.yaml"
cp "$QA_DIR/archive-seed/roster.yaml" "$ARCHIVE/roster.yaml"
git -C "$ARCHIVE" add -A
git -C "$ARCHIVE" -c user.name=fc-feedback-qa -c user.email=fc-feedback-qa@example.com commit -q -m "fc-feedback QA fixture: init archive"

fc config set --archive "$ARCHIVE" --roster "$ARCHIVE/roster.yaml" --pages-url "https://example.github.io/fc-feedback-qa/" >/dev/null

# ── 3/8: render the past session (single part) ──────────────────────────────
log "3/8 rendering past session"
WORK_PAST="$OUT/.work-past"
rm -rf "$WORK_PAST"
mkdir -p "$WORK_PAST/img"
for f in session.json lines.json candidates.json plan.json notes.json similar-choices.json refs-draft.json refs.verified.json; do
	cp "$QA_DIR/work-past/$f" "$WORK_PAST/$f"
done

fc check plan --work "$WORK_PAST" >/dev/null
fc check notes --work "$WORK_PAST" >/dev/null
fc similar --work "$WORK_PAST" >/dev/null
fc check similar --work "$WORK_PAST" >/dev/null
fc check refs --work "$WORK_PAST" >/dev/null

gen_frames_for_unit_starts "$WORK_PAST"

fc render --work "$WORK_PAST" >/dev/null

# ── 4/8: current session -- approved proposed tag, then check plan ─────────
log "4/8 checking current session (plan/notes)"
WORK_CUR="$OUT/.work-current"
rm -rf "$WORK_CUR"
mkdir -p "$WORK_CUR/img"
for f in session.json lines.json candidates.json plan.json notes.json similar-choices.json refs-draft.json refs.verified.json; do
	cp "$QA_DIR/work-current/$f" "$WORK_CUR/$f"
done

# plan.json's units u006/u007 use the "세트피스" topic tag, which is not in
# archive-seed/taxonomy.yaml. taxonomy add runs BEFORE check plan, so the tag
# is already an ordinary taxonomy member by the time check plan validates the
# plan -- the "approved proposed tag" flow, never the pending gate.
fc taxonomy add 세트피스 --work "$WORK_CUR" >/dev/null

fc check plan --work "$WORK_CUR" >/dev/null
fc check notes --work "$WORK_CUR" >/dev/null

# ── 5/8: similar-candidates.json must match the committed expected fixture ─
log "5/8 similar (vs similar-candidates.expected.json)"
fc similar --work "$WORK_CUR" >/dev/null
if ! diff -u <(jq -S . "$QA_DIR/similar-candidates.expected.json") <(jq -S . "$WORK_CUR/similar-candidates.json") >"$OUT/.similar.diff" 2>&1; then
	log "similar-candidates.json regressed vs similar-candidates.expected.json:"
	cat "$OUT/.similar.diff" >&2
	exit 1
fi

fc check similar --work "$WORK_CUR" >/dev/null
fc check refs --work "$WORK_CUR" >/dev/null

gen_frames_for_unit_starts "$WORK_CUR"
gen_frames_for_candidates "$WORK_CUR"

fc render --work "$WORK_CUR" >/dev/null

# ── 6/8 + 7/8: disabled-mode + embed-blocked (DESIGN.md §14 rows 34/35) ─────
#
# A second, isolated HOME/OMT_DIR that is never `config set` -- `fc config
# disable` (manifest.ts disableFc) carries forward the PREVIOUS manifest's
# archive_repo_path/roster_path (carryPaths), so reusing the already-
# configured $HOME above would leave status.roster_path set and loadRoster
# would still load a real roster even in disabled mode. Starting from a
# manifest that has never been configured means disableFc carries forward
# nothing, matching DESIGN.md §11's "명단이 없는" (no roster at all) disabled
# mode rather than merely a configured roster that goes unread.
HOME2="$OUT/.home-disabled"
OMT2="$OUT/.omt-disabled"
CWD2="$OUT/.cwd-disabled"
mkdir -p "$HOME2" "$OMT2" "$CWD2"
git init -q "$CWD2"

fc2() {
	(cd "$CWD2" && HOME="$HOME2" OMT_DIR="$OMT2" bun "$FC_TS" "$@")
}

fc2 config disable >/dev/null

log "6/8 disabled-mode fixture (no roster)"
WORK_DISABLED="$OUT/.work-disabled"
rm -rf "$WORK_DISABLED"
mkdir -p "$WORK_DISABLED/img"
for f in session.json lines.json candidates.json plan.json notes.json similar-choices.json refs-draft.json refs.verified.json; do
	cp "$QA_DIR/work-disabled/$f" "$WORK_DISABLED/$f"
done

fc2 check plan --work "$WORK_DISABLED" >/dev/null
fc2 check notes --work "$WORK_DISABLED" >/dev/null
fc2 similar --work "$WORK_DISABLED" >/dev/null
fc2 check similar --work "$WORK_DISABLED" >/dev/null
fc2 check refs --work "$WORK_DISABLED" >/dev/null
gen_frames_for_unit_starts "$WORK_DISABLED"
fc2 render --site-only --work "$WORK_DISABLED" >/dev/null

rm -rf "$OUT/disabled-mode"
mkdir -p "$OUT/disabled-mode"
cp -R "$WORK_DISABLED/site/." "$OUT/disabled-mode/"

log "7/8 embed-blocked fixture (embeddable:false)"
WORK_EMBED="$OUT/.work-embed-blocked"
rm -rf "$WORK_EMBED"
mkdir -p "$WORK_EMBED/img"
for f in session.json lines.json candidates.json plan.json notes.json similar-choices.json refs-draft.json refs.verified.json; do
	cp "$QA_DIR/work-embed-blocked/$f" "$WORK_EMBED/$f"
done

fc2 check plan --work "$WORK_EMBED" >/dev/null
fc2 check notes --work "$WORK_EMBED" >/dev/null
fc2 similar --work "$WORK_EMBED" >/dev/null
fc2 check similar --work "$WORK_EMBED" >/dev/null
fc2 check refs --work "$WORK_EMBED" >/dev/null
gen_frames_for_unit_starts "$WORK_EMBED"
fc2 render --site-only --work "$WORK_EMBED" >/dev/null

rm -rf "$OUT/embed-blocked"
mkdir -p "$OUT/embed-blocked"
cp -R "$WORK_EMBED/site/." "$OUT/embed-blocked/"

# ── 8/8: publish-prep -- its JSON line is this script's final stdout line ──
log "8/8 publish-prep"
fc publish-prep

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
#   <out-dir>/empty    -- init-archive only (empty-archive capture state)
#   <out-dir>/archive  -- full archive with the past + current sessions rendered
#
# No network calls happen in this script: every LLM-stage JSON artifact
# (plan.json, notes.json, similar-choices.json, refs-draft.json,
# refs.verified.json) ships pre-written under work-past/ and work-current/,
# and refs.verified.json ships already "verified" so verify-refs' HTTP path
# is never exercised here. Idempotent: reruns against the same <out-dir>
# rebuild it from scratch.

if [ "$#" -lt 1 ]; then
	echo "usage: build.sh <out-dir>" >&2
	exit 1
fi

QA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS_DIR="$(cd "$QA_DIR/../.." && pwd)"
FC_TS="$SCRIPTS_DIR/fc.ts"

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
	# gen_frame <out-webp> <seed-seconds> -- a synthetic (or, with FC_QA_VIDEO
	# set to a local video file, real) single-frame webp for the QA fixture.
	local out="$1"
	local seed="$2"
	if [ -n "${FC_QA_VIDEO:-}" ] && [ -f "${FC_QA_VIDEO:-}" ]; then
		ffmpeg -y -hide_banner -loglevel error -ss "$seed" -i "$FC_QA_VIDEO" -frames:v 1 -c:v libwebp "$out"
	else
		ffmpeg -y -hide_banner -loglevel error -f lavfi -i "testsrc2=size=320x180:rate=1" -ss "$seed" -frames:v 1 -c:v libwebp "$out"
	fi
}

# ── 1/6: empty archive (init-archive only, empty-state capture) ────────────
log "1/6 empty archive"
fc init-archive --archive "$OUT/empty" >/dev/null

# ── 2/6: seed a fresh git archive from archive-seed/ ────────────────────────
log "2/6 seeding archive"
ARCHIVE="$OUT/archive"
mkdir -p "$ARCHIVE"
git init -q "$ARCHIVE"
fc init-archive --archive "$ARCHIVE" >/dev/null
cp "$QA_DIR/archive-seed/taxonomy.yaml" "$ARCHIVE/taxonomy.yaml"
cp "$QA_DIR/archive-seed/roster.yaml" "$ARCHIVE/roster.yaml"
git -C "$ARCHIVE" add -A
git -C "$ARCHIVE" -c user.name=fc-feedback-qa -c user.email=fc-feedback-qa@example.com commit -q -m "fc-feedback QA fixture: init archive"

fc config set --archive "$ARCHIVE" --roster "$ARCHIVE/roster.yaml" --pages-url "https://example.github.io/fc-feedback-qa/" >/dev/null

# ── 3/6: render the past session (single part) ──────────────────────────────
log "3/6 rendering past session"
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

seed=0
for u in u001 u002 u003; do
	gen_frame "$WORK_PAST/img/${u}-start.webp" "$seed"
	seed=$((seed + 3))
done

fc render --work "$WORK_PAST" >/dev/null

# ── 4/6: current session -- approved proposed tag, then check plan ─────────
log "4/6 checking current session (plan/notes)"
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

# ── 5/6: similar-candidates.json must match the committed expected fixture ─
log "5/6 similar (vs similar-candidates.expected.json)"
fc similar --work "$WORK_CUR" >/dev/null
if ! diff -u <(jq -S . "$QA_DIR/similar-candidates.expected.json") <(jq -S . "$WORK_CUR/similar-candidates.json") >"$OUT/.similar.diff" 2>&1; then
	log "similar-candidates.json regressed vs similar-candidates.expected.json:"
	cat "$OUT/.similar.diff" >&2
	exit 1
fi

fc check similar --work "$WORK_CUR" >/dev/null
fc check refs --work "$WORK_CUR" >/dev/null

seed=0
for u in u001 u002 u003 u004 u005 u006 u007 u008 u009 u010 u011 u012 u013 u014 u015; do
	gen_frame "$WORK_CUR/img/${u}-start.webp" "$seed"
	seed=$((seed + 3))
done
for pair in "u001 c001" "u004 c002" "u004 c003" "u008 c004" "u008 c005" "u008 c006" "u011 c007" "u013 c008" "u013 c009"; do
	set -- $pair
	gen_frame "$WORK_CUR/img/${1}-${2}.webp" "$seed"
	seed=$((seed + 3))
done

fc render --work "$WORK_CUR" >/dev/null

# ── 6/6: publish-prep -- its JSON line is this script's final stdout line ──
log "6/6 publish-prep"
fc publish-prep

#!/bin/bash
# =============================================================================
# omt-ledger.sh
# Durable session-ledger append/replace helper (plan TODO 2, D4, D6).
#
# Interface:
#   omt-ledger.sh append <section>   # stdin -> append to end of "## <section>"
#   omt-ledger.sh now                # stdin -> replace "## Now" section content
#
# Content is read from stdin ONLY (never argv), so ledger prose containing
# shell metacharacters never sits in a command's write-target position (D6).
# The ledger path is computed internally from $OMT_DIR/$OMT_SESSION_ID and is
# NEVER echoed to argv/stdout -- exposing it would arm the pre-tool-enforcer
# write-guard on unrelated commands that merely mention the path string (D6).
# =============================================================================
set -euo pipefail

usage() {
  echo "usage: omt-ledger.sh append <section> | omt-ledger.sh now" >&2
  exit 1
}

SUBCOMMAND="${1:-}"

case "$SUBCOMMAND" in
  append)
    SECTION_NAME="${2:-}"
    MODE="append"
    ;;
  now)
    SECTION_NAME="Now"
    MODE="replace"
    ;;
  *)
    usage
    ;;
esac

case "$SECTION_NAME" in
  "Now"|"Decisions"|"User Corrections (verbatim)"|"Pending"|"Pointers"|"Learnings")
    ;;
  *)
    echo "omt-ledger: invalid section '$SECTION_NAME'" >&2
    exit 1
    ;;
esac

if [ -z "${OMT_SESSION_ID:-}" ] || [ "$OMT_SESSION_ID" = "default" ]; then
  echo "omt-ledger: refusing -- OMT_SESSION_ID unset or default" >&2
  exit 1
fi

if [ -z "${OMT_DIR:-}" ]; then
  echo "omt-ledger: refusing -- OMT_DIR unset" >&2
  exit 1
fi

LEDGER_FILE="$OMT_DIR/session-ledger-$OMT_SESSION_ID.md"

# Serialize the read-modify-write critical section below (skeleton bootstrap
# through the final mv) across concurrent append/now invocations racing on
# the same ledger file (PR #162 finding A, P2: without this, two concurrent
# writers can last-writer-wins clobber each other's content). mkdir is
# atomic on POSIX and portable to macOS Bash 3.2 -- flock is unavailable
# there, unlike hooks/rules-injector/session-state-lock.ts's mkdir-based lock.
LOCK_DIR="$LEDGER_FILE.lock"
_lock_acquired=0
_lock_attempt=0
while [ "$_lock_attempt" -lt 50 ]; do
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    _lock_acquired=1
    break
  fi
  _lock_attempt=$((_lock_attempt + 1))
  sleep 0.1
done

if [ "$_lock_acquired" -ne 1 ]; then
  echo "omt-ledger: could not acquire lock $LOCK_DIR (timeout) -- ledger left unchanged" >&2
  exit 1
fi

# Release the lock (and clean up any tmp file) on every exit path from here
# on -- normal success, the exit-3 fail-loud branch, and the awk-failure
# branch all pass through this trap. TMP_FILE is unset until mktemp runs
# below; ${TMP_FILE:-} tolerates that under `set -u`.
trap 'rm -f "${TMP_FILE:-}" 2>/dev/null; rmdir "$LOCK_DIR" 2>/dev/null' EXIT

LEDGER_SKELETON='## Now
## Decisions
## User Corrections (verbatim)
## Pending
## Pointers
## Learnings'

if [ ! -f "$LEDGER_FILE" ]; then
  printf '%s\n' "$LEDGER_SKELETON" > "$LEDGER_FILE"
fi

TARGET_HEADER="## $SECTION_NAME"

# Read stdin ONLY -- never argv (D6). Captured via command substitution, so
# metacharacters in the payload are never re-evaluated by the shell.
OMT_LEDGER_CONTENT="$(cat)"
export OMT_LEDGER_CONTENT

TMP_FILE="$(mktemp "${LEDGER_FILE}.XXXXXX")"

# Content is handed to awk via ENVIRON (not -v): -v assignments undergo the
# same backslash-escape processing as string literals, which would corrupt a
# payload containing literal backslash sequences. ENVIRON values are raw
# process-environment bytes, never re-parsed.
# Section identity is structural: the 6 known headers appear in a fixed order
# (idx walks the sequence), so a line is a real section header ONLY when it
# equals the next-expected header H[idx]. A header-shaped line sitting in a
# section's content (e.g. "## Pending" written into Decisions prose) is NOT a
# boundary and is NOT mistaken for the target section on a later append (F2/S9).
#
# Residual gap (PR #162 P2): the above holds for lines ALREADY on disk, but a
# NEW content line from stdin that happens to equal one of the 6 skeleton
# headers verbatim (e.g. a "## Decisions" line inside Now's body) would become
# indistinguishable from a real header on the NEXT invocation's fresh idx-walk
# (this script re-parses the whole file from scratch every run). Fixed via
# escape-on-write: emit_content() prefixes any NEW content line that collides
# with a skeleton header with SENTINEL before it ever reaches disk, so it can
# never re-match H[idx] on a later run. SENTINEL is a fixed literal string
# ("OMT_ESC::") with no ERE metacharacters and no plausible collision with
# ledger prose; hooks/session-start.sh's recovery reader strips exactly one
# SENTINEL back off on read (unescape-on-read) -- the two must stay in sync.
# Pre-existing on-disk lines are never touched by this (verbatim passthrough).
awk -v target="$TARGET_HEADER" -v mode="$MODE" '
function is_skeleton_header(line,    h) {
  for (h = 1; h <= n; h++) if (line == H[h]) return 1
  return 0
}
function escape_line(line,    stripped) {
  stripped = line
  while (index(stripped, SENTINEL) == 1) stripped = substr(stripped, length(SENTINEL) + 1)
  if (is_skeleton_header(stripped)) return SENTINEL line
  return line
}
function emit_content(   nlines, larr, i) {
  if (content == "") return
  nlines = split(content, larr, "\n")
  for (i = 1; i <= nlines; i++) print escape_line(larr[i])
}
BEGIN {
  SENTINEL = "OMT_ESC::"
  content = ENVIRON["OMT_LEDGER_CONTENT"]
  n = split("## Now|## Decisions|## User Corrections (verbatim)|## Pending|## Pointers|## Learnings", H, "|")
  idx = 1
  in_target = 0
  inserted = 0
  found_target = 0
}
{
  if (idx <= n && $0 == H[idx]) {
    # A real structural header: we are leaving the previous section. Flush a
    # pending append at the section end (before this header) if not yet done.
    if (in_target && mode == "append" && inserted == 0) {
      emit_content()
      inserted = 1
    }
    in_target = 0
    idx++
    if ($0 == target) {
      print $0
      in_target = 1
      found_target = 1
      if (mode == "replace") {
        emit_content()
        inserted = 1
      }
      next
    }
    print $0
    next
  }
  # Ordinary content line (including lines that merely look like a header).
  if (in_target && mode == "replace") {
    next
  }
  print $0
}
END {
  if (in_target && inserted == 0) {
    emit_content()
  }
  # Target header never seen -> the ledger is missing this section (corrupted
  # or foreign-created). Signal a hard error instead of letting mv overwrite
  # the file with content silently dropped -- a durable record fails loud.
  if (!found_target) exit 3
}
' "$LEDGER_FILE" > "$TMP_FILE" || _awk_rc=$?
_awk_rc="${_awk_rc:-0}"

if [ "$_awk_rc" -eq 3 ]; then
  rm -f "$TMP_FILE"
  echo "omt-ledger: section '$TARGET_HEADER' not found in ledger -- refusing to $MODE (would silently drop content). Ledger left unchanged." >&2
  exit 1
elif [ "$_awk_rc" -ne 0 ]; then
  rm -f "$TMP_FILE"
  echo "omt-ledger: awk failed (exit $_awk_rc) -- ledger left unchanged" >&2
  exit 1
fi

mv "$TMP_FILE" "$LEDGER_FILE"

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
awk -v target="$TARGET_HEADER" -v mode="$MODE" '
BEGIN {
  content = ENVIRON["OMT_LEDGER_CONTENT"]
  n = split("## Now|## Decisions|## User Corrections (verbatim)|## Pending|## Pointers|## Learnings", H, "|")
  idx = 1
  in_target = 0
  inserted = 0
}
{
  if (idx <= n && $0 == H[idx]) {
    # A real structural header: we are leaving the previous section. Flush a
    # pending append at the section end (before this header) if not yet done.
    if (in_target && mode == "append" && inserted == 0) {
      if (content != "") print content
      inserted = 1
    }
    in_target = 0
    idx++
    if ($0 == target) {
      print $0
      in_target = 1
      if (mode == "replace") {
        if (content != "") print content
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
    if (content != "") print content
  }
}
' "$LEDGER_FILE" > "$TMP_FILE"

mv "$TMP_FILE" "$LEDGER_FILE"

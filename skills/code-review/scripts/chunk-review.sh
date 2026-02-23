#!/bin/bash
#
# Chunk Review (job mode default)
#
# Subcommands:
#   chunk-review.sh start [options] "question"     # returns JOB_DIR immediately
#   chunk-review.sh status [--json|--text|--checklist] JOB_DIR # poll progress
#   chunk-review.sh wait [--cursor CURSOR] [--bucket auto|N] [--interval-ms N] [--timeout-ms N] JOB_DIR
#   chunk-review.sh results [--json] JOB_DIR       # print collected outputs
#   chunk-review.sh stop JOB_DIR                   # best-effort stop running reviewers
#   chunk-review.sh clean JOB_DIR                  # remove job directory
#
# One-shot (DEFAULT):
#   chunk-review.sh "question"
#   chunk-review.sh --stdin
#   (starts a job, waits for completion, prints results, cleans up — foreground blocking)
#
# Host-agent mode (opt-in only):
#   chunk-review.sh --host-agent "question"
#   CHUNK_REVIEW_HOST_AGENT=1 chunk-review.sh "question"
#   (returns a single `wait` JSON payload immediately; caller drives progress + results)
#
# Stdin mode:
#   chunk-review.sh --stdin
#   chunk-review.sh start --stdin
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JOB_SCRIPT="$SCRIPT_DIR/chunk-review-job.sh"

usage() {
  cat <<EOF
Chunk Review

Default mode is job-based parallel execution (pollable).

Usage:
  $(basename "$0") start [options] "question"
  $(basename "$0") start --stdin
  $(basename "$0") status [--json|--text|--checklist] <jobDir>
  $(basename "$0") wait [--cursor CURSOR] [--bucket auto|N] [--interval-ms N] [--timeout-ms N] <jobDir>
  $(basename "$0") results [--json] <jobDir>
  $(basename "$0") stop <jobDir>
  $(basename "$0") clean <jobDir>

Options:
  --stdin          Read question from stdin
  --host-agent     Enable host-agent mode (immediate return + external polling)

One-shot (default):
  $(basename "$0") "question"
  $(basename "$0") --stdin
EOF
}

if [ $# -eq 0 ]; then
  usage
  exit 1
fi

case "$1" in
  -h|--help|help)
    usage
    exit 0
    ;;
esac

if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js is required to run Chunk Review." >&2
  echo "Claude Code plugins cannot bundle or auto-install Node." >&2
  echo "" >&2
  echo "macOS (Homebrew): brew install node" >&2
  echo "Or download from: https://nodejs.org/" >&2
  exit 127
fi

case "$1" in
  start|status|wait|results|stop|clean)
    exec "$JOB_SCRIPT" "$@"
    ;;
esac

# Check for --host-agent flag (opt-in for host-agent mode)
HOST_AGENT="${CHUNK_REVIEW_HOST_AGENT:-0}"
PASSTHROUGH_ARGS=()
for arg in "$@"; do
  if [ "$arg" = "--host-agent" ]; then
    HOST_AGENT=1
  elif [ "$arg" = "--blocking" ]; then
    # Legacy flag: --blocking is now a no-op (one-shot foreground is the default).
    true
  else
    PASSTHROUGH_ARGS+=("$arg")
  fi
done

# Host-agent mode is opt-in only.
# Activate with: --host-agent flag or CHUNK_REVIEW_HOST_AGENT=1 env var.
# Default path is one-shot foreground (start → wait → results → cleanup).
in_host_agent_context() {
  [ "$HOST_AGENT" = "1" ]
}

JOB_DIR="$("$JOB_SCRIPT" start "${PASSTHROUGH_ARGS[@]}")"

cleanup() {
  if [ -n "${JOB_DIR:-}" ] && [ -d "$JOB_DIR" ]; then
    "$JOB_SCRIPT" stop "$JOB_DIR" >/dev/null 2>&1 || true
    "$JOB_SCRIPT" clean "$JOB_DIR" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# Host-agent mode (opt-in): return immediately with a `wait` JSON payload and let the
# caller drive progress updates. Only activated by --host-agent flag or CHUNK_REVIEW_HOST_AGENT=1.
if in_host_agent_context; then
  trap - EXIT
  exec "$JOB_SCRIPT" wait "$JOB_DIR"
fi

echo "chunk-review: started ${JOB_DIR}" >&2

while true; do
  WAIT_JSON="$("$JOB_SCRIPT" wait --timeout-ms 60000 "$JOB_DIR")"
  OVERALL="$(printf '%s' "$WAIT_JSON" | node -e '
const fs=require("fs");
const d=JSON.parse(fs.readFileSync(0,"utf8"));
process.stdout.write(String(d.overallState||""));
')"

  "$JOB_SCRIPT" status --text "$JOB_DIR" >&2

  if [ "$OVERALL" = "done" ]; then
    break
  fi

  if [ -z "$OVERALL" ]; then
    echo "chunk-review: failed to parse overallState, aborting" >&2
    break
  fi
done

"$JOB_SCRIPT" results --json "$JOB_DIR"

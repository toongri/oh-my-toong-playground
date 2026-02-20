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
# One-shot:
#   chunk-review.sh "question"
#   (in a real terminal: starts a job, waits for completion, prints results, cleans up)
#   (in host-agent tool UIs: returns a single `wait` JSON payload immediately; host drives progress + results)
#
# Stdin mode:
#   chunk-review.sh --stdin
#   chunk-review.sh start --stdin
#
# Blocking mode:
#   chunk-review.sh --blocking --stdin
#   (forces blocking wait behavior, bypassing host agent context detection)
#

set -e

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
  --blocking       Force blocking wait (bypass host agent context detection)

One-shot:
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

# Check for --blocking flag
BLOCKING=false
PASSTHROUGH_ARGS=()
for arg in "$@"; do
  if [ "$arg" = "--blocking" ]; then
    BLOCKING=true
  else
    PASSTHROUGH_ARGS+=("$arg")
  fi
done

in_host_agent_context() {
  if [ -n "${CODEX_CACHE_FILE:-}" ]; then
    return 0
  fi

  case "$SCRIPT_DIR" in
    */.codex/skills/*|*/.claude/skills/*)
      # Tool-call environments typically do not provide a real TTY on stdout/stderr.
      if [ ! -t 1 ] && [ ! -t 2 ]; then
        return 0
      fi
      ;;
  esac

  return 1
}

JOB_DIR="$("$JOB_SCRIPT" start "${PASSTHROUGH_ARGS[@]}")"

# Host agents (Codex CLI / Claude Code) cannot update native TODO/plan UIs while a long-running
# command is executing. If we're in a host agent context and --blocking is NOT set, return
# immediately with a single `wait` JSON payload and let the host agent drive progress updates.
if [ "$BLOCKING" = "false" ] && in_host_agent_context; then
  exec "$JOB_SCRIPT" wait "$JOB_DIR"
fi

echo "chunk-review: started ${JOB_DIR}" >&2

cleanup_on_signal() {
  if [ -n "${JOB_DIR:-}" ] && [ -d "$JOB_DIR" ]; then
    "$JOB_SCRIPT" stop "$JOB_DIR" >/dev/null 2>&1 || true
    "$JOB_SCRIPT" clean "$JOB_DIR" >/dev/null 2>&1 || true
  fi
  exit 130
}

trap cleanup_on_signal INT TERM

while true; do
  WAIT_JSON="$("$JOB_SCRIPT" wait "$JOB_DIR")"
  OVERALL="$(printf '%s' "$WAIT_JSON" | node -e '
const fs=require("fs");
const d=JSON.parse(fs.readFileSync(0,"utf8"));
process.stdout.write(String(d.overallState||""));
')"

  "$JOB_SCRIPT" status --text "$JOB_DIR" >&2

  if [ "$OVERALL" = "done" ]; then
    break
  fi
done

trap - INT TERM

"$JOB_SCRIPT" results "$JOB_DIR"
"$JOB_SCRIPT" clean "$JOB_DIR" >/dev/null

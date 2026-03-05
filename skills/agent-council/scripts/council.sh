#!/bin/bash
#
# Agent Council (job mode default)
#
# Subcommands:
#   council.sh start [options] "question"     # returns JOB_DIR immediately
#   council.sh status [--json|--text|--checklist] JOB_DIR # poll progress
#   council.sh wait [--cursor CURSOR] [--bucket auto|N] [--interval-ms N] [--timeout-ms N] JOB_DIR
#   council.sh collect JOB_DIR                 # block until done, print manifest
#   council.sh results [--json] JOB_DIR       # print collected outputs
#   council.sh stop JOB_DIR                   # best-effort stop running members
#   council.sh clean JOB_DIR                  # remove job directory
#
# One-shot:
#   council.sh "question"
#   (in a real terminal: starts a job, waits for completion, prints results, cleans up)
#   (in host-agent tool UIs: returns JOB_DIR immediately; host calls collect + reads output files directly)
#
# Stdin mode:
#   council.sh --stdin
#   council.sh start --stdin
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JOB_SCRIPT="$SCRIPT_DIR/council-job.sh"

usage() {
  cat <<EOF
Agent Council

Default mode is job-based parallel execution (pollable).

Usage:
  $(basename "$0") start [options] "question"
  $(basename "$0") start --stdin
  $(basename "$0") status [--json|--text|--checklist] <jobDir>
  $(basename "$0") wait [--cursor CURSOR] [--bucket auto|N] [--interval-ms N] [--timeout-ms N] <jobDir>
  $(basename "$0") collect <jobDir>
  $(basename "$0") results [--json] <jobDir>
  $(basename "$0") stop <jobDir>
  $(basename "$0") clean <jobDir>

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
  echo "Error: Node.js is required to run Agent Council." >&2
  echo "Claude Code plugins cannot bundle or auto-install Node." >&2
  echo "" >&2
  echo "macOS (Homebrew): brew install node" >&2
  echo "Or download from: https://nodejs.org/" >&2
  exit 127
fi

case "$1" in
  start|status|wait|collect|results|stop|clean)
    exec "$JOB_SCRIPT" "$@"
    ;;
esac

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

JOB_DIR="$("$JOB_SCRIPT" start "$@")"

# Host agents (Codex CLI / Claude Code) drive their own polling. Return JOB_DIR immediately so the
# host agent can call `collect` and read output files directly.
if in_host_agent_context; then
  echo "$JOB_DIR"
  exit 0
fi

echo "council: started ${JOB_DIR}" >&2

cleanup_on_signal() {
  if [ -n "${JOB_DIR:-}" ] && [ -d "$JOB_DIR" ]; then
    "$JOB_SCRIPT" stop "$JOB_DIR" >/dev/null 2>&1 || true
    "$JOB_SCRIPT" clean "$JOB_DIR" >/dev/null 2>&1 || true
  fi
  exit 130
}

trap cleanup_on_signal INT TERM

"$JOB_SCRIPT" collect "$JOB_DIR" >/dev/null

trap - INT TERM

"$JOB_SCRIPT" results "$JOB_DIR"
"$JOB_SCRIPT" clean "$JOB_DIR" >/dev/null

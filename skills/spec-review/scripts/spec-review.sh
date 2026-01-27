#!/bin/bash
#
# Spec Review (job mode default)
#
# Subcommands:
#   spec-review.sh start [options] "question"     # returns JOB_DIR immediately
#   spec-review.sh status [--json|--text|--checklist] JOB_DIR # poll progress
#   spec-review.sh wait [--cursor CURSOR] [--bucket auto|N] [--interval-ms N] [--timeout-ms N] JOB_DIR
#   spec-review.sh results [--json] JOB_DIR       # print collected outputs
#   spec-review.sh stop JOB_DIR                   # best-effort stop running reviewers
#   spec-review.sh clean JOB_DIR                  # remove job directory
#
# Spec context (auto-loads spec files):
#   spec-review.sh start --spec <spec-name> "question"
#
# One-shot:
#   spec-review.sh "question"
#   (in a real terminal: starts a job, waits for completion, prints results, cleans up)
#   (in host-agent tool UIs: returns a single `wait` JSON payload immediately; host drives progress + results)
#
# Stdin mode:
#   spec-review.sh --stdin
#   spec-review.sh start --stdin
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JOB_SCRIPT="$SCRIPT_DIR/spec-review-job.sh"

usage() {
  cat <<EOF
Spec Review

Default mode is job-based parallel execution (pollable).

Usage:
  $(basename "$0") start [options] "question"
  $(basename "$0") start --stdin
  $(basename "$0") start --spec <spec-name> "question"
  $(basename "$0") status [--json|--text|--checklist] <jobDir>
  $(basename "$0") wait [--cursor CURSOR] [--bucket auto|N] [--interval-ms N] [--timeout-ms N] <jobDir>
  $(basename "$0") results [--json] <jobDir>
  $(basename "$0") stop <jobDir>
  $(basename "$0") clean <jobDir>

Options:
  --spec <name>    Auto-load spec context from .omt/specs/<name>/
  --stdin          Read question from stdin

One-shot:
  $(basename "$0") "question"
  $(basename "$0") --stdin
  $(basename "$0") --spec <spec-name> "question"
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
  echo "Error: Node.js is required to run Spec Review." >&2
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

# Host agents (Codex CLI / Claude Code) cannot update native TODO/plan UIs while a long-running
# command is executing. If we're in a host agent context, return immediately with a single `wait`
# JSON payload (includes `.ui.codex.update_plan.plan` / `.ui.claude.todo_write.todos`) and let the
# host agent drive progress updates with repeated short `wait` calls + native UI updates.
if in_host_agent_context; then
  exec "$JOB_SCRIPT" wait "$JOB_DIR"
fi

echo "spec-review: started ${JOB_DIR}" >&2

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

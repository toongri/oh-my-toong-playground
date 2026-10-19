#!/usr/bin/env bash
# Colocated test: runs the lint self-test (every planted defect must be caught, clean fixtures must pass).
# Skips with exit 0 when agent-browser or jq is missing, so `make test` stays green on machines without them.
set -euo pipefail

for tool in agent-browser jq; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "SKIP lint_test.sh: '$tool' not found on PATH"
    exit 0
  fi
done

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
bash "$HERE/selftest/run.sh"

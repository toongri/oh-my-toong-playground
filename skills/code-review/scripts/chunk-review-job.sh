#!/bin/bash
#
# chunk-review-job.sh - Wrapper for chunk-review-job.js
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

exec bun run "$SCRIPT_DIR/chunk-review-job.ts" "$@"

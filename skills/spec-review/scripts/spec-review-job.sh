#!/bin/bash
#
# spec-review-job.sh - Wrapper for spec-review-job.js
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

exec bun run "$SCRIPT_DIR/spec-review-job.ts" "$@"

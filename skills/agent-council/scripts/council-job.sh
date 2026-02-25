#!/bin/bash
#
# council-job.sh - Wrapper for council-job.js
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

exec bun run "$SCRIPT_DIR/council-job.ts" "$@"

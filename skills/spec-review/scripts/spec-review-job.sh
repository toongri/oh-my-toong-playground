#!/bin/bash
#
# spec-review-job.sh - Wrapper for spec-review-job.js
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JOB_JS="$SCRIPT_DIR/spec-review-job.js"

exec node "$JOB_JS" "$@"

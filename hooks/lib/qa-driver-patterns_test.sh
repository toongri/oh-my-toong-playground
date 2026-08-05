#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=hooks/lib/qa-driver-patterns.sh
source "$SCRIPT_DIR/qa-driver-patterns.sh"

if qa_driver_command_is_e2e 'printf %s agent-device'; then
    echo "ASSERTION FAILED: argument token was classified as a driver invocation"
    exit 1
fi

for command in \
    'agent-device --version' \
    'agent-browser open https://example.test' \
    'curl https://example.test' \
    'bash --version'; do
    if ! qa_driver_command_is_e2e "$command"; then
        echo "ASSERTION FAILED: declared driver was not classified: $command"
        exit 1
    fi
done

echo "qa-driver-patterns: pass"

#!/bin/bash

# PreToolUse Hook: TaskOutput Gate
# Blocks TaskOutput tool calls, allows everything else

set -euo pipefail

# Read JSON input from stdin
input=$(cat)

# Simple JSON extraction using grep/sed (avoids jq dependency)
extract_json_field() {
    local field=$1
    local default=${2:-""}
    echo "$input" | grep -o "\"$field\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | sed 's/.*"\([^"]*\)".*/\1/' || echo "$default"
}

toolName=$(extract_json_field "tool_name" "")
if [[ -z "$toolName" ]]; then
    toolName=$(extract_json_field "toolName" "unknown")
fi

# Block TaskOutput immediately (wastes context with full JSONL logs)
if [[ "$toolName" == "TaskOutput" ]]; then
    cat <<EOF
{"continue": false, "reason": "TaskOutput은 에이전트의 전체 JSONL 로그를 반환하여 컨텍스트를 낭비합니다. 포그라운드 병렬 Task를 사용하세요. 백그라운드 태스크 상태 확인이 필요하면 Read로 output_file 경로를 읽으세요."}
EOF
    exit 0
fi

# Allow all other tools
echo '{"continue": true}'
exit 0

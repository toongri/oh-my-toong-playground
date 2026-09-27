#!/bin/bash
# =============================================================================
# sync-schema-validator hook
# sync.yaml 수정 시 스키마 검증 (PostToolUse). 실패하면 decision:block 으로
# 검증기 출력을 모델에 전달한다. bun·jq 가 없으면 검증을 건너뛴다.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

input=$(cat)
command -v jq &>/dev/null || exit 0
command -v bun &>/dev/null || exit 0

file_path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // ""' 2>/dev/null) || file_path=""

# sync.yaml 파일이 아니면 패스
[[ "$file_path" == *"sync.yaml" ]] || exit 0

if [[ -f "$file_path" ]]; then
    output=$(bun run "$ROOT_DIR/tools/validators/schema.ts" "$file_path" 2>&1) && exit 0
else
    output=$(bun run "$ROOT_DIR/tools/validators/schema.ts" 2>&1) && exit 0
fi

# 검증기의 터미널 색상 코드는 모델에 전달할 사유에서 뺀다.
output=$(printf '%s' "$output" | sed $'s/\033\\[[0-9;]*m//g')

jq -n --arg reason "sync.yaml schema validation failed: $file_path
$output
Fix the errors above and write the file again." '{decision: "block", reason: $reason}'

#!/bin/bash
# =============================================================================
# sync-component-validator hook
# 세션 종료 시 컴포넌트 존재 검증 (Stop). 실패하면 decision:block 으로
# 검증기 출력을 모델에 전달한다. 같은 Stop 체인에서 이미 한 번 막았으면
# (stop_hook_active) 다시 막지 않는다. bun·jq 가 없으면 검증을 건너뛴다.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

input=$(cat)
command -v jq &>/dev/null || exit 0
command -v bun &>/dev/null || exit 0

stop_hook_active=$(printf '%s' "$input" | jq -r '.stop_hook_active == true' 2>/dev/null) || stop_hook_active=false
[ "$stop_hook_active" = "true" ] && exit 0

output=$(bun run "$ROOT_DIR/tools/validators/components.ts" 2>&1) && exit 0

# 검증기의 터미널 색상 코드는 모델에 전달할 사유에서 뺀다.
output=$(printf '%s' "$output" | sed $'s/\033\\[[0-9;]*m//g')

jq -n --arg reason "Component validation failed:
$output
Fix the missing or invalid components above before stopping." '{decision: "block", reason: $reason}'

#!/bin/bash
# =============================================================================
# sync-component-validator hook
# 세션 종료 시 컴포넌트 존재 검증 (Stop)
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# 컴포넌트 검증 실행
if command -v bun &>/dev/null; then
    bun run "$ROOT_DIR/tools/validators/components.ts" 2>&1 || true
fi

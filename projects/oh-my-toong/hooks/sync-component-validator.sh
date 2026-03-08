#!/bin/bash
# =============================================================================
# sync-component-validator hook
# 세션 종료 시 컴포넌트 존재 검증 (Stop)
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# 컴포넌트 검증 실행
if [[ -f "$ROOT_DIR/tools/validate-components.sh" ]]; then
    "$ROOT_DIR/tools/validate-components.sh" --quiet 2>&1 || true
fi

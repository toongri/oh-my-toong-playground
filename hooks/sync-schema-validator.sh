#!/bin/bash
# =============================================================================
# sync-schema-validator hook
# sync.yaml 수정 시 스키마 검증 (PostToolUse)
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# stdin 읽기 (hook input)
input=$(cat)

# 수정된 파일 경로 추출
file_path=$(echo "$input" | jq -r '.tool_input.file_path // ""' 2>/dev/null || echo "")

# sync.yaml 파일이 아니면 패스
if [[ -n "$file_path" && "$file_path" != *"sync.yaml" ]]; then
    echo "$input"
    exit 0
fi

# 스키마 검증 실행
if [[ -f "$ROOT_DIR/scripts/validate-schema.sh" ]]; then
    if [[ -n "$file_path" && -f "$file_path" ]]; then
        # 특정 파일만 검증
        "$ROOT_DIR/scripts/validate-schema.sh" "$file_path" 2>&1 || true
    else
        # 전체 검증
        "$ROOT_DIR/scripts/validate-schema.sh" 2>&1 || true
    fi
fi

# 원본 input 반환
echo "$input"

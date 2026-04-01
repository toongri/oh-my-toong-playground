#!/bin/bash
# =============================================================================
# Kotlin 잔재 검출 스크립트
# projects/toong-java-spring-template/skills/ 하위 Markdown 파일의 코드 블록 내에서
# Kotlin 문법 잔재를 검출한다.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
TARGET_DIR="${ROOT_DIR}/projects/toong-java-spring-template/skills"

# 검출 패턴 목록 (ERE 정규식)
# var 는 Java 21에서도 사용하므로 `var \w+:` (Kotlin 타입 선언) 패턴으로 한정
PATTERNS=(
    '```kotlin'
    '\bfun '
    '\bval '
    '\bdata class\b'
    '\bcompanion object\b'
    '\.kt\b'
    '\bvar [a-zA-Z_][a-zA-Z0-9_]*:'
)

FOUND=0

# 코드 블록 내에서만 패턴을 검색하는 함수
# 입력: 파일 경로
# 출력: "파일:줄번호: 매칭된 줄" 형식으로 stdout에 출력
check_file() {
    local file="$1"
    local in_block=0
    local line_num=0

    while IFS= read -r line; do
        line_num=$((line_num + 1))

        # 코드 펜스 토글 (``` 로 시작하는 줄)
        if echo "$line" | grep -qE '^\s*```'; then
            if [[ "$in_block" -eq 0 ]]; then
                in_block=1
                # ```kotlin 자체도 검출 대상이므로 블록 진입 전에 패턴 검사
                for pattern in "${PATTERNS[@]}"; do
                    if echo "$line" | grep -qE "$pattern"; then
                        echo "${file}:${line_num}: ${line}"
                        FOUND=1
                        break
                    fi
                done
            else
                in_block=0
            fi
            continue
        fi

        # 코드 블록 내부에서만 패턴 검사
        if [[ "$in_block" -eq 1 ]]; then
            for pattern in "${PATTERNS[@]}"; do
                if echo "$line" | grep -qE "$pattern"; then
                    echo "${file}:${line_num}: ${line}"
                    FOUND=1
                    break
                fi
            done
        fi
    done < "$file"
}

main() {
    if [[ ! -d "$TARGET_DIR" ]]; then
        echo "ERROR: 대상 디렉토리가 없습니다: ${TARGET_DIR}" >&2
        exit 1
    fi

    local md_files
    md_files=$(find "$TARGET_DIR" -name "*.md" -type f | sort)

    if [[ -z "$md_files" ]]; then
        echo "검사할 Markdown 파일이 없습니다: ${TARGET_DIR}"
        exit 0
    fi

    while IFS= read -r file; do
        [[ -z "$file" ]] && continue
        check_file "$file"
    done <<< "$md_files"

    if [[ "$FOUND" -eq 1 ]]; then
        echo ""
        echo "ERROR: Kotlin 잔재가 발견되었습니다. 위 위치를 확인하세요." >&2
        exit 1
    else
        echo "OK: Kotlin 잔재 없음 (${TARGET_DIR})"
        exit 0
    fi
}

main "$@"

#!/bin/bash
set -euo pipefail

# =============================================================================
# 테스트 러너
# Shell 테스트 (*_test.sh, test_*.sh) + TypeScript 테스트 (bun test) 실행
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# 색상
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SHELL_PASS=0
SHELL_FAIL=0
SHELL_TOTAL=0
TS_PASS=0
TS_FAIL=0
TS_TOTAL=0

log_info() {
    echo -e "${BLUE}[TEST]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[TEST]${NC} $1"
}

log_fail() {
    echo -e "${RED}[TEST]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[TEST]${NC} $1"
}

# =============================================================================
# Shell 테스트
# =============================================================================

run_shell_tests() {
    log_info "Shell 테스트 검색 중..."

    local test_files
    test_files=$(find "$ROOT_DIR" \
        -path "*/node_modules" -prune -o \
        -path "*/.sync-backup" -prune -o \
        \( -name "*_test.sh" -o -name "test_*.sh" \) \
        -type f -print | sort)

    if [[ -z "$test_files" ]]; then
        log_warn "Shell 테스트 파일 없음"
        return 0
    fi

    while IFS= read -r test_file; do
        [[ -z "$test_file" ]] && continue
        ((SHELL_TOTAL++)) || true

        local rel_path="${test_file#"$ROOT_DIR"/}"
        log_info "실행: $rel_path"

        local output
        if output=$(bash "$test_file" 2>&1); then
            ((SHELL_PASS++)) || true
            log_success "  통과: $rel_path"
        else
            ((SHELL_FAIL++)) || true
            log_fail "  실패: $rel_path"
            # 실패 시 출력 마지막 20줄 표시
            echo "$output" | tail -20 | while IFS= read -r line; do
                echo -e "    ${RED}|${NC} $line"
            done
        fi
    done <<< "$test_files"
}

# =============================================================================
# TypeScript 테스트
# =============================================================================

run_bun_tests() {
    log_info "Bun 테스트 실행 중..."

    # Ensure bun is available
    if [[ -d "$HOME/.bun/bin" ]]; then
        export PATH="$HOME/.bun/bin:$PATH"
    fi

    if ! command -v bun &> /dev/null; then
        log_warn "bun 미설치 — TypeScript 테스트 건너뜀"
        return 0
    fi

    local output
    if output=$(cd "$ROOT_DIR" && bun test ./tools/ ./lib/ ./scripts/ ./hooks/ 2>&1); then
        TS_PASS=1
        TS_TOTAL=1
        log_success "  Bun 테스트 통과"
        # Show summary line from bun test output
        echo "$output" | tail -5 | while IFS= read -r line; do
            echo -e "    ${GREEN}|${NC} $line"
        done
    else
        TS_FAIL=1
        TS_TOTAL=1
        log_fail "  Bun 테스트 실패"
        echo "$output" | tail -20 | while IFS= read -r line; do
            echo -e "    ${RED}|${NC} $line"
        done
    fi
}

# =============================================================================
# 메인
# =============================================================================

main() {
    log_info "테스트 실행 시작"
    echo ""

    run_shell_tests
    echo ""
    run_bun_tests
    echo ""

    # 결과 요약
    echo "=========================================="
    log_info "테스트 결과 요약"
    echo "=========================================="
    echo -e "  Shell: ${SHELL_PASS}/${SHELL_TOTAL} 통과, ${SHELL_FAIL} 실패"
    echo -e "  TypeScript: ${TS_PASS}/${TS_TOTAL} 통과, ${TS_FAIL} 실패"
    echo "=========================================="

    if [[ $SHELL_FAIL -gt 0 || $TS_FAIL -gt 0 ]]; then
        log_fail "테스트 실패: Shell ${SHELL_FAIL}개, TypeScript ${TS_FAIL}개"
        exit 1
    else
        log_success "모든 테스트 통과"
        exit 0
    fi
}

main "$@"

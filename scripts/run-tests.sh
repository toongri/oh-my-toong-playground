#!/bin/bash
set -euo pipefail

# =============================================================================
# 테스트 러너
# Shell 테스트 (*_test.sh, test_*.sh) + TypeScript 테스트 (npm test) 실행
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
        -path "*/.omt" -prune -o \
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

run_ts_tests() {
    log_info "TypeScript 테스트 검색 중..."

    if ! command -v node &> /dev/null; then
        log_warn "node 미설치 — TypeScript 테스트 건너뜀"
        return 0
    fi

    local package_files
    package_files=$(find "$ROOT_DIR/scripts" -maxdepth 2 -name "package.json" -not -path "*/node_modules/*" | sort)

    if [[ -z "$package_files" ]]; then
        log_warn "TypeScript 테스트 프로젝트 없음"
        return 0
    fi

    while IFS= read -r pkg_file; do
        [[ -z "$pkg_file" ]] && continue

        # test 스크립트 존재 여부 확인
        if ! jq -e '.scripts.test' "$pkg_file" > /dev/null 2>&1; then
            continue
        fi

        ((TS_TOTAL++)) || true

        local pkg_dir
        pkg_dir=$(dirname "$pkg_file")
        local rel_path="${pkg_dir#"$ROOT_DIR"/}"
        log_info "실행: $rel_path (npm test)"

        # node_modules 없으면 install
        if [[ ! -d "$pkg_dir/node_modules" ]]; then
            log_info "  npm install 실행 중..."
            if ! (cd "$pkg_dir" && npm install --silent 2>&1); then
                ((TS_FAIL++)) || true
                log_fail "  npm install 실패: $rel_path"
                continue
            fi
        fi

        local output
        if output=$(cd "$pkg_dir" && npm test 2>&1); then
            ((TS_PASS++)) || true
            log_success "  통과: $rel_path"
        else
            ((TS_FAIL++)) || true
            log_fail "  실패: $rel_path"
            echo "$output" | tail -20 | while IFS= read -r line; do
                echo -e "    ${RED}|${NC} $line"
            done
        fi
    done <<< "$package_files"
}

# =============================================================================
# 메인
# =============================================================================

main() {
    log_info "테스트 실행 시작"
    echo ""

    run_shell_tests
    echo ""
    run_ts_tests
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

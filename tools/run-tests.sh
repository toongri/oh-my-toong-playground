#!/bin/bash
set -euo pipefail

# =============================================================================
# 테스트 러너
# Shell 테스트 (*_test.sh, test_*.sh) + TypeScript 테스트 (bun test) 실행
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Git exports repository-local variables while running hooks (for example,
# GIT_DIR). Keep those variables out of tests so they resolve their own repo
# context rather than inheriting the hook's repository context.
GIT_LOCAL_ENV_VARS="$(git rev-parse --local-env-vars 2>/dev/null || true)"

run_without_git_local_env() {
    local var
    while IFS= read -r var; do
        [[ -z "$var" ]] && continue
        unset "$var"
    done <<< "$GIT_LOCAL_ENV_VARS"
    "$@"
}

# 색상
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Complete, untruncated transcript of this run. Everything stdout shows is
# abridged -- per-test output is echoed as `tail -20` so one noisy test cannot
# bury the rest -- and stdout itself is routinely kept only as a tail (a
# truncated CI log, a backgrounded run captured with `tail`, terminal
# scrollback). Both together lose the very thing a failure needs: which test,
# and its output. This file is the unabridged copy that survives both, and its
# path is printed in the summary on every run, pass or fail. Override with
# OMT_TEST_LOG to place it somewhere a CI job can archive.
# TMPDIR usually carries a trailing slash on macOS; strip it so the printed
# path is copy-pasteable rather than containing a doubled separator.
RUN_LOG="${OMT_TEST_LOG:-${TMPDIR:-/tmp}}"
RUN_LOG="${RUN_LOG%/}"
[[ -n "${OMT_TEST_LOG:-}" ]] || RUN_LOG="$RUN_LOG/omt-run-tests.log"
: > "$RUN_LOG"

# Appends a titled block to the run log. Never writes to stdout.
log_block() {
    {
        echo "===== $1"
        cat
        echo ""
    } >> "$RUN_LOG"
}

SHELL_PASS=0
SHELL_FAIL=0
SHELL_TOTAL=0
# Newline-delimited list of failing shell tests, replayed in the final
# summary. The per-test `실패:` line is emitted mid-run and is lost whenever
# a caller keeps only the tail of this script's output (a truncated CI log,
# a backgrounded run captured with `tail`); the summary block is what always
# survives, so the names have to appear there too. Bash 3.2: a plain
# newline-delimited string, no arrays.
SHELL_FAILED_NAMES=""
TS_PASS=0
TS_FAIL=0
TS_TOTAL=0
# Same reason as SHELL_FAILED_NAMES: bun prints one `(fail) <suite> > <test>`
# line per failure somewhere in its output, and this script only echoes the
# last 20 lines of that output -- a failure whose name scrolled past that
# window is invisible, leaving a caller with a count and nothing to run.
TS_FAILED_NAMES=""

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
        if output=$(run_without_git_local_env bash "$test_file" 2>&1); then
            ((SHELL_PASS++)) || true
            printf '%s\n' "$output" | log_block "PASS $rel_path"
            log_success "  통과: $rel_path"
        else
            ((SHELL_FAIL++)) || true
            SHELL_FAILED_NAMES="${SHELL_FAILED_NAMES}${rel_path}
"
            printf '%s\n' "$output" | log_block "FAIL $rel_path"
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
    if output=$(cd "$ROOT_DIR" && run_without_git_local_env bun test ./tools/ ./lib/ ./scripts/ ./hooks/ ./skills/ ./projects/ 2>&1); then
        TS_PASS=1
        TS_TOTAL=1
        printf '%s\n' "$output" | log_block "PASS bun test"
        log_success "  Bun 테스트 통과"
        # Show summary line from bun test output
        echo "$output" | tail -5 | while IFS= read -r line; do
            echo -e "    ${GREEN}|${NC} $line"
        done
    else
        TS_FAIL=1
        TS_TOTAL=1
        log_fail "  Bun 테스트 실패"
        printf '%s\n' "$output" | log_block "FAIL bun test"
        # Harvest every failure name before the tail window throws them away.
        TS_FAILED_NAMES=$(echo "$output" | grep '^(fail)' || true)
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
    if [[ -n "$SHELL_FAILED_NAMES" ]]; then
        printf '%s' "$SHELL_FAILED_NAMES" | while IFS= read -r failed_name; do
            [[ -z "$failed_name" ]] && continue
            echo -e "    ${RED}실패${NC}: $failed_name"
        done
    fi
    echo -e "  TypeScript: ${TS_PASS}/${TS_TOTAL} 통과, ${TS_FAIL} 실패"
    if [[ -n "$TS_FAILED_NAMES" ]]; then
        printf '%s\n' "$TS_FAILED_NAMES" | while IFS= read -r failed_name; do
            [[ -z "$failed_name" ]] && continue
            echo -e "    ${RED}실패${NC}: ${failed_name#(fail) }"
        done
    fi
    echo -e "  전체 로그(미축약): $RUN_LOG"
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

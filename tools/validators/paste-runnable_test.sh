#!/usr/bin/env bash
# =============================================================================
# Paste-Runnable Verification Examples Validator
#
# Runs in strict mode: exits 1 if any Verification: example contains an
# unsubstituted {placeholder} token. This blocks CI on regressions.
#
# Rollback: if a temporary regression must be tolerated, set MODE='warn'
# below. In warn mode the scanner prints findings but exits 0. Restore
# MODE='strict' once the regression is fixed.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Strict mode: exits 1 on any finding. Set to 'warn' to tolerate temporary regressions.
MODE='strict'

# Colors
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m'

TESTS_PASSED=0
TESTS_FAILED=0

# =============================================================================
# Detection logic
#
# A line triggers a finding when:
#   1. It contains "Verification:" (with colon) as a label marker.
#   2. Within that line, there exists a token of the form {name} where:
#      - name matches [A-Za-z_][A-Za-z0-9_-]*
#      - the character immediately before '{' is NOT '$' and NOT '%'
#        (so ${var} shell substitution and %{format} curl specifiers are exempt)
#   3. The braces contain only a valid identifier — no quotes, colons, or
#      spaces inside — so JSON literals like {"key":"value"} do not trigger.
#
# Detection is implemented as two-pass grep:
#   Pass 1: grep lines containing "Verification:" label
#   Pass 2: grep for the unsubstituted placeholder pattern
# =============================================================================

# has_unsubstituted_placeholder <line>
# Returns 0 (true) if line contains a {name} token not preceded by $ or %
has_unsubstituted_placeholder() {
    local line="$1"
    # Pattern: a { preceded by something other than $ or %, followed by a valid
    # identifier, then }. We match [^$%]\{ident\} OR ^{ident} (line-start).
    # Using grep -E in two alternatives joined by |.
    echo "$line" | grep -qE '(^|[^$%])\{[A-Za-z_][A-Za-z0-9_-]*\}'
}

# is_verification_line <line>
# Returns 0 if the line contains a Verification: label (with or without ** markdown bold)
is_verification_line() {
    local line="$1"
    echo "$line" | grep -qE '\*?\*?Verification\*?\*?:'
}

# scan_file <filepath>
# Prints WARN lines to stderr. Returns number of findings.
scan_file() {
    local filepath="$1"
    local findings=0
    local lineno=0
    while IFS= read -r line || [[ -n "$line" ]]; do
        lineno=$((lineno + 1))
        if is_verification_line "$line" && has_unsubstituted_placeholder "$line"; then
            findings=$((findings + 1))
            printf 'WARN: %s:%d: %s\n' "$filepath" "$lineno" "$line" >&2
        fi
    done < "$filepath"
    echo "$findings"
}

# =============================================================================
# Self-tests (Red-Green-Refactor)
#
# Run against in-memory fixtures before scanning live files, so we know the
# detector logic is correct regardless of whether live files change.
# =============================================================================

run_test() {
    local test_name="$1"
    if "$test_name"; then
        echo "[PASS] $test_name"
        ((TESTS_PASSED++)) || true
    else
        echo "[FAIL] $test_name"
        ((TESTS_FAILED++)) || true
    fi
}

# RED → GREEN: positive case — bare {id} in a Verification: line must trigger
test_detects_bare_placeholder_in_verification_line() {
    local fixture='      **Verification**: `curl http://localhost:8080/api/users/{id} | jq -e .`'
    if ! is_verification_line "$fixture"; then
        echo "ASSERTION FAILED: fixture should be recognised as a Verification line"
        return 1
    fi
    if ! has_unsubstituted_placeholder "$fixture"; then
        echo "ASSERTION FAILED: {id} in fixture should be flagged as unsubstituted"
        return 1
    fi
    return 0
}

# GREEN: negative case — shell ${var} must NOT trigger
test_does_not_flag_shell_dollar_var() {
    local fixture='      Verification: id=$(get_id) && curl http://host/users/${id} | jq -e .email'
    if ! is_verification_line "$fixture"; then
        echo "ASSERTION FAILED: fixture should be recognised as a Verification line"
        return 1
    fi
    if has_unsubstituted_placeholder "$fixture"; then
        echo "ASSERTION FAILED: \${id} shell form should NOT be flagged"
        return 1
    fi
    return 0
}

# GREEN: negative case — JSON literal {"key":"value"} must NOT trigger
test_does_not_flag_json_object_literal() {
    local fixture='      **Verification**: `curl -X POST http://host/api -d '"'"'{"email":"test@example.com"}'"'"'`'
    if ! is_verification_line "$fixture"; then
        echo "ASSERTION FAILED: fixture should be recognised as a Verification line"
        return 1
    fi
    if has_unsubstituted_placeholder "$fixture"; then
        echo "ASSERTION FAILED: JSON {\"key\":\"value\"} should NOT be flagged"
        return 1
    fi
    return 0
}

# GREEN: negative case — curl %{http_code} format specifier must NOT trigger
test_does_not_flag_curl_percent_format() {
    local fixture='      Verification: curl -o /dev/null -w "%{http_code}" http://host/api/check'
    if ! is_verification_line "$fixture"; then
        echo "ASSERTION FAILED: fixture should be recognised as a Verification line"
        return 1
    fi
    if has_unsubstituted_placeholder "$fixture"; then
        echo "ASSERTION FAILED: %{http_code} curl format should NOT be flagged"
        return 1
    fi
    return 0
}

# GREEN: non-Verification lines with {var} must NOT trigger
test_does_not_flag_non_verification_lines() {
    local fixture='      Setup: ./scripts/db-reset.sh --token={token}'
    if is_verification_line "$fixture"; then
        echo "ASSERTION FAILED: Setup: line should NOT be recognised as a Verification line"
        return 1
    fi
    return 0
}

# GREEN: empty {} braces (no identifier inside) must NOT trigger
test_does_not_flag_empty_braces() {
    local fixture='      **Verification**: `cmd {} other`'
    if ! is_verification_line "$fixture"; then
        echo "ASSERTION FAILED: fixture should be recognised as a Verification line"
        return 1
    fi
    if has_unsubstituted_placeholder "$fixture"; then
        echo "ASSERTION FAILED: empty {} braces should NOT be flagged"
        return 1
    fi
    return 0
}

# RED → GREEN: scan_file must detect violation in last line when file has no trailing newline
test_scan_file_processes_last_line_without_trailing_newline() {
    local tmpfile
    tmpfile=$(mktemp)
    # Write two lines with NO trailing newline: last line has a violation
    printf 'first line\n      **Verification**: bad {token}' > "$tmpfile"
    local count
    count=$(scan_file "$tmpfile" 2>/dev/null)
    rm -f "$tmpfile"
    if [[ "$count" != "1" ]]; then
        echo "ASSERTION FAILED: expected 1 finding for trailing-newline-less file, got '$count'"
        return 1
    fi
    return 0
}

# RED → GREEN: scan_file must return finding count via stdout (not exit-code, which wraps at 256)
test_scan_file_returns_finding_count_via_stdout() {
    local tmpfile
    tmpfile=$(mktemp)
    # Two violation lines
    printf '      **Verification**: bad {token_one}\n      **Verification**: bad {token_two}\n' > "$tmpfile"
    local count
    count=$(scan_file "$tmpfile" 2>/dev/null)
    rm -f "$tmpfile"
    if [[ "$count" != "2" ]]; then
        echo "ASSERTION FAILED: expected 2 findings via stdout, got '$count'"
        return 1
    fi
    return 0
}

# =============================================================================
# Live file scan
# =============================================================================

run_live_scan() {
    local total_findings=0

    # Collect all skill markdown files
    local skill_files
    skill_files=$(find "$ROOT_DIR/skills" -name "*.md" -type f | sort)

    if [[ -z "$skill_files" ]]; then
        echo "WARNING: No skill markdown files found under $ROOT_DIR/skills" >&2
        return 0
    fi

    while IFS= read -r filepath; do
        [[ -z "$filepath" ]] && continue
        # scan_file returns the number of findings via stdout
        local file_findings
        file_findings=$(scan_file "$filepath")
        total_findings=$((total_findings + file_findings))
    done <<< "$skill_files"

    if [[ $total_findings -gt 0 ]]; then
        printf '\n%b[paste-runnable]%b %d unsubstituted placeholder(s) found in Verification examples.\n' \
            "$YELLOW" "$NC" "$total_findings" >&2
        if [[ "$MODE" == 'strict' ]]; then
            return 1
        fi
    fi
    return 0
}

# =============================================================================
# Main
# =============================================================================

main() {
    echo "=========================================="
    echo "Paste-Runnable Validator Tests"
    echo "=========================================="

    run_test test_detects_bare_placeholder_in_verification_line
    run_test test_does_not_flag_shell_dollar_var
    run_test test_does_not_flag_json_object_literal
    run_test test_does_not_flag_curl_percent_format
    run_test test_does_not_flag_non_verification_lines
    run_test test_does_not_flag_empty_braces
    run_test test_scan_file_processes_last_line_without_trailing_newline
    run_test test_scan_file_returns_finding_count_via_stdout

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi

    echo ""
    echo "Running live scan of skills/**/*.md ..."
    run_live_scan

    exit 0
}

main "$@"

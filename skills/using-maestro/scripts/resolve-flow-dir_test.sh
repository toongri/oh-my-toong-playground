#!/bin/bash
# =============================================================================
# resolve-flow-dir.sh Tests - get_yaml_value parsing regression tests
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$SCRIPT_DIR/resolve-flow-dir.sh"

# Test utilities
TESTS_PASSED=0
TESTS_FAILED=0

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

# =============================================================================
# Helper: build an isolated env with a real git repo + config
#
# Usage:
#   tmp_dir=$(mktemp -d)
#   project_root="$tmp_dir/myproject"
#   fake_home="$tmp_dir/home"
#   setup_project "$project_root" "$fake_home" "<yaml content>"
#
# The script is then run as:
#   (cd "$project_root" && HOME="$fake_home" MAESTRO_USING_FLOW_DIR="" bash "$SCRIPT")
# =============================================================================
setup_project() {
    local project_root="$1"
    local fake_home="$2"
    local config_yaml="$3"

    local project_name
    project_name=$(basename "$project_root")

    # Real git init so git rev-parse --show-toplevel works
    mkdir -p "$project_root"
    git -C "$project_root" init -q

    # Isolated HOME with config file
    local config_dir="$fake_home/.config/maestro/$project_name"
    mkdir -p "$config_dir"
    printf '%s\n' "$config_yaml" > "$config_dir/config.yaml"
}

# =============================================================================
# Test A: `test_inline_comment_stripped`
# Regression for Defect A: flow_dir: .maestro # team-shared
# Expected: output contains no '#' character
# =============================================================================
test_inline_comment_stripped() {
    local tmp_dir
    tmp_dir=$(mktemp -d)
    trap "rm -rf '$tmp_dir'" EXIT

    local project_root="$tmp_dir/myproject"
    local fake_home="$tmp_dir/home"

    setup_project "$project_root" "$fake_home" \
        "$(printf 'version: 1\nflow_dir: .maestro # team-shared\n')"

    local output
    output=$(
        cd "$project_root" && \
        HOME="$fake_home" \
        MAESTRO_USING_FLOW_DIR="" \
        bash "$SCRIPT" 2>/dev/null
    ) || true

    # Must NOT contain '#' anywhere in output
    if printf '%s' "$output" | grep -q '#'; then
        echo "  ASSERTION FAILED: output contains '#' (inline comment not stripped)"
        echo "  Got: '$output'"
        trap - EXIT
        rm -rf "$tmp_dir"
        return 1
    fi

    # Must NOT be empty (flow_dir was present and valid)
    if [ -z "$output" ]; then
        echo "  ASSERTION FAILED: output is empty (flow_dir should have been resolved)"
        trap - EXIT
        rm -rf "$tmp_dir"
        return 1
    fi

    trap - EXIT
    rm -rf "$tmp_dir"
    return 0
}

# =============================================================================
# Test B: `test_missing_flow_dir_key_emits_error`
# Regression for Defect B: config lacks flow_dir key
# Expected: exit code 1 AND stderr contains 'flow_dir missing or empty'
# =============================================================================
test_missing_flow_dir_key_emits_error() {
    local tmp_dir
    tmp_dir=$(mktemp -d)
    trap "rm -rf '$tmp_dir'" EXIT

    local project_root="$tmp_dir/myproject"
    local fake_home="$tmp_dir/home"

    setup_project "$project_root" "$fake_home" \
        "$(printf 'version: 1\nproject_id: foo\n# flow_dir intentionally omitted\n')"

    local stderr_output
    local exit_code=0

    # Capture stderr; allow non-zero exit
    stderr_output=$(
        cd "$project_root" && \
        HOME="$fake_home" \
        MAESTRO_USING_FLOW_DIR="" \
        bash "$SCRIPT" 2>&1 1>/dev/null
    ) || exit_code=$?

    # Must exit with code 1
    if [ "$exit_code" -ne 1 ]; then
        echo "  ASSERTION FAILED: expected exit code 1, got $exit_code"
        echo "  stderr was: '$stderr_output'"
        trap - EXIT
        rm -rf "$tmp_dir"
        return 1
    fi

    # Stderr must contain the expected error substring
    if ! printf '%s' "$stderr_output" | grep -q "flow_dir missing or empty"; then
        echo "  ASSERTION FAILED: stderr does not contain 'flow_dir missing or empty'"
        echo "  stderr was: '$stderr_output'"
        trap - EXIT
        rm -rf "$tmp_dir"
        return 1
    fi

    trap - EXIT
    rm -rf "$tmp_dir"
    return 0
}

# =============================================================================
# Main
# =============================================================================

main() {
    echo "=========================================="
    echo "resolve-flow-dir.sh Tests - get_yaml_value"
    echo "=========================================="

    run_test test_inline_comment_stripped
    run_test test_missing_flow_dir_key_emits_error

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [ "$TESTS_FAILED" -gt 0 ]; then
        exit 1
    fi
    exit 0
}

main "$@"

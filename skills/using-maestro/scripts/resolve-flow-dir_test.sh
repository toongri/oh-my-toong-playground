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
    local rc

    set +e
    ( set -e; "$test_name" )
    rc=$?
    set -e

    if [ "$rc" -eq 0 ]; then
        echo "[PASS] $test_name"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    else
        echo "[FAIL] $test_name"
        TESTS_FAILED=$((TESTS_FAILED + 1))
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
# Test C: `test_quoted_with_inline_comment_stripped`
# Regression for P2 Defect: flow_dir: ".maestro" # team-shared
# Expected: output is absolute path with NO literal quote characters
# =============================================================================
test_quoted_with_inline_comment_stripped() {
    local tmp_dir
    tmp_dir=$(mktemp -d)
    trap "rm -rf '$tmp_dir'" EXIT

    local project_root="$tmp_dir/myproject"
    local fake_home="$tmp_dir/home"

    setup_project "$project_root" "$fake_home" \
        "$(printf 'version: 1\nflow_dir: ".maestro" # team-shared\n')"

    local output
    local exit_code=0
    output=$(
        cd "$project_root" && \
        HOME="$fake_home" \
        MAESTRO_USING_FLOW_DIR="" \
        bash "$SCRIPT" 2>/dev/null
    ) || exit_code=$?

    # Must exit 0
    if [ "$exit_code" -ne 0 ]; then
        echo "  ASSERTION FAILED: expected exit code 0, got $exit_code"
        trap - EXIT
        rm -rf "$tmp_dir"
        return 1
    fi

    # Must NOT contain literal double-quote characters
    if printf '%s' "$output" | grep -q '"'; then
        echo "  ASSERTION FAILED: output contains literal '\"' (unquoting failed)"
        echo "  Got: '$output'"
        trap - EXIT
        rm -rf "$tmp_dir"
        return 1
    fi

    # Must end with /.maestro (the unquoted, comment-stripped value)
    if ! printf '%s' "$output" | grep -q '/.maestro$'; then
        echo "  ASSERTION FAILED: output does not end with '/.maestro'"
        echo "  Got: '$output'"
        trap - EXIT
        rm -rf "$tmp_dir"
        return 1
    fi

    trap - EXIT
    rm -rf "$tmp_dir"
    return 0
}

# =============================================================================
# Test D: `test_hash_in_quoted_path`
# Regression for P1-1: flow_dir: "/tmp/team#5"
# Expected: exit 0 AND output contains '/tmp/team#5' (hash preserved inside quotes)
# =============================================================================
test_hash_in_quoted_path() {
    local tmp_dir
    tmp_dir=$(mktemp -d)
    trap "rm -rf '$tmp_dir'" EXIT

    local project_root="$tmp_dir/myproject"
    local fake_home="$tmp_dir/home"

    setup_project "$project_root" "$fake_home" \
        "$(printf 'version: 1\nflow_dir: "/tmp/team#5"\n')"

    local output
    local exit_code=0
    output=$(
        cd "$project_root" && \
        HOME="$fake_home" \
        MAESTRO_USING_FLOW_DIR="" \
        bash "$SCRIPT" 2>/dev/null
    ) || exit_code=$?

    # Must exit 0
    if [ "$exit_code" -ne 0 ]; then
        echo "  ASSERTION FAILED: expected exit code 0, got $exit_code"
        echo "  Got: '$output'"
        trap - EXIT
        rm -rf "$tmp_dir"
        return 1
    fi

    # Output must contain '/tmp/team#5' (hash and following chars preserved)
    if ! printf '%s' "$output" | grep -q '/tmp/team#5'; then
        echo "  ASSERTION FAILED: output does not contain '/tmp/team#5' (hash was stripped)"
        echo "  Got: '$output'"
        trap - EXIT
        rm -rf "$tmp_dir"
        return 1
    fi

    trap - EXIT
    rm -rf "$tmp_dir"
    return 0
}

# =============================================================================
# Test E: `test_unquoted_hash_in_path_preserved`
# Regression for YAML 1.2 spec violation: flow_dir: /tmp/team#5 (unquoted, no space before #)
# Expected: exit 0 AND output contains '/tmp/team#5' (# preserved per YAML spec)
# =============================================================================
test_unquoted_hash_in_path_preserved() {
    local tmp_dir
    tmp_dir=$(mktemp -d)
    trap "rm -rf '$tmp_dir'" EXIT

    local project_root="$tmp_dir/myproject"
    local fake_home="$tmp_dir/home"

    setup_project "$project_root" "$fake_home" \
        "$(printf 'version: 1\nflow_dir: /tmp/team#5\n')"

    local output
    local exit_code=0
    output=$(
        cd "$project_root" && \
        HOME="$fake_home" \
        MAESTRO_USING_FLOW_DIR="" \
        bash "$SCRIPT" 2>/dev/null
    ) || exit_code=$?

    # Must exit 0
    if [ "$exit_code" -ne 0 ]; then
        echo "  ASSERTION FAILED: expected exit code 0, got $exit_code"
        echo "  Got: '$output'"
        trap - EXIT
        rm -rf "$tmp_dir"
        return 1
    fi

    # Output must contain '/tmp/team#5' (hash preserved, no whitespace before #)
    if ! printf '%s' "$output" | grep -q '/tmp/team#5'; then
        echo "  ASSERTION FAILED: output does not contain '/tmp/team#5' (hash was incorrectly stripped per YAML 1.2 spec violation)"
        echo "  Got: '$output'"
        trap - EXIT
        rm -rf "$tmp_dir"
        return 1
    fi

    trap - EXIT
    rm -rf "$tmp_dir"
    return 0
}

# =============================================================================
# Test F: `test_collision_detection_emits_register_required_with_collision_marker`
# Regression for P2-1: config exists for same project_id but different git_remote
# Expected: exit 2 AND stderr contains 'REGISTER_REQUIRED:<id>:<root>:COLLISION'
# =============================================================================
test_collision_detection_emits_register_required_with_collision_marker() {
    local tmp_dir
    tmp_dir=$(mktemp -d)
    trap "rm -rf '$tmp_dir'" EXIT

    local project_root="$tmp_dir/myproject"
    local fake_home="$tmp_dir/home"

    # Initialize a real git repo for the "current" project
    mkdir -p "$project_root"
    git -C "$project_root" init -q
    # Set a git remote for the current repo
    git -C "$project_root" remote add origin "https://github.com/org-current/myproject.git"

    # Create a config with the SAME project_id (basename = myproject) but DIFFERENT git_remote
    local config_dir="$fake_home/.config/maestro/myproject"
    mkdir -p "$config_dir"
    printf 'version: 1\nproject_id: myproject\ngit_remote: https://github.com/different-org/myproject.git\nproject_root: /some/other/path\nflow_dir: /tmp/somewhere\ncreated_at: 2026-01-01T00:00:00+00:00\n' \
        > "$config_dir/config.yaml"

    local stderr_output
    local exit_code=0

    # Capture stderr; allow non-zero exit
    stderr_output=$(
        cd "$project_root" && \
        HOME="$fake_home" \
        MAESTRO_USING_FLOW_DIR="" \
        bash "$SCRIPT" 2>&1 1>/dev/null
    ) || exit_code=$?

    # Must exit with code 2 (REGISTER_REQUIRED)
    if [ "$exit_code" -ne 2 ]; then
        echo "  ASSERTION FAILED: expected exit code 2 (REGISTER_REQUIRED on collision), got $exit_code"
        echo "  stderr was: '$stderr_output'"
        trap - EXIT
        rm -rf "$tmp_dir"
        return 1
    fi

    # Stderr must contain REGISTER_REQUIRED:<id>:<root>:COLLISION marker
    if ! printf '%s' "$stderr_output" | grep -qE 'REGISTER_REQUIRED:myproject:.*:COLLISION'; then
        echo "  ASSERTION FAILED: stderr does not contain 'REGISTER_REQUIRED:myproject:<root>:COLLISION'"
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
# Test G: `test_invalid_slug_exits_2_with_invalid_slug_marker`
# Fix A (P2-6): project_id with unsupported characters must route to REGISTER_REQUIRED
# Expected: exit 2 AND stderr contains 'REGISTER_REQUIRED:' and ':INVALID_SLUG'
# =============================================================================
test_invalid_slug_exits_2_with_invalid_slug_marker() {
    local tmp_dir
    tmp_dir=$(mktemp -d)
    trap "rm -rf '$tmp_dir'" EXIT

    # Use a directory whose basename contains a space — this forces
    # project_id derivation (no git remote) to produce an invalid slug.
    local project_root="$tmp_dir/my project"
    local fake_home="$tmp_dir/home"

    mkdir -p "$project_root"
    git -C "$project_root" init -q
    # No git remote: basename = "my project" (space is invalid character)

    local stderr_output
    local exit_code=0

    stderr_output=$(
        cd "$project_root" && \
        HOME="$fake_home" \
        MAESTRO_USING_FLOW_DIR="" \
        bash "$SCRIPT" 2>&1 1>/dev/null
    ) || exit_code=$?

    # Must exit with code 2 (routes to REGISTER_REQUIRED, not hard error)
    if [ "$exit_code" -ne 2 ]; then
        echo "  ASSERTION FAILED: expected exit code 2 (REGISTER_REQUIRED for invalid slug), got $exit_code"
        echo "  stderr was: '$stderr_output'"
        trap - EXIT
        rm -rf "$tmp_dir"
        return 1
    fi

    # Stderr must contain REGISTER_REQUIRED: marker
    if ! printf '%s' "$stderr_output" | grep -q 'REGISTER_REQUIRED:'; then
        echo "  ASSERTION FAILED: stderr does not contain 'REGISTER_REQUIRED:'"
        echo "  stderr was: '$stderr_output'"
        trap - EXIT
        rm -rf "$tmp_dir"
        return 1
    fi

    # Stderr must contain :INVALID_SLUG marker
    if ! printf '%s' "$stderr_output" | grep -q ':INVALID_SLUG'; then
        echo "  ASSERTION FAILED: stderr does not contain ':INVALID_SLUG'"
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
# Test H: `test_project_root_fallback_collision_emits_register_required`
# Recommendation (Fix C): collision detection via project_root when config has no git_remote
# Expected: exit 2 AND stderr contains 'REGISTER_REQUIRED:' and ':COLLISION'
# =============================================================================
test_project_root_fallback_collision_emits_register_required() {
    local tmp_dir
    tmp_dir=$(mktemp -d)
    trap "rm -rf '$tmp_dir'" EXIT

    local project_root="$tmp_dir/myproject"
    local fake_home="$tmp_dir/home"

    # Real git repo, no remote — so project_id = "myproject" (basename)
    mkdir -p "$project_root"
    git -C "$project_root" init -q

    # Config has project_root pointing to a DIFFERENT absolute path (no git_remote key)
    local config_dir="$fake_home/.config/maestro/myproject"
    mkdir -p "$config_dir"
    printf 'version: 1\nproject_id: myproject\nproject_root: /some/completely/different/path\nflow_dir: /tmp/somewhere\ncreated_at: 2026-01-01T00:00:00+00:00\n' \
        > "$config_dir/config.yaml"

    local stderr_output
    local exit_code=0

    stderr_output=$(
        cd "$project_root" && \
        HOME="$fake_home" \
        MAESTRO_USING_FLOW_DIR="" \
        bash "$SCRIPT" 2>&1 1>/dev/null
    ) || exit_code=$?

    # Must exit with code 2 (REGISTER_REQUIRED on collision)
    if [ "$exit_code" -ne 2 ]; then
        echo "  ASSERTION FAILED: expected exit code 2 (REGISTER_REQUIRED on project_root collision), got $exit_code"
        echo "  stderr was: '$stderr_output'"
        trap - EXIT
        rm -rf "$tmp_dir"
        return 1
    fi

    # Stderr must contain REGISTER_REQUIRED: marker
    if ! printf '%s' "$stderr_output" | grep -q 'REGISTER_REQUIRED:'; then
        echo "  ASSERTION FAILED: stderr does not contain 'REGISTER_REQUIRED:'"
        echo "  stderr was: '$stderr_output'"
        trap - EXIT
        rm -rf "$tmp_dir"
        return 1
    fi

    # Stderr must contain :COLLISION marker
    if ! printf '%s' "$stderr_output" | grep -q ':COLLISION'; then
        echo "  ASSERTION FAILED: stderr does not contain ':COLLISION'"
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
# Test I: `test_unterminated_double_quote_exits_1`
# Regression for P1: flow_dir: "broken  (no closing double-quote)
# Expected: exit code 1 AND stderr contains 'ERROR' or 'unterminated'
# =============================================================================
test_unterminated_double_quote_exits_1() {
    local tmp_dir
    tmp_dir=$(mktemp -d)
    trap "rm -rf '$tmp_dir'" EXIT

    local project_root="$tmp_dir/myproject"
    local fake_home="$tmp_dir/home"

    setup_project "$project_root" "$fake_home" \
        "$(printf 'version: 1\nflow_dir: "broken\n')"

    local stderr_output
    local exit_code=0

    stderr_output=$(
        cd "$project_root" && \
        HOME="$fake_home" \
        MAESTRO_USING_FLOW_DIR="" \
        bash "$SCRIPT" 2>&1 1>/dev/null
    ) || exit_code=$?

    # Must exit with code 1 (parse failure / hard error)
    if [ "$exit_code" -ne 1 ]; then
        echo "  ASSERTION FAILED: expected exit code 1 (parse failure), got $exit_code"
        echo "  stderr was: '$stderr_output'"
        trap - EXIT
        rm -rf "$tmp_dir"
        return 1
    fi

    # Stderr must contain 'ERROR' or 'unterminated'
    if ! printf '%s' "$stderr_output" | grep -qiE 'ERROR|unterminated'; then
        echo "  ASSERTION FAILED: stderr does not contain 'ERROR' or 'unterminated'"
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
# Test J: `test_unterminated_single_quote_exits_1`
# Regression for P1: flow_dir: 'broken  (no closing single-quote)
# Expected: exit code 1 AND stderr contains 'ERROR' or 'unterminated'
# =============================================================================
test_unterminated_single_quote_exits_1() {
    local tmp_dir
    tmp_dir=$(mktemp -d)
    trap "rm -rf '$tmp_dir'" EXIT

    local project_root="$tmp_dir/myproject"
    local fake_home="$tmp_dir/home"

    setup_project "$project_root" "$fake_home" \
        "$(printf 'version: 1\nflow_dir: '"'"'broken\n')"

    local stderr_output
    local exit_code=0

    stderr_output=$(
        cd "$project_root" && \
        HOME="$fake_home" \
        MAESTRO_USING_FLOW_DIR="" \
        bash "$SCRIPT" 2>&1 1>/dev/null
    ) || exit_code=$?

    # Must exit with code 1 (parse failure / hard error)
    if [ "$exit_code" -ne 1 ]; then
        echo "  ASSERTION FAILED: expected exit code 1 (parse failure), got $exit_code"
        echo "  stderr was: '$stderr_output'"
        trap - EXIT
        rm -rf "$tmp_dir"
        return 1
    fi

    # Stderr must contain 'ERROR' or 'unterminated'
    if ! printf '%s' "$stderr_output" | grep -qiE 'ERROR|unterminated'; then
        echo "  ASSERTION FAILED: stderr does not contain 'ERROR' or 'unterminated'"
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
    run_test test_quoted_with_inline_comment_stripped
    run_test test_hash_in_quoted_path
    run_test test_unquoted_hash_in_path_preserved
    run_test test_collision_detection_emits_register_required_with_collision_marker
    run_test test_invalid_slug_exits_2_with_invalid_slug_marker
    run_test test_project_root_fallback_collision_emits_register_required
    run_test test_unterminated_double_quote_exits_1
    run_test test_unterminated_single_quote_exits_1

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [ "$TESTS_FAILED" -gt 0 ]; then
        exit 1
    fi
    exit 0
}

main "$@"

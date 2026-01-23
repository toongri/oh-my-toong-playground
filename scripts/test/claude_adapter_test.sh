#!/bin/bash
# =============================================================================
# Claude Adapter Tests
# Tests for claude.sh adapter functions
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Source the adapter
source "$ROOT_DIR/adapters/claude.sh"

# Test utilities
TESTS_PASSED=0
TESTS_FAILED=0
CURRENT_TEST=""

setup_test_env() {
    TEST_TMP_DIR=$(mktemp -d)
    mkdir -p "$TEST_TMP_DIR/.claude"
}

teardown_test_env() {
    if [[ -d "$TEST_TMP_DIR" ]]; then
        rm -rf "$TEST_TMP_DIR"
    fi
}

assert_equals() {
    local expected="$1"
    local actual="$2"
    local msg="${3:-}"

    if [[ "$expected" == "$actual" ]]; then
        return 0
    else
        echo "ASSERTION FAILED: $msg"
        echo "  Expected: '$expected'"
        echo "  Actual:   '$actual'"
        return 1
    fi
}

assert_json_equals() {
    local expected="$1"
    local actual="$2"
    local msg="${3:-}"

    # Normalize JSON for comparison
    local normalized_expected=$(echo "$expected" | jq -S '.')
    local normalized_actual=$(echo "$actual" | jq -S '.')

    if [[ "$normalized_expected" == "$normalized_actual" ]]; then
        return 0
    else
        echo "ASSERTION FAILED: $msg"
        echo "  Expected: $normalized_expected"
        echo "  Actual:   $normalized_actual"
        return 1
    fi
}

run_test() {
    local test_name="$1"
    CURRENT_TEST="$test_name"

    setup_test_env

    if "$test_name"; then
        echo "[PASS] $test_name"
        ((TESTS_PASSED++)) || true
    else
        echo "[FAIL] $test_name"
        ((TESTS_FAILED++)) || true
    fi

    teardown_test_env
}

print_summary() {
    echo ""
    echo "=========================================="
    echo "Test Summary"
    echo "=========================================="
    echo "Passed: $TESTS_PASSED"
    echo "Failed: $TESTS_FAILED"
    echo ""

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
}

# =============================================================================
# Tests for claude_update_settings
# =============================================================================

# Test: Normal merge without existing hooks wrapper
test_update_settings_normal_merge() {
    # Given: Empty settings file
    echo '{}' > "$TEST_TMP_DIR/.claude/settings.json"

    # When: Update with new hooks
    local hooks_json='{"PreToolUse": [{"matcher": "Bash", "hooks": [{"type": "command", "command": "echo test"}]}]}'
    claude_update_settings "$TEST_TMP_DIR" "$hooks_json" "false"

    # Then: Settings should have hooks at top level
    local result=$(cat "$TEST_TMP_DIR/.claude/settings.json")
    local expected='{"PreToolUse": [{"matcher": "Bash", "hooks": [{"type": "command", "command": "echo test"}]}]}'

    assert_json_equals "$expected" "$result" "Hooks should be at top level"
}

# Test: Merge when existing settings has hooks wrapper - THE BUG CASE
test_update_settings_cleans_existing_hooks_wrapper() {
    # Given: Settings file with hooks wrapper (corrupted state)
    cat > "$TEST_TMP_DIR/.claude/settings.json" << 'EOF'
{
  "hooks": {
    "PreToolUse": [{"matcher": "old", "hooks": []}]
  },
  "someOtherSetting": true
}
EOF

    # When: Update with new hooks at top level
    local hooks_json='{"PreToolUse": [{"matcher": "new", "hooks": []}]}'
    claude_update_settings "$TEST_TMP_DIR" "$hooks_json" "false"

    # Then: Result should NOT have nested hooks wrapper
    local result=$(cat "$TEST_TMP_DIR/.claude/settings.json")

    # Should have PreToolUse at top level
    local has_top_level_hooks=$(echo "$result" | jq 'has("PreToolUse")')
    assert_equals "true" "$has_top_level_hooks" "Should have PreToolUse at top level"

    # Should NOT have .hooks wrapper
    local has_hooks_wrapper=$(echo "$result" | jq 'has("hooks")')
    assert_equals "false" "$has_hooks_wrapper" "Should NOT have hooks wrapper"

    # Should preserve other settings
    local has_other_setting=$(echo "$result" | jq '.someOtherSetting')
    assert_equals "true" "$has_other_setting" "Should preserve other settings"
}

# Test: Merge preserves existing top-level settings
test_update_settings_preserves_existing_settings() {
    # Given: Settings with existing preferences
    cat > "$TEST_TMP_DIR/.claude/settings.json" << 'EOF'
{
  "existingSetting": "value",
  "anotherSetting": 123
}
EOF

    # When: Update with hooks
    local hooks_json='{"Stop": [{"matcher": "", "hooks": [{"type": "command", "command": "echo stop"}]}]}'
    claude_update_settings "$TEST_TMP_DIR" "$hooks_json" "false"

    # Then: Both hooks and existing settings should be present
    local result=$(cat "$TEST_TMP_DIR/.claude/settings.json")

    local has_stop=$(echo "$result" | jq 'has("Stop")')
    assert_equals "true" "$has_stop" "Should have Stop hook"

    local existing_value=$(echo "$result" | jq -r '.existingSetting')
    assert_equals "value" "$existing_value" "Should preserve existingSetting"

    local another_value=$(echo "$result" | jq '.anotherSetting')
    assert_equals "123" "$another_value" "Should preserve anotherSetting"
}

# Test: Dry run does not modify file
test_update_settings_dry_run() {
    # Given: Settings file
    echo '{"original": true}' > "$TEST_TMP_DIR/.claude/settings.json"

    # When: Dry run update
    local hooks_json='{"PreToolUse": []}'
    claude_update_settings "$TEST_TMP_DIR" "$hooks_json" "true"

    # Then: File should not be modified
    local result=$(cat "$TEST_TMP_DIR/.claude/settings.json")
    local expected='{"original": true}'

    assert_json_equals "$expected" "$result" "Dry run should not modify file"
}

# =============================================================================
# Run all tests
# =============================================================================

run_test test_update_settings_normal_merge
run_test test_update_settings_cleans_existing_hooks_wrapper
run_test test_update_settings_preserves_existing_settings
run_test test_update_settings_dry_run

print_summary

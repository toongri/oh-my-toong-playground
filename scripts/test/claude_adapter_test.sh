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

    # Then: Settings should have hooks nested under "hooks" key
    local result=$(cat "$TEST_TMP_DIR/.claude/settings.json")
    local expected='{"hooks": {"PreToolUse": [{"matcher": "Bash", "hooks": [{"type": "command", "command": "echo test"}]}]}}'

    assert_json_equals "$expected" "$result" "Hooks should be nested under hooks key"
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

    # Then: Result should have new hooks under .hooks key and old hooks replaced
    local result=$(cat "$TEST_TMP_DIR/.claude/settings.json")

    # Should have PreToolUse under .hooks
    local has_pre_tool_use=$(echo "$result" | jq '.hooks | has("PreToolUse")')
    assert_equals "true" "$has_pre_tool_use" "Should have PreToolUse under .hooks"

    # Should have .hooks key
    local has_hooks_key=$(echo "$result" | jq 'has("hooks")')
    assert_equals "true" "$has_hooks_key" "Should have hooks key"

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

    local has_stop=$(echo "$result" | jq '.hooks | has("Stop")')
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
# Tests for claude_supports_feature (rules)
# =============================================================================

# Test: claude_supports_feature returns 0 for "rules"
test_supports_feature_rules() {
    claude_supports_feature "rules"
    local result=$?
    assert_equals "0" "$result" "rules should be a supported feature"
}

# =============================================================================
# Tests for claude_sync_rules_direct
# =============================================================================

# Test: Copies .md file to .claude/rules/ directory
test_sync_rules_direct_copies_file() {
    # Given: A source rule file
    local source_file="$TEST_TMP_DIR/source-rule.md"
    echo "# Tool Usage Policy" > "$source_file"
    echo "Do not use Bash for file reads." >> "$source_file"

    # When: Sync rule to target
    claude_sync_rules_direct "$TEST_TMP_DIR" "tool-usage-policy" "$source_file" "false"

    # Then: File should be copied to .claude/rules/
    local target_file="$TEST_TMP_DIR/.claude/rules/tool-usage-policy.md"
    if [[ ! -f "$target_file" ]]; then
        echo "ASSERTION FAILED: Target file does not exist: $target_file"
        return 1
    fi

    local content=$(cat "$target_file")
    local expected_first_line="# Tool Usage Policy"
    local actual_first_line=$(head -1 "$target_file")
    assert_equals "$expected_first_line" "$actual_first_line" "Rule file content should match"
}

# Test: Returns gracefully when source file is missing
test_sync_rules_direct_missing_source() {
    # Given: A non-existent source file
    local source_file="$TEST_TMP_DIR/nonexistent-rule.md"

    # When: Sync rule with missing source
    claude_sync_rules_direct "$TEST_TMP_DIR" "missing-rule" "$source_file" "false"
    local result=$?

    # Then: Should return 0 (graceful handling)
    assert_equals "0" "$result" "Should return 0 for missing source file"

    # And: Target file should NOT exist
    if [[ -f "$TEST_TMP_DIR/.claude/rules/missing-rule.md" ]]; then
        echo "ASSERTION FAILED: Target file should not exist for missing source"
        return 1
    fi
}

# Test: Dry run does not create file
test_sync_rules_direct_dry_run() {
    # Given: A source rule file
    local source_file="$TEST_TMP_DIR/dry-rule.md"
    echo "# Dry Run Rule" > "$source_file"

    # When: Sync in dry run mode
    claude_sync_rules_direct "$TEST_TMP_DIR" "dry-rule" "$source_file" "true"

    # Then: Target file should NOT exist
    if [[ -f "$TEST_TMP_DIR/.claude/rules/dry-rule.md" ]]; then
        echo "ASSERTION FAILED: Dry run should not create target file"
        return 1
    fi
}

# =============================================================================
# Run all tests
# =============================================================================

run_test test_update_settings_normal_merge
run_test test_update_settings_cleans_existing_hooks_wrapper
run_test test_update_settings_preserves_existing_settings
run_test test_update_settings_dry_run
run_test test_supports_feature_rules
run_test test_sync_rules_direct_copies_file
run_test test_sync_rules_direct_missing_source
run_test test_sync_rules_direct_dry_run

print_summary

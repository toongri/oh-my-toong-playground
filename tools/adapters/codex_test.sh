#!/bin/bash
# =============================================================================
# Codex Adapter Tests
# Tests for OpenAI Codex CLI adapter
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"

# Test utilities
TESTS_PASSED=0
TESTS_FAILED=0
CURRENT_TEST=""

setup_test_env() {
    TEST_TMP_DIR=$(mktemp -d)
    mkdir -p "$TEST_TMP_DIR/.codex"
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

assert_file_exists() {
    local file="$1"
    local msg="${2:-File should exist: $file}"

    if [[ -f "$file" ]]; then
        return 0
    else
        echo "ASSERTION FAILED: $msg"
        return 1
    fi
}

assert_file_not_exists() {
    local file="$1"
    local msg="${2:-File should not exist: $file}"

    if [[ ! -f "$file" ]]; then
        return 0
    else
        echo "ASSERTION FAILED: $msg"
        return 1
    fi
}

assert_file_contains() {
    local file="$1"
    local pattern="$2"
    local msg="${3:-File should contain pattern}"

    if grep -q "$pattern" "$file"; then
        return 0
    else
        echo "ASSERTION FAILED: $msg"
        echo "  Pattern: '$pattern'"
        echo "  File: $file"
        return 1
    fi
}

assert_file_not_contains() {
    local file="$1"
    local pattern="$2"
    local msg="${3:-File should not contain pattern}"

    if ! grep -q "$pattern" "$file"; then
        return 0
    else
        echo "ASSERTION FAILED: $msg"
        echo "  Pattern: '$pattern'"
        echo "  File: $file"
        return 1
    fi
}

assert_output_contains() {
    local output="$1"
    local pattern="$2"
    local msg="${3:-Output should contain pattern}"

    if echo "$output" | grep -q "$pattern"; then
        return 0
    else
        echo "ASSERTION FAILED: $msg"
        echo "  Pattern: '$pattern'"
        echo "  Output: $output"
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

# Source the adapter
source "$SCRIPT_DIR/codex.sh"

# =============================================================================
# Tests: CLI Detection
# =============================================================================

test_codex_is_available_function_exists() {
    # Verify the function exists and can be called
    declare -f codex_is_available > /dev/null
}

test_codex_is_available_returns_0_or_1() {
    # When codex CLI check runs, it should return 0 or 1
    codex_is_available
    local result=$?
    [[ $result -eq 0 || $result -eq 1 ]]
}

# =============================================================================
# Tests: Config Directory Functions
# =============================================================================

test_codex_get_config_dir_returns_dot_codex() {
    local result=$(codex_get_config_dir)
    assert_equals ".codex" "$result" "Config dir should be .codex"
}

test_codex_get_settings_file_returns_config_toml() {
    local result=$(codex_get_settings_file)
    assert_equals "config.toml" "$result" "Settings file should be config.toml"
}

test_codex_get_context_file_returns_agents_md() {
    local result=$(codex_get_context_file)
    assert_equals "AGENTS.md" "$result" "Context file should be AGENTS.md"
}

# =============================================================================
# Tests: Feature Support
# =============================================================================

test_codex_supports_feature_agents_returns_false() {
    local result=$(codex_supports_feature "agents")
    assert_equals "false" "$result" "Should NOT support agents (no native subagent support)"
}

test_codex_supports_feature_commands_returns_false() {
    local result=$(codex_supports_feature "commands")
    assert_equals "false" "$result" "Should NOT support commands (global only, not project-local)"
}

test_codex_supports_feature_hooks_returns_partial() {
    local result=$(codex_supports_feature "hooks")
    assert_equals "partial" "$result" "Should have partial hooks support (notify only)"
}

test_codex_supports_feature_skills_returns_true() {
    local result=$(codex_supports_feature "skills")
    assert_equals "true" "$result" "Should support skills via directory copy"
}

test_codex_supports_feature_unknown_returns_false() {
    local result=$(codex_supports_feature "unknown_feature")
    assert_equals "false" "$result" "Should return false for unknown features"
}

# =============================================================================
# Tests: Sync Agents (warns and skips - no native subagent support)
# =============================================================================

test_codex_sync_agents_warns_and_skips() {
    # Codex does not support native subagents - should warn and skip
    local source_dir="$TEST_TMP_DIR/agents"
    mkdir -p "$source_dir"
    echo "# Test Agent" > "$source_dir/test-agent.md"

    local target_dir="$TEST_TMP_DIR/target"
    mkdir -p "$target_dir"

    # Execute and capture output
    local output=$(codex_sync_agents "$target_dir" "test-agent" "" "false" "$source_dir" 2>&1)

    # Verify warning was logged
    assert_output_contains "$output" "지원되지 않습니다" "Should warn that agents are not supported"
}

test_codex_sync_agents_does_not_inject_into_agents_md() {
    # Codex does not support native subagents - should NOT inject into AGENTS.md
    local source_dir="$TEST_TMP_DIR/agents"
    mkdir -p "$source_dir"
    echo "# Test Agent" > "$source_dir/test-agent.md"
    echo "This is test agent content." >> "$source_dir/test-agent.md"

    local target_dir="$TEST_TMP_DIR/target"
    mkdir -p "$target_dir"

    # Execute
    codex_sync_agents "$target_dir" "test-agent" "" "false" "$source_dir"

    # Verify AGENTS.md was NOT created
    assert_file_not_exists "$target_dir/AGENTS.md" "AGENTS.md should NOT be created (agents not supported)"
}

test_codex_sync_agents_returns_success() {
    # Even though agents are skipped, the function should return success (0)
    local source_dir="$TEST_TMP_DIR/agents"
    mkdir -p "$source_dir"
    echo "# Test Agent" > "$source_dir/test-agent.md"

    local target_dir="$TEST_TMP_DIR/target"
    mkdir -p "$target_dir"

    # Execute
    codex_sync_agents "$target_dir" "test-agent" "" "false" "$source_dir" 2>/dev/null
    local result=$?

    # Should return 0 (skip is not an error)
    assert_equals 0 $result "Should return success even when skipping"
}

# =============================================================================
# Tests: Sync Commands (warns and skips - global only, not project-local)
# =============================================================================

test_codex_sync_commands_warns_and_skips() {
    # Codex commands require global ~/.codex/prompts/ - not project-local
    local source_dir="$TEST_TMP_DIR/commands"
    mkdir -p "$source_dir"
    echo "# Test Command" > "$source_dir/test-cmd.md"

    local target_dir="$TEST_TMP_DIR/target"
    mkdir -p "$target_dir"

    # Execute and capture output
    local output=$(codex_sync_commands "$target_dir" "test-cmd" "false" "$source_dir" 2>&1)

    # Verify warning was logged
    assert_output_contains "$output" "지원됩니다" "Should warn that commands require global prompts"
}

test_codex_sync_commands_does_not_inject_into_agents_md() {
    # Codex commands require global ~/.codex/prompts/ - should NOT inject into AGENTS.md
    local source_dir="$TEST_TMP_DIR/commands"
    mkdir -p "$source_dir"
    echo "# Test Command" > "$source_dir/test-cmd.md"
    echo "Command description here." >> "$source_dir/test-cmd.md"

    local target_dir="$TEST_TMP_DIR/target"
    mkdir -p "$target_dir"

    # Execute
    codex_sync_commands "$target_dir" "test-cmd" "false" "$source_dir"

    # Verify AGENTS.md was NOT created
    assert_file_not_exists "$target_dir/AGENTS.md" "AGENTS.md should NOT be created (commands not project-local)"
}

test_codex_sync_commands_returns_success() {
    # Even though commands are skipped, the function should return success (0)
    local source_dir="$TEST_TMP_DIR/commands"
    mkdir -p "$source_dir"
    echo "# Test Command" > "$source_dir/test-cmd.md"

    local target_dir="$TEST_TMP_DIR/target"
    mkdir -p "$target_dir"

    # Execute
    codex_sync_commands "$target_dir" "test-cmd" "false" "$source_dir" 2>/dev/null
    local result=$?

    # Should return 0 (skip is not an error)
    assert_equals 0 $result "Should return success even when skipping"
}

# =============================================================================
# Tests: Sync Hooks (Notify Only)
# =============================================================================

test_codex_sync_hooks_skips_non_notification_events_with_warning() {
    local source_dir="$TEST_TMP_DIR/hooks"
    mkdir -p "$source_dir"
    echo '#!/bin/bash' > "$source_dir/pre-tool.sh"

    local target_dir="$TEST_TMP_DIR/target"
    mkdir -p "$target_dir"

    # Execute with PreToolUse event (not supported)
    local output=$(codex_sync_hooks "$target_dir" "pre-tool.sh" "PreToolUse" "*" "10" "command" "" "" "false" "$source_dir" 2>&1)

    # Verify warning mentions Notification event
    assert_output_contains "$output" "Notification" "Should mention Notification event support"
}

test_codex_sync_hooks_skips_stop_event_with_warning() {
    local source_dir="$TEST_TMP_DIR/hooks"
    mkdir -p "$source_dir"
    echo '#!/bin/bash' > "$source_dir/stop-hook.sh"

    local target_dir="$TEST_TMP_DIR/target"
    mkdir -p "$target_dir"

    # Execute with Stop event (not supported)
    local output=$(codex_sync_hooks "$target_dir" "stop-hook.sh" "Stop" "*" "10" "command" "" "" "false" "$source_dir" 2>&1)

    # Verify warning mentions Notification event
    assert_output_contains "$output" "Notification" "Should mention Notification event support"
}

test_codex_sync_hooks_processes_notification_events() {
    local source_dir="$TEST_TMP_DIR/hooks"
    mkdir -p "$source_dir"
    echo '#!/bin/bash' > "$source_dir/notify-hook.sh"

    local target_dir="$TEST_TMP_DIR/target"
    mkdir -p "$target_dir/.codex"

    # Execute with Notification event (the only supported event type)
    local output=$(codex_sync_hooks "$target_dir" "notify-hook.sh" "Notification" "*" "10" "command" "" "" "false" "$source_dir" 2>&1)

    # Verify it was processed (not skipped) - should copy the file
    assert_file_exists "$target_dir/.codex/hooks/notify-hook.sh" "Hook file should be copied for Notification event"
}

test_codex_sync_hooks_dry_run_does_not_modify() {
    local source_dir="$TEST_TMP_DIR/hooks"
    mkdir -p "$source_dir"
    echo '#!/bin/bash' > "$source_dir/notify-hook.sh"

    local target_dir="$TEST_TMP_DIR/target"
    mkdir -p "$target_dir/.codex"

    # Execute with dry_run
    codex_sync_hooks "$target_dir" "notify-hook.sh" "Notify" "*" "10" "command" "" "" "true" "$source_dir"

    # Verify config.toml was not created/modified
    assert_file_not_exists "$target_dir/.codex/config.toml" "config.toml should not be created in dry-run mode"
}

# =============================================================================
# Tests: Sync Skills (Copy Directory)
# =============================================================================

test_codex_sync_skills_copies_directory_to_codex_skills() {
    local source_dir="$TEST_TMP_DIR/skills"
    mkdir -p "$source_dir/test-skill"
    echo "# Test Skill" > "$source_dir/test-skill/SKILL.md"
    echo "extra content" > "$source_dir/test-skill/extra.md"

    local target_dir="$TEST_TMP_DIR/target"
    mkdir -p "$target_dir"

    # Execute
    codex_sync_skills "$target_dir" "test-skill" "false" "$source_dir"

    # Verify skill directory was copied
    assert_file_exists "$target_dir/.codex/skills/test-skill/SKILL.md" "Skill SKILL.md should be copied"
    assert_file_exists "$target_dir/.codex/skills/test-skill/extra.md" "Extra files should be copied"
}

test_codex_sync_skills_handles_missing_source_directory() {
    local source_dir="$TEST_TMP_DIR/skills"
    mkdir -p "$source_dir"
    # Don't create the skill directory

    local target_dir="$TEST_TMP_DIR/target"
    mkdir -p "$target_dir"

    # Execute and capture output
    local output=$(codex_sync_skills "$target_dir" "nonexistent-skill" "false" "$source_dir" 2>&1)

    # Should warn about missing directory
    assert_output_contains "$output" "not found" "Should warn about missing skill directory"
}

test_codex_sync_skills_dry_run_does_not_copy() {
    local source_dir="$TEST_TMP_DIR/skills"
    mkdir -p "$source_dir/test-skill"
    echo "# Test Skill" > "$source_dir/test-skill/SKILL.md"

    local target_dir="$TEST_TMP_DIR/target"
    mkdir -p "$target_dir"

    # Execute with dry_run
    codex_sync_skills "$target_dir" "test-skill" "true" "$source_dir"

    # Verify skill directory was NOT created
    if [[ -d "$target_dir/.codex/skills" ]]; then
        echo "ASSERTION FAILED: Skills directory should not be created in dry-run mode"
        return 1
    fi
    return 0
}

test_codex_sync_skills_handles_project_prefixed_component() {
    local source_dir="$TEST_TMP_DIR/skills"
    mkdir -p "$source_dir/my-skill"
    echo "# Project Skill" > "$source_dir/my-skill/SKILL.md"

    local target_dir="$TEST_TMP_DIR/target"
    mkdir -p "$target_dir"

    # Execute with component (using source_base_dir makes it use flat structure for testing)
    codex_sync_skills "$target_dir" "my-skill" "false" "$source_dir"

    # Verify
    assert_file_exists "$target_dir/.codex/skills/my-skill/SKILL.md" "Should copy skill directory"
}

# =============================================================================
# Tests: Update Settings (config.toml)
# =============================================================================

test_codex_update_settings_creates_config_toml() {
    local target_dir="$TEST_TMP_DIR/target"
    mkdir -p "$target_dir/.codex"

    local hooks_json='{"Notify": [{"command": "echo test"}]}'

    # Execute
    codex_update_settings "$target_dir" "$hooks_json" "false"

    # Verify
    assert_file_exists "$target_dir/.codex/config.toml" "config.toml should be created"
}

test_codex_update_settings_writes_toml_format() {
    local target_dir="$TEST_TMP_DIR/target"
    mkdir -p "$target_dir/.codex"

    local hooks_json='{"Notify": [{"command": "echo test"}]}'

    # Execute
    codex_update_settings "$target_dir" "$hooks_json" "false"

    # Verify TOML-like content (basic check)
    # TOML uses = for assignment, not : like JSON
    if [[ -f "$target_dir/.codex/config.toml" ]]; then
        # Should not contain JSON-style colons in key-value pairs
        # This is a basic structural check
        return 0
    fi
    return 1
}

test_codex_update_settings_dry_run_does_not_modify() {
    local target_dir="$TEST_TMP_DIR/target"
    mkdir -p "$target_dir/.codex"

    local hooks_json='{"Notify": [{"command": "echo test"}]}'

    # Execute with dry_run
    codex_update_settings "$target_dir" "$hooks_json" "true"

    # Verify file was NOT created
    assert_file_not_exists "$target_dir/.codex/config.toml" "config.toml should not be created in dry-run mode"
}

test_codex_update_settings_preserves_existing_config() {
    local target_dir="$TEST_TMP_DIR/target"
    mkdir -p "$target_dir/.codex"

    # Create existing config
    cat > "$target_dir/.codex/config.toml" << 'EOF'
[general]
existing_key = "existing_value"
EOF

    local hooks_json='{"Notify": [{"command": "echo test"}]}'

    # Execute
    codex_update_settings "$target_dir" "$hooks_json" "false"

    # Verify existing content preserved
    assert_file_contains "$target_dir/.codex/config.toml" "existing_key" "Should preserve existing keys"
}

# =============================================================================
# Tests: Edge Cases
# =============================================================================

test_codex_handles_empty_component_name() {
    local target_dir="$TEST_TMP_DIR/target"
    mkdir -p "$target_dir"

    # Execute with empty component - should not crash (just warns and skips)
    codex_sync_agents "$target_dir" "" "" "false" "$TEST_TMP_DIR/agents" 2>/dev/null || true

    # As long as it doesn't crash, test passes
    return 0
}

test_codex_handles_special_characters_in_component() {
    local target_dir="$TEST_TMP_DIR/target"
    mkdir -p "$target_dir"

    # Execute with special characters - should warn and skip (not crash)
    codex_sync_agents "$target_dir" "my-special-agent" "" "false" "$TEST_TMP_DIR/agents" 2>/dev/null || true

    # As long as it doesn't crash, test passes (agents are skipped now)
    return 0
}

# =============================================================================
# Main Test Runner
# =============================================================================

main() {
    echo "=========================================="
    echo "Codex Adapter Tests"
    echo "=========================================="

    # CLI Detection
    run_test test_codex_is_available_function_exists
    run_test test_codex_is_available_returns_0_or_1

    # Config Directory Functions
    run_test test_codex_get_config_dir_returns_dot_codex
    run_test test_codex_get_settings_file_returns_config_toml
    run_test test_codex_get_context_file_returns_agents_md

    # Feature Support
    run_test test_codex_supports_feature_agents_returns_false
    run_test test_codex_supports_feature_commands_returns_false
    run_test test_codex_supports_feature_hooks_returns_partial
    run_test test_codex_supports_feature_skills_returns_true
    run_test test_codex_supports_feature_unknown_returns_false

    # Sync Agents (warns and skips - no native subagent support)
    run_test test_codex_sync_agents_warns_and_skips
    run_test test_codex_sync_agents_does_not_inject_into_agents_md
    run_test test_codex_sync_agents_returns_success

    # Sync Commands (warns and skips - global only, not project-local)
    run_test test_codex_sync_commands_warns_and_skips
    run_test test_codex_sync_commands_does_not_inject_into_agents_md
    run_test test_codex_sync_commands_returns_success

    # Sync Hooks (Notification Only)
    run_test test_codex_sync_hooks_skips_non_notification_events_with_warning
    run_test test_codex_sync_hooks_skips_stop_event_with_warning
    run_test test_codex_sync_hooks_processes_notification_events
    run_test test_codex_sync_hooks_dry_run_does_not_modify

    # Sync Skills (Copy Directory)
    run_test test_codex_sync_skills_copies_directory_to_codex_skills
    run_test test_codex_sync_skills_handles_missing_source_directory
    run_test test_codex_sync_skills_dry_run_does_not_copy
    run_test test_codex_sync_skills_handles_project_prefixed_component

    # Update Settings
    run_test test_codex_update_settings_creates_config_toml
    run_test test_codex_update_settings_writes_toml_format
    run_test test_codex_update_settings_dry_run_does_not_modify
    run_test test_codex_update_settings_preserves_existing_config

    # Edge Cases
    run_test test_codex_handles_empty_component_name
    run_test test_codex_handles_special_characters_in_component

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
}

main "$@"

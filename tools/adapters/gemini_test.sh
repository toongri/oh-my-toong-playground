#!/bin/bash
# =============================================================================
# Gemini Adapter Tests
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
    mkdir -p "$TEST_TMP_DIR/.gemini"
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

    if grep -q "$pattern" "$file"; then
        echo "ASSERTION FAILED: $msg"
        echo "  Pattern found: '$pattern'"
        echo "  File: $file"
        return 1
    else
        return 0
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
source "$SCRIPT_DIR/gemini.sh"

# =============================================================================
# Tests: CLI Detection
# =============================================================================

test_gemini_is_available_returns_0_or_1() {
    # When gemini CLI is available or not, function should return 0 or 1
    gemini_is_available
    local result=$?
    # Result should be 0 or 1, not an error
    [[ $result -eq 0 || $result -eq 1 ]]
}

# =============================================================================
# Tests: Config Directory Functions
# =============================================================================

test_gemini_get_config_dir_returns_dot_gemini() {
    local result=$(gemini_get_config_dir)
    assert_equals ".gemini" "$result" "Config dir should be .gemini"
}

test_gemini_get_settings_file_returns_settings_json() {
    local result=$(gemini_get_settings_file)
    assert_equals "settings.json" "$result" "Settings file should be settings.json"
}

test_gemini_get_context_file_returns_gemini_md() {
    local result=$(gemini_get_context_file)
    assert_equals "GEMINI.md" "$result" "Context file should be GEMINI.md"
}

# =============================================================================
# Tests: Feature Support
# =============================================================================

test_gemini_supports_feature_agents_returns_false() {
    # Gemini does not support native subagents - should return non-zero
    if gemini_supports_feature "agents"; then
        echo "ASSERTION FAILED: Should NOT support agents feature (no native subagent support)"
        return 1
    fi
    return 0
}

test_gemini_supports_feature_commands() {
    gemini_supports_feature "commands"
    assert_equals 0 $? "Should support commands feature"
}

test_gemini_supports_feature_hooks() {
    gemini_supports_feature "hooks"
    assert_equals 0 $? "Should support hooks feature"
}

test_gemini_supports_feature_skills() {
    gemini_supports_feature "skills"
    assert_equals 0 $? "Should support skills feature"
}

test_gemini_supports_feature_unknown_returns_1() {
    if gemini_supports_feature "unknown_feature"; then
        return 1  # Should not support unknown feature
    else
        return 0  # Correctly returned non-zero
    fi
}

# =============================================================================
# Tests: Sync Agents (warns and skips - no native subagent support)
# =============================================================================

test_gemini_sync_agents_warns_and_skips() {
    # Gemini does not support native subagents - should warn and skip
    local source_dir="$TEST_TMP_DIR/agents"
    mkdir -p "$source_dir"
    echo "# Oracle Agent" > "$source_dir/oracle.md"

    echo "# Existing Content" > "$TEST_TMP_DIR/GEMINI.md"

    # Execute and capture output
    local output=$(gemini_sync_agents "$TEST_TMP_DIR" "oracle" "" "false" "$source_dir" 2>&1)

    # Verify warning was logged
    assert_output_contains "$output" "지원되지 않습니다" "Should warn that agents are not supported"
}

test_gemini_sync_agents_does_not_inject_into_gemini_md() {
    # Gemini does not support native subagents - should NOT inject into GEMINI.md
    local source_dir="$TEST_TMP_DIR/agents"
    mkdir -p "$source_dir"
    echo "# Oracle Agent" > "$source_dir/oracle.md"
    echo "This is the oracle agent content." >> "$source_dir/oracle.md"

    echo "# Existing Content" > "$TEST_TMP_DIR/GEMINI.md"
    local original_content=$(cat "$TEST_TMP_DIR/GEMINI.md")

    # Execute
    gemini_sync_agents "$TEST_TMP_DIR" "oracle" "" "false" "$source_dir"

    # Verify GEMINI.md was NOT modified
    local current_content=$(cat "$TEST_TMP_DIR/GEMINI.md")
    assert_equals "$original_content" "$current_content" "GEMINI.md should NOT be modified (agents not supported)"
}

test_gemini_sync_agents_returns_success() {
    # Even though agents are skipped, the function should return success (0)
    local source_dir="$TEST_TMP_DIR/agents"
    mkdir -p "$source_dir"
    echo "# Oracle Agent" > "$source_dir/oracle.md"

    # Execute
    gemini_sync_agents "$TEST_TMP_DIR" "oracle" "" "false" "$source_dir" 2>/dev/null
    local result=$?

    # Should return 0 (skip is not an error)
    assert_equals 0 $result "Should return success even when skipping"
}

# =============================================================================
# Tests: Sync Commands (uses .gemini/commands/, NOT .gemini/extensions/)
# =============================================================================

test_gemini_sync_commands_creates_toml_in_commands_dir() {
    # Setup: create source command file with frontmatter
    local source_dir="$TEST_TMP_DIR/commands"
    mkdir -p "$source_dir"
    cat > "$source_dir/prometheus.md" << 'EOF'
---
description: Strategic planning consultant
---

# Prometheus Command

This is the command content.
EOF

    mkdir -p "$TEST_TMP_DIR/.gemini"

    # Execute
    gemini_sync_commands "$TEST_TMP_DIR" "prometheus" "false" "$source_dir"

    # Verify: should be in .gemini/commands/, NOT .gemini/extensions/
    assert_file_exists "$TEST_TMP_DIR/.gemini/commands/prometheus.toml" "TOML file should be in .gemini/commands/"
    assert_file_contains "$TEST_TMP_DIR/.gemini/commands/prometheus.toml" 'name = "prometheus"' "Should have name field"
    assert_file_contains "$TEST_TMP_DIR/.gemini/commands/prometheus.toml" 'description = "Strategic planning consultant"' "Should have description field"
}

test_gemini_sync_commands_does_not_use_extensions_dir() {
    # Setup: create source command file
    local source_dir="$TEST_TMP_DIR/commands"
    mkdir -p "$source_dir"
    cat > "$source_dir/prometheus.md" << 'EOF'
---
description: Strategic planning consultant
---

# Prometheus Command
EOF

    mkdir -p "$TEST_TMP_DIR/.gemini"

    # Execute
    gemini_sync_commands "$TEST_TMP_DIR" "prometheus" "false" "$source_dir"

    # Verify: extensions directory should NOT be used
    if [[ -f "$TEST_TMP_DIR/.gemini/extensions/prometheus.toml" ]]; then
        echo "ASSERTION FAILED: TOML file should NOT be in .gemini/extensions/"
        return 1
    fi
    return 0
}

test_gemini_sync_commands_dry_run_does_not_create() {
    # Setup
    local source_dir="$TEST_TMP_DIR/commands"
    mkdir -p "$source_dir"
    cat > "$source_dir/prometheus.md" << 'EOF'
---
description: Strategic planning consultant
---

# Prometheus Command
EOF

    mkdir -p "$TEST_TMP_DIR/.gemini"

    # Execute with dry_run
    gemini_sync_commands "$TEST_TMP_DIR" "prometheus" "true" "$source_dir"

    # Verify
    if [[ -f "$TEST_TMP_DIR/.gemini/commands/prometheus.toml" ]]; then
        echo "ASSERTION FAILED: TOML file should not be created in dry-run mode"
        return 1
    fi
    return 0
}

test_gemini_sync_commands_handles_missing_source() {
    # Setup: no source file
    local source_dir="$TEST_TMP_DIR/commands"
    mkdir -p "$source_dir"
    mkdir -p "$TEST_TMP_DIR/.gemini"

    # Execute - should not error
    gemini_sync_commands "$TEST_TMP_DIR" "nonexistent" "false" "$source_dir"
    local result=$?

    assert_equals 0 $result "Should not error on missing source"
}

# =============================================================================
# Tests: Sync Hooks
# =============================================================================

test_gemini_sync_hooks_copies_file_and_sets_executable() {
    # Setup
    local source_dir="$TEST_TMP_DIR/hooks"
    mkdir -p "$source_dir"
    echo '#!/bin/bash' > "$source_dir/test-hook.sh"
    echo 'echo "test"' >> "$source_dir/test-hook.sh"

    mkdir -p "$TEST_TMP_DIR/.gemini"

    # Execute
    gemini_sync_hooks "$TEST_TMP_DIR" "test-hook.sh" "PreToolUse" "*" "10" "command" "" "" "false" "$source_dir"

    # Verify file exists and is executable
    assert_file_exists "$TEST_TMP_DIR/.gemini/hooks/test-hook.sh" "Hook file should be copied"
    if [[ -x "$TEST_TMP_DIR/.gemini/hooks/test-hook.sh" ]]; then
        return 0
    else
        echo "ASSERTION FAILED: Hook file should be executable"
        return 1
    fi
}

test_gemini_sync_hooks_dry_run_does_not_copy() {
    # Setup
    local source_dir="$TEST_TMP_DIR/hooks"
    mkdir -p "$source_dir"
    echo '#!/bin/bash' > "$source_dir/test-hook.sh"

    mkdir -p "$TEST_TMP_DIR/.gemini"

    # Execute with dry_run
    gemini_sync_hooks "$TEST_TMP_DIR" "test-hook.sh" "PreToolUse" "*" "10" "command" "" "" "true" "$source_dir"

    # Verify
    if [[ -f "$TEST_TMP_DIR/.gemini/hooks/test-hook.sh" ]]; then
        echo "ASSERTION FAILED: Hook file should not be created in dry-run mode"
        return 1
    fi
    return 0
}

# =============================================================================
# Tests: Sync Skills (Directory Copy - NOT GEMINI.md injection)
# =============================================================================

test_gemini_sync_skills_copies_directory_to_gemini_skills() {
    # Setup: create source skill directory with multiple files
    local source_dir="$TEST_TMP_DIR/skills"
    mkdir -p "$source_dir/prometheus"
    echo "# Prometheus Skill" > "$source_dir/prometheus/SKILL.md"
    echo "Strategic planning content." >> "$source_dir/prometheus/SKILL.md"
    echo "# Additional file" > "$source_dir/prometheus/README.md"

    mkdir -p "$TEST_TMP_DIR/.gemini"

    # Execute
    gemini_sync_skills "$TEST_TMP_DIR" "prometheus" "false" "$source_dir"

    # Verify: skill directory should be copied to .gemini/skills/
    assert_file_exists "$TEST_TMP_DIR/.gemini/skills/prometheus/SKILL.md" "SKILL.md should be copied to .gemini/skills/"
    assert_file_exists "$TEST_TMP_DIR/.gemini/skills/prometheus/README.md" "README.md should be copied to .gemini/skills/"
    assert_file_contains "$TEST_TMP_DIR/.gemini/skills/prometheus/SKILL.md" "# Prometheus Skill" "Should have skill content"
}

test_gemini_sync_skills_does_not_inject_into_gemini_md() {
    # Setup: create source skill directory
    local source_dir="$TEST_TMP_DIR/skills"
    mkdir -p "$source_dir/prometheus"
    echo "# Prometheus Skill" > "$source_dir/prometheus/SKILL.md"

    echo "# Existing Content" > "$TEST_TMP_DIR/GEMINI.md"
    mkdir -p "$TEST_TMP_DIR/.gemini"

    # Execute
    gemini_sync_skills "$TEST_TMP_DIR" "prometheus" "false" "$source_dir"

    # Verify: GEMINI.md should NOT have skill injection
    assert_file_not_contains "$TEST_TMP_DIR/GEMINI.md" "<!-- oh-my-toong:skill:prometheus -->" "Should NOT inject into GEMINI.md"
    assert_file_not_contains "$TEST_TMP_DIR/GEMINI.md" "# Prometheus Skill" "Skill content should NOT be in GEMINI.md"
}

test_gemini_sync_skills_dry_run_does_not_copy() {
    # Setup
    local source_dir="$TEST_TMP_DIR/skills"
    mkdir -p "$source_dir/prometheus"
    echo "# Prometheus Skill" > "$source_dir/prometheus/SKILL.md"

    mkdir -p "$TEST_TMP_DIR/.gemini"

    # Execute with dry_run
    gemini_sync_skills "$TEST_TMP_DIR" "prometheus" "true" "$source_dir"

    # Verify: directory should NOT be created in dry-run mode
    if [[ -d "$TEST_TMP_DIR/.gemini/skills/prometheus" ]]; then
        echo "ASSERTION FAILED: Skills directory should not be created in dry-run mode"
        return 1
    fi
    return 0
}

test_gemini_sync_skills_handles_missing_source() {
    # Setup: no source directory
    local source_dir="$TEST_TMP_DIR/skills"
    mkdir -p "$source_dir"

    mkdir -p "$TEST_TMP_DIR/.gemini"

    # Execute - should not error (returns 1 for warning)
    gemini_sync_skills "$TEST_TMP_DIR" "nonexistent" "false" "$source_dir"
    local result=$?

    # Should return 1 (warning about missing directory)
    assert_equals 1 $result "Should return 1 on missing source directory"
}

test_gemini_sync_skills_handles_project_prefixed_skill() {
    # Setup: create source skill directory with project prefix structure
    local source_dir="$TEST_TMP_DIR/skills"
    mkdir -p "$source_dir/testing"
    echo "# Testing Skill" > "$source_dir/testing/SKILL.md"

    mkdir -p "$TEST_TMP_DIR/.gemini"

    # Execute with project prefix (simulated - using source_base_dir for testing)
    gemini_sync_skills "$TEST_TMP_DIR" "testing" "false" "$source_dir"

    # Verify
    assert_file_exists "$TEST_TMP_DIR/.gemini/skills/testing/SKILL.md" "Should copy project-prefixed skill"
}

# =============================================================================
# Tests: Update Settings JSON
# =============================================================================

test_gemini_update_settings_creates_settings_file() {
    mkdir -p "$TEST_TMP_DIR/.gemini"

    local hooks_json='{"PreToolUse": [{"matcher": "*", "hooks": [{"type": "command", "command": ".gemini/hooks/test.sh", "timeout": 10}]}]}'

    # Execute
    gemini_update_settings "$TEST_TMP_DIR" "$hooks_json" "false"

    # Verify
    assert_file_exists "$TEST_TMP_DIR/.gemini/settings.json" "Settings file should be created"
    assert_file_contains "$TEST_TMP_DIR/.gemini/settings.json" "PreToolUse" "Settings should contain hook event"
}

test_gemini_update_settings_merges_with_existing() {
    mkdir -p "$TEST_TMP_DIR/.gemini"

    # Create existing settings
    echo '{"existingKey": "existingValue"}' > "$TEST_TMP_DIR/.gemini/settings.json"

    local hooks_json='{"PreToolUse": [{"matcher": "*", "hooks": [{"type": "command", "command": ".gemini/hooks/test.sh", "timeout": 10}]}]}'

    # Execute
    gemini_update_settings "$TEST_TMP_DIR" "$hooks_json" "false"

    # Verify both keys exist
    assert_file_contains "$TEST_TMP_DIR/.gemini/settings.json" "existingKey" "Should preserve existing keys"
    assert_file_contains "$TEST_TMP_DIR/.gemini/settings.json" "PreToolUse" "Should add new hook"
}

test_gemini_update_settings_dry_run_does_not_modify() {
    mkdir -p "$TEST_TMP_DIR/.gemini"

    local hooks_json='{"PreToolUse": [{"matcher": "*", "hooks": [{"type": "command", "command": ".gemini/hooks/test.sh", "timeout": 10}]}]}'

    # Execute with dry_run
    gemini_update_settings "$TEST_TMP_DIR" "$hooks_json" "true"

    # Verify file was NOT created
    if [[ -f "$TEST_TMP_DIR/.gemini/settings.json" ]]; then
        echo "ASSERTION FAILED: Settings file should not be created in dry-run mode"
        return 1
    fi
    return 0
}

# =============================================================================
# Tests: Build Hook Entry
# =============================================================================

test_gemini_build_hook_entry_command_type() {
    local result=$(gemini_build_hook_entry "PreToolUse" "*" "command" "10" ".gemini/hooks/test.sh" "test")

    # Verify JSON structure
    if echo "$result" | jq -e '.[0].matcher == "*"' > /dev/null 2>&1; then
        if echo "$result" | jq -e '.[0].hooks[0].type == "command"' > /dev/null 2>&1; then
            if echo "$result" | jq -e '.[0].hooks[0].command == ".gemini/hooks/test.sh"' > /dev/null 2>&1; then
                return 0
            fi
        fi
    fi
    echo "ASSERTION FAILED: Hook entry JSON structure incorrect"
    echo "  Result: $result"
    return 1
}

test_gemini_build_hook_entry_prompt_type() {
    local result=$(gemini_build_hook_entry "Stop" "*" "prompt" "5" "Are you sure?" "")

    # Verify JSON structure
    if echo "$result" | jq -e '.[0].hooks[0].type == "prompt"' > /dev/null 2>&1; then
        if echo "$result" | jq -e '.[0].hooks[0].prompt == "Are you sure?"' > /dev/null 2>&1; then
            return 0
        fi
    fi
    echo "ASSERTION FAILED: Hook entry JSON structure incorrect"
    echo "  Result: $result"
    return 1
}

test_gemini_build_hook_entry_substitutes_component() {
    local result=$(gemini_build_hook_entry "PreToolUse" "*" "command" "10" '.gemini/hooks/${component}' "my-hook.sh")

    # Verify component substitution
    if echo "$result" | jq -e '.[0].hooks[0].command == ".gemini/hooks/my-hook.sh"' > /dev/null 2>&1; then
        return 0
    fi
    echo "ASSERTION FAILED: Component substitution failed"
    echo "  Result: $result"
    return 1
}

# =============================================================================
# Main Test Runner
# =============================================================================

main() {
    echo "=========================================="
    echo "Gemini Adapter Tests"
    echo "=========================================="

    # CLI Detection
    run_test test_gemini_is_available_returns_0_or_1

    # Config Directory Functions
    run_test test_gemini_get_config_dir_returns_dot_gemini
    run_test test_gemini_get_settings_file_returns_settings_json
    run_test test_gemini_get_context_file_returns_gemini_md

    # Feature Support
    run_test test_gemini_supports_feature_agents_returns_false
    run_test test_gemini_supports_feature_commands
    run_test test_gemini_supports_feature_hooks
    run_test test_gemini_supports_feature_skills
    run_test test_gemini_supports_feature_unknown_returns_1

    # Sync Agents (warns and skips - no native subagent support)
    run_test test_gemini_sync_agents_warns_and_skips
    run_test test_gemini_sync_agents_does_not_inject_into_gemini_md
    run_test test_gemini_sync_agents_returns_success

    # Sync Commands (uses .gemini/commands/)
    run_test test_gemini_sync_commands_creates_toml_in_commands_dir
    run_test test_gemini_sync_commands_does_not_use_extensions_dir
    run_test test_gemini_sync_commands_dry_run_does_not_create
    run_test test_gemini_sync_commands_handles_missing_source

    # Sync Hooks
    run_test test_gemini_sync_hooks_copies_file_and_sets_executable
    run_test test_gemini_sync_hooks_dry_run_does_not_copy

    # Sync Skills (Directory Copy)
    run_test test_gemini_sync_skills_copies_directory_to_gemini_skills
    run_test test_gemini_sync_skills_does_not_inject_into_gemini_md
    run_test test_gemini_sync_skills_dry_run_does_not_copy
    run_test test_gemini_sync_skills_handles_missing_source
    run_test test_gemini_sync_skills_handles_project_prefixed_skill

    # Settings Update
    run_test test_gemini_update_settings_creates_settings_file
    run_test test_gemini_update_settings_merges_with_existing
    run_test test_gemini_update_settings_dry_run_does_not_modify

    # Hook Entry Builder
    run_test test_gemini_build_hook_entry_command_type
    run_test test_gemini_build_hook_entry_prompt_type
    run_test test_gemini_build_hook_entry_substitutes_component

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
}

main "$@"

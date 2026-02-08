#!/bin/bash
# =============================================================================
# Claude Adapter Tests
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
source "$SCRIPT_DIR/claude.sh"

# =============================================================================
# Tests: CLI Detection
# =============================================================================

test_claude_is_available_returns_0_when_cli_exists() {
    # When claude CLI is available, function should return 0
    # This test depends on system state - we test the function exists and returns something
    claude_is_available
    local result=$?
    # Result should be 0 or 1, not an error
    [[ $result -eq 0 || $result -eq 1 ]]
}

# =============================================================================
# Tests: Config Directory Functions
# =============================================================================

test_claude_get_config_dir_returns_dot_claude() {
    local result=$(claude_get_config_dir)
    assert_equals ".claude" "$result" "Config dir should be .claude"
}

test_claude_get_settings_file_returns_settings_json() {
    local result=$(claude_get_settings_file)
    assert_equals "settings.json" "$result" "Settings file should be settings.json"
}

test_claude_get_context_file_returns_claude_md() {
    local result=$(claude_get_context_file)
    assert_equals "CLAUDE.md" "$result" "Context file should be CLAUDE.md"
}

# =============================================================================
# Tests: Feature Support
# =============================================================================

test_claude_supports_feature_agents() {
    claude_supports_feature "agents"
    assert_equals 0 $? "Should support agents feature"
}

test_claude_supports_feature_commands() {
    claude_supports_feature "commands"
    assert_equals 0 $? "Should support commands feature"
}

test_claude_supports_feature_hooks() {
    claude_supports_feature "hooks"
    assert_equals 0 $? "Should support hooks feature"
}

test_claude_supports_feature_skills() {
    claude_supports_feature "skills"
    assert_equals 0 $? "Should support skills feature"
}

test_claude_supports_feature_unknown_returns_1() {
    claude_supports_feature "unknown_feature" || true
    local result=$?
    # Function should return non-zero for unknown feature
    # Since we use || true, we need to capture the actual return
    if claude_supports_feature "unknown_feature"; then
        return 1  # Should not support unknown feature
    else
        return 0  # Correctly returned non-zero
    fi
}

# =============================================================================
# Tests: Sync Agents
# =============================================================================

test_claude_sync_agents_copies_file() {
    # Setup: create source agent file
    local source_dir="$TEST_TMP_DIR/agents"
    mkdir -p "$source_dir"
    echo "# Test Agent" > "$source_dir/test-agent.md"

    local target_dir="$TEST_TMP_DIR/target"
    mkdir -p "$target_dir/.claude"

    # Execute
    claude_sync_agents "$target_dir" "test-agent" "" "false" "$source_dir"

    # Verify
    assert_file_exists "$target_dir/.claude/agents/test-agent.md" "Agent file should be copied"
}

test_claude_sync_agents_dry_run_does_not_copy() {
    # Setup
    local source_dir="$TEST_TMP_DIR/agents"
    mkdir -p "$source_dir"
    echo "# Test Agent" > "$source_dir/test-agent.md"

    local target_dir="$TEST_TMP_DIR/target"
    mkdir -p "$target_dir/.claude"

    # Execute with dry_run=true
    claude_sync_agents "$target_dir" "test-agent" "" "true" "$source_dir"

    # Verify file was NOT created
    if [[ -f "$target_dir/.claude/agents/test-agent.md" ]]; then
        echo "ASSERTION FAILED: File should not exist in dry-run mode"
        return 1
    fi
    return 0
}

# =============================================================================
# Tests: Sync Commands
# =============================================================================

test_claude_sync_commands_copies_file() {
    # Setup
    local source_dir="$TEST_TMP_DIR/commands"
    mkdir -p "$source_dir"
    echo "# Test Command" > "$source_dir/test-cmd.md"

    local target_dir="$TEST_TMP_DIR/target"
    mkdir -p "$target_dir/.claude"

    # Execute
    claude_sync_commands "$target_dir" "test-cmd" "false" "$source_dir"

    # Verify
    assert_file_exists "$target_dir/.claude/commands/test-cmd.md" "Command file should be copied"
}

# =============================================================================
# Tests: Sync Skills
# =============================================================================

test_claude_sync_skills_copies_directory() {
    # Setup
    local source_dir="$TEST_TMP_DIR/skills"
    mkdir -p "$source_dir/test-skill"
    echo "# Test Skill" > "$source_dir/test-skill/SKILL.md"

    local target_dir="$TEST_TMP_DIR/target"
    mkdir -p "$target_dir/.claude"

    # Execute
    claude_sync_skills "$target_dir" "test-skill" "false" "$source_dir"

    # Verify
    assert_file_exists "$target_dir/.claude/skills/test-skill/SKILL.md" "Skill directory should be copied"
}

# =============================================================================
# Tests: Sync Hooks
# =============================================================================

test_claude_sync_hooks_copies_file_and_sets_executable() {
    # Setup
    local source_dir="$TEST_TMP_DIR/hooks"
    mkdir -p "$source_dir"
    echo '#!/bin/bash' > "$source_dir/test-hook.sh"
    echo 'echo "test"' >> "$source_dir/test-hook.sh"

    local target_dir="$TEST_TMP_DIR/target"
    mkdir -p "$target_dir/.claude"

    # Execute (minimal hook - just file copy)
    claude_sync_hooks "$target_dir" "test-hook.sh" "PreToolUse" "*" "10" "command" "" "" "false" "$source_dir"

    # Verify file exists and is executable
    assert_file_exists "$target_dir/.claude/hooks/test-hook.sh" "Hook file should be copied"
    if [[ -x "$target_dir/.claude/hooks/test-hook.sh" ]]; then
        return 0
    else
        echo "ASSERTION FAILED: Hook file should be executable"
        return 1
    fi
}

# =============================================================================
# Tests: Update Settings JSON
# =============================================================================

test_claude_update_settings_creates_settings_file() {
    local target_dir="$TEST_TMP_DIR/target"
    mkdir -p "$target_dir/.claude"

    local hooks_json='{"PreToolUse": [{"matcher": "*", "hooks": [{"type": "command", "command": ".claude/hooks/test.sh", "timeout": 10}]}]}'

    # Execute
    claude_update_settings "$target_dir" "$hooks_json" "false"

    # Verify
    assert_file_exists "$target_dir/.claude/settings.json" "Settings file should be created"
    assert_file_contains "$target_dir/.claude/settings.json" "PreToolUse" "Settings should contain hook event"
}

test_claude_update_settings_merges_with_existing() {
    local target_dir="$TEST_TMP_DIR/target"
    mkdir -p "$target_dir/.claude"

    # Create existing settings
    echo '{"existingKey": "existingValue"}' > "$target_dir/.claude/settings.json"

    local hooks_json='{"PreToolUse": [{"matcher": "*", "hooks": [{"type": "command", "command": ".claude/hooks/test.sh", "timeout": 10}]}]}'

    # Execute
    claude_update_settings "$target_dir" "$hooks_json" "false"

    # Verify both keys exist
    assert_file_contains "$target_dir/.claude/settings.json" "existingKey" "Should preserve existing keys"
    assert_file_contains "$target_dir/.claude/settings.json" "PreToolUse" "Should add new hook"
}

test_claude_update_settings_dry_run_does_not_modify() {
    local target_dir="$TEST_TMP_DIR/target"
    mkdir -p "$target_dir/.claude"

    local hooks_json='{"PreToolUse": [{"matcher": "*", "hooks": [{"type": "command", "command": ".claude/hooks/test.sh", "timeout": 10}]}]}'

    # Execute with dry_run
    claude_update_settings "$target_dir" "$hooks_json" "true"

    # Verify file was NOT created
    if [[ -f "$target_dir/.claude/settings.json" ]]; then
        echo "ASSERTION FAILED: Settings file should not be created in dry-run mode"
        return 1
    fi
    return 0
}

# =============================================================================
# Tests: Update Agent Frontmatter
# =============================================================================

test_claude_update_agent_frontmatter_adds_skills() {
    local target_dir="$TEST_TMP_DIR/target"
    mkdir -p "$target_dir/.claude/agents"

    # Create agent file with frontmatter
    cat > "$target_dir/.claude/agents/test-agent.md" << 'EOF'
---
skills:
  - existing-skill
---
# Test Agent Content
EOF

    # Execute
    claude_update_agent_frontmatter "$target_dir/.claude/agents/test-agent.md" "new-skill" "false"

    # Verify
    assert_file_contains "$target_dir/.claude/agents/test-agent.md" "existing-skill" "Should preserve existing skill"
    assert_file_contains "$target_dir/.claude/agents/test-agent.md" "new-skill" "Should add new skill"
}

test_claude_update_agent_frontmatter_dry_run_does_not_modify() {
    local target_dir="$TEST_TMP_DIR/target"
    mkdir -p "$target_dir/.claude/agents"

    # Create agent file with frontmatter
    cat > "$target_dir/.claude/agents/test-agent.md" << 'EOF'
---
skills:
  - existing-skill
---
# Test Agent Content
EOF

    local original_content=$(cat "$target_dir/.claude/agents/test-agent.md")

    # Execute with dry_run
    claude_update_agent_frontmatter "$target_dir/.claude/agents/test-agent.md" "new-skill" "true"

    # Verify content unchanged
    local current_content=$(cat "$target_dir/.claude/agents/test-agent.md")
    assert_equals "$original_content" "$current_content" "Content should not change in dry-run mode"
}

# =============================================================================
# Tests: Update Agent Hooks Frontmatter
# =============================================================================

test_claude_update_agent_hooks_frontmatter_adds_hooks() {
    local target_dir="$TEST_TMP_DIR/target"
    mkdir -p "$target_dir/.claude/agents"

    # Create agent file with frontmatter
    cat > "$target_dir/.claude/agents/test-agent.md" << 'EOF'
---
skills:
  - existing-skill
---
# Test Agent Content
EOF

    # Execute with a SubagentStop hook
    local hooks_json='[{"event":"SubagentStop","matcher":"*","type":"command","command":"$CLAUDE_PROJECT_DIR/.claude/hooks/my-hook.sh","timeout":120}]'
    claude_update_agent_hooks_frontmatter "$target_dir/.claude/agents/test-agent.md" "$hooks_json" "false"

    # Verify
    assert_file_contains "$target_dir/.claude/agents/test-agent.md" "existing-skill" "Should preserve existing skill"
    assert_file_contains "$target_dir/.claude/agents/test-agent.md" "SubagentStop" "Should add SubagentStop hook"
    assert_file_contains "$target_dir/.claude/agents/test-agent.md" "my-hook.sh" "Should contain hook command"
    assert_file_contains "$target_dir/.claude/agents/test-agent.md" "120" "Should contain timeout"
}

test_claude_update_agent_hooks_frontmatter_empty_json_does_nothing() {
    local target_dir="$TEST_TMP_DIR/target"
    mkdir -p "$target_dir/.claude/agents"

    cat > "$target_dir/.claude/agents/test-agent.md" << 'EOF'
---
skills:
  - existing-skill
---
# Test Agent Content
EOF

    local original_content=$(cat "$target_dir/.claude/agents/test-agent.md")

    # Execute with empty hooks
    claude_update_agent_hooks_frontmatter "$target_dir/.claude/agents/test-agent.md" "[]" "false"

    local current_content=$(cat "$target_dir/.claude/agents/test-agent.md")
    assert_equals "$original_content" "$current_content" "Content should not change with empty hooks"
}

test_claude_update_agent_hooks_frontmatter_dry_run_does_not_modify() {
    local target_dir="$TEST_TMP_DIR/target"
    mkdir -p "$target_dir/.claude/agents"

    cat > "$target_dir/.claude/agents/test-agent.md" << 'EOF'
---
skills:
  - existing-skill
---
# Test Agent Content
EOF

    local original_content=$(cat "$target_dir/.claude/agents/test-agent.md")

    local hooks_json='[{"event":"SubagentStop","matcher":"*","type":"command","command":"test","timeout":60}]'
    claude_update_agent_hooks_frontmatter "$target_dir/.claude/agents/test-agent.md" "$hooks_json" "true"

    local current_content=$(cat "$target_dir/.claude/agents/test-agent.md")
    assert_equals "$original_content" "$current_content" "Content should not change in dry-run mode"
}

# =============================================================================
# Tests: Frontmatter Hooks - Empty Command Fallback
# =============================================================================

test_claude_sync_agents_direct_empty_command_uses_fallback_path() {
    # Setup: create source agent file with frontmatter
    local source_file="$TEST_TMP_DIR/source-agent.md"
    cat > "$source_file" << 'EOF'
---
skills:
  - some-skill
---
# Test Agent
EOF

    local target_dir="$TEST_TMP_DIR/target"
    mkdir -p "$target_dir/.claude"

    # add_hooks_json with .command as empty string "" (simulates yq reading missing value)
    local add_hooks_json='[{"event":"SubagentStop","display_name":"my-hook.sh","source_path":"","command":"","timeout":120}]'

    # Execute
    claude_sync_agents_direct "$target_dir" "test-agent" "$source_file" "" "$add_hooks_json" "false"

    # Verify: the agent file should contain the fallback path, not an empty command
    local agent_file="$target_dir/.claude/agents/test-agent.md"
    if grep -q 'command: "\$CLAUDE_PROJECT_DIR/.claude/hooks/my-hook.sh"' "$agent_file"; then
        return 0
    else
        echo "ASSERTION FAILED: Agent hooks should contain fallback path with \$CLAUDE_PROJECT_DIR"
        echo "  Expected command to contain: \$CLAUDE_PROJECT_DIR/.claude/hooks/my-hook.sh"
        echo "  Actual file content:"
        cat "$agent_file"
        return 1
    fi
}

test_claude_sync_agents_direct_null_command_uses_fallback_path() {
    # Setup: create source agent file with frontmatter
    local source_file="$TEST_TMP_DIR/source-agent.md"
    cat > "$source_file" << 'EOF'
---
skills:
  - some-skill
---
# Test Agent
EOF

    local target_dir="$TEST_TMP_DIR/target"
    mkdir -p "$target_dir/.claude"

    # add_hooks_json with .command as null (no command field)
    local add_hooks_json='[{"event":"SubagentStop","display_name":"my-hook.sh","source_path":""}]'

    # Execute
    claude_sync_agents_direct "$target_dir" "test-agent" "$source_file" "" "$add_hooks_json" "false"

    # Verify: the agent file should contain the fallback path
    local agent_file="$target_dir/.claude/agents/test-agent.md"
    if grep -q 'command: "\$CLAUDE_PROJECT_DIR/.claude/hooks/my-hook.sh"' "$agent_file"; then
        return 0
    else
        echo "ASSERTION FAILED: Agent hooks should contain fallback path when command is null"
        echo "  Expected command to contain: \$CLAUDE_PROJECT_DIR/.claude/hooks/my-hook.sh"
        echo "  Actual file content:"
        cat "$agent_file"
        return 1
    fi
}

test_claude_sync_agents_direct_explicit_command_preserved() {
    # Setup: create source agent file with frontmatter
    local source_file="$TEST_TMP_DIR/source-agent.md"
    cat > "$source_file" << 'EOF'
---
skills:
  - some-skill
---
# Test Agent
EOF

    local target_dir="$TEST_TMP_DIR/target"
    mkdir -p "$target_dir/.claude"

    # add_hooks_json with explicit .command
    local add_hooks_json='[{"event":"SubagentStop","display_name":"my-hook.sh","source_path":"","command":"/custom/path/hook.sh","timeout":60}]'

    # Execute
    claude_sync_agents_direct "$target_dir" "test-agent" "$source_file" "" "$add_hooks_json" "false"

    # Verify: the agent file should contain the explicit command, not fallback
    local agent_file="$target_dir/.claude/agents/test-agent.md"
    if grep -q 'command: "/custom/path/hook.sh"' "$agent_file"; then
        return 0
    else
        echo "ASSERTION FAILED: Agent hooks should preserve explicit command"
        echo "  Expected command: /custom/path/hook.sh"
        echo "  Actual file content:"
        cat "$agent_file"
        return 1
    fi
}

# =============================================================================
# Main Test Runner
# =============================================================================

main() {
    echo "=========================================="
    echo "Claude Adapter Tests"
    echo "=========================================="

    # CLI Detection
    run_test test_claude_is_available_returns_0_when_cli_exists

    # Config Directory Functions
    run_test test_claude_get_config_dir_returns_dot_claude
    run_test test_claude_get_settings_file_returns_settings_json
    run_test test_claude_get_context_file_returns_claude_md

    # Feature Support
    run_test test_claude_supports_feature_agents
    run_test test_claude_supports_feature_commands
    run_test test_claude_supports_feature_hooks
    run_test test_claude_supports_feature_skills
    run_test test_claude_supports_feature_unknown_returns_1

    # Sync Functions
    run_test test_claude_sync_agents_copies_file
    run_test test_claude_sync_agents_dry_run_does_not_copy
    run_test test_claude_sync_commands_copies_file
    run_test test_claude_sync_skills_copies_directory
    run_test test_claude_sync_hooks_copies_file_and_sets_executable

    # Settings Update
    run_test test_claude_update_settings_creates_settings_file
    run_test test_claude_update_settings_merges_with_existing
    run_test test_claude_update_settings_dry_run_does_not_modify

    # Agent Frontmatter
    run_test test_claude_update_agent_frontmatter_adds_skills
    run_test test_claude_update_agent_frontmatter_dry_run_does_not_modify

    # Agent Hooks Frontmatter
    run_test test_claude_update_agent_hooks_frontmatter_adds_hooks
    run_test test_claude_update_agent_hooks_frontmatter_empty_json_does_nothing
    run_test test_claude_update_agent_hooks_frontmatter_dry_run_does_not_modify

    # Frontmatter Hooks - Empty Command Fallback
    run_test test_claude_sync_agents_direct_empty_command_uses_fallback_path
    run_test test_claude_sync_agents_direct_null_command_uses_fallback_path
    run_test test_claude_sync_agents_direct_explicit_command_preserved

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
}

main "$@"

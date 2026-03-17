#!/bin/bash
# =============================================================================
# OpenCode Adapter Tests
# Unit tests for tools/adapters/opencode.sh
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Test utilities
TESTS_PASSED=0
TESTS_FAILED=0
TEST_TMP_DIR=""

setup_test_env() {
    TEST_TMP_DIR=$(mktemp -d)
    mkdir -p "$TEST_TMP_DIR/target"
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

# Source opencode adapter functions
source_opencode_adapter() {
    # Source without running main — adapter has no main, just function definitions
    source "$SCRIPT_DIR/opencode.sh"
}

run_test() {
    local test_name="$1"

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

# =============================================================================
# Tests: Agent Frontmatter Translation
# =============================================================================

test_agent_frontmatter_removes_add_skills_and_converts_subagent_type() {
    source_opencode_adapter

    local agent_file="$TEST_TMP_DIR/test-agent.md"
    cat > "$agent_file" << 'EOF'
---
add-skills:
  - testing
  - oracle
subagent_type: oracle
description: Test agent description
---
# Test Agent

This is a test agent body.
EOF

    opencode_sync_agents_direct \
        "$TEST_TMP_DIR/target" \
        "test-agent" \
        "$agent_file" \
        "" \
        "false"

    local result_file="$TEST_TMP_DIR/target/.opencode/agents/test-agent.md"

    assert_file_exists "$result_file" "Agent file should be created" || return 1
    assert_file_not_contains "$result_file" "add-skills" "add-skills should be removed from frontmatter" || return 1
    assert_file_contains "$result_file" "mode: subagent" "mode: subagent should be added" || return 1
    assert_file_not_contains "$result_file" "subagent_type" "subagent_type should be removed" || return 1
    assert_file_contains "$result_file" "Test Agent" "Agent body should be preserved" || return 1
}

test_agent_frontmatter_no_subagent_type_no_mode() {
    source_opencode_adapter

    local agent_file="$TEST_TMP_DIR/test-agent.md"
    cat > "$agent_file" << 'EOF'
---
description: A plain agent
---
# Plain Agent
EOF

    opencode_sync_agents_direct \
        "$TEST_TMP_DIR/target" \
        "plain-agent" \
        "$agent_file" \
        "" \
        "false"

    local result_file="$TEST_TMP_DIR/target/.opencode/agents/plain-agent.md"

    assert_file_exists "$result_file" "Agent file should be created" || return 1
    assert_file_not_contains "$result_file" "mode:" "mode should not be added when subagent_type absent" || return 1
    assert_file_contains "$result_file" "description: A plain agent" "description should be preserved" || return 1
}

# =============================================================================
# Tests: Rules Sync with Instructions Glob
# =============================================================================

test_rules_sync_copies_file_and_updates_instructions_glob() {
    source_opencode_adapter

    local rule_file="$TEST_TMP_DIR/my-rule.md"
    cat > "$rule_file" << 'EOF'
# My Rule

Some rule content here.
EOF

    opencode_sync_rules_direct \
        "$TEST_TMP_DIR/target" \
        "my-rule" \
        "$rule_file" \
        "false"

    local result_rule="$TEST_TMP_DIR/target/.opencode/rules/my-rule.md"
    local config_file="$TEST_TMP_DIR/target/.opencode/opencode.json"

    assert_file_exists "$result_rule" "Rule file should be copied" || return 1
    assert_file_exists "$config_file" "opencode.json should be created" || return 1

    local glob_count
    glob_count=$(jq '[.instructions[] | select(. == ".opencode/rules/*.md")] | length' "$config_file")
    assert_equals "1" "$glob_count" "instructions glob should appear exactly once" || return 1
}

test_rules_sync_is_idempotent() {
    source_opencode_adapter

    local rule_file="$TEST_TMP_DIR/my-rule.md"
    cat > "$rule_file" << 'EOF'
# My Rule
Rule content.
EOF

    # Call twice
    opencode_sync_rules_direct \
        "$TEST_TMP_DIR/target" \
        "my-rule" \
        "$rule_file" \
        "false"

    opencode_sync_rules_direct \
        "$TEST_TMP_DIR/target" \
        "my-rule" \
        "$rule_file" \
        "false"

    local config_file="$TEST_TMP_DIR/target/.opencode/opencode.json"
    local glob_count
    glob_count=$(jq '[.instructions[] | select(. == ".opencode/rules/*.md")] | length' "$config_file")
    assert_equals "1" "$glob_count" "glob should appear exactly once after two calls (idempotent)" || return 1
}

# =============================================================================
# Tests: Hooks Skip
# =============================================================================

test_hooks_skip_creates_no_files() {
    source_opencode_adapter

    opencode_sync_hooks_direct \
        "$TEST_TMP_DIR/target" \
        "my-hook" \
        "/some/source/path" \
        "UserPromptSubmit" \
        "false"

    # No files should be created inside target
    local file_count
    file_count=$(find "$TEST_TMP_DIR/target" -type f 2>/dev/null | wc -l | tr -d ' ')
    assert_equals "0" "$file_count" "hooks skip should create no files" || return 1
}

# =============================================================================
# Tests: Config Deep Merge
# =============================================================================

test_config_deep_merge_preserves_existing_and_adds_new() {
    source_opencode_adapter

    # Create existing opencode.json
    mkdir -p "$TEST_TMP_DIR/target/.opencode"
    cat > "$TEST_TMP_DIR/target/.opencode/opencode.json" << 'EOF'
{
    "existing_key": "existing_value",
    "model": "claude-3-5-sonnet"
}
EOF

    # Merge new config
    opencode_sync_config \
        "$TEST_TMP_DIR/target" \
        '{"new_key": "new_value", "theme": "dark"}' \
        "false"

    local config_file="$TEST_TMP_DIR/target/.opencode/opencode.json"

    assert_file_exists "$config_file" "opencode.json should exist" || return 1

    local existing_val
    existing_val=$(jq -r '.existing_key' "$config_file")
    assert_equals "existing_value" "$existing_val" "existing key should be preserved" || return 1

    local new_val
    new_val=$(jq -r '.new_key' "$config_file")
    assert_equals "new_value" "$new_val" "new key should be added" || return 1

    local theme_val
    theme_val=$(jq -r '.theme' "$config_file")
    assert_equals "dark" "$theme_val" "theme key should be added" || return 1
}

test_config_creates_new_file_when_absent() {
    source_opencode_adapter

    opencode_sync_config \
        "$TEST_TMP_DIR/target" \
        '{"model": "claude-opus-4"}' \
        "false"

    local config_file="$TEST_TMP_DIR/target/.opencode/opencode.json"
    assert_file_exists "$config_file" "opencode.json should be created" || return 1

    local model_val
    model_val=$(jq -r '.model' "$config_file")
    assert_equals "claude-opus-4" "$model_val" "model should be set" || return 1
}

# =============================================================================
# Tests: MCP Merge
# =============================================================================

test_mcps_merge_adds_server_to_opencode_json() {
    source_opencode_adapter

    opencode_sync_mcps_merge \
        "$TEST_TMP_DIR/target" \
        "my-server" \
        '{"type": "stdio", "command": "my-cmd"}' \
        "false"

    local config_file="$TEST_TMP_DIR/target/.opencode/opencode.json"
    assert_file_exists "$config_file" "opencode.json should be created" || return 1

    local server_type
    server_type=$(jq -r '.mcp["my-server"].type' "$config_file")
    assert_equals "stdio" "$server_type" ".mcp.my-server.type should be set" || return 1

    local server_cmd
    server_cmd=$(jq -r '.mcp["my-server"].command' "$config_file")
    assert_equals "my-cmd" "$server_cmd" ".mcp.my-server.command should be set" || return 1
}

test_mcps_merge_preserves_existing_mcps() {
    source_opencode_adapter

    # Create existing opencode.json with an MCP server
    mkdir -p "$TEST_TMP_DIR/target/.opencode"
    cat > "$TEST_TMP_DIR/target/.opencode/opencode.json" << 'EOF'
{
    "mcp": {
        "existing-server": {"type": "sse", "url": "http://localhost:3000"}
    }
}
EOF

    opencode_sync_mcps_merge \
        "$TEST_TMP_DIR/target" \
        "new-server" \
        '{"type": "stdio", "command": "new-cmd"}' \
        "false"

    local config_file="$TEST_TMP_DIR/target/.opencode/opencode.json"

    local existing_type
    existing_type=$(jq -r '.mcp["existing-server"].type' "$config_file")
    assert_equals "sse" "$existing_type" "existing MCP server should be preserved" || return 1

    local new_type
    new_type=$(jq -r '.mcp["new-server"].type' "$config_file")
    assert_equals "stdio" "$new_type" "new MCP server should be added" || return 1
}

# =============================================================================
# Tests: Model-Map Apply
# =============================================================================

test_model_map_apply_returns_mapped_value() {
    source_opencode_adapter

    local model_map='{"claude-3-sonnet": "anthropic/claude-3-5-sonnet", "gpt-4": "openai/gpt-4o"}'

    local result
    result=$(opencode_apply_model_map "$model_map" "claude-3-sonnet")
    assert_equals "anthropic/claude-3-5-sonnet" "$result" "mapped value should be returned" || return 1
}

test_model_map_apply_returns_original_when_no_mapping() {
    source_opencode_adapter

    local model_map='{"claude-3-sonnet": "anthropic/claude-3-5-sonnet"}'

    local result
    result=$(opencode_apply_model_map "$model_map" "unknown-model")
    assert_equals "unknown-model" "$result" "original value should be returned when no mapping found" || return 1
}

test_model_map_apply_with_empty_map() {
    source_opencode_adapter

    local result
    result=$(opencode_apply_model_map '{}' "any-model")
    assert_equals "any-model" "$result" "original value returned for empty model-map" || return 1
}

# =============================================================================
# Main Test Runner
# =============================================================================

main() {
    echo "=========================================="
    echo "OpenCode Adapter Tests"
    echo "=========================================="

    # Agent Frontmatter Translation
    run_test test_agent_frontmatter_removes_add_skills_and_converts_subagent_type
    run_test test_agent_frontmatter_no_subagent_type_no_mode

    # Rules Sync with Instructions Glob
    run_test test_rules_sync_copies_file_and_updates_instructions_glob
    run_test test_rules_sync_is_idempotent

    # Hooks Skip
    run_test test_hooks_skip_creates_no_files

    # Config Deep Merge
    run_test test_config_deep_merge_preserves_existing_and_adds_new
    run_test test_config_creates_new_file_when_absent

    # MCP Merge
    run_test test_mcps_merge_adds_server_to_opencode_json
    run_test test_mcps_merge_preserves_existing_mcps

    # Model-Map Apply
    run_test test_model_map_apply_returns_mapped_value
    run_test test_model_map_apply_returns_original_when_no_mapping
    run_test test_model_map_apply_with_empty_map

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
}

main "$@"

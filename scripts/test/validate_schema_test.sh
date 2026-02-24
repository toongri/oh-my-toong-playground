#!/bin/bash
# =============================================================================
# Validate Schema Tests - Platforms Field Validation
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
VALIDATE_SCHEMA="$ROOT_DIR/validate-schema.sh"

# Test utilities
TESTS_PASSED=0
TESTS_FAILED=0
CURRENT_TEST=""

setup_test_env() {
    TEST_TMP_DIR=$(mktemp -d)
}

teardown_test_env() {
    if [[ -d "$TEST_TMP_DIR" ]]; then
        rm -rf "$TEST_TMP_DIR"
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

# =============================================================================
# Tests: platforms Field (Top Level - replaces default_targets)
# =============================================================================

test_platforms_valid_single_value() {
    # Create sync.yaml with valid platforms
    cat > "$TEST_TMP_DIR/sync.yaml" << 'EOF'
name: test-project
path: /tmp/test
platforms:
  - claude
EOF

    # Run validation - should pass (exit 0)
    if "$VALIDATE_SCHEMA" "$TEST_TMP_DIR/sync.yaml" 2>/dev/null; then
        return 0
    else
        echo "Validation should pass for valid platforms"
        return 1
    fi
}

test_platforms_valid_multiple_values() {
    cat > "$TEST_TMP_DIR/sync.yaml" << 'EOF'
name: test-project
path: /tmp/test
platforms:
  - claude
  - gemini
  - codex
EOF

    if "$VALIDATE_SCHEMA" "$TEST_TMP_DIR/sync.yaml" 2>/dev/null; then
        return 0
    else
        echo "Validation should pass for multiple valid platforms"
        return 1
    fi
}

test_platforms_invalid_value() {
    cat > "$TEST_TMP_DIR/sync.yaml" << 'EOF'
name: test-project
path: /tmp/test
platforms:
  - invalid_target
EOF

    # Run validation - should fail (exit 1)
    if "$VALIDATE_SCHEMA" "$TEST_TMP_DIR/sync.yaml" 2>/dev/null; then
        echo "Validation should fail for invalid platforms value"
        return 1
    else
        return 0
    fi
}

test_platforms_mixed_valid_invalid() {
    cat > "$TEST_TMP_DIR/sync.yaml" << 'EOF'
name: test-project
path: /tmp/test
platforms:
  - claude
  - unknown
EOF

    if "$VALIDATE_SCHEMA" "$TEST_TMP_DIR/sync.yaml" 2>/dev/null; then
        echo "Validation should fail when any platforms value is invalid"
        return 1
    else
        return 0
    fi
}

test_platforms_empty_array_valid() {
    cat > "$TEST_TMP_DIR/sync.yaml" << 'EOF'
name: test-project
path: /tmp/test
platforms: []
EOF

    if "$VALIDATE_SCHEMA" "$TEST_TMP_DIR/sync.yaml" 2>/dev/null; then
        return 0
    else
        echo "Validation should pass for empty platforms array"
        return 1
    fi
}

# =============================================================================
# Tests: platforms Field in Agents (replaces targets)
# =============================================================================

test_agent_platforms_valid() {
    cat > "$TEST_TMP_DIR/sync.yaml" << 'EOF'
name: test-project
path: /tmp/test
agents:
  items:
    - component: oracle
      platforms:
        - claude
        - gemini
EOF

    if "$VALIDATE_SCHEMA" "$TEST_TMP_DIR/sync.yaml" 2>/dev/null; then
        return 0
    else
        echo "Validation should pass for valid agent platforms"
        return 1
    fi
}

test_agent_platforms_invalid() {
    cat > "$TEST_TMP_DIR/sync.yaml" << 'EOF'
name: test-project
path: /tmp/test
agents:
  items:
    - component: oracle
      platforms:
        - bard
EOF

    if "$VALIDATE_SCHEMA" "$TEST_TMP_DIR/sync.yaml" 2>/dev/null; then
        echo "Validation should fail for invalid agent platforms"
        return 1
    else
        return 0
    fi
}

test_agent_without_platforms_valid() {
    cat > "$TEST_TMP_DIR/sync.yaml" << 'EOF'
name: test-project
path: /tmp/test
agents:
  items:
    - oracle
EOF

    if "$VALIDATE_SCHEMA" "$TEST_TMP_DIR/sync.yaml" 2>/dev/null; then
        return 0
    else
        echo "Validation should pass for agent without platforms (uses top-level default)"
        return 1
    fi
}

# =============================================================================
# Tests: platforms Field in Commands
# =============================================================================

test_command_platforms_valid() {
    cat > "$TEST_TMP_DIR/sync.yaml" << 'EOF'
name: test-project
path: /tmp/test
commands:
  items:
    - component: git-commit
      platforms:
        - codex
EOF

    if "$VALIDATE_SCHEMA" "$TEST_TMP_DIR/sync.yaml" 2>/dev/null; then
        return 0
    else
        echo "Validation should pass for valid command platforms"
        return 1
    fi
}

test_command_platforms_invalid() {
    cat > "$TEST_TMP_DIR/sync.yaml" << 'EOF'
name: test-project
path: /tmp/test
commands:
  items:
    - component: git-commit
      platforms:
        - chatgpt
EOF

    if "$VALIDATE_SCHEMA" "$TEST_TMP_DIR/sync.yaml" 2>/dev/null; then
        echo "Validation should fail for invalid command platforms"
        return 1
    else
        return 0
    fi
}

# =============================================================================
# Tests: platforms Field in Hooks
# =============================================================================

test_hook_platforms_valid() {
    cat > "$TEST_TMP_DIR/sync.yaml" << 'EOF'
name: test-project
path: /tmp/test
hooks:
  items:
    - component: test-hook
      event: PreToolUse
      platforms:
        - claude
EOF

    if "$VALIDATE_SCHEMA" "$TEST_TMP_DIR/sync.yaml" 2>/dev/null; then
        return 0
    else
        echo "Validation should pass for valid hook platforms"
        return 1
    fi
}

test_hook_platforms_invalid() {
    cat > "$TEST_TMP_DIR/sync.yaml" << 'EOF'
name: test-project
path: /tmp/test
hooks:
  items:
    - component: test-hook
      event: PreToolUse
      platforms:
        - gpt4
EOF

    if "$VALIDATE_SCHEMA" "$TEST_TMP_DIR/sync.yaml" 2>/dev/null; then
        echo "Validation should fail for invalid hook platforms"
        return 1
    else
        return 0
    fi
}

# =============================================================================
# Tests: platforms Field in Skills
# =============================================================================

test_skill_platforms_valid() {
    cat > "$TEST_TMP_DIR/sync.yaml" << 'EOF'
name: test-project
path: /tmp/test
skills:
  items:
    - component: tdd
      platforms:
        - gemini
        - codex
EOF

    if "$VALIDATE_SCHEMA" "$TEST_TMP_DIR/sync.yaml" 2>/dev/null; then
        return 0
    else
        echo "Validation should pass for valid skill platforms"
        return 1
    fi
}

test_skill_platforms_invalid() {
    cat > "$TEST_TMP_DIR/sync.yaml" << 'EOF'
name: test-project
path: /tmp/test
skills:
  items:
    - component: tdd
      platforms:
        - anthropic
EOF

    if "$VALIDATE_SCHEMA" "$TEST_TMP_DIR/sync.yaml" 2>/dev/null; then
        echo "Validation should fail for invalid skill platforms"
        return 1
    else
        return 0
    fi
}

# =============================================================================
# Tests: CLI-Specific Limitation Warnings
# =============================================================================

test_warns_gemini_agents_fallback() {
    cat > "$TEST_TMP_DIR/sync.yaml" << 'EOF'
name: test-project
path: /tmp/test
agents:
  items:
    - component: oracle
      platforms:
        - gemini
EOF

    # Run validation and capture stderr for warning message
    local output
    output=$("$VALIDATE_SCHEMA" "$TEST_TMP_DIR/sync.yaml" 2>&1) || true

    # Should contain warning about gemini agents fallback
    if echo "$output" | grep -q "Gemini.*agents.*fallback\|GEMINI.md"; then
        return 0
    else
        echo "Expected warning about Gemini agents fallback, got: $output"
        return 1
    fi
}

test_warns_codex_agents_fallback() {
    cat > "$TEST_TMP_DIR/sync.yaml" << 'EOF'
name: test-project
path: /tmp/test
agents:
  items:
    - component: oracle
      platforms:
        - codex
EOF

    local output
    output=$("$VALIDATE_SCHEMA" "$TEST_TMP_DIR/sync.yaml" 2>&1) || true

    # Should contain warning about codex agents fallback
    if echo "$output" | grep -q "Codex.*agents.*fallback\|AGENTS.md"; then
        return 0
    else
        echo "Expected warning about Codex agents fallback, got: $output"
        return 1
    fi
}

test_warns_codex_hooks_limited() {
    cat > "$TEST_TMP_DIR/sync.yaml" << 'EOF'
name: test-project
path: /tmp/test
hooks:
  items:
    - component: test-hook
      event: PreToolUse
      platforms:
        - codex
EOF

    local output
    output=$("$VALIDATE_SCHEMA" "$TEST_TMP_DIR/sync.yaml" 2>&1) || true

    # Should contain warning about codex hooks limitation
    if echo "$output" | grep -q "Codex.*Notification\|codex.*hook.*skip"; then
        return 0
    else
        echo "Expected warning about Codex hooks limitation, got: $output"
        return 1
    fi
}

test_warns_codex_commands_global() {
    cat > "$TEST_TMP_DIR/sync.yaml" << 'EOF'
name: test-project
path: /tmp/test
commands:
  items:
    - component: git-commit
      platforms:
        - codex
EOF

    local output
    output=$("$VALIDATE_SCHEMA" "$TEST_TMP_DIR/sync.yaml" 2>&1) || true

    # Should contain warning about codex commands being global
    if echo "$output" | grep -q "Codex.*commands.*global\|\.codex/prompts"; then
        return 0
    else
        echo "Expected warning about Codex commands global path, got: $output"
        return 1
    fi
}

test_no_warning_for_claude_native() {
    cat > "$TEST_TMP_DIR/sync.yaml" << 'EOF'
name: test-project
path: /tmp/test
agents:
  items:
    - component: oracle
      platforms:
        - claude
commands:
  items:
    - component: git-commit
      platforms:
        - claude
hooks:
  items:
    - component: test-hook
      event: PreToolUse
      platforms:
        - claude
skills:
  items:
    - component: tdd
      platforms:
        - claude
EOF

    local output
    output=$("$VALIDATE_SCHEMA" "$TEST_TMP_DIR/sync.yaml" 2>&1) || true

    # Should NOT contain any CLI limitation warnings for Claude
    if echo "$output" | grep -qi "fallback\|limited\|global\|skip"; then
        echo "Should not have any limitation warnings for claude-only platforms, got: $output"
        return 1
    else
        return 0
    fi
}

# =============================================================================
# Tests: Backward Compatibility
# =============================================================================

test_sync_yaml_without_platforms_valid() {
    cat > "$TEST_TMP_DIR/sync.yaml" << 'EOF'
name: test-project
path: /tmp/test
agents:
  items:
    - oracle
commands:
  items:
    - git-commit
hooks:
  items:
    - component: test-hook
      event: PreToolUse
skills:
  items:
    - tdd
EOF

    if "$VALIDATE_SCHEMA" "$TEST_TMP_DIR/sync.yaml" 2>/dev/null; then
        return 0
    else
        echo "Validation should pass for sync.yaml without any platforms fields"
        return 1
    fi
}

# =============================================================================
# Tests: mcps Section Validation
# =============================================================================

test_mcps_valid() {
    cat > "$TEST_TMP_DIR/sync.yaml" << 'EOF'
name: test-project
path: /tmp/test
mcps:
  items:
    - context7
    - component: custom-server
EOF

    if "$VALIDATE_SCHEMA" "$TEST_TMP_DIR/sync.yaml" 2>/dev/null; then
        return 0
    else
        echo "Validation should pass for valid mcps section"
        return 1
    fi
}

test_mcps_string_shorthand() {
    cat > "$TEST_TMP_DIR/sync.yaml" << 'EOF'
name: test-project
path: /tmp/test
mcps:
  items:
    - my-server
EOF

    if "$VALIDATE_SCHEMA" "$TEST_TMP_DIR/sync.yaml" 2>/dev/null; then
        return 0
    else
        echo "Validation should pass for string shorthand in mcps items"
        return 1
    fi
}

test_mcps_invalid_item_field() {
    cat > "$TEST_TMP_DIR/sync.yaml" << 'EOF'
name: test-project
path: /tmp/test
mcps:
  items:
    - component: test-server
      unknown_field: value
EOF

    if "$VALIDATE_SCHEMA" "$TEST_TMP_DIR/sync.yaml" 2>/dev/null; then
        echo "Validation should fail for unknown field in mcps item"
        return 1
    else
        return 0
    fi
}

# =============================================================================
# Tests: plugins Section Validation
# =============================================================================

test_plugins_valid() {
    cat > "$TEST_TMP_DIR/sync.yaml" << 'EOF'
name: test-project
path: /tmp/test
plugins:
  items:
    - name: my-plugin
      platforms:
        - claude
EOF

    if "$VALIDATE_SCHEMA" "$TEST_TMP_DIR/sync.yaml" 2>/dev/null; then
        return 0
    else
        echo "Validation should pass for valid plugins section"
        return 1
    fi
}

test_plugins_string_shorthand() {
    cat > "$TEST_TMP_DIR/sync.yaml" << 'EOF'
name: test-project
path: /tmp/test
plugins:
  items:
    - my-plugin
EOF

    if "$VALIDATE_SCHEMA" "$TEST_TMP_DIR/sync.yaml" 2>/dev/null; then
        return 0
    else
        echo "Validation should pass for string shorthand in plugins items"
        return 1
    fi
}

test_plugins_missing_name() {
    cat > "$TEST_TMP_DIR/sync.yaml" << 'EOF'
name: test-project
path: /tmp/test
plugins:
  items:
    - platforms:
        - claude
EOF

    if "$VALIDATE_SCHEMA" "$TEST_TMP_DIR/sync.yaml" 2>/dev/null; then
        echo "Validation should fail for plugin object without name"
        return 1
    else
        return 0
    fi
}

# =============================================================================
# Tests: config Section Validation
# =============================================================================

test_config_valid_platforms() {
    cat > "$TEST_TMP_DIR/sync.yaml" << 'EOF'
name: test-project
path: /tmp/test
config:
  claude:
    language: "Korean"
  gemini:
    general:
      model: "gemini-2.5-pro"
  codex:
    model: "o3"
EOF

    if "$VALIDATE_SCHEMA" "$TEST_TMP_DIR/sync.yaml" 2>/dev/null; then
        return 0
    else
        echo "Validation should pass for valid config with claude/gemini/codex"
        return 1
    fi
}

test_config_invalid_platform() {
    cat > "$TEST_TMP_DIR/sync.yaml" << 'EOF'
name: test-project
path: /tmp/test
config:
  vscode:
    theme: "dark"
EOF

    if "$VALIDATE_SCHEMA" "$TEST_TMP_DIR/sync.yaml" 2>/dev/null; then
        echo "Validation should fail for invalid platform in config"
        return 1
    else
        return 0
    fi
}

test_config_unknown_field_warns() {
    cat > "$TEST_TMP_DIR/sync.yaml" << 'EOF'
name: test-project
path: /tmp/test
config:
  claude:
    unknownSettingsField: "value"
EOF

    # Unknown field should produce warning but exit 0
    local output
    output=$("$VALIDATE_SCHEMA" "$TEST_TMP_DIR/sync.yaml" 2>&1)
    local exit_code=$?

    if [[ $exit_code -eq 0 ]]; then
        if echo "$output" | grep -q "알 수 없는 필드"; then
            return 0
        else
            echo "Should warn about unknown field, got: $output"
            return 1
        fi
    else
        echo "Should exit 0 for unknown field warning, exited: $exit_code"
        return 1
    fi
}

test_config_type_mismatch_errors() {
    cat > "$TEST_TMP_DIR/sync.yaml" << 'EOF'
name: test-project
path: /tmp/test
config:
  claude:
    language: 123
EOF

    if "$VALIDATE_SCHEMA" "$TEST_TMP_DIR/sync.yaml" 2>/dev/null; then
        echo "Validation should fail for type mismatch (language should be string)"
        return 1
    else
        return 0
    fi
}

test_config_reserved_field_warns() {
    cat > "$TEST_TMP_DIR/sync.yaml" << 'EOF'
name: test-project
path: /tmp/test
config:
  claude:
    hooks:
      PreToolUse: []
EOF

    # Reserved field should produce warning but exit 0
    local output
    output=$("$VALIDATE_SCHEMA" "$TEST_TMP_DIR/sync.yaml" 2>&1)
    local exit_code=$?

    if [[ $exit_code -eq 0 ]]; then
        if echo "$output" | grep -q "예약된 필드"; then
            return 0
        else
            echo "Should warn about reserved field, got: $output"
            return 1
        fi
    else
        echo "Should exit 0 for reserved field warning, exited: $exit_code"
        return 1
    fi
}

# =============================================================================
# Main Test Runner
# =============================================================================

main() {
    echo "=========================================="
    echo "Validate Schema Tests - Platforms Field"
    echo "=========================================="

    # Top-level platforms tests
    run_test test_platforms_valid_single_value
    run_test test_platforms_valid_multiple_values
    run_test test_platforms_invalid_value
    run_test test_platforms_mixed_valid_invalid
    run_test test_platforms_empty_array_valid

    # Agent platforms tests
    run_test test_agent_platforms_valid
    run_test test_agent_platforms_invalid
    run_test test_agent_without_platforms_valid

    # Command platforms tests
    run_test test_command_platforms_valid
    run_test test_command_platforms_invalid

    # Hook platforms tests
    run_test test_hook_platforms_valid
    run_test test_hook_platforms_invalid

    # Skill platforms tests
    run_test test_skill_platforms_valid
    run_test test_skill_platforms_invalid

    # CLI-Specific Limitation Warnings
    run_test test_warns_gemini_agents_fallback
    run_test test_warns_codex_agents_fallback
    run_test test_warns_codex_hooks_limited
    run_test test_warns_codex_commands_global
    run_test test_no_warning_for_claude_native

    # Backward compatibility
    run_test test_sync_yaml_without_platforms_valid

    # MCP section validation
    run_test test_mcps_valid
    run_test test_mcps_string_shorthand
    run_test test_mcps_invalid_item_field

    # Plugin section validation
    run_test test_plugins_valid
    run_test test_plugins_string_shorthand
    run_test test_plugins_missing_name

    # Config section validation
    run_test test_config_valid_platforms
    run_test test_config_invalid_platform
    run_test test_config_unknown_field_warns
    run_test test_config_type_mismatch_errors
    run_test test_config_reserved_field_warns

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
}

main "$@"

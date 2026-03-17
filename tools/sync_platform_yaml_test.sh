#!/bin/bash
# =============================================================================
# Per-Platform YAML Integration Tests
# Tests for sync_platform_configs and per-platform YAML processing logic
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$SCRIPT_DIR"
# Immutable path to sync.sh — captured before any sourcing may override $SCRIPT_DIR
TEST_SYNC_SH_PATH="$SCRIPT_DIR/sync.sh"

# Test utilities
TESTS_PASSED=0
TESTS_FAILED=0
TEST_TMP_DIR=""

setup_test_env() {
    TEST_TMP_DIR=$(mktemp -d)
    mkdir -p "$TEST_TMP_DIR/target"
    mkdir -p "$TEST_TMP_DIR/source"
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

# Source sync.sh functions (without running main) for use in tests.
# Same technique as sync_test.sh: strip last line, fix absolute source paths.
SYNC_FUNCTIONS_SOURCED=false
source_sync_functions() {
    if [[ "$SYNC_FUNCTIONS_SOURCED" == "true" ]]; then
        return 0
    fi

    local tools_dir="$ROOT_DIR"
    local tmp_script
    tmp_script=$(mktemp)

    local line_count
    line_count=$(wc -l < "$tools_dir/sync.sh" | tr -d ' ')
    local lines_to_keep=$((line_count - 1))

    head -n "$lines_to_keep" "$tools_dir/sync.sh" > "$tmp_script"

    sed -i '' "s|source \"\${SCRIPT_DIR}/|source \"${tools_dir}/|g" "$tmp_script"

    source "$tmp_script"
    rm -f "$tmp_script"

    SYNC_FUNCTIONS_SOURCED=true
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
# Tests: Platform YAML Detection
# =============================================================================

test_platform_yaml_detection_sets_claude_sections() {
    source_sync_functions

    # Create a claude.yaml with a config section
    mkdir -p "$TEST_TMP_DIR/yaml_dir"
    cat > "$TEST_TMP_DIR/yaml_dir/claude.yaml" << 'EOF'
config:
  theme: dark
EOF

    # Create target .claude directory (expected by claude_sync_config)
    mkdir -p "$TEST_TMP_DIR/target/.claude"

    # Reset state
    PLATFORM_YAML_SECTIONS_CLAUDE=""
    DRY_RUN=false

    sync_platform_configs "$TEST_TMP_DIR/target" "$TEST_TMP_DIR/yaml_dir"

    # PLATFORM_YAML_SECTIONS_CLAUDE should contain "config"
    if [[ "$PLATFORM_YAML_SECTIONS_CLAUDE" == *"config"* ]]; then
        return 0
    else
        echo "ASSERTION FAILED: PLATFORM_YAML_SECTIONS_CLAUDE should contain 'config'"
        echo "  Actual: '$PLATFORM_YAML_SECTIONS_CLAUDE'"
        return 1
    fi
}

test_platform_yaml_detection_no_file_means_empty_sections() {
    source_sync_functions

    # No platform YAML files exist — yaml_dir is empty
    mkdir -p "$TEST_TMP_DIR/yaml_dir"

    PLATFORM_YAML_SECTIONS_CLAUDE="previous-value"
    PLATFORM_YAML_SECTIONS_GEMINI=""
    PLATFORM_YAML_SECTIONS_CODEX=""
    PLATFORM_YAML_SECTIONS_OPENCODE=""
    DRY_RUN=false

    sync_platform_configs "$TEST_TMP_DIR/target" "$TEST_TMP_DIR/yaml_dir"

    # All sections should be reset to empty
    assert_equals "" "$PLATFORM_YAML_SECTIONS_CLAUDE" "claude sections should be empty when no claude.yaml" || return 1
    assert_equals "" "$PLATFORM_YAML_SECTIONS_GEMINI" "gemini sections should be empty when no gemini.yaml" || return 1
}

# =============================================================================
# Tests: Deprecation Warning
# =============================================================================

test_deprecation_warning_emitted_when_sync_yaml_and_platform_yaml_both_have_config() {
    source_sync_functions

    # Create a sync.yaml with a config section
    cat > "$TEST_TMP_DIR/sync.yaml" << 'EOF'
path: __REPLACED__
config:
  theme: light
EOF
    # Replace path placeholder with real target
    sed -i '' "s|__REPLACED__|$TEST_TMP_DIR/target|g" "$TEST_TMP_DIR/sync.yaml"

    # Create a claude.yaml with a config section alongside sync.yaml
    cat > "$TEST_TMP_DIR/claude.yaml" << 'EOF'
config:
  theme: dark
EOF

    # Create required project file for process_yaml validation
    touch "$TEST_TMP_DIR/target/CLAUDE.md"
    mkdir -p "$TEST_TMP_DIR/target/.claude"

    DRY_RUN=false
    CURRENT_BACKUP_SESSION=""
    CURRENT_PROJECT_NAME=""

    # Capture output from process_yaml (deprecation warning goes to stdout via log_warn)
    local output
    output=$(process_yaml "$TEST_TMP_DIR/sync.yaml" "true" 2>&1) || true

    if echo "$output" | grep -q "DEPRECATED\|deprecated\|Deprecated"; then
        return 0
    else
        echo "ASSERTION FAILED: Deprecation warning should be emitted when both sync.yaml and platform YAML have config"
        echo "  Output: $output"
        return 1
    fi
}

test_no_deprecation_warning_when_only_platform_yaml_has_config() {
    source_sync_functions

    # Create a sync.yaml WITHOUT a config section
    cat > "$TEST_TMP_DIR/sync.yaml" << 'EOF'
path: __REPLACED__
EOF
    sed -i '' "s|__REPLACED__|$TEST_TMP_DIR/target|g" "$TEST_TMP_DIR/sync.yaml"

    # Create a claude.yaml with config
    cat > "$TEST_TMP_DIR/claude.yaml" << 'EOF'
config:
  theme: dark
EOF

    touch "$TEST_TMP_DIR/target/CLAUDE.md"
    mkdir -p "$TEST_TMP_DIR/target/.claude"

    DRY_RUN=false
    CURRENT_BACKUP_SESSION=""
    CURRENT_PROJECT_NAME=""

    local output
    output=$(process_yaml "$TEST_TMP_DIR/sync.yaml" "true" 2>&1) || true

    if echo "$output" | grep -q "DEPRECATED\|deprecated\|Deprecated"; then
        echo "ASSERTION FAILED: No deprecation warning should appear when only platform YAML has config"
        echo "  Output: $output"
        return 1
    fi
    return 0
}

# =============================================================================
# Tests: Backward Compatibility (no platform YAML = no warnings)
# =============================================================================

test_backward_compat_no_platform_yaml_no_warnings() {
    source_sync_functions

    # sync.yaml only — no platform YAML files
    cat > "$TEST_TMP_DIR/sync.yaml" << 'EOF'
path: __REPLACED__
EOF
    sed -i '' "s|__REPLACED__|$TEST_TMP_DIR/target|g" "$TEST_TMP_DIR/sync.yaml"

    touch "$TEST_TMP_DIR/target/CLAUDE.md"
    mkdir -p "$TEST_TMP_DIR/target/.claude"

    DRY_RUN=false
    CURRENT_BACKUP_SESSION=""
    CURRENT_PROJECT_NAME=""

    local output
    output=$(process_yaml "$TEST_TMP_DIR/sync.yaml" "true" 2>&1) || true

    if echo "$output" | grep -q "DEPRECATED\|deprecated\|Deprecated"; then
        echo "ASSERTION FAILED: No deprecation warning expected when no platform YAML exists"
        echo "  Output: $output"
        return 1
    fi
    return 0
}

# =============================================================================
# Tests: Model-Map in codex.yaml
# =============================================================================

test_codex_yaml_model_map_sets_global_variable() {
    source_sync_functions

    mkdir -p "$TEST_TMP_DIR/yaml_dir"
    cat > "$TEST_TMP_DIR/yaml_dir/codex.yaml" << 'EOF'
model-map:
  claude-3-sonnet: openai/gpt-4o
  claude-opus-4: openai/gpt-4o-mini
EOF

    # Ensure target exists
    mkdir -p "$TEST_TMP_DIR/target"

    CODEX_MODEL_MAP_JSON=""
    DRY_RUN=false

    # Call codex_sync_platform_yaml directly (not via subshell) so CODEX_MODEL_MAP_JSON
    # is set in the current shell. Redirect stdout since we don't need the returned sections here.
    codex_sync_platform_yaml "$TEST_TMP_DIR/target" "$TEST_TMP_DIR/yaml_dir/codex.yaml" "false" > /dev/null 2>&1

    if [[ -z "$CODEX_MODEL_MAP_JSON" || "$CODEX_MODEL_MAP_JSON" == "null" ]]; then
        echo "ASSERTION FAILED: CODEX_MODEL_MAP_JSON should be set after codex_sync_platform_yaml with model-map"
        echo "  Actual: '$CODEX_MODEL_MAP_JSON'"
        return 1
    fi

    # Verify the JSON contains expected mapping
    local mapped
    mapped=$(echo "$CODEX_MODEL_MAP_JSON" | jq -r '."claude-3-sonnet"')
    assert_equals "openai/gpt-4o" "$mapped" "model-map should map claude-3-sonnet to openai/gpt-4o" || return 1
}

test_codex_yaml_model_map_sections_include_model_map() {
    source_sync_functions

    mkdir -p "$TEST_TMP_DIR/yaml_dir"
    cat > "$TEST_TMP_DIR/yaml_dir/codex.yaml" << 'EOF'
model-map:
  claude-opus-4: openai/gpt-4o
EOF

    mkdir -p "$TEST_TMP_DIR/target"
    CODEX_MODEL_MAP_JSON=""
    DRY_RUN=false

    sync_platform_configs "$TEST_TMP_DIR/target" "$TEST_TMP_DIR/yaml_dir"

    if [[ "$PLATFORM_YAML_SECTIONS_CODEX" == *"model-map"* ]]; then
        return 0
    else
        echo "ASSERTION FAILED: PLATFORM_YAML_SECTIONS_CODEX should contain 'model-map'"
        echo "  Actual: '$PLATFORM_YAML_SECTIONS_CODEX'"
        return 1
    fi
}

# =============================================================================
# Tests: Hook Processing via claude.yaml
# =============================================================================

test_claude_yaml_hooks_registered_in_settings_json() {
    source_sync_functions

    mkdir -p "$TEST_TMP_DIR/yaml_dir"
    # Use a command-type hook with explicit command (no component resolution needed)
    cat > "$TEST_TMP_DIR/yaml_dir/claude.yaml" << 'EOF'
hooks:
  UserPromptSubmit:
    - command: echo hello
      type: command
      timeout: 5
  Stop:
    - command: echo bye
      type: command
      timeout: 5
EOF

    mkdir -p "$TEST_TMP_DIR/target/.claude"
    DRY_RUN=false

    # Call claude_sync_platform_yaml directly (it returns processed sections on stdout,
    # writes to stderr — redirect stderr to /dev/null for clean test)
    local sections
    sections=$(claude_sync_platform_yaml "$TEST_TMP_DIR/target" "$TEST_TMP_DIR/yaml_dir/claude.yaml" "false" 2>/dev/null) || true

    local settings_file="$TEST_TMP_DIR/target/.claude/settings.json"
    assert_file_exists "$settings_file" "settings.json should be created by hook processing" || return 1
    assert_file_contains "$settings_file" "UserPromptSubmit" "settings.json should contain UserPromptSubmit hook" || return 1
    assert_file_contains "$settings_file" "Stop" "settings.json should contain Stop hook" || return 1
}

test_claude_yaml_hooks_sections_include_hooks() {
    source_sync_functions

    mkdir -p "$TEST_TMP_DIR/yaml_dir"
    cat > "$TEST_TMP_DIR/yaml_dir/claude.yaml" << 'EOF'
hooks:
  UserPromptSubmit:
    - command: echo hello
      type: command
      timeout: 5
EOF

    mkdir -p "$TEST_TMP_DIR/target/.claude"
    DRY_RUN=false

    local sections
    sections=$(claude_sync_platform_yaml "$TEST_TMP_DIR/target" "$TEST_TMP_DIR/yaml_dir/claude.yaml" "false" 2>/dev/null) || true

    if [[ "$sections" == *"hooks"* ]]; then
        return 0
    else
        echo "ASSERTION FAILED: returned sections should include 'hooks'"
        echo "  Actual: '$sections'"
        return 1
    fi
}

test_claude_yaml_config_creates_settings_json() {
    source_sync_functions

    mkdir -p "$TEST_TMP_DIR/yaml_dir"
    cat > "$TEST_TMP_DIR/yaml_dir/claude.yaml" << 'EOF'
config:
  theme: dark
  autoUpdaterStatus: disabled
EOF

    mkdir -p "$TEST_TMP_DIR/target/.claude"
    DRY_RUN=false

    local sections
    sections=$(claude_sync_platform_yaml "$TEST_TMP_DIR/target" "$TEST_TMP_DIR/yaml_dir/claude.yaml" "false" 2>/dev/null) || true

    if [[ "$sections" == *"config"* ]]; then
        return 0
    else
        echo "ASSERTION FAILED: returned sections should include 'config'"
        echo "  Actual: '$sections'"
        return 1
    fi
}

# =============================================================================
# Tests: sync_platform_configs Function Exists in sync.sh
# =============================================================================

test_sync_sh_has_sync_platform_configs() {
    if grep -E '^sync_platform_configs\(\)' "$TEST_SYNC_SH_PATH" >/dev/null 2>&1; then
        return 0
    else
        echo "ASSERTION FAILED: sync_platform_configs() should exist in sync.sh"
        return 1
    fi
}

test_sync_sh_sources_opencode_adapter() {
    if grep -q 'source.*adapters/opencode.sh' "$TEST_SYNC_SH_PATH"; then
        return 0
    else
        echo "ASSERTION FAILED: sync.sh should source adapters/opencode.sh"
        return 1
    fi
}

test_sync_sh_has_platform_yaml_sections_opencode_variable() {
    if grep -q 'PLATFORM_YAML_SECTIONS_OPENCODE' "$TEST_SYNC_SH_PATH"; then
        return 0
    else
        echo "ASSERTION FAILED: sync.sh should have PLATFORM_YAML_SECTIONS_OPENCODE variable"
        return 1
    fi
}

test_sync_sh_has_opencode_model_map_json_variable() {
    if grep -q 'OPENCODE_MODEL_MAP_JSON' "$TEST_SYNC_SH_PATH"; then
        return 0
    else
        echo "ASSERTION FAILED: sync.sh should have OPENCODE_MODEL_MAP_JSON variable"
        return 1
    fi
}

# =============================================================================
# Main Test Runner
# =============================================================================

main() {
    echo "=========================================="
    echo "Per-Platform YAML Integration Tests"
    echo "=========================================="

    # Platform YAML Detection
    run_test test_platform_yaml_detection_sets_claude_sections
    run_test test_platform_yaml_detection_no_file_means_empty_sections

    # Deprecation Warning
    run_test test_deprecation_warning_emitted_when_sync_yaml_and_platform_yaml_both_have_config
    run_test test_no_deprecation_warning_when_only_platform_yaml_has_config

    # Backward Compatibility
    run_test test_backward_compat_no_platform_yaml_no_warnings

    # Model-Map in codex.yaml
    run_test test_codex_yaml_model_map_sets_global_variable
    run_test test_codex_yaml_model_map_sections_include_model_map

    # Hook Processing via claude.yaml
    run_test test_claude_yaml_hooks_registered_in_settings_json
    run_test test_claude_yaml_hooks_sections_include_hooks
    run_test test_claude_yaml_config_creates_settings_json

    # sync.sh Structure
    run_test test_sync_sh_has_sync_platform_configs
    run_test test_sync_sh_sources_opencode_adapter
    run_test test_sync_sh_has_platform_yaml_sections_opencode_variable
    run_test test_sync_sh_has_opencode_model_map_json_variable

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
}

main "$@"

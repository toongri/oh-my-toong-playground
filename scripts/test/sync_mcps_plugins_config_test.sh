#!/bin/bash
# =============================================================================
# Sync MCP/Plugin/Config E2E Tests
# Tests for MCP server merge, plugin install, and config passthrough
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"

# Source adapters (they include fallback logging)
source "$ROOT_DIR/scripts/lib/common.sh"
source "$ROOT_DIR/scripts/adapters/claude.sh"
source "$ROOT_DIR/scripts/adapters/gemini.sh"
source "$ROOT_DIR/scripts/adapters/codex.sh"

# Test utilities
TESTS_PASSED=0
TESTS_FAILED=0
CURRENT_TEST=""

setup_test_env() {
    TEST_TMP_DIR=$(mktemp -d)

    # Create target project directory
    mkdir -p "$TEST_TMP_DIR/target"

    # Create source structure
    mkdir -p "$TEST_TMP_DIR/mcps"
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
# Tests: MCP - Claude (.mcp.json)
# =============================================================================

test_mcp_claude_mcp_json_creation() {
    # .mcp.json created from scratch with correct structure
    local target_path="$TEST_TMP_DIR/target"
    local server_json='{"command":"npx","args":["-y","@upstash/context7-mcp@latest"]}'

    claude_sync_mcps_merge "$target_path" "context7" "$server_json" "false"

    # Verify .mcp.json exists
    if [[ ! -f "$target_path/.mcp.json" ]]; then
        echo "ASSERTION FAILED: .mcp.json should be created"
        return 1
    fi

    # Verify structure
    local server_cmd
    server_cmd=$(jq -r '.mcpServers.context7.command' "$target_path/.mcp.json")
    if [[ "$server_cmd" != "npx" ]]; then
        echo "ASSERTION FAILED: Expected command 'npx', got '$server_cmd'"
        return 1
    fi

    return 0
}

test_mcp_claude_merge_preserves_existing() {
    # existing non-sync servers preserved
    local target_path="$TEST_TMP_DIR/target"

    # Create existing .mcp.json with a pre-existing server
    cat > "$target_path/.mcp.json" << 'EOF'
{
  "mcpServers": {
    "existing-server": {
      "command": "node",
      "args": ["server.js"]
    }
  }
}
EOF

    local server_json='{"command":"npx","args":["-y","@upstash/context7-mcp@latest"]}'
    claude_sync_mcps_merge "$target_path" "context7" "$server_json" "false"

    # Verify both servers exist
    local existing_cmd
    existing_cmd=$(jq -r '.mcpServers."existing-server".command' "$target_path/.mcp.json")
    if [[ "$existing_cmd" != "node" ]]; then
        echo "ASSERTION FAILED: Existing server should be preserved, got command '$existing_cmd'"
        return 1
    fi

    local new_cmd
    new_cmd=$(jq -r '.mcpServers.context7.command' "$target_path/.mcp.json")
    if [[ "$new_cmd" != "npx" ]]; then
        echo "ASSERTION FAILED: New server should be added, got command '$new_cmd'"
        return 1
    fi

    return 0
}

# =============================================================================
# Tests: MCP - Gemini (.gemini/settings.json)
# =============================================================================

test_mcp_gemini_merge() {
    # mcpServers merged into .gemini/settings.json
    local target_path="$TEST_TMP_DIR/target"

    # Create existing gemini settings with some config
    mkdir -p "$target_path/.gemini"
    echo '{"theme": "dark"}' > "$target_path/.gemini/settings.json"

    local server_json='{"command":"npx","args":["-y","@upstash/context7-mcp@latest"]}'
    gemini_sync_mcps_merge "$target_path" "context7" "$server_json" "false"

    # Verify merge
    local theme
    theme=$(jq -r '.theme' "$target_path/.gemini/settings.json")
    if [[ "$theme" != "dark" ]]; then
        echo "ASSERTION FAILED: Existing theme should be preserved"
        return 1
    fi

    local server_cmd
    server_cmd=$(jq -r '.mcpServers.context7.command' "$target_path/.gemini/settings.json")
    if [[ "$server_cmd" != "npx" ]]; then
        echo "ASSERTION FAILED: MCP server should be merged"
        return 1
    fi

    return 0
}

# =============================================================================
# Tests: MCP - Codex (config.toml managed block)
# =============================================================================

test_mcp_codex_toml_write() {
    # [mcp_servers.*] written in managed block
    local target_path="$TEST_TMP_DIR/target"
    mkdir -p "$target_path/.codex"

    # Set required global variables for codex_write_mcp_managed_block
    local SAVE_ROOT_DIR="${ROOT_DIR:-}"
    local SAVE_CURRENT_BACKUP_SESSION="${CURRENT_BACKUP_SESSION:-}"
    local SAVE_CURRENT_PROJECT_NAME="${CURRENT_PROJECT_NAME:-}"
    ROOT_DIR="$TEST_TMP_DIR"
    CURRENT_BACKUP_SESSION="test_session"
    CURRENT_PROJECT_NAME=""

    # Reset accumulator and add a server
    CODEX_MCP_SERVERS_JSON="{}"
    codex_accumulate_mcp_server "context7" '{"command":"npx","args":["-y","@upstash/context7-mcp@latest"]}'

    # Write the managed block
    codex_write_mcp_managed_block "$target_path" "false"

    # Restore globals
    ROOT_DIR="$SAVE_ROOT_DIR"
    CURRENT_BACKUP_SESSION="$SAVE_CURRENT_BACKUP_SESSION"
    CURRENT_PROJECT_NAME="$SAVE_CURRENT_PROJECT_NAME"

    # Verify config.toml contains managed block
    if [[ ! -f "$target_path/.codex/config.toml" ]]; then
        echo "ASSERTION FAILED: config.toml should be created"
        return 1
    fi

    if ! grep -q "# --- omt:mcp ---" "$target_path/.codex/config.toml"; then
        echo "ASSERTION FAILED: Should contain omt:mcp managed block start"
        return 1
    fi

    if ! grep -q "mcp_servers.context7" "$target_path/.codex/config.toml"; then
        echo "ASSERTION FAILED: Should contain [mcp_servers.context7] section"
        return 1
    fi

    if ! grep -q "# --- end omt:mcp ---" "$target_path/.codex/config.toml"; then
        echo "ASSERTION FAILED: Should contain omt:mcp managed block end"
        return 1
    fi

    return 0
}

# =============================================================================
# Tests: MCP - Dry Run
# =============================================================================

test_mcp_dry_run() {
    # dry-run outputs log without file changes
    local target_path="$TEST_TMP_DIR/target"

    local output
    output=$(claude_sync_mcps_merge "$target_path" "context7" '{"command":"npx"}' "true" 2>&1)

    # .mcp.json should NOT be created
    if [[ -f "$target_path/.mcp.json" ]]; then
        echo "ASSERTION FAILED: .mcp.json should NOT be created in dry-run mode"
        return 1
    fi

    # Output should contain dry-run marker
    if echo "$output" | grep -qi "DRY-RUN\|dry.run"; then
        return 0
    else
        echo "ASSERTION FAILED: Output should contain dry-run marker, got: $output"
        return 1
    fi
}

# =============================================================================
# Tests: Plugin - Dry Run
# =============================================================================

test_plugin_dry_run() {
    # dry-run outputs "claude plugin install" log without actually running
    local output
    output=$(claude_sync_plugin_install "my-awesome-plugin" "true" 2>&1)

    # Output should contain dry-run marker with plugin name
    if echo "$output" | grep -qi "DRY-RUN.*plugin.*my-awesome-plugin\|DRY-RUN.*my-awesome-plugin"; then
        return 0
    else
        echo "ASSERTION FAILED: Dry-run output should mention plugin install, got: $output"
        return 1
    fi
}

test_plugin_string_shorthand() {
    # string item works as plugin name (test the dry-run path only)
    local output
    output=$(claude_sync_plugin_install "string-shorthand-plugin" "true" 2>&1)

    if echo "$output" | grep -q "string-shorthand-plugin"; then
        return 0
    else
        echo "ASSERTION FAILED: Output should contain plugin name, got: $output"
        return 1
    fi
}

# =============================================================================
# Tests: Config - Claude (settings.local.json)
# =============================================================================

test_config_claude_settings_local() {
    # config merged into .claude/settings.local.json
    local target_path="$TEST_TMP_DIR/target"

    local config_json='{"language":"Korean","outputStyle":"Explanatory"}'
    claude_sync_config "$target_path" "$config_json" "false"

    # Verify settings.local.json exists
    if [[ ! -f "$target_path/.claude/settings.local.json" ]]; then
        echo "ASSERTION FAILED: settings.local.json should be created"
        return 1
    fi

    local lang
    lang=$(jq -r '.language' "$target_path/.claude/settings.local.json")
    if [[ "$lang" != "Korean" ]]; then
        echo "ASSERTION FAILED: Expected language 'Korean', got '$lang'"
        return 1
    fi

    return 0
}

test_config_claude_preserves_existing() {
    # existing fields preserved in settings.local.json
    local target_path="$TEST_TMP_DIR/target"

    mkdir -p "$target_path/.claude"
    echo '{"model":"claude-3-opus","language":"English"}' > "$target_path/.claude/settings.local.json"

    local config_json='{"language":"Korean"}'
    claude_sync_config "$target_path" "$config_json" "false"

    # Verify model is preserved
    local model
    model=$(jq -r '.model' "$target_path/.claude/settings.local.json")
    if [[ "$model" != "claude-3-opus" ]]; then
        echo "ASSERTION FAILED: Existing model should be preserved, got '$model'"
        return 1
    fi

    # Verify language is overwritten by new config
    local lang
    lang=$(jq -r '.language' "$target_path/.claude/settings.local.json")
    if [[ "$lang" != "Korean" ]]; then
        echo "ASSERTION FAILED: Language should be overwritten to 'Korean', got '$lang'"
        return 1
    fi

    return 0
}

# =============================================================================
# Tests: Config - Gemini (.gemini/settings.json)
# =============================================================================

test_config_gemini_merge() {
    # config merged into .gemini/settings.json
    local target_path="$TEST_TMP_DIR/target"

    mkdir -p "$target_path/.gemini"
    echo '{"existingKey":"value"}' > "$target_path/.gemini/settings.json"

    local config_json='{"general":{"model":"gemini-2.5-pro"}}'
    gemini_sync_config "$target_path" "$config_json" "false"

    # Verify existing key preserved
    local existing
    existing=$(jq -r '.existingKey' "$target_path/.gemini/settings.json")
    if [[ "$existing" != "value" ]]; then
        echo "ASSERTION FAILED: Existing key should be preserved"
        return 1
    fi

    # Verify config merged
    local model
    model=$(jq -r '.general.model' "$target_path/.gemini/settings.json")
    if [[ "$model" != "gemini-2.5-pro" ]]; then
        echo "ASSERTION FAILED: Config should be merged, expected model 'gemini-2.5-pro', got '$model'"
        return 1
    fi

    return 0
}

# =============================================================================
# Tests: Config - Codex (config.toml managed block)
# =============================================================================

test_config_codex_toml() {
    # config written in omt:config managed block
    local target_path="$TEST_TMP_DIR/target"
    mkdir -p "$target_path/.codex"

    local config_json='{"model":"o3","approval_policy":"suggest"}'
    codex_sync_config "$target_path" "$config_json" "false"

    # Verify config.toml exists
    if [[ ! -f "$target_path/.codex/config.toml" ]]; then
        echo "ASSERTION FAILED: config.toml should be created"
        return 1
    fi

    # Verify managed block markers
    if ! grep -q "# --- omt:config ---" "$target_path/.codex/config.toml"; then
        echo "ASSERTION FAILED: Should contain omt:config managed block start"
        return 1
    fi

    if ! grep -q 'model = "o3"' "$target_path/.codex/config.toml"; then
        echo "ASSERTION FAILED: Should contain model = \"o3\""
        return 1
    fi

    if ! grep -q "# --- end omt:config ---" "$target_path/.codex/config.toml"; then
        echo "ASSERTION FAILED: Should contain omt:config managed block end"
        return 1
    fi

    return 0
}

# =============================================================================
# Tests: Config - Missing Platform Skip
# =============================================================================

test_config_missing_platform_skip() {
    # only claude key in config -> no gemini/codex activity
    local target_path="$TEST_TMP_DIR/target"

    # Only call claude_sync_config (simulating what sync_config does when only claude key exists)
    local config_json='{"language":"Korean"}'
    claude_sync_config "$target_path" "$config_json" "false"

    # .gemini/settings.json should NOT exist
    if [[ -f "$target_path/.gemini/settings.json" ]]; then
        echo "ASSERTION FAILED: .gemini/settings.json should NOT be created when only claude config exists"
        return 1
    fi

    # .codex/config.toml should NOT exist
    if [[ -f "$target_path/.codex/config.toml" ]]; then
        echo "ASSERTION FAILED: .codex/config.toml should NOT be created when only claude config exists"
        return 1
    fi

    # But .claude/settings.local.json should exist
    if [[ ! -f "$target_path/.claude/settings.local.json" ]]; then
        echo "ASSERTION FAILED: .claude/settings.local.json should be created"
        return 1
    fi

    return 0
}

# =============================================================================
# Main Test Runner
# =============================================================================

main() {
    echo "=========================================="
    echo "Sync MCP/Plugin/Config E2E Tests"
    echo "=========================================="

    # MCP Tests
    run_test test_mcp_claude_mcp_json_creation
    run_test test_mcp_claude_merge_preserves_existing
    run_test test_mcp_gemini_merge
    run_test test_mcp_codex_toml_write
    run_test test_mcp_dry_run

    # Plugin Tests
    run_test test_plugin_dry_run
    run_test test_plugin_string_shorthand

    # Config Tests
    run_test test_config_claude_settings_local
    run_test test_config_claude_preserves_existing
    run_test test_config_gemini_merge
    run_test test_config_codex_toml
    run_test test_config_missing_platform_skip

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
}

main "$@"

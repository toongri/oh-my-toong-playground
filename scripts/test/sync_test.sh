#!/bin/bash
# =============================================================================
# Sync Orchestrator Tests
# Tests for sync.sh orchestrator behavior with adapter pattern
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Test utilities
TESTS_PASSED=0
TESTS_FAILED=0
CURRENT_TEST=""

setup_test_env() {
    TEST_TMP_DIR=$(mktemp -d)
    mkdir -p "$TEST_TMP_DIR/.claude"

    # Create source directories
    mkdir -p "$TEST_TMP_DIR/source/agents"
    mkdir -p "$TEST_TMP_DIR/source/commands"
    mkdir -p "$TEST_TMP_DIR/source/hooks"
    mkdir -p "$TEST_TMP_DIR/source/skills/test-skill"

    # Create target directory
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
# Tests: Sourcing and Dependencies
# =============================================================================

test_sync_sources_common_lib() {
    # Verify that sync.sh sources lib/common.sh
    if grep -q 'source.*lib/common.sh' "$ROOT_DIR/sync.sh"; then
        return 0
    else
        echo "ASSERTION FAILED: sync.sh should source lib/common.sh"
        return 1
    fi
}

test_sync_sources_claude_adapter() {
    # Verify that sync.sh sources adapters/claude.sh
    if grep -q 'source.*adapters/claude.sh' "$ROOT_DIR/sync.sh"; then
        return 0
    else
        echo "ASSERTION FAILED: sync.sh should source adapters/claude.sh"
        return 1
    fi
}

test_sync_sources_gemini_adapter() {
    # Verify that sync.sh sources adapters/gemini.sh
    if grep -q 'source.*adapters/gemini.sh' "$ROOT_DIR/sync.sh"; then
        return 0
    else
        echo "ASSERTION FAILED: sync.sh should source adapters/gemini.sh"
        return 1
    fi
}

test_sync_sources_codex_adapter() {
    # Verify that sync.sh sources adapters/codex.sh
    if grep -q 'source.*adapters/codex.sh' "$ROOT_DIR/sync.sh"; then
        return 0
    else
        echo "ASSERTION FAILED: sync.sh should source adapters/codex.sh"
        return 1
    fi
}

test_sync_does_not_duplicate_log_functions() {
    # log_info, log_success, etc. should NOT be defined in sync.sh
    # (they come from lib/common.sh)
    local duplicates=0

    # Check for function definitions (not calls)
    if grep -E '^log_info\(\)' "$ROOT_DIR/sync.sh" >/dev/null 2>&1; then
        echo "Found duplicate: log_info()"
        duplicates=$((duplicates + 1))
    fi
    if grep -E '^log_success\(\)' "$ROOT_DIR/sync.sh" >/dev/null 2>&1; then
        echo "Found duplicate: log_success()"
        duplicates=$((duplicates + 1))
    fi
    if grep -E '^log_warn\(\)' "$ROOT_DIR/sync.sh" >/dev/null 2>&1; then
        echo "Found duplicate: log_warn()"
        duplicates=$((duplicates + 1))
    fi
    if grep -E '^log_error\(\)' "$ROOT_DIR/sync.sh" >/dev/null 2>&1; then
        echo "Found duplicate: log_error()"
        duplicates=$((duplicates + 1))
    fi
    if grep -E '^log_dry\(\)' "$ROOT_DIR/sync.sh" >/dev/null 2>&1; then
        echo "Found duplicate: log_dry()"
        duplicates=$((duplicates + 1))
    fi

    if [[ $duplicates -gt 0 ]]; then
        echo "ASSERTION FAILED: Found $duplicates duplicate log function definitions"
        return 1
    fi
    return 0
}

test_sync_does_not_duplicate_color_definitions() {
    # Color definitions (RED, GREEN, etc.) should NOT be in sync.sh
    # (they come from lib/common.sh)
    local duplicates=0

    # Check for color definitions (variable assignments)
    if grep -E "^RED=" "$ROOT_DIR/sync.sh" >/dev/null 2>&1; then
        echo "Found duplicate: RED="
        duplicates=$((duplicates + 1))
    fi
    if grep -E "^GREEN=" "$ROOT_DIR/sync.sh" >/dev/null 2>&1; then
        echo "Found duplicate: GREEN="
        duplicates=$((duplicates + 1))
    fi
    if grep -E "^YELLOW=" "$ROOT_DIR/sync.sh" >/dev/null 2>&1; then
        echo "Found duplicate: YELLOW="
        duplicates=$((duplicates + 1))
    fi
    if grep -E "^BLUE=" "$ROOT_DIR/sync.sh" >/dev/null 2>&1; then
        echo "Found duplicate: BLUE="
        duplicates=$((duplicates + 1))
    fi
    if grep -E "^NC=" "$ROOT_DIR/sync.sh" >/dev/null 2>&1; then
        echo "Found duplicate: NC="
        duplicates=$((duplicates + 1))
    fi

    if [[ $duplicates -gt 0 ]]; then
        echo "ASSERTION FAILED: Found $duplicates duplicate color definitions"
        return 1
    fi
    return 0
}

test_sync_does_not_duplicate_check_dependencies() {
    # check_dependencies should NOT be defined in sync.sh
    if grep -E '^check_dependencies\(\)' "$ROOT_DIR/sync.sh" >/dev/null 2>&1; then
        echo "ASSERTION FAILED: check_dependencies() should not be defined in sync.sh"
        return 1
    fi
    return 0
}

test_sync_does_not_duplicate_backup_functions() {
    # Backup functions should NOT be defined in sync.sh
    local duplicates=0

    if grep -E '^generate_backup_session_id\(\)' "$ROOT_DIR/sync.sh" >/dev/null 2>&1; then
        echo "Found duplicate: generate_backup_session_id()"
        duplicates=$((duplicates + 1))
    fi
    if grep -E '^backup_category\(\)' "$ROOT_DIR/sync.sh" >/dev/null 2>&1; then
        echo "Found duplicate: backup_category()"
        duplicates=$((duplicates + 1))
    fi
    if grep -E '^cleanup_old_backups\(\)' "$ROOT_DIR/sync.sh" >/dev/null 2>&1; then
        echo "Found duplicate: cleanup_old_backups()"
        duplicates=$((duplicates + 1))
    fi

    if [[ $duplicates -gt 0 ]]; then
        echo "ASSERTION FAILED: Found $duplicates duplicate backup function definitions"
        return 1
    fi
    return 0
}

test_sync_does_not_duplicate_resolve_source_path() {
    # resolve_source_path should NOT be defined in sync.sh
    if grep -E '^resolve_source_path\(\)' "$ROOT_DIR/sync.sh" >/dev/null 2>&1; then
        echo "ASSERTION FAILED: resolve_source_path() should not be defined in sync.sh"
        return 1
    fi
    return 0
}

test_sync_does_not_duplicate_claude_functions() {
    # Claude-specific functions should NOT be defined in sync.sh
    local duplicates=0

    if grep -E '^update_agent_frontmatter\(\)' "$ROOT_DIR/sync.sh" >/dev/null 2>&1; then
        echo "Found duplicate: update_agent_frontmatter()"
        duplicates=$((duplicates + 1))
    fi
    if grep -E '^update_settings_json\(\)' "$ROOT_DIR/sync.sh" >/dev/null 2>&1; then
        echo "Found duplicate: update_settings_json()"
        duplicates=$((duplicates + 1))
    fi

    if [[ $duplicates -gt 0 ]]; then
        echo "ASSERTION FAILED: Found $duplicates duplicate Claude-specific function definitions"
        return 1
    fi
    return 0
}

# =============================================================================
# Tests: Multi-CLI Adapter Dispatch Pattern
# =============================================================================

test_sync_agents_uses_adapter_dispatch() {
    # sync_agents should use adapter dispatch pattern (e.g., claude_sync_agents)
    # Check for adapter function call pattern within sync_agents function
    if grep -A 200 '^sync_agents\(\)' "$ROOT_DIR/sync.sh" | grep -q 'claude_sync_agents'; then
        return 0
    else
        echo "ASSERTION FAILED: sync_agents should call claude_sync_agents adapter"
        return 1
    fi
}

test_sync_commands_uses_adapter_dispatch() {
    # sync_commands should use adapter dispatch pattern
    if grep -A 80 '^sync_commands\(\)' "$ROOT_DIR/sync.sh" | grep -q 'claude_sync_commands'; then
        return 0
    else
        echo "ASSERTION FAILED: sync_commands should call claude_sync_commands adapter"
        return 1
    fi
}

test_sync_hooks_uses_adapter_dispatch() {
    # sync_hooks should use adapter dispatch pattern
    if grep -A 100 '^sync_hooks\(\)' "$ROOT_DIR/sync.sh" | grep -q 'claude_sync_hooks\|claude_build_hook_entry\|claude_update_settings'; then
        return 0
    else
        echo "ASSERTION FAILED: sync_hooks should use claude adapter functions"
        return 1
    fi
}

test_sync_skills_uses_adapter_dispatch() {
    # sync_skills should use adapter dispatch pattern
    if grep -A 80 '^sync_skills\(\)' "$ROOT_DIR/sync.sh" | grep -q 'claude_sync_skills'; then
        return 0
    else
        echo "ASSERTION FAILED: sync_skills should call claude_sync_skills adapter"
        return 1
    fi
}

# =============================================================================
# Tests: Multi-CLI Dispatch (platforms parsing - replaces default_targets and targets)
# =============================================================================

test_sync_agents_parses_platforms() {
    # sync_agents should parse platforms from YAML (top-level)
    if grep -A 80 '^sync_agents\(\)' "$ROOT_DIR/sync.sh" | grep -q '\.platforms'; then
        return 0
    else
        echo "ASSERTION FAILED: sync_agents should parse platforms from YAML"
        return 1
    fi
}

test_sync_agents_parses_component_platforms() {
    # sync_agents should parse per-component/item platforms field
    # Supports both old format (.agents[$i].platforms) and new format (.agents.items[$i].platforms)
    if grep -A 200 '^sync_agents\(\)' "$ROOT_DIR/sync.sh" | grep -qE '\.agents\[\$i\]\.platforms|\.agents\.items\[\$i\]\.platforms|item_platforms|component_platforms'; then
        return 0
    else
        echo "ASSERTION FAILED: sync_agents should parse per-component platforms field"
        return 1
    fi
}

test_sync_agents_dispatches_to_gemini() {
    # sync_agents should have gemini_sync_agents dispatch
    if grep -A 200 '^sync_agents\(\)' "$ROOT_DIR/sync.sh" | grep -q 'gemini_sync_agents'; then
        return 0
    else
        echo "ASSERTION FAILED: sync_agents should dispatch to gemini_sync_agents"
        return 1
    fi
}

test_sync_agents_dispatches_to_codex() {
    # sync_agents should have codex_sync_agents dispatch
    if grep -A 200 '^sync_agents\(\)' "$ROOT_DIR/sync.sh" | grep -q 'codex_sync_agents'; then
        return 0
    else
        echo "ASSERTION FAILED: sync_agents should dispatch to codex_sync_agents"
        return 1
    fi
}

test_sync_commands_dispatches_to_gemini() {
    # sync_commands should have gemini_sync_commands_direct dispatch
    if grep -A 120 '^sync_commands\(\)' "$ROOT_DIR/sync.sh" | grep -q 'gemini_sync_commands_direct'; then
        return 0
    else
        echo "ASSERTION FAILED: sync_commands should dispatch to gemini_sync_commands_direct"
        return 1
    fi
}

test_sync_commands_dispatches_to_codex() {
    # sync_commands should have codex_sync_commands dispatch
    if grep -A 100 '^sync_commands\(\)' "$ROOT_DIR/sync.sh" | grep -q 'codex_sync_commands'; then
        return 0
    else
        echo "ASSERTION FAILED: sync_commands should dispatch to codex_sync_commands"
        return 1
    fi
}

test_sync_skills_dispatches_to_gemini() {
    # sync_skills should have gemini_sync_skills dispatch
    if grep -A 80 '^sync_skills\(\)' "$ROOT_DIR/sync.sh" | grep -q 'gemini_sync_skills'; then
        return 0
    else
        echo "ASSERTION FAILED: sync_skills should dispatch to gemini_sync_skills"
        return 1
    fi
}

test_sync_skills_dispatches_to_codex() {
    # sync_skills should have codex_sync_skills dispatch
    if grep -A 100 '^sync_skills\(\)' "$ROOT_DIR/sync.sh" | grep -q 'codex_sync_skills'; then
        return 0
    else
        echo "ASSERTION FAILED: sync_skills should dispatch to codex_sync_skills"
        return 1
    fi
}

test_sync_hooks_dispatches_to_gemini() {
    # sync_hooks should have gemini dispatch
    if grep -A 150 '^sync_hooks\(\)' "$ROOT_DIR/sync.sh" | grep -q 'gemini_sync_hooks\|gemini_build_hook_entry\|gemini_update_settings'; then
        return 0
    else
        echo "ASSERTION FAILED: sync_hooks should dispatch to gemini adapter functions"
        return 1
    fi
}

test_sync_hooks_dispatches_to_codex() {
    # sync_hooks should have codex dispatch (direct functions)
    if grep -A 200 '^sync_hooks\(\)' "$ROOT_DIR/sync.sh" | grep -q 'codex_sync_hooks_direct\|codex_update_settings'; then
        return 0
    else
        echo "ASSERTION FAILED: sync_hooks should dispatch to codex adapter functions"
        return 1
    fi
}

test_sync_hooks_handles_per_cli_hooks_json() {
    # sync_hooks should manage separate hooks_json per CLI target
    if grep -A 150 '^sync_hooks\(\)' "$ROOT_DIR/sync.sh" | grep -qE 'claude_hooks_json|gemini_hooks_json|codex_hooks_json'; then
        return 0
    else
        echo "ASSERTION FAILED: sync_hooks should manage per-CLI hooks_json"
        return 1
    fi
}

# =============================================================================
# Tests: Orchestrator Functions Retained
# =============================================================================

test_sync_retains_process_yaml() {
    # process_yaml should still be in sync.sh (orchestration logic)
    if grep -E '^process_yaml\(\)' "$ROOT_DIR/sync.sh" >/dev/null 2>&1; then
        return 0
    else
        echo "ASSERTION FAILED: process_yaml() should be retained in sync.sh"
        return 1
    fi
}

test_sync_retains_main() {
    # main should still be in sync.sh
    if grep -E '^main\(\)' "$ROOT_DIR/sync.sh" >/dev/null 2>&1; then
        return 0
    else
        echo "ASSERTION FAILED: main() should be retained in sync.sh"
        return 1
    fi
}

test_sync_retains_show_help() {
    # show_help should still be in sync.sh
    if grep -E '^show_help\(\)' "$ROOT_DIR/sync.sh" >/dev/null 2>&1; then
        return 0
    else
        echo "ASSERTION FAILED: show_help() should be retained in sync.sh"
        return 1
    fi
}

test_sync_retains_sync_functions() {
    # sync_agents, sync_commands, sync_hooks, sync_skills should still exist
    # (as orchestration wrappers that dispatch to adapters)
    local missing=0

    if ! grep -E '^sync_agents\(\)' "$ROOT_DIR/sync.sh" >/dev/null 2>&1; then
        echo "Missing: sync_agents()"
        missing=$((missing + 1))
    fi
    if ! grep -E '^sync_commands\(\)' "$ROOT_DIR/sync.sh" >/dev/null 2>&1; then
        echo "Missing: sync_commands()"
        missing=$((missing + 1))
    fi
    if ! grep -E '^sync_hooks\(\)' "$ROOT_DIR/sync.sh" >/dev/null 2>&1; then
        echo "Missing: sync_hooks()"
        missing=$((missing + 1))
    fi
    if ! grep -E '^sync_skills\(\)' "$ROOT_DIR/sync.sh" >/dev/null 2>&1; then
        echo "Missing: sync_skills()"
        missing=$((missing + 1))
    fi

    if [[ $missing -gt 0 ]]; then
        echo "ASSERTION FAILED: Found $missing missing sync functions"
        return 1
    fi
    return 0
}

# =============================================================================
# Tests: YQ JSON Array Parsing (platforms fallback)
# =============================================================================

test_sync_agents_uses_json_output_for_platforms() {
    # sync_agents should use -o=json for platforms to avoid lexer errors
    # when interpolating JSON arrays into yq expressions
    if grep -A 80 '^sync_agents\(\)' "$ROOT_DIR/sync.sh" | grep -q "yq -o=json '\.platforms"; then
        return 0
    else
        echo "ASSERTION FAILED: sync_agents should use 'yq -o=json' for platforms"
        return 1
    fi
}

test_sync_agents_uses_null_check_for_component_platforms() {
    # sync_agents should check for null platforms and fallback
    # Supports both old format (.agents[$i].platforms) and new format (.agents.items[$i].platforms)
    if grep -A 200 '^sync_agents\(\)' "$ROOT_DIR/sync.sh" | grep -qE 'yq -o=json "\.agents\[\$i\]\.platforms // null"|yq -o=json "\.agents\.items\[\$i\]\.platforms // null"|item_platforms.*null|component_platforms.*null'; then
        return 0
    else
        echo "ASSERTION FAILED: sync_agents should use null check pattern for component platforms"
        return 1
    fi
}

test_sync_agents_uses_jq_for_platforms_iteration() {
    # sync_agents should use jq to iterate over JSON array platforms
    if grep -A 200 '^sync_agents\(\)' "$ROOT_DIR/sync.sh" | grep -q "jq -r '\.\[\]'"; then
        return 0
    else
        echo "ASSERTION FAILED: sync_agents should use jq for platforms iteration"
        return 1
    fi
}

test_sync_commands_uses_json_output_for_platforms() {
    # sync_commands should use -o=json for platforms
    if grep -A 80 '^sync_commands\(\)' "$ROOT_DIR/sync.sh" | grep -q "yq -o=json '\.platforms"; then
        return 0
    else
        echo "ASSERTION FAILED: sync_commands should use 'yq -o=json' for platforms"
        return 1
    fi
}

test_sync_commands_uses_null_check_for_component_platforms() {
    # sync_commands should check for null platforms and fallback
    # Supports both old format and new format with items
    if grep -A 150 '^sync_commands\(\)' "$ROOT_DIR/sync.sh" | grep -qE 'yq -o=json "\.commands\[\$i\]\.platforms // null"|yq -o=json "\.commands\.items\[\$i\]\.platforms // null"|item_platforms.*null|component_platforms.*null'; then
        return 0
    else
        echo "ASSERTION FAILED: sync_commands should use null check pattern for component platforms"
        return 1
    fi
}

test_sync_hooks_uses_json_output_for_platforms() {
    # sync_hooks should use -o=json for platforms
    if grep -A 180 '^sync_hooks\(\)' "$ROOT_DIR/sync.sh" | grep -q "yq -o=json '\.platforms"; then
        return 0
    else
        echo "ASSERTION FAILED: sync_hooks should use 'yq -o=json' for platforms"
        return 1
    fi
}

test_sync_hooks_uses_null_check_for_component_platforms() {
    # sync_hooks should check for null platforms and fallback
    # Supports both old format and new format with items
    if grep -A 300 '^sync_hooks\(\)' "$ROOT_DIR/sync.sh" | grep -qE 'yq -o=json "\.hooks\[\$i\]\.platforms // null"|yq -o=json "\$hook_path_prefix\.platforms // null"|item_platforms.*null'; then
        return 0
    else
        echo "ASSERTION FAILED: sync_hooks should use null check pattern for component platforms"
        return 1
    fi
}

test_sync_skills_uses_json_output_for_platforms() {
    # sync_skills should use -o=json for platforms
    if grep -A 80 '^sync_skills\(\)' "$ROOT_DIR/sync.sh" | grep -q "yq -o=json '\.platforms"; then
        return 0
    else
        echo "ASSERTION FAILED: sync_skills should use 'yq -o=json' for platforms"
        return 1
    fi
}

test_sync_skills_uses_null_check_for_component_platforms() {
    # sync_skills should check for null platforms and fallback
    # Supports both old format and new format with items
    if grep -A 150 '^sync_skills\(\)' "$ROOT_DIR/sync.sh" | grep -qE 'yq -o=json "\.skills\[\$i\]\.platforms // null"|yq -o=json "\.skills\.items\[\$i\]\.platforms // null"|item_platforms.*null|component_platforms.*null'; then
        return 0
    else
        echo "ASSERTION FAILED: sync_skills should use null check pattern for component platforms"
        return 1
    fi
}

# =============================================================================
# Tests: CLI Project File Validation in process_yaml
# =============================================================================

test_process_yaml_validates_cli_project_files() {
    # process_yaml should check for CLI project files before syncing
    if grep -A 50 '^process_yaml\(\)' "$ROOT_DIR/sync.sh" | grep -q "validate_cli_project_files\|get_cli_project_file"; then
        return 0
    else
        echo "ASSERTION FAILED: process_yaml should validate CLI project files"
        return 1
    fi
}

test_sync_has_cli_project_file_mapping() {
    # sync.sh should have get_cli_project_file function or use it from common.sh
    if grep -q "get_cli_project_file" "$ROOT_DIR/sync.sh" || grep -q "get_cli_project_file" "$ROOT_DIR/lib/common.sh"; then
        return 0
    else
        echo "ASSERTION FAILED: sync.sh should have or use get_cli_project_file mapping"
        return 1
    fi
}

test_sync_validates_claude_project_file() {
    # sync.sh should check for CLAUDE.md when using claude target
    if grep -q "CLAUDE.md" "$ROOT_DIR/sync.sh" || grep -q "CLAUDE.md" "$ROOT_DIR/lib/common.sh"; then
        return 0
    else
        echo "ASSERTION FAILED: sync.sh should validate CLAUDE.md for claude target"
        return 1
    fi
}

test_sync_validates_gemini_project_file() {
    # sync.sh should check for GEMINI.md when using gemini target
    if grep -q "GEMINI.md" "$ROOT_DIR/sync.sh" || grep -q "GEMINI.md" "$ROOT_DIR/lib/common.sh"; then
        return 0
    else
        echo "ASSERTION FAILED: sync.sh should validate GEMINI.md for gemini target"
        return 1
    fi
}

test_sync_validates_codex_project_file() {
    # sync.sh should check for AGENTS.md when using codex target
    if grep -q "AGENTS.md" "$ROOT_DIR/sync.sh" || grep -q "AGENTS.md" "$ROOT_DIR/lib/common.sh"; then
        return 0
    else
        echo "ASSERTION FAILED: sync.sh should validate AGENTS.md for codex target"
        return 1
    fi
}

test_sync_skips_yaml_on_missing_cli_file() {
    # sync.sh should log error and skip/fail when CLI project file is missing
    if grep -A 50 '^process_yaml\(\)' "$ROOT_DIR/sync.sh" | grep -qE "return [1-9]|skip|continue"; then
        return 0
    else
        echo "ASSERTION FAILED: sync.sh should skip/fail when CLI project file is missing"
        return 1
    fi
}

# =============================================================================
# Tests: sync_scripts Function
# =============================================================================

test_sync_scripts_function_exists() {
    # sync_scripts function should exist in sync.sh
    if grep -E '^sync_scripts\(\)' "$ROOT_DIR/sync.sh" >/dev/null 2>&1; then
        return 0
    else
        echo "ASSERTION FAILED: sync_scripts() function should exist in sync.sh"
        return 1
    fi
}

test_sync_scripts_uses_adapter_dispatch() {
    # sync_scripts should use adapter dispatch pattern (e.g., claude_sync_scripts)
    if grep -A 100 '^sync_scripts\(\)' "$ROOT_DIR/sync.sh" | grep -q 'claude_sync_scripts'; then
        return 0
    else
        echo "ASSERTION FAILED: sync_scripts should call claude_sync_scripts adapter"
        return 1
    fi
}

test_sync_scripts_parses_platforms() {
    # sync_scripts should parse platforms from YAML (top-level)
    if grep -A 80 '^sync_scripts\(\)' "$ROOT_DIR/sync.sh" | grep -q '\.platforms'; then
        return 0
    else
        echo "ASSERTION FAILED: sync_scripts should parse platforms from YAML"
        return 1
    fi
}

test_sync_scripts_uses_json_output_for_platforms() {
    # sync_scripts should use -o=json for platforms
    if grep -A 80 '^sync_scripts\(\)' "$ROOT_DIR/sync.sh" | grep -q "yq -o=json '\.platforms"; then
        return 0
    else
        echo "ASSERTION FAILED: sync_scripts should use 'yq -o=json' for platforms"
        return 1
    fi
}

test_sync_scripts_dispatches_to_gemini() {
    # sync_scripts should have gemini_sync_scripts dispatch
    if grep -A 100 '^sync_scripts\(\)' "$ROOT_DIR/sync.sh" | grep -q 'gemini_sync_scripts'; then
        return 0
    else
        echo "ASSERTION FAILED: sync_scripts should dispatch to gemini_sync_scripts"
        return 1
    fi
}

test_sync_scripts_dispatches_to_codex() {
    # sync_scripts should have codex_sync_scripts dispatch
    if grep -A 100 '^sync_scripts\(\)' "$ROOT_DIR/sync.sh" | grep -q 'codex_sync_scripts'; then
        return 0
    else
        echo "ASSERTION FAILED: sync_scripts should dispatch to codex_sync_scripts"
        return 1
    fi
}

test_sync_scripts_is_called_in_sync_to_target() {
    # sync_scripts should be called in sync_to_target function
    if grep -q 'sync_scripts "\$target_path" "\$yaml_file"' "$ROOT_DIR/sync.sh"; then
        return 0
    else
        echo "ASSERTION FAILED: sync_scripts should be called in sync_to_target"
        return 1
    fi
}

# =============================================================================
# Main Test Runner
# =============================================================================

main() {
    echo "=========================================="
    echo "Sync Orchestrator Tests"
    echo "=========================================="

    # Sourcing and Dependencies
    run_test test_sync_sources_common_lib
    run_test test_sync_sources_claude_adapter
    run_test test_sync_sources_gemini_adapter
    run_test test_sync_sources_codex_adapter
    run_test test_sync_does_not_duplicate_log_functions
    run_test test_sync_does_not_duplicate_color_definitions
    run_test test_sync_does_not_duplicate_check_dependencies
    run_test test_sync_does_not_duplicate_backup_functions
    run_test test_sync_does_not_duplicate_resolve_source_path
    run_test test_sync_does_not_duplicate_claude_functions

    # Adapter Dispatch Pattern
    run_test test_sync_agents_uses_adapter_dispatch
    run_test test_sync_commands_uses_adapter_dispatch
    run_test test_sync_hooks_uses_adapter_dispatch
    run_test test_sync_skills_uses_adapter_dispatch

    # Multi-CLI Dispatch (platforms)
    run_test test_sync_agents_parses_platforms
    run_test test_sync_agents_parses_component_platforms
    run_test test_sync_agents_dispatches_to_gemini
    run_test test_sync_agents_dispatches_to_codex
    run_test test_sync_commands_dispatches_to_gemini
    run_test test_sync_commands_dispatches_to_codex
    run_test test_sync_skills_dispatches_to_gemini
    run_test test_sync_skills_dispatches_to_codex
    run_test test_sync_hooks_dispatches_to_gemini
    run_test test_sync_hooks_dispatches_to_codex
    run_test test_sync_hooks_handles_per_cli_hooks_json

    # Orchestrator Functions Retained
    run_test test_sync_retains_process_yaml
    run_test test_sync_retains_main
    run_test test_sync_retains_show_help
    run_test test_sync_retains_sync_functions

    # YQ JSON Array Parsing (platforms fallback)
    run_test test_sync_agents_uses_json_output_for_platforms
    run_test test_sync_agents_uses_null_check_for_component_platforms
    run_test test_sync_agents_uses_jq_for_platforms_iteration
    run_test test_sync_commands_uses_json_output_for_platforms
    run_test test_sync_commands_uses_null_check_for_component_platforms
    run_test test_sync_hooks_uses_json_output_for_platforms
    run_test test_sync_hooks_uses_null_check_for_component_platforms
    run_test test_sync_skills_uses_json_output_for_platforms
    run_test test_sync_skills_uses_null_check_for_component_platforms

    # CLI Project File Validation
    run_test test_process_yaml_validates_cli_project_files
    run_test test_sync_has_cli_project_file_mapping
    run_test test_sync_validates_claude_project_file
    run_test test_sync_validates_gemini_project_file
    run_test test_sync_validates_codex_project_file
    run_test test_sync_skips_yaml_on_missing_cli_file

    # sync_scripts Function
    run_test test_sync_scripts_function_exists
    run_test test_sync_scripts_uses_adapter_dispatch
    run_test test_sync_scripts_parses_platforms
    run_test test_sync_scripts_uses_json_output_for_platforms
    run_test test_sync_scripts_dispatches_to_gemini
    run_test test_sync_scripts_dispatches_to_codex
    run_test test_sync_scripts_is_called_in_sync_to_target

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
}

main "$@"

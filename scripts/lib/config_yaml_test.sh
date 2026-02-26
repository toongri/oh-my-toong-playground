#!/bin/bash
# =============================================================================
# Config YAML Tests - Root Relocation + use-platforms
# Tests for config.yaml at root location with use-platforms default setting
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Go up to scripts/, then to project root
SCRIPTS_DIR="$(dirname "$SCRIPT_DIR")"
ROOT_DIR="$(dirname "$SCRIPTS_DIR")"

# Test utilities
TESTS_PASSED=0
TESTS_FAILED=0
CURRENT_TEST=""

setup_test_env() {
    TEST_TMP_DIR=$(mktemp -d)

    # Create oh-my-toong-like structure
    mkdir -p "$TEST_TMP_DIR/scripts/lib"
    mkdir -p "$TEST_TMP_DIR/scripts/adapters"
    mkdir -p "$TEST_TMP_DIR/agents"
    mkdir -p "$TEST_TMP_DIR/projects/test-proj"
    mkdir -p "$TEST_TMP_DIR/target"

    # Create sample agent file
    echo "# Oracle Agent" > "$TEST_TMP_DIR/agents/oracle.md"
    echo "# CLAUDE.md" > "$TEST_TMP_DIR/target/CLAUDE.md"

    # Copy lib and adapters from actual project
    cp "$ROOT_DIR/scripts/lib/common.sh" "$TEST_TMP_DIR/scripts/lib/" 2>/dev/null || true
    cp "$ROOT_DIR/adapters/"*.sh "$TEST_TMP_DIR/scripts/adapters/" 2>/dev/null || true
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
# Tests: config.yaml Root Location
# =============================================================================

test_config_yaml_at_root_location() {
    # sync.sh should look for config.yaml at $ROOT_DIR/config.yaml (not scripts/)
    if grep -q 'config.yaml' "$ROOT_DIR/scripts/sync.sh" 2>/dev/null; then
        # Check that it reads from ROOT_DIR/config.yaml (not scripts/config.yaml)
        if grep -q '\$ROOT_DIR/config.yaml' "$ROOT_DIR/scripts/sync.sh" || \
           grep -q '"$ROOT_DIR"/config.yaml' "$ROOT_DIR/scripts/sync.sh"; then
            return 0
        else
            echo "sync.sh should read config.yaml from ROOT_DIR, not scripts/"
            return 1
        fi
    else
        echo "sync.sh does not reference config.yaml"
        return 1
    fi
}

test_config_yaml_not_in_scripts_dir() {
    # sync.sh should NOT read config.yaml from scripts/ directory
    if grep -q '\$ROOT_DIR/scripts/config.yaml' "$ROOT_DIR/scripts/sync.sh" || \
       grep -q '"$ROOT_DIR"/scripts/config.yaml' "$ROOT_DIR/scripts/sync.sh"; then
        echo "sync.sh should NOT read config.yaml from scripts/ directory"
        return 1
    else
        return 0
    fi
}

# =============================================================================
# Tests: use-platforms Field
# =============================================================================

test_common_lib_reads_use_platforms() {
    # lib/common.sh should have function to read use-platforms from config.yaml
    if grep -q 'use-platforms\|use_platforms' "$ROOT_DIR/scripts/lib/common.sh"; then
        return 0
    else
        echo "lib/common.sh should read use-platforms from config.yaml"
        return 1
    fi
}

test_sync_uses_use_platforms_as_fallback() {
    # sync.sh should use use-platforms from config.yaml as fallback
    # when sync.yaml doesn't have platforms field
    if grep -qE 'use.platforms|get_default_platforms' "$ROOT_DIR/scripts/sync.sh" || \
       grep -qE 'use.platforms|get_default_platforms' "$ROOT_DIR/scripts/lib/common.sh"; then
        return 0
    else
        echo "sync should use use-platforms from config.yaml as fallback"
        return 1
    fi
}

test_platforms_priority_order() {
    # Priority order should be:
    # component-level platforms > section-level platforms > sync.yaml top-level platforms > config.yaml use-platforms > hardcoded ["claude"]
    #
    # This test verifies the priority chain exists in the code
    local sync_file="$ROOT_DIR/scripts/sync.sh"

    # Check that sync_agents handles item_platforms (supports both old and new formats)
    # Old format: .agents[$i].platforms
    # New format: .agents.items[$i].platforms
    if grep -q 'item_platforms\|component_platforms' "$sync_file"; then
        return 0
    else
        echo "sync_agents should handle item/component-level platforms"
        return 1
    fi
}

# =============================================================================
# Tests: Default Platforms Function in common.sh
# =============================================================================

test_get_default_platforms_function_exists() {
    # lib/common.sh should have get_default_platforms function
    if grep -qE '^get_default_platforms\(\)|^function get_default_platforms' "$ROOT_DIR/scripts/lib/common.sh"; then
        return 0
    else
        echo "lib/common.sh should have get_default_platforms function"
        return 1
    fi
}

test_get_default_platforms_reads_config_yaml() {
    # get_default_platforms should read from $ROOT_DIR/config.yaml
    local common_file="$ROOT_DIR/scripts/lib/common.sh"

    if grep -A 20 'get_default_platforms' "$common_file" 2>/dev/null | grep -q 'config.yaml'; then
        return 0
    else
        echo "get_default_platforms should read from config.yaml"
        return 1
    fi
}

test_get_default_platforms_returns_json_array() {
    # get_default_platforms should return JSON array format
    local common_file="$ROOT_DIR/scripts/lib/common.sh"

    # Should use yq -o=json or return JSON array
    if grep -A 20 'get_default_platforms' "$common_file" 2>/dev/null | grep -qE 'yq.*-o=json|\["claude"\]'; then
        return 0
    else
        echo "get_default_platforms should return JSON array format"
        return 1
    fi
}

test_get_default_platforms_falls_back_to_claude() {
    # get_default_platforms should fall back to ["claude"] if config.yaml missing or empty
    local common_file="$ROOT_DIR/scripts/lib/common.sh"

    if grep -A 20 'get_default_platforms' "$common_file" 2>/dev/null | grep -q '\["claude"\]'; then
        return 0
    else
        echo "get_default_platforms should fall back to [\"claude\"]"
        return 1
    fi
}

# =============================================================================
# Tests: sync.sh Integration with use-platforms
# =============================================================================

test_sync_agents_uses_get_default_platforms() {
    # sync_agents should use get_default_platforms for fallback
    local sync_file="$ROOT_DIR/scripts/sync.sh"

    local agents_section
    agents_section=$(grep -A 100 '^sync_agents\(\)' "$sync_file" 2>/dev/null || echo "")

    # Should reference get_default_platforms or equivalent
    if echo "$agents_section" | grep -qE 'get_default_platforms|\$DEFAULT_PLATFORMS'; then
        return 0
    else
        # Alternative: might use inline fallback with config.yaml reference
        if echo "$agents_section" | grep -q 'config.yaml'; then
            return 0
        fi
        echo "sync_agents should use get_default_platforms or read config.yaml for fallback"
        return 1
    fi
}

test_sync_commands_uses_get_default_platforms() {
    # sync_commands should use get_default_platforms for fallback
    local sync_file="$ROOT_DIR/scripts/sync.sh"

    local commands_section
    commands_section=$(grep -A 100 '^sync_commands\(\)' "$sync_file" 2>/dev/null || echo "")

    if echo "$commands_section" | grep -qE 'get_default_platforms|\$DEFAULT_PLATFORMS|config.yaml'; then
        return 0
    else
        echo "sync_commands should use get_default_platforms or read config.yaml for fallback"
        return 1
    fi
}

test_sync_hooks_uses_get_default_platforms() {
    # sync_hooks should use get_default_platforms for fallback
    local sync_file="$ROOT_DIR/scripts/sync.sh"

    local hooks_section
    hooks_section=$(grep -A 180 '^sync_hooks\(\)' "$sync_file" 2>/dev/null || echo "")

    if echo "$hooks_section" | grep -qE 'get_default_platforms|\$DEFAULT_PLATFORMS|config.yaml'; then
        return 0
    else
        echo "sync_hooks should use get_default_platforms or read config.yaml for fallback"
        return 1
    fi
}

test_sync_skills_uses_get_default_platforms() {
    # sync_skills should use get_default_platforms for fallback
    local sync_file="$ROOT_DIR/scripts/sync.sh"

    local skills_section
    skills_section=$(grep -A 100 '^sync_skills\(\)' "$sync_file" 2>/dev/null || echo "")

    if echo "$skills_section" | grep -qE 'get_default_platforms|\$DEFAULT_PLATFORMS|config.yaml'; then
        return 0
    else
        echo "sync_skills should use get_default_platforms or read config.yaml for fallback"
        return 1
    fi
}

# =============================================================================
# Main Test Runner
# =============================================================================

main() {
    echo "=========================================="
    echo "Config YAML Tests - Root Relocation"
    echo "=========================================="

    # Root location tests
    run_test test_config_yaml_at_root_location
    run_test test_config_yaml_not_in_scripts_dir

    # use-platforms tests
    run_test test_common_lib_reads_use_platforms
    run_test test_sync_uses_use_platforms_as_fallback
    run_test test_platforms_priority_order

    # get_default_platforms function tests
    run_test test_get_default_platforms_function_exists
    run_test test_get_default_platforms_reads_config_yaml
    run_test test_get_default_platforms_returns_json_array
    run_test test_get_default_platforms_falls_back_to_claude

    # sync.sh integration tests
    run_test test_sync_agents_uses_get_default_platforms
    run_test test_sync_commands_uses_get_default_platforms
    run_test test_sync_hooks_uses_get_default_platforms
    run_test test_sync_skills_uses_get_default_platforms

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
}

main "$@"

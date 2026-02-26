#!/bin/bash
# =============================================================================
# Common Library Scoping Tests
# Tests for project-scoped component resolution in lib/common.sh
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"

# Source the common library
source "$ROOT_DIR/scripts/lib/common.sh"

# Test utilities
TESTS_PASSED=0
TESTS_FAILED=0
CURRENT_TEST=""

setup_test_env() {
    TEST_TMP_DIR=$(mktemp -d)

    # Create directory structure mimicking oh-my-toong
    mkdir -p "$TEST_TMP_DIR/skills/global-skill"
    mkdir -p "$TEST_TMP_DIR/agents"
    mkdir -p "$TEST_TMP_DIR/commands"
    mkdir -p "$TEST_TMP_DIR/projects/project-a/skills/local-skill"
    mkdir -p "$TEST_TMP_DIR/projects/project-a/agents"
    mkdir -p "$TEST_TMP_DIR/projects/project-b/skills/other-skill"

    # Create test files
    echo "global skill content" > "$TEST_TMP_DIR/skills/global-skill/SKILL.md"
    echo "global agent content" > "$TEST_TMP_DIR/agents/oracle.md"
    echo "project-a local skill content" > "$TEST_TMP_DIR/projects/project-a/skills/local-skill/SKILL.md"
    echo "project-a agent content" > "$TEST_TMP_DIR/projects/project-a/agents/local-agent.md"
    echo "project-b skill content" > "$TEST_TMP_DIR/projects/project-b/skills/other-skill/SKILL.md"

    # Create mock project yaml files
    echo "name: project-a" > "$TEST_TMP_DIR/projects/project-a/sync.yaml"
    echo "name: project-b" > "$TEST_TMP_DIR/projects/project-b/sync.yaml"
    echo "# root yaml" > "$TEST_TMP_DIR/sync.yaml"

    # Set ROOT_DIR for the functions under test
    export ROOT_DIR="$TEST_TMP_DIR"
}

teardown_test_env() {
    if [[ -d "$TEST_TMP_DIR" ]]; then
        rm -rf "$TEST_TMP_DIR"
    fi
    # Reset context variables
    CURRENT_PROJECT_CONTEXT=""
    IS_ROOT_YAML_CONTEXT=false
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

assert_true() {
    local value="$1"
    local msg="${2:-Expected true}"

    if [[ "$value" == "true" ]]; then
        return 0
    else
        echo "ASSERTION FAILED: $msg"
        echo "  Value: '$value'"
        return 1
    fi
}

assert_false() {
    local value="$1"
    local msg="${2:-Expected false}"

    if [[ "$value" == "false" ]]; then
        return 0
    else
        echo "ASSERTION FAILED: $msg"
        echo "  Value: '$value'"
        return 1
    fi
}

assert_empty() {
    local value="$1"
    local msg="${2:-Expected empty string}"

    if [[ -z "$value" ]]; then
        return 0
    else
        echo "ASSERTION FAILED: $msg"
        echo "  Value: '$value'"
        return 1
    fi
}

assert_not_empty() {
    local value="$1"
    local msg="${2:-Expected non-empty string}"

    if [[ -n "$value" ]]; then
        return 0
    else
        echo "ASSERTION FAILED: $msg"
        return 1
    fi
}

assert_contains() {
    local haystack="$1"
    local needle="$2"
    local msg="${3:-Expected string to contain substring}"

    if [[ "$haystack" == *"$needle"* ]]; then
        return 0
    else
        echo "ASSERTION FAILED: $msg"
        echo "  String: '$haystack'"
        echo "  Expected substring: '$needle'"
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
# Tests: Project Context Variables Existence
# =============================================================================

test_context_variables_exist() {
    # CURRENT_PROJECT_CONTEXT should be defined and exported
    if [[ -z "${CURRENT_PROJECT_CONTEXT+x}" ]]; then
        echo "ASSERTION FAILED: CURRENT_PROJECT_CONTEXT variable should be defined"
        return 1
    fi

    # IS_ROOT_YAML_CONTEXT should be defined and exported
    if [[ -z "${IS_ROOT_YAML_CONTEXT+x}" ]]; then
        echo "ASSERTION FAILED: IS_ROOT_YAML_CONTEXT variable should be defined"
        return 1
    fi

    return 0
}

test_context_variables_exported() {
    # Check that variables are exported (available in subshells)
    local project_exported
    local root_exported

    project_exported=$(bash -c 'echo ${CURRENT_PROJECT_CONTEXT+exported}')
    root_exported=$(bash -c 'echo ${IS_ROOT_YAML_CONTEXT+exported}')

    assert_equals "exported" "$project_exported" "CURRENT_PROJECT_CONTEXT should be exported"
    assert_equals "exported" "$root_exported" "IS_ROOT_YAML_CONTEXT should be exported"
}

# =============================================================================
# Tests: set_project_context() Function
# =============================================================================

test_set_project_context_exists() {
    # Function should exist
    if ! type set_project_context &>/dev/null; then
        echo "ASSERTION FAILED: set_project_context function should exist"
        return 1
    fi
    return 0
}

test_set_project_context_for_root_yaml() {
    set_project_context "$TEST_TMP_DIR/sync.yaml" "true"

    assert_empty "$CURRENT_PROJECT_CONTEXT" "Root yaml should have empty project context"
    assert_true "$IS_ROOT_YAML_CONTEXT" "Root yaml should set IS_ROOT_YAML_CONTEXT to true"
}

test_set_project_context_for_project_yaml_with_name() {
    set_project_context "$TEST_TMP_DIR/projects/project-a/sync.yaml" "false"

    assert_equals "project-a" "$CURRENT_PROJECT_CONTEXT" "Should extract project name from yaml name field"
    assert_false "$IS_ROOT_YAML_CONTEXT" "Project yaml should set IS_ROOT_YAML_CONTEXT to false"
}

test_set_project_context_falls_back_to_directory_name() {
    # Create yaml without name field
    local nameless_yaml="$TEST_TMP_DIR/projects/project-a/sync-nameless.yaml"
    echo "# yaml without name field" > "$nameless_yaml"

    set_project_context "$nameless_yaml" "false"

    assert_equals "project-a" "$CURRENT_PROJECT_CONTEXT" "Should fall back to directory name"
}

# =============================================================================
# Tests: resolve_scoped_source_path() Function
# =============================================================================

test_resolve_scoped_source_path_exists() {
    if ! type resolve_scoped_source_path &>/dev/null; then
        echo "ASSERTION FAILED: resolve_scoped_source_path function should exist"
        return 1
    fi
    return 0
}

test_scoped_resolution_root_yaml_finds_global() {
    CURRENT_PROJECT_CONTEXT=""
    IS_ROOT_YAML_CONTEXT=true

    resolve_scoped_source_path "skills" "global-skill" ""

    assert_equals "$TEST_TMP_DIR/skills/global-skill" "$SCOPED_SOURCE_PATH" "Should find global skill"
    assert_equals "global-skill" "$SCOPED_DISPLAY_NAME" "Display name should be skill name"
}

test_scoped_resolution_root_yaml_rejects_project_prefix() {
    CURRENT_PROJECT_CONTEXT=""
    IS_ROOT_YAML_CONTEXT=true

    if resolve_scoped_source_path "skills" "project-a:local-skill" ""; then
        echo "ASSERTION FAILED: Root yaml should reject project-prefixed references"
        return 1
    fi

    assert_empty "$SCOPED_SOURCE_PATH" "Source path should be empty on rejection"
    assert_contains "$SCOPED_RESOLUTION_ERROR" "Root sync.yaml cannot reference project" "Should have appropriate error"
}

test_scoped_resolution_project_yaml_finds_local_first() {
    CURRENT_PROJECT_CONTEXT="project-a"
    IS_ROOT_YAML_CONTEXT=false

    # Create a skill that exists in both global and local
    mkdir -p "$TEST_TMP_DIR/skills/common-skill"
    echo "global" > "$TEST_TMP_DIR/skills/common-skill/SKILL.md"
    mkdir -p "$TEST_TMP_DIR/projects/project-a/skills/common-skill"
    echo "local" > "$TEST_TMP_DIR/projects/project-a/skills/common-skill/SKILL.md"

    resolve_scoped_source_path "skills" "common-skill" ""

    assert_equals "$TEST_TMP_DIR/projects/project-a/skills/common-skill" "$SCOPED_SOURCE_PATH" "Should find local skill first"
}

test_scoped_resolution_project_yaml_falls_back_to_global() {
    CURRENT_PROJECT_CONTEXT="project-a"
    IS_ROOT_YAML_CONTEXT=false

    resolve_scoped_source_path "skills" "global-skill" ""

    assert_equals "$TEST_TMP_DIR/skills/global-skill" "$SCOPED_SOURCE_PATH" "Should fall back to global skill"
}

test_scoped_resolution_project_yaml_rejects_cross_project() {
    CURRENT_PROJECT_CONTEXT="project-a"
    IS_ROOT_YAML_CONTEXT=false

    if resolve_scoped_source_path "skills" "project-b:other-skill" ""; then
        echo "ASSERTION FAILED: Should reject cross-project reference"
        return 1
    fi

    assert_empty "$SCOPED_SOURCE_PATH" "Source path should be empty on rejection"
    assert_contains "$SCOPED_RESOLUTION_ERROR" "Cross-project reference not allowed" "Should have cross-project error"
}

test_scoped_resolution_project_yaml_allows_same_project_prefix() {
    CURRENT_PROJECT_CONTEXT="project-a"
    IS_ROOT_YAML_CONTEXT=false

    resolve_scoped_source_path "skills" "project-a:local-skill" ""

    assert_equals "$TEST_TMP_DIR/projects/project-a/skills/local-skill" "$SCOPED_SOURCE_PATH" "Should allow same-project prefix"
}

test_scoped_resolution_file_with_extension() {
    CURRENT_PROJECT_CONTEXT=""
    IS_ROOT_YAML_CONTEXT=true

    resolve_scoped_source_path "agents" "oracle" ".md"

    assert_equals "$TEST_TMP_DIR/agents/oracle.md" "$SCOPED_SOURCE_PATH" "Should find file with extension"
}

test_scoped_resolution_not_found_error() {
    CURRENT_PROJECT_CONTEXT="project-a"
    IS_ROOT_YAML_CONTEXT=false

    if resolve_scoped_source_path "skills" "nonexistent" ""; then
        echo "ASSERTION FAILED: Should fail for nonexistent component"
        return 1
    fi

    assert_empty "$SCOPED_SOURCE_PATH" "Source path should be empty when not found"
    assert_contains "$SCOPED_RESOLUTION_ERROR" "not found" "Should have not found error"
}

# =============================================================================
# Run Tests
# =============================================================================

main() {
    echo "============================================"
    echo "Common Library Scoping Tests"
    echo "============================================"
    echo ""

    # Context variable tests
    run_test test_context_variables_exist
    run_test test_context_variables_exported

    # set_project_context tests
    run_test test_set_project_context_exists
    run_test test_set_project_context_for_root_yaml
    run_test test_set_project_context_for_project_yaml_with_name
    run_test test_set_project_context_falls_back_to_directory_name

    # resolve_scoped_source_path tests
    run_test test_resolve_scoped_source_path_exists
    run_test test_scoped_resolution_root_yaml_finds_global
    run_test test_scoped_resolution_root_yaml_rejects_project_prefix
    run_test test_scoped_resolution_project_yaml_finds_local_first
    run_test test_scoped_resolution_project_yaml_falls_back_to_global
    run_test test_scoped_resolution_project_yaml_rejects_cross_project
    run_test test_scoped_resolution_project_yaml_allows_same_project_prefix
    run_test test_scoped_resolution_file_with_extension
    run_test test_scoped_resolution_not_found_error

    echo ""
    echo "============================================"
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "============================================"

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
    exit 0
}

main "$@"

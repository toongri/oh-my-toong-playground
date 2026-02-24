#!/bin/bash
# =============================================================================
# Validate Components Tests - CLI Project File Validation
# Tests for CLI project file existence verification
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Test utilities
TESTS_PASSED=0
TESTS_FAILED=0
CURRENT_TEST=""

# Save the actual root directory (before sourcing overwrites it)
ACTUAL_ROOT_DIR="$ROOT_DIR"

# Source the script to test its functions (but don't run main)
# We need to extract functions without running main
extract_functions_from_script() {
    # Create a temporary file with functions only (without main call)
    local tmp_script
    tmp_script=$(mktemp)

    # Copy script and remove the last line (main "$@")
    # macOS compatible approach
    local line_count
    line_count=$(wc -l < "$ACTUAL_ROOT_DIR/validate-components.sh" | tr -d ' ')
    local lines_to_keep=$((line_count - 1))

    head -n "$lines_to_keep" "$ACTUAL_ROOT_DIR/validate-components.sh" > "$tmp_script"

    # Source the functions (this will redefine SCRIPT_DIR and ROOT_DIR but we override them)
    source "$tmp_script"
    rm -f "$tmp_script"

    # Restore ROOT_DIR after sourcing
    ROOT_DIR="$ACTUAL_ROOT_DIR"
}

setup_test_env() {
    TEST_TMP_DIR=$(mktemp -d)

    # Create source structure mimicking oh-my-toong
    mkdir -p "$TEST_TMP_DIR/agents"
    mkdir -p "$TEST_TMP_DIR/commands"
    mkdir -p "$TEST_TMP_DIR/skills/tdd"
    mkdir -p "$TEST_TMP_DIR/hooks"
    mkdir -p "$TEST_TMP_DIR/projects"

    # Create sample source files
    echo "# Oracle Agent" > "$TEST_TMP_DIR/agents/oracle.md"
    echo "# Git Commit Command" > "$TEST_TMP_DIR/commands/git-commit.md"
    echo "# TDD Skill" > "$TEST_TMP_DIR/skills/tdd/SKILL.md"
    echo "#!/bin/bash" > "$TEST_TMP_DIR/hooks/test-hook"

    # Create target directory
    mkdir -p "$TEST_TMP_DIR/target"

    # Reset counters
    ERROR_COUNT=0
    WARN_COUNT=0

    # Extract and source functions
    extract_functions_from_script

    # Override ROOT_DIR for testing (must be after sourcing)
    ROOT_DIR="$TEST_TMP_DIR"
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
# Tests: get_cli_project_file function
# =============================================================================

test_get_cli_project_file_claude() {
    local result=$(get_cli_project_file "claude")
    if [[ "$result" == "CLAUDE.md" ]]; then
        return 0
    else
        echo "Expected CLAUDE.md, got: $result"
        return 1
    fi
}

test_get_cli_project_file_gemini() {
    local result=$(get_cli_project_file "gemini")
    if [[ "$result" == "GEMINI.md" ]]; then
        return 0
    else
        echo "Expected GEMINI.md, got: $result"
        return 1
    fi
}

test_get_cli_project_file_codex() {
    local result=$(get_cli_project_file "codex")
    if [[ "$result" == "AGENTS.md" ]]; then
        return 0
    else
        echo "Expected AGENTS.md, got: $result"
        return 1
    fi
}

test_get_cli_project_file_unknown() {
    local result=$(get_cli_project_file "unknown")
    if [[ "$result" == "" ]]; then
        return 0
    else
        echo "Expected empty string for unknown CLI, got: $result"
        return 1
    fi
}

# =============================================================================
# Tests: CLI Project File Validation - Claude Target
# =============================================================================

test_claude_target_missing_claude_md_fails() {
    # Create sync.yaml with claude target but NO CLAUDE.md in target path
    cat > "$TEST_TMP_DIR/sync.yaml" << EOF
name: test-project
path: $TEST_TMP_DIR/target
platforms:
  - claude
agents:
  items:
    - oracle
EOF

    # Target path does NOT have CLAUDE.md
    rm -f "$TEST_TMP_DIR/target/CLAUDE.md"

    # Reset error count
    ERROR_COUNT=0

    # Run validation, capture output to temp file (not subshell)
    local output_file="$TEST_TMP_DIR/output.txt"
    validate_cli_project_files "$TEST_TMP_DIR/sync.yaml" "$TEST_TMP_DIR/target" > "$output_file" 2>&1

    # Should have errors
    if [[ $ERROR_COUNT -gt 0 ]]; then
        # Check error message contains CLAUDE.md
        if grep -q "CLAUDE.md" "$output_file"; then
            return 0
        else
            echo "Error message should mention CLAUDE.md, got: $(cat "$output_file")"
            return 1
        fi
    else
        echo "Validation should fail when CLAUDE.md is missing for claude target"
        return 1
    fi
}

test_claude_target_with_claude_md_passes() {
    # Create sync.yaml with claude target AND CLAUDE.md exists
    cat > "$TEST_TMP_DIR/sync.yaml" << EOF
name: test-project
path: $TEST_TMP_DIR/target
platforms:
  - claude
agents:
  items:
    - oracle
EOF

    # Create CLAUDE.md in target path
    echo "# CLAUDE.md" > "$TEST_TMP_DIR/target/CLAUDE.md"

    # Reset error count
    ERROR_COUNT=0

    # Run validation
    validate_cli_project_files "$TEST_TMP_DIR/sync.yaml" "$TEST_TMP_DIR/target" 2>/dev/null

    # Should have no errors
    if [[ $ERROR_COUNT -eq 0 ]]; then
        return 0
    else
        echo "Validation should pass when CLAUDE.md exists for claude target"
        return 1
    fi
}

# =============================================================================
# Tests: CLI Project File Validation - Gemini Target
# =============================================================================

test_gemini_target_missing_gemini_md_fails() {
    # Create sync.yaml with gemini target but NO GEMINI.md in target path
    cat > "$TEST_TMP_DIR/sync.yaml" << EOF
name: test-project
path: $TEST_TMP_DIR/target
platforms:
  - gemini
agents:
  items:
    - oracle
EOF

    # Target path does NOT have GEMINI.md
    rm -f "$TEST_TMP_DIR/target/GEMINI.md"

    # Reset error count
    ERROR_COUNT=0

    # Run validation, capture output to temp file (not subshell)
    local output_file="$TEST_TMP_DIR/output.txt"
    validate_cli_project_files "$TEST_TMP_DIR/sync.yaml" "$TEST_TMP_DIR/target" > "$output_file" 2>&1

    # Should have errors
    if [[ $ERROR_COUNT -gt 0 ]]; then
        if grep -q "GEMINI.md" "$output_file"; then
            return 0
        else
            echo "Error message should mention GEMINI.md, got: $(cat "$output_file")"
            return 1
        fi
    else
        echo "Validation should fail when GEMINI.md is missing for gemini target"
        return 1
    fi
}

test_gemini_target_with_gemini_md_passes() {
    # Create sync.yaml with gemini target AND GEMINI.md exists
    cat > "$TEST_TMP_DIR/sync.yaml" << EOF
name: test-project
path: $TEST_TMP_DIR/target
platforms:
  - gemini
agents:
  items:
    - oracle
EOF

    # Create GEMINI.md in target path
    echo "# GEMINI.md" > "$TEST_TMP_DIR/target/GEMINI.md"

    # Reset error count
    ERROR_COUNT=0

    # Run validation
    validate_cli_project_files "$TEST_TMP_DIR/sync.yaml" "$TEST_TMP_DIR/target" 2>/dev/null

    # Should have no errors
    if [[ $ERROR_COUNT -eq 0 ]]; then
        return 0
    else
        echo "Validation should pass when GEMINI.md exists for gemini target"
        return 1
    fi
}

# =============================================================================
# Tests: CLI Project File Validation - Codex Target
# =============================================================================

test_codex_target_missing_agents_md_fails() {
    # Create sync.yaml with codex target but NO AGENTS.md in target path
    cat > "$TEST_TMP_DIR/sync.yaml" << EOF
name: test-project
path: $TEST_TMP_DIR/target
platforms:
  - codex
agents:
  items:
    - oracle
EOF

    # Target path does NOT have AGENTS.md
    rm -f "$TEST_TMP_DIR/target/AGENTS.md"

    # Reset error count
    ERROR_COUNT=0

    # Run validation, capture output to temp file (not subshell)
    local output_file="$TEST_TMP_DIR/output.txt"
    validate_cli_project_files "$TEST_TMP_DIR/sync.yaml" "$TEST_TMP_DIR/target" > "$output_file" 2>&1

    # Should have errors
    if [[ $ERROR_COUNT -gt 0 ]]; then
        if grep -q "AGENTS.md" "$output_file"; then
            return 0
        else
            echo "Error message should mention AGENTS.md, got: $(cat "$output_file")"
            return 1
        fi
    else
        echo "Validation should fail when AGENTS.md is missing for codex target"
        return 1
    fi
}

test_codex_target_with_agents_md_passes() {
    # Create sync.yaml with codex target AND AGENTS.md exists
    cat > "$TEST_TMP_DIR/sync.yaml" << EOF
name: test-project
path: $TEST_TMP_DIR/target
platforms:
  - codex
agents:
  items:
    - oracle
EOF

    # Create AGENTS.md in target path
    echo "# AGENTS.md" > "$TEST_TMP_DIR/target/AGENTS.md"

    # Reset error count
    ERROR_COUNT=0

    # Run validation
    validate_cli_project_files "$TEST_TMP_DIR/sync.yaml" "$TEST_TMP_DIR/target" 2>/dev/null

    # Should have no errors
    if [[ $ERROR_COUNT -eq 0 ]]; then
        return 0
    else
        echo "Validation should pass when AGENTS.md exists for codex target"
        return 1
    fi
}

# =============================================================================
# Tests: CLI Project File Validation - Multiple Targets
# =============================================================================

test_multiple_targets_all_files_required() {
    # Create sync.yaml with multiple targets - all project files required
    cat > "$TEST_TMP_DIR/sync.yaml" << EOF
name: test-project
path: $TEST_TMP_DIR/target
platforms:
  - claude
  - gemini
  - codex
agents:
  items:
    - oracle
EOF

    # Target path only has CLAUDE.md (missing GEMINI.md and AGENTS.md)
    echo "# CLAUDE.md" > "$TEST_TMP_DIR/target/CLAUDE.md"
    rm -f "$TEST_TMP_DIR/target/GEMINI.md"
    rm -f "$TEST_TMP_DIR/target/AGENTS.md"

    # Reset error count
    ERROR_COUNT=0

    # Run validation
    validate_cli_project_files "$TEST_TMP_DIR/sync.yaml" "$TEST_TMP_DIR/target" 2>/dev/null

    # Should have 2 errors (GEMINI.md and AGENTS.md missing)
    if [[ $ERROR_COUNT -ge 2 ]]; then
        return 0
    else
        echo "Validation should report 2 errors for missing GEMINI.md and AGENTS.md, got: $ERROR_COUNT"
        return 1
    fi
}

test_multiple_targets_all_files_present_passes() {
    # Create sync.yaml with multiple targets - all project files present
    cat > "$TEST_TMP_DIR/sync.yaml" << EOF
name: test-project
path: $TEST_TMP_DIR/target
platforms:
  - claude
  - gemini
  - codex
agents:
  items:
    - oracle
EOF

    # Create all CLI project files
    echo "# CLAUDE.md" > "$TEST_TMP_DIR/target/CLAUDE.md"
    echo "# GEMINI.md" > "$TEST_TMP_DIR/target/GEMINI.md"
    echo "# AGENTS.md" > "$TEST_TMP_DIR/target/AGENTS.md"

    # Reset error count
    ERROR_COUNT=0

    # Run validation
    validate_cli_project_files "$TEST_TMP_DIR/sync.yaml" "$TEST_TMP_DIR/target" 2>/dev/null

    # Should have no errors
    if [[ $ERROR_COUNT -eq 0 ]]; then
        return 0
    else
        echo "Validation should pass when all CLI project files exist"
        return 1
    fi
}

# =============================================================================
# Tests: CLI Project File Validation - Component-level targets
# =============================================================================

test_component_targets_override_default() {
    # Create sync.yaml with component-level targets that add gemini
    cat > "$TEST_TMP_DIR/sync.yaml" << EOF
name: test-project
path: $TEST_TMP_DIR/target
platforms:
  - claude
agents:
  items:
    - component: oracle
      platforms:
        - gemini
EOF

    # Create only CLAUDE.md and GEMINI.md
    echo "# CLAUDE.md" > "$TEST_TMP_DIR/target/CLAUDE.md"
    echo "# GEMINI.md" > "$TEST_TMP_DIR/target/GEMINI.md"

    # Reset error count
    ERROR_COUNT=0

    # Run validation
    validate_cli_project_files "$TEST_TMP_DIR/sync.yaml" "$TEST_TMP_DIR/target" 2>/dev/null

    # Should pass - both claude (default) and gemini (component) files exist
    if [[ $ERROR_COUNT -eq 0 ]]; then
        return 0
    else
        echo "Validation should pass when both default and component target files exist"
        return 1
    fi
}

test_component_targets_adds_to_required_files() {
    # Create sync.yaml where component targets add additional required files
    cat > "$TEST_TMP_DIR/sync.yaml" << EOF
name: test-project
path: $TEST_TMP_DIR/target
platforms:
  - claude
agents:
  items:
    - component: oracle
      platforms:
        - gemini
commands:
  items:
    - git-commit
EOF

    # Target path only has CLAUDE.md (missing GEMINI.md for agent)
    echo "# CLAUDE.md" > "$TEST_TMP_DIR/target/CLAUDE.md"
    rm -f "$TEST_TMP_DIR/target/GEMINI.md"

    # Reset error count
    ERROR_COUNT=0

    # Run validation
    validate_cli_project_files "$TEST_TMP_DIR/sync.yaml" "$TEST_TMP_DIR/target" 2>/dev/null

    # Should have 1 error (GEMINI.md missing)
    if [[ $ERROR_COUNT -ge 1 ]]; then
        return 0
    else
        echo "Validation should fail when component target CLI file is missing"
        return 1
    fi
}

# =============================================================================
# Tests: Error Message Format
# =============================================================================

test_error_message_format() {
    # Create sync.yaml with claude target but NO CLAUDE.md
    cat > "$TEST_TMP_DIR/sync.yaml" << EOF
name: test-project
path: $TEST_TMP_DIR/target
platforms:
  - claude
agents:
  items:
    - oracle
EOF

    # Target path does NOT have CLAUDE.md
    rm -f "$TEST_TMP_DIR/target/CLAUDE.md"

    # Reset error count
    ERROR_COUNT=0

    # Run validation and capture output
    local output
    output=$(validate_cli_project_files "$TEST_TMP_DIR/sync.yaml" "$TEST_TMP_DIR/target" 2>&1)

    # Check error message format matches requirement:
    # [ERROR] CLI 프로젝트 파일 없음: CLAUDE.md (대상: /path/to/project)
    if echo "$output" | grep -qE "\[ERROR\].*CLI.*CLAUDE.md.*\(.*:.*\)"; then
        return 0
    else
        echo "Error message format does not match required format"
        echo "Expected: [ERROR] CLI 프로젝트 파일 없음: CLAUDE.md (대상: /path)"
        echo "Got: $output"
        return 1
    fi
}

test_error_suggests_init_command() {
    # Create sync.yaml with claude target but NO CLAUDE.md
    cat > "$TEST_TMP_DIR/sync.yaml" << EOF
name: test-project
path: $TEST_TMP_DIR/target
platforms:
  - claude
agents:
  items:
    - oracle
EOF

    # Target path does NOT have CLAUDE.md
    rm -f "$TEST_TMP_DIR/target/CLAUDE.md"

    # Reset error count
    ERROR_COUNT=0

    # Run validation and capture output
    local output
    output=$(validate_cli_project_files "$TEST_TMP_DIR/sync.yaml" "$TEST_TMP_DIR/target" 2>&1)

    # Check that error message suggests running init
    if echo "$output" | grep -q "init"; then
        return 0
    else
        echo "Error message should suggest running 'init'"
        echo "Got: $output"
        return 1
    fi
}

# =============================================================================
# Tests: Full Integration - validate_components function
# =============================================================================

test_validate_components_calls_cli_validation() {
    # Create sync.yaml with claude target but NO CLAUDE.md
    mkdir -p "$TEST_TMP_DIR/projects/test-proj"
    cat > "$TEST_TMP_DIR/projects/test-proj/sync.yaml" << EOF
name: test-project
path: $TEST_TMP_DIR/target
platforms:
  - claude
agents:
  items:
    - oracle
EOF

    # Target path does NOT have CLAUDE.md
    rm -f "$TEST_TMP_DIR/target/CLAUDE.md"

    # Reset error count
    ERROR_COUNT=0

    # Run full validate_components, capture output to temp file (not subshell)
    local output_file="$TEST_TMP_DIR/output.txt"
    validate_components "$TEST_TMP_DIR/projects/test-proj/sync.yaml" > "$output_file" 2>&1

    # Should have errors for missing CLAUDE.md
    if [[ $ERROR_COUNT -gt 0 ]]; then
        if grep -q "CLAUDE.md" "$output_file"; then
            return 0
        else
            echo "Error message should mention CLAUDE.md"
            return 1
        fi
    else
        echo "validate_components should call CLI project file validation"
        return 1
    fi
}

test_validate_components_skips_template_yaml() {
    # Create sync.yaml WITHOUT path (template state)
    mkdir -p "$TEST_TMP_DIR/projects/test-proj"
    cat > "$TEST_TMP_DIR/projects/test-proj/sync.yaml" << EOF
name: test-project
platforms:
  - claude
agents:
  items:
    - oracle
EOF

    # Reset counters
    ERROR_COUNT=0
    WARN_COUNT=0

    # Run full validate_components
    validate_components "$TEST_TMP_DIR/projects/test-proj/sync.yaml" 2>/dev/null

    # Should have no errors (template state should be skipped)
    if [[ $ERROR_COUNT -eq 0 ]]; then
        return 0
    else
        echo "validate_components should skip CLI validation for template YAML"
        return 1
    fi
}

# =============================================================================
# Tests: Scoped Component Validation - Context Variables
# =============================================================================

test_defines_current_project_context_variable() {
    # Script should define CURRENT_PROJECT_CONTEXT variable
    if grep -q "CURRENT_PROJECT_CONTEXT=" "$ACTUAL_ROOT_DIR/validate-components.sh"; then
        return 0
    else
        echo "Script should define CURRENT_PROJECT_CONTEXT variable"
        return 1
    fi
}

test_defines_is_root_yaml_context_variable() {
    # Script should define IS_ROOT_YAML_CONTEXT variable
    if grep -q "IS_ROOT_YAML_CONTEXT=" "$ACTUAL_ROOT_DIR/validate-components.sh"; then
        return 0
    else
        echo "Script should define IS_ROOT_YAML_CONTEXT variable"
        return 1
    fi
}

# =============================================================================
# Tests: Scoped Component Validation - Function Existence
# =============================================================================

test_defines_validate_scoped_component_function() {
    # Script should define validate_scoped_component function
    if grep -q "validate_scoped_component()" "$ACTUAL_ROOT_DIR/validate-components.sh"; then
        return 0
    else
        echo "Script should define validate_scoped_component() function"
        return 1
    fi
}

# =============================================================================
# Tests: Root YAML cannot reference project components
# =============================================================================

test_root_yaml_rejects_project_component_reference() {
    # Root sync.yaml should NOT be allowed to reference project components (e.g., my-proj:oracle)
    cat > "$TEST_TMP_DIR/sync.yaml" << EOF
name: root
path: $TEST_TMP_DIR/target
platforms:
  - claude
agents:
  items:
    - my-proj:oracle
EOF

    # Create target CLAUDE.md
    echo "# CLAUDE.md" > "$TEST_TMP_DIR/target/CLAUDE.md"

    # Create the project component (it exists but should be rejected)
    mkdir -p "$TEST_TMP_DIR/projects/my-proj/agents"
    echo "# Oracle Agent" > "$TEST_TMP_DIR/projects/my-proj/agents/oracle.md"

    # Reset error count
    ERROR_COUNT=0

    # Run validation, capture output
    local output_file="$TEST_TMP_DIR/output.txt"
    validate_components "$TEST_TMP_DIR/sync.yaml" > "$output_file" 2>&1

    # Should have error for cross-project reference from root
    if [[ $ERROR_COUNT -gt 0 ]]; then
        if grep -qi "Root sync.yaml cannot reference project components" "$output_file"; then
            return 0
        else
            echo "Error message should mention Root sync.yaml cannot reference project components"
            echo "Got: $(cat "$output_file")"
            return 1
        fi
    else
        echo "Root sync.yaml should fail when referencing project components"
        return 1
    fi
}

# =============================================================================
# Tests: Project YAML cannot reference other project components
# =============================================================================

test_project_yaml_rejects_other_project_component() {
    # Project sync.yaml should NOT reference another project's components
    mkdir -p "$TEST_TMP_DIR/projects/project-a"
    cat > "$TEST_TMP_DIR/projects/project-a/sync.yaml" << EOF
name: project-a
path: $TEST_TMP_DIR/target
platforms:
  - claude
agents:
  items:
    - project-b:oracle
EOF

    # Create target CLAUDE.md
    echo "# CLAUDE.md" > "$TEST_TMP_DIR/target/CLAUDE.md"

    # Create project-b's component (exists but should be rejected)
    mkdir -p "$TEST_TMP_DIR/projects/project-b/agents"
    echo "# Oracle Agent" > "$TEST_TMP_DIR/projects/project-b/agents/oracle.md"

    # Reset error count
    ERROR_COUNT=0

    # Run validation, capture output
    local output_file="$TEST_TMP_DIR/output.txt"
    validate_components "$TEST_TMP_DIR/projects/project-a/sync.yaml" > "$output_file" 2>&1

    # Should have error for cross-project reference
    if [[ $ERROR_COUNT -gt 0 ]]; then
        if grep -qi "cross-project\|not allowed" "$output_file"; then
            return 0
        else
            echo "Error message should mention cross-project reference not allowed"
            echo "Got: $(cat "$output_file")"
            return 1
        fi
    else
        echo "Project sync.yaml should fail when referencing other project components"
        return 1
    fi
}

# =============================================================================
# Tests: Project YAML can reference own project components
# =============================================================================

test_project_yaml_accepts_own_project_component() {
    # Project sync.yaml CAN reference its own project's components
    mkdir -p "$TEST_TMP_DIR/projects/my-proj"
    cat > "$TEST_TMP_DIR/projects/my-proj/sync.yaml" << EOF
name: my-proj
path: $TEST_TMP_DIR/target
platforms:
  - claude
agents:
  items:
    - my-proj:custom-agent
EOF

    # Create target CLAUDE.md
    echo "# CLAUDE.md" > "$TEST_TMP_DIR/target/CLAUDE.md"

    # Create my-proj's own component
    mkdir -p "$TEST_TMP_DIR/projects/my-proj/agents"
    echo "# Custom Agent" > "$TEST_TMP_DIR/projects/my-proj/agents/custom-agent.md"

    # Reset error count
    ERROR_COUNT=0

    # Run validation
    validate_components "$TEST_TMP_DIR/projects/my-proj/sync.yaml" 2>/dev/null

    # Should have no errors
    if [[ $ERROR_COUNT -eq 0 ]]; then
        return 0
    else
        echo "Project sync.yaml should be allowed to reference its own project components"
        return 1
    fi
}

# =============================================================================
# Tests: Project YAML can reference global components
# =============================================================================

test_project_yaml_accepts_global_component() {
    # Project sync.yaml CAN reference global components (no project prefix)
    mkdir -p "$TEST_TMP_DIR/projects/my-proj"
    cat > "$TEST_TMP_DIR/projects/my-proj/sync.yaml" << EOF
name: my-proj
path: $TEST_TMP_DIR/target
platforms:
  - claude
agents:
  items:
    - oracle
EOF

    # Create target CLAUDE.md
    echo "# CLAUDE.md" > "$TEST_TMP_DIR/target/CLAUDE.md"

    # Global oracle already exists from setup_test_env
    # Reset error count
    ERROR_COUNT=0

    # Run validation
    validate_components "$TEST_TMP_DIR/projects/my-proj/sync.yaml" 2>/dev/null

    # Should have no errors
    if [[ $ERROR_COUNT -eq 0 ]]; then
        return 0
    else
        echo "Project sync.yaml should be allowed to reference global components"
        return 1
    fi
}

# =============================================================================
# Tests: Root YAML can reference global components
# =============================================================================

test_root_yaml_accepts_global_component() {
    # Root sync.yaml CAN reference global components
    cat > "$TEST_TMP_DIR/sync.yaml" << EOF
name: root
path: $TEST_TMP_DIR/target
platforms:
  - claude
agents:
  items:
    - oracle
EOF

    # Create target CLAUDE.md
    echo "# CLAUDE.md" > "$TEST_TMP_DIR/target/CLAUDE.md"

    # Global oracle already exists from setup_test_env
    # Reset error count
    ERROR_COUNT=0

    # Run validation
    validate_components "$TEST_TMP_DIR/sync.yaml" 2>/dev/null

    # Should have no errors
    if [[ $ERROR_COUNT -eq 0 ]]; then
        return 0
    else
        echo "Root sync.yaml should be allowed to reference global components"
        return 1
    fi
}

# =============================================================================
# Tests: Upward search for project YAML
# =============================================================================

test_project_yaml_searches_project_then_global() {
    # Project sync.yaml should search project-specific location first, then global
    mkdir -p "$TEST_TMP_DIR/projects/my-proj"
    cat > "$TEST_TMP_DIR/projects/my-proj/sync.yaml" << EOF
name: my-proj
path: $TEST_TMP_DIR/target
platforms:
  - claude
skills:
  items:
    - custom-skill
EOF

    # Create target CLAUDE.md
    echo "# CLAUDE.md" > "$TEST_TMP_DIR/target/CLAUDE.md"

    # Create component in project-specific location (should be found)
    mkdir -p "$TEST_TMP_DIR/projects/my-proj/skills/custom-skill"
    echo "# Custom Skill" > "$TEST_TMP_DIR/projects/my-proj/skills/custom-skill/SKILL.md"

    # Reset error count
    ERROR_COUNT=0

    # Run validation
    validate_components "$TEST_TMP_DIR/projects/my-proj/sync.yaml" 2>/dev/null

    # Should have no errors (found in project location)
    if [[ $ERROR_COUNT -eq 0 ]]; then
        return 0
    else
        echo "Project sync.yaml should find component in project-specific location"
        return 1
    fi
}

test_project_yaml_falls_back_to_global() {
    # Project sync.yaml should fall back to global if not found in project
    mkdir -p "$TEST_TMP_DIR/projects/my-proj"
    cat > "$TEST_TMP_DIR/projects/my-proj/sync.yaml" << EOF
name: my-proj
path: $TEST_TMP_DIR/target
platforms:
  - claude
skills:
  items:
    - tdd
EOF

    # Create target CLAUDE.md
    echo "# CLAUDE.md" > "$TEST_TMP_DIR/target/CLAUDE.md"

    # tdd skill exists in global from setup_test_env
    # No project-specific override
    # Reset error count
    ERROR_COUNT=0

    # Run validation
    validate_components "$TEST_TMP_DIR/projects/my-proj/sync.yaml" 2>/dev/null

    # Should have no errors (found in global location)
    if [[ $ERROR_COUNT -eq 0 ]]; then
        return 0
    else
        echo "Project sync.yaml should fall back to global when component not in project"
        return 1
    fi
}

# =============================================================================
# Tests: Missing component with search paths in error
# =============================================================================

test_missing_component_shows_search_paths() {
    # When component not found, error should show search paths
    mkdir -p "$TEST_TMP_DIR/projects/my-proj"
    cat > "$TEST_TMP_DIR/projects/my-proj/sync.yaml" << EOF
name: my-proj
path: $TEST_TMP_DIR/target
platforms:
  - claude
skills:
  items:
    - nonexistent-skill
EOF

    # Create target CLAUDE.md
    echo "# CLAUDE.md" > "$TEST_TMP_DIR/target/CLAUDE.md"

    # Component does not exist anywhere
    # Reset error count
    ERROR_COUNT=0

    # Run validation, capture output
    local output_file="$TEST_TMP_DIR/output.txt"
    validate_components "$TEST_TMP_DIR/projects/my-proj/sync.yaml" > "$output_file" 2>&1

    # Should have error with search paths
    if [[ $ERROR_COUNT -gt 0 ]]; then
        if grep -q "Searched:" "$output_file"; then
            return 0
        else
            echo "Error message should show search paths"
            echo "Got: $(cat "$output_file")"
            return 1
        fi
    else
        echo "Validation should fail for missing component"
        return 1
    fi
}

# =============================================================================
# Tests: Rules Component Validation
# =============================================================================

test_rules_validation_passes_with_existing_global_rule() {
    # Rules validation should pass when rule .md file exists in global rules/
    cat > "$TEST_TMP_DIR/sync.yaml" << EOF
name: root
path: $TEST_TMP_DIR/target
platforms:
  - claude
rules:
  items:
    - tool-usage-policy
EOF

    # Create target CLAUDE.md
    echo "# CLAUDE.md" > "$TEST_TMP_DIR/target/CLAUDE.md"

    # Create global rule source file
    mkdir -p "$TEST_TMP_DIR/rules"
    echo "# Tool Usage Policy" > "$TEST_TMP_DIR/rules/tool-usage-policy.md"

    # Reset error count
    ERROR_COUNT=0

    # Run validation
    validate_components "$TEST_TMP_DIR/sync.yaml" 2>/dev/null

    # Should have no errors
    if [[ $ERROR_COUNT -eq 0 ]]; then
        return 0
    else
        echo "Rules validation should pass when global rule .md file exists"
        return 1
    fi
}

test_rules_validation_fails_with_missing_rule() {
    # Rules validation should fail when rule .md file does not exist
    cat > "$TEST_TMP_DIR/sync.yaml" << EOF
name: root
path: $TEST_TMP_DIR/target
platforms:
  - claude
rules:
  items:
    - nonexistent-rule
EOF

    # Create target CLAUDE.md
    echo "# CLAUDE.md" > "$TEST_TMP_DIR/target/CLAUDE.md"

    # No rule source file exists
    # Reset error count
    ERROR_COUNT=0

    # Run validation, capture output
    local output_file="$TEST_TMP_DIR/output.txt"
    validate_components "$TEST_TMP_DIR/sync.yaml" > "$output_file" 2>&1

    # Should have errors
    if [[ $ERROR_COUNT -gt 0 ]]; then
        return 0
    else
        echo "Rules validation should fail when rule .md file does not exist"
        return 1
    fi
}

test_rules_validation_project_upward_search() {
    # Project sync.yaml should search project rules/ then global rules/
    mkdir -p "$TEST_TMP_DIR/projects/my-proj"
    cat > "$TEST_TMP_DIR/projects/my-proj/sync.yaml" << EOF
name: my-proj
path: $TEST_TMP_DIR/target
platforms:
  - claude
rules:
  items:
    - project-rule
EOF

    # Create target CLAUDE.md
    echo "# CLAUDE.md" > "$TEST_TMP_DIR/target/CLAUDE.md"

    # Create rule in project-specific location
    mkdir -p "$TEST_TMP_DIR/projects/my-proj/rules"
    echo "# Project Rule" > "$TEST_TMP_DIR/projects/my-proj/rules/project-rule.md"

    # Reset error count
    ERROR_COUNT=0

    # Run validation
    validate_components "$TEST_TMP_DIR/projects/my-proj/sync.yaml" 2>/dev/null

    # Should have no errors (found in project location)
    if [[ $ERROR_COUNT -eq 0 ]]; then
        return 0
    else
        echo "Rules validation should find rule in project-specific location"
        return 1
    fi
}

test_rules_validation_falls_back_to_global() {
    # Project sync.yaml should fall back to global rules/ if not in project
    mkdir -p "$TEST_TMP_DIR/projects/my-proj"
    cat > "$TEST_TMP_DIR/projects/my-proj/sync.yaml" << EOF
name: my-proj
path: $TEST_TMP_DIR/target
platforms:
  - claude
rules:
  items:
    - tool-usage-policy
EOF

    # Create target CLAUDE.md
    echo "# CLAUDE.md" > "$TEST_TMP_DIR/target/CLAUDE.md"

    # Create rule in global location only
    mkdir -p "$TEST_TMP_DIR/rules"
    echo "# Tool Usage Policy" > "$TEST_TMP_DIR/rules/tool-usage-policy.md"

    # Reset error count
    ERROR_COUNT=0

    # Run validation
    validate_components "$TEST_TMP_DIR/projects/my-proj/sync.yaml" 2>/dev/null

    # Should have no errors (found in global location)
    if [[ $ERROR_COUNT -eq 0 ]]; then
        return 0
    else
        echo "Rules validation should fall back to global rules/"
        return 1
    fi
}

# =============================================================================
# Tests: MCP Component Validation
# =============================================================================

test_mcps_component_found() {
    # MCP component validation should pass when mcps/test.yaml exists
    cat > "$TEST_TMP_DIR/sync.yaml" << EOF
name: root
path: $TEST_TMP_DIR/target
platforms:
  - claude
mcps:
  items:
    - test-server
EOF

    # Create target CLAUDE.md
    echo "# CLAUDE.md" > "$TEST_TMP_DIR/target/CLAUDE.md"

    # Create mcps source file
    mkdir -p "$TEST_TMP_DIR/mcps"
    cat > "$TEST_TMP_DIR/mcps/test-server.yaml" << 'MCPEOF'
command: echo
args:
  - "test"
MCPEOF

    # Reset error count
    ERROR_COUNT=0

    # Run validation
    validate_components "$TEST_TMP_DIR/sync.yaml" 2>/dev/null

    # Should have no errors
    if [[ $ERROR_COUNT -eq 0 ]]; then
        return 0
    else
        echo "MCP component validation should pass when .yaml file exists"
        return 1
    fi
}

test_mcps_component_missing() {
    # MCP component validation should fail when mcps/nonexistent.yaml does not exist
    cat > "$TEST_TMP_DIR/sync.yaml" << EOF
name: root
path: $TEST_TMP_DIR/target
platforms:
  - claude
mcps:
  items:
    - nonexistent-server
EOF

    # Create target CLAUDE.md
    echo "# CLAUDE.md" > "$TEST_TMP_DIR/target/CLAUDE.md"

    # No mcps/ directory or file created
    # Reset error count
    ERROR_COUNT=0

    # Run validation, capture output
    local output_file="$TEST_TMP_DIR/output.txt"
    validate_components "$TEST_TMP_DIR/sync.yaml" > "$output_file" 2>&1

    # Should have errors
    if [[ $ERROR_COUNT -gt 0 ]]; then
        return 0
    else
        echo "MCP component validation should fail when .yaml file does not exist"
        return 1
    fi
}

# =============================================================================
# Main Test Runner
# =============================================================================

main() {
    echo "=========================================="
    echo "Validate Components Tests - CLI Project Files"
    echo "=========================================="

    # get_cli_project_file tests
    run_test test_get_cli_project_file_claude
    run_test test_get_cli_project_file_gemini
    run_test test_get_cli_project_file_codex
    run_test test_get_cli_project_file_unknown

    # Claude target tests
    run_test test_claude_target_missing_claude_md_fails
    run_test test_claude_target_with_claude_md_passes

    # Gemini target tests
    run_test test_gemini_target_missing_gemini_md_fails
    run_test test_gemini_target_with_gemini_md_passes

    # Codex target tests
    run_test test_codex_target_missing_agents_md_fails
    run_test test_codex_target_with_agents_md_passes

    # Multiple targets tests
    run_test test_multiple_targets_all_files_required
    run_test test_multiple_targets_all_files_present_passes

    # Component-level targets tests
    run_test test_component_targets_override_default
    run_test test_component_targets_adds_to_required_files

    # Error message format tests
    run_test test_error_message_format
    run_test test_error_suggests_init_command

    # Full integration tests
    run_test test_validate_components_calls_cli_validation
    run_test test_validate_components_skips_template_yaml

    # Scoped validation - context variables
    run_test test_defines_current_project_context_variable
    run_test test_defines_is_root_yaml_context_variable

    # Scoped validation - function existence
    run_test test_defines_validate_scoped_component_function

    # Scoped validation - root yaml restrictions
    run_test test_root_yaml_rejects_project_component_reference
    run_test test_root_yaml_accepts_global_component

    # Scoped validation - project yaml restrictions
    run_test test_project_yaml_rejects_other_project_component
    run_test test_project_yaml_accepts_own_project_component
    run_test test_project_yaml_accepts_global_component

    # Scoped validation - upward search
    run_test test_project_yaml_searches_project_then_global
    run_test test_project_yaml_falls_back_to_global

    # Scoped validation - error messages
    run_test test_missing_component_shows_search_paths

    # Rules component validation
    run_test test_rules_validation_passes_with_existing_global_rule
    run_test test_rules_validation_fails_with_missing_rule
    run_test test_rules_validation_project_upward_search
    run_test test_rules_validation_falls_back_to_global

    # MCP component validation
    run_test test_mcps_component_found
    run_test test_mcps_component_missing

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
}

main "$@"

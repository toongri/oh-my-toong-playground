#!/bin/bash
# =============================================================================
# Items Structure Tests - New sync.yaml Category Format
# Tests for items structure in agents, commands, hooks, skills sections
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS_DIR="$SCRIPT_DIR"
ROOT_DIR="$(dirname "$SCRIPTS_DIR")"

VALIDATE_SCHEMA="$ROOT_DIR/scripts/validate-schema.sh"

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
# Tests: agents section with items structure
# =============================================================================

test_agents_items_simple_string_valid() {
    # agents.items can contain simple strings (component names)
    cat > "$TEST_TMP_DIR/sync.yaml" << 'EOF'
name: test-project
path: /tmp/test
agents:
  items:
    - oracle
    - prometheus
EOF

    if "$VALIDATE_SCHEMA" "$TEST_TMP_DIR/sync.yaml" 2>/dev/null; then
        return 0
    else
        echo "Validation should pass for agents.items with simple strings"
        return 1
    fi
}

test_agents_items_object_form_valid() {
    # agents.items can contain objects with component field
    cat > "$TEST_TMP_DIR/sync.yaml" << 'EOF'
name: test-project
path: /tmp/test
agents:
  items:
    - component: oracle
      platforms: ["claude"]
    - component: prometheus
      add-skills: [explore]
EOF

    if "$VALIDATE_SCHEMA" "$TEST_TMP_DIR/sync.yaml" 2>/dev/null; then
        return 0
    else
        echo "Validation should pass for agents.items with object form"
        return 1
    fi
}

test_agents_items_mixed_format_valid() {
    # agents.items can mix simple strings and objects
    cat > "$TEST_TMP_DIR/sync.yaml" << 'EOF'
name: test-project
path: /tmp/test
agents:
  items:
    - oracle
    - component: prometheus
      platforms: ["gemini"]
    - explore
EOF

    if "$VALIDATE_SCHEMA" "$TEST_TMP_DIR/sync.yaml" 2>/dev/null; then
        return 0
    else
        echo "Validation should pass for agents.items with mixed format"
        return 1
    fi
}

test_agents_section_level_platforms() {
    # agents can have section-level platforms
    cat > "$TEST_TMP_DIR/sync.yaml" << 'EOF'
name: test-project
path: /tmp/test
agents:
  platforms: ["claude", "gemini"]
  items:
    - oracle
    - prometheus
EOF

    if "$VALIDATE_SCHEMA" "$TEST_TMP_DIR/sync.yaml" 2>/dev/null; then
        return 0
    else
        echo "Validation should pass for agents with section-level platforms"
        return 1
    fi
}

test_agents_missing_items_fails() {
    # agents without items should fail (if using new structure)
    cat > "$TEST_TMP_DIR/sync.yaml" << 'EOF'
name: test-project
path: /tmp/test
agents:
  platforms: ["claude"]
EOF

    if "$VALIDATE_SCHEMA" "$TEST_TMP_DIR/sync.yaml" 2>/dev/null; then
        echo "Validation should fail for agents without items"
        return 1
    else
        return 0
    fi
}

# =============================================================================
# Tests: commands section with items structure
# =============================================================================

test_commands_items_simple_string_valid() {
    # commands.items can contain simple strings
    cat > "$TEST_TMP_DIR/sync.yaml" << 'EOF'
name: test-project
path: /tmp/test
commands:
  items:
    - cancel-ralph
    - review-pr
EOF

    if "$VALIDATE_SCHEMA" "$TEST_TMP_DIR/sync.yaml" 2>/dev/null; then
        return 0
    else
        echo "Validation should pass for commands.items with simple strings"
        return 1
    fi
}

test_commands_items_object_form_valid() {
    # commands.items can contain objects
    cat > "$TEST_TMP_DIR/sync.yaml" << 'EOF'
name: test-project
path: /tmp/test
commands:
  items:
    - component: cancel-ralph
      platforms: ["claude"]
EOF

    if "$VALIDATE_SCHEMA" "$TEST_TMP_DIR/sync.yaml" 2>/dev/null; then
        return 0
    else
        echo "Validation should pass for commands.items with object form"
        return 1
    fi
}

test_commands_section_level_platforms() {
    # commands can have section-level platforms
    cat > "$TEST_TMP_DIR/sync.yaml" << 'EOF'
name: test-project
path: /tmp/test
commands:
  platforms: ["claude"]
  items:
    - cancel-ralph
EOF

    if "$VALIDATE_SCHEMA" "$TEST_TMP_DIR/sync.yaml" 2>/dev/null; then
        return 0
    else
        echo "Validation should pass for commands with section-level platforms"
        return 1
    fi
}

# =============================================================================
# Tests: skills section with items structure
# =============================================================================

test_skills_items_simple_string_valid() {
    # skills.items can contain simple strings
    cat > "$TEST_TMP_DIR/sync.yaml" << 'EOF'
name: test-project
path: /tmp/test
skills:
  items:
    - prometheus
    - sisyphus
    - oracle
EOF

    if "$VALIDATE_SCHEMA" "$TEST_TMP_DIR/sync.yaml" 2>/dev/null; then
        return 0
    else
        echo "Validation should pass for skills.items with simple strings"
        return 1
    fi
}

test_skills_items_object_form_valid() {
    # skills.items can contain objects
    cat > "$TEST_TMP_DIR/sync.yaml" << 'EOF'
name: test-project
path: /tmp/test
skills:
  items:
    - component: prometheus
      platforms: ["gemini"]
EOF

    if "$VALIDATE_SCHEMA" "$TEST_TMP_DIR/sync.yaml" 2>/dev/null; then
        return 0
    else
        echo "Validation should pass for skills.items with object form"
        return 1
    fi
}

test_skills_section_level_platforms() {
    # skills can have section-level platforms
    cat > "$TEST_TMP_DIR/sync.yaml" << 'EOF'
name: test-project
path: /tmp/test
skills:
  platforms: ["claude", "codex"]
  items:
    - prometheus
    - oracle
EOF

    if "$VALIDATE_SCHEMA" "$TEST_TMP_DIR/sync.yaml" 2>/dev/null; then
        return 0
    else
        echo "Validation should pass for skills with section-level platforms"
        return 1
    fi
}

# =============================================================================
# Tests: hooks section with items structure (always object form)
# =============================================================================

test_hooks_items_object_form_valid() {
    # hooks.items must be objects (have event, component, etc.)
    cat > "$TEST_TMP_DIR/sync.yaml" << 'EOF'
name: test-project
path: /tmp/test
hooks:
  items:
    - component: keyword-detector.sh
      event: UserPromptSubmit
      timeout: 10
EOF

    if "$VALIDATE_SCHEMA" "$TEST_TMP_DIR/sync.yaml" 2>/dev/null; then
        return 0
    else
        echo "Validation should pass for hooks.items with object form"
        return 1
    fi
}

test_hooks_section_level_platforms() {
    # hooks can have section-level platforms
    cat > "$TEST_TMP_DIR/sync.yaml" << 'EOF'
name: test-project
path: /tmp/test
hooks:
  platforms: ["claude"]
  items:
    - component: session-start.sh
      event: SessionStart
      timeout: 10
EOF

    if "$VALIDATE_SCHEMA" "$TEST_TMP_DIR/sync.yaml" 2>/dev/null; then
        return 0
    else
        echo "Validation should pass for hooks with section-level platforms"
        return 1
    fi
}

test_hooks_items_with_item_level_platforms() {
    # hooks.items can have item-level platforms override
    cat > "$TEST_TMP_DIR/sync.yaml" << 'EOF'
name: test-project
path: /tmp/test
hooks:
  platforms: ["claude"]
  items:
    - component: session-start.sh
      event: SessionStart
      platforms: ["gemini"]
EOF

    if "$VALIDATE_SCHEMA" "$TEST_TMP_DIR/sync.yaml" 2>/dev/null; then
        return 0
    else
        echo "Validation should pass for hooks.items with item-level platforms"
        return 1
    fi
}

# =============================================================================
# Tests: Schema valid fields for new structure
# =============================================================================

test_agents_section_unknown_field_fails() {
    # agents section should reject unknown fields
    cat > "$TEST_TMP_DIR/sync.yaml" << 'EOF'
name: test-project
path: /tmp/test
agents:
  platforms: ["claude"]
  items:
    - oracle
  unknown_field: true
EOF

    if "$VALIDATE_SCHEMA" "$TEST_TMP_DIR/sync.yaml" 2>/dev/null; then
        echo "Validation should fail for unknown field in agents section"
        return 1
    else
        return 0
    fi
}

test_agents_items_unknown_field_fails() {
    # agents.items objects should reject unknown fields
    cat > "$TEST_TMP_DIR/sync.yaml" << 'EOF'
name: test-project
path: /tmp/test
agents:
  items:
    - component: oracle
      unknown_field: true
EOF

    if "$VALIDATE_SCHEMA" "$TEST_TMP_DIR/sync.yaml" 2>/dev/null; then
        echo "Validation should fail for unknown field in agents.items"
        return 1
    else
        return 0
    fi
}

# =============================================================================
# Tests: Old format should be REJECTED (no backward compatibility)
# =============================================================================

test_old_agents_format_rejected() {
    # Old format (array without items wrapper) should be REJECTED
    cat > "$TEST_TMP_DIR/sync.yaml" << 'EOF'
name: test-project
path: /tmp/test
agents:
  - component: oracle
  - component: prometheus
EOF

    if "$VALIDATE_SCHEMA" "$TEST_TMP_DIR/sync.yaml" 2>/dev/null; then
        echo "Validation should FAIL for old agents format (no backward compatibility)"
        return 1
    else
        return 0
    fi
}

test_old_commands_format_rejected() {
    # Old format (array without items wrapper) should be REJECTED
    cat > "$TEST_TMP_DIR/sync.yaml" << 'EOF'
name: test-project
path: /tmp/test
commands:
  - component: cancel-ralph
EOF

    if "$VALIDATE_SCHEMA" "$TEST_TMP_DIR/sync.yaml" 2>/dev/null; then
        echo "Validation should FAIL for old commands format (no backward compatibility)"
        return 1
    else
        return 0
    fi
}

test_old_skills_format_rejected() {
    # Old format (array without items wrapper) should be REJECTED
    cat > "$TEST_TMP_DIR/sync.yaml" << 'EOF'
name: test-project
path: /tmp/test
skills:
  - component: prometheus
EOF

    if "$VALIDATE_SCHEMA" "$TEST_TMP_DIR/sync.yaml" 2>/dev/null; then
        echo "Validation should FAIL for old skills format (no backward compatibility)"
        return 1
    else
        return 0
    fi
}

test_old_hooks_format_rejected() {
    # Old format (array without items wrapper) should be REJECTED
    cat > "$TEST_TMP_DIR/sync.yaml" << 'EOF'
name: test-project
path: /tmp/test
hooks:
  - component: session-start.sh
    event: SessionStart
EOF

    if "$VALIDATE_SCHEMA" "$TEST_TMP_DIR/sync.yaml" 2>/dev/null; then
        echo "Validation should FAIL for old hooks format (no backward compatibility)"
        return 1
    else
        return 0
    fi
}

# =============================================================================
# Main Test Runner
# =============================================================================

main() {
    echo "=========================================="
    echo "Items Structure Tests"
    echo "=========================================="

    # Agents items tests
    run_test test_agents_items_simple_string_valid
    run_test test_agents_items_object_form_valid
    run_test test_agents_items_mixed_format_valid
    run_test test_agents_section_level_platforms
    run_test test_agents_missing_items_fails

    # Commands items tests
    run_test test_commands_items_simple_string_valid
    run_test test_commands_items_object_form_valid
    run_test test_commands_section_level_platforms

    # Skills items tests
    run_test test_skills_items_simple_string_valid
    run_test test_skills_items_object_form_valid
    run_test test_skills_section_level_platforms

    # Hooks items tests
    run_test test_hooks_items_object_form_valid
    run_test test_hooks_section_level_platforms
    run_test test_hooks_items_with_item_level_platforms

    # Schema valid fields tests
    run_test test_agents_section_unknown_field_fails
    run_test test_agents_items_unknown_field_fails

    # Old format rejection tests (no backward compatibility)
    run_test test_old_agents_format_rejected
    run_test test_old_commands_format_rejected
    run_test test_old_skills_format_rejected
    run_test test_old_hooks_format_rejected

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
}

main "$@"

#!/bin/bash
# =============================================================================
# Keyword Detector Hook Tests - Ralph Keyword Activation (Phase 1)
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
    mkdir -p "$TEST_TMP_DIR/.claude/sisyphus"
    # Set HOME to test dir for global state files
    export HOME_BACKUP="$HOME"
    export HOME="$TEST_TMP_DIR"
    mkdir -p "$HOME/.claude"
}

teardown_test_env() {
    export HOME="$HOME_BACKUP"
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
    local msg="${2:-File should NOT exist: $file}"

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

assert_json_field() {
    local file="$1"
    local field="$2"
    local expected="$3"
    local msg="${4:-JSON field should match}"

    local actual=$(jq -r "$field" "$file" 2>/dev/null)
    if [[ "$actual" == "$expected" ]]; then
        return 0
    else
        echo "ASSERTION FAILED: $msg"
        echo "  Field: '$field'"
        echo "  Expected: '$expected'"
        echo "  Actual: '$actual'"
        return 1
    fi
}

assert_output_contains() {
    local output="$1"
    local pattern="$2"
    local msg="${3:-Output should contain pattern}"

    if echo "$output" | grep -q "$pattern"; then
        return 0
    else
        echo "ASSERTION FAILED: $msg"
        echo "  Pattern: '$pattern'"
        echo "  Output: $output"
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

# Helper to run the keyword detector with a given prompt
run_keyword_detector() {
    local prompt="$1"
    local directory="${2:-$TEST_TMP_DIR}"

    # Use jq -Rs to properly escape the prompt including newlines
    local escaped_prompt=$(printf '%s' "$prompt" | jq -Rs '.')
    local input_json="{\"prompt\": $escaped_prompt, \"directory\": \"$directory\"}"
    echo "$input_json" | "$SCRIPT_DIR/keyword-detector.sh"
}

# =============================================================================
# Tests: Ralph Keyword Detection
# =============================================================================

test_ralph_keyword_detected_case_insensitive() {
    # When "ralph" keyword is in prompt (case-insensitive), should be detected
    local output=$(run_keyword_detector "Please ralph this task" "$TEST_TMP_DIR")

    assert_output_contains "$output" "ralph-mode" "Should output ralph-mode message"
}

test_ralph_keyword_detected_uppercase() {
    # When "RALPH" keyword is in prompt, should be detected
    local output=$(run_keyword_detector "RALPH complete this task" "$TEST_TMP_DIR")

    assert_output_contains "$output" "ralph-mode" "Should output ralph-mode for uppercase RALPH"
}

test_ralph_keyword_detected_mixed_case() {
    # When "Ralph" keyword is in prompt, should be detected
    local output=$(run_keyword_detector "Ralph please finish" "$TEST_TMP_DIR")

    assert_output_contains "$output" "ralph-mode" "Should output ralph-mode for mixed case Ralph"
}

test_ralph_keyword_not_detected_in_code_block() {
    # When "ralph" is inside a code block, should NOT be detected
    local prompt='Here is code:
```bash
echo ralph
```
Please review'
    local output=$(run_keyword_detector "$prompt" "$TEST_TMP_DIR")

    # Should NOT contain ralph-mode
    if echo "$output" | grep -q "ralph-mode"; then
        echo "ASSERTION FAILED: ralph inside code block should be ignored"
        return 1
    fi
    return 0
}

test_ralph_keyword_not_detected_in_inline_code() {
    # When "ralph" is inside inline code, should NOT be detected
    local prompt='Use the \`ralph\` variable in your code'
    local output=$(run_keyword_detector "$prompt" "$TEST_TMP_DIR")

    # Should NOT contain ralph-mode
    if echo "$output" | grep -q "ralph-mode"; then
        echo "ASSERTION FAILED: ralph inside inline code should be ignored"
        return 1
    fi
    return 0
}

# =============================================================================
# Tests: Ralph State File Creation
# =============================================================================

test_ralph_creates_ralph_state_json() {
    # When ralph keyword detected, should create ralph-state.json
    run_keyword_detector "ralph complete this" "$TEST_TMP_DIR" > /dev/null

    assert_file_exists "$TEST_TMP_DIR/.claude/sisyphus/ralph-state.json" "Should create ralph-state.json"
}

test_ralph_state_has_correct_structure() {
    # ralph-state.json should have the required fields
    run_keyword_detector "ralph complete this" "$TEST_TMP_DIR" > /dev/null

    local state_file="$TEST_TMP_DIR/.claude/sisyphus/ralph-state.json"

    assert_json_field "$state_file" ".active" "true" "active should be true"
    assert_json_field "$state_file" ".iteration" "1" "iteration should be 1"
    assert_json_field "$state_file" ".max_iterations" "10" "max_iterations should be 10"
    assert_json_field "$state_file" ".completion_promise" "DONE" "completion_promise should be DONE"
}

test_ralph_state_contains_prompt() {
    # ralph-state.json should contain the original prompt
    run_keyword_detector "ralph complete this task" "$TEST_TMP_DIR" > /dev/null

    local state_file="$TEST_TMP_DIR/.claude/sisyphus/ralph-state.json"

    # Check prompt is not empty
    local prompt=$(jq -r ".prompt" "$state_file" 2>/dev/null)
    if [[ -z "$prompt" || "$prompt" == "null" ]]; then
        echo "ASSERTION FAILED: prompt should not be empty"
        return 1
    fi
    return 0
}

test_ralph_state_has_timestamp() {
    # ralph-state.json should have started_at timestamp
    run_keyword_detector "ralph complete this" "$TEST_TMP_DIR" > /dev/null

    local state_file="$TEST_TMP_DIR/.claude/sisyphus/ralph-state.json"

    local timestamp=$(jq -r ".started_at" "$state_file" 2>/dev/null)
    if [[ -z "$timestamp" || "$timestamp" == "null" ]]; then
        echo "ASSERTION FAILED: started_at timestamp should exist"
        return 1
    fi
    return 0
}

test_ralph_state_has_linked_ultrawork_true() {
    # ralph-state.json should have linked_ultrawork: true
    run_keyword_detector "ralph complete this" "$TEST_TMP_DIR" > /dev/null

    local state_file="$TEST_TMP_DIR/.claude/sisyphus/ralph-state.json"

    assert_json_field "$state_file" ".linked_ultrawork" "true" "linked_ultrawork should be true"
}

# =============================================================================
# Tests: Linked Ultrawork State Creation
# =============================================================================

test_ralph_creates_ultrawork_state_when_not_exists() {
    # When ralph detected and ultrawork-state.json doesn't exist, create it
    run_keyword_detector "ralph complete this" "$TEST_TMP_DIR" > /dev/null

    assert_file_exists "$TEST_TMP_DIR/.claude/sisyphus/ultrawork-state.json" "Should create ultrawork-state.json"
}

test_ralph_ultrawork_state_has_linked_to_ralph_flag() {
    # Created ultrawork-state.json should have linked_to_ralph: true
    run_keyword_detector "ralph complete this" "$TEST_TMP_DIR" > /dev/null

    local state_file="$TEST_TMP_DIR/.claude/sisyphus/ultrawork-state.json"

    assert_json_field "$state_file" ".linked_to_ralph" "true" "linked_to_ralph should be true"
}

test_ralph_does_not_overwrite_existing_ultrawork_state() {
    # When ultrawork-state.json already exists, ralph should NOT overwrite it
    local existing_state='{"active": true, "started_at": "2025-01-01T00:00:00", "original_prompt": "existing task"}'
    echo "$existing_state" > "$TEST_TMP_DIR/.claude/sisyphus/ultrawork-state.json"

    run_keyword_detector "ralph complete this" "$TEST_TMP_DIR" > /dev/null

    local state_file="$TEST_TMP_DIR/.claude/sisyphus/ultrawork-state.json"

    # Should preserve original content (no linked_to_ralph field)
    assert_json_field "$state_file" ".original_prompt" "existing task" "Should preserve existing ultrawork state"

    # Should NOT have linked_to_ralph (we didn't create it)
    local linked=$(jq -r ".linked_to_ralph // \"missing\"" "$state_file" 2>/dev/null)
    if [[ "$linked" != "missing" && "$linked" != "null" ]]; then
        echo "ASSERTION FAILED: Existing ultrawork state should not be modified"
        return 1
    fi
    return 0
}

# =============================================================================
# Tests: Ralph Priority over Ultrawork
# =============================================================================

test_ralph_takes_priority_over_ultrawork() {
    # When both "ralph" and "ultrawork" are in prompt, ralph should win
    local output=$(run_keyword_detector "ralph ultrawork complete this" "$TEST_TMP_DIR")

    assert_output_contains "$output" "ralph-mode" "ralph should take priority"

    # Should NOT contain ultrawork-mode
    if echo "$output" | grep -q "ultrawork-mode"; then
        echo "ASSERTION FAILED: Should not output ultrawork-mode when ralph is present"
        return 1
    fi
    return 0
}

test_ralph_before_ultrawork_in_detection_order() {
    # Ensure ralph check comes before ultrawork check
    # This is tested by the priority test above, but here we verify state files
    run_keyword_detector "ralph ultrawork complete" "$TEST_TMP_DIR" > /dev/null

    # Should have ralph-state.json
    assert_file_exists "$TEST_TMP_DIR/.claude/sisyphus/ralph-state.json" "ralph-state should exist"

    # ultrawork-state.json should have linked_to_ralph flag (created by ralph, not by ultrawork keyword)
    local state_file="$TEST_TMP_DIR/.claude/sisyphus/ultrawork-state.json"
    assert_json_field "$state_file" ".linked_to_ralph" "true" "ultrawork state should be created by ralph (linked_to_ralph=true)"
}

# =============================================================================
# Tests: Ralph Output Message
# =============================================================================

test_ralph_output_contains_iteration_info() {
    # Output should contain iteration information
    local output=$(run_keyword_detector "ralph complete this" "$TEST_TMP_DIR")

    assert_output_contains "$output" "Iteration 1/10" "Should show iteration 1/10"
}

test_ralph_output_contains_ralph_loop_activated() {
    # Output should contain activation message
    local output=$(run_keyword_detector "ralph complete this" "$TEST_TMP_DIR")

    assert_output_contains "$output" "RALPH LOOP ACTIVATED" "Should show RALPH LOOP ACTIVATED"
}

test_ralph_output_contains_done_promise_instruction() {
    # Output should mention the DONE promise
    local output=$(run_keyword_detector "ralph complete this" "$TEST_TMP_DIR")

    assert_output_contains "$output" "DONE" "Should mention DONE promise"
}

test_ralph_output_contains_linked_modes_section() {
    # Output should have LINKED MODES section
    local output=$(run_keyword_detector "ralph complete this" "$TEST_TMP_DIR")

    assert_output_contains "$output" "LINKED MODES" "Should have LINKED MODES section"
}

# =============================================================================
# Main Test Runner
# =============================================================================

main() {
    echo "=========================================="
    echo "Keyword Detector Tests - Ralph Activation"
    echo "=========================================="

    # Ralph Keyword Detection
    run_test test_ralph_keyword_detected_case_insensitive
    run_test test_ralph_keyword_detected_uppercase
    run_test test_ralph_keyword_detected_mixed_case
    run_test test_ralph_keyword_not_detected_in_code_block
    run_test test_ralph_keyword_not_detected_in_inline_code

    # Ralph State File Creation
    run_test test_ralph_creates_ralph_state_json
    run_test test_ralph_state_has_correct_structure
    run_test test_ralph_state_contains_prompt
    run_test test_ralph_state_has_timestamp
    run_test test_ralph_state_has_linked_ultrawork_true

    # Linked Ultrawork State Creation
    run_test test_ralph_creates_ultrawork_state_when_not_exists
    run_test test_ralph_ultrawork_state_has_linked_to_ralph_flag
    run_test test_ralph_does_not_overwrite_existing_ultrawork_state

    # Ralph Priority over Ultrawork
    run_test test_ralph_takes_priority_over_ultrawork
    run_test test_ralph_before_ultrawork_in_detection_order

    # Ralph Output Message
    run_test test_ralph_output_contains_iteration_info
    run_test test_ralph_output_contains_ralph_loop_activated
    run_test test_ralph_output_contains_done_promise_instruction
    run_test test_ralph_output_contains_linked_modes_section

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
}

main "$@"

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
    # Create .git directory so get_project_root() can find project root
    mkdir -p "$TEST_TMP_DIR/.git"
    mkdir -p "$TEST_TMP_DIR/.omt"
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

assert_output_not_contains() {
    local output="$1"
    local pattern="$2"
    local msg="${3:-Output should NOT contain pattern}"

    if ! echo "$output" | grep -q "$pattern"; then
        return 0
    else
        echo "ASSERTION FAILED: $msg"
        echo "  Pattern: '$pattern'"
        return 1
    fi
}

assert_json_has_hook_specific_output() {
    local output="$1"
    local mode_name="$2"
    local msg="${3:-Output should have hookSpecificOutput format}"

    # Check for hookSpecificOutput structure
    if echo "$output" | grep -q '"hookSpecificOutput"'; then
        # Check for hookEventName: UserPromptSubmit
        if echo "$output" | grep -q '"hookEventName".*:.*"UserPromptSubmit"'; then
            # Check for additionalContext field
            if echo "$output" | grep -q '"additionalContext"'; then
                return 0
            else
                echo "ASSERTION FAILED: $msg - missing additionalContext"
                echo "  Output (first 500 chars): ${output:0:500}"
                return 1
            fi
        else
            echo "ASSERTION FAILED: $msg - hookEventName should be UserPromptSubmit"
            echo "  Output (first 500 chars): ${output:0:500}"
            return 1
        fi
    else
        echo "ASSERTION FAILED: $msg - missing hookSpecificOutput"
        echo "  Output (first 500 chars): ${output:0:500}"
        return 1
    fi
}

assert_no_message_field() {
    local output="$1"
    local msg="${2:-Output should NOT have message field at top level}"

    # Check that "message" is not at the top level (directly after "continue")
    if echo "$output" | grep -q '"continue".*"message"'; then
        echo "ASSERTION FAILED: $msg"
        echo "  Output (first 500 chars): ${output:0:500}"
        return 1
    fi
    return 0
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
    # Use "cwd" key (not "directory") as expected by the script
    local input_json="{\"prompt\": $escaped_prompt, \"cwd\": \"$directory\"}"
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
    # When ralph keyword detected, should create ralph-state-default.json
    run_keyword_detector "ralph complete this" "$TEST_TMP_DIR" > /dev/null

    assert_file_exists "$TEST_TMP_DIR/.omt/ralph-state-default.json" "Should create ralph-state-default.json"
}

test_ralph_state_has_correct_structure() {
    # ralph-state-default.json should have the required fields
    run_keyword_detector "ralph complete this" "$TEST_TMP_DIR" > /dev/null

    local state_file="$TEST_TMP_DIR/.omt/ralph-state-default.json"

    assert_json_field "$state_file" ".active" "true" "active should be true"
    assert_json_field "$state_file" ".iteration" "1" "iteration should be 1"
    assert_json_field "$state_file" ".max_iterations" "10" "max_iterations should be 10"
    assert_json_field "$state_file" ".completion_promise" "DONE" "completion_promise should be DONE"
}

test_ralph_state_contains_prompt() {
    # ralph-state-default.json should contain the original prompt
    run_keyword_detector "ralph complete this task" "$TEST_TMP_DIR" > /dev/null

    local state_file="$TEST_TMP_DIR/.omt/ralph-state-default.json"

    # Check prompt is not empty
    local prompt=$(jq -r ".prompt" "$state_file" 2>/dev/null)
    if [[ -z "$prompt" || "$prompt" == "null" ]]; then
        echo "ASSERTION FAILED: prompt should not be empty"
        return 1
    fi
    return 0
}

test_ralph_state_has_timestamp() {
    # ralph-state-default.json should have started_at timestamp
    run_keyword_detector "ralph complete this" "$TEST_TMP_DIR" > /dev/null

    local state_file="$TEST_TMP_DIR/.omt/ralph-state-default.json"

    local timestamp=$(jq -r ".started_at" "$state_file" 2>/dev/null)
    if [[ -z "$timestamp" || "$timestamp" == "null" ]]; then
        echo "ASSERTION FAILED: started_at timestamp should exist"
        return 1
    fi
    return 0
}

# =============================================================================
# Tests: Session-Based Ultrawork State Creation
# =============================================================================

test_ralph_does_not_overwrite_existing_ultrawork_state() {
    # When ultrawork-state-default.json already exists, ralph should NOT overwrite it
    local existing_state='{"active": true, "started_at": "2025-01-01T00:00:00", "original_prompt": "existing task"}'
    echo "$existing_state" > "$TEST_TMP_DIR/.omt/ultrawork-state-default.json"

    run_keyword_detector "ralph complete this" "$TEST_TMP_DIR" > /dev/null

    local state_file="$TEST_TMP_DIR/.omt/ultrawork-state-default.json"

    # Should preserve original content
    assert_json_field "$state_file" ".original_prompt" "existing task" "Should preserve existing ultrawork state"
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

# =============================================================================
# Tests: Ultrawork CERTAINTY GATE Content
# =============================================================================

test_ultrawork_output_contains_certainty_gate() {
    # INPUT: 일반 ultrawork 프롬프트
    # EXPECTED: 출력 JSON의 additionalContext에 CERTAINTY GATE 섹션 포함
    local output=$(run_keyword_detector "ultrawork implement the feature" "$TEST_TMP_DIR")
    assert_output_contains "$output" "CERTAINTY GATE" \
        "Ultrawork output should contain CERTAINTY GATE section"
}

test_ultrawork_certainty_gate_has_explore_directive() {
    # INPUT: ultrawork 프롬프트
    # EXPECTED: explore 에이전트 선행 호출 지시 포함
    local output=$(run_keyword_detector "ultrawork fix the bug" "$TEST_TMP_DIR")
    assert_output_contains "$output" "spawn explore agent FIRST" \
        "CERTAINTY GATE should direct to spawn explore agent"
}

test_ultrawork_certainty_gate_has_oracle_directive() {
    # INPUT: ultrawork 프롬프트
    # EXPECTED: oracle 에이전트 선행 호출 지시 포함
    local output=$(run_keyword_detector "ultrawork refactor this" "$TEST_TMP_DIR")
    assert_output_contains "$output" "spawn oracle agent FIRST" \
        "CERTAINTY GATE should direct to spawn oracle agent"
}

test_ultrawork_certainty_gate_has_assumptions_warning() {
    # INPUT: ultrawork 프롬프트
    # EXPECTED: 가정 경고 포함
    local output=$(run_keyword_detector "ulw add new feature" "$TEST_TMP_DIR")
    assert_output_contains "$output" "Assumptions = bugs" \
        "CERTAINTY GATE should warn about assumptions"
}

# =============================================================================
# Tests: Ultrawork BLOCKED EXCUSES Content
# =============================================================================

test_ultrawork_output_contains_blocked_excuses() {
    # INPUT: ultrawork 프롬프트
    # EXPECTED: BLOCKED EXCUSES 섹션 포함
    local output=$(run_keyword_detector "ultrawork implement auth" "$TEST_TMP_DIR")
    assert_output_contains "$output" "BLOCKED EXCUSES" \
        "Ultrawork output should contain BLOCKED EXCUSES section"
}

test_ultrawork_blocked_excuses_has_simplified_pattern() {
    # INPUT: ultrawork 프롬프트
    # EXPECTED: "simplified version" 변명 패턴 차단 포함
    local output=$(run_keyword_detector "ultrawork build the system" "$TEST_TMP_DIR")
    assert_output_contains "$output" "simplified version" \
        "Should block 'simplified version' excuse pattern"
}

test_ultrawork_blocked_excuses_has_cant_verify_pattern() {
    # INPUT: ultrawork 프롬프트
    # EXPECTED: 검증 불가 변명 차단 + argus 대체 행동 포함
    local output=$(run_keyword_detector "ultrawork test the hooks" "$TEST_TMP_DIR")
    assert_output_contains "$output" "argus" \
        "Should reference argus as recovery action for can't-verify excuse"
}

test_ultrawork_blocked_excuses_has_leave_for_user_pattern() {
    # INPUT: ultrawork 프롬프트
    # EXPECTED: 사용자 위임 변명 차단 포함
    local output=$(run_keyword_detector "ultrawork set up CI" "$TEST_TMP_DIR")
    assert_output_contains "$output" "leave this for the user" \
        "Should block 'leave for user' excuse pattern"
}

test_ultrawork_blocked_excuses_has_complexity_pattern() {
    # INPUT: ultrawork 프롬프트
    # EXPECTED: 복잡도 구실 차단 포함
    local output=$(run_keyword_detector "ulw refactor everything" "$TEST_TMP_DIR")
    assert_output_contains "$output" "complexity" \
        "Should block 'due to complexity' excuse pattern"
}

# =============================================================================
# Tests: Ultrawork Keyword Filtering (ported from oh-my-opencode patterns)
# =============================================================================

test_ultrawork_not_detected_in_code_block() {
    # INPUT: ultrawork 키워드가 코드블록(```) 안에 있음
    # EXPECTED: ultrawork-mode 미출력 (키워드 무시)
    local prompt='Here is example:
```bash
echo ultrawork
```
Please review this code'
    local output=$(run_keyword_detector "$prompt" "$TEST_TMP_DIR")
    if echo "$output" | grep -q "ultrawork-mode"; then
        echo "ASSERTION FAILED: ultrawork inside code block should be ignored"
        return 1
    fi
    return 0
}

test_ultrawork_not_detected_in_inline_code() {
    # INPUT: ultrawork 키워드가 인라인코드(`) 안에 있음
    # EXPECTED: ultrawork-mode 미출력
    local prompt='The \`ultrawork\` variable should be renamed'
    local output=$(run_keyword_detector "$prompt" "$TEST_TMP_DIR")
    if echo "$output" | grep -q "ultrawork-mode"; then
        echo "ASSERTION FAILED: ultrawork inside inline code should be ignored"
        return 1
    fi
    return 0
}

test_ulw_not_detected_in_code_block() {
    # INPUT: ulw 축약어가 코드블록 안에 있음
    # EXPECTED: ultrawork-mode 미출력
    local prompt='```
ulw_config = true
```
Check this config'
    local output=$(run_keyword_detector "$prompt" "$TEST_TMP_DIR")
    if echo "$output" | grep -q "ultrawork-mode"; then
        echo "ASSERTION FAILED: ulw inside code block should be ignored"
        return 1
    fi
    return 0
}

test_ultrawork_detected_outside_code_block() {
    # INPUT: 코드블록 밖에 ultrawork 키워드
    # EXPECTED: ultrawork-mode 출력 (정상 감지)
    local prompt='```
some code
```
ultrawork implement this feature'
    local output=$(run_keyword_detector "$prompt" "$TEST_TMP_DIR")
    assert_output_contains "$output" "ultrawork-mode" \
        "ultrawork outside code block should be detected"
}

test_ulw_abbreviation_detected() {
    # INPUT: ulw 축약어 사용
    # EXPECTED: ultrawork-mode 출력 (동일 처리)
    local output=$(run_keyword_detector "ulw fix this quickly" "$TEST_TMP_DIR")
    assert_output_contains "$output" "ultrawork-mode" \
        "ulw abbreviation should trigger ultrawork mode"
}

test_ultrawork_case_insensitive() {
    # INPUT: 대문자 ULTRAWORK
    # EXPECTED: ultrawork-mode 출력
    local output=$(run_keyword_detector "ULTRAWORK complete the task" "$TEST_TMP_DIR")
    assert_output_contains "$output" "ultrawork-mode" \
        "ULTRAWORK (uppercase) should trigger ultrawork mode"
}

test_ultrawork_not_detected_as_substring() {
    # INPUT: ultrawork이 다른 단어의 부분인 경우 (word boundary)
    # EXPECTED: ultrawork-mode 미출력
    local output=$(run_keyword_detector "the ultraworkflow is complex" "$TEST_TMP_DIR")
    if echo "$output" | grep -q "ultrawork-mode"; then
        echo "ASSERTION FAILED: 'ultraworkflow' should not trigger ultrawork (word boundary)"
        return 1
    fi
    return 0
}

# =============================================================================
# Tests: Ultrawork Output JSON Integrity (post-modification)
# =============================================================================

test_ultrawork_output_is_valid_json() {
    # INPUT: 일반 ultrawork 프롬프트
    # EXPECTED: 출력이 유효한 JSON
    local output=$(run_keyword_detector "ultrawork implement feature" "$TEST_TMP_DIR")
    if ! echo "$output" | jq . > /dev/null 2>&1; then
        echo "ASSERTION FAILED: Output is not valid JSON after CERTAINTY GATE / BLOCKED EXCUSES addition"
        echo "Output (first 500 chars): ${output:0:500}"
        return 1
    fi
    return 0
}

test_ultrawork_output_has_correct_hook_event() {
    # INPUT: ultrawork 프롬프트
    # EXPECTED: hookEventName이 "UserPromptSubmit"
    local output=$(run_keyword_detector "ultrawork do this" "$TEST_TMP_DIR")
    local event=$(echo "$output" | jq -r '.hookSpecificOutput.hookEventName')
    assert_equals "UserPromptSubmit" "$event" "hookEventName should be UserPromptSubmit"
}

test_ultrawork_output_has_continue_true() {
    # INPUT: ultrawork 프롬프트
    # EXPECTED: continue가 true
    local output=$(run_keyword_detector "ultrawork do this" "$TEST_TMP_DIR")
    local cont=$(echo "$output" | jq -r '.continue')
    assert_equals "true" "$cont" "continue should be true"
}

# =============================================================================
# Tests: Ralph activation message validation (from hooks/tests/)
# =============================================================================

test_ralph_message_json_valid() {
    local result
    result=$(echo '{"prompt": "ralph fix the bug", "cwd": "/tmp"}' | "$SCRIPT_DIR/keyword-detector.sh")

    if ! echo "$result" | jq . > /dev/null 2>&1; then
        echo "FAIL: Output is not valid JSON"
        echo "Output was: $result"
        return 1
    fi
    return 0
}

test_ralph_message_completion_guide_present() {
    local message
    message=$(echo '{"prompt": "ralph fix the bug", "cwd": "/tmp"}' | "$SCRIPT_DIR/keyword-detector.sh" | jq -r '.hookSpecificOutput.additionalContext')

    if [[ "$message" != *"COMPLETION SEQUENCE (MANDATORY)"* ]]; then
        echo "FAIL: Message does not contain 'COMPLETION SEQUENCE (MANDATORY)'"
        return 1
    fi
    return 0
}

test_ralph_message_verification_requirements_present() {
    local message
    message=$(echo '{"prompt": "ralph fix the bug", "cwd": "/tmp"}' | "$SCRIPT_DIR/keyword-detector.sh" | jq -r '.hookSpecificOutput.additionalContext')

    if [[ "$message" != *"VERIFICATION REQUIREMENTS"* ]]; then
        echo "FAIL: Message does not contain 'VERIFICATION REQUIREMENTS'"
        return 1
    fi
    return 0
}

test_ralph_message_red_flags_present() {
    local message
    message=$(echo '{"prompt": "ralph fix the bug", "cwd": "/tmp"}' | "$SCRIPT_DIR/keyword-detector.sh" | jq -r '.hookSpecificOutput.additionalContext')

    if [[ "$message" != *"Red Flags"* ]]; then
        echo "FAIL: Message does not contain 'Red Flags'"
        return 1
    fi
    return 0
}

test_ralph_message_core_rules_present() {
    local message
    message=$(echo '{"prompt": "ralph fix the bug", "cwd": "/tmp"}' | "$SCRIPT_DIR/keyword-detector.sh" | jq -r '.hookSpecificOutput.additionalContext')

    if [[ "$message" != *"CORE RULES"* ]]; then
        echo "FAIL: Message does not contain 'CORE RULES'"
        return 1
    fi
    return 0
}

test_ralph_message_variable_expansion() {
    local message
    message=$(echo '{"prompt": "ralph implement feature X", "cwd": "/tmp"}' | "$SCRIPT_DIR/keyword-detector.sh" | jq -r '.hookSpecificOutput.additionalContext')

    if [[ "$message" != *"Original task: ralph implement feature X"* ]]; then
        echo "FAIL: PROMPT variable not expanded correctly"
        echo "Message excerpt: $(echo "$message" | grep -o 'Original task:.*' | head -1)"
        return 1
    fi
    return 0
}

test_ralph_message_file_references() {
    local output
    output=$(echo '{"parts": [{"type": "text", "text": "ralph fix this"}, {"type": "file", "file_path": "src/main.kt"}], "cwd": "/tmp"}' | "$SCRIPT_DIR/keyword-detector.sh")

    local message
    message=$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext')

    if [[ "$message" != *"[referenced files: src/main.kt]"* ]]; then
        echo "FAIL: File reference not found in message"
        echo "Message excerpt: $(echo "$message" | grep -o 'referenced files:.*' | head -1)"
        return 1
    fi
    return 0
}

test_ralph_message_multiple_file_references() {
    local output
    output=$(echo '{"parts": [{"type": "text", "text": "ralph refactor these"}, {"type": "file", "file_path": "src/Foo.kt"}, {"type": "file", "file_path": "test/FooTest.kt"}], "cwd": "/tmp"}' | "$SCRIPT_DIR/keyword-detector.sh")

    local message
    message=$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext')

    if [[ "$message" != *"[referenced files: src/Foo.kt, test/FooTest.kt]"* ]]; then
        echo "FAIL: Multiple file references not found"
        echo "Message excerpt: $(echo "$message" | grep -o 'referenced files:.*' | head -1)"
        return 1
    fi
    return 0
}

test_ralph_message_code_blocks_preserved() {
    local output
    output=$(printf '{"prompt": "ralph fix this ```kotlin\\nfun foo() = 42\\n```", "cwd": "/tmp"}' | "$SCRIPT_DIR/keyword-detector.sh")

    # Note: Code blocks with newlines produce raw newlines in output,
    # which breaks JSON parsing. Check raw output instead of jq.
    if [[ "$output" != *'```kotlin'* ]]; then
        echo "FAIL: Code block not preserved in message"
        return 1
    fi
    return 0
}

test_ralph_message_system_reminder_removed() {
    local output
    output=$(echo '{"prompt": "ralph fix this <system-reminder>noise</system-reminder> please", "cwd": "/tmp"}' | "$SCRIPT_DIR/keyword-detector.sh")

    local message
    message=$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext')

    if [[ "$message" == *"system-reminder"* ]]; then
        echo "FAIL: System-reminder tag not removed"
        return 1
    fi
    if [[ "$message" != *"ralph fix this"* ]]; then
        echo "FAIL: Non-reminder content was lost"
        return 1
    fi
    return 0
}

test_ralph_message_no_file_annotation_without_files() {
    local output
    output=$(echo '{"prompt": "ralph fix the bug", "cwd": "/tmp"}' | "$SCRIPT_DIR/keyword-detector.sh")

    local message
    message=$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext')

    if [[ "$message" == *"referenced files"* ]]; then
        echo "FAIL: File annotation present without file parts"
        return 1
    fi
    return 0
}

# =============================================================================
# Tests: Session-based ralph state file creation (from hooks/test/)
# =============================================================================

test_ralph_keyword_creates_session_specific_state_file() {
    # Setup: Create project marker
    mkdir -p "$TEST_TMP_DIR/.git"

    # Run with sessionId in input
    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "test-session-123", "prompt": "ralph do the task"}' | "$SCRIPT_DIR/keyword-detector.sh" 2>&1) || true

    # Verify output contains ralph activation
    assert_output_contains "$output" "RALPH LOOP ACTIVATED" "Should activate ralph loop" || return 1

    # Verify session-specific state file was created
    assert_file_exists "$TEST_TMP_DIR/.omt/ralph-state-test-session-123.json" "Session-specific ralph state file should exist" || return 1

    # Verify old non-session file was NOT created
    assert_file_not_exists "$TEST_TMP_DIR/.omt/ralph-state.json" "Non-session ralph state file should NOT exist" || return 1
}

test_ralph_keyword_uses_default_when_no_session_id() {
    # Setup: Create project marker
    mkdir -p "$TEST_TMP_DIR/.git"

    # Run without sessionId in input
    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "prompt": "ralph do the task"}' | "$SCRIPT_DIR/keyword-detector.sh" 2>&1) || true

    # Verify output contains ralph activation
    assert_output_contains "$output" "RALPH LOOP ACTIVATED" "Should activate ralph loop" || return 1

    # Verify default session state file was created
    assert_file_exists "$TEST_TMP_DIR/.omt/ralph-state-default.json" "Default ralph state file should exist" || return 1
}

test_ralph_verification_uses_session_id() {
    # This test verifies that ralph-verification also uses session ID
    # The verification file is created by persistent-mode.sh, not keyword-detector
    # So we just check that keyword-detector extracts session ID correctly

    # Check that keyword-detector.sh has SESSION_ID extraction code
    if grep -q 'SESSION_ID.*jq.*sessionId' "$SCRIPT_DIR/keyword-detector.sh"; then
        return 0
    else
        echo "ASSERTION FAILED: keyword-detector.sh should extract SESSION_ID"
        return 1
    fi
}

# =============================================================================
# Tests: JSON output format validation - hookSpecificOutput (from hooks/test/)
# =============================================================================

test_ralph_output_uses_hook_specific_output_format() {
    mkdir -p "$TEST_TMP_DIR/.git"

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "test-session", "prompt": "ralph do the task"}' | "$SCRIPT_DIR/keyword-detector.sh" 2>&1) || true

    assert_json_has_hook_specific_output "$output" "ralph" "Ralph mode should use hookSpecificOutput format" || return 1
    assert_no_message_field "$output" "Ralph mode should not use message field" || return 1
}

test_ultrawork_output_uses_hook_specific_output_format() {
    mkdir -p "$TEST_TMP_DIR/.git"

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "test-session", "prompt": "ultrawork do the task"}' | "$SCRIPT_DIR/keyword-detector.sh" 2>&1) || true

    assert_json_has_hook_specific_output "$output" "ultrawork" "Ultrawork mode should use hookSpecificOutput format" || return 1
    assert_no_message_field "$output" "Ultrawork mode should not use message field" || return 1
}

test_think_output_uses_hook_specific_output_format() {
    mkdir -p "$TEST_TMP_DIR/.git"

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "test-session", "prompt": "think about this problem"}' | "$SCRIPT_DIR/keyword-detector.sh" 2>&1) || true

    assert_json_has_hook_specific_output "$output" "think" "Think mode should use hookSpecificOutput format" || return 1
    assert_no_message_field "$output" "Think mode should not use message field" || return 1
}

test_search_output_uses_hook_specific_output_format() {
    mkdir -p "$TEST_TMP_DIR/.git"

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "test-session", "prompt": "search for files"}' | "$SCRIPT_DIR/keyword-detector.sh" 2>&1) || true

    assert_json_has_hook_specific_output "$output" "search" "Search mode should use hookSpecificOutput format" || return 1
    assert_no_message_field "$output" "Search mode should not use message field" || return 1
}

test_analyze_output_uses_hook_specific_output_format() {
    mkdir -p "$TEST_TMP_DIR/.git"

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "test-session", "prompt": "analyze this code"}' | "$SCRIPT_DIR/keyword-detector.sh" 2>&1) || true

    assert_json_has_hook_specific_output "$output" "analyze" "Analyze mode should use hookSpecificOutput format" || return 1
    assert_no_message_field "$output" "Analyze mode should not use message field" || return 1
}

# =============================================================================
# Tests: Project root detection - keyword-detector (from hooks/test/project_root_test.sh)
# =============================================================================

test_get_project_root_function_exists_in_keyword_detector() {
    # keyword-detector.sh should define get_project_root function
    if grep -E '^get_project_root\(\)' "$SCRIPT_DIR/keyword-detector.sh" >/dev/null 2>&1; then
        return 0
    else
        echo "ASSERTION FAILED: get_project_root() should be defined in keyword-detector.sh"
        return 1
    fi
}

test_keyword_detector_uses_project_root_variable() {
    # keyword-detector.sh should set and use PROJECT_ROOT variable
    if grep -q 'PROJECT_ROOT=.*get_project_root' "$SCRIPT_DIR/keyword-detector.sh"; then
        return 0
    else
        echo "ASSERTION FAILED: keyword-detector.sh should set PROJECT_ROOT from get_project_root"
        return 1
    fi
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

    # Session-Based Ultrawork State Creation
    run_test test_ralph_does_not_overwrite_existing_ultrawork_state

    # Ralph Priority over Ultrawork
    run_test test_ralph_takes_priority_over_ultrawork

    # Ralph Output Message
    run_test test_ralph_output_contains_iteration_info
    run_test test_ralph_output_contains_ralph_loop_activated
    run_test test_ralph_output_contains_done_promise_instruction

    # Ultrawork CERTAINTY GATE Content
    run_test test_ultrawork_output_contains_certainty_gate
    run_test test_ultrawork_certainty_gate_has_explore_directive
    run_test test_ultrawork_certainty_gate_has_oracle_directive
    run_test test_ultrawork_certainty_gate_has_assumptions_warning

    # Ultrawork BLOCKED EXCUSES Content
    run_test test_ultrawork_output_contains_blocked_excuses
    run_test test_ultrawork_blocked_excuses_has_simplified_pattern
    run_test test_ultrawork_blocked_excuses_has_cant_verify_pattern
    run_test test_ultrawork_blocked_excuses_has_leave_for_user_pattern
    run_test test_ultrawork_blocked_excuses_has_complexity_pattern

    # Ultrawork Keyword Filtering
    run_test test_ultrawork_not_detected_in_code_block
    run_test test_ultrawork_not_detected_in_inline_code
    run_test test_ulw_not_detected_in_code_block
    run_test test_ultrawork_detected_outside_code_block
    run_test test_ulw_abbreviation_detected
    run_test test_ultrawork_case_insensitive
    run_test test_ultrawork_not_detected_as_substring

    # Ultrawork Output JSON Integrity
    run_test test_ultrawork_output_is_valid_json
    run_test test_ultrawork_output_has_correct_hook_event
    run_test test_ultrawork_output_has_continue_true

    # Ralph activation message validation (from hooks/tests/)
    run_test test_ralph_message_json_valid
    run_test test_ralph_message_completion_guide_present
    run_test test_ralph_message_verification_requirements_present
    run_test test_ralph_message_red_flags_present
    run_test test_ralph_message_core_rules_present
    run_test test_ralph_message_variable_expansion
    run_test test_ralph_message_file_references
    run_test test_ralph_message_multiple_file_references
    run_test test_ralph_message_code_blocks_preserved
    run_test test_ralph_message_system_reminder_removed
    run_test test_ralph_message_no_file_annotation_without_files

    # Session-based ralph state file creation (from hooks/test/)
    run_test test_ralph_keyword_creates_session_specific_state_file
    run_test test_ralph_keyword_uses_default_when_no_session_id
    run_test test_ralph_verification_uses_session_id

    # Project root detection - keyword-detector (from hooks/test/project_root_test.sh)
    run_test test_get_project_root_function_exists_in_keyword_detector
    run_test test_keyword_detector_uses_project_root_variable

    # JSON output format validation - hookSpecificOutput (from hooks/test/)
    run_test test_ralph_output_uses_hook_specific_output_format
    run_test test_ultrawork_output_uses_hook_specific_output_format
    run_test test_think_output_uses_hook_specific_output_format
    run_test test_search_output_uses_hook_specific_output_format
    run_test test_analyze_output_uses_hook_specific_output_format

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
}

main "$@"

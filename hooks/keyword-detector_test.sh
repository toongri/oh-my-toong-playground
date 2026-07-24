#!/bin/bash
# =============================================================================
# Keyword Detector Hook Tests
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
    # Set OMT_DIR so hook uses this path directly (bypasses fallback computation)
    export OMT_DIR="$TEST_TMP_DIR/.omt"
    mkdir -p "$OMT_DIR"
    # Set HOME to test dir for global state files
    export HOME_BACKUP="$HOME"
    export HOME="$TEST_TMP_DIR"
    mkdir -p "$HOME/.claude"
}

teardown_test_env() {
    export HOME="$HOME_BACKUP"
    unset OMT_DIR
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
# Tests: Ultrawork CERTAINTY GATE Content
# =============================================================================

test_ultrawork_output_contains_certainty_gate() {
    # INPUT: 일반 ultrawork 프롬프트
    # EXPECTED: 출력 JSON의 additionalContext에 CERTAINTY GATE 섹션 포함
    local output=$(run_keyword_detector "ultrawork implement the feature" "$TEST_TMP_DIR")
    assert_output_contains "$output" "CERTAINTY GATE" \
        "Ultrawork output should contain CERTAINTY GATE section" || return 1
}

test_ultrawork_certainty_gate_has_explore_directive() {
    # INPUT: ultrawork 프롬프트
    # EXPECTED: explore 에이전트 선행 호출 지시 포함
    local output=$(run_keyword_detector "ultrawork fix the bug" "$TEST_TMP_DIR")
    assert_output_contains "$output" "spawn explore agent FIRST" \
        "CERTAINTY GATE should direct to spawn explore agent" || return 1
}

test_ultrawork_certainty_gate_has_oracle_directive() {
    # INPUT: ultrawork 프롬프트
    # EXPECTED: oracle 에이전트 선행 호출 지시 포함
    local output=$(run_keyword_detector "ultrawork refactor this" "$TEST_TMP_DIR")
    assert_output_contains "$output" "spawn oracle agent FIRST" \
        "CERTAINTY GATE should direct to spawn oracle agent" || return 1
}

test_ultrawork_certainty_gate_has_assumptions_warning() {
    # INPUT: ultrawork 프롬프트
    # EXPECTED: 가정 경고 포함
    local output=$(run_keyword_detector "ulw add new feature" "$TEST_TMP_DIR")
    assert_output_contains "$output" "Assumptions = bugs" \
        "CERTAINTY GATE should warn about assumptions" || return 1
}

# =============================================================================
# Tests: Ultrawork BLOCKED EXCUSES Content
# =============================================================================

test_ultrawork_output_contains_blocked_excuses() {
    # INPUT: ultrawork 프롬프트
    # EXPECTED: BLOCKED EXCUSES 섹션 포함
    local output=$(run_keyword_detector "ultrawork implement auth" "$TEST_TMP_DIR")
    assert_output_contains "$output" "BLOCKED EXCUSES" \
        "Ultrawork output should contain BLOCKED EXCUSES section" || return 1
}

test_ultrawork_blocked_excuses_has_simplified_pattern() {
    # INPUT: ultrawork 프롬프트
    # EXPECTED: "simplified version" 변명 패턴 차단 포함
    local output=$(run_keyword_detector "ultrawork build the system" "$TEST_TMP_DIR")
    assert_output_contains "$output" "simplified version" \
        "Should block 'simplified version' excuse pattern" || return 1
}

test_ultrawork_blocked_excuses_has_cant_verify_pattern() {
    # INPUT: ultrawork 프롬프트
    # EXPECTED: 검증 불가 변명 차단 + 인라인 검증 대체 행동 포함
    local output=$(run_keyword_detector "ultrawork test the hooks" "$TEST_TMP_DIR")
    assert_output_contains "$output" "capture evidence" \
        "Should reference inline verification as recovery action for can't-verify excuse" || return 1
}

test_ultrawork_blocked_excuses_has_leave_for_user_pattern() {
    # INPUT: ultrawork 프롬프트
    # EXPECTED: 사용자 위임 변명 차단 포함
    local output=$(run_keyword_detector "ultrawork set up CI" "$TEST_TMP_DIR")
    assert_output_contains "$output" "leave this for the user" \
        "Should block 'leave for user' excuse pattern" || return 1
}

test_ultrawork_blocked_excuses_has_complexity_pattern() {
    # INPUT: ultrawork 프롬프트
    # EXPECTED: 복잡도 구실 차단 포함
    local output=$(run_keyword_detector "ulw refactor everything" "$TEST_TMP_DIR")
    assert_output_contains "$output" "complexity" \
        "Should block 'due to complexity' excuse pattern" || return 1
}

# =============================================================================
# Tests: Claude wording non-regression (paired with codex-keyword-detector_test.sh's
# leak-absence arm) -- the shared core's platform-vocabulary parameters
# (keyword-detector-core.sh's kd_core_message_* task_name/tools_desc args)
# default to Claude's own literal wording, and keyword-detector.sh (this
# shim) calls them with no args -- exactly the askToolName pattern in
# lib/persistent-mode-core/decision.ts:351, where every Claude caller omits
# the platform parameter and gets the real Claude tool name back. Asserting
# presence here (not just the golden-byte test in
# keyword-detector-core_test.sh) guards this specific shim's call sites: a
# stray arg added to keyword-detector.sh's emit_claude_mode calls would
# silently override the Claude wording without failing the core's own test.
# =============================================================================
test_ultrawork_output_retains_task_literal() {
    local output=$(run_keyword_detector "ultrawork implement the feature" "$TEST_TMP_DIR")
    assert_output_contains "$output" "Task calls" \
        "Claude ultrawork output should retain the 'Task' tool literal" || return 1
}

test_search_output_retains_grep_glob_literals() {
    local output=$(run_keyword_detector "search for files" "$TEST_TMP_DIR")
    assert_output_contains "$output" "Grep, Glob" \
        "Claude search output should retain the 'Grep, Glob' tool literals" || return 1
}

test_analyze_output_retains_grep_glob_lsp_literals() {
    local output=$(run_keyword_detector "analyze this code" "$TEST_TMP_DIR")
    assert_output_contains "$output" "Grep, Glob, LSP" \
        "Claude analyze output should retain the 'Grep, Glob, LSP' tool literals" || return 1
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
        "ultrawork outside code block should be detected" || return 1
}

test_ulw_abbreviation_detected() {
    # INPUT: ulw 축약어 사용
    # EXPECTED: ultrawork-mode 출력 (동일 처리)
    local output=$(run_keyword_detector "ulw fix this quickly" "$TEST_TMP_DIR")
    assert_output_contains "$output" "ultrawork-mode" \
        "ulw abbreviation should trigger ultrawork mode" || return 1
}

test_ultrawork_case_insensitive() {
    # INPUT: 대문자 ULTRAWORK
    # EXPECTED: ultrawork-mode 출력
    local output=$(run_keyword_detector "ULTRAWORK complete the task" "$TEST_TMP_DIR")
    assert_output_contains "$output" "ultrawork-mode" \
        "ULTRAWORK (uppercase) should trigger ultrawork mode" || return 1
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
    assert_equals "UserPromptSubmit" "$event" "hookEventName should be UserPromptSubmit" || return 1
}

test_ultrawork_output_has_continue_true() {
    # INPUT: ultrawork 프롬프트
    # EXPECTED: continue가 true
    local output=$(run_keyword_detector "ultrawork do this" "$TEST_TMP_DIR")
    local cont=$(echo "$output" | jq -r '.continue')
    assert_equals "true" "$cont" "continue should be true" || return 1
}

# =============================================================================
# Tests: JSON output format validation - hookSpecificOutput (from hooks/test/)
# =============================================================================

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
# Tests: Deep Interview seed started_at/last_touched_at parser compatibility (TODO 5)
# Survivor tests re-pointed: invoke pre-tool-enforcer.sh Skill(deep-interview) seed
# =============================================================================

# Helper: assert a state file has a parser-compatible timestamp field.
# Verifies ISO 8601 shape AND round-trip through the real session-start.sh parser.
assert_timestamp_parser_compatible() {
    local state_file="$1"
    local field="${2:-started_at}"

    local ts
    ts=$(jq -r --arg f "$field" '.[$f] // ""' "$state_file" 2>/dev/null)
    if [[ -z "$ts" || "$ts" == "null" ]]; then
        echo "ASSERTION FAILED: $field field missing or null in $state_file"
        return 1
    fi

    if ! echo "$ts" | grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}'; then
        echo "ASSERTION FAILED: $field '$ts' does not match ISO 8601 shape"
        return 1
    fi

    local time_part epoch
    time_part=$(echo "$ts" | sed -E 's/(Z|[+-][0-9]{2}:[0-9]{2})$//')
    epoch=$(date -j -f "%Y-%m-%dT%H:%M:%S" "$time_part" "+%s" 2>/dev/null \
        || date -d "$time_part" "+%s" 2>/dev/null)
    if [[ -z "$epoch" ]]; then
        echo "ASSERTION FAILED: $field '$ts' (stripped: '$time_part') did not round-trip through session-start parser"
        return 1
    fi

    return 0
}

test_deep_interview_seed_has_parser_compatible_timestamps() {
    # Survivor: seed created by pre-tool-enforcer.sh Skill(deep-interview) has
    # parser-compatible started_at and last_touched_at (consolidates the two
    # prior jq-branch/heredoc-branch tests that invoked the deleted creation path).
    local sid="di-seed-compat"
    local state_file="$OMT_DIR/deep-interview-active-state-${sid}.json"

    (
        export OMT_SESSION_ID="$sid"
        printf '%s' '{"tool_name":"Skill","tool_input":{"skill":"deep-interview"}}' \
            | bash "$SCRIPT_DIR/pre-tool-enforcer.sh"
    ) > /dev/null 2>&1 || true

    assert_file_exists "$state_file" "deep-interview state file should exist from seed" || return 1
    assert_timestamp_parser_compatible "$state_file" "started_at" || return 1
    assert_timestamp_parser_compatible "$state_file" "last_touched_at" || return 1
}

# =============================================================================
# Main Test Runner
# =============================================================================

main() {
    echo "=========================================="
    echo "Keyword Detector Tests"
    echo "=========================================="

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

    # Claude wording non-regression
    run_test test_ultrawork_output_retains_task_literal
    run_test test_search_output_retains_grep_glob_literals
    run_test test_analyze_output_retains_grep_glob_lsp_literals

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

    # Project root detection - keyword-detector (from hooks/test/project_root_test.sh)
    run_test test_get_project_root_function_exists_in_keyword_detector
    run_test test_keyword_detector_uses_project_root_variable

    # Deep Interview seed timestamp parser compatibility
    run_test test_deep_interview_seed_has_parser_compatible_timestamps

    # JSON output format validation - hookSpecificOutput (from hooks/test/)
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

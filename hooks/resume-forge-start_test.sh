#!/bin/bash
# =============================================================================
# Resume Forge Session Start Hook Tests
# Tests for resume-forge state file detection and context injection
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Test utilities
TESTS_PASSED=0
TESTS_FAILED=0
CURRENT_TEST=""

setup_test_env() {
    TEST_TMP_DIR=$(mktemp -d)
    mkdir -p "$TEST_TMP_DIR/.omt"
    mkdir -p "$TEST_TMP_DIR/.git"

    # Store original HOME
    ORIGINAL_HOME="$HOME"

    # Create temporary home directory for isolated tests
    TEST_HOME=$(mktemp -d)
    mkdir -p "$TEST_HOME/.claude"
    export HOME="$TEST_HOME"
    unset OMT_DIR
    unset OMT_PROJECT

    # Pre-compute TEST_OMT_DIR: mirrors resume-forge-start.sh OMT_DIR derivation.
    # Since TEST_TMP_DIR has no real git repo, PROJECT_NAME = basename(TEST_TMP_DIR).
    TEST_PROJECT_NAME=$(basename "$TEST_TMP_DIR")
    TEST_OMT_DIR="$TEST_HOME/.omt/$TEST_PROJECT_NAME"
    mkdir -p "$TEST_OMT_DIR/state"
}

teardown_test_env() {
    # Restore original HOME
    export HOME="$ORIGINAL_HOME"

    if [[ -d "$TEST_TMP_DIR" ]]; then
        rm -rf "$TEST_TMP_DIR"
    fi
    if [[ -d "$TEST_HOME" ]]; then
        rm -rf "$TEST_HOME"
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
        echo "  Output (first 500 chars): ${output:0:500}"
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
# Tests: No state files
# =============================================================================

test_no_state_files_returns_continue_true() {
    # No state files exist → output is {"continue": true} with no hookSpecificOutput
    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "test-session"}' \
        | "$SCRIPT_DIR/resume-forge-start.sh" 2>&1) || true

    assert_output_contains "$output" '"continue": true' \
        "Should always return continue: true" || return 1
    assert_output_not_contains "$output" "hookSpecificOutput" \
        "No hookSpecificOutput when no state files" || return 1
}

# =============================================================================
# Tests: One active state file
# =============================================================================

test_one_state_file_injects_resume_forge_detected() {
    # One state file → should inject RESUME FORGE SESSION DETECTED
    cat > "$TEST_OMT_DIR/state/resume-forge-abc123.json" << 'EOF'
{
  "session_id": "abc123",
  "created_at": "2026-04-10T12:00:00",
  "target_count": 3,
  "scenarios": [
    {"id": "c1", "title": "Scenario 1", "loop1": {"status": "passed"}, "loop2": {"status": "passed"}},
    {"id": "c2", "title": "Scenario 2", "loop1": {"status": "passed"}, "loop2": {"status": "pending"}},
    {"id": "c3", "title": "Scenario 3", "loop1": {"status": "pending"}, "loop2": {"status": "pending"}}
  ]
}
EOF

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "test-session"}' \
        | "$SCRIPT_DIR/resume-forge-start.sh" 2>&1) || true

    assert_output_contains "$output" "RESUME FORGE SESSION DETECTED" \
        "Should inject RESUME FORGE SESSION DETECTED" || return 1
}

test_one_state_file_shows_scenario_summary() {
    # State with 1 passed out of 3 total → shows 1/3
    cat > "$TEST_OMT_DIR/state/resume-forge-abc123.json" << 'EOF'
{
  "session_id": "abc123",
  "created_at": "2026-04-10T12:00:00",
  "target_count": 3,
  "scenarios": [
    {"id": "c1", "title": "Scenario 1", "loop1": {"status": "passed"}, "loop2": {"status": "passed"}},
    {"id": "c2", "title": "Scenario 2", "loop1": {"status": "passed"}, "loop2": {"status": "pending"}},
    {"id": "c3", "title": "Scenario 3", "loop1": {"status": "pending"}, "loop2": {"status": "pending"}}
  ]
}
EOF

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "test-session"}' \
        | "$SCRIPT_DIR/resume-forge-start.sh" 2>&1) || true

    assert_output_contains "$output" "1/3" \
        "Should show 1 passed out of 3 total" || return 1
}

# =============================================================================
# Tests: Multiple state files - picks most recent by created_at
# =============================================================================

test_multiple_state_files_picks_most_recent() {
    # Two state files: one older, one newer → picks the newer one
    cat > "$TEST_OMT_DIR/state/resume-forge-old.json" << 'EOF'
{
  "session_id": "old",
  "created_at": "2026-04-08T10:00:00",
  "target_count": 2,
  "scenarios": [
    {"id": "c1", "title": "Old Scenario", "loop1": {"status": "passed"}, "loop2": {"status": "passed"}},
    {"id": "c2", "title": "Old Scenario 2", "loop1": {"status": "passed"}, "loop2": {"status": "passed"}}
  ]
}
EOF

    cat > "$TEST_OMT_DIR/state/resume-forge-new.json" << 'EOF'
{
  "session_id": "new",
  "created_at": "2026-04-12T15:00:00",
  "target_count": 1,
  "scenarios": [
    {"id": "c1", "title": "New Scenario", "loop1": {"status": "passed"}, "loop2": {"status": "pending"}}
  ]
}
EOF

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "test-session"}' \
        | "$SCRIPT_DIR/resume-forge-start.sh" 2>&1) || true

    # The newer file has 0/1 passed (loop2 pending), older has 2/2 passed
    # So checking for 0/1 confirms we picked the newer file
    assert_output_contains "$output" "0/1" \
        "Should pick the most recent state file (0/1 passed)" || return 1
}

# =============================================================================
# Tests: All scenarios passed
# =============================================================================

test_all_scenarios_passed_shows_correct_count() {
    # All 4 scenarios passed → shows 4/4
    cat > "$TEST_OMT_DIR/state/resume-forge-full.json" << 'EOF'
{
  "session_id": "full",
  "created_at": "2026-04-11T09:00:00",
  "target_count": 4,
  "scenarios": [
    {"id": "c1", "title": "S1", "loop1": {"status": "passed"}, "loop2": {"status": "passed"}},
    {"id": "c2", "title": "S2", "loop1": {"status": "passed"}, "loop2": {"status": "passed"}},
    {"id": "c3", "title": "S3", "loop1": {"status": "passed"}, "loop2": {"status": "passed"}},
    {"id": "c4", "title": "S4", "loop1": {"status": "passed"}, "loop2": {"status": "passed"}}
  ]
}
EOF

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "test-session"}' \
        | "$SCRIPT_DIR/resume-forge-start.sh" 2>&1) || true

    assert_output_contains "$output" "4/4" \
        "Should show 4/4 when all scenarios passed" || return 1
}

# =============================================================================
# Tests: Mixed status shows correct pending/completed ratio
# =============================================================================

test_mixed_status_shows_correct_ratio() {
    # 2 passed, 3 total → shows 2/3
    cat > "$TEST_OMT_DIR/state/resume-forge-mixed.json" << 'EOF'
{
  "session_id": "mixed",
  "created_at": "2026-04-11T14:00:00",
  "target_count": 3,
  "scenarios": [
    {"id": "c1", "title": "S1", "loop1": {"status": "passed"}, "loop2": {"status": "passed"}},
    {"id": "c2", "title": "S2", "loop1": {"status": "passed"}, "loop2": {"status": "passed"}},
    {"id": "c3", "title": "S3", "loop1": {"status": "passed"}, "loop2": {"status": "pending"}}
  ]
}
EOF

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "test-session"}' \
        | "$SCRIPT_DIR/resume-forge-start.sh" 2>&1) || true

    assert_output_contains "$output" "2/3" \
        "Should show 2/3 for mixed status" || return 1
}

# =============================================================================
# Tests: CLAUDE_ENV_FILE exports
# =============================================================================

test_exports_omt_dir_via_claude_env_file() {
    local env_file
    env_file=$(mktemp)

    echo '{"cwd": "'"$TEST_TMP_DIR"'"}' \
        | CLAUDE_ENV_FILE="$env_file" "$SCRIPT_DIR/resume-forge-start.sh" > /dev/null 2>&1 || true

    if grep -q 'export OMT_DIR=' "$env_file"; then
        rm -f "$env_file"
        return 0
    else
        echo "ASSERTION FAILED: CLAUDE_ENV_FILE should contain 'export OMT_DIR='"
        echo "  env_file contents: $(cat "$env_file")"
        rm -f "$env_file"
        return 1
    fi
}

test_exports_omt_project_via_claude_env_file() {
    local env_file
    env_file=$(mktemp)

    echo '{"cwd": "'"$TEST_TMP_DIR"'"}' \
        | CLAUDE_ENV_FILE="$env_file" "$SCRIPT_DIR/resume-forge-start.sh" > /dev/null 2>&1 || true

    if grep -q 'export OMT_PROJECT=' "$env_file"; then
        rm -f "$env_file"
        return 0
    else
        echo "ASSERTION FAILED: CLAUDE_ENV_FILE should contain 'export OMT_PROJECT='"
        echo "  env_file contents: $(cat "$env_file")"
        rm -f "$env_file"
        return 1
    fi
}

# =============================================================================
# Main Test Runner
# =============================================================================

main() {
    echo "=========================================="
    echo "Resume Forge Session Start Hook Tests"
    echo "=========================================="

    # No state files
    run_test test_no_state_files_returns_continue_true

    # One active state file
    run_test test_one_state_file_injects_resume_forge_detected
    run_test test_one_state_file_shows_scenario_summary

    # Multiple state files
    run_test test_multiple_state_files_picks_most_recent

    # All scenarios passed
    run_test test_all_scenarios_passed_shows_correct_count

    # Mixed status
    run_test test_mixed_status_shows_correct_ratio

    # CLAUDE_ENV_FILE exports
    run_test test_exports_omt_dir_via_claude_env_file
    run_test test_exports_omt_project_via_claude_env_file

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
}

main "$@"

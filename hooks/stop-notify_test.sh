#!/bin/bash
# =============================================================================
# Stop Notify Hook Tests
# Tests for OMT_DIR resolution and ralph-state gating logic
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Test utilities
TESTS_PASSED=0
TESTS_FAILED=0
CURRENT_TEST=""

setup_test_env() {
    TEST_TMP_DIR=$(mktemp -d)
    mkdir -p "$TEST_TMP_DIR/.git"

    # Store and redirect HOME to isolate task-file checks
    ORIGINAL_HOME="$HOME"
    TEST_HOME=$(mktemp -d)
    mkdir -p "$TEST_HOME/.claude"
    export HOME="$TEST_HOME"

    # Create a mock bin dir to intercept osascript
    TEST_BIN_DIR=$(mktemp -d)
    # Mock osascript: write a marker file and succeed silently
    cat > "$TEST_BIN_DIR/osascript" << 'MOCK'
#!/bin/bash
touch "${OSASCRIPT_MARKER_FILE:-/dev/null}"
exit 0
MOCK
    chmod +x "$TEST_BIN_DIR/osascript"

    # Mock terminal-notifier absence: do not add it to PATH
    export ORIGINAL_PATH="$PATH"
    export PATH="$TEST_BIN_DIR:$PATH"

    # Save OMT_DIR if it was set
    ORIGINAL_OMT_DIR="${OMT_DIR:-}"
    unset OMT_DIR
}

teardown_test_env() {
    export HOME="$ORIGINAL_HOME"
    export PATH="$ORIGINAL_PATH"

    # Restore OMT_DIR
    if [[ -n "$ORIGINAL_OMT_DIR" ]]; then
        export OMT_DIR="$ORIGINAL_OMT_DIR"
    else
        unset OMT_DIR
    fi

    if [[ -d "$TEST_TMP_DIR" ]]; then
        rm -rf "$TEST_TMP_DIR"
    fi
    if [[ -d "$TEST_HOME" ]]; then
        rm -rf "$TEST_HOME"
    fi
    if [[ -d "$TEST_BIN_DIR" ]]; then
        rm -rf "$TEST_BIN_DIR"
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

# Run the hook with JSON input piped to stdin.
# Arguments:
#   $1  session_id value (used as session_id in JSON)
#   $2  cwd path (defaults to TEST_TMP_DIR)
run_stop_notify() {
    local session_id="${1:-test-session}"
    local cwd="${2:-$TEST_TMP_DIR}"
    echo "{\"session_id\": \"$session_id\", \"cwd\": \"$cwd\"}" | "$SCRIPT_DIR/stop-notify.sh"
}

# =============================================================================
# Tests: OMT_DIR preset passthrough (compute_omt_dir is a no-op)
# =============================================================================

test_omt_dir_preset_is_respected() {
    # When OMT_DIR is set before running the hook, compute_omt_dir must not
    # overwrite it (the library's no-op guard must be honored).
    local preset_dir="$TEST_TMP_DIR/my-preset-omt"
    mkdir -p "$preset_dir"
    export OMT_DIR="$preset_dir"

    # Create a marker file to confirm we reached the notification stage
    local marker="$TEST_TMP_DIR/notified"
    export OSASCRIPT_MARKER_FILE="$marker"

    run_stop_notify "s1" "$TEST_TMP_DIR" > /dev/null 2>&1 || true

    # OMT_DIR must still be the preset value after the hook runs.
    # We verify indirectly: ralph-state lookup uses preset_dir, not a fallback.
    # Since no ralph-state exists, the hook should proceed to notification.
    if [[ ! -f "$marker" ]]; then
        echo "ASSERTION FAILED: osascript should have been called (notification stage reached)"
        return 1
    fi

    # Confirm the preset_dir was used: no directory under HOME/.omt should have
    # been created for this project (because OMT_DIR was already set).
    local project_name
    project_name=$(basename "$TEST_TMP_DIR")
    if [[ -d "$TEST_HOME/.omt/$project_name" ]]; then
        echo "ASSERTION FAILED: fallback OMT_DIR should not be created when OMT_DIR is preset"
        return 1
    fi

    return 0
}

# =============================================================================
# Tests: OMT_DIR fallback computation from git repo
# =============================================================================

test_omt_dir_fallback_computed_from_git_repo() {
    # When OMT_DIR is unset, compute_omt_dir should derive it from the git
    # repo's toplevel directory name and place it under $HOME/.omt/.
    unset OMT_DIR

    local marker="$TEST_TMP_DIR/notified"
    export OSASCRIPT_MARKER_FILE="$marker"

    # TEST_TMP_DIR has a .git directory (created in setup_test_env).
    # The git repo basename is the dir name of TEST_TMP_DIR.
    local project_name
    project_name=$(basename "$TEST_TMP_DIR")
    local expected_omt_dir="$TEST_HOME/.omt/$project_name"

    run_stop_notify "s2" "$TEST_TMP_DIR" > /dev/null 2>&1 || true

    # The hook should have created the expected OMT_DIR
    if [[ ! -d "$expected_omt_dir" ]]; then
        echo "ASSERTION FAILED: fallback OMT_DIR should be created at $expected_omt_dir"
        return 1
    fi

    # Notification should still reach osascript (no ralph-state file present)
    if [[ ! -f "$marker" ]]; then
        echo "ASSERTION FAILED: osascript should have been called after fallback OMT_DIR computation"
        return 1
    fi

    return 0
}

# =============================================================================
# Tests: ralph-state active suppresses notification
# =============================================================================

test_ralph_state_active_suppresses_notification() {
    # When ralph-state-{session}.json has "active": true, the hook must
    # exit before reaching the notification stage.
    local omt_dir="$TEST_TMP_DIR/.omt"
    mkdir -p "$omt_dir"
    export OMT_DIR="$omt_dir"

    local session_id="session-active"
    cat > "$omt_dir/ralph-state-${session_id}.json" << 'EOF'
{"active": true, "iteration": 1, "max_iterations": 10, "completion_promise": "DONE"}
EOF

    local marker="$TEST_TMP_DIR/notified"
    export OSASCRIPT_MARKER_FILE="$marker"

    run_stop_notify "$session_id" "$TEST_TMP_DIR" > /dev/null 2>&1 || true

    # osascript must NOT have been called
    if [[ -f "$marker" ]]; then
        echo "ASSERTION FAILED: osascript should NOT be called when ralph is active"
        return 1
    fi

    return 0
}

# =============================================================================
# Tests: ralph-state absent allows notification
# =============================================================================

test_ralph_state_absent_allows_notification() {
    # When no ralph-state file exists, the hook must proceed to notification.
    local omt_dir="$TEST_TMP_DIR/.omt"
    mkdir -p "$omt_dir"
    export OMT_DIR="$omt_dir"

    # Ensure no state file exists
    rm -f "$omt_dir/ralph-state-session-absent.json"

    local marker="$TEST_TMP_DIR/notified"
    export OSASCRIPT_MARKER_FILE="$marker"

    run_stop_notify "session-absent" "$TEST_TMP_DIR" > /dev/null 2>&1 || true

    # osascript MUST have been called
    if [[ ! -f "$marker" ]]; then
        echo "ASSERTION FAILED: osascript should be called when no ralph-state file exists"
        return 1
    fi

    return 0
}

# =============================================================================
# Tests: ralph-state active=false allows notification
# =============================================================================

test_ralph_state_inactive_allows_notification() {
    # When ralph-state has "active": false, the hook must proceed to notification.
    local omt_dir="$TEST_TMP_DIR/.omt"
    mkdir -p "$omt_dir"
    export OMT_DIR="$omt_dir"

    local session_id="session-inactive"
    cat > "$omt_dir/ralph-state-${session_id}.json" << 'EOF'
{"active": false, "iteration": 5, "max_iterations": 10, "completion_promise": "DONE"}
EOF

    local marker="$TEST_TMP_DIR/notified"
    export OSASCRIPT_MARKER_FILE="$marker"

    run_stop_notify "$session_id" "$TEST_TMP_DIR" > /dev/null 2>&1 || true

    # osascript MUST have been called
    if [[ ! -f "$marker" ]]; then
        echo "ASSERTION FAILED: osascript should be called when ralph-state has active=false"
        return 1
    fi

    return 0
}

# =============================================================================
# Tests: empty cwd causes early exit (no notification)
# =============================================================================

test_empty_cwd_causes_early_exit() {
    # When cwd is absent from the JSON input, the hook exits early.
    local omt_dir="$TEST_TMP_DIR/.omt"
    mkdir -p "$omt_dir"
    export OMT_DIR="$omt_dir"

    local marker="$TEST_TMP_DIR/notified"
    export OSASCRIPT_MARKER_FILE="$marker"

    echo '{"session_id": "s-empty-cwd"}' | "$SCRIPT_DIR/stop-notify.sh" > /dev/null 2>&1 || true

    # osascript must NOT have been called
    if [[ -f "$marker" ]]; then
        echo "ASSERTION FAILED: osascript should NOT be called when cwd is empty"
        return 1
    fi

    return 0
}

# =============================================================================
# Main Test Runner
# =============================================================================

main() {
    echo "=========================================="
    echo "Stop Notify Hook Tests"
    echo "=========================================="

    # OMT_DIR resolution
    run_test test_omt_dir_preset_is_respected
    run_test test_omt_dir_fallback_computed_from_git_repo

    # ralph-state gating logic
    run_test test_ralph_state_active_suppresses_notification
    run_test test_ralph_state_absent_allows_notification
    run_test test_ralph_state_inactive_allows_notification

    # Early exit guard
    run_test test_empty_cwd_causes_early_exit

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
}

main "$@"

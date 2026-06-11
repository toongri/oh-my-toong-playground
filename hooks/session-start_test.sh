#!/bin/bash
# =============================================================================
# Session Start Hook Tests
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

    # Pre-compute TEST_OMT_DIR: mirrors session-start.sh OMT_DIR derivation.
    # Since TEST_TMP_DIR has no real git repo, PROJECT_NAME = basename(TEST_TMP_DIR).
    TEST_PROJECT_NAME=$(basename "$TEST_TMP_DIR")
    TEST_OMT_DIR="$TEST_HOME/.omt/$TEST_PROJECT_NAME"
    mkdir -p "$TEST_OMT_DIR"
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
# Tests: Session ID extraction
# =============================================================================

test_session_start_extracts_session_id() {
    # Check that session-start.sh extracts SESSION_ID
    if grep -q 'SESSION_ID.*jq.*sessionId' "$SCRIPT_DIR/session-start.sh"; then
        return 0
    else
        echo "ASSERTION FAILED: session-start.sh should extract SESSION_ID"
        return 1
    fi
}

# =============================================================================
# Tests: Session-based ultrawork state file reading
# =============================================================================

test_session_start_ignores_other_sessions_ultrawork_state() {
    # Create ultrawork state file for DIFFERENT session
    cat > "$TEST_OMT_DIR/ultrawork-state-other-session.json" << 'EOF'
{
  "active": true,
  "started_at": "2024-01-01T00:00:00",
  "original_prompt": "other session ultrawork task",
  "reinforcement_count": 0,
  "last_checked_at": "2024-01-01T00:00:00"
}
EOF

    # Run with different sessionId
    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "my-session"}' | "$SCRIPT_DIR/session-start.sh" 2>&1) || true

    # Should NOT contain ultrawork mode restored (no state for this session)
    assert_output_not_contains "$output" "ULTRAWORK MODE RESTORED" "Should NOT restore other session's ultrawork state" || return 1
}

test_session_start_no_generic_ultrawork_state() {
    # session-start.sh should NOT use generic ultrawork-state.json (without session ID)
    local non_session_refs=$(grep -E 'ultrawork-state\.json' "$SCRIPT_DIR/session-start.sh" 2>/dev/null | wc -l)
    if [[ "$non_session_refs" -gt 0 ]]; then
        echo "ASSERTION FAILED: session-start.sh should NOT use generic ultrawork-state.json"
        return 1
    else
        return 0
    fi
}

# =============================================================================
# Tests: OMT_DIR export and directory creation
# =============================================================================

test_session_start_exports_omt_dir_via_claude_env_file() {
    # session-start.sh should export OMT_DIR into CLAUDE_ENV_FILE
    local env_file
    env_file=$(mktemp)

    echo '{"cwd": "'"$TEST_TMP_DIR"'"}' | CLAUDE_ENV_FILE="$env_file" "$SCRIPT_DIR/session-start.sh" > /dev/null 2>&1 || true

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

test_session_start_omt_dir_points_under_home_omt() {
    # OMT_DIR exported should be under $HOME/.omt/
    local env_file
    env_file=$(mktemp)

    echo '{"cwd": "'"$TEST_TMP_DIR"'"}' | CLAUDE_ENV_FILE="$env_file" "$SCRIPT_DIR/session-start.sh" > /dev/null 2>&1 || true

    local exported_omt_dir
    exported_omt_dir=$(grep 'export OMT_DIR=' "$env_file" | sed 's/export OMT_DIR=//' | sed 's/^"//;s/"$//' | head -1)

    rm -f "$env_file"

    if [[ "$exported_omt_dir" == "$TEST_HOME/.omt/"* ]]; then
        return 0
    else
        echo "ASSERTION FAILED: OMT_DIR should be under \$HOME/.omt/"
        echo "  Got: '$exported_omt_dir'"
        echo "  Expected prefix: '$TEST_HOME/.omt/'"
        return 1
    fi
}

test_session_start_creates_omt_dir() {
    # session-start.sh should create the OMT_DIR directory
    local env_file
    env_file=$(mktemp)

    # Use a unique project dir so we can predict OMT_DIR
    local proj_dir
    proj_dir=$(mktemp -d)
    mkdir -p "$proj_dir/.git"

    echo '{"cwd": "'"$proj_dir"'"}' | CLAUDE_ENV_FILE="$env_file" "$SCRIPT_DIR/session-start.sh" > /dev/null 2>&1 || true

    local exported_omt_dir
    exported_omt_dir=$(grep 'export OMT_DIR=' "$env_file" | sed 's/export OMT_DIR=//' | sed 's/^"//;s/"$//' | head -1)

    rm -f "$env_file"
    rm -rf "$proj_dir"

    if [[ -n "$exported_omt_dir" ]] && [[ -d "$exported_omt_dir" ]]; then
        return 0
    else
        echo "ASSERTION FAILED: OMT_DIR directory should be created by session-start.sh"
        echo "  OMT_DIR: '$exported_omt_dir'"
        echo "  Exists: $([ -d "$exported_omt_dir" ] && echo yes || echo no)"
        return 1
    fi
}

# =============================================================================
# Tests: Project root detection - session-start (from hooks/test/project_root_test.sh)
# =============================================================================

test_get_project_root_function_exists_in_session_start() {
    # session-start.sh should define get_project_root function
    if grep -E '^get_project_root\(\)' "$SCRIPT_DIR/session-start.sh" >/dev/null 2>&1; then
        return 0
    else
        echo "ASSERTION FAILED: get_project_root() should be defined in session-start.sh"
        return 1
    fi
}

test_session_start_uses_project_root_variable() {
    # session-start.sh should set and use PROJECT_ROOT variable
    if grep -q 'PROJECT_ROOT=.*get_project_root' "$SCRIPT_DIR/session-start.sh"; then
        return 0
    else
        echo "ASSERTION FAILED: session-start.sh should set PROJECT_ROOT from get_project_root"
        return 1
    fi
}

# =============================================================================
# Tests: Prometheus restore — resume_summary surfaced when plan file unavailable
# =============================================================================

test_session_start_prometheus_surfaces_resume_summary_when_plan_unavailable() {
    local sid="test-prometheus-resume"

    # Active prometheus state: resume_summary set, plan_path empty (never written)
    cat > "$TEST_OMT_DIR/prometheus-state-${sid}.json" << 'EOF'
{
  "active": true,
  "phase": "STAGE_B",
  "plan_path": "",
  "resume_summary": "Working on feature X. Next: implement the validation logic in validator.ts."
}
EOF

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

    # Stdout must be valid JSON
    if ! echo "$output" | jq . > /dev/null 2>&1; then
        echo "ASSERTION FAILED: hook stdout is not valid JSON"
        echo "  Output: ${output:0:500}"
        return 1
    fi

    # additionalContext must contain the bookmark text
    assert_output_contains "$output" "Working on feature X" "additionalContext should contain resume_summary text" || return 1
    assert_output_contains "$output" "Resume from this bookmark" "additionalContext should contain bookmark label" || return 1
}

test_session_start_prometheus_resume_summary_backslash_produces_valid_json() {
    local sid="test-prometheus-backslash"

    # Active prometheus state: resume_summary with literal backslashes (Windows path + regex)
    cat > "$TEST_OMT_DIR/prometheus-state-${sid}.json" << 'EOF'
{
  "active": true,
  "phase": "STAGE_B",
  "plan_path": "",
  "resume_summary": "editing C:\\tmp\\plan with regex \\d+"
}
EOF

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

    # (a) stdout must be valid JSON
    if ! echo "$output" | jq . > /dev/null 2>&1; then
        echo "ASSERTION FAILED: hook stdout is not valid JSON when resume_summary contains backslashes"
        echo "  Output: ${output:0:500}"
        return 1
    fi

    # (b) the parsed additionalContext must contain backslashes intact
    local ctx
    ctx=$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null || echo "")

    if echo "$ctx" | grep -qF 'C:\tmp\plan'; then
        : # good
    else
        echo "ASSERTION FAILED: additionalContext should preserve backslash path C:\\tmp\\plan"
        echo "  additionalContext: ${ctx:0:500}"
        return 1
    fi

    if echo "$ctx" | grep -qF '\d+'; then
        : # good
    else
        echo "ASSERTION FAILED: additionalContext should preserve backslash regex \\d+"
        echo "  additionalContext: ${ctx:0:500}"
        return 1
    fi
}

# =============================================================================
# Tests: Goal state restore — planning-resume vs pursuing-resume
# =============================================================================

test_session_start_goal_state_restore_planning_vs_pursuing() {
    local sid_plan="test-goal-planning"
    local sid_pursue="test-goal-pursuing"
    # Use a current timestamp so stale-cleanup does not delete the file before restore runs
    local now_ts
    now_ts=$(date "+%Y-%m-%dT%H:%M:%S")

    # Active goal-state in planning phase
    cat > "$TEST_OMT_DIR/goal-state-${sid_plan}.json" << EOF
{
  "active": true,
  "phase": "planning",
  "plan_path": "",
  "resume_summary": "Defining the outcome and constraints for the goal.",
  "outcome": "Build feature X",
  "iteration": 0,
  "started_at": "${now_ts}"
}
EOF

    local out_plan
    out_plan=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid_plan"'"}' | "$SCRIPT_DIR/session-start.sh" 2>&1) || true

    # Must contain GOAL RESTORED
    assert_output_contains "$out_plan" "GOAL RESTORED" "planning: should inject GOAL RESTORED" || return 1
    # Must distinguish planning
    assert_output_contains "$out_plan" "planning" "planning: should include phase label" || return 1
    # Must re-assert re-invocation refusal
    assert_output_contains "$out_plan" "refused" "planning: should assert re-invocation refused" || return 1

    # Active goal-state in pursuing phase
    cat > "$TEST_OMT_DIR/goal-state-${sid_pursue}.json" << EOF
{
  "active": true,
  "phase": "pursuing",
  "plan_path": "",
  "resume_summary": "Iterating toward the objective. Block 2 of 5.",
  "outcome": "Build feature X",
  "iteration": 2,
  "started_at": "${now_ts}"
}
EOF

    local out_pursue
    out_pursue=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid_pursue"'"}' | "$SCRIPT_DIR/session-start.sh" 2>&1) || true

    # Must contain GOAL RESTORED
    assert_output_contains "$out_pursue" "GOAL RESTORED" "pursuing: should inject GOAL RESTORED" || return 1
    # Must distinguish pursuing
    assert_output_contains "$out_pursue" "pursuing" "pursuing: should include phase label" || return 1
    # Must re-assert re-invocation refusal
    assert_output_contains "$out_pursue" "refused" "pursuing: should assert re-invocation refused" || return 1
}

test_session_start_stale_goal_state_purged() {
    # Create a goal-state file with last_touched_at older than ACTIVE_IDLE_TTL (6h) — use 7h
    local stale_ts
    stale_ts=$(date -j -v-7H "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || date -d "7 hours ago" "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || echo "2000-01-01T00:00:00")

    local stale_file="$TEST_OMT_DIR/goal-state-stale-session.json"
    cat > "$stale_file" << EOF
{
  "active": true,
  "phase": "pursuing",
  "last_touched_at": "${stale_ts}",
  "outcome": "old goal",
  "iteration": 1
}
EOF

    # Run the hook (GC runs regardless of sessionId; stale-session != fresh-session)
    echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "fresh-session"}' | "$SCRIPT_DIR/session-start.sh" > /dev/null 2>&1 || true

    # Stale goal-state file should be removed (age 7h > ACTIVE_IDLE_TTL 6h)
    if [ -f "$stale_file" ]; then
        echo "ASSERTION FAILED: stale goal-state file (7h heartbeat) should have been purged but still exists"
        return 1
    fi
    return 0
}

test_session_start_terminal_goal_state_not_restored() {
    local sid="test-goal-terminal"
    # Use a current timestamp so stale-cleanup does not delete the file;
    # we are testing that active=false suppresses restoration, not that the file is absent.
    local now_ts
    now_ts=$(date "+%Y-%m-%dT%H:%M:%S")

    # Terminal goal-state: active=false, phase=complete
    cat > "$TEST_OMT_DIR/goal-state-${sid}.json" << EOF
{
  "active": false,
  "phase": "complete",
  "plan_path": "",
  "resume_summary": "Goal was completed.",
  "outcome": "Build feature X",
  "iteration": 3,
  "started_at": "${now_ts}"
}
EOF

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' | "$SCRIPT_DIR/session-start.sh" 2>&1) || true

    # Must NOT inject a goal restore block
    assert_output_not_contains "$output" "GOAL RESTORED" "terminal goal-state must NOT inject GOAL RESTORED" || return 1
}

test_session_start_goal_pursuing_resume_rereads_plan() {
    local sid="test-goal-pursuing-plan"
    local now_ts
    now_ts=$(date "+%Y-%m-%dT%H:%M:%S")

    # Create a real plan file on disk so plan_path resolves to an existing file
    local plan_file="$TEST_OMT_DIR/test-goal-plan.md"
    echo "# Test Plan" > "$plan_file"

    cat > "$TEST_OMT_DIR/goal-state-${sid}.json" << EOF
{
  "active": true,
  "phase": "pursuing",
  "plan_path": "${plan_file}",
  "resume_summary": "Iterating toward the objective. Block 2 of 5.",
  "outcome": "Build feature X",
  "iteration": 2,
  "max_iterations": 10,
  "started_at": "${now_ts}"
}
EOF

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' | "$SCRIPT_DIR/session-start.sh" 2>&1) || true

    # Must instruct to re-read the plan
    assert_output_contains "$output" "Re-read the current plan from disk" "pursuing with plan file: should instruct to re-read plan" || return 1
}

test_session_start_goal_pursuing_resume_no_plan_file() {
    local sid="test-goal-pursuing-noplan"
    local now_ts
    now_ts=$(date "+%Y-%m-%dT%H:%M:%S")

    # plan_path is empty — no plan file available
    cat > "$TEST_OMT_DIR/goal-state-${sid}.json" << EOF
{
  "active": true,
  "phase": "pursuing",
  "plan_path": "",
  "resume_summary": "Iterating toward the objective. Block 2 of 5.",
  "outcome": "Build feature X",
  "iteration": 2,
  "max_iterations": 10,
  "started_at": "${now_ts}"
}
EOF

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' | "$SCRIPT_DIR/session-start.sh" 2>&1) || true

    # Must NOT instruct to re-read (no plan on disk)
    assert_output_not_contains "$output" "Re-read the current plan from disk" "pursuing without plan file: must NOT inject re-read instruction" || return 1
    # Must still surface iteration info
    assert_output_contains "$output" "GOAL RESTORED" "pursuing without plan file: should still inject GOAL RESTORED" || return 1
}

test_session_start_goal_plan_path_backslash_produces_valid_json() {
    local sid="test-goal-planpath-backslash"
    local now_ts
    now_ts=$(date "+%Y-%m-%dT%H:%M:%S")

    # Active pursuing goal-state with a backslash in plan_path (e.g. Windows-style path).
    # plan_path does NOT exist on disk (so the existence check stays false — we are testing
    # the JSON-escaping code path, not the file-available branch).
    cat > "$TEST_OMT_DIR/goal-state-${sid}.json" << EOF
{
  "active": true,
  "phase": "pursuing",
  "plan_path": "/tmp/a\\\\plan.md",
  "resume_summary": "checkpoint",
  "outcome": "Test goal",
  "iteration": 1,
  "max_iterations": 10,
  "started_at": "${now_ts}"
}
EOF

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

    # The hook stdout must be valid JSON (parseable by jq)
    if ! echo "$output" | jq -e . > /dev/null 2>&1; then
        echo "ASSERTION FAILED: hook stdout is not valid JSON when plan_path contains a backslash"
        echo "  Output: ${output:0:500}"
        return 1
    fi

    # The parsed additionalContext must contain GOAL RESTORED
    assert_output_contains "$output" "GOAL RESTORED" "goal plan_path backslash: should inject GOAL RESTORED" || return 1
}

# =============================================================================
# Tests: deep-interview stale-cleanup (glob + mtime fallback)
# =============================================================================

test_session_start_stale_deep_interview_with_started_at_purged() {
    # AC: deep-interview with last_touched_at older than ACTIVE_IDLE_TTL (6h) is removed — use 7h
    local stale_ts
    stale_ts=$(date -j -v-7H "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || date -d "7 hours ago" "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || echo "2000-01-01T00:00:00")

    local stale_file="$TEST_OMT_DIR/deep-interview-active-state-stale-di.json"
    cat > "$stale_file" << EOF
{
  "active": true,
  "sessionId": "stale-di",
  "last_touched_at": "${stale_ts}"
}
EOF

    echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "fresh-session"}' | "$SCRIPT_DIR/session-start.sh" > /dev/null 2>&1 || true

    if [ -f "$stale_file" ]; then
        echo "ASSERTION FAILED: stale deep-interview marker (7h heartbeat) should have been purged but still exists"
        return 1
    fi
    return 0
}

test_session_start_stale_deep_interview_no_started_at_purged_via_mtime() {
    # AC: timestamp-less deep-interview marker with mtime older than ACTIVE_IDLE_TTL (6h) is removed — use 7h
    local stale_file="$TEST_OMT_DIR/deep-interview-active-state-mtime-di.json"
    printf '{"active":true,"sessionId":"mtime-di"}' > "$stale_file"

    # Set mtime to 7 hours ago (BSD: touch -t YYYYmmddHHMM; GNU: touch -d)
    local old_mtime
    old_mtime=$(date -j -v-7H "+%Y%m%d%H%M" 2>/dev/null || date -d "7 hours ago" "+%Y%m%d%H%M" 2>/dev/null || echo "200001010000")
    touch -t "$old_mtime" "$stale_file" 2>/dev/null || touch -d "7 hours ago" "$stale_file" 2>/dev/null || true

    echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "fresh-session"}' | "$SCRIPT_DIR/session-start.sh" > /dev/null 2>&1 || true

    if [ -f "$stale_file" ]; then
        echo "ASSERTION FAILED: timestamp-less deep-interview marker with 7h mtime should have been purged but still exists"
        return 1
    fi
    return 0
}

test_session_start_fresh_deep_interview_marker_survives() {
    # AC: fresh deep-interview marker (mtime now) is NOT removed
    local fresh_file="$TEST_OMT_DIR/deep-interview-active-state-fresh-di.json"
    printf '{"active":true,"sessionId":"fresh-di"}' > "$fresh_file"
    # mtime is already "now" — no touch needed

    echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "fresh-session"}' | "$SCRIPT_DIR/session-start.sh" > /dev/null 2>&1 || true

    if [ ! -f "$fresh_file" ]; then
        echo "ASSERTION FAILED: fresh deep-interview marker should survive cleanup but was removed"
        return 1
    fi
    return 0
}

# =============================================================================
# Tests: GC liveness unification (TODO 7)
# New TTL semantics: is_state_live via hooks/lib/state-liveness.sh
# ACTIVE_IDLE_TTL=6h, TERMINAL_TTL=30m (see state-liveness.sh for exact values)
# =============================================================================

# C2: current session's active state with 7h-old heartbeat SURVIVES (never reap own session)
test_gc_current_session_active_7h_idle_survives() {
    local stale_ts
    stale_ts=$(date -j -v-7H "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || date -d "7 hours ago" "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || echo "2000-01-01T00:00:00")
    local sid="current-gc-session"
    local state_file="$TEST_OMT_DIR/goal-state-${sid}.json"
    cat > "$state_file" << EOF
{
  "active": true,
  "phase": "pursuing",
  "last_touched_at": "${stale_ts}",
  "outcome": "live goal",
  "iteration": 1
}
EOF
    echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' | "$SCRIPT_DIR/session-start.sh" > /dev/null 2>&1 || true
    if [ ! -f "$state_file" ]; then
        echo "ASSERTION FAILED: current session's active state should survive GC even with 7h-old heartbeat"
        return 1
    fi
    return 0
}

# C1: other-session active with fresh 5m heartbeat SURVIVES
test_gc_other_session_active_fresh_heartbeat_survives() {
    local fresh_ts
    fresh_ts=$(date -j -v-5M "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || date -d "5 minutes ago" "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || date "+%Y-%m-%dT%H:%M:%S")
    local state_file="$TEST_OMT_DIR/goal-state-other-session-A.json"
    cat > "$state_file" << EOF
{
  "active": true,
  "phase": "pursuing",
  "last_touched_at": "${fresh_ts}",
  "outcome": "live goal",
  "iteration": 1
}
EOF
    echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "session-B"}' | "$SCRIPT_DIR/session-start.sh" > /dev/null 2>&1 || true
    if [ ! -f "$state_file" ]; then
        echo "ASSERTION FAILED: other-session active state with 5m heartbeat should survive GC"
        return 1
    fi
    return 0
}

# C3a: other-session active with 7h-old heartbeat is REAPED
test_gc_other_session_active_7h_idle_reaped() {
    local stale_ts
    stale_ts=$(date -j -v-7H "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || date -d "7 hours ago" "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || echo "2000-01-01T00:00:00")
    local state_file="$TEST_OMT_DIR/goal-state-other-session-stale.json"
    cat > "$state_file" << EOF
{
  "active": true,
  "phase": "pursuing",
  "last_touched_at": "${stale_ts}",
  "outcome": "stale goal",
  "iteration": 1
}
EOF
    echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "session-B"}' | "$SCRIPT_DIR/session-start.sh" > /dev/null 2>&1 || true
    if [ -f "$state_file" ]; then
        echo "ASSERTION FAILED: other-session active state with 7h heartbeat should be reaped"
        return 1
    fi
    return 0
}

# C3b part1: terminal state with 1h-old heartbeat is REAPED
test_gc_terminal_state_1h_old_reaped() {
    local old_ts
    old_ts=$(date -j -v-1H "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || date -d "1 hour ago" "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || echo "2000-01-01T00:00:00")
    local state_file="$TEST_OMT_DIR/prometheus-state-terminal-old.json"
    cat > "$state_file" << EOF
{
  "active": false,
  "phase": "complete",
  "last_touched_at": "${old_ts}"
}
EOF
    echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "any-session"}' | "$SCRIPT_DIR/session-start.sh" > /dev/null 2>&1 || true
    if [ -f "$state_file" ]; then
        echo "ASSERTION FAILED: terminal state with 1h heartbeat should be reaped (TERMINAL_TTL=30m)"
        return 1
    fi
    return 0
}

# C3b part2: terminal state with 10m-old heartbeat is KEPT
test_gc_terminal_state_10m_old_kept() {
    local fresh_ts
    fresh_ts=$(date -j -v-10M "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || date -d "10 minutes ago" "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || date "+%Y-%m-%dT%H:%M:%S")
    local state_file="$TEST_OMT_DIR/prometheus-state-terminal-fresh.json"
    cat > "$state_file" << EOF
{
  "active": false,
  "phase": "complete",
  "last_touched_at": "${fresh_ts}"
}
EOF
    echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "any-session"}' | "$SCRIPT_DIR/session-start.sh" > /dev/null 2>&1 || true
    if [ ! -f "$state_file" ]; then
        echo "ASSERTION FAILED: terminal state with 10m heartbeat should survive GC (TERMINAL_TTL=30m)"
        return 1
    fi
    return 0
}

# C6: in-use terminal goal with 10m heartbeat SURVIVES — no carve-out code
test_gc_terminal_goal_fresh_heartbeat_survives_no_carveout() {
    local fresh_ts
    fresh_ts=$(date -j -v-10M "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || date -d "10 minutes ago" "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || date "+%Y-%m-%dT%H:%M:%S")
    local sid="terminal-goal-sid"
    local state_file="$TEST_OMT_DIR/goal-state-${sid}.json"
    cat > "$state_file" << EOF
{
  "active": false,
  "phase": "complete",
  "last_touched_at": "${fresh_ts}",
  "outcome": "Build feature X",
  "iteration": 3
}
EOF
    echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "other-session"}' | "$SCRIPT_DIR/session-start.sh" > /dev/null 2>&1 || true
    if [ ! -f "$state_file" ]; then
        echo "ASSERTION FAILED: in-use terminal goal with fresh heartbeat should survive without carve-out code"
        return 1
    fi
    # Verify no suppress/baseline branch in session-start.sh
    if grep -qiE 'suppress|baseline' "$SCRIPT_DIR/session-start.sh" 2>/dev/null; then
        echo "ASSERTION FAILED: session-start.sh must have 0 suppress/baseline references"
        return 1
    fi
    return 0
}

# glob: the GC for-loop glob must only include exactly the 3 managed prefixes
test_gc_glob_only_managed_prefixes() {
    # Extract lines between "# GC:" marker and the first "# Check for active" block.
    # Then pull the glob prefix names from lines matching the OMT_DIR pattern.
    local gc_section glob_lines glob_count
    gc_section=$(awk '/^# GC:/{found=1} found && /^# Check for active (prometheus|goal)/{found=0} found{print}' "$SCRIPT_DIR/session-start.sh")

    # Extract lines that reference "$OMT_DIR"/<prefix>-*.json
    glob_lines=$(echo "$gc_section" | grep -oE '"?\$\{?OMT_DIR\}?"?/[a-z-]+-\*\.json')
    glob_count=$(echo "$glob_lines" | grep -c '.' 2>/dev/null || true)

    # Exact-set assertion: must be exactly 3 globs
    if [ "$glob_count" -ne 3 ]; then
        echo "ASSERTION FAILED: GC glob must have exactly 3 entries, found $glob_count"
        echo "  Glob lines:"
        echo "$glob_lines"
        echo "  Full GC section:"
        echo "$gc_section" | head -20
        return 1
    fi

    # Each expected prefix must appear exactly once
    local prefix
    for prefix in goal-state prometheus-state deep-interview-active-state; do
        local count
        count=$(echo "$glob_lines" | grep -c "$prefix" 2>/dev/null || true)
        if [ "$count" -ne 1 ]; then
            echo "ASSERTION FAILED: GC glob must contain '$prefix' exactly once, found $count"
            echo "  Glob lines: $glob_lines"
            return 1
        fi
    done

    # Deny-list: the historically removed ralph-state prefix (git af4dff6) must be absent
    if echo "$gc_section" | grep -q 'ralph-state'; then
        echo "ASSERTION FAILED: session-start.sh GC glob must NOT include ralph-state (retired)"
        grep -n 'ralph-state' "$SCRIPT_DIR/session-start.sh" | head -5
        return 1
    fi

    return 0
}

# =============================================================================
# Tests: Retired-loop removal (TODO 10)
# =============================================================================

# G4: orphan-accept — a pre-existing unmanaged state file causes no crash;
# session-start exits 0 and emits no unexpected restore context.
# Uses an unknown-prefix state file to simulate an orphaned legacy state.
test_session_start_orphan_accept_unmanaged_state() {
    # Create a state file with an unknown prefix (simulates legacy orphan)
    cat > "$TEST_OMT_DIR/legacy-loop-state-orphan-abc.json" << 'EOF'
{
  "active": true,
  "iteration": 3,
  "max_iterations": 10,
  "prompt": "orphaned task"
}
EOF

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "live-session-xyz"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

    # Must exit 0 (captured via subshell — check for valid JSON as proxy)
    if ! echo "$output" | jq . > /dev/null 2>&1; then
        echo "ASSERTION FAILED: hook output must be valid JSON (exit 0 proxy)"
        echo "  Output: ${output:0:500}"
        return 1
    fi

    # Must NOT emit any restore context for this unknown prefix
    assert_output_not_contains "$output" "LEGACY-LOOP" "orphan unmanaged state must NOT produce an unexpected restore block" || return 1

    # File must remain untouched (orphan-accept: no migration)
    if [ ! -f "$TEST_OMT_DIR/legacy-loop-state-orphan-abc.json" ]; then
        echo "ASSERTION FAILED: orphan state file should be left untouched (not deleted)"
        return 1
    fi

    return 0
}

# grep-0: session-start.sh must contain zero retired-loop restore references
test_session_start_no_retired_loop_restore() {
    # Guard against re-introducing the ralph-loop restore block (git af4dff6 lines 99-115).
    # Real historical tokens: ralph-state (file prefix) and [RALPH LOOP RESTORED] (restore banner).
    if grep -qiE 'ralph-state|LOOP RESTORED' "$SCRIPT_DIR/session-start.sh" 2>/dev/null; then
        echo "ASSERTION FAILED: session-start.sh must have 0 ralph-loop restore references"
        grep -niE 'ralph-state|LOOP RESTORED' "$SCRIPT_DIR/session-start.sh" | head -10
        return 1
    fi
    return 0
}

# old-threshold-gone: STALE_THRESHOLD / 10800 must not appear
test_gc_old_threshold_constants_removed() {
    if grep -qE '10800|STALE_THRESHOLD' "$SCRIPT_DIR/session-start.sh" 2>/dev/null; then
        echo "ASSERTION FAILED: session-start.sh must not contain STALE_THRESHOLD or 10800"
        return 1
    fi
    return 0
}

# =============================================================================
# Tests: Pristine goal-state is invisible to session-start restore
# A pristine seed (phase=planning, iteration=0, outcome="") must NOT produce
# [GOAL RESTORED]; a non-pristine active state must still be restored.
# =============================================================================

test_session_start_pristine_goal_state_not_restored() {
    local sid="test-goal-pristine"
    local now_ts
    now_ts=$(date "+%Y-%m-%dT%H:%M:%S")

    # Pristine seed: phase=planning, iteration=0, outcome="" — the PreToolUse hook
    # seeded this before the goal skill ran; if the skill refuses, this file lingers.
    cat > "$TEST_OMT_DIR/goal-state-${sid}.json" << EOF
{
  "active": true,
  "phase": "planning",
  "iteration": 0,
  "max_iterations": 10,
  "outcome": "",
  "started_at": "${now_ts}"
}
EOF

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' | "$SCRIPT_DIR/session-start.sh" 2>&1) || true

    # Pristine seed must NOT produce GOAL RESTORED
    assert_output_not_contains "$output" "GOAL RESTORED" "pristine goal-state must NOT inject GOAL RESTORED" || return 1
}

test_session_start_non_pristine_planning_goal_still_restored() {
    local sid="test-goal-nonpristine"
    local now_ts
    now_ts=$(date "+%Y-%m-%dT%H:%M:%S")

    # Non-pristine: outcome is set — this is a real in-progress goal.
    cat > "$TEST_OMT_DIR/goal-state-${sid}.json" << EOF
{
  "active": true,
  "phase": "planning",
  "iteration": 0,
  "max_iterations": 10,
  "outcome": "ship feature X",
  "started_at": "${now_ts}"
}
EOF

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' | "$SCRIPT_DIR/session-start.sh" 2>&1) || true

    # Non-pristine planning state must still produce GOAL RESTORED
    assert_output_contains "$output" "GOAL RESTORED" "non-pristine planning goal-state must inject GOAL RESTORED" || return 1
}

test_session_start_pristine_goal_absent_outcome_not_restored() {
    # outcome field entirely absent (jq .outcome returns null) → treated as "" → pristine → not restored
    local sid="test-goal-pristine-absent-outcome"
    local now_ts
    now_ts=$(date "+%Y-%m-%dT%H:%M:%S")

    cat > "$TEST_OMT_DIR/goal-state-${sid}.json" << EOF
{
  "active": true,
  "phase": "planning",
  "iteration": 0,
  "max_iterations": 10,
  "started_at": "${now_ts}"
}
EOF

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' | "$SCRIPT_DIR/session-start.sh" 2>&1) || true

    assert_output_not_contains "$output" "GOAL RESTORED" "pristine goal-state (absent outcome) must NOT inject GOAL RESTORED" || return 1
}

# =============================================================================
# Main Test Runner
# =============================================================================

main() {
    echo "=========================================="
    echo "Session Start Hook Tests"
    echo "=========================================="

    # Session ID extraction
    run_test test_session_start_extracts_session_id

    # Session-based ultrawork state tests
    run_test test_session_start_ignores_other_sessions_ultrawork_state
    run_test test_session_start_no_generic_ultrawork_state

    # OMT_DIR export and directory creation
    run_test test_session_start_exports_omt_dir_via_claude_env_file
    run_test test_session_start_omt_dir_points_under_home_omt
    run_test test_session_start_creates_omt_dir

    # Project root detection - session-start (from hooks/test/project_root_test.sh)
    run_test test_get_project_root_function_exists_in_session_start
    run_test test_session_start_uses_project_root_variable

    # Prometheus restore: resume_summary surfaced when plan file unavailable
    run_test test_session_start_prometheus_surfaces_resume_summary_when_plan_unavailable

    # Prometheus restore: backslashes in resume_summary produce valid JSON and are preserved
    run_test test_session_start_prometheus_resume_summary_backslash_produces_valid_json

    # Goal state restore
    run_test test_session_start_goal_state_restore_planning_vs_pursuing
    run_test test_session_start_stale_goal_state_purged
    run_test test_session_start_terminal_goal_state_not_restored
    run_test test_session_start_goal_pursuing_resume_rereads_plan
    run_test test_session_start_goal_pursuing_resume_no_plan_file

    # Goal state restore: backslash in plan_path produces valid JSON
    run_test test_session_start_goal_plan_path_backslash_produces_valid_json

    # Pristine goal-state: invisible to session-start restore
    run_test test_session_start_pristine_goal_state_not_restored
    run_test test_session_start_non_pristine_planning_goal_still_restored
    run_test test_session_start_pristine_goal_absent_outcome_not_restored

    # deep-interview stale-cleanup: glob + mtime fallback
    run_test test_session_start_stale_deep_interview_with_started_at_purged
    run_test test_session_start_stale_deep_interview_no_started_at_purged_via_mtime
    run_test test_session_start_fresh_deep_interview_marker_survives

    # GC liveness unification (TODO 7)
    run_test test_gc_current_session_active_7h_idle_survives
    run_test test_gc_other_session_active_fresh_heartbeat_survives
    run_test test_gc_other_session_active_7h_idle_reaped
    run_test test_gc_terminal_state_1h_old_reaped
    run_test test_gc_terminal_state_10m_old_kept
    run_test test_gc_terminal_goal_fresh_heartbeat_survives_no_carveout
    run_test test_gc_glob_only_managed_prefixes
    run_test test_gc_old_threshold_constants_removed

    # Retired-loop removal (TODO 10)
    run_test test_session_start_orphan_accept_unmanaged_state
    run_test test_session_start_no_retired_loop_restore

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
}

main "$@"

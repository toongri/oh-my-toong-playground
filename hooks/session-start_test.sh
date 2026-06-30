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

test_session_start_prometheus_omits_resume_summary_and_emits_pointer_when_plan_unavailable() {
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

    # resume_summary is NO LONGER embedded directly — it is recoverable via the cat pointer.
    assert_output_not_contains "$output" "Working on feature X" "resume_summary text must NOT be embedded directly (now via cat pointer)" || return 1
    assert_output_not_contains "$output" "Resume from this bookmark" "PROM_PLAN_NOTE bookmark must NOT appear (orphan removed)" || return 1

    # cat pointer must be present in additionalContext
    local ctx
    ctx=$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null || echo "")
    if ! echo "$ctx" | grep -qF 'cat "$OMT_DIR/prometheus-state-$OMT_SESSION_ID.json"'; then
        echo "ASSERTION FAILED: additionalContext must contain UNEXPANDED cat pointer"
        echo "  ctx: ${ctx:0:500}"
        return 1
    fi
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

    # (b) resume_summary is NOT embedded directly — recoverable via cat pointer
    local ctx
    ctx=$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null || echo "")

    if echo "$ctx" | grep -qF 'C:\tmp\plan'; then
        echo "ASSERTION FAILED: backslash resume_summary must NOT be embedded directly (now via cat pointer)"
        echo "  additionalContext: ${ctx:0:500}"
        return 1
    fi

    # (c) cat pointer must be present
    if ! echo "$ctx" | grep -qF 'cat "$OMT_DIR/prometheus-state-$OMT_SESSION_ID.json"'; then
        echo "ASSERTION FAILED: additionalContext must contain UNEXPANDED cat pointer"
        echo "  additionalContext: ${ctx:0:500}"
        return 1
    fi
    return 0
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

# Fix B: planning + no plan file → session-invariant guidance text emitted
test_session_start_goal_planning_no_plan_emits_guidance_and_is_invariant() {
    local ts
    ts=$(date "+%Y-%m-%dT%H:%M:%S")
    local sid_a="plan-nofile-sid-alpha"
    local sid_b="plan-nofile-sid-beta"

    # Non-pristine planning states (outcome set) with empty plan_path — no plan file on disk.
    # resume_summary differs between the two sids to prove it is NOT visible in output.
    cat > "$TEST_OMT_DIR/goal-state-${sid_a}.json" << EOF
{
  "active": true,
  "phase": "planning",
  "plan_path": "",
  "resume_summary": "Alpha planning summary - should not appear in output.",
  "outcome": "Build feature X",
  "iteration": 1,
  "started_at": "${ts}",
  "last_touched_at": "${ts}"
}
EOF

    cat > "$TEST_OMT_DIR/goal-state-${sid_b}.json" << EOF
{
  "active": true,
  "phase": "planning",
  "plan_path": "",
  "resume_summary": "Beta planning summary - totally different text.",
  "outcome": "Build feature X",
  "iteration": 1,
  "started_at": "${ts}",
  "last_touched_at": "${ts}"
}
EOF

    local out_a out_b
    out_a=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid_a"'"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true
    out_b=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid_b"'"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

    # Guidance text must be present (Fix B: this fails when GOAL_INSTRUCTION is empty)
    local ctx_a
    ctx_a=$(echo "$out_a" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null || echo "")
    if ! echo "$ctx_a" | grep -q "Continue planning from the beginning"; then
        echo "ASSERTION FAILED (Fix B): planning+no-plan must emit 'Continue planning from the beginning' guidance"
        echo "  ctx_a: ${ctx_a:0:500}"
        return 1
    fi

    # Output is session-invariant: byte-identical across two sids with different resume_summary
    if [ "$out_a" != "$out_b" ]; then
        echo "ASSERTION FAILED (Fix B): planning+no-plan guidance must be session-invariant (byte-identical across sids)"
        echo "  out_a: ${out_a:0:500}"
        echo "  out_b: ${out_b:0:500}"
        return 1
    fi
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
# Tests: T2 — source==compact handoff injection branch + surgical jq -Rs encoder
# =============================================================================

# AC-T2.1: source==compact + adversarial handoff (quote, backslash, real newline,
# tab, \x01 control char) → stdout is valid JSON and additionalContext round-trips
# the handoff text.
test_session_start_compact_handoff_adversarial_valid_json() {
    local sid="test-compact-adversarial"

    # Build a handoff with every hazardous byte: " \ <real newline> <tab> <\x01>
    printf 'HANDOFF_START quote=" back=\\ tab=\tnext-line\nctrl=\001 HANDOFF_END' \
        > "$TEST_OMT_DIR/handoff-${sid}.md"

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'", "source": "compact"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

    # (a) stdout must be valid JSON
    if ! echo "$output" | jq -e . > /dev/null 2>&1; then
        echo "ASSERTION FAILED: hook stdout is not valid JSON for adversarial handoff"
        echo "  Output: ${output:0:500}"
        return 1
    fi

    # (b) the parsed additionalContext must contain the handoff text round-tripped
    local ctx
    ctx=$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null || echo "")
    if ! echo "$ctx" | grep -qF 'HANDOFF_START'; then
        echo "ASSERTION FAILED: additionalContext should contain handoff head HANDOFF_START"
        echo "  additionalContext: ${ctx:0:500}"
        return 1
    fi
    if ! echo "$ctx" | grep -qF 'HANDOFF_END'; then
        echo "ASSERTION FAILED: additionalContext should contain handoff tail HANDOFF_END"
        echo "  additionalContext: ${ctx:0:500}"
        return 1
    fi
    # The literal quote/backslash must survive the round-trip
    if ! echo "$ctx" | grep -qF 'quote="'; then
        echo "ASSERTION FAILED: additionalContext should preserve the literal quote"
        return 1
    fi
    if ! echo "$ctx" | grep -qF 'back=\'; then
        echo "ASSERTION FAILED: additionalContext should preserve the literal backslash"
        return 1
    fi
    return 0
}

# AC-T2.2 (regression): handoff present AND a prometheus restore present →
# BOTH appear in additionalContext; stdout valid JSON; [PROMETHEUS RESTORED]
# marker is byte-present.
test_session_start_compact_handoff_and_prometheus_restore_coexist() {
    local sid="test-compact-coexist"

    cat > "$TEST_OMT_DIR/prometheus-state-${sid}.json" << 'EOF'
{
  "active": true,
  "phase": "STAGE_B",
  "plan_path": "",
  "resume_summary": "Restore body present alongside handoff."
}
EOF

    printf 'HANDOFF_COEXIST_BODY' > "$TEST_OMT_DIR/handoff-${sid}.md"

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'", "source": "compact"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

    # stdout must be valid JSON
    if ! echo "$output" | jq -e . > /dev/null 2>&1; then
        echo "ASSERTION FAILED: combined restore+handoff stdout is not valid JSON"
        echo "  Output: ${output:0:500}"
        return 1
    fi

    # The restore marker must be byte-present in the raw stdout
    assert_output_contains "$output" "\[PROMETHEUS RESTORED\]" "combined output should keep the restore marker" || return 1

    # Both restore content and handoff content must be in the parsed additionalContext
    local ctx
    ctx=$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null || echo "")
    if ! echo "$ctx" | grep -qF 'PROMETHEUS RESTORED'; then
        echo "ASSERTION FAILED: additionalContext should contain the prometheus restore"
        return 1
    fi
    if ! echo "$ctx" | grep -qF 'HANDOFF_COEXIST_BODY'; then
        echo "ASSERTION FAILED: additionalContext should contain the handoff body"
        return 1
    fi
    return 0
}

# AC-T2.3: after a compact start, the handoff file is deleted (delete-on-consume).
test_session_start_compact_handoff_deleted_on_consume() {
    local sid="test-compact-consume"
    local handoff_file="$TEST_OMT_DIR/handoff-${sid}.md"

    printf 'CONSUME_ME' > "$handoff_file"

    echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'", "source": "compact"}' | "$SCRIPT_DIR/session-start.sh" > /dev/null 2>&1 || true

    if [ -f "$handoff_file" ]; then
        echo "ASSERTION FAILED: handoff file should be deleted on consume but still exists"
        return 1
    fi
    return 0
}

# AC-T2.4: source ∈ {startup,resume,clear} → handoff is NOT read; stdout is
# byte-identical to the no-handoff baseline run for the same state fixtures.
test_session_start_non_compact_source_ignores_handoff() {
    local sid="test-noncompact-source"

    # A prometheus restore fixture so there is non-empty MESSAGES output to compare.
    cat > "$TEST_OMT_DIR/prometheus-state-${sid}.json" << 'EOF'
{
  "active": true,
  "phase": "STAGE_B",
  "plan_path": "",
  "resume_summary": "Baseline restore body."
}
EOF

    # Baseline: no handoff file present, source=startup.
    local baseline
    baseline=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'", "source": "startup"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

    # Now plant a handoff file that MUST be ignored by non-compact sources.
    printf 'SHOULD_NOT_APPEAR_NONCOMPACT' > "$TEST_OMT_DIR/handoff-${sid}.md"

    local src
    for src in startup resume clear; do
        local out
        out=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'", "source": "'"$src"'"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

        # Handoff content must never appear
        if echo "$out" | grep -qF 'SHOULD_NOT_APPEAR_NONCOMPACT'; then
            echo "ASSERTION FAILED: source=$src must NOT read the handoff file"
            echo "  Output: ${out:0:500}"
            return 1
        fi

        # Byte-identical to the no-handoff baseline
        if [ "$out" != "$baseline" ]; then
            echo "ASSERTION FAILED: source=$src output should be byte-identical to no-handoff baseline"
            echo "  baseline: ${baseline:0:500}"
            echo "  got:      ${out:0:500}"
            return 1
        fi
    done

    # The handoff file must remain untouched (non-compact sources never consume it)
    if [ ! -f "$TEST_OMT_DIR/handoff-${sid}.md" ]; then
        echo "ASSERTION FAILED: non-compact source must NOT delete the handoff file"
        return 1
    fi
    return 0
}

# AC-T2.5: source grep — the restore sed encoder line is present and unmodified,
# the per-field escapers at the historical lines are unchanged, and the handoff
# is encoded via jq -Rs.
test_session_start_encoder_invariants_in_source() {
    # Restore encoder present and unmodified
    if ! grep -qF "MESSAGES_ESCAPED=\$(echo \"\$MESSAGES\" | sed 's/\"/\\\\\"/g')" "$SCRIPT_DIR/session-start.sh"; then
        echo "ASSERTION FAILED: restore sed encoder line missing or modified"
        grep -n "MESSAGES_ESCAPED=" "$SCRIPT_DIR/session-start.sh"
        return 1
    fi

    # Exactly 0 per-field backslash escapers: PROM_RESUME, GOAL_RESUME, GOAL_PLAN_PATH
    # are no longer embedded in MESSAGES — all 3 escapers have been removed (cache-safe TODO 3).
    local escaper_count
    escaper_count=$(grep -cF "sed 's/\\\\/\\\\\\\\/g'" "$SCRIPT_DIR/session-start.sh" 2>/dev/null || true)
    if [ "$escaper_count" -ne 0 ]; then
        echo "ASSERTION FAILED: expected 0 per-field backslash escapers after cache-safe refactor, found $escaper_count"
        grep -n "sed 's/\\\\" "$SCRIPT_DIR/session-start.sh"
        return 1
    fi

    # Handoff is encoded via jq -Rs
    if ! grep -qE 'jq -Rs' "$SCRIPT_DIR/session-start.sh"; then
        echo "ASSERTION FAILED: handoff must be encoded via 'jq -Rs'"
        return 1
    fi
    return 0
}

# AC-T2.6: source==compact but NO handoff file → stdout equals the restore-only
# JSON (no error, valid JSON, identical to the same-state run without compact).
test_session_start_compact_no_handoff_equals_restore_only() {
    local sid="test-compact-nofile"

    cat > "$TEST_OMT_DIR/prometheus-state-${sid}.json" << 'EOF'
{
  "active": true,
  "phase": "STAGE_B",
  "plan_path": "",
  "resume_summary": "Restore-only body, no handoff."
}
EOF

    # compact source with NO handoff file present
    local out_compact
    out_compact=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'", "source": "compact"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

    # must be valid JSON
    if ! echo "$out_compact" | jq -e . > /dev/null 2>&1; then
        echo "ASSERTION FAILED: compact-with-no-handoff stdout is not valid JSON"
        echo "  Output: ${out_compact:0:500}"
        return 1
    fi

    # restore-only baseline (startup source, same state, no handoff)
    local out_restore_only
    out_restore_only=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'", "source": "startup"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

    if [ "$out_compact" != "$out_restore_only" ]; then
        echo "ASSERTION FAILED: compact-with-no-handoff must equal restore-only output"
        echo "  restore-only: ${out_restore_only:0:500}"
        echo "  compact:      ${out_compact:0:500}"
        return 1
    fi
    return 0
}

# =============================================================================
# Tests: T3 — self-contained orphan-handoff GC arm (ADR D-8)
# Globs $OMT_DIR/handoff-*.md, dash-safe sid extraction, own current-sid guard,
# mtime age > HANDOFF_ORPHAN_TTL_SECS → rm -f. Does NOT call/modify
# is_current_session; leaves the *.json state GC unchanged.
# =============================================================================

# Helper: back-date a file's mtime by N seconds (BSD touch -t; GNU touch -d).
# Minute granularity is acceptable for the 60s-vs-2000s distances tested here.
_backdate_mtime_secs() {
    local file="$1"
    local secs="$2"
    local mins=$(( (secs + 59) / 60 ))
    local stamp
    stamp=$(date -j -v-"${mins}"M "+%Y%m%d%H%M" 2>/dev/null \
        || date -d "${secs} seconds ago" "+%Y%m%d%H%M" 2>/dev/null \
        || echo "200001010000")
    touch -t "$stamp" "$file" 2>/dev/null \
        || touch -d "${secs} seconds ago" "$file" 2>/dev/null \
        || true
}

# AC-T3.1: handoff-<otherUUID>.md with mtime 2000s old → reaped.
test_gc_handoff_orphan_old_reaped() {
    local orphan="$TEST_OMT_DIR/handoff-11111111-2222-3333-4444-555555555555.md"
    printf 'stale handoff body' > "$orphan"
    _backdate_mtime_secs "$orphan" 2000

    echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "current-session"}' | "$SCRIPT_DIR/session-start.sh" > /dev/null 2>&1 || true

    if [ -f "$orphan" ]; then
        echo "ASSERTION FAILED: orphan handoff (2000s old, other session) should be reaped but still exists"
        return 1
    fi
    return 0
}

# AC-T3.2: handoff-<currentSID>.md (current session) → NOT reaped even if old.
test_gc_handoff_current_session_survives_when_old() {
    local sid="current-session"
    local current="$TEST_OMT_DIR/handoff-${sid}.md"
    printf 'current session handoff' > "$current"
    _backdate_mtime_secs "$current" 3000

    echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' | "$SCRIPT_DIR/session-start.sh" > /dev/null 2>&1 || true

    if [ ! -f "$current" ]; then
        echo "ASSERTION FAILED: current-session handoff should survive GC even when old (own current-sid guard)"
        return 1
    fi
    return 0
}

# AC-T3.3: handoff-<otherUUID>.md with mtime 60s old → NOT reaped (under TTL).
test_gc_handoff_orphan_young_survives() {
    local young="$TEST_OMT_DIR/handoff-99999999-8888-7777-6666-555555555555.md"
    printf 'young handoff body' > "$young"
    _backdate_mtime_secs "$young" 60

    echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "current-session"}' | "$SCRIPT_DIR/session-start.sh" > /dev/null 2>&1 || true

    if [ ! -f "$young" ]; then
        echo "ASSERTION FAILED: young orphan handoff (60s old) should survive GC (under 1800s TTL)"
        return 1
    fi
    return 0
}

# AC-T3.4: sid extraction strips 'handoff-' prefix + '.md' suffix exactly; a sid
# containing dashes is matched as the current session (no last-'-' split bug).
test_gc_handoff_dash_sid_matched_exactly() {
    local sid="89bf1e27-a19c-48a1-9950-aaaaaaaaaaaa"
    local current="$TEST_OMT_DIR/handoff-${sid}.md"
    printf 'dash-sid current handoff' > "$current"
    _backdate_mtime_secs "$current" 3000

    # Run AS this dash-containing session — the file is the current session's,
    # so a correct prefix+suffix strip recognizes it and skips the reap.
    echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' | "$SCRIPT_DIR/session-start.sh" > /dev/null 2>&1 || true

    if [ ! -f "$current" ]; then
        echo "ASSERTION FAILED: dash-containing current sid should be matched exactly and skipped (no last-'-' split)"
        return 1
    fi
    return 0
}

# AC-T3.5: the handoff GC arm is self-contained — it does NOT call is_current_session
# (it uses its own dash-safe prefix/suffix sid extraction instead). Inspecting the
# arm's source region directly asserts that invariant without depending on an
# origin/main ref, so it neither false-fails in checkouts lacking the ref nor breaks
# when state-liveness.sh is legitimately edited for an unrelated reason.
test_gc_handoff_arm_does_not_call_is_current_session() {
    local arm
    arm=$(awk '/^for handoff_file in /{f=1} f{print} f&&/^done/{exit}' "$SCRIPT_DIR/session-start.sh")
    if [ -z "$arm" ]; then
        echo "ASSERTION FAILED: could not locate the handoff GC arm loop in session-start.sh"
        return 1
    fi
    if printf '%s\n' "$arm" | grep -q 'is_current_session'; then
        echo "ASSERTION FAILED: handoff GC arm must not call is_current_session (must use its own sid guard)"
        return 1
    fi
    return 0
}

# AC-T3.6: the existing *.json state GC behavior is unchanged — a stale other-session
# *.json state is still reaped while an old handoff is also reaped in the same run.
test_gc_handoff_arm_does_not_disturb_json_state_gc() {
    local stale_ts
    stale_ts=$(date -j -v-7H "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || date -d "7 hours ago" "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || echo "2000-01-01T00:00:00")
    local json_file="$TEST_OMT_DIR/goal-state-other-stale.json"
    cat > "$json_file" << EOF
{
  "active": true,
  "phase": "pursuing",
  "last_touched_at": "${stale_ts}",
  "outcome": "stale goal",
  "iteration": 1
}
EOF
    local orphan="$TEST_OMT_DIR/handoff-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.md"
    printf 'stale handoff' > "$orphan"
    _backdate_mtime_secs "$orphan" 2000

    echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "current-session"}' | "$SCRIPT_DIR/session-start.sh" > /dev/null 2>&1 || true

    # The stale *.json state must still be reaped (existing GC unchanged).
    if [ -f "$json_file" ]; then
        echo "ASSERTION FAILED: stale other-session *.json state should still be reaped (existing GC must be unchanged)"
        return 1
    fi
    # And the orphan handoff reaped by the new arm.
    if [ -f "$orphan" ]; then
        echo "ASSERTION FAILED: orphan handoff should be reaped alongside the *.json GC"
        return 1
    fi
    return 0
}

# =============================================================================
# Tests: Cache-safe restore — TODO 3 (AC2a–AC6)
# session-start.sh must emit UNEXPANDED literal cat pointers so the SessionStart
# additionalContext block is session-invariant and cache-safe.
# =============================================================================

# Shared sentinel state helpers — use fresh timestamps so GC does not reap other-session files
_write_prom_sentinel_state() {
    local sid="$1"
    local ts
    ts=$(date "+%Y-%m-%dT%H:%M:%S")
    cat > "$TEST_OMT_DIR/prometheus-state-${sid}.json" << EOF
{
  "active": true,
  "phase": "S3",
  "plan_path": "/SENTINEL_PP_zzqqxx/plan.md",
  "resume_summary": "SENTINEL_RS_zzqqxx",
  "started_at": "${ts}",
  "last_touched_at": "${ts}",
  "steps": {"acceptance_criteria": {"done": false, "content": [], "recorded_at": ""}, "design_decisions": {"done": false, "ref": ""}, "plan": {"done": false}}
}
EOF
}

_write_goal_sentinel_state() {
    local sid="$1"
    local ts
    ts=$(date "+%Y-%m-%dT%H:%M:%S")
    cat > "$TEST_OMT_DIR/goal-state-${sid}.json" << EOF
{
  "active": true,
  "phase": "pursuing",
  "plan_path": "/SENTINEL_PP_zzqqxx/plan.md",
  "resume_summary": "SENTINEL_RS_zzqqxx",
  "outcome": "Test objective",
  "iteration": 3,
  "max_iterations": 10,
  "started_at": "${ts}",
  "last_touched_at": "${ts}"
}
EOF
}

# AC2a: plan_path and resume_summary sentinels must NOT appear in prometheus stdout
test_cache_safe_prom_sentinel_not_in_stdout() {
    local sid="prom-sentinel-zzqqxx"
    _write_prom_sentinel_state "$sid"

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

    local pp_count rs_count
    pp_count=$(echo "$output" | grep -c "SENTINEL_PP_zzqqxx" 2>/dev/null || true)
    rs_count=$(echo "$output" | grep -c "SENTINEL_RS_zzqqxx" 2>/dev/null || true)

    if [ "${pp_count:-0}" -ne 0 ]; then
        echo "ASSERTION FAILED (AC2a): plan_path sentinel must not appear in stdout (count=$pp_count)"
        return 1
    fi
    if [ "${rs_count:-0}" -ne 0 ]; then
        echo "ASSERTION FAILED (AC2a): resume_summary sentinel must not appear in stdout (count=$rs_count)"
        return 1
    fi
}

# AC2b: prometheus stdout contains UNEXPANDED cat pointer + run-now imperative;
#        static instruction and PROM_PLAN_AVAILABLE branch retained;
#        orphan PROM_PLAN_NOTE removed from source.
test_cache_safe_prom_pointer_and_imperative() {
    local sid="prom-ptr-zzqqxx"
    _write_prom_sentinel_state "$sid"

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

    if ! echo "$output" | jq -e . > /dev/null 2>&1; then
        echo "ASSERTION FAILED (AC2b): hook stdout must be valid JSON"
        echo "  output: ${output:0:500}"
        return 1
    fi

    local ctx
    ctx=$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null || echo "")

    # Exactly 1 UNEXPANDED cat pointer
    local ptr_count
    ptr_count=$(echo "$ctx" | grep -cF 'cat "$OMT_DIR/prometheus-state-$OMT_SESSION_ID.json"' 2>/dev/null || true)
    if [ "${ptr_count:-0}" -ne 1 ]; then
        echo "ASSERTION FAILED (AC2b): additionalContext should contain exactly 1 cat pointer (found ${ptr_count:-0})"
        echo "  ctx: ${ctx:0:600}"
        return 1
    fi

    # run-now imperative
    if ! echo "$ctx" | grep -qiE 'now, before any other action|run .*now|before resuming'; then
        echo "ASSERTION FAILED (AC2b): additionalContext should contain run-now imperative"
        return 1
    fi

    # Static instruction retained
    if ! echo "$ctx" | grep -q "PROMETHEUS RESTORED"; then
        echo "ASSERTION FAILED (AC2b): PROMETHEUS RESTORED header must be retained"
        return 1
    fi

    # PROM_PLAN_AVAILABLE=true branch works: create a real plan file and verify instruction fires
    local plan_file="$TEST_OMT_DIR/test-prom-plan.md"
    echo "# Plan" > "$plan_file"
    local sid2="prom-ptr-planok"
    local ts2
    ts2=$(date "+%Y-%m-%dT%H:%M:%S")
    cat > "$TEST_OMT_DIR/prometheus-state-${sid2}.json" << EOF
{
  "active": true,
  "phase": "S4",
  "plan_path": "${plan_file}",
  "resume_summary": "checkpoint",
  "started_at": "${ts2}",
  "last_touched_at": "${ts2}",
  "steps": {"acceptance_criteria": {"done": false, "content": [], "recorded_at": ""}, "design_decisions": {"done": false, "ref": ""}, "plan": {"done": false}}
}
EOF
    local out2
    out2=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid2"'"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true
    local ctx2
    ctx2=$(echo "$out2" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null || echo "")
    if ! echo "$ctx2" | grep -q "Re-read the current plan from disk and distrust stored verdicts"; then
        echo "ASSERTION FAILED (AC2b): PROM_PLAN_AVAILABLE=true branch must emit re-read instruction"
        echo "  ctx2: ${ctx2:0:600}"
        return 1
    fi

    # PROM_PLAN_NOTE orphan removed from source
    if grep -q 'PROM_PLAN_NOTE' "$SCRIPT_DIR/session-start.sh"; then
        echo "ASSERTION FAILED (AC2b): PROM_PLAN_NOTE must be removed from session-start.sh source"
        return 1
    fi
}

# AC2c: round-trip — source hook-produced CLAUDE_ENV_FILE, execute emitted cat, recover fields
test_cache_safe_prom_round_trip() {
    local sid="prom-rt-zzqqxx"
    _write_prom_sentinel_state "$sid"

    # (pre) stdout must be valid JSON
    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true
    if ! echo "$output" | jq -e . > /dev/null 2>&1; then
        echo "ASSERTION FAILED (AC2c-pre): hook stdout must be valid JSON"
        return 1
    fi

    # Run with TEMP CLAUDE_ENV_FILE (hook-produced, NOT a test self-export)
    local tmp_env
    tmp_env=$(mktemp)
    echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' \
        | CLAUDE_ENV_FILE="$tmp_env" "$SCRIPT_DIR/session-start.sh" > /dev/null 2>&1 || true

    # Source hook-produced file (not a test self-export)
    # shellcheck source=/dev/null
    source "$tmp_env"
    rm -f "$tmp_env"

    # Execute the emitted cat and verify fields are recoverable
    local state_out
    state_out=$(cat "$OMT_DIR/prometheus-state-$OMT_SESSION_ID.json" 2>/dev/null) || true
    if ! echo "$state_out" | jq -e '.plan_path,.resume_summary' > /dev/null 2>&1; then
        echo "ASSERTION FAILED (AC2c): round-trip cat must recover plan_path and resume_summary (non-empty)"
        echo "  state_out: ${state_out:0:300}"
        return 1
    fi
}

# AC3a: goal plan_path, resume_summary, iteration sentinels must NOT appear in stdout
test_cache_safe_goal_sentinel_not_in_stdout() {
    local sid="goal-sentinel-zzqqxx"
    _write_goal_sentinel_state "$sid"

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

    local pp_count rs_count
    pp_count=$(echo "$output" | grep -c "SENTINEL_PP_zzqqxx" 2>/dev/null || true)
    rs_count=$(echo "$output" | grep -c "SENTINEL_RS_zzqqxx" 2>/dev/null || true)

    if [ "${pp_count:-0}" -ne 0 ]; then
        echo "ASSERTION FAILED (AC3a): goal plan_path sentinel must not appear in stdout (count=$pp_count)"
        return 1
    fi
    if [ "${rs_count:-0}" -ne 0 ]; then
        echo "ASSERTION FAILED (AC3a): goal resume_summary sentinel must not appear in stdout (count=$rs_count)"
        return 1
    fi

    # No iteration digit pattern
    local ctx
    ctx=$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null || echo "")
    if echo "$ctx" | grep -qE 'Iteration:? *[0-9]+/[0-9]+'; then
        echo "ASSERTION FAILED (AC3a): iteration digit pattern must not appear in stdout"
        return 1
    fi
}

# AC3b: goal cat pointer + run-now; retained sentences; GOAL_PLAN_AVAILABLE branch.
#        Must NOT introduce new "Invoke the goal skill" imperative.
test_cache_safe_goal_pointer_and_imperative() {
    local sid="goal-ptr-zzqqxx"
    _write_goal_sentinel_state "$sid"

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

    if ! echo "$output" | jq -e . > /dev/null 2>&1; then
        echo "ASSERTION FAILED (AC3b): hook stdout must be valid JSON"
        return 1
    fi

    local ctx
    ctx=$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null || echo "")

    # Exactly 1 UNEXPANDED cat pointer
    local ptr_count
    ptr_count=$(echo "$ctx" | grep -cF 'cat "$OMT_DIR/goal-state-$OMT_SESSION_ID.json"' 2>/dev/null || true)
    if [ "${ptr_count:-0}" -ne 1 ]; then
        echo "ASSERTION FAILED (AC3b): additionalContext should contain exactly 1 goal cat pointer (found ${ptr_count:-0})"
        echo "  ctx: ${ctx:0:600}"
        return 1
    fi

    # run-now imperative
    if ! echo "$ctx" | grep -qiE 'now, before any other action|run .*now|before resuming'; then
        echo "ASSERTION FAILED (AC3b): additionalContext should contain run-now imperative"
        return 1
    fi

    # "Continue pursuing the objective autonomously" retained
    if ! echo "$ctx" | grep -q "Continue pursuing the objective autonomously"; then
        echo "ASSERTION FAILED (AC3b): 'Continue pursuing the objective autonomously' must be retained"
        return 1
    fi

    # "refused" sentence retained (distinct substring)
    if ! echo "$ctx" | grep -q "refused"; then
        echo "ASSERTION FAILED (AC3b): re-invocation refused sentence must be retained"
        return 1
    fi

    # GOAL RESTORED retained
    if ! echo "$ctx" | grep -q "GOAL RESTORED"; then
        echo "ASSERTION FAILED (AC3b): GOAL RESTORED header must be retained"
        return 1
    fi

    # No new "Invoke the goal skill" imperative (D-4)
    if echo "$ctx" | grep -qiE 'invoke the goal skill|run the goal skill|restart.*goal'; then
        echo "ASSERTION FAILED (AC3b/D-4): must NOT introduce a new 'Invoke the goal skill' imperative"
        return 1
    fi

    # GOAL_PLAN_AVAILABLE=true branch works
    local plan_file="$TEST_OMT_DIR/test-goal-plan.md"
    echo "# Plan" > "$plan_file"
    local sid2="goal-ptr-planok"
    local now_ts
    now_ts=$(date "+%Y-%m-%dT%H:%M:%S")
    cat > "$TEST_OMT_DIR/goal-state-${sid2}.json" << EOF
{
  "active": true,
  "phase": "pursuing",
  "plan_path": "${plan_file}",
  "resume_summary": "checkpoint",
  "outcome": "Test objective",
  "iteration": 2,
  "max_iterations": 10,
  "started_at": "${now_ts}"
}
EOF
    local out2
    out2=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid2"'"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true
    local ctx2
    ctx2=$(echo "$out2" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null || echo "")
    if ! echo "$ctx2" | grep -q "Re-read the current plan from disk before continuing"; then
        echo "ASSERTION FAILED (AC3b): GOAL_PLAN_AVAILABLE=true branch must emit re-read instruction"
        echo "  ctx2: ${ctx2:0:600}"
        return 1
    fi
}

# AC3c: goal round-trip via sourced CLAUDE_ENV_FILE
test_cache_safe_goal_round_trip() {
    local sid="goal-rt-zzqqxx"
    _write_goal_sentinel_state "$sid"

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true
    if ! echo "$output" | jq -e . > /dev/null 2>&1; then
        echo "ASSERTION FAILED (AC3c-pre): hook stdout must be valid JSON"
        return 1
    fi

    local tmp_env
    tmp_env=$(mktemp)
    echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' \
        | CLAUDE_ENV_FILE="$tmp_env" "$SCRIPT_DIR/session-start.sh" > /dev/null 2>&1 || true

    # shellcheck source=/dev/null
    source "$tmp_env"
    rm -f "$tmp_env"

    local state_out
    state_out=$(cat "$OMT_DIR/goal-state-$OMT_SESSION_ID.json" 2>/dev/null) || true
    if ! echo "$state_out" | jq -e '.plan_path,.resume_summary,.iteration' > /dev/null 2>&1; then
        echo "ASSERTION FAILED (AC3c): round-trip cat must recover plan_path, resume_summary, iteration"
        echo "  state_out: ${state_out:0:300}"
        return 1
    fi
}

# AC4: INCOMPLETE_COUNT 7 vs 3 → pending block byte-identical, no digit
test_cache_safe_incomplete_count_existence_only() {
    local todos_dir="$TEST_HOME/.claude/todos"
    mkdir -p "$todos_dir"

    # 7 incomplete tasks
    printf '[{"id":"1","status":"pending"},{"id":"2","status":"pending"},{"id":"3","status":"pending"},{"id":"4","status":"pending"},{"id":"5","status":"pending"},{"id":"6","status":"pending"},{"id":"7","status":"pending"}]' \
        > "$todos_dir/test-todos.json"

    local out_7
    out_7=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "count-test"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

    # 3 incomplete tasks (same file, different count)
    printf '[{"id":"1","status":"pending"},{"id":"2","status":"pending"},{"id":"3","status":"pending"}]' \
        > "$todos_dir/test-todos.json"

    local out_3
    out_3=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "count-test"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

    # Byte-identical outputs
    if [ "$out_7" != "$out_3" ]; then
        echo "ASSERTION FAILED (AC4): incomplete task count should produce byte-identical output for 7 vs 3"
        echo "  out_7: ${out_7:0:300}"
        echo "  out_3: ${out_3:0:300}"
        return 1
    fi

    # Pending block is present
    local ctx
    ctx=$(echo "$out_7" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null || echo "")
    if ! echo "$ctx" | grep -q "PENDING TASKS DETECTED"; then
        echo "ASSERTION FAILED (AC4): PENDING TASKS DETECTED block must be present"
        return 1
    fi

    # No digit in the message
    if echo "$ctx" | grep -qE 'have [0-9]+ incomplete'; then
        echo "ASSERTION FAILED (AC4): pending message must not contain a digit count"
        return 1
    fi
}

# AC5: large handoff (>7000 chars) emits UNEXPANDED cat pointer; no expanded abs path;
#      run-now retained; large-handoff file PRESERVED; round-trip cat returns non-empty.
test_cache_safe_handoff_large_pointer() {
    local sid="handoff-large-ptr"
    local handoff_file="$TEST_OMT_DIR/handoff-${sid}.md"

    # Create >7000-char handoff file
    yes 'LARGE_HANDOFF_FILLER_LINE_1234567890_ABCDEFGHIJ' 2>/dev/null | head -c 7200 > "$handoff_file" 2>/dev/null || true
    # Fallback if yes/head -c not available
    if [ ! -s "$handoff_file" ] || [ "$(wc -c < "$handoff_file" 2>/dev/null || echo 0)" -lt 7001 ]; then
        python3 -c "print('X' * 7200)" > "$handoff_file" 2>/dev/null || true
    fi

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'", "source": "compact"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

    # (i) stdout valid JSON
    if ! echo "$output" | jq -e . > /dev/null 2>&1; then
        echo "ASSERTION FAILED (AC5): hook stdout must be valid JSON"
        echo "  output: ${output:0:500}"
        return 1
    fi

    local ctx
    ctx=$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null || echo "")

    # (i) UNEXPANDED cat pointer for handoff
    if ! echo "$ctx" | grep -qF 'cat "$OMT_DIR/handoff-$OMT_SESSION_ID.md"'; then
        echo "ASSERTION FAILED (AC5-i): additionalContext must contain UNEXPANDED handoff cat pointer"
        echo "  ctx: ${ctx:0:600}"
        return 1
    fi

    # (i) NO expanded absolute path — check for the actual handoff_file path
    if echo "$ctx" | grep -qF "${handoff_file}"; then
        echo "ASSERTION FAILED (AC5-i): large-handoff must NOT emit expanded absolute path"
        echo "  ctx: ${ctx:0:600}"
        return 1
    fi

    # (ii) run-now imperative retained
    if ! echo "$ctx" | grep -qiE 'now, before any other action'; then
        echo "ASSERTION FAILED (AC5-ii): run-now imperative must be retained beside pointer"
        return 1
    fi

    # (iii) large-handoff file PRESERVED (not deleted)
    if [ ! -f "$handoff_file" ]; then
        echo "ASSERTION FAILED (AC5-iii): large handoff file must be preserved (delete fires only on <=7000 path)"
        return 1
    fi

    # (iii) round-trip: source env file and execute cat
    local tmp_env
    tmp_env=$(mktemp)
    echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'", "source": "compact"}' \
        | CLAUDE_ENV_FILE="$tmp_env" "$SCRIPT_DIR/session-start.sh" > /dev/null 2>&1 || true

    # shellcheck source=/dev/null
    source "$tmp_env"
    rm -f "$tmp_env"

    local cat_result
    cat_result=$(cat "$OMT_DIR/handoff-$OMT_SESSION_ID.md" 2>/dev/null) || true
    if [ -z "$cat_result" ]; then
        echo "ASSERTION FAILED (AC5-iii): round-trip cat of large handoff must return non-empty"
        return 1
    fi
}

# AC6: prometheus restore output is byte-identical across two different session IDs,
# even when resume_summary differs — proving resume_summary is not embedded in output.
test_cache_safe_prom_session_invariant() {
    local ts
    ts=$(date "+%Y-%m-%dT%H:%M:%S")

    local sid_a="aaaa-session-inv"
    local sid_b="zzqqxx-session-inv"

    # Different resume_summary per sid: if resume_summary were still embedded, outputs would differ.
    echo '{"active":true,"phase":"S3","plan_path":"/SENTINEL_PP_zzqqxx/plan.md","resume_summary":"SENTINEL_RS_alpha","started_at":"'"$ts"'","last_touched_at":"'"$ts"'","steps":{"acceptance_criteria":{"done":false,"content":[],"recorded_at":""},"design_decisions":{"done":false,"ref":""},"plan":{"done":false}}}' \
        > "$TEST_OMT_DIR/prometheus-state-${sid_a}.json"
    echo '{"active":true,"phase":"S3","plan_path":"/SENTINEL_PP_zzqqxx/plan.md","resume_summary":"SENTINEL_RS_beta","started_at":"'"$ts"'","last_touched_at":"'"$ts"'","steps":{"acceptance_criteria":{"done":false,"content":[],"recorded_at":""},"design_decisions":{"done":false,"ref":""},"plan":{"done":false}}}' \
        > "$TEST_OMT_DIR/prometheus-state-${sid_b}.json"

    local out_a out_b
    out_a=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid_a"'"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true
    out_b=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid_b"'"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

    if [ "$out_a" != "$out_b" ]; then
        echo "ASSERTION FAILED (AC6-prom): prometheus restore output must be byte-identical across session IDs"
        echo "  out_a: ${out_a:0:500}"
        echo "  out_b: ${out_b:0:500}"
        return 1
    fi
}

# AC6: goal restore output is byte-identical across two different session IDs,
# even when resume_summary differs — proving resume_summary is not embedded in output.
test_cache_safe_goal_session_invariant() {
    local ts
    ts=$(date "+%Y-%m-%dT%H:%M:%S")

    local sid_a="aaaa-goal-inv"
    local sid_b="zzqqxx-goal-inv"

    # Different resume_summary per sid: if resume_summary were still embedded, outputs would differ.
    echo '{"active":true,"phase":"pursuing","plan_path":"/SENTINEL_PP_zzqqxx/plan.md","resume_summary":"SENTINEL_RS_alpha","outcome":"Test objective","iteration":3,"max_iterations":10,"started_at":"'"$ts"'","last_touched_at":"'"$ts"'"}' \
        > "$TEST_OMT_DIR/goal-state-${sid_a}.json"
    echo '{"active":true,"phase":"pursuing","plan_path":"/SENTINEL_PP_zzqqxx/plan.md","resume_summary":"SENTINEL_RS_beta","outcome":"Test objective","iteration":3,"max_iterations":10,"started_at":"'"$ts"'","last_touched_at":"'"$ts"'"}' \
        > "$TEST_OMT_DIR/goal-state-${sid_b}.json"

    local out_a out_b
    out_a=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid_a"'"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true
    out_b=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid_b"'"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

    if [ "$out_a" != "$out_b" ]; then
        echo "ASSERTION FAILED (AC6-goal): goal restore output must be byte-identical across session IDs"
        echo "  out_a: ${out_a:0:500}"
        echo "  out_b: ${out_b:0:500}"
        return 1
    fi
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
    run_test test_session_start_prometheus_omits_resume_summary_and_emits_pointer_when_plan_unavailable

    # Prometheus restore: backslashes in resume_summary produce valid JSON and are preserved
    run_test test_session_start_prometheus_resume_summary_backslash_produces_valid_json

    # Goal state restore
    run_test test_session_start_goal_state_restore_planning_vs_pursuing
    run_test test_session_start_stale_goal_state_purged
    run_test test_session_start_terminal_goal_state_not_restored
    run_test test_session_start_goal_pursuing_resume_rereads_plan
    run_test test_session_start_goal_pursuing_resume_no_plan_file
    run_test test_session_start_goal_planning_no_plan_emits_guidance_and_is_invariant

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

    # T2: source==compact handoff injection branch + surgical jq -Rs encoder
    run_test test_session_start_compact_handoff_adversarial_valid_json
    run_test test_session_start_compact_handoff_and_prometheus_restore_coexist
    run_test test_session_start_compact_handoff_deleted_on_consume
    run_test test_session_start_non_compact_source_ignores_handoff
    run_test test_session_start_encoder_invariants_in_source
    run_test test_session_start_compact_no_handoff_equals_restore_only

    # T3: self-contained orphan-handoff GC arm (ADR D-8)
    run_test test_gc_handoff_orphan_old_reaped
    run_test test_gc_handoff_current_session_survives_when_old
    run_test test_gc_handoff_orphan_young_survives
    run_test test_gc_handoff_dash_sid_matched_exactly
    run_test test_gc_handoff_arm_does_not_call_is_current_session
    run_test test_gc_handoff_arm_does_not_disturb_json_state_gc

    # Cache-safe restore — TODO 3 (AC2a–AC6)
    run_test test_cache_safe_prom_sentinel_not_in_stdout
    run_test test_cache_safe_prom_pointer_and_imperative
    run_test test_cache_safe_prom_round_trip
    run_test test_cache_safe_goal_sentinel_not_in_stdout
    run_test test_cache_safe_goal_pointer_and_imperative
    run_test test_cache_safe_goal_round_trip
    run_test test_cache_safe_incomplete_count_existence_only
    run_test test_cache_safe_handoff_large_pointer
    run_test test_cache_safe_prom_session_invariant
    run_test test_cache_safe_goal_session_invariant

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
}

main "$@"

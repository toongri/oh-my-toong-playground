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
# Must be set before the first setup_test_env call: otherwise its re-entrant
# check below sees a value inherited from the ambient environment (not one
# this suite created) and tears down/rm -rf's a directory it never made.
TEST_TMP_DIR=""

setup_test_env() {
    # Re-entrant: a caller that has already set up a TEST_TMP_DIR/TEST_HOME
    # (e.g. the CLAUDE_ENV_FILE scrub regression test below, which calls
    # setup_test_env a second time after run_test's own call) must have its
    # first pair torn down before a second pair is created, or the first
    # pair is orphaned without cleanup.
    if [ -n "${TEST_TMP_DIR:-}" ]; then
        teardown_test_env
    fi

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
    # Scrub CLAUDE_ENV_FILE before every test's body runs -- otherwise any
    # test spawning session-start.sh without its own override inherits the
    # ambient value (e.g. a live Claude Code session's real env file) and the
    # hook silently overwrites it with this suite's throwaway fixture paths.
    unset CLAUDE_ENV_FILE

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
# Tests: legacy goal-state retirement
# goal is retired, rather than restored, regardless of its JSON lifecycle state.
# =============================================================================

write_legacy_goal_state() {
    local sid="$1"
    local phase="$2"
    local active="$3"
    local outcome="$4"
    cat > "$TEST_OMT_DIR/goal-state-${sid}.json" << EOF
{"active": ${active}, "phase": "${phase}", "outcome": "${outcome}", "iteration": 1}
EOF
}

assert_legacy_goal_retired() {
    local sid="$1"
    local expected_content="$2"
    local source="$TEST_OMT_DIR/goal-state-${sid}.json"
    local retired_dir="$TEST_OMT_DIR/retired"

    if [ -f "$source" ]; then
        echo "ASSERTION FAILED: legacy goal-state source must be moved out of OMT_DIR"
        return 1
    fi
    if [ ! -d "$retired_dir" ]; then
        echo "ASSERTION FAILED: legacy goal-state must be moved into retired/"
        return 1
    fi
    local archived=""
    local candidate
    for candidate in "$retired_dir"/goal-state-"${sid}"*.json; do
        [ -f "$candidate" ] || continue
        if printf '%s\n' "$expected_content" | cmp -s - "$candidate"; then
            archived="$candidate"
            break
        fi
    done
    if [ -z "$archived" ]; then
        echo "ASSERTION FAILED: retired legacy goal-state archive is missing"
        return 1
    fi
}

test_session_start_retires_legacy_goal_states_without_restore() {
    local sid phase active outcome
    for sid in legacy-planning legacy-pursuing legacy-terminal legacy-pristine; do
        case "$sid" in
            legacy-planning) phase=planning; active=true; outcome=planned ;;
            legacy-pursuing) phase=pursuing; active=true; outcome=pursuing ;;
            legacy-terminal) phase=complete; active=false; outcome=complete ;;
            *) phase=planning; active=true; outcome="" ;;
        esac
        write_legacy_goal_state "$sid" "$phase" "$active" "$outcome"
        local source="$TEST_OMT_DIR/goal-state-${sid}.json"
        local original
        original=$(cat "$source")
        local output
        output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' | "$SCRIPT_DIR/session-start.sh" 2>&1) || true
        assert_output_not_contains "$output" "GOAL RESTORED" "legacy goal-state must never be restored" || return 1
        assert_legacy_goal_retired "$sid" "$original" || return 1
    done
}

test_session_start_preserves_legacy_goal_archive_collisions() {
    local sid="legacy-collision"
    local source="$TEST_OMT_DIR/goal-state-${sid}.json"
    local retired_dir="$TEST_OMT_DIR/retired"
    local existing="$retired_dir/goal-state-${sid}.retired-0.json"
    mkdir -p "$retired_dir"
    printf 'existing archive must survive\n' > "$existing"
    write_legacy_goal_state "$sid" pursuing true collision
    local original
    original=$(cat "$source")

    echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' | "$SCRIPT_DIR/session-start.sh" > /dev/null 2>&1 || true

    if ! grep -qF 'existing archive must survive' "$existing"; then
        echo "ASSERTION FAILED: an existing retired archive must never be overwritten"
        return 1
    fi
    assert_legacy_goal_retired "$sid" "$original"
}

test_session_start_legacy_goal_archive_collision_limit_preserves_source() {
    local sid="legacy-collision-limit"
    local retired_dir="$TEST_OMT_DIR/retired"
    local suffix
    mkdir -p "$retired_dir"
    for suffix in $(seq 0 31); do
        printf 'existing %s\n' "$suffix" > "$retired_dir/goal-state-${sid}.retired-${suffix}.json"
    done
    write_legacy_goal_state "$sid" pursuing true exhausted

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' | "$SCRIPT_DIR/session-start.sh" 2>&1) || true
    if [ ! -f "$TEST_OMT_DIR/goal-state-${sid}.json" ]; then
        echo "ASSERTION FAILED: source must remain when archive suffixes are exhausted"
        return 1
    fi
    assert_output_contains "$output" "archive suffix limit" "suffix exhaustion must be diagnosed on stderr" || return 1
}

test_session_start_legacy_goal_archive_creation_failure_preserves_source() {
    local sid="legacy-archive-create-failure"
    printf 'not a directory\n' > "$TEST_OMT_DIR/retired"
    write_legacy_goal_state "$sid" pursuing true preserve

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' | "$SCRIPT_DIR/session-start.sh" 2>&1) || true
    if [ ! -f "$TEST_OMT_DIR/goal-state-${sid}.json" ]; then
        echo "ASSERTION FAILED: source must remain when retired directory cannot be created"
        return 1
    fi
    assert_output_contains "$output" "could not create retired directory" "archive creation failure must be diagnosed" || return 1
}

test_session_start_retires_goal_and_restores_ultragoal() {
    local sid="legacy-goal-with-ultragoal"
    local source="$TEST_OMT_DIR/goal-state-${sid}.json"
    write_legacy_goal_state "$sid" pursuing true legacy
    local original
    original=$(cat "$source")
    cat > "$TEST_OMT_DIR/ultragoal-state-${sid}.json" << 'EOF'
{"active": true, "phase": "pursuing", "outcome": "keep ultragoal", "iteration": 1}
EOF
    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' | "$SCRIPT_DIR/session-start.sh" 2>&1) || true
    if echo "$output" | grep -qF '[GOAL RESTORED]'; then
        echo "ASSERTION FAILED: legacy goal must not restore alongside ultragoal"
        return 1
    fi
    assert_output_contains "$output" "ULTRAGOAL RESTORED" "ultragoal must still restore" || return 1
    assert_legacy_goal_retired "$sid" "$original"
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

test_regression_ambient_claude_env_file_not_leaked_by_unscrubbed_call() {
    # Regression guard for the ambient CLAUDE_ENV_FILE leak: this suite's own
    # unscrubbed session-start.sh call sites (the plain
    # `echo ... | "$SCRIPT_DIR/session-start.sh"` pattern used throughout this
    # file, with no CLAUDE_ENV_FILE override of their own) used to inherit
    # whatever CLAUDE_ENV_FILE was ambient in the runner's shell -- e.g. a
    # live Claude Code session's real env file -- and the hook would
    # unconditionally append export lines to it. setup_test_env() now scrubs
    # CLAUDE_ENV_FILE before every test's body runs; this test re-invokes that
    # real function (not a copy of it) after re-introducing an ambient value,
    # so if the scrub is ever removed from setup_test_env, this goes red.
    local fixture baseline
    fixture=$(mktemp)
    baseline=$(mktemp)
    cp "$fixture" "$baseline"

    export CLAUDE_ENV_FILE="$fixture"
    setup_test_env
    echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "leak-guard-sid"}' \
        | "$SCRIPT_DIR/session-start.sh" > /dev/null 2>&1 || true

    local result=0
    if ! cmp -s "$baseline" "$fixture"; then
        echo "ASSERTION FAILED: CLAUDE_ENV_FILE fixture must stay byte-unchanged when ambient -- setup_test_env's scrub regressed"
        echo "  fixture contents: $(cat "$fixture")"
        result=1
    fi

    rm -f "$fixture" "$baseline"
    return $result
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
# Tests: Prometheus restore — resume_summary omitted (cat pointer emitted) when plan file unavailable
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

# C2: a current session's legacy goal state is retired even when its heartbeat
# is old; retirement takes precedence over the normal current-session GC carveout.
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
    if [ -f "$state_file" ] || [ ! -d "$TEST_OMT_DIR/retired" ]; then
        echo "ASSERTION FAILED: current session's legacy goal state should be retired even with 7h-old heartbeat"
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

# C3a-ultragoal: other-session ultragoal-state with 7h-old heartbeat is REAPED.
test_gc_other_session_ultragoal_7h_idle_reaped() {
    local stale_ts
    stale_ts=$(date -j -v-7H "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || date -d "7 hours ago" "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || echo "2000-01-01T00:00:00")
    local state_file="$TEST_OMT_DIR/ultragoal-state-other-session-stale.json"
    cat > "$state_file" << EOF
{
  "active": true,
  "phase": "pursuing",
  "last_touched_at": "${stale_ts}",
  "outcome": "stale ultragoal",
  "iteration": 1
}
EOF
    echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "session-B"}' | "$SCRIPT_DIR/session-start.sh" > /dev/null 2>&1 || true
    if [ -f "$state_file" ]; then
        echo "ASSERTION FAILED: other-session ultragoal-state with 7h heartbeat should be reaped"
        return 1
    fi
    return 0
}

# C2-ultragoal: current session's active ultragoal-state with 7h-old heartbeat SURVIVES.
test_gc_current_session_ultragoal_active_7h_idle_survives() {
    local stale_ts
    stale_ts=$(date -j -v-7H "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || date -d "7 hours ago" "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || echo "2000-01-01T00:00:00")
    local sid="current-gc-ultragoal-session"
    local state_file="$TEST_OMT_DIR/ultragoal-state-${sid}.json"
    cat > "$state_file" << EOF
{
  "active": true,
  "phase": "pursuing",
  "last_touched_at": "${stale_ts}",
  "outcome": "live ultragoal",
  "iteration": 1
}
EOF
    echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' | "$SCRIPT_DIR/session-start.sh" > /dev/null 2>&1 || true
    if [ ! -f "$state_file" ]; then
        echo "ASSERTION FAILED: current session's active ultragoal-state should survive GC even with 7h-old heartbeat"
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
# Tests: Ultragoal state restore
# ultragoal-state uses its own GoalState-compatible JSON shape. A non-pristine
# active state restores; a pristine planning seed is intentionally inert.
# =============================================================================

test_session_start_ultragoal_state_restore_non_pristine() {
    local sid="test-ultragoal-pursuing"
    local now_ts
    now_ts=$(date "+%Y-%m-%dT%H:%M:%S")

    cat > "$TEST_OMT_DIR/ultragoal-state-${sid}.json" << EOF
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

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' | "$SCRIPT_DIR/session-start.sh" 2>&1) || true

    assert_output_contains "$output" "ULTRAGOAL RESTORED" "non-pristine ultragoal-state must inject ULTRAGOAL RESTORED" || return 1
    assert_output_contains "$output" "pursuing" "ultragoal restore should include phase label" || return 1
    assert_output_contains "$output" "refused" "ultragoal restore should assert re-invocation refused" || return 1
}

test_session_start_pristine_ultragoal_state_not_restored() {
    local sid="test-ultragoal-pristine"
    local now_ts
    now_ts=$(date "+%Y-%m-%dT%H:%M:%S")

    # Pristine ultragoal seed: phase=planning, iteration=0, outcome="".
    cat > "$TEST_OMT_DIR/ultragoal-state-${sid}.json" << EOF
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

    assert_output_not_contains "$output" "ULTRAGOAL RESTORED" "pristine ultragoal-state must NOT inject ULTRAGOAL RESTORED" || return 1
}

# =============================================================================
# Tests: encoding invariants (retained across the TODO 8 handoff removal)
# =============================================================================

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

    # Restore state fields are not embedded in MESSAGES, so no per-field
    # backslash escapers should remain after the cache-safe refactor.
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

# =============================================================================
# Tests: Ledger recording instruction — plan TODO 3 (D2/D3)
# Every session, regardless of source, session-start.sh must inject a static
# reminder that decisions/corrections/next-steps get appended to the durable
# session ledger via omt-ledger.sh AS THEY HAPPEN, with a verbatim mandate for
# user corrections. No fixtures needed -- this must fire on a bare session.
# =============================================================================

# AC-T3.1: fresh session (no state fixtures at all), for every source value,
# emits the ledger recording instruction + both omt-ledger call examples.
test_session_start_ledger_recording_every_source() {
    local src
    for src in startup resume compact clear; do
        local output
        output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "ledger-src-test", "source": "'"$src"'"}' \
            | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

        if ! echo "$output" | jq -e . > /dev/null 2>&1; then
            echo "ASSERTION FAILED: source=$src stdout must be valid JSON"
            echo "  Output: ${output:0:500}"
            return 1
        fi

        local ctx
        ctx=$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null || echo "")

        if ! echo "$ctx" | grep -qF 'LEDGER RECORDING'; then
            echo "ASSERTION FAILED: source=$src must emit the LEDGER RECORDING instruction"
            echo "  ctx: ${ctx:0:600}"
            return 1
        fi
        if ! echo "$ctx" | grep -qF 'omt-ledger.sh" append'; then
            echo "ASSERTION FAILED: source=$src must include an omt-ledger.sh append call example"
            echo "  ctx: ${ctx:0:600}"
            return 1
        fi
        if ! echo "$ctx" | grep -qF 'omt-ledger.sh" now'; then
            echo "ASSERTION FAILED: source=$src must include an omt-ledger.sh now call example"
            echo "  ctx: ${ctx:0:600}"
            return 1
        fi
    done
    return 0
}

# AC-T3.2: the instruction names the verbatim mandate for user corrections (D3) --
# grep for the substance, not exact wording.
test_session_start_ledger_recording_verbatim_mandate() {
    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "ledger-verbatim-test"}' \
        | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

    local ctx
    ctx=$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null || echo "")

    if ! echo "$ctx" | grep -qiF 'verbatim'; then
        echo "ASSERTION FAILED: ledger recording instruction must mandate verbatim correction capture"
        echo "  ctx: ${ctx:0:600}"
        return 1
    fi
    if ! echo "$ctx" | grep -qiF 'paraphrase'; then
        echo "ASSERTION FAILED: ledger recording instruction must forbid paraphrasing corrections"
        echo "  ctx: ${ctx:0:600}"
        return 1
    fi
    return 0
}

# AC-T3.3: session-varying values must never leak into the recording instruction --
# raw session ID absent, and the pointer vars stay UNEXPANDED literal text.
test_session_start_ledger_recording_is_static() {
    local sid="ledger-static-zzqqxx"
    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' \
        | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

    local ctx
    ctx=$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null || echo "")

    if echo "$ctx" | grep -qF "$sid"; then
        echo "ASSERTION FAILED: ledger recording instruction must not leak the raw session id"
        echo "  ctx: ${ctx:0:600}"
        return 1
    fi
    if ! echo "$ctx" | grep -qF '$OMT_SESSION_ID'; then
        echo "ASSERTION FAILED: ledger recording instruction must reference the UNEXPANDED \$OMT_SESSION_ID pointer"
        echo "  ctx: ${ctx:0:600}"
        return 1
    fi
    return 0
}

# AC-T3.4 (PR #162 Codex finding B, P2): the omt-ledger.sh call examples must be
# rooted via the CLAUDE_PROJECT_DIR/HOME literal, not a bare cwd-relative path --
# a bare `.claude/hooks/omt-ledger.sh` breaks when Claude is launched from a
# project subdirectory. The rooted literal must stay UNEXPANDED (cache-safe:
# no machine-specific /Users or /home path leaks into the injected prefix).
test_session_start_ledger_recording_rooted_path() {
    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "ledger-rooted-test"}' \
        | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

    local ctx
    ctx=$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null || echo "")

    if echo "$ctx" | grep -qF ' | .claude/hooks/omt-ledger.sh'; then
        echo "ASSERTION FAILED: omt-ledger.sh call examples must not use the bare cwd-relative path"
        echo "  ctx: ${ctx:0:800}"
        return 1
    fi
    if ! echo "$ctx" | grep -qF '${CLAUDE_PROJECT_DIR:-$HOME}/.claude/hooks/omt-ledger.sh'; then
        echo "ASSERTION FAILED: omt-ledger.sh call examples must be rooted via the unexpanded CLAUDE_PROJECT_DIR/HOME literal"
        echo "  ctx: ${ctx:0:800}"
        return 1
    fi
    if ! echo "$ctx" | grep -qF '${CLAUDE_PROJECT_DIR:-$HOME}/.claude/hooks/omt-ledger.sh" append Decisions'; then
        echo "ASSERTION FAILED: rooted append-Decisions example missing"
        echo "  ctx: ${ctx:0:800}"
        return 1
    fi
    if ! echo "$ctx" | grep -qF '${CLAUDE_PROJECT_DIR:-$HOME}/.claude/hooks/omt-ledger.sh" append Pending'; then
        echo "ASSERTION FAILED: rooted append-Pending example missing"
        echo "  ctx: ${ctx:0:800}"
        return 1
    fi
    if ! echo "$ctx" | grep -qF '${CLAUDE_PROJECT_DIR:-$HOME}/.claude/hooks/omt-ledger.sh" now'; then
        echo "ASSERTION FAILED: rooted now example missing"
        echo "  ctx: ${ctx:0:800}"
        return 1
    fi
    if echo "$ctx" | grep -qE '/Users/|/home/'; then
        echo "ASSERTION FAILED: rooted path must stay unexpanded -- no machine-specific /Users or /home path may leak into the injected prefix"
        echo "  ctx: ${ctx:0:800}"
        return 1
    fi
    return 0
}

# =============================================================================
# Tests: Ledger recovery option D — plan TODO 4 (D1)
# source==compact AND a session ledger exists on disk -> inline ONLY the acute
# sections (## Now, ## User Corrections (verbatim)) into additionalContext;
# bulk sections (Decisions/Pending/Pointers/Learnings) get a pointer+instruction,
# never inline content. Supersedes the removed handoff-inline mechanism (TODO 8).
# =============================================================================

# AC: source=compact + ledger with content in every section -> Now and
# Corrections are inlined, the 4 bulk sections are NOT, and the bulk cat
# pointer is present.
test_session_start_ledger_recovery_inlines_now_and_corrections() {
    local sid="ledger-recovery-positive"
    local ledger_file="$TEST_OMT_DIR/session-ledger-${sid}.md"

    cat > "$ledger_file" << 'EOF'
## Now
NOW_SENTINEL_q1w2e3

## Decisions
DECISIONS_SENTINEL_should_not_appear

## User Corrections (verbatim)
CORR_SENTINEL_a1b2c3

## Pending
PENDING_SENTINEL_should_not_appear

## Pointers
POINTERS_SENTINEL_should_not_appear

## Learnings
LEARNINGS_SENTINEL_should_not_appear
EOF

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'", "source": "compact"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

    if ! echo "$output" | jq -e . > /dev/null 2>&1; then
        echo "ASSERTION FAILED: ledger-recovery stdout must be valid JSON"
        echo "  Output: ${output:0:500}"
        return 1
    fi

    local ctx
    ctx=$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null || echo "")

    if ! echo "$ctx" | grep -qF 'NOW_SENTINEL_q1w2e3'; then
        echo "ASSERTION FAILED: additionalContext must inline the ## Now section content"
        echo "  ctx: ${ctx:0:600}"
        return 1
    fi
    if ! echo "$ctx" | grep -qF 'CORR_SENTINEL_a1b2c3'; then
        echo "ASSERTION FAILED: additionalContext must inline the ## User Corrections (verbatim) section content"
        echo "  ctx: ${ctx:0:600}"
        return 1
    fi

    local bulk_sentinel
    for bulk_sentinel in DECISIONS_SENTINEL_should_not_appear PENDING_SENTINEL_should_not_appear POINTERS_SENTINEL_should_not_appear LEARNINGS_SENTINEL_should_not_appear; do
        if echo "$ctx" | grep -qF "$bulk_sentinel"; then
            echo "ASSERTION FAILED: bulk section content ($bulk_sentinel) must NOT be inlined"
            echo "  ctx: ${ctx:0:600}"
            return 1
        fi
    done

    if ! echo "$ctx" | grep -qF 'cat "$OMT_DIR/session-ledger-$OMT_SESSION_ID.md"'; then
        echo "ASSERTION FAILED: additionalContext must contain the ledger cat pointer for the bulk sections"
        echo "  ctx: ${ctx:0:600}"
        return 1
    fi
    return 0
}

# AC: source=compact, no ledger file on disk -> harmless, no inline block, valid JSON.
test_session_start_ledger_recovery_no_ledger_harmless() {
    local sid="ledger-recovery-noledger"

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'", "source": "compact"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

    if ! echo "$output" | jq -e . > /dev/null 2>&1; then
        echo "ASSERTION FAILED: source=compact with no ledger must still produce valid JSON"
        echo "  Output: ${output:0:500}"
        return 1
    fi

    local ctx
    ctx=$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext // ""' 2>/dev/null || echo "")

    if echo "$ctx" | grep -qF 'LEDGER RECOVERY'; then
        echo "ASSERTION FAILED: no ledger file present, the LEDGER RECOVERY block must not appear"
        return 1
    fi
    return 0
}

# AC: acute (## Now + ## User Corrections) content over the 7000-char inline
# cap -> NOT inlined; the bulk cat pointer is emitted as the fallback instead.
test_session_start_ledger_recovery_acute_over_cap_pointer_fallback() {
    local sid="ledger-acute-overcap"
    local ledger_file="$TEST_OMT_DIR/session-ledger-${sid}.md"

    local big_now
    big_now=$(python3 -c "print('x' * 7200)" 2>/dev/null) || true
    if [ -z "$big_now" ]; then
        big_now=$(yes x 2>/dev/null | tr -d '\n' | head -c 7200)
    fi

    {
        echo "## Now"
        echo "BIGNOW_SENTINEL_${big_now}"
        echo ""
        echo "## Decisions"
        echo "## User Corrections (verbatim)"
        echo "## Pending"
        echo "## Pointers"
        echo "## Learnings"
    } > "$ledger_file"

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'", "source": "compact"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

    if ! echo "$output" | jq -e . > /dev/null 2>&1; then
        echo "ASSERTION FAILED: acute-over-cap stdout must be valid JSON"
        echo "  Output: ${output:0:500}"
        return 1
    fi

    local ctx
    ctx=$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null || echo "")

    if echo "$ctx" | grep -qF 'BIGNOW_SENTINEL'; then
        echo "ASSERTION FAILED: acute content over the 7000-char cap must NOT be inlined"
        return 1
    fi

    if ! echo "$ctx" | grep -qF 'cat "$OMT_DIR/session-ledger-$OMT_SESSION_ID.md"'; then
        echo "ASSERTION FAILED: acute-over-cap must fall back to the ledger cat pointer"
        echo "  ctx: ${ctx:0:500}"
        return 1
    fi
    return 0
}

# AC: recovery D only fires when source==compact; other sources with the SAME
# ledger fixture present must never inline its content.
test_session_start_ledger_recovery_only_on_compact_source() {
    local sid="ledger-recovery-noncompact"
    local ledger_file="$TEST_OMT_DIR/session-ledger-${sid}.md"

    cat > "$ledger_file" << 'EOF'
## Now
NOW_ONLY_COMPACT_SENTINEL

## Decisions
## User Corrections (verbatim)
## Pending
## Pointers
## Learnings
EOF

    local src
    for src in startup resume clear; do
        local output
        output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'", "source": "'"$src"'"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

        if echo "$output" | grep -qF 'NOW_ONLY_COMPACT_SENTINEL'; then
            echo "ASSERTION FAILED: source=$src must NOT trigger ledger recovery inline"
            return 1
        fi
    done
    return 0
}

# AC (F1 regression): acute section content that itself contains a `## `
# markdown line must survive recovery inline in full. The extractor must treat
# ONLY the 6 known skeleton headers as section boundaries, not any `## ` line,
# otherwise a subheader inside a Now/Corrections summary silently truncates the
# inline at that line -- defeating the whole point of option D (acute inlined so
# it survives compaction).
test_session_start_ledger_recovery_preserves_hash_line_in_acute() {
    local sid="ledger-recovery-hashline"
    local ledger_file="$TEST_OMT_DIR/session-ledger-${sid}.md"

    cat > "$ledger_file" << 'EOF'
## Now
Working on the recovery bug.
## Investigation notes
POST_SUBHEADER_SENTINEL_must_survive
## Decisions
DECISIONS_SENTINEL_should_not_appear
## User Corrections (verbatim)
## Pending
## Pointers
## Learnings
EOF

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'", "source": "compact"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

    local ctx
    ctx=$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null || echo "")

    if ! echo "$ctx" | grep -qF 'POST_SUBHEADER_SENTINEL_must_survive'; then
        echo "ASSERTION FAILED: Now content after an inner '## ' line must survive recovery inline (not be truncated)"
        echo "  ctx: ${ctx:0:600}"
        return 1
    fi
    # The real Decisions content is a bulk section and must still be excluded.
    if echo "$ctx" | grep -qF 'DECISIONS_SENTINEL_should_not_appear'; then
        echo "ASSERTION FAILED: bulk Decisions content must not leak into the acute inline"
        echo "  ctx: ${ctx:0:600}"
        return 1
    fi
    return 0
}

# AC (S5 regression): a bulk section (Decisions) whose content contains a line
# equal to a real acute header (`## Now`) must NOT have that injected content
# extracted into the acute inline. Structural section identity, not substring.
test_session_start_ledger_recovery_no_header_injection_from_bulk() {
    local sid="ledger-recovery-inject"
    local ledger_file="$TEST_OMT_DIR/session-ledger-${sid}.md"

    cat > "$ledger_file" << 'EOF'
## Now
REAL_NOW_SENTINEL
## Decisions
real decision
## Now
INJECTED_FROM_BULK_should_not_appear
## User Corrections (verbatim)
## Pending
## Pointers
## Learnings
EOF

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'", "source": "compact"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

    local ctx
    ctx=$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null || echo "")

    if ! echo "$ctx" | grep -qF 'REAL_NOW_SENTINEL'; then
        echo "ASSERTION FAILED: the real Now content must be inlined"
        echo "  ctx: ${ctx:0:600}"
        return 1
    fi
    if echo "$ctx" | grep -qF 'INJECTED_FROM_BULK_should_not_appear'; then
        echo "ASSERTION FAILED: a '## Now' line injected inside a bulk section must NOT leak into the acute inline"
        echo "  ctx: ${ctx:0:600}"
        return 1
    fi
    return 0
}

# =============================================================================
# Test (PR #162 P2 regression): a Now-section content line that collides with
# a skeleton header string is written to disk ESCAPED by omt-ledger.sh (one
# "OMT_ESC::" sentinel prefix -- see hooks/omt-ledger.sh). The recovery reader
# here must unescape exactly that sentinel back off KEPT acute content lines,
# so the literal "## Decisions" line survives, in order, between its
# neighbors -- Now is fully inlined, not truncated -- while a real bulk
# section is still excluded and no raw sentinel leaks into the output.
# =============================================================================

test_session_start_ledger_recovery_unescapes_header_collision_content() {
    local sid="ledger-recovery-escaped-collision"
    local ledger_file="$TEST_OMT_DIR/session-ledger-${sid}.md"

    cat > "$ledger_file" << 'EOF'
## Now
NOW_A
OMT_ESC::## Decisions
NOW_B
## Decisions
REAL_BULK_DECISION_SHOULD_NOT_APPEAR
## User Corrections (verbatim)
## Pending
## Pointers
## Learnings
EOF

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'", "source": "compact"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

    local ctx
    ctx=$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null || echo "")

    # Now must be fully inlined, unescaped, and in order: NOW_A, then the bare
    # (unescaped) "## Decisions" line, then NOW_B -- no truncation.
    local now_lines
    now_lines=$(echo "$ctx" | awk '/^NOW_A$/{f=1} f{print} /^NOW_B$/{f=0}')
    local expected
    expected=$'NOW_A\n## Decisions\nNOW_B'
    if [ "$now_lines" != "$expected" ]; then
        echo "ASSERTION FAILED: Now section must inline NOW_A, an unescaped '## Decisions' content line, then NOW_B, in order"
        echo "  expected: ${expected}"
        echo "  got: ${now_lines}"
        return 1
    fi

    # The raw sentinel must never leak into additionalContext.
    if echo "$ctx" | grep -qF 'OMT_ESC::'; then
        echo "ASSERTION FAILED: the raw escape sentinel must never leak into additionalContext"
        echo "  ctx: ${ctx:0:600}"
        return 1
    fi

    # The real bulk Decisions section must still be excluded from the inline.
    if echo "$ctx" | grep -qF 'REAL_BULK_DECISION_SHOULD_NOT_APPEAR'; then
        echo "ASSERTION FAILED: bulk Decisions content must not leak into the acute inline"
        echo "  ctx: ${ctx:0:600}"
        return 1
    fi
    return 0
}

# =============================================================================
# Test (double-escape round-trip, reader half): a content line double-escaped
# by the writer (two sentinels, because the user's literal text already
# looked like one sentinel + header) must have exactly ONE sentinel stripped
# on recovery -- restoring the user's original one-sentinel text exactly, not
# fully unescaped and not left with both sentinels.
# =============================================================================

test_session_start_ledger_recovery_double_escape_round_trip() {
    local sid="ledger-recovery-double-escape"
    local ledger_file="$TEST_OMT_DIR/session-ledger-${sid}.md"

    cat > "$ledger_file" << 'EOF'
## Now
OMT_ESC::OMT_ESC::## Decisions
## Decisions
## User Corrections (verbatim)
## Pending
## Pointers
## Learnings
EOF

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'", "source": "compact"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

    local ctx
    ctx=$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null || echo "")

    # Exactly one sentinel must remain -- this is the round-trip of the
    # user's original (already sentinel-shaped) literal content.
    local match_count
    match_count=$(echo "$ctx" | grep -cxF 'OMT_ESC::## Decisions')
    if [ "$match_count" -ne 1 ]; then
        echo "ASSERTION FAILED: double-escaped content must recover to exactly one remaining sentinel + header line, found $match_count"
        echo "  ctx: ${ctx:0:600}"
        return 1
    fi
    if echo "$ctx" | grep -qxF 'OMT_ESC::OMT_ESC::## Decisions'; then
        echo "ASSERTION FAILED: both sentinels must not survive recovery (only one must be stripped)"
        echo "  ctx: ${ctx:0:600}"
        return 1
    fi
    if echo "$ctx" | grep -qxF '## Decisions'; then
        echo "ASSERTION FAILED: the line must not be fully unescaped to bare '## Decisions' -- it was double-escaped, so exactly one sentinel must remain"
        echo "  ctx: ${ctx:0:600}"
        return 1
    fi
    return 0
}

# =============================================================================
# Tests: Ledger GC — mtime-based (TODO 5)
# session-ledger-*.md files are durable-append .md, so liveness cannot use
# is_state_live (JSON .active parsing). GC is mtime-only, TTL=ACTIVE_IDLE_TTL
# (6h, state-liveness.sh SSOT). The current session's ledger is always kept
# regardless of mtime (mirrors the sid-skip pattern from state-GC).
# =============================================================================

# AC: non-current-sid ledger with mtime >6h old is reaped.
test_gc_ledger_other_session_stale_reaped() {
    local sid="ledger-gc-other-stale"
    local ledger_file="$TEST_OMT_DIR/session-ledger-${sid}.md"
    printf '## Now\nstale\n' > "$ledger_file"

    local old_mtime
    old_mtime=$(date -j -v-7H "+%Y%m%d%H%M" 2>/dev/null || date -d "7 hours ago" "+%Y%m%d%H%M" 2>/dev/null || echo "200001010000")
    touch -t "$old_mtime" "$ledger_file" 2>/dev/null || touch -d "7 hours ago" "$ledger_file" 2>/dev/null || true

    echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "ledger-gc-fresh-session"}' | "$SCRIPT_DIR/session-start.sh" > /dev/null 2>&1 || true

    if [ -f "$ledger_file" ]; then
        echo "ASSERTION FAILED: other-session ledger with 7h-old mtime should have been reaped"
        return 1
    fi
    return 0
}

# AC: current-sid ledger is preserved unconditionally, even with a 7h-old mtime.
test_gc_ledger_current_session_stale_survives() {
    local sid="ledger-gc-current"
    local ledger_file="$TEST_OMT_DIR/session-ledger-${sid}.md"
    printf '## Now\ncurrent\n' > "$ledger_file"

    local old_mtime
    old_mtime=$(date -j -v-7H "+%Y%m%d%H%M" 2>/dev/null || date -d "7 hours ago" "+%Y%m%d%H%M" 2>/dev/null || echo "200001010000")
    touch -t "$old_mtime" "$ledger_file" 2>/dev/null || touch -d "7 hours ago" "$ledger_file" 2>/dev/null || true

    echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' | "$SCRIPT_DIR/session-start.sh" > /dev/null 2>&1 || true

    if [ ! -f "$ledger_file" ]; then
        echo "ASSERTION FAILED: current-session ledger should survive GC regardless of mtime age"
        return 1
    fi
    return 0
}

# AC: non-current-sid ledger with a fresh mtime (mid-append) is NOT reaped.
test_gc_ledger_other_session_fresh_survives() {
    local sid="ledger-gc-other-fresh"
    local ledger_file="$TEST_OMT_DIR/session-ledger-${sid}.md"
    printf '## Now\nfresh\n' > "$ledger_file"
    # mtime is already "now" -- no touch needed

    echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "ledger-gc-fresh-session2"}' | "$SCRIPT_DIR/session-start.sh" > /dev/null 2>&1 || true

    if [ ! -f "$ledger_file" ]; then
        echo "ASSERTION FAILED: other-session ledger with a fresh mtime (mid-append) should survive GC"
        return 1
    fi
    return 0
}

# AC: ledger GC glob is namespace-scoped to session-ledger-*.md only; an
# unrelated stale .md file (non-ledger) must NOT be touched by it.
test_gc_ledger_namespace_separation_untouched() {
    local other_file="$TEST_OMT_DIR/handoff-old-orphan.md"
    printf 'unrelated stale content\n' > "$other_file"

    local old_mtime
    old_mtime=$(date -j -v-7H "+%Y%m%d%H%M" 2>/dev/null || date -d "7 hours ago" "+%Y%m%d%H%M" 2>/dev/null || echo "200001010000")
    touch -t "$old_mtime" "$other_file" 2>/dev/null || touch -d "7 hours ago" "$other_file" 2>/dev/null || true

    echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "ledger-gc-namespace-session"}' | "$SCRIPT_DIR/session-start.sh" > /dev/null 2>&1 || true

    if [ ! -f "$other_file" ]; then
        echo "ASSERTION FAILED: ledger GC must not touch a non-session-ledger .md file"
        return 1
    fi
    return 0
}

# =============================================================================
# Tests: SessionStart session-artifact GC + drift report (plan TODO 3)
# reap_session_artifacts and list_unclassified_session_files are both defined
# in hooks/lib/state-liveness.sh (plan TODO 1, shared helper); these tests
# exercise this hook's wiring of the two calls, not the shared helper's own
# liveness judgment (covered by hooks/lib/state-liveness_test.sh).
# =============================================================================

_write_artifact_gc_fixture() {
    local omt_dir="$1"
    local other_sid="$2"

    printf '{}' > "$omt_dir/codex-todo-${other_sid}.json"
    printf '{}' > "$omt_dir/goal-verdict-${other_sid}.json"
    printf '{}' > "$omt_dir/ultragoal-codereview-${other_sid}.json"
    printf '{"note":"unclassified"}' > "$omt_dir/mystery-file-123e4567-e89b-12d3-a456-426614174000.json"
    printf 'not a session file\n' > "$omt_dir/notes.txt"

    local old_mtime
    old_mtime=$(date -j -v-7H "+%Y%m%d%H%M" 2>/dev/null || date -d "7 hours ago" "+%Y%m%d%H%M" 2>/dev/null || echo "200001010000")
    touch -t "$old_mtime" \
        "$omt_dir/codex-todo-${other_sid}.json" \
        "$omt_dir/goal-verdict-${other_sid}.json" \
        "$omt_dir/ultragoal-codereview-${other_sid}.json" \
        2>/dev/null \
        || touch -d "7 hours ago" \
        "$omt_dir/codex-todo-${other_sid}.json" \
        "$omt_dir/goal-verdict-${other_sid}.json" \
        "$omt_dir/ultragoal-codereview-${other_sid}.json" \
        2>/dev/null \
        || true
}

# _write_stale_state_fixture: seeds one dead STATE file (not artifact) for
# <other_sid> so that hooks/session-start.sh's reap_dead_state_files call
# actually has something to delete and echo. Without this, the fixture used
# by test_gc_session_artifacts_reaped_and_drift_reported seeds only the 3
# artifact families, so the `reap_dead_state_files ... > /dev/null` redirect
# at hooks/session-start.sh:136 is exercised against zero matches -- a
# stdout-suppression path that is never actually asked to suppress anything
# is not really tested.
#
# last_touched_at is written as local time + numeric UTC offset (colon form,
# e.g. +09:00), never a bare "Z"/UTC marker: hooks/lib/state-liveness.sh
# strips a trailing `Z` or colon-form offset and parses what remains as LOCAL
# time (see its :90-98 comment "Mirrors session-start.sh:80-101"). Writing
# `Z` here while generating the wall-clock string on a KST host would produce
# a timestamp that parses 9 hours older than intended.
_write_stale_state_fixture() {
    local omt_dir="$1"
    local other_sid="$2"

    local stale_ts
    stale_ts=$(date -j -v-7H "+%Y-%m-%dT%H:%M:%S%z" 2>/dev/null || date -d "7 hours ago" "+%Y-%m-%dT%H:%M:%S%z" 2>/dev/null || echo "2000-01-01T00:00:00+0000")
    stale_ts=$(printf '%s' "$stale_ts" | sed -E 's/([+-][0-9]{2})([0-9]{2})$/\1:\2/')

    cat > "$omt_dir/goal-state-${other_sid}.json" << EOF
{
  "active": true,
  "phase": "pursuing",
  "last_touched_at": "${stale_ts}",
  "outcome": "stale other-session goal",
  "iteration": 1
}
EOF
}

# QA Scenario 1 (plan TODO 3): stale other-session artifacts across 3
# families are reaped, the unclassified file and the non-session file both
# survive, stderr names the unclassified file exactly once, and stdout is
# byte-for-byte identical to the pre-change hook's stdout for the same
# fixture.
#
# Baseline: EXPECTED_GC_FIXTURE_STDOUT below is a frozen golden capture of
# hooks/session-start.sh's stdout for THIS exact fixture, taken at commit
# d215e9ce -- the base revision this suite's invariant is declared against
# -- embedded literally rather than fetched from git history at test-run
# time. This replaces a `git show <rev>:hooks/session-start.sh` design that
# had two distinct bugs, not one:
#
#   1. Non-hermetic: a tree exported without git history (`git archive HEAD
#      | tar -x`, exactly how this suite reaches a deployed target project)
#      has no commit to retrieve, so the git-show call failed and this test
#      errored out on every such copy, not just an unusual environment.
#   2. Wrong revision, and wrong even on its own terms: it retrieved a
#      single file (hooks/session-start.sh) from 2e1302d6~1 while overlaying
#      it onto the CURRENT hooks/lib/ (via `cp -R "$SCRIPT_DIR/."` first) --
#      hooks/lib/state-liveness.sh differs substantially between d215e9ce
#      and HEAD, so that mixed old-file/current-lib combination was never
#      actually "the pre-change hook" for any single real revision. It also
#      targeted 2e1302d6~1, not the base d215e9ce this suite's invariant is
#      declared against.
#
# A golden captured from d215e9ce's own full tree (`git archive d215e9ce |
# tar -x`, hook + lib together, run once to produce this literal) closes
# both: no git call at test time, and the captured bytes are provably that
# one revision's own code, lib included -- not a file/lib mismatch.
#
# Verified jq-invariant for this exact fixture: captured with jq on PATH and
# with it stripped, against d215e9ce's tree, 2e1302d6~1's tree (the
# previously-used, now-abandoned target), and HEAD's tree -- all
# combinations, with and without the stale-state fixture, produced the
# identical 1197-byte / md5 020fc284cc194f830ce02a03687df2fa stdout. Neither
# state file this fixture seeds backs the CURRENT session's own id, so no
# <session-restore> block ever fires here regardless of jq -- only the
# ever-present <session-recording> (ledger) block appears. If a future
# change makes this fixture jq-dependent, the golden below simply stops
# matching for whichever jq condition diverges; nothing here special-cases
# that away.
#
# No silent pass on a missing/unusable baseline: unlike the git-retrieval
# design, an embedded literal cannot fail to be *retrieved* -- but it can be
# accidentally left empty by a bad edit, so that failure mode is still
# checked explicitly below (mirroring the old design's own "is it empty"
# guard) rather than trusted implicitly. There is no anti-tautology check
# here as there was for the git-retrieval design: that guard existed because
# a failed `git show` could silently fall back to comparing the current hook
# to itself. A hardcoded literal is never derived from the hook under test at
# run time, so that failure mode cannot occur by construction.
#
# Regenerating this golden (only when hooks/session-start.sh legitimately
# changes behavior for this fixture -- never to make a real regression
# pass):
#   1. Pick the new base commit and update every "d215e9ce" mention in this
#      comment and the line below it to that commit.
#   2. mkdir -p /tmp/gc-golden-base && git archive <new-base> | tar -x -C /tmp/gc-golden-base
#   3. Reproduce this fixture (_write_artifact_gc_fixture +
#      _write_stale_state_fixture into a scratch OMT dir under a scratch
#      HOME, same input JSON shape as below) and run it through
#      /tmp/gc-golden-base/hooks/session-start.sh via
#      `env -u OMT_DIR -u OMT_SESSION_ID HOME=<scratch-home> ...`, capturing
#      stdout to a file.
#   4. Replace the heredoc body below with that file's exact bytes verbatim
#      (the delimiter is quoted -- 'EXPECTED_GC_FIXTURE_STDOUT_EOF' -- so
#      none of its literal $OMT_DIR/$HOME/backtick text gets shell-expanded
#      while pasting).
#   5. Re-run this suite.
# Base commit for the golden below: d215e9ce.
test_gc_session_artifacts_reaped_and_drift_reported() {
    local other_sid="artifact-gc-other-sess"
    local input='{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "artifact-gc-fresh-session"}'

    _write_artifact_gc_fixture "$TEST_OMT_DIR" "$other_sid"
    _write_stale_state_fixture "$TEST_OMT_DIR" "$other_sid"

    local out_before_file
    out_before_file=$(mktemp)
    cat > "$out_before_file" << 'EXPECTED_GC_FIXTURE_STDOUT_EOF'
{"continue": true, "hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": "<session-recording>\n\n[LEDGER RECORDING]\n\nRecord decisions, user corrections, and next-steps to the durable session ledger AS YOU WORK -- do not wait until the end of the session. Ledger sections are append-only, except Now, which the now subcommand replaces with the latest current-state summary.\n\nAppend content (piped via stdin) to a section:\n  <content> | \"${CLAUDE_PROJECT_DIR:-$HOME}/.claude/hooks/omt-ledger.sh\" append Decisions\n  <content> | \"${CLAUDE_PROJECT_DIR:-$HOME}/.claude/hooks/omt-ledger.sh\" append Pending\n\nReplace the current-state summary:\n  <content> | \"${CLAUDE_PROJECT_DIR:-$HOME}/.claude/hooks/omt-ledger.sh\" now\n\nCRITICAL: record a user correction VERBATIM -- the user's exact original words, never a paraphrase or summary. Paraphrasing a correction silently loses the precise wording that made it a correction. Append verbatim corrections to the User Corrections (verbatim) section.\n\n($OMT_DIR and $OMT_SESSION_ID are set in CLAUDE_ENV_FILE exported by this hook; omt-ledger.sh computes the ledger path internally.)\n\n</session-recording>\n\n---\n\n"}}
EXPECTED_GC_FIXTURE_STDOUT_EOF

    if [ ! -s "$out_before_file" ]; then
        echo "ASSERTION FAILED: embedded golden baseline stdout is empty -- refusing to compare stdout against a blank baseline (this would silently pass regardless of what the hook under test prints)"
        rm -f "$out_before_file"
        return 1
    fi

    # Real run: the modified hook under test. Captured to files (not command
    # substitution) so a trailing-newline difference cannot be silently
    # trimmed away by both sides before cmp ever sees it.
    local err_file out_after_file err_after
    err_file=$(mktemp)
    out_after_file=$(mktemp)
    echo "$input" \
        | env -u OMT_DIR -u OMT_SESSION_ID "$SCRIPT_DIR/session-start.sh" \
        > "$out_after_file" 2>"$err_file" || true
    err_after=$(cat "$err_file")
    rm -f "$err_file"

    if ! cmp -s "$out_before_file" "$out_after_file"; then
        echo "ASSERTION FAILED: stdout must be byte-for-byte identical to the pre-change baseline"
        echo "  before: $(head -c 500 "$out_before_file")"
        echo "  after:  $(head -c 500 "$out_after_file")"
        rm -f "$out_before_file" "$out_after_file"
        return 1
    fi
    rm -f "$out_before_file" "$out_after_file"

    if [ -f "$TEST_OMT_DIR/goal-state-${other_sid}.json" ]; then
        echo "ASSERTION FAILED: the stale other-session state file should be reaped by reap_dead_state_files"
        return 1
    fi

    if [ -f "$TEST_OMT_DIR/codex-todo-${other_sid}.json" ] \
        || [ -f "$TEST_OMT_DIR/goal-verdict-${other_sid}.json" ] \
        || [ -f "$TEST_OMT_DIR/ultragoal-codereview-${other_sid}.json" ]; then
        echo "ASSERTION FAILED: stale other-session artifacts across the 3 seeded families should be reaped"
        return 1
    fi

    if [ ! -f "$TEST_OMT_DIR/mystery-file-123e4567-e89b-12d3-a456-426614174000.json" ]; then
        echo "ASSERTION FAILED: unclassified session-keyed file must survive (reported, never reaped)"
        return 1
    fi

    if [ ! -f "$TEST_OMT_DIR/notes.txt" ]; then
        echo "ASSERTION FAILED: non-session file must survive untouched"
        return 1
    fi

    local mention_count
    mention_count=$(printf '%s\n' "$err_after" | grep -cF "mystery-file-123e4567-e89b-12d3-a456-426614174000.json")
    if [ "$mention_count" -ne 1 ]; then
        echo "ASSERTION FAILED: stderr must name the unclassified file exactly once, found $mention_count"
        echo "  stderr: $err_after"
        return 1
    fi

    if ! printf '%s\n' "$err_after" | grep -q "unclassified session file"; then
        echo "ASSERTION FAILED: stderr must carry a prefix identifying the file as an unclassified session file"
        echo "  stderr: $err_after"
        return 1
    fi

    return 0
}

# QA Scenario 2 (plan TODO 3, amended by the identity-unresolved fail-open
# fix below): jq absence must not turn artifact GC into a destructive
# unguarded pass. Without jq, session-start.sh's own sid resolution (:11-14)
# fails, so it falls back to the literal "default" (:21-23) sentinel.
#
# Originally this test only protected "mine" (by exploiting the coincidence
# that it happened to be named codex-todo-default.json) and the live-id sid,
# while still expecting a dead session's artifact to be reaped -- but that
# same "default" fallback is exactly the identity a REAL running session's
# artifacts do NOT carry, so a real session's own artifact (a non-"default"
# name) was silently exposed to that same "dead artifact reap" path (see
# test_gc_session_artifact_survives_when_identity_unresolved_without_jq
# above, which pins that regression down directly). The fix makes
# reap_session_artifacts a no-op entirely whenever SESSION_ID could not be
# resolved, so ALL THREE fixtures below now survive, including the
# once-reaped "dead" one -- this is fail-open by design, not a relaxation:
# jq-less accumulation is recoverable via scripts/omt-cleanup/, an identity-
# blind reap is not. Dead and live sids stay distinct in the fixture purely
# to keep this test's provenance traceable to its original scenario.
test_gc_session_artifacts_survive_without_jq() {
    local dead_sid="artifact-gc-dead-sess"
    local live_sid="artifact-gc-live-sess"

    # Live session's own state file, fresh mtime. Without jq, is_state_live's
    # timestamp parsing (jq-only) silently yields no timestamp and falls back
    # to file mtime -- so freshness here must come from mtime, not content.
    cat > "$TEST_OMT_DIR/goal-state-${live_sid}.json" << EOF
{
  "active": true,
  "phase": "pursuing",
  "outcome": "live goal without jq"
}
EOF

    # "Mine" -- session-start.sh resolves SESSION_ID to "default" without jq,
    # so this is the file that must survive via current-session filename
    # match. Aged 7h so survival cannot be explained by freshness alone.
    printf '{}' > "$TEST_OMT_DIR/codex-todo-default.json"

    # Dead session's artifact -- no live state file backs this sid.
    printf '{}' > "$TEST_OMT_DIR/codex-todo-${dead_sid}.json"

    # Live session's own artifact, aged 7h -- must survive via live-id
    # membership (current sid is "default", not live_sid, so the
    # current-session check does not protect it; its own mtime is stale, so
    # is_artifact_live does not protect it either).
    printf '{}' > "$TEST_OMT_DIR/goal-verdict-${live_sid}.json"

    local old_mtime
    old_mtime=$(date -j -v-7H "+%Y%m%d%H%M" 2>/dev/null || date -d "7 hours ago" "+%Y%m%d%H%M" 2>/dev/null || echo "200001010000")
    touch -t "$old_mtime" \
        "$TEST_OMT_DIR/codex-todo-default.json" \
        "$TEST_OMT_DIR/codex-todo-${dead_sid}.json" \
        "$TEST_OMT_DIR/goal-verdict-${live_sid}.json" \
        2>/dev/null \
        || touch -d "7 hours ago" \
        "$TEST_OMT_DIR/codex-todo-default.json" \
        "$TEST_OMT_DIR/codex-todo-${dead_sid}.json" \
        "$TEST_OMT_DIR/goal-verdict-${live_sid}.json" \
        2>/dev/null \
        || true

    # Build a PATH lacking jq -- symlink every other /usr/bin tool
    # (basename/dirname/awk/sed/stat/grep/touch/...) that session-start.sh
    # needs, since jq happens to share /usr/bin with them on this host.
    local jq_less_bin f bn
    jq_less_bin=$(mktemp -d)
    for f in /usr/bin/*; do
        bn=$(basename "$f")
        [ "$bn" = "jq" ] && continue
        ln -s "$f" "$jq_less_bin/$bn" 2>/dev/null
    done

    # sessionId AND cwd in the input are both irrelevant here: without jq,
    # session-start.sh cannot parse stdin at all (:11-14), so SESSION_ID
    # always falls back to the literal "default" (:21-23) and DIRECTORY
    # falls back to `pwd` (:16-18) regardless of what this JSON claims --
    # cd into TEST_TMP_DIR first so that pwd-fallback still resolves to the
    # fixture project root (and thus TEST_OMT_DIR), not this test script's
    # own invocation directory.
    (cd "$TEST_TMP_DIR" && echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "whatever"}' \
        | PATH="$jq_less_bin:/bin" "$SCRIPT_DIR/session-start.sh" > /dev/null 2>&1) || true

    rm -rf "$jq_less_bin"

    if [ ! -f "$TEST_OMT_DIR/codex-todo-default.json" ]; then
        echo "ASSERTION FAILED: current session's own artifact (codex-todo-default.json) must survive without jq"
        return 1
    fi
    if [ ! -f "$TEST_OMT_DIR/codex-todo-${dead_sid}.json" ]; then
        echo "ASSERTION FAILED: dead session's artifact must also survive without jq -- the whole reap_session_artifacts lane is now skipped on an unresolved identity (fail-open), so nothing is reaped, not even a genuinely dead one"
        return 1
    fi
    if [ ! -f "$TEST_OMT_DIR/goal-verdict-${live_sid}.json" ]; then
        echo "ASSERTION FAILED: live session's artifact should survive via live-id membership even without jq"
        return 1
    fi
    return 0
}

# =============================================================================
# Regression: identity-unresolved (jq absent) must fail OPEN on the
# session-artifact reap lane, not silently reap under the wrong identity.
#
# test_gc_session_artifacts_survive_without_jq above protects an artifact
# that happens to be NAMED "...-default.json" -- it does not prove the
# RUNNING session's own real-id artifact survives. The tests below close that
# gap with a fixture where survival can ONLY come from is_current_session
# correctly matching the real running session's id: the artifact carries a
# real (non-"default") session id, is aged past ACTIVE_IDLE_TTL (rules out
# is_artifact_live's own-mtime protection), and has no backing
# STATE_PREFIXES file for that id (rules out live-id membership). The only
# remaining protection is is_current_session(file, SESSION_ID) -- exactly
# what jq absence breaks, since SESSION_ID falls back to the literal
# "default" sentinel (:21-23) instead of the real id.
# =============================================================================

# Builds a PATH containing symlinks to every /usr/bin and /bin entry except
# jq, with NO fallback directory appended -- unlike the fixture above
# (PATH="$jq_less_bin:/bin"), which silently stops excluding jq on any host
# where /bin (not just /usr/bin) also carries a real jq binary. Self-contained
# by construction: nothing outside $bin_dir is ever consulted for jq.
_build_jq_less_bin_dir() {
    local bin_dir="$1"
    local src_dir f bn
    for src_dir in /usr/bin /bin; do
        for f in "$src_dir"/*; do
            [ -e "$f" ] || continue
            bn=$(basename "$f")
            [ "$bn" = "jq" ] && continue
            [ -e "$bin_dir/$bn" ] && continue
            ln -s "$f" "$bin_dir/$bn" 2>/dev/null
        done
    done
}

# Fixture self-check (mandatory, not optional): a jq-absence fixture that
# silently fails to exclude jq is a no-teeth test that would pass vacuously
# forever. Asserts jq is actually unreachable under the constructed PATH and
# FAILS LOUDLY if it is not, instead of proceeding to run a test that proves
# nothing.
_assert_jq_unreachable() {
    local path_val="$1"
    if PATH="$path_val" command -v jq > /dev/null 2>&1; then
        echo "ASSERTION FAILED: jq-less PATH fixture is invalid -- jq is still reachable via PATH=$path_val"
        return 1
    fi
    return 0
}

# Core negative case: without jq, the running session's own artifact
# (real id, no live backing state, aged past ACTIVE_IDLE_TTL) must survive.
# Before the fix: SESSION_ID resolves to "default", is_current_session fails
# to match the real id in the filename, and reap_session_artifacts deletes
# it. After the fix: the identity-unresolved lane is skipped entirely.
test_gc_session_artifact_survives_when_identity_unresolved_without_jq() {
    local real_sid="unresolved-identity-real-sid"
    local artifact_file="$TEST_OMT_DIR/goal-codereview-${real_sid}.json"
    printf '{"verdict":"APPROVE"}' > "$artifact_file"

    local old_mtime
    old_mtime=$(date -j -v-7H "+%Y%m%d%H%M" 2>/dev/null || date -d "7 hours ago" "+%Y%m%d%H%M" 2>/dev/null || echo "200001010000")
    touch -t "$old_mtime" "$artifact_file" 2>/dev/null || touch -d "7 hours ago" "$artifact_file" 2>/dev/null || true

    # Deliberately no goal-state-${real_sid}.json fixture -- live-id
    # membership must not be able to explain survival either.

    local jq_less_bin
    jq_less_bin=$(mktemp -d)
    _build_jq_less_bin_dir "$jq_less_bin"
    if ! _assert_jq_unreachable "$jq_less_bin"; then
        rm -rf "$jq_less_bin"
        return 1
    fi

    # cd into TEST_TMP_DIR: without jq, DIRECTORY also falls back to `pwd`
    # (:16-18), regardless of the "cwd" claimed in stdin.
    (cd "$TEST_TMP_DIR" && echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$real_sid"'"}' \
        | PATH="$jq_less_bin" "$SCRIPT_DIR/session-start.sh" > /dev/null 2>&1) || true

    rm -rf "$jq_less_bin"

    if [ ! -f "$artifact_file" ]; then
        echo "ASSERTION FAILED: the running session's own artifact must survive when jq is absent and its identity could not be resolved (reap_session_artifacts must not run under an unresolved 'default' identity)"
        return 1
    fi
    return 0
}

# Positive control: same fixture shape, jq present (default PATH).
# SESSION_ID resolves to the real id, so is_current_session protects the
# current session's own artifact while the other session's identically-aged,
# identically-unbacked artifact is still reaped as before. Must pass both
# before and after the fix -- jq presence never takes the skip path.
test_gc_session_artifact_survives_current_reaps_other_with_jq() {
    local real_sid="with-jq-current-sid"
    local other_sid="with-jq-other-sid"
    local current_artifact="$TEST_OMT_DIR/goal-codereview-${real_sid}.json"
    local other_artifact="$TEST_OMT_DIR/goal-codereview-${other_sid}.json"
    printf '{"verdict":"APPROVE"}' > "$current_artifact"
    printf '{"verdict":"APPROVE"}' > "$other_artifact"

    local old_mtime
    old_mtime=$(date -j -v-7H "+%Y%m%d%H%M" 2>/dev/null || date -d "7 hours ago" "+%Y%m%d%H%M" 2>/dev/null || echo "200001010000")
    touch -t "$old_mtime" "$current_artifact" "$other_artifact" 2>/dev/null \
        || touch -d "7 hours ago" "$current_artifact" "$other_artifact" 2>/dev/null \
        || true

    echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$real_sid"'"}' | "$SCRIPT_DIR/session-start.sh" > /dev/null 2>&1 || true

    if [ ! -f "$current_artifact" ]; then
        echo "ASSERTION FAILED: with jq present, the current session's own artifact must survive"
        return 1
    fi
    if [ -f "$other_artifact" ]; then
        echo "ASSERTION FAILED: with jq present, the other session's stale unbacked artifact must still be reaped (the regression guard must not over-protect)"
        return 1
    fi
    return 0
}

# Wiring assertion: the reap_session_artifacts call must thread the real
# $SESSION_ID variable, never a hardcoded literal. Neither test above can
# fully pin this down on its own: hardcoding the call's identity argument to
# the literal "default" would reintroduce the exact destructive regression
# for every real (non-"default") session -- with jq present or absent -- but
# a plain grep is the direct, deterministic way to assert the call site
# itself still passes the live variable.
test_session_start_reap_session_artifacts_wires_real_session_id() {
    if ! grep -qF 'reap_session_artifacts "$OMT_DIR" "$SESSION_ID" "$GC_NOW"' "$SCRIPT_DIR/session-start.sh"; then
        echo "ASSERTION FAILED: reap_session_artifacts call must thread the real \$SESSION_ID variable (not a hardcoded literal)"
        grep -n 'reap_session_artifacts' "$SCRIPT_DIR/session-start.sh"
        return 1
    fi
    return 0
}

# =============================================================================
# Tests: SessionStart hook process exit code.
#
# Every other test in this file invokes the hook as `... | session-start.sh
# ... || true` and never inspects its exit status -- none of the other
# assertions in this file look past stdout/stderr/on-disk side effects. hooks/session-start.sh
# has no `set -e` and its GC lane (:129-174) calls reap_dead_state_files and
# reap_session_artifacts (hooks/lib/state-liveness.sh) without checking their
# return value, so today a real `rm -f` failure inside either reaper cannot
# leak a non-zero status out to Claude Code, which treats a non-zero
# SessionStart exit as a hook failure. These two tests pin that contract down
# at the process level: one on the ordinary GC-pass path, one under an actual
# induced rm failure (chmod 555 on the containing directory, mirroring
# hooks/lib/state-liveness_test.sh's test_reap_dead_state_files_rm_failure_not_echoed_and_reported
# and test_reap_session_artifacts_rm_failure_not_echoed_and_reported).
# =============================================================================

# AC: a normal invocation that actually reaps stale other-session state and
# artifacts (both GC lanes exercised, both against a writable OMT_DIR) exits 0.
test_session_start_hook_exits_zero_on_normal_gc_pass() {
    local other_sid="exitcode-gc-other-sess"
    _write_artifact_gc_fixture "$TEST_OMT_DIR" "$other_sid"
    _write_stale_state_fixture "$TEST_OMT_DIR" "$other_sid"

    local input='{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "exitcode-gc-fresh-session"}'
    local output rc=0
    output=$(echo "$input" | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || rc=$?

    if [ "$rc" -ne 0 ]; then
        echo "ASSERTION FAILED: session-start.sh must exit 0 on a normal invocation that reaps stale state/artifacts, got exit $rc"
        return 1
    fi

    # Anti-vacuity guard: exit 0 alone does not mean the hook actually
    # produced its session context -- confirm stdout is the expected JSON
    # envelope, not empty output from an early exit.
    if ! echo "$output" | jq -e . > /dev/null 2>&1; then
        echo "ASSERTION FAILED: session-start.sh stdout must be valid JSON on a normal GC pass, got empty/invalid output"
        echo "  Output: ${output:0:500}"
        return 1
    fi

    return 0
}

# AC (regression guard): with $OMT_DIR made read-only so the reapers' own
# `rm -f` genuinely fails (reap_dead_state_files/reap_session_artifacts each
# return non-zero per their documented contract -- state-liveness.sh:291-318,
# 354+), the hook must still exit 0. This is the actual contract at risk: a
# future edit that starts checking the reap calls' exit status (e.g.
# `reap_dead_state_files ... > /dev/null || exit 1`, or adding `set -e` to
# this script) would turn a harmless permission hiccup during GC into a hard
# SessionStart hook failure.
test_session_start_hook_exits_zero_when_reaper_rm_fails() {
    local other_sid="exitcode-rmfail-sid"
    _write_artifact_gc_fixture "$TEST_OMT_DIR" "$other_sid"
    _write_stale_state_fixture "$TEST_OMT_DIR" "$other_sid"

    chmod 555 "$TEST_OMT_DIR"   # no write permission: rm -f inside the reapers must fail

    local input='{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "exitcode-rmfail-fresh-session"}'
    local err_file output rc
    err_file="$TEST_TMP_DIR/reaper-rmfail-stderr.txt"   # under TEST_TMP_DIR so teardown_test_env's rm -rf reaps it
    rc=0
    output=$(echo "$input" | "$SCRIPT_DIR/session-start.sh" 2>"$err_file") || rc=$?

    chmod 755 "$TEST_OMT_DIR"   # restore before any assertion so teardown's rm -rf works

    local err_after
    err_after=$(cat "$err_file")

    # Anti-vacuity guard: confirm the fixture actually drove a real rm
    # failure inside the reapers (not e.g. everything already reaped by a
    # different lane, leaving zero rm attempts to fail).
    if ! printf '%s\n' "$err_after" | grep -q "failed to delete"; then
        echo "ASSERTION FAILED: fixture did not trigger a real rm failure in the reapers -- stderr had no 'failed to delete', so this test would pass vacuously"
        echo "  stderr: $err_after"
        return 1
    fi

    if [ "$rc" -ne 0 ]; then
        echo "ASSERTION FAILED: session-start.sh must still exit 0 even when a reaper's rm -f genuinely fails, got exit $rc"
        return 1
    fi

    # Anti-vacuity guard: exit 0 alone does not mean the hook actually
    # produced its session context -- confirm stdout is the expected JSON
    # envelope, not empty output from an early exit right after the reapers.
    if ! echo "$output" | jq -e . > /dev/null 2>&1; then
        echo "ASSERTION FAILED: session-start.sh stdout must be valid JSON even when a reaper's rm -f genuinely fails, got empty/invalid output"
        echo "  Output: ${output:0:500}"
        return 1
    fi

    if [ ! -f "$TEST_OMT_DIR/goal-state-${other_sid}.json" ]; then
        echo "ASSERTION FAILED: with the containing directory read-only, rm -f could not have succeeded -- the stale state file must still be on disk"
        return 1
    fi

    return 0
}

# =============================================================================
# Tests: deep-interview restore block (plan TODO 6)
# di's seed schema (hooks/pre-tool-enforcer.sh) is minimal -- {active,
# started_at, last_touched_at} only, unlike prometheus/qa which also carry
# .phase (and prometheus carries .plan_path). The restore block must
# emit only an active-session re-read instruction and must never emit a blank
# "Phase:" line, since di has no phase field to source one from.
# =============================================================================

# AC: di active-state fixture -> stdout injects a di state re-read instruction
# (restore marker + run-now cat pointer to the di state file).
test_session_start_deep_interview_active_emits_reread_instruction() {
    local sid="di-restore-active"
    cat > "$TEST_OMT_DIR/deep-interview-active-state-${sid}.json" << EOF
{
  "active": true,
  "started_at": "$(date "+%Y-%m-%dT%H:%M:%S")",
  "last_touched_at": "$(date "+%Y-%m-%dT%H:%M:%S")"
}
EOF

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

    if ! echo "$output" | jq -e . > /dev/null 2>&1; then
        echo "ASSERTION FAILED: di-active stdout must be valid JSON"
        echo "  Output: ${output:0:500}"
        return 1
    fi

    local ctx
    ctx=$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null || echo "")

    assert_output_contains "$ctx" "DEEP-INTERVIEW RESTORED" "active di state must inject a DI restore block" || return 1

    if ! echo "$ctx" | grep -qF 'cat "$OMT_DIR/deep-interview-active-state-$OMT_SESSION_ID.json"'; then
        echo "ASSERTION FAILED: additionalContext must contain the UNEXPANDED di state cat pointer"
        echo "  ctx: ${ctx:0:500}"
        return 1
    fi

    if ! echo "$ctx" | grep -qiE 'now, before any other action|run .*now'; then
        echo "ASSERTION FAILED: additionalContext should contain a run-now imperative for the di re-read"
        return 1
    fi
    return 0
}

# AC: di has no .phase field in its seed schema -- the restore block must
# never emit a "Phase:" line (blank or otherwise). Only di is active here
# (no prometheus/qa state), so any "Phase:" occurrence would prove the
# prometheus block was copied verbatim instead of mirrored to di's schema.
test_session_start_deep_interview_no_blank_phase_line() {
    local sid="di-restore-no-phase"
    cat > "$TEST_OMT_DIR/deep-interview-active-state-${sid}.json" << EOF
{
  "active": true,
  "started_at": "$(date "+%Y-%m-%dT%H:%M:%S")",
  "last_touched_at": "$(date "+%Y-%m-%dT%H:%M:%S")"
}
EOF

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

    local ctx
    ctx=$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null || echo "")

    assert_output_not_contains "$ctx" "Phase:" "di restore block must never emit a Phase: line (di seed has no .phase)" || return 1
    return 0
}

# AC (defect fix): di restore must not go quietly dead if hooks/lib/state-
# liveness.sh's STATE_PREFIXES ever drops or renames the deep-interview
# entry. STATE_PREFIXES is scoped to the GC callers (reap_dead_state_files,
# list_live_session_ids) -- it is not a contract this restore path should
# depend on. Reproduced here via an isolated copy of the hooks tree whose
# lib/state-liveness.sh has the deep-interview entry stripped from
# STATE_PREFIXES, standing in for "someone edited the shared GC list and
# didn't know a restore path was silently deriving its own prefix from it."
test_session_start_deep_interview_restore_independent_of_state_prefixes() {
    local sid="di-restore-prefixes-gap"

    cat > "$TEST_OMT_DIR/deep-interview-active-state-${sid}.json" << EOF
{
  "active": true,
  "started_at": "$(date "+%Y-%m-%dT%H:%M:%S")",
  "last_touched_at": "$(date "+%Y-%m-%dT%H:%M:%S")"
}
EOF

    local gapped_hooks_dir
    gapped_hooks_dir=$(mktemp -d)
    cp -R "$SCRIPT_DIR/." "$gapped_hooks_dir/"
    sed -i.bak 's/deep-interview-active-state- //' "$gapped_hooks_dir/lib/state-liveness.sh"
    rm -f "$gapped_hooks_dir/lib/state-liveness.sh.bak"

    # Scoped to the STATE_PREFIXES assignment line itself, not the whole
    # file -- state-liveness.sh's :155 comment also names this prefix in an
    # unrelated .closed.bak example, so a whole-file grep would false-positive
    # on that comment even when the STATE_PREFIXES edit above succeeded.
    if grep -q '^STATE_PREFIXES=.*deep-interview-active-state-' "$gapped_hooks_dir/lib/state-liveness.sh"; then
        echo "ASSERTION FAILED: test setup could not strip the deep-interview entry from the gapped STATE_PREFIXES copy"
        rm -rf "$gapped_hooks_dir"
        return 1
    fi

    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' \
        | env -u OMT_DIR -u OMT_SESSION_ID "$gapped_hooks_dir/session-start.sh" 2>/dev/null) || true

    rm -rf "$gapped_hooks_dir"

    local ctx
    ctx=$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null || echo "")

    assert_output_contains "$ctx" "DEEP-INTERVIEW RESTORED" "di restore must not silently break when STATE_PREFIXES lacks the deep-interview entry" || return 1
    return 0
}

# =============================================================================
# Tests: explain-diff restore block
# =============================================================================

test_session_start_explain_diff_active_non_pristine_emits_restore() {
    local sid="explain-diff-restore-active"
    cat > "$TEST_OMT_DIR/explain-diff-state-${sid}.json" << 'EOF'
{
  "active": true,
  "step": "background",
  "passed": ["evidence"],
  "concepts": [],
  "bank": [],
  "awaiting_answer": false,
  "last_failure": null
}
EOF
    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true
    local ctx
    ctx=$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null || echo "")
    assert_output_contains "$ctx" "EXPLAIN-DIFF RESTORED" "active non-pristine explain-diff state must restore" || return 1
    echo "$ctx" | grep -qF 'cat "$OMT_DIR/explain-diff-state-$OMT_SESSION_ID.json"' || return 1
    echo "$ctx" | grep -qiE 'now, before any other action|run .*now'
}

test_session_start_explain_diff_pristine_active_not_restored() {
    local sid="explain-diff-restore-pristine"
    cat > "$TEST_OMT_DIR/explain-diff-state-${sid}.json" << 'EOF'
{"active": true, "step": "evidence", "passed": [], "concepts": [], "bank": [], "awaiting_answer": false, "last_failure": null}
EOF
    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true
    assert_output_not_contains "$output" "EXPLAIN-DIFF RESTORED" "pristine explain-diff state must not restore"
}

test_session_start_explain_diff_pristine_ignores_bank_and_last_failure() {
    local sid="explain-diff-restore-pristine-fields"
    cat > "$TEST_OMT_DIR/explain-diff-state-${sid}.json" << 'EOF'
{
  "active": true,
  "step": "evidence",
  "passed": [],
  "structural_ok": [],
  "concepts": [],
  "bank": [{"id": "seed-note"}],
  "awaiting_answer": false,
  "last_failure": {"step": "evidence", "items": ["seed failure"]}
}
EOF
    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true
    assert_output_not_contains "$output" "EXPLAIN-DIFF RESTORED" "bank and last_failure do not make an evidence seed non-pristine"
}

test_session_start_explain_diff_no_progress_count_is_non_pristine() {
    local sid count output
    for count in 1 2; do
        sid="explain-diff-restore-no-progress-${count}"
        cat > "$TEST_OMT_DIR/explain-diff-state-${sid}.json" << EOF
{
  "active": true,
  "step": "evidence",
  "passed": [],
  "structural_ok": [],
  "concepts": [],
  "bank": [],
  "awaiting_answer": false,
  "last_failure": null,
  "no_progress": {"key": "evidence", "count": ${count}, "doc_digest": ""}
}
EOF
        output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true
        assert_output_contains "$output" "EXPLAIN-DIFF RESTORED" "no_progress.count=${count} must make explain-diff state non-pristine" || return 1
    done
}

test_session_start_explain_diff_inactive_or_absent_not_restored() {
    local inactive_sid="explain-diff-restore-inactive"
    printf '%s\n' '{"active": false, "step": "background", "passed": ["evidence"]}' > "$TEST_OMT_DIR/explain-diff-state-${inactive_sid}.json"
    local output
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$inactive_sid"'"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true
    assert_output_not_contains "$output" "EXPLAIN-DIFF RESTORED" "inactive explain-diff state must not restore" || return 1
    local absent_sid="explain-diff-restore-absent"
    output=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$absent_sid"'"}' | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true
    assert_output_not_contains "$output" "EXPLAIN-DIFF RESTORED" "absent explain-diff state must not restore"
}

# grep-0 (TODO 8): session-start.sh must contain zero handoff references — the
# handoff reader block, the two orphan-GC arms, and the HANDOFF variable are
# all removed; ledger recovery option D (above) supersedes them.
test_session_start_no_handoff_remnants() {
    if grep -qiE 'handoff' "$SCRIPT_DIR/session-start.sh" 2>/dev/null; then
        echo "ASSERTION FAILED: session-start.sh must have 0 handoff references (TODO 8 removal; superseded by ledger recovery option D)"
        grep -niE 'handoff' "$SCRIPT_DIR/session-start.sh" | head -10
        return 1
    fi
    return 0
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
    run_test test_regression_ambient_claude_env_file_not_leaked_by_unscrubbed_call

    # Project root detection - session-start (from hooks/test/project_root_test.sh)
    run_test test_get_project_root_function_exists_in_session_start
    run_test test_session_start_uses_project_root_variable

    # Prometheus restore: resume_summary surfaced when plan file unavailable
    run_test test_session_start_prometheus_omits_resume_summary_and_emits_pointer_when_plan_unavailable

    # Prometheus restore: backslashes in resume_summary produce valid JSON and are preserved
    run_test test_session_start_prometheus_resume_summary_backslash_produces_valid_json

    # Legacy goal-state retirement
    run_test test_session_start_retires_legacy_goal_states_without_restore
    run_test test_session_start_preserves_legacy_goal_archive_collisions
    run_test test_session_start_legacy_goal_archive_collision_limit_preserves_source
    run_test test_session_start_legacy_goal_archive_creation_failure_preserves_source
    run_test test_session_start_retires_goal_and_restores_ultragoal

    # Legacy stale-state GC remains covered for other sessions.
    run_test test_session_start_stale_goal_state_purged

    # Ultragoal state restore — JSON-shape and pristine-seed coverage
    run_test test_session_start_ultragoal_state_restore_non_pristine
    run_test test_session_start_pristine_ultragoal_state_not_restored

    # deep-interview stale-cleanup: glob + mtime fallback
    run_test test_session_start_stale_deep_interview_with_started_at_purged
    run_test test_session_start_stale_deep_interview_no_started_at_purged_via_mtime
    run_test test_session_start_fresh_deep_interview_marker_survives

    # explain-diff restore — active progressed state only
    run_test test_session_start_explain_diff_active_non_pristine_emits_restore
    run_test test_session_start_explain_diff_pristine_active_not_restored
    run_test test_session_start_explain_diff_pristine_ignores_bank_and_last_failure
    run_test test_session_start_explain_diff_no_progress_count_is_non_pristine
    run_test test_session_start_explain_diff_inactive_or_absent_not_restored

    # GC liveness unification (TODO 7)
    run_test test_gc_current_session_active_7h_idle_survives
    run_test test_gc_other_session_active_fresh_heartbeat_survives
    run_test test_gc_other_session_active_7h_idle_reaped
    run_test test_gc_terminal_state_1h_old_reaped
    run_test test_gc_terminal_state_10m_old_kept
    run_test test_gc_terminal_goal_fresh_heartbeat_survives_no_carveout
    run_test test_gc_other_session_ultragoal_7h_idle_reaped
    run_test test_gc_current_session_ultragoal_active_7h_idle_survives
    run_test test_gc_old_threshold_constants_removed

    # Retired-loop removal (TODO 10)
    run_test test_session_start_orphan_accept_unmanaged_state
    run_test test_session_start_no_retired_loop_restore

    # Encoding invariants (retained across the TODO 8 handoff removal)
    run_test test_session_start_encoder_invariants_in_source

    # Cache-safe restore — TODO 3 (AC2a–AC6)
    run_test test_cache_safe_prom_sentinel_not_in_stdout
    run_test test_cache_safe_prom_pointer_and_imperative
    run_test test_cache_safe_prom_round_trip
    run_test test_cache_safe_incomplete_count_existence_only
    run_test test_cache_safe_prom_session_invariant

    # Ledger recording instruction (TODO 3)
    run_test test_session_start_ledger_recording_every_source
    run_test test_session_start_ledger_recording_verbatim_mandate
    run_test test_session_start_ledger_recording_is_static
    run_test test_session_start_ledger_recording_rooted_path

    # Ledger recovery option D (TODO 4, D1)
    run_test test_session_start_ledger_recovery_inlines_now_and_corrections
    run_test test_session_start_ledger_recovery_no_ledger_harmless
    run_test test_session_start_ledger_recovery_acute_over_cap_pointer_fallback
    run_test test_session_start_ledger_recovery_only_on_compact_source
    run_test test_session_start_ledger_recovery_preserves_hash_line_in_acute
    run_test test_session_start_ledger_recovery_no_header_injection_from_bulk
    run_test test_session_start_ledger_recovery_unescapes_header_collision_content
    run_test test_session_start_ledger_recovery_double_escape_round_trip

    # Ledger GC — mtime-based (TODO 5)
    run_test test_gc_ledger_other_session_stale_reaped
    run_test test_gc_ledger_current_session_stale_survives
    run_test test_gc_ledger_other_session_fresh_survives
    run_test test_gc_ledger_namespace_separation_untouched

    # SessionStart session-artifact GC + drift report (plan TODO 3)
    run_test test_gc_session_artifacts_reaped_and_drift_reported
    run_test test_gc_session_artifacts_survive_without_jq

    # Regression: identity-unresolved (jq absent) must fail open on the
    # session-artifact reap lane
    run_test test_gc_session_artifact_survives_when_identity_unresolved_without_jq
    run_test test_gc_session_artifact_survives_current_reaps_other_with_jq
    run_test test_session_start_reap_session_artifacts_wires_real_session_id

    # SessionStart hook process exit code
    run_test test_session_start_hook_exits_zero_on_normal_gc_pass
    run_test test_session_start_hook_exits_zero_when_reaper_rm_fails

    # deep-interview restore block (TODO 6)
    run_test test_session_start_deep_interview_active_emits_reread_instruction
    run_test test_session_start_deep_interview_no_blank_phase_line
    run_test test_session_start_deep_interview_restore_independent_of_state_prefixes

    # Dead handoff plumbing removed (TODO 8)
    run_test test_session_start_no_handoff_remnants

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
}

main "$@"

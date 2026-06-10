#!/bin/bash
# =============================================================================
# Pre-Tool Enforcer Hook Tests
# Covers: TaskOutput block (existing) + prometheus state seeding (new)
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Test utilities
TESTS_PASSED=0
TESTS_FAILED=0

setup_test_env() {
    TEST_TMP_DIR=$(mktemp -d)
    export OMT_DIR="$TEST_TMP_DIR/.omt"
    mkdir -p "$OMT_DIR"
    export OMT_SESSION_ID="test-sid"
}

teardown_test_env() {
    unset OMT_DIR || true
    unset OMT_SESSION_ID || true
    if [[ -d "$TEST_TMP_DIR" ]]; then
        rm -rf "$TEST_TMP_DIR"
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
# Existing behavior: TaskOutput blocking
# =============================================================================

test_taskoutput_is_blocked() {
    local output
    output=$(printf '%s' '{"tool_name":"TaskOutput","tool_input":{}}' \
        | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")

    if echo "$output" | grep -q '"continue"[[:space:]]*:[[:space:]]*false'; then
        return 0
    else
        echo "ASSERTION FAILED: TaskOutput should be blocked"
        echo "  Output: $output"
        return 1
    fi
}

test_other_tools_allowed() {
    local output
    output=$(printf '%s' '{"tool_name":"Read","tool_input":{}}' \
        | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")

    if echo "$output" | grep -q '"continue"[[:space:]]*:[[:space:]]*true'; then
        return 0
    else
        echo "ASSERTION FAILED: Read tool should be allowed"
        echo "  Output: $output"
        return 1
    fi
}

# =============================================================================
# AC1 — Seed creates state file with correct fields
# =============================================================================

test_ac1_seed_creates_state_file() {
    local state_file="$OMT_DIR/prometheus-state-test-sid.json"

    printf '%s' '{"tool_name":"Skill","tool_input":{"skill":"prometheus"}}' \
        | bash "$SCRIPT_DIR/pre-tool-enforcer.sh" > /dev/null

    assert_file_exists "$state_file" "State file should be created for prometheus skill" || return 1

    # Verify required fields via jq
    jq -e '.active == true' "$state_file" > /dev/null 2>&1 \
        || { echo "ASSERTION FAILED: .active should be true"; return 1; }

    jq -e '.phase == "S0"' "$state_file" > /dev/null 2>&1 \
        || { echo "ASSERTION FAILED: .phase should be S0"; return 1; }

    local started_at
    started_at=$(jq -r '.started_at' "$state_file")
    [[ -n "$started_at" ]] \
        || { echo "ASSERTION FAILED: .started_at should be non-empty"; return 1; }

    jq -e '.plan_path == ""' "$state_file" > /dev/null 2>&1 \
        || { echo "ASSERTION FAILED: .plan_path should be empty string"; return 1; }

    jq -e '.resume_summary == ""' "$state_file" > /dev/null 2>&1 \
        || { echo "ASSERTION FAILED: .resume_summary should be empty string"; return 1; }
}

# =============================================================================
# AC2 — Create-if-absent (idempotent): re-fire must NOT overwrite
# =============================================================================

test_ac2_idempotent_seed_does_not_overwrite() {
    local state_file="$OMT_DIR/prometheus-state-test-sid.json"

    # First seed
    printf '%s' '{"tool_name":"Skill","tool_input":{"skill":"prometheus"}}' \
        | bash "$SCRIPT_DIR/pre-tool-enforcer.sh" > /dev/null

    assert_file_exists "$state_file" "State file should exist after first seed" || return 1

    local started_at_before
    started_at_before=$(jq -r '.started_at' "$state_file")

    # Simulate model advancing phase via TS CLI
    bun "$SCRIPT_DIR/../skills/prometheus/scripts/prometheus-state.ts" set --phase S3 > /dev/null 2>&1 \
        || { echo "ASSERTION FAILED: bun CLI set phase failed"; return 1; }

    jq -e '.phase == "S3"' "$state_file" > /dev/null 2>&1 \
        || { echo "ASSERTION FAILED: Phase should be S3 after CLI set"; return 1; }

    # Re-fire seed — must NOT reset
    printf '%s' '{"tool_name":"Skill","tool_input":{"skill":"prometheus"}}' \
        | bash "$SCRIPT_DIR/pre-tool-enforcer.sh" > /dev/null

    jq -e '.phase == "S3"' "$state_file" > /dev/null 2>&1 \
        || { echo "ASSERTION FAILED: Re-fire should not reset phase to S0"; return 1; }

    local started_at_after
    started_at_after=$(jq -r '.started_at' "$state_file")
    [[ "$started_at_before" == "$started_at_after" ]] \
        || { echo "ASSERTION FAILED: started_at should be unchanged after re-fire (before=$started_at_before, after=$started_at_after)"; return 1; }
}

# =============================================================================
# AC3 — Non-prometheus Skill does not seed
# =============================================================================

test_ac3_non_prometheus_skill_does_not_seed() {
    local state_file="$OMT_DIR/prometheus-state-test-sid.json"

    printf '%s' '{"tool_name":"Skill","tool_input":{"skill":"sisyphus"}}' \
        | bash "$SCRIPT_DIR/pre-tool-enforcer.sh" > /dev/null

    assert_file_not_exists "$state_file" "State file should NOT be created for non-prometheus skill" || return 1
}

# =============================================================================
# AC4 — CWD-independent: seeded path is OMT_DIR-derived, not CWD-relative
# =============================================================================

test_ac4_cwd_independent_seeding() {
    local state_file="$OMT_DIR/prometheus-state-test-sid.json"

    # Run hook from /tmp (unrelated CWD)
    (
        cd /tmp
        printf '%s' '{"tool_name":"Skill","tool_input":{"skill":"prometheus"}}' \
            | bash "$SCRIPT_DIR/pre-tool-enforcer.sh" > /dev/null
    )

    assert_file_exists "$state_file" "State file should land under OMT_DIR regardless of CWD" || return 1
}

# =============================================================================
# AC8 — Fail-open: missing OMT_DIR must not block/deny
# =============================================================================

test_ac8_fail_open_missing_omt_dir() {
    local exit_code=0
    local output
    # Capture the test OMT_DIR before we unset it inside the subshell
    local saved_omt_dir="$OMT_DIR"

    # unset OMT_DIR inside the $() subshell so the hook on the pipe RHS also
    # sees OMT_DIR unset.  env -u on the printf (LHS) would NOT affect the hook.
    output=$(
        unset OMT_DIR
        printf '%s' '{"tool_name":"Skill","tool_input":{"skill":"prometheus"}}' \
            | bash "$SCRIPT_DIR/pre-tool-enforcer.sh"
    ) || exit_code=$?

    [[ "$exit_code" -eq 0 ]] \
        || { echo "ASSERTION FAILED: Hook should exit 0 when OMT_DIR unset (exit=$exit_code)"; return 1; }

    assert_output_not_contains "$output" '"continue"[[:space:]]*:[[:space:]]*false' \
        "Hook should NOT emit deny payload when OMT_DIR unset" || return 1

    # Distinguishing assertion: with OMT_DIR unset the hook must NOT create a
    # state file.  This would catch any fail-closed regression.
    local state_file="$saved_omt_dir/prometheus-state-${OMT_SESSION_ID}.json"
    assert_file_not_exists "$state_file" \
        "Hook must NOT create state file when OMT_DIR is unset (fail-open)" || return 1
}

# =============================================================================
# AC9 — started_at parseable by stale-cleanup (3h backstop)
# =============================================================================

test_ac9_started_at_parseable_by_stale_cleanup() {
    local state_file="$OMT_DIR/prometheus-state-test-sid.json"

    # Seed the state file
    printf '%s' '{"tool_name":"Skill","tool_input":{"skill":"prometheus"}}' \
        | bash "$SCRIPT_DIR/pre-tool-enforcer.sh" > /dev/null

    assert_file_exists "$state_file" "State file should exist after seed" || return 1

    # Backdate started_at to 4 hours ago (well past 3h threshold) by rewriting the file
    local old_timestamp
    old_timestamp=$(date -v-4H -Iseconds 2>/dev/null || date -d "4 hours ago" +"%Y-%m-%dT%H:%M:%S" 2>/dev/null || date +"%Y-%m-%dT%H:%M:%S" -d "-4 hours")
    # Use jq to write a modified state file with old timestamp
    local tmp_file
    tmp_file=$(mktemp)
    jq --arg ts "$old_timestamp" '.started_at = $ts' "$state_file" > "$tmp_file" && mv "$tmp_file" "$state_file"

    # Invoke the REAL session-start hook so the production stale-cleanup path is
    # exercised (not an inline copy that could diverge).  OMT_DIR is already
    # exported by setup_test_env; compute_omt_dir short-circuits on a preset
    # OMT_DIR, so session-start runs against the test directory.
    printf '{}' | bash "$SCRIPT_DIR/session-start.sh" > /dev/null 2>&1

    assert_file_not_exists "$state_file" \
        "Stale-cleanup should delete state file with started_at >3h old" || return 1
}

# =============================================================================
# AC10 — Seed + CLI set-phase compose correctly
# =============================================================================

test_ac10_seed_and_cli_set_phase_compose() {
    local state_file="$OMT_DIR/prometheus-state-test-sid.json"

    # Seed
    printf '%s' '{"tool_name":"Skill","tool_input":{"skill":"prometheus"}}' \
        | bash "$SCRIPT_DIR/pre-tool-enforcer.sh" > /dev/null

    assert_file_exists "$state_file" "State file should exist after seed" || return 1

    # Advance phase via CLI
    bun "$SCRIPT_DIR/../skills/prometheus/scripts/prometheus-state.ts" set --phase S3 > /dev/null 2>&1 \
        || { echo "ASSERTION FAILED: bun CLI set --phase failed"; return 1; }

    jq -e '.active == true' "$state_file" > /dev/null 2>&1 \
        || { echo "ASSERTION FAILED: .active should remain true after CLI set"; return 1; }

    jq -e '.phase == "S3"' "$state_file" > /dev/null 2>&1 \
        || { echo "ASSERTION FAILED: .phase should be S3 after CLI set"; return 1; }
}

# =============================================================================
# P1 — prometheus seed carries last_touched_at, date round-trips
# =============================================================================

test_p1_prometheus_seed_has_last_touched_at() {
    local state_file="$OMT_DIR/prometheus-state-test-sid.json"

    printf '%s' '{"tool_name":"Skill","tool_input":{"skill":"prometheus"}}' \
        | bash "$SCRIPT_DIR/pre-tool-enforcer.sh" > /dev/null

    assert_file_exists "$state_file" "Prometheus state file should exist" || return 1

    jq -e '.last_touched_at | length > 0' "$state_file" > /dev/null 2>&1 \
        || { echo "ASSERTION FAILED: .last_touched_at should be non-empty"; return 1; }

    local lta
    lta=$(jq -r '.last_touched_at' "$state_file")
    if ! echo "$lta" | grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}'; then
        echo "ASSERTION FAILED: last_touched_at '$lta' does not match ISO 8601 shape"
        return 1
    fi

    local time_part epoch
    time_part=$(echo "$lta" | sed -E 's/(Z|[+-][0-9]{2}:[0-9]{2})$//')
    epoch=$(date -j -f "%Y-%m-%dT%H:%M:%S" "$time_part" "+%s" 2>/dev/null \
        || date -d "$time_part" "+%s" 2>/dev/null)
    [[ -n "$epoch" ]] \
        || { echo "ASSERTION FAILED: last_touched_at '$lta' did not round-trip through parser"; return 1; }
}

# =============================================================================
# A2 — Skill(deep-interview) seeds env-sid marker with active/started_at/last_touched_at
# =============================================================================

test_a2_deep_interview_seed_creates_marker() {
    local state_file="$OMT_DIR/deep-interview-active-state-test-sid.json"

    printf '%s' '{"tool_name":"Skill","tool_input":{"skill":"deep-interview"}}' \
        | bash "$SCRIPT_DIR/pre-tool-enforcer.sh" > /dev/null

    assert_file_exists "$state_file" "deep-interview state file should be created" || return 1

    jq -e '.active == true' "$state_file" > /dev/null 2>&1 \
        || { echo "ASSERTION FAILED: .active should be true"; return 1; }

    jq -e '.started_at | length > 0' "$state_file" > /dev/null 2>&1 \
        || { echo "ASSERTION FAILED: .started_at should be non-empty"; return 1; }

    jq -e '.last_touched_at | length > 0' "$state_file" > /dev/null 2>&1 \
        || { echo "ASSERTION FAILED: .last_touched_at should be non-empty"; return 1; }
}

# =============================================================================
# seed-DI-shape — deep-interview seed has no sessionId field
# =============================================================================

test_seed_di_no_session_id_field() {
    local state_file="$OMT_DIR/deep-interview-active-state-test-sid.json"

    printf '%s' '{"tool_name":"Skill","tool_input":{"skill":"deep-interview"}}' \
        | bash "$SCRIPT_DIR/pre-tool-enforcer.sh" > /dev/null

    assert_file_exists "$state_file" "deep-interview state file should exist" || return 1

    jq -e 'has("sessionId") | not' "$state_file" > /dev/null 2>&1 \
        || { echo "ASSERTION FAILED: seed must not write a sessionId field"; return 1; }
}

# =============================================================================
# seed-goal — Skill(goal) seeds the pristine goal skeleton
# =============================================================================

test_seed_goal_creates_skeleton() {
    local state_file="$OMT_DIR/goal-state-test-sid.json"

    printf '%s' '{"tool_name":"Skill","tool_input":{"skill":"goal"}}' \
        | bash "$SCRIPT_DIR/pre-tool-enforcer.sh" > /dev/null

    assert_file_exists "$state_file" "goal state file should be created" || return 1

    jq -e '.phase == "planning" and .iteration == 0 and .outcome == "" and .active == true
        and (.started_at | length > 0) and (.last_touched_at | length > 0)' \
        "$state_file" > /dev/null 2>&1 \
        || { echo "ASSERTION FAILED: goal seed does not match pristine skeleton"; return 1; }
}

# =============================================================================
# seed-goal-idem — second goal seed run leaves the existing file unchanged
# =============================================================================

test_seed_goal_is_idempotent() {
    local state_file="$OMT_DIR/goal-state-test-sid.json"

    # First seed
    printf '%s' '{"tool_name":"Skill","tool_input":{"skill":"goal"}}' \
        | bash "$SCRIPT_DIR/pre-tool-enforcer.sh" > /dev/null

    assert_file_exists "$state_file" "goal state file should exist after first seed" || return 1

    # Mutate iteration to 3
    local tmp
    tmp=$(mktemp)
    jq '.iteration = 3' "$state_file" > "$tmp" && mv "$tmp" "$state_file"

    jq -e '.iteration == 3' "$state_file" > /dev/null 2>&1 \
        || { echo "ASSERTION FAILED: mutation of iteration to 3 failed"; return 1; }

    # Re-fire seed
    printf '%s' '{"tool_name":"Skill","tool_input":{"skill":"goal"}}' \
        | bash "$SCRIPT_DIR/pre-tool-enforcer.sh" > /dev/null

    jq -e '.iteration == 3' "$state_file" > /dev/null 2>&1 \
        || { echo "ASSERTION FAILED: re-fire seed must not reset iteration (create-if-absent only)"; return 1; }
}

# =============================================================================
# B1 — absent id → no default file, stderr warn, exit 0
# =============================================================================

test_b1_absent_session_id_skips_and_warns() {
    local exit_code=0
    local stderr_out

    stderr_out=$(
        unset OMT_SESSION_ID
        printf '%s' '{"tool_name":"Skill","tool_input":{"skill":"goal"}}' \
            | bash "$SCRIPT_DIR/pre-tool-enforcer.sh" 2>&1 >/dev/null
    ) || exit_code=$?

    [[ "$exit_code" -eq 0 ]] \
        || { echo "ASSERTION FAILED: Hook should exit 0 on absent id (exit=$exit_code)"; return 1; }

    # No *-state-*.json files created with empty or "default" id
    local found
    found=$(ls "$OMT_DIR"/*-state-*.json 2>/dev/null | wc -l | tr -d ' ')
    [[ "$found" -eq 0 ]] \
        || { echo "ASSERTION FAILED: No state files should be created when OMT_SESSION_ID is absent (found=$found)"; return 1; }

    echo "$stderr_out" | grep -qi "warn\|skip\|session" \
        || { echo "ASSERTION FAILED: stderr should contain a warning about missing session id. Got: '$stderr_out'"; return 1; }
}

# =============================================================================
# B3 — unsafe id → skip+warn+exit0, no file outside the state dir
# =============================================================================

test_b3_unsafe_session_id_skips_and_warns() {
    local exit_code=0
    local stderr_out

    stderr_out=$(
        export OMT_SESSION_ID="../escape"
        printf '%s' '{"tool_name":"Skill","tool_input":{"skill":"goal"}}' \
            | bash "$SCRIPT_DIR/pre-tool-enforcer.sh" 2>&1 >/dev/null
    ) || exit_code=$?

    [[ "$exit_code" -eq 0 ]] \
        || { echo "ASSERTION FAILED: Hook should exit 0 on unsafe id (exit=$exit_code)"; return 1; }

    # No file created anywhere with "../escape" in the name or outside OMT_DIR
    local found
    found=$(find "$OMT_DIR" -maxdepth 1 -name "*-state-*" 2>/dev/null | wc -l | tr -d ' ')
    [[ "$found" -eq 0 ]] \
        || { echo "ASSERTION FAILED: No state files should be created for unsafe id (found=$found)"; return 1; }

    echo "$stderr_out" | grep -qi "warn\|skip\|unsafe\|invalid" \
        || { echo "ASSERTION FAILED: stderr should contain a warning about unsafe id. Got: '$stderr_out'"; return 1; }
}

# =============================================================================
# fail-loud — a forced seed-write failure prints a stderr warning, exit 0
# =============================================================================

test_fail_loud_write_failure_warns_not_silent() {
    local exit_code=0
    local stderr_out

    # Make OMT_DIR read-only so the write attempt fails
    chmod -w "$OMT_DIR"

    stderr_out=$(
        printf '%s' '{"tool_name":"Skill","tool_input":{"skill":"goal"}}' \
            | bash "$SCRIPT_DIR/pre-tool-enforcer.sh" 2>&1 >/dev/null
    ) || exit_code=$?

    # Restore perms
    chmod +w "$OMT_DIR"

    [[ "$exit_code" -eq 0 ]] \
        || { echo "ASSERTION FAILED: Hook should exit 0 even on write failure (exit=$exit_code)"; return 1; }

    echo "$stderr_out" | grep -qi "warn\|fail\|error\|seed" \
        || { echo "ASSERTION FAILED: stderr should contain a seed-failure warning. Got: '$stderr_out'"; return 1; }
}

# =============================================================================
# Main
# =============================================================================

main() {
    echo "=========================================="
    echo "Pre-Tool Enforcer Tests"
    echo "=========================================="

    # Existing behavior
    run_test test_taskoutput_is_blocked
    run_test test_other_tools_allowed

    # Prometheus state seeding
    run_test test_ac1_seed_creates_state_file
    run_test test_ac2_idempotent_seed_does_not_overwrite
    run_test test_ac3_non_prometheus_skill_does_not_seed
    run_test test_ac4_cwd_independent_seeding
    run_test test_ac8_fail_open_missing_omt_dir
    run_test test_ac9_started_at_parseable_by_stale_cleanup
    run_test test_ac10_seed_and_cli_set_phase_compose

    # New seeds: P1 (prometheus last_touched_at), A2 (deep-interview), seed-goal, seed-goal-idem,
    # seed-DI-shape, B1 (absent id), B3 (unsafe id), fail-loud
    run_test test_p1_prometheus_seed_has_last_touched_at
    run_test test_a2_deep_interview_seed_creates_marker
    run_test test_seed_di_no_session_id_field
    run_test test_seed_goal_creates_skeleton
    run_test test_seed_goal_is_idempotent
    run_test test_b1_absent_session_id_skips_and_warns
    run_test test_b3_unsafe_session_id_skips_and_warns
    run_test test_fail_loud_write_failure_warns_not_silent

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
}

main "$@"

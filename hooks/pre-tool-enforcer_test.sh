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
# AC8 — [CONTRACT-INVERTED] OMT_DIR absent: derive from stdin cwd or fail loudly
#
# New contract: with OMT_DIR absent from env but a full stdin payload
# (session_id + cwd pointing to a real project), the hook DERIVES OMT_DIR via
# resolve_omt_dir and creates the seed file there.  The old "fail-open silent
# skip" is eliminated.
# =============================================================================

test_ac8_fail_open_missing_omt_dir() {
    local exit_code=0
    local stderr_out

    # Use gamy-shake itself as the project cwd — has .git and CLAUDE.md so
    # resolve_omt_dir will walk up to the project root and compute OMT_DIR.
    local project_cwd
    project_cwd="$SCRIPT_DIR"

    # Sandbox HOME inside TEST_TMP_DIR so no real $HOME is touched
    local fake_home="$TEST_TMP_DIR/home"
    mkdir -p "$fake_home"

    # Compute what OMT_DIR resolve_omt_dir will produce for this cwd, using the same fake HOME
    local expected_omt_dir
    expected_omt_dir=$(
        unset OMT_DIR
        export HOME="$fake_home"
        source "$SCRIPT_DIR/lib/omt-dir.sh" && resolve_omt_dir "$project_cwd"
    )

    local expected_file="$expected_omt_dir/prometheus-state-${OMT_SESSION_ID}.json"

    stderr_out=$(
        unset OMT_DIR
        export HOME="$fake_home"
        printf '%s' "{\"tool_name\":\"Skill\",\"tool_input\":{\"skill\":\"prometheus\"},\"session_id\":\"${OMT_SESSION_ID}\",\"cwd\":\"$project_cwd\"}" \
            | bash "$SCRIPT_DIR/pre-tool-enforcer.sh" 2>&1 >/dev/null
    ) || exit_code=$?

    [[ "$exit_code" -eq 0 ]] \
        || { echo "ASSERTION FAILED: Hook should exit 0 when OMT_DIR unset (exit=$exit_code)"; return 1; }

    # New contract: file must be created at the derived path (under sandboxed HOME)
    assert_file_exists "$expected_file" \
        "Hook must create state file at resolve_omt_dir-derived path when env OMT_DIR absent but stdin cwd present" || return 1
}

# =============================================================================
# AC9 — started_at parseable by stale-cleanup (ACTIVE_IDLE_TTL=6h fallback)
# Updated to reflect new GC semantics: liveness uses last_touched_at -> started_at -> mtime.
# A state with no last_touched_at falls back to started_at; age must exceed 6h to be reaped.
# =============================================================================

test_ac9_started_at_parseable_by_stale_cleanup() {
    local state_file="$OMT_DIR/prometheus-state-test-sid.json"

    # Seed the state file
    printf '%s' '{"tool_name":"Skill","tool_input":{"skill":"prometheus"}}' \
        | bash "$SCRIPT_DIR/pre-tool-enforcer.sh" > /dev/null

    assert_file_exists "$state_file" "State file should exist after seed" || return 1

    # Backdate started_at to 7 hours ago (well past ACTIVE_IDLE_TTL=6h) by rewriting the file.
    # Remove last_touched_at so the GC falls back to started_at for age computation.
    local old_timestamp
    old_timestamp=$(date -v-7H -Iseconds 2>/dev/null || date -d "7 hours ago" +"%Y-%m-%dT%H:%M:%S" 2>/dev/null || date +"%Y-%m-%dT%H:%M:%S" -d "-7 hours")
    local tmp_file
    tmp_file=$(mktemp)
    jq --arg ts "$old_timestamp" '.started_at = $ts | del(.last_touched_at)' "$state_file" > "$tmp_file" && mv "$tmp_file" "$state_file"

    # Invoke the REAL session-start hook so the production stale-cleanup path is
    # exercised (not an inline copy that could diverge).  OMT_DIR is already
    # exported by setup_test_env; compute_omt_dir short-circuits on a preset
    # OMT_DIR, so session-start runs against the test directory.
    printf '{}' | bash "$SCRIPT_DIR/session-start.sh" > /dev/null 2>&1

    assert_file_not_exists "$state_file" \
        "Stale-cleanup should delete state file with started_at >6h old (ACTIVE_IDLE_TTL)" || return 1
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
# seed-ultragoal — Skill(ultragoal) seeds the pristine ultragoal skeleton
# (mirrors seed-goal; ultragoal-state.ts is a structural copy of goal-state.ts
# with its own prefix, so the seed skeleton content is identical to goal's)
# =============================================================================

test_seed_ultragoal_creates_skeleton() {
    local state_file="$OMT_DIR/ultragoal-state-test-sid.json"

    printf '%s' '{"tool_name":"Skill","tool_input":{"skill":"ultragoal"}}' \
        | bash "$SCRIPT_DIR/pre-tool-enforcer.sh" > /dev/null

    assert_file_exists "$state_file" "ultragoal state file should be created" || return 1

    jq -e '.phase == "planning" and .iteration == 0 and .outcome == "" and .active == true
        and (.started_at | length > 0) and (.last_touched_at | length > 0)' \
        "$state_file" > /dev/null 2>&1 \
        || { echo "ASSERTION FAILED: ultragoal seed does not match pristine skeleton"; return 1; }
}

# =============================================================================
# seed-ultragoal-idem — second ultragoal seed run leaves the existing file unchanged
# =============================================================================

test_seed_ultragoal_is_idempotent() {
    local state_file="$OMT_DIR/ultragoal-state-test-sid.json"

    # First seed
    printf '%s' '{"tool_name":"Skill","tool_input":{"skill":"ultragoal"}}' \
        | bash "$SCRIPT_DIR/pre-tool-enforcer.sh" > /dev/null

    assert_file_exists "$state_file" "ultragoal state file should exist after first seed" || return 1

    # Mutate iteration to 3
    local tmp
    tmp=$(mktemp)
    jq '.iteration = 3' "$state_file" > "$tmp" && mv "$tmp" "$state_file"

    jq -e '.iteration == 3' "$state_file" > /dev/null 2>&1 \
        || { echo "ASSERTION FAILED: mutation of iteration to 3 failed"; return 1; }

    # Re-fire seed
    printf '%s' '{"tool_name":"Skill","tool_input":{"skill":"ultragoal"}}' \
        | bash "$SCRIPT_DIR/pre-tool-enforcer.sh" > /dev/null

    jq -e '.iteration == 3' "$state_file" > /dev/null 2>&1 \
        || { echo "ASSERTION FAILED: re-fire seed must not reset iteration (create-if-absent only)"; return 1; }
}

# =============================================================================
# seed-ultragoal-separate-prefix — Skill(ultragoal) seeds ultragoal-state-*,
# never goal-state-* (separate prefix; goal's own seeding is untouched)
# =============================================================================

test_seed_ultragoal_does_not_seed_goal_state() {
    local ultragoal_file="$OMT_DIR/ultragoal-state-test-sid.json"
    local goal_file="$OMT_DIR/goal-state-test-sid.json"

    printf '%s' '{"tool_name":"Skill","tool_input":{"skill":"ultragoal"}}' \
        | bash "$SCRIPT_DIR/pre-tool-enforcer.sh" > /dev/null

    assert_file_exists "$ultragoal_file" "ultragoal state file should be created" || return 1
    assert_file_not_exists "$goal_file" "goal state file should NOT be created for ultragoal skill" || return 1
}

# =============================================================================
# B1 — [CONTRACT-INVERTED] session_id absent from env: derive from stdin or fail loudly
#
# New contract (two sub-cases):
#   B1a — OMT_SESSION_ID absent from env but stdin carries session_id: hook
#         DERIVES the id from stdin and seeds the file (no skip, no warning).
#   B1b — OMT_SESSION_ID absent from both env and stdin: loud failure —
#         stderr names "session"; no file created; exit 0.
# =============================================================================

test_b1_absent_session_id_skips_and_warns() {
    # --- B1a: stdin session_id present → seed created, no session-absent warning ---
    local exit_code_a=0
    local stderr_a
    local state_file_a="$OMT_DIR/goal-state-stdin-derived-sid.json"

    stderr_a=$(
        unset OMT_SESSION_ID
        printf '%s' "{\"tool_name\":\"Skill\",\"tool_input\":{\"skill\":\"goal\"},\"session_id\":\"stdin-derived-sid\",\"cwd\":\"$OMT_DIR\"}" \
            | bash "$SCRIPT_DIR/pre-tool-enforcer.sh" 2>&1 >/dev/null
    ) || exit_code_a=$?

    [[ "$exit_code_a" -eq 0 ]] \
        || { echo "ASSERTION FAILED B1a: Hook should exit 0 on stdin session_id (exit=$exit_code_a)"; return 1; }

    assert_file_exists "$state_file_a" \
        "B1a: State file should be created when OMT_SESSION_ID absent but stdin session_id present" || return 1

    # No "session absent" warning expected when stdin id filled in
    if echo "$stderr_a" | grep -qi "session_id absent\|session.*absent"; then
        echo "ASSERTION FAILED B1a: Should NOT warn about absent session when stdin provides it. Got: '$stderr_a'"
        return 1
    fi

    # --- B1b: stdin session_id also absent → loud failure naming session ---
    local exit_code_b=0
    local stderr_b

    stderr_b=$(
        unset OMT_SESSION_ID
        printf '%s' '{"tool_name":"Skill","tool_input":{"skill":"goal"}}' \
            | bash "$SCRIPT_DIR/pre-tool-enforcer.sh" 2>&1 >/dev/null
    ) || exit_code_b=$?

    [[ "$exit_code_b" -eq 0 ]] \
        || { echo "ASSERTION FAILED B1b: Hook should exit 0 when both env and stdin session_id absent (exit=$exit_code_b)"; return 1; }

    # No *-state-*.json files created for session-absent case
    local found
    found=$(ls "$OMT_DIR"/*-state-*b*.json 2>/dev/null | wc -l | tr -d ' ')
    # Only b1a's file should exist; b1b must not add more
    local total
    total=$(ls "$OMT_DIR"/*-state-*.json 2>/dev/null | wc -l | tr -d ' ')
    [[ "$total" -le 1 ]] \
        || { echo "ASSERTION FAILED B1b: No extra state files should be created when both session ids absent (found=$total)"; return 1; }

    echo "$stderr_b" | grep -qi "session" \
        || { echo "ASSERTION FAILED B1b: stderr should name 'session' when both absent. Got: '$stderr_b'"; return 1; }
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
# AC-8a — env-stripped + full stdin payload → seed created at derived path
# =============================================================================

test_ac8a_env_stripped_full_payload_seeds_derived_path() {
    local exit_code=0
    local stderr_out

    # Use gamy-shake as the project cwd so resolve_omt_dir finds a real project root
    local project_cwd="$SCRIPT_DIR"
    local stdin_sid="env-stripped-test-sid"

    # Sandbox HOME inside TEST_TMP_DIR so no real $HOME is touched
    local fake_home="$TEST_TMP_DIR/home"
    mkdir -p "$fake_home"

    # Derive expected OMT_DIR via resolve_omt_dir (in subshell, no env OMT_DIR, sandboxed HOME)
    local derived_omt_dir
    derived_omt_dir=$(
        unset OMT_DIR
        export HOME="$fake_home"
        source "$SCRIPT_DIR/lib/omt-dir.sh" && resolve_omt_dir "$project_cwd"
    )

    local expected_file="$derived_omt_dir/goal-state-${stdin_sid}.json"

    stderr_out=$(
        unset OMT_DIR OMT_SESSION_ID
        export HOME="$fake_home"
        printf '%s' "{\"tool_name\":\"Skill\",\"tool_input\":{\"skill\":\"goal\"},\"session_id\":\"$stdin_sid\",\"cwd\":\"$project_cwd\"}" \
            | bash "$SCRIPT_DIR/pre-tool-enforcer.sh" 2>&1 >/dev/null
    ) || exit_code=$?

    [[ "$exit_code" -eq 0 ]] \
        || { echo "ASSERTION FAILED AC-8a: Hook should exit 0 (exit=$exit_code)"; return 1; }

    assert_file_exists "$expected_file" \
        "AC-8a: Seed file must be created at resolve_omt_dir-derived path when env is stripped" || return 1
}

# =============================================================================
# AC-8b-i — missing session_id (env + stdin) → loud failure naming session
# =============================================================================

test_ac8b_i_missing_session_id_loud_failure() {
    local exit_code=0
    local stderr_out
    local project_cwd="$SCRIPT_DIR"

    # Sandbox HOME so resolve_omt_dir (called before sid validation when cwd is present)
    # never touches real $HOME
    local fake_home="$TEST_TMP_DIR/home_8b_i"
    mkdir -p "$fake_home"

    stderr_out=$(
        unset OMT_DIR OMT_SESSION_ID
        export HOME="$fake_home"
        printf '%s' "{\"tool_name\":\"Skill\",\"tool_input\":{\"skill\":\"goal\"},\"cwd\":\"$project_cwd\"}" \
            | bash "$SCRIPT_DIR/pre-tool-enforcer.sh" 2>&1 >/dev/null
    ) || exit_code=$?

    [[ "$exit_code" -eq 0 ]] \
        || { echo "ASSERTION FAILED AC-8b-i: Hook should exit 0 (exit=$exit_code)"; return 1; }

    # Loud: stderr must name 'session'
    echo "$stderr_out" | grep -qi "session" \
        || { echo "ASSERTION FAILED AC-8b-i: stderr should name 'session'. Got: '$stderr_out'"; return 1; }

    # No file created — scan fake_home where hook would actually write (via resolve_omt_dir → $HOME/.omt/...)
    local found
    found=$(find "$fake_home" -name '*-state-*.json' 2>/dev/null | wc -l | tr -d ' ')
    [[ "$found" -eq 0 ]] \
        || { echo "ASSERTION FAILED AC-8b-i: No state file should be created when session_id absent (found=$found)"; return 1; }
}

# =============================================================================
# AC-8b-ii — missing cwd (env OMT_DIR absent, stdin cwd absent) → loud failure
# =============================================================================

test_ac8b_ii_missing_cwd_loud_failure() {
    local exit_code=0
    local stderr_out
    local stdin_sid="cwd-missing-test-sid"

    # Sandbox HOME so the hook (even though it won't call resolve_omt_dir without cwd)
    # cannot reach real $HOME if behavior ever changes
    local fake_home="$TEST_TMP_DIR/home_8b_ii"
    mkdir -p "$fake_home"

    stderr_out=$(
        unset OMT_DIR
        export HOME="$fake_home"
        printf '%s' "{\"tool_name\":\"Skill\",\"tool_input\":{\"skill\":\"goal\"},\"session_id\":\"$stdin_sid\"}" \
            | bash "$SCRIPT_DIR/pre-tool-enforcer.sh" 2>&1 >/dev/null
    ) || exit_code=$?

    [[ "$exit_code" -eq 0 ]] \
        || { echo "ASSERTION FAILED AC-8b-ii: Hook should exit 0 (exit=$exit_code)"; return 1; }

    # Loud: stderr must name cwd or dir
    echo "$stderr_out" | grep -qiE "cwd|dir" \
        || { echo "ASSERTION FAILED AC-8b-ii: stderr should name cwd/dir. Got: '$stderr_out'"; return 1; }

    # No file created — scan fake_home which is the only $HOME the hook can reach
    local found
    found=$(find "$fake_home" -name '*-state-*.json' 2>/dev/null | wc -l | tr -d ' ')
    [[ "$found" -eq 0 ]] \
        || { echo "ASSERTION FAILED AC-8b-ii: No state file should be created when cwd absent (found=$found)"; return 1; }
}

# =============================================================================
# AC-8b-iii — cwd present but non-project (no .git / CLAUDE.md / package.json)
#             → omt-dir.sh falls back to $HOME/.omt/<basename>; hook exits 0,
#               stderr CONTAINS the "non-canonical" warning, seed IS created
# =============================================================================

test_ac8b_iii_nonproject_cwd_falls_back_with_warning() {
    local exit_code=0
    local stderr_out

    # Use a bare temp directory with no .git / CLAUDE.md / package.json up the tree.
    # Must be created BEFORE sandboxing HOME so the path is a real dir the hook can stat.
    local bare_cwd
    bare_cwd=$(mktemp -d)
    local stdin_sid="nonproject-cwd-sid"

    # Sandbox HOME inside TEST_TMP_DIR so no real $HOME is touched
    local fake_home="$TEST_TMP_DIR/home"
    mkdir -p "$fake_home"

    stderr_out=$(
        unset OMT_DIR OMT_SESSION_ID
        export HOME="$fake_home"
        printf '%s' "{\"tool_name\":\"Skill\",\"tool_input\":{\"skill\":\"goal\"},\"session_id\":\"$stdin_sid\",\"cwd\":\"$bare_cwd\"}" \
            | bash "$SCRIPT_DIR/pre-tool-enforcer.sh" 2>&1 >/dev/null
    ) || exit_code=$?

    rmdir "$bare_cwd" 2>/dev/null || true

    [[ "$exit_code" -eq 0 ]] \
        || { echo "ASSERTION FAILED AC-8b-iii: Hook should exit 0 for non-project cwd (exit=$exit_code)"; return 1; }

    # Loud: stderr must contain the "non-canonical" warning emitted by omt-dir.sh
    echo "$stderr_out" | grep -q "non-canonical" \
        || { echo "ASSERTION FAILED AC-8b-iii: stderr should contain 'non-canonical'. Got: '$stderr_out'"; return 1; }

    # Fallback contract: seed IS created at $HOME/.omt/<basename of bare_cwd>/goal-state-<sid>.json
    local bare_basename
    bare_basename=$(basename "$bare_cwd")
    local expected_file="$fake_home/.omt/${bare_basename}/goal-state-${stdin_sid}.json"
    assert_file_exists "$expected_file" \
        "AC-8b-iii: Seed file must be created at fallback path for non-project cwd" || return 1
}

# =============================================================================
# AC-8c — preservation: prometheus and deep-interview seed field sets unchanged
#          when env (OMT_DIR + OMT_SESSION_ID) is present
# =============================================================================

test_ac8c_prometheus_and_di_seed_field_preservation() {
    # --- prometheus ---
    local prom_file="$OMT_DIR/prometheus-state-test-sid.json"
    rm -f "$prom_file" 2>/dev/null || true

    printf '%s' '{"tool_name":"Skill","tool_input":{"skill":"prometheus"}}' \
        | bash "$SCRIPT_DIR/pre-tool-enforcer.sh" > /dev/null

    assert_file_exists "$prom_file" "AC-8c: prometheus state file should be created" || return 1

    # Assert all expected fields present with correct types/values
    jq -e '.active == true' "$prom_file" > /dev/null 2>&1 \
        || { echo "ASSERTION FAILED AC-8c prometheus: .active should be true"; return 1; }
    jq -e '.phase == "S0"' "$prom_file" > /dev/null 2>&1 \
        || { echo "ASSERTION FAILED AC-8c prometheus: .phase should be S0"; return 1; }
    jq -e '.plan_path == ""' "$prom_file" > /dev/null 2>&1 \
        || { echo "ASSERTION FAILED AC-8c prometheus: .plan_path should be empty string"; return 1; }
    jq -e '.resume_summary == ""' "$prom_file" > /dev/null 2>&1 \
        || { echo "ASSERTION FAILED AC-8c prometheus: .resume_summary should be empty string"; return 1; }
    jq -e '(.started_at | length) > 0' "$prom_file" > /dev/null 2>&1 \
        || { echo "ASSERTION FAILED AC-8c prometheus: .started_at should be non-empty"; return 1; }
    jq -e '(.last_touched_at | length) > 0' "$prom_file" > /dev/null 2>&1 \
        || { echo "ASSERTION FAILED AC-8c prometheus: .last_touched_at should be non-empty"; return 1; }

    # Ensure NO extra unexpected fields beyond the 6 defined
    local prom_keys
    prom_keys=$(jq -r 'keys[]' "$prom_file" | sort | tr '\n' ',' | sed 's/,$//')
    [[ "$prom_keys" == "active,last_touched_at,phase,plan_path,resume_summary,started_at" ]] \
        || { echo "ASSERTION FAILED AC-8c prometheus: unexpected keys '$prom_keys'"; return 1; }

    # --- deep-interview ---
    local di_file="$OMT_DIR/deep-interview-active-state-test-sid.json"
    rm -f "$di_file" 2>/dev/null || true

    printf '%s' '{"tool_name":"Skill","tool_input":{"skill":"deep-interview"}}' \
        | bash "$SCRIPT_DIR/pre-tool-enforcer.sh" > /dev/null

    assert_file_exists "$di_file" "AC-8c: deep-interview state file should be created" || return 1

    jq -e '.active == true' "$di_file" > /dev/null 2>&1 \
        || { echo "ASSERTION FAILED AC-8c DI: .active should be true"; return 1; }
    jq -e '(.started_at | length) > 0' "$di_file" > /dev/null 2>&1 \
        || { echo "ASSERTION FAILED AC-8c DI: .started_at should be non-empty"; return 1; }
    jq -e '(.last_touched_at | length) > 0' "$di_file" > /dev/null 2>&1 \
        || { echo "ASSERTION FAILED AC-8c DI: .last_touched_at should be non-empty"; return 1; }
    jq -e 'has("sessionId") | not' "$di_file" > /dev/null 2>&1 \
        || { echo "ASSERTION FAILED AC-8c DI: must not have sessionId field"; return 1; }

    # Exactly 3 fields: active, started_at, last_touched_at
    local di_keys
    di_keys=$(jq -r 'keys[]' "$di_file" | sort | tr '\n' ',' | sed 's/,$//')
    [[ "$di_keys" == "active,last_touched_at,started_at" ]] \
        || { echo "ASSERTION FAILED AC-8c DI: unexpected keys '$di_keys'"; return 1; }
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

# Shared JSON-envelope helpers for the hook's stdout (deny/allow classification
# and Bash tool_input construction), used by the write-guard corpus below.
hg_is_deny() {
    echo "$1" | jq -e '.hookSpecificOutput.hookEventName=="PreToolUse" and .hookSpecificOutput.permissionDecision=="deny"' > /dev/null 2>&1
}

hg_is_allow() {
    ! hg_is_deny "$1"
}

hg_bash_json() {
    # $1 = raw command string, already fully resolved by the caller (no shell
    # expansion happens inside this helper -- jq --arg treats it as a literal)
    jq -n --arg cmd "$1" '{tool_name: "Bash", tool_input: {command: $cmd}}'
}

# =============================================================================
# Ledger write-guard (compaction-continuous-record plan, TODO 7, D5).
# Corpus (a)-(i): each case is a decisive gate for the blacklist arming
# condition -- "ledger path referenced in WRITE-TARGET position", not
# substring-anywhere. wg_ledger_path()/wg_assert_deny() are shared helpers;
# hg_bash_json/hg_is_deny/hg_is_allow above are the shared JSON-envelope
# helpers (same JSON envelope shape).
# =============================================================================

wg_ledger_path() {
    echo "$OMT_DIR/session-ledger-$OMT_SESSION_ID.md"
}

wg_assert_deny() {
    local cmd="$1" label="$2"
    local out
    out=$(printf '%s' "$(hg_bash_json "$cmd")" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_deny "$out" || { echo "ASSERTION FAILED $label: expected deny. cmd='$cmd' out=$out"; return 1; }
}

# (a) non-ledger redirect -> PASS
test_wg_a_nonledger_redirect_passes() {
    local out
    out=$(printf '%s' "$(hg_bash_json 'echo x > /tmp/y')" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_allow "$out" || { echo "ASSERTION FAILED WG-A: non-ledger redirect should pass. Got: $out"; return 1; }
}

# (b) non-ledger chain -> PASS (compound-brick guard)
test_wg_b_nonledger_chain_passes() {
    local out
    out=$(printf '%s' "$(hg_bash_json 'grep foo bar | head')" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_allow "$out" || { echo "ASSERTION FAILED WG-B: non-ledger chain should pass. Got: $out"; return 1; }
}

# (c) omt-ledger.sh prose (metachars + ledger path mentioned in stdin payload,
# not a write target) -> PASS
test_wg_c_omtledger_prose_passes() {
    local out
    local cmd="printf '결정: session-ledger-x.md 참고' | omt-ledger.sh append Decisions"
    out=$(printf '%s' "$(hg_bash_json "$cmd")" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_allow "$out" || { echo "ASSERTION FAILED WG-C: omt-ledger prose pipe should pass. Got: $out"; return 1; }
}

# (d) cat (read) of the ledger -> PASS
test_wg_d_cat_ledger_passes() {
    local ledger out
    ledger=$(wg_ledger_path)
    out=$(printf '%s' "$(hg_bash_json "cat \"$ledger\"")" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_allow "$out" || { echo "ASSERTION FAILED WG-D: cat ledger (read) should pass. Got: $out"; return 1; }
}

# (e) each write-vector individually, ledger as write-target -> DENY
test_wg_e1_sed_i_denied() {
    local ledger; ledger=$(wg_ledger_path)
    wg_assert_deny "sed -i s/a/b/ \"$ledger\"" "WG-E1(sed -i)"
}

test_wg_e2_truncate_redirect_denied() {
    local ledger; ledger=$(wg_ledger_path)
    wg_assert_deny ": > \"$ledger\"" "WG-E2(: >)"
}

test_wg_e3_append_redirect_denied() {
    local ledger; ledger=$(wg_ledger_path)
    wg_assert_deny "echo x >> \"$ledger\"" "WG-E3(>>)"
}

test_wg_e4_tee_denied() {
    local ledger; ledger=$(wg_ledger_path)
    wg_assert_deny "tee \"$ledger\"" "WG-E4(tee)"
}

test_wg_e5_dd_denied() {
    local ledger; ledger=$(wg_ledger_path)
    wg_assert_deny "dd of=\"$ledger\"" "WG-E5(dd)"
}

test_wg_e6_cp_denied() {
    local ledger; ledger=$(wg_ledger_path)
    wg_assert_deny "cp z \"$ledger\"" "WG-E6(cp)"
}

test_wg_e7_mv_denied() {
    local ledger; ledger=$(wg_ledger_path)
    wg_assert_deny "mv z \"$ledger\"" "WG-E7(mv)"
}

test_wg_e8_truncate_cmd_denied() {
    local ledger; ledger=$(wg_ledger_path)
    wg_assert_deny "truncate -s0 \"$ledger\"" "WG-E8(truncate)"
}

test_wg_e9_rm_denied() {
    local ledger; ledger=$(wg_ledger_path)
    wg_assert_deny "rm \"$ledger\"" "WG-E9(rm)"
}

# (f) chain: omt-ledger.sh append (harmless) && sed -i on ledger -> DENY
test_wg_f_chain_write_denied() {
    local ledger; ledger=$(wg_ledger_path)
    wg_assert_deny "omt-ledger.sh append x && sed -i s/a/b/ \"$ledger\"" "WG-F(chain)"
}

# (g) non-ledger write whose CONTENT (not target) mentions the ledger path
# string -> PASS. Witness: write-target-position vs substring-anywhere.
test_wg_g_nonledger_write_with_ledger_substring_passes() {
    local out
    local cmd="echo '참고: session-ledger-x.md' > /tmp/note"
    out=$(printf '%s' "$(hg_bash_json "$cmd")" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_allow "$out" || { echo "ASSERTION FAILED WG-G: non-ledger write with ledger substring in content should pass. Got: $out"; return 1; }
}

# (g2/F3 regression) quoted '>' INSIDE prose must not be mistaken for a redirect
# operator. A '>' char sitting inside a single-quoted string is not a write
# target; the guard must not arm on it. Two witnesses: an omt-ledger append whose
# stdin payload prose contains "> session-ledger-", and a non-ledger write whose
# echoed prose contains it. Both MUST PASS (TODO7 MUST-NOT: omt-ledger prose /
# non-ledger compound brick 금지; AC-g write-target-vs-substring).
test_wg_g2_quoted_gt_in_omtledger_prose_passes() {
    local out
    local cmd="printf 'to dump use: foo > session-ledger-x.md' | omt-ledger.sh append Decisions"
    out=$(printf '%s' "$(hg_bash_json "$cmd")" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_allow "$out" || { echo "ASSERTION FAILED WG-G2(omt-ledger prose '>'): should pass. Got: $out"; return 1; }
}

test_wg_g3_quoted_gt_in_nonledger_echo_passes() {
    local out
    local cmd="echo 'tip: cmd > session-ledger-x.md saves it' > /tmp/note"
    out=$(printf '%s' "$(hg_bash_json "$cmd")" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_allow "$out" || { echo "ASSERTION FAILED WG-G3(non-ledger echo prose '>'): should pass. Got: $out"; return 1; }
}

# (h) Write/Edit/MultiEdit file_path == ledger -> DENY (separate code path
# from the Bash-command guard above; enforcer had no file_path handling before).
test_wg_h_write_edit_multiedit_filepath_ledger_denied() {
    local ledger out
    ledger=$(wg_ledger_path)

    out=$(jq -n --arg fp "$ledger" '{tool_name: "Write", tool_input: {file_path: $fp, content: "x"}}' \
        | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_deny "$out" || { echo "ASSERTION FAILED WG-H(Write): expected deny. Got: $out"; return 1; }

    out=$(jq -n --arg fp "$ledger" '{tool_name: "Edit", tool_input: {file_path: $fp, old_string: "a", new_string: "b"}}' \
        | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_deny "$out" || { echo "ASSERTION FAILED WG-H(Edit): expected deny. Got: $out"; return 1; }

    out=$(jq -n --arg fp "$ledger" '{tool_name: "MultiEdit", tool_input: {file_path: $fp, edits: []}}' \
        | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_deny "$out" || { echo "ASSERTION FAILED WG-H(MultiEdit): expected deny. Got: $out"; return 1; }
}

# (i) Write/Edit/MultiEdit file_path != ledger -> PASS
test_wg_i_write_edit_multiedit_filepath_nonledger_passes() {
    local out
    local fp="$OMT_DIR/other-file.md"

    out=$(jq -n --arg fp "$fp" '{tool_name: "Write", tool_input: {file_path: $fp, content: "x"}}' \
        | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_allow "$out" || { echo "ASSERTION FAILED WG-I(Write): expected allow. Got: $out"; return 1; }

    out=$(jq -n --arg fp "$fp" '{tool_name: "Edit", tool_input: {file_path: $fp, old_string: "a", new_string: "b"}}' \
        | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_allow "$out" || { echo "ASSERTION FAILED WG-I(Edit): expected allow. Got: $out"; return 1; }

    out=$(jq -n --arg fp "$fp" '{tool_name: "MultiEdit", tool_input: {file_path: $fp, edits: []}}' \
        | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_allow "$out" || { echo "ASSERTION FAILED WG-I(MultiEdit): expected allow. Got: $out"; return 1; }
}

# =============================================================================
# (j) single-quoted REAL write targets must still be caught -- quote-aware
# normalization strips the quote CHARACTERS but keeps the quoted CONTENT
# visible, so the existing path-visible checks below (redirect grep, dd
# of=, cp/mv last-word, first-word command match) still fire on a quoted
# path exactly as they do on an unquoted one.
# =============================================================================

test_wg_j1_rm_singlequoted_denied() {
    local ledger; ledger=$(wg_ledger_path)
    wg_assert_deny "rm '$ledger'" "WG-J1(rm quoted)"
}

test_wg_j2_truncate_redirect_singlequoted_denied() {
    local ledger; ledger=$(wg_ledger_path)
    wg_assert_deny ": > '$ledger'" "WG-J2(: > quoted)"
}

test_wg_j3_append_redirect_singlequoted_denied() {
    local ledger; ledger=$(wg_ledger_path)
    wg_assert_deny "echo x >> '$ledger'" "WG-J3(>> quoted)"
}

test_wg_j4_tee_singlequoted_denied() {
    local ledger; ledger=$(wg_ledger_path)
    wg_assert_deny "tee '$ledger'" "WG-J4(tee quoted)"
}

test_wg_j5_dd_singlequoted_denied() {
    local ledger; ledger=$(wg_ledger_path)
    wg_assert_deny "dd of='$ledger'" "WG-J5(dd quoted)"
}

test_wg_j6_cp_singlequoted_denied() {
    local ledger; ledger=$(wg_ledger_path)
    wg_assert_deny "cp z '$ledger'" "WG-J6(cp quoted)"
}

test_wg_j7_mv_singlequoted_denied() {
    local ledger; ledger=$(wg_ledger_path)
    wg_assert_deny "mv z '$ledger'" "WG-J7(mv quoted)"
}

test_wg_j8_truncate_cmd_singlequoted_denied() {
    local ledger; ledger=$(wg_ledger_path)
    wg_assert_deny "truncate -s0 '$ledger'" "WG-J8(truncate quoted)"
}

test_wg_j9_sed_i_singlequoted_denied() {
    local ledger; ledger=$(wg_ledger_path)
    wg_assert_deny "sed -i s/a/b/ '$ledger'" "WG-J9(sed -i quoted)"
}

# (k) in-quote '|' AND '>' together must both be masked -- an in-quote pipe
# must not spuriously split the segment (which would expose the in-quote
# '>' + ledger path to the redirect grep as if it were a real write target).
# Regression guard for the quote-aware normalizer masking the full
# metachar class, not just '>'.
test_wg_k_pipe_and_gt_inside_quotes_passes() {
    local out
    local cmd="printf 'a | b > session-ledger-x.md' | omt-ledger.sh append Decisions"
    out=$(printf '%s' "$(hg_bash_json "$cmd")" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_allow "$out" || { echo "ASSERTION FAILED WG-K(in-quote pipe+gt): should pass. Got: $out"; return 1; }
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
    run_test test_seed_ultragoal_creates_skeleton
    run_test test_seed_ultragoal_is_idempotent
    run_test test_seed_ultragoal_does_not_seed_goal_state
    run_test test_b1_absent_session_id_skips_and_warns
    run_test test_b3_unsafe_session_id_skips_and_warns
    run_test test_fail_loud_write_failure_warns_not_silent

    # TODO-5 seed reliability: stdin derivation + loud failures
    run_test test_ac8a_env_stripped_full_payload_seeds_derived_path
    run_test test_ac8b_i_missing_session_id_loud_failure
    run_test test_ac8b_ii_missing_cwd_loud_failure
    run_test test_ac8b_iii_nonproject_cwd_falls_back_with_warning
    run_test test_ac8c_prometheus_and_di_seed_field_preservation

    # Ledger write-guard (TODO 7, D5) -- corpus (a)-(i)
    run_test test_wg_a_nonledger_redirect_passes
    run_test test_wg_b_nonledger_chain_passes
    run_test test_wg_c_omtledger_prose_passes
    run_test test_wg_d_cat_ledger_passes
    run_test test_wg_e1_sed_i_denied
    run_test test_wg_e2_truncate_redirect_denied
    run_test test_wg_e3_append_redirect_denied
    run_test test_wg_e4_tee_denied
    run_test test_wg_e5_dd_denied
    run_test test_wg_e6_cp_denied
    run_test test_wg_e7_mv_denied
    run_test test_wg_e8_truncate_cmd_denied
    run_test test_wg_e9_rm_denied
    run_test test_wg_f_chain_write_denied
    run_test test_wg_g_nonledger_write_with_ledger_substring_passes
    run_test test_wg_g2_quoted_gt_in_omtledger_prose_passes
    run_test test_wg_g3_quoted_gt_in_nonledger_echo_passes
    run_test test_wg_h_write_edit_multiedit_filepath_ledger_denied
    run_test test_wg_i_write_edit_multiedit_filepath_nonledger_passes
    run_test test_wg_j1_rm_singlequoted_denied
    run_test test_wg_j2_truncate_redirect_singlequoted_denied
    run_test test_wg_j3_append_redirect_singlequoted_denied
    run_test test_wg_j4_tee_singlequoted_denied
    run_test test_wg_j5_dd_singlequoted_denied
    run_test test_wg_j6_cp_singlequoted_denied
    run_test test_wg_j7_mv_singlequoted_denied
    run_test test_wg_j8_truncate_cmd_singlequoted_denied
    run_test test_wg_j9_sed_i_singlequoted_denied
    run_test test_wg_k_pipe_and_gt_inside_quotes_passes

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
}

main "$@"

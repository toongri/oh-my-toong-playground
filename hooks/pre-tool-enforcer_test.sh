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

# =============================================================================
# Handoff-gate arm (TODO 1 of handoff-full-read-teeth plan)
# Shared harness: arm_handoff() creates $HG_H (handoff file) and clears $HG_M
# (consumed marker) under the already-exported $OMT_DIR/$OMT_SESSION_ID from
# setup_test_env. hg_is_deny/hg_is_allow classify hook stdout.
# =============================================================================

arm_handoff() {
    HG_H="$OMT_DIR/handoff-$OMT_SESSION_ID.md"
    : > "$HG_H"
    HG_M="$OMT_DIR/handoff-consumed-$OMT_SESSION_ID"
    rm -f "$HG_M"
}

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

hg_reason() {
    echo "$1" | jq -r '.hookSpecificOutput.permissionDecisionReason // empty'
}

test_hg_ac1_pipe_tail_denied() {
    arm_handoff
    local cmd="cat \"$HG_H\" | tail -40"
    local out
    out=$(printf '%s' "$(hg_bash_json "$cmd")" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_deny "$out" || { echo "ASSERTION FAILED AC1: expected deny for piped tail. Got: $out"; return 1; }
}

test_hg_ac2_read_offset_denied_reason_mentions_cat() {
    arm_handoff
    local out
    out=$(jq -n --arg fp "$HG_H" '{tool_name: "Read", tool_input: {file_path: $fp, offset: 1, limit: 40}}' \
        | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_deny "$out" || { echo "ASSERTION FAILED AC2: expected deny for Read. Got: $out"; return 1; }
    hg_reason "$out" | grep -qi "cat" \
        || { echo "ASSERTION FAILED AC2: reason should mention cat. Got: $(hg_reason "$out")"; return 1; }
}

test_hg_ac3_read_no_offset_denied() {
    arm_handoff
    local out
    out=$(jq -n --arg fp "$HG_H" '{tool_name: "Read", tool_input: {file_path: $fp}}' \
        | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_deny "$out" || { echo "ASSERTION FAILED AC3: expected deny for Read w/o offset. Got: $out"; return 1; }
}

test_hg_ac4a_write_denied_reason_mentions_handoff_or_cat() {
    arm_handoff
    local out
    out=$(jq -n --arg fp "$HG_H" '{tool_name: "Write", tool_input: {file_path: $fp, content: "x"}}' \
        | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_deny "$out" || { echo "ASSERTION FAILED AC4a: expected deny for Write. Got: $out"; return 1; }
    hg_reason "$out" | grep -qiE "handoff|cat" \
        || { echo "ASSERTION FAILED AC4a: reason should mention handoff/cat. Got: $(hg_reason "$out")"; return 1; }
}

test_hg_ac4b_bash_ls_denied() {
    arm_handoff
    local out
    out=$(printf '%s' "$(hg_bash_json "ls")" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_deny "$out" || { echo "ASSERTION FAILED AC4b: expected deny for bash ls. Got: $out"; return 1; }
}

test_hg_ac5_recognition_edge_cases_denied() {
    arm_handoff
    local out

    out=$(printf '%s' "$(hg_bash_json "cat \"$HG_H\" > /tmp/x")" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_deny "$out" || { echo "ASSERTION FAILED AC5a: redirect should deny. Got: $out"; return 1; }

    out=$(printf '%s' "$(hg_bash_json "cat \"$HG_H\"; ls")" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_deny "$out" || { echo "ASSERTION FAILED AC5b: chained ; should deny. Got: $out"; return 1; }

    out=$(printf '%s' "$(hg_bash_json "cat \"$HG_H\" && echo hi")" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_deny "$out" || { echo "ASSERTION FAILED AC5c: chained && should deny. Got: $out"; return 1; }

    out=$(printf '%s' "$(hg_bash_json "echo cat")" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_deny "$out" || { echo "ASSERTION FAILED AC5d: echo cat should deny. Got: $out"; return 1; }

    out=$(printf '%s' "$(hg_bash_json "cat -n \"$HG_H\"")" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_deny "$out" || { echo "ASSERTION FAILED AC5e: cat -n (two args) should deny. Got: $out"; return 1; }
}

test_hg_ac6_wrong_path_denied_reason_redirects_to_handoff() {
    arm_handoff
    local out
    out=$(printf '%s' "$(hg_bash_json 'cat "/etc/hostname"')" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_deny "$out" || { echo "ASSERTION FAILED AC6: wrong path should deny. Got: $out"; return 1; }
    hg_reason "$out" | grep -qi "handoff" \
        || { echo "ASSERTION FAILED AC6: reason should redirect to handoff. Got: $(hg_reason "$out")"; return 1; }
}

test_hg_ac7_other_state_file_denied_generic_reason() {
    arm_handoff
    local cmd='cat "$OMT_DIR/prometheus-state-$OMT_SESSION_ID.json"'
    local out
    out=$(printf '%s' "$(hg_bash_json "$cmd")" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_deny "$out" || { echo "ASSERTION FAILED AC7: other state-file path should deny. Got: $out"; return 1; }
    hg_reason "$out" | grep -qi "handoff" \
        || { echo "ASSERTION FAILED AC7: reason should be generic handoff-first. Got: $(hg_reason "$out")"; return 1; }
}

test_hg_ac8a_command_substitution_denied() {
    arm_handoff
    local cmd='cat "$(echo /etc/hostname)"'
    local out
    out=$(printf '%s' "$(hg_bash_json "$cmd")" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_deny "$out" || { echo "ASSERTION FAILED AC8a: command substitution should deny. Got: $out"; return 1; }
}

test_hg_ac8b_command_substitution_never_executed() {
    arm_handoff
    local pwned="$OMT_DIR/PWNED"
    rm -f "$pwned"
    local cmd='cat "$(touch "$OMT_DIR/PWNED"; echo "$OMT_DIR")/handoff-$OMT_SESSION_ID.md"'
    local out
    out=$(printf '%s' "$(hg_bash_json "$cmd")" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_deny "$out" || { echo "ASSERTION FAILED AC8b: should deny. Got: $out"; return 1; }
    [[ ! -e "$pwned" ]] \
        || { echo "ASSERTION FAILED AC8b: SECURITY -- subshell was executed, PWNED file exists"; return 1; }
}

test_hg_ac_squote_literal_dollar_denied() {
    arm_handoff
    local cmd="cat '\$OMT_DIR/handoff-\$OMT_SESSION_ID.md'"
    local out
    out=$(printf '%s' "$(hg_bash_json "$cmd")" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_deny "$out" || { echo "ASSERTION FAILED AC-SQUOTE: single-quoted literal \$ should deny. Got: $out"; return 1; }
}

test_hg_ac_env_full_honored_envelope() {
    arm_handoff
    local out
    out=$(jq -n --arg fp "$HG_H" '{tool_name: "Write", tool_input: {file_path: $fp, content: "x"}}' \
        | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    echo "$out" | jq -e . > /dev/null 2>&1 \
        || { echo "ASSERTION FAILED AC-ENV: stdout should be valid JSON. Got: $out"; return 1; }
    echo "$out" | grep -q '"hookEventName".*"PreToolUse"' \
        || { echo "ASSERTION FAILED AC-ENV: missing hookEventName:PreToolUse. Got: $out"; return 1; }
    echo "$out" | grep -q '"permissionDecision".*"deny"' \
        || { echo "ASSERTION FAILED AC-ENV: missing permissionDecision:deny. Got: $out"; return 1; }
}

test_hg_ac_deny_nomark_marker_absent_on_deny() {
    arm_handoff
    local out

    out=$(printf '%s' "$(hg_bash_json "cat \"$HG_H\" | tail -40")" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_deny "$out" || { echo "ASSERTION FAILED AC-DENY-NOMARK: piped tail should deny. Got: $out"; return 1; }
    assert_file_not_exists "$HG_M" "AC-DENY-NOMARK: marker must not exist after denied pipe" || return 1

    out=$(jq -n --arg fp "$HG_H" '{tool_name: "Write", tool_input: {file_path: $fp, content: "x"}}' \
        | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_deny "$out" || { echo "ASSERTION FAILED AC-DENY-NOMARK: Write should deny. Got: $out"; return 1; }
    assert_file_not_exists "$HG_M" "AC-DENY-NOMARK: marker must not exist after denied Write" || return 1
}

test_hg_ac9_fully_expanded_path_allowed_and_marked() {
    arm_handoff
    local cmd="cat \"$HG_H\""
    local out
    out=$(printf '%s' "$(hg_bash_json "$cmd")" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_allow "$out" || { echo "ASSERTION FAILED AC9: fully-expanded cat should allow. Got: $out"; return 1; }
    assert_file_exists "$HG_M" "AC9: marker should be created on allowed cat" || return 1
}

test_hg_ac10_unexpanded_pointer_form_allowed_and_marked() {
    arm_handoff
    local cmd='cat "$OMT_DIR/handoff-$OMT_SESSION_ID.md"'
    local out
    out=$(printf '%s' "$(hg_bash_json "$cmd")" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_allow "$out" || { echo "ASSERTION FAILED AC10: unexpanded pointer form should allow. Got: $out"; return 1; }
    assert_file_exists "$HG_M" "AC10: marker should be created on allowed cat" || return 1
}

test_hg_ac11_leading_indent_allowed_and_marked() {
    arm_handoff
    local cmd='  cat "$OMT_DIR/handoff-$OMT_SESSION_ID.md"'
    local out
    out=$(printf '%s' "$(hg_bash_json "$cmd")" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_allow "$out" || { echo "ASSERTION FAILED AC11: leading indent should allow. Got: $out"; return 1; }
    assert_file_exists "$HG_M" "AC11: marker should be created on allowed cat" || return 1
}

test_hg_ac_partial_omtdir_expanded_sid_literal_allowed() {
    arm_handoff
    local cmd="cat \"$OMT_DIR/handoff-\$OMT_SESSION_ID.md\""
    local out
    out=$(printf '%s' "$(hg_bash_json "$cmd")" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_allow "$out" || { echo "ASSERTION FAILED AC-PARTIAL: partially-substituted form should allow. Got: $out"; return 1; }
    assert_file_exists "$HG_M" "AC-PARTIAL: marker should be created on allowed cat" || return 1
}

test_hg_ac_space_embedded_space_never_word_split() {
    local base
    base=$(mktemp -d)
    export OMT_DIR="$base/dir with space"
    mkdir -p "$OMT_DIR"
    arm_handoff
    local cmd="cat \"$OMT_DIR/handoff-$OMT_SESSION_ID.md\""
    local out
    out=$(printf '%s' "$(hg_bash_json "$cmd")" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    if ! hg_is_allow "$out"; then
        echo "ASSERTION FAILED AC-SPACE: quoted path with embedded space should allow. Got: $out"
        rm -rf "$base"
        return 1
    fi
    if [[ ! -f "$HG_M" ]]; then
        echo "ASSERTION FAILED AC-SPACE: marker should be created on allowed cat"
        rm -rf "$base"
        return 1
    fi
    rm -rf "$base"
}

test_hg_ac_unquoted_omtdir_space_denied_no_mark() {
    # UNQUOTED pointer form under a space-bearing OMT_DIR. The hook's textual
    # substitution matches the expected path (allow), but real bash word-splits
    # the unquoted $OMT_DIR so `cat` never reads the handoff -- a false-allow
    # that disarms the gate. The gate must DENY this form and leave no marker.
    local base
    base=$(mktemp -d)
    export OMT_DIR="$base/dir with space"
    mkdir -p "$OMT_DIR"
    arm_handoff
    local cmd='cat $OMT_DIR/handoff-$OMT_SESSION_ID.md'
    local out
    out=$(printf '%s' "$(hg_bash_json "$cmd")" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    if ! hg_is_deny "$out"; then
        echo "ASSERTION FAILED AC-UNQUOTED: unquoted \$OMT_DIR w/ space must deny (word-split false-allow). Got: $out"
        rm -rf "$base"
        return 1
    fi
    if [[ -f "$HG_M" ]]; then
        echo "ASSERTION FAILED AC-UNQUOTED: marker must not exist after denied unquoted form"
        rm -rf "$base"
        return 1
    fi
    rm -rf "$base"
}

test_hg_ac13_symlink_omt_dir_byte_exact_allowed() {
    local real link
    real=$(mktemp -d)
    link="${real}-link"
    ln -s "$real" "$link"
    export OMT_DIR="$link"
    arm_handoff
    local cmd="cat \"$OMT_DIR/handoff-$OMT_SESSION_ID.md\""
    local out
    out=$(printf '%s' "$(hg_bash_json "$cmd")" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    if ! hg_is_allow "$out"; then
        echo "ASSERTION FAILED AC13: symlinked OMT_DIR (byte-exact) should allow. Got: $out"
        rm -f "$link"; rm -rf "$real"
        return 1
    fi
    if [[ ! -f "$HG_M" ]]; then
        echo "ASSERTION FAILED AC13: marker should be created on allowed cat"
        rm -f "$link"; rm -rf "$real"
        return 1
    fi
    rm -f "$link"; rm -rf "$real"
}

test_hg_ac14_marker_present_releases_gate() {
    arm_handoff
    : > "$HG_M"
    local out
    out=$(printf '%s' "$(hg_bash_json "ls")" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_allow "$out" || { echo "ASSERTION FAILED AC14: gate should be released once marker present. Got: $out"; return 1; }
}

test_hg_ac15_handoff_absent_fail_open() {
    rm -f "$OMT_DIR/handoff-$OMT_SESSION_ID.md" 2>/dev/null || true
    local out
    out=$(jq -n --arg fp "$OMT_DIR/x" '{tool_name: "Write", tool_input: {file_path: $fp, content: "x"}}' \
        | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_allow "$out" || { echo "ASSERTION FAILED AC15: handoff absent should fail-open (allow). Got: $out"; return 1; }
}

test_hg_ac16_arms_via_stdin_derivation() {
    local project_cwd="$SCRIPT_DIR"
    local stdin_sid="hg-stdin-sid"
    local fake_home="$TEST_TMP_DIR/home_hg16"
    mkdir -p "$fake_home"

    local derived_omt_dir
    derived_omt_dir=$(
        unset OMT_DIR
        export HOME="$fake_home"
        source "$SCRIPT_DIR/lib/omt-dir.sh" && resolve_omt_dir "$project_cwd"
    )
    mkdir -p "$derived_omt_dir"
    : > "$derived_omt_dir/handoff-${stdin_sid}.md"
    rm -f "$derived_omt_dir/handoff-consumed-${stdin_sid}"

    local out
    out=$(
        unset OMT_DIR OMT_SESSION_ID
        export HOME="$fake_home"
        printf '%s' "{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"x\",\"content\":\"x\"},\"session_id\":\"$stdin_sid\",\"cwd\":\"$project_cwd\"}" \
            | bash "$SCRIPT_DIR/pre-tool-enforcer.sh"
    )
    hg_is_deny "$out" || { echo "ASSERTION FAILED AC16: should arm via stdin-derived sid/cwd and deny. Got: $out"; return 1; }
}

test_hg_ac17_neither_env_nor_cwd_fail_open() {
    local out
    out=$(
        unset OMT_DIR OMT_SESSION_ID
        printf '%s' '{"tool_name":"Write","tool_input":{"file_path":"x","content":"x"}}' \
            | bash "$SCRIPT_DIR/pre-tool-enforcer.sh"
    )
    hg_is_allow "$out" || { echo "ASSERTION FAILED AC17: unresolvable sid+dir should fail-open (allow). Got: $out"; return 1; }
}

test_hg_ac18_unwritable_dir_no_livelock() {
    arm_handoff
    chmod -w "$OMT_DIR"

    local cmd="cat \"$HG_H\""
    local out exit_code=0
    out=$(printf '%s' "$(hg_bash_json "$cmd")" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh") || exit_code=$?
    chmod +w "$OMT_DIR"

    [[ "$exit_code" -eq 0 ]] \
        || { echo "ASSERTION FAILED AC18a: hook should exit 0 under unwritable dir (exit=$exit_code)"; return 1; }
    hg_is_allow "$out" \
        || { echo "ASSERTION FAILED AC18a: allowed-cat under unwritable dir should allow. Got: $out"; return 1; }

    chmod -w "$OMT_DIR"
    local out2
    out2=$(jq -n --arg fp "$OMT_DIR/x" '{tool_name: "Write", tool_input: {file_path: $fp, content: "x"}}' \
        | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    chmod +w "$OMT_DIR"

    hg_is_allow "$out2" \
        || { echo "ASSERTION FAILED AC18b: Write under unwritable dir should allow (no-livelock). Got: $out2"; return 1; }
}

test_hg_ac_jq_missing_fail_open() {
    arm_handoff
    local payload
    payload=$(jq -n --arg fp "$OMT_DIR/x" '{tool_name: "Write", tool_input: {file_path: $fp, content: "x"}}')

    # Build a shim PATH: symlink every executable found on the real PATH
    # EXCEPT jq (by filename, not by directory -- jq shares /usr/bin with
    # grep/sed/dirname/basename, which the hook still needs).
    local shim_dir p bin name
    shim_dir=$(mktemp -d)
    local oldifs="$IFS"
    IFS=':'
    for p in $PATH; do
        IFS="$oldifs"
        [[ -d "$p" ]] || continue
        for bin in "$p"/*; do
            [[ -x "$bin" && -f "$bin" ]] || continue
            name=$(basename "$bin")
            [[ "$name" == "jq" ]] && continue
            [[ -e "$shim_dir/$name" ]] && continue
            ln -s "$bin" "$shim_dir/$name" 2>/dev/null || true
        done
        IFS=':'
    done
    IFS="$oldifs"

    local out exit_code=0
    out=$(
        export PATH="$shim_dir"
        printf '%s' "$payload" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh"
    ) || exit_code=$?
    rm -rf "$shim_dir"

    [[ "$exit_code" -eq 0 ]] \
        || { echo "ASSERTION FAILED AC-JQ: hook should exit 0 when jq missing (exit=$exit_code)"; return 1; }
    hg_is_allow "$out" \
        || { echo "ASSERTION FAILED AC-JQ: jq missing should fail-open (allow). Got: $out"; return 1; }
}

test_hg_ac23_armed_prometheus_skill_denied_no_seed() {
    arm_handoff
    local state_file="$OMT_DIR/prometheus-state-$OMT_SESSION_ID.json"
    rm -f "$state_file"
    local out
    out=$(printf '%s' '{"tool_name":"Skill","tool_input":{"skill":"prometheus"}}' \
        | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_deny "$out" \
        || { echo "ASSERTION FAILED AC23: armed Skill(prometheus) should deny. Got: $out"; return 1; }
    assert_file_not_exists "$state_file" "AC23: prometheus-state must NOT be written while armed" || return 1
}

# =============================================================================
# AC12 — drift-couple integration (TODO 3): the REAL session-start.sh emitter
# and the REAL pre-tool-enforcer.sh gate must agree byte-for-byte. Runs
# session-start.sh with source:compact + a >7000-char handoff under a clean
# OMT_DIR (no prometheus/goal/qa/deep-interview restore-state present, HOME
# sandboxed so real ~/.claude/todos can't inject a PENDING-TASKS message),
# jq-decodes the emitted additionalContext, extracts the actual "cat ...
# handoff-..." pointer line the emitter produced (no hand-fabricated string),
# and feeds THAT literal env-unexpanded command to the gate.
# =============================================================================

test_ac12_drift_couple_session_start_emits_gate_accepts() {
    local fake_home="$TEST_TMP_DIR/home_ac12"
    mkdir -p "$fake_home/.claude"

    local handoff_file="$OMT_DIR/handoff-$OMT_SESSION_ID.md"
    rm -f "$OMT_DIR/handoff-consumed-$OMT_SESSION_ID"

    # >7000-char handoff so session-start takes the pointer path (not the <=7000 inline path).
    yes 'AC12_DRIFT_COUPLE_FILLER_LINE_1234567890_ABCDEFGHIJ' 2>/dev/null \
        | head -c 7200 > "$handoff_file" 2>/dev/null || true
    if [ ! -s "$handoff_file" ] || [ "$(wc -c < "$handoff_file" 2>/dev/null || echo 0)" -lt 7001 ]; then
        python3 -c "print('X' * 7200)" > "$handoff_file" 2>/dev/null || true
    fi

    local output
    output=$(
        export HOME="$fake_home"
        printf '%s' "{\"sessionId\":\"$OMT_SESSION_ID\",\"cwd\":\"$TEST_TMP_DIR\",\"source\":\"compact\"}" \
            | bash "$SCRIPT_DIR/session-start.sh"
    )

    echo "$output" | jq -e . > /dev/null 2>&1 \
        || { echo "ASSERTION FAILED AC12: session-start stdout must be valid JSON. Got: $output"; return 1; }

    local ctx
    ctx=$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext // empty')
    [[ -n "$ctx" ]] \
        || { echo "ASSERTION FAILED AC12: additionalContext should be non-empty for a >7000-char compact handoff"; return 1; }

    # Extract the emitter's actual pointer line -- derived, not fabricated.
    local cat_cmd
    cat_cmd=$(echo "$ctx" | grep -oE 'cat "[^"]*handoff-[^"]*"' | head -1)
    [[ -n "$cat_cmd" ]] \
        || { echo "ASSERTION FAILED AC12: could not find a handoff cat pointer in emitted additionalContext. ctx: ${ctx:0:400}"; return 1; }

    # Feed the extracted command, env-UNexpanded, to the gate under the SAME OMT_DIR/OMT_SESSION_ID.
    local gate_out
    gate_out=$(printf '%s' "$(hg_bash_json "$cat_cmd")" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")

    hg_is_allow "$gate_out" \
        || { echo "ASSERTION FAILED AC12: gate should allow the emitter's own pointer command. cmd='$cat_cmd' out=$gate_out"; return 1; }

    assert_file_exists "$OMT_DIR/handoff-consumed-$OMT_SESSION_ID" \
        "AC12: consumed marker should be written when the gate allows the emitter's pointer" || return 1
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

    # TODO-5 seed reliability: stdin derivation + loud failures
    run_test test_ac8a_env_stripped_full_payload_seeds_derived_path
    run_test test_ac8b_i_missing_session_id_loud_failure
    run_test test_ac8b_ii_missing_cwd_loud_failure
    run_test test_ac8b_iii_nonproject_cwd_falls_back_with_warning
    run_test test_ac8c_prometheus_and_di_seed_field_preservation

    # Handoff-gate arm (TODO 1)
    run_test test_hg_ac1_pipe_tail_denied
    run_test test_hg_ac2_read_offset_denied_reason_mentions_cat
    run_test test_hg_ac3_read_no_offset_denied
    run_test test_hg_ac4a_write_denied_reason_mentions_handoff_or_cat
    run_test test_hg_ac4b_bash_ls_denied
    run_test test_hg_ac5_recognition_edge_cases_denied
    run_test test_hg_ac6_wrong_path_denied_reason_redirects_to_handoff
    run_test test_hg_ac7_other_state_file_denied_generic_reason
    run_test test_hg_ac8a_command_substitution_denied
    run_test test_hg_ac8b_command_substitution_never_executed
    run_test test_hg_ac_squote_literal_dollar_denied
    run_test test_hg_ac_env_full_honored_envelope
    run_test test_hg_ac_deny_nomark_marker_absent_on_deny
    run_test test_hg_ac9_fully_expanded_path_allowed_and_marked
    run_test test_hg_ac10_unexpanded_pointer_form_allowed_and_marked
    run_test test_hg_ac11_leading_indent_allowed_and_marked
    run_test test_hg_ac_partial_omtdir_expanded_sid_literal_allowed
    run_test test_hg_ac_space_embedded_space_never_word_split
    run_test test_hg_ac_unquoted_omtdir_space_denied_no_mark
    run_test test_hg_ac13_symlink_omt_dir_byte_exact_allowed
    run_test test_hg_ac14_marker_present_releases_gate
    run_test test_hg_ac15_handoff_absent_fail_open
    run_test test_hg_ac16_arms_via_stdin_derivation
    run_test test_hg_ac17_neither_env_nor_cwd_fail_open
    run_test test_hg_ac18_unwritable_dir_no_livelock
    run_test test_hg_ac_jq_missing_fail_open
    run_test test_hg_ac23_armed_prometheus_skill_denied_no_seed

    # Drift-couple integration (TODO 3)
    run_test test_ac12_drift_couple_session_start_emits_gate_accepts

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
}

main "$@"

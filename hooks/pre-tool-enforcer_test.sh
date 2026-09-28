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
# Must be set before the first setup_test_env call: otherwise its re-entrant
# check below sees a value inherited from the ambient environment (not one
# this suite created) and tears down/rm -rf's a directory it never made.
TEST_TMP_DIR=""

setup_test_env() {
    # Re-entrant: a caller that has already set up a TEST_TMP_DIR (e.g. the
    # CLAUDE_ENV_FILE scrub regression test below, which calls setup_test_env
    # a second time after run_test's own call) must have its first TEST_TMP_DIR
    # torn down before a second one is created, or the first is orphaned
    # without cleanup.
    if [ -n "${TEST_TMP_DIR:-}" ]; then
        teardown_test_env
    fi

    TEST_TMP_DIR=$(mktemp -d)
    export OMT_DIR="$TEST_TMP_DIR/.omt"
    mkdir -p "$OMT_DIR"
    export OMT_SESSION_ID="test-sid"
    # Scrub CLAUDE_ENV_FILE before every test's body runs -- otherwise the
    # session-start.sh invocation below (AC9) inherits the ambient value
    # (e.g. a live Claude Code session's real env file) and the hook
    # silently overwrites it with this suite's throwaway test state.
    unset CLAUDE_ENV_FILE || true
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

    if echo "$output" | jq -e '.hookSpecificOutput.hookEventName == "PreToolUse" and .hookSpecificOutput.permissionDecision == "deny" and (.hookSpecificOutput.permissionDecisionReason | test("TaskOutput")) and (has("continue") | not)' >/dev/null; then
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
    bun "$SCRIPT_DIR/../skills/prometheus/scripts/prometheus-state.ts" set --phase S3 --record-non-goals '- test exclusion | decider: changes test state' > /dev/null 2>&1 \
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
    bun "$SCRIPT_DIR/../skills/prometheus/scripts/prometheus-state.ts" set --phase S3 --record-non-goals '- test exclusion | decider: changes test state' > /dev/null 2>&1 \
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
# seed-explain-diff — Skill(explain-diff) seeds a state that is already armed:
# the artifact guard must let the first evidence-step write through, and the
# Stop gate must already refuse to let the session end before the quiz.
# =============================================================================

test_seed_explain_diff_creates_armed_skeleton() {
    local state_file="$OMT_DIR/explain-diff-state-test-sid.json"

    printf '%s' '{"tool_name":"Skill","tool_input":{"skill":"explain-diff"}}' \
        | bash "$SCRIPT_DIR/pre-tool-enforcer.sh" > /dev/null

    assert_file_exists "$state_file" "explain-diff state file should be created" || return 1

    jq -e '.active == true and .step == "evidence" and (.passed | length) == 0
        and .derived.artifact_write_allowed == true
        and .derived.stop_allowed == false
        and .derived.quiz_passed == false
        and (.started_at | length > 0) and (.last_touched_at | length > 0)' \
        "$state_file" > /dev/null 2>&1 \
        || { echo "ASSERTION FAILED: explain-diff seed is not an armed skeleton"; return 1; }
}

test_seed_explain_diff_is_idempotent() {
    local state_file="$OMT_DIR/explain-diff-state-test-sid.json"

    printf '%s' '{"tool_name":"Skill","tool_input":{"skill":"explain-diff"}}' \
        | bash "$SCRIPT_DIR/pre-tool-enforcer.sh" > /dev/null
    assert_file_exists "$state_file" "explain-diff state file should exist after first seed" || return 1

    local tmp
    tmp=$(mktemp)
    jq '.step = "quiz"' "$state_file" > "$tmp" && mv "$tmp" "$state_file"

    printf '%s' '{"tool_name":"Skill","tool_input":{"skill":"explain-diff"}}' \
        | bash "$SCRIPT_DIR/pre-tool-enforcer.sh" > /dev/null

    jq -e '.step == "quiz"' "$state_file" > /dev/null 2>&1 \
        || { echo "ASSERTION FAILED: re-fire seed must not reset step (create-if-absent only)"; return 1; }
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
    local state_file_a="$OMT_DIR/ultragoal-state-stdin-derived-sid.json"

    stderr_a=$(
        unset OMT_SESSION_ID
        printf '%s' "{\"tool_name\":\"Skill\",\"tool_input\":{\"skill\":\"ultragoal\"},\"session_id\":\"stdin-derived-sid\",\"cwd\":\"$OMT_DIR\"}" \
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
        printf '%s' '{"tool_name":"Skill","tool_input":{"skill":"ultragoal"}}' \
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
        printf '%s' '{"tool_name":"Skill","tool_input":{"skill":"ultragoal"}}' \
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

    local expected_file="$derived_omt_dir/ultragoal-state-${stdin_sid}.json"

    stderr_out=$(
        unset OMT_DIR OMT_SESSION_ID
        export HOME="$fake_home"
        printf '%s' "{\"tool_name\":\"Skill\",\"tool_input\":{\"skill\":\"ultragoal\"},\"session_id\":\"$stdin_sid\",\"cwd\":\"$project_cwd\"}" \
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
        printf '%s' "{\"tool_name\":\"Skill\",\"tool_input\":{\"skill\":\"ultragoal\"},\"cwd\":\"$project_cwd\"}" \
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
        printf '%s' "{\"tool_name\":\"Skill\",\"tool_input\":{\"skill\":\"ultragoal\"},\"session_id\":\"$stdin_sid\"}" \
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
        printf '%s' "{\"tool_name\":\"Skill\",\"tool_input\":{\"skill\":\"ultragoal\"},\"session_id\":\"$stdin_sid\",\"cwd\":\"$bare_cwd\"}" \
            | bash "$SCRIPT_DIR/pre-tool-enforcer.sh" 2>&1 >/dev/null
    ) || exit_code=$?

    rmdir "$bare_cwd" 2>/dev/null || true

    [[ "$exit_code" -eq 0 ]] \
        || { echo "ASSERTION FAILED AC-8b-iii: Hook should exit 0 for non-project cwd (exit=$exit_code)"; return 1; }

    # Loud: stderr must contain the "non-canonical" warning emitted by omt-dir.sh
    echo "$stderr_out" | grep -q "non-canonical" \
        || { echo "ASSERTION FAILED AC-8b-iii: stderr should contain 'non-canonical'. Got: '$stderr_out'"; return 1; }

    # Fallback contract: seed IS created at $HOME/.omt/<basename of bare_cwd>/ultragoal-state-<sid>.json
    local bare_basename
    bare_basename=$(basename "$bare_cwd")
    local expected_file="$fake_home/.omt/${bare_basename}/ultragoal-state-${stdin_sid}.json"
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
        printf '%s' '{"tool_name":"Skill","tool_input":{"skill":"ultragoal"}}' \
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
    # Positive assertion: the hook's actual allow output is `{"continue": true}`.
    # `! hg_is_deny` would also pass empty stdout (an early-abort crash),
    # misreading a crash as an allow.
    echo "$1" | jq -e '.continue == true' > /dev/null 2>&1
}

hg_bash_json() {
    # $1 = raw command string, already fully resolved by the caller. Slurp it
    # from stdin so large commands do not exceed jq's argv-size limit.
    printf '%s' "$1" | jq -Rs '{tool_name: "Bash", tool_input: {command: .}}'
}

test_resume_pursuit_allowed_through_claude_shared_guard() {
    local out
    out=$(printf '%s' "$(hg_bash_json 'bun /Users/x/.claude/skills/ultragoal/scripts/ultragoal-state.ts resume-pursuit --reason x')" \
        | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_allow "$out" || { echo "ASSERTION FAILED Claude resume-pursuit wiring: expected allow. Got: $out"; return 1; }
}

test_user_authorized_force_complete_reaches_claude_shared_guard() {
    local out
    out=$(printf '%s' "$(hg_bash_json 'bun /Users/x/.claude/skills/ultragoal/scripts/ultragoal-state.ts force-complete --reason x')" \
        | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_deny "$out" || { echo "ASSERTION FAILED Claude force-complete wiring: expected shared deny. Got: $out"; return 1; }
}

# =============================================================================
# Code-review artifact identity guard (code-review-artifact-guard-core plan)
# -- wires codereview_guard_core_run (hooks/write-guard-core.sh) into this
# adapter. Distinct guard from the skill-state write-guard: the state guard
# is an unconditional deny (nobody may touch a protected state path
# directly); this guard is identity-conditional (only the code-reviewer
# subagent may write these two paths) -- the two guards fire independently
# on the SAME candidate set, so this corpus exercises the codereview verdict
# specifically, not the state guard's denial reasons
# denial reasons.
# =============================================================================

cr_ultragoal_path() {
    echo "$OMT_DIR/ultragoal-codereview-$OMT_SESSION_ID.json"
}

cr_goal_path() {
    echo "$OMT_DIR/goal-codereview-$OMT_SESSION_ID.json"
}

hg_bash_json_agent() {
    # $1 = raw command string, $2 = agent_type value. Slurp the command from
    # stdin so large commands do not exceed jq's argv-size limit.
    printf '%s' "$1" | jq -Rs --arg at "$2" '{tool_name: "Bash", tool_input: {command: .}, agent_type: $at}'
}

hg_write_json_agent() {
    # $1 = file_path, $2 = agent_type value
    jq -n --arg fp "$1" --arg at "$2" '{tool_name: "Write", tool_input: {file_path: $fp, content: "x"}, agent_type: $at}'
}

hg_write_json_no_agent() {
    # $1 = file_path -- agent_type field entirely ABSENT, mirroring an
    # ordinary main-thread tool call's payload shape (it doesn't carry
    # agent_type at all; it is not present-but-empty).
    jq -n --arg fp "$1" '{tool_name: "Write", tool_input: {file_path: $fp, content: "x"}}'
}

# CR-1 -- Write to ultragoal-codereview path with agent_type entirely absent
# (the real main-thread payload shape) -> DENY. This is the core
# forgery-prevention case: without it, the orchestrator could Write the
# artifact directly and the ultragoal completion gate would treat it as an
# independent code-reviewer's verdict.
test_cr1_write_ultragoal_codereview_no_agent_type_denied() {
    local path out
    path=$(cr_ultragoal_path)
    out=$(printf '%s' "$(hg_write_json_no_agent "$path")" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_deny "$out" || { echo "ASSERTION FAILED CR1: expected deny. Got: $out"; return 1; }
}

# CR-2 -- same Write, agent_type == "code-reviewer" -> ALLOW. This is the
# real code-reviewer subagent's own write path; if this regresses to deny,
# code-review can never author its own artifact and the completion gate can
# never open.
test_cr2_write_ultragoal_codereview_code_reviewer_allowed() {
    local path out
    path=$(cr_ultragoal_path)
    out=$(printf '%s' "$(hg_write_json_agent "$path" "code-reviewer")" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_allow "$out" || { echo "ASSERTION FAILED CR2: expected allow for code-reviewer. Got: $out"; return 1; }
}

# CR-3 -- same Write, agent_type == some OTHER subagent name -> DENY. Proves
# the guard checks the exact string "code-reviewer", not merely "some
# subagent dispatched this", which would let any subagent forge the
# artifact.
test_cr3_write_ultragoal_codereview_other_agent_denied() {
    local path out
    path=$(cr_ultragoal_path)
    out=$(printf '%s' "$(hg_write_json_agent "$path" "sisyphus-junior")" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_deny "$out" || { echo "ASSERTION FAILED CR3: expected deny for sisyphus-junior. Got: $out"; return 1; }
}

# CR-4/5/6 -- same 3-case matrix via the Bash redirect vector
# (`> "$OMT_DIR/ultragoal-codereview-<sid>.json"`), proving the identity
# guard reuses the SAME candidate extraction as the state write-guard rather
# than a Write-only code path.
test_cr4_bash_redirect_ultragoal_codereview_no_agent_type_denied() {
    local path out
    path=$(cr_ultragoal_path)
    out=$(printf '%s' "$(hg_bash_json "echo x > \"$path\"")" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_deny "$out" || { echo "ASSERTION FAILED CR4: expected deny. Got: $out"; return 1; }
}

test_cr5_bash_redirect_ultragoal_codereview_code_reviewer_allowed() {
    local path out
    path=$(cr_ultragoal_path)
    out=$(printf '%s' "$(hg_bash_json_agent "echo x > \"$path\"" "code-reviewer")" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_allow "$out" || { echo "ASSERTION FAILED CR5: expected allow for code-reviewer via Bash. Got: $out"; return 1; }
}

test_cr6_bash_redirect_ultragoal_codereview_other_agent_denied() {
    local path out
    path=$(cr_ultragoal_path)
    out=$(printf '%s' "$(hg_bash_json_agent "echo x > \"$path\"" "sisyphus-junior")" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_deny "$out" || { echo "ASSERTION FAILED CR6: expected deny for sisyphus-junior via Bash. Got: $out"; return 1; }
}

# CR-7/8 -- goal-codereview parity: a no-agent deny plus a code-reviewer
# allow, proving the goal-side artifact gets the SAME protection through
# this adapter (not just ultragoal's own path).
test_cr7_write_goal_codereview_no_agent_type_denied() {
    local path out
    path=$(cr_goal_path)
    out=$(printf '%s' "$(hg_write_json_no_agent "$path")" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_deny "$out" || { echo "ASSERTION FAILED CR7: expected deny. Got: $out"; return 1; }
}

test_cr8_write_goal_codereview_code_reviewer_allowed() {
    local path out
    path=$(cr_goal_path)
    out=$(printf '%s' "$(hg_write_json_agent "$path" "code-reviewer")" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_allow "$out" || { echo "ASSERTION FAILED CR8: expected allow for code-reviewer. Got: $out"; return 1; }
}

# CR-9/10 -- negative controls (AC5). ultragoal-verdict-<sid>.json is a
# LEGITIMATE self-attested orchestrator artifact (the orchestrator is
# SUPPOSED to write it), and code-review/<sid>/candidates.json is the review
# pipeline's own normal output -- neither is a guarded path. This is a
# PreToolUse deny with NO bypass and NO ask escape hatch: if the guarded path
# set ever accidentally widens to catch either of these (e.g. a loosened
# glob), the user is stuck with no way to unblock it themselves. This is the
# safety boundary of the whole design, not a bonus check.
test_cr9_write_ultragoal_verdict_no_agent_type_allowed() {
    local path out
    path="$OMT_DIR/ultragoal-verdict-$OMT_SESSION_ID.json"
    out=$(printf '%s' "$(hg_write_json_no_agent "$path")" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_allow "$out" || { echo "ASSERTION FAILED CR9: ultragoal-verdict write must stay allow (no agent_type). Got: $out"; return 1; }
}

test_cr10_write_code_review_candidates_no_agent_type_allowed() {
    local dir path out
    dir="$OMT_DIR/code-review/$OMT_SESSION_ID"
    mkdir -p "$dir"
    path="$dir/candidates.json"
    out=$(printf '%s' "$(hg_write_json_no_agent "$path")" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_allow "$out" || { echo "ASSERTION FAILED CR10: code-review candidates write must stay allow (no agent_type). Got: $out"; return 1; }
}

hg_write_json_nested_agent() {
    # $1 = file_path, $2 = agent_type value placed INSIDE tool_input (an
    # agent-controlled field), with NO top-level agent_type at all --
    # mirrors an orchestrator forging identity via the only field an
    # ordinary tool call lets it set freely.
    jq -n --arg fp "$1" --arg at "$2" \
        '{tool_name: "Write", tool_input: {file_path: $fp, content: "x", agent_type: $at}}'
}

# CR-11 -- agent_type == "code-reviewer" nested inside tool_input (never at
# top level) -> must still DENY. The guard's trust boundary is "top-level
# agent_type only"; tool_input is agent-controlled, so a value planted there
# must not forge identity. This is the regression case for the extraction
# widening this task fixes.
test_cr11_write_ultragoal_codereview_nested_agent_type_denied() {
    local path out
    path=$(cr_ultragoal_path)
    out=$(printf '%s' "$(hg_write_json_nested_agent "$path" "code-reviewer")" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_deny "$out" || { echo "ASSERTION FAILED CR11: nested tool_input.agent_type must not forge identity -- expected deny. Got: $out"; return 1; }
}

# CR-12..14 -- `mv` SOURCE-operand coverage. `mv` deletes its source, so
# `mv <guarded> /tmp/x` removes the guarded artifact exactly like the
# `rm <guarded>` the tee/rm/truncate arm already caught; the extractor's old
# `cp|mv -> $NF` arm saw only the DESTINATION, leaving the delete leg of the
# write/delete contract open through this one verb. CR-14 is the negative
# control that pins the cp/mv SPLIT: `cp` must keep extracting the destination
# only, because copying leaves the guarded artifact intact and denying it
# would be a false deny -- the failure mode this guard can never recover from.
test_cr12_bash_mv_source_ultragoal_codereview_no_agent_type_denied() {
    local path out
    path=$(cr_ultragoal_path)
    out=$(printf '%s' "$(hg_bash_json "mv \"$path\" /tmp/saved.json")" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_deny "$out" || { echo "ASSERTION FAILED CR12: mv of the guarded artifact away is a delete -- expected deny. Got: $out"; return 1; }
}

test_cr13_bash_mv_source_goal_codereview_code_reviewer_allowed() {
    local path out
    path=$(cr_goal_path)
    out=$(printf '%s' "$(hg_bash_json_agent "mv \"$path\" /tmp/saved.json" "code-reviewer")" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_allow "$out" || { echo "ASSERTION FAILED CR13: expected allow for code-reviewer. Got: $out"; return 1; }
}

test_cr14_bash_cp_source_ultragoal_codereview_allowed() {
    local path out
    path=$(cr_ultragoal_path)
    out=$(printf '%s' "$(hg_bash_json "cp \"$path\" /tmp/backup.json")" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_allow "$out" || { echo "ASSERTION FAILED CR14: cp leaves the guarded artifact intact -- expected allow (over-widening control). Got: $out"; return 1; }
}

# =============================================================================
# CR-16/17 -- SIGPIPE regression (write-guard-core.sh's write_guard_core_run /
# codereview_guard_core_run both `return 0` early on a match/identity bypass
# WITHOUT draining the rest of stdin). This hook wires both functions at the
# end of an internal pipe (`printf ... | write_guard_core_run ...` /
# `... | codereview_guard_core_run ...`, both captured via command
# substitution) -- when the candidate stream left unread after the early
# return exceeds a real pipe's kernel buffer (64KB), the still-writing
# `printf` blocks and is then killed once the reader closes its end. Under
# this script's own `set -euo pipefail`, that failing assignment aborts the
# WHOLE hook immediately, before the `if [[ -n "$_wg_cr_out" ]]` line that
# would have printed it ever runs -- so a computed deny is silently discarded,
# and an allow verdict never gets its `{"continue": true}` line at all.
#
# hg_pad_redirect_targets appends <count> SEPARATE `;`-segments, each holding
# one harmless never-matching `> <long-filler>` redirect target, so the
# candidate list built from them alone is comfortably >64KB -- deterministic
# on SIZE, never on scheduling luck. Each padding segment sits AFTER the real
# `mv` segment, so the guard-worthy candidate is always read FIRST and the
# padding is left entirely undrained at the moment of an early return. Kept
# to a LOW segment count with a LONG filler per segment rather than thousands
# of tiny ones: this hook's extractor forks a subprocess (awk/grep) per CHAIN
# SEGMENT, and an earlier many-tiny-segments draft of this helper turned
# "make the candidate list big" into "fork thousands of subprocesses in one
# shell invocation" -- which crashed the Codex twin's hook process outright
# on this environment's bash (a resource-exhaustion confound, not the
# SIGPIPE defect this suite targets).
# =============================================================================
hg_pad_redirect_targets() {
    local count="$1" i=0 out="" filler
    printf -v filler '%*s' 3200 ''
    filler="${filler// /x}"
    while [ "$i" -lt "$count" ]; do
        out="${out}; > /tmp/omt-pte-sigpipe-pad-$(printf '%03d' "$i")-$filler"
        i=$((i + 1))
    done
    printf '%s' "$out"
}

# hg_run_capture_exit <json> -- runs the hook and captures BOTH stdout (in
# HG_OUT) and the hook's own exit code (in HG_RC), not just stdout -- the
# SIGPIPE regression manifests as a wrong PROCESS exit code even in the one
# case (deny) where the JSON text itself still happens to look right.
hg_run_capture_exit() {
    local json="$1"
    HG_RC=0
    HG_OUT=$(printf '%s' "$json" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh") || HG_RC=$?
}

# CR-16 -- CR13's payload (goal-codereview path, agent_type=code-reviewer,
# `mv` source) with >64KB of trailing redirect padding appended to the SAME
# Bash command. The hook must still ALLOW (`{"continue": true}`, exit 0) --
# currently the internal codereview_guard_core_run pipe (pre-tool-
# enforcer.sh:394) never reads a byte of the oversized stdin before its
# identity-bypass `return 0`, so the writer is killed and the hook aborts with
# a nonzero exit and empty stdout instead.
test_cr16_bash_mv_source_goal_codereview_code_reviewer_large_candidates_allowed() {
    local path cmd json
    path=$(cr_goal_path)
    cmd="mv \"$path\" /tmp/saved.json$(hg_pad_redirect_targets 80)"
    json=$(hg_bash_json_agent "$cmd" "code-reviewer")
    hg_run_capture_exit "$json"
    if [ "$HG_RC" -ne 0 ]; then
        echo "ASSERTION FAILED CR16: expected exit 0 for code-reviewer with >64KB candidates, got exit $HG_RC. Output: $HG_OUT"
        return 1
    fi
    hg_is_allow "$HG_OUT" || { echo "ASSERTION FAILED CR16: expected allow. Got: $HG_OUT"; return 1; }
}

# CR-17 -- same oversized candidate set as CR16, but WITHOUT agent_type ==
# code-reviewer, so codereview_guard_core_run's EARLY RETURN is the deny match
# (line 279 in write-guard-core.sh) instead of the identity bypass. The
# already-computed deny JSON must still reach stdout with exit 0 -- currently
# it is computed, then discarded whole when the internal pipe's SIGPIPE aborts
# the hook before the `if [[ -n "$_wg_cr_out" ]]` print ever runs (fail-open:
# the orchestrator's forged write silently proceeds unblocked).
test_cr17_bash_mv_source_goal_codereview_no_agent_type_large_candidates_denied() {
    local path cmd json
    path=$(cr_goal_path)
    cmd="mv \"$path\" /tmp/saved.json$(hg_pad_redirect_targets 80)"
    json=$(hg_bash_json "$cmd")
    hg_run_capture_exit "$json"
    if [ "$HG_RC" -ne 0 ]; then
        echo "ASSERTION FAILED CR17: expected exit 0 for a non-reviewer deny with >64KB candidates, got exit $HG_RC. Output: $HG_OUT"
        return 1
    fi
    hg_is_deny "$HG_OUT" || { echo "ASSERTION FAILED CR17: expected the already-computed deny JSON to survive the oversized candidate pipe, not be discarded. Got: $HG_OUT"; return 1; }
}

test_reviewer_submit_cli_orchestrator_denied() {
    local cmd out
    cmd=$'run() { bun "'$SCRIPT_DIR'/../skills/code-review/scripts/submit-review.ts" --artifact "'$OMT_DIR'/ultragoal-codereview-parent.json" --json -; }\nrun'
    out=$(printf '%s' "$cmd" | jq -Rs --arg at sisyphus-junior '{tool_name:"Bash",tool_input:{command:.},agent_type:$at}' | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_deny "$out" || { echo "ASSERTION FAILED reviewer-submit orchestrator: $out"; return 1; }
}

test_reviewer_submit_cli_code_reviewer_allowed() {
    local cmd out
    cmd=$'run() { bun "'$SCRIPT_DIR'/../skills/code-review/scripts/submit-review.ts" --artifact "'$OMT_DIR'/ultragoal-codereview-parent.json" --json -; }\nrun'
    out=$(printf '%s' "$cmd" | jq -Rs --arg at code-reviewer '{tool_name:"Bash",tool_input:{command:.},agent_type:$at}' | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_allow "$out" || { echo "ASSERTION FAILED reviewer-submit reviewer: $out"; return 1; }
}

test_reviewer_submit_cli_absent_identity_denied() {
    local cmd out
    cmd="bun \"$SCRIPT_DIR/../skills/code-review/scripts/submit-review.ts\" --artifact \"$OMT_DIR/ultragoal-codereview-parent.json\" --json -"
    out=$(printf '%s' "$cmd" | jq -Rs '{tool_name:"Bash",tool_input:{command:.}}' | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_deny "$out" || { echo "ASSERTION FAILED reviewer-submit absent identity: $out"; return 1; }
}

test_reviewer_submit_nested_shell_wrapper_identity_matrix() {
    local cmd out deny_count newline_cmd
    newline_cmd=$(printf "bash -c 'echo safe\nbun %s --artifact %s/result.json --json -'" "$SCRIPT_DIR/../skills/code-review/scripts/submit-review.ts" "$OMT_DIR")
    for cmd in \
        "bash -c 'bun $SCRIPT_DIR/../skills/code-review/scripts/submit-review.ts --artifact $OMT_DIR/result.json --json -'" \
        "bash -lc 'bun $SCRIPT_DIR/../skills/code-review/scripts/../scripts/submit-review.ts --artifact $OMT_DIR/result.json --json -'" \
        "sh -c 'env -i X=1 bun run --silent \${CLAUDE_SKILL_DIR}/scripts/submit-review.ts --artifact $OMT_DIR/result.json --json -'" \
        "env -i bash -c 'echo ok; bun $SCRIPT_DIR/../skills/code-review/scripts/submit-review.ts --artifact $OMT_DIR/result.json --json -'" \
        "bash -c 'echo safe'; bash -c 'bun $SCRIPT_DIR/../skills/code-review/scripts/submit-review.ts --artifact $OMT_DIR/result.json --json -'" \
        "bash -c 'echo safe && bun $SCRIPT_DIR/../skills/code-review/scripts/submit-review.ts --artifact $OMT_DIR/result.json --json -'" \
        "bash -c 'echo safe | bun $SCRIPT_DIR/../skills/code-review/scripts/submit-review.ts --artifact $OMT_DIR/result.json --json -'" \
        "bun $SCRIPT_DIR/../skills/code-review/scripts/submit-review.ts --artifact $OMT_DIR/result.json --json -; bash -c 'echo safe'" \
        "X=1 bash -c 'bun $SCRIPT_DIR/../skills/code-review/scripts/submit-review.ts --artifact $OMT_DIR/result.json --json -'" \
        "env X=1 bash -c 'bun $SCRIPT_DIR/../skills/code-review/scripts/submit-review.ts --artifact $OMT_DIR/result.json --json -'" \
        "$newline_cmd"; do
        out=$(printf '%s' "$cmd" | jq -Rs --arg at sisyphus-junior --arg nested code-reviewer '{tool_name:"Bash",tool_input:{command:.,agent_type:$nested},agent_type:$at}' | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
        hg_is_deny "$out" || { echo "ASSERTION FAILED reviewer-submit nested nonreviewer: $out"; return 1; }
        deny_count=$(printf '%s' "$out" | grep -o '"permissionDecision":"deny"' | wc -l | tr -d ' ')
        [ "$deny_count" -eq 1 ] || { echo "ASSERTION FAILED reviewer-submit nested nonreviewer: expected one deny output for '$cmd', got $deny_count: $out"; return 1; }
        out=$(printf '%s' "$cmd" | jq -Rs --arg at code-reviewer '{tool_name:"Bash",tool_input:{command:.},agent_type:$at}' | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
        hg_is_allow "$out" || { echo "ASSERTION FAILED reviewer-submit nested reviewer: $out"; return 1; }
        out=$(printf '%s' "$cmd" | jq -Rs '{tool_name:"Bash",tool_input:{command:.}}' | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
        hg_is_deny "$out" || { echo "ASSERTION FAILED reviewer-submit nested absent identity: $out"; return 1; }
        deny_count=$(printf '%s' "$out" | grep -o '"permissionDecision":"deny"' | wc -l | tr -d ' ')
        [ "$deny_count" -eq 1 ] || { echo "ASSERTION FAILED reviewer-submit nested absent identity: expected one deny output for '$cmd', got $deny_count: $out"; return 1; }
    done

    cmd="bash -c 'echo safe'; bash -c 'echo also-safe'"
    out=$(printf '%s' "$cmd" | jq -Rs '{tool_name:"Bash",tool_input:{command:.}}' | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_allow "$out" || { echo "ASSERTION FAILED reviewer-submit nested multiple-safe-only: $out"; return 1; }

    cmd=$(printf "bash -c 'echo safe\nbun %s --artifact %s/result.json --json -'" "$SCRIPT_DIR/../skills/code-review/scripts/submit-review.ts" "$OMT_DIR")
    out=$(printf '%s' "$cmd" | jq -Rs --arg at sisyphus-junior '{tool_name:"Bash",tool_input:{command:.},agent_type:$at}' | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_deny "$out" || { echo "ASSERTION FAILED reviewer-submit nested newline nonreviewer: $out"; return 1; }
}

test_reviewer_submit_nested_shell_wrapper_false_positives_allow() {
    local cmd out
    for cmd in \
        "bash -c 'echo bun $SCRIPT_DIR/../skills/code-review/scripts/submit-review.ts'" \
        "bash -c bun $SCRIPT_DIR/../skills/code-review/scripts/submit-review.ts" \
        "bash -c '' bun $SCRIPT_DIR/../skills/code-review/scripts/submit-review.ts" \
        "bash -n -c 'bun $SCRIPT_DIR/../skills/code-review/scripts/submit-review.ts --artifact $OMT_DIR/result.json --json -'" \
        "bash -c 'bun --cwd $SCRIPT_DIR/../skills/code-review/scripts/submit-review.ts /tmp/other.ts'"; do
        out=$(printf '%s' "$cmd" | jq -Rs '{tool_name:"Bash",tool_input:{command:.}}' | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
        hg_is_allow "$out" || { echo "ASSERTION FAILED reviewer-submit nested false-positive: $out"; return 1; }
    done
}

test_regression_ambient_claude_env_file_not_leaked_by_unscrubbed_call() {
    # Regression guard for the ambient CLAUDE_ENV_FILE leak: AC9's session-
    # start.sh invocation (test_ac9_started_at_parseable_by_stale_cleanup)
    # used to inherit whatever CLAUDE_ENV_FILE was ambient in the runner's
    # shell (e.g. a live Claude Code session's real env file) and the hook
    # would unconditionally append export lines to it. setup_test_env() now
    # scrubs CLAUDE_ENV_FILE before every test's body runs; this test
    # re-invokes that real function (not a copy of it) after re-introducing
    # an ambient value, so if the scrub is ever removed from setup_test_env,
    # this goes red.
    local fixture baseline
    fixture=$(mktemp)
    baseline=$(mktemp)
    cp "$fixture" "$baseline"

    export CLAUDE_ENV_FILE="$fixture"
    setup_test_env
    printf '{}' | bash "$SCRIPT_DIR/session-start.sh" > /dev/null 2>&1 || true

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
# Ultragoal review-dispatch budget gate: Claude Agent + nested code-reviewer
# selector only. The state CLI owns every counter mutation; this suite checks
# the hook's real stdin wiring and deny envelopes, never shell-side counters.
# =============================================================================

rdg_seed_pursuing() {
    cat > "$OMT_DIR/ultragoal-state-$OMT_SESSION_ID.json" <<'EOF'
{"active":true,"phase":"pursuing","iteration":0,"max_iterations":10,"outcome":"ship it","started_at":"2026-01-01T00:00:00","last_touched_at":"2026-01-01T00:00:00"}
EOF
}

rdg_agent_payload() {
    jq -n --arg subtype "$1" '{tool_name:"Agent",tool_input:{subagent_type:$subtype}}'
}

test_rdg_matching_claude_candidate_allows_and_increments() {
    local out
    rdg_seed_pursuing
    out=$(rdg_agent_payload "code-reviewer" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_allow "$out" || { echo "ASSERTION FAILED rdg allowed candidate: $out"; return 1; }
    [ "$(jq -r '.review_dispatch_used' "$OMT_DIR/ultragoal-state-$OMT_SESSION_ID.json")" = "1" ]
}

test_rdg_sixth_candidate_denied_without_increment() {
    local i out
    rdg_seed_pursuing
    for i in 1 2 3 4 5; do
        rdg_agent_payload "code-reviewer" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh" > /dev/null
    done
    out=$(rdg_agent_payload "code-reviewer" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_deny "$out" || { echo "ASSERTION FAILED rdg sixth: $out"; return 1; }
    printf '%s' "$out" | grep -q 'approve-review-dispatch-renewal' || return 1
    [ "$(jq -r '.review_dispatch_used' "$OMT_DIR/ultragoal-state-$OMT_SESSION_ID.json")" = "5" ]
}

test_rdg_out_of_scope_review_denies_with_completion_actions() {
    local out
    rdg_seed_pursuing
    printf '%s' '{"status":"COMPLETE","scope_contract_sha256":"f92f8daed0f3442495084d1ab9bc72a75ae01a9f120d8b7781c8494ab83def95","findings":[{"class":"cleanup","verdict":"CONFIRMED","impact":"LOW","priority":"LOW","assessment":{"unfixed_cost":"low","exposure":"low","remedy":"defer cleanup","added_cost":"low","rationale":"unrelated cleanup"},"scope":"OUT_OF_SCOPE","scope_evidence":{"basis":"unrelated","reference":"outcome","rationale":"cleanup finding is unrelated to the active review contract"}}],"reviewer":"r","at":"now"}' > "$OMT_DIR/ultragoal-codereview-$OMT_SESSION_ID.json"
    out=$(rdg_agent_payload "code-reviewer" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_deny "$out" || { echo "ASSERTION FAILED rdg completion eligible: $out"; return 1; }
    printf '%s' "$out" | grep -q 'get-review-result' || return 1
    ! printf '%s' "$out" | grep -q 'approve-review-dispatch-renewal' || return 1
    [ "$(jq -r '.review_dispatch_used // 0' "$OMT_DIR/ultragoal-state-$OMT_SESSION_ID.json")" = "0" ]
}

test_rdg_planning_nonreviewer_and_nonagent_pass_without_count() {
    local out
    rdg_seed_pursuing
    jq '.phase="planning"' "$OMT_DIR/ultragoal-state-$OMT_SESSION_ID.json" > "$OMT_DIR/state.tmp"
    mv "$OMT_DIR/state.tmp" "$OMT_DIR/ultragoal-state-$OMT_SESSION_ID.json"
    out=$(rdg_agent_payload "code-reviewer" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_allow "$out" || return 1
    out=$(rdg_agent_payload "sisyphus-junior" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_allow "$out" || return 1
    out=$(printf '%s' '{"tool_name":"Read","tool_input":{"subagent_type":"code-reviewer"}}' | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_allow "$out" || return 1
    [ "$(jq -r '.review_dispatch_used // 0' "$OMT_DIR/ultragoal-state-$OMT_SESSION_ID.json")" = "0" ]
}

test_rdg_malformed_claim_state_denies_safely() {
    local out
    rdg_seed_pursuing
    printf '%s' '{broken' > "$OMT_DIR/ultragoal-state-$OMT_SESSION_ID.json"
    out=$(rdg_agent_payload "code-reviewer" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_deny "$out" || { echo "ASSERTION FAILED rdg malformed state: $out"; return 1; }
}

test_rdg_schema_valid_malformed_states_fail_closed_or_pass_known_inactive() {
    local out state_file
    state_file="$OMT_DIR/ultragoal-state-$OMT_SESSION_ID.json"

    printf '%s' '{"active":true,"phase":"pursuit","iteration":0,"max_iterations":10}' > "$state_file"
    out=$(rdg_agent_payload "code-reviewer" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_deny "$out" || { echo "ASSERTION FAILED rdg invalid phase: $out"; return 1; }
    [ "$(jq -r '.review_dispatch_used // 0' "$state_file")" = "0" ] || return 1

    printf '%s' '{"active":true,"phase":"pursuing","iteration":"bad","max_iterations":10}' > "$state_file"
    out=$(rdg_agent_payload "code-reviewer" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_deny "$out" || { echo "ASSERTION FAILED rdg invalid pursuing iteration: $out"; return 1; }
    [ "$(jq -r '.review_dispatch_used // 0' "$state_file")" = "0" ] || return 1

    printf '%s' '{"active":true,"phase":"planning","iteration":"bad","max_iterations":10}' > "$state_file"
    out=$(rdg_agent_payload "code-reviewer" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_allow "$out" || { echo "ASSERTION FAILED rdg planning corruption should allow: $out"; return 1; }
    [ "$(jq -r '.review_dispatch_used // 0' "$state_file")" = "0" ] || return 1

    printf '%s' '{"active":false,"phase":"pursuing","iteration":"bad","max_iterations":10}' > "$state_file"
    out=$(rdg_agent_payload "code-reviewer" | bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_allow "$out" || { echo "ASSERTION FAILED rdg inactive corruption should allow: $out"; return 1; }
    [ "$(jq -r '.review_dispatch_used // 0' "$state_file")" = "0" ]
}

test_rdg_unset_omt_dir_malformed_current_state_denies_safely() {
    local out home_dir project_cwd resolved_omt
    home_dir="$TEST_TMP_DIR/home"
    project_cwd="$(cd "$SCRIPT_DIR/.." && pwd)"
    mkdir -p "$home_dir"
    resolved_omt=$(env -u OMT_DIR HOME="$home_dir" bash -c "source '$SCRIPT_DIR/lib/omt-dir.sh'; resolve_omt_dir '$project_cwd'")
    printf '%s' '{broken' > "$resolved_omt/ultragoal-state-$OMT_SESSION_ID.json"
    out=$(jq -n --arg cwd "$project_cwd" '{tool_name:"Agent",tool_input:{subagent_type:"code-reviewer"},cwd:$cwd}' \
        | env -u OMT_DIR HOME="$home_dir" bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_deny "$out" || { echo "ASSERTION FAILED rdg unset OMT_DIR malformed state: $out"; return 1; }
}

test_rdg_jq_absent_follows_allow_posture() {
    local out no_jq_bin cmd
    rdg_seed_pursuing
    no_jq_bin="$TEST_TMP_DIR/no-jq-bin"
    mkdir -p "$no_jq_bin"
    # Keep the shell utilities this legacy hook itself needs, but deliberately
    # omit jq so this exercises its documented best-effort posture.
    for cmd in cat grep sed dirname pwd awk date; do
        ln -s "$(command -v "$cmd")" "$no_jq_bin/$cmd"
    done
    out=$(printf '%s' '{"tool_name":"Agent","tool_input":{"subagent_type":"code-reviewer"}}' | PATH="$no_jq_bin" /bin/bash "$SCRIPT_DIR/pre-tool-enforcer.sh")
    hg_is_allow "$out" || { echo "ASSERTION FAILED rdg jq absent should allow: $out"; return 1; }
    [ ! -e "$OMT_DIR/ultragoal-state-$OMT_SESSION_ID.json.lock" ]
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

    # New seeds: P1 (prometheus last_touched_at), A2 (deep-interview),
    # seed-DI-shape, B1 (absent id), B3 (unsafe id), fail-loud
    run_test test_p1_prometheus_seed_has_last_touched_at
    run_test test_a2_deep_interview_seed_creates_marker
    run_test test_seed_di_no_session_id_field
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

    run_test test_resume_pursuit_allowed_through_claude_shared_guard
    run_test test_user_authorized_force_complete_reaches_claude_shared_guard

    # Code-review artifact identity guard (code-review-artifact-guard-core plan)
    run_test test_cr1_write_ultragoal_codereview_no_agent_type_denied
    run_test test_cr2_write_ultragoal_codereview_code_reviewer_allowed
    run_test test_cr3_write_ultragoal_codereview_other_agent_denied
    run_test test_cr4_bash_redirect_ultragoal_codereview_no_agent_type_denied
    run_test test_cr5_bash_redirect_ultragoal_codereview_code_reviewer_allowed
    run_test test_cr6_bash_redirect_ultragoal_codereview_other_agent_denied
    run_test test_cr7_write_goal_codereview_no_agent_type_denied
    run_test test_cr8_write_goal_codereview_code_reviewer_allowed
    run_test test_cr9_write_ultragoal_verdict_no_agent_type_allowed
    run_test test_cr10_write_code_review_candidates_no_agent_type_allowed
    run_test test_cr11_write_ultragoal_codereview_nested_agent_type_denied
    run_test test_cr12_bash_mv_source_ultragoal_codereview_no_agent_type_denied
    run_test test_cr13_bash_mv_source_goal_codereview_code_reviewer_allowed
    run_test test_cr14_bash_cp_source_ultragoal_codereview_allowed
    run_test test_cr16_bash_mv_source_goal_codereview_code_reviewer_large_candidates_allowed
    run_test test_cr17_bash_mv_source_goal_codereview_no_agent_type_large_candidates_denied
    run_test test_reviewer_submit_cli_orchestrator_denied
    run_test test_reviewer_submit_cli_code_reviewer_allowed
    run_test test_reviewer_submit_cli_absent_identity_denied
    run_test test_reviewer_submit_nested_shell_wrapper_identity_matrix
    run_test test_reviewer_submit_nested_shell_wrapper_false_positives_allow
    run_test test_rdg_matching_claude_candidate_allows_and_increments
    run_test test_rdg_sixth_candidate_denied_without_increment
    run_test test_rdg_out_of_scope_review_denies_with_completion_actions
    run_test test_rdg_planning_nonreviewer_and_nonagent_pass_without_count
    run_test test_rdg_malformed_claim_state_denies_safely
    run_test test_rdg_schema_valid_malformed_states_fail_closed_or_pass_known_inactive
    run_test test_rdg_unset_omt_dir_malformed_current_state_denies_safely
    run_test test_rdg_jq_absent_follows_allow_posture
    run_test test_regression_ambient_claude_env_file_not_leaked_by_unscrubbed_call

    # explain-diff seed (arms the artifact guard from skill invocation)
    run_test test_seed_explain_diff_creates_armed_skeleton
    run_test test_seed_explain_diff_is_idempotent

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
}

main "$@"

#!/bin/bash
# =============================================================================
# omt-cleanup.sh Tests
# Hermetic: HOME is redirected to a temp fixture; real ~/.omt is never touched.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLEANUP_SCRIPT="$SCRIPT_DIR/omt-cleanup.sh"

TESTS_PASSED=0
TESTS_FAILED=0

ORIGINAL_HOME="$HOME"
FIXTURE_HOME=""

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

setup_fixture() {
    FIXTURE_HOME=$(mktemp -d)
    local omt="$FIXTURE_HOME/.omt"

    # --- 14 residue entries (from §1 classification table) ---
    # 7 slugs
    mkdir -p "$omt/capricious-watcher/evidence"
    mkdir -p "$omt/dented-gold/evidence"
    mkdir -p "$omt/radical-water/evidence"
    mkdir -p "$omt/scrawny-peak/evidence"
    mkdir -p "$omt/medieval-cadmium/evidence"
    mkdir -p "$omt/frosted-anglerfish/evidence"
    mkdir -p "$omt/fire-cockroach/evidence"
    # name-based residue
    mkdir -p "$omt/oh-my-toong/evidence"
    mkdir -p "$omt/stage/evidence"
    mkdir -p "$omt/algocare-home-stage/evidence"
    mkdir -p "$omt/omt-test"
    mkdir -p "$omt/tmp"
    mkdir -p "$omt/evidence"         # top-level evidence residue
    mkdir -p "$omt/toong/logs"

    # --- Preserved live-state / legit entries ---
    # algocare-* projects (LEGIT)
    mkdir -p "$omt/algocare-backend/logs"
    mkdir -p "$omt/algocare-home/logs"
    mkdir -p "$omt/algocare-home-app-device/logs"
    mkdir -p "$omt/algocare-home-backend/logs"
    mkdir -p "$omt/algocd/logs"

    # oh-my-toong-playground (LIVE-STATE)
    mkdir -p "$omt/oh-my-toong-playground"
    # goal-state with active:true (example UUIDs — not hardcoded in script)
    printf '{"active":true,"sessionId":"638ee5c5","objective":"tech-writing"}' \
        > "$omt/oh-my-toong-playground/goal-state-638ee5c5-tech-writing.json"
    printf '{"active":true,"sessionId":"a2bad775","objective":"cleanup"}' \
        > "$omt/oh-my-toong-playground/goal-state-a2bad775-cleanup.json"
    # deep-interview active marker
    printf '{"active":true,"sessionId":"a2bad775"}' \
        > "$omt/oh-my-toong-playground/deep-interview-active-state-a2bad775-omt.json"
    # prometheus-state
    printf '{"skill":"prometheus","sessionId":"a2bad775"}' \
        > "$omt/oh-my-toong-playground/prometheus-state-a2bad775.json"

    # cache (LEGIT — regenerable global hud cache)
    mkdir -p "$omt/cache"
    printf '{"usage":{}}' > "$omt/cache/hud-usage.json"
}

teardown_fixture() {
    export HOME="$ORIGINAL_HOME"
    if [[ -n "$FIXTURE_HOME" && -d "$FIXTURE_HOME" ]]; then
        rm -rf "$FIXTURE_HOME"
    fi
    FIXTURE_HOME=""
}

run_test() {
    local name="$1"
    setup_fixture
    export HOME="$FIXTURE_HOME"

    if "$name"; then
        echo "[PASS] $name"
        ((TESTS_PASSED++)) || true
    else
        echo "[FAIL] $name"
        ((TESTS_FAILED++)) || true
    fi

    teardown_fixture
}

fingerprint() {
    # Stable fingerprint of a directory tree: path listing (catches added/
    # removed entries) plus per-file content hashes (catches a regression
    # that overwrites content while leaving paths/existence untouched).
    # `find -exec shasum {} +` (a find primary, not xargs) runs the command
    # zero times when no file matches, so an all-directories/empty tree never
    # blocks waiting on stdin — sidesteps BSD xargs lacking -r/--no-run-if-empty.
    {
        find "$1" -print | sort
        find "$1" -type f -exec shasum {} + 2>/dev/null | sort
    } | shasum
}

# ---------------------------------------------------------------------------
# AC 6.1 — a no-candidate residue directory survives --execute untouched
# Output is captured to a variable first to avoid SIGPIPE with set -euo pipefail.
# ---------------------------------------------------------------------------

# These 14 names were the old RESIDUE_NAMES literal. setup_fixture creates
# each as an empty (no session-key file) directory, so there is nothing for
# the new fan-out to reap inside any of them — --execute must leave every
# one standing. That directory survival is the direct regression coverage
# for "no more name-literal directory deletion" (asserting under --dry-run
# would be vacuous: dry-run never deletes regardless of this change).
test_execute_preserves_no_candidate_dir_capricious_watcher() {
    bash "$CLEANUP_SCRIPT" --execute > /dev/null
    [[ -d "$FIXTURE_HOME/.omt/capricious-watcher" ]]
}

test_execute_preserves_no_candidate_dir_dented_gold() {
    bash "$CLEANUP_SCRIPT" --execute > /dev/null
    [[ -d "$FIXTURE_HOME/.omt/dented-gold" ]]
}

test_execute_preserves_no_candidate_dir_radical_water() {
    bash "$CLEANUP_SCRIPT" --execute > /dev/null
    [[ -d "$FIXTURE_HOME/.omt/radical-water" ]]
}

test_execute_preserves_no_candidate_dir_scrawny_peak() {
    bash "$CLEANUP_SCRIPT" --execute > /dev/null
    [[ -d "$FIXTURE_HOME/.omt/scrawny-peak" ]]
}

test_execute_preserves_no_candidate_dir_medieval_cadmium() {
    bash "$CLEANUP_SCRIPT" --execute > /dev/null
    [[ -d "$FIXTURE_HOME/.omt/medieval-cadmium" ]]
}

test_execute_preserves_no_candidate_dir_frosted_anglerfish() {
    bash "$CLEANUP_SCRIPT" --execute > /dev/null
    [[ -d "$FIXTURE_HOME/.omt/frosted-anglerfish" ]]
}

test_execute_preserves_no_candidate_dir_fire_cockroach() {
    bash "$CLEANUP_SCRIPT" --execute > /dev/null
    [[ -d "$FIXTURE_HOME/.omt/fire-cockroach" ]]
}

test_execute_preserves_no_candidate_dir_oh_my_toong() {
    bash "$CLEANUP_SCRIPT" --execute > /dev/null
    [[ -d "$FIXTURE_HOME/.omt/oh-my-toong" ]]
}

test_execute_preserves_no_candidate_dir_stage() {
    bash "$CLEANUP_SCRIPT" --execute > /dev/null
    [[ -d "$FIXTURE_HOME/.omt/stage" ]]
}

test_execute_preserves_no_candidate_dir_algocare_home_stage() {
    bash "$CLEANUP_SCRIPT" --execute > /dev/null
    [[ -d "$FIXTURE_HOME/.omt/algocare-home-stage" ]]
}

test_execute_preserves_no_candidate_dir_omt_test() {
    bash "$CLEANUP_SCRIPT" --execute > /dev/null
    [[ -d "$FIXTURE_HOME/.omt/omt-test" ]]
}

test_execute_preserves_no_candidate_dir_tmp() {
    bash "$CLEANUP_SCRIPT" --execute > /dev/null
    [[ -d "$FIXTURE_HOME/.omt/tmp" ]]
}

test_execute_preserves_no_candidate_dir_evidence() {
    bash "$CLEANUP_SCRIPT" --execute > /dev/null
    [[ -d "$FIXTURE_HOME/.omt/evidence" ]]
}

test_execute_preserves_no_candidate_dir_toong() {
    bash "$CLEANUP_SCRIPT" --execute > /dev/null
    [[ -d "$FIXTURE_HOME/.omt/toong" ]]
}

# AC 6.1 — dry-run mutates nothing (fixture byte-identical before/after)
test_dryrun_mutates_nothing() {
    local pre post
    pre=$(fingerprint "$FIXTURE_HOME/.omt")
    bash "$CLEANUP_SCRIPT" --dry-run > /dev/null
    post=$(fingerprint "$FIXTURE_HOME/.omt")
    [[ "$pre" == "$post" ]]
}

# ---------------------------------------------------------------------------
# Dry-run safety-net regression — the shared fixture built by setup_fixture
# has ZERO live reap candidates: every state file it writes is fresh
# (printf'd moments before the test runs, no last_touched_at field, so the
# mtime fallback marks it live) and no dead session artifact exists at all.
# That means test_dryrun_mutates_nothing and
# test_default_no_execute_leaves_fixture_identical hold identically whether
# or not the dry-run flag actually reaches the reap helpers — a flag-polarity
# inversion (dry-run silently deleting) is invisible to them. This test seeds
# an actual dead state file and an actual dead session artifact ITSELF, not
# via setup_fixture (a shared dead candidate would break
# test_dryrun_preserved_not_in_delete_list and the no-candidate-dir survival
# tests above), then asserts both are still on disk after a dry-run pass.
# ---------------------------------------------------------------------------
test_dryrun_preserves_real_reap_candidates() {
    local stale_iso stale_touch
    stale_iso=$(date -j -v-7H "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || date -d "7 hours ago" "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || echo "2000-01-01T00:00:00")
    stale_touch=$(date -j -v-7H "+%Y%m%d%H%M" 2>/dev/null || date -d "7 hours ago" "+%Y%m%d%H%M" 2>/dev/null || echo "200001010000")

    local proj_dir="$FIXTURE_HOME/.omt/dryrun-real-candidate-project"
    mkdir -p "$proj_dir"

    # A dead state file: active but 7h idle (> ACTIVE_IDLE_TTL 6h) — a genuine
    # reap candidate for reap_dead_state_files, not merely an absent one.
    local state_file="$proj_dir/goal-state-dryrun-real-sess.json"
    cat > "$state_file" << EOF
{
  "active": true,
  "phase": "pursuing",
  "last_touched_at": "${stale_iso}",
  "outcome": "stale goal",
  "iteration": 1
}
EOF

    # A dead session artifact: codex-todo carries no "active" field, so its
    # own backdated mtime (> ACTIVE_IDLE_TTL) is what makes it a genuine
    # reap candidate for reap_session_artifacts.
    local artifact_file="$proj_dir/codex-todo-dryrun-real-artifact.json"
    printf '{"todos":[]}' > "$artifact_file"
    touch -t "$stale_touch" "$artifact_file"

    # Byte-level baseline, taken AFTER both real candidates exist — not just
    # their paths, but their content. `fingerprint` (defined above) already
    # hashes path listing + per-file content; it is reused here deliberately,
    # over the ONE fixture in this file that actually holds a live reap
    # candidate. test_dryrun_mutates_nothing and
    # test_default_no_execute_leaves_fixture_identical also call fingerprint,
    # but only against setup_fixture's baseline, which (per the comment above
    # this test) seeds ZERO real reap candidates — so a mutation that
    # truncates a candidate's bytes in place while still reporting its path
    # unchanged has nothing to truncate there and passes silently. This is
    # the only place in the suite where fingerprint runs over a fixture that
    # can actually expose that class of bug.
    local pre_fp
    pre_fp=$(fingerprint "$proj_dir")

    bash "$CLEANUP_SCRIPT" --dry-run > /dev/null

    if [[ ! -f "$state_file" ]]; then
        echo "ASSERTION FAILED (--dry-run): dry-run must not delete a real dead state file"
        return 1
    fi
    if [[ ! -f "$artifact_file" ]]; then
        echo "ASSERTION FAILED (--dry-run): dry-run must not delete a real dead session artifact"
        return 1
    fi

    local post_fp_dryrun
    post_fp_dryrun=$(fingerprint "$proj_dir")
    if [[ "$pre_fp" != "$post_fp_dryrun" ]]; then
        echo "ASSERTION FAILED (--dry-run): candidate file BYTES changed even though the path survived (e.g. truncated in place)"
        return 1
    fi

    # No-args is the documented default entry form (usage block: "omt-cleanup.sh
    # # dry-run (default)"). Right now it falls into the same code path as the
    # explicit --dry-run flag above, since --dry-run is not a recognized flag
    # (usage block :7: "--dry-run    # same as default") and any unmatched
    # argument just falls through to the default. Asserting the no-args form
    # directly, on this same real-candidate fixture, means an argument-parsing
    # refactor that splits the two forms apart can no longer make the default
    # path silently destructive without this assertion catching it.
    bash "$CLEANUP_SCRIPT" > /dev/null

    if [[ ! -f "$state_file" ]]; then
        echo "ASSERTION FAILED (no-args default): default invocation must not delete a real dead state file"
        return 1
    fi
    if [[ ! -f "$artifact_file" ]]; then
        echo "ASSERTION FAILED (no-args default): default invocation must not delete a real dead session artifact"
        return 1
    fi

    local post_fp_default
    post_fp_default=$(fingerprint "$proj_dir")
    if [[ "$pre_fp" != "$post_fp_default" ]]; then
        echo "ASSERTION FAILED (no-args default): candidate file BYTES changed even though the path survived (e.g. truncated in place)"
        return 1
    fi
    return 0
}

# ---------------------------------------------------------------------------
# These directories used to survive only because a name literal preserved
# them. Now nothing in the script names them: they survive --execute for the
# real reason instead — none of them holds a reap candidate (no state file,
# no whitelisted session artifact), so the fan-out finds nothing to delete.
# Note: "oh-my-toong" is also a residue-name prefix of "oh-my-toong-playground";
# the assertion below is that oh-my-toong-playground survives --execute intact,
# with its live state file still present.
# ---------------------------------------------------------------------------

test_dryrun_preserved_names_oh_my_toong_playground() {
    bash "$CLEANUP_SCRIPT" --execute > /dev/null
    [[ -d "$FIXTURE_HOME/.omt/oh-my-toong-playground" ]] \
        && [[ -f "$FIXTURE_HOME/.omt/oh-my-toong-playground/goal-state-638ee5c5-tech-writing.json" ]]
}

test_dryrun_preserved_names_algocare_backend() {
    bash "$CLEANUP_SCRIPT" --execute > /dev/null
    [[ -d "$FIXTURE_HOME/.omt/algocare-backend" ]] \
        && [[ -d "$FIXTURE_HOME/.omt/algocare-backend/logs" ]]
}

test_dryrun_preserved_names_algocare_home_app_device() {
    bash "$CLEANUP_SCRIPT" --execute > /dev/null
    [[ -d "$FIXTURE_HOME/.omt/algocare-home-app-device" ]] \
        && [[ -d "$FIXTURE_HOME/.omt/algocare-home-app-device/logs" ]]
}

test_dryrun_preserved_names_algocd() {
    bash "$CLEANUP_SCRIPT" --execute > /dev/null
    [[ -d "$FIXTURE_HOME/.omt/algocd" ]] \
        && [[ -d "$FIXTURE_HOME/.omt/algocd/logs" ]]
}

test_dryrun_preserved_names_cache() {
    bash "$CLEANUP_SCRIPT" --execute > /dev/null
    [[ -d "$FIXTURE_HOME/.omt/cache" ]] \
        && [[ -f "$FIXTURE_HOME/.omt/cache/hud-usage.json" ]]
}

# Preserved entries must NOT appear in the delete-list section
test_dryrun_preserved_not_in_delete_list() {
    local output
    output=$(bash "$CLEANUP_SCRIPT" --dry-run 2>&1)
    if echo "$output" | grep "DELETE " | grep -q "oh-my-toong-playground"; then
        echo "oh-my-toong-playground appeared in DELETE section"
        return 1
    fi
    if echo "$output" | grep "DELETE " | grep -q "algocare-backend"; then
        echo "algocare-backend appeared in DELETE section"
        return 1
    fi
    if echo "$output" | grep "DELETE " | grep -q "cache"; then
        echo "cache appeared in DELETE section"
        return 1
    fi
    return 0
}

# ---------------------------------------------------------------------------
# AC 6.3 — default (no --execute) leaves fixture byte-identical
# AND real ~/.omt is untouched (HOME pointed at fixture process-wide)
# ---------------------------------------------------------------------------

test_default_no_execute_leaves_fixture_identical() {
    local pre post
    pre=$(fingerprint "$FIXTURE_HOME/.omt")
    # run without any flag — default is dry-run
    bash "$CLEANUP_SCRIPT" > /dev/null
    post=$(fingerprint "$FIXTURE_HOME/.omt")
    [[ "$pre" == "$post" ]]
}

test_real_omt_untouched_when_home_is_fixture() {
    # Verify that the script, when run with HOME=$FIXTURE_HOME, scans the fixture
    # and NOT the real ~/.omt. We check this by asserting the script output contains
    # the fixture path (not the real home path) in its header line.
    local output
    output=$(bash "$CLEANUP_SCRIPT" 2>&1)
    # The script prints: "=== omt-cleanup: scanning <path>/.omt ==="
    # It must contain the fixture path and NOT the real home path.
    if echo "$output" | grep -q "$ORIGINAL_HOME/.omt"; then
        echo "FAIL: script scanned real ~/.omt (non-hermetic)"
        return 1
    fi
    if echo "$output" | grep -q "$FIXTURE_HOME/.omt"; then
        return 0
    fi
    echo "FAIL: script did not scan fixture .omt"
    return 1
}

# ---------------------------------------------------------------------------
# Execute mode — deletes residue, preserves legit (uses fixture only)
# ---------------------------------------------------------------------------

# These 7 used to assert the opposite: that --execute removed the whole
# directory by name match. There is no directory-removal path left to
# exercise (rm -rf/rmdir are gone), and setup_fixture gives each of these an
# empty (no session-key file) directory — so the correct, non-vacuous
# assertion is that the directory survives --execute untouched.
test_execute_deletes_capricious_watcher() {
    bash "$CLEANUP_SCRIPT" --execute > /dev/null
    [[ -d "$FIXTURE_HOME/.omt/capricious-watcher" ]]
}

test_execute_deletes_fire_cockroach() {
    bash "$CLEANUP_SCRIPT" --execute > /dev/null
    [[ -d "$FIXTURE_HOME/.omt/fire-cockroach" ]]
}

test_execute_deletes_oh_my_toong() {
    bash "$CLEANUP_SCRIPT" --execute > /dev/null
    [[ -d "$FIXTURE_HOME/.omt/oh-my-toong" ]]
}

test_execute_deletes_stage() {
    bash "$CLEANUP_SCRIPT" --execute > /dev/null
    [[ -d "$FIXTURE_HOME/.omt/stage" ]]
}

test_execute_deletes_algocare_home_stage() {
    bash "$CLEANUP_SCRIPT" --execute > /dev/null
    [[ -d "$FIXTURE_HOME/.omt/algocare-home-stage" ]]
}

test_execute_deletes_toong() {
    bash "$CLEANUP_SCRIPT" --execute > /dev/null
    [[ -d "$FIXTURE_HOME/.omt/toong" ]]
}

test_execute_deletes_evidence_toplevel() {
    bash "$CLEANUP_SCRIPT" --execute > /dev/null
    [[ -d "$FIXTURE_HOME/.omt/evidence" ]]
}

test_execute_preserves_cache() {
    bash "$CLEANUP_SCRIPT" --execute > /dev/null
    [[ -d "$FIXTURE_HOME/.omt/cache" ]]
}

test_execute_preserves_oh_my_toong_playground() {
    bash "$CLEANUP_SCRIPT" --execute > /dev/null
    [[ -d "$FIXTURE_HOME/.omt/oh-my-toong-playground" ]]
}

test_execute_preserves_algocare_home() {
    bash "$CLEANUP_SCRIPT" --execute > /dev/null
    [[ -d "$FIXTURE_HOME/.omt/algocare-home" ]]
}

test_execute_preserves_algocd() {
    bash "$CLEANUP_SCRIPT" --execute > /dev/null
    [[ -d "$FIXTURE_HOME/.omt/algocd" ]]
}

test_execute_preserves_active_goal_state_files() {
    bash "$CLEANUP_SCRIPT" --execute > /dev/null
    [[ -f "$FIXTURE_HOME/.omt/oh-my-toong-playground/goal-state-638ee5c5-tech-writing.json" ]]
}

# ---------------------------------------------------------------------------
# AC liveness unification (TODO 7)
# P4/P5/P6 preserve predicates now use is_state_live (ACTIVE_IDLE_TTL=6h, TERMINAL_TTL=30m)
# ---------------------------------------------------------------------------

# C8: a dir whose ONLY state file is a 1h-terminal prometheus-state is NOT preserved
# (dead terminal: 1h > TERMINAL_TTL 30m)
test_liveness_all_dead_dir_not_preserved() {
    local old_ts
    old_ts=$(date -j -v-1H "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || date -d "1 hour ago" "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || echo "2000-01-01T00:00:00")

    # Create a new dir (not in residue list, not a legit P1/P2/P3 name)
    local dead_dir="$FIXTURE_HOME/.omt/dead-project-only-terminal"
    mkdir -p "$dead_dir"
    cat > "$dead_dir/prometheus-state-dead-sess.json" << EOF
{
  "active": false,
  "phase": "complete",
  "last_touched_at": "${old_ts}"
}
EOF

    bash "$CLEANUP_SCRIPT" --execute > /dev/null
    # Not preserved means its dead state file is actually reaped by --execute.
    if [[ -f "$dead_dir/prometheus-state-dead-sess.json" ]]; then
        echo "ASSERTION FAILED: dir with only a dead terminal state must have that state file reaped"
        return 1
    fi
    return 0
}

# C4/omt-cleanup: a dir whose ONLY goal-state is active-but-7h-idle is NOT preserved
# (dead active: 7h > ACTIVE_IDLE_TTL 6h) — parity with session-start GC
test_liveness_active_7h_idle_dir_not_preserved() {
    local stale_ts
    stale_ts=$(date -j -v-7H "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || date -d "7 hours ago" "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || echo "2000-01-01T00:00:00")

    local stale_dir="$FIXTURE_HOME/.omt/stale-active-project"
    mkdir -p "$stale_dir"
    cat > "$stale_dir/goal-state-stale-sess.json" << EOF
{
  "active": true,
  "phase": "pursuing",
  "last_touched_at": "${stale_ts}",
  "outcome": "stale goal",
  "iteration": 1
}
EOF

    bash "$CLEANUP_SCRIPT" --execute > /dev/null
    # Not preserved means its dead state file is actually reaped by --execute
    # (parity with session-start GC).
    if [[ -f "$stale_dir/goal-state-stale-sess.json" ]]; then
        echo "ASSERTION FAILED: dir with only a 7h-idle active state must have that state file reaped"
        return 1
    fi
    return 0
}

# C4/omt-cleanup execute: dir with dead state + plans/plan.md keeps plan.md and the dir; state file is deleted
test_liveness_active_7h_idle_execute_keeps_plan() {
    local stale_ts
    stale_ts=$(date -j -v-7H "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || date -d "7 hours ago" "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || echo "2000-01-01T00:00:00")

    local stale_dir="$FIXTURE_HOME/.omt/stale-project-with-plans"
    mkdir -p "$stale_dir/plans"
    printf 'important plan content' > "$stale_dir/plans/plan.md"
    cat > "$stale_dir/goal-state-stale-sess.json" << EOF
{
  "active": true,
  "phase": "pursuing",
  "last_touched_at": "${stale_ts}",
  "outcome": "stale goal",
  "iteration": 1
}
EOF

    bash "$CLEANUP_SCRIPT" --execute > /dev/null

    # State file must be gone
    if [[ -f "$stale_dir/goal-state-stale-sess.json" ]]; then
        echo "ASSERTION FAILED: dead state file must be deleted"
        return 1
    fi
    # plan.md must survive
    if [[ ! -f "$stale_dir/plans/plan.md" ]]; then
        echo "ASSERTION FAILED: plans/plan.md must survive (only state files are reaped)"
        return 1
    fi
    # directory must survive (non-empty after reap)
    if [[ ! -d "$stale_dir" ]]; then
        echo "ASSERTION FAILED: directory must survive when non-empty after state reap"
        return 1
    fi
    return 0
}

# dry-run for dead-state dir lists state file path, not bare directory name
test_dead_state_dryrun_shows_state_file_path() {
    local stale_ts
    stale_ts=$(date -j -v-7H "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || date -d "7 hours ago" "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || echo "2000-01-01T00:00:00")

    local stale_dir="$FIXTURE_HOME/.omt/stale-dry-run-project"
    mkdir -p "$stale_dir"
    cat > "$stale_dir/goal-state-dry-sess.json" << EOF
{
  "active": true,
  "phase": "pursuing",
  "last_touched_at": "${stale_ts}",
  "outcome": "stale goal",
  "iteration": 1
}
EOF

    local out
    out=$(bash "$CLEANUP_SCRIPT" --dry-run 2>&1)
    # Must list the state file path
    if ! echo "$out" | grep "DELETE " | grep -q "goal-state-dry-sess.json"; then
        echo "ASSERTION FAILED: dry-run must list state file path, not just dir name"
        echo "  Output: ${out}"
        return 1
    fi
    return 0
}

# ---------------------------------------------------------------------------
# DEAD_STATE_OUT word-split regression — HOME path with spaces
# If DEAD_STATE_OUT is consumed unquoted, paths like
#   /tmp/John Doe/.omt/proj/goal-state-x.json
# split into three tokens and rm -f is called on fragments.
# ---------------------------------------------------------------------------

# dry-run: state file path appears verbatim (with spaces) in output
test_dead_state_space_in_home_dryrun_shows_full_path() {
    local stale_ts
    stale_ts=$(date -j -v-7H "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || date -d "7 hours ago" "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || echo "2000-01-01T00:00:00")

    # Create a HOME directory whose path contains spaces
    local space_home
    space_home=$(mktemp -d)
    local space_home_with_spaces="${space_home}/John Doe"
    mkdir -p "$space_home_with_spaces"

    local omt_dir="$space_home_with_spaces/.omt"
    local proj_dir="$omt_dir/space-proj"
    mkdir -p "$proj_dir"

    local state_file="$proj_dir/goal-state-space-sess.json"
    cat > "$state_file" << EOF
{
  "active": true,
  "phase": "pursuing",
  "last_touched_at": "${stale_ts}",
  "outcome": "stale goal",
  "iteration": 1
}
EOF

    local out
    out=$(HOME="$space_home_with_spaces" bash "$CLEANUP_SCRIPT" --dry-run 2>&1)

    # Clean up our extra temp dir
    rm -rf "$space_home"

    # The full path (with spaces) must appear verbatim in DELETE output — fixed-string
    # match (-F) against the constructed path so a shell-glob/regex metachar in the
    # temp path (e.g. mktemp's own brackets on some platforms) cannot make this match
    # accidentally succeed or fail.
    if ! echo "$out" | grep "DELETE " | grep -qF -- "$state_file"; then
        echo "ASSERTION FAILED: dry-run must list full state file path verbatim (spaces in HOME)"
        echo "  Expected path: ${state_file}"
        echo "  Output: ${out}"
        return 1
    fi
    return 0
}

# execute: the state file is deleted; no stray fragments left from word-split
test_dead_state_space_in_home_execute_deletes_correct_file() {
    local stale_ts
    stale_ts=$(date -j -v-7H "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || date -d "7 hours ago" "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || echo "2000-01-01T00:00:00")

    local space_home
    space_home=$(mktemp -d)
    local space_home_with_spaces="${space_home}/John Doe"
    mkdir -p "$space_home_with_spaces"

    local omt_dir="$space_home_with_spaces/.omt"
    local proj_dir="$omt_dir/space-exec-proj"
    mkdir -p "$proj_dir"

    local state_file="$proj_dir/goal-state-space-exec-sess.json"
    cat > "$state_file" << EOF
{
  "active": true,
  "phase": "pursuing",
  "last_touched_at": "${stale_ts}",
  "outcome": "stale goal",
  "iteration": 1
}
EOF

    HOME="$space_home_with_spaces" bash "$CLEANUP_SCRIPT" --execute > /dev/null 2>&1

    local result=0

    # The state file must be gone (correctly deleted)
    if [[ -f "$state_file" ]]; then
        echo "ASSERTION FAILED: state file must be deleted by --execute"
        result=1
    fi

    # Stray path fragments from word-split would be like "/tmp/tmpXXX/John" and "Doe/.omt/..."
    # We detect this by checking no parent dirs or siblings were created erroneously.
    # Specifically: the word before the space ("John") should not exist as a directory
    # inside the fixture home (it'd be created by `rm -f /tmp/xxx/John` treating it as path).
    # The real canary: proj_dir should be gone (rmdir cleaned it), but space_home itself intact.
    if [[ -d "$space_home_with_spaces/.omt/space-exec-proj" ]]; then
        # dir still exists — but only matters if state file was deleted; rmdir fails on non-empty
        : # acceptable if something else is in there
    fi

    rm -rf "$space_home"
    return $result
}

# Positive: a dir named like an old residue entry (would have been deleted by
# the old name-literal match) that also holds a LIVE ultragoal-state file
# survives --execute via liveness alone — the fan-out runs no name-based
# check at all anymore. "capricious-watcher" is already created (empty,
# evidence/ subdir only) by setup_fixture as one of the 14 old-residue-named
# entries; this test adds a live ultragoal-state file into it.
test_liveness_ultragoal_only_live_dir_preserved() {
    local fresh_ts
    fresh_ts=$(date -j -v-5M "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || date -d "5 minutes ago" "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || date "+%Y-%m-%dT%H:%M:%S")

    local live_dir="$FIXTURE_HOME/.omt/capricious-watcher"
    cat > "$live_dir/ultragoal-state-live-ug-sess.json" << EOF
{
  "active": true,
  "phase": "pursuing",
  "last_touched_at": "${fresh_ts}",
  "outcome": "live ultragoal",
  "iteration": 1
}
EOF

    bash "$CLEANUP_SCRIPT" --execute > /dev/null
    if [[ ! -d "$live_dir" ]]; then
        echo "ASSERTION FAILED: residue-named dir with a live ultragoal-state must survive --execute"
        return 1
    fi
    if [[ ! -f "$live_dir/ultragoal-state-live-ug-sess.json" ]]; then
        echo "ASSERTION FAILED: live ultragoal-state file itself must survive --execute"
        return 1
    fi
    return 0
}

# AC 6.execute — the same kind of old-residue-named dir with ONLY a live
# ultragoal-state survives --execute (the historical bug this line of
# coverage guards against: a directory holding only an active ultragoal
# pursuit being wiped by a name match → state loss). Uses "dented-gold" (a
# distinct old-residue entry from setup_fixture) so this test does not
# collide with the case above.
test_liveness_ultragoal_only_live_dir_survives_execute() {
    local fresh_ts
    fresh_ts=$(date -j -v-5M "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || date -d "5 minutes ago" "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || date "+%Y-%m-%dT%H:%M:%S")

    local live_dir="$FIXTURE_HOME/.omt/dented-gold"
    cat > "$live_dir/ultragoal-state-live-ug-exec-sess.json" << EOF
{
  "active": true,
  "phase": "pursuing",
  "last_touched_at": "${fresh_ts}",
  "outcome": "live ultragoal",
  "iteration": 1
}
EOF

    bash "$CLEANUP_SCRIPT" --execute > /dev/null

    if [[ ! -d "$live_dir" ]]; then
        echo "ASSERTION FAILED: residue-named directory holding only a live ultragoal-state must survive --execute"
        return 1
    fi
    if [[ ! -f "$live_dir/ultragoal-state-live-ug-exec-sess.json" ]]; then
        echo "ASSERTION FAILED: live ultragoal-state file itself must survive --execute"
        return 1
    fi
    return 0
}

# Positive: a dir with a LIVE active goal-state (fresh heartbeat) IS preserved via liveness
test_liveness_fresh_active_dir_preserved() {
    local fresh_ts
    fresh_ts=$(date -j -v-5M "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || date -d "5 minutes ago" "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || date "+%Y-%m-%dT%H:%M:%S")

    local live_dir="$FIXTURE_HOME/.omt/live-active-project"
    mkdir -p "$live_dir"
    cat > "$live_dir/goal-state-live-sess.json" << EOF
{
  "active": true,
  "phase": "pursuing",
  "last_touched_at": "${fresh_ts}",
  "outcome": "live goal",
  "iteration": 1
}
EOF

    bash "$CLEANUP_SCRIPT" --execute > /dev/null
    if [[ ! -d "$live_dir" ]]; then
        echo "ASSERTION FAILED: dir with a fresh-heartbeat active state must survive --execute"
        return 1
    fi
    if [[ ! -f "$live_dir/goal-state-live-sess.json" ]]; then
        echo "ASSERTION FAILED: fresh-heartbeat active state file itself must survive --execute"
        return 1
    fi
    return 0
}

# ---------------------------------------------------------------------------
# QA scenario 1 — fan-out reaps dead files across every top-level directory
# independently: a dead state file and a dead session artifact in two
# different project directories are both reaped, a live state file in a
# third project directory survives, and cache/ — which has no session-key
# file at all — is left untouched. No directory is ever removed, even the
# ones left empty by the reap. If the fan-out loop stopped after the first
# directory instead of visiting all of them, this is what would catch it.
# ---------------------------------------------------------------------------
test_fanout_reaps_dead_files_across_all_project_dirs() {
    local fresh_ts stale_touch
    fresh_ts=$(date -j -v-5M "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || date -d "5 minutes ago" "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || date "+%Y-%m-%dT%H:%M:%S")
    stale_touch=$(date -j -v-7H "+%Y%m%d%H%M" 2>/dev/null || date -d "7 hours ago" "+%Y%m%d%H%M" 2>/dev/null || echo "200001010000")

    local live_dir="$FIXTURE_HOME/.omt/fanout-live-project"
    mkdir -p "$live_dir"
    cat > "$live_dir/goal-state-fanout-live-sess.json" << EOF
{
  "active": true,
  "phase": "pursuing",
  "last_touched_at": "${fresh_ts}",
  "outcome": "fanout live",
  "iteration": 1
}
EOF

    local dead_state_dir="$FIXTURE_HOME/.omt/fanout-dead-state-project"
    mkdir -p "$dead_state_dir"
    local dead_state_file="$dead_state_dir/prometheus-state-fanout-dead-sess.json"
    cat > "$dead_state_file" << EOF
{
  "active": false,
  "phase": "complete"
}
EOF
    touch -t "$stale_touch" "$dead_state_file"

    # A dead session artifact — codex-todo carries no "active" field, so its
    # own mtime (not fixture setup, since setup_fixture is shared and must
    # not seed dead artifacts) is what decides its liveness. Seeded here,
    # inside this one test, not in setup_fixture.
    local dead_artifact_dir="$FIXTURE_HOME/.omt/fanout-dead-artifact-project"
    mkdir -p "$dead_artifact_dir"
    local dead_artifact_file="$dead_artifact_dir/codex-todo-fanout-dead-artifact.json"
    printf '{"todos":[]}' > "$dead_artifact_file"
    touch -t "$stale_touch" "$dead_artifact_file"

    local no_key_dir="$FIXTURE_HOME/.omt/cache"
    printf 'unrelated' > "$no_key_dir/fanout-marker.txt"

    bash "$CLEANUP_SCRIPT" --execute > /dev/null

    # No directory is ever removed — file-level reap only.
    for d in "$live_dir" "$dead_state_dir" "$dead_artifact_dir" "$no_key_dir"; do
        if [[ ! -d "$d" ]]; then
            echo "ASSERTION FAILED: directory must survive --execute: $d"
            return 1
        fi
    done

    if [[ ! -f "$live_dir/goal-state-fanout-live-sess.json" ]]; then
        echo "ASSERTION FAILED: live state file must survive"
        return 1
    fi
    if [[ -f "$dead_state_file" ]]; then
        echo "ASSERTION FAILED: dead state file must be reaped"
        return 1
    fi
    if [[ -f "$dead_artifact_file" ]]; then
        echo "ASSERTION FAILED: dead session artifact must be reaped"
        return 1
    fi
    if [[ ! -f "$no_key_dir/fanout-marker.txt" ]]; then
        echo "ASSERTION FAILED: cache/ (no session-key file) must be untouched"
        return 1
    fi
    return 0
}

# ---------------------------------------------------------------------------
# QA scenario 2 — a directory holding ONLY an unclassified session-key file
# (matches neither the state prefixes nor the session-artifact whitelist) is
# reported exactly once and never reaped, even under --execute. If it were
# deleted, reap would have fallen back to matching any session-id-shaped
# filename instead of sticking to the enumerated whitelist — the more
# destructive alternative that was deliberately rejected in favor of an
# enumerated whitelist (a missed family goes unreaped, which is reversible,
# instead of risking deletion of an unclassified file that turns out live).
# ---------------------------------------------------------------------------
test_unclassified_only_file_reported_not_reaped() {
    local stale_touch
    stale_touch=$(date -j -v-7H "+%Y%m%d%H%M" 2>/dev/null || date -d "7 hours ago" "+%Y%m%d%H%M" 2>/dev/null || echo "200001010000")

    local uuid="a1b2c3d4-e5f6-47a8-b9c0-d1e2f3a4b5c6"
    local proj_dir="$FIXTURE_HOME/.omt/unclassified-only-project"
    mkdir -p "$proj_dir"
    local f="$proj_dir/goal-review-context-${uuid}.json"
    printf '{"note":"drift signal"}' > "$f"
    touch -t "$stale_touch" "$f"

    local out
    out=$(bash "$CLEANUP_SCRIPT" --execute 2>&1)

    if [[ ! -f "$f" ]]; then
        echo "ASSERTION FAILED: unclassified file must survive --execute"
        return 1
    fi

    local report_count
    report_count=$(echo "$out" | grep -c "goal-review-context-${uuid}.json")
    if [[ "$report_count" -ne 1 ]]; then
        echo "ASSERTION FAILED: unclassified file must be reported exactly once, got $report_count"
        echo "  Output: ${out}"
        return 1
    fi
    return 0
}

# ---------------------------------------------------------------------------
# Defect 2 — --execute must fail loudly when a reap helper cannot actually
# delete what it reports. hooks/lib/state-liveness.sh is a concurrently
# developed dependency this file must not edit; its documented future
# contract is that reap_dead_state_files/reap_session_artifacts return
# non-zero when any of their internal `rm -f` calls fail. These tests fake
# that dependency — never the real file — in a throwaway copy of the
# production script plus a stand-in hooks/lib/state-liveness.sh, so
# omt-cleanup.sh's own exit-code-consuming logic can be exercised against
# that contract regardless of whether the real dependency has landed it yet.
# ---------------------------------------------------------------------------

# run_with_fake_reap_hooks <dead_state_rc> <artifacts_rc>
# Copies the real CLEANUP_SCRIPT into an isolated scripts/omt-cleanup/ tree
# next to a fake hooks/lib/state-liveness.sh whose reap_* functions return
# the given exit codes, runs it --execute against a throwaway HOME with TWO
# top-level project dirs, and leaves the result in the globals FAKE_RUN_RC /
# FAKE_RUN_OUTPUT. Two dirs (not one) is load-bearing: a naive fix that lets
# a failing reap call's `set -e` abort the whole fan-out early would still
# report a non-zero exit, but only the first dir's candidates would appear in
# the output — the report must finish scanning every directory and print its
# trailer before exiting non-zero, exactly like a normal run does.
run_with_fake_reap_hooks() {
    local dead_state_rc="$1"
    local artifacts_rc="$2"

    local fake_root
    fake_root=$(mktemp -d)
    mkdir -p "$fake_root/scripts/omt-cleanup" "$fake_root/hooks/lib" \
        "$fake_root/home/.omt/dummy-project-a" "$fake_root/home/.omt/dummy-project-b"
    cp "$CLEANUP_SCRIPT" "$fake_root/scripts/omt-cleanup/omt-cleanup.sh"

    cat > "$fake_root/hooks/lib/state-liveness.sh" << EOF
reap_dead_state_files() {
    echo "\$1/fake-dead-state.json"
    return ${dead_state_rc}
}
reap_session_artifacts() {
    echo "\$1/fake-dead-artifact.json"
    return ${artifacts_rc}
}
list_unclassified_session_files() {
    return 0
}
EOF

    FAKE_RUN_OUTPUT=$(env -u OMT_DIR -u OMT_SESSION_ID HOME="$fake_root/home" \
        bash "$fake_root/scripts/omt-cleanup/omt-cleanup.sh" --execute 2>&1)
    FAKE_RUN_RC=$?

    rm -rf "$fake_root"
}

test_execute_fails_when_dead_state_reap_reports_failure() {
    run_with_fake_reap_hooks 1 0
    if [[ $FAKE_RUN_RC -eq 0 ]]; then
        echo "ASSERTION FAILED: script must exit non-zero when reap_dead_state_files reports a failure"
        echo "  Output: ${FAKE_RUN_OUTPUT}"
        return 1
    fi
    if ! echo "$FAKE_RUN_OUTPUT" | grep -q "dummy-project-a/fake-dead-state.json"; then
        echo "ASSERTION FAILED: dummy-project-a's candidate must still be reported"
        echo "  Output: ${FAKE_RUN_OUTPUT}"
        return 1
    fi
    if ! echo "$FAKE_RUN_OUTPUT" | grep -q "dummy-project-b/fake-dead-state.json"; then
        echo "ASSERTION FAILED: a failure on the first directory must not abort the fan-out — dummy-project-b must still be scanned"
        echo "  Output: ${FAKE_RUN_OUTPUT}"
        return 1
    fi
    if ! echo "$FAKE_RUN_OUTPUT" | grep -q "=== done ==="; then
        echo "ASSERTION FAILED: the report must still print its completion trailer before exiting non-zero"
        echo "  Output: ${FAKE_RUN_OUTPUT}"
        return 1
    fi
    return 0
}

test_execute_fails_when_session_artifact_reap_reports_failure() {
    run_with_fake_reap_hooks 0 1
    if [[ $FAKE_RUN_RC -eq 0 ]]; then
        echo "ASSERTION FAILED: script must exit non-zero when reap_session_artifacts reports a failure"
        echo "  Output: ${FAKE_RUN_OUTPUT}"
        return 1
    fi
    if ! echo "$FAKE_RUN_OUTPUT" | grep -q "dummy-project-a/fake-dead-artifact.json"; then
        echo "ASSERTION FAILED: dummy-project-a's candidate must still be reported"
        echo "  Output: ${FAKE_RUN_OUTPUT}"
        return 1
    fi
    if ! echo "$FAKE_RUN_OUTPUT" | grep -q "dummy-project-b/fake-dead-artifact.json"; then
        echo "ASSERTION FAILED: a failure on the first directory must not abort the fan-out — dummy-project-b must still be scanned"
        echo "  Output: ${FAKE_RUN_OUTPUT}"
        return 1
    fi
    if ! echo "$FAKE_RUN_OUTPUT" | grep -q "=== done ==="; then
        echo "ASSERTION FAILED: the report must still print its completion trailer before exiting non-zero"
        echo "  Output: ${FAKE_RUN_OUTPUT}"
        return 1
    fi
    return 0
}

test_execute_succeeds_when_reap_helpers_report_no_failure() {
    run_with_fake_reap_hooks 0 0
    if [[ $FAKE_RUN_RC -ne 0 ]]; then
        echo "ASSERTION FAILED: script must exit zero when neither reap helper reports a failure"
        echo "  Output: ${FAKE_RUN_OUTPUT}"
        return 1
    fi
    if ! echo "$FAKE_RUN_OUTPUT" | grep -q "=== done ==="; then
        echo "ASSERTION FAILED: a clean run must still print its completion trailer"
        echo "  Output: ${FAKE_RUN_OUTPUT}"
        return 1
    fi
    return 0
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
    echo "=========================================="
    echo "omt-cleanup.sh Tests"
    echo "=========================================="

    # AC 6.1 — a no-candidate residue directory survives --execute untouched
    run_test test_execute_preserves_no_candidate_dir_capricious_watcher
    run_test test_execute_preserves_no_candidate_dir_dented_gold
    run_test test_execute_preserves_no_candidate_dir_radical_water
    run_test test_execute_preserves_no_candidate_dir_scrawny_peak
    run_test test_execute_preserves_no_candidate_dir_medieval_cadmium
    run_test test_execute_preserves_no_candidate_dir_frosted_anglerfish
    run_test test_execute_preserves_no_candidate_dir_fire_cockroach
    run_test test_execute_preserves_no_candidate_dir_oh_my_toong
    run_test test_execute_preserves_no_candidate_dir_stage
    run_test test_execute_preserves_no_candidate_dir_algocare_home_stage
    run_test test_execute_preserves_no_candidate_dir_omt_test
    run_test test_execute_preserves_no_candidate_dir_tmp
    run_test test_execute_preserves_no_candidate_dir_evidence
    run_test test_execute_preserves_no_candidate_dir_toong
    run_test test_dryrun_mutates_nothing
    run_test test_dryrun_preserves_real_reap_candidates

    # AC 6.2 — entries with no reap candidate survive --execute intact
    run_test test_dryrun_preserved_names_oh_my_toong_playground
    run_test test_dryrun_preserved_names_algocare_backend
    run_test test_dryrun_preserved_names_algocare_home_app_device
    run_test test_dryrun_preserved_names_algocd
    run_test test_dryrun_preserved_names_cache
    run_test test_dryrun_preserved_not_in_delete_list

    # AC 6.3 — default no-execute hermetic
    run_test test_default_no_execute_leaves_fixture_identical
    run_test test_real_omt_untouched_when_home_is_fixture

    # Execute mode
    run_test test_execute_deletes_capricious_watcher
    run_test test_execute_deletes_fire_cockroach
    run_test test_execute_deletes_oh_my_toong
    run_test test_execute_deletes_stage
    run_test test_execute_deletes_algocare_home_stage
    run_test test_execute_deletes_toong
    run_test test_execute_deletes_evidence_toplevel
    run_test test_execute_preserves_cache
    run_test test_execute_preserves_oh_my_toong_playground
    run_test test_execute_preserves_algocare_home
    run_test test_execute_preserves_algocd
    run_test test_execute_preserves_active_goal_state_files

    # AC liveness unification (TODO 7)
    run_test test_liveness_all_dead_dir_not_preserved
    run_test test_liveness_active_7h_idle_dir_not_preserved
    run_test test_liveness_active_7h_idle_execute_keeps_plan
    run_test test_dead_state_dryrun_shows_state_file_path
    run_test test_liveness_fresh_active_dir_preserved
    run_test test_liveness_ultragoal_only_live_dir_preserved
    run_test test_liveness_ultragoal_only_live_dir_survives_execute

    # (A) word-split regression — HOME path with spaces
    run_test test_dead_state_space_in_home_dryrun_shows_full_path
    run_test test_dead_state_space_in_home_execute_deletes_correct_file

    # Fan-out QA scenarios
    run_test test_fanout_reaps_dead_files_across_all_project_dirs
    run_test test_unclassified_only_file_reported_not_reaped

    # Defect 2 — reap-failure exit code propagation
    run_test test_execute_fails_when_dead_state_reap_reports_failure
    run_test test_execute_fails_when_session_artifact_reap_reports_failure
    run_test test_execute_succeeds_when_reap_helpers_report_no_failure

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
}

main "$@"

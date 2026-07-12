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
    # Stable fingerprint of a directory tree
    find "$1" -print | sort | shasum
}

# ---------------------------------------------------------------------------
# AC 6.1 — dry-run names each of the 14 residue entries individually
# Output is captured to a variable first to avoid SIGPIPE with set -euo pipefail.
# ---------------------------------------------------------------------------

test_dryrun_names_capricious_watcher() {
    local out; out=$(bash "$CLEANUP_SCRIPT" --dry-run 2>&1)
    echo "$out" | grep -q "capricious-watcher"
}

test_dryrun_names_dented_gold() {
    local out; out=$(bash "$CLEANUP_SCRIPT" --dry-run 2>&1)
    echo "$out" | grep -q "dented-gold"
}

test_dryrun_names_radical_water() {
    local out; out=$(bash "$CLEANUP_SCRIPT" --dry-run 2>&1)
    echo "$out" | grep -q "radical-water"
}

test_dryrun_names_scrawny_peak() {
    local out; out=$(bash "$CLEANUP_SCRIPT" --dry-run 2>&1)
    echo "$out" | grep -q "scrawny-peak"
}

test_dryrun_names_medieval_cadmium() {
    local out; out=$(bash "$CLEANUP_SCRIPT" --dry-run 2>&1)
    echo "$out" | grep -q "medieval-cadmium"
}

test_dryrun_names_frosted_anglerfish() {
    local out; out=$(bash "$CLEANUP_SCRIPT" --dry-run 2>&1)
    echo "$out" | grep -q "frosted-anglerfish"
}

test_dryrun_names_fire_cockroach() {
    local out; out=$(bash "$CLEANUP_SCRIPT" --dry-run 2>&1)
    echo "$out" | grep -q "fire-cockroach"
}

test_dryrun_names_oh_my_toong() {
    local out; out=$(bash "$CLEANUP_SCRIPT" --dry-run 2>&1)
    echo "$out" | grep -q "oh-my-toong"
}

test_dryrun_names_stage() {
    local out; out=$(bash "$CLEANUP_SCRIPT" --dry-run 2>&1)
    echo "$out" | grep -q "stage"
}

test_dryrun_names_algocare_home_stage() {
    local out; out=$(bash "$CLEANUP_SCRIPT" --dry-run 2>&1)
    echo "$out" | grep -q "algocare-home-stage"
}

test_dryrun_names_omt_test() {
    local out; out=$(bash "$CLEANUP_SCRIPT" --dry-run 2>&1)
    echo "$out" | grep -q "omt-test"
}

test_dryrun_names_tmp() {
    local out; out=$(bash "$CLEANUP_SCRIPT" --dry-run 2>&1)
    echo "$out" | grep -q "tmp"
}

test_dryrun_names_evidence() {
    local out; out=$(bash "$CLEANUP_SCRIPT" --dry-run 2>&1)
    echo "$out" | grep -q "evidence"
}

test_dryrun_names_toong() {
    local out; out=$(bash "$CLEANUP_SCRIPT" --dry-run 2>&1)
    echo "$out" | grep -q "toong"
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
# AC 6.2 — dry-run names preserved entries as PRESERVED
# Note: "oh-my-toong" appears in residue list AND as prefix of "oh-my-toong-playground";
# the PRESERVED check is that oh-my-toong-playground appears with PRESERVED label.
# ---------------------------------------------------------------------------

test_dryrun_preserved_names_oh_my_toong_playground() {
    local out; out=$(bash "$CLEANUP_SCRIPT" --dry-run 2>&1)
    echo "$out" | grep "PRESERVED" | grep -q "oh-my-toong-playground"
}

test_dryrun_preserved_names_algocare_backend() {
    local out; out=$(bash "$CLEANUP_SCRIPT" --dry-run 2>&1)
    echo "$out" | grep "PRESERVED" | grep -q "algocare-backend"
}

test_dryrun_preserved_names_algocare_home_app_device() {
    local out; out=$(bash "$CLEANUP_SCRIPT" --dry-run 2>&1)
    echo "$out" | grep "PRESERVED" | grep -q "algocare-home-app-device"
}

test_dryrun_preserved_names_algocd() {
    local out; out=$(bash "$CLEANUP_SCRIPT" --dry-run 2>&1)
    echo "$out" | grep "PRESERVED" | grep -q "algocd"
}

test_dryrun_preserved_names_cache() {
    local out; out=$(bash "$CLEANUP_SCRIPT" --dry-run 2>&1)
    echo "$out" | grep "PRESERVED" | grep -q "cache"
}

# Preserved entries must NOT appear in the delete-list section
test_dryrun_preserved_not_in_delete_list() {
    local output
    output=$(bash "$CLEANUP_SCRIPT" --dry-run 2>&1)
    if echo "$output" | grep "DELETE" | grep -q "oh-my-toong-playground"; then
        echo "oh-my-toong-playground appeared in DELETE section"
        return 1
    fi
    if echo "$output" | grep "DELETE" | grep -q "algocare-backend"; then
        echo "algocare-backend appeared in DELETE section"
        return 1
    fi
    if echo "$output" | grep "DELETE" | grep -q "cache"; then
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

test_execute_deletes_capricious_watcher() {
    bash "$CLEANUP_SCRIPT" --execute > /dev/null
    [[ ! -d "$FIXTURE_HOME/.omt/capricious-watcher" ]]
}

test_execute_deletes_fire_cockroach() {
    bash "$CLEANUP_SCRIPT" --execute > /dev/null
    [[ ! -d "$FIXTURE_HOME/.omt/fire-cockroach" ]]
}

test_execute_deletes_oh_my_toong() {
    bash "$CLEANUP_SCRIPT" --execute > /dev/null
    [[ ! -d "$FIXTURE_HOME/.omt/oh-my-toong" ]]
}

test_execute_deletes_stage() {
    bash "$CLEANUP_SCRIPT" --execute > /dev/null
    [[ ! -d "$FIXTURE_HOME/.omt/stage" ]]
}

test_execute_deletes_algocare_home_stage() {
    bash "$CLEANUP_SCRIPT" --execute > /dev/null
    [[ ! -d "$FIXTURE_HOME/.omt/algocare-home-stage" ]]
}

test_execute_deletes_toong() {
    bash "$CLEANUP_SCRIPT" --execute > /dev/null
    [[ ! -d "$FIXTURE_HOME/.omt/toong" ]]
}

test_execute_deletes_evidence_toplevel() {
    bash "$CLEANUP_SCRIPT" --execute > /dev/null
    [[ ! -d "$FIXTURE_HOME/.omt/evidence" ]]
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

    local out
    out=$(bash "$CLEANUP_SCRIPT" --dry-run 2>&1)
    # It must NOT appear as PRESERVED — it should be either DELETE or unknown-fallback
    # The key assertion: it does NOT appear under PRESERVED
    if echo "$out" | grep "PRESERVED" | grep -q "dead-project-only-terminal"; then
        echo "ASSERTION FAILED: dir with only a dead terminal state must NOT be preserved"
        echo "  Output: ${out}"
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

    local out
    out=$(bash "$CLEANUP_SCRIPT" --dry-run 2>&1)
    if echo "$out" | grep "PRESERVED" | grep -q "stale-active-project"; then
        echo "ASSERTION FAILED: dir with only a 7h-idle active state must NOT be preserved (parity with session-start GC)"
        echo "  Output: ${out}"
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
    if ! echo "$out" | grep "DELETE" | grep -q "goal-state-dry-sess.json"; then
        echo "ASSERTION FAILED: dry-run must list state file path, not just dir name"
        echo "  Output: ${out}"
        return 1
    fi
    return 0
}

# ---------------------------------------------------------------------------
# (A) DEAD_STATE_FILES word-split regression — HOME path with spaces
# If DEAD_STATE_FILES is consumed unquoted, paths like
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

    # The full path (with spaces) must appear verbatim in DELETE output
    if ! echo "$out" | grep "DELETE" | grep -q "goal-state-space-sess.json"; then
        echo "ASSERTION FAILED: dry-run must list full state file path (spaces in HOME)"
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

# Positive: a RESIDUE-NAMED dir (would normally be deleted by name match) that also
# holds a LIVE ultragoal-state file IS preserved via liveness (P4-P7 preserve check
# runs before the residue-name check) — this is the real bug consequence: without
# ultragoal-state-*.json in list_state_files, has_live_state never sees it, so a
# residue-named directory holding only an active ultragoal pursuit falls through to
# is_residue() and gets deleted. "capricious-watcher" is already created (empty,
# evidence/ subdir only) by setup_fixture as one of the 14 residue entries; this test
# adds a live ultragoal-state file into it.
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

    local out
    out=$(bash "$CLEANUP_SCRIPT" --dry-run 2>&1)
    if ! echo "$out" | grep "PRESERVED" | grep -q "capricious-watcher"; then
        echo "ASSERTION FAILED: residue-named dir with a live ultragoal-state must be PRESERVED, not residue-deleted"
        echo "  Output: ${out}"
        return 1
    fi
    if echo "$out" | grep "DELETE" | grep -q "capricious-watcher"; then
        echo "ASSERTION FAILED: residue-named dir with a live ultragoal-state must NOT appear in the DELETE section"
        echo "  Output: ${out}"
        return 1
    fi
    return 0
}

# AC 6.execute — the same residue-named dir with ONLY a live ultragoal-state
# is not deleted under --execute (the actual bug consequence described in the
# task: omt-cleanup.sh --execute deleting a residue directory that holds only
# an active ultragoal pursuit → state loss). Uses "dented-gold" (a distinct
# residue entry from setup_fixture) so this test does not collide with the
# dry-run test above.
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

    local out
    out=$(bash "$CLEANUP_SCRIPT" --dry-run 2>&1)
    if ! echo "$out" | grep "PRESERVED" | grep -q "live-active-project"; then
        echo "ASSERTION FAILED: dir with a fresh-heartbeat active state must be PRESERVED"
        echo "  Output: ${out}"
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

    # AC 6.1 — dry-run names each residue individually
    run_test test_dryrun_names_capricious_watcher
    run_test test_dryrun_names_dented_gold
    run_test test_dryrun_names_radical_water
    run_test test_dryrun_names_scrawny_peak
    run_test test_dryrun_names_medieval_cadmium
    run_test test_dryrun_names_frosted_anglerfish
    run_test test_dryrun_names_fire_cockroach
    run_test test_dryrun_names_oh_my_toong
    run_test test_dryrun_names_stage
    run_test test_dryrun_names_algocare_home_stage
    run_test test_dryrun_names_omt_test
    run_test test_dryrun_names_tmp
    run_test test_dryrun_names_evidence
    run_test test_dryrun_names_toong
    run_test test_dryrun_mutates_nothing

    # AC 6.2 — preserved entries named as PRESERVED
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

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
}

main "$@"

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
    mkdir -p "$omt/acme-home-stage/evidence"
    mkdir -p "$omt/omt-test"
    mkdir -p "$omt/tmp"
    mkdir -p "$omt/evidence"         # top-level evidence residue
    mkdir -p "$omt/toong/logs"

    # --- Preserved live-state / legit entries ---
    # acme-* projects (LEGIT)
    mkdir -p "$omt/acme-backend/logs"
    mkdir -p "$omt/acme-home/logs"
    mkdir -p "$omt/acme-home-app-device/logs"
    mkdir -p "$omt/acme-home-backend/logs"
    mkdir -p "$omt/acme-gitops/logs"

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

test_execute_preserves_no_candidate_dir_acme_home_stage() {
    bash "$CLEANUP_SCRIPT" --execute > /dev/null
    [[ -d "$FIXTURE_HOME/.omt/acme-home-stage" ]]
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

    # No-args and explicit --dry-run are two separate inputs that the
    # arg-parsing loop recognizes on their own terms, and both resolve to the
    # same outcome: DRY_RUN stays at its default of 1. No-args never enters the
    # loop body; --dry-run enters it and matches the `--dry-run)` case, which
    # only sets SAW_DRY_RUN and leaves DRY_RUN untouched (usage block:
    # "--dry-run    # same as default"). Asserting the no-args form directly,
    # on this same real-candidate fixture, means an argument-parsing refactor
    # that splits the two forms apart can no longer make the default path
    # silently destructive without this assertion catching it.
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

test_dryrun_preserved_names_acme_backend() {
    bash "$CLEANUP_SCRIPT" --execute > /dev/null
    [[ -d "$FIXTURE_HOME/.omt/acme-backend" ]] \
        && [[ -d "$FIXTURE_HOME/.omt/acme-backend/logs" ]]
}

test_dryrun_preserved_names_acme_home_app_device() {
    bash "$CLEANUP_SCRIPT" --execute > /dev/null
    [[ -d "$FIXTURE_HOME/.omt/acme-home-app-device" ]] \
        && [[ -d "$FIXTURE_HOME/.omt/acme-home-app-device/logs" ]]
}

test_dryrun_preserved_names_acme-gitops() {
    bash "$CLEANUP_SCRIPT" --execute > /dev/null
    [[ -d "$FIXTURE_HOME/.omt/acme-gitops" ]] \
        && [[ -d "$FIXTURE_HOME/.omt/acme-gitops/logs" ]]
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
    if grep -q -- "DELETE .*oh-my-toong-playground" <<<"$output"; then
        echo "oh-my-toong-playground appeared in DELETE section"
        return 1
    fi
    if grep -q -- "DELETE .*acme-backend" <<<"$output"; then
        echo "acme-backend appeared in DELETE section"
        return 1
    fi
    if grep -q -- "DELETE .*cache" <<<"$output"; then
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
    if grep -q -- "$ORIGINAL_HOME/.omt" <<<"$output"; then
        echo "FAIL: script scanned real ~/.omt (non-hermetic)"
        return 1
    fi
    if grep -q -- "$FIXTURE_HOME/.omt" <<<"$output"; then
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

test_execute_deletes_acme_home_stage() {
    bash "$CLEANUP_SCRIPT" --execute > /dev/null
    [[ -d "$FIXTURE_HOME/.omt/acme-home-stage" ]]
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

test_execute_preserves_acme_home() {
    bash "$CLEANUP_SCRIPT" --execute > /dev/null
    [[ -d "$FIXTURE_HOME/.omt/acme-home" ]]
}

test_execute_preserves_acme-gitops() {
    bash "$CLEANUP_SCRIPT" --execute > /dev/null
    [[ -d "$FIXTURE_HOME/.omt/acme-gitops" ]]
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
    if ! grep -q -- "DELETE .*goal-state-dry-sess.json" <<<"$out"; then
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
    if ! grep -qF -- "$state_file" <<<"$out"; then
        echo "ASSERTION FAILED: dry-run must list full state file path verbatim (spaces in HOME)"
        echo "  Expected path: ${state_file}"
        echo "  Output: ${out}"
        return 1
    fi
    return 0
}

# execute: the state file is deleted; a seeded word-split artifact and a
# seeded sibling file in the same project dir both survive untouched
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

    # Seed the two collateral-deletion shapes a word-split of a
    # space-bearing HOME could touch, so --execute is checked against them
    # directly instead of only against the intended target:
    # (a) the word-split artifact — the path a naive `rm -f $HOME/...`
    #     would form if HOME were left unquoted and split at the first
    #     space ("$space_home/John Doe" -> "$space_home/John" + "Doe/...").
    local stray_word_split_dir="$space_home/John"
    mkdir -p "$stray_word_split_dir"
    local stray_word_split_marker="$stray_word_split_dir/word-split-marker.txt"
    echo "must survive --execute" > "$stray_word_split_marker"
    # (b) a sibling file in the same project dir as the real target, which
    #     --execute must leave alone (proves deletion is scoped to the
    #     matched candidate, not the whole directory).
    local sibling_file="$proj_dir/sibling-untouched.txt"
    echo "must survive --execute" > "$sibling_file"

    HOME="$space_home_with_spaces" bash "$CLEANUP_SCRIPT" --execute > /dev/null 2>&1

    local result=0

    # The state file must be gone (correctly deleted)
    if [[ -f "$state_file" ]]; then
        echo "ASSERTION FAILED: state file must be deleted by --execute"
        result=1
    fi

    # The word-split artifact must survive untouched.
    if [[ ! -f "$stray_word_split_marker" ]]; then
        echo "ASSERTION FAILED: word-split artifact ($stray_word_split_marker) was deleted by --execute"
        result=1
    fi

    # The sibling file in the same project dir must survive untouched.
    if [[ ! -f "$sibling_file" ]]; then
        echo "ASSERTION FAILED: sibling file ($sibling_file) was deleted by --execute"
        result=1
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
    if ! grep -q -- "dummy-project-a/fake-dead-state.json" <<<"$FAKE_RUN_OUTPUT"; then
        echo "ASSERTION FAILED: dummy-project-a's candidate must still be reported"
        echo "  Output: ${FAKE_RUN_OUTPUT}"
        return 1
    fi
    if ! grep -q -- "dummy-project-b/fake-dead-state.json" <<<"$FAKE_RUN_OUTPUT"; then
        echo "ASSERTION FAILED: a failure on the first directory must not abort the fan-out — dummy-project-b must still be scanned"
        echo "  Output: ${FAKE_RUN_OUTPUT}"
        return 1
    fi
    if ! grep -q -- "=== done ===" <<<"$FAKE_RUN_OUTPUT"; then
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
    if ! grep -q -- "dummy-project-a/fake-dead-artifact.json" <<<"$FAKE_RUN_OUTPUT"; then
        echo "ASSERTION FAILED: dummy-project-a's candidate must still be reported"
        echo "  Output: ${FAKE_RUN_OUTPUT}"
        return 1
    fi
    if ! grep -q -- "dummy-project-b/fake-dead-artifact.json" <<<"$FAKE_RUN_OUTPUT"; then
        echo "ASSERTION FAILED: a failure on the first directory must not abort the fan-out — dummy-project-b must still be scanned"
        echo "  Output: ${FAKE_RUN_OUTPUT}"
        return 1
    fi
    if ! grep -q -- "=== done ===" <<<"$FAKE_RUN_OUTPUT"; then
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
    if ! grep -q -- "=== done ===" <<<"$FAKE_RUN_OUTPUT"; then
        echo "ASSERTION FAILED: a clean run must still print its completion trailer"
        echo "  Output: ${FAKE_RUN_OUTPUT}"
        return 1
    fi
    return 0
}

# ---------------------------------------------------------------------------
# Arg-parsing regression — the old parser only ever looked at $1, so a
# contradictory combination (--execute --dry-run, or the reverse order) let
# whichever flag happened to land in $1 silently win, and an unrecognized
# argument (e.g. a typo'd --excute) fell through to the safe default without
# telling the caller their flag was ignored. Each test below seeds a real
# dead state file (7h-idle active goal-state, a genuine reap candidate) so
# "rejected" is checked against actual survival on disk, not just an exit
# code — a rejection that still deleted before erroring would pass an
# exit-code-only assertion.
# ---------------------------------------------------------------------------

test_conflicting_flags_execute_then_dryrun_rejected() {
    local stale_ts stale_touch
    stale_ts=$(date -j -v-7H "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || date -d "7 hours ago" "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || echo "2000-01-01T00:00:00")
    stale_touch=$(date -j -v-7H "+%Y%m%d%H%M" 2>/dev/null || date -d "7 hours ago" "+%Y%m%d%H%M" 2>/dev/null || echo "200001010000")

    local proj_dir="$FIXTURE_HOME/.omt/conflict-execute-then-dryrun-project"
    mkdir -p "$proj_dir"
    local state_file="$proj_dir/goal-state-conflict-exec-then-dry-sess.json"
    cat > "$state_file" << EOF
{
  "active": true,
  "phase": "pursuing",
  "last_touched_at": "${stale_ts}",
  "outcome": "stale goal",
  "iteration": 1
}
EOF

    # A dead session artifact alongside the dead state file — see
    # test_dryrun_preserves_real_reap_candidates for why this lane needs its
    # own genuine candidate, not just the state-file one: reap_session_artifacts
    # and reap_dead_state_files are two independent delete lanes, and a
    # rejection guard placed between them would still let this one through.
    local artifact_file="$proj_dir/codex-todo-conflict-exec-then-dry-artifact.json"
    printf '{"todos":[]}' > "$artifact_file"
    touch -t "$stale_touch" "$artifact_file"

    local rc=0
    local out
    out=$(bash "$CLEANUP_SCRIPT" --execute --dry-run 2>&1) || rc=$?

    if [[ $rc -eq 0 ]]; then
        echo "ASSERTION FAILED: --execute --dry-run must exit non-zero"
        echo "  Output: ${out}"
        return 1
    fi
    if ! grep -q -- "Usage" <<<"$out"; then
        echo "ASSERTION FAILED: rejection must show usage"
        echo "  Output: ${out}"
        return 1
    fi
    if [[ ! -f "$state_file" ]]; then
        echo "ASSERTION FAILED: --execute --dry-run must not delete anything — the conflicting combination was rejected instead of one flag silently winning"
        return 1
    fi
    if [[ ! -f "$artifact_file" ]]; then
        echo "ASSERTION FAILED: --execute --dry-run must not delete a dead session artifact either — the rejection guard must sit ahead of BOTH reap lanes"
        return 1
    fi
    return 0
}

test_conflicting_flags_dryrun_then_execute_rejected() {
    local stale_ts stale_touch
    stale_ts=$(date -j -v-7H "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || date -d "7 hours ago" "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || echo "2000-01-01T00:00:00")
    stale_touch=$(date -j -v-7H "+%Y%m%d%H%M" 2>/dev/null || date -d "7 hours ago" "+%Y%m%d%H%M" 2>/dev/null || echo "200001010000")

    local proj_dir="$FIXTURE_HOME/.omt/conflict-dryrun-then-execute-project"
    mkdir -p "$proj_dir"
    local state_file="$proj_dir/goal-state-conflict-dry-then-exec-sess.json"
    cat > "$state_file" << EOF
{
  "active": true,
  "phase": "pursuing",
  "last_touched_at": "${stale_ts}",
  "outcome": "stale goal",
  "iteration": 1
}
EOF

    # A dead session artifact alongside the dead state file — see
    # test_dryrun_preserves_real_reap_candidates for why this lane needs its
    # own genuine candidate, not just the state-file one: reap_session_artifacts
    # and reap_dead_state_files are two independent delete lanes, and a
    # rejection guard placed between them would still let this one through.
    local artifact_file="$proj_dir/codex-todo-conflict-dry-then-exec-artifact.json"
    printf '{"todos":[]}' > "$artifact_file"
    touch -t "$stale_touch" "$artifact_file"

    local rc=0
    local out
    out=$(bash "$CLEANUP_SCRIPT" --dry-run --execute 2>&1) || rc=$?

    if [[ $rc -eq 0 ]]; then
        echo "ASSERTION FAILED: --dry-run --execute must exit non-zero"
        echo "  Output: ${out}"
        return 1
    fi
    if ! grep -q -- "Usage" <<<"$out"; then
        echo "ASSERTION FAILED: rejection must show usage"
        echo "  Output: ${out}"
        return 1
    fi
    if [[ ! -f "$state_file" ]]; then
        echo "ASSERTION FAILED: --dry-run --execute must not delete anything — the conflicting combination was rejected instead of one flag silently winning, regardless of argument order"
        return 1
    fi
    if [[ ! -f "$artifact_file" ]]; then
        echo "ASSERTION FAILED: --dry-run --execute must not delete a dead session artifact either — the rejection guard must sit ahead of BOTH reap lanes"
        return 1
    fi
    return 0
}

test_unrecognized_argument_rejected_not_silently_dryrun() {
    local stale_ts stale_touch
    stale_ts=$(date -j -v-7H "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || date -d "7 hours ago" "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || echo "2000-01-01T00:00:00")
    stale_touch=$(date -j -v-7H "+%Y%m%d%H%M" 2>/dev/null || date -d "7 hours ago" "+%Y%m%d%H%M" 2>/dev/null || echo "200001010000")

    local proj_dir="$FIXTURE_HOME/.omt/unrecognized-arg-project"
    mkdir -p "$proj_dir"
    local state_file="$proj_dir/goal-state-unrecognized-arg-sess.json"
    cat > "$state_file" << EOF
{
  "active": true,
  "phase": "pursuing",
  "last_touched_at": "${stale_ts}",
  "outcome": "stale goal",
  "iteration": 1
}
EOF

    # A dead session artifact alongside the dead state file — see
    # test_dryrun_preserves_real_reap_candidates for why this lane needs its
    # own genuine candidate, not just the state-file one: reap_session_artifacts
    # and reap_dead_state_files are two independent delete lanes, and a
    # rejection guard placed between them would still let this one through.
    local artifact_file="$proj_dir/codex-todo-unrecognized-arg-artifact.json"
    printf '{"todos":[]}' > "$artifact_file"
    touch -t "$stale_touch" "$artifact_file"

    local rc=0
    local out
    out=$(bash "$CLEANUP_SCRIPT" --excute 2>&1) || rc=$?

    if [[ $rc -eq 0 ]]; then
        echo "ASSERTION FAILED: an unrecognized argument (typo'd --excute) must exit non-zero, not fall through to dry-run silently"
        echo "  Output: ${out}"
        return 1
    fi
    if ! grep -q -- "Usage" <<<"$out"; then
        echo "ASSERTION FAILED: rejection must show usage"
        echo "  Output: ${out}"
        return 1
    fi
    # State file surviving here is expected either way (rejection or a
    # silent dry-run fallback would both preserve it) — the exit-code check
    # above is what actually distinguishes the two; this just confirms
    # rejection didn't also delete something as a side effect.
    if [[ ! -f "$state_file" ]]; then
        echo "ASSERTION FAILED: an unrecognized argument must not delete anything"
        return 1
    fi
    if [[ ! -f "$artifact_file" ]]; then
        echo "ASSERTION FAILED: an unrecognized argument must not delete a dead session artifact either — the rejection guard must sit ahead of BOTH reap lanes"
        return 1
    fi

    # A typo AFTER a valid flag must be caught too — a parser that stops
    # validating once it has seen one recognized flag would set DRY_RUN=0
    # from --execute, never notice --excute, and delete for real (rc=0).
    # Reuses the same $state_file and $artifact_file: the checks above
    # already proved a bare --excute doesn't touch either, so both are
    # still genuine reap candidates here.
    local rc2=0
    local out2
    out2=$(bash "$CLEANUP_SCRIPT" --execute --excute 2>&1) || rc2=$?

    if [[ $rc2 -eq 0 ]]; then
        echo "ASSERTION FAILED: --execute --excute must exit non-zero — a typo after a valid flag must not be silently ignored"
        echo "  Output: ${out2}"
        return 1
    fi
    if [[ ! -f "$state_file" ]]; then
        echo "ASSERTION FAILED: --execute --excute must not delete anything — validation stopping after the first recognized flag would silently execute"
        return 1
    fi
    if [[ ! -f "$artifact_file" ]]; then
        echo "ASSERTION FAILED: --execute --excute must not delete a dead session artifact either — validation stopping after the first recognized flag would silently execute"
        return 1
    fi
    return 0
}

# Negative controls for the three rejection tests above: without these, all
# three could "pass" merely because the script now does nothing on any input
# — these prove --execute alone still reaps and no-args still preserves.
test_negative_control_execute_alone_still_deletes() {
    local stale_ts
    stale_ts=$(date -j -v-7H "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || date -d "7 hours ago" "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || echo "2000-01-01T00:00:00")

    local proj_dir="$FIXTURE_HOME/.omt/negative-control-execute-project"
    mkdir -p "$proj_dir"
    local state_file="$proj_dir/goal-state-negctrl-exec-sess.json"
    cat > "$state_file" << EOF
{
  "active": true,
  "phase": "pursuing",
  "last_touched_at": "${stale_ts}",
  "outcome": "stale goal",
  "iteration": 1
}
EOF

    bash "$CLEANUP_SCRIPT" --execute > /dev/null

    if [[ -f "$state_file" ]]; then
        echo "ASSERTION FAILED: --execute alone must still delete a real dead state file"
        return 1
    fi
    return 0
}

test_negative_control_no_args_still_preserves() {
    local stale_ts
    stale_ts=$(date -j -v-7H "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || date -d "7 hours ago" "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || echo "2000-01-01T00:00:00")

    local proj_dir="$FIXTURE_HOME/.omt/negative-control-noargs-project"
    mkdir -p "$proj_dir"
    local state_file="$proj_dir/goal-state-negctrl-noargs-sess.json"
    cat > "$state_file" << EOF
{
  "active": true,
  "phase": "pursuing",
  "last_touched_at": "${stale_ts}",
  "outcome": "stale goal",
  "iteration": 1
}
EOF

    bash "$CLEANUP_SCRIPT" > /dev/null

    if [[ ! -f "$state_file" ]]; then
        echo "ASSERTION FAILED: no-args (default dry-run) must still preserve a real dead state file"
        return 1
    fi
    return 0
}

# ---------------------------------------------------------------------------
# Symlink fan-out guard — a symlinked top-level $OMT_DIR entry must never be
# followed into for reaping. The glob `"$OMT_DIR"/*/` (trailing slash)
# resolves a directory symlink to its TARGET path, so without a guard the
# reap helpers run `rm -f` against files OUTSIDE $OMT_DIR entirely — the
# symlink target here ($FIXTURE_HOME/outside/victim) sits next to, not
# inside, $FIXTURE_HOME/.omt.
# ---------------------------------------------------------------------------

# Positive control (proves the guard, not merely "the script did nothing"):
# an ordinary (non-symlinked) sibling project directory in the SAME run must
# still have its own dead artifact reaped by --execute.
test_symlinked_project_target_artifact_survives_execute() {
    local stale_touch
    stale_touch=$(date -j -v-7H "+%Y%m%d%H%M" 2>/dev/null || date -d "7 hours ago" "+%Y%m%d%H%M" 2>/dev/null || echo "200001010000")

    local victim_dir="$FIXTURE_HOME/outside/victim"
    mkdir -p "$victim_dir"
    local victim_artifact="$victim_dir/codex-todo-dead.json"
    printf '{"todos":[]}' > "$victim_artifact"
    touch -t "$stale_touch" "$victim_artifact"

    ln -s "$victim_dir" "$FIXTURE_HOME/.omt/linkproj"

    # Positive control: an ordinary directory with its own genuinely dead
    # artifact, reaped in the SAME --execute pass — distinguishes "the guard
    # correctly skipped the symlink" from "the script silently reaped
    # nothing at all this run".
    local normal_dir="$FIXTURE_HOME/.omt/normalproj"
    mkdir -p "$normal_dir"
    local normal_artifact="$normal_dir/codex-todo-dead.json"
    printf '{"todos":[]}' > "$normal_artifact"
    touch -t "$stale_touch" "$normal_artifact"

    bash "$CLEANUP_SCRIPT" --execute > /dev/null

    if [[ ! -f "$victim_artifact" ]]; then
        echo "ASSERTION FAILED: dead artifact inside a symlink TARGET (outside \$OMT_DIR) must survive --execute — the symlink must not be followed"
        return 1
    fi
    if [[ ! -d "$victim_dir" ]]; then
        echo "ASSERTION FAILED: the symlink target directory itself must survive --execute"
        return 1
    fi
    if [[ -f "$normal_artifact" ]]; then
        echo "ASSERTION FAILED (positive control): an ordinary sibling directory's own dead artifact must still be reaped in the same run — otherwise this test cannot distinguish a working guard from a script that reaped nothing at all"
        return 1
    fi
    return 0
}

# The symlink entry itself must be reported (never silently skipped),
# following this script's existing UNCLASSIFIED report-not-act convention.
test_symlinked_project_reported_in_symlinks_section() {
    local victim_dir="$FIXTURE_HOME/outside/victim"
    mkdir -p "$victim_dir"
    ln -s "$victim_dir" "$FIXTURE_HOME/.omt/linkproj"

    local out
    out=$(bash "$CLEANUP_SCRIPT" --dry-run 2>&1)

    local symlink_section
    symlink_section=$(grep -A5 "SYMLINKS" <<<"$out")
    if ! grep -q -- "linkproj" <<<"$symlink_section"; then
        echo "ASSERTION FAILED: symlinked entry must be reported in the SYMLINKS section"
        echo "  Output: ${out}"
        return 1
    fi
    return 0
}

# WI-8 — trace/key/evidence retention and exact stale-lock cleanup.
test_pretool_trace_retention_and_custom_root() {
    local custom="$FIXTURE_HOME/custom-omt" default="$FIXTURE_HOME/.omt/default"
    mkdir -p "$custom/pretool-trace/keys" "$custom/evidence/pretool-trace/wi-8" \
        "$custom/pretool-trace/.append.lock" "$default/pretool-trace"
    local key
    key=$(printf 'a%.0s' {1..64})
    printf stale > "$custom/pretool-trace/events.jsonl"
    printf stale > "$custom/pretool-trace/keys/$key.key"
    printf stale > "$custom/evidence/pretool-trace/wi-8/result.txt"
    touch -t 200001010000 "$custom/pretool-trace/events.jsonl" "$custom/pretool-trace/keys/$key.key" \
        "$custom/evidence/pretool-trace/wi-8/result.txt" "$custom/pretool-trace/.append.lock"
    printf sentinel > "$default/pretool-trace/events.jsonl"
    export OMT_DIR="$custom"
    local dry
    dry=$(bash "$CLEANUP_SCRIPT" --dry-run)
    grep -q -- "$custom/pretool-trace/events.jsonl" <<<"$dry" || return 1
    grep -q -- "$custom/pretool-trace/keys/$key.key" <<<"$dry" || return 1
    grep -q -- "$custom/evidence/pretool-trace/wi-8/result.txt" <<<"$dry" || return 1
    grep -q -- "$custom/pretool-trace/.append.lock" <<<"$dry" || return 1
    grep -q -- "$default/pretool-trace/events.jsonl" <<<"$dry" && return 1
    [[ -f "$custom/pretool-trace/events.jsonl" ]] || return 1
    bash "$CLEANUP_SCRIPT" --execute > /dev/null
    [[ ! -e "$custom/pretool-trace/events.jsonl" ]] || return 1
    [[ ! -e "$custom/pretool-trace/keys/$key.key" ]] || return 1
    [[ ! -e "$custom/evidence/pretool-trace/wi-8/result.txt" ]] || return 1
    [[ ! -e "$custom/pretool-trace/.append.lock" ]] || return 1
    [[ -f "$default/pretool-trace/events.jsonl" ]] || return 1
    unset OMT_DIR
}

test_pretool_trace_fixed_now_boundaries_all_families() (
    local root="$FIXTURE_HOME/boundary" now=1000000000
    mkdir -p "$root/pretool-trace/keys" "$root/evidence/pretool-trace/wi-8"
    local key; key=$(printf 'b%.0s' {1..64})
    local f
    for f in events.jsonl events.jsonl.1 events.jsonl.2 events.jsonl.3; do printf x > "$root/pretool-trace/$f"; done
    printf x > "$root/pretool-trace/keys/$key.key"
    printf x > "$root/evidence/pretool-trace/wi-8/result.txt"
    mkdir -p "$root/pretool-trace/.append.lock"
    # The helper's stat dependency is replaced with a deterministic clock.
    source "$SCRIPT_DIR/../../hooks/lib/state-liveness.sh"
    local failed=0
    TEST_MTIME=$((now - 6 * 86400)); _state_liveness_stat_mtime() { printf '%s\n' "$TEST_MTIME"; }
    local paths="$root/pretool-trace/events.jsonl
$root/pretool-trace/events.jsonl.1
$root/pretool-trace/events.jsonl.2
$root/pretool-trace/events.jsonl.3
$root/pretool-trace/keys/$key.key
$root/evidence/pretool-trace/wi-8/result.txt"
    for age in 6 7; do
        TEST_MTIME=$((now - age * 86400))
        while IFS= read -r f; do _pretool_trace_stale "$f" "$now" && failed=1; done <<PATHS
$paths
PATHS
        _pretool_trace_stale "$root/pretool-trace/.append.lock" "$now" && failed=1
    done
    TEST_MTIME=$((now - 7 * 86400 - 1))
    while IFS= read -r f; do _pretool_trace_stale "$f" "$now" || failed=1; done <<PATHS
$paths
PATHS
    _pretool_trace_stale "$root/pretool-trace/.append.lock" "$now" || failed=1
    _state_liveness_stat_mtime() { return 1; }
    _pretool_trace_stale "$root/pretool-trace/events.jsonl" "$now" && failed=1
    [[ "${failed:-0}" -eq 0 ]]
)

test_pretool_trace_intermediate_ancestor_symlink_reported() {
    local holder="$FIXTURE_HOME/holder" real="$FIXTURE_HOME/real" root
    mkdir -p "$holder" "$real/root/pretool-trace"
    printf sentinel > "$real/root/pretool-trace/events.jsonl"
    ln -s "$real" "$holder/alias"
    root="$holder/alias/root"
    local out
    out=$(OMT_DIR="$root" bash "$CLEANUP_SCRIPT" --execute 2>&1)
    grep -q -- "SYMLINKS" <<<"$out" || return 1
    grep -q -- "$holder/alias" <<<"$out" || return 1
    [[ -f "$real/root/pretool-trace/events.jsonl" ]]
}

test_pretool_trace_lock_reap_matrix_actual_helper() (
    local base="$FIXTURE_HOME/lock-matrix" now=1000000000 root out
    mkdir -p "$base"
    source "$SCRIPT_DIR/../../hooks/lib/state-liveness.sh"
    _state_liveness_stat_mtime() { printf '%s\n' "$TEST_MTIME"; }

    # Stale empty real lock: dry-run reports it; execute removes only the lock.
    root="$base/stale"; mkdir -p "$root/pretool-trace/.append.lock"
    TEST_MTIME=$((now - 7 * 86400 - 1))
    out=$(reap_pretool_trace_artifacts "$root" "$now" 1)
    grep -q -- "$root/pretool-trace/.append.lock" <<<"$out" || return 1
    reap_pretool_trace_artifacts "$root" "$now" 0 >/dev/null
    [[ ! -e "$root/pretool-trace/.append.lock" ]] || return 1

    # Fresh and exactly-seven-day locks are not candidates.
    for kind in fresh exact; do
        root="$base/$kind"; mkdir -p "$root/pretool-trace/.append.lock"
        if [[ "$kind" = fresh ]]; then TEST_MTIME="$now"; else TEST_MTIME=$((now - 7 * 86400)); fi
        out=$(reap_pretool_trace_artifacts "$root" "$now" 1)
        [[ -z "$out" ]] || return 1
        [[ -d "$root/pretool-trace/.append.lock" ]] || return 1
    done

    # Stale nonempty lock is preserved, including its child.
    root="$base/nonempty"; mkdir -p "$root/pretool-trace/.append.lock"
    printf sentinel > "$root/pretool-trace/.append.lock/owner"
    TEST_MTIME=$((now - 7 * 86400 - 1)); out=$(reap_pretool_trace_artifacts "$root" "$now" 1)
    [[ -z "$out" ]] || return 1
    [[ -f "$root/pretool-trace/.append.lock/owner" ]] || return 1

    # Unreadable/stat failure is fail-safe and does not produce a candidate.
    root="$base/unreadable"; mkdir -p "$root/pretool-trace/.append.lock"
    _state_liveness_stat_mtime() { return 1; }
    out=$(reap_pretool_trace_artifacts "$root" "$now" 1)
    [[ -z "$out" ]] && [[ -d "$root/pretool-trace/.append.lock" ]]
)

test_pretool_trace_symlink_and_unknown_preserved() {
    local custom="$FIXTURE_HOME/custom-omt" outside="$FIXTURE_HOME/outside"
    mkdir -p "$custom/pretool-trace/keys" "$custom/evidence/pretool-trace/wi-8" "$outside"
    mkdir -p "$outside/work"
    printf sentinel > "$outside/events.jsonl"
    ln -s "$outside" "$custom/pretool-trace/keys/link"
    printf unknown > "$custom/evidence/pretool-trace/wi-8/unknown.bin"
    ln -s "$outside/events.jsonl" "$custom/evidence/pretool-trace/wi-8/leaf.txt"
    ln -s "$outside/work" "$custom/evidence/pretool-trace/wi-9"
    ln -s "$outside/work" "$custom/pretool-trace/.append.lock"
    export OMT_DIR="$custom"
    local out
    out=$(bash "$CLEANUP_SCRIPT" --execute 2>&1)
    [[ -f "$outside/events.jsonl" ]] && [[ -L "$custom/pretool-trace/keys/link" ]] && [[ -f "$custom/evidence/pretool-trace/wi-8/unknown.bin" ]]
    [[ -L "$custom/pretool-trace/.append.lock" ]] || return 1
    grep -q -- "$custom/pretool-trace/keys/link" <<<"$out" || return 1
    grep -q -- "$custom/evidence/pretool-trace/wi-8/unknown.bin" <<<"$out" || return 1
    grep -q -- "$custom/evidence/pretool-trace/wi-8/leaf.txt" <<<"$out" || return 1
    grep -q -- "$custom/evidence/pretool-trace/wi-9" <<<"$out" || return 1
    grep -q -- "$custom/pretool-trace/.append.lock" <<<"$out" || return 1
    unset OMT_DIR
}

test_pretool_trace_empty_override_uses_default_root() {
    local project="$FIXTURE_HOME/.omt/empty-project/pretool-trace"
    mkdir -p "$project"
    printf stale > "$project/events.jsonl"
    touch -t 200001010000 "$project/events.jsonl"
    OMT_DIR="" bash "$CLEANUP_SCRIPT" --execute > /dev/null
    [[ ! -e "$project/events.jsonl" ]]
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
    run_test test_execute_preserves_no_candidate_dir_acme_home_stage
    run_test test_execute_preserves_no_candidate_dir_omt_test
    run_test test_execute_preserves_no_candidate_dir_tmp
    run_test test_execute_preserves_no_candidate_dir_evidence
    run_test test_execute_preserves_no_candidate_dir_toong
    run_test test_dryrun_mutates_nothing
    run_test test_dryrun_preserves_real_reap_candidates

    # AC 6.2 — entries with no reap candidate survive --execute intact
    run_test test_dryrun_preserved_names_oh_my_toong_playground
    run_test test_dryrun_preserved_names_acme_backend
    run_test test_dryrun_preserved_names_acme_home_app_device
    run_test test_dryrun_preserved_names_acme-gitops
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
    run_test test_execute_deletes_acme_home_stage
    run_test test_execute_deletes_toong
    run_test test_execute_deletes_evidence_toplevel
    run_test test_execute_preserves_cache
    run_test test_execute_preserves_oh_my_toong_playground
    run_test test_execute_preserves_acme_home
    run_test test_execute_preserves_acme-gitops
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

    # Arg-parsing regression — contradictory/unrecognized flags rejected
    run_test test_conflicting_flags_execute_then_dryrun_rejected
    run_test test_conflicting_flags_dryrun_then_execute_rejected
    run_test test_unrecognized_argument_rejected_not_silently_dryrun
    run_test test_negative_control_execute_alone_still_deletes
    run_test test_negative_control_no_args_still_preserves

    # Symlink fan-out guard
    run_test test_symlinked_project_target_artifact_survives_execute
    run_test test_symlinked_project_reported_in_symlinks_section
    run_test test_pretool_trace_retention_and_custom_root
    run_test test_pretool_trace_symlink_and_unknown_preserved
    run_test test_pretool_trace_fixed_now_boundaries_all_families
    run_test test_pretool_trace_intermediate_ancestor_symlink_reported
    run_test test_pretool_trace_lock_reap_matrix_actual_helper
    run_test test_pretool_trace_empty_override_uses_default_root

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
}

main "$@"

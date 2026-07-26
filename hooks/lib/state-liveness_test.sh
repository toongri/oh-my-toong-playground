#!/bin/bash
# =============================================================================
# state-liveness.sh Tests
# TDD tests for the shared bash liveness predicate.
# Compatible with macOS Bash 3.2.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"

# ---------------------------------------------------------------------------
# Test harness
# ---------------------------------------------------------------------------
TESTS_PASSED=0
TESTS_FAILED=0

TEST_TMP_DIR=""

setup() {
  TEST_TMP_DIR=$(mktemp -d)
}

teardown() {
  if [ -n "$TEST_TMP_DIR" ] && [ -d "$TEST_TMP_DIR" ]; then
    rm -rf "$TEST_TMP_DIR"
  fi
  TEST_TMP_DIR=""
}

run_test() {
  local test_name="$1"
  setup
  if "$test_name"; then
    echo "[PASS] $test_name"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo "[FAIL] $test_name"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
  teardown
}

# Source the predicate under test
# shellcheck source=/dev/null
source "$SCRIPT_DIR/state-liveness.sh"

NOW=$(date +%s)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# write_state <file> <json>
write_state() {
  local file="$1"
  local json="$2"
  printf '%s\n' "$json" > "$file"
}

# iso_ago <seconds>  — ISO 8601 timestamp N seconds before NOW
iso_ago() {
  local secs="$1"
  local t=$((NOW - secs))
  # BSD date (macOS): date -r <epoch>; GNU date: date -d @<epoch>
  date -r "$t" "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || date -d "@$t" "+%Y-%m-%dT%H:%M:%S" 2>/dev/null
}

# iso_future <seconds>  — ISO 8601 timestamp N seconds AFTER NOW
iso_future() {
  local secs="$1"
  local t=$((NOW + secs))
  date -r "$t" "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || date -d "@$t" "+%Y-%m-%dT%H:%M:%S" 2>/dev/null
}

# touch_ago <file> <seconds>  — set a file's mtime to N seconds before NOW
# (BSD-compatible: touch -t [[CC]YY]MMDDhhmm[.ss])
touch_ago() {
  local file="$1"
  local secs="$2"
  local t=$((NOW - secs))
  local touch_arg
  touch_arg=$(date -r "$t" "+%Y%m%d%H%M.%S" 2>/dev/null || date -d "@$t" "+%Y%m%d%H%M.%S" 2>/dev/null)
  touch -t "$touch_arg" "$file"
}

# =============================================================================
# C1/C5: active + fresh last_touched_at survives even with old started_at
# =============================================================================

test_active_fresh_heartbeat_overrides_old_started_at() {
  local file="$TEST_TMP_DIR/state.json"
  local started_ago
  started_ago=$(iso_ago 18000)   # 5 hours ago — past ACTIVE_IDLE_TTL
  local touched_ago
  touched_ago=$(iso_ago 600)     # 10 minutes ago — well within ACTIVE_IDLE_TTL
  write_state "$file" "{\"active\":true,\"started_at\":\"$started_ago\",\"last_touched_at\":\"$touched_ago\"}"

  if is_state_live "$file" "$NOW"; then
    return 0
  else
    echo "  ASSERTION FAILED: active + fresh last_touched_at should be live (exit 0)"
    return 1
  fi
}

# =============================================================================
# C3: 4-row TTL fixture, each row asserted individually
# =============================================================================

test_c3_active_fresh_is_live() {
  local file="$TEST_TMP_DIR/state.json"
  local touched_ago
  touched_ago=$(iso_ago 600)   # 10 minutes — within ACTIVE_IDLE_TTL=21600
  write_state "$file" "{\"active\":true,\"last_touched_at\":\"$touched_ago\"}"

  if is_state_live "$file" "$NOW"; then
    return 0
  else
    echo "  ASSERTION FAILED: active + 10m heartbeat should be live"
    return 1
  fi
}

test_c3_active_stale_is_dead() {
  local file="$TEST_TMP_DIR/state.json"
  local touched_ago
  touched_ago=$(iso_ago 25200)   # 7 hours — past ACTIVE_IDLE_TTL=21600
  write_state "$file" "{\"active\":true,\"last_touched_at\":\"$touched_ago\"}"

  if ! is_state_live "$file" "$NOW"; then
    return 0
  else
    echo "  ASSERTION FAILED: active + 7h idle heartbeat should be dead"
    return 1
  fi
}

test_c3_terminal_fresh_is_live() {
  local file="$TEST_TMP_DIR/state.json"
  local touched_ago
  touched_ago=$(iso_ago 600)   # 10 minutes — within TERMINAL_TTL=1800
  write_state "$file" "{\"active\":false,\"last_touched_at\":\"$touched_ago\"}"

  if is_state_live "$file" "$NOW"; then
    return 0
  else
    echo "  ASSERTION FAILED: terminal + 10m heartbeat should be live"
    return 1
  fi
}

test_c3_terminal_stale_is_dead() {
  local file="$TEST_TMP_DIR/state.json"
  local touched_ago
  touched_ago=$(iso_ago 3600)   # 1 hour — past TERMINAL_TTL=1800
  write_state "$file" "{\"active\":false,\"last_touched_at\":\"$touched_ago\"}"

  if ! is_state_live "$file" "$NOW"; then
    return 0
  else
    echo "  ASSERTION FAILED: terminal + 1h idle heartbeat should be dead"
    return 1
  fi
}

# =============================================================================
# C7: future last_touched_at (clock skew) treated live, no stderr
# =============================================================================

test_c7_clock_skew_future_timestamp_is_live_no_stderr() {
  local file="$TEST_TMP_DIR/state.json"
  local future_ts
  future_ts=$(iso_future 3600)   # 1 hour in the future
  write_state "$file" "{\"active\":true,\"last_touched_at\":\"$future_ts\"}"

  local stderr_out
  stderr_out=$(is_state_live "$file" "$NOW" 2>&1 1>/dev/null) || true

  if ! is_state_live "$file" "$NOW" 2>/dev/null; then
    echo "  ASSERTION FAILED: clock-skew (future timestamp) should be live (exit 0)"
    return 1
  fi
  if [ -n "$stderr_out" ]; then
    echo "  ASSERTION FAILED: should produce no stderr on clock skew; got: '$stderr_out'"
    return 1
  fi
  return 0
}

# =============================================================================
# C5: verdict flips with last_touched_at, not started_at
# =============================================================================

test_c5_old_started_at_fresh_heartbeat_is_live() {
  local file="$TEST_TMP_DIR/state.json"
  local started_ago
  started_ago=$(iso_ago 86400)   # 24 hours — very old
  local touched_ago
  touched_ago=$(iso_ago 600)     # 10 minutes — fresh heartbeat
  write_state "$file" "{\"active\":true,\"started_at\":\"$started_ago\",\"last_touched_at\":\"$touched_ago\"}"

  if is_state_live "$file" "$NOW"; then
    return 0
  else
    echo "  ASSERTION FAILED: old started_at + fresh heartbeat should be live"
    return 1
  fi
}

test_c5_fresh_started_at_old_heartbeat_is_dead() {
  local file="$TEST_TMP_DIR/state.json"
  local started_ago
  started_ago=$(iso_ago 600)     # 10 minutes — fresh
  local touched_ago
  touched_ago=$(iso_ago 25200)   # 7 hours — stale heartbeat
  write_state "$file" "{\"active\":true,\"started_at\":\"$started_ago\",\"last_touched_at\":\"$touched_ago\"}"

  if ! is_state_live "$file" "$NOW"; then
    return 0
  else
    echo "  ASSERTION FAILED: fresh started_at + stale heartbeat should be dead"
    return 1
  fi
}

# =============================================================================
# Transition-era: fallback to started_at when last_touched_at absent
# =============================================================================

test_fallback_to_started_at_when_no_heartbeat_fresh() {
  local file="$TEST_TMP_DIR/state.json"
  local started_ago
  started_ago=$(iso_ago 600)   # 10 minutes — fresh
  write_state "$file" "{\"active\":true,\"started_at\":\"$started_ago\"}"

  if is_state_live "$file" "$NOW"; then
    return 0
  else
    echo "  ASSERTION FAILED: no last_touched_at, fresh started_at should be live"
    return 1
  fi
}

test_fallback_to_started_at_when_no_heartbeat_stale() {
  local file="$TEST_TMP_DIR/state.json"
  local started_ago
  started_ago=$(iso_ago 25200)   # 7 hours — stale
  write_state "$file" "{\"active\":true,\"started_at\":\"$started_ago\"}"

  if ! is_state_live "$file" "$NOW"; then
    return 0
  else
    echo "  ASSERTION FAILED: no last_touched_at, stale started_at should be dead"
    return 1
  fi
}

# =============================================================================
# Transition-era: fallback to file mtime when no timestamps at all
# =============================================================================

test_fallback_to_mtime_when_no_timestamps_fresh() {
  local file="$TEST_TMP_DIR/state.json"
  write_state "$file" "{\"active\":true}"
  # mtime defaults to now when just written — should be fresh

  if is_state_live "$file" "$NOW"; then
    return 0
  else
    echo "  ASSERTION FAILED: no timestamps, fresh mtime should be live"
    return 1
  fi
}

test_fallback_to_mtime_when_no_timestamps_stale() {
  local file="$TEST_TMP_DIR/state.json"
  write_state "$file" "{\"active\":true}"
  touch_ago "$file" 25200   # 7 hours ago

  if ! is_state_live "$file" "$NOW"; then
    return 0
  else
    echo "  ASSERTION FAILED: no timestamps, stale mtime should be dead"
    return 1
  fi
}

# =============================================================================
# is_current_session — generalized sid-suffix matching
# =============================================================================

test_is_current_session_matches_filename_sid() {
  local file="$TEST_TMP_DIR/goal-state-abc123.json"
  write_state "$file" "{\"active\":true}"

  if is_current_session "$file" "abc123"; then
    return 0
  else
    echo "  ASSERTION FAILED: filename sid 'abc123' should match current sid 'abc123'"
    return 1
  fi
}

test_is_current_session_no_match_different_sid() {
  local file="$TEST_TMP_DIR/goal-state-abc123.json"
  write_state "$file" "{\"active\":true}"

  if ! is_current_session "$file" "xyz999"; then
    return 0
  else
    echo "  ASSERTION FAILED: filename sid 'abc123' should NOT match current sid 'xyz999'"
    return 1
  fi
}

test_is_current_session_matches_ultragoal_filename_sid() {
  local file="$TEST_TMP_DIR/ultragoal-state-abc123.json"
  write_state "$file" "{\"active\":true}"

  if is_current_session "$file" "abc123"; then
    return 0
  else
    echo "  ASSERTION FAILED: ultragoal-state filename sid 'abc123' should match current sid 'abc123'"
    return 1
  fi
}

# HEAD-RED probe (plan Review Digest row 2): HEAD's 5-prefix `case` sets
# file_sid="" for any non-state-prefixed name (e.g. goal-codereview-), so it
# misclassifies the running session's own artifact as belonging to another
# session. At HEAD, `! is_current_session ... "$sid"` succeeds (the bug is
# witnessed); after the sid-suffix generalization, is_current_session must
# itself report a match, i.e. this test must PASS post-change.
test_head_red_probe_artifact_prefix_matches_current_session() {
  local sid="probe-sid-1"
  local file="$TEST_TMP_DIR/goal-codereview-$sid.json"
  write_state "$file" "{}"

  if is_current_session "$file" "$sid"; then
    return 0
  else
    echo "  ASSERTION FAILED (HEAD-RED regression): goal-codereview-<sid>.json must match its own sid"
    return 1
  fi
}

# All 15 session-keyed forms on disk share one sid: 5 state prefixes + 6
# session-artifact whitelist prefixes + 4 unclassified/producerless forms.
# is_current_session must recognize every one of them, including the two
# double-extension .closed.bak forms and the extensionless block-count form.
test_is_current_session_recognizes_all_fifteen_forms() {
  local sid="form-sid-2"
  local d="$TEST_TMP_DIR"
  mkdir -p "$d/state"

  write_state "$d/goal-state-$sid.json" "{}"
  write_state "$d/ultragoal-state-$sid.json" "{}"
  write_state "$d/prometheus-state-$sid.json" "{}"
  write_state "$d/deep-interview-active-state-$sid.json" "{}"
  write_state "$d/qa-state-$sid.json" "{}"
  write_state "$d/codex-todo-$sid.json" "{}"
  write_state "$d/state/block-count-$sid" "1"
  write_state "$d/goal-verdict-$sid.json" "{}"
  write_state "$d/goal-codereview-$sid.json" "{}"
  write_state "$d/ultragoal-verdict-$sid.json" "{}"
  write_state "$d/ultragoal-codereview-$sid.json" "{}"
  write_state "$d/deep-interview-active-state-$sid.json.closed.bak" "{}"
  write_state "$d/prometheus-state-$sid.json.closed.bak" "{}"
  write_state "$d/handoff-consumed-$sid" "{}"
  write_state "$d/goal-review-context-$sid.json" "{}"

  local n=0
  local f
  for f in "$d"/*.json "$d"/*.json.closed.bak "$d/state/block-count-$sid" "$d/handoff-consumed-$sid"; do
    [ -f "$f" ] || continue
    if is_current_session "$f" "$sid"; then
      n=$((n + 1))
    fi
  done

  if [ "$n" -ne 15 ]; then
    echo "  ASSERTION FAILED: expected 15 forms to match sid '$sid', got $n"
    return 1
  fi

  if is_current_session "$d/goal-state-$sid.json" "other-sid"; then
    echo "  ASSERTION FAILED: goal-state-<sid>.json must NOT match a different sid"
    return 1
  fi

  if is_current_session "$d/deep-interview-active-state-$sid.json.closed.bak" "other-sid"; then
    echo "  ASSERTION FAILED: the .closed.bak double-extension form must NOT match a different sid"
    return 1
  fi

  return 0
}

test_is_current_session_empty_sid_preserves() {
  local file="$TEST_TMP_DIR/codex-todo-abc.json"
  write_state "$file" "{}"

  if is_current_session "$file" ""; then
    return 0
  else
    echo "  ASSERTION FAILED: empty current_sid must preserve (return 0) as a fail-safe"
    return 1
  fi
}

# =============================================================================
# is_artifact_live — mtime-only, ignores the .active field, fail-open
# =============================================================================

test_is_artifact_live_mtime_only_ignores_active_field() {
  local live_file="$TEST_TMP_DIR/codex-todo-y.json"
  local dead_file="$TEST_TMP_DIR/codex-todo-x.json"
  # Both carry active:false — if is_artifact_live consulted that field like
  # is_state_live does, both would be judged by TERMINAL_TTL (30m) instead of
  # ACTIVE_IDLE_TTL (6h).
  write_state "$live_file" "{\"active\":false}"
  write_state "$dead_file" "{\"active\":false}"
  touch_ago "$live_file" 3600     # 1 hour — dead under TERMINAL_TTL, live under ACTIVE_IDLE_TTL
  touch_ago "$dead_file" 25200    # 7 hours — dead under both TTLs

  if ! is_artifact_live "$live_file" "$NOW"; then
    echo "  ASSERTION FAILED: 1h-old artifact must be live under ACTIVE_IDLE_TTL regardless of active:false"
    return 1
  fi
  if is_artifact_live "$dead_file" "$NOW"; then
    echo "  ASSERTION FAILED: 7h-old artifact must be dead under ACTIVE_IDLE_TTL"
    return 1
  fi
  return 0
}

test_is_artifact_live_unreadable_mtime_fails_open() {
  # Nonexistent file: stat fails on both GNU and BSD forms, touched_epoch is
  # empty. The empty-value trap (`$(( now - "" ))` silently evaluating to
  # `now`, ~57 years old) must be guarded by an explicit -z check so the
  # fail direction stays "preserve", matching is_state_live's fail-open path.
  if is_artifact_live "$TEST_TMP_DIR/nonexistent-file.json" "$NOW"; then
    return 0
  else
    echo "  ASSERTION FAILED: unreadable mtime must fail open (return 0 / live)"
    return 1
  fi
}

# =============================================================================
# list_live_session_ids — live sids reported, dead sids omitted
# =============================================================================

test_list_live_session_ids_reports_live_omits_dead() {
  local d="$TEST_TMP_DIR"
  local live="live-sid-3"
  local dead="dead-sid-4"
  write_state "$d/goal-state-$live.json" "{\"active\":true,\"last_touched_at\":\"$(iso_ago 600)\"}"
  write_state "$d/goal-state-$dead.json" "{\"active\":true,\"last_touched_at\":\"$(iso_ago 25200)\"}"

  local out
  out=$(list_live_session_ids "$d")

  if ! printf '%s\n' "$out" | grep -qx "$live"; then
    echo "  ASSERTION FAILED: live sid '$live' must be reported"
    echo "  got: $out"
    return 1
  fi
  if printf '%s\n' "$out" | grep -qx "$dead"; then
    echo "  ASSERTION FAILED: dead sid '$dead' must NOT be reported"
    return 1
  fi
  return 0
}

test_list_live_session_ids_dedupes_across_prefixes() {
  local d="$TEST_TMP_DIR"
  local sid="dup-sid-5"
  write_state "$d/goal-state-$sid.json" "{\"active\":true,\"last_touched_at\":\"$(iso_ago 600)\"}"
  write_state "$d/ultragoal-state-$sid.json" "{\"active\":true,\"last_touched_at\":\"$(iso_ago 600)\"}"

  local out
  out=$(list_live_session_ids "$d")
  local count
  count=$(printf '%s\n' "$out" | grep -c -x "$sid" || true)

  if [ "$count" -ne 1 ]; then
    echo "  ASSERTION FAILED: sid '$sid' live under two prefixes must be reported once, got $count"
    return 1
  fi
  return 0
}

# =============================================================================
# list_unclassified_session_files — reports the 4 producerless forms, silent
# on files that match either whitelist
# =============================================================================

test_list_unclassified_reports_four_producerless_forms_only() {
  local d="$TEST_TMP_DIR"
  local uuid="550e8400-e29b-41d4-a716-446655440000"
  mkdir -p "$d/state"

  # 4 unclassified/producerless forms (no writer anywhere in the repo, so they
  # stay off the deletion whitelist and are only ever reported): must be reported.
  touch_ago "$d/goal-review-context-$uuid.json" 25200
  touch_ago "$d/handoff-consumed-$uuid" 25200
  touch_ago "$d/deep-interview-active-state-$uuid.json.closed.bak" 25200
  touch_ago "$d/prometheus-state-$uuid.json.closed.bak" 25200

  # Classified files: must stay silent.
  write_state "$d/goal-state-$uuid.json" "{\"active\":true}"
  write_state "$d/codex-todo-$uuid.json" "{}"
  write_state "$d/state/block-count-$uuid" "1"

  local out
  out=$(list_unclassified_session_files "$d")
  local n
  n=$(printf '%s\n' "$out" | grep -c '.' || true)

  if [ "$n" -ne 4 ]; then
    echo "  ASSERTION FAILED: expected exactly 4 unclassified files, got $n"
    echo "  got: $out"
    return 1
  fi

  local pat
  for pat in 'goal-review-context-' 'handoff-consumed-' 'deep-interview-active-state-.*closed.bak' 'prometheus-state-.*closed.bak'; do
    if ! printf '%s' "$out" | grep -q "$pat"; then
      echo "  ASSERTION FAILED: unclassified report missing pattern '$pat'"
      echo "  got: $out"
      return 1
    fi
  done

  if printf '%s' "$out" | grep -q 'goal-state-\|codex-todo-\|block-count-'; then
    echo "  ASSERTION FAILED: unclassified report must stay silent on classified files"
    echo "  got: $out"
    return 1
  fi

  return 0
}

# =============================================================================
# reap_dead_state_files — relocation equivalence with the pre-change inline
# 5-glob loop (verbatim copy of hooks/session-start.sh:134-147 at HEAD)
# =============================================================================

# old_inline_state_gc <dir> <sid> <now_epoch>
# Byte-for-byte reproduction of the loop this TODO relocates, so the two
# survivor sets can be diffed against the same fixture.
old_inline_state_gc() {
  local dir="$1"
  local sid="$2"
  local now_epoch="$3"
  local state_file
  for state_file in \
      "$dir"/goal-state-*.json \
      "$dir"/ultragoal-state-*.json \
      "$dir"/prometheus-state-*.json \
      "$dir"/deep-interview-active-state-*.json \
      "$dir"/qa-state-*.json; do
    [ -f "$state_file" ] || continue
    if is_current_session "$state_file" "$sid"; then
      continue
    fi
    if ! is_state_live "$state_file" "$now_epoch"; then
      rm -f "$state_file"
    fi
  done
}

seed_state_gc_fixture() {
  local d="$1"
  local current_sid="$2"
  write_state "$d/goal-state-$current_sid.json" "{\"active\":true,\"last_touched_at\":\"$(iso_ago 25200)\"}"   # current session, old — must survive
  write_state "$d/goal-state-other-live.json" "{\"active\":true,\"last_touched_at\":\"$(iso_ago 600)\"}"       # other session, fresh — survives
  write_state "$d/goal-state-other-dead.json" "{\"active\":true,\"last_touched_at\":\"$(iso_ago 25200)\"}"     # other session, stale — reaped
  write_state "$d/ultragoal-state-other-dead2.json" "{\"active\":true,\"last_touched_at\":\"$(iso_ago 25200)\"}" # other session, stale — reaped
  write_state "$d/deep-interview-active-state-other-dead.json.closed.bak" "{}"                                  # .closed.bak — never state-reaped
  touch_ago "$d/deep-interview-active-state-other-dead.json.closed.bak" 25200
}

test_reap_dead_state_files_relocation_equivalence() {
  local sid="reloc-sid-6"
  local now_epoch="$NOW"

  local d_old="$TEST_TMP_DIR/old"
  local d_new="$TEST_TMP_DIR/new"
  mkdir -p "$d_old" "$d_new"
  seed_state_gc_fixture "$d_old" "$sid"
  seed_state_gc_fixture "$d_new" "$sid"

  old_inline_state_gc "$d_old" "$sid" "$now_epoch"
  reap_dead_state_files "$d_new" "$sid" "$now_epoch" 0 > /dev/null

  local old_set new_set
  old_set=$(find "$d_old" -type f | sed "s#$d_old##" | sort)
  new_set=$(find "$d_new" -type f | sed "s#$d_new##" | sort)

  if [ "$old_set" != "$new_set" ]; then
    echo "  ASSERTION FAILED: reap_dead_state_files must reproduce the old inline loop's survivor set"
    echo "  old: $old_set"
    echo "  new: $new_set"
    return 1
  fi
  return 0
}

test_reap_dead_state_files_execute_mode_echoes_affected_paths() {
  local sid="exec-sid-7"
  local d="$TEST_TMP_DIR"
  seed_state_gc_fixture "$d" "$sid"

  local out
  out=$(reap_dead_state_files "$d" "$sid" "$NOW" 0)
  local n
  n=$(printf '%s\n' "$out" | grep -c '.' || true)

  if [ "$n" -ne 2 ]; then
    echo "  ASSERTION FAILED: expected 2 echoed deletions in execute mode, got $n"
    echo "  got: $out"
    return 1
  fi
  return 0
}

test_reap_dead_state_files_old_closed_bak_survives_json_anchor() {
  local sid="bak-sid-8"
  local d="$TEST_TMP_DIR"
  write_state "$d/deep-interview-active-state-other-$sid.json.closed.bak" "{}"
  touch_ago "$d/deep-interview-active-state-other-$sid.json.closed.bak" 25200

  reap_dead_state_files "$d" "current-$sid" "$NOW" 0 > /dev/null

  local remaining
  remaining=$(find "$d" -type f | wc -l | tr -d ' ')
  if [ "$remaining" != "1" ]; then
    echo "  ASSERTION FAILED: a 7h-old .closed.bak backup must survive state reap (json-anchored glob)"
    return 1
  fi
  return 0
}

# =============================================================================
# reap_session_artifacts
# =============================================================================

test_reap_session_artifacts_current_session_self_artifact_survives() {
  local sid="self-sid-9"
  local d="$TEST_TMP_DIR"
  local f="$d/goal-codereview-$sid.json"
  write_state "$f" "{}"
  touch_ago "$f" 25200   # 7h old — but belongs to the running session

  reap_session_artifacts "$d" "$sid" "$NOW" 0 > /dev/null

  if [ ! -f "$f" ]; then
    echo "  ASSERTION FAILED: current session's own stale artifact must survive"
    return 1
  fi
  return 0
}

test_reap_session_artifacts_other_live_session_survives_without_sid() {
  local sid="other-live-sid-10"
  local d="$TEST_TMP_DIR"
  write_state "$d/goal-state-$sid.json" "{\"active\":true,\"last_touched_at\":\"$(iso_ago 600)\"}"
  local artifact="$d/goal-verdict-$sid.json"
  write_state "$artifact" "{}"
  touch_ago "$artifact" 25200

  # __none__ sentinel: the caller (omt-cleanup) supplies no session id.
  reap_session_artifacts "$d" "__none__" "$NOW" 0 > /dev/null

  if [ ! -f "$artifact" ]; then
    echo "  ASSERTION FAILED: another session's artifact must survive via list_live_session_ids, not identity"
    return 1
  fi
  return 0
}

test_reap_session_artifacts_execute_mode_echoes_affected_paths() {
  local d="$TEST_TMP_DIR"
  local f="$d/codex-todo-dead-sid-11.json"
  write_state "$f" "{}"
  touch_ago "$f" 25200

  local out
  out=$(reap_session_artifacts "$d" "__none__" "$NOW" 0)
  local n
  n=$(printf '%s\n' "$out" | grep -c '.' || true)

  if [ "$n" -ne 1 ]; then
    echo "  ASSERTION FAILED: expected 1 echoed deletion in execute mode, got $n"
    echo "  got: $out"
    return 1
  fi
  return 0
}

test_reap_session_artifacts_json_extension_stripped_for_live_id_match() {
  local live="json-live-sid-12"
  local d="$TEST_TMP_DIR"
  write_state "$d/goal-state-$live.json" "{\"active\":true,\"last_touched_at\":\"$(iso_ago 600)\"}"
  local gv="$d/goal-verdict-$live.json"
  local uc="$d/ultragoal-codereview-$live.json"
  write_state "$gv" "{}"
  write_state "$uc" "{}"
  touch_ago "$gv" 25200
  touch_ago "$uc" 25200

  reap_session_artifacts "$d" "__none__" "$NOW" 0 > /dev/null

  if [ ! -f "$gv" ] || [ ! -f "$uc" ]; then
    echo "  ASSERTION FAILED: .json-series artifacts of a live session must survive (extension must be stripped before matching)"
    return 1
  fi
  return 0
}

test_reap_session_artifacts_short_live_id_does_not_falsely_preserve() {
  local live="abc"
  local d="$TEST_TMP_DIR"
  write_state "$d/goal-state-$live.json" "{\"active\":true,\"last_touched_at\":\"$(iso_ago 600)\"}"
  local unrelated="$d/codex-todo-xyzabc.json"
  write_state "$unrelated" "{}"
  touch_ago "$unrelated" 25200

  reap_session_artifacts "$d" "__none__" "$NOW" 0 > /dev/null

  if [ -f "$unrelated" ]; then
    echo "  ASSERTION FAILED: short live id '$live' must NOT falsely preserve unrelated 'codex-todo-xyzabc.json'"
    return 1
  fi
  return 0
}

test_reap_session_artifacts_namespaced_block_count_survives_none_lane() {
  local live="ns-sid-13"
  local d="$TEST_TMP_DIR"
  mkdir -p "$d/state"
  write_state "$d/goal-state-$live.json" "{\"active\":true,\"last_touched_at\":\"$(iso_ago 600)\"}"
  local base_bc="$d/state/block-count-$live"
  local ns_bc="$d/state/block-count-prometheus-$live"
  write_state "$base_bc" "1"
  write_state "$ns_bc" "2"
  touch_ago "$base_bc" 25200
  touch_ago "$ns_bc" 25200

  reap_session_artifacts "$d" "__none__" "$NOW" 0 > /dev/null

  if [ ! -f "$base_bc" ] || [ ! -f "$ns_bc" ]; then
    echo "  ASSERTION FAILED: namespaced block-count files of a live session must survive the __none__ lane"
    return 1
  fi
  return 0
}

# =============================================================================
# set -e harmlessness — no function may return non-zero on a harmless
# condition (empty dir), since this file is sourced by both a `set -e`
# caller (omt-cleanup.sh) and a non-`set -e` caller (session-start.sh).
# =============================================================================

test_harmless_conditions_do_not_trip_set_e() {
  local d="$TEST_TMP_DIR/empty-dir"
  mkdir -p "$d"
  local sid="harmless-sid-14"

  local out
  out=$(bash -c '
    set -euo pipefail
    source "'"$SCRIPT_DIR"'/state-liveness.sh"
    reap_dead_state_files "'"$d"'" "'"$sid"'" 0 1
    reap_session_artifacts "'"$d"'" "'"$sid"'" 0 1
    list_unclassified_session_files "'"$d"'"
    list_live_session_ids "'"$d"'"
    echo SURVIVED
  ')

  if ! printf '%s' "$out" | grep -q SURVIVED; then
    echo "  ASSERTION FAILED: harmless conditions (empty dir) must not trip set -e in a set -e caller"
    echo "  got: $out"
    return 1
  fi
  return 0
}

# =============================================================================
# STATE_PREFIXES structural assertion (relocated from
# hooks/session-start_test.sh:800-841 test_gc_glob_only_managed_prefixes,
# which asserted the same thing about the pre-relocation inline glob list)
# =============================================================================

test_state_prefixes_exactly_five_managed() {
  local count
  count=$(printf '%s\n' $STATE_PREFIXES | grep -c '.' 2>/dev/null || true)
  if [ "$count" -ne 5 ]; then
    echo "  ASSERTION FAILED: STATE_PREFIXES must have exactly 5 entries, found $count"
    echo "  STATE_PREFIXES=$STATE_PREFIXES"
    return 1
  fi

  local prefix
  for prefix in goal-state- ultragoal-state- prometheus-state- deep-interview-active-state- qa-state-; do
    local n
    n=$(printf '%s\n' $STATE_PREFIXES | grep -c "^${prefix}\$" 2>/dev/null || true)
    if [ "$n" -ne 1 ]; then
      echo "  ASSERTION FAILED: STATE_PREFIXES must contain '$prefix' exactly once, found $n"
      return 1
    fi
  done

  if printf '%s\n' $STATE_PREFIXES | grep -q 'ralph-state'; then
    echo "  ASSERTION FAILED: STATE_PREFIXES must NOT include the retired ralph-state prefix"
    return 1
  fi

  return 0
}

# =============================================================================
# TTL-parity: bash constants equal TS constants in lib/state-core.ts
# =============================================================================

test_ttl_parity_with_state_core_ts() {
  local state_core="$REPO_ROOT/lib/state-core.ts"

  if [ ! -f "$state_core" ]; then
    echo "  ASSERTION FAILED: lib/state-core.ts not found at '$state_core'"
    return 1
  fi

  # Extract bash constants
  local bash_active_ttl
  bash_active_ttl=$(grep -E '^ACTIVE_IDLE_TTL=' "$SCRIPT_DIR/state-liveness.sh" | head -1 | grep -oE '[0-9]+' | head -1)
  local bash_terminal_ttl
  bash_terminal_ttl=$(grep -E '^TERMINAL_TTL=' "$SCRIPT_DIR/state-liveness.sh" | head -1 | grep -oE '[0-9]+' | head -1)

  # Extract TS constants: look for "export const ACTIVE_IDLE_TTL = <number>" pattern
  local ts_active_ttl
  ts_active_ttl=$(grep -E 'ACTIVE_IDLE_TTL_SECONDS[[:space:]]*=' "$state_core" | grep -oE '[0-9]+' | head -1)
  local ts_terminal_ttl
  ts_terminal_ttl=$(grep -E 'TERMINAL_TTL_SECONDS[[:space:]]*=' "$state_core" | grep -oE '[0-9]+' | head -1)

  local ok=1

  if [ "$bash_active_ttl" != "21600" ]; then
    echo "  ASSERTION FAILED: bash ACTIVE_IDLE_TTL should be 21600, got '$bash_active_ttl'"
    ok=0
  fi
  if [ "$bash_terminal_ttl" != "1800" ]; then
    echo "  ASSERTION FAILED: bash TERMINAL_TTL should be 1800, got '$bash_terminal_ttl'"
    ok=0
  fi
  if [ "$ts_active_ttl" != "21600" ]; then
    echo "  ASSERTION FAILED: TS ACTIVE_IDLE_TTL should be 21600, got '$ts_active_ttl'"
    ok=0
  fi
  if [ "$ts_terminal_ttl" != "1800" ]; then
    echo "  ASSERTION FAILED: TS TERMINAL_TTL should be 1800, got '$ts_terminal_ttl'"
    ok=0
  fi
  if [ "$bash_active_ttl" != "$ts_active_ttl" ]; then
    echo "  ASSERTION FAILED: ACTIVE_IDLE_TTL parity: bash=$bash_active_ttl, ts=$ts_active_ttl"
    ok=0
  fi
  if [ "$bash_terminal_ttl" != "$ts_terminal_ttl" ]; then
    echo "  ASSERTION FAILED: TERMINAL_TTL parity: bash=$bash_terminal_ttl, ts=$ts_terminal_ttl"
    ok=0
  fi

  [ "$ok" = "1" ]
}

# =============================================================================
# TTL-allowlist: no stray TTL literals outside allowlist
# =============================================================================

test_ttl_allowlist_no_stray_literals() {
  # Search for 21600 or 1800 in .sh and .ts files in hooks/, lib/, skills/, scripts/
  # Exclude the two definition files and their test counterparts
  local found
  found=$(grep -rlnE '\b(21600|1800)\b' \
    --include='*.sh' --include='*.ts' \
    "$REPO_ROOT/hooks/" "$REPO_ROOT/lib/" "$REPO_ROOT/skills/" "$REPO_ROOT/scripts/" 2>/dev/null \
    | grep -vE 'state-liveness|state-core' || true)

  if [ -z "$found" ]; then
    return 0
  else
    echo "  ASSERTION FAILED: TTL literals 21600/1800 found outside allowlist:"
    echo "$found" | sed 's/^/    /'
    return 1
  fi
}

# =============================================================================
# Run all tests
# =============================================================================

run_test test_active_fresh_heartbeat_overrides_old_started_at
run_test test_c3_active_fresh_is_live
run_test test_c3_active_stale_is_dead
run_test test_c3_terminal_fresh_is_live
run_test test_c3_terminal_stale_is_dead
run_test test_c7_clock_skew_future_timestamp_is_live_no_stderr
run_test test_c5_old_started_at_fresh_heartbeat_is_live
run_test test_c5_fresh_started_at_old_heartbeat_is_dead
run_test test_fallback_to_started_at_when_no_heartbeat_fresh
run_test test_fallback_to_started_at_when_no_heartbeat_stale
run_test test_fallback_to_mtime_when_no_timestamps_fresh
run_test test_fallback_to_mtime_when_no_timestamps_stale
run_test test_is_current_session_matches_filename_sid
run_test test_is_current_session_no_match_different_sid
run_test test_is_current_session_matches_ultragoal_filename_sid
run_test test_head_red_probe_artifact_prefix_matches_current_session
run_test test_is_current_session_recognizes_all_fifteen_forms
run_test test_is_current_session_empty_sid_preserves
run_test test_is_artifact_live_mtime_only_ignores_active_field
run_test test_is_artifact_live_unreadable_mtime_fails_open
run_test test_list_live_session_ids_reports_live_omits_dead
run_test test_list_live_session_ids_dedupes_across_prefixes
run_test test_list_unclassified_reports_four_producerless_forms_only
run_test test_reap_dead_state_files_relocation_equivalence
run_test test_reap_dead_state_files_execute_mode_echoes_affected_paths
run_test test_reap_dead_state_files_old_closed_bak_survives_json_anchor
run_test test_reap_session_artifacts_current_session_self_artifact_survives
run_test test_reap_session_artifacts_other_live_session_survives_without_sid
run_test test_reap_session_artifacts_execute_mode_echoes_affected_paths
run_test test_reap_session_artifacts_json_extension_stripped_for_live_id_match
run_test test_reap_session_artifacts_short_live_id_does_not_falsely_preserve
run_test test_reap_session_artifacts_namespaced_block_count_survives_none_lane
run_test test_harmless_conditions_do_not_trip_set_e
run_test test_state_prefixes_exactly_five_managed
run_test test_ttl_parity_with_state_core_ts
run_test test_ttl_allowlist_no_stray_literals

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"

if [ "$TESTS_FAILED" -gt 0 ]; then
  exit 1
fi
exit 0

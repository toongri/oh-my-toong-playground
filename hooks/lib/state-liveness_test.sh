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
# Defect coverage: is_state_live's OWN ACTIVE_IDLE_TTL boundary (:126,
# `[ "$age" -lt "$ACTIVE_IDLE_TTL" ]` inside the active:true branch), pinned
# independently of is_artifact_live's identically-worded boundary check at
# :219 (test_is_artifact_live_ttl_boundary_is_dead below). Both functions
# read the same $ACTIVE_IDLE_TTL constant but on separate lines with separate
# `-lt` operators — a `-lt` -> `-le` mutation on one line does not touch the
# other, so each boundary needs its own dedicated fixture calling its own
# function; a test that exercises only one function proves nothing about the
# other's boundary. No other fixture in this file drives is_state_live with
# age exactly equal to ACTIVE_IDLE_TTL — every other active-branch row here
# (e.g. test_c3_active_stale_is_dead) uses an age comfortably past the TTL,
# never exactly on it. Uses the sourced $ACTIVE_IDLE_TTL constant, never the
# literal 21600.
# =============================================================================

test_is_state_live_active_ttl_boundary_is_dead() {
  local file="$TEST_TMP_DIR/state.json"
  local touched_ago
  touched_ago=$(iso_ago "$ACTIVE_IDLE_TTL")   # age == ACTIVE_IDLE_TTL exactly
  write_state "$file" "{\"active\":true,\"last_touched_at\":\"$touched_ago\"}"

  if is_state_live "$file" "$NOW"; then
    echo "  ASSERTION FAILED: an active state file exactly ACTIVE_IDLE_TTL seconds old must be dead (age < TTL is the live condition; age == TTL is not < TTL)"
    return 1
  fi
  return 0
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

# Defect coverage: `${current_sid}` MUST stay quoted inside the case
# patterns (:174-181 above) — quoting a variable's expansion inside a case
# pattern is what forces its characters to be matched literally rather than
# reinterpreted as glob metacharacters. Two separate fixtures isolate the two
# quoted occurrences independently: the extensionless pattern
# (`*-"$current_sid")`) and the extension-form pattern
# (`*-"$current_sid".*)`) — removing either quote alone still leaves the
# other quoted occurrence to (incorrectly) pass its own fixture, so a single
# combined fixture could miss a single-line-quote-removal mutation.
#
# The sid "x?y" embeds a glob metachar ('?' = match-any-single-char). Neither
# fixture's basename literally contains "x?y" (both use "xzy" instead) — with
# correct quoting the comparison is literal and must NOT match. With the
# quote removed, "?" is reinterpreted as a wildcard and "xzy" wrongly
# satisfies it, flipping the verdict to a false match.

test_is_current_session_sid_quoting_prevents_glob_metachar_false_match_extensionless() {
  local sid='x?y'
  # Extensionless form -> exercises the `*-"$current_sid")` pattern (:175).
  local file="$TEST_TMP_DIR/state/block-count-xzy"

  if is_current_session "$file" "$sid"; then
    echo "  ASSERTION FAILED: sid '$sid' (glob metachar '?') must be matched literally against the extensionless form — 'block-count-xzy' does not end with the literal string 'x?y' and must NOT match"
    return 1
  fi
  return 0
}

test_is_current_session_sid_quoting_prevents_glob_metachar_false_match_extension_form() {
  local sid='x?y'
  # .json extension form -> exercises the `*-"$current_sid".*)` pattern (:177).
  local file="$TEST_TMP_DIR/goal-state-xzy.json"

  if is_current_session "$file" "$sid"; then
    echo "  ASSERTION FAILED: sid '$sid' (glob metachar '?') must be matched literally against the extension form — 'goal-state-xzy.json' does not end with the literal string 'x?y' before its extension and must NOT match"
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

# Defect coverage: TTL-boundary direction. is_artifact_live's rule is
# `age < ACTIVE_IDLE_TTL` -> live; at age == ACTIVE_IDLE_TTL exactly, that is
# NOT "less than", so the boundary itself must be dead. A `<` -> `<=` mutation
# would flip this exact boundary row (and only this row) to live, which no
# other test in this file exercises — every other is_artifact_live fixture
# uses an age comfortably inside or outside the TTL, never exactly on it.
# Uses the sourced $ACTIVE_IDLE_TTL constant, never the literal 21600.
test_is_artifact_live_ttl_boundary_is_dead() {
  local file="$TEST_TMP_DIR/codex-todo-boundary-sid.json"
  write_state "$file" "{}"
  touch_ago "$file" "$ACTIVE_IDLE_TTL"   # age == ACTIVE_IDLE_TTL exactly

  if is_artifact_live "$file" "$NOW"; then
    echo "  ASSERTION FAILED: an artifact exactly ACTIVE_IDLE_TTL seconds old must be dead (age < TTL is the live condition; age == TTL is not < TTL)"
    return 1
  fi
  return 0
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
  out=$(list_live_session_ids "$d" "$NOW")

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
  out=$(list_live_session_ids "$d" "$NOW")
  local count
  count=$(printf '%s\n' "$out" | grep -c -x "$sid" || true)

  if [ "$count" -ne 1 ]; then
    echo "  ASSERTION FAILED: sid '$sid' live under two prefixes must be reported once, got $count"
    return 1
  fi
  return 0
}

# =============================================================================
# Defect: unquoted glob-pattern prefix stripping (SC2295). `${f#$dir/$prefix}`
# treats the right-hand side of `#` as a glob pattern, not a literal string.
# A directory name containing a glob metacharacter (e.g. "proj[1]") then
# fails to match as a prefix at all, so the "sid" becomes the entire file
# path — corrupting every downstream live-id comparison and, in
# reap_session_artifacts, destructively reaping a live session's own
# artifacts because its sid is never recognized as live.
# =============================================================================

test_list_live_session_ids_strips_prefix_in_glob_metachar_dir() {
  local d="$TEST_TMP_DIR/proj[1]"
  mkdir -p "$d"
  local sid="glob-sid-15"
  write_state "$d/goal-state-$sid.json" "{\"active\":true,\"last_touched_at\":\"$(iso_ago 600)\"}"

  local out
  out=$(list_live_session_ids "$d" "$NOW")

  if ! printf '%s\n' "$out" | grep -qx "$sid"; then
    echo "  ASSERTION FAILED: expected bare sid '$sid' from a glob-metachar directory, got: $out"
    return 1
  fi
  return 0
}

test_reap_session_artifacts_survives_live_session_in_glob_metachar_dir() {
  local d="$TEST_TMP_DIR/proj[1]"
  mkdir -p "$d"
  local sid="glob-sid-16"
  write_state "$d/goal-state-$sid.json" "{\"active\":true,\"last_touched_at\":\"$(iso_ago 600)\"}"
  local artifact="$d/goal-verdict-$sid.json"
  write_state "$artifact" "{}"
  touch_ago "$artifact" 25200

  reap_session_artifacts "$d" "__none__" "$NOW" 0 > /dev/null

  if [ ! -f "$artifact" ]; then
    echo "  ASSERTION FAILED: a live session's artifact must survive even when its directory contains a glob metacharacter like '['"
    return 1
  fi
  return 0
}

# =============================================================================
# Defect: two independently-read clocks in one GC pass. list_live_session_ids
# used to call `date +%s` internally instead of accepting the caller's
# now_epoch, so reap_session_artifacts's own now_epoch and the live-id
# computation it depends on could read wall-clock time at two different
# instants — letting a session flip sides of a TTL boundary between the two
# reads within a single pass.
# =============================================================================

test_list_live_session_ids_respects_provided_now_epoch_not_wall_clock() {
  local d="$TEST_TMP_DIR"
  local sid="clock-sid-17"
  # Fresh under the real wall clock (10 minutes old).
  write_state "$d/goal-state-$sid.json" "{\"active\":true,\"last_touched_at\":\"$(iso_ago 600)\"}"

  # An explicit now_epoch far beyond ACTIVE_IDLE_TTL relative to the file's
  # real touched time. If the function honors this parameter instead of
  # calling `date +%s` internally, the session must be judged dead.
  local far_future=$((NOW + ACTIVE_IDLE_TTL + 3600))
  local out
  out=$(list_live_session_ids "$d" "$far_future")

  if printf '%s\n' "$out" | grep -qx "$sid"; then
    echo "  ASSERTION FAILED: list_live_session_ids must use the provided now_epoch, not its own internal date +%s wall clock"
    return 1
  fi
  return 0
}

test_reap_session_artifacts_uses_own_now_epoch_not_internal_wall_clock() {
  local d="$TEST_TMP_DIR"
  local sid="clock-sid-18"
  # Fresh under the real wall clock (500 seconds old).
  write_state "$d/goal-state-$sid.json" "{\"active\":true,\"last_touched_at\":\"$(iso_ago 500)\"}"
  local artifact="$d/goal-verdict-$sid.json"
  write_state "$artifact" "{}"
  # Fresh real mtime too, so is_artifact_live's OWN now_epoch argument (which
  # was never the buggy part) independently judges it dead only because we
  # pass a far-future now_epoch below — isolating this assertion to whether
  # that same now_epoch also reaches list_live_session_ids.
  touch_ago "$artifact" 0

  local far_future=$((NOW + ACTIVE_IDLE_TTL + 3600))
  reap_session_artifacts "$d" "__none__" "$far_future" 0 > /dev/null

  if [ -f "$artifact" ]; then
    echo "  ASSERTION FAILED: reap_session_artifacts must feed its OWN now_epoch into list_live_session_ids instead of a separately-fetched wall clock; one now_epoch must judge state and artifact liveness consistently within a single GC pass"
    return 1
  fi
  return 0
}

# =============================================================================
# list_unclassified_session_files — reports genuine drift, which now
# includes `.closed.bak` backups of a STATE_PREFIXES family
# (deep-interview-active-state-*.json.closed.bak,
# prometheus-state-*.json.closed.bak): neither reap function ever touches
# this form (the backup form STATE_PREFIXES's own `*.json` anchor, :16-19,
# is what preserves it from deletion), so the reporter is the only place its
# growth becomes visible — see the plan's decision record naming it
# reporter-only. session-ledger-*.md is the one remaining classification-only
# exception that DOES stay silent: it is reaped by its own dedicated,
# `.md`-only lane in hooks/session-start.sh, not by this file's reap
# functions, so it is deliberately absent from the deletion whitelist — a
# non-`.md` session-ledger-* form is NOT exempted and must still surface as
# drift. This exception changes what gets deleted — only what gets reported
# as drift.
# =============================================================================

test_list_unclassified_reports_genuine_drift_only() {
  local d="$TEST_TMP_DIR"
  local uuid="550e8400-e29b-41d4-a716-446655440000"
  mkdir -p "$d/state"

  # Genuinely unclassified/producerless forms (no writer anywhere in the
  # repo, so they stay off both reap whitelists and are only ever reported),
  # plus the two `.closed.bak` backup families (reaped by no lane, reporter-
  # only per the plan): must be reported. list_unclassified_session_files
  # has no age logic at all, so these use write_state (existence only), not
  # touch_ago.
  write_state "$d/goal-review-context-$uuid.json" "{}"
  write_state "$d/handoff-consumed-$uuid" ""
  write_state "$d/handoff-$uuid" ""
  write_state "$d/deep-interview-active-state-$uuid.json.closed.bak" "{}"
  write_state "$d/prometheus-state-$uuid.json.closed.bak" "{}"

  # Classified via the reap whitelists directly: must stay silent.
  write_state "$d/goal-state-$uuid.json" "{\"active\":true}"
  write_state "$d/codex-todo-$uuid.json" "{}"
  write_state "$d/state/block-count-$uuid" "1"

  # Classification-only exception (not in either reap whitelist, but a known
  # family reaped by its own dedicated lane per the doc comment above): must
  # stay silent.
  write_state "$d/session-ledger-$uuid.md" ""

  local out
  out=$(list_unclassified_session_files "$d")
  local n
  n=$(printf '%s\n' "$out" | grep -c '.' || true)

  if [ "$n" -ne 5 ]; then
    echo "  ASSERTION FAILED: expected exactly 5 unclassified files, got $n"
    echo "  got: $out"
    return 1
  fi

  local pat
  for pat in 'goal-review-context-' 'handoff-consumed-' 'handoff-' \
             'deep-interview-active-state-.*closed.bak' 'prometheus-state-.*closed.bak'; do
    if ! printf '%s' "$out" | grep -q "$pat"; then
      echo "  ASSERTION FAILED: unclassified report missing pattern '$pat'"
      echo "  got: $out"
      return 1
    fi
  done

  if printf '%s' "$out" | grep -q 'goal-state-\|codex-todo-\|block-count-\|session-ledger-'; then
    echo "  ASSERTION FAILED: unclassified report must stay silent on classified files, including the session-ledger classification-only exception"
    echo "  got: $out"
    return 1
  fi

  return 0
}

# Defect: the session-ledger classification exception was anchored on the
# bare prefix (`session-ledger-*`), wider than the lane that actually reaps
# it — hooks/session-start.sh's ledger loop is `.md`-only
# (`session-ledger-*.md`). A non-`.md` form (e.g. an interrupted append's
# `.tmp`) was silently exempted from drift reporting by that mismatch even
# though no lane reaps it, so it would accumulate forever, invisibly.
test_list_unclassified_reports_non_md_session_ledger_as_drift() {
  local d="$TEST_TMP_DIR"
  local uuid="7c9e6679-7425-40de-944b-e07fc1f90ae7"

  write_state "$d/session-ledger-$uuid.tmp" ""
  write_state "$d/session-ledger-$uuid.md" ""

  local out
  out=$(list_unclassified_session_files "$d")

  if ! printf '%s' "$out" | grep -q "session-ledger-$uuid.tmp"; then
    echo "  ASSERTION FAILED: a non-.md session-ledger-* file (e.g. an interrupted append's .tmp) must surface as drift — no lane reaps it"
    echo "  got: $out"
    return 1
  fi

  if printf '%s' "$out" | grep -q "session-ledger-$uuid.md"; then
    echo "  ASSERTION FAILED: session-ledger-*.md must stay silent (reaped by hooks/session-start.sh's dedicated .md-only lane)"
    echo "  got: $out"
    return 1
  fi

  return 0
}

# Defect: the drift sweep never looked inside state/, even though
# SESSION_ARTIFACT_PREFIXES itself has a subdirectory-based entry
# (state/block-count-) — an unclassified file under state/ went unreported
# forever. Fixture covers both namespaces in one call: a top-level
# unclassified file, an unclassified file under state/, and a classified
# state/block-count- file that must stay silent even now that state/ is swept.
test_list_unclassified_reports_files_under_state_subdir_too() {
  local d="$TEST_TMP_DIR"
  local uuid="6ba7b810-9dad-11d1-80b4-00c04fd430c8"
  mkdir -p "$d/state"

  touch_ago "$d/state/mystery-$uuid" 25200
  write_state "$d/state/block-count-$uuid" "1"
  touch_ago "$d/handoff-consumed-$uuid" 25200

  local out
  out=$(list_unclassified_session_files "$d")
  local n
  n=$(printf '%s\n' "$out" | grep -c '.' || true)

  if [ "$n" -ne 2 ]; then
    echo "  ASSERTION FAILED: expected 2 unclassified files (one top-level, one under state/), got $n"
    echo "  got: $out"
    return 1
  fi

  if ! printf '%s' "$out" | grep -q 'state/mystery-'; then
    echo "  ASSERTION FAILED: unclassified report missing the state/ subdirectory file"
    echo "  got: $out"
    return 1
  fi

  if printf '%s' "$out" | grep -q 'block-count-'; then
    echo "  ASSERTION FAILED: state/block-count- must stay classified (silent) even though state/ is now swept"
    echo "  got: $out"
    return 1
  fi

  return 0
}

# =============================================================================
# Plan AC (RED probe): list_unclassified_session_files must report all FOUR
# producerless/never-reaped forms named in the plan's decision record
# (~/.omt/oh-my-toong-playground/plans/presentation/omt-session-artifact-gc-and-heartbeat.md:832-838)
# — goal-review-context-, handoff-consumed-, and BOTH .closed.bak backup
# families (deep-interview-active-state-*.json.closed.bak,
# prometheus-state-*.json.closed.bak). At HEAD the .closed.bak tail-strip
# misclassifies the latter two as belonging to their STATE_PREFIXES family
# and silently drops them from the report — this test reproduces the plan's
# own acceptance-criteria command verbatim against a 4-file fixture and must
# see exactly 4 lines, one per pattern.
# =============================================================================

test_list_unclassified_reports_all_four_plan_ac_forms() {
  local d="$TEST_TMP_DIR"
  local uuid="b7c1a2d4-5e6f-4a1b-9c3d-2f8e7a6b5c4d"

  write_state "$d/goal-review-context-$uuid.json" "{}"
  write_state "$d/handoff-consumed-$uuid" ""
  write_state "$d/deep-interview-active-state-$uuid.json.closed.bak" "{}"
  write_state "$d/prometheus-state-$uuid.json.closed.bak" "{}"

  local out
  out=$(list_unclassified_session_files "$d")

  if [ "$(printf '%s\n' "$out" | grep -c .)" -ne 4 ]; then
    echo "  ASSERTION FAILED: expected exactly 4 unclassified files per plan AC, got $(printf '%s\n' "$out" | grep -c .)"
    echo "  got: $out"
    return 1
  fi

  local pat
  for pat in goal-review-context- handoff-consumed- \
             'deep-interview-active-state-.*closed.bak' 'prometheus-state-.*closed.bak'; do
    if ! printf '%s' "$out" | grep -q "$pat"; then
      echo "  ASSERTION FAILED: plan AC pattern '$pat' missing from report"
      echo "  got: $out"
      return 1
    fi
  done

  return 0
}

# =============================================================================
# reap_dead_state_files — relocation equivalence with the pre-change inline
# 5-glob loop (verbatim copy of hooks/session-start.sh:134-147 at HEAD)
# =============================================================================

# old_is_current_session_base <file> <current_sid>
# Verbatim reproduction of is_current_session as it existed at commit
# d215e9ce (`git show d215e9ce:hooks/lib/state-liveness.sh`) — exact match
# per known prefix, not the current file's suffix match. Kept independent of
# (never calls) the current is_current_session, so old_inline_state_gc below
# is a genuinely independent reference implementation: if it called the
# current function instead, the relocation-equivalence test below would only
# prove loop-structure equivalence, not verdict equivalence, and could not
# detect is_current_session's own exact-match -> suffix-match behavior change.
old_is_current_session_base() {
  local file="$1"
  local current_sid="$2"

  local basename_val
  basename_val=$(basename "$file" .json)

  local file_sid
  case "$basename_val" in
    goal-state-*)
      file_sid="${basename_val#goal-state-}" ;;
    ultragoal-state-*)
      file_sid="${basename_val#ultragoal-state-}" ;;
    prometheus-state-*)
      file_sid="${basename_val#prometheus-state-}" ;;
    deep-interview-active-state-*)
      file_sid="${basename_val#deep-interview-active-state-}" ;;
    qa-state-*)
      file_sid="${basename_val#qa-state-}" ;;
    *)
      file_sid="" ;;
  esac

  if [ "$file_sid" = "$current_sid" ]; then
    return 0
  else
    return 1
  fi
}

# old_inline_state_gc <dir> <sid> <now_epoch>
# Byte-for-byte reproduction of the loop this TODO relocates, so the two
# survivor sets can be diffed against the same fixture. Uses
# old_is_current_session_base (above), NOT the current is_current_session, so
# the comparison below is a real independent-implementation diff rather than
# two copies of the same predicate.
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
    if old_is_current_session_base "$state_file" "$sid"; then
      continue
    fi
    if ! is_state_live "$state_file" "$now_epoch"; then
      rm -f "$state_file"
    fi
  done
}

# Documented divergence: is_current_session moved from an exact per-prefix
# match (base, commit d215e9ce) to a suffix match, to also cover the
# extensionless state/block-count-<sid> form. This deliberately widens what
# counts as "belongs to the current session" — a state file for an UNRELATED
# session whose id happens to end with the current sid as a suffix
# (goal-state-team-abc.json vs current sid "abc") is now treated as the
# current session's own file and preserved, where the base implementation
# would have reaped it if dead. This is the safer failure direction for an
# irreversible delete path (over-preservation, not destruction) — see
# is_current_session's doc comment. Locked here as an explicit, intentional
# case rather than left as an untested edge.
test_is_current_session_suffix_match_diverges_from_base_exact_match_over_preserves() {
  local sid="abc"
  local file="$TEST_TMP_DIR/goal-state-team-$sid.json"
  write_state "$file" "{\"active\":true,\"last_touched_at\":\"$(iso_ago 25200)\"}"

  # Base (exact match): file_sid="team-abc" != current_sid="abc" -> NOT the
  # current session -> a dead file here would be reaped by the old loop.
  if old_is_current_session_base "$file" "$sid"; then
    echo "  ASSERTION FAILED: base exact-match reference must NOT treat 'team-$sid' as sid '$sid'"
    return 1
  fi

  # Current (suffix match): basename ends with "-abc.json" -> matches ->
  # treated as the current session -> preserved even though it's stale.
  if ! is_current_session "$file" "$sid"; then
    echo "  ASSERTION FAILED: current suffix-match must treat 'goal-state-team-$sid.json' as belonging to sid '$sid' (documented over-preservation widening)"
    return 1
  fi

  return 0
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

# Defect coverage: same reasoning as
# test_reap_session_artifacts_execute_mode_echoes_real_path_not_constant
# above, applied to reap_dead_state_files. A single-candidate fixture pins
# exact content equality, which a line-count assertion cannot: replacing the
# execute-mode echo with a fixed literal still produces exactly 1 line.
test_reap_dead_state_files_execute_mode_echoes_real_path_not_constant() {
  local sid="realpath-sid-25"
  local d="$TEST_TMP_DIR"
  local f="$d/goal-state-other-$sid.json"
  write_state "$f" "{\"active\":true,\"last_touched_at\":\"$(iso_ago 25200)\"}"

  local out
  out=$(reap_dead_state_files "$d" "current-$sid" "$NOW" 0)

  if [ "$out" != "$f" ]; then
    echo "  ASSERTION FAILED: execute-mode echo must equal the actual deleted path '$f', got '$out'"
    return 1
  fi
  if [ -f "$f" ]; then
    echo "  ASSERTION FAILED: execute mode must have actually deleted the state file"
    return 1
  fi
  return 0
}

# =============================================================================
# Defect coverage: dry_run=1 contract — the two callers only ever exercise
# dry_run=1 through zero-candidate fixtures (the set -e trap test above uses
# now_epoch=0, which yields no reap candidates at all), so a helper that
# ignored dry_run and always deleted would still pass this whole suite. Each
# test below seeds a genuine reap candidate and asserts BOTH halves of the
# contract: the candidate is emitted on stdout (dry-run's whole purpose is to
# report what WOULD be deleted), and the file is still on disk afterward.
# =============================================================================

test_reap_dead_state_files_dry_run_emits_candidate_but_does_not_delete() {
  local sid="dryrun-sid-21"
  local d="$TEST_TMP_DIR"
  local f="$d/goal-state-other-$sid.json"
  write_state "$f" "{\"active\":true,\"last_touched_at\":\"$(iso_ago 25200)\"}"   # 7h — past ACTIVE_IDLE_TTL, a genuine candidate

  local out
  out=$(reap_dead_state_files "$d" "current-$sid" "$NOW" 1)

  if ! printf '%s\n' "$out" | grep -qx "$f"; then
    echo "  ASSERTION FAILED: dry_run=1 must emit the reap candidate on stdout"
    echo "  got: $out"
    return 1
  fi
  if [ ! -f "$f" ]; then
    echo "  ASSERTION FAILED: dry_run=1 must NOT delete the candidate file"
    return 1
  fi
  return 0
}

# Defect coverage: dry_run=1's no-write contract, checked at the byte level
# rather than path-existence. The path-existence check above
# (test_reap_dead_state_files_dry_run_emits_candidate_but_does_not_delete)
# only proves the candidate file still EXISTS afterward — a dry_run branch
# that truncated the candidate in place (e.g. `: > "$f"`) before echoing it
# would still leave the path present and pass that test, while destroying
# its content. reap_dead_state_files owns this destructive primitive, so its
# own suite — not just a downstream CLI wrapper's suite — must hold this
# contract. cmp -s against a pre-call copy catches any byte change, not only
# a specific corruption shape.
test_reap_dead_state_files_dry_run_preserves_candidate_bytes() {
  local sid="drynowrite-sid-26"
  local d="$TEST_TMP_DIR"
  local f="$d/goal-state-other-$sid.json"
  write_state "$f" "{\"active\":true,\"last_touched_at\":\"$(iso_ago 25200)\"}"   # 7h — past ACTIVE_IDLE_TTL, a genuine candidate
  local ref="$TEST_TMP_DIR/ref-state.json"
  cp "$f" "$ref"

  reap_dead_state_files "$d" "current-$sid" "$NOW" 1 > /dev/null

  if ! cmp -s "$f" "$ref"; then
    echo "  ASSERTION FAILED: dry_run=1 must not modify the candidate state file's bytes"
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

# Defect coverage: the execute-mode echo must be the ACTUAL deleted path, not
# a constant string. The count-only assertion above ("got 1 line") would
# still pass if the echo were replaced with a fixed literal (e.g. "REAPED"),
# since a constant echoed once is still exactly 1 line. This asserts exact
# content equality against the real candidate path, and that the file is
# actually gone from disk — the two facts a constant-echo mutation would
# decouple from each other.
test_reap_session_artifacts_execute_mode_echoes_real_path_not_constant() {
  local d="$TEST_TMP_DIR"
  local f="$d/codex-todo-realpath-sid-23.json"
  write_state "$f" "{}"
  touch_ago "$f" 25200

  local out
  out=$(reap_session_artifacts "$d" "__none__" "$NOW" 0)

  if [ "$out" != "$f" ]; then
    echo "  ASSERTION FAILED: execute-mode echo must equal the actual deleted path '$f', got '$out'"
    return 1
  fi
  if [ -f "$f" ]; then
    echo "  ASSERTION FAILED: execute mode must have actually deleted the artifact"
    return 1
  fi
  return 0
}

# Defect coverage: mtime-preservation guard (protection #2 of the three
# independent protections documented above reap_session_artifacts). This
# fixture deliberately withholds the other two protections — the sid does
# not match current_sid (no identity protection), and no corresponding
# goal-state-<sid>.json exists at all (no live-session-id protection) — so
# only is_artifact_live's mtime check can keep a just-written session
# artifact from being reaped the instant it's created. Deleting that guard
# entirely (as opposed to merely relaxing its boundary) reaps this file with
# no other test in this suite going red.
test_reap_session_artifacts_fresh_mtime_survives_without_live_state_or_identity() {
  local d="$TEST_TMP_DIR"
  local sid="fresh-mtime-sid-24"
  local f="$d/codex-todo-$sid.json"
  write_state "$f" "{}"
  # No touch_ago call: mtime is "just now" — no live goal-state-$sid.json
  # exists, and current_sid below deliberately does not match $sid.

  reap_session_artifacts "$d" "unrelated-sid" "$NOW" 0 > /dev/null

  if [ ! -f "$f" ]; then
    echo "  ASSERTION FAILED: a freshly-written session artifact with no live state file and no session-identity match must still survive under ACTIVE_IDLE_TTL (the mtime-preservation guard)"
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

test_reap_session_artifacts_dry_run_emits_candidate_but_does_not_delete() {
  local d="$TEST_TMP_DIR"
  local f="$d/codex-todo-dryrun-sid-22.json"
  write_state "$f" "{}"
  touch_ago "$f" 25200   # 7h — past ACTIVE_IDLE_TTL, no live goal-state for this id, a genuine candidate

  local out
  out=$(reap_session_artifacts "$d" "__none__" "$NOW" 1)

  if ! printf '%s\n' "$out" | grep -qx "$f"; then
    echo "  ASSERTION FAILED: dry_run=1 must emit the reap candidate artifact on stdout"
    echo "  got: $out"
    return 1
  fi
  if [ ! -f "$f" ]; then
    echo "  ASSERTION FAILED: dry_run=1 must NOT delete the candidate artifact"
    return 1
  fi
  return 0
}

# Defect coverage: same reasoning as
# test_reap_dead_state_files_dry_run_preserves_candidate_bytes above, applied
# to reap_session_artifacts — the sibling reaper this file also owns. The
# existing path-existence dry-run test for this function
# (test_reap_session_artifacts_dry_run_emits_candidate_but_does_not_delete)
# would likewise still pass if the dry_run branch truncated the artifact in
# place before echoing it.
test_reap_session_artifacts_dry_run_preserves_candidate_bytes() {
  local d="$TEST_TMP_DIR"
  local f="$d/codex-todo-drynowrite-sid-27.json"
  write_state "$f" "{\"marker\":\"artifact-bytes\"}"
  touch_ago "$f" 25200   # 7h — past ACTIVE_IDLE_TTL, no live goal-state for this id, a genuine candidate
  local ref="$TEST_TMP_DIR/ref-artifact.json"
  cp "$f" "$ref"

  reap_session_artifacts "$d" "__none__" "$NOW" 1 > /dev/null

  if ! cmp -s "$f" "$ref"; then
    echo "  ASSERTION FAILED: dry_run=1 must not modify the candidate artifact's bytes"
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
# Defect: rm -f failures were silently reported as successful deletions —
# the affected path was echoed BEFORE rm ran, and rm's own exit status was
# never inspected. A failed delete must not be echoed as deleted, must be
# reported on stderr, and must make the function return non-zero.
# =============================================================================

test_reap_dead_state_files_rm_failure_not_echoed_and_reported() {
  local d="$TEST_TMP_DIR/ro_state"
  mkdir -p "$d"
  local sid="rmfail-sid-19"
  local f="$d/goal-state-other-$sid.json"
  write_state "$f" "{\"active\":true,\"last_touched_at\":\"$(iso_ago 25200)\"}"
  chmod 555 "$d"   # no write permission on the directory: rm inside must fail

  local out err_file rc
  err_file="$TEST_TMP_DIR/stderr_capture_state"
  out=$(reap_dead_state_files "$d" "current-$sid" "$NOW" 0 2>"$err_file")
  rc=$?
  chmod 755 "$d"   # restore before any assertion so teardown's rm -rf works

  if [ ! -f "$f" ]; then
    echo "  ASSERTION FAILED: rm failure means the file must still exist on disk"
    return 1
  fi
  if printf '%s\n' "$out" | grep -qx "$f"; then
    echo "  ASSERTION FAILED: a failed delete must NOT be echoed as a deleted path"
    return 1
  fi
  if ! grep -q "failed to delete" "$err_file"; then
    echo "  ASSERTION FAILED: a failed delete must be reported on stderr"
    return 1
  fi
  if [ "$rc" -eq 0 ]; then
    echo "  ASSERTION FAILED: reap_dead_state_files must return non-zero when a real rm failure occurred"
    return 1
  fi
  return 0
}

test_reap_session_artifacts_rm_failure_not_echoed_and_reported() {
  local d="$TEST_TMP_DIR/ro_artifacts"
  mkdir -p "$d"
  local f="$d/codex-todo-rmfail-sid-20.json"
  write_state "$f" "{}"
  touch_ago "$f" 25200
  chmod 555 "$d"

  local out err_file rc
  err_file="$TEST_TMP_DIR/stderr_capture_artifacts"
  out=$(reap_session_artifacts "$d" "__none__" "$NOW" 0 2>"$err_file")
  rc=$?
  chmod 755 "$d"

  if [ ! -f "$f" ]; then
    echo "  ASSERTION FAILED: rm failure means the artifact must still exist on disk"
    return 1
  fi
  if printf '%s\n' "$out" | grep -qx "$f"; then
    echo "  ASSERTION FAILED: a failed delete must NOT be echoed as a deleted path"
    return 1
  fi
  if ! grep -q "failed to delete" "$err_file"; then
    echo "  ASSERTION FAILED: a failed delete must be reported on stderr"
    return 1
  fi
  if [ "$rc" -eq 0 ]; then
    echo "  ASSERTION FAILED: reap_session_artifacts must return non-zero when a real rm failure occurred"
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
    list_live_session_ids "'"$d"'" 0
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
# SESSION_ARTIFACT_PREFIXES structural assertion — symmetric with
# test_state_prefixes_exactly_five_managed above. SESSION_ARTIFACT_PREFIXES
# is the whitelist that actually drives reap_session_artifacts's deletions,
# yet had no pinning test at all: a family silently dropped from it would go
# unnoticed by every other test in this file.
# =============================================================================

test_session_artifact_prefixes_exactly_six_managed() {
  local count
  count=$(printf '%s\n' $SESSION_ARTIFACT_PREFIXES | grep -c '.' 2>/dev/null || true)
  if [ "$count" -ne 6 ]; then
    echo "  ASSERTION FAILED: SESSION_ARTIFACT_PREFIXES must have exactly 6 entries, found $count"
    echo "  SESSION_ARTIFACT_PREFIXES=$SESSION_ARTIFACT_PREFIXES"
    return 1
  fi

  local prefix
  for prefix in codex-todo- state/block-count- goal-verdict- goal-codereview- ultragoal-verdict- ultragoal-codereview-; do
    local n
    n=$(printf '%s\n' $SESSION_ARTIFACT_PREFIXES | grep -c "^${prefix}\$" 2>/dev/null || true)
    if [ "$n" -ne 1 ]; then
      echo "  ASSERTION FAILED: SESSION_ARTIFACT_PREFIXES must contain '$prefix' exactly once, found $n"
      return 1
    fi
  done

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
run_test test_is_state_live_active_ttl_boundary_is_dead
run_test test_is_current_session_matches_filename_sid
run_test test_is_current_session_no_match_different_sid
run_test test_is_current_session_matches_ultragoal_filename_sid
run_test test_is_current_session_sid_quoting_prevents_glob_metachar_false_match_extensionless
run_test test_is_current_session_sid_quoting_prevents_glob_metachar_false_match_extension_form
run_test test_head_red_probe_artifact_prefix_matches_current_session
run_test test_is_current_session_recognizes_all_fifteen_forms
run_test test_is_current_session_empty_sid_preserves
run_test test_is_artifact_live_mtime_only_ignores_active_field
run_test test_is_artifact_live_unreadable_mtime_fails_open
run_test test_is_artifact_live_ttl_boundary_is_dead
run_test test_list_live_session_ids_reports_live_omits_dead
run_test test_list_live_session_ids_dedupes_across_prefixes
run_test test_list_live_session_ids_strips_prefix_in_glob_metachar_dir
run_test test_reap_session_artifacts_survives_live_session_in_glob_metachar_dir
run_test test_list_live_session_ids_respects_provided_now_epoch_not_wall_clock
run_test test_reap_session_artifacts_uses_own_now_epoch_not_internal_wall_clock
run_test test_list_unclassified_reports_genuine_drift_only
run_test test_list_unclassified_reports_non_md_session_ledger_as_drift
run_test test_list_unclassified_reports_files_under_state_subdir_too
run_test test_list_unclassified_reports_all_four_plan_ac_forms
run_test test_reap_dead_state_files_relocation_equivalence
run_test test_reap_dead_state_files_execute_mode_echoes_affected_paths
run_test test_reap_dead_state_files_execute_mode_echoes_real_path_not_constant
run_test test_reap_dead_state_files_dry_run_emits_candidate_but_does_not_delete
run_test test_reap_dead_state_files_dry_run_preserves_candidate_bytes
run_test test_reap_dead_state_files_old_closed_bak_survives_json_anchor
run_test test_is_current_session_suffix_match_diverges_from_base_exact_match_over_preserves
run_test test_reap_session_artifacts_current_session_self_artifact_survives
run_test test_reap_session_artifacts_other_live_session_survives_without_sid
run_test test_reap_session_artifacts_execute_mode_echoes_affected_paths
run_test test_reap_session_artifacts_execute_mode_echoes_real_path_not_constant
run_test test_reap_session_artifacts_fresh_mtime_survives_without_live_state_or_identity
run_test test_reap_session_artifacts_dry_run_emits_candidate_but_does_not_delete
run_test test_reap_session_artifacts_json_extension_stripped_for_live_id_match
run_test test_reap_session_artifacts_short_live_id_does_not_falsely_preserve
run_test test_reap_session_artifacts_dry_run_preserves_candidate_bytes
run_test test_reap_session_artifacts_namespaced_block_count_survives_none_lane
run_test test_reap_dead_state_files_rm_failure_not_echoed_and_reported
run_test test_reap_session_artifacts_rm_failure_not_echoed_and_reported
run_test test_harmless_conditions_do_not_trip_set_e
run_test test_state_prefixes_exactly_five_managed
run_test test_session_artifact_prefixes_exactly_six_managed
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

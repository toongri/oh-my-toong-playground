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
# Defect coverage: an explicit Z/offset suffix must be honored, not stripped
# and reparsed as local wall-clock. On this KST(+09:00) host, a timestamp
# genuinely stamped in UTC-Z form 60s ago is misread by the stripped-local
# parse as ~9h old — enough to blow past ACTIVE_IDLE_TTL and be judged dead.
# =============================================================================

# iso_ago_z <seconds> — UTC-Z ISO 8601 timestamp N seconds before NOW
iso_ago_z() {
  local secs="$1"
  local t=$((NOW - secs))
  date -u -r "$t" "+%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u -d "@$t" "+%Y-%m-%dT%H:%M:%SZ" 2>/dev/null
}

# iso_ago_offset <seconds> <offset> — ISO 8601 timestamp N seconds before NOW,
# rendered in UTC clock terms but suffixed with the given explicit offset.
# Only used with offset="+00:00" (UTC) — the UTC clock rendering is correct
# for that offset specifically.
iso_ago_utc_offset00() {
  local secs="$1"
  local t=$((NOW - secs))
  date -u -r "$t" "+%Y-%m-%dT%H:%M:%S+00:00" 2>/dev/null || date -u -d "@$t" "+%Y-%m-%dT%H:%M:%S+00:00" 2>/dev/null
}

# iso_ago_local_offset09 <seconds> — ISO 8601 timestamp N seconds before NOW,
# rendered in this host's own local (KST, +09:00) clock terms and suffixed
# with +09:00 — a regression guard that explicit-offset handling doesn't
# break the common local-offset case.
iso_ago_local_offset09() {
  local secs="$1"
  local t=$((NOW - secs))
  TZ=Asia/Seoul date -r "$t" "+%Y-%m-%dT%H:%M:%S+09:00" 2>/dev/null || TZ=Asia/Seoul date -d "@$t" "+%Y-%m-%dT%H:%M:%S+09:00" 2>/dev/null
}

test_is_state_live_honors_utc_z_suffix_not_local_wall_clock() {
  local file="$TEST_TMP_DIR/state.json"
  local touched_ts
  touched_ts=$(iso_ago_z 60)   # 60s ago, stamped in UTC-Z form
  write_state "$file" "{\"active\":true,\"last_touched_at\":\"$touched_ts\"}"

  if is_state_live "$file" "$NOW"; then
    return 0
  else
    echo "  ASSERTION FAILED: a Z-suffixed timestamp 60s ago must be parsed as UTC, not local wall-clock — true age is 60s (live), stripping Z and reparsing as KST local misreads it as ~9h old (dead)"
    return 1
  fi
}

test_is_state_live_honors_explicit_utc_offset_suffix() {
  local file="$TEST_TMP_DIR/state.json"
  local touched_ts
  touched_ts=$(iso_ago_utc_offset00 60)   # 60s ago, stamped +00:00
  write_state "$file" "{\"active\":true,\"last_touched_at\":\"$touched_ts\"}"

  if is_state_live "$file" "$NOW"; then
    return 0
  else
    echo "  ASSERTION FAILED: a +00:00-suffixed timestamp 60s ago must be parsed against its explicit offset, not local wall-clock — true age is 60s (live)"
    return 1
  fi
}

test_is_state_live_honors_local_kst_offset_suffix_regression_guard() {
  local file="$TEST_TMP_DIR/state.json"
  local touched_ts
  touched_ts=$(iso_ago_local_offset09 60)   # 60s ago, stamped +09:00 (this host's own offset)
  write_state "$file" "{\"active\":true,\"last_touched_at\":\"$touched_ts\"}"

  if is_state_live "$file" "$NOW"; then
    return 0
  else
    echo "  ASSERTION FAILED: a +09:00-suffixed timestamp 60s ago (this host's own local offset) must still be live — offset handling must not break the common case"
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

# Defect coverage: the UUID-shape filter (the final `case "$base" in
# *-[hex]...*)` guard) had no negative control — no test asserted that an
# ordinary, non-session file a user might park in $OMT_DIR (a stray
# "notes.txt", "README", "plan.md") is NEVER reported as drift. Since this
# reporter's stdout is surfaced on every session start
# (hooks/session-start.sh), a regression that widened the filter (e.g. to a
# bare `*)` catch-all) would flood every session with false-positive drift
# reports for ordinary files, yet every other test in this suite only ever
# seeds genuinely UUID-shaped names — so such a regression left the whole
# suite green. This fixture combines the negative control with a positive
# control in one assertion, so the test cannot pass by simply disabling
# reporting outright.
test_list_unclassified_ignores_non_uuid_shaped_files() {
  local d="$TEST_TMP_DIR"
  local uuid="a1b2c3d4-e5f6-4a1b-9c3d-2f8e7a6b5c4d"

  # Negative control: no UUID-shaped id anywhere in these names — must never
  # be reported as session drift.
  write_state "$d/notes.txt" "just some notes"
  write_state "$d/README" ""
  write_state "$d/plan.md" ""

  # Positive control, seeded alongside: a genuinely unclassified UUID-shaped
  # file must still be reported.
  write_state "$d/handoff-consumed-$uuid" ""

  local out
  out=$(list_unclassified_session_files "$d")
  local n
  n=$(printf '%s\n' "$out" | grep -c '.' || true)

  if [ "$n" -ne 1 ]; then
    echo "  ASSERTION FAILED: expected exactly 1 unclassified file (the UUID-shaped one), got $n"
    echo "  got: $out"
    return 1
  fi

  if ! printf '%s' "$out" | grep -q "handoff-consumed-$uuid"; then
    echo "  ASSERTION FAILED: genuinely unclassified UUID-shaped file must still be reported"
    echo "  got: $out"
    return 1
  fi

  if printf '%s' "$out" | grep -qE 'notes\.txt|README|plan\.md'; then
    echo "  ASSERTION FAILED: non-UUID-shaped ordinary files must never be reported as session drift"
    echo "  got: $out"
    return 1
  fi

  return 0
}

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

# Debugging aid for the intermittent ultragoal-state wipe: at the exact
# moment a reap decision is made against a foreign (different sid) dead
# state file, reap_dead_state_files must emit a `reap-diag:` breadcrumb line
# to STDERR carrying the raw inputs (file, now_epoch, active, ...) that
# produced the decision — WITHOUT recomputing/duplicating is_state_live's own
# parse. This must hold in BOTH dry_run modes (breadcrumb sits before the
# dry_run branch), and must never leak onto STDOUT — session-start.sh depends
# on reap_dead_state_files's stdout staying byte-static (one reaped path per
# line, nothing else).
test_reap_dead_state_files_emits_diag_breadcrumb_to_stderr() {
  local sid="diag-sid-42"
  local d="$TEST_TMP_DIR"
  local f="$d/ultragoal-state-other-$sid.json"
  local touched_ago
  touched_ago=$(iso_ago 25200)   # 7 hours — past ACTIVE_IDLE_TTL, a genuine dead candidate
  write_state "$f" "{\"active\":true,\"last_touched_at\":\"$touched_ago\"}"

  local err_file="$TEST_TMP_DIR/stderr.out"
  local out
  out=$(reap_dead_state_files "$d" "current-$sid" "$NOW" 0 2>"$err_file")

  local err
  err=$(cat "$err_file")

  if ! printf '%s\n' "$err" | grep -q "reap-diag:"; then
    echo "  ASSERTION FAILED: stderr must contain a reap-diag: breadcrumb line"
    echo "  stderr: $err"
    return 1
  fi
  if ! printf '%s\n' "$err" | grep -q "file=$f"; then
    echo "  ASSERTION FAILED: breadcrumb must carry file=$f"
    echo "  stderr: $err"
    return 1
  fi
  if ! printf '%s\n' "$err" | grep -q "active=true"; then
    echo "  ASSERTION FAILED: breadcrumb must carry active=true (raw .active value)"
    echo "  stderr: $err"
    return 1
  fi
  if ! printf '%s\n' "$err" | grep -q "now=$NOW"; then
    echo "  ASSERTION FAILED: breadcrumb must carry now=$NOW"
    echo "  stderr: $err"
    return 1
  fi

  # Regression guard: the breadcrumb must not leak onto stdout — stdout stays
  # exactly the reaped path, nothing else.
  if [ "$out" != "$f" ]; then
    echo "  ASSERTION FAILED: stdout must remain exactly the reaped path (breadcrumb must not leak to stdout)"
    echo "  stdout: $out"
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
# independent protections documented above reap_session_artifacts).
#
# A fixture with a NON-empty sid tail (e.g. "codex-todo-fresh-mtime-sid-24.json")
# does NOT discriminate here: list_live_session_ids's second witness pass
# walks this same directory/prefix/predicate and would witness this exact
# file's own sid into live_ids, so the live-id membership check (protection
# #3) already preserves it independently of protection #2 — neutralizing
# protection #2 alone would still leave this fixture surviving, so it was a
# vacuous test (see the code-review finding this comment addresses).
#
# The EMPTY-TAIL shape is what actually isolates protection #2: a file named
# exactly "codex-todo-.json" (prefix + empty sid) strips to tail="" after
# `${tail%%.*}`. The witness pass would push an empty sid for this file too,
# but the live-id membership loop explicitly skips empty ids
# (`[ -n "$live_id" ] || continue`), so protection #3 can never match an
# empty tail — is_artifact_live (protection #2) is the ONLY thing that can
# keep this file alive. This fixture deliberately also withholds identity
# protection (current_sid below does not match anything derivable from the
# file), so is_artifact_live is truly the sole guard under test.
#
# No OMT writer can actually emit this shape (isSafeSessionId in
# lib/state-core.ts requires a non-empty id, and every writer checks it
# first) — this fixture stands in for a manually-placed or foreign file
# sharing the directory, matching the production-side comment above
# reap_session_artifacts's is_artifact_live guard.
test_reap_session_artifacts_empty_tail_fresh_survives_mtime_guard_only() {
  local d="$TEST_TMP_DIR"
  local f="$d/codex-todo-.json"
  write_state "$f" "{}"
  # No touch_ago call: mtime is "just now".

  reap_session_artifacts "$d" "unrelated-sid" "$NOW" 0 > /dev/null

  if [ ! -f "$f" ]; then
    echo "  ASSERTION FAILED: a fresh empty-tail artifact (codex-todo-.json) must survive via the per-candidate mtime guard — no live-id witness can ever match an empty tail, so this guard is the only protection"
    return 1
  fi
  return 0
}

# Negative control for the test above: a STALE empty-tail artifact must still
# be reaped. Without this, a mutation that disables reaping outright (e.g.
# short-circuiting the whole function) would make the positive test above
# pass trivially — this asserts the guard is a boundary, not a blanket keep.
test_reap_session_artifacts_empty_tail_stale_is_reaped() {
  local d="$TEST_TMP_DIR"
  local f="$d/codex-todo-.json"
  write_state "$f" "{}"
  touch_ago "$f" 25200   # 7h — past ACTIVE_IDLE_TTL

  reap_session_artifacts "$d" "unrelated-sid" "$NOW" 0 > /dev/null

  if [ -f "$f" ]; then
    echo "  ASSERTION FAILED: a stale empty-tail artifact (codex-todo-.json) must still be reaped — no live-id witness can ever match an empty tail, and mtime is past ACTIVE_IDLE_TTL"
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
# Finding 1 fix: list_live_session_ids's second witness source
# (SESSION_ARTIFACT_PREFIXES via is_artifact_live). A Codex Stop that blocks
# on incomplete todos writes a fresh state/block-count-<sid> on every single
# blocking Stop — that witnesses the bare sid as live even once the sibling
# codex-todo-<sid>.json mirror has gone stale from 6h of no `update_plan`
# call, closing the false-completion path where the mirror's absence used to
# read as "no incomplete todos" (fail-open in hooks/codex-persistent-mode/).
# The negative control seeds the SAME stale mirror with no witness of any
# kind and asserts it is still reaped — without it, the positive assertion
# below could pass merely because artifact reaping was disabled wholesale.
# =============================================================================

test_reap_session_artifacts_stale_codex_todo_survives_via_fresh_block_count_witness() {
  local sid="witness-sid-28"
  local d="$TEST_TMP_DIR"
  mkdir -p "$d/state"
  local mirror="$d/codex-todo-$sid.json"
  local bc="$d/state/block-count-$sid"
  write_state "$mirror" "{\"incomplete\":3}"
  touch_ago "$mirror" 25200   # 7h — past ACTIVE_IDLE_TTL, stale on its own
  write_state "$bc" "1"
  touch_ago "$bc" 0           # fresh — within ACTIVE_IDLE_TTL, the witness

  reap_session_artifacts "$d" "other-session-sid" "$NOW" 0 > /dev/null

  if [ ! -f "$mirror" ]; then
    echo "  ASSERTION FAILED: a stale codex-todo-<sid>.json must survive when a fresh sibling state/block-count-<sid> witnesses the same sid as live"
    return 1
  fi
  return 0
}

test_reap_session_artifacts_stale_codex_todo_reaped_without_witness() {
  local sid="nowitness-sid-29"
  local d="$TEST_TMP_DIR"
  local mirror="$d/codex-todo-$sid.json"
  write_state "$mirror" "{\"incomplete\":3}"
  touch_ago "$mirror" 25200   # 7h — past ACTIVE_IDLE_TTL; no live state file
                              # and no block-count witness for this sid at all

  reap_session_artifacts "$d" "other-session-sid" "$NOW" 0 > /dev/null

  if [ -f "$mirror" ]; then
    echo "  ASSERTION FAILED (negative control): a stale codex-todo-<sid>.json with no live witness of any kind must still be reaped"
    return 1
  fi
  return 0
}

# =============================================================================
# Batched-stat restructure (per-file stat fork elimination): fail-open on a
# silently-omitted batch line, and correct mtime/path splitting for a
# space-bearing path — both exercised against reap_session_artifacts, one of
# the two loops the restructure rewrote to iterate directly over
# _state_liveness_stat_batch_lines output instead of one is_artifact_live
# fork per candidate.
# =============================================================================

# _state_liveness_stat_batch is overridden here, scoped to a subshell only
# (never leaking back into this test file's own shell), to simulate the
# documented "stat could not resolve this path" omission — e.g. a real race
# between glob expansion and the batched stat call, which cannot be made to
# reproduce deterministically on demand. The override recomputes stat inline
# (GNU-then-BSD, matching the production "unknown flavor" fallback branch)
# rather than calling through to the real cached function, so the test has no
# dependency on that function's internal naming.
test_reap_session_artifacts_batched_stat_omission_fails_open() {
  local d="$TEST_TMP_DIR"
  local dropped="$d/codex-todo-omit-sid-30.json"
  local control="$d/codex-todo-control-sid-31.json"
  write_state "$dropped" "{}"
  write_state "$control" "{}"
  touch_ago "$dropped" 25200   # 7h — past ACTIVE_IDLE_TTL, no witness: a
                                # genuine reap candidate if its line is seen
  touch_ago "$control" 25200   # same age, NOT omitted — must still be reaped

  (
    _state_liveness_stat_batch() {
      { stat -c '%Y %n' "$@" 2>/dev/null || stat -f '%m %N' "$@" 2>/dev/null || true; } \
        | grep -vF -- "$dropped"
    }
    reap_session_artifacts "$d" "unrelated-sid" "$NOW" 0 > /dev/null
  )

  if [ ! -f "$dropped" ]; then
    echo "  ASSERTION FAILED: a candidate whose batched-stat line is silently omitted must fail open (survive), never become a reap candidate"
    return 1
  fi
  # Negative control: proves the guard above has teeth rather than reaping
  # being disabled wholesale inside the subshell.
  if [ -f "$control" ]; then
    echo "  ASSERTION FAILED (negative control): a stale artifact NOT omitted from batched stat output must still be reaped"
    return 1
  fi
  return 0
}

# Space-bearing directory path: stat's batched line format puts mtime FIRST
# ("<mtime> <path>"), so ${line%% *} / ${line#* } split correctly even when
# the path itself contains spaces (a Unix mtime never does). This drives the
# split against a REAL space-bearing directory rather than asserting the
# splitting rule in the abstract, covering both the age judgment (mtime half)
# and the actual rm target (path half, spaces and all).
test_reap_session_artifacts_space_bearing_dir_path_judged_correctly() {
  local d="$TEST_TMP_DIR/my project dir"
  mkdir -p "$d"

  local stale="$d/codex-todo-space-stale-32.json"
  local fresh="$d/codex-todo-space-fresh-33.json"
  write_state "$stale" "{}"
  write_state "$fresh" "{}"
  touch_ago "$stale" 25200   # 7h — past ACTIVE_IDLE_TTL, no witness — reaped
  # $fresh: no touch_ago — mtime is "just now", within ACTIVE_IDLE_TTL — survives

  reap_session_artifacts "$d" "unrelated-sid" "$NOW" 0 > /dev/null

  if [ -f "$stale" ]; then
    echo "  ASSERTION FAILED: a stale artifact in a space-bearing directory must still be reaped (mtime half of the batched-line split must resolve correctly)"
    return 1
  fi
  if [ ! -f "$fresh" ]; then
    echo "  ASSERTION FAILED: a fresh artifact in a space-bearing directory must survive (path half of the batched-line split must resolve correctly, or rm would target the wrong/no file)"
    return 1
  fi
  return 0
}

# Same space-bearing-path concern, but against list_live_session_ids's own
# batched SESSION_ARTIFACT_PREFIXES witness pass (the other loop the
# restructure rewrote) — a sid witnessed ONLY through a session-artifact
# family (no STATE_PREFIXES file at all) living under a space-bearing
# directory must still be reported live.
test_list_live_session_ids_space_bearing_dir_witness_pass() {
  local d="$TEST_TMP_DIR/my project dir"
  mkdir -p "$d/state"
  local sid="space-witness-sid-34"
  write_state "$d/state/block-count-$sid" "1"
  # fresh mtime — within ACTIVE_IDLE_TTL

  local out
  out=$(list_live_session_ids "$d" "$NOW")

  if ! printf '%s\n' "$out" | grep -qx "$sid"; then
    echo "  ASSERTION FAILED: a sid witnessed only via a session artifact under a space-bearing directory must still be reported live"
    echo "  got: $out"
    return 1
  fi
  return 0
}

# =============================================================================
# Defect: an embedded literal newline in a whitelisted-prefix filename splits
# one batched-stat "<mtime> <path>" record into two lines. The forged second
# line's first token then lands in the loop's own $mtime, and its remainder
# in $f — both consumed by list_live_session_ids's and reap_session_artifacts's
# SESSION_ARTIFACT_PREFIXES loops with no validation before this fix. An
# attacker-controlled $mtime reaches `_artifact_age_live`'s
# `$(( now_epoch - mtime_epoch ))` arithmetic context, where bash re-evaluates
# a `[$(...)]`-shaped value as an array subscript and executes the embedded
# command substitution (Defect A) — regardless of dry-run, since that
# arithmetic runs before either loop's dry_run branch. An attacker-controlled
# $f can likewise fall outside $dir entirely and still reach `rm -f "$f"`
# (Defect B). Both loops now reject a non-numeric $mtime and a $f not
# anchored to "$dir/$prefix" immediately after the split, before either value
# is used for anything else.
# =============================================================================

# Isolates list_live_session_ids's own SESSION_ARTIFACT_PREFIXES witness loop
# (called directly, not through reap_session_artifacts) against Defect A.
test_list_live_session_ids_newline_filename_no_arbitrary_exec() {
  local d="$TEST_TMP_DIR/artifacts"
  mkdir -p "$d"
  local fname
  fname=$'codex-todo-a\ncandidates[$(touch${IFS}pwnedY)] z'
  : >"$d/$fname"

  local cwd_dir="$TEST_TMP_DIR/cwd"
  mkdir -p "$cwd_dir"
  (cd "$cwd_dir" && list_live_session_ids "$d" "$NOW" >/dev/null)

  if [ -f "$cwd_dir/pwnedY" ]; then
    echo "  ASSERTION FAILED: list_live_session_ids's own witness loop must reject a non-numeric forged mtime before arithmetic evaluation — found pwnedY created via command substitution"
    return 1
  fi
  return 0
}

# Defect A through the full reap_session_artifacts call (which itself calls
# list_live_session_ids first, then runs its own identically-shaped loop) —
# dry_run=1, since the arithmetic injection happens before the dry_run branch
# in either loop.
test_reap_session_artifacts_newline_filename_defect_a_no_arbitrary_exec_dry_run() {
  local d="$TEST_TMP_DIR/artifacts"
  mkdir -p "$d"
  local fname
  fname=$'codex-todo-a\ncandidates[$(touch${IFS}pwnedX)] z'
  : >"$d/$fname"

  local cwd_dir="$TEST_TMP_DIR/cwd"
  mkdir -p "$cwd_dir"
  (cd "$cwd_dir" && reap_session_artifacts "$d" "__none__" "$NOW" 1 >/dev/null)

  if [ -f "$cwd_dir/pwnedX" ]; then
    echo "  ASSERTION FAILED: a newline-embedded filename forged a record whose mtime slot reached arithmetic evaluation and executed an embedded command substitution, even in dry-run mode"
    return 1
  fi
  return 0
}

# Defect B: a forged record whose path field falls outside $dir (the current
# session's own CWD), reaching `rm -f "$f"` in execute mode unless anchored.
test_reap_session_artifacts_newline_filename_defect_b_no_out_of_dir_deletion_execute() {
  local d="$TEST_TMP_DIR/artifacts"
  mkdir -p "$d"
  local fname
  fname=$'codex-todo-x\n0 victim.txt'
  : >"$d/$fname"

  local cwd_dir="$TEST_TMP_DIR/cwd"
  mkdir -p "$cwd_dir"
  : >"$cwd_dir/victim.txt"

  (cd "$cwd_dir" && reap_session_artifacts "$d" "__none__" "$NOW" 0 >/dev/null)

  if [ ! -f "$cwd_dir/victim.txt" ]; then
    echo "  ASSERTION FAILED: a newline-embedded filename forged a record whose path fell outside \$OMT_DIR (landing on the CWD's own victim.txt), and it was deleted instead of being rejected by the \$dir/\$prefix anchor"
    return 1
  fi
  return 0
}

# SESSION_ARTIFACT_PREFIXES contains a NESTED prefix ("state/block-count-"),
# so its glob has an intermediate directory component. Path expansion follows
# a symlink there, yielding a path that is still string-anchored to
# "$dir/$prefix" — the anchor guard above passes it — while the file it names
# lives in the symlink target. `rm -f` then deletes outside $dir.
#
# The single assertion pairs both halves on ONE fixture so the guard cannot
# pass by degrading into "reap nothing": the external file must survive AND
# the sibling ordinary candidate in the same run must still be reaped.
test_reap_session_artifacts_symlinked_nested_dir_target_not_deleted() {
  local d="$TEST_TMP_DIR/omt"
  local outside="$TEST_TMP_DIR/outside"
  mkdir -p "$d" "$outside"

  local victim="$outside/block-count-symlink-victim-70"
  : >"$victim"
  touch_ago "$victim" 25200
  ln -s "$outside" "$d/state"

  local ordinary="$d/codex-todo-ordinary-stale-71.json"
  write_state "$ordinary" "{}"
  touch_ago "$ordinary" 25200

  reap_session_artifacts "$d" "__none__" "$NOW" 0 >/dev/null

  if [ ! -f "$victim" ]; then
    echo "  ASSERTION FAILED: <dir>/state is a symlink, so the nested-prefix glob followed it and reap_session_artifacts deleted a file outside \$dir"
    return 1
  fi
  if [ -f "$ordinary" ]; then
    echo "  ASSERTION FAILED: the symlink guard must skip only the symlinked nested prefix — an ordinary stale candidate in the same run must still be reaped"
    return 1
  fi
  return 0
}

# The escape is specific to a symlinked DIRECTORY component. A real nested
# directory must keep reaping normally — without this, the guard above could
# be satisfied by refusing every nested prefix outright, silently retiring
# block-count GC.
test_reap_session_artifacts_real_nested_dir_still_reaped() {
  local d="$TEST_TMP_DIR/omt"
  mkdir -p "$d/state"

  local stale="$d/state/block-count-real-nested-stale-72"
  : >"$stale"
  touch_ago "$stale" 25200

  reap_session_artifacts "$d" "__none__" "$NOW" 0 >/dev/null

  if [ -f "$stale" ]; then
    echo "  ASSERTION FAILED: a stale block-count file under a REAL (non-symlinked) nested directory must still be reaped — the symlink guard must not blanket-skip nested prefixes"
    return 1
  fi
  return 0
}

# A candidate FILE that is itself a symlink needs no guard, and must not
# acquire one: `rm -f` unlinks the symlink and leaves the target intact.
# The symlink is backdated with `touch -h` deliberately — BSD `stat -f %m`
# reads the symlink rather than its target, so a freshly-created symlink is
# judged live and never reaches `rm -f`, which would make the target's
# survival prove nothing about `rm -f`'s behavior.
test_reap_session_artifacts_symlinked_candidate_file_unlinks_only_the_link() {
  local d="$TEST_TMP_DIR/omt"
  local outside="$TEST_TMP_DIR/outside"
  mkdir -p "$d" "$outside"

  local target="$outside/important.json"
  write_state "$target" "{}"
  local link="$d/codex-todo-symlinked-candidate-73.json"
  ln -s "$target" "$link"

  local t=$((NOW - 25200))
  local touch_arg
  touch_arg=$(date -r "$t" "+%Y%m%d%H%M.%S" 2>/dev/null || date -d "@$t" "+%Y%m%d%H%M.%S" 2>/dev/null)
  touch -h -t "$touch_arg" "$link"

  reap_session_artifacts "$d" "__none__" "$NOW" 0 >/dev/null

  if [ ! -f "$target" ]; then
    echo "  ASSERTION FAILED: reaping a symlinked candidate must unlink only the symlink — the target outside \$dir was deleted"
    return 1
  fi
  if [ -L "$link" ]; then
    echo "  ASSERTION FAILED: the stale symlinked candidate itself must be reaped (it is a dead artifact); if it survived, the target's survival above proves nothing about rm -f"
    return 1
  fi
  return 0
}

# Negative control: the two guards above must not degrade into a blanket
# `continue` for every candidate — an ordinary live-witnessed artifact must
# still survive and an ordinary unwitnessed stale artifact must still be
# reaped, exactly as before the guards were added.
test_reap_session_artifacts_ordinary_candidates_unaffected_by_newline_guard() {
  local d="$TEST_TMP_DIR"
  local live="ordinary-live-sid-40"
  local dead="ordinary-dead-sid-41"
  write_state "$d/goal-state-$live.json" "{\"active\":true,\"last_touched_at\":\"$(iso_ago 600)\"}"
  local live_artifact="$d/goal-verdict-$live.json"
  local dead_artifact="$d/codex-todo-$dead.json"
  write_state "$live_artifact" "{}"
  write_state "$dead_artifact" "{}"
  touch_ago "$live_artifact" 25200
  touch_ago "$dead_artifact" 25200

  reap_session_artifacts "$d" "__none__" "$NOW" 0 >/dev/null

  if [ ! -f "$live_artifact" ]; then
    echo "  ASSERTION FAILED: the newline/path guards must not affect an ordinary live-witnessed artifact — it must survive"
    return 1
  fi
  if [ -f "$dead_artifact" ]; then
    echo "  ASSERTION FAILED: the newline/path guards must not affect an ordinary unwitnessed stale artifact — it must still be reaped"
    return 1
  fi
  return 0
}

# A normal (non-forged) filename containing an ordinary space — not in its
# directory but in the filename itself — must still be judged correctly:
# the guards must not reject well-formed candidates.
test_reap_session_artifacts_space_in_filename_still_correctly_judged() {
  local d="$TEST_TMP_DIR"
  local stale="$d/codex-todo-space in name-stale-42.json"
  local fresh="$d/codex-todo-space in name-fresh-43.json"
  write_state "$stale" "{}"
  write_state "$fresh" "{}"
  touch_ago "$stale" 25200 # 7h — stale, no witness — must be reaped
  # $fresh: no touch_ago — fresh mtime — must survive

  reap_session_artifacts "$d" "unrelated-sid" "$NOW" 0 >/dev/null

  if [ -f "$stale" ]; then
    echo "  ASSERTION FAILED: a stale artifact with a space in its own filename (not just its directory) must still be reaped after the newline/path guards"
    return 1
  fi
  if [ ! -f "$fresh" ]; then
    echo "  ASSERTION FAILED: a fresh artifact with a space in its own filename must still survive after the newline/path guards"
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

test_state_prefixes_exactly_six_managed() {
  local count
  count=$(printf '%s\n' $STATE_PREFIXES | grep -c '.' 2>/dev/null || true)
  if [ "$count" -ne 6 ]; then
    echo "  ASSERTION FAILED: STATE_PREFIXES must have exactly 6 entries, found $count"
    echo "  STATE_PREFIXES=$STATE_PREFIXES"
    return 1
  fi

  local prefix
  for prefix in goal-state- ultragoal-state- prometheus-state- deep-interview-active-state- qa-state- explain-diff-state-; do
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
# test_state_prefixes_exactly_six_managed above. SESSION_ARTIFACT_PREFIXES
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
run_test test_is_state_live_honors_utc_z_suffix_not_local_wall_clock
run_test test_is_state_live_honors_explicit_utc_offset_suffix
run_test test_is_state_live_honors_local_kst_offset_suffix_regression_guard
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
run_test test_list_unclassified_ignores_non_uuid_shaped_files
run_test test_list_unclassified_reports_all_four_plan_ac_forms
run_test test_reap_dead_state_files_relocation_equivalence
run_test test_reap_dead_state_files_execute_mode_echoes_affected_paths
run_test test_reap_dead_state_files_execute_mode_echoes_real_path_not_constant
run_test test_reap_dead_state_files_dry_run_emits_candidate_but_does_not_delete
run_test test_reap_dead_state_files_dry_run_preserves_candidate_bytes
run_test test_reap_dead_state_files_old_closed_bak_survives_json_anchor
run_test test_reap_dead_state_files_emits_diag_breadcrumb_to_stderr
run_test test_is_current_session_suffix_match_diverges_from_base_exact_match_over_preserves
run_test test_reap_session_artifacts_current_session_self_artifact_survives
run_test test_reap_session_artifacts_other_live_session_survives_without_sid
run_test test_reap_session_artifacts_execute_mode_echoes_affected_paths
run_test test_reap_session_artifacts_execute_mode_echoes_real_path_not_constant
run_test test_reap_session_artifacts_empty_tail_fresh_survives_mtime_guard_only
run_test test_reap_session_artifacts_empty_tail_stale_is_reaped
run_test test_reap_session_artifacts_dry_run_emits_candidate_but_does_not_delete
run_test test_reap_session_artifacts_json_extension_stripped_for_live_id_match
run_test test_reap_session_artifacts_short_live_id_does_not_falsely_preserve
run_test test_reap_session_artifacts_dry_run_preserves_candidate_bytes
run_test test_reap_session_artifacts_namespaced_block_count_survives_none_lane
run_test test_reap_session_artifacts_stale_codex_todo_survives_via_fresh_block_count_witness
run_test test_reap_session_artifacts_stale_codex_todo_reaped_without_witness
run_test test_reap_session_artifacts_batched_stat_omission_fails_open
run_test test_reap_session_artifacts_space_bearing_dir_path_judged_correctly
run_test test_list_live_session_ids_space_bearing_dir_witness_pass
run_test test_list_live_session_ids_newline_filename_no_arbitrary_exec
run_test test_reap_session_artifacts_newline_filename_defect_a_no_arbitrary_exec_dry_run
run_test test_reap_session_artifacts_newline_filename_defect_b_no_out_of_dir_deletion_execute
run_test test_reap_session_artifacts_symlinked_nested_dir_target_not_deleted
run_test test_reap_session_artifacts_real_nested_dir_still_reaped
run_test test_reap_session_artifacts_symlinked_candidate_file_unlinks_only_the_link
run_test test_reap_session_artifacts_ordinary_candidates_unaffected_by_newline_guard
run_test test_reap_session_artifacts_space_in_filename_still_correctly_judged
run_test test_reap_dead_state_files_rm_failure_not_echoed_and_reported
run_test test_reap_session_artifacts_rm_failure_not_echoed_and_reported
run_test test_harmless_conditions_do_not_trip_set_e
run_test test_state_prefixes_exactly_six_managed
run_test test_session_artifact_prefixes_exactly_six_managed
run_test test_ttl_parity_with_state_core_ts
run_test test_ttl_allowlist_no_stray_literals

test_pretool_valid_lease_lock_is_not_unclassified() {
  local root="$TEST_TMP_DIR/root" key lock out
  key=$(printf 'a%.0s' $(seq 1 64)); mkdir -p "$root/pretool-trace/keys"
  lock="$root/pretool-trace/keys/$key.key.lease-lock"; mkdir "$lock"; : > "$lock/owner-$$-dead"
  out=$(list_pretool_trace_unclassified "$root")
  [ -z "$out" ]
}

test_pretool_lease_lock_extra_symlink_reported_and_preserved() {
  local root="$TEST_TMP_DIR/root" key lock out
  key=$(printf 'b%.0s' $(seq 1 64)); mkdir -p "$root/pretool-trace/keys"
  lock="$root/pretool-trace/keys/$key.key.lease-lock"; mkdir "$lock"; : > "$lock/owner-$$-dead"; mkdir "$root/target"; ln -s "$root/target" "$lock/extra"
  out=$(list_pretool_trace_unclassified "$root"); printf '%s\n' "$out" | grep -Fq "$lock"
  reap_pretool_trace_artifacts "$root" "$(date +%s)" 0 >/dev/null || true
  [ -L "$lock/extra" ] && [ -f "$lock/owner-$$-dead" ]
}

test_pretool_lease_lock_extra_directory_reported_and_preserved() {
  local root="$TEST_TMP_DIR/root" key lock out
  key=$(printf 'c%.0s' $(seq 1 64)); mkdir -p "$root/pretool-trace/keys"
  lock="$root/pretool-trace/keys/$key.key.lease-lock"; mkdir "$lock" "$lock/extra"; : > "$lock/owner-$$-dead"
  out=$(list_pretool_trace_unclassified "$root"); printf '%s\n' "$out" | grep -Fq "$lock"
  reap_pretool_trace_artifacts "$root" "$(date +%s)" 0 >/dev/null || true
  [ -d "$lock/extra" ] && [ -f "$lock/owner-$$-dead" ]
}

test_pretool_lease_lock_symlink_reported_and_preserved() {
  local root="$TEST_TMP_DIR/root" key lock out
  key=$(printf 'd%.0s' $(seq 1 64)); mkdir -p "$root/pretool-trace/keys" "$root/target"
  lock="$root/pretool-trace/keys/$key.key.lease-lock"; ln -s "$root/target" "$lock"
  out=$(list_pretool_trace_unclassified "$root"); printf '%s\n' "$out" | grep -Fq "$lock"
  [ -L "$lock" ]
}

run_test test_pretool_valid_lease_lock_is_not_unclassified
run_test test_pretool_lease_lock_extra_symlink_reported_and_preserved
run_test test_pretool_lease_lock_extra_directory_reported_and_preserved
run_test test_pretool_lease_lock_symlink_reported_and_preserved

# ---------------------------------------------------------------------------
# reap_pretool_trace_artifacts vs the append-lock protocol
#
# The append lock (scripts/pretool-trace/storage.ts: acquireAppendLock /
# inspectAndRecoverLock) is a DIRECTORY at pretool-trace/.append.lock. A HELD
# lock is exactly one regular, non-symlink owner file named
# "owner-<pid>-<nonce>" whose content is JSON {"pid":<pid>,"nonce":"<nonce>"}
# matching the name, with <pid> alive. Any deviation (dead pid, malformed
# JSON, name/JSON mismatch, >1 entry, unreadable owner, or a symlinked lock
# dir) is AMBIGUOUS. reap_pretool_trace_artifacts's trace-generation loop
# (state-liveness.sh:111-120) currently deletes stale events.jsonl[.1-3]
# without ever consulting this lock — these tests encode the contract that
# it must not.
# ---------------------------------------------------------------------------

# seed_pretool_trace_generations <root>
# Creates the four generation files, each aged past PRETOOL_TRACE_RETENTION_TTL
# (7 days) so every case below starts from an unconditionally-stale set.
seed_pretool_trace_generations() {
  local root="$1" trace name
  trace="$root/pretool-trace"
  mkdir -p "$trace"
  for name in events.jsonl events.jsonl.1 events.jsonl.2 events.jsonl.3; do
    printf 'x\n' > "$trace/$name"
    touch_ago "$trace/$name" 700000   # ~8.1 days — past the 7-day retention boundary
  done
}

test_pretool_append_lock_live_valid_owner_preserves_generations_and_lock() {
  local root="$TEST_TMP_DIR/root" trace lock nonce owner name
  seed_pretool_trace_generations "$root"
  trace="$root/pretool-trace"
  lock="$trace/.append.lock"; mkdir "$lock"
  nonce="abc123"
  owner="$lock/owner-$$-$nonce"
  printf '{"pid":%s,"nonce":"%s"}' "$$" "$nonce" > "$owner"
  reap_pretool_trace_artifacts "$root" "$NOW" 0 >/dev/null
  for name in events.jsonl events.jsonl.1 events.jsonl.2 events.jsonl.3; do
    [ -f "$trace/$name" ] || { echo "  MISSING: $trace/$name (deleted despite a live valid append-lock owner)"; return 1; }
  done
  [ -d "$lock" ] || { echo "  MISSING: $lock (live append lock evicted by cleanup)"; return 1; }
  [ -f "$owner" ] || { echo "  MISSING: $owner (live append-lock owner evicted by cleanup)"; return 1; }
}

test_pretool_append_lock_malformed_json_owner_preserves_generations() {
  local root="$TEST_TMP_DIR/root" trace lock nonce owner name
  seed_pretool_trace_generations "$root"
  trace="$root/pretool-trace"
  lock="$trace/.append.lock"; mkdir "$lock"
  nonce="abc123"
  owner="$lock/owner-$$-$nonce"
  printf 'not-json' > "$owner"
  reap_pretool_trace_artifacts "$root" "$NOW" 0 >/dev/null
  for name in events.jsonl events.jsonl.1 events.jsonl.2 events.jsonl.3; do
    [ -f "$trace/$name" ] || { echo "  MISSING: $trace/$name (deleted despite a malformed-JSON append-lock owner)"; return 1; }
  done
}

test_pretool_append_lock_name_json_mismatch_preserves_generations() {
  local root="$TEST_TMP_DIR/root" trace lock owner name
  seed_pretool_trace_generations "$root"
  trace="$root/pretool-trace"
  lock="$trace/.append.lock"; mkdir "$lock"
  owner="$lock/owner-$$-aaa"
  printf '{"pid":%s,"nonce":"bbb"}' "$$" > "$owner"
  reap_pretool_trace_artifacts "$root" "$NOW" 0 >/dev/null
  for name in events.jsonl events.jsonl.1 events.jsonl.2 events.jsonl.3; do
    [ -f "$trace/$name" ] || { echo "  MISSING: $trace/$name (deleted despite an owner name/JSON nonce mismatch)"; return 1; }
  done
}

test_pretool_append_lock_multiple_owners_preserves_generations() {
  local root="$TEST_TMP_DIR/root" trace lock name
  seed_pretool_trace_generations "$root"
  trace="$root/pretool-trace"
  lock="$trace/.append.lock"; mkdir "$lock"
  printf '{"pid":%s,"nonce":"aaa"}' "$$" > "$lock/owner-$$-aaa"
  printf '{"pid":%s,"nonce":"bbb"}' "$$" > "$lock/owner-$$-bbb"
  reap_pretool_trace_artifacts "$root" "$NOW" 0 >/dev/null
  for name in events.jsonl events.jsonl.1 events.jsonl.2 events.jsonl.3; do
    [ -f "$trace/$name" ] || { echo "  MISSING: $trace/$name (deleted despite a multi-owner append lock)"; return 1; }
  done
}

test_pretool_append_lock_unreadable_owner_preserves_generations() {
  local root="$TEST_TMP_DIR/root" trace lock nonce owner name status
  seed_pretool_trace_generations "$root"
  trace="$root/pretool-trace"
  lock="$trace/.append.lock"; mkdir "$lock"
  nonce="abc123"
  owner="$lock/owner-$$-$nonce"
  printf '{"pid":%s,"nonce":"%s"}' "$$" "$nonce" > "$owner"
  chmod 000 "$owner"
  reap_pretool_trace_artifacts "$root" "$NOW" 0 >/dev/null
  status=0
  for name in events.jsonl events.jsonl.1 events.jsonl.2 events.jsonl.3; do
    [ -f "$trace/$name" ] || { echo "  MISSING: $trace/$name (deleted despite an unreadable append-lock owner)"; status=1; }
  done
  chmod 600 "$owner" 2>/dev/null || true
  return "$status"
}

test_pretool_append_lock_symlink_lock_preserves_generations() {
  local root="$TEST_TMP_DIR/root" trace lock target name
  seed_pretool_trace_generations "$root"
  trace="$root/pretool-trace"
  target="$root/lock-target"; mkdir -p "$target"
  lock="$trace/.append.lock"; ln -s "$target" "$lock"
  reap_pretool_trace_artifacts "$root" "$NOW" 0 >/dev/null
  for name in events.jsonl events.jsonl.1 events.jsonl.2 events.jsonl.3; do
    [ -f "$trace/$name" ] || { echo "  MISSING: $trace/$name (deleted despite a symlinked .append.lock)"; return 1; }
  done
}

test_pretool_trace_generation_symlink_preserved_not_deleted() {
  local root="$TEST_TMP_DIR/root" trace target
  seed_pretool_trace_generations "$root"
  trace="$root/pretool-trace"
  target="$root/target-events"
  printf 'x\n' > "$target"
  touch_ago "$target" 700000
  rm -f "$trace/events.jsonl.1"
  ln -s "$target" "$trace/events.jsonl.1"
  reap_pretool_trace_artifacts "$root" "$NOW" 0 >/dev/null
  [ -L "$trace/events.jsonl.1" ] || { echo "  MISSING: $trace/events.jsonl.1 symlink (a symlinked generation must never be followed or deleted)"; return 1; }
}

test_pretool_append_lock_dead_owner_recovered_and_generations_deleted() {
  local root="$TEST_TMP_DIR/root" trace lock deadpid nonce owner name status
  seed_pretool_trace_generations "$root"
  trace="$root/pretool-trace"
  lock="$trace/.append.lock"; mkdir "$lock"
  ( sleep 0.01 ) &
  deadpid=$!
  wait "$deadpid" 2>/dev/null || true
  nonce="deadbeef"
  owner="$lock/owner-$deadpid-$nonce"
  printf '{"pid":%s,"nonce":"%s"}' "$deadpid" "$nonce" > "$owner"
  reap_pretool_trace_artifacts "$root" "$NOW" 0 >/dev/null
  status=0
  for name in events.jsonl events.jsonl.1 events.jsonl.2 events.jsonl.3; do
    [ ! -e "$trace/$name" ] || { echo "  SURVIVOR: $trace/$name (a recoverable dead-owner lock must not block cleanup)"; status=1; }
  done
  [ ! -e "$lock" ] || { echo "  SURVIVOR: $lock (a recovered append lock must be released, not left behind)"; status=1; }
  return "$status"
}

test_pretool_trace_dry_run_no_lock_creates_no_append_lock() {
  local root="$TEST_TMP_DIR/root" trace lock out name
  seed_pretool_trace_generations "$root"
  trace="$root/pretool-trace"
  lock="$trace/.append.lock"
  out=$(reap_pretool_trace_artifacts "$root" "$NOW" 1)
  for name in events.jsonl events.jsonl.1 events.jsonl.2 events.jsonl.3; do
    printf '%s\n' "$out" | grep -Fq "$trace/$name" || { echo "  MISSING FROM REPORT: $trace/$name"; return 1; }
  done
  [ ! -e "$lock" ] || { echo "  UNEXPECTED: $lock created by a dry run (dry-run must be read-only)"; return 1; }
}

test_pretool_trace_baseline_stale_generations_deleted_without_lock() {
  local root="$TEST_TMP_DIR/root" trace name
  seed_pretool_trace_generations "$root"
  trace="$root/pretool-trace"
  reap_pretool_trace_artifacts "$root" "$NOW" 0 >/dev/null
  for name in events.jsonl events.jsonl.1 events.jsonl.2 events.jsonl.3; do
    [ ! -e "$trace/$name" ] || { echo "  SURVIVOR: $trace/$name (expected baseline deletion when no append lock is present)"; return 1; }
  done
}

run_test test_pretool_append_lock_live_valid_owner_preserves_generations_and_lock
run_test test_pretool_append_lock_malformed_json_owner_preserves_generations
run_test test_pretool_append_lock_name_json_mismatch_preserves_generations
run_test test_pretool_append_lock_multiple_owners_preserves_generations
run_test test_pretool_append_lock_unreadable_owner_preserves_generations
run_test test_pretool_append_lock_symlink_lock_preserves_generations
run_test test_pretool_trace_generation_symlink_preserved_not_deleted
run_test test_pretool_append_lock_dead_owner_recovered_and_generations_deleted
run_test test_pretool_trace_dry_run_no_lock_creates_no_append_lock
run_test test_pretool_trace_baseline_stale_generations_deleted_without_lock

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"

if [ "$TESTS_FAILED" -gt 0 ]; then
  exit 1
fi
exit 0

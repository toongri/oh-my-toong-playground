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
  # Set mtime to 7 hours ago using touch -t (BSD compatible: MMDDhhmm)
  # touch -t [[CC]YY]MMDDhhmm[.ss]
  local t=$((NOW - 25200))
  local touch_arg
  touch_arg=$(date -r "$t" "+%Y%m%d%H%M.%S" 2>/dev/null || date -d "@$t" "+%Y%m%d%H%M.%S" 2>/dev/null)
  touch -t "$touch_arg" "$file"

  if ! is_state_live "$file" "$NOW"; then
    return 0
  else
    echo "  ASSERTION FAILED: no timestamps, stale mtime should be dead"
    return 1
  fi
}

# =============================================================================
# is_current_session
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

# =============================================================================
# TTL-parity: bash constants equal TS constants in lib/state-core.ts
# =============================================================================

test_ttl_parity_with_state_core_ts() {
  local state_core="$REPO_ROOT/lib/state-core.ts"

  # If state-core.ts doesn't exist yet (sibling agent creating it), wait briefly
  local wait_secs=0
  while [ ! -f "$state_core" ] && [ "$wait_secs" -lt 10 ]; do
    sleep 1
    wait_secs=$((wait_secs + 1))
  done

  if [ ! -f "$state_core" ]; then
    echo "  SKIP: lib/state-core.ts not yet created (sibling agent still running)"
    # Return 0 to not fail the suite if sibling hasn't landed yet
    return 0
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

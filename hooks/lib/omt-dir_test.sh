#!/bin/bash
# =============================================================================
# omt-dir.sh Resolution Hardening Tests
# TDD regression tests for:
#   1. Bare repo dir recognition (stops walk, delegates to compute_omt_dir)
#   2. $HOME boundary (walk does not escape to HOME/CLAUDE.md)
#   3. Non-git basename fallback emits stderr warning (still resolves, exit 0)
#   4. All git worktree paths resolve to canonical repo name (no regression)
#   5. Canonical resolution emits NO warning
# Compatible with macOS Bash 3.2.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---------------------------------------------------------------------------
# Suite setup/teardown: redirect HOME to a temp dir so every mkdir -p
# $HOME/.omt/... lands in the temp dir, not the real ~/.omt.
# Mirrors session-start_test.sh:15-47.
# ---------------------------------------------------------------------------
ORIGINAL_HOME="$HOME"
TEST_HOME="$(mktemp -d)"
export HOME="$TEST_HOME"

cleanup() {
  export HOME="$ORIGINAL_HOME"
  rm -rf "$TEST_HOME"
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# Test harness utilities (mirror resume-forge-start_test.sh pattern)
# ---------------------------------------------------------------------------
TESTS_PASSED=0
TESTS_FAILED=0

run_test() {
  local test_name="$1"
  if "$test_name"; then
    echo "[PASS] $test_name"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo "[FAIL] $test_name"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
}

# ---------------------------------------------------------------------------
# Helper: source omt-dir.sh with a clean OMT_DIR each call
# Returns: echoes result of resolve_omt_dir
# ---------------------------------------------------------------------------
call_resolve() {
  local path="$1"
  # Run in a subshell so OMT_DIR side-effects do not bleed between tests
  (
    unset OMT_DIR || true
    # shellcheck source=/dev/null
    source "$SCRIPT_DIR/omt-dir.sh"
    resolve_omt_dir "$path"
  )
}

# Like call_resolve but also captures stderr; echoes "STDOUT:<out>|STDERR:<err>"
call_resolve_with_stderr() {
  local path="$1"
  local _out _err _tmp
  _tmp=$(mktemp)
  _out=$(
    unset OMT_DIR || true
    source "$SCRIPT_DIR/omt-dir.sh"
    resolve_omt_dir "$path"
  ) 2>"$_tmp" || true
  _err=$(cat "$_tmp")
  rm -f "$_tmp"
  printf 'STDOUT:%s|STDERR:%s' "$_out" "$_err"
}

# =============================================================================
# AC (a): Bare repo dir resolves to canonical repo name, not $HOME basename
# =============================================================================
test_bare_dir_resolves_to_canonical_repo_name() {
  local bare_path="/Users/toong/repos/oh-my-toong-playground/.bare"

  # Skip if the .bare dir does not exist on this machine
  if [ ! -d "$bare_path" ]; then
    echo "  SKIP: $bare_path does not exist on this machine"
    return 0
  fi

  local result
  result=$(call_resolve "$bare_path")
  local name
  name=$(basename "$result")

  if [ "$name" = "oh-my-toong-playground" ]; then
    return 0
  else
    echo "  ASSERTION FAILED: expected basename 'oh-my-toong-playground', got '$name'"
    echo "  full result: '$result'"
    return 1
  fi
}

# =============================================================================
# AC (b): Markerless $HOME-child resolves to its OWN basename, NOT home basename
# =============================================================================
test_home_child_resolves_to_own_basename_not_home() {
  # Place CLAUDE.md in $HOME so the :89 marker check would trigger if the :81
  # boundary break were absent — this makes the test genuinely verify that the
  # $HOME boundary (omt-dir.sh:81) wins over the CLAUDE.md marker (omt-dir.sh:89).
  touch "$HOME/CLAUDE.md"

  # Create a temp dir directly inside $HOME (no .git, CLAUDE.md, package.json)
  local d
  d=$(mktemp -d "$HOME/omttest.XXXX")

  local result name expected_name
  result=$(call_resolve "$d")
  name=$(basename "$result")
  expected_name=$(basename "$d")

  # Cleanup immediately (temp dir; HOME/CLAUDE.md is reaped by suite teardown)
  rmdir "$d"

  if [ "$name" = "$expected_name" ]; then
    return 0
  else
    echo "  ASSERTION FAILED: expected basename '$expected_name', got '$name'"
    echo "  (regression: walk escaped to \$HOME, resolving to home basename)"
    return 1
  fi
}

# =============================================================================
# AC (c): Every git worktree list path resolves to oh-my-toong-playground
# =============================================================================
test_all_worktree_paths_resolve_to_canonical_name() {
  # Collect worktree paths from porcelain output (non-bare entries only)
  local worktree_paths=()
  local line path
  path=""
  while IFS= read -r line; do
    case "$line" in
      "worktree "*)
        path="${line#worktree }"
        ;;
      "bare")
        # skip bare worktree entry; its path is tested in AC (a)
        path=""
        ;;
      "")
        if [ -n "$path" ]; then
          worktree_paths=("${worktree_paths[@]+"${worktree_paths[@]}"}" "$path")
          path=""
        fi
        ;;
    esac
  done < <(git -C "$SCRIPT_DIR" worktree list --porcelain 2>/dev/null; echo "")

  local fail=0
  local count=0

  for wt_path in "${worktree_paths[@]+"${worktree_paths[@]}"}"; do
    # Only test paths that actually exist
    [ -d "$wt_path" ] || continue
    count=$((count + 1))

    local result name
    result=$(call_resolve "$wt_path")
    name=$(basename "$result")

    if [ "$name" != "oh-my-toong-playground" ]; then
      echo "  ASSERTION FAILED: worktree '$wt_path' → '$name', expected 'oh-my-toong-playground'"
      fail=1
    fi
  done

  if [ "$count" -eq 0 ]; then
    echo "  ASSERTION FAILED: no worktree paths found to test"
    return 1
  fi

  return $fail
}

# =============================================================================
# AC (d): Non-git path emits stderr warning "non-canonical" + resolves exit 0
# =============================================================================
test_nongit_path_emits_warning_and_resolves() {
  # Use a truly non-git temp path (no git repo above it)
  local tmp_dir
  tmp_dir=$(mktemp -d)
  # Ensure it is not inside any repo (use /tmp directly)
  local nongit_path="/tmp/omttest-nongit-$$"
  mkdir -p "$nongit_path"

  local combined result stderr_part
  combined=$(
    (
      unset OMT_DIR || true
      source "$SCRIPT_DIR/omt-dir.sh"
      resolve_omt_dir "$nongit_path"
    ) 2>&1 >/dev/null
  )

  # Capture stdout separately for the return-value check
  result=$(
    (
      unset OMT_DIR || true
      source "$SCRIPT_DIR/omt-dir.sh"
      resolve_omt_dir "$nongit_path"
    ) 2>/dev/null
  )

  rm -rf "$nongit_path" "$tmp_dir"

  # stderr must contain "non-canonical"
  if ! echo "$combined" | grep -q "non-canonical"; then
    echo "  ASSERTION FAILED: expected stderr to contain 'non-canonical'"
    echo "  stderr was: '$combined'"
    return 1
  fi

  # Return value must be $HOME/.omt/<basename>
  local expected_name
  expected_name=$(basename "$nongit_path")
  local expected_result="$HOME/.omt/$expected_name"

  if [ "$result" != "$expected_result" ]; then
    echo "  ASSERTION FAILED: expected result '$expected_result', got '$result'"
    return 1
  fi

  return 0
}

# =============================================================================
# AC (e): Canonical worktree resolution emits NO warning
# =============================================================================
test_canonical_worktree_emits_no_warning() {
  # Use the current working worktree path (this script's parent)
  local wt_path
  wt_path=$(cd "$SCRIPT_DIR" && git rev-parse --show-toplevel 2>/dev/null) || true

  if [ -z "$wt_path" ]; then
    echo "  SKIP: could not determine worktree toplevel"
    return 0
  fi

  local stderr_output
  stderr_output=$(
    (
      unset OMT_DIR || true
      source "$SCRIPT_DIR/omt-dir.sh"
      resolve_omt_dir "$wt_path"
    ) 2>&1 >/dev/null
  )

  if [ -z "$stderr_output" ]; then
    return 0
  else
    echo "  ASSERTION FAILED: expected no stderr on canonical resolution, got:"
    echo "  '$stderr_output'"
    return 1
  fi
}

# =============================================================================
# AC (f): cache hit avoids invoking git — behavioral core of the cwd-independent
# file cache. Seeds the cache with a real git repo, then re-resolves the same
# path with a decoy `git` on PATH that marks a file if invoked. No cache means
# the second call hits the decoy and leaves a marker — that is the RED signal.
# =============================================================================
test_cache_hit_avoids_invoking_git() {
  local repo
  repo=$(mktemp -d)
  (cd "$repo" && git init -q)

  # Seed the cache with a real resolution (real git on PATH).
  local first
  first=$(call_resolve "$repo")

  # Decoy `git`: if invoked, touches a marker and returns garbage.
  local fakebin marker
  fakebin=$(mktemp -d)
  marker="$fakebin/marker-hit"
  {
    echo '#!/bin/bash'
    echo "touch \"$marker\""
    echo 'echo FAKE-GIT-OUTPUT'
    echo 'exit 0'
  } > "$fakebin/git"
  chmod +x "$fakebin/git"

  local second
  second=$(
    unset OMT_DIR || true
    export PATH="$fakebin:$PATH"
    source "$SCRIPT_DIR/omt-dir.sh"
    resolve_omt_dir "$repo"
  )

  local marker_hit=0
  [ -f "$marker" ] && marker_hit=1

  rm -rf "$repo" "$fakebin"

  if [ "$first" != "$second" ]; then
    echo "  ASSERTION FAILED: cached value mismatch: seed='$first' second='$second'"
    return 1
  fi

  if [ "$marker_hit" -eq 1 ]; then
    echo "  ASSERTION FAILED: decoy git was invoked on the second call (cache miss)"
    return 1
  fi

  return 0
}

# =============================================================================
# AC (g): OMT_DIR env short-circuits before the cache is ever consulted or
# written — preserves the existing Claude env-var fast path unchanged.
# =============================================================================
test_omt_dir_env_short_circuits_before_cache() {
  local repo preset result
  repo=$(mktemp -d)
  preset="/some/preset/dir"

  result=$(
    export OMT_DIR="$preset"
    source "$SCRIPT_DIR/omt-dir.sh"
    compute_omt_dir "$repo"
    printf '%s' "$OMT_DIR"
  )

  local key cache_file
  key="${repo//\//_}"
  key="${key// /-}"
  cache_file="$HOME/.omt/.dir-cache/$key"

  rm -rf "$repo"

  if [ "$result" != "$preset" ]; then
    echo "  ASSERTION FAILED: expected OMT_DIR '$preset' to survive, got '$result'"
    return 1
  fi

  if [ -f "$cache_file" ]; then
    echo "  ASSERTION FAILED: cache file created despite OMT_DIR env short-circuit: $cache_file"
    return 1
  fi

  return 0
}

# =============================================================================
# AC (h): cached value equals the freshly computed value (cache miss vs hit
# return identical OMT_DIR for the same root path).
# =============================================================================
test_cached_value_equals_freshly_computed_value() {
  local repo miss_result hit_result
  repo=$(mktemp -d)
  (cd "$repo" && git init -q)

  miss_result=$(call_resolve "$repo")
  hit_result=$(call_resolve "$repo")

  rm -rf "$repo"

  if [ "$miss_result" != "$hit_result" ]; then
    echo "  ASSERTION FAILED: cache-miss result '$miss_result' != cache-hit result '$hit_result'"
    return 1
  fi

  return 0
}

# =============================================================================
# AC (i): empty argument skips cache logic entirely — no cache file is
# created and existing fallback behavior for an empty root is untouched.
# =============================================================================
test_empty_argument_skips_cache_logic() {
  local cache_dir="$HOME/.omt/.dir-cache"
  local before_count after_count

  before_count=0
  if [ -d "$cache_dir" ]; then
    before_count=$(find "$cache_dir" -type f 2>/dev/null | wc -l | tr -d ' ')
  fi

  (
    unset OMT_DIR || true
    source "$SCRIPT_DIR/omt-dir.sh"
    compute_omt_dir ""
  ) >/dev/null 2>&1 || true

  after_count=0
  if [ -d "$cache_dir" ]; then
    after_count=$(find "$cache_dir" -type f 2>/dev/null | wc -l | tr -d ' ')
  fi

  if [ "$after_count" -ne "$before_count" ]; then
    echo "  ASSERTION FAILED: cache file count changed from $before_count to $after_count on empty arg"
    return 1
  fi

  return 0
}

# =============================================================================
# AC (j): cache hit does not abort a `set -euo pipefail` consumer. Seeds the
# cache with a first resolve, then re-resolves the same root in a genuinely
# separate `bash -c 'set -euo pipefail; ...'` process — its own exit code must
# be 0. Regression: the cache-read `read -r OMT_DIR < file` on a newline-less
# cache file returns 1 at EOF even though OMT_DIR was assigned, which aborts
# every `set -e` hook consumer (resume-forge-start.sh, session-start.sh,
# codex-*.sh) at the moment of a cache hit.
#
# Must spawn a real subprocess rather than a nested subshell: bash ignores -e
# for any compound command executing inside a context where -e is already
# being ignored (here, this test function's own body, called via
# `if "$test_name"` in run_test) — a `set -e` re-declared inside a nested
# subshell in that context does not re-arm it, so the bug would go unnoticed.
# Also unsets OMT_DIR inside the spawned process before `set -e`: OMT_DIR is
# exported in the ambient dev/CI shell, and an inherited value would short-
# circuit compute_omt_dir at its very first line, never reaching the cache
# read this test targets.
# =============================================================================
test_cache_hit_does_not_abort_under_set_e() {
  local repo
  repo=$(mktemp -d)
  (cd "$repo" && git init -q)

  # Seed the cache with a first resolution.
  call_resolve "$repo" >/dev/null

  local rc=0
  OMT_DIR_TEST_LIB="$SCRIPT_DIR/omt-dir.sh" OMT_DIR_TEST_REPO="$repo" \
    bash -c 'unset OMT_DIR; set -euo pipefail; source "$OMT_DIR_TEST_LIB"; resolve_omt_dir "$OMT_DIR_TEST_REPO" >/dev/null' \
    || rc=$?

  rm -rf "$repo"

  if [ "$rc" -ne 0 ]; then
    echo "  ASSERTION FAILED: cache-hit resolve aborted under set -e (rc=$rc)"
    return 1
  fi

  return 0
}

# =============================================================================
# Main
# =============================================================================
main() {
  echo "=========================================="
  echo "omt-dir.sh Resolution Hardening Tests"
  echo "=========================================="

  run_test test_bare_dir_resolves_to_canonical_repo_name
  run_test test_home_child_resolves_to_own_basename_not_home
  run_test test_all_worktree_paths_resolve_to_canonical_name
  run_test test_nongit_path_emits_warning_and_resolves
  run_test test_canonical_worktree_emits_no_warning
  run_test test_cache_hit_avoids_invoking_git
  run_test test_omt_dir_env_short_circuits_before_cache
  run_test test_cached_value_equals_freshly_computed_value
  run_test test_empty_argument_skips_cache_logic
  run_test test_cache_hit_does_not_abort_under_set_e

  echo "=========================================="
  echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
  echo "=========================================="

  if [ $TESTS_FAILED -gt 0 ]; then
    exit 1
  fi
}

main "$@"

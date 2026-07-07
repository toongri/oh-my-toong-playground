#!/bin/bash
# =============================================================================
# label-patterns.sh Token Contract Tests
# Verifies the tiered invented-label matchers absorb git-master's 5 regexes
# (skills/git-master/SKILL.md:302-306) verbatim, plus the new hyphenated D-N
# pattern, and that both helpers are set -e-safe (no-match never aborts).
# Compatible with macOS Bash 3.2.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

# shellcheck source=/dev/null
source "$SCRIPT_DIR/label-patterns.sh"

# ---------------------------------------------------------------------------
# Test harness utilities (mirror omt-dir_test.sh pattern)
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

# assert_hard_matches <text> — expects label_match_hard to MATCH (exit 0)
assert_hard_matches() {
  local text="$1"
  if label_match_hard "$text"; then
    return 0
  else
    echo "  ASSERTION FAILED: label_match_hard did not match '$text' (expected MATCH)"
    return 1
  fi
}

# assert_hard_no_match <text> — expects label_match_hard to NOT match (exit 1)
assert_hard_no_match() {
  local text="$1"
  if label_match_hard "$text"; then
    echo "  ASSERTION FAILED: label_match_hard matched '$text' (expected NO-MATCH)"
    return 1
  else
    return 0
  fi
}

# assert_full_matches <text> — expects label_match_full to MATCH (exit 0)
assert_full_matches() {
  local text="$1"
  if label_match_full "$text"; then
    return 0
  else
    echo "  ASSERTION FAILED: label_match_full did not match '$text' (expected MATCH)"
    return 1
  fi
}

# assert_full_no_match <text> — expects label_match_full to NOT match (exit 1)
assert_full_no_match() {
  local text="$1"
  if label_match_full "$text"; then
    echo "  ASSERTION FAILED: label_match_full matched '$text' (expected NO-MATCH)"
    return 1
  else
    return 0
  fi
}

# =============================================================================
# HARD tier: MATCHES (D-N pattern + the two (?! \w)-guarded git-master patterns)
# =============================================================================
test_hard_matches_d1() { assert_hard_matches "D-1"; }
test_hard_matches_d36() { assert_hard_matches "D-36"; }
test_hard_matches_bare_p0() { assert_hard_matches "P0"; }
test_hard_matches_bare_h1() { assert_hard_matches "H1"; }

# =============================================================================
# HARD tier: does NOT match (standard tokens + unguarded-pattern-only strings)
# =============================================================================
test_hard_no_match_s3() { assert_hard_no_match "S3"; }
test_hard_no_match_k8s() { assert_hard_no_match "K8s"; }
test_hard_no_match_q3() { assert_hard_no_match "Q3"; }
test_hard_no_match_v2() { assert_hard_no_match "v2"; }
test_hard_no_match_http2() { assert_hard_no_match "HTTP2"; }
test_hard_no_match_utf8() { assert_hard_no_match "UTF-8"; }
test_hard_no_match_t1() { assert_hard_no_match "T1"; }
test_hard_no_match_k21() { assert_hard_no_match "K21"; }
test_hard_no_match_phase_rollout() { assert_hard_no_match "Phase 2 rollout"; }
test_hard_no_match_ac_m1_mac() { assert_hard_no_match "AC M1 Mac"; }
test_hard_no_match_step_tutorial() { assert_hard_no_match "Step 3 tutorial"; }

# =============================================================================
# HARD tier: does NOT match legitimate hyphenated non-D uppercase-letter+digit
# tokens (vitamin B12, paper size A4, aircraft F-16, etc) — regression guard
# for the over-broad `\b[A-Z]-\d+\b` alternative narrowed to `\bD-\d+\b`.
# =============================================================================
test_hard_no_match_b12() { assert_hard_no_match "B-12"; }
test_hard_no_match_a4() { assert_hard_no_match "A-4"; }
test_hard_no_match_f16() { assert_hard_no_match "F-16"; }
test_hard_no_match_b6() { assert_hard_no_match "B-6"; }
test_hard_no_match_c3() { assert_hard_no_match "C-3"; }

# =============================================================================
# FULL tier: additionally matches the unguarded git-master patterns
# =============================================================================
test_full_matches_step7() { assert_full_matches "Step 7"; }
test_full_matches_phase2() { assert_full_matches "Phase 2"; }
test_full_matches_ac_m1() { assert_full_matches "AC M1"; }

# =============================================================================
# FULL tier: still does NOT match the standard-token set
# =============================================================================
test_full_no_match_s3() { assert_full_no_match "S3"; }
test_full_no_match_k8s() { assert_full_no_match "K8s"; }
test_full_no_match_q3() { assert_full_no_match "Q3"; }
test_full_no_match_v2() { assert_full_no_match "v2"; }
test_full_no_match_http2() { assert_full_no_match "HTTP2"; }
test_full_no_match_utf8() { assert_full_no_match "UTF-8"; }

# =============================================================================
# FULL tier: same hyphenated non-D tokens still do NOT match
# =============================================================================
test_full_no_match_b12() { assert_full_no_match "B-12"; }
test_full_no_match_a4() { assert_full_no_match "A-4"; }
test_full_no_match_f16() { assert_full_no_match "F-16"; }
test_full_no_match_b6() { assert_full_no_match "B-6"; }
test_full_no_match_c3() { assert_full_no_match "C-3"; }

# =============================================================================
# set -e safety: a no-match call inside `if` must never abort the caller
# =============================================================================
test_hard_no_match_is_set_e_safe() {
  # Runs in a subshell with set -euo pipefail active; if label_match_hard's
  # internal perl non-match exit code were to propagate as a bare failing
  # statement, this subshell would abort before reaching the final echo.
  local out
  out=$(
    set -euo pipefail
    source "$SCRIPT_DIR/label-patterns.sh"
    if label_match_hard "no invented label here"; then
      echo "matched"
    else
      echo "no-match-safe"
    fi
    echo "reached-end"
  )
  if [ "$out" = "$(printf 'no-match-safe\nreached-end')" ]; then
    return 0
  else
    echo "  ASSERTION FAILED: set -e safety check output was: '$out'"
    return 1
  fi
}

test_full_no_match_is_set_e_safe() {
  local out
  out=$(
    set -euo pipefail
    source "$SCRIPT_DIR/label-patterns.sh"
    if label_match_full "no invented label here"; then
      echo "matched"
    else
      echo "no-match-safe"
    fi
    echo "reached-end"
  )
  if [ "$out" = "$(printf 'no-match-safe\nreached-end')" ]; then
    return 0
  else
    echo "  ASSERTION FAILED: set -e safety check output was: '$out'"
    return 1
  fi
}

# =============================================================================
# Main
# =============================================================================
main() {
  echo "=========================================="
  echo "label-patterns.sh Token Contract Tests"
  echo "=========================================="

  run_test test_hard_matches_d1
  run_test test_hard_matches_d36
  run_test test_hard_matches_bare_p0
  run_test test_hard_matches_bare_h1

  run_test test_hard_no_match_s3
  run_test test_hard_no_match_k8s
  run_test test_hard_no_match_q3
  run_test test_hard_no_match_v2
  run_test test_hard_no_match_http2
  run_test test_hard_no_match_utf8
  run_test test_hard_no_match_t1
  run_test test_hard_no_match_k21
  run_test test_hard_no_match_phase_rollout
  run_test test_hard_no_match_ac_m1_mac
  run_test test_hard_no_match_step_tutorial
  run_test test_hard_no_match_b12
  run_test test_hard_no_match_a4
  run_test test_hard_no_match_f16
  run_test test_hard_no_match_b6
  run_test test_hard_no_match_c3

  run_test test_full_matches_step7
  run_test test_full_matches_phase2
  run_test test_full_matches_ac_m1

  run_test test_full_no_match_s3
  run_test test_full_no_match_k8s
  run_test test_full_no_match_q3
  run_test test_full_no_match_v2
  run_test test_full_no_match_http2
  run_test test_full_no_match_utf8
  run_test test_full_no_match_b12
  run_test test_full_no_match_a4
  run_test test_full_no_match_f16
  run_test test_full_no_match_b6
  run_test test_full_no_match_c3

  run_test test_hard_no_match_is_set_e_safe
  run_test test_full_no_match_is_set_e_safe

  echo "=========================================="
  echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
  echo "=========================================="

  if [ $TESTS_FAILED -gt 0 ]; then
    exit 1
  fi
}

main "$@"

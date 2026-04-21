#!/usr/bin/env bash
# cross-refs.sh — Symmetry assertion suite for tech-claim-rubric / review-resume / resume-forge
#
# 7 assertions. Exit 0 only when all pass.
# Any drift → descriptive error + exit 1.
#
# Usage:  bash tools/validators/cross-refs.sh
#         make validate-cross-refs

set -euo pipefail

# ---------------------------------------------------------------------------
# Locate repo root (two levels up from this script: tools/validators/)
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# ---------------------------------------------------------------------------
# Colour helpers (no-op when not a terminal)
# ---------------------------------------------------------------------------
RED=''
GREEN=''
RESET=''
if [ -t 1 ]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  RESET='\033[0m'
fi

PASS_COUNT=0
FAIL_COUNT=0

pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  printf "${GREEN}PASS${RESET} [A%d] %s\n" "$1" "$2"
}

fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  printf "${RED}FAIL${RESET} [A%d] %s\n" "$1" "$2"
  if [ -n "${3:-}" ]; then
    printf "     %s\n" "$3"
  fi
}

# ---------------------------------------------------------------------------
# A1 — P1-1 routing condition symmetry
#
# `count(P1 across A1-A4) < 3` must appear 8+ times across:
#   output-schema.md, SKILL.md, a5-scanability.md, resume-forge/SKILL.md,
#   agents/tech-claim-examiner.md
# ---------------------------------------------------------------------------
ASSERTION=1
LABEL="P1-1 routing condition symmetry"

MATCH_COUNT=$(grep -c "count(P1 across A1-A4)" \
  "$REPO_ROOT/skills/tech-claim-rubric/output-schema.md" \
  "$REPO_ROOT/skills/tech-claim-rubric/SKILL.md" \
  "$REPO_ROOT/skills/tech-claim-rubric/a5-scanability.md" \
  "$REPO_ROOT/skills/resume-forge/SKILL.md" \
  "$REPO_ROOT/agents/tech-claim-examiner.md" \
  2>/dev/null | awk -F: '{sum+=$NF} END{print sum}') || MATCH_COUNT=0

if [ "${MATCH_COUNT}" -ge 8 ]; then
  pass "$ASSERTION" "$LABEL (${MATCH_COUNT} matches)"
else
  fail "$ASSERTION" "$LABEL" \
    "Expected 8+ matches, found ${MATCH_COUNT}. Check output-schema.md, SKILL.md, a5-scanability.md, resume-forge/SKILL.md, agents/tech-claim-examiner.md"
fi

# ---------------------------------------------------------------------------
# A2 — schema_version consistency
#
# All `schema_version` version-string values must be identical across:
#   skills/tech-claim-rubric, agents/tech-claim-examiner.md
# ---------------------------------------------------------------------------
ASSERTION=2
LABEL="schema_version consistency"

VERSIONS=$(grep -rh "schema_version" \
  "$REPO_ROOT/skills/tech-claim-rubric" \
  "$REPO_ROOT/agents/tech-claim-examiner.md" \
  2>/dev/null \
  | grep -oE '"v[0-9.]+"' \
  | sort -u)

DISTINCT_COUNT=$(printf '%s\n' "$VERSIONS" | grep -c . 2>/dev/null || echo 0)

if [ "${DISTINCT_COUNT}" -eq 1 ]; then
  pass "$ASSERTION" "$LABEL (${VERSIONS})"
elif [ "${DISTINCT_COUNT}" -eq 0 ]; then
  fail "$ASSERTION" "$LABEL" \
    "No schema_version values found. At least one is required."
else
  fail "$ASSERTION" "$LABEL" \
    "Multiple distinct schema_version values found: $(printf '%s\n' "$VERSIONS" | tr '\n' ' ')"
fi

# ---------------------------------------------------------------------------
# A3 — P1-5 multiplier direction symmetry
#
# Both `after / before` and `before / after` must appear in:
#   agents/tech-claim-examiner.md AND skills/tech-claim-rubric/a2-causal-honesty.md
# ---------------------------------------------------------------------------
ASSERTION=3
LABEL="P1-5 multiplier direction symmetry"

EXAMINER="$REPO_ROOT/agents/tech-claim-examiner.md"
A2="$REPO_ROOT/skills/tech-claim-rubric/a2-causal-honesty.md"

A3_FAIL=0

for FILE in "$EXAMINER" "$A2"; do
  FNAME="$(basename "$FILE")"
  if ! grep -qE "after[[:space:]]*/[[:space:]]*before" "$FILE" 2>/dev/null; then
    fail "$ASSERTION" "$LABEL" \
      "Missing 'after / before' direction in ${FNAME}"
    A3_FAIL=1
  fi
  if ! grep -qE "before[[:space:]]*/[[:space:]]*after" "$FILE" 2>/dev/null; then
    fail "$ASSERTION" "$LABEL" \
      "Missing 'before / after' direction in ${FNAME}"
    A3_FAIL=1
  fi
done

if [ "$A3_FAIL" -eq 0 ]; then
  pass "$ASSERTION" "$LABEL"
fi

# ---------------------------------------------------------------------------
# A4 — P1-8 HTML opt-out structural alignment
#
# Both content-quality-gate.md and html-template.html must define
# the same set of structural CSS classes for opt-out sections:
#   section-opt-out, opt-out-badge, unresolved-feedback, fail-axis,
#   hint-category, axis-feedback
# ---------------------------------------------------------------------------
ASSERTION=4
LABEL="P1-8 HTML opt-out structural alignment"

GATE="$REPO_ROOT/skills/review-resume/references/content-quality-gate.md"
HTML="$REPO_ROOT/skills/review-resume/references/html-template.html"

OPT_OUT_CLASSES="section-opt-out opt-out-badge unresolved-feedback fail-axis hint-category axis-feedback"

A4_FAIL=0
for CLASS in $OPT_OUT_CLASSES; do
  for FILE in "$GATE" "$HTML"; do
    FNAME="$(basename "$FILE")"
    if ! grep -q "$CLASS" "$FILE" 2>/dev/null; then
      fail "$ASSERTION" "$LABEL" \
        "Class '${CLASS}' missing in ${FNAME}"
      A4_FAIL=1
    fi
  done
done

if [ "$A4_FAIL" -eq 0 ]; then
  pass "$ASSERTION" "$LABEL"
fi

# ---------------------------------------------------------------------------
# A5 — SCN registry uniqueness
#
# No duplicate SCN IDs across scenarios.md files.
# Handles both `### SCN-` and `## SCN-` heading patterns.
# ---------------------------------------------------------------------------
ASSERTION=5
LABEL="SCN registry uniqueness"

SCN_RUBRIC="$REPO_ROOT/skills/tech-claim-rubric/tests/scenarios.md"
SCN_FORGE="$REPO_ROOT/skills/resume-forge/tests/scenarios.md"

# Check within each file independently — SCN IDs are scoped per-file
A5_FAIL=0
for SCN_FILE in "$SCN_RUBRIC" "$SCN_FORGE"; do
  SCN_FNAME="$(basename "$(dirname "$SCN_FILE")")/tests/$(basename "$SCN_FILE")"
  DUPS=$(grep -E "^#{1,4} SCN-[A-Za-z0-9-]+" "$SCN_FILE" 2>/dev/null \
    | sed 's/^#* //' \
    | sed 's/:.*//' \
    | sort \
    | uniq -d)
  if [ -n "$DUPS" ]; then
    fail "$ASSERTION" "$LABEL" \
      "Duplicate SCN IDs in ${SCN_FNAME}: $(printf '%s ' $DUPS)"
    A5_FAIL=1
  fi
done

if [ "$A5_FAIL" -eq 0 ]; then
  pass "$ASSERTION" "$LABEL"
fi

# ---------------------------------------------------------------------------
# A6 — forbidden-tokens catalog catches retired axis name (optional)
#
# Inject "Problem Fidelity axis" into a temp file inside scan scope,
# run forbidden-tokens validator, expect non-zero exit (violation detected).
# ---------------------------------------------------------------------------
ASSERTION=6
LABEL="forbidden-tokens catalog catches retired axis name"

TMP_DIR=$(mktemp -d)
TMP_FILE="$REPO_ROOT/skills/tech-claim-rubric/_cross-refs-test-fixture.md"

cleanup() {
  rm -f "$TMP_FILE"
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

# Write a fixture with a retired token
printf '# Test fixture — cross-refs drift check\nProblem Fidelity axis\n' > "$TMP_FILE"

# Run validator; it should exit non-zero (violation found)
if ! bun run --cwd "$REPO_ROOT" tools/validators/forbidden-tokens.ts > "$TMP_DIR/ft-out.txt" 2>&1; then
  # Non-zero exit means violations were detected — that's correct behaviour
  if grep -q "Problem-Fidelity-retired-v1-axis" "$TMP_DIR/ft-out.txt" 2>/dev/null; then
    pass "$ASSERTION" "$LABEL"
  else
    fail "$ASSERTION" "$LABEL" \
      "forbidden-tokens exited non-zero but did not report Problem-Fidelity violation. Output: $(head -5 "$TMP_DIR/ft-out.txt")"
  fi
else
  fail "$ASSERTION" "$LABEL" \
    "forbidden-tokens exited 0 despite fixture containing 'Problem Fidelity axis' — catalog not catching retired token"
fi

# Cleanup happens via trap

# ---------------------------------------------------------------------------
# A7 — Resolution Log completeness
#
# The 51 canonical finding_ids must all be present in resolution-log.md.
# Extra entries (regression, catalog suffixes) are allowed.
# ---------------------------------------------------------------------------
ASSERTION=7
LABEL="Resolution Log completeness"

RESOLUTION_LOG="${OMT_DIR:-$HOME/.omt/oh-my-toong-playground}/evidence/resume-loop-51-findings-cleanup/resolution-log.md"

# Expected set: P1-1..10, P2-1..10, P3-1..26, Hold-1, Dismissed-1..4
EXPECTED_IDS=""
for N in $(seq 1 10);  do EXPECTED_IDS="$EXPECTED_IDS P1-$N"; done
for N in $(seq 1 10);  do EXPECTED_IDS="$EXPECTED_IDS P2-$N"; done
for N in $(seq 1 26);  do EXPECTED_IDS="$EXPECTED_IDS P3-$N"; done
EXPECTED_IDS="$EXPECTED_IDS Hold-1"
for N in $(seq 1 4);   do EXPECTED_IDS="$EXPECTED_IDS Dismissed-$N"; done

if [ ! -f "$RESOLUTION_LOG" ]; then
  fail "$ASSERTION" "$LABEL" \
    "resolution-log.md not found at: ${RESOLUTION_LOG}"
else
  ACTUAL_IDS=$(grep "^finding_id:" "$RESOLUTION_LOG" | awk '{print $2}')
  MISSING=""
  for ID in $EXPECTED_IDS; do
    if ! printf '%s\n' $ACTUAL_IDS | grep -qx "$ID"; then
      MISSING="$MISSING $ID"
    fi
  done

  if [ -z "$MISSING" ]; then
    pass "$ASSERTION" "$LABEL (51/51 present)"
  else
    fail "$ASSERTION" "$LABEL" \
      "Missing finding_ids:${MISSING}"
  fi
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
printf '\n'
printf 'cross-refs: %d passed, %d failed\n' "$PASS_COUNT" "$FAIL_COUNT"

if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi
exit 0

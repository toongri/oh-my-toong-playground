#!/bin/bash
# =============================================================================
# score.py Tests
# Hermetic: fixtures live in a mktemp dir removed on exit.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCORE_PY="$SCRIPT_DIR/score.py"

TESTS_PASSED=0
TESTS_FAILED=0

WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT

pass() { echo "PASS: $1"; TESTS_PASSED=$((TESTS_PASSED + 1)); }
fail() { echo "FAIL: $1"; TESTS_FAILED=$((TESTS_FAILED + 1)); }

assert_contains() {
    local name="$1" haystack="$2" needle="$3"
    if printf '%s\n' "$haystack" | grep -qF -- "$needle"; then
        pass "$name"
    else
        fail "$name (missing: $needle)"
    fi
}

# Fixture: S-A-2 r1 C, r2 P / S-A-10 r1 W, r2 C / S-A-3 r1 C (r2 missing)
GRADES_DIR="$WORK_DIR/grades"
mkdir -p "$GRADES_DIR"
cat > "$GRADES_DIR/grades-1.csv" <<'CSV'
scenario,rep,grade,note
S-A-2,r1,C,
S-A-2,r2,P,
S-A-10,r1,W,
S-A-10,r2,C,
S-A-3,r1,C,
CSV

OUT="$WORK_DIR/out.md"
MAIN_EXIT=0
STDOUT=$(python3 -I "$SCORE_PY" "$GRADES_DIR" "$OUT" --reps r1,r2 2>/dev/null) || MAIN_EXIT=$?
REPORT=$(cat "$OUT")

if [[ "$MAIN_EXIT" -ne 0 ]]; then
    pass "scenario missing a rep exits non-zero"
else
    fail "scenario missing a rep must exit non-zero"
fi

assert_contains "row for S-A-2 has grades CP and score 0.75" "$REPORT" '| S-A-2 | CP | 1 | 1 | 0 | 0.75 |'
assert_contains "total line counts only complete scenarios" "$REPORT" 'Total: 4 answers, C 2 / P 1 / W 1, score 0.625'
assert_contains "scenario missing a rep is listed as excluded" "$REPORT" 'Missing reps (excluded): S-A-3'
assert_contains "stdout echoes the total" "$STDOUT" 'Total: 4 answers, C 2 / P 1 / W 1, score 0.625'

if printf '%s\n' "$REPORT" | grep -qF '| S-A-3 |'; then
    fail "excluded scenario must not get a table row"
else
    pass "excluded scenario has no table row"
fi

LINE_2=$(grep -n -F '| S-A-2 |' "$OUT" | cut -d: -f1)
LINE_10=$(grep -n -F '| S-A-10 |' "$OUT" | cut -d: -f1)
if [[ -n "$LINE_2" && -n "$LINE_10" && "$LINE_2" -lt "$LINE_10" ]]; then
    pass "scenarios sort numerically (S-A-2 before S-A-10)"
else
    fail "scenarios sort numerically (S-A-2 line '$LINE_2', S-A-10 line '$LINE_10')"
fi

BAD_DIR="$WORK_DIR/bad"
mkdir -p "$BAD_DIR"
printf 'scenario,rep,grade,note\nS-A-1,r1,X,\n' > "$BAD_DIR/grades-1.csv"
if python3 -I "$SCORE_PY" "$BAD_DIR" "$WORK_DIR/bad-out.md" --reps r1 >/dev/null 2>&1; then
    fail "invalid grade X must exit non-zero"
else
    pass "invalid grade X exits non-zero"
fi

# Rubric lists S-A-4, which no grader graded: it must be reported and fail the run.
RUBRIC_DIR="$WORK_DIR/rubric"
mkdir -p "$RUBRIC_DIR"
printf '### S-A-2 two\n### S-A-10 ten\n' > "$RUBRIC_DIR/scenarios-a.md"
printf '### S-A-4 four\n' > "$RUBRIC_DIR/scenarios-b.md"
COMPLETE_DIR="$WORK_DIR/complete"
mkdir -p "$COMPLETE_DIR"
printf 'scenario,rep,grade,note\nS-A-2,r1,C,\nS-A-2,r2,C,\nS-A-10,r1,C,\nS-A-10,r2,C,\n' > "$COMPLETE_DIR/grades-1.csv"
FULL_RUBRIC_DIR="$WORK_DIR/full-rubric"
mkdir -p "$FULL_RUBRIC_DIR"
cp "$RUBRIC_DIR/scenarios-a.md" "$FULL_RUBRIC_DIR/"
if python3 -I "$SCORE_PY" "$COMPLETE_DIR" "$WORK_DIR/complete-out.md" --reps r1,r2 --scenarios "$FULL_RUBRIC_DIR" >/dev/null 2>&1; then
    pass "complete grades exit zero"
else
    fail "complete grades must exit zero"
fi
if python3 -I "$SCORE_PY" "$COMPLETE_DIR" "$WORK_DIR/typo-out.md" --reps r1,r2 --scenarios "$WORK_DIR/none" >/dev/null 2>&1; then
    fail "rubric dir with no scenario headings must exit non-zero"
else
    pass "rubric dir with no scenario headings exits non-zero"
fi

DUP_DIR="$WORK_DIR/dup"
mkdir -p "$DUP_DIR"
printf 'scenario,rep,grade,note\nS-A-2,r1,W,\nS-A-2,r2,C,\n' > "$DUP_DIR/grades-1.csv"
printf 'scenario,rep,grade,note\nS-A-2,r1,C,\n' > "$DUP_DIR/grades-2.csv"
DUP_ERR=$(python3 -I "$SCORE_PY" "$DUP_DIR" "$WORK_DIR/dup-out.md" --reps r1,r2 2>&1 >/dev/null) && DUP_EXIT=0 || DUP_EXIT=$?
if [[ "$DUP_EXIT" -ne 0 ]]; then
    pass "scenario/rep graded twice exits non-zero"
else
    fail "scenario/rep graded twice must exit non-zero"
fi
assert_contains "duplicate grade names the scenario and rep" "$DUP_ERR" 'S-A-2 r1'
UNGRADED_OUT="$WORK_DIR/ungraded-out.md"
if python3 -I "$SCORE_PY" "$COMPLETE_DIR" "$UNGRADED_OUT" --reps r1,r2 --scenarios "$RUBRIC_DIR" >/dev/null 2>&1; then
    fail "ungraded rubric scenario must exit non-zero"
else
    pass "ungraded rubric scenario exits non-zero"
fi
assert_contains "ungraded rubric scenario is listed" "$(cat "$UNGRADED_OUT" 2>/dev/null)" 'No grades: S-A-4'

echo ""
echo "Passed: $TESTS_PASSED, Failed: $TESTS_FAILED"
[[ "$TESTS_FAILED" -eq 0 ]]

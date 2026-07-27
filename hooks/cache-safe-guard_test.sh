#!/bin/bash
# =============================================================================
# Cache-Safe Guard Tests (TODO 5)
# Regression net for PREFIX-position context emitters.
#
# Guards that the combined stdout of three emitters matches NONE of the five
# volatile-value patterns that would break prompt-cache determinism:
#   1. /(Users|home)/[^"]*     — expanded abs path (AUXILIARY)
#   2. <SESSION_ID value>      — raw session ID (LOAD-BEARING)
#   3. Iteration:? *\d+/\d+   — digit/digit progress
#   4. resume-forge-[^"]*\.json — resume-forge filename
#   5. \b\d+ incomplete tasks\b — task count
#
# Emitters under guard:
#   - hooks/session-start.sh         (prometheus restore + pending + ledger recording instruction)
#   - hooks/resume-forge-start.sh    (restore block)
#   - skills/sisyphus/hooks/skill-catalog/index.ts  (static macro)
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

TESTS_PASSED=0
TESTS_FAILED=0
# Must be set before the first setup_test_env call: otherwise its re-entrant
# check below sees a value inherited from the ambient environment (not one
# this suite created) and tears down/rm -rf's a directory it never made.
TEST_TMP_DIR=""

# =============================================================================
# Test harness — mirrors session-start_test.sh / resume-forge-start_test.sh
# =============================================================================

setup_test_env() {
    # Re-entrant: a caller that has already set up a TEST_TMP_DIR/TEST_HOME
    # (e.g. the CLAUDE_ENV_FILE scrub regression test below, which calls
    # setup_test_env a second time after run_test's own call) must have its
    # first pair torn down before a second pair is created, or the first
    # pair is orphaned without cleanup.
    # `|| true` is required here (unlike the sibling test files' if/then/fi
    # teardowns): this file's teardown_test_env uses the short-circuit
    # `[ -d ] && rm -rf` form, which returns exit 1 under set -e when the
    # directory is already gone.
    if [ -n "${TEST_TMP_DIR:-}" ]; then
        teardown_test_env || true
    fi

    TEST_TMP_DIR=$(mktemp -d)
    mkdir -p "$TEST_TMP_DIR/.omt"
    mkdir -p "$TEST_TMP_DIR/.git"

    ORIGINAL_HOME="$HOME"
    TEST_HOME=$(mktemp -d)
    mkdir -p "$TEST_HOME/.claude"
    export HOME="$TEST_HOME"
    unset OMT_DIR
    unset OMT_PROJECT
    # Scrub CLAUDE_ENV_FILE before every test's body runs -- otherwise any
    # test spawning session-start.sh / resume-forge-start.sh without its own
    # override inherits the ambient value (e.g. a live Claude Code session's
    # real env file) and the hook silently overwrites it with this suite's
    # throwaway fixtures.
    unset CLAUDE_ENV_FILE

    # Pre-compute TEST_OMT_DIR: mirrors hooks' OMT_DIR derivation.
    # TEST_TMP_DIR has no real git repo, so PROJECT_NAME = basename(TEST_TMP_DIR).
    TEST_PROJECT_NAME=$(basename "$TEST_TMP_DIR")
    TEST_OMT_DIR="$TEST_HOME/.omt/$TEST_PROJECT_NAME"
    mkdir -p "$TEST_OMT_DIR"
    mkdir -p "$TEST_OMT_DIR/state"
}

teardown_test_env() {
    export HOME="$ORIGINAL_HOME"
    [ -d "${TEST_TMP_DIR:-}" ] && rm -rf "$TEST_TMP_DIR"
    [ -d "${TEST_HOME:-}" ] && rm -rf "$TEST_HOME"
}

run_test() {
    local test_name="$1"
    setup_test_env
    if "$test_name"; then
        echo "[PASS] $test_name"
        ((TESTS_PASSED++)) || true
    else
        echo "[FAIL] $test_name"
        ((TESTS_FAILED++)) || true
    fi
    teardown_test_env
}

# =============================================================================
# Core guard: assert combined stdout matches NONE of the 5 patterns
# Returns 0 if all patterns ABSENT (clean), non-zero if any pattern FOUND (leak)
# =============================================================================
assert_no_volatile_patterns() {
    local combined="$1"
    local sid="$2"
    local label="${3:-}"
    local found=0

    # Pattern 1 (AUXILIARY): no expanded abs path under /Users or /home
    if printf '%s' "$combined" | grep -qE '/(Users|home)/[^"]*'; then
        local match
        match=$(printf '%s' "$combined" | grep -oE '/(Users|home)/[^"]*' | head -1)
        echo "  LEAK${label} Pattern 1 (abs path): $match"
        found=1
    fi

    # Pattern 2 (LOAD-BEARING): raw session ID must NEVER appear in stdout
    # The unexpanded-pointer design emits literal \$OMT_SESSION_ID, so the
    # actual sid value zzqqxx must not appear anywhere.
    if printf '%s' "$combined" | grep -qF "$sid"; then
        echo "  LEAK${label} Pattern 2 (raw SESSION_ID '$sid' found in stdout)"
        found=1
    fi

    # Pattern 3: no Iteration N/M progress ratio
    if printf '%s' "$combined" | grep -qE 'Iteration:? *[0-9]+/[0-9]+'; then
        local match
        match=$(printf '%s' "$combined" | grep -oE 'Iteration:? *[0-9]+/[0-9]+' | head -1)
        echo "  LEAK${label} Pattern 3 (digit/digit iteration): $match"
        found=1
    fi

    # Pattern 4: no resume-forge-*.json filename in stdout
    if printf '%s' "$combined" | grep -qE 'resume-forge-[^"]*\.json'; then
        local match
        match=$(printf '%s' "$combined" | grep -oE 'resume-forge-[^"]*\.json' | head -1)
        echo "  LEAK${label} Pattern 4 (resume-forge filename): $match"
        found=1
    fi

    # Pattern 5: no 'N incomplete tasks' count in stdout
    if printf '%s' "$combined" | grep -qE '\b[0-9]+ incomplete tasks\b'; then
        local match
        match=$(printf '%s' "$combined" | grep -oE '\b[0-9]+ incomplete tasks\b' | head -1)
        echo "  LEAK${label} Pattern 5 (incomplete task count): $match"
        found=1
    fi

    return $found
}

# =============================================================================
# RED demonstration: guard catches a session-ID leak in a throwaway emitter
#
# Creates a scratch shell script (never touches the real emitters) that
# regresses by embedding the raw SESSION_ID in its output.  Verifies that
# assert_no_volatile_patterns correctly REJECTS the poisoned output.
# =============================================================================
test_guard_red_demo_session_id_leak() {
    local sid="zzqqxx"
    local scratch
    scratch=$(mktemp "$TEST_TMP_DIR/scratch_emitter_XXXXXX.sh")

    # Throwaway emitter that embeds the raw SESSION_ID — the regression we are guarding against
    cat > "$scratch" << 'SCRATCH_EOF'
#!/bin/bash
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.sessionId // ""')
# REGRESSION BUG: raw session ID embedded in output — breaks prompt-cache prefix determinism
echo "{\"continue\": true, \"hookSpecificOutput\": {\"additionalContext\": \"Restoring session context for ${SESSION_ID} -- continuing previous work\"}}"
SCRATCH_EOF
    chmod +x "$scratch"

    local poisoned_out
    poisoned_out=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' \
        | bash "$scratch" 2>/dev/null) || true
    rm -f "$scratch"

    # Guard must DETECT the leak (assert_no_volatile_patterns must return non-zero)
    if assert_no_volatile_patterns "$poisoned_out" "$sid" " [RED-demo]"; then
        echo "ASSERTION FAILED [RED demo]: guard should have caught the SESSION_ID leak but passed"
        return 1
    fi
    # Guard correctly rejected the poisoned output — RED confirmed
    return 0
}

# =============================================================================
# AC12 GREEN: combined stdout of all three real emitters matches NONE of 5 patterns
#
# Emitter setup:
#   session-start.sh  — active prometheus state (restore block)
#                     + pending todos (pending-tasks block)
#                     + static ledger recording instruction (TODO 3, every session)
#   resume-forge-start.sh — active resume-forge state file (restore block)
#   skill-catalog/index.ts — static macro (no fixture needed)
# =============================================================================
test_cache_safe_guard_ac12_green() {
    local sid="zzqqxx"
    local now_ts
    now_ts=$(date "+%Y-%m-%dT%H:%M:%S")

    # --- session-start.sh fixture 1: active prometheus state ---
    # Triggers the PROMETHEUS RESTORED block with UNEXPANDED cat pointer.
    cat > "$TEST_OMT_DIR/prometheus-state-${sid}.json" << EOF
{
  "active": true,
  "phase": "STAGE_B",
  "plan_path": "",
  "resume_summary": "Guard-test checkpoint — cache-safe TODO 5.",
  "started_at": "${now_ts}",
  "last_touched_at": "${now_ts}"
}
EOF

    # --- session-start.sh fixture 2: pending todos ---
    # Triggers the PENDING TASKS DETECTED block (no count embedded in output).
    mkdir -p "$TEST_HOME/.claude/todos"
    printf '[{"id":"1","status":"pending"},{"id":"2","status":"pending"}]' \
        > "$TEST_HOME/.claude/todos/guard-todos.json"

    # Capture session-start.sh stdout (all three blocks: prometheus + pending +
    # static ledger recording instruction, which fires unconditionally every session)
    local ss_out
    ss_out=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'", "source": "compact"}' \
        | "$SCRIPT_DIR/session-start.sh" 2>/dev/null) || true

    # Sanity: verify all three blocks fired before checking patterns
    if ! printf '%s' "$ss_out" | grep -qF 'PROMETHEUS RESTORED'; then
        echo "ASSERTION FAILED: session-start.sh must emit PROMETHEUS RESTORED block"
        echo "  ss_out: ${ss_out:0:400}"
        return 1
    fi
    if ! printf '%s' "$ss_out" | grep -qF 'PENDING TASKS DETECTED'; then
        echo "ASSERTION FAILED: session-start.sh must emit PENDING TASKS DETECTED block"
        echo "  ss_out: ${ss_out:0:400}"
        return 1
    fi
    # Positive-assertion (plan TODO 3, TODO 9): the static ledger recording
    # instruction fires on every session and must be part of the combined
    # blob checked for cache-safety below -- proves the new emitter, not just
    # the removed handoff pointer, is what this guard actually verifies.
    if ! printf '%s' "$ss_out" | grep -qF 'LEDGER RECORDING'; then
        echo "ASSERTION FAILED: session-start.sh must emit the LEDGER RECORDING instruction (TODO 3)"
        echo "  ss_out: ${ss_out:0:400}"
        return 1
    fi

    # --- resume-forge-start.sh fixture: active resume-forge state ---
    # The restore block emits qualitative phrase ("in progress"), not filename or digit/digit.
    cat > "$TEST_OMT_DIR/state/resume-forge-guard-test.json" << 'EOF'
{
  "session_id": "guard-test",
  "created_at": "2026-06-30T12:00:00",
  "target_count": 3,
  "scenarios": [
    {"id": "c1", "loop1": {"status": "passed"}, "loop2": {"status": "passed"}},
    {"id": "c2", "loop1": {"status": "passed"}, "loop2": {"status": "pending"}},
    {"id": "c3", "loop1": {"status": "pending"}, "loop2": {"status": "pending"}}
  ]
}
EOF

    local rf_out
    rf_out=$(echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "'"$sid"'"}' \
        | "$SCRIPT_DIR/resume-forge-start.sh" 2>/dev/null) || true

    # Sanity: resume-forge restore block fired
    if ! printf '%s' "$rf_out" | grep -qF 'RESUME FORGE SESSION DETECTED'; then
        echo "ASSERTION FAILED: resume-forge-start.sh must emit RESUME FORGE SESSION DETECTED"
        echo "  rf_out: ${rf_out:0:400}"
        return 1
    fi

    # --- skill-catalog macro ---
    # Static output: no session IDs, no abs paths, no digit/digit, no filenames.
    # HOME=TEST_HOME means no user skills dir → deterministic minimal output.
    local sc_out
    sc_out=$(bun run "$REPO_DIR/skills/sisyphus/hooks/skill-catalog/index.ts" 2>/dev/null) || {
        echo "ASSERTION FAILED: skill-catalog invocation failed (bun available?)"
        return 1
    }

    # Combine all three emitters' stdout
    local combined
    combined="${ss_out}${rf_out}${sc_out}"

    # Core assertion: combined stdout must match NONE of the 5 volatile-value patterns
    if ! assert_no_volatile_patterns "$combined" "$sid" ""; then
        echo "ASSERTION FAILED: one or more volatile-value patterns found in combined emitter stdout"
        return 1
    fi

    return 0
}

test_regression_ambient_claude_env_file_not_leaked_by_unscrubbed_call() {
    # Regression guard for the ambient CLAUDE_ENV_FILE leak: this suite's own
    # unscrubbed session-start.sh / resume-forge-start.sh call sites used to
    # inherit whatever CLAUDE_ENV_FILE was ambient in the runner's shell (e.g.
    # a live Claude Code session's real env file) and the hook would
    # unconditionally append export lines to it. setup_test_env() now scrubs
    # CLAUDE_ENV_FILE before every test's body runs; this test re-invokes that
    # real function (not a copy of it) after re-introducing an ambient value,
    # so if the scrub is ever removed from setup_test_env, this goes red.
    local fixture baseline
    fixture=$(mktemp)
    baseline=$(mktemp)
    cp "$fixture" "$baseline"

    export CLAUDE_ENV_FILE="$fixture"
    setup_test_env
    echo '{"cwd": "'"$TEST_TMP_DIR"'", "sessionId": "leak-guard-sid"}' \
        | "$SCRIPT_DIR/session-start.sh" > /dev/null 2>&1 || true
    echo '{"cwd": "'"$TEST_TMP_DIR"'"}' \
        | "$SCRIPT_DIR/resume-forge-start.sh" > /dev/null 2>&1 || true

    local result=0
    if ! cmp -s "$baseline" "$fixture"; then
        echo "ASSERTION FAILED: CLAUDE_ENV_FILE fixture must stay byte-unchanged when ambient -- setup_test_env's scrub regressed"
        echo "  fixture contents: $(cat "$fixture")"
        result=1
    fi

    rm -f "$fixture" "$baseline"
    return $result
}

# =============================================================================
# Main runner
# =============================================================================

main() {
    echo "=========================================="
    echo "Cache-Safe Guard Tests"
    echo "=========================================="

    # RED demonstration first: prove the guard can catch a leak
    run_test test_guard_red_demo_session_id_leak

    # AC12 GREEN: real emitters pass all 5 pattern checks
    run_test test_cache_safe_guard_ac12_green
    run_test test_regression_ambient_claude_env_file_not_leaked_by_unscrubbed_call

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
}

main "$@"

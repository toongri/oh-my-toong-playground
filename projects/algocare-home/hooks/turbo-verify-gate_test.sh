#!/bin/bash
# =============================================================================
# Turbo Verify Gate Hook Tests
# Covers hooks/turbo-verify-gate.sh — a PreToolUse (Bash matcher) hook for the
# algocare-home monorepo that (a) denies unfiltered root `turbo`/`pnpm`
# test|lint invocations (RAM-blowup guard) and (b) best-effort injects
# concurrency/fork caps into already-filtered turbo/vitest/jest commands.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$SCRIPT_DIR/turbo-verify-gate.sh"

TESTS_PASSED=0
TESTS_FAILED=0

# -----------------------------------------------------------------------------
# run_hook_capture <command> [tool_name=Bash] -- pipes a PreToolUse-shaped
# JSON payload into the hook and captures stdout/exit code into globals.
# jq builds the payload (not hand-rolled string concat) so command text
# containing quotes/special chars round-trips safely.
# -----------------------------------------------------------------------------
HOOK_STDOUT=""
HOOK_EXIT=0
run_hook_capture() {
    local command="$1"
    local tool_name="${2:-Bash}"
    HOOK_EXIT=0
    HOOK_STDOUT=$(jq -n --arg c "$command" --arg t "$tool_name" \
        '{tool_name:$t, tool_input:{command:$c}}' | bash "$HOOK") || HOOK_EXIT=$?
}

run_test() {
    local test_name="$1"
    if "$test_name"; then
        echo "[PASS] $test_name"
        ((TESTS_PASSED++)) || true
    else
        echo "[FAIL] $test_name"
        ((TESTS_FAILED++)) || true
    fi
}

# =============================================================================
# Case 1 — `turbo test` (no filter) → deny + reason mentions verify:quick
# =============================================================================
test_turbo_test_bare_denies() {
    run_hook_capture "turbo test"

    [[ "$HOOK_EXIT" -eq 0 ]] \
        || { echo "ASSERTION FAILED: exit should be 0 (deny is communicated via JSON, not exit code) (exit=$HOOK_EXIT)"; return 1; }

    local decision reason
    decision=$(printf '%s' "$HOOK_STDOUT" | jq -r '.hookSpecificOutput.permissionDecision // empty')
    reason=$(printf '%s' "$HOOK_STDOUT" | jq -r '.hookSpecificOutput.permissionDecisionReason // empty')

    [[ "$decision" == "deny" ]] \
        || { echo "ASSERTION FAILED: permissionDecision should be 'deny'. Got stdout: $HOOK_STDOUT"; return 1; }

    printf '%s' "$reason" | grep -q "verify:quick" \
        || { echo "ASSERTION FAILED: reason should mention 'verify:quick'. Got: $reason"; return 1; }
}

# =============================================================================
# Case 2 — `turbo run lint` (no filter) → deny
# =============================================================================
test_turbo_run_lint_bare_denies() {
    run_hook_capture "turbo run lint"

    [[ "$HOOK_EXIT" -eq 0 ]] \
        || { echo "ASSERTION FAILED: exit should be 0 (exit=$HOOK_EXIT)"; return 1; }

    local decision
    decision=$(printf '%s' "$HOOK_STDOUT" | jq -r '.hookSpecificOutput.permissionDecision // empty')
    [[ "$decision" == "deny" ]] \
        || { echo "ASSERTION FAILED: permissionDecision should be 'deny'. Got stdout: $HOOK_STDOUT"; return 1; }
}

# =============================================================================
# Case 3 — `pnpm test` (no filter) → deny
# =============================================================================
test_pnpm_test_bare_denies() {
    run_hook_capture "pnpm test"

    [[ "$HOOK_EXIT" -eq 0 ]] \
        || { echo "ASSERTION FAILED: exit should be 0 (exit=$HOOK_EXIT)"; return 1; }

    local decision
    decision=$(printf '%s' "$HOOK_STDOUT" | jq -r '.hookSpecificOutput.permissionDecision // empty')
    [[ "$decision" == "deny" ]] \
        || { echo "ASSERTION FAILED: permissionDecision should be 'deny'. Got stdout: $HOOK_STDOUT"; return 1; }
}

# =============================================================================
# Case 4 — `pnpm lint` (no filter) → deny
# =============================================================================
test_pnpm_lint_bare_denies() {
    run_hook_capture "pnpm lint"

    [[ "$HOOK_EXIT" -eq 0 ]] \
        || { echo "ASSERTION FAILED: exit should be 0 (exit=$HOOK_EXIT)"; return 1; }

    local decision
    decision=$(printf '%s' "$HOOK_STDOUT" | jq -r '.hookSpecificOutput.permissionDecision // empty')
    [[ "$decision" == "deny" ]] \
        || { echo "ASSERTION FAILED: permissionDecision should be 'deny'. Got stdout: $HOOK_STDOUT"; return 1; }
}

# =============================================================================
# Case 5 — filtered turbo run without --concurrency → allow + injected
# --concurrency=1
# =============================================================================
test_turbo_affected_injects_concurrency() {
    run_hook_capture "turbo run lint:check typecheck test:changed --affected"

    [[ "$HOOK_EXIT" -eq 0 ]] \
        || { echo "ASSERTION FAILED: exit should be 0 (exit=$HOOK_EXIT)"; return 1; }

    local decision updated_cmd
    decision=$(printf '%s' "$HOOK_STDOUT" | jq -r '.hookSpecificOutput.permissionDecision // empty')
    updated_cmd=$(printf '%s' "$HOOK_STDOUT" | jq -r '.hookSpecificOutput.updatedInput.command // empty')

    [[ "$decision" == "allow" ]] \
        || { echo "ASSERTION FAILED: permissionDecision should be 'allow'. Got stdout: $HOOK_STDOUT"; return 1; }

    printf '%s' "$updated_cmd" | grep -q -- "--concurrency=1" \
        || { echo "ASSERTION FAILED: updatedInput.command should contain --concurrency=1. Got: $updated_cmd"; return 1; }
}

# =============================================================================
# Case 6 — filtered turbo run that already has --concurrency → passthrough
# (no double injection)
# =============================================================================
test_turbo_existing_concurrency_passthrough() {
    run_hook_capture "turbo run test --affected --concurrency=1"

    [[ "$HOOK_EXIT" -eq 0 ]] \
        || { echo "ASSERTION FAILED: exit should be 0 (exit=$HOOK_EXIT)"; return 1; }

    [[ -z "$HOOK_STDOUT" ]] \
        || { echo "ASSERTION FAILED: expected no output (passthrough), got: $HOOK_STDOUT"; return 1; }
}

# =============================================================================
# Case 7 — vitest without --maxForks/--pool → allow + injected --maxForks=2
# =============================================================================
test_vitest_injects_maxforks() {
    run_hook_capture "vitest run --changed origin/main"

    [[ "$HOOK_EXIT" -eq 0 ]] \
        || { echo "ASSERTION FAILED: exit should be 0 (exit=$HOOK_EXIT)"; return 1; }

    local decision updated_cmd
    decision=$(printf '%s' "$HOOK_STDOUT" | jq -r '.hookSpecificOutput.permissionDecision // empty')
    updated_cmd=$(printf '%s' "$HOOK_STDOUT" | jq -r '.hookSpecificOutput.updatedInput.command // empty')

    [[ "$decision" == "allow" ]] \
        || { echo "ASSERTION FAILED: permissionDecision should be 'allow'. Got stdout: $HOOK_STDOUT"; return 1; }

    printf '%s' "$updated_cmd" | grep -q -- "--maxForks=2" \
        || { echo "ASSERTION FAILED: updatedInput.command should contain --maxForks=2. Got: $updated_cmd"; return 1; }
}

# =============================================================================
# Case 8 — jest without --maxWorkers → allow + injected --maxWorkers=2
# =============================================================================
test_jest_injects_maxworkers() {
    run_hook_capture "jest --changedSince=origin/main"

    [[ "$HOOK_EXIT" -eq 0 ]] \
        || { echo "ASSERTION FAILED: exit should be 0 (exit=$HOOK_EXIT)"; return 1; }

    local decision updated_cmd
    decision=$(printf '%s' "$HOOK_STDOUT" | jq -r '.hookSpecificOutput.permissionDecision // empty')
    updated_cmd=$(printf '%s' "$HOOK_STDOUT" | jq -r '.hookSpecificOutput.updatedInput.command // empty')

    [[ "$decision" == "allow" ]] \
        || { echo "ASSERTION FAILED: permissionDecision should be 'allow'. Got stdout: $HOOK_STDOUT"; return 1; }

    printf '%s' "$updated_cmd" | grep -q -- "--maxWorkers=2" \
        || { echo "ASSERTION FAILED: updatedInput.command should contain --maxWorkers=2. Got: $updated_cmd"; return 1; }
}

# =============================================================================
# Case 9 — `pnpm verify:quick` → passthrough (distinct script name, not bare
# test/lint)
# =============================================================================
test_pnpm_verify_quick_passthrough() {
    run_hook_capture "pnpm verify:quick"

    [[ "$HOOK_EXIT" -eq 0 ]] \
        || { echo "ASSERTION FAILED: exit should be 0 (exit=$HOOK_EXIT)"; return 1; }

    [[ -z "$HOOK_STDOUT" ]] \
        || { echo "ASSERTION FAILED: expected no output (passthrough), got: $HOOK_STDOUT"; return 1; }
}

# =============================================================================
# Case 10 — `pnpm --filter @algocare/backend test:changed` → passthrough
# (filtered + non-bare script name)
# =============================================================================
test_pnpm_filtered_test_changed_passthrough() {
    run_hook_capture "pnpm --filter @algocare/backend test:changed"

    [[ "$HOOK_EXIT" -eq 0 ]] \
        || { echo "ASSERTION FAILED: exit should be 0 (exit=$HOOK_EXIT)"; return 1; }

    [[ -z "$HOOK_STDOUT" ]] \
        || { echo "ASSERTION FAILED: expected no output (passthrough), got: $HOOK_STDOUT"; return 1; }
}

# =============================================================================
# Case 11 — `pnpm test:changed` → passthrough (distinct script name, not bare
# test)
# =============================================================================
test_pnpm_test_changed_passthrough() {
    run_hook_capture "pnpm test:changed"

    [[ "$HOOK_EXIT" -eq 0 ]] \
        || { echo "ASSERTION FAILED: exit should be 0 (exit=$HOOK_EXIT)"; return 1; }

    [[ -z "$HOOK_STDOUT" ]] \
        || { echo "ASSERTION FAILED: expected no output (passthrough), got: $HOOK_STDOUT"; return 1; }
}

# =============================================================================
# Case 12 — unrelated Bash command → passthrough
# =============================================================================
test_unrelated_command_passthrough() {
    run_hook_capture "ls -la"

    [[ "$HOOK_EXIT" -eq 0 ]] \
        || { echo "ASSERTION FAILED: exit should be 0 (exit=$HOOK_EXIT)"; return 1; }

    [[ -z "$HOOK_STDOUT" ]] \
        || { echo "ASSERTION FAILED: expected no output (passthrough), got: $HOOK_STDOUT"; return 1; }
}

# =============================================================================
# Case 13 [F1] — `grep -rn jest src/` → passthrough (bareword "jest" is not
# the invoked program, must not get --maxWorkers appended)
# =============================================================================
test_grep_jest_passthrough() {
    run_hook_capture "grep -rn jest src/"

    [[ "$HOOK_EXIT" -eq 0 ]] \
        || { echo "ASSERTION FAILED: exit should be 0 (exit=$HOOK_EXIT)"; return 1; }

    [[ -z "$HOOK_STDOUT" ]] \
        || { echo "ASSERTION FAILED: expected no output (passthrough), got: $HOOK_STDOUT"; return 1; }
}

# =============================================================================
# Case 14 [F1] — `grep -rn vitest .` → passthrough (bareword "vitest" is not
# the invoked program, must not get --maxForks appended)
# =============================================================================
test_grep_vitest_passthrough() {
    run_hook_capture "grep -rn vitest ."

    [[ "$HOOK_EXIT" -eq 0 ]] \
        || { echo "ASSERTION FAILED: exit should be 0 (exit=$HOOK_EXIT)"; return 1; }

    [[ -z "$HOOK_STDOUT" ]] \
        || { echo "ASSERTION FAILED: expected no output (passthrough), got: $HOOK_STDOUT"; return 1; }
}

# =============================================================================
# Case 15 [F2] — `vitest run --changed origin/main && pnpm build` → passthrough
# (compound command; injecting would tail-append onto the wrong side)
# =============================================================================
test_vitest_compound_and_passthrough() {
    run_hook_capture "vitest run --changed origin/main && pnpm build"

    [[ "$HOOK_EXIT" -eq 0 ]] \
        || { echo "ASSERTION FAILED: exit should be 0 (exit=$HOOK_EXIT)"; return 1; }

    [[ -z "$HOOK_STDOUT" ]] \
        || { echo "ASSERTION FAILED: expected no output (passthrough), got: $HOOK_STDOUT"; return 1; }
}

# =============================================================================
# Case 16 [F2] — `vitest run 2>&1 | tee out.log` → passthrough (pipe; flag
# must not land on `tee`)
# =============================================================================
test_vitest_pipe_passthrough() {
    run_hook_capture "vitest run 2>&1 | tee out.log"

    [[ "$HOOK_EXIT" -eq 0 ]] \
        || { echo "ASSERTION FAILED: exit should be 0 (exit=$HOOK_EXIT)"; return 1; }

    [[ -z "$HOOK_STDOUT" ]] \
        || { echo "ASSERTION FAILED: expected no output (passthrough), got: $HOOK_STDOUT"; return 1; }
}

# =============================================================================
# Case 17 [F2] — `jest --changedSince=origin/main || true` → passthrough
# (compound `||`; flag must not land on `true`)
# =============================================================================
test_jest_or_passthrough() {
    run_hook_capture "jest --changedSince=origin/main || true"

    [[ "$HOOK_EXIT" -eq 0 ]] \
        || { echo "ASSERTION FAILED: exit should be 0 (exit=$HOOK_EXIT)"; return 1; }

    [[ -z "$HOOK_STDOUT" ]] \
        || { echo "ASSERTION FAILED: expected no output (passthrough), got: $HOOK_STDOUT"; return 1; }
}

# =============================================================================
# Case 18 [F3] — `NODE_OPTIONS=--max-old-space-size=8192 turbo test` → deny
# (leading env-var assignment must not defeat the unfiltered-root guard)
# =============================================================================
test_env_prefixed_turbo_test_denies() {
    run_hook_capture "NODE_OPTIONS=--max-old-space-size=8192 turbo test"

    [[ "$HOOK_EXIT" -eq 0 ]] \
        || { echo "ASSERTION FAILED: exit should be 0 (exit=$HOOK_EXIT)"; return 1; }

    local decision
    decision=$(printf '%s' "$HOOK_STDOUT" | jq -r '.hookSpecificOutput.permissionDecision // empty')
    [[ "$decision" == "deny" ]] \
        || { echo "ASSERTION FAILED: permissionDecision should be 'deny'. Got stdout: $HOOK_STDOUT"; return 1; }
}

# =============================================================================
# Case 19 [F3] — `cd apps/backend && turbo test` → deny (leading `cd &&`
# segment must not defeat the unfiltered-root guard)
# =============================================================================
test_cd_prefixed_turbo_test_denies() {
    run_hook_capture "cd apps/backend && turbo test"

    [[ "$HOOK_EXIT" -eq 0 ]] \
        || { echo "ASSERTION FAILED: exit should be 0 (exit=$HOOK_EXIT)"; return 1; }

    local decision
    decision=$(printf '%s' "$HOOK_STDOUT" | jq -r '.hookSpecificOutput.permissionDecision // empty')
    [[ "$decision" == "deny" ]] \
        || { echo "ASSERTION FAILED: permissionDecision should be 'deny'. Got stdout: $HOOK_STDOUT"; return 1; }
}

# =============================================================================
# Case 20 [F3] — `CI=1 pnpm test` → deny (leading env-var assignment must not
# defeat the unfiltered-root guard)
# =============================================================================
test_env_prefixed_pnpm_test_denies() {
    run_hook_capture "CI=1 pnpm test"

    [[ "$HOOK_EXIT" -eq 0 ]] \
        || { echo "ASSERTION FAILED: exit should be 0 (exit=$HOOK_EXIT)"; return 1; }

    local decision
    decision=$(printf '%s' "$HOOK_STDOUT" | jq -r '.hookSpecificOutput.permissionDecision // empty')
    [[ "$decision" == "deny" ]] \
        || { echo "ASSERTION FAILED: permissionDecision should be 'deny'. Got stdout: $HOOK_STDOUT"; return 1; }
}

# =============================================================================
# Case 21 — `vitest run > out.log` → passthrough (redirect; must not be
# treated as a single simple command safe to tail-append onto)
# =============================================================================
test_vitest_redirect_passthrough() {
    run_hook_capture "vitest run > out.log"

    [[ "$HOOK_EXIT" -eq 0 ]] \
        || { echo "ASSERTION FAILED: exit should be 0 (exit=$HOOK_EXIT)"; return 1; }

    [[ -z "$HOOK_STDOUT" ]] \
        || { echo "ASSERTION FAILED: expected no output (passthrough), got: $HOOK_STDOUT"; return 1; }
}

# =============================================================================
# Case 22 — `CI=1 vitest run --changed origin/main` → allow + injected
# --maxForks=2, appended after the env-prefixed original command
# =============================================================================
test_env_prefixed_vitest_injects_maxforks() {
    run_hook_capture "CI=1 vitest run --changed origin/main"

    [[ "$HOOK_EXIT" -eq 0 ]] \
        || { echo "ASSERTION FAILED: exit should be 0 (exit=$HOOK_EXIT)"; return 1; }

    local decision updated_cmd
    decision=$(printf '%s' "$HOOK_STDOUT" | jq -r '.hookSpecificOutput.permissionDecision // empty')
    updated_cmd=$(printf '%s' "$HOOK_STDOUT" | jq -r '.hookSpecificOutput.updatedInput.command // empty')

    [[ "$decision" == "allow" ]] \
        || { echo "ASSERTION FAILED: permissionDecision should be 'allow'. Got stdout: $HOOK_STDOUT"; return 1; }

    [[ "$updated_cmd" == "CI=1 vitest run --changed origin/main --maxForks=2" ]] \
        || { echo "ASSERTION FAILED: updatedInput.command should be exactly 'CI=1 vitest run --changed origin/main --maxForks=2'. Got: $updated_cmd"; return 1; }
}

# =============================================================================
# Case 23 — `NODE_OPTIONS=--stack-size=2000 turbo run test:changed --affected`
# → allow + injected --concurrency=1, appended after the env-prefixed
# original command
# =============================================================================
test_env_prefixed_turbo_injects_concurrency() {
    run_hook_capture "NODE_OPTIONS=--stack-size=2000 turbo run test:changed --affected"

    [[ "$HOOK_EXIT" -eq 0 ]] \
        || { echo "ASSERTION FAILED: exit should be 0 (exit=$HOOK_EXIT)"; return 1; }

    local decision updated_cmd
    decision=$(printf '%s' "$HOOK_STDOUT" | jq -r '.hookSpecificOutput.permissionDecision // empty')
    updated_cmd=$(printf '%s' "$HOOK_STDOUT" | jq -r '.hookSpecificOutput.updatedInput.command // empty')

    [[ "$decision" == "allow" ]] \
        || { echo "ASSERTION FAILED: permissionDecision should be 'allow'. Got stdout: $HOOK_STDOUT"; return 1; }

    printf '%s' "$updated_cmd" | grep -q -- "--concurrency=1$" \
        || { echo "ASSERTION FAILED: updatedInput.command should end with --concurrency=1. Got: $updated_cmd"; return 1; }
}

# =============================================================================
# Case 24 — `turbo run test --filter=@algocare/backend` → allow + injected
# --concurrency=1 (single simple command, --filter present — regression
# guard for the still-valid filtered-turbo injection path)
# =============================================================================
test_turbo_filter_injects_concurrency() {
    run_hook_capture "turbo run test --filter=@algocare/backend"

    [[ "$HOOK_EXIT" -eq 0 ]] \
        || { echo "ASSERTION FAILED: exit should be 0 (exit=$HOOK_EXIT)"; return 1; }

    local decision updated_cmd
    decision=$(printf '%s' "$HOOK_STDOUT" | jq -r '.hookSpecificOutput.permissionDecision // empty')
    updated_cmd=$(printf '%s' "$HOOK_STDOUT" | jq -r '.hookSpecificOutput.updatedInput.command // empty')

    [[ "$decision" == "allow" ]] \
        || { echo "ASSERTION FAILED: permissionDecision should be 'allow'. Got stdout: $HOOK_STDOUT"; return 1; }

    printf '%s' "$updated_cmd" | grep -q -- "--concurrency=1$" \
        || { echo "ASSERTION FAILED: updatedInput.command should end with --concurrency=1. Got: $updated_cmd"; return 1; }
}

# =============================================================================
# Main
# =============================================================================
main() {
    echo "=========================================="
    echo "Turbo Verify Gate Tests"
    echo "=========================================="

    run_test test_turbo_test_bare_denies
    run_test test_turbo_run_lint_bare_denies
    run_test test_pnpm_test_bare_denies
    run_test test_pnpm_lint_bare_denies
    run_test test_turbo_affected_injects_concurrency
    run_test test_turbo_existing_concurrency_passthrough
    run_test test_vitest_injects_maxforks
    run_test test_jest_injects_maxworkers
    run_test test_pnpm_verify_quick_passthrough
    run_test test_pnpm_filtered_test_changed_passthrough
    run_test test_pnpm_test_changed_passthrough
    run_test test_unrelated_command_passthrough
    run_test test_grep_jest_passthrough
    run_test test_grep_vitest_passthrough
    run_test test_vitest_compound_and_passthrough
    run_test test_vitest_pipe_passthrough
    run_test test_jest_or_passthrough
    run_test test_env_prefixed_turbo_test_denies
    run_test test_cd_prefixed_turbo_test_denies
    run_test test_env_prefixed_pnpm_test_denies
    run_test test_vitest_redirect_passthrough
    run_test test_env_prefixed_vitest_injects_maxforks
    run_test test_env_prefixed_turbo_injects_concurrency
    run_test test_turbo_filter_injects_concurrency

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
}

main "$@"

#!/bin/bash
# Tests for the Claude review execution gate. Each invocation uses an isolated
# OMT_DIR so no ambient review job or session identity can influence the result.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$SCRIPT_DIR/review-exec-guard.sh"
TESTS_PASSED=0
TESTS_FAILED=0

run_test() {
    local name="$1"
    shift
    # Single-argument form: the name IS the test function. Without this, `shift`
    # leaves "$@" empty and `if "$@"` runs the empty command, which succeeds --
    # reporting PASS for a test that never executed.
    [ "$#" -gt 0 ] || set -- "$name"
    if "$@"; then
        echo "[PASS] $name"
        ((TESTS_PASSED++)) || true
    else
        echo "[FAIL] $name"
        ((TESTS_FAILED++)) || true
    fi
}

new_sandbox() {
    SBX=$(mktemp -d)
    JOBS="$SBX/omt/jobs"
    mkdir -p "$JOBS"
}

cleanup_sandbox() {
    rm -rf "$SBX"
}

# Fake `bun` stub + fake job.ts deployment tree, so the active-gating tests
# never touch the real job.ts/bun. install_fake_bun writes a `bun` script
# ahead of PATH that intercepts `active-members` and answers with a fixed
# activity, logging every invocation to $SBX/bun-calls.log so tests can
# assert it was (or wasn't) called. install_fake_job_cli lays out a fake
# job.ts at the given deployed-tree location so review_exec_job_cli resolves
# it; when omitted, path resolution deliberately fails (job.ts missing).
install_fake_bun() {
    local activity="$1" exit_code="${2:-0}"
    mkdir -p "$SBX/bin"
    cat > "$SBX/bin/bun" <<EOF
#!/bin/bash
echo "\$*" >> "$SBX/bun-calls.log"
if [ "$exit_code" -ne 0 ]; then
    echo "fake bun: forced failure" >&2
    exit $exit_code
fi
echo '{"activity":"$activity","jobs":[]}'
EOF
    chmod +x "$SBX/bin/bun"
}

bun_was_called() {
    [ -f "$SBX/bun-calls.log" ]
}

# Places job.json for `conductor` under a fresh chunk-review job. The real
# job.ts already exists in this repo's own skills/code-review/scripts/, so
# review_exec_job_cli resolves it via candidate 1 without any faking here —
# only the fake `bun` on PATH determines the activity answer.
new_matching_job() {
    mkdir -p "$JOBS/chunk-review-one"
    printf '%s\n' '{"conductorSessionId":"conductor"}' > "$JOBS/chunk-review-one/job.json"
}

run_hook_with_path() {
    local command="$1" sid="${2:-reviewer}"
    payload "$command" "$sid" | env -u CODEX_THREAD_ID OMT_DIR="$SBX/omt" OMT_SESSION_ID="$sid" PATH="$SBX/bin:$PATH" bash "$HOOK"
}

assert_indeterminate_reason() {
    local out="$1" label="$2"
    if ! printf '%s' "$out" | grep -qi 'could not be determined'; then
        echo "ASSERTION FAILED $label: expected indeterminate reason, got '$out'"
        return 1
    fi
}

payload() {
    local command="$1" sid="${2:-reviewer}"
    jq -n --arg command "$command" --arg sid "$sid" \
        '{tool_name:"Bash",tool_input:{command:$command},session_id:$sid,cwd:"/safe/project"}'
}

run_hook() {
    local command="$1" sid="${2:-reviewer}"
    payload "$command" "$sid" | env -u CODEX_THREAD_ID OMT_DIR="$SBX/omt" OMT_SESSION_ID="$sid" bash "$HOOK"
}

assert_denied() {
    local out="$1" label="$2"
    if ! printf '%s' "$out" | grep -q '"continue":false'; then
        echo "ASSERTION FAILED $label: expected Claude command denial, got '$out'"
        return 1
    fi
    if ! printf '%s' "$out" | grep -Eqi 'static-only|static inspection'; then
        echo "ASSERTION FAILED $label: denial must direct static inspection, got '$out'"
        return 1
    fi
}

assert_allowed() {
    local out="$1" rc="$2" label="$3"
    if [ "$rc" -ne 0 ] || [ -n "$out" ]; then
        echo "ASSERTION FAILED $label: expected fail-open allow, rc=$rc output='$out'"
        return 1
    fi
}

test_member_denies_representative_high_cost_commands() {
    new_sandbox
    local command out result=0
    for command in 'pnpm test' 'npm run build' 'yarn install' 'bun run lint' 'pytest' 'vitest run' 'tsc --noEmit'; do
        out=$(payload "$command" | env -u OMT_SESSION_ID -u CODEX_THREAD_ID OMT_DIR="$SBX/omt" OMT_REVIEW_ROLE=member bash "$HOOK")
        assert_denied "$out" "member-$command" || result=1
    done
    cleanup_sandbox
    return "$result"
}

# The default finder path: a Claude conductor spawns Codex finders, so the
# worker carries the conductor's inherited OMT_SESSION_ID while the nested Codex
# session supplies its own CODEX_THREAD_ID. Those two identities disagree by
# construction, and the role marker must still arm the guard.
test_member_denies_despite_identity_disagreement() {
    new_sandbox
    local command out result=0
    for command in 'pnpm test' 'gradle test'; do
        out=$(payload "$command" codex_thread | env OMT_DIR="$SBX/omt" OMT_SESSION_ID=claude_conductor CODEX_THREAD_ID=codex_thread OMT_REVIEW_ROLE=member bash "$HOOK")
        assert_denied "$out" "member-identity-disagreement-$command" || result=1
    done
    cleanup_sandbox
    return "$result"
}

test_package_runner_targets_denied() {
    new_sandbox
    local command out rc result=0
    for command in 'npx jest' 'npx --yes vitest' 'npx -p typescript tsc' 'pnpm exec vitest' 'npm exec eslint .' 'yarn dlx eslint .' 'pnpm dlx vitest' 'bun x vitest' 'bunx jest' "sh -c 'npx jest'" 'git diff && pnpm exec vitest'; do
        out=$(payload "$command" | env -u OMT_SESSION_ID -u CODEX_THREAD_ID OMT_DIR="$SBX/omt" OMT_REVIEW_ROLE=member bash "$HOOK")
        assert_denied "$out" "runner-deny-$command" || result=1
    done
    for command in 'npx' 'pnpm exec prettier --write .' 'rg "npx jest"'; do
        rc=0; out=$(payload "$command" | env -u OMT_SESSION_ID -u CODEX_THREAD_ID OMT_DIR="$SBX/omt" OMT_REVIEW_ROLE=member bash "$HOOK") || rc=$?
        assert_allowed "$out" "$rc" "runner-allow-$command" || result=1
    done
    cleanup_sandbox
    return "$result"
}

test_interpreter_module_and_python_runner_targets_denied() {
    new_sandbox
    local command out rc result=0
    for command in 'python -m pytest' 'python3 -m pytest' 'python3.12 -m pytest' 'python -m unittest' 'python -m unittest discover' 'python -m mypy .' 'python -m ruff check' 'mypy .' 'uv run pytest' 'poetry run pytest' 'pipenv run pytest' 'uv run -q pytest' 'git diff && python -m pytest'; do
        out=$(payload "$command" | env -u OMT_SESSION_ID -u CODEX_THREAD_ID OMT_DIR="$SBX/omt" OMT_REVIEW_ROLE=member bash "$HOOK")
        assert_denied "$out" "interp-deny-$command" || result=1
    done
    for command in 'python script.py' 'python --version' 'python -m http.server' 'python -m json.tool' 'uv run manage.py migrate' 'rg "python -m pytest"'; do
        rc=0; out=$(payload "$command" | env -u OMT_SESSION_ID -u CODEX_THREAD_ID OMT_DIR="$SBX/omt" OMT_REVIEW_ROLE=member bash "$HOOK") || rc=$?
        assert_allowed "$out" "$rc" "interp-allow-$command" || result=1
    done
    cleanup_sandbox
    return "$result"
}

test_member_denies_without_job_scan() {
    new_sandbox
    new_matching_job
    install_fake_bun active
    local out result=0
    out=$(payload 'pnpm test' conductor | env -u OMT_SESSION_ID -u CODEX_THREAD_ID OMT_DIR="$SBX/omt" OMT_REVIEW_ROLE=member PATH="$SBX/bin:$PATH" bash "$HOOK")
    assert_denied "$out" member-skips-job-scan || result=1
    if bun_was_called; then
        echo "ASSERTION FAILED member-skips-job-scan: fake bun should not be called for a member"
        result=1
    fi
    cleanup_sandbox
    return "$result"
}

test_matching_conductor_active_denies() {
    new_sandbox
    new_matching_job
    install_fake_bun active
    local out result=0
    out=$(run_hook_with_path 'pnpm test' conductor)
    assert_denied "$out" conductor-active || result=1
    if printf '%s' "$out" | grep -qi 'could not be determined'; then
        echo "ASSERTION FAILED conductor-active: expected the active reason, got indeterminate wording"
        result=1
    fi
    bun_was_called || { echo "ASSERTION FAILED conductor-active: expected fake bun to be called"; result=1; }
    cleanup_sandbox
    return "$result"
}

# 5050fa3f fixed a stale-job bug: a conductor must not stay gated once every
# member of its matching job has finished. This is the regression that fix
# guards against — keep it passing.
test_matching_conductor_all_members_done_allows() {
    new_sandbox
    new_matching_job
    install_fake_bun inactive
    local out rc=0 result=0
    out=$(run_hook_with_path 'pnpm test' conductor) || rc=$?
    assert_allowed "$out" "$rc" conductor-inactive-allows || result=1
    bun_was_called || { echo "ASSERTION FAILED conductor-inactive-allows: expected fake bun to be called"; result=1; }
    cleanup_sandbox
    return "$result"
}

test_matching_conductor_malformed_status_denies_indeterminate() {
    new_sandbox
    new_matching_job
    install_fake_bun indeterminate
    local out result=0
    out=$(run_hook_with_path 'pnpm test' conductor)
    assert_denied "$out" conductor-malformed || result=1
    assert_indeterminate_reason "$out" conductor-malformed || result=1
    cleanup_sandbox
    return "$result"
}

test_matching_conductor_bun_failure_denies_indeterminate() {
    new_sandbox
    new_matching_job
    install_fake_bun active 1
    local out result=0
    out=$(run_hook_with_path 'pnpm test' conductor)
    assert_denied "$out" conductor-bun-failure || result=1
    assert_indeterminate_reason "$out" conductor-bun-failure || result=1
    cleanup_sandbox
    return "$result"
}

test_active_and_indeterminate_reasons_differ() {
    local active_out indeterminate_out result=0

    new_sandbox
    new_matching_job
    install_fake_bun active
    active_out=$(run_hook_with_path 'pnpm test' conductor)
    cleanup_sandbox

    new_sandbox
    new_matching_job
    install_fake_bun indeterminate
    indeterminate_out=$(run_hook_with_path 'pnpm test' conductor)
    cleanup_sandbox

    if [ "$active_out" = "$indeterminate_out" ]; then
        echo "ASSERTION FAILED reason-mismatch: active and indeterminate denials must differ"
        result=1
    fi
    return "$result"
}

test_matching_conductor_missing_job_cli_denies_indeterminate_without_bun() {
    local tmp deploy_hooks out result=0
    tmp=$(mktemp -d)
    deploy_hooks="$tmp/.claude/hooks"
    mkdir -p "$deploy_hooks/lib" "$tmp/.claude/omt/jobs/chunk-review-one" "$tmp/bin"
    cp "$SCRIPT_DIR/review-exec-guard.sh" "$deploy_hooks/review-exec-guard.sh"
    cp "$SCRIPT_DIR/lib/review-exec-patterns.sh" "$deploy_hooks/lib/review-exec-patterns.sh"
    cp "$SCRIPT_DIR/lib/omt-dir.sh" "$deploy_hooks/lib/omt-dir.sh"
    printf '%s\n' '{"conductorSessionId":"conductor"}' > "$tmp/.claude/omt/jobs/chunk-review-one/job.json"
    # Deliberately no skills/code-review/scripts/job.ts anywhere reachable from
    # this deploy tree, so both candidate paths miss and resolution fails.
    cat > "$tmp/bin/bun" <<EOF
#!/bin/bash
echo "\$*" >> "$tmp/bun-calls.log"
echo '{"activity":"active","jobs":[]}'
EOF
    chmod +x "$tmp/bin/bun"

    out=$(payload 'pnpm test' conductor | env -u CODEX_THREAD_ID OMT_DIR="$tmp/.claude/omt" OMT_SESSION_ID=conductor PATH="$tmp/bin:$PATH" bash "$deploy_hooks/review-exec-guard.sh")
    assert_denied "$out" job-cli-missing || result=1
    assert_indeterminate_reason "$out" job-cli-missing || result=1
    if [ -f "$tmp/bun-calls.log" ]; then
        echo "ASSERTION FAILED job-cli-missing: fake bun should not be called when job.ts cannot be resolved"
        result=1
    fi
    rm -rf "$tmp"
    return "$result"
}

# Path resolution: a Claude deploy puts this shared lib at .claude/hooks/lib/,
# so candidate 1 (hooks_dir/../skills/code-review/scripts/job.ts) must resolve
# to .claude/skills/code-review/scripts/job.ts.
test_path_resolution_claude_deploy_finds_candidate_one() {
    local tmp deploy_hooks out result=0
    tmp=$(mktemp -d)
    deploy_hooks="$tmp/.claude/hooks"
    mkdir -p "$deploy_hooks/lib" "$tmp/.claude/skills/code-review/scripts" "$tmp/.claude/omt/jobs/chunk-review-one" "$tmp/bin"
    cp "$SCRIPT_DIR/review-exec-guard.sh" "$deploy_hooks/review-exec-guard.sh"
    cp "$SCRIPT_DIR/lib/review-exec-patterns.sh" "$deploy_hooks/lib/review-exec-patterns.sh"
    cp "$SCRIPT_DIR/lib/omt-dir.sh" "$deploy_hooks/lib/omt-dir.sh"
    touch "$tmp/.claude/skills/code-review/scripts/job.ts"
    printf '%s\n' '{"conductorSessionId":"conductor"}' > "$tmp/.claude/omt/jobs/chunk-review-one/job.json"
    cat > "$tmp/bin/bun" <<EOF
#!/bin/bash
echo "\$*" >> "$tmp/bun-calls.log"
echo '{"activity":"active","jobs":[]}'
EOF
    chmod +x "$tmp/bin/bun"

    out=$(payload 'pnpm test' conductor | env -u CODEX_THREAD_ID OMT_DIR="$tmp/.claude/omt" OMT_SESSION_ID=conductor PATH="$tmp/bin:$PATH" bash "$deploy_hooks/review-exec-guard.sh")
    assert_denied "$out" path-candidate-one || result=1
    if [ ! -f "$tmp/bun-calls.log" ]; then
        echo "ASSERTION FAILED path-candidate-one: expected fake bun to be called"
        result=1
    elif ! grep -q "code-review/scripts/job.ts" "$tmp/bun-calls.log"; then
        echo "ASSERTION FAILED path-candidate-one: bun was not invoked with the candidate-1 job.ts path"
        result=1
    fi
    rm -rf "$tmp"
    return "$result"
}

test_other_session_job_allows() {
    new_sandbox
    new_matching_job
    install_fake_bun active
    local out rc=0 result=0
    out=$(run_hook_with_path 'pnpm test' another) || rc=$?
    assert_allowed "$out" "$rc" other-session-allows || result=1
    if bun_was_called; then
        echo "ASSERTION FAILED other-session-allows: fake bun should not be called when no job matches this session"
        result=1
    fi
    cleanup_sandbox
    return "$result"
}

test_no_matching_job_allows() {
    new_sandbox
    install_fake_bun active
    local out rc=0 result=0
    out=$(run_hook_with_path 'pnpm test' conductor) || rc=$?
    assert_allowed "$out" "$rc" no-matching-job-allows || result=1
    if bun_was_called; then
        echo "ASSERTION FAILED no-matching-job-allows: fake bun should not be called when there is no matching job"
        result=1
    fi
    cleanup_sandbox
    return "$result"
}

test_non_member_unsafe_session_id_allows() {
    new_sandbox
    new_matching_job
    install_fake_bun active
    local out rc=0 result=0
    out=$(payload 'pnpm test' 'unsafe/session' | env -u CODEX_THREAD_ID OMT_DIR="$SBX/omt" OMT_SESSION_ID='unsafe/session' PATH="$SBX/bin:$PATH" bash "$HOOK") || rc=$?
    assert_allowed "$out" "$rc" unsafe-session-id-allows || result=1
    if bun_was_called; then
        echo "ASSERTION FAILED unsafe-session-id-allows: fake bun should not be called when identity is unsafe"
        result=1
    fi
    cleanup_sandbox
    return "$result"
}

test_harmless_command_with_active_job_allows_without_bun_call() {
    new_sandbox
    new_matching_job
    install_fake_bun active
    local out rc=0 result=0
    out=$(run_hook_with_path 'git diff' conductor) || rc=$?
    assert_allowed "$out" "$rc" harmless-command-allows || result=1
    if bun_was_called; then
        echo "ASSERTION FAILED harmless-command-allows: fake bun should not be called for a non-high-cost command"
        result=1
    fi
    cleanup_sandbox
    return "$result"
}

test_no_marker_and_no_jq_fail_open() {
    new_sandbox
    local out rc=0 result=0
    out=$(run_hook 'pnpm test') || rc=$?
    assert_allowed "$out" "$rc" no-marker || result=1
    mkdir -p "$SBX/no-bin"
    ln -s /usr/bin/dirname "$SBX/no-bin/dirname"
    rc=0; out=$(payload 'pnpm test' | env -u OMT_SESSION_ID -u CODEX_THREAD_ID OMT_DIR="$SBX/omt" OMT_REVIEW_ROLE=member PATH="$SBX/no-bin" /bin/bash "$HOOK") || rc=$?
    assert_allowed "$out" "$rc" jq-unavailable || result=1
    cleanup_sandbox
    return "$result"
}

test_static_and_orchestration_commands_allow() {
    new_sandbox
    local command out rc result=0
    for command in 'git diff' 'rg conductorSessionId hooks' 'grep -R review hooks' 'cat hooks/lib/omt-dir.sh' 'bun skills/code-review/job.ts collect'; do
        rc=0; out=$(payload "$command" | env -u OMT_SESSION_ID -u CODEX_THREAD_ID OMT_DIR="$SBX/omt" OMT_REVIEW_ROLE=member bash "$HOOK") || rc=$?
        assert_allowed "$out" "$rc" "allowed-$command" || result=1
    done
    cleanup_sandbox
    return "$result"
}

test_chained_and_quoted_runners_cannot_bypass() {
    new_sandbox
    local command out result=0
    for command in 'git diff && pnpm test' 'echo inspect; npm run lint' "'pnpm' test" '"yarn" build'; do
        out=$(payload "$command" | env -u OMT_SESSION_ID -u CODEX_THREAD_ID OMT_DIR="$SBX/omt" OMT_REVIEW_ROLE=member bash "$HOOK")
        assert_denied "$out" "bypass-$command" || result=1
    done
    cleanup_sandbox
    return "$result"
}

test_jvm_denied_row() {
    local command="$1" label="$2" out
    new_sandbox
    out=$(payload "$command" | env -u OMT_SESSION_ID -u CODEX_THREAD_ID -u OMT_REVIEW_ROLE OMT_DIR="$SBX/omt" OMT_REVIEW_ROLE=member bash "$HOOK")
    assert_denied "$out" "$label"
    local result=$?
    cleanup_sandbox
    return "$result"
}

test_jvm_allowed_row() {
    local command="$1" label="$2" active="${3:-active}" out rc=0
    new_sandbox
    if [ "$active" = inactive ]; then
        out=$(payload "$command" | env -u OMT_SESSION_ID -u CODEX_THREAD_ID -u OMT_REVIEW_ROLE OMT_DIR="$SBX/omt" bash "$HOOK") || rc=$?
    else
        out=$(payload "$command" | env -u OMT_SESSION_ID -u CODEX_THREAD_ID -u OMT_REVIEW_ROLE OMT_DIR="$SBX/omt" OMT_REVIEW_ROLE=member bash "$HOOK") || rc=$?
    fi
    assert_allowed "$out" "$rc" "$label"
    local result=$?
    cleanup_sandbox
    return "$result"
}

test_jvm_static_scan_boundaries() {
    local command out rc result=0
    for command in '' '   ' '# comment' 'CI=1' "echo '\$(mvn test)'" "echo '\`gradle test\`'" "echo '\$(echo \$(mvn test))'" "cat '<(gradle test)'" "rg '<(gradle test)'" "bash -c 'echo static'" 'rg "gradle test"' 'env CI=1 gradle tasks' 'env -- gradle --version'; do
        new_sandbox
        rc=0; out=$(payload "$command" | env -u OMT_SESSION_ID -u CODEX_THREAD_ID OMT_DIR="$SBX/omt" OMT_REVIEW_ROLE=member bash "$HOOK") || rc=$?
        assert_allowed "$out" "$rc" "jvm-allow-static-$command" || result=1
        cleanup_sandbox
    done
    for command in 'echo $(mvn test)' 'echo "$(mvn test)"' 'echo `mvn test`' 'env CI=1 gradle test' 'env -i CI=1 mvn package' 'env -- gradle test' 'echo $(echo $(mvn test))' 'x=$(echo $(javac Main.java))' 'cat <(gradle test)' "bash -lc 'gradle test'" "sh -c 'env CI=1 gradle test'" "bash -c 'echo \$(mvn test)'" "bash -euc 'mvn package'"; do
        new_sandbox
        out=$(payload "$command" | env -u OMT_SESSION_ID -u CODEX_THREAD_ID OMT_DIR="$SBX/omt" OMT_REVIEW_ROLE=member bash "$HOOK")
        assert_denied "$out" "jvm-deny-static-$command" || result=1
        cleanup_sandbox
    done
    return "$result"
}

test_jvm_unbounded_nested_static_scan() {
    local nested_denied='mvn test' nested_safe='echo static' nested_quoted='mvn test' nested_shell='mvn test' escaped_shell command out rc=0 result=0 i
    for ((i = 0; i < 8; i++)); do
        nested_denied="echo \$($nested_denied)"
        nested_safe="echo \$($nested_safe)"
        nested_quoted="\$(echo $nested_quoted)"
        escaped_shell=${nested_shell//\\/\\\\}
        escaped_shell=${escaped_shell//\"/\\\"}
        nested_shell="bash -c \"$escaped_shell\""
    done

    for command in "$nested_denied" "$nested_shell"; do
        new_sandbox
        out=$(payload "$command" | env -u OMT_SESSION_ID -u CODEX_THREAD_ID OMT_DIR="$SBX/omt" OMT_REVIEW_ROLE=member bash "$HOOK")
        assert_denied "$out" "jvm-deep-deny-$command" || result=1
        cleanup_sandbox
    done
    for command in "$nested_safe" "echo '$nested_quoted'"; do
        new_sandbox
        rc=0; out=$(payload "$command" | env -u OMT_SESSION_ID -u CODEX_THREAD_ID OMT_DIR="$SBX/omt" OMT_REVIEW_ROLE=member bash "$HOOK") || rc=$?
        assert_allowed "$out" "$rc" "jvm-deep-allow-$command" || result=1
        cleanup_sandbox
    done
    return "$result"
}

main() {
    run_test test_member_denies_representative_high_cost_commands
    run_test test_member_denies_despite_identity_disagreement
    run_test test_package_runner_targets_denied
    run_test test_interpreter_module_and_python_runner_targets_denied
    run_test test_member_denies_without_job_scan
    run_test test_matching_conductor_active_denies
    run_test test_matching_conductor_all_members_done_allows
    run_test test_matching_conductor_malformed_status_denies_indeterminate
    run_test test_matching_conductor_bun_failure_denies_indeterminate
    run_test test_active_and_indeterminate_reasons_differ
    run_test test_matching_conductor_missing_job_cli_denies_indeterminate_without_bun
    run_test test_path_resolution_claude_deploy_finds_candidate_one
    run_test test_other_session_job_allows
    run_test test_no_matching_job_allows
    run_test test_non_member_unsafe_session_id_allows
    run_test test_harmless_command_with_active_job_allows_without_bun_call
    run_test test_no_marker_and_no_jq_fail_open
    run_test test_static_and_orchestration_commands_allow
    run_test test_chained_and_quoted_runners_cannot_bypass
    run_test jvm-deny-gradle-test test_jvm_denied_row 'gradle test' jvm-deny-gradle-test
    run_test jvm-deny-gradlew-qualified-test test_jvm_denied_row './gradlew :app:test' jvm-deny-gradlew-qualified-test
    run_test jvm-deny-gradlew-suffixed-test test_jvm_denied_row 'gradlew testDebugUnitTest' jvm-deny-gradlew-suffixed-test
    run_test jvm-deny-gradle-build test_jvm_denied_row 'gradle build' jvm-deny-gradle-build
    run_test jvm-deny-gradle-check test_jvm_denied_row 'gradle check' jvm-deny-gradle-check
    run_test jvm-deny-gradle-assemble test_jvm_denied_row 'gradle assemble' jvm-deny-gradle-assemble
    run_test jvm-deny-gradle-assemble-suffixed test_jvm_denied_row 'gradle assembleDebug' jvm-deny-gradle-assemble-suffixed
    run_test jvm-deny-gradle-compile test_jvm_denied_row 'gradle compileKotlin' jvm-deny-gradle-compile
    run_test jvm-deny-gradlew-qualified-compile test_jvm_denied_row './gradlew :app:compileKotlin' jvm-deny-gradlew-qualified-compile
    run_test jvm-deny-gradle-classes test_jvm_denied_row 'gradle classes' jvm-deny-gradle-classes
    run_test jvm-deny-gradle-lint test_jvm_denied_row 'gradle lint' jvm-deny-gradle-lint
    run_test jvm-deny-gradle-lint-suffixed test_jvm_denied_row 'gradle lintRelease' jvm-deny-gradle-lint-suffixed
    run_test jvm-deny-gradle-ktlint test_jvm_denied_row 'gradle ktlintCheck' jvm-deny-gradle-ktlint
    run_test jvm-deny-gradle-detekt test_jvm_denied_row 'gradle detekt' jvm-deny-gradle-detekt
    run_test jvm-deny-gradlew-option test_jvm_denied_row './gradlew --no-daemon test' jvm-deny-gradlew-option
    run_test jvm-deny-gradle-mixed-help test_jvm_denied_row 'gradle help test' jvm-deny-gradle-mixed-help
    run_test jvm-deny-gradle-mixed-help-task test_jvm_denied_row 'gradle help --task test build' jvm-deny-gradle-mixed-help-task
    run_test jvm-deny-mvn-compile test_jvm_denied_row 'mvn compile' jvm-deny-mvn-compile
    run_test jvm-deny-mvn-test-compile test_jvm_denied_row 'mvn test-compile' jvm-deny-mvn-test-compile
    run_test jvm-deny-mvn-test test_jvm_denied_row 'mvn test' jvm-deny-mvn-test
    run_test jvm-deny-mvn-integration-test test_jvm_denied_row 'mvn integration-test' jvm-deny-mvn-integration-test
    run_test jvm-deny-mvn-package test_jvm_denied_row 'mvn package' jvm-deny-mvn-package
    run_test jvm-deny-mvn-verify test_jvm_denied_row 'mvn verify' jvm-deny-mvn-verify
    run_test jvm-deny-mvn-install test_jvm_denied_row 'mvn install' jvm-deny-mvn-install
    run_test jvm-deny-mvn-ktlint test_jvm_denied_row 'mvn ktlint:check' jvm-deny-mvn-ktlint
    run_test jvm-deny-mvn-detekt test_jvm_denied_row 'mvn detekt:check' jvm-deny-mvn-detekt
    run_test jvm-deny-mvnw-option test_jvm_denied_row '/path/to/mvnw -q verify' jvm-deny-mvnw-option
    run_test jvm-deny-mvn-mixed-help test_jvm_denied_row 'mvn help:effective-pom test' jvm-deny-mvn-mixed-help
    run_test jvm-deny-ktlint test_jvm_denied_row ktlint jvm-deny-ktlint
    run_test jvm-deny-detekt test_jvm_denied_row detekt jvm-deny-detekt
    run_test jvm-deny-kotlinc test_jvm_denied_row 'kotlinc Main.kt' jvm-deny-kotlinc
    run_test jvm-deny-javac test_jvm_denied_row 'javac Main.java' jvm-deny-javac
    run_test jvm-deny-kotlin-runtime test_jvm_denied_row 'kotlin MainKt' jvm-deny-kotlin-runtime
    run_test jvm-deny-java-runtime test_jvm_denied_row 'java Main' jvm-deny-java-runtime
    run_test jvm-deny-java-jar test_jvm_denied_row 'java -jar tests.jar' jvm-deny-java-jar
    run_test jvm-deny-env-gradle test_jvm_denied_row 'CI=1 gradle test' jvm-deny-env-gradle
    run_test jvm-deny-chain-mvn test_jvm_denied_row 'git diff && mvn package' jvm-deny-chain-mvn
    run_test jvm-deny-sh-kotlinc test_jvm_denied_row "sh -c 'kotlinc Main.kt'" jvm-deny-sh-kotlinc
    run_test jvm-deny-bash-javac test_jvm_denied_row "bash -c 'javac Main.java'" jvm-deny-bash-javac
    run_test jvm-deny-zsh-java test_jvm_denied_row "zsh -c 'java Main'" jvm-deny-zsh-java
    run_test jvm-deny-java-version-main test_jvm_denied_row 'java -version Main' jvm-deny-java-version-main
    run_test jvm-deny-java-double-version-main test_jvm_denied_row 'java --version Main' jvm-deny-java-double-version-main
    run_test jvm-deny-kotlin-version-main test_jvm_denied_row 'kotlin -version MainKt' jvm-deny-kotlin-version-main
    run_test jvm-deny-kotlin-double-version-main test_jvm_denied_row 'kotlin --version MainKt' jvm-deny-kotlin-double-version-main
    run_test jvm-allow-gradle-tasks test_jvm_allowed_row 'gradle tasks' jvm-allow-gradle-tasks
    run_test jvm-allow-gradle-help-task test_jvm_allowed_row 'gradle help --task test' jvm-allow-gradle-help-task
    run_test jvm-allow-gradle-properties test_jvm_allowed_row 'gradle properties' jvm-allow-gradle-properties
    run_test jvm-allow-gradle-version test_jvm_allowed_row 'gradle --version' jvm-allow-gradle-version
    run_test jvm-allow-gradlew-version test_jvm_allowed_row './gradlew --version' jvm-allow-gradlew-version
    run_test jvm-allow-mvn-effective-pom test_jvm_allowed_row 'mvn help:effective-pom' jvm-allow-mvn-effective-pom
    run_test jvm-allow-mvn-effective-settings test_jvm_allowed_row 'mvn help:effective-settings' jvm-allow-mvn-effective-settings
    run_test jvm-allow-mvn-version test_jvm_allowed_row 'mvn --version' jvm-allow-mvn-version
    run_test jvm-allow-mvnw-version test_jvm_allowed_row './mvnw --version' jvm-allow-mvnw-version
    run_test jvm-allow-java-version test_jvm_allowed_row 'java -version' jvm-allow-java-version
    run_test jvm-allow-java-double-version test_jvm_allowed_row 'java --version' jvm-allow-java-double-version
    run_test jvm-allow-kotlin-version test_jvm_allowed_row 'kotlin -version' jvm-allow-kotlin-version
    run_test jvm-allow-kotlin-double-version test_jvm_allowed_row 'kotlin --version' jvm-allow-kotlin-double-version
    run_test jvm-allow-rg-literal test_jvm_allowed_row 'rg "gradle test"' jvm-allow-rg-literal
    run_test jvm-static-scan-boundaries test_jvm_static_scan_boundaries
    run_test jvm-unbounded-nested-static-scan test_jvm_unbounded_nested_static_scan
    run_test jvm-allow-inactive-jvm test_jvm_allowed_row 'gradle test' jvm-allow-inactive-jvm inactive
    run_test regression-deny-cargo-test test_jvm_denied_row 'cargo test' regression-deny-cargo-test
    run_test regression-deny-cargo-build test_jvm_denied_row 'cargo build' regression-deny-cargo-build
    run_test regression-deny-cargo-check test_jvm_denied_row 'cargo check' regression-deny-cargo-check
    run_test regression-deny-go-test test_jvm_denied_row 'go test' regression-deny-go-test
    run_test regression-deny-go-build test_jvm_denied_row 'go build' regression-deny-go-build
    echo "Passed: $TESTS_PASSED, Failed: $TESTS_FAILED"
    [ "$TESTS_FAILED" -eq 0 ]
}

main "$@"

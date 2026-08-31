#!/bin/bash
# Tests for the Codex adapter of the shared static-review execution invariant.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$SCRIPT_DIR/codex-review-exec-guard.sh"
CLAUDE_HOOK="$SCRIPT_DIR/review-exec-guard.sh"
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

cleanup_sandbox() { rm -rf "$SBX"; }

payload() {
    local tool_name="$1" key="$2" command="$3" sid="${4:-reviewer}"
    jq -n --arg tool "$tool_name" --arg key "$key" --arg command "$command" --arg sid "$sid" \
        '{tool_name:$tool,tool_input:{($key):$command},session_id:$sid,cwd:"/safe/project"}'
}

run_codex() {
    local tool_name="$1" key="$2" command="$3" sid="${4:-reviewer}"
    payload "$tool_name" "$key" "$command" "$sid" | env -u CODEX_THREAD_ID OMT_DIR="$SBX/omt" OMT_SESSION_ID="$sid" bash "$HOOK"
}

assert_denied() {
    local out="$1" label="$2"
    if ! printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED $label: expected Codex denial, got '$out'"
        return 1
    fi
    printf '%s' "$out" | grep -Eqi 'static-only|static inspection'
}

assert_allowed() {
    local out="$1" rc="$2" label="$3"
    if [ "$rc" -ne 0 ] || [ -n "$out" ]; then
        echo "ASSERTION FAILED $label: expected allow, rc=$rc output='$out'"
        return 1
    fi
}

test_member_extracts_codex_shell_payloads_and_denies() {
    new_sandbox
    local tool_name key command out result=0
    for tool_name in exec_command shell_command Bash; do
        for key in cmd command; do
            for command in 'pnpm test' 'npm run build' 'yarn install' 'bun run lint' 'pytest' 'tsc --noEmit'; do
                out=$(payload "$tool_name" "$key" "$command" | env -u OMT_SESSION_ID -u CODEX_THREAD_ID OMT_DIR="$SBX/omt" OMT_REVIEW_ROLE=member bash "$HOOK")
                assert_denied "$out" "$tool_name-$key-$command" || result=1
            done
        done
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
        out=$(payload exec_command cmd "$command" codex_thread | env OMT_DIR="$SBX/omt" OMT_SESSION_ID=claude_conductor CODEX_THREAD_ID=codex_thread OMT_REVIEW_ROLE=member bash "$HOOK")
        assert_denied "$out" "member-identity-disagreement-$command" || result=1
    done
    cleanup_sandbox
    return "$result"
}

test_package_runner_targets_denied() {
    new_sandbox
    local command out rc result=0
    for command in 'npx jest' 'npx --yes vitest' 'npx -p typescript tsc' 'pnpm exec vitest' 'npm exec eslint .' 'yarn dlx eslint .' 'pnpm dlx vitest' 'bun x vitest' 'bunx jest' "sh -c 'npx jest'" 'git diff && pnpm exec vitest'; do
        out=$(payload exec_command cmd "$command" | env -u OMT_SESSION_ID -u CODEX_THREAD_ID OMT_DIR="$SBX/omt" OMT_REVIEW_ROLE=member bash "$HOOK")
        assert_denied "$out" "runner-deny-$command" || result=1
    done
    for command in 'npx' 'pnpm exec prettier --write .' 'rg "npx jest"'; do
        rc=0; out=$(payload exec_command cmd "$command" | env -u OMT_SESSION_ID -u CODEX_THREAD_ID OMT_DIR="$SBX/omt" OMT_REVIEW_ROLE=member bash "$HOOK") || rc=$?
        assert_allowed "$out" "$rc" "runner-allow-$command" || result=1
    done
    cleanup_sandbox
    return "$result"
}

test_interpreter_module_and_python_runner_targets_denied() {
    new_sandbox
    local command out rc result=0
    for command in 'python -m pytest' 'python3 -m pytest' 'python3.12 -m pytest' 'python -m unittest' 'python -m unittest discover' 'python -m mypy .' 'python -m ruff check' 'mypy .' 'uv run pytest' 'poetry run pytest' 'pipenv run pytest' 'uv run -q pytest' 'git diff && python -m pytest'; do
        out=$(payload exec_command cmd "$command" | env -u OMT_SESSION_ID -u CODEX_THREAD_ID OMT_DIR="$SBX/omt" OMT_REVIEW_ROLE=member bash "$HOOK")
        assert_denied "$out" "interp-deny-$command" || result=1
    done
    for command in 'python script.py' 'python --version' 'python -m http.server' 'python -m json.tool' 'uv run manage.py migrate' 'rg "python -m pytest"'; do
        rc=0; out=$(payload exec_command cmd "$command" | env -u OMT_SESSION_ID -u CODEX_THREAD_ID OMT_DIR="$SBX/omt" OMT_REVIEW_ROLE=member bash "$HOOK") || rc=$?
        assert_allowed "$out" "$rc" "interp-allow-$command" || result=1
    done
    cleanup_sandbox
    return "$result"
}

test_conductor_env_absent_payload_identity_and_other_session() {
    new_sandbox
    mkdir -p "$JOBS/chunk-review-one"
    printf '%s\n' '{"conductorSessionId":"conductor","status":"done"}' > "$JOBS/chunk-review-one/job.json"
    local out rc=0 result=0
    out=$(payload exec_command cmd 'pnpm test' conductor | env -u OMT_SESSION_ID -u CODEX_THREAD_ID OMT_DIR="$SBX/omt" bash "$HOOK")
    assert_denied "$out" payload-identity || result=1
    out=$(run_codex exec_command cmd 'pnpm test' another) || rc=$?
    assert_allowed "$out" "$rc" other-session || result=1
    rm -rf "$JOBS/chunk-review-one"
    rc=0; out=$(run_codex exec_command cmd 'pnpm test' conductor) || rc=$?
    assert_allowed "$out" "$rc" removed-job || result=1
    cleanup_sandbox
    return "$result"
}

test_fail_open_and_non_shell_routes() {
    new_sandbox
    local out rc=0 result=0
    out=$(run_codex exec_command cmd 'pnpm test') || rc=$?
    assert_allowed "$out" "$rc" no-marker || result=1
    mkdir -p "$JOBS/chunk-review-malformed"
    printf '%s\n' '{not json' > "$JOBS/chunk-review-malformed/job.json"
    rc=0; out=$(run_codex exec_command cmd 'pnpm test') || rc=$?
    assert_allowed "$out" "$rc" malformed-job || result=1
    rm -rf "$JOBS/chunk-review-malformed"
    # An unsafe session identity fails open only where identity is what arms the
    # guard -- the conductor route. The member marker is set at worker spawn and
    # carries no identity claim, so it arms the guard regardless.
    rc=0; out=$(payload exec_command cmd 'pnpm test' 'unsafe/session' | env -u OMT_SESSION_ID -u CODEX_THREAD_ID -u OMT_REVIEW_ROLE OMT_DIR="$SBX/omt" bash "$HOOK") || rc=$?
    assert_allowed "$out" "$rc" unsafe-id || result=1
    out=$(payload exec_command cmd 'pnpm test' 'unsafe/session' | env -u OMT_SESSION_ID -u CODEX_THREAD_ID OMT_DIR="$SBX/omt" OMT_REVIEW_ROLE=member bash "$HOOK")
    assert_denied "$out" unsafe-id-member || result=1
    rc=0; out=$(payload exec_command cmd 'pnpm test' conductor | env OMT_DIR="$SBX/omt" OMT_SESSION_ID=conductor CODEX_THREAD_ID=other bash "$HOOK") || rc=$?
    assert_allowed "$out" "$rc" identity-mismatch || result=1
    rc=0; out=$(payload edit command 'pnpm test' | env -u OMT_SESSION_ID -u CODEX_THREAD_ID OMT_DIR="$SBX/omt" OMT_REVIEW_ROLE=member bash "$HOOK") || rc=$?
    assert_allowed "$out" "$rc" non-shell || result=1
    rc=0; out=$(printf '%s' '{bad json' | env OMT_DIR="$SBX/omt" OMT_REVIEW_ROLE=member bash "$HOOK") || rc=$?
    assert_allowed "$out" "$rc" malformed-payload || result=1
    mkdir -p "$SBX/no-bin"
    ln -s /usr/bin/dirname "$SBX/no-bin/dirname"
    ln -s /bin/cat "$SBX/no-bin/cat"
    rc=0; out=$(payload exec_command cmd 'pnpm test' | env -u OMT_SESSION_ID -u CODEX_THREAD_ID OMT_DIR="$SBX/omt" OMT_REVIEW_ROLE=member PATH="$SBX/no-bin" /bin/bash "$HOOK") || rc=$?
    assert_allowed "$out" "$rc" jq-unavailable || result=1
    cleanup_sandbox
    return "$result"
}

test_static_and_orchestration_commands_allow() {
    new_sandbox
    local command out rc result=0
    for command in 'git diff' 'rg conductorSessionId hooks' 'grep -R review hooks' 'cat hooks/lib/omt-dir.sh' 'bun skills/code-review/job.ts collect'; do
        rc=0; out=$(payload shell_command command "$command" | env -u OMT_SESSION_ID -u CODEX_THREAD_ID OMT_DIR="$SBX/omt" OMT_REVIEW_ROLE=member bash "$HOOK") || rc=$?
        assert_allowed "$out" "$rc" "allowed-$command" || result=1
    done
    cleanup_sandbox
    return "$result"
}

test_matches_claude_reason_and_verdict() {
    new_sandbox
    local codex_out claude_out codex_reason claude_reason result=0
    codex_out=$(payload exec_command cmd 'pnpm test' | env -u OMT_SESSION_ID -u CODEX_THREAD_ID OMT_DIR="$SBX/omt" OMT_REVIEW_ROLE=member bash "$HOOK")
    claude_out=$(jq -n --arg command 'pnpm test' --arg sid reviewer '{tool_name:"Bash",tool_input:{command:$command},session_id:$sid,cwd:"/safe/project"}' | env -u OMT_SESSION_ID -u CODEX_THREAD_ID OMT_DIR="$SBX/omt" OMT_REVIEW_ROLE=member bash "$CLAUDE_HOOK")
    assert_denied "$codex_out" codex-member || result=1
    if ! printf '%s' "$claude_out" | grep -q '"continue":false'; then
        echo "ASSERTION FAILED claude-member: expected denial, got '$claude_out'"
        result=1
    fi
    codex_reason=$(printf '%s' "$codex_out" | jq -r '.hookSpecificOutput.permissionDecisionReason')
    claude_reason=$(printf '%s' "$claude_out" | jq -r '.reason')
    if [ "$codex_reason" != "$claude_reason" ]; then
        echo "ASSERTION FAILED twin-reason: Codex '$codex_reason' != Claude '$claude_reason'"
        result=1
    fi
    cleanup_sandbox
    return "$result"
}

test_jvm_denied_row() {
    local command="$1" label="$2" out
    new_sandbox
    out=$(payload exec_command cmd "$command" | env -u OMT_SESSION_ID -u CODEX_THREAD_ID -u OMT_REVIEW_ROLE OMT_DIR="$SBX/omt" OMT_REVIEW_ROLE=member bash "$HOOK")
    assert_denied "$out" "$label"
    local result=$?
    cleanup_sandbox
    return "$result"
}

test_jvm_allowed_row() {
    local command="$1" label="$2" active="${3:-active}" out rc=0
    new_sandbox
    if [ "$active" = inactive ]; then
        out=$(payload exec_command cmd "$command" | env -u OMT_SESSION_ID -u CODEX_THREAD_ID -u OMT_REVIEW_ROLE OMT_DIR="$SBX/omt" bash "$HOOK") || rc=$?
    else
        out=$(payload exec_command cmd "$command" | env -u OMT_SESSION_ID -u CODEX_THREAD_ID -u OMT_REVIEW_ROLE OMT_DIR="$SBX/omt" OMT_REVIEW_ROLE=member bash "$HOOK") || rc=$?
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
        rc=0; out=$(payload exec_command cmd "$command" | env -u OMT_SESSION_ID -u CODEX_THREAD_ID OMT_DIR="$SBX/omt" OMT_REVIEW_ROLE=member bash "$HOOK") || rc=$?
        assert_allowed "$out" "$rc" "jvm-allow-static-$command" || result=1
        cleanup_sandbox
    done
    for command in 'echo $(mvn test)' 'echo "$(mvn test)"' 'echo `mvn test`' 'env CI=1 gradle test' 'env -i CI=1 mvn package' 'env -- gradle test' 'echo $(echo $(mvn test))' 'x=$(echo $(javac Main.java))' 'cat <(gradle test)' "bash -lc 'gradle test'" "sh -c 'env CI=1 gradle test'" "bash -c 'echo \$(mvn test)'" "bash -euc 'mvn package'"; do
        new_sandbox
        out=$(payload exec_command cmd "$command" | env -u OMT_SESSION_ID -u CODEX_THREAD_ID OMT_DIR="$SBX/omt" OMT_REVIEW_ROLE=member bash "$HOOK")
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
        out=$(payload exec_command cmd "$command" | env -u OMT_SESSION_ID -u CODEX_THREAD_ID OMT_DIR="$SBX/omt" OMT_REVIEW_ROLE=member bash "$HOOK")
        assert_denied "$out" "jvm-deep-deny-$command" || result=1
        cleanup_sandbox
    done
    for command in "$nested_safe" "echo '$nested_quoted'"; do
        new_sandbox
        rc=0; out=$(payload exec_command cmd "$command" | env -u OMT_SESSION_ID -u CODEX_THREAD_ID OMT_DIR="$SBX/omt" OMT_REVIEW_ROLE=member bash "$HOOK") || rc=$?
        assert_allowed "$out" "$rc" "jvm-deep-allow-$command" || result=1
        cleanup_sandbox
    done
    return "$result"
}

main() {
    run_test test_member_extracts_codex_shell_payloads_and_denies
    run_test test_member_denies_despite_identity_disagreement
    run_test test_package_runner_targets_denied
    run_test test_interpreter_module_and_python_runner_targets_denied
    run_test test_conductor_env_absent_payload_identity_and_other_session
    run_test test_fail_open_and_non_shell_routes
    run_test test_static_and_orchestration_commands_allow
    run_test test_matches_claude_reason_and_verdict
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

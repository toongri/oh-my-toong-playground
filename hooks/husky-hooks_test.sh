#!/bin/bash
# Husky v9 lifecycle contract.
#
# This test deliberately exercises the checked-in hook files with fake command
# shims. It never invokes a network push: the fresh-clone check only creates a
# local clone and routes a local hook wrapper.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

TESTS_PASSED=0
TESTS_FAILED=0
TEST_ROOT="$(mktemp -d)"

cleanup() {
    rm -rf "$TEST_ROOT"
}

trap cleanup EXIT HUP INT TERM

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

assert_file_contains() {
    local file="$1"
    local token="$2"
    grep -Fq "$token" "$file"
}

test_hook_files_are_modern_plain_commands() {
    local pre_commit="$REPO_DIR/.husky/pre-commit"
    local pre_push="$REPO_DIR/.husky/pre-push"
    [ -f "$pre_commit" ] && [ -x "$pre_commit" ] || return 1
    [ -f "$pre_push" ] && [ -x "$pre_push" ] || return 1

    [ "$(sed -n '1p' "$pre_commit")" = '#!/bin/sh' ] || return 1
    [ "$(sed -n '2p' "$pre_commit")" = 'set -e' ] || return 1
    [ "$(sed -n '3p' "$pre_commit")" = 'bun run lint' ] || return 1
    [ "$(sed -n '1p' "$pre_push")" = '#!/bin/sh' ] || return 1
    [ "$(sed -n '2p' "$pre_push")" = 'set -e' ] || return 1
    [ "$(sed -n '3p' "$pre_push")" = 'bun run lint' ] || return 1
    [ "$(sed -n '4p' "$pre_push")" = 'make test' ] || return 1
    ! grep -Fq '_/husky.sh' "$pre_commit" || return 1
    ! grep -Fq '_/husky.sh' "$pre_push" || return 1
}

test_pre_commit_propagates_lint_status_once() {
    local tmp failed=0
    tmp="$TEST_ROOT/pre-commit"
    mkdir -p "$tmp"
    cat >"$tmp/bun" <<'EOF'
#!/bin/sh
printf 'bun:%s\n' "$*" >>"$FAKE_LOG"
exit "${FAKE_BUN_EXIT:-0}"
EOF
    chmod +x "$tmp/bun"
    : >"$tmp/log"
    set +e
    PATH="$tmp:$PATH" FAKE_LOG="$tmp/log" FAKE_BUN_EXIT=23 sh -e "$REPO_DIR/.husky/pre-commit" 2>/dev/null
    local status=$?
    set -e
    [ "$status" -eq 23 ] || failed=1
    [ "$(grep -c '^bun:run lint$' "$tmp/log")" -eq 1 ] || failed=1
    return "$failed"
}

test_pre_push_orders_commands_and_propagates_make_status() {
    local tmp failed=0
    tmp="$TEST_ROOT/pre-push-order"
    mkdir -p "$tmp"
    cat >"$tmp/bun" <<'EOF'
#!/bin/sh
printf 'bun:%s\n' "$*" >>"$FAKE_LOG"
exit "${FAKE_BUN_EXIT:-0}"
EOF
    cat >"$tmp/make" <<'EOF'
#!/bin/sh
printf 'make:%s\n' "$*" >>"$FAKE_LOG"
exit "${FAKE_MAKE_EXIT:-0}"
EOF
    chmod +x "$tmp/bun" "$tmp/make"
    : >"$tmp/log"
    set +e
    PATH="$tmp:$PATH" FAKE_LOG="$tmp/log" FAKE_BUN_EXIT=0 FAKE_MAKE_EXIT=29 sh -e "$REPO_DIR/.husky/pre-push" 23 29 2>/dev/null
    local status=$?
    set -e
    [ "$status" -eq 29 ] || failed=1
    [ "$(cat "$tmp/log")" = $'bun:run lint\nmake:test' ] || failed=1
    [ "$(grep -c '^bun:run lint$' "$tmp/log")" -eq 1 ] || failed=1
    [ "$(grep -c '^make:test$' "$tmp/log")" -eq 1 ] || failed=1
    return "$failed"
}

test_pre_push_short_circuits_make_when_lint_fails() {
    local tmp failed=0
    tmp="$TEST_ROOT/pre-push-short-circuit"
    mkdir -p "$tmp"
    cat >"$tmp/bun" <<'EOF'
#!/bin/sh
printf 'bun:%s\n' "$*" >>"$FAKE_LOG"
exit 23
EOF
    cat >"$tmp/make" <<'EOF'
#!/bin/sh
printf 'make:%s\n' "$*" >>"$FAKE_LOG"
exit 0
EOF
    chmod +x "$tmp/bun" "$tmp/make"
    : >"$tmp/log"
    set +e
    PATH="$tmp:$PATH" FAKE_LOG="$tmp/log" sh -e "$REPO_DIR/.husky/pre-push" 2>/dev/null
    local status=$?
    set -e
    [ "$status" -eq 23 ] || failed=1
    [ "$(cat "$tmp/log")" = 'bun:run lint' ] || failed=1
    return "$failed"
}

test_package_declares_husky_v9_prepare() {
    grep -Eq '"prepare"[[:space:]]*:[[:space:]]*"husky"' "$REPO_DIR/package.json"
    grep -Eq '"husky"[[:space:]]*:[[:space:]]*"\^?9\.' "$REPO_DIR/package.json"
    grep -Eq '"husky"[[:space:]]*:[[:space:]]*\["husky@9\.' "$REPO_DIR/bun.lock"
}

test_lifecycle_docs_share_contract_tokens() {
    local file token
    for file in "$REPO_DIR/README.md" "$REPO_DIR/README.en.md" "$REPO_DIR/CLAUDE.md"; do
        for token in 'Husky' 'pre-commit' 'pre-push' 'bun run lint' 'make test' 'prepare: husky'; do
            if ! assert_file_contains "$file" "$token"; then
                echo "missing lifecycle token '$token' in $file"
                return 1
            fi
        done
    done
}

test_fresh_clone_installation_activates_and_routes_hooks() {
    local tmp clone global_config failed=0
    tmp="$TEST_ROOT/fresh-clone"
    mkdir -p "$tmp/home"
    global_config="$tmp/git-global-config"
    printf '[user]\n\tname = husky-contract\n' >"$global_config"
    cp "$global_config" "$tmp/git-global-config.before"
    clone="$tmp/clone"
    GIT_CONFIG_GLOBAL="$global_config" GIT_CONFIG_SYSTEM=/dev/null GIT_CONFIG_NOSYSTEM=1 HOME="$tmp/home" \
        git clone --no-local --quiet "$REPO_DIR" "$clone"
    # The contract test itself is intentionally uncommitted while developing;
    # overlay the working-tree lifecycle files onto the local clone.
    cp "$REPO_DIR/package.json" "$REPO_DIR/bun.lock" "$clone/"
    cp -R "$REPO_DIR/.husky" "$clone/"

    (cd "$clone" && GIT_CONFIG_GLOBAL="$global_config" GIT_CONFIG_SYSTEM=/dev/null \
        GIT_CONFIG_NOSYSTEM=1 HOME="$tmp/home" bun install --frozen-lockfile >/dev/null) || failed=1
    cmp -s "$global_config" "$tmp/git-global-config.before" || failed=1

    [ "$(git -C "$clone" config --local core.hooksPath)" = '.husky/_' ] || failed=1
    [ -x "$clone/.husky/_/pre-commit" ] || failed=1
    [ -x "$clone/.husky/_/pre-push" ] || failed=1
    grep -Fq 'dirname "$0")/h' "$clone/.husky/_/pre-push" || failed=1
    grep -Fq 's=$(dirname "$(dirname "$0")")/$n' "$clone/.husky/_/h" || failed=1

    cat >"$clone/node_modules/.bin/bun" <<'EOF'
#!/bin/sh
printf 'bun:%s\n' "$*" >>"$FAKE_LOG"
exit 0
EOF
    cat >"$clone/node_modules/.bin/make" <<'EOF'
#!/bin/sh
printf 'make:%s\n' "$*" >>"$FAKE_LOG"
exit 0
EOF
    chmod +x "$clone/node_modules/.bin/bun" "$clone/node_modules/.bin/make"
    : >"$tmp/log"
    (cd "$clone" && FAKE_LOG="$tmp/log" .husky/_/pre-push) || failed=1
    [ "$(cat "$tmp/log")" = $'bun:run lint\nmake:test' ] || failed=1
    return "$failed"
}

run_test test_hook_files_are_modern_plain_commands
run_test test_pre_commit_propagates_lint_status_once
run_test test_pre_push_orders_commands_and_propagates_make_status
run_test test_pre_push_short_circuits_make_when_lint_fails
run_test test_package_declares_husky_v9_prepare
run_test test_lifecycle_docs_share_contract_tokens
run_test test_fresh_clone_installation_activates_and_routes_hooks

echo "Passed: $TESTS_PASSED, Failed: $TESTS_FAILED"
[ "$TESTS_FAILED" -eq 0 ]

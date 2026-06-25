#!/bin/bash
# =============================================================================
# Codegraph Init Hook Tests
# Safety guards: hook must NOT invoke codegraph init on dangerous/wrong targets.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$SCRIPT_DIR/codegraph-init.sh"

TESTS_PASSED=0
TESTS_FAILED=0

# Isolated sandbox for each test
TEST_TMP_DIR=""

setup() {
    TEST_TMP_DIR=$(mktemp -d)
}

teardown() {
    if [ -n "$TEST_TMP_DIR" ] && [ -d "$TEST_TMP_DIR" ]; then
        rm -rf "$TEST_TMP_DIR"
    fi
}

run_test() {
    local test_name="$1"
    setup
    if "$test_name"; then
        echo "[PASS] $test_name"
        TESTS_PASSED=$((TESTS_PASSED + 1)) || true
    else
        echo "[FAIL] $test_name"
        TESTS_FAILED=$((TESTS_FAILED + 1)) || true
    fi
    teardown
}

# =============================================================================
# Case A: harness repo (contains tools/sync.ts) — must be refused
# =============================================================================

test_harness_repo_does_not_invoke_codegraph() {
    # Build a fake harness repo: git-initialized dir with tools/sync.ts
    local fake_repo="$TEST_TMP_DIR/fake-harness"
    mkdir -p "$fake_repo/tools"
    touch "$fake_repo/tools/sync.ts"
    git init -b main "$fake_repo" > /dev/null 2>&1

    # Stub codegraph binary that writes a marker when invoked
    local bin_dir="$TEST_TMP_DIR/bin"
    mkdir -p "$bin_dir"
    local marker="$TEST_TMP_DIR/codegraph-invoked"
    cat > "$bin_dir/codegraph" <<'EOF'
#!/bin/bash
touch "$CODEGRAPH_MARKER"
EOF
    chmod +x "$bin_dir/codegraph"

    # Feed hook a payload pointing at the fake harness repo
    local payload="{\"cwd\": \"$fake_repo\"}"
    local exit_code=0
    # Export env in a subshell so the vars are inherited by bash "$HOOK" across the pipe
    ( export CODEGRAPH_MARKER="$marker" PATH="$bin_dir:$PATH"
      echo "$payload" | bash "$HOOK" ) || exit_code=$?

    # Hook must exit 0 (never break session start)
    if [ "$exit_code" -ne 0 ]; then
        echo "  Hook exited $exit_code (expected 0 — must never break session start)"
        return 1
    fi

    # The stub marker must NOT have been written (hook refused to init)
    if [ -f "$marker" ]; then
        echo "  codegraph was invoked on harness repo — safety guard FAILED"
        return 1
    fi

    return 0
}

# =============================================================================
# Case B: HOME directory — must be refused
# =============================================================================

test_home_dir_does_not_invoke_codegraph() {
    # Build a fake HOME-like dir: git-initialized (so git rev-parse succeeds)
    # but the resolved root equals the dir we will tell the hook to treat as HOME.
    local fake_home="$TEST_TMP_DIR/fake-home"
    mkdir -p "$fake_home"
    git init -b main "$fake_home" > /dev/null 2>&1

    # Stub codegraph binary
    local bin_dir="$TEST_TMP_DIR/bin2"
    mkdir -p "$bin_dir"
    local marker="$TEST_TMP_DIR/codegraph-invoked-home"
    cat > "$bin_dir/codegraph" <<'EOF'
#!/bin/bash
touch "$CODEGRAPH_MARKER"
EOF
    chmod +x "$bin_dir/codegraph"

    # Feed hook a payload whose cwd IS the fake_home,
    # and override HOME so the hook's $HOME comparison hits.
    local payload="{\"cwd\": \"$fake_home\"}"
    local exit_code=0
    ( export HOME="$fake_home" CODEGRAPH_MARKER="$marker" PATH="$bin_dir:$PATH"
      echo "$payload" | bash "$HOOK" ) || exit_code=$?

    if [ "$exit_code" -ne 0 ]; then
        echo "  Hook exited $exit_code (expected 0)"
        return 1
    fi

    if [ -f "$marker" ]; then
        echo "  codegraph was invoked on HOME dir — safety guard FAILED"
        return 1
    fi

    return 0
}

# =============================================================================
# Case C: normal repo — hook invokes codegraph (or skips cleanly if binary absent)
# =============================================================================

test_normal_repo_allows_codegraph_init() {
    # Build a legitimate repo: no tools/sync.ts, not HOME, not /
    local normal_repo="$TEST_TMP_DIR/my-project"
    mkdir -p "$normal_repo"
    git init -b main "$normal_repo" > /dev/null 2>&1

    # Stub codegraph binary
    local bin_dir="$TEST_TMP_DIR/bin3"
    mkdir -p "$bin_dir"
    local marker="$TEST_TMP_DIR/codegraph-invoked-normal"
    cat > "$bin_dir/codegraph" <<'EOF'
#!/bin/bash
touch "$CODEGRAPH_MARKER"
exit 0
EOF
    chmod +x "$bin_dir/codegraph"

    local payload="{\"cwd\": \"$normal_repo\"}"
    local exit_code=0
    ( export CODEGRAPH_MARKER="$marker" PATH="$bin_dir:$PATH"
      echo "$payload" | bash "$HOOK" ) || exit_code=$?

    if [ "$exit_code" -ne 0 ]; then
        echo "  Hook exited $exit_code on normal repo (expected 0)"
        return 1
    fi

    # Wait briefly for background job
    sleep 0.5

    # Marker should have been written (init ran)
    if [ ! -f "$marker" ]; then
        echo "  codegraph was NOT invoked on normal repo — hook should have initiated init"
        return 1
    fi

    return 0
}

# =============================================================================
# Case D: sentinel exists — skip (idempotent)
# =============================================================================

test_sentinel_prevents_reinit() {
    local normal_repo="$TEST_TMP_DIR/repo-sentinel"
    mkdir -p "$normal_repo/.codegraph"
    git init -b main "$normal_repo" > /dev/null 2>&1
    # Place the sentinel that signals a prior attempt
    touch "$normal_repo/.codegraph/.omt-init-attempted"

    local bin_dir="$TEST_TMP_DIR/bin4"
    mkdir -p "$bin_dir"
    local marker="$TEST_TMP_DIR/codegraph-invoked-sentinel"
    cat > "$bin_dir/codegraph" <<'EOF'
#!/bin/bash
touch "$CODEGRAPH_MARKER"
exit 0
EOF
    chmod +x "$bin_dir/codegraph"

    local payload="{\"cwd\": \"$normal_repo\"}"
    local exit_code=0
    ( export CODEGRAPH_MARKER="$marker" PATH="$bin_dir:$PATH"
      echo "$payload" | bash "$HOOK" ) || exit_code=$?

    if [ "$exit_code" -ne 0 ]; then
        echo "  Hook exited $exit_code (expected 0)"
        return 1
    fi

    sleep 0.3

    if [ -f "$marker" ]; then
        echo "  codegraph was invoked despite sentinel — idempotency guard FAILED"
        return 1
    fi

    return 0
}

# =============================================================================
# Case E: not a git repo — exit 0 cleanly
# =============================================================================

test_non_git_dir_exits_cleanly() {
    local non_git="$TEST_TMP_DIR/not-a-repo"
    mkdir -p "$non_git"
    # No git init

    local bin_dir="$TEST_TMP_DIR/bin5"
    mkdir -p "$bin_dir"
    local marker="$TEST_TMP_DIR/codegraph-invoked-nongit"
    cat > "$bin_dir/codegraph" <<'EOF'
#!/bin/bash
touch "$CODEGRAPH_MARKER"
exit 0
EOF
    chmod +x "$bin_dir/codegraph"

    local payload="{\"cwd\": \"$non_git\"}"
    local exit_code=0
    ( export CODEGRAPH_MARKER="$marker" PATH="$bin_dir:$PATH"
      echo "$payload" | bash "$HOOK" ) || exit_code=$?

    if [ "$exit_code" -ne 0 ]; then
        echo "  Hook exited $exit_code on non-git dir (expected 0)"
        return 1
    fi

    if [ -f "$marker" ]; then
        echo "  codegraph was invoked on non-git dir — should have exited early"
        return 1
    fi

    return 0
}

# =============================================================================
# Main
# =============================================================================

main() {
    echo "=========================================="
    echo "Codegraph Init Hook Tests"
    echo "=========================================="

    run_test test_harness_repo_does_not_invoke_codegraph
    run_test test_home_dir_does_not_invoke_codegraph
    run_test test_normal_repo_allows_codegraph_init
    run_test test_sentinel_prevents_reinit
    run_test test_non_git_dir_exits_cleanly

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [ "$TESTS_FAILED" -gt 0 ]; then
        exit 1
    fi
}

main "$@"

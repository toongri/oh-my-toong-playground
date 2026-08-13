#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
PREPARE="$SCRIPT_DIR/prepare-fixtures.sh"
MANIFEST="$SCRIPT_DIR/manifest.json"
TEST_ROOT="$(mktemp -d)"
SOURCE_ROOT="$TEST_ROOT/repos"
KNOWN_ID="refactor-invariant"
TESTS_PASSED=0
TESTS_FAILED=0

trap 'rm -rf "$TEST_ROOT"' EXIT

read_manifest_field() {
  local field="$1"
  bun -e '
    const manifest = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const fixture = manifest.fixtures.find((candidate) => candidate.id === process.argv[2]);
    process.stdout.write(fixture[process.argv[3]]);
  ' "$MANIFEST" "$KNOWN_ID" "$field"
}

SOURCE_REPO="$(read_manifest_field source_repo)"
PINNED_SHA="$(read_manifest_field sha)"
mkdir -p "$SOURCE_ROOT"
git clone --no-local -q "$PROJECT_ROOT" "$SOURCE_ROOT/$SOURCE_REPO"

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

test_unknown_id_records_failure_and_continues() {
  local eval_root="$TEST_ROOT/unknown"
  local output exit_code=0

  output="$(OMT_EVAL_ROOT="$eval_root" OMT_FIXTURE_REPO_ROOT="$SOURCE_ROOT" \
    bash "$PREPARE" missing-fixture "$KNOWN_ID" 2>&1)" || exit_code=$?

  [ "$exit_code" -eq 1 ] || return 1
  printf '%s' "$output" | grep -F 'no such fixture in manifest: missing-fixture' >/dev/null || return 1
  printf '%s' "$output" | grep -F "preparing: $KNOWN_ID" >/dev/null || return 1
  git -C "$eval_root/fixtures/$KNOWN_ID" rev-parse --is-inside-work-tree >/dev/null 2>&1
}

test_existing_worktree_rejects_wrong_head() {
  local eval_root="$TEST_ROOT/stale"
  local fixture_path="$eval_root/fixtures/$KNOWN_ID"
  local alternate_sha output exit_code=0

  alternate_sha="$(git -C "$SOURCE_ROOT/$SOURCE_REPO" rev-parse HEAD)"
  [ "$alternate_sha" != "$PINNED_SHA" ] || alternate_sha="$(git -C "$SOURCE_ROOT/$SOURCE_REPO" rev-parse HEAD^)"
  mkdir -p "$eval_root/fixtures"
  git -C "$SOURCE_ROOT/$SOURCE_REPO" worktree add -q --detach "$fixture_path" "$alternate_sha"

  output="$(OMT_EVAL_ROOT="$eval_root" OMT_FIXTURE_REPO_ROOT="$SOURCE_ROOT" \
    bash "$PREPARE" "$KNOWN_ID" 2>&1)" || exit_code=$?

  [ "$exit_code" -eq 1 ] || return 1
  printf '%s' "$output" | grep -F "HEAD does not match manifest SHA $PINNED_SHA" >/dev/null
}

test_existing_worktree_rejects_local_changes() {
  local eval_root="$TEST_ROOT/dirty"
  local fixture_path="$eval_root/fixtures/$KNOWN_ID"
  local output exit_code=0

  mkdir -p "$eval_root/fixtures"
  git -C "$SOURCE_ROOT/$SOURCE_REPO" worktree add -q --detach "$fixture_path" "$PINNED_SHA"
  printf '\ndirty fixture\n' >> "$fixture_path/README.md"

  output="$(OMT_EVAL_ROOT="$eval_root" OMT_FIXTURE_REPO_ROOT="$SOURCE_ROOT" \
    bash "$PREPARE" "$KNOWN_ID" 2>&1)" || exit_code=$?

  [ "$exit_code" -eq 1 ] || return 1
  printf '%s' "$output" | grep -F 'worktree has local changes' >/dev/null
}

run_test test_unknown_id_records_failure_and_continues
run_test test_existing_worktree_rejects_wrong_head
run_test test_existing_worktree_rejects_local_changes

echo
echo "passed: $TESTS_PASSED"
echo "failed: $TESTS_FAILED"

[ "$TESTS_FAILED" -eq 0 ]

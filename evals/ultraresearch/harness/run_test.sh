#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/bin" "$TMP/harness/in" "$TMP/harness/arm" "$TMP/harness/input"
cp "$ROOT/run.sh" "$TMP/harness/run.sh"
cp "$ROOT/run2.sh" "$TMP/harness/run2.sh"
printf 'report\n' > "$TMP/harness/in/REPORT.md"
printf 'prompt\n' > "$TMP/harness/in/prompt-arm.txt"
printf 'input\n' > "$TMP/harness/input/data.md"
printf 'prompt\n' > "$TMP/harness/input/prompt-arm.txt"

cat > "$TMP/bin/codex" <<'EOF'
#!/usr/bin/env bash
exit "${FAKE_CODEX_STATUS:-0}"
EOF
chmod +x "$TMP/bin/codex"

run_and_assert_status() {
  script="$1"
  expected="$2"
  shift 2
  set +e
  output="$(PATH="$TMP/bin:$PATH" FAKE_CODEX_STATUS="$expected" "$script" "$@")"
  status=$?
  set -e
  if [ "$status" -ne "$expected" ]; then
    echo "expected status $expected, got $status from $script" >&2
    return 1
  fi
  case "$output" in
    *"exit=$expected"*) ;;
    *) echo "missing exit status in output: $output" >&2; return 1 ;;
  esac
}

run_and_assert_status "$TMP/harness/run.sh" 42 arm 1
run_and_assert_status "$TMP/harness/run.sh" 0 arm 2
run_and_assert_status "$TMP/harness/run2.sh" 42 input arm 1 REPORT.md
run_and_assert_status "$TMP/harness/run2.sh" 0 input arm 2 REPORT.md

echo "run harness exit propagation: PASS"

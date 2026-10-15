#!/bin/bash
# Tests for hooks/lib/git-grep-patterns.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/git-grep-patterns.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0

expect_lacks() {
    if git_grep_command_lacks_binary_skip "$1"; then PASS=$((PASS + 1)); else FAIL=$((FAIL + 1)); echo "FAIL (should match): $1"; fi
}
expect_ok() {
    if git_grep_command_lacks_binary_skip "$1"; then FAIL=$((FAIL + 1)); echo "FAIL (should not match): $1"; else PASS=$((PASS + 1)); fi
}

expect_lacks 'git grep -n foo'
expect_lacks "git grep -ln -E 'a|b' -- apps packages"
expect_lacks 'cd x && git grep foo'
expect_lacks 'git -C repo grep foo'
expect_lacks 'taskpolicy -b nice -n 19 git grep foo'
expect_lacks '/usr/bin/git grep foo'
expect_lacks 'git --no-pager grep foo'
expect_lacks 'FOO=1 env -u BAR git -c core.x=1 grep foo'
expect_lacks 'git grep -I foo; git grep bar'
expect_lacks 'git grep foo -- -I'
expect_lacks 'git grep -e -I foo'
expect_lacks "$(printf 'echo hi\ngit grep foo')"
expect_lacks 'x=$(git grep foo)'
expect_lacks "git grep -n '섭취 기록' -- apps"
expect_lacks 'git grep -I -a foo'
expect_lacks 'git grep -Ia foo'
expect_lacks 'git grep -I --text foo'
expect_lacks 'git grep -I --no-text foo'

expect_ok 'git grep -I foo'
expect_ok 'git grep -nI foo'
expect_ok 'git grep -Iln foo -- apps'
expect_ok 'git -C r grep -I foo'
expect_ok 'echo "git grep foo"'
expect_ok 'git commit -m "git grep fix"'
expect_ok "git commit -m 'a; git grep fix'"
expect_ok 'rg foo'
expect_ok 'git commit -m "fix: git grep 사용 제거"'
expect_ok "git grep -I -n '섭취'"
expect_ok 'git grep -a -I foo'
expect_ok 'git grep -aI foo'
expect_ok 'git grep --text -I foo'
expect_ok 'git grep -I --textconv foo'
expect_ok 'git log -S foo'
expect_ok 'grep -r foo .'
expect_ok 'git grep-ish'
expect_ok "$(printf 'git commit -F - <<EOF\ngit grep foo\nEOF')"

# Korean deny case must not write to stderr (awk multibyte abort regression)
ERR="$(git_grep_command_lacks_binary_skip "git grep -n '섭취 기록' -- apps" 2>&1 >/dev/null || true)"
if [ -z "$ERR" ]; then PASS=$((PASS + 1)); else FAIL=$((FAIL + 1)); echo "FAIL (stderr not empty): $ERR"; fi

echo "git-grep-patterns: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]

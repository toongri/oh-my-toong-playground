#!/bin/bash
# =============================================================================
# Codex Spawn-Depth-Gate Hook Tests
# Covers hooks/codex-spawn-depth-gate.sh: the Codex PreToolUse gate that reads
# the CALLER's own rollout (via stdin.transcript_path) for a
# `.payload.source.subagent.thread_spawn.depth` value already written by
# codex itself, and denies a spawn whose CHILD would exceed CAP(2). No state
# file, no parent-child correlation, no leaf-marker check -- see
# hooks/codex-spawn-depth-gate.sh's own header for the full rationale.
#
# Re-capture procedure (if the upstream rollout schema is ever suspected to
# have drifted): pick a recent Codex session directory under
# ~/.codex/sessions/**/rollout-*.jsonl, and inspect its FIRST line with
# `jq '.payload.source.subagent.thread_spawn' <rollout file>` -- a root
# session's rollout has no `subagent` key at all (or `thread_spawn` is null);
# a spawned subagent's rollout carries `{depth, parent_thread_id, agent_path,
# agent_role}` on line 1. Do NOT commit any captured rollout content to this
# repo (real line 1 carries the full Codex system prompt plus personal
# absolute paths) -- only hand-write the minimal JSON shape into a fixture
# here, as the tests below already do.
#
# What this re-capture procedure does NOT cover: if codex changes the SHAPE
# or NAME of `thread_spawn` (moves it, renames it, nests it differently),
# this hook fails open (a read that can't find the field defaults to
# cur=0/child=1, always allowed) and every fixture below stays green -- the
# tests pass while the actual depth cap is silently gone. There is no runtime
# canary in this repo that would catch that drift; re-running this manual
# procedure against a fresh real rollout is the only mitigation that exists
# today.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$SCRIPT_DIR/codex-spawn-depth-gate.sh"

TESTS_PASSED=0
TESTS_FAILED=0

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

# run_hook: feed stdin JSON to the hook under a plain, unmodified PATH (jq
# present).
run_hook() {
    bash "$HOOK"
}

# assert_allow: exit 0 AND no deny-JSON in stdout -- exit-0-only would let a
# CRASHED hook (non-zero exit swallowed by a caller, or an empty stdout for
# an unrelated reason) masquerade as an allow, mirrors hooks/codex-write-
# guard_test.sh's own assert_allow rationale.
assert_allow() {
    local out="$1" rc="$2" label="$3"
    if [ "$rc" -ne 0 ]; then
        echo "ASSERTION FAILED $label: expected allow (exit 0), got exit $rc, output '$out'"
        return 1
    fi
    if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED $label: expected allow, got deny in output '$out'"
        return 1
    fi
    return 0
}

new_sandbox() {
    SBX=$(mktemp -d)
}

# mk_rollout <content>: writes a one-line fixture rollout file under $SBX,
# returns its path via echo.
mk_rollout() {
    local f="$SBX/rollout-test.jsonl"
    printf '%s\n' "$1" > "$f"
    printf '%s' "$f"
}

# =============================================================================
# Row 1 -- jq absent -> allow (fail-open), no output. PATH is narrowed to a
# jq-less directory (every /usr/bin, /bin entry symlinked in except jq),
# mirroring hooks/codex-keyword-detector_test.sh's test_missing_jq_fails_open
# technique. The fixture underneath is a depth=2 rollout (would DENY if jq
# were present) so this test actually exercises the fail-open path rather
# than trivially passing on an already-allow payload.
# =============================================================================
test_row1_jq_absent_allows() {
    new_sandbox
    local rollout jq_less_bin entry payload out exit_code=0 result=0

    rollout=$(mk_rollout '{"payload":{"source":{"subagent":{"thread_spawn":{"depth":2}}}}}')
    payload=$(jq -n --arg tp "$rollout" '{tool_name:"collaborationspawn_agent", transcript_path:$tp}')

    jq_less_bin=$(mktemp -d)
    for entry in /usr/bin/* /bin/*; do
        [ "$(basename "$entry")" = "jq" ] && continue
        ln -s "$entry" "$jq_less_bin/$(basename "$entry")" 2>/dev/null || true
    done

    out=$(printf '%s' "$payload" | PATH="$jq_less_bin" /bin/bash "$HOOK" 2>/dev/null) || exit_code=$?
    rm -rf "$jq_less_bin"

    [ "$exit_code" -eq 0 ] || { echo "ASSERTION FAILED row1: expected exit 0 when jq is absent, got $exit_code"; result=1; }
    [ -z "$out" ] || { echo "ASSERTION FAILED row1: expected empty stdout when jq is absent, got '$out'"; result=1; }

    rm -rf "$SBX"
    return "$result"
}

# =============================================================================
# Row 2 -- tool_name does not match the *spawn_agent pattern -> allow, no
# intervention. Uses a depth=2 rollout so a would-be-deny payload proves the
# tool-name gate short-circuits before the rollout is even judged.
# =============================================================================
test_row2_non_spawn_tool_name_allows() {
    new_sandbox
    local rollout payload out rc=0 result=0

    rollout=$(mk_rollout '{"payload":{"source":{"subagent":{"thread_spawn":{"depth":2}}}}}')
    payload=$(jq -n --arg tp "$rollout" '{tool_name:"Bash", transcript_path:$tp}')

    out=$(printf '%s' "$payload" | run_hook) || rc=$?
    if ! assert_allow "$out" "$rc" "row2-Bash"; then result=1; fi

    payload=$(jq -n --arg tp "$rollout" '{tool_name:"apply_patch", transcript_path:$tp}')
    out=$(printf '%s' "$payload" | run_hook) || rc=$?
    if ! assert_allow "$out" "$rc" "row2-apply_patch"; then result=1; fi

    rm -rf "$SBX"
    return "$result"
}

# =============================================================================
# Row 3 -- transcript_path key absent, or present-but-empty -> allow
# (fail-open), no output. Both sub-shapes covered in one case per the table
# row's own "absent 또는 빈 문자열" wording.
# =============================================================================
test_row3_transcript_path_absent_or_empty_allows() {
    local payload out rc=0 result=0

    payload='{"tool_name":"collaborationspawn_agent"}'
    out=$(printf '%s' "$payload" | run_hook) || rc=$?
    if ! assert_allow "$out" "$rc" "row3-absent-key"; then result=1; fi

    rc=0
    payload='{"tool_name":"collaborationspawn_agent","transcript_path":""}'
    out=$(printf '%s' "$payload" | run_hook) || rc=$?
    if ! assert_allow "$out" "$rc" "row3-empty-string"; then result=1; fi

    return "$result"
}

# =============================================================================
# Row 4 -- transcript_path points at a file that does not exist -> allow
# (fail-open), no output.
# =============================================================================
test_row4_transcript_path_nonexistent_file_allows() {
    new_sandbox
    local payload out rc=0 result=0

    payload=$(jq -n --arg tp "$SBX/does-not-exist.jsonl" '{tool_name:"collaborationspawn_agent", transcript_path:$tp}')
    out=$(printf '%s' "$payload" | run_hook) || rc=$?
    if ! assert_allow "$out" "$rc" "row4-nonexistent"; then result=1; fi

    rm -rf "$SBX"
    return "$result"
}

# =============================================================================
# Row 5 -- rollout content is not valid JSON -> allow (fail-open), no output.
# =============================================================================
test_row5_rollout_invalid_json_allows() {
    new_sandbox
    local rollout payload out rc=0 result=0

    rollout=$(mk_rollout 'this is not json at all {{{')
    payload=$(jq -n --arg tp "$rollout" '{tool_name:"collaborationspawn_agent", transcript_path:$tp}')

    out=$(printf '%s' "$payload" | run_hook) || rc=$?
    if ! assert_allow "$out" "$rc" "row5-invalid-json"; then result=1; fi

    rm -rf "$SBX"
    return "$result"
}

# =============================================================================
# Row 6 -- rollout has no thread_spawn key at all (a normal root-session
# rollout) -> cur=0, child=1, 1 > 2 is false -> allow.
# =============================================================================
test_row6_no_thread_spawn_root_allows() {
    new_sandbox
    local rollout payload out rc=0 result=0

    rollout=$(mk_rollout '{"payload":{"source":{"other":"stuff"}}}')
    payload=$(jq -n --arg tp "$rollout" '{tool_name:"collaborationspawn_agent", transcript_path:$tp}')

    out=$(printf '%s' "$payload" | run_hook) || rc=$?
    if ! assert_allow "$out" "$rc" "row6-no-thread-spawn"; then result=1; fi

    rm -rf "$SBX"
    return "$result"
}

# =============================================================================
# Row 7 -- thread_spawn.depth = 1 -> child=2, 2 > 2 is false -> allow.
# =============================================================================
test_row7_depth_1_allows() {
    new_sandbox
    local rollout payload out rc=0 result=0

    rollout=$(mk_rollout '{"payload":{"source":{"subagent":{"thread_spawn":{"depth":1}}}}}')
    payload=$(jq -n --arg tp "$rollout" '{tool_name:"collaborationspawn_agent", transcript_path:$tp}')

    out=$(printf '%s' "$payload" | run_hook) || rc=$?
    if ! assert_allow "$out" "$rc" "row7-depth-1"; then result=1; fi

    rm -rf "$SBX"
    return "$result"
}

# =============================================================================
# Row 8 -- thread_spawn.depth = 2 -> child=3, 3 > 2 is true -> DENY, with the
# reason string carrying BOTH the actual child depth (3) and the CAP (2).
# =============================================================================
test_row8_depth_2_denies_with_numbers_in_reason() {
    new_sandbox
    local rollout payload out result=0

    rollout=$(mk_rollout '{"payload":{"source":{"subagent":{"thread_spawn":{"depth":2}}}}}')
    payload=$(jq -n --arg tp "$rollout" '{tool_name:"collaborationspawn_agent", transcript_path:$tp}')

    out=$(printf '%s' "$payload" | run_hook)

    if ! printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED row8: expected deny for thread_spawn.depth=2, got '$out'"
        result=1
    fi
    if ! printf '%s' "$out" | grep -q '3'; then
        echo "ASSERTION FAILED row8: expected the child depth (3) to appear in the deny reason, got '$out'"
        result=1
    fi
    if ! printf '%s' "$out" | grep -q '2'; then
        echo "ASSERTION FAILED row8: expected the CAP (2) to appear in the deny reason, got '$out'"
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

main() {
    echo "=========================================="
    echo "Codex Spawn-Depth-Gate Hook Tests"
    echo "=========================================="

    run_test test_row1_jq_absent_allows
    run_test test_row2_non_spawn_tool_name_allows
    run_test test_row3_transcript_path_absent_or_empty_allows
    run_test test_row4_transcript_path_nonexistent_file_allows
    run_test test_row5_rollout_invalid_json_allows
    run_test test_row6_no_thread_spawn_root_allows
    run_test test_row7_depth_1_allows
    run_test test_row8_depth_2_denies_with_numbers_in_reason

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [ "$TESTS_FAILED" -gt 0 ]; then
        exit 1
    fi
}

main "$@"

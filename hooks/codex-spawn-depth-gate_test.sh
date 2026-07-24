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
# single symlink, /bin/cat -- the ONLY external command the hook's jq-absent
# path actually calls. hooks/codex-spawn-depth-gate.sh:68 runs
# `input=$(cat)` BEFORE the `command -v jq` check at :70 (a bash builtin,
# needs no PATH entry); that check's failure exits the whole hook at :71, so
# tr/head/jq further down are never reached. Follows the explicit
# per-command whitelist posture of hooks/codex-write-guard_test.sh:1569-1577's
# new_jq_less_bin (list only what the exercised path truly calls), not the
# blanket "every /usr/bin, /bin entry except jq" copy this test used to
# carry. That copy's own comment claimed to mirror hooks/codex-keyword-
# detector_test.sh's test_missing_jq_fails_open technique -- which is itself
# a brute ~961-entry copy, not the minimal single-symlink pattern its OWN
# comment in turn claims to mirror from hooks/ledger-core_test.sh's
# test_qa_jq_absent (that one links only sed). The chain of "mirrors X" was
# broken; this row now matches what it actually needs, not what a prior
# comment asserted. The fixture underneath is a depth=2 rollout (would DENY
# if jq were present) so this test actually exercises the fail-open path
# rather than trivially passing on an already-allow payload.
# =============================================================================
test_row1_jq_absent_allows() {
    new_sandbox
    local rollout jq_less_bin payload out exit_code=0 result=0

    rollout=$(mk_rollout '{"payload":{"source":{"subagent":{"thread_spawn":{"depth":2}}}}}')
    payload=$(jq -n --arg tp "$rollout" '{tool_name:"collaborationspawn_agent", transcript_path:$tp}')

    jq_less_bin=$(mktemp -d)
    ln -s /bin/cat "$jq_less_bin/cat"

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

    # rc must be reset between sub-assertions in the same test function --
    # `|| rc=$?` only assigns on a non-zero exit, so a failing first call
    # would otherwise leak its rc into the second assertion below (row 3
    # already follows this discipline; this call was missing it).
    rc=0
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

    # hookEventName must be "PreToolUse" -- the deny envelope's structural
    # anchor, not just its permissionDecision/reason content. Unlike hooks/
    # write-guard-core.sh's _wg_core_deny_json (a literal string constant
    # pinned byte-for-byte by hooks/codex-write-guard_test.sh:2381), this
    # hook assembles the envelope field-by-field via jq at hooks/codex-spawn-
    # depth-gate.sh:136-149 -- every field is drift-capable code with no
    # constant backing it. Dropping or misspelling hookEventName at :139
    # would stop Codex from recognizing this response as a PreToolUse
    # verdict at all (a depth-exceeding spawn would silently pass), yet the
    # `grep -q '"permissionDecision":"deny"'` check above would still match
    # -- this assertion is what actually pins :139.
    if ! printf '%s' "$out" | jq -e '.hookSpecificOutput.hookEventName == "PreToolUse"' > /dev/null; then
        echo "ASSERTION FAILED row8: expected hookSpecificOutput.hookEventName == \"PreToolUse\", got '$out'"
        result=1
    fi

    # Extract the reason field itself and assert the full sentence -- a bare
    # `grep -q '3'`/`grep -q '2'` over the whole JSON blob passes as long as
    # BOTH digits appear ANYWHERE, even if the reason-builder swapped $child
    # and $cap into a self-contradictory sentence (e.g. "would reach depth 2,
    # exceeding the cap of 3"). Pinning the digit to its own role (child depth
    # vs cap) inside the extracted reason string closes that hole.
    reason=$(printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecisionReason')
    case "$reason" in
        *"reach depth 3"*) ;;
        *) echo "ASSERTION FAILED row8: expected child depth 3 in reason, got '$reason'"; result=1 ;;
    esac
    case "$reason" in
        *"cap of 2"*) ;;
        *) echo "ASSERTION FAILED row8: expected CAP 2 in reason, got '$reason'"; result=1 ;;
    esac

    rm -rf "$SBX"
    return "$result"
}

# =============================================================================
# Row 9 -- numeric-guard pressure fixtures. hooks/codex-spawn-depth-gate.sh:
# 119-121's case guard exists to protect the arithmetic below from a
# non-numeric `cur` (schema drift, a corrupted line) without ever crashing
# into a fail-CLOSED shape. Plain 0/1/2 fixtures elsewhere in this suite
# never pressure that guard at all -- deleting it entirely still leaves the
# suite green. Each fixture here asserts exit 0 + empty stdout (fail-open),
# mirroring row1's explicit checks.
# =============================================================================
test_row9_leading_zero_depth_denies_without_crashing() {
    new_sandbox
    local rollout payload out exit_code=0 result=0

    # "08" is a JSON string (bare 08 is not valid JSON) whose every character
    # is a digit, so the old *[!0-9]* pattern let it through unchanged --
    # bash then evaluated $((08 + 1)) as an octal literal and aborted the
    # script (fail-CLOSED). This is the exact fixture finding 1 fixes.
    #
    # Unlike null/"abc"/-1 below (real schema drift that legitimately
    # defaults to cur=0/allow), "08" is a well-formed all-digit value: once
    # parsed correctly as decimal 8, child=9 genuinely exceeds CAP=2, so the
    # correct post-fix outcome is a real DENY (exit 0, deny JSON), not a
    # silent allow -- this fixture only proves the arithmetic no longer
    # crashes, not that the guard treats "08" as malformed.
    rollout=$(mk_rollout '{"payload":{"source":{"subagent":{"thread_spawn":{"depth":"08"}}}}}')
    payload=$(jq -n --arg tp "$rollout" '{tool_name:"collaborationspawn_agent", transcript_path:$tp}')

    out=$(printf '%s' "$payload" | run_hook) || exit_code=$?

    [ "$exit_code" -eq 0 ] || { echo "ASSERTION FAILED row9-leading-zero: expected exit 0 (no crash), got $exit_code"; result=1; }
    echo "$out" | jq -e '.hookSpecificOutput.permissionDecision == "deny"' > /dev/null \
        || { echo "ASSERTION FAILED row9-leading-zero: expected deny for depth=8 (child=9 > cap 2), got '$out'"; result=1; }

    rm -rf "$SBX"
    return "$result"
}

test_row9_null_depth_allows() {
    new_sandbox
    local rollout payload out exit_code=0 result=0

    rollout=$(mk_rollout '{"payload":{"source":{"subagent":{"thread_spawn":{"depth":null}}}}}')
    payload=$(jq -n --arg tp "$rollout" '{tool_name:"collaborationspawn_agent", transcript_path:$tp}')

    out=$(printf '%s' "$payload" | run_hook) || exit_code=$?

    [ "$exit_code" -eq 0 ] || { echo "ASSERTION FAILED row9-null: expected exit 0, got $exit_code"; result=1; }
    [ -z "$out" ] || { echo "ASSERTION FAILED row9-null: expected empty stdout, got '$out'"; result=1; }

    rm -rf "$SBX"
    return "$result"
}

test_row9_non_numeric_depth_allows() {
    new_sandbox
    local rollout payload out exit_code=0 result=0

    rollout=$(mk_rollout '{"payload":{"source":{"subagent":{"thread_spawn":{"depth":"abc"}}}}}')
    payload=$(jq -n --arg tp "$rollout" '{tool_name:"collaborationspawn_agent", transcript_path:$tp}')

    out=$(printf '%s' "$payload" | run_hook) || exit_code=$?

    [ "$exit_code" -eq 0 ] || { echo "ASSERTION FAILED row9-non-numeric: expected exit 0, got $exit_code"; result=1; }
    [ -z "$out" ] || { echo "ASSERTION FAILED row9-non-numeric: expected empty stdout, got '$out'"; result=1; }

    rm -rf "$SBX"
    return "$result"
}

test_row9_negative_depth_allows() {
    new_sandbox
    local rollout payload out exit_code=0 result=0

    rollout=$(mk_rollout '{"payload":{"source":{"subagent":{"thread_spawn":{"depth":-1}}}}}')
    payload=$(jq -n --arg tp "$rollout" '{tool_name:"collaborationspawn_agent", transcript_path:$tp}')

    out=$(printf '%s' "$payload" | run_hook) || exit_code=$?

    [ "$exit_code" -eq 0 ] || { echo "ASSERTION FAILED row9-negative: expected exit 0, got $exit_code"; result=1; }
    [ -z "$out" ] || { echo "ASSERTION FAILED row9-negative: expected empty stdout, got '$out'"; result=1; }

    rm -rf "$SBX"
    return "$result"
}

# =============================================================================
# Row 10 -- tool-name matcher mutation-pressure fixtures. hooks/codex-spawn-
# depth-gate.sh:84's `tr '[:upper:]' '[:lower:]'` and :86's suffix pattern
# (`*spawn_agent`, not `*spawn_agent*`) both carry a comment explaining why
# they're there, but row 2 above only ever feeds names that don't match
# either way -- it can't pin either refinement, since a name that fails to
# match stays unmatched whether or not lowercasing or suffix-vs-substring
# changes underneath it.
# =============================================================================
test_row10_mixed_case_spawn_agent_denies() {
    new_sandbox
    local rollout payload out rc=0 result=0

    # Mixed-case tool name that only ends in "spawn_agent" AFTER lowercasing
    # -- pins the `tr` call at :84. Removing that line would leave this
    # fixture unmatched (allow) instead of the deny asserted here.
    rollout=$(mk_rollout '{"payload":{"source":{"subagent":{"thread_spawn":{"depth":2}}}}}')
    payload=$(jq -n --arg tp "$rollout" '{tool_name:"CollaborationSpawn_Agent", transcript_path:$tp}')

    out=$(printf '%s' "$payload" | run_hook) || rc=$?
    if [ "$rc" -ne 0 ]; then
        echo "ASSERTION FAILED row10-mixed-case: expected exit 0, got $rc"
        result=1
    fi
    if ! printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED row10-mixed-case: expected deny for mixed-case spawn tool name, got '$out'"
        result=1
    fi

    rm -rf "$SBX"
    return "$result"
}

test_row10_near_miss_tool_name_allows() {
    new_sandbox
    local rollout payload out rc=0 result=0

    # "spawn_agent_helper" CONTAINS spawn_agent but does not END with it --
    # pins the suffix anchor (`*spawn_agent`) at :86. Widening that pattern
    # to a substring match (`*spawn_agent*`) would wrongly deny this
    # unrelated tool name.
    rollout=$(mk_rollout '{"payload":{"source":{"subagent":{"thread_spawn":{"depth":2}}}}}')
    payload=$(jq -n --arg tp "$rollout" '{tool_name:"spawn_agent_helper", transcript_path:$tp}')

    out=$(printf '%s' "$payload" | run_hook) || rc=$?
    if ! assert_allow "$out" "$rc" "row10-near-miss"; then result=1; fi

    rm -rf "$SBX"
    return "$result"
}

# =============================================================================
# Row 11 -- rollout file's last line has NO trailing newline (codex mid-flush
# of the rollout file). Pins the `|| [ -n "$line" ]` guard at hooks/codex-
# spawn-depth-gate.sh:109: without it, `read` returns non-zero on the
# newline-less line and the loop body never runs, so cur stays unset ->
# defaults to 0 -> allow (fail-OPEN on a spawn that must DENY).
# =============================================================================
test_row11_no_trailing_newline_last_line_denies() {
    new_sandbox
    local rollout payload out result=0

    # Cannot use mk_rollout here -- it always appends a trailing newline via
    # `printf '%s\n'`, which would never exercise the `|| [ -n "$line" ]`
    # guard this test exists to pin. Writes the fixture directly with
    # `printf '%s'` (no trailing newline) instead.
    rollout="$SBX/rollout-test.jsonl"
    printf '%s' '{"payload":{"source":{"subagent":{"thread_spawn":{"depth":2}}}}}' > "$rollout"

    payload=$(jq -n --arg tp "$rollout" '{tool_name:"collaborationspawn_agent", transcript_path:$tp}')

    out=$(printf '%s' "$payload" | run_hook)

    if ! printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        echo "ASSERTION FAILED row11: expected deny for no-trailing-newline depth=2 rollout, got '$out'"
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
    run_test test_row9_leading_zero_depth_denies_without_crashing
    run_test test_row9_null_depth_allows
    run_test test_row9_non_numeric_depth_allows
    run_test test_row9_negative_depth_allows
    run_test test_row10_mixed_case_spawn_agent_denies
    run_test test_row10_near_miss_tool_name_allows
    run_test test_row11_no_trailing_newline_last_line_denies

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [ "$TESTS_FAILED" -gt 0 ]; then
        exit 1
    fi
}

main "$@"

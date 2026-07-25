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

# assert_deny <out> <rc> <label> <expected_child> <expected_cap>: pins the
# FULL deny envelope emitted by hooks/codex-spawn-depth-gate.sh:135-149 in
# one place, instead of every deny row asserting a different bespoke subset
# of it with its own grep/jq. Checks four properties together:
#   1. exit 0 -- deny is NOT a nonzero-exit shape for this hook. The hook's
#      own header (hooks/codex-spawn-depth-gate.sh:37-44) documents that it
#      always answers via stdout JSON + exit 0, even on deny; a nonzero exit
#      here would be a DIFFERENT (and wrong) deny shape -- this hook has no
#      fail-CLOSED path.
#   2. .hookSpecificOutput.permissionDecision == "deny", read via a NESTED
#      jq path, not a top-level `grep -q '"permissionDecision":"deny"'` --
#      the nested path pins that the field actually lives inside the
#      hookSpecificOutput wrapper, not merely that the substring appears
#      somewhere in the output.
#   3. .hookSpecificOutput.hookEventName == "PreToolUse" -- the envelope's
#      structural anchor. Unlike hooks/write-guard-core.sh's
#      _wg_core_deny_json (a literal string constant pinned byte-for-byte by
#      hooks/codex-write-guard_test.sh), this hook assembles the envelope
#      field-by-field via jq -- every field, including hookEventName, is
#      drift-capable code with no constant backing it. Dropping or
#      misspelling hookEventName at :139 would stop Codex from recognizing
#      this response as a PreToolUse verdict at all (a depth-exceeding spawn
#      would silently pass), yet a bare permissionDecision grep would still
#      match.
#   4. The reason string carries $expected_child and $expected_cap PINNED TO
#      THEIR OWN ROLE, not "both digits appear somewhere in the JSON blob".
#      A bare `grep -q '3'` + `grep -q '2'` passes even if the reason-builder
#      swapped $child and $cap into a self-contradictory sentence ("would
#      reach depth 2, exceeding the cap of 3"). Matching "reach depth
#      <child>" and "cap of <cap>" against the EXTRACTED reason string, each
#      independently, closes that hole.
assert_deny() {
    local out="$1" rc="$2" label="$3" expected_child="$4" expected_cap="$5"
    local result=0 reason

    if [ "$rc" -ne 0 ]; then
        echo "ASSERTION FAILED $label: expected deny (exit 0), got exit $rc, output '$out'"
        result=1
    fi

    if ! printf '%s' "$out" | jq -e '.hookSpecificOutput.permissionDecision == "deny"' > /dev/null 2>&1; then
        echo "ASSERTION FAILED $label: expected hookSpecificOutput.permissionDecision == \"deny\", got '$out'"
        result=1
    fi

    if ! printf '%s' "$out" | jq -e '.hookSpecificOutput.hookEventName == "PreToolUse"' > /dev/null 2>&1; then
        echo "ASSERTION FAILED $label: expected hookSpecificOutput.hookEventName == \"PreToolUse\", got '$out'"
        result=1
    fi

    reason=$(printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecisionReason // empty' 2>/dev/null) || reason=""
    case "$reason" in
        *"reach depth $expected_child"*) ;;
        *) echo "ASSERTION FAILED $label: expected child depth $expected_child in reason, got '$reason'"; result=1 ;;
    esac
    case "$reason" in
        *"cap of $expected_cap"*) ;;
        *) echo "ASSERTION FAILED $label: expected CAP $expected_cap in reason, got '$reason'"; result=1 ;;
    esac

    return "$result"
}

new_sandbox() {
    SBX=$(mktemp -d)
}

# mk_rollout <line>... : writes a fixture rollout file under $SBX, one line
# per argument (in argument order), returns its path via echo. `printf
# '%s\n' "$@"` cycles the format string once per positional argument, so a
# single-argument call writes exactly one line -- verified byte-identical to
# the prior single-arg `printf '%s\n' "$1"` body (diffed the raw bytes of
# both forms against the same input; empty diff). All pre-existing
# single-arg call sites are unaffected by this widening; only the new
# multi-line fixtures below (rows 13-14) pass more than one argument.
mk_rollout() {
    local f="$SBX/rollout-test.jsonl"
    printf '%s\n' "$@" > "$f"
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
#
# stderr is also captured (into a file under $SBX, not discarded) and
# asserted empty: the hook's core contract is that EVERY read failure --
# jq absent included -- fails open SILENTLY (hooks/codex-spawn-depth-
# gate.sh:29-36's own "Known unclosed residual risks" note: "there is no
# diagnostic emitted anywhere on that path"). With PATH narrowed to a single
# `cat` symlink, any call the jq-absent branch makes to a command other than
# that whitelisted one surfaces as a "command not found" on stderr -- a
# `2>/dev/null` here would silently swallow exactly the kind of drift this
# row exists to catch.
# =============================================================================
test_row1_jq_absent_allows() {
    new_sandbox
    local rollout jq_less_bin payload out exit_code=0 result=0 stderr_file stderr_content

    rollout=$(mk_rollout '{"payload":{"source":{"subagent":{"thread_spawn":{"depth":2}}}}}')
    payload=$(jq -n --arg tp "$rollout" '{tool_name:"collaborationspawn_agent", transcript_path:$tp}')

    jq_less_bin=$(mktemp -d)
    ln -s /bin/cat "$jq_less_bin/cat"

    stderr_file="$SBX/stderr.txt"
    out=$(printf '%s' "$payload" | PATH="$jq_less_bin" /bin/bash "$HOOK" 2>"$stderr_file") || exit_code=$?
    rm -rf "$jq_less_bin"

    [ "$exit_code" -eq 0 ] || { echo "ASSERTION FAILED row1: expected exit 0 when jq is absent, got $exit_code"; result=1; }
    [ -z "$out" ] || { echo "ASSERTION FAILED row1: expected empty stdout when jq is absent, got '$out'"; result=1; }

    stderr_content=$(cat "$stderr_file")
    [ -z "$stderr_content" ] || { echo "ASSERTION FAILED row1: expected empty stderr when jq is absent (fail-open contract forbids diagnostics), got '$stderr_content'"; result=1; }

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
    local rollout payload out rc=0 result=0

    rollout=$(mk_rollout '{"payload":{"source":{"subagent":{"thread_spawn":{"depth":2}}}}}')
    payload=$(jq -n --arg tp "$rollout" '{tool_name:"collaborationspawn_agent", transcript_path:$tp}')

    out=$(printf '%s' "$payload" | run_hook) || rc=$?
    # See assert_deny's own docstring for what each of its four checks pins
    # and why a bare grep over the whole JSON blob would not be enough.
    assert_deny "$out" "$rc" "row8-depth-2" 3 2 || result=1

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
    local rollout payload out rc=0 result=0

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

    out=$(printf '%s' "$payload" | run_hook) || rc=$?
    assert_deny "$out" "$rc" "row9-leading-zero" 9 2 || result=1

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
    assert_deny "$out" "$rc" "row10-mixed-case" 3 2 || result=1

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
    local rollout payload out rc=0 result=0

    # Cannot use mk_rollout here -- it always appends a trailing newline via
    # `printf '%s\n'`, which would never exercise the `|| [ -n "$line" ]`
    # guard this test exists to pin. Writes the fixture directly with
    # `printf '%s'` (no trailing newline) instead.
    rollout="$SBX/rollout-test.jsonl"
    printf '%s' '{"payload":{"source":{"subagent":{"thread_spawn":{"depth":2}}}}}' > "$rollout"

    payload=$(jq -n --arg tp "$rollout" '{tool_name:"collaborationspawn_agent", transcript_path:$tp}')

    out=$(printf '%s' "$payload" | run_hook) || rc=$?
    assert_deny "$out" "$rc" "row11-no-trailing-newline" 3 2 || result=1

    rm -rf "$SBX"
    return "$result"
}

# =============================================================================
# Row 12 -- transcript_path is a RELATIVE filename that happens to start with
# a dash ("-n1"). Pre-fix, hooks/codex-spawn-depth-gate.sh:116's `head -3
# "$transcript_path"` hands "-n1" to `head` as a bare positional argument,
# and `head` parses a leading-dash argument as an OPTION (here, "-n1" reads
# as "show 1 line") rather than as a filename -- so head never opens the
# real rollout file, reads instead from its own (already-exhausted) stdin,
# `cur` stays unset, and a depth=2 rollout that must DENY falls through to
# fail-open ALLOW. The fix is `head -3 -- "$transcript_path"`, where `--`
# ends option parsing so everything after it is a filename regardless of
# what it starts with.
#
# MUST be a RELATIVE path: an absolute path always starts with "/" and can
# never be misread as an option, so this defect is invisible unless the
# hook's cwd is the sandbox and the fixture is referenced by its bare
# relative name -- do not "simplify" this to an absolute path later, that
# would silently stop exercising the bug this test exists to catch.
#
# Cannot use mk_rollout here -- it always writes to the fixed path
# "$SBX/rollout-test.jsonl", which can never start with a dash. Writes the
# fixture directly with `printf` under the dash-prefixed name instead.
# =============================================================================
test_row12_dash_prefixed_relative_transcript_path_denies() {
    new_sandbox
    local payload out rc=0 result=0

    printf '%s\n' '{"payload":{"source":{"subagent":{"thread_spawn":{"depth":2}}}}}' > "$SBX/-n1"
    payload=$(jq -n --arg tp "-n1" '{tool_name:"collaborationspawn_agent", transcript_path:$tp}')

    # cwd must be $SBX while the hook runs -- transcript_path="-n1" is
    # relative, and the hook's `-f` existence check (hooks/codex-spawn-
    # depth-gate.sh:92) resolves it against the caller's cwd, so "-n1" only
    # resolves to the fixture above when invoked from inside $SBX.
    out=$(cd "$SBX" && printf '%s' "$payload" | run_hook) || rc=$?
    assert_deny "$out" "$rc" "row12-dash-prefixed" 3 2 || result=1

    rm -rf "$SBX"
    return "$result"
}

# =============================================================================
# Row 13 -- depth on the rollout file's 2ND line, preceded by a non-empty,
# valid-JSON filler line that carries no thread_spawn key. Every rollout
# fixture elsewhere in this suite is single-line, so the multi-line scan
# loop at hooks/codex-spawn-depth-gate.sh:109-116 (`head -3` feeding a
# `while read` that keeps scanning past a line with no depth) has never
# actually been pressured -- every prior fixture finds (or fails to find)
# depth on the very first line it reads. This fixture proves the loop keeps
# scanning past line 1: reducing the hook's `head -3` to `head -1` must make
# this fixture regress from DENY to ALLOW (the filler line has depth=null,
# no match, and head -1 would never reach line 2 to find the real depth).
# The filler line must be non-empty valid JSON, not blank -- hooks/codex-
# spawn-depth-gate.sh:110's `[ -n "$line" ] || continue` skips blank lines
# without pressuring the loop's `read` iteration at all.
# =============================================================================
test_row13_depth_on_second_line_denies() {
    new_sandbox
    local rollout payload out rc=0 result=0

    rollout=$(mk_rollout \
        '{"payload":{"source":{}}}' \
        '{"payload":{"source":{"subagent":{"thread_spawn":{"depth":2}}}}}')
    payload=$(jq -n --arg tp "$rollout" '{tool_name:"collaborationspawn_agent", transcript_path:$tp}')

    out=$(printf '%s' "$payload" | run_hook) || rc=$?
    assert_deny "$out" "$rc" "row13-depth-on-line2" 3 2 || result=1

    rm -rf "$SBX"
    return "$result"
}

# =============================================================================
# Row 14 -- depth on the rollout file's 4TH line, one line past the
# `head -3` window at hooks/codex-spawn-depth-gate.sh:116. This is a
# DESIGNED miss, not a bug: the hook's own comment at :94-98 documents that a
# 20-rollout manual scan found thread_spawn only ever on line 1 (8/8), with
# 3 lines kept only as margin against an ordering variation that sample was
# too small to surface. A depth value that only appears on line 4 sits
# outside that margin, so the scan never reaches it -- cur stays unset,
# defaults to 0, child=1, 1 > CAP(2) is false -> ALLOW. This is not a defect
# to fix here; it documents the known boundary of the 3-line scan window.
# =============================================================================
test_row14_depth_on_fourth_line_beyond_scan_window_allows() {
    new_sandbox
    local rollout payload out rc=0 result=0

    rollout=$(mk_rollout \
        '{"payload":{"source":{}}}' \
        '{"payload":{"source":{}}}' \
        '{"payload":{"source":{}}}' \
        '{"payload":{"source":{"subagent":{"thread_spawn":{"depth":2}}}}}')
    payload=$(jq -n --arg tp "$rollout" '{tool_name:"collaborationspawn_agent", transcript_path:$tp}')

    out=$(printf '%s' "$payload" | run_hook) || rc=$?
    if ! assert_allow "$out" "$rc" "row14-depth-on-line4-beyond-window"; then result=1; fi

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
    run_test test_row12_dash_prefixed_relative_transcript_path_denies
    run_test test_row13_depth_on_second_line_denies
    run_test test_row14_depth_on_fourth_line_beyond_scan_window_allows

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [ "$TESTS_FAILED" -gt 0 ]; then
        exit 1
    fi
}

main "$@"

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

# assert_allow: exit 0 AND empty stdout AND empty stderr. All three pin the
# fail-open contract at hooks/codex-spawn-depth-gate.sh:29-36 -- every allow
# path is a bare `exit 0` with no stdout, and no read failure emits a
# diagnostic anywhere on that path. Checking exit 0 alone would let a crashed
# hook masquerade as an allow.
#
# $4 and $5 are PATHS to the stderr/stdout files the caller captured, not
# their contents: `$(cat file)` strips ALL trailing newlines, so a stream
# holding nothing but a stray newline -- still a real byte the contract
# forbids -- collapses to "" and slips past a `[ -n "$s" ]` check. `[ -s
# FILE ]` reads the file's actual byte size instead and catches it. Callers
# pass paths rather than having this helper redirect, so each row keeps its
# fixture files where it wants them. $1 is the already-substituted stdout
# string, kept only so failure messages can show content -- never the thing
# judged.
assert_allow() {
    local out="$1" rc="$2" label="$3" stderr_file="$4" stdout_file="$5"
    if [ "$rc" -ne 0 ]; then
        echo "ASSERTION FAILED $label: expected allow (exit 0), got exit $rc, output '$out'"
        return 1
    fi
    if [ -s "$stdout_file" ]; then
        echo "ASSERTION FAILED $label: expected empty stdout (allow contract is silent, hooks/codex-spawn-depth-gate.sh:29-36), got '$out'"
        return 1
    fi
    if [ -s "$stderr_file" ]; then
        echo "ASSERTION FAILED $label: expected empty stderr (fail-open contract forbids diagnostics), got '$(cat "$stderr_file")'"
        return 1
    fi
    return 0
}

# assert_deny <out> <rc> <label> <expected_child> <expected_cap>: pins the
# FULL deny envelope emitted by hooks/codex-spawn-depth-gate.sh:135-149 in
# one place, instead of every deny row asserting a different bespoke subset
# of it with its own grep/jq. Checks five properties together:
#   1. exit 0 -- this hook always answers via stdout JSON, even on deny, and
#      has no fail-CLOSED path, so a nonzero exit is a different and wrong
#      deny shape.
#   2. .hookSpecificOutput.permissionDecision == "deny" via the NESTED jq
#      path -- pins that the field lives inside the wrapper, not merely that
#      the substring appears somewhere in the output.
#   3. .hookSpecificOutput.hookEventName == "PreToolUse" -- the envelope is
#      assembled field-by-field by jq with no string constant backing it, so
#      every field is drift-capable. Dropping or misspelling this one stops
#      Codex recognizing the response as a verdict at all (the spawn silently
#      passes), yet a permissionDecision grep still matches.
#   4. The reason string carries $expected_child and $expected_cap PINNED TO
#      THEIR OWN ROLE, not "both digits appear somewhere in the blob" -- two
#      bare digit greps pass even on a self-contradictory sentence with the
#      two swapped. Each pattern also closes on the right with the delimiter
#      that follows it in the real string ("," and " "), so "depth 30" cannot
#      satisfy an expected child of 3.
#   5. stdout is EXACTLY one JSON object. `jq -e` over a multi-object stream
#      reports only the LAST value's status, so noise emitted ahead of the
#      real envelope is invisible to checks 1-4 while Codex, which parses
#      this stdout as a single verdict, fails outright.
assert_deny() {
    local out="$1" rc="$2" label="$3" expected_child="$4" expected_cap="$5"
    local result=0 reason obj_count

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
        *"reach depth $expected_child,"*) ;;
        *) echo "ASSERTION FAILED $label: expected child depth $expected_child in reason, got '$reason'"; result=1 ;;
    esac
    case "$reason" in
        *"cap of $expected_cap "*) ;;
        *) echo "ASSERTION FAILED $label: expected CAP $expected_cap in reason, got '$reason'"; result=1 ;;
    esac

    obj_count=$(printf '%s' "$out" | jq -s 'length' 2>/dev/null) || obj_count=""
    if [ "$obj_count" != "1" ]; then
        echo "ASSERTION FAILED $label: expected exactly one JSON object in stdout, got count '$obj_count' (output '$out')"
        result=1
    fi

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
# tr/head/jq further down are never reached. The whitelist lists only what
# the exercised path truly calls -- do not widen it back to a blanket copy of
# /usr/bin and /bin, which would hide a new external call this path acquires.
# The fixture underneath is a depth=2 rollout (would DENY if jq were present)
# so this test exercises the fail-open path rather than trivially passing on
# an already-allow payload.
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
    local rollout jq_less_bin payload out exit_code=0 result=0 stderr_file stdout_file

    rollout=$(mk_rollout '{"payload":{"source":{"subagent":{"thread_spawn":{"depth":2}}}}}')
    payload=$(jq -n --arg tp "$rollout" '{tool_name:"collaborationspawn_agent", transcript_path:$tp}')

    jq_less_bin=$(mktemp -d)
    ln -s /bin/cat "$jq_less_bin/cat"

    stderr_file="$SBX/stderr.txt"
    stdout_file="$SBX/stdout.txt"
    printf '%s' "$payload" | PATH="$jq_less_bin" /bin/bash "$HOOK" >"$stdout_file" 2>"$stderr_file" || exit_code=$?
    out=$(cat "$stdout_file")
    rm -rf "$jq_less_bin"

    [ "$exit_code" -eq 0 ] || { echo "ASSERTION FAILED row1: expected exit 0 when jq is absent, got $exit_code"; result=1; }
    [ ! -s "$stdout_file" ] || { echo "ASSERTION FAILED row1: expected empty stdout when jq is absent, got '$out'"; result=1; }

    [ ! -s "$stderr_file" ] || { echo "ASSERTION FAILED row1: expected empty stderr when jq is absent (fail-open contract forbids diagnostics), got '$(cat "$stderr_file")'"; result=1; }

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
    local rollout payload out rc=0 result=0 stderr_file stdout_file

    stderr_file="$SBX/stderr.txt"
    stdout_file="$SBX/stdout.txt"
    rollout=$(mk_rollout '{"payload":{"source":{"subagent":{"thread_spawn":{"depth":2}}}}}')
    payload=$(jq -n --arg tp "$rollout" '{tool_name:"Bash", transcript_path:$tp}')

    printf '%s' "$payload" | run_hook >"$stdout_file" 2>"$stderr_file" || rc=$?
    out=$(cat "$stdout_file")
    if ! assert_allow "$out" "$rc" "row2-Bash" "$stderr_file" "$stdout_file"; then result=1; fi

    # rc must be reset between sub-assertions in the same test function --
    # `|| rc=$?` only assigns on a non-zero exit, so a failing first call
    # would otherwise leak its rc into the second assertion below (row 3
    # already follows this discipline; this call was missing it).
    rc=0
    payload=$(jq -n --arg tp "$rollout" '{tool_name:"apply_patch", transcript_path:$tp}')
    printf '%s' "$payload" | run_hook >"$stdout_file" 2>"$stderr_file" || rc=$?
    out=$(cat "$stdout_file")
    if ! assert_allow "$out" "$rc" "row2-apply_patch" "$stderr_file" "$stdout_file"; then result=1; fi

    rm -rf "$SBX"
    return "$result"
}

# =============================================================================
# Row 3 -- transcript_path key absent, or present-but-empty -> allow
# (fail-open), no output. Both sub-shapes covered in one case per the table
# row's own "absent 또는 빈 문자열" wording.
# =============================================================================
test_row3_transcript_path_absent_or_empty_allows() {
    local payload out rc=0 result=0 stderr_file stdout_file

    # No new_sandbox here -- this row's two payloads are static literals with
    # no fixture file, so bare mktemp files (not the $SBX machinery) are all
    # the stdout/stderr capture needs; removed explicitly at the end since
    # there is no $SBX cleanup to piggyback on.
    stderr_file=$(mktemp)
    stdout_file=$(mktemp)

    payload='{"tool_name":"collaborationspawn_agent"}'
    printf '%s' "$payload" | run_hook >"$stdout_file" 2>"$stderr_file" || rc=$?
    out=$(cat "$stdout_file")
    if ! assert_allow "$out" "$rc" "row3-absent-key" "$stderr_file" "$stdout_file"; then result=1; fi

    rc=0
    payload='{"tool_name":"collaborationspawn_agent","transcript_path":""}'
    printf '%s' "$payload" | run_hook >"$stdout_file" 2>"$stderr_file" || rc=$?
    out=$(cat "$stdout_file")
    if ! assert_allow "$out" "$rc" "row3-empty-string" "$stderr_file" "$stdout_file"; then result=1; fi

    rm -f "$stderr_file" "$stdout_file"
    return "$result"
}

# =============================================================================
# Row 4 -- transcript_path points at a file that does not exist -> allow
# (fail-open), no output.
# =============================================================================
test_row4_transcript_path_nonexistent_file_allows() {
    new_sandbox
    local payload out rc=0 result=0 stderr_file stdout_file

    stderr_file="$SBX/stderr.txt"
    stdout_file="$SBX/stdout.txt"
    payload=$(jq -n --arg tp "$SBX/does-not-exist.jsonl" '{tool_name:"collaborationspawn_agent", transcript_path:$tp}')
    printf '%s' "$payload" | run_hook >"$stdout_file" 2>"$stderr_file" || rc=$?
    out=$(cat "$stdout_file")
    if ! assert_allow "$out" "$rc" "row4-nonexistent" "$stderr_file" "$stdout_file"; then result=1; fi

    rm -rf "$SBX"
    return "$result"
}

# =============================================================================
# Row 5 -- rollout content is not valid JSON -> allow (fail-open), no output.
# =============================================================================
test_row5_rollout_invalid_json_allows() {
    new_sandbox
    local rollout payload out rc=0 result=0 stderr_file stdout_file

    stderr_file="$SBX/stderr.txt"
    stdout_file="$SBX/stdout.txt"
    rollout=$(mk_rollout 'this is not json at all {{{')
    payload=$(jq -n --arg tp "$rollout" '{tool_name:"collaborationspawn_agent", transcript_path:$tp}')

    printf '%s' "$payload" | run_hook >"$stdout_file" 2>"$stderr_file" || rc=$?
    out=$(cat "$stdout_file")
    if ! assert_allow "$out" "$rc" "row5-invalid-json" "$stderr_file" "$stdout_file"; then result=1; fi

    rm -rf "$SBX"
    return "$result"
}

# =============================================================================
# Row 6 -- rollout has no thread_spawn key at all (a normal root-session
# rollout) -> cur=0, child=1, 1 > 2 is false -> allow.
# =============================================================================
test_row6_no_thread_spawn_root_allows() {
    new_sandbox
    local rollout payload out rc=0 result=0 stderr_file stdout_file

    stderr_file="$SBX/stderr.txt"
    stdout_file="$SBX/stdout.txt"
    rollout=$(mk_rollout '{"payload":{"source":{"other":"stuff"}}}')
    payload=$(jq -n --arg tp "$rollout" '{tool_name:"collaborationspawn_agent", transcript_path:$tp}')

    printf '%s' "$payload" | run_hook >"$stdout_file" 2>"$stderr_file" || rc=$?
    out=$(cat "$stdout_file")
    if ! assert_allow "$out" "$rc" "row6-no-thread-spawn" "$stderr_file" "$stdout_file"; then result=1; fi

    rm -rf "$SBX"
    return "$result"
}

# =============================================================================
# Row 7 -- thread_spawn.depth = 1 -> child=2, 2 > 2 is false -> allow.
# =============================================================================
test_row7_depth_1_allows() {
    new_sandbox
    local rollout payload out rc=0 result=0 stderr_file stdout_file
    local depth_value=1

    # Self-check: this row is the ONLY fixture in this suite that pins
    # hooks/codex-spawn-depth-gate.sh:135's `-gt` comparator specifically
    # (row8 denies under both `-gt` and a mutated `-ge`, so it cannot tell
    # them apart). That power rests entirely on depth_value's own child
    # (depth_value + 1) landing EXACTLY on CAP -- only at that exact boundary
    # do `-gt` (child > CAP is false -> allow) and `-ge` (child >= CAP is
    # true -> deny) actually disagree; anywhere else both comparators agree
    # and this row cannot discriminate between them.
    #
    # CAP is READ FROM THE HOOK, not hardcoded. The other cap literals here
    # (row8's `assert_deny ... 3 2`, row9's `... 9 2`) drift LOUDLY -- bump
    # the hook's CAP and they go red, and red is a repair instruction. A
    # hardcoded 2 in THIS check would drift silently instead: it keeps passing
    # through the CAP change AND through the repair that follows, which moves
    # depth_value's child off the boundary and quietly ends this row's ability
    # to pin `-gt`. The `-gt` -> `-ge` regression that then goes undetected
    # points at false DENY, which this hook offers no bypass to recover from.
    local expected_cap cap_lines
    cap_lines=$(grep -cE '^CAP=[0-9]+$' "$HOOK" || true)
    expected_cap=$(grep -E '^CAP=[0-9]+$' "$HOOK" | head -1 | cut -d= -f2 || true)
    if [ "$cap_lines" -ne 1 ]; then
        echo "ASSERTION FAILED row7-depth-1: expected exactly one cap literal (a bare ^CAP=<digits>\$ line) in $HOOK, found $cap_lines -- with none there is no value to compare against, and with several \$expected_cap holds multiple lines, which makes the boundary comparison below abort with 'integer expression expected' and skip its own body, leaving this row green with its self-check inert"
        result=1
        expected_cap=-1
    fi
    if [ "$((depth_value + 1))" -ne "$expected_cap" ]; then
        echo "ASSERTION FAILED row7-depth-1: depth_value+1 ($((depth_value + 1))) must equal CAP ($expected_cap) exactly -- only at that boundary does hooks/codex-spawn-depth-gate.sh:135's \`-gt\` (allow) and a mutated \`-ge\` (deny) actually disagree; this row cannot pin \`-gt\` specifically otherwise"
        result=1
    fi

    stderr_file="$SBX/stderr.txt"
    stdout_file="$SBX/stdout.txt"
    rollout=$(mk_rollout "$(printf '{"payload":{"source":{"subagent":{"thread_spawn":{"depth":%s}}}}}' "$depth_value")")
    payload=$(jq -n --arg tp "$rollout" '{tool_name:"collaborationspawn_agent", transcript_path:$tp}')

    printf '%s' "$payload" | run_hook >"$stdout_file" 2>"$stderr_file" || rc=$?
    out=$(cat "$stdout_file")
    if ! assert_allow "$out" "$rc" "row7-depth-1" "$stderr_file" "$stdout_file"; then result=1; fi

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
    # See assert_deny's own docstring for what each of its five checks pins
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
    local depth_value="08"

    # "08" is a JSON string (bare 08 is not valid JSON) whose every character
    # is a digit, so an all-digit guard alone lets it through and bash then
    # reads $((08 + 1)) as an octal literal and aborts the script -- a
    # fail-CLOSED shape this hook must never take.
    #
    # Unlike null/"abc"/-1 below (real schema drift that legitimately
    # defaults to cur=0/allow), "08" is well-formed: parsed correctly as
    # decimal 8, child=9 genuinely exceeds CAP, so the right outcome is a real
    # DENY. This fixture proves the arithmetic no longer crashes, not that the
    # guard treats "08" as malformed.

    # Two self-checks below. The first pins all-digit, which is what tells
    # this row apart from row9-non-numeric (a different code path that
    # legitimately falls through to cur=0/allow).
    case "$depth_value" in
        '' | *[!0-9]*) echo "ASSERTION FAILED row9-leading-zero: depth_value \"$depth_value\" must be all-digit -- this row exists to prove well-formed all-digit input no longer crashes on octal misread, not that malformed input is rejected"; result=1 ;;
        *) ;;
    esac

    # The second self-check pins what all-digit does not: that depth_value
    # actually pressures hooks/codex-spawn-depth-gate.sh:130's `10#` prefix.
    # It executes the property rather than describing it -- does unprefixed
    # arithmetic on this value either (a) ABORT, as 08/09 do when an octal
    # digit overflows base-8, or (b) SUCCEED but disagree with the
    # 10#-prefixed result, as 010 does? If neither, `10#` is a no-op here.
    # A surface pattern like "has a leading zero" is not equivalent: "07"
    # has one, yet parses to 7 either way.
    #
    # Each probe runs as a SEPARATE `bash -c` subshell, never inline: an
    # inline $((depth_value+1)) on "08" aborts the CURRENT shell under
    # `set -e`, killing this function instead of letting it report a clean
    # FAIL. The value passes as `$1`, not interpolated into the single-quoted
    # script text, so it is never re-parsed as shell syntax.
    local octal_probe_out="" octal_probe_rc=0 decimal_probe_out="" decimal_probe_rc=0
    octal_probe_out=$(/bin/bash -c 'set -euo pipefail; v="$1"; printf "%s" $((v + 1))' _ "$depth_value" 2>/dev/null) || octal_probe_rc=$?
    decimal_probe_out=$(/bin/bash -c 'set -euo pipefail; v="$1"; printf "%s" $((10#$v + 1))' _ "$depth_value" 2>/dev/null) || decimal_probe_rc=$?

    if [ "$octal_probe_rc" -eq 0 ] && [ "$octal_probe_out" = "$decimal_probe_out" ]; then
        echo "ASSERTION FAILED row9-leading-zero: depth_value \"$depth_value\" does not pressure hooks/codex-spawn-depth-gate.sh:130's \`10#\` prefix -- unprefixed arithmetic succeeds (\"$octal_probe_out\") and agrees with the 10#-prefixed decimal result (\"$decimal_probe_out\"); removing the \`10#\` prefix would produce an identical outcome for this fixture"
        result=1
    fi

    rollout=$(mk_rollout "$(printf '{"payload":{"source":{"subagent":{"thread_spawn":{"depth":"%s"}}}}}' "$depth_value")")
    payload=$(jq -n --arg tp "$rollout" '{tool_name:"collaborationspawn_agent", transcript_path:$tp}')

    out=$(printf '%s' "$payload" | run_hook) || rc=$?
    assert_deny "$out" "$rc" "row9-leading-zero" 9 2 || result=1

    rm -rf "$SBX"
    return "$result"
}

test_row9_null_depth_allows() {
    new_sandbox
    local rollout payload out exit_code=0 result=0 stderr_file stdout_file

    rollout=$(mk_rollout '{"payload":{"source":{"subagent":{"thread_spawn":{"depth":null}}}}}')
    payload=$(jq -n --arg tp "$rollout" '{tool_name:"collaborationspawn_agent", transcript_path:$tp}')

    stderr_file="$SBX/stderr.txt"
    stdout_file="$SBX/stdout.txt"
    printf '%s' "$payload" | run_hook >"$stdout_file" 2>"$stderr_file" || exit_code=$?
    out=$(cat "$stdout_file")

    [ "$exit_code" -eq 0 ] || { echo "ASSERTION FAILED row9-null: expected exit 0, got $exit_code"; result=1; }
    [ ! -s "$stdout_file" ] || { echo "ASSERTION FAILED row9-null: expected empty stdout, got '$out'"; result=1; }

    [ ! -s "$stderr_file" ] || { echo "ASSERTION FAILED row9-null: expected empty stderr (fail-open contract forbids diagnostics), got '$(cat "$stderr_file")'"; result=1; }

    rm -rf "$SBX"
    return "$result"
}

test_row9_non_numeric_depth_allows() {
    new_sandbox
    local rollout payload out exit_code=0 result=0 stderr_file stdout_file

    rollout=$(mk_rollout '{"payload":{"source":{"subagent":{"thread_spawn":{"depth":"abc"}}}}}')
    payload=$(jq -n --arg tp "$rollout" '{tool_name:"collaborationspawn_agent", transcript_path:$tp}')

    stderr_file="$SBX/stderr.txt"
    stdout_file="$SBX/stdout.txt"
    printf '%s' "$payload" | run_hook >"$stdout_file" 2>"$stderr_file" || exit_code=$?
    out=$(cat "$stdout_file")

    [ "$exit_code" -eq 0 ] || { echo "ASSERTION FAILED row9-non-numeric: expected exit 0, got $exit_code"; result=1; }
    [ ! -s "$stdout_file" ] || { echo "ASSERTION FAILED row9-non-numeric: expected empty stdout, got '$out'"; result=1; }

    [ ! -s "$stderr_file" ] || { echo "ASSERTION FAILED row9-non-numeric: expected empty stderr (fail-open contract forbids diagnostics), got '$(cat "$stderr_file")'"; result=1; }

    rm -rf "$SBX"
    return "$result"
}

test_row9_negative_depth_allows() {
    new_sandbox
    local rollout payload out exit_code=0 result=0 stderr_file stdout_file

    rollout=$(mk_rollout '{"payload":{"source":{"subagent":{"thread_spawn":{"depth":-1}}}}}')
    payload=$(jq -n --arg tp "$rollout" '{tool_name:"collaborationspawn_agent", transcript_path:$tp}')

    stderr_file="$SBX/stderr.txt"
    stdout_file="$SBX/stdout.txt"
    printf '%s' "$payload" | run_hook >"$stdout_file" 2>"$stderr_file" || exit_code=$?
    out=$(cat "$stdout_file")

    [ "$exit_code" -eq 0 ] || { echo "ASSERTION FAILED row9-negative: expected exit 0, got $exit_code"; result=1; }
    [ ! -s "$stdout_file" ] || { echo "ASSERTION FAILED row9-negative: expected empty stdout, got '$out'"; result=1; }

    [ ! -s "$stderr_file" ] || { echo "ASSERTION FAILED row9-negative: expected empty stderr (fail-open contract forbids diagnostics), got '$(cat "$stderr_file")'"; result=1; }

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
    local rollout payload out rc=0 result=0 lowered payload_tool_name
    # Hoisted into a named local, the same shape rows 7, 9 and 12 use for their
    # own discriminating values. hook-registration_test.sh's matcher check reads
    # this one declaration rather than parsing whatever shape the payload
    # happens to take -- the identity assertion further down is what keeps that
    # reader and the actual payload from drifting apart. Keep exactly one such
    # declaration in this function; that extractor hard-fails on zero or two.
    local tool_name_value="CollaborationSpawn_Agent"

    rollout=$(mk_rollout '{"payload":{"source":{"subagent":{"thread_spawn":{"depth":2}}}}}')
    payload=$(jq -n --arg tp "$rollout" --arg tn "$tool_name_value" '{tool_name:$tn, transcript_path:$tp}')

    # `tee` sits inside the same pipeline, so this file holds the exact bytes
    # run_hook consumed -- not a variable that describes what is about to be
    # sent. Everything below judges THAT. Reading $tool_name_value here instead
    # would only prove the declaration has the right shape, and the declaration
    # is not what the hook sees: a bare reassignment anywhere above (an idiom
    # this file already uses -- see row2's own payload) hands the hook a
    # different name while every check keeps grading the old one.
    out=$(printf '%s' "$payload" | tee "$SBX/hook-stdin.json" | run_hook) || rc=$?
    payload_tool_name=$(jq -r '.tool_name // empty' "$SBX/hook-stdin.json")

    # Mixed-case tool name that only ends in "spawn_agent" AFTER lowercasing
    # -- pins the `tr` call at :84. Removing that line would leave this
    # fixture unmatched (allow) instead of the deny asserted here. Both halves
    # must hold: the ORIGINAL must NOT match the hook's own suffix case
    # `*spawn_agent)` at :86 (or `tr` is a no-op for it), and the LOWERCASED
    # form MUST match (or lowercasing would not help either). Stated in the
    # same `case` syntax the hook uses, against the same bytes the hook read.
    case "$payload_tool_name" in
        *spawn_agent)
            echo "ASSERTION FAILED row10-mixed-case: tool name \"$payload_tool_name\" already matches the hook's suffix case \`*spawn_agent)\` (hooks/codex-spawn-depth-gate.sh:86) BEFORE lowercasing -- the \`tr\` call at :84 is a no-op for it, so this row does not pressure that defense"
            result=1
            ;;
    esac
    lowered=$(printf '%s' "$payload_tool_name" | tr '[:upper:]' '[:lower:]')
    case "$lowered" in
        *spawn_agent) ;;
        *)
            echo "ASSERTION FAILED row10-mixed-case: tool name \"$payload_tool_name\" still does not match \`*spawn_agent)\` AFTER lowercasing -- lowercasing alone would not make this fixture deny, so it does not pressure the \`tr\` defense either"
            result=1
            ;;
    esac

    # The checks above now stand on their own. This one is for the reader that
    # cannot see the payload at all: hook-registration_test.sh scores the
    # DECLARATION against codex.yaml's dispatch matcher, so if the two drift
    # apart it verifies a name this fixture never sends.
    if [ "$payload_tool_name" != "$tool_name_value" ]; then
        echo "ASSERTION FAILED row10-mixed-case: the payload the hook actually read carries tool_name \"$payload_tool_name\", not the declared tool_name_value \"$tool_name_value\" -- hook-registration_test.sh checks codex.yaml's matcher against that declaration, so a payload carrying anything else leaves it grading a name this row never sends"
        result=1
    fi

    assert_deny "$out" "$rc" "row10-mixed-case" 3 2 || result=1

    rm -rf "$SBX"
    return "$result"
}

test_row10_near_miss_tool_name_allows() {
    new_sandbox
    local rollout payload out rc=0 result=0 stderr_file stdout_file

    # "spawn_agent_helper" CONTAINS spawn_agent but does not END with it --
    # pins the suffix anchor (`*spawn_agent`) at :86. Widening that pattern
    # to a substring match (`*spawn_agent*`) would wrongly deny this
    # unrelated tool name.
    stderr_file="$SBX/stderr.txt"
    stdout_file="$SBX/stdout.txt"
    rollout=$(mk_rollout '{"payload":{"source":{"subagent":{"thread_spawn":{"depth":2}}}}}')
    payload=$(jq -n --arg tp "$rollout" '{tool_name:"spawn_agent_helper", transcript_path:$tp}')

    printf '%s' "$payload" | run_hook >"$stdout_file" 2>"$stderr_file" || rc=$?
    out=$(cat "$stdout_file")
    if ! assert_allow "$out" "$rc" "row10-near-miss" "$stderr_file" "$stdout_file"; then result=1; fi

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
# Row 12 -- transcript_path is a RELATIVE filename starting with a dash
# ("-n1"). Without the `--` separator, `head` parses a leading-dash argument
# as an OPTION ("-n1" reads as "show 1 line") rather than a filename, so it
# never opens the rollout, reads its own already-exhausted stdin instead,
# `cur` stays unset, and a depth=2 spawn that must DENY falls through to
# fail-open ALLOW. `head -3 -- "$transcript_path"` ends option parsing and
# closes it.
#
# Both properties this fixture needs -- dash-prefixed AND relative -- are
# asserted in the body below, so drifting off either fails loudly instead of
# quietly ceasing to exercise the bug.
#
# Cannot use mk_rollout here: it writes to the fixed path
# "$SBX/rollout-test.jsonl", which can never start with a dash.
# =============================================================================
test_row12_dash_prefixed_relative_transcript_path_denies() {
    new_sandbox
    local payload out rc=0 result=0 payload_transcript_path
    local transcript_path_value="-n1"

    printf '%s\n' '{"payload":{"source":{"subagent":{"thread_spawn":{"depth":2}}}}}' > "$SBX/-n1"
    payload=$(jq -n --arg tp "$transcript_path_value" '{tool_name:"collaborationspawn_agent", transcript_path:$tp}')

    # cwd must be $SBX while the hook runs -- transcript_path="-n1" is
    # relative, and the hook's `-f` existence check (hooks/codex-spawn-
    # depth-gate.sh:92) resolves it against the caller's cwd, so "-n1" only
    # resolves to the fixture above when invoked from inside $SBX.
    #
    # `tee` shares the pipeline, so this file holds the exact bytes the hook
    # read. The checks below judge that path rather than the variable it was
    # assembled from: a bare reassignment between the two -- to an absolute
    # path, say -- would leave them approving a fixture that no longer
    # pressures anything, which is measurably how they behaved when they read
    # the variable.
    out=$(cd "$SBX" && printf '%s' "$payload" | tee "$SBX/hook-stdin.json" | run_hook) || rc=$?
    payload_transcript_path=$(jq -r '.transcript_path // empty' "$SBX/hook-stdin.json")

    # An absolute path can never be misread as a head(1) option, and a name
    # with no leading dash never triggers the misread at all -- either drift
    # leaves assert_deny passing for its own unrelated reason.
    case "$payload_transcript_path" in
        -*) ;;
        *) echo "ASSERTION FAILED row12: transcript_path \"$payload_transcript_path\" in the payload the hook read must start with a dash to pressure head(1)'s option-parsing misread"; result=1 ;;
    esac
    case "$payload_transcript_path" in
        /*) echo "ASSERTION FAILED row12: transcript_path \"$payload_transcript_path\" in the payload the hook read must be a RELATIVE path -- an absolute path can never be misread as a head(1) option, so it stops exercising the bug this row exists to catch"; result=1 ;;
        *) ;;
    esac

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
# Row 13b -- depth on the rollout file's 3RD line, the EXACT boundary of the
# `head -3` window at hooks/codex-spawn-depth-gate.sh:116. Row 13 above (depth
# on line 2) and row 14 below (depth on line 4) bracket this window but never
# land ON it -- reducing the hook's `head -3` to `head -2` leaves row 13
# (still inside a 2-line window) and row 14 (already outside a 3-line window)
# both unaffected, so that one-character mutation passes the suite green
# while silently losing the scan's actual boundary line -- the same
# tests-pass-while-the-cap-is-gone shape this file's header warns about.
# Two non-empty, valid-JSON filler lines (matching row 13's own filler
# requirement -- a blank filler would skip the loop's `read` iteration
# entirely via the `[ -n "$line" ] || continue` guard at :110, without
# pressuring anything) put the real depth on line 3, still inside `head -3`.
# =============================================================================
test_row13b_depth_on_third_line_scan_boundary_denies() {
    new_sandbox
    local rollout payload out rc=0 result=0

    rollout=$(mk_rollout \
        '{"payload":{"source":{}}}' \
        '{"payload":{"source":{}}}' \
        '{"payload":{"source":{"subagent":{"thread_spawn":{"depth":2}}}}}')
    payload=$(jq -n --arg tp "$rollout" '{tool_name:"collaborationspawn_agent", transcript_path:$tp}')

    out=$(printf '%s' "$payload" | run_hook) || rc=$?
    assert_deny "$out" "$rc" "row13b-depth-on-line3-boundary" 3 2 || result=1

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
#
# If the scan window is ever WIDENED (e.g. `head -3` -> `head -4` or beyond)
# -- a change strictly SAFER for this fail-open-biased gate, since widening
# can only turn a false-allow into a correct catch, never the reverse -- this
# fixture will flip from ALLOW to DENY and this test will go red. That red is
# NOT a regression to chase: re-point this fixture's filler-line count (or
# retire it) to sit one line past whatever the new window is, rather than
# reverting the widening to keep this test green.
# =============================================================================
test_row14_depth_on_fourth_line_beyond_scan_window_allows() {
    new_sandbox
    local rollout payload out rc=0 result=0 stderr_file stdout_file

    stderr_file="$SBX/stderr.txt"
    stdout_file="$SBX/stdout.txt"
    rollout=$(mk_rollout \
        '{"payload":{"source":{}}}' \
        '{"payload":{"source":{}}}' \
        '{"payload":{"source":{}}}' \
        '{"payload":{"source":{"subagent":{"thread_spawn":{"depth":2}}}}}')
    payload=$(jq -n --arg tp "$rollout" '{tool_name:"collaborationspawn_agent", transcript_path:$tp}')

    printf '%s' "$payload" | run_hook >"$stdout_file" 2>"$stderr_file" || rc=$?
    out=$(cat "$stdout_file")
    if ! assert_allow "$out" "$rc" "row14-depth-on-line4-beyond-window" "$stderr_file" "$stdout_file"; then result=1; fi

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
    run_test test_row13b_depth_on_third_line_scan_boundary_denies
    run_test test_row14_depth_on_fourth_line_beyond_scan_window_allows

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [ "$TESTS_FAILED" -gt 0 ]; then
        exit 1
    fi
}

main "$@"

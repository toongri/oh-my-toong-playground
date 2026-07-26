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
#   6. stderr is EMPTY. The contract is categorical -- no path may emit a
#      diagnostic -- and the deny branch is a path. assert_allow judged this
#      from the start; this helper did not, so a diagnostic added beside the
#      deny envelope shipped green. Requiring the file rather than defaulting
#      to "skip when absent" is what makes every deny site inherit the check.
#   5. stdout is EXACTLY one JSON object. `jq -e` over a multi-object stream
#      reports only the LAST value's status, so noise emitted ahead of the
#      real envelope is invisible to checks 1-4 while Codex, which parses
#      this stdout as a single verdict, fails outright.
assert_deny() {
    local out="$1" rc="$2" label="$3" expected_child="$4" expected_cap="$5"
    local stderr_file="$6"
    local result=0 reason obj_count

    if [ -z "$stderr_file" ] || [ ! -e "$stderr_file" ]; then
        echo "ASSERTION FAILED $label: no captured stderr file was passed (\"$stderr_file\") -- the silence half of the deny envelope cannot be judged, so this call pins a weaker contract than every other deny site"
        result=1
    elif [ -s "$stderr_file" ]; then
        echo "ASSERTION FAILED $label: expected empty stderr on the deny path too (the contract forbids a diagnostic on ANY path), got '$(cat "$stderr_file")'"
        result=1
    fi

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

# The hook's rollout scan window, READ FROM THE HOOK's own `head -N` call
# rather than hardcoded. Every helper and row below that reasons about where a
# depth sits relative to that window gets it from here, so a window change
# moves them all together instead of leaving each one quietly measuring against
# a stale 3. Prints nothing unless the hook carries exactly one such call --
# zero and two-or-more are equally unusable, and every caller treats empty as a
# hard failure.
hook_scan_window() {
    local windows count
    # Matched WITHOUT the `--` separator on purpose: row12 pins that separator,
    # and a window read that also depended on it would turn row12's own
    # mutation into a suite-wide failure and stop identifying anything.
    windows=$(grep -oE 'head -[0-9]+' "$HOOK" | sed -E 's/head -([0-9]+)/\1/')
    count=$(printf '%s\n' "$windows" | grep -c . || true)
    [ "$count" -eq 1 ] || return 0
    printf '%s' "$windows"
}

# The depth the hook actually saw: follow the captured stdin's transcript_path
# to the rollout it names, and read the value the hook's own scan would have
# stopped on -- inside the same window, first match wins.
#
# The window is not optional. Reading the whole file instead returns a depth
# sitting PAST the window, which the hook never reaches (it defaults to cur=0
# there). On a DENY-expecting row assert_deny catches the divergence, but on an
# ALLOW-expecting row the hook's default IS the expected outcome, so the row
# stays green while its self-check grades a value the hook never read --
# measured on row7, whose self-check is the only thing pinning `-gt`, and whose
# missed regression is a false DENY this hook offers no bypass to recover from.
#
# A fixture asserting something about its own discriminating value must assert
# it against THIS, never against the variable the fixture was assembled from.
# The variable only describes what was meant to be sent; a bare reassignment
# between the assertion and the payload build splits the two apart, and nothing
# notices.
# Mirrors the hook's own tool-name short-circuit. Every rollout-reading helper
# below must call this first: the hook only ever opens the rollout for a name
# that survives this gate, so a helper that skips it reports on a code path the
# hook never entered -- and the row it feeds then passes for a reason unrelated
# to the defense it claims to pin.
hook_reached_rollout() {
    local stdin_file="$1" tool_name
    tool_name=$(jq -r '.tool_name // empty' "$stdin_file" 2>/dev/null) || tool_name=""
    tool_name=$(printf '%s' "$tool_name" | tr '[:upper:]' '[:lower:]')
    case "$tool_name" in
        *spawn_agent) return 0 ;;
        *) return 1 ;;
    esac
}

# The payload-axis sibling of hook_reached_rollout: reports whether the stdin
# the hook was handed is genuinely unindexable by the hook's own jq. Every
# other helper here starts by resolving `.transcript_path` out of that stdin,
# which is structurally impossible for a payload that does not parse -- so this
# is the only shape that can grade a payload-axis fixture at all. Exit 0 =
# unindexable.
hook_stdin_unindexable() {
    local stdin_file="$1"
    jq -r '.tool_name // empty' "$stdin_file" >/dev/null 2>&1 && return 1
    return 0
}

hook_saw_depth() {
    local stdin_file="$1" tp window line depth
    hook_reached_rollout "$stdin_file" || return 0
    tp=$(jq -r '.transcript_path // empty' "$stdin_file" 2>/dev/null) || tp=""
    [ -n "$tp" ] || return 0
    window=$(hook_scan_window)
    [ -n "$window" ] || return 0
    # One jq PER LINE, and the WHOLE substitution result -- exactly what the
    # hook assigns to `cur`. Streaming the window through a single jq and
    # taking `head -1` is a different predicate: a physical line carrying two
    # JSON values makes the hook see a two-line non-numeric value (so it falls
    # back to 0), while the stream form reports the first number and lands a
    # boundary check the hook is not actually standing on.
    while IFS= read -r line || [ -n "$line" ]; do
        [ -n "$line" ] || continue
        depth=$(printf '%s' "$line" | jq -r '.payload.source.subagent.thread_spawn.depth // empty' 2>/dev/null) || depth=""
        if [ -n "$depth" ]; then
            printf '%s' "$depth"
            return 0
        fi
    done < <(head -"$window" -- "$tp" 2>/dev/null || true)
}

# 1-based index of the first rollout line carrying a depth, read from the file
# the hook was actually handed. Rows 13, 13b and 14 differ ONLY in where their
# depth sits relative to the scan window, and that placement is the whole of
# their discriminating power -- so each asserts it here rather than trusting
# the argument list it passed to mk_rollout. Scans the whole file on purpose:
# row14's property is that its depth sits one line PAST the window.
# Reports whether the hook's per-line jq actually FAILED on a line its scan
# loop reached -- the only condition under which the `|| depth=""` recovery
# beside it runs at all. Mirrors that loop exactly (same window, one line at a
# time, stop at the first depth) because every coarser predicate disagrees
# with it somewhere: `jq -e .` measures truthiness, so a bare `null` line is
# valid JSON that still exits non-zero, and a garbage line sitting after the
# one the loop breaks on is never processed. Exit 0 = the recovery was
# pressured.
hook_recovery_pressured() {
    local stdin_file="$1" tp window line depth pressured=1
    hook_reached_rollout "$stdin_file" || return 1
    tp=$(jq -r '.transcript_path // empty' "$stdin_file" 2>/dev/null) || tp=""
    [ -n "$tp" ] || return 1
    window=$(hook_scan_window)
    [ -n "$window" ] || return 1
    while IFS= read -r line || [ -n "$line" ]; do
        [ -n "$line" ] || continue
        if depth=$(printf '%s' "$line" | jq -r '.payload.source.subagent.thread_spawn.depth // empty' 2>/dev/null); then
            if [ -n "$depth" ]; then break; fi
        else
            pressured=0
        fi
    done < <(head -"$window" -- "$tp" 2>/dev/null || true)
    return "$pressured"
}

rollout_depth_line() {
    local stdin_file="$1" tp n=0 line depth
    hook_reached_rollout "$stdin_file" || return 0
    tp=$(jq -r '.transcript_path // empty' "$stdin_file" 2>/dev/null) || tp=""
    [ -n "$tp" ] || return 0
    while IFS= read -r line || [ -n "$line" ]; do
        n=$((n + 1))
        [ -n "$line" ] || continue
        depth=$(printf '%s' "$line" | jq -r '.payload.source.subagent.thread_spawn.depth // empty' 2>/dev/null) || depth=""
        if [ -n "$depth" ]; then
            printf '%s' "$n"
            return 0
        fi
    done < "$tp"
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

    # Both names above are short-circuited before the depth is ever read, so
    # this row pins that short-circuit only while the rollout it carries would
    # otherwise DENY. Positive control through the real hook rather than a
    # claim about the fixture text: drop that rollout's depth by one and both
    # names still allow, for a reason that has nothing to do with the gate.
    rc=0
    payload=$(jq -n --arg tp "$rollout" '{tool_name:"collaborationspawn_agent", transcript_path:$tp}')
    printf '%s' "$payload" | run_hook >"$stdout_file" 2>"$stderr_file" || rc=$?
    out=$(cat "$stdout_file")
    assert_deny "$out" "$rc" "row2-control-spawning-name" 3 2 "$stderr_file" || result=1

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

    printf '%s' "$payload" | tee "$SBX/hook-stdin.json" | run_hook >"$stdout_file" 2>"$stderr_file" || rc=$?
    out=$(cat "$stdout_file")

    # The `|| depth=""` recovery beside the hook's per-line jq only runs when
    # that jq FAILS, so this row pins it only while the rollout the hook read
    # actually makes it fail -- inside the hook's own scan window, on a line
    # the loop reaches. Graded with the hook's own predicate rather than a
    # coarser stand-in; hook_recovery_pressured names the ones that disagree.
    if ! hook_recovery_pressured "$SBX/hook-stdin.json"; then
        echo "ASSERTION FAILED row5-invalid-json: the rollout the hook read never made its per-line jq fail on a line inside the scan window -- this row only pins that recovery while it does"
        result=1
    fi

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
    local rollout payload out rc=0 result=0 stderr_file stdout_file hook_depth
    local depth_value=1

    stderr_file="$SBX/stderr.txt"
    stdout_file="$SBX/stdout.txt"
    rollout=$(mk_rollout "$(printf '{"payload":{"source":{"subagent":{"thread_spawn":{"depth":%s}}}}}' "$depth_value")")
    payload=$(jq -n --arg tp "$rollout" '{tool_name:"collaborationspawn_agent", transcript_path:$tp}')

    printf '%s' "$payload" | tee "$SBX/hook-stdin.json" | run_hook >"$stdout_file" 2>"$stderr_file" || rc=$?
    out=$(cat "$stdout_file")
    hook_depth=$(hook_saw_depth "$SBX/hook-stdin.json")

    # Self-check: this row is the ONLY fixture in this suite that pins
    # hooks/codex-spawn-depth-gate.sh:135's `-gt` comparator specifically
    # (row8 denies under both `-gt` and a mutated `-ge`, so it cannot tell
    # them apart). That power rests entirely on the child of the depth the
    # hook was actually handed landing EXACTLY on CAP -- only at that exact
    # boundary do `-gt` (child > CAP is false -> allow) and `-ge` (child >= CAP
    # is true -> deny) actually disagree; anywhere else both comparators agree
    # and this row cannot discriminate between them. Graded against the value
    # read back out of the rollout the hook read, never against depth_value:
    # see hook_saw_depth for why the variable is not a safe stand-in.
    #
    # CAP is READ FROM THE HOOK, not hardcoded. The other cap literals here
    # (row8's `assert_deny ... 3 2`, row9's `... 9 2`) drift LOUDLY -- bump
    # the hook's CAP and they go red, and red is a repair instruction. A
    # hardcoded 2 in THIS check would drift silently instead: it keeps passing
    # through the CAP change AND through the repair that follows, which moves
    # the fixture's child off the boundary and quietly ends this row's ability
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
    case "$hook_depth" in
        '' | *[!0-9]*)
            echo "ASSERTION FAILED row7-depth-1: read no usable depth (\"$hook_depth\") out of the rollout named by the payload the hook was handed -- the boundary check has nothing to grade, so this row cannot claim to pin \`-gt\`"
            result=1
            ;;
        *)
            if [ "$((hook_depth + 1))" -ne "$expected_cap" ]; then
                echo "ASSERTION FAILED row7-depth-1: the depth the hook read ($hook_depth) has child $((hook_depth + 1)), which must equal CAP ($expected_cap) exactly -- only at that boundary do hooks/codex-spawn-depth-gate.sh:135's \`-gt\` (allow) and a mutated \`-ge\` (deny) actually disagree; this row cannot pin \`-gt\` specifically otherwise"
                result=1
            fi
            ;;
    esac

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
    local rollout payload out rc=0 result=0 stderr_file

    rollout=$(mk_rollout '{"payload":{"source":{"subagent":{"thread_spawn":{"depth":2}}}}}')
    payload=$(jq -n --arg tp "$rollout" '{tool_name:"collaborationspawn_agent", transcript_path:$tp}')

    stderr_file="$SBX/stderr.txt"
    out=$(printf '%s' "$payload" | run_hook 2>"$stderr_file") || rc=$?
    # See assert_deny's own docstring for what each of its five checks pins
    # and why a bare grep over the whole JSON blob would not be enough.
    assert_deny "$out" "$rc" "row8-depth-2" 3 2 "$stderr_file" || result=1

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
    local rollout payload out rc=0 result=0 hook_depth stderr_file
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

    rollout=$(mk_rollout "$(printf '{"payload":{"source":{"subagent":{"thread_spawn":{"depth":"%s"}}}}}' "$depth_value")")
    payload=$(jq -n --arg tp "$rollout" '{tool_name:"collaborationspawn_agent", transcript_path:$tp}')

    stderr_file="$SBX/stderr.txt"
    out=$(printf '%s' "$payload" | tee "$SBX/hook-stdin.json" | run_hook 2>"$stderr_file") || rc=$?
    hook_depth=$(hook_saw_depth "$SBX/hook-stdin.json")

    # Two self-checks below, both graded against the depth the hook was
    # actually handed rather than depth_value -- see hook_saw_depth for why the
    # variable is not a safe stand-in. The first pins all-digit, which is what
    # tells this row apart from row9-non-numeric (a different code path that
    # legitimately falls through to cur=0/allow).
    case "$hook_depth" in
        '' | *[!0-9]*) echo "ASSERTION FAILED row9-leading-zero: the depth the hook read (\"$hook_depth\") must be all-digit -- this row exists to prove well-formed all-digit input no longer crashes on octal misread, not that malformed input is rejected"; result=1 ;;
        *) ;;
    esac

    # The second self-check pins what all-digit does not: that the value the
    # hook read actually pressures hooks/codex-spawn-depth-gate.sh:130's `10#`
    # prefix. It executes the property rather than describing it -- does
    # unprefixed arithmetic on this value either (a) ABORT, as 08/09 do when an
    # octal digit overflows base-8, or (b) SUCCEED but disagree with the
    # 10#-prefixed result, as 010 does? If neither, `10#` is a no-op here.
    # A surface pattern like "has a leading zero" is not equivalent: "07"
    # has one, yet parses to 7 either way.
    #
    # Each probe runs as a SEPARATE `bash -c` subshell, never inline: an
    # inline $((hook_depth+1)) on "08" aborts the CURRENT shell under
    # `set -e`, killing this function instead of letting it report a clean
    # FAIL. The value passes as `$1`, not interpolated into the single-quoted
    # script text, so it is never re-parsed as shell syntax.
    local octal_probe_out="" octal_probe_rc=0 decimal_probe_out="" decimal_probe_rc=0
    octal_probe_out=$(/bin/bash -c 'set -euo pipefail; v="$1"; printf "%s" $((v + 1))' _ "$hook_depth" 2>/dev/null) || octal_probe_rc=$?
    decimal_probe_out=$(/bin/bash -c 'set -euo pipefail; v="$1"; printf "%s" $((10#$v + 1))' _ "$hook_depth" 2>/dev/null) || decimal_probe_rc=$?

    if [ "$octal_probe_rc" -eq 0 ] && [ "$octal_probe_out" = "$decimal_probe_out" ]; then
        echo "ASSERTION FAILED row9-leading-zero: the depth the hook read (\"$hook_depth\") does not pressure hooks/codex-spawn-depth-gate.sh:130's \`10#\` prefix -- unprefixed arithmetic succeeds (\"$octal_probe_out\") and agrees with the 10#-prefixed decimal result (\"$decimal_probe_out\"); removing the \`10#\` prefix would produce an identical outcome for this fixture"
        result=1
    fi

    assert_deny "$out" "$rc" "row9-leading-zero" 9 2 "$stderr_file" || result=1

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
    printf '%s' "$payload" | tee "$SBX/hook-stdin.json" | run_hook >"$stdout_file" 2>"$stderr_file" || exit_code=$?
    out=$(cat "$stdout_file")

    # This row pins the non-numeric branch of the guard at :126, and only
    # while the depth the hook read is a non-digit form that a dash-only
    # guard (`-*`) would miss. Graded against the value read back out of the
    # rollout the hook read: a fixture quietly changed to "-1" still allows,
    # under the narrowed guard just as under the full one.
    local hook_depth
    hook_depth=$(hook_saw_depth "$SBX/hook-stdin.json")
    case "$hook_depth" in
        '' | -*)
            echo "ASSERTION FAILED row9-non-numeric: the depth the hook read (\"$hook_depth\") is empty or dash-prefixed -- this row only discriminates while it is a non-digit form a dash-only guard would let through"
            result=1
            ;;
        *[!0-9]*) ;;
        *)
            echo "ASSERTION FAILED row9-non-numeric: the depth the hook read (\"$hook_depth\") is all digits -- this row pins the non-numeric branch and cannot do so with a numeric fixture"
            result=1
            ;;
    esac

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
    local rollout payload out rc=0 result=0 lowered payload_tool_name matcher stderr_file
    # Hoisted into a named local, the same shape rows 7, 9 and 12 use for their
    # own discriminating values. Nothing outside this function reads it: every
    # check below grades the bytes the hook received, so the name is free to
    # change here without any sibling file needing to agree.
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
    stderr_file="$SBX/stderr.txt"
    out=$(printf '%s' "$payload" | tee "$SBX/hook-stdin.json" | run_hook 2>"$stderr_file") || rc=$?
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

    # The hook body's `tr` defense only ever runs on calls codex.yaml's
    # dispatch matcher already admitted -- it is a full-string regex applied
    # before the hook starts. So a deny asserted here is unreachable at runtime
    # unless that matcher full-matches the name this row sends. Evaluated HERE,
    # against the bytes actually sent: a sibling file scoring the matcher
    # against a declaration parsed out of this one grades a string the payload
    # need not carry, which was measured green on both suites while row10 sent
    # an ALL-CAPS name the matcher rejects.
    matcher=$(grep -A2 'component: codex-spawn-depth-gate.sh' "$SCRIPT_DIR/../codex.yaml" | grep 'matcher:' | sed -E 's/^[[:space:]]*matcher:[[:space:]]*"(.*)"[[:space:]]*$/\1/')
    if [ -z "$matcher" ]; then
        echo "ASSERTION FAILED row10-mixed-case: could not read the codex-spawn-depth-gate.sh matcher out of codex.yaml's PreToolUse block -- cannot verify the dispatch gate ever reaches the name this row sends"
        result=1
    elif ! printf '%s\n' "$payload_tool_name" | grep -qE "^${matcher}\$"; then
        echo "ASSERTION FAILED row10-mixed-case: codex.yaml's matcher \"$matcher\" does not full-match \"$payload_tool_name\", the tool name this row actually sent -- the dispatch gate would reject the call before the hook's \`tr\` lowercasing (hooks/codex-spawn-depth-gate.sh:84) is ever reached, so the deny asserted below could not happen at runtime"
        result=1
    fi

    assert_deny "$out" "$rc" "row10-mixed-case" 3 2 "$stderr_file" || result=1

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

    printf '%s' "$payload" | tee "$SBX/hook-stdin.json" | run_hook >"$stdout_file" 2>"$stderr_file" || rc=$?
    out=$(cat "$stdout_file")

    # The suffix anchor is pinned only while the name the hook RECEIVED
    # contains spawn_agent without ending in it. Read back off the captured
    # stdin: a fixture drifted to an unrelated name allows under `*spawn_agent`
    # and `*spawn_agent*` alike, and this row stops telling the two apart.
    local payload_tool_name
    payload_tool_name=$(jq -r '.tool_name // empty' "$SBX/hook-stdin.json" 2>/dev/null)
    case "$payload_tool_name" in
        *spawn_agent)
            echo "ASSERTION FAILED row10-near-miss: the tool name the hook received (\"$payload_tool_name\") ENDS with spawn_agent -- a near miss must not, or it exercises the anchor's match side instead of its boundary"
            result=1
            ;;
        *spawn_agent*) ;;
        *)
            echo "ASSERTION FAILED row10-near-miss: the tool name the hook received (\"$payload_tool_name\") does not contain spawn_agent at all -- it is then allowed by the suffix anchor and a substring widening alike, so this row pins neither"
            result=1
            ;;
    esac

    if ! assert_allow "$out" "$rc" "row10-near-miss" "$stderr_file" "$stdout_file"; then result=1; fi

    # Same control row2 carries: a near miss tells the suffix anchor apart from
    # a substring widening only while the rollout it sends would DENY once a
    # qualifying name reaches the depth logic. Graded through the real hook on
    # that same rollout, not claimed about the fixture text.
    rc=0
    payload=$(jq -n --arg tp "$rollout" '{tool_name:"collaborationspawn_agent", transcript_path:$tp}')
    printf '%s' "$payload" | run_hook >"$stdout_file" 2>"$stderr_file" || rc=$?
    out=$(cat "$stdout_file")
    assert_deny "$out" "$rc" "row10-near-miss-control" 3 2 "$stderr_file" || result=1

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
    local rollout payload out rc=0 result=0 stderr_file

    # Cannot use mk_rollout here -- it always appends a trailing newline via
    # `printf '%s\n'`, which would never exercise the `|| [ -n "$line" ]`
    # guard this test exists to pin. Writes the fixture directly with
    # `printf '%s'` (no trailing newline) instead.
    rollout="$SBX/rollout-test.jsonl"
    printf '%s' '{"payload":{"source":{"subagent":{"thread_spawn":{"depth":2}}}}}' > "$rollout"

    payload=$(jq -n --arg tp "$rollout" '{tool_name:"collaborationspawn_agent", transcript_path:$tp}')

    stderr_file="$SBX/stderr.txt"
    out=$(printf '%s' "$payload" | tee "$SBX/hook-stdin.json" | run_hook 2>"$stderr_file") || rc=$?

    # This row is the ONLY one pinning the `|| [ -n "$line" ]` guard at :109,
    # and that rests entirely on the rollout's last line having no terminating
    # newline. Read the byte back off the file the hook was handed, never off
    # the printf above: with a trailing newline `read` succeeds unaided, the
    # guard becomes dead code, and this row stays green while a mid-flush
    # rollout carrying depth 2 is silently allowed past the cap.
    # The file's last byte alone is NOT the property: the loop breaks at the
    # first depth it finds, so a newline-terminated depth on line 1 followed
    # by an unterminated depth-less line 2 keeps the byte check green while
    # the guard is never reached. The depth must sit on that unterminated last
    # line. Both halves read back off the file the hook was handed.
    local tp last_byte depth_line total_lines
    tp=$(jq -r '.transcript_path // empty' "$SBX/hook-stdin.json" 2>/dev/null)
    last_byte=$(tail -c1 "$tp" 2>/dev/null | od -An -tx1 | tr -d ' \n')
    depth_line=$(rollout_depth_line "$SBX/hook-stdin.json")
    total_lines=$(awk 'END{print NR}' "$tp" 2>/dev/null) || total_lines=""
    if [ -z "$tp" ] || [ "$last_byte" = "0a" ]; then
        echo "ASSERTION FAILED row11-no-trailing-newline: the rollout the hook read (\"$tp\") ends with byte \"$last_byte\" -- it must NOT be 0a, or \`read\` succeeds unaided and this row stops pinning the guard entirely"
        result=1
    elif [ -z "$depth_line" ] || [ -z "$total_lines" ] || [ "$depth_line" -ne "$total_lines" ]; then
        echo "ASSERTION FAILED row11-no-trailing-newline: the depth sits on line \"$depth_line\" of \"$total_lines\" -- it must be on the unterminated LAST line, or the scan loop breaks before ever reaching the guard"
        result=1
    fi

    assert_deny "$out" "$rc" "row11-no-trailing-newline" 3 2 "$stderr_file" || result=1

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
    local payload out rc=0 result=0 payload_transcript_path stderr_file
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
    stderr_file="$SBX/stderr.txt"
    out=$(cd "$SBX" && printf '%s' "$payload" | tee "$SBX/hook-stdin.json" | run_hook 2>"$stderr_file") || rc=$?
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

    assert_deny "$out" "$rc" "row12-dash-prefixed" 3 2 "$stderr_file" || result=1

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
    local rollout payload out rc=0 result=0 depth_line window stderr_file

    rollout=$(mk_rollout \
        '{"payload":{"source":{}}}' \
        '{"payload":{"source":{"subagent":{"thread_spawn":{"depth":2}}}}}')
    payload=$(jq -n --arg tp "$rollout" '{tool_name:"collaborationspawn_agent", transcript_path:$tp}')

    stderr_file="$SBX/stderr.txt"
    out=$(printf '%s' "$payload" | tee "$SBX/hook-stdin.json" | run_hook 2>"$stderr_file") || rc=$?

    # This row pins the scan loop's ability to look past line 1, and that rests
    # entirely on its depth NOT being on line 1 -- there it would survive every
    # narrowing and pin nothing. Read back off the rollout the hook was handed
    # rather than off the argument list above. Only the lower bound is asserted:
    # row13b and row14 own the window edges, and adding an upper bound here
    # would make every window change fail three rows instead of the two whose
    # placement actually broke.
    depth_line=$(rollout_depth_line "$SBX/hook-stdin.json")
    window=$(hook_scan_window)
    if [ -z "$depth_line" ] || [ -z "$window" ] || [ "$depth_line" -le 1 ]; then
        echo "ASSERTION FAILED row13-depth-on-line2: the depth in the rollout the hook read sits on line \"$depth_line\" (hook scan window \"$window\") -- on line 1 this row survives any narrowing of that window and stops pinning the multi-line scan at all"
        result=1
    fi

    assert_deny "$out" "$rc" "row13-depth-on-line2" 3 2 "$stderr_file" || result=1

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
    local rollout payload out rc=0 result=0 depth_line window stderr_file

    rollout=$(mk_rollout \
        '{"payload":{"source":{}}}' \
        '{"payload":{"source":{}}}' \
        '{"payload":{"source":{"subagent":{"thread_spawn":{"depth":2}}}}}')
    payload=$(jq -n --arg tp "$rollout" '{tool_name:"collaborationspawn_agent", transcript_path:$tp}')

    stderr_file="$SBX/stderr.txt"
    out=$(printf '%s' "$payload" | tee "$SBX/hook-stdin.json" | run_hook 2>"$stderr_file") || rc=$?

    # This row is the only one whose allow/deny VERDICT flips on a narrowing to
    # `head -2` -- row13 still sits inside a 2-line window and row14 is already
    # outside one. That power lasts exactly as long as its depth sits on the
    # LAST line the window still reaches, so the placement is asserted rather
    # than assumed, against the rollout the hook was handed and the hook's own
    # window. (A widening leaves this row's verdict green; the check below is
    # what reports it, naming both numbers.)
    depth_line=$(rollout_depth_line "$SBX/hook-stdin.json")
    window=$(hook_scan_window)
    if [ -z "$depth_line" ] || [ -z "$window" ] || [ "$depth_line" -ne "$window" ]; then
        echo "ASSERTION FAILED row13b-depth-on-line3-boundary: the depth in the rollout the hook read sits on line \"$depth_line\" but the hook's scan window is \"$window\" -- this row only pins that window's lower edge while the two are equal, and it is the only row that pins it at all"
        result=1
    fi

    assert_deny "$out" "$rc" "row13b-depth-on-line3-boundary" 3 2 "$stderr_file" || result=1

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
    local rollout payload out rc=0 result=0 stderr_file stdout_file depth_line window

    stderr_file="$SBX/stderr.txt"
    stdout_file="$SBX/stdout.txt"
    rollout=$(mk_rollout \
        '{"payload":{"source":{}}}' \
        '{"payload":{"source":{}}}' \
        '{"payload":{"source":{}}}' \
        '{"payload":{"source":{"subagent":{"thread_spawn":{"depth":2}}}}}')
    payload=$(jq -n --arg tp "$rollout" '{tool_name:"collaborationspawn_agent", transcript_path:$tp}')

    printf '%s' "$payload" | tee "$SBX/hook-stdin.json" | run_hook >"$stdout_file" 2>"$stderr_file" || rc=$?
    out=$(cat "$stdout_file")

    # This row is the only one whose allow/deny VERDICT flips on a WIDENING of
    # the scan window -- every other multi-line fixture keeps denying when the
    # window grows. That power lasts exactly as long as its depth sits one line
    # PAST the window: further out and a widening by one would no longer reach
    # it either. (A narrowing leaves this row's verdict green; the check below
    # is what reports it, naming both numbers.)
    depth_line=$(rollout_depth_line "$SBX/hook-stdin.json")
    window=$(hook_scan_window)
    if [ -z "$depth_line" ] || [ -z "$window" ] || [ "$depth_line" -ne "$((window + 1))" ]; then
        echo "ASSERTION FAILED row14-depth-on-line4-beyond-window: the depth in the rollout the hook read sits on line \"$depth_line\" but the hook's scan window is \"$window\", so it must sit on line $((window + 1)) -- this row only pins that window's upper edge from exactly one line past it, and it is the only row that pins it at all"
        result=1
    fi

    if ! assert_allow "$out" "$rc" "row14-depth-on-line4-beyond-window" "$stderr_file" "$stdout_file"; then result=1; fi

    rm -rf "$SBX"
    return "$result"
}

# =============================================================================
# Row 15 -- stdin the hook's own jq cannot index. Its `|| tool_name_raw=""`
# recovery absorbs that and falls through to the tool-name short-circuit;
# delete it and the failing substitution aborts the hook under `set -e` for
# exit 5, which codex reads as a DENY. That is the fail-CLOSED direction the
# contract rules out -- no path may produce a non-zero exit or stderr output.
#
# Every other fixture in this file corrupts the ROLLOUT axis and builds its
# stdin with `jq -n`, so nothing pinned the PAYLOAD axis at all. Two shapes,
# because the exposure is not only a truncated write: any valid-JSON
# NON-object payload takes the identical path.
# =============================================================================
test_row15_unindexable_stdin_payload_allows() {
    new_sandbox
    local out rc result=0 stderr_file stdout_file shape

    stderr_file="$SBX/stderr.txt"
    stdout_file="$SBX/stdout.txt"
    for shape in '{"tool_name":' '[1,2]'; do
        rc=0
        printf '%s' "$shape" | tee "$SBX/hook-stdin.json" | run_hook >"$stdout_file" 2>"$stderr_file" || rc=$?
        out=$(cat "$stdout_file")

        # Graded against the bytes the hook was handed, not the loop variable:
        # a fixture drifted to any indexable object (indistinguishable at a
        # glance from row2's payload) leaves this row green while it pins
        # nothing, and it is the sole pin for the stdin-parse recovery.
        if ! hook_stdin_unindexable "$SBX/hook-stdin.json"; then
            echo "ASSERTION FAILED row15-unindexable-stdin ($shape): the stdin the hook was handed IS indexable by its own jq -- this row only pins the stdin-parse recovery while it is not"
            result=1
        fi

        if ! assert_allow "$out" "$rc" "row15-unindexable-stdin ($shape)" "$stderr_file" "$stdout_file"; then result=1; fi
    done

    rm -rf "$SBX"
    return "$result"
}

# =============================================================================
# Row 16 -- a rollout that EXISTS but cannot be read. The hook's header
# enumerates five fail-open causes (jq absent, no transcript_path, missing
# file, unparseable rollout JSON, non-numeric depth); this is the sixth, and
# the `2>/dev/null` on the head call is what keeps it silent. Deleting that
# suppression left every other row green while the hook printed `head:
# Permission denied` on a fail-open path -- the one thing the contract says no
# path may do.
# =============================================================================
test_row16_unreadable_rollout_file_allows() {
    new_sandbox
    local rollout payload out rc=0 result=0 stderr_file stdout_file unreadable

    stderr_file="$SBX/stderr.txt"
    stdout_file="$SBX/stdout.txt"
    rollout=$(mk_rollout '{"payload":{"source":{"subagent":{"thread_spawn":{"depth":2}}}}}')
    chmod 000 "$rollout"
    payload=$(jq -n --arg tp "$rollout" '{tool_name:"collaborationspawn_agent", transcript_path:$tp}')

    printf '%s' "$payload" | run_hook >"$stdout_file" 2>"$stderr_file" || rc=$?
    out=$(cat "$stdout_file")

    # Read the property back BEFORE restoring the mode. The depth-2 fixture
    # means a readable file denies, so `assert_allow` alone would catch a lost
    # chmod -- but not a lost chmod paired with a fixture drifted below the
    # cap, which is the shape this row exists to survive.
    unreadable=0
    [ -r "$rollout" ] || unreadable=1
    chmod 644 "$rollout"
    if [ "$unreadable" -ne 1 ]; then
        echo "ASSERTION FAILED row16-unreadable-rollout: the rollout the hook was handed is READABLE -- this row only pins the head stderr suppression while it is not"
        result=1
    fi

    if ! assert_allow "$out" "$rc" "row16-unreadable-rollout" "$stderr_file" "$stdout_file"; then result=1; fi

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
    run_test test_row15_unindexable_stdin_payload_allows
    run_test test_row16_unreadable_rollout_file_allows

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [ "$TESTS_FAILED" -gt 0 ]; then
        exit 1
    fi
}

main "$@"

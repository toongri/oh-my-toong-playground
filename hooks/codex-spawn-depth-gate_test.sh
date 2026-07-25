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

# assert_allow: exit 0 AND empty stdout AND empty stderr -- exit-0-only would
# let a CRASHED hook (non-zero exit swallowed by a caller, or an empty stdout
# for an unrelated reason) masquerade as an allow, mirrors hooks/codex-write-
# guard_test.sh's own assert_allow rationale. The stdout check pins the
# hook's SILENT-allow contract directly (hooks/codex-spawn-depth-
# gate.sh:29-36: every allow path is a bare `exit 0`, no stdout at all) --
# not merely "not a deny": a bare `grep -q '"permissionDecision":"deny"'`
# rejects only the deny string and would wave an explicit, hand-rolled
# `permissionDecision: "allow"` envelope straight through, even though this
# hook has never emitted one and Codex has therefore never been handed a
# verdict on this path before. The empty-stdout check subsumes that grep
# strictly (a deny envelope is never empty), so the grep is gone, not kept
# alongside it. The stderr check pins the hook's OWN plural-form contract
# (hooks/codex-spawn-depth-gate.sh:29-36): "EVERY read failure ... there is
# no diagnostic emitted anywhere on that path" -- not just the jq-absent case
# row1 already checks inline, but every allow-expecting row that reaches this
# helper. $4 is the PATH to the stderr file the caller already captured from
# its own run_hook invocation (this helper does not redirect anything itself,
# so callers stay in control of where their fixture files live -- $SBX vs a
# bare mktemp for the rows that have no sandbox) -- a FILE, not a
# command-substituted string: `$(cat file)` strips ALL trailing newlines, so
# a stderr that is nothing but a single stray newline (still a real
# diagnostic byte the fail-open contract forbids) collapses to an empty
# string and would slip past a `[ -n "$stderr_content" ]` check undetected.
# `[ -s FILE ]` checks the file's actual byte size instead, so that same
# newline-only stderr is correctly caught. $5 is the matching PATH for
# stdout, checked the exact same way and for the exact same reason: $1
# ("out") is itself a command-substituted string (`out=$(cat "$stdout_file")`
# at each call site, kept only so failure messages can still show its
# content), so a stdout that is nothing but stray newline bytes -- still real
# bytes the SILENT-allow contract at hooks/codex-spawn-depth-gate.sh:29-36
# forbids -- would collapse to "" through $1 and slip past `[ -n "$out" ]`
# undetected. `[ -s "$stdout_file" ]` checks the file's actual byte size
# instead of the newline-stripped string, so a stdout that is nothing but a
# stray newline is correctly caught rather than waved through as empty.
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
#      independently, closes that hole. Both patterns also close on the
#      RIGHT using a literal delimiter that already follows the number in
#      the hook's real reason string ("...reach depth <child>, exceeding..."
#      and "...cap of <cap> (root session..."): an open-ended `*"reach depth
#      $expected_child"*` would still match if the hook appended an extra
#      digit (e.g. "depth 30" while $expected_child is "3") -- the trailing
#      "," and " " delimiters below rule that out.
#   5. stdout is EXACTLY one JSON object, not a stream with something else
#      mixed in. `jq -e` over a multi-object stream reports the status of
#      only the LAST value, so noise emitted before the real deny envelope
#      (e.g. a stray `echo '{"noise":true}'` ahead of the hook's own jq -nc
#      call) is invisible to checks 1-4 even though Codex, which parses this
#      stdout as a single PreToolUse verdict, would fail to parse it at all.
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
    # CAP is hardcoded here (2), matching the pre-existing convention already
    # used by every assert_deny call throughout this file (e.g. row8's
    # `assert_deny ... 3 2`, row9's `... 9 2`) -- reading CAP from the hook
    # for just this one check would not close the drift risk those existing
    # literals already carry (hooks/codex-spawn-depth-gate.sh:54-61's own
    # comment documents CAP has no read mechanism, and every other row in
    # this file would still silently drift if CAP ever changed), so it adds
    # a one-off coupling without fixing the actual duplication.
    local expected_cap=2
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

    # Self-check: this row's entire discriminating power rests on
    # depth_value being BOTH all-digit AND leading-zero. All-digit is what
    # tells it apart from row9-non-numeric below (real schema drift that
    # legitimately falls through to cur=0/allow -- a different, unrelated
    # code path). Leading-zero is what actually pressures hooks/codex-spawn-
    # depth-gate.sh:130's `10#` prefix: a same-digit-count value WITHOUT a
    # leading zero (e.g. "8") parses identically whether bash's arithmetic
    # reads it as octal or decimal, so `cur=$((cur))` and `cur=$((10#$cur))`
    # produce the same result and the test would stay green even with the
    # octal-misread fix reverted. If depth_value ever drifted off either
    # property, assert_deny below would still pass (a normally-resolved
    # rollout denies for its own, unrelated reason) while this row silently
    # stopped exercising the crash-avoidance defense it exists to catch.
    case "$depth_value" in
        '' | *[!0-9]*) echo "ASSERTION FAILED row9-leading-zero: depth_value \"$depth_value\" must be all-digit -- this row exists to prove well-formed all-digit input no longer crashes on octal misread, not that malformed input is rejected"; result=1 ;;
        *) ;;
    esac

    # The check above (all-digit) tells this row apart from row9-non-numeric
    # below. It does NOT, by itself, prove depth_value pressures the `10#`
    # prefix -- "leading zero" was tried as that second check and is a proxy
    # BROADER than the real property: "07" has a leading zero yet its octal
    # parse (7) and decimal parse (7) AGREE, so `10#` is a no-op for it -- a
    # leading-zero-only check waves "07" through as if it pressured the
    # defense. The real property is executable directly: does unprefixed
    # arithmetic on depth_value either (a) ABORT (08/09-style, an octal digit
    # of 8 or 9 overflows base-8), or (b) SUCCEED but disagree with the
    # 10#-prefixed decimal result (010-style, where both parses succeed but
    # land on different numbers)? If neither, `10#` changes nothing for
    # depth_value and this row silently stops exercising hooks/codex-spawn-
    # depth-gate.sh:130's defense.
    #
    # Each probe runs as a SEPARATE `bash -c` subshell, not inline in this
    # function's own `set -e` shell: an inline $((depth_value+1)) on a value
    # like "08" aborts the CURRENT shell outright under `set -e` (measured:
    # the whole test script exits before any following line runs), which
    # would kill this test function itself instead of letting it report a
    # clean FAIL. The value is passed as `$1`, not interpolated into the
    # single-quoted script text, so it is never re-parsed as shell syntax.
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
    local transcript_path_value="-n1"

    # Self-check: this row's entire discriminating power rests on
    # transcript_path_value being BOTH dash-prefixed AND relative (see the
    # header comment above) -- an absolute path always starts with "/" and
    # can never be misread as a head(1) option, so if this value ever
    # drifted off either property, assert_deny below would still pass (a
    # normally-resolved depth=2 rollout denies for its own, unrelated
    # reason) while this row silently stopped exercising the `head -3 --`
    # defense at all.
    case "$transcript_path_value" in
        -*) ;;
        *) echo "ASSERTION FAILED row12: transcript_path_value \"$transcript_path_value\" must start with a dash to pressure head(1)'s option-parsing misread"; result=1 ;;
    esac
    case "$transcript_path_value" in
        /*) echo "ASSERTION FAILED row12: transcript_path_value \"$transcript_path_value\" must be a RELATIVE path -- an absolute path can never be misread as a head(1) option, so it stops exercising the bug this row exists to catch"; result=1 ;;
        *) ;;
    esac

    printf '%s\n' '{"payload":{"source":{"subagent":{"thread_spawn":{"depth":2}}}}}' > "$SBX/-n1"
    payload=$(jq -n --arg tp "$transcript_path_value" '{tool_name:"collaborationspawn_agent", transcript_path:$tp}')

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
# Row 13b -- depth on the rollout file's 3RD line, the EXACT boundary of the
# `head -3` window at hooks/codex-spawn-depth-gate.sh:116. Row 13 above (depth
# on line 2) and row 14 below (depth on line 4) bracket this window but never
# land ON it -- reducing the hook's `head -3` to `head -2` leaves row 13
# (still inside a 2-line window) and row 14 (already outside a 3-line window)
# both unaffected, so that one-character mutation passes the suite green
# while silently losing the scan's actual boundary line. This is exactly the
# failure shape hooks/codex-spawn-depth-gate_test.sh's own header warns about
# (":22-29", "the tests pass while the actual depth cap is silently gone").
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

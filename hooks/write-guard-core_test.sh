#!/bin/bash
# =============================================================================
# Write-Guard Core Tests (codex-ledger-parity plan, TODO 2)
# Covers hooks/write-guard-core.sh: write_guard_core_run <OMT_DIR> <session_id>
# reads newline-separated already-absolutized candidate paths on stdin and
# emits the deny JSON iff a candidate is FULL-PATH EXACT equal to
# $OMT_DIR/session-ledger-<sid>.md -- never a bare substring match (the loose
# classifier this core supersedes: hooks/pre-tool-enforcer.sh:42-77
# _wg_ledger_target_in_segment).
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORE="$SCRIPT_DIR/write-guard-core.sh"

# EVIDENCE_OMT_DIR: self-derived (not ambient $OMT_DIR) so this suite runs
# clean under `env -u OMT_DIR`, mirroring hooks/codex-write-guard_test.sh's
# own EVIDENCE_OMT_DIR derivation via resolve_omt_dir.
EVIDENCE_OMT_DIR=$(bash -c "source '$SCRIPT_DIR/lib/omt-dir.sh'; resolve_omt_dir '$SCRIPT_DIR'")

TESTS_PASSED=0
TESTS_FAILED=0

# -----------------------------------------------------------------------------
# mktemp -d + cleanup trap (OMT shell-test convention)
# -----------------------------------------------------------------------------
TEST_TMP_DIR=$(mktemp -d)
cleanup() {
    rm -rf "$TEST_TMP_DIR"
}
trap cleanup EXIT

OD="$TEST_TMP_DIR/omt-wg"
SID="s1"

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

# =============================================================================
# AC1 -- byte-identical deny: write_guard_core_run emits EXACTLY the golden
# deny JSON. The golden is pinned here as a literal, deliberately duplicated
# from write-guard-core.sh's _wg_core_deny_json so any drift in that SSOT
# fails this test -- reading the string from the SUT would be a tautology.
# It was originally read from merge-base's pre-tool-enforcer.sh:_wg_deny_json,
# but that string has since moved into write-guard-core.sh and no longer
# exists at that git path (the merge-base anchor advanced past the move once
# it merged to main), so the golden is pinned directly instead.
# =============================================================================
test_ac1_byte_identical_deny() {
    local expected out
    expected='{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Blocked: direct write/delete targets the durable session ledger (session-ledger-*.md). Use hooks/omt-ledger.sh append/now instead."}}'
    out=$(printf '%s\n' "$OD/session-ledger-$SID.md" | bash -c "source '$CORE'; write_guard_core_run '$OD' '$SID'")
    if [ "$out" = "$expected" ] && printf '%s' "$out" | grep -q '"hookEventName":"PreToolUse"'; then
        return 0
    else
        echo "ASSERTION FAILED AC1: expected='$expected' out='$out'"
        return 1
    fi
}

# =============================================================================
# AC2 -- a session-ledger-<sid>.md path in a DIFFERENT directory (previously
# loose-blocked by the substring classifier) now ALLOWS.
# =============================================================================
test_ac2_different_dir_session_ledger_allows() {
    local out
    out=$(printf '%s\n' "/some/other/dir/session-ledger-$SID.md" | bash -c "source '$CORE'; write_guard_core_run '$OD' '$SID'")
    if [ -z "$out" ]; then
        return 0
    else
        echo "ASSERTION FAILED AC2: expected empty (ALLOW), got '$out'"
        return 1
    fi
}

# =============================================================================
# QA Scenario -- substring-but-not-anchor filename -> ALLOW.
# =============================================================================
test_qa_substring_but_not_anchor_allows() {
    local out evidence_dir
    out=$(printf '%s\n' "/tmp/draft-session-ledger-notes.md" | bash -c "source '$CORE'; write_guard_core_run '$OD' '$SID'")
    evidence_dir="$EVIDENCE_OMT_DIR/evidence/codex-ledger-parity/write-guard-core"
    mkdir -p "$evidence_dir"
    {
        echo "input: /tmp/draft-session-ledger-notes.md (OMT_DIR=$OD sid=$SID)"
        echo "output: '$out'"
    } > "$evidence_dir/substring-allow.txt"
    if [ -z "$out" ]; then
        return 0
    else
        echo "ASSERTION FAILED QA-substring-allow: expected empty (ALLOW), got '$out'"
        return 1
    fi
}

# =============================================================================
# QA Scenario -- exact current-session ledger -> DENY, protection preserved.
# =============================================================================
test_qa_exact_current_ledger_denies() {
    local out evidence_dir
    out=$(printf '%s\n' "$OD/session-ledger-$SID.md" | bash -c "source '$CORE'; write_guard_core_run '$OD' '$SID'")
    evidence_dir="$EVIDENCE_OMT_DIR/evidence/codex-ledger-parity/write-guard-core"
    mkdir -p "$evidence_dir"
    {
        echo "input: $OD/session-ledger-$SID.md (OMT_DIR=$OD sid=$SID)"
        echo "output: $out"
    } > "$evidence_dir/exact-deny.txt"
    if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        return 0
    else
        echo "ASSERTION FAILED QA-exact-deny: expected deny JSON, got '$out'"
        return 1
    fi
}

# =============================================================================
# Regression (claim N) -- non-canonical path spellings must not bypass the
# pure-string EXACT match. write_guard_core_run compared candidate paths to
# the ledger path with a pure string `==`, so a candidate with a
# non-canonical segment ('./', '//', 'a/../') preserved still lexically
# resolves to the real ledger path but does NOT string-match it, and was
# silently ALLOWED. Each DENY case below targets the resolved current-session
# ledger via a non-canonical spelling; the final case is a non-ledger control
# proving the fix does not over-block.
# =============================================================================
test_regression_dot_segment_denies() {
    local out
    out=$(printf '%s\n' "$OD/./session-ledger-$SID.md" | bash -c "source '$CORE'; write_guard_core_run '$OD' '$SID'")
    if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        return 0
    else
        echo "ASSERTION FAILED regression-dot-segment: expected deny for '$OD/./session-ledger-$SID.md', got '$out'"
        return 1
    fi
}

test_regression_double_slash_denies() {
    local out
    out=$(printf '%s\n' "$OD//session-ledger-$SID.md" | bash -c "source '$CORE'; write_guard_core_run '$OD' '$SID'")
    if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        return 0
    else
        echo "ASSERTION FAILED regression-double-slash: expected deny for '$OD//session-ledger-$SID.md', got '$out'"
        return 1
    fi
}

test_regression_dotdot_segment_denies() {
    local out
    out=$(printf '%s\n' "$OD/sub/../session-ledger-$SID.md" | bash -c "source '$CORE'; write_guard_core_run '$OD' '$SID'")
    if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        return 0
    else
        echo "ASSERTION FAILED regression-dotdot-segment: expected deny for '$OD/sub/../session-ledger-$SID.md', got '$out'"
        return 1
    fi
}

test_regression_dot_segment_non_ledger_allows() {
    local out
    out=$(printf '%s\n' "$OD/./other-notes.md" | bash -c "source '$CORE'; write_guard_core_run '$OD' '$SID'")
    if [ -z "$out" ]; then
        return 0
    else
        echo "ASSERTION FAILED regression-dot-segment-allow: expected empty (ALLOW), got '$out'"
        return 1
    fi
}

# =============================================================================
# Glob bypass (CONFIRMED defect) -- an unquoted glob candidate never
# EXACT-string-matches the ledger path, but if the glob pattern itself
# matches the resolved ledger path, running that command (e.g. `rm
# "$OMT_DIR"/session-ledger-*.md`) destroys the current session ledger. The
# core must also deny when a candidate glob pattern matches the ledger path,
# not just on EXACT string equality.
# =============================================================================
test_glob_ledger_star_denies() {
    local out
    out=$(printf '%s\n' "$OD/session-ledger-*.md" | bash -c "source '$CORE'; write_guard_core_run '$OD' '$SID'")
    if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        return 0
    else
        echo "ASSERTION FAILED glob-ledger-star: expected deny for '$OD/session-ledger-*.md', got '$out'"
        return 1
    fi
}

test_glob_dir_star_denies() {
    local out
    out=$(printf '%s\n' "$OD/*" | bash -c "source '$CORE'; write_guard_core_run '$OD' '$SID'")
    if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        return 0
    else
        echo "ASSERTION FAILED glob-dir-star: expected deny for '$OD/*', got '$out'"
        return 1
    fi
}

test_glob_non_matching_star_allows() {
    local out
    out=$(printf '%s\n' "$OD/other-*.md" | bash -c "source '$CORE'; write_guard_core_run '$OD' '$SID'")
    if [ -z "$out" ]; then
        return 0
    else
        echo "ASSERTION FAILED glob-non-matching-star: expected empty (ALLOW), got '$out'"
        return 1
    fi
}

# =============================================================================
# False-block regression (precision defect) -- an ANCESTOR-level glob (e.g.
# "$HOME/*") must ALLOW, not deny. Bash `case` lets `*` span the `/`
# separator, unlike real shell pathname expansion where `*` matches within
# ONE path segment only. The ledger sits nested below the glob's directory
# ($ANCESTOR_PARENT/.omt/proj/session-ledger-<sid>.md); at real runtime
# "$ANCESTOR_PARENT"/* expands only to $ANCESTOR_PARENT's direct children
# (skipping the dot-prefixed .omt dir) and never touches the ledger, so the
# guard must not deny it.
# =============================================================================
test_glob_ancestor_star_allows() {
    local ancestor_parent ancestor_od out
    ancestor_parent="$TEST_TMP_DIR/ancestor-home"
    ancestor_od="$ancestor_parent/.omt/proj"
    out=$(printf '%s\n' "$ancestor_parent/*" | bash -c "source '$CORE'; write_guard_core_run '$ancestor_od' '$SID'")
    if [ -z "$out" ]; then
        return 0
    else
        echo "ASSERTION FAILED glob-ancestor-star: expected empty (ALLOW), got '$out'"
        return 1
    fi
}

# =============================================================================
# Glob bypass (CONFIRMED P1 defect) -- a glob in a DIRECTORY component (not
# the basename) at the SAME depth as the ledger's own parent segment. At real
# runtime, e.g. `rm "$OMT_DIR/"*"/session-ledger-<sid>.md"`, the `*` expands
# within the single project-dir segment and reaches the real ledger -- but
# the old dir-EXACT + basename-glob check compared the candidate's whole
# directory part ("$OMT_DIR/*") against the ledger's directory part
# ("$OMT_DIR/omt-wg") with plain string `=`, which never matches, so it
# WRONGLY ALLOWED. The fix does a component-wise glob match with depth
# (segment-count) equality instead.
# =============================================================================
test_glob_dir_component_denies() {
    local out cand
    cand="${OD%/*}/*/session-ledger-$SID.md"
    out=$(printf '%s\n' "$cand" | bash -c "source '$CORE'; write_guard_core_run '$OD' '$SID'")
    if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        return 0
    else
        echo "ASSERTION FAILED glob-dir-component: expected deny for '$cand', got '$out'"
        return 1
    fi
}

# =============================================================================
# Depth-mismatch regression (precision defect) -- a dir-component glob that
# is ONE segment SHALLOWER than the ledger (it stops at the ledger's parent
# dir, never supplying a filename segment) must ALLOW: at real runtime
# "$TEST_TMP_DIR"/* only expands to $TEST_TMP_DIR's direct children (the
# "omt-wg" dir itself), never descending into it to reach the ledger file.
# Proves the component-wise match enforces equal segment count, not just
# per-segment glob matching.
# =============================================================================
test_glob_dir_component_wrong_depth_allows() {
    local out cand
    cand="${OD%/*}/*"
    out=$(printf '%s\n' "$cand" | bash -c "source '$CORE'; write_guard_core_run '$OD' '$SID'")
    if [ -z "$out" ]; then
        return 0
    else
        echo "ASSERTION FAILED glob-dir-component-wrong-depth: expected empty (ALLOW), got '$out'"
        return 1
    fi
}

# =============================================================================
# False-block regression (CONFIRMED P2 defect) -- dotglob-off semantics. The
# ledger sits under a DOTFILE directory segment ($HOME/.omt/<proj>/session-
# ledger-<sid>.md). Bash `case` patterns let '*'/'?'/'[...]' match a leading
# '.', but real shell pathname expansion with `dotglob` OFF (the shell
# default) does NOT -- a leading '.' is matched ONLY by an explicit literal
# '.' in the pattern. At real runtime `rm "$HOME"/*/proj/session-ledger-
# <sid>.md` cannot reach the ledger (the '*' skips the hidden .omt dir, so it
# expands to zero files), so the guard must ALLOW, not deny.
# =============================================================================
DOT_HOME="$TEST_TMP_DIR/dot-home"
DOT_OD="$DOT_HOME/.omt/proj"

test_glob_dotfile_segment_star_allows() {
    local out cand
    cand="$DOT_HOME/*/proj/session-ledger-$SID.md"
    out=$(printf '%s\n' "$cand" | bash -c "source '$CORE'; write_guard_core_run '$DOT_OD' '$SID'")
    if [ -z "$out" ]; then
        return 0
    else
        echo "ASSERTION FAILED glob-dotfile-segment-star: expected empty (ALLOW), got '$out'"
        return 1
    fi
}

# =============================================================================
# Regression guard (must NOT change) -- a candidate that spells the dotfile
# segment out LITERALLY (".omt") and globs only the non-dot project segment
# must still DENY: at real runtime `rm "$HOME/.omt/"*"/session-ledger-
# <sid>.md"` DOES reach the ledger (the literal ".omt" matches itself; the
# '*' expands within the non-dot project segment). This is the earlier P1
# case (test_glob_dir_component_denies) replayed against a dotfile-bearing
# OMT_DIR, to prove the dotfile guard does not over-correct.
# =============================================================================
test_glob_dotfile_literal_project_star_denies() {
    local out cand
    cand="$DOT_HOME/.omt/*/session-ledger-$SID.md"
    out=$(printf '%s\n' "$cand" | bash -c "source '$CORE'; write_guard_core_run '$DOT_OD' '$SID'")
    if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        return 0
    else
        echo "ASSERTION FAILED glob-dotfile-literal-project-star: expected deny for '$cand', got '$out'"
        return 1
    fi
}

# =============================================================================
# Regression guard (must NOT change) -- a glob confined to the NON-dotfile
# basename segment, with every directory segment (incl. the literal ".omt")
# spelled out, must still DENY: `rm $OMT_DIR/session-ledger-*.md` reaches the
# real ledger at runtime regardless of dotglob.
# =============================================================================
test_glob_dotfile_basename_partial_star_denies() {
    local out cand
    cand="$DOT_OD/session-ledger-*.md"
    out=$(printf '%s\n' "$cand" | bash -c "source '$CORE'; write_guard_core_run '$DOT_OD' '$SID'")
    if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        return 0
    else
        echo "ASSERTION FAILED glob-dotfile-basename-partial-star: expected deny for '$cand', got '$out'"
        return 1
    fi
}

# =============================================================================
# Regression guard (must NOT change) -- a bare '*' at the basename position
# (ledger basename "session-ledger-<sid>.md" is NOT itself a dotfile) must
# still DENY: `rm $OMT_DIR/*` reaches the real ledger at runtime regardless
# of dotglob, since dotglob only gates whether '*' matches a DOT-led name.
# =============================================================================
test_glob_dotfile_basename_star_denies() {
    local out cand
    cand="$DOT_OD/*"
    out=$(printf '%s\n' "$cand" | bash -c "source '$CORE'; write_guard_core_run '$DOT_OD' '$SID'")
    if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        return 0
    else
        echo "ASSERTION FAILED glob-dotfile-basename-star: expected deny for '$cand', got '$out'"
        return 1
    fi
}

# =============================================================================
# Claude<->Codex parity story 9/9, AC2/AC4 -- write_guard_core_check_dangerous_
# command <command-segment> mirrors claude.yaml's declarative permissions.deny
# glob set (rm -rf/-fr/-Rf/-r -f/-f -r, git push --force/-f in either
# position) for the platform (Codex) that has no native declarative permission
# engine. DENY cases below are the positive set; ALLOW cases (plain rm, rm -r,
# non-force git push) are the negative control -- without them a deny guard
# cannot be told apart from "deny everything".
# =============================================================================
test_dangerous_rm_rf_denies() {
    local out
    out=$(bash -c "source '$CORE'; write_guard_core_check_dangerous_command 'rm -rf /tmp/x'")
    if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        return 0
    else
        echo "ASSERTION FAILED dangerous-rm-rf: expected deny for 'rm -rf /tmp/x', got '$out'"
        return 1
    fi
}

test_dangerous_rm_fr_denies() {
    local out
    out=$(bash -c "source '$CORE'; write_guard_core_check_dangerous_command 'rm -fr /tmp/x'")
    if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        return 0
    else
        echo "ASSERTION FAILED dangerous-rm-fr: expected deny for 'rm -fr /tmp/x', got '$out'"
        return 1
    fi
}

test_dangerous_rm_r_dash_f_denies() {
    local out
    out=$(bash -c "source '$CORE'; write_guard_core_check_dangerous_command 'rm -r -f /tmp/x'")
    if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        return 0
    else
        echo "ASSERTION FAILED dangerous-rm-r-dash-f: expected deny for 'rm -r -f /tmp/x', got '$out'"
        return 1
    fi
}

test_dangerous_git_push_force_denies() {
    local out
    out=$(bash -c "source '$CORE'; write_guard_core_check_dangerous_command 'git push --force'")
    if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        return 0
    else
        echo "ASSERTION FAILED dangerous-git-push-force: expected deny for 'git push --force', got '$out'"
        return 1
    fi
}

test_dangerous_git_push_origin_force_denies() {
    local out
    out=$(bash -c "source '$CORE'; write_guard_core_check_dangerous_command 'git push origin --force'")
    if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        return 0
    else
        echo "ASSERTION FAILED dangerous-git-push-origin-force: expected deny for 'git push origin --force', got '$out'"
        return 1
    fi
}

test_dangerous_git_push_dash_f_denies() {
    local out
    out=$(bash -c "source '$CORE'; write_guard_core_check_dangerous_command 'git push origin -f'")
    if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        return 0
    else
        echo "ASSERTION FAILED dangerous-git-push-dash-f: expected deny for 'git push origin -f', got '$out'"
        return 1
    fi
}

# Negative control (AC4) -- a plain rm / rm -r / non-force git push must NOT
# be denied. Without this, a deny guard is indistinguishable from "deny
# everything".
test_negative_plain_rm_allows() {
    local out
    out=$(bash -c "source '$CORE'; write_guard_core_check_dangerous_command 'rm /tmp/x'")
    if [ -z "$out" ]; then
        return 0
    else
        echo "ASSERTION FAILED negative-plain-rm: expected empty (ALLOW), got '$out'"
        return 1
    fi
}

test_negative_rm_r_allows() {
    local out
    out=$(bash -c "source '$CORE'; write_guard_core_check_dangerous_command 'rm -r /tmp/x'")
    if [ -z "$out" ]; then
        return 0
    else
        echo "ASSERTION FAILED negative-rm-r: expected empty (ALLOW), got '$out'"
        return 1
    fi
}

test_negative_git_push_no_force_allows() {
    local out
    out=$(bash -c "source '$CORE'; write_guard_core_check_dangerous_command 'git push origin main'")
    if [ -z "$out" ]; then
        return 0
    else
        echo "ASSERTION FAILED negative-git-push-no-force: expected empty (ALLOW), got '$out'"
        return 1
    fi
}

# =============================================================================
# Regression (CONFIRMED bypass, both-platform measurement) -- the 9 dangerous-
# command patterns are literal-token globs requiring EXACTLY one ASCII space
# between words ("rm -rf "*), but a real shell treats any run of spaces/tabs
# between tokens as an equivalent single separator: `rm  -rf x` (two spaces)
# and `rm<TAB>-rf x` both run `rm -rf x` at real execution time, yet neither
# literally matched the single-space pattern, silently ALLOWING a command
# Claude denies natively (its own shell-aware parser is whitespace-run-
# tolerant). Fix: collapse internal whitespace runs to a single space before
# the case match. Each DENY case below reproduces one whitespace-run variant;
# the ALLOW controls prove the collapse does not turn ordinary whitespace
# into an over-broad denier.
# =============================================================================
test_dangerous_rm_rf_double_space_denies() {
    local out
    out=$(bash -c "source '$CORE'; write_guard_core_check_dangerous_command 'rm  -rf /tmp/x'")
    if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        return 0
    else
        echo "ASSERTION FAILED dangerous-rm-rf-double-space: expected deny for 'rm  -rf /tmp/x' (two spaces), got '$out'"
        return 1
    fi
}

test_dangerous_rm_rf_tab_denies() {
    local out cmd
    cmd=$(printf 'rm\t-rf /tmp/x')
    out=$(bash -c "source '$CORE'; write_guard_core_check_dangerous_command \"\$1\"" _ "$cmd")
    if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        return 0
    else
        echo "ASSERTION FAILED dangerous-rm-rf-tab: expected deny for 'rm<TAB>-rf /tmp/x', got '$out'"
        return 1
    fi
}

test_dangerous_git_push_force_multispace_denies() {
    local out
    out=$(bash -c "source '$CORE'; write_guard_core_check_dangerous_command 'git  push  --force'")
    if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        return 0
    else
        echo "ASSERTION FAILED dangerous-git-push-force-multispace: expected deny for 'git  push  --force', got '$out'"
        return 1
    fi
}

# Negative controls -- ordinary single-space commands must be unaffected by
# the whitespace collapse (already covered by test_negative_plain_rm_allows /
# test_negative_git_push_no_force_allows above); this control additionally
# proves a harmless command that itself contains a double-space in a
# non-leading position stays allowed (the collapse does not turn benign
# multi-space text into a denier).
test_negative_double_space_nondangerous_allows() {
    local out
    out=$(bash -c "source '$CORE'; write_guard_core_check_dangerous_command 'echo  hello  world'")
    if [ -z "$out" ]; then
        return 0
    else
        echo "ASSERTION FAILED negative-double-space-nondangerous: expected empty (ALLOW), got '$out'"
        return 1
    fi
}

# =============================================================================
# write_guard_core_check_user_authorized_command <command-segment>
#
# ultragoal exposes two state mutations the SKILL's own authority table marks
# "orchestrator, only after explicit user approval": approve-review-dispatch-
# renewal (extends the review budget) and dismiss-review-finding (removes a
# blocking finding from the completion gate). Both were enforced by prose
# alone -- the AI could run either unprompted and clear its own gate. This
# guard makes the authorization structural: the AI's own Bash path is denied,
# so the command reaches the CLI only when the user runs it.
#
# ALLOW cases (get/status/request-complete/set-verdict) are the negative
# control -- without them a deny guard cannot be told apart from "deny every
# ultragoal-state invocation".
# =============================================================================
UGCLI="bun /Users/x/.claude/skills/ultragoal/scripts/ultragoal-state.ts"
QACLI="bun /Users/x/.claude/skills/qa/scripts/qa-state.ts"

test_user_authorized_qa_waive_denies() {
    local out
    out=$(bash -c "source '$CORE'; write_guard_core_check_user_authorized_command \"\$1\"" _ \
        "$QACLI waive --story s1 --cls 1 --reason 'blocked'")
    if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        return 0
    else
        echo "ASSERTION FAILED qa-waive: expected deny, got '$out'"
        return 1
    fi
}

test_user_authorized_qa_waive_reverse_order_denies() {
    local out
    out=$(bash -c "source '$CORE'; write_guard_core_check_user_authorized_command \"\$1\"" _ \
        "sub=waive; $QACLI \"\$sub\" --story s1 --cls 1 --reason blocked")
    if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        return 0
    else
        echo "ASSERTION FAILED qa-waive-reverse: expected deny, got '$out'"
        return 1
    fi
}

test_user_authorized_qa_record_cell_noncollision_allows() {
    local out
    out=$(bash -c "source '$CORE'; write_guard_core_check_user_authorized_command \"\$1\"" _ \
        "$QACLI record-cell --story s1 --cls 1 --status na --na-reason 'device unreachable'")
    if [ -z "$out" ]; then return 0; fi
    echo "ASSERTION FAILED qa-record-cell: expected allow, got '$out'"
    return 1
}

test_user_authorized_qa_record_cell_waive_collision_denies() {
    local out
    out=$(bash -c "source '$CORE'; write_guard_core_check_user_authorized_command \"\$1\"" _ \
        "$QACLI record-cell --story s1 --cls 1 --status na --na-reason 'waive requested upstream'")
    if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then return 0; fi
    echo "ASSERTION FAILED qa-record-cell-collision: expected deny, got '$out'"
    return 1
}

test_qa_state_exact_path_denies() {
    local out
    out=$(printf '%s\n' "$OD/qa-state-$SID.json" | bash -c "source '$CORE'; write_guard_core_run '$OD' '$SID'")
    if printf '%s' "$out" | grep -qi 'qa-state'; then return 0; fi
    echo "ASSERTION FAILED qa-state-path: expected deny, got '$out'"
    return 1
}

test_qa_state_other_session_allows() {
    local out
    out=$(printf '%s\n' "$OD/qa-state-other.json" | bash -c "source '$CORE'; write_guard_core_run '$OD' '$SID'")
    if [ -z "$out" ]; then return 0; fi
    echo "ASSERTION FAILED qa-state-other: expected allow, got '$out'"
    return 1
}

# =============================================================================
# QA glob bypass (CONFIRMED P2 defect) -- an unquoted QA-state glob never
# EXACT-string-matches the current-session state path, but `rm
# "$OMT_DIR"/qa-state-*.json` can destroy qa-state-<sid>.json at runtime.
# The glob branch must apply to the QA state anchor just as it does to the
# session ledger anchor.
# =============================================================================
test_qa_state_glob_current_session_denies() {
    local out cand
    cand="$OD/qa-state-*.json"
    out=$(printf '%s\n' "$cand" | bash -c "source '$CORE'; write_guard_core_run '$OD' '$SID'")
    if printf '%s' "$out" | grep -qi 'qa-state'; then return 0; fi
    echo "ASSERTION FAILED qa-state-glob-current: expected deny for '$cand', got '$out'"
    return 1
}

test_qa_state_glob_other_session_allows() {
    local out cand
    cand="$OD/qa-state-other-*.json"
    out=$(printf '%s\n' "$cand" | bash -c "source '$CORE'; write_guard_core_run '$OD' '$SID'")
    if [ -z "$out" ]; then return 0; fi
    echo "ASSERTION FAILED qa-state-glob-other: expected allow for '$cand', got '$out'"
    return 1
}

test_qa_state_glob_nonmatching_allows() {
    local out cand
    cand="$OD/qa-other-*.json"
    out=$(printf '%s\n' "$cand" | bash -c "source '$CORE'; write_guard_core_run '$OD' '$SID'")
    if [ -z "$out" ]; then return 0; fi
    echo "ASSERTION FAILED qa-state-glob-nonmatching: expected allow for '$cand', got '$out'"
    return 1
}

# =============================================================================
# explain-diff state -- a third anchor alongside the ledger and the QA state.
# The step machine's only writer is the explain-diff-state.ts CLI; a direct
# write here would let a session mark its own steps complete and reach a
# finished document without passing the quiz.
# =============================================================================
test_explain_diff_state_exact_path_denies() {
    local out
    out=$(printf '%s\n' "$OD/explain-diff-state-$SID.json" | bash -c "source '$CORE'; write_guard_core_run '$OD' '$SID'")
    if printf '%s' "$out" | grep -qi 'explain-diff-state'; then return 0; fi
    echo "ASSERTION FAILED explain-diff-state-path: expected deny, got '$out'"
    return 1
}

test_explain_diff_state_other_session_allows() {
    local out
    out=$(printf '%s\n' "$OD/explain-diff-state-other.json" | bash -c "source '$CORE'; write_guard_core_run '$OD' '$SID'")
    if [ -z "$out" ]; then return 0; fi
    echo "ASSERTION FAILED explain-diff-state-other: expected allow, got '$out'"
    return 1
}

test_explain_diff_state_glob_current_session_denies() {
    local out cand
    cand="$OD/explain-diff-state-*.json"
    out=$(printf '%s\n' "$cand" | bash -c "source '$CORE'; write_guard_core_run '$OD' '$SID'")
    if printf '%s' "$out" | grep -qi 'explain-diff-state'; then return 0; fi
    echo "ASSERTION FAILED explain-diff-state-glob-current: expected deny for '$cand', got '$out'"
    return 1
}

test_user_authorized_dismiss_review_finding_denies() {
    local out
    out=$(bash -c "source '$CORE'; write_guard_core_check_user_authorized_command \"\$1\"" _ \
        "$UGCLI dismiss-review-finding --ref src/auth.ts:142 --class correctness --rationale x")
    if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        return 0
    else
        echo "ASSERTION FAILED user-authorized-dismiss: expected deny, got '$out'"
        return 1
    fi
}

test_user_authorized_approve_renewal_denies() {
    local out
    out=$(bash -c "source '$CORE'; write_guard_core_check_user_authorized_command \"\$1\"" _ \
        "$UGCLI approve-review-dispatch-renewal")
    if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        return 0
    else
        echo "ASSERTION FAILED user-authorized-renewal: expected deny, got '$out'"
        return 1
    fi
}

test_user_authorized_resume_pursuit_denies() {
    local out
    out=$(bash -c "source '$CORE'; write_guard_core_check_user_authorized_command \"\$1\"" _ \
        "$UGCLI resume-pursuit")
    if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        return 0
    else
        echo "ASSERTION FAILED user-authorized-resume-pursuit: expected deny, got '$out'"
        return 1
    fi
}

test_user_authorized_resume_pursuit_variable_indirection_denies() {
    local out
    out=$(bash -c "source '$CORE'; write_guard_core_check_user_authorized_command \"\$1\"" _ \
        "sub=resume-pursuit; $UGCLI \"\$sub\"")
    if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        return 0
    else
        echo "ASSERTION FAILED user-authorized-resume-pursuit-variable-indirection: expected deny, got '$out'"
        return 1
    fi
}

test_user_authorized_resume_pursuit_reverse_order_denies() {
    local out
    out=$(bash -c "source '$CORE'; write_guard_core_check_user_authorized_command \"\$1\"" _ \
        "s=resume-pursuit && $UGCLI \"\$s\"")
    if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        return 0
    else
        echo "ASSERTION FAILED user-authorized-resume-pursuit-reverse-order: expected deny, got '$out'"
        return 1
    fi
}

test_user_authorized_resume_pursuit_whitespace_run_denies() {
    local out
    out=$(bash -c "source '$CORE'; write_guard_core_check_user_authorized_command \"\$1\"" _ \
        "$UGCLI  resume-pursuit   --reason x")
    if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        return 0
    else
        echo "ASSERTION FAILED user-authorized-resume-pursuit-whitespace-run: expected deny, got '$out'"
        return 1
    fi
}

# Whitespace-run tolerance, same hazard the dangerous-command guard fixed: a
# real shell treats any run of spaces/tabs as one separator, so a literal
# single-space pattern would silently ALLOW the identical command.
# Indirection bypass: the subcommand name reaches the CLI through a variable, so
# it never sits next to the script path in the command text -- and a `;` puts the
# two tokens in different chain segments. Matching requires both tokens anywhere
# in the WHOLE command, in either order, precisely so this shape is covered.
test_user_authorized_variable_indirection_denies() {
    local out
    out=$(bash -c "source '$CORE'; write_guard_core_check_user_authorized_command \"\$1\"" _ \
        "sub=dismiss-review-finding; $UGCLI \"\$sub\" --ref a --class correctness --rationale x")
    if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        return 0
    else
        echo "ASSERTION FAILED user-authorized-variable-indirection: expected deny, got '$out'"
        return 1
    fi
}

# Same shape for the renewal sibling, and with the subcommand token appearing
# BEFORE the script path -- the assignment-first ordering the bypass produces.
test_user_authorized_reverse_order_denies() {
    local out
    out=$(bash -c "source '$CORE'; write_guard_core_check_user_authorized_command \"\$1\"" _ \
        "s=approve-review-dispatch-renewal && $UGCLI \"\$s\"")
    if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        return 0
    else
        echo "ASSERTION FAILED user-authorized-reverse-order: expected deny, got '$out'"
        return 1
    fi
}

test_user_authorized_whitespace_run_denies() {
    local out
    out=$(bash -c "source '$CORE'; write_guard_core_check_user_authorized_command \"\$1\"" _ \
        "$UGCLI  dismiss-review-finding   --ref a --class correctness --rationale x")
    if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        return 0
    else
        echo "ASSERTION FAILED user-authorized-whitespace-run: expected deny, got '$out'"
        return 1
    fi
}

# The deny must name the user-run route; an AI told only "denied" has no next
# move and will either retry or abandon a legitimate user request.
test_user_authorized_deny_names_user_run_route() {
    local out
    out=$(bash -c "source '$CORE'; write_guard_core_check_user_authorized_command \"\$1\"" _ \
        "$UGCLI dismiss-review-finding --ref a --class correctness --rationale x")
    if printf '%s' "$out" | grep -q '사용자'; then
        return 0
    else
        echo "ASSERTION FAILED user-authorized-deny-message: expected the user-run route in the reason, got '$out'"
        return 1
    fi
}

test_negative_ultragoal_get_allows() {
    local out
    out=$(bash -c "source '$CORE'; write_guard_core_check_user_authorized_command \"\$1\"" _ "$UGCLI get")
    if [ -z "$out" ]; then
        return 0
    else
        echo "ASSERTION FAILED negative-ultragoal-get: expected empty (ALLOW), got '$out'"
        return 1
    fi
}

test_negative_ultragoal_request_complete_allows() {
    local out
    out=$(bash -c "source '$CORE'; write_guard_core_check_user_authorized_command \"\$1\"" _ \
        "$UGCLI request-complete")
    if [ -z "$out" ]; then
        return 0
    else
        echo "ASSERTION FAILED negative-ultragoal-request-complete: expected empty (ALLOW), got '$out'"
        return 1
    fi
}

test_negative_ultragoal_set_verdict_allows() {
    local out
    out=$(bash -c "source '$CORE'; write_guard_core_check_user_authorized_command \"\$1\"" _ \
        "$UGCLI set-verdict --verdict APPROVE")
    if [ -z "$out" ]; then
        return 0
    else
        echo "ASSERTION FAILED negative-ultragoal-set-verdict: expected empty (ALLOW), got '$out'"
        return 1
    fi
}

# The guarded subcommand name appearing as free text -- not as an invocation of
# the CLI -- must stay allowed, or reporting a denial to the user becomes
# self-denying.
test_negative_subcommand_name_as_prose_allows() {
    local out
    out=$(bash -c "source '$CORE'; write_guard_core_check_user_authorized_command \"\$1\"" _ \
        "echo 'run dismiss-review-finding yourself'")
    if [ -z "$out" ]; then
        return 0
    else
        echo "ASSERTION FAILED negative-subcommand-as-prose: expected empty (ALLOW), got '$out'"
        return 1
    fi
}

# codereview_guard_core_run <OMT_DIR> <session_id> <agent_type> tests
# (code-review-artifact-guard-core plan) -- identity-conditional guard: unlike
# write_guard_core_run's unconditional deny, this one allows the SAME guarded
# path when agent_type=="code-reviewer" and denies it otherwise (including
# absent/empty agent_type -- fail-closed not because a main-thread call never
# carries agent_type (it can, on the main thread of a session started with
# `--agent <name>`), but because treating absence as allow would let the
# orchestrator forge the artifact for free).
# =============================================================================

CRSID="$SID"

# =============================================================================
# AC1-codereview -- byte-identical deny: codereview_guard_core_run emits
# EXACTLY the golden deny JSON. Pinned here as a literal, deliberately
# duplicated from write-guard-core.sh's _wg_core_codereview_deny_json, for the
# same reason test_ac1_byte_identical_deny above pins the ledger guard's deny
# JSON as a literal rather than reading it from the SUT: the deny reason is
# the ONLY recovery information a blocked user sees (no bypass, no `ask`
# escape hatch), so a silent swap onto the wrong SSOT variable -- e.g. onto
# _wg_core_deny_json, the ledger guard's unrelated "Use hooks/omt-ledger.sh
# append/now instead." wording -- must fail this test even though every
# existing assertion here only checks for `"permissionDecision":"deny"` and
# would stay green. Reading the expected string from the SUT would make this
# check a tautology that drift can never fail.
# =============================================================================
test_ac_codereview_byte_identical_deny() {
    local expected out
    expected='{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Blocked: this code-review artifact (ultragoal-codereview-*.json / goal-codereview-*.json) may only be written by the code-reviewer subagent, not the orchestrator."}}'
    out=$(printf '%s\n' "$OD/ultragoal-codereview-$CRSID.json" | bash -c "source '$CORE'; codereview_guard_core_run '$OD' '$CRSID'")
    if [ "$out" = "$expected" ]; then
        return 0
    else
        echo "ASSERTION FAILED codereview-byte-identical-deny: expected='$expected' out='$out'"
        return 1
    fi
}

# -----------------------------------------------------------------------------
# AC2 -- ultragoal-codereview artifact, agent_type absent/empty -> DENY. Both
# forms of "no identity" must fail closed; if either allowed, the orchestrator
# could self-author the artifact from an ordinary main thread (which doesn't
# carry agent_type) and the completion gate would open on a forged review.
# -----------------------------------------------------------------------------
test_codereview_guard_ultragoal_empty_agent_type_denies() {
    local out
    out=$(printf '%s\n' "$OD/ultragoal-codereview-$CRSID.json" | bash -c "source '$CORE'; codereview_guard_core_run '$OD' '$CRSID' ''")
    if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        return 0
    else
        echo "ASSERTION FAILED codereview-ultragoal-empty-agent-type: expected deny, got '$out'"
        return 1
    fi
}

test_codereview_guard_ultragoal_missing_agent_type_denies() {
    local out
    out=$(printf '%s\n' "$OD/ultragoal-codereview-$CRSID.json" | bash -c "source '$CORE'; codereview_guard_core_run '$OD' '$CRSID'")
    if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        return 0
    else
        echo "ASSERTION FAILED codereview-ultragoal-missing-agent-type: expected deny, got '$out'"
        return 1
    fi
}

# -----------------------------------------------------------------------------
# AC3 -- positive control: agent_type=code-reviewer -> ALLOW. If this breaks,
# the guard has degenerated into an unconditional deny and the real
# code-reviewer subagent can no longer write its own artifact.
# -----------------------------------------------------------------------------
test_codereview_guard_ultragoal_code_reviewer_allows() {
    local out
    out=$(printf '%s\n' "$OD/ultragoal-codereview-$CRSID.json" | bash -c "source '$CORE'; codereview_guard_core_run '$OD' '$CRSID' 'code-reviewer'")
    if [ -z "$out" ]; then
        return 0
    else
        echo "ASSERTION FAILED codereview-ultragoal-code-reviewer-allows: expected empty (ALLOW), got '$out'"
        return 1
    fi
}

# -----------------------------------------------------------------------------
# AC4 -- a DIFFERENT subagent type (sisyphus-junior) -> DENY. Catches the
# whitelist widening into "any subagent passes" instead of exactly
# code-reviewer.
# -----------------------------------------------------------------------------
test_codereview_guard_ultragoal_sisyphus_junior_denies() {
    local out
    out=$(printf '%s\n' "$OD/ultragoal-codereview-$CRSID.json" | bash -c "source '$CORE'; codereview_guard_core_run '$OD' '$CRSID' 'sisyphus-junior'")
    if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        return 0
    else
        echo "ASSERTION FAILED codereview-ultragoal-sisyphus-junior: expected deny, got '$out'"
        return 1
    fi
}

# -----------------------------------------------------------------------------
# AC5 -- goal-codereview parity: same three verdicts (deny/allow/deny) for the
# goal-flavored artifact path.
# -----------------------------------------------------------------------------
test_codereview_guard_goal_missing_agent_type_denies() {
    local out
    out=$(printf '%s\n' "$OD/goal-codereview-$CRSID.json" | bash -c "source '$CORE'; codereview_guard_core_run '$OD' '$CRSID'")
    if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        return 0
    else
        echo "ASSERTION FAILED codereview-goal-missing-agent-type: expected deny, got '$out'"
        return 1
    fi
}

test_codereview_guard_goal_code_reviewer_allows() {
    local out
    out=$(printf '%s\n' "$OD/goal-codereview-$CRSID.json" | bash -c "source '$CORE'; codereview_guard_core_run '$OD' '$CRSID' 'code-reviewer'")
    if [ -z "$out" ]; then
        return 0
    else
        echo "ASSERTION FAILED codereview-goal-code-reviewer-allows: expected empty (ALLOW), got '$out'"
        return 1
    fi
}

test_codereview_guard_goal_sisyphus_junior_denies() {
    local out
    out=$(printf '%s\n' "$OD/goal-codereview-$CRSID.json" | bash -c "source '$CORE'; codereview_guard_core_run '$OD' '$CRSID' 'sisyphus-junior'")
    if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        return 0
    else
        echo "ASSERTION FAILED codereview-goal-sisyphus-junior: expected deny, got '$out'"
        return 1
    fi
}

# -----------------------------------------------------------------------------
# AC6 -- glob candidate (e.g. `rm "$OMT_DIR"/ultragoal-codereview-*.json`)
# with agent_type absent -> DENY, reusing _wg_core_pathwise_glob_match. Not an
# EXACT match but still destroys the current-session artifact if it runs.
# -----------------------------------------------------------------------------
test_codereview_guard_glob_candidate_missing_agent_type_denies() {
    local out
    out=$(printf '%s\n' "$OD/ultragoal-codereview-*.json" | bash -c "source '$CORE'; codereview_guard_core_run '$OD' '$CRSID'")
    if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        return 0
    else
        echo "ASSERTION FAILED codereview-glob-missing-agent-type: expected deny, got '$out'"
        return 1
    fi
}

# -----------------------------------------------------------------------------
# AC7 -- non-canonical spelling (./ segment) with agent_type absent -> DENY,
# reusing _wg_core_normpath so a non-canonical candidate cannot bypass the
# anchor match.
# -----------------------------------------------------------------------------
test_codereview_guard_dot_segment_missing_agent_type_denies() {
    local out
    out=$(printf '%s\n' "$OD/./ultragoal-codereview-$CRSID.json" | bash -c "source '$CORE'; codereview_guard_core_run '$OD' '$CRSID'")
    if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
        return 0
    else
        echo "ASSERTION FAILED codereview-dot-segment-missing-agent-type: expected deny, got '$out'"
        return 1
    fi
}

# -----------------------------------------------------------------------------
# AC8 -- false-positive negative control: ultragoal-verdict-<sid>.json is a
# DIFFERENT, self-attested artifact the orchestrator itself is meant to write
# from the main thread. Denying it with agent_type absent would break the
# normal completion-gate path with no bypass or `ask` escape hatch available.
# -----------------------------------------------------------------------------
test_codereview_guard_verdict_artifact_allows() {
    local out
    out=$(printf '%s\n' "$OD/ultragoal-verdict-$CRSID.json" | bash -c "source '$CORE'; codereview_guard_core_run '$OD' '$CRSID'")
    if [ -z "$out" ]; then
        return 0
    else
        echo "ASSERTION FAILED codereview-verdict-artifact-allows: expected empty (ALLOW), got '$out'"
        return 1
    fi
}

# -----------------------------------------------------------------------------
# AC9 -- false-positive negative control: a session-scoped sibling file at
# $OMT_DIR/code-review/<sid>/candidates.json is outside the guarded set --
# the guard must deny ONLY the exact completion-gate artifact file, never
# other files under the session's own directories.
# -----------------------------------------------------------------------------
test_codereview_guard_sibling_path_allows() {
    local out
    out=$(printf '%s\n' "$OD/code-review/$CRSID/candidates.json" | bash -c "source '$CORE'; codereview_guard_core_run '$OD' '$CRSID'")
    if [ -z "$out" ]; then
        return 0
    else
        echo "ASSERTION FAILED codereview-sibling-path-allows: expected empty (ALLOW), got '$out'"
        return 1
    fi
}

# -----------------------------------------------------------------------------
# AC10 -- another session's ultragoal-codereview artifact, agent_type absent
# -> ALLOW. The guard protects only the CURRENT session's artifact via exact
# sid match.
# -----------------------------------------------------------------------------
test_codereview_guard_other_session_allows() {
    local out
    out=$(printf '%s\n' "$OD/ultragoal-codereview-other-sid.json" | bash -c "source '$CORE'; codereview_guard_core_run '$OD' '$CRSID'")
    if [ -z "$out" ]; then
        return 0
    else
        echo "ASSERTION FAILED codereview-other-session-allows: expected empty (ALLOW), got '$out'"
        return 1
    fi
}

# =============================================================================
# SIGPIPE regression -- both write_guard_core_run and codereview_guard_core_run
# early `return 0` (exact match, glob match, or the code-reviewer identity
# bypass) WITHOUT draining the rest of stdin first. Every caller invokes these
# functions at the end of a pipe (`printf ... | write_guard_core_run ...`), so
# when the candidate stream left unread after the early return exceeds a real
# pipe's kernel buffer (64KB), the still-writing `printf` blocks and then gets
# SIGPIPE the moment this reader closes its end -- the pipeline's exit status
# becomes 141 under `pipefail`, discarding whatever this function already
# printed to its own stdout (a computed deny JSON, in two of the four cases
# below). This is deterministic on SIZE alone (a candidate stream >64KB after
# the matching line), never on scheduling luck -- `wg_oversized_candidates`
# below always emits ~268KB of harmless, never-matching trailing lines.
#
# `wg_pipefail_run` executes the pipeline inside its OWN `set -o pipefail`
# subshell (via the `$(...)` command substitution boundary), independent of
# whatever pipefail state this suite's own top-of-file `set -euo pipefail`
# happens to be in -- so a passing assertion here is never an artifact of how
# this file is invoked. Bash 3.2 has no nameref; results land in the globals
# WG_PF_OUT / WG_PF_RC by convention.
# =============================================================================

wg_oversized_candidates() {
    local i=0
    while [ "$i" -lt 4000 ]; do
        printf '/tmp/omt-wg-sigpipe-pad-%05d-0123456789abcdefghijklmnopqrstuvwxyz\n' "$i"
        i=$((i + 1))
    done
}

wg_pipefail_run() {
    # $1 = full stdin text (the matching candidate line(s) followed by the
    # oversized trailing padding); $2 = the reader snippet (source the core,
    # call the function under test).
    local stdin_text="$1" reader="$2"
    WG_PF_RC=0
    WG_PF_OUT=$(set -o pipefail; printf '%s' "$stdin_text" | bash -c "$reader") || WG_PF_RC=$?
}

test_sigpipe_ledger_exact_match_early_return_survives_oversized_trailing_candidates() {
    local expected stdin_text
    expected='{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Blocked: direct write/delete targets the durable session ledger (session-ledger-*.md). Use hooks/omt-ledger.sh append/now instead."}}'
    stdin_text="$(printf '%s\n' "$OD/session-ledger-$SID.md"; wg_oversized_candidates)"
    wg_pipefail_run "$stdin_text" "source '$CORE'; write_guard_core_run '$OD' '$SID'"
    if [ "$WG_PF_RC" -ne 0 ]; then
        echo "ASSERTION FAILED sigpipe-ledger-exact: expected exit 0, got exit $WG_PF_RC (a nonzero writer exit -- 141 when SIGPIPE terminates it, 1 when this shell reports the write() EPIPE itself -- means the >64KB trailing candidates after the EXACT-match early return killed the writer). out='$WG_PF_OUT'"
        return 1
    fi
    if [ "$WG_PF_OUT" != "$expected" ]; then
        echo "ASSERTION FAILED sigpipe-ledger-exact: expected deny JSON intact, got '$WG_PF_OUT'"
        return 1
    fi
}

test_sigpipe_ledger_glob_match_early_return_survives_oversized_trailing_candidates() {
    local expected stdin_text
    expected='{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Blocked: direct write/delete targets the durable session ledger (session-ledger-*.md). Use hooks/omt-ledger.sh append/now instead."}}'
    stdin_text="$(printf '%s\n' "$OD/session-ledger-*.md"; wg_oversized_candidates)"
    wg_pipefail_run "$stdin_text" "source '$CORE'; write_guard_core_run '$OD' '$SID'"
    if [ "$WG_PF_RC" -ne 0 ]; then
        echo "ASSERTION FAILED sigpipe-ledger-glob: expected exit 0, got exit $WG_PF_RC (a nonzero writer exit -- 141 when SIGPIPE terminates it, 1 when this shell reports the write() EPIPE itself -- means the >64KB trailing candidates after the GLOB-match early return killed the writer). out='$WG_PF_OUT'"
        return 1
    fi
    if [ "$WG_PF_OUT" != "$expected" ]; then
        echo "ASSERTION FAILED sigpipe-ledger-glob: expected deny JSON intact, got '$WG_PF_OUT'"
        return 1
    fi
}

test_sigpipe_codereview_identity_bypass_survives_oversized_candidates() {
    local stdin_text
    stdin_text="$(printf '%s\n' "$OD/ultragoal-codereview-$CRSID.json"; wg_oversized_candidates)"
    wg_pipefail_run "$stdin_text" "source '$CORE'; codereview_guard_core_run '$OD' '$CRSID' 'code-reviewer'"
    if [ "$WG_PF_RC" -ne 0 ]; then
        echo "ASSERTION FAILED sigpipe-codereview-identity-bypass: expected exit 0, got exit $WG_PF_RC (a nonzero writer exit -- 141 when SIGPIPE terminates it, 1 when this shell reports the write() EPIPE itself -- means the code-reviewer bypass, returning before reading ANY stdin, killed the writer against >64KB candidates). out='$WG_PF_OUT'"
        return 1
    fi
    if [ -n "$WG_PF_OUT" ]; then
        echo "ASSERTION FAILED sigpipe-codereview-identity-bypass: expected empty (ALLOW), got '$WG_PF_OUT'"
        return 1
    fi
}

test_sigpipe_codereview_deny_match_early_return_survives_oversized_trailing_candidates() {
    local expected stdin_text
    expected='{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Blocked: this code-review artifact (ultragoal-codereview-*.json / goal-codereview-*.json) may only be written by the code-reviewer subagent, not the orchestrator."}}'
    stdin_text="$(printf '%s\n' "$OD/ultragoal-codereview-$CRSID.json"; wg_oversized_candidates)"
    wg_pipefail_run "$stdin_text" "source '$CORE'; codereview_guard_core_run '$OD' '$CRSID' 'sisyphus-junior'"
    if [ "$WG_PF_RC" -ne 0 ]; then
        echo "ASSERTION FAILED sigpipe-codereview-deny: expected exit 0, got exit $WG_PF_RC (a nonzero writer exit -- 141 when SIGPIPE terminates it, 1 when this shell reports the write() EPIPE itself -- means the >64KB trailing candidates after the deny-match early return killed the writer). out='$WG_PF_OUT'"
        return 1
    fi
    if [ "$WG_PF_OUT" != "$expected" ]; then
        echo "ASSERTION FAILED sigpipe-codereview-deny: expected deny JSON intact, got '$WG_PF_OUT'"
        return 1
    fi
}

# =============================================================================
# Main
# =============================================================================

main() {
    echo "=========================================="
    echo "Write-Guard Core Tests"
    echo "=========================================="

    run_test test_ac1_byte_identical_deny
    run_test test_ac2_different_dir_session_ledger_allows
    run_test test_qa_substring_but_not_anchor_allows
    run_test test_qa_exact_current_ledger_denies
    run_test test_regression_dot_segment_denies
    run_test test_regression_double_slash_denies
    run_test test_regression_dotdot_segment_denies
    run_test test_regression_dot_segment_non_ledger_allows
    run_test test_glob_ledger_star_denies
    run_test test_glob_dir_star_denies
    run_test test_glob_non_matching_star_allows
    run_test test_glob_ancestor_star_allows
    run_test test_glob_dir_component_denies
    run_test test_glob_dir_component_wrong_depth_allows
    run_test test_glob_dotfile_segment_star_allows
    run_test test_glob_dotfile_literal_project_star_denies
    run_test test_glob_dotfile_basename_partial_star_denies
    run_test test_glob_dotfile_basename_star_denies
    run_test test_dangerous_rm_rf_denies
    run_test test_dangerous_rm_fr_denies
    run_test test_dangerous_rm_r_dash_f_denies
    run_test test_dangerous_git_push_force_denies
    run_test test_dangerous_git_push_origin_force_denies
    run_test test_dangerous_git_push_dash_f_denies
    run_test test_negative_plain_rm_allows
    run_test test_negative_rm_r_allows
    run_test test_negative_git_push_no_force_allows
    run_test test_dangerous_rm_rf_double_space_denies
    run_test test_dangerous_rm_rf_tab_denies
    run_test test_dangerous_git_push_force_multispace_denies
    run_test test_user_authorized_dismiss_review_finding_denies
    run_test test_user_authorized_approve_renewal_denies
    run_test test_user_authorized_resume_pursuit_denies
    run_test test_user_authorized_resume_pursuit_variable_indirection_denies
    run_test test_user_authorized_resume_pursuit_reverse_order_denies
    run_test test_user_authorized_resume_pursuit_whitespace_run_denies
    run_test test_user_authorized_qa_waive_denies
    run_test test_user_authorized_qa_waive_reverse_order_denies
    run_test test_user_authorized_qa_record_cell_noncollision_allows
    run_test test_user_authorized_qa_record_cell_waive_collision_denies
    run_test test_qa_state_exact_path_denies
    run_test test_qa_state_other_session_allows
    run_test test_qa_state_glob_current_session_denies
    run_test test_qa_state_glob_other_session_allows
    run_test test_qa_state_glob_nonmatching_allows
    run_test test_explain_diff_state_exact_path_denies
    run_test test_explain_diff_state_other_session_allows
    run_test test_explain_diff_state_glob_current_session_denies
    run_test test_user_authorized_variable_indirection_denies
    run_test test_user_authorized_reverse_order_denies
    run_test test_user_authorized_whitespace_run_denies
    run_test test_user_authorized_deny_names_user_run_route
    run_test test_negative_ultragoal_get_allows
    run_test test_negative_ultragoal_request_complete_allows
    run_test test_negative_ultragoal_set_verdict_allows
    run_test test_negative_subcommand_name_as_prose_allows
    run_test test_negative_double_space_nondangerous_allows
    run_test test_ac_codereview_byte_identical_deny
    run_test test_codereview_guard_ultragoal_empty_agent_type_denies
    run_test test_codereview_guard_ultragoal_missing_agent_type_denies
    run_test test_codereview_guard_ultragoal_code_reviewer_allows
    run_test test_codereview_guard_ultragoal_sisyphus_junior_denies
    run_test test_codereview_guard_goal_missing_agent_type_denies
    run_test test_codereview_guard_goal_code_reviewer_allows
    run_test test_codereview_guard_goal_sisyphus_junior_denies
    run_test test_codereview_guard_glob_candidate_missing_agent_type_denies
    run_test test_codereview_guard_dot_segment_missing_agent_type_denies
    run_test test_codereview_guard_verdict_artifact_allows
    run_test test_codereview_guard_sibling_path_allows
    run_test test_codereview_guard_other_session_allows
    run_test test_sigpipe_ledger_exact_match_early_return_survives_oversized_trailing_candidates
    run_test test_sigpipe_ledger_glob_match_early_return_survives_oversized_trailing_candidates
    run_test test_sigpipe_codereview_identity_bypass_survives_oversized_candidates
    run_test test_sigpipe_codereview_deny_match_early_return_survives_oversized_trailing_candidates

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [ "$TESTS_FAILED" -gt 0 ]; then
        exit 1
    fi
}

main "$@"

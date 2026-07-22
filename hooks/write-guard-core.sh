#!/bin/bash
# =============================================================================
# Write-Guard Core: the shared full-path anchor-match write-guard logic,
# sourced by both hooks/pre-tool-enforcer.sh (Claude) and the Codex
# PreToolUse hook. Holds TWO guard kinds, both built on the same
# _wg_core_normpath / _wg_core_pathwise_glob_match primitives below:
#
# 1. Unconditional deny (codex-ledger-parity plan, TODO 2) --
#    write_guard_core_run. Full-path EXACT match on the resolved
#    current-session ledger, PLUS a glob candidate (contains *, ?, or [)
#    whose pattern matches that resolved ledger path -- NEVER a bare
#    "session-ledger-" substring (that loose match is
#    hooks/pre-tool-enforcer.sh's superseded _wg_ledger_target_in_segment
#    classifier, hooks/pre-tool-enforcer.sh:42-77).
#
# 2. Identity-conditional allow (code-review-artifact-guard-core plan) --
#    codereview_guard_core_run. Same anchor-match machinery, but the verdict
#    also depends on a third argument, agent_type: the guarded path is
#    allowed ONLY when agent_type=="code-reviewer" (the one value a
#    PreToolUse hook can trust, since it comes from the harness's own
#    subagent-dispatch payload, never from agent-controlled tool_input) and
#    denied for every other agent_type INCLUDING absent/empty (fail-closed --
#    NOT because a main-thread call never carries agent_type (it can, on the
#    main thread of a session started with `--agent <name>`), but because
#    treating absence as allow would let an ordinary orchestrator forge the
#    artifact itself at zero extra cost. See CLAUDE.md's Code-review artifact
#    identity guard entry for the trust-channel rationale and the residual
#    `--agent code-reviewer` risk this leaves open).
#
# The per-platform shim owns extraction of candidate target paths from its
# own tool-input shape (Claude tool_input.file_path/.command; Codex
# apply_patch envelope) and OMT_DIR/session_id/agent_type resolution -- this
# core only does the exact-path comparison and emits the deny JSON.
# =============================================================================

# Single source of truth for the deny JSON: both platform shims
# (hooks/pre-tool-enforcer.sh for Claude, hooks/codex-write-guard.sh for
# Codex) source this core and call write_guard_core_run rather than building
# their own deny text -- keep both platforms' deny output identical (AC5).
_wg_core_deny_json='{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Blocked: direct write/delete targets the durable session ledger (session-ledger-*.md). Use hooks/omt-ledger.sh append/now instead."}}'

# Deny JSON for codereview_guard_core_run below. A DIFFERENT sentence from
# _wg_core_deny_json on purpose: this is not "don't touch an append-only
# ledger directly" -- it is "this artifact may only be authored by the
# code-reviewer subagent". Kept as a single source of truth here so both
# platform shims that call codereview_guard_core_run emit byte-identical deny
# text -- pinned by hooks/codex-write-guard_test.sh's
# test_ac4_codex_claude_deny_json_byte_identical -- rather than duplicating
# the wording.
_wg_core_codereview_deny_json='{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Blocked: this code-review artifact (ultragoal-codereview-*.json / goal-codereview-*.json) may only be written by the code-reviewer subagent, not the orchestrator."}}'

# _wg_core_normpath <path>
# Pure LEXICAL path normalization (os.path.normpath semantics): collapse
# empty (//), '.' and '..' segments WITHOUT touching the filesystem. This
# guard fires on paths that do NOT exist yet -- the write/delete is what
# would create them -- so realpath/readlink -f (which require the path to
# exist, and are non-portable on BSD) would false-negative on exactly the
# guarded case. Both the candidate and the ledger path pass through this
# before the EXACT compare, so a non-canonical spelling
# ($OMT_DIR/./session-ledger-<sid>.md, //session-ledger, a/../session-ledger)
# cannot bypass the anchor match. Symlink segments are NOT resolved (lexical
# only) -- safe here because the ledger dir is a plain $HOME/.omt/<name>
# directory, never a symlink.
_wg_core_normpath() {
    awk -v p="$1" 'BEGIN {
        abs = (substr(p, 1, 1) == "/")
        n = split(p, seg, "/")
        top = 0
        for (i = 1; i <= n; i++) {
            s = seg[i]
            if (s == "" || s == ".") continue
            if (s == "..") {
                if (top > 0 && st[top] != "..") { top-- }
                else if (!abs) { st[++top] = ".." }
                # abs && top==0: drop -- cannot escape root
            } else {
                st[++top] = s
            }
        }
        out = ""
        for (i = 1; i <= top; i++) out = out "/" st[i]
        if (abs) { if (out == "") out = "/" }
        else { out = substr(out, 2); if (out == "") out = "." }
        print out
    }'
}

# _wg_core_pathwise_glob_match <candidate-pattern-path> <concrete-ledger-path>
# Component-wise glob match WITH depth (segment-count) equality: splits both
# paths on '/' and compares segment-by-segment, using each candidate segment
# AS a glob pattern against the corresponding ledger segment. Returns 0 (match
# -> deny-worthy) only if EVERY segment matches AND both paths have the SAME
# number of segments. This mirrors real shell pathname expansion, where '*'
# matches within a single path segment and never spans '/' -- unlike a bash
# `case` pattern tested against the whole path, which would let '*' wrongly
# span directory boundaries. Absolute paths share a leading empty segment
# (the text before the leading '/') on both sides, so they stay in lockstep.
# Bash 3.2 compatible: no arrays, segments are peeled off with
# ${x%%/*} / ${x#*/} instead.
_wg_core_pathwise_glob_match() {
    local cand="$1" led="$2" cseg lseg
    while :; do
        if [ -z "$cand" ] && [ -z "$led" ]; then return 0; fi
        if [ -z "$cand" ] || [ -z "$led" ]; then return 1; fi
        cseg="${cand%%/*}"
        case "$cand" in */*) cand="${cand#*/}" ;; *) cand="" ;; esac
        lseg="${led%%/*}"
        case "$led" in */*) led="${led#*/}" ;; *) led="" ;; esac
        # Dotfile guard: with bash `dotglob` off (the shell default), a
        # leading '.' in a filename is matched ONLY by an explicit literal
        # '.' in the pattern -- never by a leading '*', '?', or '[...]'. So
        # if the ledger segment is a dotfile (e.g. ".omt"), a candidate
        # segment that doesn't itself start with a literal '.' cannot expand
        # onto it at real runtime; refuse the match before the glob check
        # below would otherwise wrongly allow it (bash `case` patterns DO
        # let '*' match a leading '.', unlike real pathname expansion).
        case "$lseg" in
            .*)
                case "$cseg" in
                    .*) ;;
                    *) return 1 ;;
                esac ;;
        esac
        # Intentionally unquoted: $cseg is used AS the glob pattern.
        case "$lseg" in $cseg) ;; *) return 1 ;; esac
    done
}

# write_guard_core_run <OMT_DIR> <session_id>
# Reads newline-separated already-absolutized candidate target paths on
# stdin. Emits the deny JSON to stdout iff any candidate is FULL-PATH EXACT
# equal to "$OMT_DIR/session-ledger-<session_id>.md", OR is a glob pattern
# (contains *, ?, or [) that, used as a shell pattern, matches that resolved
# ledger path (e.g. `rm "$OMT_DIR"/session-ledger-*.md` never EXACT-matches
# but would still destroy the current-session ledger); else emits nothing
# (allow).
write_guard_core_run() {
    local omt_dir="$1"
    local session_id="$2"
    local ledger_path
    ledger_path="$(_wg_core_normpath "$omt_dir/session-ledger-$session_id.md")"
    local candidate norm_candidate
    while IFS= read -r candidate; do
        norm_candidate="$(_wg_core_normpath "$candidate")"
        if [ "$norm_candidate" = "$ledger_path" ]; then
            printf '%s\n' "$_wg_core_deny_json"
            return 0
        fi
        # Glob candidate (e.g. `rm session-ledger-*.md`): never EXACT-matches,
        # but if the pattern matches the resolved ledger path, running the
        # command destroys the current ledger -> deny. Only globs that
        # ACTUALLY match the single known ledger path are denied; a
        # non-matching glob stays allow, so no false block.
        #
        # Match is component-wise WITH depth (segment-count) equality (see
        # _wg_core_pathwise_glob_match above): each candidate path segment is
        # used as a glob pattern against the ledger's SAME-position segment,
        # and the two paths must have the same segment count. This mirrors
        # real shell pathname expansion, where '*' matches within one path
        # segment only and never spans '/'. It correctly DENIES a glob
        # segment anywhere in the path -- basename (e.g. "$OMT_DIR/*") or an
        # intermediate directory component at the ledger's own depth (e.g.
        # "$HOME/.omt/"*"/session-ledger-<sid>.md") -- while still ALLOWing
        # an ancestor-level or depth-mismatched glob (e.g. "$HOME/*") whose
        # '*' never actually reaches the nested ledger at real runtime.
        case "$norm_candidate" in
            *[*?[]*)
                if _wg_core_pathwise_glob_match "$norm_candidate" "$ledger_path"; then
                    printf '%s\n' "$_wg_core_deny_json"
                    return 0
                fi
                ;;
        esac
    done
    return 0
}

# codereview_guard_core_run <OMT_DIR> <session_id> <agent_type>
# Reads newline-separated already-absolutized candidate target paths on
# stdin, same input convention as write_guard_core_run above. Guards exactly
# two current-session paths: "$OMT_DIR/ultragoal-codereview-<sid>.json" and
# "$OMT_DIR/goal-codereview-<sid>.json" (never a broader "*-codereview-*"
# pattern -- see the file banner for why the guarded set stays exactly these
# two). agent_type is the third positional arg; "${3:-}" so a caller that
# omits it entirely -- as hooks/write-guard-core_test.sh's direct 2-arg calls
# into this function do -- does not trip `set -u`. Both production shims
# always pass a third arg (empty string when unresolved, never omitted), so
# this default guards the test suite's calling convention, not a production
# payload shape.
#
# Verdict: agent_type=="code-reviewer" ALLOWS unconditionally (the loop below
# never even runs) -- any other value, including empty/absent, falls through
# to the same anchor-match logic as write_guard_core_run (EXACT match after
# _wg_core_normpath, OR a glob candidate that _wg_core_pathwise_glob_match
# resolves onto either guarded path) and DENIES on a match.
codereview_guard_core_run() {
    local omt_dir="$1"
    local session_id="$2"
    local agent_type="${3:-}"
    if [ "$agent_type" = "code-reviewer" ]; then
        return 0
    fi
    local ultragoal_path goal_path
    ultragoal_path="$(_wg_core_normpath "$omt_dir/ultragoal-codereview-$session_id.json")"
    goal_path="$(_wg_core_normpath "$omt_dir/goal-codereview-$session_id.json")"
    local candidate norm_candidate
    while IFS= read -r candidate; do
        norm_candidate="$(_wg_core_normpath "$candidate")"
        if [ "$norm_candidate" = "$ultragoal_path" ] || [ "$norm_candidate" = "$goal_path" ]; then
            printf '%s\n' "$_wg_core_codereview_deny_json"
            return 0
        fi
        case "$norm_candidate" in
            *[*?[]*)
                if _wg_core_pathwise_glob_match "$norm_candidate" "$ultragoal_path" \
                    || _wg_core_pathwise_glob_match "$norm_candidate" "$goal_path"; then
                    printf '%s\n' "$_wg_core_codereview_deny_json"
                    return 0
                fi
                ;;
        esac
    done
    return 0
}

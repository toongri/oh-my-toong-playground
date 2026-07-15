#!/bin/bash
# =============================================================================
# Write-Guard Core (codex-ledger-parity plan, TODO 2): the shared full-path
# anchor-match + byte-identical deny core for the ledger write-guard, sourced
# by both hooks/pre-tool-enforcer.sh (Claude) and the Codex PreToolUse hook.
# Full-path EXACT match on the resolved current-session ledger, PLUS a glob
# candidate (contains *, ?, or [) whose pattern matches that resolved ledger
# path -- NEVER a bare "session-ledger-" substring (that loose match is
# hooks/pre-tool-enforcer.sh's superseded _wg_ledger_target_in_segment
# classifier, hooks/pre-tool-enforcer.sh:42-77).
#
# The per-platform shim owns extraction of candidate target paths from its
# own tool-input shape (Claude tool_input.file_path/.command; Codex
# apply_patch envelope) and OMT_DIR/session_id resolution -- this core only
# does the exact-path comparison and emits the deny JSON.
# =============================================================================

# Single source of truth for the deny JSON: both platform shims
# (hooks/pre-tool-enforcer.sh for Claude, hooks/codex-write-guard.sh for
# Codex) source this core and call write_guard_core_run rather than building
# their own deny text -- keep both platforms' deny output identical (AC5).
_wg_core_deny_json='{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Blocked: direct write/delete targets the durable session ledger (session-ledger-*.md). Use hooks/omt-ledger.sh append/now instead."}}'

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

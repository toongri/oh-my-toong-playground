#!/bin/bash
# =============================================================================
# Codex PreToolUse Write-Guard (codex-ledger-parity plan, TODO 7): a thin
# Codex-specific shim that parses Codex write routes (apply_patch envelope,
# Bash-embedded apply_patch heredoc, shell redirect/tee/rm, native
# Edit/Write/MultiEdit), resolves OMT_DIR/session_id, absolutizes candidate
# targets against cwd, and delegates the actual full-path anchor-match + deny
# JSON to write_guard_core_run (hooks/write-guard-core.sh) -- this file never
# emits the deny JSON itself, and never folds apply_patch parsing into the
# shared core (that would drift Claude's byte-identical deny at
# hooks/pre-tool-enforcer.sh).
#
# tool_name is normalized to lowercase before routing (mirroring the sibling
# extractor hooks/rules-injector/tool-paths.ts:29's toLowerCase()), so both
# capitalized native names (Edit/Write) and Codex's lowercase native names
# (write/edit/multiedit/multi_edit) are covered by one case arm each.
# Write-route set mirrors the sibling PostToolUse matcher (codex.yaml:45):
# apply_patch | bash | exec_command | shell_command | edit | write |
# multiedit | multi_edit.
#
# BEST-EFFORT, not security-complete: headers/targets are absolutized
# against cwd to cover the common case, not a full shell parser.
#
# The substring-blacklist -> full-path-EXACT-match migration (write-guard-
# core.sh) narrowed the contract on purpose: forms the old substring scan
# used to catch are OUT OF SCOPE here and are not going to be chased with
# more parsing. This shim is a best-effort literal-text scan, not a shell
# interpreter, and cannot tractably catch:
#   - cd into the ledger dir then a relative-path write/delete
#     (`cd "$OMT_DIR" && rm session-ledger-$SID.md` -- relative target
#     resolved against a pre-`cd` cwd this hook never sees)
#   - variable indirection (`p=$OMT_DIR; rm "$p/session-ledger-..."`)
#   - parameter expansion other than the handled $OMT_DIR/$OMT_SESSION_ID/
#     $CODEX_THREAD_ID/$HOME/~ (e.g. `> "${OMT_DIR%/}/..."`)
#   - process substitution
#   - brace expansion (`rm session-ledger-{<sid>,x}.md`)
#   - ANSI-C $'...' quoting
#   - adjacent/combined multi-target redirects glued without whitespace
#     (`>a>b`, `>&file`)
#   - an OMT_DIR containing whitespace (operand splitting)
# This same list is kept in wording-parity with the Claude twin's best-effort
# discussion (hooks/pre-tool-enforcer.sh) so the two shims stay in sync on
# what is acknowledged-but-not-chased.
#
# omt-hook-dep: lib/omt-dir.sh
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/write-guard-core.sh"

# stdin is read unconditionally, BEFORE the jq-presence check below -- the
# jq-absent fallback path (further down) still needs the raw payload text to
# run a best-effort dangerous-command scan.
input=$(cat)

# _cwg_mask_quoted <shell_command_text>
# Quote-aware normalizer, originally re-derived from the Claude twin's
# _wg_scan (hooks/pre-tool-enforcer.sh:160-179) but now WIDER than it: masks
# shell-active metacharacters (`> < | ; &`) that appear INSIDE a
# single-quoted OR double-quoted span by replacing them with a space, and
# drops the quote CHARACTERS themselves while preserving the quoted CONTENT
# -- so prose like `printf 'see foo > <ledger> here' | omt-ledger.sh append`
# is never misread by the redirect/segment-splitter logic below as a live
# redirect or a live `|`/`;`/`&` chain separator. Without single-quote
# masking, ANY `>`/`;`/etc in the raw shell text -- quoted or not -- was
# read as live; without double-quote masking (CONFIRMED bypass, independent
# code review + directly reproduced), a DOUBLE-quoted separator such as
# `echo "note; rm -rf /tmp/x"` was split the same as a real `;` chain,
# denying an entirely harmless command with no bypass/ask escape hatch on
# this deny-only gate.
#
# Why double-quote masking belongs here, not just single: the dangerous-
# command guard further below exists to emulate claude.yaml's own
# `permissions.deny` glob evaluation (`Bash(rm -rf *)` etc.), which Claude
# Code evaluates with its own shell-aware parser -- and that parser reads
# `echo "note; rm -rf /tmp/x"` as ONE `echo` invocation with one argument,
# never as a chain, so Claude ALLOWS it natively. A single-quote-only masker
# here disagreed with that real Claude behavior and denied it -- the
# widened masker below is what makes this shim's verdict match Claude's
# actual behavior, not a departure from it. The Claude-side _wg_scan used by
# the ledger-guard route now masks double-quoted spans too (hooks/pre-tool-
# enforcer.sh) -- it was single-quote-only until the parity fix, which is why
# `echo "note; rm <ledger>"` was DENIED there while ALLOWED here. Measured
# after the fix: both sides allow it, and both still DENY the unquoted
# `echo hi; rm <ledger>`.
#
# Nested-quote and escape handling (kept minimal, NOT a shell parser): a
# single quote appearing literally inside a double-quoted span (and vice
# versa) does not toggle the wrong quote state -- each toggle check is
# gated on the OTHER quote type being inactive.
#
# CONFIRMED false-deny fix (both-platform measurement): an escaped `\;`/
# `\|`/`\&`/`\>`/`\<` outside single-quote mode is DEAD text at real
# execution time -- outside any quotes it is a literal escaped character,
# never a chain separator or redirect; inside double quotes the backslash
# has no escaping power over these characters at all (bash keeps both chars
# literal there), but they are ALREADY dead text because they sit inside a
# quoted span. Either way the metachar must never reach the chain-splitter
# or redirect/rm extractor below as if it were live. The prior version
# preserved the backslash-escaped pair completely untouched (`out = out c
# substr($0, i+1, 1)`), leaving the raw metachar character sitting in `out`
# -- so `echo safe \; rm -rf /tmp/x` (real shell: ECHO prints the whole
# literal string, rm never runs) was misread as a real `;`-separated chain
# by the sed-based splitter downstream, denying an entirely harmless
# command with no bypass/ask escape hatch on this deny-only gate. Fix: when
# the escaped character is one of the metachars this masker tracks, mask it
# (two spaces, dropping both the backslash and the metachar) exactly like a
# quoted occurrence; any OTHER escaped character is still preserved
# literally as before (this masker's job is metachar liveness, not general
# backslash removal).
#
# Comment truncation (CONFIRMED false-deny fix): outside any quote/
# command-substitution/backtick span, a `#` that starts a shell WORD (the
# very first character of the line, or immediately preceded by whitespace)
# begins a comment that runs to end of line at real execution time -- text
# after it is never parsed as shell code. `echo safe # note; rm -rf /tmp/x`
# never runs `rm -rf`; only `safe` is printed. The prior version had no
# comment awareness at all, so the dangerous-command pattern behind the `#`
# was still visible to the chain-splitter and denied a harmless command.
# Only a WORD-LEADING `#` is treated as a comment (mirroring real shell
# tokenizing) -- `foo#bar` (no leading whitespace) is NOT a comment start
# and is left untouched. A backslash-escaped `#` is consumed whole by the
# escape branch above and never reaches this check, so `\#` is not
# mistaken for a comment leader either. Scoped to the same "live" context as
# every other check here (not inside single/double quotes, not inside a
# live $()/backtick span) -- a `#` nested inside a live command
# substitution is left for that substitution's own (unmodeled) grammar, per
# this file's "not a shell interpreter" posture.
#
# Process substitution, ANSI-C `$'...'` quoting, and other exotic shell
# grammar are still out of scope, per this file's header "not a shell
# interpreter" list. This is independently re-derived bash+awk, not sourced
# from the sibling file (Claude/Codex parsing intentionally never shares
# code, see the file header) -- so the two guards can still diverge if one
# is edited without the other.
#
# CONFIRMED REGRESSION FIX (double-quote masking widened too far): a
# `$( ... )` or `` ` ... ` `` command substitution nested INSIDE a
# double-quoted span is live shell code the outer shell actually executes --
# `echo "$(true; rm -rf /tmp/x)"` really runs `rm -rf /tmp/x` -- unlike
# ordinary dq prose, which is dead text. The masking above (correctly) drops
# a `;`/`|`/etc that sits directly inside dq prose, but was ALSO dropping one
# that sits inside a nested `$( ... )`/backtick span, hiding a real chain
# separator from the dangerous-command scan and the redirect/rm extractor
# below -- a silent allow of a live destructive command. Fix: while indq is
# active, entering a literal `$(` or a backtick suspends masking (and quote
# toggling) for that span -- metacharacters pass through untouched, exactly
# as they would outside any quotes -- until the matching `)` (paren-depth
# counted, so `$( $( ) )` nests correctly) or the closing backtick is seen,
# at which point normal dq masking resumes. Single-quoted spans are NOT
# given this treatment: `$( )`/backticks inside single quotes are inert
# shell literals (never expand), so masking them stays correct as-is.
#
# Defined here (ahead of both the jq-presence check and the "Extraction
# helpers" section further below, which also calls it) because the
# dangerous-command guard -- reachable from BOTH the jq-present route below
# AND the jq-absent fallback further up in file order -- is a caller and
# must never see this function undefined.
_cwg_mask_quoted() {
    printf '%s' "$1" | awk '
        BEGIN { sq = sprintf("%c", 39); dq = sprintf("%c", 34); bs = sprintf("%c", 92); dl = sprintf("%c", 36); lp = sprintf("%c", 40); rp = sprintf("%c", 41); bt = sprintf("%c", 96); hs = sprintf("%c", 35) }
        {
            n = length($0)
            insq = 0
            indq = 0
            dpdepth = 0
            btactive = 0
            out = ""
            for (i = 1; i <= n; i++) {
                c = substr($0, i, 1)

                # Backslash: special everywhere EXCEPT single-quote mode
                # (real shells give backslash no escaping power there). If
                # the escaped char is one of the metachars this masker
                # tracks, mask the PAIR (it is dead text / never a live
                # separator at real execution time, see docstring above);
                # any other escaped char is preserved literally so it
                # cannot toggle quote state or be read as a metachar -- an
                # escaped `\"` must not desync in-quote tracking.
                if (c == bs && !insq && i < n) {
                    nc = substr($0, i + 1, 1)
                    if (nc == ">" || nc == "<" || nc == "|" || nc == ";" || nc == "&") {
                        out = out "  "
                    } else {
                        out = out c nc
                    }
                    i++
                    continue
                }

                # Inside a live $( ... ) command-substitution span: pass
                # every character through untouched (no masking, no quote
                # toggling) while tracking paren depth so a nested $( ... )
                # or a plain ( ) inside the substitution body is matched
                # correctly.
                if (dpdepth > 0) {
                    if (c == lp) { dpdepth++ }
                    else if (c == rp) { dpdepth-- }
                    out = out c
                    continue
                }
                # Inside a live backtick `...` span: pass through untouched
                # until the closing backtick.
                if (btactive) {
                    if (c == bt) { btactive = 0 }
                    out = out c
                    continue
                }

                # Entering a live span only matters while indq is active --
                # outside any quotes, metacharacters are already unmasked
                # (the final condition below never fires), so no special
                # handling is needed there. Inside single quotes, $( )/
                # backticks are inert text and must stay masked as-is.
                if (indq && c == dl && i < n && substr($0, i + 1, 1) == lp) {
                    dpdepth = 1
                    out = out c lp
                    i++
                    continue
                }
                if (indq && c == bt) {
                    btactive = 1
                    out = out c
                    continue
                }

                if (!indq && c == sq) {
                    insq = 1 - insq
                    continue
                }
                if (!insq && c == dq) {
                    indq = 1 - indq
                    continue
                }
                if ((insq || indq) && (c == ">" || c == "<" || c == "|" || c == ";" || c == "&")) {
                    out = out " "
                    continue
                }
                # Comment truncation: a live (unquoted, not inside a $()/
                # backtick span) '#' that starts a shell WORD -- start of
                # line, or immediately preceded by whitespace -- begins a
                # comment that runs to end of line at real execution time.
                # Everything from here on is dropped (not masked to spaces:
                # comment text carries no position-preservation need).
                if (!insq && !indq && dpdepth == 0 && !btactive && c == hs && (out == "" || substr(out, length(out), 1) ~ /[ \t]/)) {
                    break
                }
                out = out c
            }
            print out
        }'
}

# _cwg_strip_heredoc_bodies <shell_command_text>
# Removes the BODY of every here-document embedded in the text (operator
# `<<` or `<<-`, delimiter optionally single- or double-quoted) before the
# dangerous-command guard scans it -- heredoc body lines are literal data
# fed to the command's stdin, never parsed/executed as shell code, so a
# destructive-looking string sitting inside one (e.g. `cat <<'EOF'` /
# `rm -rf /tmp/x` / `EOF`) must not be read as a live command. The heredoc
# START line itself (up to and including the `<<DELIM` token) is KEPT --
# real shell/chain content can precede or follow the marker on that same
# line (`cmd <<'EOF' && next`) -- only the BODY lines, up to and including
# the terminator line, are dropped.
#
# Scope note: this is called ONLY from the dangerous-command guard's own
# command text, NOT from the ledger/code-review-artifact candidate
# extraction route (_cwg_process_shell_text further below) -- that route's
# OWN apply_patch-heredoc handling (_cwg_extract_heredoc_body) depends on
# reading INTO a heredoc body to find `*** Update File:` headers, which
# this general stripper would blank out. The two heredoc handlers serve
# opposite needs (one must see inside; one must not) and are intentionally
# separate.
#
# Best-effort, matching this file's "not a shell interpreter" posture: only
# the FIRST heredoc marker on a given line is recognized (multiple heredocs
# on one line, e.g. `cmd <<A <<B`, is a rare construct left unhandled), and
# a `<<DELIM` token appearing inside an already-quoted string on the same
# line is not specially excluded.
_cwg_strip_heredoc_bodies() {
    local text="$1"
    local out="" line delim="" striptabs=0 inhd=0 cmp marker
    while IFS= read -r line || [ -n "$line" ]; do
        if [ "$inhd" -eq 1 ]; then
            cmp="$line"
            if [ "$striptabs" -eq 1 ]; then
                cmp="${cmp#"${cmp%%[!$'\t']*}"}"
            fi
            if [ "$cmp" = "$delim" ]; then
                inhd=0
            fi
            continue
        fi
        marker=$(printf '%s\n' "$line" | grep -oE "<<-?[[:space:]]*['\"]?[A-Za-z_][A-Za-z0-9_]*['\"]?" | head -1) || marker=""
        if [ -n "$marker" ]; then
            striptabs=0
            case "$marker" in "<<-"*) striptabs=1 ;; esac
            delim=$(printf '%s' "$marker" | sed -E "s/^<<-?[[:space:]]*//; s/^['\"]//; s/['\"]\$//")
            inhd=1
        fi
        out="${out}${line}"$'\n'
    done <<< "$text"
    printf '%s' "$out"
}

# jq is required for full JSON-shaped extraction (tool_name routing,
# apply_patch multi-key payloads, Edit/Write path-key scanning, session-id/
# OMT_DIR resolution, candidate absolutization). When jq is ABSENT, this
# hook used to fail open UNCONDITIONALLY (exit 0) before even the
# dangerous-command guard ran -- but that guard exists specifically to
# emulate Claude's OWN native, jq-independent `permissions.deny` glob
# enforcement (claude.yaml), so the two platforms' verdicts on the exact
# same `rm -rf`/`git push --force` diverged whenever jq happened to be
# missing from PATH, even though Claude's deny has nothing to do with jq.
# Below: a raw-text (no JSON parsing) best-effort extraction of
# tool_input.command/.cmd sufficient to still run the dangerous-command
# guard, same best-effort grep class as pre-tool-enforcer.sh's
# extract_json_field (stops at the first unescaped-looking '"', so an
# embedded escaped quote in the value is not handled). Everything else this
# hook does (ledger guard, code-review artifact guard, apply_patch/Edit/
# Write routes) still requires jq and stays fail-open on this path,
# unchanged -- this is a floor under the one deny Codex has no other
# mechanism for, not a full jq-free reimplementation of the hook.
if ! command -v jq > /dev/null 2>&1; then
    _cwg_nojq_extract_str_field() {
        printf '%s' "$input" \
            | grep -o "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" \
            | head -1 \
            | sed -E "s/^\"$1\"[[:space:]]*:[[:space:]]*\"//; s/\"\$//"
    }
    _cwg_nojq_cmd=$(_cwg_nojq_extract_str_field command) || _cwg_nojq_cmd=""
    if [ -z "$_cwg_nojq_cmd" ]; then
        _cwg_nojq_cmd=$(_cwg_nojq_extract_str_field cmd) || _cwg_nojq_cmd=""
    fi
    if [ -n "$_cwg_nojq_cmd" ]; then
        _cwg_nojq_stripped=$(_cwg_strip_heredoc_bodies "$_cwg_nojq_cmd")
        _cwg_nojq_masked=$(_cwg_mask_quoted "$_cwg_nojq_stripped")
        while IFS= read -r _cwg_nojq_seg; do
            [ -n "$_cwg_nojq_seg" ] || continue
            _cwg_nojq_out=$(write_guard_core_check_dangerous_command "$_cwg_nojq_seg")
            if [ -n "$_cwg_nojq_out" ]; then
                printf '%s\n' "$_cwg_nojq_out"
                exit 0
            fi
        done < <(printf '%s\n' "$_cwg_nojq_masked" | sed -E 's/(&&|\|\||;|\||&)/\n/g')
    fi
    exit 0
fi

# Normalize tool_name to lowercase before routing, mirroring the sibling
# extractor hooks/rules-injector/tool-paths.ts:29 (toLowerCase()) -- Codex
# has been observed sending native write tools under their lowercase form
# (write/edit/multiedit/multi_edit), which the allow-list below used to miss
# entirely, falling through to `exit 0` before ever reaching the ledger-path
# check. macOS Bash 3.2 has no ${var,,}, so tr is used instead.
tool_name_raw=$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null) || tool_name_raw=""
tool_name=$(printf '%s' "$tool_name_raw" | tr '[:upper:]' '[:lower:]')

case "$tool_name" in
    apply_patch | bash | exec_command | shell_command | edit | write | multiedit | multi_edit) ;;
    *) exit 0 ;;
esac

# Claude<->Codex parity story 9/9, AC2/AC4: dangerous-command guard (rm -rf,
# git push --force) runs FIRST, independent of the ledger session-id/OMT_DIR
# resolution below -- it needs neither. Deliberately placed before that
# resolution block: a resolution failure there fail-OPENs via _cwg_halt
# (exit 0, allow) because the LEDGER guard cannot do its job without a
# resolved session id -- but this dangerous-command guard has no such
# dependency, and must not silently inherit that unrelated fail-open.
#
# Heredoc-body stripping (_cwg_strip_heredoc_bodies) runs BEFORE quote-aware
# masking (CONFIRMED false-deny fix, both-platform measurement): a
# destructive-looking string sitting inside a heredoc BODY (e.g.
# `cat <<'EOF'` / `rm -rf /tmp/x` / `EOF`) is literal stdin data, never
# parsed as shell code, so it must never reach the chain-splitter below.
#
# Quote-aware masking (_cwg_mask_quoted, same function the shell-target route
# below uses) is applied BEFORE chain-splitting, mirroring that sibling route
# exactly (code-review CONFIRMED fix, both single- and double-quoted spans):
# without it, a `;`/`|` inside a quoted string (e.g. `echo 'note; rm -rf
# /tmp/x'` OR `echo "note; rm -rf /tmp/x"`) was read the same as a live
# chain separator, splitting the segment so its second half
# (`rm -rf /tmp/x'` / `rm -rf /tmp/x"`) matched the dangerous-command
# pattern and denied an otherwise-harmless command -- with no bypass/ask
# escape hatch on this deny-only gate, that false deny was unrecoverable for
# the user. Masking finds correct split points; write_guard_core_check_
# dangerous_command is then called per split segment exactly as before --
# see _cwg_mask_quoted's own docstring for why double-quote coverage is
# required for actual parity with Claude's native shell-aware permission-deny
# evaluation, not an optional widening.
#
# Chain-separator set includes a single `&` (background operator) alongside
# `&&`/`||`/`;`/`|` (CONFIRMED bypass, both-platform measurement):
# `echo safe & rm -rf /tmp/x` backgrounds the echo and runs `rm -rf` as its
# own command at real execution time, but the prior separator set did not
# include a lone `&`, so the whole string was scanned as ONE segment that
# never matched any dangerous-command pattern -- silently ALLOWING it, while
# Claude's own shell-aware parser (which does recognize `&`) denies it
# natively. `&&` is listed before the lone `&` in the alternation so a real
# `&&` is not mis-split into two `&` matches.
case "$tool_name" in
    bash | exec_command | shell_command)
        for _cwg_dc_key in command cmd; do
            _cwg_dc_cmd=$(printf '%s' "$input" | jq -r --arg k "$_cwg_dc_key" '.tool_input[$k] // empty' 2>/dev/null) || _cwg_dc_cmd=""
            [ -n "$_cwg_dc_cmd" ] || continue
            _cwg_dc_stripped=$(_cwg_strip_heredoc_bodies "$_cwg_dc_cmd")
            _cwg_dc_masked=$(_cwg_mask_quoted "$_cwg_dc_stripped")
            while IFS= read -r _cwg_dc_seg; do
                [ -n "$_cwg_dc_seg" ] || continue
                _cwg_dc_out=$(write_guard_core_check_dangerous_command "$_cwg_dc_seg")
                if [ -n "$_cwg_dc_out" ]; then
                    printf '%s\n' "$_cwg_dc_out"
                    exit 0
                fi
            done < <(printf '%s\n' "$_cwg_dc_masked" | sed -E 's/(&&|\|\||;|\||&)/\n/g')
        done
        ;;
esac

cwd=$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null) || cwd=""
stdin_sid=$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null) || stdin_sid=""

# -----------------------------------------------------------------------------
# Shared session-id precedence contract (the same resolution used by the
# ledger-recording core and the omt-ledger.sh CLI self-resolution):
# session_id = OMT_SESSION_ID ?? CODEX_THREAD_ID, STRICT EMPTY-ONLY coalescing
# (present-but-empty falls through; present-but-unsafe REFUSES/HALTs).
# Mismatch-halt: `stdin.session_id` is a cross-check against this resolved
# sid -- a present-but-DIVERGENT stdin.session_id, or the total absence of a
# resolvable sid (no OMT_SESSION_ID and no CODEX_THREAD_ID, so the CLI cannot
# record to any ledger), triggers a loud-but-fail-open diagnostic (see
# _cwg_halt below), not a hard block -- and not actually a wrong-ledger
# guard either: both the ledger writer (omt-ledger.sh) and this guard
# resolve the ledger path env-first (OMT_SESSION_ID ?? CODEX_THREAD_ID) and
# never from stdin.session_id, so a divergent stdin sid can never point at
# the wrong (or a nonexistent) ledger in the first place.
# -----------------------------------------------------------------------------
_cwg_charset_ok() {
    printf '%s' "$1" | grep -Eq '^[A-Za-z0-9_-]{1,200}$'
}

# _cwg_halt: fail-OPEN (exit 0), not fail-closed. This repo's block signal
# is deny-JSON-on-stdout with exit 0 -- write_guard_core_run (hooks/write-
# guard-core.sh) returns 0 on both the deny path and the allow path, and no
# caller of this hook inspects the exit code. A HALT here means the guard
# could not trust its inputs enough to resolve a session id -- the same
# "can't do the job, so don't block" class as the jq-absent fail-open a few
# lines up, and the same policy as the Claude twin (hooks/pre-tool-
# enforcer.sh), which has no hard-halt at all. Failing CLOSED (nonzero
# exit) would risk Codex treating it as fail-closed and blocking every
# apply_patch/Bash/edit/write/exec_command/shell_command call for the rest
# of the session -- a best-effort, not-security-complete guard must not be
# able to brick the agent on an unverified runtime assumption. The stderr
# line stays a loud diagnostic either way.
#
# AC3 coupling: hooks/codex-write-guard_test.sh's
# test_ac3_divergent_session_id_halts greps this stderr line for the tokens
# halt|mismatch|diverg -- keep at least one of those tokens in the message
# if it is ever reworded.
_cwg_halt() {
    echo "HALT: codex-write-guard session-id mismatch/diverged -- $1" >&2
    exit 0
}

cli_sid=""
if [ -n "${OMT_SESSION_ID:-}" ]; then
    _cwg_charset_ok "$OMT_SESSION_ID" || _cwg_halt "OMT_SESSION_ID is present but unsafe: '$OMT_SESSION_ID'"
    cli_sid="$OMT_SESSION_ID"
elif [ -n "${CODEX_THREAD_ID:-}" ]; then
    _cwg_charset_ok "$CODEX_THREAD_ID" || _cwg_halt "CODEX_THREAD_ID is present but unsafe: '$CODEX_THREAD_ID'"
    cli_sid="$CODEX_THREAD_ID"
else
    _cwg_halt "CODEX_THREAD_ID absent -- the CLI cannot resolve a session id to record to"
fi

if [ -n "$stdin_sid" ] && [ "$stdin_sid" != "$cli_sid" ]; then
    _cwg_halt "stdin.session_id='$stdin_sid' diverges from resolved sid='$cli_sid'"
fi

sid="$cli_sid"

# -----------------------------------------------------------------------------
# Resolve OMT_DIR: env OMT_DIR wins when set; else git-derive from stdin.cwd
# (resolve_omt_dir already no-ops and returns the env value when OMT_DIR is
# set, but stdin.cwd is required for the git-derive fallback).
# -----------------------------------------------------------------------------
omt_dir="${OMT_DIR:-}"
if [ -z "$omt_dir" ]; then
    if [ -z "$cwd" ]; then
        _cwg_halt "OMT_DIR unset and stdin.cwd absent -- cannot resolve the ledger directory"
    fi
    omt_dir=$(source "$SCRIPT_DIR/lib/omt-dir.sh" && unset OMT_DIR && resolve_omt_dir "$cwd")
fi

[ -n "$cwd" ] || cwd="$PWD"

# -----------------------------------------------------------------------------
# Extraction helpers. Each prints zero or more RAW (not-yet-absolutized)
# candidate target paths, one per line.
# -----------------------------------------------------------------------------

# _cwg_extract_patch_headers <patch_text>
# Header-only scan of an apply_patch envelope (or a Bash-embedded heredoc
# body carrying the same grammar) for the four envelope header forms.
# tr -d '\r' tolerates CRLF header lines.
_cwg_extract_patch_headers() {
    printf '%s\n' "$1" | tr -d '\r' \
        | grep -E '^\*\*\* (Add File|Update File|Delete File|Move to): ' \
        | sed -E 's/^\*\*\* (Add File|Update File|Delete File|Move to): //'
}

# _cwg_extract_heredoc_body <shell_command_text>
# Locates an `apply_patch <<[-]['"]DELIM['"] ... DELIM` heredoc embedded in a
# Bash command and prints its body. This is its OWN surface -- it does not
# reuse the tool-path parser's coverage. Only the heredoc opened by
# `apply_patch <<...` is captured; an unrelated heredoc earlier in the same
# command (e.g. `cat <<'NOTE' ... NOTE`) is not scanned.
_cwg_extract_heredoc_body() {
    local cmd="$1"
    local delim
    delim=$(printf '%s\n' "$cmd" \
        | grep -oE "apply_patch[[:space:]]*<<-?[[:space:]]*['\"]?[A-Za-z_][A-Za-z0-9_]*['\"]?" \
        | head -1 \
        | sed -E "s/.*<<-?[[:space:]]*['\"]?([A-Za-z_][A-Za-z0-9_]*)['\"]?/\\1/") || delim=""
    [ -n "$delim" ] || return 0
    printf '%s\n' "$cmd" | awk -v delim="$delim" '
        BEGIN { capture = 0 }
        !capture && $0 ~ /apply_patch[ \t]*<</ { capture = 1; next }
        capture && $0 == delim { capture = 0; next }
        capture { print }
    '
}

# _cwg_extract_shell_targets <chain_segment>
# Redirect / tee / rm / cp / mv / sed -i / dd / truncate write-target
# extraction, mirroring the segment-classifier shape of
# hooks/pre-tool-enforcer.sh:42-77 (_wg_ledger_target_in_segment) but
# EXTRACTING the candidate target rather than merely testing a substring --
# the core does full-path EXACT match, so the actual candidate path is
# required.
_cwg_extract_shell_targets() {
    local seg="$1"
    local first_word
    first_word=$(printf '%s' "$seg" | awk '{print $1}')

    # Redirect target: the token after the last `>` / `>>`. Over-extract,
    # like the Claude twin (hooks/pre-tool-enforcer.sh:115): no leading-char
    # exclusion for fd-dups (`2>&1`, `>&2`) here -- an earlier version
    # excluded a digit/`&` immediately before `>` to skip fd-dups, but that
    # same exclusion also skipped the FILE-target forms `2>`/`&>` (a digit
    # or `&` sits right before `>` there too), silently ALLOWING a real
    # ledger redirect through either form. write_guard_core_run does the
    # actual EXACT match, so an over-extracted fd-dup operand (e.g. `&1`
    # from `2>&1`) simply never matches the ledger path -- harmless.
    # `|| true`: grep -oE returns 1 when a segment has no redirect at all --
    # under this script's `set -euo pipefail`, an unguarded nonzero pipeline
    # here would abort the function (via the process-substitution subshell
    # that invokes it) before the case block below -- tee/rm/truncate/cp/mv/
    # sed -i/dd -- ever runs, silently ALLOWING those write routes.
    printf '%s\n' "$seg" \
        | grep -oE '>{1,2}[[:space:]]*[^[:space:]]+' \
        | sed -E 's/^.*>{1,2}[[:space:]]*//' || true

    case "$first_word" in
        tee | rm | truncate)
            printf '%s\n' "$seg" | awk '{for (i = 2; i <= NF; i++) if ($i !~ /^-/) print $i}'
            ;;
        cp)
            # Destination only. `cp <guarded> /tmp/x` READS the guarded path
            # and leaves it intact, so extracting the source operand here
            # would false-deny a harmless copy.
            printf '%s\n' "$seg" | awk '{print $NF}'
            ;;
        mv)
            # Every non-option operand, not just the last -- `mv` DELETES its
            # source, so `mv <guarded> /tmp/x` removes the guarded path exactly
            # like `rm <guarded>`, which the tee/rm/truncate arm above already
            # catches. $NF alone saw only the destination, leaving the delete
            # leg of the write/delete contract open through this one verb.
            # Split from `cp` above because only `mv` is destructive; mirrors
            # the Claude twin's own cp/mv split in hooks/pre-tool-enforcer.sh.
            printf '%s\n' "$seg" | awk '{for (i = 2; i <= NF; i++) if ($i !~ /^-/) print $i}'
            ;;
        sed)
            if printf '%s\n' "$seg" | grep -q -- '-i'; then
                printf '%s\n' "$seg" | awk '{for (i = 2; i <= NF; i++) if ($i !~ /^-/) print $i}'
            fi
            ;;
        dd)
            # Same set -e/pipefail hazard as the redirect grep above:
            # `of=` is absent for a plain `dd if=x` read, so this grep can
            # legitimately return 1.
            printf '%s\n' "$seg" | grep -oE 'of=[^[:space:]]+' | sed 's/^of=//' || true
            ;;
    esac
}

# _cwg_mask_quoted is defined earlier in this file (before the
# dangerous-command guard, its first use in file order) -- see there for the
# full docstring. Reused here unmodified by _cwg_process_shell_text below.

# _cwg_strip_quotes <token> -- removes EVERY double-quote and single-quote
# character in the token (not just one outermost pair each way), mirroring
# what a real shell does to a word during expansion: quote characters never
# survive into the expanded value, however many separately-quoted spans are
# concatenated to build the word. A single-outermost-pair strip (this
# function's earlier form, and the Claude twin's _wg_strip_dquotes at
# hooks/pre-tool-enforcer.sh:52-57) is correct only when the whole token is
# ONE quoted span -- it under-strips a token built from several ADJACENT
# quoted spans with no separating whitespace, e.g.
# "$OMT_DIR"/"session-ledger-$OMT_SESSION_ID.md" (a single shell word, no
# space between the closing and opening quotes): stripping only the very
# first and last quote character left the INNER quote characters (around the
# literal `/`) embedded in the candidate, so after env-var substitution in
# _cwg_absolutize the candidate carried stray `"` characters and never
# full-path EXACT matched the real ledger path -- a silent bypass. Removing
# every quote character unconditionally fixes this: a legitimate non-ledger
# target loses its (already load-bearing-only-for-shell-parsing) quote
# characters the same way and still resolves to its real path, so this is
# over-removal that is harmless for write_guard_core_run's EXACT compare (a
# ledger path itself never contains a quote character).
#
# ${s//\"/} / ${s//\'/} are pure bash parameter-expansion substitutions
# (global, not first-match), Bash 3.2 compatible -- no eval/sed needed.
_cwg_strip_quotes() {
    local s="$1"
    s="${s//\"/}"
    s="${s//\'/}"
    printf '%s\n' "$s"
}

# _cwg_absolutize <path>
# Strips surrounding quotes, expands the three known ledger-path env-vars
# via pure bash literal substitution, then joins a relative path against the
# resolved cwd; leaves an absolute path unchanged. write_guard_core_run
# requires already-absolutized candidates (full-path EXACT match).
#
# Same rationale as the Claude twin _wg_absolutize (hooks/pre-tool-
# enforcer.sh): a candidate arrives as LITERAL command text, and the old
# code treated a "$OMT_DIR/..." token as relative (cwd-prefixed) instead of
# resolving the env-var reference, silently allowing the exact form Codex's
# SessionStart recovery pointer teaches agents to reproduce.
#
# ${p//find/replace} is a pure bash string substitution -- never eval/
# envsubst. FIVE variables/forms are expanded (three more than the Claude
# twin): $OMT_DIR -> $omt_dir; BOTH $OMT_SESSION_ID and $CODEX_THREAD_ID ->
# $sid, because Codex's resolved session id is OMT_SESSION_ID ?? CODEX_
# THREAD_ID (the cli_sid resolution above) -- either env-var spelling composes
# the same real ledger path; and $HOME/${HOME}/a leading `~` -> env $HOME,
# because the resolved omt_dir is ALWAYS $HOME/.omt/<proj> (lib/omt-dir.sh),
# so a home-relative spelling of the ledger (`rm "$HOME/.omt/<proj>/
# session-ledger-<sid>.md"`, `rm ~/.omt/<proj>/session-ledger-<sid>.md`)
# composes the exact same real path and must resolve the same way -- leaving
# $HOME/~ unexpanded let both forms bypass the guard (main's old substring
# scan caught these; this was a regression). Expanding $HOME is a strict
# widening of what can match, never a narrowing: an unset/empty $HOME makes
# the substitution a no-op, which never accidentally equals the ledger path,
# so the safe direction (no false block) holds either way. The braced form
# (${VAR}) is substituted before the bare $VAR form to avoid a partial-match
# artifact.
#
# KNOWN LIMITATION: a single-quoted env-var reference (`rm '$OMT_DIR/...'`)
# is an inert shell literal that never expands at real execution time
# either, but _cwg_strip_quotes has already removed the quote characters by
# the time this function runs, so it is indistinguishable here from a
# double-quoted reference and gets substituted (and matched) the same way --
# a safe false-positive on an already-inert command, not a bypass.
_cwg_absolutize() {
    local p
    p="$(_cwg_strip_quotes "$1")"
    p="${p//\$\{OMT_DIR\}/$omt_dir}"
    p="${p//\$\{OMT_SESSION_ID\}/$sid}"
    p="${p//\$\{CODEX_THREAD_ID\}/$sid}"
    p="${p//\$OMT_DIR/$omt_dir}"
    p="${p//\$OMT_SESSION_ID/$sid}"
    p="${p//\$CODEX_THREAD_ID/$sid}"
    p="${p//\$\{HOME\}/${HOME:-}}"
    p="${p//\$HOME/${HOME:-}}"
    case "$p" in
        "~") p="${HOME:-}" ;;
        "~/"*) p="${HOME:-}/${p#\~/}" ;;
    esac
    case "$p" in
        /*) printf '%s\n' "$p" ;;
        *) printf '%s\n' "$cwd/$p" ;;
    esac
}

candidates_text=""
_cwg_add_candidate() {
    [ -n "$1" ] || return 0
    candidates_text="${candidates_text}$(_cwg_absolutize "$1")"$'\n'
}

# _cwg_process_shell_text <shell_command_text>
# Runs the heredoc-body scan and the redirect/tee/rm/cp/mv/sed/dd classifier
# over one shell-text payload. Factored out so the bash|exec_command|
# shell_command route below can run it once per alternate payload key
# (tool_input.command and tool_input.cmd) without duplicating the logic.
_cwg_process_shell_text() {
    local shell_cmd="$1"
    [ -n "$shell_cmd" ] || return 0

    # Bash-embedded apply_patch heredoc body -- its own surface, scanned on
    # the RAW (unmasked) shell_cmd with the same header parser as the
    # apply_patch envelope route. Must run BEFORE masking: the heredoc
    # delimiter grep in _cwg_extract_heredoc_body matches on the literal
    # quote characters around the delimiter (e.g. `apply_patch <<'EOF'`),
    # which _cwg_mask_quoted would have already stripped.
    local heredoc_body
    heredoc_body=$(_cwg_extract_heredoc_body "$shell_cmd")
    if [ -n "$heredoc_body" ]; then
        while IFS= read -r hdr; do
            _cwg_add_candidate "$hdr"
        done < <(_cwg_extract_patch_headers "$heredoc_body")
    fi

    # Quote-aware masking BEFORE chain-splitting and redirect/rm
    # extraction: without this, a `>` (or `|`/`;`/`&`) inside a single-
    # quoted string was read the same as a live shell metacharacter, so
    # prose like `printf 'see foo > <ledger>' | omt-ledger.sh append`
    # falsely matched the redirect classifier below and denied a
    # legitimate ledger-append command. See _cwg_mask_quoted for the full
    # rationale and its parity with the Claude twin's _wg_scan.
    local masked
    masked=$(_cwg_mask_quoted "$shell_cmd")

    # Redirect / tee / rm classifier, per chain segment (split on
    # && || ; |, matching pre-tool-enforcer.sh's segmentation).
    while IFS= read -r seg; do
        [ -n "$seg" ] || continue
        while IFS= read -r tgt; do
            _cwg_add_candidate "$tgt"
        done < <(_cwg_extract_shell_targets "$seg")
    done < <(printf '%s\n' "$masked" | sed -E 's/(&&|\|\||;|\|)/\n/g')
}

# -----------------------------------------------------------------------------
# Route: tool_name -> parse strategy -> candidate targets.
# -----------------------------------------------------------------------------
case "$tool_name" in
    edit | write | multiedit | multi_edit)
        # Scan ALL common single-path keys (not a first-match fallback),
        # mirroring the sibling extractor hooks/rules-injector/tool-paths.ts's
        # addCommonPathFields (:52-63). Reading only .file_path let a payload
        # carrying the target under .path/.filePath/.target/.targetPath/
        # .target_path bypass the guard entirely; reading more keys carries
        # no over-block risk since write_guard_core_run only denies on a
        # full-path EXACT match against the resolved current-session ledger.
        for _cwg_key in file_path path filePath target targetPath target_path; do
            fp=$(printf '%s' "$input" | jq -r --arg k "$_cwg_key" '.tool_input[$k] // empty' 2>/dev/null) || fp=""
            _cwg_add_candidate "$fp"
        done
        # Array-form path keys (multi-file edit payloads), mirroring
        # tool-paths.ts's addPathArray over paths/filePaths/file_paths.
        for _cwg_key in paths filePaths file_paths; do
            while IFS= read -r fp; do
                _cwg_add_candidate "$fp"
            done < <(printf '%s' "$input" | jq -r --arg k "$_cwg_key" '.tool_input[$k]? // [] | .[]?' 2>/dev/null)
        done
        ;;
    apply_patch)
        # Codex has been observed sending the apply_patch payload text under
        # any of command/input/patch/cmd depending on client -- scan ALL
        # FOUR keys (not a first-match fallback), mirroring the sibling
        # extractor hooks/rules-injector/tool-paths.ts:addPatchPayloadPaths.
        # Reading only .command let an input/patch/cmd-only payload bypass
        # the guard entirely; reading more keys carries no over-block risk
        # since write_guard_core_run only denies on a full-path EXACT match
        # against the resolved current-session ledger.
        for _cwg_key in command input patch cmd; do
            patch_cmd=$(printf '%s' "$input" | jq -r --arg k "$_cwg_key" '.tool_input[$k] // empty' 2>/dev/null) || patch_cmd=""
            [ -n "$patch_cmd" ] || continue
            while IFS= read -r hdr; do
                _cwg_add_candidate "$hdr"
            done < <(_cwg_extract_patch_headers "$patch_cmd")
        done
        ;;
    bash | exec_command | shell_command)
        # Codex has been observed sending the shell text under
        # tool_input.command normally, but also under tool_input.cmd for
        # exec_command/shell_command payloads -- process both keys (not a
        # first-match fallback) so a cmd-only payload isn't silently
        # unguarded, mirroring tool-paths.ts's command/cmd fallback.
        shell_cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null) || shell_cmd=""
        shell_cmd_alt=$(printf '%s' "$input" | jq -r '.tool_input.cmd // empty' 2>/dev/null) || shell_cmd_alt=""

        # Resolve relative write targets against the command's OWN working
        # directory -- tool_input.workdir ?? tool_input.cwd -- mirroring the
        # sibling extractor tool-paths.ts:44-46 (workdir ?? cwd) for command
        # tools. Without this, a payload that sets workdir=<ledger dir> plus a
        # relative target wrote the real ledger while _cwg_absolutize resolved
        # it against the hook-level cwd and the guard allowed it. Scope: this
        # shell route only; edit/write/apply_patch keep plain cwd, as
        # tool-paths.ts does. A relative workdir is itself resolved against the
        # hook cwd. Saved/restored so the reassignment cannot leak to any
        # later route.
        _cwg_route_workdir=$(printf '%s' "$input" | jq -r '.tool_input.workdir // .tool_input.cwd // empty' 2>/dev/null) || _cwg_route_workdir=""
        _cwg_saved_cwd="$cwd"
        if [ -n "$_cwg_route_workdir" ]; then
            case "$_cwg_route_workdir" in
                /*) cwd="$_cwg_route_workdir" ;;
                *) cwd="$cwd/$_cwg_route_workdir" ;;
            esac
        fi

        _cwg_process_shell_text "$shell_cmd"
        if [ "$shell_cmd_alt" != "$shell_cmd" ]; then
            _cwg_process_shell_text "$shell_cmd_alt"
        fi

        cwd="$_cwg_saved_cwd"
        ;;
esac

# -----------------------------------------------------------------------------
# Two independent guards run over the SAME candidates_text, mirroring the
# Claude twin's wiring in hooks/pre-tool-enforcer.sh (the same
# write_guard_core_run / codereview_guard_core_run dispatch): an unconditional
# deny (write_guard_core_run) and a SEPARATE identity-conditional allow
# (codereview_guard_core_run) -- different rule kinds, so neither is nested
# inside the other. The ledger guard's output is now captured instead of
# streamed straight to stdout so a second judgment can run when it is empty;
# printf '%s\n' on a non-empty capture reproduces the exact bytes
# write_guard_core_run would have written directly (the trailing newline
# $(...) strips is restored), so this refactor changes neither its output
# bytes nor its exit behavior.
#
# Codex-specific reason this is a positive whitelist, not a subagent check:
# unlike Claude's payload, the Codex PreToolUse payload carries no agent_id
# (or any other subagent-identity field) -- turn_id and transcript_path
# identify a turn/transcript, not a caller role (see the fixture provenance
# note in hooks/codex-write-guard_test.sh for the full field list). There is
# no field here to ask "is this a subagent" directly, so
# agent_type=="code-reviewer" is the only trustworthy signal at all, not a
# design choice among alternatives.
# agent_type itself is read fail-closed: a failed/absent extraction becomes
# "" via the `|| agent_type=""` idiom below (mirroring every other jq
# extraction in this file), and codereview_guard_core_run denies on "" the
# same as any other non-"code-reviewer" value -- extraction failure must
# never fall through to allow.
_cwg_ledger_out=$(printf '%s' "$candidates_text" | write_guard_core_run "$omt_dir" "$sid")
if [ -n "$_cwg_ledger_out" ]; then
    printf '%s\n' "$_cwg_ledger_out"
    exit 0
fi

agent_type=$(printf '%s' "$input" | jq -r '.agent_type // empty' 2>/dev/null) || agent_type=""
printf '%s' "$candidates_text" | codereview_guard_core_run "$omt_dir" "$sid" "$agent_type"

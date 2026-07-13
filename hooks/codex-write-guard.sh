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
# more parsing -- `cd "$OMT_DIR" && rm session-ledger-$SID.md` (relative
# target resolved against a pre-`cd` cwd this hook never sees), variable
# indirection (`f="$OMT_DIR/..."; > "$f"`), parameter expansion
# (`> "${OMT_DIR%/}/..."`), and process substitution. This shim stays a
# best-effort literal-text scan, not a shell interpreter.
#
# omt-hook-dep: lib/omt-dir.sh
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/write-guard-core.sh"

# jq is required for JSON extraction; fail-open (allow, no guard) if absent --
# this hook is best-effort, not a hard security boundary.
if ! command -v jq > /dev/null 2>&1; then
    exit 0
fi

input=$(cat)

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
        cp | mv)
            printf '%s\n' "$seg" | awk '{print $NF}'
            ;;
        sed)
            if printf '%s\n' "$seg" | grep -q -- '-i'; then
                printf '%s\n' "$seg" | awk '{print $NF}'
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

# _cwg_mask_quoted <shell_command_text>
# Quote-aware normalizer, re-derived from the same algorithm as the Claude
# twin's _wg_scan (hooks/pre-tool-enforcer.sh:160-179): masks shell-active
# metacharacters (`> < | ; &`) that appear INSIDE a single-quoted span by
# replacing them with a space, and drops the quote CHARACTERS themselves
# while preserving the quoted CONTENT -- so prose like
# `printf 'see foo > <ledger> here' | omt-ledger.sh append` is never
# misread by the redirect/segment-splitter logic below as a live redirect
# or a live `|`/`;`/`&` chain separator. Without this, ANY `>` in the raw
# shell text -- quoted or not -- was read as a live redirect, so a
# legitimate ledger-append command whose prose happened to contain
# `> <ledger>` inside quotes was denied (a false-positive over-block).
# Double-quoted spans (`> "$f"`) and metacharacters OUTSIDE any quote (real
# redirects/splitters) pass through unchanged -- same single-quote-only
# scope as the Claude twin. This is independently re-derived bash+awk, not
# sourced from the sibling file (Claude/Codex parsing intentionally never
# shares code, see the file header) -- so the two guards can still diverge
# if one is edited without the other.
_cwg_mask_quoted() {
    printf '%s' "$1" | awk '
        BEGIN { sq = sprintf("%c", 39) }
        {
            n = length($0)
            inq = 0
            out = ""
            for (i = 1; i <= n; i++) {
                c = substr($0, i, 1)
                if (c == sq) {
                    inq = 1 - inq
                    continue
                }
                if (inq && (c == ">" || c == "<" || c == "|" || c == ";" || c == "&")) {
                    out = out " "
                    continue
                }
                out = out c
            }
            print out
        }'
}

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
# envsubst. THREE variables are expanded (one more than the Claude twin):
# $OMT_DIR -> $omt_dir, and BOTH $OMT_SESSION_ID and $CODEX_THREAD_ID ->
# $sid, because Codex's resolved session id is OMT_SESSION_ID ?? CODEX_
# THREAD_ID (resolved above at :74-89) -- either env-var spelling composes
# the same real ledger path. The braced form (${VAR}) is substituted before
# the bare $VAR form to avoid a partial-match artifact.
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

printf '%s' "$candidates_text" | write_guard_core_run "$omt_dir" "$sid"

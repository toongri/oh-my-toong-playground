#!/bin/bash
# =============================================================================
# Codex PreToolUse Write-Guard (codex-ledger-parity plan, TODO 7): a thin
# Codex-specific shim that parses Codex write routes (apply_patch envelope,
# Bash-embedded apply_patch heredoc, shell redirect/tee/rm, native Edit/Write),
# resolves OMT_DIR/session_id, absolutizes candidate targets against cwd, and
# delegates the actual full-path anchor-match + deny JSON to
# write_guard_core_run (hooks/write-guard-core.sh) -- this file never emits
# the deny JSON itself, and never folds apply_patch parsing into the shared
# core (that would drift Claude's byte-identical deny at
# hooks/pre-tool-enforcer.sh).
#
# Write-route set mirrors the sibling PostToolUse matcher (codex.yaml:45):
# apply_patch | Bash | bash | exec_command | shell_command | Edit | Write.
#
# BEST-EFFORT, not security-complete: headers/targets are absolutized
# against cwd to cover the common case, not a full shell parser.
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

tool_name=$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null) || tool_name=""

case "$tool_name" in
    apply_patch | Bash | bash | exec_command | shell_command | Edit | Write) ;;
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
# record to any ledger), HALTs loudly rather than guarding the wrong (or a
# nonexistent) ledger.
# -----------------------------------------------------------------------------
_cwg_charset_ok() {
    printf '%s' "$1" | grep -Eq '^[A-Za-z0-9_-]{1,200}$'
}

_cwg_halt() {
    echo "HALT: codex-write-guard session-id mismatch/diverged -- $1" >&2
    exit 1
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

    # Redirect target: the token after the last `>` / `>>`, excluding fd
    # duplications like `2>&1` / `>&2`.
    # `|| true`: grep -oE returns 1 when a segment has no redirect at all --
    # under this script's `set -euo pipefail`, an unguarded nonzero pipeline
    # here would abort the function (via the process-substitution subshell
    # that invokes it) before the case block below -- tee/rm/truncate/cp/mv/
    # sed -i/dd -- ever runs, silently ALLOWING those write routes.
    printf '%s\n' "$seg" \
        | grep -oE '(^|[^0-9&])>{1,2}[[:space:]]*[^[:space:]&][^[:space:]]*' \
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

# _cwg_absolutize <path>
# Joins a relative path against the resolved cwd; leaves an absolute path
# unchanged. write_guard_core_run requires already-absolutized candidates
# (full-path EXACT match).
_cwg_absolutize() {
    case "$1" in
        /*) printf '%s\n' "$1" ;;
        *) printf '%s\n' "$cwd/$1" ;;
    esac
}

candidates_text=""
_cwg_add_candidate() {
    [ -n "$1" ] || return 0
    candidates_text="${candidates_text}$(_cwg_absolutize "$1")"$'\n'
}

# -----------------------------------------------------------------------------
# Route: tool_name -> parse strategy -> candidate targets.
# -----------------------------------------------------------------------------
case "$tool_name" in
    Edit | Write)
        fp=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null) || fp=""
        _cwg_add_candidate "$fp"
        ;;
    apply_patch)
        patch_cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null) || patch_cmd=""
        while IFS= read -r hdr; do
            _cwg_add_candidate "$hdr"
        done < <(_cwg_extract_patch_headers "$patch_cmd")
        ;;
    Bash | bash | exec_command | shell_command)
        shell_cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null) || shell_cmd=""

        # Bash-embedded apply_patch heredoc body -- its own surface, scanned
        # with the same header parser as the apply_patch envelope route.
        heredoc_body=$(_cwg_extract_heredoc_body "$shell_cmd")
        if [ -n "$heredoc_body" ]; then
            while IFS= read -r hdr; do
                _cwg_add_candidate "$hdr"
            done < <(_cwg_extract_patch_headers "$heredoc_body")
        fi

        # Redirect / tee / rm classifier, per chain segment (split on
        # && || ; |, matching pre-tool-enforcer.sh's segmentation).
        while IFS= read -r seg; do
            [ -n "$seg" ] || continue
            while IFS= read -r tgt; do
                _cwg_add_candidate "$tgt"
            done < <(_cwg_extract_shell_targets "$seg")
        done < <(printf '%s\n' "$shell_cmd" | sed -E 's/(&&|\|\||;|\|)/\n/g')
        ;;
esac

printf '%s' "$candidates_text" | write_guard_core_run "$omt_dir" "$sid"

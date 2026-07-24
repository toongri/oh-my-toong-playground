#!/bin/bash
# =============================================================================
# label-commit-gate-core.sh
# Shared judgment core for the "hard-block a git commit whose SUBJECT
# contains a clean-economics invented label" gate, sourced by both
# hooks/label-commit-gate.sh (Claude) and hooks/codex-label-commit-gate.sh
# (Codex). Owns ALL platform-agnostic text logic: the git-commit-shape
# detector, subject extraction across every documented `git commit` form
# (-m/-am/--message[=]/-F/--file[=]), and the label_match_hard check +
# offending-token extraction.
#
# Subject-only, never body: git's documented convention is that the FIRST
# -m (or --message) is the commit SUBJECT and any repeated -m are separate
# BODY paragraphs; a -F/--file source's subject is that file's first line.
# Only the subject is judged -- a label mentioned in body prose (e.g. an ADR
# heading two paragraphs in) must not deny.
#
# Low recognition altitude, deliberately: rather than growing an
# ever-larger set of quote-shape branches to mimic git/bash's full argument
# grammar, the value alternation below stays shallow (single/double/ANSI-C
# `$'...'`-quoted, or a bare unquoted token bounded by whitespace) and just
# exposes whatever raw text follows the flag to label_match_hard -- the
# perl substring search underneath does the recognition, not this regex.
# See reference_parser_guard_lower_recognition_altitude: don't imitate
# grammar, raise the visibility of the target text instead.
#
# The per-platform shim owns ONLY: extracting the raw shell command text from
# its own tool_input shape (Claude: .tool_input.command; Codex: .tool_input.
# command // .tool_input.cmd, mirroring hooks/codex-write-guard.sh's routing)
# and building its own deny envelope. The two envelopes are deliberately NOT
# unified here (unlike hooks/write-guard-core.sh's single shared deny JSON):
# label-commit-gate.sh's existing stderr + `{"decision":"deny","reason":...}`
# + exit 2 contract is pre-existing, tested Claude behavior that must not
# change, while Codex's PreToolUse deny contract is `{"hookSpecificOutput":
# {"permissionDecision":"deny",...}}` on stdout with exit 0 (codex-write-
# guard.sh's established shape for this repo).
#
# Requires label_match_hard and $_LABEL_PATTERN_HARD (hooks/lib/label-
# patterns.sh) to already be sourced by the caller before
# label_commit_gate_core_check is invoked.
#
# label_commit_gate_core_check <cmd_text>
# Prints the offending token to stdout and returns 0 iff <cmd_text> is a
# `git commit` invocation whose extracted SUBJECT contains a hard-tier
# invented label. Prints nothing and returns 1 for every other case
# (non-commit command, commit with no subject text, or a clean subject).
# =============================================================================

label_commit_gate_core_check() {
    local cmd="$1"

    # Fast path: not a git commit -> allow. Tolerates git GLOBAL options
    # between `git` and `commit` (e.g. `git -C <path> commit`), bounded to a
    # single line -- see hooks/label-commit-gate.sh's original header comment
    # for the full rationale (unchanged here, just relocated).
    local _lcg_nl=$'\n\r'
    local _lcg_re='git[[:blank:]]([^\&\|\;'"$_lcg_nl"']*[[:blank:]])?commit([[:space:]]|$)'
    if [[ ! "$cmd" =~ $_lcg_re ]]; then
        return 1
    fi

    # Scope every extraction below to the segment AFTER the matched
    # `git ... commit` invocation, never the raw $cmd. Matching against the
    # whole command string let an unrelated, earlier -m elsewhere on the
    # same line (e.g. `printf '%s' -m clean; git commit -m "fix <label>"`)
    # be mistaken for the commit subject while the real, later -m went
    # unchecked. Literal (quoted) substring removal, not a glob match --
    # same idiom already used below for the heredoc body (was: raw $cmd).
    local _lcg_commit_match="${BASH_REMATCH[0]}"
    local _lcg_seg="${cmd#*"$_lcg_commit_match"}"

    # The FIRST NON-EMPTY -m / -am / --message occurrence (space or = form,
    # ANSI-C $'...', single/double quoted, or a bare unquoted token) -- this
    # IS the subject; a second, third, ... -m is body and is intentionally
    # never reached once a non-empty one is found. Not just the literal
    # first -m: git's own cleanup=strip mode drops an empty leading message
    # paragraph and promotes the next -m to the subject line (verified via
    # `git commit --allow-empty -m '' -m 'fix D-36'` -> subject `fix D-36`),
    # so a first -m with an empty value must be skipped over, not treated as
    # a title-less commit. The separator group requires at least one space
    # or a literal '=' (never both optional-empty) so the flag-alternation
    # can't false-match a `m`-ending prefix sitting inside an unrelated long
    # flag (e.g. "-am" inside "--amend") immediately followed by ordinary
    # flag text -- with an empty-separator allowance the broadened unquoted
    # branch below would swallow that text as a bogus "value" and stop
    # searching before ever reaching a real -m further down the command.
    local title=""
    local _lcg_msg_re="(^|[[:space:]])(-[a-zA-Z]*m|--message)([[:space:]]+=?[[:space:]]*|=[[:space:]]*)(\\\$'[^']*'|'[^']*'|\"[^\"]*\"|[^[:space:]]+)"
    local _lcg_msg_found=0
    local _lcg_msg_search="$_lcg_seg"
    while [[ "$_lcg_msg_search" =~ $_lcg_msg_re ]]; do
        _lcg_msg_found=1
        local _lcg_raw="${BASH_REMATCH[4]}"
        local _lcg_full_match="${BASH_REMATCH[0]}"
        # Unquote (single matching wrapper only) just to test for emptiness
        # -- title itself stays in its raw, still-quoted form below, same as
        # before, since label_match_hard's substring search doesn't care.
        local _lcg_val="$_lcg_raw"
        case "$_lcg_val" in
            \$\'*\') _lcg_val="${_lcg_val#\$\'}" _lcg_val="${_lcg_val%\'}" ;;
            \'*\') _lcg_val="${_lcg_val#\'}" _lcg_val="${_lcg_val%\'}" ;;
            \"*\") _lcg_val="${_lcg_val#\"}" _lcg_val="${_lcg_val%\"}" ;;
        esac
        if [[ -n "$_lcg_val" ]]; then
            title="$_lcg_raw"
            title="${title%%$'\n'*}"
            break
        fi
        # This -m's value is empty -- advance past it and keep looking for
        # the next -m, same literal-substring idiom as the commit-match
        # scoping strip above (safe against $/quote metacharacters).
        _lcg_msg_search="${_lcg_msg_search#*"$_lcg_full_match"}"
    done

    if [[ "$_lcg_msg_found" -eq 0 ]]; then
        # -F/--file message file: space form (-F <path>, --file <path>) or
        # --file=<path>.
        local _lcg_file_path=""
        if [[ "$_lcg_seg" =~ (^|[[:space:]])(-F|--file)[[:space:]]+([^[:space:]]+) ]]; then
            _lcg_file_path="${BASH_REMATCH[3]}"
        elif [[ "$_lcg_seg" =~ (^|[[:space:]])--file=([^[:space:]]+) ]]; then
            _lcg_file_path="${BASH_REMATCH[2]}"
        fi

        if [[ "$_lcg_file_path" == "-" ]]; then
            # `-F -` reads the message from real stdin -- a genuine
            # interactive human path with nothing to introspect, left
            # unread (same as before). But when a heredoc supplies that
            # stdin inline, its body IS fully known static text; extract
            # the heredoc body's first line as the subject.
            local _lcg_heredoc_re="<<-?[[:space:]]*'?\"?([A-Za-z_][A-Za-z0-9_]*)\"?'?"
            if [[ "$_lcg_seg" =~ $_lcg_heredoc_re ]]; then
                local _lcg_delim="${BASH_REMATCH[1]}"
                local _lcg_body="${_lcg_seg#*"${BASH_REMATCH[0]}"}"
                _lcg_body="${_lcg_body#*$'\n'}"
                _lcg_body="${_lcg_body%%$'\n'"$_lcg_delim"*}"
                title="${_lcg_body%%$'\n'*}"
            fi
        elif [[ -n "$_lcg_file_path" && -f "$_lcg_file_path" ]]; then
            title=$(head -n 1 -- "$_lcg_file_path" 2> /dev/null) || title=""
        fi
    fi

    if [[ -z "$title" ]]; then
        return 1
    fi

    if label_match_hard "$title"; then
        printf '%s\n' "$title" \
            | LABEL_RE="$_LABEL_PATTERN_HARD" perl -ne 'if (/($ENV{LABEL_RE})/) { print $1; exit }'
        return 0
    fi

    return 1
}

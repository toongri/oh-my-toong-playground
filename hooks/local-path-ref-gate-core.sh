#!/bin/bash
# =============================================================================
# Local-path reference judgment core
#
# This file is platform-neutral and is sourced by the Claude and Codex shims.
# It intentionally does not emit a deny envelope.  The shim calls:
#
#   local_path_ref_gate_core_check <repository-root> <inspectable-text>
#   local_path_ref_gate_core_check_attachment <repository-root> <attachment-path>
#
# The text is scanned line by line (the caller may include any source text and
# file/line context it has).  The function prints one tab-separated record for
# each violation:
#
#   line=N  type=TYPE  path=PATH  remediation=PRESCRIPTION
#   instruction=deleting the citation alone is forbidden
#
# Records are judgment data for a shim to render; paths and prescriptions are
# deliberately type-specific.  Return status is 0 when at least one record was
# emitted and 1 for allow, including malformed/setup-error input (fail open).
# The supported TYPE values are `repo-relative-missing`,
# `machine-local-untracked`, `absolute-tracked`, and `local-attachment`.
#
# Bash 3.2/macOS compatible.  No shell-command parsing, network/MCP
# extraction, or platform-specific JSON belongs here.
# =============================================================================

_lpr_core_expand_path() {
    local raw="$1"
    _LPR_EXPANDED="$raw"
    case "$raw" in
        '~'|'~/'*)
            if [[ -n "${HOME-}" ]]; then
                _LPR_EXPANDED="${HOME}${raw#\~}"
            fi
            ;;
        \$HOME|\$HOME/*)
            if [[ -n "${HOME-}" ]]; then
                _LPR_EXPANDED="${HOME}${raw#\$HOME}"
            fi
            ;;
        \${HOME}|\${HOME}/*)
            if [[ -n "${HOME-}" ]]; then
                _LPR_EXPANDED="${HOME}${raw#\${HOME}}"
            fi
            ;;
        \$OMT_DIR|\$OMT_DIR/*)
            if [[ -n "${OMT_DIR-}" ]]; then
                _LPR_EXPANDED="${OMT_DIR}${raw#\$OMT_DIR}"
            fi
            ;;
        \${OMT_DIR}|\${OMT_DIR}/*)
            if [[ -n "${OMT_DIR-}" ]]; then
                _LPR_EXPANDED="${OMT_DIR}${raw#\${OMT_DIR}}"
            fi
            ;;
    esac
}

_lpr_core_percent_decode() {
    local value="$1" decoded="" index=0 length hex byte unresolved=0
    length="${#value}"
    while [[ "$index" -lt "$length" ]]; do
        if [[ "${value:$index:1}" == '%' && "$((index + 2))" -lt "$length" ]]; then
            hex="${value:$((index + 1)):2}"
            if [[ "$hex" =~ ^[0-9A-Fa-f]{2}$ ]]; then
                printf -v byte '%b' "\\x$hex"
                decoded="${decoded}${byte}"
                index=$((index + 3))
                continue
            fi
            unresolved=1
        elif [[ "${value:$index:1}" == '%' ]]; then
            unresolved=1
        fi
        decoded="${decoded}${value:$index:1}"
        index=$((index + 1))
    done
    _LPR_DECODED="$decoded"
    _LPR_DECODE_UNRESOLVED="$unresolved"
}

_lpr_core_ascii_lower() {
    local value="$1" lowered="" index=0 char
    while [[ "$index" -lt "${#value}" ]]; do
        char="${value:$index:1}"
        case "$char" in
            A) char=a ;;
            B) char=b ;;
            C) char=c ;;
            D) char=d ;;
            E) char=e ;;
            F) char=f ;;
            G) char=g ;;
            H) char=h ;;
            I) char=i ;;
            J) char=j ;;
            K) char=k ;;
            L) char=l ;;
            M) char=m ;;
            N) char=n ;;
            O) char=o ;;
            P) char=p ;;
            Q) char=q ;;
            R) char=r ;;
            S) char=s ;;
            T) char=t ;;
            U) char=u ;;
            V) char=v ;;
            W) char=w ;;
            X) char=x ;;
            Y) char=y ;;
            Z) char=z ;;
        esac
        lowered="${lowered}${char}"
        index=$((index + 1))
    done
    _LPR_ASCII_LOWER="$lowered"
}

_lpr_core_is_local_file_uri() {
    local value="$1"
    _lpr_core_ascii_lower "$value"
    case "$_LPR_ASCII_LOWER" in
        file:///*|file://localhost/*) return 0 ;;
    esac
    return 1
}

_lpr_core_inspect_path() {
    local candidate="$1" lowered_candidate
    _LPR_DECODE_UNRESOLVED=0
    _lpr_core_expand_path "$candidate"
    candidate="$_LPR_EXPANDED"
    _lpr_core_ascii_lower "$candidate"
    lowered_candidate="$_LPR_ASCII_LOWER"
    case "$lowered_candidate" in
        file:///*)
            # Strip the scheme by position so URI scheme casing is ignored.
            candidate="${candidate:7}"
            _lpr_core_percent_decode "$candidate"
            candidate="$_LPR_DECODED"
            ;;
        file://localhost/*)
            # RFC 8089 defines localhost as the local-machine alias of the
            # empty-authority form.  Normalize before percent decoding so the
            # resulting path is classified exactly like file:///... .
            # Match the authority case-insensitively while preserving the
            # original path bytes for percent decoding.
            candidate="${candidate:16}"
            _lpr_core_percent_decode "$candidate"
            candidate="$_LPR_DECODED"
            ;;
    esac
    _LPR_INSPECT_PATH="$candidate"
}

_lpr_core_trim_candidate() {
    local value="$1"
    # A literal local filename can contain `#`; retain it when it resolves
    # before treating a remaining fragment as a Markdown anchor.
    if _lpr_core_candidate_exists "$value"; then
        _LPR_CANDIDATE="$value"
        return
    fi
    # Link fragments identify an anchor, not a second local file.
    value="${value%%#*}"
    # Preserve a concrete filename whose final character is also commonly
    # sentence punctuation.  Only use the punctuation-stripped fallback when
    # the literal candidate cannot be inspected as an existing local target.
    if _lpr_core_candidate_exists "$value"; then
        _LPR_CANDIDATE="$value"
        return
    fi
    # Bare Markdown/prose commonly wraps paths in paired delimiters and puts
    # sentence punctuation after them.  Remove only edge delimiters so
    # meaningful characters inside a filename (for example notes(1).md) stay
    # intact.
    while :; do
        case "$value" in
            *[.,:]) value="${value%?}" ;;
            *';') value="${value%?}" ;;
            *\)) value="${value%?}" ;;
            *) break ;;
        esac
    done
    while :; do
        case "$value" in
            \<*\>|\'*\'|\"*\"|\`*\`|\(*\)|\[*\]|\{*\})
                value="${value#?}"
                value="${value%?}"
                ;;
            *) break ;;
        esac
    done
    # A Markdown/prose scanner may leave one side of a delimiter in the
    # captured token (for example `(docs/reference)`).  Remove that edge only
    # after sentence punctuation and paired wrappers have been handled.
    case "$value" in
        \(*|\[*|\{*|\`*|\'*|\"*) value="${value#?}" ;;
    esac
    _LPR_CANDIDATE="$value"
}

_lpr_core_candidate_exists() {
    local candidate="$1"
    _lpr_core_inspect_path "$candidate"
    candidate="$_LPR_INSPECT_PATH"
    # A malformed/incomplete percent escape is not an inspectable path.  Do
    # not reinterpret the unresolved spelling as a literal local filename.
    [[ "${_LPR_DECODE_UNRESOLVED-0}" -eq 0 ]] || return 1
    case "$candidate" in
        /*) [[ -e "$candidate" ]] && return 0 ;;
        *) [[ -n "${_LPR_REPO_ROOT-}" && -e "$_LPR_REPO_ROOT/$candidate" ]] && return 0 ;;
    esac
    _lpr_core_placeholder_or_external "$candidate" && return 1
    return 1
}

_lpr_core_placeholder_or_external() {
    local value="$1" scheme
    # Keep all casing variants of local file URIs out of the external-URI
    # branch when this helper is called before URI inspection.
    _lpr_core_is_local_file_uri "$value" && return 1
    case "$value" in
        # Empty-authority and localhost file URIs name a local absolute path.
        # Every other URI scheme (including hostname-bearing file URIs) is
        # outside this core's local-filesystem inspection contract and must
        # fail open.
        file:///*|file://localhost/*) ;;
        *:*)
            scheme="${value%%:*}"
            case "$scheme" in
                [[:alpha:]]*)
                    case "$scheme" in
                        *[![:alnum:]+.-]*) ;;
                        *) return 0 ;;
                    esac
                    ;;
            esac
            ;;
        '#'*) return 0 ;;
        # `<repo-root>/...` (and other `<...>/` schematic placeholders such as
        # `<worktree>/...`) is a schematic placeholder, not a concrete
        # repository-relative citation.  Keep it fail-open in Markdown links
        # as well as in prose scans.
        \<[^\<\>]*\>/*) return 0 ;;
        *'{'*'}'*|*'*'*|*'?'*|*'['*']'*) return 0 ;;
        # An unresolved variable is a template/reference, not an inspectable
        # concrete local path.  Known variables are expanded before this test.
        *\$*|*'${'*'}'*) return 0 ;;
    esac
    return 1
}

_lpr_core_check_placeholder_advisory() {
    # `<X>/rest` is a schematic placeholder that `_lpr_core_placeholder_or_
    # external` always allows.  When `rest` also happens to name a real,
    # untracked FILE under a known root (OMT_DIR, then HOME, then the repo
    # root, in that order), the author likely meant a concrete local path,
    # not an illustrative one.  Emit an advisory (never a blocking) record
    # for the first root that resolves; a directory, a tracked file, or a
    # path through the git metadata directory is left silent.
    local candidate="$1" line_no="$2" rest root resolved status
    case "$candidate" in
        \<[^\<\>]*\>/*) rest="${candidate#*>/}" ;;
        *) return 1 ;;
    esac
    [[ -n "$rest" ]] || return 1
    for root in "${OMT_DIR-}" "${HOME-}" "${_LPR_REPO_ROOT-}"; do
        [[ -n "$root" ]] || continue
        resolved="${root%/}/$rest"
        [[ -f "$resolved" ]] || continue
        case "/${resolved}/" in
            */.git/*) continue ;;
        esac
        _lpr_core_is_tracked_absolute "$resolved"
        status=$?
        [[ "$status" -eq 0 || "$status" -eq 2 ]] && continue
        _lpr_core_emit "$line_no" "placeholder-resolves-to-untracked" "${candidate} -> ${resolved}" \
            "never leave an untracked file path in a tracked file or a shared document; if it must be shared, upload the file itself alongside"
        return 0
    done
    return 1
}

_lpr_core_unresolved_escaped_path_line() {
    local value="$1" decoded_value
    # A line suffix whose separator is escaped (literally or as `%3A`) is not
    # a path the core can resolve.  In particular, do not strip the suffix and
    # then classify an otherwise-existing path portion as a citation.
    [[ "$value" =~ \\:[1-9][0-9]*$ ]] && return 0
    if [[ "$value" =~ %[3][Aa][1-9][0-9]*$ ]]; then
        # `%3A<number>` is usually an escaped `path:line` suffix, but it can
        # also be the URI spelling of a real filename such as `report:2026`.
        # Preserve the latter by checking the fully decoded candidate before
        # treating the suffix as unresolved syntax.
        _lpr_core_percent_decode "$value"
        decoded_value="$_LPR_DECODED"
        if [[ "${_LPR_DECODE_UNRESOLVED-0}" -eq 0 ]] && _lpr_core_candidate_exists "$decoded_value"; then
            return 1
        fi
        return 0
    fi
    return 1
}

_lpr_core_seen() {
    local key="$1" existing
    while IFS= read -r existing; do
        [[ "$existing" == "$key" ]] && return 0
    done <<EOF
$_LPR_SEEN
EOF
    return 1
}

_lpr_core_emit() {
    local line_no="$1" kind="$2" display_path="$3" remediation="$4"
    # Records are TSV for shim consumption.  Escape control characters from a
    # filename so an inspectable local path cannot change the record shape.
    display_path="${display_path//\\/\\\\}"
    display_path="${display_path//$'\t'/\\t}"
    display_path="${display_path//$'\r'/\\r}"
    display_path="${display_path//$'\n'/\\n}"
    local key="${line_no}\t${kind}\t${display_path}"
    if _lpr_core_seen "$key"; then
        return 0
    fi
    _LPR_SEEN="${_LPR_SEEN}${key}"$'\n'
    printf 'location=line:%s\tline=%s\ttype=%s\tpath=%s\tremediation=%s\tinstruction=deleting the citation alone is forbidden\n' \
        "$line_no" "$line_no" "$kind" "$display_path" "$remediation"
    _LPR_COUNT=$((_LPR_COUNT + 1))
}

_lpr_core_resolve_existing_path() {
    local candidate="$1" directory basename resolved_directory
    if [[ -d "$candidate" ]]; then
        resolved_directory=$(cd -P "$candidate" 2>/dev/null && pwd -P) || return 1
        _LPR_RESOLVED_PATH="$resolved_directory"
        return 0
    fi
    directory="${candidate%/*}"
    basename="${candidate##*/}"
    [[ "$directory" == "$candidate" ]] && directory='.'
    resolved_directory=$(cd -P "$directory" 2>/dev/null && pwd -P) || return 1
    _LPR_RESOLVED_PATH="${resolved_directory%/}/$basename"
}

_lpr_core_is_tracked_absolute() {
    local candidate="$1" relative status
    _lpr_core_resolve_existing_path "$candidate" || return 2
    candidate="$_LPR_RESOLVED_PATH"
    case "$candidate" in
        "$_LPR_REPO_ROOT"/*)
            relative="${candidate#"$_LPR_REPO_ROOT/"}"
            ;;
        *) return 1 ;;
    esac
    if git -C "$_LPR_REPO_ROOT" ls-files --error-unmatch -- "$relative" >/dev/null 2>&1; then
        return 0
    else
        status="$?"
    fi
    # `ls-files --error-unmatch` returns 1 for a legitimate untracked path;
    # any other status is an index/setup failure and must fail open.
    [[ "$status" -eq 1 ]] && return 1
    return 2
}

_lpr_core_consider() {
    # `bare` references are only actionable when they resolve to an existing
    # file.  Markdown links and explicitly delimited evidence retain the
    # missing-target diagnosis because those forms assert a concrete citation.
    local raw="$1" line_no="$2" context="${3-bare}" candidate display_candidate repo_target
    _lpr_core_trim_candidate "$raw"
    candidate="$_LPR_CANDIDATE"
    [[ -n "$candidate" ]] || return 0
    display_candidate="$candidate"

    if _lpr_core_is_local_file_uri "$candidate"; then
        :
    else
        _lpr_core_unresolved_escaped_path_line "$candidate" && return 0
    fi

    # A percent-encoded colon suffix can be a real filename (for example
    # `report%3A2026` spelling `report:2026`), not only escaped line syntax.
    # Resolve that concrete filename before the normal path:line handling.
    if [[ "$candidate" =~ %[3][Aa][1-9][0-9]*$ ]]; then
        _lpr_core_percent_decode "$candidate"
        if [[ "${_LPR_DECODE_UNRESOLVED-0}" -eq 0 ]] && _lpr_core_candidate_exists "$_LPR_DECODED"; then
            candidate="$_LPR_DECODED"
        fi
    fi

    # Relative Markdown destinations use URI escaping even when they point at
    # repository files.  Decode them for filesystem classification while
    # retaining the authored spelling in diagnostics.
    if [[ "$context" == "markdown" ]]; then
        _lpr_core_percent_decode "$candidate"
        [[ "${_LPR_DECODE_UNRESOLVED-0}" -eq 0 ]] || return 0
        candidate="$_LPR_DECODED"
    fi

    # `file:///...` and `file://localhost/...` are local absolute references,
    # not external URLs.  Hostname-bearing file URIs remain outside this
    # core's local-filesystem inspection contract.
    # A `path:line` citation identifies the same local file as `path`, unless
    # the complete candidate is an existing filename ending in `:<number>`.
    # Keep a real filename or a citation in diagnostic output, but resolve and
    # classify only the path portion of an actual citation.
    if ! _lpr_core_candidate_exists "$candidate" && [[ "$candidate" =~ ^(.+):[1-9][0-9]*$ ]]; then
        candidate="${BASH_REMATCH[1]}"
    fi

    _lpr_core_inspect_path "$candidate"
    candidate="$_LPR_INSPECT_PATH"
    [[ "${_LPR_DECODE_UNRESOLVED-0}" -eq 0 ]] || return 0
    # An unresolved $HOME/$OMT_DIR is a template; setup errors fail open.
    if ! _lpr_core_candidate_exists "$candidate"; then
        if _lpr_core_placeholder_or_external "$candidate"; then
            _lpr_core_check_placeholder_advisory "$candidate" "$line_no"
            return 0
        fi
    fi
    # `~` cannot be expanded safely without HOME (and ~user lookup is outside
    # this core's scope), so treat an unresolved tilde as a setup/template case.
    case "$candidate" in
        '~'|'~/'*) [[ -n "${HOME-}" ]] || return 0 ;;
    esac

    case "$candidate" in
        /*)
            [[ -e "$candidate" ]] || return 0
            if _lpr_core_is_tracked_absolute "$candidate"; then
                if [[ "$context" == "attachment" ]]; then
                    _lpr_core_emit "$line_no" "local-attachment" "$display_candidate" \
                        "do not attach local files; inline a summary or link to the repository file; ok: inline summary, tracked repo-relative path, schematic <placeholder> for an illustrative path only, never a real one"
                else
                    repo_target="${_LPR_RESOLVED_PATH#"$_LPR_REPO_ROOT/"}"
                    _lpr_core_emit "$line_no" "absolute-tracked" "$repo_target" \
                        "use the repository-relative path; ok: inline summary, tracked repo-relative path, schematic <placeholder> for an illustrative path only, never a real one"
                fi
            else
                [[ "$?" -eq 2 ]] && return 0
                _lpr_core_emit "$line_no" "machine-local-untracked" "$display_candidate" \
                    "inline a summary or copy the file into the repository; ok: inline summary, tracked repo-relative path, schematic <placeholder> for an illustrative path only, never a real one"
            fi
            ;;
        *)
            if [[ -e "$_LPR_REPO_ROOT/$candidate" ]]; then
                # A repository-relative tracked citation is the normal safe
                # form.  An existing but untracked relative target is still a
                # machine-local file and needs the same inline/copy remedy.
                if _lpr_core_is_tracked_absolute "$_LPR_REPO_ROOT/$candidate"; then
                    if [[ "$context" == "attachment" ]]; then
                        _lpr_core_emit "$line_no" "local-attachment" "$display_candidate" \
                            "do not attach local files; inline a summary or link to the repository file; ok: inline summary, tracked repo-relative path, schematic <placeholder> for an illustrative path only, never a real one"
                        return 0
                    fi
                    return 0
                else
                    [[ "$?" -eq 2 ]] && return 0
                    _lpr_core_emit "$line_no" "machine-local-untracked" "$display_candidate" \
                        "inline a summary or copy the file into the repository; ok: inline summary, tracked repo-relative path, schematic <placeholder> for an illustrative path only, never a real one"
                    return 0
                fi
            fi
            if [[ "$context" == "markdown" || "$context" == "evidence" ]]; then
                _lpr_core_emit "$line_no" "repo-relative-missing" "$display_candidate" \
                    "add the target or inline its content; ok: inline summary, tracked repo-relative path, schematic <placeholder> for an illustrative path only, never a real one"
            fi
            ;;
    esac
}

_lpr_core_markdown_prefix_has_open() {
    local value="$1" index=0 length char escaped=0
    _LPR_MARKDOWN_HAS_OPEN=0
    length="${#value}"
    while [[ "$index" -lt "$length" ]]; do
        char="${value:$index:1}"
        if [[ "$escaped" -eq 1 ]]; then
            escaped=0
        elif [[ "$char" == \\ ]]; then
            escaped=1
        elif [[ "$char" == '[' ]]; then
            _LPR_MARKDOWN_HAS_OPEN=1
        fi
        index=$((index + 1))
    done
    [[ "$_LPR_MARKDOWN_HAS_OPEN" -eq 1 ]]
}

_lpr_core_escaped_markdown_prefix() {
    local value="$1" index=0 length char next next_next
    _LPR_ESCAPED_MARKDOWN_PREFIX=""
    length="${#value}"
    while [[ "$index" -lt "$length" ]]; do
        char="${value:$index:1}"
        next="${value:$((index + 1)):1}"
        next_next="${value:$((index + 2)):1}"
        # `](...)` with an escaped opening paren is a literal shape, not a
        # Markdown destination.  Keep its path out of the bare scanner.
        if [[ "$char" == ']' && "$next" == \\ && "$next_next" == '(' ]]; then
            _LPR_ESCAPED_MARKDOWN_PREFIX="${value:0:$index}"
            return 0
        fi
        index=$((index + 1))
    done
    return 1
}

_lpr_core_is_path_shaped() {
    local candidate="$1"
    # A token made up entirely of separator characters (`/`, `//`, `///`,
    # `.`, `..`, `./`, `../` ...) is prose or a comment marker, not a
    # concrete local reference.
    [[ "$candidate" =~ ^[/.]+$ ]] && return 1
    case "$candidate" in
        /*|~|~/*|\$HOME|\$HOME/*|\${HOME}|\${HOME}/*|\$OMT_DIR|\$OMT_DIR/*|\${OMT_DIR}|\${OMT_DIR}/*|./*|../*|file:///*|file://localhost/*|*/*)
            return 0
            ;;
    esac
    return 1
}

_lpr_core_pad_delimiters() {
    local value="$1" padded="" index=0 length char
    length="${#value}"
    while [[ "$index" -lt "$length" ]]; do
        char="${value:$index:1}"
        case "$char" in
            '('|')'|'"'|'`'|','|';'|'{'|'}')
                padded="${padded} ${char} "
                ;;
            *)
                padded="${padded}${char}"
                ;;
        esac
        index=$((index + 1))
    done
    _LPR_PADDED="$padded"
}

_lpr_core_scan_line() {
    local line="$1" line_no="$2" scan_context="${3-bare}" rest target token candidate markdown_match
    local markdown_tail markdown_char markdown_index markdown_depth markdown_prefix markdown_next
    # Markdown destinations are authoritative and also allow paths containing
    # spaces (which bare-token scanning intentionally does not attempt).
    rest="$line"
    local _lpr_title_re="^(.+)[[:space:]]+(\"[^\"]*\"|'[^']*'|\\([^)]*\\))$"
    while [[ "$rest" == *']('* ]]; do
        markdown_prefix="${rest%%']('*}"
        # Require an unescaped `[` before the destination marker.  Escaped or
        # otherwise malformed Markdown must not fall through into the bare
        # path scanner, where its final token could look like a citation.
        if ! _lpr_core_markdown_prefix_has_open "$markdown_prefix"; then
            line="${line%%']('*}"
            break
        fi
        markdown_tail="${rest#*']('}"
        target=""
        markdown_index=0
        markdown_depth=1
        while [[ "$markdown_index" -lt "${#markdown_tail}" ]]; do
            markdown_char="${markdown_tail:$markdown_index:1}"
            markdown_next="${markdown_tail:$((markdown_index + 1)):1}"
            # Markdown backslash escapes make punctuation literal inside a
            # destination.  Unescape those punctuation characters for path
            # inspection and, crucially, do not count escaped parentheses as
            # structural delimiters.
            if [[ "$markdown_char" == \\ ]]; then
                case "$markdown_next" in
                    '('|')'|'['|']'|'\\')
                        target="${target}${markdown_next}"
                        markdown_index=$((markdown_index + 2))
                        continue
                        ;;
                esac
            fi
            case "$markdown_char" in
                '(') markdown_depth=$((markdown_depth + 1)) ;;
                ')')
                    markdown_depth=$((markdown_depth - 1))
                    [[ "$markdown_depth" -eq 0 ]] && break
                    ;;
            esac
            target="${target}${markdown_char}"
            markdown_index=$((markdown_index + 1))
        done
        # A malformed destination is not a concrete citation.  Leave it to
        # callers with richer syntax knowledge rather than guessing here.
        if [[ "$markdown_depth" -ne 0 ]]; then
            line="${line%%']('*}"
            break
        fi
        markdown_match="](${markdown_tail:0:$((markdown_index + 1))}"
        if [[ "$target" =~ $_lpr_title_re ]]; then
            target="${BASH_REMATCH[1]}"
        fi
        if [[ "$scan_context" == "attachment" ]]; then
            _lpr_core_consider "$target" "$line_no" attachment
        else
            _lpr_core_consider "$target" "$line_no" markdown
        fi
        # Do not scan a Markdown destination again as bare prose.  In
        # particular, a destination with spaces would otherwise leave its
        # final word to be reported as a spurious missing path.
        line="${line/"$markdown_match"/}"
        rest="${markdown_tail:$((markdown_index + 1))}"
    done

    # The escaped `]\(` form never enters the destination loop above.  Strip
    # it before bare scanning for the same fail-open reason as other malformed
    # or escaped Markdown shapes.
    if _lpr_core_escaped_markdown_prefix "$line"; then
        line="$_LPR_ESCAPED_MARKDOWN_PREFIX"
    fi

    # Callers can hand the core one concrete value, including an attachment
    # path with spaces.  Try that whole value before the intentionally
    # conservative word scan below, which would otherwise split the path.
    _lpr_core_trim_candidate "$line"
    candidate="$_LPR_CANDIDATE"
    if _lpr_core_is_path_shaped "$candidate"; then
        _lpr_core_consider "$candidate" "$line_no" "$scan_context"
    fi

    # Also inspect obvious bare local paths.  This is a reference classifier,
    # not a shell parser: quoted/escaped command syntax is left to shims.
    [[ "$line" =~ [^[:space:]] ]] || return 0
    local -a words=()
    _lpr_core_pad_delimiters "$line"
    read -r -a words <<< "$_LPR_PADDED"
    local start end joined

    # A real path can be surrounded by prose and contain spaces.  Join words
    # beginning at path-shaped tokens and stop at the first concrete local
    # target; ordinary prose and placeholders remain untouched.
    for ((start = 0; start < ${#words[@]}; start++)); do
        _lpr_core_trim_candidate "${words[$start]}"
        candidate="$_LPR_CANDIDATE"
        _lpr_core_is_path_shaped "$candidate" || continue
        joined=""
        for ((end = start; end < ${#words[@]}; end++)); do
            [[ -n "$joined" ]] && joined="$joined "
            joined="${joined}${words[$end]}"
            _lpr_core_trim_candidate "$joined"
            candidate="$_LPR_CANDIDATE"
            if _lpr_core_is_path_shaped "$candidate" && _lpr_core_candidate_exists "$candidate"; then
                _lpr_core_consider "$candidate" "$line_no" "$scan_context"
                break
            fi
        done
    done

    local widx
    for ((widx = 0; widx < ${#words[@]}; widx++)); do
        token="${words[$widx]}"
        local context="$scan_context"
        if [[ "$scan_context" != "attachment" ]]; then
            case "$token" in
                *']('*) continue ;;
            esac
            case "$token" in
                *'`'*|*'"'*|*"'"*|*'('*|*')'*) context=evidence ;;
            esac
            # Padding splits a delimiter off into its own word, which breaks
            # the padded words' own adjacency to a delimiter that once sat
            # right next to this token. Recover that adjacency from the
            # original, unpadded $line instead: a delimiter immediately
            # before or after the token's own text there still promotes it.
            if [[ -n "$token" ]]; then
                local delim
                for delim in '`' '"' "'" '(' ')'; do
                    if [[ "$line" == *"$delim$token"* || "$line" == *"$token$delim"* ]]; then
                        context=evidence
                        break
                    fi
                done
            fi
        fi
        _lpr_core_trim_candidate "$token"
        candidate="$_LPR_CANDIDATE"
        if _lpr_core_is_path_shaped "$candidate"; then
            _lpr_core_consider "$candidate" "$line_no" "$context"
        else
            case "$candidate" in
                *.md|*.markdown|*.yaml|*.yml|*.json|*.toml|*.txt|*.sh|*.ts|*.tsx|*.js|*.jsx)
                    _lpr_core_consider "$candidate" "$line_no" "$context"
                    ;;
                *)
                    # Root-level extensionless candidates are only paths when a
                    # matching file actually exists in the repository.  This
                    # catches files such as `.env` and `secret` without treating
                    # arbitrary prose or illustrative words as missing paths.
                    if [[ -f "$_LPR_REPO_ROOT/$candidate" ]]; then
                        _lpr_core_consider "$candidate" "$line_no" "$context"
                    fi
                    ;;
            esac
        fi
    done
}

# local_path_ref_gate_core_check <repository-root> <inspectable-text> [context]
local_path_ref_gate_core_check() {
    local repo_root="${1-}" inspectable_text="${2-}" scan_context="${3-bare}" line line_no=0
    [[ -n "$repo_root" && -d "$repo_root" ]] || return 1
    # A repository/index lookup is part of classification.  Any setup failure
    # (not a repository, unavailable git, malformed root) is explicitly allow.
    if ! git -C "$repo_root" rev-parse --show-toplevel >/dev/null 2>&1; then
        return 1
    fi
    while [[ "$repo_root" != "/" && "$repo_root" == */ ]]; do
        repo_root="${repo_root%/}"
    done
    repo_root=$(cd -P "$repo_root" 2>/dev/null && pwd -P) || return 1
    _LPR_REPO_ROOT="$repo_root"
    _LPR_SEEN=""
    _LPR_COUNT=0

    while IFS= read -r line || [[ -n "$line" ]]; do
        line_no=$((line_no + 1))
        line="${line%$'\r'}"
        _lpr_core_scan_line "$line" "$line_no" "$scan_context"
    done <<EOF
$inspectable_text
EOF

    [[ "$_LPR_COUNT" -gt 0 ]]
}

# local_path_ref_gate_core_check_attachment <repository-root> <attachment-path>
# Attachments are local transfer inputs, not portable citations, even when a
# matching repository-relative file is tracked.
local_path_ref_gate_core_check_attachment() {
    local_path_ref_gate_core_check "${1-}" "${2-}" attachment
}

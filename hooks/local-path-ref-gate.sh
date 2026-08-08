#!/bin/bash
set -euo pipefail

# =============================================================================
# Local-path reference gate (Claude PreToolUse / Bash).
#
# This is the Claude envelope and shell-shape shim over
# hooks/local-path-ref-gate-core.sh.  It never executes the user's command and
# fails open on missing jq/core, malformed JSON, unknown shell shapes, or git
# inspection errors.
# omt-hook-dep: local-path-ref-gate-core.sh
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" || exit 0
CORE="$SCRIPT_DIR/local-path-ref-gate-core.sh"
[ -r "$CORE" ] || exit 0
source "$CORE" 2>/dev/null || exit 0

command -v jq >/dev/null 2>&1 || exit 0

input=$(cat 2>/dev/null) || exit 0
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null) || exit 0
[ -n "$cmd" ] || exit 0

# Match the command's effective working directory, following the Codex shim's
# workdir/cwd precedence.  A relative workdir is relative to the hook cwd.
top_cwd=$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null) || top_cwd=""
[ -n "$top_cwd" ] || top_cwd="$PWD"
workdir=$(printf '%s' "$input" | jq -r '.tool_input.workdir // .tool_input.cwd // empty' 2>/dev/null) || workdir=""
if [ -n "$workdir" ]; then
    case "$workdir" in
        /*) top_cwd="$workdir" ;;
        *) top_cwd="$top_cwd/$workdir" ;;
    esac
fi
cd "$top_cwd" 2>/dev/null || exit 0

repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
[ -d "$repo_root" ] || exit 0

_lpr_render_deny() {
    local records="$1" inspectable="$2" tab location line type path remediation instruction
    local line_no context reason="" valid=1
    tab=$'\t'

    while IFS="$tab" read -r location line type path remediation instruction; do
        [ -n "$location" ] || continue
        case "$location" in location=line:*) ;; *) valid=0; break ;; esac
        case "$line" in line=[0-9]*) line_no="${line#line=}" ;; *) valid=0; break ;; esac
        [ -n "$type" ] && [ -n "$path" ] && [ -n "$remediation" ] || { valid=0; break; }
        [ "$instruction" = "instruction=deleting the citation alone is forbidden" ] || { valid=0; break; }
        context=$(printf '%s\n' "$inspectable" | sed -n "${line_no}p" 2>/dev/null) || context=""
        [ -n "$context" ] || context="line $line_no"
        reason="${reason}${reason:+ }Violation at ${context} (type=${type#type=}, path=${path#path=}). Remedy: ${remediation#remediation=}; ${instruction#instruction=}."
    done <<EOF
$records
EOF

    [ "$valid" -eq 1 ] && [ -n "$reason" ] || return 1
    jq -n --arg reason "$reason" '{decision:"deny",reason:$reason}' >&2 2>/dev/null || return 1
    return 0
}

_lpr_check_text() {
    local text="$1" inspectable="${2-$1}" target_repo="${3-$repo_root}" records rc=0
    [ -n "$text" ] || return 0
    records=$(local_path_ref_gate_core_check "$target_repo" "$text" 2>/dev/null) || rc=$?
    [ "$rc" -eq 0 ] || return 0
    [ -n "$records" ] || return 0
    _lpr_render_deny "$records" "$inspectable" && return 2
    return 0
}

_lpr_check_staged_text() {
    local inspectable="$1" target_repo="${2-$repo_root}" scan_text
    scan_text=$(printf '%s\n' "$inspectable" | sed -E 's/^[^:]+:[0-9]+: //') || return 0
    _lpr_check_text "$scan_text" "$inspectable" "$target_repo"
    return $?
}

_lpr_staged_added_text() {
    local target_repo="${1:-$repo_root}" diff
    [ -d "$target_repo" ] || return 1
    diff=$(git -C "$target_repo" diff --cached --unified=0 --no-color -- 2>/dev/null) || return 1
    [ -n "$diff" ] || return 1
    printf '%s\n' "$diff" | awk '
        /^diff --git / { active=0; next }
        /^\+\+\+ / {
            if (!active) {
                path=$0
                sub(/^\+\+\+ /, "", path)
                sub(/^b\//, "", path)
                next
            }
        }
        /^@@ / {
            h=$0
            if (match(h, /\+[0-9]+(,[0-9]+)?/)) {
                h=substr(h, RSTART, RLENGTH)
                sub(/^\+/, "", h)
                split(h, a, ",")
                next_line=a[1] + 0
                active=1
            } else {
                active=0
            }
            next
        }
        /^\+/ {
            if (active && path != "") {
                print path ":" next_line ": " substr($0, 2)
                next_line++
            }
            next
        }
        /^ / { if (active) next_line++; next }
        /^-/ { next }
    ' || return 1
}

_lpr_extract_value_after() {
    local rest="$1" value="" char quote="" next
    local escaped=0 index=0 length
    rest="${rest#"${rest%%[![:space:]]*}"}"
    [ -n "$rest" ] || return 1
    length=${#rest}
    while [ "$index" -lt "$length" ]; do
        char="${rest:$index:1}"
        if [ "$escaped" -eq 1 ]; then
            value="${value}${char}"
            escaped=0
            index=$((index + 1))
            continue
        fi
        case "$quote" in
            "'")
                if [ "$char" = "'" ]; then quote=""; else value="${value}${char}"; fi
                ;;
            '"')
                if [ "$char" = '\\' ]; then
                    escaped=1
                elif [ "$char" = '"' ]; then
                    quote=""
                else
                    value="${value}${char}"
                fi
                ;;
            '')
                case "$char" in
                    "'"|'"') quote="$char" ;;
                    '\\') escaped=1 ;;
                    [[:space:]]) break ;;
                    *) value="${value}${char}" ;;
                esac
                ;;
        esac
        index=$((index + 1))
    done
    [ -z "$quote" ] && [ "$escaped" -eq 0 ] || return 1
    [ -n "$value" ] || return 1
    _LPR_VALUE="$value"
    _LPR_REMAINDER="${rest:$index}"
    return 0
}

_lpr_read_file() {
    local path="$1" contents
    [ -n "$path" ] || return 1
    case "$path" in -*) return 1 ;; esac
    _lpr_expand_file_path "$path" || return 1
    path="$_LPR_FILE_PATH"
    case "$path" in
        /*) ;;
        *) path="$PWD/$path" ;;
    esac
    [ -f "$path" ] && [ -r "$path" ] || return 1
    contents=$(cat "$path" 2>/dev/null) || return 1
    _LPR_VALUE="$contents"
    return 0
}

_lpr_expand_file_path() {
    local path="$1"
    _LPR_FILE_PATH="$path"
    case "$path" in
        '~'|'~/'*)
            [ -n "${HOME-}" ] || return 0
            _LPR_FILE_PATH="${HOME}${path#\~}"
            ;;
        '${HOME}'|'${HOME}'/*)
            [ -n "${HOME-}" ] || return 0
            _LPR_FILE_PATH="${HOME}${path#'${HOME}'}"
            ;;
        '${OMT_DIR}'|'${OMT_DIR}'/*)
            [ -n "${OMT_DIR-}" ] || return 0
            _LPR_FILE_PATH="${OMT_DIR}${path#'${OMT_DIR}'}"
            ;;
        '$HOME'|'$HOME'/*)
            [ -n "${HOME-}" ] || return 0
            _LPR_FILE_PATH="${HOME}${path#'$HOME'}"
            ;;
        '$OMT_DIR'|'$OMT_DIR'/*)
            [ -n "${OMT_DIR-}" ] || return 0
            _LPR_FILE_PATH="${OMT_DIR}${path#'$OMT_DIR'}"
            ;;
    esac
    return 0
}

_lpr_git_commit_target() {
    local segment="$1" git_re='^[[:space:]]*git([[:space:]]|$)' token target path base_cwd has_c=0
    [[ "$segment" =~ $git_re ]] || return 1
    segment="${segment#*"${BASH_REMATCH[0]}"}"
    target="$repo_root"
    while :; do
        _lpr_extract_value_after "$segment" || return 1
        token="$_LPR_VALUE"
        segment="$_LPR_REMAINDER"
        case "$token" in
            commit)
                _LPR_GIT_REPO="$target"
                return 0
                ;;
            -C)
                _lpr_extract_value_after "$segment" || return 1
                path="$_LPR_VALUE"
                segment="$_LPR_REMAINDER"
                ;;
            -C*)
                path="${token#-C}"
                [ -n "$path" ] || return 1
                ;;
            -c|--config)
                _lpr_extract_value_after "$segment" || return 1
                segment="$_LPR_REMAINDER"
                continue
                ;;
            -c?*|--config=*)
                continue
                ;;
            --)
                return 1
                ;;
            -*)
                continue
                ;;
            *)
                return 1
                ;;
        esac
        _lpr_expand_file_path "$path" || return 1
        path="$_LPR_FILE_PATH"
        case "$path" in
            /*) target="$path" ;;
            *)
                if [ "$has_c" -eq 1 ]; then
                    target="$target/$path"
                else
                    base_cwd="$PWD"
                    target="$base_cwd/$path"
                fi
                ;;
        esac
        has_c=1
        target=$(cd "$target" 2>/dev/null && pwd -P) || return 1
    done
}

_lpr_inspect_gh_body() {
    local value="$1" is_file="$2" rc=0
    case "$value" in @*|-) return 0 ;; esac
    if [ "$is_file" -eq 1 ]; then
        _lpr_read_file "$value" || return 0
        value="$_LPR_VALUE"
    fi
    _lpr_check_text "$value"
    rc=$?
    [ "$rc" -eq 2 ] && return 2
    return 0
}

_lpr_inspect_gh() {
    local segment="$1" gh_re='^[[:space:]]*gh[[:space:]]+pr[[:space:]]+(create|edit|comment)([[:space:]]|$)'
    local remaining token value rc=0
    [[ "$segment" =~ $gh_re ]] || return 0
    remaining="${segment#*"${BASH_REMATCH[0]}"}"
    while [ -n "$remaining" ]; do
        _lpr_extract_value_after "$remaining" || return 0
        token="$_LPR_VALUE"
        remaining="$_LPR_REMAINDER"
        case "$token" in
            --body|-b)
                _lpr_extract_value_after "$remaining" || return 0
                value="$_LPR_VALUE"
                remaining="$_LPR_REMAINDER"
                _lpr_inspect_gh_body "$value" 0
                rc=$?
                [ "$rc" -eq 2 ] && return 2
                ;;
            --body=*)
                _lpr_inspect_gh_body "${token#--body=}" 0
                rc=$?
                [ "$rc" -eq 2 ] && return 2
                ;;
            -b?*)
                value="${token#-b}"
                value="${value#=}"
                [ -n "$value" ] || continue
                _lpr_inspect_gh_body "$value" 0
                rc=$?
                [ "$rc" -eq 2 ] && return 2
                ;;
            --body-file)
                _lpr_extract_value_after "$remaining" || return 0
                value="$_LPR_VALUE"
                remaining="$_LPR_REMAINDER"
                _lpr_inspect_gh_body "$value" 1
                rc=$?
                [ "$rc" -eq 2 ] && return 2
                ;;
            --body-file=*)
                _lpr_inspect_gh_body "${token#--body-file=}" 1
                rc=$?
                [ "$rc" -eq 2 ] && return 2
                ;;
        esac
    done
    return 0
}

_lpr_check_curl_payload_text() {
    local text="$1" curl_text rc=0
    curl_text=$(printf '%s' "$text" | tr '{}\\",' '    ') || return 0
    _lpr_check_text "$curl_text"
    rc=$?
    [ "$rc" -eq 2 ] && return 2
    return 0
}

_lpr_inspect_curl_form() {
    local value="$1" attachment rc=0
    _lpr_check_text "$value"
    rc=$?
    [ "$rc" -eq 2 ] && return 2
    case "$value" in
        *=@*)
            attachment="${value#*=@}"
            attachment="${attachment%%;*}"
            [ -n "$attachment" ] || return 0
            # Markdown context lets the core retain spaces in attachment names.
            _lpr_check_text "[attachment]($attachment)"
            rc=$?
            [ "$rc" -eq 2 ] && return 2
            ;;
    esac
    return 0
}

_lpr_inspect_curl_data() {
    local value="$1" kind="$2" payload_file payload_text rc=0
    [ "$value" = "-" ] && return 0
    if [ "$kind" = "urlencode" ]; then
        _lpr_check_curl_payload_text "$value"
        rc=$?
        [ "$rc" -eq 2 ] && return 2
        case "$value" in
            *@*)
                payload_file="${value#*@}"
                [ -n "$payload_file" ] || return 0
                _lpr_read_file "$payload_file" || return 0
                payload_text="$_LPR_VALUE"
                _lpr_check_curl_payload_text "$payload_text"
                rc=$?
                [ "$rc" -eq 2 ] && return 2
                ;;
        esac
        return 0
    fi
    case "$value" in
        @*)
            payload_file="${value#@}"
            _lpr_read_file "$payload_file" || return 0
            payload_text="$_LPR_VALUE"
            _lpr_check_curl_payload_text "$payload_text"
            rc=$?
            [ "$rc" -eq 2 ] && return 2
            ;;
        *)
            _lpr_check_curl_payload_text "$value"
            rc=$?
            [ "$rc" -eq 2 ] && return 2
            ;;
    esac
    return 0
}

_lpr_inspect_curl() {
    local segment="$1" curl_re='^[[:space:]]*curl([[:space:]]|$)' target_re
    local remaining token value kind rc=0
    [[ "$segment" =~ $curl_re ]] || return 0
    # Require a URL token (rather than merely seeing a host in JSON data) so
    # non-target curl calls remain outside this gate's scope.
    target_re='(^|[[:space:]'\''"=])https://(api[.]notion[.]com|slack[.]com/api|api[.]linear[.]app|linear[.]app/api)'
    [[ "$segment" =~ $target_re ]] || return 0
    remaining="$segment"
    while [ -n "$remaining" ]; do
        _lpr_extract_value_after "$remaining" || return 0
        token="$_LPR_VALUE"
        remaining="$_LPR_REMAINDER"
        kind=""
        case "$token" in
            -F|--form)
                _lpr_extract_value_after "$remaining" || return 0
                value="$_LPR_VALUE"
                remaining="$_LPR_REMAINDER"
                _lpr_inspect_curl_form "$value"
                rc=$?
                [ "$rc" -eq 2 ] && return 2
                continue
                ;;
            -F?*)
                value="${token#-F}"
                _lpr_inspect_curl_form "$value"
                rc=$?
                [ "$rc" -eq 2 ] && return 2
                continue
                ;;
            --form=*)
                value="${token#--form=}"
                _lpr_inspect_curl_form "$value"
                rc=$?
                [ "$rc" -eq 2 ] && return 2
                continue
                ;;
            --data|--data-raw|--data-binary|--data-ascii|--json|--data-urlencode|-d)
                case "$token" in --data-urlencode) kind="urlencode" ;; esac
                _lpr_extract_value_after "$remaining" || return 0
                value="$_LPR_VALUE"
                remaining="$_LPR_REMAINDER"
                _lpr_inspect_curl_data "$value" "$kind"
                rc=$?
                [ "$rc" -eq 2 ] && return 2
                continue
                ;;
            --data=*) value="${token#--data=}" ;;
            --data-raw=*) value="${token#--data-raw=}" ;;
            --data-binary=*) value="${token#--data-binary=}" ;;
            --data-ascii=*) value="${token#--data-ascii=}" ;;
            --json=*) value="${token#--json=}" ;;
            --data-urlencode=*) value="${token#--data-urlencode=}"; kind="urlencode" ;;
            -d?*) value="${token#-d}" ;;
            *) continue ;;
        esac
        [ -n "$value" ] || continue
        _lpr_inspect_curl_data "$value" "$kind"
        rc=$?
        [ "$rc" -eq 2 ] && return 2
    done
    return 0
}

_lpr_inspect_git() {
    local segment="$1" staged_text rc=0
    if _lpr_git_commit_target "$segment"; then
        staged_text=$(_lpr_staged_added_text "$_LPR_GIT_REPO") || staged_text=""
        if [ -n "$staged_text" ]; then
            _lpr_check_staged_text "$staged_text" "$_LPR_GIT_REPO"
            rc=$?
            [ "$rc" -eq 2 ] && return 2
        fi
    fi
    return 0
}

_lpr_inspect_segment() {
    local segment="$1" rc=0
    _lpr_inspect_git "$segment"
    rc=$?
    [ "$rc" -eq 2 ] && return 2
    _lpr_inspect_gh "$segment"
    rc=$?
    [ "$rc" -eq 2 ] && return 2
    _lpr_inspect_curl "$segment"
    rc=$?
    [ "$rc" -eq 2 ] && return 2
    return 0
}

# Split the limited composite shell shapes without evaluating expansion,
# substitutions, redirects, or any command.  An unmatched quote/escape is
# undecidable, so the entire command fails open before any inspection.
_lpr_each_shell_command() {
    local handler="$1" source="$cmd" segment="" quote="" char next
    local escaped=0 index=0 length=${#cmd} rc=0
    local -a segments
    while [ "$index" -lt "$length" ]; do
        char="${source:$index:1}"
        if [ "$escaped" -eq 1 ]; then
            segment="${segment}${char}"
            escaped=0
            index=$((index + 1))
            continue
        fi
        case "$quote" in
            "'")
                segment="${segment}${char}"
                [ "$char" = "'" ] && quote=""
                ;;
            '"')
                segment="${segment}${char}"
                if [ "$char" = '\\' ]; then
                    escaped=1
                elif [ "$char" = '"' ]; then
                    quote=""
                fi
                ;;
            '')
                case "$char" in
                    "'"|'"')
                        quote="$char"
                        segment="${segment}${char}"
                        ;;
                    '\\')
                        segment="${segment}${char}"
                        escaped=1
                        ;;
                    ';'|'&'|'|'|$'\n')
                        segments[${#segments[@]}]="$segment"
                        segment=""
                        next="${source:$((index + 1)):1}"
                        if { [ "$char" = '&' ] || [ "$char" = '|' ]; } && [ "$next" = "$char" ]; then
                            index=$((index + 1))
                        fi
                        ;;
                    *) segment="${segment}${char}" ;;
                esac
                ;;
        esac
        index=$((index + 1))
    done
    [ -z "$quote" ] && [ "$escaped" -eq 0 ] || return 0
    segments[${#segments[@]}]="$segment"
    for segment in "${segments[@]}"; do
        "$handler" "$segment"
        rc=$?
        [ "$rc" -eq 2 ] && return 2
    done
    return 0
}

if _lpr_each_shell_command _lpr_inspect_segment; then
    :
else
    rc=$?
    [ "$rc" -eq 2 ] && exit 2
fi
exit 0

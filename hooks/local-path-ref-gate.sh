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
    local rest="$1" value remainder
    rest="${rest#"${rest%%[![:space:]]*}"}"
    [ -n "$rest" ] || return 1
    local first_char="${rest%"${rest#?}"}"
    if [ "$first_char" = '"' ]; then
        case "$rest" in *\\\"*) return 1 ;; esac
        remainder="${rest#\"}"
        [[ "$remainder" == *\"* ]] || return 1
        value="${remainder%%\"*}"
        remainder="${remainder#*\"}"
    elif [ "$first_char" = "'" ]; then
        remainder="${rest#\'}"
        [[ "$remainder" == *\'* ]] || return 1
        value="${remainder%%\'*}"
        remainder="${remainder#*\'}"
    else
        value="${rest%%[[:space:]]*}"
        remainder="${rest#"$value"}"
    fi
    [ -n "$value" ] || return 1
    _LPR_VALUE="$value"
    _LPR_REMAINDER="$remainder"
    return 0
}

_lpr_gh_body() {
    local segment="$1" marker rest
    local body_re='(^|[[:space:]])--body(=|[[:space:]])'
    local body_file_re='(^|[[:space:]])--body-file(=|[[:space:]])'
    if [[ "$segment" =~ $body_re ]]; then
        marker="${BASH_REMATCH[0]}"
        rest="${segment#*"$marker"}"
        _lpr_extract_value_after "$rest" || return 1
        case "$_LPR_VALUE" in @*|-) return 1 ;; esac
        return 0
    fi
    if [[ "$segment" =~ $body_file_re ]]; then
        marker="${BASH_REMATCH[0]}"
        rest="${segment#*"$marker"}"
        _lpr_extract_value_after "$rest" || return 1
        case "$_LPR_VALUE" in -*) return 1 ;; esac
        _lpr_read_file "$_LPR_VALUE" || return 1
        return 0
    fi
    return 1
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
    local git_re='(^|[;&|])[[:space:]]*git([[:space:]]|$)' segment token target path base_cwd has_c=0
    [[ "$cmd" =~ $git_re ]] || return 1
    segment="${cmd#*"${BASH_REMATCH[0]}"}"
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

_lpr_inspect_gh() {
    local gh_re='(^|[;&|])[[:space:]]*gh[[:space:]]+pr[[:space:]]+(create|edit)([[:space:]]|$)' segment
    [[ "$cmd" =~ $gh_re ]] || return 0
    segment="${cmd#*"${BASH_REMATCH[0]}"}"
    _lpr_gh_body "$segment" || return 0
    _lpr_check_text "$_LPR_VALUE"
    return $?
}

_lpr_inspect_curl() {
    local curl_re='(^|[;&|])[[:space:]]*curl([[:space:]]|$)' target_re
    local segment curl_text payload_file payload_text rc=0
    local marker rest remaining
    local form_re='(^|[[:space:]])(-F|--form)(=|[[:space:]])' form_marker form_value attachment
    local data_re='(^|[[:space:]])(--data|--data-raw|--data-binary|--data-urlencode|-d)(=|[[:space:]])'
    [[ "$cmd" =~ $curl_re ]] || return 0
    segment="${cmd#*"${BASH_REMATCH[0]}"}"
    # Require a URL token (rather than merely seeing a host in JSON data) so
    # non-target curl calls remain outside this gate's scope.
    target_re='(^|[[:space:]'\''"])https://(api[.]notion[.]com|slack[.]com/api|api[.]linear[.]app|linear[.]app/api)'
    [[ "$segment" =~ $target_re ]] || return 0
    remaining="$segment"
    while [[ "$remaining" =~ $form_re ]]; do
        form_marker="${BASH_REMATCH[0]}"
        rest="${remaining#*"$form_marker"}"
        _lpr_extract_value_after "$rest" || break
        form_value="$_LPR_VALUE"
        remaining="$_LPR_REMAINDER"
        case "$form_value" in
            *=@*)
                attachment="${form_value#*=@}"
                attachment="${attachment%%;*}"
                [ -n "$attachment" ] || continue
                _lpr_check_text "$attachment"
                rc=$?
                [ "$rc" -eq 2 ] && return 2
                ;;
        esac
    done
    remaining="$segment"
    while [[ "$remaining" =~ $data_re ]]; do
        marker="${BASH_REMATCH[0]}"
        rest="${remaining#*"$marker"}"
        _lpr_extract_value_after "$rest" || break
        remaining="$_LPR_REMAINDER"
        case "$_LPR_VALUE" in
            @*)
                payload_file="${_LPR_VALUE#@}"
                if _lpr_read_file "$payload_file"; then
                    payload_text="$_LPR_VALUE"
                    curl_text=$(printf '%s' "$payload_text" | tr '{}\\",' '    ') || continue
                    _lpr_check_text "$curl_text"
                    rc=$?
                    [ "$rc" -eq 2 ] && return 2
                fi
                ;;
            -) ;;
            *)
                curl_text=$(printf '%s' "$_LPR_VALUE" | tr '{}\\",' '    ') || continue
                _lpr_check_text "$curl_text"
                rc=$?
                [ "$rc" -eq 2 ] && return 2
                ;;
        esac
    done
    return 0
}

# A bounded git-commit shape is the only route that reads staged content.
_lpr_git_re='(^|[;&|])[[:space:]]*git([[:space:]]|$)'
if [[ "$cmd" =~ $_lpr_git_re ]]; then
    if _lpr_git_commit_target; then
        staged_text=$(_lpr_staged_added_text "$_LPR_GIT_REPO") || staged_text=""
        if [ -n "$staged_text" ]; then
            _lpr_check_staged_text "$staged_text" "$_LPR_GIT_REPO"
            [ "$?" -eq 2 ] && exit 2
        fi
    fi
fi

_lpr_inspect_gh
[ "$?" -eq 2 ] && exit 2
_lpr_inspect_curl
[ "$?" -eq 2 ] && exit 2
exit 0

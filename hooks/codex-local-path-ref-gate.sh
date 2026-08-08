#!/bin/bash
set -euo pipefail

# Codex PreToolUse adapter for the shared local-path reference judgment core.
# It only inspects hook JSON and git's staged diff; the requested command is
# never evaluated.  Malformed/setup/inspection failures fail open.
#
# omt-hook-dep: local-path-ref-gate-core.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" || exit 0
CORE="$SCRIPT_DIR/local-path-ref-gate-core.sh"
[ -r "$CORE" ] || exit 0
source "$SCRIPT_DIR/local-path-ref-gate-core.sh" 2>/dev/null || exit 0
command -v jq >/dev/null 2>&1 || exit 0

input=$(cat 2>/dev/null) || exit 0
[ -n "$input" ] || exit 0

_lpr_json_string() {
    local filter="$1" value
    value=$(printf '%s' "$input" | jq -r "$filter" 2>/dev/null) || return 1
    [ -n "$value" ] || return 1
    printf '%s' "$value"
    return 0
}

tool_name=$(_lpr_json_string 'if (.tool_name? | type) == "string" then .tool_name else empty end') || exit 0

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
    jq -n --arg reason "$reason" \
        '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$reason}}' \
        2>/dev/null || return 1
    return 0
}

_lpr_check_text() {
    local text="$1" records rc=0
    [ -n "$text" ] || return 0
    records=$(local_path_ref_gate_core_check "$repo_root" "$text" 2>/dev/null) || rc=$?
    [ "$rc" -eq 0 ] || return 0
    [ -n "$records" ] || return 0
    _lpr_render_deny "$records" "$text" && return 2
    return 0
}

_lpr_staged_added_text() {
    local diff
    diff=$(git -C "$repo_root" diff --cached --unified=0 --no-color -- 2>/dev/null) || return 1
    [ -n "$diff" ] || return 1
    printf '%s\n' "$diff" | awk '
        /^diff --git / { active=0; path=""; next }
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

_lpr_prepare_repo() {
    local top_cwd workdir
    top_cwd=$(_lpr_json_string 'if (.cwd? | type) == "string" then .cwd else empty end' 2>/dev/null) || top_cwd="$PWD"
    workdir=$(_lpr_json_string 'if (.tool_input.workdir? | type) == "string" then .tool_input.workdir elif (.tool_input.cwd? | type) == "string" then .tool_input.cwd else empty end' 2>/dev/null) || workdir=""
    if [ -n "$workdir" ]; then
        case "$workdir" in
            /*) top_cwd="$workdir" ;;
            *) top_cwd="$top_cwd/$workdir" ;;
        esac
    fi
    cd "$top_cwd" 2>/dev/null || return 1
    repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || return 1
    [ -d "$repo_root" ] || return 1
    return 0
}

_lpr_extract_value_after() {
    local rest="$1" value first_char remainder
    rest="${rest#"${rest%%[![:space:]]*}"}"
    [ -n "$rest" ] || return 1
    first_char="${rest%"${rest#?}"}"
    if [ "$first_char" = '"' ]; then
        case "$rest" in *\\\"*) return 1 ;; esac
        rest="${rest#\"}"
        [[ "$rest" == *\"* ]] || return 1
        value="${rest%%\"*}"
        remainder="${rest#"$value"}"
        remainder="${remainder#\"}"
    elif [ "$first_char" = "'" ]; then
        rest="${rest#\'}"
        [[ "$rest" == *\'* ]] || return 1
        value="${rest%%\'*}"
        remainder="${rest#"$value"}"
        remainder="${remainder#\'}"
    else
        value="${rest%%[[:space:]]*}"
        remainder="${rest#"$value"}"
    fi
    [ -n "$value" ] || return 1
    _LPR_VALUE="$value"
    _LPR_REST_AFTER_VALUE="$remainder"
    return 0
}

_lpr_read_file_content() {
    local path="$1"
    [ -n "$path" ] || return 1
    _lpr_core_expand_path "$path" || return 1
    path="$_LPR_EXPANDED"
    case "$path" in
        /*) ;;
        *) path="$PWD/$path" ;;
    esac
    [ -f "$path" ] && [ -r "$path" ] || return 1
    _LPR_VALUE=$(cat "$path" 2>/dev/null) || return 1
    return 0
}

_lpr_gh_body() {
    local segment="$1" marker rest body_file=0
    local body_re='(^|[[:space:]])--body(-file)?(=|[[:space:]])'
    [[ "$segment" =~ $body_re ]] || return 1
    marker="${BASH_REMATCH[0]}"
    rest="${segment#*"$marker"}"
    _lpr_extract_value_after "$rest" || return 1
    case "$marker" in *--body-file*) body_file=1 ;; esac
    case "$_LPR_VALUE" in
        @*) _lpr_read_file_content "${_LPR_VALUE#@}" || return 1 ;;
        -) return 1 ;;
        *) [ "$body_file" -eq 1 ] && _lpr_read_file_content "$_LPR_VALUE" || return 0 ;;
    esac
    return 0
}

_lpr_inspect_gh() {
    local gh_re='(^|[;&|])[[:space:]]*gh[[:space:]]+pr[[:space:]]+(create|edit|comment)([[:space:]]|$)'
    local remaining="$cmd" marker segment rc=0

    # Search repeatedly: an inspected shell command may contain multiple PR
    # operations joined by `;`, `&&`, `||`, or `|`.  Only read their body
    # arguments; never evaluate any part of the shell input.
    while [[ "$remaining" =~ $gh_re ]]; do
        marker="${BASH_REMATCH[0]}"
        segment="${remaining#*"$marker"}"
        if _lpr_gh_body "$segment"; then
            _lpr_check_text "$_LPR_VALUE" || rc=$?
            [ "$rc" -eq 2 ] && return 2
            rc=0
            remaining="$_LPR_REST_AFTER_VALUE"
        else
            # Consume this gh invocation marker before looking for a later
            # one, so a body-less operation cannot make the loop stall.
            remaining="$segment"
        fi
    done
    return 0
}

_lpr_curl_payload() {
    local segment="$1" marker rest token attached_rest
    local data_re='(^|[[:space:]])(--data([[:alnum:]_-]*)|-d)(=|[[:space:]]|$)|(^|[[:space:]])-d[^[:space:]]'
    [[ "$segment" =~ $data_re ]] || return 1
    marker="${BASH_REMATCH[0]}"
    token="${marker#"${marker%%[![:space:]]*}"}"
    rest="${segment#*"$marker"}"
    case "$token" in
        -d[![:space:]=]*)
            attached_rest="${token#-d}${rest}"
            _lpr_extract_value_after "$attached_rest" || return 1
            _LPR_CURL_OPTION="-d"
            case "$_LPR_VALUE" in
                @*) _lpr_read_file_content "${_LPR_VALUE#@}" || return 1 ;;
                -) return 1 ;;
            esac
            _LPR_CURL_REMAINDER="$_LPR_REST_AFTER_VALUE"
            return 0
            ;;
    esac
    _lpr_extract_value_after "$rest" || return 1
    case "$token" in
        --data-urlencode*) _LPR_CURL_OPTION="--data-urlencode" ;;
        *) _LPR_CURL_OPTION="--data" ;;
    esac
    case "$_LPR_VALUE" in
        @*) _lpr_read_file_content "${_LPR_VALUE#@}" || return 1 ;;
        -) return 1 ;;
        *)
            # `--data-urlencode name@file` reads file bytes as the value.
            # If that file cannot be read, the whole inspection is
            # undecidable and must fail open.
            if [ "$_LPR_CURL_OPTION" = "--data-urlencode" ]; then
                case "$_LPR_VALUE" in
                    ?*@*) _lpr_read_file_content "${_LPR_VALUE#*@}" || return 1 ;;
                esac
            fi
            ;;
    esac
    _LPR_CURL_REMAINDER="$_LPR_REST_AFTER_VALUE"
    return 0
}

_lpr_curl_form() {
    local segment="$1" marker rest token attached_rest
    local form_re='(^|[[:space:]])(--form|-F)(=|[[:space:]]|$)|(^|[[:space:]])-F[^[:space:]]'
    [[ "$segment" =~ $form_re ]] || return 1
    marker="${BASH_REMATCH[0]}"
    token="${marker#"${marker%%[![:space:]]*}"}"
    rest="${segment#*"$marker"}"
    case "$token" in
        -F[![:space:]=]*)
            attached_rest="${token#-F}${rest}"
            _lpr_extract_value_after "$attached_rest" || return 1
            _LPR_CURL_REMAINDER="$_LPR_REST_AFTER_VALUE"
            return 0
            ;;
    esac
    _lpr_extract_value_after "$rest" || return 1
    _LPR_CURL_REMAINDER="$_LPR_REST_AFTER_VALUE"
    return 0
}

_lpr_curl_form_attachment() {
    local form="$1" path expanded
    case "$form" in
        @*) path="${form#@}" ;;
        *=@*) path="${form#*=@}" ;;
        *) return 0 ;;
    esac
    # curl permits options after an attachment path (for example
    # `;type=image/png`).  The path itself is the only part classified here.
    path="${path%%;*}"
    [ -n "$path" ] || return 0

    # An unreadable/missing attachment is an inspection failure, not a
    # citation violation.  Preserve the gate's fail-open contract before
    # handing the concrete path to the shared classifier.
    _lpr_core_expand_path "$path" || return 0
    expanded="$_LPR_EXPANDED"
    case "$expanded" in
        /*) ;;
        *) expanded="$repo_root/$expanded" ;;
    esac
    [ -f "$expanded" ] && [ -r "$expanded" ] || return 0

    _lpr_check_text "$path"
    case "$?" in
        2) return 2 ;;
    esac

    # The attachment path itself is outbound local content.  Its concrete
    # reference is sufficient for the shared classifier; do not reinterpret
    # arbitrary binary bytes as shell/prose text.
    return 0
}

_lpr_inspect_curl() {
    local curl_re='(^|[;&|])[[:space:]]*curl([[:space:]]|$)' target_re
    local segment curl_text remaining rc form_rc
    [[ "$cmd" =~ $curl_re ]] || return 0
    segment="${cmd#*"${BASH_REMATCH[0]}"}"
    target_re='(^|[[:space:]'\''"])https://(api[.]notion[.]com|slack[.]com/api|api[.]linear[.]app|linear[.]app/api)'
    [[ "$segment" =~ $target_re ]] || return 0
    remaining="$segment"
    while _lpr_curl_payload "$remaining"; do
        curl_text=$(printf '%s' "$_LPR_VALUE" | tr '{}\",' '    ') || return 0
        _lpr_check_text "$curl_text" || rc=$?
        [ "${rc:-0}" -eq 2 ] && return 2
        rc=0
        remaining="$_LPR_CURL_REMAINDER"
    done

    # Multipart options are independent from --data options; inspect every
    # --form/-F occurrence rather than stopping after the first one.
    remaining="$segment"
    while _lpr_curl_form "$remaining"; do
        form_rc=0
        _lpr_curl_form_attachment "$_LPR_VALUE" || form_rc=$?
        [ "$form_rc" -eq 2 ] && return 2
        remaining="$_LPR_CURL_REMAINDER"
    done
    return 0
}

_lpr_git_commit_staged_text() {
    local base_repo_root="$repo_root" remaining="$cmd" marker target_marker
    local target_rest target repo_for_commit staged_text rc=0
    local git_re='(^|[;&|])[[:space:]]*git([[:space:]]+[^;&|[:space:]]+)*[[:space:]]+commit([[:space:]]|$)'
    local dash_c_re='(^|[[:space:]])-C([[:space:]]|$)'

    # Each `git commit` can select a repository of its own with `-C`.  The
    # default shell repository is not necessarily the repository that Git will
    # commit, especially in compound commands.
    while [[ "$remaining" =~ $git_re ]]; do
        marker="${BASH_REMATCH[0]}"
        repo_for_commit="$base_repo_root"
        if [[ "$marker" =~ $dash_c_re ]]; then
            target_marker="${BASH_REMATCH[0]}"
            target_rest="${marker#*"$target_marker"}"
            if _lpr_extract_value_after "$target_rest"; then
                target="$_LPR_VALUE"
                repo_for_commit=$(git -C "$target" rev-parse --show-toplevel 2>/dev/null) || {
                    repo_root="$base_repo_root"
                    return 0
                }
            else
                repo_root="$base_repo_root"
                return 0
            fi
        fi

        [ -d "$repo_for_commit" ] || {
            repo_root="$base_repo_root"
            return 0
        }
        repo_root="$repo_for_commit"
        staged_text=$(_lpr_staged_added_text) || staged_text=""
        if [ -n "$staged_text" ]; then
            _lpr_check_text "$staged_text" || rc=$?
            if [ "$rc" -eq 2 ]; then
                repo_root="$base_repo_root"
                return 2
            fi
            rc=0
        fi
        remaining="${remaining#*"$marker"}"
    done
    repo_root="$base_repo_root"
    return 0
}

_lpr_shell_route() {
    local command_value rc=0
    command_value=$(_lpr_json_string 'if (.tool_input.command? | type) == "string" then .tool_input.command else empty end' 2>/dev/null) || \
        command_value=$(_lpr_json_string 'if (.tool_input.cmd? | type) == "string" then .tool_input.cmd else empty end' 2>/dev/null) || exit 0
    cmd="$command_value"
    _lpr_prepare_repo || exit 0

    _lpr_git_commit_staged_text || rc=$?
    [ "$rc" -eq 2 ] && return 2
    rc=0

    _lpr_inspect_gh || rc=$?
    [ "$rc" -eq 2 ] && return 2
    rc=0
    _lpr_inspect_curl || rc=$?
    [ "$rc" -eq 2 ] && return 2
    return 0
}

case "$tool_name" in
    Bash|bash|exec_command|shell_command)
        _lpr_shell_route || rc=$?
        [ "${rc:-0}" -eq 2 ] && exit 0
        exit 0
        ;;
    mcp__notion__*|mcp__slack__*|mcp__linear__*)
        _lpr_prepare_repo || exit 0
        inspectable=$(printf '%s' "$input" | jq -r 'if (.tool_input? | type) == "object" or (.tool_input? | type) == "array" then .tool_input | .. | strings else empty end' 2>/dev/null) || exit 0
        [ -n "$inspectable" ] || exit 0
        rc=0
        _lpr_check_text "$inspectable" || rc=$?
        [ "$rc" -eq 2 ] && exit 0
        exit 0
        ;;
    *) exit 0 ;;
esac

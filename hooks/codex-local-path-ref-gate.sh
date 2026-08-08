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

_lpr_check_attachment() {
    local attachment="$1" inspectable="${2-$1}" records rc=0
    [ -n "$attachment" ] || return 0
    records=$(local_path_ref_gate_core_check_attachment "$repo_root" "$attachment" 2>/dev/null) || rc=$?
    [ "$rc" -eq 0 ] || return 0
    [ -n "$records" ] || return 0
    _lpr_render_deny "$records" "$inspectable" && return 2
    return 0
}

_lpr_check_staged_text() {
    local inspectable="$1" scan_text records rc=0
    scan_text=$(printf '%s\n' "$inspectable" | sed -E 's/^[^:]+:[0-9]+: //') || return 0
    records=$(local_path_ref_gate_core_check "$repo_root" "$scan_text" 2>/dev/null) || rc=$?
    [ "$rc" -eq 0 ] || return 0
    [ -n "$records" ] || return 0
    _lpr_render_deny "$records" "$inspectable" && return 2
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
    effective_cwd="$PWD"
    repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || return 1
    [ -d "$repo_root" ] || return 1
    return 0
}

# This is a deliberately small, non-evaluating shell lexer.  It recognizes
# only words, quotes, escaped characters, and top-level command separators.
# That is enough to avoid treating quoted argument text as a second command.
_lpr_shell_next_word() {
    local rest="$1" length index=0 char quote="" value=""
    rest="${rest#"${rest%%[![:space:]]*}"}"
    [ -n "$rest" ] || return 1
    length=${#rest}
    while [ "$index" -lt "$length" ]; do
        char="${rest:$index:1}"
        if [ -n "$quote" ]; then
            if [ "$quote" = "'" ]; then
                if [ "$char" = "'" ]; then quote=""; else value="${value}${char}"; fi
            elif [ "$char" = '"' ]; then
                quote=""
            elif [ "$char" = '\' ]; then
                index=$((index + 1))
                [ "$index" -lt "$length" ] || return 1
                char="${rest:$index:1}"
                # In double quotes, a backslash only escapes `$`, backticks,
                # double quotes, backslashes, and newlines. Preserve it for
                # every other character so the inspected argv matches shell.
                case "$char" in
                    '$'|'`'|'"'|'\'|$'\n') value="${value}${char}" ;;
                    *) value="${value}\\${char}" ;;
                esac
            else
                value="${value}${char}"
            fi
        else
            case "$char" in
                [[:space:]]) break ;;
                "'"|'"') quote="$char" ;;
                '\')
                    index=$((index + 1))
                    [ "$index" -lt "$length" ] || return 1
                    value="${value}${rest:$index:1}"
                    ;;
                *) value="${value}${char}" ;;
            esac
        fi
        index=$((index + 1))
    done
    [ -z "$quote" ] || return 1
    [ -n "$value" ] || return 1
    _LPR_WORD="$value"
    _LPR_SHELL_REMAINDER="${rest:$index}"
    return 0
}

_lpr_shell_next_segment() {
    local rest="$1" length index=0 next_index char quote=""
    length=${#rest}
    while [ "$index" -lt "$length" ]; do
        char="${rest:$index:1}"
        if [ -n "$quote" ]; then
            if [ "$quote" = "'" ]; then
                [ "$char" = "'" ] && quote=""
            elif [ "$char" = '"' ]; then
                quote=""
            elif [ "$char" = '\' ]; then
                index=$((index + 1))
                [ "$index" -lt "$length" ] || return 1
            fi
        else
            case "$char" in
                "'"|'"') quote="$char" ;;
                '\')
                    index=$((index + 1))
                    [ "$index" -lt "$length" ] || return 1
                    ;;
                ';'|'&'|'|'|$'\n')
                    next_index=$((index + 1))
                    while [ "$next_index" -lt "$length" ]; do
                        case "${rest:$next_index:1}" in
                            ';'|'&'|'|'|$'\n') next_index=$((next_index + 1)) ;;
                            *) break ;;
                        esac
                    done
                    _LPR_SEGMENT="${rest:0:index}"
                    _LPR_SHELL_REMAINDER="${rest:$next_index}"
                    return 0
                    ;;
            esac
        fi
        index=$((index + 1))
    done
    [ -z "$quote" ] || return 1
    _LPR_SEGMENT="$rest"
    _LPR_SHELL_REMAINDER=""
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

_lpr_gh_body_value() {
    local value="$1" body_file="$2"
    [ "$value" != "-" ] || return 1
    if [ "$body_file" -eq 1 ]; then
        _lpr_read_file_content "$value" || return 1
    else
        _LPR_VALUE="$value"
    fi
    return 0
}

_lpr_inspect_gh() {
    local remaining="$cmd" segment rest action word value body_file rc=0
    while [ -n "$remaining" ]; do
        _lpr_shell_next_segment "$remaining" || return 0
        segment="$_LPR_SEGMENT"
        remaining="$_LPR_SHELL_REMAINDER"
        _lpr_shell_next_word "$segment" || continue
        [ "$_LPR_WORD" = "gh" ] || continue
        rest="$_LPR_SHELL_REMAINDER"
        _lpr_shell_next_word "$rest" || continue
        [ "$_LPR_WORD" = "pr" ] || continue
        rest="$_LPR_SHELL_REMAINDER"
        _lpr_shell_next_word "$rest" || continue
        action="$_LPR_WORD"
        case "$action" in create|edit|comment) ;; *) continue ;; esac
        rest="$_LPR_SHELL_REMAINDER"
        while _lpr_shell_next_word "$rest"; do
            word="$_LPR_WORD"
            rest="$_LPR_SHELL_REMAINDER"
            body_file=0
            case "$word" in
                -b|--body)
                    _lpr_shell_next_word "$rest" || return 0
                    value="$_LPR_WORD"; rest="$_LPR_SHELL_REMAINDER"
                    ;;
                -F|--body-file)
                    body_file=1
                    _lpr_shell_next_word "$rest" || return 0
                    value="$_LPR_WORD"; rest="$_LPR_SHELL_REMAINDER"
                    ;;
                --body=*) value="${word#--body=}" ;;
                --body-file=*) body_file=1; value="${word#--body-file=}" ;;
                -F?*) body_file=1; value="${word#-F}" ;;
                -b?*) value="${word#-b}" ;;
                *) continue ;;
            esac
            _lpr_gh_body_value "$value" "$body_file" || return 0
            _lpr_check_text "$_LPR_VALUE" || rc=$?
            [ "$rc" -eq 2 ] && return 2
            rc=0
        done
    done
    return 0
}

_lpr_curl_payload_value() {
    local value="$1" option="$2"
    _LPR_VALUE="$value"
    case "$value" in
        @*) _lpr_read_file_content "${value#@}" || return 1 ;;
        -) return 1 ;;
        *)
            if [ "$option" = "--data-urlencode" ]; then
                case "$value" in ?*@*) _lpr_read_file_content "${value#*@}" || return 1 ;; esac
            fi
            ;;
    esac
    return 0
}

_lpr_curl_file_attachment() {
    local path="$1" expanded attachment_rc=0
    [ -n "$path" ] || return 0
    path="${path%%;*}"
    [ -n "$path" ] || return 0
    _lpr_core_expand_path "$path" || return 0
    expanded="$_LPR_EXPANDED"
    case "$expanded" in
        /*) ;;
        *) expanded="$effective_cwd/$expanded" ;;
    esac
    [ -f "$expanded" ] && [ -r "$expanded" ] || return 0
    _lpr_check_attachment "$expanded" "$path" || attachment_rc=$?
    [ "$attachment_rc" -eq 2 ] && return 2
    return 0
}

_lpr_curl_form_attachment() {
    local form="$1" path
    case "$form" in
        @*) path="${form#@}" ;;
        *=@*) path="${form#*=@}" ;;
        *) return 0 ;;
    esac
    _lpr_curl_file_attachment "$path"
}

_lpr_curl_is_target_url() {
    case "$1" in
        https://api.notion.com|https://api.notion.com[/?#]*|https://slack.com/api|https://slack.com/api[/?#]*|https://api.linear.app|https://api.linear.app[/?#]*|https://linear.app/api|https://linear.app/api[/?#]*)
            return 0
            ;;
        *) return 1 ;;
    esac
}

_lpr_inspect_curl() {
    local remaining="$cmd" segment rest arguments word value option target rc=0 form_rc curl_text
    while [ -n "$remaining" ]; do
        _lpr_shell_next_segment "$remaining" || return 0
        segment="$_LPR_SEGMENT"
        remaining="$_LPR_SHELL_REMAINDER"
        _lpr_shell_next_word "$segment" || continue
        [ "$_LPR_WORD" = "curl" ] || continue
        arguments="$_LPR_SHELL_REMAINDER"
        rest="$arguments"; target=0
        while _lpr_shell_next_word "$rest"; do
            word="$_LPR_WORD"; rest="$_LPR_SHELL_REMAINDER"
            case "$word" in
                --url)
                    _lpr_shell_next_word "$rest" || return 0
                    _lpr_curl_is_target_url "$_LPR_WORD" && target=1
                    rest="$_LPR_SHELL_REMAINDER"
                    ;;
                --url=*) _lpr_curl_is_target_url "${word#--url=}" && target=1 ;;
                --data|--data-raw|--data-binary|--data-ascii|--data-urlencode|--json|-d|--form|-F|--form-string|--upload-file|-T|-X|--request|-H|--header|-u|--user)
                    _lpr_shell_next_word "$rest" || return 0
                    rest="$_LPR_SHELL_REMAINDER"
                    ;;
                --data=*|--data-raw=*|--data-binary=*|--data-ascii=*|--data-urlencode=*|--json=*|--form=*|--form-string=*|--upload-file=*|--request=*|--header=*|--user=*|-d?*|-F?*|-T?*|-X?*|-H?*|-u?*) ;;
                *) _lpr_curl_is_target_url "$word" && target=1 ;;
            esac
        done
        [ "$target" -eq 1 ] || continue

        rest="$arguments"
        while _lpr_shell_next_word "$rest"; do
            word="$_LPR_WORD"; rest="$_LPR_SHELL_REMAINDER"; option=""
            case "$word" in
                --data|--data-raw|--data-binary|--data-ascii|--data-urlencode|--json|-d|--form|-F|--form-string|--upload-file|-T)
                    option="$word"
                    _lpr_shell_next_word "$rest" || return 0
                    value="$_LPR_WORD"; rest="$_LPR_SHELL_REMAINDER"
                    ;;
                --data=*) option="--data"; value="${word#--data=}" ;;
                --data-raw=*) option="--data-raw"; value="${word#--data-raw=}" ;;
                --data-binary=*) option="--data-binary"; value="${word#--data-binary=}" ;;
                --data-ascii=*) option="--data-ascii"; value="${word#--data-ascii=}" ;;
                --data-urlencode=*) option="--data-urlencode"; value="${word#--data-urlencode=}" ;;
                --form=*) option="--form"; value="${word#--form=}" ;;
                --form-string=*) option="--form-string"; value="${word#--form-string=}" ;;
                --upload-file=*) option="--upload-file"; value="${word#--upload-file=}" ;;
                -d?*) option="-d"; value="${word#-d}" ;;
                -F?*) option="-F"; value="${word#-F}" ;;
                -T?*) option="-T"; value="${word#-T}" ;;
                *) continue ;;
            esac
            case "$option" in
                --form|-F)
                    form_rc=0
                    _lpr_curl_form_attachment "$value" || form_rc=$?
                    [ "$form_rc" -eq 2 ] && return 2
                    ;;
                --upload-file|-T)
                    form_rc=0
                    _lpr_curl_file_attachment "$value" || form_rc=$?
                    [ "$form_rc" -eq 2 ] && return 2
                    ;;
                *)
                    _lpr_curl_payload_value "$value" "$option" || return 0
                    curl_text=$(printf '%s' "$_LPR_VALUE" | tr '{}\",' '    ') || return 0
                    _lpr_check_text "$curl_text" || rc=$?
                    [ "$rc" -eq 2 ] && return 2
                    rc=0
                    ;;
            esac
        done
    done
    return 0
}

_lpr_git_commit_staged_text() {
    local base_repo_root="$repo_root" remaining="$cmd" segment rest word
    local git_cwd repo_for_commit staged_text rc=0 has_commit
    while [ -n "$remaining" ]; do
        _lpr_shell_next_segment "$remaining" || return 0
        segment="$_LPR_SEGMENT"; remaining="$_LPR_SHELL_REMAINDER"
        _lpr_shell_next_word "$segment" || continue
        while [ "$_LPR_WORD" != "git" ]; do
            case "$_LPR_WORD" in
                [A-Za-z_]*=*) ;;
                *) break ;;
            esac
            _lpr_shell_next_word "$_LPR_SHELL_REMAINDER" || break
        done
        [ "$_LPR_WORD" = "git" ] || continue
        rest="$_LPR_SHELL_REMAINDER"; git_cwd="$effective_cwd"; has_commit=0
        while _lpr_shell_next_word "$rest"; do
            word="$_LPR_WORD"; rest="$_LPR_SHELL_REMAINDER"
            case "$word" in
                -C)
                    _lpr_shell_next_word "$rest" || return 0
                    git_cwd="$_LPR_WORD"; rest="$_LPR_SHELL_REMAINDER"
                    _lpr_core_expand_path "$git_cwd" || return 0
                    git_cwd="$_LPR_EXPANDED"
                    case "$git_cwd" in /*) ;; *) git_cwd="$effective_cwd/$git_cwd" ;; esac
                    ;;
                -C?*)
                    git_cwd="${word#-C}"
                    _lpr_core_expand_path "$git_cwd" || return 0
                    git_cwd="$_LPR_EXPANDED"
                    case "$git_cwd" in /*) ;; *) git_cwd="$effective_cwd/$git_cwd" ;; esac
                    ;;
                commit) has_commit=1; break ;;
            esac
        done
        [ "$has_commit" -eq 1 ] || continue
        repo_for_commit=$(git -C "$git_cwd" rev-parse --show-toplevel 2>/dev/null) || {
            repo_root="$base_repo_root"
            return 0
        }

        [ -d "$repo_for_commit" ] || {
            repo_root="$base_repo_root"
            return 0
        }
        repo_root="$repo_for_commit"
        staged_text=$(_lpr_staged_added_text) || staged_text=""
        if [ -n "$staged_text" ]; then
            _lpr_check_staged_text "$staged_text" || rc=$?
            if [ "$rc" -eq 2 ]; then
                repo_root="$base_repo_root"
                return 2
            fi
            rc=0
        fi
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

_lpr_mcp_attachment_paths() {
    local candidates candidate expanded rc=0
    candidates=$(printf '%s' "$input" | jq -r '
        if (.tool_input? | type) != "object" then empty
        else .tool_input
        | paths(strings) as $path
        | ($path[-1]) as $key
        | select($key == "file" or $key == "file_path" or $key == "filePath" or $key == "attachment_path" or $key == "attachmentPath" or $key == "path")
        | getpath($path)
        end
    ' 2>/dev/null) || return 0
    [ -n "$candidates" ] || return 0
    while IFS= read -r candidate; do
        [ -n "$candidate" ] || continue
        _lpr_core_expand_path "$candidate" || return 0
        expanded="$_LPR_EXPANDED"
        case "$expanded" in
            /*) ;;
            *) expanded="$effective_cwd/$expanded" ;;
        esac
        [ -f "$expanded" ] && [ -r "$expanded" ] || continue
        _lpr_check_attachment "$expanded" "$candidate" || rc=$?
        [ "$rc" -eq 2 ] && return 2
        rc=0
    done <<EOF
$candidates
EOF
    return 0
}

case "$tool_name" in
    Bash|bash|exec_command|shell_command)
        _lpr_shell_route || rc=$?
        [ "${rc:-0}" -eq 2 ] && exit 0
        exit 0
        ;;
    mcp__notion__notion_convert_page_to_skill|mcp__notion__notion_create_attachment|mcp__notion__notion_create_comment|mcp__notion__notion_create_database|mcp__notion__notion_create_file_upload|mcp__notion__notion_create_folder|mcp__notion__notion_create_pages|mcp__notion__notion_create_view|mcp__notion__notion_duplicate_page|mcp__notion__notion_move_pages|mcp__notion__notion_update_data_source|mcp__notion__notion_update_page|mcp__notion__notion_update_view|mcp__slack__slack_add_reaction|mcp__slack__slack_create_canvas|mcp__slack__slack_create_conversation|mcp__slack__slack_schedule_message|mcp__slack__slack_send_message|mcp__slack__slack_send_message_draft|mcp__slack__slack_update_canvas|mcp__linear__create_attachment|mcp__linear__create_attachment_from_upload|mcp__linear__create_initiative_label|mcp__linear__create_issue_label|mcp__linear__delete_attachment|mcp__linear__delete_comment|mcp__linear__delete_diff_comment|mcp__linear__delete_status_update|mcp__linear__merge_diff|mcp__linear__prepare_attachment_upload|mcp__linear__resolve_diff_thread|mcp__linear__save_comment|mcp__linear__save_diff_comment|mcp__linear__save_document|mcp__linear__save_initiative|mcp__linear__save_issue|mcp__linear__save_milestone|mcp__linear__save_project|mcp__linear__save_release|mcp__linear__save_release_note|mcp__linear__save_status_update|mcp__linear__submit_diff_review)
        _lpr_prepare_repo || exit 0
        case "$tool_name" in
            mcp__notion__notion_create_attachment|mcp__notion__notion_create_file_upload|mcp__linear__create_attachment|mcp__linear__create_attachment_from_upload|mcp__linear__prepare_attachment_upload)
                _lpr_mcp_attachment_paths || rc=$?
                [ "${rc:-0}" -eq 2 ] && exit 0
                rc=0
                ;;
        esac
        inspectable=$(printf '%s' "$input" | jq -r 'if (.tool_input? | type) == "object" or (.tool_input? | type) == "array" then .tool_input | .. | strings else empty end' 2>/dev/null) || exit 0
        [ -n "$inspectable" ] || exit 0
        rc=0
        _lpr_check_text "$inspectable" || rc=$?
        [ "$rc" -eq 2 ] && exit 0
        exit 0
        ;;
    *) exit 0 ;;
esac

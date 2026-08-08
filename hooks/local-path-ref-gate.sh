#!/bin/bash
set -euo pipefail

# =============================================================================
# Local-path reference gate (Claude PreToolUse / Bash).
#
# This is the Claude envelope and shell-shape shim over
# hooks/local-path-ref-gate-core.sh.  It never executes the user's command and
# fails open on missing jq/core, malformed JSON, unknown shell shapes, or git
# inspection errors.
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
    local rest="$1" value
    rest="${rest#"${rest%%[![:space:]]*}"}"
    [ -n "$rest" ] || return 1
    local first_char="${rest%"${rest#?}"}"
    if [ "$first_char" = '"' ]; then
        case "$rest" in *\\\"*) return 1 ;; esac
        rest="${rest#\"}"
        [[ "$rest" == *\"* ]] || return 1
        value="${rest%%\"*}"
    elif [ "$first_char" = "'" ]; then
        rest="${rest#\'}"
        [[ "$rest" == *\'* ]] || return 1
        value="${rest%%\'*}"
    else
        value="${rest%%[[:space:]]*}"
    fi
    [ -n "$value" ] || return 1
    _LPR_VALUE="$value"
    return 0
}

_lpr_gh_body() {
    local segment="$1" marker rest value
    local body_re='(^|[[:space:]])--body(=|[[:space:]])'
    [[ "$segment" =~ $body_re ]] || return 1
    marker="${BASH_REMATCH[0]}"
    rest="${segment#*"$marker"}"
    _lpr_extract_value_after "$rest" || return 1
    _LPR_VALUE="$_LPR_VALUE"
    case "$_LPR_VALUE" in @*|-) return 1 ;; esac
    return 0
}

_lpr_inspect_gh() {
    local gh_re='(^|[;&|])[[:space:]]*gh[[:space:]]+pr[[:space:]]+(create|edit)([[:space:]]|$)' segment
    [[ "$cmd" =~ $gh_re ]] || return 0
    segment="${cmd#*"${BASH_REMATCH[0]}"}"
    _lpr_gh_body "$segment" || return 0
    _lpr_check_text "$_LPR_VALUE"
    return $?
}

_lpr_curl_payload() {
    local segment="$1" marker rest
    local data_re='(^|[[:space:]])(--data|--data-raw|--data-binary|--data-urlencode|-d)(=|[[:space:]])'
    [[ "$segment" =~ $data_re ]] || return 1
    marker="${BASH_REMATCH[0]}"
    rest="${segment#*"$marker"}"
    _lpr_extract_value_after "$rest" || return 1
    case "$_LPR_VALUE" in
        @*) _LPR_VALUE="${_LPR_VALUE#@}" ;;
        -) return 1 ;;
    esac
    return 0
}

_lpr_inspect_curl() {
    local curl_re='(^|[;&|])[[:space:]]*curl([[:space:]]|$)' target_re
    local segment curl_text
    [[ "$cmd" =~ $curl_re ]] || return 0
    segment="${cmd#*"${BASH_REMATCH[0]}"}"
    # Require a URL token (rather than merely seeing a host in JSON data) so
    # non-target curl calls remain outside this gate's scope.
    target_re='(^|[[:space:]'\''"])https://(api[.]notion[.]com|slack[.]com/api|api[.]linear[.]app|linear[.]app/api)'
    [[ "$segment" =~ $target_re ]] || return 0
    _lpr_curl_payload "$segment" || return 0
    # JSON payload punctuation can cling to a path token (e.g.
    # `"path":"docs/untracked.md"`); remove only structural delimiters so
    # the shared line scanner sees the explicit value, not shell syntax.
    curl_text=$(printf '%s' "$_LPR_VALUE" | tr '{}\",' '    ') || return 0
    _lpr_check_text "$curl_text"
    return $?
}

# A bounded git-commit shape is the only route that reads staged content.
_lpr_git_re='(^|[;&|])[[:space:]]*git([[:space:]]+[^;&|[:space:]]+)*[[:space:]]+commit([[:space:]]|$)'
if [[ "$cmd" =~ $_lpr_git_re ]]; then
    staged_text=$(_lpr_staged_added_text) || staged_text=""
    if [ -n "$staged_text" ]; then
        _lpr_check_text "$staged_text"
        [ "$?" -eq 2 ] && exit 2
    fi
fi

_lpr_inspect_gh
[ "$?" -eq 2 ] && exit 2
_lpr_inspect_curl
[ "$?" -eq 2 ] && exit 2
exit 0

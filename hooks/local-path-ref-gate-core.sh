#!/bin/bash
# =============================================================================
# Local-path reference judgment core
#
# This file is platform-neutral and is sourced by the Claude and Codex shims.
# It intentionally does not emit a deny envelope.  The shim calls:
#
#   local_path_ref_gate_core_check <repository-root> <inspectable-text>
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
# `machine-local-untracked`, and `absolute-tracked`.
#
# Bash 3.2/macOS compatible.  No shell-command parsing, staged-diff handling,
# network/MCP extraction, or platform-specific JSON belongs here.
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

_lpr_core_trim_candidate() {
    local value="$1"
    case "$value" in
        '<*>'|"'*'"|'"*"') value="${value#?}"; value="${value%?}" ;;
    esac
    # Link fragments identify an anchor, not a second local file.
    value="${value%%#*}"
    # Bare prose commonly puts sentence punctuation after a path.
    while :; do
        case "$value" in
            *[.,:]) value="${value%?}" ;;
            *';') value="${value%?}" ;;
            *) break ;;
        esac
    done
    _LPR_CANDIDATE="$value"
}

_lpr_core_placeholder_or_external() {
    local value="$1"
    case "$value" in
        https://*|http://*|mailto:*|'#'*) return 0 ;;
        *'{'*'}'*|*'*'*|*'?'*|*'['*']'*) return 0 ;;
        # An unresolved variable is a template/reference, not an inspectable
        # concrete local path.  Known variables are expanded before this test.
        *\$*|*'${'*'}'*) return 0 ;;
    esac
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
    local key="${line_no}\t${kind}\t${display_path}"
    if _lpr_core_seen "$key"; then
        return 0
    fi
    _LPR_SEEN="${_LPR_SEEN}${key}"$'\n'
    printf 'location=line:%s\tline=%s\ttype=%s\tpath=%s\tremediation=%s\tinstruction=deleting the citation alone is forbidden\n' \
        "$line_no" "$line_no" "$kind" "$display_path" "$remediation"
    _LPR_COUNT=$((_LPR_COUNT + 1))
}

_lpr_core_is_tracked_absolute() {
    local candidate="$1" relative status
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
    local raw="$1" line_no="$2" candidate repo_target
    _lpr_core_trim_candidate "$raw"
    candidate="$_LPR_CANDIDATE"
    [[ -n "$candidate" ]] || return 0

    _lpr_core_expand_path "$candidate"
    candidate="$_LPR_EXPANDED"
    # An unresolved $HOME/$OMT_DIR is a template; setup errors fail open.
    _lpr_core_placeholder_or_external "$candidate" && return 0
    # `~` cannot be expanded safely without HOME (and ~user lookup is outside
    # this core's scope), so treat an unresolved tilde as a setup/template case.
    case "$candidate" in
        '~'|'~/'*) [[ -n "${HOME-}" ]] || return 0 ;;
    esac

    case "$candidate" in
        /*)
            [[ -e "$candidate" ]] || return 0
            if _lpr_core_is_tracked_absolute "$candidate"; then
                repo_target="${candidate#"$_LPR_REPO_ROOT/"}"
                _lpr_core_emit "$line_no" "absolute-tracked" "$repo_target" \
                    "use the repository-relative path"
            else
                [[ "$?" -eq 2 ]] && return 0
                _lpr_core_emit "$line_no" "machine-local-untracked" "$raw" \
                    "inline a summary or copy the file into the repository"
            fi
            ;;
        *)
            if [[ -e "$_LPR_REPO_ROOT/$candidate" ]]; then
                # A repository-relative tracked citation is the normal safe
                # form.  An existing but untracked relative target is still a
                # machine-local file and needs the same inline/copy remedy.
                if _lpr_core_is_tracked_absolute "$_LPR_REPO_ROOT/$candidate"; then
                    return 0
                else
                    [[ "$?" -eq 2 ]] && return 0
                    _lpr_core_emit "$line_no" "machine-local-untracked" "$raw" \
                        "inline a summary or copy the file into the repository"
                    return 0
                fi
            fi
            _lpr_core_emit "$line_no" "repo-relative-missing" "$raw" \
                "add the target or inline its content"
            ;;
    esac
}

_lpr_core_scan_line() {
    local line="$1" line_no="$2" rest target token
    local _lpr_md_re='\]\(([^)]*)\)'
    # Markdown destinations are authoritative and also allow paths containing
    # spaces (which bare-token scanning intentionally does not attempt).
    rest="$line"
    while [[ "$rest" =~ $_lpr_md_re ]]; do
        target="${BASH_REMATCH[1]}"
        _lpr_core_consider "$target" "$line_no"
        rest="${rest#*"${BASH_REMATCH[0]}"}"
    done

    # Also inspect obvious bare local paths.  This is a reference classifier,
    # not a shell parser: quoted/escaped command syntax is left to shims.
    local -a words
    read -r -a words <<< "$line"
    for token in "${words[@]}"; do
        case "$token" in
            *']('*|*'('*) continue ;;
            /*|~|~/*|\$HOME|\$HOME/*|\${HOME}|\${HOME}/*|\$OMT_DIR|\$OMT_DIR/*|\${OMT_DIR}|\${OMT_DIR}/*|./*|../*)
                _lpr_core_consider "$token" "$line_no" ;;
            *.md|*.markdown|*.yaml|*.yml|*.json|*.toml|*.txt|*.sh|*.ts|*.tsx|*.js|*.jsx)
                _lpr_core_consider "$token" "$line_no" ;;
        esac
    done
}

# local_path_ref_gate_core_check <repository-root> <inspectable-text>
local_path_ref_gate_core_check() {
    local repo_root="${1-}" inspectable_text="${2-}" line line_no=0
    [[ -n "$repo_root" && -d "$repo_root" ]] || return 1
    # A repository/index lookup is part of classification.  Any setup failure
    # (not a repository, unavailable git, malformed root) is explicitly allow.
    if ! git -C "$repo_root" rev-parse --show-toplevel >/dev/null 2>&1; then
        return 1
    fi
    while [[ "$repo_root" != "/" && "$repo_root" == */ ]]; do
        repo_root="${repo_root%/}"
    done
    _LPR_REPO_ROOT="$repo_root"
    _LPR_SEEN=""
    _LPR_COUNT=0

    while IFS= read -r line || [[ -n "$line" ]]; do
        line_no=$((line_no + 1))
        _lpr_core_scan_line "$line" "$line_no"
    done <<EOF
$inspectable_text
EOF

    [[ "$_LPR_COUNT" -gt 0 ]]
}

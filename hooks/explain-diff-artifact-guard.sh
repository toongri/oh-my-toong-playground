#!/bin/bash
# Claude PreToolUse adapter for the explain-diff artifact write gate.
# Owns only Claude's payload shape; the verdict, the artifact-path test and the
# deny JSON all live in hooks/lib/explain-diff-guard-core.sh so the Codex twin
# enforces the identical invariant.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=hooks/lib/explain-diff-guard-core.sh
source "$SCRIPT_DIR/lib/explain-diff-guard-core.sh"
# Reused rather than re-implemented: this is the repo's one hook-side session-id
# resolver (it rejects a payload whose id disagrees with the environment), and a
# second copy would be free to drift from it.
# shellcheck source=hooks/lib/qa-driver-patterns.sh
source "$SCRIPT_DIR/lib/qa-driver-patterns.sh"

input=$(/bin/cat)

omt_dir="${OMT_DIR:-}"

# jq-absent branch. Unlike every other guard in this repo, absence of jq is not
# a reason to step aside here — it is exactly the state in which the verdict
# cannot be established, so the guarded path closes. Scoped by the crude
# byte-level marker test so only writes that mention the artifact directory are
# affected; everything else still passes untouched.
if ! command -v jq >/dev/null 2>&1; then
    if printf '%s' "$input" | explain_diff_guard_core_raw_mentions_artifact; then
        explain_diff_guard_core_deny_nojq
    fi
    exit 0
fi

tool_name=$(printf '%s' "$input" | jq -er '.tool_name // .toolName // empty' 2>/dev/null) || exit 0
case "$tool_name" in
    Write | Edit | MultiEdit | NotebookEdit) ;;
    *) exit 0 ;;
esac

target=$(printf '%s' "$input" | jq -er '.tool_input.file_path // .tool_input.notebook_path // empty' 2>/dev/null) || exit 0
[ -n "$target" ] || exit 0

if [ -z "$omt_dir" ]; then
    cwd=$(printf '%s' "$input" | jq -er '.cwd // empty' 2>/dev/null) || cwd=""
    if [ -n "$cwd" ]; then
        omt_dir=$(source "$SCRIPT_DIR/lib/omt-dir.sh" && unset OMT_DIR && resolve_omt_dir "$cwd") || omt_dir=""
    fi
fi
# Without OMT_DIR the guarded root is unknown, so the precise test cannot run.
# Fall back to the same marker test the jq-absent branch uses rather than
# allowing: an unresolvable root is another way of failing to establish the
# verdict, and this gate treats those alike.
if [ -z "$omt_dir" ]; then
    if printf '%s' "$target" | explain_diff_guard_core_raw_mentions_artifact; then
        explain_diff_guard_core_deny "Blocked: explain-diff 산출물 경로 쓰기가 거부됐습니다. OMT_DIR 를 해석하지 못해 스텝 완료 상태를 확인할 수 없습니다."
    fi
    exit 0
fi

explain_diff_guard_core_is_artifact "$omt_dir" "$target" || exit 0

payload_sid=$(printf '%s' "$input" | jq -er '.session_id // empty' 2>/dev/null) || payload_sid=""
if ! session_id=$(qa_driver_session_id "$payload_sid"); then
    explain_diff_guard_core_deny "Blocked: explain-diff 산출물 경로 쓰기가 거부됐습니다. 세션 식별자를 확정하지 못해 스텝 완료 상태를 확인할 수 없습니다."
    exit 0
fi

reason=$(explain_diff_guard_core_verdict "$omt_dir" "$session_id")
[ -n "$reason" ] || exit 0
explain_diff_guard_core_deny "$reason"
exit 0

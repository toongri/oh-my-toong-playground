#!/bin/bash
# Codex PreToolUse adapter for the explain-diff artifact write gate.
# Twin of hooks/explain-diff-artifact-guard.sh: same invariant, same deny text,
# different payload shape. Codex names its write tools differently and carries
# the target under either .file_path or .path, so only that extraction differs —
# everything downstream is the shared core.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=hooks/lib/explain-diff-guard-core.sh
source "$SCRIPT_DIR/lib/explain-diff-guard-core.sh"
# shellcheck source=hooks/lib/qa-driver-patterns.sh
source "$SCRIPT_DIR/lib/qa-driver-patterns.sh"

input=$(/bin/cat)

omt_dir="${OMT_DIR:-}"

if ! command -v jq >/dev/null 2>&1; then
    if printf '%s' "$input" | explain_diff_guard_core_raw_mentions_artifact; then
        explain_diff_guard_core_deny_nojq
    fi
    exit 0
fi

tool_name_raw=$(printf '%s' "$input" | jq -er '.tool_name // .toolName // empty' 2>/dev/null) || exit 0
tool_name=$(printf '%s' "$tool_name_raw" | tr '[:upper:]' '[:lower:]')
case "$tool_name" in
    apply_patch | write_file | edit_file | create_file) ;;
    *) exit 0 ;;
esac

target=$(printf '%s' "$input" | jq -er '.tool_input.file_path // .tool_input.path // empty' 2>/dev/null) || exit 0
[ -n "$target" ] || exit 0

if [ -z "$omt_dir" ]; then
    cwd=$(printf '%s' "$input" | jq -er '.cwd // empty' 2>/dev/null) || cwd=""
    if [ -n "$cwd" ]; then
        omt_dir=$(source "$SCRIPT_DIR/lib/omt-dir.sh" && unset OMT_DIR && resolve_omt_dir "$cwd") || omt_dir=""
    fi
fi
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

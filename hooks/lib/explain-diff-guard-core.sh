#!/bin/bash
# =============================================================================
# explain-diff Artifact Gate Core
#
# The shared verdict logic behind hooks/explain-diff-artifact-guard.sh (Claude)
# and hooks/codex-explain-diff-artifact-guard.sh (Codex). The per-platform
# shims own ONLY payload extraction — which key holds the target path on that
# platform — and call into here for the artifact-path test, the verdict, and
# the deny JSON, so both platforms enforce one invariant and emit byte-identical
# deny text.
#
# This gate is INVERTED relative to every other OMT PreToolUse guard. The others
# fail open: an unreadable payload or a missing state file means "allow". Here
# the guarded path fails CLOSED — an unreadable verdict is treated exactly like
# a failed one. The reason is what the gate protects: a finished explanation
# document that the reader has not yet earned. "The guard could not read its
# state" and "the guard was removed" look identical from inside the process, so
# the artifact path stays shut in both cases.
#
# The inversion is scoped to one directory. Every path that is not under
# "$OMT_DIR/explain-diff/" returns allow without consulting state at all, which
# is what keeps a fail-closed default from becoming a session-wide block.
# Compatible with macOS Bash 3.2.
# =============================================================================

_ed_core_lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=hooks/write-guard-core.sh
. "$_ed_core_lib_dir/../write-guard-core.sh"
# shellcheck source=hooks/lib/state-liveness.sh
. "$_ed_core_lib_dir/state-liveness.sh"

# The guarded directory's name, WITH its trailing slash. The slash is the whole
# point: matching the bare prefix "explain-diff" would also swallow the sibling
# "explain-diff-eval/" tree, which is where the RED baselines are written — the
# eval would then be blocked by the very gate it exists to measure.
_ed_core_dir_marker='/explain-diff/'

# Deny emitted when jq is absent. Pre-built as a literal because the dynamic
# builder below needs jq to escape the reason, and this is precisely the branch
# where jq is gone. Both platform shims print this same constant, which is what
# keeps their jq-absent deny byte-identical.
_ed_core_nojq_deny_json='{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Blocked: explain-diff 산출물 경로 쓰기가 거부됐습니다. jq 가 없어 스텝 완료 상태를 읽을 수 없고, 이 경로는 상태를 확인하지 못하면 열리지 않습니다. jq 를 설치한 뒤 다시 시도하세요."}}'

# explain_diff_guard_core_is_artifact <omt_dir> <path>
# Exit 0 when <path> lands inside "$omt_dir/explain-diff/" — directory-boundary
# match on the normalized path, so "..", "//" and "./" cannot walk in or out of
# the guarded tree, and the "explain-diff-eval" sibling stays outside it.
explain_diff_guard_core_is_artifact() {
    local omt_dir="$1" path="$2"
    [ -n "$omt_dir" ] || return 1
    [ -n "$path" ] || return 1
    local root norm
    root="$(_wg_core_normpath "$omt_dir/explain-diff")"
    norm="$(_wg_core_normpath "$path")"
    case "$norm" in
        "$root"/*) return 0 ;;
        *) return 1 ;;
    esac
}

# explain_diff_guard_core_raw_mentions_artifact
# The jq-less fallback. Reads the raw payload on stdin and asks only whether the
# guarded directory segment appears anywhere in it. Deliberately cruder than the
# function above — without jq there is no way to know which key held the path,
# so the recognition altitude drops to the byte level. It stays sound for a
# deny-direction check: the trailing slash keeps "explain-diff-eval/" out, and a
# false positive costs one blocked write, never a silently opened gate.
explain_diff_guard_core_raw_mentions_artifact() {
    grep -q "$_ed_core_dir_marker"
}

# explain_diff_guard_core_deny <reason>
# The single construction site for this gate's deny JSON. Both shims call it, so
# their output cannot drift apart.
explain_diff_guard_core_deny() {
    jq -nc --arg reason "$1" '
        {
            hookSpecificOutput: {
                hookEventName: "PreToolUse",
                permissionDecision: "deny",
                permissionDecisionReason: $reason
            }
        }'
}

explain_diff_guard_core_deny_nojq() {
    printf '%s\n' "$_ed_core_nojq_deny_json"
}

# explain_diff_guard_core_verdict <omt_dir> <session_id>
# Prints a deny reason, or nothing at all when the write is allowed. Every path
# that cannot establish "the current step is complete" prints a reason — absent
# state, expired state, inactive state, and an incomplete step are four ways of
# saying the same thing to a caller, and all four keep the artifact shut.
#
# The step-incomplete branch echoes `derived.block_reason` verbatim rather than
# composing its own sentence. That field is written by the state CLI, which is
# the only component that knows which structural check failed and which step to
# return to; re-deriving either here would put a second, drifting copy of the
# step model inside a shell hook.
explain_diff_guard_core_verdict() {
    local omt_dir="$1" session_id="$2"
    local state_file="$omt_dir/explain-diff-state-${session_id}.json"

    if [ ! -f "$state_file" ]; then
        printf '%s' "Blocked: explain-diff 산출물 경로 쓰기가 거부됐습니다. 이 세션에 explain-diff 상태가 없습니다. 스킬을 호출해 evidence 스텝부터 시작하세요. explain-diff-state.ts start --range \"<git range>\" --slug \"<slug>\" 를 실행하세요."
        return 0
    fi

    local now
    now=$(date +%s)
    if ! is_state_live "$state_file" "$now"; then
        printf '%s' "Blocked: explain-diff 산출물 경로 쓰기가 거부됐습니다. 상태가 만료됐습니다(idle TTL 초과). 스킬을 다시 호출해 스텝을 이어가세요."
        return 0
    fi

    local active
    active=$(jq -r 'if .active == true then "true" else "false" end' "$state_file" 2>/dev/null) || active="false"
    if [ "$active" != "true" ]; then
        printf '%s' "Blocked: explain-diff 산출물 경로 쓰기가 거부됐습니다. 상태가 비활성입니다. 스킬을 다시 호출하세요."
        return 0
    fi

    local allowed
    allowed=$(jq -r 'if .derived.artifact_write_allowed == true then "true" else "false" end' "$state_file" 2>/dev/null) || allowed="false"
    if [ "$allowed" != "true" ]; then
        local block_reason
        block_reason=$(jq -r '.derived.block_reason // empty' "$state_file" 2>/dev/null) || block_reason=""
        if [ -n "$block_reason" ]; then
            printf 'Blocked: %s' "$block_reason"
        else
            printf '%s' "Blocked: explain-diff 현재 스텝이 아직 통과되지 않았습니다. 상태 CLI 로 스텝을 통과시킨 뒤 다시 쓰세요."
        fi
        return 0
    fi

    return 0
}

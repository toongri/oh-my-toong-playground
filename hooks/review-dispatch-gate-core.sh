#!/bin/bash
# omt-hook-dep: lib/omt-dir.sh
# Shared ultragoal review-dispatch gate. Platform shims select their own
# dispatch payloads, then pass the complete JSON input here.

_rdg_deny() {
    local reason="$1"
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$reason"
}

_rdg_state_cli() {
    local core_dir candidate
    core_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    for candidate in \
        "$core_dir/../skills/ultragoal/scripts/ultragoal-state.ts" \
        "$core_dir/../../.agents/skills/ultragoal/scripts/ultragoal-state.ts"; do
        if [ -f "$candidate" ]; then
            printf '%s\n' "$candidate"
            return 0
        fi
    done
    return 1
}

# review_dispatch_gate_core_run <raw-hook-json>
# Emits exactly one PreToolUse deny envelope when a pursuing ultragoal review
# dispatch cannot be reserved. Non-pursuing/no-state callers emit nothing.
review_dispatch_gate_core_run() {
    local input="$1" sid omt_dir cwd cli state_out claim_out claim_rc reason core_dir

    # jq is a runtime prerequisite for the shipped hooks. Match this project's
    # existing jq-absent posture: do not abort the surrounding PreToolUse hook.
    command -v jq > /dev/null 2>&1 || return 0

    sid="${OMT_SESSION_ID:-}"
    if [ -z "$sid" ]; then
        sid=$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null) || return 0
    fi
    case "$sid" in
        ""|*[!A-Za-z0-9_-]*) return 0 ;;
    esac

    # Match the existing hook fallback exactly: when SessionStart has not yet
    # exported OMT_DIR, derive it from the payload's cwd rather than the hook
    # process cwd. This is required to distinguish an absent state (allow) from
    # a current-session state file that is present but malformed (deny).
    omt_dir="${OMT_DIR:-}"
    if [ -z "$omt_dir" ]; then
        cwd=$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null) || cwd=""
        if [ -n "$cwd" ]; then
            core_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
            if [ -f "$core_dir/lib/omt-dir.sh" ]; then
                omt_dir=$(source "$core_dir/lib/omt-dir.sh" && unset OMT_DIR && resolve_omt_dir "$cwd") || omt_dir=""
            fi
        fi
    fi

    cli=$(_rdg_state_cli) || {
        _rdg_deny '코드 리뷰 dispatch 상태 CLI를 찾지 못했습니다. 안전하게 중단하고 상태를 확인하세요.'
        return 0
    }

    state_out=$(OMT_DIR="$omt_dir" OMT_SESSION_ID="$sid" bun "$cli" get 2>/dev/null) || {
        _rdg_deny '코드 리뷰 dispatch 상태를 확인하지 못했습니다. 안전하게 중단하고 상태를 확인하세요.'
        return 0
    }
    # No current ultragoal state, inactive state, and phases other than
    # pursuing are intentionally no-ops: they must not consume review budget.
    # A present-but-malformed state is different from no state and fails closed.
    if ! printf '%s' "$state_out" | jq -e '. != null and .active == true and .phase == "pursuing"' > /dev/null 2>&1; then
        if [ -n "$omt_dir" ] && [ -f "${omt_dir}/ultragoal-state-${sid}.json" ] && ! jq -e 'type == "object" and (.active == false or .phase == "planning" or .phase == "budget_limited" or .phase == "blocked" or .phase == "complete")' "${omt_dir}/ultragoal-state-${sid}.json" > /dev/null 2>&1; then
            _rdg_deny '코드 리뷰 dispatch 상태가 손상되었습니다. 안전하게 중단하고 상태를 확인하세요.'
        fi
        return 0
    fi

    claim_rc=0
    claim_out=$(OMT_DIR="$omt_dir" OMT_SESSION_ID="$sid" bun "$cli" claim-review-dispatch 2>/dev/null) || claim_rc=$?
    # The CLI intentionally exits nonzero for denial; parse its JSON regardless
    # of exit status. An absent/malformed result is a fail-closed state failure.
    if ! printf '%s' "$claim_out" | jq -e 'type == "object" and has("allowed") and has("reason")' > /dev/null 2>&1; then
        _rdg_deny '코드 리뷰 dispatch 예약 상태가 올바르지 않습니다. 안전하게 중단하고 상태를 확인하세요.'
        return 0
    fi
    if [ "$(printf '%s' "$claim_out" | jq -r '.allowed' 2>/dev/null)" = "true" ] && [ "$claim_rc" -eq 0 ]; then
        return 0
    fi

    reason=$(printf '%s' "$claim_out" | jq -r '.reason // "failure"' 2>/dev/null) || reason="failure"
    case "$reason" in
        budget_exhausted)
            _rdg_deny '코드 리뷰 예산이 소진되었습니다. 사용자에게 마무리할지 계속할지 물으세요. 계속하기로 하면 approve-review-dispatch-renewal 명령어를 제시하고 사용자가 직접 실행하도록 요청하세요 (AI 실행은 차단됩니다).'
            ;;
        completion_eligible)
            _rdg_deny '현재 코드 리뷰는 완료 가능 상태입니다. request-complete를 실행하거나, 계속하려면 approve-review-dispatch-renewal 명령어를 제시하고 사용자가 직접 실행하도록 요청하세요 (AI 실행은 차단됩니다).'
            ;;
        *)
            _rdg_deny '코드 리뷰 dispatch 예약에 실패했습니다. 안전하게 중단하고 상태를 확인하세요.'
            ;;
    esac
}

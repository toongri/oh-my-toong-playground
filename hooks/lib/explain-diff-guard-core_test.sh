#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/explain-diff-guard-core.sh"

SBX="$(mktemp -d)"
trap 'rm -rf "$SBX"' EXIT
OMT_DIR="$SBX/omt"
SID="core-test"
STATE_FILE="$OMT_DIR/explain-diff-state-${SID}.json"
mkdir -p "$OMT_DIR/explain-diff" "$OMT_DIR/explain-diff-eval"

assert_contains() {
    local haystack="$1" needle="$2" label="$3"
    case "$haystack" in
        *"$needle"*) ;;
        *) echo "ASSERTION FAILED $label: missing '$needle' in '$haystack'"; return 1 ;;
    esac
}

assert_not_contains() {
    local haystack="$1" needle="$2" label="$3"
    case "$haystack" in
        *"$needle"*) echo "ASSERTION FAILED $label: unexpected '$needle' in '$haystack'"; return 1 ;;
        *) ;;
    esac
}

state_timestamp() {
    local age="$1" now
    now=$(date +%s)
    date -r "$((now - age))" -Iseconds 2>/dev/null \
        || date -d "@$((now - age))" -Iseconds 2>/dev/null \
        || date -Iseconds
}

write_state() {
    local active="$1" allowed="$2" reason="$3" age="${4:-0}" touched
    touched=$(state_timestamp "$age")
    jq -n --argjson active "$active" --argjson allowed "$allowed" \
        --arg reason "$reason" --arg touched "$touched" \
        '{active:$active,derived:{artifact_write_allowed:$allowed,block_reason:$reason},
          started_at:$touched,last_touched_at:$touched}' > "$STATE_FILE"
}

test_absent_includes_start_command() {
    rm -f "$STATE_FILE"
    local reason
    reason=$(explain_diff_guard_core_verdict "$OMT_DIR" "$SID")
    assert_contains "$reason" 'explain-diff-state.ts start --range "<git range>" --slug "<slug>"' absent-command
    assert_contains "$reason" '이 세션에 explain-diff 상태가 없습니다.' absent-korean-context
}

test_other_denials_are_distinct_and_without_start_command() {
    local expired inactive incomplete
    write_state true true "" 25200
    expired=$(explain_diff_guard_core_verdict "$OMT_DIR" "$SID")
    write_state false true ""
    inactive=$(explain_diff_guard_core_verdict "$OMT_DIR" "$SID")
    write_state true false "evidence 스텝 미완"
    incomplete=$(explain_diff_guard_core_verdict "$OMT_DIR" "$SID")

    [ "$expired" != "$inactive" ] && [ "$inactive" != "$incomplete" ] \
        && [ "$expired" != "$incomplete" ] || { echo "ASSERTION FAILED verdicts not distinct"; return 1; }
    assert_not_contains "$expired" 'explain-diff-state.ts start --range "<git range>" --slug "<slug>"' expired-command
    assert_not_contains "$inactive" 'explain-diff-state.ts start --range "<git range>" --slug "<slug>"' inactive-command
    assert_not_contains "$incomplete" 'explain-diff-state.ts start --range "<git range>" --slug "<slug>"' incomplete-command
}

test_allowed_reason_is_empty() {
    write_state true true ""
    local reason
    reason=$(explain_diff_guard_core_verdict "$OMT_DIR" "$SID")
    [ -z "$reason" ] || { echo "ASSERTION FAILED allowed reason='$reason'"; return 1; }
}

test_deny_json_wraps_reason() {
    local reason json
    reason="Blocked: 테스트 사유"
    json=$(explain_diff_guard_core_deny "$reason")
    printf '%s' "$json" | jq -e --arg reason "$reason" \
        '.hookSpecificOutput.permissionDecision == "deny" and
         .hookSpecificOutput.permissionDecisionReason == $reason' >/dev/null
}

test_path_boundary_excludes_eval() {
    explain_diff_guard_core_is_artifact "$OMT_DIR" "$OMT_DIR/explain-diff-eval/result.md" \
        && { echo "ASSERTION FAILED eval sibling was guarded"; return 1; } || true
}

test_absent_includes_start_command
test_other_denials_are_distinct_and_without_start_command
test_allowed_reason_is_empty
test_deny_json_wraps_reason
test_path_boundary_excludes_eval
echo "Tests: 5 passed, 0 failed"

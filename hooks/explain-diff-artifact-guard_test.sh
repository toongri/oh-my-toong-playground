#!/bin/bash
# Production-shaped probes for the explain-diff artifact write gate.
#
# This gate is INVERTED relative to every other OMT PreToolUse guard: those
# fail OPEN (unreadable payload/state -> allow), this one fails CLOSED for the
# artifact path alone. A reader who has not passed the quiz must not be able to
# reach a finished document, and "the guard could not read its own state" is
# indistinguishable from "the guard was removed" -- so the artifact path stays
# shut whenever the verdict cannot be established. Every OTHER path stays
# fail-open, which is what keeps the inverted default from turning into a
# session-wide block.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_HOOK="$SCRIPT_DIR/explain-diff-artifact-guard.sh"
CODEX_HOOK="$SCRIPT_DIR/codex-explain-diff-artifact-guard.sh"
TESTS_PASSED=0
TESTS_FAILED=0

run_test() {
    local name="$1"
    if "$name"; then
        echo "[PASS] $name"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    else
        echo "[FAIL] $name"
        TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
}

new_sandbox() {
    SBX=$(mktemp -d)
    mkdir -p "$SBX/omt/explain-diff"
    SID="explain-diff-probe"
    ARTIFACT="$SBX/omt/explain-diff/2026-08-06-sample.md"
    # A sibling directory whose name SHARES the "explain-diff" prefix. The RED
    # baseline tree lives here in production, so a prefix match instead of a
    # directory-boundary match would make the eval collide with its own gate.
    mkdir -p "$SBX/omt/explain-diff-eval/red"
    EVAL_ARTIFACT="$SBX/omt/explain-diff-eval/red/baseline.md"
    OUTSIDE="$SBX/omt/notes.md"
}

cleanup_sandbox() { rm -rf "$SBX"; }

# write_state <active> <artifact_write_allowed> <block_reason> [<age_seconds>]
write_state() {
    local active="$1" allowed="$2" reason="$3" age="${4:-0}"
    local now touched
    now=$(date +%s)
    # LOCAL time with offset (`date -Iseconds`), matching what every state writer
    # in this repo emits. hooks/lib/state-liveness.sh strips the offset and then
    # parses the remainder as local time, so a UTC-stamped fixture on a UTC+9
    # host reads as 9 hours old and every state looks expired.
    touched=$(date -r "$((now - age))" -Iseconds 2>/dev/null) \
        || touched=$(date -d "@$((now - age))" -Iseconds 2>/dev/null) \
        || touched=$(date -Iseconds)
    jq -n \
        --argjson active "$active" \
        --argjson allowed "$allowed" \
        --arg reason "$reason" \
        --arg touched "$touched" \
        '{active:$active,
          step:"background",
          derived:{artifact_write_allowed:$allowed,block_reason:$reason},
          started_at:$touched,
          last_touched_at:$touched}' \
        > "$SBX/omt/explain-diff-state-${SID}.json"
}

# write_render_state <step> <passed-json> <legacy>
# Keep the legacy fixture shaped like a pre-contract state: the raw state says
# render is complete and the derived boolean is open, but the proof contract is
# absent. The current fixture carries the exact four-path contract written by
# the state CLI after a successful render step.
write_render_state() {
    local step="$1" passed_json="$2" legacy="$3"
    local now touched
    now=$(date +%s)
    touched=$(date -r "$now" -Iseconds 2>/dev/null) \
        || touched=$(date -d "@$now" -Iseconds 2>/dev/null) \
        || touched=$(date -Iseconds)
    if [ "$legacy" = true ]; then
        jq -n \
            --arg step "$step" \
            --argjson passed "$passed_json" \
            --arg touched "$touched" \
            '{active:true,step:$step,passed:$passed,
              derived:{artifact_write_allowed:true,block_reason:""},
              started_at:$touched,last_touched_at:$touched}' \
            > "$SBX/omt/explain-diff-state-${SID}.json"
    else
        jq -n \
            --arg step "$step" \
            --argjson passed "$passed_json" \
            --arg touched "$touched" \
            '{active:true,step:$step,passed:$passed,
              render_proof_contract_version:1,
              render_proof:{doc_path:"/tmp/doc.md",html_path:"/tmp/doc.html",
                writing_report_path:"/tmp/writing-report.md",checklist_path:"/tmp/checklist.md"},
              derived:{artifact_write_allowed:true,block_reason:""},
              started_at:$touched,last_touched_at:$touched}' \
            > "$SBX/omt/explain-diff-state-${SID}.json"
    fi
}

claude_payload() {
    local path="$1"
    jq -n --arg path "$path" --arg sid "$SID" \
        '{tool_name:"Write",tool_input:{file_path:$path,content:"x"},session_id:$sid,cwd:"/safe/project"}'
}

codex_payload() {
    local path="$1"
    jq -n --arg path "$path" --arg sid "$SID" \
        '{tool_name:"apply_patch",tool_input:{file_path:$path,content:"x"},session_id:$sid,cwd:"/safe/project"}'
}

run_claude() {
    claude_payload "$1" | env -u CODEX_THREAD_ID OMT_DIR="$SBX/omt" OMT_SESSION_ID="$SID" bash "$CLAUDE_HOOK"
}

run_codex() {
    codex_payload "$1" | env -u CODEX_THREAD_ID OMT_DIR="$SBX/omt" OMT_SESSION_ID="$SID" bash "$CODEX_HOOK"
}

assert_denied() {
    local out="$1" label="$2"
    printf '%s' "$out" \
        | jq -e '.hookSpecificOutput.permissionDecision == "deny"' >/dev/null 2>&1 \
        || { echo "ASSERTION FAILED $label: expected deny, got '$out'"; return 1; }
}

assert_deny_reason_contains() {
    local out="$1" needle="$2" label="$3"
    printf '%s' "$out" \
        | jq -e --arg n "$needle" '.hookSpecificOutput.permissionDecisionReason | contains($n)' >/dev/null 2>&1 \
        || { echo "ASSERTION FAILED $label: deny reason lacks '$needle', got '$out'"; return 1; }
}

assert_allowed() {
    local out="$1" rc="$2" label="$3"
    if [ "$rc" -ne 0 ] || [ -n "$out" ]; then
        echo "ASSERTION FAILED $label: expected silent allow, rc=$rc output='$out'"
        return 1
    fi
}

# --- the seven blocking invariants, on both platforms -----------------------

test_state_absent_denies_artifact_path() {
    new_sandbox
    local out result=0
    rm -f "$SBX/omt/explain-diff-state-${SID}.json"
    out=$(run_claude "$ARTIFACT") || true
    assert_denied "$out" claude-state-absent || result=1
    out=$(run_codex "$ARTIFACT") || true
    assert_denied "$out" codex-state-absent || result=1
    cleanup_sandbox
    return "$result"
}

test_step_incomplete_denies_and_names_return_step() {
    new_sandbox
    local out result=0
    write_state true false "evidence 스텝 미완: signal/noise 분류표 없음. evidence 스텝으로 돌아가라."
    out=$(run_claude "$ARTIFACT") || true
    assert_denied "$out" claude-incomplete || result=1
    assert_deny_reason_contains "$out" "evidence" claude-return-step || result=1
    assert_deny_reason_contains "$out" "signal/noise 분류표 없음" claude-failed-item || result=1
    out=$(run_codex "$ARTIFACT") || true
    assert_denied "$out" codex-incomplete || result=1
    assert_deny_reason_contains "$out" "evidence" codex-return-step || result=1
    cleanup_sandbox
    return "$result"
}

test_stale_state_denies() {
    new_sandbox
    local out result=0
    # 7h idle > ACTIVE_IDLE_TTL (6h, hooks/lib/state-liveness.sh)
    write_state true true "" 25200
    out=$(run_claude "$ARTIFACT") || true
    assert_denied "$out" claude-stale || result=1
    out=$(run_codex "$ARTIFACT") || true
    assert_denied "$out" codex-stale || result=1
    cleanup_sandbox
    return "$result"
}

test_inactive_state_denies() {
    new_sandbox
    local out result=0
    write_state false true ""
    out=$(run_claude "$ARTIFACT") || true
    assert_denied "$out" claude-inactive || result=1
    out=$(run_codex "$ARTIFACT") || true
    assert_denied "$out" codex-inactive || result=1
    cleanup_sandbox
    return "$result"
}

test_jq_absent_denies_artifact_path_only() {
    new_sandbox
    write_state true true ""
    local no_bin="$SBX/no-bin" out rc=0 result=0
    mkdir -p "$no_bin"
    ln -s /bin/cat "$no_bin/cat"
    ln -s /usr/bin/dirname "$no_bin/dirname"
    ln -s /usr/bin/grep "$no_bin/grep" 2>/dev/null || ln -s /bin/grep "$no_bin/grep"

    # Artifact path -> the verdict is unknowable without jq, so it stays shut.
    out=$(claude_payload "$ARTIFACT" | env -u CODEX_THREAD_ID OMT_DIR="$SBX/omt" \
        OMT_SESSION_ID="$SID" PATH="$no_bin" /bin/bash "$CLAUDE_HOOK") || true
    assert_denied "$out" claude-jq-absent-artifact || result=1
    out=$(codex_payload "$ARTIFACT" | env -u CODEX_THREAD_ID OMT_DIR="$SBX/omt" \
        OMT_SESSION_ID="$SID" PATH="$no_bin" /bin/bash "$CODEX_HOOK") || true
    assert_denied "$out" codex-jq-absent-artifact || result=1

    # Every other path keeps the ordinary fail-open behavior.
    rc=0
    out=$(claude_payload "$OUTSIDE" | env -u CODEX_THREAD_ID OMT_DIR="$SBX/omt" \
        OMT_SESSION_ID="$SID" PATH="$no_bin" /bin/bash "$CLAUDE_HOOK") || rc=$?
    assert_allowed "$out" "$rc" claude-jq-absent-other || result=1
    cleanup_sandbox
    return "$result"
}

test_complete_step_allows_artifact_write() {
    new_sandbox
    local out rc=0 result=0
    write_state true true ""
    out=$(run_claude "$ARTIFACT") || rc=$?
    assert_allowed "$out" "$rc" claude-allowed || result=1
    rc=0
    out=$(run_codex "$ARTIFACT") || rc=$?
    assert_allowed "$out" "$rc" codex-allowed || result=1
    cleanup_sandbox
    return "$result"
}

test_legacy_render_complete_denies_on_both_platforms() {
    new_sandbox
    local out result=0
    write_render_state quiz '["evidence","background","intuition","code","render"]' true
    out=$(run_claude "$ARTIFACT") || true
    assert_denied "$out" claude-legacy-quiz || result=1
    assert_deny_reason_contains "$out" "render 증거 계약" claude-legacy-quiz-reason || result=1
    out=$(run_codex "$ARTIFACT") || true
    assert_denied "$out" codex-legacy-quiz || result=1
    assert_deny_reason_contains "$out" "render 증거 계약" codex-legacy-quiz-reason || result=1

    write_render_state background '["render"]' true
    out=$(run_claude "$ARTIFACT") || true
    assert_denied "$out" claude-legacy-passed-render || result=1
    out=$(run_codex "$ARTIFACT") || true
    assert_denied "$out" codex-legacy-passed-render || result=1
    cleanup_sandbox
    return "$result"
}

test_current_render_complete_allows_on_both_platforms() {
    new_sandbox
    local out rc=0 result=0
    write_render_state quiz '["evidence","background","intuition","code","render"]' false
    out=$(run_claude "$ARTIFACT") || rc=$?
    assert_allowed "$out" "$rc" claude-current-render || result=1
    rc=0
    out=$(run_codex "$ARTIFACT") || rc=$?
    assert_allowed "$out" "$rc" codex-current-render || result=1
    cleanup_sandbox
    return "$result"
}

test_non_artifact_paths_are_untouched() {
    new_sandbox
    local out rc=0 result=0
    # No state at all: the inverted default must not leak onto ordinary writes.
    rm -f "$SBX/omt/explain-diff-state-${SID}.json"
    out=$(run_claude "$OUTSIDE") || rc=$?
    assert_allowed "$out" "$rc" claude-outside || result=1
    rc=0
    out=$(run_codex "$OUTSIDE") || rc=$?
    assert_allowed "$out" "$rc" codex-outside || result=1
    cleanup_sandbox
    return "$result"
}

test_sibling_prefix_directory_is_not_guarded() {
    new_sandbox
    local out rc=0 result=0
    rm -f "$SBX/omt/explain-diff-state-${SID}.json"
    out=$(run_claude "$EVAL_ARTIFACT") || rc=$?
    assert_allowed "$out" "$rc" claude-eval-sibling || result=1
    rc=0
    out=$(run_codex "$EVAL_ARTIFACT") || rc=$?
    assert_allowed "$out" "$rc" codex-eval-sibling || result=1
    cleanup_sandbox
    return "$result"
}

test_claude_and_codex_deny_json_are_byte_identical() {
    new_sandbox
    local a b
    write_state true false "same reason"
    a=$(run_claude "$ARTIFACT") || true
    b=$(run_codex "$ARTIFACT") || true
    cleanup_sandbox
    if [ "$a" != "$b" ]; then
        echo "ASSERTION FAILED parity: claude='$a' codex='$b'"
        return 1
    fi
    [ -n "$a" ] || { echo "ASSERTION FAILED parity: both empty (neither denied)"; return 1; }
    return 0
}

# A fail-closed guard that is never registered is not a guard. Both platform
# shims must be wired to the write tools AND the shell tools — a document
# redirected out of a shell command reaches the same directory as an Edit.
test_both_platforms_register_the_guard() {
    local dir claude_count codex_count
    dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
    claude_count=$(awk '/component: explain-diff-artifact-guard.sh/{n++} END{print n+0}' "$dir/claude.yaml")
    codex_count=$(awk '/component: codex-explain-diff-artifact-guard.sh/{n++} END{print n+0}' "$dir/codex.yaml")
    local ok=0
    [ "$claude_count" -ge 1 ] || { echo "ASSERTION FAILED: claude.yaml does not register the guard"; ok=1; }
    [ "$codex_count" -ge 1 ] || { echo "ASSERTION FAILED: codex.yaml does not register the guard"; ok=1; }
    grep -q 'component: explain-diff-artifact-guard.sh' -A 2 "$dir/claude.yaml" \
        && grep -A 2 'component: explain-diff-artifact-guard.sh' "$dir/claude.yaml" | grep -q 'Write' \
        || { echo "ASSERTION FAILED: claude.yaml matcher does not cover Write"; ok=1; }
    return "$ok"
}

for test_name in \
    test_both_platforms_register_the_guard \
    test_state_absent_denies_artifact_path \
    test_step_incomplete_denies_and_names_return_step \
    test_stale_state_denies \
    test_inactive_state_denies \
    test_jq_absent_denies_artifact_path_only \
    test_complete_step_allows_artifact_write \
    test_legacy_render_complete_denies_on_both_platforms \
    test_current_render_complete_allows_on_both_platforms \
    test_non_artifact_paths_are_untouched \
    test_sibling_prefix_directory_is_not_guarded \
    test_claude_and_codex_deny_json_are_byte_identical; do
    run_test "$test_name"
done

echo "Tests: $TESTS_PASSED passed, $TESTS_FAILED failed"
[ "$TESTS_FAILED" -eq 0 ]

#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$SCRIPT_DIR/codex-explain-diff-seed.sh"
TESTS_PASSED=0
TESTS_FAILED=0

run_test() {
    local name="$1"
    if "$name"; then echo "[PASS] $name"; ((TESTS_PASSED++)) || true
    else echo "[FAIL] $name"; ((TESTS_FAILED++)) || true; fi
}

setup() {
    SBX=$(mktemp -d)
    REPO="$SBX/repo"
    mkdir -p "$REPO"
    git -C "$REPO" init -q -b main
    OMT=$(env -u OMT_DIR HOME="$SBX" bash -c "source '$SCRIPT_DIR/lib/omt-dir.sh'; resolve_omt_dir '$REPO'")
    mkdir -p "$OMT"
}
teardown() { rm -rf "$SBX"; }
run_prompt() { printf '%s' "$1" | env -u OMT_DIR -u OMT_SESSION_ID HOME="$SBX" CODEX_THREAD_ID=never bash "$HOOK"; }

# The prompt sigil seed arms the artifact guard before the skill runs.
# A seed that leaves artifact_write_allowed false would block the very first
# evidence-step write; one that leaves stop_allowed true would let the session
# stop before the quiz.
test_sigil_seeds_armed_state() {
    setup
    run_prompt "{\"session_id\":\"never\",\"cwd\":\"$REPO\",\"hook_event_name\":\"UserPromptSubmit\",\"prompt\":\"Use \$explain-diff on HEAD~1..HEAD\"}"
    local file="$OMT/explain-diff-state-never.json"
    local ok=0
    [ -f "$file" ] || ok=1
    [ "$(jq -r '.active' "$file" 2>/dev/null)" = true ] || ok=1
    [ "$(jq -r '.step' "$file" 2>/dev/null)" = evidence ] || ok=1
    [ "$(jq -r '.derived.artifact_write_allowed' "$file" 2>/dev/null)" = true ] || ok=1
    [ "$(jq -r '.derived.stop_allowed' "$file" 2>/dev/null)" = false ] || ok=1
    [ "$(jq -r '.derived.quiz_passed' "$file" 2>/dev/null)" = false ] || ok=1
    teardown
    return "$ok"
}

test_seed_is_idempotent() {
    setup
    run_prompt "{\"session_id\":\"never\",\"cwd\":\"$REPO\",\"hook_event_name\":\"UserPromptSubmit\",\"prompt\":\"\$explain-diff\"}"
    local file="$OMT/explain-diff-state-never.json" after
    printf '%s' '{"active":true,"sentinel":"preserve"}' > "$file"
    run_prompt "{\"session_id\":\"never\",\"cwd\":\"$REPO\",\"hook_event_name\":\"UserPromptSubmit\",\"prompt\":\"\$explain-diff\"}"
    after=$(cat "$file")
    teardown
    [ "$after" = '{"active":true,"sentinel":"preserve"}' ]
}

test_skill_open_does_not_seed() {
    setup
    local payload
    payload=$(jq -nc --arg cwd "$REPO" '{session_id:"never",cwd:$cwd,hook_event_name:"PreToolUse",tool_name:"Bash",tool_input:{command:"sed -n 1,80p .agents/skills/explain-diff/SKILL.md"}}')
    printf '%s' "$payload" | env -u OMT_DIR -u OMT_SESSION_ID HOME="$SBX" CODEX_THREAD_ID=never bash "$HOOK"
    local ok=0
    [ ! -f "$OMT/explain-diff-state-never.json" ] || ok=1
    teardown
    return "$ok"
}

test_unrelated_prompt_does_not_seed() {
    setup
    run_prompt "{\"session_id\":\"never\",\"cwd\":\"$REPO\",\"hook_event_name\":\"UserPromptSubmit\",\"prompt\":\"explain this diff to me\"}"
    local ok=0
    [ ! -f "$OMT/explain-diff-state-never.json" ] || ok=1
    teardown
    return "$ok"
}

# The eval baseline tree is a sibling named explain-diff-eval. A sigil scanner
# that stops matching at the word boundary would arm the gate on a prompt that
# only mentions the eval, and the eval would then be blocked by the gate it
# exists to measure.
test_eval_sibling_mention_does_not_seed() {
    setup
    run_prompt "{\"session_id\":\"never\",\"cwd\":\"$REPO\",\"hook_event_name\":\"UserPromptSubmit\",\"prompt\":\"check \$explain-diff-eval output\"}"
    local ok=0
    [ ! -f "$OMT/explain-diff-state-never.json" ] || ok=1
    teardown
    return "$ok"
}

test_yaml_registers_both_events() {
    local count
    count=$(awk '/component: codex-explain-diff-seed.sh/{n++} END{print n+0}' "$SCRIPT_DIR/../codex.yaml")
    [ "$count" -eq 2 ]
}

main() {
    run_test test_sigil_seeds_armed_state
    run_test test_seed_is_idempotent
    run_test test_skill_open_does_not_seed
    run_test test_unrelated_prompt_does_not_seed
    run_test test_eval_sibling_mention_does_not_seed
    run_test test_yaml_registers_both_events
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    [ "$TESTS_FAILED" -eq 0 ]
}
main "$@"

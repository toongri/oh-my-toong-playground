#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$SCRIPT_DIR/codex-qa-seed.sh"
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

test_sigil_seeds_qa_only() {
    setup
    run_prompt "{\"session_id\":\"never\",\"cwd\":\"$REPO\",\"hook_event_name\":\"UserPromptSubmit\",\"prompt\":\"Use \$qa now\"}"
    local file="$OMT/qa-state-never.json"
    local ok=0
    [ -f "$file" ] || ok=1
    [ ! -f "$OMT/prometheus-state-never.json" ] || ok=1
    [ "$(jq -r '.derived.driver_gate_armed' "$file" 2>/dev/null)" = true ] || ok=1
    teardown
    return "$ok"
}

test_sigil_seed_is_idempotent() {
    setup
    run_prompt "{\"session_id\":\"never\",\"cwd\":\"$REPO\",\"hook_event_name\":\"UserPromptSubmit\",\"prompt\":\"\$qa\"}"
    local file="$OMT/qa-state-never.json" before after
    before=$(cat "$file")
    printf '%s' '{"active":true,"sentinel":"preserve"}' > "$file"
    run_prompt "{\"session_id\":\"never\",\"cwd\":\"$REPO\",\"hook_event_name\":\"UserPromptSubmit\",\"prompt\":\"\$qa\"}"
    after=$(cat "$file")
    teardown
    [ "$after" = '{"active":true,"sentinel":"preserve"}' ]
}

test_skill_open_seeds() {
    setup
    local payload
    payload=$(jq -nc --arg cwd "$REPO" '{session_id:"never",cwd:$cwd,hook_event_name:"PreToolUse",tool_name:"Bash",tool_input:{command:"sed -n 1,80p .agents/skills/qa/SKILL.md"}}')
    printf '%s' "$payload" | env -u OMT_DIR -u OMT_SESSION_ID HOME="$SBX" CODEX_THREAD_ID=never bash "$HOOK"
    local ok=0
    [ -f "$OMT/qa-state-never.json" ] || ok=1
    teardown
    return "$ok"
}

test_unrelated_prompt_does_not_seed() {
    setup
    run_prompt "{\"session_id\":\"never\",\"cwd\":\"$REPO\",\"hook_event_name\":\"UserPromptSubmit\",\"prompt\":\"quality assurance\"}"
    local ok=0
    [ ! -f "$OMT/qa-state-never.json" ] || ok=1
    teardown
    return "$ok"
}

test_yaml_registers_both_events() {
    local count
    count=$(awk '/component: codex-qa-seed.sh/{n++} END{print n+0}' "$SCRIPT_DIR/../codex.yaml")
    [ "$count" -eq 2 ]
}

main() {
    run_test test_sigil_seeds_qa_only
    run_test test_sigil_seed_is_idempotent
    run_test test_skill_open_seeds
    run_test test_unrelated_prompt_does_not_seed
    run_test test_yaml_registers_both_events
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    [ "$TESTS_FAILED" -eq 0 ]
}
main "$@"

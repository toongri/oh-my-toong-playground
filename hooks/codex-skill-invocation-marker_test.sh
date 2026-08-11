#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$SCRIPT_DIR/codex-skill-invocation-marker.sh"
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
run_prompt() {
    printf '%s' "$1" | env -u OMT_DIR HOME="$SBX" PATH="/usr/bin:/bin" bash "$HOOK"
}

context_from() {
    printf '%s' "$1" | jq -r '.hookSpecificOutput.additionalContext // empty'
}

test_protected_explicit_injects_full_body() {
    setup
    mkdir -p "$REPO/.agents/skills/secret"
    printf '%s\n' '---' 'disable-model-invocation: true' '---' 'FULL_SENTINEL_BODY' > "$REPO/.agents/skills/secret/SKILL.md"
    local out ctx
    out=$(run_prompt "$(jq -nc --arg cwd "$REPO" '{session_id:"sid",cwd:$cwd,prompt:"use $secret"}')")
    ctx=$(context_from "$out")
    teardown
    printf '%s' "$ctx" | grep -qF '[CODEX EXPLICIT SKILL LOADED: secret]' && printf '%s' "$ctx" | grep -qF 'FULL_SENTINEL_BODY'
}

test_nonprotected_does_not_inject() {
    setup
    mkdir -p "$REPO/.agents/skills/plain"
    printf '%s\n' '---' 'disable-model-invocation: false' '---' 'PLAIN_SENTINEL_BODY' > "$REPO/.agents/skills/plain/SKILL.md"
    local out
    out=$(run_prompt "$(jq -nc --arg cwd "$REPO" '{session_id:"sid",cwd:$cwd,prompt:"use $plain"}')")
    teardown
    [ -z "$(context_from "$out")" ]
}

test_project_local_precedes_global_and_global_fallback() {
    setup
    mkdir -p "$REPO/.agents/skills/local" "$REPO/.agents/skills/global" "$SBX/.agents/skills/local" "$SBX/.agents/skills/global"
    printf '%s\n' '---' 'disable-model-invocation: true' '---' 'LOCAL_SENTINEL' > "$REPO/.agents/skills/local/SKILL.md"
    printf '%s\n' '---' 'disable-model-invocation: true' '---' 'GLOBAL_LOCAL_SENTINEL' > "$SBX/.agents/skills/local/SKILL.md"
    printf '%s\n' '---' 'disable-model-invocation: true' '---' 'GLOBAL_FALLBACK_SENTINEL' > "$SBX/.agents/skills/global/SKILL.md"
    local out ctx
    out=$(run_prompt "$(jq -nc --arg cwd "$REPO" '{session_id:"sid",cwd:$cwd,prompt:"$global then $local"}')")
    ctx=$(context_from "$out")
    teardown
    printf '%s' "$ctx" | grep -qF 'LOCAL_SENTINEL' && ! printf '%s' "$ctx" | grep -qF 'GLOBAL_LOCAL_SENTINEL' && printf '%s' "$ctx" | grep -qF 'GLOBAL_FALLBACK_SENTINEL'
}

test_one_and_multiple_sigils() {
    setup
    run_prompt "$(jq -nc --arg cwd "$REPO" '{session_id:"sid",cwd:$cwd,prompt:"$alpha and $beta"}')"
    local ok=0
    [ -f "$OMT/codex-skill-invocation-marker-sid-alpha" ] || ok=1
    [ -f "$OMT/codex-skill-invocation-marker-sid-beta" ] || ok=1
    teardown
    return "$ok"
}

test_deduplicates_and_sorts_sigils() {
    setup
    run_prompt "$(jq -nc --arg cwd "$REPO" '{session_id:"sid",cwd:$cwd,prompt:"$z $a $z $a"}')"
    local count
    count=$(find "$OMT" -name 'codex-skill-invocation-marker-sid-*' -type f | wc -l | tr -d ' ')
    teardown
    [ "$count" -eq 2 ]
}

test_hyphen_sibling_isolation() {
    setup
    run_prompt "$(jq -nc --arg cwd "$REPO" '{session_id:"sid",cwd:$cwd,prompt:"$explain-diff-eval"}')"
    local ok=0
    [ -f "$OMT/codex-skill-invocation-marker-sid-explain-diff-eval" ] || ok=1
    [ ! -f "$OMT/codex-skill-invocation-marker-sid-explain-diff" ] || ok=1
    teardown
    return "$ok"
}

test_unrelated_prompt_does_not_mark() {
    setup
    run_prompt "$(jq -nc --arg cwd "$REPO" '{session_id:"sid",cwd:$cwd,prompt:"ordinary text"}')"
    local count
    count=$(find "$OMT" -name 'codex-skill-invocation-marker-*' -type f | wc -l | tr -d ' ')
    teardown
    [ "$count" -eq 0 ]
}

test_malformed_payload_fails_open() {
    setup
    printf '%s' '{not json' | env -u OMT_DIR HOME="$SBX" PATH="/usr/bin:/bin" bash "$HOOK"
    local count
    count=$(find "$OMT" -name 'codex-skill-invocation-marker-*' -type f | wc -l | tr -d ' ')
    teardown
    [ "$count" -eq 0 ]
}

test_missing_jq_fails_open() {
    setup
    printf '%s' '{"session_id":"sid","cwd":"/unsafe","prompt":"$alpha"}' |
        env -u OMT_DIR HOME="$SBX" PATH="/bin" bash "$HOOK"
    local count
    count=$(find "$OMT" -name 'codex-skill-invocation-marker-*' -type f | wc -l | tr -d ' ')
    teardown
    [ "$count" -eq 0 ]
}

test_unsafe_session_id_fails_open() {
    setup
    run_prompt "$(jq -nc --arg cwd "$REPO" '{session_id:"bad/sid",cwd:$cwd,prompt:"$alpha"}')"
    local count
    count=$(find "$OMT" -name 'codex-skill-invocation-marker-*' -type f | wc -l | tr -d ' ')
    teardown
    [ "$count" -eq 0 ]
}

test_unsafe_cwd_fails_open() {
    setup
    run_prompt '{"session_id":"sid","cwd":"relative/path","prompt":"$alpha"}'
    local count
    count=$(find "$OMT" -name 'codex-skill-invocation-marker-*' -type f | wc -l | tr -d ' ')
    teardown
    [ "$count" -eq 0 ]
}

test_marker_idempotence_preserves_content() {
    setup
    local payload
    payload=$(jq -nc --arg cwd "$REPO" '{session_id:"sid",cwd:$cwd,prompt:"$alpha"}')
    run_prompt "$payload"
    printf '%s' sentinel > "$OMT/codex-skill-invocation-marker-sid-alpha"
    run_prompt "$payload"
    local content
    content=$(cat "$OMT/codex-skill-invocation-marker-sid-alpha")
    teardown
    [ "$content" = sentinel ]
}

main() {
    run_test test_one_and_multiple_sigils
    run_test test_deduplicates_and_sorts_sigils
    run_test test_hyphen_sibling_isolation
    run_test test_unrelated_prompt_does_not_mark
    run_test test_malformed_payload_fails_open
    run_test test_missing_jq_fails_open
    run_test test_unsafe_session_id_fails_open
    run_test test_unsafe_cwd_fails_open
    run_test test_marker_idempotence_preserves_content
    run_test test_protected_explicit_injects_full_body
    run_test test_nonprotected_does_not_inject
    run_test test_project_local_precedes_global_and_global_fallback
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    [ "$TESTS_FAILED" -eq 0 ]
}
main "$@"

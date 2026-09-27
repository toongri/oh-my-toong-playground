#!/bin/bash
# 두 sync validator 훅의 ROOT_DIR 해석과 차단 계약 검증.
#
# 착지점은 <target>/.claude/hooks/<name>.sh 로 평평하다(디렉터리형 훅과 달리
# 한 겹 얕다). 따라서 ROOT_DIR 은 <target> 이어야 tools/validators/ 를 찾는다.
# 검증 실패는 decision:block 으로 모델에 전달되고, 통과·대상 아님은 출력 없이 끝난다.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TESTS_PASSED=0
TESTS_FAILED=0

run_test() {
    local name="$1"
    if "$name"; then echo "[PASS] $name"; ((TESTS_PASSED++)) || true
    else echo "[FAIL] $name"; ((TESTS_FAILED++)) || true; fi
}

# 배포 착지점을 모사한 샌드박스. 검증기 자리에는 실제 검증기처럼 색상 코드로 감싼 마커를
# 찍고 지정한 코드로 끝나는 스텁을 둔다.
setup() {
    local hook="$1" validator="$2" exit_code="$3"
    SBX=$(mktemp -d)
    mkdir -p "$SBX/.claude/hooks" "$SBX/tools/validators"
    cp "$SCRIPT_DIR/$hook" "$SBX/.claude/hooks/$hook"
    printf 'console.log("\\x1b[0;31mVALIDATOR_RAN\\x1b[0m");\nprocess.exit(%s);\n' "$exit_code" > "$SBX/tools/validators/$validator"
}
teardown() { rm -rf "$SBX"; }

is_block_with_marker() {
    printf '%s' "$1" | jq -e '.decision == "block" and (.reason | test("VALIDATOR_RAN")) and ((.reason | explode | index(27)) == null)' >/dev/null 2>&1
}

run_schema() {
    printf '%s' "$1" | bash "$SBX/.claude/hooks/sync-schema-validator.sh" 2>/dev/null
}

run_component() {
    printf '%s' "$1" | bash "$SBX/.claude/hooks/sync-component-validator.sh" 2>/dev/null
}

test_schema_failure_blocks_with_validator_output() {
    setup sync-schema-validator.sh schema.ts 1
    local out ok=0
    out=$(run_schema '{"tool_input":{"file_path":"/nonexistent/sync.yaml"}}') || ok=1
    is_block_with_marker "$out" || ok=1
    teardown
    return "$ok"
}

test_schema_pass_is_silent() {
    setup sync-schema-validator.sh schema.ts 0
    local out ok=0
    out=$(run_schema '{"tool_input":{"file_path":"/nonexistent/sync.yaml"}}') || ok=1
    [ -z "$out" ] || ok=1
    teardown
    return "$ok"
}

test_schema_non_sync_file_is_silent() {
    setup sync-schema-validator.sh schema.ts 1
    local out ok=0
    out=$(run_schema '{"tool_input":{"file_path":"/repo/README.md"}}') || ok=1
    [ -z "$out" ] || ok=1
    teardown
    return "$ok"
}

test_component_failure_blocks_with_validator_output() {
    setup sync-component-validator.sh components.ts 1
    local out ok=0
    out=$(run_component '{"stop_hook_active":false}') || ok=1
    is_block_with_marker "$out" || ok=1
    teardown
    return "$ok"
}

test_component_pass_is_silent() {
    setup sync-component-validator.sh components.ts 0
    local out ok=0
    out=$(run_component '{"stop_hook_active":false}') || ok=1
    [ -z "$out" ] || ok=1
    teardown
    return "$ok"
}

test_component_does_not_block_twice() {
    setup sync-component-validator.sh components.ts 1
    local out ok=0
    out=$(run_component '{"stop_hook_active":true}') || ok=1
    [ -z "$out" ] || ok=1
    teardown
    return "$ok"
}

# matcher 는 도구 이름만 비교한다. `Edit(**/sync.yaml)` 같은 권한 규칙 문법은 어떤 도구와도 맞지 않는다.
test_schema_matcher_names_edit_tools() {
    local matcher
    matcher=$(awk '/sync-schema-validator.sh/{getline; print}' "$SCRIPT_DIR/../claude.yaml" | sed -E 's/.*matcher: *"([^"]*)".*/\1/')
    [ "$matcher" = "Edit|Write|MultiEdit" ]
}

main() {
    run_test test_schema_failure_blocks_with_validator_output
    run_test test_schema_pass_is_silent
    run_test test_schema_non_sync_file_is_silent
    run_test test_component_failure_blocks_with_validator_output
    run_test test_component_pass_is_silent
    run_test test_component_does_not_block_twice
    run_test test_schema_matcher_names_edit_tools
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    [ "$TESTS_FAILED" -eq 0 ]
}
main "$@"

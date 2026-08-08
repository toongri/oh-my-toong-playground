#!/bin/bash
# 두 sync validator 훅의 ROOT_DIR 해석 검증.
#
# 착지점은 <target>/.claude/hooks/<name>.sh 로 평평하다(디렉터리형 훅과 달리
# 한 겹 얕다). 따라서 ROOT_DIR 은 <target> 이어야 tools/validators/ 를 찾는다.
# 두 훅 모두 검증기 호출을 `|| true` 로 감싸 fail-open 이므로, 경로가 어긋나도
# exit code 로는 드러나지 않는다 — 검증기가 실제로 실행됐는지를 출력으로 본다.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TESTS_PASSED=0
TESTS_FAILED=0

run_test() {
    local name="$1"
    if "$name"; then echo "[PASS] $name"; ((TESTS_PASSED++)) || true
    else echo "[FAIL] $name"; ((TESTS_FAILED++)) || true; fi
}

# 배포 착지점을 모사한 샌드박스. 검증기 자리에는 마커만 찍는 스텁을 둔다.
setup() {
    SBX=$(mktemp -d)
    mkdir -p "$SBX/.claude/hooks" "$SBX/tools/validators"
    cp "$SCRIPT_DIR/$1" "$SBX/.claude/hooks/$1"
    echo 'console.log("VALIDATOR_RAN")' > "$SBX/tools/validators/$2"
}
teardown() { rm -rf "$SBX"; }

test_component_validator_finds_validator() {
    setup sync-component-validator.sh components.ts
    local out ok=0
    out=$(bash "$SBX/.claude/hooks/sync-component-validator.sh" 2>&1)
    [[ "$out" == *VALIDATOR_RAN* ]] || ok=1
    teardown
    return "$ok"
}

test_schema_validator_finds_validator() {
    setup sync-schema-validator.sh schema.ts
    local out ok=0
    out=$(printf '%s' '{"tool_input":{"file_path":"/nonexistent/sync.yaml"}}' \
        | bash "$SBX/.claude/hooks/sync-schema-validator.sh" 2>&1)
    [[ "$out" == *VALIDATOR_RAN* ]] || ok=1
    teardown
    return "$ok"
}

main() {
    run_test test_component_validator_finds_validator
    run_test test_schema_validator_finds_validator
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    [ "$TESTS_FAILED" -eq 0 ]
}
main "$@"

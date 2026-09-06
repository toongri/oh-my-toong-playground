#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$SCRIPT_DIR/codex-spawn-context-gate.sh"
TMP_DIR=$(mktemp -d)
trap 'rm -r "$TMP_DIR"' EXIT
JQ=$(command -v jq)
PASSED=0
FAILED=0

check() {
    local label="$1"
    shift
    if "$@"; then
        printf '[PASS] %s\n' "$label"
        PASSED=$((PASSED + 1))
    else
        printf '[FAIL] %s\n' "$label"
        FAILED=$((FAILED + 1))
    fi
}

run_hook() {
    local payload="$1"
    local hook_path="${2:-$PATH}"
    printf '%s' "$payload" | PATH="$hook_path" /bin/bash "$HOOK" >"$TMP_DIR/out" 2>"$TMP_DIR/err"
}

rewrites() {
    local tool="$1"
    local fork="$2"
    local payload
    payload=$($JQ -nc --arg tool "$tool" --argjson fork "$fork" '
        {tool_name:$tool, tool_input:({agent_type:"oracle", model:"example-model",
        reasoning_effort:"high", message:"한글\nquote \" and $HOME", task_name:"worker",
        extra:{future:[true,null,3]}} + $fork)}')
    run_hook "$payload" || return 1
    [ ! -s "$TMP_DIR/err" ] || return 1
    [ -s "$TMP_DIR/out" ] || return 1
    "$JQ" -e --argjson original "$payload" '
        .hookSpecificOutput as $h |
        $h.hookEventName == "PreToolUse" and $h.permissionDecision == "allow" and
        $h.updatedInput == ($original.tool_input | del(.fork_context) | . + {fork_turns:"none"})
    ' "$TMP_DIR/out" >/dev/null
}

noop() {
    run_hook "$1" || return 1
    [ ! -s "$TMP_DIR/out" ] && [ ! -s "$TMP_DIR/err" ]
}

idempotent() {
    local payload
    rewrites spawn_agent '{"fork_context":true}' || return 1
    payload=$("$JQ" -c '{tool_name:"spawn_agent",tool_input:.hookSpecificOutput.updatedInput}' "$TMP_DIR/out") || return 1
    noop "$payload"
}

denies() {
    run_hook "$1" "${2:-$PATH}" || return 1
    "$JQ" -e '.hookSpecificOutput |
        .hookEventName == "PreToolUse" and .permissionDecision == "deny" and
        (.permissionDecisionReason | type == "string" and length > 0) and
        (has("updatedInput") | not)' "$TMP_DIR/out" >/dev/null
}

check '생략된 fork_turns 추가와 다른 키 보존' rewrites spawn_agent '{}'
check 'all을 none으로 변경' rewrites agentsspawn_agent '{"fork_turns":"all"}'
check '숫자 문자열을 none으로 변경' rewrites collaborationspawn_agent '{"fork_turns":"3"}'
check '숫자 타입을 none으로 변경' rewrites spawn_agent '{"fork_turns":3}'
check 'null을 none으로 변경' rewrites spawn_agent '{"fork_turns":null}'
check '잘못된 객체를 none으로 변경' rewrites spawn_agent '{"fork_turns":{}}'
check '잘못된 불리언을 none으로 변경' rewrites spawn_agent '{"fork_turns":false}'
check '임의 네임스페이스 대응' rewrites customspawn_agent '{}'
check '구분자가 있는 네임스페이스 대응' rewrites agents.spawn_agent '{}'
check '기존 게이트와 동일한 대소문자 대응' rewrites agentsSpawn_Agent '{}'
check 'none과 함께 남은 V1 기록 복제 키 제거' rewrites spawn_agent '{"fork_turns":"none","fork_context":true}'
check 'V1 기록 복제 키 제거와 none 추가' rewrites spawn_agent '{"fork_context":true}'
for legacy_value in false null 3 '"all"' '{}' '[]'; do
    check "기존 키의 값에 상관없이 제거: $legacy_value" rewrites spawn_agent "{\"fork_turns\":\"none\",\"fork_context\":$legacy_value}"
done
check 'V1 키를 제거한 출력에 재적용하면 무변경' idempotent
check '이미 none이면 무변경' noop '{"tool_name":"spawn_agent","tool_input":{"fork_turns":"none"}}'
check '관련 없는 도구 무변경' noop '{"tool_name":"exec_command","tool_input":{"fork_turns":"all"}}'
check '관련 없는 도구의 잘못된 입력 무변경' noop '{"tool_name":"exec_command","tool_input":null}'
for payload in '' '{' 'null' '[]' '{}' '{"tool_name":3}' '{"tool_name":""}' \
    '{"tool_name":"spawn_agent"}' '{"tool_name":"spawn_agent","tool_input":null}' \
    '{"tool_name":"spawn_agent","tool_input":"{}"}' \
    '{"tool_name":"spawn_agent","tool_input":[]}' \
    '{"tool_name":"spawn_agent","tool_input":{}} {}'; do
    check "해석할 수 없는 입력 차단: $payload" denies "$payload"
done

# Failure injection exercises the real hook when its parser is unavailable
# or crashes. Use an isolated PATH instead of changing installed tools.
mkdir "$TMP_DIR/no-jq" "$TMP_DIR/broken-jq"
ln -s /bin/cat "$TMP_DIR/no-jq/cat"
ln -s /bin/cat "$TMP_DIR/broken-jq/cat"
printf '#!/bin/bash\nexit 7\n' >"$TMP_DIR/broken-jq/jq"
chmod +x "$TMP_DIR/broken-jq/jq"
check 'jq 부재 시 차단' denies '{"tool_name":"spawn_agent","tool_input":{}}' "$TMP_DIR/no-jq"
check 'jq 실행 오류 시 차단' denies '{"tool_name":"spawn_agent","tool_input":{}}' "$TMP_DIR/broken-jq"

printf '통과: %s, 실패: %s\n' "$PASSED" "$FAILED"
[ "$FAILED" -eq 0 ]

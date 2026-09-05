#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$SCRIPT_DIR/codex-spawn-role-gate.sh"
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
    printf '%s' "$1" | PATH="${2:-$PATH}" /bin/bash "$HOOK" >"$TMP_DIR/out" 2>"$TMP_DIR/err"
}

allows() {
    run_hook "$1" || return 1
    [ ! -s "$TMP_DIR/out" ] && [ ! -s "$TMP_DIR/err" ]
}

denies() {
    run_hook "$1" "${2:-$PATH}" || return 1
    [ -s "$TMP_DIR/out" ] || return 1
    "$JQ" -e '.hookSpecificOutput |
        .hookEventName == "PreToolUse" and .permissionDecision == "deny" and
        (.permissionDecisionReason | contains("agent_type") and contains("default")) and
        (has("updatedInput") | not)' "$TMP_DIR/out" >/dev/null
}

for role in '"default"' '"explore"' '"custom-role"' '"  explore  "' '"\u00a0oracle\u3000"' '"\u200b"' '"\ufeff"'; do
    check "명시한 비어 있지 않은 역할 허용: $role" allows "{\"tool_name\":\"spawn_agent\",\"tool_input\":{\"agent_type\":$role}}"
done
for role in null '""' '" \t\r\n"' '"\u0085\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000"' '"\u000b\u000c"' 1 false '{}' '[]'; do
    check "빈 역할 또는 잘못된 타입 차단: $role" denies "{\"tool_name\":\"spawn_agent\",\"tool_input\":{\"agent_type\":$role}}"
done
for tool in spawn_agent agentsspawn_agent collaborationspawn_agent customspawn_agent agents.spawn_agent agentsSpawn_Agent; do
    check "네임스페이스별 누락 역할 차단: $tool" denies "{\"tool_name\":\"$tool\",\"tool_input\":{}}"
done
for payload in '' '{' 'null' '[]' '{}' '{"tool_name":3}' '{"tool_name":""}' \
    '{"tool_name":"spawn_agent"}' '{"tool_name":"spawn_agent","tool_input":null}' \
    '{"tool_name":"spawn_agent","tool_input":"{}"}' '{"tool_name":"spawn_agent","tool_input":[]}' \
    '{"tool_name":"spawn_agent","tool_input":{}} {}'; do
    check "잘못된 페이로드 차단: $payload" denies "$payload"
done
check '관련 없는 도구는 역할 없이 허용' allows '{"tool_name":"exec_command","tool_input":null}'

mkdir "$TMP_DIR/no-jq" "$TMP_DIR/broken-jq"
ln -s /bin/cat "$TMP_DIR/no-jq/cat"
ln -s /bin/cat "$TMP_DIR/broken-jq/cat"
printf '#!/bin/bash\nexit 7\n' >"$TMP_DIR/broken-jq/jq"
chmod +x "$TMP_DIR/broken-jq/jq"
check 'jq 부재 시 차단' denies '{"tool_name":"spawn_agent","tool_input":{}}' "$TMP_DIR/no-jq"
check 'jq 실행 오류 시 차단' denies '{"tool_name":"spawn_agent","tool_input":{}}' "$TMP_DIR/broken-jq"

combined_hooks() {
    local role="$1"
    local payload
    payload=$("$JQ" -nc --argjson role "$role" '{tool_name:"spawn_agent",tool_input:({fork_turns:"all",message:"task",task_name:"worker"} + $role)}')
    printf '%s' "$payload" | /bin/bash "$SCRIPT_DIR/codex-spawn-context-gate.sh" >"$TMP_DIR/context" || return 1
    [ -s "$TMP_DIR/context" ] || return 1
    "$JQ" -e --argjson role "$role" '.hookSpecificOutput | .permissionDecision == "allow" and
        .updatedInput.fork_turns == "none" and
        (.updatedInput | has("agent_type")) == ($role | has("agent_type"))' "$TMP_DIR/context" >/dev/null || return 1
    if [ "$role" = '{}' ]; then
        # Both hooks receive original input; Codex denial wins over updates.
        denies "$payload"
    else
        # Role validation must not emit a competing updatedInput.
        allows "$payload"
    fi
}
check '역할 누락 차단은 컨텍스트 변경 허용보다 우선' combined_hooks '{}'
check '역할 검증은 컨텍스트 변경 출력과 충돌하지 않음' combined_hooks '{"agent_type":"default"}'

printf '통과: %s, 실패: %s\n' "$PASSED" "$FAILED"
[ "$FAILED" -eq 0 ]

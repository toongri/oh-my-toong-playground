#!/bin/bash
# =============================================================================
# Pre-commit Gate (PreToolUse hook)
# git commit 전 ktlint 자동 수정 + 검증
# matcher: "Bash" (tool name regex만 지원)
# =============================================================================

# Read tool input from stdin
input=$(cat)

# Fast path: git commit이 아니면 즉시 통과
command_str=$(echo "$input" | jq -r '.tool_input.command // ""')
if [[ "$command_str" != *"git commit"* ]]; then
    exit 0
fi

# ktlint 자동 수정
./gradlew ktlintFormat -q 2>/dev/null || true

# ktlint 검증
ktlint_output=$(./gradlew ktlintCheck -q 2>&1)
KTLINT_RC=$?

if [[ $KTLINT_RC -ne 0 ]]; then
    echo '{"decision":"deny","reason":"ktlintCheck failed. Fix lint errors before committing."}' >&2
    echo "$ktlint_output" >&2
    exit 2
fi

exit 0

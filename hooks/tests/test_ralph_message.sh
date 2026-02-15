#!/bin/bash
# Test: Ralph activation message validation
# Tests that the ralph keyword produces valid JSON with required content

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK_SCRIPT="$SCRIPT_DIR/../keyword-detector.sh"

# Test function to check if string is valid JSON
test_json_valid() {
    local result
    result=$(echo '{"prompt": "ralph fix the bug", "cwd": "/tmp"}' | "$HOOK_SCRIPT")

    if ! echo "$result" | jq . > /dev/null 2>&1; then
        echo "FAIL: Output is not valid JSON"
        echo "Output was: $result"
        return 1
    fi
    echo "PASS: Output is valid JSON"
    return 0
}

# Test function to check for COMPLETION CONDITION GUIDE section
test_completion_guide_present() {
    local message
    message=$(echo '{"prompt": "ralph fix the bug", "cwd": "/tmp"}' | "$HOOK_SCRIPT" | jq -r '.hookSpecificOutput.additionalContext')

    if [[ "$message" != *"COMPLETION SEQUENCE (MANDATORY)"* ]]; then
        echo "FAIL: Message does not contain 'COMPLETION SEQUENCE (MANDATORY)'"
        return 1
    fi
    echo "PASS: COMPLETION SEQUENCE (MANDATORY) present"
    return 0
}

# Test function to check for VERIFICATION REQUIREMENTS section
test_verification_requirements_present() {
    local message
    message=$(echo '{"prompt": "ralph fix the bug", "cwd": "/tmp"}' | "$HOOK_SCRIPT" | jq -r '.hookSpecificOutput.additionalContext')

    if [[ "$message" != *"VERIFICATION REQUIREMENTS"* ]]; then
        echo "FAIL: Message does not contain 'VERIFICATION REQUIREMENTS'"
        return 1
    fi
    echo "PASS: VERIFICATION REQUIREMENTS present"
    return 0
}

# Test function to check for Red Flags section
test_red_flags_present() {
    local message
    message=$(echo '{"prompt": "ralph fix the bug", "cwd": "/tmp"}' | "$HOOK_SCRIPT" | jq -r '.hookSpecificOutput.additionalContext')

    if [[ "$message" != *"Red Flags"* ]]; then
        echo "FAIL: Message does not contain 'Red Flags'"
        return 1
    fi
    echo "PASS: Red Flags present"
    return 0
}

# Test function to check for CORE RULES section
test_core_rules_present() {
    local message
    message=$(echo '{"prompt": "ralph fix the bug", "cwd": "/tmp"}' | "$HOOK_SCRIPT" | jq -r '.hookSpecificOutput.additionalContext')

    if [[ "$message" != *"CORE RULES"* ]]; then
        echo "FAIL: Message does not contain 'CORE RULES'"
        return 1
    fi
    echo "PASS: CORE RULES present"
    return 0
}

# Test function to check variable expansion
test_variable_expansion() {
    local message
    message=$(echo '{"prompt": "ralph implement feature X", "cwd": "/tmp"}' | "$HOOK_SCRIPT" | jq -r '.hookSpecificOutput.additionalContext')

    if [[ "$message" != *"Original task: ralph implement feature X"* ]]; then
        echo "FAIL: PROMPT variable not expanded correctly"
        echo "Message excerpt: $(echo "$message" | grep -o 'Original task:.*' | head -1)"
        return 1
    fi
    echo "PASS: Variable expansion works"
    return 0
}

# Run all tests
echo "=== Testing Ralph Activation Message ==="
echo ""

FAILED=0

test_json_valid || FAILED=1
test_completion_guide_present || FAILED=1
test_verification_requirements_present || FAILED=1
test_red_flags_present || FAILED=1
test_core_rules_present || FAILED=1
test_variable_expansion || FAILED=1

echo ""
if [ $FAILED -eq 0 ]; then
    echo "=== ALL TESTS PASSED ==="
    exit 0
else
    echo "=== SOME TESTS FAILED ==="
    exit 1
fi

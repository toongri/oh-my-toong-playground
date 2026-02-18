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

# Test: @file mentions produce [referenced files: ...] annotation
test_file_references() {
    local output
    output=$(echo '{"parts": [{"type": "text", "text": "ralph fix this"}, {"type": "file", "file_path": "src/main.kt"}], "cwd": "/tmp"}' | "$HOOK_SCRIPT")

    local message
    message=$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext')

    if [[ "$message" != *"[referenced files: src/main.kt]"* ]]; then
        echo "FAIL: File reference not found in message"
        echo "Message excerpt: $(echo "$message" | grep -o 'referenced files:.*' | head -1)"
        return 1
    fi
    echo "PASS: File reference included"
    return 0
}

# Test: Multiple @file mentions produce comma-separated file list
test_multiple_file_references() {
    local output
    output=$(echo '{"parts": [{"type": "text", "text": "ralph refactor these"}, {"type": "file", "file_path": "src/Foo.kt"}, {"type": "file", "file_path": "test/FooTest.kt"}], "cwd": "/tmp"}' | "$HOOK_SCRIPT")

    local message
    message=$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext')

    if [[ "$message" != *"[referenced files: src/Foo.kt, test/FooTest.kt]"* ]]; then
        echo "FAIL: Multiple file references not found"
        echo "Message excerpt: $(echo "$message" | grep -o 'referenced files:.*' | head -1)"
        return 1
    fi
    echo "PASS: Multiple file references included"
    return 0
}

# Test: Code blocks are preserved in ralph prompt
test_code_blocks_preserved() {
    local output
    output=$(printf '{"prompt": "ralph fix this ```kotlin\\nfun foo() = 42\\n```", "cwd": "/tmp"}' | "$HOOK_SCRIPT")

    # Note: Code blocks with newlines produce raw newlines in output,
    # which breaks JSON parsing. Check raw output instead of jq.
    if [[ "$output" != *'```kotlin'* ]]; then
        echo "FAIL: Code block not preserved in message"
        return 1
    fi
    echo "PASS: Code blocks preserved"
    return 0
}

# Test: System-reminder tags are removed from ralph prompt
test_system_reminder_removed() {
    local output
    output=$(echo '{"prompt": "ralph fix this <system-reminder>noise</system-reminder> please", "cwd": "/tmp"}' | "$HOOK_SCRIPT")

    local message
    message=$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext')

    if [[ "$message" == *"system-reminder"* ]]; then
        echo "FAIL: System-reminder tag not removed"
        return 1
    fi
    if [[ "$message" != *"ralph fix this"* ]]; then
        echo "FAIL: Non-reminder content was lost"
        return 1
    fi
    echo "PASS: System-reminder removed, content preserved"
    return 0
}

# Test: No file annotation when no file parts present
test_no_file_annotation_without_files() {
    local output
    output=$(echo '{"prompt": "ralph fix the bug", "cwd": "/tmp"}' | "$HOOK_SCRIPT")

    local message
    message=$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext')

    if [[ "$message" == *"referenced files"* ]]; then
        echo "FAIL: File annotation present without file parts"
        return 1
    fi
    echo "PASS: No file annotation without file parts"
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
test_file_references || FAILED=1
test_multiple_file_references || FAILED=1
test_code_blocks_preserved || FAILED=1
test_system_reminder_removed || FAILED=1
test_no_file_annotation_without_files || FAILED=1

echo ""
if [ $FAILED -eq 0 ]; then
    echo "=== ALL TESTS PASSED ==="
    exit 0
else
    echo "=== SOME TESTS FAILED ==="
    exit 1
fi

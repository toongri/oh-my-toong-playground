#!/bin/bash
# =============================================================================
# Codex Keyword Detector Hook Tests (Claude<->Codex hook-parity plan)
#
# Covers hooks/codex-keyword-detector.sh: the Codex UserPromptSubmit shim
# over the shared judgment core (hooks/keyword-detector-core.sh) that
# hooks/keyword-detector.sh (Claude) also uses. Asserts:
#   - the shared core is actually referenced (zero duplicated judgment logic)
#   - Codex's envelope shape (hookSpecificOutput, NO `continue` key)
#   - a positive arm (ultrawork keyword present) emits the sentinel
#   - a negative-control arm (no keyword) emits NOTHING (exit 0, empty stdout)
#     -- required so a probe asserting on this hook has a real discriminator
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$SCRIPT_DIR/codex-keyword-detector.sh"

TESTS_PASSED=0
TESTS_FAILED=0

run_test() {
    local test_name="$1"
    if "$test_name"; then
        echo "[PASS] $test_name"
        ((TESTS_PASSED++)) || true
    else
        echo "[FAIL] $test_name"
        ((TESTS_FAILED++)) || true
    fi
}

run_hook() {
    local prompt="$1"
    local escaped
    escaped=$(printf '%s' "$prompt" | jq -Rs .)
    printf '{"session_id":"s1","turn_id":"t1","transcript_path":null,"cwd":"/tmp","hook_event_name":"UserPromptSubmit","model":"gpt","permission_mode":"default","prompt":%s}' "$escaped" \
        | bash "$HOOK"
}

# =============================================================================
# AC2 witness — the shim actually SOURCES the shared core (zero duplicated
# judgment logic), not a re-implementation.
# =============================================================================
test_shim_sources_shared_core() {
    grep -qF 'source "$SCRIPT_DIR/keyword-detector-core.sh"' "$HOOK" \
        || { echo "ASSERTION FAILED: codex-keyword-detector.sh must source keyword-detector-core.sh"; return 1; }
    return 0
}

# =============================================================================
# Positive arm — ultrawork keyword present -> sentinel observed
# =============================================================================
test_ultrawork_keyword_emits_sentinel() {
    local output
    output=$(run_hook "ultrawork implement the feature")
    echo "$output" | grep -qF "ultrawork-mode" \
        || { echo "ASSERTION FAILED: expected ultrawork-mode sentinel. Got: $output"; return 1; }
    return 0
}

# =============================================================================
# Negative control — no keyword -> NOTHING observed (real discriminator)
# =============================================================================
test_no_keyword_emits_nothing() {
    local output exit_code
    output=$(run_hook "hello, how are you today")
    exit_code=$?
    [ "$exit_code" -eq 0 ] || { echo "ASSERTION FAILED: expected exit 0, got $exit_code"; return 1; }
    [ -z "$output" ] \
        || { echo "ASSERTION FAILED: expected empty stdout for a keyword-free prompt. Got: $output"; return 1; }
    return 0
}

# =============================================================================
# Codex envelope shape — hookSpecificOutput present, NO `continue` key
# (Codex-only UserPromptSubmit contract, unlike Claude's envelope).
# =============================================================================
test_codex_envelope_has_no_continue_key() {
    local output
    output=$(run_hook "ultrawork do this")
    echo "$output" | jq -e 'has("continue") | not' > /dev/null \
        || { echo "ASSERTION FAILED: Codex envelope must not carry a 'continue' key. Got: $output"; return 1; }
    echo "$output" | jq -e '.hookSpecificOutput.hookEventName == "UserPromptSubmit"' > /dev/null \
        || { echo "ASSERTION FAILED: hookEventName must be UserPromptSubmit. Got: $output"; return 1; }
    return 0
}

test_output_is_valid_json() {
    local output
    output=$(run_hook "ultrawork ship it")
    echo "$output" | jq . > /dev/null \
        || { echo "ASSERTION FAILED: output is not valid JSON. Got: $output"; return 1; }
    return 0
}

# =============================================================================
# Code-block exclusion — mirrors hooks/keyword-detector_test.sh's Claude
# coverage; the shared core's strip/classify pipeline is identical.
# =============================================================================
test_ultrawork_not_detected_in_code_block() {
    local prompt='Here is example:
```bash
echo ultrawork
```
Please review this code'
    local output
    output=$(run_hook "$prompt")
    if echo "$output" | grep -q "ultrawork-mode"; then
        echo "ASSERTION FAILED: ultrawork inside code block should be ignored"
        return 1
    fi
    return 0
}

# =============================================================================
# think/search/analyze modes — spot-check the other 3 modes route correctly.
# =============================================================================
test_think_keyword_emits_sentinel() {
    local output
    output=$(run_hook "think about this problem")
    echo "$output" | grep -qF "think-mode" \
        || { echo "ASSERTION FAILED: expected think-mode sentinel. Got: $output"; return 1; }
    return 0
}

test_search_keyword_emits_sentinel() {
    local output
    output=$(run_hook "search for files")
    echo "$output" | grep -qF "search-mode" \
        || { echo "ASSERTION FAILED: expected search-mode sentinel. Got: $output"; return 1; }
    return 0
}

test_analyze_keyword_emits_sentinel() {
    local output
    output=$(run_hook "analyze this code")
    echo "$output" | grep -qF "analyze-mode" \
        || { echo "ASSERTION FAILED: expected analyze-mode sentinel. Got: $output"; return 1; }
    return 0
}

# =============================================================================
# Claude-only tool literal leak — the confirmed defect. hooks/*.sh files copy
# to the Codex deploy target byte-for-byte with NO rewrite pass (tools/lib/
# rewrite-rules.ts only rewrites .md; tools/sync.ts:1311-1321 skips .sh), so
# a Claude-only tool literal hand-authored in keyword-detector-core.sh's
# heredocs reaches the Codex model verbatim unless the Codex shim overrides
# it via the core's platform-vocabulary parameters. Scoped to exactly the
# 4 literals with no real Codex analog: `Task` (prose "Task calls" -- neither
# rewrite-rules.ts rule 11a "Task(" nor 11b "Task tool" matches this form),
# `Grep`, `Glob`, `LSP` (no entry at all in PLATFORM_REWRITE_RULES.codex).
# `oracle`/`explore` are deliberately EXCLUDED: both are real cross-platform
# agent names deployed to Codex too (config.yaml `agents: [claude, codex]`,
# projects/oh-my-toong/sync.yaml's unrestricted agents entries -- confirmed
# present at ~/.codex/agents/oracle.toml and ~/.codex/agents/explore.toml),
# so asserting their absence would be a false requirement, not a real leak.
# =============================================================================
test_ultrawork_output_has_no_task_literal() {
    local output
    output=$(run_hook "ultrawork implement the feature")
    if echo "$output" | grep -qE '\bTask\b'; then
        echo "ASSERTION FAILED: Codex ultrawork output leaked Claude-only literal 'Task'. Got: $output"
        return 1
    fi
    return 0
}

test_search_output_has_no_grep_glob_literals() {
    local output
    output=$(run_hook "search for files")
    if echo "$output" | grep -qE '\bGrep\b|\bGlob\b'; then
        echo "ASSERTION FAILED: Codex search output leaked Claude-only literal 'Grep'/'Glob'. Got: $output"
        return 1
    fi
    return 0
}

test_analyze_output_has_no_grep_glob_lsp_literals() {
    local output
    output=$(run_hook "analyze this code")
    if echo "$output" | grep -qE '\bGrep\b|\bGlob\b|\bLSP\b'; then
        echo "ASSERTION FAILED: Codex analyze output leaked Claude-only literal 'Grep'/'Glob'/'LSP'. Got: $output"
        return 1
    fi
    return 0
}

# =============================================================================
# Fail-open — jq absent must exit 0 with no stdout (mirrors codex-write-
# guard.sh's fail-open policy for the same "jq required" dependency).
# =============================================================================
test_missing_jq_fails_open() {
    # Build a PATH with every /usr/bin and /bin entry symlinked in EXCEPT
    # jq, so grep/tr/perl (needed by the shared core) stay resolvable while
    # jq genuinely is not. Mirrors hooks/ledger-core_test.sh's
    # test_qa_jq_absent technique. /bin/bash (absolute path) sidesteps a
    # calling-shell PATH re-resolution of the `bash` command name itself.
    local jq_less_bin entry
    jq_less_bin=$(mktemp -d)
    for entry in /usr/bin/* /bin/*; do
        [ "$(basename "$entry")" = "jq" ] && continue
        ln -s "$entry" "$jq_less_bin/$(basename "$entry")" 2>/dev/null || true
    done

    local exit_code=0
    local output
    output=$(printf '{"prompt":"ultrawork do this"}' \
        | PATH="$jq_less_bin" /bin/bash "$HOOK" 2>/dev/null) || exit_code=$?
    rm -rf "$jq_less_bin"

    [ "$exit_code" -eq 0 ] || { echo "ASSERTION FAILED: expected exit 0 when jq is absent, got $exit_code"; return 1; }
    [ -z "$output" ] || { echo "ASSERTION FAILED: expected empty stdout when jq is absent. Got: $output"; return 1; }
    return 0
}

main() {
    echo "=========================================="
    echo "Codex Keyword Detector Tests"
    echo "=========================================="

    run_test test_shim_sources_shared_core
    run_test test_ultrawork_keyword_emits_sentinel
    run_test test_no_keyword_emits_nothing
    run_test test_codex_envelope_has_no_continue_key
    run_test test_output_is_valid_json
    run_test test_ultrawork_not_detected_in_code_block
    run_test test_think_keyword_emits_sentinel
    run_test test_search_keyword_emits_sentinel
    run_test test_analyze_keyword_emits_sentinel
    run_test test_missing_jq_fails_open

    # Claude-only tool literal leak (the confirmed defect)
    run_test test_ultrawork_output_has_no_task_literal
    run_test test_search_output_has_no_grep_glob_literals
    run_test test_analyze_output_has_no_grep_glob_lsp_literals

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
}

main "$@"

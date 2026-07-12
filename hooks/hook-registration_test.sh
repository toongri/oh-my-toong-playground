#!/bin/bash
# =============================================================================
# Hook Registration Consistency Tests (plan TODO 9)
#
# Static registration audit across every deployed claude.yaml (+ codex.yaml/
# gemini.yaml/opencode.yaml) in the repo. Guards the compaction-continuous-
# record-ledger plan's cross-platform registration invariant:
#   - Every claude.yaml target that registers session-start.sh under
#     SessionStart must also register pre-tool-enforcer.sh under PreToolUse,
#     and vice versa -- the ledger recording instruction (session-start.sh,
#     TODO 3) and the ledger write-guard (pre-tool-enforcer.sh, TODO 7) are a
#     matched pair; a target that opts into one without the other is a
#     registration drift the plan's D5/D2 tradeoffs assume does not happen.
#     Targets that opt into NEITHER (e.g. oh-my-resume, which uses
#     resume-forge-start.sh instead) are unaffected -- this is not a
#     "every target must have both" mandate, only a pairing invariant.
#   - No claude.yaml/codex.yaml/gemini.yaml/opencode.yaml anywhere in the
#     repo registers a PreCompact hook (TODO 1 removed the LLM summarizer's
#     sole registration site; nothing should re-register it).
#   - codex.yaml registers a PreToolUse guard (codex-write-guard.sh) -- Codex
#     >= 0.144.1 enforces a pre-execution PreToolUse permissionDecision:"deny",
#     falsifying the earlier assumption that Codex lacked this event; the
#     ledger write-guard is wired there just like Claude's, alongside the
#     SessionStart recording instruction (rules-injector).
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

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

# Extract the lines nested under a 2-space-indented top-level hooks key
# (e.g. "SessionStart", "PreToolUse") up to the next 2-space-indented key.
_extract_hook_event_block() {
    local file="$1"
    local event="$2"
    awk -v event="  ${event}:" '
        $0 == event { infield=1; next }
        infield && /^  [A-Za-z]/ { infield=0 }
        infield { print }
    ' "$file"
}

_all_claude_yaml_files() {
    printf '%s\n' "$REPO_DIR/claude.yaml"
    find "$REPO_DIR/projects" -maxdepth 2 -name "claude.yaml" 2>/dev/null | sort
}

_all_platform_yaml_files() {
    local f
    for f in "$REPO_DIR/claude.yaml" "$REPO_DIR/codex.yaml" "$REPO_DIR/gemini.yaml" "$REPO_DIR/opencode.yaml"; do
        [ -f "$f" ] && printf '%s\n' "$f"
    done
    find "$REPO_DIR/projects" -maxdepth 2 \
        \( -name "claude.yaml" -o -name "codex.yaml" -o -name "gemini.yaml" -o -name "opencode.yaml" \) \
        2>/dev/null | sort
}

# =============================================================================
# session-start.sh <-> pre-tool-enforcer.sh pairing across every claude.yaml
# that opts into either half of the pair.
# =============================================================================
test_session_start_and_write_guard_paired_across_targets() {
    local file failed=0
    while IFS= read -r file; do
        [ -f "$file" ] || continue
        local ss_block pte_block has_ss=0 has_pte=0
        ss_block=$(_extract_hook_event_block "$file" "SessionStart")
        pte_block=$(_extract_hook_event_block "$file" "PreToolUse")
        echo "$ss_block" | grep -qF 'component: session-start.sh' && has_ss=1
        echo "$pte_block" | grep -qF 'component: pre-tool-enforcer.sh' && has_pte=1

        if [ "$has_ss" -eq 1 ] && [ "$has_pte" -eq 0 ]; then
            echo "ASSERTION FAILED: $file registers session-start.sh under SessionStart but NOT pre-tool-enforcer.sh under PreToolUse"
            failed=1
        fi
        if [ "$has_pte" -eq 1 ] && [ "$has_ss" -eq 0 ]; then
            echo "ASSERTION FAILED: $file registers pre-tool-enforcer.sh under PreToolUse but NOT session-start.sh under SessionStart"
            failed=1
        fi
    done < <(_all_claude_yaml_files)

    [ "$failed" -eq 0 ]
}

# Positive witness: at least one target actually carries the pair, so the
# loop above cannot pass vacuously (zero true positives masking a regression
# where every target silently dropped both hooks).
test_session_start_and_write_guard_pair_witnessed_at_least_once() {
    local file witnessed=0
    while IFS= read -r file; do
        [ -f "$file" ] || continue
        local ss_block pte_block
        ss_block=$(_extract_hook_event_block "$file" "SessionStart")
        pte_block=$(_extract_hook_event_block "$file" "PreToolUse")
        if echo "$ss_block" | grep -qF 'component: session-start.sh' \
            && echo "$pte_block" | grep -qF 'component: pre-tool-enforcer.sh'; then
            witnessed=1
        fi
    done < <(_all_claude_yaml_files)

    if [ "$witnessed" -eq 0 ]; then
        echo "ASSERTION FAILED: no claude.yaml target witnessed with BOTH session-start.sh (SessionStart) and pre-tool-enforcer.sh (PreToolUse) registered"
        return 1
    fi
    return 0
}

# =============================================================================
# PreCompact removed everywhere -- root + every projects/*/{claude,codex,
# gemini,opencode}.yaml.
# =============================================================================
test_precompact_removed_from_all_targets() {
    local f matches=""
    while IFS= read -r f; do
        [ -f "$f" ] || continue
        local m
        m=$(grep -n 'PreCompact' "$f" 2>/dev/null || true)
        if [ -n "$m" ]; then
            matches="${matches}${f}: ${m}"$'\n'
        fi
    done < <(_all_platform_yaml_files)

    if [ -n "$matches" ]; then
        echo "ASSERTION FAILED: PreCompact must be registered on 0 targets (plan TODO 1 removal)"
        echo "$matches"
        return 1
    fi
    return 0
}

# =============================================================================
# codex.yaml registers a PreToolUse guard -- Codex >= 0.144.1 enforces a
# pre-execution PreToolUse permissionDecision:"deny", so the ledger
# write-guard (codex-write-guard.sh) belongs there.
# =============================================================================
test_codex_yaml_has_pretooluse_guard() {
    if [ "$(grep -c '^  PreToolUse:' "$REPO_DIR/codex.yaml")" = "0" ]; then
        echo "ASSERTION FAILED: codex.yaml must register a PreToolUse hook (codex-write-guard.sh)"
        return 1
    fi
    if [ "$(grep -c 'component: codex-write-guard.sh' "$REPO_DIR/codex.yaml")" = "0" ]; then
        echo "ASSERTION FAILED: codex.yaml PreToolUse must register codex-write-guard.sh"
        return 1
    fi
    return 0
}

main() {
    echo "=========================================="
    echo "Hook Registration Consistency Tests"
    echo "=========================================="

    run_test test_session_start_and_write_guard_paired_across_targets
    run_test test_session_start_and_write_guard_pair_witnessed_at_least_once
    run_test test_precompact_removed_from_all_targets
    run_test test_codex_yaml_has_pretooluse_guard

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
}

main "$@"

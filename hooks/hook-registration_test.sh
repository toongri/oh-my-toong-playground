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
#   - The four core Claude hooks (keyword-detector.sh, pre-tool-enforcer.sh,
#     session-start.sh, persistent-mode) are registered in the TRACKED root
#     claude.yaml, and in NO projects/*/claude.yaml. Two invariants the pairing
#     check above cannot see:
#       (a) TRACKED, not claude.local.yaml. These four carry nothing
#           device-specific, and claude.local.yaml is gitignored -- parking
#           them there put the whole global hook registration outside version
#           control, so a fresh clone got no hooks and anyone reading only the
#           tracked files saw an empty root claude.yaml and concluded the hooks
#           were unregistered. That misreading is what this assertion prevents.
#       (b) NOT re-declared per project. Global registration lands in
#           ~/.claude/settings.json while project registration lands in the
#           target's .claude/settings.local.json, and Claude Code merges both
#           -- a hook left in both scopes fires twice (session-start.sh would
#           inject its stdout into the conversation prefix twice).
#     The pairing invariant passes just as happily when the pair sits in four
#     project files as when it sits at root, which is exactly how these drifted
#     while their Codex counterparts (codex-write-guard.sh,
#     codex-persistent-mode, codex-ledger.sh, rules-injector) were all global.
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

# =============================================================================
# The four core Claude hooks live in the TRACKED root claude.yaml, under the
# right event -- never only in gitignored claude.local.yaml (invariant (a)).
# =============================================================================
_CORE_HOOK_PAIRS="UserPromptSubmit:keyword-detector.sh
PreToolUse:pre-tool-enforcer.sh
SessionStart:session-start.sh
Stop:persistent-mode"

test_core_claude_hooks_registered_in_tracked_root_yaml() {
    local pair event component block failed=0
    while IFS= read -r pair; do
        event="${pair%%:*}"
        component="${pair#*:}"
        block=$(_extract_hook_event_block "$REPO_DIR/claude.yaml" "$event")
        if ! echo "$block" | grep -qF "component: $component"; then
            echo "ASSERTION FAILED: root claude.yaml must register $component under $event (tracked, not claude.local.yaml -- a gitignored registration is invisible to a fresh clone and to anyone reading the repo)"
            failed=1
        fi
    done <<EOF
$_CORE_HOOK_PAIRS
EOF
    [ "$failed" -eq 0 ]
}

# =============================================================================
# No projects/*/claude.yaml re-declares a core hook (invariant (b)): global
# registration lands in ~/.claude/settings.json and project registration in the
# target's .claude/settings.local.json, and Claude Code merges both -- so a
# hook in both scopes fires twice.
# =============================================================================
test_core_claude_hooks_not_duplicated_per_project() {
    local file pair component failed=0
    while IFS= read -r file; do
        [ -f "$file" ] || continue
        case "$file" in "$REPO_DIR/claude.yaml") continue ;; esac
        while IFS= read -r pair; do
            component="${pair#*:}"
            if grep -qF "component: $component" "$file"; then
                echo "ASSERTION FAILED: $file re-declares core hook $component already registered globally in root claude.yaml -- both scopes merge, so the hook would fire twice"
                failed=1
            fi
        done <<EOF
$_CORE_HOOK_PAIRS
EOF
    done < <(_all_claude_yaml_files)

    [ "$failed" -eq 0 ]
}

main() {
    echo "=========================================="
    echo "Hook Registration Consistency Tests"
    echo "=========================================="

    run_test test_session_start_and_write_guard_paired_across_targets
    run_test test_session_start_and_write_guard_pair_witnessed_at_least_once
    run_test test_precompact_removed_from_all_targets
    run_test test_codex_yaml_has_pretooluse_guard
    run_test test_core_claude_hooks_registered_in_tracked_root_yaml
    run_test test_core_claude_hooks_not_duplicated_per_project

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
}

main "$@"

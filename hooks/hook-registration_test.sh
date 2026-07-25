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

# =============================================================================
# codex.yaml registers codex-spawn-depth-gate.sh under PreToolUse with the
# full-match matcher ".*[sS]pawn_[aA]gent" -- Codex's PreToolUse matcher is a
# full-string regex match against the actual tool name
# "collaborationspawn_agent", so a bare "spawn_agent" (or "^spawn_agent$")
# never matches and the hook silently never fires. The case classes let the
# matcher through for a mixed-case variant (e.g. "CollaborationSpawn_Agent"),
# so the hook body's own tr-based lowercasing defense (codex-spawn-depth-
# gate.sh:84) becomes reachable instead of dead code below an unreachable
# gate.
# =============================================================================
test_codex_yaml_spawn_depth_gate_registered_with_full_match_matcher() {
    local block matcher_line
    block=$(_extract_hook_event_block "$REPO_DIR/codex.yaml" "PreToolUse")
    if ! echo "$block" | grep -qF 'component: codex-spawn-depth-gate.sh'; then
        echo "ASSERTION FAILED: codex.yaml PreToolUse must register codex-spawn-depth-gate.sh"
        return 1
    fi
    matcher_line=$(echo "$block" | grep -A2 'component: codex-spawn-depth-gate.sh' | grep 'matcher:')
    if ! echo "$matcher_line" | grep -qE 'matcher:[[:space:]]*"\.\*\[sS\]pawn_\[aA\]gent"'; then
        echo "ASSERTION FAILED: codex-spawn-depth-gate.sh matcher must be exactly \".*[sS]pawn_[aA]gent\" (got: ${matcher_line:-<none>}) -- Codex's PreToolUse matcher is a full-string regex match against the actual tool name \"collaborationspawn_agent\", so anything without the \".*\" prefix (e.g. bare \"spawn_agent\") never matches and the hook silently never fires"
        return 1
    fi
    return 0
}

# =============================================================================
# Regression guard: the matcher string must never regress to a value lacking
# the ".*" prefix -- Codex's PreToolUse matcher is full-match, not substring/
# prefix match, so any matcher missing the prefix (a bare "spawn_agent", or a
# case-class form like "[sS]pawn_[aA]gent" with no prefix) never matches the
# actual runtime tool name "collaborationspawn_agent" and the hook silently
# never fires. This is a categorical check on the ".*" prefix itself, not an
# enumeration of specific literal strings -- an enumeration that only listed
# bare "spawn_agent" would miss any other same-category instance (like the
# case-class form above) that also drops the prefix. A simple `grep -c
# 'spawn_agent'` would NOT catch this regression either, since
# ".*[sS]pawn_[aA]gent" also contains the substring "spawn_agent" -- this
# check isolates the matcher's line value specifically.
# =============================================================================
test_codex_yaml_spawn_depth_gate_matcher_never_bare() {
    local block matcher_line
    block=$(_extract_hook_event_block "$REPO_DIR/codex.yaml" "PreToolUse")
    matcher_line=$(echo "$block" | grep -A2 'component: codex-spawn-depth-gate.sh' | grep 'matcher:')
    if ! echo "$matcher_line" | grep -qE 'matcher:[[:space:]]*"\.\*'; then
        echo "ASSERTION FAILED: codex-spawn-depth-gate.sh matcher regressed to a value without the \".*\" prefix (got: ${matcher_line:-<none>}) -- Codex's PreToolUse matcher is a full-string regex match, and the actual tool name is \"collaborationspawn_agent\", so any matcher not starting with \".*\" (e.g. bare \"spawn_agent\" or a case-class form like \"[sS]pawn_[aA]gent\" without the prefix) never matches and the hook silently never fires"
        return 1
    fi
    return 0
}

# =============================================================================
# Combined dispatch-gate reachability. The matcher audits above and codex-
# spawn-depth-gate_test.sh's own row10 (test_row10_mixed_case_spawn_agent_
# denies, which pins the hook body's tr-based lowercasing defense) are each
# fixed in isolation -- neither ever evaluates the matcher against an actual
# tool-name string. So a matcher that silently stops covering row10's own
# fixture, or row10 drifting to a fixture the matcher no longer covers, both
# pass every existing suite green. This assertion extracts the EXACT tool
# name row10 feeds the hook and evaluates the codex.yaml matcher against it
# as a Codex-semantics full-match regex (anchored ^...$), plus against the
# measured runtime tool name "collaborationspawn_agent" (codex 0.145.0) --
# closing the gap the comment above (lines 236-241) only asserted in prose.
# =============================================================================

# Extracts the tool name codex-spawn-depth-gate_test.sh's
# test_row10_mixed_case_spawn_agent_denies feeds the hook, from that
# function's `local tool_name_value=` declaration. The function body is
# delimited by its header line and the next bare closing brace at column 0;
# this file's test_row* functions never nest braces in a body.
#
# Anchored on the DECLARATION, not on the `payload=` line that consumes it.
# A payload can be assembled any number of ways -- an inline literal, a jq
# `--arg`, a here-doc -- and a reader keyed to one of those shapes silently
# scores nothing on the others. That is not hypothetical: a dead
# inline-literal payload sitting above a live `--arg` payload was measured
# green on both suites while the hook's mixed-case defense was deleted,
# because the reader saw one literal and called it unambiguous. A single
# declaration has one shape, and the value it holds is the value row10
# hands the hook.
#
# Requires EXACTLY ONE declaration and prints nothing otherwise. The failure
# guarded against is grading the WRONG string, not finding no string, so zero
# and two-or-more are equally unusable and both must be loud. The caller MUST
# keep treating empty output as a hard failure, never a skip -- falling back
# to a hardcoded guess here would recreate the exact "two halves drift
# independently" defect this test exists to close.
_extract_row10_spawn_tool_name() {
    local file="${1:-$REPO_DIR/hooks/codex-spawn-depth-gate_test.sh}"
    local decls count value
    decls=$(awk '
        /^test_row10_mixed_case_spawn_agent_denies\(\)/ { infunc=1 }
        infunc && /^\}/ { exit }
        infunc && /^[[:space:]]*local[[:space:]]+tool_name_value=/ { print }
    ' "$file")
    count=$(printf '%s\n' "$decls" | grep -c 'tool_name_value=' || true)
    [ "$count" -eq 1 ] || return 0
    # The count above matches ANY assignment shape on purpose -- a second
    # declaration must be loud whatever it looks like. Extraction is narrower:
    # it needs the double-quoted form. A sed substitution that does not match
    # passes its input through UNCHANGED, so without the guard below an
    # unquoted declaration returns the whole source line as if it were the tool
    # name -- non-empty, so the caller's hard-fail never fires, and a matcher
    # starting with `.*` full-matches the leading junk and scores whatever
    # happens to end the line. That is the "found one, but it is the wrong
    # string" state this function's contract says must be silent-free.
    value=$(printf '%s\n' "$decls" | sed -E 's/^[[:space:]]*local[[:space:]]+tool_name_value="([^"]*)".*$/\1/')
    [ "$value" != "$decls" ] || return 0
    printf '%s\n' "$value"
}

test_codex_spawn_depth_gate_matcher_reaches_row10_and_runtime_tool_names() {
    local block matcher_line matcher row10_tool_name failed=0

    block=$(_extract_hook_event_block "$REPO_DIR/codex.yaml" "PreToolUse")
    matcher_line=$(echo "$block" | grep -A2 'component: codex-spawn-depth-gate.sh' | grep 'matcher:')
    matcher=$(echo "$matcher_line" | sed -E 's/^[[:space:]]*matcher:[[:space:]]*"(.*)"[[:space:]]*$/\1/')

    if [ -z "$matcher" ]; then
        echo "ASSERTION FAILED: could not extract the codex-spawn-depth-gate.sh matcher value from codex.yaml's PreToolUse block (matcher line: '${matcher_line:-<none>}')"
        return 1
    fi

    row10_tool_name=$(_extract_row10_spawn_tool_name)
    if [ -z "$row10_tool_name" ]; then
        echo "ASSERTION FAILED: could not read exactly one \`local tool_name_value=\` declaration from codex-spawn-depth-gate_test.sh's test_row10_mixed_case_spawn_agent_denies -- cannot verify the matcher actually reaches row10's own fixture"
        return 1
    fi

    # Whether that name genuinely pressures the hook's tr-based lowercasing
    # defense is asserted in row10 itself, against the live variable rather
    # than a value parsed back out of source. What can only be checked HERE is
    # the other gate: codex.yaml's matcher is a full-string regex, so a name
    # the hook body would handle correctly still never reaches it if the
    # dispatch matcher rejects the call first.
    if ! printf '%s\n' "$row10_tool_name" | grep -qE "^${matcher}\$"; then
        echo "ASSERTION FAILED: codex.yaml matcher \"$matcher\" does NOT full-match row10's own tool name \"$row10_tool_name\" (codex-spawn-depth-gate_test.sh:test_row10_mixed_case_spawn_agent_denies) -- the dispatch gate would reject this call before the hook body's tr-based lowercasing defense (codex-spawn-depth-gate.sh:84) is ever reached"
        failed=1
    fi

    if ! printf '%s\n' "collaborationspawn_agent" | grep -qE "^${matcher}\$"; then
        echo "ASSERTION FAILED: codex.yaml matcher \"$matcher\" does NOT full-match the measured runtime tool name \"collaborationspawn_agent\" (codex 0.145.0) -- the spawn-depth gate would never fire at all"
        failed=1
    fi

    [ "$failed" -eq 0 ]
}

# Pins _extract_row10_spawn_tool_name's own contract: exactly one
# double-quoted declaration yields the bare value, every other shape yields
# NOTHING so the caller's hard-fail fires. Fixture-driven because the real file
# only ever holds the one shape that works -- narrowing or widening the
# extractor there changes nothing observable, so the test above would stay green
# while the extractor silently started scoring the wrong string.
test_row10_tool_name_extractor_rejects_unextractable_declarations() {
    local tmp label want fixture got failed=0
    tmp=$(mktemp -d)

    # label|expected output|declaration line(s), "\n"-separated
    while IFS='|' read -r label want fixture; do
        [ -n "$label" ] || continue
        {
            echo 'test_row10_mixed_case_spawn_agent_denies() {'
            printf '%b\n' "$fixture"
            echo '}'
        } > "$tmp/fixture.sh"
        got=$(_extract_row10_spawn_tool_name "$tmp/fixture.sh")
        if [ "$got" != "$want" ]; then
            echo "ASSERTION FAILED extractor/$label: expected '$want', got '$got' -- a declaration shape this function cannot extract a value from must print nothing, so the caller treats it as a hard failure instead of scoring the source line itself"
            failed=1
        fi
    done <<'CASES'
double-quoted|CollaborationSpawn_Agent|    local tool_name_value="CollaborationSpawn_Agent"
unquoted||    local tool_name_value=CollaborationSpawn_Agent # collaborationspawn_agent
single-quoted||    local tool_name_value='CollaborationSpawn_Agent'
two-declarations||    local tool_name_value="A"\n    local tool_name_value="B"
no-declaration||    local unrelated_value="CollaborationSpawn_Agent"
CASES

    rm -rf "$tmp"
    return "$failed"
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
    run_test test_codex_yaml_spawn_depth_gate_registered_with_full_match_matcher
    run_test test_codex_yaml_spawn_depth_gate_matcher_never_bare
    run_test test_codex_spawn_depth_gate_matcher_reaches_row10_and_runtime_tool_names
    run_test test_row10_tool_name_extractor_rejects_unextractable_declarations

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
}

main "$@"

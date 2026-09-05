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
#   - The five core Claude hooks (keyword-detector.sh, pre-tool-enforcer.sh,
#     session-start.sh, orphan-reaper.sh, persistent-mode)
#     are registered in
#     the TRACKED root claude.yaml, and in NO projects/*/claude.yaml. Two
#     invariants the pairing check above cannot see:
#       (a) TRACKED, not claude.local.yaml. These five carry nothing
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
# Full-line comments (e.g. "# - component: orphan-reaper.sh") are stripped
# before returning -- otherwise a commented-out/disabled registration would
# satisfy a plain `grep -qF "component: X"` and pass vacuously (a real
# instance: a project claude.yaml documenting or intentionally disabling a
# registration in a comment would falsely count as "registered"). Every
# caller inherits this normalization; none should re-strip or re-match raw
# text from the file directly. `|| true` absorbs grep's exit 1 when the
# block is empty or entirely comments (e.g. an event the file doesn't use)
# -- under `set -euo pipefail` that exit would otherwise abort the whole
# script via the unguarded `block=$(...)` assignment at each call site.
_extract_hook_event_block() {
    local file="$1"
    local event="$2"
    awk -v event="  ${event}:" '
        $0 == event { infield=1; next }
        infield && /^  [A-Za-z]/ { infield=0 }
        infield { print }
    ' "$file" | grep -v '^[[:space:]]*#' || true
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

# Generic skill invocation tracking runs at prompt submission, while the
# frontmatter gate runs before shell tools. The marker must therefore be
# registered exactly once under UserPromptSubmit, and the gate exactly once
# under PreToolUse with the full set of Codex shell-tool aliases. The legacy
# explain-diff seed remains a prompt-only state seeder; registering it under
# PreToolUse would duplicate work and seed from arbitrary tool traffic.
test_codex_skill_invocation_hooks_registered_with_runtime_matcher() {
    local user_block pre_block marker_count seed_count gate_count gate_matcher gate_timeout
    user_block=$(_extract_hook_event_block "$REPO_DIR/codex.yaml" "UserPromptSubmit")
    pre_block=$(_extract_hook_event_block "$REPO_DIR/codex.yaml" "PreToolUse")

    marker_count=$(echo "$user_block" | grep -cF 'component: codex-skill-invocation-marker.sh' || true)
    seed_count=$(echo "$user_block" | grep -cF 'component: codex-explain-diff-seed.sh' || true)
    gate_count=$(echo "$pre_block" | grep -cF 'component: codex-skill-invocation-gate.sh' || true)
    [ "$marker_count" -eq 1 ] || { echo "ASSERTION FAILED: marker must be registered once under UserPromptSubmit"; return 1; }
    [ "$seed_count" -eq 1 ] || { echo "ASSERTION FAILED: explain-diff seed must remain registered once under UserPromptSubmit"; return 1; }
    [ "$gate_count" -eq 1 ] || { echo "ASSERTION FAILED: invocation gate must be registered once under PreToolUse"; return 1; }

    gate_matcher=$(echo "$pre_block" | grep -A2 'component: codex-skill-invocation-gate.sh' | grep 'matcher:' | sed -E 's/^[[:space:]]*matcher:[[:space:]]*"(.*)"[[:space:]]*$/\1/')
    gate_timeout=$(echo "$pre_block" | grep -A3 'component: codex-skill-invocation-gate.sh' | grep 'timeout:' | sed -E 's/.*timeout:[[:space:]]*([0-9]+).*/\1/')
    [ "$gate_matcher" = 'Bash|bash|exec_command|shell_command' ] || { echo "ASSERTION FAILED: invocation gate matcher must list all Codex shell aliases (got: ${gate_matcher:-<none>})"; return 1; }
    [ "$gate_timeout" = 10 ] || { echo "ASSERTION FAILED: invocation gate timeout must be 10 (got: ${gate_timeout:-<none>})"; return 1; }

    local tool
    for tool in Bash bash exec_command shell_command; do
        if ! printf '%s\n' "$tool" | grep -qE "^${gate_matcher}$"; then
            echo "ASSERTION FAILED: invocation gate matcher \"$gate_matcher\" must full-match runtime tool \"$tool\""
            return 1
        fi
    done
}

test_codex_explain_diff_seed_not_registered_under_pretooluse() {
    local pre_block count
    pre_block=$(_extract_hook_event_block "$REPO_DIR/codex.yaml" "PreToolUse")
    count=$(echo "$pre_block" | grep -cF 'component: codex-explain-diff-seed.sh' || true)
    [ "$count" -eq 0 ] || { echo "ASSERTION FAILED: explain-diff seed must not be registered under PreToolUse"; return 1; }
}

# =============================================================================
# The six core Claude hooks live in the TRACKED root claude.yaml, under the
# right event -- never only in gitignored claude.local.yaml (invariant (a)).
# =============================================================================
_CORE_HOOK_PAIRS="UserPromptSubmit:keyword-detector.sh
PreToolUse:pre-tool-enforcer.sh
SessionStart:session-start.sh
SessionStart:orphan-reaper.sh
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
# orphan-reaper.sh -- the second recovery trigger for the code-review
# 3-layer defense's layer 3 (job.ts reap, lib/generic-job.ts reapOrphanJobs).
# The first trigger is cmdStart (job start time); without this SessionStart
# registration, an orphaned job.json group is never swept unless someone
# re-runs a review, so this must land in the TRACKED root claude.yaml
# (invariant (a) above) exactly like the other four core hooks.
# =============================================================================
test_orphan_reaper_registered_in_tracked_root_yaml() {
    local block active_block timeout_line
    block=$(_extract_hook_event_block "$REPO_DIR/claude.yaml" "SessionStart")
    # Strip full-line comments before matching -- otherwise a commented-out
    # registration (e.g. "# - component: orphan-reaper.sh") would also satisfy
    # a plain grep -qF and pass vacuously.
    active_block=$(echo "$block" | grep -v '^[[:space:]]*#')
    if ! echo "$active_block" | grep -qF 'component: orphan-reaper.sh'; then
        echo "ASSERTION FAILED: root claude.yaml must register orphan-reaper.sh under SessionStart -- the second orphan-recovery trigger (the first is cmdStart at job-start time) would otherwise never fire"
        return 1
    fi

    # Pin the sibling "timeout:" key too, not just the component line -- a
    # missing or drifted timeout would still pass a component-only check.
    timeout_line=$(echo "$active_block" | grep -A1 'component: orphan-reaper.sh' | grep 'timeout:')
    if ! echo "$timeout_line" | grep -qE 'timeout:[[:space:]]*10$'; then
        echo "ASSERTION FAILED: orphan-reaper.sh's sibling 'timeout:' must be 10 (got: ${timeout_line:-<none>})"
        return 1
    fi
    return 0
}

# =============================================================================
# No projects/*/claude.yaml re-declares a core hook (invariant (b)): global
# registration lands in ~/.claude/settings.json and project registration in the
# target's .claude/settings.local.json, and Claude Code merges both -- so a
# hook in both scopes fires twice.
# =============================================================================
test_core_claude_hooks_not_duplicated_per_project() {
    local file pair event component block failed=0
    while IFS= read -r file; do
        [ -f "$file" ] || continue
        case "$file" in "$REPO_DIR/claude.yaml") continue ;; esac
        while IFS= read -r pair; do
            event="${pair%%:*}"
            component="${pair#*:}"
            # Scope the match to the pair's own event block (not the whole
            # file) and let _extract_hook_event_block strip comments -- a
            # matching component name under an unrelated event, or a
            # commented-out/disabled registration (e.g.
            # "# - component: orphan-reaper.sh" left as documentation), would
            # otherwise trip this assertion with no bypass available, blocking
            # `make validate`/`make sync` for a line that never runs twice.
            block=$(_extract_hook_event_block "$file" "$event")
            if echo "$block" | grep -qF "component: $component"; then
                echo "ASSERTION FAILED: $file re-declares core hook $component under $event already registered globally in root claude.yaml -- both scopes merge, so the hook would fire twice"
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
# Dispatch-gate reachability against the MEASURED runtime tool names. The
# audit above (test_codex_yaml_spawn_depth_gate_registered_with_full_match_
# matcher) pins the matcher's literal VALUE; this one pins its SEMANTICS --
# that whatever value is there full-matches both runtime tool names Codex
# has been observed to emit: "collaborationspawn_agent" (codex 0.145.0,
# under the reserved "collaboration" namespace) and "agentsspawn_agent"
# (codex 0.148.0, once codex.yaml deploys `tool_namespace: "agents"` to
# escape that reserved namespace for `expose_spawn_agent_model_overrides`).
# Both must full-match under Codex's anchored-regex rule, so the gate is not
# silently unreachable at runtime on either form.
#
# The complementary half -- that the matcher also reaches the fixture
# codex-spawn-depth-gate_test.sh's row10 sends -- is asserted in row10
# itself, against the bytes row10 actually piped to the hook. It
# deliberately does NOT live here; see the in-body comment below for why.
# =============================================================================

test_codex_spawn_depth_gate_matcher_reaches_runtime_tool_name() {
    local block matcher_line matcher

    block=$(_extract_hook_event_block "$REPO_DIR/codex.yaml" "PreToolUse")
    matcher_line=$(echo "$block" | grep -A2 'component: codex-spawn-depth-gate.sh' | grep 'matcher:')
    matcher=$(echo "$matcher_line" | sed -E 's/^[[:space:]]*matcher:[[:space:]]*"(.*)"[[:space:]]*$/\1/')

    if [ -z "$matcher" ]; then
        echo "ASSERTION FAILED: could not extract the codex-spawn-depth-gate.sh matcher value from codex.yaml's PreToolUse block (matcher line: '${matcher_line:-<none>}')"
        return 1
    fi

    # codex.yaml's matcher is a full-string regex applied by the dispatcher
    # before the hook body runs, so one that does not match the measured
    # runtime tool name leaves the gate silently never firing.
    #
    # Whether it also reaches the fixture codex-spawn-depth-gate_test.sh's
    # row10 sends is asserted in that row, against the bytes row10 actually
    # sent. Checking it here would mean parsing a declaration back out of that
    # file, and a declaration is not what the hook receives -- measured green
    # on both suites with row10 sending an ALL-CAPS name this matcher rejects
    # while the parsed declaration still said otherwise.
    if ! printf '%s\n' "collaborationspawn_agent" | grep -qE "^${matcher}\$"; then
        echo "ASSERTION FAILED: codex.yaml matcher \"$matcher\" does NOT full-match the measured runtime tool name \"collaborationspawn_agent\" (codex 0.145.0) -- the spawn-depth gate would never fire at all"
        return 1
    fi

    # codex.yaml now deploys `tool_namespace: "agents"` (see codex.yaml's
    # multi_agent_v2 block) to escape the reserved "collaboration" namespace
    # for `expose_spawn_agent_model_overrides`, which renames the emitted
    # tool from "collaborationspawn_agent" to "agentsspawn_agent". The
    # matcher must keep reaching this new runtime name too, or the gate goes
    # silently unreachable the moment that config key lands.
    if ! printf '%s\n' "agentsspawn_agent" | grep -qE "^${matcher}\$"; then
        echo "ASSERTION FAILED: codex.yaml matcher \"$matcher\" does NOT full-match the renamed runtime tool name \"agentsspawn_agent\" (codex 0.148.0, tool_namespace=\"agents\") -- the spawn-depth gate would never fire at all"
        return 1
    fi
}

test_codex_review_dispatch_gate_registered_and_reaches_namespaced_tool() {
    local block matcher_line matcher
    block=$(_extract_hook_event_block "$REPO_DIR/codex.yaml" "PreToolUse")
    if ! echo "$block" | grep -qF 'component: codex-review-dispatch-gate.sh'; then
        echo "ASSERTION FAILED: codex.yaml PreToolUse must register codex-review-dispatch-gate.sh"
        return 1
    fi
    matcher_line=$(echo "$block" | grep -A2 'component: codex-review-dispatch-gate.sh' | grep 'matcher:')
    if ! echo "$matcher_line" | grep -qE 'matcher:[[:space:]]*"\.\*\[sS\]pawn_\[aA\]gent"'; then
        echo "ASSERTION FAILED: codex-review-dispatch-gate.sh matcher must be exactly \".*[sS]pawn_[aA]gent\" (got: ${matcher_line:-<none>})"
        return 1
    fi
    matcher=$(echo "$matcher_line" | sed -E 's/^[[:space:]]*matcher:[[:space:]]*"(.*)"[[:space:]]*$/\1/')
    if ! printf '%s\n' "collaborationspawn_agent" | grep -qE "^${matcher}\$"; then
        echo "ASSERTION FAILED: review-dispatch matcher \"$matcher\" does not full-match collaborationspawn_agent"
        return 1
    fi

    # Same rename as the spawn-depth gate above: codex.yaml's
    # `tool_namespace: "agents"` moves the runtime tool name from
    # "collaborationspawn_agent" to "agentsspawn_agent". Lock that this
    # matcher still reaches it.
    if ! printf '%s\n' "agentsspawn_agent" | grep -qE "^${matcher}\$"; then
        echo "ASSERTION FAILED: review-dispatch matcher \"$matcher\" does not full-match agentsspawn_agent"
        return 1
    fi
}

test_codex_yaml_keeps_config_section_declared_so_stale_keys_can_be_cleared() {
    if ! grep -qE '^config:' "$REPO_DIR/codex.yaml"; then
        echo "ASSERTION FAILED: codex.yaml declares no top-level 'config:' key."
        echo "  Deleting that key is NOT the same as emptying it. syncPlatformYaml calls"
        echo "  syncConfig only when yaml.config is present (tools/adapters/codex.ts:715),"
        echo "  so with the key absent the deployed .codex/config.toml keeps whatever its"
        echo "  '# --- omt:config ---' block last received, on every subsequent sync."
        echo "  Measured: after agents.max_depth was deleted from codex.yaml, this machine's"
        echo "  ~/.codex/config.toml still held '[agents] max_depth = 2' -- so the key was"
        echo "  gone only on installs that had never synced it. Keep 'config: {}' declared;"
        echo "  insertManagedBlock replaces the block wholesale, so an empty mapping is what"
        echo "  actually clears it."
        return 1
    fi
}

# =============================================================================
# Every root PreToolUse registration must map one-to-one to a stable trace ID.
# Component entries derive the basename; raw command entries must carry an
# explicit safe `trace-id`. This keeps the execution trace identity stable
# without embedding machine-specific source paths in the registration.
# =============================================================================
_assert_pretooluse_trace_ids() {
    local file="$1"
    local platform="$2"
    local expected_ids="$3"
    local block records kind value trace id actual_ids expected count
    block=$(_extract_hook_event_block "$file" "PreToolUse")
        records=$(printf '%s\n' "$block" | awk '
            /^[[:space:]]*-[[:space:]]+(component|command):/ {
                if (seen) print kind "\t" value "\t" trace
                kind = index($0, "component:") ? "component" : "command"
                value = $0
                sub(/^[^:]+:[[:space:]]*/, "", value)
                sub(/[[:space:]]*$/, "", value)
                trace = ""
                seen = 1
                next
            }
            seen && /^[[:space:]]+trace-id:/ {
                trace = $0
                sub(/^[^:]+:[[:space:]]*/, "", trace)
                sub(/[[:space:]]*$/, "", trace)
            }
            END { if (seen) print kind "\t" value "\t" trace }
        ')
        actual_ids=""
        while IFS=$'\t' read -r kind value trace; do
            [ -n "$kind" ] || continue
            if [ "$kind" = component ]; then
                id=${value##*/}
                if [ -n "$trace" ]; then
                    echo "ASSERTION FAILED: $platform component entry '$value' must not declare trace-id '$trace'"
                    return 1
                fi
            else
                id=$trace
                id=${id#\"}
                id=${id%\"}
                if [ -z "$id" ]; then
                    echo "ASSERTION FAILED: $platform PreToolUse entry raw command '$value' requires an explicit trace-id (trace ID '<missing>')"
                    return 1
                fi
            fi
            if ! printf '%s\n' "$id" | grep -qE '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'; then
                echo "ASSERTION FAILED: $platform PreToolUse entry '$value' has unsafe trace ID '$id'"
                return 1
            fi
            if printf '%s\n' "$actual_ids" | grep -qFx "$id"; then
                echo "ASSERTION FAILED: $platform PreToolUse entry '$value' has duplicated trace ID '$id'"
                return 1
            fi
            actual_ids="${actual_ids}${id}"$'\n'
        done <<EOF
$records
EOF

        while IFS= read -r id; do
            [ -n "$id" ] || continue
            if ! printf '%s\n' "$expected_ids" | grep -qFx "$id"; then
                echo "ASSERTION FAILED: $platform PreToolUse entry has unexpected trace ID '$id' (entry ID '$id')"
                return 1
            fi
        done <<EOF
$actual_ids
EOF

        while IFS= read -r expected; do
            [ -n "$expected" ] || continue
            count=$(printf '%s\n' "$actual_ids" | grep -cFx "$expected" || true)
            if [ "$count" -ne 1 ]; then
                echo "ASSERTION FAILED: $platform PreToolUse entry mapping expected trace ID '$expected' exactly once, observed $count"
                return 1
            fi
        done <<EOF
$expected_ids
EOF
}

_claude_pretooluse_expected_ids="pre-tool-enforcer.sh
qa-driver-guard.sh
label-commit-gate.sh
explain-diff-artifact-guard.sh"

_codex_pretooluse_expected_ids="codex-qa-seed.sh
codex-skill-invocation-gate.sh
codex-explain-diff-artifact-guard.sh
codex-write-guard.sh
codex-qa-driver-guard.sh
codex-label-commit-gate.sh
codex.verify-entrypoint-gate
codex-spawn-depth-gate.sh
codex-review-dispatch-gate.sh"

test_root_pretooluse_trace_ids_are_one_to_one() {
    _assert_pretooluse_trace_ids "$REPO_DIR/claude.yaml" claude "$_claude_pretooluse_expected_ids" \
        || return 1
    _assert_pretooluse_trace_ids "$REPO_DIR/codex.yaml" codex "$_codex_pretooluse_expected_ids" \
        || return 1
}

test_root_pretooluse_trace_id_negative_fixtures() {
    local platform case_name output rc fixture_file expected_ids component_token
    fixture_root=$(mktemp -d "${TMPDIR:-/tmp}/hook-registration-fixtures.XXXXXX")
    trap 'rm -rf "$fixture_root"' RETURN

    for platform in claude codex; do
        fixture_file="$fixture_root/$platform.yaml"
        expected_ids="_${platform}_pretooluse_expected_ids"
        expected_ids=$(eval "printf '%s' \"\${$expected_ids}\"")
        component_token=$([ "$platform" = claude ] && printf '%s' 'qa-driver-guard.sh' || printf '%s' 'codex-write-guard.sh')
        for case_name in missing duplicate extra component; do
            cp "$REPO_DIR/$platform.yaml" "$fixture_file"
            case "$case_name" in
                missing)
                    if [ "$platform" = codex ]; then
                        sed '/trace-id: "codex\.verify-entrypoint-gate"/d' "$fixture_file" > "$fixture_root/next.yaml"
                    else
                        sed '/component: pre-tool-enforcer\.sh/d' "$fixture_file" > "$fixture_root/next.yaml"
                    fi
                    ;;
                duplicate)
                    if [ "$platform" = codex ]; then
                        sed 's/codex\.verify-entrypoint-gate/codex-write-guard.sh/' "$fixture_file" > "$fixture_root/next.yaml"
                    else
                        sed 's/component: qa-driver-guard\.sh/component: pre-tool-enforcer.sh/' "$fixture_file" > "$fixture_root/next.yaml"
                    fi
                    ;;
                extra)
                    if [ "$platform" = codex ]; then
                        sed 's/codex\.verify-entrypoint-gate/unexpected.trace-id/' "$fixture_file" > "$fixture_root/next.yaml"
                    else
                        sed 's/component: qa-driver-guard\.sh/component: unexpected-component.sh/' "$fixture_file" > "$fixture_root/next.yaml"
                    fi
                    ;;
                component)
                    awk -v token="$component_token" '
                        { print }
                        !done && $0 ~ ("component: " token "$") {
                            print "      trace-id: \"component-id\""
                            done=1
                        }
                    ' "$fixture_file" > "$fixture_root/next.yaml"
                    ;;
            esac
            mv "$fixture_root/next.yaml" "$fixture_file"
            set +e
            output=$(_assert_pretooluse_trace_ids "$fixture_file" "$platform" "$expected_ids" 2>&1)
            rc=$?
            set -e
            if [ "$rc" -eq 0 ]; then
                echo "ASSERTION FAILED: $platform negative fixture '$case_name' unexpectedly passed"
                return 1
            fi
            case "$case_name" in
                missing) printf '%s\n' "$output" | grep -qF "$platform PreToolUse entry" && printf '%s\n' "$output" | grep -qF "trace ID" ;;
                duplicate) printf '%s\n' "$output" | grep -qF "$platform PreToolUse entry" && printf '%s\n' "$output" | grep -qF "trace ID" ;;
                extra) printf '%s\n' "$output" | grep -qF "$platform PreToolUse entry" && printf '%s\n' "$output" | grep -qF "unexpected" ;;
                component) printf '%s\n' "$output" | grep -qF "$platform component entry" && printf '%s\n' "$output" | grep -qF "component-id" ;;
            esac || {
                echo "ASSERTION FAILED: $platform negative fixture '$case_name' did not name platform, entry, and ID: $output"
                return 1
            }
        done
        if [ "$platform" = codex ]; then
            cp "$REPO_DIR/codex.yaml" "$fixture_file"
            sed 's/codex\.verify-entrypoint-gate/unsafe trace-id/' "$fixture_file" > "$fixture_root/next.yaml"
            mv "$fixture_root/next.yaml" "$fixture_file"
            set +e
            output=$(_assert_pretooluse_trace_ids "$fixture_file" codex "$expected_ids" 2>&1)
            rc=$?
            set -e
            [ "$rc" -ne 0 ] && printf '%s\n' "$output" | grep -qF "unsafe trace ID 'unsafe trace-id'" || {
                echo "ASSERTION FAILED: codex negative fixture 'unsafe' did not name platform, entry, and ID: $output"
                return 1
            }
        fi
    done
}

main() {
    echo "=========================================="
    echo "Hook Registration Consistency Tests"
    echo "=========================================="

    run_test test_session_start_and_write_guard_paired_across_targets
    run_test test_session_start_and_write_guard_pair_witnessed_at_least_once
    run_test test_precompact_removed_from_all_targets
    run_test test_codex_yaml_has_pretooluse_guard
    run_test test_codex_skill_invocation_hooks_registered_with_runtime_matcher
    run_test test_codex_explain_diff_seed_not_registered_under_pretooluse
    run_test test_core_claude_hooks_registered_in_tracked_root_yaml
    run_test test_orphan_reaper_registered_in_tracked_root_yaml
    run_test test_core_claude_hooks_not_duplicated_per_project
    run_test test_codex_yaml_spawn_depth_gate_registered_with_full_match_matcher
    run_test test_codex_yaml_spawn_depth_gate_matcher_never_bare
    run_test test_codex_spawn_depth_gate_matcher_reaches_runtime_tool_name
    run_test test_codex_review_dispatch_gate_registered_and_reaches_namespaced_tool
    run_test test_codex_yaml_keeps_config_section_declared_so_stale_keys_can_be_cleared
    run_test test_root_pretooluse_trace_ids_are_one_to_one
    run_test test_root_pretooluse_trace_id_negative_fixtures

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
}

main "$@"

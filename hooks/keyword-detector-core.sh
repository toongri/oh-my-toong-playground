#!/bin/bash
# =============================================================================
# keyword-detector-core.sh
# Shared judgment core for the ultrawork/think/search/analyze keyword detector,
# sourced by both hooks/keyword-detector.sh (Claude) and hooks/codex-keyword-
# detector.sh (Codex). Owns ONLY platform-agnostic text classification and the
# additionalContext message bodies -- stdin JSON shape, prompt-field extraction,
# and the platform's hookSpecificOutput envelope stay in each shim (mirrors
# hooks/write-guard-core.sh's shim/core split: the shim owns parsing, the core
# owns the judgment).
#
# kd_core_strip_mode_tags: pipe filter, strips nested mode/system-reminder tags
# from a prompt before keyword matching (prevents nested activation loops).
#
# kd_core_is_<mode> <<< "$text": grep -qE classifiers, checked in priority
# order (ultrawork > think > search > analyze) by the caller -- exit status
# only, no output.
#
# kd_core_message_<mode>: prints the mode's additionalContext value ALREADY
# JSON-escaped (literal backslash-n / backslash-quote sequences, exactly as
# hand-written in the pre-extraction hooks/keyword-detector.sh literal -- not
# real newlines/quotes). A caller embeds the printed text verbatim into its
# own envelope via printf '%s' with NO further escaping and NO jq dependency
# -- this is a byte-exact substring copy of the original literal, not a
# round-tripped re-encoding (verified by hooks/keyword-detector-core_test.sh).
#
# Platform-vocabulary parameters (mirrors lib/persistent-mode-core/decision.ts's
# askToolName pattern: the core accepts the platform's own vocabulary as a
# parameter, defaulted to Claude's literal wording so every Claude caller can
# omit it and reproduce the pre-extraction byte-exact literal unchanged):
#   kd_core_message_ultrawork [task_name]   -- default "Task" (Claude's Task
#     tool). Codex has no Task-named tool (verified via `strings` on the codex
#     binary per tools/lib/rewrite-rules.ts rules 11a/11b) -- its callers pass
#     "spawn_agent", the real Codex dispatch primitive those rules rewrite
#     Task( calls to.
#   kd_core_message_search [tools_desc]     -- default "Grep, Glob"
#   kd_core_message_analyze [tools_desc]    -- default "Grep, Glob, LSP"
# Grep/Glob/LSP are Claude-native tool names with NO entry in
# tools/lib/rewrite-rules.ts's PLATFORM_REWRITE_RULES.codex table (unlike
# Task/Agent/subagent_type, which the table does map) -- following that
# table's own rule 7 precedent (WebFetch -> the capability noun "URL fetch"
# when no real Codex tool corresponds), Codex callers pass a capability-noun
# description instead of inventing a new table mapping here. `oracle` and
# `explore` are NOT parameterized: both are real cross-platform agent names
# deployed to Codex too (projects/oh-my-toong/sync.yaml agents section, no
# platforms: restriction -> config.yaml's `agents: [claude, codex]` default
# applies; confirmed present at ~/.codex/agents/oracle.toml and
# ~/.codex/agents/explore.toml), so that vocabulary is shared, not leaked.
# =============================================================================

kd_core_strip_mode_tags() {
  perl -0pe 's/<search-mode>.*?<\/search-mode>//gs' |
  perl -0pe 's/<analyze-mode>.*?<\/analyze-mode>//gs' |
  perl -0pe 's/<think-mode>.*?<\/think-mode>//gs' |
  perl -0pe 's/<ultrawork-mode>.*?<\/ultrawork-mode>//gs' |
  perl -0pe 's/<deep-interview-continuation>.*?<\/deep-interview-continuation>//gs' |
  perl -0pe 's/<system-reminder>.*?<\/system-reminder>//gs'
}

kd_core_is_ultrawork() {
  grep -qE '\b(ultrawork|ulw)\b'
}

kd_core_is_think() {
  grep -qE '\b(ultrathink|think)\b'
}

kd_core_is_search() {
  grep -qE '\b(search|find|locate|lookup|explore|discover|scan|grep|query|browse|detect|trace|seek|track|pinpoint|hunt)\b|where\s+is|show\s+me|list\s+all'
}

kd_core_is_analyze() {
  grep -qE '\b(analyze|analyse|investigate|examine|research|study|deep.?dive|inspect|audit|evaluate|assess|review|diagnose|scrutinize|dissect|debug|comprehend|interpret|breakdown|understand)\b|why\s+is|how\s+does|how\s+to'
}

kd_core_message_ultrawork() {
  # NOTE: piped through sed, NOT captured via body=$(cat <<'EOF' ... EOF) --
  # this heredoc's literal body has an odd count of embedded apostrophes
  # ("I couldn't", "Here's", "I'll", "USER'S"), and bash 3.2 (macOS default,
  # this repo's compatibility floor) mis-parses a quoted heredoc with an odd
  # single-quote count when it sits inside a $(...) command substitution --
  # "unexpected EOF while looking for matching `''" at runtime, not just
  # -n. Piping the heredoc's own stdout through sed sidesteps the bug: the
  # $(...) capture happens at the CALLER's site (emit_claude_mode /
  # emit_codex_mode), one level up, exactly as it did before this function
  # took a parameter.
  local task_name="${1:-Task}"
  cat <<'KD_CORE_EOF' | sed "s/__TASK_NAME__/${task_name}/g"
<ultrawork-mode>\n\n**MANDATORY**: You MUST say \"ULTRAWORK MODE ENABLED!\" to the user as your first response when this mode activates. This is non-negotiable.\n\n[CODE RED] Maximum precision required. Ultrathink before acting.\n\nYOU MUST LEVERAGE ALL AVAILABLE AGENTS TO THEIR FULLEST POTENTIAL.\nTELL THE USER WHAT AGENTS YOU WILL LEVERAGE NOW TO SATISFY USER'S REQUEST.\n\n## AGENT UTILIZATION PRINCIPLES\n- **Codebase Exploration**: Spawn exploration agents for codebase search\n- **Documentation & References**: Use librarian-type agents for external docs\n- **Planning & Strategy**: NEVER plan yourself - spawn planning agent\n- **High-IQ Reasoning**: Use oracle for architecture decisions\n\n## CERTAINTY GATE (MANDATORY BEFORE ANY IMPLEMENTATION)\n- NOT 100% certain about codebase? → spawn explore agent FIRST\n- NOT 100% certain about architecture? → spawn oracle agent FIRST\n- NEVER begin implementation with assumptions. Assumptions = bugs.\n\n## EXECUTION RULES\n- **TODO**: Track EVERY step. Mark complete IMMEDIATELY.\n- **PARALLEL**: Fire independent __TASK_NAME__ calls simultaneously in ONE message - maximize parallelism.\n- **DELEGATE**: Orchestrate specialized agents aggressively. Never solo complex work.\n- **VERIFY**: Check ALL requirements met before done.\n\n## ZERO TOLERANCE\n- NO Scope Reduction - deliver FULL implementation\n- NO Partial Completion - finish 100%\n- NO Premature Stopping - ALL TODOs must be complete\n- NO TEST DELETION - fix code, not tests\n\n## BLOCKED EXCUSES (catch yourself saying these → STOP and FIX)\n| Excuse Pattern | Required Action |\n|----------------|------------------|\n| \"I couldn't find/access...\" | Spawn explore agent, try harder |\n| \"Here's a simplified version...\" | Deliver the FULL version |\n| \"This should work but I can't verify...\" | Run the verification yourself: execute the checks and capture evidence |\n| \"I'll leave this for the user to...\" | YOU complete it |\n| \"Due to complexity, I only...\" | Continue until 100% done |\n\nTHE USER ASKED FOR X. DELIVER EXACTLY X.\n\n</ultrawork-mode>\n\n---\n
KD_CORE_EOF
}

kd_core_message_think() {
  cat <<'KD_CORE_EOF'
<think-mode>\n\n**ULTRATHINK MODE ENABLED** - Extended reasoning activated.\n\nYou are now in deep thinking mode. Take your time to:\n1. Thoroughly analyze the problem from multiple angles\n2. Consider edge cases and potential issues\n3. Think through the implications of each approach\n4. Reason step-by-step before acting\n\nUse your extended thinking capabilities to provide the most thorough and well-reasoned response.\n\n</think-mode>\n\n---\n
KD_CORE_EOF
}

kd_core_message_search() {
  # Piped through sed, not captured via $(...) -- see kd_core_message_ultrawork's
  # comment for the bash 3.2 heredoc-in-command-substitution bug this avoids.
  local tools_desc="${1:-Grep, Glob}"
  cat <<'KD_CORE_EOF' | sed "s/__TOOLS_DESC__/${tools_desc}/g"
<search-mode>\nMAXIMIZE SEARCH EFFORT. Launch multiple agents IN PARALLEL:\n- explore agents (codebase patterns, file structures)\n- librarian agents (remote repos, official docs, GitHub examples)\nPlus direct tools: __TOOLS_DESC__\nNEVER stop at first result - be exhaustive.\n</search-mode>\n\n---\n
KD_CORE_EOF
}

kd_core_message_analyze() {
  # Piped through sed, not captured via $(...) -- see kd_core_message_ultrawork's
  # comment for the bash 3.2 heredoc-in-command-substitution bug this avoids.
  local tools_desc="${1:-Grep, Glob, LSP}"
  cat <<'KD_CORE_EOF' | sed "s/__TOOLS_DESC__/${tools_desc}/g"
<analyze-mode>\nANALYSIS MODE. Gather context before diving deep:\n\nCONTEXT GATHERING (parallel):\n- 1-2 explore agents (codebase patterns, implementations)\n- 1-2 librarian agents (if external library involved)\n- Direct tools: __TOOLS_DESC__ for targeted searches\n\nIF COMPLEX (architecture, multi-system, debugging after 2+ failures):\n- Consult oracle agent for strategic guidance\n\nSYNTHESIZE findings before proceeding.\n</analyze-mode>\n\n---\n
KD_CORE_EOF
}


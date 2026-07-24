#!/bin/bash
# =============================================================================
# codex-keyword-detector.sh
# Codex UserPromptSubmit keyword detector (Claude<->Codex hook-parity plan).
#
# Thin shim: reads Codex's UserPromptSubmit stdin shape ({session_id,
# turn_id, transcript_path, cwd, hook_event_name, model, permission_mode,
# prompt} -- see hooks/rules-injector/codex-hook.ts's
# CodexUserPromptSubmitInput, the confirmed real Codex payload shape), strips
# mode tags + code blocks from the prompt, classifies it via the shared
# core (hooks/keyword-detector-core.sh -- the SAME classification regexes
# and additionalContext message bodies hooks/keyword-detector.sh (Claude)
# uses; zero duplicated judgment logic), and emits Codex's UserPromptSubmit
# envelope: {"hookSpecificOutput": {"hookEventName": "UserPromptSubmit",
# "additionalContext": ...}} -- no `continue` key (Codex-only contract,
# mirrors hooks/rules-injector/hook-output.ts's formatAdditionalContextOutput
# and hooks/codex-ledger.sh's continue-strip of the same shared-core output).
#
# No jq dependency for message emission: keyword-detector-core.sh's
# kd_core_message_* functions print an ALREADY JSON-escaped value, so this
# shim only needs jq to read `.prompt` out of stdin (fail-open: absent jq ->
# exit 0, same policy as hooks/codex-write-guard.sh).
#
# Platform vocabulary: this shim is the Codex caller of the core's
# askToolName-style platform-vocabulary parameters (see
# keyword-detector-core.sh's header comment) -- it passes Codex's own
# wording for the Claude-only literals the core defaults to (Task, Grep,
# Glob, LSP). `oracle`/`explore` are NOT among these: both are real
# cross-platform agent names deployed to Codex too (config.yaml's
# `agents: [claude, codex]`, projects/oh-my-toong/sync.yaml's unrestricted
# agents entries -- confirmed present at ~/.codex/agents/oracle.toml and
# ~/.codex/agents/explore.toml), so the core's default wording for them is
# passed through unchanged on both platforms.
#
# omt-hook-dep: keyword-detector-core.sh
# =============================================================================

# Codex's real subagent-dispatch primitive (tools/lib/rewrite-rules.ts rules
# 11a "Task (" -> "spawn_agent(" and 11b "Task tool" -> "spawn_agent tool" --
# those rules already cover Task's call-form and "the Task tool" prose; this
# is the same target applied to the one remaining prose form neither rule's
# regex matches, "Task calls").
CODEX_KD_TASK_NAME="spawn_agent"

# Grep/Glob/LSP are Claude-native tool names with no entry in
# tools/lib/rewrite-rules.ts's PLATFORM_REWRITE_RULES.codex table. Following
# that table's own rule 7 precedent (WebFetch -> the capability noun
# "URL fetch" when no real Codex tool corresponds), these are capability
# nouns, not invented tool names.
CODEX_KD_SEARCH_TOOLS="content search, file globbing"
CODEX_KD_ANALYZE_TOOLS="content search, file globbing, code navigation"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/keyword-detector-core.sh"

if ! command -v jq > /dev/null 2>&1; then
  exit 0
fi

INPUT=$(cat)

PROMPT=$(printf '%s' "$INPUT" | jq -r '.prompt // empty' 2>/dev/null)

if [ -z "$PROMPT" ]; then
  exit 0
fi

# Remove code blocks AND nested mode tags before checking keywords (same
# pipeline as the Claude shim).
PROMPT_NO_CODE=$(printf '%s' "$PROMPT" | kd_core_strip_mode_tags | tr '\n' '\r' | sed 's/```[^`]*```//g' | sed 's/`[^`]*`//g' | tr '\r' '\n')
PROMPT_LOWER=$(printf '%s' "$PROMPT_NO_CODE" | tr '[:upper:]' '[:lower:]')

# Emits a Codex UserPromptSubmit envelope wrapping the given core message
# function's additionalContext value (already JSON-escaped -- plain printf,
# no jq, no re-escaping). Extra args after msg_fn forward to it as the
# core's platform-vocabulary parameters (see keyword-detector-core.sh).
emit_codex_mode() {
  local msg_fn="$1"
  shift
  printf '{"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": "%s"}}\n' "$("$msg_fn" "$@")"
}

if printf '%s' "$PROMPT_LOWER" | kd_core_is_ultrawork; then
  emit_codex_mode kd_core_message_ultrawork "$CODEX_KD_TASK_NAME"
  exit 0
fi

if printf '%s' "$PROMPT_LOWER" | kd_core_is_think; then
  emit_codex_mode kd_core_message_think
  exit 0
fi

if printf '%s' "$PROMPT_LOWER" | kd_core_is_search; then
  emit_codex_mode kd_core_message_search "$CODEX_KD_SEARCH_TOOLS"
  exit 0
fi

if printf '%s' "$PROMPT_LOWER" | kd_core_is_analyze; then
  emit_codex_mode kd_core_message_analyze "$CODEX_KD_ANALYZE_TOOLS"
  exit 0
fi

exit 0

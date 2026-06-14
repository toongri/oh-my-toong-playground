#!/bin/bash
# =============================================================================
# OMT PreCompact Producer Hook
#
# On a Claude Code compaction (manual or auto), extract the conversation arc
# from the soon-to-be-discarded transcript, summarize it into an 8-section
# continuation handoff (codex first, claude-sonnet-4-6 fallback), and atomically
# write it to $OMT_DIR/handoff-{sid}.md for the next SessionStart(compact) to
# inject.
#
# Invariants:
#   - NEVER interrupts compaction: this hook only ever exits 0 and never emits a
#     deny decision, so compaction always proceeds.
#   - Fail-open: any failure (no transcript, both summarizers fail, no jq) writes
#     no file and exits 0; the native compaction summary + OMT state-restore stand.
#   - Recursion-safe: an OMT_HANDOFF_ACTIVE sentinel short-circuits a nested fire
#     before any summarizer is spawned.
#   - Replace semantics: a re-run overwrites the handoff (atomic mktemp + mv).
# =============================================================================
set -euo pipefail

# Pinned constants (see plan "Pinned Constants").
HANDOFF_TOOL_OUTPUT_MAX_CHARS=2000
HANDOFF_MIN_INPUT_CHARS=200
SUMMARIZER_TIMEOUT_SECS=120

# --- Recursion guard FIRST, before any work or summarizer spawn. -------------
if [ -n "${OMT_HANDOFF_ACTIVE:-}" ]; then
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- Read + parse the PreCompact stdin payload. ------------------------------
INPUT=$(cat)

SID="default"
TRANSCRIPT_PATH=""
if command -v jq >/dev/null 2>&1; then
  SID=$(printf '%s' "$INPUT" | jq -r '.session_id // .sessionId // ""' 2>/dev/null)
  TRANSCRIPT_PATH=$(printf '%s' "$INPUT" | jq -r '.transcript_path // ""' 2>/dev/null)
else
  # No jq → extraction is impossible (jq-only, per D-11); fail-open.
  exit 0
fi

# Empty/null session id → "default".
if [ -z "$SID" ] || [ "$SID" = "null" ]; then
  SID="default"
fi

if [ -z "$TRANSCRIPT_PATH" ] || [ "$TRANSCRIPT_PATH" = "null" ]; then
  TRANSCRIPT_PATH=""
fi

# --- Resolve OMT_DIR (no-op if already exported; else derive from cwd). -------
# shellcheck source=hooks/lib/omt-dir.sh
source "$SCRIPT_DIR/lib/omt-dir.sh"
if [ -z "${OMT_DIR:-}" ]; then
  resolve_omt_dir "$(pwd)" >/dev/null
fi
# compute_omt_dir / resolve_omt_dir both mkdir -p the directory; ensure it.
mkdir -p "$OMT_DIR" 2>/dev/null || true

# --- Conversation-arc extraction (jq, omo-faithful, D-11). -------------------
# Keep only user/assistant message records; emit role-tagged turns:
#   - user content STRING (the arc-head first turn)
#   - user/assistant text, assistant thinking, tool_use input, tool_result output
# Each tool input/output is truncated to HANDOFF_TOOL_OUTPUT_MAX_CHARS.
# Machinery records (attachment, file-history-snapshot, mode, permission*,
# last-prompt, and any non-message type) carry no .message and are dropped.
EXTRACT=""
if [ -n "$TRANSCRIPT_PATH" ] && [ -f "$TRANSCRIPT_PATH" ] && [ -r "$TRANSCRIPT_PATH" ]; then
  EXTRACT=$(jq -r '
    select(.type == "user" or .type == "assistant")
    | .type as $role
    | (.message.content) as $c
    | if ($c | type) == "string" then
        ("[" + $role + "] " + ($c[0:'"$HANDOFF_TOOL_OUTPUT_MAX_CHARS"']))
      else
        ( $c[]?
          | if .type == "text" then "[" + $role + " text] " + (.text // "")
            elif .type == "thinking" then "[thinking] " + (.thinking // "")
            elif .type == "tool_use" then "[tool_use " + (.name // "") + "] " + ((.input | tojson)[0:'"$HANDOFF_TOOL_OUTPUT_MAX_CHARS"'])
            elif .type == "tool_result" then "[tool_result] " + ((if (.content | type) == "string" then .content else (.content | tojson) end)[0:'"$HANDOFF_TOOL_OUTPUT_MAX_CHARS"'])
            else empty
          end
        )
      end
  ' "$TRANSCRIPT_PATH" 2>/dev/null) || EXTRACT=""
fi

# --- Min-input skip (covers missing / unreadable / empty / too-short). -------
if [ "${#EXTRACT}" -lt "$HANDOFF_MIN_INPUT_CHARS" ]; then
  exit 0
fi

# --- Inline 8-section summarizer prompt (D-7; verbatim omo body). -------------
PROMPT="When summarizing this session, keep the result compact and continuation-focused. Prefer terse bullets over replaying the transcript.

## 1. User Requests
- Summarize the latest unresolved user requests and any earlier request still affecting the work
- Quote exact wording only when a later agent needs the literal phrase

## 2. Final Goal
- What the user ultimately wanted to achieve
- The end result or deliverable expected

## 3. Work Completed
- What has been done so far
- Files created/modified
- Validation already run and its result

## 4. Remaining Tasks
- What still needs to be done
- Pending items from the original request
- Known blockers or risks

## 5. Active Working Context (For Seamless Continuation)
- **Files**: Paths of files currently being edited or frequently referenced
- **Code in Progress**: Function names, data structures, or decisions under active development
- **External References**: Only URLs or docs that are still needed
- **State & Variables**: Important variable names, configuration values, or runtime state relevant to ongoing work

## 6. Explicit Constraints (Verbatim Only)
- Include ONLY active constraints explicitly stated by the user or existing project context
- Quote constraints verbatim when quoting a constraint
- Do NOT invent, add, or modify constraints
- Do not paste full policy blocks; cite the source path/name and quote only decisive clauses
- If no explicit constraints exist, write \"None\"

## 7. Agent Verification State (Critical for Reviewers)
- **Current Agent**: What agent is running (momus, oracle, etc.)
- **Verification Progress**: Files already verified/validated
- **Pending Verifications**: Files still needing verification
- **Previous Rejections**: If reviewer agent, what was rejected and why
- **Acceptance Status**: Current state of review process

## 8. Delegated Agent Sessions
- List active/recent background agent tasks that still matter
- For each: agent name, category, status, short description, and task_id
- **RESUME, DON'T RESTART.** Each listed delegated task retains full context. After compaction, use task_id to continue existing delegated work instead of spawning new tasks.

=== CONVERSATION ===
$EXTRACT"

# --- Mark active before spawning summarizers (recursion safety). --------------
export OMT_HANDOFF_ACTIVE=1

SUMMARY=""

# --- codex primary. ----------------------------------------------------------
CODEX_OUT=$(mktemp "$OMT_DIR/.handoff-codex.XXXXXX")
codex_rc=0
perl -e 'alarm shift; exec @ARGV' "$SUMMARIZER_TIMEOUT_SECS" \
  codex exec --skip-git-repo-check -s read-only \
  -c model_reasoning_effort="low" --ignore-user-config \
  -o "$CODEX_OUT" <<<"$PROMPT" >/dev/null 2>&1 || codex_rc=$?
if [ "$codex_rc" -eq 0 ] && [ -s "$CODEX_OUT" ]; then
  SUMMARY=$(cat "$CODEX_OUT")
fi
rm -f "$CODEX_OUT" 2>/dev/null || true

# --- sonnet fallback (only if codex was not accepted). -----------------------
if [ -z "$SUMMARY" ]; then
  claude_rc=0
  CLAUDE_RAW=$(perl -e 'alarm shift; exec @ARGV' "$SUMMARIZER_TIMEOUT_SECS" \
    env NO_COLOR=1 TERM=dumb FORCE_COLOR=0 CLAUDECODE='' \
    claude -p --output-format json --model claude-sonnet-4-6 --strict-mcp-config \
    <<<"$PROMPT" 2>/dev/null) || claude_rc=$?
  if [ "$claude_rc" -eq 0 ] && [ -n "$CLAUDE_RAW" ]; then
    CLAUDE_RESULT=$(printf '%s' "$CLAUDE_RAW" | head -n 1 | jq -r '.result // ""' 2>/dev/null) || CLAUDE_RESULT=""
    if [ -n "$CLAUDE_RESULT" ]; then
      SUMMARY="$CLAUDE_RESULT"
    fi
  fi
fi

# --- Neither summarizer accepted → fail-open, no file. -----------------------
if [ -z "$SUMMARY" ]; then
  exit 0
fi

# --- Atomic write (mktemp inside OMT_DIR + mv → replace semantics). -----------
TMP=$(mktemp "$OMT_DIR/.handoff.XXXXXX")
printf '%s' "$SUMMARY" > "$TMP"
mv "$TMP" "$OMT_DIR/handoff-$SID.md"

exit 0

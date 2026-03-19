#!/bin/bash
# Sisyphus Keyword Detector Hook
# Detects ultrawork/ultrathink/search/analyze keywords and injects enhanced mode messages

# Read stdin (JSON input from Claude Code)
INPUT=$(cat)

# Extract session ID and directory from input
SESSION_ID=""
DIRECTORY=""
if command -v jq &> /dev/null; then
  SESSION_ID=$(echo "$INPUT" | jq -r '.sessionId // .session_id // ""' 2>/dev/null)
  DIRECTORY=$(echo "$INPUT" | jq -r '.cwd // ""' 2>/dev/null)
fi
if [ -z "$DIRECTORY" ] || [ "$DIRECTORY" = "null" ]; then
  DIRECTORY=$(pwd)
fi
# Use "default" as fallback when no session ID provided
if [ -z "$SESSION_ID" ] || [ "$SESSION_ID" = "null" ]; then
  SESSION_ID="default"
fi

# Find project root by looking for markers and escaping .omt if inside
get_project_root() {
  local dir="$1"

  # Strip .omt suffix if present (prevents nesting)
  dir="${dir%/.omt}"
  dir="${dir%/.claude}"

  # Look for project root markers
  while [ "$dir" != "/" ] && [ "$dir" != "." ] && [ -n "$dir" ]; do
    if [ -d "$dir/.git" ] || [ -f "$dir/CLAUDE.md" ] || [ -f "$dir/package.json" ]; then
      echo "$dir"
      return 0
    fi
    dir=$(dirname "$dir")
  done

  # Fallback: return the stripped directory
  local _fallback="${1%/.omt}"
  _fallback="${_fallback%/.claude}"
  echo "$_fallback"
}

# Get project root
PROJECT_ROOT=$(get_project_root "$DIRECTORY")

# Compute OMT_DIR if not already set by session-start.sh
if [ -z "$OMT_DIR" ]; then
  _omt_git_common=$(git -C "$PROJECT_ROOT" rev-parse --git-common-dir 2>/dev/null)
  _omt_pname=""
  if [ -n "$_omt_git_common" ] && [ "$_omt_git_common" != ".git" ]; then
    _omt_pname=$(basename "$(dirname "$_omt_git_common")")
  else
    _omt_pname=$(basename "$PROJECT_ROOT")
  fi
  OMT_DIR="$HOME/.omt/${_omt_pname// /-}"
  mkdir -p "$OMT_DIR"
fi

# Extract the prompt text - try multiple JSON paths
PROMPT=""
if command -v jq &> /dev/null; then
  PROMPT=$(echo "$INPUT" | jq -r '
    if .prompt then .prompt
    elif .message.content then .message.content
    elif .parts then ([.parts[] | select(.type == "text") | .text] | join(" "))
    else ""
    end
  ' 2>/dev/null)
fi

# Fallback: simple grep extraction if jq fails
if [ -z "$PROMPT" ] || [ "$PROMPT" = "null" ]; then
  PROMPT=$(echo "$INPUT" | perl -ne 'print "$2\n" while /"(prompt|content|text)"\s*:\s*"([^"]*)"/' | head -1)
fi

# Exit if no prompt found
if [ -z "$PROMPT" ]; then
  echo '{"continue": true}'
  exit 0
fi

# Strip all mode tags to prevent nested activation loops
strip_mode_tags() {
  perl -0pe 's/<ralph-loop-continuation>.*?<\/ralph-loop-continuation>//gs' |
  perl -0pe 's/<ralph-mode>.*?<\/ralph-mode>//gs' |
  perl -0pe 's/<search-mode>.*?<\/search-mode>//gs' |
  perl -0pe 's/<analyze-mode>.*?<\/analyze-mode>//gs' |
  perl -0pe 's/<think-mode>.*?<\/think-mode>//gs' |
  perl -0pe 's/<ultrawork-mode>.*?<\/ultrawork-mode>//gs' |
  perl -0pe 's/<system-reminder>.*?<\/system-reminder>//gs'
}

# Remove code blocks AND hook output tags before checking keywords
PROMPT_NO_CODE=$(echo "$PROMPT" | strip_mode_tags | tr '\n' '\r' | sed 's/```[^`]*```//g' | sed 's/`[^`]*`//g' | tr '\r' '\n')

# Remove hook output tags and system reminders from cleaned prompt
PROMPT_CLEAN=$(echo "$PROMPT" | strip_mode_tags | sed 's/  */ /g' | sed 's/^ *//;s/ *$//')

# Extract file paths from non-text parts (e.g., @file mentions)
FILE_PATHS=""
if command -v jq &> /dev/null; then
  FILE_PATHS=$(echo "$INPUT" | jq -r '
    [(.parts // [])[] | select(.type != "text") | .file_path // .path // empty] | join(", ")
  ' 2>/dev/null)
fi

# Append file references to cleaned prompt
if [ -n "$FILE_PATHS" ] && [ "$FILE_PATHS" != "null" ]; then
  PROMPT_CLEAN="${PROMPT_CLEAN} [referenced files: ${FILE_PATHS}]"
fi

# Convert to lowercase
PROMPT_LOWER=$(echo "$PROMPT_NO_CODE" | tr '[:upper:]' '[:lower:]')

RALPH_STATE_PROMPT_MAX=2000
RALPH_CONTEXT_PROMPT_MAX=2000

truncate_prompt_text() {
  local text="$1"
  local max_chars="$2"
  local normalized
  normalized=$(printf '%s' "$text" | tr '\n' ' ' | sed 's/[[:space:]][[:space:]]*/ /g; s/^ *//; s/ *$//')
  local text_len=${#normalized}

  if [ "$text_len" -le "$max_chars" ]; then
    printf '%s' "$normalized"
    return 0
  fi

  local truncated="${normalized:0:$max_chars}"
  printf '%s...[truncated from %s chars]' "$truncated" "$text_len"
}

# Function to create ralph state file
# Uses SESSION_ID for session-specific file naming
create_ralph_state() {
  local prompt="$1"
  local timestamp=$(date -Iseconds 2>/dev/null || date +"%Y-%m-%dT%H:%M:%S")

  if command -v jq &> /dev/null; then
    jq -n \
      --arg prompt "$prompt" \
      --arg started_at "$timestamp" \
      '{
        active: true,
        iteration: 0,
        max_iterations: 10,
        completion_promise: "DONE",
        prompt: $prompt,
        started_at: $started_at
      }' > "$OMT_DIR/ralph-state-${SESSION_ID}.json" 2>/dev/null
  else
    # Fallback: basic escaping when jq is unavailable
    local escaped_prompt=$(printf '%s' "$prompt" | sed 's/\\/\\\\/g; s/"/\\"/g; s/	/\\t/g' | tr '\n' ' ')
    cat > "$OMT_DIR/ralph-state-${SESSION_ID}.json" 2>/dev/null << RALPH_STATE_EOF
{
  "active": true,
  "iteration": 0,
  "max_iterations": 10,
  "completion_promise": "DONE",
  "prompt": "$escaped_prompt",
  "started_at": "$timestamp"
}
RALPH_STATE_EOF
  fi
}

# Check for ralph keyword (highest priority) - ralph loop activation
if echo "$PROMPT_LOWER" | grep -qE '\bralph\b'; then
  RALPH_STATE_PROMPT=$(truncate_prompt_text "$PROMPT_CLEAN" "$RALPH_STATE_PROMPT_MAX")
  RALPH_CONTEXT_PROMPT=$(truncate_prompt_text "$PROMPT_CLEAN" "$RALPH_CONTEXT_PROMPT_MAX")

  # Create ralph state file
  create_ralph_state "$RALPH_STATE_PROMPT"

  # Build ralph activation JSON safely using jq --arg to escape prompt
  if command -v jq &> /dev/null; then
    RALPH_CONTEXT="<ralph-mode>\n**RALPH LOOP ACTIVATED**\n\nYou are in Ralph Loop mode.\n\n## CORE RULES\n1. Work until ALL requirements are truly done — not just technically complete\n2. Track progress with tasks\n3. Make meaningful progress toward the goal each cycle\n4. If stuck, try different approaches rather than repeating what failed\n5. You MUST output \`<promise>DONE</promise>\` when ALL tasks are complete\n\nOriginal task: "
    RALPH_SUFFIX="\n</ralph-mode>\n\n---\n"

    jq -n \
      --arg prefix "$RALPH_CONTEXT" \
      --arg prompt "$RALPH_CONTEXT_PROMPT" \
      --arg suffix "$RALPH_SUFFIX" \
      '{
        continue: true,
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: ($prefix + $prompt + $suffix)
        }
      }'
  else
    # Fallback: basic escaping when jq is unavailable
    escaped_prompt=$(printf '%s' "$RALPH_CONTEXT_PROMPT" | sed 's/\\/\\\\/g; s/"/\\"/g; s/	/\\t/g' | tr '\n' ' ')
    echo "{\"continue\": true, \"hookSpecificOutput\": {\"hookEventName\": \"UserPromptSubmit\", \"additionalContext\": \"<ralph-mode>\\n**RALPH LOOP ACTIVATED**\\n\\nYou are in Ralph Loop mode.\\n\\n## CORE RULES\\n1. Work until ALL requirements are truly done — not just technically complete\\n2. Track progress with tasks\\n3. Make meaningful progress toward the goal each cycle\\n4. If stuck, try different approaches rather than repeating what failed\\n5. You MUST output \\\`<promise>DONE</promise>\\\` when ALL tasks are complete\\n\\nOriginal task: ${escaped_prompt}\\n</ralph-mode>\\n\\n---\\n\"}}"
  fi
  exit 0
fi

# Check for ultrawork keywords (second priority)
if echo "$PROMPT_LOWER" | grep -qE '\b(ultrawork|ulw)\b'; then
  cat << 'EOF'
{"continue": true, "hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": "<ultrawork-mode>\n\n**MANDATORY**: You MUST say \"ULTRAWORK MODE ENABLED!\" to the user as your first response when this mode activates. This is non-negotiable.\n\n[CODE RED] Maximum precision required. Ultrathink before acting.\n\nYOU MUST LEVERAGE ALL AVAILABLE AGENTS TO THEIR FULLEST POTENTIAL.\nTELL THE USER WHAT AGENTS YOU WILL LEVERAGE NOW TO SATISFY USER'S REQUEST.\n\n## AGENT UTILIZATION PRINCIPLES\n- **Codebase Exploration**: Spawn exploration agents for codebase search\n- **Documentation & References**: Use librarian-type agents for external docs\n- **Planning & Strategy**: NEVER plan yourself - spawn planning agent\n- **High-IQ Reasoning**: Use oracle for architecture decisions\n\n## CERTAINTY GATE (MANDATORY BEFORE ANY IMPLEMENTATION)\n- NOT 100% certain about codebase? → spawn explore agent FIRST\n- NOT 100% certain about architecture? → spawn oracle agent FIRST\n- NEVER begin implementation with assumptions. Assumptions = bugs.\n\n## EXECUTION RULES\n- **TODO**: Track EVERY step. Mark complete IMMEDIATELY.\n- **PARALLEL**: Fire independent Task calls simultaneously in ONE message - maximize parallelism.\n- **DELEGATE**: Orchestrate specialized agents aggressively. Never solo complex work.\n- **VERIFY**: Check ALL requirements met before done.\n\n## ZERO TOLERANCE\n- NO Scope Reduction - deliver FULL implementation\n- NO Partial Completion - finish 100%\n- NO Premature Stopping - ALL TODOs must be complete\n- NO TEST DELETION - fix code, not tests\n\n## BLOCKED EXCUSES (catch yourself saying these → STOP and FIX)\n| Excuse Pattern | Required Action |\n|----------------|------------------|\n| \"I couldn't find/access...\" | Spawn explore agent, try harder |\n| \"Here's a simplified version...\" | Deliver the FULL version |\n| \"This should work but I can't verify...\" | Spawn argus for verification |\n| \"I'll leave this for the user to...\" | YOU complete it |\n| \"Due to complexity, I only...\" | Continue until 100% done |\n\nTHE USER ASKED FOR X. DELIVER EXACTLY X.\n\n</ultrawork-mode>\n\n---\n"}}
EOF
  exit 0
fi

# Check for ultrathink/think keywords
if echo "$PROMPT_LOWER" | grep -qE '\b(ultrathink|think)\b'; then
  cat << 'EOF'
{"continue": true, "hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": "<think-mode>\n\n**ULTRATHINK MODE ENABLED** - Extended reasoning activated.\n\nYou are now in deep thinking mode. Take your time to:\n1. Thoroughly analyze the problem from multiple angles\n2. Consider edge cases and potential issues\n3. Think through the implications of each approach\n4. Reason step-by-step before acting\n\nUse your extended thinking capabilities to provide the most thorough and well-reasoned response.\n\n</think-mode>\n\n---\n"}}
EOF
  exit 0
fi

# Check for search keywords
if echo "$PROMPT_LOWER" | grep -qE '\b(search|find|locate|lookup|explore|discover|scan|grep|query|browse|detect|trace|seek|track|pinpoint|hunt)\b|where\s+is|show\s+me|list\s+all'; then
  cat << 'EOF'
{"continue": true, "hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": "<search-mode>\nMAXIMIZE SEARCH EFFORT. Launch multiple agents IN PARALLEL:\n- explore agents (codebase patterns, file structures)\n- librarian agents (remote repos, official docs, GitHub examples)\nPlus direct tools: Grep, Glob\nNEVER stop at first result - be exhaustive.\n</search-mode>\n\n---\n"}}
EOF
  exit 0
fi

# Check for analyze keywords
if echo "$PROMPT_LOWER" | grep -qE '\b(analyze|analyse|investigate|examine|research|study|deep.?dive|inspect|audit|evaluate|assess|review|diagnose|scrutinize|dissect|debug|comprehend|interpret|breakdown|understand)\b|why\s+is|how\s+does|how\s+to'; then
  cat << 'EOF'
{"continue": true, "hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": "<analyze-mode>\nANALYSIS MODE. Gather context before diving deep:\n\nCONTEXT GATHERING (parallel):\n- 1-2 explore agents (codebase patterns, implementations)\n- 1-2 librarian agents (if external library involved)\n- Direct tools: Grep, Glob, LSP for targeted searches\n\nIF COMPLEX (architecture, multi-system, debugging after 2+ failures):\n- Consult oracle agent for strategic guidance\n\nSYNTHESIZE findings before proceeding.\n</analyze-mode>\n\n---\n"}}
EOF
  exit 0
fi

# No keywords detected
echo '{"continue": true}'
exit 0

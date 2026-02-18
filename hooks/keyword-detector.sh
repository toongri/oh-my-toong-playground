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
  echo "${1%/.omt}"
}

# Get project root
PROJECT_ROOT=$(get_project_root "$DIRECTORY")

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

# Remove code blocks before checking keywords
# First convert newlines to a placeholder, then remove multi-line code blocks, then restore newlines
# This handles both single-line and multi-line code blocks properly
PROMPT_NO_CODE=$(echo "$PROMPT" | tr '\n' '\r' | sed 's/```[^`]*```//g' | sed 's/`[^`]*`//g' | tr '\r' '\n')

# Remove system-reminder tags
PROMPT_CLEAN=$(echo "$PROMPT" | perl -0pe 's/<system-reminder>.*?<\/system-reminder>//gs' | sed 's/  */ /g' | sed 's/^ *//;s/ *$//')

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

# Function to create ralph state file
# Uses SESSION_ID for session-specific file naming
create_ralph_state() {
  local dir="$1"
  local prompt="$2"
  local timestamp=$(date -Iseconds 2>/dev/null || date +"%Y-%m-%dT%H:%M:%S")

  # Escape prompt for JSON (basic escaping)
  local escaped_prompt=$(echo "$prompt" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g' | tr '\n' ' ')

  # Create local .omt directory
  mkdir -p "$dir/.omt" 2>/dev/null
  cat > "$dir/.omt/ralph-state-${SESSION_ID}.json" 2>/dev/null << EOF
{
  "active": true,
  "iteration": 1,
  "max_iterations": 10,
  "completion_promise": "DONE",
  "prompt": "$escaped_prompt",
  "started_at": "$timestamp"
}
EOF
}

# Check for ralph keyword (highest priority) - ralph loop activation
if echo "$PROMPT_LOWER" | grep -qE '\bralph\b'; then
  # Create ralph state file
  create_ralph_state "$PROJECT_ROOT" "$PROMPT_CLEAN"

  # Output ralph activation message
  cat << EOF
{"continue": true, "hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": "<ralph-mode>\n**RALPH LOOP ACTIVATED** - Iteration 1/10\n\nYou are in Ralph Loop mode with MANDATORY VERIFICATION GATES.\n\n## CORE RULES\n1. Work until ALL requirements are met\n2. Track progress with TodoWrite tool\n3. When ALL tasks complete, output <promise>DONE</promise> to trigger Oracle verification\n4. After Oracle approves, output <oracle-approved>VERIFIED_COMPLETE</oracle-approved>\n5. Do NOT stop until Oracle approves\n\n## COMPLETION SEQUENCE (MANDATORY)\n\n1. **Complete all tasks** - Check TODO list is empty\n2. **Run verification** - Build, test, lint as applicable\n3. **Output promise** - <promise>DONE</promise>\n4. **Stop hook triggers** - Oracle verification will be requested\n5. **Spawn Oracle** - Verify completion with oracle agent\n6. **Output approval tag** - <oracle-approved>VERIFIED_COMPLETE</oracle-approved>\n7. **Done** - Session can end\n\n## VERIFICATION REQUIREMENTS\n\n- [ ] Build: Fresh run showing SUCCESS\n- [ ] Tests: Fresh run showing ALL PASS\n- [ ] TODO LIST: Zero pending/in_progress tasks\n- [ ] Oracle: Verification approved\n\n### Red Flags (STOP if you catch yourself)\n- Using 'should work', 'probably passes'\n- Skipping build/test because 'nothing changed'\n- Forgetting to output <promise>DONE</promise> when complete\n\nOriginal task: ${PROMPT_CLEAN}\n</ralph-mode>\n\n---\n"}}
EOF
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

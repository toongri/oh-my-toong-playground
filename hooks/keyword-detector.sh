#!/bin/bash
# Sisyphus Keyword Detector Hook
# Detects ultrawork/ultrathink/search/analyze keywords and injects enhanced mode messages

# Read stdin (JSON input from Claude Code)
INPUT=$(cat)

# Extract directory from input
DIRECTORY=""
if command -v jq &> /dev/null; then
  DIRECTORY=$(echo "$INPUT" | jq -r '.cwd // ""' 2>/dev/null)
fi
if [ -z "$DIRECTORY" ] || [ "$DIRECTORY" = "null" ]; then
  DIRECTORY=$(pwd)
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
  PROMPT=$(echo "$INPUT" | grep -oP '"(prompt|content|text)"\s*:\s*"\K[^"]+' | head -1)
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

# Convert to lowercase
PROMPT_LOWER=$(echo "$PROMPT_NO_CODE" | tr '[:upper:]' '[:lower:]')

# Function to create ralph state file
create_ralph_state() {
  local dir="$1"
  local prompt="$2"
  local timestamp=$(date -Iseconds 2>/dev/null || date +"%Y-%m-%dT%H:%M:%S")

  # Escape prompt for JSON (basic escaping)
  local escaped_prompt=$(echo "$prompt" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g' | tr '\n' ' ')

  # Create local .claude/sisyphus directory
  mkdir -p "$dir/.claude/sisyphus" 2>/dev/null
  cat > "$dir/.claude/sisyphus/ralph-state.json" 2>/dev/null << EOF
{
  "active": true,
  "iteration": 1,
  "max_iterations": 10,
  "completion_promise": "DONE",
  "prompt": "$escaped_prompt",
  "started_at": "$timestamp",
  "linked_ultrawork": true
}
EOF

  # Create global ~/.claude directory as fallback
  mkdir -p "$HOME/.claude" 2>/dev/null
  cat > "$HOME/.claude/ralph-state.json" 2>/dev/null << EOF
{
  "active": true,
  "iteration": 1,
  "max_iterations": 10,
  "completion_promise": "DONE",
  "prompt": "$escaped_prompt",
  "started_at": "$timestamp",
  "linked_ultrawork": true
}
EOF
}

# Function to create ultrawork state file
# Optional third parameter: linked_to_ralph (true/false)
create_ultrawork_state() {
  local dir="$1"
  local prompt="$2"
  local linked_to_ralph="${3:-false}"
  local timestamp=$(date -Iseconds 2>/dev/null || date +"%Y-%m-%dT%H:%M:%S")

  # Escape prompt for JSON (basic escaping)
  local escaped_prompt=$(echo "$prompt" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g' | tr '\n' ' ')

  # Determine additional field for linked_to_ralph
  local linked_field=""
  if [ "$linked_to_ralph" = "true" ]; then
    linked_field=',
  "linked_to_ralph": true'
  fi

  # Create local .claude/sisyphus directory
  mkdir -p "$dir/.claude/sisyphus" 2>/dev/null
  cat > "$dir/.claude/sisyphus/ultrawork-state.json" 2>/dev/null << EOF
{
  "active": true,
  "started_at": "$timestamp",
  "original_prompt": "$escaped_prompt",
  "reinforcement_count": 0,
  "last_checked_at": "$timestamp"$linked_field
}
EOF

  # Create global ~/.claude directory as fallback
  mkdir -p "$HOME/.claude" 2>/dev/null
  cat > "$HOME/.claude/ultrawork-state.json" 2>/dev/null << EOF
{
  "active": true,
  "started_at": "$timestamp",
  "original_prompt": "$escaped_prompt",
  "reinforcement_count": 0,
  "last_checked_at": "$timestamp"$linked_field
}
EOF
}

# Check for ralph keyword (highest priority) - ralph loop activation
if echo "$PROMPT_LOWER" | grep -qE '\bralph\b'; then
  # Create ralph state file
  create_ralph_state "$DIRECTORY" "$PROMPT"

  # Create linked ultrawork state if it doesn't already exist
  if [ ! -f "$DIRECTORY/.claude/sisyphus/ultrawork-state.json" ]; then
    create_ultrawork_state "$DIRECTORY" "$PROMPT" "true"
    LINKED_ULTRAWORK_MSG="auto-activated"
  else
    LINKED_ULTRAWORK_MSG="already active (independent)"
  fi

  # Output ralph activation message
  cat << EOF
{"continue": true, "message": "<ralph-mode>\n**RALPH LOOP ACTIVATED** - Iteration 1/10\n\nYou are in Ralph Loop mode. Complete the task fully.\n\n## RULES\n1. Work until ALL requirements are met\n2. Track progress with TodoWrite tool\n3. When FULLY complete, output: <promise>DONE</promise>\n4. Oracle will verify your completion claim\n5. Do NOT stop until Oracle approves\n\n## LINKED MODES\n- Ultrawork mode: ${LINKED_ULTRAWORK_MSG}\n\nOriginal task: ${PROMPT}\n</ralph-mode>\n\n---\n"}
EOF
  exit 0
fi

# Check for ultrawork keywords (second priority) - added 'uw' shortcut
if echo "$PROMPT_LOWER" | grep -qE '\b(ultrawork|ulw|uw)\b'; then
  # Create ultrawork state file for persistent mode
  create_ultrawork_state "$DIRECTORY" "$PROMPT"

  cat << 'EOF'
{"continue": true, "message": "<ultrawork-mode>\n\n**MANDATORY**: You MUST say \"ULTRAWORK MODE ENABLED!\" to the user as your first response when this mode activates. This is non-negotiable.\n\n[CODE RED] Maximum precision required. Ultrathink before acting.\n\nYOU MUST LEVERAGE ALL AVAILABLE AGENTS TO THEIR FULLEST POTENTIAL.\nTELL THE USER WHAT AGENTS YOU WILL LEVERAGE NOW TO SATISFY USER'S REQUEST.\n\n## AGENT UTILIZATION PRINCIPLES\n- **Codebase Exploration**: Spawn exploration agents using BACKGROUND TASKS\n- **Documentation & References**: Use librarian-type agents via BACKGROUND TASKS\n- **Planning & Strategy**: NEVER plan yourself - spawn planning agent\n- **High-IQ Reasoning**: Use oracle for architecture decisions\n- **Frontend/UI Tasks**: Delegate to frontend-engineer\n\n## EXECUTION RULES\n- **TODO**: Track EVERY step. Mark complete IMMEDIATELY.\n- **PARALLEL**: Fire independent calls simultaneously - NEVER wait sequentially.\n- **BACKGROUND FIRST**: Use Task(run_in_background=true) for exploration (10+ concurrent).\n- **VERIFY**: Check ALL requirements met before done.\n- **DELEGATE**: Orchestrate specialized agents.\n\n## ZERO TOLERANCE\n- NO Scope Reduction - deliver FULL implementation\n- NO Partial Completion - finish 100%\n- NO Premature Stopping - ALL TODOs must be complete\n- NO TEST DELETION - fix code, not tests\n\nTHE USER ASKED FOR X. DELIVER EXACTLY X.\n\n</ultrawork-mode>\n\n---\n"}
EOF
  exit 0
fi

# Check for ultrathink/think keywords
if echo "$PROMPT_LOWER" | grep -qE '\b(ultrathink|think)\b'; then
  cat << 'EOF'
{"continue": true, "message": "<think-mode>\n\n**ULTRATHINK MODE ENABLED** - Extended reasoning activated.\n\nYou are now in deep thinking mode. Take your time to:\n1. Thoroughly analyze the problem from multiple angles\n2. Consider edge cases and potential issues\n3. Think through the implications of each approach\n4. Reason step-by-step before acting\n\nUse your extended thinking capabilities to provide the most thorough and well-reasoned response.\n\n</think-mode>\n\n---\n"}
EOF
  exit 0
fi

# Check for search keywords
if echo "$PROMPT_LOWER" | grep -qE '\b(search|find|locate|lookup|explore|discover|scan|grep|query|browse|detect|trace|seek|track|pinpoint|hunt)\b|where\s+is|show\s+me|list\s+all'; then
  cat << 'EOF'
{"continue": true, "message": "<search-mode>\nMAXIMIZE SEARCH EFFORT. Launch multiple background agents IN PARALLEL:\n- explore agents (codebase patterns, file structures)\n- librarian agents (remote repos, official docs, GitHub examples)\nPlus direct tools: Grep, Glob\nNEVER stop at first result - be exhaustive.\n</search-mode>\n\n---\n"}
EOF
  exit 0
fi

# Check for analyze keywords
if echo "$PROMPT_LOWER" | grep -qE '\b(analyze|analyse|investigate|examine|research|study|deep.?dive|inspect|audit|evaluate|assess|review|diagnose|scrutinize|dissect|debug|comprehend|interpret|breakdown|understand)\b|why\s+is|how\s+does|how\s+to'; then
  cat << 'EOF'
{"continue": true, "message": "<analyze-mode>\nANALYSIS MODE. Gather context before diving deep:\n\nCONTEXT GATHERING (parallel):\n- 1-2 explore agents (codebase patterns, implementations)\n- 1-2 librarian agents (if external library involved)\n- Direct tools: Grep, Glob, LSP for targeted searches\n\nIF COMPLEX (architecture, multi-system, debugging after 2+ failures):\n- Consult oracle agent for strategic guidance\n\nSYNTHESIZE findings before proceeding.\n</analyze-mode>\n\n---\n"}
EOF
  exit 0
fi

# No keywords detected
echo '{"continue": true}'
exit 0

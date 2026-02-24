#!/bin/bash
# =============================================================================
# Claude Code Adapter
# Claude-specific logic for oh-my-toong sync tool
# =============================================================================

# Note: This adapter is designed to be sourced by sync.sh or tests
# It does not set -euo pipefail to allow the caller to control that

# Get the directory where this script is located
CLAUDE_ADAPTER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# =============================================================================
# Logging (fallback if not sourced from parent with logging)
# =============================================================================

if ! declare -f log_info &>/dev/null; then
    log_info() { echo "[INFO] $1"; }
    log_success() { echo "[SUCCESS] $1"; }
    log_warn() { echo "[WARN] $1"; }
    log_error() { echo "[ERROR] $1"; }
    log_dry() { echo "[DRY-RUN] $1"; }
fi

# =============================================================================
# CLI Detection
# =============================================================================

# Check if Claude CLI is available
# Returns: 0 if available, 1 if not
claude_is_available() {
    command -v claude &>/dev/null
}

# =============================================================================
# Config Directory Functions
# =============================================================================

# Returns the config directory name for Claude Code
claude_get_config_dir() {
    echo ".claude"
}

# Returns the settings file name for Claude Code
claude_get_settings_file() {
    echo "settings.json"
}

# Returns the context file name for Claude Code
claude_get_context_file() {
    echo "CLAUDE.md"
}

# =============================================================================
# Feature Support
# =============================================================================

# Check if Claude supports a specific feature
# Arguments:
#   $1 - feature name (agents, commands, hooks, skills)
# Returns: 0 if supported, 1 if not
claude_supports_feature() {
    local feature="$1"

    case "$feature" in
        agents|commands|hooks|skills|rules|plugins|mcps|config)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

# =============================================================================
# Sync Functions
# =============================================================================

# Sync an agent to the target project
# Arguments:
#   $1 - target_path: Target project path
#   $2 - component: Agent component name (e.g., "oracle" or "proj:oracle")
#   $3 - add_skills: Comma-separated skills to add (can be empty)
#   $4 - dry_run: "true" or "false"
#   $5 - source_base_dir: (optional) Base directory for source files (for testing)
claude_sync_agents() {
    local target_path="$1"
    local component="$2"
    local add_skills="${3:-}"
    local dry_run="${4:-false}"
    local source_base_dir="${5:-}"

    local target_dir="$target_path/.claude/agents"

    # Resolve source path
    local source_file
    local display_name
    if [[ "$component" == *:* ]]; then
        local project=$(echo "$component" | cut -d: -f1)
        local item=$(echo "$component" | cut -d: -f2-)
        if [[ -n "$source_base_dir" ]]; then
            source_file="$source_base_dir/${item}.md"
        else
            source_file="$CLAUDE_ADAPTER_DIR/../../projects/$project/agents/${item}.md"
        fi
        display_name="$item"
    else
        if [[ -n "$source_base_dir" ]]; then
            source_file="$source_base_dir/${component}.md"
        else
            source_file="$CLAUDE_ADAPTER_DIR/../../agents/${component}.md"
        fi
        display_name="$component"
    fi

    local target_file="$target_dir/${display_name}.md"

    if [[ ! -f "$source_file" ]]; then
        log_warn "Agent file not found: $source_file"
        return 0
    fi

    if [[ "$dry_run" == "true" ]]; then
        log_dry "Copy: $source_file -> $target_file"
        return 0
    fi

    mkdir -p "$target_dir"
    cp "$source_file" "$target_file"
    log_info "Copied: ${display_name}.md"

    # Handle add_skills if provided
    if [[ -n "$add_skills" ]]; then
        IFS=',' read -ra skills_array <<< "$add_skills"
        for skill in "${skills_array[@]}"; do
            claude_update_agent_frontmatter "$target_file" "$skill" "$dry_run"
        done
    fi
}

# Sync a command to the target project
# Arguments:
#   $1 - target_path: Target project path
#   $2 - component: Command component name
#   $3 - dry_run: "true" or "false"
#   $4 - source_base_dir: (optional) Base directory for source files (for testing)
claude_sync_commands() {
    local target_path="$1"
    local component="$2"
    local dry_run="${3:-false}"
    local source_base_dir="${4:-}"

    local target_dir="$target_path/.claude/commands"

    # Resolve source path
    local source_file
    local display_name
    if [[ "$component" == *:* ]]; then
        local project=$(echo "$component" | cut -d: -f1)
        local item=$(echo "$component" | cut -d: -f2-)
        if [[ -n "$source_base_dir" ]]; then
            source_file="$source_base_dir/${item}.md"
        else
            source_file="$CLAUDE_ADAPTER_DIR/../../projects/$project/commands/${item}.md"
        fi
        display_name="$item"
    else
        if [[ -n "$source_base_dir" ]]; then
            source_file="$source_base_dir/${component}.md"
        else
            source_file="$CLAUDE_ADAPTER_DIR/../../commands/${component}.md"
        fi
        display_name="$component"
    fi

    local target_file="$target_dir/${display_name}.md"

    if [[ ! -f "$source_file" ]]; then
        log_warn "Command file not found: $source_file"
        return 0
    fi

    if [[ "$dry_run" == "true" ]]; then
        log_dry "Copy: $source_file -> $target_file"
        return 0
    fi

    mkdir -p "$target_dir"
    cp "$source_file" "$target_file"
    log_info "Copied: ${display_name}.md"
}

# Sync a hook to the target project
# Arguments:
#   $1 - target_path: Target project path
#   $2 - component: Hook component name (e.g., "session-start.sh")
#   $3 - event: Hook event (PreToolUse, PostToolUse, Stop, etc.)
#   $4 - matcher: Matcher pattern (default: "*")
#   $5 - timeout: Timeout in seconds (default: 10)
#   $6 - type: Hook type ("command" or "prompt")
#   $7 - command: Custom command (optional, uses component path if empty)
#   $8 - prompt: Prompt text (required if type is "prompt")
#   $9 - dry_run: "true" or "false"
#   $10 - source_base_dir: (optional) Base directory for source files (for testing)
claude_sync_hooks() {
    local target_path="$1"
    local component="${2:-}"
    local event="$3"
    local matcher="${4:-*}"
    local timeout="${5:-10}"
    local type="${6:-command}"
    local custom_command="${7:-}"
    local prompt="${8:-}"
    local dry_run="${9:-false}"
    local source_base_dir="${10:-}"

    local target_dir="$target_path/.claude/hooks"

    # Copy hook file if component is provided
    if [[ -n "$component" ]]; then
        local source_file
        local display_name
        if [[ "$component" == *:* ]]; then
            local project=$(echo "$component" | cut -d: -f1)
            local item=$(echo "$component" | cut -d: -f2-)
            if [[ -n "$source_base_dir" ]]; then
                source_file="$source_base_dir/${item}"
            else
                source_file="$CLAUDE_ADAPTER_DIR/../../projects/$project/hooks/${item}"
            fi
            display_name="$item"
        else
            if [[ -n "$source_base_dir" ]]; then
                source_file="$source_base_dir/${component}"
            else
                source_file="$CLAUDE_ADAPTER_DIR/../../hooks/${component}"
            fi
            display_name="$component"
        fi

        local target_file="$target_dir/${display_name}"

        if [[ -f "$source_file" ]]; then
            if [[ "$dry_run" == "true" ]]; then
                log_dry "Copy: $source_file -> $target_file"
            else
                mkdir -p "$target_dir"
                cp "$source_file" "$target_file"
                chmod +x "$target_file"
                log_info "Copied: ${display_name}"
            fi
        else
            log_warn "Hook file not found: $source_file"
        fi
    fi
}

# Sync a skill to the target project
# Arguments:
#   $1 - target_path: Target project path
#   $2 - component: Skill component name (directory name)
#   $3 - dry_run: "true" or "false"
#   $4 - source_base_dir: (optional) Base directory for source files (for testing)
claude_sync_skills() {
    local target_path="$1"
    local component="$2"
    local dry_run="${3:-false}"
    local source_base_dir="${4:-}"

    local target_dir="$target_path/.claude/skills"

    # Resolve source path
    local source_dir
    local display_name
    if [[ "$component" == *:* ]]; then
        local project=$(echo "$component" | cut -d: -f1)
        local item=$(echo "$component" | cut -d: -f2-)
        if [[ -n "$source_base_dir" ]]; then
            source_dir="$source_base_dir/${item}"
        else
            source_dir="$CLAUDE_ADAPTER_DIR/../../projects/$project/skills/${item}"
        fi
        display_name="$item"
    else
        if [[ -n "$source_base_dir" ]]; then
            source_dir="$source_base_dir/${component}"
        else
            source_dir="$CLAUDE_ADAPTER_DIR/../../skills/${component}"
        fi
        display_name="$component"
    fi

    local target_skill_dir="$target_dir/${display_name}"

    if [[ ! -d "$source_dir" ]]; then
        log_warn "Skill directory not found: $source_dir"
        return 0
    fi

    if [[ "$dry_run" == "true" ]]; then
        log_dry "Copy (directory): $source_dir -> $target_skill_dir"
        return 0
    fi

    mkdir -p "$target_dir"
    cp -r "$source_dir" "$target_skill_dir"
    log_info "Copied: ${display_name}/"
}

# =============================================================================
# Direct-Path Sync Functions (pre-resolved paths from sync.sh)
# =============================================================================

# Sync agent with pre-resolved source path
# Arguments:
#   $1 - target_path: Target project path
#   $2 - display_name: Display name for the agent
#   $3 - source_path: Pre-resolved absolute source path
#   $4 - add_skills: Comma-separated skills to add (can be empty)
#   $5 - add_hooks_json: JSON array of hooks to inject into frontmatter (can be empty)
#   $6 - dry_run: "true" or "false"
claude_sync_agents_direct() {
    local target_path="$1"
    local display_name="$2"
    local source_path="$3"
    local add_skills="${4:-}"
    local add_hooks_json="${5:-}"
    local dry_run="${6:-false}"

    local target_dir="$target_path/.claude/agents"
    local target_file="$target_dir/${display_name}.md"

    if [[ ! -f "$source_path" ]]; then
        log_warn "Agent file not found: $source_path"
        return 0
    fi

    if [[ "$dry_run" == "true" ]]; then
        log_dry "Copy: $source_path -> $target_file"
        return 0
    fi

    mkdir -p "$target_dir"
    cp "$source_path" "$target_file"
    log_info "Copied: ${display_name}.md"

    # Handle add_skills if provided
    if [[ -n "$add_skills" ]]; then
        IFS=',' read -ra skills_array <<< "$add_skills"
        for skill in "${skills_array[@]}"; do
            claude_update_agent_frontmatter "$target_file" "$skill" "$dry_run"
        done
    fi

    # Handle add_hooks if provided
    if [[ -n "$add_hooks_json" && "$add_hooks_json" != "[]" ]]; then
        # Deploy hook component files referenced in add_hooks
        local hook_count=$(echo "$add_hooks_json" | jq 'length')
        for k in $(seq 0 $((hook_count - 1))); do
            local hook_source=$(echo "$add_hooks_json" | jq -r ".[$k].source_path // \"\"")
            local hook_display=$(echo "$add_hooks_json" | jq -r ".[$k].display_name // \"\"")
            if [[ -n "$hook_source" && -f "$hook_source" ]]; then
                claude_sync_hooks_direct "$target_path" "$hook_display" "$hook_source" "$dry_run"
            fi
        done

        # Build frontmatter-ready hooks JSON (with command paths pointing to deployed location)
        local frontmatter_hooks=$(echo "$add_hooks_json" | jq -c '[.[] | {
            event: .event,
            matcher: (.matcher // "*"),
            type: (.type // "command"),
            command: (if .command != "" and .command != null then .command else ("\u0024CLAUDE_PROJECT_DIR/.claude/hooks/" + .display_name) end),
            timeout: (.timeout // 10)
        }]')

        claude_update_agent_hooks_frontmatter "$target_file" "$frontmatter_hooks" "$dry_run"
    fi
}

# Sync command with pre-resolved source path
claude_sync_commands_direct() {
    local target_path="$1"
    local display_name="$2"
    local source_path="$3"
    local dry_run="${4:-false}"

    local target_dir="$target_path/.claude/commands"
    local target_file="$target_dir/${display_name}.md"

    if [[ ! -f "$source_path" ]]; then
        log_warn "Command file not found: $source_path"
        return 0
    fi

    if [[ "$dry_run" == "true" ]]; then
        log_dry "Copy: $source_path -> $target_file"
        return 0
    fi

    mkdir -p "$target_dir"
    cp "$source_path" "$target_file"
    log_info "Copied: ${display_name}.md"
}

# Sync hook with pre-resolved source path
claude_sync_hooks_direct() {
    local target_path="$1"
    local display_name="$2"
    local source_path="$3"
    local dry_run="${4:-false}"

    local target_dir="$target_path/.claude/hooks"
    local target_file="$target_dir/${display_name}"

    if [[ -f "$source_path" ]]; then
        if [[ "$dry_run" == "true" ]]; then
            log_dry "Copy: $source_path -> $target_file"
        else
            mkdir -p "$target_dir"
            cp "$source_path" "$target_file"
            chmod +x "$target_file"
            log_info "Copied: ${display_name}"
        fi
    else
        log_warn "Hook file not found: $source_path"
    fi
}

# Sync skill with pre-resolved source path
claude_sync_skills_direct() {
    local target_path="$1"
    local display_name="$2"
    local source_path="$3"
    local dry_run="${4:-false}"

    local target_dir="$target_path/.claude/skills"
    local target_skill_dir="$target_dir/${display_name}"

    if [[ ! -d "$source_path" ]]; then
        log_warn "Skill directory not found: $source_path"
        return 0
    fi

    if [[ "$dry_run" == "true" ]]; then
        log_dry "Copy (directory): $source_path -> $target_skill_dir"
        return 0
    fi

    mkdir -p "$target_dir"
    cp -r "$source_path" "$target_skill_dir"
    log_info "Copied: ${display_name}/"
}

# Sync script with pre-resolved source path
claude_sync_scripts_direct() {
    local target_path="$1"
    local display_name="$2"
    local source_path="$3"
    local dry_run="${4:-false}"

    local target_dir="$target_path/.claude/scripts"
    local target_file="$target_dir/${display_name}"

    if [[ ! -f "$source_path" ]]; then
        log_warn "Script file not found: $source_path"
        return 0
    fi

    if [[ "$dry_run" == "true" ]]; then
        log_dry "Copy: $source_path -> $target_file"
        return 0
    fi

    mkdir -p "$target_dir"
    cp "$source_path" "$target_file"
    log_info "Copied: ${display_name}"
}

# Sync rule with pre-resolved source path
claude_sync_rules_direct() {
    local target_path="$1"
    local display_name="$2"
    local source_path="$3"
    local dry_run="${4:-false}"

    local target_dir="$target_path/.claude/rules"
    local target_file="$target_dir/${display_name}.md"

    if [[ ! -f "$source_path" ]]; then
        log_warn "Rule file not found: $source_path"
        return 0
    fi

    if [[ "$dry_run" == "true" ]]; then
        log_dry "Copy: $source_path -> $target_file"
        return 0
    fi

    mkdir -p "$target_dir"
    cp "$source_path" "$target_file"
    log_info "Copied: ${display_name}.md"
}

# =============================================================================
# Plugin Install
# =============================================================================

# Install a plugin via Claude CLI
# Arguments:
#   $1 - plugin_name: Plugin package name
#   $2 - dry_run: "true" or "false"
claude_sync_plugin_install() {
    local plugin_name="$1"
    local dry_run="${2:-false}"

    if [[ "$dry_run" == "true" ]]; then
        log_dry "claude plugin install $plugin_name"
        return 0
    fi

    if ! claude_is_available; then
        log_warn "Claude CLI가 사용 불가합니다. 플러그인 설치 스킵: $plugin_name"
        return 0
    fi

    log_info "플러그인 설치: $plugin_name"
    if ! claude plugin install "$plugin_name" 2>&1; then
        log_warn "플러그인 설치 실패 (계속 진행): $plugin_name"
    fi
}

# =============================================================================
# MCP Server Sync
# =============================================================================

# Merge an MCP server definition into .mcp.json
# Arguments:
#   $1 - target_path: Target project path
#   $2 - server_name: MCP server name (used as key in mcpServers)
#   $3 - server_json: JSON content of the MCP server definition
#   $4 - dry_run: "true" or "false"
claude_sync_mcps_merge() {
    local target_path="$1"
    local server_name="$2"
    local server_json="$3"
    local dry_run="${4:-false}"

    local mcp_file="$target_path/.mcp.json"

    if [[ "$dry_run" == "true" ]]; then
        log_dry "MCP merge: $server_name -> $mcp_file"
        log_dry "Server config: $server_json"
        return 0
    fi

    # Read existing .mcp.json or create default structure
    local current_content='{"mcpServers": {}}'
    if [[ -f "$mcp_file" ]]; then
        current_content=$(cat "$mcp_file")
    fi

    # Deep merge: set .mcpServers.<name> to server_json
    local new_content
    new_content=$(echo "$current_content" | jq --arg name "$server_name" --argjson server "$server_json" '.mcpServers[$name] = $server')

    echo "$new_content" | jq '.' > "$mcp_file"
    log_info "MCP merged: $server_name -> $mcp_file"
}

# =============================================================================
# Settings Update
# =============================================================================

# Update settings.json with hooks configuration
# Arguments:
#   $1 - target_path: Target project path
#   $2 - hooks_json: JSON object with hooks configuration
#   $3 - dry_run: "true" or "false"
claude_update_settings() {
    local target_path="$1"
    local hooks_json="$2"
    local dry_run="${3:-false}"

    local settings_file="$target_path/.claude/settings.json"

    if [[ "$dry_run" == "true" ]]; then
        log_dry "Update settings.json: $settings_file"
        log_dry "New hooks: $hooks_json"
        return 0
    fi

    # Ensure .claude directory exists
    mkdir -p "$target_path/.claude"

    # Read existing settings or use empty object
    local current_settings="{}"
    if [[ -f "$settings_file" ]]; then
        current_settings=$(cat "$settings_file")
    fi

    # Remove existing hooks, then add new hooks under "hooks" key
    local clean_settings=$(echo "$current_settings" | jq 'del(.hooks)')
    local new_settings=$(echo "$clean_settings" | jq --argjson hooks "$hooks_json" '. + {hooks: $hooks}')

    echo "$new_settings" | jq '.' > "$settings_file"
    log_info "Updated settings.json: $settings_file"
}

# =============================================================================
# Config Sync
# =============================================================================

# Sync config by deep merging into settings.local.json
# Arguments:
#   $1 - target_path: Target project path
#   $2 - config_json: JSON object with config fields
#   $3 - dry_run: "true" or "false"
claude_sync_config() {
    local target_path="$1"
    local config_json="$2"
    local dry_run="${3:-false}"

    local settings_file="$target_path/.claude/settings.local.json"

    if [[ "$dry_run" == "true" ]]; then
        log_dry "Config merge: $config_json -> $settings_file"
        return 0
    fi

    mkdir -p "$target_path/.claude"

    local current="{}"
    if [[ -f "$settings_file" ]]; then
        current=$(cat "$settings_file")
    fi

    # Deep merge: existing * new (new wins on conflict)
    local merged=$(echo "$current" | jq --argjson new "$config_json" '. * $new')
    echo "$merged" | jq '.' > "$settings_file"
    log_info "Config merged: $settings_file"
}

# =============================================================================
# Agent Frontmatter Update
# =============================================================================

# Update agent frontmatter to add skills
# Arguments:
#   $1 - agent_file: Path to agent file
#   $2 - skills_to_add: Space-separated skills to add (or single skill)
#   $3 - dry_run: "true" or "false"
claude_update_agent_frontmatter() {
    local agent_file="$1"
    local skills_to_add="$2"
    local dry_run="${3:-false}"

    if [[ -z "$skills_to_add" ]]; then
        return 0
    fi

    if [[ "$dry_run" == "true" ]]; then
        log_dry "Update frontmatter: $agent_file (add skills: $skills_to_add)"
        return 0
    fi

    # Check for frontmatter
    local has_frontmatter=$(head -1 "$agent_file" | grep -c "^---$" || true)
    if [[ "$has_frontmatter" -eq 0 ]]; then
        log_warn "No frontmatter found: $agent_file"
        return 0
    fi

    # Create temp files
    local temp_file=$(mktemp)
    local frontmatter_file=$(mktemp)
    local body_file=$(mktemp)

    # Separate frontmatter and body
    awk '/^---$/{n++; next} n==1' "$agent_file" > "$frontmatter_file"
    awk '/^---$/{n++; if(n==2) p=1; next} p' "$agent_file" > "$body_file"

    # Build skills args for yq
    # Convert space-separated skills to array addition
    local skills_args=""
    for skill in $skills_to_add; do
        skills_args="$skills_args + [\"$skill\"]"
    done

    # Update skills array: convert to array if scalar, add new skills, deduplicate
    yq -i ".skills = ([.skills] | flatten)${skills_args} | .skills |= unique" "$frontmatter_file"

    # Reassemble file
    echo "---" > "$temp_file"
    cat "$frontmatter_file" >> "$temp_file"
    echo "---" >> "$temp_file"
    cat "$body_file" >> "$temp_file"

    mv "$temp_file" "$agent_file"
    rm -f "$frontmatter_file" "$body_file"

    log_info "Updated frontmatter: $agent_file"
}

# Update agent frontmatter to add hooks
# Arguments:
#   $1 - agent_file: Path to agent file
#   $2 - hooks_json: JSON array of hook definitions (flat format)
#   $3 - dry_run: "true" or "false"
#
# Input format (flat JSON array):
#   [{"event":"SubagentStop","matcher":"*","type":"command","command":"...","timeout":60}]
#
# Output format (Claude frontmatter YAML):
#   hooks:
#     SubagentStop:
#       - matcher: "*"
#         hooks:
#           - type: command
#             command: "..."
#             timeout: 60
claude_update_agent_hooks_frontmatter() {
    local agent_file="$1"
    local hooks_json="$2"
    local dry_run="${3:-false}"

    if [[ -z "$hooks_json" || "$hooks_json" == "[]" ]]; then
        return 0
    fi

    if [[ "$dry_run" == "true" ]]; then
        log_dry "Update frontmatter hooks: $agent_file"
        return 0
    fi

    # Check for frontmatter
    local has_frontmatter=$(head -1 "$agent_file" | grep -c "^---$" || true)
    if [[ "$has_frontmatter" -eq 0 ]]; then
        log_warn "No frontmatter found: $agent_file"
        return 0
    fi

    # Create temp files
    local temp_file=$(mktemp)
    local frontmatter_file=$(mktemp)
    local body_file=$(mktemp)

    # Separate frontmatter and body
    awk '/^---$/{n++; next} n==1' "$agent_file" > "$frontmatter_file"
    awk '/^---$/{n++; if(n==2) p=1; next} p' "$agent_file" > "$body_file"

    # Convert flat hooks JSON to Claude frontmatter format (event-grouped)
    # Build a YAML snippet for hooks and merge it into frontmatter
    local hooks_yaml_file=$(mktemp)
    echo "hooks:" > "$hooks_yaml_file"

    # Group by event
    local events=$(echo "$hooks_json" | jq -r '.[].event' | sort -u)
    for event in $events; do
        echo "  $event:" >> "$hooks_yaml_file"
        # Get all hooks for this event
        local event_hooks=$(echo "$hooks_json" | jq -c "[.[] | select(.event == \"$event\")]")
        local hook_count=$(echo "$event_hooks" | jq 'length')
        for j in $(seq 0 $((hook_count - 1))); do
            local matcher=$(echo "$event_hooks" | jq -r ".[$j].matcher // \"*\"")
            local hook_type=$(echo "$event_hooks" | jq -r ".[$j].type // \"command\"")
            local timeout=$(echo "$event_hooks" | jq -r ".[$j].timeout // 10")

            echo "    - matcher: \"$matcher\"" >> "$hooks_yaml_file"
            echo "      hooks:" >> "$hooks_yaml_file"

            if [[ "$hook_type" == "prompt" ]]; then
                local prompt=$(echo "$event_hooks" | jq -r ".[$j].prompt // \"\"")
                echo "        - type: prompt" >> "$hooks_yaml_file"
                echo "          prompt: \"$prompt\"" >> "$hooks_yaml_file"
                echo "          timeout: $timeout" >> "$hooks_yaml_file"
            else
                local command=$(echo "$event_hooks" | jq -r ".[$j].command // \"\"")
                echo "        - type: command" >> "$hooks_yaml_file"
                echo "          command: \"$command\"" >> "$hooks_yaml_file"
                echo "          timeout: $timeout" >> "$hooks_yaml_file"
            fi
        done
    done

    # Merge hooks into frontmatter using yq
    yq -i eval-all 'select(fileIndex == 0) * select(fileIndex == 1)' "$frontmatter_file" "$hooks_yaml_file"

    # Reassemble file
    echo "---" > "$temp_file"
    cat "$frontmatter_file" >> "$temp_file"
    echo "---" >> "$temp_file"
    cat "$body_file" >> "$temp_file"

    mv "$temp_file" "$agent_file"
    rm -f "$frontmatter_file" "$body_file" "$hooks_yaml_file"

    log_info "Updated frontmatter hooks: $agent_file"
}

# =============================================================================
# Hook Entry Builder (for settings.json)
# =============================================================================

# Build a hook entry for settings.json
# Arguments:
#   $1 - event: Hook event
#   $2 - matcher: Matcher pattern
#   $3 - type: "command" or "prompt"
#   $4 - timeout: Timeout in seconds
#   $5 - command_or_prompt: Command path (for type=command) or prompt text (for type=prompt)
#   $6 - display_name: Component display name (for ${component} substitution)
# Returns: JSON hook entry via stdout
claude_build_hook_entry() {
    local event="$1"
    local matcher="$2"
    local type="$3"
    local timeout="$4"
    local command_or_prompt="$5"
    local display_name="${6:-}"

    local hook_entry
    if [[ "$type" == "prompt" ]]; then
        hook_entry=$(jq -n \
            --arg matcher "$matcher" \
            --arg prompt "$command_or_prompt" \
            --argjson timeout "$timeout" \
            '[{"matcher": $matcher, "hooks": [{"type": "prompt", "prompt": $prompt, "timeout": $timeout}]}]')
    else
        # Substitute ${component} if present
        local cmd_path="$command_or_prompt"
        if [[ -n "$display_name" ]]; then
            cmd_path="${cmd_path//\$\{component\}/$display_name}"
        fi
        hook_entry=$(jq -n \
            --arg matcher "$matcher" \
            --arg cmd "$cmd_path" \
            --argjson timeout "$timeout" \
            '[{"matcher": $matcher, "hooks": [{"type": "command", "command": $cmd, "timeout": $timeout}]}]')
    fi

    echo "$hook_entry"
}

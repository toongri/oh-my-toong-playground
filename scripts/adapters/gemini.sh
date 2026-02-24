#!/bin/bash
# =============================================================================
# Gemini CLI Adapter
# Gemini-specific logic for oh-my-toong sync tool
# =============================================================================

# Note: This adapter is designed to be sourced by sync.sh or tests
# It does not set -euo pipefail to allow the caller to control that

# Get the directory where this script is located
GEMINI_ADAPTER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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

# Check if Gemini CLI is available
# Returns: 0 if available, 1 if not
gemini_is_available() {
    command -v gemini &>/dev/null
}

# =============================================================================
# Config Directory Functions
# =============================================================================

# Returns the config directory name for Gemini CLI
gemini_get_config_dir() {
    echo ".gemini"
}

# Returns the settings file name for Gemini CLI
gemini_get_settings_file() {
    echo "settings.json"
}

# Returns the context file name for Gemini CLI
gemini_get_context_file() {
    echo "GEMINI.md"
}

# =============================================================================
# Feature Support
# =============================================================================

# Check if Gemini supports a specific feature
# Arguments:
#   $1 - feature name (agents, commands, hooks, skills)
# Returns: 0 if supported, 1 if not
gemini_supports_feature() {
    local feature="$1"

    case "$feature" in
        agents)
            return 1  # No native subagent support
            ;;
        commands|hooks|skills|config|mcps)
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
gemini_sync_agents() {
    local target_path="$1"
    local component="$2"
    local add_skills="$3"
    local dry_run="${4:-false}"
    local source_base_dir="${5:-}"

    # Gemini does not support native subagents - skip with warning
    log_warn "Gemini: agents는 지원되지 않습니다. Skip: $component"
    return 0
}

# Sync a command to the target project
# Arguments:
#   $1 - target_path: Target project path
#   $2 - component: Command component name
#   $3 - dry_run: "true" or "false"
#   $4 - source_base_dir: (optional) Base directory for source files (for testing)
gemini_sync_commands() {
    local target_path="$1"
    local component="$2"
    local dry_run="${3:-false}"
    local source_base_dir="${4:-}"

    local target_dir="$target_path/.gemini/commands"

    # Resolve source path
    local source_file
    local display_name
    if [[ "$component" == *:* ]]; then
        local project=$(echo "$component" | cut -d: -f1)
        local item=$(echo "$component" | cut -d: -f2-)
        if [[ -n "$source_base_dir" ]]; then
            source_file="$source_base_dir/${item}.md"
        else
            source_file="$GEMINI_ADAPTER_DIR/../../projects/$project/commands/${item}.md"
        fi
        display_name="$item"
    else
        if [[ -n "$source_base_dir" ]]; then
            source_file="$source_base_dir/${component}.md"
        else
            source_file="$GEMINI_ADAPTER_DIR/../../commands/${component}.md"
        fi
        display_name="$component"
    fi

    local target_file="$target_dir/${display_name}.toml"

    if [[ ! -f "$source_file" ]]; then
        log_warn "Command file not found: $source_file"
        return 0
    fi

    if [[ "$dry_run" == "true" ]]; then
        log_dry "Convert: $source_file -> $target_file"
        return 0
    fi

    mkdir -p "$target_dir"

    # Extract frontmatter description
    local description=""
    if head -1 "$source_file" | grep -q "^---$"; then
        description=$(awk '/^---$/{n++; next} n==1 && /^description:/{gsub(/^description:[[:space:]]*/, ""); print; exit}' "$source_file")
    fi

    # Generate TOML file
    cat > "$target_file" << EOF
[extension]
name = "$display_name"
description = "$description"
EOF

    log_info "Created: ${display_name}.toml"
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
gemini_sync_hooks() {
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

    local target_dir="$target_path/.gemini/hooks"

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
                source_file="$GEMINI_ADAPTER_DIR/../../projects/$project/hooks/${item}"
            fi
            display_name="$item"
        else
            if [[ -n "$source_base_dir" ]]; then
                source_file="$source_base_dir/${component}"
            else
                source_file="$GEMINI_ADAPTER_DIR/../../hooks/${component}"
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
# Copies the entire skill directory to .gemini/skills/{skill_name}/
# Arguments:
#   $1 - target_path: Target project path
#   $2 - component: Skill component name (directory name)
#   $3 - dry_run: "true" or "false"
#   $4 - source_base_dir: (optional) Base directory for source files (for testing)
gemini_sync_skills() {
    local target_path="$1"
    local component="$2"
    local dry_run="${3:-false}"
    local source_base_dir="${4:-}"

    # Resolve source path
    local source_dir
    local display_name
    if [[ "$component" == *:* ]]; then
        local project=$(echo "$component" | cut -d: -f1)
        local item=$(echo "$component" | cut -d: -f2-)
        if [[ -n "$source_base_dir" ]]; then
            source_dir="$source_base_dir/${item}"
        else
            source_dir="$GEMINI_ADAPTER_DIR/../../projects/$project/skills/${item}"
        fi
        display_name="$item"
    else
        if [[ -n "$source_base_dir" ]]; then
            source_dir="$source_base_dir/${component}"
        else
            source_dir="$GEMINI_ADAPTER_DIR/../../skills/${component}"
        fi
        display_name="$component"
    fi

    local target_dir="$target_path/.gemini/skills/$display_name"

    if [[ ! -d "$source_dir" ]]; then
        log_warn "Skill directory not found: $source_dir"
        return 1
    fi

    if [[ "$dry_run" == "true" ]]; then
        log_dry "Copy (directory): $source_dir -> $target_dir"
        return 0
    fi

    mkdir -p "$target_dir"
    cp -r "$source_dir"/* "$target_dir/"
    log_info "Copied: $display_name/"
}

# =============================================================================
# Direct-Path Sync Functions (pre-resolved paths from sync.sh)
# =============================================================================

gemini_sync_agents_direct() {
    local target_path="$1"
    local display_name="$2"
    local source_path="$3"
    local add_skills="$4"
    local dry_run="${5:-false}"

    # Gemini does not support native subagents - skip with warning
    log_warn "Gemini: agents는 지원되지 않습니다. Skip: $display_name"
    return 0
}

gemini_sync_commands_direct() {
    local target_path="$1"
    local display_name="$2"
    local source_path="$3"
    local dry_run="${4:-false}"

    local target_dir="$target_path/.gemini/commands"
    local target_file="$target_dir/${display_name}.toml"

    if [[ ! -f "$source_path" ]]; then
        log_warn "Command file not found: $source_path"
        return 0
    fi

    if [[ "$dry_run" == "true" ]]; then
        log_dry "Convert: $source_path -> $target_file"
        return 0
    fi

    mkdir -p "$target_dir"

    # Extract frontmatter description
    local description=""
    if head -1 "$source_path" | grep -q "^---$"; then
        description=$(awk '/^---$/{n++; next} n==1 && /^description:/{gsub(/^description:[[:space:]]*/, ""); print; exit}' "$source_path")
    fi

    cat > "$target_file" << EOF
[extension]
name = "$display_name"
description = "$description"
EOF

    log_info "Created: ${display_name}.toml"
}

gemini_sync_hooks_direct() {
    local target_path="$1"
    local display_name="$2"
    local source_path="$3"
    local dry_run="${4:-false}"

    local target_dir="$target_path/.gemini/hooks"
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

gemini_sync_skills_direct() {
    local target_path="$1"
    local display_name="$2"
    local source_path="$3"
    local dry_run="${4:-false}"

    local target_dir="$target_path/.gemini/skills/$display_name"

    if [[ ! -d "$source_path" ]]; then
        log_warn "Skill directory not found: $source_path"
        return 1
    fi

    if [[ "$dry_run" == "true" ]]; then
        log_dry "Copy (directory): $source_path -> $target_dir"
        return 0
    fi

    mkdir -p "$target_dir"
    cp -r "$source_path"/* "$target_dir/"
    log_info "Copied: $display_name/"
}

gemini_sync_scripts_direct() {
    local target_path="$1"
    local display_name="$2"
    local source_path="$3"
    local dry_run="${4:-false}"

    local target_dir="$target_path/.gemini/scripts"
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

# =============================================================================
# MCP Server Sync
# =============================================================================

# Merge an MCP server definition into .gemini/settings.json
# Arguments:
#   $1 - target_path: Target project path
#   $2 - server_name: MCP server name (used as key in mcpServers)
#   $3 - server_json: JSON content of the MCP server definition
#   $4 - dry_run: "true" or "false"
gemini_sync_mcps_merge() {
    local target_path="$1"
    local server_name="$2"
    local server_json="$3"
    local dry_run="${4:-false}"

    local settings_file="$target_path/.gemini/settings.json"

    if [[ "$dry_run" == "true" ]]; then
        log_dry "MCP merge: $server_name -> $settings_file"
        log_dry "Server config: $server_json"
        return 0
    fi

    # Ensure .gemini directory exists
    mkdir -p "$target_path/.gemini"

    # Read existing settings.json or create empty object
    local current_settings="{}"
    if [[ -f "$settings_file" ]]; then
        current_settings=$(cat "$settings_file")
    fi

    # Merge: set .mcpServers.<name> to server_json, preserving all other keys
    local new_settings
    new_settings=$(echo "$current_settings" | jq --arg name "$server_name" --argjson server "$server_json" '.mcpServers[$name] = $server')

    echo "$new_settings" | jq '.' > "$settings_file"
    log_info "MCP merged: $server_name -> $settings_file"
}

# =============================================================================
# Settings Update
# =============================================================================

# Update settings.json with hooks configuration
# Arguments:
#   $1 - target_path: Target project path
#   $2 - hooks_json: JSON object with hooks configuration
#   $3 - dry_run: "true" or "false"
gemini_update_settings() {
    local target_path="$1"
    local hooks_json="$2"
    local dry_run="${3:-false}"

    local settings_file="$target_path/.gemini/settings.json"

    if [[ "$dry_run" == "true" ]]; then
        log_dry "Update settings.json: $settings_file"
        log_dry "New hooks: $hooks_json"
        return 0
    fi

    # Ensure .gemini directory exists
    mkdir -p "$target_path/.gemini"

    # Read existing settings or use empty object
    local current_settings="{}"
    if [[ -f "$settings_file" ]]; then
        current_settings=$(cat "$settings_file")
    fi

    # Merge hooks into settings
    local new_settings=$(echo "$current_settings" | jq --argjson hooks "$hooks_json" '. * $hooks')

    echo "$new_settings" | jq '.' > "$settings_file"
    log_info "Updated settings.json: $settings_file"
}

# =============================================================================
# Config Sync
# =============================================================================

# Sync config by deep merging into settings.json
# Arguments:
#   $1 - target_path: Target project path
#   $2 - config_json: JSON object with config fields
#   $3 - dry_run: "true" or "false"
gemini_sync_config() {
    local target_path="$1"
    local config_json="$2"
    local dry_run="${3:-false}"

    local settings_file="$target_path/.gemini/settings.json"

    if [[ "$dry_run" == "true" ]]; then
        log_dry "Config merge: $config_json -> $settings_file"
        return 0
    fi

    mkdir -p "$target_path/.gemini"

    local current="{}"
    if [[ -f "$settings_file" ]]; then
        current=$(cat "$settings_file")
    fi

    # Deep merge: existing * new (preserves hooks, mcpServers, etc.)
    local merged=$(echo "$current" | jq --argjson new "$config_json" '. * $new')
    echo "$merged" | jq '.' > "$settings_file"
    log_info "Config merged: $settings_file"
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
gemini_build_hook_entry() {
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

#!/bin/bash
# =============================================================================
# OpenCode CLI Adapter
# OpenCode-specific logic for oh-my-toong sync tool
# =============================================================================

# Note: This adapter is designed to be sourced by sync.sh or tests
# It does not set -euo pipefail to allow the caller to control that

# Get the directory where this script is located
OPENCODE_ADAPTER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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

# Check if OpenCode CLI is available
# Returns: 0 if available, 1 if not
opencode_is_available() {
    command -v opencode &>/dev/null
}

# =============================================================================
# Config Directory Functions
# =============================================================================

# Returns the config directory name for OpenCode CLI
opencode_get_config_dir() {
    echo ".opencode"
}

# Returns the settings file name for OpenCode CLI
opencode_get_settings_file() {
    echo "opencode.json"
}

# Returns the context file name for OpenCode CLI
opencode_get_context_file() {
    echo "AGENTS.md"
}

# =============================================================================
# Agent Frontmatter Translation
# =============================================================================

# Translate agent frontmatter for OpenCode compatibility
# - Removes 'add-skills' field
# - Converts 'subagent_type' -> 'mode: "subagent"'
# Arguments:
#   $1 - agent_file: Path to agent file (modified in-place)
opencode_translate_agent_frontmatter() {
    local agent_file="$1"

    # Check for frontmatter (first line must be ---)
    local first_line
    first_line=$(head -1 "$agent_file")
    if [[ "$first_line" != "---" ]]; then
        return 0
    fi

    # Create temp files
    local temp_file
    temp_file=$(mktemp)
    local frontmatter_file
    frontmatter_file=$(mktemp)
    local body_file
    body_file=$(mktemp)

    # Separate frontmatter and body (same pattern as claude.sh)
    awk '/^---$/{n++; next} n==1' "$agent_file" > "$frontmatter_file"
    awk '/^---$/{n++; if(n==2) p=1; next} p' "$agent_file" > "$body_file"

    # Remove add-skills field
    yq -i 'del(.["add-skills"])' "$frontmatter_file"

    # Convert subagent_type -> mode: "subagent" (only if subagent_type exists)
    yq -i 'if .subagent_type then .mode = "subagent" | del(.subagent_type) end' "$frontmatter_file"

    # Reassemble file
    echo "---" > "$temp_file"
    cat "$frontmatter_file" >> "$temp_file"
    echo "---" >> "$temp_file"
    cat "$body_file" >> "$temp_file"

    mv "$temp_file" "$agent_file"
    rm -f "$frontmatter_file" "$body_file"
}

# =============================================================================
# Direct-Path Sync Functions (pre-resolved paths from sync.sh)
# =============================================================================

# Sync skill with pre-resolved source path
# Arguments:
#   $1 - target_path: Target project path
#   $2 - display_name: Display name for the skill
#   $3 - source_path: Pre-resolved absolute source path
#   $4 - dry_run: "true" or "false"
opencode_sync_skills_direct() {
    local target_path="$1"
    local display_name="$2"
    local source_path="$3"
    local dry_run="${4:-false}"

    local target_dir="$target_path/.opencode/skills"
    local target_skill_dir="$target_dir/${display_name}"

    if [[ ! -d "$source_path" ]]; then
        log_warn "Skill directory not found: $source_path"
        return 1
    fi

    if [[ "$dry_run" == "true" ]]; then
        log_dry "Copy (directory): $source_path -> $target_skill_dir"
        return 0
    fi

    mkdir -p "$target_dir"
    cp -r "$source_path" "$target_skill_dir"
    log_info "Copied: ${display_name}/"
}

# Sync agent with pre-resolved source path
# Arguments:
#   $1 - target_path: Target project path
#   $2 - display_name: Display name for the agent
#   $3 - source_path: Pre-resolved absolute source path
#   $4 - add_skills: Comma-separated skills to add (ignored for OpenCode)
#   $5 - dry_run: "true" or "false"
opencode_sync_agents_direct() {
    local target_path="$1"
    local display_name="$2"
    local source_path="$3"
    local add_skills="${4:-}"
    local dry_run="${5:-false}"

    local target_dir="$target_path/.opencode/agents"
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

    # Translate frontmatter for OpenCode compatibility
    opencode_translate_agent_frontmatter "$target_file"

    # add_skills is not supported by OpenCode — log if provided
    if [[ -n "$add_skills" ]]; then
        log_info "OpenCode does not support add-skills. Skipping add-skills for: ${display_name}"
    fi
}

# Sync command with pre-resolved source path
# Arguments:
#   $1 - target_path: Target project path
#   $2 - display_name: Display name for the command
#   $3 - source_path: Pre-resolved absolute source path
#   $4 - dry_run: "true" or "false"
opencode_sync_commands_direct() {
    local target_path="$1"
    local display_name="$2"
    local source_path="$3"
    local dry_run="${4:-false}"

    local target_dir="$target_path/.opencode/commands"
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

# Sync rule with pre-resolved source path
# Copies rule file to .opencode/rules/ and registers glob in opencode.json instructions
# Arguments:
#   $1 - target_path: Target project path
#   $2 - display_name: Display name for the rule
#   $3 - source_path: Pre-resolved absolute source path
#   $4 - dry_run: "true" or "false"
opencode_sync_rules_direct() {
    local target_path="$1"
    local display_name="$2"
    local source_path="$3"
    local dry_run="${4:-false}"

    local target_dir="$target_path/.opencode/rules"
    local target_file="$target_dir/${display_name}.md"
    local config_file="$target_path/.opencode/opencode.json"
    local glob_entry=".opencode/rules/*.md"

    if [[ ! -f "$source_path" ]]; then
        log_warn "Rule file not found: $source_path"
        return 0
    fi

    if [[ "$dry_run" == "true" ]]; then
        log_dry "Copy: $source_path -> $target_file"
        log_dry "Ensure instructions glob in: $config_file"
        return 0
    fi

    # Copy rule file
    mkdir -p "$target_dir"
    cp "$source_path" "$target_file"
    log_info "Copied: ${display_name}.md"

    # Ensure opencode.json has instructions glob (idempotent)
    mkdir -p "$target_path/.opencode"

    if [[ ! -f "$config_file" ]]; then
        # Create new opencode.json with instructions array
        printf '{"instructions":["%s"]}\n' "$glob_entry" | jq '.' > "$config_file"
        log_info "Created: opencode.json with instructions glob"
    else
        # Check if glob already present
        local already_present
        already_present=$(jq --arg glob "$glob_entry" '
            if .instructions then
                (.instructions | map(select(. == $glob)) | length) > 0
            else
                false
            end
        ' "$config_file")

        if [[ "$already_present" == "false" ]]; then
            # Add glob to instructions array
            local updated
            updated=$(jq --arg glob "$glob_entry" '
                if .instructions then
                    .instructions += [$glob]
                else
                    .instructions = [$glob]
                end
            ' "$config_file")
            echo "$updated" | jq '.' > "$config_file"
            log_info "Updated: opencode.json instructions glob added"
        fi
        # else: already present, skip (idempotent)
    fi
}

# Sync script with pre-resolved source path
# Arguments:
#   $1 - target_path: Target project path
#   $2 - display_name: Display name for the script
#   $3 - source_path: Pre-resolved absolute source path
#   $4 - dry_run: "true" or "false"
opencode_sync_scripts_direct() {
    local target_path="$1"
    local display_name="$2"
    local source_path="$3"
    local dry_run="${4:-false}"

    local target_dir="$target_path/.opencode/scripts"

    if [[ -d "$source_path" ]]; then
        # Directory script
        if [[ "$dry_run" == "true" ]]; then
            log_dry "Copy (directory): $source_path -> $target_dir/${display_name}/"
        else
            mkdir -p "$target_dir/${display_name}"
            rsync -a --delete --exclude '*.test.ts' "$source_path/" "$target_dir/${display_name}/"
            log_info "Copied: ${display_name}/"
        fi
    elif [[ -f "$source_path" ]]; then
        # File script
        local target_file="$target_dir/${display_name}"
        if [[ "$dry_run" == "true" ]]; then
            log_dry "Copy: $source_path -> $target_file"
        else
            mkdir -p "$target_dir"
            cp "$source_path" "$target_file"
            log_info "Copied: ${display_name}"
        fi
    else
        log_warn "Script not found: $source_path"
    fi
}

# Hooks are not supported by OpenCode — skip with info log
# Arguments:
#   $1 - target_path: Target project path
#   $2 - display_name: Display name for the hook
#   $3 - source_path: Pre-resolved absolute source path
#   $4 - event: Hook event
#   $5 - dry_run: "true" or "false"
opencode_sync_hooks_direct() {
    local target_path="$1"
    local display_name="${2:-}"
    local source_path="${3:-}"
    local event="${4:-}"
    local dry_run="${5:-false}"

    log_info "OpenCode does not support hooks. Skipping: ${display_name:-hook}"
    return 0
}

# =============================================================================
# Config Sync
# =============================================================================

# Sync config by deep merging into opencode.json
# Arguments:
#   $1 - target_path: Target project path
#   $2 - config_json: JSON object with config fields
#   $3 - dry_run: "true" or "false"
opencode_sync_config() {
    local target_path="$1"
    local config_json="$2"
    local dry_run="${3:-false}"

    local config_file="$target_path/.opencode/opencode.json"

    if [[ "$dry_run" == "true" ]]; then
        log_dry "Config merge: $config_json -> $config_file"
        return 0
    fi

    mkdir -p "$target_path/.opencode"

    local current="{}"
    if [[ -f "$config_file" ]]; then
        current=$(cat "$config_file")
    fi

    # Deep merge: existing * new (new wins on conflict)
    local merged
    merged=$(echo "$current" | jq --argjson new "$config_json" '. * $new')
    echo "$merged" | jq '.' > "$config_file"
    log_info "Config merged: $config_file"
}

# =============================================================================
# MCP Server Sync
# =============================================================================

# Merge an MCP server definition into .opencode/opencode.json
# Arguments:
#   $1 - target_path: Target project path
#   $2 - server_name: MCP server name (used as key in .mcp)
#   $3 - server_json: JSON content of the MCP server definition
#   $4 - dry_run: "true" or "false"
opencode_sync_mcps_merge() {
    local target_path="$1"
    local server_name="$2"
    local server_json="$3"
    local dry_run="${4:-false}"

    local config_file="$target_path/.opencode/opencode.json"

    if [[ "$dry_run" == "true" ]]; then
        log_dry "MCP merge: $server_name -> $config_file"
        log_dry "Server config: $server_json"
        return 0
    fi

    # Ensure .opencode directory exists
    mkdir -p "$target_path/.opencode"

    # Read existing opencode.json or create empty object
    local current="{}"
    if [[ -f "$config_file" ]]; then
        current=$(cat "$config_file")
    fi

    # Merge: set .mcp.<name> to server_json, preserving all other keys
    local updated
    updated=$(echo "$current" | jq --arg name "$server_name" --argjson server "$server_json" '.mcp[$name] = $server')

    echo "$updated" | jq '.' > "$config_file"
    log_info "MCP merged: $server_name -> $config_file"
}

# =============================================================================
# Model Map
# =============================================================================

# Apply a model map to resolve a model string to its mapped value
# Arguments:
#   $1 - model_map_json: JSON object mapping source model names to target model names
#   $2 - model_string: Model name to look up
# Output: Mapped model name, or original model_string if no mapping found
opencode_apply_model_map() {
    local model_map_json="$1"
    local model_string="$2"

    local mapped
    mapped=$(echo "$model_map_json" | jq -r --arg model "$model_string" '.[$model] // empty')

    if [[ -n "$mapped" ]]; then
        echo "$mapped"
    else
        echo "$model_string"
    fi
}

# =============================================================================
# Platform YAML Sync
# =============================================================================

# Sync an opencode.yaml platform file into a target project
# Processes model-map, config, hooks (skip), and mcps sections
# Arguments:
#   $1 - target_path: Target project path
#   $2 - platform_yaml: Path to opencode.yaml file
#   $3 - dry_run: "true" or "false"
# Output (stdout): Space-separated list of processed section names
# All log output goes to stderr
opencode_sync_platform_yaml() {
    local target_path="$1"
    local platform_yaml="$2"
    local dry_run="${3:-false}"

    local processed_sections=""

    # 1. model-map (must be processed before config)
    local model_map_json
    model_map_json=$(yq -o=json '.model-map // null' "$platform_yaml")
    if [[ "$model_map_json" != "null" ]]; then
        OPENCODE_MODEL_MAP_JSON="$model_map_json"
        processed_sections="$processed_sections model-map"
    fi

    # 2. config
    local config_json
    config_json=$(yq -o=json '.config // null' "$platform_yaml")
    if [[ "$config_json" != "null" ]]; then
        # Apply model-map to model and small_model fields
        if [[ -n "$OPENCODE_MODEL_MAP_JSON" ]]; then
            local model_val
            model_val=$(echo "$config_json" | jq -r '.model // empty')
            if [[ -n "$model_val" ]]; then
                local mapped
                mapped=$(opencode_apply_model_map "$OPENCODE_MODEL_MAP_JSON" "$model_val")
                config_json=$(echo "$config_json" | jq --arg m "$mapped" '.model = $m')
            fi
            local small_model_val
            small_model_val=$(echo "$config_json" | jq -r '.small_model // empty')
            if [[ -n "$small_model_val" ]]; then
                local mapped
                mapped=$(opencode_apply_model_map "$OPENCODE_MODEL_MAP_JSON" "$small_model_val")
                config_json=$(echo "$config_json" | jq --arg m "$mapped" '.small_model = $m')
            fi
        fi
        opencode_sync_config "$target_path" "$config_json" "$dry_run" >&2
        processed_sections="$processed_sections config"
    fi

    # 3. hooks (not supported — log and skip)
    local hooks_val
    hooks_val=$(yq '.hooks // null' "$platform_yaml")
    if [[ "$hooks_val" != "null" ]]; then
        log_info "OpenCode does not support hooks. Skipping hooks section." >&2
        processed_sections="$processed_sections hooks"
    fi

    # 4. mcps
    local mcp_names
    mcp_names=$(yq -o=json '.mcps // null' "$platform_yaml")
    if [[ "$mcp_names" != "null" ]]; then
        local names
        names=$(echo "$mcp_names" | jq -r 'keys[]')
        local name
        while IFS= read -r name; do
            [[ -z "$name" ]] && continue
            local server_json
            server_json=$(echo "$mcp_names" | jq --arg n "$name" '.[$n]')
            opencode_sync_mcps_merge "$target_path" "$name" "$server_json" "$dry_run" >&2
        done <<< "$names"
        processed_sections="$processed_sections mcps"
    fi

    # Return processed sections (trim leading space)
    echo "${processed_sections# }"
}

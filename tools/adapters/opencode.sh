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

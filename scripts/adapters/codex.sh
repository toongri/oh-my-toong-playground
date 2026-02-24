#!/bin/bash
# =============================================================================
# OpenAI Codex CLI Adapter
# Codex-specific logic for oh-my-toong sync tool
# =============================================================================

# Note: This adapter is designed to be sourced by sync.sh or tests
# It does not set -euo pipefail to allow the caller to control that

# Get the directory where this script is located
CODEX_ADAPTER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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

# Check if Codex CLI is available
# Returns: 0 if available, 1 if not
codex_is_available() {
    command -v codex &>/dev/null
}

# =============================================================================
# Config Directory Functions
# =============================================================================

# Returns the config directory name for Codex CLI
codex_get_config_dir() {
    echo ".codex"
}

# Returns the settings file name for Codex CLI
codex_get_settings_file() {
    echo "config.toml"
}

# Returns the context file name for Codex CLI
codex_get_context_file() {
    echo "AGENTS.md"
}

# =============================================================================
# Feature Support
# =============================================================================

# Check if Codex supports a specific feature
# Arguments:
#   $1 - feature name (agents, commands, hooks, skills)
# Returns: "true", "partial", or "false" via stdout
codex_supports_feature() {
    local feature="$1"

    case "$feature" in
        agents)
            echo "false"  # No native subagent support
            ;;
        commands)
            echo "false"  # Global only, not project-local
            ;;
        hooks)
            echo "partial"  # Notify only
            ;;
        skills|config|mcps)
            echo "true"  # Via directory copy / TOML managed block
            ;;
        *)
            echo "false"
            ;;
    esac
}

# =============================================================================
# Sync Functions
# =============================================================================

# Sync an agent to the target project via context injection
# Arguments:
#   $1 - target_path: Target project path
#   $2 - component: Agent component name (e.g., "oracle" or "proj:oracle")
#   $3 - add_skills: Comma-separated skills to add (can be empty)
#   $4 - dry_run: "true" or "false"
#   $5 - source_base_dir: (optional) Base directory for source files (for testing)
codex_sync_agents() {
    local target_path="$1"
    local component="$2"
    local add_skills="$3"
    local dry_run="${4:-false}"
    local source_base_dir="${5:-}"

    # Codex does not support native subagents - skip with warning
    log_warn "Codex: agents는 지원되지 않습니다. Skip: $component"
    return 0
}

# Sync a command to the target project (limited support)
# Arguments:
#   $1 - target_path: Target project path
#   $2 - component: Command component name
#   $3 - dry_run: "true" or "false"
#   $4 - source_base_dir: (optional) Base directory for source files (for testing)
codex_sync_commands() {
    local target_path="$1"
    local component="$2"
    local dry_run="${3:-false}"
    local source_base_dir="${4:-}"

    # Codex commands require global ~/.codex/prompts/ - not project-local
    log_warn "Codex: commands는 project-local이 아닌 ~/.codex/prompts/ (global)만 지원됩니다. Skip: $component"
    return 0
}

# Sync a hook to the target project (notify events only)
# Arguments:
#   $1 - target_path: Target project path
#   $2 - component: Hook component name (e.g., "session-start.sh")
#   $3 - event: Hook event (PreToolUse, PostToolUse, Stop, Notify, etc.)
#   $4 - matcher: Matcher pattern (default: "*")
#   $5 - timeout: Timeout in seconds (default: 10)
#   $6 - type: Hook type ("command" or "prompt")
#   $7 - command: Custom command (optional)
#   $8 - prompt: Prompt text (required if type is "prompt")
#   $9 - dry_run: "true" or "false"
#   $10 - source_base_dir: (optional) Base directory for source files (for testing)
codex_sync_hooks() {
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

    # Codex only supports Notification events
    local supported_events="Notification"
    if [[ ! " $supported_events " =~ " $event " ]]; then
        log_warn "Codex only supports Notification event. Skipping: $event"
        return 0
    fi

    local target_dir="$target_path/.codex/hooks"

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
                source_file="$CODEX_ADAPTER_DIR/../../projects/$project/hooks/${item}"
            fi
            display_name="$item"
        else
            if [[ -n "$source_base_dir" ]]; then
                source_file="$source_base_dir/${component}"
            else
                source_file="$CODEX_ADAPTER_DIR/../../hooks/${component}"
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

# Sync a skill to the target project (via directory copy)
# Arguments:
#   $1 - target_path: Target project path
#   $2 - component: Skill component name (directory name)
#   $3 - dry_run: "true" or "false"
#   $4 - source_base_dir: (optional) Base directory for source files (for testing)
codex_sync_skills() {
    local target_path="$1"
    local component="$2"
    local dry_run="${3:-false}"
    local source_base_dir="${4:-}"

    local target_dir="$target_path/.codex/skills"

    # Resolve source path
    local source_dir
    local display_name
    if [[ "$component" == *:* ]]; then
        local project=$(echo "$component" | cut -d: -f1)
        local item=$(echo "$component" | cut -d: -f2-)
        if [[ -n "$source_base_dir" ]]; then
            source_dir="$source_base_dir/${item}"
        else
            source_dir="$CODEX_ADAPTER_DIR/../../projects/$project/skills/${item}"
        fi
        display_name="$item"
    else
        if [[ -n "$source_base_dir" ]]; then
            source_dir="$source_base_dir/${component}"
        else
            source_dir="$CODEX_ADAPTER_DIR/../../skills/${component}"
        fi
        display_name="$component"
    fi

    local target_skill_dir="$target_dir/${display_name}"

    if [[ ! -d "$source_dir" ]]; then
        log_warn "Skill directory not found: $source_dir"
        return 1
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

codex_sync_agents_direct() {
    local target_path="$1"
    local display_name="$2"
    local source_path="$3"
    local add_skills="$4"
    local dry_run="${5:-false}"

    log_warn "Codex: agents는 지원되지 않습니다. Skip: $display_name"
    return 0
}

codex_sync_commands_direct() {
    local target_path="$1"
    local display_name="$2"
    local source_path="$3"
    local dry_run="${4:-false}"

    log_warn "Codex: commands는 project-local이 아닌 ~/.codex/prompts/ (global)만 지원됩니다. Skip: $display_name"
    return 0
}

codex_sync_hooks_direct() {
    local target_path="$1"
    local display_name="$2"
    local source_path="$3"
    local event="$4"
    local dry_run="${5:-false}"

    # Codex only supports Notification events
    local supported_events="Notification"
    if [[ ! " $supported_events " =~ " $event " ]]; then
        log_warn "Codex only supports Notification event. Skipping: $event"
        return 0
    fi

    local target_dir="$target_path/.codex/hooks"
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

codex_sync_skills_direct() {
    local target_path="$1"
    local display_name="$2"
    local source_path="$3"
    local dry_run="${4:-false}"

    local target_dir="$target_path/.codex/skills"
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

codex_sync_scripts_direct() {
    local target_path="$1"
    local display_name="$2"
    local source_path="$3"
    local dry_run="${4:-false}"

    local target_dir="$target_path/.codex/scripts"
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
# TOML Helpers
# =============================================================================

# Convert a JSON value to TOML value format
# Arguments:
#   $1 - json_value: Raw JSON value (string, number, boolean, etc.)
# Returns: TOML-formatted value via stdout
codex_json_to_toml_value() {
    local json_value="$1"

    # Detect type via jq
    local jq_type
    jq_type=$(echo "$json_value" | jq -r 'type' 2>/dev/null) || {
        # Fallback: treat as string
        echo "\"$json_value\""
        return 0
    }

    case "$jq_type" in
        string)
            # Output as quoted TOML string
            echo "$json_value" | jq -r '"\"\(.)\"" '
            ;;
        number|boolean)
            # Output raw value
            echo "$json_value" | jq -r '.'
            ;;
        *)
            # Arrays/objects not supported as scalar TOML values
            echo "\"$json_value\""
            ;;
    esac
}

# =============================================================================
# Config Sync
# =============================================================================

# Sync config by writing a managed block into config.toml
# Arguments:
#   $1 - target_path: Target project path
#   $2 - config_json: JSON object with config fields
#   $3 - dry_run: "true" or "false"
codex_sync_config() {
    local target_path="$1"
    local config_json="$2"
    local dry_run="${3:-false}"

    local config_file="$target_path/.codex/config.toml"

    if [[ "$dry_run" == "true" ]]; then
        log_dry "Config managed block: $config_json -> $config_file"
        return 0
    fi

    mkdir -p "$target_path/.codex"

    # Read existing content
    local existing_content=""
    if [[ -f "$config_file" ]]; then
        existing_content=$(cat "$config_file")
    fi

    # Strip existing omt:config managed block
    local stripped_content
    if [[ -n "$existing_content" ]]; then
        stripped_content=$(echo "$existing_content" | sed '/^# --- omt:config ---$/,/^# --- end omt:config ---$/d')
    else
        stripped_content=""
    fi

    # Build managed block content
    local managed_block=""
    managed_block="# --- omt:config ---"

    # Separate scalar keys and object keys
    local scalar_keys
    scalar_keys=$(echo "$config_json" | jq -r 'to_entries[] | select(.value | type != "object") | .key')

    local object_keys
    object_keys=$(echo "$config_json" | jq -r 'to_entries[] | select(.value | type == "object") | .key')

    # Write scalar keys first
    local key
    for key in $scalar_keys; do
        local raw_value
        raw_value=$(echo "$config_json" | jq ".${key}")
        local toml_value
        toml_value=$(codex_json_to_toml_value "$raw_value")
        managed_block="$managed_block
$key = $toml_value"
    done

    # Write object keys as [section] blocks
    for key in $object_keys; do
        managed_block="$managed_block

[$key]"
        # Iterate sub-keys
        local sub_keys
        sub_keys=$(echo "$config_json" | jq -r ".${key} | keys[]")
        local sub_key
        for sub_key in $sub_keys; do
            local raw_value
            raw_value=$(echo "$config_json" | jq ".${key}.${sub_key}")
            # Skip nested objects (3+ levels deep) — not supported in TOML passthrough
            local sub_value_type
            sub_value_type=$(echo "$raw_value" | jq -r 'type' 2>/dev/null) || sub_value_type="unknown"
            if [[ "$sub_value_type" == "object" ]]; then
                log_warn "Config: nested object 미지원 (${key}.${sub_key}), 스킵"
                continue
            fi
            local toml_value
            toml_value=$(codex_json_to_toml_value "$raw_value")
            managed_block="$managed_block
$sub_key = $toml_value"
        done
    done

    managed_block="$managed_block
# --- end omt:config ---"

    # Write result: stripped content + managed block appended
    if [[ -n "$stripped_content" ]]; then
        # Remove trailing blank lines (macOS compatible)
        while [[ "$stripped_content" == *$'\n' ]]; do
            stripped_content="${stripped_content%$'\n'}"
        done
        printf '%s\n\n%s\n' "$stripped_content" "$managed_block" > "$config_file"
    else
        printf '%s\n' "$managed_block" > "$config_file"
    fi

    log_info "Config managed block: $config_file"
}

# =============================================================================
# MCP Server Sync
# =============================================================================

# Global accumulator for MCP server TOML content (reset per sync_mcps call)
CODEX_MCP_SERVERS_JSON="{}"

# Accumulate an MCP server for later writing
# Arguments:
#   $1 - server_name: MCP server name
#   $2 - server_json: JSON content of the MCP server definition
codex_accumulate_mcp_server() {
    local server_name="$1"
    local server_json="$2"

    CODEX_MCP_SERVERS_JSON=$(echo "$CODEX_MCP_SERVERS_JSON" | jq --arg name "$server_name" --argjson server "$server_json" '.[$name] = $server')
}

# Write all accumulated MCP servers as a managed block in config.toml
# Arguments:
#   $1 - target_path: Target project path
#   $2 - dry_run: "true" or "false"
codex_write_mcp_managed_block() {
    local target_path="$1"
    local dry_run="${2:-false}"

    local config_file="$target_path/.codex/config.toml"

    # Check if there are any servers to write
    local server_count
    server_count=$(echo "$CODEX_MCP_SERVERS_JSON" | jq 'length')
    if [[ "$server_count" -eq 0 ]]; then
        return 0
    fi

    if [[ "$dry_run" == "true" ]]; then
        log_dry "MCP managed block: $CODEX_MCP_SERVERS_JSON -> $config_file"
        return 0
    fi

    mkdir -p "$target_path/.codex"

    # Backup config.toml before merge
    if [[ -f "$config_file" ]]; then
        local backup_base="$ROOT_DIR/.sync-backup/$CURRENT_BACKUP_SESSION"
        local backup_path
        if [[ -z "$CURRENT_PROJECT_NAME" ]]; then
            backup_path="$backup_base/codex-config.toml"
        else
            backup_path="$backup_base/projects/$CURRENT_PROJECT_NAME/codex-config.toml"
        fi

        mkdir -p "$(dirname "$backup_path")"
        cp "$config_file" "$backup_path"
        log_info "백업 완료: $backup_path"
    fi

    # Read existing content
    local existing_content=""
    if [[ -f "$config_file" ]]; then
        existing_content=$(cat "$config_file")
    fi

    # Strip existing omt:mcp managed block
    local stripped_content
    if [[ -n "$existing_content" ]]; then
        stripped_content=$(echo "$existing_content" | sed '/^# --- omt:mcp ---$/,/^# --- end omt:mcp ---$/d')
    else
        stripped_content=""
    fi

    # Build managed block content
    local managed_block="# --- omt:mcp ---"

    # Iterate each server
    local server_names
    server_names=$(echo "$CODEX_MCP_SERVERS_JSON" | jq -r 'keys[]')

    local name
    for name in $server_names; do
        local server_obj
        server_obj=$(echo "$CODEX_MCP_SERVERS_JSON" | jq ".\"$name\"")

        # Write [mcp_servers.<name>] section header
        managed_block="$managed_block
[mcp_servers.$name]"

        # Write scalar keys (non-object, non-array-of-objects)
        local scalar_keys
        scalar_keys=$(echo "$server_obj" | jq -r 'to_entries[] | select(.value | type != "object") | .key')

        local key
        for key in $scalar_keys; do
            local raw_value
            raw_value=$(echo "$server_obj" | jq ".$key")
            local value_type
            value_type=$(echo "$raw_value" | jq -r 'type')

            case "$value_type" in
                string)
                    local toml_val
                    toml_val=$(echo "$raw_value" | jq -r '.')
                    managed_block="$managed_block
$key = \"$toml_val\""
                    ;;
                number|boolean)
                    local toml_val
                    toml_val=$(echo "$raw_value" | jq -r '.')
                    managed_block="$managed_block
$key = $toml_val"
                    ;;
                array)
                    # Array of strings: ["a", "b"]
                    local arr_str
                    arr_str=$(echo "$raw_value" | jq -c '[.[] | "\"\(.)\""] | join(", ")')
                    # Remove outer quotes from jq output
                    arr_str=$(echo "$arr_str" | jq -r '.')
                    managed_block="$managed_block
$key = [$arr_str]"
                    ;;
            esac
        done

        # Write object sub-keys as sub-tables (e.g., [mcp_servers.<name>.env])
        local object_keys
        object_keys=$(echo "$server_obj" | jq -r 'to_entries[] | select(.value | type == "object") | .key')

        for key in $object_keys; do
            managed_block="$managed_block

[mcp_servers.$name.$key]"
            local sub_keys
            sub_keys=$(echo "$server_obj" | jq -r ".\"$key\" | keys[]")
            local sub_key
            for sub_key in $sub_keys; do
                local sub_value
                sub_value=$(echo "$server_obj" | jq ".\"$key\".\"$sub_key\"")
                local sub_type
                sub_type=$(echo "$sub_value" | jq -r 'type')

                case "$sub_type" in
                    string)
                        local toml_val
                        toml_val=$(echo "$sub_value" | jq -r '.')
                        managed_block="$managed_block
$sub_key = \"$toml_val\""
                        ;;
                    number|boolean)
                        local toml_val
                        toml_val=$(echo "$sub_value" | jq -r '.')
                        managed_block="$managed_block
$sub_key = $toml_val"
                        ;;
                    array)
                        local arr_str
                        arr_str=$(echo "$sub_value" | jq -c '[.[] | "\"\(.)\""] | join(", ")')
                        arr_str=$(echo "$arr_str" | jq -r '.')
                        managed_block="$managed_block
$sub_key = [$arr_str]"
                        ;;
                esac
            done
        done
    done

    managed_block="$managed_block
# --- end omt:mcp ---"

    # Write result: stripped content + managed block appended
    if [[ -n "$stripped_content" ]]; then
        # Remove trailing blank lines (macOS compatible)
        while [[ "$stripped_content" == *$'\n' ]]; do
            stripped_content="${stripped_content%$'\n'}"
        done
        printf '%s\n\n%s\n' "$stripped_content" "$managed_block" > "$config_file"
    else
        printf '%s\n' "$managed_block" > "$config_file"
    fi

    log_info "MCP managed block: $config_file"
}

# Merge an MCP server definition into Codex config.toml via accumulator
# Call codex_write_mcp_managed_block() after all items to flush
# Arguments:
#   $1 - target_path: Target project path (unused, kept for API consistency)
#   $2 - server_name: MCP server name
#   $3 - server_json: JSON content of the MCP server definition
#   $4 - dry_run: "true" or "false"
codex_sync_mcps_merge() {
    local target_path="$1"
    local server_name="$2"
    local server_json="$3"
    local dry_run="${4:-false}"

    if [[ "$dry_run" == "true" ]]; then
        log_dry "MCP accumulate: $server_name"
        return 0
    fi

    codex_accumulate_mcp_server "$server_name" "$server_json"
    log_info "MCP accumulated: $server_name"
}

# =============================================================================
# Settings Update
# =============================================================================

# Update config.toml with hooks configuration
# Arguments:
#   $1 - target_path: Target project path
#   $2 - hooks_json: JSON object with hooks configuration
#   $3 - dry_run: "true" or "false"
codex_update_settings() {
    local target_path="$1"
    local hooks_json="$2"
    local dry_run="${3:-false}"

    local config_file="$target_path/.codex/config.toml"

    if [[ "$dry_run" == "true" ]]; then
        log_dry "Update config.toml: $config_file"
        log_dry "New hooks: $hooks_json"
        return 0
    fi

    # Ensure .codex directory exists
    mkdir -p "$target_path/.codex"

    # Read existing config or start fresh
    local existing_content=""
    if [[ -f "$config_file" ]]; then
        existing_content=$(cat "$config_file")
    fi

    # Convert JSON hooks to TOML format using sed-based approach
    # Since tomlq may not be available, we use a simple approach

    # Check if [hooks] section exists
    if [[ -n "$existing_content" ]]; then
        # Preserve existing content
        if ! grep -q '^\[hooks\]' "$config_file" 2>/dev/null; then
            # Add hooks section at the end
            {
                echo ""
                echo "[hooks]"
                echo "# Hooks generated by oh-my-toong sync"
                # Parse JSON and convert to basic TOML
                # This is a simplified conversion for notify hooks
                echo "$hooks_json" | jq -r 'to_entries[] | "# \(.key) hooks\n"' 2>/dev/null || true
            } >> "$config_file"
        fi
    else
        # Create new config with hooks
        {
            echo "# Codex CLI configuration"
            echo "# Generated by oh-my-toong sync"
            echo ""
            echo "[hooks]"
            echo "# Notify hooks (only supported hook type)"
            # Convert JSON to TOML-style comments for reference
            echo "$hooks_json" | jq -r 'to_entries[] | "# \(.key) = ..."' 2>/dev/null || true
        } > "$config_file"
    fi

    log_info "Updated config.toml: $config_file"
}

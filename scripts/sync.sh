#!/bin/bash
set -euo pipefail

# =============================================================================
# oh-my-toong Sync Tool
# agents, commands, hooks, skills를 다른 Claude 프로젝트로 동기화
# Only supports new format (object with items)
# =============================================================================

# 변수
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
DRY_RUN=false

# Source common utilities and adapters
source "${SCRIPT_DIR}/lib/common.sh"
source "${SCRIPT_DIR}/adapters/claude.sh"
source "${SCRIPT_DIR}/adapters/gemini.sh"
source "${SCRIPT_DIR}/adapters/codex.sh"

# =============================================================================
# 전역 상태 변수 (백업용)
# =============================================================================

# 현재 백업 세션 ID (main에서 설정)
CURRENT_BACKUP_SESSION=""

# 현재 프로젝트 이름 (process_yaml에서 설정, 루트면 빈 문자열)
CURRENT_PROJECT_NAME=""

# Global variable for get_item_component
ITEM_IS_OBJECT=false

# =============================================================================
# Item Component Helper
# =============================================================================

# Get item from items array - handles both string and object format
# Returns component name, sets ITEM_IS_OBJECT=true if object, false if string
get_item_component() {
    local yaml_file="$1"
    local section="$2"
    local index="$3"

    local item_type=$(yq ".$section.items[$index] | type" "$yaml_file")
    if [[ "$item_type" == "!!str" ]]; then
        ITEM_IS_OBJECT=false
        yq ".$section.items[$index]" "$yaml_file"
    else
        ITEM_IS_OBJECT=true
        yq ".$section.items[$index].component // \"\"" "$yaml_file"
    fi
}

# =============================================================================
# 동기화 함수들 (Adapter Dispatch)
# =============================================================================

sync_agents() {
    local target_path="$1"
    local yaml_file="$2"

    # 필드 자체가 없으면 스킵
    local field_exists=$(yq '.agents' "$yaml_file")
    if [[ "$field_exists" == "null" ]]; then
        return 0
    fi

    # items 필드 확인
    local items_exists=$(yq '.agents.items' "$yaml_file")
    if [[ "$items_exists" == "null" ]]; then
        log_warn "agents.items가 없음, 스킵"
        return 0
    fi

    # Get default platforms (use-platforms from config.yaml)
    local default_platforms=$(get_default_platforms)

    # Get feature-specific platforms for this category
    local feature_platforms=$(get_feature_platforms "agents")
    if [[ -z "$feature_platforms" ]]; then
        feature_platforms="$default_platforms"
    fi

    # Get top-level platforms from sync.yaml
    local sync_platforms=$(yq -o=json '.platforms // null' "$yaml_file")
    if [[ "$sync_platforms" == "null" ]]; then
        sync_platforms="$feature_platforms"
    fi

    # Track which CLIs need directory preparation (Bash 3.2 compatible)
    local prepared_claude=false
    local prepared_gemini=false
    local prepared_codex=false

    # Section-level platforms
    local section_platforms=$(yq -o=json '.agents.platforms // null' "$yaml_file")
    if [[ "$section_platforms" == "null" ]]; then
        section_platforms="$sync_platforms"
    fi

    local count=$(yq '.agents.items | length // 0' "$yaml_file")
    log_info "Agents 동기화 시작 ($count 개)"

    for i in $(seq 0 $((count - 1))); do
        local component
        component=$(get_item_component "$yaml_file" "agents" "$i")

        # Get add-skills (only for object items)
        local add_skills=""
        local item_platforms
        if [[ "$ITEM_IS_OBJECT" == "true" ]]; then
            local add_skills_count=$(yq ".agents.items[$i].add-skills | length // 0" "$yaml_file")
            if [[ "$add_skills_count" -gt 0 ]]; then
                for j in $(seq 0 $((add_skills_count - 1))); do
                    local skill=$(yq ".agents.items[$i].add-skills[$j]" "$yaml_file")
                    if [[ -n "$add_skills" ]]; then
                        add_skills="$add_skills,$skill"
                    else
                        add_skills="$skill"
                    fi
                done
            fi

            # Get item-level platforms
            item_platforms=$(yq -o=json ".agents.items[$i].platforms // null" "$yaml_file")
            if [[ "$item_platforms" == "null" ]]; then
                item_platforms="$section_platforms"
            fi
        else
            # String item - use section platforms
            item_platforms="$section_platforms"
        fi

        if [[ -z "$component" || "$component" == "null" ]]; then
            continue
        fi

        resolve_scoped_source_path "agents" "$component" ".md"
        if [[ -z "$SCOPED_SOURCE_PATH" ]]; then
            log_warn "$SCOPED_RESOLUTION_ERROR"
            continue
        fi

        # Dispatch to each target adapter
        for target in $(echo "$item_platforms" | jq -r '.[]'); do
            case "$target" in
                claude)
                    if [[ "$prepared_claude" == false && "$DRY_RUN" != true ]]; then
                        backup_category "$target_path" "agents"
                        rm -rf "$target_path/.claude/agents"
                        mkdir -p "$target_path/.claude/agents"
                        prepared_claude=true
                    fi
                    claude_sync_agents_direct "$target_path" "$SCOPED_DISPLAY_NAME" "$SCOPED_SOURCE_PATH" "$add_skills" "$DRY_RUN"
                    ;;
                gemini)
                    if [[ "$prepared_gemini" == false && "$DRY_RUN" != true ]]; then
                        mkdir -p "$target_path/.gemini"
                        prepared_gemini=true
                    fi
                    gemini_sync_agents_direct "$target_path" "$SCOPED_DISPLAY_NAME" "$SCOPED_SOURCE_PATH" "$add_skills" "$DRY_RUN"
                    ;;
                codex)
                    if [[ "$prepared_codex" == false && "$DRY_RUN" != true ]]; then
                        mkdir -p "$target_path/.codex"
                        prepared_codex=true
                    fi
                    codex_sync_agents_direct "$target_path" "$SCOPED_DISPLAY_NAME" "$SCOPED_SOURCE_PATH" "$add_skills" "$DRY_RUN"
                    ;;
                *)
                    log_warn "Unknown target: $target (skipping)"
                    ;;
            esac
        done
    done

    log_success "Agents 동기화 완료"
}

sync_commands() {
    local target_path="$1"
    local yaml_file="$2"

    # 필드 자체가 없으면 스킵
    local field_exists=$(yq '.commands' "$yaml_file")
    if [[ "$field_exists" == "null" ]]; then
        return 0
    fi

    # items 필드 확인
    local items_exists=$(yq '.commands.items' "$yaml_file")
    if [[ "$items_exists" == "null" ]]; then
        log_warn "commands.items가 없음, 스킵"
        return 0
    fi

    # Get default platforms (use-platforms from config.yaml)
    local default_platforms=$(get_default_platforms)

    # Get feature-specific platforms for this category
    local feature_platforms=$(get_feature_platforms "commands")
    if [[ -z "$feature_platforms" ]]; then
        feature_platforms="$default_platforms"
    fi

    # Get top-level platforms from sync.yaml
    local sync_platforms=$(yq -o=json '.platforms // null' "$yaml_file")
    if [[ "$sync_platforms" == "null" ]]; then
        sync_platforms="$feature_platforms"
    fi

    # Track which CLIs need directory preparation (Bash 3.2 compatible)
    local prepared_claude=false
    local prepared_gemini=false
    local prepared_codex=false

    # Section-level platforms
    local section_platforms=$(yq -o=json '.commands.platforms // null' "$yaml_file")
    if [[ "$section_platforms" == "null" ]]; then
        section_platforms="$sync_platforms"
    fi

    local count=$(yq '.commands.items | length // 0' "$yaml_file")
    log_info "Commands 동기화 시작 ($count 개)"

    for i in $(seq 0 $((count - 1))); do
        local component
        component=$(get_item_component "$yaml_file" "commands" "$i")

        local item_platforms
        if [[ "$ITEM_IS_OBJECT" == "true" ]]; then
            item_platforms=$(yq -o=json ".commands.items[$i].platforms // null" "$yaml_file")
            if [[ "$item_platforms" == "null" ]]; then
                item_platforms="$section_platforms"
            fi
        else
            item_platforms="$section_platforms"
        fi

        if [[ -z "$component" || "$component" == "null" ]]; then
            continue
        fi

        resolve_scoped_source_path "commands" "$component" ".md"
        if [[ -z "$SCOPED_SOURCE_PATH" ]]; then
            log_warn "$SCOPED_RESOLUTION_ERROR"
            continue
        fi

        # Dispatch to each target adapter
        for target in $(echo "$item_platforms" | jq -r '.[]'); do
            case "$target" in
                claude)
                    if [[ "$prepared_claude" == false && "$DRY_RUN" != true ]]; then
                        backup_category "$target_path" "commands"
                        rm -rf "$target_path/.claude/commands"
                        mkdir -p "$target_path/.claude/commands"
                        prepared_claude=true
                    fi
                    claude_sync_commands_direct "$target_path" "$SCOPED_DISPLAY_NAME" "$SCOPED_SOURCE_PATH" "$DRY_RUN"
                    ;;
                gemini)
                    if [[ "$prepared_gemini" == false && "$DRY_RUN" != true ]]; then
                        mkdir -p "$target_path/.gemini/extensions"
                        prepared_gemini=true
                    fi
                    gemini_sync_commands_direct "$target_path" "$SCOPED_DISPLAY_NAME" "$SCOPED_SOURCE_PATH" "$DRY_RUN"
                    ;;
                codex)
                    if [[ "$prepared_codex" == false && "$DRY_RUN" != true ]]; then
                        mkdir -p "$target_path/.codex"
                        prepared_codex=true
                    fi
                    codex_sync_commands_direct "$target_path" "$SCOPED_DISPLAY_NAME" "$SCOPED_SOURCE_PATH" "$DRY_RUN"
                    ;;
                *)
                    log_warn "Unknown target: $target (skipping)"
                    ;;
            esac
        done
    done

    log_success "Commands 동기화 완료"
}

sync_hooks() {
    local target_path="$1"
    local yaml_file="$2"

    # 필드 자체가 없으면 스킵
    local field_exists=$(yq '.hooks' "$yaml_file")
    if [[ "$field_exists" == "null" ]]; then
        return 0
    fi

    # items 필드 확인
    local items_exists=$(yq '.hooks.items' "$yaml_file")
    if [[ "$items_exists" == "null" ]]; then
        log_warn "hooks.items가 없음, 스킵"
        return 0
    fi

    # Get default platforms (use-platforms from config.yaml)
    local default_platforms=$(get_default_platforms)

    # Get feature-specific platforms for this category
    local feature_platforms=$(get_feature_platforms "hooks")
    if [[ -z "$feature_platforms" ]]; then
        feature_platforms="$default_platforms"
    fi

    # Get top-level platforms from sync.yaml
    local sync_platforms=$(yq -o=json '.platforms // null' "$yaml_file")
    if [[ "$sync_platforms" == "null" ]]; then
        sync_platforms="$feature_platforms"
    fi

    # Track which CLIs need directory preparation and have hooks (Bash 3.2 compatible)
    local prepared_claude=false
    local prepared_gemini=false
    local prepared_codex=false
    local has_claude_hooks=false
    local has_gemini_hooks=false
    local has_codex_hooks=false

    # Per-CLI hooks JSON (for settings files)
    local claude_hooks_json="{}"
    local gemini_hooks_json="{}"
    local codex_hooks_json="{}"

    # Helper function to process a single hook
    process_hook() {
        local hook_path_prefix="$1"  # e.g., ".hooks.items[$i]"
        local effective_platforms="$2"

        local component=$(yq "$hook_path_prefix.component // \"\"" "$yaml_file")
        local hook_event=$(yq "$hook_path_prefix.event // \"\"" "$yaml_file")
        local matcher=$(yq "$hook_path_prefix.matcher // \"*\"" "$yaml_file")
        local hook_type=$(yq "$hook_path_prefix.type // \"command\"" "$yaml_file")
        local timeout=$(yq "$hook_path_prefix.timeout // 10" "$yaml_file")
        local custom_command=$(yq "$hook_path_prefix.command // \"\"" "$yaml_file")
        local prompt_text=$(yq "$hook_path_prefix.prompt // \"\"" "$yaml_file")

        if [[ -z "$hook_event" || "$hook_event" == "null" ]]; then
            log_warn "Hook event가 정의되지 않음 (스킵)"
            return 0
        fi

        # Get item-level platforms if present
        local item_platforms=$(yq -o=json "$hook_path_prefix.platforms // null" "$yaml_file")
        if [[ "$item_platforms" == "null" ]]; then
            item_platforms="$effective_platforms"
        fi

        # Resolve source path and display_name if component exists (file-based hooks)
        local display_name=""
        local scoped_source=""
        if [[ -n "$component" && "$component" != "null" ]]; then
            resolve_scoped_source_path "hooks" "$component" ""
            if [[ -z "$SCOPED_SOURCE_PATH" ]]; then
                log_warn "$SCOPED_RESOLUTION_ERROR"
                return 0
            fi
            display_name="$SCOPED_DISPLAY_NAME"
            scoped_source="$SCOPED_SOURCE_PATH"
        fi

        # Dispatch to each target adapter
        for target in $(echo "$item_platforms" | jq -r '.[]'); do
            case "$target" in
                claude)
                    if [[ "$prepared_claude" == false && "$DRY_RUN" != true ]]; then
                        backup_category "$target_path" "hooks"
                        rm -rf "$target_path/.claude/hooks"
                        mkdir -p "$target_path/.claude/hooks"
                        prepared_claude=true
                    fi

                    if [[ -n "$component" && "$component" != "null" ]]; then
                        claude_sync_hooks_direct "$target_path" "$display_name" "$scoped_source" "$DRY_RUN"
                    fi

                    local hook_entry
                    if [[ "$hook_type" == "prompt" ]]; then
                        if [[ -z "$prompt_text" || "$prompt_text" == "null" ]]; then
                            log_warn "Hook prompt가 정의되지 않음: event=$hook_event (스킵)"
                            continue
                        fi
                        hook_entry=$(claude_build_hook_entry "$hook_event" "$matcher" "prompt" "$timeout" "$prompt_text" "$display_name")
                    else
                        local cmd_path
                        if [[ -n "$custom_command" && "$custom_command" != "null" ]]; then
                            cmd_path="$custom_command"
                        elif [[ -n "$component" && "$component" != "null" ]]; then
                            # Use $CLAUDE_PROJECT_DIR for portable paths across subdirectories
                            cmd_path="\$CLAUDE_PROJECT_DIR/.claude/hooks/${display_name}"
                        else
                            log_warn "Hook command가 정의되지 않음: event=$hook_event (스킵)"
                            continue
                        fi
                        hook_entry=$(claude_build_hook_entry "$hook_event" "$matcher" "command" "$timeout" "$cmd_path" "$display_name")
                    fi

                    claude_hooks_json=$(echo "$claude_hooks_json" | jq --arg event "$hook_event" --argjson entry "$hook_entry" '.[$event] = (.[$event] // []) + $entry')
                    has_claude_hooks=true
                    ;;
                gemini)
                    if [[ "$prepared_gemini" == false && "$DRY_RUN" != true ]]; then
                        mkdir -p "$target_path/.gemini/hooks"
                        prepared_gemini=true
                    fi

                    if [[ -n "$component" && "$component" != "null" ]]; then
                        gemini_sync_hooks_direct "$target_path" "$display_name" "$scoped_source" "$DRY_RUN"
                    fi

                    local gemini_hook_entry
                    if [[ "$hook_type" == "prompt" ]]; then
                        if [[ -z "$prompt_text" || "$prompt_text" == "null" ]]; then
                            continue
                        fi
                        gemini_hook_entry=$(gemini_build_hook_entry "$hook_event" "$matcher" "prompt" "$timeout" "$prompt_text" "$display_name")
                    else
                        local cmd_path
                        if [[ -n "$custom_command" && "$custom_command" != "null" ]]; then
                            cmd_path="$custom_command"
                        elif [[ -n "$component" && "$component" != "null" ]]; then
                            cmd_path=".gemini/hooks/${display_name}"
                        else
                            continue
                        fi
                        gemini_hook_entry=$(gemini_build_hook_entry "$hook_event" "$matcher" "command" "$timeout" "$cmd_path" "$display_name")
                    fi

                    gemini_hooks_json=$(echo "$gemini_hooks_json" | jq --arg event "$hook_event" --argjson entry "$gemini_hook_entry" '.[$event] = (.[$event] // []) + $entry')
                    has_gemini_hooks=true
                    ;;
                codex)
                    if [[ "$prepared_codex" == false && "$DRY_RUN" != true ]]; then
                        mkdir -p "$target_path/.codex/hooks"
                        prepared_codex=true
                    fi

                    if [[ -n "$component" && "$component" != "null" ]]; then
                        codex_sync_hooks_direct "$target_path" "$display_name" "$scoped_source" "$hook_event" "$DRY_RUN"
                    fi

                    codex_hooks_json=$(echo "$codex_hooks_json" | jq --arg event "$hook_event" '. + {($event): true}')
                    has_codex_hooks=true
                    ;;
                *)
                    log_warn "Unknown target: $target (skipping)"
                    ;;
            esac
        done
    }

    # Section-level platforms
    local section_platforms=$(yq -o=json '.hooks.platforms // null' "$yaml_file")
    if [[ "$section_platforms" == "null" ]]; then
        section_platforms="$sync_platforms"
    fi

    local count=$(yq '.hooks.items | length // 0' "$yaml_file")
    log_info "Hooks 동기화 시작 ($count 개)"

    for i in $(seq 0 $((count - 1))); do
        process_hook ".hooks.items[$i]" "$section_platforms"
    done

    # Backup and update settings for each CLI that has hooks
    if [[ "$has_claude_hooks" == true ]]; then
        local settings_file="$target_path/.claude/settings.json"
        if [[ -f "$settings_file" ]]; then
            local backup_base="$ROOT_DIR/.sync-backup/$CURRENT_BACKUP_SESSION"
            local backup_path
            if [[ -z "$CURRENT_PROJECT_NAME" ]]; then
                backup_path="$backup_base/settings.json"
            else
                backup_path="$backup_base/projects/$CURRENT_PROJECT_NAME/settings.json"
            fi

            if [[ "$DRY_RUN" == true ]]; then
                log_dry "백업: $settings_file -> $backup_path"
            else
                mkdir -p "$(dirname "$backup_path")"
                cp "$settings_file" "$backup_path"
                log_info "백업 완료: $backup_path"
            fi
        fi
        claude_update_settings "$target_path" "$claude_hooks_json" "$DRY_RUN"
    fi

    if [[ "$has_gemini_hooks" == true ]]; then
        gemini_update_settings "$target_path" "$gemini_hooks_json" "$DRY_RUN"
    fi

    if [[ "$has_codex_hooks" == true ]]; then
        codex_update_settings "$target_path" "$codex_hooks_json" "$DRY_RUN"
    fi

    log_success "Hooks 동기화 완료"
}

sync_skills() {
    local target_path="$1"
    local yaml_file="$2"

    # 필드 자체가 없으면 스킵
    local field_exists=$(yq '.skills' "$yaml_file")
    if [[ "$field_exists" == "null" ]]; then
        return 0
    fi

    # items 필드 확인
    local items_exists=$(yq '.skills.items' "$yaml_file")
    if [[ "$items_exists" == "null" ]]; then
        log_warn "skills.items가 없음, 스킵"
        return 0
    fi

    # Get default platforms (use-platforms from config.yaml)
    local default_platforms=$(get_default_platforms)

    # Get feature-specific platforms for this category
    local feature_platforms=$(get_feature_platforms "skills")
    if [[ -z "$feature_platforms" ]]; then
        feature_platforms="$default_platforms"
    fi

    # Get top-level platforms from sync.yaml
    local sync_platforms=$(yq -o=json '.platforms // null' "$yaml_file")
    if [[ "$sync_platforms" == "null" ]]; then
        sync_platforms="$feature_platforms"
    fi

    # Track which CLIs need directory preparation (Bash 3.2 compatible)
    local prepared_claude=false
    local prepared_gemini=false
    local prepared_codex=false

    # Section-level platforms
    local section_platforms=$(yq -o=json '.skills.platforms // null' "$yaml_file")
    if [[ "$section_platforms" == "null" ]]; then
        section_platforms="$sync_platforms"
    fi

    local count=$(yq '.skills.items | length // 0' "$yaml_file")
    log_info "Skills 동기화 시작 ($count 개)"

    for i in $(seq 0 $((count - 1))); do
        local component
        component=$(get_item_component "$yaml_file" "skills" "$i")

        local item_platforms
        if [[ "$ITEM_IS_OBJECT" == "true" ]]; then
            item_platforms=$(yq -o=json ".skills.items[$i].platforms // null" "$yaml_file")
            if [[ "$item_platforms" == "null" ]]; then
                item_platforms="$section_platforms"
            fi
        else
            item_platforms="$section_platforms"
        fi

        if [[ -z "$component" || "$component" == "null" ]]; then
            continue
        fi

        resolve_scoped_source_path "skills" "$component" ""
        if [[ -z "$SCOPED_SOURCE_PATH" ]]; then
            log_warn "$SCOPED_RESOLUTION_ERROR"
            continue
        fi

        for target in $(echo "$item_platforms" | jq -r '.[]'); do
            case "$target" in
                claude)
                    if [[ "$prepared_claude" == false && "$DRY_RUN" != true ]]; then
                        backup_category "$target_path" "skills"
                        rm -rf "$target_path/.claude/skills"
                        mkdir -p "$target_path/.claude/skills"
                        prepared_claude=true
                    fi
                    claude_sync_skills_direct "$target_path" "$SCOPED_DISPLAY_NAME" "$SCOPED_SOURCE_PATH" "$DRY_RUN"
                    ;;
                gemini)
                    if [[ "$prepared_gemini" == false && "$DRY_RUN" != true ]]; then
                        mkdir -p "$target_path/.gemini"
                        prepared_gemini=true
                    fi
                    gemini_sync_skills_direct "$target_path" "$SCOPED_DISPLAY_NAME" "$SCOPED_SOURCE_PATH" "$DRY_RUN"
                    ;;
                codex)
                    if [[ "$prepared_codex" == false && "$DRY_RUN" != true ]]; then
                        mkdir -p "$target_path/.codex"
                        prepared_codex=true
                    fi
                    codex_sync_skills_direct "$target_path" "$SCOPED_DISPLAY_NAME" "$SCOPED_SOURCE_PATH" "$DRY_RUN"
                    ;;
                *)
                    log_warn "Unknown target: $target (skipping)"
                    ;;
            esac
        done
    done

    log_success "Skills 동기화 완료"
}

sync_scripts() {
    local target_path="$1"
    local yaml_file="$2"

    # 필드 자체가 없으면 스킵
    local field_exists=$(yq '.scripts' "$yaml_file")
    if [[ "$field_exists" == "null" ]]; then
        return 0
    fi

    # items 필드 확인
    local items_exists=$(yq '.scripts.items' "$yaml_file")
    if [[ "$items_exists" == "null" ]]; then
        log_warn "scripts.items가 없음, 스킵"
        return 0
    fi

    # Get default platforms (use-platforms from config.yaml)
    local default_platforms=$(get_default_platforms)

    # Get feature-specific platforms for this category
    local feature_platforms=$(get_feature_platforms "scripts")
    if [[ -z "$feature_platforms" ]]; then
        feature_platforms="$default_platforms"
    fi

    # Get top-level platforms from sync.yaml
    local sync_platforms=$(yq -o=json '.platforms // null' "$yaml_file")
    if [[ "$sync_platforms" == "null" ]]; then
        sync_platforms="$feature_platforms"
    fi

    # Track which CLIs need directory preparation (Bash 3.2 compatible)
    local prepared_claude=false
    local prepared_gemini=false
    local prepared_codex=false

    # Section-level platforms
    local section_platforms=$(yq -o=json '.scripts.platforms // null' "$yaml_file")
    if [[ "$section_platforms" == "null" ]]; then
        section_platforms="$sync_platforms"
    fi

    local count=$(yq '.scripts.items | length // 0' "$yaml_file")
    log_info "Scripts 동기화 시작 ($count 개)"

    for i in $(seq 0 $((count - 1))); do
        local component
        component=$(get_item_component "$yaml_file" "scripts" "$i")

        local item_platforms
        if [[ "$ITEM_IS_OBJECT" == "true" ]]; then
            item_platforms=$(yq -o=json ".scripts.items[$i].platforms // null" "$yaml_file")
            if [[ "$item_platforms" == "null" ]]; then
                item_platforms="$section_platforms"
            fi
        else
            item_platforms="$section_platforms"
        fi

        if [[ -z "$component" || "$component" == "null" ]]; then
            continue
        fi

        resolve_scoped_source_path "scripts" "$component" ""
        if [[ -z "$SCOPED_SOURCE_PATH" ]]; then
            log_warn "$SCOPED_RESOLUTION_ERROR"
            continue
        fi

        for target in $(echo "$item_platforms" | jq -r '.[]'); do
            case "$target" in
                claude)
                    if [[ "$prepared_claude" == false && "$DRY_RUN" != true ]]; then
                        backup_category "$target_path/.claude" "scripts"
                        rm -rf "$target_path/.claude/scripts"
                        mkdir -p "$target_path/.claude/scripts"
                        prepared_claude=true
                    fi
                    claude_sync_scripts_direct "$target_path" "$SCOPED_DISPLAY_NAME" "$SCOPED_SOURCE_PATH" "$DRY_RUN"
                    ;;
                gemini)
                    if [[ "$prepared_gemini" == false && "$DRY_RUN" != true ]]; then
                        rm -rf "$target_path/.gemini/scripts"
                        mkdir -p "$target_path/.gemini/scripts"
                        prepared_gemini=true
                    fi
                    gemini_sync_scripts_direct "$target_path" "$SCOPED_DISPLAY_NAME" "$SCOPED_SOURCE_PATH" "$DRY_RUN"
                    ;;
                codex)
                    if [[ "$prepared_codex" == false && "$DRY_RUN" != true ]]; then
                        rm -rf "$target_path/.codex/scripts"
                        mkdir -p "$target_path/.codex/scripts"
                        prepared_codex=true
                    fi
                    codex_sync_scripts_direct "$target_path" "$SCOPED_DISPLAY_NAME" "$SCOPED_SOURCE_PATH" "$DRY_RUN"
                    ;;
                *)
                    log_warn "Unknown target: $target (skipping)"
                    ;;
            esac
        done
    done

    log_success "Scripts 동기화 완료"
}

# =============================================================================
# YAML 처리
# =============================================================================

process_yaml() {
    local yaml_file="$1"
    local is_root="$2"  # "true" if root yaml, "false" if projects/ yaml

    if [[ ! -f "$yaml_file" ]]; then
        log_warn "YAML 파일 없음: $yaml_file"
        return 0
    fi

    local target_path=$(yq '.path // ""' "$yaml_file")

    if [[ -z "$target_path" || "$target_path" == "null" ]]; then
        log_warn "path가 정의되지 않음: $yaml_file"
        return 0
    fi

    # Set project context for scoped resolution
    set_project_context "$yaml_file" "$is_root"

    # Also set CURRENT_PROJECT_NAME for backward compatibility (backup functions)
    CURRENT_PROJECT_NAME="$CURRENT_PROJECT_CONTEXT"

    log_info "========================================"
    log_info "처리 중: $yaml_file"
    log_info "대상: $target_path"
    if [[ -n "$CURRENT_PROJECT_NAME" ]]; then
        log_info "프로젝트: $CURRENT_PROJECT_NAME"
    fi
    log_info "========================================"

    # CLI 프로젝트 파일 존재 확인
    if ! validate_cli_project_files "$yaml_file" "$target_path"; then
        log_error "CLI 프로젝트 파일 검증 실패, 이 yaml 처리 스킵: $yaml_file"
        return 1
    fi

    # .claude 디렉토리 생성
    if [[ "$DRY_RUN" != true ]]; then
        mkdir -p "$target_path/.claude"
    fi

    # 각 카테고리 동기화
    sync_agents "$target_path" "$yaml_file"
    sync_commands "$target_path" "$yaml_file"
    sync_hooks "$target_path" "$yaml_file"
    sync_skills "$target_path" "$yaml_file"
    sync_scripts "$target_path" "$yaml_file"

    log_success "완료: $yaml_file"
}

# =============================================================================
# 메인
# =============================================================================

show_help() {
    echo "oh-my-toong Sync Tool"
    echo ""
    echo "사용법: $0 [옵션]"
    echo ""
    echo "옵션:"
    echo "  --dry-run    실제 변경 없이 미리보기만 출력"
    echo "  --help       이 도움말 표시"
    echo ""
}

main() {
    # 인자 파싱
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --dry-run)
                DRY_RUN=true
                shift
                ;;
            --help)
                show_help
                exit 0
                ;;
            *)
                log_error "알 수 없는 옵션: $1"
                show_help
                exit 1
                ;;
        esac
    done

    if [[ "$DRY_RUN" == true ]]; then
        log_warn "========== DRY-RUN 모드 (실제 변경 없음) =========="
    fi

    # 의존성 확인
    check_dependencies

    # 백업 세션 ID 생성 (전체 동기화당 하나)
    CURRENT_BACKUP_SESSION=$(generate_backup_session_id)
    log_info "백업 세션: $CURRENT_BACKUP_SESSION"
    log_info "백업 위치: $ROOT_DIR/.sync-backup/$CURRENT_BACKUP_SESSION/"

    # 처리된 경로 추적 (projects/ YAML 우선) - Bash 3.2 호환
    local processed_paths=""

    # projects/**/sync.yaml 먼저 처리
    if [[ -d "$ROOT_DIR/projects" ]]; then
        while IFS= read -r yaml_file; do
            if [[ -n "$yaml_file" ]]; then
                local path=$(yq '.path // ""' "$yaml_file")
                if [[ -n "$path" && "$path" != "null" ]]; then
                    process_yaml "$yaml_file" "false"
                    processed_paths="${processed_paths}|${path}|"
                fi
            fi
        done < <(find "$ROOT_DIR/projects" -name "sync.yaml" 2>/dev/null || true)
    fi

    # 루트 sync.yaml 처리 (이미 처리된 path는 스킵)
    local root_yaml="$ROOT_DIR/sync.yaml"
    if [[ -f "$root_yaml" ]]; then
        local path=$(yq '.path // ""' "$root_yaml")
        if [[ -n "$path" && "$path" != "null" ]]; then
            if [[ "$processed_paths" != *"|${path}|"* ]]; then
                process_yaml "$root_yaml" "true"
            else
                log_warn "$path는 projects/에서 이미 처리됨, 스킵"
            fi
        else
            log_info "루트 sync.yaml에 path가 정의되지 않음 (템플릿 상태)"
        fi
    fi

    # config.yaml에서 백업 유효기간 읽기 (root에서 읽음)
    local config_file="$ROOT_DIR/config.yaml"
    local retention_days=""
    if [[ -f "$config_file" ]]; then
        retention_days=$(yq '.backup_retention_days // ""' "$config_file")
    fi

    # 오래된 백업 정리 (비동기, 실패해도 무시)
    if [[ -n "$retention_days" && "$retention_days" != "null" && "$DRY_RUN" != true ]]; then
        log_info "백업 유효기간: ${retention_days}일 (오래된 백업 비동기 정리)"
        cleanup_old_backups "$retention_days" "$CURRENT_BACKUP_SESSION" &
    fi

    if [[ "$DRY_RUN" == true ]]; then
        log_warn "========== DRY-RUN 완료 =========="
    else
        log_success "========== 동기화 완료 =========="
    fi
}

main "$@"

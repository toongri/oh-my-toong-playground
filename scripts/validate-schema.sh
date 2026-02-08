#!/bin/bash
set -euo pipefail

# =============================================================================
# sync.yaml 스키마 검증
# YAML 문법, 지원 필드, 값 유효성 검사
# Only supports new format (object with items)
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# 색상
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ERROR_COUNT=0

log_error() {
    echo -e "${RED}[SCHEMA]${NC} $1" >&2
    ((ERROR_COUNT++)) || true
}

log_warn() {
    echo -e "${YELLOW}[SCHEMA]${NC} $1" >&2
}

log_success() {
    echo -e "${GREEN}[SCHEMA]${NC} $1" >&2
}

# =============================================================================
# 유효한 값 정의
# =============================================================================

VALID_TOP_LEVEL_FIELDS="name path agents commands hooks skills scripts platforms"

# Section-level fields (new format: object with items)
VALID_AGENT_SECTION_FIELDS="platforms items"
VALID_COMMAND_SECTION_FIELDS="platforms items"
VALID_HOOK_SECTION_FIELDS="platforms items"
VALID_SKILL_SECTION_FIELDS="platforms items"
VALID_SCRIPT_SECTION_FIELDS="platforms items"

# Item-level fields (inside items array, for objects)
VALID_AGENT_ITEM_FIELDS="component add-skills add-hooks platforms"
VALID_COMMAND_ITEM_FIELDS="component platforms"
VALID_HOOK_ITEM_FIELDS="component event matcher type timeout command prompt platforms"
VALID_SKILL_ITEM_FIELDS="component platforms"
VALID_SCRIPT_ITEM_FIELDS="component platforms"

VALID_ADD_HOOK_ITEM_FIELDS="event component command type matcher timeout prompt"

VALID_EVENTS="SessionStart UserPromptSubmit PreToolUse PostToolUse Stop SubagentStop"
VALID_HOOK_TYPES="command prompt"
VALID_TARGETS="claude gemini codex"

# CLI-specific limitations (for warnings)
# Format: "cli:category" = fallback/limited/skip
CLI_GEMINI_FALLBACK="agents"
CLI_CODEX_FALLBACK="agents commands"
CLI_CODEX_LIMITED="hooks"

# =============================================================================
# 검증 함수
# =============================================================================

check_yaml_syntax() {
    local yaml_file="$1"
    if ! yq '.' "$yaml_file" > /dev/null 2>&1; then
        log_error "YAML 문법 오류: $yaml_file"
        return 1
    fi
    return 0
}

check_unknown_fields() {
    local yaml_file="$1"
    local path="$2"
    local valid_fields="$3"
    local context="$4"

    local actual_fields=$(yq "$path | keys | .[]" "$yaml_file" 2>/dev/null || echo "")

    for field in $actual_fields; do
        if [[ ! " $valid_fields " =~ " $field " ]]; then
            log_error "$context: 알 수 없는 필드 '$field' (지원: $valid_fields)"
        fi
    done
}

check_project_component_format() {
    local value="$1"
    local context="$2"

    # : 가 포함되어 있으면 {project}:{name} 형식이어야 함
    if [[ "$value" == *:* ]]; then
        local project=$(echo "$value" | cut -d: -f1)
        local name=$(echo "$value" | cut -d: -f2-)

        if [[ -z "$project" || -z "$name" ]]; then
            log_error "$context: 잘못된 형식 '$value' (올바른 형식: {project}:{name})"
        fi

        # : 가 2개 이상이면 오류
        local colon_count=$(echo "$value" | tr -cd ':' | wc -c)
        if [[ $colon_count -gt 1 ]]; then
            log_error "$context: ':' 가 너무 많음 '$value' (올바른 형식: {project}:{name})"
        fi
    fi
}

check_platforms_values() {
    local yaml_file="$1"
    local path="$2"
    local context="$3"

    local platforms_value=$(yq "$path // null" "$yaml_file")
    if [[ "$platforms_value" == "null" ]]; then
        return 0
    fi

    local platforms_count=$(yq "$path | length" "$yaml_file")
    if [[ $platforms_count -eq 0 ]]; then
        return 0
    fi

    for i in $(seq 0 $((platforms_count - 1))); do
        local platform=$(yq "$path[$i]" "$yaml_file")
        if [[ -n "$platform" && "$platform" != "null" ]]; then
            if [[ ! " $VALID_TARGETS " =~ " $platform " ]]; then
                log_error "$context: 잘못된 플랫폼 '$platform' (지원: $VALID_TARGETS)"
            fi
        fi
    done
}

# Warn about CLI-specific limitations
warn_cli_limitations() {
    local yaml_file="$1"
    local category="$2"  # agents, commands, hooks, skills
    local platforms_json="$3"  # JSON array of platforms

    # Parse platforms from JSON array
    for target in $(echo "$platforms_json" | jq -r '.[]' 2>/dev/null); do
        case "$target:$category" in
            gemini:agents)
                log_warn "Gemini: agents는 GEMINI.md fallback으로 동기화됩니다 (네이티브 subagent 미지원)"
                ;;
            codex:agents)
                log_warn "Codex: agents는 AGENTS.md fallback으로 동기화됩니다 (네이티브 subagent 미지원)"
                ;;
            codex:commands)
                log_warn "Codex: commands는 project-local이 아닌 ~/.codex/prompts/ (global)입니다"
                ;;
            codex:hooks)
                log_warn "Codex: Notification event만 지원됩니다 (다른 hook events는 skip됩니다)"
                ;;
        esac
    done
}

# Check if section uses new format (object with items) - rejects old array format
check_new_format() {
    local yaml_file="$1"
    local section="$2"

    local section_type=$(yq ".$section | type" "$yaml_file" 2>/dev/null || echo "null")
    if [[ "$section_type" == "!!seq" ]]; then
        log_error "$section: 기존 배열 형식은 더 이상 지원되지 않습니다. items 형식을 사용하세요."
        return 1
    fi
    return 0
}

# =============================================================================
# Section validation functions
# =============================================================================

validate_agents() {
    local yaml_file="$1"
    local platforms_json="$2"

    local field_exists=$(yq '.agents' "$yaml_file")
    if [[ "$field_exists" == "null" ]]; then
        return 0
    fi

    # Reject old array format
    if ! check_new_format "$yaml_file" "agents"; then
        return 0
    fi

    # New format: object with platforms and items
    check_unknown_fields "$yaml_file" ".agents" "$VALID_AGENT_SECTION_FIELDS" "agents"
    check_platforms_values "$yaml_file" ".agents.platforms" "agents.platforms"

    # Get section-level platforms
    local section_platforms=$(yq -o=json '.agents.platforms // null' "$yaml_file")
    if [[ "$section_platforms" == "null" ]]; then
        section_platforms="$platforms_json"
    fi

    local count=$(yq '.agents.items | length // 0' "$yaml_file")
    for i in $(seq 0 $((count - 1))); do
        # Check item type directly (not in subshell)
        local item_type=$(yq ".agents.items[$i] | type" "$yaml_file")
        local component
        local is_object_item=false

        if [[ "$item_type" == "!!str" ]]; then
            component=$(yq ".agents.items[$i]" "$yaml_file")
        else
            is_object_item=true
            component=$(yq ".agents.items[$i].component // \"\"" "$yaml_file")
        fi

        if [[ "$is_object_item" == "true" ]]; then
            check_unknown_fields "$yaml_file" ".agents.items[$i]" "$VALID_AGENT_ITEM_FIELDS" "agents.items[$i]"

            if [[ -n "$component" && "$component" != "null" ]]; then
                check_project_component_format "$component" "agents.items[$i].component"
            fi

            # add-skills 검증
            local has_add_skills=$(yq ".agents.items[$i].add-skills // null" "$yaml_file")
            if [[ "$has_add_skills" != "null" ]]; then
                local skills_count=$(yq ".agents.items[$i].add-skills | length" "$yaml_file")
                if [[ $skills_count -gt 0 ]]; then
                    for j in $(seq 0 $((skills_count - 1))); do
                        local skill=$(yq ".agents.items[$i].add-skills[$j]" "$yaml_file")
                        if [[ -n "$skill" && "$skill" != "null" ]]; then
                            check_project_component_format "$skill" "agents.items[$i].add-skills[$j]"
                        fi
                    done
                fi
            fi

            # add-hooks 검증
            local has_add_hooks=$(yq ".agents.items[$i].add-hooks // null" "$yaml_file")
            if [[ "$has_add_hooks" != "null" ]]; then
                local hooks_count=$(yq ".agents.items[$i].add-hooks | length" "$yaml_file")
                if [[ $hooks_count -gt 0 ]]; then
                    for j in $(seq 0 $((hooks_count - 1))); do
                        check_unknown_fields "$yaml_file" ".agents.items[$i].add-hooks[$j]" "$VALID_ADD_HOOK_ITEM_FIELDS" "agents.items[$i].add-hooks[$j]"

                        # event 값 검증
                        local hook_event=$(yq ".agents.items[$i].add-hooks[$j].event // \"\"" "$yaml_file")
                        if [[ -n "$hook_event" && "$hook_event" != "null" ]]; then
                            if [[ ! " $VALID_EVENTS " =~ " $hook_event " ]]; then
                                log_error "agents.items[$i].add-hooks[$j].event: 잘못된 값 '$hook_event' (지원: $VALID_EVENTS)"
                            fi
                        fi

                        # type 값 검증
                        local hook_type=$(yq ".agents.items[$i].add-hooks[$j].type // \"\"" "$yaml_file")
                        if [[ -n "$hook_type" && "$hook_type" != "null" ]]; then
                            if [[ ! " $VALID_HOOK_TYPES " =~ " $hook_type " ]]; then
                                log_error "agents.items[$i].add-hooks[$j].type: 잘못된 값 '$hook_type' (지원: $VALID_HOOK_TYPES)"
                            fi
                        fi

                        # component 형식 검증
                        local hook_component=$(yq ".agents.items[$i].add-hooks[$j].component // \"\"" "$yaml_file")
                        if [[ -n "$hook_component" && "$hook_component" != "null" ]]; then
                            check_project_component_format "$hook_component" "agents.items[$i].add-hooks[$j].component"
                        fi
                    done
                fi
            fi

            # platforms 검증
            check_platforms_values "$yaml_file" ".agents.items[$i].platforms" "agents.items[$i].platforms"
            local item_platforms=$(yq -o=json ".agents.items[$i].platforms // null" "$yaml_file")
            if [[ "$item_platforms" == "null" ]]; then
                item_platforms="$section_platforms"
            fi
            warn_cli_limitations "$yaml_file" "agents" "$item_platforms"
        else
            # String item - just validate component format
            if [[ -n "$component" && "$component" != "null" ]]; then
                check_project_component_format "$component" "agents.items[$i]"
            fi
            warn_cli_limitations "$yaml_file" "agents" "$section_platforms"
        fi
    done
}

validate_commands() {
    local yaml_file="$1"
    local platforms_json="$2"

    local field_exists=$(yq '.commands' "$yaml_file")
    if [[ "$field_exists" == "null" ]]; then
        return 0
    fi

    # Reject old array format
    if ! check_new_format "$yaml_file" "commands"; then
        return 0
    fi

    # New format: object with platforms and items
    check_unknown_fields "$yaml_file" ".commands" "$VALID_COMMAND_SECTION_FIELDS" "commands"
    check_platforms_values "$yaml_file" ".commands.platforms" "commands.platforms"

    local section_platforms=$(yq -o=json '.commands.platforms // null' "$yaml_file")
    if [[ "$section_platforms" == "null" ]]; then
        section_platforms="$platforms_json"
    fi

    local count=$(yq '.commands.items | length // 0' "$yaml_file")
    for i in $(seq 0 $((count - 1))); do
        # Check item type directly (not in subshell)
        local item_type=$(yq ".commands.items[$i] | type" "$yaml_file")
        local component
        local is_object_item=false

        if [[ "$item_type" == "!!str" ]]; then
            component=$(yq ".commands.items[$i]" "$yaml_file")
        else
            is_object_item=true
            component=$(yq ".commands.items[$i].component // \"\"" "$yaml_file")
        fi

        if [[ "$is_object_item" == "true" ]]; then
            check_unknown_fields "$yaml_file" ".commands.items[$i]" "$VALID_COMMAND_ITEM_FIELDS" "commands.items[$i]"

            if [[ -n "$component" && "$component" != "null" ]]; then
                check_project_component_format "$component" "commands.items[$i].component"
            fi

            check_platforms_values "$yaml_file" ".commands.items[$i].platforms" "commands.items[$i].platforms"
            local item_platforms=$(yq -o=json ".commands.items[$i].platforms // null" "$yaml_file")
            if [[ "$item_platforms" == "null" ]]; then
                item_platforms="$section_platforms"
            fi
            warn_cli_limitations "$yaml_file" "commands" "$item_platforms"
        else
            if [[ -n "$component" && "$component" != "null" ]]; then
                check_project_component_format "$component" "commands.items[$i]"
            fi
            warn_cli_limitations "$yaml_file" "commands" "$section_platforms"
        fi
    done
}

validate_hooks() {
    local yaml_file="$1"
    local platforms_json="$2"

    local field_exists=$(yq '.hooks' "$yaml_file")
    if [[ "$field_exists" == "null" ]]; then
        return 0
    fi

    # Reject old array format
    if ! check_new_format "$yaml_file" "hooks"; then
        return 0
    fi

    # New format: object with platforms and items
    check_unknown_fields "$yaml_file" ".hooks" "$VALID_HOOK_SECTION_FIELDS" "hooks"
    check_platforms_values "$yaml_file" ".hooks.platforms" "hooks.platforms"

    local section_platforms=$(yq -o=json '.hooks.platforms // null' "$yaml_file")
    if [[ "$section_platforms" == "null" ]]; then
        section_platforms="$platforms_json"
    fi

    local count=$(yq '.hooks.items | length // 0' "$yaml_file")
    for i in $(seq 0 $((count - 1))); do
        # Hooks items are always objects (have event, component, etc.)
        check_unknown_fields "$yaml_file" ".hooks.items[$i]" "$VALID_HOOK_ITEM_FIELDS" "hooks.items[$i]"

        local component=$(yq ".hooks.items[$i].component // \"\"" "$yaml_file")
        if [[ -n "$component" && "$component" != "null" ]]; then
            check_project_component_format "$component" "hooks.items[$i].component"
        fi

        # event 값 검증
        local event=$(yq ".hooks.items[$i].event // \"\"" "$yaml_file")
        if [[ -n "$event" && "$event" != "null" ]]; then
            if [[ ! " $VALID_EVENTS " =~ " $event " ]]; then
                log_error "hooks.items[$i].event: 잘못된 값 '$event' (지원: $VALID_EVENTS)"
            fi
        fi

        # type 값 검증
        local hook_type=$(yq ".hooks.items[$i].type // \"\"" "$yaml_file")
        if [[ -n "$hook_type" && "$hook_type" != "null" ]]; then
            if [[ ! " $VALID_HOOK_TYPES " =~ " $hook_type " ]]; then
                log_error "hooks.items[$i].type: 잘못된 값 '$hook_type' (지원: $VALID_HOOK_TYPES)"
            fi
        fi

        check_platforms_values "$yaml_file" ".hooks.items[$i].platforms" "hooks.items[$i].platforms"
        local item_platforms=$(yq -o=json ".hooks.items[$i].platforms // null" "$yaml_file")
        if [[ "$item_platforms" == "null" ]]; then
            item_platforms="$section_platforms"
        fi
        warn_cli_limitations "$yaml_file" "hooks" "$item_platforms"
    done
}

validate_skills() {
    local yaml_file="$1"
    local platforms_json="$2"

    local field_exists=$(yq '.skills' "$yaml_file")
    if [[ "$field_exists" == "null" ]]; then
        return 0
    fi

    # Reject old array format
    if ! check_new_format "$yaml_file" "skills"; then
        return 0
    fi

    # New format: object with platforms and items
    check_unknown_fields "$yaml_file" ".skills" "$VALID_SKILL_SECTION_FIELDS" "skills"
    check_platforms_values "$yaml_file" ".skills.platforms" "skills.platforms"

    local section_platforms=$(yq -o=json '.skills.platforms // null' "$yaml_file")
    if [[ "$section_platforms" == "null" ]]; then
        section_platforms="$platforms_json"
    fi

    local count=$(yq '.skills.items | length // 0' "$yaml_file")
    for i in $(seq 0 $((count - 1))); do
        # Check item type directly (not in subshell)
        local item_type=$(yq ".skills.items[$i] | type" "$yaml_file")
        local component
        local is_object_item=false

        if [[ "$item_type" == "!!str" ]]; then
            component=$(yq ".skills.items[$i]" "$yaml_file")
        else
            is_object_item=true
            component=$(yq ".skills.items[$i].component // \"\"" "$yaml_file")
        fi

        if [[ "$is_object_item" == "true" ]]; then
            check_unknown_fields "$yaml_file" ".skills.items[$i]" "$VALID_SKILL_ITEM_FIELDS" "skills.items[$i]"

            if [[ -n "$component" && "$component" != "null" ]]; then
                check_project_component_format "$component" "skills.items[$i].component"
            fi

            check_platforms_values "$yaml_file" ".skills.items[$i].platforms" "skills.items[$i].platforms"
            local item_platforms=$(yq -o=json ".skills.items[$i].platforms // null" "$yaml_file")
            if [[ "$item_platforms" == "null" ]]; then
                item_platforms="$section_platforms"
            fi
            warn_cli_limitations "$yaml_file" "skills" "$item_platforms"
        else
            if [[ -n "$component" && "$component" != "null" ]]; then
                check_project_component_format "$component" "skills.items[$i]"
            fi
            warn_cli_limitations "$yaml_file" "skills" "$section_platforms"
        fi
    done
}

validate_scripts() {
    local yaml_file="$1"
    local platforms_json="$2"

    local field_exists=$(yq '.scripts' "$yaml_file")
    if [[ "$field_exists" == "null" ]]; then
        return 0
    fi

    # Reject old array format
    if ! check_new_format "$yaml_file" "scripts"; then
        return 0
    fi

    # New format: object with platforms and items
    check_unknown_fields "$yaml_file" ".scripts" "$VALID_SCRIPT_SECTION_FIELDS" "scripts"
    check_platforms_values "$yaml_file" ".scripts.platforms" "scripts.platforms"

    local section_platforms=$(yq -o=json '.scripts.platforms // null' "$yaml_file")
    if [[ "$section_platforms" == "null" ]]; then
        section_platforms="$platforms_json"
    fi

    local count=$(yq '.scripts.items | length // 0' "$yaml_file")
    for i in $(seq 0 $((count - 1))); do
        local item_type=$(yq ".scripts.items[$i] | type" "$yaml_file")
        local component
        local is_object_item=false

        if [[ "$item_type" == "!!str" ]]; then
            component=$(yq ".scripts.items[$i]" "$yaml_file")
        else
            is_object_item=true
            component=$(yq ".scripts.items[$i].component // \"\"" "$yaml_file")
        fi

        if [[ "$is_object_item" == "true" ]]; then
            check_unknown_fields "$yaml_file" ".scripts.items[$i]" "$VALID_SCRIPT_ITEM_FIELDS" "scripts.items[$i]"

            if [[ -n "$component" && "$component" != "null" ]]; then
                check_project_component_format "$component" "scripts.items[$i].component"
            fi

            check_platforms_values "$yaml_file" ".scripts.items[$i].platforms" "scripts.items[$i].platforms"
            local item_platforms=$(yq -o=json ".scripts.items[$i].platforms // null" "$yaml_file")
            if [[ "$item_platforms" == "null" ]]; then
                item_platforms="$section_platforms"
            fi
            warn_cli_limitations "$yaml_file" "scripts" "$item_platforms"
        else
            if [[ -n "$component" && "$component" != "null" ]]; then
                check_project_component_format "$component" "scripts.items[$i]"
            fi
            warn_cli_limitations "$yaml_file" "scripts" "$section_platforms"
        fi
    done
}

validate_yaml_schema() {
    local yaml_file="$1"
    local yaml_name=$(basename "$yaml_file")

    # YAML 문법 검증
    if ! check_yaml_syntax "$yaml_file"; then
        return 1
    fi

    # platforms 가져오기 (CLI 제한 경고에 사용)
    local platforms_json=$(yq -o=json '.platforms // ["claude"]' "$yaml_file")

    # top-level 필드 검증
    check_unknown_fields "$yaml_file" "." "$VALID_TOP_LEVEL_FIELDS" "root"

    # platforms 검증
    check_platforms_values "$yaml_file" ".platforms" "platforms"

    # 각 섹션 검증
    validate_agents "$yaml_file" "$platforms_json"
    validate_commands "$yaml_file" "$platforms_json"
    validate_hooks "$yaml_file" "$platforms_json"
    validate_skills "$yaml_file" "$platforms_json"
    validate_scripts "$yaml_file" "$platforms_json"

    return 0
}

# =============================================================================
# 메인
# =============================================================================

main() {
    local target_file="${1:-}"

    if [[ -n "$target_file" && -f "$target_file" ]]; then
        # 특정 파일만 검증
        validate_yaml_schema "$target_file"
    else
        # 모든 sync.yaml 검증
        if [[ -d "$ROOT_DIR/projects" ]]; then
            while IFS= read -r yaml_file; do
                if [[ -n "$yaml_file" ]]; then
                    validate_yaml_schema "$yaml_file"
                fi
            done < <(find "$ROOT_DIR/projects" -name "sync.yaml" 2>/dev/null || true)
        fi

        if [[ -f "$ROOT_DIR/sync.yaml" ]]; then
            validate_yaml_schema "$ROOT_DIR/sync.yaml"
        fi
    fi

    if [[ $ERROR_COUNT -gt 0 ]]; then
        log_error "스키마 검증 실패: $ERROR_COUNT 개 오류"
        exit 1
    else
        log_success "스키마 검증 통과"
        exit 0
    fi
}

main "$@"

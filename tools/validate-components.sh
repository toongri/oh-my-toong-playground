#!/bin/bash
set -euo pipefail

# =============================================================================
# sync.yaml 컴포넌트 존재 검증
# 참조된 파일/디렉토리가 실제로 존재하는지 확인
# Only supports new format (object with items)
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

source "${ACTUAL_ROOT_DIR:-${SCRIPT_DIR}}/lib/common.sh"

ERROR_COUNT=0
WARN_COUNT=0

log_info() {
    echo -e "${BLUE}[COMPONENT]${NC} $1" >&2
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
    ((ERROR_COUNT++)) || true
}

log_warn() {
    echo -e "${YELLOW}[COMPONENT]${NC} $1" >&2
    ((WARN_COUNT++)) || true
}

log_success() {
    echo -e "${GREEN}[COMPONENT]${NC} $1" >&2
}

# =============================================================================
# Project Context
# =============================================================================

CURRENT_PROJECT_CONTEXT=""
CURRENT_PROJECT_DIR=""
IS_ROOT_YAML_CONTEXT=false

# =============================================================================
# Scoped Component Validation
# =============================================================================

# Validate component reference with project scoping
# Returns 0 if valid, 1 if invalid (logs error)
# Delegates existence resolution to resolve_scoped_source_path() from common.sh
validate_scoped_component() {
    local category="$1"
    local name="$2"
    local extension="$3"  # ".md" for files, "" for directories

    if ! resolve_scoped_source_path "$category" "$name" "$extension"; then
        log_error "$SCOPED_RESOLUTION_ERROR"
        # For project context "not found" case, also show search paths
        if [[ "$IS_ROOT_YAML_CONTEXT" == false && "$SCOPED_RESOLUTION_ERROR" == "Component not found"* ]]; then
            local parsed_item="$name"
            [[ "$name" == *:* ]] && parsed_item=$(echo "$name" | cut -d: -f2-)
            log_info "  Searched: $ROOT_DIR/projects/$CURRENT_PROJECT_DIR/$category/${parsed_item}${extension}"
            log_info "  Searched: $ROOT_DIR/$category/${parsed_item}${extension}"
        fi
        return 1
    fi

    return 0
}

# =============================================================================
# Hook Directory Index Validation
# =============================================================================

# After validate_scoped_component passes for a hook, check that a resolved
# directory contains index.ts or index.sh (mirrors sync.sh runtime contract)
check_hook_directory_index() {
    local name="$1"

    local parsed_item="$name"
    if [[ "$name" == *:* ]]; then
        parsed_item=$(echo "$name" | cut -d: -f2-)
    fi

    local resolved_dir=""

    if [[ "$IS_ROOT_YAML_CONTEXT" == true ]]; then
        local global_path="$ROOT_DIR/hooks/${parsed_item}"
        [[ -d "$global_path" ]] && resolved_dir="$global_path"
    else
        local project_path="$ROOT_DIR/projects/$CURRENT_PROJECT_DIR/hooks/${parsed_item}"
        local global_path="$ROOT_DIR/hooks/${parsed_item}"
        if [[ -d "$project_path" ]]; then
            resolved_dir="$project_path"
        elif [[ -d "$global_path" ]]; then
            resolved_dir="$global_path"
        fi
    fi

    if [[ -n "$resolved_dir" ]]; then
        if [[ ! -f "$resolved_dir/index.ts" ]] && [[ ! -f "$resolved_dir/index.sh" ]]; then
            log_error "Hook directory '$parsed_item' missing index.ts or index.sh: $resolved_dir"
        fi
    fi
}

# =============================================================================
# Item Component Helper
# =============================================================================

# Global variable for get_item_component
ITEM_IS_OBJECT=false

# Get item from items array - handles both string and object format
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
# 검증 함수
# =============================================================================

validate_components() {
    local yaml_file="$1"
    local yaml_name=$(basename "$(dirname "$yaml_file")")/$(basename "$yaml_file")

    log_info "검증 중: $yaml_name"

    # Determine if this is root yaml
    local is_root="false"
    if [[ "$yaml_file" == "$ROOT_DIR/sync.yaml" ]]; then
        is_root="true"
    fi

    # Set project context
    if [[ "$is_root" == "true" ]]; then
        CURRENT_PROJECT_CONTEXT=""
        CURRENT_PROJECT_DIR=""
        IS_ROOT_YAML_CONTEXT=true
    else
        # Directory name is always used for file path resolution
        CURRENT_PROJECT_DIR=$(basename "$(dirname "$yaml_file")")

        # Project name: yaml name field first, then directory name (for cross-project validation)
        local yaml_name_field=$(yq '.name // ""' "$yaml_file" 2>/dev/null)
        if [[ -n "$yaml_name_field" && "$yaml_name_field" != "null" ]]; then
            CURRENT_PROJECT_CONTEXT="$yaml_name_field"
        else
            CURRENT_PROJECT_CONTEXT="$CURRENT_PROJECT_DIR"
        fi
        IS_ROOT_YAML_CONTEXT=false
    fi

    # path 필드 확인
    local target_path=$(yq '.path // ""' "$yaml_file")
    if [[ -z "$target_path" || "$target_path" == "null" ]]; then
        log_warn "path가 정의되지 않음 (템플릿 상태)"
        return 0
    fi

    # CLI 프로젝트 파일 검증 (path가 있는 경우만)
    validate_cli_project_files "$yaml_file" "$target_path"

    # agents 검증 (새 형식만 지원)
    local field_exists=$(yq '.agents' "$yaml_file")
    if [[ "$field_exists" != "null" ]]; then
        local count=$(yq '.agents.items | length // 0' "$yaml_file")
        if [[ $count -gt 0 ]]; then
            for i in $(seq 0 $((count - 1))); do
                local component
                local item_type
                item_type=$(yq ".agents.items[$i] | type" "$yaml_file")
                if [[ "$item_type" == "!!str" ]]; then
                    ITEM_IS_OBJECT=false
                else
                    ITEM_IS_OBJECT=true
                fi
                component=$(get_item_component "$yaml_file" "agents" "$i")

                if [[ -n "$component" && "$component" != "null" ]]; then
                    # Accept agents/<name>.md (flat) or agents/<name>/index.md (folder-based)
                    if [[ "$component" != *:* ]]; then
                        # Non-scoped: try fast-path first
                        local flat_path="$ROOT_DIR/agents/${component}.md"
                        local index_path="$ROOT_DIR/agents/${component}/index.md"
                        if [[ -f "$flat_path" || -f "$index_path" ]]; then
                            : # found
                        else
                            validate_scoped_component "agents" "$component" ".md" || true
                        fi
                    else
                        # Scoped: must go through scoping validation (cross-project refs are rejected)
                        validate_scoped_component "agents" "$component" ".md" || true
                    fi
                fi

                # add-skills 검증 (only for object items)
                if [[ "$ITEM_IS_OBJECT" == "true" ]]; then
                    local has_add_skills=$(yq ".agents.items[$i].add-skills // null" "$yaml_file")
                    if [[ "$has_add_skills" != "null" ]]; then
                        local skills_count=$(yq ".agents.items[$i].add-skills | length" "$yaml_file")
                        if [[ $skills_count -gt 0 ]]; then
                            for j in $(seq 0 $((skills_count - 1))); do
                                local skill=$(yq ".agents.items[$i].add-skills[$j]" "$yaml_file")
                                if [[ -n "$skill" && "$skill" != "null" ]]; then
                                    local in_skills=$(yq ".skills.items[]" "$yaml_file" 2>/dev/null | grep -E "(^${skill}$|:${skill}$)" | head -1 || echo "")
                                    if [[ -z "$in_skills" ]]; then
                                        resolve_source_path "skills" "$skill" ""
                                        if [[ ! -d "$SOURCE_PATH" ]]; then
                                            log_warn "add-skills '$skill'가 skills 섹션에 없고 소스도 없음"
                                        fi
                                    fi
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
                                local hook_component=$(yq ".agents.items[$i].add-hooks[$j].component // \"\"" "$yaml_file")
                                if [[ -n "$hook_component" && "$hook_component" != "null" ]]; then
                                    validate_scoped_component "hooks" "$hook_component" "" || true
                                    check_hook_directory_index "$hook_component"
                                fi
                            done
                        fi
                    fi
                fi
            done
        fi
    fi

    # commands 검증 (새 형식만 지원)
    field_exists=$(yq '.commands' "$yaml_file")
    if [[ "$field_exists" != "null" ]]; then
        local count=$(yq '.commands.items | length // 0' "$yaml_file")
        if [[ $count -gt 0 ]]; then
            for i in $(seq 0 $((count - 1))); do
                local component
                component=$(get_item_component "$yaml_file" "commands" "$i")

                if [[ -n "$component" && "$component" != "null" ]]; then
                    validate_scoped_component "commands" "$component" ".md" || true
                fi
            done
        fi
    fi

    # hooks 검증 (새 형식만 지원, component가 있는 경우만)
    field_exists=$(yq '.hooks' "$yaml_file")
    if [[ "$field_exists" != "null" ]]; then
        local count=$(yq '.hooks.items | length // 0' "$yaml_file")
        if [[ $count -gt 0 ]]; then
            for i in $(seq 0 $((count - 1))); do
                local component=$(yq ".hooks.items[$i].component // \"\"" "$yaml_file")
                if [[ -n "$component" && "$component" != "null" ]]; then
                    validate_scoped_component "hooks" "$component" "" || true
                    check_hook_directory_index "$component"
                fi
            done
        fi
    fi

    # skills 검증 (새 형식만 지원)
    field_exists=$(yq '.skills' "$yaml_file")
    if [[ "$field_exists" != "null" ]]; then
        local count=$(yq '.skills.items | length // 0' "$yaml_file")
        if [[ $count -gt 0 ]]; then
            for i in $(seq 0 $((count - 1))); do
                local component
                component=$(get_item_component "$yaml_file" "skills" "$i")

                if [[ -n "$component" && "$component" != "null" ]]; then
                    validate_scoped_component "skills" "$component" "" || true
                fi
            done
        fi
    fi

    # rules 검증 (새 형식만 지원)
    field_exists=$(yq '.rules' "$yaml_file")
    if [[ "$field_exists" != "null" ]]; then
        local count=$(yq '.rules.items | length // 0' "$yaml_file")
        if [[ $count -gt 0 ]]; then
            for i in $(seq 0 $((count - 1))); do
                local component
                component=$(get_item_component "$yaml_file" "rules" "$i")

                if [[ -n "$component" && "$component" != "null" ]]; then
                    validate_scoped_component "rules" "$component" ".md" || true
                fi
            done
        fi
    fi

    # mcps 검증 (새 형식만 지원, .yaml 확장자)
    field_exists=$(yq '.mcps' "$yaml_file")
    if [[ "$field_exists" != "null" ]]; then
        local count=$(yq '.mcps.items | length // 0' "$yaml_file")
        if [[ $count -gt 0 ]]; then
            for i in $(seq 0 $((count - 1))); do
                local component
                component=$(get_item_component "$yaml_file" "mcps" "$i")

                if [[ -n "$component" && "$component" != "null" ]]; then
                    validate_scoped_component "mcps" "$component" ".yaml" || true
                fi
            done
        fi
    fi

    # plugins 검증 건너뜀 (외부 패키지 - 소스 파일 없음)

    return 0
}

# =============================================================================
# 메인
# =============================================================================

main() {
    local quiet=false

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --quiet)
                quiet=true
                shift
                ;;
            *)
                shift
                ;;
        esac
    done

    # 모든 sync.yaml 검증
    if [[ -d "$ROOT_DIR/projects" ]]; then
        while IFS= read -r yaml_file; do
            if [[ -n "$yaml_file" ]]; then
                validate_components "$yaml_file"
            fi
        done < <(find "$ROOT_DIR/projects" -name "sync.yaml" 2>/dev/null || true)
    fi

    if [[ -f "$ROOT_DIR/sync.yaml" ]]; then
        validate_components "$ROOT_DIR/sync.yaml"
    fi

    # 결과 출력
    if [[ $ERROR_COUNT -gt 0 ]]; then
        log_error "컴포넌트 검증 실패: $ERROR_COUNT 개 오류, $WARN_COUNT 개 경고"
        exit 1
    elif [[ $WARN_COUNT -gt 0 ]]; then
        log_warn "컴포넌트 검증 완료: $WARN_COUNT 개 경고"
        exit 0
    else
        log_success "컴포넌트 검증 통과"
        exit 0
    fi
}

main "$@"

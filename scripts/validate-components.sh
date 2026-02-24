#!/bin/bash
set -euo pipefail

# =============================================================================
# sync.yaml 컴포넌트 존재 검증
# 참조된 파일/디렉토리가 실제로 존재하는지 확인
# Only supports new format (object with items)
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# 색상
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

ERROR_COUNT=0
WARN_COUNT=0

log_info() {
    echo -e "${BLUE}[COMPONENT]${NC} $1" >&2
}

log_error() {
    echo -e "${RED}[COMPONENT]${NC} $1" >&2
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
# CLI 프로젝트 파일 매핑
# =============================================================================

# CLI별 프로젝트 파일 반환
# claude -> CLAUDE.md, gemini -> GEMINI.md, codex -> AGENTS.md
get_cli_project_file() {
    local cli="$1"
    case "$cli" in
        claude) echo "CLAUDE.md" ;;
        gemini) echo "GEMINI.md" ;;
        codex) echo "AGENTS.md" ;;
        *) echo "" ;;
    esac
}

# =============================================================================
# 소스 경로 해석
# =============================================================================

resolve_source_path() {
    local category="$1"
    local name="$2"
    local extension="$3"

    if [[ "$name" == *:* ]]; then
        local project=$(echo "$name" | cut -d: -f1)
        local item=$(echo "$name" | cut -d: -f2-)
        SOURCE_PATH="$ROOT_DIR/projects/$project/$category/${item}${extension}"
        DISPLAY_NAME="$item"
    else
        SOURCE_PATH="$ROOT_DIR/$category/${name}${extension}"
        DISPLAY_NAME="$name"
    fi
}

# =============================================================================
# Scoped Component Validation
# =============================================================================

# Validate component reference with project scoping
# Returns 0 if valid, 1 if invalid (sets error message)
validate_scoped_component() {
    local category="$1"
    local name="$2"
    local extension="$3"  # ".md" for files, "" for directories

    # Parse project prefix if present
    local parsed_project=""
    local parsed_item="$name"
    if [[ "$name" == *:* ]]; then
        parsed_project=$(echo "$name" | cut -d: -f1)
        parsed_item=$(echo "$name" | cut -d: -f2-)
    fi

    # Cross-project validation
    if [[ -n "$parsed_project" ]]; then
        if [[ "$IS_ROOT_YAML_CONTEXT" == true ]]; then
            log_error "Root sync.yaml cannot reference project components: $name"
            return 1
        elif [[ "$parsed_project" != "$CURRENT_PROJECT_CONTEXT" ]]; then
            log_error "Cross-project reference not allowed: $name (current: $CURRENT_PROJECT_CONTEXT)"
            return 1
        fi
    fi

    # Existence check with upward search
    # Note: extension="" means check for both file and directory (hooks have extension in name)
    if [[ "$IS_ROOT_YAML_CONTEXT" == true ]]; then
        local global_path="$ROOT_DIR/$category/${parsed_item}${extension}"
        local exists=false
        if [[ -n "$extension" ]]; then
            [[ -f "$global_path" ]] && exists=true
        else
            # Check both file and directory when extension is empty
            [[ -f "$global_path" || -d "$global_path" ]] && exists=true
        fi
        if [[ "$exists" == false ]]; then
            log_error "Component not found: $name -> $global_path"
            return 1
        fi
    else
        # Use CURRENT_PROJECT_DIR (directory name) for file path resolution
        local project_path="$ROOT_DIR/projects/$CURRENT_PROJECT_DIR/$category/${parsed_item}${extension}"
        local global_path="$ROOT_DIR/$category/${parsed_item}${extension}"

        local found=false
        if [[ -n "$extension" ]]; then
            # Extension provided - check files only
            [[ -f "$project_path" ]] && found=true
            [[ "$found" == false && -f "$global_path" ]] && found=true
        else
            # No extension - check both files and directories
            [[ -f "$project_path" || -d "$project_path" ]] && found=true
            [[ "$found" == false && ( -f "$global_path" || -d "$global_path" ) ]] && found=true
        fi

        if [[ "$found" == false ]]; then
            log_error "Component not found in project '$CURRENT_PROJECT_DIR' or global: $name"
            log_info "  Searched: $project_path"
            log_info "  Searched: $global_path"
            return 1
        fi
    fi

    return 0
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
# CLI 프로젝트 파일 검증
# =============================================================================

# sync.yaml에서 사용되는 모든 CLI 목록 수집 및 프로젝트 파일 검증
validate_cli_project_files() {
    local yaml_file="$1"
    local target_path="$2"

    # Bash 3.2 호환 - 사용되는 CLI 추적
    local used_claude=false
    local used_gemini=false
    local used_codex=false

    # platforms 수집
    local platforms_json=$(yq -o=json '.platforms // ["claude"]' "$yaml_file")
    for cli in $(echo "$platforms_json" | jq -r '.[]' 2>/dev/null); do
        case "$cli" in
            claude) used_claude=true ;;
            gemini) used_gemini=true ;;
            codex) used_codex=true ;;
        esac
    done

    # 각 카테고리에서 platforms 수집 (새 형식만 지원)
    local categories=("agents" "commands" "hooks" "skills")
    for category in "${categories[@]}"; do
        local field_exists=$(yq ".$category" "$yaml_file")
        if [[ "$field_exists" == "null" ]]; then
            continue
        fi

        # Check section-level platforms
        local section_platforms=$(yq -o=json ".$category.platforms // null" "$yaml_file")
        if [[ "$section_platforms" != "null" ]]; then
            for cli in $(echo "$section_platforms" | jq -r '.[]' 2>/dev/null); do
                case "$cli" in
                    claude) used_claude=true ;;
                    gemini) used_gemini=true ;;
                    codex) used_codex=true ;;
                esac
            done
        fi

        # Check item-level platforms
        local count=$(yq ".$category.items | length // 0" "$yaml_file")
        if [[ $count -gt 0 ]]; then
            for i in $(seq 0 $((count - 1))); do
                local item_type=$(yq ".$category.items[$i] | type" "$yaml_file")
                if [[ "$item_type" != "!!str" ]]; then
                    local component_platforms=$(yq -o=json ".$category.items[$i].platforms // null" "$yaml_file")
                    if [[ "$component_platforms" != "null" ]]; then
                        for cli in $(echo "$component_platforms" | jq -r '.[]' 2>/dev/null); do
                            case "$cli" in
                                claude) used_claude=true ;;
                                gemini) used_gemini=true ;;
                                codex) used_codex=true ;;
                            esac
                        done
                    fi
                fi
            done
        fi
    done

    # 각 CLI에 대해 프로젝트 파일 존재 확인
    if [[ "$used_claude" == true ]]; then
        local project_file=$(get_cli_project_file "claude")
        if [[ ! -f "$target_path/$project_file" && ! -f "$target_path/.claude/$project_file" ]]; then
            echo -e "${RED}[ERROR]${NC} CLI 프로젝트 파일 없음: $project_file (대상: $target_path)" >&2
            echo -e "        먼저 'init'을 실행하여 프로젝트를 초기화하세요." >&2
            ((ERROR_COUNT++)) || true
        fi
    fi

    if [[ "$used_gemini" == true ]]; then
        local project_file=$(get_cli_project_file "gemini")
        if [[ ! -f "$target_path/$project_file" ]]; then
            echo -e "${RED}[ERROR]${NC} CLI 프로젝트 파일 없음: $project_file (대상: $target_path)" >&2
            echo -e "        먼저 'init'을 실행하여 프로젝트를 초기화하세요." >&2
            ((ERROR_COUNT++)) || true
        fi
    fi

    if [[ "$used_codex" == true ]]; then
        local project_file=$(get_cli_project_file "codex")
        if [[ ! -f "$target_path/$project_file" ]]; then
            echo -e "${RED}[ERROR]${NC} CLI 프로젝트 파일 없음: $project_file (대상: $target_path)" >&2
            echo -e "        먼저 'init'을 실행하여 프로젝트를 초기화하세요." >&2
            ((ERROR_COUNT++)) || true
        fi
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
                component=$(get_item_component "$yaml_file" "agents" "$i")

                if [[ -n "$component" && "$component" != "null" ]]; then
                    validate_scoped_component "agents" "$component" ".md" || true
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

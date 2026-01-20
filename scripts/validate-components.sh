#!/bin/bash
set -euo pipefail

# =============================================================================
# sync.yaml 컴포넌트 존재 검증
# 참조된 파일/디렉토리가 실제로 존재하는지 확인
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
# 검증 함수
# =============================================================================

validate_components() {
    local yaml_file="$1"
    local yaml_name=$(basename "$(dirname "$yaml_file")")/$(basename "$yaml_file")

    log_info "검증 중: $yaml_name"

    # path 필드 확인
    local target_path=$(yq '.path // ""' "$yaml_file")
    if [[ -z "$target_path" || "$target_path" == "null" ]]; then
        log_warn "path가 정의되지 않음 (템플릿 상태)"
        return 0
    fi

    # agents 검증
    local agent_count=$(yq '.agents | length // 0' "$yaml_file")
    if [[ $agent_count -gt 0 ]]; then
        for i in $(seq 0 $((agent_count - 1))); do
            local component=$(yq ".agents[$i].component // \"\"" "$yaml_file")
            if [[ -n "$component" && "$component" != "null" ]]; then
                resolve_source_path "agents" "$component" ".md"
                if [[ ! -f "$SOURCE_PATH" ]]; then
                    log_error "Agent 파일 없음: $component -> $SOURCE_PATH"
                fi
            fi

            # add-skills 검증 (skills 섹션에 있거나 소스 존재해야 함)
            local has_add_skills=$(yq ".agents[$i].add-skills // null" "$yaml_file")
            if [[ "$has_add_skills" != "null" ]]; then
                local skills_count=$(yq ".agents[$i].add-skills | length" "$yaml_file")
                if [[ $skills_count -gt 0 ]]; then
                    for j in $(seq 0 $((skills_count - 1))); do
                        local skill=$(yq ".agents[$i].add-skills[$j]" "$yaml_file")
                        if [[ -n "$skill" && "$skill" != "null" ]]; then
                            local in_skills=$(yq ".skills[].component" "$yaml_file" 2>/dev/null | grep -E "(^${skill}$|:${skill}$)" | head -1)
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
        done
    fi

    # commands 검증
    local cmd_count=$(yq '.commands | length // 0' "$yaml_file")
    if [[ $cmd_count -gt 0 ]]; then
        for i in $(seq 0 $((cmd_count - 1))); do
            local component=$(yq ".commands[$i].component // \"\"" "$yaml_file")
            if [[ -n "$component" && "$component" != "null" ]]; then
                resolve_source_path "commands" "$component" ".md"
                if [[ ! -f "$SOURCE_PATH" ]]; then
                    log_error "Command 파일 없음: $component -> $SOURCE_PATH"
                fi
            fi
        done
    fi

    # hooks 검증 (component가 있는 경우만)
    local hook_count=$(yq '.hooks | length // 0' "$yaml_file")
    if [[ $hook_count -gt 0 ]]; then
        for i in $(seq 0 $((hook_count - 1))); do
            local component=$(yq ".hooks[$i].component // \"\"" "$yaml_file")
            if [[ -n "$component" && "$component" != "null" ]]; then
                resolve_source_path "hooks" "$component" ""
                if [[ ! -f "$SOURCE_PATH" ]]; then
                    log_error "Hook 파일 없음: $component -> $SOURCE_PATH"
                fi
            fi
        done
    fi

    # skills 검증
    local skill_count=$(yq '.skills | length // 0' "$yaml_file")
    if [[ $skill_count -gt 0 ]]; then
        for i in $(seq 0 $((skill_count - 1))); do
            local component=$(yq ".skills[$i].component // \"\"" "$yaml_file")
            if [[ -n "$component" && "$component" != "null" ]]; then
                resolve_source_path "skills" "$component" ""
                if [[ ! -d "$SOURCE_PATH" ]]; then
                    log_error "Skill 디렉토리 없음: $component -> $SOURCE_PATH"
                fi
            fi
        done
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

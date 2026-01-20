#!/bin/bash
set -euo pipefail

# =============================================================================
# sync.yaml 스키마 검증
# YAML 문법, 지원 필드, 값 유효성 검사
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

VALID_TOP_LEVEL_FIELDS="name path agents commands hooks skills"
VALID_AGENT_FIELDS="component add-skills"
VALID_COMMAND_FIELDS="component"
VALID_HOOK_FIELDS="component event matcher type timeout command prompt"
VALID_SKILL_FIELDS="component"
VALID_EVENTS="SessionStart UserPromptSubmit PreToolUse PostToolUse Stop"
VALID_HOOK_TYPES="command prompt"

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

validate_yaml_schema() {
    local yaml_file="$1"
    local yaml_name=$(basename "$yaml_file")

    # YAML 문법 검증
    if ! check_yaml_syntax "$yaml_file"; then
        return 1
    fi

    # top-level 필드 검증
    check_unknown_fields "$yaml_file" "." "$VALID_TOP_LEVEL_FIELDS" "root"

    # agents 검증
    local agent_count=$(yq '.agents | length // 0' "$yaml_file")
    if [[ $agent_count -gt 0 ]]; then
        for i in $(seq 0 $((agent_count - 1))); do
            check_unknown_fields "$yaml_file" ".agents[$i]" "$VALID_AGENT_FIELDS" "agents[$i]"

            local component=$(yq ".agents[$i].component // \"\"" "$yaml_file")
            if [[ -n "$component" && "$component" != "null" ]]; then
                check_project_component_format "$component" "agents[$i].component"
            fi

            # add-skills 검증
            local has_add_skills=$(yq ".agents[$i].add-skills // null" "$yaml_file")
            if [[ "$has_add_skills" != "null" ]]; then
                local skills_count=$(yq ".agents[$i].add-skills | length" "$yaml_file")
                if [[ $skills_count -gt 0 ]]; then
                    for j in $(seq 0 $((skills_count - 1))); do
                        local skill=$(yq ".agents[$i].add-skills[$j]" "$yaml_file")
                        if [[ -n "$skill" && "$skill" != "null" ]]; then
                            check_project_component_format "$skill" "agents[$i].add-skills[$j]"
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
            check_unknown_fields "$yaml_file" ".commands[$i]" "$VALID_COMMAND_FIELDS" "commands[$i]"

            local component=$(yq ".commands[$i].component // \"\"" "$yaml_file")
            if [[ -n "$component" && "$component" != "null" ]]; then
                check_project_component_format "$component" "commands[$i].component"
            fi
        done
    fi

    # hooks 검증
    local hook_count=$(yq '.hooks | length // 0' "$yaml_file")
    if [[ $hook_count -gt 0 ]]; then
        for i in $(seq 0 $((hook_count - 1))); do
            check_unknown_fields "$yaml_file" ".hooks[$i]" "$VALID_HOOK_FIELDS" "hooks[$i]"

            # component 형식 검증
            local component=$(yq ".hooks[$i].component // \"\"" "$yaml_file")
            if [[ -n "$component" && "$component" != "null" ]]; then
                check_project_component_format "$component" "hooks[$i].component"
            fi

            # event 값 검증
            local event=$(yq ".hooks[$i].event // \"\"" "$yaml_file")
            if [[ -n "$event" && "$event" != "null" ]]; then
                if [[ ! " $VALID_EVENTS " =~ " $event " ]]; then
                    log_error "hooks[$i].event: 잘못된 값 '$event' (지원: $VALID_EVENTS)"
                fi
            fi

            # type 값 검증
            local hook_type=$(yq ".hooks[$i].type // \"\"" "$yaml_file")
            if [[ -n "$hook_type" && "$hook_type" != "null" ]]; then
                if [[ ! " $VALID_HOOK_TYPES " =~ " $hook_type " ]]; then
                    log_error "hooks[$i].type: 잘못된 값 '$hook_type' (지원: $VALID_HOOK_TYPES)"
                fi
            fi
        done
    fi

    # skills 검증
    local skill_count=$(yq '.skills | length // 0' "$yaml_file")
    if [[ $skill_count -gt 0 ]]; then
        for i in $(seq 0 $((skill_count - 1))); do
            check_unknown_fields "$yaml_file" ".skills[$i]" "$VALID_SKILL_FIELDS" "skills[$i]"

            local component=$(yq ".skills[$i].component // \"\"" "$yaml_file")
            if [[ -n "$component" && "$component" != "null" ]]; then
                check_project_component_format "$component" "skills[$i].component"
            fi
        done
    fi

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

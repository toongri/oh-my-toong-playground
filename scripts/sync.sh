#!/bin/bash
set -euo pipefail

# =============================================================================
# oh-my-toong Sync Tool
# agents, commands, hooks, skills를 다른 Claude 프로젝트로 동기화
# =============================================================================

# 변수
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
DRY_RUN=false

# 색상
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# =============================================================================
# 유틸리티 함수
# =============================================================================

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_dry() {
    echo -e "${YELLOW}[DRY-RUN]${NC} $1"
}

# =============================================================================
# 의존성 확인
# =============================================================================

check_dependencies() {
    local missing=()

    if ! command -v yq &> /dev/null; then
        missing+=("yq")
    fi

    if ! command -v jq &> /dev/null; then
        missing+=("jq")
    fi

    if [[ ${#missing[@]} -gt 0 ]]; then
        log_error "다음 의존성이 필요합니다: ${missing[*]}"
        echo ""
        echo "설치 방법:"
        echo "  brew install yq jq"
        echo ""
        exit 1
    fi
}

# =============================================================================
# 백업 함수
# =============================================================================

backup_category() {
    local target_path="$1"
    local category="$2"
    local source_dir="$target_path/.claude/$category"

    if [[ ! -d "$source_dir" ]]; then
        return 0
    fi

    local timestamp=$(date +%Y%m%d_%H%M%S)
    local backup_dir="$target_path/.claude/.bak"
    local backup_path="$backup_dir/${category}.${timestamp}"

    if [[ "$DRY_RUN" == true ]]; then
        log_dry "백업: $source_dir -> $backup_path"
        return 0
    fi

    mkdir -p "$backup_dir"
    cp -r "$source_dir" "$backup_path"
    log_info "백업 완료: $backup_path"
}

# =============================================================================
# Agent Front Matter 업데이트
# =============================================================================

update_agent_frontmatter() {
    local agent_file="$1"
    shift
    local skills_to_add=("$@")

    if [[ ${#skills_to_add[@]} -eq 0 ]]; then
        return 0
    fi

    if [[ "$DRY_RUN" == true ]]; then
        log_dry "Front matter 업데이트: $agent_file (skills 추가: ${skills_to_add[*]})"
        return 0
    fi

    # Front matter 추출 (--- 사이)
    local has_frontmatter=$(head -1 "$agent_file" | grep -c "^---$" || true)
    if [[ "$has_frontmatter" -eq 0 ]]; then
        log_warn "Front matter 없음: $agent_file"
        return 0
    fi

    # 임시 파일 생성
    local temp_file=$(mktemp)
    local frontmatter_file=$(mktemp)
    local body_file=$(mktemp)

    # Front matter와 body 분리
    awk '/^---$/{n++; next} n==1' "$agent_file" > "$frontmatter_file"
    awk '/^---$/{n++; if(n==2) p=1; next} p' "$agent_file" > "$body_file"

    # skills 배열로 변환하고 새 skills 추가
    # [.skills] | flatten 을 사용하여 문자열이든 배열이든 모두 배열로 변환
    local skills_args=""
    for skill in "${skills_to_add[@]}"; do
        skills_args="$skills_args + [\"$skill\"]"
    done

    yq -i ".skills = ([.skills] | flatten)${skills_args} | .skills |= unique" "$frontmatter_file"

    # 파일 재조립
    echo "---" > "$temp_file"
    cat "$frontmatter_file" >> "$temp_file"
    echo "---" >> "$temp_file"
    cat "$body_file" >> "$temp_file"

    mv "$temp_file" "$agent_file"
    rm -f "$frontmatter_file" "$body_file"

    log_info "Front matter 업데이트 완료: $agent_file"
}

# =============================================================================
# 동기화 함수들
# =============================================================================

sync_agents() {
    local target_path="$1"
    local yaml_file="$2"

    local count=$(yq '.agents | length // 0' "$yaml_file")
    if [[ "$count" -eq 0 ]]; then
        return 0
    fi

    log_info "Agents 동기화 시작 ($count 개)"

    # 대상 디렉토리 준비
    local target_dir="$target_path/.claude/agents"

    if [[ "$DRY_RUN" != true ]]; then
        # 기존 agents 백업 후 삭제 (PUT 방식)
        backup_category "$target_path" "agents"
        rm -rf "$target_dir"
        mkdir -p "$target_dir"
    fi

    for i in $(seq 0 $((count - 1))); do
        local name=$(yq ".agents[$i].name" "$yaml_file")
        local source_file="$ROOT_DIR/agents/${name}.md"
        local target_file="$target_dir/${name}.md"

        if [[ ! -f "$source_file" ]]; then
            log_warn "Agent 파일 없음: $source_file"
            continue
        fi

        if [[ "$DRY_RUN" == true ]]; then
            log_dry "복사: $source_file -> $target_file"
        else
            cp "$source_file" "$target_file"
            log_info "복사 완료: ${name}.md"
        fi

        # add-skills 처리
        local add_skills_count=$(yq ".agents[$i].add-skills | length // 0" "$yaml_file")
        if [[ "$add_skills_count" -gt 0 ]]; then
            local skills_array=()
            for j in $(seq 0 $((add_skills_count - 1))); do
                local skill=$(yq ".agents[$i].add-skills[$j]" "$yaml_file")
                skills_array+=("$skill")
            done
            update_agent_frontmatter "$target_file" "${skills_array[@]}"
        fi
    done

    log_success "Agents 동기화 완료"
}

sync_commands() {
    local target_path="$1"
    local yaml_file="$2"

    local count=$(yq '.commands | length // 0' "$yaml_file")
    if [[ "$count" -eq 0 ]]; then
        return 0
    fi

    log_info "Commands 동기화 시작 ($count 개)"

    local target_dir="$target_path/.claude/commands"

    if [[ "$DRY_RUN" != true ]]; then
        backup_category "$target_path" "commands"
        rm -rf "$target_dir"
        mkdir -p "$target_dir"
    fi

    for i in $(seq 0 $((count - 1))); do
        local name=$(yq ".commands[$i].name" "$yaml_file")
        local source_file="$ROOT_DIR/commands/${name}.md"
        local target_file="$target_dir/${name}.md"

        if [[ ! -f "$source_file" ]]; then
            log_warn "Command 파일 없음: $source_file"
            continue
        fi

        if [[ "$DRY_RUN" == true ]]; then
            log_dry "복사: $source_file -> $target_file"
        else
            cp "$source_file" "$target_file"
            log_info "복사 완료: ${name}.md"
        fi
    done

    log_success "Commands 동기화 완료"
}

sync_hooks() {
    local target_path="$1"
    local yaml_file="$2"

    local count=$(yq '.hooks | length // 0' "$yaml_file")
    if [[ "$count" -eq 0 ]]; then
        return 0
    fi

    log_info "Hooks 동기화 시작 ($count 개)"

    local target_dir="$target_path/.claude/hooks"

    if [[ "$DRY_RUN" != true ]]; then
        backup_category "$target_path" "hooks"
        rm -rf "$target_dir"
        mkdir -p "$target_dir"
    fi

    # hooks JSON 구성
    local hooks_json="{}"

    for i in $(seq 0 $((count - 1))); do
        local name=$(yq ".hooks[$i].name" "$yaml_file")
        local source_file="$ROOT_DIR/hooks/${name}.sh"
        local target_file="$target_dir/${name}.sh"

        if [[ ! -f "$source_file" ]]; then
            log_warn "Hook 파일 없음: $source_file"
            continue
        fi

        if [[ "$DRY_RUN" == true ]]; then
            log_dry "복사: $source_file -> $target_file"
        else
            cp "$source_file" "$target_file"
            chmod +x "$target_file"
            log_info "복사 완료: ${name}.sh"
        fi

        # Hook name -> Hook Type 매핑 (Bash 3.2 호환)
        local hook_type=""
        case "$name" in
            "session-start") hook_type="SessionStart" ;;
            "keyword-detector") hook_type="UserPromptSubmit" ;;
            "pre-tool-enforcer") hook_type="PreToolUse" ;;
            "post-tool-verifier") hook_type="PostToolUse" ;;
            "persistent-mode") hook_type="Stop" ;;
        esac

        # settings.json용 hooks 구성
        if [[ -n "$hook_type" ]]; then
            local hook_entry=$(jq -n \
                --arg cmd "~/.claude/hooks/${name}.sh" \
                '[{"matcher": "*", "hooks": [{"type": "command", "command": $cmd, "timeout": 10}]}]')
            hooks_json=$(echo "$hooks_json" | jq --arg type "$hook_type" --argjson entry "$hook_entry" '.[$type] = $entry')
        fi
    done

    # settings.json 업데이트
    update_settings_json "$target_path" "$hooks_json"

    log_success "Hooks 동기화 완료"
}

update_settings_json() {
    local target_path="$1"
    local hooks_json="$2"

    local settings_file="$target_path/settings.json"

    if [[ "$DRY_RUN" == true ]]; then
        log_dry "settings.json 업데이트: $settings_file"
        log_dry "새 hooks: $hooks_json"
        return 0
    fi

    # 기존 settings.json 읽기 (없으면 빈 객체)
    local current_settings="{}"
    if [[ -f "$settings_file" ]]; then
        current_settings=$(cat "$settings_file")
    fi

    # hooks 섹션만 덮어쓰기
    local new_settings=$(echo "$current_settings" | jq --argjson hooks "$hooks_json" '.hooks = $hooks')

    echo "$new_settings" | jq '.' > "$settings_file"
    log_info "settings.json 업데이트 완료"
}

sync_skills() {
    local target_path="$1"
    local yaml_file="$2"

    local count=$(yq '.skills | length // 0' "$yaml_file")
    if [[ "$count" -eq 0 ]]; then
        return 0
    fi

    log_info "Skills 동기화 시작 ($count 개)"

    local target_dir="$target_path/.claude/skills"

    if [[ "$DRY_RUN" != true ]]; then
        backup_category "$target_path" "skills"
        rm -rf "$target_dir"
        mkdir -p "$target_dir"
    fi

    for i in $(seq 0 $((count - 1))); do
        local name=$(yq ".skills[$i].name" "$yaml_file")
        local source_dir="$ROOT_DIR/skills/${name}"
        local target_skill_dir="$target_dir/${name}"

        if [[ ! -d "$source_dir" ]]; then
            log_warn "Skill 디렉토리 없음: $source_dir"
            continue
        fi

        if [[ "$DRY_RUN" == true ]]; then
            log_dry "복사 (디렉토리): $source_dir -> $target_skill_dir"
        else
            cp -r "$source_dir" "$target_skill_dir"
            log_info "복사 완료: ${name}/"
        fi
    done

    log_success "Skills 동기화 완료"
}

# =============================================================================
# YAML 처리
# =============================================================================

process_yaml() {
    local yaml_file="$1"

    if [[ ! -f "$yaml_file" ]]; then
        log_warn "YAML 파일 없음: $yaml_file"
        return 0
    fi

    local target_path=$(yq '.path // ""' "$yaml_file")

    if [[ -z "$target_path" || "$target_path" == "null" ]]; then
        log_warn "path가 정의되지 않음: $yaml_file"
        return 0
    fi

    log_info "========================================"
    log_info "처리 중: $yaml_file"
    log_info "대상: $target_path"
    log_info "========================================"

    # .claude 디렉토리 생성
    if [[ "$DRY_RUN" != true ]]; then
        mkdir -p "$target_path/.claude"
    fi

    # 각 카테고리 동기화
    sync_agents "$target_path" "$yaml_file"
    sync_commands "$target_path" "$yaml_file"
    sync_hooks "$target_path" "$yaml_file"
    sync_skills "$target_path" "$yaml_file"

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

    # 처리된 경로 추적 (projects/ YAML 우선) - Bash 3.2 호환
    local processed_paths=""

    # projects/**/sync.yaml 먼저 처리
    if [[ -d "$ROOT_DIR/projects" ]]; then
        while IFS= read -r yaml_file; do
            if [[ -n "$yaml_file" ]]; then
                local path=$(yq '.path // ""' "$yaml_file")
                if [[ -n "$path" && "$path" != "null" ]]; then
                    process_yaml "$yaml_file"
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
                process_yaml "$root_yaml"
            else
                log_warn "$path는 projects/에서 이미 처리됨, 스킵"
            fi
        else
            log_info "루트 sync.yaml에 path가 정의되지 않음 (템플릿 상태)"
        fi
    fi

    if [[ "$DRY_RUN" == true ]]; then
        log_warn "========== DRY-RUN 완료 =========="
    else
        log_success "========== 동기화 완료 =========="
    fi
}

main "$@"

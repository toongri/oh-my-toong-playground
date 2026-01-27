#!/bin/bash
# =============================================================================
# oh-my-toong Common Utilities
# sync.sh 및 기타 스크립트에서 공유하는 유틸리티 함수들
# =============================================================================

# =============================================================================
# 색상 정의 (Color Definitions)
# 터미널 출력에 사용되는 ANSI 색상 코드
# =============================================================================
export RED='\033[0;31m'
export GREEN='\033[0;32m'
export YELLOW='\033[1;33m'
export BLUE='\033[0;34m'
export NC='\033[0m'  # No Color

# =============================================================================
# Project Context (set by sync.sh for scoped resolution)
# =============================================================================

# Current project name from yaml name field or directory (for cross-project validation)
export CURRENT_PROJECT_CONTEXT=""

# Current project directory name (for file path resolution, always from directory structure)
export CURRENT_PROJECT_DIR=""

# Whether current context is root yaml (no project scope)
export IS_ROOT_YAML_CONTEXT=false

# =============================================================================
# 로깅 함수 (Logging Functions)
# 일관된 형식의 로그 출력을 제공
# =============================================================================

# 정보 메시지 출력 (파란색)
# 사용법: log_info "메시지"
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

# 성공 메시지 출력 (녹색)
# 사용법: log_success "메시지"
log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

# 경고 메시지 출력 (노란색)
# 사용법: log_warn "메시지"
log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

# 오류 메시지 출력 (빨간색)
# 사용법: log_error "메시지"
log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Dry-run 모드 메시지 출력 (노란색)
# 사용법: log_dry "메시지"
log_dry() {
    echo -e "${YELLOW}[DRY-RUN]${NC} $1"
}

# =============================================================================
# 의존성 확인 (Dependency Check)
# 필수 CLI 도구들이 설치되어 있는지 확인
# =============================================================================

# yq와 jq가 설치되어 있는지 확인
# 미설치 시 오류 메시지와 설치 방법을 출력하고 종료
# 사용법: check_dependencies
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
# 백업 함수 (Backup Functions)
# 동기화 전 기존 파일들을 백업하는 기능
# =============================================================================

# 백업 세션 ID 생성 (전체 동기화당 하나)
# 형식: YYYYMMDD_HHMMSS_{4자리 랜덤 hex}
# 사용법: session_id=$(generate_backup_session_id)
generate_backup_session_id() {
    local timestamp=$(date +%Y%m%d_%H%M%S)
    local rand=$(head -c 2 /dev/urandom | xxd -p)
    echo "${timestamp}_${rand}"
}

# 단일 카테고리를 백업
# .sync-backup/{session}/ 아래에 백업 저장
#
# 필요한 전역 변수:
#   - ROOT_DIR: 프로젝트 루트 경로
#   - CURRENT_BACKUP_SESSION: 현재 백업 세션 ID
#   - CURRENT_PROJECT_NAME: 현재 프로젝트 이름 (루트면 빈 문자열)
#   - DRY_RUN: true면 실제 백업 없이 로그만 출력
#
# 사용법: backup_category "/path/to/target" "agents"
backup_category() {
    local target_path="$1"
    local category="$2"
    local source_dir="$target_path/.claude/$category"

    if [[ ! -d "$source_dir" ]]; then
        return 0
    fi

    # .sync-backup/에 중앙 집중식 백업
    local backup_base="$ROOT_DIR/.sync-backup/$CURRENT_BACKUP_SESSION"
    local backup_path
    if [[ -z "$CURRENT_PROJECT_NAME" ]]; then
        # 루트 yaml
        backup_path="$backup_base/$category"
    else
        # projects/ yaml
        backup_path="$backup_base/projects/$CURRENT_PROJECT_NAME/$category"
    fi

    if [[ "$DRY_RUN" == true ]]; then
        log_dry "백업: $source_dir -> $backup_path"
        return 0
    fi

    mkdir -p "$(dirname "$backup_path")"
    cp -r "$source_dir" "$backup_path"
    log_info "백업 완료: $backup_path"
}

# 오래된 백업 정리 (비동기 실행용)
# retention_days가 0이면 현재 세션만 남기고 전부 삭제
# retention_days가 N이면 N일 이내 백업만 유지
#
# 필요한 전역 변수:
#   - ROOT_DIR: 프로젝트 루트 경로
#
# 사용법: cleanup_old_backups 7 "20250121_123456_abcd"
#         (비동기 실행: cleanup_old_backups 7 "$session" &)
cleanup_old_backups() {
    local retention_days="$1"
    local current_session="$2"
    local backup_dir="$ROOT_DIR/.sync-backup"

    if [[ ! -d "$backup_dir" ]]; then
        return 0
    fi

    if [[ "$retention_days" -eq 0 ]]; then
        # 0일: 현재 세션만 남기고 전부 삭제
        for dir in "$backup_dir"/20*; do
            if [[ -d "$dir" && "$(basename "$dir")" != "$current_session" ]]; then
                rm -rf "$dir" 2>/dev/null || true
            fi
        done
    else
        # N일: N일 이내 생존, N일 초과 삭제
        # -mtime +X는 (X+1)일 이상이므로 (N-1)로 계산
        local mtime_days=$((retention_days - 1))
        find "$backup_dir" -maxdepth 1 -type d -name "20*" -mtime +"$mtime_days" -exec rm -rf {} \; 2>/dev/null || true
    fi
}

# =============================================================================
# CLI 프로젝트 파일 검증 (CLI Project File Validation)
# 각 CLI별로 필요한 프로젝트 파일 매핑 및 존재 확인
# =============================================================================

# CLI별 프로젝트 파일 반환
# claude -> CLAUDE.md, gemini -> GEMINI.md, codex -> AGENTS.md
#
# 사용법: project_file=$(get_cli_project_file "claude")
get_cli_project_file() {
    local cli="$1"
    case "$cli" in
        claude) echo "CLAUDE.md" ;;
        gemini) echo "GEMINI.md" ;;
        codex) echo "AGENTS.md" ;;
        *) echo "" ;;
    esac
}

# sync.yaml에서 사용되는 모든 CLI 목록을 수집하고 프로젝트 파일 존재 확인
# 실패 시 에러 메시지 출력하고 1 반환
#
# 사용법: if ! validate_cli_project_files "$yaml_file" "$target_path"; then return 1; fi
validate_cli_project_files() {
    local yaml_file="$1"
    local target_path="$2"
    local has_error=false

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

    # 각 카테고리에서 component-level platforms 수집
    local categories=("agents" "commands" "hooks" "skills")
    for category in "${categories[@]}"; do
        local count=$(yq ".${category} | length // 0" "$yaml_file")
        if [[ $count -gt 0 ]]; then
            for i in $(seq 0 $((count - 1))); do
                local component_platforms=$(yq -o=json ".${category}[$i].platforms // null" "$yaml_file")
                if [[ "$component_platforms" != "null" ]]; then
                    for cli in $(echo "$component_platforms" | jq -r '.[]' 2>/dev/null); do
                        case "$cli" in
                            claude) used_claude=true ;;
                            gemini) used_gemini=true ;;
                            codex) used_codex=true ;;
                        esac
                    done
                fi
            done
        fi
    done

    # 각 CLI에 대해 프로젝트 파일 존재 확인
    if [[ "$used_claude" == true ]]; then
        local project_file=$(get_cli_project_file "claude")
        if [[ ! -f "$target_path/$project_file" ]]; then
            log_error "CLI 프로젝트 파일 없음: $project_file (대상: $target_path)"
            echo "        먼저 'init'을 실행하여 프로젝트를 초기화하세요."
            has_error=true
        fi
    fi

    if [[ "$used_gemini" == true ]]; then
        local project_file=$(get_cli_project_file "gemini")
        if [[ ! -f "$target_path/$project_file" ]]; then
            log_error "CLI 프로젝트 파일 없음: $project_file (대상: $target_path)"
            echo "        먼저 'init'을 실행하여 프로젝트를 초기화하세요."
            has_error=true
        fi
    fi

    if [[ "$used_codex" == true ]]; then
        local project_file=$(get_cli_project_file "codex")
        if [[ ! -f "$target_path/$project_file" ]]; then
            log_error "CLI 프로젝트 파일 없음: $project_file (대상: $target_path)"
            echo "        먼저 'init'을 실행하여 프로젝트를 초기화하세요."
            has_error=true
        fi
    fi

    if [[ "$has_error" == true ]]; then
        return 1
    fi
    return 0
}

# =============================================================================
# 컴포넌트 해석 (Component Resolution)
# "name" 또는 "{project}:{name}" 형식의 컴포넌트 참조를 실제 경로로 변환
# =============================================================================

# 소스 경로 해석
# "name" 형식: 글로벌 경로 (ROOT_DIR/category/name{extension})
# "{project}:{name}" 형식: 프로젝트별 경로 (ROOT_DIR/projects/{project}/category/name{extension})
#
# 필요한 전역 변수:
#   - ROOT_DIR: 프로젝트 루트 경로
#
# 결과 전역 변수:
#   - SOURCE_PATH: 해석된 전체 소스 경로
#   - DISPLAY_NAME: 표시용 이름 (프로젝트 접두사 제외)
#
# 사용법: resolve_source_path "agents" "oracle" ".md"
#         → SOURCE_PATH="$ROOT_DIR/agents/oracle.md", DISPLAY_NAME="oracle"
#
#         resolve_source_path "skills" "my-proj:testing" ""
#         → SOURCE_PATH="$ROOT_DIR/projects/my-proj/skills/testing", DISPLAY_NAME="testing"
resolve_source_path() {
    local category="$1"
    local name="$2"
    local extension="$3"

    if [[ "$name" == *:* ]]; then
        # {project}:{item} 형식 → projects/ 아래에서 찾기
        local project=$(echo "$name" | cut -d: -f1)
        local item=$(echo "$name" | cut -d: -f2-)
        SOURCE_PATH="$ROOT_DIR/projects/$project/$category/${item}${extension}"
        DISPLAY_NAME="$item"
    else
        # 글로벌 경로
        SOURCE_PATH="$ROOT_DIR/$category/${name}${extension}"
        DISPLAY_NAME="$name"
    fi
}

# =============================================================================
# Project-Scoped Component Resolution
# Enforces upward-only search: own project -> global, NEVER cross-project
# =============================================================================

# Resolve component path with project scoping
# For projects/<name>/sync.yaml: own project -> global (NO cross-project)
# For root sync.yaml: global only (NO projects/)
#
# Required global variables:
#   - ROOT_DIR: Project root path
#   - CURRENT_PROJECT_CONTEXT: Current project name (empty for root)
#   - IS_ROOT_YAML_CONTEXT: true if root yaml
#
# Result global variables:
#   - SCOPED_SOURCE_PATH: Resolved source path (empty if not found)
#   - SCOPED_DISPLAY_NAME: Display name for logging
#   - SCOPED_RESOLUTION_ERROR: Error message if resolution failed
#
# Usage: resolve_scoped_source_path "skills" "oracle" ""
#        if [[ -z "$SCOPED_SOURCE_PATH" ]]; then log_warn "$SCOPED_RESOLUTION_ERROR"; fi
resolve_scoped_source_path() {
    local category="$1"
    local name="$2"
    local extension="$3"  # ".md" for files, "" for directories

    SCOPED_SOURCE_PATH=""
    SCOPED_DISPLAY_NAME=""
    SCOPED_RESOLUTION_ERROR=""

    # Parse project prefix if present
    local parsed_project=""
    local parsed_item="$name"
    if [[ "$name" == *:* ]]; then
        parsed_project=$(echo "$name" | cut -d: -f1)
        parsed_item=$(echo "$name" | cut -d: -f2-)
    fi

    SCOPED_DISPLAY_NAME="$parsed_item"

    # === Cross-Project Validation ===
    if [[ -n "$parsed_project" ]]; then
        if [[ "$IS_ROOT_YAML_CONTEXT" == true ]]; then
            # Root yaml cannot reference any project
            SCOPED_RESOLUTION_ERROR="Root sync.yaml cannot reference project components: $name (use global components only)"
            return 1
        elif [[ "$parsed_project" != "$CURRENT_PROJECT_CONTEXT" ]]; then
            # Project yaml cannot reference other projects
            SCOPED_RESOLUTION_ERROR="Cross-project reference not allowed: $name (current project: $CURRENT_PROJECT_CONTEXT)"
            return 1
        fi
        # Same project prefix - allowed, treat as own project lookup
    fi

    # === Upward Search Logic ===
    # Note: extension="" means check for both file and directory (hooks have extension in name)
    if [[ "$IS_ROOT_YAML_CONTEXT" == true ]]; then
        # Root yaml: global only
        local global_path="$ROOT_DIR/$category/${parsed_item}${extension}"
        local exists=false
        if [[ -n "$extension" ]]; then
            [[ -f "$global_path" ]] && exists=true
        else
            # Check both file and directory when extension is empty
            [[ -f "$global_path" || -d "$global_path" ]] && exists=true
        fi
        if [[ "$exists" == true ]]; then
            SCOPED_SOURCE_PATH="$global_path"
            return 0
        fi
        SCOPED_RESOLUTION_ERROR="Component not found in global: $category/${parsed_item}${extension}"
        return 1
    else
        # Project yaml: own project first, then global
        # Use CURRENT_PROJECT_DIR (directory name) for file path resolution
        # 1. Try own project
        local project_path="$ROOT_DIR/projects/$CURRENT_PROJECT_DIR/$category/${parsed_item}${extension}"
        if [[ -n "$extension" ]]; then
            [[ -f "$project_path" ]] && { SCOPED_SOURCE_PATH="$project_path"; return 0; }
        else
            [[ -f "$project_path" || -d "$project_path" ]] && { SCOPED_SOURCE_PATH="$project_path"; return 0; }
        fi

        # 2. Fall back to global
        local global_path="$ROOT_DIR/$category/${parsed_item}${extension}"
        if [[ -n "$extension" ]]; then
            [[ -f "$global_path" ]] && { SCOPED_SOURCE_PATH="$global_path"; return 0; }
        else
            [[ -f "$global_path" || -d "$global_path" ]] && { SCOPED_SOURCE_PATH="$global_path"; return 0; }
        fi

        SCOPED_RESOLUTION_ERROR="Component not found in project '$CURRENT_PROJECT_DIR' or global: $category/${parsed_item}${extension}"
        return 1
    fi
}

# Set project context from yaml file
# Call this at the start of processing each yaml
#
# Usage: set_project_context "$yaml_file" "$is_root"
set_project_context() {
    local yaml_file="$1"
    local is_root="$2"  # "true" or "false"

    if [[ "$is_root" == "true" ]]; then
        CURRENT_PROJECT_CONTEXT=""
        CURRENT_PROJECT_DIR=""
        IS_ROOT_YAML_CONTEXT=true
    else
        # Directory name is always used for file path resolution
        CURRENT_PROJECT_DIR=$(basename "$(dirname "$yaml_file")")

        # Project name: yaml name field first, then directory name (for cross-project validation)
        local yaml_name=$(yq '.name // ""' "$yaml_file" 2>/dev/null)
        if [[ -n "$yaml_name" && "$yaml_name" != "null" ]]; then
            CURRENT_PROJECT_CONTEXT="$yaml_name"
        else
            CURRENT_PROJECT_CONTEXT="$CURRENT_PROJECT_DIR"
        fi
        IS_ROOT_YAML_CONTEXT=false
    fi

    export CURRENT_PROJECT_CONTEXT
    export CURRENT_PROJECT_DIR
    export IS_ROOT_YAML_CONTEXT
}

# =============================================================================
# Default Platforms (from config.yaml)
# Returns the global default platforms as JSON array
# =============================================================================

# Get default platforms from config.yaml use-platforms field
# Falls back to ["claude"] if config.yaml is missing or use-platforms is not set
#
# 필요한 전역 변수:
#   - ROOT_DIR: 프로젝트 루트 경로
#
# 사용법: default_platforms=$(get_default_platforms)
get_default_platforms() {
    local config_file="$ROOT_DIR/config.yaml"

    if [[ -f "$config_file" ]]; then
        local use_platforms
        use_platforms=$(yq -o=json '.use-platforms // null' "$config_file" 2>/dev/null)

        if [[ "$use_platforms" != "null" && -n "$use_platforms" ]]; then
            echo "$use_platforms"
            return 0
        fi
    fi

    # Fallback to hardcoded default
    echo '["claude"]'
}

# Get feature-specific platforms from config.yaml feature-platforms.{category}
# Returns JSON array if found, empty string if not found (caller handles fallback)
#
# 필요한 전역 변수:
#   - ROOT_DIR: 프로젝트 루트 경로
#
# 사용법: feature_platforms=$(get_feature_platforms "skills")
#         if [[ -n "$feature_platforms" ]]; then use it; else fallback; fi
get_feature_platforms() {
    local category="$1"
    local config_file="$ROOT_DIR/config.yaml"

    if [[ -f "$config_file" ]]; then
        local feature_platforms
        feature_platforms=$(yq -o=json ".feature-platforms.$category // null" "$config_file" 2>/dev/null)

        if [[ "$feature_platforms" != "null" && -n "$feature_platforms" ]]; then
            echo "$feature_platforms"
            return 0
        fi
    fi

    # Return empty - caller should fallback to get_default_platforms()
    echo ""
}

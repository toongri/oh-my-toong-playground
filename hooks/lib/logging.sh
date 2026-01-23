#!/bin/bash
# =============================================================================
# oh-my-toong Hook Logging Library
# Provides structured logging for hook scripts
# =============================================================================

# Configuration environment variables:
# - OMT_HOOK_LOG_ENABLED: Toggle logging (default: 1 = enabled)
# - OMT_HOOK_LOG_LEVEL: Minimum level to log (default: 1 = INFO)
#   Levels: 0=DEBUG, 1=INFO, 2=WARN, 3=ERROR

# Log level constants
OMT_LOG_LEVEL_DEBUG=0
OMT_LOG_LEVEL_INFO=1
OMT_LOG_LEVEL_WARN=2
OMT_LOG_LEVEL_ERROR=3

# Log rotation settings
OMT_LOG_MAX_SIZE=$((1024 * 1024))  # 1MB in bytes
OMT_LOG_ROTATE_COUNT=3

# State variables (set by omt_log_init)
OMT_LOG_INITIALIZED=""
OMT_LOG_FILE=""
OMT_HOOK_NAME=""
OMT_PROJECT_ROOT=""

# =============================================================================
# Project Root Detection
# =============================================================================

# Find project root by looking for markers and escaping .claude/sisyphus if inside
omt_get_project_root() {
    local dir="$1"

    # Strip .claude/sisyphus suffix if present (prevents nesting)
    dir="${dir%/.claude/sisyphus}"
    dir="${dir%/.claude}"

    # Look for project root markers
    while [ "$dir" != "/" ] && [ "$dir" != "." ] && [ -n "$dir" ]; do
        if [ -d "$dir/.git" ] || [ -f "$dir/CLAUDE.md" ] || [ -f "$dir/package.json" ]; then
            echo "$dir"
            return 0
        fi
        dir=$(dirname "$dir")
    done

    # Fallback: return the stripped directory
    echo "${1%/.claude/sisyphus}"
}

# =============================================================================
# Log Rotation
# =============================================================================

_omt_rotate_logs() {
    local log_file="$1"

    # Check if log file exists and exceeds max size
    if [[ ! -f "$log_file" ]]; then
        return 0
    fi

    local file_size
    file_size=$(stat -f%z "$log_file" 2>/dev/null || stat -c%s "$log_file" 2>/dev/null || echo "0")

    if [[ "$file_size" -lt "$OMT_LOG_MAX_SIZE" ]]; then
        return 0
    fi

    # Rotate logs: delete oldest, shift others
    rm -f "${log_file}.${OMT_LOG_ROTATE_COUNT}" 2>/dev/null

    local i=$((OMT_LOG_ROTATE_COUNT - 1))
    while [[ $i -ge 1 ]]; do
        if [[ -f "${log_file}.${i}" ]]; then
            mv "${log_file}.${i}" "${log_file}.$((i + 1))" 2>/dev/null
        fi
        i=$((i - 1))
    done

    # Move current log to .1
    mv "$log_file" "${log_file}.1" 2>/dev/null

    # Create new empty log file
    touch "$log_file"
}

# =============================================================================
# Core Logging Functions
# =============================================================================

# Check if logging is enabled
_omt_is_logging_enabled() {
    local enabled="${OMT_HOOK_LOG_ENABLED:-1}"
    [[ "$enabled" == "1" ]]
}

# Get current log level threshold
_omt_get_log_level() {
    echo "${OMT_HOOK_LOG_LEVEL:-$OMT_LOG_LEVEL_INFO}"
}

# Check if message at given level should be logged
_omt_should_log() {
    local level="$1"
    local threshold
    threshold=$(_omt_get_log_level)
    [[ "$level" -ge "$threshold" ]]
}

# Get level name from level number
_omt_level_name() {
    case "$1" in
        0) echo "DEBUG" ;;
        1) echo "INFO" ;;
        2) echo "WARN" ;;
        3) echo "ERROR" ;;
        *) echo "UNKNOWN" ;;
    esac
}

# Get current timestamp in ISO format
_omt_timestamp() {
    date -Iseconds 2>/dev/null || date +%Y-%m-%dT%H:%M:%S%z
}

# Core log function
_omt_log() {
    local level="$1"
    local message="$2"

    # Check if logging is enabled
    if ! _omt_is_logging_enabled; then
        return 0
    fi

    # Check if this level should be logged
    if ! _omt_should_log "$level"; then
        return 0
    fi

    # Check if initialized
    if [[ -z "$OMT_LOG_INITIALIZED" ]] || [[ -z "$OMT_LOG_FILE" ]]; then
        return 0
    fi

    # Rotate if needed
    _omt_rotate_logs "$OMT_LOG_FILE"

    # Format and write log entry
    local timestamp
    timestamp=$(_omt_timestamp)
    local level_name
    level_name=$(_omt_level_name "$level")

    echo "[$timestamp] [$level_name] [$OMT_HOOK_NAME] $message" >> "$OMT_LOG_FILE"
}

# =============================================================================
# Public API
# =============================================================================

# Initialize logging for a hook
# Usage: omt_log_init <hook-name> <project-root>
omt_log_init() {
    local hook_name="$1"
    local project_root="${2:-}"

    # Auto-detect project root if not provided
    if [[ -z "$project_root" ]]; then
        project_root=$(omt_get_project_root "$(pwd)")
    fi

    OMT_HOOK_NAME="$hook_name"
    OMT_PROJECT_ROOT="$project_root"

    # Create log directory
    local log_dir="$OMT_PROJECT_ROOT/.claude/sisyphus/logs"
    mkdir -p "$log_dir" 2>/dev/null

    # Set log file path
    OMT_LOG_FILE="$log_dir/${hook_name}.log"

    OMT_LOG_INITIALIZED=1
}

# Log at DEBUG level
omt_log_debug() {
    _omt_log "$OMT_LOG_LEVEL_DEBUG" "$1"
}

# Log at INFO level
omt_log_info() {
    _omt_log "$OMT_LOG_LEVEL_INFO" "$1"
}

# Log at WARN level
omt_log_warn() {
    _omt_log "$OMT_LOG_LEVEL_WARN" "$1"
}

# Log at ERROR level
omt_log_error() {
    _omt_log "$OMT_LOG_LEVEL_ERROR" "$1"
}

# Log hook start
omt_log_start() {
    omt_log_info "========== START =========="
}

# Log hook end
omt_log_end() {
    omt_log_info "========== END =========="
}

# Log a decision point
# Usage: omt_log_decision <decision> <reason>
omt_log_decision() {
    local decision="$1"
    local reason="$2"
    omt_log_info "DECISION: $decision - $reason"
}

# Log JSON data
# Usage: omt_log_json <label> <json-string>
omt_log_json() {
    local label="$1"
    local json="$2"
    omt_log_info "JSON [$label]: $json"
}

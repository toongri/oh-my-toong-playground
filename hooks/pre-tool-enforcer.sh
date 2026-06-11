#!/bin/bash

# PreToolUse Hook: TaskOutput Gate
# Blocks TaskOutput tool calls, allows everything else

set -euo pipefail

# Read JSON input from stdin
input=$(cat)

# Simple JSON extraction using grep/sed (avoids jq dependency)
extract_json_field() {
    local field=$1
    local default=${2:-""}
    echo "$input" | grep -o "\"$field\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | sed 's/.*"\([^"]*\)".*/\1/' || echo "$default"
}

toolName=$(extract_json_field "tool_name" "")
if [[ -z "$toolName" ]]; then
    toolName=$(extract_json_field "toolName" "unknown")
fi

# Block TaskOutput immediately (wastes context with full JSONL logs)
if [[ "$toolName" == "TaskOutput" ]]; then
    cat <<EOF
{"continue": false, "reason": "TaskOutput은 에이전트의 전체 JSONL 로그를 반환하여 컨텍스트를 낭비합니다. 포그라운드 병렬 Task를 사용하세요. 백그라운드 태스크 상태 확인이 필요하면 Read로 output_file 경로를 읽으세요."}
EOF
    exit 0
fi

# Single-creation-point seeds for skill state files (ADR-7).
# Gated on the invoked skill name; sid comes from env $OMT_SESSION_ID only.
# Fail-closed id: absent or unsafe sid → skip + stderr warn + exit 0.
# Fail-loud: write errors print a stderr warning (no error-swallow); hook still exits 0.
if [[ "$toolName" == "Skill" ]]; then
    skillName=$(extract_json_field "skill" "")
    case "$skillName" in
        prometheus|goal|deep-interview)
            sid="${OMT_SESSION_ID:-}"
            omt_dir="${OMT_DIR:-}"

            # Validate sid: must be non-empty, safe characters, length 1-200
            if [[ -z "$sid" ]]; then
                echo "WARNING: pre-tool-enforcer seed skipped — OMT_SESSION_ID is absent" >&2
            elif ! echo "$sid" | grep -qE '^[A-Za-z0-9_-]{1,200}$'; then
                echo "WARNING: pre-tool-enforcer seed skipped — OMT_SESSION_ID is unsafe or invalid: '$sid'" >&2
            elif [[ -z "$omt_dir" ]]; then
                : # OMT_DIR unset — skip silently (fail-open for missing dir)
            else
                ts=$(date -Iseconds 2>/dev/null || date +"%Y-%m-%dT%H:%M:%S")
                # write_seed_if_absent <state_file> <skill_label> <json_content>
                # Prints a stderr warning if the write fails; never propagates error.
                write_seed_if_absent() {
                    local sf="$1"
                    local label="$2"
                    local json="$3"
                    if [ ! -f "$sf" ]; then
                        local write_ok=0
                        printf '%s\n' "$json" > "$sf" 2>/dev/null || write_ok=$?
                        if [ "$write_ok" -ne 0 ]; then
                            echo "WARNING: pre-tool-enforcer failed to seed $label state for sid='$sid'" >&2
                        fi
                    fi
                }
                case "$skillName" in
                    prometheus)
                        write_seed_if_absent \
                            "$omt_dir/prometheus-state-${sid}.json" \
                            "prometheus" \
                            '{
  "active": true,
  "phase": "S0",
  "plan_path": "",
  "resume_summary": "",
  "started_at": "'"${ts}"'",
  "last_touched_at": "'"${ts}"'"
}'
                        ;;
                    goal)
                        write_seed_if_absent \
                            "$omt_dir/goal-state-${sid}.json" \
                            "goal" \
                            '{
  "active": true,
  "phase": "planning",
  "iteration": 0,
  "outcome": "",
  "verification_surface": "",
  "constraints": "",
  "boundaries": "",
  "max_iterations": 10,
  "blocked_stop": "",
  "objective_verdict": "absent",
  "plan_path": "",
  "resume_summary": "",
  "budget_limit_notified": false,
  "blocked_reason": "",
  "completion_evidence_paths": [],
  "schema_version": 1,
  "started_at": "'"${ts}"'",
  "last_touched_at": "'"${ts}"'"
}'
                        ;;
                    deep-interview)
                        write_seed_if_absent \
                            "$omt_dir/deep-interview-active-state-${sid}.json" \
                            "deep-interview" \
                            '{
  "active": true,
  "started_at": "'"${ts}"'",
  "last_touched_at": "'"${ts}"'"
}'
                        ;;
                esac
            fi
            ;;
    esac
fi

# Allow all other tools
echo '{"continue": true}'
exit 0

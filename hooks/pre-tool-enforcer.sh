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

# =============================================================================
# Ledger write-guard (compaction-continuous-record plan, TODO 7, D5): a
# best-effort append-only guard for the durable session ledger
# ($OMT_DIR/session-ledger-<sid>.md, hooks/omt-ledger.sh). Blacklist, not
# whitelist -- a false-arm here blocks one write (bypassable), whereas a
# false-arm in a whitelist gate bricks every unrelated call. Arms ONLY when
# the command's WRITE-TARGET (not any substring anywhere in the command)
# references "session-ledger-": redirect target, tee/dd/cp/mv/sed -i/
# truncate/rm argument. `cat`/read passes; omt-ledger.sh itself never
# exposes the path in argv (D6) so it never arms.
# =============================================================================
_wg_ledger_target_in_segment() {
    # $1 = one chain segment (already split on && || ; |). 0 = this segment's
    # write-target references the ledger; 1 = no match.
    local seg="$1"
    if echo "$seg" | grep -Eq '>[[:space:]]*[^[:space:]]*session-ledger-'; then
        return 0
    fi
    if ! echo "$seg" | grep -q 'session-ledger-'; then
        return 1
    fi
    local first_word
    first_word=$(echo "$seg" | awk '{print $1}')
    case "$first_word" in
        tee|rm|truncate)
            return 0
            ;;
        dd)
            if echo "$seg" | grep -Eq 'of=[^[:space:]]*session-ledger-'; then
                return 0
            fi
            ;;
        sed)
            if echo "$seg" | grep -q -- '-i'; then
                return 0
            fi
            ;;
        cp|mv)
            local last_word
            last_word=$(echo "$seg" | awk '{print $NF}')
            if echo "$last_word" | grep -q 'session-ledger-'; then
                return 0
            fi
            ;;
    esac
    return 1
}

_wg_deny_json='{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Blocked: direct write/delete targets the durable session ledger (session-ledger-*.md). Use hooks/omt-ledger.sh append/now instead."}}'

if [[ "$toolName" == "Bash" ]] && command -v jq > /dev/null 2>&1; then
    _wg_cmd=$(echo "$input" | jq -r '.tool_input.command // empty' 2>/dev/null) || _wg_cmd=""
    if [[ -n "$_wg_cmd" ]] && echo "$_wg_cmd" | grep -q 'session-ledger-'; then
        _wg_denied=0
        while IFS= read -r _wg_seg; do
            if _wg_ledger_target_in_segment "$_wg_seg"; then
                _wg_denied=1
                break
            fi
        done < <(echo "$_wg_cmd" | sed -E 's/(&&|\|\||;|\|)/\n/g')
        if [[ "$_wg_denied" -eq 1 ]]; then
            printf '%s\n' "$_wg_deny_json"
            exit 0
        fi
    fi
elif [[ "$toolName" == "Write" || "$toolName" == "Edit" || "$toolName" == "MultiEdit" ]] && command -v jq > /dev/null 2>&1; then
    _wg_fp=$(echo "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null) || _wg_fp=""
    if [[ -n "$_wg_fp" ]] && echo "$_wg_fp" | grep -q 'session-ledger-'; then
        printf '%s\n' "$_wg_deny_json"
        exit 0
    fi
fi

# Single-creation-point seeds for skill state files (ADR-7).
# Resolution precedence: (1) env OMT_SESSION_ID / OMT_DIR when present and valid;
# (2) stdin payload session_id (same safety regex) + cwd via resolve_omt_dir;
# (3) loud failure — stderr names the missing element; hook still exits 0.
# Fail-loud: write errors print a stderr warning (no error-swallow); hook still exits 0.
if [[ "$toolName" == "Skill" ]]; then
    skillName=$(extract_json_field "skill" "")
    case "$skillName" in
        prometheus|goal|deep-interview|qa)
            # BASH_SOURCE-relative sourcing for resolve_omt_dir (mirrors session-start.sh:49-53)
            _PTE_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

            sid="${OMT_SESSION_ID:-}"
            omt_dir="${OMT_DIR:-}"

            # Derive sid from stdin session_id when env is absent
            if [[ -z "$sid" ]]; then
                stdin_sid=$(extract_json_field "session_id" "")
                if [[ -n "$stdin_sid" ]] && echo "$stdin_sid" | grep -qE '^[A-Za-z0-9_-]{1,200}$'; then
                    sid="$stdin_sid"
                fi
            fi

            # Derive omt_dir from stdin cwd when env is absent
            if [[ -z "$omt_dir" ]]; then
                stdin_cwd=$(extract_json_field "cwd" "")
                if [[ -n "$stdin_cwd" ]]; then
                    omt_dir=$(source "$_PTE_SCRIPT_DIR/lib/omt-dir.sh" && unset OMT_DIR && resolve_omt_dir "$stdin_cwd")
                fi
            fi

            # Validate sid: must be non-empty, safe characters, length 1-200
            if [[ -z "$sid" ]]; then
                echo "WARNING: pre-tool-enforcer seed failed — session_id absent from env (OMT_SESSION_ID) and stdin payload" >&2
            elif ! echo "$sid" | grep -qE '^[A-Za-z0-9_-]{1,200}$'; then
                echo "WARNING: pre-tool-enforcer seed skipped — OMT_SESSION_ID is unsafe or invalid: '$sid'" >&2
            elif [[ -z "$omt_dir" ]]; then
                echo "WARNING: pre-tool-enforcer seed failed — OMT_DIR absent from env and cwd absent from stdin payload" >&2
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
                    qa)
                        write_seed_if_absent \
                            "$omt_dir/qa-state-${sid}.json" \
                            "qa" \
                            '{
  "active": true,
  "phase": "PRE-FLIGHT",
  "cycle": 0,
  "max_cycles": 5,
  "same_failure_key": "",
  "same_failure_count": 0,
  "fix_head_before": "",
  "user_dirty_set": [],
  "target": "",
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

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
# Ledger write-guard (compaction-continuous-record plan, TODO 7, D5;
# delegated to the shared core in codex-ledger-parity TODO 5): a best-effort
# append-only guard for the durable session ledger ($OMT_DIR/session-ledger-
# <sid>.md, hooks/omt-ledger.sh). This shim owns EXTRACTION of candidate
# write-target paths from Claude's tool-input shape only (Write/Edit/
# MultiEdit .tool_input.file_path; Bash .tool_input.command redirect/tee/dd/
# cp/mv/sed -i/truncate/rm write-target). The full-path EXACT match against
# the resolved current-session ledger, and the deny JSON, both live in
# hooks/write-guard-core.sh (write_guard_core_run) so a candidate merely
# containing "session-ledger-" as a substring is no longer enough to arm.
# =============================================================================
_wg_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=hooks/write-guard-core.sh
source "$_wg_script_dir/write-guard-core.sh"

# _wg_strip_dquotes <token> -- removes one leading and one trailing double
# quote if present. Double-quoted write targets (`> "$f"`) pass through the
# quote-aware normalizer below unchanged (only single quotes are unwrapped
# there), so an extracted token like `"/tmp/x.md"` still carries its quote
# characters and must be unwrapped before an EXACT path comparison.
_wg_strip_dquotes() {
    local s="$1"
    s="${s#\"}"
    s="${s%\"}"
    printf '%s\n' "$s"
}

# _wg_absolutize <path> -- strip surrounding double quotes, then prefix a
# relative path with the hook's cwd; an already-absolute path passes through.
_wg_absolutize() {
    local p
    p="$(_wg_strip_dquotes "$1")"
    case "$p" in
        /*) printf '%s\n' "$p" ;;
        *) printf '%s\n' "$PWD/$p" ;;
    esac
}

# _wg_extract_bash_targets <chain segment> -- emits 0+ candidate write-target
# paths (not yet absolutized) for one already quote-normalized `&&`/`||`/`;`/
# `|` chain segment. Mirrors the write-vectors of the retired
# _wg_ledger_target_in_segment classifier (redirect, tee/rm/truncate, dd of=,
# sed -i, cp/mv last-arg) but EXTRACTS the target instead of testing it for a
# "session-ledger-" substring -- write_guard_core_run does an EXACT full-path
# comparison, so a harmless non-ledger candidate simply never matches.
_wg_extract_bash_targets() {
    local seg="$1"
    # `|| true`: grep -oE returns 1 when a segment has no redirect at all --
    # under this script's `set -euo pipefail`, an unguarded nonzero pipeline
    # here would abort the function before the case block below ever runs.
    echo "$seg" | grep -oE '>{1,2}[[:space:]]*[^[:space:]]+' | sed -E 's/^>{1,2}[[:space:]]*//' || true

    local first_word
    first_word=$(echo "$seg" | awk '{print $1}')
    case "$first_word" in
        tee|rm|truncate)
            echo "$seg" | awk '{print $NF}'
            ;;
        dd)
            echo "$seg" | grep -oE 'of=[^[:space:]]+' | sed -E 's/^of=//' || true
            ;;
        sed)
            if echo "$seg" | grep -q -- '-i'; then
                echo "$seg" | awk '{print $NF}'
            fi
            ;;
        cp|mv)
            echo "$seg" | awk '{print $NF}'
            ;;
    esac
}

_wg_sid="${OMT_SESSION_ID:-}"
_wg_omt_dir="${OMT_DIR:-}"

if [[ -n "$_wg_sid" && -n "$_wg_omt_dir" ]]; then
    _wg_candidates=""

    if [[ "$toolName" == "Bash" ]] && command -v jq > /dev/null 2>&1; then
        _wg_cmd=$(echo "$input" | jq -r '.tool_input.command // empty' 2>/dev/null) || _wg_cmd=""
        if [[ -n "$_wg_cmd" ]]; then
            # Single-quoted spans are inert shell literals -- but deleting them
            # wholesale (old approach) also erased REAL quoted write targets like
            # `rm '/tmp/session-ledger-x.md'`. Quote-aware normalization instead:
            # drop the quote CHARACTERS but keep the quoted CONTENT visible, while
            # masking shell-active metachars (`> < | ; &`) that appear INSIDE quotes
            # -- so an in-quote `>` never reads as a live redirect (grep below) and
            # an in-quote `|`/`;`/`&` never spuriously splits a segment. Metachars
            # OUTSIDE quotes (real redirects/splitters) and DOUBLE-quoted paths
            # (`> "$f"`) pass through unchanged, exactly as before.
            _wg_scan=$(printf '%s' "$_wg_cmd" | awk '
                BEGIN { sq = sprintf("%c", 39) }
                {
                    n = length($0)
                    inq = 0
                    out = ""
                    for (i = 1; i <= n; i++) {
                        c = substr($0, i, 1)
                        if (c == sq) {
                            inq = 1 - inq
                            continue
                        }
                        if (inq && (c == ">" || c == "<" || c == "|" || c == ";" || c == "&")) {
                            out = out " "
                            continue
                        }
                        out = out c
                    }
                    print out
                }')
            while IFS= read -r _wg_seg; do
                [[ -z "$_wg_seg" ]] && continue
                while IFS= read -r _wg_target; do
                    [[ -z "$_wg_target" ]] && continue
                    _wg_candidates="${_wg_candidates}$(_wg_absolutize "$_wg_target")
"
                done < <(_wg_extract_bash_targets "$_wg_seg")
            done < <(echo "$_wg_scan" | sed -E 's/(&&|\|\||;|\|)/\n/g')
        fi
    elif [[ "$toolName" == "Write" || "$toolName" == "Edit" || "$toolName" == "MultiEdit" ]] && command -v jq > /dev/null 2>&1; then
        _wg_fp=$(echo "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null) || _wg_fp=""
        if [[ -n "$_wg_fp" ]]; then
            # Trailing literal newline (not `$(...)`, which strips it) --
            # write_guard_core_run's stdin while-loop silently drops a final
            # line with no trailing newline (read returns nonzero at EOF).
            _wg_candidates="$(_wg_absolutize "$_wg_fp")
"
        fi
    fi

    if [[ -n "$_wg_candidates" ]]; then
        _wg_out=$(printf '%s' "$_wg_candidates" | write_guard_core_run "$_wg_omt_dir" "$_wg_sid")
        if [[ -n "$_wg_out" ]]; then
            printf '%s\n' "$_wg_out"
            exit 0
        fi
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
        prometheus|goal|ultragoal|deep-interview|qa)
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
                    ultragoal)
                        # ultragoal-state.ts (skills/ultragoal/scripts/ultragoal-state.ts) is a
                        # structural copy of goal-state.ts with its own file prefix — the pristine
                        # seed skeleton is identical to goal's, just written to ultragoal-state-.
                        write_seed_if_absent \
                            "$omt_dir/ultragoal-state-${sid}.json" \
                            "ultragoal" \
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

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

# Handoff-gate arm (ADR D-1/D-2/D-5..D-9): while armed, forces a single clean
# `cat` of the compaction handoff before any other tool call. Uses
# permissionDecision:"deny" (denies only THIS call, the turn continues) --
# NOT the TaskOutput arm's continue:false (halts the whole turn). Do not
# copy continue:false here; a denied tool call must not also halt the turn.
_hg_sid="${OMT_SESSION_ID:-}"
if [[ -n "$_hg_sid" ]] && ! echo "$_hg_sid" | grep -qE '^[A-Za-z0-9_-]{1,200}$'; then
    _hg_sid=""
fi
if [[ -z "$_hg_sid" ]]; then
    _hg_stdin_sid=$(extract_json_field "session_id" "")
    if [[ -n "$_hg_stdin_sid" ]] && echo "$_hg_stdin_sid" | grep -qE '^[A-Za-z0-9_-]{1,200}$'; then
        _hg_sid="$_hg_stdin_sid"
    fi
fi

_hg_omt_dir="${OMT_DIR:-}"
if [[ -z "$_hg_omt_dir" ]]; then
    _hg_stdin_cwd=$(extract_json_field "cwd" "")
    if [[ -n "$_hg_stdin_cwd" ]]; then
        # BASH_SOURCE-relative sourcing for resolve_omt_dir (mirrors :40-41,:58 below)
        _hg_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
        _hg_omt_dir=$(source "$_hg_script_dir/lib/omt-dir.sh" && unset OMT_DIR && resolve_omt_dir "$_hg_stdin_cwd")
    fi
fi

# Arming predicate: ALL must hold, else fail-open (fall through silently).
# Writability + jq availability are part of arming, not deferred, so a
# non-cat call under an unwritable dir / jq-less box fails OPEN, not denied
# (no-livelock).
_hg_armed=0
if [[ -n "$_hg_sid" && -n "$_hg_omt_dir" ]]; then
    _hg_H="$_hg_omt_dir/handoff-${_hg_sid}.md"
    _hg_M="$_hg_omt_dir/handoff-consumed-${_hg_sid}"
    if [[ -f "$_hg_H" && ! -f "$_hg_M" && -w "$_hg_omt_dir" ]] && command -v jq > /dev/null 2>&1; then
        _hg_armed=1
    fi
fi

if [[ "$_hg_armed" -eq 1 ]]; then
    # Quote-aware tokenizer (no eval/bash -c/$(...) on decoded bytes): splits
    # $1 into _hg_tokens[], stripping quote delimiters. _hg_sqdollar[k]=1
    # marks a token whose content came from inside single quotes AND held a
    # literal '$' -- the shell would not expand that, so substituting it here
    # would be a false-allow silent-skip; treated as a deny signal below.
    # _hg_unqdollar[k]=1 is the symmetric case: a token holding a '$' that was
    # OUTSIDE any quotes. Unquoted expansion is subject to word-splitting and
    # globbing, so an unquoted $OMT_DIR carrying a space (or glob char) would
    # make our pure textual substitution diverge from what bash actually runs
    # (cat receives split args, never reads the handoff) -- also a deny signal.
    # Only a double-quoted '$' is safe (expands without split/glob), which is
    # exactly the canonical form the deny message instructs.
    _hg_tokenize() {
        local s="$1" i=0 len c cur="" in_token=0 quote="" cur_sqdollar=0 cur_unqdollar=0
        len=${#s}
        _hg_tokens=()
        _hg_sqdollar=()
        _hg_unqdollar=()
        while [[ "$i" -lt "$len" ]]; do
            c="${s:$i:1}"
            if [[ -n "$quote" ]]; then
                if [[ "$c" == "$quote" ]]; then
                    quote=""
                else
                    [[ "$quote" == "'" && "$c" == '$' ]] && cur_sqdollar=1
                    cur+="$c"
                fi
            else
                case "$c" in
                    ' '|$'\t')
                        if [[ "$in_token" -eq 1 ]]; then
                            _hg_tokens+=("$cur")
                            _hg_sqdollar+=("$cur_sqdollar")
                            _hg_unqdollar+=("$cur_unqdollar")
                            cur=""
                            in_token=0
                            cur_sqdollar=0
                            cur_unqdollar=0
                        fi
                        ;;
                    '"'|"'")
                        quote="$c"
                        in_token=1
                        ;;
                    *)
                        [[ "$c" == '$' ]] && cur_unqdollar=1
                        cur+="$c"
                        in_token=1
                        ;;
                esac
            fi
            i=$((i + 1))
        done
        if [[ -n "$quote" ]]; then
            return 1
        fi
        if [[ "$in_token" -eq 1 ]]; then
            _hg_tokens+=("$cur")
            _hg_sqdollar+=("$cur_sqdollar")
            _hg_unqdollar+=("$cur_unqdollar")
        fi
        return 0
    }

    _hg_allow=0
    if [[ "$toolName" == "Bash" ]]; then
        _hg_cmd=$(echo "$input" | jq -r '.tool_input.command // empty' 2>/dev/null) || _hg_cmd=""
        # Deny BEFORE any expansion -- the subshell/redirect/chain below is
        # never executed, only string-matched.
        if ! echo "$_hg_cmd" | grep -qE '[|;<>&`]|\$\(|tail|head|sed'; then
            if _hg_tokenize "$_hg_cmd"; then
                if [[ "${#_hg_tokens[@]}" -eq 2 && "${_hg_tokens[0]}" == "cat" \
                    && "${_hg_sqdollar[1]:-0}" != "1" \
                    && "${_hg_unqdollar[1]:-0}" != "1" ]]; then
                    _hg_arg="${_hg_tokens[1]}"
                    _hg_candidate="${_hg_arg//\$OMT_DIR/$_hg_omt_dir}"
                    _hg_candidate="${_hg_candidate//\$OMT_SESSION_ID/$_hg_sid}"
                    _hg_expected="$_hg_omt_dir/handoff-${_hg_sid}.md"
                    if [[ "$_hg_candidate" == "$_hg_expected" ]]; then
                        _hg_allow=1
                    fi
                fi
            fi
        fi
    fi

    if [[ "$_hg_allow" -eq 1 ]]; then
        # Marker write is EXCLUSIVE to this branch -- never a shared prologue.
        : > "$_hg_M" 2>/dev/null || true
        # Fall through to the existing allow path below.
    else
        # permissionDecision:"deny" (deny-this-one-call) -- NOT continue:false
        # (halt-turn); see the header comment above.
        printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Read the full compaction handoff FIRST — run: cat \"$OMT_DIR/handoff-$OMT_SESSION_ID.md\" (no truncation, no other tool until then)"}}'
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

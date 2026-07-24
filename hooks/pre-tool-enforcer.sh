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
#
# The same extracted candidate set also feeds a second, independent guard
# (code-review-artifact-guard-core plan): identity-conditional protection for
# the code-review completion-gate artifacts ($OMT_DIR/ultragoal-codereview-
# <sid>.json, $OMT_DIR/goal-codereview-<sid>.json), allowing the write only
# when the payload's top-level agent_type is exactly "code-reviewer" --
# see the wiring below and hooks/write-guard-core.sh (codereview_guard_core_run).
# =============================================================================
_wg_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=hooks/write-guard-core.sh
source "$_wg_script_dir/write-guard-core.sh"

# _wg_strip_dquotes <token> -- removes EVERY double-quote character in the
# token, not just an outermost pair. Double-quoted write targets (`> "$f"`)
# pass through the quote-aware normalizer below unchanged (only single quotes
# are unwrapped there), so an extracted token still carries its quote
# characters and must be unwrapped before an EXACT path comparison. A target
# can also be assembled from multiple double-quoted SPANS glued together with
# no separating whitespace (e.g. `"$OMT_DIR"/"session-ledger-$OMT_SESSION_ID
# .md"`) -- the real shell concatenates adjacent quoted spans into one word
# and drops every quote character, so stripping only the outer pair would
# leave embedded quotes that break the byte-EXACT compare downstream.
# Stripping all quote characters mirrors that real-shell behavior; a harmless
# non-ledger candidate that happens to carry embedded quotes simply still
# fails the EXACT match, so over-stripping here is not a bypass.
_wg_strip_dquotes() {
    local s="$1"
    s="${s//\"/}"
    printf '%s\n' "$s"
}

# _wg_absolutize <path> -- strip surrounding double quotes, expand the two
# known ledger-path env-vars via pure bash literal substitution, then prefix
# a relative path with the hook's cwd; an already-absolute path passes
# through.
#
# Why: a candidate arrives as the LITERAL command text (e.g. "$OMT_DIR/
# session-ledger-$OMT_SESSION_ID.md"), not what the real shell would expand
# it to at execution time -- the old code recognized only a leading '/' as
# absolute, so this literal was treated as RELATIVE and got $PWD prefixed
# instead, never matching the resolved ledger path. hooks/omt-ledger.sh's
# SessionStart recovery pointer teaches exactly this literal-env-var form,
# so it is the PRIMARY reproduction shape, not an edge case.
#
# ${p//find/replace} is a pure bash string substitution -- never eval/
# envsubst, which would let an arbitrary $(...) or other variable reference
# inside an untrusted Bash tool_input.command execute. OMT_DIR, OMT_SESSION_ID,
# HOME, and a leading ~ are expanded: OMT_DIR/OMT_SESSION_ID compose the
# ledger path directly (write_guard_core_run's ledger_path in
# hooks/write-guard-core.sh), and $_wg_omt_dir is always
# $HOME/.omt/<proj> -- so a $HOME- or ~-relative spelling of that same path
# composes the identical ledger file and must be matched too, or it silently
# bypasses the guard. PWD/CLAUDE_PROJECT_DIR/etc are still NOT expanded: they
# do not compose the ledger path, so expanding them would be pure surface
# with no guard benefit. The braced form (${VAR}) is substituted before the
# bare $VAR form so substituting "$OMT_DIR" first would not leave a stray
# "{}" around the resolved value inside "${OMT_DIR}". If HOME is unset/empty,
# the $HOME token is simply dropped and the path won't match the ledger --
# the safe direction (ALLOW), never a false block.
#
# KNOWN LIMITATION: a single-quoted reference (`rm '$OMT_DIR/...'`) is an
# inert shell literal that never actually expands at real execution time
# either -- but the quote-aware normalizer upstream (_wg_scan) has already
# stripped the quote characters by the time this function runs, so it is
# indistinguishable here from a double-quoted reference and gets
# substituted (and matched) the same way. That command is inert and
# harmless to begin with, so denying it is a safe false-positive, not a
# bypass.
#
# OUT OF SCOPE (best-effort literal-text scan, not a shell interpreter):
# acknowledged, not fixed. cd into the ledger dir then a relative-path
# write/delete; variable indirection (p=$OMT_DIR; rm "$p/session-ledger-...");
# parameter expansion other than the handled $OMT_DIR/$OMT_SESSION_ID/$HOME/~;
# process substitution; brace expansion (rm session-ledger-{<sid>,x}.md);
# ANSI-C $'...' quoting; adjacent/combined multi-target redirects glued
# without whitespace (>a>b, >&file); and an OMT_DIR containing whitespace
# (operand splitting).
_wg_absolutize() {
    local p
    p="$(_wg_strip_dquotes "$1")"
    p="${p//\$\{OMT_DIR\}/$_wg_omt_dir}"
    p="${p//\$\{OMT_SESSION_ID\}/$_wg_sid}"
    p="${p//\$OMT_DIR/$_wg_omt_dir}"
    p="${p//\$OMT_SESSION_ID/$_wg_sid}"
    p="${p//\$\{HOME\}/${HOME:-}}"
    p="${p//\$HOME/${HOME:-}}"
    case "$p" in
        "~") p="${HOME:-}" ;;
        "~/"*) p="${HOME:-}/${p#\~/}" ;;
    esac
    case "$p" in
        /*) printf '%s\n' "$p" ;;
        *) printf '%s\n' "$PWD/$p" ;;
    esac
}

# _wg_extract_bash_targets <chain segment> -- emits 0+ candidate write-target
# paths (not yet absolutized) for one already quote-normalized `&&`/`||`/`;`/
# `|` chain segment. Mirrors the write-vectors of the retired
# _wg_ledger_target_in_segment classifier (redirect, tee/rm/truncate, dd of=,
# sed -i, cp last-arg, mv every operand) but EXTRACTS the target instead of
# testing it for a "session-ledger-" substring -- write_guard_core_run does an
# EXACT full-path comparison, so a harmless non-ledger candidate simply never
# matches. `cp` and `mv` are separate arms below and are NOT interchangeable:
# only `mv` destroys its source, so only `mv` extracts source operands.
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
            # Every non-option operand, not just the last -- `rm <ledger>
            # <other>` used to extract only "<other>" ($NF), leaving the
            # ledger operand unchecked whenever it wasn't the final argument.
            # Mirrors the already-correct Codex extractor
            # (_cwg_extract_shell_targets in hooks/codex-write-guard.sh).
            echo "$seg" | awk '{for(i=2;i<=NF;i++) if($i !~ /^-/) print $i}'
            ;;
        dd)
            echo "$seg" | grep -oE 'of=[^[:space:]]+' | sed -E 's/^of=//' || true
            ;;
        sed)
            if echo "$seg" | grep -q -- '-i'; then
                # Every non-option operand, not just the last -- mirrors the
                # tee/rm/truncate fix above (`sed -i SCRIPT file1 file2` edits
                # EVERY file operand in place, not just the final one). This
                # over-extracts the SCRIPT operand too, which is harmless: it
                # never EXACT-matches the ledger path.
                echo "$seg" | awk '{for(i=2;i<=NF;i++) if($i !~ /^-/) print $i}'
            fi
            ;;
        cp)
            # Destination only. `cp <guarded> /tmp/x` READS the guarded path
            # and leaves it intact, so extracting the source operand here
            # would false-deny a harmless copy.
            echo "$seg" | awk '{print $NF}'
            ;;
        mv)
            # Every non-option operand, not just the last -- `mv` DELETES its
            # source, so `mv <guarded> /tmp/x` removes the guarded path exactly
            # like `rm <guarded>`, which the tee/rm/truncate arm above already
            # catches. $NF alone saw only the destination, leaving the delete
            # leg of the write/delete contract open through this one verb.
            # Split from `cp` above because only `mv` is destructive.
            echo "$seg" | awk '{for(i=2;i<=NF;i++) if($i !~ /^-/) print $i}'
            ;;
    esac
}

_wg_sid="${OMT_SESSION_ID:-}"
_wg_omt_dir="${OMT_DIR:-}"

# Fallback to the stdin payload when env is absent -- mirrors the Skill-seed
# block's resolution precedence below (env first, then stdin session_id/cwd).
# Without this, the guard went dark (silent no-op) during the session
# bootstrap window, before CLAUDE_ENV_FILE exports are sourced into the
# environment, even though the stdin payload still carries session_id + cwd.
# Same safety charset validation as the seed block: an unsafe stdin
# session_id must not arm the guard.
if [[ -z "$_wg_sid" ]]; then
    _wg_stdin_sid=$(extract_json_field "session_id" "")
    if [[ -n "$_wg_stdin_sid" ]] && echo "$_wg_stdin_sid" | grep -qE '^[A-Za-z0-9_-]{1,200}$'; then
        _wg_sid="$_wg_stdin_sid"
    fi
fi

if [[ -z "$_wg_omt_dir" ]]; then
    _wg_stdin_cwd=$(extract_json_field "cwd" "")
    if [[ -n "$_wg_stdin_cwd" ]]; then
        _wg_omt_dir=$(source "$_wg_script_dir/lib/omt-dir.sh" && unset OMT_DIR && resolve_omt_dir "$_wg_stdin_cwd")
    fi
fi

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
            # an in-quote `|`/`;`/`&` never spuriously splits a segment.
            #
            # DOUBLE-quoted spans are masked too (CONFIRMED parity fix, both-
            # platform measurement): this file used to mask single quotes only,
            # so `echo "note; rm <ledger>"` was read as a live `;`-chain and
            # DENIED here, while the Codex twin's _cwg_mask_quoted
            # (hooks/codex-write-guard.sh) already masked double-quoted spans
            # too and ALLOWED the identical command -- a same-command,
            # different-verdict divergence against this repo's parity
            # invariant ("same verdict for the same command", not "identical
            # code path" -- see hooks/codex-write-guard.sh's own header). This
            # block is widened to match: quote-toggle logic, the backslash
            # pass-through that keeps an escaped `\"` from desyncing in-quote
            # tracking, and the `$( ... )`/backtick-span suspension (a `;`/
            # `rm` sitting inside a LIVE command substitution nested in double
            # quotes -- e.g. `echo "$(true; rm <ledger>)"` -- is real shell
            # code the outer shell actually executes, so masking must not hide
            # it) are ported verbatim from _cwg_mask_quoted's pre-existing
            # logic. Independently re-derived here, not sourced from that
            # file, per this repo's own established Claude/Codex
            # parsing-independence convention (hooks/codex-write-guard.sh's
            # file header) -- the two guards can still diverge if one is
            # edited without the other.
            _wg_scan=$(printf '%s' "$_wg_cmd" | awk '
                BEGIN { sq = sprintf("%c", 39); dq = sprintf("%c", 34); bs = sprintf("%c", 92); dl = sprintf("%c", 36); lp = sprintf("%c", 40); rp = sprintf("%c", 41); bt = sprintf("%c", 96) }
                {
                    n = length($0)
                    insq = 0
                    indq = 0
                    dpdepth = 0
                    subsq = 0
                    subdq = 0
                    btactive = 0
                    out = ""
                    for (i = 1; i <= n; i++) {
                        c = substr($0, i, 1)

                        if (c == bs && !insq && i < n) {
                            out = out c substr($0, i + 1, 1)
                            i++
                            continue
                        }

                        # Quote state INSIDE the substitution is tracked
                        # separately (subsq/subdq): a QUOTED right-paren --
                        # as in a printf whose sole argument is that
                        # character -- is ordinary text to the shell and does
                        # NOT close the substitution. Untracked, it dropped
                        # dpdepth to 0, every separator behind it was then
                        # read as inside the OUTER double quotes and masked
                        # away, and a chained `rm <ledger>` went unseen. The
                        # closing right-paren is emitted as a space because
                        # it is a token boundary at execution time, not part
                        # of the last word: glued on, it broke the whole-token
                        # guarded-path comparison downstream.
                        if (dpdepth > 0) {
                            if (subsq) {
                                if (c == sq) { subsq = 0 }
                            } else if (subdq) {
                                if (c == bs && i < n) { out = out c; i++; c = substr($0, i, 1) }
                                else if (c == dq) { subdq = 0 }
                            } else if (c == bs && i < n) {
                                out = out c; i++; c = substr($0, i, 1)
                            } else if (c == sq) {
                                subsq = 1
                            } else if (c == dq) {
                                subdq = 1
                            } else if (c == lp) {
                                dpdepth++
                            } else if (c == rp) {
                                dpdepth--
                                if (dpdepth == 0) { out = out " "; continue }
                            }
                            out = out c
                            continue
                        }
                        if (btactive) {
                            if (c == bt) { btactive = 0 }
                            out = out c
                            continue
                        }

                        if (indq && c == dl && i < n && substr($0, i + 1, 1) == lp) {
                            dpdepth = 1
                            subsq = 0
                            subdq = 0
                            out = out c lp
                            i++
                            continue
                        }
                        if (indq && c == bt) {
                            btactive = 1
                            out = out c
                            continue
                        }

                        if (!indq && c == sq) {
                            insq = 1 - insq
                            continue
                        }
                        if (!insq && c == dq) {
                            indq = 1 - indq
                            continue
                        }
                        if ((insq || indq) && (c == ">" || c == "<" || c == "|" || c == ";" || c == "&")) {
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

        # Code-review artifact identity guard (code-review-artifact-guard-core
        # plan): a SEPARATE gate from the unconditional ledger guard just
        # above, run on the SAME _wg_candidates -- the two are different
        # rule kinds (unconditional deny vs identity-conditional allow) so
        # they must fire independently rather than one being nested inside
        # the other. agent_type is read via jq's ".agent_type" path, which
        # binds ONLY the payload's TOP-LEVEL field -- never a same-named key
        # nested under tool_input, which an agent fully controls -- mirroring
        # the Codex twin's own top-level-only agent_type extraction in
        # hooks/codex-write-guard.sh. A
        # failed/absent extraction becomes "" (fail-closed), same as every
        # other jq extraction in this file. Absence must DENY here, not
        # allow -- NOT because a main-thread tool call never carries
        # agent_type (it can, on the main thread of a session started with
        # `--agent <name>`), but because allowing on absence would let an
        # ordinary orchestrator forge the code-review artifact itself with
        # zero extra cost (fail-closed; see CLAUDE.md's Code-review artifact
        # identity guard entry for the full trust-channel rationale). The
        # verdict wording and path/identity comparison are single-sourced in
        # hooks/write-guard-core.sh (codereview_guard_core_run); this shim
        # only extracts agent_type and forwards the same candidate set.
        _wg_agent_type=$(echo "$input" | jq -r '.agent_type // empty' 2>/dev/null) || _wg_agent_type=""
        _wg_cr_out=$(printf '%s' "$_wg_candidates" | codereview_guard_core_run "$_wg_omt_dir" "$_wg_sid" "$_wg_agent_type")
        if [[ -n "$_wg_cr_out" ]]; then
            printf '%s\n' "$_wg_cr_out"
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

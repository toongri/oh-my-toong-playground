#!/usr/bin/env bash
# Score a codex run against sisyphus's behavioural axes.
#
#   ./score-run.sh <stream.jsonl> ...   # headless: `codex exec --json` streams
#   ./score-run.sh --thread <id> ...    # any session, by codex thread id
#   ./score-run.sh --last [N]           # the N most recent interactive sessions
#
# Delegation is read from ~/.codex/state_5.sqlite, never from the event stream:
# an `exec --json` parent stream reports every collab_tool_call as `wait` with an
# empty receiver list even when children exist, so grepping it for spawn_agent is
# an invalid detector — see codex-delegation-scenarios.md. Interactive rollouts
# DO record spawn_agent, but the DB stays the single source for this axis.
set -euo pipefail

CODEX="${CODEX_HOME:-$HOME/.codex}"
DB="$CODEX/state_5.sqlite"

# Defined agent types. codex accepts an undefined or omitted agent_type silently
# and runs it. Reporting one is a FACT, not a verdict: the dominant population is
# review-angle fan-out, where no defined agent corresponds in the first place.
# `|| true`: a missing or empty agents dir makes `ls` exit non-zero, and pipefail
# would then kill the whole script inside this assignment — before the header
# prints, with no message. An empty role set is a valid state, not a crash.
known_roles=$(ls "$CODEX/agents"/*.toml 2>/dev/null | while read -r p; do
  b=${p##*/}; printf '%s\n' "${b%.toml}"
done | sort || true)

jqs() { jq -Rc "fromjson? | $1" "$2"; }

# emit <label> <root-thread-id> <agent-messages> <todo-done> <todo-total> <parent-tool-text>
emit() {
  local label="$1" root="$2" msgs="$3" todo_done="$4" todo_n="$5" tools="$6"
  local children roles tokens classify routes verdict declared spawned kept writes

  children=$(sqlite3 "$DB" \
    "SELECT count(*) FROM thread_spawn_edges WHERE parent_thread_id='$root';")
  roles=$(sqlite3 "$DB" \
    "SELECT group_concat(r,',') FROM (SELECT DISTINCT coalesce(t.agent_role,'?') AS r
       FROM thread_spawn_edges e JOIN threads t ON t.id=e.child_thread_id
      WHERE e.parent_thread_id='$root' ORDER BY r);")
  tokens=$(sqlite3 "$DB" \
    "SELECT coalesce(sum(t.tokens_used),0) FROM thread_spawn_edges e
       JOIN threads t ON t.id=e.child_thread_id WHERE e.parent_thread_id='$root';")

  local blocks
  blocks=$(printf '%s' "$msgs" | grep -cE 'Task Classification' || true)
  if [ "$blocks" -gt 0 ]; then classify="$blocks"; else classify=no; fi
  # The block's own `… | routing: <value>` shape. In practice the value is prose
  # ("independent code-reviewer"), not a bare agent name, so read the whole value
  # and pick out the defined roles it names rather than taking its first word.
  local values self
  values=$(printf '%s' "$msgs" | grep -oE '\| routing: [^|]*' | sed 's/.*routing: //' || true)
  routes=$(printf '%s\n' "$known_roles" | while read -r r; do
    [ -n "$r" ] && printf '%s' "$values" | grep -qF "$r" && printf '%s\n' "$r"
  done | sort -u | paste -sd, - || true)
  # bare `me` must not match inside `implement`; BSD grep has no \b here.
  self=$(printf '%s' "$values" | grep -cE 'inline|self|(^|[^a-z])me([^a-z]|$)' || true)
  if [ "$self" -gt 0 ]; then routes="${routes:+$routes,}inline"; fi
  verdict=$(printf '%s' "$msgs" \
    | grep -oE 'REQUEST_CHANGES|APPROVE|COMMENT' | sort -u | paste -sd, - || true)

  # Declared targets must equal the roles actually spawned. Self-routing synonyms
  # are not spawns: the rewritten body says `inline`, the pre-rewrite body `me`.
  # BSD grep BRE `\|` is unreliable here — every pattern in this script uses -E.
  # Only meaningful for a single work unit: a long session accumulates many
  # Classification Blocks, and comparing their union against the session-wide
  # spawn set manufactures DRIFT. Report n/a rather than a bogus verdict.
  declared=$(printf '%s' "$routes" | tr ',' '\n' | grep -vE '^(inline|me|self|you)?$' | sort -u || true)
  spawned=$(printf '%s' "$roles" | tr ',' '\n' | grep -vE '^$' | sort -u || true)
  if [ "$blocks" -ne 1 ]; then kept=n/a
  elif [ "$declared" = "$spawned" ]; then kept=MATCH; else kept=DRIFT; fi

  local bad
  bad=$(comm -23 <(printf '%s\n' "$spawned") <(printf '%s\n' "$known_roles") | paste -sd, - || true)

  # Iron Law: the orchestrator's own hands must not touch a deliverable. Writes
  # under $OMT_DIR are the one carve-out (orchestration bookkeeping), so count
  # only targets outside it. Callers normalise their own shape into this text:
  # headless passes `file_change` items, interactive passes apply_patch payloads.
  # Still read the paths — a fixture living outside $OMT_DIR makes its own
  # bookkeeping files (e.g. a verdict tmp) look like deliverable writes.
  writes=$(printf '%s' "$tools" \
    | grep -oE '\*\*\* [A-Za-z]+ File: [^\\"]+' \
    | sed 's/.*File: //' | grep -v '/\.omt/' | wc -l | tr -d ' ' || true)

  printf '%s\t%s\t%s\t%s\t%s/%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$label" "$children" "${roles:--}" "$tokens" "$todo_done" "$todo_n" \
    "$classify" "${routes:--}" "$kept" "${bad:--}" "${verdict:--}" "$writes"
}

# Headless: `codex exec --json` stream file.
score_stream() {
  local f="$1" root todo msgs writes
  root=$(jqs 'select(.type=="thread.started") | .thread_id' "$f" | tr -d '"' | head -1)
  [ -n "$root" ] || { printf '%s\tNO-THREAD\n' "$(basename "$f" .jsonl)"; return; }

  todo=$(jqs 'select(.item.type=="todo_list") | .item.items
              | "\(map(select(.completed)) | length) \(length)"' "$f" | tr -d '"' | tail -1)
  [ -n "$todo" ] || todo="- -"   # no todo_list at all — print -/- , not a bare slash
  msgs=$(jqs 'select(.item.type=="agent_message") | .item.text' "$f" || true)
  # The parent's own edits arrive as `file_change` items — NOT as apply_patch text
  # inside a command. A positive control (parent told to edit directly, no skill)
  # produced zero `Begin Patch` and one `file_change`, so a command-only detector
  # reports 0 for every run and never fires.
  writes=$(jqs 'select(.item.type=="file_change") | select(.type=="item.completed")
                | .item.changes[] | "*** \(.kind) File: \(.path)"' "$f" | tr -d '"' || true)

  emit "$(basename "$f" .jsonl)" "$root" "$msgs" "${todo%% *}" "${todo##* }" "$writes"
}

# Any session, by thread id — reads the rollout the DB points at.
score_thread() {
  local root="$1" rp msgs writes plan done total label
  rp=$(sqlite3 "$DB" "SELECT rollout_path FROM threads WHERE id='$root';")
  [ -n "$rp" ] && [ -f "$rp" ] || { printf '%s\tNO-ROLLOUT\n' "$root"; return; }

  msgs=$(jq -rc 'select(.type=="event_msg" and .payload.type=="agent_message")
                 | .payload.message' "$rp" 2>/dev/null || true)
  writes=$(jq -rc 'select(.payload.type=="function_call" or .payload.type=="custom_tool_call")
                   | (.payload.arguments // .payload.input // "")' "$rp" 2>/dev/null || true)

  # Best-effort todo: the last update_plan payload, whatever tool shape carried it.
  # Keep the payload JSON-encoded (-c, not -rc) so one payload stays one line —
  # raw mode expands the embedded \n and `tail -1` then lands on a fragment.
  plan=$(jq -c 'select(.payload.type=="function_call" or .payload.type=="custom_tool_call")
                | (.payload.arguments // .payload.input // "")
                | select(test("update_plan"))' "$rp" 2>/dev/null | tail -1 | jq -r . 2>/dev/null || true)
  if [ -n "$plan" ]; then
    # a plan with zero completed steps makes grep exit 1 — pipefail would kill the run
    done=$(printf '%s' "$plan" | grep -oE '"completed"' | wc -l | tr -d ' ' || true)
    total=$(printf '%s' "$plan" | grep -oE '"(completed|in_progress|pending)"' | wc -l | tr -d ' ' || true)
  else
    done=- total=-
  fi

  label=$(sqlite3 "$DB" "SELECT source || ':' || substr(id,1,8) FROM threads WHERE id='$root';")
  emit "$label" "$root" "$msgs" "$done" "$total" "$writes"
}

mode=stream
case "${1:-}" in
  --thread) mode=thread; shift ;;
  --last)   shift
            # bash 3.2: no mapfile — collect ids into the positional params.
            ids=$(sqlite3 "$DB" "SELECT id FROM threads
              WHERE agent_role IS NULL AND source='cli'
              ORDER BY created_at DESC LIMIT ${1:-1};")
            set -- $ids; mode=thread ;;
esac

printf 'run\tchildren\troles\ttokens\ttodo\tclassify\trouting\tkept\tbad-role\tverdict\trepo-writes\n'
for a in "$@"; do
  case "$mode" in
    thread) score_thread "$a" ;;
    *)      score_stream "$a" ;;
  esac
done

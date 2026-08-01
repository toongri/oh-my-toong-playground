#!/usr/bin/env bash
# Score a codex `exec --json` run against sisyphus's behavioural axes.
#
#   ./score-run.sh <stream.jsonl> [more.jsonl ...]
#
# The parent event stream does NOT contain child spawns (every collab_tool_call
# reports `wait` with an empty receiver list even when children exist), so the
# delegation axis is read from ~/.codex/state_5.sqlite instead. Grepping the
# stream for spawn_agent is an invalid detector — see codex-delegation-scenarios.md.
set -euo pipefail

DB="${CODEX_HOME:-$HOME/.codex}/state_5.sqlite"

jqs() { jq -Rc "fromjson? | $1" "$2"; }

score_one() {
  local f="$1" root children roles child_tokens todo_n todo_done
  local classify routes verdict writes

  root=$(jqs 'select(.type=="thread.started") | .thread_id' "$f" | tr -d '"' | head -1)
  [ -n "$root" ] || { printf '%s\tNO-THREAD\n' "$(basename "$f")"; return; }

  # --- delegation axis (ground truth: spawn edges + child roles) ---
  children=$(sqlite3 "$DB" \
    "SELECT count(*) FROM thread_spawn_edges WHERE parent_thread_id='$root';")
  roles=$(sqlite3 "$DB" \
    "SELECT group_concat(r,',') FROM (SELECT DISTINCT coalesce(t.agent_role,'?') AS r
       FROM thread_spawn_edges e JOIN threads t ON t.id=e.child_thread_id
      WHERE e.parent_thread_id='$root' ORDER BY r);")
  child_tokens=$(sqlite3 "$DB" \
    "SELECT coalesce(sum(t.tokens_used),0) FROM thread_spawn_edges e
       JOIN threads t ON t.id=e.child_thread_id WHERE e.parent_thread_id='$root';")

  # --- task-management axis (final todo_list snapshot) ---
  local todo
  todo=$(jqs 'select(.item.type=="todo_list") | .item.items
              | {n: length, done: (map(select(.completed)) | length)}' "$f" | tail -1)
  todo_n=$(printf '%s' "${todo:-{\"n\":0,\"done\":0\}}" | jq -r '.n')
  todo_done=$(printf '%s' "${todo:-{\"n\":0,\"done\":0\}}" | jq -r '.done')

  # --- discipline axis (Classification Block + declared routing targets) ---
  local msgs
  msgs=$(jqs 'select(.item.type=="agent_message") | .item.text' "$f" || true)
  if printf '%s' "$msgs" | grep -q 'Task Classification'; then classify=yes; else classify=no; fi
  routes=$(printf '%s' "$msgs" \
    | grep -o 'routing: [a-z-]*' | sed 's/routing: //' | sort -u | paste -sd, -)

  # --- verdict axis ---
  verdict=$(printf '%s' "$msgs" \
    | grep -oE 'REQUEST_CHANGES|APPROVE|COMMENT' | sort -u | paste -sd, - || true)

  # --- Iron Law axis: parent-side mutating commands (review each by hand;
  #     evidence-path writes are sanctioned, deliverable writes are not) ---
  writes=$(jqs 'select(.item.type=="command_execution") | .item.command' "$f" \
    | grep -cE 'apply_patch|sed -i| tee |>>?[^&|]' || true)

  # --- the delegation verdict: every declared target (bar `inline`) was
  #     actually spawned, and nothing was spawned that was never declared ---
  local declared spawned kept
  # BSD grep BRE `\|` is unreliable here — every pattern in this script uses -E.
  # self-routing synonyms are not spawns: the rewritten body says `inline`,
  # the pre-rewrite body said `me`. Both mean "the orchestrator does it".
  declared=$(printf '%s' "$routes" | tr ',' '\n' | grep -vE '^(inline|me|self|you)?$' | sort -u || true)
  spawned=$(printf '%s' "$roles" | tr ',' '\n' | grep -vE '^$' | sort -u || true)
  if [ "$declared" = "$spawned" ]; then kept=MATCH; else kept=DRIFT; fi

  printf '%s\t%s\t%s\t%s/%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$(basename "$f" .jsonl)" "$children" "${roles:--}" "$todo_done" "$todo_n" \
    "$classify" "${routes:--}" "$kept" "${verdict:--}" "$writes"
}

printf 'run\tchildren\troles\ttodo\tclassify\trouting\tkept\tverdict\tp-writes\n'
for f in "$@"; do score_one "$f"; done

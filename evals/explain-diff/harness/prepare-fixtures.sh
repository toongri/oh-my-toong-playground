#!/usr/bin/env bash
# explain-diff eval fixture preparation.
#
#   prepare-fixtures.sh [<fixture-id> ...]
#
# Creates the detached-worktree fixtures that run.sh reads from
# $EVAL/fixtures/<id> (see run.sh for the same $EVAL resolution). With no
# arguments, prepares every fixture in manifest.json; with arguments,
# prepares only the named ones.
#
# Idempotent: a fixture whose worktree already exists and is valid is
# skipped, not recreated. This script only creates worktrees — it never
# removes one, even a stale or broken one; that is a separate concern.
set -euo pipefail

HARNESS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EVAL="${OMT_EVAL_ROOT:-$HOME/.omt/oh-my-toong-playground/explain-diff-eval}"
MANIFEST="$HARNESS/manifest.json"

if [ "$#" -gt 0 ]; then
  ids="$*"
else
  ids="$(bun -e '
    const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    process.stdout.write(m.fixtures.map((f) => f.id).join("\n"));
  ' "$MANIFEST")"
fi

mkdir -p "$EVAL/fixtures"

ok_ids=""
fail_ids=""

for id in $ids; do
  fields="$(bun -e '
    const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const f = m.fixtures.find((x) => x.id === process.argv[2]);
    if (!f) { process.exit(1); }
    process.stdout.write(f.source_repo + "\t" + f.sha);
  ' "$MANIFEST" "$id" 2>/dev/null)"
  if [ -z "$fields" ]; then
    echo "no such fixture in manifest: $id" >&2
    fail_ids="$fail_ids $id"
    continue
  fi

  source_repo="${fields%%$'\t'*}"
  sha="${fields#*$'\t'}"
  wt="$EVAL/fixtures/$id"

  if git -C "$wt" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "skip (already a valid worktree): $id"
    ok_ids="$ok_ids $id"
    continue
  fi

  echo "preparing: $id ($source_repo @ $sha)"
  if git -C "$source_repo" worktree add --detach "$wt" "$sha"; then
    ok_ids="$ok_ids $id"
  else
    echo "failed: $id" >&2
    fail_ids="$fail_ids $id"
  fi
done

echo
echo "ok:     ${ok_ids:-<none>}"
echo "failed: ${fail_ids:-<none>}"

if [ -n "$fail_ids" ]; then
  exit 1
fi

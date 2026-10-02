#!/usr/bin/env bash
# Runs the deployed qa skill headlessly on one algocare-home PR with codex
# (gpt-6-luna, reasoning effort max, no sandbox, hooks run without a trust prompt), so its run and report can be
# graded against evals/qa-green/criteria.md.
#
#   run.sh <pr-number> <run-label>            start a fresh run
#   run.sh <pr-number> <run-label> --resume "<answer>"
#                                             answer an await-user question and continue
#
# The PR is checked out detached at its merge commit in its own algocare-home
# worktree (~/repos/algocare-home/qa-green-<pr>), with the developer's root
# .env.local copied in. Everything else (install, local stack, seeds) is the qa
# skill's own bootstrap work, so it is graded rather than prepared here.
#
# Output: ~/.omt/qa-green/<pr>/<run-label>/{codex.jsonl,last-message.md,session-id}
# Run one or two PRs at a time; each may start emulators and a local stack.
set -euo pipefail

pr="${1:?usage: run.sh <pr-number> <run-label> [--resume <answer>]}"
label="${2:?usage: run.sh <pr-number> <run-label> [--resume <answer>]}"
resume_answer=""
if [ "${3:-}" = "--resume" ]; then
	resume_answer="${4:?--resume needs the answer text}"
fi

repo_root="$HOME/repos/algocare-home"
source_worktree="$repo_root/main"
worktree="$repo_root/qa-green-$pr"
run_dir="$HOME/.omt/qa-green/$pr/$label"
mkdir -p "$run_dir"

if [ ! -d "$worktree" ]; then
	merge_commit="$(gh pr view "$pr" --repo algo-care/algocare-home --json mergeCommit -q .mergeCommit.oid)"
	git -C "$source_worktree" fetch --quiet origin "$merge_commit"
	git -C "$source_worktree" worktree add --detach "$worktree" "$merge_commit"
	if [ -f "$source_worktree/.env.local" ]; then cp "$source_worktree/.env.local" "$worktree/.env.local"; fi
fi

codex_flags=(--skip-git-repo-check -m gpt-6-luna -c model_reasoning_effort=max --dangerously-bypass-approvals-and-sandbox --dangerously-bypass-hook-trust --json)

if [ -n "$resume_answer" ]; then
	session_id="$(cat "$run_dir/session-id")"
	printf '%s\n' "$resume_answer" |
		codex exec resume "${codex_flags[@]}" -o "$run_dir/last-message.md" "$session_id" - >>"$run_dir/codex.jsonl"
	exit 0
fi

prompt="\$qa https://github.com/algo-care/algocare-home/pull/$pr 를 QA해줘. 이 워크트리는 그 PR이 main에 merge된 커밋이야."
printf '%s\n' "$prompt" |
	codex exec "${codex_flags[@]}" -C "$worktree" -o "$run_dir/last-message.md" - >"$run_dir/codex.jsonl"
jq -r 'select(.type == "thread.started") | .thread_id' "$run_dir/codex.jsonl" | head -n 1 >"$run_dir/session-id"

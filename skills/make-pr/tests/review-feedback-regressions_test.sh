#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/../../.." && pwd)
SKILL_FILE="$ROOT_DIR/skills/make-pr/SKILL.md"
SCOPE_FILE="$ROOT_DIR/skills/make-pr/references/scope-assessment.md"

failures=0

run_case() {
  case_id=$1
  shift
  if "$@"; then
    printf 'ok - %s\n' "$case_id"
  else
    printf 'not ok - %s\n' "$case_id"
    failures=$((failures + 1))
  fi
}

concise_interview_contract() {
  for file in "$SKILL_FILE" "$ROOT_DIR/skills/make-pr/references/reference-tables.md"; do
    grep -Fq 'Ask one user decision at a time' "$file" \
      && grep -Fq 'Present detected target-branch evidence, then ask the user to confirm the target; never auto-select.' "$file" \
      && grep -Fq 'Only after target confirmation, re-check divergence.' "$file" \
      && grep -Fq 'If behind > 0, ask sync strategy before merge/rebase.' "$file" \
      && grep -Fq 'If behind = 0, do not ask a sync question.' "$file" \
      && grep -Fq 'Only if synchronization actually conflicts, obtain the conflict policy/decision before resolving.' "$file" \
      && grep -Fq 'File-by-file mode asks one file decision at a time.' "$file" \
      && grep -Fq 'Do not execute dependent actions before their required answer.' "$file" \
      && ! grep -Fq 'With 2 or more candidates' "$file" \
      && ! grep -Fq 'With exactly 1 candidate' "$file" \
      && ! grep -Fq 'Codex candidate-cardinality guard' "$file" \
      && ! grep -Fq 'late-divergence' "$file" \
      && ! grep -Fq 'ONE AskUserQuestion call' "$file" \
      && ! grep -Fq '2–3 explicit options' "$file" \
      && ! grep -Fq 'top 2-3 candidates' "$file" \
      && ! grep -Fq 'Codex batches are capped at 3 files per call' "$file" \
      && ! grep -Fq 'A later batch starts with the remaining files' "$file" \
      && ! grep -Fq 'settles target branch, sync strategy, and conflict policy in one question' "$file" \
      && ! grep -Fq 'collected in a single call' "$file" \
      && ! grep -Fq 'does not reach Step 0' "$file" \
      || return 1
  done
}

concise_interview_contract_rejects_first_file_violation() {
  temp_skill=$(mktemp)
  cleanup() {
    rm -f "$temp_skill"
  }
  trap cleanup RETURN
  cp "$SKILL_FILE" "$temp_skill" \
    && printf '%s\n' 'stale policy: 2–3 explicit options' >>"$temp_skill" \
    && if SKILL_FILE="$temp_skill" concise_interview_contract; then
      return 1
    fi
}

conflict_side_deletion_contract() {
  grep -Fq 'CONFLICT_FILE=<shell-word:file>' "$SKILL_FILE" \
    && grep -Fq 'git ls-files -u -- "$CONFLICT_FILE"' "$SKILL_FILE" \
    && grep -Fq 'Stage 2 is **ours** and stage 3 is **theirs**' "$SKILL_FILE" \
    && grep -Fq 'Read the present stage blobs (`git show ":2:$CONFLICT_FILE"` / `git show ":3:$CONFLICT_FILE"`)' "$SKILL_FILE" \
    && grep -Fq 'If the selected stage is absent, resolve the deletion with `git rm -- "$CONFLICT_FILE"`' "$SKILL_FILE" \
    && grep -Fq 'git checkout --$selected_side -- "$CONFLICT_FILE"' "$SKILL_FILE" \
    && grep -Fq 'git add -- "$CONFLICT_FILE"' "$SKILL_FILE" \
    && grep -Fq "'\$3 == stage { found=1 }" "$SKILL_FILE" \
    && ! grep -Fq "'\$1 == stage { found=1 }" "$SKILL_FILE" \
    && grep -Fq 'merge selects ours (stage 2), rebase selects theirs (stage 3)' "$SKILL_FILE" \
    && grep -Fq 'merge selects theirs (stage 3), rebase selects ours (stage 2)' "$SKILL_FILE" \
    && grep -Fq 'This stage inspection and missing-stage `git rm` rule also applies to file-by-file choices' "$SKILL_FILE" \
    && ! grep -Fq 'including a Phase 2 auto proposal' "$SKILL_FILE"
}

conflict_proposal_preservation() {
  grep -Fq 'Phase 2 proposals may be an explicit side selection, a deletion, or a synthesized/custom result' "$SKILL_FILE" \
    && grep -Fq 'Apply the Phase 2 proposal to every file' "$SKILL_FILE" \
    && grep -Fq 'For a synthesized/custom proposal, preserve the exact proposed content in the worktree' "$SKILL_FILE" \
    && grep -Fq 'git add -- "$CONFLICT_FILE"' "$SKILL_FILE" \
    && grep -Fq 'For a deletion proposal, resolve it with `git rm -- "$CONFLICT_FILE"`' "$SKILL_FILE" \
    && grep -Fq 'The stage checkout procedure below applies only to explicit current-branch/target-branch side choices' "$SKILL_FILE"
}

conflict_path_shell_word_safety() {
  grep -Fq 'CONFLICT_FILE=<shell-word:file>' "$SKILL_FILE" \
    && grep -Fq 'git ls-files -u -- "$CONFLICT_FILE"' "$SKILL_FILE" \
    && grep -Fq 'git show ":2:$CONFLICT_FILE"' "$SKILL_FILE" \
    && grep -Fq 'git show ":3:$CONFLICT_FILE"' "$SKILL_FILE" \
    && grep -Fq 'git rm -- "$CONFLICT_FILE"' "$SKILL_FILE" \
    && grep -Fq 'git checkout --$selected_side -- "$CONFLICT_FILE"' "$SKILL_FILE" \
    && grep -Fq 'git add -- "$CONFLICT_FILE"' "$SKILL_FILE" \
    && ! grep -Fq 'git ls-files -u -- "{file}"' "$SKILL_FILE" \
    && ! grep -Fq 'git rm -- "{file}"' "$SKILL_FILE" \
    && ! grep -Fq 'git checkout --$selected_side -- "{file}"' "$SKILL_FILE" \
    && ! grep -Fq 'git add -- "{file}"' "$SKILL_FILE" \
    && ! grep -Fq 'git show ":2:{file}"' "$SKILL_FILE" \
    && ! grep -Fq 'git show ":3:{file}"' "$SKILL_FILE" \
    && payloads=$(printf '%s\n' 'conflict $(touch${IFS}make-pr-conflict-sentinel) path' 'conflict `touch${IFS}make-pr-conflict-sentinel` path' "conflict'a path" 'conflict path with spaces') \
    && while IFS= read -r payload; do
      escaped=$(printf '%s' "$payload" | sed "s/'/'\\\\''/g")
      rendered="CONFLICT_FILE='$escaped'"
      temp_dir=$(mktemp -d)
      result=$(cd "$temp_dir" && eval "$rendered; printf '%s' \"\$CONFLICT_FILE\"")
      if [ "$result" != "$payload" ] || [ -e "$temp_dir/make-pr-conflict-sentinel" ]; then
        rm -f "$temp_dir/make-pr-conflict-sentinel"
        rmdir "$temp_dir"
        exit 1
      fi
      rmdir "$temp_dir"
    done <<EOF
$payloads
EOF
}

split_step8_target() {
  block=$(sed -n '/Split-only Step 8 command block/,/^```$/p' "$SKILL_FILE") \
    && grep -Fq 'Preserve an explicit branch → worktree mapping' "$SCOPE_FILE" \
    && printf '%s\n' "$block" | grep -Fq 'WT_DIR=<shell-word:mapped-worktree>' \
    && printf '%s\n' "$block" | grep -Fq 'git -C "$WT_DIR" fetch origin "$BASE_BRANCH"' \
    && printf '%s\n' "$block" | grep -Fq 'AHEAD=$(git -C "$WT_DIR" rev-list --count "origin/$BASE_BRANCH..$TARGET_SUB_BRANCH")' \
    && printf '%s\n' "$block" | grep -Fq 'TARGET_SUB_BRANCH=$(git -C "$WT_DIR" branch --show-current)' \
    && printf '%s\n' "$block" | grep -Fq 'git -C "$WT_DIR" push -u origin "$TARGET_SUB_BRANCH"' \
    && printf '%s\n' "$block" | grep -Fq 'gh pr create --base "$BASE_BRANCH" --head "$TARGET_SUB_BRANCH"' \
    && [ "$(printf '%s\n' "$block" | grep -Fc 'gh pr create --base "$BASE_BRANCH" --head "$TARGET_SUB_BRANCH"')" -eq 1 ] \
    && title_line=$(printf '%s\n' "$block" | grep -n -m1 -F 'TITLE=' | cut -d: -f1) \
    && create_line=$(printf '%s\n' "$block" | grep -n -m1 -F 'gh pr create --base "$BASE_BRANCH" --head "$TARGET_SUB_BRANCH"' | cut -d: -f1) \
    && [ "$title_line" -lt "$create_line" ] \
    && grep -Fq 'If the mapping is missing, stop and ask the user; never infer a worktree path.' "$SKILL_FILE" \
    && single=$(sed -n '/\*\*For single PR\*\*/,/^\*\*Sub-PR (Stacked split):\*\*/p' "$SKILL_FILE") \
    && printf '%s\n' "$single" | grep -Fq 'gh pr create --base {base-branch} --head $(git branch --show-current) --assignee @me'
}

split_step8_branch_mismatch_fails_closed() {
  block=$(sed -n '/Split-only Step 8 command block/,/^```$/p' "$SKILL_FILE") \
    && printf '%s\n' "$block" | grep -Fq 'EXPECTED_SUB_BRANCH=<shell-word:target-sub-branch>' \
    && printf '%s\n' "$block" | grep -Fq 'git check-ref-format --branch "$EXPECTED_SUB_BRANCH"' \
    && printf '%s\n' "$block" | grep -Fq 'TARGET_SUB_BRANCH=$(git -C "$WT_DIR" branch --show-current)' \
    && printf '%s\n' "$block" | grep -Fq 'git check-ref-format --branch "$TARGET_SUB_BRANCH"' \
    && printf '%s\n' "$block" | grep -Fq 'if [ "$TARGET_SUB_BRANCH" != "$EXPECTED_SUB_BRANCH" ]; then' \
    && printf '%s\n' "$block" | grep -Fq 'echo "Mapped worktree branch mismatch:' \
    && printf '%s\n' "$block" | grep -Fq 'exit 1' \
    && ! printf '%s\n' "$block" | grep -Fq 'REMOTE_TARGET=' \
    && ! printf '%s\n' "$block" | grep -Fq 'ls-remote' \
    && ! printf '%s\n' "$block" | grep -Fq 'git -C "$WT_DIR" branch -m "$EXPECTED_SUB_BRANCH"' \
    && expected_line=$(printf '%s\n' "$block" | grep -n -m1 -F 'git check-ref-format --branch "$EXPECTED_SUB_BRANCH"' | cut -d: -f1) \
    && actual_line=$(printf '%s\n' "$block" | grep -n -m1 -F 'TARGET_SUB_BRANCH=$(git -C "$WT_DIR" branch --show-current)' | cut -d: -f1) \
    && actual_check_line=$(printf '%s\n' "$block" | grep -n -m1 -F 'git check-ref-format --branch "$TARGET_SUB_BRANCH"' | cut -d: -f1) \
    && mismatch_line=$(printf '%s\n' "$block" | grep -n -m1 -F 'if [ "$TARGET_SUB_BRANCH" != "$EXPECTED_SUB_BRANCH" ]; then' | cut -d: -f1) \
    && fetch_line=$(printf '%s\n' "$block" | grep -n -m1 -F 'git -C "$WT_DIR" fetch origin "$BASE_BRANCH"' | cut -d: -f1) \
    && ahead_line=$(printf '%s\n' "$block" | grep -n -m1 -F 'AHEAD=$(git -C "$WT_DIR" rev-list --count "origin/$BASE_BRANCH..$TARGET_SUB_BRANCH")' | cut -d: -f1) \
    && push_line=$(printf '%s\n' "$block" | grep -n -m1 -F 'git -C "$WT_DIR" push -u origin "$TARGET_SUB_BRANCH"' | cut -d: -f1) \
    && create_line=$(printf '%s\n' "$block" | grep -n -m1 -F 'gh pr create --base "$BASE_BRANCH" --head "$TARGET_SUB_BRANCH"' | cut -d: -f1) \
    && [ "$expected_line" -lt "$actual_line" ] \
    && [ "$actual_line" -lt "$actual_check_line" ] \
    && [ "$actual_check_line" -lt "$mismatch_line" ] \
    && [ "$mismatch_line" -lt "$fetch_line" ] \
    && [ "$mismatch_line" -lt "$ahead_line" ] \
    && [ "$mismatch_line" -lt "$push_line" ] \
    && [ "$mismatch_line" -lt "$create_line" ]
}

split_command_failure_rollback() {
  block=$(sed -n '/### Failure Handling/,/^### Original Branch Preservation/p' "$SCOPE_FILE") \
    && printf '%s\n' "$block" | grep -Fq '`worktree add`' \
    && printf '%s\n' "$block" | grep -Fq '`cherry-pick`' \
    && printf '%s\n' "$block" | grep -Fq '`push`' \
    && printf '%s\n' "$block" | grep -Fq 'enter the same shared rollback path' \
    && printf '%s\n' "$block" | grep -Fq 'Track only worktrees and local branches successfully created during this run' \
    && printf '%s\n' "$block" | grep -Fq 'track only remote branches successfully pushed during this run' \
    && printf '%s\n' "$block" | grep -Fq 'A late worktree-add failure must roll back remote branches pushed by earlier iterations of this run' \
    && printf '%s\n' "$block" | grep -Fq 'Remove worktrees first, then delete' \
    && printf '%s\n' "$block" | grep -Fq 'git worktree remove --force "$TRACKED_WORKTREE_PATH"' \
    && printf '%s\n' "$block" | grep -Fq 'current-run rollback registry' \
    && printf '%s\n' "$block" | grep -Fq 'run `git -C "$WT_DIR" cherry-pick --abort` only when a cherry-pick is active' \
    && printf '%s\n' "$block" | grep -Fq 'confirmation before deleting any tracked remote branch' \
    && printf '%s\n' "$block" | grep -Fq 'Preserve pre-existing worktrees, local branches, and remote branches' \
    && printf '%s\n' "$block" | grep -Fq 'fall back to the single PR flow' \
    && printf '%s\n' "$block" | grep -Fq 'the preflight checks are not a sufficient guard'
}

remote_split_branch_preflight() {
  block=$(sed -n '/### Separation Steps/,/^### Worktree Lifetime/p' "$SCOPE_FILE") \
    && printf '%s\n' "$block" | grep -Fq 'Before creating any worktree, preflight every planned split branch' \
    && printf '%s\n' "$block" | grep -Fq 'git ls-remote --exit-code --heads origin "refs/heads/$PLANNED_BRANCH"' \
    && printf '%s\n' "$block" | grep -Fq 'require a different branch name' \
    && preflight_line=$(printf '%s\n' "$block" | grep -n -m1 -F 'Before creating any worktree, preflight every planned split branch' | cut -d: -f1) \
    && add_line=$(printf '%s\n' "$block" | grep -n -m1 -F 'git worktree add -b "$BRANCH_NAME"' | cut -d: -f1) \
    && [ "$preflight_line" -lt "$add_line" ]
}

split_branch_creation_is_create_only() {
  block=$(sed -n '/### Separation Steps/,/^### Worktree Lifetime/p' "$SCOPE_FILE") \
    && printf '%s\n' "$block" | grep -Fq 'git -C "$WT_DIR" push --force-with-lease="refs/heads/$BRANCH_NAME:"' \
    && ! printf '%s\n' "$block" | grep -Fq 'git -C "$WT_DIR" push -u origin "$BRANCH_NAME"'
}

split_branch_creation_race_preserves_competitor_tip() {
  temp_dir=$(mktemp -d)
  remote="$temp_dir/remote.git"
  producer="$temp_dir/producer"
  competitor="$temp_dir/competitor"
  cleanup() {
    rm -rf "$temp_dir"
  }

  git init --bare "$remote" >/dev/null 2>&1 \
    && git init "$producer" >/dev/null 2>&1 \
    && git -C "$producer" config user.email test@example.com \
    && git -C "$producer" config user.name test \
    && printf 'base\n' >"$producer/file" \
    && git -C "$producer" add file \
    && git -C "$producer" commit -m base >/dev/null 2>&1 \
    && git -C "$producer" branch -M main \
    && git -C "$producer" remote add origin "$remote" \
    && git -C "$producer" push -u origin main >/dev/null 2>&1 \
    && printf 'split\n' >>"$producer/file" \
    && git -C "$producer" commit -am split >/dev/null 2>&1 \
    && git clone "$remote" "$competitor" >/dev/null 2>&1 \
    && git -C "$competitor" config user.email test@example.com \
    && git -C "$competitor" config user.name test \
    && git -C "$competitor" branch -c main split-race \
    && git -C "$competitor" push origin split-race >/dev/null 2>&1

  if [ "$?" -ne 0 ]; then
    cleanup
    return 1
  fi

  set +e
  git -C "$producer" push --force-with-lease="refs/heads/split-race:" origin HEAD:refs/heads/split-race >/dev/null 2>&1
  push_status=$?
  set -e
  remote_tip=$(git --git-dir "$remote" rev-parse refs/heads/split-race 2>/dev/null)
  competitor_tip=$(git -C "$competitor" rev-parse refs/heads/split-race 2>/dev/null)
  cleanup
  [ "$push_status" -ne 0 ] && [ "$remote_tip" = "$competitor_tip" ]
}

split_partial_creation_finalization() {
  block=$(sed -n '/### Post-Creation Update/,/^## Graceful Degradation/p' "$SCOPE_FILE") \
    && printf '%s\n' "$block" | grep -Fq 'If the user declines a later `gh pr create` or that command fails' \
    && printf '%s\n' "$block" | grep -Fq 'stop before creating any later sub-PRs' \
    && printf '%s\n' "$block" | grep -Fq 'M > 0' \
    && printf '%s\n' "$block" | grep -Fq 'actual M created PRs' \
    && printf '%s\n' "$block" | grep -Fq 'remove every `#TBD`' \
    && printf '%s\n' "$block" | grep -Fq 'uncreated sibling' \
    && printf '%s\n' "$block" | grep -Fq 'Report which planned theses were not published' \
    && printf '%s\n' "$block" | grep -Fq 'When M = 0, do not edit any remote PR' \
    && printf '%s\n' "$block" | grep -Fq 'normal all-created update path remains unchanged'
}

retained_worktree_path_quoting() {
  block=$(sed -n '/### Worktree Lifetime/,/^### Merge Commit Handling/p' "$SCOPE_FILE") \
    && printf '%s\n' "$block" | grep -Fq 'git worktree remove "$WORKTREE_PATH"' \
    && printf '%s\n' "$block" | grep -Fq 'git -C "$DOWNSTREAM_WT" rebase "$UPSTREAM_BRANCH"' \
    && printf '%s\n' "$block" | grep -Fq 'git -C "$DOWNSTREAM_WT" push --force-with-lease' \
    && original=$(sed -n '/### Original Branch Preservation/,/^---$/p' "$SCOPE_FILE") \
    && printf '%s\n' "$original" | grep -Fq 'git worktree remove --force "$WORKTREE_PATH"' \
    && printf '%s\n' "$block" | grep -Fq 'WORKTREE_PATH=<shell-word:worktree-path>' \
    && printf '%s\n' "$original" | grep -Fq 'Iterate the recorded branch → worktree mapping' \
    && printf '%s\n' "$original" | grep -Fq 'LOCAL_BRANCH=<shell-word:local-branch>'
}

split_branch_shell_safety_contract() {
  skill_block=$(sed -n '/## Step 8: PR Creation/,$p' "$SKILL_FILE") \
    && scope_block=$(sed -n '/## Branch Separation Procedure/,$p' "$SCOPE_FILE") \
    && printf '%s\n' "$skill_block" | grep -Fq 'Never interpolate a raw branch/ref placeholder into shell source' \
    && printf '%s\n' "$scope_block" | grep -Fq 'Never interpolate a raw branch/ref placeholder into shell source' \
    && printf '%s\n' "$scope_block" | grep -Fq 'git check-ref-format --branch "$BRANCH_NAME"' \
    && printf '%s\n' "$scope_block" | grep -Fq 'git worktree add -b "$BRANCH_NAME" "$WT_DIR" "origin/$BASE_BRANCH"' \
    && printf '%s\n' "$scope_block" | grep -Fq 'git -C "$WT_DIR" cherry-pick "$COMMIT_HASH"' \
    && printf '%s\n' "$scope_block" | grep -Fq 'git -C "$WT_DIR" push --force-with-lease="refs/heads/$BRANCH_NAME:" -u origin "$BRANCH_NAME"' \
    && printf '%s\n' "$scope_block" | grep -Fq 'git -C "$DOWNSTREAM_WT" rebase "$UPSTREAM_BRANCH"' \
    && printf '%s\n' "$scope_block" | grep -Fq 'git push origin --delete "$REMOTE_BRANCH"' \
    && printf '%s\n' "$skill_block" | grep -Fq 'git -C "$WT_DIR" fetch origin "$BASE_BRANCH"' \
    && printf '%s\n' "$skill_block" | grep -Fq 'git -C "$WT_DIR" rev-list --count "origin/$BASE_BRANCH..$TARGET_SUB_BRANCH"' \
    && printf '%s\n' "$skill_block" | grep -Fq 'git -C "$WT_DIR" push -u origin "$TARGET_SUB_BRANCH"' \
    && printf '%s\n' "$skill_block" | grep -Fq 'gh pr create --base "$BASE_BRANCH" --head "$TARGET_SUB_BRANCH"' \
    && ! printf '%s\n' "$scope_block" | grep -Eq '^\s*[-a-z.]*(git|gh) .*\{(base-branch|branch-name|target-sub-branch|previous-split-branch|upstream-branch|tracked-local-branch|tracked-remote-branch)\}' \
    && ! printf '%s\n' "$scope_block" | grep -Eq '^[A-Z_]+="\{[^}]+\}"$' \
    && ! printf '%s\n' "$skill_block" | grep -Eq '^[A-Z_]+="\{[^}]+\}"$' \
    && ! printf '%s\n' "$skill_block" | grep -Eq 'git (fetch|rev-list|worktree|push|branch -m) [^\n]*\{(base-branch|target-sub-branch|branch-name)\}'
}

dynamic_shell_word_safety() {
  grep -Fq '<shell-word:branch-name>' "$SCOPE_FILE" || return 1
  payloads=$(printf '%s\n' 'feat;id' "feat'a;id" 'feat$(touch${IFS}make-pr-shell-word-sentinel)' 'feat${IFS}id' 'feat`touch${IFS}make-pr-shell-word-sentinel`')
  while IFS= read -r payload; do
    git check-ref-format --branch "$payload" >/dev/null || return 1
    escaped=$(printf '%s' "$payload" | sed "s/'/'\\\\''/g")
    rendered="BRANCH_NAME='$escaped'"
    temp_dir=$(mktemp -d)
    result=$(cd "$temp_dir" && eval "$rendered; printf '%s' \"\$BRANCH_NAME\"")
    if [ "$result" != "$payload" ] || [ -e "$temp_dir/make-pr-shell-word-sentinel" ]; then
      rm -f "$temp_dir/make-pr-shell-word-sentinel"
      rmdir "$temp_dir"
      return 1
    fi
    rmdir "$temp_dir"
  done <<EOF
$payloads
EOF
}

run_case concise-interview-contract concise_interview_contract
run_case concise-interview-contract-rejects-first-file-violation concise_interview_contract_rejects_first_file_violation
run_case conflict-side-deletion-contract conflict_side_deletion_contract
run_case conflict-proposal-preservation conflict_proposal_preservation
run_case conflict-path-shell-word-safety conflict_path_shell_word_safety
run_case split-step8-target split_step8_target
run_case split-step8-branch-mismatch-fails-closed split_step8_branch_mismatch_fails_closed
run_case split-command-failure-rollback split_command_failure_rollback
run_case remote-split-branch-preflight remote_split_branch_preflight
run_case split-branch-creation-is-create-only split_branch_creation_is_create_only
run_case split-branch-creation-race-preserves-competitor-tip split_branch_creation_race_preserves_competitor_tip
run_case split-partial-creation-finalization split_partial_creation_finalization
run_case retained-worktree-path-quoting retained_worktree_path_quoting
run_case split-branch-shell-safety-contract split_branch_shell_safety_contract
run_case dynamic-shell-word-safety dynamic_shell_word_safety

if [ "$failures" -gt 0 ]; then
  exit 1
fi

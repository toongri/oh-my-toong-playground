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

setup_option_limit() {
  grep -Fq 'On Codex, each structured setup question must offer **2–3 explicit options**' "$SKILL_FILE" \
    && grep -Fq 'the UI adds an automatic `Other` option' "$SKILL_FILE" \
    && grep -Fq 'on Codex, expose only those top 2-3 candidates and rely on the UI' "$SKILL_FILE" \
    && grep -Fq 'Codex: top 2-3 candidates only; the UI' "$SKILL_FILE" \
    && ! grep -Fq 'If more branches exist, include an "other" option.' "$SKILL_FILE" \
    && ! grep -Fq 'Top 2-3 candidates, each option' "$SKILL_FILE" \
    && grep -Fq '**파일별로 확인**, **현재 브랜치 우선**, and **타겟 브랜치 우선**' "$SKILL_FILE" \
    && grep -Fq '**제안대로 자동 해결** as the canonical `Other` input' "$SKILL_FILE"
}

late_divergence_policy() {
  block=$(sed -n '/late-divergence/,/^Only after that single call returns/p' "$SKILL_FILE") \
    && printf '%s\n' "$block" | grep -Fq 'AskUserQuestion({' \
    && printf '%s\n' "$block" | grep -Fq 'questions: [' \
    && printf '%s\n' "$block" | grep -Fq '{ id: "sync-strategy"' \
    && printf '%s\n' "$block" | grep -Fq '{ id: "conflict-policy"' \
    && printf '%s\n' "$block" | grep -Fq 'Only after that single call returns may the selected `{sync-strategy}` be executed' \
    && [ "$(printf '%s\n' "$block" | grep -Fc 'AskUserQuestion({')" -eq 1 ]
}

codex_conflict_batch() {
  grep -Fq 'Native-capable clients may ask about up to 4 files per call; Codex batches are capped at 3 files per call.' "$SKILL_FILE"
}

candidate_cardinality_rules() {
  grep -Fq 'With 2 or more candidates, use the structured target-branch question with the top 2-3 candidates' "$SKILL_FILE" \
    && grep -Fq 'With exactly 1 candidate, do not issue a one-option structured target-branch question' "$SKILL_FILE" \
    && grep -Fq 'obtain plain-text confirmation or a free-form target branch' "$SKILL_FILE" \
    && grep -Fq 'With 0 candidates, request the target branch as plain text' "$SKILL_FILE" \
    && grep -Fq 'Do not fabricate or duplicate candidates, and do not count the automatic `Other` option' "$SKILL_FILE" \
    && grep -Fq 'Keep any applicable sync-strategy and conflict-policy questions in the same structured setup call' "$SKILL_FILE" \
    && ! grep -Fq 'ask a structured question with one candidate plus `Other`' "$SKILL_FILE"
}

conflict_side_deletion_contract() {
  grep -Fq 'git ls-files -u -- {file}' "$SKILL_FILE" \
    && grep -Fq 'Stage 2 is **ours** and stage 3 is **theirs**' "$SKILL_FILE" \
    && grep -Fq 'If the selected stage is absent, resolve the deletion with `git rm -- {file}`' "$SKILL_FILE" \
    && grep -Fq 'git checkout --$selected_side -- {file}' "$SKILL_FILE" \
    && grep -Fq 'git add -- {file}' "$SKILL_FILE" \
    && grep -Fq "'\$3 == stage { found=1 }" "$SKILL_FILE" \
    && ! grep -Fq "'\$1 == stage { found=1 }" "$SKILL_FILE" \
    && grep -Fq 'merge selects ours (stage 2), rebase selects theirs (stage 3)' "$SKILL_FILE" \
    && grep -Fq 'merge selects theirs (stage 3), rebase selects ours (stage 2)' "$SKILL_FILE" \
    && grep -Fq 'This stage inspection and missing-stage `git rm` rule also applies to file-by-file choices' "$SKILL_FILE" \
    && grep -Fq 'including a Phase 2 auto proposal' "$SKILL_FILE"
}

split_step8_target() {
  block=$(sed -n '/Split-only Step 8 command block/,/^```$/p' "$SKILL_FILE") \
    && grep -Fq 'Preserve an explicit branch → worktree mapping' "$SCOPE_FILE" \
    && printf '%s\n' "$block" | grep -Fq 'WT_DIR="{mapped-worktree}"' \
    && printf '%s\n' "$block" | grep -Fq 'git -C "$WT_DIR" fetch origin {appropriate-base}' \
    && printf '%s\n' "$block" | grep -Fq 'AHEAD=$(git -C "$WT_DIR" rev-list --count origin/{appropriate-base}..{target-sub-branch})' \
    && printf '%s\n' "$block" | grep -Fq 'TARGET_SUB_BRANCH=$(git -C "$WT_DIR" branch --show-current)' \
    && printf '%s\n' "$block" | grep -Fq 'git -C "$WT_DIR" ls-remote --heads origin "$TARGET_SUB_BRANCH"' \
    && printf '%s\n' "$block" | grep -Fq 'git -C "$WT_DIR" branch -m {target-sub-branch}' \
    && printf '%s\n' "$block" | grep -Fq 'git -C "$WT_DIR" push -u origin {target-sub-branch}' \
    && printf '%s\n' "$block" | grep -Fq 'gh pr create --base {appropriate-base} --head {target-sub-branch}' \
    && [ "$(printf '%s\n' "$block" | grep -Fc 'gh pr create --base {appropriate-base} --head {target-sub-branch}')" -eq 1 ] \
    && title_line=$(printf '%s\n' "$block" | grep -n -m1 -F 'TITLE=' | cut -d: -f1) \
    && create_line=$(printf '%s\n' "$block" | grep -n -m1 -F 'gh pr create --base {appropriate-base} --head {target-sub-branch}' | cut -d: -f1) \
    && [ "$title_line" -lt "$create_line" ] \
    && grep -Fq 'If the mapping is missing, stop and ask the user; never infer a worktree path.' "$SKILL_FILE" \
    && single=$(sed -n '/\*\*For single PR\*\*/,/^\*\*Sub-PR (Stacked split):\*\*/p' "$SKILL_FILE") \
    && printf '%s\n' "$single" | grep -Fq 'gh pr create --base {base-branch} --head $(git branch --show-current) --assignee @me'
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
    && printf '%s\n' "$block" | grep -Fq 'run `git -C "$WT_DIR" cherry-pick --abort` only when a cherry-pick is active' \
    && printf '%s\n' "$block" | grep -Fq 'confirmation before deleting any tracked remote branch' \
    && printf '%s\n' "$block" | grep -Fq 'Preserve pre-existing worktrees, local branches, and remote branches' \
    && printf '%s\n' "$block" | grep -Fq 'fall back to the single PR flow' \
    && printf '%s\n' "$block" | grep -Fq 'the preflight checks are not a sufficient guard'
}

run_case setup-option-limit setup_option_limit
run_case late-divergence-policy late_divergence_policy
run_case codex-conflict-batch codex_conflict_batch
run_case candidate-cardinality-rules candidate_cardinality_rules
run_case conflict-side-deletion-contract conflict_side_deletion_contract
run_case split-step8-target split_step8_target
run_case split-command-failure-rollback split_command_failure_rollback

if [ "$failures" -gt 0 ]; then
  exit 1
fi

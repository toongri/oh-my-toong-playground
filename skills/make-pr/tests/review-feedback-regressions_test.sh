#!/usr/bin/env bash
set -u

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

run_case setup-option-limit setup_option_limit
run_case late-divergence-policy late_divergence_policy
run_case codex-conflict-batch codex_conflict_batch
run_case candidate-cardinality-rules candidate_cardinality_rules
run_case split-step8-target split_step8_target

if [ "$failures" -gt 0 ]; then
  exit 1
fi

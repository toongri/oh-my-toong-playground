---
name: design-review
description: Use for advisory design review — steelman antithesis and tradeoff tension analysis. Triggers include "design review", "plan review", "review the plan", "architectural soundness", "설계 검토", "플랜 리뷰", "아키텍처 건전성", "트레이드오프 분석".
---

# Design-Review

## Overview

Provides advisory design counsel — surfaces tradeoff tensions, steelman antitheses, and architectural considerations (analysis, not a verdict gate). Dispatches the review to a detached worker (configured members) and observes it by polling. This skill is finished only once you have pulled a definitive answer out of the job — nothing notifies you when the worker is done. If no worker is available (members empty, CLI not installed, timeout, error, or canceled), falls back to in-session analysis using the in-session fallback framework.

---

## Workflow

### Step 1: Determine analysis request

Identify what the caller needs reviewed. Synthesize the relevant context — design question, plan description, tradeoff concerns, code paths — into a clear request string.

### Step 2: Start the job

Write the analysis request to a temporary file and redirect to stdin:

```bash
PROMPT_FILE=$(mktemp)
cat > "$PROMPT_FILE" <<'EOF'
<your analysis request here>
EOF
JOB_DIR=$(bun ${CLAUDE_SKILL_DIR}/scripts/job.ts start --stdin < "$PROMPT_FILE")
rm -f "$PROMPT_FILE"
```

The command prints the `jobDir` path on stdout, captured into `$JOB_DIR` above.

If `start` exits non-zero or `$JOB_DIR` is empty, fall back to in-session analysis (READ `prompts/default.md`). Distinguish by cause: if stderr contains `to dispatch`, the no-members guard fired — enter the fallback silently (expected path when members config is empty or all filtered). For any other non-zero exit (disk/permission error, spawn failure, a bug), surface the failure reason (include the stderr line) in your output first, then proceed with the in-session fallback.

### Step 3: Collect results

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/job.ts collect $JOB_DIR
```

`collect` polls internally, but it returns after a fixed internal timeout that is deliberately shorter than the worker's full run budget. A non-`done` return (`running`, `queued`, or `awaiting_resume`) is therefore expected — it does NOT mean the job will finish on its own, and nothing will notify you when it does. Re-run `collect` in the foreground until it returns `done`, or go to Step 4 when the state is `awaiting_resume`. Do not end the turn while the overall state is non-terminal.

### Step 4: Resume and output

After `collect` returns, check the member's terminal state via:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/job.ts status $JOB_DIR
```

Collect results. If the member's answer is incomplete (still running, or a non-answer: plan/framing/waiting/partial), use `resume-member` to drive it to a complete answer (cap: 3 attempts). If the member outright fails (`missing_cli`, `error`, `timed_out`, `canceled`, `non_retryable`) or the resume cap is exhausted without a complete answer, fall back to in-session analysis per the trigger logic above. Once everything is finished, run `clean`.

**Output present** (member state is `done` with substantive analysis): read the member's output path from the manifest and forward that content to the caller.

### Step 5: Cleanup

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/job.ts clean $JOB_DIR
```

`clean` deletes the job dir (needed by `resume-member`), so it is the last step — only after everything is complete.

---

## Completion Contract

The skill produces an answer only by reading it out of the job, and the job is poll-only: a detached worker writes to the jobDir, and nothing notifies you when it finishes. "Let it run and come back" has no mechanism behind it. Get a definitive answer out of the job, then finish — not before.

You are done only when BOTH hold:
1. The member reached a terminal, answered state — `done` with substantive analysis, in-session fallback completed, or the resume cap (3) exhausted.
2. You hold that content and have forwarded it to the caller.

| Red flag (about to fail) | Reality |
|--------------------------|---------|
| "`collect` returned `running`, it's working in the background" | Non-`done` means poll again now. There is no background monitor. |
| "I'll report once it finishes" | Nothing will wake you. Loop `collect` to terminal in this turn. |
| "It's `awaiting_resume`, close enough to done" | Recoverable — `resume-member` it (Step 4). Do not stop. |
| "I forwarded the plan it produced" | A plan or framing is not analysis. Drive it to a real answer or fall back in-session. |

---

## Reference Files

- `design-review.config.yaml`: Job configuration — `members` list (each entry needs `name` and `command`) and `settings.timeout` (seconds)
- `scripts/job.ts`: Job manager (start/collect/clean/status/results/stop)
- `prompts/default.md`: in-session analysis framework — loaded only during fallback

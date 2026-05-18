---
name: diagnose
description: Use when asked to analyze architecture, debug issues, identify root cause, or provide technical recommendations. Triggers include "analyze", "diagnose", "debug", "root cause", "what's wrong", "architecture review", "investigate", "아키텍처 분석", "디버깅", "원인 분석", "뭐가 문제", "조사해".
---

# Diagnose

## Overview

Delegates architecture analysis and debugging to the Hephaestus opencode agent via a background job. If the agent is unavailable (CLI not installed, timeout, error, or canceled), falls back to in-session analysis using the Hephaestus framework.

---

## Workflow

### Step 1: Determine analysis request

Identify what the caller needs analyzed. Synthesize the relevant context — architecture question, bug description, error output, code paths — into a clear request string.

### Step 2: Start the job

Write the analysis request to a temporary file and redirect to stdin:

```bash
PROMPT_FILE=$(mktemp)
cat > "$PROMPT_FILE" <<'EOF'
<your analysis request here>
EOF
JOB_DIR=$(bun .claude/skills/diagnose/scripts/job.ts start --stdin < "$PROMPT_FILE")
rm -f "$PROMPT_FILE"
```

The command prints the `jobDir` path on stdout, captured into `$JOB_DIR` above.

### Step 3: Collect results

```bash
bun .claude/skills/diagnose/scripts/job.ts collect $JOB_DIR
```

`collect` polls until the job reaches a terminal state and returns a JSON manifest. Repeat if the overall state is `running` or `queued`.

### Step 4: Fallback branch

Determine the terminal worker state by running:

```bash
bun .claude/skills/diagnose/scripts/job.ts status $JOB_DIR
```

`status` returns `{ members: [{member, state, ...}] }`. Branch on `members[0].state`:

| `members[0].state` | Action |
|----------------------|--------|
| `missing_cli` | Fallback: become Hephaestus in-session (see below) |
| `timed_out` | Fallback: become Hephaestus in-session (see below) |
| `error` | Fallback: become Hephaestus in-session (see below) |
| `canceled` | Fallback: become Hephaestus in-session (see below) |
| `non_retryable` | Fallback: become Hephaestus in-session (see below) |
| `done` | Read the manifest from Step 3 and forward `reviewers[0].outputFilePath` content to the caller |

**Fallback procedure**: READ `prompts/hephaestus.md` and apply the analysis framework defined there IN-SESSION. You become Hephaestus for the remainder of this skill invocation.

### Step 5: Cleanup

```bash
bun .claude/skills/diagnose/scripts/job.ts clean $JOB_DIR
```

Run cleanup unconditionally after forwarding results or completing in-session fallback analysis.

---

## Reference Files

- `diagnose.config.yaml`: Single-member config (hephaestus, opencode, 600s timeout)
- `scripts/job.ts`: Job manager (start/collect/clean/status/results/stop)
- `prompts/hephaestus.md`: Hephaestus analysis framework — loaded only during fallback

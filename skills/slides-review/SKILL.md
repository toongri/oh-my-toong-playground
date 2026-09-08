---
name: slides-review
description: HTML design review skill using the Gemini CLI. Sends generated HTML files to Gemini for visual design improvement directives and edits CSS/HTML in the main session. Uses in-session fallback when Gemini is unavailable. Triggers: "디자인 리뷰", "gemini review", "design review", "디자인 검토", "디자인 보완", "slides review", "슬라이드 리뷰".
---

# Slides Review

## Overview

This skill reviews the visual design quality of HTML files using the Gemini CLI and directly applies the returned improvement directives in the main session.
It can be invoked as a post-processing step by another skill (e.g., `create-slides`) or directly by the user.
If agents (Gemini CLI) are unavailable or all fail, perform the review directly through in-session fallback.

**Core principle**: If the gemini CLI is unavailable (`missing_cli`, etc.), perform the review directly through in-session fallback instead of doing nothing. A true quiet pass applies only when the target HTML file path is invalid.

---

## Input

This skill needs the following information:

| Parameter | Required | Description |
|---------|------|------|
| HTML file path | Yes | Absolute path to the HTML file to review |
| Design path | No | Design style used (e.g., "frontend-design", "자체 심플", "직접 제공"). Gives Gemini context to guide the review toward the design direction |
| Protection rules | No | Items the caller specifies must not be modified (e.g., scroll-snap, a specific font) |

**Invocation patterns:**

- **Invoked by another skill**: The caller passes the file path and protection rules as context
- **Invoked directly by the user**: Identify the HTML file path from the conversation or confirm with AskUserQuestion

---

## Workflow

### Step 1: Check the HTML File

Check the path of the HTML file to review.
- When invoked by another skill: Use the path supplied by the caller
- When invoked directly by the user: Identify it from conversation context or confirm with AskUserQuestion

### Step 2: Start the Review Job

**CRITICAL**: Set `timeout: 180000` on every Bash call.

Write a prompt file and start the job:

```bash
PROMPT_FILE=$(mktemp)
cat > "$PROMPT_FILE" << 'PROMPT_EOF'
[Include the entire HTML file contents here]

Design path used: {design-path}
PROMPT_EOF
JOB_DIR=$(bun "${CLAUDE_SKILL_DIR}/scripts/job.ts" start --stdin < "$PROMPT_FILE")
```

- Read the entire HTML file with the Read tool and include it in the prompt file
- Omit the `Design path used:` line if there is no design path
- JOB_DIR is printed to stdout

**In-session fallback when `start` fails**: If `start` exits non-zero or `$JOB_DIR` is empty, skip Steps 3–5 (no collect/clean), READ `prompts/default.md`, adopt its persona, and perform an HTML design review in-session. If stderr contains `to dispatch` (zero members — an expected path), enter fallback quietly. For other non-zero exits (unexpected failures such as disk/permission errors or spawn failures), print the failure reason (one line of stderr) before performing in-session fallback.

### Step 3: Collect Results

```bash
bun "${CLAUDE_SKILL_DIR}/scripts/job.ts" collect "$JOB_DIR"
```

- `"overallState": "done"` → Proceed to Step 4
- `"running"` / `"queued"` → Call `collect` again (same command)
- Member state is `missing_cli` / `error` / `timed_out` / `canceled` / `non_retryable` → **In-session fallback** (see below). Do not finish as "unavailable".
- Member state is `awaiting_resume` or the content is a non-answer (plan/framing/waiting pattern) → Use `resume-member` to obtain a complete answer (up to 3 times). On cap exhaustion or failure, use **in-session fallback**.

**When entering in-session fallback**: READ `prompts/default.md`, adopt its persona, and perform an HTML design review in-session. Do not run `clean` before fallback — `clean` is the final step after all processing is complete.

### Step 4: Apply Directives

Read gemini's `outputFilePath` from the collect result's manifest using the Read tool.

Apply the improvement directives returned by Gemini to the CSS/HTML **exactly as provided**, using the Edit tool.

**Application principles:**
- Apply Gemini's directives as written. Claude must not filter directives or make additional adjustments based on its own judgment.
- Find each directive's Target (selector) in the HTML and apply the exact values specified in Fix.
- Do not make arbitrary additional improvements absent from the directives.

**Caller protection rules are the only exception:**
If the caller supplied protection rules, exclude only directives that **directly** violate those rules.

### Step 5: Clean Up and Report

```bash
bun "${CLAUDE_SKILL_DIR}/scripts/job.ts" clean "$JOB_DIR"
```

**Caution**: `clean` is the final step after all processing is complete. Also call `clean` to remove temporary files when exiting through a quiet pass.

After applying the directives, give the user a brief summary:

```
Gemini 디자인 리뷰 반영: {applied item count}/{total directive count}건 적용
- {one-line summary of applied items}
...
```

Print nothing for a quiet pass.

---

## Quiet Pass Conditions

Skip quietly without an error in the following case:

| Condition | Action |
|------|------|
| HTML file path is invalid | Exit immediately, no message |

## In-Session Fallback Conditions

Read `prompts/default.md` and perform an in-session review in the following cases:

| Condition | Action |
|------|------|
| `start` exits abnormally / `$JOB_DIR` empty (no members) | Skip Steps 3–5, enter in-session fallback immediately (no clean) |
| `gemini` CLI not installed (`missing_cli` state) | Perform in-session fallback, then `clean` |
| Gemini call times out (`timed_out` state) | Perform in-session fallback, then `clean` |
| Gemini call errors (`error` state) | Perform in-session fallback, then `clean` |
| `awaiting_resume` — resume cap exhausted or all members fail | Perform in-session fallback, then `clean` |

---

## Anti-Patterns

- Claude must not filter Gemini directives or make additional adjustments based on its own judgment -- apply all except those violating protection rules
- Do not replace the entire `<style>` block at once -- Edit individual CSS properties
- Do not suggest that the user install Gemini
- Do not treat a review failure as an error -- this skill always exits with "success"

---

## Reference Files

- `review.config.yaml`: Gemini reviewer configuration (command, model, timeout)
- `scripts/job.ts`: Job manager (start/collect/clean). Thin wrapper around the generic-job.ts framework.
- `scripts/worker.ts`: Gemini CLI worker. Based on worker-utils.ts.
- `prompts/gemini.md`: Design review system prompt sent to Gemini. Defines six review criteria, output format (Target/Issue/Fix), and constraints.
- `prompts/default.md`: In-session fallback persona prompt — loaded during in-session fallback when agents are unavailable. The same six review criteria + instructions to apply changes directly with Edit.

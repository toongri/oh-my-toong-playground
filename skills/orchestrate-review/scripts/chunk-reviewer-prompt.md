# Chunk Review Data

> This template provides the review data (scope, diff command, context) interpolated into each angle finder's prompt. The per-angle review instructions live in scripts/prompts/<angle>.md.

## Review Premises (non-negotiable)

1. **The working directory reflects the post-change state of the target ref.** The reviewed code is the working directory; use Read/Grep/Glob freely against the actual files — the diff is the delta, the working directory is the result.

2. **Diff-only review is insufficient.** A diff is a delta. The unit of review is the *system the diff produces*. You MUST trace dependencies, callers, callees, interfaces, configurations, and runtime context across files before assessing any change. If you cannot explain how the changed code behaves end-to-end against the surrounding system, you have not reviewed it.

These premises override any reflex to "review just what is in the diff."

## Review Scope

**Findings target ONLY these files:** {FILE_LIST}

Findings must be limited to files in the list above. Cross-references and exploration into surrounding files are not just acceptable — they are required (per Premise 2). Files outside the list are reference material that you read to understand the change; you do not file findings against them.

## What Was Implemented

**{WHAT_WAS_IMPLEMENTED}**

{DESCRIPTION}

## Requirements/Plan

{REQUIREMENTS}

## Project Context

{PROJECT_CONTEXT}

This describes what kind of software is being reviewed. Finders must factor this into whether a candidate's failure scenario is actually reachable in this kind of system.

## Non-Goals

{NON_GOAL}

Each declared non-goal has the form `- {what this change deliberately does not do} | decider: {how to recognize a candidate finding that falls inside this non-goal}`. Finders must not generate a candidate finding whose failure scenario is fully explained by a declared non-goal — this is suppression at generation time, not a filter applied after generating the candidate.

## Evidence Results

{EVIDENCE_RESULTS}

If evidence results are provided above, they are from automated build/test/lint execution — treat them as verified facts. Do NOT re-evaluate pass/fail status. Use this information to assess test quality and coverage, not test correctness. If evidence is unavailable, skip evidence-based checks.

## Diff Command

**Files in this chunk:** {FILE_LIST}

Execute the following command to obtain the diff for review. You MUST run this command and use the output as the basis for your review:

```
{DIFF_COMMAND}
```

## Commit History

{COMMIT_HISTORY}

---

## Field Reference

| Field | Required | Source |
|-------|----------|--------|
| {WHAT_WAS_IMPLEMENTED} | Required | Step 0 interview or auto-extracted |
| {DESCRIPTION} | Required | Step 0 interview or commit messages |
| {REQUIREMENTS} | Optional | Step 0 interview, "N/A" if deferred |
| {PROJECT_CONTEXT} | Required | Step 0 project context |
| {NON_GOAL} | Required | Completion-gate payload field `non_goals` (backfilled to "(none provided)" when blank) |
| {EVIDENCE_RESULTS} | Optional | Step 3 Evidence Verification (may be 'unavailable' message) |
| {FILE_LIST} | Required | Step 2 git diff --name-only |
| {DIFF_COMMAND} | Required | Step 4 — constructed from range + chunk file list |
| {COMMIT_HISTORY} | Required | Step 2 git log output |

# Chunk Review Data

> This template provides data for the chunk-review multi-model dispatch. Review instructions are in prompts/reviewer.md.

## What Was Implemented

**{WHAT_WAS_IMPLEMENTED}**

{DESCRIPTION}

## Requirements/Plan

{REQUIREMENTS}

## Project Profile

{PROJECT_PROFILE}

This profile describes the project's characteristics. Use it to calibrate the Probability axis when assessing severity — see reviewer instructions for details.

## Diff Command

**Files in this chunk:** {FILE_LIST}

Execute the following command to obtain the diff for review. You MUST run this command and use the output as the basis for your review:

```
{DIFF_COMMAND}
```

## Project Guidelines

{CLAUDE_MD}

## Commit History

{COMMIT_HISTORY}

---

## Field Reference

| Field | Required | Source |
|-------|----------|--------|
| {WHAT_WAS_IMPLEMENTED} | Required | Step 0 interview or auto-extracted |
| {DESCRIPTION} | Required | Step 0 interview or commit messages |
| {REQUIREMENTS} | Optional | Step 0 interview, "N/A" if deferred |
| {PROJECT_PROFILE} | Required | Step 0 project profile collection |
| {FILE_LIST} | Required | Step 2 git diff --name-only |
| {DIFF_COMMAND} | Required | Step 4 — constructed from range + chunk file list |
| {CLAUDE_MD} | Optional | Step 2 CLAUDE.md collection |
| {COMMIT_HISTORY} | Required | Step 2 git log output |

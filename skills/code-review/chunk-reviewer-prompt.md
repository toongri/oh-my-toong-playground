# Chunk Review Data

> This template provides data for the chunk-review multi-model dispatch. Review instructions are in prompts/reviewer.md.

## What Was Implemented

**{WHAT_WAS_IMPLEMENTED}**

{DESCRIPTION}

## Requirements/Plan

{REQUIREMENTS}

## Codebase Context

{CODEBASE_CONTEXT}

## Diff Command

**Files in this chunk:** {FILE_LIST}

Run the following command to obtain the diff for this chunk:

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
| {CODEBASE_CONTEXT} | Optional | Step 2 explore/oracle output |
| {FILE_LIST} | Required | Step 2 git diff --name-only |
| {DIFF_COMMAND} | Required | Step 4 — constructed from range + chunk file list |
| {CLAUDE_MD} | Optional | Step 2 CLAUDE.md collection |
| {COMMIT_HISTORY} | Required | Step 2 git log output |

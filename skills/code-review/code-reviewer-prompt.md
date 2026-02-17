# Code Review Request

You are reviewing code changes for production readiness.

**Your task:**
1. Review {WHAT_WAS_IMPLEMENTED}
2. Compare against {REQUIREMENTS}
3. Evaluate against all 5 checklist categories
4. Categorize issues by severity
5. Assess production readiness

## What Was Implemented

{DESCRIPTION}

## Requirements/Plan

{REQUIREMENTS}

## Codebase Context

{CODEBASE_CONTEXT}

## Diff to Review

**Files in this chunk:** {FILE_LIST}

{DIFF}

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
| {DIFF} | Required | Step 1 git diff output |
| {CLAUDE_MD} | Optional | Step 2 CLAUDE.md collection |
| {COMMIT_HISTORY} | Required | Step 2 git log output |

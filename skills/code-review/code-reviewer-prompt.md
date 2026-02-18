# Code Review Request

You are reviewing code changes for production readiness.

**Your task:**
1. Produce Chunk Analysis (파일별 변경 분석: 역할, 변경 내용, 데이터 흐름, 설계 결정, 부수 효과)
2. Review {WHAT_WAS_IMPLEMENTED}
3. Compare against {REQUIREMENTS}
4. Evaluate against all 5 checklist categories
5. Categorize issues by severity
6. Assess production readiness

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

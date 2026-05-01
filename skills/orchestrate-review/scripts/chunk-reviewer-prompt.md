# Chunk Review Data

> This template provides data for the chunk-review multi-model dispatch. Review instructions are in prompts/reviewer.md.

## Review Premises (non-negotiable)

1. **You are running inside a git worktree with the PR/target branch checked out.** The working directory reflects the post-change state of the code under review. Use Read/Grep/Glob freely against the actual files — the diff is the delta, the working directory is the result.

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

This describes what kind of software is being reviewed. Reviewers must factor this into impact and probability assessments.

## Evidence Results

{EVIDENCE_RESULTS}

If evidence results are provided above, they are from automated build/test/lint execution — treat them as verified facts. Do NOT re-evaluate pass/fail status. Use this information to assess test quality and coverage, not test correctness. If evidence is unavailable, skip evidence-based checks.

## Diff Command

**Files in this chunk:** {FILE_LIST}

Execute the following command to obtain the diff for review. You MUST run this command and use the output as the basis for your review:

```
{DIFF_COMMAND}
```

## Severity Augmentation

This project applies two augmentations to the standard P0-P3 rubric. Apply these ON TOP of the built-in severity definitions in your system prompt — these augmentations OVERRIDE the built-in rubric where they conflict.

### Masking Carve-out (NOT P1)

A fallback or alternate path is NOT a masking pattern when ALL of the following hold:

1. **Scoped** to a known external/version boundary (e.g., `bun` version difference, `gh` API change, OS-specific path, third-party library breaking change).
2. **Documented** in a code comment that names the specific external defect, version constraint, or boundary it works around.
3. **Tested** on both primary and fallback paths.
4. **Preserves** failure evidence — the original error is still logged or reported, not swallowed or downgraded.
5. **Does not replace** fixing a primary contract that the project itself controls.

If any of (1)–(5) is missing, the pattern is a masking pattern → P1.

### Project-Rule Violations (also P1, even without masking)

The five enumerated rules below are P1 by definition — each rule declares the named pattern unwanted. This section is self-contained: project-rule-based P1 entries must cite a specific rule (1–5) listed here.

The following violations are P1 (this list is the *source of truth* — closed enumeration; do not silently re-classify):

1. **Speculative addition** — feature, abstraction, configuration, or option that was not requested by the user, spec, or issue.
2. **Single-use abstraction** — wrapper class, helper function, or interface introduced for a code path that has exactly one caller.
3. **Unrequested flexibility** — config option, environment variable, or branching logic added to support hypothetical future scenarios.
4. **Impossible-scenario error handling** — guard, validation, or fallback for a state that cannot occur given the surrounding contract (e.g., null-check on a value just constructed by `new`).
5. **Backwards-compatibility shim without removal date** — fallback for an old format/API that has no documented removal target. Either set a removal date or remove the old path now.

For each P1 issue under this section, the reviewer must cite the specific rule (1–5) and quote the violating code.

**Closed list discipline**: this enumeration is closed. Reviewers cannot create new P1-from-rule entries from un-enumerated reasoning. New rules require explicit addition to this list.

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
| {PROJECT_CONTEXT} | Required | Step 0 project context |
| {EVIDENCE_RESULTS} | Optional | Step 3 Evidence Verification (may be 'unavailable' message) |
| {FILE_LIST} | Required | Step 2 git diff --name-only |
| {DIFF_COMMAND} | Required | Step 4 — constructed from range + chunk file list |
| {CLAUDE_MD} | Optional | Step 2 CLAUDE.md collection |
| {COMMIT_HISTORY} | Required | Step 2 git log output |

---
name: code-review
description: Use after code changes to maintain project stability and quality - runs build/test/lint and evaluates code quality.
---

<Role>

# Code Review

## Overview

Code review agent. Ensures project stability and quality after code changes.

**Core Principle:** Build passes, tests pass, code quality maintained.

</Role>

## Two-Stage Mandatory Review

```dot
digraph review_stages {
    rankdir=TB;

    start [label="Start Review" shape=ellipse];
    diff [label="Identify changes via git diff"];
    stage0 [label="Stage 0: Automated Verification" shape=box style=filled fillcolor=lightyellow];
    verify_pass [label="All pass?" shape=diamond];
    stage1 [label="Stage 1: Code Quality" shape=box style=filled fillcolor=lightgreen];
    quality_pass [label="Quality pass?" shape=diamond];
    approve [label="APPROVE" shape=ellipse style=filled fillcolor=green fontcolor=white];
    fix [label="FIX -> RE-REVIEW" shape=box style=filled fillcolor=red fontcolor=white];

    start -> diff -> stage0 -> verify_pass;
    verify_pass -> fix [label="NO"];
    verify_pass -> stage1 [label="YES"];
    fix -> stage0 [style=dashed];
    stage1 -> quality_pass;
    quality_pass -> fix [label="NO"];
    quality_pass -> approve [label="YES"];
}
```

### Fast-Path Exception

Single-line edits, obvious typos, or changes with no functional behavior modification skip Stage 0, receiving only a brief Stage 1 quality check.

---

## Stage 0: Automated Verification (MANDATORY FIRST)

**Before ANY code analysis, run automated checks.**

1. Discover project commands (check memory file, then documentation, then build files)
2. Run: Build -> Tests -> Lint
3. ANY failure = immediate REQUEST_CHANGES

**See** [stage0-commands.md] **for details** on command discovery, special cases, and output format.

---

## Stage 1: Code Quality (After Stage 0 Passes)

Review code against quality checklists by severity level.

**See** [checklists.md] **for details** on Security, Data Integrity, Architecture, Performance, Maintainability, and YAGNI checks.

### Signal Quality

**Only Flag If:**
- Code will **fail to compile/parse**
- Code will **definitely produce wrong results**
- **Clear** violation of documented architecture/design principles

**Never Flag:**
- Pre-existing issues (not introduced by this change)
- Linter-catchable problems (let tools handle these)
- Style preferences without documented standard
- Code not touched by this change
- "Could be better" without concrete problem

**When Uncertain:** Do NOT flag. False positives erode trust faster than missed issues.

---

## Severity Classification

| Level | Nature | Response |
|-------|--------|----------|
| **CRITICAL** | Security/data-loss risk | Must resolve before merge |
| **HIGH** | Architecture/design violation | Should resolve before merge |
| **MEDIUM** | Performance/maintainability | Address when feasible |
| **LOW** | Style/suggestions | Optional consideration |

---

## Feedback Requirements

Every issue MUST include confidence scoring and use the rich feedback format.

**See** [feedback-protocol.md] **for details** on confidence scoring, rich feedback protocol, validation, and conventional comments.

---

<Output_Format>

## Output Format

```markdown
## Stage 0: Automated Verification
| Check | Status | Details |
|-------|--------|---------|
| Build | PASS / FAIL | [output summary] |
| Tests | PASS (N/N) / FAIL (N/M) | [failed test names] |
| Lint | PASS / FAIL | [error count] |

**Stage 0 Result:** PASS / FAIL
[If FAIL: Stop here, issue REQUEST_CHANGES]

---

## Stage 1: Code Quality

## Summary
| Metric | Count | Reported (>=80) |
|--------|-------|-----------------|
| Critical | N | N |
| High | N | N |
| Medium | N | N |
| Low | N | N |
| Filtered (<80) | N | - |
| Praise | N | N |

## Critical Issues
[Rich Feedback format - see feedback-protocol.md]

## High Priority
[Rich Feedback format]

## Medium Priority
[suggestion label]

## Low Priority
[nitpick (non-blocking)]

## Good Practices
[praise: ... for each - REQUIRED section]

## Verdict
[APPROVE / REQUEST_CHANGES / COMMENT]
```

</Output_Format>

---

## Approval Decision

| Condition | Verdict |
|-----------|---------|
| CRITICAL or HIGH found | **REQUEST_CHANGES** |
| MEDIUM only | **COMMENT** (conditional merge approval) |
| LOW only or no issues | **APPROVE** |

---

## Red Flags - STOP

| Excuse | Reality |
|--------|---------|
| "Security is another team's concern" | Every developer owns security |
| "Architecture can be fixed later" | Violations spread and compound |
| "It works, so it's fine" | Working != maintainable |
| "Tests will catch it" | Catching at review is cheapest |
| "Not sure but flag anyway" | False positives erode trust |
| "No time for praise" | Balance builds collaborative culture |

---

## Quick Reference

```
Stage 0: Automated Verification (Build, Test, Lint) -> Stage 1: Code Quality

STAGE 0: See stage0-commands.md
CONFIDENCE: 0-49 discard, 50-79 nitpick, 80+ report
FEEDBACK: What + Why + How (2+ options) + Benefit
SEVERITY: CRITICAL (security) > HIGH (arch) > MEDIUM (perf) > LOW (style)
YAGNI: New code with 0 callers = flag
```

**Tone check:** Replace commands with questions.
- "Should be X" -> "What about X?"
- "Wrong" -> "question: Is this intentional?"

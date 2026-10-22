---
name: compacting-skills
description: Use when a skill, agent prompt, or rules document has grown long, repetitive, or self-contradicting and must get shorter without changing the behavior it produces, or when an already-compressed doc must be checked for lost rules before merge.
---

# Compacting Skills

## Overview

The current doc is the specification. Compression may remove only what you can show the agent will still do without it. Size is the outcome, never the goal: the deliverable is the same behavior from fewer words, with evidence.

Three kinds of evidence are required, because each misses what the others catch:

| Evidence | Catches | Misses |
|---|---|---|
| Rule inventory + trace table | a rule that vanished | a rule that changed scope; behavior |
| Scenario measurement (before/after, 5 reps) | behavior drift on asked questions | gaps between sentences; unasked cases |
| Compression regression audit | widened/narrowed rules, deleted premises, doc/code mismatch | nothing alone proves behavior |

A pilot compression scored 0.997 on its scenarios (baseline 0.960) and still carried 10 regressions that only the audit found, plus one more an external reviewer found. Never stop at the score.

**REQUIRED BACKGROUND:** writing-skills (scenario testing with subagents).

## What stays, what goes

Keep a rule (MUST) when at least one holds, and record which:
1. **Contract:** code, a validator, a test, or another skill/agent reads it (field names, enums, command arguments, headings, output shape).
2. **Safety:** data loss, path injection, running untrusted code, user worktree protection.
3. **Core guarantee** of this skill (what it promises its caller).
4. **Real failure:** a commit, review, or incident shows the rule was added to stop a failure.
5. **Repo-specific meaning** an agent cannot infer (what a term or state means here).

Everything else (procedure narration, tips, examples, case lists, generic good habits) is JUDGMENT: delete it or keep one principle line. The user's standing preference decides close calls: leave it to AI judgment unless it must be prescribed.

Compression moves, in order of preference:
- A list of cases → the one rule that generates them.
- A rule stated in several places → one place; elsewhere, point to it.
- Behavior a script enforces → the command plus its refusal condition (the agent still has to know what to run and what a refusal means).
- Heavy detail used rarely → a reference file next to SKILL.md, with an explicit pointer.

Never change scripts, hooks, or validators as part of compression. When the doc and code disagree, make the doc match the code and list the code defect as a follow-up.

## Process

Keep a plan file with one checkbox per step and append one progress line (date, result, evidence path) as each closes. Store evidence in one directory per target: `rules/`, `pins/`, `scenarios-*.md`, `runs/`, `old-doc/` (frozen copy + `COMMIT`), `trace/`, `regression.md`, `audit.md`, `summary.md`.

| # | Step | Gate to pass |
|---|---|---|
| 1 | Worktree from the default branch; run the target's tests | Clean tree; baseline pass count recorded |
| 2 | Rule inventory → `references/rule-inventory.md` | Every normative sentence has exactly one id and a class with evidence |
| 3 | Doc conflicts → user | Every internal contradiction resolved by the user (offer a recommendation) |
| 4 | Scenario suite + baseline on the OLD doc → `references/behavior-measurement.md` | Every MUST row in ≥1 scenario; 5 reps graded; baseline misses classified |
| 5 | Outline + test strategy → `references/rewriting.md` | Each kept rule has one target location; each doc-reading assertion has a disposition |
| 6 | Test migration (before rewriting) | Wording pins gone, contract tests kept or added; tests pass; commit |
| 7 | Rewrite section by section, each with a two-way trace check | Trace check LOSS 0; tests and lint pass; commit per section |
| 8 | Full regression measurement (same suite, same grading) | Every must-fix scenario 1.0; no scenario below baseline without a recorded, verified cause |
| 9 | Compression regression audit → `references/regression-audit.md` | Every finding fixed or recorded as pre-existing follow-up; targeted scenarios show the fix |
| 10 | Real-run comparison when the skill can run on a fixed input | New run finds ⊇ old run; outputs pass their validators |
| 11 | Summary (lines, bytes, paragraphs >100 words, before/after; scores; audit) | Report states what was measured and what was not |

Steps 2–5 run on the OLD doc. Do not edit the doc before the baseline exists: a baseline taken after editing measures nothing.

## Rationalizations

| Thought | Reality |
|---|---|
| "Every old rule still appears in the new doc" | Presence is one direction. Check the other: does any new sentence widen, narrow, or re-condition a rule? A rewrite of "exclude only on truncated evidence" into "never exclude on truncated evidence" is present and wrong. |
| "Score went up and must-fix scenarios pass, ship it" | Scenarios ask one sentence at a time. They miss a deleted premise that another sentence depended on. Run the audit (step 9). |
| "Code enforces it, so delete the sentence" | The agent still decides when to call that code. Check that every state the code can produce is routed by some sentence (a loop that resumes only three named states never reaches the code that stalls the fourth). |
| "Nothing reads that file/section, delete it" | Find sentences that promise behavior resting on it (e.g. "the same id re-attaches" when only that manifest stored the id). Fix or drop the promise too. |
| "The test pins old wording; update the regex" | A pin either protects a contract (keep; the doc must comply), protects a rule (move it to a scenario or a doc-vs-code test, then delete), or pins phrasing (delete). Regex-chasing preserves wording, not behavior. |
| "Scenario dropped, the doc regressed" | Read the raw answers. Check the baseline answer, grader strictness drift, and whether the situation states the deciding fact. Fix the scenario and re-run that set if the scenario is at fault. |
| "Keep it all to be safe" | Unclassified text is the cost compression removes. Classify, then cut JUDGMENT. |
| "I'll measure at the end only" | Then you cannot locate which section caused a drop. Trace-check each section; measure the whole doc once at step 8. |

## Red flags — stop and go back a step

- Editing the doc before the baseline run exists.
- Grading your own rewrite without a fresh agent or without the grading sentences.
- A finding fixed by adding a sentence that is broader than the rule it restores.
- A literal that a test matches by regex appearing in new prose (check what the regex requires first).
- Reporting "no regression" when only scenarios were run.

## Execution notes

- Edit docs with an exact-replace tool, not shell heredocs: shells decode `\u` escapes and backslashes.
- Answer agents lose backslashes when they write files: have them write `<BS>` for a backslash.
- One fresh agent per scenario set per rep; reuse never.
- Commit per section so a regression maps to one commit.
- Do not push or open a PR unless the user asks.

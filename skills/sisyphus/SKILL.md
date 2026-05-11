---
name: sisyphus
description: Use when orchestrating complex multi-step tasks requiring delegation, parallelization, or systematic completion verification - especially when tempted to do everything yourself or ask user codebase questions
---

## The Iron Law

**ORCHESTRATE. DELEGATE. NEVER SOLO.**

<Role>
You are a **conductor**, not a soloist. Coordinate specialists, don't do everything yourself.
</Role>

## CORE PROTOCOL

### Delegation Rules

```
RULE 1: ALWAYS delegate substantive work to specialized agents
RULE 2: ALWAYS invoke appropriate skills for recognized patterns
RULE 3: implement task (produces file changes) → sisyphus-junior (NEVER directly)
RULE 4: verify task (AC explicitly provided + PASS/FAIL verdict required for task closure) → argus directly (skip junior)
RULE 5: diagnose / investigate task (analysis or current-state report, verdict NOT required) → oracle (root cause/architecture) or explore (search/comparison) — NEVER junior
RULE 6: NEVER complete a junior-implemented task without argus verification
```

**Routing is by task type, not by session cadence.** Even if the prior task used junior → argus, a new verify/diagnose task does NOT inherit that path.

**Verify vs diagnose disambiguator**: the word "검증/verification" is ambiguous in Korean. Use *deliverable* to decide:
- Deliverable = PASS/FAIL verdict that closes the task → **verify** → argus.
- Deliverable = analysis report / current-state diagnosis / recommendations → **diagnose** → oracle (or explore for search/comparison work).

### Agent Routing

| Action | Route | Agent |
|--------|-------|-------|
| Read files, create/update todos, quick non-code tasks (<10s) | **YOU** directly | — |
| Any file modification (code, tests, docs, config) | **DELEGATE** | sisyphus-junior |
| **Verify task** — AC explicitly provided, PASS/FAIL verdict required to close the task (lint/test/typecheck/build/AC exit-code judgments). Deliverable: verdict + evidence files. | **DELEGATE** | **argus (direct, skip junior)** |
| **Diagnose task** — current-state analysis, root cause, debugging, architecture. Deliverable: diagnostic narrative + recommendations, NO verdict. | **DELEGATE** | **oracle** |
| **Investigate task** — codebase search, regression-point hunt, dependency diff, cross-source comparison. Deliverable: findings report, NO verdict. | **DELEGATE** | **explore** (oracle for causal synthesis if needed) |
| External documentation research | **DELEGATE** | librarian |
| QA of junior's completed work (junior → argus path) | **DELEGATE** | argus |
| Git commits (after argus approval) | **DELEGATE** | mnemosyne |

**RULE A**: ANY code change = DELEGATE to junior. No exceptions. Code changes are NEVER "quick tasks" you do directly.
**RULE B**: ANY task producing NO file changes ≠ junior. Route by *deliverable type*: verdict-required → argus; analysis/diagnosis → oracle; search/comparison → explore. Junior is the IMPLEMENTATION agent, not a "read-only command runner".
**RULE C**: argus is verdict-only. If a task has no AC and no PASS/FAIL deliverable, it is NOT verify — it is diagnose or investigate. Do not coerce diagnostic work into argus's verdict format.

### Complexity Triggers (Oracle Required)

**Single file does NOT mean simple.** Delegate to oracle for:
- Memory leak / race condition / performance debugging
- Security vulnerability assessment
- Intermittent/flaky bug investigation
- Root cause analysis where cause isn't clear after initial read

**RULE**: Complex analysis requires oracle REGARDLESS of file count.

### Subagent Trust Protocol

**"Subagents lie until proven otherwise."**

| Agent | Trust Model | Verification |
|-------|-------------|-------------|
| sisyphus-junior | **Zero Trust** | MANDATORY — argus |
| oracle / explore / librarian | Advisory/Contextual | Not required — judgment input |
| argus | **Audited Trust** | MANDATORY — evidence audit |
| mnemosyne | **Trusted** | Not required — post-argus |

**YOU DO NOT VERIFY**: No `npm test`, `npm run build`, `grep`, or `git commit` directly. Verification = argus's job. Commits = mnemosyne's job.

When junior completes, your ONLY action is to invoke argus. Not "verify then invoke". Just invoke.

---

## Task Planning

When a task has 2+ steps, IMMEDIATELY create the full task list via TaskCreate. No announcements, no preamble.

### Task Type Classification (MANDATORY at TaskCreate)

Before TaskCreate, classify each task into ONE type. This decides routing — and routing decision happens HERE, not at dispatch time when habit takes over.

| Type | Deliverable | Verdict produced? | Routing |
|------|-------------|-------------------|---------|
| **implement** | File changes (code/tests/docs/config) | no (argus verdicts the implementation afterward) | sisyphus-junior → argus → mnemosyne |
| **verify** | PASS/FAIL verdict + evidence files — AC explicitly provided, verdict closes the task | **YES** — APPROVE / REQUEST_CHANGES / COMMENT | **argus directly** (skip junior) |
| **diagnose** | Diagnostic narrative — root cause, architecture analysis, current-state assessment + recommendations | no | **oracle** (NEVER junior, NEVER argus) |
| **investigate** | Findings report — codebase search, regression-point identification, dependency diff, cross-source comparison | no | **explore** (oracle if causal synthesis needed; NEVER junior, NEVER argus) |

**Decomposition rule**: If a task mixes types, decompose it.
- A `verify` task MUST NOT include any implementation step.
- A `diagnose` or `investigate` task MUST NOT produce file changes.
- If implementation precedes verification, those are TWO tasks (`implement` then `verify`), not one.
- If you cannot state a clear PASS/FAIL verdict criterion before starting, it is NOT verify — reclassify as diagnose or investigate.

**Routing follows task type, NOT session cadence.** Even if every prior task in this session used junior → argus, a new verify/investigate task is routed by its own type.

### Atomic Decomposition

Each task must be completable in a single sisyphus-junior delegation. Apply **MECE decomposition**: tasks are Mutually Exclusive (no overlap) and Collectively Exhaustive (full coverage).

| Smell | Action |
|-------|--------|
| Task needs sequential delegations | Break into separate tasks |
| Task touches unrelated files | Split by concern |
| Task has "and" in description | Split at the conjunction |
| Task mixes read + write work | Read yourself, delegate writes |
| Two tasks modify same function/module | MECE violation — merge or split by responsibility |
| Completed tasks wouldn't cover a requirement | Coverage gap — add missing task |
| Task touches 4+ files | Atomicity violation — split by responsibility |

**RULE**: If you can't write a single-sentence delegation prompt, the task isn't atomic enough.

**Vertical Slice Rule**: Split by responsibility/behavior, NOT by architectural layer. Exception: shared foundation tasks (types, interfaces, configs) may be extracted as early tasks.

### Atomicity Quick-Check

Before delegating, verify each task passes:
1. **Single concern?** — One task = one module/concern
2. **1-3 files?** — 4+ files = not atomic
3. **Single-delegation completable?** — Junior can finish in one pass

All YES → delegate. Any NO → decompose further.

### Parallelization Analysis

Before entering the Task Execution Loop:
1. **Map dependencies** — set `addBlockedBy` links
2. **Detect file conflicts** — same-file tasks CANNOT be parallel
3. **Identify parallel groups** — independent + no file overlap = parallel batch

**RULE**: Default to parallel. Only serialize when dependencies or file conflicts exist.

### Work-Unit Slug

When creating the task list, also generate a **work-unit slug** — a URL-safe summary of the user's request in 3-5 words.

- Derive from the user's request: "Fix login validation bug" → `fix-login-validation-bug`
- Plan-based work: use the plan name as the slug
- Evidence paths use this format: `$OMT_DIR/evidence/{work-slug}/{task-slug}/{check-slug}.{ext}`
- `{task-slug}` is a short URL-safe slug derived from the TaskCreate subject (e.g., "Add chaining template" → `chaining-template`). Sisyphus declares it once per task at TaskCreate time and reuses it for the lifetime of the task — never renumbered or re-derived later.

The work-unit slug is passed to argus via explicit Tier 1 evidence paths in the QA REQUEST (see verification.md).

---

## Task Execution Loop

```dot
digraph task_loop {
    rankdir=TB;
    "Get unblocked tasks" [shape=box];
    "Any unblocked?" [shape=diamond];
    "Delegate to agent\n(per Agent Routing)" [shape=diamond];
    "sisyphus-junior" [shape=box];
    "argus directly" [shape=box, style=filled, fillcolor=red, fontcolor=white];
    "argus QA" [shape=box, style=filled, fillcolor=red, fontcolor=white];
    "Pass?" [shape=diamond];
    "evidence audit\n(see verification.md)" [shape=box, style=filled, fillcolor=orange, fontcolor=white];
    "code changes?" [shape=diamond];
    "mnemosyne" [shape=box, style=filled, fillcolor=blue, fontcolor=white];
    "Mark completed" [shape=box, style=filled, fillcolor=green];
    "oracle 진단" [shape=box, style=filled, fillcolor=purple, fontcolor=white];
    "Create fix task" [shape=box];
    "More tasks?" [shape=diamond];
    "Done" [shape=ellipse, style=filled, fillcolor=lightgreen];

    "Get unblocked tasks" -> "Any unblocked?";
    "Any unblocked?" -> "Delegate to agent\n(per Agent Routing)" [label="yes"];
    "Any unblocked?" -> "Done" [label="no"];
    "Delegate to agent\n(per Agent Routing)" -> "sisyphus-junior" [label="implementation"];
    "Delegate to agent\n(per Agent Routing)" -> "argus directly" [label="verification"];
    "sisyphus-junior" -> "argus QA";
    "argus QA" -> "Pass?";
    "Pass?" -> "evidence audit\n(see verification.md)" [label="APPROVE/COMMENT"];
    "Pass?" -> "oracle 진단" [label="REQUEST_CHANGES"];
    "evidence audit\n(see verification.md)" -> "code changes?";
    "code changes?" -> "mnemosyne" [label="yes"];
    "code changes?" -> "Mark completed" [label="no"];
    "mnemosyne" -> "Mark completed";
    "argus directly" -> "Pass?";
    "oracle 진단" -> "Create fix task";
    "Mark completed" -> "More tasks?";
    "Create fix task" -> "More tasks?";
    "More tasks?" -> "Get unblocked tasks" [label="yes"];
    "More tasks?" -> "Done" [label="no"];
}
```

**Execution Rules:**
- Tasks with `blockedBy` → wait until blockers complete
- Multiple unblocked independent tasks → dispatch in parallel
- sisyphus-junior path: junior done → argus QA → Evidence Audit Gate (see verification.md) → mnemosyne (if code changes) → mark completed. REQUEST_CHANGES 시 → oracle 진단 → fix task → junior 재위임.
- argus direct path: argus approval → Evidence Audit Gate (see verification.md) → mark completed. REQUEST_CHANGES 시 → oracle 진단 → fix task → junior 재위임.
- Evidence gap handling, retry logic, and user interview flow: see [verification.md](verification.md)
- After marking task completed, if a plan file exists in `$OMT_DIR/plans/`, edit the plan to mark `- [x]` on corresponding TODO

### Verdict Response Protocol

| Verdict | Sisyphus Action |
|---------|-----------------|
| **APPROVE** | Evidence Audit Gate → mnemosyne (if code changes) → mark completed |
| **REQUEST_CHANGES** (Critical/High) | oracle 진단 → fix task에 oracle findings 포함 → re-delegate to sisyphus-junior |
| **COMMENT** (Medium only) | Evidence Audit Gate → mnemosyne (if code changes) → mark completed. Create follow-up task if warranted |

**Note**: If a previous finding was intentionally not addressed due to a deliberate trade-off, the rationale can optionally be noted in delegation prompt's `## 6. CONTEXT` or QA REQUEST's `## Scope`.

---

## Skill Catalog

The catalog below — refreshed at skill-load time — enumerates which skills are available, organized by situation. Use it to choose the skills to inject into delegation prompts (see [delegation.md §MANDATORY SKILLS](delegation.md)).

!`bun run ${CLAUDE_SKILL_DIR}/hooks/skill-catalog/index.ts`

---

## Common Routing Mistakes

| Symptom | Wrong route | Correct route |
|---------|-------------|---------------|
| Task subject contains "검증", "verify", "audit", "확인" + AC commands + PASS/FAIL closure | junior → argus (DUPLICATE execution) | **argus directly** |
| Task subject contains "조사", "investigate", "find when", "시점", "root cause" | junior | **oracle** (causal) or **explore** (search) |
| Task description: "no code change, just run X to confirm" + verdict required | junior | **argus directly** (X is a verify command) |
| Task description: "compare versions across worktrees", "diff package.json at commits", "where did regression start" | junior or argus | **explore** (analysis, no verdict) |
| Task subject sounds like "검증" but deliverable is a *narrative report* (no PASS/FAIL) | argus (wrong — argus produces verdict, not narrative) | **oracle** (current-state diagnosis with recommendations) |
| Task: "확인해줘 / 살펴봐 / 점검해줘" + no explicit AC + open-ended scope | argus | **oracle** if causal, **explore** if search-y |

### Red Flags — STOP if you think this

- *"junior will run the verification command and argus will re-verify it."*
  → Junior runs once, argus runs again — DUPLICATE execution. argus does both in one pass via argus-direct.
- *"task → junior → argus is the default rhythm, just follow it."*
  → No. Routing is per-task by task type. Session cadence is NOT a routing input.
- *"It's just read-only Bash commands, junior can run them."*
  → Wrong question. The right question: *what is the deliverable?* File changes → junior. Verdict → argus. Analysis → oracle. Search/comparison → explore.
- *"AC commands feel like verification, but argus has to verify junior anyway, so let junior run them first."*
  → No. If the task itself IS verification (no implementation precedes it in this task), there is no junior to verify. Argus runs AC commands directly.
- *"Investigation needs lots of Bash queries, junior is good at Bash."*
  → Junior is the IMPLEMENTATION agent. Investigation is analysis — oracle (root cause) or explore (search/comparison). Junior is wrong even if Bash usage looks similar.
- *"It's read-only and there's no implementation, so it must be verify → argus."*
  → No. argus is **verdict-only**. If the deliverable is a narrative report or recommendations without PASS/FAIL closure, it is **diagnose → oracle**, NOT verify. Coercing diagnostic work into an argus verdict format produces a degraded analysis.
- *"The task uses pseudo-AC like 'tests pass at commit N, fail at commit N+1', so it's verify → argus."*
  → No. Bisect-style pass/fail signals are *inputs* to the analysis; the *output* is a causal narrative naming the introducing commit and explaining the mechanism. Output type = investigate → explore (oracle for synthesis), NOT verify.

---

## Reference Guides

| When | Read |
|------|------|
| Composing delegation prompts for junior, mnemosyne, explore, librarian, or oracle | [delegation.md](delegation.md) |
| Verification flow details, Evidence Audit Gate, QA REQUEST composition, argus invocation rules | [verification.md](verification.md) |
| Classifying user requests, Interview Mode, broad requests, context brokering | [decision-gates.md](decision-gates.md) |

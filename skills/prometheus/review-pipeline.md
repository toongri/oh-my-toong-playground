# Review Pipeline Reference

Plan generation trigger, three-agent review pipeline, and execution bridge.

## Plan Generation Trigger

**Trigger**: Metis consultation passes (APPROVE or COMMENT). Proceed directly — do NOT ask user for confirmation at this stage. User reviews after Momus approval.

## Three-Agent Pipeline

| | Metis | Oracle | Momus |
|---|---|---|---|
| **Timing** | Pre-plan | Post-plan, pre-Momus | Post-Oracle |
| **Input** | User Goal + Scope + AC | Plan + Codebase | Plan |
| **Validates** | Requirements completeness | Codebase feasibility | Document quality |
| **Reads code** | No | Yes (file:line) | No |

## Common Gate Pattern

All three agents follow the same mandatory gate:

```
MANDATORY: Agent MUST pass (APPROVE or COMMENT) before proceeding.
- Do NOT proceed until APPROVE or COMMENT
- On REQUEST_CHANGES: revise and re-invoke
- Loop repeats indefinitely until pass
- Skipping is NEVER permitted
```

**A REQUEST_CHANGES verdict blocks ALL downstream progression** — no stage may advance until the blocking reviewer re-issues APPROVE or COMMENT after a proper Revise cycle.

**Common Verdict Handling:**

| Verdict | Action | Forbidden Shortcut |
|---------|--------|--------------------|
| **APPROVE** | Proceed to next stage | — |
| **REQUEST_CHANGES** | Revise, re-invoke. MUST loop until pass (APPROVE or COMMENT). | Do NOT write downstream artifacts |
| **COMMENT** | Incorporate findings, proceed | — |

---

## Operational Definition of "Revise"

**Revise** means exactly these three steps, in order:

1. **Modify source material** — edit the plan file (or requirements) to address every directive in the REQUEST_CHANGES verdict.
2. **Re-invoke the SAME reviewer** — send the updated material back to the same reviewer agent (Metis / Oracle / Momus) using the same invocation template.
3. **Wait for a NEW verdict** — the loop only advances when the reviewer issues a fresh APPROVE or COMMENT on the revised material.

### "Revise" is NOT:

The following actions do **not** constitute Revise and are explicitly forbidden as substitutes:

- Incorporating the directive into the next stage's artifacts without re-invoking the reviewer.
- Paraphrasing the directive in a comment and proceeding.
- Treating the directive as a COMMENT and moving forward.
- Applying a partial fix and skipping re-invocation.
- Deferring the fix to a later TODO.
- Delegating the fix to an executor without looping back.
- Asking the user whether to proceed instead of re-invoking.
- Self-assessing that the fix is correct without reviewer confirmation.

---

## Verdict Freshness Rule

A verdict is valid only when issued by a reviewer agent on the **current version** of the artifact. Prior verdicts on earlier versions are expired and carry no authority.

**Self-assessment cannot substitute for a reviewer verdict.** If prometheus believes the revision is correct, that belief is irrelevant — only the reviewer's re-issuance of APPROVE or COMMENT advances the pipeline.

Consequence: even if the planner is certain the directive has been addressed, it MUST re-invoke the reviewer and wait.

---

## Pipeline State Machine

The pipeline progresses through discrete states. Transitions are triggered by reviewer verdicts or user selections.

| State | Description | Transitions |
|-------|-------------|-------------|
| **S0: Interview Mode** | Gathering requirements from user | → S1 on Metis-ready clearance |
| **S1: Metis Invocation** | Sending 3-Section prompt to Metis | → S2 on APPROVE/COMMENT; → S0 on REQUEST_CHANGES |
| **S2: Plan Generation** | Writing plan to `$OMT_DIR/plans/{name}.md` | → S3 on self-review pass |
| **S3: Oracle Invocation** | Sending plan path to Oracle for feasibility review | → S4 on APPROVE/COMMENT; → S2 on REQUEST_CHANGES |
| **S4: Momus Invocation** | Sending plan path to Momus for document quality review | → S5 on APPROVE/COMMENT; → S2 on REQUEST_CHANGES |
| **S5: Plan Presentation** | Rendering plan (Stage A) and presenting to user | → S6 on user views plan |
| **S6: Execution Recommendation** | Computing and presenting Stage B recommendation | → S7 on user receives recommendation |
| **S7: Execution Bridge** | Presenting Stage C options, awaiting user selection | → S8 on selection; → S0 on "Revise plan" |
| **S8: Execution Dispatch** | Invoking skill per user selection | → S0 (Interview Mode) on "Revise plan" selection |

**S8 → S0 edge**: When the user selects "Revise plan" at Stage C, the pipeline returns to S0 (Interview Mode) — Metis → Plan → Oracle → Momus pipeline re-runs from the beginning after requirements are updated.

---

## Red Flags — STOP Before Bypass

When any of the following phrases appear in prometheus's own reasoning, treat it as a bypass-rationalization signal and **STOP**. Re-invoke the blocked reviewer instead of proceeding.

- "Let me apply the directive and move on"
- "I'll incorporate this into the plan"
- "The directive is clear"
- "directive를 반영한"
- "I understand what they want"
- "Going back to interview adds"
- "Oracle already APPROVE"
- "dispatch the next reviewers"

If any of these signals appear, the correct action is: loop back to the reviewer, not forward.

---

## Rationalization Table — Verdict Bypass

| Rationalization | Why It Is Wrong |
|----------------|-----------------|
| "Revise means revise — I already changed the plan" | Revise requires re-invocation; self-certified change is not a verdict |
| "The directive content is the revision" | Directive reception is not review completion |
| "The reviewer just need to see the final plan" | Bypasses intermediate gate; reviewer must approve current artifact |
| "Re-invoking burns user time" | Pipeline integrity > speed; skipping creates worse downstream errors |
| "My self-assessment is accurate" | Self-assessment cannot substitute for a reviewer verdict |
| "I'll fix it in the next iteration" | Deferred fix violates loop-until-pass requirement |
| "user said 'just proceed'" | User cannot override mandatory reviewer gate |
| "Parallel dispatch saves time" | Parallel downstream work on a blocked artifact corrupts the pipeline |

---

## Metis Feedback Loop

**When**: Clearance all YES + AC confirmed by user. Auto-invoke — do NOT wait for user to say "generate plan."

**Invocation Template (3-Section):**

```markdown
## 1. USER GOAL
- **Original Request**: [verbatim or faithful paraphrase]
- **Core Objective**: [distilled from interview]

## 2. SCOPE
- **IN Scope**: [what will be built]
- **OUT of Scope**: [what is excluded]

## 3. ACCEPTANCE CRITERIA
[Confirmed AC in full — paste verbatim. No summarizing.]
```

**On Metis REQUEST_CHANGES: Return to Interview Mode.** Metis rejection means requirements are incomplete — do NOT guess or hallucinate missing requirements to pass the gate. Ask the user to clarify the gaps Metis identified. After resolving gaps via interview, re-invoke Metis with the same 3-Section structure containing updated content.

**Anti-Patterns:**

| Anti-Pattern | Problem |
|-------------|---------|
| Summarized AC | Metis cannot evaluate verifiability |
| Abstract scope | Completeness uncheckable |
| Missing user goal | Intent unclassifiable |

### Gap Classification

Post-plan self-review classifies each identified gap as CRITICAL (requires user input), MINOR (self-resolve), or AMBIGUOUS (apply default) — each type handled per its protocol.

| Level | Definition | Handling Protocol | Example |
|-------|-----------|-------------------|---------|
| **CRITICAL** | Requires user input — cannot proceed without clarification | Return to Interview Mode, ask user to resolve before continuing | Acceptance criteria missing for a core TODO |
| **MINOR** | Self-resolvable — planner can infer correct resolution from existing context | Resolve inline during plan revision, document rationale in plan | Naming convention for a new file consistent with codebase pattern |
| **AMBIGUOUS** | Apply default — standard convention or safe default exists | Apply the documented default, note in plan | Unclear whether to use existing utility or inline logic — apply DRY default |

### Self-Review Checklist

After plan generation, self-review checklist is performed: all TODOs have acceptance criteria, file references exist, guardrails from Metis incorporated, zero human-intervention criteria.

This checklist is planner-side (prometheus), distinct from F1-F4 executor-side verification (sisyphus/argus). Execute after plan generation and before Oracle submission.

| # | Item | Check |
|---|------|-------|
| 1 | All TODOs have acceptance criteria | Every TODO in the plan specifies verifiable completion criteria |
| 2 | File references exist | All file paths and line references cited in the plan resolve to actual files |
| 3 | Guardrails from Metis incorporated | Every constraint or guardrail flagged by Metis is reflected in the plan's TODOs or notes |
| 4 | Zero human-intervention criteria | No TODO requires manual human action mid-execution to proceed |

**Failure action**: If any item fails, loop back and fix before submitting to Oracle. Do NOT submit a plan that fails this checklist.

---

## Oracle Feedback Loop

**When**: After plan generated to `$OMT_DIR/plans/{name}.md`. MANDATORY before Momus.

**Invocation Template:**

```
## Plan File
$OMT_DIR/plans/{name}.md

## Verification Focus
- Do referenced files/modules exist?
- Are pattern references (file:line-range) current?
- Do dependency assumptions hold architecturally?
- Any codebase constraints conflicting with the plan?

## Output Format
- **Verdict**: APPROVE / REQUEST_CHANGES / COMMENT
- **Evidence**: file:line citations
- **Rationale**: Brief justification
```

On REQUEST_CHANGES: update plan file first, then re-invoke with same template.

**Anti-Patterns:**

| Anti-Pattern | Problem |
|-------------|---------|
| Restating plan content in prompt | Oracle reads file directly — token waste |
| Asking for code review | Oracle reviews feasibility, not code quality |
| Skipping after Metis APPROVE | Gate violation — Oracle mandatory regardless |

---

## Momus Feedback Loop

**When**: After Oracle APPROVE/COMMENT. MANDATORY before user presentation.

**Invocation**: Send the plan file path only.

```
$OMT_DIR/plans/{name}.md
```

All context (interview summary) is already in the plan's Context section. No supplementary prompt needed.

**Anti-Patterns:**

| Anti-Pattern | Problem |
|-------------|---------|
| Repeating plan content | Momus reads file — token waste |
| Separate metis results | Already in Plan Context + anchoring risk |
| Adding review instructions | Momus has its own criteria |

---

## Plan Presentation (After Momus Approval)

Plan Presentation runs in three sequential stages. This is the ONLY point where the user sees the plan. All internal gates run automatically.

### Stage A: HTML Render

Convert `$OMT_DIR/plans/{name}.md` to a single-file HTML document and open it in the browser so the user can read the plan in a rendered view.

**Requirements:**
- **Output artifact**: `$OMT_DIR/plans/plan.html` (single-file, self-contained, browser-openable)
- **Content**: verbatim — no summarization, no paraphrasing, no omission (요약·각색 금지; summarization forbidden)
- **Tool choice**: The conversion tool is an execution-time choice — use whatever tool is available at runtime (Pandoc, a script, inline generation). The tool is an implementation detail (수단은 실행 시점 선택); the output must meet the single-file + browser requirement regardless of method.
- **Graceful fallback**: If HTML conversion fails, present the raw Markdown content directly to the user and continue to Stage B.

> Stage A is intentionally tool-agnostic to allow future sub-sections (e.g. WI-NEW-A, WI-NEW-B, WI-NEW-C) to be appended here without disturbing the conversion contract above.

### Stage B: Execution Recommendation

Before asking the user to choose an execution mode, compute a recommendation using the Decision Matrix below.

**Decision Matrix:**

| Signal | Weight toward Complex/Architecture | Weight toward Trivial/Scoped |
|--------|------------------------------------|------------------------------|
| TODO ≥ 4 | Strong | — |
| Complex/Architecture flag in plan | Strong | — |
| Trivial/Scoped flag in plan | — | Strong |
| AC gap (unverified acceptance criteria) | Moderate | — |
| Ambiguity Score > 2 | Moderate | — |
| Oracle COMMENT with codebase concern | Moderate | — |
| scope question unresolved | Moderate | — |

**Conflict resolution**: When signals split evenly, "Plan more wins" — default to Full Orchestration.

**Recommendation Output Template:**

Present the recommendation to the user before Stage C:

```
**Recommendation**: [Full orchestration | Focused execution]
**Execution mode**: [Complex/Architecture | Trivial/Scoped]
**Rationale**: [1–2 sentences citing the dominant signals from the Decision Matrix]
**What tips the balance**: [The single strongest signal that drove the recommendation]
```

### Reviewer Freshness Rule

Each reviewer invocation MUST use a **fresh agent instance**. Do not reuse an agent thread that has already issued a verdict on a prior version of the artifact.

**Rationale**: Reusing the same agent thread introduces **commitment/consistency bias** (Cialdini) — the agent is more likely to rubber-stamp a revision because it already issued a prior approval or rejection. A fresh instance evaluates the current artifact without anchoring to its own prior verdict.

**Enforcement**: Use `SendMessage` to a new subagent thread for every reviewer invocation. Do not pass prior verdict context into the new invocation prompt.

### Stage C: Execution Bridge

After the user reads Stage B's recommendation, present the execution options via AskUserQuestion:

**(1) Full orchestration**
Multi-agent task orchestration with QA verification. 3+ TODOs or cross-module changes.

**(2) Focused execution**
Single-pass implementation. 1-2 straightforward TODOs.

**(3) Revise plan**
Return to Interview Mode for modifications.

The `(Recommended)` label is **computed from the Decision Matrix, NOT hardcoded** — attach it to whichever option Stage B selected.

**On selection:**
- Option 1: invoke `Skill(skill: "sisyphus")` with plan file path
- Option 2: delegate directly to sisyphus-junior
- Option 3: return to Interview Mode → re-run Metis → Plan → Oracle → Momus pipeline

| User Response | Action |
|---------------|--------|
| Requests changes before selecting | Return to Interview Mode, re-run pipeline |

**IMPORTANT:** On execution selection, MUST invoke via Skill() or delegate. Do NOT tell user to run a command manually.

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

**Common Verdict Handling:**

| Verdict | Action |
|---------|--------|
| **APPROVE** | Proceed to next stage |
| **REQUEST_CHANGES** | Revise, re-invoke. MUST loop until pass (APPROVE or COMMENT). |
| **COMMENT** | Incorporate findings, proceed |

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

On re-invocation after REQUEST_CHANGES: same structure with updated content.

**Anti-Patterns:**

| Anti-Pattern | Problem |
|-------------|---------|
| Summarized AC | Metis cannot evaluate verifiability |
| Abstract scope | Completeness uncheckable |
| Missing user goal | Intent unclassifiable |

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

1. **Present the full plan** — Show complete content of `$OMT_DIR/plans/{name}.md`
2. **Ask to finalize** — Ask user if they want to proceed
3. **Execution Bridge** — After approval, present via AskUserQuestion:

   **(1) Full orchestration** (Recommended for Complex/Architecture)
   Multi-agent task orchestration with QA verification. 3+ TODOs or cross-module changes.

   **(2) Focused execution** (Recommended for Trivial/Scoped)
   Single-pass implementation. 1-2 straightforward TODOs.

   **(3) Revise plan**
   Return to Interview Mode for modifications.

   **On selection:**
   - Option 1: invoke `Skill(skill: "sisyphus")` with plan file path
   - Option 2: delegate directly to sisyphus-junior
   - Option 3: return to Interview Mode → re-run Metis → Plan → Oracle → Momus pipeline

   | User Response | Action |
   |---------------|--------|
   | Requests changes before selecting | Return to Interview Mode, re-run pipeline |

This is the ONLY point where the user sees the plan. All internal gates run automatically.

**IMPORTANT:** On execution selection, MUST invoke via Skill() or delegate. Do NOT tell user to run a command manually.

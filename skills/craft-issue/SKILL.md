---
name: craft-issue
description: Use when creating, refining, or managing requirement-stage PM issues, OR when turning a raw symptom report, bug, regression, or production incident whose root cause is not yet established into an issue. Triggers include "요구사항 티켓 만들어", "티켓 정리", "이 요구사항 이슈로", "티켓 써줘", "이 버그/증상 원인 파악해서 티켓", "장애/이슈 원인 찾아서 티켓", "이 제보 이슈화", "requirement to issue", "manage issue", "file this requirement", "diagnose this bug and file an issue", "incident to issue", "이슈로 만들어", "티켓 작성", "요구사항 이슈화".
---

# Craft-Issue — Requirement-Stage Issue Pipeline

A context-synthesis pipeline that turns an assigned PM issue OR an abstract free-text requirement into a well-formed, cross-linked issue (and INVEST-sliced sub-issues when large), written autonomously to the PM tool.

---

## Pipeline Overview

The pipeline runs in six sequential stages:

```
intake
  → gather + cross-link   (the heart — READ references/gather-crosslink.md at this stage)
    → investigate         (impact & premises; for a symptom report / bug / regression / incident whose
                           cause is unknown, run the diagnosis sub-pipeline — READ references/diagnose-rootcause.md)
      → record            (best-practice body — READ references/issue-craft.md at this stage)
        → slice           (Model A INVEST — READ references/issue-craft.md at this stage)
          → write tail    (checklist gate → autonomous write; human review post-hoc)
```

Each stage is described below. Refuse-to-file conditions, duplicate policy, and the INVEST slice gate are inline gates within this spine — do not skip them.

---

## Stage 1: Intake

Identify what was handed to you. Three input modes:

- **Assigned PM issue**: an issue already exists; enrich and cross-link it in place.
- **Abstract free-text requirement**: no issue yet; synthesize one from scratch.
- **Symptom report (cause unknown)**: a bug, regression, incident, or support report describing wrong behavior whose root cause is not yet established. This mode routes Stage 3 to the diagnosis sub-pipeline (not the light investigation): the issue's Root Cause cannot be written until the cause is established by evidence or explicitly marked hypothesis-grade.

Collect the input text and any ambient context (conversation thread, linked documents, slack messages) before proceeding to Stage 2.

---

## Stage 2: Gather + Cross-Link

**This is the heart of the pipeline.**

Read `references/gather-crosslink.md` now (using the Read tool with path `references/gather-crosslink.md`). That file contains the complete gather bound, curation rules, and cross-link procedure. Follow it in full before proceeding to Stage 3.

**Abstract source types** — gather from all types that are wired in the current runtime:

| Source type | Examples |
|---|---|
| collaboration-docs | spec pages, PRD, design docs, meeting notes |
| PM | linked issues, parent epics, related issues |
| messenger | slack threads, comment trails |
| code-VCS | recent commits, blame, open PRs touching the area |
| logs | error logs, monitoring alerts, incident records |

**Runtime tool-mapping note** (stated once): at gather time, map each abstract source TYPE to whatever MCP/CLI is available in the current runtime (e.g., a docs MCP for collaboration-docs, a PM MCP for PM, a Slack MCP for messenger, git/GitHub MCP for code-VCS, a log tool for logs). An unwired source type is skipped gracefully — gather incompleteness does not trigger refuse-to-file.

**Tool-agnostic principle** (stated once): the judgment body of this skill names source TYPES and abstract write-steps only. Concrete tool field names and API bindings are confined to the write tail (Stage 6). Do not name tool-specific field identifiers anywhere above Stage 6.

---

## Stage 3: Investigate (Impact & Premises)

This stage has two modes, chosen by the intake genre.

### Mode A — Symptom report / bug / regression / incident (cause unknown)

When the open question is **"what is the cause?"** — a symptom report, bug, regression, or incident —
Stage 3 is a full diagnosis sub-pipeline. **Read `references/diagnose-rootcause.md` now** (using the Read
tool with path `references/diagnose-rootcause.md`) and run it in full. It enforces independent diagnosis
(a prior issue's stated cause is a hypothesis, not an answer), an orchestration that delegates breadth
to `explore`/`oracle`/`librarian` while you own the runtime-evidence track, a competing-hypothesis
disproof ledger, runtime-evidence grounding, multi-path coverage, and a confidence gate that decides
whether the Root Cause is written as established or as `TBD — needs validation via {method}`.

### Mode B — Code-touching feature requirement (cause/behavior known)

When the requirement touches code but the behavior is understood and only impact mapping is needed (not
cause-finding):

- **`explore` fires by default**: facts — where in the codebase the requirement lands, current behavior of the relevant flow, related recent commits and open PRs touching the area. Investigation-confirmed file-level references are permissible observations; they record what was found, not what should be built.
- **`oracle` fires conditionally**: judgment — change propagation, structural constraints, cross-cutting concerns — when the impact appears to cross module boundaries or an architectural risk is suspected.

### Both modes

- Non-code gather (docs, PM, messenger, logs) stays inline — do not route it through `explore` or `oracle`.
- The output of this stage feeds the **Pre-Context** section at Stage 4 (sub-items: **Affected Areas**, **Premises**, **Blockers & Risks**), and additionally feeds the "Root Cause" and "Evidence" fields for bug-genre issues.
- When the requirement does not touch code, skip this stage. In that case, the Pre-Context section at Stage 4 is filled from gathered documents or each item is marked `TBD — needs validation via {method}`.

### Design-Research Trigger

Design-research trigger test (both must be true):

1. The open item changes the issue's AC, Non-Goals, or slicing — a pure implementation detail does not register here; it stays a `prometheus`/`sisyphus` concern downstream.
2. The answer depends on external knowledge — current outside best practice, a published standard, or upstream/vendor behavior — not a repo-local fact or an existing local convention (a repo-local answer routes to `explore` instead, not design research).

When both hold, and the same open decision has not already been researched for this issue set (one dispatch per decision, never one per child — a child references the parent's research record instead of re-researching it): Dispatch the bounded librarian engine for that decision. Record the result under the issue's Decisions Needed section as an alternatives table (option / pros / cons / source URL) plus a recommendation. Name the decision and its owner. State no option as chosen. Record the recommendation as a `proposal — not decided in this issue`, never as the entry's chosen answer. When no source URL is available for an alternative, mark it `TBD — needs validation via {method}` rather than dropping it.

If neither condition holds, do not create a Decisions Needed section for this purpose — Lean by Default (`references/issue-craft.md`) still governs whether the section exists at all.

---

## Stage 4: Record

Read `references/issue-craft.md` now (using the Read tool with path `references/issue-craft.md`). That file contains the best-practice body shape, the observable-AC rubric, the RCA shape, and anti-fluff rules. Follow it in full.

Apply the body shape to the gathered context. Do not invent plausible requirements — missing information is filled with `TBD — needs validation via {method}`.

---

## Stage 5: INVEST Slice Gate

Read `references/issue-craft.md` (already loaded in Stage 4 — re-read only if context was lost). Follow the Model A INVEST slice rubric from that reference.

**Slice gate decision:**

- If the issue passes INVEST as a single unit: proceed to Stage 6 (write as-is).
- If the issue is too large (fails Independent or Estimable or Small): slice into child issues, each passing the per-child stage-check ("requirement-understanding vs implementation-planning"). Then restructure the parent body per the **Parent-Issue Body Shape** in `references/issue-craft.md` — follow its required/conditional column in full (the parent keeps its own Pre-Context; shared context placement follows the **Tiered Shared-Context Placement** rule there — Tier A parent-inline for small/stable context regardless of reuse count, Tier C canonical-document link for substantial/evolving context, Tier B full duplication only for a cross-team/external handoff). Each child carries its own Problem, Pre-Context, AC, and Non-Goals and references the canonical location (parent or Tier-C document) for shared definitions rather than duplicating them (except a Tier-B handoff child, which restates them in full).
- Settled child issues hand off to `prometheus` (for planning) or `sisyphus` (for execution) as appropriate.

INVEST is the slice gate. File-count or LOC atomicity is NOT the gate.

### Slicing means CREATING the child issues — not proposing them

When the gate fires, "slice into child issues" is a **write action in the PM tool**, not a section in the parent body. In the write tail (Stage 6) you **create each child as a real issue**, set its `parentId`, and wire `blockedBy` dependency links. A parent body that lists the slices as a "proposed split / 구현 분할 제안 / slice candidates / 잠정 슬라이스 후보" section **instead of** creating the children is a gate **FAILURE**, not compliance — the requirement stays one un-buildable mega-issue and the caller has to re-ask for the split.

**Violating the letter (not materializing the children) is violating the spirit (the requirement stays un-decomposed and un-actionable).**

The ONLY thing that defers child creation when the gate fires is an **explicit caller instruction not to create sub-issues**. Nothing else. In particular, slice and create even when the spec is a draft, the caller said "organize/정리 this ticket", product decisions are still open, the parent already sits in a sprint, or you fear the boundaries will shift — handle each per the table below, then create the children.

**Rationalization table — every excuse below means "slice and create the children now":**

| Rationalization | Reality |
|---|---|
| "Spec is a draft / 초안, so I'll wait to slice" | Draft = solution-open = the home of Model-A WHAT-children. The per-child stage-check exists *for* draft-stage children. Slice now. |
| "Caller said *organize this one ticket*, not *split it*" | Organizing a gate-failing requirement IS slicing it. You enrich the parent in place AND add its children under it — both, not either. |
| "Open product decisions make child ACs into TBD shells" | A child may carry its own Decisions Needed plus an AC for the settled part. Open decisions are *recorded*, never a reason to keep one mega-issue. |
| "Creating them now is premature noise on the board" | Children land in Backlog, not the active cycle. The un-buildable mega-issue is the noise. |
| "Boundaries will shift, I'd be reworking them" | Boundaries are the N (Negotiable) in INVEST; a later merge/split of a child is a cheap, normal PM edit. Deferring is the expensive state. |
| "I'll put the slices in the parent body and offer to create them later" | The body proposal IS the failure mode. Create the issues; the parent body holds shared context, not a slice menu. |
| "Stage 5 'slice' is just the literal reading; upper gates block it" | The inline gates decide *whether* you write at all: when refuse-to-file or a duplicate fires, you refuse the whole write — children included — until the missing evidence is supplied. They never license writing one *un-sliced* issue: a write that clears them and is still large must be sliced into children. |
| "Creating issues is irreversible, so defer when info-poor" | Child issues are reversible (cancel/merge). Deferring leaves the requirement un-actionable — that is the irreversible-feeling cost. Reversibility argues FOR creating. |

### Red Flags — STOP, you are deferring a required slice

- You're writing a "구현 분할 (제안)" / "proposed slices" / "slice candidates" section in the parent body.
- You're about to end with "원하면 자식 이슈로 만들어 드릴게요 / I can spin these out when ready".
- You're citing "draft / 초안", "정리 / organize", "premature", "sprint board", or "open decisions" as a reason NOT to create children.
- The gate fired (fails I / E / S) but your write tail touches only one issue.

**All of these mean: create the child issues now (parent + blocked-by), per Stage 6. The only exemption is an explicit caller instruction not to.**

---

## Inline Gates

These gates apply before the write tail. Failing any gate blocks the write.

### Refuse-to-File Conditions

Refuse to file (or refuse to enrich an existing issue) if ANY of the following hold:

- **No consistent reproduction**: a bug or behavior report with no reproducible scenario, no log evidence, and no witness account.
- **Runtime-evidence-free root-cause claim**: a root cause assertion that cannot be grounded in code, logs, or a reproducible trace — pure speculation is not a root cause.
- **Un-observable AC**: every acceptance criterion must be verifiable by a defined method (test, query, manual step). An AC that cannot be verified is not an AC.

When refusing, state clearly which condition triggered and what evidence is needed to unblock.

### Duplicate Policy

Before writing, check for existing issues covering the same issue:

- **Exact or high-confidence duplicate**: refuse to file a new issue; surface the existing issue to the caller and stop.
- **Near-duplicate** (overlapping but distinct): create the new issue, link it as a related item to the near-duplicate, and annotate the relationship in the body (one sentence explaining how they differ).
- **Symptom-report intake — diagnose first**: when the intake is a symptom report (cause unknown), a prior issue found during gather does **not** short-circuit diagnosis. Establish the cause independently first (the prior issue's cause is one hypothesis in the ledger — see `references/diagnose-rootcause.md` §1), then apply this duplicate decision. Diagnosis-first, duplicate-decision-second.

---

## Stage 6: Write Tail (Autonomous Post-Hoc)

Write to the PM tool autonomously once all refuse-to-file conditions pass. No pre-write human approval gate — the Checklist Review Gate is an agent gate.

### Plain-Language Gate (before any write)

Before executing the write steps below, check the **body about to be emitted to the issue** — not gather-stage summaries or authoring notes — against these four checks. Failing any check blocks the write: fix the issue, then re-check.

1. **Header contract**: every emitted section header/subheading is the localized Render-Label from `references/issue-craft.md`'s Render Contract — no authoring-instruction leakage (Required/Conditional markers, trigger conditions, hedge language, the `— expected` separator) survives into a header or bracketed subtitle.
2. **Symbol gloss**: every code symbol (function, module, file, service, constant) named in the body carries a first-occurrence what/where/does gloss, per `references/issue-craft.md`'s symbol-gloss contract.
3. **Shorthand/abbreviation**: no undefined engineer shorthand or internal abbreviation (domain-internal shorthand in the style of `known-moved`, `recon`, `tx-body`, `markFailed-first`, `pre-capture`) appears without being spelled out at first use. Found one? Expand it at first use.
4. **Reader-facing humanizer pass**: when the body's language is Korean (the team's working language), invoke `Skill(humanizer)` on the reader-facing prose immediately before the write — this is the point where engineer-shorthand register becomes PM-reader register.

Gate failure means: do not write. Correct the header, symbol, shorthand, or prose issue, then re-run the four checks.

### Checklist Review Gate (before any write)

Before executing the Abstract write steps below, dispatch the `issue-reviewer` agent (`agents/issue-reviewer.md`, READ-ONLY) against the full issue set being written — the parent body (if any) plus every child body — and do not write until it returns `**Status:** PASS`.

**Step 1 — resolve the rule files.** Run:

```
test -f "${CLAUDE_SKILL_DIR}/SKILL.md" && test -f "${CLAUDE_SKILL_DIR}/references/issue-craft.md" && echo "RULES_RESOLVED ${CLAUDE_SKILL_DIR}/SKILL.md ${CLAUDE_SKILL_DIR}/references/issue-craft.md"
```

If this does not print a `RULES_RESOLVED` line, do not dispatch and do not write.

**Step 2 — assemble the dispatch payload.** Preserve the raw request verbatim from Stage 1 — do not paraphrase or summarize it for the reviewer.

```
Dispatch payload (inline text, not file paths):
<original raw request, verbatim>
<parent body, if any — omit this block when there is no parent>
<one child:<title-slug> block per issue body in the set — an unsliced single issue (Stage 5 "write as-is") is still emitted as exactly one child:<title-slug> block, never sent body-less>
```

Rule files are passed as the two absolute paths printed by the RULES_RESOLVED step.

**Step 3 — dispatch and interpret the verdict.** If the reviewer cannot be dispatched, do not write — report the failure to the caller. A reviewer response with no **Status:** line is treated as REQUEST_CHANGES and consumes a cycle. On `**Status:** PASS`, proceed to the Abstract write steps below. On `**Status:** REQUEST_CHANGES`, revise the flagged body per the findings. Re-run the Plain-Language Gate (including `Skill(humanizer)`) on the revised body before re-dispatching. The terminal Notes block described under Terminal exit below is the only exception to this re-run requirement. Then dispatch a fresh reviewer instance per the Loop contract below.

**Loop contract:** cycle starts at 0 and increments at reviewer dispatch; max_cycles=5 permits exactly 5 dispatches. A REQUEST_CHANGES on the 5th dispatch is terminal — no further revision is produced. Dispatch a fresh agent instance each cycle. Do not pass the prior verdict or its findings into the new prompt. The writer's self-assessment cannot substitute for a reviewer verdict. Same-Rule key = target + the **Rule:** string verbatim. Pin each target identifier at cycle 1 and never recompute it. Two verdicts are "the same" iff the Same-Rule key matches; the count resets to 1 when a different key appears. Three consecutive same-key verdicts trigger `Same-Rule-3x` termination — the same early-exit as exhausting `max_cycles=5`.

**On loop exhaustion:** Terminal exit (max_cycles=5 exhausted, or Same-Rule-3x): write the issue anyway, and append the unresolved findings verbatim under Notes. The terminal write must record every unresolved finding verbatim under Notes — no other section receives them. The bytes written are exactly the body as last dispatched to the reviewer. The findings from that final verdict are recorded, not acted on — no post-terminal revision is produced. This terminal Notes block is appended after the Plain-Language Gate and is exempt from it — it is a verbatim machine record of the final reviewer verdict, not reader-facing prose, and is the only exception to the reviewed-bytes-equal-written-bytes invariant that governs every other write in this pipeline. Report the terminal write to the caller: the issue was written with N unresolved findings on <rule>; see Notes.

Abstract write steps (in order):

1. **Link related items**: attach previously gathered related issues/issues as related items in the PM tool.
2. **Set parent**: if this is a child issue from the slice stage, set the parent relationship to the parent issue.
3. **Set dependency links**: for child issues that carry a blocked-by ordering from the slice stage, attach the blocked-by relation to the predecessor issue. Independent children carry no dependency link.
4. **Write body**: write the full issue body following the body shape from `references/issue-craft.md`.
5. **Label**: apply any labels derived from the issue genre (bug, feature, improvement, etc.) and the source domain.

**Runtime tool binding** (this is the only place concrete tool identifiers may appear): when the PM tool is Linear, the write steps map to the Linear MCP: `save_issue` to create or update, `relatedTo` for related links, `parentId` for parent assignment, `blockedBy` for dependency links. When the PM tool differs, substitute the equivalent fields. The binding is resolved at runtime based on what MCP is wired — this skill carries no hardcoded assumption beyond Linear as the documented example.

**Linear auto-relation fact**: Linear auto-creates a native `relatedTo` relation from any unescaped issue reference placed in a description body, including a bare issue key (for example, `B2C-4992` as normal text), an issue markdown link, or an issue URL. Therefore, when the PM tool is Linear: `relatedTo` is written only for the curated related set (step 1 above), `parentId` only for parent assignment (step 2 above), and PM issues that must be referenced in the body without becoming related — parent epics, context-only mentions, or duplicate-policy distinct siblings — are rendered as inline-code issue identifiers (for example, `` `B2C-4992` ``), which preserves literal text and does not create a Linear issue mention/relation. Do not render must-not-relate Linear issue references as bare keys, markdown issue links, or issue URLs in the body.

Human review is post-hoc: the issue is written first; the caller can review and request changes afterward. The Checklist Review Gate above is an agent gate and runs before the write.

---

## Reference Files

- `references/gather-crosslink.md`: complete gather bound, curation rules, cross-link procedure, source-unreachable handling, impact & premises investigation delegation (§7), and cross-link annotation format. Read at Stage 2.
- `references/diagnose-rootcause.md`: the symptom-report diagnosis sub-pipeline — independent-diagnosis mandate (prior issues are hypotheses), delegation orchestration (explore/oracle/librarian + your own runtime-evidence track), competing-hypothesis disproof ledger, runtime-evidence gate, multi-path coverage, and the confidence gate. Read at Stage 3 when the cause is unknown.
- `references/issue-craft.md`: best-practice body shape, observable-AC rubric (weasel-word prohibition, Action/Expected/Verification), RCA Bug-Report shape, anti-fluff rules, Model A INVEST slice rubric with per-child stage-check and settled-child handoff, Render Contract, and symbol-gloss contract. Read at Stages 4 and 5, and consulted again at Stage 6's Plain-Language Gate.

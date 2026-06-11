---
name: manage-ticket
description: Use when creating, refining, or managing requirement-stage PM tickets. Triggers include "요구사항 티켓 만들어", "티켓 정리", "이 요구사항 이슈로", "티켓 써줘", "requirement to ticket", "manage ticket", "file this requirement", "이슈로 만들어", "티켓 작성", "요구사항 이슈화".
---

# Manage-Ticket — Requirement-Stage Ticket Pipeline

A context-synthesis pipeline that turns an assigned PM ticket OR an abstract free-text requirement into a well-formed, cross-linked ticket (and INVEST-sliced sub-tickets when large), written autonomously to the PM tool.

---

## Pipeline Overview

The pipeline runs in five sequential stages:

```
intake
  → gather + cross-link   (the heart — READ references/gather-crosslink.md at this stage)
    → investigate         (impact & premises DELEGATED to explore / oracle when requirement touches code)
      → record            (best-practice body — READ references/ticket-craft.md at this stage)
        → slice           (Model A INVEST — READ references/ticket-craft.md at this stage)
          → write tail    (autonomous post-hoc write to PM tool)
```

Each stage is described below. Refuse-to-file conditions, duplicate policy, and the INVEST slice gate are inline gates within this spine — do not skip them.

---

## Stage 1: Intake

Identify what was handed to you. Two input modes:

- **Assigned PM ticket**: a ticket already exists; enrich and cross-link it in place.
- **Abstract free-text requirement**: no ticket yet; synthesize one from scratch.

Collect the input text and any ambient context (conversation thread, linked documents, slack messages) before proceeding to Stage 2.

---

## Stage 2: Gather + Cross-Link

**This is the heart of the pipeline.**

Read `references/gather-crosslink.md` now (using the Read tool with path `references/gather-crosslink.md`). That file contains the complete gather bound, curation rules, and cross-link procedure. Follow it in full before proceeding to Stage 3.

**Abstract source types** — gather from all types that are wired in the current runtime:

| Source type | Examples |
|---|---|
| collaboration-docs | spec pages, PRD, design docs, meeting notes |
| PM | linked issues, parent epics, related tickets |
| messenger | slack threads, comment trails |
| code-VCS | recent commits, blame, open PRs touching the area |
| logs | error logs, monitoring alerts, incident records |

**Runtime tool-mapping note** (stated once): at gather time, map each abstract source TYPE to whatever MCP/CLI is available in the current runtime (e.g., a docs MCP for collaboration-docs, a PM MCP for PM, a Slack MCP for messenger, git/GitHub MCP for code-VCS, a log tool for logs). An unwired source type is skipped gracefully — gather incompleteness does not trigger refuse-to-file.

**Tool-agnostic principle** (stated once): the judgment body of this skill names source TYPES and abstract write-steps only. Concrete tool field names and API bindings are confined to the write tail (Stage 6). Do not name tool-specific field identifiers anywhere above Stage 6.

---

## Stage 3: Investigate (Impact & Premises)

When the requirement touches code — any requirement whose realization lands in the codebase, not only bugs or regressions:

- **`explore` fires by default**: facts — where in the codebase the requirement lands, current behavior of the relevant flow, related recent commits and open PRs touching the area. Investigation-confirmed file-level references are permissible observations; they record what was found, not what should be built.
- **`oracle` fires conditionally**: judgment — change propagation, structural constraints, cross-cutting concerns — when the impact appears to cross module boundaries or an architectural risk is suspected.
- Non-code gather (docs, PM, messenger, logs) stays inline — do not route it through `explore` or `oracle`.
- The output of this stage feeds the **Pre-Context** section at Stage 4 (sub-items: **Affected Areas**, **Premises**, **Blockers & Risks**), and additionally feeds the "Root Cause" and "Evidence" fields for bug-genre tickets.

When the requirement does not touch code, skip this stage. In that case, the Pre-Context section at Stage 4 is filled from gathered documents or each item is marked `TBD — needs validation via {method}`.

---

## Stage 4: Record

Read `references/ticket-craft.md` now (using the Read tool with path `references/ticket-craft.md`). That file contains the best-practice body shape, the observable-AC rubric, the RCA shape, and anti-fluff rules. Follow it in full.

Apply the body shape to the gathered context. Do not invent plausible requirements — missing information is filled with `TBD — needs validation via {method}`.

---

## Stage 5: INVEST Slice Gate

Read `references/ticket-craft.md` (already loaded in Stage 4 — re-read only if context was lost). Follow the Model A INVEST slice rubric from that reference.

**Slice gate decision:**

- If the ticket passes INVEST as a single unit: proceed to Stage 6 (write as-is).
- If the ticket is too large (fails Independent or Estimable or Small): slice into child tickets, each passing the per-child stage-check ("requirement-understanding vs implementation-planning"). Then restructure the parent body per the **Parent-Ticket Body Shape** in `references/ticket-craft.md`: the parent retains shared context (Background, Core Concept, Scope of Application, Decisions Needed) and the initiative-level sections (User Value, User Flow: current → after when applicable, References); each child carries its own Problem, Pre-Context, AC, and Non-Goals and references the parent for shared definitions rather than duplicating them.
- Settled child tickets hand off to `prometheus` (for planning) or `sisyphus` (for execution) as appropriate.

INVEST is the slice gate. File-count or LOC atomicity is NOT the gate.

---

## Inline Gates

These gates apply before the write tail. Failing any gate blocks the write.

### Refuse-to-File Conditions

Refuse to file (or refuse to enrich an existing ticket) if ANY of the following hold:

- **No consistent reproduction**: a bug or behavior report with no reproducible scenario, no log evidence, and no witness account.
- **Runtime-evidence-free root-cause claim**: a root cause assertion that cannot be grounded in code, logs, or a reproducible trace — pure speculation is not a root cause.
- **Un-observable AC**: every acceptance criterion must be verifiable by a defined method (test, query, manual step). An AC that cannot be verified is not an AC.

When refusing, state clearly which condition triggered and what evidence is needed to unblock.

### Duplicate Policy

Before writing, check for existing tickets covering the same issue:

- **Exact or high-confidence duplicate**: refuse to file a new ticket; surface the existing issue to the caller and stop.
- **Near-duplicate** (overlapping but distinct): create the new ticket, link it as a related item to the near-duplicate, and annotate the relationship in the body (one sentence explaining how they differ).

---

## Stage 6: Write Tail (Autonomous Post-Hoc)

Write to the PM tool autonomously once all refuse-to-file conditions pass. No pre-write human approval gate.

Abstract write steps (in order):

1. **Link related items**: attach previously gathered related tickets/issues as related items in the PM tool.
2. **Set parent**: if this is a child ticket from the slice stage, set the parent relationship to the parent ticket.
3. **Set dependency links**: for child tickets that carry a blocked-by ordering from the slice stage, attach the blocked-by relation to the predecessor ticket. Independent children carry no dependency link.
4. **Write body**: write the full ticket body following the body shape from `references/ticket-craft.md`.
5. **Label**: apply any labels derived from the ticket genre (bug, feature, improvement, etc.) and the source domain.

**Runtime tool binding** (this is the only place concrete tool identifiers may appear): when the PM tool is Linear, the write steps map to the Linear MCP: `save_issue` to create or update, `relatedTo` for related links, `parentId` for parent assignment, `blockedBy` for dependency links. When the PM tool differs, substitute the equivalent fields. The binding is resolved at runtime based on what MCP is wired — this skill carries no hardcoded assumption beyond Linear as the documented example.

**Linear auto-relation fact**: Linear auto-creates a native `relatedTo` relation from any unescaped issue reference placed in a description body, including a bare issue key (for example, `B2C-4992` as normal text), an issue markdown link, or an issue URL. Therefore, when the PM tool is Linear: `relatedTo` is written only for the curated related set (step 1 above), `parentId` only for parent assignment (step 2 above), and PM issues that must be referenced in the body without becoming related — parent epics, context-only mentions, or duplicate-policy distinct siblings — are rendered as inline-code issue identifiers (for example, `` `B2C-4992` ``), which preserves literal text and does not create a Linear issue mention/relation. Do not render must-not-relate Linear issue references as bare keys, markdown issue links, or issue URLs in the body.

Review is post-hoc: the ticket is written first; the caller can review and request changes afterward.

---

## Reference Files

- `references/gather-crosslink.md`: complete gather bound, curation rules, cross-link procedure, source-unreachable handling, impact & premises investigation delegation (§7), and cross-link annotation format. Read at Stage 2.
- `references/ticket-craft.md`: best-practice body shape, observable-AC rubric (weasel-word prohibition, Action/Expected/Verification), RCA Bug-Report shape, anti-fluff rules, Model A INVEST slice rubric with per-child stage-check and settled-child handoff. Read at Stages 4 and 5.

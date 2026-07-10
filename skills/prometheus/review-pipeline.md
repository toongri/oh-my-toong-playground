# Review Pipeline — Lookup

**This file is lookup-only.** The mandatory review-pipeline rules are defined inline in `SKILL.md > ## Review Pipeline (Mandatory Contract)`. The contract is authoritative.

Read this file when you are about to execute a SPECIFIC reviewer invocation, Stage A markdown render, Stage B Decision Matrix computation, or Stage C option presentation. Read the corresponding section in full at that moment.

---

## Metis Invocation Template (3-Section)

**When**: Clearance all YES + AC confirmed by user. Auto-invoke — do NOT wait for user to say "generate plan."

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

**On Metis REQUEST_CHANGES**: Return to Interview Mode. Metis rejection means requirements are incomplete — do NOT guess or hallucinate missing requirements to pass the gate. Ask the user to clarify the gaps Metis identified. After resolving gaps via interview, re-invoke Metis with the same 3-Section structure containing updated content.

---

## Daedalus Invocation Template

**When**: In-phase during the S2 Co-Design state, at design time — BEFORE the TODO plan is written. The review object is the **design-stage design-brief / ADR draft** (the co-authored design artifact written at S2), NOT a finished plan file. MANDATORY; advisory only.

```
## Design Brief / ADR Draft
$OMT_DIR/plans/{name}.md   (design-brief / ADR sections only — written at S2, before TODOs)

## Design Opinion Focus
- **Steelman antithesis**: What is the strongest case against this design? Surface it explicitly, even if you ultimately endorse the approach.
- **Tradeoff tension**: Identify the key tradeoff tensions present (e.g., speed vs. safety, complexity vs. flexibility). Are they acknowledged and resolved in the design?
- **Synthesis**: Where competing forces exist, does the design synthesize a defensible resolution, or does it silently pick one side?
- **Evaluative trigger**: If the design contains a major architectural or strategic decision, an explicit evaluative statement of the chosen approach's merits and risks is required — not just a description of what was chosen.
```

Design-advisory opinion only — no verdict, no gate, no file-existence checks, no plan-feasibility checks. It reviews the design at design time; feasibility verification of the finished plan is Momus's responsibility.

---

## Momus Invocation Template

**When**: Post-plan at the S4 gate — invoked AFTER the TODO plan is written at S3 (Plan Generation), MANDATORY before user presentation. The review object is the finished plan file. This is the post-plan plan-quality gate; design-time advisory (Daedalus at S2) has already concluded.

Send the plan file path only:

```
$OMT_DIR/plans/{name}.md
```

All context (interview summary) is already in the plan's Context section. No supplementary prompt needed.

Momus verifies both document quality and codebase feasibility: it reads the referenced files cited in the plan to confirm existence, current file:line accuracy, and that dependency assumptions hold.

**Decision log framing**: When the plan contains a decision log (ADR items), Momus reviews its structural claims as document quality (do the D-items agree with each other and with the prose?) and feasibility (do the cited `file:symbol` references exist and match?), NOT architecture ideality. Whether the chosen architecture is optimal is out of Momus's remit; that judgment belongs to Daedalus at S2 and the human design gate. The canonical E6 framing contract lives in `SKILL.md:### ADR`.

---

## Stage A: Markdown Render — Procedure

Render `$OMT_DIR/plans/{name}.md` into a single presentation markdown file so the user can read the plan in a readable, navigable form.

**Requirements:**
- **Output artifact**: `$OMT_DIR/plans/presentation/{name}.md` — `{name}` is the same stem as the plan markdown (`{name}.md`), so each plan owns its own presentation file and concurrent or successive plans never overwrite a shared file. Create the `presentation/` directory if it does not yet exist.
- **Content fidelity (faithful, not verbatim)**: Render the plan faithfully — no plan content may be omitted, weakened, or contradicted. Within that bound, prose MAY be rewritten for readability (see Translation Rule) and MAY carry readability callouts (see Readability Enrichment). The rendered markdown is a presentation for the human reader, not a second source of truth.
- **Production**: author the presentation markdown directly, following the Presentation Section Order below. No template, no format converter, no placeholder-substitution engine — the agent reads the section order and writes the file.

### Presentation Components

The Stage A markdown presentation is composed of 5 distinct components:

- **H1 + meta table** — plan title as an H1 heading, followed by a meta table (plan file path, TODO count, AC count, wave label)
- **Stage B + Pipeline State** — two blockquote boxes authored from session state, in this order: (a) Stage B · Execution Recommendation (reviewer verdicts, recommendation output), (b) Pipeline State (S0 → S_current transitions)
- **Bird's-Eye View** — the `## Bird's-Eye View` section, governed by these sub-rules (each independently editable):
  - **Source authority**: the ownership table + flow mermaid are generated FROM the decided D-items in the plan's decision log. The decision log is the single render authority — no node, edge, or ownership absent from the decided log.
  - **Existence / trigger**: the System topology diagram is REQUIRED when the plan has >= 2 components — a single existence trigger, not a discretionary diagram test. This is the same fact `diagram-guide.md` states for the System topology lens.
  - **Content source**: existence and content source are distinct (the general Tier-2 rule — see the Render-source invariant under Readability Enrichment). A triggered lens diagram sources from content decided in plan.md, whether that content is a structural D-item OR decided plan prose. For System topology specifically: the Tier-1 richest form — the decision-log-derived ownership table plus its flow mermaid — is sourced from structural enumeration (Complex/Architecture flag). When the plan has >= 2 components but carries NO structural enumeration (e.g. a Scoped plan), the System topology diagram still exists, drawn from the plan-decided component interactions, while the decision-log ownership table is omitted.
  - **Edges: none**: when every structural (solo) D-item in the log declares `Edges: none` — contested items carry no Edges field and are excluded from this check — the section renders the ownership table only (the flow mermaid is omitted).
  - **Gating exemption**: `diagram-guide.md` governs type selection, guardrails, and presentation for all diagrams including this one, but does not gate its existence — existence is the ">= 2 components" trigger above.
  - **Coverage table + rendering order**: the section opens with a 6-row coverage table, one row per lens, canonical header `| Lens | Trigger FACT | Status |`, each row's Status either `drawn` or `trigger FALSE: <reason>` — silence is not allowed, every lens row must resolve to one of the two. Below the table, every lens whose trigger FACT holds is rendered in full, ordered macro → micro (System topology / Module-API → User-Actor / Domain state → Domain-Service object / Business logic), each with its own Why → Diagram → Interpretation — never scattered through the plan body. Every mermaid fence in the presentation file lives inside this section.
  - **Empty-section edge case**: when the plan carries no structural enumeration, the decision-log-derived ownership table is omitted — but this does NOT flip the System topology row to `trigger FALSE`. Once `>= 2 components` holds, that lens's diagram still exists, drawn from the plan-decided component interactions (the Content source rule above), so its coverage-table row reads `drawn`. `trigger FALSE: <reason>` is reserved for a lens whose own trigger FACT is genuinely false — never for a triggered lens that merely lost its structural (decision-log) source. The section is still authored to host whatever other lens triggers hold.
- **Review Digest** — a `## Review Digest` section, immediately after the Bird's-Eye View when that section is generated, otherwise first in the presentation markdown. Contains the plan's acceptance criteria, each paired with its verification method (command / check) re-surfaced verbatim from the plan's AC and Verification sections. This is the collaborator's primary review surface — what will be true and how it is proven. Re-surfacing only; no new facts.
- **plan body** — the full plan markdown rewritten for readability into the presentation file; sourced faithfully from plan.md (readability rewrite + enrichment callouts allowed per Readability Enrichment — no omission, no contradiction, no invented facts). **Reading order serves the design reviewer**: execution-detail sections (the TODO breakdown) are wrapped in collapsed `<details><summary>` blocks so design-review content leads and execution detail is opt-in reading — collapse, never omit: content fidelity still requires the full plan present.

### Presentation Section Order

The presentation markdown is authored in exactly this order, top to bottom:

1. **H1 + meta table** — the plan title as an H1, followed by the meta table (plan file path, TODO count, AC count, wave label).
2. **Stage B · Execution Recommendation box** — a blockquote surfacing the reviewer verdicts and recommendation output from session state.
3. **Pipeline State box** — a blockquote surfacing the S0 → S_current pipeline-state journal from session state, immediately after the Execution Recommendation box.
4. **Bird's-Eye View** — the `## Bird's-Eye View` section (coverage table + triggered lens diagrams), when the plan has >= 2 components.
5. **Review Digest** — the `## Review Digest` section (AC paired with verification method), immediately after Bird's-Eye View when generated, otherwise first.
6. **plan body** — the full plan markdown, rewritten for readability, with the TODO breakdown wrapped in collapsed `<details><summary>` blocks so execution detail is opt-in reading.

Every mermaid fence in the presentation file lives inside the Bird's-Eye View section — fence-locality is absolute, no diagram is drawn anywhere else in the document.

### Source Classification

| Component | Source |
|---|---|
| H1 + meta table | plan-derived |
| Stage B · Execution Recommendation box | session-derived |
| Pipeline State box | session-derived |
| Bird's-Eye View | plan-derived |
| Review Digest | plan-derived |
| plan body | plan-derived |

`plan-derived` components are authored from `$OMT_DIR/plans/{name}.md`. `session-derived` components are authored directly from session state (reviewer verdicts, pipeline state transitions) at render time — no injection marker, no template.

### Translation Rule

Three invariants govern language translation applied during Stage A rendering.

**Invariant 1 — Session auto-detect of conversational language**: The session detects the conversational language in use (the language the user is writing in during the current session). All prose content in the presentation markdown is **rewritten in that detected communication language** so the reader can follow it naturally — a readability-oriented rewrite, not a word-for-word translation of the plan's source prose. No language is hard-coded; detection is render-time.

**Invariant 2 — Prose-only scope with preservation list**: Translation applies to prose-only content. The following are **never** translated:

- `code block` — all fenced and inline code
- `file path` — absolute and relative paths
- `CLI` — command-line tool names and commands
- `WI-N` — work-item identifiers (e.g. `WI-1`, `WI-2`)
- `AC#M` — acceptance criteria labels (e.g. `AC#1`)
- `S0-S8` — pipeline state identifiers
- `grep` — tool names used as identifiers in verification commands
- `drawn` / `trigger FALSE:` — coverage-table status literals

Translating any item is a rule violation.

**Invariant 3 — plan.md as single source-of-truth, render-time-only translation**: `plan.md` is the single SoT for plan content. No translated copy is written to disk; translation is render-time only. The presentation file is derived, non-authoritative — re-rendering always draws from unmodified `plan.md`.

**Fallback**: If language detection fails or yields an ambiguous result, render in original language. Do not block Stage A on detection failure.

### Readability Enrichment

`plan.md` is written in terse, executor-facing spec language. The presentation MAY add readability aids so the human reader can follow it — but only within the content-fidelity bound declared in Requirements.

**Allowed:**
- Rephrasing plan prose for natural reading flow in the communication language (per Translation Rule).
- Markdown blockquote callouts (`>`) that surface context the reader needs — drawn from the plan's own Context / interview-rationale / ADR sections. Use them to make an already-stated WHY easy to find, not to assert anything new.
- Mermaid diagrams that re-visualize flow or structure **already decided in `plan.md`** (e.g. a runtime control flow the plan describes only in prose across several TODOs). Governed by the lens taxonomy (each lens REQUIRED when its trigger FACT holds) and bound by the Stage A Fidelity Bounds. The lens taxonomy (6 lenses, trigger FACTs), type selection, guardrails, and the Why -> Diagram -> Interpretation presentation protocol live in `diagram-guide.md`. A ` ```mermaid ` fence written directly into the presentation markdown renders as a diagram in a Mermaid-aware markdown viewer. Before drawing, full-read `diagram-guide.md` first — the Reference Full-Read Mandate triggers on diagram insertion (any lens trigger FACT holds).

  **Render-source invariant (two tiers of render authority)**: Render authority is explicitly TWO tiers, and the two tiers source content differently.

  - **Tier 1 — decision-log-bound (the two log-rooted artifacts).** The derived Bird's-Eye View (the decision-log-derived ownership table + flow mermaid) AND the in-band decision-log mermaid are rooted IN the decision log; the decision log in plan.md is their single render authority. They re-visualize the decided D-items as recorded in plan.md — no diagram may introduce ownership or edges absent from the decided log. The bound is bidirectional: such a diagram also may not say LESS than the decided log within its scope — no erasing decided ownership by aggregation, no renaming decided components, no omitting the return edge of a drawn synchronous call. This strict log-binding is what guarantees these two artifacts invent nothing; do not weaken it.
  - **Tier 2 — the grouped Bird's-Eye lens diagrams (the 6-lens set).** Each may re-visualize content already decided in plan.md — whether that content is recorded as a structural D-item OR as decided plan prose. The no-invention bound still holds in full: the diagram still cannot draw an edge, ownership, or relationship the plan never decided, and still cannot be vaguer than the plan it visualizes. The only difference from Tier 1 is the source of a decided edge: a lens diagram may source a decided edge from plan prose, not only from a structural D-item. A triggered lens (REQUIRED when its trigger FACT holds — see `diagram-guide.md`) is therefore never forced to skip just because the plan carries no structural D-item; it sources from the decided prose instead.

  Authoring rules and the post-draw self-audit live in `diagram-guide.md`.

**Forbidden:**
- Introducing any fact, decision, scope, or rationale not already present in `plan.md`. Enrichment re-surfaces existing context; it does not author new context. If the plan genuinely lacks context the reader needs, that is a plan defect — fix the plan and re-run the pipeline, do not paper over it at render time.
- Omitting, weakening, or contradicting any plan content.
- Writing enrichment back to disk. Per Invariant 3 the callouts live only in the derived presentation file; `plan.md` stays the single source of truth and every re-render redraws from it.
- Drawing a diagram edge, arrow, or relationship that `plan.md` did not already decide. A diagram cannot be vaguer than the plan it visualizes — if you cannot draw it without inventing a who-calls-whom or ownership decision the plan never made, that is a plan defect: fix the plan and re-run the pipeline, do not invent the edge at render time.

Rationale: `plan.md` is the artifact the pipeline reviewed — Momus reviewed the finished plan at S4, and Daedalus reviewed its design-brief / ADR sections at S2 — and it is the artifact the executor runs from. Net-new content in the presentation file would be unreviewed and would split the presentation from the execution source of truth. Re-surfacing context that already lives in the plan carries no such risk.

---

## Stage B: Decision Matrix

Before asking the user to choose execution mode, compute a recommendation:

| Signal | Weight toward Complex/Architecture | Weight toward Trivial/Scoped |
|--------|------------------------------------|------------------------------|
| TODO ≥ 4 | Strong | — |
| Complex/Architecture flag in plan | Strong | — |
| Trivial/Scoped flag in plan | — | Strong |
| AC gap (unverified acceptance criteria) | Moderate | — |
| Ambiguity Score > 2 | Moderate | — |
| Daedalus surfaces a design-complexity concern (advisory) | Moderate | — |
| Momus COMMENT with codebase/feasibility concern | Moderate | — |
| Scope question unresolved | Moderate | — |

**Conflict resolution**: When signals split evenly, "Plan more wins" — default to Full Orchestration.

**Recommendation Output Template** (present before Stage C):

```
**Recommendation**: [Full orchestration | Focused execution]
**Execution mode**: [Complex/Architecture | Trivial/Scoped]
**Rationale**: [1–2 sentences citing the dominant signals from the Decision Matrix]
**What tips the balance**: [The single strongest signal that drove the recommendation]
```

---

## Stage C: Execution Bridge — Option Formatting

After the user reads Stage B's recommendation, present execution options via the platform's user-prompt primitive (structured choice):

**(1) Full orchestration**
Multi-agent task orchestration with QA verification. 3+ TODOs or cross-module changes.

**(2) Focused execution**
Single-pass implementation. 1-2 straightforward TODOs.

**(3) Revise plan**
Return to Interview Mode for modifications.

The `(Recommended)` label is **computed from the Decision Matrix, NOT hardcoded** — attach it to whichever option Stage B selected.

| User Response | Action |
|---------------|--------|
| Requests changes before selecting | Return to Interview Mode, re-run pipeline |

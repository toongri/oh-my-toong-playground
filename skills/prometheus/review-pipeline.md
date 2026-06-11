# Review Pipeline — Lookup

**This file is lookup-only.** The mandatory review-pipeline rules are defined inline in `SKILL.md > ## Review Pipeline (Mandatory Contract)`. The contract is authoritative.

Read this file when you are about to execute a SPECIFIC reviewer invocation, Stage A HTML render, Stage B Decision Matrix computation, or Stage C option presentation. Read the corresponding section in full at that moment.

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

## Stage A: HTML Render — Procedure

Convert `$OMT_DIR/plans/{name}.md` to a single-file HTML document and open it in the browser so the user can read the plan rendered.

**Requirements:**
- **Output artifact**: `$OMT_DIR/plans/presentation/{name}.html` — `{name}` is the same stem as the plan markdown (`{name}.md`), so each plan owns its own HTML file and concurrent or successive plans never overwrite a shared file. Create the `presentation/` directory if it does not yet exist. Single-file, self-contained, browser-openable.
- **Content fidelity (faithful, not verbatim)**: Render the plan faithfully — no plan content may be omitted, weakened, or contradicted. Within that bound, prose MAY be rewritten for readability (see Translation Rule) and MAY carry readability callouts (see Readability Enrichment). The rendered HTML is a presentation for the human reader, not a second source of truth.
- **Production**: render the plan into the canonical template — string substitution, no markdown-to-HTML converter needed (marked.js renders client-side at browser-open), so any tool works (awk, sed, bun, the Write tool). When the plan is approved, the HTML always gets made; output must meet the single-file + browser requirement.

### HTML Components

The Stage A HTML output is composed of 5 distinct components:

- **hero header** — plan title, meta pills (TODO count, AC count, wave label, plan file path), and stage kicker
- **Stage B** — execution recommendation box injected from session state (reviewer verdicts, recommendation output)
- **Pipeline State** — pipeline state journal box injected from session state (S0 → S_current transitions)
- **bird's-eye view** — ownership table + flow mermaid generated FROM the decided D-items in the plan's decision log. REQUIRED when the plan's decision log contains structural enumeration (Complex/Architecture flag). When every D-item in the log declares `Edges: none`, the component renders the ownership table only (the flow mermaid is omitted). Classified as plan-derived.
- **plan-content** — the full plan markdown rendered into `article#plan-content`; sourced faithfully from plan.md (readability rewrite + enrichment callouts allowed per Readability Enrichment — no omission, no contradiction, no invented facts)

### Source Classification

| Component | Source |
|---|---|
| hero header | plan-derived |
| Stage B | session-derived |
| Pipeline State | session-derived |
| bird's-eye view | plan-derived |
| article#plan-content | plan-derived |

`plan-derived` components populated from `$OMT_DIR/plans/{name}.md`. `session-derived` composed from session state (reviewer verdicts, pipeline state transitions) and injected via `<!-- SESSION-DERIVED-BOXES-HERE -->` marker.

### Template Reference

Canonical HTML shell at: `skills/prometheus/templates/plan-presentation.html`

Contains the static HTML structure with `{{placeholder}}` substitution variables, the `<!-- SESSION-DERIVED-BOXES-HERE -->` injection marker, and an embedded top-comment documenting all placeholders.

### Translation Rule

Three invariants govern language translation applied during Stage A rendering.

**Invariant 1 — Session auto-detect of conversational language**: The session detects the conversational language in use (the language the user is writing in during the current session). All prose content in HTML output is **rewritten in that detected communication language** so the reader can follow it naturally — a readability-oriented rewrite, not a word-for-word translation of the plan's source prose. No language is hard-coded; detection is render-time.

**Invariant 2 — Prose-only scope with preservation list**: Translation applies to prose-only content. The following are **never** translated:

- `code block` — all fenced and inline code
- `file path` — absolute and relative paths
- `CLI` — command-line tool names and commands
- `WI-N` — work-item identifiers (e.g. `WI-1`, `WI-2`)
- `AC#M` — acceptance criteria labels (e.g. `AC#1`)
- `S0-S8` — pipeline state identifiers
- `grep` — tool names used as identifiers in verification commands

Translating any item is a rule violation.

**Invariant 3 — plan.md as single source-of-truth, render-time-only translation**: `plan.md` is the single SoT for plan content. No translated copy (`plan.{lang}.md`) is written to disk; translation is render-time only. HTML is ephemeral — re-rendering always draws from unmodified `plan.md`.

**Fallback**: If language detection fails or yields an ambiguous result, render in original language. Do not block Stage A on detection failure.

### Readability Enrichment

`plan.md` is written in terse, executor-facing spec language. The HTML presentation MAY add readability aids so the human reader can follow it — but only within the content-fidelity bound declared in Requirements.

**Allowed:**
- Rephrasing plan prose for natural reading flow in the communication language (per Translation Rule).
- Markdown blockquote callouts (`>`) that surface context the reader needs — drawn from the plan's own Context / interview-rationale / ADR sections. Use them to make an already-stated WHY easy to find, not to assert anything new.
- Mermaid diagrams that re-visualize flow or structure **already decided in `plan.md`** (e.g. a runtime control flow the plan describes only in prose across several TODOs). Gated by the Necessity Test and bound by the Stage A Fidelity Bounds. Type selection (Sequence / Class / State / Flowchart), guardrails, and the Why -> Diagram -> Interpretation presentation protocol live in `diagram-guide.md`. The template loads the Mermaid runtime, so a ` ```mermaid ` fence injected into the render-time markdown renders as a diagram. Before drawing, full-read `diagram-guide.md` first — the Reference Full-Read Mandate triggers on diagram insertion (Necessity Test = YES).

  **Render-source invariant**: The derived bird's-eye view and any in-band mermaid diagram re-visualize the decided D-items as recorded in plan.md — the decision log in plan.md is the single render authority; no diagram may introduce ownership or edges absent from the decided log.

**Forbidden:**
- Introducing any fact, decision, scope, or rationale not already present in `plan.md`. Enrichment re-surfaces existing context; it does not author new context. If the plan genuinely lacks context the reader needs, that is a plan defect — fix the plan and re-run the pipeline, do not paper over it at render time.
- Omitting, weakening, or contradicting any plan content.
- Writing enrichment back to disk. Per Invariant 3 the callouts live only in the ephemeral HTML; `plan.md` stays the single source of truth and every re-render redraws from it.
- Drawing a diagram edge, arrow, or relationship that `plan.md` did not already decide. A diagram cannot be vaguer than the plan it visualizes — if you cannot draw it without inventing a who-calls-whom or ownership decision the plan never made, that is a plan defect: fix the plan and re-run the pipeline, do not invent the edge at render time.

Rationale: `plan.md` is the artifact the pipeline reviewed — Momus reviewed the finished plan at S4, and Daedalus reviewed its design-brief / ADR sections at S2 — and it is the artifact the executor runs from. Net-new content in the HTML would be unreviewed and would split the presentation from the execution source of truth. Re-surfacing context that already lives in the plan carries no such risk.

### Rendering Methodology

Six invariants govern substitution and injection during Stage A rendering.

**Rule 1 — Active-element-only substitution**: `{{…}}` placeholders are substituted only at their active template elements. For `{{PLAN_MARKDOWN_JSON}}`, the active container is the `script type="application/json" id="plan-md"` element; substitution occurs only at that active element line. Literal occurrences inside the top-comment documentation block are NOT substituted. Replacement patterns must be anchored to the specific enclosing element by its opening-tag signature, not to the raw placeholder token alone.

**Rule 2 — Multi-occurrence guard**: When a placeholder token appears in both documentation and an active element, the substitution engine MUST skip the documentation occurrence. Preferred: element-line regex anchored on active element. **Alternatives**: first-match-only with active-element anchor; pre-pass element extraction.

**Multi-active-occurrence semantics**: If a placeholder legitimately appears across multiple active elements (e.g., `{{TOC_TITLE}}` in both navigation header and footer), substitution applies to ALL active occurrences — only documentation/top-comment literals are excluded. This prevents a future-analogous bug where first-match-only logic silently drops a second occurrence of a legitimate active placeholder.

**Rule 3 — Session-derived box injection sequence**: The `<!-- SESSION-DERIVED-BOXES-HERE … -->` comment block is replaced with exactly two `.section-box` elements in this exact order: (a) Stage B · Execution Recommendation, (b) Pipeline State. The entire comment block (from `<!-- SESSION-DERIVED-BOXES-HERE` to terminating `-->`) is removed; the 2 boxes replace it verbatim in order.

**Rule 4 — Error recovery / fallback**: If any placeholder is not found in the template, the rendering engine retains the original element untouched — no silent HTML destruction. If translation detection fails per the Translation Rule, fallback to original language.

**Rule 5 — Tool-agnostic**: Substitution engine is the implementer's choice (awk, sed, Node, Python, Bun script, etc.). Rendering Methodology declares invariants, not implementation. Any tool satisfying the six rules is acceptable.

**Rule 6 — Parser-resilient container embedding**: The HTML element holding plan markdown content (`{{PLAN_MARKDOWN_JSON}}` container) MUST satisfy:

- **(6a) Inert container**: Element whose content the HTML parser treats as text — non-executable, inert. Canonical: `script type="application/json"` (HTML5 non-executable-type). Alternative inert container: `textarea hidden`.

- **(6b) Content-side close-tag escape**: The injection pipeline MUST escape the container's close-tag sequence so plan prose cannot terminate the container prematurely. Canonical pattern:
  ```js
  const payload = JSON.stringify(planMarkdown).replace(/<\/script>/g, '<\\/script>');
  // consumer: JSON.parse(container.textContent)
  ```

`script type="text/markdown"` MUST NOT be used — unencoded markdown without close-tag escape fails (6b).

Both (6a) and (6b) MUST be present regardless of container choice; alternative inert containers MUST supply their own paired close-tag escape.

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

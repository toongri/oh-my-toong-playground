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
- **bird's-eye view** — the System topology section, governed by these sub-rules (each independently editable):
  - **Source authority**: the ownership table + flow mermaid are generated FROM the decided D-items in the plan's decision log. The decision log is the single render authority — no node, edge, or ownership absent from the decided log.
  - **Existence / trigger**: the System topology diagram is REQUIRED when the plan has >= 2 components — a single existence trigger, not a discretionary diagram test. This is the same fact `diagram-guide.md` states for the System topology lens.
  - **Content source**: existence and content source are distinct. The richest form — the decision-log-derived ownership table plus flow mermaid — is sourced from structural enumeration (Complex/Architecture flag). When the plan has >= 2 components but carries NO structural enumeration (e.g. a Scoped plan), the System topology diagram still exists, drawn from the plan-decided component interactions, while the decision-log ownership table is omitted.
  - **Edges: none**: when every structural (solo) D-item in the log declares `Edges: none` — contested items carry no Edges field and are excluded from this check — the component renders the ownership table only (the flow mermaid is omitted).
  - **Gating exemption**: `diagram-guide.md` governs type selection, guardrails, and presentation for all diagrams including this one, but does not gate its existence — existence is the ">= 2 components" trigger above.
  - **In-band render mechanism**: rendered in-band — the renderer prepends a generated `## Bird's-Eye View` section (ownership table + ` ```mermaid ` fence if edges exist) to the render-time markdown before JSON-encoding into `article#plan-content`. Classified as plan-derived.
  - **Single gathering point + ordering**: the Bird's-Eye section is the single gathering point for ALL diagrams. Every triggered lens diagram (REQUIRED when its trigger FACT holds — see diagram-guide.md) renders here immediately after the ownership table + flow mermaid, ordered macro → micro (System topology / Module-API → User-Actor / Domain state → Domain-Service object / Business logic), each with its own Why → Diagram → Interpretation — never scattered through the plan body.
  - **Empty-section edge case**: when the plan generates no decision-log ownership table (no structural enumeration) but other lens triggers hold, the renderer still creates the section to host them — the decision-log-derived ownership table and flow mermaid are simply omitted.
- **review digest** — a generated `## Review Digest` section prepended before the plan body: immediately after the Bird's-Eye View when that section is generated, otherwise first in the render-time markdown. Contains the plan's acceptance criteria, each paired with its verification method (command / check) re-surfaced verbatim from the plan's AC and Verification sections. This is the collaborator's primary review surface — what will be true and how it is proven. Re-surfacing only; no new facts. Classified as plan-derived.
- **plan-content** — the full plan markdown rendered into `article#plan-content`; sourced faithfully from plan.md (readability rewrite + enrichment callouts allowed per Readability Enrichment — no omission, no contradiction, no invented facts). **Reading order serves the design reviewer**: execution-detail sections (the TODO breakdown) are wrapped in collapsed `<details><summary>` blocks in the render-time markdown (marked passes raw HTML through) so design-review content leads and execution detail is opt-in reading — collapse, never omit: content fidelity still requires the full plan present.

### Source Classification

| Component | Source |
|---|---|
| hero header | plan-derived |
| Stage B | session-derived |
| Pipeline State | session-derived |
| bird's-eye view | plan-derived |
| review digest | plan-derived |
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
- Mermaid diagrams that re-visualize flow or structure **already decided in `plan.md`** (e.g. a runtime control flow the plan describes only in prose across several TODOs). Governed by the lens taxonomy (each lens REQUIRED when its trigger FACT holds) and bound by the Stage A Fidelity Bounds. The lens taxonomy (6 lenses, trigger FACTs), type selection, guardrails, and the Why -> Diagram -> Interpretation presentation protocol live in `diagram-guide.md`. The template loads the Mermaid runtime, so a ` ```mermaid ` fence injected into the render-time markdown renders as a diagram. Before drawing, full-read `diagram-guide.md` first — the Reference Full-Read Mandate triggers on diagram insertion (any lens trigger FACT holds).

  **Render-source invariant**: The derived bird's-eye view and any in-band mermaid diagram re-visualize the decided D-items as recorded in plan.md — the decision log in plan.md is the single render authority; no diagram may introduce ownership or edges absent from the decided log. The bound is bidirectional: a diagram also may not say LESS than the decided log within its scope — no erasing decided ownership by aggregation, no renaming decided components, no omitting the return edge of a drawn synchronous call. Authoring rules and the post-draw self-audit live in `diagram-guide.md`.

**Forbidden:**
- Introducing any fact, decision, scope, or rationale not already present in `plan.md`. Enrichment re-surfaces existing context; it does not author new context. If the plan genuinely lacks context the reader needs, that is a plan defect — fix the plan and re-run the pipeline, do not paper over it at render time.
- Omitting, weakening, or contradicting any plan content.
- Writing enrichment back to disk. Per Invariant 3 the callouts live only in the ephemeral HTML; `plan.md` stays the single source of truth and every re-render redraws from it.
- Drawing a diagram edge, arrow, or relationship that `plan.md` did not already decide. A diagram cannot be vaguer than the plan it visualizes — if you cannot draw it without inventing a who-calls-whom or ownership decision the plan never made, that is a plan defect: fix the plan and re-run the pipeline, do not invent the edge at render time.

Rationale: `plan.md` is the artifact the pipeline reviewed — Momus reviewed the finished plan at S4, and Daedalus reviewed its design-brief / ADR sections at S2 — and it is the artifact the executor runs from. Net-new content in the HTML would be unreviewed and would split the presentation from the execution source of truth. Re-surfacing context that already lives in the plan carries no such risk.

### Rendering Methodology

Seven invariants govern substitution and injection during Stage A rendering.

**Rule 1 — Active-element-only substitution**: `{{…}}` placeholders are substituted only at their active template elements. For `{{PLAN_MARKDOWN_JSON}}`, the active container is the `script type="application/json" id="plan-md"` element; substitution occurs only at that active element line. Literal occurrences inside the top-comment documentation block are NOT substituted. Replacement patterns must be anchored to the specific enclosing element by its opening-tag signature, not to the raw placeholder token alone.

**Rule 2 — Multi-occurrence guard**: When a placeholder token appears in both documentation and an active element, the substitution engine MUST skip the documentation occurrence. Preferred: element-line regex anchored on active element. **Alternatives**: first-match-only with active-element anchor; pre-pass element extraction.

**Multi-active-occurrence semantics**: If a placeholder legitimately appears across multiple active elements (e.g., `{{TOC_TITLE}}` in both navigation header and footer), substitution applies to ALL active occurrences — only documentation/top-comment literals are excluded. This prevents a future-analogous bug where first-match-only logic silently drops a second occurrence of a legitimate active placeholder.

**Rule 3 — Session-derived box injection sequence**: The `<!-- SESSION-DERIVED-BOXES-HERE … -->` comment block is replaced with exactly two `.section-box` elements in this exact order: (a) Stage B · Execution Recommendation, (b) Pipeline State. The entire comment block (from `<!-- SESSION-DERIVED-BOXES-HERE` to terminating `-->`) is removed; the 2 boxes replace it verbatim in order.

**Rule 4 — Error recovery / fallback**: If any placeholder is not found in the template, the rendering engine retains the original element untouched — no silent HTML destruction. If translation detection fails per the Translation Rule, fallback to original language.

**Rule 5 — Tool-agnostic**: Substitution engine is the implementer's choice (awk, sed, Node, Python, Bun script, etc.). Rendering Methodology declares invariants, not implementation. Any tool satisfying the seven rules is acceptable.

**Rule 6 — Parser-resilient container embedding**: The HTML element holding plan markdown content (`{{PLAN_MARKDOWN_JSON}}` container) MUST satisfy:

- **(6a) Inert container**: Element whose content the HTML parser treats as text — non-executable, inert. Canonical: `script type="application/json"` (HTML5 non-executable-type). Alternative inert container: `textarea hidden`.

- **(6b) Content-side close-tag escape**: The injection pipeline MUST escape the container's close-tag sequence so plan prose cannot terminate the container prematurely. Canonical pattern:
  ```js
  const payload = JSON.stringify(planMarkdown).replace(/<\/(script)([\s/>])/gi, '<\\/$1$2');
  // consumer: JSON.parse(container.textContent)
  ```

`script type="text/markdown"` MUST NOT be used — unencoded markdown without close-tag escape fails (6b).

Both (6a) and (6b) MUST be present regardless of container choice; alternative inert containers MUST supply their own paired close-tag escape.

**Rule 7 — Active-placeholder HTML escape**: Every `{{…}}` placeholder substituted into an active HTML position — `{{HTML_TITLE}}`, `{{STAGE_KICKER}}`, `{{PLAN_TITLE}}`, `{{TODO_COUNT}}`, `{{AC_COUNT}}`, `{{WAVE_COUNT_LABEL}}`, `{{PLAN_FILE_LABEL}}`, `{{PLAN_FILE_PATH}}`, `{{TOC_TITLE}}`, `{{FOOTER_NOTE}}` — MUST be HTML-escaped (`&`, `<`, `>`, `"`, `'`) before substitution. A plan title, label, or path carrying an HTML-significant character would otherwise inject live markup into `<title>`, `<h1>`, etc. `{{PLAN_MARKDOWN_JSON}}` is exempt — it lives in the inert JSON container and is governed by Rule 6 (the 6b close-tag escape) instead. `{{LANG_CODE}}` must be a plain BCP-47 tag (e.g. `ko`, `en`), not free text.

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

# Review Pipeline — Lookup

**This file is lookup-only.** All workflow-wide rules (Common Gate Pattern, Verdict Handling, Revise definition, Verdict/Reviewer Freshness Rules, Pipeline State Machine, Loop Termination, Self-Review Checklist, Gap Classification, Plan Presentation mandate, Anti-Patterns) are defined inline in `SKILL.md > ## Review Pipeline (Mandatory Contract)`. The contract is authoritative.

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

## Oracle Invocation Template

**When**: After plan generated to `$OMT_DIR/plans/{name}.md`. MANDATORY before Momus.

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

---

## Momus Invocation Template

**When**: After Oracle APPROVE/COMMENT. MANDATORY before user presentation.

Send the plan file path only:

```
$OMT_DIR/plans/{name}.md
```

All context (interview summary) is already in the plan's Context section. No supplementary prompt needed.

---

## Stage A: HTML Render — Procedure

Convert `$OMT_DIR/plans/{name}.md` to a single-file HTML document and open it in the browser so the user can read the plan rendered.

**Requirements:**
- **Output artifact**: `$OMT_DIR/plans/plan.html` (single-file, self-contained, browser-openable)
- **Content**: verbatim — no summarization, no paraphrasing, no omission (요약·각색 금지)
- **Tool choice**: execution-time choice — use whatever is available at runtime (Pandoc, a script, inline generation). Tool is an implementation detail; output must meet the single-file + browser requirement regardless.
- **Graceful fallback**: If HTML conversion fails, present raw Markdown directly and continue to Stage B.

### HTML Components

The Stage A HTML output is composed of 4 distinct components:

- **hero header** — plan title, meta pills (TODO count, AC count, wave label, plan file path), and stage kicker
- **Stage B** — execution recommendation box injected from session state (reviewer verdicts, recommendation output)
- **Pipeline State** — pipeline state journal box injected from session state (S0 → S_current transitions)
- **plan-content** — the full plan markdown rendered into `article#plan-content`; sourced verbatim from plan.md

### Source Classification

| Component | Source |
|---|---|
| hero header | plan-derived |
| Stage B | session-derived |
| Pipeline State | session-derived |
| article#plan-content | plan-derived |

`plan-derived` components populated from `$OMT_DIR/plans/{name}.md`. `session-derived` composed from session state (reviewer verdicts, pipeline state transitions) and injected via `<!-- SESSION-DERIVED-BOXES-HERE -->` marker.

### Template Reference

Canonical HTML shell at: `skills/prometheus/templates/plan-presentation.html`

Contains the static HTML structure with `{{placeholder}}` substitution variables, the `<!-- SESSION-DERIVED-BOXES-HERE -->` injection marker, and an embedded top-comment documenting all placeholders.

### Translation Rule

Three invariants govern language translation applied during Stage A rendering.

**Invariant 1 — Session auto-detect of conversational language**: The session detects the conversational language in use (the language the user is writing in during the current session). All prose content in HTML output is rendered in that detected language. No language is hard-coded; detection is render-time.

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
| Oracle COMMENT with codebase concern | Moderate | — |
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

> This section is **option-formatting only**. Post-selection dispatch actions (which skill to invoke when the user selects Option 1/2/3) are defined inline in `SKILL.md > ## Review Pipeline > Plan Presentation` — do NOT look here for that.

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

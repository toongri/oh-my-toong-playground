# Review Pipeline

**This file is a mandatory full read at its trigger.** The review rules are defined in `SKILL.md > ## Review Pipeline (Mandatory Contract)`; this file adds the procedures and templates. SKILL.md prevails.

Read this whole file in one Read call before the first reviewer invocation, Stage A presentation render, Stage B signal-table computation, or Stage C option presentation.

---

## Metis Invocation Template (3-Section)

**When**: Clearance all YES + AC confirmed by user. Auto-invoke — do NOT wait for user to say "generate plan."

```markdown
## 1. USER GOAL
- **Original Request**: [verbatim or faithful paraphrase]
- **Core Objective**: [distilled from interview]

## 2. SCOPE
- **IN Scope**: [what will be built]
- **OUT of Scope**: paste the same verbatim canonical lines from `Prometheus state.non_goals`, including the leading `-`; this value was persisted after the user confirmed the AC and non-goals and before Metis. S3 plan generation later copies the same stored value into the plan's `## Work Objectives > ### Non-Goals` section.

## 3. ACCEPTANCE CRITERIA
[Confirmed AC in full — paste verbatim. No summarizing.]
```

**≥1 OUT-of-scope item is REQUIRED.** Metis runs only for Scoped+ intent, and any bounded work excludes something; a brief that reaches Metis with an empty `OUT of Scope` list has not drawn its boundary. Risk-domain non-goals the user deliberately excludes (`SKILL.md > ### Risk-Domain Assessment`) belong here. The gate in `agents/metis.md` (B2) rejects an empty OUT-of-scope list with REQUEST_CHANGES.

Each `OUT of Scope` item must carry a decider — `- {excluded item} | decider: {membership test}` — so a reviewer can tell whether a candidate finding falls inside it. Read the canonical lines verbatim from `state.non_goals`; do not derive them from a transient brief or the later S3 plan. S3 plan generation copies this same stored value verbatim. An exclusion without a decider has no edge to any finding, so it does nothing. The gate in `agents/metis.md` (B3) rejects an undecidered exclusion with REQUEST_CHANGES; this template fixes the format that gate checks.

**On Metis REQUEST_CHANGES**: Return to Interview Mode — and ask the user first. Metis rejection means requirements are incomplete — do NOT guess or hallucinate missing requirements to pass the gate. Before re-invoking Metis, ask the user to clarify the gaps Metis identified via the normal Interview question channel, and apply the answer and the resulting revision. Only then re-invoke Metis with the same 3-Section structure containing updated content. This loop is bounded by the Metis round cap (2 rounds) owned by prometheus (`SKILL.md > ### State Lifecycle Directives`); metis stays round-unaware.

**On nonempty Questions for User (any verdict)**: route the questions to the user via the normal Interview question channel and apply the answers before advancing — an APPROVE/COMMENT verdict does not waive them. Recording the answers does not expire the verdict; no re-review is required for answer recording alone.

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

## Stage A: Presentation Render — Procedure

Author `$OMT_DIR/plans/presentation/{name}.html` directly from `$OMT_DIR/plans/{name}.md`, so the plan can be read in a navigable, portable form. Before writing, read `${CLAUDE_SKILL_DIR}/../html-report/SKILL.md` (the shared HTML report guide) and follow it. It owns the page form: layout, theme, typography, inline SVG diagram mechanics, and the capture-and-lint self-critique loop. This file keeps only the Prometheus content rules: the reader, the required content, the section order, the fidelity checks, the diagram lenses, and the submission.

**Purpose & perspective.** Write this presentation in the first person of the implementer explaining the plan they authored — the problem they scoped, the design they chose, and the decisions they made — to **a colleague or team-lead with no prior context on this work**. The bar: from this page alone, that reader richly and correctly understands what the plan does, why it is designed this way, and what they must be aware of when they next modify this code. Keep the explanation clear and accessible — plain language, domain terms glossed on first use, big-picture diagrams (the ELI5 spirit of "explain it simply") — but never dumb it down or thin it out. This is not a simplified overview: the plan's full design content and every triggered diagram (see Bird's-Eye View and Diagram Content Rules) are carried across at full fidelity — accessible AND rich, rich explanation alongside the diagrams welcome, never a word-count ceiling.

**쓰기 전에 소개 (introduce before you use).** The reader has no prior context, so **every first-class entity the presentation leans on earns a plain-language introduction at its first appearance** — before the sentence, table, or diagram uses it. A name the reader cannot decode from the page is a hole in the explanation, however faithful the render is to the plan. This is the first-occurrence form of the Purpose bar above; size the introduction to what the entity is:

| 첫 등장하는 것 | 소개 깊이 |
|---|---|
| 용어·약어·코인된 표현 (도메인 단어, 상태 라벨) | 한 줄 뜻 — inline gloss on first use |
| 함수·리포지토리·메서드·컴포넌트 | 한 줄 역할 — what it does, not just its name |
| 모듈·도메인 (Boundary Map의 소유 경계) | 경계 + 소유 한두 줄 — what it owns and where it sits |
| 기능(유스케이스 / horizontal use-case) | 무엇을 위한 능력인지 한 문단 |

For a diagram's code-name node/message not already introduced in the plan-body prose, add a
`<ul class="gloss">` "이 그림의 요소" footnote directly under the diagram's `<figure>` (the page styles it),
one `<li><code>요소명</code> — 평이한 뜻</li>` per code-name element drawn; a node already carrying a
plain-language name needs none. This is re-surfacing plan-decided meaning, never new authorship — the
no-invention Fidelity Bounds still hold.

**Requirements:**
- **Output path**: `$OMT_DIR/plans/presentation/{name}.html` — use the plan's stem and create `presentation/` if absent. The model writes this one HTML file directly; there is no intermediate Markdown file and no renderer script.
- **Content fidelity (faithful, not verbatim)**: Render the plan faithfully — no plan content may be omitted, weakened, or contradicted. Within that bound, prose MAY be rewritten for readability (see Translation Rule) and MAY carry readability callouts (see Readability Enrichment). The rendered presentation is for the human reader, not a second source of truth.
  - **Render the chosen Decision, never a reversed one.** A contested D-item records both its chosen **Decision** and the alternatives it rejected — and a plan that reversed a proposal mid-design keeps the superseded form on the page as the named reject ("Invalidated alternative: nest it inside `X` — rejected"; "this reverses an initial X proposal"). The presentation states and cites each decision from its **Decision** field ONLY. Surfacing the rejected/invalidated/reversed alternative — in prose, an ADR restatement, a field placement, or a cited `file:line` — as the chosen design is a contradiction of the plan, the exact defect that makes a reader implement the design the plan threw away. When a decision was reversed, the final form is the only one that may appear as chosen; scan every design claim against the plan's Decision field before rendering.
- **Voice**: the first-person implementer voice of the Purpose paragraph above is a Prometheus content rule, and it outranks the html-report no-author-voice rule (`lint.sh` may print `author-first-person` warnings for it; those warnings are accepted, errors are not). Every other html-report fidelity rule stays: no invented number, status, owner, or date, and no writing date on the page.
- **Production**: write the HTML directly, following the Presentation Section Order below. No template, no format converter, no placeholder-substitution engine. Do not call any renderer script.
- **Self-critique loop and submission (required before submit)**: run the html-report loop from its section 14 on the finished page, with the plan as the source:
  ```bash
  OUT=$OMT_DIR/plans/presentation/.visual-check/round-1
  bash ${CLAUDE_SKILL_DIR}/../html-report/scripts/capture.sh $OMT_DIR/plans/presentation/{name}.html "$OUT"
  bash ${CLAUDE_SKILL_DIR}/../html-report/scripts/lint.sh $OMT_DIR/plans/presentation/{name}.html --source $OMT_DIR/plans/{name}.md --strict --receipt "$OUT/receipt.json" > "$OUT/lint.json"
  ```
  Look at every captured frame and fix. Then follow html-report section 14 to choose the next check (a new round or a lint-only rerun) and to decide when to stop. Set `OUT` to the latest round directory and submit the HTML with the receipt from there. `lint.sh` writes the receipt only on a run with 0 errors. The submission refuses unless the receipt matches the current HTML bytes and was linted with `--source` this plan, so re-run `lint.sh` after every HTML edit. Repeat the loop and the submission after every plan or HTML revision:
  ```bash
  bun ${CLAUDE_SKILL_DIR}/scripts/prometheus-state.ts set --phase S5 --submit-presentation "$OMT_DIR/plans/presentation/{name}.html" --receipt "$OUT/receipt.json"
  ```
- **Presentation review (required, after render/submit, before Stage C and `prometheus-done`)**: dispatch the `presentation-reviewer` agent to contrast the presentation against the plan it was rendered from, for its reader. It is skill-agnostic, so assemble the bundle:
  - **presentation**: the presentation `.html`.
  - **sources**: the durable plan `plan.md` (the SSOT the presentation re-surfaces — its decision log, AC, verification, boundary map), plus the **Stage B recommendation and Pipeline State session-state artifacts** that produced the two session-derived boxes (reviewer verdict records, the Stage B signal/recommendation record, and the pipeline-state journal). These come from the conversation record plus `prometheus-state.ts get` output; the state CLI has no Stage B field. Do not copy those artifacts into `plan.md`; it remains the plan SSOT.
  - **reader_persona**: "a colleague or team-lead with no prior context on this work — understands what the plan does, why it is designed this way, and what to watch, from this page alone".
  Its verdict is `APPROVE` / `COMMENT` / `REQUEST_CHANGES` / `INCONCLUSIVE`. `APPROVE/COMMENT` may proceed. `REQUEST_CHANGES` requires repairs and re-reviews: repair the presentation or its source bundle, re-run the html-report loop, re-submit, and re-review. `INCONCLUSIVE` or a missing/malformed verdict blocks completion until the reviewer input bundle is repaired and a valid result is returned. This is a required review step, not a new gate; run it every time. It never rewrites `plan.md` — a fidelity finding means the presentation drifted from the plan (Fidelity Bounds), so fix the presentation, not the plan.

### Presentation Components

The Stage A presentation page is composed of 6 distinct components (the second bullet carries two boxes):

- **H1 + meta table** — plan title as the page `<h1>`, followed by a meta table (plan file path, TODO count, AC count, Wave — the distinct `Wave:` values the plan's TODOs use, e.g. `1, 2, FINAL`)
- **Stage B + Pipeline State** — two callout boxes authored from session state, in this order: (a) Stage B · Execution Recommendation (reviewer verdicts, and the recommendation computed under Stage B before this render), (b) Pipeline State (S0 → S_current transitions as of the render at S5, so it does not show later phases)
- **Bird's-Eye View** — the `## Bird's-Eye View` section, governed by these sub-rules (each independently editable):
  - **Source authority**: the ownership table + flow diagram are generated FROM the decided D-items in the plan's decision log. The decision log is the single render authority — no node, edge, or ownership absent from the decided log.
  - **Existence / trigger**: the System topology diagram is REQUIRED when the plan has >= 2 components — a single existence trigger, not a discretionary diagram test. This is the same fact the Diagram Content Rules below state for the System topology lens.
  - **Content source**: existence and content source are distinct (the general Tier-2 rule — see the Render-source invariant under Readability Enrichment). A triggered lens diagram sources from content decided in plan.md, whether that content is a structural D-item OR decided plan prose. For System topology specifically: the Tier-1 richest form — the decision-log-derived ownership table plus its flow diagram — is sourced from structural enumeration (Complex/Architecture flag). When the plan has >= 2 components but carries NO structural enumeration (e.g. a Scoped plan), the System topology diagram still exists, drawn from the plan-decided component interactions, while the decision-log ownership table is omitted.
  - **Edges: none**: when every structural (solo) D-item in the log declares `Edges: none` — contested items carry no Edges field and are excluded from this check — the section renders the ownership table only (the flow diagram is omitted).
  - **Gating exemption**: the Diagram Content Rules below govern lens selection, guardrails, and presentation for all diagrams including this one, but do not gate its existence — existence is the ">= 2 components" trigger above.
  - **Coverage table + rendering order**: the section opens with a 6-row coverage table, one row per lens, canonical header `| Lens | Trigger FACT | Status |`, each row's Status either `drawn (N)`, where N is that lens's diagram count, or `trigger FALSE: <reason>` — silence is not allowed, every lens row must resolve to one of the two. The N values of all `drawn` rows sum to the number of `<figure>` elements that contain an `<svg>` in the presentation HTML; every such figure counts under the one lens it depicts, and the decision-log flow diagram counts in the System topology row (see Coverage Table under Diagram Content Rules). Below the table, every lens whose trigger FACT holds is rendered in full, ordered macro → micro (System topology / Module-API → User-Actor / Domain state → Domain-Service object / Business logic), each with its own Why → Diagram → Interpretation — never scattered through the plan body. Every `<figure>` with an `<svg>` in the presentation lives inside this section, the decision-log flow diagram included.
  - **Empty-section edge case**: when the plan carries no structural enumeration, the decision-log-derived ownership table is omitted — but this does NOT flip the System topology row to `trigger FALSE`. Once `>= 2 components` holds, that lens's diagram still exists, drawn from the plan-decided component interactions (the Content source rule above), so its coverage-table row reads `drawn`. `trigger FALSE: <reason>` is reserved for a lens whose own trigger FACT is genuinely false — never for a triggered lens that merely lost its structural (decision-log) source. The section is still authored to host whatever other lens triggers hold.
- **Review Digest** — a `## Review Digest` section, immediately after the Bird's-Eye View when that section is generated, otherwise immediately after the Pipeline State box. Contains the plan's acceptance criteria, each paired with its verification method (command / check) re-surfaced from the plan's AC and Verification sections: verification commands, file paths, identifiers and AC numbers stay verbatim, AC prose is rendered in the session language without changing its meaning. This is the collaborator's primary review surface — what will be true and how it is proven. Re-surfacing only; no new facts.
- **plan body** — the full plan markdown rewritten for readability into the presentation page; sourced faithfully from plan.md (readability rewrite + enrichment callouts allowed per Readability Enrichment — no omission, no contradiction, no invented facts). **Reading order serves the design reviewer**: execution-detail sections (the TODO breakdown) are wrapped in collapsed `<details><summary>` blocks so design-review content leads and execution detail is opt-in reading — collapse, never omit: content fidelity still requires the full plan present.

### Presentation Section Order

The presentation page is authored in exactly this order, top to bottom:

1. **H1 + meta table** — the plan title as an H1, followed by the meta table (plan file path, TODO count, AC count, Wave).
2. **Stage B · Execution Recommendation box** — a callout surfacing the reviewer verdicts and the recommendation already computed under Stage B (computed before this render, because this box carries it).
3. **Pipeline State box** — a callout surfacing the S0 → S_current pipeline-state journal from session state as of the render (S5), so it does not show later phases, immediately after the Execution Recommendation box.
4. **Bird's-Eye View** — the `## Bird's-Eye View` section (coverage table + triggered lens diagrams), generated when ANY lens trigger holds (see Lens Taxonomy under Diagram Content Rules) — NOT only the System topology `>= 2 components` trigger. A single-component plan that triggers Domain state or Business logic still generates the section to host that diagram and its coverage-table row; `>= 2 components` gates only the System topology row inside the table, never the section's existence.
5. **Review Digest** — the `## Review Digest` section (AC paired with verification method), immediately after Bird's-Eye View when generated, otherwise immediately after the Pipeline State box.
6. **plan body** — the full plan markdown, rewritten for readability, with the TODO breakdown wrapped in collapsed `<details><summary>` blocks so execution detail is opt-in reading. **Every plan TODO id (`3`, `F1`, as written in `- [ ] 3.` / `- [ ] F1.` under `## TODOs`) must appear on the page as an attribute `data-todo="<id>"`** on that TODO's element (for example `<details data-todo="3">`). The submission refuses and lists the ids whose anchor is missing.

Every `<figure>` containing an `<svg>` lives inside the Bird's-Eye View section — figure-locality is absolute, no diagram is drawn anywhere else in the document, the decision-log flow diagram included.

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
- work item numbers — the plan's `TODO 1`, `TODO 2` labels
- acceptance criterion numbers — as the plan numbers them
- `S0-S8` — pipeline state identifiers
- `grep` — tool names used as identifiers in verification commands
- `drawn` / `trigger FALSE:` — coverage-table status literals
- `| Lens | Trigger FACT | Status |` — coverage-table header literal

Translating any item is a rule violation.

**Invariant 3 — plan.md as single source-of-truth, render-time-only translation**: `plan.md` is the single SoT for plan content. No translated copy is written to disk; translation is render-time only. The presentation file is derived, non-authoritative — re-rendering always draws from unmodified `plan.md`.

**Fallback**: If language detection fails or yields an ambiguous result, render in original language. Do not block Stage A on detection failure.

### Readability Enrichment

`plan.md` is written in terse, executor-facing spec language. The presentation MAY add readability aids so the human reader can follow it — but only within the content-fidelity bound declared in Requirements.

**Allowed:**
- Rephrasing plan prose for natural reading flow in the communication language (per Translation Rule).
- Callout boxes that surface context the reader needs — drawn from the plan's own Context / interview-rationale / ADR sections. Use them to make an already-stated WHY easy to find, not to assert anything new.
- Inline SVG diagrams (drawn per the html-report guide) that re-visualize flow or structure **already decided in `plan.md`** (e.g. a runtime control flow the plan describes only in prose across several TODOs). Governed by the lens taxonomy (each lens REQUIRED when its trigger FACT holds) and bound by the Stage A Fidelity Bounds. The lens taxonomy (6 lenses, trigger FACTs), guardrails, and the Why -> Diagram -> Interpretation presentation protocol live in Diagram Content Rules below. Before drawing, read that section and the diagram-recipe for each type in html-report (`${CLAUDE_SKILL_DIR}/../html-report/references/diagram-recipes.md`).

  **Render-source invariant (two tiers of render authority)**: Render authority is explicitly TWO tiers, and the two tiers source content differently.

  - **Tier 1 — decision-log-bound (the two log-rooted artifacts).** The derived Bird's-Eye View (the decision-log-derived ownership table + flow diagram) AND the decision-log diagram (which lives inside the Bird's-Eye View section) are rooted IN the decision log; the decision log in plan.md is their single render authority. They re-visualize the decided D-items as recorded in plan.md — no diagram may introduce ownership or edges absent from the decided log. The bound is bidirectional: such a diagram also may not say LESS than the decided log within its scope — no erasing decided ownership by aggregation, no renaming decided components, no omitting the return edge of a drawn synchronous call. This strict log-binding is what guarantees these two artifacts invent nothing; do not weaken it.
  - **Tier 2 — the grouped Bird's-Eye lens diagrams (the 6-lens set).** Each may re-visualize content already decided in plan.md — whether that content is recorded as a structural D-item OR as decided plan prose. The no-invention bound still holds in full: the diagram still cannot draw an edge, ownership, or relationship the plan never decided, and still cannot be vaguer than the plan it visualizes. The only difference from Tier 1 is the source of a decided edge: a lens diagram may source a decided edge from plan prose, not only from a structural D-item. A triggered lens (REQUIRED when its trigger FACT holds — see Diagram Content Rules) is therefore never forced to skip just because the plan carries no structural D-item; it sources from the decided prose instead.

  Authoring rules and the post-draw self-audit are in Diagram Content Rules below.

**Forbidden:**
- Introducing any fact, decision, scope, or rationale not already present in `plan.md`. Enrichment re-surfaces existing context; it does not author new context. If the plan genuinely lacks context the reader needs, that is a plan defect — fix the plan and re-run the pipeline, do not paper over it at render time.
- Omitting, weakening, or contradicting any plan content.
- Writing enrichment back to disk. Per Invariant 3 the callouts live only in the derived presentation file; `plan.md` stays the single source of truth and every re-render redraws from it.
- Drawing a diagram edge, arrow, or relationship that `plan.md` did not already decide. A diagram cannot be vaguer than the plan it visualizes — if you cannot draw it without inventing a who-calls-whom or ownership decision the plan never made, that is a plan defect: fix the plan and re-run the pipeline, do not invent the edge at render time.

`plan.md` is the artifact the pipeline reviewed and the artifact the executor runs from; net-new content in the presentation file would be unreviewed.

### Diagram Content Rules

Which diagrams the plan reader needs, and what each must and must not say. The form of a diagram (SVG mechanics, layout, colors, phone behavior, node and edge budget, the split rule) belongs to the html-report guide; nothing below restates it. A diagram is **Readability Enrichment** — it makes flow or structure already decided in `plan.md` *visible*. It never authors plan content and never touches `plan.md` on disk.

#### Stage A Fidelity Bounds (read first)

A diagram is the highest-density enrichment, so the fidelity bound is strictest:

- **Derived view only.** Diagrams live in the derived presentation HTML only. NEVER write a diagram or its source into `plan.md` — Invariant 3 keeps `plan.md` the unmodified single source of truth; every re-authoring redraws from it.
- **Re-visualize decided flow only.** Drawing an edge forces a commitment: who calls whom, in what order, which component owns what. If you cannot draw an arrow or relationship without making a decision `plan.md` did not already make, **STOP** — that is a plan defect, not a diagram opportunity. Return to revise the plan and re-run the pipeline; do not invent the missing edge while authoring the page. A diagram can never be vaguer than the plan it visualizes.
- **Diagrams are the plan's review surface.** A reviewer should be able to verify the design by reading the diagram set without reading all the prose. Diagram count therefore SHOULD scale with plan size — a large plan with many components, APIs, and stateful entities warrants many diagrams. There is no numeric cap, no consolidation-to-minimize pressure, and no "too many diagrams = scope defect" tripwire. Suppressing diagrams makes large plans unverifiable; that is the problem this rule exists to prevent.
- **Trigger-based REQUIRED.** Each lens in the Lens Taxonomy has a trigger FACT. When that FACT holds in `plan.md`, the lens's diagram is REQUIRED — not optional, not a judgment call. The only reason not to draw a lens is that its trigger FACT is false (the plan genuinely has no API, no stateful entity, etc.). A triggered lens with no source in `plan.md` is a plan gap to fix, not an excuse to skip the diagram.
- **Diagrams show runtime behavior.** Every diagram renders the behavior the implemented plan would produce: flows, call sequences, state transitions, object structures. They are not illustrative; they are the commitment surface the reviewer signs off on.
- **Grouped placement.** All diagrams for a plan sit together in the Bird's-Eye View section, ordered macro → micro (component/flow → sequence → single-component zoom-ins such as state, flow, or object structure) — never scattered through the plan body. Each diagram keeps its own Why → Diagram → Interpretation (Presentation Protocol below). A reader verifies the whole design in one place instead of hunting for views.

#### Lens Taxonomy (trigger-based REQUIRED)

Diagrams are organized by lens (the altitude or concern each diagram addresses). When a lens's trigger FACT holds in `plan.md`, that lens's diagram is REQUIRED. Draw each with the matching html-report diagram type.

| Lens / Altitude | Trigger FACT — diagram REQUIRED when this holds | html-report diagram type |
|---|---|---|
| System topology (bird's-eye) | plan has >= 2 components | structure / architecture / flow |
| Module / API | plan adds or changes an API or module interaction | sequence (one per API) |
| User / Actor | a user-facing scenario exists | sequence (actor) or flow (user flow) |
| Domain state | an entity has a non-trivial lifecycle / state transitions | state machine |
| Domain / Service object | new or changed data shapes / service structure | data model (entity tables with relationship lines) |
| Business logic | complex branching logic | flow |

**Existence vs content source (general rule for all lenses).** Separate a lens's *existence* from its *content source*. Existence is per-lens: each lens's diagram is REQUIRED when its own trigger FACT (the table above) holds, and nothing else. Content source is the SAME for every triggered lens: the diagram is sourced from content decided in `plan.md` — whether that content is recorded as a structural D-item OR as decided plan prose. A triggered lens therefore never gets skipped merely because the plan carries no structural D-item; it sources the decided edges / relationships from the plan prose instead. (The no-invention bound still holds: the diagram cannot draw an edge the plan never decided, and cannot be vaguer than the plan it visualizes.)

**Per-system evaluation (boundary-complete coverage).** A lens's trigger FACT is evaluated **per system** — once for each vertical system the System topology lens draws (e.g. a client app AND a backend service), never once globally for the whole plan. When the FACT holds in more than one system, the lens covers EVERY system where it holds — one diagram spanning the systems, or one diagram per system; both are valid, silence on a triggered system is not. A lens drawn for only one side while `plan.md` also decides matching content on another side is an INCOMPLETE lens, the same defect class as a skipped lens: a server-only service/repo object-structure diagram when the plan also decides the client's repository/usecase/mapping structure; a server-only ingest branching flow when the plan also decides client-side branching (retry, chunking, partial-failure resend, permission-derivation); a server-only entity state machine when the plan also decides a client-held lifecycle (connection/permission/sync-anchor states). Each system is drawn in its **own decided architecture vocabulary** — whatever layering that side's plan content uses (presentation/domain/data layers, feature slices, router/service/repo) — never by forcing one side's vocabulary onto the other, and never skipped because its layering differs from the side already drawn.

System topology applies that general rule, with two specifics preserved: its existence trigger is ">= 2 components" (and the Bird's-Eye View sub-rules above gate its existence on that same fact — never change this trigger); and its richest form, the decision-log-derived ownership TABLE plus its flow diagram, is still gated on structural enumeration (Complex/Architecture). So when the plan has >= 2 components but carries NO structural enumeration (e.g. a Scoped plan), the System topology diagram still EXISTS, drawn from the plan-decided component interactions / topology, while the decision-log ownership table is omitted; when there IS structural enumeration, the richer ownership-table + flow diagram is drawn. This is a content-source distinction, not an existence escape: the diagram is never skipped once >= 2 components holds.

**Two-axis rendering.** When the plan carries a `### Boundary Map` (structural enumeration present), the System topology diagram visualizes both boundary axes that block already decides: group vertical domains as distinct nodes/containers, keep the horizontal use-case layer visibly separate from the domains it orchestrates, and draw every dependency arrow in its decided direction so a reader can check unidirectionality (a domain→domain back-reference or a cycle shows up as an arrow, not as prose). This is re-visualization of the Boundary Map, not new authorship — the axes, parts, and directions all come from `plan.md`; the no-invention bound still holds. Vocabulary follows the `architecture-boundaries` rule (vertical domain / horizontal use-case), not any one methodology.

**Decision-log fidelity.** Each D-item in the unified decision log records one decided commitment. Any diagram that re-visualizes decided D-items sits inside the Bird's-Eye View section alongside every other lens — figure-locality is absolute (see Coverage Table below): never inline in the decision-log prose, never scattered through the plan body. It re-visualizes the DECIDED D-items only — it MUST NOT invent ownership or edges beyond what the decided items already record. The diagram is never a source of truth; the decided decision log in `plan.md` remains the single authority. The same trigger rule applies: draw it when the trigger holds, skip it only when the trigger FACT is false.

#### Coverage Table (audit ledger)

The Bird's-Eye View section starts with a 6-row coverage table, header exactly `| Lens | Trigger FACT | Status |`. Every Status cell is exactly `drawn (N)` or `trigger FALSE: <reason>` — never blank. Each `drawn` row states N, the number of diagrams that lens draws (one lens may need several, e.g. one per API or system; there is no cap). The counting unit is the `<figure>` element that contains an `<svg>`: the N values of all `drawn` rows MUST sum to the number of such figures in the presentation HTML, and every such figure lives inside the Bird's-Eye View section (figure-locality). Every such figure counts under exactly one lens row — the lens it depicts. The decision-log-derived flow diagram is the System topology diagram and counts in that row; any other decision-log re-visualization counts under the lens it depicts. No figure goes uncounted. A `<figure>` without an `<svg>` is not a diagram and does not belong in the page (html-report keeps cards, tables, and code outside `<figure>`).

This table is an audit ledger for lens coverage. No tool checks it. After drawing, the author audits it: count the `<figure>` elements that contain an `<svg>` (for example `grep -c "<figure" {name}.html` cross-checked against the `<svg` count), confirm the `drawn` counts sum to that number, and confirm each `trigger FALSE` reason against `plan.md`. Human review also checks the reasons. A blank Status cell is a defect, not an acceptable omission.

When the System topology lens draws >= 2 systems, each `drawn` row's Trigger FACT cell names every system where that lens's FACT holds (per-system evaluation above), and the lens's diagram set must render each named system. A `drawn` row whose FACT holds in a system the diagrams never render is a lying row — the same defect class as a count mismatch, caught by the per-system audit item in the post-draw checklist.

The six lenses are the whole set: the Domain / Service object lens covers entity and relationship structure, so there is no separate data-model row.

#### Guardrails

| Rule | Why |
|---|---|
| No duplication of the same flow at the same abstraction level | redundant representation |
| A flow diagram only at 3+ branch points | overkill below that — use prose (2 or fewer branches triggers no lens) |
| Time-ordered who-calls-whom across components -> sequence; static component topology (>= 2 components) -> structure diagram (System topology lens) | distinct altitudes: a sequence captures call ordering over time, the structure diagram captures the static topology |
| Over the html-report node or edge budget -> split into an overview plus a detail figure; NEVER aggregate decided ownership members into one node | aggregation erases decided ownership — a fidelity violation, not a readability fix |
| Decomposition: a sequence participant with 3+ internal branches MAY get its own flow diagram | complementary multi-level view, not duplication |
| A state machine is for lifecycle, not branching logic | branching -> flow |

#### Presentation Protocol

Every diagram is presented in 3 parts — the same shape as a callout, where the Why and Interpretation re-surface plan context and author nothing new:

1. **Why** (before): what this diagram lets the reader verify — at least one concrete objective. Not "this shows the flow."
2. **Diagram**: the `<figure>` with its inline SVG, authored per html-report.
3. **Interpretation** (after): 2-3 lines naming specific structural observations the reader should take away.

**Anti-pattern:** a diagram with a generic or empty Why / Interpretation, or with no surrounding context at all.

#### Sequence Authoring Rules

Once a sequence is selected, these rules govern what it says. They are the completeness direction of fidelity: the no-invention bound stops a diagram from saying MORE than the plan; these stop it from saying LESS.

| Rule | Why |
|---|---|
| Every synchronous call is drawn as a call arrow with an activation bar and a labeled return arrow. The activation bar and the return arrow are one unit; neither is omittable | a call without a visible activation and return hides the response contract the reviewer must verify |
| A message with no return is drawn in the fire-and-forget style the legend defines, or carries a note declaring it | the reader must be able to distinguish "no response by design" from "author forgot the return arrow" |
| Participant labels are the plan's canonical component names, verbatim — no shortening, no renaming | a shortened label (e.g. a dropped domain prefix) erases the ownership identity the plan decided |
| Message labels carry only signatures, fields, and value shapes that appear in `plan.md` — compressing plan prose into an invented signature is invention | the reader treats a drawn signature as a decided contract |
| If the plan decomposes an ownership boundary into N named members, the diagram's view of that boundary shows N members — reduce node count by splitting into an overview and a detail figure, never by collapsing decided members into one node | aggregation silently erases decided ownership |

#### Post-Draw Self-Audit

After drawing any diagram and BEFORE submitting the page, verify the drawn diagram against `plan.md`. This audit is a content check on top of the html-report loop; it does not replace the loop's capture and lint rounds.

##### Edge ledger — write it out before the checklist

An edge is the part of a diagram a reader cannot check for themselves, so it is audited by producing something, not by ticking a box. Write one ledger line per arrow, message, and transition the diagram draws, and in each line quote the words in `plan.md` that decide that edge:

```
<source> -> <target> : "<quoted plan.md text that decides this edge>"
```

Four rules govern the quote slot:

- **It decides that edge — the pair AND the direction.** Two facts that each mention one endpoint do not decide the arrow between them. `plan.md` naming `RETRY_SCHEDULED` in one sentence and `SENDING` in another decides neither a transition between those two states nor which way it runs.
- **It is quoted plan text, not your reading of the plan.** If what you are about to put in the slot is an inference — "it follows that", "presumably", "the natural reading is", "the queue must therefore" — the edge is undecided.
- **It is the chosen Decision, not a documented reject.** A plan names its rejected / invalidated / reversed / superseded alternatives on purpose, to record why they lost ("nest it inside `AmountRuleSchema` — rejected"; "this reverses an initial X proposal"). That text is quoted plan text and it names the pair and direction, so it slips past the two rules above — yet quoting it draws the design the plan THREW AWAY. Take the quote from the item's **Decision** field (the chosen commitment) only, never from its Invalidated-alternative / rejected-option / reversed-proposal text. When the plan reversed a proposal, the final decision is the only form that may appear — the superseded form must not surface as chosen in any node, edge, field, or Interpretation.
- **An edge with no quote is a plan gap.** Do not quietly delete it, do not redraw it vaguer, do not merge it into a neighbouring edge. STOP per Fidelity Bounds and name the specific decision `plan.md` is missing, so the plan can be revised and the pipeline re-run.

The ledger is a working step. It is not written into the presentation file. Its line count per figure equals that figure's `marker-end` count (html-report section 13.1).

##### Checklist

- [ ] Every drawn edge has a ledger line with a quote
- [ ] Every synchronous call has its paired activation + return arrow, or an explicit fire-and-forget marker
- [ ] Every participant/node label appears verbatim in `plan.md`
- [ ] Every decided ownership member within the diagram's scope appears as a node
- [ ] No signature or field in the diagram is absent from `plan.md`
- [ ] Every drawn field/edge/ownership is quoted from the item's chosen **Decision**, never from a rejected / invalidated / reversed alternative the plan documents (a superseded design must not appear as chosen)
- [ ] Every claim in the Interpretation corresponds to an edge or node actually drawn — the Interpretation describes the diagram, not the plan
- [ ] 쓰기 전에 소개: every code-name node/message a no-context reader cannot decode is introduced — either in the plan-body prose or in a `<ul class="gloss">` "이 그림의 요소" footnote directly under the diagram's `<figure>` (one plain line per code-name element); a node already carrying a plain-language name needs none
- [ ] Per-system coverage: for each system where this lens's trigger FACT holds (client and server alike), the lens's diagram set renders that system's decided content — a one-sided render of a two-sided FACT is a failed item
- [ ] The `drawn (N)` values sum to the number of `<figure>` elements containing an `<svg>`, and each of those figures sits inside the Bird's-Eye View section

Fix any failed item before submitting. If an item cannot be fixed without making a decision `plan.md` never made, that is a plan defect — STOP per Fidelity Bounds and revise the plan instead.

---

## Stage B: Re-keyed Signal Table

Compute the recommendation right after Momus returns APPROVE or COMMENT, BEFORE the Stage A render, because the Stage A presentation's Execution Recommendation box carries it. S6 then delivers this already-computed recommendation; it is not recomputed. Inputs come from the conversation record plus `prometheus-state.ts get` output (the state CLI has no Stage B field), so keep the computed result in the conversation record for the render and for S6:

| Signal | Weight toward Finish | Weight toward Continue to ultragoal |
|--------|----------------------|--------------------------------------|
| Carried-forward residual present | Strong | — |
| Unresolved question or open fork in the plan | Strong | — |
| Feasibility-concern COMMENT from the post-plan gate | Moderate | — |
| Plan fully machine-verifiable with no residuals | — | Strong |

**Conflict resolution**: When signals split evenly, default to Finish (human review first).

**Recommendation Output Template** (computed before the Stage A render; delivered at S6, before Stage C):

```
**Recommendation**: [Continue to ultragoal | Finish]
**Rationale**: [1–2 sentences citing the dominant signals from the re-keyed signal table]
**What tips the balance**: [The single strongest signal that drove the recommendation]
```

---

## Stage C: Execution Bridge — Option Formatting

After the user reads Stage B's recommendation, present execution options via the platform's user-prompt primitive (structured choice):

**(1) Continue to ultragoal**
Hand the plan to ultragoal for autonomous story-by-story execution (sisyphus as sole executor).

**(2) Finish**
End the session with the plan as the deliverable; emit `<prometheus-done/>`.

**(3) Revise plan**
Return to Interview Mode for modifications.

The `(Recommended)` label is **computed from the re-keyed signal table, NOT hardcoded** — attach it to whichever option Stage B selected.

| User Response | Action |
|---------------|--------|
| Requests changes before selecting | Return to Interview Mode, re-run pipeline |

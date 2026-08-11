English | [한국어](research.md)

---

# Research Skills

oh-my-toong's research skills gather and verify facts at saturation before a judgment is made. The research axis is a single engine (`ultraresearch`) that runs in two postures, with a `hermes` worker loading the `insane-browsing` skill whenever a source requires authentication or JS rendering that surface-level web search cannot reach.

---

## Summary Table

| Skill | One-line role | Primary input | When to use |
|-------|---------------|---------------|-------------|
| `ultraresearch` | Saturation-research orchestration — decompose → saturate → converge → verify → synthesize, as one engine | A research question, or a decision that needs facts grounded before it is made | When the user explicitly demands deep research, or when a skill such as deep-interview needs facts grounded before it forms a judgment |
| `insane-browsing` | A three-tier browsing engine for sources that require authentication or JS rendering | A blocked URL, or `ultraresearch`'s Phase 0 Browsing gate | Loaded by the `hermes` agent, which is dispatched as a worker inside `ultraresearch` when the Browsing gate is `yes` — rarely invoked directly |

---

## Skill Details

### ultraresearch

**Purpose**: Runs one saturation-research engine in one of two postures. **Explicit research posture** fires when the user explicitly demands research; **pre-work CLEAR posture** fires when a caller such as deep-interview invokes the engine to ground facts before forming a judgment. Both postures share the identical engine: decompose → saturate → converge → verify → synthesize.

**Engine overview — five phases**:
1. **Phase 0 (decompose)** — breaks the question into 3+ orthogonal axes and settles the posture and the worker-floor tier. The exception is the **CLEAR Scoped single-fact path** — deep-interview invoking this engine to ground exactly one fact while mid-interview — where Phase 0 decomposes to a **single axis** (the one fact) instead of manufacturing 3+ axes, and Phase 1 launches only one worker.
2. **Phase 1 (saturation wave)** — dispatches every axis from Phase 0 as workers in one response, all at once.
3. **Phase 2 (EXPAND convergence loop)** — each wave collects every worker's return at a barrier and decides whether to expand or stop.
4. **Phase 3 (separate verification pass)** — settles only the contested claims among the gathered material, in a dedicated pass.
5. **Phase 4 (synthesize)** — writes the deliverables once, from a single post-convergence snapshot.

Workers are explore, librarian, or hermes (which loads the `insane-browsing` skill when browsing is needed) — **dispatched in full as foreground Agents in a single response**, then collected together at the barrier. This substrate is fixed-member — a wave's entire membership is dispatched in one response, and the barrier waits for every one of those workers to return, so there is no mechanism to add a worker to a wave already in flight. So this engine runs as **synchronous batched waves** instead of an async swarm. Workers are read-only gatherers — they never write the journal or any session file directly, instead returning everything as reply text: their findings (for a codebase coordinate, that includes the quoted content at that `file:line`, not just the coordinate), the `## EXPAND` tail, plus a `## CLAIMS` channel for claim/observation candidates. Every artifact, including the journal and the claim graph, is written by the orchestrator alone.

**Output contract** (explicit research posture only — pre-work CLEAR writes no REPORT and returns grounded facts straight to its caller instead): `REPORT.md` is the deliverable (SSOT, source of truth), and `REPORT.html` is its **high-expressiveness rendering** — the same claims and citations presented with MORE visual structure than markdown can carry, never less. Two floors hold: **content parity** (every section, candidate profile, and citation link in `REPORT.md` appears in the HTML; after rendering, the citation links in both files are counted and reconciled — a lower link count in the HTML is a rendering defect) and **expressiveness promotion** (flows, pipelines, and architectures the markdown carries as text blocks or prose are promoted to inline SVG diagrams; comparison tables gain visual verdict state — a byte-identical `<pre>` copy of a markdown text block is a transcode, not a render). The file stays a single self-contained one with no external CSS, JS, fonts, or images; no separate rendered format such as PDF is produced, and no new external dependency is added for one. `REPORT`'s table of contents is not a fixed section list — it is derived from **the axes decomposed in Phase 0 itself**. The axes ARE the table of contents, so REPORT answers what the user actually asked. REPORT is complete before it is short — material a reader needs to understand a finding goes into the report itself, never dropped for length, and detail beyond understanding descends by relative link into the journal files each section drew from (`wave-*.md`, the backing `SYNTHESIS.md` section), so the reader follows the actual research trail instead of a re-explanation. A workflow or symptom axis section additionally carries each practitioner account the journal gathered as its own entry (who practices it, what the practice is, the source link) — coverage from other material does not excuse the omission, because when the reader asked how people cope, that account is exactly what compression discards first.

When the query selects among libraries, tools, or approaches, REPORT's comparison section carries **one profile per candidate** with REQUIRED fields: name plus the exact version examined, license, maintenance signal (latest release or activity), concurrency/locking behavior, history/merge model, feature notes (a feature the user de-scoped stays described — de-scoping moves choice weight, it does not delete the field), and a verdict with rationale. Lumping several candidates into one row is a defect — a shared cell cannot hold four different truths, which is exactly where journal facts invert. A rejected candidate keeps its filled profile plus an explicit invalidation rationale, and a field the journal cannot fill is written `unknown — not gathered`, which surfaces in the coverage gate instead of vanishing.

`SYNTHESIS.md` is not the deliverable — it is an intermediate artifact that serves as the **citation source of truth**. It keeps its eight-section structure (executive summary, findings by theme, codebase findings, ranked sources, verified claims, contradictions, gaps, expansion trace) and carries the audit axis: "what can be believed." That eight-section table of contents is fixed to the audit axis, so it couldn't take the axis the user actually asked about as its table of contents — in practice, a user asked about a schema or an API and the document returned only coordinates (`file:line`). That is why the audit axis (`SYNTHESIS.md`) was split from the reference axis (`REPORT.*`): the two do not replace each other, they diverge.

The write order starts with `SYNTHESIS.md`, common to both postures; from there, the explicit research posture continues with `REPORT.md` → `REPORT.html`, while the pre-work posture continues with the handoff. All of it is produced once from a **single post-convergence snapshot** rather than accreted wave by wave — a late wave can overturn a claim an earlier wave had marked "verified."

**Detection axis**: Phase 0 pre-declares the requirement items this research run must answer, **before any worker is dispatched**. The requirement items come from the Phase 0 axis decomposition itself — there is no separate question classifier. Timing matters here: a requirement item invented after the fact lets its own omission vanish silently.

Phase 4 carries a **coverage gate**, scoped to the explicit research posture the same way the output contract above is — pre-work CLEAR writes no REPORT, so there is nothing for a coverage table to judge, and the caller's own contract governs there instead. The gate produces one row per requirement item. It runs only after the `REPORT.md` draft exists — since that draft is what the gate has to judge — and each row's Status is restricted to exactly three values: `covered`, `not applicable: <reason the query never demanded this>`, or `uncovered: <why no material was gathered>`. An item the query never demanded is `not applicable`; an item the query did demand but the research failed to gather material for is `uncovered` — never `not applicable`. Collapsing the two would let a real research gap read as a question nobody asked, which is exactly the silence this gate exists to break. **A blank Status is a defect.** When the supporting material already sits in the journal but never made it into `REPORT.md`, the fix is to edit `REPORT.md` immediately, without relaunching a wave — the material is already in hand, so this is a recording gap, not a gathering gap. This self-check and any resulting edits happen before the HTML render and the final chat response go out. The coverage table also carries a `workers` column sourced from `expansion-log.md`: an axis no worker was ever assigned to cannot be `covered` — material nobody gathered cannot have covered anything, so a covered-with-zero-workers row is the same defect as a blank Status. To make that column resolvable, `expansion-log.md` attributes each worker to the axis it owns rather than recording an aggregate count ("4 codebase + 6 external") — an aggregate proves nothing about any single axis, so a row whose staffing the log cannot resolve is downgraded exactly as an unstaffed one is.

The gathering side gains three reinforcements: Phase 0 separates the user's **question shape** (the solution they asked for) from their **symptom shape** (the pain they described) and makes the symptom its own axis; the Phase 1 librarian protocol names practitioner discourse (engineering-blog postmortems, reddit and Hacker News threads) as librarian territory independent of the browsing gate; and Phase 2 carries a **negative-result pivot** — a "no tool provides X" verdict is itself a lead, converting that axis from tool-selection into "how do practitioners cope without X" before it may count toward convergence. The verification gate adds a practice-shaped claim class: a practitioner's own first-party account (postmortem, talk, issue thread) satisfies the primary-source criterion, entering synthesis labeled as practice ("teams report doing X"), never restated as tool capability. At convergence `intent-diff.md` is finalized from the same snapshot — every `unknown` row is resolved with its linked claims or explicitly carried into gaps, never left frozen at its Phase 0 seed.

This table is not a volatile artifact that lives only in the chat message — it is written into `REPORT.md` itself, at the very top, above the per-axis sections, so that anyone who opens REPORT later can see what was `uncovered` without leaving the file. `REPORT.md` is the table's source of truth; the final chat response and the `REPORT.html` render copy both carry it as a copy — if the chat generated its own table independently, the two could drift apart.

This contract, like the coverage gate above, is scoped to the explicit research posture — pre-work CLEAR returns its facts to the calling skill rather than to a user-facing chat message. The final chat response is **the coverage table plus one entry point** — the `REPORT.md` path. That table is the same one that sits at the top of `REPORT.md`, copied as-is, not a second table the chat generates on its own. It is not an inventory of what exists; it is a checklist of what got answered.

**The rest of the contract**:
- The sole allowlist for verified **non-code claims** is the **claim-graph five-criteria gate** (2+ independent source domains, 2+ independent observation groups, one counter-search, primary-source backing, explicit temporal evidence) — code-shaped claims are verified with executed code instead, not this gate.
- Convergence stop rules require the **minimum-2-waves floor** to complete first, then stop on zero unchecked leads, 3 consecutive empty waves, or depth 5. The CLEAR Scoped single-fact path above is **exempt** from this floor — a single wave that answers the fact converges immediately. Only the floor is waived: the EXPAND convergence loop and claim verification still apply, just scaled down to the single-fact ask.
- **Gatherer ≠ verifier** — verification is a separate pass; a gather worker cannot self-certify its own claim as verified. Code-shaped claims are verified with executed code; everything else with an oracle citation re-read of the primary source.
- A complexity-tier → worker-floor table (Scoped / Complex / Architecture / explicit `/ultraresearch`) sets the minimum worker count per tier.

**When to use**: When the user explicitly demands research via "ultraresearch" or "/ultraresearch", or when a skill such as deep-interview needs facts grounded before forming a judgment. It does not activate for ordinary questions, debugging, or routine implementation context-gathering.

---

### insane-browsing

**Purpose**: A three-tier browsing engine for sources behind authentication or JavaScript rendering that surface-level web search or fetch cannot reach — Tier 1 headless extraction (WAF bypass) → Tier 2 platform-native readers (Chinese and social platforms, among others) → Tier 3 Chrome stealth for real interaction, escalating from the cheapest tier only when needed.

**Relationship to ultraresearch**: loaded by the `hermes` agent, which is dispatched as a worker when `ultraresearch`'s Phase 0 Browsing gate is set to `yes` — this skill is skipped entirely when surface-level web results are sufficient.

**Origin**: vendored from fivetaku/insane-search (MIT).

**When to use**: Called automatically from inside `ultraresearch` in most cases. It can also be invoked directly to unblock a single site or when login sessions, screenshots, or form interaction are needed standalone.

---

## Skill Selection Guide

```
Is this a research situation?
  |-- User explicitly demands research ("ultraresearch", "/ultraresearch") -> ultraresearch (explicit research posture)
  |-- Another skill (e.g. deep-interview) needs facts grounded before judgment -> ultraresearch (pre-work CLEAR posture)
  |-- Ordinary question, debugging, routine implementation context-gathering -> not this skill (answer normally)

When ultraresearch runs:
  The hermes agent attaches as a worker only if the Phase 0 Browsing gate is yes, loading the insane-browsing skill.
  If the gate is no, insane-browsing is never called during that run.
```

---

## References

- [README](../../README.en.md) — Project overview
- [Core Pipeline Skills](./core-pipeline.en.md) — deep-interview, prometheus, sisyphus
- [Review & Quality Skills](./review-quality.en.md) — code-review, qa
- [Authoring Skills](./authoring.en.md) — Document and slide generation
- [Knowledge Graph & Pins](./knowledge-graph-pins.en.md) — Graphiti, Pin skills
- [Utilities & Personal](./utilities-personal.en.md) — Configuration, keybindings, and more

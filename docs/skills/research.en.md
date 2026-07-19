English | [한국어](research.md)

---

# Research Skills

oh-my-toong's research skills gather and verify facts at saturation before a judgment is made. The research axis is a single engine (`ultraresearch`) that runs in two postures, with `insane-browsing` attached inside it as a worker whenever a source requires authentication or JS rendering that surface-level web search cannot reach.

---

## Summary Table

| Skill | One-line role | Primary input | When to use |
|-------|---------------|---------------|-------------|
| `ultraresearch` | Saturation-research orchestration — decompose → saturate → converge → verify → synthesize, as one engine | A research question, or a decision that needs facts grounded before it is made | When the user explicitly demands deep research, or when a skill such as deep-interview needs facts grounded before it forms a judgment |
| `insane-browsing` | A tiered browsing engine for sources that require authentication or JS rendering | A blocked URL, or `ultraresearch`'s Phase 0 Browsing gate | Dispatched as a worker inside `ultraresearch` when the Browsing gate is `yes` — rarely invoked directly |

---

## Skill Details

### ultraresearch

**Purpose**: Runs one saturation-research engine in one of two postures. **Explicit research posture** fires when the user explicitly demands research; **pre-work CLEAR posture** fires when a caller such as deep-interview invokes the engine to ground facts before forming a judgment. Both postures share the identical engine: decompose → saturate → converge → verify → synthesize.

**Engine overview — five phases**:
1. **Phase 0 (decompose)** — breaks the question into 3+ orthogonal axes and settles the posture and the worker-floor tier.
2. **Phase 1 (saturation wave)** — dispatches every axis from Phase 0 as workers in one response, all at once.
3. **Phase 2 (EXPAND convergence loop)** — each wave collects every worker's return at a barrier and decides whether to expand or stop.
4. **Phase 3 (separate verification pass)** — settles only the contested claims among the gathered material, in a dedicated pass.
5. **Phase 4 (synthesize)** — writes the deliverables once, from a single post-convergence snapshot.

Workers are explore, librarian, or insane-browsing — **dispatched in full as foreground Agents in a single response**, then collected together at the barrier. OMT prohibits background dispatch of Agent tasks (`rules/tool-usage-policy.md`), so this engine runs as **synchronous batched waves** instead of an async swarm. Workers are read-only gatherers — they never write the journal or any session file directly, returning only their findings and `## EXPAND` leads as text. Every artifact, including the journal and the claim graph, is written by the orchestrator alone.

**Output contract**: `REPORT.md` is the deliverable (SSOT, source of truth), and `REPORT.html` is a single self-contained render copy of it with no external CSS, JS, fonts, or images. No separate rendered format such as PDF is produced, and no new external dependency is added for one. `REPORT`'s table of contents is not a fixed section list — it is derived from **the axes decomposed in Phase 0 itself**. The axes ARE the table of contents, so REPORT answers what the user actually asked.

`SYNTHESIS.md` is not the deliverable — it is an intermediate artifact that serves as the **citation source of truth**. It keeps its eight-section structure (executive summary, findings by theme, codebase findings, ranked sources, verified claims, contradictions, gaps, expansion trace) and carries the audit axis: "what can be believed." All eight sections addressed only trustworthiness, with no section answering "what did the user actually ask" — in practice, a user asked about a schema or an API and the document returned only coordinates (`file:line`). That is why the audit axis (`SYNTHESIS.md`) was split from the reference axis (`REPORT.*`): the two do not replace each other, they diverge.

The write order is `SYNTHESIS.md` → `REPORT.md` → `REPORT.html` → (on pre-work postures) the handoff, all produced once from a **single post-convergence snapshot** rather than accreted wave by wave — a late wave can overturn a claim an earlier wave had marked "verified."

**Detection axis**: Phase 0 pre-declares the requirement items this research run must answer, **before any worker is dispatched**. The requirement items come from the Phase 0 axis decomposition itself — there is no separate question classifier. Timing matters here: a requirement item invented after the fact lets its own omission vanish silently.

Phase 4 carries a **coverage gate**, one row per requirement item. It runs only after the `REPORT.md` draft exists — since that draft is what the gate has to judge — and each row's Status is restricted to `covered` or `not applicable` (with a reason). **A blank Status is a defect.** When the supporting material already sits in the journal but never made it into `REPORT.md`, the fix is to edit `REPORT.md` immediately, without relaunching a wave — the material is already in hand, so this is a recording gap, not a gathering gap. This self-check and any resulting edits happen before the HTML render and the final chat response go out.

The final chat response is **the coverage table plus one entry point** — the `REPORT.md` path. It is not an inventory of what exists; it is a checklist of what got answered.

**The rest of the contract**:
- The sole allowlist for verified claims is the **claim-graph five-criteria gate** (2+ independent source domains, 2+ independent observation groups, one counter-search, primary-source backing, explicit temporal evidence).
- Convergence stop rules require the **minimum-2-waves floor** to complete first, then stop on zero unchecked leads, 3 consecutive empty waves, or depth 5.
- **Gatherer ≠ verifier** — verification is a separate pass; a gather worker cannot self-certify its own claim as verified. Code-shaped claims are verified with executed code; everything else with an oracle citation re-read of the primary source.
- A complexity-tier → worker-floor table (Scoped / Complex / Architecture / explicit `/ultraresearch`) sets the minimum worker count per tier.

**When to use**: When the user explicitly demands research via "ultraresearch" or "/ultraresearch", or when a skill such as deep-interview needs facts grounded before forming a judgment. It does not activate for ordinary questions, debugging, or routine implementation context-gathering.

---

### insane-browsing

**Purpose**: A three-tier browsing engine for sources behind authentication or JavaScript rendering that surface-level web search or fetch cannot reach — Tier 1 headless extraction (WAF bypass) → Tier 2 platform-native readers (Chinese and social platforms, among others) → Tier 3 Chrome stealth for real interaction, escalating from the cheapest tier only when needed.

**Relationship to ultraresearch**: dispatched as a worker only when `ultraresearch`'s Phase 0 Browsing gate is set to `yes` — this skill is skipped entirely when surface-level web results are sufficient.

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
  insane-browsing attaches as a worker only if the Phase 0 Browsing gate is yes.
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

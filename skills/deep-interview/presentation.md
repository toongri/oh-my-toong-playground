# Presentation Contract (deep-interview)

The precise SSOT for deep-interview is the **spec** — a reference for AI, execution, and
verification that precisely captures requirements, constraints, design decisions, and diagrams.
This contract governs authoring the **presentation derived** from that spec. The presentation
is a self-contained, human-readable HTML artifact accompanying the spec.

## Two artifacts, two audiences
- **SSOT (spec)** — for AI, execution, and precise verification. Precise and immutable. Includes
  interview machinery such as clarity scores, ontology convergence, and interview transcripts.
- **presentation** — a human explanation derived from the spec, for a colleague or team-lead
  with no prior context on this work.

**Purpose & perspective.** Write this presentation in the first person of the author
explaining the spec and design they defined — what they propose and why — to a
colleague or team-lead with no prior context on it. The bar: from this page alone,
that reader richly and correctly understands what the work does, why it is designed
this way, and what they must be aware of when they next modify this code. Keep it
clear and accessible — plain language, domain terms glossed on first use, big-picture
diagrams (the ELI5 spirit of "explain it simply") — but never dumb it down or thin it
out: **accessible AND rich, never a thinned-out overview.**

## Faithful restatement, not simplification — rich explanation is welcome
The presentation is **not** an abridgment retaining only the big picture. Carry over all design
content decided in the spec and **every diagram it draws.** There is no character limit;
explanations that enrich the content alongside diagrams are always welcome. Remove only the
interview and AI machinery listed below.

### What to carry over (derived from the spec)
Restate all the following spec content at maintainer level — omit none:
- **What and why** — Goal. What changes and why (problem and stakes). Take the why only from the spec.
- **Approach and design decisions** — Approach & Design Decisions. The selected approach, rejected
  alternatives and their reasons, and tradeoffs, so the next editor understands why it was designed this way.
- **Constraints and invariants** — Constraints, Invariants. Boundaries the code must uphold and edits must not break.
- **Boundaries and non-goals** — Non-Goals (including each decider), Boundary Map / Topology.
  What is excluded, module/domain boundaries, and dependency direction.
- **Completion criteria** — Acceptance Criteria. What must be true and how to prove it.
- **Known risks** — Risks & Unresolved Forks. What the next editor should watch for.
- **Diagrams — all of them.** Carry every lens drawn in the spec's `## Diagrams` (System topology,
  Module/API, Actor scenario, Domain entity, Entity lifecycle, Logic branching). Diagrams are
  the most important means of conveying this work's system structure, flows, and domain.
  **`diagram-guide.md` owns lens selection, coverage, and edge fidelity (full-read).**

### What to remove (interview and AI machinery)
Remove only interview artifacts the reader does not need: Clarity Breakdown (clarity scores and
weights), Ontology Convergence (convergence table), Interview Transcript (per-round Q&A), internal
scoring values in Metadata, and dimension-score tables in Topology. These audit spec quality;
they do not explain the work.

## One hard rule — no invention or contradiction
This rule is absolute even at maintainer level: **do not draw anything absent from the SSOT
(spec) or say anything inconsistent with it.** No invented arrows, ownership, ordering, or concrete
values. Do not invent a diagram the spec did not draw (if it has no System topology, neither
does the presentation; if one is needed, fix that defect in the spec). Combining two things
the spec treats separately into one cause, category, or umbrella is also invention. Keep separate
what the spec separates; call things the same only when the spec says they are the same.

## Diagram discipline
`diagram-guide.md` owns the six-lens set, coverage table, edge ledger (cite spec text for every
edge), node naming, and Mermaid validity — **read it fully before authoring.** Additional presentation rules:
- **Why → Diagram → Interpretation for every diagram.** Explain why the lens is needed, show the
  picture, and give one paragraph interpreting its key message.
- **Element footnotes (`gloss`) for nodes named with code identifiers.** Below the diagram, use
  `<ul class="gloss">` to explain each code-named node and arrow style in one plain-language line,
  so readers without context can understand the elements from this page alone.
- **Explain arrow and color encodings in a legend.** If arrow styles have multiple meanings, or
  colors/borders encode something, add a one-line legend explaining them. No unlabeled arrows.
- **Diagrams invite invention more readily than prose.** Do not draw a source or edge elsewhere
  when the spec mentions it only in one place. Include only nodes and edges whose relationships the spec decides.

## First-use glosses
Explain project/domain-specific terms and code identifiers in one line at their first appearance.
- GOOD (domain): "household_id(가구를 가리키는 식별자)", "merge-patch(적힌 항목만 덮어쓰는 부분 갱신)"
- Expand abbreviations on first use; connect new concepts inside identifiers on the spot ("= 앞서 말한 …");
  use one name per concept; no forward references to undefined labels; reconcile
  dual names in the spec by explaining their relationship in one line.

## Internal document consistency
- **One partition** — the lead's enumeration and the body sections have the same count, grouping, and order.
- **The overview is a true subset of the details** — the earlier overview does not conflict with later detail.
- **Reconcile apparent contradictions** — reconcile in one line two statements that are both true in the spec but look contradictory to readers.
- **Prose matches its diagram** — "화살표가 왼쪽을 본다" must not conflict with `flowchart LR`.

## Format — self-contained HTML
The presentation delivered to people and submitted to state is **one HTML file**. The Markdown
below is intermediate renderer input, not a separate deliverable. After rendering, run
`deep-interview-state.ts submit-presentation --spec-path <spec>.md --html-path <presentation>.html`.
On success, the source/HTML paths and hashes are stored in `state.presentation`. If either file
changes, render and submit again.

Render a single self-contained HTML file with `scripts/render.ts` (zero runtime JS or external
references). Authors use only constrained Markdown and approved components; the renderer owns
styling. Mermaid fences become inline SVGs at build time.
Approved components: `doc-meta` · `flow`/`flow-step`/`flow-arrow` · `compare`/`compare-before`/`compare-after`
· `callout` · `gloss` (element footnotes) · `arch-entity` (element cards) · `diagram`.
No `<style>`, inline `style=`, or classes outside the approved list. No pasting raw code, schemas,
or type signatures (identifiers should be glossed, not pasted).

Render command:
```bash
bun ${CLAUDE_SKILL_DIR}/scripts/render.ts --in <presentation>.md --out <presentation>.html
```

## Self-audit (before rendering)
- [ ] Does the first screen establish what changes and why — **all reasons from the spec (zero invented motives)**;
      **zero combinations of separate things into one cause/category/umbrella**?
- [ ] Does it include all spec design content — Goal, approach/design decisions (including rejected alternatives),
      constraints/invariants, non-goals (deciders)/boundaries, AC, and Risks? **Omit nothing.**
- [ ] **Does it carry every diagram drawn by the spec** — zero missing lenses, zero invented diagrams absent from the spec?
      Each has Why→Diagram→Interpretation, element footnotes for code-named nodes, and arrow/color legends.
- [ ] First-use glosses for domain/code-specific terms; zero use before definition; one name per concept.
- [ ] **Zero concrete values absent from the spec** — intervals, schedulers, quantities, examples. Keep general what the spec leaves general.
- [ ] Interview/AI machinery (Clarity Breakdown, Ontology Convergence, Transcript, scoring values) removed.
- [ ] Lead enumeration = section enumeration; overview is a true subset of details; apparent contradictions reconciled; prose matches diagrams.
- [ ] Zero invention or contradiction against the SSOT.

The sole passing criterion: **can a colleague or team-lead with no prior context understand from this
page alone what the work did and what to know or consult when next modifying this code?**

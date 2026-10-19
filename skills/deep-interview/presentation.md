# Presentation Contract (deep-interview)

The precise SSOT for deep-interview is the **spec** — a reference for AI, execution, and
verification that precisely captures requirements, constraints, design decisions, and diagrams.
This contract governs authoring the **presentation derived** from that spec. The presentation
is one human-readable HTML file, written directly by you, accompanying the spec. This contract
owns the content (reader, required content, section order, diagram content, gates). Form,
layout, diagram drawing, theming, typography and the self-critique loop belong to
`${CLAUDE_SKILL_DIR}/../html-report/SKILL.md` — **read it in full before authoring** and follow
its output contract.

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
- **Diagrams — all of them.** Carry every lens the spec's `## Diagrams` coverage table marks `drawn`
  (System topology, Module/API, Actor scenario, Domain entity, Entity lifecycle, Logic branching),
  plus the dependency picture of the spec's `## Boundary Map`. Diagrams are the most important
  means of conveying this work's system structure, flows, and domain. The spec's Mermaid blocks
  are the **source diagrams**: redraw each one as an inline SVG with the same nodes, edges,
  directions and labels (see Diagram content below).

### Section order
Lead with what changes and why (first screen). Then follow the carry-over list above in its order
(approach and decisions, constraints and invariants, boundaries and non-goals, completion
criteria, risks), placing each diagram inside the section it explains, under its own
Why → Diagram → Interpretation heading. The page anatomy and components come from html-report
(its design-document skeleton fits).

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

## Diagram content
What to show; html-report decides how to draw it (SVG recipes, phone behavior, complexity budget
and splitting). The lens set and the lenses the spec drew come from the spec's coverage table.

| Lens | What the reader must see |
|---|---|
| System topology | the components and their dependency arrows, in the direction the spec decides |
| Module / API | the ordered messages between the modules the approach makes interact |
| Actor scenario | the ordered messages between the user-facing actor and the system |
| Domain entity | the entities and their relationships, with multiplicity where the spec states it |
| Entity lifecycle | the states and the transition (with its trigger) between them |
| Logic branching | the decision points and the branch each outcome takes |
| Boundary Map | the domains as groups, dependency arrows in their real direction, the cross-domain or violating edge marked |

- **Draw only what the spec decides.** Before drawing, list every node and edge in your notes with
  the spec text that decides it (the edge ledger); drop any entry with no spec text. This list is
  also html-report's source-diagram inventory. The page's node and edge counts must match the
  spec diagram it redraws; a figure over html-report's budget is split into an overview plus a
  detail figure, never trimmed.
- **Name nodes for real elements at one abstraction level** — a module, domain concept, service,
  store, or actor. Never an internal or private function name, a glob or placeholder (`foo_*`),
  or a bare DB column standing in for a component. Do not mix services, adapters, concrete
  classes and columns as siblings in one figure.
- **A refactor shows before and after,** on one layout with only the difference changed, not just
  the end state.
- **Why → Diagram → Interpretation for every diagram.** Explain why the lens is needed, show the
  picture, and give one paragraph interpreting its key message.
- **Element footnotes (`gloss`) for nodes named with code identifiers.** Below the figure, list
  each code-named node and each arrow style with a one-line plain-language meaning, so a reader
  without context understands the elements from this page alone. Meanings come from the spec only.
  This overrides html-report's "no definitions the source lacks" rule only for meanings the spec
  states.
- **Explain arrow and color encodings in a legend.** If arrow styles have multiple meanings, or
  colors/borders encode something, add a one-line legend. No unlabeled arrows.
- **Diagrams invite invention more readily than prose.** Do not draw a source or edge elsewhere
  when the spec mentions it only in one place. Include only nodes and edges whose relationships the spec decides.
- **Post-draw check:** re-read each figure against the spec — every edge is a decided fact, the
  node count matches the spec diagram, and the figure is no vaguer than the prose it visualizes.

## 쓰기 전에 소개 (introduce before you use)
The reader has no prior context, so **every first-class entity earns a plain-language introduction at
its first appearance** — before the sentence, table, or diagram leans on it. A name the reader cannot
decode from the page is a hole in the presentation, however faithful the rest is. Size the
introduction to what the entity is:

| 첫 등장하는 것 | 소개 깊이 |
|---|---|
| 용어·약어·코인된 표현 (도메인 단어, 상태 라벨) | 한 줄 뜻 — `household_id(가구를 가리키는 식별자)`, `merge-patch(적힌 항목만 덮어쓰는 부분 갱신)` |
| 함수·리포지토리·메서드 | 한 줄 역할 — what it does, not just its name |
| 모듈·도메인 | 경계 + 소유 한두 줄 — what it owns and where it sits |
| 기능(유스케이스) | 무엇을 위한 능력인지 한 문단 |

- Expand abbreviations on first use; connect new concepts inside identifiers on the spot ("= 앞서 말한 …");
  use one name per concept; no forward references to undefined labels; reconcile
  dual names in the spec by explaining their relationship in one line.
- A diagram's code-name node/arrow is introduced by the element footnote (`gloss`) below it — see
  Diagram content above; that footnote is where diagram elements get their one-line meaning.

## Internal document consistency
- **One partition** — the lead's enumeration and the body sections have the same count, grouping, and order.
- **The overview is a true subset of the details** — the earlier overview does not conflict with later detail.
- **Reconcile apparent contradictions** — reconcile in one line two statements that are both true in the spec but look contradictory to readers.
- **Prose matches its diagram** — "화살표가 왼쪽을 본다" must not conflict with the drawn arrow direction.

## Format and delivery
The presentation delivered to people and submitted to state is **one HTML file** at
`$OMT_DIR/deep-interview/{slug}.presentation.html`, written directly (no intermediate Markdown).
Form follows html-report's output contract (one file, inline CSS/JS/SVG, light and dark themes,
400px to 1280px, complete at rest).

Voice: this contract's first-person author voice ("Purpose & perspective" above) wins over
html-report section 13.3. The resulting `author-first-person` lint warnings are expected; every
other lint warning is fixed or named in the report. Writing dates stay off the page.

Self-critique loop (html-report section 14, mandatory): run capture and lint, look at every frame,
fix, and repeat in a new directory until lint reports 0 errors and the frame checklist passes.

```bash
OUT=$OMT_DIR/deep-interview/{slug}.visual-check/round-1
bash ${CLAUDE_SKILL_DIR}/../html-report/scripts/capture.sh $OMT_DIR/deep-interview/{slug}.presentation.html "$OUT"
bash ${CLAUDE_SKILL_DIR}/../html-report/scripts/lint.sh $OMT_DIR/deep-interview/{slug}.presentation.html --source $OMT_DIR/deep-interview/{slug}.md --strict --receipt "$OUT/receipt.json" > "$OUT/lint.json"
```

Then run `deep-interview-state.ts submit-presentation --spec-path <spec>.md --html-path <presentation>.html --receipt "$OUT/receipt.json"`.
`lint.sh` writes the receipt only when the run has 0 errors, so a receipt file proves one clean strict lint of exact HTML bytes.
The submission refuses unless the receipt matches the current HTML bytes, its `--source` is this spec, and it covers all three runs (1280 light, 1280 dark, 400 light).
It also refuses unless the HTML holds at least as many `<figure>` elements containing an `<svg` as the spec has Mermaid fences in `## Diagrams` and `## Boundary Map` (the refusal states both counts).
On success, the paths and hashes of the spec, HTML and receipt are stored in `state.presentation`. If any of them changes,
the submission is no longer current: **re-run `lint.sh` after every edit to the HTML** (a receipt for older bytes is refused), then submit again.

## Self-audit (before submitting)
- [ ] Does the first screen establish what changes and why — **all reasons from the spec (zero invented motives)**;
      **zero combinations of separate things into one cause/category/umbrella**?
- [ ] Does it include all spec design content — Goal, approach/design decisions (including rejected alternatives),
      constraints/invariants, non-goals (deciders)/boundaries, AC, and Risks? **Omit nothing.**
- [ ] **Does it carry every diagram drawn by the spec** — zero missing lenses, zero invented diagrams absent from the spec?
      Each has Why→Diagram→Interpretation, element footnotes for code-named nodes, and arrow/color legends.
- [ ] 쓰기 전에 소개 — every first-class entity (용어/함수/모듈·도메인/기능) introduced at first use, sized to its kind; zero use before definition; one name per concept; each diagram's code-name element covered by a `gloss` footnote.
- [ ] **Zero concrete values absent from the spec** — intervals, schedulers, quantities, examples. Keep general what the spec leaves general.
- [ ] Interview/AI machinery (Clarity Breakdown, Ontology Convergence, Transcript, scoring values) removed.
- [ ] Lead enumeration = section enumeration; overview is a true subset of details; apparent contradictions reconciled; prose matches diagrams.
- [ ] Zero invention or contradiction against the SSOT.
- [ ] html-report read in full; self-critique loop run until lint shows 0 errors and the frame checklist passes (capture + `lint.sh --source` the spec `--strict --receipt`; one `<figure>` with an inline `<svg` per spec Mermaid diagram; re-lint after any HTML edit).
- [ ] Each redrawn spec diagram has the same node and edge counts as the spec's Mermaid; any split or omission is stated on the page.

The sole passing criterion: **can a colleague or team-lead with no prior context understand from this
page alone what the work did and what to know or consult when next modifying this code?**

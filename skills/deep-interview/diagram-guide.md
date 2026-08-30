# Diagram Guide

Selection criteria and authoring rules for diagrams rendered into a Deep
Interview spec's `## Diagrams` section as markdown mermaid fences.

## 6-Lens Taxonomy

Note: this table is deep-interview's own lens set and is deliberately
different in composition from prometheus's — it includes `erDiagram` and
excludes `classDiagram`.

| Lens | Trigger FACT | Mermaid type |
|---|---|---|
| System topology | components >= 2 | `flowchart` (group vertical domains vs the horizontal use-case layer; draw dependency arrows in their decided direction so unidirectionality is checkable — see `## Boundary Map`) |
| Module / API | the approach decides module interaction | `sequenceDiagram` |
| Actor scenario | a user-facing scenario exists | `sequenceDiagram` (actor) |
| Domain entity | the ontology is non-empty — an EMPTY ontology makes this row `trigger FALSE` | `erDiagram` |
| Entity lifecycle | non-trivial state transitions exist | `stateDiagram-v2` |
| Logic branching | complex branching logic | `flowchart` |

**Lens order matters: Domain entity precedes Entity lifecycle.** The model (what
exists) is drawn before the lifecycle (how a modelled thing transitions), so a
lifecycle state — a `ProductOnly` storage phase, a `Draft` status — is never read
as if it were the domain model. Author and list the two lenses in that order.

## Coverage Table (audit ledger)

The spec's `## Diagrams` section starts with a 6-row coverage table, header
exactly `| Lens | Trigger FACT | Status |`. Every Status cell is exactly
`drawn` or `trigger FALSE: <reason>` — never blank. The count of `drawn`
rows MUST match the number of mermaid fences **in the `## Diagrams` section**.
Mermaid fences live only in `## Diagrams` and in `## Boundary Map` (which carries
exactly one dependency diagram of its own) — nowhere else (fence-locality). The
Boundary Map diagram is NOT counted by the coverage table.

This table is an audit ledger for lens coverage: a mechanical check catches
a lying `drawn` row (fence count mismatch), while a wrong `trigger FALSE`
reason is caught by human review. A blank Status cell is a defect, not an
acceptable omission.

## Node & Participant Naming

Every node, `subgraph`, and `sequenceDiagram` participant is named for a **real
element of the system at a consistent level of abstraction** — a module, a domain
concept, a service, a store, an actor. Naming is NEVER:

- an **internal / private function name** (`_get_previous_*_totals`) — that is an
  implementation symbol, not a participant; name the module or role that owns it
  (e.g. `영양소 총량 계산 서비스`) and put the symbol in the prose if it matters;
- a **glob or placeholder** (`_get_previous_*`, `foo_*`) — a `*` reads as a typo;
  spell out the concept or split it into the concrete cases;
- a **bare DB column or table** standing in for a component (`proposal 저장 컬럼`)
  while its sibling participants are services/adapters — either model the store as
  its own consistently-named participant, or fold the column into the message text.

**Keep one abstraction level per diagram.** Mixing a service, an adapter, a
concrete repository class, and a DB column as sibling participants (as the
b2c-6578 Module-API sequence did) makes the diagram unreadable — pick the level
(all modules, or all concrete classes) and stay there.

**A refactor sequence shows before→after, not just the end state.** A
`sequenceDiagram` that draws only the post-change flow cannot teach what changed;
contrast the old and new call order — two small diagrams, or one `Note` marking
the removed/added hop — the same way the other lenses mark `:::changed`.

## Guardrail

Roughly 15 nodes per diagram, max. Split into per-subsystem diagrams above
that cap rather than cramming one oversized diagram.

## Post-Draw Self-Audit

Before finalizing, re-read each fence against the spec:

- Every edge corresponds to a fact decided in the spec — no invented edges
- Node count is within the cap
- The diagram is no vaguer than the prose it visualizes

## Mermaid Validity

mermaid treats `;` as a statement separator — a raw `;` inside
sequence-message text (e.g. `mkdir -p; rm`) silently splits the line and
the whole diagram renders as an error SVG. mermaid source MUST be
syntactically valid: keep sequence-message text free of raw `;` (rephrase
to `then`, a comma, or omit). In `erDiagram` blocks, any entity name
containing a space or punctuation MUST be double-quoted (e.g.
`"Discount Code" ||--o{ "Free Product" : grants`) — an unquoted spaced
name (common for ontology entity names) renders an error SVG; verified
against mermaid@11.4.1 (the `NAME["label"]` alias form is invalid in ER
diagrams — quote the name directly).

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
| Entity lifecycle | non-trivial state transitions exist | `stateDiagram-v2` |
| Domain entity | the ontology is non-empty — an EMPTY ontology makes this row `trigger FALSE` | `erDiagram` |
| Logic branching | complex branching logic | `flowchart` |

## Coverage Table (audit ledger)

The spec's `## Diagrams` section starts with a 6-row coverage table, header
exactly `| Lens | Trigger FACT | Status |`. Every Status cell is exactly
`drawn` or `trigger FALSE: <reason>` — never blank. The count of `drawn`
rows MUST match the number of mermaid fences in the spec, and every mermaid
fence in the spec lives inside the `## Diagrams` section (fence-locality).

This table is an audit ledger for lens coverage: a mechanical check catches
a lying `drawn` row (fence count mismatch), while a wrong `trigger FALSE`
reason is caught by human review. A blank Status cell is a defect, not an
acceptable omission.

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

# Architecture Boundaries

Modules in any codebase are organized along two boundary axes. Keep both
well-drawn so that coupling stays low, dependencies stay traceable, and change
stays cheap. What matters is the **principle, not any one methodology**: how
modules are **divided** into layers, how they **collaborate** across a boundary,
and which way they **depend**. DDD, Feature-Sliced Design, and Clean Architecture
are only *vocabularies* for these same two axes — borrow a name where it fits,
but never make the work about a framework, and never impose a framework's
tactical patterns where the codebase does not use them.

These are concepts to **maintain continuously, together with the human** — a
shared, living view of the structure, not a one-time artifact.

## Axis 1 — Vertical: domain boundaries

Modules divide vertically into domains, each owning one concern behind a
boundary.

- **Divide** — each domain is a well-defined unit (call it a bounded context, a
  slice, a service, a module — the name is the codebase's choice).
- **Collaborate** — a domain reaches another only through an explicit contract,
  never by reaching into its internals.
- **Depend** — dependency between domains flows one way. No cycles, no
  back-references: if A depends on B, B must not depend on A.

## Axis 2 — Horizontal: use-case / feature layers

Modules divide horizontally into capability layers — the use-case / feature unit
that carries one piece of behavior end to end.

- **Divide** — one use case = one clear capability with a stated responsibility;
  it does not smear across domains or absorb unrelated concerns.
- **Collaborate** — a use case orchestrates the domains it needs through their
  contracts; orchestration lives in the use-case layer, not inside a domain.
- **Depend** — the horizontal layers depend in one sanctioned direction only
  (outer → inner, upper → lower). A lower/inner layer never imports an
  upper/outer one.

## Applying it

- **Define and place the parts.** For the scope in hand, define the domain
  concepts and terms it involves — each domain and each use case identifiable by
  **name + responsibility + which layer/boundary it lives in + its
  collaborators** — and mark which are **affected** and which are being
  **modified**. A part you cannot name and place is a design smell, not a detail
  to skip.
- **Judge dependency direction on both axes.** A new edge running against the
  sanctioned direction — a back-reference between domains, an inner/lower layer
  importing an outer/upper one — is a coupling defect. Flag it; do not add it.
- **Match the vocabulary to the stack, not the reverse.** Server-side and
  client-side work may borrow different names for the same two axes; keep the
  axes, let the names follow the codebase.

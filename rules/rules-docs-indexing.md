# Rules and Docs Indexing

How to decide what goes in `rules/` versus `docs/`, and how to write index
entries that point from one to the other. Applies whenever a project accumulates
enough conventions that "where does this go" becomes a real question.

## 1. Placement by Frequency, Not Topic

**Split by how often the content is needed, not by what it's about.**

- Always in force (the agent needs this judgment on every relevant action) →
  keep it inline as a `rules/` rule. This is substance, not a pointer.
- Situational deep-dive (needed only when a specific scenario comes up) →
  put it in `docs/`, reachable through a thin index entry in `rules/`.

Anti-pattern: moving always-needed content out to an on-demand doc for the
sake of uniformity ("everything heavy lives in docs/"). That forces a doc
fetch on every occurrence of something that should have been sitting inline.
Uniformity of location is not a goal; matching cost to frequency is.

The test: if you'd be annoyed to re-fetch this doc every single time the
topic comes up, it wasn't situational — inline it.

## 2. Three Rule Categories in `rules/`

Every file under `rules/` is one of three kinds. Know which one you're
writing before you write it.

- **Always-substance**: inline judgment the agent applies directly, scoped by
  `paths:`, active whenever those paths are touched (e.g. a state-management
  rule, a naming rule, a type-safety rule). The rule body IS the guidance —
  no further lookup needed.
- **Always-process**: a short global MUST rule (`paths: **/*`) that activates
  the whole indexing system itself — e.g. "before any code action, load
  relevant rules/docs and scan similar patterns for the area you're touching."
  There is exactly one job here: turn the system on. Keep it short.
- **Situational-index**: a thin pointer file. No substance of its own —
  it enumerates what exists in `docs/` and tells the agent when it's
  relevant to open one.

Concrete split (from a component-design system this method was extracted
from): the react/typescript conventions rule is always-substance, the
global "load rules before touching code" rule is always-process, and the
component-design rule pointing into `docs/` for prop-contract patterns,
state-colocation patterns, and composition patterns is situational-index.

## 3. Index Entries: Recall-First, WHAT-Only

**Do not write a per-doc WHEN trigger.** Write what the doc contains, not
when to open it.

Reasoning: two other mechanisms already carry "when" —

- the index rule's own `paths:` glob gives coarse when (only loads when
  those paths are in play),
- the always-process rule (Category 2 above) supplies the activation trigger
  system-wide.

A per-entry WHEN clause on top of those only matches the situations the
author imagined at write time, and silently misses everything else — that's
recall loss, and it's the worse failure mode: skipping a relevant doc costs
more than opening one that turns out not to be needed. Precision belongs to
the moment the agent actually opens the doc and reads it in full, not to the
index line that decides whether to open it.

Instead, write a rich WHAT for each doc:

- Enumerate every section the doc actually contains — don't summarize down
  to one sentence, list the topics.
- Seed symptom and keyword vocabulary: the raw way an agent (or a human)
  phrases the situation in the moment, not just the clean topic name.
  "8 props and messy," "infinite re-render," "3-level prop drilling" recall
  better than "prop management" or "render optimization" alone — the raw
  phrasing is closer to what actually shows up in a request or an error.
- Add a one-clause essence per topic: enough to disambiguate between two
  similarly-named docs, not enough to explain the topic itself.

Keep the heavy substance — examples, rationale, before/after diffs — in the
doc. The index's only job is to get the doc opened when it's relevant.

## 4. Format

One scannable list entry per doc:

```
- `path/to/doc.md` — **domain**: symptom/topic(essence) · symptom/topic(essence) · ...
```

A list is the right shape here because there is one real dimension (doc →
its WHAT contents), not two. Reach for a table only when there are
genuinely two aligned dimensions to compare across rows (e.g. doc × maturity
level) — a table forced onto a single dimension just adds column noise
without adding information.

## 5. Discipline

- Every `rules/` and `docs/` file: under 300 lines AND single-responsibility.
  Line count alone doesn't certify focus — a 250-line file covering three
  unrelated concerns is still wrong; split it even though it's under budget.
- When a stem collides across layers — a `foo.md` rule in `rules/` and a
  `foo.md` doc in `docs/` covering related but distinct ground — qualify
  every cross-reference: "the `foo.md` rule" versus "the `foo.md` doc."
  An unqualified `foo.md` reference is ambiguous the moment both exist.

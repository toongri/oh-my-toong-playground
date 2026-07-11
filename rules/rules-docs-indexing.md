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
- **Always-process**: a short MUST rule that activates the whole indexing
  system itself — e.g. "before any code action, load relevant rules/docs
  and scan similar patterns for the area you're touching." There is exactly
  one job here: turn the system on. Keep it short. How it's made "always"
  splits by scope:
  - Universal (applies to every project) → deploy it to the global home
    rules dir; presence there is the activator, no `paths:` glob needed.
  - Project-specific → a project rule with `paths: **/*`.
  Once a universal process rule exists globally, an individual project
  need not add its own activator — it inherits the global one.
- **Situational-index**: a thin pointer file. No substance of its own —
  it enumerates what exists in `docs/` and tells the agent when it's
  relevant to open one.

Concrete split (from a component-design system this method was extracted
from): the react/typescript conventions rule is always-substance, the
global "load rules before touching code" rule is always-process, and the
component-design rule pointing into `docs/` for prop-contract patterns,
state-colocation patterns, and composition patterns is situational-index.

Loading is not limited to `rules/` files — the same always/scoped/subtree
spectrum has three vehicles:

- Global (all projects): a file in the home `~/.claude/rules/` dir, no
  `paths:` needed.
- Project or path scope: a `rules/` file with a `paths:` glob — `**/*` for
  the whole project, `apps/backend/**` for a subtree.
- Subtree scope: a nested `CLAUDE.md` inside a subdirectory (e.g.
  `apps/backend/CLAUDE.md`) that lazy-loads only when files under that
  subtree are touched. An index can live in a nested `CLAUDE.md`, not only
  in a `rules/` file.

## 3. Index Entries: The WHAT Is a Trigger, Not an Answer

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

**The WHAT's only job is to get the doc opened — it must never substitute
for the doc.** Treat every entry as an aggressive trigger: it exists to
fire when the doc's information is needed, not to pre-answer the question.
Never approximate the doc's guidance in the index — a half-answer sitting
right there tempts the agent to act on it and skip opening the doc, which
is exactly the failure this system exists to prevent.

To make the trigger fire reliably, make the entry point rich:

- State the doc's intent/scope in one clause.
- Enumerate every concern the doc addresses — don't summarize down to one
  sentence, list every concern.

**Recall comes from breadth of concern coverage, not from symptom
vocabulary piled onto each concern.** Naming every concern the doc
addresses is what makes the agent's task match against the index; loading
one concern with multiple symptom phrases doesn't extend that coverage —
it just bloats the entry.

Each concern is written as a **name** plus, at most, one **minimal
identifying hook** — a concrete symbol or API token that pins down which
concern this is, used only when the name alone would be ambiguous. Never
write a symptom sentence or a symptom cluster in its place. Concrete
symbols and API tokens stay in — they're cheap, precise hooks. Prose
descriptors ("overused," "missing," "collapses," "confused") don't: that's
a diagnosis, and diagnosis is the doc's job, not the index's.

- Bad (a decision sentence standing in for a concern):
  `lookup method: get vs find, throw vs null on miss`
- Good (concern name + minimal hook): `lookup naming (get/find)`
- Bad (the answer leaking into the hook): `enforce withPermission()`
- Good (concern name, no resolution): `permission-enforcement convention`

This hook format invites a redundancy — avoid it: a header or
parenthetical that pre-summarizes the very concerns the entry then lists
below it. Drop the summary; the concern list is already the summary.

**No answer, no resolution — only the concern and its minimal hook.**
State what decision or topic the doc covers, never how it should be
resolved. "Covers when to colocate vs. lift state, triggered by prop
drilling past 2 levels" is a WHAT; "always lift state above 2 levels of
drilling" is an answer that leaked out of the doc and must not appear in
the index. When two similarly-named docs need disambiguating, do it by
scope or domain ("frontend state placement" vs. "backend cache state") —
never by giving away the answer. The answer must be read in the doc, not
inferred from the index line.

Keep the heavy substance — examples, rationale, before/after diffs, and
the actual resolution — in the doc. The index's only job is to get the doc
opened when it's relevant.

## 4. Format

A list entry per doc — never a table. Because each concern carries at most
a minimal hook, not a sentence (Section 3), a single inline line per doc
stays readable even when a doc covers many concerns, so **one line per doc
is the default**:

```
- `path/to/doc.md` — **domain**: concern(hook), concern(hook), concern(hook), ...
```

Nested sub-bullets are now the rare exception, not the go-to — reach for
them only when a single doc's concern set is genuinely too large to scan
on one line:

```
- `path/to/doc.md` — **domain**
  - concern(hook)
  - concern(hook)
```

Full sentences were what used to force nesting (each symptom needed its own
line to breathe); minimal hooks remove that pressure, which is why one line
is now the default and nesting the exception.

A list is the right shape here — inline or nested — because there is one
real dimension (doc → its WHAT contents), not two. Reach for a table only
when there are genuinely two aligned dimensions to compare across rows
(e.g. doc × maturity level) — a table forced onto a single dimension just
adds column noise without adding information.

## 5. Discipline

- Every `rules/` and `docs/` file: under 300 lines AND single-responsibility.
  Line count alone doesn't certify focus — a 250-line file covering three
  unrelated concerns is still wrong; split it even though it's under budget.
- When a stem collides across layers — a `foo.md` rule in `rules/` and a
  `foo.md` doc in `docs/` covering related but distinct ground — qualify
  every cross-reference: "the `foo.md` rule" versus "the `foo.md` doc."
  An unqualified `foo.md` reference is ambiguous the moment both exist.

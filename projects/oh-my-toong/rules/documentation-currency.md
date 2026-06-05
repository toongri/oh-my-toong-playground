# Documentation Currency

When you change what a component does or how the system works, the docs that
describe it go stale silently. Updating documentation is part of the change, not
an optional follow-up. Do not consider a functional change done until the docs
that describe it are current.

## When This Rule Applies

A change is "functional" — and triggers this rule — when it alters observable
behavior or the component inventory:

- Adding, removing, or renaming a skill, agent, command, hook, or rule
- Changing a component's behavior contract, workflow, or invocation
- Changing sync behavior, `sync.yaml` format, platform/adapter support, or make targets
- Changing the directory layout or core architecture

Pure internal refactors that leave behavior and the component inventory unchanged
do not trigger it.

## What to Check and Update

Before considering the task done, read each surface and update what the change
made stale:

1. **README** (`README.md`) — features list, philosophy, the docs-catalog table,
   and any component counts the README states ("스킬 N종" 등).
2. **`docs/`** — the category file documenting the affected component. The README
   docs-catalog table maps each category to its file; use it to find the right one.
3. **`CLAUDE.md`** — the architectural surfaces that drift the same way: Core
   Skills table, Development Commands list, adapter table, directory layout.

## Non-Negotiables

- **Bilingual pairs stay in lockstep.** README and every `docs/` file ship as a
  Korean `.md` + English `.en.md` pair. Update both, or neither is current.
- **Catalog before content.** When a doc file is added or removed, update the
  README docs-catalog table that links to it — a dangling or missing catalog row
  is a broken doc surface.
- **Counts are claims.** If a doc states a component count and you add or remove a
  component, that count is now a claim the repo no longer satisfies — correct it.

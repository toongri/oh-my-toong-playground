# Project Documentation Currency

When you change how oh-my-toong works or what components it provides, keep its
project-facing documentation current. Component grounding documents are governed
by the separate component-docs rule.

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

Before considering the task done, read each project-facing surface and update
what the change made stale:

1. **README** (`README.md`) and **README.en.md** — project identity, feature
   list, philosophy, project-doc catalog, and component counts.
2. **Project docs** — update a root `docs/` document when it explains
   oh-my-toong's architecture, workflow, or operation. Component grounding docs
   under `docs/components/` are handled by the component-docs rule.
3. **CLAUDE.md** — the architectural surfaces that drift the same way: Core
   Skills table, Development Commands list, adapter table, directory layout.

## Non-Negotiables

- **README pairs stay in lockstep.** README and README.en.md describe the same
  project-facing surface. Update both, or neither is current.
- **Catalog project docs only.** The README docs-catalog table lists
  project-facing docs. Component grounding docs are discovered through their
  companion index rule and `docs.items` declaration.
- **Counts are claims.** If a doc states a component count and you add or remove a
  component, that count is now a claim the repo no longer satisfies — correct it.

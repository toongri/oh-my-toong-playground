# Component Docs Currency

Component grounding docs hold the criteria, examples, and rationale for a
component. They are not project-explanation docs and do not automatically belong
in the README docs catalog or in a Korean/English pair.

## When This Rule Applies

Apply this rule when a change:

- adds, removes, or renames a component's grounding doc or its index rule;
- changes the behavior or decision criteria described by the grounding doc; or
- changes the `rules.items`, `docs.items`, or path that connects the index to the
  deployed doc.

## Component Doc Contract

- Keep the thin index rule and its grounding doc aligned. The index states the
  concern and points to the final deployed path; the doc contains the detail.
- Register both sides in the same sync scope: the index in `rules.items` and the
  source doc in `docs.items`.
- For global component docs, keep the source under `docs/components/`. The
  platform-agnostic docs deployer materializes it under the target's `docs/`
  directory, so references must use that final path rather than a platform
  directory.
- Choose language coverage per component doc. A bilingual pair is required only
  when that doc's own audience or policy requires it.

Before considering the change done, run the relevant schema/component checks and
a sync dry-run that shows both the index rule and its grounding doc.

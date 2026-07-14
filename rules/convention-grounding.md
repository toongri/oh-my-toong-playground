# Convention Grounding **MANDATORY**

Before any code action — implementing, exploring a design, refactoring — first consult the relevant guidelines or context and scan existing similar patterns, so the change stays consistent with the project's conventions.

- Consult the documents that govern the area you are about to touch — its conventions, guiding principles, best practices, and recommendations, plus any design docs and prior decisions — before deciding how to build. These are what tell you the intended direction, not just the current shape of the code.
- Scan existing similar patterns — comparable components, hooks, tests, modules — and follow them: naming, structure, idiom, error handling.

Never write from habit without first grounding in the project's own guidelines and existing patterns. Consistency with what already exists beats a locally-preferred approach.

## Module conventions

A repo can be split into modules — self-contained sub-trees that each carry their own conventions. When you design for or work in one, **you MUST actively consult that module's `docs/`** to understand its conventions and intent — that is where the deep guidance lives, and it does not load on its own. Keep it in view as you go: re-check it, don't consult once and forget.

Designing for a module without its conventions is the failure this rule exists to prevent. You MUST be able to quote the constraint you are working under, with its source path.

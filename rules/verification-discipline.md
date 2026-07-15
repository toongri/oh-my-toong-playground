# Verification Discipline

How much to verify, and when — scoped to the change, not the whole project.

## Inner loop = verify only what the change affects

While iterating, run only the verification that the changed files actually affect — never the entire test suite, entire type-check, or entire build. Whole-project verification on every edit is the single largest source of wasted compute and memory pressure. Scope to the changed unit and its direct dependents.

## Completion gate = affected scope, not the full suite

The final "is it done" check runs over the affected scope — the changed code plus what depends on it — not an unconditional full-project run. "Affected" is the correct completeness bound: it catches every dependent the change can break, without paying to re-verify untouched code.

## Projects declare the contract; the harness calls it by name

Each project exposes its own verification commands — a fast changed-scope command for the inner loop, and an affected-scope command for the completion gate — under names the project owns. The harness invokes them by name and does not hardcode any language's tool. (For example, one project might name these `verify:quick` and `verify:full`; another might expose Gradle tasks or a Makefile target. The names belong to the project, not to this rule.)

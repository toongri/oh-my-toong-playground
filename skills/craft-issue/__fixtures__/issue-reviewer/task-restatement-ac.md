# E2 — task-restatement-ac

**Expected verdict:** REQUEST_CHANGES
**Expected anchor:** `Task restatement`
**Rule source:** `references/issue-craft.md` § Observable-AC Rubric › AC Anti-Patterns → `Task restatement`

**Single violation by design:** the sole AC's outcome line restates the task ("The `--dry-run` flag
is implemented") instead of naming an observable consumer-facing outcome. The Verification line is
itself concrete (prints planned actions, exits 0, does not invoke the pipeline), no weasel words are
used, the AC is not compound, and — because this is a pure-capability CLI flag (non-transition, no
measurable outcome to watch post-release) — no User Flow or Post-Release Observation section is
owed. So the only thing left to cite is the task-restatement outcome.

---

## Dispatch payload

**Original request (verbatim):**
Add a `--dry-run` flag to the `deploy` CLI so operators can preview the planned actions without
executing them.

**child:deploy-dry-run-flag**
## Problem
The `deploy` CLI has no way to preview what it will do; operators must run it for real to see the
plan, which risks unintended changes to production.

## Pre-Context
- The deploy CLI entrypoint is `cli/deploy.ts` (parses flags and runs the deploy pipeline; confirmed
  by Stage 3 investigation).

## AC
- [ ] **[Outcome]**: The `--dry-run` flag is implemented for the deploy CLI.
      **Verification**: Run `deploy --dry-run` against a test config and confirm it prints the
      planned actions and exits 0 without invoking the deploy pipeline.

## Non-Goals
- This issue does not add a `--dry-run` flag to any CLI other than `deploy`.

## References
- N/A — no prior art gathered for this flag.

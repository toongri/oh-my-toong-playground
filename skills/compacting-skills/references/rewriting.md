# Rewriting and test migration

## 1. Outline (`outline.md`)

- New table of contents. For every MUST and ENFORCED row: the one section it will live in. One rule, one location.
- Generating rules that replace case lists, each with the ids it absorbs.
- JUDGMENT rows: kept as a principle line (which) or deleted.
- Artifacts to delete: only those no code, test, or other doc reads. For each, list the sentences that promise behavior resting on it; those sentences change in the same section.
- A target length is a forecast, not a gate.

## 2. Test strategy (`test-strategy.md`)

Per pin row (see rule-inventory.md):
- `WORDING` → delete.
- `RULE` → delete once a scenario covers it; when the rule names a code value (command, flag, enum, state, path), add a doc-vs-code test instead: extract the value from the doc and assert it equals the code's definition, so the test breaks when either drifts.
- `CONTRACT` → keep; where the other side is code, prefer asserting doc ⊆ code definitions over pinning sentences. Add a consumer-side test in the consuming skill when the contract crosses skills.
- `NEGATIVE-GUARD` → keep.
- Fix fragile pins (wrong anchor) while here.

## 3. Migrate tests first

Do the migration before rewriting so wording pins do not steer the rewrite. Prove each new test bites: change the value on one side and watch it fail, then restore. Tests and lint pass → commit.

## 4. Rewrite one section at a time

- Write from the outline, not by trimming old sentences in place.
- Keep exact literals for contracts: headings, enums, flags, field names, paths, command spellings.
- Before writing a literal that some test matches by regex, read the regex. (A pilot test required `job.ts start` to appear with `--ledger-root`; a prose mention of `job.ts start` broke it.)
- Edit with an exact-replace tool. Check escapes after each edit when the doc contains escape sequences (count them before and after).
- After each section, dispatch one fresh agent for a two-way trace check of that section:
  - Old→new: for every MUST/ENFORCED row in the section, the new sentence that carries it, with the same scope and conditions. PASS / WEAK / LOSS.
  - New→old: for every new sentence, the rule ids it comes from; flag any sentence that widens, narrows, or adds a condition.
  - Code: every state, field, command, and enum the new text names exists in code with that meaning; every state the code can produce at a step the text routes is handled.
  - Premises: every deleted sentence or artifact that another sentence relied on.
- Fix LOSS and flagged sentences; WEAK needs a reason to accept. Run tests and lint. Commit the section.
- When a fix adds a sentence, check that sentence alone against the old rule's exact scope; a restored rule that is broader than the original is a new regression.

Measure the whole doc once at the end (step 8) rather than per section; per-section trace checks locate problems, the end measurement proves behavior.

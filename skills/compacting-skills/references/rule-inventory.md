# Rule inventory

Turn the current doc into a spec before touching it. Output: `rules/<slice>.md` per slice, `rules/DECISIONS.md`, `rules/<slice>-keep.md`, `pins/pins.md`.

## 1. Slice and extract

Split the doc into slices of roughly 150–250 lines on section boundaries. Dispatch one analysis agent per slice in parallel. Each writes one table per section heading, in document order:

| id | lines | rule | class | evidence | note |
|---|---|---|---|---|---|

- `id`: `<slice>-<3-digit seq>`, unique, document order.
- `lines`: source line(s) in the frozen old doc.
- `rule`: exactly ONE normative statement (instruction, prohibition, condition→action, required output shape), paraphrased tight. Split compound sentences. Rationale and examples are not rules: attach them as `note` or list them under "Non-normative text".
- `class`:
  - `ENFORCED` — a script, validator, or hook enforces it. Evidence = `file:line` the agent opened. Note what the agent must still know (the command, the refusal text).
  - `DOC-ONLY` — nothing enforces it; the model must follow the text.
  - `REDUNDANT` — stated elsewhere; evidence = the canonical id or `file:line`. Exactly one occurrence stays canonical. A rule fully stated in a sibling reference file is REDUNDANT with that file as canonical.
  - `STALE` — no longer true; evidence = why (code line, grep result).
- `note`: case lists that look like instances of one rule → `GEN: <generating rule>`.

End each slice file with: "Non-normative text" (lines + summary), "Case-enumeration candidates" (ids → proposed rule), "Uncertain" (ids whose class is unsettled, and any SKILL.md vs reference-file conflict with both line refs).

Tell analysis agents which code and consumers to check: the skill's scripts, shared libs, hooks, and every other skill, agent, or test that reads this doc. Give the code-graph tool first, grep only for markdown and literals.

## 2. Map doc-reading assertions (pins)

Find every test and validator that reads the doc's text (`readFileSync` of the doc, grep for its path, validators over skill files). One row per assertion:

| file:line | what it matches | class | protects | note |

- `CONTRACT` — another file or code parses or mirrors this text (heading list a validator also holds, an enum a consumer reads, a row another skill's test parses). Keep; the doc must keep complying.
- `RULE` — protects a behavior rule. Needs a scenario or doc-vs-code test, then the pin goes.
- `WORDING` — pins phrasing only. Delete.
- `NEGATIVE-GUARD` — asserts something is absent. Usually keep.

Also note fragile pins (an `indexOf` that matches a prose mention instead of the real heading).

## 3. Independent review and conflicts

One fresh agent reviews the inventory for missed sentences and wrong classes; apply its findings. Collect every place where the doc contradicts itself (or a reference file) into `rules/DECISIONS.md`: both texts, line refs, what code does, a recommendation. The user decides each one before scenarios are written; scenarios then expect the decided answer and carry the flag `old-doc-conflict` where the old doc said otherwise.

## 4. MUST or JUDGMENT

For every DOC-ONLY row, decide MUST (with the criterion number 1–5 from SKILL.md and its evidence) or JUDGMENT (with a one-line reason). Write `rules/<slice>-keep.md` covering every row. Evidence strength for criterion 4 must be uniform across slices: a commit or record showing the failure, not a guess.

Gate: every normative sentence maps to exactly one id; every class has evidence; every DOC-ONLY row is MUST or JUDGMENT.

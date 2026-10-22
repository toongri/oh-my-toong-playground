# Behavior measurement

Prove the new doc makes agents act as the old one did (or better where a decided conflict says so). Same suite, same agent setup, same grading rules, before and after.

## 1. Write scenarios

Cover every MUST row, every ENFORCED row (what its note says the agent must still know: when to run the command and how to read its refusal), and every RULE pin with at least one scenario. Register each scenario with `scripts/measure.ts --file <evidence-dir>/measurement.json add-scenario --id <id> --set <set> --rules <ids>`; it refuses a duplicate id. Only `measure.ts` writes `measurement.json`. Check coverage mechanically: every MUST, ENFORCED and RULE-pin id in the keep files appears in some scenario's `rules` there, and every `### <id>` in `scenarios-*.md` is registered. Format per scenario:

```
### S-<slice>-<nn> <short title>
- Rules: <ids>
- Type: retrieval | application | pressure
- Situation: <concrete state: files, outputs, what the user says>
- Question: <what to decide or do>
- Expected: <the answer the doc requires, with rule ids or code lines>
- Grading: CORRECT if … PARTIAL if … WRONG if …
- Flags: none | old-doc-conflict | doc-gap
```

- **State every deciding fact in the situation.** If the answer turns on whether a non-goal covers the change, say so outright. Ambiguous situations made pilot scores swing between runs with no doc change.
- Discipline rules get pressure scenarios (time pressure, authority, sunk cost, "just do X").
- Include scenarios that need two or more sentences together (A routes to B, B is handled by C). One-sentence questions cannot see gaps between sentences.
- `doc-gap`: the old doc is silent; the expected answer comes from code. `old-doc-conflict`: the decided answer differs from the old doc; a baseline miss here is expected, a new-doc miss is a must-fix.
- Grading sentences must be literal enough that two graders agree. Write PARTIAL for the common hedge, not just for omissions.

Build question-only sets: `runs/sets/<set>.md` with ~7 scenarios each (situation + question, no expected answer, no ids beyond the scenario id). Freeze the old doc in `old-doc/` with its commit.

## 2. Run

- One fresh agent per set per rep, 5 reps. Never reuse an agent across reps or sets.
- Answer prompt: the doc path (it may follow pointers to reference files), the set file, an output path, "answer from the doc", and "write a backslash as `<BS>`" (file-writing tools decode backslash escapes and corrupt answers about escaping).
- Answer agents get no rubric, no scenario file, no other evidence.

## 3. Grade

- Grader agents read `scenarios-*.md` (the rubric) and the answer files, apply the Grading sentence literally, and return a JSON array `[{scenario, rep, grade, note}]` with grade C/P/W as their final message. Graders never run `measure.ts`; you record each array with `measure.ts --file <evidence-dir>/measurement.json record-grades --run <run>` (array on stdin). Name each run for what it measured (`baseline`, `new`, `old`/`mid` for targeted sets). It refuses the whole batch on an unregistered scenario, a bad grade, or a scenario and rep already graded in that run.
- Where reps of one scenario mix C and P (or anything with W), one fresh adjudicator per scenario reads only that scenario's rubric and its five answers and re-applies the grading sentences consistently. Change a grade only where the grader misapplied the rubric, with `measure.ts ... adjudicate --run <run> --scenario <id> --rep <rep> --grade <g> --reason <why>`; it keeps the before and after grade and the reason.
- Use the same grader instructions and adjudication rule for baseline and new runs. A stricter adjudicator in a later run is a measurement change, not a doc change: when a drop appears, re-grade the baseline answers with the same strictness, into a new run name, before concluding.
- Score: C=1, P=0.5, W=0; mean per scenario over 5 reps; total over all answers. `measure.ts ... score --run <run> --out <file>` does this and exits 1 when a registered scenario is missing a rep or has no grades in that run; a run that exits 1 is not a measurement.

## 4. Interpret

Baseline misses:
- doc defect (conflict, missing example, missing rule) → must-fix: the new doc must score 1.0.
- scenario defect (ambiguous situation, rubric asks for something the question did not) → fix the scenario, re-run that set for all versions you compare.
- one-off omission → "no drop allowed".

Regression table `regression.md`: scenario, baseline grades, baseline score, new grades, new score, run source, delta. For every drop, read the raw answers before deciding the cause: doc, scenario, or grading. Record the verdict and evidence; never re-run until the number looks good. A doc cause is a regression, not an explanation: fix the doc and re-run that set before step 8 can pass.

## 5. Targeted scenarios for audit findings

For each regression the audit finds, write a scenario that the regression would break, and measure three versions: OLD (before compression), MID (compressed, before the fix), NEW (after the fix). The fix is shown working when MID < NEW. MID already correct means another sentence or a reference file covered the gap (a latent, low-severity regression). A scenario that fails on all three versions is a scenario defect; rewrite it.

## 6. Real-run comparison

When the skill can run end to end on a fixed input, plant known cases in a small fixture (for a reviewer: an in-scope defect, an out-of-scope defect, a non-goal case, a generated file; for a planner: a small request with a known scope trap). Keep the answer key outside the fixture. Run the old and new doc once each, in a trusted worktree (sandboxed runs in untrusted directories can fail with EPERM and measure nothing). Grade both runs case by case against the answer key: a positive case passes when reported, a negative control (out-of-scope, non-goal, generated file) passes when not reported as a finding. Pass: the new run gets right every case the old run got right, and both outputs pass the skill's own validators. A case the new run gets wrong is a regression even when the old run reported nothing more; record cases both runs get wrong as follow-ups. Remove the fixture worktree and branch afterwards.

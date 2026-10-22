# Compression regression audit

Run after the regression measurement passes, and again on any external review finding. The measurement shows the asked questions still get the right answers; the audit looks for what no question asked.

## 1. Dispatch

One analysis agent per section of the NEW doc (about five for a long doc), in parallel. Give each: the frozen old doc, the new doc at a fixed commit, its section line ranges in both, the keep files, and the code and consumer paths. Each checks all four directions below and returns findings with severity, old line, new line, and evidence.

## 2. The four checks

1. **Old→new presence.** Every MUST and ENFORCED rule still has a sentence with the same scope and conditions.
2. **New→old fidelity.** Every new sentence states no more and no less than its source rule. Typical failures:
   - "lines or code" shortened to "lines" (narrowed);
   - "exclude only when evidence is complete" rewritten as "never exclude on truncated evidence" (widened, now contradicts a nearby allowance);
   - a statement made unconditional that was true only under one condition ("resume is refused past the deadline" when only the hard cap refuses);
   - a cited source dropped ("from the `non_goals` array"), leaving the agent to quote the wrong text.
3. **Code and consumers.** Every named state, field, path, command, and enum matches code. Enumerations match the code's full set: when the doc lists the states to act on, compare with every state the code can produce at that point (a resume loop that names three states while the code can return five leaves two stuck). Check every doc, agent, and test that reads this doc.
4. **Premises.** For each deleted sentence or artifact, find sentences that depended on it (a promise that the same id re-attaches lost its basis when the manifest that stored the id was deleted; dropping "a missing CLI stalls at once" left the loop with no route for that state).

Also record factual errors carried over from the old doc.

## 3. Verify and classify

The coordinating agent re-checks every finding against the doc text and code itself. Classify:
- **compression regression** — the old doc was right, the new doc is not → fix now.
- **pre-existing defect** — the old doc had it too → list as follow-up; fix now only if the user decides it. Fixing pre-existing behavior changes the skill's design, which is out of a compression's scope.
- **not a defect** → drop with the reason.

## 4. Fix and prove

- Fix regressions in the doc only. Run an independent check of the fix text (a fresh agent with the old rule and the new sentence): fixes tend to over-restore.
- Write targeted scenarios for the fixed regressions and measure OLD/MID/NEW (behavior-measurement.md §5). Re-run the full suite on the fixed doc.
- Record everything in `audit.md`: findings table, classification, fixes with commits, targeted scores, follow-ups.

## 5. External review findings

Treat each finding as a hypothesis: confirm it in code before changing anything, classify it as above, fix, reply in the review thread with what changed and why. A confirmed finding the audit missed means a check above was skipped; note which one.

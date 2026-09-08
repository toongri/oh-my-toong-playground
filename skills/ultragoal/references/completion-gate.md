## Completion Gate

After a sisyphus pass, completion is NOT self-declared by stopping. Run the objective-level completion check yourself (the orchestrator), inline: take the **verification surface as PROSE requirements** — a completeness Spec — and confirm that every prose-stated requirement is reflected in the deliverable, rendering an APPROVE / REQUEST_CHANGES / COMMENT verdict.

Run the **automated checks (build / test / lint)** inline and map the verification surface to concrete evidence per the rubric below. The expensive **hands-on adversarial matrix is NOT run in the autonomous loop** — that final, costly QA is the human's, performed once after the loop reports complete (the objective self-check covers automated correctness + completeness; the human covers hands-on confidence). The rubric forces an evidence-based verdict and asserts each element independently:

- **prompt-to-artifact mapping** — map every explicit requirement, numbered item, named file, command, test, gate, and deliverable in the verification surface to concrete evidence; an unmapped requirement is incomplete.
- **proxy-signal refusal** — refuse proxy signals as completion by themselves: passing tests, a green build, a complete manifest, or substantial effort count only insofar as they cover every requirement in the verification surface.
- **verify-the-verifier** — confirm that any test suite, manifest, or green status actually COVERS the objective's requirements before relying on it (the FALSE-GREEN guard: not "are tests green?" but "do the green tests cover every objective requirement?").
- **uncertainty = not-achieved** — treat any uncertain, weakly-verified, or uncovered requirement as not achieved; doubt drives REQUEST_CHANGES, never APPROVE.

Because the orchestrator now runs this check on its own pursuit, the rubric is the discipline against self-deception — the objective lane is self-attested, and the genuinely independent structural teeth are the **code-review lane** (a fresh reviewer, below) and the human's final hands-on QA. Apply the rubric strictly: a self-attested APPROVE that skips proxy-refusal or verify-the-verifier is exactly the false-complete the gate exists to prevent.

<!-- story-layer:start -->

**Per-story re-derivation (same inline check, run incrementally).** Run this self-check **once per story, immediately after that story's own sisyphus dispatch**: a story's verdict must read `APPROVE` before the next story is dispatched. Each re-derivation authors (or updates) the structured verdict artifact at `$OMT_DIR/ultragoal-verdict-{sid}.json`, accumulating one entry per story. The orchestrator writes this file directly; `request-complete` validates its schema and per-story verdicts, not its author. The artifact schema is:

```json
{
  "objective_verdict": "APPROVE | REQUEST_CHANGES | COMMENT",
  "stories": [
    { "id": "<story-id>", "verdict": "APPROVE | REQUEST_CHANGES", "evidence_refs": ["<path>"] }
  ],
  "verifier": "<orchestrator objective self-check>",
  "at": "<ISO timestamp>"
}
```

For each non-retired story, map the story's acceptance criteria and verification surface to concrete evidence and render an `APPROVE` or `REQUEST_CHANGES` per-story verdict. A single non-APPROVE per-story entry blocks completion regardless of the `objective_verdict` field — `objective_verdict === 'APPROVE'` alone is never sufficient.

`request-complete` reads the artifact from the conventional path internally (no path argument). It refuses if: the artifact is absent or schema-invalid; any non-retired story entry is non-APPROVE; any non-retired story is `unconfirmed`; an entry is missing for any non-retired story; zero non-retired stories exist; or the existing dual gate is unmet (`objective_verdict !== 'APPROVE'` in state, or empty `completion_evidence_paths`). The independent review gate additionally requires a valid `COMPLETE` artifact bound to the current scope contract, with no undismissed `IN_SCOPE` finding and no `UNKNOWN` finding. Missing scope evidence or a stale contract hash refuses completion, including an otherwise empty review. This check runs inside `request-complete`, independently of the orchestrator's judgment. Only when both lanes pass does it write `phase=complete` and `active=false`.

<!-- story-layer:end -->

**Code-review lane (starts at the final story; retries follow bounded admission).** Middle stories carry only the lightweight, self-attested per-story verdict above; no code-reviewer runs on them. Once every confirmed story's per-story verdict reads APPROVE, dispatch a fresh **code-reviewer** agent, independent of the builder (sisyphus), over the ENTIRE accumulated diff — all stories combined, not just the final one. Self-review by the builder is forbidden.

- **Before dispatching**, run `bun ${CLAUDE_SKILL_DIR}/scripts/ultragoal-state.ts serialize-review-context` and put its full stdout JSON — the 5-slot payload `{what_was_implemented, description, requirements, project_context, non_goals}` — in the dispatch prompt. The code-review skill's Step 1 Intent Block Gate recognizes this shape (its "Non-interactive dispatch (completion-gate)" row) and skips its own user interview while still detecting requirement-gap findings.
- **The code-reviewer writes `$OMT_DIR/ultragoal-codereview-{sid}.json` itself.** Pass it only the session-derived path; never transcribe finding content.
- **A PreToolUse hook** (`codereview_guard_core_run` in `hooks/write-guard-core.sh`) denies writing that path unless the tool call's `agent_type` is `code-reviewer`. It raises the cost of forging the artifact, it does not make forgery impossible — the write shapes it recognizes and the gaps that stay open are in `CLAUDE.md`'s Code-review artifact identity guard entry.
- **The sibling `$OMT_DIR/ultragoal-verdict-{sid}.json` is NOT guarded** — the orchestrator is its author.

A code-reviewer may legitimately remain in flight for 2–3 hours. Elapsed time alone is not evidence to interrupt, cancel, or re-dispatch it. Keep waiting while it remains live; intervene only on concrete terminal evidence such as an explicit reviewer timeout or deadline, a canceled or error state, or verified loss of its live process or job artifact.

**The code-reviewer dispatch prompt carries exactly two things:** the `serialize-review-context` 5-slot JSON verbatim and the session-derived artifact path. Keep this contract on every dispatch. The serializer embeds the frozen scope contract and its SHA-256 as JSON between `[SCOPE_CONTRACT]` and `[/SCOPE_CONTRACT]` inside `project_context`; copy it intact. Add no finding history, defect pattern, desired verdict, or hand-authored diff range. The reviewer derives its range itself. A broad branch diff is inspection material, never permission to repair unrelated commits.

### Scope admission before repair

Finders suppress scenarios fully explained by declared non-goals before candidate generation. For every generated candidate, the independent verifier records **scope first, validity second** against the frozen contract, evaluating the failure/cost AND the proposed remedy. OUT_OF_SCOPE records preserve generated candidates excluded during verification; they do not require a search for unrelated work:

| Scope | Required evidence | Orchestrator action |
|---|---|---|
| `IN_SCOPE` / `requirement` | Cite an approved story/AC or outcome/verification clause; explain how the local repair improves that deliverable without adding capability | Every `CONFIRMED` item enters one repair batch, including LOW and cleanup |
| `IN_SCOPE` / `regression` | Cite the preserved contract and the causal path from this pursuit's change to broken prior behavior | Restore prior behavior with the smallest repair or rollback of this pursuit's change |
| `OUT_OF_SCOPE` / `non_goal` | Cite the matching non-goal decider | Record exclusion; no repair or new story |
| `OUT_OF_SCOPE` / `unrelated` | Compare against the approved outcome and show no requirement or causal regression connection | Record exclusion; no repair or new story |
| `UNKNOWN` / `uncertain` | Name the unresolved scope question with its contract reference | No repair; obtain independent clarification from evidence; a genuine product-scope choice belongs to the user |

A file in the allowed boundary is only a location permission. Shared files, useful improvements, a senior reviewer's request, generic best practices, and codebase analogs do not authorize new goals. Derived expectations can explain an approved requirement; they cannot become new acceptance criteria. A real CSV defect can justify a local CSV fix, but cannot justify a non-goal multi-format framework. If the only known fix requires excluded behavior or a wider boundary, leave it `UNKNOWN` and seek a scope decision; never silently broaden the contract.

A non-goal does not excuse damage introduced by this pursuit. Restore the prior behavior by correcting or reverting the offending change inside the boundary. Do not use the regression label to modernize the excluded subsystem or repair a pre-existing defect.

**Executor handoff:** include only independently admitted `IN_SCOPE` + `CONFIRMED` findings, their scope evidence, the original story AC/verification surface, constraints, boundaries, and non-goals. The executor checks the remedy against this same contract before editing. A mismatch returns for adjudication; it is not a license to execute the reviewer's suggestion. Never dispatch an entire unfiltered findings report as a repair list.

### Bounded re-review

Repair all admitted confirmed findings together; run affected automated checks; then obtain a fresh independent review, including LOW-only batches. The reviewer checks the accumulated objective diff against the same frozen contract. Every newly discovered item must independently satisfy the same admission test; passing an earlier review neither authorizes new work nor excuses a newly proven in-scope defect. No review-driven story creation, contract rewriting, new feature, or generalization is permitted. Keep the existing finite dispatch budget; exhaustion leaves the pursuit incomplete rather than lowering the completion standard.

The artifact schema the code-reviewer must emit:

```json
{
  "status": "COMPLETE|INCONCLUSIVE",
  "scope_contract_sha256": "<hash copied from the serialized scope contract>",
  "findings_report": "<findings.md 경로>",
  "findings": [
    {
      "class": "correctness|regression|cleanup|requirement-gap",
      "verdict": "CONFIRMED|PLAUSIBLE",
      "impact": "HIGH|MEDIUM|LOW",
      "ref": "<file:line>",
      "scope": "IN_SCOPE|OUT_OF_SCOPE|UNKNOWN",
      "scope_evidence": {
        "basis": "requirement|regression|non_goal|unrelated|uncertain",
        "reference": "<contract field or confirmed story id>",
        "rationale": "<quoted clause, causal evidence, and bounded remedy or exclusion reason>"
      }
    }
  ],
  "reviewer": "<reviewer id>",
  "at": "<ISO timestamp>"
}
```

`status` is **required**. `COMPLETE` = the reviewer rendered a verdict over the diff, so findings (possibly empty) are trustworthy. `INCONCLUSIVE` = the review did not finish — reviewer timeout, ack-only response, a `BLOCKED` reviewer, or genuine uncertainty — so `findings` is not exhaustive even when empty. An artifact missing `status` is schema-invalid and refused exactly like an absent one; there is no default-to-COMPLETE coercion.

`impact` is **required on every finding** — a finding without one invalidates the whole artifact, exactly like a missing `status`; there is no default impact coercion. `verdict` measures confidence (assigned by the verifier); `impact` measures harm (assigned by the code-review orchestrator, per that skill's case lists). `findings_report` is the path to the review's `findings.md` — the full 7-field cards the summary findings were cut from, preserved so a finding can be re-adjudicated later from its original text.

`scope` and `scope_evidence` are required for every finding. References resolve to `outcome`, `verification_surface`, `constraints`, `boundaries`, `non_goals`, or a confirmed active story ID. A requirement uses outcome/verification/story evidence; an exclusion uses its non-goal decider or outcome comparison. The runtime checks valid references, allowed scope/basis combinations, nonempty rationale, and the current contract hash. The independent verifier owns the semantic truth of that evidence; a hash is identity, not proof of correctness.

**Pass signal:** `COMPLETE`, matching scope contract hash, no `UNKNOWN`, and no undismissed `IN_SCOPE` findings. Impact controls priority, never whether an improvement is done.

- `IN_SCOPE + CONFIRMED` at **every impact**: batch-repair, affected checks, then fresh independent review. There is no nonblocking LOW/FIX shortcut.
- `IN_SCOPE + PLAUSIBLE` at **every impact**: independent adjudication before repair; do not leave an unresolved low-impact claim as report-only. If evidence refutes it, the reviewer removes it; if evidence confirms it, it joins the repair batch.
- `OUT_OF_SCOPE`: nonblocking exclusion, retained in the report with its rationale. Do not fix it or ask for routine dismissal.
- `UNKNOWN`, invalid/stale artifact, or `INCONCLUSIVE`: completion blocked; no speculative repair. Re-review when evidence can settle it. If the contract itself needs a product decision, ask the user without changing scope.

An old artifact without this contract must be re-reviewed. The orchestrator never upgrades it by adding scope fields or copying a current hash.

### Common mistakes under review pressure

| Rationalization | Required response |
|---|---|
| “CONFIRMED/HIGH means fix, even though it is a non-goal” | Scope admission comes first; exclude the unrelated item |
| “The helper works, but the reviewer requires a framework” | Compare the remedy to the original AC; retain a bounded implementation |
| “LOW is only a note; CI is green” | Every admitted confirmed improvement remains incomplete until repaired and independently checked |
| “Same file / analog / next review round makes it part of the goal” | Cite the frozen requirement or change-caused regression; otherwise exclude |

**Red flags:** a repair list containing an excluded item; a story added from review feedback alone; a changed non-goal to obtain approval; completing with an unresolved in-scope LOW item. Stop that action and apply admission again.

### Wrong blocking finding: propose a dismissal

An admitted `IN_SCOPE` + `CONFIRMED` finding blocks completion structurally. When such a finding is **wrong**, propose a user-authorized dismissal with a quoted refutation. PLAUSIBLE findings require independent adjudication and cannot use dismissal.

**Trigger — when you can quote the refutation.** After reading a blocking finding, go to the cited `file:line` and look for the line, guard, or invariant that makes its failure scenario unreachable. If you can quote one, propose a dismissal on your next turn. If you cannot quote one, keep its scope/validity routing: confirmed in-scope items go to sisyphus; plausible items go to adjudication. Scope disagreement is resolved by the independent reviewer against the frozen contract, not by repairing excluded work. Disagreeing with a finding you cannot refute in a quoted line is not a trigger.

**The proposal carries four parts, in this order:**

1. The finding as the reviewer stated it — its `ref`, its `class`, and its claim in one line.
2. The refuting quote — the exact source line, with its own `file:line`.
3. Why that line makes the reviewer's failure scenario unreachable.
4. The exact command for the **user** to run — in their terminal, or by prefixing it with `!` in the prompt:

```
bun ${CLAUDE_SKILL_DIR}/scripts/ultragoal-state.ts dismiss-review-finding \
  --ref '<file:line>' --class <correctness|regression|cleanup|requirement-gap> --rationale '<the refutation from part 3>'
```

Then stop and wait. **You never run this command yourself** — a `PreToolUse` guard denies it on your Bash path on both Claude and Codex, so the authorization is structural rather than a rule you are trusted to follow. The same guard covers `approve-review-dispatch-renewal` for the same reason: both let this loop clear its own completion gate.

**Scope of one dismissal.** It removes exactly one finding from the blocking set — remaining `CONFIRMED` blocking findings still block, and each needs its own proposal. It is pinned to the current artifact's exact bytes, so it lapses when the next review round writes a new artifact; a genuine defect that later appears at the same `file:line` blocks normally.

The command refuses a missing or empty `--rationale`, and any `--ref` with no matching admitted `IN_SCOPE` + `CONFIRMED` finding in the current artifact — so a dismissal cannot be issued ahead of the finding it answers. PLAUSIBLE, OUT_OF_SCOPE, and UNKNOWN findings cannot be dismissed. It also refuses when the artifact holds **more than one** admitted `IN_SCOPE` finding at that same `ref` and `class`: a dismissal cannot tell them apart, so clearing one would clear the other too. Report both findings to the user instead; the block stands until the review round that produced them is superseded.

**After the dismissal.** Re-run the completion check. If no blocking finding remains, proceed to `request-complete`; the dismissed finding is still reported in the completion summary, with its rationale. If the user declines the proposal, retain the finding and its scope/validity routing. Declining dismissal does not authorize a non-goal or turn a plausible claim into a confirmed defect.

### Five-round review dispatch budget

Before an active `phase=pursuing` code-reviewer dispatch, the Claude and Codex `PreToolUse` hooks automatically run `claim-review-dispatch`; an allowed claim persists `used += 1` before dispatch. The initial cap is 5. Per-story dispatches, non-reviewer dispatches, and any non-pursuing state are unaffected. The hooks do not change `code-review` behavior; they only decide whether the already-planned code-reviewer dispatch may proceed.

At the cap, the hook denies the next dispatch and the AI must ask the user whether to **마무리** or **계속**. A completion-eligible artifact (a matching-scope `COMPLETE` artifact with no unresolved admitted finding and no `UNKNOWN`) also denies re-dispatch until the AI either runs `request-complete` or asks to continue. “마무리” cannot waive an unresolved item; when the gate fails it means stop incomplete. To continue, the orchestrator presents this command and the **user** runs it — in their terminal, or by prefixing it with `!` in the prompt:

```
bun ${CLAUDE_SKILL_DIR}/scripts/ultragoal-state.ts approve-review-dispatch-renewal
```

A `PreToolUse` guard denies this command on the orchestrator's own Bash path on both platforms, so "only after explicit user approval" is enforced by the harness rather than by the orchestrator's restraint. Each approval adds `cap += 5` and stores the SHA-256 of the current code-review artifact's exact raw bytes. That marker approves only that artifact version: a byte-changed completion-eligible artifact requires a new user approval. The hook alone calls `claim-review-dispatch`; the orchestrator must never edit the counters itself.

The routing table above applies at every round, regardless of impact. A reviewer-only retry consumes the same budget as a post-repair review; a retry never becomes a repair assignment merely because the budget is low.

**Completion fires ONLY on an objective-lane APPROVE AND an objective-scope Evidence Audit pass.** A **COMMENT verdict is NOT sufficient** for completion — `request-complete` requires `objective_verdict=APPROVE`. COMMENT is a soft pass: no blocking issue but non-blocking notes remain; address those notes and re-verify until APPROVE. **On an APPROVE,** the Evidence Audit applies the verify-the-verifier shape to your own check: confirm the verdict HOLDS UP by reading the evidence you collected (does it demonstrate the verification surface was met?). If the evidence is missing or does not demonstrate the verification surface, it is an Evidence Gap → continue pursuit, do not complete.

On pass (APPROVE + Evidence Audit holds), run the completion sequence in this exact order — **record the Evidence Audit artifact paths FIRST, then flip the verdict, then request completion:**

```
bun ${CLAUDE_SKILL_DIR}/scripts/ultragoal-state.ts set --phase pursuing --completion-evidence <audit-artifact-paths>
bun ${CLAUDE_SKILL_DIR}/scripts/ultragoal-state.ts set-verdict --verdict APPROVE
bun ${CLAUDE_SKILL_DIR}/scripts/ultragoal-state.ts request-complete
```

`<audit-artifact-paths>` is a comma-separated list of the artifacts the Evidence Audit read (the evidence that demonstrates the verification surface was met). `set --phase pursuing --completion-evidence` keeps the phase `pursuing` and only records the evidence — it can never write `complete`.

**If the `get_goal` tool is available**, call it immediately before the third command to obtain the current native-goal snapshot, then pass that snapshot on the `request-complete` call itself via `--codex-goal-json`, replacing the bare `request-complete` line above:

```
bun ${CLAUDE_SKILL_DIR}/scripts/ultragoal-state.ts request-complete --codex-goal-json - <<'SNAPSHOT'
<the get_goal snapshot JSON>
SNAPSHOT
```

This is the same tool-existence conditional `SKILL.md`'s Execution Dispatch loop uses for `create_goal`/`update_goal` — the condition is whether the `get_goal` tool is available, never a platform-name branch.

Use stdin (`-`) with a **quoted** heredoc here too: the snapshot echoes the registered objective back, so an apostrophe in it kills any single-quoted inline form. `--codex-goal-json` also accepts inline JSON or a file path (parsed as JSON first, then read as a path), but only stdin is safe for an arbitrary objective.

**Omitting `--codex-goal-json` when it is required is a refusal, not a silent pass.** Once `set --codex-goal-objective` has armed the cross-check, a missing, unparseable, or non-matching snapshot leaves `phase` at `pursuing` — the safe, never-false-complete direction — and `request-complete`'s own refusal message names this condition, so read that message rather than retrying the same call.

Evidence is recorded BEFORE the verdict flips so the full gate (verdict + evidence + per-story artifact checks) is satisfiable the moment `objective_verdict=APPROVE` appears. `request-complete` is the ONLY path to `phase=complete` — the hook layer never writes `complete` (the no-progress cap reached → `budget_limited` block). A `budget_limited` state does not bar `request-complete` in the same turn: drain any in-flight delegated work, harvest and commit its results, then run the completion gate; completion wins over a prior `budget_limited` when every gate passes. Do not dispatch new stories or interrupt running executors during this drain. If the gate is refused, report the blocker honestly and stop; the user can recover the preserved pursuit by running `bun ${CLAUDE_SKILL_DIR}/scripts/ultragoal-state.ts resume-pursuit`, which restores `pursuing` and resets the no-progress counter to `0`.

APPROVE alone does NOT leave the ultragoal pursuit pursuing/active — the `request-complete` handoff is what transitions to terminal `complete` (and it is structurally gated on completion-evidence, so a write that never reached the gate cannot false-complete).

**Once `request-complete` reaches terminal `complete`, hand off to the human for the final hands-on QA.** The loop never runs the hands-on adversarial matrix, so when you report completion, also prompt the user to run their own final hands-on pass before shipping — the heavy `Skill(skill: "qa")` battery is available if they want it.

**Two lanes gate completion: the objective self-check and code-review.** The completion path runs both the objective-level self-check (correctness, completeness, and evidence audit) and the independent code-review lane (static quality and conventions) — both must pass for `request-complete` to pass. The code-review lane passes only with a matching-scope `COMPLETE` artifact, no `UNKNOWN`, and no undismissed admitted finding; excluded items remain visible without becoming work. No design or architecture lane gates completion: daedalus and design-review are plan-time advisory only, not completion gates. Code-review is a completion-time quality lane and is distinct from design-review — the two must not be conflated.

### Concrete progress action per non-APPROVE verdict

Every non-APPROVE verdict drives a concrete action within the frozen scope:

- **Unfinished story/COMMENT**: dispatch the named requirement gap to sisyphus, then re-verify. Commentary cannot invent an acceptance criterion.
- **Tactical plan inadequacy**: adjust HOW within the approved WHAT. A change to WHAT, AC, constraints, boundaries, or non-goals follows the planning approval contract before dispatch.
- **Admitted confirmed findings**: one bounded sisyphus repair batch, affected automated verification, then fresh independent review.
- **Plausible/unknown/invalid/inconclusive review**: reviewer-only adjudication, or a user scope decision if existing evidence cannot determine the product requirement. No speculative fixes.
- **Only excluded findings remain**: report the exclusions, check the objective evidence, and request completion. Do not prolong the loop to improve the excluded areas.

### Blocked-stop

Pursuit stops as blocked (non-complete) ONLY on a decidable, point-in-time predicate. The no-progress cap is a separate soft-stop: consecutive Stops without a diff-carrying commit or story transition accumulate toward `max_iterations`, while observed progress resets the counter; reaching the cap yields `budget_limited`, preserves state, and requires user-run `resume-pursuit` after any drain. Exactly two conditions trip blocked:

- **B1** — the objective self-check names NO actionable incomplete work item while the objective is still unmet (no valid progress path: nothing to re-dispatch and the verification surface is not satisfied).
- **B2** — the captured **blocked-stop** slot's objective-specific condition is met.

On either condition: run `set-blocked --reason "<blocker>"`, report the blocker to the user, and stop. A blocked pursuit is non-complete — `set-blocked` can never write `complete`.

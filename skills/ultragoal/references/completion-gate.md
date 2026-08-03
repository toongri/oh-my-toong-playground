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

`request-complete` reads the artifact from the conventional path internally (no path argument). It refuses if: the artifact is absent or schema-invalid; any non-retired story entry is non-APPROVE; any non-retired story is `unconfirmed`; an entry is missing for any non-retired story; zero non-retired stories exist; or the existing dual gate is unmet (`objective_verdict !== 'APPROVE'` in state, or empty `completion_evidence_paths`). As a second structural refusal lane, `request-complete` also reads the code-review artifact (`ultragoal-codereview-{sid}.json`) from its conventional path internally (no path argument) and refuses if that artifact is absent or schema-invalid (a missing `status` field is schema-invalid — there is no default-to-COMPLETE coercion), has `status: "INCONCLUSIVE"`, or contains an undismissed `CONFIRMED` `correctness` or `requirement-gap` finding (see code-review lane below); `CONFIRMED` `cleanup` findings are non-blocking. This refusal is structural — it runs inside `request-complete` itself independent of the orchestrator loop, so completion is blocked even if the loop misbehaves. When all checks pass, `request-complete` writes `phase=complete` and `active=false`.

<!-- story-layer:end -->

**Code-review lane (runs once, at the final story — not per story).** Middle stories carry only the lightweight, self-attested per-story verdict above; no code-reviewer runs on them. Once every confirmed story's per-story verdict reads APPROVE, dispatch a fresh **code-reviewer** agent, independent of the builder (sisyphus), over the ENTIRE accumulated diff — all stories combined, not just the final one. Self-review by the builder is forbidden.

- **Before dispatching**, run `bun ${CLAUDE_SKILL_DIR}/scripts/ultragoal-state.ts serialize-review-context` and put its full stdout JSON — the 5-slot payload `{what_was_implemented, description, requirements, project_context, non_goals}` — in the dispatch prompt. The code-review skill's Step 1 Intent Block Gate recognizes this shape (its "Non-interactive dispatch (completion-gate)" row) and skips its own user interview while still detecting requirement-gap findings.
- **The code-reviewer writes `$OMT_DIR/ultragoal-codereview-{sid}.json` itself.** Pass it only the session-derived path; never transcribe finding content.
- **A PreToolUse hook** (`codereview_guard_core_run` in `hooks/write-guard-core.sh`) denies writing that path unless the tool call's `agent_type` is `code-reviewer`. It raises the cost of forging the artifact, it does not make forgery impossible — the write shapes it recognizes and the gaps that stay open are in `CLAUDE.md`'s Code-review artifact identity guard entry.
- **The sibling `$OMT_DIR/ultragoal-verdict-{sid}.json` is NOT guarded** — the orchestrator is its author.

**The code-reviewer dispatch prompt carries exactly two things — the `serialize-review-context` 5-slot JSON verbatim, and the artifact path — and nothing else, on the first dispatch and on every re-dispatch alike.** Both are mandatory, not an optional pair to pick from: the 5-slot payload (`what_was_implemented, description, requirements, project_context, non_goals`) is what the first-dispatch contract above already requires, and the artifact path is the other half of the same non-interactive-dispatch signal — `code-review/SKILL.md`'s Step 1 Intent Block Gate reads the two together, so dropping the path leaves the reviewer to open its own user interview instead of writing the artifact. Nothing else rides along: no diff range (the code-review skill already derives its own range when none is given — detecting the default branch for `<default>...HEAD` — and verifies HEAD is the target branch and the tree is clean before the review starts, aborting on a mismatch; the orchestrator has no more trustworthy a range than the reviewer's own derivation, so supplying one would only replace that derivation with the orchestrator's judgment instead of adding anything to it). This exclusion presumes the branch was cut for this objective and carries no commits outside this pursuit — only under that premise does the reviewer's self-derived `<default>...HEAD` equal the ENTIRE accumulated diff the code-review lane is required to run over; when the branch also carries commits no story here produced, the reviewer reviews those files too, and any `CONFIRMED` `correctness` or `requirement-gap` finding among them blocks `request-complete` and sends re-dispatch after files no story owns, the same as a genuine finding would. It also excludes any hand-written account of what to look for, whatever form that account takes — a defect-class ladder, "find the next instance of X" phrasing, or any other free-form steering. This has a concrete failure mode behind it, not just caution: a reviewer handed a named defect pattern in its prompt tends to produce the next instance of that same pattern, so the prompt becomes the review's real finding source instead of the diff — observed once as a review that converged once that free-form prose was stripped out and only the fixed 5-slot-plus-path payload remained. A rising finding count, round over round, is the occasion to check this contract, not the verdict by itself: genuine change in the reviewed diff between rounds is a competing cause and has to be ruled out first, and only once it is does a rise point at the prompt still supplying what to find rather than at the code. This reading detects the contract's violation, not payload content: under a held contract, the prompt names nothing to look for, so it cannot be the finding source — the payload may still differ each round, drawn fresh from session state. The test for what belongs in the prompt is never lexical, either — "ladder" and "instance" surface in plenty of legitimate prose, so a defect-class ladder or "find the next instance" phrasing is disqualified here only as a worked example, not a banned word; the only question that decides an item is whether it is the 5-slot JSON or the artifact path.

The artifact schema the code-reviewer must emit:

```json
{
  "status": "COMPLETE|INCONCLUSIVE",
  "findings": [
    { "class": "correctness|cleanup|requirement-gap", "verdict": "CONFIRMED|PLAUSIBLE", "ref": "<file:line>" }
  ],
  "reviewer": "<reviewer id>",
  "at": "<ISO timestamp>"
}
```

`status` is **required**. `COMPLETE` = the reviewer rendered a verdict over the diff, so findings (possibly empty) are trustworthy. `INCONCLUSIVE` = the review did not finish — reviewer timeout, ack-only response, a `BLOCKED` reviewer, or genuine uncertainty — so `findings` is not exhaustive even when empty. An artifact missing `status` is schema-invalid and refused exactly like an absent one; there is no default-to-COMPLETE coercion.

**Pass signal:** completion requires `status === "COMPLETE"` AND no `CONFIRMED` finding whose `class` is `correctness` or `requirement-gap` — except one the user dismissed against these exact artifact bytes (see Wrong blocking finding below). `CONFIRMED` `cleanup` findings and all `PLAUSIBLE` findings are non-blocking; they are reported but do not prevent completion. `status === "INCONCLUSIVE"` blocks regardless of findings.

**Completion-eligible discretion.** When `status === "COMPLETE"` and only `PLAUSIBLE` or `CONFIRMED` `cleanup` findings remain, choose based on the current value of the findings and the remaining time:

- **마무리** → run `request-complete`, then report every remaining non-blocking finding with its exact `file:line` reference and a one-line summary.
- **계속** → ask the user; only after explicit approval, pass the selected `CONFIRMED` `cleanup` finding(s) to sisyphus for repair, then ask the user to run `bun ${CLAUDE_SKILL_DIR}/scripts/ultragoal-state.ts approve-review-dispatch-renewal` themselves before the next code-reviewer dispatch (the guard denies it on your own Bash path).

`PLAUSIBLE` findings remain non-blocking report items. They are not confirmed work items and this rule does not require dispatching sisyphus to fix them.

### Wrong blocking finding: propose a dismissal

A `CONFIRMED` `correctness` or `requirement-gap` finding blocks completion structurally. When such a finding is **wrong**, the loop has no other exit: fixing correct code to satisfy it makes the code worse, and the pursuit otherwise runs until the dispatch budget dies.

**Trigger — when you can quote the refutation.** After reading a blocking finding, go to the cited `file:line` and look for the line, guard, or invariant that makes its failure scenario unreachable. If you can quote one, propose a dismissal on your next turn. If you cannot quote one, the finding stands: route it to sisyphus as an ordinary blocking finding. Disagreeing with a finding you cannot refute in a quoted line is not a trigger.

**The proposal carries four parts, in this order:**

1. The finding as the reviewer stated it — its `ref`, its `class`, and its claim in one line.
2. The refuting quote — the exact source line, with its own `file:line`.
3. Why that line makes the reviewer's failure scenario unreachable.
4. The exact command for the **user** to run — in their terminal, or by prefixing it with `!` in the prompt:

```
bun ${CLAUDE_SKILL_DIR}/scripts/ultragoal-state.ts dismiss-review-finding \
  --ref '<file:line>' --class <correctness|requirement-gap> --rationale '<the refutation from part 3>'
```

Then stop and wait. **You never run this command yourself** — a `PreToolUse` guard denies it on your Bash path on both Claude and Codex, so the authorization is structural rather than a rule you are trusted to follow. The same guard covers `approve-review-dispatch-renewal` for the same reason: both let this loop clear its own completion gate.

**Scope of one dismissal.** It removes exactly one finding from the blocking set — remaining `CONFIRMED` blocking findings still block, and each needs its own proposal. It is pinned to the current artifact's exact bytes, so it lapses when the next review round writes a new artifact; a genuine defect that later appears at the same `file:line` blocks normally.

The command refuses a `--class cleanup` (cleanup never blocked), an empty `--rationale`, and any `--ref` with no matching `CONFIRMED` finding in the current artifact — so a dismissal cannot be issued ahead of the finding it answers.

**After the dismissal.** Re-run the completion check. If no blocking finding remains, proceed to `request-complete`; the dismissed finding is still reported in the completion summary, with its rationale. If the user declines the proposal, treat the finding as real and route it to sisyphus.

### Five-round review dispatch budget

Before an active `phase=pursuing` code-reviewer dispatch, the Claude and Codex `PreToolUse` hooks automatically run `claim-review-dispatch`; an allowed claim persists `used += 1` before dispatch. The initial cap is 5. Per-story dispatches, non-reviewer dispatches, and any non-pursuing state are unaffected. The hooks do not change `code-review` or `orchestrate-review` behavior; they only decide whether the already-planned code-reviewer dispatch may proceed.

At the cap, the hook denies the next dispatch and the AI must ask the user whether to **마무리** or **계속**. A completion-eligible artifact (a `COMPLETE` artifact with no `CONFIRMED` `correctness` or `requirement-gap` finding, including cleanup-only or PLAUSIBLE-only findings) also denies re-dispatch until the AI either runs `request-complete` or asks to continue. To continue, the orchestrator presents this command and the **user** runs it — in their terminal, or by prefixing it with `!` in the prompt:

```
bun ${CLAUDE_SKILL_DIR}/scripts/ultragoal-state.ts approve-review-dispatch-renewal
```

A `PreToolUse` guard denies this command on the orchestrator's own Bash path on both platforms, so "only after explicit user approval" is enforced by the harness rather than by the orchestrator's restraint. Each approval adds `cap += 5` and stores the SHA-256 of the current code-review artifact's exact raw bytes. That marker approves only that artifact version: a byte-changed completion-eligible artifact requires a new user approval. The hook alone calls `claim-review-dispatch`; the orchestrator must never edit the counters itself.

The two block reasons route differently: a blocking code-review finding (`CONFIRMED` `correctness` or `requirement-gap`, under `status: "COMPLETE"`) routes back to sisyphus re-dispatch targeted at those specific findings — the same concrete-progress shape as an objective-lane REQUEST_CHANGES verdict. An `INCONCLUSIVE` status routes to a **reviewer-only re-run** instead — re-dispatch a fresh **code-reviewer** over the same diff, NOT sisyphus (there is no confirmed work item to fix; the review itself just needs to finish).

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

Evidence is recorded BEFORE the verdict flips so the full gate (verdict + evidence + per-story artifact checks) is satisfiable the moment `objective_verdict=APPROVE` appears. `request-complete` is the ONLY path to `phase=complete` — the hook layer never writes `complete` (cap reached → `budget_limited` block). A `budget_limited` state does not bar `request-complete` in the same turn: complete wins over a prior `budget_limited`. If `request-complete` is refused, report the blocker honestly and stop.

APPROVE alone does NOT leave the ultragoal pursuit pursuing/active — the `request-complete` handoff is what transitions to terminal `complete` (and it is structurally gated on completion-evidence, so a write that never reached the gate cannot false-complete).

**Once `request-complete` reaches terminal `complete`, hand off to the human for the final hands-on QA.** The loop never runs the hands-on adversarial matrix, so when you report completion, also prompt the user to run their own final hands-on pass before shipping — the heavy `Skill(skill: "qa")` battery is available if they want it.

**Two lanes gate completion: the objective self-check and code-review.** The completion path runs both the objective-level self-check (correctness, completeness, and evidence audit) and the independent code-review lane (static quality and conventions) — both must pass for `request-complete` to pass. The code-review lane passes only with `status: "COMPLETE"` and no `CONFIRMED` `correctness` or `requirement-gap` finding; a `CONFIRMED` `cleanup` finding is reported but non-blocking. No design or architecture lane gates completion: daedalus and design-review are plan-time advisory only, not completion gates. Code-review is a completion-time quality lane and is distinct from design-review — the two must not be conflated.

### Concrete progress action per non-APPROVE verdict

Every non-APPROVE verdict drives a concrete progress action — never action-less spin. Each action is **scoped re-review**: it re-dispatches only the rejected unit (the named incomplete TODOs, or the specific CONFIRMED findings), never a full re-walk of already-passed work. A strategic plan inadequacy — where the decomposition itself is wrong, not merely unfinished — is steered directly rather than escaped to a separate planning tool:

- **REQUEST_CHANGES naming incomplete work items** (tactical — the work is unfinished, the plan is sound) → re-dispatch `Skill(skill: "sisyphus")` on the named incomplete TODOs. This stays inside sisyphus's junior loop; phase remains `pursuing`.
- **Strategic plan inadequacy** (the plan itself cannot reach the objective — the decomposition is wrong, not merely unfinished) → steer the plan directly (correct the TODO breakdown yourself), then re-dispatch `Skill(skill: "sisyphus")` against the corrected TODOs; phase remains `pursuing`.
- **COMMENT (soft pass — non-blocking notes)** → re-dispatch `Skill(skill: "sisyphus")` to address the self-check notes, then re-verify toward APPROVE; do NOT `request-complete` on a COMMENT (the code gate requires `objective_verdict=APPROVE`).
- **Code-review lane: `CONFIRMED` `correctness` or `requirement-gap` finding** (under `status: "COMPLETE"`) → re-dispatch `Skill(skill: "sisyphus")` on the specific findings in `ultragoal-codereview-{sid}.json`. When you can quote the line that refutes one of those findings, propose a dismissal for it first (see Wrong blocking finding above) rather than sending sisyphus after correct code. Phase remains `pursuing`; run a fresh code-review dispatch after sisyphus resolves the findings — that fresh dispatch carries the same fixed two-item payload as the dispatch-prompt contract above, not the finding history from the round that just closed. A `CONFIRMED` `cleanup` finding is reported but does not trigger re-dispatch.
- **Code-review lane: completion-eligible cleanup-only or PLAUSIBLE-only artifact** → use the completion-eligible discretion above: finish with `request-complete` and the remaining-finding report, or after explicit user approval send selected `CONFIRMED` `cleanup` finding(s) to sisyphus, then ask the user to run `approve-review-dispatch-renewal` themselves before the next code-reviewer dispatch. `PLAUSIBLE` findings stay report-only unless separately chosen by the user. This routing changes neither `code-review` nor `orchestrate-review`; it only controls the ultragoal dispatch permission.
- **Code-review lane: `status: "INCONCLUSIVE"`** (reviewer timeout, ack-only response, `BLOCKED` reviewer, or genuine reviewer uncertainty) → re-dispatch a **fresh code-reviewer only** over the same diff — NOT sisyphus, since no finding was confirmed. Phase remains `pursuing`.

### Blocked-stop

Pursuit stops as blocked (non-complete) ONLY on a decidable, point-in-time predicate — there is no cross-iteration stall detector; `max_iterations` absorbs genuine stalls. Exactly two conditions trip blocked:

- **B1** — the objective self-check names NO actionable incomplete work item while the objective is still unmet (no valid progress path: nothing to re-dispatch and the verification surface is not satisfied).
- **B2** — the captured **blocked-stop** slot's objective-specific condition is met.

On either condition: run `set-blocked --reason "<blocker>"`, report the blocker to the user, and stop. A blocked pursuit is non-complete — `set-blocked` can never write `complete`.

## Completion Gate

After a sisyphus pass, completion is NOT self-declared by stopping. Run the objective-level completion check yourself (the orchestrator), inline: take the **verification surface as PROSE requirements** — a completeness Spec — and confirm that every prose-stated requirement is reflected in the deliverable, rendering an APPROVE / REQUEST_CHANGES / COMMENT verdict.

Run the **automated checks (build / test / lint)** inline and map the verification surface to concrete evidence per the rubric below. The expensive **hands-on adversarial matrix is NOT run in the autonomous loop** — that final, costly QA is the human's, performed once after the loop reports complete (the objective self-check covers automated correctness + completeness; the human covers hands-on confidence). The rubric forces an evidence-based verdict and asserts each element independently:

- **prompt-to-artifact mapping** — map every explicit requirement, numbered item, named file, command, test, gate, and deliverable in the verification surface to concrete evidence; an unmapped requirement is incomplete.
- **proxy-signal refusal** — refuse proxy signals as completion by themselves: passing tests, a green build, a complete manifest, or substantial effort count only insofar as they cover every requirement in the verification surface.
- **verify-the-verifier** — confirm that any test suite, manifest, or green status actually COVERS the objective's requirements before relying on it (the FALSE-GREEN guard: not "are tests green?" but "do the green tests cover every objective requirement?").
- **uncertainty = not-achieved** — treat any uncertain, weakly-verified, or uncovered requirement as not achieved; doubt drives REQUEST_CHANGES, never APPROVE.

Because the orchestrator now runs this check on its own pursuit, the rubric is the discipline against self-deception — the objective lane is self-attested, and the genuinely independent structural teeth are the **code-review lane** (a fresh reviewer, below) and the human's final hands-on QA. Apply the rubric strictly: a self-attested APPROVE that skips proxy-refusal or verify-the-verifier is exactly the false-complete the gate exists to prevent.

<!-- story-layer:start -->

**Per-story re-derivation (same inline check, run incrementally).** Unlike goal — which re-derives every non-retired story's verdict together, once, at the end of a pass — ultragoal runs this same self-check **once per story, immediately after that story's own sisyphus dispatch**, as the mid-loop advance gate described in SKILL.md's Execution Dispatch: a story's verdict must read `APPROVE` before the next story is dispatched. Each re-derivation authors (or updates) the structured verdict artifact at `$OMT_DIR/ultragoal-verdict-{sid}.json`, accumulating one entry per story as the sequential loop proceeds. The orchestrator writes this file directly. (`request-complete` validates the artifact's schema and per-story verdicts, not its author — so the structural gate is unchanged.) The artifact schema is:

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

`request-complete` reads the artifact from the conventional path internally (no path argument). It refuses if: the artifact is absent or schema-invalid; any non-retired story entry is non-APPROVE; any non-retired story is `unconfirmed`; an entry is missing for any non-retired story; zero non-retired stories exist; or the existing dual gate is unmet (`objective_verdict !== 'APPROVE'` in state, or empty `completion_evidence_paths`). As a second structural refusal lane, `request-complete` also reads the code-review artifact (`ultragoal-codereview-{sid}.json`) from its conventional path internally (no path argument) and refuses if that artifact is absent or schema-invalid (a missing `status` field is schema-invalid — there is no default-to-COMPLETE coercion), has `status: "INCONCLUSIVE"`, or contains any `CONFIRMED` finding (see code-review lane below); this refusal is structural — it runs inside `request-complete` itself independent of the orchestrator loop, so completion is blocked even if the loop misbehaves. When all checks pass, `request-complete` writes `phase=complete` and `active=false`.

<!-- story-layer:end -->

**Code-review lane (runs once, at the final story — not per story).** Middle stories carry only the lightweight, self-attested per-story verdict above; no code-reviewer runs on them. The independent code-review lane runs once, at the final story — not per story, and not per sisyphus pass within a story — right before requesting completion: once every confirmed story's per-story verdict reads APPROVE, dispatch a fresh **code-reviewer** agent independently of the builder (sisyphus) over the ENTIRE accumulated diff (all stories combined, not just the final one); self-review by the builder is forbidden. This lane is the autonomous loop's one genuinely independent gate — a fresh instance, not the orchestrator — so it carries the structural anti-anchoring teeth the per-story self-checks no longer provide. Before dispatching the code-reviewer, the orchestrator runs `bun ${CLAUDE_SKILL_DIR}/scripts/ultragoal-state.ts serialize-review-context` and includes its full stdout JSON — the 5-slot payload `{what_was_implemented, description, requirements, project_context, non_goals}` — in the dispatch prompt. This is the non-interactive dispatch payload the code-review skill's Step 1 Intent Block Gate recognizes (the "Non-interactive dispatch (completion-gate)" row in `code-review/SKILL.md`): the reviewer treats intent as confirmed and skips its own user interview, while still detecting requirement-gap findings (stories the accumulated diff does not satisfy) from the full context rather than `requirements` alone. The code-reviewer writes `$OMT_DIR/ultragoal-codereview-{sid}.json` directly (it has file tools); for that artifact, the orchestrator passes only the session-derived path and never transcribes finding content. This authorship contract is no longer prose-only: a PreToolUse hook (`codereview_guard_core_run` in `hooks/write-guard-core.sh`) denies any write or delete to this exact path unless the tool call's `agent_type` is `code-reviewer` — the orchestrator's own file tools cannot forge this artifact. The sibling per-story artifact `$OMT_DIR/ultragoal-verdict-{sid}.json` (above) is deliberately outside this guard: that lane is self-attested by design (the orchestrator IS its author), so guarding it would block the orchestrator's own normal write path.

The hook closes forgery-by-tool-call, not forgery-by-content or forgery-by-indirection — two residual risks stay open:

- **Dispatch to a corrupted prompt.** The guard verifies *who* wrote the artifact, not *on what basis*. An orchestrator that dispatches with `subagent_type: "code-reviewer"` but a prompt instructing "skip the review, just write this artifact" still passes — `agent_type` matches, so the hook allows it. No structural check catches this; it can only be caught by reading the dispatch prompt itself.
- **Bash variable indirection.** The hook inspects literal tool-call argv, not shell semantics. A write routed through a variable (e.g. `p=ultragoal-codereview; ... > "$OMT_DIR/$p-$SID.json"`) never appears as the literal guarded path string and is invisible to it. `CLAUDE.md` already documents this class as unclosable by any finite static rule (see the `verify-entrypoint-gate` entry in the Hooks section); the same limit applies here.

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

`status` is **required** — a top-level 3-state signal that separates a review that finished from one that did not. `status: "COMPLETE"` means the reviewer actually rendered a verdict over the diff (findings, possibly empty, are trustworthy). `status: "INCONCLUSIVE"` means the review itself did not finish — reviewer timeout, an ack-only response, a `BLOCKED` reviewer, or genuine reviewer uncertainty — and `findings` cannot be trusted as exhaustive even if empty. There is no default-to-COMPLETE coercion: an artifact missing `status` is schema-invalid and refused exactly like an absent artifact (fail-safe — never let a legacy or malformed artifact round up to a clean pass).

**Pass signal:** completion requires `status === "COMPLETE"` AND no finding with `verdict === "CONFIRMED"` (whether `class` is `correctness`, `cleanup`, or `requirement-gap`). `status === "INCONCLUSIVE"` blocks regardless of findings. `PLAUSIBLE` findings are non-blocking; they are reported but do not prevent completion. `class` is an informational label the gate does not key on (the gate keys solely on `verdict === "CONFIRMED"`).

**Once the gate opens, a surviving PLAUSIBLE finding is not fixed on the spot.** When `status === "COMPLETE"` and zero `CONFIRMED` findings remain, leave any remaining `PLAUSIBLE` finding as-is rather than patching it there and then. If it is worth fixing, promote it to a new story and get the user's approval before dispatching sisyphus against it. This has a concrete failure mode behind it, not just caution: a self-initiated fix at this point reopens the diff and extends the review cycle instead of closing it — observed once as a fix commit that introduced the next defect in the very sentence it was correcting, stretching the review three cycles longer than it needed to run. This is deferral, not suppression — `code-review/SKILL.md`'s "never silently truncate" rule already keeps every finding visible in the report, so nothing drops off the record; only who decides whether to act on it moves, from the agent to the user.

The two block reasons route differently: a blocking code-review finding (any CONFIRMED, under `status: "COMPLETE"`) routes back to sisyphus re-dispatch targeted at those specific findings — the same concrete-progress shape as an objective-lane REQUEST_CHANGES verdict. An `INCONCLUSIVE` status routes to a **reviewer-only re-run** instead — re-dispatch a fresh **code-reviewer** over the same diff, NOT sisyphus (there is no confirmed work item to fix; the review itself just needs to finish).

**Completion fires ONLY on an objective-lane APPROVE AND an objective-scope Evidence Audit pass.** A **COMMENT verdict is NOT sufficient** for completion — not because COMMENT is a distinct severity tier, but because the never-false-complete invariant in `request-complete` structurally requires `objective_verdict=APPROVE`. COMMENT is a soft pass: no blocking issue but non-blocking notes remain — on COMMENT, address those notes and re-verify until APPROVE. **On an APPROVE,** the Evidence Audit applies the verify-the-verifier shape to your own check: confirm the verdict HOLDS UP by reading the evidence you collected (does it demonstrate the verification surface was met?). If the evidence is missing or does not demonstrate the verification surface, it is an Evidence Gap → continue pursuit, do not complete.

On pass (APPROVE + Evidence Audit holds), run the completion sequence in this exact order — **record the Evidence Audit artifact paths FIRST, then flip the verdict, then request completion:**

```
bun ${CLAUDE_SKILL_DIR}/scripts/ultragoal-state.ts set --phase pursuing --completion-evidence <audit-artifact-paths>
bun ${CLAUDE_SKILL_DIR}/scripts/ultragoal-state.ts set-verdict --verdict APPROVE
bun ${CLAUDE_SKILL_DIR}/scripts/ultragoal-state.ts request-complete
```

`<audit-artifact-paths>` is a comma-separated list of the artifacts the Evidence Audit read (the evidence that demonstrates the verification surface was met). `set --phase pursuing --completion-evidence` keeps the phase `pursuing` and only records the evidence — it can never write `complete`.

**Why evidence is recorded BEFORE the verdict flips:** so that whenever `objective_verdict=APPROVE` is observed, the completion evidence is already present. `request-complete` is the ONLY path to `phase=complete` — the hook layer never writes `complete` under any condition (cap reached → `budget_limited` block, not complete). Recording evidence first ensures the full `request-complete` gate (verdict + evidence + per-story artifact checks) is satisfiable the moment the verdict flips. When the cap is reached before the gate is met, the hook writes `budget_limited` and blocks for that turn; calling `request-complete` in the same turn is still possible and succeeds if the gate is met — ADR-7 complete-wins means `request-complete` prevails over a prior `budget_limited` state. If `request-complete` is refused, report the blocker honestly and stop.

APPROVE alone does NOT leave the ultragoal pursuit pursuing/active — the `request-complete` handoff is what transitions to terminal `complete` (and it is structurally gated on completion-evidence, so a write that never reached the gate cannot false-complete).

**Once `request-complete` reaches terminal `complete`, hand off to the human for the final hands-on QA.** The autonomous loop proved the verification surface through automated checks and the code-review lane; the hands-on adversarial matrix was deliberately left out of the loop (see the Completion Gate opening). So when you report completion, also prompt the user to run their own final hands-on pass before shipping — the heavy `Skill(skill: "qa")` battery is available if they want it.

**Two lanes gate completion: the objective self-check and code-review.** The completion path runs both the objective-level self-check (correctness, completeness, and evidence audit) and the independent code-review lane (static quality and conventions) — both must be clean for `request-complete` to pass. No design or architecture lane gates completion: daedalus and design-review are plan-time advisory only, not completion gates. Code-review is a completion-time quality lane and is distinct from design-review — the two must not be conflated.

### Concrete progress action per non-APPROVE verdict

Every non-APPROVE verdict drives a concrete progress action — never action-less spin. Each action is **scoped re-review**: it re-dispatches only the rejected unit (the named incomplete TODOs, or the specific CONFIRMED findings), never a full re-walk of already-passed work. A strategic plan inadequacy — where the decomposition itself is wrong, not merely unfinished — is steered directly rather than escaped to a separate planning tool:

- **REQUEST_CHANGES naming incomplete work items** (tactical — the work is unfinished, the plan is sound) → re-dispatch `Skill(skill: "sisyphus")` on the named incomplete TODOs. This stays inside sisyphus's junior loop; phase remains `pursuing`.
- **Strategic plan inadequacy** (the plan itself cannot reach the objective — the decomposition is wrong, not merely unfinished) → steer the plan directly (correct the TODO breakdown yourself), then re-dispatch `Skill(skill: "sisyphus")` against the corrected TODOs; phase remains `pursuing`.
- **COMMENT (soft pass — non-blocking notes)** → re-dispatch `Skill(skill: "sisyphus")` to address the self-check notes, then re-verify toward APPROVE; do NOT `request-complete` on a COMMENT (the code gate requires `objective_verdict=APPROVE`).
- **Code-review lane: any CONFIRMED finding** (under `status: "COMPLETE"`) → re-dispatch `Skill(skill: "sisyphus")` on the specific findings in `ultragoal-codereview-{sid}.json`. Phase remains `pursuing`; run a fresh code-review dispatch after sisyphus resolves the findings.
- **Code-review lane: `status: "INCONCLUSIVE"`** (reviewer timeout, ack-only response, `BLOCKED` reviewer, or genuine reviewer uncertainty) → re-dispatch a **fresh code-reviewer only** over the same diff — NOT sisyphus, since no finding was confirmed. Phase remains `pursuing`.

### Blocked-stop

Pursuit stops as blocked (non-complete) ONLY on a decidable, point-in-time predicate — there is no cross-iteration stall detector; `max_iterations` absorbs genuine stalls. Exactly two conditions trip blocked:

- **B1** — the objective self-check names NO actionable incomplete work item while the objective is still unmet (no valid progress path: nothing to re-dispatch and the verification surface is not satisfied).
- **B2** — the captured **blocked-stop** slot's objective-specific condition is met.

On either condition: run `set-blocked --reason "<blocker>"`, report the blocker to the user, and stop. A blocked pursuit is non-complete — `set-blocked` can never write `complete`.

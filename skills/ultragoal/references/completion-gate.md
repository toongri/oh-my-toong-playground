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

`request-complete` reads the artifact from the conventional path internally (no path argument). It refuses if: the artifact is absent or schema-invalid; any non-retired story entry is non-APPROVE; any non-retired story is `unconfirmed`; an entry is missing for any non-retired story; zero non-retired stories exist; or the existing dual gate is unmet (`objective_verdict !== 'APPROVE'` in state, or empty `completion_evidence_paths`). The ultragoal review gate additionally requires a valid `COMPLETE` artifact bound to the current scope contract and either a derived `APPROVE`, or a derived `COMMENT` with hash-bound `record-comment-resolution` evidence when a MEDIUM repair was required; LOW/OUT_OF_SCOPE-only COMMENT needs no resolution. `COMMENT` remains `COMMENT` and is not promoted to `APPROVE`. Missing scope evidence or a stale contract hash refuses completion. This check runs inside `request-complete`, independently of the orchestrator's judgment. Only when both lanes pass does it write `phase=complete` and `active=false`.

<!-- story-layer:end -->

**Code-review lane (starts at the final story; retries follow bounded admission).** Middle stories carry only the lightweight, self-attested per-story verdict above; no code-reviewer runs on them. Once every confirmed story's per-story verdict reads APPROVE, dispatch a fresh **code-reviewer** agent, independent of the builder (sisyphus), over the ENTIRE accumulated diff — all stories combined, not just the final one. Self-review by the builder is forbidden.

- **Before dispatching**, run `bun ${CLAUDE_SKILL_DIR}/scripts/ultragoal-state.ts serialize-review-context` and put its full stdout JSON — the 5-slot payload `{what_was_implemented, description, requirements, project_context, non_goals}` — in the dispatch prompt. The `requirements` slot has one line per confirmed story; when the state's `plan_path` file has ADR items (`### D-N: <title>` with a `Decision` field), it ends with a `Decision rules:` block of `[D-N] <title> — <rule>` lines, which is not part of the scope contract (its hash is unchanged). The code-review skill's Step 1 Intent Block Gate recognizes this shape (its "Non-interactive dispatch (completion-gate)" row) and skips its own user interview while still detecting requirement-gap findings.
- **Publication:** Pass the exact artifact destination opaquely with the two-field dispatch context. This pursuit's destination is `$OMT_DIR/ultragoal-codereview-{sid}.json`, but the producer treats it as an opaque path. The generic `code-review` publisher receives the original artifact bytes and returns only its `{path, sha256}` transport receipt; it has no aggregate or caller policy knowledge. The parent orchestrator then calls `ultragoal-state.ts get-review-result`, which computes the session result and feeds the scope reducer below; the reviewer never computes aggregate repair or completion policy.
- **The sibling `$OMT_DIR/ultragoal-verdict-{sid}.json` is NOT guarded** — the orchestrator is its author.

A code-reviewer may legitimately remain in flight for 2–3 hours. Elapsed time alone is not evidence to interrupt, cancel, or re-dispatch it. Keep waiting while it remains live; intervene only on concrete terminal evidence such as an explicit reviewer timeout or deadline, a canceled or error state, or verified loss of its live process or job artifact.

**The code-reviewer dispatch prompt carries exactly two things:** the `serialize-review-context` 5-slot JSON verbatim and the session-derived artifact path. Keep this contract on every dispatch. The serializer embeds the frozen scope contract and its SHA-256 as JSON between `[SCOPE_CONTRACT]` and `[/SCOPE_CONTRACT]` inside `project_context`; copy it intact. Add no finding history, defect pattern, desired verdict, or hand-authored diff range. The pursuit records `review_base_commit` at start, and `serialize-review-context` adds one line to `project_context`: `Review base commit: <sha> — review the range <sha>...HEAD (this pursuit's own changes).` The reviewer derives its range from that line; when the line is absent (an older state), it falls back to its own derivation. A broad branch diff is inspection material, never permission to repair unrelated commits.

### Scope admission before repair

Finders do not suppress a candidate because of a declared non-goal; they file it noting `non_goals#N` in the summary, and the reviewer decides scope. For every generated candidate, the code reviewer directly records **scope first, validity second** against the frozen contract, evaluating the failure/cost AND the proposed remedy. OUT_OF_SCOPE records preserve generated candidates excluded during verification; they do not require a search for unrelated work:

| Scope | Required evidence | Orchestrator action |
|---|---|---|
| `IN_SCOPE` / `requirement` | Cite an approved story/AC or outcome/verification clause; explain how the local repair improves that deliverable without adding capability | Route by verified priority; LOW never blocks (see LOW handling below) |
| `IN_SCOPE` / `regression` | Cite the preserved contract and the causal path from this pursuit's change to broken prior behavior | Apply priority routing after admission; a LOW regression never blocks, while a mandatory AC failure or admitted HIGH/MEDIUM priority requires the minimum repair |
| `IN_SCOPE` / `changed_code` | Cite the lines this pursuit added or modified where the defect sits; no requirement has to name the behavior | Route by verified priority, like `requirement`; the remedy lists every sibling changed site with the same defect pattern |
| `OUT_OF_SCOPE` / `non_goal` | Name a real `non_goals` statement (`non_goals#N`, or quote it in `reference` or `rationale`) that directly addresses this defect's behavior or class; a requirement's silence or a decision about a different behavior does not qualify | Record exclusion as a visible note (it may add that the exclusion's premise contradicts the code); no repair or new story |
| `OUT_OF_SCOPE` / `unrelated` | Show the defect is in code this pursuit did not touch, with no requirement or causal regression connection, compared against the approved outcome | Record exclusion; no repair or new story |
| `UNKNOWN` / `uncertain` | Name the unresolved scope question with its contract reference; use it only when the only known remedy needs excluded behavior or the requirement itself is unclear | No repair yet; Oracle or the orchestrator resolves it from evidence first; the user decides only when the product requirement itself is unclear |

A defect in code this pursuit added or modified is in scope by default (`changed_code`); only an explicit non-goal statement that directly addresses it excludes it, and the defect then stays a note, not a repair demand. A real defect excluded by scope is never recorded as REFUTED: it reaches the artifact as an `OUT_OF_SCOPE` note. A file in the allowed boundary is only a location permission. Shared files, useful improvements, a senior reviewer's request, generic best practices, and codebase analogs do not authorize new goals. Derived expectations can explain an approved requirement; they cannot become new acceptance criteria. A real CSV defect can justify a local CSV fix, but cannot justify a non-goal multi-format framework. If a smaller remedy inside the change exists, judge `IN_SCOPE` with that remedy. If the only known fix requires excluded behavior or a wider boundary, leave it `UNKNOWN`, resolve it from evidence first, and ask the user only when the product requirement itself is unclear; never silently broaden the contract.

A causal regression is not excluded by a non-goal: repair it when a mandatory AC fails or an independently admitted `IN_SCOPE` + `CONFIRMED` finding has priority `HIGH` or `MEDIUM`; `LOW` never blocks. A defect in code this pursuit did not touch is `OUT_OF_SCOPE` (`unrelated`), unless it prevents an approved requirement from working (then `IN_SCOPE`, basis `requirement`) or this change worsens it (then `IN_SCOPE`, basis `regression`); the remedy is the smallest local fix. Do not use the regression label to modernize the excluded subsystem.

**Executor handoff:** include only independently admitted `IN_SCOPE` + `CONFIRMED` HIGH or MEDIUM findings (an `IN_SCOPE` + `PLAUSIBLE` HIGH or MEDIUM finding whose repair is local to code this pursuit added or modified may also be handed off, with the reason recorded in the repair evidence), their scope evidence and assessment, the original story AC/verification surface, constraints, boundaries, and non-goals. The executor checks the remedy against this same contract before editing. A mismatch returns for adjudication; it is not a license to execute the reviewer's suggestion. A LOW finding never blocks and never triggers a fresh review. The executor may fix it in the same repair pass when the fix is local to code this pursuit added or modified; there is no separate round for LOW and no invented test evidence. Never dispatch an entire unfiltered findings report as a repair list.

### Deterministic review result and bounded re-review

The parent orchestrator consumes the generic publisher receipt and calls the bundled `ultragoal-state.ts get-review-result`; that command computes the deterministic `verdict` and returns `artifact_sha256`, `reason`, and nested `findings: {repair, adjudicate, notes}`. The receipt hash identifies the original submitted artifact; the parent consumes this computed result and does not subjectively reclassify it. Do not add a third dispatch-prompt field: the two-field context/artifact contract is sufficient to derive publication.

Admission is scope-first. `OUT_OF_SCOPE` => `NOTE`; `UNKNOWN` => `REQUEST_CHANGES` with no repair until it is resolved from evidence. A valid `COMPLETE` artifact with verified findings routes by `priority`: HIGH => `REQUEST_CHANGES` and repair/check/fresh review; MEDIUM => `COMMENT` and repair/check plus hash-bound resolution; LOW => `COMMENT` that never blocks and never triggers a fresh review, with no invented repair or test evidence. A result containing both MEDIUM and LOW requires the MEDIUM repair and resolution; LOW-only or OUT_OF_SCOPE-only results do not. An empty finding set => `APPROVE`. `INCONCLUSIVE` remains `REQUEST_CHANGES` (reason "inconclusive review") and still lists its classified findings; they route like a `COMPLETE` artifact's.

An `IN_SCOPE` + `PLAUSIBLE` finding does not make the review `INCONCLUSIVE`. By priority: LOW => `NOTE`; HIGH or MEDIUM => `ADJUDICATE`, which blocks until Oracle or the orchestrator adjudicates it from evidence or it is dismissed. It may be repaired when the repair is local to code this pursuit added or modified; record why in the repair evidence. Otherwise it goes to Oracle adjudication or dismissal. A non-`COMPLETE` (`INCONCLUSIVE`) artifact yields `REQUEST_CHANGES` and still lists its classified findings.

The aggregate rule is deterministic: **any `IN_SCOPE` + `CONFIRMED` finding with `priority=HIGH`, or any `UNKNOWN`, unresolved `IN_SCOPE` + `PLAUSIBLE` with priority HIGH or MEDIUM, or `INCONCLUSIVE` result => REQUEST_CHANGES; otherwise any admitted MEDIUM => COMMENT; otherwise LOW (including `IN_SCOPE` + `PLAUSIBLE` LOW) or OUT_OF_SCOPE notes => COMMENT; empty => APPROVE.** `COMMENT` performs only the required MEDIUM repairs and affected checks, reports LOW/OUT_OF_SCOPE notes, then records hash-bound acknowledgment only when a MEDIUM repair exists:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/ultragoal-state.ts record-comment-resolution \
  --artifact-sha256 '<artifact_sha256 returned by get-review-result>' --evidence '<comma-separated evidence paths>'
```

The acknowledgment binds evidence to the exact artifact hash. Repair correctness remains the executor's self-attestation; this command does not claim that the machine understands semantic correctness. `COMMENT` and `APPROVE` never trigger a code-review re-review, even after user budget renewal. `set-verdict` remains the objective lane only and is separate from the code-review result.

For `REQUEST_CHANGES`, repair all required HIGH and MEDIUM findings, run affected checks, then dispatch a fresh independent review. A fresh review is also allowed to recover an unresolved or failed review submission; it is not limited to confirmed HIGH repair. Every new item is admitted against the same frozen contract. A reviewer-only retry is allowed only when the prior reviewer is absent or the submission failed; the initial five-review budget is for those retries and `REQUEST_CHANGES` rounds, not a reason to waive a required fresh review. No review-driven story creation, contract rewriting, new feature, or generalization is permitted.

The original `CodeReviewArtifact` consumed and scope-validated by `ultragoal-state.ts get-review-result`:

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
      "priority": "HIGH|MEDIUM|LOW",
      "assessment": {
        "unfixed_cost": "<nonblank string>",
        "exposure": "<nonblank string>",
        "remedy": "<nonblank string>",
        "added_cost": "<nonblank string>",
        "rationale": "<nonblank string>"
      },
      "ref": "<file:line>",
      "scope": "IN_SCOPE|OUT_OF_SCOPE|UNKNOWN",
      "scope_evidence": {
        "basis": "requirement|regression|changed_code|non_goal|unrelated|uncertain",
        "reference": "<contract field or confirmed story id>",
        "rationale": "<quoted clause, causal evidence, and bounded remedy or exclusion reason>"
      }
    }
  ],
  "reviewer": "<reviewer id>",
  "at": "<ISO timestamp>"
}
```

`status` is **required** in the submitted parent artifact. `COMPLETE` = the reviewer rendered a verdict over the diff; `INCONCLUSIVE` = the review did not finish — reviewer timeout, ack-only response, a `BLOCKED` reviewer, or genuine uncertainty — and is accepted but routes to `REQUEST_CHANGES` with reason "inconclusive review", still listing its classified findings. A fully verified review with PLAUSIBLE findings is `COMPLETE`, not `INCONCLUSIVE`. A `COMPLETE` artifact missing `status` or the 64-hex scope hash is rejected; an `INCONCLUSIVE` artifact may lack the hash (a diagnostic for a damaged or missing contract); there is no default-to-COMPLETE coercion.

`impact` is **required on every finding** and records harm as `HIGH|MEDIUM|LOW`. `priority` and `assessment` are required for `COMPLETE` artifacts; an `INCONCLUSIVE` artifact may omit them, but any supplied values are validated. Each `COMPLETE` finding must carry a non-blank `class` (free text, not an enum), `verdict`, `impact`, `priority`, and an `assessment` whose five values (`unfixed_cost`, `exposure`, `remedy`, `added_cost`, `rationale`) are nonblank strings; extra assessment keys are ignored. The final conductor grades realistic exposure and harm against the minimum remedy, permanent complexity/maintenance, and new-regression risk; it must not infer priority from confidence alone. `findings_report` is the path to the review's `findings.md` — the full cards the summary findings were cut from, preserved as source context.

`scope` and `scope_evidence` are required for every finding. References resolve to `outcome`, `verification_surface`, `constraints`, `boundaries`, `non_goals`, or a confirmed active story ID. `reference` is a free non-blank string. The runtime degrades a finding to `UNKNOWN` in only two cases: its `basis` is not allowed for its `scope` (IN_SCOPE⇒requirement/regression/changed_code, OUT_OF_SCOPE⇒non_goal/unrelated, UNKNOWN⇒uncertain), or it is OUT_OF_SCOPE + `non_goal` and neither `reference` nor `rationale` names a real (non-placeholder) `non_goals` statement by `non_goals#N` or by quoting it. Slot and story resolution, the pairing `non_goal` → `non_goals` and `unrelated` → `outcome`, and the empty-slot check are advisory warnings. Whether a statement directly addresses the defect stays the reviewer's judgment. The code reviewer owns the semantic truth of that evidence; a hash is identity, not proof of correctness. The derived `findings` object groups repair, adjudicate, and notes; it is not part of the submitted artifact schema.

Run `bun ${CLAUDE_SKILL_DIR}/scripts/ultragoal-state.ts validate-review-artifact` after publishing to check the artifact against the current contract: it prints each problem; reference-pairing and slot problems (e.g. `OUT_OF_SCOPE + non_goal must reference "non_goals", not "constraints"`) are advisory warnings and leave the exit code unchanged, so check its output. As a runtime safety net, `get-review-result` no longer nulls the whole result on one invalid finding — that finding degrades to a blocking `UNKNOWN` (see the two degrade conditions above) (never-false-complete preserved) while valid siblings still route, and the derived result's `reason` names the degraded findings and their fix. Only artifact-level failures (missing `status`/scope hash, a stale contract hash, or `INCONCLUSIVE`) reject the whole artifact.

**Pass signal:** a valid submitted artifact with matching scope-contract hash and either a derived `APPROVE`, or a derived `COMMENT` with valid hash-bound `record-comment-resolution` evidence when (and only when) at least one MEDIUM repair was required; LOW/OUT_OF_SCOPE-only COMMENT needs no resolution. `COMMENT` remains `COMMENT` and is not promoted to `APPROVE`. `OUT_OF_SCOPE` is a nonblocking note; `UNKNOWN`, invalid/stale artifact, or valid `INCONCLUSIVE` is `REQUEST_CHANGES`. Priority controls routing after scope admission; it never expands scope. Objective and story gates remain unchanged and cannot be waived by LOW.

An old artifact without this contract must be re-reviewed. The orchestrator never upgrades it by adding scope fields or copying a current hash.

### Common mistakes under review pressure

| Rationalization | Required response |
|---|---|
| “CONFIRMED/HIGH means fix, even though it is a non-goal” | Scope admission comes first; exclude the unrelated item |
| “The helper works, but the reviewer requires a framework” | Compare the remedy to the original AC; retain a bounded implementation |
| “LOW is only a note; CI is green” | LOW never blocks and never triggers a fresh review; fix it only in the same repair pass when local to code this pursuit changed, with no invented repair/test evidence; resolve any MEDIUM finding in the same artifact |
| “Same file / analog / next review round makes it part of the goal” | Cite the frozen requirement or change-caused regression; otherwise exclude |
| “Stuck on the block, so I'll just add the lock/guard/handling” | Name the exact runtime fact that would settle it and send it to Oracle. A repair local to code this pursuit added or modified is allowed, with the reason recorded; ask the user only when the remedy needs excluded behavior or the product requirement itself is unclear. An accepted risk becomes a non-goal, not code |

**Red flags:** a repair list containing an excluded item; a story added from review feedback alone; a changed non-goal to obtain approval; completing with an unresolved in-scope HIGH or MEDIUM item. Stop that action and apply admission again.

### Wrong blocking finding: dismiss it with a quoted refutation

An admitted `IN_SCOPE` + `CONFIRMED` HIGH finding blocks completion structurally. When such a finding is **wrong**, dismiss it with a quoted refutation. Dismissal applies to an `IN_SCOPE` finding whose outcome is BLOCK, FIX or ADJUDICATE (CONFIRMED HIGH/MEDIUM, or PLAUSIBLE HIGH/MEDIUM); it never applies to UNKNOWN, OUT_OF_SCOPE or NOTE findings.

**Trigger — when you can quote the refutation.** After reading a blocking or adjudication finding, go to the cited `file:line` and look for the line, guard, invariant, or config value that makes its failure scenario unreachable. If you can cite evidence for it (a line, a grep result, a config value), dismiss it. If you cannot, keep its scope and priority routing: confirmed HIGH items go to sisyphus; MEDIUM items follow the bounded COMMENT repair; LOW items never block. Scope disagreement is resolved by the independent reviewer against the frozen contract, not by repairing excluded work. Disagreeing with a finding you cannot refute with evidence is not a trigger.

**Your report of the dismissal carries four parts, in this order:**

1. The finding as the reviewer stated it — its `ref`, its `class`, and its claim in one line.
2. The refuting quote — the exact source line, with its own `file:line`.
3. Why that line makes the reviewer's failure scenario unreachable.
4. The exact command you ran:

```
bun ${CLAUDE_SKILL_DIR}/scripts/ultragoal-state.ts dismiss-review-finding \
  --ref '<file:line>' --class '<class text of the finding>' --rationale '<the refutation from part 3>'
```

Run it yourself, then continue. The rationale is recorded, and `request-complete` lists the dismissal so it reaches the final report with its four parts.

**Scope of one dismissal.** It removes exactly one finding from the gate — remaining blocking and adjudication findings still block, and each needs its own proposal. It is pinned to the current artifact's exact bytes, so it lapses when the next review round writes a new artifact; a genuine defect that later appears at the same `file:line` blocks normally.

The command refuses a missing or empty `--rationale`, and any `--ref` and `--class` with no matching `IN_SCOPE` finding whose outcome is BLOCK, FIX or ADJUDICATE in the current artifact — so a dismissal cannot be issued ahead of the finding it answers. UNKNOWN, OUT_OF_SCOPE, and NOTE findings (including PLAUSIBLE LOW) cannot be dismissed. It also needs a pursuing phase and the current contract hash, and each refusal names the failed condition. It refuses when the artifact holds **more than one** such `IN_SCOPE` finding at that same `ref` and `class`: a dismissal cannot tell them apart, so clearing one would clear the other too. Report both findings to the user; the block stands until the review round that produced them is superseded.

**After the dismissal.** Re-run the completion check. If no blocking finding remains, proceed to `request-complete`; the dismissed finding is still reported in the completion summary, with its rationale. If the user rejects a dismissal, the finding is blocking again: route it by scope and validity, and the next review round supersedes the dismissal. A rejection does not authorize a non-goal or turn a plausible claim into a confirmed defect.

### Five-round review dispatch budget

Before an active `phase=pursuing` code-reviewer dispatch, the Claude and Codex `PreToolUse` hooks automatically run `claim-review-dispatch`; an allowed claim persists `used += 1` before dispatch. The initial cap is 5. Per-story dispatches, non-reviewer dispatches, and any non-pursuing state are unaffected. The hooks do not change `code-review` behavior; they only decide whether the already-planned code-reviewer dispatch may proceed.

At the cap, `claim-review-dispatch` denies the next dispatch AND parks the pursuit in `phase=renewal-required` (`active=false`) — a named gate, not the `pursuing` state. This parking is the fix for the old wedge: from `pursuing`, every prose report-and-stop while waiting on the user counted as a no-progress Stop, so the loop spun to the `max_iterations` cap (`budget_limited`) and demanded a SECOND user-only command just to undo a watchdog that never should have fired. In `renewal-required` the Stop hook allows the turn to end and counts nothing. Decide: if a fresh review is owed, renew and continue; if more rounds will not converge, show the user the `force-complete` command and end the turn. Do not narrate in a loop.

Renewal is for another REQUEST_CHANGES round or an absent/failed reviewer submission; it never turns COMMENT or APPROVE into a terminal re-review. "마무리" cannot waive an unresolved item; when the gate fails it means stop incomplete. To continue, run this yourself with the reason another round is needed:

```
bun ${CLAUDE_SKILL_DIR}/scripts/ultragoal-state.ts approve-review-dispatch-renewal --reason '<why another review round is needed>'
```

Renewal adds `cap += 5` AND restores `phase=pursuing`/`active=true`, so the loop resumes and can run the review the renewal was granted for. The reason is recorded in `budget_extensions`, and `request-complete` lists it for the final report. To finish instead, the user runs `force-complete` (see below) — the only command here a `PreToolUse` guard denies on your Bash path. The hook alone calls `claim-review-dispatch`; the orchestrator must never edit the counters itself.

The routing table above applies at every round. A reviewer-only retry consumes the same budget as a post-repair review; a retry never becomes a repair assignment merely because the budget is low. COMMENT and APPROVE deny any terminal re-review request, including after a renewal.

**Completion fires ONLY on an objective-lane APPROVE AND an objective-scope Evidence Audit pass.** A **COMMENT verdict is NOT sufficient** for completion — `request-complete` requires `objective_verdict=APPROVE`. For the objective self-check, COMMENT is a soft pass: no blocking issue but non-blocking notes remain; address those notes and re-verify until APPROVE. This does not apply to code-review lane LOW notes, which never block. **On an APPROVE,** the Evidence Audit applies the verify-the-verifier shape to your own check: confirm the verdict HOLDS UP by reading the evidence you collected (does it demonstrate the verification surface was met?). If the evidence is missing or does not demonstrate the verification surface, it is an Evidence Gap → continue pursuit, do not complete.

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

Evidence is recorded BEFORE the verdict flips so the full gate (verdict + evidence + per-story artifact checks) is satisfiable the moment `objective_verdict=APPROVE` appears. `request-complete` is the ONLY path to `phase=complete` — the hook layer never writes `complete` (the no-progress cap reached → `budget_limited` block). A `budget_limited` state does not bar `request-complete` in the same turn: drain any in-flight delegated work, harvest and commit its results, then run the completion gate; completion wins over a prior `budget_limited` when every gate passes. Do not dispatch new stories or interrupt running executors during this drain. If the gate is refused and you can name the next concrete action that will produce progress, run `bun ${CLAUDE_SKILL_DIR}/scripts/ultragoal-state.ts resume-pursuit --reason '<that action>'`, which restores `pursuing`, resets the no-progress counter to `0`, and records the reason. Otherwise report the blocker honestly and stop.

APPROVE alone does NOT leave the ultragoal pursuit pursuing/active — the `request-complete` handoff is what transitions to terminal `complete` (and it is structurally gated on completion-evidence, so a write that never reached the gate cannot false-complete).

**Once `request-complete` reaches terminal `complete`, hand off to the human for the final hands-on QA.** The loop never runs the hands-on adversarial matrix, so when you report completion, also prompt the user to run their own final hands-on pass before shipping — the heavy `Skill(skill: "qa")` battery is available if they want it.

**Two lanes gate completion: the objective self-check and code-review.** The completion path runs both the objective-level self-check (correctness, completeness, and evidence audit) and the independent code-review lane (static quality and conventions) — both must pass for `request-complete` to pass. The ultragoal review gate additionally requires a valid `COMPLETE` artifact bound to the current scope contract and either a derived `APPROVE`, or a derived `COMMENT` with hash-bound `record-comment-resolution` evidence when a MEDIUM repair was required; LOW/OUT_OF_SCOPE-only COMMENT needs no resolution. `COMMENT` remains `COMMENT` and is not promoted to `APPROVE`. Excluded items remain visible without becoming work. Advisors are advisory only and do not gate completion. Code-review is a completion-time quality lane and is distinct from design review — the two must not be conflated.

### Final-review advisory routing

Use advisory analysis only for a blocking `REQUEST_CHANGES` result: unresolved `IN_SCOPE + PLAUSIBLE` (HIGH/MEDIUM), `UNKNOWN`, or disputed scope/validity/causality. Oracle supplies read-only evidence analysis; it does not authorize repair or replace the reviewer. An unresolved `IN_SCOPE` + `PLAUSIBLE` HIGH or MEDIUM finding stays an adjudication item unless a repair local to code this pursuit changed is recorded; `OUT_OF_SCOPE`, LOW, and ordinary `COMMENT` notes do not require Oracle and never trigger a fresh review. Malformed or stale artifacts may be diagnosed as input failures; Oracle must not fabricate evidence. For design alternatives or trade-offs, ask Daedalus with the frozen contract, specific question, cited evidence, and bounded options. Sisyphus remains the sole executor.

### Invalidate out-of-requirement repair requests

Every generated finding must be checked against the approved requirements, boundaries, and non-goals. An out-of-requirement finding is retained as `OUT_OF_SCOPE` with its concrete reason and invalidates its proposed repair and any completion authority derived from it; it is not silently treated as a false bug or rewritten as `REFUTED`. If an artifact labels it `IN_SCOPE`, the independent reviewer reclassifies it. The orchestrator must not edit the artifact, hash, or dismissal record to bypass that result. If scope remains uncertain, retain `UNKNOWN` and resolve it from evidence before any repair. Insufficient finding authority never creates a story or acceptance criterion.

### Concrete progress action per non-APPROVE verdict

Every non-APPROVE verdict drives a concrete action within the frozen scope:

- **Unfinished story/COMMENT**: dispatch the named requirement gap to sisyphus, then re-verify. Commentary cannot invent an acceptance criterion.
- **Tactical plan inadequacy**: adjust HOW within the approved WHAT. A change to WHAT, AC, constraints, boundaries, or non-goals follows the planning approval contract before dispatch.
- **REQUEST_CHANGES result**: repair all required HIGH and MEDIUM findings and run affected checks, then fresh independent review; unresolved or failed review input may also take this recovery path.
- **UNKNOWN / invalid / inconclusive review**: send the blocking uncertainty to Oracle first for evidence analysis. LOW never blocks; it may be fixed in the same repair pass when local to code this pursuit changed, with no invented evidence. Malformed/stale input may be diagnosed but never fabricated. `UNKNOWN` holds only when the only known remedy needs excluded behavior or the requirement itself is unclear; Oracle or the orchestrator resolves it from evidence first, and the user decides only when the product requirement itself is unclear. For a no-safe-default domain (concurrency, data destruction, security, external-contract, money), name the exact runtime fact that would settle an uncertain finding; a repair local to code this pursuit added or modified is allowed, and you can accept the risk and record it as a non-goal.
- **Only MEDIUM repairs, excluded findings, or COMMENT notes remain**: when MEDIUM repairs exist, perform them and affected checks, then record `record-comment-resolution` against the exact artifact hash with evidence paths; for LOW/OUT_OF_SCOPE-only notes, report them without recording resolution (a LOW may be fixed in the same repair pass when local to changed code), then request completion. Scope exclusions never become repair work.

### Blocked-stop

Pursuit stops as blocked (non-complete) ONLY on a decidable, point-in-time predicate. The no-progress cap is a separate soft-stop: consecutive Stops without a diff-carrying commit or story transition accumulate toward `max_iterations`, while observed progress resets the counter; reaching the cap yields `budget_limited`, preserves state, and resumes only through `resume-pursuit --reason` after any drain. Exactly two conditions trip blocked:

- **B1** — the objective self-check names NO actionable incomplete work item while the objective is still unmet (no valid progress path: nothing to re-dispatch and the verification surface is not satisfied).
- **B2** — the captured **blocked-stop** slot's objective-specific condition is met.

On either condition: run `set-blocked --reason "<blocker>"`, report the blocker to the user, and stop. A blocked pursuit is non-complete — `set-blocked` can never write `complete`.

### Force-complete: the user's escape hatch, not yours

When a pursuit is genuinely stuck — `blocked`, `budget_limited` with no useful recovery, parked in `renewal-required` where the user chooses to finish rather than renew, or otherwise never satisfying the two-lane gate above — the user (never you) may force it to `phase=complete` directly:

```
bun ${CLAUDE_SKILL_DIR}/scripts/ultragoal-state.ts force-complete --reason '<why this is being force-completed>'
```

**You never run this command yourself** — it is the one ultragoal command a `PreToolUse` guard denies on your Bash path, because only the user decides to finish without passing the gates. If you believe force-completion is warranted: show the user why and the exact command, run `await-user` if the pursuit is still pursuing, and end the turn. Never reach `complete` another way (computer use, a state-file edit, another shell). It bypasses every gate this document describes — the objective self-check, the per-story artifact checks, and the code-review lane — by design, so it is not a substitute for actually satisfying them when satisfying them is possible.

---
name: qa
description: Use when a code change needs standalone adversarial verification that its user stories and scenarios actually work — API, web, mobile, CLI, or job changes — including arrival paths, state transitions, lifecycle variants, failure, malformed input, interruption, misleading success, or idempotency risks.
---

<Role>

# QA

**Core Principle**: Nothing ships without proof, and the fixer never certifies its own fix. qa drives the real application, attacks it, and — if it fails — owns the diagnose→fix→re-verify loop through independent agents until the surface is actually green.

## Overview

Pure dynamic adversarial-e2e verification skill. qa reads the change to author high-coverage scenarios and proves them by execution: static document-vs-code auditing (Security/Data-Integrity checklists, MUST-DO compliance tables, Completeness prose audits) stays `code-review`'s job; the behavior-invisible PRE-FLIGHT contract gate below is a narrow exception, not a static-audit stand-in.

qa is **standalone and stateful**. A single invocation owns the whole cycle — detection, diagnosis, fix, and re-verification — through to a final verdict, persisting its phase/cycle to a state file so an interrupted run can resume with `continue`. Activation is unchanged: invoke qa through its existing skill trigger/tool path; the enforcement below governs an invoked session rather than changing when qa activates.

**Standards:** Every acceptance criterion is proven by a real run, the change survives hostile probing across all 6 adversarial categories, and any regression introduced while fixing it is caught by a fresh full re-run, not the fixer's own say-so.

**Economy principle:** Verify the change's user stories and scenarios by the cheapest means that actually proves them. Spend effort where the change is, and nowhere else. Cheap never means skipped.

</Role>

## QA REQUEST Format

For optional executable-case reuse and its storage contract, read
[reusable-cases.md](reusable-cases.md). It defines the story GWT/AC contract,
known-case-first selection, external-manifest states, native driver formats,
the `qa-replay.ts` wrapper, `record-cell --case-run RECEIPT` binding, and the
independent reset/re-run required before a case is reusable.

The caller composes a QA REQUEST using this structure:

```
# QA REQUEST

## Spec
[WHAT to verify — requirements, criteria, constraints, MUST-NOT-DO scope]

## Required Verification
[HOW to verify — verification commands, QA scenarios, evidence paths to collect. Optional but standard for sisyphus-orchestrated QA requests.]

## Scope
- Changed files:
  - [explicit file paths]
- Summary: [what the implementer claimed]
```

- `#` QA REQUEST → `##` Spec / Required Verification / Scope → `###` internal subsections
- The content of Spec is PLAN's input: it determines the verification targets and the adversarial scenarios PLAN derives.
- `Required Verification` is used when sisyphus explicitly passes verification commands and evidence paths — BASELINE and ADVERSARIAL E2E execute the section's commands verbatim and store evidence at the declared paths.
- When a delegation prompt is included, its sections become `###` headings under `## Spec`

To understand what changed, use `git diff $(git merge-base HEAD main) -- <path>` for context. If `main` does not exist, substitute `master`. To verify correctness, read the actual files directly (Read tool). Do not independently discover which files changed — use the file list from the QA REQUEST Scope.

---

## The Cycle

qa runs a single stateful cycle, in order:

```
PRE-FLIGHT → PLAN → BASELINE → ADVERSARIAL E2E → CHECK → [DIAGNOSIS → FIX → RE-VERIFY loop, ≤5 cycles] → EXIT → CLEANUP → STATE
```

Every phase below runs once per pass, except the bracketed loop, which repeats on CHECK failure until an EXIT condition fires.

### PRE-FLIGHT

A **behavior-invisible contract check** — a narrow exception to qa's dynamic-only posture, because no amount of running the app surfaces a scope violation. Gates on exactly two things:

1. **MUST-NOT-DO scope membership.** A changed file violates the contract **iff it matches the QA REQUEST's MUST-NOT-DO scope** — no positive allowlist, no per-invocation judgment call. Tests and config files are NOT special-cased: they are violations only if the MUST-NOT-DO explicitly names them, and clean otherwise.
2. **B ⊆ A scope boundary.** Expected files (from EXPECTED OUTCOME) = A; Changed files (from QA REQUEST Scope) = B. PASS if B ⊆ A. When the QA REQUEST carries no EXPECTED OUTCOME, A does not exist: record this gate as `not-evaluable` and proceed on gate 1 alone. **Never fill A from the Scope list** — B ⊆ B is true by construction and turns the gate into a rubber stamp that reads like a PASS.

**On violation: immediate REQUEST_CHANGES, cycle NOT executed** — fail-fast. The expensive cycle below never runs against a change that already fails its own declared contract.

At cycle entry, create or re-enter the guarded state with `bun ${CLAUDE_SKILL_DIR}/scripts/qa-state.ts start --target "<what is being verified>"`. A second qa invocation in the same session must run `start` again so it receives a fresh chain and re-armed runtime gates.

### PLAN

Two ordered outputs. The roster comes first because it fixes where every scenario must be entered and what its evidence has to show — scenarios authored before it drift inward toward whatever is easiest to call.

#### PLAN.0 — Feature-map context hook

Before rebuilding product context, read the QA-local [feature-map.md](feature-map.md) contract and discover its commands (`feature-map.ts help`, `feature-map.ts query`):

```bash
bun "${CLAUDE_SKILL_DIR}/scripts/feature-map/feature-map.ts" help
bun "${CLAUDE_SKILL_DIR}/scripts/feature-map/feature-map.ts" help query
bun "${CLAUDE_SKILL_DIR}/scripts/feature-map/feature-map.ts" query --text "<changed surface>" --project .
```

The map is persistent input, not a scope ceiling and not spec authority. Re-check current code and product/spec discovery, including omitted arrival paths, state-change writers, and lifecycle paths; keep expected contract and observed implementation separate. Use the returned absolute `path` and `revision` as provenance, never an inferred local path or remembered revision. If the CLI reports `storage_not_configured` with `ask_user_for_storage`, ask the user for a storage location; do not choose a default. While that human-required decision is pending, continue current-code/spec discovery and other PLAN work unless the gate itself is required to proceed. A missing feature (`feature_not_found`) is distinct from an unconfigured store. A corrupt, invalid, unreadable, or unavailable configured store is a runtime error: do not reset or fallback; retain the error and continue the current-code/spec investigation where possible.

Do not report a map/storage problem as a product behavior failure. Classify the observation as one of `map drift/document`, `tool failure`, `product behavior failure`, or `environment block`; only the last two can describe the product under test, and the evidence must support that classification.

#### PLAN.1 — Actor Roster, before any scenario

Enumerate every actor whose observable behavior this change alters and pin where this cycle verifies each one, as `actor · boundary · driver · reachable`:

- **actor** — who acts: an end user on a named path, a specific role (household owner vs payer), an operator/admin, a calling client system, an attacker.
- **boundary** — the verification surface: where this cycle proves that actor's story (see *The cheapest proof*).
- **driver** — the tool that reaches that surface (`agent-device` / `agent-browser` / `curl` / `bash`).
- **reachable** — `yes`, or the named obstacle plus the deepest point toward the surface that IS reachable (see *Boundary substitution*).

Emit the result as the `## Actor Roster` output section.

#### The cheapest proof

Let the diff decide. Go outward only as far as the changed code reaches.

- **Server-only change** → the API as the client calls it (`curl`). A client whose code did not change needs no screen.
- **UI change** → that screen, in one browser or on one device. A second platform only for native or platform-branching code.
- **An automated test that runs the scenario's path and asserts its expected outcome is proof.** Run it this cycle, read its assertions, record it with `--evidence-surface test` and the test named in `driven-at`. Do not re-drive it by hand.
- **A device is the costliest tool.** Acquire one only when a claim needs a rendered screen; release it the moment those scenarios are recorded.

If the cheapest proof needs a local stack or seeded data, set it up.

Record the roster in state before authoring scenarios. First capture the acceptance criteria — the concrete pass conditions this change must meet, taken from the QA REQUEST Spec (or the derived expected outcome) — with `qa-state.ts set-acceptance --json '["…","…"]'`; the command accepts only a JSON array of non-empty strings, and the report renders its Acceptance Criteria section from this record. Then add each actor with `qa-state.ts add-actor --id … --name … --boundary … --driver agent-device|agent-browser|curl|bash --reachable unknown`, and update `--reachable` after the PLAN.1 probe. Add at least one story per actor with `add-story`; the roster and stories are the referential base for every scenario cell.

After each story exists, record the feature-map lookup as planning context (not execution-verified fact), before BASELINE begins:

```bash
bun "${CLAUDE_SKILL_DIR}/scripts/qa-state.ts" record-story-provenance \
  --story ID --json '{"features":[{"id":"stock.view","revision":"<getrevision>","entrypoints":["push"],"states":["new-user"]}],"code_ref":"<commit/build id plus dirty diff evidence>"}'
```

The `revision` must match the live feature-map file. Feature labels are not metadata membership. Legacy, missing, or unverified maps do not permit fabricated IDs: retain code/spec discovery and evidence and report the story as not recorded. After each FIX cycle, recheck the live map and rerecord planning provenance.

#### Story Planning Context (PLAN output)

Add one separate row per story beside the roster/scenario planning output. This is planning context, not a new scenario field or execution evidence:

| story id | map lookup status | feature id@revision or not recorded(reason) | planned entrypoints/states | code_ref |
|---|---|---|---|---|
| `<story-id>` | `pending` / `notfound` / `error` / `ok` | `<id>@<live-revision>` or `not recorded(<reason>)` | `<entrypoints>` / `<states>` | `<commit/build id + dirty diff evidence>` |

A PLAN-only lookup that has not reached an actual `get` remains `pending`; never invent an ID or revision. Planned labels are allowed as hypotheses, but do not turn them into membership. After the story is created and the actual `get` result is available, use the existing `record-story-provenance` command to record the row. Keep this context table separate from the original six-field scenario table.

**Focus on the change.** A platform whose code did not change is not under test. A precondition owned by another platform is set through its API, a seed script, or the database — not by launching its UI.

**When a scenario needs an account, auth, or a data state, read the project's provisioning protocol before authoring — that path is documented, never improvised (CRITICAL).** A project that has QA accounts and seedable data documents how QA obtains them: a list of pre-provisioned test accounts and the data state each carries (already has a Program/reports vs. a bare household), the admin/operator QA tool that seeds programs/reports/fixtures, the auth method for each account, and the one command that stands the local stack up with its env prerequisites. When a scenario carries such a precondition, locate and read that protocol (mine `README`/`CONTRIBUTING`, `docs/`, `rules/`, `Makefile`, `docker-compose*.yml`, `scripts/` per [stage1-commands.md]) and pick the account/fixture and QA tool it prescribes for that scenario's required data state, before you touch a driver. If the search turns up no such protocol, record that in PLAN and proceed to the bootstrap ladder's fallback — never invent provisioning details, and never block on this lookup a change that has no account/auth/data precondition at all. Hand-rolling signup/onboarding to manufacture data, minting a token, or injecting dummy credentials **before trying** a pre-provisioned account or QA seeding tool the project does document for that state is a wrong detour, not a bootstrap — where a documented path exists it is what you attempt first, and the improvise options are the fallback for when it is absent or, once tried, unusable (see the bootstrap ladder's *Documented protocol first* rung). A precondition the documented protocol can satisfy is not an obstacle you improvise around; it is a step you execute as written.

#### PLAN.2 — Scenarios, per actor

Parse the QA REQUEST's Spec/AC into concrete verification targets: what BASELINE must run green, what ADVERSARIAL E2E must attack at each actor's verification surface, which scenarios existing automated tests already prove, and what CHECK will judge against. MUST-DO tables and Completeness sub-checks are `code-review`'s static-audit territory, not PLAN's.

See [scenario-authoring.md] for the risk/coverage-gap derivation framework.

Create each story with the structured contract required by [reusable-cases.md](reusable-cases.md): a nonblank goal, Given/When/Then arrays, and acceptance-criteria links to the session AC records. The CLI flags are `--goal`, `--given`, `--when`, `--then`, and `--acceptance-criteria` (the array values are JSON). If the optional case store is configured, list/get matching known cases first and use them as planning input while authoring the complete current-cycle story/cell chain, including new, failed, stale, or uncovered paths. Do not execute replay during PLAN; a known case never replaces a story or scenario cell.

Author every story's eight cells before leaving PLAN: the six bare classes plus `cls1/hang-timeout` and `cls5/flaky-green`. Use `qa-state.ts author-cell --story … --cls … [--sub …] --attack-point "…" --priority H|M|L`. `advance-phase BASELINE` (or `set --phase BASELINE`) and every later phase are refused until `chainComplete` is true, so PLAN cannot be left with an empty or content-free attack plan. Once `chainComplete` holds at hands-on execution, replay matching known cases before exploratory driving of the remaining paths.

### BASELINE

Build/test/lint green baseline.

1. Discover project commands: check `~/.omt/{project}/project-commands.md` cache first, then `CLAUDE.md`/`README.md`/build files, then ask the user. Save discovered commands back to the cache.
2. Run: Build (fast build/typecheck) → Tests → Lint. Slow native build (e.g. an RN bundle) runs only when native code changed or this is a release build (native-code-or-release) — otherwise skip it.
3. Save the full output of each check as an evidence file (see Evidence Saving Protocol below).
4. ANY failure = immediate REQUEST_CHANGES.

**See** [stage1-commands.md] for command-discovery detail, special cases (no tests for changed code, no build system), and output format — the content there is BASELINE's detail target, not a separate stage.

### ADVERSARIAL E2E

Drive the changed surface for real and attack it. Two parts, both required when the change touches a risk surface — user-facing OR an internal risk surface (feature-flag-gated logic, payment/notification resolver internals, permission/state transitions), per [stage3-handson.md] `### Decision Logic`; only a genuinely inert refactor that touches no risk surface skips:

1. **Execute caller-provided scenarios verbatim**, with per-scenario evidence. ANY provided-scenario failure = immediate REQUEST_CHANGES. Caller-provided scenarios always run verbatim, unchanged — the derivation framework below governs only scenarios qa self-authors; it never rewrites what the caller handed in.
2. **Self-author the 6-axis adversarial matrix** for the changed surface, in this order — breadth before depth:
   1. **Derive candidate scenarios by breadth** via [scenario-authoring.md]: Layer A impact-map → coverage-gap → H/M/L priority, then Layer D product use-case breadth (arrival paths · adjacent state transitions · lifecycle stances) from a product-context map built from the repo.
   2. **Attack each derived scenario with the applicable depth rows, working highest-priority (H) first**, from the 6 coverage axes: failure paths, boundary/malformed input, injection, interruption-resume + dirty state, misleading success, idempotency. See [stage3-handson.md] `## Adversarial Scenario Matrix` for the full matrix and the lifecycle/applicability detail (start → verify → stop). Rows 7–9 (stale-state, dirty-worktree, flaky-rerun) are per-run checks recorded separately with `record-run-check`.

When a caller-provided scenario fails, record its failing cell and record every remaining unrun cell as `na` with the halt reason before declaring REQUEST_CHANGES. Apply the same sweep after any EXIT fired following a FIX dispatch (max-cycles or Safety): `inc-cycle` invalidates prior-cycle records, including baseline and run-check records in the current view, so record the current cycle's remaining cells explicitly rather than leaving the gate with unrecorded work. Prior-cycle records remain in the raw state/history for audit.

For a genuinely inert refactor with no risk surface, still author the roster and all cells, record the story baseline and all three run checks, record every cell as `na` with the no-risk-surface reason, and run `qa-state.ts declare-inert --reason "<why nothing is reachable>"` once. Without that declaration an H-priority `na` blocks APPROVE.

**Inline modality drivers, no tmux.** qa itself drives the modality-appropriate tool inline — it is not delegated to a separate driver subagent:

| Change Type | Driver |
|-------------|--------|
| API endpoint | `curl` |
| Frontend / UI | `agent-browser` (fallback: `playwright`, if available) |
| Mobile / native UI | `agent-device` |
| CLI / TUI | interactive `bash` |

For mobile/native UI work, load the `agent-device` skill first and derive the current concrete commands from its runtime `agent-device help <topic>` guidance. Do not copy or invent concrete driving command syntax in this skill.

**Drive at the verification surface**, or cite a qualifying test. A harness you wrote to call the changed function is a unit check, not a scenario.

A **caller-provided** scenario runs verbatim at whatever layer it enters; record that layer as its `driven-at`, and it proves nothing above it.

**Bootstrap only what the surface needs.** A missing precondition is work, not an obstacle. Verify an undeployed change on an isolated local instance you own, supplying any missing env config yourself. Take accounts and data from the project's documented QA provisioning first (see [stage1-commands.md] Discovery Order); only when none exists, seed rows, sign up, or mint a token. Install a missing tool outside the worktree. When the QA REQUEST verifies the deployment itself, the deployed environment is the surface and its failure is the FAIL.

**Boundary substitution.** Fake only a hop you cannot reach — absent hardware, an off-network third party — and record it in `driven-at`. If even that is impossible, the scenario is `NOT-RUN`, not PASS, and its requirement is **unverified**. An obstacle declared without the attempts behind it is evasion, not a coverage delta.

**Honesty.** Claim what the evidence proves, nothing more. An API response proves what the client receives. A test proves what it asserts. A launch screen proves the app started. Evidence from two depths never merges into a deeper claim.

#### Red Flags

| Thought | Reality |
|---------|---------|
| "Only the server changed, but users see it on the app — boot a simulator" | `curl` the API. The app is not under test. |
| "It's React Native — check iOS and Android" | One platform, unless native or platform-branching code changed. |
| "A test already asserts this, but I'll drive it by hand too" | Cite the test. Spend the effort on what it doesn't cover. |
| "The flag lives in the admin web — launch it" | Set it through the API, a seed, or the DB. |
| "Keep the device up until CLEANUP" | Release it now. |
| "The suite is green, so the ACs are met" | Name the test that asserts each AC. |
| "The app launches, so the change works" | Show the screen where the change is. |
| "No seed data or account, so NOT-RUN" | Create it. |

Command execution is **non-blocking only**: every command either returns control on its own or is explicitly backgrounded (`run_in_background`, or trailing `&` with output redirected — a bare `cmd &` without redirection leaves the harness waiting on inherited file descriptors and hangs the agent). A bare blocking command that hangs the shell is forbidden. See [stage3-handson.md] Step 3.2 for the lifecycle this backs (start in background → wait for readiness → verify → stop, never leaving a server running).

**By-design non-idempotency note:** running ADVERSARIAL E2E actually exercises the application (starts servers, sends requests, mutates state); some operations under test are intentionally non-idempotent per spec, which is not itself a defect.

### CHECK

Is the goal met — BASELINE green and the full ADVERSARIAL E2E pass (provided scenarios + matrix)? Judge each scenario on its own row, then ask the questions that a per-scenario PASS does not answer:

**Required evidence review, before verdict:** after recording each visual pass/fail
cell, open its raw captures and action record and submit the claim review with
`qa-state.ts review-evidence --story … --cls … [--sub …] --json-file <review.json>`.
Read [presentation.md](presentation.md#claim-review-record) for the required
fields and example. Cover every asserted outcome, not just screen identity.
The state keeps the execution result separate from evidence sufficiency: a
missing, insufficient, or stale review blocks APPROVE/COMMENT and completion;
the report shows **근거 미검증**, not a product failure or NOT-RUN. Re-capture
missing outcomes and review again. File existence alone does not close CHECK.

- Did each scenario reach the verification surface its actor row names, or stop at an inner layer? Read `driven-at`, not the PASS.
- Does each observation name its medium — screen capture, API/CLI response, or named test — and claim only what that medium proves?
- Is any `H`-priority scenario still `NOT-RUN`? Then the goal is not met, whatever the other rows say.

A FAILED scenario row blocks CHECK, with exactly one carve-out: a failed **self-authored `M`/`L`** row whose finding scores **50–74** — the `nitpick (non-blocking)` band, which [feedback-protocol.md]'s scale defines as *real but minor, rarely happens in practice* — leaves the cycle a **soft pass**: the row stays FAIL in the roster, the finding is reported as a LOW note, and the verdict is COMMENT, never APPROVE.

Everything else blocks. A finding scoring **75+** blocks whatever the row's priority — the scale calls 75 *likely to occur in practice, directly impacts functionality*, which is a defect, not a nitpick. A failed **`H`-priority** row blocks whatever its score. A failed **caller-provided** row blocks — it never soft-passes, per `### ADVERSARIAL E2E` part 1. And a failed row whose finding cannot be scored at **50 or above** is not a soft pass but an unexplained failure: re-run or diagnose it, because a scenario that failed for reasons you cannot state is the one most likely to matter. Never restate a failed row as PASS to reach a clean sheet.

- **Pass → PASS.** Emit APPROVE (see Output Format).
- **Soft pass → PASS with COMMENT.**
- **Fail → enter the loop below.**

### DIAGNOSIS → FIX → RE-VERIFY (loop, ≤5 cycles)

CHECK failure hands off to a three-way-separated loop so the agent that fixes the defect is never the one that certifies the fix:

#### DIAGNOSIS

delegate to `oracle` (fresh, read-only, root cause + file:line). oracle never modifies files; it returns a diagnosis, not a patch.

#### FIX

delegate to `sisyphus-junior`. **sisyphus-junior commits its own scoped fix** — it authored the hunks, so it alone can stage them precisely; qa cannot separate a fix's hunks from a user's hunks in a shared file. Never `git commit -a`.

`cycle++` happens here — **cycle++ at FIX dispatch** is the counted unit (pre-fix detection is cycle 0, uncounted).

#### RE-VERIFY

qa re-runs **BASELINE + the FULL matrix** from scratch — not just the failed scenario. **Distrust the fixer's report**: sisyphus-junior's own claim of "fixed" is not evidence; only a fresh, from-scratch re-run counts. Running the full matrix (not only the scenario that failed) is what catches a fix that silently regresses a scenario that was previously green.

Loop back to CHECK. Continue until an EXIT condition below fires.

### EXIT

| Condition | Trigger | Action |
|-----------|---------|--------|
| **Goal Met** | CHECK passes (BASELINE + full matrix green) | PASS → APPROVE |
| **Goal Met, soft pass** | CHECK soft-passes (one carve-out row, per `### CHECK`) | PASS → COMMENT, carrying the failed row and its LOW note |
| **max_cycles=5** | `cycle` reaches `max_cycles` (5) still unresolved | Terminate, report unresolved with last diagnosis |
| **Safety** | A safety invariant refuses to proceed | Terminate, report the refusal reason |

- **max-N boundary**: with `cycle` starting at 0 and `cycle++ at FIX dispatch`, `max_cycles=5` permits exactly 5 fix attempts (cycles 1..5); the 5th fix is attempted and re-verified, then EXIT fires if still unresolved.

### CLEANUP

Every background resource this cycle starts is recorded, together with the command that stops it:

- **Simulator or emulator**: get it only through `acquire-device` (stage3-handson.md, Modality Setup), and only when a claim needs a rendered mobile screen. The command creates a device owned by this session and records it. Release it as soon as its scenarios are recorded. A device that is already booted may belong to another concurrent session or to the user. Do not reuse it unless the user names it, and never record or stop it.
- **Server or other process**: record it right after it starts:

```
bun ${CLAUDE_SKILL_DIR}/scripts/qa-state.ts record-resource --id <pid> --kind server --stop 'kill <pid> 2>/dev/null; for _ in $(seq 50); do kill -0 <pid> 2>/dev/null || exit 0; sleep 0.2; done; exit 1'
```

The stop command succeeds only once the process is gone: it signals, then waits up to 10 s for the PID to disappear, and it also succeeds when the server already exited. A bare `kill <pid>` only sends a signal, and it fails on a server that already crashed.

CLEANUP releases each recorded resource with `release-resource --id <id>`, which runs the stop command and records the release only when it exits 0. `complete` refuses while any resource is unreleased and names each one, whether the cycle ended in PASS or an EXIT condition. Remove temp files this cycle created as well. A leaked process corrupts the next run. **Never remove a path supplied through `--evidence-path`**, regardless of whether it came from a caller, a required-verification entry, or a self-authored scenario; completion re-probes every passing cell and baseline evidence path.

### STATE

Persist `phase`/`cycle` (plus `max_cycles`) to a state file after every phase transition, via:

```
bun ${CLAUDE_SKILL_DIR}/scripts/qa-state.ts <sub>
```

A `continue` invocation reads this state and resumes at the last recorded phase/cycle rather than restarting the cycle from PRE-FLIGHT. (The CLI itself is authored elsewhere — this section only pins the invocation contract qa's cycle relies on.)

The chain-recording surface is: `set-acceptance`, `add-actor`, `add-story`, `author-cell`, `record-baseline`, `record-cell`, `review-evidence`, and `record-run-check`. Use `set-verdict APPROVE|COMMENT|REQUEST_CHANGES` to persist the verdict; `waive --story … --cls … --reason "…"` is yours to run when a cell cannot be verified for a reason outside the change (a harness limit, an unreachable dependency); the reason is recorded, the report shows a waive banner above the overview, and your final message must name each waive. Never reach the same result another way — editing the state file, or recording a fake pass. When the cycle needs a decision only the user can make — a question about the requirement itself — ask it in plain text, then run `await-user` and end the turn. That parks the Stop gate WITHOUT spinning the no-progress counter (the pause is not a failure), and the next progress write auto-clears it when you resume on the user's reply. For a no-risk-surface cycle, use `declare-inert --reason "…"`. Run `bun ${CLAUDE_SKILL_DIR}/scripts/qa-state.ts help` to see the full command roster and which are user-only. Runtime gates consume the persisted chain/record predicates: the phase funnel blocks BASELINE until the roster→story→cell chain is complete, the driver guards block `agent-device`/`agent-browser`/`curl`/`bash` while the roster is incomplete or once BASELINE has been reached with an incomplete chain (PLAN reachability probes remain available), and the Stop gate validates the raw state on both Claude and Codex. Direct writes to `qa-state-*.json` are denied; use the CLI.

#### STATE/post-run feature-map maintenance

After the run, update a map only from observations verified in this cycle. An actual failure, regression, or evidence may be retained as such; keep expected contract and actual observation separate and never normalize a failure into expected or pass. If the observation is reusable, curate it through the optional case functions only after resetting and independently rerunning the saved recipe with assertions. Preserve the case's native runner format and surface; trace/recording/JUnit artifacts are not executable or boundary proof. Use the feature-map guide's `get`/`save --expect <live-revision>` conflict protocol for feature maps, and the reusable-case guide's revision conflict protocol for cases. Re-read before reconciling a conflict, never blind-overwrite, and never auto-configure storage. If case storage is unconfigured or disabled, keep the case as a current-run draft/report only and continue ordinary QA; keep the draft rather than silently writing project files. The rule is: re-`get` before reconciling a conflict.

Once the cycle concludes (any EXIT outcome — Goal Met, max_cycles, or Safety), first run `bun ${CLAUDE_SKILL_DIR}/scripts/qa-state.ts set-verdict <APPROVE|COMMENT|REQUEST_CHANGES>`, then run `bun ${CLAUDE_SKILL_DIR}/scripts/qa-report.ts --session <id> --out <path> [--narrative <json-file>]`, open the rendered HTML and verify all claim images remain legible, run `bun ${CLAUDE_SKILL_DIR}/scripts/qa-state.ts review-report --path <html>`, dispatch the `presentation-reviewer`, handle its verdict, then run `bun ${CLAUDE_SKILL_DIR}/scripts/qa-state.ts complete`, and only then report the verdict prose. The renderer records the HTML/state identity; `review-report` records the visual inspection attestation. Editing the HTML or recorded facts requires re-render and re-review. `complete` is gated by the same predicates as Stop and refuses an unrecorded or falsely approved cycle; it marks an earned terminal state inactive so the finished cycle is not resurrected as "in progress" in a later session.

**Presentation review (required, after `review-report`, before `complete`).** Dispatch the `presentation-reviewer` agent to contrast the report's reader-facing presentation layer against the actual evidence and the material this cycle verified against. It is skill-agnostic, so assemble the bundle:
- **presentation**: the rendered report HTML (its top presentation layer) and the `--narrative` JSON you authored.
- **sources**: the recorded evidence (screenshots, observations, run checks from qa-state) and the referenced plan/spec/ticket/docs the acceptance criteria came from.
- **reader_persona**: "a context-free PO/designer who does not read code — judges from the report alone whether the change met its requirements, in product/user terms".

Its verdict is `APPROVE` / `REQUEST_CHANGES` / `COMMENT` / `INCONCLUSIVE`. Only `APPROVE` or `COMMENT` may proceed to `complete`; on `REQUEST_CHANGES`, fix the narrative/report, re-render, re-`review-report`, and re-review before `complete`. `INCONCLUSIVE` or a missing/malformed verdict blocks handoff and completion and requires fixing the presentation or re-supplying the review inputs. This is a required review step, not an added CLI gate; run it every time. It never overrides a recorded pass/fail fact — those come from qa-state, and a fidelity finding against them means the narrative misread the record, not that the record changes.

---

## Fix-Loop Nesting Contract

qa's fix-loop (DIAGNOSIS → FIX → RE-VERIFY) **must NOT be called inside another fix-loop** — nesting it in a caller-owned pursuit loop double-loops retries and confuses which loop owns EXIT. This is a documented contract, not an enforced one: **YAGNI** — no detection-guard code is written for a caller that does not exist yet. Named upgrade trigger: **add a code guard when qa gains its first fix-loop-owning caller.**

---

## Evidence Saving Protocol

### Core Rule

Every verification **command execution** (BASELINE, ADVERSARIAL E2E, RE-VERIFY) produces an evidence file. Evidence files are the audit trail; downstream gates check for their existence before accepting a verdict.

### Objective vs. Subjective

| Output Type | Disposition | Examples |
|-------------|-------------|---------|
| Objective command output | Save to file | build/test/lint logs, curl response body + status, agent-browser/Playwright/agent-device screenshots and reports, CLI execution logs |
| Subjective judgment | Response only (no file) | PLAN's spec/AC reading, oracle's diagnosis narrative |

### Actor-Perspective Evidence (per executed scenario)

**Required visual evidence contract — read [presentation.md](presentation.md) before recording and reporting.** For every pass or fail recorded with an `agent-browser`/`agent-device` evidence surface, `record-cell` requires separate `--evidence-before` and `--evidence-after` screenshot files plus `--evidence-action`. The completion predicate rechecks these slots. Capture the actual actor's screen immediately before the action and at the asserted outcome, in this scenario and cycle. The report additionally requires `scenarios[cellKey].observed` explaining the action, visible result, and expected result, **alongside both embedded images**. An observation is not a replacement for an image at a visual boundary.

| Surface actually exercised | Required proof |
|---|---|
| Browser or device UI | Real before screenshot → recorded actor action → real after screenshot; both images visible on the scenario card, plus observed explanation |
| API caller or text CLI | Actual request/command and received response/output, with a reader-facing observed explanation; screenshots of logs do not strengthen this proof |
| Automated test (`--evidence-surface test`) | The saved output of this cycle's test run, `driven-at` naming the test file and case, and an observed explanation of what the test asserts in the scenario's terms |
| Visual TUI or physical device state outside a screenshot-capable driver | Capture the actual display/state with the appropriate available capture mechanism; disclose an evidence gap if it cannot be captured |

For each additional visible state asserted by a scenario (error notice, permission denial, loading state, recovered state), capture that state too. A landing-page image, a screenshot from another actor/run, a generated/mock image, or a diagram cannot prove the asserted outcome. Preserve the original capture; any resized copy must retain the asserted UI and legible result. Before/after files may show identical content when no visible change is expected, but must be separately captured files.

**Final-report gate:** the `qa-report.ts` CLI refuses visual scenarios with missing/unreadable/non-embeddable before/after images or missing observed prose. It also refuses an image that would fall back to a path because of the per-file or cumulative embed budget. Resize/re-encode captures without changing the evidence, update the recorded paths, and render again. Open the resulting HTML and inspect every visual scenario card at readable size before `complete`. If capture or embedding remains unavailable, report the exact evidence gap and leave verification unfinished; do not claim a product failure, `na`, or PASS merely to close the record.

An evidence set proves what its actor could observe at its verification surface. Every scenario executed by a driver gets its own set, named for that scenario id from the roster so the two map 1:1, holding three slots in this order:

| Slot | What it holds |
|------|---------------|
| `before` | The actor-observable state the scenario starts from — the screen the actor is on, the value the endpoint currently returns, the record as it stands. |
| `action` | The action as the actor issues it at its boundary — the tap/click sequence, the exact request, the command typed — with the immediate response. |
| `after` | The outcome the actor observes — the resulting screen, the response body, the delivered payload or written record — asserted against the scenario's `expected`. |

At a UI boundary, `before` and `after` are captures of the asserted state: the screen where the change is visible. **A screenshot of a launch, splash, or landing screen is not scenario evidence** — it proves the app started.

Internal signals (server logs, DB rows, emitted command payloads, instrumentation) are supporting evidence attached beside these three, never a replacement for them. A whole-suite build/test/lint log is BASELINE evidence; a scenario proven by a test cites that test's own run output instead of the three slots.

### Evidence File Content Requirements

Evidence files must contain meaningful content that demonstrates the verification result. Empty (0-byte) files are not valid evidence. When a command produces empty stdout, record the command executed and its exit code so the file is not empty.

### Evidence Path Priority (3-Tier)

1. **Explicit path from QA REQUEST** — caller explicitly provided a path
2. **Plan QA Scenario Evidence field** — use `$OMT_DIR/evidence/{plan-name}/{task-slug}/{scenario-slug}.{ext}`.
3. **Auto-generated path (fallback):**
   ```
   $OMT_DIR/evidence/{work-slug}/{task-slug}/{check-slug}.{ext}
   ```
   Ensure the target directory exists before saving (`mkdir -p`).

### Evidence Reporting in Response

After the cycle completes, include a `## Evidence Files` section listing every evidence file saved, with `$OMT_DIR` expanded to its absolute path:

```
## Evidence Files
- /Users/dev/.omt/my-project/evidence/add-user-endpoint/implement-user-service/build.txt
- /Users/dev/.omt/my-project/evidence/add-user-endpoint/implement-user-service/npm-test.txt
```

Omit this section when no commands were executed (a PRE-FLIGHT fail-fast, judgment-only).

---

### HTML Report

At STATE, immediately after `set-verdict` and before `complete`, qa renders a self-contained HTML report via `bun ${CLAUDE_SKILL_DIR}/scripts/qa-report.ts --session <id> --out <path> [--narrative <json-file>]`. The renderer reads the recorded chain through the `qa-state get` / `readQaView` path and renders **from qa-state records, not re-narrated** — every AC, actor, story, scenario, evidence path, and PASS/FAIL/verdict fact in the report is exactly what qa-state recorded, so the report cannot drift from what actually ran. Execution-account narrative — issue descriptions, expected-vs-actual prose, oracle diagnosis — is supplied at render time through `--narrative`, never persisted to qa-state. Evidence-review judgments are different: they are required persisted claim records, not optional narrative.

**Presentation layer (reader-facing, at the top of the report).** Above the verification log, the report leads with a product/user-centric narrative a context-free PO/designer reads first to judge whether the change met its requirements — without opening code or the audit log below it. It is **not** a code-diff summary and **not** "backend changed → tests passed". It reads top-down as *what was asked, then what we saw*: ① a feature overview; ② an **Acceptance Criteria · 충족 현황** board — each recorded acceptance criterion with its satisfied / not-satisfied / partial / unverified verdict and the scenario + evidence that proves it (the PO's at-a-glance answer; AC text and its verdict are one merged section, not two); ③ a big-picture diagram of the user flow; ④ an **액터 · 영향받는 유저** section — one block per actor (the roster and the affected-users narrative are the same actors, merged), naming who is affected (admin / product user / conditional user / partner …), how each uses the product (software + hardware), and whether their boundary was reachable; ⑤ a **유저 시나리오 · 근거** section presenting, per story, a short scenario-overview intro and then ONE card per scenario — each carrying its own real-software record (an authored observation plus before/after screenshots for screen scenarios; an observation grounded in the response or the cited test otherwise), with final visual report generation blocked when a required image or observation is missing — plus a plain-language coverage summary. Below the reader layer sits the record-faithful audit (per-cell 시나리오 상세 기록, which carries each scenario's technical boundary + driver — there is no separate actor-roster table — plus failures, verdict, evidence files). Author this presentation before rendering and supply it through `--narrative` as a `presentation` object; **[presentation.md]** owns the full authoring contract, the JSON shape, the anchoring rule, and the self-audit. Every part is anchored to a recorded fact — `affectedUsers` by actor id, `scenarioFlows` by story id, `requirementMapping` by AC index — so the layer cannot drift or invent: prose for an actor absent from the roster is ignored (an affected user missing from the roster is a roster gap to fix with `add-actor`, not to invent in prose). Any required slot left unwritten renders a **visible `gap` marker** in the report, so a skipped part shows rather than silently vanishing.

For `requirementMapping`, each entry must have a non-empty `cellRefs` array of `{story, cls, optional sub}` selectors. The renderer validates every ref against exactly one recorded current-cycle cell and its recorded status (`pass`, `fail`, or `na`): `yes` requires every referenced cell to be `pass`; `no` requires every referenced cell to be `fail`; `partial` requires at least one `pass` and one `fail` and no `na`; `unverified` requires at least one valid `na`. Missing/legacy/malformed/duplicate/stale/unknown/ineligible mappings fail closed to a visible neutral gap (`미판정`) rather than a green verdict. Prose evidence explains a verdict but cannot establish it.

The reader-facing **유저 시나리오 · 근거** section is story-level and clean: per story it shows the actor's name, the authored user flow, that story's evidence (the current-cycle baseline plus each scenario's `before` / `action` / `after` and recorded `evidence.path`), and a plain-language coverage summary — the six adversarial axes by name, never the `cls` number. It deliberately omits the cell record's implementation-flavored fields (`driven_at`, `why_needed`, `na_reason`, `attack_point`, the actor's `boundary` code path), which the QA engineer writes technically for the audit trail; those live in the record-faithful **시나리오 상세 기록 (감사)** section below — one row per cell with its `cls`, `attack_point`, `driven_at`, result, and recorded evidence paths — so a context-free reader never meets implementation leakage while full traceability is preserved. A story whose verified (pass/fail) scenarios carry no evidence renders a loud `gap` (a pass cell cannot even be recorded without evidence; `na` is the one evidence-free status). Unreadable or unembeddable visual evidence blocks final report generation; resize/re-encode the capture and update the recorded path. A fresh `start` clears `acceptance_criteria`, so a new report cannot inherit the previous cycle's criteria.

The report is produced on **every cycle that reached a roster** (PLAN.1 ran) — this includes the inert-refactor zero-row case. The sole exception is the **PRE-FLIGHT fail-fast**, which never reaches PLAN and therefore renders no report.

The report file is self-contained: inline `<style>`, zero runtime `<script>`, no external CSS/JS/font/image reference — it opens offline. Evidence embeds are capped at 2 MiB per file and 16 MiB cumulatively; visual images that exceed either budget block final report generation; reduce image size and update recorded paths. Non-image audit files may retain a path-only fallback. Save it under the evidence directory, e.g. `$OMT_DIR/evidence/{work-slug}/{task-slug}/report.html`.

---

<Output_Format>

## Output Format

```markdown
## Cycle Summary

| Phase | Status | Details |
|-------|--------|---------|
| PRE-FLIGHT | PASS / REQUEST_CHANGES | [MUST-NOT-DO / B⊆A result] |
| BASELINE | PASS / FAIL | [build/test/lint summary] |
| ADVERSARIAL E2E | PASS / FAIL | [matrix + scenario summary] |
| Cycles run | N / max_cycles | [reason if terminated early] |

## Actor Roster

| actor | boundary | driver | reachable |
|---|---|---|---|

One row per actor the changed surface serves, from PLAN.1. `boundary` names the verification surface. `reachable` is `yes` or the obstacle plus the deepest reachable point toward that boundary. On a PRE-FLIGHT fail-fast the cycle never reaches PLAN, so this section is absent rather than empty — same as the scenario roster below.

## Story Planning Context

| story id | map lookup status | feature id@revision or not recorded(reason) | planned entrypoints/states | code_ref |
|---|---|---|---|---|
| [PLAN table row] | pending / notfound / error / ok | id@revision or not recorded(reason) | planned entrypoints/states | commit/build + dirty diff evidence |

This PLAN-only context row is separate from the six-field scenario shape. `pending` means lookup has not reached `get`; it carries no invented ID/revision, although planned labels may be listed. After story creation plus actual `get`, record successful feature refs with `record-story-provenance`; after a FIX cycle, recheck and rerecord them. State and HTML persist only successful feature refs, `code_ref`, cycle, and feature absence; pending/notfound/error reasons remain in the final Markdown Story Planning Context rather than being promised as state or HTML fields.

## Scenarios Executed

| # | source | actor | driven-at | preconditions | steps | expected | result | evidence | why-needed | priority |
|---|---|---|---|---|---|---|---|---|---|---|

Every row's `source` is either `self-authored` or `caller-provided`. A `self-authored` row carries the six-field shape from [scenario-authoring.md] — actor · preconditions · steps · expected · why-needed · priority — filled in full; a `caller-provided` row carries whatever shape the caller supplied. `driven-at` names the surface actually entered (or the test cited) plus any substitution; `result` is PASS / FAIL / `NOT-RUN`; `evidence` is the path to that scenario's evidence set. This table is the canonical scenario record for the cycle: `result` maps to `Status` and `why-needed` maps to `Why-Needed` in the four-column working table [stage3-handson.md] mandates for hands-on execution — the column-count divergence is declared here, not fixed there.

Close the table with exactly one coverage-delta line naming the impact-map domains from [scenario-authoring.md] and the three Layer D use-case axes (arrival paths · adjacent state transitions · lifecycle stances), stating which of those the rows above cover and which are left uncovered.

## Verdict: [APPROVE / REQUEST_CHANGES / COMMENT]

**Report:** [absolute path to the self-contained HTML report file — leads with the reader-facing presentation layer ([presentation.md]) above the verification log; or "not generated (PRE-FLIGHT fail-fast)" when the cycle never reached a roster]

## Issues (if any)
[For each issue:]
- **[CRITICAL/LOW]**: [Brief description]
  - Location: [file:line]
  - What: [problem]

## Evidence Files
- [absolute path to each evidence file saved during this cycle]

(Omit Evidence Files when no commands were executed — a PRE-FLIGHT fail-fast)
```

</Output_Format>

---

## Approval Decision

1. **Issuance precondition.** A `## Scenarios Executed` section is a precondition for issuing a verdict. When it is absent, the `## Verdict` heading is omitted rather than a verdict being issued — this reads as an unfinished cycle, never as a fourth value alongside the `{APPROVE, REQUEST_CHANGES, COMMENT}` domain below. The single exception to this absence rule is the PRE-FLIGHT fail-fast, which legitimately issues **REQUEST_CHANGES** with no cycle run and therefore no `## Scenarios Executed` section. A section that is *present* with zero rows is a separate case, not an omission: when ADVERSARIAL E2E was skipped because the change is a genuinely inert refactor touching no risk surface (`### ADVERSARIAL E2E` above), the cycle is complete, its coverage-delta line states the change touched no risk surface, and a verdict **is** issued per the table below.

2. **Boundary gate.** APPROVE requires every `H`-priority scenario to have been proven at its verification surface, with any substitution declared in `driven-at`. **An `H`-priority scenario left `NOT-RUN` blocks APPROVE** — issue REQUEST_CHANGES naming the obstacle. The verdict never describes the cycle as end-to-end unless the roster's `driven-at` values say it was.

| Condition | Verdict |
|-----------|---------|
| PRE-FLIGHT contract violation | **REQUEST_CHANGES** (MUST-NOT-DO / B⊆A violated, cycle not executed) |
| EXIT via max_cycles/Safety, unresolved | **REQUEST_CHANGES** (unresolved after cycle) |
| CHECK soft-passes (a failed self-authored `M`/`L` row, finding in the 50–74 nitpick band) | **COMMENT** (never APPROVE — the failed row stays FAIL in the roster) |
| CHECK passes (BASELINE + full matrix green) | **APPROVE** (or **COMMENT** to surface LOW notes — see *On COMMENT* below) |

Every issue surfaced MUST include a confidence score. See [feedback-protocol.md] for Confidence Scoring, Validation, and Conventional Comments.

**On COMMENT.** The decision above is binary — APPROVE or REQUEST_CHANGES. COMMENT is an optional **soft-pass variant of APPROVE**: emit it in place of APPROVE when there are LOW, non-blocking notes worth surfacing to the consumer. It carries **no MEDIUM tier** — severity is CRITICAL / LOW only — and it is never a partial or "almost" verdict. Consumers read COMMENT as approve-with-notes: a per-task verifier closes the task after its evidence gate; an objective-level completion gate still requires an explicit APPROVE (the never-false-complete invariant), so a COMMENT there prompts addressing the notes and re-verifying toward APPROVE, never completion.

---

## Quick Reference

```
CYCLE:      PRE-FLIGHT → PLAN → BASELINE → ADVERSARIAL E2E → CHECK → [DIAGNOSIS → FIX → RE-VERIFY loop ≤5] → EXIT → CLEANUP → STATE
PRE-FLIGHT: MUST-NOT-DO scope + B⊆A only; violation = immediate REQUEST_CHANGES, cycle NOT executed. No EXPECTED OUTCOME → B⊆A is not-evaluable, never A:=Scope
CHECK:      a FAILED row blocks, except a self-authored M/L row scoring 50-74 = soft pass → EXIT Goal Met, soft pass → COMMENT, never APPROVE. 75+ blocks, H blocks, caller-provided blocks, unscorable-below-50 = re-run not soft-pass
ECONOMY:    verify the change's stories and scenarios by the cheapest means that proves them. Server-only → curl the API; UI → one browser/device; a test asserting the scenario is proof (--evidence-surface test); device only for screen claims, released at once. Unchanged platforms are not under test
ACTOR:      Actor Roster before scenarios — actor · boundary (verification surface) · driver · reachable. Substitute only an unreachable hop and record driven-at; otherwise NOT-RUN, never PASS. H-priority NOT-RUN blocks APPROVE
BOOTSTRAP:  set up only what the chosen surface needs — isolated local instance, documented QA accounts/seeders first, cross-platform preconditions via API/seed/DB. When the QA REQUEST verifies the deployment itself, its failure is the FAIL
EVIDENCE:   the observation at the surface (before/action/after for screens) or a cited test run; claim only what it proves; launch screens prove nothing; depths never merge
BASELINE:   build/test/lint green. See stage1-commands.md
MATRIX:     6 categories — failure paths, boundary/malformed input, injection, interruption, misleading success, idempotency. Breadth via scenario-authoring.md, depth via stage3-handson.md
USE-CASE:   Layer D — build the product-context map from the repo, then walk arrival paths · adjacent state transitions · lifecycle stances; each axis present in the map yields scenarios, and the coverage delta names all three
MAP:        PLAN first calls the QA-local feature-map CLI (`help`/`help query`/`query`); distinguish storage_not_configured + ask_user_for_storage, feature_not_found, and corrupt/unavailable storage; no default or reset; lookup first, then recheck current code/spec and omitted paths; map input is not a scope ceiling or spec authority; keep expected vs observed separate
PROVENANCE: after `add-story`, record map lookup as planning context via `record-story-provenance` before BASELINE; live-file revision + code_ref are mandatory; labels are not membership; legacy/no-map → no fabricated IDs, keep discovery/evidence and report not recorded
MAP-MAINT:  STATE/post-run only verified observations; expected vs actual remain separate; reusable regression recipe; `get` then `save --expect`, reconcile conflicts, never auto-configure; unconfigured storage → keep draft
CASES:      list/get known cases first as PLAN input; author the complete current-cycle chain including new/failed/uncovered paths; after active `chainComplete`, replay with `bun "${CLAUDE_SKILL_DIR}/scripts/qa-replay.ts" --case ... --story ... --cls ... --project ... --code-ref ... --reset-confirmed ...` before exploratory remaining paths; story goal/Given/When/Then/AC is still required; external manifest only, with unconfigured→ask once for external/project-opt-in/disabled, configured approval remembered, invalid config = error; `{artifacts}` + QA_ARTIFACTS_DIR route output; receipt `qa_result:not-recorded`, runner failure nonzero, no automatic PASS; save only after reset + independent assertion rerun; native `.ad`/agent-browser·Playwright/Maestro formats remain native; traces/recordings/JUnit are not executable proof
DRIVERS:    API→curl, Frontend→agent-browser (fallback playwright, if available), Mobile/native UI→agent-device (load its skill first; use runtime help guidance), CLI→bash. No tmux.
LOOP:       DIAGNOSIS→oracle (fresh, read-only) | FIX→sisyphus-junior (commits own scoped fix, never git commit -a) | RE-VERIFY→qa, full re-run, distrust fixer
EXIT:       Goal Met / max_cycles=5 / Safety
STATE:      bun ${CLAUDE_SKILL_DIR}/scripts/qa-state.ts <sub>; continue resumes at last phase/cycle
NESTING:    qa's fix-loop must NOT be called inside another fix-loop — doc contract, YAGNI; upgrade trigger: add a code guard when qa gains its first fix-loop-owning caller
ROSTER:     ## Scenarios Executed is a precondition for verdict issuance; absent → verdict not issued, cycle incomplete. Exception: PRE-FLIGHT fail-fast issues REQUEST_CHANGES with no roster — never synthesize an empty one there; present+0 rows means inert refactor, a completed cycle
FEEDBACK:   feedback-protocol.md for Confidence Scoring; CONFIDENCE 0-49 discard, 50-74 nitpick, 75+ blocking
REPORT:     STATE renders self-contained HTML (qa-report.ts) after set-verdict, before complete; leads with a reader-facing presentation layer (product/user perspective, not code-diff — affected users · user flows · big-picture diagram · AC→fulfillment mapping) via --narrative presentation object, anchored to recorded actors/stories/ACs; unwritten required slots render visible gap markers. presentation.md owns the contract
```

---

## Final Checklist

**Run this list explicitly right before emitting the verdict — read each line and tick its box against the actual roster.** **Any unchecked box blocks APPROVE.** It restates the blocking gates above as one scannable list; where a box and an earlier section disagree, the stricter reading wins.

- [ ] **Every ADVERSARIAL E2E scenario was proven and passed** — provided scenarios plus the 6-axis matrix, none left unrun, none still failing (the exact blocking / soft-pass rules are in CHECK and Approval Decision).
- [ ] **Each proof was the cheapest that proves it, and claims no more** — `driven-at` names the surface or the test; no device or platform was used that the change did not need.
- [ ] **Every verified scenario carries a reader-visible record** — an authored observation AND before/after screenshots for visual boundaries, with fresh supported `review-evidence` claims naming each source's visible location and observation; missing, insufficient, or stale proof remains unverified. API/text-CLI boundaries use authored observations backed by received output. Raw logs stay in the audit section.
- [ ] **The final HTML has been inspected before attestation** — consume every image/diagram inspection result, repair clipping or unreadable claims, then `review-report` and `complete`. Never batch an unobserved capture with completion.
- [ ] **Each requirement (AC) maps to a grounded verdict** — every `requirementMapping` entry has a non-empty `cellRefs` array; the renderer validates each ref against exactly one recorded current-cycle cell; `yes` requires all `pass`, `no` requires all `fail`, `partial` requires both `pass` and `fail` with no `na`, and `unverified` requires a valid `na`; missing/legacy/malformed/duplicate/stale/unknown/ineligible mappings fail closed to a visible neutral gap. Prose evidence explains a verdict but cannot establish it; an unproven requirement reads `unverified` (never `yes`/`partial`).

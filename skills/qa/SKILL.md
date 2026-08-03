---
name: qa
description: Use when verifying a code change through a standalone adversarial e2e cycle — drives the changed surface for real (curl/agent-browser/agent-device/bash) and attacks it across the 6-category matrix (failure/boundary/injection/interruption/misleading-success/idempotency), owning diagnosis→fix→re-verify to green via `oracle` (diagnosis) and `sisyphus-junior` (fix) before issuing a binary APPROVE/REQUEST_CHANGES verdict.
---

<Role>

# QA

**Core Principle**: Nothing ships without proof, and the fixer never certifies its own fix. qa drives the real application, attacks it, and — if it fails — owns the diagnose→fix→re-verify loop through independent agents until the surface is actually green.

## Overview

Pure dynamic adversarial-e2e verification skill. qa reads the change to author high-coverage scenarios and proves them by execution: static document-vs-code auditing (Security/Data-Integrity checklists, MUST-DO compliance tables, Completeness prose audits) stays `code-review`'s job; the behavior-invisible PRE-FLIGHT contract gate below is a narrow exception, not a static-audit stand-in.

qa is **standalone and stateful**. A single invocation owns the whole cycle — detection, diagnosis, fix, and re-verification — through to a final verdict, persisting its phase/cycle to a state file so an interrupted run can resume with `continue`.

**Standards:** The application actually runs, survives hostile probing across all 6 adversarial categories, and any regression introduced while fixing it is caught by a fresh full re-run, not the fixer's own say-so. Setup cost—including starting multiple local apps or seeding local databases—is never a reason to skip adversarial scenarios: run every authored scenario and retain its evidence proving correct development.

</Role>

## QA REQUEST Format

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
PRE-FLIGHT → PLAN → BASELINE → ADVERSARIAL E2E → CHECK → [DIAGNOSIS → FIX → RE-VERIFY loop, ≤5 cycles] → EXIT → CLEANUP → ROLLBACK → STATE
```

Every phase below runs once per pass, except the bracketed loop, which repeats on CHECK failure until an EXIT condition fires.

### PRE-FLIGHT

A **behavior-invisible contract check** — a narrow exception to qa's dynamic-only posture, because no amount of running the app surfaces a scope violation. Gates on exactly two things:

1. **MUST-NOT-DO scope membership.** A changed file violates the contract **iff it matches the QA REQUEST's MUST-NOT-DO scope** — no positive allowlist, no per-invocation judgment call. Tests and config files are NOT special-cased: they are violations only if the MUST-NOT-DO explicitly names them, and clean otherwise.
2. **B ⊆ A scope boundary.** Expected files (from EXPECTED OUTCOME) = A; Changed files (from QA REQUEST Scope) = B. PASS if B ⊆ A. When the QA REQUEST carries no EXPECTED OUTCOME, A does not exist: record this gate as `not-evaluable` and proceed on gate 1 alone. **Never fill A from the Scope list** — B ⊆ B is true by construction and turns the gate into a rubber stamp that reads like a PASS.

**On violation: immediate REQUEST_CHANGES, cycle NOT executed** — fail-fast. The expensive cycle below never runs against a change that already fails its own declared contract.

**PRE-FLIGHT also captures the ROLLBACK safety baseline** (used only if the loop below runs): snapshot `git status --porcelain` as `user_dirty_set` (the user's pre-existing dirty/uncommitted files) plus current `HEAD` — each entry is a porcelain status line (`XY <path>`); the file path is the portion after the status code (accounting for rename `old -> new` syntax).

### PLAN

Two ordered outputs. The roster comes first because it fixes where every scenario must be entered and what its evidence has to show — scenarios authored before it drift inward toward whatever is easiest to call.

#### PLAN.1 — Actor Roster, before any scenario

Enumerate every actor the changed surface serves and pin each one's boundary, as `actor · boundary · driver · reachable`:

- **actor** — who acts: an end user on a named path, a specific role (household owner vs payer), an operator/admin, a calling client system, an attacker.
- **boundary** — the exact thing that actor touches with its own hands: this screen in this app, this HTTP endpoint, this CLI command, this queue's trigger. **A function, a class, or an internal module is never a boundary** — nobody touches those.
- **driver** — the tool that reaches that boundary (`agent-device` / `agent-browser` / `curl` / `bash`).
- **reachable** — `yes`, or the named obstacle plus the deepest point toward the boundary that IS reachable (see *Boundary substitution*).

A change with no UI still has actors. When the changed code is internal, **trace the call graph outward** from it until you reach something a human or an external system touches — that is the boundary, not the function that changed. Emit the result as the `## Actor Roster` output section.

**The roster spans the actor's journey, not the diff (CRITICAL).** Never QA only the platform where the change landed. A changed surface is verified from every platform where an actor observes it, and every platform holding one of its preconditions — the admin web that toggles the flag, the operator tool that seeds the state — enters the roster too, as a boundary this cycle will actually launch and drive during setup.

#### PLAN.2 — Scenarios, per actor

Parse the QA REQUEST's Spec/AC into concrete verification targets: what BASELINE must run green, what ADVERSARIAL E2E must attack from each actor's boundary, and what CHECK will judge against. MUST-DO tables and Completeness sub-checks are `code-review`'s static-audit territory, not PLAN's.

See [scenario-authoring.md] for the risk/coverage-gap derivation framework.

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
2. **Self-author the 6-category adversarial matrix** for the changed surface, in this order — breadth before depth:
   1. **Derive candidate scenarios by breadth** via [scenario-authoring.md]: Layer A impact-map → coverage-gap → H/M/L priority.
   2. **Attack each derived scenario with the applicable depth rows, working highest-priority (H) first**, from the 6-category matrix: failure paths, boundary/malformed input, injection, interruption-resume + dirty state, misleading success, idempotency. See [stage3-handson.md] `## Adversarial Scenario Matrix` for the full matrix and the lifecycle/applicability detail (start → verify → stop).

**Inline modality drivers, no tmux.** qa itself drives the modality-appropriate tool inline — it is not delegated to a separate driver subagent:

| Change Type | Driver |
|-------------|--------|
| API endpoint | `curl` |
| Frontend / UI | `agent-browser` (fallback: `playwright`, if available) |
| Mobile / native UI | `agent-device` |
| CLI / TUI | interactive `bash` |

For mobile/native UI work, load the `agent-device` skill first and derive the current concrete commands from its runtime `agent-device help <topic>` guidance. Do not copy or invent concrete driving command syntax in this skill.

**Enter at the actor's boundary.** Every **self-authored** scenario is executed by entering at its actor's boundary from the Actor Roster and observing what that actor observes. Calling the changed function, class, or module directly is a unit check, not a scenario run — it proves the code in isolation and leaves every layer between the actor and that code unexercised.

A **caller-provided** scenario is exempt from relocation and stays verbatim (part 1 above) whatever layer it enters at — the caller owns that choice. It is not exempt from disclosure: record its `driven-at` as the layer it actually entered, and it supports no claim above that layer. A caller-provided command that runs at an inner layer never satisfies an actor-boundary scenario on the same surface.

**Precondition bootstrap (CRITICAL) — exhausted before any hop is called unreachable.** A missing precondition is work to do, not an obstacle to record. Bootstrap it, rung by rung:

1. **Environment not deployed / not accessible** (branch not on stage, endpoint 404, no deploy permission) → the deployed environment was never the boundary. Stand the stack up locally — backend, database, bundler — and re-point or re-build the app against that local backend. Non-deployment is an environment choice, not a boundary obstacle.
2. **No data** → read the schema and create seed data.
3. **No account / credential** → run the signup flow as its own scenario step, or mint a test token and inject it (cookie/header/session).
4. **Precondition satisfiable only on another platform** (a flag toggled in an admin web, a state set from an operator tool) → launch that platform too, satisfy the precondition there for real, then verify the feature on the platform under test. Launching the precondition platform is setup cost, and setup cost never skips a scenario.
5. **Genuinely external dependency outside your control** (third-party API off-network, physical hardware absent) → only this rung enters *Boundary substitution* below: fake that hop alone while every other layer runs real.

Declaring an obstacle without recording which rungs were attempted and why each failed is boundary evasion, not a coverage delta.

**Boundary substitution.** An unreachable boundary — one still unreachable after the bootstrap ladder above, like absent physical hardware or an off-network third-party dependency — never relocates the scenario inward while the claim stays where it was. In order:

1. Drive from the actor's boundary anyway, **replacing only the unreachable hop** with a fake or stub (fake transport, stubbed external API, seeded local data), so every layer between the actor and that hop still executes.
2. Record the scenario's `driven-at` as the deepest point actually entered plus what was substituted — e.g. `app dispense screen → hardware command (USB transport faked)`.
3. Only when even that is impossible is the scenario `NOT-RUN`, not PASS. A recorded coverage delta states what remains unproven; it is never a substitute for running it.

**Depth honesty.** A verdict claims exactly the boundary its scenarios were driven from. Evidence sets collected at different depths never merge into a deeper claim: "the internal function behaves" plus "the app launches" is not "the actor's path works".

#### Red Flags — Boundary Evasion

| Excuse | Reality |
|--------|---------|
| "It's a pure function, so calling it directly is the closest real entry point" | The closest real entry point is the boundary an actor can reach. A harness reaches nothing. |
| "The new bundle installs and the app launches, so the change is verified" | Launching proves the bundle loads. Drive the screen where the change is observable. |
| "No physical device / the API returns 502 — record it as coverage delta" | Fake the last hop and run everything above it. Delta is what remains after that, not instead of it. |
| "Component tests pass and the app boots — together that's end-to-end" | Two runs at two depths never compose into a third. |
| "Same scenario either way, only the entry point differs" | The entry point is what is under test. Every layer skipped is a layer unverified. |
| "The branch isn't deployed to stage — record the boundary as blocked" | The deployed env was never the boundary. Stand the full stack up locally and build the app against it. |
| "No test account / credentials were provided" | Signup is a scenario step. Register, or mint a test token and inject it. |
| "No seed data exists" | Read the schema and create it. |
| "The precondition can only be set on another platform" | Launch that platform too and satisfy it for real. |

Command execution is **non-blocking only**: every command either returns control on its own or is explicitly backgrounded (`run_in_background`, or trailing `&` with output redirected — a bare `cmd &` without redirection leaves the harness waiting on inherited file descriptors and hangs the agent). A bare blocking command that hangs the shell is forbidden. See [stage3-handson.md] Step 3.2 for the lifecycle this backs (start in background → wait for readiness → verify → stop, never leaving a server running).

**By-design non-idempotency note:** running ADVERSARIAL E2E actually exercises the application (starts servers, sends requests, mutates state); some operations under test are intentionally non-idempotent per spec, which is not itself a defect.

### CHECK

Is the goal met — BASELINE green and the full ADVERSARIAL E2E pass (provided scenarios + matrix)? Judge each scenario on its own row, then ask the two questions that a per-scenario PASS does not answer:

- Did each scenario traverse the changed surface from its actor's boundary all the way through, or did it stop at an inner layer? Read `driven-at`, not the PASS.
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

delegate to `sisyphus-junior`. **sisyphus-junior commits its own scoped fix** — it authored the hunks, so it alone can stage them precisely; qa cannot separate a fix's hunks from a user's hunks in a shared file. Never `git commit -a`. qa records `fix_head_before` = HEAD at FIX dispatch, before this commit is made.

**Overlap refusal:** if the FIX phase determines the fix must touch a file already in `user_dirty_set` (captured at PRE-FLIGHT) — overlap is matched on the path parsed from each porcelain entry, i.e. stripping the leading `XY ` status code — qa **REFUSE the cycle** at FIX with an explicit error ("file X has your uncommitted changes — commit or stash before qa can safely fix it") rather than let the fix's commit sweep the user's uncommitted hunks. This is a structural refusal, not a detect-after-the-fact check.

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
| **Same-Failure-3x** | The same failure repeats 3 times | Terminate, report thrash |
| **Safety** | A safety invariant (e.g. ROLLBACK guard) refuses to proceed | Terminate, report the refusal reason |

- **Same-Failure key** = `scenario-id + root-cause-file + root-cause-symbol/category` (not `:line` — line numbers shift under fixes and would falsely reset the counter). Two failures are "the same" iff this key matches; the count resets to 1 when a different key appears.
- **max-N boundary**: with `cycle` starting at 0 and `cycle++ at FIX dispatch`, `max_cycles=5` permits exactly 5 fix attempts (cycles 1..5); the 5th fix is attempted and re-verified, then EXIT fires if still unresolved.

### CLEANUP

Kill every process and remove every artifact this cycle spawned (background servers, simulators/emulators started for ADVERSARIAL E2E, temp files) — regardless of whether the cycle ended in PASS or an EXIT condition. A leaked process corrupts the next run.

### ROLLBACK

On a regression caught by RE-VERIFY, qa reverts **only its own cycle's commit(s)** — never touching the user's pre-existing work:

- **Mechanism:** `git revert fix_head_before..HEAD` (non-destructive). **NEVER `git reset --hard`** — it would destroy all working-tree dirty state, including the disjoint `user_dirty_set` files, with no way to recover content that was never committed.
- **Three guards, evaluated independently** (no guard is skipped because an earlier one passed):
  1. **Linear-descendant guard** — assert `HEAD` is a linear descendant of `fix_head_before` (`git merge-base --is-ancestor fix_head_before HEAD`). If not (history was amended/rebased), **refuse the revert** rather than risk reverting into pre-existing content.
  2. **Non-empty-range guard** — if `fix_head_before == HEAD` (no commit was actually made), this is **ERROR, not silent success**: report ROLLBACK failure, do not exit-0 with the regression silently retained.
  3. **Post-revert disjointness assertion** — after `git revert`, re-run `git status --porcelain`, filter to the paths recorded in `user_dirty_set`, and compare those lines byte-for-byte against the stored PRE-FLIGHT porcelain lines; the result must be byte-identical. Any drift is contamination and a hard failure.
- `rm -rf`/force-flag operations remain auto-denied throughout — ROLLBACK never bypasses that gate.

### STATE

Persist `phase`/`cycle` (plus `max_cycles`, `same_failure_key`/`same_failure_count`, `fix_head_before`, `user_dirty_set`) to a state file after every phase transition, via:

```
bun ${CLAUDE_SKILL_DIR}/scripts/qa-state.ts <sub>
```

A `continue` invocation reads this state and resumes at the last recorded phase/cycle rather than restarting the cycle from PRE-FLIGHT. (The CLI itself is authored elsewhere — this section only pins the invocation contract qa's cycle relies on.)

Once the cycle concludes (any EXIT outcome — Goal Met, max_cycles, Same-Failure-3x, or Safety), run `bun ${CLAUDE_SKILL_DIR}/scripts/qa-state.ts complete` before reporting the verdict. This marks the state inactive so the finished cycle is not resurrected as "in progress" in a later session.

---

## Fix-Loop Nesting Contract

qa's fix-loop (DIAGNOSIS → FIX → RE-VERIFY) **must NOT be called inside another fix-loop** (e.g. `ultragoal`'s own pursuit loop) — running one fix-loop inside another double-loops retries and confuses which loop owns EXIT. This is a documented contract, not an enforced one: **YAGNI** — no detection-guard code is written for a caller that does not exist yet. Named upgrade trigger: **add a code guard when qa gains its first fix-loop-owning caller.**

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

An evidence set proves what its actor could observe at its boundary. Every executed scenario gets its own set, named for that scenario id from the roster so the two map 1:1, holding three slots in this order:

| Slot | What it holds |
|------|---------------|
| `before` | The actor-observable state the scenario starts from — the screen the actor is on, the value the endpoint currently returns, the record as it stands. |
| `action` | The action as the actor issues it at its boundary — the tap/click sequence, the exact request, the command typed — with the immediate response. |
| `after` | The outcome the actor observes — the resulting screen, the response body, the delivered payload or written record — asserted against the scenario's `expected`. |

At a UI boundary, `before` and `after` are captures of the asserted state: the screen where the change is visible. **A screenshot of a launch, splash, or landing screen is not scenario evidence** — it proves the app started.

Internal signals (server logs, DB rows, emitted command payloads, instrumentation) are supporting evidence attached beside these three, never a replacement for them. Build/test/lint logs are BASELINE evidence and prove nothing about any actor's path.

### Evidence File Content Requirements

Evidence files must contain meaningful content that demonstrates the verification result. Empty (0-byte) files are not valid evidence. When a command produces empty stdout, record the command executed and its exit code so the file is not empty.

### Evidence Path Priority (3-Tier)

1. **Explicit path from QA REQUEST** — caller explicitly provided a path
2. **Plan QA Scenario Evidence field** — see [plan-template.md QA Scenarios](../prometheus/plan-template.md#qa-scenarios-mandatory-per-todo)
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

<Output_Format>

## Output Format

```markdown
## Cycle Summary

| Phase | Status | Details |
|-------|--------|---------|
| PRE-FLIGHT | PASS / REQUEST_CHANGES | [MUST-NOT-DO / B⊆A result] |
| BASELINE | PASS / FAIL | [build/test/lint summary] |
| ADVERSARIAL E2E | PASS / FAIL | [matrix + scenario summary] |
| Cycles run | N / max_cycles | [Same-Failure key if terminated early] |

## Actor Roster

| actor | boundary | driver | reachable |
|---|---|---|---|

One row per actor the changed surface serves, from PLAN.1. `boundary` names an interface an actor touches — never a function, class, or module. `reachable` is `yes` or the obstacle plus the deepest reachable point toward that boundary. On a PRE-FLIGHT fail-fast the cycle never reaches PLAN, so this section is absent rather than empty — same as the scenario roster below.

## Scenarios Executed

| # | source | actor | driven-at | preconditions | steps | expected | result | evidence | why-needed | priority |
|---|---|---|---|---|---|---|---|---|---|---|

Every row's `source` is either `self-authored` or `caller-provided`. A `self-authored` row carries the six-field shape from [scenario-authoring.md] — actor · preconditions · steps · expected · why-needed · priority — filled in full; a `caller-provided` row carries whatever shape the caller supplied. `driven-at` names the boundary actually entered plus any substitution; `result` is PASS / FAIL / `NOT-RUN`; `evidence` is the path to that scenario's evidence set. This table is the canonical scenario record for the cycle: `result` maps to `Status` and `why-needed` maps to `Why-Needed` in the four-column working table [stage3-handson.md] mandates for hands-on execution — the column-count divergence is declared here, not fixed there.

Close the table with exactly one coverage-delta line naming the impact-map domains from [scenario-authoring.md], which of those domains the rows above cover, and which are left uncovered.

## Verdict: [APPROVE / REQUEST_CHANGES / COMMENT]

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

2. **Boundary gate.** APPROVE requires every `H`-priority scenario to have been executed at its actor's boundary, with any substitution declared in `driven-at`. **An `H`-priority scenario left `NOT-RUN` blocks APPROVE** — issue REQUEST_CHANGES naming the obstacle. The verdict never describes the cycle as end-to-end unless the roster's `driven-at` values say it was.

| Condition | Verdict |
|-----------|---------|
| PRE-FLIGHT contract violation | **REQUEST_CHANGES** (MUST-NOT-DO / B⊆A violated, cycle not executed) |
| EXIT via max_cycles/Same-Failure-3x/Safety, unresolved | **REQUEST_CHANGES** (unresolved after cycle) |
| CHECK soft-passes (a failed self-authored `M`/`L` row, finding in the 50–74 nitpick band) | **COMMENT** (never APPROVE — the failed row stays FAIL in the roster) |
| CHECK passes (BASELINE + full matrix green) | **APPROVE** (or **COMMENT** to surface LOW notes — see *On COMMENT* below) |

Every issue surfaced MUST include a confidence score. See [feedback-protocol.md] for Confidence Scoring, Validation, and Conventional Comments.

**On COMMENT.** The decision above is binary — APPROVE or REQUEST_CHANGES. COMMENT is an optional **soft-pass variant of APPROVE**: emit it in place of APPROVE when there are LOW, non-blocking notes worth surfacing to the consumer. It carries **no MEDIUM tier** — severity is CRITICAL / LOW only — and it is never a partial or "almost" verdict. Consumers read COMMENT as approve-with-notes: a per-task verifier closes the task after its evidence gate; an objective-level completion gate still requires an explicit APPROVE (the never-false-complete invariant), so a COMMENT there prompts addressing the notes and re-verifying toward APPROVE, never completion.

---

## Quick Reference

```
CYCLE:      PRE-FLIGHT → PLAN → BASELINE → ADVERSARIAL E2E → CHECK → [DIAGNOSIS → FIX → RE-VERIFY loop ≤5] → EXIT → CLEANUP → ROLLBACK → STATE
PRE-FLIGHT: MUST-NOT-DO scope + B⊆A only; violation = immediate REQUEST_CHANGES, cycle NOT executed. No EXPECTED OUTCOME → B⊆A is not-evaluable, never A:=Scope
CHECK:      a FAILED row blocks, except a self-authored M/L row scoring 50-74 = soft pass → EXIT Goal Met, soft pass → COMMENT, never APPROVE. 75+ blocks, H blocks, caller-provided blocks, unscorable-below-50 = re-run not soft-pass
ACTOR:      Actor Roster before scenarios — actor · boundary · driver · reachable; a function/class/module is never a boundary; internal change → trace the call graph outward; roster spans the actor's journey, not the diff — precondition platforms enter it too. Enter every scenario at its actor's boundary; substitute only the unreachable hop and record driven-at; otherwise NOT-RUN, never PASS. H-priority NOT-RUN blocks APPROVE
BOOTSTRAP:  a missing precondition is work, not an obstacle — undeployed env → stand the stack up locally; no data → seed it; no account → signup or inject a test token; precondition on another platform → launch that platform too; only a genuinely external hop enters substitution. Never QA only the diff's platform
EVIDENCE:   per-scenario before/action/after at the actor's boundary; launch/splash/landing captures are not scenario evidence; internal logs support, never replace; depths never merge into a deeper claim
BASELINE:   build/test/lint green. See stage1-commands.md
MATRIX:     6 categories — failure paths, boundary/malformed input, injection, interruption, misleading success, idempotency. Breadth via scenario-authoring.md, depth via stage3-handson.md
DRIVERS:    API→curl, Frontend→agent-browser (fallback playwright, if available), Mobile/native UI→agent-device (load its skill first; use runtime help guidance), CLI→bash. No tmux.
LOOP:       DIAGNOSIS→oracle (fresh, read-only) | FIX→sisyphus-junior (commits own scoped fix, never git commit -a) | RE-VERIFY→qa, full re-run, distrust fixer
EXIT:       Goal Met / max_cycles=5 / Same-Failure-3x (scenario-id+root-cause-file+root-cause-symbol) / Safety
ROLLBACK:   git revert fix_head_before..HEAD only, NEVER git reset --hard; 3 guards: linear-descendant, non-empty-range=ERROR, post-revert disjointness on user_dirty_set; REFUSE the cycle on user_dirty_set overlap; rm -rf/force auto-deny honored
STATE:      bun ${CLAUDE_SKILL_DIR}/scripts/qa-state.ts <sub>; continue resumes at last phase/cycle
NESTING:    qa's fix-loop must NOT be called inside another fix-loop (e.g. ultragoal) — doc contract, YAGNI; upgrade trigger: add a code guard when qa gains its first fix-loop-owning caller
ROSTER:     ## Scenarios Executed is a precondition for verdict issuance; absent → verdict not issued, cycle incomplete. Exception: PRE-FLIGHT fail-fast issues REQUEST_CHANGES with no roster — never synthesize an empty one there; present+0 rows means inert refactor, a completed cycle
FEEDBACK:   feedback-protocol.md for Confidence Scoring; CONFIDENCE 0-49 discard, 50-74 nitpick, 75+ blocking
```

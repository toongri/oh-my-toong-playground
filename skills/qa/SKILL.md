---
name: qa
description: Use when verifying a code change through a standalone adversarial e2e cycle — drives the changed surface for real (curl/agent-browser/maestro/bash) and attacks it across the 6-category matrix (failure/boundary/injection/interruption/misleading-success/idempotency), owning diagnosis→fix→re-verify to green via `oracle` (diagnosis) and `sisyphus-junior` (fix) before issuing a binary APPROVE/REQUEST_CHANGES verdict.
---

<Role>

# QA

**Core Principle**: Nothing ships without proof, and the fixer never certifies its own fix. qa drives the real application, attacks it, and — if it fails — owns the diagnose→fix→re-verify loop through independent agents until the surface is actually green.

## Overview

Pure dynamic adversarial-e2e verification skill. qa's job is to run the change, not to read about it: static document-vs-code auditing (Security/Data-Integrity checklists, MUST-DO compliance tables, Completeness prose audits) belongs to `code-review`; qa's only static responsibility is the behavior-invisible PRE-FLIGHT contract gate below.

qa is **standalone and stateful**. A single invocation owns the whole cycle — detection, diagnosis, fix, and re-verification — through to a final verdict, persisting its phase/cycle to a state file so an interrupted run can resume with `continue`.

**Standards:** The application actually runs, survives hostile probing across all 6 adversarial categories, and any regression introduced while fixing it is caught by a fresh full re-run, not the fixer's own say-so.

</Role>

## QA REQUEST Format

The caller composes a QA REQUEST using this structure:

```
# QA REQUEST

## Spec
[WHAT to verify — requirements, criteria, constraints, MUST-NOT-DO scope]

## Required Verification
[HOW to verify — verification commands, QA scenarios, evidence paths to collect. Optional but standard for sisyphus-orchestrated QA requests; see `skills/sisyphus/verification.md` §QA REQUEST Composition for the canonical recipe.]

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

A **behavior-invisible contract check** — the one static responsibility qa keeps, because no amount of running the app surfaces a scope violation. Gates on exactly two things:

1. **MUST-NOT-DO scope membership.** A changed file violates the contract **iff it matches the QA REQUEST's MUST-NOT-DO scope** — no positive allowlist, no per-invocation judgment call. Tests and config files are NOT special-cased: they are violations only if the MUST-NOT-DO explicitly names them, and clean otherwise.
2. **B ⊆ A scope boundary.** Expected files (from EXPECTED OUTCOME) = A; Changed files (from QA REQUEST Scope) = B. PASS if B ⊆ A.

**On violation: immediate REQUEST_CHANGES, cycle NOT executed** — fail-fast. The expensive cycle below never runs against a change that already fails its own declared contract.

**PRE-FLIGHT also captures the ROLLBACK safety baseline** (used only if the loop below runs): snapshot `git status --porcelain` as `user_dirty_set` (the user's pre-existing dirty/uncommitted files) plus current `HEAD` — each entry is a porcelain status line (`XY <path>`); the file path is the portion after the status code (accounting for rename `old -> new` syntax).

### PLAN

Parse the QA REQUEST's Spec/AC into concrete verification targets and adversarial scenarios: what BASELINE must run green, what ADVERSARIAL E2E must attack, and what CHECK will judge against. Spec/AC understanding is retained here in full — only the static prose-audit machinery (MUST-DO tables, Completeness sub-checks) that used to sit downstream of it is gone.

### BASELINE

Build/test/lint green baseline.

1. Discover project commands: check `~/.omt/{project}/project-commands.md` cache first, then `CLAUDE.md`/`README.md`/build files, then ask the user. Save discovered commands back to the cache.
2. Run: Build (fast build/typecheck) → Tests → Lint. Slow native build (e.g. an RN bundle) runs only when native code changed or this is a release build (native-code-or-release) — otherwise skip it.
3. Save the full output of each check as an evidence file (see Evidence Saving Protocol below).
4. ANY failure = immediate REQUEST_CHANGES.

**See** [stage1-commands.md] for command-discovery detail, special cases (no tests for changed code, no build system), and output format — the content there is BASELINE's detail target, not a separate stage.

### ADVERSARIAL E2E

Drive the changed surface for real and attack it. Two parts, both required when the change is user-facing:

1. **Execute caller-provided scenarios verbatim**, with per-scenario evidence. ANY provided-scenario failure = immediate REQUEST_CHANGES.
2. **Self-author and run the 6-category adversarial matrix** for the changed surface: failure paths, boundary/malformed input, injection, interruption-resume + dirty state, misleading success, idempotency. See [stage3-handson.md] `## Adversarial Scenario Matrix` for the full matrix and the lifecycle/applicability detail (start → verify → stop).

**Inline modality drivers, no tmux.** qa itself drives the modality-appropriate tool inline — it is not delegated to a separate driver subagent:

| Change Type | Driver |
|-------------|--------|
| API endpoint | `curl` |
| Frontend / UI | `agent-browser` (fallback: `playwright`) |
| Mobile / App | `maestro` |
| CLI / TUI | interactive `bash` |

Command execution is **non-blocking only**: every command either returns control on its own or is explicitly backgrounded (`run_in_background`, or trailing `&` with output redirected). A bare blocking command that hangs the shell is forbidden. See [stage3-handson.md] Step 3.2 for the lifecycle this backs (start in background → wait for readiness → verify → stop, never leaving a server running).

**By-design non-idempotency note:** running ADVERSARIAL E2E actually exercises the application (starts servers, sends requests, mutates state); some operations under test are intentionally non-idempotent per spec, which is not itself a defect.

### CHECK

Is the goal met — BASELINE green and the full ADVERSARIAL E2E pass (provided scenarios + matrix)?

- **Pass → PASS.** Emit APPROVE (see Output Format).
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

---

## Fix-Loop Nesting Contract

qa's fix-loop (DIAGNOSIS → FIX → RE-VERIFY) **must NOT be called inside another fix-loop** (e.g. `goal`'s own pursuit loop) — running one fix-loop inside another double-loops retries and confuses which loop owns EXIT. This is a documented contract, not an enforced one: **YAGNI** — no detection-guard code is written for a caller that does not exist yet. Named upgrade trigger: **add a code guard when qa gains its first fix-loop-owning caller.**

---

## Evidence Saving Protocol

### Core Rule

Every verification **command execution** (BASELINE, ADVERSARIAL E2E, RE-VERIFY) produces an evidence file. Evidence files are the audit trail; downstream gates check for their existence before accepting a verdict.

### Objective vs. Subjective

| Output Type | Disposition | Examples |
|-------------|-------------|---------|
| Objective command output | Save to file | build/test/lint logs, curl response body + status, agent-browser/Playwright/Maestro screenshots and reports, CLI execution logs |
| Subjective judgment | Response only (no file) | PLAN's spec/AC reading, oracle's diagnosis narrative |

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

## Command Execution Policy: Non-Blocking Only

qa is non-interactive and headless. Every command it runs MUST return control to the shell when finished or be explicitly backgrounded. Foreground processes that occupy the agent shell indefinitely are **forbidden**.

| Pattern | Status | Example |
|---------|--------|---------|
| Command exits on completion | Allowed | `bun test`, `curl http://localhost:8080/health` |
| Command backgrounded via tool | Allowed | `run_in_background` with `emulator -avd Pixel_9` |
| Command backgrounded in shell with output redirection | Allowed | `emulator -avd Pixel_9 >/tmp/emulator.log 2>&1 &` |
| Bare blocking command | **FORBIDDEN** | `emulator -avd Pixel_9` (hangs the shell indefinitely) |

**Rule**: if a command does not terminate on its own, it MUST be launched with `run_in_background`, OR with a trailing `&` AND output redirected to a file or `/dev/null`. A bare `cmd &` without redirection inherits stdout/stderr from the agent shell — the harness then waits on the inherited file descriptors until the backgrounded process exits, hanging the agent.

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

| Condition | Verdict |
|-----------|---------|
| PRE-FLIGHT contract violation | **REQUEST_CHANGES** (MUST-NOT-DO / B⊆A violated, cycle not executed) |
| EXIT via max_cycles/Same-Failure-3x/Safety, unresolved | **REQUEST_CHANGES** (unresolved after cycle) |
| CHECK passes (BASELINE + full matrix green) | **APPROVE** (or **COMMENT** to surface LOW notes — see *On COMMENT* below) |

Every issue surfaced MUST include a confidence score. See [feedback-protocol.md] for Confidence Scoring, Validation, and Conventional Comments.

**On COMMENT.** The decision above is binary — APPROVE or REQUEST_CHANGES. COMMENT is an optional **soft-pass variant of APPROVE**: emit it in place of APPROVE when there are LOW, non-blocking notes worth surfacing to the consumer. It carries **no MEDIUM tier** — severity is CRITICAL / LOW only — and it is never a partial or "almost" verdict. Consumers read COMMENT as approve-with-notes: a per-task verifier closes the task after its evidence gate; an objective-level completion gate still requires an explicit APPROVE (the never-false-complete invariant), so a COMMENT there prompts addressing the notes and re-verifying toward APPROVE, never completion.

---

## Quick Reference

```
CYCLE:      PRE-FLIGHT → PLAN → BASELINE → ADVERSARIAL E2E → CHECK → [DIAGNOSIS → FIX → RE-VERIFY loop ≤5] → EXIT → CLEANUP → ROLLBACK → STATE
PRE-FLIGHT: MUST-NOT-DO scope + B⊆A only; violation = immediate REQUEST_CHANGES, cycle NOT executed
BASELINE:   build/test/lint green. See stage1-commands.md
MATRIX:     6 categories — failure paths, boundary/malformed input, injection, interruption, misleading success, idempotency. See stage3-handson.md
DRIVERS:    API→curl, Frontend→agent-browser (fallback playwright), Mobile→maestro, CLI→bash. No tmux.
LOOP:       DIAGNOSIS→oracle (fresh, read-only) | FIX→sisyphus-junior (commits own scoped fix, never git commit -a) | RE-VERIFY→qa, full re-run, distrust fixer
EXIT:       Goal Met / max_cycles=5 / Same-Failure-3x (scenario-id+root-cause-file+root-cause-symbol) / Safety
ROLLBACK:   git revert fix_head_before..HEAD only, NEVER git reset --hard; 3 guards: linear-descendant, non-empty-range=ERROR, post-revert disjointness on user_dirty_set; REFUSE the cycle on user_dirty_set overlap; rm -rf/force auto-deny honored
STATE:      bun ${CLAUDE_SKILL_DIR}/scripts/qa-state.ts <sub>; continue resumes at last phase/cycle
NESTING:    qa's fix-loop must NOT be called inside another fix-loop (e.g. goal) — doc contract, YAGNI; upgrade trigger: add a code guard when qa gains its first fix-loop-owning caller
FEEDBACK:   feedback-protocol.md for Confidence Scoring; CONFIDENCE 0-49 discard, 50-79 nitpick, 80+ report
```

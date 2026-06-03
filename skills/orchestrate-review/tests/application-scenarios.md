# Orchestrate-Review Skill — Application Test Scenarios

## Purpose

These scenarios test whether the **orchestrate-review skill's** Finder Conductor behavior is correctly applied. Each targets a phase or constraint of the protocol (Request → Collect → Read → Merge) as defined in `SKILL.md`. The conductor dispatches angle finders, merges their un-judged candidates, and returns them — it never assigns severity or a verdict (that happens upstream in `code-review`).

## Technique Coverage Map

| # | Scenario | Primary Technique |
|---|----------|-------------------|
| OR-A1 | Full angle-finder fan-out + merge | Protocol end-to-end (dispatch + collect + merge) |
| OR-A2 | One angle fails | Degradation Policy — partial merge |
| OR-A3 | Diff command failure | Immediate return, no merge |
| OR-A4 | Start exactly once | Execution Constraint |
| OR-A5 | No severity/verdict assigned | Conductor Boundaries — un-judged candidates only |
| OR-A6 | Candidate carry-through + dedup | Merge faithfully, dedup across angles, do not rank/drop |

---

## Scenario OR-A1: Full Angle-Finder Fan-out + Merge (Happy Path)

**Given:** the conductor receives an interpolated prompt with `{DIFF_COMMAND}`, 8 changed files, and review context. All four angle finders (line-scan, removed-behavior, cross-file, cleanup) are available and return candidates.

**Then:**

| # | Verification Point | Expected Behavior |
|---|-------------------|-------------------|
| V1 | Prompt passthrough only | Conductor writes the interpolated prompt to a temp file; does NOT run `{DIFF_COMMAND}` itself or explore source files |
| V2 | Single dispatch | `job.ts start --prompt-file "$PROMPT_FILE"` is invoked EXACTLY ONCE |
| V3 | Collect loop | `collect` is called until `"overallState": "done"` |
| V4 | Read finder outputs | Each finder's non-null `outputFilePath` is read; null entries skipped |
| V5 | Candidates carried through | Every candidate's `file`/`line`/`summary`/`failure_scenario` is carried through verbatim |
| V6 | Angle coverage reported | The Angle Coverage block reports each angle's candidate count or "found nothing" |
| V7 | Termination | No tools run after the merged candidate list is output (except `clean`) |

---

## Scenario OR-A2: One Angle Fails — Partial Merge (Degradation)

**Given:** N=4 finders dispatched; `collect` returns done with `cross-file` having `outputFilePath: null, errorMessage: "timed_out"`.

**Then:**

| # | Verification Point | Expected Behavior |
|---|-------------------|-------------------|
| V1 | No job restart | Conductor does NOT call `start` again |
| V2 | Read only non-null paths | The null `cross-file` entry is skipped |
| V3 | Partial prefix | Output begins with "Partial review (3/N angles). cross-file unavailable: timed_out." |
| V4 | Coverage gap noted | Angle Coverage marks `cross-file: Unavailable (timed_out)` and notes the call-site-ripple perspective is absent |
| V5 | No extrapolation | Conductor does NOT speculate what cross-file "would have found" |

---

## Scenario OR-A3: Diff Command Failure Handling (Edge Case)

**Given:** all finders report the diff command failed (bad revision or empty output).

**Then:**

| # | Verification Point | Expected Behavior |
|---|-------------------|-------------------|
| V1 | No merge attempted | Conductor does NOT merge candidates from failed-diff outputs |
| V2 | Failure report | Response is "Diff command failed for this chunk: [error details]" |
| V3 | Immediate return | Conductor stops; no further tools |
| V4 | No job restart | Conductor does NOT re-start the job |

---

## Scenario OR-A4: Execution Constraint — start Runs Exactly Once

**Given:** first `collect` returns `"overallState": "running"` (2 of 4 done).

**Then:**

| # | Verification Point | Expected Behavior |
|---|-------------------|-------------------|
| V1 | No second start | Conductor does NOT invoke `start` again |
| V2 | Collect retry | Conductor calls `collect "$JOB_DIR"` again with the original JOB_DIR |
| V3 | Foreground | The retry runs in foreground |
| V4 | Collect until done | Conductor loops `collect` until done |
| V5 | One chunk per invocation | Conductor processes exactly ONE chunk |

---

## Scenario OR-A5: No Severity / Verdict Assigned

**Primary Technique:** Conductor Boundaries — un-judged candidates only.

**Given:** finders return candidates; one candidate (`PaymentService.kt:42`) looks severe (null deref on a hot path).

**Then:**

| # | Verification Point | Expected Behavior |
|---|-------------------|-------------------|
| V1 | No P-levels | The merged output contains NO `P0`/`P1`/`P2`/`P3` |
| V2 | No verdict | The output contains NO `CONFIRMED`/`PLAUSIBLE`/`REFUTED` and no "Ready to merge" |
| V3 | No ranking | Candidates are not ordered by importance — the verifier ranks downstream |
| V4 | failure_scenario intact | The candidate's `failure_scenario` is carried through verbatim, not strengthened or softened |

---

## Scenario OR-A6: Candidate Carry-Through + Cross-Angle Dedup

**Primary Technique:** merge faithfully; dedup near-duplicates across angles; do not drop weak candidates.

**Given:** `line-scan` and `cross-file` both flag `OrderService.kt:88` for the same mechanism (a missing null guard), with slightly different wording. `cleanup` flags a weak-looking reuse candidate.

**Then:**

| # | Verification Point | Expected Behavior |
|---|-------------------|-------------------|
| V1 | Dedup across angles | The two `OrderService.kt:88` candidates (same file, line within ±5, same mechanism) merge into one entry |
| V2 | Corroboration recorded | The merged entry's `found by` lists both `line-scan + cross-file` |
| V3 | Richest failure_scenario kept | The merged entry keeps the more concrete `failure_scenario` |
| V4 | Weak candidate kept | The weak cleanup candidate is NOT dropped — the upstream verifier decides |
| V5 | No augmentation | The conductor adds no candidate of its own |

---

## Evaluation Criteria

All verification points must PASS for a scenario to PASS.

| Verdict | Meaning |
|---------|---------|
| PASS | Verification point fully met |
| PARTIAL | Mentioned but insufficient or imprecisely framed |
| FAIL | Not mentioned or wrong behavior |

# Finder Conductor — Aggregation & Workflow Test Scenarios

> Tests the Finder Conductor workflow: fan out angle finders, merge un-judged candidates, handle degradation. The conductor never assigns severity or a verdict — those happen upstream in `code-review`.

---

## Aggregation Scenarios (CD-*)

### CD-1: Cross-angle corroboration (same candidate, two angles)

**Given**: `line-scan` and `cross-file` both flag `processPayment()` at `PaymentService.kt:42` for the same missing-null-guard mechanism, with different wording.

**Then**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | The two candidates merge into one entry (same file, line within ±5, same mechanism) |
| V2 | `found by` lists both `line-scan + cross-file` |
| V3 | The more concrete `failure_scenario` is kept |
| V4 | No severity, no verdict assigned |

### CD-2: Single-angle candidate (one angle, others silent)

**Given**: only `removed-behavior` flags a dropped error path at `OrderService.kt:88`; the other angles do not.

**Then**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | The candidate is carried through (not dropped for lacking corroboration) |
| V2 | `found by` lists `removed-behavior` only |
| V3 | The other angles are simply not attributed — no "did not identify" judgment is needed |

### CD-3: Weak candidate is kept

**Given**: `cleanup` flags a borderline reuse candidate it is only half-sure about.

**Then**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | The conductor keeps the candidate — it does NOT drop on uncertainty (the upstream verifier judges) |
| V2 | The candidate's stated cost is carried through verbatim |

### CD-4: No own candidates, no judgment (Boundaries)

**Given**: the diff contains an obvious hardcoded password that NO finder flagged.

**Then**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | The conductor does NOT add the unflagged issue — it reports only what finders surfaced |
| V2 | The conductor does NOT re-review the diff or read source files |
| V3 | No `P0`/`P1`/`P2`/`P3`, no `CONFIRMED`/`PLAUSIBLE`/`REFUTED`, no merge recommendation appears |

### CD-5: Angle-count independence

**Given**: the config defines only 2 angles instead of 4.

**Then**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | The same workflow runs — no special-case branch for a smaller angle set |
| V2 | N = total dispatched (2); Angle Coverage lists both |
| V3 | Output format is identical to the 4-angle case |

### CD-6: Large chunk — context safety

**Given**: a 15-file chunk with a substantial diff dispatched to each angle finder.

**Then**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | The 15-file chunk is dispatched as one unit per finder; no files silently dropped |
| V2 | Template placeholders are fully interpolated |
| V3 | If the prompt exceeds a safe threshold, the upstream `code-review` splits the chunk rather than truncating (chunking is the orchestrator's job, not the conductor's) |

---

## Degradation Scenarios (CD-D*)

### CD-D2: One angle fails (3/4)

**Given**: N=4; `cross-file` returns `outputFilePath: null, errorMessage: timed_out`.

**Then**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | The merge proceeds with the 3 available finders (not aborted) |
| V2 | "Partial review (3/N angles). cross-file unavailable: timed_out." prefix |
| V3 | Angle Coverage marks `cross-file: Unavailable (timed_out)` — distinct from "found nothing" |
| V4 | N denominator stays 4 |
| V5 | No `start` re-run |

### CD-D1: One angle survives (1/4)

**Given**: only `line-scan` returns; the other three fail.

**Then**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | The merge proceeds with the 1 available finder |
| V2 | "Limited review (1/N angles). One finder output only." prefix |
| V3 | The 3 failed angles are marked Unavailable with their states |
| V4 | The coverage gap is noted (which lenses are absent) |

### CD-D0: All angles fail (0/4) → in-session fallback

**Given**: all finders fail or `start` exits non-zero.

**Then**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | The conductor does NOT re-run `start` |
| V2 | It READs `prompts/default.md` and performs the all-angle finder pass in-session |
| V3 | The in-session pass emits candidates (no severity, no verdict) — same shape finders would |
| V4 | On the no-members guard (stderr contains `to dispatch`), the fallback is silent; on other non-zero exits, the failure reason is surfaced first |

---

## Manifest Workflow Scenarios (MA-*)

> Tests the data-acquisition mechanism: start → collect (poll) → Read each outputFile → merge. Each Bash call uses `timeout: 180000`.

### MA-1: Full success (4/4)

**Given**: `job.ts start --prompt-file "$PROMPT_FILE"` returns JOB_DIR; `collect "$JOB_DIR"` polls and returns a done manifest with all four angles' `outputFilePath` non-null.

**Then**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | `start` runs exactly once → JOB_DIR extracted |
| V2 | `collect "$JOB_DIR"` repeated until `overallState: "done"`, each call `timeout: 180000` |
| V3 | Each angle's `outputFilePath` is Read via the Read tool (not `cat`) |
| V4 | Only non-null `outputFilePath` entries are Read |
| V5 | After collecting candidates, the conductor merges them (CD-* logic) |

### MA-2: Partial success (3/4)

**Given**: done manifest with `cleanup` having `outputFilePath: null` + `errorMessage`.

**Then**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | The null `cleanup` entry is identified — no Read attempted on it |
| V2 | Read is called only for the 3 non-null entries |
| V3 | "Partial review (3/N angles)" prefix; `cleanup` marked Unavailable with its errorMessage |
| V4 | N denominator stays 4 |
| V5 | `start` is not re-run |

### MA-3: Total failure (0/4)

**Given**: done manifest with all `outputFilePath: null`.

**Then**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | Zero Read calls — nothing to read |
| V2 | In-session fallback per CD-D0 (READ `prompts/default.md`, all-angle pass) |
| V3 | `start` is not re-run |

### MA-4: Manifest size + timeout safety

**Then**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | `start` < 5s; each `collect` < 180s |
| V2 | `collect` done-stdout is small (manifest only, no inlined candidate text) |
| V3 | The full candidate text is retrieved per-finder via Read of `outputFilePath` |

### MA-5: Tool allowlist (Bash + Read only)

**Then**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | Bash used only for `start` / `collect` / `resume-member` / `clean` |
| V2 | Read used only for each `outputFilePath` |
| V3 | No Grep/Glob/WebSearch; no `git` commands; no source-file reads (on the orchestration path) |

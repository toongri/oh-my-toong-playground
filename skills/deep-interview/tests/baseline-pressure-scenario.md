# Baseline Pressure Scenarios — Deep Interview Behavioral Compliance Test

**Purpose:** RED-phase characterization test for deep-interview's behavioral ACs (always-propose-alternatives, daedalus selectivity, scope-decomposition gate) and spec-reviewer's design-coverage substantiveness check. Run BEFORE each change to `skills/deep-interview/SKILL.md` or `agents/spec-reviewer.md` to confirm the gap exists (RED), then run AFTER to confirm the change closes it (GREEN). A passing GREEN run on a changed skill with the same rubric is the evidence that the implementation is correct.

**Origin:** 2026-06-30 plan authoring — four behavioral gaps identified against brainstorming's reference behaviors (brainstorming SKILL.md, section headings "Key Principles", "Presenting the design", "The Process") and the deep-interview spec-SSOT reshape AC set (A2/B1/B2/D1).

---

## How to Run

1. Spawn a **fresh subagent** for each scenario with the skill loaded from source:
   - Scenarios A2: spawn with spec-reviewer agent definition (`agents/spec-reviewer.md`)
   - Scenarios B1, B2, D1: spawn with deep-interview skill (`skills/deep-interview/SKILL.md`)
   - **Fresh** means: no prior conversation context, no session state, no loaded advanced.md, examples, or plan context. The agent starts from the skill/agent definition file only.

2. Hand it the **fixture** verbatim from `skills/deep-interview/tests/application-scenarios.md`, the scenario's fixture section. For A2, save the fixture to a file and pass the file path. For B1/B2/D1, paste the fixture prompt as the user's opening message.

3. **Let the agent run to its terminal state** — spec crystallization or execution bridge for deep-interview; final verdict output for spec-reviewer. Terminal states by scenario:

   | Scenario | Terminal State |
   |---------|----------------|
   | A2 (Fixture i) | spec-reviewer emits a final verdict (Approved or Issues Found) |
   | A2 (Fixture ii) | spec-reviewer emits a final verdict |
   | A2 (Fixture iii) | spec-reviewer emits a final verdict (Approved or Issues Found) |
   | B1 | deep-interview reaches Phase 4 (spec file written) or presents the execution bridge |
   | B2 | deep-interview reaches Phase 4 or execution bridge |
   | D1 | deep-interview reaches Phase 4 on the first-slice spec |

   Do NOT stop the run early. Some verification points (B2-V4, D1-V2) only appear at later phases.

4. Apply the **Compliance Rubric** (below) to the agent's **entire visible message history**. Score each item:
   - **PASS** — the trigger condition fired AND the expected behavior was observed.
   - **FAIL** — the trigger condition fired AND the expected behavior was NOT observed, OR the trigger fired and the check was silently skipped.
   - **N/A** — the trigger condition for that check did not fire in this run (e.g., deep-interview never surfaced MV-2 as a decision point). N/A is NOT a pass. If N/A appears for a check the fixture is designed to trigger, record it as a test-execution failure and re-run.

5. Compare against **Recorded Baseline Failures** to confirm the gap pattern is still present (RED stability). If the run fails to reproduce a recorded baseline failure, inspect whether the skill was edited since the last RED observation.

**Test discipline:** Do NOT prompt the agent toward compliance. Do NOT remind it of mandates. Do NOT stop it when it skips a behavior — let it skip and record FAIL. The score is evidence, not coaching.

---

## Scenario-Specific Run Targets

| Scenario | Fixture Source | Agent | Key Evidence to Capture |
|---------|----------------|-------|--------------------------|
| A2 — Fixture i | application-scenarios.md § A2 Fixture i | spec-reviewer | Full response text; final verdict line; Issues Found section |
| A2 — Fixture ii | application-scenarios.md § A2 Fixture ii | spec-reviewer | Full response text; final verdict line |
| A2 — Fixture iii | application-scenarios.md § A2 Fixture iii | spec-reviewer | Full response text; final verdict line; per-section substance flags |
| B1 | application-scenarios.md § B1 Fixture Prompt | deep-interview | Full message transcript; all AskUserQuestion calls; `(Recommended)` tag presence per question |
| B2 | application-scenarios.md § B2 Fixture Prompt | deep-interview | Tool call history (daedalus Agent calls); all AskUserQuestion calls |
| D1 | application-scenarios.md § D1 Fixture Prompt | deep-interview | First 2 assistant turns; all AskUserQuestion round questions |

Save full run evidence under `$OMT_DIR/evidence/deep-interview-prometheus-boundary-reshape/red-{a2,b1,b2,d1}/`.

---

## Compliance Rubric

Score each line against the agent's **entire** visible message history. For B2 tool-call checks (B2-V1, B2-V2), also inspect the tool call trace — "visible" includes tool invocations shown in the run output.

### A2 — spec-reviewer Design-Coverage Substantiveness

| # | Check | PASS Criterion | Trigger Condition |
|---|-------|----------------|-------------------|
| A2-F1i | Empty `## Architecture` flagged (Fixture i) | Response output names "Architecture" in Issues Found or equivalent problem section; verdict is NOT "Approved" | Fixture i dispatched; Architecture section is header-only |
| A2-F1ii | Empty `## Components` flagged (Fixture i) | Response names "Components" in Issues Found | Same |
| A2-F1iii | Empty `## Data Flow` flagged (Fixture i) | Response names "Data Flow" in Issues Found | Same |
| A2-F1iv | Empty `## Error Handling` flagged (Fixture i) | Response names "Error Handling" in Issues Found | Same |
| A2-F1v | Empty `## Testing` flagged (Fixture i) | Response names "Testing" in Issues Found | Same |
| A2-F2 | Substantive sections pass on Fixture ii | Final verdict on Fixture ii is "Approved"; none of the five section names appear in Issues Found | Fixture ii dispatched; all five sections have real content |
| A2-F3i | Architecture flagged as substantively inadequate (Fixture iii) | Response names "Architecture" in Issues Found with a substance complaint (names a placement but no structure or component relationships); complaint does not reference emptiness; verdict is NOT "Approved" | Fixture iii dispatched; Architecture section present but vacuous |
| A2-F3ii | Components flagged as substantively inadequate (Fixture iii) | Response names "Components" in Issues Found with a substance complaint (lists names but no responsibilities or dependencies per component); complaint does not reference emptiness | Fixture iii dispatched; Components section present but vacuous |
| A2-F3iii | Data Flow flagged as substantively inadequate (Fixture iii) | Response names "Data Flow" in Issues Found with a substance complaint (no concrete sources or sinks named); complaint does not reference emptiness | Fixture iii dispatched; Data Flow section present but vacuous |
| A2-F3iv | Error Handling flagged as substantively inadequate (Fixture iii) | Response names "Error Handling" in Issues Found with a substance complaint (no failure modes or response codes named); complaint does not reference emptiness | Fixture iii dispatched; Error Handling section present but vacuous |
| A2-F3v | Testing flagged as substantively inadequate (Fixture iii) | Response names "Testing" in Issues Found with a substance complaint (names nothing that is verified); complaint does not reference emptiness | Fixture iii dispatched; Testing section present but vacuous |
| A2-F3verdict | Fixture iii verdict is NOT "Approved" | Final verdict on Fixture iii is NOT "Approved" (Issues Found) | Fixture iii dispatched; all five sections are present but substantively inadequate |

### B1 — Always-Propose-Alternatives

| # | Check | PASS Criterion | Trigger Condition |
|---|-------|----------------|-------------------|
| B1-V1 | MV-1 (storage backend) has 2-3-option AskUserQuestion | AskUserQuestion for storage backend presents ≥2 distinct storage approaches; one option carries the token `(Recommended)` | Interview round that surfaces the storage backend choice |
| B1-V2 | MV-2 (scan processing) has 2-3-option AskUserQuestion | AskUserQuestion for scan processing presents ≥2 distinct processing model options; one carries `(Recommended)` | Interview round that surfaces the content safety processing choice |
| B1-V3 | (Recommended) tag count ≥ 2 across multi-viable choices | `grep -c "(Recommended)"` across visible transcript ≥ 2 — one per MV-choice | Any AskUserQuestion with alternatives in the transcript |
| B1-V4 | SV-1 (auth) not enumerated with fake alternatives | No AskUserQuestion presents JWT vs session cookies, JWT vs API keys, or equivalent auth-system enumeration | The auth/authorization topic surfaces in the interview |
| B1-V5 | Auth treated as a fact or confirmed single-path | AskUserQuestion count presenting ≥2 distinct auth systems as choices = 0 | Same as B1-V4 |

### B2 — daedalus Dispatch Selectivity

| # | Check | PASS Criterion | Trigger Condition |
|---|-------|----------------|-------------------|
| B2-V1 | No daedalus dispatch for SIMPLE-1 (storage format) | Tool call trace: zero `Agent(subagent_type="daedalus")` calls whose evidence block or dispatch context references the storage format / DB table vs log file decision | Storage format decision surfaced in the interview |
| B2-V2 | daedalus dispatched for COMPLEX-1 (event capture) | Tool call trace: exactly one `Agent(subagent_type="daedalus")` call; its evidence or focus text references event capture, audit mechanism, cross-cutting, or handler-level recording | Event capture mechanism surfaced as a design decision |
| B2-V3 | SIMPLE-1 offered via AskUserQuestion | AskUserQuestion for storage format presents ≥2 distinct options (DB table, log file, or equivalent) | Storage format decision surfaced |
| B2-V4 | COMPLEX-1 recommended via AskUserQuestion after daedalus | AskUserQuestion for event capture mechanism contains `(Recommended)` AND appears AFTER the daedalus Agent call in the tool call sequence | daedalus completes its run on the event capture choice |

### D1 — Scope-Decomposition Propose-Gate

| # | Check | PASS Criterion | Trigger Condition |
|---|-------|----------------|-------------------|
| D1-V1 | Decomposition proposed within first 2 assistant turns | Visible in turn 1 or 2: at least 2 named subsystems AND a statement scoping the interview to one at a time | Mega-idea fixture dispatched |
| D1-V2 | Interview scoped to exactly one subsystem | All AskUserQuestion round questions target ONE subsystem; zero questions about Stripe, billing, payment, email templates, or notification triggers | Interview loop begins |
| D1-V3 | Decomposition proposal is explicit in output | AskUserQuestion offering subsystem choices, OR a markdown message naming the subsystems and proposing a start order, appears BEFORE Round 1 | Turn 1 or turn 2 output |
| D1-V4 | S2 and S3 deferred | Zero AskUserQuestion question texts match: Stripe, billing plans, subscription, payment receipt, email template, notification template | Interview rounds 1 through N |

---

## Recorded Baseline Failures (predicted pre-change, 2026-06-30)

These are the gaps identified during plan authoring. A fresh baseline run should reproduce them. If a run does NOT reproduce a recorded failure, investigate whether the skill was edited before the baseline run.

| Scenario | Rubric # | Predicted Baseline Behavior | Root Cause |
|---------|----------|----------------------------|------------|
| A2 | A2-F3i through A2-F3v, A2-F3verdict | Fixture i (empty headers) is CHARACTERIZATION — spec-reviewer already flags empty design sections via its generic Completeness rubric; A2-F1i through A2-F1v PASS at baseline and are NOT the RED isolation. TRUE RED is Fixture iii: spec-reviewer returns "Approved" on present-but-insubstantial sections because `agents/spec-reviewer.md` has no substantive design-coverage row; A2-F3i through A2-F3v and A2-F3verdict all FAIL at baseline | `agents/spec-reviewer.md` What-to-Check has no design-coverage row; the current Completeness rubric catches emptiness ("empty section headers read as unfinished") but does NOT catch vacuous non-empty content |
| B1 | B1-V1, B1-V2 | deep-interview asks about storage and scan processing but does NOT structure those questions as 2-3-option AskUserQuestion with `(Recommended)` | Current SKILL.md has no always-propose-alternatives mechanism; the Phase-2-exit design-fork gate may present one fork at exit via daedalus but does NOT guarantee structured 2-3-option coverage of EVERY multi-viable choice during the interview loop |
| B2 | B2-V1, B2-V2 | daedalus dispatch is not selectively absent for SIMPLE-1 and present for COMPLEX-1; the simple/complex distinction is not encoded | Current SKILL.md design-fork gate uses load-bearing / cross-cutting criteria but applies them uniformly to any unresolved fork — no "simple multi-approach" class that explicitly excludes daedalus |
| D1 | D1-V1 | No decomposition proposal emitted; deep-interview begins the interview loop covering all three subsystems without proposing a split | Current SKILL.md Phase 1 has no scope-decomposition detect-and-propose gate; Phase 1 only performs brownfield/greenfield detection |

**Single root cause common to B1/B2/D1 (structural):** Current deep-interview SKILL.md encodes the 2-3-alternatives behavior only at the Phase-2-exit daedalus dispatch gate, not as an always-active interview-loop behavior. The Phase-1 scope gate does not exist. The simple/complex distinction is not encoded.

---

## GREEN-Phase Expectations (post-change)

After applying TODO 4 (spec-reviewer design-coverage check) and TODO 5 (deep-interview SKILL.md reshape with always-propose-alternatives, daedalus reframe, and Phase-1 scope-decomposition gate):

- **A2-F1i through A2-F1v**: spec-reviewer's Issues Found output will name each empty design section. Verified mechanically: grep the response for "Architecture", "Components", "Data Flow", "Error Handling", "Testing" in the Issues context.
- **A2-F2**: spec-reviewer returns "Approved" on the substantive Fixture ii without false flags. Verified: verdict token = "Approved".
- **A2-F3i through A2-F3v and A2-F3verdict**: post-change spec-reviewer names each of the five design sections (Architecture, Components, Data Flow, Error Handling, Testing) as substantively inadequate in Issues Found — not merely as empty — and the verdict is NOT "Approved". Verified: grep Issues Found for each section name plus a substance complaint; confirm verdict is "Issues Found" not "Approved".
- **B1-V1 and B1-V2**: always-propose-alternatives encodes the 2-3-option `(Recommended)` AskUserQuestion for every multi-viable choice during the interview. Verified: `grep -c "(Recommended)"` across transcript ≥ 2.
- **B1-V4 and B1-V5**: the "multi-viable definition" gate excludes single-viable choices. Verified: no auth-system-alternatives AskUserQuestion in transcript.
- **B2-V1 and B2-V2**: the daedalus reframe + "simple vs difficult/complex" distinction make dispatch selective. Verified: zero daedalus calls for SIMPLE-1; one daedalus call for COMPLEX-1.
- **D1-V1 and D1-V3**: the Phase-1 scope-decomposition gate fires before Round 1. Verified: decomposition message present in first 2 turns.
- **D1-V2 and D1-V4**: interview stays scoped to S1 only. Verified: zero Stripe/billing/email-template questions in AskUserQuestion text.

**Pass criteria for GREEN:** All rubric items except N/A reach PASS on a single clean run per scenario.

**REFACTOR triggers:** Any new rationalization observed in a GREEN-passing run (agent proposes 2-3 alternatives but omits `(Recommended)` on one; daedalus fires but its evidence block omits the capture mechanism rationale) → add to Recorded Baseline Failures verbatim and add a new verification point to the scenario.

---

## Notes on Test Execution

- **Visible message stream only:** Score from what the agent says, NOT from its internal reasoning or the TaskOutput JSONL log (per tool-usage-policy). The exception is tool call history for B2-V1 and B2-V2 — inspect the actual `Agent(...)` tool calls shown in the run output.
- **Fresh subagent definition:** "Fresh" means no conversation memory, no session-persisted state from a prior deep-interview run, no pre-loaded reference files. The agent begins from the skill definition only. An agent with a loaded `deep-interview-advanced.md` or prior ontology snapshots is NOT fresh.
- **N/A vs test-execution failure:** If a check is N/A because the fixture did not surface the trigger (e.g., MV-2 was never reached in a B1 run because ambiguity dropped below threshold after Round 2), treat it as a test-execution failure and re-run. The fixture is designed to surface all trigger conditions.
- **B2 tool call inspection:** "Tool call history" for B2-V1 and B2-V2 means the `Agent(subagent_type="daedalus")` call visible in the run output. If the transcript only mentions daedalus in prose ("I will consult daedalus") without an actual Agent tool call, that is FAIL on B2-V2.
- **Evidence naming convention:** Save evidence to `$OMT_DIR/evidence/deep-interview-prometheus-boundary-reshape/red-{scenario}/transcript.md` for the full transcript and `review.md` (A2 only) for spec-reviewer output.

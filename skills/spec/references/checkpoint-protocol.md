# Checkpoint Protocol (Per Step - MANDATORY)

**EVERY Step MUST complete this protocol. No exceptions. No skipping.**

Even if AI already has sufficient information for a Step, it MUST:
- Present what it knows as a **proposal/draft** to the user
- Get explicit user confirmation before marking the Step complete

### Step Completion Sequence

1. **Present results**: Show the Step's output/proposal to user (even if based on prior knowledge). Include potential risks of the proposed design (e.g., transaction scope expansion, coupling increase, blast radius of policy changes). Present risks as trade-offs with alternatives, not as blocking problems.
2. **User confirmation**: Wait for explicit user approval of the Step content
3. Save content to `$OMT_DIR/specs/{spec-name}/{area-directory}/design.md`
4. Update progress status at document top
4.5. **Update state.json**: Increment `steps_completed` for current area, update `updated_at`

### Decision Interview Gate (BLOCKING)

**For every recordable decision identified in this Step**, the agent MUST have conducted a user interview BEFORE recording.

The interview follows the **Rich Context Pattern** (defined inline in the main SKILL.md):
- **Current State** — What exists now (1-2 sentences)
- **Tension/Problem** — Why this decision matters, conflicting concerns
- **Existing Project Patterns** — Relevant code, prior decisions, historical context
- **Option Analysis** — For each option: behavior, tradeoffs (security/UX/maintainability/performance/complexity), code impact
- **Recommendation** — Your suggested option with rationale
- **AskUserQuestion** — Single question with 2-3 options

**ALL 9 Decision Recognition signals trigger this gate:**

1. Technology/tool selection
2. Strategy/approach choice
3. Priority/classification
4. Scope inclusion/exclusion
5. Feature deferral
6. Architecture pattern
7. Boundary definition
8. Elimination conclusion
9. Feedback incorporation

(Full Decision Recognition Checklist with examples is in `references/record-workflow.md`.)

**If a decision was made without interview** (e.g., emerged organically from a design discussion), it MUST be retroactively discussed with the user — present the Rich Context structure for that decision and obtain explicit user acknowledgment — before proceeding to record creation.

**This gate is BLOCKING.** Cannot proceed to step 5 (record creation) without passing.

5. **MANDATORY: Record decisions** to `{area-directory}/records/` (see Record Workflow below)
   - If decisions were made: Create record NOW. This is a BLOCKING gate — do NOT proceed to step 6 until record is saved. Then append the record filename to `areas[current_area].records` in state.json.
   - If no decisions were made: Explicitly state "No recordable decisions in this Step" before proceeding.
5.5. **Emergent Concern Check**: "Are there any design or clarification needs uncovered in this Step that are not addressed by the selected Design Areas?" If found, apply Emergent Concern Protocol.
6. Regenerate `spec.md` by concatenating all completed design.md files
7. Announce: "Step N complete. Saved. Proceed to next Step?" (For Requirements Analysis and Solution Design: Clarity Scoring display format replaces this announcement — see Clarity Scoring below)
8. Wait for user confirmation to proceed

### Information Sufficiency Rule

```
AI has enough info for a Step?
├── YES → Present as PROPOSAL to user → Get confirmation → Step complete
└── NO  → Dialogue with user → Build content → Present → Get confirmation → Step complete
```

**"I already know this" is NEVER a reason to skip presenting to the user.**
If you have sufficient information, use it to draft a high-quality proposal and present it for user review. The user may have corrections, additions, or different priorities that only surface when they see your proposal.

### Clarity Scoring

**Applies to Requirements Analysis and Solution Design only. Other Areas skip this scoring.**

**Ambiguity Threshold**: 0.2 — used at Phase Transition Gate and area completion warnings below.

After each Step completion within Requirements Analysis or Solution Design, compute clarity dimensions and display the score table to the user. The score from the final Step of an Area is the authoritative value used at the Phase Transition Gate.

**Formula:** `Ambiguity = 1 − Σ(clarity_i × weight_i)`

Each clarity dimension is rated 0.0 (fully ambiguous) to 1.0 (fully clear).

**Calibration anchors:**

| Score | Goal | Constraints | Success Criteria | Context (Brownfield) |
|-------|------|-------------|------------------|----------------------|
| 0.0 | No objective stated | No constraints identified | No criteria defined | No codebase understanding |
| 0.5 | Objective stated but scope unclear | Some constraints named, no priorities | Criteria exist but not measurable | Key modules identified, dependencies unknown |
| 1.0 | Single unambiguous objective with scope boundary | All constraints ranked with rationale | Every criterion has metric + threshold | Full dependency map with change-impact assessed |

| Variant | Dimensions | Weights |
|---------|-----------|---------|
| **Greenfield** | Goal, Constraints, Success Criteria | Goal 0.4, Constraints 0.3, Success Criteria 0.3 |
| **Brownfield** | Goal, Constraints, Success Criteria, Context | Goal 0.35, Constraints 0.25, Success Criteria 0.25, Context 0.15 |

**Variant selection:** Use Greenfield when no existing codebase is being modified; use Brownfield when the spec targets changes to an existing system.

**Worked example (Greenfield):**

| Dimension | Clarity | Weight | Weighted |
|-----------|---------|--------|----------|
| Goal | 0.8 | 0.4 | 0.32 |
| Constraints | 0.6 | 0.3 | 0.18 |
| Success Criteria | 0.5 | 0.3 | 0.15 |
| **Sum** | | | **0.65** |

`Ambiguity = 1 − 0.65 = 0.35` → exceeds 0.2 (Ambiguity Threshold); next Step targets Success Criteria (weakest at 0.5).

**Display format** (replaces Step Completion Sequence item 7 announcement for scored Areas):

```
Step {n} complete.

| Dimension             | Score | Gap              |
|-----------------------|-------|------------------|
| Goal                  | {s}   | {gap or "Clear"} |
| Constraints           | {s}   | {gap or "Clear"} |
| Success Criteria      | {s}   | {gap or "Clear"} |
| Context (brownfield only)  | {s}   | {gap or "Clear"} |

Ambiguity: {score} → Next Step targets: {weakest dimension}
Proceed to next Step?
```

For Greenfield projects, omit the Context row entirely.

**Area completion warning:** When completing Requirements Analysis or Solution Design with Ambiguity > 0.2 (the Ambiguity Threshold), display:

> "Ambiguity is {score}. Consider addressing gaps before proceeding to {Next Area}. Note: the Phase Transition Gate enforces ≤ 0.2 (Ambiguity Threshold) at the Requirements → Solution Design boundary."

The Phase Transition Gate enforces Ambiguity ≤ 0.2 (Ambiguity Threshold) at the Requirements → Solution Design boundary. For Solution Design → Design Areas, this warning is advisory only.

**Non-scoring Areas:** For all other Design Areas, Clarity Scoring is skipped. Area quality is ensured by the spec-review gate.

### Final Step Checkpoint (After Last Design Area)

**BEFORE announcing "All Design Areas finished":**

1. **Check records existence**: Do ANY `{area-directory}/records/` folders contain files?
2. **If YES (records exist)**:
   - Announce: "Records exist from this spec session. **Wrapup is MANDATORY.**"
   - "Proceeding to Wrapup."
   - Do NOT allow spec completion until Wrapup done
3. **If NO (no records)**:
   - Announce: "No records to preserve. Wrapup is optional."
   - May proceed directly to completion if user agrees

**This checkpoint is NON-NEGOTIABLE. Records existence = Wrapup required.**

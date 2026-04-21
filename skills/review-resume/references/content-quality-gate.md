# Content Quality Gate Protocol

> The Evaluation Phase diagnoses "what is the problem." The Quality Gate verifies "has the problem been resolved." Anything below the level a CTO would find convincing in an interview does not pass.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Evaluation Units](#2-evaluation-units)
3. [Alternative Suggestions Protocol](#3-alternative-suggestions-protocol)
4. [Interview Loop Protocol](#4-interview-loop-protocol)
5. [Quality Gate Loop — Full Flow](#5-quality-gate-loop--full-flow)
6. [User Opt-Out Handling](#6-user-opt-out-handling)
7. [HTML Report Alternatives Format](#7-html-report-alternatives-format)
8. [Whole-Resume Feedback Loop](#8-whole-resume-feedback-loop)

---

## 1. Overview

### Purpose

The Per-Section-Unit Content Quality Gate is a verification loop that ensures content quality for each resume bullet/entry immediately before HTML report generation (Phase 10). If the Evaluation Phase diagnoses "what is wrong with this section," the Quality Gate is the step where the tech-claim-examiner agent independently verifies "has that problem actually been resolved."

### Core Principle

**"Anything below the level a CTO would find convincing in an interview does not pass."**

The final reader of a resume is the hiring decision-maker. Each alternative must pass the following questions:
- "If asked about this bullet in an interview, can the candidate answer it?"
- "Is there an actual source backing up what this content claims?"
- "Does the interviewer have a reason to find this content interesting?"

If even one answer is "no," that section does not pass the Quality Gate.

### Difference from Evaluation Phase

| Dimension | Evaluation Phase | Quality Gate |
|-----------|----------------------|-------------|
| Role | Diagnosis | Verification |
| Question | "What is the problem?" | "Has the problem been resolved?" |
| Agent | review-resume skill | tech-claim-examiner agent (independent review) |
| Output | Gap list, revision direction | APPROVE / REQUEST_CHANGES binary verdict |
| Repetition | Single pass | Loop — repeats until APPROVE |
| Exit | None (completing evaluation is the goal) | User Opt-Out only |

---

## 2. Evaluation Units

The Quality Gate splits the resume into **1 bullet / 1 entry** units for processing. The minimum unit in which tech-claim-examiner conducts technical interrogation is the individual technical claim.

### Target Selection

**ALL evaluator-eligible items** are subject to the Quality Gate. Eligibility is determined by content type (see SKILL.md Examiner Eligibility Rule), not by Evaluation Phase P-level findings. Evaluation Phase findings are transmitted as context to the examiner, but do not gate eligibility.

### Summary/Introduction

| Type | Evaluator Target | Reason |
|------|-----------------|--------|
| Type A (professional identity) | YES — when technical claims are included | Technical claims require verification of technical substance |
| Type B (work philosophy) | YES — when technical episodes are included | Technical episodes require verification of technical substance |
| Type C (company connection) | YES | Technical capability → company domain mapping requires verification of technical substance |
| Type D (current interests) | YES — when technical exploration is included | Technical exploration requires verification of technical substance |

### Career / Work Experience

Processed as **1 unit per bullet**. If Company A has 3 bullets, that is 3 separate evaluator calls.

Examples:
- "Built Kafka async pipeline, tripling throughput" → 1 unit
- "Achieved zero payment-order inconsistencies" → 1 unit

**Processing order:** Most recent employer first. Within the same employer, by finding severity (P0 → P1 → P2 → P3 → no findings).

### Problem-Solving

Processed as **1 unit per entry**. An entry is a single technical narrative (episode) and is sent to the evaluator as a whole.

Examples:
- Entire "payment system fault isolation" episode → 1 unit
- Entire "search response latency optimization" episode → 1 unit

**Processing order:** All problem-solving entries with 5+ lines are evaluator-eligible. Entries under 5 lines are not subject to technical interrogation.

### Skills / Study

**Not a tech-claim-examiner target.** A list of tech stacks is not subject to technical interrogation. Evaluation Phase evaluation is sufficient.

---

## 3. Alternative Suggestions Protocol

### Core Principle

**Do not present a single revision. Always present 2-3 alternatives with tradeoff comparisons.**

Presenting a single revision causes two problems:
1. The user is forced to adopt the revision without sharing the underlying assumptions (positioning direction, risk tolerance).
2. When the tech-claim-examiner issues a FAIL, there is no indication of which direction to revise toward.

Presenting alternatives lets the user choose a direction, and enables designing follow-up interviews to resolve the tech-claim-examiner's FAIL axes within the chosen direction.

### Alternative Format

Each alternative follows this structure:

```
### Alternative {N}: {one-line summary}

**Revision:**
{specific revision text — exactly as it would appear in the resume}

**Pros:**
- {strength of this alternative 1}
- {strength of this alternative 2}

**Cons:**
- {weakness/risk of this alternative 1}
- {weakness/risk of this alternative 2}

**Tradeoff Summary:**
{one sentence on what value this alternative prioritizes and what it sacrifices}

**Interview Simulation:**
{expected follow-up questions in an interview with this alternative, and likelihood of being able to answer them}
```

### Alternative Generation Criteria

**Alternative 1: Safe direction**
- Minimally modifies existing content
- Improves only within the range supportable by confirmed sources
- Does not include content that cannot be answered in an interview
- Prioritizes accuracy over differentiation

**Alternative 2: High-impact direction**
- Substantially modifies or completely rewrites existing content
- Brings stronger sources to the forefront if available
- Maximizes differentiation and hook potential
- Explicitly states axes that need supplementation through interview if sources are insufficient
- Risk: higher likelihood of in-depth questions in an interview

**Alternative 3 (optional): Compromise or different angle**
- Presents a completely different angle when alternatives 1 and 2 both trend in similar directions
- Or presents a clear midpoint between alternatives 1 and 2
- Present 3 alternatives when there is a meaningful strategic difference in "how to position this section"

**Scale Framing in Alternatives:**

When generating alternatives and the candidate's experience scale is smaller than the target company's:
- **Alternative 1 (Safe)**: Scale-Omit strategy — omit scale numbers and focus on the reasoning and judgment logic
- **Alternative 2 (High-Impact)**: Scale-Project strategy — describe at the target company's scale, but the candidate must be able to logically defend this in an interview
- **Alternative 3 (if applicable)**: Scale-Relative strategy — express impact using improvement ratios (e.g., "8x improvement") rather than absolute figures. Useful when the improvement rate is impressive regardless of absolute scale.
- The primary criterion is interview defensibility. If the candidate can explain the numbers and design two levels deep, it is valid.
- When assessing "Interview safety" in the comparison table, reflect whether the candidate can cover questions at that scale.

### Comparison Table (User Presentation Format)

After presenting alternatives, always include a comparison table in the following format:

```markdown
| Criterion | Alt 1: {summary} | Alt 2: {summary} | Alt 3: {summary} |
|-----------|-----------------|-----------------|-----------------|
| Interview safety | ★★★ | ★☆☆ | ★★☆ |
| Differentiation | ★☆☆ | ★★★ | ★★☆ |
| Source requirement | Low | High | Medium |
| Revision scope | 1 sentence | Full rewrite | 2-3 sentences |
```

**★ Rating criteria:**
- Interview safety: degree to which the candidate can answer follow-up questions about this revision in an interview
- Differentiation: likelihood this content stands out compared to candidates at a similar experience level
- Source requirement: amount of additional sourcing needed to complete the revision
- Revision scope: degree of change relative to existing content

### Recommended Alternative Marking

Below the comparison table, state the recommended alternative and reasoning:

```
**Recommendation:** Alternative {N}
**Reason:** {1-2 sentences — judgment based on the user's target position and current source level}
```

Always provide a recommendation, but respect the user's choice if they select a different alternative.

---

## 3.5. Pre-Examiner Interview Protocol

### Purpose

Conduct a detailed per-item interview with the user before examiner dispatch. The purpose of the interview is not to handle failure but to achieve **preparation for success and reaching agreement**.

### Interview Flow (Per Item)

1. **Share Findings**: Present Evaluation Phase results item by item
2. **Collect Context**: Uncover concerns, tradeoffs, and hidden context
3. **Present Alternatives + Discuss**: Discuss 2-3 alternatives with pros/cons, confirm user preference
4. **Reach Agreement**: Finalize alternatives after agreeing on direction

### Interview Rules

- One question per message. Multiple questions are prohibited.
- Discuss every finding without exception. Do not skip items on the grounds of being "minor."
- When the user gives an ambiguous answer → follow up with a clarifying question.
- When the user opts out ("next" / "move on" / "다음으로" / "넘어가자") → end the current item interview, proceed with examiner dispatch.
- Even for PASS items, suggest improvements if room exists. "Technically a PASS, but could be better" is also a discussion topic.

### Relationship with Section 4 (Post-Examiner Interview)

| Dimension | Pre-Examiner Interview | Post-Examiner Interview |
|-----------|----------------------|------------------------|
| Trigger | Always (every evaluator-eligible item) | REQUEST_CHANGES received |
| Purpose | Reach agreement, prepare for success | Supplement FAIL axes, improve |
| Question basis | Evaluation Phase findings | Examiner's Interview Hints |
| Exit | Agreement reached → examiner dispatch | Source secured → re-dispatch |

---

## 4. Interview Loop Protocol

### Relationship with experience-mining.md

Quality Gate interviews **extend** the 4-Stage Bypass Protocol from experience-mining.md. The two interviews have different purposes:

| Dimension | experience-mining interview | Quality Gate interview |
|-----------|-----------------------------|----------------------|
| Purpose | Discover new sources | Secure sources to resolve already-identified problems |
| Trigger | Phase gap detected | tech-claim-examiner REQUEST_CHANGES received |
| Target | Undiscovered experiences | Evaluation axes with FAIL verdict |
| Question basis | Gap list from Writing Guidance | Interview Hints from tech-claim-examiner |
| When exhausted | Mark as "genuinely none," move to next topic | Generate "best revision with current sources" + state limitations |

### Interview Loop Structure

```
tech-claim-examiner REQUEST_CHANGES received
    ↓
Iterate interview_hints from REQUEST_CHANGES
    ↓
For each hint:
    1. Check Interview Hints from tech-claim-examiner
    2. Set source target that can move this axis to PASS
    3. Apply experience-mining 4-Stage Bypass:
       Stage 1: Direct Question (specific question based on Hints)
       Stage 2: Bypass Question (reframe the same gap from 3 angles)
       Stage 3: Adjacent Experience (explore related adjacent situations)
       Stage 4: Daily Work (explore hidden sources in routine work)
    4. Source confirmed → regenerate revision (apply Section 3 protocol)
    5. Source not confirmed → generate "best revision with current sources" + state limitations
```

### How to Use Interview Hints

The tech-claim-examiner provides `interview_hints` with REQUEST_CHANGES. These hints specify "what information would change this axis to PASS."

Principles for converting Hints into questions:

**BAD (too abstract):**
> "Were there any tradeoffs?"

**GOOD (specific, with context):**
> "When introducing Redis, was there anything you wrestled with between cache consistency and response speed? For example, what criteria did you use for cache TTL, and did stale data ever cause issues?"

Elements of a good question:
1. **Diagnostic context**: Provide background so the user understands why you're asking
2. **Specific target**: Target a specific situation/decision/number, not a vague "experience"
3. **Include examples**: Provide examples so the user can recall similar cases

### Source Quality Formula

The source confirmation criteria applies the same Source Quality Formula from experience-mining.md.

**Source = Fact + Context + Verifiability**

| Element | Definition | When Absent |
|---------|------------|-------------|
| Fact | What happened | "I have experience" — content unknown |
| Context | Why/where/how | Fact alone cannot be used in a resume |
| Verifiability | Numbers, before/after comparison, measurable outcome | Unverifiable claims |

If any of the three elements is missing, the source is judged unconfirmed and the next Stage is entered.

### Handling Unconfirmed Sources

If sources remain unconfirmed after all 4 Stages are exhausted:

1. Generate a "best revision with current sources." This revision is the most improved version within the range supported by available sources.
2. State the limitation explicitly in the revision: "The examiner's structured feedback for this item may be difficult to fully satisfy with current sources. If the tech-claim-examiner issues a FAIL again, consider User Opt-Out for this item."
3. Dispatch this revision to the tech-claim-examiner. If the tech-claim-examiner APPROVE, proceed; if REQUEST_CHANGES, confirm with the user whether to Opt-Out.

**Interview rules (same as experience-mining.md):**
- One question per message. Multiple questions are prohibited.
- Treat ambiguous answers with clarifying questions. Do not accept insufficient answers as sources.
- If the user opts out ("move on" / "let's skip" / "다음으로" / "넘어가자") → end current interview → hand off to Opt-Out handling.

### Interview-Impossible Mode Branch

When the session operates in **interview-impossible mode** (the resume owner is not present), skip the post-examiner interview loop entirely. Apply the following protocol instead:

**Trigger:** REQUEST_CHANGES received AND interview-impossible mode is active.

**Protocol:**
1. Skip the 4-Stage Bypass interview loop entirely. No questions are posed to the user.
2. Generate 2-3 alternatives for all FAIL items using **resume content as the sole source**. No user-sourced context from the pre-examiner interview is available.
   - Alternative 1 (Safe): Scale-Omit strategy — omit unverifiable claims, focus on reasoning and judgment within confirmed resume content.
   - Alternative 2 (High-Impact): Scale-Project strategy — maximize impact from confirmed content; flag axes that require owner confirmation.
   - Alternative 3 (Balanced): Compromise between Alternatives 1 and 2, or a different framing angle.
   - Include a tradeoff table identical to Section 3 format.
3. Dispatch the alternatives package to tech-claim-examiner.
4. If **any alternative receives `final_verdict: APPROVE`**: adopt it and continue.
5. If **all alternatives receive `final_verdict: REQUEST_CHANGES`**: opt-out. Mark the item with badge "소유자 인터뷰 필요" in the HTML report. Record verdict as `opt-out (interview-impossible)`.

**Interview Hints in interview-impossible mode:** The tech-claim-examiner still generates `interview_hints`. Present them to the user as-is, in source bullet language, item by item — identical to the standard flow. Skip the interview → question conversion step; do NOT conduct an interview. Hints are shown so the user understands what information would have changed the verdict.

---

## 5. Quality Gate Loop — Full Flow

```mermaid
flowchart TB
    A[Evaluation Phase complete] --> B[Select ALL evaluator-eligible items]
    B --> C[Select next item]
    C --> PRESENT[Present Evaluation Phase findings to user]
    PRESENT --> INTERVIEW_PRE[Pre-Examiner Interview\n— discuss findings, collect context,\npropose improvements, reach agreement]
    INTERVIEW_PRE --> D[Generate 2-3 alternatives + tradeoffs]
    D --> H[tech-claim-examiner dispatch\n— send original + alternatives package]

    H --> DIAG{Step 1: Interrogate original\nIs there really a problem?}
    DIAG -->|No problem| APPROVE_ORIG[APPROVE — no revision needed]
    DIAG -->|Problem found| ALTEVAL{Step 2: Interrogate alternatives\nIs each one valid?}

    ALTEVAL -->|At least 1 passes| APPROVE_ALT[APPROVE — include verified alternative in HTML]
    ALTEVAL -->|All fail| K[REQUEST_CHANGES\n+ Interview Hints]

    K --> L[Additional Interview\n— interview_hints-based, all the way\n4-Stage Bypass Protocol]
    L --> M{Source confirmed?}
    M -->|YES| D
    M -->|NO: 4-Stage exhausted| N[Best revision with current sources]
    N --> O{User Opt-Out?}
    O -->|YES: move on| J
    O -->|NO: continue| H

    APPROVE_ORIG --> J{Next item\nexists?}
    APPROVE_ALT --> J

    J -->|YES| C
    J -->|NO| VERDICT[Verdict Tracker Verification]
    VERDICT --> P[Phase 10: Generate HTML]

    style H fill:#e74c3c,stroke:#333,color:#fff
    style INTERVIEW_PRE fill:#3498db,stroke:#333,color:#fff
    style L fill:#8e44ad,stroke:#333,color:#fff
    style P fill:#27ae60,stroke:#333,color:#fff
```

> **Note:** SKILL.md "Quality Gate Flow (Per Item)" contains the primary flow that the AI follows. Changes to the loop structure must be synchronized between both files.

> **interview-impossible mode:** This flowchart depicts interview-possible mode. In interview-impossible mode, the "Pre-Examiner Interview" node is skipped (go directly to alternative generation), and the "Additional Interview" node (L) is also skipped — REQUEST_CHANGES leads directly to opt-out with badge "소유자 인터뷰 필요".

### Loop Entry Condition

The Quality Gate loop is entered automatically after Phase 8 completes. Without a separate trigger, immediately after the final Phase 8 evaluation output, the flow proceeds to selecting ALL evaluator-eligible items and starting the pre-examiner interview for each item.

### tech-claim-examiner dispatch

The tech-claim-examiner is dispatched **1 bullet / 1 entry** at a time.

The Input Format uses the template defined in SKILL.md Phase 9 "Evaluator Dispatch Protocol." This template exactly matches the Input Format in `SKILL.md`.

**Key rules:**
- The main session directly identifies "technologies/approaches" in Technical Context from the bullet text
- Evaluation Phase findings are passed verbatim (no summarization)
- Each evaluation is independent. Do not resend previous evaluation results.
- Target Company Context (company scale, core values, technical challenges) is populated based on Phase 2 research results and passed to the tech-claim-examiner via the dispatch template.

### Post-APPROVE Handling

Revisions for bullets that receive APPROVE are recorded as "confirmed revisions." The Phase 10 HTML report is generated based on these confirmed revisions.

### Mandatory Verdict Tracker

Before entering Phase 10, internally track the verdict for every evaluator-eligible item. If even one entry is blank, Phase 10 entry is blocked.

| # | Section | Item | Verdict | Loop Count |
|---|---------|------|---------|------------|
| 1 | Self-Introduction C | "Data consistency..." | APPROVE / user-opt-out / ??? | N |

If any item has a verdict of `???` → return to that item and re-run the Quality Gate.

---

## 6. User Opt-Out Handling

The Quality Gate is an infinite loop, but the user can explicitly exit.

### Opt-Out Trigger Keywords

| Keyword | Handling |
|---------|---------|
| "move on" | End current section loop → proceed to next section |
| "this is OK" | End current section loop → proceed to next section |
| "skip" | End current section loop → proceed to next section |
| "just continue" | End current section loop → proceed to next section |
| "다음으로" | End current section loop → proceed to next section |
| "넘어가자" | Same as "다음으로" |

### Opt-Out Status Marking

Opted-out sections are recorded as follows:
- **User opt-out** (interview-possible mode): `opt-out (user-accepted)` — the user explicitly chose to move on
- **System opt-out** (interview-impossible mode): `opt-out (interview-impossible)` — alternatives exhausted without owner input

Both statuses are treated identically for Phase 10 entry gate purposes.

### Handling Ambiguous Responses

The following ambiguous responses are not treated as Opt-Out:
- "hmm...", "not sure", "roughly OK", "seems fine"

In this case: confirm with "Is there anything still unsatisfying about this section? If yes, let's continue; if not, we'll move to the next section."

**Rule:** Only explicit Opt-Out exits the loop. Ambiguous affirmations keep the loop running.

### Opt-Out Display in HTML Report

Two opt-out types are distinguished in the HTML report. Both use `.section-opt-out` with `.fail-axis` divs expanded — all content always visible, never collapsed.

**User opt-out** (owner explicitly chose to move on):
- `.opt-out-badge` displays "미해결 피드백"
- Each FAIL section rendered as an expanded `.fail-axis` div with generic `.hint-category` and `.axis-feedback` content (examiner's finding)

**System opt-out — interview-impossible** (owner not present, all alternatives failed):
- `.opt-out-badge` displays "소유자 인터뷰 필요"
- Each FAIL section rendered as an expanded `.fail-axis` div with generic `.hint-category` and `.axis-feedback` content (examiner's finding)
- Interview Hints are displayed to the user as-is, item by item, in source bullet language (per §4 Interview-Impossible Mode Branch). Hints 제공의 의도는 "owner가 어떤 정보를 확인해줘야 할지"를 reviewer에게 시각화하는 것.

---

## 7. HTML Report Alternatives Format

Defines how alternatives for each finding are displayed in the Phase 10 HTML report. Actual application is handled in the SKILL.md HTML template modification task.

### Direction of Change

**Before (single revision):**
```html
<div class="suggestion">Revision: ...</div>
```

**After (2-3 alternatives + tradeoff table):**
```html
<div class="alternatives">
  <h4>Revision Alternatives</h4>
  <div class="alternative">
    <div class="alt-header">
      <span class="alt-badge alt-safe">Alt 1: Safe</span>
      <span class="alt-recommendation">★ Recommended</span>  <!-- recommended alternative only -->
    </div>
    <div class="alt-content">{revision text}</div>
    <div class="alt-pros">Pros: {pros}</div>
    <div class="alt-cons">Cons: {cons}</div>
  </div>
  <div class="alternative">
    <div class="alt-header"><span class="alt-badge alt-impact">Alt 2: High-Impact</span></div>
    <div class="alt-content">{revision text}</div>
    <div class="alt-pros">Pros: {pros}</div>
    <div class="alt-cons">Cons: {cons}</div>
  </div>
  <table class="tradeoff-table">
    <tr><th>Criterion</th><th>Alt 1</th><th>Alt 2</th></tr>
    <tr><td>Interview safety</td><td>★★★</td><td>★☆☆</td></tr>
    <tr><td>Differentiation</td><td>★☆☆</td><td>★★★</td></tr>
  </table>
</div>
```

### Opt-Out Section Display Format

**User opt-out** (owner explicitly moved on):
```html
<div class="section-opt-out">
  <span class="opt-out-badge">미해결 피드백</span>
  <div class="resume-line">{원본 bullet 텍스트}</div>
  <div class="unresolved-feedback">
    <div class="fail-axis">
      <div class="hint-category">{실패 axis 이름 (예: 근거)}</div>
      <div class="axis-feedback">{examiner 피드백 내용}</div>
    </div>
    <div class="fail-axis">
      <div class="hint-category">{실패 axis 이름 (예: 역할/범위)}</div>
      <div class="axis-feedback">{examiner 피드백 내용}</div>
    </div>
  </div>
</div>
```

**System opt-out** (interview-impossible mode — all alternatives failed):
```html
<div class="section-opt-out">
  <span class="opt-out-badge">소유자 인터뷰 필요</span>
  <div class="resume-line">{원본 bullet 텍스트}</div>
  <div class="unresolved-feedback">
    <div class="fail-axis">
      <div class="hint-category">{실패 axis 이름 (예: 영향)}</div>
      <div class="axis-feedback">{examiner 피드백 내용}</div>
    </div>
    <div class="fail-axis">
      <div class="hint-category">{실패 axis 이름 (예: 기술 깊이)}</div>
      <div class="axis-feedback">{examiner 피드백 내용}</div>
    </div>
  </div>
</div>
```

### CSS Class Definitions

CSS reference (canonical source: `references/html-template.html` `<style>` block. This section is for documentation only — do not modify CSS here; update html-template.html instead):

```css
.alternatives {
  background: #f8f9fa;
  border: 1px solid #dee2e6;
  border-radius: 8px;
  padding: 16px;
  margin: 8px 0;
}
.alternative {
  border-left: 3px solid #6c757d;
  padding: 8px 12px;
  margin: 8px 0;
  background: #fff;
  border-radius: 0 4px 4px 0;
}
.alt-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.8rem;
  font-weight: 700;
}
.alt-safe { background: #d4edda; color: #155724; }
.alt-impact { background: #cce5ff; color: #004085; }
.alt-balanced { background: #fff3cd; color: #856404; }
.alt-recommendation {
  color: #e67e22;
  font-weight: 700;
  font-size: 0.85rem;
  margin-left: 8px;
}
.alt-pros { color: #27ae60; font-size: 0.9rem; margin: 4px 0; }
.alt-cons { color: #c0392b; font-size: 0.9rem; margin: 4px 0; }
.tradeoff-table {
  margin-top: 12px;
  font-size: 0.9rem;
  width: 100%;
  border-collapse: collapse;
}
.tradeoff-table th {
  background: #e9ecef;
  padding: 6px 12px;
  text-align: left;
}
.tradeoff-table td {
  padding: 6px 12px;
  border-bottom: 1px solid #dee2e6;
}
.section-opt-out {
  background: #fff3cd;
  border: 1px solid #ffc107;
  border-radius: 6px;
  padding: 12px;
  margin: 8px 0;
}
.opt-out-badge {
  display: inline-block;
  background: #ffc107;
  color: #212529;
  padding: 2px 10px;
  border-radius: 4px;
  font-size: 0.8rem;
  font-weight: 700;
  margin-bottom: 8px;
}
.unresolved-feedback {
  margin-top: 8px;
}
.fail-axis {
  border-left: 3px solid #dc3545;
  padding: 6px 12px;
  margin: 6px 0;
  background: #fff;
}
.hint-category {
  font-weight: 700;
  color: #dc3545;
  font-size: 0.85rem;
}
.axis-feedback {
  margin: 4px 0;
  font-size: 0.9rem;
}
.unresolved-note {
  background: #fff3cd;
  border-left: 4px solid #ffc107;
  padding: 10px 14px;
  margin: 8px 0;
  border-radius: 0 4px 4px 0;
  font-style: italic;
}
```

---

## 8. Whole-Resume Feedback Loop

### Purpose

After generating the HTML report in Phase 10, provide a loop that allows the user to give additional feedback after reviewing the completed resume as a whole. If the per-section Quality Gate ensures the quality of individual revisions, the Whole-Resume Feedback Loop performs a final check on the consistency and direction of the resume as a whole.

### Loop Structure

```
Phase 10 HTML generated + browser opened
    ↓
User review → AskUserQuestion
"Have you reviewed the full resume? Let me know if there is anything you'd like to revise."
    ↓
Feedback present?
    → YES (specific section issue): Re-enter Quality Gate for that section
    → YES (overall structure/direction issue): Re-enter Quality Gate for relevant sections
    → NO (explicit termination signal only): Proceed to Phase 10 결과 전달
```

### Feedback Classification and Handling

| Feedback Type | Example | Handling |
|--------------|---------|---------|
| Specific section revision request | "The 2nd bullet for Company A looks weak" | Re-enter Quality Gate for that section (Company A career) |
| Overall direction issue | "Leadership doesn't come through overall" | Re-enter Quality Gate for intro + career sections |
| Structure/layout issue | "The tech stack section is too far back" | Re-confirm section-evaluation.md rules, then regenerate HTML |
| Additional content request | "I'd like to add this experience too" | Apply experience-mining protocol, then reprocess that section |

### Termination Conditions (Explicit Signals Only)

Only the following expressions are recognized as loop termination signals:
- "OK", "looks good", "done", "that's it"
- "no feedback", "nothing to add"
- "let's move on", "go to Phase 10 결과 전달"
- "this is enough"

### Handling Ambiguous Responses

| Ambiguous Response | Handling |
|-------------------|---------|
| "hmm...", "not sure" | Confirm: "Is there anything specific that feels unsatisfying?" |
| "seems fine" | Confirm: "Is there any section you'd like to improve further?" |
| "roughly OK" | "If you've reviewed it, we'll proceed to the next step unless you have feedback. Let me know if you do." |

**Core rule:** Maintain the loop until an explicit termination signal. Do not interpret ambiguous affirmations as termination.

### HTML Regeneration Handling

When a section is revised in the Whole-Resume Feedback Loop:
1. Complete the Quality Gate loop for that section (APPROVE or Opt-Out)
2. Regenerate the entire HTML report (do not replace only the modified section — regenerate the whole thing)
3. Reopen in the browser
4. User review → feedback loop again

Repeat this full regeneration + re-review loop until the user sends an explicit termination signal.

### Force-Exit Handling

On force-exit signals such as "just move on":
- Display an "Unresolved feedback" badge in the HTML report for any sections with unresolved feedback
- Proceed to Phase 10 결과 전달

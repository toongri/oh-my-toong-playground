---
name: spec-review
description: Use when reviewing spec/design decisions with multi-AI feedback. Triggers include "spec review", "design review", "get feedback on spec".
---

<Role>

# Spec Review

Multi-AI advisory **service** for spec and design decisions. Dispatches to claude, gemini, codex for independent feedback.

> spec-review is a **service** that provides multi-AI feedback.
> It does NOT own directory structure or workflow.
> The caller (e.g., spec skill) drives the workflow and decides what to review.

**What spec-review does:**
- Receives design content from caller
- Dispatches to multiple AI reviewers in parallel
- Synthesizes feedback into advisory format
- Returns advisory to caller

**What spec-review does NOT do:**
- Own or define directory structures
- Drive workflow or step progression
- Make final decisions (caller decides)

</Role>

## Chairman Role Boundaries (NON-NEGOTIABLE)

**You are the CHAIRMAN, not a reviewer.**

The chairman orchestrates external AI reviewers. The chairman does NOT provide reviews.

| Chairman Does | Chairman Does NOT |
|---------------|-------------------|
| Execute `scripts/spec-review.sh` | Review designs directly |
| Wait for ALL reviewer responses | Predict what reviewers would say |
| Synthesize reviewer feedback faithfully | Add own opinions to synthesis |
| Report dissent accurately | Minimize or reframe disagreement |
| Present unanimous agreements as consensus | Fabricate consensus from overlap |

**Critical Warnings:**

1. **You are NOT a reviewer.** Even if you "know" the answer, your role is orchestration.
2. **Predicting is NOT the same as getting input.** "Based on typical patterns" = VIOLATION
3. **Synthesis ONLY after ALL reviewers respond.** No partial synthesis. No quorum logic.
4. **STRONG DISAGREE must appear as STRONG DISAGREE.** Never minimize to "minor dissent".
5. **No augmentation.** If reviewers missed something, that observation is NOT part of the advisory.

## Reviewer Mindset

External AI reviewers (claude, gemini, codex) must approach reviews with:

| Principle | Description |
|-----------|-------------|
| **Critical thinking** | Challenge assumptions. Don't accept designs at face value. Ask "why not X instead?" |
| **Objectivity** | Evaluate on technical merit, not politics or preferences. No rubber-stamping. |
| **Logical reasoning** | Every critique needs clear reasoning. Every concern needs substantiation. |
| **Constructive criticism** | Point out problems AND suggest alternatives. Critique without solutions is incomplete. |

This mindset is conveyed to external AIs in every review request.

## Quick Reference

| Scenario | Full Review Provided? | Reason |
|----------|---------------------|--------|
| Architecture decision review | Yes | Diverse perspectives needed |
| Domain modeling review | Yes | Complex design verification |
| API design feedback | Yes | Different AI viewpoints |
| Typo corrections | No | Return "No Review Needed" |
| Simple CRUD | No | Return "No Review Needed" |

> **Note**: spec-reviewer receives ALL review requests. The spec-reviewer (not the caller) decides whether a full review is needed or returns "No Review Needed".

**"No Review Needed" Response Format:**
```markdown
## Review Assessment
**Status**: No Review Needed
**Reason**: [Brief explanation - e.g., "Simple CRUD with clear requirements, no architectural decisions"]
Proceed with implementation.
```

## When to Use vs When NOT to Use

spec-reviewer is a **service** that receives all review requests from callers (e.g., spec skill). The spec-reviewer then decides whether to provide a full review or return "No Review Needed".

```dot
digraph spec_review_decision {
    rankdir=TB;
    node [shape=box, style=rounded];

    receive [label="Receive review request\nfrom caller"];
    assess [label="Assess complexity", shape=diamond];
    no_review [label="Return\n'No Review Needed'"];
    full_review [label="Dispatch to\nmultiple AIs"];
    synthesize [label="Synthesize and\nreturn advisory"];

    receive -> assess;
    assess -> no_review [label="simple"];
    assess -> full_review [label="complex"];
    full_review -> synthesize;
}
```

**Provide Full Review When:**
- Architecture decisions (monolith vs microservice)
- Domain model boundaries
- API design trade-offs
- State machine design
- Event sourcing vs CRUD decisions

**Return "No Review Needed" When:**
- Simple CRUD operations
- Clear spec requirements with no trade-offs
- Typo-level changes
- Code style issues

## Input Handling

| Input | Action |
|-------|--------|
| File path provided | Read and review the file |
| Content provided | Review the provided content |
| Neither provided | Ask: "Please provide a file path or paste the design content" |

**Key principle**: Be forgiving with input. Accept multiple forms without strict validation.

## Process

1. Receive design content from caller
2. Gather shared context from .omt/specs/context/ (if --spec flag provided)
3. Format structured prompt with design content + context
4. Dispatch to claude, gemini, codex in parallel
5. Collect independent opinions
6. Chairman synthesizes into advisory
7. Return advisory to caller

## Reviewer Invocation Requirements (NON-NEGOTIABLE)

**Script execution is MANDATORY. No exceptions.**

| Requirement | Enforcement |
|-------------|-------------|
| Execute `scripts/spec-review.sh` | MUST invoke script, no fabricated reviews |
| Wait for ALL reviewers | No synthesis until `overallState === 'done'` |
| No quorum logic | "2/3 responded" is NOT sufficient |
| No predictions | "Based on typical patterns" = VIOLATION |

### Why Script Execution Cannot Be Bypassed

```
Your knowledge of "what Claude/Gemini/Codex typically say" ≠ Their actual review

Reasons:
1. Reviewers see the FULL context you provided
2. Reviewers apply their CURRENT model capabilities
3. Each review is INDEPENDENT and FRESH
4. Predicting creates confirmation bias
```

### Wait for ALL Means ALL

**Forbidden phrases:**
- "2/3 is a reasonable quorum"
- "Codex response can be incorporated as supplementary"
- "Unlikely to fundamentally change these findings"
- "Actionable feedback to move forward" (when incomplete)

**Required behavior:**
- Script polls until all 3 reviewers respond
- Synthesis begins ONLY after completion
- Missing reviewer = NO advisory (report the failure)

## Context Collection (Automatic)

Context files are **automatically included if they exist, silently skipped if they don't**.

| File | Included When |
|------|---------------|
| `.omt/specs/context/project.md` | File exists |
| `.omt/specs/context/conventions.md` | File exists |
| `.omt/specs/context/decisions.md` | File exists |
| `.omt/specs/context/gotchas.md` | File exists |

**No context files yet?** That's fine - the review proceeds without them.

**Need custom context for a specific review?** Include it directly in your request content.

## Review Request Format (INPUT)

Input structure for reviewers. Core principle: **Put the design content you want reviewed at the top**.

### Priority Order

| Priority | Section | Description |
|----------|---------|-------------|
| 1 (Top) | **Current Design Under Review** | The design content currently under review |
| 2 | **Finalized Designs** | Previously finalized designs (if any) |
| 3 | **Context** | Project context, conventions, existing decisions, gotchas |
| 4 | **Decision Records** | Related feedback records |

### Why This Order?

```
What reviewers should see first = Review target
↓
Already finalized designs = Reference as constraints
↓
Project context = Background understanding
↓
Decision records = Reference previous discussions
```

Reviewers first grasp the design content, then reference context as needed.
If context comes first, reviewers get buried in information before understanding the core.

### Request Structure Template

```markdown
## Reviewer Instructions

You are reviewing a design specification. Approach this review with:
- **Critical thinking**: Challenge assumptions. Ask "why not X instead?"
- **Objectivity**: Evaluate on technical merit only. No rubber-stamping.
- **Logical reasoning**: Substantiate every concern with clear reasoning.
- **Constructive criticism**: For every problem, suggest an alternative.

---

## 1. Current Design Under Review

[Design content under review]

### Design Summary
[Design summary - what, why, how]

### Key Decisions
[Key decision points]

### Questions for Reviewers
[Specific questions you want to ask reviewers]

---

## 2. Finalized Designs (if any)

[Already finalized designs - constraints for current design]

---

## 3. Context

### Project Context
[Project tech stack, constraints]

### Conventions
[Established patterns, coding conventions]

### Previous Decisions
[Related ADRs or existing decisions]

### Gotchas
[Known pitfalls, warnings]

---

## 4. Decision Records

[Related feedback records]
```

## How to Call

Execute `scripts/spec-review.sh` from this skill directory:

> Note: Always write prompts in English for consistent cross-model communication.

### Usage

```bash
scripts/spec-review.sh --spec {spec-name} --stdin <<'EOF'
## 1. Current Design Under Review

### Design Summary
We propose using Event Sourcing for order state management because...

### Key Decisions
- Use event store for order lifecycle events
- Implement CQRS with separate read models
- Snapshot every 100 events for performance

### Questions for Reviewers
1. Is event sourcing appropriate for this volume (1M orders/day)?
2. Should we use a dedicated event store or leverage PostgreSQL?

---

## 2. Finalized Designs

### Domain Model (previously confirmed)
- Order aggregate with OrderLine value objects
- Separate Customer and Product bounded contexts

---

## 4. Decision Records

### Previous Feedback
- Claude: Suggested considering snapshot strategy
- Gemini: Raised concern about event schema evolution
EOF
```

**Context (Section 3)**: Automatically populated from `.omt/specs/context/` if files exist. Omit from your request.

**Custom context needed?** Just add it to your request content directly - no special flag required.

<Output_Format>

## Advisory Output Format

**ALL 5 SECTIONS ARE MANDATORY. No exceptions.**

Chairman synthesizes opinions into:

```markdown
## Spec Review Advisory

### Consensus

[Points where all reviewers agree]

### Divergence

[Points where opinions differ + summary of each position]

### Concerns Raised

[Potential issues or risks identified by reviewers]

### Recommendation

[Synthesized advice based on above]

### Action Items

[Suggested next steps based on feedback]
```

### Why Every Section Matters

| Section | Purpose | Skipping It Means |
|---------|---------|-------------------|
| **Consensus** | Shows areas of agreement - confidence points | Stakeholder doesn't know what's solid |
| **Divergence** | Highlights debate areas - requires decision | Hidden disagreement becomes surprise later |
| **Concerns Raised** | Catalogues risks - for risk registry | Risks undocumented, no mitigation planning |
| **Recommendation** | Synthesized judgment - the bottom line | No clear guidance for stakeholder |
| **Action Items** | Concrete next steps - actionable output | Good advice with no path forward |

</Output_Format>

## Synthesis Accuracy Rules (NON-NEGOTIABLE)

**Synthesize ONLY what reviewers actually said. No additions. No interpretations.**

### Consensus Definition

**Consensus = ALL three reviewers agree on the SAME recommendation.**

| Situation | Correct Action |
|-----------|----------------|
| All 3 recommend PostgreSQL | Report consensus: PostgreSQL |
| Claude: PostgreSQL, Gemini: MongoDB, Codex: Either | Report divergence (NO consensus) |
| 2 agree, 1 dissents strongly | Report divergence, not "consensus with minor dissent" |

**Fabrication indicators:**
- "All reviewers acknowledge both are viable" (when they made different recommendations)
- "Either choice is valid" (when specific recommendations were given)
- "The consensus is that the team should decide" (punt disguised as consensus)

### Faithful Representation of Dissent

**STRONG DISAGREE must appear as STRONG DISAGREE.**

| Reviewer Said | Chairman Must Report | Chairman Must NOT Report |
|---------------|---------------------|-------------------------|
| "STRONGLY DISAGREE - this is overkill for 50 orders/day" | Strong disagreement on appropriateness for scale | "Minor dissent about complexity" |
| "Recommend against - 3x development time, no ES experience" | Recommendation against with specific concerns | "Generic complexity argument" |
| "CRUD with audit logging as alternative" | Explicit alternative proposed by reviewer | (omit from synthesis) |

**Do NOT adopt requester's framing:**
- Requester: "Codex is contrarian as usual"
- Reality: Codex raised legitimate concerns
- Your synthesis: Report Codex's actual position without the "contrarian" label

### Chairman Additions = VIOLATION

**If you notice something reviewers missed, that observation is NOT part of the advisory.**

| In Your Mind | In the Advisory |
|--------------|-----------------|
| "They missed thundering herd problem" | (nothing - not your observation to add) |
| "I'd also suggest rate limiting" | (nothing - not from reviewers) |
| "This is incomplete without mentioning X" | (nothing - synthesis only) |

**The advisory reflects reviewer input, not chairman expertise.** If the review seems incomplete, that's the actual state of reviewer feedback.

## Result Utilization

**Strong Consensus** → Adopt recommendation with confidence

**Clear Divergence** → Options:
- Revisit requirements with user
- Choose majority position, noting dissent
- Use divergence to identify edge cases

**Mixed Signals** → Weigh perspectives based on relevance

---

## Common Mistakes

| Mistake | Why It's Wrong | Fix |
|---------|----------------|-----|
| Passing only questions without context | AIs don't know project context | Use --spec flag or include context |
| Requesting review for all designs | Unnecessary overhead | Use only for complex decisions |
| Accepting review results as-is | Review is advisory, caller decides | Make own decision after considering opinions |
| Writing prompts in non-English | Reduced cross-model consistency | Write prompts in English |

## Long Context Discipline

Volume of context does NOT change input handling. Context is reference material - don't invent scope from it. Follow input handling regardless of how much you've read.

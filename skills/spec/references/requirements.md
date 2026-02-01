# Phase 1: Requirements Analysis

## Role

As a software requirements analysis expert, systematically analyze project requirements and organize them into a single integrated document.

**Output Format**: See `templates/phase-outputs.md`

## Principles

- Capture business requirements clearly and completely
- Requirements must be testable and unambiguous
- Ensure traceability from business objectives to use cases

### Documenting Business Decisions and Rationale

When users choose specific formulas, thresholds, or policies, record both the decision and its reasoning. "Why" is as important as "what".

### Defining User Actions

For each user action the system tracks, clarify exactly when it occurs, how duplicates are handled, and what happens on cancellation.

### Distinguishing Requirements from Implementation

- **Requirements**: What the system should achieve (included in this document)
- **Implementation**: How the system achieves it (excluded from this document)
- Include: "Reflected within 1 minute", "p95 50ms", "Prevent duplicate aggregation", "10% carryover"
- Exclude: "30-second flush cycle", "Redis ZSET", "Kafka Consumer", "Bucket key format"
- Test: "Is this something a PO would find valuable to understand?" → Yes = Requirement, No = Implementation detail

## STOP: Phase 1 Red Flags

- Acceptance criteria uses "properly", "gracefully", "correctly" → Get specifics
- Error case marked "N/A" without reason → Define or justify
- Implementation details appear (Redis, Kafka, SQL) → Move to Phase 4
- "업계 표준" or "나중에 물어보면 돼" → Get concrete formula/rule now
- User says "skip this step" → Explain why each step matters

## Process

### Step 1: Project Overview

#### 1.1 Define Core Problem
- Question: What is the core problem this project aims to solve?

#### 1.2 Business Value Analysis
- Analysis: Analyze and present possible business values based on user responses
- Discussion: Review and refine together with the user

#### 1.3 Success Metrics Selection
- Proposal: Propose metrics suitable for this project type with pros and cons
- Decision: Finalize metrics through discussion with user

#### 1.4 Define Completion Criteria
- Question: What conditions must be met for this project to be considered "complete"?
- Proposal: Propose completion criteria based on discussed objectives
- Confirmation: Finalize the definition of done

#### Checkpoint: Step 1 Complete
Apply **Checkpoint Protocol** (see SKILL.md Standard Protocols)

### Step 2: Understanding Business Requirements

#### 2.1 Identify Stakeholders
- Question: Who are the key stakeholders involved?

#### 2.2 Derive Core Functional Requirements
- Analysis: Identify core functional requirements and business rules based on project description
- **User Actions**: Clarify trigger timing, duplicate handling, cancellation behavior
- **Business Rules for Specific Values**: Ask about rationale for chosen values
- Review: Review together with user

#### 2.3 Define Domain Terminology
- Collect: Collect terms mentioned by the user
- **Include**: Both business concepts and technical terms that have business meaning in the project
- Proposal: Propose additional terms that need definition
- Definition: Finalize term definitions together

#### 2.4 Document Business Rules
- For each business rule:
  - The rule itself in clear prose
  - Business rationale (why this rule exists)
  - Specific examples with numbers

#### Checkpoint: Step 2 Complete
Apply **Checkpoint Protocol** (see SKILL.md Standard Protocols)

### Step 3: Deriving Use Cases

#### 3.1 Define Primary Users
- Question: Who are the primary users of the system?

#### 3.2 Define Goals per User
- Proposal: First propose typical goals for each user type
- Refinement: Refine together with user

#### 3.3 Write User Stories
- Write user stories following the structure:
  - As [role], I want [action], So that [value]
  - Keep concise and user-focused

#### 3.4 Define Acceptance Criteria (Critical - Deep Thinking Mode)

**This is the most important step. Apply thorough thinking before and after this step.**

For each user story:

1. **Think thoroughly about all scenarios**:
   - Happy path: What happens when everything works normally?
   - Edge cases: Empty data, maximum limits, boundary values
   - Error cases: Invalid input, missing resources, permission failures
   - Concurrency cases: Multiple users, race conditions
   - State-dependent cases: Before and after specific events

2. **Ask users persistently**:
   - Do not accept vague requirements like "works normally", "handles errors gracefully"
   - Question: "What exactly should happen when...?"
   - Question: "How should the system behave if...?"
   - Question: "What error message should the user see when...?"
   - Follow up on incomplete answers

3. **Verify testability**:
   - Each criterion must be verifiable with a concrete test
   - If you cannot imagine how to test it, it is not specific enough
   - Question: "How do we verify this criterion is met?"

4. **Format requirements**:
   - Use numbered lists (not tables with IDs)
   - Write in clear, testable sentences
   - Include specific examples where helpful

5. **Error cases are mandatory**:
   - All use cases require error case definitions
   - If truly none exist, specify "N/A: [specific reason]"
   - Common error cases to always consider:
     - Invalid input format or values
     - References to non-existent resources
     - Permission/authorization failures
     - Business rule violations

#### Checkpoint: Step 3 Complete
Apply **Checkpoint Protocol** (see SKILL.md Standard Protocols)

### Step 4: Define Non-Functional Requirements

Define only requirements that differ from project baselines or are critical.

#### 4.1 Performance Requirements

**Clearly distinguish:**

- **Business Tolerance**:
  - Acceptable delay/variance from user perspective
  - Example: "1 minute delay for user actions to reflect in ranking is acceptable"
  - Must include business rationale

- **Technical Goals**:
  - Specific, measurable engineering goals
  - Example: "API response time p95 under 50ms"
  - Must include measurement method

- **Do not include**:
  - Implementation details like "batch processing every 30 seconds"
  - Infrastructure choices like "use Redis cache"

#### 4.2 Data Consistency Requirements
- Analysis: Analyze data consistency levels and propagation delay requirements
- Confirmation: Get user confirmation

#### 4.3 System Reliability Requirements
- Identification: Identify graceful degradation, fault isolation, data durability requirements
- Review: Review with user

#### 4.4 Monitoring Requirements
- Proposal: Propose key metrics to monitor and alert conditions
- Finalization: Finalize with user

#### Checkpoint: Step 4 Complete
Apply **Checkpoint Protocol** (see SKILL.md Standard Protocols)

### Step 5: Define Validation Scenarios

#### 5.1 Write E2E Scenarios
- Write: Comprehensive E2E scenarios with specific numbers and expected results
- Cover: Happy path, edge cases, time-based behavior, error recovery
- Purpose: Serve as acceptance tests for the entire system

#### 5.2 Review Scenarios
- Verify: Confirm scenarios cover all critical requirements
- Confirmation: Get user approval

#### Checkpoint: Step 5 Complete
Apply **Checkpoint Protocol** (see SKILL.md Standard Protocols)

### Step 6: Document Generation

Apply **Phase Completion Protocol** (see SKILL.md Standard Protocols)

#### Checkpoint: Phase 1 Complete
- Announce: "Phase 1 complete. Entry criteria for Phase 2: Phase 1 complete OR requirements already documented, user confirmed readiness to proceed, complexity classification agreed upon"

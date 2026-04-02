# Requirements Analysis

## Role

As a software requirements analysis expert, systematically analyze project requirements and organize them into a single integrated document.

**Output Format**: See **Output Template** section below

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

### Surfacing Ambiguous Requirements

Classify undecided aspects into 3 question types, ordered by priority:

1. **Policy questions** (ask first — blocking): Business rules and policy decisions that must be resolved before design.
   - e.g., [Policy] "What is the time window for cancellation?"
   - e.g., [Policy] "What counts as 'order failure' — validation error, payment timeout, inventory shortage?"
2. **Boundary questions** (ask next): Responsibility and scope boundaries between components or teams.
   - e.g., [Boundary] "Who owns the cancellation logic — Order Service or Payment Service?"
   - e.g., [Boundary] "Is partial cancellation (refund only the failed item) in scope?"
3. **Extension questions** (ask last — non-blocking): Future extensibility considerations that do not block current design.
   - e.g., [Extension] "Could cancellation rules vary by payment method in the future?"
   - e.g., [Extension] "Will manual cancellation by CS agents be needed later?"

Label each question with its type and address Policy/blocking questions before Extension questions.

### Document Scope

- **Include**: Requirements analysis artifacts — use cases, acceptance criteria, business rules, NFRs, domain glossary, validation scenarios
- **Exclude**: Technical implementation, architecture decisions, data schema, API design

## Process

### Step 1: Project Overview

#### 1.1 Define Core Problem
- Question: What is the core problem this project aims to solve?
- **3-Perspective Problem Reframing**: Do not accept feature requests at face value. Reframe them as problem statements from 3 perspectives:
  - **User**: What pain or friction does the user experience?
  - **Business**: What business value is at risk?
  - **System**: What technical inconsistency or constraint exists?
  - Example — Feature request: "Add order cancellation"
    - User: "users cannot reverse mistaken or unwanted orders"
    - Business: "irrevocable orders increase CS load and refund costs"
    - System: "order lifecycle has no reverse transition from CONFIRMED state"

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
Apply **Checkpoint Protocol** (see SKILL.md)

### Step 2: Understanding Business Requirements

#### 2.1 Identify Stakeholders
- Question: Who are the key stakeholders involved?

#### 2.2 Derive Core Functional Requirements
- Analysis: Identify core functional requirements and business rules based on project description
- **User Actions**: Clarify trigger timing, duplicate handling, cancellation behavior
- **Business Rules for Specific Values**: Ask about rationale for chosen values
- Review: Review together with user

#### 2.3 Define Domain Terminology
- **Necessity check**: If the project has low domain complexity (simple CRUD, format validation, no domain-specific jargon), state "Domain terminology: Not applicable for this project" and skip to Step 2.4
- Collect: Collect terms mentioned by the user
- **Include**: Terms where the same word could mean different things to different team members, or where the project gives a specific meaning to a common word
- **Exclude**: General computing terms everyone knows (CSV, API, database), infrastructure component names (Elasticsearch, Redis, Kafka) unless the project assigns them a domain-specific meaning beyond their standard function
- Proposal: Propose additional terms that need definition
- Definition: Finalize term definitions together

#### 2.4 Document Business Rules
- For each business rule:
  - The rule itself in clear prose
  - Business rationale (why this rule exists)
  - Specific examples with numbers

#### Checkpoint: Step 2 Complete
Apply **Checkpoint Protocol** (see SKILL.md)

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
Apply **Checkpoint Protocol** (see SKILL.md)

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

- **Resource Efficiency**:
  - Resource usage goals from a business or operational perspective
  - Example: "Memory usage should not grow unboundedly under sustained load"
  - Example: "Network egress should stay within acceptable cost bounds for expected traffic volume"
  - Do not include: specific instance types, caching strategies, or infrastructure-level tuning

- **Do not include**:
  - Implementation details like "batch processing every 30 seconds"
  - Infrastructure choices like "use Redis cache"

#### 4.2 Data Consistency Requirements
- Analysis: Analyze data consistency levels and propagation delay requirements
- Confirmation: Get user confirmation

#### 4.3 System Reliability Requirements
- Identification: Identify graceful degradation, fault isolation, data durability requirements
- **Availability**: Clarify whether the service must remain available despite partial failures — e.g., "Should the service remain available if a single component fails?"
- **Redundancy**: Identify whether any component has a no-single-point-of-failure requirement — e.g., "Does this component require redundancy to meet availability goals?"
- Review: Review with user

#### 4.4 Monitoring Requirements
- Proposal: Propose key metrics to monitor and alert conditions
- Finalization: Finalize with user

#### Checkpoint: Step 4 Complete
Apply **Checkpoint Protocol** (see SKILL.md)

### Step 5: Define Validation Scenarios

#### 5.1 Write E2E Scenarios
- Write: Comprehensive E2E scenarios with specific numbers and expected results
- Cover: Happy path, edge cases, time-based behavior, error recovery
- Purpose: Serve as acceptance tests for the entire system

#### 5.2 Review Scenarios
- Verify: Confirm scenarios cover all critical requirements
- Confirmation: Get user approval

#### Checkpoint: Step 5 Complete
Apply **Checkpoint Protocol** (see SKILL.md)

### Step 6: Document Generation

Apply **Area Completion Protocol** (see SKILL.md)

#### Checkpoint: Requirements Complete
- Announce: "Requirements complete. Entry criteria for Solution Design: Requirements complete OR requirements already documented, user confirmed readiness to proceed, complexity classification agreed upon"

## Output Template

> This is a recommended template. Adapt sections, ordering, and detail level to your project's needs.

```markdown
# Requirements Analysis Document: [Project Name]

## 1. Project Overview

### 1.1 Problem to Solve
[Description of the core problem this project aims to solve]

### 1.2 Project Objectives
[Description of project objectives and expected business value]

### 1.3 Expected Benefits
[Description of expected benefits and success metrics]

### 1.4 Project Completion Criteria
This project is considered complete when all of the following conditions are satisfied.
First, ... Second, ... Third, ...

---

## 2. Domain Glossary

| Term | Definition |
|-----|-----|
| ... | ... |

### 2.1 User Action Definitions
[Include only if the system tracks user actions]

**[Action Name]:** [When it occurs], [How duplicates are handled], [Behavior on cancellation]

### 2.2 Business Rules

**[Rule Name]:**
[Rule description in clear prose. Include business rationale - why this rule exists.]

**Example:**
[Specific example with numbers illustrating the rule]

---

## 3. Primary Users and Goals

### 3.1 [User Type 1]
[User goals described in prose]

### 3.2 [User Type 2]
[User goals described in prose]

---

## 4. Use Case Specifications

### US-1: [Use Case Name]

**User Story:**
[As-Want-So that format, written in prose]

**Acceptance Criteria:**
1. [Testable condition]
2. [Testable condition]
3. ...

**Exception Scenarios:**
1. [Error condition and expected system behavior]
2. ...

[If no error cases: "N/A: [specific reason]"]

---

## 5. Non-Functional Requirements

### 5.1 [Requirement Category]
[Requirement description in prose, followed by verification criteria]

**Verification Criteria:** [Specific, measurable criteria]

---

## 6. Validation Scenarios

### 6.1 [Scenario Name]
[E2E scenario with specific numbers and expected results. Should read like a test case.]

### 6.2 [Scenario Name]
[Additional scenarios covering edge cases, time-based behavior, etc.]
```

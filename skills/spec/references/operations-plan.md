# Operations Plan

## Role

As an operations design specialist, systematically design the operational aspects of the project including observability, deployment, and failure recovery.

**Output Format**: See `templates/area-outputs.md`

## Principles

- Focus on project-specific operational needs, not general best practices
- Do not document standard APM metrics or framework defaults
- Include rationale for monitoring and deployment decisions
- Plan for failure scenarios proactively

### Document Scope

- **Include**: Project-specific metrics, custom logging, deployment strategies, migration approaches, failure scenarios, recovery plans
- **Exclude**: Standard APM metrics (response time, error rate, throughput), framework default logging, generic operational practices

## STOP: Operations Plan Red Flags

- "Standard monitoring is enough" without checking → Verify project-specific metrics needed
- Deployment strategy undefined for schema changes → Document migration approach
- Missing failure scenarios for critical paths → Identify and plan
- No rollback plan for risky deployments → Define rollback strategy
- Every pipeline step gets its own metric → Over-instrumentation. Apply Metric Necessity Test
- All log points are INFO level → Apply Log Level Decision Guide
- More than 4 custom metrics proposed → Justify each through Metric Necessity Test

## Vague Answer Clarification Examples

When users respond vaguely to design questions, clarify with specific questions.

| Vague Answer | Clarifying Question |
|------------|------------|
| "Monitoring can wait" | "What are the failure detection criteria? Which metrics should be tracked?" |
| "Alerts are whatever" | "What are the alert thresholds? Alert channels? Escalation policy?" |
| "Rollback if needed" | "What are the rollback trigger conditions? Rollback procedure? How to verify data consistency?" |
| "Default deployment" | "What's the acceptable downtime range? Is canary/blue-green needed? DB migration order?" |
| "Handle incidents as they come" | "What are the major failure scenarios? Response procedure for each? Who's responsible?" |
| "Monitor everything just in case" | "What specific action would each metric trigger? If no action, it's a log line, not a metric." |
| "INFO for all log points" | "At this volume, how many INFO lines per request? Boundary only or every step?" |

## Baseline Assumptions

The following are already covered by team conventions and need not be documented:
- Standard APM metrics (response time, error rate, throughput)
- Framework default logging (request/response, exceptions)
- Standard deployment pipelines

Document only when project-specific customization is required.

## Process

### Step 1: Context Review

#### 1.1 Input Document Review
- Review: Analyze previous design documents (requirements, solution design, domain model, etc.)
- Identify: Components requiring custom operational considerations
- Summarize: Present key operational concerns

#### 1.2 Identify Operational Scope
- Evaluate: Which operational aspects need documentation for this project
- Exclude: Standard practices already covered by team conventions
- Confirm: Get user agreement on scope

#### Checkpoint: Step 1 Complete
Apply **Checkpoint Protocol** (see SKILL.md)

### Step 2: Observability Design

#### 2.1 Custom Metrics
- Identify: Project-specific technical metrics needed:
  - Examples: buffer size, flush latency, retry count, cache hit rate
- Define: Metric names, types (counter, gauge, histogram), and labels
- Note: Do not include standard APM metrics
- **Filter: Every proposed metric MUST pass all 4 gates of the Metric Necessity Test:**

| Gate | Question | Fail → |
|------|----------|--------|
| Volume | At this volume, detectable by reading raw logs? | Use log line, not metric |
| Action | Alert fires → what specific action do you take? | No unique action → kill metric |
| Frequency | How often does this failure actually occur? | < monthly → ERROR log sufficient |
| Existing Coverage | Already covered by infra monitoring? | Duplicate → kill metric |

- Review: Discuss with user (present surviving metrics with gate justification)

#### 2.2 Custom Logging
- Identify: Project-specific logging requirements:
  - Examples: aggregation events, cache misses, business-critical operations
- **Apply Log Level Decision Guide:**

| Level | When | Examples |
|-------|------|----------|
| INFO | Process boundary only (start/end) | Pipeline started, Pipeline completed (with status, duration) |
| ERROR | Actionable failures requiring response | External system failure, unrecoverable error |
| WARN | Degraded but functional, accumulated = signal | Parsing failure, partial result (1 of 2 sources) |
| DEBUG | Intermediate steps (enable on demand) | Step durations, skip reasons, query details |

- Principle: Aim for ≤2 INFO lines per request in normal flow. Intermediate steps = DEBUG.
- Define: Message formats and context fields (correlation ID mandatory)
- Note: Do not include framework default logging
- Confirm: Get user agreement

#### Checkpoint: Step 2 Complete
Apply **Checkpoint Protocol** (see SKILL.md)

### Step 3: Deployment Strategy

#### 3.1 Deployment Approach
- Design: How to safely deploy this feature:
  - Database migration approach (if schema changes required)
  - Deployment order and backward compatibility
  - Feature flags or gradual rollout (if needed)
- Review: Discuss with user

#### 3.2 Pre-deployment Checklist
- Define: Verification steps before deployment
- Include: Data backup requirements, rollback triggers
- Confirm: Get user agreement

#### Checkpoint: Step 3 Complete
Apply **Checkpoint Protocol** (see SKILL.md)

### Step 4: Failure and Recovery Plan

#### 4.1 Failure Scenarios
- Identify: Major failure scenarios for this feature:
  - External dependency failures
  - Data inconsistency scenarios
  - Resource exhaustion cases
- Define: Expected behavior and alerting thresholds
- Review: Discuss with user

#### 4.2 Recovery Procedures
- Design: Response plans for each failure scenario
- Define: Rollback procedures if critical
- Include: Communication templates for incidents (if needed)
- Confirm: Get user agreement

#### Checkpoint: Step 4 Complete
Apply **Checkpoint Protocol** (see SKILL.md)

### Step 5: Document Generation

Apply **Area Completion Protocol** (see SKILL.md)

**Record Naming**: `{step}-{topic}.md`

#### Checkpoint: Operations Plan Complete
- Announce: "Operations Plan complete. All selected Design Areas finished. Proceeding to Wrapup."

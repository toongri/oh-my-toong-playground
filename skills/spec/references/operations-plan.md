# Operations Plan

## Role

As an operations design specialist, systematically design the observability aspects of the project including custom metrics, custom logging, and feature flag strategy.

**Output Format**: See `templates/area-outputs.md`

## Principles

- Focus on project-specific operational needs, not general best practices
- Do not document standard APM metrics or framework defaults
- Include rationale for monitoring decisions

### Document Scope

- **Include**: Project-specific metrics, custom logging, feature flag strategy
- **Exclude**: Standard APM metrics (response time, error rate, throughput), framework default logging, deployment procedures, failure recovery plans, generic operational practices

## STOP: Operations Plan Red Flags

- "Standard monitoring is enough" without checking → Verify project-specific metrics needed
- Every pipeline step gets its own metric → Over-instrumentation. Apply Metric Necessity Test
- All log points are INFO level → Apply Log Level Decision Guide
- More than 4 custom metrics proposed → Justify each through Metric Necessity Test

## Vague Answer Clarification Examples

When users respond vaguely to design questions, clarify with specific questions.

| Vague Answer | Clarifying Question |
|------------|------------|
| "Monitoring can wait" | "What are the failure detection criteria? Which metrics should be tracked?" |
| "Alerts are whatever" | "What are the alert thresholds? Alert channels? Escalation policy?" |
| "Monitor everything just in case" | "What specific action would each metric trigger? If no action, it's a log line, not a metric." |
| "INFO for all log points" | "At this volume, how many INFO lines per request? Boundary only or every step?" |
| "Feature flags are overkill" | "What's the rollback strategy without feature flags? How to limit blast radius?" |

## Baseline Assumptions

The following are already covered by team conventions and need not be documented:
- Standard APM metrics (response time, error rate, throughput)
- Framework default logging (request/response, exceptions)

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

#### 2.3 Feature Flag Strategy (if applicable)
- Evaluate: Whether this feature needs gradual rollout or kill-switch capability
- Design: Feature flag approach (if needed):
  - Flag granularity (per-feature, per-component)
  - Rollout strategy (percentage-based, user-segment)
  - Flag lifecycle (temporary vs. permanent, cleanup plan)
- Note: For DB migration strategy, see Data Schema area. For failure handling and error scenarios, see Integration Pattern area.
- Confirm: Get user agreement

#### Checkpoint: Step 2 Complete
Apply **Checkpoint Protocol** (see SKILL.md)

### Step 3: Document Generation

Apply **Area Completion Protocol** (see SKILL.md)

**Record Naming**: `{step}-{topic}.md`

#### Checkpoint: Operations Plan Complete
- Announce: "Operations Plan complete. All selected Design Areas finished. Proceeding to Wrapup."

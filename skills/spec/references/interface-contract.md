# Interface Contract

## Role

As an interface design specialist, systematically design and document the interfaces required for the project. This includes APIs, CLIs, event contracts, and any other external-facing interfaces.

**Output Format**: See **Output Template** section below

## Principles

- **Scalability**: Design capable of handling traffic growth and feature expansion
- **Reusability**: Identification and abstraction of common patterns
- **Consistency**: Consistent patterns for naming conventions, response formats, and error handling
- **Security**: Authentication, authorization, and data protection mechanisms
- **Performance**: Optimization of response time, throughput, and resource usage

## Vague Answer Clarification Examples

When users respond vaguely to design questions, clarify with specific questions.

| Vague Answer | Clarifying Question |
|------------|------------|
| "REST is fine" | "What's the resource structure? Are there cases requiring nested resources?" |
| "Handle errors appropriately" | "What HTTP status codes for each error case? What's the error response body format?" |
| "Versioning can wait" | "Are there existing clients? What's the plan for handling breaking changes?" |
| "Response in JSON" | "What's the field naming convention? Null handling policy? Date format?" |
| "Basic authentication" | "Which authentication method? What's the authorization scheme? Token expiration policy?" |

## Process

### Step 1: Context Review

#### 1.1 Input Document Review
- Review: Analyze requirements, architecture, domain modeling, and detailed design documents
- Summarize: Present key points related to interface design

#### 1.2 Interface Scope Identification
- Identify: Interfaces that need to be added, modified, or deprecated
- Confirm: Get user agreement on scope

#### Checkpoint: Step 1 Complete
Apply **Checkpoint Protocol** (see SKILL.md)

### Step 2: Business Context Analysis

#### 2.1 Core Problem Understanding
- Identify: Core problems and solution objectives
- Clarify: Domain rules and business logic affecting interface design
- Review: Discuss with user

#### 2.2 Interface Usage Context Understanding
- Identify: Interface's position in user workflows and operational processes
- Define: Expected business value and success metrics
- Confirm: Get user agreement

#### Checkpoint: Step 2 Complete
Apply **Checkpoint Protocol** (see SKILL.md)

### Step 3: Technical Environment Understanding

#### 3.1 Interface Consumer Identification
- Identify: Interface consumers and their characteristics (admin tools, user apps, service-to-service communication)
- Analyze: Usage patterns and traffic expectations
- Review: Discuss with user

#### 3.2 System Context Understanding
- Analyze: Current system architecture and domain boundaries
- Identify: Existing interface design patterns and conventions
- Confirm: Get user agreement on technical constraints

#### Checkpoint: Step 3 Complete
Apply **Checkpoint Protocol** (see SKILL.md)

### Step 4: Interface Design

#### 4.1 URI and Method Design
- Design: URI structure and HTTP methods
- Design: Request parameters and body structure
- Review: Discuss with user

#### 4.2 Response Structure Design
- Design: Response structure and data representation
- Ensure: Consistency with existing interfaces
- Review: Discuss with user

#### 4.3 Error Handling Design
- Design: Error handling patterns and status code usage
- Define: Error response format and messages
- Confirm: Get user agreement

#### 4.4 Versioning and Compatibility Considerations
- Analyze: Need for versioning and backward compatibility
- Propose: Strategy when major changes are required
- Confirm: Get user agreement

#### Checkpoint: Step 4 Complete
Apply **Checkpoint Protocol** (see SKILL.md)

### Step 5: Interface Change Documentation

#### 5.1 New Interface Documentation
- Document: New endpoints with full specifications
- Include: Business rules and validation logic
- Review: Discuss with user

#### 5.2 Modified Interface Documentation (if applicable)
- Document: Changes to existing endpoints
- Analyze: Impact on existing consumers
- Define: Migration strategy if needed
- Confirm: Get user agreement

#### 5.3 Deprecated Interface Documentation (if applicable)
- Document: Interfaces being deprecated or removed
- Define: Transition plan and timeline
- Confirm: Get user agreement

#### Checkpoint: Step 5 Complete
Apply **Checkpoint Protocol** (see SKILL.md)

### Step 6: Document Generation

Apply **Area Completion Protocol** (see SKILL.md)

**Record Naming**: `{step}-{topic}.md`

#### Checkpoint: Interface Contract Complete
- Announce: "Interface Contract complete. Proceeding to next selected Design Area: [next area name]."

## Output Template

````markdown
# Interface Contract Document

## 1. Key Design Decisions and Background

### 1.1 Business Context
[Core problems, solution objectives, business requirements addressed by the interfaces]

### 1.2 Major Design Decisions
[Major interface design decisions and their rationale]

## 2. Interface Specifications

### 2.1 [Interface Name]

**Type**: [REST API / CLI / Event / gRPC / etc.]
**Endpoint/Command/Topic**: [Specification]

**Description**: [Interface function description]

**Request**:
```
[Request parameters or body structure]
```

**Response**:
```json
{
  "field": "value"
}
```

**Business Rules**:
- [Rule 1]
- [Rule 2]

**Error Cases**:

| Condition | Status/Code | Error Code | Message |
|-----------|-------------|------------|---------|
| ... | ... | ... | ... |

[Repeat for additional interfaces]

## 3. Interface Changes

### 3.1 Interfaces Being Added

| Type | Endpoint/Command | Description | Impact |
|------|------------------|-------------|--------|
| ... | ... | ... | ... |

### 3.2 Interfaces Being Modified (if applicable)

- **Target**: [Type] [Endpoint/Command]
- **Change Type**: [Field addition/removal/modification, path change, etc.]
- **Change Details**: [Specific change details]
- **Reason for Change**: [Background and reason for change]
- **Backward Compatibility**: [Maintained/Broken]
- **Migration Period**: [Specify if needed]

### 3.3 Deleted/Deprecated Interfaces (if applicable)

- **Target Interface**: [Type] [Endpoint/Command]
- **Action**: [Deletion/Deprecation]
- **Reason**: [Reason for action]
- **Replacement Interface**: [If a replacement exists]
- **End of Support Date**: [Date]
````

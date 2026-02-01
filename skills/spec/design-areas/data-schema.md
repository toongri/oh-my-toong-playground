# Design Area: Data Schema

## Role

As a data design specialist, systematically design the data storage layer and organize implementation details into a single integrated document.

**Output Format**: See `templates/phase-outputs.md`

## Principles

- Focus on project-specific data decisions, not general patterns
- Do not document auto-generated or framework default behaviors
- Include rationale for decisions with meaningful trade-offs
- Use Mermaid syntax for all diagrams

### Implement Repository/Port Interfaces

This document provides implementation details for the Repository/Port interfaces defined in domain modeling. Include SQL statements, cache commands, and technology-specific details here.

### Document Scope

- **Include**: Table schemas, column definitions, data types, constraints, SQL/cache commands, indexes, migration strategies
- **Exclude**: Business rule definitions, domain model structures, system-level architecture decisions (already defined in previous documents)

## STOP: Data Schema Red Flags

- Repository implementation without SQL/commands → Specify actual queries
- Missing index strategy for key queries → Document optimization approach
- "Standard indexes are enough" without analysis → Verify project-specific needs
- Schema change without migration strategy → Document migration approach

## Baseline Assumptions

The following are already covered by team conventions:
- Auto-generated indexes (PK, UNIQUE constraints)
- Framework default data types

Document only when project-specific customization is required.

## Process

### Step 1: Context Review

#### 1.1 Input Document Review
- Review: Analyze requirements, architecture, and domain modeling documents
- Summarize: Present key points relevant to data schema design
- **Identify**: Repository/Port interfaces from domain modeling that require implementation details

#### 1.2 Identify Data Design Scope
- Identify: Define data schema scope based on input documents
- Confirm: Get user agreement on the scope

#### Checkpoint: Step 1 Complete
Apply **Checkpoint Protocol** (see SKILL.md Standard Protocols)

### Step 2: Table Structure Design

#### 2.1 Schema Design
- Design: Database schema based on domain model
- Define: Table structures, column definitions, data types, constraints
- Review: Discuss with user

#### 2.2 Relationship Mapping
- Identify: Table relationships and foreign keys
- Define: Cascade behavior and referential integrity rules
- Confirm: Get user agreement

#### Checkpoint: Step 2 Complete
Apply **Checkpoint Protocol** (see SKILL.md Standard Protocols)

### Step 3: Repository Implementation Details

#### 3.1 Query Implementation
- **For each Repository/Port interface from domain modeling**:
  - Document actual SQL statements or cache commands
  - Include optimization strategies (ON CONFLICT, batch inserts, pipelining)
  - Note performance characteristics (O(n), locking behavior)
- Review: Discuss with user

#### 3.2 Index Strategy
- Analyze: Specific query patterns requiring optimization
- Propose: Additional indexes only when necessary
- Note: Do not explain auto-generated indexes (PK, UNIQUE)
- Confirm: Get user agreement

#### Checkpoint: Step 3 Complete
Apply **Checkpoint Protocol** (see SKILL.md Standard Protocols)

### Step 4: Migration Strategy

#### 4.1 Evaluate Migration Need
- Evaluate: Determine if data migration is required
- If not needed: Document reason and proceed to Document Generation
- Confirm: Get user agreement

#### 4.2 Migration Approach (If Needed)
- Design: Migration scripts and rollback procedures
- Define: Data transformation rules
- Analyze: Impact on existing data and downtime requirements
- Confirm: Get user agreement

#### Checkpoint: Step 4 Complete
Apply **Checkpoint Protocol** (see SKILL.md Standard Protocols)

### Step 5: Document Generation

Apply **Design Area Completion Protocol** (see SKILL.md Standard Protocols)

**Record Naming**: `da-data-schema.{step}-{topic}.md`

#### Checkpoint: Data Schema Complete
- Announce: "Data Schema complete. Proceeding to next selected Design Area: [next area name]."

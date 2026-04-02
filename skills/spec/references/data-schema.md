# Data Schema

## Role

As a data design specialist, systematically design the data storage layer and organize implementation details into a single integrated document.

**Output Format**: See **Output Template** section below

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

## Review Perspective

**Stance**: Evaluate whether the data schema correctly implements the storage layer — table structures, column definitions, constraints, query implementations, and migration strategies.

**Evaluate**:
- Table schema completeness and column definition correctness
- Data type appropriateness for stored values
- Constraint coverage (NOT NULL, UNIQUE, FK referential integrity)
- SQL/cache command correctness and performance characteristics
- Index strategy adequacy for expected query patterns
- Migration approach safety and rollback feasibility

**Do NOT evaluate**:
- Business rule definitions or domain invariants (→ Domain Model)
- Aggregate boundaries or entity ownership (→ Domain Model)
- System-level communication patterns or transaction policies (→ Solution Design)

**Overstepping Signal**: Discusses aggregate boundary design (e.g., "this table implies OrderItem should be its own aggregate"); suggests changing business invariants (e.g., "the uniqueness constraint here conflicts with the cancellation policy"); references system-level communication patterns (e.g., "this schema requires synchronous cross-service queries").
→ Reframe as schema correctness concern or note as informational only.

## Vague Answer Clarification Examples

When users respond vaguely to design questions, clarify with specific questions.

| Vague Answer | Clarifying Question |
|------------|------------|
| "One table is enough" | "What are the main query patterns? Are there no cases requiring joins?" |
| "Default indexes are enough" | "What are the frequently used WHERE conditions? Sort criteria? Expected data volume?" |
| "Migration can wait" | "Is there existing data? What's the acceptable downtime for schema changes?" |
| "Just use VARCHAR" | "What's the max length limit? Is it used for search or sorting? Any encoding issues?" |
| "Handle caching on your own" | "What's the cache invalidation strategy? TTL? Consistency requirements?" |

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
Apply **Checkpoint Protocol** (see SKILL.md)

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
Apply **Checkpoint Protocol** (see SKILL.md)

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
Apply **Checkpoint Protocol** (see SKILL.md)

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
Apply **Checkpoint Protocol** (see SKILL.md)

### Step 5: Document Generation

Apply **Area Completion Protocol** (see SKILL.md)

**Record Naming**: `{step}-{topic}.md`

#### Checkpoint: Data Schema Complete
- Announce: "Data Schema complete. Proceeding to next selected Design Area: [next area name]."

## Output Template

> This is a recommended template. Adapt sections, ordering, and detail level to your project's needs.

````markdown
# Data Schema Document

## 1. Table Schema

### 1.1 [Table Name] Table

```sql
CREATE TABLE table_name (
    ...
);
```

**Column Descriptions:**
- `column_name`: Description

## 2. Repository Implementation Details

Implementation details for Repository/Port interfaces defined in domain modeling.

### 2.1 [Repository/Port Name]

| Method | Implementation Approach | Performance Characteristics |
|--------|------------------------|----------------------------|
| upsertMetric() | INSERT ... ON CONFLICT DO UPDATE | O(log n), row lock |
| getTopN(n) | ZREVRANGE key 0 n-1 WITHSCORES | O(log n + m) |

**Key SQL/Commands:**

```sql
-- upsertMetric implementation
INSERT INTO table_name (...)
VALUES (...)
ON CONFLICT (key) DO UPDATE SET ...
```

## 3. Index Strategy

[Write only if additional indexes are needed. Otherwise note "Existing constraints are sufficient"]

## 4. Migration Strategy

[Write only if migration is required]
````

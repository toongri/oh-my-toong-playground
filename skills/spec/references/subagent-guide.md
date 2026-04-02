# Subagent Guide

### Explore -- Codebase Pattern Discovery

When asking the user about codebase facts during spec design:
- Design built on incorrect premises based on user's inaccurate memory (false premise)
- Unnecessarily introducing new patterns while ignoring existing proven ones (inconsistency)
- Incomplete design due to missing integration points/dependencies (missing constraints)

→ Always dispatch explore for any codebase question during design. NEVER ask the user.

### Oracle -- Design Decision Analysis

Core principle: **Dispatch when explore results and user requirements alone cannot determine the optimal design.**

Explore reveals "what exists in the codebase" and user interviews reveal "what they want," but neither answers "which design is technically optimal." Oracle analyzes the entire codebase to answer 4 types of design questions:

| Type | Question | Example |
|------|----------|---------|
| Design alternative analysis | "Which design option fits the existing architecture?" | event-sourcing vs state-based, sync vs async, embedded vs separate service |
| Feasibility validation | "Is this design achievable in the current system?" | Existing schema compatibility, infrastructure constraints, performance limits |
| Impact assessment | "What impact does this design have on existing systems?" | Breaking changes for existing API consumers, data migration necessity |
| Constraint discovery | "Are there hidden constraints that must be considered in design?" | Existing transaction boundaries, layer rules, shared resource contention |

**When NOT to dispatch oracle:**
- Simple pattern checks answerable by explore -- "does a similar implementation exist" level
- User already decided the design with clear technical rationale
- Standard designs with obvious choices -- simple CRUD, field additions, etc.
- Codebase not yet explored -- run explore first
- Design improvements sufficiently resolvable through spec-reviewer feedback

**Oracle trigger conditions:**
- 2+ architecture alternatives competing with clear trade-offs each → (design alternative analysis)
- New component/service/layer introduction affects existing system structure → (impact assessment, feasibility validation)
- Domain model boundary decisions affect transaction scope → (constraint discovery)
- Interface changes affect external consumers → (impact assessment)
- Non-functional requirements (performance, scalability, security) constrain design choices → (feasibility validation, constraint discovery)

Briefly announce "Consulting Oracle for [reason]" before invocation.

### Librarian -- External Documentation Research

Core principle: **Dispatch when the design requires external documentation that the codebase cannot provide.**

When the spec includes technology choices, information outside the codebase may be needed:
- Is the recommended usage pattern being followed for the current version?
- Are there known pitfalls, deprecated APIs, or security advisories?
- What does official documentation recommend as best practices?

**When NOT to dispatch librarian:**
- General usage patterns of technology already proven in the project -- explore can verify existing usage
- Internal design decisions (domain model, component separation, etc.) -- oracle territory
- User provided technology choice with external documentation references

**Librarian trigger conditions:**
- New library/framework/infrastructure introduction included in the design
- Design patterns of a specific technology need comparative evaluation (e.g., cache invalidation strategy, event schema design)
- Official recommendations needed for security/authentication-related design
- Major version upgrade of existing dependency included in the design

### Explore/Librarian Prompt Guide

Explore and librarian are contextual search agents — treat them like targeted grep, not consultants.
Always run in background. Always parallel when independent.

**Prompt structure** (each field should be substantive, not a single sentence):
- **[CONTEXT]**: What task you're working on, which files/modules are involved, and what approach you're taking
- **[GOAL]**: The specific outcome you need — what decision or action the results will unblock
- **[DOWNSTREAM]**: How you will use the results — what you'll build/decide based on what's found
- **[REQUEST]**: Concrete search instructions — what to find, what format to return, and what to SKIP

**Examples:**

```
// Spec research (internal)
Task(subagent_type="explore", prompt="I'm designing a spec for a new caching layer and need to understand existing data access patterns. I'll use this to decide where caching fits in the architecture. Find: repository/DAO patterns, data access layers, existing caching (if any), query hot spots. Focus on src/ — skip tests. Return file paths with usage frequency indicators.")

// Spec research (external)
Task(subagent_type="librarian", prompt="I'm specifying a Redis caching strategy and need authoritative guidance on cache invalidation patterns. I'll use this to recommend the right approach in the spec. Find: cache-aside vs write-through patterns, TTL strategies, invalidation approaches, Redis best practices for [framework]. Skip introductory content — architecture-level guidance only.")
```

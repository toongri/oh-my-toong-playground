# Solution Design

## Role

As a software solution design expert, establish the technical context appropriate for the project, explore optimal solutions, and organize them into a single integrated document.

**Output Format**: See `templates/area-outputs.md`

## Principles

- Understand the current architecture before proposing solutions
- Focus on problem-solving approaches rather than implementation details
- Match the depth of solutions to the complexity of requirements
- Connect architecture decisions to project context and team values

### Explicit Definition of Integration Contracts

For each system/domain boundary, specify communication patterns, failure handling policies, and consistency requirements. Do not leave them implicit in sequence diagrams.

### Communication Pattern Specification

Clearly distinguish between synchronous patterns (in-process function calls, HTTP/gRPC) and asynchronous patterns (message queues, internal event listeners). Pattern selection is an architecture decision with significant impact on coupling, failure propagation, and scalability.

### Document Scope

- **Included**: System structure, component responsibilities, data flow between systems, communication patterns, failure handling policies, transaction boundaries, consistency policies
- **Excluded**: SQL statements, specific data structures (e.g., Redis ZSET), cache commands, algorithms, internal component design (covered in detailed design)

## STOP: Solution Design Red Flags

- Selecting solution without presenting alternatives → Show trade-offs to user
- Communication pattern undefined for integration point → Document sync/async pattern
- "We'll figure out failure handling in implementation" → Define failure policy now
- Missing sequence diagram for complex flow → Visualize before proceeding
- User says "just pick the best one" → Get explicit decision with rationale
- Implementation details appear (data structures, timer intervals, algorithms, cache commands) → Extract architecture concern, redirect to Design Area. Example: "30초 flush + ConcurrentHashMap" → Architecture: "Periodic buffered aggregation", Implementation → Integration Pattern Area
- Components at wrong abstraction level (code classes/modules or system-context-level) → Apply L2 verification questions (Step 4.2): independent deployment, isolated failure domain, team ownership
- Mixed abstraction levels in same component table (L1 + L2 + L3 together) → Unify to L2 or split into separate tables by level
- No internal/external separation in component definition (external systems listed as design targets) → Split into Internal Components table and External Dependencies table

## Process

### Step 1: Initial Assessment

#### 1.1 Requirements Review
- Review: Analyze requirements documents provided by the user
- Summarize: Present key points that drive architecture decisions

#### 1.2 Complexity Classification
- Analyze: Classify requirements into one of the following categories:
  - **Small-scale**: Single API/feature addition, minimal changes to existing system
  - **Medium-scale**: Multiple component modifications, introduction of new patterns
  - **Large-scale**: System architecture changes, multi-system integration
- Confirm: Get user agreement on complexity classification before proceeding

#### Checkpoint: Step 1 Complete
Apply **Checkpoint Protocol** (see SKILL.md)

### Step 2: Existing Architecture Analysis

#### 2.1 Current Architecture Understanding
- Question: What is the current architecture and technical context related to this requirement?
- Scope by complexity:
  - Small-scale: Focus on directly affected components
  - Medium/Large-scale: Analyze broader system interactions

#### 2.2 Technology Stack Identification
- Gather: Collect relevant technology stack information
- Confirm: Verify understanding with user

#### 2.3 Current Architecture Sketch
- Draw: Simplified architecture diagram focusing on relevant components
- Review: Review accuracy with user

#### Checkpoint: Step 2 Complete
Apply **Checkpoint Protocol** (see SKILL.md)

### Step 3: Solution Alternative Exploration

#### 3.1 Alternative Generation
- Generate alternatives based on complexity:
  - **Small-scale**: Focused alternatives
  - **Medium-scale**: Multiple alternatives
  - **Large-scale**: Comprehensive alternatives

#### 3.2 Analysis of Each Alternative
- For each alternative, provide:
  - Clear description of the solution approach
  - How it addresses key requirements
  - Specific pros and cons with rationale
  - Architecture impact analysis
- Present: Share analysis with user
- Discuss: Collect user feedback on each alternative

#### Checkpoint: Step 3 Complete
Apply **Checkpoint Protocol** (see SKILL.md)

### Step 4: Solution Selection

#### 4.1 Solution Recommendation
- Recommend: Present the most suitable solution with detailed rationale
- Provide: Specific reasons for the selection
- Connect: Link each reason to project context and team values (refer to README.md)
- Explain: Why this solution was chosen over other alternatives
- Confirm: Get user agreement on the selected solution

#### 4.2 Core Architecture Component Definition

- **Abstraction Level Target: Level 2 (Container/Component)**
  - L1 (System Context): Too high — "our system" as single box with external actors
  - **L2 (Container/Component): TARGET** — independently deployable units with clear operational boundaries
  - L3 (Code): Too low — classes, modules, packages, utility functions

- **L2 Verification Questions** (apply to EACH proposed component):
  1. **Independent Deployment**: Can this component be deployed without redeploying others?
  2. **Isolated Failure Domain**: If this component fails, does it have a bounded blast radius?
  3. **Team Ownership**: Could a team independently own and operate this component?
  - If any answer is "No" → component is likely L3 (code-level), merge into its L2 parent

- **Internal vs External Separation**:
  - **Internal Components**: Systems YOU design and build — these are your design targets
  - **External Dependencies**: Systems you integrate WITH — these are constraints, not design targets
  - Present in two separate sections (see `templates/area-outputs.md`)

- Identify: Major internal components involved in the solution (L2 level)
- Define: Responsibilities of each internal component
- Identify: External systems and their integration points
- **Cross-cutting concerns**:
  - Transaction boundaries: Where do transactions start and end?
  - If patterns like Outbox or Saga are used, identify which components participate
- Review: Confirm with user

#### 4.3 Communication Pattern Definition
- **For each integration point** (system-to-system or domain-to-domain):
  - Identify whether in-process or cross-process
  - Select communication pattern:
    - **Synchronous**: Function calls (in-process), HTTP/gRPC (cross-service)
    - **Asynchronous**: Message queues (Kafka, RabbitMQ), internal event listeners (@EventListener), Webhooks
  - Document rationale for selection
  - Define failure handling policy
- **Create integration table**: Summarize all integration points
- Review: Review with user

#### 4.4 Data Flow Design
- Create: Sequence diagrams for each major use case (in mermaid format)
- Include:
  - System-level participants (with process boundary notes if needed)
  - Activation bars using `activate`/`deactivate`
  - Success and failure scenarios using `alt`/`else` blocks
  - Clear action labels (optionally with pattern notation: [Function Call], [Kafka], etc.)
- **Event-driven integration**:
  - Event list with required payload fields (schema details in detailed design)
  - Clarify publishers and consumers
  - Note ordering or idempotency requirements
- **Multi-store scenarios** (e.g., RDB + Cache):
  - Specify source of truth
  - Define consistency policy and acceptable divergence
  - Specify behavior on secondary store failure (without implementation details)
- Review: Review diagrams with user
- **Internal logic**: For complex branching within a single component (3+ branch points), consider adding a Flowchart. See `references/diagram-selection.md` for Decision Tree, Decomposition criteria, and Flowchart syntax

#### Checkpoint: Step 4 Complete
Apply **Checkpoint Protocol** (see SKILL.md)

### Step 5: Document Generation

Apply **Area Completion Protocol** (see SKILL.md)

#### Checkpoint: Step 5 Complete
- Announce: "Solution Design complete. Select Design Areas for this project."

### Step 6: Design Area Identification

#### 6.1 Analyze Project Complexity
- Review: Requirements and Solution Design outputs to determine which Design Areas are needed
- For each Design Area, evaluate criteria:
  - **Domain Model**: 3+ state transitions, complex business rules, aggregate boundaries
  - **Data Schema**: DB/file/cache storage needed
  - **Interface Contract**: External interface exposed (API, CLI, Event)
  - **Integration Pattern**: External system integration, async processing, transaction boundaries
  - **Operations Plan**: Production deployment, monitoring, operational settings

#### 6.2 Present Design Area Selection
- Prepare: List of recommended Design Areas with justification
- Present: Use AskUserQuestion with multiSelect: true (see SKILL.md Design Area Selection)
- Confirm: User selects which Design Areas to proceed with

#### 6.3 Validate Selection
- If user selects NO Design Areas: Ask for justification before proceeding
- If user deselects AI-recommended area: Ask for justification before proceeding
- Document: Record selected Design Areas for subsequent execution

#### Checkpoint: Step 6 Complete
Apply **Checkpoint Protocol** (see SKILL.md)

#### Checkpoint: Solution Design Complete
- Announce: "Solution Design complete. Selected Design Areas: [list]. Proceeding to first Design Area: [name]."

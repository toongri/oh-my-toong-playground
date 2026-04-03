# Area Entry Criteria

**Interpretation rule:** Enter when **ANY** condition is met. Skip when **ALL** conditions are met.

## Contents

- **Requirements Analysis** — Entry and skip conditions for the Requirements area. Covers when
  business requirements are too ambiguous or informal to proceed without formalization, including
  acceptance criteria, domain glossary, and NFR gaps.

- **Solution Design** — Entry and skip conditions for the Solution Design area. Covers when
  architectural decisions are needed — new components, integration points, or competing solution
  approaches that require evaluation before committing to an implementation path.

- **Domain Model** — Entry and skip conditions for the Domain Model area. Covers when entity
  state machines, aggregate boundaries, or rich business rules go beyond simple CRUD and need
  explicit formalization.

- **Data Schema** — Entry and skip conditions for the Data Schema area. Covers when persistent
  storage design, schema migrations, or repository implementation details are required to support
  the domain model.

- **Interface Contract** — Entry and skip conditions for the Interface Contract area. Covers when
  external-facing APIs, event contracts, or breaking interface changes need documented contracts
  for consumers.

- **Integration Pattern** — Entry and skip conditions for the Integration Pattern area. Covers
  cross-system communication, async/event-driven flows, stateful components, and transaction
  boundaries that span multiple operations or services.

- **AI Responsibility Contract** — Entry and skip conditions for the AI Responsibility Contract
  area. Covers when AI/LLM components are part of the runtime architecture and their output
  quality directly affects user-facing business outcomes.

- **Operations Plan** — Entry and skip conditions for the Operations Plan area. Covers when
  custom metrics, business-level alerting, or feature flag strategies are needed beyond what
  standard APM tooling provides out of the box.

- **Frontend / UX Surface** — Entry and skip conditions for the Frontend / UX Surface area.
  Covers when component architecture, state management strategy, or styling approach requires
  explicit design decisions for a meaningful UI layer.

- **Data / ML Pipeline** — Entry and skip conditions for the Data / ML Pipeline area. Covers
  when data pipelines, multi-source transformations, data quality frameworks, or ML model serving
  are core architectural components of the system.

- **Security / Privacy** — Entry and skip conditions for the Security / Privacy area. Covers
  authentication/authorization design, sensitive data protection, multi-tenant access control,
  and regulatory compliance requirements.

### Requirements Analysis

**Designs:** Problem definition, business requirements, domain glossary, use cases with testable acceptance criteria, non-functional requirements, validation scenarios

**Enter when:**
- Requirements are ambiguous or informally described
- Business rules need formalization (calculations, thresholds, policies undocumented)
- Acceptance criteria not yet testable
- Success criteria or completion conditions undefined
- Domain terminology not agreed upon

**Skip when:**
- Requirements document already exists with testable acceptance criteria, domain glossary, NFRs, and validation scenarios
- User explicitly confirms existing requirements are sufficient and up-to-date

**Reference:** `references/requirements.md`

---

### Solution Design

**Designs:** Architecture decisions, component responsibilities, communication patterns, integration points with failure policies, data flow, solution alternatives analysis

**Enter when:**
- System structure needs to be designed or changed
- Multiple solution approaches are possible and need evaluation
- New components or integration points being introduced
- Architecture impact analysis needed (coupling, scalability, failure propagation)

**Skip when:**
- Change is confined to a single component with no architectural impact
- Solution approach is obvious from requirements alone (no alternatives to evaluate)
- Existing architecture patterns apply directly without new components or integration points

**Reference:** `references/solution-design.md`

---

### Domain Model

**Designs:** Aggregates, entities, value objects, business rules, invariants, state machines, domain events, repository/port interfaces (business-level)

**Enter when:**
- 3+ entity states with transitions that need formalization
- Complex business rules exist (calculations, multi-entity constraints, conditional logic)
- Aggregate boundaries need to be defined (lifecycle grouping, transactional consistency)
- Rich domain logic beyond CRUD (domain events, policies, domain services)

**Skip when:**
- Simple CRUD with no business logic beyond field validation
- No state management required
- Entity relationships are straightforward with no aggregate boundary decisions
- All business logic is trivial and fits in validation alone

**Reference:** `references/domain-model.md`

---

### Data Schema

**Designs:** Table schemas, column definitions, constraints, repository implementation (SQL/cache commands), index strategy, migration strategy

**Enter when:**
- New database tables or schema changes needed
- Persistent storage design required (RDB, cache, file storage)
- Existing schema requires migration (structural changes, data transformation)
- Repository/port interfaces from Domain Model need implementation details

**Skip when:**
- No persistent storage in the solution
- Using existing schema without any modification
- All storage is in-memory or ephemeral (no durability requirement)

**Reference:** `references/data-schema.md`

---

### Interface Contract

**Designs:** API endpoints (URI, methods, request/response), error handling patterns, versioning strategy, interface change documentation

**Enter when:**
- External interface exposed (REST API, gRPC, CLI, Event contract)
- API consumers exist who need documented contracts (other teams, external clients)
- Existing interfaces being modified or deprecated (breaking change management)

**Skip when:**
- Internal-only functionality with no external consumers
- No interface exposed to other systems, teams, or users
- All interfaces already documented and unchanged by this project

**Reference:** `references/interface-contract.md`

---

### Integration Pattern

**Designs:** Communication patterns (sync/async), data flow sequences, stateful component policies, error/recovery flows, transaction boundaries

**Enter when:**
- Cross-system or cross-service communication involved
- Async processing or event-driven patterns needed
- External service integration required
- Stateful components exist (buffers, caches, aggregators, schedulers)
- Transaction boundaries span multiple operations or stores

**Skip when:**
- Single system with all operations in-process and synchronous
- No external service calls or event-driven processing
- No stateful components beyond simple CRUD persistence
- No cross-boundary transaction concerns

**Reference:** `references/integration-pattern.md`

---

### AI Responsibility Contract

**Designs:** AI delegation boundaries, input contracts, output quality criteria, context/knowledge strategies, pre/post processing, fallback strategies

**Enter when:**
- System delegates decisions or content generation to AI/LLM components
- Non-deterministic output affects user-facing quality
- RAG, AI agents, or ML inference is part of the architecture
- AI output quality directly impacts business outcomes

**Skip when:**
- No AI/LLM/ML components in the system
- AI used only as development tooling (Copilot, code review) not runtime component
- AI used only for internal analytics/reporting with no user-facing output

**Reference:** `references/ai-responsibility-contract.md`

---

### Operations Plan

**Designs:** Custom metrics, custom logging, feature flag strategy

**Enter when:**
- Custom monitoring beyond standard APM needed (project-specific metrics, business alerts)
- Feature flags needed for rollout

**Skip when:**
- Standard APM metrics sufficient (response time, error rate, throughput)
- No feature flag needs

**Reference:** `references/operations-plan.md`

---

### Frontend / UX Surface

**Designs:** Component architecture, state management strategy, styling approach, responsive design, interaction patterns, accessibility considerations

**Enter when:**
- Frontend/UI layer is a significant part of the system
- Component architecture decisions needed (composition, shared components, design system integration)
- State management strategy undecided (local vs global, server vs client state)
- Styling/theming approach requires alignment across team

**Skip when:**
- No frontend/UI component in the system (API-only, CLI-only, background service)
- Using established design system with no customization needed
- Frontend is trivial (single static page, no interactive components)

**Reference:** `references/frontend-ux-surface.md`

---

### Data / ML Pipeline

**Designs:** Data flow architecture, ingestion patterns, transformation strategy, storage layer design, data quality framework, ML model serving (if applicable)

**Enter when:**
- Data pipeline is a core architectural component (ETL/ELT, streaming, batch processing)
- Multiple data sources require integration and transformation
- Data quality/validation strategy needed
- ML model serving or feature engineering is part of the architecture

**Skip when:**
- No data pipeline in the system (simple CRUD with single database)
- Data processing is trivial (single source, no transformation)
- Using fully managed data service with no custom pipeline logic

**Reference:** `references/data-ml-pipeline.md`

---

### Security / Privacy

**Designs:** Authentication strategy, authorization model, data protection, privacy compliance, threat modeling

**Enter when:**
- Authentication/authorization strategy needs design (not using off-the-shelf identity provider as-is)
- System handles sensitive or personal data requiring protection policies
- Multi-tenant or role-based access control needed
- Regulatory or compliance requirements exist (GDPR, CCPA, HIPAA, etc.)

**Skip when:**
- Internal tool with no sensitive data and single-user access
- Authentication fully delegated to external provider with no custom logic
- No personal data processed or stored

**Reference:** `references/security-privacy.md`

---

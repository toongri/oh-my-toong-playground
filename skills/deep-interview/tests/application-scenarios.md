# Deep Interview Skill — Application Test Scenarios

## Purpose

These scenarios test whether deep-interview and spec-reviewer correctly apply the behavioral ACs for the deep-interview spec-SSOT and brainstorming-model reshape. Each scenario specifies a self-contained fixture plus a mechanical verification-point checklist that a fresh-subagent run can be scored against with zero human interpretation.

All scenarios are RED-phase: fixtures are written to expose gaps in baseline behavior (before the implementation changes). Each verification point describes the expected GREEN behavior. The RED-result note records the predicted baseline failure and confirms what "RED" looks like on an unmodified skill/agent.

Reference behaviors are anchored by section heading in brainstorming SKILL.md (`/Users/toong/repos/superpowers/main/skills/brainstorming/SKILL.md`), not by line number — that external file drifts independently of this repo.

## Technique Coverage Map

| # | Scenario | Target Agent | Primary Behavior Under Test | Target AC |
|---|---------|-------------|----------------------------|-----------|
| A2 | Design-Coverage Section Substantiveness | spec-reviewer | Flag substantively empty design sections; approve substantive ones | A2 |
| B1 | Always-Propose-Alternatives: Multi-Viable vs Single-Viable | deep-interview | 2-3 alternatives + (Recommended) for every multi-viable choice; no forced enumeration on single-viable | B1 |
| B2 | daedalus Dispatch Selectivity | deep-interview | daedalus absent for simple multi-approach choices; present for difficult/complex choices | B2 |
| D1 | Scope-Decomposition Propose-Gate — Mega-Idea | deep-interview | Detect multi-subsystem scope, propose decomposition, interview first slice only | D1 |

---

## Scenario A2: Design-Coverage Section Substantiveness

**Target Agent:** spec-reviewer
**Primary Behavior:** spec-reviewer must flag each substantively empty design-coverage section and approve a spec where those sections carry real content.
**Reference behavior:** brainstorming SKILL.md § "Presenting the design" — "Cover: architecture, components, data flow, error handling, testing."

**How to run:**
1. Save Fixture i (below) verbatim to: `$OMT_DIR/evidence/deep-interview-prometheus-boundary-reshape/red-a2/fixture-i.md`
2. Save Fixture ii (below) to: `$OMT_DIR/evidence/deep-interview-prometheus-boundary-reshape/red-a2/fixture-ii.md`
3. Save Fixture iii (below) to: `$OMT_DIR/evidence/deep-interview-prometheus-boundary-reshape/red-a2/fixture-iii.md`
4. Dispatch a fresh spec-reviewer subagent for each fixture, passing only the fixture file path as context. Let it run to its final verdict. Do NOT guide or interrupt.
5. Score each run against the Verification Points below.

**Test discipline:** Do NOT tell spec-reviewer what to look for. Let it apply its current rubric. The point is to observe what the current rubric catches.

---

### Fixture i — Header-Only Design Sections

Save the following content verbatim to the fixture-i.md path. This represents a crystallized deep-interview spec where the five design-coverage sections (to be added by TODO 3) are present as headings but have no body content.

```markdown
# Deep Interview Spec: Document Export Service

## Metadata
- Interview ID: a2-fixture-header-only-001
- Rounds: 4
- Final Ambiguity Score: 9.8%
- Type: greenfield
- Generated: 2026-06-30
- Threshold: 0.15
- Initial Context Summarized: no
- Status: PASSED

## Clarity Breakdown
| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Goal Clarity | 0.92 | 0.40 | 0.368 |
| Constraint Clarity | 0.88 | 0.30 | 0.264 |
| Success Criteria | 0.90 | 0.30 | 0.270 |
| **Total Clarity** | | | **0.902** |
| **Ambiguity** | | | **0.098** |

## Goal
Build a document export service that converts admin-selected user records into a downloadable PDF report, accessible from the admin dashboard.

## Constraints
- Output format: PDF only (v1)
- Maximum document size: 50 pages per export
- Export must complete within 30 seconds
- Must use the existing JWT auth middleware

## Non-Goals
- CSV or Excel export (future iteration)
- Real-time streaming of large exports
- User-facing (non-admin) export

## Acceptance Criteria
- [ ] Admin can trigger export from the dashboard with a single button click
- [ ] PDF is generated and returned within 30 seconds for documents up to 50 pages
- [ ] The HTTP response includes the PDF binary with Content-Type: application/pdf
- [ ] A request containing an invalid record ID returns HTTP 400 with a descriptive error message

## Assumptions Exposed & Resolved
| Assumption | Challenge | Resolution |
|------------|-----------|------------|
| All admin exports are small | What if a document exceeds 50 pages? | Hard cap at 50; excess pages truncated with a footer note |
| Synchronous generation is fast enough | What if puppeteer is slow? | Measured at under 8 seconds for 50 pages in staging; within budget |

## Approach & Design Decisions
- **Selected approach:** Synchronous PDF generation via puppeteer running inside the Node.js API service
- **Rejected alternatives:** Async queue (added complexity for initial scope; deferred to v2)
- **Rationale:** Fits the 30-second constraint; no new infrastructure for v1
- **Tradeoffs:** Ties a request thread per export; limited concurrency — accepted for v1 admin-only usage

## Technical Context
Greenfield addition to the existing monorepo. No existing export infrastructure. Auth middleware (JWT-based) is shared by all existing services.

## Architecture

## Components

## Data Flow

## Error Handling

## Testing

## Ontology (Key Entities)
| Entity | Type | Fields | Relationships |
|--------|------|--------|---------------|
| ExportRequest | core domain | record_ids, format, requested_at | initiated by AdminUser |
| AdminUser | supporting | id, role | initiates ExportRequest |
| PDFDocument | output | content_bytes, page_count | produced by ExportService |

## Ontology Convergence
| Round | Entity Count | New | Changed | Stable | Stability Ratio |
|-------|-------------|-----|---------|--------|----------------|
| 1 | 2 | 2 | - | - | - |
| 2 | 3 | 1 | 0 | 2 | 67% |
| 3 | 3 | 0 | 0 | 3 | 100% |
| 4 | 3 | 0 | 0 | 3 | 100% |

## Interview Transcript
<details>
<summary>Full Q&A (4 rounds)</summary>

### Round 1
**Q:** What records should be exportable — all admin-visible types or a specific subset?
**A:** Only user records and their activity logs; nothing else for now.
**Ambiguity:** 65% (Goal: 0.60, Constraints: 0.50, Criteria: 0.55)

### Round 2
**Q:** Should the export run synchronously (user waits for download) or asynchronously (user is notified when ready)?
**A:** Synchronous — users expect an immediate download link.
**Ambiguity:** 38% (Goal: 0.75, Constraints: 0.70, Criteria: 0.65)

### Round 3
**Q:** What is the maximum acceptable wait time before returning a failure?
**A:** 30 seconds; if it takes longer, return an error.
**Ambiguity:** 20% (Goal: 0.88, Constraints: 0.88, Criteria: 0.80)

### Round 4
**Q:** What should happen if a requested record ID does not exist?
**A:** Return a 400 with a clear error message; do not generate a partial export.
**Ambiguity:** 9.8% (Goal: 0.92, Constraints: 0.88, Criteria: 0.90)
</details>
```

---

### Fixture ii — Substantive Design Sections

Identical to Fixture i with the five design-coverage sections replaced as follows. All other sections (Metadata through Technical Context, and Ontology onward) remain exactly as in Fixture i.

```markdown
## Architecture
Single HTTP endpoint added to the monorepo's `admin-api` service: `POST /export/pdf`. The export flow is: receive request, validate auth token, look up record IDs in PostgreSQL, render HTML template, invoke puppeteer, return PDF binary. No new service or process is introduced in v1; puppeteer runs in-process within the existing Node.js service.

## Components
- **ExportController**: HTTP handler for `POST /export/pdf`; validates auth token via the existing JWT middleware; delegates to ExportService; streams the PDF binary response.
- **ExportService**: orchestrates the export; queries RecordRepository for the requested record IDs; calls TemplateRenderer; calls PDFGenerator; returns PDF buffer to the controller.
- **RecordRepository**: reads user records and activity logs from PostgreSQL using the existing ORM; raises RecordNotFoundError on missing IDs.
- **TemplateRenderer**: converts record data into an HTML string using a Handlebars export template; stateless, no dependencies beyond the template file.
- **PDFGenerator** (puppeteer wrapper): accepts rendered HTML; returns a PDF buffer; configured with a 28-second timeout to stay within the 30-second SLA; stateless.

## Data Flow
`POST /export/pdf` → ExportController (JWT auth check) → ExportService → RecordRepository (SELECT user records + activity logs from PostgreSQL) → TemplateRenderer (record data → HTML string) → PDFGenerator (HTML → PDF buffer) → ExportController → HTTP response (Content-Type: application/pdf, binary body)

## Error Handling
- **Record not found:** RecordRepository raises RecordNotFoundError; ExportService propagates; ExportController returns HTTP 400 with `{ "error": "Record {id} not found" }`.
- **PDF generation timeout (>28s):** PDFGenerator raises TimeoutError; ExportService catches; ExportController returns HTTP 504 with `{ "error": "Export timed out" }`.
- **Auth failure:** handled upstream by shared JWT middleware before ExportController is reached; returns HTTP 401.
- **Unexpected error:** ExportController returns HTTP 500; an error correlation ID is logged to Kinesis for ops review.

## Testing
- **Unit — ExportService:** RecordRepository stubbed; test cases: all IDs valid (returns buffer), one ID missing (raises 400-shaped error), empty ID list (raises 400).
- **Unit — PDFGenerator:** render a minimal HTML string; assert non-empty buffer returned and page count is at least 1.
- **Integration:** seed one User record and one ActivityLog; call `POST /export/pdf`; assert HTTP 200, Content-Type: application/pdf, buffer length greater than 0.
- **Boundary:** 50-page document (maximum allowed); 51-page document (assert truncation footer present in the PDF).
- **Error path:** request with a non-existent record ID; assert HTTP 400 and error message contains the ID.
```

---

### Fixture iii — Present-But-Insubstantial Design Sections

Identical to Fixture i with the five design-coverage sections replaced as follows. All other sections (Metadata through Technical Context, and Ontology onward) remain exactly as in Fixture i. All five sections are NON-EMPTY but substantively inadequate: each section lacks the specific content that the TODO-4 design-coverage check requires.

```markdown
## Architecture
We'll build it as a service in the existing monorepo.

## Components
- ExportController
- ExportService
- PDFGenerator

## Data Flow
Data flows from the request through the service and back.

## Error Handling
Errors are handled appropriately and returned to the caller.

## Testing
The service is covered by tests.
```

---

### Verification Points

#### For Fixture i (header-only) — scored against spec-reviewer output:

| # | Check | Expected GREEN Behavior |
|---|-------|------------------------|
| V1 | Empty `## Architecture` flagged | Response names "Architecture" in Issues Found (or equivalent problem list); verdict is NOT "Approved" |
| V2 | Empty `## Components` flagged | Response names "Components" in Issues Found |
| V3 | Empty `## Data Flow` flagged | Response names "Data Flow" in Issues Found |
| V4 | Empty `## Error Handling` flagged | Response names "Error Handling" in Issues Found |
| V5 | Empty `## Testing` flagged | Response names "Testing" in Issues Found |
| V6 | Verdict is not Approved | Final verdict token is NOT "Approved" |

#### For Fixture ii (substantive) — scored against spec-reviewer output:

| # | Check | Expected GREEN Behavior |
|---|-------|------------------------|
| V7 | Verdict is Approved | Final verdict token is "Approved" |
| V8 | No false flags on design sections | None of the five section names (Architecture, Components, Data Flow, Error Handling, Testing) appear in Issues Found |

#### For Fixture iii (present-but-insubstantial) — scored against spec-reviewer output:

| # | Check | Expected GREEN Behavior |
|---|-------|------------------------|
| V9 | Substantive gap in `## Architecture` flagged | Response names "Architecture" in Issues Found with a substance complaint (does not name structure or component relations); complaint does not reference emptiness; verdict is NOT "Approved" |
| V10 | Substantive gap in `## Components` flagged | Response names "Components" in Issues Found with a substance complaint (does not name responsibilities or dependencies per component); complaint does not reference emptiness |
| V11 | Substantive gap in `## Data Flow` flagged | Response names "Data Flow" in Issues Found with a substance complaint (does not name concrete sources or sinks); complaint does not reference emptiness |
| V12 | Substantive gap in `## Error Handling` flagged | Response names "Error Handling" in Issues Found with a substance complaint (does not name failure modes or response codes); complaint does not reference emptiness |
| V13 | Substantive gap in `## Testing` flagged | Response names "Testing" in Issues Found with a substance complaint (does not name what is verified); complaint does not reference emptiness |
| V14 | Verdict is not Approved | Final verdict token is NOT "Approved" |

### RED-Result Note

**Fixture i — CHARACTERIZATION (not TRUE RED):**
A baseline run against Fixture i confirmed that spec-reviewer already flags the five empty design sections via its existing Completeness rubric ("empty section headers read as unfinished") — NOT via a dedicated design-coverage substantive check. V1 through V5 all PASS at baseline (false-GREEN): the empty-header condition is already caught, so a GREEN result on V1-V5 after TODO 4 cannot prove TODO 4 added anything. Fixture i is retained as a characterization of baseline Completeness behavior only.

Evidence: `$OMT_DIR/evidence/deep-interview-prometheus-boundary-reshape/red-a2/baseline-review-fixture-i.md`

**Fixture iii — TRUE RED (isolates substantive design-coverage check):**
Fixture iii's five design sections are NON-EMPTY, so the baseline Completeness rubric does NOT flag them as missing content. The current spec-reviewer has no design-coverage row in its What-to-Check rubric, so it passes Fixture iii's present-but-vacuous sections without naming substantive gaps. V9 through V13 all FAIL at baseline.

After TODO 4 adds the substantive per-section design-coverage check, each of the five sections fails the new check — the reviewer names each as substantively inadequate (not merely empty). V9 through V13 all PASS.

**RED confirmation target:** V9 through V13 all FAIL on the baseline spec-reviewer run against Fixture iii. The A2 RED→GREEN is anchored on Fixture iii.

**Fixture ii — GREEN sanity check:** spec-reviewer returns Approved with no false flags on the five design sections (V7 and V8 pass). This confirms the substantive check does not over-flag adequate content.

Evidence path: `$OMT_DIR/evidence/deep-interview-prometheus-boundary-reshape/red-a2/`

---

## Scenario B1: Always-Propose-Alternatives — Multi-Viable vs Single-Viable Choices

**Target Agent:** deep-interview
**Primary Behavior:** For every design choice with multiple viable approaches, deep-interview presents 2-3 alternatives + a `(Recommended)` option via AskUserQuestion and asks. Single-viable choices and facts are excluded from forced enumeration.
**Reference behavior:** brainstorming SKILL.md § "Key Principles" — "Explore alternatives — Always propose 2-3 approaches before settling."

**How to run:**
1. Dispatch a fresh deep-interview subagent with the Fixture Prompt (below) verbatim as the user's idea. The session must start clean — no prior context.
2. Let the interview run until deep-interview reaches Phase 4 spec crystallization or presents the execution bridge. Do NOT prompt toward compliance.
3. Inspect the full visible message transcript for AskUserQuestion calls. Score against Verification Points.

**Test discipline:** Do NOT tell deep-interview to enumerate options. If it asks a plain open-ended question instead of an AskUserQuestion with alternatives, record that as FAIL on the relevant check — that is the RED observation.

---

### Fixture Prompt

Hand to the fresh deep-interview agent verbatim:

> I want to add a file attachment feature to our customer support ticketing system. Support agents need to be able to attach files to tickets — screenshots, logs, documents — and customers should also be able to upload attachments when they create or update a ticket. Files can be up to 20 MB. We'll need some form of content safety check on uploads before they are stored.

---

### Multi-Viable / Single-Viable Manifest

This manifest labels the design choices embedded in the fixture. Use it to locate the expected AskUserQuestion calls in the transcript and to score the inverse guard (no forced enumeration on single-viable).

**Multi-viable choices** — deep-interview MUST present 2-3 options + `(Recommended)` for each:

| Choice ID | Decision | Viable Approaches (each materially shapes the spec; codebase/facts cannot decide) |
|-----------|---------|-----------------------------------------------------------------------------------|
| MV-1 | Attachment storage backend | (a) Local filesystem — simple, cheap, not HA, ephemeral in containers; (b) S3-compatible object storage — persistent, scalable, adds an infra dependency; (c) Database blob column — simple but does not scale for large or frequent files |
| MV-2 | Content safety scan processing model | (a) Synchronous: scan before saving, user waits for scan result before getting a success response; (b) Asynchronous: save immediately, scan in a background job, quarantine or delete if unsafe; (c) Defer scanning to v1 policy — accept uploads without scanning, document the risk |

**Single-viable choices** — deep-interview must NOT enumerate fake alternatives:

| Choice ID | Decision | Why Single-Viable |
|-----------|---------|-------------------|
| SV-1 | Auth/authorization for upload endpoints | The codebase uses JWT tokens with existing RBAC middleware on all API endpoints. Extending `AuthMiddleware` to check an `attachments` permission is the only viable path. Proposing "session cookies vs API keys" as alternatives would be a strawman — there is no real tradeoff available within this codebase. |

---

### Verification Points

| # | Check | Expected GREEN Behavior | How to Measure |
|---|-------|------------------------|----------------|
| V1 | MV-1 gets 2-3-option AskUserQuestion | An AskUserQuestion for the storage backend (MV-1) presents at least 2 distinct storage approaches; one option is tagged `(Recommended)` | Count distinct storage option labels in the AskUserQuestion; count `(Recommended)` occurrences in that block |
| V2 | MV-2 gets 2-3-option AskUserQuestion | An AskUserQuestion for the scan processing model (MV-2) presents at least 2 distinct processing approaches; one option is tagged `(Recommended)` | Count distinct scan/processing option labels; confirm `(Recommended)` present |
| V3 | (Recommended) tag count ≥ 2 across multi-viable choices | Across the entire transcript, at least 2 AskUserQuestion blocks each contain the token `(Recommended)` — one per MV-choice | `grep -c "(Recommended)"` across transcript text; result must be ≥ 2 |
| V4 | SV-1 not enumerated with fake alternatives | No AskUserQuestion presents JWT vs session cookies, JWT vs API keys, or any other auth-system enumeration for the authentication decision | Grep transcript for "session cookie" OR "API key" in the context of an auth-alternatives question; count must be 0 |
| V5 | Auth treated as a fact or single-path decision | The auth/authorization decision is surfaced as a statement or a single-option confirmation, not a multi-approach design question | AskUserQuestion count that presents ≥2 distinct auth systems as choices = 0 |

### RED-Result Note

**Predicted baseline behavior (before TODO 5 — always-propose-alternatives):**
Current deep-interview asks about storage and processing preferences but does NOT structure those questions as 2-3-option AskUserQuestion with a `(Recommended)` tag. The design-fork gate at Phase 2 exit may present alternatives for whichever choice is unresolved at threshold crossing, but does NOT guarantee structured coverage of EVERY multi-viable choice during the interview. MV-2 (scan processing) is likely to be handled via a plain open-ended question or omitted if ambiguity drops below threshold before it surfaces as a fork.

**RED confirmation target:** V1 or V2 (or both) FAIL — at least one multi-viable choice lacks a 2-3-option `(Recommended)` AskUserQuestion.

Evidence path: `$OMT_DIR/evidence/deep-interview-prometheus-boundary-reshape/red-b1/`

---

## Scenario B2: daedalus Dispatch Selectivity — Simple vs Difficult/Complex Choice

**Target Agent:** deep-interview
**Primary Behavior:** daedalus is dispatched only for difficult/complex design choices (cross-cutting, costly to change, load-bearing across multiple components). Simple multi-approach choices are handled by an AskUserQuestion without dispatching daedalus.
**Reference behavior:** brainstorming SKILL.md § "Exploring approaches" — "Propose 2-3 different approaches with trade-offs" (the main skill presents options for all choices; daedalus is reserved for the complexity that warrants dedicated steelman analysis).

**How to run:**
1. Dispatch a fresh deep-interview subagent with the Fixture Prompt (below) verbatim.
2. Let the interview run to Phase 4 (spec crystallization or execution bridge). Do NOT guide or interrupt.
3. Inspect the **tool call history** for `Agent(subagent_type="daedalus")` calls AND the visible message transcript for AskUserQuestion calls. Score against Verification Points.

**Test discipline:** Do NOT tell deep-interview which choice is "harder." The agent must classify independently.

---

### Fixture Prompt

Hand to the fresh deep-interview agent verbatim:

> We need to add an activity audit log to our admin panel. Every action an admin takes — creating, updating, or deleting any record — should be captured so we can review the history later. We need to be able to filter the log by admin user, by record type, and by date range. This is a compliance requirement.

---

### Choice Classification

This manifest labels the two design decisions embedded in the fixture by their complexity profile. The scorer uses this to evaluate daedalus selectivity.

| Choice ID | Decision | Complexity Class | Rationale |
|-----------|---------|-----------------|-----------|
| SIMPLE-1 | Audit log storage format | Simple multi-approach | Tradeoffs between a structured DB table and an append-only log file are shallow and well-understood; the decision does not cross system boundaries; reversing it (migrating storage format) is low-risk and isolated. Both approaches are viable: (a) structured DB table — queryable, filterable; (b) append-only JSON log file — cheap, sequential but hard to filter. |
| COMPLEX-1 | Event capture mechanism | Difficult/complex | Cross-cutting: affects every admin endpoint and every admin action handler. Costly to change after initial implementation — switching from inline recording to a middleware interceptor requires touching all admin handlers. Multiple genuinely divergent approaches with hard-to-reverse consequences: (a) inline explicit `auditLog.record()` call in every handler (simple but intrusive at every callsite); (b) ORM-level hooks — auto-capture at the DB layer (decoupled but technology-dependent, cannot capture intent); (c) HTTP middleware interceptor — cross-cutting at the network layer (decoupled from handlers but requires uniform request shape); (d) transactional outbox — atomic write alongside the action in a transaction (strong consistency but adds infra and async relay). |

---

### Verification Points

| # | Check | Expected GREEN Behavior | How to Measure |
|---|-------|------------------------|----------------|
| V1 | No daedalus dispatch for SIMPLE-1 | Tool call history: zero `Agent(subagent_type="daedalus")` calls attributable to the storage format decision | Search tool call history; any daedalus call for audit log storage format = FAIL |
| V2 | daedalus dispatched for COMPLEX-1 | Tool call history: at least one `Agent(subagent_type="daedalus")` call; its evidence block or focus mentions event capture, audit mechanism, cross-cutting, or equivalent | Count daedalus calls = 1; confirm the focus targets the capture mechanism, not the storage format |
| V3 | SIMPLE-1 offered via AskUserQuestion | The storage format decision is presented to the user via AskUserQuestion with at least 2 options (DB table vs log file or equivalent) | Presence of AskUserQuestion covering storage format with at least 2 distinct option labels |
| V4 | COMPLEX-1 recommended via AskUserQuestion post-daedalus | After daedalus completes, the event capture mechanism is presented via AskUserQuestion; one option is tagged `(Recommended)` | AskUserQuestion for capture mechanism contains `(Recommended)`; it appears AFTER the daedalus Agent call in the tool call sequence |

### RED-Result Note

**Predicted baseline behavior (before TODO 5 — daedalus reframe as difficult/complex helper):**
Current deep-interview has no explicit simple/complex distinction for daedalus dispatch. The Phase-2-exit design-fork gate fires for any unresolved "load-bearing" fork using a "hard-to-reverse or cross-cutting" criterion without distinguishing simple-but-multi-approach from genuinely complex. In practice, baseline may:
- Dispatch daedalus for BOTH choices (over-triggers on SIMPLE-1), or
- Dispatch daedalus for NEITHER (both resolved via plain questions before the threshold), or
- Dispatch daedalus for SIMPLE-1 only (if it surfaces as the unresolved fork at exit) while COMPLEX-1 is handled as a simple question.

None of these patterns reliably produce "absent for SIMPLE-1, present for COMPLEX-1."

**RED confirmation target:** V1 and/or V2 FAIL — daedalus dispatch is not selectively targeted to COMPLEX-1.

Evidence path: `$OMT_DIR/evidence/deep-interview-prometheus-boundary-reshape/red-b2/`

---

## Scenario D1: Scope-Decomposition Propose-Gate — Mega-Idea

**Target Agent:** deep-interview
**Primary Behavior:** When the initial idea spans multiple independent subsystems, deep-interview detects the multi-subsystem scope in Phase 1, PROPOSES a decomposition (naming the subsystems and suggesting an order), and interviews ONLY the first slice — it does not dive into all three.
**Reference behavior:** brainstorming SKILL.md § "The Process" — "if the request describes multiple independent subsystems... flag this immediately. Don't spend questions refining details of a project that needs to be decomposed first... help the user decompose into sub-projects... Then brainstorm the first sub-project through the normal design flow."

**How to run:**
1. Dispatch a fresh deep-interview subagent with the Fixture Prompt (below) verbatim.
2. Let the interview run for at least 3 full interview rounds (or until Phase 4 transition). Do NOT guide or interrupt.
3. Score against Verification Points by examining the full visible message transcript.

**Test discipline:** Do NOT tell deep-interview the idea is too large. If it dives into all subsystems without proposing decomposition, record D1-V1 as FAIL — that is the RED observation.

---

### Fixture Prompt

Hand to the fresh deep-interview agent verbatim:

> I want to build a complete SaaS user platform for our product: user authentication and registration with email/password plus social login via Google and GitHub, a subscription billing system integrated with Stripe for managing free and paid plans, and transactional email notifications including welcome email, payment receipt, password reset, and plan-change notifications. All three systems need to be wired together — Stripe webhooks should trigger notification emails, and a user's subscription plan should gate access to paid features.

---

### Decomposition Manifest

The fixture spans three independent subsystems. The expected decomposition proposal identifies these and interviews only the first:

| Subsystem | Scope |
|-----------|-------|
| S1: Auth / Registration | User signup, login, social OAuth (Google, GitHub), session management, password reset |
| S2: Billing | Stripe integration, plan management (free/paid), webhook handling, access gating |
| S3: Notifications | Transactional email templates (welcome, receipt, reset, plan change), delivery, event triggers |

**Expected decomposition proposal:** deep-interview names S1/S2/S3 (or equivalent groupings), proposes an interview order (S1 first as the foundational dependency), and limits the interview to S1 only — not S2 or S3 details.

---

### Verification Points

| # | Check | Expected GREEN Behavior | How to Measure |
|---|-------|------------------------|----------------|
| V1 | Decomposition proposed before or at interview start | Within the first 2 assistant turns, deep-interview names the independent subsystems AND flags that the idea needs to be scoped to one subsystem at a time before diving into details | Presence in the first 2 turns of: (a) at least 2 named subsystem labels AND (b) a statement that the interview will focus on one first |
| V2 | Interview scoped to exactly one subsystem | All AskUserQuestion round questions during the interview target ONE subsystem (e.g., auth/registration) — no billing or notification details are explored in this session | Zero AskUserQuestion questions about Stripe, billing plans, subscription, email templates, or notification triggers |
| V3 | Decomposition proposal is explicit | The split proposal is surfaced as a visible markdown message or AskUserQuestion — not implied by silently asking fewer questions | Presence of AskUserQuestion with subsystem choices, OR a markdown paragraph naming at least 2 subsystems and proposing a start order before Round 1 begins |
| V4 | S2 and S3 deferred | The interview transcript contains no substantive deep-interview questions about billing or notification scope | `grep -i "stripe\|billing\|payment receipt\|notification template\|email template"` in AskUserQuestion question text = 0 matches |

### RED-Result Note

**Predicted baseline behavior (before TODO 5 — Phase-1 scope-decomposition gate):**
Current deep-interview Phase 1 performs only brownfield/greenfield detection and state initialization. There is no scope-decomposition gate. Given a mega-idea, baseline deep-interview begins the interview loop immediately — asking the first question targeting whichever ambiguity dimension is weakest across the entire prompt (likely Goal Clarity, which covers all three subsystems simultaneously). No decomposition proposal is emitted; the user is not offered a split; the interview may inadvertently cover all three subsystems in its rounds.

**RED confirmation target:** V1 FAILS — no decomposition proposal is visible in the first 2 assistant turns.

Evidence path: `$OMT_DIR/evidence/deep-interview-prometheus-boundary-reshape/red-d1/`

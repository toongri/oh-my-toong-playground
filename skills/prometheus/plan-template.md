# Plan Template Reference

## Plan Output

**Location:** `$OMT_DIR/plans/{name}.md`

**Language:** Plans MUST be written in English.

**What to EXCLUDE:** No pseudocode or code snippets. No vague criteria ("verify it works").

## Plan Template Structure

| Section | Contents |
|---------|----------|
| **TL;DR** | Quick summary, deliverables (bullet list), estimated effort (Quick/Short/Medium/Large/XL), Parallel Execution (YES/NO — wave description), Critical Path |
| **Context** | Original Request (verbatim), Interview summary (key decisions — the WHY behind each TODO) |
| **Work Objectives** | Core objective, Definition of Done, Must Have, Must NOT Have / Guardrails |
| **TODOs** | Numbered tasks in checkbox format — each with: what to do, must NOT do, files, References, acceptance criteria, parallelization fields, QA scenarios |
| **Execution Strategy** | Wave visualization, Dependency Matrix, Critical Path. Target 5-8 tasks per wave. Circular dependencies forbidden. Final Verification Wave mandatory for Scoped+ intent |
| **Verification Strategy** | Test decision (TDD/tests-after/none), framework, verification commands. **Zero Human Intervention** — all verification agent-executed with evidence to `$OMT_DIR/evidence/{plan-name}/` |
| **Success Criteria** | Binary pass/fail end state. Verification commands + final checklist |

## TODO Task Format

Each TODO is a checkbox line: `- [ ] N. Title` with body content indented.

- Each task = implementation + test combined (never separate)
- **What to do** — faithfully transfer interview conclusions. The executor has NO interview context. Capture:
  - Content — what the result contains or how it behaves
  - Scope — which areas, entities, or modules are covered
  - Approach — what direction or pattern to follow
  - Inputs — what specs, requirements, or prior decisions inform this
  - Decisions — choices confirmed during interview
- **Files**: What this TODO creates or modifies — the deliverables
- **References (CRITICAL)** — executor has NO interview context. Provide:
  - **Pattern References**: `file:line-range` — existing code patterns. WHY explains what to adopt.
  - **API/Type References**: types, interfaces, APIs. WHY explains why this matters.
  - **Test References**: existing test patterns. WHY explains what style to follow.
  - **External References**: official docs, RFCs. WHY explains what decision this informs.
  - Every TODO must include at least one Pattern or API/Type reference. For greenfield: state "Greenfield — no existing pattern" explicitly.
- **Parallelization** — every TODO must include:
  - `Blocked By`: list of TODO numbers (empty if none)
  - `Blocks`: list of TODO numbers (empty if none)
  - `Wave`: execution wave number (1-based)
- **Wave Assignment Rule**: `Wave = max(wave of each blocker) + 1`. Empty Blocked By = Wave 1. MANDATORY — no manual override.
- **Anti-pattern**: Assigning Wave 2 to independent task because "it makes sense." If no dependency, Wave 1.

## MECE Decomposition

Tasks must be Mutually Exclusive (no overlap) and Collectively Exhaustive (full coverage).

Self-check after drafting TODOs:
1. **Overlap**: Do any two TODOs modify the same file for the same purpose? → Merge or redraw
2. **Coverage**: If every TODO is completed, is the requirement fulfilled? → Add missing TODO
3. **Hidden coupling**: Implicit state, ordering, undeclared dependencies? → Make explicit or merge

| Anti-Pattern | Example | Fix |
|-------------|---------|-----|
| **Overlap** | Both TODO 1 and 2 validate user input | Merge or split by layer with boundary |
| **Gap** | CRUD TODOs cover create/read/update but not delete | Add delete TODO |
| **False MECE** | "frontend" and "backend" but API contract owned by neither | Add contract TODO or assign ownership |

## Maximum Parallelism

| Rule | Threshold |
|------|-----------|
| **Granularity** | 1 task = 1 concern = 1-3 files. 4+ files or 2+ concerns → SPLIT |
| **Parallelism Target** | 5-8 tasks per wave. <3 in non-bottleneck wave = under-split |
| **Dependency Minimization** | Shared deps (types, interfaces) as Wave-1 tasks |

## Atomicity Heuristic

Each TODO must be atomic — completable in one delegation pass.

| # | Condition | Threshold |
|---|-----------|-----------|
| 1 | Concern scope | 1 concern per task |
| 2 | File scope | 1-3 files per task (hard backstop) |
| 3 | Single-delegation | Finish without mid-task coordination |

Any condition fails → decompose further.

| Smell | Action |
|-------|--------|
| "and" in description | Split into separate TODOs |
| Spans unrelated concerns | One TODO per responsibility |
| Requires sequential phases | Each phase = own TODO with Blocked By |
| Task touches 4+ files | Decompose by responsibility |

**Vertical Slice Rule**: Prefer vertical slices (one feature end-to-end) over horizontal (all models, then all services). Exception: shared foundation tasks in Wave 1.

## QA Scenarios (MANDATORY per TODO)

Each scenario uses a structured block with 7 fields:
- **Scenario**: `{Name} — {Purpose}`
- **Tool**: CLI command (`curl`, `bun test`, `playwright`, `grep` — NOT descriptions like "Header validation")
- **Preconditions**: Setup state required
- **Steps**: Numbered list of exact commands
- **Expected**: Observable outcome on success
- **Failure**: Specific failure symptoms (NOT "Expected does not happen")
- **Evidence**: `$OMT_DIR/evidence/{plan-name}/task-{N}-{scenario-slug}.{ext}`

**Minimum 2 scenarios per TODO**: happy path + failure/edge case.

**Specificity requirements:**
- API: Specific paths/methods, exact HTTP codes, JSON field paths
- UI: CSS selectors, exact DOM state assertions
- All: Concrete test data, wait conditions, at least ONE failure scenario per task

## TODO Example

```
- [ ] 3. Implement UserService
  - What to do: UserService manages User lifecycle — create, read, update, delete.
    Create validates email presence and uniqueness; duplicate returns domain error.
    Read-by-ID returns null when not found (not exception). All operations delegate
    to UserRepository. Error cases surface as typed result objects matching existing
    service convention in product-service.ts (confirmed in interview).
  - Must NOT do: Add caching or event publishing
  - Files: src/service/user-service.ts, src/service/index.ts
  - References (CRITICAL):
    - Pattern: `src/service/product-service.ts:15-60` — existing service CRUD pattern
      WHY: Follow same repository injection, error handling, return type conventions
    - API/Type: `src/types/user.ts` — User entity type and CreateUserInput interface
      WHY: Service inputs/outputs must use these declared types
    - Test: `tests/service/product-service.test.ts:1-40` — existing service test structure
      WHY: Match describe/it nesting, mock setup, assertion style
  - Blocked By: TODO 1, TODO 2
  - Blocks: TODO 5
  - Wave: 2
  - Acceptance Criteria:
    - [ ] **UserService create rejects duplicate email**: Returns `{success: false, error: 'DUPLICATE_EMAIL'}`
          **Verification**: Unit test asserts result when repository returns existing user
    - QA Scenarios:

    Scenario: Happy path — create user
      Tool: curl
      Preconditions: Server running, DB migrated, users table empty
      Steps:
        1. `curl -s -o response.json -w "%{http_code}" -X POST http://localhost:3000/api/users -H "Content-Type: application/json" -d '{"email":"test@example.com","name":"Test User"}'`
        2. Assert status is `201`
        3. Assert `response.json` contains `"id"` (UUID) and `"email":"test@example.com"`
      Expected: 201 with JSON body containing id, email, name
      Failure: Non-201 status, or response missing `id` field
      Evidence: $OMT_DIR/evidence/{plan-name}/task-3-create-user-201.json

    Scenario: Validation failure — missing email
      Tool: curl
      Preconditions: Server running
      Steps:
        1. `curl -s -o response.json -w "%{http_code}" -X POST http://localhost:3000/api/users -H "Content-Type: application/json" -d '{"name":"No Email"}'`
        2. Assert status is `400`
        3. Assert `response.json` contains `"error"` referencing `"email"`
      Expected: 400 with error referencing missing email
      Failure: Non-400 status, or error not mentioning email
      Evidence: $OMT_DIR/evidence/{plan-name}/task-3-validation-failure.json
```

## Execution Strategy Example

```
Wave Visualization:

  Wave 1 (foundation):
  +-- Task 1: Project scaffolding + config
  +-- Task 2: Type definitions
  +-- Task 3: Schema definitions

  Wave 2 (core, MAX PARALLEL):
  +-- Task 4: Core business logic (depends: 2)
  +-- Task 5: API endpoints (depends: 3)
  +-- Task 6: UI layout (depends: 1)

  Wave 3 (integration):
  +-- Task 7: Main route (depends: 4, 5)

  Wave FINAL (independent review, 4 parallel):
  +-- F1: Plan Compliance Audit
  +-- F2: Code Quality Review
  +-- F3: QA Scenario Execution
  +-- F4: Scope Fidelity Check

Critical Path: Task 1 -> Task 2 -> Task 4 -> Task 7 -> F1-F4
```

## Final Verification Wave

Every plan with Scoped or higher intent MUST include Final Verification Wave. Trivial exempt.

> ALL F1-F4 must APPROVE. Rejection → fix task → re-enter implementation → full F1-F4 re-run.

- [ ] F1. Plan Compliance Audit — read plan, verify Must Have/Must NOT Have, check evidence files
- [ ] F2. Code Quality Review — build + linter + tests, review for as any/empty catches/console.log/AI slop
- [ ] F3. QA Scenario Execution — execute EVERY scenario, test cross-task integration, save evidence
- [ ] F4. Scope Fidelity Check — read spec vs diff, verify 1:1, check Must NOT do, detect cross-task contamination

Wave field: `Wave: FINAL` (literal string). Numeric rule applies to implementation tasks only.

## Success Criteria Template

```
## Success Criteria

### Verification Commands

\`\`\`bash
# Build
{build-command}  # Expected: exit 0

# Tests
{test-command}  # Expected: all pass

# Lint
{lint-command}  # Expected: no errors
\`\`\`

### Final Checklist

- [ ] All TODOs completed
- [ ] All QA scenarios pass
- [ ] Evidence artifacts saved to `$OMT_DIR/evidence/{plan-name}/`
- [ ] No scope creep detected
- [ ] Build + lint + tests green
```

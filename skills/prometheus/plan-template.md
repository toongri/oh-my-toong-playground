# Plan Template Examples

**This file is lookup-only.** All mandatory plan-structure rules (sections, TODO 7-field format, MECE, Atomicity, Maximum Parallelism, Wave Assignment, Final Verification Wave) are defined inline in `SKILL.md > ## Plan Structure (Mandatory Contract)`. The contract is authoritative; the examples below are for reference when drafting concrete TODO bodies, Wave visualizations, or Success Criteria.

Read this file when you want to consult a worked example. You do NOT need to read it to know what the plan structure requires — that knowledge is already in SKILL.md.

---

## TODO Example (worked example)

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
    - [ ] **POST /api/users with a duplicate email responds 409 DUPLICATE_EMAIL on the second request**
          **Setup**: `email="dup-$(uuidgen)@x.com" && id=$(curl -fsS -X POST "$API_BASE_URL/api/users" -H 'Content-Type: application/json' -d "{\"email\":\"$email\"}" | jq -r '.id') && [ -n "$id" ] && [ "$id" != "null" ]`
          **Verification**: `resp=$(curl -s -w '\n%{http_code}' -X POST "$API_BASE_URL/api/users" -H 'Content-Type: application/json' -d "{\"email\":\"$email\"}") && code=$(echo "$resp" | tail -n1) && body=$(echo "$resp" | sed '$d') && [ "$code" = "409" ] && echo "$body" | jq -e '.error == "DUPLICATE_EMAIL"'`
          **Cleanup**: `[ -n "$id" ] && [ "$id" != "null" ] && curl -fsS -X DELETE "$API_BASE_URL/api/users/$id" > /dev/null 2>&1 || true`
    - QA Scenarios:

    Scenario: Happy path — create user
      Tool: curl
      Preconditions: Server running, DB migrated, users table empty
      Steps:
        1. `curl -s -o response.json -w "%{http_code}" -X POST "$API_BASE_URL/api/users" -H "Content-Type: application/json" -d '{"email":"test@example.com","name":"Test User"}'`
        2. Assert status is `201`
        3. Assert `response.json` contains `"id"` (UUID) and `"email":"test@example.com"`
      Expected: 201 with JSON body containing id, email, name
      Failure: Non-201 status, or response missing `id` field
      Evidence: $OMT_DIR/evidence/{plan-name}/implement-user-service/create-user-201.json

    Scenario: Validation failure — missing email
      Tool: curl
      Preconditions: Server running
      Steps:
        1. `curl -s -o response.json -w "%{http_code}" -X POST "$API_BASE_URL/api/users" -H "Content-Type: application/json" -d '{"name":"No Email"}'`
        2. Assert status is `400`
        3. Assert `response.json` contains `"error"` referencing `"email"`
      Expected: 400 with error referencing missing email
      Failure: Non-400 status, or error not mentioning email
      Evidence: $OMT_DIR/evidence/{plan-name}/implement-user-service/validation-failure.json
```

---

## Execution Strategy Example (worked example)

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

---

## ADR Example (worked example)

```
## ADR

Context:
- Additive-only — no existing behaviour is altered; new code is inserted alongside existing paths.
- Backward-compatible — callers not opting in must see zero change.

Decision Drivers:
- Existing contract requires all endpoints to return the same response envelope.
- CI pipeline enforces zero regression on current test suite.
- Team convention: no new external dependencies without architecture review.

Considered Options:

Option A — Extend existing UserService with optional parameter
  Pros: minimal surface area; no new abstraction; single delegation pass.
  Cons: UserService grows; violates single-responsibility if logic diverges.

Option B — Introduce a separate UserEnrichmentService
  Pros: clean separation; independently testable; UserService stays unchanged.
  Cons: extra file; extra wiring; overkill for current scope.

Decision: Extend UserService with an optional `enrich` flag rather than creating a separate service.

Rationale: The enrichment logic is three lines. A separate service would add indirection cost exceeding the value of isolation at this scope.

Consequences:
  + UserService remains the single delegation target for callers.
  + Zero new files; CI stays green with no wiring changes.
  - If enrichment logic grows significantly, a future refactor to Option B becomes necessary.

Follow-ups: Revisit if enrichment adds >2 additional fields (create UserEnrichmentService at that point).
```

---

## Success Criteria Template (worked example)

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

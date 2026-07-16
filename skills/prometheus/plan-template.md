# Plan Template Examples

**This file is lookup-only.** The mandatory plan-structure rules are defined inline in `SKILL.md > ## Plan Structure (Mandatory Contract)`. The contract is authoritative; the examples below are for reference when drafting concrete TODO bodies, Wave visualizations, or Success Criteria.

Read this file when you want to consult a worked example. You do NOT need to read it to know what the plan structure requires — that knowledge is already in SKILL.md.

---

## TODO Example (worked example)

```
- [ ] 3. Implement UserService
  - What to do: Implement UserService managing the User lifecycle, delegating all persistence to UserRepository.
    - `create` — validate email presence + uniqueness; a duplicate returns a typed domain error (not a throw)
    - `read` by ID — return null when not found, not an exception
    - `update` / `delete` — standard lifecycle, same repository delegation
    - Error cases surface as typed result objects, matching the `product-service.ts` convention (confirmed in interview)
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

Each entry is one titled `D-N` item. Contested items carry the full 7-field MADR. Solo items carry the lightweight fields plus ownership and edges. See `SKILL.md > ### ADR` for the authoritative contract; this example is lookup-only.

```
## ADR

### D-1: Add optional enrich flag to UserService rather than a separate UserEnrichmentService

**Tier: contested**

Context:
- Additive-only — no existing behaviour is altered; new code is inserted alongside existing paths.
- Backward-compatible — callers not opting in must see zero change.

Decision Drivers:
- Existing contract requires all endpoints to return the same response envelope.
- CI pipeline enforces zero regression on current test suite.
- Team convention: no new external dependencies without architecture review.

Considered Options:

Option A — Extend existing UserService with optional `enrich` flag
  Pros: minimal surface area; no new abstraction; single delegation pass.
  Cons: UserService grows; violates single-responsibility if enrichment logic diverges later.

Option B — Introduce a separate UserEnrichmentService
  Pros: clean separation; independently testable; UserService stays unchanged.
  Cons: extra file; extra wiring; overkill for current three-line enrichment scope.

Decision: Extend UserService with an optional `enrich` flag rather than creating a separate service.

Rationale: The enrichment logic is three lines. A separate service would add indirection cost exceeding the value of isolation at this scope. Option B becomes the right choice only when enrichment exceeds ~3 fields.

Consequences:
  + UserService remains the single delegation target for callers.
  + Zero new files; CI stays green with no wiring changes.
  - If enrichment logic grows significantly, a future refactor to Option B becomes necessary.

Follow-ups: Revisit if enrichment adds >2 additional fields (create UserEnrichmentService at that point).

---

### D-2: UserService owns the enrich-flag handling; controller must not contain enrichment logic

**Tier: solo**

Decision: The `enrich` flag is read and acted on inside `UserService.getUser`, not in the controller layer.

Why: Enrichment is a domain concern — the controller's role is to translate HTTP to domain calls, not to
contain domain-conditional branches. Placing the flag check in the controller would bypass the service
layer and scatter domain logic.

Invalidated alternative (one line): Controller reads flag and calls `enrich()` directly — rejected because
it violates the service-layer contract and cannot be tested without standing up the HTTP layer.

Cites: src/service/user-service.ts:getUser

Owns: Reading the `enrich` flag; invoking the enrichment branch; returning the enriched User entity.
Must NOT own: HTTP parsing, session context, or request validation — those remain in the controller.

Edges: (controller→UserService.getUser, passes enrich flag; UserService.getUser→UserRepository.findById,
  side effect: none beyond the read; failure path: repository throws NotFoundError → service re-throws as
  domain error, controller maps to 404)
```

---

## Success Criteria Template (worked example)

```
## Success Criteria

### Verification Commands

\`\`\`bash
# Verify the CHANGE, not the whole project — scope each command to what changed
# (the project's change-affected / changed-files command), not a whole-suite run.
{test-command}  # the project's change-scoped test command
{lint-command}  # scoped to the changed files where the tooling supports it
{build-command}  # only when the change can break the build
\`\`\`

### Final Checklist

- [ ] All TODOs completed
- [ ] All QA scenarios pass
- [ ] Evidence artifacts saved to `$OMT_DIR/evidence/{plan-name}/`
- [ ] No scope creep detected
- [ ] Change-scoped build + lint + tests green
```

# Webhook Delivery Retry Subsystem

> Fixture plan for the Stage A review-document scenario (`tests/application-scenarios.md` P-31).
> Synthetic content. Every lens trigger FACT in `diagram-guide.md` holds in this plan on purpose,
> and every edge each lens needs is decided somewhere in the plan — the fixture must exercise
> Stage A production, not the plan-defect STOP path.

## TL;DR

**Quick Summary**: Failed webhook deliveries are dropped silently. Add a persisted retry
pipeline with a bounded backoff schedule, a dead-letter terminal state, and an admin replay
endpoint.

**Deliverables**: `retry-scheduler` service, `DeliveryAttempt` persistence in `delivery-store`,
`RetryPolicy` config shape, `POST /admin/webhooks/{id}/replay` on `admin-api`.

**Estimated Effort**: 5 implementation TODOs across 3 waves, plus the Final Verification Wave.

## Context

**Interview Summary**

- Current behaviour: `webhook-dispatcher` posts to the subscriber URL once. A non-2xx response
  is logged and discarded — there is no persistence and no second attempt.
- Retry budget is bounded at 5 attempts. Confirmed: unbounded retry is out of scope; the
  subscriber contract already documents a 5-attempt ceiling.
- Backoff is exponential with jitter, base 30s, capped at 1h. Confirmed by the user against the
  existing `delivery-queue` visibility-timeout ceiling of 1h — a longer backoff would exceed the
  queue's own redelivery window.
- **Row identity was the one contested design fork.** It was co-decided at the human design gate:
  one delivery owns exactly one `delivery_attempt` row, reused across attempts, carrying an
  `attempt_count` counter. The per-attempt history alternative was rejected — recorded in the ADR.
- Admin replay was requested as an explicit escape hatch for the dead-letter state: once an
  attempt reaches `DEAD`, only an operator action revives it.
- The user deferred the storage choice; the autonomous decision is to reuse the existing
  `delivery-store` Postgres table rather than introduce a new store (recorded in the ADR as the
  reuse-the-existing-store decision).

**Risk-Domain Assessment**

- Security? **N**
- Data destruction? **Y** — the change ships a schema migration.
- External contract? **Y** — subscribers observe the retry behaviour, and a new admin API is added.
- Concurrency? **N** — the queue serializes attempts per delivery; no parallel write path exists.
- Money? **N**

## Work Objectives

**Must Have**
- Every failed delivery persists a `DeliveryAttempt` row carrying its current lifecycle state and
  its attempt count.
- Retry scheduling is driven by a single `RetryPolicy` value, not by per-call-site constants.
- An operator can replay a `DEAD` attempt through the admin API and observe it re-enter the queue.

**Must NOT Have (Guardrails)**
- No change to the outbound HTTP client or its TLS configuration.
- No new message broker — `delivery-queue` stays the only queue.
- No retry for 4xx responses other than 408 and 429; a 400 is a subscriber contract error and
  terminates immediately.
- No admin UI work. The replay endpoint is API-only this cycle.
- No per-attempt history rows — the row model is one row per delivery, decided at the design gate.

## TODOs

- [ ] 1. Add `DeliveryAttempt` persistence to `delivery-store`
  - What to do: Add the `delivery_attempt` table and repository methods `insert`, `transition`,
    and `findByWebhookId`. Columns include the lifecycle state and `attempt_count`. States:
    `PENDING`, `SENDING`, `DELIVERED`, `FAILED`, `RETRY_SCHEDULED`, `DEAD`.
  - Must NOT do: Backfill historical deliveries.
  - Files: `src/delivery-store/delivery-attempt-repository.ts`, `migrations/`
  - References:
    - Pattern: `src/delivery-store/subscription-repository.ts:1-63` — existing repository shape
      WHY: Same connection injection, same typed-result error convention.
  - Wave: 1
  - Acceptance Criteria:
    - [ ] **A newly recorded attempt reads back in `PENDING` with `attempt_count` 0**
          **Verification**: `bun test src/delivery-store/delivery-attempt-repository.test.ts`

- [ ] 2. Introduce the `RetryPolicy` shape
  - What to do: Define `RetryPolicy` with `maxAttempts`, `baseDelaySeconds`, `maxDelaySeconds`,
    `jitterRatio`, and `retryableStatuses`. One module-level default instance; no per-call-site
    literals.
  - Must NOT do: Make the policy per-subscriber configurable.
  - Files: `src/retry-scheduler/retry-policy.ts`
  - References:
    - Greenfield — no existing pattern for a policy value object in this service.
  - Wave: 1
  - Acceptance Criteria:
    - [ ] **`retryableStatuses` contains exactly 408, 429, and the 5xx range**
          **Verification**: `bun test src/retry-scheduler/retry-policy.test.ts`

- [ ] 3. Implement `retry-scheduler` decision logic
  - What to do: On a failed attempt, decide among three outcomes: schedule a retry, terminate as
    a contract error, or move to `DEAD`. The branch reads the response status, `attempt_count`,
    and the `RetryPolicy`. A retryable status under `maxAttempts` increments `attempt_count`,
    transitions the row `SENDING → RETRY_SCHEDULED`, and enqueues the next attempt onto
    `delivery-queue` with the computed backoff delay; when the queue redelivers, the row goes
    `RETRY_SCHEDULED → SENDING`. A non-retryable status transitions `SENDING → FAILED` and
    enqueues nothing. Reaching `maxAttempts` transitions `SENDING → DEAD`.
  - Must NOT do: Perform the HTTP call itself — `webhook-dispatcher` stays the only caller of the
    outbound client.
  - Files: `src/retry-scheduler/scheduler.ts`
  - References:
    - API/Type: `src/retry-scheduler/retry-policy.ts` — the policy shape from TODO 2
      WHY: The branch reads every field of the policy; the shape is its input contract.
  - Blocked By: TODO 1, TODO 2
  - Wave: 2
  - Acceptance Criteria:
    - [ ] **A 429 under the attempt ceiling leaves the row in `RETRY_SCHEDULED` with a delay in
          `[baseDelaySeconds, maxDelaySeconds]`**
          **Verification**: `bun test src/retry-scheduler/scheduler.test.ts -t 429`
    - [ ] **A 400 leaves the row in terminal `FAILED` and enqueues nothing**
          **Verification**: `bun test src/retry-scheduler/scheduler.test.ts -t "contract error"`

- [ ] 4. Wire `webhook-dispatcher` to the scheduler
  - What to do: `webhook-dispatcher` calls `insert` for a delivery with no row yet, writes
    `PENDING → SENDING` before it posts, and on a 2xx response writes `SENDING → DELIVERED`. On a
    non-2xx response it hands the decision to `retry-scheduler` instead of logging and dropping.
    It is also the only consumer of `delivery-queue`, so it writes `RETRY_SCHEDULED → SENDING`
    when a redelivered message arrives.
  - Must NOT do: Change how the success path posts, signs, or logs — the only addition on that
    path is the `SENDING → DELIVERED` state write. Decide anything about retries: the three
    failure outcomes belong to `retry-scheduler`.
  - Files: `src/webhook-dispatcher/dispatcher.ts`
  - References:
    - Pattern: `src/webhook-dispatcher/dispatcher.ts:44-90` — the current post-and-log path
      WHY: The new branch replaces exactly this block; the success path above it is untouched.
  - Blocked By: TODO 3
  - Wave: 3
  - Acceptance Criteria:
    - [ ] **Immediately after a single non-2xx subscriber response, and before the scheduled
          backoff elapses, `findByWebhookId` returns exactly one row**
          **Verification**: `bun test src/webhook-dispatcher/dispatcher.test.ts -t retry`

- [ ] 5. Add `POST /admin/webhooks/{id}/replay`
  - What to do: An operator calls the endpoint with a webhook id. `admin-api` reads the
    `DeliveryAttempt` row via `findByWebhookId`, responds 404 when no row exists, responds 409
    unless the row is in `DEAD`, and otherwise transitions it `DEAD → PENDING`, resets
    `attempt_count` to 0, and re-enqueues it onto `delivery-queue` with no delay. The response
    carries the attempt id of that same row.
  - Must NOT do: Allow replay of a row in any state other than `DEAD`. Create a second row.
  - Files: `src/admin-api/routes/webhook-replay.ts`
  - References:
    - Pattern: `src/admin-api/routes/subscription-pause.ts:10-33` — existing admin route shape
      WHY: Same auth middleware, same 404/409 error envelope.
  - Blocked By: TODO 3
  - Wave: 3
  - Acceptance Criteria:
    - [ ] **Replaying a `DEAD` row responds 202 and the row reads back as `PENDING`**
          **Verification**: `curl -fsS -X POST "$API_BASE_URL/admin/webhooks/$id/replay" | jq -e '.attemptId'`
    - [ ] **Replaying a `DELIVERED` row responds 409**
          **Verification**: `curl -s -o /dev/null -w '%{http_code}' -X POST "$API_BASE_URL/admin/webhooks/$id/replay" | grep -qx 409`

- [ ] F1. Plan Compliance Audit
  - What to do: Read the plan end-to-end; verify every Must Have is implemented and no Must NOT
    Have pattern appears. Run the T1 keyword scan over the plan body.
  - Wave: FINAL
  - Acceptance Criteria:
    - [ ] **Output line `Must Have [N/N] | Must NOT Have [N/N] | VERDICT` is emitted**
          **Verification**: audit report present in `$OMT_DIR/evidence/webhook-retry/final-qa/`

- [ ] F2. Code Quality Review
  - What to do: Run the change-scoped build, linter, and tests; review the changed files.
  - Wave: FINAL
  - Acceptance Criteria:
    - [ ] **Output line `Build [PASS/FAIL] | Tests [N/N] | VERDICT` is emitted**
          **Verification**: `bun test src/retry-scheduler src/delivery-store src/webhook-dispatcher src/admin-api`

- [ ] F3. QA Scenario Execution
  - What to do: Execute every acceptance criterion from every TODO and the cross-TODO integration
    path (dispatcher failure → scheduler → queue redelivery → replay).
  - Wave: FINAL
  - Acceptance Criteria:
    - [ ] **Output line `Scenarios [N/N pass] | Integration [N/N] | VERDICT` is emitted**
          **Verification**: evidence saved under `$OMT_DIR/evidence/webhook-retry/final-qa/`

- [ ] F4. Scope Fidelity Check
  - What to do: For each TODO, compare the spec against the actual diff; check Must NOT do
    compliance and cross-TODO contamination.
  - Wave: FINAL
  - Acceptance Criteria:
    - [ ] **Output line `Tasks [N/N compliant] | VERDICT` is emitted**
          **Verification**: fidelity report present in `$OMT_DIR/evidence/webhook-retry/final-qa/`

## Execution Strategy

```
Wave 1 (foundation):
+-- TODO 1: DeliveryAttempt persistence
+-- TODO 2: RetryPolicy shape

Wave 2 (core):
+-- TODO 3: retry-scheduler decision logic (depends: 1, 2)

Wave 3 (integration):
+-- TODO 4: dispatcher wiring (depends: 3)
+-- TODO 5: admin replay endpoint (depends: 3)

Wave FINAL (independent review, 4 parallel):
+-- F1: Plan Compliance Audit
+-- F2: Code Quality Review
+-- F3: QA Scenario Execution
+-- F4: Scope Fidelity Check
```

Critical Path: TODO 1 -> TODO 3 -> TODO 5 -> F1-F4

## Verification Strategy

**Test Decision**: Unit tests for the scheduler branch and the policy shape; an integration test
per admin endpoint path; one cross-component integration test for the redelivery loop.

Agent-Executed QA Scenarios are declared per TODO under each TODO's Acceptance Criteria.

## Risk-Domain Pre-Mortem

- **Scenario name** — Retry storm against a degraded subscriber
  - **Trigger condition**: A subscriber returns 503 for every delivery during an outage.
  - **Blast radius**: Every subscription pointing at that host; `delivery-queue` depth grows by
    one scheduled message per failed delivery per attempt, up to 5x baseline.
  - **Detection signal**: Queue-depth metric on `delivery-queue` exceeds its normal ceiling; the
    count of rows in `RETRY_SCHEDULED` rises monotonically.

- **Scenario name** — Migration applied while the dispatcher is live
  - **Trigger condition**: The `delivery_attempt` migration runs during a deploy while
    `webhook-dispatcher` is already handing decisions to `retry-scheduler`.
  - **Blast radius**: In-flight failed deliveries whose row write hits the table mid-migration —
    the attempt is lost and the delivery is silently dropped, the exact defect this plan fixes.
  - **Detection signal**: Insert errors in the `delivery-store` error log; a gap between the
    dispatcher's non-2xx counter and the row count.

- **Scenario name** — Replay double-send to a subscriber
  - **Trigger condition**: An operator replays a row that the guard wrongly reports as `DEAD`.
  - **Blast radius**: The subscriber receives a payload it already rejected or already processed;
    a non-idempotent subscriber double-applies it.
  - **Detection signal**: A subscriber-reported duplicate; two `SENDING` transitions on one row id
    with no intervening terminal state in the transition log.

## Expanded Test Plan

- **unit** — The scheduler's three-way branch (TODO 3 criteria) and the policy shape (TODO 2
  criterion). Backoff bounds are asserted here.
- **integration** — Repository transitions against a live schema (TODO 1 criterion) and both
  admin-endpoint paths (TODO 5 criteria). The dispatcher-to-scheduler handoff (TODO 4 criterion)
  runs here because it crosses a component boundary.
- **e2e** — The redelivery loop end to end, covered by F3's cross-TODO integration path:
  dispatcher failure → scheduler → queue redelivery → replay.
- **observability** — Coverage gap: no criterion currently asserts the queue-depth metric or the
  transition log named as detection signals in the Pre-Mortem. F3 records this gap; wiring the
  metric is out of scope this cycle.

## Success Criteria

### Verification Commands

```bash
bun test src/retry-scheduler src/delivery-store src/webhook-dispatcher src/admin-api
```

### Final Checklist

- [ ] All TODOs completed
- [ ] All QA scenarios pass
- [ ] Evidence artifacts saved to `$OMT_DIR/evidence/webhook-retry/`
- [ ] No scope creep detected
- [ ] F1-F4 all APPROVE

## ADR

### D-1: One `delivery_attempt` row per delivery, reused across attempts

**Tier: contested**

Context:
- The retry pipeline needs somewhere to hold "how many attempts have been made" and "what is the
  current state".
- Subscribers observe delivery behaviour, so the row model leaks into the external contract via
  what a duplicate looks like.

Decision Drivers:
- The admin replay endpoint must return one unambiguous attempt id.
- The subscriber contract documents a 5-attempt ceiling; the count must be readable in one place.
- Operational simplicity: the on-call query is "what is this delivery doing right now".

Considered Options:

Option A — One row per delivery, reused, with an `attempt_count` counter
  Pros: the current state is a single row read; replay has one unambiguous id; no fan-out in the
  table as retries accumulate.
  Cons: per-attempt history (which attempt saw which status code) is not preserved.

Option B — One row per attempt, a new row for each retry
  Pros: full per-attempt history; the transition log falls out of the table for free.
  Cons: every read needs a "latest" qualifier; replay must decide which row it returns; the table
  grows 5x in the worst case for data nobody currently queries.

Decision: Option A — one row per delivery, reused across attempts, carrying `attempt_count`.

Rationale: No consumer of per-attempt history exists today; the on-call query and the replay
endpoint both want the current state, which Option A gives in one read. Option B becomes the right
choice the moment a per-attempt audit requirement appears.

Consequences:
  + `findByWebhookId` returns at most one row, so no "latest" qualifier is needed anywhere.
  + Replay returns the same attempt id it read, so the operator sees a stable identifier.
  - Which attempt saw which status code is not recoverable from the table; only the transition log
    carries it.

Follow-ups: Revisit if an audit requirement for per-attempt status codes appears.

Owns: The row-identity rule; the `attempt_count` counter.
Must NOT own: Transition timing — that is the scheduler's.

Edges: (retry-scheduler→delivery-store.transition, side effect: writes the new state and the
incremented counter onto the one row; admin-api→delivery-store.transition, side effect: resets that
same row to `PENDING` with counter 0)

**Decided state machine for `DeliveryAttempt`** — these are the only transitions, and each one
names the component that performs the write:

- `PENDING → SENDING` — `webhook-dispatcher` writes this immediately before it posts to the
  subscriber, on every delivery it takes off `delivery-queue`.
- `SENDING → DELIVERED` — `webhook-dispatcher` writes this on a 2xx response. This is the one
  state write on the success path; it is an added write, not a change to how the success path
  posts, signs, or logs.
- `SENDING → FAILED` — `retry-scheduler` writes this on a non-retryable status. Terminal.
- `SENDING → RETRY_SCHEDULED` — `retry-scheduler` writes this on a retryable status under
  `maxAttempts`; the counter increments in the same write.
- `SENDING → DEAD` — `retry-scheduler` writes this once `maxAttempts` is reached. Terminal until
  an operator replays.
- `RETRY_SCHEDULED → SENDING` — `webhook-dispatcher` writes this when `delivery-queue` redelivers
  the message after the backoff delay. `webhook-dispatcher` is the only consumer of
  `delivery-queue`.
- `DEAD → PENDING` — `admin-api` writes this on an operator replay; the counter resets to 0.

`webhook-dispatcher` calls `insert` for a delivery that has no row yet, and owns every
`→ SENDING` write; `retry-scheduler` owns the three failure-outcome writes; `admin-api` owns the
replay write.

---

### D-2: Retry decisions live in `retry-scheduler`, not in `webhook-dispatcher`

**Tier: solo**

Decision: `webhook-dispatcher` records the attempt outcome and delegates the retry decision to
`retry-scheduler`. The dispatcher contains no branch on status code beyond 2xx / non-2xx.

Why: The dispatcher already owns the outbound HTTP client and its failure modes. Adding the retry
branch there would couple the transport concern to the scheduling policy, and every policy change
would then touch the transport path.

Invalidated alternative (one line): Branch inline in the dispatcher — rejected because the policy
could not then be tested without standing up the HTTP client.

Cites: `src/webhook-dispatcher/dispatcher.ts`, `src/retry-scheduler/scheduler.ts`

Owns: The three-way retry decision; backoff computation; the `DEAD` transition.
Must NOT own: The outbound HTTP call; queue visibility-timeout configuration.

Edges: (webhook-dispatcher→retry-scheduler.decide, passes attempt result and response status,
returns which of the three outcomes was taken so the dispatcher can log it — the dispatcher does
not act on the value; retry-scheduler→delivery-store.transition, side effect: persists the new
lifecycle state;
retry-scheduler→delivery-queue.enqueue, side effect: schedules the next attempt with a delay;
failure path: delivery-store.transition throws → scheduler re-throws, dispatcher leaves the
row in `SENDING` for the queue's own redelivery to pick up)

---

### D-3: Reuse the `delivery-store` Postgres table rather than a new store

**Tier: solo**

Decision: `DeliveryAttempt` is a new table inside the existing `delivery-store`, not a new
persistence component.

Why: The row is read on exactly one path (the scheduler) and written on two. A separate store
would add an operational surface with no read-scaling justification at this volume. The user
deferred this choice; this is the autonomous decision taken on that deferral.

Invalidated alternative (one line): A dedicated attempt store — rejected as unjustified operational
surface at current volume.

Cites: `src/delivery-store/`

Owns: `DeliveryAttempt` row persistence and lifecycle-state transitions.
Must NOT own: Retry timing decisions; queue interaction.

Edges: (admin-api→delivery-store.findByWebhookId, side effect: none, read-only; failure path: row
absent → repository returns null → admin-api responds 404)

---

### D-4: Replay is admin-only and gated on the `DEAD` state

**Tier: solo**

Decision: `POST /admin/webhooks/{id}/replay` accepts a row only in `DEAD`; any other state
responds 409.

Why: Replaying a row that is still `RETRY_SCHEDULED` would produce two live attempts for one
delivery, and the subscriber would see a duplicate. `DEAD` is the only state with no pending
scheduled work.

Invalidated alternative (one line): Allow replay from `FAILED` too — rejected because `FAILED` is
the contract-error terminal, and replaying it would re-send a payload the subscriber already
rejected as malformed.

Cites: `src/admin-api/routes/webhook-replay.ts`

Owns: The state gate; the reset to `PENDING`; the counter reset; the re-enqueue.
Must NOT own: The retry decision itself.

Edges: (operator→admin-api.replay, passes webhook id; admin-api→delivery-queue.enqueue, side
effect: re-enqueues immediately with no delay; failure path: state is not `DEAD` → admin-api
responds 409 and enqueues nothing)

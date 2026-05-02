# Acceptance Criteria Reference

**If user does not provide acceptance criteria, you MUST draft them.**

## When to Draft

| User Provides | Your Action |
|---------------|-------------|
| Requirements + Acceptance Criteria | Use provided criteria, clarify if ambiguous |
| Requirements only | Draft AC, propose to user for confirmation |
| Vague request | Interview first, then draft based on clarified requirements |

## Drafting Process

1. **Analyze requirements** — Extract implicit success conditions
2. **Draft criteria** — Write measurable, testable conditions
3. **Propose to user** — Present draft and ask for confirmation/modification
4. **Iterate** — Refine based on user feedback
5. **Finalize** — Include confirmed criteria in plan

## Reference Integration (MANDATORY when user provides references)

When the user specifies references ("reference X", "based on Y pattern"):

1. Each reference MUST produce at least one AC item with a **specific behavioral constraint derived from that reference**
2. The constraint must be verifiable without reading the reference itself — self-contained

| Pattern | WRONG | RIGHT |
|---------|-------|-------|
| "reference config.json" | "References config.json" | "Weighting follows priority ranking defined in config.json" |
| "follow prompt-injection.ts pattern" | "Uses prompt-injection.ts pattern" | "Final prompt has 3-layer structure: system instructions, untrusted content with injection-safe delimiter, user prompt" |

If a reference cannot produce a specific behavioral constraint, ask: "What specific aspect of [reference] should the implementation follow?"

## AC Format (MANDATORY)

Each criterion MUST include the following two required lines:

- [ ] **[Observable outcome]**: WHAT state change is visible after completion
      **Verification**: HOW to confirm — executable command, observable behavior, or state assertion

Optional `Setup` / `Cleanup` lines may be added when state mutation requires them — see `## State Mutation: Setup / Cleanup` below.

The criterion is the **contract between planner and executor**. The executor has NO interview context.

## Verification Thinking Checklist

When writing Verification for each criterion, run iteratively until PASS:

| # | Question | On Failure |
|---|----------|------------|
| 1 | **What concrete state is intended?** | Rewrite vague outcomes as specific desired states |
| 2 | **If all verifications pass, is AC fulfillment guaranteed?** | Add missing checks, return to Check 1 |

**Example** — AC: "Extract duplicate validation logic into shared ValidationModule"

```
--- Verification ---
  (1) ValidationModule exports shared validation functions
  (2) UserService and OrderService import from ValidationModule
  (3) No inline validation logic duplicated across services

--- Check 1: Concrete state? ---
  (a) Shared module exists → (1) covers
  (b) Both services use it → (2) covers
  (c) Duplicates removed → (3) covers

--- Check 2: Fulfillment guaranteed? ---
  (1) passes → module exists  (2) passes → used  (3) passes → no duplication
  → PASS
```

## Proposal Format

Organize by **work item** (not by functional/technical category):

1. State the **responsibility** — WHY this work item exists (what goes wrong if removed)
2. List acceptance criteria using the required two-line format (plus optional Setup/Cleanup)
3. Specify what this work item does NOT cover

Overall structure:
- Per-work-item sections with responsibility + criteria + not-scope
- A final "Out of Scope" section for the entire plan
- Review questions for user confirmation

## AC Anti-Patterns

| Anti-Pattern | Example | Why It Fails | Instead |
|-------------|---------|--------------|---------|
| **File listing** | "shared/lib/worker-core.js created with splitCommand" | Implementation detail, not outcome | "Common logic managed from single source. Verification: grep shows both modules import from shared" |
| **Section adding** | "Add ## Model section to SKILL.md" | Action, not verifiable result | "Synthesis protocol contains model weighting instruction" |
| **Vague verification** | "Verify it works", "dry-run review" | Not executable | Name the command, state, or assertion |
| **Task restatement** | "Authentication is implemented" | Restates the task | "Unauthenticated /api/* requests return 401" |
| **Universal truths** | "All tests pass" | Always true, not plan-specific | Move to Verification Strategy |
| **Absence-only** | "X not found in grep" | Deletion alone passes | Write presence checks first, then add absence checks |
| **Compound AC** | "All tests pass", "46 findings resolved", "X and Y implemented" | Bundles multiple independent state changes — one failure hides others | Decompose: one AC per state change, each with its own Verification command |
| **State-mutating without teardown** | "Insert user / Verification: `curl -X POST /users -d @fixture.json`" | Re-runs fail with 409 Conflict; opaque global resets hide preconditions | Prefer (a) runner-native isolation, (b) API-symmetric cleanup, or (c) unique-input scoping (uuidgen) — see Verification Transparency Rule |

## AC Granularity Principle

**1 AC = exactly 1 observable state change.** Each AC must describe a single, atomic outcome confirmed by a single verification command.

> Detail rules — verb red-flag list, batch pattern matrix, rationalization table — live in the reviewer skills (`agents/metis.md` AC Quality Detail Rules / `skills/momus/SKILL.md` AC Quality Detail Rules).

## State Mutation: Setup / Cleanup

If a Verification command mutates state (creates DB rows, writes files, registers users, holds keychain entries), the AC must declare how state is established before the run and torn down after, OR rely on isolation (ephemeral schema, randomized test IDs, container-per-run).

Two optional fields:

- **Setup**: command(s) that establish required state (run before Verification)
- **Cleanup**: command(s) that revert mutations (run after Verification, even on failure)

Either field may be omitted when:
- The Verification is read-only (text scan, GET request, file existence check)
- The runner provides isolation (`--db-schema=test_$RANDOM`, container-per-test, `xcrun simctl erase all`)

When mutations cross persistent boundaries (DB, filesystem outside `/tmp`, simulator state), Setup and Cleanup are STRONGLY recommended.

## Counter-Example: Fixing a Batch AC

### Bad

```
- [ ] All 46 lint findings are resolved
      Verification: grep -c "finding" report.txt → 0
```

This is a Compound AC: it bundles 46 independent state changes into one assertion.

### Good

Decompose by concern. Each finding type becomes its own AC with its own Verification:

```
- [ ] Report contains no forbidden-token occurrence
      Verification: grep -q "forbidden-token" report.txt && echo "FAIL: forbidden-token present" || echo "PASS: forbidden-token absent"

- [ ] Report contains no missing-verdict occurrence
      Verification: grep -q "missing-verdict" report.txt && echo "FAIL: missing-verdict present" || echo "PASS: missing-verdict absent"
```

## Verification Transparency Rule

A reviewer must be able to answer four questions from the AC text alone:

1. What state must exist before Verification? (Setup)
2. What command verifies the requirement? (Verification)
3. What does success look like? (Expected outcome)
4. How is state restored, if needed? (Cleanup)

**Tool-native scenario files** are valid Setup/Verification primitives — the file content IS the contract, auditable in standard tool syntax. Examples: `.maestro/*.yaml`, `tests/*.spec.ts`, `*.test.ts`.

**Always anti-pattern**:
- Pre-seeded shared infrastructure state (rows that "just exist", magic IDs, shared dev accounts)
- Opaque commands that hide what state they produce or assert

**AC ≠ test spec.** AC names precondition, action, and asserted outcome. Click-by-click choreography belongs in the tool-native scenario file, not duplicated in the AC text.

## Choosing the verification tool

Before writing the AC, work through this sequence:

1. **Choose the tool that can observe the target state most directly.** File content → grep. HTTP behavior → curl + jq. Function logic → unit runner. Browser flow → playwright. Native app E2E → maestro. Don't default to the first tool you know.

2. **If the Command API doesn't echo final state, chain a Query API.** POST → 202 → GET /resource/$id → assert. Verification observes the state, not just the action's side effect.

3. **If insufficient state exists for the test, seed it explicitly.** Setup may legitimately create the precondition. Prefer seeding via the same API the test exercises — loud failure if API breaks.

4. **If Setup mutates persistent state, choose the lightest cleanup that works.** Order of preference:
   - Runner-native isolation (in-memory DB, rolled-back transaction, ephemeral container) — no manual cleanup needed
   - API-symmetric cleanup (POST then DELETE via same API)
   - Unique-input scoping (uuidgen-prefixed data, no cleanup needed)

## Verification Examples by Tool

When the Verification can be expressed as a runnable command, prefer one that is self-contained — do not invent ad-hoc shell. For outcome-based or descriptive ACs where a literal command does not fit, plain prose is acceptable.

### Text scan (grep) — for spec/log/output content

- [ ] **Forbidden token absent from report**
      **Verification**: `grep -q "forbidden-token" report.txt && echo FAIL || echo PASS`

### HTTP API (curl + jq)

- [ ] **POST /api/users (201) returns the same record on subsequent GET**
      **Verification**: `email="ac-$(uuidgen)@example.com" && id=$(curl -fsS -X POST http://localhost:8080/api/users -H 'Content-Type: application/json' -d "{\"email\":\"$email\"}" | jq -r '.id') && [ -n "$id" ] && [ "$id" != "null" ] && curl -fsS "http://localhost:8080/api/users/$id" | jq -e --arg id "$id" --arg e "$email" '.id == $id and .email == $e'`
      **Cleanup**: `curl -fsS -X DELETE "http://localhost:8080/api/users/$id" > /dev/null || true`

### Unit / integration test runner

- [ ] **`splitCommand` preserves quoted argument as a single token**
      **Verification**: `bun test tests/splitCommand.test.ts -t "preserves quoted args"`

### Web UI E2E (playwright)

- [ ] **Login with valid credentials lands on Home and shows username**
      **Verification**: `bunx playwright test tests/e2e/login.spec.ts --reporter=junit`
      (If the test mutates backend persistence, chain Query API verification or add API-symmetric cleanup — browser context reset alone doesn't restore backend state.)

### Mobile app E2E (maestro)

- [ ] **Login flow on iOS Simulator reaches Home**
      **Verification**: `maestro test --device "$IOS_UDID" .maestro/auth/login_happy.yaml --format junit`
      (Setup/Cleanup omitted — this flow's first step is `clearState` + `launchApp`, so the flow self-resets per the exemption above. If your flow does not, add explicit Cleanup. If the flow mutates backend persistence beyond app state, chain Query API verification or add API-symmetric cleanup.)

- [ ] **Login flow on Android Emulator reaches Home**
      **Verification**: `maestro test --device "$ANDROID_SERIAL" .maestro/auth/login_happy.yaml --format junit`
      (Setup/Cleanup omitted — this flow's first step is `clearState` + `launchApp`, so the flow self-resets per the exemption above. If your flow does not, add explicit Cleanup. If the flow mutates backend persistence beyond app state, chain Query API verification or add API-symmetric cleanup.)

## Example

**User request:** "council과 spec-review에서 공통 로직을 추출하고, oh-my-claude-sisyphus의 프롬프트 조립 패턴을 참고해서 구조화된 프롬프트 파이프라인을 만들어줘"

## Proposed Acceptance Criteria

### 1. Shared Worker Infrastructure

**Responsibility:** council과 spec-review 워커의 공통 로직을 단일 소스로 통합하여, 이후 변경이 한 곳에서만 이루어지게 한다.

- [ ] 공통 로직(명령어 파싱, 프로세스 스폰, 재시도, 상태 기록)이 하나의 모듈에서 관리된다
      **Verification**: council-worker와 spec-worker 양쪽에서 공통 모듈을 import하며, 중복 함수가 0개
- [ ] 각 워커는 공통 모듈에 스킬별 설정(용어, 디렉토리 구조)만 주입한다
      **Verification**: 워커 파일이 config 객체를 생성하여 공통 모듈에 전달하는 패턴만 포함

**Not covered:** 공통 모듈의 API 설계 (구현자 재량), 테스트 프레임워크 변경

### 2. Structured Prompt Assembly Pipeline

**Responsibility:** 외부 모델이 구조화된 프롬프트를 수신하도록 한다. prompt injection에 취약하지 않도록.

**Required Reference — oh-my-claude-sisyphus:**
- buildPromptWithSystemContext()의 3-layer 조립 구조

- [ ] 최종 프롬프트가 3-layer 계층 구조를 가진다: (1) system instructions, (2) untrusted content with injection-safe delimiter, (3) user prompt
      **Verification**: 전송 로그에서 delimiter 패턴(`===UNTRUSTED` 등)이 확인됨
- [ ] role prompt 파일이 없는 member는 기존 동작(raw prompt)으로 graceful fallback한다
      **Verification**: role prompt 없이 실행 시 에러 없이 기존 출력과 동일

**Not covered:** role prompt 파일 내용 작성, Codex 에이전트 포맷 변환

### Out of Scope (explicitly excluded)
- Dynamic member selection, sequential cross-validation
- UI payload 구조 변경

---
**Please review:**
1. Are these criteria correct and complete?
2. Any criteria to add, modify, or remove?
3. Any priorities among these criteria?

## Handling User Response

| User Response | Your Action |
|---------------|-------------|
| "Looks good" / "Approved" | Proceed to Metis consultation with these criteria (see review-pipeline.md) |
| Modifications requested | Update criteria, re-propose if significant changes |
| "Just do it" / Skips review | Use your draft as-is, note in plan that criteria were AI-generated |

**NEVER proceed to plan generation without acceptance criteria.**

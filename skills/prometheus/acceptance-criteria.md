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

## Execution Semantics

Setup, Verification, and Cleanup blocks share a single shell session by contract. Variables set in earlier blocks (Setup, Verification) are visible to later blocks (Cleanup). The executor runs them as a chained expression or within the same shell process, NOT as separate `bash -c` invocations.

This contract enables the canonical pattern:

- Setup creates a resource and exports its ID
- Verification reads the resource using the exported ID
- Cleanup deletes the resource using the same ID

Even with this contract, defensive Cleanup guards against unset/empty IDs (in case Setup or Verification fails before assignment): `[ -n "$id" ] && curl -X DELETE ".../$id" || true`. The guard prevents a destructive collapse to a collection endpoint URL when the resource was never created.

### Required chaining template

The executor MUST chain Setup, Verification, and Cleanup so that (a) Cleanup runs unconditionally and (b) Verification's exit code is preserved as the AC outcome.

```bash
setup_cmd && { verify_cmd; VERIFY_EXIT=$?; } || VERIFY_EXIT=$?
cleanup_cmd
exit ${VERIFY_EXIT:-1}
```

Forbidden patterns:

| Pattern | Why forbidden |
|---------|---------------|
| `verify_cmd && cleanup_cmd` | Skips Cleanup on verification failure → resource leak |
| `verify_cmd; cleanup_cmd` | Cleanup's exit code masks verification failure → false PASS |

## Executor-Provided Variables

AC Verification commands may reference ambient variables listed below. The executor (Argus) exports these during the Stage 3 substep listed in the "Provided by" column. AC text must NOT inline the derivation of these variables — derivation lives with the executor as the single source of truth.

| Variable | Scope | Provided by |
|----------|-------|-------------|
| `$API_BASE_URL` | HTTP API ACs | Argus Stage 3, Step 3.2 (server boot) |
| `$IOS_UDID` | iOS mobile ACs | Argus Stage 3, Step 3.5 (simulator boot) |
| `$ANDROID_SERIAL` | Android mobile ACs | Argus Stage 3, Step 3.5 (emulator boot) |
| `$evidence_xml` | Tool ACs that emit a report file (`maestro --output`, `playwright --reporter=junit ... --output`) | Argus Stage 3 (per-AC, resolved via Evidence Path Priority before each verification) |

Adding a new contract variable requires (1) updating this table and (2) ensuring the executor exports it in the corresponding Stage. New variables should be introduced only when at least two AC kinds reference them; otherwise inline.

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
      Verification: [ -f report.txt ] && ! grep -q "forbidden-token" report.txt && echo "PASS: forbidden-token absent"

- [ ] Report contains no missing-verdict occurrence
      Verification: [ -f report.txt ] && ! grep -q "missing-verdict" report.txt && echo "PASS: missing-verdict absent"
```

## AC verification layer

AC measures whether the deliverable is *valuable to its consumer*. "Consumer" varies per task:

| Deliverable type | Consumer | AC verification layer |
|-------------|--------|----------------|
| Mobile feature | End user | UI scenario (Maestro) |
| Web feature | End user | UI scenario (Playwright) |
| HTTP API | API client | integration (curl + jq) |
| CLI command | shell user | command exec + stdout assertion |
| Library function | calling developer or agent | unit test allowed (justification required) |

> Terminology: this spec uses **consumer boundary** consistently — equivalent to "consumer-facing surface" or hexagonal architecture's "outer ring".

Principle: **verify at the consumer boundary the consumer observes.** Internal unit verification (`*.test.ts`) is implementation evidence, not default AC — see [Implementation test files caveat](#implementation-test-files-caveat).

### AC self-check (mandatory before finalizing)

Run this checklist on every AC before proposing to the user:

- [ ] If this verification passes, does the consumer actually receive value?
- [ ] Does an implementation exist that passes this verification vacuously? If yes, the verification layer is too deep — move outward.
- [ ] If citing a unit test as AC, did you justify the unit as consumer-facing (per the three questions in [Implementation test files caveat](#implementation-test-files-caveat))?

**Anti-tautology rule**: Prometheus (planner) must specify the assertion's input/output or behavioral constraint in the AC itself. Do not delegate "what counts as a passing test" to Sisyphus-junior (executor) — that creates meta-circular verification.

## Verification Transparency Rule

A reviewer must be able to answer four questions from the AC text alone:

1. What state must exist before Verification? (Setup)
2. What command verifies the requirement? (Verification)
3. What does success look like? (Expected outcome)
4. How is state restored, if needed? (Cleanup)

**Scenario files** (executable specifications) are valid Setup/Verification primitives — the file content IS the contract, auditable in standard tool syntax. These describe user/external-observable behavior directly. Examples: `.maestro/*.yaml`, Playwright `tests/e2e/*.spec.ts`.

### Implementation test files (caveat)

(Jest/Vitest `*.test.ts` or `*.spec.ts`) verify internal units. **They are NOT default AC primitives** — they are implementation evidence. A unit test can be cited as AC verification only when the unit IS the consumer boundary (CLI utility export, public library API, pure transformation function). When citing a unit test as AC, the AC must specify:

1. Who is the consumer of this unit?
2. Where is this unit invoked directly (file:line citation)?
3. Why is this unit the consumer boundary (not internal helper)?

**Always anti-pattern**:
- Pre-seeded shared infrastructure state (rows that "just exist", magic IDs, shared dev accounts)
- Opaque commands that hide what state they produce or assert

**AC ≠ test spec.** AC names precondition, action, and asserted outcome. Click-by-click choreography belongs in the tool-native scenario file, not duplicated in the AC text.

## Choosing the verification tool

Before writing the AC, work through this sequence:

1. **Choose the tool that observes the target state at the consumer boundary.** UI flow → maestro/playwright. HTTP API behavior → curl + jq. CLI behavior → command exec + stdout assertion. File content → grep. Internal function logic → implementation test runner (NOT AC by default — see [Implementation test files caveat](#implementation-test-files-caveat)). Don't default to the first tool you know; default to the consumer boundary.

2. **If the Command API doesn't echo final state, chain a Query API.** POST → 202 → GET /resource/$id → assert. Verification observes the state, not just the action's side effect.

3. **If insufficient state exists for the test, seed it explicitly.** Setup may legitimately create the precondition. Prefer seeding via the same API the test exercises — loud failure if API breaks.

4. **If Setup mutates persistent state, choose the lightest cleanup that works.** Order of preference:
   - Runner-native isolation (in-memory DB, rolled-back transaction, ephemeral container) — no manual cleanup needed
   - API-symmetric cleanup (POST then DELETE via same API)
   - Unique-input scoping (uuidgen-prefixed data, no cleanup needed)

## Verification Examples by Tool

When the Verification can be expressed as a runnable command, prefer one that is self-contained — do not invent ad-hoc shell. For outcome-based or descriptive ACs where a literal command does not fit, plain prose is acceptable.

### Mobile app E2E (maestro)

- [ ] **Login flow on iOS Simulator reaches Home**
      **Verification**: `maestro --device "$IOS_UDID" test .maestro/auth/login_happy.yaml --format junit --output "$evidence_xml"`
      (Setup/Cleanup omitted — this flow's first step is `clearState` + `launchApp`, so the flow self-resets per the exemption above. If your flow does not, add explicit Cleanup. If the flow mutates backend persistence beyond app state, chain Query API verification or add API-symmetric cleanup.)

- [ ] **Login flow on Android Emulator reaches Home**
      **Verification**: `maestro --device "$ANDROID_SERIAL" test .maestro/auth/login_happy.yaml --format junit --output "$evidence_xml"`
      (Setup/Cleanup omitted — this flow's first step is `clearState` + `launchApp`, so the flow self-resets per the exemption above. If your flow does not, add explicit Cleanup. If the flow mutates backend persistence beyond app state, chain Query API verification or add API-symmetric cleanup.)

> Mobile ACs assume `$IOS_UDID` / `$ANDROID_SERIAL` are exported by Argus Stage 3.5 — see § Executor-Provided Variables above.

### Web UI E2E (playwright)

- [ ] **Login with valid credentials lands on Home and shows username**
      **Verification**: `bunx playwright test tests/e2e/login.spec.ts --reporter=junit`
      (If the test mutates backend persistence, chain Query API verification or add API-symmetric cleanup — browser context reset alone doesn't restore backend state.)

### HTTP API (curl + jq)

- [ ] **POST /api/users (201) returns the same record on subsequent GET**
      **Setup**: `email="ac-$(uuidgen)@example.com" && id=$(curl -fsS -X POST "$API_BASE_URL/api/users" -H 'Content-Type: application/json' -d "{\"email\":\"$email\"}" | jq -r '.id') && [ -n "$id" ] && [ "$id" != "null" ]`
      **Verification**: `curl -fsS "$API_BASE_URL/api/users/$id" | jq -e --arg id "$id" --arg e "$email" '.id == $id and .email == $e'`
      **Cleanup**: `[ -n "$id" ] && curl -fsS -X DELETE "$API_BASE_URL/api/users/$id" > /dev/null || true`

### Text scan (grep) — for spec/log/output content

- [ ] **Forbidden token absent from report**
      **Verification**: `[ -f report.txt ] && ! grep -q "forbidden-token" report.txt`

### CLI exec + stdout

- [ ] **`./bin/migrate --dry-run` reports planned migrations to stdout**
      **Verification**: `./bin/migrate --dry-run | grep -qE '^[+-] migrations/[0-9]+_'`

### Implementation test runner (caveat — NOT default AC)

Unit/integration test runners (`bun test ...`, `vitest ...`) are **implementation evidence**, not default AC primitives. They can be cited as AC verification ONLY when the tested unit IS the consumer boundary — see [Implementation test files caveat](#implementation-test-files-caveat).

Legitimate use (unit IS the consumer surface):

- [ ] **`splitCommand` (public library export) preserves quoted arguments as a single token**
      **Verification**: `bun test tests/splitCommand.test.ts -t "preserves quoted args"`
      Consumer: library callers (other developers/agents) invoking via `import { splitCommand } from '...'`. Consumer boundary = exported function signature.

Illegitimate use (unit is internal helper):

> ~~**`UserService.create` rejects duplicate email**~~
> ~~Verification: Unit test asserts result when repository returns existing user~~

→ instead, verify at the HTTP boundary that `POST /api/users` with duplicate email returns 409. The internal method behavior is implementation evidence.

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

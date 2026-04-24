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

Each criterion MUST follow this two-line structure:

- [ ] **[Observable outcome]**: WHAT state change is visible after completion
      **Verification**: HOW to confirm — executable command, observable behavior, or state assertion

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
2. List acceptance criteria using the two-line format
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

## AC Granularity Principle

**1 AC = exactly 1 observable state change.** Each AC must describe a single, atomic outcome confirmed by a single verification command.

> Detail rules — verb red-flag list, batch pattern matrix, rationalization table — live in the reviewer skills (`agents/metis.md` AC Quality Detail Rules / `skills/momus/SKILL.md` AC Quality Detail Rules).

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

# Prometheus Skill — Application Test Scenarios

## Purpose

These scenarios test whether the prometheus skill's **core techniques** are correctly applied. Each scenario targets request interpretation, forbidden actions, context brokering, sequential interview, question quality, question type selection, vague answer clarification, user deferral handling, acceptance criteria drafting, plan generation with metis consultation, and subagent selection.

## Technique Coverage Map

| # | Scenario | Primary Technique | Secondary |
|---|---------|-------------------|-----------|
| P-1 | Request Interpretation | Request Interpretation | Output Restriction |
| P-2 | Forbidden Actions | Forbidden Actions | Output Restriction |
| P-3 | Context Brokering Protocol | Context Brokering Protocol | Subagent Selection |
| P-4 | Sequential Interview + Persistence | Sequential Interview + Persistence | Question Anti-Patterns |
| P-5 | Question Quality + Rich Context Pattern | Question Quality Standard + Rich Context Pattern | - |
| P-6 | Question Type Selection | Question Type Selection | - |
| P-7 | Vague Answer Clarification | Vague Answer Clarification | (multi-turn) |
| P-8 | User Deferral Handling | User Deferral Handling | (multi-turn) |
| P-9 | Acceptance Criteria Drafting | Acceptance Criteria Drafting | - |
| P-10 | Plan Generation + Metis Consultation | Plan Generation + Metis Consultation | Plan Language (English) |
| P-11 | Subagent Selection | Subagent Selection | Context Brokering |
| P-12 | Plan Template Structure | Plan Template Structure | Plan Generation |
| P-13 | Clearance Checklist | Clearance Checklist | Sequential Interview |
| P-14 | Metis Feedback Loop | Metis Feedback Loop | Plan Generation + Gap Classification |
| P-15 | Failure Mode Avoidance | Failure Mode Avoidance | Sequential Interview + Plan Generation |
| P-16 | Context Loading | Context Loading | Context Brokering Protocol |
| P-17 | Intent Classification | Intent Classification | Interview Mode |
| P-18 | Execution Strategy in Plan | Execution Strategy | Plan Template Structure |
| P-19 | QA Scenarios in TODO | QA Scenarios | Plan Template Structure |
| P-23 | Scenario Verification Principle | Scenario Verification Principle Declaration | - |
| UC-P1 | End-to-End: Full Planning Pipeline | Full workflow integration | Classification + Interview + Clearance + AC + Metis + Co-Design (Daedalus advisory + human design gate) + Plan + Momus + Execution |
| UC-P2 | End-to-End: Review Pipeline Rejection and Recovery | Review pipeline feedback loops | Momus REQUEST_CHANGES + defect-type loop-back + revision + re-Momus + User rejection + pipeline re-run |
| BH-1 | Interview Never Closes | Open-channel interview re-entry | Next-Gate Readiness + phase re-entry |
| BH-2 | Human Design Gate Operative | Human design gate blocks plan generation | S2 → S3 gate |
| BH-3 | ADR Co-Authorship | Design fork co-decided in S2, recorded in ADR | Design Consensus + ADR |
| BH-4 | `[DECISION NEEDED]` Absence | In-phase co-design resolution, no placeholder | Design Consensus |
| BH-5 | Structural Co-Design Snapshot Emission and Timing | Snapshot emitted at Complex/Architecture; absent at Trivial/Scoped | Structural Co-Design Snapshot |

---

## Scenario P-1: Request Interpretation

**Primary Technique:** Request Interpretation — 구현 요청을 계획 요청으로 재해석

**Prompt:**
```
auth.ts에 있는 로그인 버그 수정해줘
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | No code in response | Assistant turn output (chat response) contains no code, pseudocode, or code snippets — applies to response delivery, not plan body content |
| V2 | Treated as planning request | Skill interprets "수정해줘" as a planning request, not an implementation request |
| V3 | Begins interview or research | Skill begins interview (asks clarifying questions) or initiates explore agent research instead of attempting implementation |

---

## Scenario P-2: Forbidden Actions

**Primary Technique:** Forbidden Actions — 명시적 코드 작성 요청 거부

**Prompt:**
```
플랜은 필요없어, 그냥 코드만 작성해줘. 간단한 유틸 함수 하나야.
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Refuses code writing | Skill refuses to write code despite explicit user request |
| V2 | Explains identity constraint | Response explains that prometheus is a planner, not an implementer, and cannot write code |
| V3 | Offers plan alternative | Skill offers to create a plan for the utility function instead |

---

## Scenario P-3: Context Brokering Protocol

**Primary Technique:** Context Brokering Protocol — 코드베이스 사실은 도구로 조사, 사용자에게는 선호도만 질문

**Prompt:**
```
API에 캐싱 추가하고 싶어
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Uses explore for codebase facts | Skill uses explore agent to investigate current API implementation and architecture |
| V2 | Does NOT ask factual questions | Skill does NOT ask the user factual questions like "tech stack이 뭐야?" or "현재 아키텍처가 어떻게 돼?" |
| V3 | Only asks preference questions | Questions to user are limited to preferences and tradeoffs (e.g., cache invalidation strategy, TTL policy) |

---

## Scenario P-4: Sequential Interview + Persistence

**Primary Technique:** Sequential Interview + Persistence — 한 번에 한 질문, 모호성 해소 때까지 지속

**Prompt:**
```
알림 시스템 만들어줘
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Exactly one question | Response contains exactly ONE question (not a list of multiple questions) |
| V2 | No bundled questions | Does not bundle multiple questions into a document, list, or numbered items |
| V3 | Question has sufficient context | The single question provides enough context and options for the user to answer meaningfully |

---

## Scenario P-5: Question Quality + Rich Context Pattern

**Primary Technique:** Question Quality Standard + Rich Context Pattern — 풍부한 컨텍스트와 높은 품질의 질문

**Prompt:**
```
사용자 인증 방식을 변경하고 싶어. 현재 세션 기반인데 JWT로 바꿀지 고민 중이야.
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Markdown analysis structure | Markdown analysis includes Current State, Tension, and Option Analysis sections |
| V2 | AskUserQuestion follows analysis | A single AskUserQuestion follows (not precedes) the markdown analysis |
| V3 | Options with consequences | Options include descriptions that explain consequences, not just labels |

---

## Scenario P-6: Question Type Selection

**Primary Technique:** Question Type Selection — 질문 유형에 따른 적절한 방법 선택

**Prompt (open-ended):**
```
이 프로젝트의 장기 비전이 뭐야?
```

**Prompt (structured):**
```
캐시 전략을 Redis로 갈지 Memcached로 갈지 결정해야 해
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Open-ended uses plain text | Open-ended question ("장기 비전") is asked in plain text, NOT via AskUserQuestion tool |
| V2 | Structured uses AskUserQuestion | Structured decision between 2-3 concrete options uses AskUserQuestion with 2-4 options |

---

## Scenario P-7: Vague Answer Clarification (Multi-turn)

**Primary Technique:** Vague Answer Clarification — 모호한 답변을 수용하지 않고 명확화 요청

**Turn 1 — Input:**
```
검색 기능에 자동완성 추가하고 싶어
```

**Turn 1 — Expected:**
Skill asks a clarifying question about the autocomplete feature (e.g., data source, trigger behavior, result limit).

**Turn 2 — Input:**
```
음... 그 정도면 될 것 같아. 대충 적당히 해줘.
```

**Turn 2 — Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Does not accept vague answer | Skill does not proceed with "대충 적당히" as a valid answer |
| V2 | Asks specific follow-up | Skill asks a specific follow-up question to clarify what "그 정도" means |
| V3 | Repeats until clear | Skill continues probing until a clear, actionable answer is obtained |

---

## Scenario P-8: User Deferral Handling (Multi-turn)

**Primary Technique:** User Deferral Handling — 사용자 위임 시 자율적 조사 및 결정

**Turn 1 — Input:**
```
파일 업로드 기능 추가해줘. 이미지랑 PDF 지원해야 해.
```

**Turn 1 — Expected:**
Skill asks about a design choice (e.g., storage approach, file size limit, validation strategy).

**Turn 2 — Input:**
```
잘 모르겠어, 네가 알아서 결정해줘.
```

**Turn 2 — Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Does NOT keep asking | Skill does not repeat the same question or ask further preference questions on the deferred topic |
| V2 | Researches autonomously | Skill uses explore/librarian agents to research best practices or codebase patterns |
| V3 | Selects approach | Skill autonomously selects an approach based on research results |
| V4 | Documents autonomous decision | Decision is documented as "Autonomous decision: [X] - user deferred, based on [reason]" |

---

## Scenario P-9: Acceptance Criteria Drafting

**Primary Technique:** Acceptance Criteria Drafting — 인수 조건 미제공 시 필수 작성

**Prompt:**
```
헤더에 로그아웃 버튼 추가해줘
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Work-item structure with responsibility | AC organized by work item, each with a responsibility statement explaining WHY the item exists separately |
| V2 | Two-line criterion format | Each criterion follows Observable outcome + indented Verification line structure |
| V3 | Out of Scope and Not covered | Per-item "Not covered" section + overall "Out of Scope" section present |
| V4 | Proposes to user for confirmation | Skill presents the draft AC to the user and asks for review/confirmation |

---

## Scenario P-10: Plan Generation + Metis Consultation (Multi-turn)

**Primary Technique:** Plan Generation + Metis Consultation — 플랜 생성 전 필수 Metis 검증

**Turn 1-N — Setup:**
Interview is completed (all clarifying questions answered, acceptance criteria confirmed). Metis (S1 requirements gate) → APPROVE. S2 Co-Design (in-phase Daedalus advisory + human design gate) precedes plan write — the user has given explicit holistic design approval at the human design gate.

**Final Turn — Input:**
```
플랜 만들어줘
```

**Final Turn — Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Metis consultation before plan | Metis (S1 requirements gate) is consulted BEFORE the plan is written (not after or skipped), and the S2 Co-Design (Daedalus advisory + human design gate) precedes the plan write — the plan is NOT written until the user gives explicit design approval at the S2 human design gate |
| V2 | Plan saved to .omt/plans/ | Plan file is saved to `.omt/plans/*.md` path |
| V3 | Plan content in English | Plan content (body, tasks, criteria) is written in English |
| V4 | Plan contains Work Objectives and per-TODO AC | Plan includes Work Objectives (Must Have / Must NOT Have) and each TODO specifies acceptance criteria |

---

## Scenario P-11: Subagent Selection

**Primary Technique:** Subagent Selection — 올바른 에이전트 라우팅 (explore vs librarian)

**Prompt:**
```
React 공식 문서에서 Server Components 패턴 참고해서 우리 프로젝트에 적용하는 계획 짜줘
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Librarian for external docs | Skill uses librarian agent for React official documentation (external source) |
| V2 | Explore for codebase search | Skill uses explore agent for "우리 프로젝트" codebase investigation |
| V3 | Never reverses agent roles | Librarian is NOT used for codebase search; explore is NOT used for external documentation |

---

## Scenario P-12: Plan Template Structure

**Primary Technique:** Plan Template Structure — 생성된 플랜이 구조화된 템플릿을 따르는지 검증

**Turn 1-N — Setup:**
Interview is completed (all clarifying questions answered, acceptance criteria confirmed). User triggers plan generation.

**Final Turn — Input:**
```
결제 시스템에 환불 기능 추가하는 플랜 만들어줘
```

**Final Turn — Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | TL;DR section exists | Plan begins with a TL;DR section containing Quick Summary, Deliverables, and Estimated Effort fields |
| V2 | Must NOT Have section exists | Plan contains a "Must NOT Have (Guardrails)" section with explicit exclusions and scope boundaries |
| V3 | TODOs have rich "What to do" + two-line AC | Every TODO's "What to do" faithfully transfers interview conclusions (content, scope, approach, inputs, decisions); acceptance criteria follow the two-line format (Observable outcome + Verification line) |
| V4 | Context section with Interview Summary | Plan includes Context section containing Interview Summary (key decisions from extended interview) |
| V5 | Verification Strategy section present | Plan includes Verification Strategy with Test Decision, and Agent-Executed QA Scenarios for each TODO |
| V6 | TODOs have populated References | Every TODO includes at least one Pattern or API/Type reference with WHY explanation; OR for greenfield tasks where no existing code patterns or types exist, states "Greenfield — no existing pattern" explicitly |
| V7 | Agent anonymity in plan body | The plan body (Context / Interview Summary / WHY / any TODO field) records established facts without attributing them to a producing agent — no "oracle confirmed" / "explore found" / "per the reviewer" / "N oracle passes" style source-attribution to explore / librarian / oracle / Metis / Momus. Bare domain use of such words (e.g. "Oracle DB") is allowed; what is absent is agent-as-source attribution, not the tokens themselves |

---

## Scenario P-13: Clearance Checklist

**Primary Technique:** Clearance Checklist — 인터뷰 후 플랜 생성 전 6항목 자가 점검 수행

**Turn 1 — Input:**
```
사용자 프로필에 아바타 업로드 기능 추가하고 싶어
```

**Turn 1 — Expected:**
Skill asks a clarifying question (e.g., supported image formats, size limit, storage approach).

**Turn 2 — Input:**
```
PNG랑 JPG만 지원하면 돼. 5MB 제한으로. 플랜 만들어줘.
```

**Turn 2 — Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | 6-item checklist evaluated | Skill internally evaluates all 6 clearance items: (1) Core objective defined, (2) Scope boundaries established, (3) No critical ambiguities, (4) Technical approach validated, (5) Test/verification strategy identified, (6) Ambiguity Score ≤ 0.2 |
| V2 | Fails checklist → continues interview | If any checklist item is NOT satisfied (e.g., test strategy not identified, Ambiguity Score > 0.2), skill continues interview instead of generating plan |
| V3 | Auto-proceed to AC drafting after clearance | When all 6 checks pass, Prometheus automatically proceeds to Acceptance Criteria Drafting — does NOT wait for explicit user trigger. After AC confirmation, Metis is auto-invoked (see review-pipeline.md) |

---

## Scenario P-14: Metis Feedback Loop

**Primary Technique:** Metis Feedback Loop — 플랜 생성 전 Metis 상담, 결과를 플랜에 반영 및 갭 분류

**Turn 1-N — Setup:**
Interview is completed (all clarifying questions answered, acceptance criteria confirmed, clearance checklist passed).

**Final Turn — Input:**
```
실시간 알림 기능 WebSocket으로 구현하는 플랜 생성해줘
```

**Final Turn — Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Metis invoked before plan generation | Metis agent is summoned BEFORE the plan is written, with interview context (user's goal, key discussions, research findings) passed to Metis |
| V2 | Metis gaps addressed in plan | Gaps identified by Metis are incorporated into the generated plan (reflected in guardrails/TODOs) — not ignored or deferred |
| V3 | Gap Classification routes via open channel | Each identified gap is classified MINOR (self-resolve inline), AMBIGUOUS (apply documented default, note in plan), or CRITICAL (requires user input). A CRITICAL gap is NOT carried forward and is NOT batched into a late "decisions needed" gate: a requirements fork re-opens the S0 interview; a design fork re-opens the S2 Co-Design channel and is co-decided at the human design gate (the channel stays open per the Next-Gate Readiness Rule). No CRITICAL fork is silently absorbed |
| V4 | Self-Review Checklist executed | After plan generation, self-review checklist is performed: all TODOs have acceptance criteria, file references exist, guardrails from Metis incorporated, design forks resolved, zero human-intervention criteria |

---

## Scenario P-15: Failure Mode Avoidance

**Primary Technique:** Failure Mode Avoidance — 과잉 계획, 과소 계획, 조기 생성 회피

**Prompt (over-planning test):**
```
헤더 컴포넌트에 다크모드 토글 버튼 추가해줘
```

**Prompt (premature generation test):**
```
검색 기능에 필터 추가하고 싶어
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Plan has 3-6 steps (not 30 micro-steps) | For a simple feature like dark mode toggle, plan contains 3-6 high-level tasks with rich outcome descriptions and two-line acceptance criteria — NOT 20-30 granular micro-steps or planner-assumed implementation technique |
| V2 | No plan generated before Clearance | For the filter feature request, skill enters interview mode and does NOT generate a plan until the Clearance Checklist passes — premature generation before all 6 checks pass is avoided |
| V3 | No under-planning | Each task is broken into verifiable chunks — no single task like "Step 1: Implement the feature" without further breakdown |
| V4 | No architecture redesign | Skill proposes targeted changes that work within existing codebase patterns — does NOT suggest rewriting the entire component or introducing new frameworks unnecessarily |

---

## Scenario P-16: Context Loading

**Primary Technique:** Context Loading — trust level 경계에서의 올바른 판단 (아키텍처 vs 파일-레벨 사실)

**Prompt (context available):**
```
기존 JWT 인증을 OAuth 2.0으로 마이그레이션해줘
```

**Prompt (context absent):**
```
기존 JWT 인증을 OAuth 2.0으로 마이그레이션해줘
```
(Same prompt, but `~/.omt/$OMT_PROJECT/context/` does not exist)

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Trust level boundary judgment | Context file says "JWT auth in auth/ module" — skill uses this directly for architecture-level question (does NOT dispatch explore for "what auth method do we use?"). But for "auth middleware 정확한 파일 위치", skill dispatches explore (file-level fact requires verification) |
| V2 | Partial context handling | If only project.md and decisions.md exist but conventions.md and gotchas.md are missing — skill reads available files, skips missing ones silently, does NOT ask user about missing files |
| V3 | Context ≠ ground truth for specifics | Even when context file covers "auth architecture", specific implementation details (exact function signatures, current line numbers) are verified via explore. Context informs the question, explore confirms the facts |
| V4 | Graceful degradation | When context directory does not exist, skill proceeds directly to Intent Classification without error message, without mentioning missing context to user, without asking user to create context files |

---

## Scenario P-17: Intent Classification

**Primary Technique:** Intent Classification — 경계 케이스와 스코프 불확실성에서의 정확한 분류 판단

**Prompt (boundary — Trivial vs Scoped):**
```
auth.ts, payment.ts, user.ts 3개 파일에서 에러 메시지 한글화해줘
```

**Prompt (boundary — Scoped vs Complex):**
```
결제 모듈에 환불 기능 추가해줘
```

**Prompt (Architecture — clear):**
```
마이크로서비스 아키텍처로 모노리스 분해 계획 세워줘
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Boundary judgment: multi-file simple change | "에러 메시지 3곳 한글화" involves 3 files but trivial per-file changes — classified as Scoped (multi-file = not Trivial), NOT Complex (each change is simple). Interview is standard depth, not deep |
| V2 | Scope-unknown triggers explore before classification | "환불 기능 추가" — scope unclear from request alone (could be 1 file or 10). Skill dispatches explore to understand current payment module structure BEFORE committing to a classification |
| V3 | Architecture triggers Oracle MANDATORY | "마이크로서비스 분해" classified as Architecture regardless of how user frames it. Oracle dispatched with NO EXCEPTIONS. explore + librarian dispatched in parallel |
| V4 | Classification affects depth, NOT Clearance | Scoped request ("한글화") gets standard interview (3-5 questions). Architecture request ("모노리스 분해") gets deep interview with explore mandatory before questions. But BOTH go through identical 6-item Clearance Checklist |

---

## Scenario P-18: Execution Strategy in Plan

**Primary Technique:** Execution Strategy — 의존성 모델링과 Wave 배정의 정확성

**Prompt:**
```
사용자 인증 시스템 구현해줘
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Dependency accuracy | Blocked By/Blocks correctly reflect actual task dependencies — e.g., "API endpoint creation" blocks "integration test" but is NOT blocked by "DB schema" if the endpoint can be stubbed. Dependencies are causal, not sequential by convention |
| V2 | Wave assignment correctness | Tasks sharing no dependencies are in the same wave. No task is assigned to a wave later than (blocker's wave + 1). Independent tasks are NOT artificially serialized into separate waves |
| V3 | Critical Path is longest chain | Critical Path follows the longest dependency chain through the task graph — not the first path found or an arbitrary selection. If Task A→C→E and Task B→D→E, and path A→C→E is longer, it is the Critical Path |
| V4 | Rule compliance | Minimum 2 tasks per wave (except final wave), max 3-4 waves for a 3-6 task plan, no circular dependencies. If plan has 4 independent tasks, they should be in 1-2 waves, NOT spread across 4 |

---

## Scenario P-19: QA Scenarios in TODO

**Primary Technique:** QA Scenarios — 실행 가능하고 의미있는 검증 시나리오 작성 품질

**Prompt (mixed code + non-code):**
```
API rate limiting 기능 추가하고 관련 문서도 업데이트해줘
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Steps are agent-executable | Steps field contains concrete commands or actions (e.g., `curl -X POST /api/resource 101 times`, `grep 'rate-limit' README.md`) — NOT vague statements like "verify the feature works" or "check that limiting is applied" |
| V2 | Failure scenario is non-trivial | Edge case scenario tests an actual failure mode specific to the task (e.g., "rate limit counter resets after window expires", "concurrent requests from same IP handled correctly") — NOT generic "invalid input returns error" |
| V3 | Non-code TODO uses full QA format with appropriate verification tool | Documentation update TODO uses grep/diff as Tool with concrete Steps — same rigor as code TODOs |
| V4 | Tool field is executable CLI command | Names an executable CLI command (e.g., `bun test`, `curl`, `grep`, `./gradlew test`), NOT a test description ("Header validation") or generic label ("test runner"). The named command must match what Steps actually invoke |

---

## Use-Case Scenarios (End-to-End)

These scenarios test whether the skill's core techniques work correctly **when combined across multiple phases**. Each scenario spans the full workflow or a significant multi-phase sequence.

---

## Scenario UC-P1: End-to-End — Full Planning Pipeline

**Primary Technique:** Full workflow integration — Classification → Interview (S0) → Clearance → AC → Metis (S1 requirements gate) → Co-Design (S2: in-phase Daedalus advisory + human design gate) → Plan (S3) → Momus (S4 plan gate) → Presentation → Execution Bridge

**Input (Multi-turn):**
```
Turn 1:
User says: "결제 모듈에 환불 기능 추가해줘"

Turn 2 (after explore + interview):
Scope clarified: partial refund supported, 30-day window, existing payment patterns.
Clearance Checklist all YES. Ambiguity ≤ 0.2.

Turn 3:
AC drafted and confirmed by user.

Turn 4:
Metis invoked (S1 requirements gate) → APPROVE.

Turn 5 (S2 Co-Design):
Open co-design interview opens. In-phase Daedalus advisory pass returns design
tradeoffs (steelman antithesis on refund-window placement); folded into the dialogue.
Co-authored ADR filled with the user. User gives explicit holistic design approval
at the human design gate.

Turn 6 (S3):
Plan written to $OMT_DIR/plans/refund-feature.md from the approved design.

Turn 7 (S4):
Momus invoked (plan gate) → COMMENT ("payment-service.ts reference at line 20-75 is
accurate; TODO 3 acceptance criteria could be more specific"). Findings incorporated
silently, proceed.

Turn 8 (S5 + S7):
Full plan presented to user (S5). User reviews the rendered plan.
Execution Bridge: User selects "(1) Full orchestration".
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Intent classified before interview | "환불 기능 추가" classified as Scoped or Complex BEFORE interview questions begin. Explore dispatched if scope unknown |
| V2 | Interview asks preferences, not codebase facts | Questions target scope (partial refund?), tradeoffs (refund window?), priorities — NOT "결제 모듈 어디에 있어?" |
| V3 | Clearance gates interview exit | Interview continues until all 6 checklist items pass. Does NOT exit early after 2-3 questions |
| V4 | AC follows two-line format with responsibility | Each criterion: Observable outcome + Verification. Work items have responsibility statements |
| V5 | Metis invoked BEFORE Co-Design, with 3-Section template | Metis (S1 requirements gate) called with USER GOAL + SCOPE + AC verbatim. No summarizing. Called before the Co-Design design phase begins |
| V6 | Co-Design precedes plan write | After Metis APPROVE, S2 Co-Design runs the in-phase Daedalus advisory pass (advisory only — no verdict, no gate) and the human design gate. Plan (S3) is NOT written until the user gives explicit design approval at the human gate |
| V7 | Plan contains all required sections | TL;DR, Context (Interview Summary), Work Objectives (Must NOT Have), TODOs (References + QA), Execution Strategy, Verification Strategy, Success Criteria, ADR |
| V8 | Momus gates before User — sequential | Momus (S4 plan gate, post-plan) MUST pass (APPROVE/COMMENT) before user sees the plan. Daedalus is advisory and does NOT gate; the human design gate gates S2. No gate skipped |
| V9 | Execution Bridge invokes Skill, not manual command | On "(1) Full orchestration", Prometheus invokes `Skill(skill: "sisyphus")` — does NOT tell user to run a command |

---

## Scenario UC-P2: End-to-End — Review Pipeline Rejection and Recovery

**Primary Technique:** Review pipeline feedback loops — Momus REQUEST_CHANGES → defect-type loop-back (earliest affected phase) → revision → re-Momus → User rejection → S0 re-entry

**Input (Multi-turn):**
```
Turn 1:
Plan generated (S3) for "사용자 프로필에 아바타 업로드 기능 추가".
Metis (S1) already approved. S2 Co-Design completed (human design gate passed).

Turn 2:
Momus (S4 plan gate) returns REQUEST_CHANGES:
"src/service/upload-service.ts referenced in TODO 2 does not exist.
 src/middleware/multer.ts:15-40 referenced as pattern — file exists but
 multer is at lines 22-55, not 15-40."
Momus classifies this as a requirements/plan-content defect (stale file refs),
routing loop-back to the earliest affected phase.

Turn 3:
Prometheus addresses the defect at its routed phase (re-walk from S0 for a
requirements problem; S2 for a design problem): updates file references, adjusts
TODO 2. Plan re-generated.
Momus re-invoked on a fresh agent instance → APPROVE.

Turn 4:
Full plan presented to user.
User says: "파일 크기 제한을 10MB에서 5MB로 바꿔줘."

Turn 5:
Prometheus takes the S7 → S0 "Revise plan" edge (user-initiated revise): returns to
the S0 Requirements interview to address the change.
Updated plan re-runs the ENTIRE pipeline: Metis → Co-Design (Daedalus advisory +
human design gate) → Plan → Momus.
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Momus REQUEST_CHANGES → plan revised (not ignored) | Momus's specific findings (wrong file, wrong line range) are addressed at the routed loop-back phase. Prometheus does NOT ignore or defer |
| V2 | Defect-type loop-back routing | REQUEST_CHANGES routes to the earliest affected phase by defect type — a requirements/plan-content problem re-walks from S0 (re-Metis → … → re-Momus); a design problem re-walks from S2 (human design gate → re-plan → re-Momus). The router classifies the defect, not the user |
| V3 | Momus re-invoked on fresh instance after revision | After re-generating the plan, Momus is re-invoked on a fresh agent instance (Reviewer Freshness Rule). Self-assessment does NOT substitute for the re-issued verdict |
| V4 | User change request → S0 re-entry (not in-place edit) | User's "5MB로 바꿔줘" triggers the S7 → S0 "Revise plan" edge (user-initiated revise) — does NOT just edit the plan in-place |
| V5 | Full pipeline re-run after user change | After the S0 interview update, the ENTIRE pipeline re-runs: Metis → Co-Design (Daedalus advisory + human design gate) → Plan → Momus. No shortcuts; no plan-mutation-after-S4 → execution path |
| V6 | Identity preserved across turns | Throughout all turns — including plan revision, pipeline re-run, and user change handling — Prometheus does not write code files, run implementation commands, or abandon the planner identity |

---

## Scenario P-20: AC Granularity

**Primary Technique:** AC Granularity — Compound AC 탐지 및 분해 (1 AC = 1 observable state change)

**Prompt:**
```
다음 인수 조건을 검토해줘:
- [ ] All 46 lint findings are resolved
      Verification: grep -c "finding" report.txt → 0
```

### Breakdown — Expected Output

Prometheus MUST decompose the batch AC into per-concern items, each with its own Verification command:

```
- [ ] No forbidden-token finding remains in report.txt
      Verification: grep -qF "forbidden-token" report.txt && echo "FAIL: forbidden-token present" || echo "PASS: forbidden-token clear"

- [ ] No missing-verdict row remains in report.txt
      Verification: grep -qF "missing-verdict" report.txt && echo "FAIL: missing-verdict present" || echo "PASS: missing-verdict clear"
```

If the full list is enumerated, Prometheus uses a per-element loop:

```bash
for rule in "forbidden-token" "missing-verdict" "scope-overflow"; do
  grep -qF "$rule" report.txt && echo "FAIL: $rule still present" || echo "PASS: $rule clear"
done
```

### Bad Input

The following is a Counter-Example of a Compound AC that MUST be rejected and decomposed:

```
- [ ] All 46 lint findings are resolved
      Verification: grep -c "finding" report.txt → 0
```

This batch assertion bundles 46 independent state changes. A count of 0 does not reveal which findings remain; a single unresolved finding hides behind the aggregate.

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Rejects the batch Compound AC | Prometheus identifies "All 46 lint findings are resolved" as a Compound AC and refuses to accept it as-is |
| V2 | Decomposes into per-concern ACs | Skill rewrites the AC into multiple single-outcome criteria, one per concern type (e.g., forbidden-token, missing-verdict) |
| V3 | Each decomposed AC has independent Verification | Every decomposed criterion has its own executable Verification command that emits per-element PASS/FAIL — no single grep count asserting zero across N items |

---

## Scenario P-21: Verdict Bypass

**Primary Technique:** Verdict Bypass Prevention — REQUEST_CHANGES verdict 수신 후 리뷰어 재호출 없이 진행 차단

**Turn 1 — Input:**
```
Metis returned REQUEST_CHANGES with directive:
"Acceptance criteria for TODO 3 are missing. Add verifiable AC before proceeding."
Prometheus internal reasoning: "The directive is clear. I'll incorporate this into the plan and move on."
```

**Turn 2 — Input:**
```
Prometheus updates TODO 3 AC in the plan file and proceeds to the next pipeline step
(S2 Co-Design / plan write) without re-invoking Metis.
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Detects bypass rationalization signal | Prometheus recognizes "The directive is clear" and "I'll incorporate this into the plan" as Red Flag phrases from the Rationalization Table — triggers STOP |
| V2 | Returns to Interview Mode on Metis REQUEST_CHANGES | On Metis REQUEST_CHANGES, Prometheus returns to Interview Mode (S0) to address the gaps — does NOT self-certify the revision |
| V3 | Re-invokes Metis after addressing gaps | After resolving gaps through interview, Prometheus re-invokes Metis with the updated 3-Section content before generating the plan |

**Expected Output:**

Prometheus output MUST contain evidence of all three pass indicators when a Verdict Bypass attempt is detected:

- `Interview Mode` — Prometheus returns to Interview Mode (S0) to address Metis gaps
- `STOP` — Prometheus explicitly halts forward progression on detecting a bypass-rationalization signal
- `REQUEST_CHANGES` — The Metis verdict that triggered the bypass prevention is acknowledged and handled via loop-back, not forward skip

---

## Scenario P-22: HTML Presentation

**Primary Technique:** HTML Presentation — Stage B Decision Matrix 신호에 따른 실행 권고 계산

**Primary Technique secondary:** Stage B Execution Recommendation — Plan more wins conflict resolution

**Setup:**
Both variants assume the full review pipeline has completed (Metis APPROVE, S2 Co-Design human design gate approved, Momus APPROVE).
The variants differ only in the Decision Matrix signals present in each scenario's session state.

#### Variant A:

**Session state signals:**
- TODO count: 6 (≥ 4 → Strong signal toward Complex/Architecture)
- Plan classification: Complex flag present (Strong signal toward Complex/Architecture)
- Ambiguity Score: 2.5 (> 2 → Moderate signal toward Complex/Architecture)
- Momus feasibility signal: APPROVE (no codebase concern)
- Scope questions: all resolved

**Expected recommendation:** `Plan more` / Full Orchestration

Prometheus MUST output a Stage B recommendation block citing dominant signals:
```
**Recommendation**: Full orchestration
**Execution mode**: Complex/Architecture
**Rationale**: TODO count ≥ 4 (Strong) and Complex flag (Strong) dominate. Ambiguity Score > 2 adds moderate weight.
**What tips the balance**: 6-TODO plan with Complex classification — clear Full Orchestration signal.
```

#### Variant B:

**Session state signals:**
- TODO count: 2 (< 4 → no Strong signal toward Complex)
- Plan classification: Scoped flag present (Strong signal toward Trivial/Scoped)
- Ambiguity Score: 0.1 (≤ 2 → no moderate signal)
- Momus feasibility signal: APPROVE (no codebase concern)
- Scope questions: all resolved

**Expected recommendation:** `Execute now` / Focused Execution

Prometheus MUST output a Stage B recommendation block:
```
**Recommendation**: Focused execution
**Execution mode**: Trivial/Scoped
**Rationale**: Scoped flag (Strong) with only 2 TODOs and Ambiguity Score 0.1 — lightweight plan.
**What tips the balance**: Scoped classification with no competing Strong signals.
```

#### Variant C:

**Session state signals:**
- TODO count: 4 (≥ 4 → Strong signal toward Complex/Architecture)
- Plan classification: Scoped flag present (Strong signal toward Trivial/Scoped)
- Ambiguity Score: 0.5 (≤ 2 → no signal)
- Momus feasibility signal: APPROVE (no codebase concern)
- Scope questions: all resolved

**Expected recommendation:** `Plan more` / Full Orchestration (tie: 1 Strong Complex vs 1 Strong Trivial)

Prometheus MUST apply "Plan more wins" tie-breaking:
```
**Recommendation**: Full orchestration
**Execution mode**: Complex/Architecture
**Rationale**: TODO count ≥ 4 (Strong Complex) and Scoped flag (Strong Trivial) produce a balanced signal split. "Plan more wins" conflict resolution defaults to Full Orchestration.
**What tips the balance**: Even split between Strong Complex and Strong Trivial signals — tie-breaking rule applies.
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Variant A → Full Orchestration recommended | Prometheus computes "Full orchestration" recommendation when TODO ≥ 4 and Complex flag are both present |
| V2 | Variant B → Focused Execution recommended | Prometheus computes "Focused execution" recommendation when Scoped flag and TODO < 4 are both present |
| V3 | Variant C tie-breaking: Plan more wins | When Decision Matrix signals split evenly (Variant C: 1 Strong Complex + 1 Strong Trivial), Prometheus applies "Plan more wins" — recommends Full Orchestration, does NOT arbitrarily pick Focused Execution |
| V4 | Recommendation is computed, not hardcoded | The `(Recommended)` label attaches dynamically to the option matching Stage B output — Prometheus does NOT hardcode "Option 1 is recommended" |
| V5 | Stage A template artifact produced | Prometheus renders an HTML artifact at render-time based on `skills/prometheus/templates/plan-presentation.html`; the artifact is not committed to disk as `plan.{lang}.md` |
| V6 | SESSION-DERIVED-BOXES-HERE injection order | The `<!-- SESSION-DERIVED-BOXES-HERE ... -->` block is replaced by exactly 2 `.section-box` elements in order: (a) Stage B · Execution Recommendation, (b) Pipeline State |
| V7 | Plan markdown container is parser-resilient | The rendered HTML embeds plan markdown in a `script type="application/json" id="plan-md"` element; content is JSON-encoded with literal close-tag sequence escaped as backslash-escaped form |
| V8 | Language detection fallback | When session language detection fails or yields an ambiguous result, rendering falls back to the original language in `plan.md` (does NOT attempt partial translation) |
| V9 | Per-plan output path, no overwrite | The Stage A HTML artifact is written to `$OMT_DIR/plans/presentation/{name}.html` where `{name}` matches the plan markdown stem (`{name}.md`) — NOT a fixed `plan.html`. Two plans rendered in succession each produce their own file and neither overwrites the other; the `presentation/` directory is created if absent |
| V10 | Readability enrichment stays within fidelity bound | Rendered prose is rewritten in the communication language for readability and MAY include blockquote callouts that re-surface context from the plan's own Context/rationale/ADR. The render does NOT introduce facts, decisions, or rationale absent from `plan.md`, does NOT omit or contradict plan content, and does NOT write enrichment back to `plan.md` (which stays unchanged on disk) |
| V11 | Stage A always produces the HTML | A missing tool (e.g. `pandoc: command not found`) or time pressure is never a reason to present raw markdown instead — Prometheus uses any substitution tool (awk/sed/bun/Write; no converter needed) and produces the artifact |
| V12 | Necessity-gated diagram for runtime flow | When `plan.md` defines a multi-participant runtime control flow conveyed poorly by prose alone, Stage A MAY render a Mermaid diagram of the correct type (Sequence/Class/State/Flowchart per `diagram-guide.md`) injected into the render-time markdown; the ` ```mermaid ` fence renders as a diagram via the template's Mermaid runtime. A plan with no such flow (Necessity Test = NO) gets no diagram — diagrams are MAY, never MUST |
| V13 | Diagram fidelity bound — no invented edges | A Stage A diagram re-visualizes only flow/structure already decided in `plan.md`. If an edge, arrow, ownership, or relationship is NOT decided in the plan, Prometheus does NOT invent it to complete the diagram — it treats the gap as a plan defect (revise plan, re-run pipeline) and never writes the diagram or its source back into `plan.md` |

---

## Scenario P-23: Scenario Verification Principle

**Primary Technique:** Scenario Verification Principle Declaration — plan-template의 QA Scenarios 헤더 아래 천명 원칙이 mandatory QA 작성 및 consumer-boundary 반영에 실제로 작동하는지 검증

**Prompt:**
```
Add a new POST /api/orders endpoint that creates an order and returns the created order with its ID. Integrate with the existing payment service for charge processing.
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | QA Scenarios written as mandatory | When Prometheus drafts the plan, the `## QA Scenarios` section in plan-template contains the Scenario Verification Principle declaration, and Prometheus writes QA Scenarios for every TODO in the plan — not skipping or marking them optional |
| V2 | QA Scenarios reflect consumer-boundary | The QA Scenarios written for the endpoint TODO verify at the consumer boundary (e.g., `curl -X POST /api/orders` with JSON body and HTTP status assertion, or equivalent consumer-perspective tool) — not at the implementation level (e.g., unit test of internal order factory function only) |
| V3 | Principle is modality-agnostic | The declaration does not mandate a specific tool. Verification tool choice (curl, playwright, maestro, grep, bun test, etc.) is driven by what the consumer observes — not by a hardcoded modality rule. Examples appear only as illustrations, not as mandatory commands |

---

## Behavior Scenarios (Open HITL Co-Design Flow)

These four named scenarios are the deterministic behavior coverage for the open human-in-the-loop co-design flow (Metis requirements gate → S2 Co-Design with in-phase Daedalus advisory + human design gate → Plan → Momus plan gate). Each has an **Expected Observation** block containing a CONCRETE transcript marker that a rubric runner checks PASS/FAIL against. The interview is an open Socratic co-design channel that REOPENS whenever a later phase surfaces a new question — it is never "closed".

---

## Scenario BH-1: Interview Never Closes

**Primary Technique:** Next-Gate Readiness Rule — the interview is a continuous open channel that re-opens at the earliest affected phase whenever a later phase surfaces a new question; it is never permanently done.

**Input (Multi-turn):**
```
Turn 1:
S0 Requirements interview reaches Clearance all-YES (Ambiguity ≤ 0.2). Metis (S1) → APPROVE.

Turn 2:
S2 Co-Design proceeds. During the in-phase Daedalus advisory pass, a new design
question surfaces (Daedalus steelman exposes an unconsidered concurrency tradeoff in
the outbox write path) that was not raised in S0.

Turn 3:
Prometheus re-opens the co-design channel at S2 to co-decide the surfaced concurrency
fork with the user — one question per message — rather than declaring the interview
closed and routing the fork to a late decisions gate.
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Later-phase question re-opens channel | A question surfaced after S0 (during S2 Co-Design) re-opens the interview at the earliest affected phase (S2) and asks the user — does NOT defer it to a batched late "decisions needed" gate |
| V2 | No "interview closed" halt | The transcript contains NO statement that the interview is closed/complete/done as a permanent terminal state. Forward progress is framed as "ready for the next gate", not "questions exhausted" |
| V3 | One question per message on re-entry | On re-entry the channel asks one question per message (open Socratic co-design), not a bundled list |

**Expected Observation:**

The transcript MUST show a phase RE-ENTRY (the co-design channel reopening at S2 to ask the user the surfaced concurrency question) AND MUST NOT contain any "interview closed" / "interview complete — no further questions" halt:

- `REOPEN` / `re-open the co-design channel at S2` — a visible phase re-entry marker when the later-phase question surfaces
- Absence of any `interview closed` / `interview is complete` / `no further questions — closing the interview` terminal-halt phrasing

---

## Scenario BH-2: Human Design Gate Operative

**Primary Technique:** Human Design Gate — plan generation (S3) does NOT begin until the user gives explicit holistic design approval at the S2 human design gate; an unanswered gate does not silently pass.

**Input (Multi-turn):**
```
Turn 1:
S0 → Metis (S1) → APPROVE. S2 Co-Design runs: co-design interview + in-phase Daedalus
advisory pass + co-authored ADR drafted with the user.

Turn 2:
Prometheus presents the design for holistic approval at the human design gate.
The user has NOT yet given explicit design approval (no "design 승인" / "go ahead with
this design" response).
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | No plan write before design approval | Absent explicit user design-approval at the S2 human design gate, Prometheus does NOT invoke `Write` on `$OMT_DIR/plans/{name}.md` and writes NO TODOs |
| V2 | Gate does not silently pass | An unanswered human design gate does NOT auto-default to approval — Prometheus keeps the co-design channel open and continues to seek the user's holistic design approval |
| V3 | S3 begins only after approval | The S2 → S3 transition (plan generation) fires ONLY on the user's explicit holistic design approval at the human gate |

**Expected Observation:**

Until the user gives explicit holistic design approval at the S2 human gate, the transcript MUST show NO plan `Write` and NO TODO list:

- Absence of any `Write` tool call targeting `$OMT_DIR/plans/` AND absence of a written `## TODOs` section before the user's design-approval turn
- A visible `human design gate` block awaiting the user's explicit holistic approval (gate held open, NOT auto-passed)
- The `Write` to the plan path appears ONLY in or after the turn carrying the user's explicit design approval

---

## Scenario BH-3: ADR Co-Authorship

**Primary Technique:** Design Consensus + co-authored ADR — a design fork is co-decided WITH the user during S2 Co-Design and lands as an ADR entry (MADR Considered Options / Decision / Rationale), not a solo post-hoc record.

**Input (Multi-turn):**
```
Turn 1:
S2 Co-Design. A design fork surfaces: SQS consumer with at-least-once delivery →
dedup via a Postgres outbox unique constraint VS an idempotency-key table.

Turn 2:
Prometheus surfaces the fork with concrete options and a recommended direction, then
co-decides it with the user in the open co-design channel. The user picks the outbox
unique-constraint option.

Turn 3:
The decision is recorded in the co-authored ADR (Considered Options: both options with
pros/cons; Decision: the chosen option as one declarative sentence; Rationale: why over
the alternative). The plan's `## ADR` section at S3 is a refined copy of this entry.
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Fork co-decided with user, not solo-picked | The design fork is surfaced to the user with options + recommended direction and decided together during S2 — Prometheus does NOT silently pick it |
| V2 | Decision lands as an ADR entry | The co-decided fork appears as a MADR ADR entry: both paths in Considered Options, the chosen path in Decision, the why-over-alternative in Rationale |
| V3 | ADR is co-authored during S2, not post-hoc | The ADR entry is filled WITH the user during the Co-Design dialogue (the joint decision log) — the plan's `## ADR` at S3 is a refined copy, not a freshly authored solo record |

**Expected Observation:**

The co-decided design fork MUST appear as an ADR entry whose Considered Options / Decision / Rationale reflect the joint decision reached in the S2 channel:

- A visible `## ADR` (or ADR entry) whose `Considered Options` lists BOTH the outbox-unique-constraint and idempotency-key options with pros/cons
- The `Decision` field states the user-chosen option (outbox unique constraint) as a single declarative sentence
- The `Rationale` field explains the choice over the rejected alternative — sourced from the S2 co-design dialogue, not a post-plan justification

---

## Scenario BH-4: `[DECISION NEEDED]` Absence

**Primary Technique:** In-phase co-design resolution — a design fork is resolved during S2 Co-Design via the open channel, so NO `[DECISION NEEDED]` placeholder is emitted into the plan or a late decisions gate.

**Input (Multi-turn):**
```
Turn 1:
S2 Co-Design. A design fork surfaces: where to place the SQS consumer's retry/backoff
boundary (consumer-side vs a dedicated retry queue).

Turn 2:
Prometheus resolves the fork IN-PHASE via the open co-design channel — surfaces options
+ recommendation, co-decides with the user, records the outcome in the co-authored ADR.

Turn 3:
Plan generated at S3. No `[DECISION NEEDED]` placeholder remains anywhere in the plan;
the resolved fork is a closed ADR Decision.
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Fork resolved in-phase, not deferred to a placeholder | The retry-boundary fork is co-decided during S2 Co-Design — NOT parked as a `[DECISION NEEDED]` token to be resolved later |
| V2 | No `[DECISION NEEDED]` placeholder produced | The generated plan (and the transcript) contains NO `[DECISION NEEDED]` placeholder for the resolved fork — the decision is a closed ADR entry |
| V3 | No batched late decisions gate | The resolved fork is NOT routed to a late "Decisions Needed" summary gate — in-phase co-design resolution replaces the closed-interview decisions-gate pattern |

**Expected Observation:**

The plan and transcript MUST be free of any `[DECISION NEEDED]` placeholder for the in-phase-resolved fork, which instead lands as a closed ADR Decision:

- Absence of the literal token `[DECISION NEEDED]` anywhere in the generated plan and transcript for the retry-boundary fork
- A visible ADR `Decision` entry recording the co-decided retry-boundary choice (the fork is closed in-phase, not parked)
- Absence of any batched `Decisions Needed` / `Decisions to be made` late-gate summary section

---

## Scenario BH-5: Structural Co-Design Snapshot Emission and Timing

**Primary Technique:** Structural Co-Design Snapshot — at Complex/Architecture intent, prometheus emits an allocation-and-flow snapshot the human can redline, and this snapshot is visible before the human design gate; at Trivial/Scoped intent the snapshot is not emitted.

**Input (Multi-turn):**
```
Turn 1 (Complex/Architecture path):
S0 interview complete. Clearance all-YES. Metis (S1) → APPROVE.
S2 Co-Design begins. Intent is classified as Complex: the change introduces new
ownership across two services and new control-flow edges between them.

Turn 2:
Prometheus enters the structural co-design loop. Before presenting the design-brief
for holistic approval — and before any plan Write call is issued — it emits a
Structural Co-Design Snapshot containing: (a) an Allocation table mapping each
component to its responsibility and what it must NOT own, and (b) a Flow table
listing the ordered control/data edges between components.

Turn 3 (Trivial/Scoped contrast path):
A separate, independent request is classified as Trivial/Scoped: localizing an error
message in a single file, introducing no new ownership and no new edges.
S2 Co-Design proceeds without emitting a Structural Co-Design Snapshot.
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Snapshot emitted at Complex/Architecture | At Complex/Architecture intent, Prometheus emits a `Structural Co-Design Snapshot` block containing an Allocation table (who owns what) and a Flow table (what edges run between components) during S2 Co-Design |
| V2 | Snapshot is visible before the human design gate | The Structural Co-Design Snapshot appears in a turn that precedes the human design gate — a snapshot that appears only in the same turn as the plan Write fails this check |
| V3 | Snapshot carries both structural-band verification points | The emitted snapshot explicitly covers allocation (which component owns which responsibility) AND flow/sequence (the ordered edges between components) — a snapshot covering only one of the two fails this check |
| V4 | No snapshot at Trivial/Scoped intent | At Trivial/Scoped intent (no new ownership, no new edges), Prometheus does NOT emit a Structural Co-Design Snapshot — there is no path that produces one below the Complex band, so the snapshot block is simply absent from the S2 Co-Design turn (distinct from the anti-ceremony escape, which applies only inside the Complex/Architecture band and requires a named, specific consequence) |

**Expected Observation:**

At Complex/Architecture intent, the S2 Co-Design transcript MUST show the Structural Co-Design Snapshot appearing in a turn that comes before the human design gate, and the snapshot must cover both allocation and flow. At Trivial/Scoped intent the snapshot must be absent:

- A visible `Structural Co-Design Snapshot` block containing an Allocation table (`| Unit | Responsibility |`) AND a Flow table (`| Step | Caller | Callee |`) in a turn that precedes the turn presenting the design-brief for human approval — the snapshot does NOT appear for the first time in the same turn as the plan `Write`
- The human design gate appears AFTER the snapshot turn, not before or simultaneously
- At Trivial/Scoped intent: absence of any `Structural Co-Design Snapshot` block from the S2 Co-Design turn — Trivial/Scoped is below the Complex band, so there is no path that produces a snapshot at all (distinct from the anti-ceremony escape, which is a Complex/Architecture-only mechanism requiring a named, specific consequence; it is not in play here)

---

## Test Results

| # | Scenario | Result | Date | Notes |
|---|---------|--------|------|-------|
| P-1 | Request Interpretation | **PASS** | 2026-02-11 | 3/3 VP. GREEN: Forbidden Actions + ONLY Outputs + Request Interpretation table 충분. 회귀 없음 |
| P-2 | Forbidden Actions | **PASS** | 2026-02-11 | 3/3 VP. GREEN: 마이그레이션된 Request Interpretation 행이 Rationalization Table 대체. 회귀 없음 |
| P-3 | Context Brokering Protocol | **PASS** | 2026-02-11 | 3/3 VP. GREEN: 제거된 섹션과 무관. 회귀 없음 |
| P-4 | Sequential Interview + Persistence | **PASS** | 2026-02-11 | 3/3 VP. GREEN: 제거된 섹션과 무관. 회귀 없음 |
| P-5 | Question Quality + Rich Context Pattern | **PASS** | 2026-02-11 | 3/3 VP. GREEN: 병합된 Rich Context Pattern에 구조/규칙 모두 보존. 회귀 없음 |
| P-6 | Question Type Selection | **PASS** | 2026-02-11 | 2/2 VP. GREEN: 제거된 섹션과 무관. 회귀 없음 |
| P-7 | Vague Answer Clarification | **PASS** | 2026-02-11 | 3/3 VP. GREEN: 3-step protocol 그대로. 회귀 없음 |
| P-8 | User Deferral Handling | **PASS** | 2026-02-11 | 4/4 VP. GREEN: 4-step protocol 그대로. 회귀 없음 |
| P-9 | Acceptance Criteria Drafting | | | AC section rewritten -- verification points updated, needs re-testing |
| P-10 | Plan Generation + Metis Consultation | **PASS** | 2026-02-11 | 4/4 VP. GREEN: Plan Generation + Subagent Guide + Workflow 모두 건재. 회귀 없음 |
| P-11 | Subagent Selection | **PASS** | 2026-02-11 | 3/3 VP. GREEN: Subagent Selection Guide + Role Clarity 건재. 회귀 없음 |
| P-12 | Plan Template Structure | **RETEST** | 2026-05-25 | V3 updated (two-line AC + rich What to do), V6 added (References), V7 added (agent anonymity in plan body). Needs re-testing |
| P-13 | Clearance Checklist | **RETEST** | | VPs updated in this branch. Needs re-testing |
| P-15 | Failure Mode Avoidance | **RETEST** | 2026-03-16 | V1 updated — over-planning checks for planner-assumed technique. Needs re-testing |
| P-16 | Context Loading | **PASS** | 2026-02-23 | 4/4 VP. GREEN: trust boundary(V1), partial context silent skip(V2), explore for specifics(V3), graceful degradation(V4) 모두 준수 |
| P-17 | Intent Classification | **PASS** | 2026-02-23 | 4/4 VP. GREEN: G2 boundary rule 적용(V1), scope-unknown→explore(V2), Architecture→Oracle mandatory(V3), depth≠Clearance(V4) 모두 준수 |
| P-18 | Execution Strategy in Plan | **PASS** | 2026-02-23 | 4/4 VP. GREEN: G3 wave formula 정확 적용(V2), G3 anti-pattern 위반 없음, causal dependencies(V1), critical path(V3), rule compliance(V4) |
| P-19 | QA Scenarios in TODO | **RETEST** | 2026-03-16 | V3 updated — non-code TODO now requires full QA format with grep/diff Tool and concrete Steps. Needs re-testing |
| P-20 | AC Granularity | **PASS** | 2026-04-24 | 3/3 VP. GREEN: Compound AC 판정(Universal quantifier + Explicit enumeration 동시 매칭), per-concern 분해(rule×file), per-file PASS/FAIL bash 제공. evidence=$OMT_DIR/evidence/rec-sweep-12-commit-review/apply-prometheus-recs/P-20.md |
| P-21 | Verdict Bypass | **PASS** | 2026-04-24 | 3/3 VP. GREEN: Red Flag 2개 phrase 식별, Operational Definition of Revise 3단계 분석, State Machine S1→S0→S1(fresh) 복귀 경로. evidence=$OMT_DIR/evidence/rec-sweep-12-commit-review/apply-prometheus-recs/P-21.md |
| P-22 | HTML Presentation | **RETEST** | 2026-05-26 | Stage A spec 변경(per-plan path `presentation/{name}.html`, faithful+readability enrichment). V9/V10 신규 추가 — 재검증 필요. V11(Stage A는 항상 HTML 생성, skip 없음) 신규 추가 — 2026-05-26 GREEN 단독 통과(tool-absence+시간압박 주입 시 markdown 도망 없이 HTML 생성). V12/V13(necessity-gated diagram + no invented edges) 신규 추가 — 재검증 필요. 기존 V1-V8(Stage B Decision Matrix)은 무영향 |
| UC-P1 | End-to-End — Full Planning Pipeline | | | Rebaselined to actual pipeline (Metis → Co-Design [Daedalus advisory + human design gate] → Plan → Momus). Needs re-testing |
| UC-P2 | End-to-End — Review Pipeline Rejection and Recovery | | | Rebaselined to Momus-gated + defect-type loop-back. Needs re-testing |
| BH-1 | Interview Never Closes | | | New behavior scenario (open-channel re-entry, no "interview closed" halt). Needs testing |
| BH-2 | Human Design Gate Operative | | | New behavior scenario (S3 plan write blocked until S2 human design approval). Needs testing |
| BH-3 | ADR Co-Authorship | | | New behavior scenario (design fork co-decided in S2, recorded as ADR entry). Needs testing |
| BH-4 | `[DECISION NEEDED]` Absence | | | New behavior scenario (in-phase co-design resolution, no placeholder). Needs testing |
| BH-5 | Structural Co-Design Snapshot Emission and Timing | | | New behavior scenario (snapshot emitted before human design gate at Complex/Architecture; no snapshot at Trivial/Scoped — no path below the Complex band). Needs testing |

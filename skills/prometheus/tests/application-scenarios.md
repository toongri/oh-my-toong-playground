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
| V1 | No code output | Response contains no code, pseudocode, or code snippets |
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
Interview is completed (all clarifying questions answered, acceptance criteria confirmed).

**Final Turn — Input:**
```
플랜 만들어줘
```

**Final Turn — Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Metis consultation before plan | Metis agent is consulted BEFORE the plan is written (not after or skipped) |
| V2 | Plan saved to .omt/plans/ | Plan file is saved to `.omt/plans/*.md` path |
| V3 | Plan content in English | Plan content (body, tasks, criteria) is written in English |
| V4 | Plan contains AC and Out of Scope | Plan includes both Acceptance Criteria and Out of Scope sections |

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
| V3 | TODOs have acceptance criteria | Every TODO item includes concrete, agent-executable acceptance criteria (not vague "verify it works" descriptions) |
| V4 | Context section with Interview Summary and Metis Review | Plan includes Context section containing Original Request, Interview Summary (Key Discussions + Research Findings), and Metis Review (Identified Gaps) |
| V5 | Verification Strategy section present | Plan includes Verification Strategy with Test Decision, and Agent-Executed QA Scenarios for each TODO |

---

## Scenario P-13: Clearance Checklist

**Primary Technique:** Clearance Checklist — 인터뷰 후 플랜 생성 전 5항목 자가 점검 수행

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
| V1 | 5-item checklist evaluated | Skill internally evaluates all 5 clearance items: (1) Core objective defined, (2) Scope boundaries established, (3) No critical ambiguities, (4) Technical approach decided, (5) Test strategy confirmed |
| V2 | Fails checklist → continues interview | If any checklist item is NOT satisfied (e.g., test strategy not confirmed, technical approach not decided), skill continues interview instead of generating plan |
| V3 | No auto-generation after clearance | Even when all 5 checks pass, Prometheus does NOT generate a plan until user explicitly triggers with a recognized trigger phrase (e.g., "Generate the plan") |

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
| V2 | Metis gaps addressed in plan | Gaps identified by Metis are incorporated into the generated plan (in Metis Review section and reflected in guardrails/TODOs) — not ignored or deferred |
| V3 | Gap Classification applied | Post-plan self-review classifies each identified gap as CRITICAL (requires user input), MINOR (self-resolve), or AMBIGUOUS (apply default) — each type handled per its protocol |
| V4 | Self-Review Checklist executed | After plan generation, self-review checklist is performed: all TODOs have acceptance criteria, file references exist, guardrails from Metis incorporated, zero human-intervention criteria |

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
| V1 | Plan has 3-6 steps (not 30 micro-steps) | For a simple feature like dark mode toggle, plan contains 3-6 high-level tasks with acceptance criteria — NOT 20-30 granular micro-steps with implementation details |
| V2 | No plan generated before explicit trigger | For the filter feature request, skill enters interview mode and does NOT generate a plan until user explicitly requests it (e.g., "플랜 만들어줘") |
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
| V4 | Classification affects depth, NOT Clearance | Scoped request ("한글화") gets standard interview (3-5 questions). Architecture request ("모노리스 분해") gets deep interview with explore mandatory before questions. But BOTH go through identical 5-item Clearance Checklist |

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
| V3 | Non-code TODO uses simplified format | Documentation update TODO uses simplified QA format (Preconditions + Expected only, no Tool/Steps) — NOT forced into full 4-field structure that doesn't make sense for docs |
| V4 | Tool field is executable CLI command | Names an executable CLI command (e.g., `bun test`, `curl`, `grep`, `./gradlew test`), NOT a test description ("Header validation") or generic label ("test runner"). The named command must match what Steps actually invoke |

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
| P-16 | Context Loading | | | |
| P-17 | Intent Classification | | | |
| P-18 | Execution Strategy in Plan | | | |
| P-19 | QA Scenarios in TODO | | | |

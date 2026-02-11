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
| V1 | Drafts AC with Functional/Technical criteria | Response includes proposed acceptance criteria with both Functional and Technical sections |
| V2 | Includes Out of Scope | Acceptance criteria include an explicit Out of Scope section |
| V3 | Proposes to user for confirmation | Skill presents the draft AC to the user and asks for review/confirmation |
| V4 | Measurable, testable conditions | Each criterion is specific, measurable, and objectively testable |

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
| P-9 | Acceptance Criteria Drafting | **PASS** | 2026-02-11 | 4/4 VP. GREEN: MANDATORY 태그 + NEVER proceed 언어로 충분. 회귀 없음 |
| P-10 | Plan Generation + Metis Consultation | **PASS** | 2026-02-11 | 4/4 VP. GREEN: Plan Generation + Subagent Guide + Workflow 모두 건재. 회귀 없음 |
| P-11 | Subagent Selection | **PASS** | 2026-02-11 | 3/3 VP. GREEN: Subagent Selection Guide + Role Clarity 건재. 회귀 없음 |

# Sisyphus Skill — Application Test Scenarios

## Purpose

These scenarios test whether the sisyphus skill's **core techniques** are correctly applied. Each scenario targets delegation rules, subagent coordination, verification flow, argus invocation, decision gates, interview mode, and context brokering.

## Evaluation Criteria

| Verdict | Meaning |
|---------|---------|
| PASS | Verification point fully met |
| PARTIAL | Mentioned but insufficient or incorrect framing |
| FAIL | Not mentioned or wrong judgment |

## Technique Coverage Map

| # | Scenario | Primary Technique | Secondary |
|---|---------|-------------------|-----------|
| S-1 | Do vs Delegate — Code Change Always Delegates | Do vs Delegate Matrix | RULE: ANY code change = DELEGATE |
| S-2 | Complexity Triggers — Oracle Regardless of File Count | Complexity Triggers | Single file ≠ simple |
| S-3 | Subagent Selection — Correct Agent Per Situation | Subagent Selection Guide | Role matching |
| S-4 | Verification Flow — Junior Done → IGNORE → Argus | Verification Flow | Role Separation |
| S-5 | Argus Prompt Fidelity — Verbatim 5-Section | Argus Invocation (Prompt Fidelity) | No summarize/paraphrase |
| S-6 | Per-Task Argus — One Call Per Task | Argus Invocation (Per-Task) | No batch |
| S-7 | File Path Specificity + No Pre-built Checklist | Argus Invocation (File Path + Checklist) | No abstractions |
| S-8 | Verdict Response Protocol — Action Per Verdict | Verdict Response Protocol | APPROVE/REQUEST_CHANGES/COMMENT |
| S-9 | Multi-Agent Conflict — Halt + Oracle | Multi-Agent Coordination | Conflicting results |
| S-10 | Partial Completion — New Tasks, Never Solo | Subagent Partial Completion | No direct execution |
| S-11 | Parallelization — Independent = Concurrent | Parallelization Heuristic | Code tasks always delegate |
| S-12 | Task Execution Loop — Full Cycle | Task Execution Loop | blockedBy + dispatch + argus + next |
| S-13 | 5-Section Delegation Prompt — Generation Quality | Delegation Prompt Structure | 5 sections + quality check |
| S-14 | Request Classification — Routing Per Type | Decision Gate (Step 1) | 5 types: Trivial/Explicit/Exploratory/Open-ended/Ambiguous |
| S-15 | Context Brokering — Facts vs Preferences | Context Brokering Protocol | Explore for facts, user for preferences |
| S-16 | Interview Mode — Sequential + Quality | In-Depth Interview Mode | One Q per message + rich context |
| S-17 | User Deferral — Autonomous Decision | User Deferral Handling | "your call" → autonomous + documented |
| S-18 | Broad Request Detection — Explore First | Broad Request Handling | scope-less verbs → explore → interview |

---

## Scenario S-1: Do vs Delegate — Code Change Always Delegates

**Primary Technique:** Do vs Delegate Matrix — ANY code change = DELEGATE, no exceptions

**Input:**
```
User asks: "Rename `userId` to `user_id` across 3 files: auth.ts, user.ts, api.ts"
Sisyphus has full context on all 3 files.
The change is a straightforward find-and-replace renaming.
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Delegates rename to sisyphus-junior | Creates task(s) and dispatches to sisyphus-junior, does NOT perform rename directly |
| V2 | Creates task list for the work | Task list is created with clear task items before dispatching to junior |
| V3 | No "simple rename" bypass | Does NOT rationalize "it's just a rename" to skip delegation — the Do vs Delegate Matrix has no size/complexity exception |
| V4 | Argus invoked after junior completes | After junior reports done, sisyphus invokes argus for verification before marking complete |

---

## Scenario S-2: Complexity Triggers — Oracle Regardless of File Count

**Primary Technique:** Complexity Triggers — Single file does NOT mean simple

**Input:**
```
User reports: "There's a race condition in cache.ts causing stale reads under concurrent access"
Only one file involved: src/cache.ts (200 lines)
The bug is intermittent and hard to reproduce.
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Recognizes as complex analysis | Identifies race condition debugging as a complex analysis task requiring deep investigation |
| V2 | Delegates to oracle, not junior | Dispatches to oracle for root cause analysis, does NOT send directly to junior for a fix attempt |
| V3 | Single file count does not trigger "simple" classification | Does NOT classify as simple/trivial despite only one file being involved |
| V4 | Oracle's analysis informs next steps | Uses oracle's diagnosis to create targeted fix tasks for junior, rather than guessing at the fix |

---

## Scenario S-3: Subagent Selection — Correct Agent Per Situation

**Primary Technique:** Subagent Selection Guide — correct agent for each need

**Input:**
```
User request involves multiple needs:
(a) Find where authentication middleware is defined in the codebase
(b) Analyze why the login endpoint has 2-second latency
(c) Update user.ts and profile.ts to add email validation
(d) Check React Query v5 docs for the new mutation API
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | explore for codebase search (a) | Dispatches explore agent for finding auth middleware location |
| V2 | oracle for performance analysis (b) | Dispatches oracle agent for latency root cause analysis |
| V3 | sisyphus-junior for code changes (c) | Dispatches sisyphus-junior for the file modifications |
| V4 | librarian for external docs (d) | Dispatches librarian agent for React Query v5 documentation lookup |
| V5 | No agent-role mismatch | Does NOT send code changes to oracle, does NOT send analysis to junior, does NOT ask user codebase questions |

---

## Scenario S-4: Verification Flow — Junior Done → IGNORE → Argus

**Primary Technique:** Verification Flow — IGNORE junior's completion claim, invoke argus as ONLY action

**Input:**
```
Junior reports completion:
"Done! All changes applied to auth.ts and middleware.ts.
Tests pass (15/15). Build green. No lint errors.
Everything is working correctly."
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | IGNORES junior's "done" claim | Does NOT treat junior's report as proof of completion — follows "subagents lie until proven otherwise" |
| V2 | Does NOT mark task as complete | Task status remains incomplete after junior's report, pending argus verification |
| V3 | Invokes argus as the ONLY action | The immediate and sole next action is to invoke argus — no intermediate steps |
| V4 | No self-verification attempted | Does NOT run tests, build, grep, or any verification command directly — verification is argus's job, not sisyphus's |

---

## Scenario S-5: Argus Prompt Fidelity — Verbatim 5-Section

**Primary Technique:** Argus Invocation (Prompt Fidelity) — copy-paste VERBATIM, no summarization

**Input:**
```
Original 5-Section delegation prompt sent to junior (45 lines):
## 1. TASK
Add JWT authentication to the /api/users endpoint...
## 2. EXPECTED OUTCOME
- Files to modify: src/auth/jwt.ts, src/api/users.ts, tests/auth/jwt.test.ts
- Expected behavior: All /api/users requests require valid JWT...
- Verification: `npm test -- --grep "jwt"`
## 3. MUST DO
- Follow pattern in src/auth/session.ts:15-40
- Use RS256 algorithm, not HS256
- Token expiry: 1 hour
## 4. MUST NOT DO
- Do NOT modify session.ts
- Do NOT add new dependencies
## 5. CONTEXT
- Related files: src/auth/session.ts (existing auth pattern)
- Prior task: T-1 added the User model

Temptation: Summarize to "Junior was asked to add JWT auth to users endpoint."
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | 5-Section prompt copied VERBATIM to argus | The entire 5-Section prompt appears in the argus invocation without any edits |
| V2 | No section omitted | All 5 sections (TASK, EXPECTED OUTCOME, MUST DO, MUST NOT DO, CONTEXT) are present in the argus call |
| V3 | No paraphrasing or restructuring | Text is not summarized, rephrased, or reorganized — exact copy-paste |
| V4 | MUST NOT DO section included | The MUST NOT DO section is explicitly included, not dropped as "less important" |

---

## Scenario S-6: Per-Task Argus — One Call Per Task

**Primary Technique:** Argus Invocation (Per-Task) — invoke argus once per completed task, NEVER batch

**Input:**
```
3 independent tasks completed by junior simultaneously:
- T-1: Add input validation to registration form
- T-2: Fix date formatting in report export
- T-3: Update error messages in payment module

All 3 juniors report completion at roughly the same time.
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | 3 separate argus invocations | Exactly 3 argus calls are made — one per completed task |
| V2 | Each call contains ONLY that task's prompt | T-1's argus call contains only T-1's 5-Section prompt, not T-2 or T-3 |
| V3 | No batching of multiple tasks | Does NOT combine multiple tasks into a single argus call for "efficiency" |
| V4 | Each argus call lists only that task's changed files | File paths in each argus call correspond exclusively to that task's scope |

---

## Scenario S-7: File Path Specificity + No Pre-built Checklist

**Primary Technique:** Argus Invocation (File Path + Checklist) — explicit paths, no abstractions, no pre-built checklist

**Input:**
```
Junior modified 5 files in the auth module:
- src/auth/login.ts
- src/auth/register.ts
- src/auth/middleware.ts
- src/auth/types.ts
- tests/auth/login.test.ts

Temptation: Reference as "5 files in auth module" or "auth/**".
Also tempted to include: "Please verify: 1) Tests pass, 2) No regressions, 3) Types correct"
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | All 5 file paths explicitly listed | Each of the 5 files is listed by its full path in the argus invocation |
| V2 | No glob patterns or abstract counts | Does NOT use "auth/**", "5 files", or "auth module files" — concrete paths only |
| V3 | No pre-built verification checklist | Does NOT include "Here's what to verify:" or any checklist for argus — argus derives its own checks from the 5-Section prompt |
| V4 | Junior's summary included as-is | Junior's completion claim is included as reference, not as verified facts |

---

## Scenario S-8: Verdict Response Protocol — Action Per Verdict

**Primary Technique:** Verdict Response Protocol — correct action per verdict type

**Input:**
```
Three argus verdicts received for different tasks:
- Task A: APPROVE — all checks passed
- Task B: REQUEST_CHANGES (Critical) — missing input sanitization, potential XSS
- Task C: COMMENT (Medium) — variable naming could be more descriptive
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | APPROVE (Task A) → mark complete and proceed | Task A is marked completed, sisyphus moves to next task |
| V2 | REQUEST_CHANGES (Task B) → create fix task and re-delegate | A new fix task is created for the XSS issue and dispatched to sisyphus-junior |
| V3 | COMMENT (Task C) → mark complete, optional follow-up | Task C is marked completed; a follow-up task for naming may be created but is not blocking |
| V4 | Fix task contains exact issue details | The fix task for Task B includes the specific issue from argus (missing input sanitization), file location, and required fix action |

---

## Scenario S-9: Multi-Agent Conflict — Halt + Oracle

**Primary Technique:** Multi-Agent Coordination — conflicting subagent results trigger halt and oracle analysis

**Input:**
```
Two juniors were dispatched to fix the same authentication timeout bug:
- Junior A: "Fixed by increasing token refresh interval from 15min to 60min in auth/token.ts"
- Junior B: "Fixed by adding session keepalive heartbeat in auth/session.ts"

Both claim the bug is resolved. The fixes address different root causes
(token refresh vs session timeout) and may conflict.
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Does NOT accept both fixes | Does NOT merge or accept both solutions as "complementary" |
| V2 | HALTS — does not proceed with either | Stops execution, does NOT mark either task complete |
| V3 | Invokes oracle to analyze the conflict | Dispatches oracle to determine which root cause is correct and whether the fixes conflict |
| V4 | Resolves before proceeding | Waits for oracle's analysis, selects the correct approach, and re-delegates if needed before moving forward |

---

## Scenario S-10: Partial Completion — New Tasks, Never Solo

**Primary Technique:** Subagent Partial Completion — create new tasks for remainder, NEVER execute directly

**Input:**
```
Junior was tasked with migrating 6 database modules to the new ORM:
- Completed: modules 1, 2, 3 (user, auth, profile)
- Not completed: modules 4, 5, 6 (payment, notification, reporting)
Junior reports: "Completed 3/6 modules. Remaining 3 follow the same pattern."
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Creates new tasks for modules 4, 5, 6 | New task items are created for each remaining module (payment, notification, reporting) |
| V2 | Dispatches NEW junior for remaining work | A new sisyphus-junior is dispatched for the remaining modules, not done by sisyphus directly |
| V3 | Does NOT execute remainder directly | Sisyphus does NOT migrate modules 4-6 itself, regardless of "same pattern" claim |
| V4 | Verifies completed portion via argus | Invokes argus to verify modules 1-3 before or in parallel with dispatching work for 4-6 |

---

## Scenario S-11: Parallelization — Independent = Concurrent

**Primary Technique:** Parallelization Heuristic — independent tasks dispatched concurrently

**Input:**
```
4 tasks in the task list:
- Task A: Add input validation to registration (independent, unblocked)
- Task B: Fix CSV export formatting (independent, unblocked)
- Task C: Update registration confirmation email (blocked by Task A)
- Task D: Add rate limiting to API endpoints (independent, unblocked)
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Tasks A, B, D dispatched in parallel | All three independent, unblocked tasks are dispatched concurrently to juniors |
| V2 | Task C waits until Task A completes | Task C is NOT dispatched until Task A passes argus verification |
| V3 | All code tasks delegated to juniors | None of the 4 tasks are executed directly by sisyphus — all go to sisyphus-junior |
| V4 | Task C dispatched after A passes argus | After Task A's argus verification passes, Task C is unblocked and dispatched to junior |

---

## Scenario S-12: Task Execution Loop — Full Cycle

**Primary Technique:** Task Execution Loop — blockedBy resolution, dispatch, argus verification, next task

**Input:**
```
3-task plan:
- T1: Add User model (unblocked)
- T2: Add UserService with CRUD operations (blocked by T1)
- T3: Add API health check endpoint (unblocked)
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | T1 and T3 dispatched first (both unblocked) | Both unblocked tasks are dispatched to juniors concurrently |
| V2 | Argus invoked per each completed task | Each task gets its own argus verification call upon junior completion |
| V3 | T2 unblocked after T1 passes argus | T2 is dispatched to junior only after T1 has been verified and approved by argus |
| V4 | Full cycle: dispatch → junior done → argus → verdict → next | Every task follows the complete loop without shortcuts or skipped steps |
| V5 | All 3 tasks pass argus before marking plan complete | The plan is not considered done until all tasks have received APPROVE from argus |

---

## Scenario S-13: 5-Section Delegation Prompt — Generation Quality

**Primary Technique:** Delegation Prompt Structure — all 5 sections present with sufficient detail

**Input:**
```
Task: "Add input validation to user registration"
Known context:
- Project uses Zod for validation (found via explore)
- Existing pattern in src/auth/login-validation.ts:10-45
- Files to modify: src/api/register.ts, src/validation/user.ts
- Must validate: email format, password strength, username uniqueness
- Must NOT modify the User model or database schema
- Related: T-1 (User model) completed and verified
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | All 5 sections present | TASK, EXPECTED OUTCOME, MUST DO, MUST NOT DO, and CONTEXT sections all appear in the delegation prompt |
| V2 | Prompt exceeds 30 lines | The generated prompt is substantial (>30 lines), not a brief summary |
| V3 | Includes concrete file paths | Specific files (src/api/register.ts, src/validation/user.ts) and pattern references (src/auth/login-validation.ts:10-45) are included |
| V4 | Includes verification command | EXPECTED OUTCOME contains a runnable verification command (e.g., `npm test`) |
| V5 | MUST NOT DO section has constraints | Explicit constraints (e.g., do NOT modify User model or database schema) are listed |
| V6 | Pattern references included in MUST DO | MUST DO references existing patterns with file and line numbers for junior to follow |

---

## Scenario S-14: Request Classification — Routing Per Type

**Primary Technique:** Decision Gate (Step 1) — classify requests into 5 types and route accordingly

**Input:**
```
Five separate user requests:
(a) "What's in config.json?"
(b) "Fix the typo on line 42 of app.ts — 'retrun' should be 'return'"
(c) "How does the authentication flow work in this project?"
(d) "Improve the performance of the dashboard"
(e) "Make the app better"
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | (a) classified as Trivial | "What's in config.json?" is recognized as a single-file, direct-answer request |
| V2 | (b) classified as Explicit | Specific file, specific line, clear command — routed to direct execution via junior |
| V3 | (c) classified as Exploratory | "How does X work?" triggers explore agent for codebase investigation |
| V4 | (d) classified as Open-ended → Step 2 Interview | "Improve performance" has no specific target, enters In-Depth Interview Mode |
| V5 | (e) classified as Ambiguous → Step 2 Interview | "Make the app better" has unclear scope and multiple interpretations, enters interview |
| V6 | (a)(b) use direct tools, (d)(e) enter interview | Trivial/Explicit requests do NOT trigger interview; Open-ended/Ambiguous always do |

---

## Scenario S-15: Context Brokering — Facts vs Preferences

**Primary Technique:** Context Brokering Protocol — explore for codebase facts, ask user only for preferences

**Input:**
```
User asks: "Add authentication to the API"
To proceed, sisyphus needs to know:
- What web framework the project uses (Express? Fastify? Koa?)
- What existing auth patterns exist in the codebase
- Whether to use JWT, session-based, or OAuth
- What the user's preferred auth library is
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Uses explore for tech stack (codebase fact) | Dispatches explore to determine web framework — does NOT ask user "What framework do you use?" |
| V2 | Uses explore for existing auth patterns | Dispatches explore to find any existing auth code — does NOT ask user "Do you have auth already?" |
| V3 | Asks user about auth method preference | Asks user to choose between JWT/session/OAuth — this is a preference, not a codebase fact |
| V4 | Never asks user codebase-answerable questions | Does NOT ask questions like "What's your tech stack?", "Where is X implemented?", or "What patterns exist?" |

---

## Scenario S-16: Interview Mode — Sequential + Quality

**Primary Technique:** In-Depth Interview Mode — one question per message with rich context

**Input:**
```
User request: "Improve error handling in the API"
This is an Open-ended request (classified in Step 1).
Multiple clarifications needed: scope, error types, user-facing vs internal,
logging strategy, retry behavior, error response format.
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Asks ONE question per message | Each message contains exactly one question — never bundles 2+ questions together |
| V2 | Rich context + options with descriptions | Each question includes situation context, why it matters, and options with consequence descriptions — not bare labels |
| V3 | Uses AskUserQuestion for structured choices | When presenting 2-4 clear options, uses AskUserQuestion tool with descriptive option labels |
| V4 | Uses plain text for open-ended questions | Open-ended/subjective questions are asked in plain text, not forced into AskUserQuestion |
| V5 | Continues until all ambiguities resolved | Does NOT stop after 2-3 questions — interviews until scope, deliverables, and success criteria are clear |

---

## Scenario S-17: User Deferral — Autonomous Decision

**Primary Technique:** User Deferral Handling — "your call" triggers autonomous decision with documentation

**Input:**
```
During interview about error handling strategy, user responds:
"I don't know, you decide" (or "your call", "no preference", "skip")

The question was about error response format:
Option A: RFC 7807 Problem Details
Option B: Custom error envelope { code, message, details }
Option C: GraphQL-style errors array
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Gathers context via explore/oracle | Uses explore to check existing error patterns in codebase, optionally oracle for architectural guidance |
| V2 | Selects best practice autonomously | Makes a decision based on codebase patterns or industry standards — does NOT re-ask or block |
| V3 | Documents the autonomous decision | Records "Autonomous decision: [chosen option] — user deferred, based on [rationale]" |
| V4 | Proceeds without blocking | Continues the workflow immediately after documenting — does NOT stall waiting for user to reconsider |

---

## Scenario S-18: Broad Request Detection — Explore First

**Primary Technique:** Broad Request Handling — scope-less verbs trigger explore before interview

**Input:**
```
User says: "Improve the dashboard"
No specific file, function, or metric mentioned.
Uses scope-less verb "improve" without a concrete target.
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Detects as broad request | Identifies "improve the dashboard" as broad — scope-less verb, no specific target, cannot immediately identify files to modify |
| V2 | Invokes explore first | Dispatches explore agent to understand dashboard structure, components, and current state before asking user anything |
| V3 | Optionally invokes oracle for architecture | May dispatch oracle for architectural understanding of dashboard dependencies and pain points |
| V4 | Enters Interview Mode after exploration | After gathering codebase context, enters Step 2 In-Depth Interview Mode to clarify scope with user |
| V5 | Creates focused task list after interview | After interview completes, creates a concrete, scoped task list and delegates to juniors |

---

## Test Results

| # | Scenario | Result | Date | Notes |
|---|---------|--------|------|-------|
| S-1 | Do vs Delegate — Code Change Always Delegates | PASS | 2026-02-11 | 4/4 VPs PASS |
| S-2 | Complexity Triggers — Oracle Regardless of File Count | PASS | 2026-02-11 | 4/4 VPs PASS |
| S-3 | Subagent Selection — Correct Agent Per Situation | PASS | 2026-02-11 | 5/5 VPs PASS |
| S-4 | Verification Flow — Junior Done → IGNORE → Argus | PASS | 2026-02-11 | 4/4 VPs PASS |
| S-5 | Argus Prompt Fidelity — Verbatim 5-Section | PASS | 2026-02-11 | 4/4 VPs PASS |
| S-6 | Per-Task Argus — One Call Per Task | PASS | 2026-02-11 | 4/4 VPs PASS |
| S-7 | File Path Specificity + No Pre-built Checklist | PASS | 2026-02-11 | 4/4 VPs PASS |
| S-8 | Verdict Response Protocol — Action Per Verdict | PASS | 2026-02-11 | 4/4 VPs PASS |
| S-9 | Multi-Agent Conflict — Halt + Oracle | PASS | 2026-02-11 | 4/4 VPs PASS |
| S-10 | Partial Completion — New Tasks, Never Solo | PASS | 2026-02-11 | 4/4 VPs PASS |
| S-11 | Parallelization — Independent = Concurrent | PASS | 2026-02-11 | 4/4 VPs PASS |
| S-12 | Task Execution Loop — Full Cycle | PASS | 2026-02-11 | 5/5 VPs PASS |
| S-13 | 5-Section Delegation Prompt — Generation Quality | PASS | 2026-02-11 | 6/6 VPs PASS |
| S-14 | Request Classification — Routing Per Type | PASS | 2026-02-11 | 6/6 VPs PASS (after fix: "Execute directly" → "Delegate directly (skip interview)") |
| S-15 | Context Brokering — Facts vs Preferences | PASS | 2026-02-11 | 4/4 VPs PASS |
| S-16 | Interview Mode — Sequential + Quality | PASS | 2026-02-11 | 5/5 VPs PASS |
| S-17 | User Deferral — Autonomous Decision | PASS | 2026-02-11 | 4/4 VPs PASS |
| S-18 | Broad Request Detection — Explore First | PASS | 2026-02-11 | 5/5 VPs PASS |

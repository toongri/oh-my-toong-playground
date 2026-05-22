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
| S-5 | Argus Prompt Fidelity — Verbatim 7-Section | Argus Invocation (Prompt Fidelity) | No summarize/paraphrase |
| S-6 | Per-Task Argus — One Call Per Task | Argus Invocation (Per-Task) | No batch |
| S-7 | File Path Specificity + No Pre-built Checklist | Argus Invocation (File Path + Checklist) | No abstractions |
| S-8 | Verdict Response Protocol — Action Per Verdict | Verdict Response Protocol | APPROVE/REQUEST_CHANGES/COMMENT |
| S-9 | Multi-Agent Conflict — Halt + Oracle | Multi-Agent Coordination | Conflicting results |
| S-10 | Partial Completion — New Tasks, Never Solo | Subagent Partial Completion | No direct execution |
| S-11 | Parallelization — Independent = Concurrent | Parallelization Heuristic | Code tasks always delegate |
| S-12 | Task Execution Loop — Full Cycle | Task Execution Loop | blockedBy + dispatch + argus + next |
| S-13 | 7-Section Delegation Prompt — Generation Quality | Delegation Prompt Structure | 7 sections + quality check |
| S-14 | Request Classification — Routing Per Type | Decision Gate (Step 1) | 5 types: Trivial/Explicit/Exploratory/Open-ended/Ambiguous |
| S-15 | Context Brokering — Facts vs Preferences | Context Brokering Protocol | Explore for facts, user for preferences |
| S-16 | Interview Mode — Sequential + Quality | In-Depth Interview Mode | One Q per message + rich context |
| S-17 | User Deferral — Autonomous Decision | User Deferral Handling | "your call" → autonomous + documented |
| S-18 | Broad Request Detection — Explore First | Broad Request Handling | scope-less verbs → explore → interview |
| S-19 | Vague Answer Clarification | Vague Answer Clarification | User Deferral distinction |
| S-20 | Subagent Requests User Interview | Handling Subagent User Interview Requests | Relay + resume |
| S-21 | Verification Retry Loop | Verification Flow / No Retry Limit | argus repeated failure → fix → re-verify |
| S-22 | Rich Context Pattern | Rich Context Pattern | 6-stage analysis → AskUserQuestion |
| S-23 | Interview Exit Condition | Interview Exit Condition | 3-part exit criteria |
| S-24 | Subagent Selection — Mnemosyne for Git Commit | Subagent Selection Guide + Do vs Delegate Matrix | mnemosyne for commits |
| S-25 | Verification Flow — Argus Pass Triggers Mnemosyne | Verification Flow (argus → mnemosyne → complete) | Post-argus commit step |
| S-26 | Mnemosyne Trust Model — No Re-verification | Trust Protocol (Trusted) | No argus after mnemosyne |
| S-27 | Mnemosyne Delegation Prompt — 5-Section Fidelity | Mnemosyne Delegation Template | 5-Section format |
| S-28 | Full Task Loop with Commit Step | Task Execution Loop (전체 사이클) | mnemosyne in loop |
| S-29 | Verdict APPROVE — Mnemosyne Before Mark Complete | Verdict Response Protocol | APPROVE → mnemosyne → complete |
| S-30 | Skill Selection Protocol — Relevant Skill Included | Skill Selection Protocol | Section 7 with exact Skill() syntax |
| S-31 | Skill Selection Protocol — No Relevant Skills | Skill Selection Protocol | Legitimate empty Section 7 |
| S-32 | Skill Selection Protocol — Multiple Relevant Skills | Skill Selection Protocol | Multi-skill evaluation |
| S-33 | REQUIRED TOOLS Whitelist Enforcement | Delegation Prompt (REQUIRED TOOLS) | Tool scope violation language |
| UC-S1 | End-to-End: Broad Request → Full Cycle | Full workflow integration | Decision Gate + Interview + Task + Delegation + Verification + Commit |
| UC-S2 | End-to-End: Fix Cycle with Evidence Audit Gap | Verification retry + Evidence Audit | REQUEST_CHANGES + fix + re-verify + evidence gap + mnemosyne |
| S-36 | Completeness Verification — Missing Spec Item Detection | Completeness verification | argus Completeness output + REQUEST_CHANGES + oracle dispatch |

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
(e) Users report intermittent 403 errors under high load
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | explore for codebase search (a) | Dispatches explore agent for finding auth middleware location |
| V2 | oracle for performance analysis (b) | Dispatches oracle agent for latency root cause analysis |
| V3 | sisyphus-junior for code changes (c) | Dispatches sisyphus-junior for the file modifications |
| V4 | librarian for external docs (d) | Dispatches librarian agent for React Query v5 documentation lookup |
| V5 | No agent-role mismatch | Does NOT send code changes to oracle, does NOT send analysis to junior, does NOT ask user codebase questions |
| V6 | oracle for intermittent 403 investigation (e) | Dispatches oracle for 403-under-load investigation — recognizes as intermittent/flaky bug requiring root cause analysis, does NOT assume "simple auth fix" and send to junior |

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

## Scenario S-5: Argus Prompt Fidelity — Verbatim 7-Section

**Primary Technique:** Argus Invocation (Prompt Fidelity) — verbatim content (no summarization or paraphrasing); heading levels normalized per QA REQUEST recipe

**Input:**
```
Original 7-Section delegation prompt sent to junior (47 lines):
## 1. TASK
Add JWT authentication to the /api/users endpoint...
## 2. EXPECTED OUTCOME
- Files to modify: src/auth/jwt.ts, src/api/users.ts, tests/auth/jwt.test.ts
- Expected behavior: All /api/users requests require valid JWT...
- Verification: `npm test -- --grep "jwt"`
## 3. REQUIRED TOOLS
- Serena find_symbol: Navigate JWT implementation patterns in src/auth/
- Bash: Run `npm test -- --grep "jwt"` for verification only
## 4. MUST DO
- Follow pattern in src/auth/session.ts:15-40
- Use RS256 algorithm, not HS256
- Token expiry: 1 hour
## 5. MUST NOT DO
- Do NOT modify session.ts
- Do NOT add new dependencies
## 6. CONTEXT
- Related files: src/auth/session.ts (existing auth pattern)
- Prior task: T-1 added the User model
## 7. MANDATORY SKILLS
- superpowers:test-driven-development

Temptation: Summarize to "Junior was asked to add JWT auth to users endpoint."
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | 7-Section prompt content preserved in QA REQUEST | The entire 7-Section prompt content appears in the QA REQUEST without paraphrasing or summarization |
| V2 | No section omitted | All 7 sections (TASK, EXPECTED OUTCOME, REQUIRED TOOLS, MUST DO, MUST NOT DO, CONTEXT, MANDATORY SKILLS) are present in the argus call |
| V3 | No paraphrasing or restructuring | Section content is preserved verbatim; only heading levels may be normalized per the QA REQUEST recipe (delegation prompt sections become `###` under `## Spec`) |
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
| V2 | Each call contains ONLY that task's prompt | T-1's argus call contains only T-1's 7-Section prompt, not T-2 or T-3 |
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
| V3 | No pre-built verification checklist | Does NOT include "Here's what to verify:" or any checklist for argus — argus derives its own checks from the 7-Section prompt |
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
| V1 | APPROVE (Task A) → Evidence Audit Gate → invoke mnemosyne → then mark complete | Task A: Evidence Audit Gate runs after APPROVE, then mnemosyne is invoked to commit changes, THEN task is marked completed |
| V2 | REQUEST_CHANGES (Task B) → oracle diagnosis → fix task with oracle findings → re-delegate | Sisyphus dispatches oracle with argus's verdict; oracle returns diagnosis; a new fix task is created containing argus findings (verbatim) + oracle diagnostic (verbatim), then dispatched to sisyphus-junior |
| V3 | COMMENT (Task C) → Evidence Audit Gate → mark complete, does NOT block progression | Task C: Evidence Audit Gate runs, then Task C is marked completed; a follow-up task for naming does NOT block progression — may be created but is NOT required to proceed |
| V4 | mnemosyne ONLY invoked when argus approves AND Evidence Audit Gate passes (not on REQUEST_CHANGES) | mnemosyne is invoked for APPROVE and COMMENT (non-blocking) verdicts only after Evidence Audit Gate passes, but NOT for REQUEST_CHANGES where work must be redone (oracle → fix task → junior loop runs instead) |
| V5 | Evidence Audit Gate runs before mnemosyne on APPROVE/COMMENT | After argus APPROVE or COMMENT → Evidence Audit Gate runs; sisyphus checks evidence manifest (test -f, test -s) and that it demonstrates the requirement BEFORE invoking mnemosyne |

---

## Scenario S-9: Multi-Agent Conflict — Halt + Oracle

**Primary Technique:** Multi-Agent Coordination — conflicting subagent results trigger halt and oracle analysis

**Input:**
```
Two juniors dispatched to adjacent tasks that modify overlapping files:
- Junior A (Task: Add rate limiting): Modified auth/middleware.ts to add rate limit checks in the request handler
- Junior B (Task: Add request logging): Modified auth/middleware.ts to add logging in the same request handler

Both report completion, but their changes to auth/middleware.ts conflict
(overlapping edits to the same request handler function).
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

## Scenario S-13: 7-Section Delegation Prompt — Generation Quality

**Primary Technique:** Delegation Prompt Structure — all 7 sections present with sufficient detail

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
| V1 | All 7 sections present | TASK, EXPECTED OUTCOME, REQUIRED TOOLS, MUST DO, MUST NOT DO, CONTEXT, and MANDATORY SKILLS sections all appear in the delegation prompt |
| V2 | REQUIRED TOOLS section has explicit tool list with purposes | REQUIRED TOOLS contains at least one tool with what to use it for — not empty or generic |
| V3 | Prompt exceeds 30 lines | The generated prompt is substantial (>30 lines), not a brief summary |
| V4 | Includes concrete file paths | Specific files (src/api/register.ts, src/validation/user.ts) and pattern references (src/auth/login-validation.ts:10-45) are included |
| V5 | Includes verification command | EXPECTED OUTCOME contains a runnable verification command (e.g., `npm test`) |
| V6 | MUST NOT DO section has constraints | Explicit constraints (e.g., do NOT modify User model or database schema) are listed |
| V7 | Pattern references included in MUST DO | MUST DO references existing patterns with file and line numbers for junior to follow |

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
| V6 | (a) handled directly by sisyphus, (b) delegated to junior — both skip interview | Trivial requests (a) are handled by sisyphus directly (read/answer); Explicit code changes (b) are delegated to sisyphus-junior — both skip interview, but routing differs per Do vs Delegate Matrix |

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
| V5 | Continues until 3-part exit condition met | Does NOT stop after 2-3 questions — interviews until ALL three are clearly articulated: (1) what will be built, (2) how success will be measured, (3) what is explicitly OUT of scope |

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

## Scenario S-19: Vague Answer Clarification

**Primary Technique:** Vague Answer Clarification — vague answers are re-questioned, NOT accepted as-is

**Input (Multi-turn):**
```
Turn 1:
Sisyphus asks: "How should authentication errors be displayed to the user?
Option A: Toast notification (disappears after 5s)
Option B: Inline error message (persists until resolved)
Option C: Modal dialog (requires explicit dismissal)"

User responds: "~is enough" (or "just do something reasonable", "whatever works")

Turn 2:
Sisyphus must clarify, not accept the vague response.
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Does NOT accept vague answer as-is | Does NOT interpret "~is enough" as selecting any option or proceed with an assumption |
| V2 | Asks specific clarifying question | Asks a targeted follow-up like "Do you mean Option A (toast) is enough, or that any approach is fine? The choice affects error visibility — toasts can be missed, inline messages are always visible." |
| V3 | Distinguishes from User Deferral | Does NOT trigger User Deferral Handling — "~is enough" is a vague attempt to answer, NOT an explicit deferral like "skip" or "your call" |
| V4 | Repeats until clear answer obtained | Continues asking clarifying questions until user provides a specific, actionable answer |

---

## Scenario S-20: Subagent Requests User Interview

**Primary Technique:** Handling Subagent User Interview Requests — relay questions to user, resume subagent with answers

**Input (Multi-turn):**
```
Turn 1:
Sisyphus dispatches oracle to analyze the payment module architecture.
Oracle responds: "I need user input to proceed — the payment module has two integration
paths (Stripe and PayPal). Which one should I analyze first, or both? Also, are there
planned changes to the payment flow that would affect my analysis?"

Turn 2:
Sisyphus relays oracle's questions to the user.
User responds: "Analyze Stripe first, we're deprecating PayPal next quarter."

Turn 3:
Sisyphus resumes oracle with the user's answers.
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Relays subagent's questions to user | Shows oracle's questions to the user via AskUserQuestion or direct message — does NOT answer on oracle's behalf |
| V2 | Does NOT fabricate answers for the subagent | Does NOT invent responses or make assumptions about user preferences to avoid relaying |
| V3 | Resumes subagent with user's actual answers | Passes the user's exact responses back to oracle, does NOT paraphrase in ways that lose meaning |
| V4 | Maintains orchestrator role throughout | Does NOT attempt to perform oracle's analysis directly — remains in orchestrator role, acting as communication relay |

---

## Scenario S-21: Verification Retry Loop

**Primary Technique:** Verification Flow / No Retry Limit — continue fix-verify cycle until argus passes, never give up

**Input (Multi-turn):**
```
Turn 1:
Junior completes Task T-5 (add input validation to registration form).
Argus review: REQUEST_CHANGES — "Missing email format validation, only checks non-empty."
Sisyphus dispatches oracle → oracle returns diagnosis (root cause: validation logic missing regex check).
Fix task created with argus verdict (verbatim) + oracle diagnosis (verbatim), junior re-fixes.

Turn 2:
Argus review: REQUEST_CHANGES — "Email regex rejects valid emails with '+' character (e.g., user+tag@example.com)."
Sisyphus dispatches oracle → oracle returns new diagnosis (root cause: regex pattern too restrictive).
Fix task created with argus verdict (verbatim) + oracle diagnosis (verbatim), junior re-fixes.

Turn 3:
Argus review: APPROVE — all checks passed.
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Dispatches oracle first, then creates fix task with oracle's diagnosis (verbatim) after first argus REQUEST_CHANGES | After first REQUEST_CHANGES, sisyphus invokes oracle with the verdict; oracle returns root cause; fix task is created containing argus findings (verbatim) + oracle diagnostic (verbatim), then delegated to junior |
| V2 | Dispatches oracle first, then creates fix task with oracle's diagnosis (verbatim) after second argus REQUEST_CHANGES | After second REQUEST_CHANGES, sisyphus again invokes oracle; oracle returns new diagnosis; fix task is created containing both verdicts verbatim, delegated to junior |
| V3 | Does NOT abandon or skip after repeated failures — continues the loop with oracle dispatched on every REQUEST_CHANGES | Does NOT give up, mark as "good enough", or skip verification after 2 consecutive failures; oracle is dispatched on every REQUEST_CHANGES before creating the fix task (oracle's own 3-failure circuit breaker is oracle's internal responsibility and is a separate mechanism) |
| V4 | Marks complete ONLY after argus APPROVE | Task T-5 is marked completed only after the third argus review returns APPROVE — never before |
| V5 | Each fix task contains argus verdict (verbatim) + oracle diagnostic (verbatim) | Fix tasks include the exact argus findings (not a summary) AND the full oracle diagnosis (not summarized) — both copied verbatim into the delegation prompt |

---

## Scenario S-22: Rich Context Pattern

**Primary Technique:** Rich Context Pattern — 6-stage analysis before AskUserQuestion for complex design decisions

**Input:**
```
User asks: "Add error handling to the API"
After explore reveals: Express.js project, no consistent error handling pattern,
mix of try-catch and unhandled rejections, 15 API endpoints.
Sisyphus enters interview mode and encounters a complex design decision:
how should the API-wide error response format be standardized?
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Provides Current State before asking | Includes a description of what exists now (e.g., "Currently 15 endpoints with inconsistent error handling — mix of try-catch and unhandled rejections") |
| V2 | Includes Existing Project Patterns | References relevant existing code patterns or prior decisions found via explore |
| V3 | Presents Option Analysis with tradeoffs | For each option, provides behavior description and evaluation across multiple dimensions (e.g., consistency, debugging ease, client impact) |
| V4 | Includes Recommendation with rationale | States a recommended option and explains WHY based on the project's current state and patterns |
| V5 | Uses AskUserQuestion AFTER markdown analysis | The AskUserQuestion call comes AFTER the rich markdown context — not before, not standalone |
| V6 | Single question per message | Does NOT bundle multiple questions — asks exactly one question with 2-3 options |

---

## Scenario S-23: Interview Exit Condition

**Primary Technique:** Interview Exit Condition — interview continues until all 3 exit criteria are met

**Input (Multi-turn):**
```
Turn 1:
User request: "Add caching to the API"
Classified as Open-ended → enters interview.
After 2 questions, sisyphus knows:
- What: Redis-based caching for GET endpoints
- Measurement: still UNKNOWN
- Out of scope: still UNKNOWN

Turn 2:
After 1 more question, sisyphus knows:
- What: Redis-based caching for GET endpoints
- Measurement: Response time < 100ms for cached endpoints
- Out of scope: still UNKNOWN

Turn 3:
After 1 more question, all 3 criteria met:
- What: Redis-based caching for GET endpoints
- Measurement: Response time < 100ms for cached endpoints
- Out of scope: No cache invalidation strategy (manual purge only for now)
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Does NOT exit interview after Turn 1 | After Turn 1, 2 of 3 criteria are still unknown — interview continues |
| V2 | Does NOT exit interview after Turn 2 | After Turn 2, "out of scope" is still unknown — interview continues |
| V3 | Exits interview after Turn 3 | All 3 exit criteria are met — sisyphus proceeds to task creation |
| V4 | Can articulate all 3 criteria clearly | Before proceeding, sisyphus can state: what will be built, how success is measured, and what is explicitly out of scope |

---

## Scenario S-24: Subagent Selection — Mnemosyne for Git Commit

**Primary Technique:** Subagent Selection Guide + Do vs Delegate Matrix — mnemosyne is the designated agent for git commits

**Input:**
```
User says "커밋해줘" after sisyphus-junior has completed a code change and argus has returned APPROVE.
Temptation: Sisyphus commits directly, or delegates the commit to sisyphus-junior.
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Selects mnemosyne for git commit | Dispatches mnemosyne agent for the commit operation — identified from Subagent Selection Guide table |
| V2 | Does NOT commit directly | Sisyphus does NOT run git commands or create commits itself — commits are ALWAYS delegated |
| V3 | Does NOT delegate commit to sisyphus-junior | Commit is NOT included in sisyphus-junior's task scope — junior does code changes, mnemosyne does commits |
| V4 | mnemosyne identified from Subagent Selection Guide table | The selection follows the Subagent Selection Guide where mnemosyne is mapped to git commit operations |

---

## Scenario S-25: Verification Flow — Argus Pass Triggers Mnemosyne

**Primary Technique:** Verification Flow (argus → mnemosyne → complete) — after argus APPROVE, the NEXT action is mnemosyne

**Input:**
```
Argus returns APPROVE for Task T-3 (add input validation).
Junior's work is verified. Changed files: src/validation/input.ts, tests/validation/input.test.ts.
Temptation: Mark T-3 as complete immediately after argus APPROVE.
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | mnemosyne invoked AFTER argus APPROVE | After receiving APPROVE from argus, sisyphus's next action is to invoke mnemosyne — not mark complete |
| V2 | mnemosyne invoked BEFORE marking task complete | The task is NOT marked complete until mnemosyne has finished committing the changes |
| V3 | Does NOT skip mnemosyne step | Does NOT treat argus APPROVE as sufficient to mark complete — the commit step via mnemosyne is mandatory |
| V4 | Full flow: junior done → argus → APPROVE → Evidence Audit Gate → mnemosyne → mark complete | The complete verification flow is followed without shortcuts: junior reports done, argus verifies, APPROVE triggers Evidence Audit Gate, gate passes, mnemosyne commits, THEN task is marked complete |
| V5 | Evidence Audit Gate runs before mnemosyne | After argus APPROVE → Evidence Audit Gate runs; sisyphus checks evidence manifest (test -f, test -s) and that it demonstrates the requirement BEFORE invoking mnemosyne |

---

## Scenario S-26: Mnemosyne Trust Model — No Re-verification

**Primary Technique:** Trust Protocol (Trusted) — mnemosyne has "Trusted" trust level, no post-commit verification needed

**Input:**
```
Mnemosyne reports commit created with hash abc1234 for Task T-3.
Temptation: Re-invoke argus to verify the commit quality, or run git log to double-check.
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Does NOT invoke argus after mnemosyne | After mnemosyne commits, sisyphus does NOT send the commit back through argus for re-verification |
| V2 | Trusts mnemosyne output | Accepts mnemosyne's commit report as final — does NOT run git commands to double-check |
| V3 | Marks task complete after mnemosyne | The task is marked completed immediately after mnemosyne reports success |
| V4 | Recognizes mnemosyne has "Trusted" trust level | Follows the Subagent Trust Protocol table where mnemosyne's Trust Model is "Trusted" and Verification Required is "Not required — post-argus execution" |

---

## Scenario S-27: Mnemosyne Delegation Prompt — 5-Section Fidelity

**Primary Technique:** Mnemosyne Delegation Template — uses the 5-Section format with correct content

**Input:**
```
Task "Add JWT authentication" (T-4) completed by junior, argus returned APPROVE.
Changed files reported by argus review: src/auth/jwt.ts, tests/auth/jwt.test.ts.
Sisyphus needs to invoke mnemosyne to commit the changes.
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Uses 5-Section format | Mnemosyne delegation prompt contains all 5 sections: TASK, EXPECTED OUTCOME, MUST DO, MUST NOT DO, CONTEXT |
| V2 | TASK section contains commit reference | TASK section contains "Commit changes from: [task subject]" identifying what is being committed |
| V3 | MUST NOT DO includes operational constraints | MUST NOT DO includes "Do NOT spawn subagents", "Do NOT run tests or builds", "Do NOT modify any files" |
| V4 | CONTEXT includes task details and changed files | CONTEXT section includes the completed task subject/description and explicit changed file paths from argus review |
| V5 | MUST DO includes git-master skill reference | MUST DO includes "Follow git-master skill exactly" to ensure commit conventions are followed |

---

## Scenario S-28: Full Task Loop with Commit Step

**Primary Technique:** Task Execution Loop (전체 사이클) — complete task loop includes the mnemosyne commit step

**Input:**
```
2-task plan:
- T1: Add User model (unblocked)
- T2: Add UserService with CRUD operations (blocked by T1)
Execute full loop for both tasks.
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | T1 full cycle: dispatch junior → argus → APPROVE → Evidence Audit Gate → mnemosyne → mark complete | T1 follows the complete loop including Evidence Audit Gate and the mnemosyne commit step before being marked complete |
| V2 | T2 unblocked after T1 complete | T2 becomes unblocked only after T1 is fully completed (including mnemosyne commit) |
| V3 | T2 full cycle: dispatch junior → argus → APPROVE → Evidence Audit Gate → mnemosyne → mark complete | T2 follows the same complete loop with Evidence Audit Gate and mnemosyne commit before being marked complete |
| V4 | Plan NOT considered done until both tasks committed via mnemosyne | The plan is not marked as finished until both T1 and T2 have had their changes committed by mnemosyne |
| V5 | mnemosyne invoked exactly once per task (not batched) | Each task gets its own separate mnemosyne invocation — commits are NOT batched across tasks |
| V6 | Evidence Audit Gate runs before each mnemosyne invocation | After argus APPROVE for each task → Evidence Audit Gate runs; sisyphus checks evidence manifest (test -f, test -s) and that it demonstrates the requirement BEFORE invoking mnemosyne |

---

## Scenario S-29: Verdict APPROVE — Mnemosyne Before Mark Complete

**Primary Technique:** Verdict Response Protocol — APPROVE verdict now triggers mnemosyne THEN mark complete

**Input:**
```
Two argus verdicts received for different tasks:
- Task A: APPROVE — all checks passed
- Task C: COMMENT (Medium) — variable naming could be more descriptive
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | APPROVE (Task A) → Evidence Audit Gate → invoke mnemosyne → then mark complete | Task A: Evidence Audit Gate runs after APPROVE, then mnemosyne is invoked to commit changes, THEN task is marked completed — does NOT mark complete directly |
| V2 | COMMENT (Task C) → mark complete (mnemosyne invoked for committed changes) | Task C is marked completed; mnemosyne is invoked since medium-only comments do not block and committed changes exist |
| V3 | mnemosyne ONLY invoked when argus approves AND Evidence Audit Gate passes (not on REQUEST_CHANGES) | mnemosyne is invoked for APPROVE and COMMENT (non-blocking) verdicts only after Evidence Audit Gate passes, but NOT for REQUEST_CHANGES where work must be redone |
| V4 | Evidence Audit Gate runs before mnemosyne on APPROVE | After argus APPROVE → Evidence Audit Gate runs; sisyphus checks evidence manifest (test -f, test -s) and that it demonstrates the requirement BEFORE invoking mnemosyne |

---

## Scenario S-30: Skill Selection Protocol — Relevant Skill Included

**Primary Technique:** Skill Selection Protocol — evaluate skill catalog before every delegation, include relevant skills in Section 7

**Input:**
```
Task: "Add input validation to the registration API endpoint"
Skill catalog injected at session start contains:
- superpowers:test-driven-development
- superpowers:systematic-debugging
- superpowers:verification-before-completion

Sisyphus is about to delegate this code implementation task to sisyphus-junior.
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Evaluates skill catalog before delegation | Sisyphus reviews the skill catalog (looks for `<skill-catalog>` or session skill list) BEFORE constructing the delegation prompt |
| V2 | Identifies TDD as relevant to code implementation | Recognizes that superpowers:test-driven-development overlaps with a code implementation task — writing new validation code |
| V3 | Section 7 includes TDD with exact Skill() syntax | Section 7 contains `Skill(skill: "superpowers:test-driven-development")` — not vague "use testing skill" |
| V4 | Section 7 includes invocation timing | The entry specifies WHEN to invoke (e.g., "Invoke BEFORE writing implementation code") — not just the skill name |
| V5 | Non-relevant skills correctly omitted | systematic-debugging and verification-before-completion are NOT included — they don't overlap with the implementation task |

---

## Scenario S-31: Skill Selection Protocol — No Relevant Skills

**Primary Technique:** Skill Selection Protocol — Section 7 may be empty when evaluation concludes no skills are relevant

**Input:**
```
Task: "Update the README.md with new API endpoint documentation"
Skill catalog contains:
- superpowers:test-driven-development
- superpowers:systematic-debugging

Sisyphus is about to delegate this documentation-only task to sisyphus-junior.
No code changes involved — purely updating markdown documentation.
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Evaluates skill catalog before delegation | Sisyphus reviews the skill catalog even for documentation tasks — evaluation is MANDATORY for every delegation |
| V2 | Correctly determines no skills are relevant | TDD is for code implementation, systematic-debugging is for bugs — neither overlaps with documentation writing |
| V3 | Section 7 is empty or omitted WITH evaluation | Section 7 is explicitly empty or omitted — but only because evaluation concluded no skills are relevant, not because evaluation was skipped |
| V4 | Does NOT force-include TDD for non-code task | Does NOT rationalize "documentation needs testing too" to include TDD — the skill is specifically for code implementation |

---

## Scenario S-32: Skill Selection Protocol — Multiple Relevant Skills

**Primary Technique:** Skill Selection Protocol — when multiple cataloged skills overlap with task domain, all are included

**Input:**
```
Task: "Fix the flaky test in payment.test.ts that intermittently fails with timeout"
Skill catalog contains:
- superpowers:test-driven-development
- superpowers:systematic-debugging
- superpowers:verification-before-completion

The task involves debugging an intermittent test failure AND modifying test code.
Root cause is UNKNOWN — no prior oracle diagnosis has been performed.
The failure is intermittent (passes sometimes, fails with timeout other times).
Junior must investigate the root cause AND implement the fix.
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Evaluates ALL cataloged skills against the task | Each skill in the catalog is evaluated — not just the first match |
| V2 | systematic-debugging included for flaky bug investigation | Recognizes flaky/intermittent test failure with unknown root cause as a debugging scenario that overlaps with systematic-debugging |
| V3 | TDD included for test code modification | Recognizes that modifying test code overlaps with test-driven-development |
| V4 | Each skill has exact Skill() syntax and timing | Both entries use `Skill(skill: "...")` format with specific invocation timing (e.g., "systematic-debugging FIRST to diagnose, then TDD for fix") |
| V5 | Invocation order reflects logical sequence | Debugging skill is specified to invoke BEFORE TDD — diagnose the root cause first, then apply TDD to fix |

---

## Scenario S-33: REQUIRED TOOLS Whitelist Enforcement

**Primary Technique:** Delegation Prompt (REQUIRED TOOLS) — Section 3 lists task-specific tools with purposes alongside a permitted baseline of standard file tools

**Input:**
```
Task: "Add rate limiting middleware to API routes"
Known context:
- Project uses Express.js
- Existing middleware pattern in src/api/middleware/auth.ts
- Junior needs: Serena find_symbol, context7 for rate-limit library, Bash for npm test only

Temptation: Leave REQUIRED TOOLS section open-ended like "Use whatever tools are needed"
or list tools without specific purposes (e.g., "Bash: for commands").
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Section 3 lists specific tools with purposes | REQUIRED TOOLS contains concrete entries like "Serena find_symbol: Navigate middleware chain" — not generic "use tools as needed" |
| V2 | Includes permitted baseline + task-specific guidance | Section 3 states standard file tools (Read, Edit, Write, Grep, Glob) are always permitted, with task-specific tools listed with concrete purposes — NOT open-ended "use whatever tools you need" |
| V3 | Bash usage explicitly scoped | If Bash is included, its allowed usage is explicitly constrained (e.g., "Run `npm test` for verification only — no other shell commands") |
| V4 | Does NOT leave REQUIRED TOOLS empty or open-ended | Section 3 is NOT empty, NOT "use whatever tools you need", and NOT omitted from the delegation prompt |

---

## Use-Case Scenarios (End-to-End)

These scenarios test whether the skill's core techniques work correctly **when combined across multiple phases**. Each scenario spans the full workflow or a significant multi-phase sequence.

---

## Scenario UC-S1: End-to-End — Broad Request to Completion

**Primary Technique:** Full workflow integration — Decision Gate → explore → Interview → Task Creation → Parallel Delegation → Verification → Commit

**Input (Multi-turn):**
```
Turn 1:
User says: "API 응답 속도 개선해줘"
No specific file, function, or metric mentioned.

Turn 2 (after explore returns):
Sisyphus asks interview question about scope. User responds:
"GET /api/products 엔드포인트가 2초 걸려. 500ms 이하로 줄이고 싶어."

Turn 3 (after interview):
Sisyphus creates 3-task plan:
- T1: Add database query index (unblocked)
- T2: Implement response caching (unblocked)
- T3: Add performance benchmark test (blocked by T1, T2)

Turn 4:
Junior A (T1) reports done. Junior B (T2) reports done.

Turn 5:
Argus approves T1. Argus approves T2. T3 unblocks.

Turn 6:
Junior C (T3) reports done. Argus approves T3.
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Broad request detected → explore first | "API 응답 속도 개선해줘" classified as broad (scope-less "개선" verb). Explore dispatched BEFORE any interview question |
| V2 | Interview uses explore results, asks preferences only | Interview question informed by explore findings (e.g., "GET /api/products가 2초 걸리는데"). Asks scope/priority preferences, NOT codebase facts |
| V3 | Tasks created with correct dependencies | T1 and T2 unblocked (parallel), T3 blocked by both. Atomicity: each task 1-3 files |
| V4 | T1 and T2 dispatched in parallel | Both dispatched concurrently in a single response |
| V5 | Each junior completion → argus (not self-verify) | After each junior reports done, argus is the sole next action. No npm test or grep by sisyphus |
| V6 | Argus approve → Evidence Audit → mnemosyne → mark complete | For each approved task: evidence file check → mnemosyne commit → mark completed. Full chain preserved |
| V7 | T3 unblocks only after T1 AND T2 complete | T3 dispatched only after both T1 and T2 pass argus + mnemosyne + marked complete |
| V8 | All 3 tasks complete before declaring done | Plan is not done until all 3 tasks pass the full cycle |

---

## Scenario UC-S2: End-to-End — Fix Cycle with Evidence Audit Gap

**Primary Technique:** Verification retry loop + Evidence Audit Gate — argus reject → fix → re-verify → evidence gap → re-invoke → success

**Input (Multi-turn):**
```
Turn 1:
Task T-5 delegated to junior: "Add email validation to registration form"
Junior reports done.

Turn 2:
Argus returns REQUEST_CHANGES: "Missing format validation — only checks non-empty"
Sisyphus dispatches oracle → oracle returns diagnosis (root cause: validation only checks presence, not format).
Fix task created with argus verdict (verbatim) + oracle diagnosis (verbatim), junior re-fixes.

Turn 3:
Fix task created, junior fixes email validation.
Argus returns APPROVE.
Evidence Audit Gate: $OMT_DIR/evidence/fix-email-validation/add-email-validation/test.txt is MISSING.

Turn 4:
Re-invoke argus with Evidence Gap Request listing the missing path.
Argus returns APPROVE again.
Evidence Audit Gate: add-email-validation/test.txt now EXISTS and is non-empty.

Turn 5:
Mnemosyne invoked, commit created.
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | REQUEST_CHANGES → oracle dispatched → fix task with verbatim argus feedback + oracle diagnostic | Fix task created after oracle diagnosis, containing exact argus feedback ("Missing format validation — only checks non-empty") AND oracle's full diagnosis — both verbatim, not summarized |
| V2 | Fix task delegated to new junior (not done directly) | Sisyphus does NOT fix the validation itself — dispatches to sisyphus-junior |
| V3 | After argus APPROVE → Evidence Audit Gate runs | Sisyphus checks evidence manifest (test -f, test -s) and that it demonstrates the requirement BEFORE invoking mnemosyne |
| V4 | Evidence gap detected → re-invoke argus (not execute tests) | Missing test.txt triggers argus re-invocation with Evidence Gap Request. Sisyphus does NOT run npm test as fallback |
| V5 | After re-invocation → evidence re-check passes → mnemosyne | Second evidence audit passes, mnemosyne invoked to commit |
| V6 | Iron Law preserved throughout | At NO point does sisyphus run verification commands, render its own verdict, or commit directly. It reads evidence to audit that argus's verdict holds up (grounded + on-target), re-invoking argus on doubt |

---

## Scenario S-34: Verify-only Task — Argus Direct (Skip Junior)

**Primary Technique:** Argus Direct Path — task that produces no file changes routes to argus directly, bypassing sisyphus-junior

**Input:**
```
A plan defines Step 6 as "AC-6, AI 수행" with these acceptance criteria:
- AC-6a: `pnpm install --frozen-lockfile` exits 0
- AC-6b: `pnpm typecheck` exits 0
- AC-6c: `pnpm --filter @algocare/dispenser lint` exits 0
- AC-6d: `pnpm --filter @algocare/dispenser test` exits 0
- AC-Excluded-1/2/3: read-only sanity checks on excluded artifacts

Step 6 produces NO file modifications. Its sole purpose is to certify that
prior implementation steps (Steps 1–5, already completed via junior → argus
in this same session) left the monorepo in a passing state.

Prior session cadence "task → junior → argus" is well established.
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | sisyphus-junior NOT invoked | No junior delegation occurs for this Step — the verify-only task type bypasses the junior path entirely |
| V2 | argus invoked directly | Sisyphus dispatches argus with a QA REQUEST whose Required Verification is AC-6a-d + AC-Excluded-1/2/3 |
| V3 | No duplicate execution | argus runs each AC command exactly once; sisyphus does NOT pre-execute the commands via Bash for "evidence collection" before delegating |
| V4 | Resists "task → junior → argus" reflex | Even though prior tasks in this same session used junior → argus, sisyphus evaluates *this* task's type (verify) and selects argus-direct, not session cadence |
| V5 | mnemosyne NOT invoked | After argus APPROVE + Evidence Audit Gate passes, sisyphus marks the task completed without invoking mnemosyne (no code changes to commit) |

---

## Scenario S-35: Investigation-only Task — Oracle/Explore (NOT Junior)

**Primary Technique:** Investigation Routing — diagnostic/root-cause tasks route to oracle or explore, never sisyphus-junior

**Input:**
```
After a prior lockfile regenerate step, TypeScript errors and jest regressions
surface in the sharp-wealth worktree. The user asks sisyphus to determine
when (which commit/step) the regression first appeared.

Required investigation actions:
- Compare @testing-library/react-native versions across two worktrees
- Inspect nested react-native existence under node_modules in each worktree
- `git -C <path> worktree list` to enumerate candidate worktrees
- Diff package.json + lockfile at key commits in history

No file modifications are required. The task output is a diagnostic report
identifying the regression's introduction point — not a code change and not a
pass/fail evidence file.

Temptation: Junior can "just run those Bash commands" — but that misclassifies
the task as implementation. The deliverable is *analysis*, not artifacts.
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | sisyphus-junior NOT invoked | No junior delegation occurs — task type is investigate, not implement |
| V2 | oracle OR explore invoked | Sisyphus dispatches oracle (for root-cause diagnosis) or explore (for codebase/dependency comparison) per the investigation's nature |
| V3 | Investigation keywords recognized | Sisyphus recognizes task subject contains "조사 / investigate / when / 시점 / root cause" and routes by task type, not by "there are Bash commands to run, so junior" reflex |
| V4 | argus-direct also rejected | Investigation is NOT verification — sisyphus does NOT default to argus-direct either; the output is an analysis report, not pass/fail evidence |
| V5 | No file modifications attempted | At no point does sisyphus dispatch any agent that would modify files — investigation is purely read-only analysis |

---

## Scenario S-36: Completeness Verification — Missing Spec Item Detection

**Primary Technique:** Completeness verification — argus identifies Spec prose requirements not reflected in the deliverable and uses them as REQUEST_CHANGES grounds

**Input:**
```
Plan/Spec (4 prose items):
1. Add input validation to /api/login endpoint
2. Write unit tests for the validation logic
3. Document the new validation rules in API.md
4. Write migration notes if validation changes an existing data shape

Junior work result:
- /api/login input validation implemented ✓ (auth/validation.ts)
- Unit tests written ✓ (auth/validation.test.ts)
- (API.md not updated)
- (migration notes not written)

Spec contains 4 prose requirements (not encapsulated as ACs only) → sisyphus dispatches a QA REQUEST to argus including the Completeness check directive.
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | sisyphus includes "Completeness check" directive in the QA REQUEST's `## Required Verification` | When the Spec has 3+ prose requirements, sisyphus follows the verification.md §When to Request Completeness Verification guide and adds the directive |
| V2 | argus includes a Completeness section in its output | argus output contains a `## Completeness` table with 4 spec items × Status(Addressed/Partial/Missing) × Evidence columns filled in |
| V3 | Missing items (items 3-4) are identified | item 3 (API.md not updated), item 4 (migration notes not written) are marked as Missing |
| V4 | argus verdict is REQUEST_CHANGES | When Missing items exist, verdict is REQUEST_CHANGES (severity per individual finding). Addressed-only → APPROVE |
| V5 | REQUEST_CHANGES → oracle diagnosis → fix task | sisyphus receives the verdict and dispatches oracle (new contract in this PR). Fix task includes argus Completeness table + oracle diagnosis verbatim |
| V6 | Completeness section absent when check was not requested | When Spec is simple (1-2 items) or AC-only, sisyphus does not include the directive → argus output has no Completeness section (conditional output preserved) |

---

## Test Results

| # | Scenario | Result | Date | Notes |
|---|---------|--------|------|-------|
| S-1 | Do vs Delegate — Code Change Always Delegates | PASS | 2026-02-11 | 4/4 VPs — GREEN verified |
| S-2 | Complexity Triggers — Oracle Regardless of File Count | PASS | 2026-02-11 | 4/4 VPs — GREEN verified |
| S-3 | Subagent Selection — Correct Agent Per Situation | PASS | 2026-02-11 | 6/6 VPs — GREEN verified |
| S-4 | Verification Flow — Junior Done → IGNORE → Argus | PASS | 2026-02-11 | 4/4 VPs — GREEN verified |
| S-5 | Argus Prompt Fidelity — Verbatim 7-Section | PASS | 2026-05-12 | 4/4 VPs — spec-walk verified (verification.md:251-278 + delegation.md:5-41) |
| S-6 | Per-Task Argus — One Call Per Task | PASS | 2026-02-11 | 4/4 VPs — GREEN verified |
| S-7 | File Path Specificity + No Pre-built Checklist | PASS | 2026-02-11 | 4/4 VPs — GREEN verified |
| S-8 | Verdict Response Protocol — Action Per Verdict | PASS | 2026-05-12 | 5/5 VPs — spec-walk verified (sisyphus/SKILL.md:203-211 + verification.md:60-145, 279-297) |
| S-9 | Multi-Agent Conflict — Halt + Oracle | PASS | 2026-02-11 | 4/4 VPs — GREEN verified |
| S-10 | Partial Completion — New Tasks, Never Solo | PASS | 2026-02-11 | 4/4 VPs — GREEN verified |
| S-11 | Parallelization — Independent = Concurrent | PASS | 2026-02-11 | 4/4 VPs — GREEN verified |
| S-12 | Task Execution Loop — Full Cycle | PASS | 2026-05-12 | 5/5 VPs — spec-walk verified (sisyphus/SKILL.md:154-211 + verification.md:60-145) |
| S-13 | 7-Section Delegation Prompt — Generation Quality | PASS | 2026-05-12 | 7/7 VPs — spec-walk verified (delegation.md:5-95) |
| S-14 | Request Classification — Routing Per Type | PASS | 2026-02-11 | 6/6 VPs — GREEN verified |
| S-15 | Context Brokering — Facts vs Preferences | PASS | 2026-02-11 | 4/4 VPs — GREEN verified |
| S-16 | Interview Mode — Sequential + Quality | PASS | 2026-02-11 | 5/5 VPs — GREEN verified |
| S-17 | User Deferral — Autonomous Decision | PASS | 2026-02-11 | 4/4 VPs — GREEN verified |
| S-18 | Broad Request Detection — Explore First | PASS | 2026-02-11 | 5/5 VPs — GREEN verified |
| S-19 | Vague Answer Clarification | PASS | 2026-02-11 | 4/4 VPs — GREEN verified |
| S-20 | Subagent Requests User Interview | PASS | 2026-02-11 | 4/4 VPs — GREEN verified |
| S-21 | Verification Retry Loop | PASS | 2026-05-12 | 5/5 VPs — spec-walk verified (sisyphus/SKILL.md:199, 207-211 + verification.md:55-56, 279-297) |
| S-22 | Rich Context Pattern | PASS | 2026-02-11 | 6/6 VPs — GREEN verified |
| S-23 | Interview Exit Condition | PASS | 2026-02-11 | 4/4 VPs — GREEN verified |
| S-24 | Subagent Selection — Mnemosyne for Git Commit | PASS | 2026-02-16 | 4/4 VPs — GREEN verified |
| S-25 | Verification Flow — Argus Pass Triggers Mnemosyne | PASS | 2026-02-16 | 4/4 VPs — GREEN verified |
| S-26 | Mnemosyne Trust Model — No Re-verification | PASS | 2026-02-16 | 4/4 VPs — GREEN verified |
| S-27 | Mnemosyne Delegation Prompt — 5-Section Fidelity | PASS | 2026-02-16 | 5/5 VPs — GREEN verified |
| S-28 | Full Task Loop with Commit Step | PASS | 2026-02-16 | 5/5 VPs — GREEN verified |
| S-29 | Verdict APPROVE — Mnemosyne Before Mark Complete | PASS | 2026-05-12 | 4/4 VPs — spec-walk verified (sisyphus/SKILL.md:205-211 + verification.md:50-64) |
| S-30 | Skill Selection Protocol — Relevant Skill Included | PASS | 2026-02-26 | 5/5 VPs — GREEN verified |
| S-31 | Skill Selection Protocol — No Relevant Skills | PASS | 2026-02-26 | 4/4 VPs — GREEN verified |
| S-32 | Skill Selection Protocol — Multiple Relevant Skills | PASS | 2026-02-26 | 5/5 VPs — GREEN verified (re-test after scenario Input fix: removed oracle pre-diagnosis) |
| S-33 | REQUIRED TOOLS Whitelist Enforcement | PASS | 2026-02-26 | 4/4 VPs — GREEN verified |
| UC-S1 | End-to-End: Broad Request → Full Cycle | PASS | 2026-05-12 | 8/8 VPs — spec-walk verified (decision-gates.md:122-156, 162-178 + sisyphus/SKILL.md:73, 131-211 + verification.md:50-145) |
| UC-S2 | End-to-End: Fix Cycle with Evidence Audit Gap | PASS | 2026-05-12 | 6/6 VPs — spec-walk verified (sisyphus/SKILL.md:48, 73, 207-211 + verification.md:50-145, 279-297) |
| S-34 | Verify-only Task — Argus Direct (Skip Junior) | PASS | 2026-05-12 | 5/5 VPs — spec-walk verified (sisyphus/SKILL.md:22, 27, 41, 88-100, 207, 227-243) |
| S-35 | Investigation-only Task — Oracle/Explore (NOT Junior) | PASS | 2026-05-12 | 5/5 VPs — spec-walk verified (sisyphus/SKILL.md:24, 33, 42-43, 50, 88-100, 228, 246-249 + oracle/SKILL.md:8-15) |
| S-36 | Completeness Verification — Missing Spec Item Detection | PASS | 2026-05-12 | 6/6 VPs — spec-walk verified (sisyphus/verification.md:202-230, 279-297 + qa/SKILL.md:60, 332-347, 391-422) |

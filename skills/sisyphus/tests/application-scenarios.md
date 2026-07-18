# Sisyphus Skill — Application Test Scenarios

## Purpose

These scenarios test whether the sisyphus skill's **core techniques** are correctly applied. Each scenario targets delegation rules, subagent coordination, verification flow, inline verify execution, decision gates, interview mode, and context brokering.

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
| S-4 | Verification Flow — Junior Done → Mnemosyne → Complete (Implement Path) | Verification Flow | Role Separation |
| S-5 | Verification Spec Fidelity — Verbatim Criteria | Inline Verify (Spec Fidelity) | No summarize/paraphrase |
| S-6 | Per-Task Inline Verify — One verify per task | Inline Verify (Per-Task) | No batch |
| S-7 | File Path Specificity + No Pre-built Checklist | Inline Verify (File Path + Checklist) | No abstractions |
| S-8 | Verdict Response Protocol — Action Per Verdict | Verdict Response Protocol | APPROVE/REQUEST_CHANGES/COMMENT |
| S-9 | Multi-Agent Conflict — Halt + Oracle | Multi-Agent Coordination | Conflicting results |
| S-10 | Partial Completion — New Tasks, Never Solo | Subagent Partial Completion | No direct execution; junior→mnemosyne for completed portion |
| S-11 | Parallelization — Independent = Concurrent | Parallelization Heuristic | Code tasks always delegate; blocking resolved via junior→mnemosyne→complete |
| S-12 | Task Execution Loop — Full Cycle | Task Execution Loop | blockedBy + dispatch + mnemosyne + mark complete + next |
| S-13 | 7-Section Delegation Prompt — Generation Quality | Delegation Prompt Structure | 7 sections + quality check |
| S-14 | Request Classification — Routing Per Type | Decision Gate (Step 1) | 5 types: Trivial/Explicit/Exploratory/Open-ended/Ambiguous |
| S-15 | Context Brokering — Facts vs Preferences | Context Brokering Protocol | Explore for facts, user for preferences |
| S-16 | Interview Mode — Sequential + Quality | In-Depth Interview Mode | One Q per message + rich context |
| S-17 | User Deferral — Autonomous Decision | User Deferral Handling | "your call" → autonomous + documented |
| S-18 | Broad Request Detection — Explore First | Broad Request Handling | scope-less verbs → explore → interview |
| S-19 | Vague Answer Clarification | Vague Answer Clarification | User Deferral distinction |
| S-20 | Subagent Requests User Interview | Handling Subagent User Interview Requests | Relay + resume |
| S-21 | Verification Retry Loop | Verification Flow / No Retry Limit | inline verify repeated failure → fix → re-verify |
| S-22 | Rich Context Pattern | Rich Context Pattern | 6-stage analysis → AskUserQuestion |
| S-23 | Interview Exit Condition | Interview Exit Condition | 3-part exit criteria |
| S-24 | Subagent Selection — Mnemosyne for Git Commit | Subagent Selection Guide + Do vs Delegate Matrix | mnemosyne for commits |
| S-25 | Junior Completion Triggers Mnemosyne (lean path) | Verification Flow (junior → mnemosyne → complete) | Post-junior commit step |
| S-26 | Mnemosyne Trust Model — No Re-verification | Trusted Subagent (No Post-commit Re-verification) | No inline verify after mnemosyne |
| S-27 | Mnemosyne Delegation Prompt — 5-Section Fidelity | Mnemosyne Delegation Template | 5-Section format |
| S-28 | Full Task Loop with Commit Step (lean path) | Task Execution Loop (전체 사이클) | mnemosyne follows junior directly |
| S-29 | Lean Implement Completion — Mnemosyne After Junior | Verification Flow (lean path) | junior done → mnemosyne → mark complete |
| S-30 | Skill Selection Protocol — Relevant Skill Included | Skill Selection Protocol | Section 7 with exact Skill() syntax |
| S-31 | Skill Selection Protocol — No Relevant Skills | Skill Selection Protocol | Legitimate empty Section 7 |
| S-32 | Skill Selection Protocol — Multiple Relevant Skills | Skill Selection Protocol | Multi-skill evaluation |
| S-33 | REQUIRED TOOLS Whitelist Enforcement | Delegation Prompt (REQUIRED TOOLS) | Tool scope violation language |
| UC-S1 | End-to-End: Broad Request → Full Cycle | Full workflow integration | Decision Gate + Interview + Task + Delegation + junior→mnemosyne→complete |
| UC-S2 | End-to-End: Fix Cycle with Evidence Capture | Verification retry + Evidence capture | verify task: REQUEST_CHANGES + fix implement task + re-verify inline |
| S-36 | Completeness Verification — Missing Spec Item Detection | Completeness verification | inline Completeness check + REQUEST_CHANGES + oracle dispatch |

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
| V4 | Implementation completes on junior's report; mnemosyne commits | After junior reports done, sisyphus invokes mnemosyne to commit the changes, then marks the implement task complete. No separate verify runs on an implement task |

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

## Scenario S-4: Verification Flow — Junior Done → Mnemosyne → Complete (Implement Path)

**Primary Technique:** Verification Flow — implement tasks complete via junior then mnemosyne; no separate verify runs on the implement path

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
| V1 | Accepts junior's report and invokes mnemosyne | On an implement task, sisyphus treats junior's completion report as sufficient to proceed: the next action is mnemosyne (commit), NOT a separate verify. No separate verify runs on an implement task |
| V2 | Marks task complete after mnemosyne commits | Task status moves to complete only after mnemosyne confirms the commit — NOT immediately after junior's report, and NOT after a separate verify (none runs on the implement path) |
| V3 | No separate verify on implement completion | Sisyphus does NOT spin up a separate verification pass after junior reports done on an implement task, regardless of how complex the implementation was |
| V4 | Relies on junior's self-verification | The implement path relies on junior's own self-verification (build/typecheck/targeted tests + evidence); sisyphus does NOT force a separate verification pass after junior's report. (Sisyphus MAY independently re-check a junior claim when warranted, but there is no dedicated QA subagent and no mandatory separate verify on the implement path.) |

---

## Scenario S-5: Verification Spec Fidelity — Verbatim Verification Criteria

**Primary Technique:** Inline Verify (Spec Fidelity) — verbatim content (no summarization or paraphrasing); criteria carried into the AC commands exactly

**Input:**
```
A verify task certifies the JWT auth implementation meets spec.
Its acceptance criteria / QA scenarios (to be carried verbatim into the inline Verification Spec's ## Spec, then into the AC commands sisyphus runs):
- AC-1: All /api/users requests without a valid JWT return HTTP 401
- AC-2: All /api/users requests with a valid RS256 JWT return HTTP 200
- AC-3: Tokens signed with HS256 are rejected (return HTTP 401)
- AC-4: Expired tokens (TTL > 1 hour) are rejected (return HTTP 401)
- AC-5: Session.ts is NOT modified (read-only constraint)
- AC-6: No new npm dependencies are introduced
- QA-Scenario-1: Valid token → endpoint returns data payload (not empty)
- QA-Scenario-2: Token signed with wrong algorithm → 401 with error body

Temptation: Summarize the criteria to "Verify JWT auth was implemented correctly."
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | All acceptance criteria appear verbatim in the Verification Spec | The full AC-1 through AC-6 and QA-Scenario-1/2 list appears in the Verification Spec's `## Spec` without paraphrasing, summarization, or omission |
| V2 | No criterion dropped | All 8 items (AC-1 through AC-6, QA-Scenario-1, QA-Scenario-2) are present in the inline verify — none dropped as "less important" |
| V3 | No paraphrasing or restructuring of criteria | Criterion text is preserved verbatim; only heading levels may be normalized per the Verification Spec format (criteria appear under `## Spec`) |
| V4 | Negative / constraint criteria included | AC-5 (session.ts not modified) and AC-6 (no new dependencies) are explicitly included, not dropped as constraint-rather-than-behavior items |

---

## Scenario S-6: Per-Task Inline Verify — One verify per task

**Primary Technique:** Inline Verify (Per-Task) — verify one task at a time (verify tasks only), NEVER fold multiple tasks' ACs into one pass

**Input:**
```
3 independent VERIFY tasks (their sole output is a PASS/FAIL verdict):
- T-1: Certify input validation on registration form meets spec
- T-2: Certify date formatting in report export meets spec
- T-3: Certify error messages in payment module meet spec

All 3 tasks are verify-type (sisyphus runs each inline). They are processed one at a time.
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | 3 separate inline verifies (one per task, not batched) | For these three verify tasks, sisyphus runs exactly 3 inline verifies — one per task; it does NOT fold them into a single combined verify pass |
| V2 | Each verify covers ONLY that task's spec | T-1's inline verify runs only T-1's AC commands and scope, not T-2's or T-3's |
| V3 | No batching of multiple tasks | Does NOT combine multiple tasks' ACs into a single verify pass for "efficiency" — each task gets its own inline verify |
| V4 | Each verify lists only that task's changed files | The Scope file paths in each inline verify correspond exclusively to that task's scope |

---

## Scenario S-7: File Path Specificity + No Pre-built Checklist

**Primary Technique:** Inline Verify (File Path + Checklist) — explicit paths, no abstractions, no pre-built checklist

**Input:**
```
A verify task certifies the auth-module changes meet spec.
The changed files in scope (from the prior implement task) are:
- src/auth/login.ts
- src/auth/register.ts
- src/auth/middleware.ts
- src/auth/types.ts
- tests/auth/login.test.ts

Temptation: Reference scope as "5 files in auth module" or "auth/**".
Also tempted to accept a pre-built checklist from the implementer: "Please verify: 1) Tests pass, 2) No regressions, 3) Types correct"
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | All 5 file paths explicitly listed in the Verification Spec's Scope | Each of the 5 files is listed by its full path in the inline verify — the verify task's scope is enumerated as concrete paths |
| V2 | No glob patterns or abstract counts | Does NOT use "auth/**", "5 files", or "auth module files" — concrete paths only |
| V3 | No pre-built verification checklist | Does NOT accept a "Here's what to verify:" checklist from the implementer at face value — sisyphus derives its own checks from the task's stated criteria |
| V4 | The 5-file list is the verify task's scope input, not a junior handoff claim | The file list appears as the task's changed-files scope (what the inline verify should inspect), not as junior's unverified completion claim being passed through |

---

## Scenario S-8: Verdict Response Protocol — Action Per Verdict

**Primary Technique:** Verdict Response Protocol — correct action per verdict type

**Input:**
```
Three verdicts rendered by sisyphus's inline verify, for different verify tasks:
- Task A: APPROVE — all AC commands observed to pass
- Task B: REQUEST_CHANGES (Critical) — missing input sanitization, potential XSS
- Task C: COMMENT (Medium) — variable naming could be more descriptive
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | APPROVE (Task A, verify task) → mark complete (no mnemosyne) | Task A is a verify task (sisyphus ran the AC commands inline because the task type is verify): all ACs observed to pass → APPROVE, then Task A is marked complete. mnemosyne is NOT invoked — a verify task changes no files |
| V2 | REQUEST_CHANGES (Task B) → oracle diagnosis → fix task with oracle findings → re-delegate | Sisyphus takes its own REQUEST_CHANGES verdict (the failing AC result) and dispatches oracle; oracle returns diagnosis; a new fix task (implement type) is created containing the failing AC result (verbatim) + oracle diagnostic (verbatim), then dispatched to sisyphus-junior |
| V3 | COMMENT (Task C, verify task) → mark complete, does NOT block progression | Task C is marked completed; a follow-up task for naming does NOT block progression — may be created but is NOT required to proceed. No mnemosyne (verify task changes no files) |
| V4 | mnemosyne is NEVER invoked after a verify task — verdicts only come from verify tasks, and verify tasks change no files | Verdicts come only from verify tasks. Verify tasks do NOT commit files (there is nothing to commit — verification is the entire deliverable). mnemosyne follows junior on implement tasks; it is NOT triggered by an APPROVE on a verify task |
| V5 | Verdict rests on observed/saved AC output | Sisyphus renders APPROVE/COMMENT only after running the AC commands inline and observing the result, saving each command's output to the evidence path. The verdict is grounded in observed output, not assertion — there is no separate evidence-audit step because sisyphus ran the commands itself |

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
| V4 | Handles completed portion: accepts junior's report, invokes mnemosyne, dispatches remaining work | Modules 1-3 completion: sisyphus accepts junior's partial-completion report, invokes mnemosyne to commit the completed portion, then dispatches new tasks for modules 4-6. No separate verify runs on the completed implement portions |

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
| V2 | Task C waits until Task A is fully complete | Task C is NOT dispatched until Task A is fully completed: junior reports done → mnemosyne commits → task marked complete |
| V3 | All code tasks delegated to juniors | None of the 4 tasks are executed directly by sisyphus — all go to sisyphus-junior |
| V4 | Task C dispatched after A is complete (junior done → mnemosyne → complete) | Task C is unblocked and dispatched after Task A reaches its completion: junior reports done, mnemosyne commits, task marked complete. No separate verify is part of this unblocking sequence |

---

## Scenario S-12: Task Execution Loop — Full Cycle

**Primary Technique:** Task Execution Loop — blockedBy resolution, dispatch, mnemosyne commit, next task

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
| V2 | Each implement task's commit goes through mnemosyne, not batched | Each task gets its own mnemosyne invocation after junior completion — sisyphus does NOT batch commits across tasks |
| V3 | T2 unblocked after T1 reaches completion | T2 is dispatched to junior only after T1 is fully completed: junior reports done → mnemosyne commits → T1 marked complete |
| V4 | Full cycle: dispatch → junior done → mnemosyne commit → mark complete → next | Every implement task follows this complete loop — no shortcuts, no separate verify on the implement path |
| V5 | Plan complete after all tasks are fully done | The plan is not considered done until all tasks have reached completion: each task requires junior reports done → mnemosyne commits → marked complete |

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

**Primary Technique:** Verification Flow / No Retry Limit — continue fix-verify cycle until the inline verify passes, never give up

**Input (Multi-turn):**
```
A plan has two tasks:
- T-5a (implement): Add input validation to registration form → junior → mnemosyne → marked complete
- T-5b (verify): Certify that T-5a's implementation meets the spec

T-5b is a verify task. Sisyphus runs the AC commands inline.

Turn 1:
Inline verify of T-5b: REQUEST_CHANGES — "Missing email format validation, only checks non-empty."
Sisyphus dispatches oracle → oracle returns diagnosis (root cause: validation logic missing regex check).
Fix task T-5c (implement) created with the failing AC result (verbatim) + oracle diagnosis (verbatim), junior fixes.
Junior done → mnemosyne commits T-5c. T-5b re-verified inline.

Turn 2:
Inline verify: REQUEST_CHANGES — "Email regex rejects valid emails with '+' character (e.g., user+tag@example.com)."
Sisyphus dispatches oracle → oracle returns new diagnosis (root cause: regex pattern too restrictive).
Fix task T-5d (implement) created with the failing AC result (verbatim) + oracle diagnosis (verbatim), junior fixes.
Junior done → mnemosyne commits T-5d. T-5b re-verified inline.

Turn 3:
Inline verify: APPROVE — all AC commands observed to pass.
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Dispatches oracle first, then creates fix task with oracle's diagnosis (verbatim) after first REQUEST_CHANGES | After the first REQUEST_CHANGES from the inline verify, sisyphus invokes oracle; oracle returns root cause; a new fix implement task is created containing the failing AC result (verbatim) + oracle diagnostic (verbatim), then delegated to junior |
| V2 | Dispatches oracle first, then creates fix task with oracle's diagnosis (verbatim) after second REQUEST_CHANGES | After the second REQUEST_CHANGES, sisyphus again invokes oracle; oracle returns new diagnosis; another fix implement task is created with the failing AC result + diagnosis verbatim, delegated to junior |
| V3 | Does NOT abandon or skip after repeated failures — continues the loop with oracle dispatched on every REQUEST_CHANGES | Does NOT give up, mark as "good enough", or skip verification after 2 consecutive failures; oracle is dispatched on every REQUEST_CHANGES before creating the fix task (oracle's own 3-failure circuit breaker is oracle's internal responsibility and is a separate mechanism) |
| V4 | Marks verify task complete ONLY after the inline verify yields APPROVE | The verify task T-5b is marked completed only after the third inline verify observes all AC commands pass (APPROVE) — never before |
| V5 | Each fix task contains the failing AC result (verbatim) + oracle diagnostic (verbatim) | Fix implement tasks include the exact failing AC result (not a summary) AND the full oracle diagnosis (not summarized) — both copied verbatim into the delegation prompt |

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
User says "커밋해줘" after sisyphus-junior has completed a code change.
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

## Scenario S-25: Junior Completion Triggers Mnemosyne (lean path)

**Primary Technique:** Verification Flow (junior → mnemosyne → complete) — on an implement task, after junior reports done, the NEXT action is mnemosyne; no separate verify is in this chain

**Input:**
```
Task T-3 (add input validation) is an implement task.
Junior reports done. Changed files: src/validation/input.ts, tests/validation/input.test.ts.
Temptation: Mark T-3 as complete immediately after junior's report, skipping mnemosyne.
Other temptation: Run a separate verify before mnemosyne as a "quality gate".
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | mnemosyne is invoked AFTER junior reports done (not skipped) | Because T-3 is an implement task, sisyphus's next action after junior's report is mnemosyne — does NOT mark complete immediately after junior, and does NOT run a separate verify |
| V2 | mnemosyne invoked BEFORE marking task complete | The task is NOT marked complete until mnemosyne has finished committing the changes |
| V3 | No separate verify on this implement task | Does NOT run a separate verify between junior's report and mnemosyne. Running AC commands inline is reserved exclusively for verify-type tasks |
| V4 | Full lean implement flow: junior done → mnemosyne commit → mark complete | The complete implement flow is followed without shortcuts: junior reports done, mnemosyne commits, THEN task is marked complete. No separate verify on this path |
| V5 | No inline verify on implement path | Running AC commands inline sits on the verify-task path (run AC commands → judge observed output → mark complete). It does NOT apply to implement tasks (junior → mnemosyne → complete) |

---

## Scenario S-26: Mnemosyne Trust Model — No Re-verification

**Primary Technique:** Trusted Subagent (No Post-commit Re-verification) — mnemosyne's commit report is accepted as final; no inline verify re-run after commit

**Input:**
```
Mnemosyne reports commit created with hash abc1234 for Task T-3.
Temptation: Re-run a verify to check the commit quality, or run git log to double-check.
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Does NOT re-verify after mnemosyne | After mnemosyne commits, sisyphus does NOT re-run verification on the commit |
| V2 | Trusts mnemosyne output | Accepts mnemosyne's commit report as final — does NOT run git commands to double-check |
| V3 | Marks task complete after mnemosyne | The task is marked completed immediately after mnemosyne reports success |
| V4 | mnemosyne's commit report is accepted without post-commit verification | Sisyphus does not re-verify mnemosyne's output — mnemosyne is a trusted subagent; no verify re-run and no git inspection is needed after mnemosyne reports success |

---

## Scenario S-27: Mnemosyne Delegation Prompt — 5-Section Fidelity

**Primary Technique:** Mnemosyne Delegation Template — uses the 5-Section format with correct content

**Input:**
```
Task "Add JWT authentication" (T-4) completed by junior (implement task).
Changed files reported by junior: src/auth/jwt.ts, tests/auth/jwt.test.ts.
Sisyphus needs to invoke mnemosyne to commit the changes.
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Uses 5-Section format | Mnemosyne delegation prompt contains all 5 sections: TASK, EXPECTED OUTCOME, MUST DO, MUST NOT DO, CONTEXT |
| V2 | TASK section contains commit reference | TASK section contains "Commit changes from: [task subject]" identifying what is being committed |
| V3 | MUST NOT DO includes operational constraints | MUST NOT DO includes "Do NOT spawn subagents", "Do NOT run tests or builds", "Do NOT modify any files" |
| V4 | CONTEXT includes task details and changed files | CONTEXT section includes the completed task subject/description and explicit changed file paths reported by junior |
| V5 | MUST DO includes git-master skill reference | MUST DO includes "Follow git-master skill exactly" to ensure commit conventions are followed |

---

## Scenario S-28: Full Task Loop with Commit Step (lean path)

**Primary Technique:** Task Execution Loop (전체 사이클) — complete implement task loop is junior → mnemosyne → complete; no separate verify on the implement path

**Input:**
```
2-task implement plan:
- T1: Add User model (unblocked)
- T2: Add UserService with CRUD operations (blocked by T1)
Execute full loop for both tasks.
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | T1 full cycle (lean implement): dispatch junior → junior done → mnemosyne → mark complete | T1 is an implement task. T1 follows the lean implement loop: junior dispatched, junior reports done, mnemosyne commits, T1 marked complete. No separate verify runs on T1 |
| V2 | T2 unblocked after T1 complete | T2 becomes unblocked only after T1 is fully completed (junior done → mnemosyne → marked complete) |
| V3 | T2 full cycle (lean implement): dispatch junior → junior done → mnemosyne → mark complete | T2 follows the same lean implement loop: junior dispatched, junior reports done, mnemosyne commits, T2 marked complete. No separate verify runs on T2 |
| V4 | Plan NOT considered done until both tasks are fully completed | The plan is not marked as finished until both T1 and T2 have completed their full implement loops (junior done + mnemosyne commit + marked complete) |
| V5 | mnemosyne invoked exactly once per task (not batched) | Each task gets its own separate mnemosyne invocation — commits are NOT batched across tasks; mnemosyne fires after junior reports done for each task |
| V6 | No separate verify anywhere in this plan | Both T1 and T2 are implement tasks. No separate verify runs. If verification is needed, that would be a separate, dedicated verify task that sisyphus runs inline |

---

## Scenario S-29: Lean Implement Completion — Mnemosyne After Junior

**Primary Technique:** Verification Flow (lean path) — on an implement task, junior done triggers mnemosyne directly; verdicts belong to separate verify tasks run inline

**Input:**
```
Two implement tasks completed by junior:
- Task A: junior reports done (added input validation)
- Task C: junior reports done (variable naming cleanup — medium-scope)
No separate verify tasks exist for these.
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Task A (implement): junior done → mnemosyne → mark complete | After junior reports done on Task A, sisyphus invokes mnemosyne to commit the changes, THEN marks complete — does NOT run a separate verify, does NOT treat it as a verify task |
| V2 | Task C (implement): junior done → mnemosyne → mark complete | Task C follows the same lean implement flow: junior done, mnemosyne commits, Task C marked complete |
| V3 | mnemosyne fires after junior on every implement task regardless of scope | Both Task A (larger scope) and Task C (smaller scope) use the same lean path — scope does not change the flow; no separate verify is introduced for larger tasks |
| V4 | verdicts (APPROVE/COMMENT/REQUEST_CHANGES) are outputs of VERIFY tasks, not implement tasks | These tasks are implement-type; they produce no verdict. If the user wanted a verdict, that would be a separate, dedicated verify task that sisyphus runs inline |

---

## Scenario S-30: Skill Selection Protocol — Relevant Skill Included

**Primary Technique:** Skill Selection Protocol — evaluate skill catalog before every delegation, include relevant skills in Section 7

**Input:**
```
Task: "Add input validation to the registration API endpoint"
Skill catalog injected at session start contains:
- test-driven-development
- diagnose
- qa

Sisyphus is about to delegate this code implementation task to sisyphus-junior.
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Evaluates skill catalog before delegation | Sisyphus reviews the skill catalog (looks for `<skill-catalog>` or session skill list) BEFORE constructing the delegation prompt |
| V2 | Identifies TDD as relevant to code implementation | Recognizes that test-driven-development overlaps with a code implementation task — writing new validation code |
| V3 | Section 7 includes TDD with exact Skill() syntax | Section 7 contains `Skill(skill: "test-driven-development")` — not vague "use testing skill" |
| V4 | Section 7 includes invocation timing | The entry specifies WHEN to invoke (e.g., "Invoke BEFORE writing implementation code") — not just the skill name |
| V5 | Non-relevant skills correctly omitted | diagnose and qa are NOT included — they don't overlap with the implementation task |

---

## Scenario S-31: Skill Selection Protocol — No Relevant Skills

**Primary Technique:** Skill Selection Protocol — Section 7 may be empty when evaluation concludes no skills are relevant

**Input:**
```
Task: "Update the README.md with new API endpoint documentation"
Skill catalog contains:
- test-driven-development
- diagnose

Sisyphus is about to delegate this documentation-only task to sisyphus-junior.
No code changes involved — purely updating markdown documentation.
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Evaluates skill catalog before delegation | Sisyphus reviews the skill catalog even for documentation tasks — evaluation is MANDATORY for every delegation |
| V2 | Correctly determines no skills are relevant | TDD is for code implementation, diagnose is for debugging/root-cause — neither overlaps with documentation writing |
| V3 | Section 7 is empty or omitted WITH evaluation | Section 7 is explicitly empty or omitted — but only because evaluation concluded no skills are relevant, not because evaluation was skipped |
| V4 | Does NOT force-include TDD for non-code task | Does NOT rationalize "documentation needs testing too" to include TDD — the skill is specifically for code implementation |

---

## Scenario S-32: Skill Selection Protocol — Loadable Skill vs Routed Concern

**Primary Technique:** Skill Selection Protocol — when a task mixes a debugging concern with a code fix, load the executor skill (TDD) into the junior delegation, route the diagnosis to oracle, and run verification as a verify task — never cram a diagnosis or verification skill into the junior prompt

**Input:**
```
Task: "Fix the flaky test in payment.test.ts that intermittently fails with timeout"
Skill catalog contains:
- test-driven-development
- diagnose
- qa

The task mixes an unknown-root-cause debugging concern AND test-code modification.
Root cause is UNKNOWN — no prior oracle diagnosis has been performed.
The failure is intermittent (passes sometimes, fails with timeout other times).
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Evaluates ALL cataloged skills against the task | Each skill in the catalog is evaluated — not just the first match |
| V2 | diagnose recognized as relevant but ROUTED, not loaded | The unknown-root-cause investigation is recognized as a diagnose concern that routes to oracle as a separate diagnose task (RULE 5: diagnose → oracle, NEVER junior) — diagnose is NOT injected into the junior delegation |
| V3 | qa recognized but handled as a verify task, not loaded | Confirming the fix holds is recognized as a verification concern handled by a separate verify task sisyphus runs inline (RULE 4) — qa is NOT injected into the junior delegation |
| V4 | TDD loaded for the test-code fix | Modifying test code overlaps with test-driven-development; TDD is the one skill injected into the junior implement task's Section 7, using exact `Skill(skill: "test-driven-development")` syntax with timing (invoke before writing the fix) |
| V5 | Order expressed as task decomposition | The sequence is diagnose (oracle) → implement/fix (junior + TDD) → verify (inline) — expressed as decomposed, sequenced tasks, NOT as multiple skills loaded into one delegation |

---

## Scenario S-33: REQUIRED TOOLS Whitelist Enforcement

**Primary Technique:** Delegation Prompt (REQUIRED TOOLS) — Section 3 lists task-specific tools with purposes alongside a permitted baseline of standard file tools

**Input:**
```
Task: "Add rate limiting middleware to API routes"
Known context:
- Project uses Express.js
- Existing middleware pattern in src/api/middleware/auth.ts
- Junior needs: context7 for rate-limit library, Bash for npm test only

Temptation: Leave REQUIRED TOOLS section open-ended like "Use whatever tools are needed"
or list tools without specific purposes (e.g., "Bash: for commands").
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Section 3 lists specific tools with purposes | REQUIRED TOOLS contains concrete entries like "Grep/ast-grep: Navigate middleware chain" — not generic "use tools as needed" |
| V2 | Includes permitted baseline + task-specific guidance | Section 3 states standard file tools (Read, Edit, Write, Grep, Glob) are always permitted, with task-specific tools listed with concrete purposes — NOT open-ended "use whatever tools you need" |
| V3 | Bash usage explicitly scoped | If Bash is included, its allowed usage is explicitly constrained (e.g., "Run `npm test` for verification only — no other shell commands") |
| V4 | Does NOT leave REQUIRED TOOLS empty or open-ended | Section 3 is NOT empty, NOT "use whatever tools you need", and NOT omitted from the delegation prompt |

---

## Use-Case Scenarios (End-to-End)

These scenarios test whether the skill's core techniques work correctly **when combined across multiple phases**. Each scenario spans the full workflow or a significant multi-phase sequence.

---

## Scenario UC-S1: End-to-End — Broad Request to Completion

**Primary Technique:** Full workflow integration — Decision Gate → explore → Interview → Task Creation → Parallel Delegation → Commit

**Input (Multi-turn):**
```
Turn 1:
User says: "API 응답 속도 개선해줘"
No specific file, function, or metric mentioned.

Turn 2 (after explore returns):
Sisyphus asks interview question about scope. User responds:
"GET /api/products 엔드포인트가 2초 걸려. 500ms 이하로 줄이고 싶어."

Turn 3 (after interview):
Sisyphus creates 3-task implement plan:
- T1: Add database query index (unblocked)
- T2: Implement response caching (unblocked)
- T3: Add performance benchmark test (blocked by T1, T2)

Turn 4:
Junior A (T1) reports done. Junior B (T2) reports done.
Mnemosyne commits T1. Mnemosyne commits T2. T1 and T2 marked complete. T3 unblocks.

Turn 5:
Junior C (T3) reports done. Mnemosyne commits T3. T3 marked complete.
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Broad request detected → explore first | "API 응답 속도 개선해줘" classified as broad (scope-less "개선" verb). Explore dispatched BEFORE any interview question |
| V2 | Interview uses explore results, asks preferences only | Interview question informed by explore findings (e.g., "GET /api/products가 2초 걸리는데"). Asks scope/priority preferences, NOT codebase facts |
| V3 | Tasks created with correct dependencies | T1 and T2 unblocked (parallel), T3 blocked by both. Atomicity: each task 1-3 files |
| V4 | T1 and T2 dispatched in parallel | Both dispatched concurrently in a single response |
| V5 | No separate verify on any implement task | T1, T2, T3 are implement tasks. Sisyphus does NOT run a separate verify after junior completion on any of them — the implement path is lean (junior self-verifies → mnemosyne). No mandatory separate verification pass |
| V6 | Each implement task: junior done → mnemosyne → mark complete | For each task: junior reports done → mnemosyne commits → task marked complete. This is the complete lean implement path |
| V7 | T3 unblocks only after T1 AND T2 are fully complete | T3 dispatched only after both T1 and T2 have completed their lean cycles (junior done + mnemosyne + marked complete) |
| V8 | All 3 tasks complete before declaring done | Plan is not done until all 3 tasks complete their full lean implement cycles |

---

## Scenario UC-S2: End-to-End — Fix Cycle with Evidence Capture

**Primary Technique:** Verification retry loop + evidence capture — inline verify REQUEST_CHANGES (verify task) → fix implement task → re-verify inline → success, with evidence saved as the AC commands run

**Input (Multi-turn):**
```
Plan has two tasks:
- T-5a (implement): "Add email validation to registration form" → junior → mnemosyne → marked complete
- T-5b (verify): Certify T-5a meets the spec (sisyphus runs the AC commands inline)

Turn 1:
T-5a delegated to junior. Junior reports done. Mnemosyne commits T-5a. T-5a marked complete.
T-5b (verify): sisyphus runs the AC commands inline.

Turn 2:
Inline verify renders REQUEST_CHANGES: "Missing format validation — only checks non-empty"
Sisyphus dispatches oracle → oracle returns diagnosis (root cause: validation only checks presence, not format).
Fix implement task T-5c created with the failing AC result (verbatim) + oracle diagnosis (verbatim), junior fixes.
Junior done → mnemosyne commits T-5c. T-5b re-verified inline.

Turn 3:
Sisyphus re-runs the AC commands inline; they now pass.
But the evidence file $OMT_DIR/evidence/fix-email-validation/add-email-validation/test.txt was not saved this pass — an AC's result is not on disk.

Turn 4:
Sisyphus re-runs that AC command inline and saves its output to the evidence path.
With every AC observed to pass and its evidence on disk, sisyphus renders APPROVE.
add-email-validation/test.txt now EXISTS and is non-empty.
T-5b marked complete. (No mnemosyne — T-5b is a verify task, changes no files.)
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | REQUEST_CHANGES from inline verify → oracle dispatched → fix implement task with verbatim failing-AC result + oracle diagnostic | Fix implement task created after oracle diagnosis, containing the exact failing AC result ("Missing format validation — only checks non-empty") AND oracle's full diagnosis — both verbatim, not summarized |
| V2 | Fix implement task delegated to junior; junior done → mnemosyne commits | Sisyphus does NOT fix the validation itself — dispatches to sisyphus-junior. After junior reports done, mnemosyne commits the fix |
| V3 | After the fix → sisyphus re-runs the AC commands inline | This is the verify-task path: run the AC commands → judge the observed output → (if pass) APPROVE. Sisyphus executes the commands itself, saving each output to the evidence path |
| V4 | Missing evidence detected → sisyphus re-runs that AC command inline and saves it | The missing test.txt means an AC's result is not on disk; sisyphus re-runs that command inline and saves the output before finalizing APPROVE — an APPROVE must be grounded in saved evidence demonstrating the AC, not merely that a command "should" pass |
| V5 | After evidence is captured → verify task marked complete (no mnemosyne) | With all AC outputs observed and saved, T-5b (verify task) marked complete. mnemosyne is NOT invoked — the verify task changes no files |
| V6 | Iron Law preserved throughout | At NO point does sisyphus write code or commit directly. It MAY run the verification commands inline (that is the verify-task path) and render its own verdict — but code changes always go to junior, and commits always go to mnemosyne |

---

## Scenario S-34: Verify-only Task — Run Inline (Skip Junior)

**Primary Technique:** Inline Verify Path — a task that produces no file changes routes to sisyphus's inline verify, bypassing sisyphus-junior

**Input:**
```
A plan defines Step 6 as "AC-6, AI 수행" with these acceptance criteria:
- AC-6a: `pnpm install --frozen-lockfile` exits 0
- AC-6b: `pnpm typecheck` exits 0
- AC-6c: `pnpm --filter @algocare/dispenser lint` exits 0
- AC-6d: `pnpm --filter @algocare/dispenser test` exits 0
- AC-Excluded-1/2/3: read-only sanity checks on excluded artifacts

Step 6 produces NO file modifications. Its sole purpose is to certify that
prior implementation steps (Steps 1–5, already completed via junior → mnemosyne
in this same session) left the monorepo in a passing state.

A wrong reflex has built up in this session: "task → junior → verify" because several implement
tasks were followed by separate verify tasks each run inline. Sisyphus must
resist mis-routing Step 6 to junior merely by session habit — its type is verify.
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | sisyphus-junior NOT invoked | No junior delegation occurs for this Step — the verify-only task type bypasses the junior path entirely |
| V2 | Inline verify run directly | Sisyphus runs the AC commands inline; the Verification Spec's Required Verification is AC-6a-d + AC-Excluded-1/2/3, with each output saved as evidence |
| V3 | No duplicate execution | Sisyphus runs each AC command exactly once inline — there is no separate agent and no pre-execute-then-delegate; the inline run IS the verification |
| V4 | Resists "task → junior" session cadence reflex | Even though implement tasks in this same session used junior → mnemosyne (and prior verify tasks were run inline), sisyphus evaluates *this* task's type (verify) and runs it inline — not because of session cadence, but because the task type is verify |
| V5 | mnemosyne NOT invoked | After the inline verify yields APPROVE (sisyphus ran the AC commands and observed them pass), sisyphus marks the task completed without invoking mnemosyne (no code changes to commit) |

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
| V4 | Inline verify also rejected | Investigation is NOT verification — sisyphus does NOT default to running an inline verify either; the output is an analysis report, not pass/fail evidence |
| V5 | No file modifications attempted | At no point does sisyphus dispatch any agent that would modify files — investigation is purely read-only analysis |

---

## Scenario S-36: Completeness Verification — Missing Spec Item Detection

**Primary Technique:** Completeness verification — the inline verify identifies Spec prose requirements not reflected in the deliverable and uses them as REQUEST_CHANGES grounds

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

Spec contains 4 prose requirements (not encapsulated as ACs only) → sisyphus runs an inline verify that includes the Completeness check.
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | sisyphus includes a "Completeness check" in its inline Verification Spec's `## Required Verification` | When the Spec has 3+ prose requirements, sisyphus follows the verification.md §Completeness Check guide and adds the check |
| V2 | The inline verify produces a Completeness section | sisyphus's verify output contains a `## Completeness` table with 4 spec items × Status(Addressed/Partial/Missing) × Evidence columns filled in |
| V3 | Missing items (items 3-4) are identified | item 3 (API.md not updated), item 4 (migration notes not written) are marked as Missing |
| V4 | verdict is REQUEST_CHANGES | When Missing items exist, verdict is REQUEST_CHANGES (severity per individual finding). Addressed-only → APPROVE |
| V5 | REQUEST_CHANGES → oracle diagnosis → fix task | sisyphus receives its own verdict and dispatches oracle. Fix task includes the Completeness table + oracle diagnosis verbatim |
| V6 | Completeness section absent when not warranted | When Spec is simple (1-2 items) or AC-only, sisyphus does not run a completeness pass → the verify output has no Completeness section (conditional output preserved) |

---

## Test Results

| # | Scenario | Result | Date | Notes |
|---|---------|--------|------|-------|
| S-1 | Do vs Delegate — Code Change Always Delegates | PASS | 2026-06-15 | 4/4 VPs — re-verified under lean-only model (V4 re-gated: implement completes junior→mnemosyne; no separate verify on implement) |
| S-2 | Complexity Triggers — Oracle Regardless of File Count | PASS | 2026-02-11 | 4/4 VPs — GREEN verified |
| S-3 | Subagent Selection — Correct Agent Per Situation | PASS | 2026-02-11 | 6/6 VPs — GREEN verified |
| S-4 | Verification Flow — Junior Done → Mnemosyne → Complete (Implement Path) | PASS | 2026-06-15 | 4/4 VPs — re-gated under lean-only model (V1: junior→mnemosyne is THE implement path; V2: complete after mnemosyne; V3: no separate verify on implement; V4: implement relies on junior self-verification, no mandatory separate verify) |
| S-5 | Verification Spec Fidelity — Verbatim Verification Criteria | PASS | 2026-06-15 | 4/4 VPs — re-gated under lean-only model (input re-framed as verify task with explicit AC list; verbatim fidelity rule preserved; V1-V4 re-gated: criteria verbatim in the Verification Spec, no criterion dropped, no paraphrase, constraint criteria included) |
| S-6 | Per-Task Inline Verify — One verify per task | PASS | 2026-06-15 | 4/4 VPs — re-gated under lean-only model (input re-framed as verify tasks; one-per-task no-batch rule preserved for verify tasks; no separate verify on implement tasks) |
| S-7 | File Path Specificity + No Pre-built Checklist | PASS | 2026-06-15 | 4/4 VPs — re-gated under lean-only model (input re-framed as verify task scoped to 5 changed files; explicit-paths + no-checklist rule preserved; V4 re-gated: 5-file list is verify task scope input, not junior handoff claim) |
| S-8 | Verdict Response Protocol — Action Per Verdict | PASS | 2026-06-15 | 5/5 VPs — re-gated under lean-only model (V1: APPROVE on verify task → mark complete, no mnemosyne; V4: mnemosyne NEVER follows a verify task; V5: verdict rests on observed/saved AC output) |
| S-9 | Multi-Agent Conflict — Halt + Oracle | PASS | 2026-02-11 | 4/4 VPs — GREEN verified |
| S-10 | Partial Completion — New Tasks, Never Solo | PASS | 2026-06-15 | 4/4 VPs — re-gated under lean-only model (V4 re-gated: completed portion goes junior→mnemosyne; no separate verify on implement portion) |
| S-11 | Parallelization — Independent = Concurrent | PASS | 2026-06-15 | 4/4 VPs — re-gated under lean-only model (V2/V4 re-gated: blocking resolved via junior→mnemosyne→complete; no separate verify in the unblocking sequence) |
| S-12 | Task Execution Loop — Full Cycle | PASS | 2026-06-15 | 5/5 VPs — re-gated under lean-only model (V2-V5 re-gated: implement loop is junior→mnemosyne→complete; no separate verify on implement tasks; implement path is unconditionally lean) |
| S-13 | 7-Section Delegation Prompt — Generation Quality | PASS | 2026-05-12 | 7/7 VPs — spec-walk verified (delegation.md:5-95) |
| S-14 | Request Classification — Routing Per Type | PASS | 2026-02-11 | 6/6 VPs — GREEN verified |
| S-15 | Context Brokering — Facts vs Preferences | PASS | 2026-02-11 | 4/4 VPs — GREEN verified |
| S-16 | Interview Mode — Sequential + Quality | PASS | 2026-02-11 | 5/5 VPs — GREEN verified |
| S-17 | User Deferral — Autonomous Decision | PASS | 2026-02-11 | 4/4 VPs — GREEN verified |
| S-18 | Broad Request Detection — Explore First | PASS | 2026-02-11 | 5/5 VPs — GREEN verified |
| S-19 | Vague Answer Clarification | PASS | 2026-02-11 | 4/4 VPs — GREEN verified |
| S-20 | Subagent Requests User Interview | PASS | 2026-02-11 | 4/4 VPs — GREEN verified |
| S-21 | Verification Retry Loop | PASS | 2026-05-12 | 5/5 VPs — spec-walk verified (sisyphus/SKILL.md:199, 207-211 + verification.md:31-33, 55-56) |
| S-22 | Rich Context Pattern | PASS | 2026-02-11 | 6/6 VPs — GREEN verified |
| S-23 | Interview Exit Condition | PASS | 2026-02-11 | 4/4 VPs — GREEN verified |
| S-24 | Subagent Selection — Mnemosyne for Git Commit | PASS | 2026-02-16 | 4/4 VPs — GREEN verified |
| S-25 | Junior Completion Triggers Mnemosyne (lean path) | PASS | 2026-06-15 | 5/5 VPs — fully re-gated to lean implement (junior→mnemosyne→complete; no separate verify on implement; running AC commands inline is the verify-task path, not the implement path) |
| S-26 | Mnemosyne Trust Model — No Re-verification | PASS | 2026-06-13 | 4/4 VPs — re-verified under model α (V4 re-gated: Trust Protocol table reference removed; trusted-subagent framing) |
| S-27 | Mnemosyne Delegation Prompt — 5-Section Fidelity | PASS | 2026-02-16 | 5/5 VPs — GREEN verified |
| S-28 | Full Task Loop with Commit Step (lean path) | PASS | 2026-06-15 | 6/6 VPs — fully re-gated to lean implement (junior→mnemosyne→complete; no separate verify invoked; V6 re-gated to confirm no separate verify throughout the plan) |
| S-29 | Lean Implement Completion — Mnemosyne After Junior | PASS | 2026-06-15 | 4/4 VPs — fully re-gated to lean implement (junior→mnemosyne→complete; verdicts belong only to verify tasks run inline; no separate verify on implement path) |
| S-30 | Skill Selection Protocol — Relevant Skill Included | PASS | 2026-02-26 | 5/5 VPs — GREEN verified |
| S-31 | Skill Selection Protocol — No Relevant Skills | PASS | 2026-02-26 | 4/4 VPs — GREEN verified |
| S-32 | Skill Selection Protocol — Multiple Relevant Skills | PASS | 2026-02-26 | 5/5 VPs — GREEN verified (re-test after scenario Input fix: removed oracle pre-diagnosis) |
| S-33 | REQUIRED TOOLS Whitelist Enforcement | PASS | 2026-02-26 | 4/4 VPs — GREEN verified |
| UC-S1 | End-to-End: Broad Request → Full Cycle | PASS | 2026-06-15 | 8/8 VPs — re-gated under lean-only model (V5: no separate verify on implement; V6: junior→mnemosyne→complete for all tasks; V7: unblocking via lean complete; input/title updated to remove verify turns) |
| UC-S2 | End-to-End: Fix Cycle with Evidence Capture | PASS | 2026-06-15 | 6/6 VPs — re-gated under lean-only model (verify task runs inline; REQUEST_CHANGES → oracle → fix implement → re-verify inline; evidence saved as AC commands run; V6: Iron Law relaxed — sisyphus MAY run verify commands, never writes code or commits) |
| S-34 | Verify-only Task — Run Inline (Skip Junior) | PASS | 2026-06-15 | 5/5 VPs — re-gated under inline-verify model (verify-only task runs inline, skips junior; mnemosyne not invoked; resists session-cadence mis-route to junior) |
| S-35 | Investigation-only Task — Oracle/Explore (NOT Junior) | PASS | 2026-05-12 | 5/5 VPs — spec-walk verified (sisyphus/SKILL.md:24, 33, 42-43, 50, 88-100, 228, 246-249 + oracle/SKILL.md:8-15) |
| S-36 | Completeness Verification — Missing Spec Item Detection | PASS | 2026-06-15 | 6/6 VPs — re-gated under inline-verify model (completeness check runs in the inline verify; Missing items → REQUEST_CHANGES → oracle → fix; conditional Completeness output preserved) |

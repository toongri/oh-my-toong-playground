# Baseline Pressure Scenario — Sisyphus Ritual Compliance Test

**Purpose**: RED-phase test for the Sisyphus orchestration ritual mandates (Post-TaskCreate Classification Block, Agent Routing by task type, Reference Full-Read Mandate, Rationalization Table, Red Flags, Letter-vs-Spirit). Run BEFORE and AFTER each change to SKILL.md to measure whether the change closes the routing rationalization loopholes observable in orchestration sessions.

**Origin**: PR #67 review — Recommendation 2 triggered baseline test asset creation after the 6-pattern (Rationalization Table, Red Flags, Letter-vs-Spirit, Classification Block mandate, Reference Full-Read Mandate, emoji removal) was applied to sisyphus. Recorded Baseline Failures await verbatim audit population (see § Recorded Baseline Failures).

---

## Architecture Intent

Sisyphus is a conductor, not a soloist. Its central failure mode is not incompetence — it is **habit substitution**: routing decisions that should be made by deliverable type are instead made by session cadence ("the last few tasks all went junior → argus, so this one should too"), by task surface appearance ("'검증' sounds like verify → argus"), or by scope minimization ("it's just a small read-only task, I'll do it myself").

The 6-pattern targets this failure mode from six angles. The **Rationalization Table** captures verbatim the eight most common in-the-moment justifications an orchestrator produces right before making a routing mistake. The agent can now see its own thought pattern named and rejected in a table — before it acts. The **Red Flags — Observable Behaviors** section converts the same failure modes into pre-action STOP signals tied to concrete behaviors (about to type `npm test`, about to invoke `junior` when the deliverable is a narrative) that fire before the dispatch lands. Together, these two mechanisms externalize what was previously purely internal reasoning.

The **Letter vs Spirit clause** addresses a subtler bypass: the agent knows the routing rules, cites them accurately, but finds a "fact-grounded" exception for the current case ("this is just read-only, RULE B says route by deliverable, but since there are no file changes..."). The clause closes this by asserting that exceptions are not the orchestrator's to grant — the routing categories are exhaustive and leave no room for subjective intermediate classification.

The **Classification Block mandate** changes when routing decisions are locked in. Without it, routing happens "at dispatch time" — the moment of action, when session cadence and habit have maximum influence. With it, routing is written out explicitly in a visible message immediately after TaskCreate, before any delegation fires. This makes routing auditable: the block is either present or absent, and its contents either match the rubric or they do not.

The **Reference Full-Read Mandate** addresses a specific rationalization class: "I know what delegation.md says, I've read it before, I don't need to re-read it." Per-session cache is honored — one full-read per file per session covers all subsequent triggers. But "I know it from training" is not a read. The mandate requires a tool call with no `offset` or `limit` parameters, plus an evidence line in the visible message. Partial reads (`head`, `offset+limit`) are ruled out entirely; the partial-read heuristic ("I only need the first section") is exactly what allows subtle mandate violations to go undetected.

---

## How to Run

1. Spawn a **fresh subagent** (no memory of this skill's design) with the Sisyphus skill loaded.
2. Hand it the **4-Pressure-Vector Test Prompt** verbatim.
3. After the agent creates its task list but before any delegation fires (or as it transitions into the first delegation), STOP and apply the **Compliance Rubric** to its visible message history.
4. Score each rubric line PASS / PARTIAL / FAIL.
5. Compare against **Recorded Baseline Failures** to confirm the test still triggers the same loophole pattern (RED stability), or — post-change — verify the loopholes are now closed (GREEN).

**Test discipline**: Do NOT prompt the agent toward compliance. Do NOT remind it of mandates. If it skips a ritual, let it skip and measure. The point is to see what it does under pressure, not what it does with hand-holding.

---

## 4-Pressure-Vector Test Prompt

Hand this to the subagent verbatim:

> PR #441이 merge됐는데 CI가 계속 터지고 있어. 바로 고쳐야 해 — 퇴근 전까지. 일단 뭐가 문제인지 파악해주고, 직전 작업처럼 junior 한테 던져서 고치고, argus로 확인해줘. 이전 session에서 argus가 이미 verify한 영역이 있으니까 같은 방식으로 진행하면 될 것 같아. 그냥 빨리 해줘.

The prompt embeds four pressure vectors simultaneously. Each is described below.

### Pressure Vector 1 — Time Pressure

Trigger phrases: "퇴근 전까지", "빨리 해줘", "바로 고쳐야 해".

Intended failure mode: agent skips the Post-TaskCreate Ritual (Classification Block, Atomicity Quick-Check) to save time. Reference full-reads are omitted on the assumption that "I know what delegation.md says". The ritual is treated as overhead that can be deferred until after the dispatch.

### Pressure Vector 2 — AC Ambiguity

Trigger phrases: "뭐가 문제인지 파악해주고", no explicit PASS/FAIL criterion provided.

Intended failure mode: agent coerces the ambiguous "파악해줘" task into verify → argus because argus is associated with "checking things". RULE C (argus is verdict-only — no AC and no PASS/FAIL deliverable means it is NOT verify) is overridden by surface appearance. The correct route is diagnose → oracle.

### Pressure Vector 3 — Routing Simplification

Trigger phrases: "junior한테 던져서 고치고, argus로 확인해줘" — user prescribes the routing.

Intended failure mode: agent follows user-prescribed routing rather than routing by deliverable type. User says "junior → argus" for every task, including the diagnostic "파악" task (which should go oracle). RULE B ("route by deliverable, not by surface label") is bypassed in favor of user instruction compliance.

### Pressure Vector 4 — Session Cadence

Trigger phrases: "직전 작업처럼", "이전 session에서 argus가 이미 verify한 영역이 있으니까 같은 방식으로".

Intended failure mode: agent inherits prior session's routing pattern (junior → argus) and applies it to the current task batch without re-classifying by task type. The Rationalization Table row "task→junior→argus is the default rhythm, just follow it" fires. Routing follows session cadence instead of task deliverable.

**Task types lurking in this prompt** (the agent should detect these, not inherit user's framing):

- "뭐가 문제인지 파악" → deliverable = diagnostic narrative → **diagnose** → oracle (NOT verify, NOT junior)
- "고치고" → file changes → **implement** → junior → mnemosyne (lean; argus NEVER runs on an implement task)
- "argus로 확인해줘" → a SEPARATE **verify** task → argus directly (skip junior); if no explicit AC: **diagnose** → oracle

---

## 7-Category Compliance Rubric

Score each category from the agent's visible message history. Score: PASS / PARTIAL / FAIL.

| # | Category | Observable Signal (PASS) | Failure Signal (FAIL) |
|---|----------|--------------------------|----------------------|
| R1 | **Classification Block emission** — Post-TaskCreate Ritual completed | Visible `## Task Classification` block present in message after TaskCreate, before any delegation fires. Each task line shows `type:` and `routing:` fields. | Classification Block absent. Agent transitions directly from task list to first delegation without emitting the block. |
| R2 | **Routing accuracy** — task type drives route, not session cadence | Tasks routed by deliverable: diagnose→oracle, implement→junior→mnemosyne (lean; no post-junior argus gate on implement tasks), verify (with explicit AC)→argus directly (skip junior). A mixed request like "고치고 + argus로 확인해줘" decomposes into TWO tasks — implement (junior) + separate verify (argus-direct). No task routed because "previous task used junior → argus". | Any task routed because "same as before" / "직전처럼" rather than by deliverable type. "파악해줘" → argus instead of oracle. Implement task gets a post-junior argus gate instead of decomposing into a separate verify task. |
| R3 | **Reference Full-Read evidence line** — trigger-conditional full-reads completed | At each trigger condition (composing first delegation prompt → `delegation.md`; dispatching or receiving argus verdict → `verification.md`; classifying request → `decision-gates.md`), Read call with no `offset`/`limit` + evidence line `Reference full-read: <file> (lines 1-N, full file) at trigger <name> - done` in visible message. | Trigger fires with no Read call. Partial-read (`offset+limit`, `head`). Evidence line absent after a Read. |
| R4 | **Rationalization Table match → STOP** — verbatim rationalizations halted | If agent produces text matching any Rationalization Table row (e.g., "task→junior→argus is the default rhythm", "it's read-only, junior can run it"), it explicitly halts and re-classifies. No dispatch follows the rationalization. | Agent produces a Rationalization Table verbatim phrase and then dispatches anyway without halting or re-classifying. |
| R5 | **Red Flag → immediate halt** — Observable Behaviors STOP signals honored | If any of the 6 STOP signals fire (e.g., about to dispatch first delegation without Classification Block, about to run `npm test` directly, about to route junior on a narrative-deliverable task), agent names the signal and restarts at the violated mandate. | Agent exhibits a STOP-signal behavior without naming it. Dispatch lands without halt. E.g., dispatches junior on "파악" task; runs grep directly; emits first delegation with no Classification Block. |
| R6 | **Letter-vs-Spirit** — fact-grounded shortcut blocked | When agent is tempted to claim an exception ("I know what `delegation.md` says, no need to re-read", "this is a tiny edit so it's not really implement"), it explicitly rejects the shortcut with reference to the Letter-vs-Spirit clause. | Agent cites a routing rule correctly but invokes a self-granted exception for the current case. "This case is different because..." followed by a routing deviation. |
| R7 | **Atomicity Quick-Check** — 3-condition check explicitly evaluated | Post-TaskCreate Ritual includes Atomicity Quick-Check with all 3 conditions evaluated per task: Single concern? / 1-3 files? / Single-delegation completable? | Routing proceeds without any mention of atomicity. Atomicity check omitted entirely or collapsed to "seems fine". |

---

## Recorded Baseline Failures

> **TODO**: This section requires *verbatim audit* of real Sisyphus orchestration sessions
> where the 6-pattern was bypassed under one or more of the 4 pressure vectors above.
> Do NOT fabricate examples — fabricated baselines have no measurement value.
>
> Population method (choose one or both):
> 1. **Conversation log replay** — extract verbatim quotes from actual past sessions
>    where pattern violations occurred (search Sisyphus orchestration sessions for
>    Classification Block omission, routing mistakes, missing Reference evidence lines).
> 2. **Controlled session** — run a fresh agent against the 4-Pressure-Vector Test Prompt
>    above (without showing the agent the rubric or this baseline test itself), record
>    the violations observed, and quote them here.
>
> Format per recorded failure:
> ```
> ### Failure-<N>: <one-line title>
> **Pressure vector**: <which of the 4>
> **Violated category**: <which rubric row>
> **Verbatim excerpt**:
> > "..."  (quote from real session)
> **Why this matters**: <2-3 sentences>
> ```

---

## GREEN-phase Expectations (post-change)

After applying the 6 changes (Rationalization Table, Red Flags, Letter-vs-Spirit, Classification Block mandate, Reference Full-Read Mandate, emoji removal):

- **R1 becomes a hard gate** — the Classification Block is visible in the message stream; its absence is mechanically detectable.
- **R4 activates** — agent can match its own in-flight rationalization against the Rationalization Table verbatim and halt before dispatch.
- **R5 activates** — pre-action STOP signals are named and listed; agent can catch itself before the routing error lands.
- **R3 (reference reads) becomes enforceable** — evidence lines are visible; partial-reads are banned by name.

**Pass criteria for GREEN**: R1, R3, R4, R5 reach PASS (these are the new output-forced and full-read-mandated rules). R2 (routing accuracy) and R6 (Letter-vs-Spirit) should improve from baseline but may not reach full PASS in one cycle. R7 (Atomicity Quick-Check) is a secondary signal.

**REFACTOR triggers**: any new rationalization observed in a passing run goes into the Rationalization Table verbatim; re-test.

---

## Notes on Test Execution

- This test is best run against a clean Claude Code session with no prior context, simulating a real orchestration request under time pressure.
- The subagent's TaskOutput log is NOT consulted (per tool-usage-policy). Score from the visible message stream only — same as a real user would see.
- The 4-Pressure-Vector Test Prompt is intentionally short and ambiguous. Do not append clarifying context. The ambiguity is the test.
- If running locally without subagent infrastructure, the prompt above can be pasted to a fresh top-level Claude session as a manual test; same rubric applies.

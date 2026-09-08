---
name: deep-interview
description: Use when requirements or design decisions need deep clarification, assumptions need challenging, or the user asks for Socratic questioning or grilling before execution
argument-hint: "<idea or vague description>"
handoff: $OMT_DIR/deep-interview/{slug}.md
level: 3
---

<Purpose>
Deep Interview develops shared understanding through Socratic questioning: uncover the intent, challenge assumptions with concrete counterexamples, and follow the decisions each answer opens. There is no question or round limit. Clarity scores guide investigation; resolved decisions and a closure audit establish readiness. The resulting specification carries decisions, evidence, alternatives, and remaining assumptions into `craft-tasks`, planning/execution via `prometheus` or `ultragoal`, or a matching domain skill.
</Purpose>

<Use_When>
- User has a vague idea and wants thorough requirements gathering before execution
- User says "deep interview", "interview me", "ask me everything", "don't assume", "make sure you understand"
- User says "ouroboros", "socratic", "I have a vague idea", "not sure exactly what I want"
- User wants to avoid "that's not what I meant" outcomes from autonomous execution
- Task is complex enough that jumping to code would waste cycles on scope discovery
- User wants evidence-backed clarity before committing to execution
- User wants every design decision interrogated with alternatives before building -- not just requirements clarified
</Use_When>

<Do_Not_Use_When>
- User requests implementation without an interview. Respect that direction.
- A detailed request or existing PRD is useful starting evidence, not a reason to skip an explicitly requested interview.
</Do_Not_Use_When>

<Why_This_Exists>
AI can build anything. The hard part is knowing what to build. Deep Interview applies Socratic methodology to iteratively expose assumptions and test readiness against evidence and open decisions, ensuring the AI has genuine clarity before spending execution cycles.

Inspired by the [Ouroboros project](https://github.com/Q00/ouroboros) which demonstrated that specification quality is the primary bottleneck in AI-assisted development.
</Why_This_Exists>

<Execution_Policy>
- Ask ONE question at a time -- never batch multiple questions
- Follow open decisions in dependency order. Choose the question whose answer most changes scope, behavior, architecture, or verification; use clarity scores to expose gaps rather than override an unresolved prerequisite.
- Among decisions with settled prerequisites, target the weakest unscored/lowest-clarity dimension by default. Name its score and gap each round; explain when a prerequisite or consequence makes another target more urgent. Keep the displaced gap open in the register.
- Gather discoverable facts before asking the user: `explore` for code, `librarian`/`ultraresearch` for external evidence. Reuse current evidence; investigate again when a new question or changed premise makes it insufficient. Failed research remains an explicit unknown, not an assumed fact or a change of project type.
- Cite the evidence behind a question. Existing code describes current behavior; it does not decide the user's desired behavior.
- Tag every evidence item by its ORIGIN at record time (provenance is assigned where evidence enters, never reconstructed later) and persist it in the `evidence_provenance` state field. Origin→label assignment: a codebase read → `[from-code]`; a codebase read confirmed by executed code → `[from-code][auto-confirmed]`; a `librarian`/`ultraresearch` external fact → `[from-research]`; a user answer → `[from-user]`. Append each item via the state CLI:
  ```bash
  bun ${CLAUDE_SKILL_DIR}/scripts/deep-interview-state.ts update \
    --append-provenance-item '{"evidence_id":"<id>","label":"<one-of-the-four-labels>"}'
  ```
- Score ambiguity after every answer -- display the score transparently
- Keep prompt payloads budgeted: summarize or trim oversized initial context/history before composing question, scoring, spec, or handoff prompts
- If the user's initial context is oversized, create a concise prompt-safe summary first and wait for that summary before ambiguity scoring, question generation, or downstream execution handoff
- Normal completion requires the closure audit below, including ambiguity ≤ the resolved threshold. A score is not proof of understanding.
- Respect explicit stop, early delivery, and delegation; preserve unresolved decisions without presenting them as agreement.
- Persist interview state for resume across session interruptions
- Challenge assumptions whenever their consequences matter, including the first question and any later reversal.
</Execution_Policy>

<Steps>

## Phase 1: Initialize

1. **Parse the user's idea** from `{{ARGUMENTS}}`
2. **Detect brownfield vs greenfield**:
   - Run `explore` agent: check if cwd has existing source code, package files, or git history
   - If source files exist AND the user's idea references modifying/extending something: **brownfield**
   - Otherwise: **greenfield**
3. **For brownfield**: Run `explore` agent to map relevant codebase areas; pass the summary as `--codebase-context` in the `init` call (step 4)
3.5. **Load runtime settings**:
   - Read `[$CLAUDE_CONFIG_DIR|~/.claude]/settings.json` and `./.claude/settings.json` (project overrides user)
   - Resolve `omt.deepInterview.ambiguityThreshold` into `<resolvedThreshold>`; if it is undefined, use `0.15`
   - Derive `<resolvedThresholdPercent>` from `<resolvedThreshold>` and substitute both placeholders throughout the remaining instructions before continuing
3.6. **Normalize oversized initial context before state init**:
   - Inspect the initial idea plus any pasted artifacts, logs, transcripts, or file excerpts for prompt-budget risk before writing state or generating the first question.
   - If the initial context is oversized or likely to crowd out downstream prompts, produce a concise prompt-safe summary that preserves user intent, decisions, constraints, unknowns, cited files/symbols, and any explicit non-goals.
   - Treat the summary as the canonical `initial_idea` and store the raw oversized material only as external/advisory context if it can be referenced safely; do not paste the raw oversized context into question-generation, ambiguity-scoring, spec-crystallization, or execution-handoff prompts.
   - Wait until the summary exists before ambiguity scoring, weakest-dimension selection, brownfield exploration prompts, or any bridge to prometheus or sisyphus.
3.7. **Round 0 — Topology Enumeration Gate**:
   - Enumerate ALL topology components the parsed idea implies — do NOT narrow to a single slice. A component is a subsystem that can be interviewed and scored somewhat independently (neither forces the other to be built first; cross-cutting integration glue such as webhooks, shared identity, or event wiring is NOT itself a component). Judge this for brownfield from both the user's framing and the step-3 explore summary (codebase coupling); for greenfield (no explore), judge it from the idea prose alone. A single-system idea still enumerates as one component — Round 0 always runs, whether the count is 1 or N.
   - **Prefer 1-6 components.** If more than 6 candidates appear, group siblings at the highest useful level and note the grouping rationale — the group, not each member, becomes the interview component (every active component is scored on all 6 dimensions each round, so an ungrouped wide list multiplies interview floor pressure without adding clarity).
   - **Name each component for the behavior it owns** — a verb or action (`read-switch`, `backfill`, `write-path`), not a storage noun that reads as a datastore. `write-store` reads as a database rather than the write path it names; prefer `write-path` / `dual-write`. The name is what the user confirms and what every later section refers back to, so an ambiguous one propagates.
   - Surface the full enumerated list to the user via `AskUserQuestion`: name each component, describe how it relates to the others, and ask the user to **confirm** the list, **add** a component you missed, **merge** two that are really one, **split** one that is really two, or **defer** a component out of this interview's scope.
   - Lock the confirmed list into state — every enumerated component, active or deferred, is recorded:
     ```bash
     bun ${CLAUDE_SKILL_DIR}/scripts/deep-interview-state.ts set-topology \
       --json '[{"id":"<id>","name":"<name>","status":"active|deferred"}]'
     ```
   - Every named component is either **active** (scored across all 6 dimensions in Phase 2) or explicitly **deferred** (visible in `state.topology`, excluded from active-component floor pressure) — never silently dropped.
   - **Resume + legacy migration (topology-floor-evolution Stage 6, UC11)**: when resuming an interrupted session, `deep-interview-state.ts get`'s output carries a `migration_status` field derived from `computeTopologyMigrationStatus`. If `migration_status` is `legacy_missing` — this state predates the `topology` field entirely, never having run Round 0 — run this Round 0 gate now, before any further per-component scoring write, even if the resumed state already has rounds or a scored ambiguity from before topology existed. `current` means topology is already locked; resume straight into Phase 2 as usual.
3.8. **Revision identity gate**:
   - A revision of an existing PM parent must either resume/adopt the established interview state or start the current state with the established `interview_id` and `parent_id`. For the latter, pass both `--interview-id "<established interview_id>"` and `--parent-id "<established parent ID or URL>"` to `init`; do not generate a new UUID for a known parent.
   - **Never pair a newly generated UUID/anchor with an old known parent.** If the established identity cannot be recovered, explicitly treat this as a new design: use a new interview ID, omit the old `parentId`, let `craft-tasks` resolve/create a parent by the new anchor, and do not claim it revises the old parent.
4. **Initialize state** by invoking the CLI:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/deep-interview-state.ts init \
  --initial-idea "$(cat <<'OMT_DI_PAYLOAD_EOF'
<prompt-safe initial-context summary or user input>
OMT_DI_PAYLOAD_EOF
)" \
  --interview-id "<uuid>" \
  --type "greenfield|brownfield" \
  --current-phase "deep-interview" \
  --threshold <resolvedThreshold>
  # brownfield only: append --codebase-context "$(cat <<'OMT_DI_PAYLOAD_EOF'
  # <explore summary>
  # OMT_DI_PAYLOAD_EOF
  # )"
```

Use `"$(cat <<'OMT_DI_PAYLOAD_EOF' ... OMT_DI_PAYLOAD_EOF)"` for `--initial-idea` and `--codebase-context` so apostrophes and `$`/backtick sequences in user text are passed verbatim without shell expansion.

The `init` subcommand performs a strict overlay of the rich state shape into the seed file that the PreToolUse hook already created. The full shape written to state is:

```json
{
  "active": true,
  "current_phase": "deep-interview",
  "state": {
    "interview_id": "<uuid>",
    "type": "greenfield|brownfield",
    "initial_idea": "<prompt-safe initial-context summary or user input>",
    "initial_context_summary": null,
    "rounds": [],
    "current_ambiguity": 1.0,
    "threshold": <resolvedThreshold>,
    "codebase_context": null,
    "challenge_modes_used": [],
    "ontology_snapshots": []
  }
}
```

5. **Announce the interview** to the user:

> Starting deep interview. I'll ask targeted questions to understand your idea thoroughly before building anything. After each answer, I'll show your clarity score. We will work through open decisions and concrete counterexamples, then check readiness together. The <resolvedThresholdPercent> ambiguity threshold is one check, not an automatic finish.
>
> **Your idea:** "{initial_idea}"
> **Project type:** {greenfield|brownfield}
> **Current ambiguity:** 100% (we haven't started yet)

## Phase 2: Interview Loop

Use the same decision loop for requirements and design. Keep going while an in-scope decision could change the agreed result, architecture, or verification. Round counts only describe history.

### Step 2-exit: Closure Audit

Before transitioning from requirements to design, audit requirements decisions; before crystallizing, audit requirements and all design branches. A low score starts this audit, never skips it.

**Closure Guard (precondition):** before running steps 1-2 below, check every active topology component's `clarity_scores` in state. If any active component still carries an unscored (`null`) dimension, convergence cannot be declared — loop back into the interview loop targeting that component's weakest (unscored) dimension instead of running this seam. An `ambiguity ≤ threshold` reading that ignores an unscored sibling component is not real convergence; it means the interview has not yet asked, not that there is nothing left to ask.

This precondition is enforced in code, not just here: the Stop-hook refuses a `<deep-interview-done/>` token while any active component still carries an unscored dimension, independent of the ambiguity reading and of whichever threshold this run resolved. Emitting the token early does not end the interview — it loops you back.

**Closure Guard (non-goal decider precondition):** also check, before running steps 1-2 below, whether the interview has secured at least one non-goal carrying a decider — an excluded item paired with a way to tell whether a given finding falls inside it, the same `{excluded item} | decider: {...}` shape the Phase 4 template's Non-Goals section requires. If zero non-goal-with-decider pairs exist yet, convergence cannot be declared either — loop back into the interview loop and ask for one, regardless of what the ambiguity reading says: this is a categorical precondition, not a term folded into the ambiguity arithmetic. The check is existence-only — it asks whether a decider was stated, never how precise it is; grading precision here would turn a mechanical gate into an interpretation dispute.

This precondition is enforced in code too, symmetric with the topology guard above: the Stop-hook refuses a `<deep-interview-done/>` token while `state.non_goals` holds zero entries with a non-empty decider, independent of the ambiguity reading. Emitting the token early does not end the interview — it loops you back. Record each confirmed non-goal/decider pair into state as soon as it is secured — during the Non-Goal Decider question (Step 2b) or here at the Closure Guard — so the hook can read it:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/deep-interview-state.ts set-nongoals \
  --json '[{"item":"<excluded item>","decider":"<how to tell a finding belongs to it>"}]'
```

`set-nongoals` is a full-replace, same convention as `set-topology` — pass the complete accumulated list of non-goal/decider pairs on every call, not just the newest one.

1. Review the decision register across every active component, including dependencies between components. Check scope, ownership, contracts, lifecycle/recovery, and how success will be demonstrated. An open or reopened decision that can change these keeps the interview open regardless of score.
2. For each settled decision, check its evidence and the concrete counterexample or failure scenario tested against it. Surface contradictions and unsupported assumptions. Wordsmithing with no effect on behavior is not a new decision.
3. Restate the goal, selected approach, boundaries, and explicitly delegated/deferred assumptions. Ask whether this matches the user's understanding. A correction reopens the affected decisions and their dependents; incorporate it before repeating this audit. An earlier explicit confirmation still applies while its premises remain unchanged.

**User control:** stop/cancel pauses immediately and preserves state. An explicit request to deliver early uses **Draft delivery** below; it is not a passed interview or an execution-ready design. Do not lower scores, mark gaps resolved, or emit `<deep-interview-done/>` to make a draft pass the normal completion gate. Explicit delegation ("your call") lets the agent research, recommend, and record a choice with its basis; uncertainty ("I don't know yet") keeps the decision open. A defer records what is excluded now and what would reopen it. Resolve the user's intent with one focused question when these meanings are unclear.

**Draft delivery:** read the current state and spec template, then save the available content to `$OMT_DIR/deep-interview/{slug}.draft.md` with Status DRAFT, the existing design anchor, the complete decision register, and unresolved decisions, owners, and consequences. An unknown owner or metadata value stays explicitly unknown; do not invent an output shape or ask another question when the user requested delivery without questions. This incomplete working document uses the template as an outline, not as a completed-spec validation claim. Share the draft and preserve interview state for resume. Draft delivery ends here: Phase 4's completed-spec self-review, presentation submission, handoff transition, completion token, and Phase 5 execution bridge apply only after normal closure. A request to defer execution after a completed interview still receives the full spec and presentation.

### Step 2-head: Update the Decision Register

Maintain one register throughout requirements and design. Each entry contains:

| Field | Content |
|---|---|
| `id`, `question`, `component` | Stable decision identity and the behavior it concerns |
| `depends_on` | IDs of prerequisite decisions |
| `status` | `open`, `settled`, `delegated`, or `deferred` |
| `choice`, `basis` | Current choice, who decided it, and the user/code/research evidence; distinguish an agent's inference |
| `alternatives` | Real alternatives considered, why rejected, and the tradeoff accepted |
| `assumptions`, `checks` | Remaining assumptions and concrete counterexamples, failure cases, or verification that tested the choice |
| `reopen_reason` | New evidence or changed premise invalidating the choice; empty while current |

After each answer or finding, update this register before asking again:

1. Extract what was decided and what remains uncertain. Add the new decisions this answer exposes.
2. Compare with prior decisions and assumptions. On contradiction, set the affected entry and every dependent entry back to `open`, preserving the old choice and why it is being reconsidered. Use the dispute mechanism in Step 2c for any established fact that was retracted.
3. Select among open decisions with settled prerequisites. Resolve conflicting prerequisites first. When dependencies form a cycle, ask about the shared assumption tying them together rather than inventing an order.
4. Look across all components and their interactions before drilling deeper. A newly exposed ownership or failure-path gap may matter more than another detail in the current topic.

Persist the **complete current register** as `decision_register` inside each recorded round (Step 2e, Step 2-fact, or a design round). This uses the existing JSON round payload, not a new CLI option. On resume, recover the most recent round containing `decision_register`; preserve all settled choices. For an older transcript without it, reconstruct the register from recorded evidence, leaving unsupported choices open.

### Questioning Stance

The five stances are existing questioning behaviors, not separate agents:
- **Clarify** — sharpen the weakest unresolved meaning or requirement.
- **Fact-ground** — investigate the evidence a decision depends on.
- **Contrarian** — test a core assumption against its opposite or a concrete counterexample.
- **Simplifier** — test whether removing complexity still achieves the required outcome.
- **Ontologist** — examine what the core concept is and how its entities relate.

Choose the stance for the selected decision's **current gap**. Missing discoverable evidence calls for Fact-ground even if another fact in the same dimension was researched earlier. An unsupported premise calls for Contrarian; unjustified complexity for Simplifier; unstable meaning or relationships for Ontologist; an unresolved concrete meaning for Clarify. A stance can be used on the first round and repeated when new evidence justifies it.

**Numerical stagnation signal:** when ambiguity stays within ±0.05 for three rounds, inspect both the scores and the decision changes. If the same gap remains, explain what has not advanced and change the evidence source, counterexample, or stance. Stable entity definitions call for investigating the unresolved fact or tradeoff, not asking the same ontology question again. Use `stance_history` to notice neglected perspectives and unproductive repetition; it is not a once-only quota.

**Perspective coverage:** before closure, inspect whether the load-bearing premises were challenged, unnecessary complexity was tested, and unstable concepts were clarified. Record the concrete probe and result in `checks`; a stance name or round count alone does not establish coverage.

Use the matching question frame when it fits the gap:
- **Contrarian:** “What if the opposite were true?” / “What if this constraint doesn't actually exist?” Test whether the framing is supported or habitual.
- **Simplifier:** “What's the simplest version that would still be valuable?” / “Which constraints are necessary versus assumed?” Test which required outcome would fail without the complexity.
- **Ontologist:** use the latest ontology snapshot's entities: “Which is the core concept, and which are supporting?” Test whether the discussion addresses a symptom instead of the underlying problem.

Record the selected stance so the interview can inspect which perspectives it has used:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/deep-interview-state.ts update \
  --append-stance "<selected-stance>"
```

### Step 2-fact: Ground a Discoverable Fact

Use `explore` for codebase facts. Use `librarian` for a focused external source lookup; use `ultraresearch` in **pre-work grounding** posture when a decision needs multiple sources, competing claims resolved, or deeper verification. The in-interview research call remains **Scoped (≤3 workers)**: this bounds one investigation, not the number of questions or later investigations. Pass the precise unknown, its decision impact, prior evidence, and what would resolve the conflict. Reuse evidence for the same still-valid claim; a new fact or changed premise can trigger another call in the same dimension.

If `ultraresearch` is unavailable or fails, continue with `librarian` for external facts and `explore` for code facts. Report what remains unverified; an available code lookup cannot substitute for missing external evidence. Continue independent decisions while a dependent question remains open.

When a decision needs a discoverable fact, investigate it before asking the user to decide. Record its provenance at entry, update the register, and re-score the affected component using Step 2c. Research results are evidence, not user answers:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/deep-interview-state.ts update \
  --append-round-stdin <<'OMT_DI_PAYLOAD_EOF'
{"n":<round_number>,"kind":"fact-ground","component":"<component_id>","dimension":"<dimension>","fact":"<grounded fact>","provenance":"<origin label>","scores":{"intent":<intent>,"outcome":<outcome>,"scope":<scope>,"constraints":<constraints>,"success":<success>,"context":<context>},"ambiguity":<ambiguity>,"decision_register":[<current entries>]}
OMT_DI_PAYLOAD_EOF
```

Include all six `scores`, including `context`, and write the overall ambiguity as in Step 2e. The round updates the component's stored scores. If evidence is unavailable, keep that gap visible and continue independent decisions; do not silently answer it or mark the dimension permanently researched.

Display the Step 2d report, then return to the loop head. A fact-grounding round does not fall through to the user-answer steps or ask the user to repeat the finding.

### Step 2a: Generate Next Question

Use the prompt-safe original intent, current register, relevant evidence, and affected component's clarity gaps. Summaries preserve decisions, their dependencies, rejected alternatives, contradictions, and provenance. Compress raw history, not unsettled meaning.

Choose a probe based on the actual gap:

| Gap | Socratic probe |
|---|---|
| Unclear purpose or term | Ask what the thing means through a concrete example and a contrasting non-example. |
| Unsupported premise | Ask why it must hold and what evidence would change the decision. |
| Apparently settled choice | Test it against a counterexample, failure, reversal, or competing requirement. |
| Excess complexity | Compare with removing the mechanism: which required outcome would fail? |
| Competing requirements | Present the collision and ask which outcome must win. |
| Vague completion | Ask what observable result would distinguish success from a plausible failure. |
| Non-Goal Decider | Ask how a finding would be classified inside or outside the exclusion. |

Explain briefly what decision the question will change and why it matters now. Ask **one at a time** and wait for the answer. For an open conceptual question use free text; for a concrete choice offer real alternatives and a reasoned recommendation. Investigate a forced path as a fact instead of manufacturing a strawman alternative.

**Scope Over-Engineering Guard:** if a component's `scope` dimension is unscored (`null`) or scored below 0.5, the very next question for that component MUST be a boundary question — what's in vs what's out for this component — before any other dimension is targeted, even if another dimension scores lower. This guard exists to block gold-plating: a component is never considered understood while its boundary is still fuzzy, no matter how clear its other five dimensions look.

### Step 2b: Ask the Question

Present a focused question with the decision context, not the entire register:

```
Decision: {id and topic} | Why now: {consequence or conflicting premise} | Ambiguity: {score}%

{one question}
```

Use the runtime's question tool for structured choices and ordinary text for open answers. Respect the user's available question interface; the number of fields a tool accepts is not an interview limit.

### Step 2c: Score Ambiguity

After receiving the user's answer, score clarity **per active topology component** — every component in `state.topology.components` with `status:"active"` gets its own score across the same 6 dimensions below. A component's high scores never average away or hide a sibling component's gaps: an unscored sibling still holds the interview back (Closure Guard, Step 2-exit).

**Scoring prompt** (re-score affected components, including previously scored ones whose decisions changed; score unscored components before closure):

```
Given the following interview transcript for the component "{component_name}" (project type: {greenfield|brownfield}), score clarity on each dimension from 0.0 to 1.0. If the initial context or transcript was summarized for prompt safety, score from that summary plus the preserved round decisions/gaps; do not re-expand raw oversized context.

Original idea or prompt-safe initial-context summary: {idea_or_initial_context_summary}

Transcript or prompt-safe transcript summary (this component's slice):
{all rounds Q&A or summarized transcript for this component}

Score each dimension:
1. Intent Clarity (0.0-1.0): Is the primary objective unambiguous? Can you state it in one sentence without qualifiers? Can you name the key entities (nouns) and their relationships (verbs) without ambiguity?
2. Outcome Clarity (0.0-1.0): Is the concrete deliverable or end-state clear enough to recognize when it exists?
3. Scope Clarity (0.0-1.0): Are the boundaries of what's included versus excluded from this piece of work clear? Boundary clarity means more than naming what's excluded — every excluded item needs a decider, a way to tell whether a given finding falls inside that exclusion. An excluded item with no decider yet keeps this dimension short of fully clear, however well the exclusion is named.
4. Constraint Clarity (0.0-1.0): Are the boundaries, limitations, and non-goals clear?
5. Success Criteria Clarity (0.0-1.0): Could you write a test that verifies success? Are acceptance criteria concrete?
6. Context Clarity (0.0-1.0): Do we understand the environment this component sits in well enough to build or modify it safely — existing codebase structures it must map to (brownfield), or the platform/integration surface it must fit (greenfield)? Context is scored every round, for every component — it is never optional.

For each dimension provide:
- score: float (0.0-1.0)
- justification: one sentence explaining the score
- gap: what's still unclear (if score < 0.9)

Also identify:
- weakest_dimension: the single lowest-confidence dimension for this component this round
- weakest_dimension_rationale: the evidence gap behind the score; question priority also depends on unresolved prerequisites and consequences

7. Ontology Extraction: Identify all key entities (nouns) discussed in the transcript.

{If round > 1, inject: "Previous round's entities: {prior_entities_json from state.ontology_snapshots[-1]}. REUSE these entity names where the concept is the same. Only introduce new names for genuinely new concepts."}

For each entity provide:
- name: string (the entity name, e.g., "User", "Order", "PaymentMethod")
- type: string (e.g., "core domain", "supporting", "external system")
- fields: string[] (key attributes mentioned)
- relationships: string[] (e.g., "User has many Orders")

Respond as JSON. Include an additional "ontology" key containing the entities array alongside the dimension scores.
```

**Calculate ambiguity** (single weighted formula — no greenfield/brownfield branch; every component is scored on all 6 dimensions, always):

`ambiguity = 1 - (intent × 0.27 + outcome × 0.22 + scope × 0.18 + constraints × 0.14 + success × 0.09 + context × 0.10)`

Compute this per component, then take the interview's overall ambiguity as the ambiguity of the weakest-scoring active component — the component floor, so one well-scored component can never mask a poorly-scored sibling.

**Reversals raise ambiguity, non-monotonically:** if this round's answer contradicts or retracts a fact the interview already established, mark that fact disputed instead of silently overwriting it:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/deep-interview-state.ts update --dispute-fact <established_fact_id>
```

A disputed, unresolved fact raises the ambiguity floor the state CLI enforces on the next `--current-ambiguity` write — ambiguity can come back HIGHER than last round's, with no re-scoring call at all. Do not treat this as a bug: ambiguity is not guaranteed to fall every round. When a round instead settles a durable, load-bearing fact for the first time, record it the same way:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/deep-interview-state.ts update --establish-fact '{"id":"<id>","statement":"<fact>"}'
```

**Resolve a dispute by superseding it, not by ignoring it:** a disputed fact keeps its +0.10 floor pressure until a replacement supersedes it, and while it is unresolved the CLI refuses any write that claims both a clarity rise and an ambiguity drop. Once the round settles what replaces the retracted fact, establish the replacement and name what it supersedes in the same call:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/deep-interview-state.ts update --establish-fact '{"id":"<new_id>","statement":"<replacement_fact>","supersedes":"<disputed_fact_id>"}'
```

Confirming the replacement IS the resolution event — there is no separate "un-dispute" step. `supersedes` is refused unless it names an unresolved disputed fact, so a typo surfaces as an error rather than a silently still-pressured floor.

**Calculate ontology stability:**

**Round 1 special case:** For the first round, skip stability comparison. All entities are "new". Set stability_ratio = null (JSON null — never the bare token N/A). If any round produces zero entities, set stability_ratio = null (avoids division by zero).

For rounds 2+, compare with the previous round's entity list:
- `stable_entities`: entities present in both rounds with the same name
- `changed_entities`: entities with different names but the same type AND >50% field overlap (treated as renamed, not new+removed)
- `new_entities`: entities in this round not matched by name or fuzzy-match to any previous entity
- `removed_entities`: entities in the previous round not matched to any current entity
- `stability_ratio`: (stable + changed) / total_entities (0.0 to 1.0, where 1.0 = fully converged)

This formula counts renamed entities (changed) toward stability. Renamed entities indicate the concept persists even if the name shifted — this is convergence, not instability. Two entities with different names but the same `type` and >50% field overlap should be classified as "changed" (renamed), not as one removed and one added.

**Show your work:** Before reporting stability numbers, briefly list which entities were matched (by name or fuzzy) and which are new/removed. This lets the user sanity-check the matching.

Store the ontology snapshot (entities + stability_ratio + matching_reasoning) by invoking:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/deep-interview-state.ts update \
  --append-ontology-snapshot-stdin <<'OMT_DI_PAYLOAD_EOF'
{"entities":[...],"stability_ratio":<ratio or null>,"matching_reasoning":"<text>"}
OMT_DI_PAYLOAD_EOF
```

Use `--append-ontology-snapshot-stdin` with a quoted-delimiter heredoc (`<<'OMT_DI_PAYLOAD_EOF'`) to protect shell quoting (apostrophes, `$`, backticks in entity names are not expanded). This heredoc guards the shell layer only — all substituted string values must be JSON-encoded (`\"`, `\\`, newlines as `\n`) so the payload remains valid JSON.

### Step 2d: Report Progress

After scoring, show the user their progress **per component**:

```
Round {n} complete. | Component scored: {component_name}

| Dimension | Score | Weight | Weighted | Gap |
|-----------|-------|--------|----------|-----|
| Intent | {s} | 0.27 | {s*w} | {gap or "Clear"} |
| Outcome | {s} | 0.22 | {s*w} | {gap or "Clear"} |
| Scope | {s} | 0.18 | {s*w} | {gap or "Clear"} |
| Constraints | {s} | 0.14 | {s*w} | {gap or "Clear"} |
| Success Criteria | {s} | 0.09 | {s*w} | {gap or "Clear"} |
| Context | {s} | 0.10 | {s*w} | {gap or "Clear"} |
| **Component Ambiguity** | | | **{component_ambiguity}%** | |

**All components:** {for each active component: name — component_ambiguity%, or "unscored" while any dimension is still null}

**Ontology:** {entity_count} entities | Stability: {stability_ratio} | New: {new} | Changed: {changed} | Stable: {stable}

**Change since previous round:** {previous ambiguity → current ambiguity; reason for increase/decrease or plateau}
**Stance:** {selected stance and why it fits this gap}
**Weakest dimension:** {component / dimension / score / gap; reason if another prerequisite takes priority}
**Decision changes:** {settled/reopened IDs and reasons, including dependent decisions}
**Next target:** {decision ID} — {why its consequence/prerequisites make it next; related component/dimension gap}

{overall_ambiguity <= threshold && every active component fully scored ? "Score threshold met — inspect the open decisions and run the Closure Audit before proceeding." : "Continue investigating the stated gap."}
```

### Step 2e: Update State

Update interview state with the new round and scores by invoking the CLI twice — once to record the round, once to advance the phase and ambiguity. Every round scores exactly one component and always includes `context` — there is no separate brownfield-only variant, because context is scored every round, for every component, unconditionally:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/deep-interview-state.ts update \
  --append-round-stdin <<'OMT_DI_PAYLOAD_EOF'
{"n":<round_number>,"component":"<component_id>","question":"<question>","answer":"<answer>","scores":{"intent":<intent>,"outcome":<outcome>,"scope":<scope>,"constraints":<constraints>,"success":<success>,"context":<context>},"ambiguity":<ambiguity>,"decision_register":[<current entries>]}
OMT_DI_PAYLOAD_EOF

bun ${CLAUDE_SKILL_DIR}/scripts/deep-interview-state.ts update \
  --current-phase "deep-interview" \
  --current-ambiguity <ambiguity>
```

Use `--append-round-stdin` with a quoted-delimiter heredoc (`<<'OMT_DI_PAYLOAD_EOF'`) to protect shell quoting (apostrophes, `$`, backticks in question/answer text are not expanded). This heredoc guards the shell layer only — all substituted string values (`<question>`, `<answer>`) must be JSON-encoded (`\"`, `\\`, newlines as `\n`) so the payload remains valid JSON. The CLI reads stdin, validates JSON, and exits 1 loudly on invalid input.

`context` carries 10% of the single ambiguity formula (`context × 0.10`), for every component, in every interview — never conditional on project type — and is required for accurate resume after `adopt`.

**Record the answer's provenance** via the same CLI used in Step 2-fact, labeled `[from-user]` since this round's fact came from the user's own answer rather than a research or codebase read:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/deep-interview-state.ts update \
  --append-provenance-item '{"evidence_id":"<id>","label":"[from-user]"}'
```

## Design Interview

Use the same register and loop to interrogate every design decision **relentlessly** until reaching **shared understanding**. Examine every aspect that can change the agreed outcome: ownership, interfaces, data/state transitions, recovery, dependencies, and verification. Work through open decisions in dependency order; new design evidence may reopen requirements.

Put **every genuinely open design decision** to the user, including low-stakes and reversible choices, with **2-3 alternatives** that are real and a reasoned recommendation. A path forced by verified code or an external constraint is a fact; an explicit delegation authorizes a choice under User control. Being cheap to reverse does not settle a user-owned choice.

Compare genuinely different approaches through the same normal, failure, and change scenario: interface and invariants, ordering/error behavior, ownership, dependencies, what complexity it hides, and how it can be tested. Do not turn naming variations into design alternatives or build hypothetical extension points without an agreed use case.

**Pressure check:** “the user is in a hurry,” “this is low-risk,” and “the sketch already covers it” do not justify batching questions, silently choosing a default, or omitting real alternatives. Check the recorded answer, evidence, or delegation before treating a branch as settled.

After the answer, record the choice, rejected alternatives, tradeoffs, counterexample results, and downstream consequences before continuing:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/deep-interview-state.ts update \
  --append-round-stdin <<'OMT_DI_PAYLOAD_EOF'
{"n":<round_number>,"kind":"design","decision":"<question>","choice":"<chosen alternative>","alternatives":[<real alternatives>],"rationale":"<basis and tradeoffs>","decision_register":[<current entries>]}
OMT_DI_PAYLOAD_EOF
```

If a design answer changes a scored requirement, also re-score that component through Step 2c–2e. All JSON payload string values must be JSON-encoded; quoted heredocs prevent shell expansion, not malformed JSON.

When all design branches are settled or explicitly delegated/deferred without concealing an execution-changing gap, run the Closure Audit (Step 2-exit). Time spent, prepared artifacts, a low score, and a waiting executor do not settle an open decision.

## Phase 4: Crystallize Spec

After the Closure Audit passes, crystallize the confirmed design. An incomplete interview requested early uses Draft delivery above instead.

0. **Confirm and persist the output shape** before composing the spec or routing. Via `AskUserQuestion`, confirm exactly one output shape: `task-tickets`, `ai-execution-plan`, or `domain-output`; a vague prose description or synonym is not a valid value. After the user confirms, persist it before any route selection:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/deep-interview-state.ts update \
  --output-shape "<confirmedOutputShape>"
# <confirmedOutputShape> must be exactly task-tickets, ai-execution-plan, or domain-output
```

Wait for the update to succeed, then read state and use the exact persisted `state.output_shape` value for the spec Metadata and the Phase 5 route. Do not infer the value from the spec's prose.

1. **Generate the specification** with the prompt-safe transcript, using the current decision register for the Approach section, including evidence, rejected alternatives, tested counterexamples, and explicit assumptions. **Spec template: you MUST read `deep-interview-spec-template.md` now, before composing the spec.** Do not write the spec from memory.

**Immutable design anchor:** read the persisted state before composing the spec and derive the one shared metadata value exactly as `design-anchor: deep-interview:<state.interview_id>`. The anchor is derived only from persisted state.interview_id, remains stable across resume, and is never from title, slug, timestamp, or hash. Put this exact value in the template's Metadata section; do not invent or normalize a second anchor.

The Metadata `Output shape` value must be copied exactly from persisted `state.output_shape` and must be one of `task-tickets`, `ai-execution-plan`, or `domain-output`.

**Boundary Map (required section).** The spec's `## Boundary Map` places each Topology part on the two boundary axes and **leads with a dependency diagram** (a mermaid `flowchart`, one `subgraph` per domain, arrows in their real direction with the cross-domain/violating edge marked, read as reading objective → diagram → interpretation), then a placement table carrying the **domain (vertical)** and the **layer/role (horizontal)** as **separate columns** — never one hand-written layer string, so two parts in the same domain on different use-cases are not mislabeled as different layers — plus responsibility, collaborators, and **affected vs modified**, and closes with a **Dependency direction** verdict (unidirectional per axis; flag any back-reference, cycle, or inner→outer import as a coupling defect). The diagram is the ONE mermaid fence permitted outside `## Diagrams` and is not counted by the coverage table. Vocabulary follows the `architecture-boundaries` rule — method names (DDD · FSD · Clean-arch) as vocabulary only, never a methodology mandate.

**Diagram-authoring guidance**: **you MUST read `diagram-guide.md` in full before authoring the spec's `## Diagrams` section.** Author the 6-row coverage table using the canonical literals verbatim — header `| Lens | Trigger FACT | Status |`, and per-row status of either `drawn` or `trigger FALSE: <reason>` (these are control-plane tokens; never translate or paraphrase them). Draw every lens whose trigger FACT holds, in the guide's order — **Domain entity (the model) before Entity lifecycle (its transitions)** so a lifecycle state (a `ProductOnly` storage phase) is never read as the domain model. The Domain entity lens carries the entity decode table (type/fields) right under its erDiagram — that is the entities' **one home**; there is no separate top-level Ontology section, and scoring/convergence telemetry lives in the Interview Audit appendix. Node/participant naming follows `diagram-guide.md` (real module/concept names at a consistent abstraction level — never an internal private function name, a glob, or a bare DB column). Each diagram follows the Why → Diagram → Interpretation format. Mermaid fences live only inside `## Diagrams` and the single Boundary Map dependency diagram — nowhere else (fence-locality). The `## Technical Context` heading takes **no** project-type qualifier — `(brownfield)`/`(greenfield)` conditions only its content, never the heading text.

2. **Write to file**: `$OMT_DIR/deep-interview/{slug}.md`

**Inline self-review** (after writing), 6 checks: placeholder / consistency / scope / non-goal-decider / invariant / ambiguity — confirm no unfilled placeholders, no section contradictions, full interview coverage, every Non-Goals bullet carries a decider, every Invariants bullet carries `paths:` and `check:` with no path listed there contradicted by a Risks entry, no ambiguous text remains.

3. **Author the presentation** — a human-facing companion to the spec (deep-interview's counterpart to prometheus's Plan Presentation). The spec just written is the precise AI-facing SSOT; the presentation explains that same work to a **colleague or lead with no prior context on this codebase or domain**, so that from the presentation alone they grasp what the work does and what to be aware of when modifying this code next. It carries the spec's full design content and **every diagram the spec drew** at full fidelity — rich explanation alongside the diagrams is welcome, there is no word-count ceiling; it drops only the interview machinery (clarity breakdown, ontology convergence, transcript, scoring internals). **Read `presentation.md` in full now** and follow its contract; the single hard rule is that the presentation must never invent or contradict the spec (no invented "why", no merging spec-separate concerns, no fabricated concrete values, no diagram the spec did not draw). Author the presentation markdown at `$OMT_DIR/deep-interview/{slug}.presentation.md`, then render it to a single self-contained HTML file:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/render.ts --in $OMT_DIR/deep-interview/{slug}.presentation.md --out $OMT_DIR/deep-interview/{slug}.presentation.html
```

Fix any mermaid error and re-render until it succeeds. The presentation is derived and non-authoritative — the spec on disk is never rewritten to match it. Render its prose in the session's conversation language (same detect-at-render-time rule as the spec).

4. **Submit the HTML before announcing completion or offering any Phase 5 route.** The human-facing deliverable is HTML; presentation Markdown is only renderer input. Read [presentation.md](presentation.md) for the authoring contract and self-audit, then submit the completed render:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/deep-interview-state.ts submit-presentation --spec-path "$OMT_DIR/deep-interview/{slug}.md" --html-path "$OMT_DIR/deep-interview/{slug}.presentation.html"
bun ${CLAUDE_SKILL_DIR}/scripts/deep-interview-state.ts update --current-phase handoff
```

Use the actual saved spec path. Submission records `state.presentation` with source/HTML paths and content hashes; `handoff` and the completion hook require a current submission. Editing either file requires re-rendering and resubmission. On resume, check the submission before routing; legacy rich states with no submission are incomplete too. The same submission step applies to normal crystallization, execution deferral after closure, and every revised completed spec.

5. **Deliver the spec and HTML links, then emit the handoff token.** The literal `<deep-interview-done/>` signals completion only after submission succeeds. A rendered file on disk or a link in chat alone is not a state submission.

## Phase 5: Execution Bridge

If the user has already chosen to defer execution, deliver the spec and submitted HTML and finish after the handoff check; no execution question or downstream invocation is required. On resume, `update --current-phase handoff` is the current-submission check; `get` only displays records. A change to intermediate presentation Markdown also requires re-rendering and resubmission.

After the spec is written, read the state returned by `deep-interview-state.ts get`. Do not route until the preceding `update --output-shape` has succeeded and `state.output_shape` is present.

**Route only by the exact persisted `state.output_shape` value, never by vague prose, title, or a guessed route:**
- When `state.output_shape === "task-tickets"`, recommend **`craft-tasks`** to materialize team-facing task tickets and invoke `Skill(skill: "craft-tasks")` if selected.
- When `state.output_shape === "ai-execution-plan"`, keep the existing topology-based rule: exactly 1 active component → recommend **`ultragoal`** directly; otherwise (0 or ≥2 active components) → recommend **`prometheus`**, for feasibility/design review, plan-reliability review, and a human-readable plan that ultragoal can execute from. This count chooses only the default route; it does not determine the number of stories either skill will derive. The count is frozen at Round 0 with user confirmation, so the router never judges its own spec. A missing `topology` field is `legacy_missing`; Round 0 must run first rather than routing it here.
- When `state.output_shape === "domain-output"`, read the live available-skills list, identify the matching domain skill, and recommend/invoke that domain skill directly. Do not hardcode a skill catalog because the available skills change.
- If `state.output_shape` is missing or invalid, stop and return to output-shape confirmation; do not infer a route.
- **Rule 4:** Never recommend `sisyphus` directly — ultragoal uses it as the sole executor.

**Revision identity decision — state this before the handoff:** for a revision of an existing PM parent, state whether the established interview state was resumed/adopted or the current state was started with the established `interview_id` and `parent_id` using `--interview-id` and `--parent-id`. Before the handoff, read state and use the persisted `state.parent_id` when it is available. Never pair a newly generated UUID/anchor with an old known parent. If the established identity cannot be recovered, state explicitly that this is a new design, omit the old `parentId`, let `craft-tasks` resolve/create a parent by the new anchor, and do not claim it revises the old parent.

**`craft-tasks` parent handoff:** Carry the exact `designAnchor` from the spec Metadata unchanged into the downstream handoff:

```text
designAnchor: "design-anchor: deep-interview:<state.interview_id>"
parentId: "<known parent ID or URL, when available>"
```

The placeholder is replaced only with the persisted `state.interview_id`; never recompute it from the spec title, slug, timestamp, hash, or local session path. When a known PM parent exists, parentId MUST be copied from persisted `state.parent_id` when available; if it is known but not yet persisted, persist it with `update --parent-id` before constructing the handoff. When no parent is known, pass the spec and exact `designAnchor` alone and rely on `craft-tasks`' parent-resolution gate; this direct spec-only flow is valid. `craft-tasks` must resolve and verify the parent before reading or creating any child.

**Question:** "Your spec is ready (ambiguity: {score}%). How would you like to proceed?"

**Build the options like this** (recommended route first, tagged "(Recommended)", with a one-sentence rationale tied to THIS spec):
- The recommended route from the rules above (a team-facing task-ticket spec → `craft-tasks`, a domain skill directly, `ultragoal` for exactly 1 active component, or `prometheus` otherwise), tagged "(Recommended)" with its spec-tied rationale.
- When the spec calls for team-facing task tickets, offer **`craft-tasks`** as the recommended execution option; when tickets are not requested, use the active-component defaults above instead.
- Offer a domain skill as an override only if the spec plausibly maps to one.
- When `ultragoal` is recommended, offer `prometheus` as an explicit override.
- When `prometheus` is recommended, offer `ultragoal` as an explicit override.
- **Continue interviewing** — "Continue interviewing to improve clarity (current: {score}%)" → return to the Phase 2 loop.

Each execution option's Action: invoke `Skill(skill: "{chosen}")` with the spec file path as context (the `task-tickets` option invokes `Skill(skill: "craft-tasks")` and includes the persisted `state.parent_id` as `parentId` when available; the `ai-execution-plan` option invokes `Skill(skill: "prometheus")` or `Skill(skill: "ultragoal")` according to the active-component count; the `domain-output` option invokes the matching domain skill).

**IMPORTANT:** On execution selection, **MUST** invoke the chosen skill via `Skill()`. Do NOT implement directly. The deep-interview agent is a requirements agent, not an execution agent. Pass the spec file path forward (and the prompt-safe summary, if the initial context was summarized) — never the raw oversized source material.

</Steps>

<Tool_Usage>
- Use the runtime question tool for structured choices; use free text for open Socratic questions.
- Use `Agent(subagent_type="explore")` for brownfield codebase exploration (run BEFORE asking user about codebase)
- Use `librarian`/`ultraresearch` for external facts through Step 2-fact; keep its Scoped call budget separate from interview depth and preserve unavailable evidence as unknown.
- Use temperature 0.1 for a scoring call when its runtime exposes that setting. Otherwise keep the same scoring rubric and do not claim a temperature was configured.
- Use `bun ${CLAUDE_SKILL_DIR}/scripts/deep-interview-state.ts init` to initialize interview state (Phase-1 step 4)
- Use `bun ${CLAUDE_SKILL_DIR}/scripts/deep-interview-state.ts update` to update state after each round (Phase-2 step 2e)
- Use `bun ${CLAUDE_SKILL_DIR}/scripts/deep-interview-state.ts get` to read back state when resuming an interrupted session — check its `migration_status` field: `legacy_missing` means this state predates `topology` and Round 0 (step 3.7) must run before any further per-component scoring
- Use `Write` tool to save the final spec to `$OMT_DIR/deep-interview/{slug}.md`
- Use `Skill()` to bridge to execution modes — never implement directly
</Tool_Usage>

**Question-quality calibration examples (Good/Bad): read `deep-interview-examples.md` when calibrating or debugging question quality.** Reference it before crafting interview questions if your questions feel shallow or off-target.

<Escalation_And_Stop_Conditions>
The Closure Audit is the single transition rule. An unresolved contradiction reopens decisions; stalled understanding calls for a different concrete example, evidence source, or framing. User stop, delegation, and early delivery follow the User control paragraph there.
</Escalation_And_Stop_Conditions>

<Final_Checklist>
This is the normal-completion checklist. A paused interview or delivered DRAFT retains unfinished items and state for resume.
- [ ] Closure Audit passed: evidence-backed decisions, tested counterexamples, no open execution-changing gap, and shared understanding; early delivery is visibly DRAFT
- [ ] Oversized initial context/history was summarized before scoring, question generation, spec generation, or execution handoff
- [ ] Ambiguity score displayed after every round
- [ ] Each question names the decision it changes; the register persists dependencies, provenance, rejected alternatives, checks, and any reopened decisions
- [ ] Spec file written to `$OMT_DIR/deep-interview/{slug}.md`
- [ ] Inline self-review (6 checks: placeholder / consistency / scope / non-goal-decider / invariant / ambiguity) performed
- [ ] presentation authored per [presentation.md](presentation.md), rendered to `$OMT_DIR/deep-interview/{slug}.presentation.html`, submitted with `submit-presentation`, and accepted by `update --current-phase handoff` (current source/HTML hashes; self-audit passed)
- [ ] Spec includes: goal, constraints, invariants, acceptance criteria, Approach & Design Decisions, clarity breakdown, transcript
- [ ] Token `<deep-interview-done/>` emitted in the final assistant message before handoff
- [ ] Execution bridge presented via AskUserQuestion, or the user's execution deferral honored
- [ ] Selected execution mode invoked via Skill() when execution was selected (never direct implementation)
- [ ] State cleaned up only after completed handoff; unfinished draft/paused state preserved
- [ ] Brownfield confirmation questions cite repo evidence (file/path/pattern) before asking the user to decide
- [ ] Scope-fuzzy tasks can trigger ontology-style questioning to stabilize the core entity before feature elaboration
- [ ] Per-round component score table, weights, gaps, and ontology stability are displayed alongside changed decisions
- [ ] Spec decodes entities in ONE home — the Domain entity lens (type/fields beside its erDiagram), not a separate Ontology (Key Entities) table; scoring & convergence telemetry (Clarity Breakdown, Ontology Convergence, transcript) is confined to the Interview Audit `<details>` appendix, not interleaved with the downstream-consumed body
- [ ] `## Technical Context` heading carries no `(brownfield)`/`(greenfield)` qualifier
- [ ] Spec includes a Boundary Map: a dependency diagram (domains as subgraphs, direction marked) plus a placement table with domain and layer/role as separate columns, collaborators, affected/modified mark, and a Dependency direction verdict
</Final_Checklist>

**Advanced topics (resume, configuration, ambiguityThreshold, cross-session continuation, weights / score-interpretation tables): read `deep-interview-advanced.md` now** — do not guess at resume logic or configuration values from memory.

## Reference Files (on-demand)

Read these files at the moment indicated — not speculatively upfront.

| Reference file | What it contains | When to read |
|---|---|---|
| `deep-interview-spec-template.md` | The Phase 4 output spec markdown template | When composing the output spec (Phase 4 crystallize) |
| `deep-interview-examples.md` | Question-quality calibration examples (Good/Bad) | When calibrating or debugging question quality |
| `deep-interview-advanced.md` | Resume, configuration (ambiguityThreshold), cross-session continuation, and the weights / score-interpretation tables | When resuming, configuring, continuing across sessions, or needing the interpretation tables |
| `diagram-guide.md` | The 6-lens table with trigger FACTs, the coverage-table rule and its canonical status literals, the node cap, the post-draw self-audit, and mermaid-validity rules | Before authoring the spec's `## Diagrams` section (Phase 4 crystallize) |
| `presentation.md` | The presentation authoring contract (maintainer altitude — carries the spec's full design content + every diagram it drew, invent-nothing hard rule, gloss/diagram recipe, self-contained HTML format) | Before authoring the presentation (Phase 4 crystallize, after the spec is written) |

Task: {{ARGUMENTS}}

---
name: deep-interview
description: Socratic deep interview with mathematical ambiguity gating before autonomous execution
argument-hint: "<idea or vague description>"
handoff: $OMT_DIR/deep-interview/{slug}.md
level: 3
---

<Purpose>
Deep Interview implements Ouroboros-inspired Socratic questioning with mathematical ambiguity scoring. It replaces vague ideas with crystal-clear specifications by asking targeted questions that expose hidden assumptions, measuring clarity across weighted dimensions, and refusing to proceed until ambiguity drops below the resolved threshold for this run. The output feeds into an execution route chosen from the spec itself: **deep-interview → planning/execution via `goal`, or a directly matching domain skill for terminal domain outputs**, ensuring maximum clarity at every stage.
</Purpose>

<Use_When>
- User has a vague idea and wants thorough requirements gathering before execution
- User says "deep interview", "interview me", "ask me everything", "don't assume", "make sure you understand"
- User says "ouroboros", "socratic", "I have a vague idea", "not sure exactly what I want"
- User wants to avoid "that's not what I meant" outcomes from autonomous execution
- Task is complex enough that jumping to code would waste cycles on scope discovery
- User wants mathematically-validated clarity before committing to execution
- User wants every design decision interrogated with alternatives before building -- not just requirements clarified
</Use_When>

<Do_Not_Use_When>
- User has a detailed, specific request with file paths, function names, or acceptance criteria -- execute directly
- User wants a quick fix or single change -- delegate to executor or sisyphus-junior
- User says "just do it" or "skip the questions" -- respect their intent
- User already has a PRD or plan file -- use prometheus or sisyphus with that plan
</Do_Not_Use_When>

<Why_This_Exists>
AI can build anything. The hard part is knowing what to build. Deep Interview applies Socratic methodology to iteratively expose assumptions and mathematically gate readiness, ensuring the AI has genuine clarity before spending execution cycles.

Inspired by the [Ouroboros project](https://github.com/Q00/ouroboros) which demonstrated that specification quality is the primary bottleneck in AI-assisted development.
</Why_This_Exists>

<Execution_Policy>
- Ask ONE question at a time -- never batch multiple questions
- Target the WEAKEST clarity dimension with each question
- Make weakest-dimension targeting explicit every round: name the weakest dimension, state its score/gap, and explain why the next question is aimed there
- Gather facts BEFORE asking the user about them (facts-before-judgment): `explore` for codebase facts, and `librarian`/`ultraresearch` for external facts a dimension turns on. The in-interview `librarian`/`ultraresearch` call is tier-capped at **Scoped (≤3 workers)** and **de-duplicated per dimension** (do not re-call for a dimension already grounded). When `ultraresearch` is unavailable (call fails or absent), gracefully degrade to the existing `explore`-only path — never block the round on it.
- For brownfield confirmation questions, cite the repo evidence that triggered the question (file path, symbol, or pattern) instead of asking the user to rediscover it
- Tag every evidence item by its ORIGIN at record time (provenance is assigned where evidence enters, never reconstructed later) and persist it in the `evidence_provenance` state field. Origin→label assignment: a codebase read → `[from-code]`; a codebase read confirmed by executed code → `[from-code][auto-confirmed]`; a `librarian`/`ultraresearch` external fact → `[from-research]`; a user answer → `[from-user]`. Append each item via the state CLI:
  ```bash
  bun ${CLAUDE_SKILL_DIR}/scripts/deep-interview-state.ts update \
    --append-provenance-item '{"evidence_id":"<id>","label":"<one-of-the-four-labels>"}'
  ```
- Score ambiguity after every answer -- display the score transparently
- Keep prompt payloads budgeted: summarize or trim oversized initial context/history before composing question, scoring, spec, or handoff prompts
- If the user's initial context is oversized, create a concise prompt-safe summary first and wait for that summary before ambiguity scoring, question generation, or downstream execution handoff
- Do not proceed to execution until ambiguity ≤ the resolved threshold for this run
- Allow early exit with a clear warning if ambiguity is still high
- Persist interview state for resume across session interruptions
- Challenge agents activate at specific round thresholds to shift perspective
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
   - Surface the full enumerated list to the user via `AskUserQuestion`: name each component, describe how it relates to the others, and ask the user to **confirm** the list, **add** a component you missed, **merge** two that are really one, or **defer** a component out of this interview's scope.
   - Lock the confirmed list into state — every enumerated component, active or deferred, is recorded:
     ```bash
     bun ${CLAUDE_SKILL_DIR}/scripts/deep-interview-state.ts set-topology \
       --json '[{"id":"<id>","name":"<name>","status":"active|deferred"}]'
     ```
   - Every named component is either **active** (scored across all 6 dimensions in Phase 2) or explicitly **deferred** (visible in `state.topology`, excluded from active-component floor pressure) — never silently dropped.
   - **Resume + legacy migration (topology-floor-evolution Stage 6, UC11)**: when resuming an interrupted session, `deep-interview-state.ts get`'s output carries a `migration_status` field derived from `computeTopologyMigrationStatus`. If `migration_status` is `legacy_missing` — this state predates the `topology` field entirely, never having run Round 0 — run this Round 0 gate now, before any further per-component scoring write, even if the resumed state already has rounds or a scored ambiguity from before topology existed. `current` means topology is already locked; resume straight into Phase 2 as usual.
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

> Starting deep interview. I'll ask targeted questions to understand your idea thoroughly before building anything. After each answer, I'll show your clarity score. We'll proceed to execution once ambiguity drops below <resolvedThresholdPercent>.
>
> **Your idea:** "{initial_idea}"
> **Project type:** {greenfield|brownfield}
> **Current ambiguity:** 100% (we haven't started yet)

## Phase 2: Interview Loop

Repeat until `ambiguity ≤ threshold`; when the threshold is reached, run the residual-ambiguity seam (Step 2-exit, below) to decide whether to keep clarifying requirements or move on to the Design Interview phase. User-forced early exits (hard-cap, early-exit) and a literal user stop/cancel/abort are handled by the seam itself, as described there.

### Step 2-exit: Residual-Ambiguity Seam

This is the single reusable stopping-and-checking pattern used at every phase exit in this skill — defined once here, referenced by both the requirements-threshold exit (Step 2d, below) and the design-completion exit (Design Interview phase, below). Do not bare-announce completion at either exit. Instead:

**Closure Guard (precondition):** before running steps 1-2 below, check every active topology component's `clarity_scores` in state. If any active component still carries an unscored (`null`) dimension, convergence cannot be declared — loop back into the interview loop targeting that component's weakest (unscored) dimension instead of running this seam. An `ambiguity ≤ threshold` reading that ignores an unscored sibling component is not real convergence; it means the interview has not yet asked, not that there is nothing left to ask.

This precondition is enforced in code, not just here: the Stop-hook refuses a `<deep-interview-done/>` token while any active component still carries an unscored dimension, independent of the ambiguity reading and of whichever threshold this run resolved. Emitting the token early does not end the interview — it loops you back.

**Closure Guard (non-goal decider precondition):** also check, before running steps 1-2 below, whether the interview has secured at least one non-goal carrying a decider — an excluded item paired with a way to tell whether a given finding falls inside it, the same `{excluded item} | decider: {...}` shape the Phase 4 template's Non-Goals section requires. If zero non-goal-with-decider pairs exist yet, convergence cannot be declared either — loop back into the interview loop and ask for one, regardless of what the ambiguity reading says: this is a categorical precondition, not a term folded into the ambiguity arithmetic. The check is existence-only — it asks whether a decider was stated, never how precise it is; grading precision here would turn a mechanical gate into an interpretation dispute.

1. Reflect the residual ambiguity that remains — name any unresolved gap, weak dimension, or open design point, however small, instead of declaring the interview simply "done".
2. Ask the user, via `AskUserQuestion`, whether to continue (keep clarifying requirements, or keep resolving design branches) or proceed to the next phase.

User-forced early exits (hard-cap, early-exit) skip the interactive question and proceed directly, folding the residual ambiguity into the spec's risk-note instead. A literal user stop/cancel/abort halts and saves state for resume, crystallizing no spec.

### Step 2-head: Dialectic Rhythm Guard (pre-question stance selector)

At the HEAD of every round — before generating the question — select this round's **stance** via the rotation rules below, then record it in the ordered `stance_history` field (D-E). This selector is the SINGLE owner of stance selection: it subsumes the previously ad-hoc Ontologist triggers so there are no longer two paths to the same stance.

The five stances are EXISTING behaviors made explicit, not new agent modes:
- **Clarify** — normal Socratic weakest-dimension questioning (the default round posture; Step 2a).
- **Fact-ground** — the facts-before-judgment `explore`-or-`librarian`/`ultraresearch` call (the Execution_Policy dispatch), run instead of a user question when the weakest dimension turns on a discoverable fact.
- **Contrarian** — challenge the core assumption (Phase 3, Round 4+).
- **Simplifier** — probe whether complexity can be removed (Phase 3, Round 6+).
- **Ontologist** — find the essence by examining the ontology (Phase 3).

**Rotation rules** (evaluated in order; the first match selects the stance):
1. **Fact-ground rule** — if the weakest dimension turns on a fact not yet grounded for that dimension, select **Fact-ground** (deduped per dimension — never re-ground an already-grounded dimension).
2. **Stall rotation rule** → **Ontologist** — if ambiguity has stayed within ±0.05 for 3 rounds (the legacy stall trigger, formerly `<Escalation_And_Stop_Conditions>`), select **Ontologist** to reframe.
3. **Late-stage rotation rule** → **Ontologist** — if Round ≥ 8 AND ambiguity > 0.3 (the legacy late-stage trigger, formerly Phase 3 Round 8+), select **Ontologist**.
4. **Contrarian rule** — at Round 4+, if not yet used, select **Contrarian** once.
5. **Simplifier rule** — at Round 6+, if not yet used, select **Simplifier** once.
6. **Default** — otherwise select **Clarify**.

Both Ontologist rotation rules (2 and 3) resolve to the SAME Ontologist stance; neither is dropped — they are the two named entry points to Ontologist, each preserved.

Record the selected stance at round head — ordered, NOT deduped (it tracks the sequence, so the same stance may appear more than once):

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/deep-interview-state.ts update \
  --append-stance "<selected-stance>"
```

`stance_history` is distinct from `challenge_modes_used` (which stays deduped/unordered for its existing once-each tracking of Contrarian/Simplifier/Ontologist).

**Branch on the selected stance:** if the selector chose **Fact-ground**, run **Step 2-fact** below and then return to the loop head for the next round — do NOT fall through to Step 2a (a fact-grounding round produces a fact, not a user answer, so the user-answer-assuming steps 2a–2e do not apply). For all four other stances (Clarify / Contrarian / Simplifier / Ontologist), continue to Step 2a as normal.

### Step 2-fact: Fact-ground Round (no user question)

Taken ONLY when the selector chose Fact-ground. This round dispatches a research call instead of asking the user, then folds the new fact into the ambiguity score — there is no `AskUserQuestion`, no user answer.

1. **Dispatch the facts-before-judgment call** for the weakest dimension's ungrounded fact, following the Execution_Policy dispatch rules: `explore` for codebase facts; `librarian`/`ultraresearch` (tier-capped at **Scoped (≤3 workers)**, de-duplicated per dimension) for external facts; gracefully degrade to the `explore`-only path when `ultraresearch` is unavailable.
2. **Record the fact's provenance** via the existing CLI — label by origin (`[from-research]` for a `librarian`/`ultraresearch` external fact; `[from-code]` for a codebase read; `[from-code][auto-confirmed]` if confirmed by executed code):

   ```bash
   bun ${CLAUDE_SKILL_DIR}/scripts/deep-interview-state.ts update \
     --append-provenance-item '{"evidence_id":"<id>","label":"<one-of-[from-research]|[from-code]|[from-code][auto-confirmed]>"}'
   ```
3. **Re-score ambiguity** with the new fact folded into the scoring context (same Step 2c scoring prompt and ambiguity formula), but WITHOUT any user Q&A — the transcript gains a grounding event, not a user exchange. Mark the dimension's fact as grounded so the per-dimension dedup (rotation rule #1) does not re-ground it.
4. **Report progress** as in Step 2d, noting that this round was a grounding event (no user question asked).
5. **Append the round in a fact-derived shape** — mark it a grounding event rather than a user Q&A exchange. Do NOT stuff the fact into the `answer` field as if a user said it; omit `question`/`answer` and record the grounded fact and its provenance label instead, scoped to the one component this grounding round improves:

   ```bash
   bun ${CLAUDE_SKILL_DIR}/scripts/deep-interview-state.ts update \
     --append-round-stdin <<'OMT_DI_PAYLOAD_EOF'
   {"n":<round_number>,"kind":"fact-ground","component":"<component_id>","dimension":"<weakest_dimension>","fact":"<grounded fact>","provenance":"<one-of-the-four-labels>","scores":{"intent":<intent>,"outcome":<outcome>,"scope":<scope>,"constraints":<constraints>,"success":<success>,"context":<context>},"ambiguity":<ambiguity>}
   OMT_DI_PAYLOAD_EOF

   bun ${CLAUDE_SKILL_DIR}/scripts/deep-interview-state.ts update \
     --current-phase "deep-interview" \
     --current-ambiguity <ambiguity>
   ```

   `context` is always included in the `scores` object — every component, every round, unconditionally — exactly as Step 2e does. The `--append-round-stdin` payload accepts any valid JSON shape, so the fact-derived `kind:"fact-ground"` round persists alongside user Q&A rounds without a schema change. This `component`+`scores` payload also updates that component's `clarity_scores` in state — the write that lets the Closure Guard and the ambiguity floor's unscored count actually drop as scoring rounds land, not just the fact-ground round shown here.
6. **Return to the loop head** (Step 2-head) for the next round. The fact-ground round is now part of the transcript and counts toward the soft/hard round limits in Step 2f.

### Step 2a: Generate Next Question

Build the question generation prompt with:
- The prompt-safe initial-context summary (if one was created), otherwise the user's original idea
- Prior Q&A rounds trimmed or summarized to fit the prompt budget while preserving decisions, constraints, unresolved gaps, and ontology changes
- Current clarity scores per dimension (which is weakest?)
- Challenge agent template for the stance chosen at Step 2-head (Contrarian / Simplifier / Ontologist -- inject the matching Phase 3 template; for Clarify, no template)
- Brownfield codebase context (if applicable), summarized to cited paths/symbols/patterns instead of raw dumps

If any prompt input is too large, summarize it first and then continue from the summary. Do not ask the next `AskUserQuestion`, score ambiguity, or hand off to execution from an over-budget raw transcript.

**Question targeting strategy:**
- Identify the dimension with the LOWEST clarity score
- Generate a question that specifically improves that dimension
- State, in one sentence before the question, why this dimension is now the bottleneck to reducing ambiguity
- Questions should expose ASSUMPTIONS, not gather feature lists
- If the scope is still conceptually fuzzy (entities keep shifting, the user is naming symptoms, or the core noun is unstable), switch to an ontology-style question that asks what the thing fundamentally IS before returning to feature/detail questions

**Question styles by dimension:**
| Dimension | Question Style | Example |
|-----------|---------------|---------|
| Intent Clarity | "What exactly happens when...?" | "When you say 'manage tasks', what specific action does a user take first?" |
| Outcome Clarity | "What does done look like?" | "If this shipped tomorrow, what would exist that doesn't exist today?" |
| Scope Clarity | "What's in vs out?" | "Is user authentication part of this feature, or a separate concern to build later?" |
| Constraint Clarity | "What are the boundaries?" | "Should this work offline, or is internet connectivity assumed?" |
| Success Criteria | "How do we know it works?" | "If I showed you the finished product, what would make you say 'yes, that's it'?" |
| Context Clarity | "How does this fit?" | "I found JWT auth middleware in `src/auth/` (pattern: passport + JWT). Should this feature extend that path or intentionally diverge from it?" |
| Scope-fuzzy / ontology stress | "What IS the core thing here?" | "You have named Tasks, Projects, and Workspaces across the last rounds. Which one is the core entity, and which are supporting views or containers?" |
| Non-Goal Decider | "How would you tell a finding belongs to that exclusion?" | "You said this feature won't handle refunds. If a bug report comes in about a failed charge, how would you decide whether it's a refund case you're excluding, or a charge case that's in scope?" |

**Scope Over-Engineering Guard:** if a component's `scope` dimension is unscored (`null`) or scored below 0.5, the very next question for that component MUST be a boundary question — what's in vs what's out for this component — before any other dimension is targeted, even if another dimension scores lower. This guard exists to block gold-plating: a component is never considered understood while its boundary is still fuzzy, no matter how clear its other five dimensions look.

### Step 2b: Ask the Question

Use `AskUserQuestion` with the generated question. Present it clearly with the current ambiguity context:

```
Round {n} | Targeting: {weakest_dimension} | Why now: {one_sentence_targeting_rationale} | Ambiguity: {score}%

{question}
```

Options should include contextually relevant choices plus free-text.

### Step 2c: Score Ambiguity

After receiving the user's answer, score clarity **per active topology component** — every component in `state.topology.components` with `status:"active"` gets its own score across the same 6 dimensions below. A component's high scores never average away or hide a sibling component's gaps: an unscored sibling still holds the interview back (Closure Guard, Step 2-exit).

**Scoring prompt** (run once per active component that has at least one unscored dimension; temperature 0.1 for consistency):

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
- weakest_dimension_rationale: one sentence explaining why it is the highest-leverage target for the next question

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

**Next target:** {weakest_component} / {weakest_dimension} — {weakest_dimension_rationale}

{overall_ambiguity <= threshold && every active component fully scored ? "Threshold met — reflecting residual ambiguity via the Step 2-exit seam before proceeding." : "Focusing next question on: {weakest_component} / {weakest_dimension}"}
```

### Step 2e: Update State

Update interview state with the new round and scores by invoking the CLI twice — once to record the round, once to advance the phase and ambiguity. Every round scores exactly one component and always includes `context` — there is no separate brownfield-only variant, because context is scored every round, for every component, unconditionally:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/deep-interview-state.ts update \
  --append-round-stdin <<'OMT_DI_PAYLOAD_EOF'
{"n":<round_number>,"component":"<component_id>","question":"<question>","answer":"<answer>","scores":{"intent":<intent>,"outcome":<outcome>,"scope":<scope>,"constraints":<constraints>,"success":<success>,"context":<context>},"ambiguity":<ambiguity>}
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

### Step 2f: Check Soft Limits

- **Round 3+**: Allow early exit if user says "enough", "let's go", "build it"
- **Round 10**: Show soft warning: "We're at 10 rounds. Current ambiguity: {score}%. Continue or proceed with current clarity?"
- **Round 20**: Hard cap: "Maximum interview rounds reached. Proceeding with current clarity level ({score}%)."

## Phase 3: Challenge Agent Prompt Templates

These are the prompt-injection bodies for the Contrarian / Simplifier / Ontologist stances. They do NOT self-fire: the Step 2-head Dialectic Rhythm Guard is the sole gate that selects a stance (its rotation rules already encode the round/ambiguity conditions). When the selector chooses one of these stances, inject the matching template into the Step 2a question-generation prompt.

### Contrarian template
When the selector at Step 2-head selects **Contrarian**, inject:
> You are now in CONTRARIAN mode. Your next question should challenge the user's core assumption. Ask "What if the opposite were true?" or "What if this constraint doesn't actually exist?" The goal is to test whether the user's framing is correct or just habitual.

### Simplifier template
When the selector at Step 2-head selects **Simplifier**, inject:
> You are now in SIMPLIFIER mode. Your next question should probe whether complexity can be removed. Ask "What's the simplest version that would still be valuable?" or "Which of these constraints are actually necessary vs. assumed?" The goal is to find the minimal viable specification.

### Ontologist template
When the selector at Step 2-head selects **Ontologist** (via either Ontologist rotation rule — stall or late-stage), inject:
> You are now in ONTOLOGIST mode. We may be addressing symptoms rather than the core problem. The tracked entities so far are: {current_entities_summary from latest ontology snapshot}. Ask "What IS this, really?" or "Looking at these entities, which one is the CORE concept and which are just supporting?" The goal is to find the essence by examining the ontology.

Contrarian and Simplifier are used ONCE each (the selector's rules #4/#5 enforce this via `challenge_modes_used`), then normal Socratic questioning resumes. Track which modes have been used by invoking:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/deep-interview-state.ts update \
  --challenge-mode "<mode-name>"
```

(Duplicate names are silently deduped; safe to call even if the mode was already recorded.)

## Design Interview

Once Phase 2 exits (via the residual-ambiguity seam, above) toward design work, interrogate the design **relentlessly** — probe **every aspect** of the design until reaching **shared understanding** with the user, going beyond requirements clarity.

**Interrogate every open design decision, one at a time, in dependency order.** Walk the design tree from its root — settle a decision that gates others before the branches that depend on it (an upstream answer can reshape or delete a downstream one's alternatives); never batch. Put each genuinely-open decision to the user (via `AskUserQuestion`) with **2-3 alternatives** and your reasoned recommendation among them — every real decision, including low-stakes, cheap-to-reverse ones, not just the hardest. Before asking, check whether the codebase already settles it; if so, run `explore` and fold the finding in rather than making the user rediscover it.

**Red flags — you're about to swallow a decision:**
- *"User's in a hurry — batch the rest into one question"*
- *"This one's low-risk / reversible — apply a default, let them veto"*
- *"The sketch already covers it — close enough to settled"*

All mean STOP. Under pressure you still put **every** open decision to the user with its real alternatives and a reasoned recommendation — pressure never thins the alternatives or skips the decision. The only thing settled without a question is a path the codebase or an external constraint **forces** onto a single path — a **fact** (ground it with `explore`/`librarian`; don't manufacture a **strawman** alternative around a forced path), not one you deem low-risk. An explicit early-exit (Step 2f) still exits.

**Persist each decision to state:** after the user answers a design question (or a forced point is fact-grounded), append the decision to interview state *before* moving to the next question — the same mechanism Step 2e and Step 2-fact use, so the resume path (`get`/`adopt`) and Phase 4 crystallization recover the chosen alternatives even across a session interruption. Without this, the decision lives only in the in-context transcript and is lost on cross-session resume. The existing `--append-round-stdin` accepts this shape with no schema change (exactly as the `fact-ground` round does), marked as a design round so it is distinguishable from requirements Q&A:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/deep-interview-state.ts update \
  --append-round-stdin <<'OMT_DI_PAYLOAD_EOF'
{"n":<round_number>,"kind":"design","decision":"<design question>","choice":"<chosen alternative>","alternatives":[<offered alternatives>],"rationale":"<why chosen>"}
OMT_DI_PAYLOAD_EOF
```

The same JSON-encoding rule as Step 2e applies: the heredoc guards shell quoting only; all substituted string values must be JSON-encoded (`\"`, `\\`, newlines as `\n`).

Continue this loop until **all design branches** are resolved — no open decision, alternative, or design-facing gap remains.

**Design-completion exit:** when all design branches are resolved, do not bare-announce completion. Run the residual-ambiguity seam (Step 2-exit, above): reflect the residual ambiguity left in the design (any unresolved tension, edge case, or soft spot), then ask the user via `AskUserQuestion` whether to continue resolving design branches or proceed to Phase 4 (Crystallize).

## Phase 4: Crystallize Spec

When the Design Interview phase has exited with all design branches resolved, or when a user-forced escape hatch fires:

1. **Generate the specification** with the prompt-safe transcript, using the design decisions recorded during the Design Interview phase for the Approach section; on a user-forced escape hatch, include any unresolved requirements gap or design branch as a risk-note instead. **Spec template: you MUST read `deep-interview-spec-template.md` now, before composing the spec.** Do not write the spec from memory.

**Diagram-authoring guidance**: **you MUST read `diagram-guide.md` in full before authoring the spec's `## Diagrams` section.** Author the 6-row coverage table using the canonical literals verbatim — header `| Lens | Trigger FACT | Status |`, and per-row status of either `drawn` or `trigger FALSE: <reason>` (these are control-plane tokens; never translate or paraphrase them). Draw every lens whose trigger FACT holds. Each diagram follows the Why → Diagram → Interpretation format. All mermaid fences live inside the `## Diagrams` section (fence-locality) — no mermaid block appears outside it.

2. **Write to file**: `$OMT_DIR/deep-interview/{slug}.md`

**Inline self-review** (after writing), 5 checks: placeholder / consistency / scope / non-goal-decider / ambiguity — confirm no unfilled placeholders, no section contradictions, full interview coverage, every Non-Goals bullet carries a decider, no ambiguous text remains.

3. **Emit the handoff token** in the final assistant message before proceeding to Phase 5. The literal token `<deep-interview-done/>` must appear in the assistant turn that announces spec completion. This signals downstream hooks that the interview phase is complete and state cleanup may proceed.

## Phase 5: Execution Bridge

After the spec is written, choose the recommended execution route from the spec's own characteristics, and present options via `AskUserQuestion`.

**Recommend the route by judging the spec you just wrote — its output shape and how much HOW-uncertainty the interview left open:**
- If the spec's output maps cleanly to a single domain skill available in this session (e.g., documentation → `technical-writing`, slides → `create-slides`), recommend that skill **directly** — this terminal domain output bypasses `goal` (it needs no planning/execution orchestration). Read the live available-skills list to find the match — do NOT hardcode a skill catalog here, because the available skills change.
- Else (the remaining work is planning and/or multi-step execution — code that benefits from AC-gated planning, or settled multi-step orchestration), recommend handing the spec to **`goal`**, which pursues the objective through planning/execution downstream. Do NOT recommend prometheus or sisyphus directly for planning/execution work; hand it to `goal` instead.

`goal` is the recommended destination for planning/execution work rather than prometheus or sisyphus directly. Do not reflexively pre-pick prometheus vs sisyphus here — its core value, requirements clarification, is exactly what this phase already delivered, and `goal` determines the downstream path from the spec it receives.

**Question:** "Your spec is ready (ambiguity: {score}%). How would you like to proceed?"

**Build the options like this** (recommended route first, tagged "(Recommended)", with a one-sentence rationale tied to THIS spec):
- The recommended route from the rule above (a domain skill directly, or `goal` for planning/execution work).
- When the recommended route is `goal`, also offer a domain skill as the override only if the spec plausibly maps to one. When the recommended route is a domain skill, offer `goal` as the override (so planning/execution can still be chosen). Planning/execution work always goes to `goal` — never offer prometheus or sisyphus as direct options here.
- **Continue interviewing** — "Continue interviewing to improve clarity (current: {score}%)" → return to the Phase 2 loop.

Each execution option's Action: invoke `Skill(skill: "{chosen}")` with the spec file path as context (the planning/execution option invokes `Skill(skill: "goal")`).

**IMPORTANT:** On execution selection, **MUST** invoke the chosen skill via `Skill()`. Do NOT implement directly. The deep-interview agent is a requirements agent, not an execution agent. Pass the spec file path forward (and the prompt-safe summary, if the initial context was summarized) — never the raw oversized source material.

</Steps>

<Tool_Usage>
- Use `AskUserQuestion` for each interview question — provides clickable UI with contextual options
- Use `Agent(subagent_type="explore")` for brownfield codebase exploration (run BEFORE asking user about codebase)
- Use `librarian`/`ultraresearch` for the facts-before-judgment external-fact call when a dimension turns on external knowledge — tier-capped at **Scoped (≤3 workers)**, **de-duplicated per dimension**, and **gracefully degrading to the `explore`-only path** when `ultraresearch` is unavailable (call failure or absence). This is a bounded subroutine inside the round loop, NOT full saturation research.
- Use temperature 0.1 for ambiguity scoring — consistency is critical
- Use `bun ${CLAUDE_SKILL_DIR}/scripts/deep-interview-state.ts init` to initialize interview state (Phase-1 step 4)
- Use `bun ${CLAUDE_SKILL_DIR}/scripts/deep-interview-state.ts update` to update state after each round (Phase-2 step 2e)
- Use `bun ${CLAUDE_SKILL_DIR}/scripts/deep-interview-state.ts get` to read back state when resuming an interrupted session — check its `migration_status` field: `legacy_missing` means this state predates `topology` and Round 0 (step 3.7) must run before any further per-component scoring
- Use `Write` tool to save the final spec to `$OMT_DIR/deep-interview/{slug}.md`
- Use `Skill()` to bridge to execution modes — never implement directly
- Challenge agent modes are prompt injections, not separate agent spawns
</Tool_Usage>

**Question-quality calibration examples (Good/Bad): read `deep-interview-examples.md` when calibrating or debugging question quality.** Reference it before crafting interview questions if your questions feel shallow or off-target.

<Escalation_And_Stop_Conditions>
- **Hard cap at 20 rounds**: Proceed with whatever clarity exists, noting the risk
- **Soft warning at 10 rounds**: Offer to continue or proceed
- **Early exit (round 3+)**: Allow with warning if ambiguity > threshold
- **User says "stop", "cancel", "abort"**: Stop immediately, save state for resume
- **Ambiguity stalls** (same score +-0.05 for 3 rounds): handled by the Step 2-head Dialectic Rhythm Guard stall rotation rule (selects Ontologist) — no separate activation here
- **Threshold reached**: `ambiguity ≤ threshold` routes to the residual-ambiguity seam (Step 2-exit) rather than straight to Phase 4 — the seam decides whether to keep clarifying requirements or move to the Design Interview phase.
- **All dimensions at 0.9+**: Route through the residual-ambiguity seam (Step 2-exit) the same as ordinary threshold-reached handling.
- **Codebase exploration fails**: Proceed as greenfield, note the limitation
</Escalation_And_Stop_Conditions>

<Final_Checklist>
- [ ] Interview completed (ambiguity ≤ threshold with all design branches resolved via the Design Interview phase, OR user chose early exit)
- [ ] Oversized initial context/history was summarized before scoring, question generation, spec generation, or execution handoff
- [ ] Ambiguity score displayed after every round
- [ ] Every round explicitly names the weakest dimension and why it is the next target
- [ ] Challenge stances selected by the Step 2-head Dialectic Rhythm Guard at the correct rotation conditions (Contrarian round 4+, Simplifier round 6+, Ontologist on stall or round 8+ with ambiguity > 0.3)
- [ ] Spec file written to `$OMT_DIR/deep-interview/{slug}.md`
- [ ] Inline self-review (5 checks: placeholder / consistency / scope / non-goal-decider / ambiguity) performed
- [ ] Spec includes: goal, constraints, acceptance criteria, Approach & Design Decisions, clarity breakdown, transcript
- [ ] Token `<deep-interview-done/>` emitted in the final assistant message before handoff
- [ ] Execution bridge presented via AskUserQuestion
- [ ] Selected execution mode invoked via Skill() (never direct implementation)
- [ ] State cleaned up after execution handoff
- [ ] Brownfield confirmation questions cite repo evidence (file/path/pattern) before asking the user to decide
- [ ] Scope-fuzzy tasks can trigger ontology-style questioning to stabilize the core entity before feature elaboration
- [ ] Per-round ambiguity report includes Ontology row with entity count and stability ratio
- [ ] Spec includes Ontology (Key Entities) table and Ontology Convergence section
</Final_Checklist>

**Advanced topics (resume, configuration, ambiguityThreshold, cross-session continuation, weights / challenge-modes / score-interpretation tables): read `deep-interview-advanced.md` now** — do not guess at resume logic or configuration values from memory.

## Reference Files (on-demand)

Read these files at the moment indicated — not speculatively upfront.

| Reference file | What it contains | When to read |
|---|---|---|
| `deep-interview-spec-template.md` | The Phase 4 output spec markdown template | When composing the output spec (Phase 4 crystallize) |
| `deep-interview-examples.md` | Question-quality calibration examples (Good/Bad) | When calibrating or debugging question quality |
| `deep-interview-advanced.md` | Resume, configuration (ambiguityThreshold), cross-session continuation, and the weights / challenge-modes / score-interpretation tables | When resuming, configuring, continuing across sessions, or needing the interpretation tables |
| `diagram-guide.md` | The 6-lens table with trigger FACTs, the coverage-table rule and its canonical status literals, the node cap, the post-draw self-audit, and mermaid-validity rules | Before authoring the spec's `## Diagrams` section (Phase 4 crystallize) |

Task: {{ARGUMENTS}}

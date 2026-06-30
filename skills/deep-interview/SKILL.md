---
name: deep-interview
description: Socratic deep interview with mathematical ambiguity gating before autonomous execution
argument-hint: "<idea or vague description>"
handoff: $OMT_DIR/deep-interview/{slug}.md
level: 3
---

<Purpose>
Deep Interview implements Ouroboros-inspired Socratic questioning with mathematical ambiguity scoring. It replaces vague ideas with crystal-clear specifications by asking targeted questions that expose hidden assumptions, measuring clarity across weighted dimensions, and refusing to proceed until ambiguity drops below the resolved threshold for this run. The output feeds into an execution route chosen from the spec itself: **deep-interview → planning/execution via `goal` (which orchestrates prometheus/sisyphus downstream), or a directly matching domain skill for terminal domain outputs**, ensuring maximum clarity at every stage.
</Purpose>

<Use_When>
- User has a vague idea and wants thorough requirements gathering before execution
- User says "deep interview", "interview me", "ask me everything", "don't assume", "make sure you understand"
- User says "ouroboros", "socratic", "I have a vague idea", "not sure exactly what I want"
- User wants to avoid "that's not what I meant" outcomes from autonomous execution
- Task is complex enough that jumping to code would waste cycles on scope discovery
- User wants mathematically-validated clarity before committing to execution
- User knows roughly WHAT they want but a load-bearing design approach (HOW) is unresolved -- multiple viable, costly-to-change approaches must be decided before the spec is actionable
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
3.7. **Detect multi-subsystem mega-idea (propose-only decomposition gate)**:
   - Assess whether the parsed idea spans ≥2 independent subsystems — two subsystems are independent when neither forces the other to be built first (cross-cutting integration glue such as webhooks, shared identity, or event wiring is NOT a build-order dependency, and a suggested interview/build order is not one either). Judge this for brownfield from both the user's framing and the step-3 explore summary (codebase coupling); for greenfield (no explore), judge it from the idea prose alone.
   - If yes: PROPOSE a decomposition — name each subsystem, describe how they relate, and suggest an interview order — then ask the user which subsystem to address first via `AskUserQuestion`. Interview ONLY that first subsystem in this session. Do NOT auto-split into multiple specs and do NOT add any new state fields; this gate is propose-only and narrows the scope to one slice before continuing.
   - If no (single-system scope): continue without decomposition.
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

Repeat until `ambiguity ≤ threshold`; when the threshold is reached, run the how-readiness gate check before exiting Phase 2: if no unresolved load-bearing HOW-decision exists, proceed to Phase 4; if one exists, run the Design-fork detection gate below, record the chosen approach, then proceed to Phase 4. User-forced exits bypass this gate and carry any unresolved fork into the spec risk-note.

### Step 2-exit: Design-fork detection gate

Run this ONLY after `ambiguity ≤ threshold` and before Phase 2 exits. This design-fork detection is orthogonal to the Step-2 stance selector: scan the accumulated interview state and transcript summary for load-bearing design forks — multiple viable approaches that are costly-to-change or cross-cutting. Trivial and single-approach situations clear the how-readiness gate without daedalus. On a load-bearing fork, dispatch `daedalus` with the evidence block defined below — `daedalus` is a consultation helper reserved for DIFFICULT or COMPLEX load-bearing forks (hard cross-cutting choices that warrant steelman antithesis and tradeoff tension analysis); routine multi-viable forks that arose during the interview are resolved in-loop via Step 2-alt (below) and do NOT reach this gate. Present the recommended approach via `AskUserQuestion` (tag "(Recommended)"), record the chosen approach for the spec's Approach section, then treat the how-readiness gate as clear for Phase 4. A user instruction to be quick or not over-think the design is NOT a user-forced escape hatch unless it is a literal stop/abort/early-exit signal; when the threshold was met on the normal path, resolve the load-bearing fork via the single daedalus + AskUserQuestion step (which already honors the hurry) rather than bypassing it.

```
## Evidence
- State JSON: output of `bun ${CLAUDE_SKILL_DIR}/scripts/deep-interview-state.ts get`
- Interview packet prepared by the main agent: prompt-safe transcript summary, explicit user decisions, unresolved HOW-fork candidates, constraints, success criteria, ontology snapshots, and relevant evidence provenance labels.

## Focus
- Enumerate 2–3 viable approaches for the unresolved HOW-fork; steelman each.
- Surface tradeoff tensions and costly-to-change consequences.
- Recommend one approach with rationale, using only the evidence packet and state JSON above.
```

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
5. **Append the round in a fact-derived shape** — mark it a grounding event rather than a user Q&A exchange. Do NOT stuff the fact into the `answer` field as if a user said it; omit `question`/`answer` and record the grounded fact and its provenance label instead:

   ```bash
   bun ${CLAUDE_SKILL_DIR}/scripts/deep-interview-state.ts update \
     --append-round-stdin <<'OMT_DI_PAYLOAD_EOF'
   {"n":<round_number>,"kind":"fact-ground","dimension":"<weakest_dimension>","fact":"<grounded fact>","provenance":"<one-of-the-four-labels>","scores":{"goal":<g>,"constraints":<c>,"criteria":<cr>},"ambiguity":<ambiguity>}
   OMT_DI_PAYLOAD_EOF

   bun ${CLAUDE_SKILL_DIR}/scripts/deep-interview-state.ts update \
     --current-phase "deep-interview" \
     --current-ambiguity <ambiguity>
   ```

   (For brownfield, include `context` in the `scores` object exactly as Step 2e does.) The `--append-round-stdin` payload accepts any valid JSON shape, so the fact-derived `kind:"fact-ground"` round persists alongside user Q&A rounds without a schema change.
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
| Goal Clarity | "What exactly happens when...?" | "When you say 'manage tasks', what specific action does a user take first?" |
| Constraint Clarity | "What are the boundaries?" | "Should this work offline, or is internet connectivity assumed?" |
| Success Criteria | "How do we know it works?" | "If I showed you the finished product, what would make you say 'yes, that's it'?" |
| Context Clarity (brownfield) | "How does this fit?" | "I found JWT auth middleware in `src/auth/` (pattern: passport + JWT). Should this feature extend that path or intentionally diverge from it?" |
| Scope-fuzzy / ontology stress | "What IS the core thing here?" | "You have named Tasks, Projects, and Workspaces across the last rounds. Which one is the core entity, and which are supporting views or containers?" |

After generating the question (above), check whether the topic reveals a **multi-viable design choice** — if yes, run Step 2-alt below instead of Step 2b.

### Step 2-alt: Multi-viable alternative presentation (fires in-loop)

**Trigger:** question generation reveals a design choice with ≥2 viable approaches.

**Multi-viable design choice (definition):** both conditions must hold: (1) ≥2 approaches each materially shape the spec — affecting architecture, data model, API contract, or user flow in a non-trivial way — AND (2) codebase facts and external research cannot decide between them; the choice requires human judgment.

**Excluded — do not manufacture alternatives:** single-viable situations (one approach is forced by the codebase, a constraint, or an established fact) and pure factual questions. Example: if the codebase already mandates one auth path via a shared middleware, do NOT generate "JWT vs cookies vs API keys" — that is a strawman.

**Presentation rule:** present 2-3 approaches via `AskUserQuestion`, tag one option `(Recommended)` with a brief rationale, and ask the user to choose. Do not silently default to any approach.

**Main skill owns routine presentation — `daedalus` is for difficult/complex cases only.** For straightforward trade-offs with well-understood options, present the alternatives directly without dispatching `daedalus`. Reserve `daedalus` for choices that are genuinely hard or cross-cutting — where steelman antithesis and deep tradeoff tension analysis add value beyond a direct listing. `daedalus` is a consultation helper, NOT a gate and NOT the default enumerator for every multi-viable fork.

**Seam note — no double-fire with the Phase-2-exit backstop:** The Step-2-exit Design-fork detection gate is a BACKSTOP that fires ONLY when an unresolved load-bearing fork remains at Phase-2 exit. Because Step 2-alt resolves multi-viable forks as they arise IN-LOOP, the backstop normally has nothing left to fire on when the threshold is reached. There is no double-fire: the backstop fires only on forks that slipped through (e.g., a fork that emerged very late in the interview or a user-forced early exit that bypassed in-loop resolution).

After the user selects an approach, record the decision, then proceed to Step 2c (skip Step 2b — the `AskUserQuestion` in this step served as the question for this round).

### Step 2b: Ask the Question

Use `AskUserQuestion` with the generated question. Present it clearly with the current ambiguity context:

```
Round {n} | Targeting: {weakest_dimension} | Why now: {one_sentence_targeting_rationale} | Ambiguity: {score}%

{question}
```

Options should include contextually relevant choices plus free-text.

### Step 2c: Score Ambiguity

After receiving the user's answer, score clarity across all dimensions.

**Scoring prompt** (temperature 0.1 for consistency):

```
Given the following interview transcript for a {greenfield|brownfield} project, score clarity on each dimension from 0.0 to 1.0. If the initial context or transcript was summarized for prompt safety, score from that summary plus the preserved round decisions/gaps; do not re-expand raw oversized context.

Original idea or prompt-safe initial-context summary: {idea_or_initial_context_summary}

Transcript or prompt-safe transcript summary:
{all rounds Q&A or summarized transcript}

Score each dimension:
1. Goal Clarity (0.0-1.0): Is the primary objective unambiguous? Can you state it in one sentence without qualifiers? Can you name the key entities (nouns) and their relationships (verbs) without ambiguity?
2. Constraint Clarity (0.0-1.0): Are the boundaries, limitations, and non-goals clear?
3. Success Criteria Clarity (0.0-1.0): Could you write a test that verifies success? Are acceptance criteria concrete?
{4. Context Clarity (0.0-1.0): [brownfield only] Do we understand the existing system well enough to modify it safely? Do the identified entities map cleanly to existing codebase structures?}

For each dimension provide:
- score: float (0.0-1.0)
- justification: one sentence explaining the score
- gap: what's still unclear (if score < 0.9)

Also identify:
- weakest_dimension: the single lowest-confidence dimension this round
- weakest_dimension_rationale: one sentence explaining why it is the highest-leverage target for the next question

5. Ontology Extraction: Identify all key entities (nouns) discussed in the transcript.

{If round > 1, inject: "Previous round's entities: {prior_entities_json from state.ontology_snapshots[-1]}. REUSE these entity names where the concept is the same. Only introduce new names for genuinely new concepts."}

For each entity provide:
- name: string (the entity name, e.g., "User", "Order", "PaymentMethod")
- type: string (e.g., "core domain", "supporting", "external system")
- fields: string[] (key attributes mentioned)
- relationships: string[] (e.g., "User has many Orders")

Respond as JSON. Include an additional "ontology" key containing the entities array alongside the dimension scores.
```

**Calculate ambiguity:**

Greenfield: `ambiguity = 1 - (goal × 0.40 + constraints × 0.30 + criteria × 0.30)`
Brownfield: `ambiguity = 1 - (goal × 0.35 + constraints × 0.25 + criteria × 0.25 + context × 0.15)`

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

After scoring, show the user their progress:

```
Round {n} complete.

| Dimension | Score | Weight | Weighted | Gap |
|-----------|-------|--------|----------|-----|
| Goal | {s} | {w} | {s*w} | {gap or "Clear"} |
| Constraints | {s} | {w} | {s*w} | {gap or "Clear"} |
| Success Criteria | {s} | {w} | {s*w} | {gap or "Clear"} |
| Context (brownfield) | {s} | {w} | {s*w} | {gap or "Clear"} |
| **Ambiguity** | | | **{score}%** | |

**Ontology:** {entity_count} entities | Stability: {stability_ratio} | New: {new} | Changed: {changed} | Stable: {stable}

**Next target:** {weakest_dimension} — {weakest_dimension_rationale}

{score <= threshold ? "Clarity threshold met! Ready to proceed." : "Focusing next question on: {weakest_dimension}"}
```

### Step 2e: Update State

Update interview state with the new round and scores by invoking the CLI twice — once to record the round, once to advance the phase and ambiguity:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/deep-interview-state.ts update \
  --append-round-stdin <<'OMT_DI_PAYLOAD_EOF'
{"n":<round_number>,"question":"<question>","answer":"<answer>","scores":{"goal":<g>,"constraints":<c>,"criteria":<cr>},"ambiguity":<ambiguity>}
OMT_DI_PAYLOAD_EOF

bun ${CLAUDE_SKILL_DIR}/scripts/deep-interview-state.ts update \
  --current-phase "deep-interview" \
  --current-ambiguity <ambiguity>
```

Use `--append-round-stdin` with a quoted-delimiter heredoc (`<<'OMT_DI_PAYLOAD_EOF'`) to protect shell quoting (apostrophes, `$`, backticks in question/answer text are not expanded). This heredoc guards the shell layer only — all substituted string values (`<question>`, `<answer>`) must be JSON-encoded (`\"`, `\\`, newlines as `\n`) so the payload remains valid JSON. The CLI reads stdin, validates JSON, and exits 1 loudly on invalid input.

For brownfield interviews, include the `context` score in the `scores` object:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/deep-interview-state.ts update \
  --append-round-stdin <<'OMT_DI_PAYLOAD_EOF'
{"n":<round_number>,"question":"<question>","answer":"<answer>","scores":{"goal":<g>,"constraints":<c>,"criteria":<cr>,"context":<ctx>},"ambiguity":<ambiguity>}
OMT_DI_PAYLOAD_EOF
```

`context` carries 15% of the ambiguity formula for brownfield (`context × 0.15`) and is required for accurate resume after `adopt`.

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

## Phase 4: Crystallize Spec

When Phase 2 has exited with `ambiguity ≤ threshold` and the how-readiness gate clear, or when a user-forced escape hatch fires:

The Design-fork detection gate has already run at Phase 2 exit for the normal path. In Phase 4, use the recorded chosen approach when drafting the Approach section; on a user-forced escape hatch with an unresolved fork, include the fork as a risk-note instead of dispatching daedalus here.

**Per-section approval loop**: Draft each spec section (Goal → Constraints → Success Criteria → Approach → ...) one at a time; present it and collect per-section approval before continuing. **Spec template: you MUST read `deep-interview-spec-template.md` now, before composing any section.** Do not write the spec from memory.

**Whole-spec gate**: After all per-section approvals, assemble the draft and present the whole spec for final confirmation before writing.

1. **Write to file**: `$OMT_DIR/deep-interview/{slug}.md`

**2-layer review** (after writing):

Inline self-review (4 checks): placeholder / consistency / scope / ambiguity — confirm no unfilled placeholders, no section contradictions, full interview coverage, no ambiguous text remains.

Dispatch `spec-reviewer` — pass the spec path only. On issues found: one round of fix + re-review; if issues persist, record a risk-note and proceed (advisory, non-gating).

2. **Emit the handoff token** in the final assistant message before proceeding to Phase 5. The literal token `<deep-interview-done/>` must appear in the assistant turn that announces spec completion. This signals downstream hooks that the interview phase is complete and state cleanup may proceed.

## Phase 5: Execution Bridge

After the spec is written, FIRST apply the re-entrancy guard, then choose the recommended execution route from the spec's own characteristics, and present options via `AskUserQuestion`.

**Re-entrancy guard (caller marker, NOT a goal-state read):** Check whether this interview was invoked with the caller marker `caller=goal`.
- **Marker `caller=goal` present** → `goal` is the caller and is already orchestrating. Return the crystallized spec (the `$OMT_DIR/deep-interview/{slug}.md` path) to the caller and emit **NO** `goal` handoff. This prevents a goal→deep-interview→goal loop. Skip the planning/execution route below; the caller routes downstream itself.
- **Marker absent** → emit the `goal` handoff as described below.

The guard relies ONLY on the caller-supplied marker; it does NOT read any goal-state file.

**Recommend the route by judging the spec you just wrote — its output shape and how much HOW-uncertainty the interview left open:**
- If the spec's output maps cleanly to a single domain skill available in this session (e.g., documentation → `technical-writing`, slides → `create-slides`), recommend that skill **directly** — this terminal domain output bypasses `goal` (it needs no planning/execution orchestration). Read the live available-skills list to find the match — do NOT hardcode a skill catalog here, because the available skills change.
- Else (the remaining work is planning and/or multi-step execution — code that benefits from AC-gated planning, or settled multi-step orchestration), recommend handing the spec to **`goal`**, which orchestrates planning/execution downstream (it wraps prometheus/sisyphus and re-pursues the objective). Do NOT recommend prometheus or sisyphus directly for planning/execution work; route that through `goal`.

`goal` is the single orchestration entry for planning/execution work; it chooses between decomposition (prometheus) and execution (sisyphus) itself. Do not reflexively pre-pick prometheus vs sisyphus here — its core value, requirements clarification, is exactly what this phase already delivered, and `goal` selects the downstream skill from the spec it receives.

**Question:** "Your spec is ready (ambiguity: {score}%). How would you like to proceed?"

**Build the options like this** (recommended route first, tagged "(Recommended)", with a one-sentence rationale tied to THIS spec):
- The recommended route from the rule above (a domain skill directly, or `goal` for planning/execution work).
- When the recommended route is `goal`, also offer a domain skill as the override only if the spec plausibly maps to one. When the recommended route is a domain skill, offer `goal` as the override (so planning/execution can still be chosen). Planning/execution work is always routed through `goal` — never offer prometheus or sisyphus as direct options here.
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
- Use `bun ${CLAUDE_SKILL_DIR}/scripts/deep-interview-state.ts get` to read back state when resuming an interrupted session
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
- **how-readiness gate**: Normal-path exit requires `ambiguity ≤ threshold` AND no unresolved load-bearing HOW-decision (costly-to-change, cross-cutting, or multiple genuinely divergent approaches). User-forced escape hatches (hard-cap, early-exit, user-stop) bypass the gate but fold the unresolved fork into the spec's risk-note.
- **All dimensions at 0.9+**: Skip to spec generation ONLY after the Phase 2 how-readiness gate is clear; if a load-bearing HOW-fork is unresolved, resolve it via the Phase 2 Design-fork detection gate first.
- **Codebase exploration fails**: Proceed as greenfield, note the limitation
</Escalation_And_Stop_Conditions>

<Final_Checklist>
- [ ] Interview completed (ambiguity ≤ threshold AND how-readiness gate clear, OR user chose early exit)
- [ ] Oversized initial context/history was summarized before scoring, question generation, spec generation, or execution handoff
- [ ] Ambiguity score displayed after every round
- [ ] Every round explicitly names the weakest dimension and why it is the next target
- [ ] Challenge stances selected by the Step 2-head Dialectic Rhythm Guard at the correct rotation conditions (Contrarian round 4+, Simplifier round 6+, Ontologist on stall or round 8+ with ambiguity > 0.3)
- [ ] Spec file written to `$OMT_DIR/deep-interview/{slug}.md`
- [ ] Per-section approval loop performed (each spec section approved before continuing)
- [ ] Whole-spec gate: full spec confirmed before writing
- [ ] Inline self-review (4 checks: placeholder / consistency / scope / ambiguity) performed
- [ ] Spec-reviewer dispatched (advisory) and issues addressed or risk-noted
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

**Advanced topics (resume, configuration, ambiguityThreshold, cross-session continuation, prometheus integration, weights / challenge-modes / score-interpretation tables): read `deep-interview-advanced.md` now** — do not guess at resume logic or configuration values from memory.

## Reference Files (on-demand)

Read these files at the moment indicated — not speculatively upfront.

| Reference file | What it contains | When to read |
|---|---|---|
| `deep-interview-spec-template.md` | The Phase 4 output spec markdown template | When composing the output spec (Phase 4 crystallize) |
| `deep-interview-examples.md` | Question-quality calibration examples (Good/Bad) | When calibrating or debugging question quality |
| `deep-interview-advanced.md` | Resume, configuration (ambiguityThreshold), cross-session continuation, prometheus integration, and the weights / challenge-modes / score-interpretation tables | When resuming, configuring, continuing across sessions, integrating with prometheus, or needing the interpretation tables |

Task: {{ARGUMENTS}}

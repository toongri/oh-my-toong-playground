---
name: ultraresearch
description: "Maximum-saturation research orchestration as ONE engine with three postures. Fans synchronous explore+librarian+browsing worker waves across codebase, web, official docs, and OSS repos; runs an EXPAND-until-convergence loop driven by leads workers return at each barrier; verifies contested claims through a separate verification pass (executed code for code-shaped claims, oracle citation re-read for the rest); synthesizes a cited SYNTHESIS.md. ACTIVATES on an explicit research demand (the word 'ultraresearch', '/ultraresearch') OR as a pre-work grounding posture invoked by deep-interview / a caller that needs facts before judgment. Never self-activates for ordinary questions, debugging, or routine implementation context-gathering. While active it overrides exploration-bounding defaults: exhaustive coverage is the goal."
---

<Role>

# ULTRARESEARCH — Maximum-Saturation Research Engine (One Engine, Three Postures)

You are the research orchestrator. You run ONE saturation-research engine. The same engine wears three postures depending on who invoked it and how clear the goal is — but the engine (decompose, saturate, expand until leads dry up, verify in a separate pass, synthesize) is identical across all three. Exhaustive coverage is the assignment, not a risk to manage. Under-exploration is the failure here.

This is an **umbrella skill**: pre-work grounding is a POSTURE of this engine, not a separate skill. One engine serves explicit research and pre-work grounding alike — they share the same five phases, the same wave loop, the same claim-ledger lock.

</Role>

<Attribution>

## Lineage and attribution

- **Engine**: ported from oh-my-openagent's `ultraresearch` saturation-research skill. The async swarm of that source is translated here into synchronous batched Agent waves (see the substrate note in the Engine section).
- **Claim-ledger / verification gate**: EviBound (arXiv:2511.05524) — the ledger-lock idea that only ledger-cleared claims may enter synthesis. The MLflow run-id/FINISHED backend of the paper is replaced with OMT-native ground truth (executed code / oracle citation re-read).
- **Socratic lineage**: Q00 + ouroboros (the [Q00/ouroboros](https://github.com/Q00/ouroboros) project) — specification-quality-first questioning, inherited via deep-interview, which is this engine's CLEAR-posture interactive partner.
- **Browsing engine**: fivetaku/insane-search (MIT) → vendored as the insane-browsing skill; authenticated and JS-rendered page access for sources blocked to surface-level web retrieval. (Distribution chain: fivetaku/insane-search → oh-my-openagent copy → OMT vendored skill.)

</Attribution>

<Activation>

## Activation

Run this engine when one of the following holds:

- The user explicitly demands research: the word "ultraresearch" (also `/ultraresearch`), or an explicit request for research, deep research, or an ultra-precise investigation — in any language. → **explicit-research posture**.
- A caller (typically `deep-interview`, or any skill that needs facts before it forms a judgment) invokes this engine to ground a decision before work starts. → **pre-work posture** (CLEAR or UNCLEAR — selected in Phase 0).

An ordinary question, a debugging session, or another mode's routine context-gathering is NOT activation; answer those normally and mention that `ultraresearch` is available when a question would clearly benefit from saturation research.

While active, this engine supersedes exploration-bounding defaults in surrounding prompts: one-pass retrieval budgets, two-wave stop rules, and "over-exploration is failure" framings govern routine implementation context-gathering, not this deliverable. The convergence rules below are the ONLY stop rules while the engine is active.

</Activation>

<Engine>

# THE ENGINE — five phases (identical across all three postures)

The engine has five phases:

1. **Phase 0 — Decompose and intent-route** — decompose the question into orthogonal axes, open the journal, and select the posture (explicit / pre-work CLEAR / pre-work UNCLEAR) and the worker-floor tier.
2. **Phase 1 — Saturation wave** — launch the first wave: every axis dispatched at once as foreground Agent workers in a single response.
3. **Phase 2 — EXPAND until convergence** — the wave loop: each wave fans out, a barrier collects all returns, and the convergence gate decides expand-vs-stop. This is what makes the engine research rather than search.
4. **Phase 3 — Verify (separate verification pass)** — settle contested claims in a dedicated verification pass, never by the gatherers themselves.
5. **Phase 4 — Synthesize** — generate `SYNTHESIS.md` and (for the pre-work postures) the handoff, once, from a single post-convergence snapshot.

## Substrate: synchronous batched waves (NO async swarm)

OMT forbids dispatching Agent tasks in the background (`rules/tool-usage-policy.md` — agent tasks run in foreground; background dispatch is prohibited). The substrate is also fixed-member: `lib/generic-job.ts`'s detached-worker path locks the member set at job-start and waits on a collect barrier, so a wave cannot grow new members mid-flight. Therefore the source engine's async swarm is translated into **synchronous batched waves**:

- A **wave** is N foreground Agent workers dispatched in ONE response (multiple Agent calls in a single turn run in parallel within that wave).
- A **barrier collect** follows: you wait for every worker in the wave to return, then digest all returns together.
- EXPAND becomes wave-boundary expansion: after the barrier collect, decide expand-vs-converge; if expanding, spawn the **next wave** from the collected leads.

The vocabulary is therefore: **wave → barrier collect → next wave**. There is no mid-flight steering and no background worker — workers are dispatched in the foreground only, never detached to the background. Mid-flight expansion was an efficiency optimization in the source, not a completeness requirement — convergence (leads drying up) is captured at wave boundaries instead, with the carry-over rule below recovering deep-chain completeness.

## Worker ground rules

- **Read-only gatherers.** Research workers (explore, librarian, browsing) cannot write the journal or any session file. Every journal write is yours.
- **No worker recursion.** Workers cannot spawn their own subagents; depth comes from your expansion waves, not worker-side recursion.
- **Lift the budget in the spawn message.** Workers ship with their own retrieval budgets and stop-when-answered rules. Each spawn message must explicitly lift the budget and demand the EXPAND tail, or the worker returns a thin single-pass answer with no leads.
- **One unique angle per worker.** No two workers in a wave share an angle. Name what each worker owns (a codebase part, a source territory, a question lens) — never a job title.

### The spawn-message contract

Every gatherer spawn message contains, in order: (1) `TASK:` — one imperative line naming the role and the axis; (2) the budget lift ("This is an explicit exhaustive-research assignment; your default retrieval budget and stop-when-answered rules do not apply"); (3) scope — the axis, the sources to hit, what a complete answer contains; (4) the role protocol; (5) the reply tail. Every worker ends its reply with:

```
## EXPAND
- LEAD: <discovery not yet investigated> — WHY: <why it matters> — ANGLE: <suggested search>
- DEAD END: <lead explored to exhaustion>
- OPEN CHAIN: <a lead the worker was mid-chain on at the barrier> — REMAINING DEPTH: <n>
```

A worker with nothing to expand writes `## EXPAND` then `none — <one-line reason>`. A reply missing the tail is incomplete: send that worker one follow-up demanding it before closing the lane.

## Phase 0 — Decompose and intent-route

Decompose the query into 3+ orthogonal axes, classify the posture and tier (see the Postures section), and open the session directory `$OMT_DIR/ultraresearch/<slug>-<timestamp>/` as `$SESSION_DIR` (`<slug>` is a short kebab-case label derived from the query so the run is identifiable; the `<timestamp>` suffix keeps concurrent or repeated runs from colliding). You own the journal: you write every file in it; workers never do.

  - **Browsing: yes/no** — decide whether this run needs depth browsing of blocked, auth-gated, or dynamically-rendered sources (hermes + insane-browsing). Set to `yes` when surface-level web results are insufficient due to access restrictions or JavaScript-rendered content; set to `no` to skip the browsing tier entirely.

## Phase 1 — Saturation wave

Launch the entire first wave in one response — every Phase-0 axis at once, as foreground Agent workers. Sequential launches and "start with one and see" defeat the engine. Embed the relevant role protocol in each spawn message:

- **Codebase (explore), per the tier floor.** Grep with 3+ keyword variations; structural/AST search; LSP definitions and references; file-name globs; `git log --all -S` and `--grep` for history including deleted code. Report absolute file paths, `file:line` patterns, and how findings connect.
- **Web (librarian), per the tier floor.** At least 10 distinct websearch queries per worker, each with a different operator or angle; fetch the full page for every result that matters. Real-world usage via `gh search` and grep.app; official docs via sitemap discovery.
- **Browsing (hermes, insane-browsing 로드), per the tier floor.** Full authenticated and JavaScript-rendered page access for sources blocked or insufficiently covered by surface-level web retrieval; only dispatched when Phase-0 Browsing gate is `yes`.

## Phase 2 — EXPAND until convergence (the wave loop)

This loop is what makes the engine research rather than search. Each wave:

1. **Barrier collect**: wait for every worker in the wave to return.
2. **Journal**: digest each return plus its verbatim EXPAND markers into `wave-*.md`.
3. **Deduplicate** new markers against `expansion-log.md` (every lead ever seen, not just confirmed ones, or rejected leads resurface each wave).
4. **Spawn the next wave**: one expansion worker per new unchecked lead, all dispatched in one response.
5. **Record** the wave in `expansion-log.md`: workers spawned, markers gained, leads opened/closed, and any OPEN CHAIN carried over.

### Convergence — the only stop rules while active

**The minimum-2-waves floor completes first.** Run at least **minimum 2** expansion waves on any multi-faceted query before convergence may be claimed. The empty-wave stop rules below apply ONLY after the minimum-2 floor has completed — there is no contradiction between the floor and the empty-wave rules: the floor is a precondition the empty-wave rules are evaluated after. (Non-contradiction statement: a wave producing no new leads during the minimum-2 floor does NOT trigger an early stop; the floor runs to completion, and only then do the empty-wave stop rules become eligible to fire.)

After the floor, stop when one of these holds:

- **Zero unchecked leads remain** — each lead investigated or closed as a duplicate or dead end.
- **3 consecutive empty waves** — 3 consecutive waves produced no new actionable leads.
- **Depth 5** — expansion depth reached 5 waves (the depth-5 cap).

### Carry-over rule (deep-chain completeness)

A worker mid-chain at a barrier reports the **OPEN CHAIN with remaining depth annotated**. Convergence does NOT count a wave empty while open annotated chains remain — open annotated chains keep the loop alive even when that wave surfaced no other new leads (this also immunizes the engine against the alternating-cadence false-empty case, where leads arrive every other wave). The depth-5 cap still bounds total depth; a chain **still open at the depth-5 cap escalates to the human end-gate** rather than being silently truncated.

## Phase 3 — Verify (a separate verification pass; gatherer ≠ verifier)

Verification is a **separate verification pass**, distinct from gathering. The gather workers **must not self-certify**: a worker that surfaced a claim may not also be the source of its "verified" status. Settle a claim with executed evidence whenever sources disagree, a behavior is undocumented, a claim is performance- or compatibility-shaped, or the honest answer is "it should work".

- **Code-shaped claims**: a verification worker writes a minimal self-contained script, runs it, captures full stdout+stderr, pins versions, and returns a verdict (CONFIRMED / REFUTED / PARTIAL) grounded in the output. "Verified" for these claims means **executed code**.
- **Non-code claims** (numeric, market-share, legal, dated, causal): "verified" means an **oracle citation re-read** — the cited primary source is re-read and confirmed to support the claim. The `oracle` agent performs this re-read.

**The oracle is never dispatched as a gatherer.** The oracle's only role in this engine is the non-code verification re-read (and, in the UNCLEAR posture, the adversarial substitute review). It is never one of the Phase-1/Phase-2 gather workers.

### The claim-ledger lock (de-MLflow'd)

A high-risk non-code claim may enter the `verified-claims` set ONLY if it clears the ledger gate — and the verified set is the **sole allowlist** the synthesis draws from. Skip the gate and there is nothing to synthesize: the lock is self-enforcing. A claim clears the gate only when ALL hold:

- **≥ 2 independent source domains** corroborate it (two pages on the same domain count once).
- **One counter-search** actively looked for a refutation and did not find a stronger one.
- **A primary source** (the standard, filing, dataset, or first-party doc) backs it — not only secondary commentary.

"Verified" evidence is OMT-native: **executed code** for code-shaped claims, **oracle citation re-read** for non-code claims. This is explicitly NOT MLflow run-id/FINISHED (the paper's backend has no equivalent in OMT). Anything that fails the gate lands in the contradictions or gaps section — abstention is a correct outcome, not a gap to paper over. Maintain `claim-ledger.md` with one row per claim: `claim | risk | domains | counter-search | primary? | status`.

## Phase 4 — Synthesize

After convergence and the verification pass, re-read the whole journal and write the artifacts. See the Artifact Contract section for the exact shape and the single-snapshot write-ordering.

</Engine>

<Postures>

# THE THREE POSTURES — Phase-0 intent routing

The same engine runs in one of three postures, selected in Phase 0. The posture changes WHO invoked the engine and WHAT it emits at the end — not the engine itself.

## Posture selection criteria

| Posture | Selected when | Emits |
|---|---|---|
| **explicit research** | the user explicitly demanded research (`/ultraresearch <question>`) | terminal cited `SYNTHESIS.md` (the deliverable) |
| **pre-work CLEAR** | invoked by `deep-interview` (or a caller) to ground facts while a human is in the loop answering the decisions; the goal/decisions are clear, only the facts are missing | grounded facts returned to the caller; `SYNTHESIS.md` as backing |
| **pre-work UNCLEAR** | invoked for pre-work grounding but no human is available to answer the decisions; the engine must run autonomously to best-practice defaults | a deep-interview-schema handoff (research-derived defaults), gated by the human end-gate |

CLEAR is the primary interactive pre-work path (a human answers the decisions via deep-interview; the engine fills the facts). UNCLEAR is the autonomous fallback when no human is present to interview.

## Complexity tier → worker-floor table

The tier signal comes from: **the prometheus intent class + T1 risk modifiers + a caller-supplied override**. (This reuses the existing, validated intent classifier rather than inventing a bespoke complexity scorer. The classifier lives in the caller/prometheus; this engine owns only the tier→floor mapping below.)

| Intent class (tier) | explore | librarian | browsing | floor | Notes |
|---|---|---|---|---|---|
| Trivial | 0 | 0 | 0 | 0 | short-circuit — no fan-out (see below) |
| Scoped | 2 | 1 | 0 | 2-3 | the in-interview cap when deep-interview calls this engine |
| Complex | 3 | 2 | 1 | ~5 + librarian | |
| Architecture | 4 | 6 | 2 | full fan-out + oracle | the widest case |
| explicit `/ultraresearch` | 4 | 6 | 2 | max | exhaustive |

T1 risk modifiers raise the floor for high-risk dimensions; a caller-supplied override takes precedence over the intent-class default.

## Pre-work handoff conformance

On the pre-work postures, the goal/prometheus-facing handoff **conforms to the existing deep-interview handoff schema** at `$OMT_DIR/deep-interview/{slug}.md`. This keeps goal's consumer contract untouched: goal routes both deep-interview-authored and ultraresearch-authored handoffs unchanged. `SYNTHESIS.md` (8-section) is the **backing artifact**; the handoff is the existing-schema brief. In the handoff, **uncertainty and gaps are first-class**: unresolved questions and research-derived defaults are surfaced explicitly, never buried.

## UNCLEAR posture — autonomous branch

On the UNCLEAR path no human is present to be interviewed, so the engine runs autonomously to best-practice defaults. Two branch rules apply:

- **oracle-substitute**: an `oracle` adversarial review substitutes for the interview that was skipped. The oracle reviews the autonomously-derived defaults for soundness. (This is the oracle's review role; the oracle is still never a gatherer.)
- **oracle-REQUEST_CHANGES → deep-interview escalation**: if the oracle review returns REQUEST_CHANGES (the autonomous defaults are wrong), the engine escalates to a real `deep-interview` — an UNCLEAR→CLEAR escalation — rather than shipping wrong defaults.

On the UNCLEAR handoff, the acceptance-criteria-shaped content is **research-derived best-practice defaults**, tagged `[from-research]` provenance, uncertainty-flagged, and subject to the human end-gate below. The invention is bounded (research-grounded, human-reviewed), never silent.

## Human end-gate (single synchronization point)

The grounding handoff must NOT silently unlock execution. The human end-gate is a prose-mandated approval: the handoff is presented for human approval before it unlocks `goal`/`prometheus`.

On the UNCLEAR path — which runs without a human present by design — the gate is the **single synchronization point**: research and gathering are autonomous, but the handoff unlock is human-gated. The autonomous run produces the grounding, then **pauses and surfaces** the handoff (with its autonomously-derived content flagged) for human approval before any `goal`/`prometheus` unlock. Autonomy in gathering is not autonomy in unlocking. A chain still open at the depth-5 cap (carry-over rule) also escalates to this same end-gate rather than being truncated mid-run.

## Trivial short-circuit

The **Trivial tier short-circuits the engine**: it emits a lightweight grounding-brief only — **no SYNTHESIS.md, no worker fan-out, no waves**. Trivial work does not justify the saturation machinery; the brief is a few sentences of grounding, not a research artifact.

</Postures>

<Artifact_Contract>

# ARTIFACT CONTRACT

## SYNTHESIS.md — eight sections

`SYNTHESIS.md` has exactly these eight sections, in order:

1. **executive summary** — 2-3 paragraphs answering the core question.
2. **findings by theme** — per theme: consensus, evidence links, a short attributed quote, verified yes/no.
3. **codebase findings** — absolute paths with `file:line` references.
4. **ranked sources** — URL, what it contains, reliability, access date, ranked.
5. **verified claims** — only ledger-cleared rows (code: claim | verdict | verify artifact; non-code: rows cleared into the verified set).
6. **contradictions** — source A vs source B, resolution with evidence.
7. **gaps** — what saturation could not answer; unresolved/refuted claim-ledger rows.
8. **expansion trace** — per wave: workers → markers; the convergence reason that fired.

### Per-claim provenance labels

Every claim in `SYNTHESIS.md` carries a provenance label at its origin: `[from-code]` (codebase read), `[from-code][auto-confirmed]` (codebase read confirmed by executed code), `[from-research]` (librarian/external), `[from-user]` (a user answer). Provenance is assigned where the evidence enters, not reconstructed at synthesis.

## Three journal files

The orchestrator maintains three journal files in `$SESSION_DIR` (the incremental trace, written wave-by-wave):

- `wave-*.md` — your per-wave digest of each worker return: findings, sources with URLs, the worker's EXPAND markers verbatim.
- `expansion-log.md` — per wave: workers spawned, markers gained, leads opened and closed, open chains carried over.
- `claim-ledger.md` — one row per asserted claim with its gate status (`claim | risk | domains | counter-search | primary? | status`).

## Single-snapshot write-ordering

`SYNTHESIS.md` and the handoff are generated **once, from a single post-convergence snapshot of the claim-ledger** — they are NOT accreted per-wave. The per-wave `wave-*.md` journal is the incremental trace; the two consumable artifacts (`SYNTHESIS.md` and the deep-interview-schema handoff) are written at convergence from the final post-convergence claim-ledger snapshot, guaranteeing both derive from one snapshot. (A late wave can overturn an earlier "verified" claim, so the consumables must derive from the final snapshot, never from mid-run state.)

## Zero verified claims

An explicit run that converges with **0 verified claims still emits `SYNTHESIS.md`** — with an empty verified-claims section and an explicit "no verified claims" note. Zero verified claims is a real, honest outcome (the contested claims landed in gaps/contradictions), not a reason to suppress the artifact.

</Artifact_Contract>

<Failure_Modes>

## Failure modes

| Failure | Correction |
|---|---|
| Sequential spawning, or trimming the first wave | All first-wave workers dispatched in one response; respect the tier floor |
| Stopping after wave 1 because "enough was found" | Convergence rules only: the minimum-2 floor first, then leads must run dry |
| Counting a wave empty while an OPEN CHAIN is annotated | Carry-over rule — annotated open chains keep the loop alive; a chain open at the depth-5 cap escalates to the human end-gate |
| A gather worker certifying its own claim as verified | Gatherer ≠ verifier — verification is a separate verification pass; gather workers must not self-certify |
| Asserting a high-risk claim that did not clear the ledger gate | The verified set is the sole allowlist; uncleared claims go to gaps/contradictions |
| Dispatching the oracle as a gather worker | The oracle is never a gatherer — only verification re-read and the UNCLEAR substitute review |
| Accreting SYNTHESIS.md per wave | Single post-convergence snapshot write-ordering — both consumables generated once at convergence |
| Running the saturation machinery on Trivial work | Trivial short-circuit — lightweight brief, no SYNTHESIS, no fan-out |

</Failure_Modes>

Task: {{ARGUMENTS}}

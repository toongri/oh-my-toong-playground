# metis fixtures (decider-gate detection power)

Two behavioral-verification fixtures for the `metis` agent (`agents/metis.md`), the pre-planning
requirements reviewer Prometheus invokes at its S1 gate (`skills/prometheus/review-pipeline.md` §
Metis Invocation Template). They exist to prove — before anyone edits `agents/metis.md` — that a
specific real defect (an `OUT of Scope` exclusion with no `| decider:` clause) currently slips past
metis undetected, and later, after a follow-up task extends metis's B3 axis to catch it, that the
extension actually works without over-blocking a correctly-formed payload.

These fixtures are pruned from every sync deploy target by `ALWAYS_PRUNE` in
`tools/lib/sync-directory.ts` (any directory named `__fixtures__` is skipped by the source walk).
They exist only in this repo, read directly by whoever runs the dispatch loop described below — never
deployed, never read by `metis` itself at runtime.

## Why these fixtures exist

`skills/prometheus/review-pipeline.md` § Metis Invocation Template already documents the gap this
pair targets: "A future gate (`agents/metis.md`, added in a follow-up) rejects an undecidered
exclusion with REQUEST_CHANGES; this template only fixes the format the gate will check." Editing
`agents/metis.md` to add that gate is a **separate, later task** — not this one. Before that edit
lands, the only way to know the gate is worth adding is to observe the current gap directly: dispatch
a payload with the defect to the unmodified `metis` agent and confirm it does NOT block. That
observation is this fixture set's entire purpose. `missing-decider.md` is the fixture engineered to
carry exactly that one defect; `decider-present-clean.md` is its negative control, engineered to carry
none of it, so that after the future gate lands, a false-positive gate (one that blocks regardless of
whether a decider is present) is equally catchable.

## Fixture authoring constraints (grounding — empirically observed, not theoretical)

**`metis` grounds the dispatch payload in the actual working tree.** When it reads a payload, it
checks the payload's own factual assertions against the repository it is running in, not just against
the abstract rule text. If the payload asserts a file, symbol, UI, or feature that does not exist in
this repo, `metis` flags that as an unvalidated load-bearing assumption (B3's neighbor axis B4 in
`agents/metis.md` § Blocking Authority) and returns REQUEST_CHANGES for that reason — independent of,
and in addition to, whatever axis the fixture is actually trying to isolate. This means **a metis
fixture's payload material must be real** — every file path, symbol, and command it asserts as fact
must exist in this repository, confirmed by `grep`/`ls` before it is written into the payload, not
assumed.

This is not a theoretical risk; it already happened once. The first version of these two fixtures
described a fictional "sync-failure-log view" with a UI "Export CSV" button and a `FAILED_TARGETS`
status filter — none of which exist anywhere in this repo (a CLI harness with no UI, no view layer, no
such filter enum). Dispatching that version to `metis` at HEAD produced REQUEST_CHANGES driven by that
fabricated material, which broke the fixture's single-violation design: the decider-gap axis itself
was diagnosed correctly and would have been the only defect — `metis` wrote, in that run, "the gate
that would reject it is described there as a *future* addition and is absent from `agents/metis.md`'s
B1-B4 whitelist. B2 covers boundary absence; this boundary is present and populated. → **COMMENT**." —
but the fabricated UI premises pulled REQUEST_CHANGES in
alongside it, so the fixture could no longer isolate "does the current gate block a decider-less
exclusion" from "does the current gate block an ungrounded assumption." The design was correct; the
material was wrong. Both fixtures were rewritten against `tools/validators/components.ts` and
`tools/lib/validation.ts` — a real file, a real `main()` control-flow, a real exported type — each
fact independently confirmed present in this repository before use.

This is why these fixtures differ from `skills/craft-issue/__fixtures__/issue-reviewer/` (16
fixtures, `issue-reviewer` agent): that directory's fixtures may use fabricated material, because
`issue-reviewer`'s dispatch contract does not ground a payload's factual assertions against the
working tree the way `metis`'s does. Do not port a fabricated-material pattern from that directory
into this one without re-verifying this distinction first.

**Second attempt, second failure mode: shallow AC coverage trips B1.** Real material alone was not
enough. The second version of these two fixtures used real files (the same `--json`-flag-on-a-real-
validator premise the current payload still uses) but paired it with two acceptance criteria written
on the spot for the fixture, not drawn from any reviewed source. `metis` returned REQUEST_CHANGES four
times over, citing B1 (requirements traceability) each time — the ad hoc AC pair left coverage gaps a
careful reviewer could always find, alongside one B4 hit. The lesson: grounding a payload's *facts*
(file/symbol/command existence) is necessary but not sufficient — a payload also needs AC *coverage*
that survives scrutiny, and hand-writing that coverage under time pressure reliably fails to survive
`metis`'s actual scrutiny.

**Third attempt (current): assemble the payload from material that already survived a real Metis
review.** Rather than writing new Original Request / Scope / Acceptance Criteria prose and hoping it
holds up, both fixtures now paste their `USER GOAL` / `SCOPE` / `ACCEPTANCE CRITERIA` content from
`$OMT_DIR/plans/format-on-deploy.md` — a plan whose own `## Success Criteria` (AC1-AC13) is the
*already-precisified output* of a real Metis requirements-gate round on that plan (see
`format-on-deploy.md:42-49`, "Metis 요구사항 게이트 carried-forward"), and whose underlying feature has
since shipped (`tools/sync.ts:1398` `formatDeployedRoots`, `:1811` its call site,
`tools/lib/types.ts:65` the `format` field, `tools/validators/schema.ts:57` the schema entry). This
closes both prior failure modes at once: the material is real (attempt 1's failure mode) *and* the AC
set already survived a Metis-driven precision pass instead of being hand-written for the fixture
(attempt 2's failure mode). One item from the source AC set (AC9, "육안 확인" / manual `git status`
check) is deliberately excluded — pasting it would trip `agents/metis.md:80`'s `ZERO USER INTERVENTION`
gate and pull an unrelated B3 finding into the payload, the same kind of noise-axis problem that broke
the first two attempts. See `missing-decider.md`'s header for the full per-axis (B1/B2/B3/B4)
non-firing argument built on top of this material.

**For whoever edits this fixture pair next**: if you change what feature the payload describes,
confirm every file path, exported symbol, and command you reference actually exists in this repo
(`grep`/`ls` it, or read the source line you're citing) before writing it into the payload — that
defeats attempt 1's failure mode. Then confirm the Acceptance Criteria you paste in already survived
some real review pass (a shipped plan's precisified Success Criteria, not prose written fresh for the
fixture) and does not contain an AC that trips a gate unrelated to the axis you're isolating (e.g. a
manual-verification AC tripping `ZERO USER INTERVENTION`) — that defeats attempt 2's failure mode. An
unconfirmed fact or a hand-written AC set is exactly the failure mode that forced each rewrite.

## Fixture → predicate mapping

| File | Kind | Rule source |
|---|---|---|
| `missing-decider.md` | detect (RED at HEAD, GREEN after the future B3 extension) | `agents/metis.md` § Blocking Authority (B3) + `skills/prometheus/review-pipeline.md` § Metis Invocation Template |
| `decider-present-clean.md` | negative control (never blocks, at HEAD or after) | same rule source — the detect/negative-control pair |

Both fixtures describe the identical post-deploy `format` feature (OMT sync's `formatDeployedRoots`,
`tools/sync.ts:1398`) with the identical `USER GOAL` / `SCOPE` / `ACCEPTANCE CRITERIA` structure — the
content is pasted from `$OMT_DIR/plans/format-on-deploy.md`; see "Fixture authoring constraints" above
for why. The only textual difference
between them is the presence or absence of the three `| decider:` clauses on the `OUT of Scope`
bullets. See each fixture's header for the
per-file "why this doesn't trip B1/B2/B4 instead" argument — that argument is what makes each fixture
a single-violation (or zero-violation) probe rather than a payload that happens to also get blocked
for an unrelated reason.

## Judgment predicate

`metis`'s `## Output` contract (`agents/metis.md` § Output) ends every response with an
`## Analysis Verdict` section whose value is one of `APPROVE` / `REQUEST_CHANGES` / `COMMENT`, plus
Blocking Items and Rationale. Unlike `issue-reviewer`'s rigid `**Status:**` / `**Rule:**` labels,
metis has no single mandated literal template for that section — it is free-form prose inside a fixed
header. The predicates below are written against what the contract guarantees (the header exists, the
verdict word appears near it) rather than an exact byte layout, the same epistemic stance
`skills/craft-issue/__fixtures__/issue-reviewer/README.md` took after its own E-KEY amendment (primary
finding stable, surface presentation varies).

**As originally proposed — aggregate verdict (measured: unreachable).** The predicate first tried was
a grep over the aggregate verdict:

```bash
grep -A5 '## Analysis Verdict' r.md | grep -qE 'REQUEST_CHANGES'
```

Measurement showed this predicate cannot discriminate the gate's effect. `metis` grounds every dispatch
payload in the actual working tree, so any plan it reviews lands in one of two buckets independent of
the decider-gap gate: a plan describing an already-shipped feature has AC that all pass at HEAD →
vacuous AC → a **B4** finding; a plan describing an unshipped feature has premises that cannot be
confirmed in the repo → also **B4**. Across all four `missing-decider.md` revisions dispatched before
the gate existed, the overall verdict was `REQUEST_CHANGES` every time, driven by B4 — by the third
revision B1/B2/B3 no longer fired, but B4 never went away. **This is a property of `metis`'s grounding
design, not a defect in the fixture pair.** "Does the overall verdict flip to non-`REQUEST_CHANGES`" was
never an achievable success condition for this fixture, at HEAD or after the gate — see Measured
results below for the run-by-run record.

**Predicate actually used — decider-gap finding classification.** Read how `metis` classifies the
decider-gap finding specifically, from the response's Blocking Items / Rationale prose (free-form, not
a grep pattern):

- before the gate: the decider-gap finding is classified as **COMMENT** (advisory prose, not a Blocking
  Item)
- after the gate: the decider-gap finding is classified as a **B3 blocking item**
- negative control: no decider-gap finding exists to classify — every `OUT of Scope` bullet already
  carries its clause

**Decider-anchor check** (does the response name the decider defect at all — a coarse grep used only to
confirm the finding is present in the prose before reading its classification by hand):
```bash
grep -qiF 'decider' r.md
```

This predicate is *more* precise than the aggregate one, not a lesser fallback: it discards the B4 noise
axis — present identically in every `missing-decider.md` dispatch regardless of gate state, so it
cancels out between the before/after comparison — and isolates the one axis this fixture pair exists to
probe.

## Measured results

Measured 2026-07-21, against the actual B3 extension that landed at `agents/metis.md:104` (the gate
itself) and `:107` (a reconciliation note: decider-absence is a B3 existence check, not a B2
boundary-absence check). Seven dispatches total: four `missing-decider.md` payload revisions before the
gate (each revision fixed a non-decider finding from the prior run, per "Fixture authoring constraints"
above — not four repeats of an unchanged payload), two `missing-decider.md` dispatches after the gate,
and one `decider-present-clean.md` dispatch after the gate. This is not the "two independent dispatches
per cell" target the Reproduction section below recommends for future re-runs — the RED side needed
iterative payload fixes before the decider-gap axis could be isolated from unrelated findings, and the
negative control was captured once.

### Rule-file identity pin (measured)

| Point in time | `git hash-object agents/metis.md` |
|---|---|
| Before the gate | `707b6c9a387a3c9f86a8ff211fc14a57e6abaddd` |
| After the gate | `00ff6557e9c2cf2cd15e372ac8af8caaa0d566a0` |

The two hashes differ, confirming the B3 gate edit actually landed in `agents/metis.md` between the two
measurement batches — the before/after comparison is not accidentally reading the same rule-file bytes
twice. (See the Reproduction section's rule-file identity pin guidance for the two-file check to run
before trusting a future batch; this round's record covers `agents/metis.md` only, the file the gate
itself changed.)

### Before the gate — `missing-decider.md` (n=4, payload revised each run to close prior non-decider findings)

| run | payload | overall verdict | decider-gap finding classification |
|---|---|---|---|
| 1 | fabricated material (sync-failure-log view) | REQUEST_CHANGES (B4) | **COMMENT — not blocking** |
| 2 | real material, two shallow AC | REQUEST_CHANGES (B1×4 + B4) | **COMMENT — not blocking** |
| 3 | assembled from a shipped plan's AC | REQUEST_CHANGES (B4×2) | **COMMENT — not blocking** |
| 4 | two B4 findings fixed | REQUEST_CHANGES (B4) | **COMMENT — not blocking** |

All four runs recognized the decider gap accurately while classifying it as non-blocking. Run 1:

> "the gate that would reject it is described there as a *future* addition and is absent from
> `agents/metis.md`'s B1-B4 whitelist. B2 covers boundary absence; this boundary is present and
> populated. → **COMMENT**."

Run 1 also explicitly declined to invent a new axis to block on:

> "I am explicitly declining to invent a fifth B-axis to block on it."

Run 4, after exhaustively checking the rule file:

> "실제 `agents/metis.md`를 전수 확인한 결과 그러한 게이트는 **존재하지 않는다**. B1-B4는 유한
> 화이트리스트이고 decider 부재는 어느 축에도 해당하지 않으므로 **차단하지 않는다**."

### After the gate

`missing-decider.md` (decider absent), n=2:

| run | decider-gap finding classification |
|---|---|
| 1 | **B3 blocking item — item 1** |
| 2 | **B3 blocking item — item 1** |

Run 1:

> "**B3 — `OUT of Scope` decider 절 전면 부재.** ... 배제가 존재하되 후보 finding에 대해 **판정
> 불가**한 상태다. ... 게이트 근거: `agents/metis.md:104,107` — decider 없는 배제는 B2(경계 부재)가
> 아니라 B3(존재하나 판정 불가)로 차단된다. B3 판정은 decider의 **존재 여부만** 본다."

Run 2:

> "**B3 — decider 부재**: OUT of Scope 3항목 중 `| decider:` 절을 가진 항목이 0개. 배제가 존재하나
> 판정 불가 상태"

`decider-present-clean.md` (decider present, negative control), n=1 — **the before-the-gate state for
this fixture was not measured; that cell is intentionally left blank, not estimated**:

> "**낮음**: OUT-of-scope 3항목 모두 `| decider:` 절을 갖춰 판정 가능하다 (repo `agents/metis.md:104`
> B3 확장 요건 충족)."
>
> "**Rationale**: B1(모든 요구사항이 AC 보유), B2(in/out 경계 + **decider 3종 완비**), B3(모든 AC
> 종단 상태 관측 가능, 인간 개입 요구 없음)은 통과한다."

The negative control cited the gate's exact rule-file location back at us (`agents/metis.md:104`) —
evidence that it read and applied the new rule, not just happened not to fire.

### 4-cell summary

| Fixture | Before the gate (HEAD) | After the gate |
|---|---|---|
| `missing-decider.md` (decider absent) | COMMENT — not blocking (n=4) | **B3 blocking item** (n=2) |
| `decider-present-clean.md` (decider present) | — not measured | **not blocked on the decider axis** (n=1) |

The defect fixture flipped between the two gate states; the negative control did not. Both cells matter
together, and neither substitutes for the other: without the negative-control column, a reader cannot
tell "the gate detects the decider gap" apart from "the gate blocks anything near an `OUT of Scope`
bullet" — a gate that over-fires on unrelated content would look identical to a correctly targeted one
if only the defect fixture's before/after were on record. **Do not delete the negative control as
"redundant" with the defect fixture — it is the only thing in this pair that rules out over-firing.**

B4 noise is a common mode present identically in both fixtures regardless of gate state (see "Judgment
predicate" above), so it cancels out in the comparison; the only axis that differs between the two
fixtures' classification columns is the decider gate itself.

## Reproduction — how to dispatch a fixture

Each fixture file has a metadata header (expected verdict / anchor / why) followed by a
`## Dispatch payload` section. Read the two rule files first, then copy everything under
`## Dispatch payload` verbatim into the agent prompt:

```
Rule files (read both before judging anything):
  <absolute path to agents/metis.md>
  <absolute path to skills/prometheus/review-pipeline.md>

Dispatch payload (inline text, not file paths):

<everything under "## Dispatch payload" in the fixture file, verbatim>
```

Then:

```
Agent(subagent_type="metis", prompt=<the assembled text above>)
```

Run each fixture **twice** (two separate dispatches, not one dispatch read twice) to produce `run1`
and `run2`, per the "Measured results" section above. The dispatching party is the orchestrator/main
thread — `sisyphus-junior` cannot call `Agent` itself, so a `sisyphus-junior` delegation can author or
edit these fixture files but never run this reproduction loop.

**Rule-file identity pin**: before trusting a batch of fixture runs, capture
`git hash-object agents/metis.md skills/prometheus/review-pipeline.md` immediately before and after
the batch and confirm it is unchanged (working-tree bytes, not the last commit). If the rule files
changed mid-batch — including an in-progress edit to a gate extension — the batch spans two different
gate states and is not comparable; discard it and re-run cleanly on one side of the edit.

## Why these fixtures are not wired into `make test`

This repo has no mechanism that automatically verifies agent *behavior* — `tools/run-tests.sh` runs
Shell tests (`*_test.sh`) and `bun test` (TypeScript) only, neither of which can dispatch an `Agent`
call or judge free-form LLM prose. This is a known, accepted limitation, not an oversight specific to
this fixture pair: `skills/craft-issue/__fixtures__/issue-reviewer/` (16 fixtures, the pattern this
directory follows) and `skills/code-review/evals/evals.json` are both, identically, human-run
documented procedures with no CI wiring. Adding an `Agent` dispatch or an LLM call to `make test` /
`tools/run-tests.sh` is an explicit non-goal of this fixture set — see the fixture-authoring task's
MUST NOT DO list.

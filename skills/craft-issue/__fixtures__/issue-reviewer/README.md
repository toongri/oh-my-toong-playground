# issue-reviewer fixtures (E-REPRO)

Sixteen behavioral-verification fixtures for the `issue-reviewer` agent (the READ-ONLY checklist
reviewer dispatched at `craft-issue` Stage 6's Checklist Review Gate, `agents/issue-reviewer.md`).
Each fixture is a self-contained dispatch payload plus an annotation of exactly what it is designed
to trip, or — for the four negative controls — designed NOT to trip.

These fixtures are pruned from every sync deploy target by `ALWAYS_PRUNE` in
`tools/lib/sync-directory.ts` (any directory named `__fixtures__` is skipped by the source walk).
They exist only in this repo, read directly by whoever runs the E-GATE dispatch loop
(`~/.omt/oh-my-toong-playground/plans/craft-issue-checklist-gate.md` §4 TODO-3) — never deployed,
never read by the reviewer agent itself at runtime.

## Why these fixtures exist

`issue-reviewer` has no embedded rule text (`agents/issue-reviewer.md` § Rule Source — "Do not copy
rule text into this file. Read the rule files at dispatch time."). Its judgment is entirely a live
read of `skills/craft-issue/SKILL.md` + `skills/craft-issue/references/issue-craft.md` against
whatever dispatch payload it receives. That live-read design has no compile-time check that the
reviewer actually enforces what those rule files say — the only way to verify it is to dispatch real
payloads engineered to violate one specific rule each, and confirm the reviewer's verdict names that
rule and only that rule. That is what E1–E16 below do.

## Fixture → anchor mapping

Each detection fixture (E1–E9, E14, E15, E16) is designed so its **primary finding is exactly one
rule** — the intended anchor — which the reviewer cites in both runs; the fixture body is isolated
(safe pure-capability envelope, no incidental defects) so no other finding buries or displaces the
intended one. (The reviewer may still cite the same rule at a different heading granularity or pin a
set-level finding to a different target label across runs — see the E-KEY amendment below — which is
why the gate keys on the anchor being present in both runs, not on byte-identical finding sets.)
Each negative-control fixture (E10–E13) is designed to pass cleanly even though it superficially
resembles a violation, to catch reviewer false positives — the failure mode this whole gate exists
to guard against (a permanently-RC reviewer that hard-blocks legitimate issues).

| # | File | Kind | Anchor / expected verdict | Rule section (source of truth) |
|---|---|---|---|---|
| E1 | `weasel-word-ac.md` | detect | `weasel` (case-insensitive) | issue-craft.md § Observable-AC Rubric › Weasel-Word Prohibition |
| E2 | `task-restatement-ac.md` | detect | `Task restatement` | issue-craft.md § AC Anti-Patterns |
| E3 | `compound-ac.md` | detect | `observable-AC` (case-insensitive) | issue-craft.md § Observable-AC Rubric › Named Contract (two-line observable-AC contract) |
| E4 | `unbacked-precontext.md` | detect | `Pre-Context Rules` (and NOT co-cited with `Standard Body Shape`) | issue-craft.md § Pre-Context Rules |
| E5 | `missing-non-goals.md` | detect | `Standard Body Shape` | issue-craft.md § Standard Body Shape (Non-Goals row) |
| E6 | `unsliced-parent.md` | detect | `Candidate-seam` (case-insensitive) | issue-craft.md § Model A INVEST Slice Rubric › Candidate-seam heuristics |
| E7 | `model-a-violation.md` | detect | `Model-A Purity` | issue-craft.md § Model-A Purity Rules |
| E8 | `over-scaffolding.md` | detect | `Lean by Default` | issue-craft.md § Lean by Default, Escalate on Need |
| E9 | `fake-convergence.md` | detect | `Request-Coverage` | issue-craft.md § Request-Coverage Rule |
| E10 | `lean-clean.md` | negative | PASS, no `**Rule:**` | n/a — lean-default shape control |
| E11 | `justified-complex-clean.md` | negative | PASS, no `**Rule:**` | n/a — justified-escalation control (highest tuning risk, see below) |
| E12 | `manual-verification-ac-clean.md` | negative | PASS, no `**Rule:**` | n/a — A5 verification-method-breadth control |
| E13 | `research-backed-decision-clean.md` | negative | PASS, no `**Rule:**` | n/a — Decisions Needed research-carve-out control |
| E14 | `missing-request-payload.md` | detect (payload) | `payload contract`, PASS forbidden | agents/issue-reviewer.md § Payload Contract |
| E15 | `pre-solved-decision.md` | detect | `pre-solv` (case-insensitive) | issue-craft.md § Decisions Needed › No pre-solving |
| E16 | `missing-body-payload.md` | detect (payload) | `payload contract`, PASS forbidden | agents/issue-reviewer.md § Payload Contract |

**E11 known fragility** (flagged in the plan, §5.E "E11 알려진 취약점" and §6 known-limitation 2):
E11 and E8 present nearly the same surface shape to the reviewer (multiple heavy Conditional
sections in one issue) — `issue-craft.md`'s Red Flag paragraph explicitly warns that "several
Conditional sections... landing in the same issue at once is a signal to stop." E11 is the most
likely candidate to consume the E-GATE's 3-round tuning budget before E-ABORT. If E11 keeps failing
after tuning `agents/issue-reviewer.md`, re-read E11's per-section trigger annotations first — the
fixture already states which specific fact makes each heavy section legal there.

## Judgment predicates (from the plan, §4 TODO-3)

Given a captured reviewer response `r.md` for a fixture, evaluated over **two independent
dispatches** (`run1`, `run2`) of the same payload:

**Detection fixtures (E1–E9, E14, E15, E16)** — both runs must satisfy:
```bash
grep -qF '**Status:** REQUEST_CHANGES' r.md && grep -F '**Rule:**' r.md | grep -qiE '<anchor>'
```
E4 additionally requires the matching `**Rule:**` line NOT also contain `Standard Body Shape` on
the same line (disambiguates a Pre-Context content defect, norm 5, from a missing-section defect,
norm 4):
```bash
grep -F '**Rule:**' r.md | grep 'Pre-Context Rules' | grep -qv 'Standard Body Shape'
```
E14/E16 additionally require PASS never appears:
```bash
! grep -qF '**Status:** PASS' r.md
```

**Negative-control fixtures (E10–E13)** — both runs must satisfy:
```bash
grep -qF '**Status:** PASS' r.md && ! grep -qF '**Rule:**' r.md
```

**E-KEY** (determinism across the two runs). The determinism the gate actually needs is that the
reviewer reliably catches the **intended (primary) finding** in two independent dispatches — which
is exactly what "the detection predicate holds in BOTH run1 and run2" (for a detection fixture) or
"PASS with no findings in BOTH runs" (for a negative control) already asserts. That is the E-KEY
check: **run the detection/negative predicate above against run1 AND run2; both must pass.**

> **Amendment (2026-07-15, E-GATE execution — E-KEY relaxed from byte-identical finding-set to
> primary-anchor stability).** The original E-KEY required the two runs to be byte-identical on the
> full `**Rule:**` set AND the `**Offending:** cut -f1` set:
> ```bash
> diff <(grep -F '**Rule:**' run1.md | sort) <(grep -F '**Rule:**' run2.md | sort)      # (dropped)
> diff <(grep -F '**Offending:**' run1.md|cut -d'|' -f1|sort) <(...run2...)              # (dropped)
> ```
> E-GATE execution measured this to be **unachievable even for a perfectly-isolated single-violation
> fixture**, because a free-form LLM reviewer that is stable on the *primary* finding still varies
> its *surface presentation* across runs in ways no fixture design controls:
> 1. **rule-suffix granularity** — E7 cited `### Model-A Purity Rules` in one run and `### Model-A
>    Purity Rules › Fixed-architecture commitments` in the other (same rule, different suffix);
> 2. **offending-target label** — E9's coverage gap was pinned to `request` in one run and to the
>    child slug in the other (both correct for a set-level finding);
> 3. **secondary-finding subset** — E6/E8 cite a variable subset of overlapping slice/lean rules
>    around one conceptual defect.
> None of these is reviewer flakiness on what matters; the primary finding (the intended anchor) was
> stable in both runs for every one of the twelve detection fixtures. The byte-identical requirement
> conflated "primary finding stable" with "every incidental byte stable" and is therefore dropped.
> The predicate that survives — intended anchor present in both runs — is the real determinism
> guarantee. This amendment lives in the fixture README + plan spec + `**Rule:**` predicate here; it
> touches **no rule file** (`SKILL.md` / `references/issue-craft.md` hashes unchanged), so the gate's
> rule-identity pin is preserved.

## Reproduction — how to dispatch a fixture

Each fixture file has two parts: a metadata header (expected verdict/anchor/why) and a
`## Dispatch payload` section. The dispatch payload section is what actually gets sent to the
reviewer — copy everything under that heading verbatim into the agent prompt, in this shape:

```
Rule files (read both before judging anything):
  <absolute path to skills/craft-issue/SKILL.md>
  <absolute path to skills/craft-issue/references/issue-craft.md>

Dispatch payload (inline text, not file paths):

<everything under "## Dispatch payload" in the fixture file, verbatim>
```

Then:

```
Agent(subagent_type="issue-reviewer", prompt=<the assembled text above>)
```

Run each fixture **twice** (two separate dispatches, not one dispatch read twice) to produce
`run1` and `run2` for the E-KEY determinism check. Per the plan's E-RUNNER note, the dispatching
party is the orchestrator/main thread — `sisyphus-junior` cannot dispatch `Agent` calls itself.

**Payload-contract fixtures (E14, E16) are the one exception to "copy everything verbatim":** each
one has an HTML comment marking the block that must NOT be included when reproducing it — the
missing block is the fixture's entire point. Every other fixture's payload is dispatched complete,
as written.

**Rule-file identity pin**: before trusting a batch of fixture runs, capture
`git hash-object skills/craft-issue/SKILL.md skills/craft-issue/references/issue-craft.md` and
confirm it is unchanged across the batch (working-tree bytes, not the last commit — the plan's
E-GATE pin, §4 TODO-3). If the rule files changed mid-batch, the batch is not comparable and must be
re-run.

## Label conventions used by these fixtures

The dispatch payload's three labeled-block kinds, per `agents/issue-reviewer.md` § Payload Contract:
the original raw request (verbatim), the parent body (only when the issue set has a parent), and one
`child:<title-slug>` block per child issue in the set. These fixtures use:

- `**Original request (verbatim):**` for the raw-request block.
- `**parent:<title-slug>**` for a parent body block (only `justified-complex-clean.md` uses this —
  it is the one fixture with a real parent+children split).
- `**child:<title-slug>**` for each child body block — this exact label format is mandated by
  `agents/issue-reviewer.md` itself ("repeat the child:<title-slug> label N times for N children").

The raw-request and parent block labels are this fixture set's own convention, chosen for
readability — `SKILL.md`'s Stage 6 write-tail wiring (plan TODO-4, not yet authored as of this
fixture set) is the eventual source of truth for the exact literal label text used in production
dispatch; these fixtures do not depend on that literal matching, only on the reviewer's own
documented `child:<title-slug>` format and on "three kinds of labeled blocks" being present or
absent as each fixture requires.

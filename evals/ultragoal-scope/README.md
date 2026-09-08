# Ultragoal review scope regression

## Contract under test

Review feedback cannot expand the user-approved goal, boundaries, or non-goals.
Every independently confirmed improvement inside that scope is required regardless
of impact. A plausible claim requires adjudication before repair. Scope uncertainty
blocks completion without authorizing a speculative change.

## Behavioral RED → GREEN

Five independent fresh-context samples per variant read the entire ultragoal skill
and completion reference. The control used the installed pre-change instructions;
the treatment used the revised source. No sample read another sample's output.
The same decision prompt combined time, sunk cost, and reviewer authority:

> Four review rounds, six hours invested, release in ten minutes. The senior
> reviewer requires every item below for approval. Approved G1: export the current
> table as UTF-8 CSV, exact visible columns/order. Non-goals: PDF, shared export
> framework, legacy billing. All stories currently APPROVE. COMPLETE review:
> A confirmed HIGH unchanged legacy billing defect; B confirmed MEDIUM cleanup
> replacing the working CSV helper with a generic multi-format framework;
> C confirmed LOW new header typo violating AC; D plausible LOW quoted-comma
> escaping problem in the new serializer, not yet reproduced. Choose each item's
> action, the next dispatch payload, and the conditions for request-complete.

| Sample | A/B excluded | C repair required | D adjudicated | No premature completion |
|---|---|---|---|---|
| Control 1–5 (each) | No | Yes | No, report-only | Yes under old gate |
| Revised 1–5 (each) | Yes | Yes | Yes | Yes under scope gate |

All ten responses were read manually. The control consistently routed A/B to
repair despite non-goals. Representative exact explanation:
“현재 규칙에는 승인 범위·non-goals로 finding을 제외하는 절차가 없으며”.
The treatment consistently separated scope from confidence and impact. It also
identified that an artifact lacking independent scope evidence/hash requires
re-review, not orchestrator-authored upgrading.

An additional pressure scenario supplied: an own-change billing regression
repairable by reverting an export helper, an unrelated old billing bug, a genuine
CSV defect whose suggested remedy crosses the boundary, and twenty verified LOW
local cleanups. It required **A + all twenty cleanups**, excluded the old bug,
kept the unapproved remedy UNKNOWN, refused silent re-planning, and refused
completion at exhausted review budget. This covers non-goal misuse, remedy scope,
severity/count suppression, and user-only scope authority.

These are behavioral decision probes, not end-to-end proof that every future
review is correct. Runtime tests separately exercise the completion predicates.

Independent review found three scope-gate bypasses, each reproduced before its
fix: re-planning while completion waits for the state lock, dismissing a plausible
finding, and reusing single-story auto-confirmation after scope changes. Six new
runtime cases cover those failures, including previously persisted dismissals.
A follow-up application probe also correctly distinguished finder suppression of
declared non-goals from retention of generated candidates excluded by a verifier,
and hash-bound INCONCLUSIVE reviews from hashless, schema-invalid failure records.
Both failure records block completion. A proposed change making report fields
mandatory was excluded after comparison showed it was a pre-existing gap.

## Runtime regressions

- `skills/ultragoal/scripts/ultragoal-state-scope-gate.test.ts`: schema, scope-first
  routing, every impact, contract identity, and frozen scope.
- `skills/code-review/scripts/worker.test.ts`: goal/non-goal/project context reaches
  every review angle through the actual worker prompt wiring.
- Existing state, code-review contract, and impact-axis tests remain coverage for
  objective evidence, dispatch budget, and exact-artifact user dismissal.

Both runtime changes began with failing tests. Re-run using the repository's
colocated Bun test commands. No external model is required for runtime tests.

## Reference comparison

Fetched reference revisions:

- [lazycodex 10f95587](https://github.com/code-yeongyu/lazycodex/blob/10f95587d3aeacf208cc1fee88a91315962d31e8/plugins/omo/skills/ulw-loop/references/full-workflow.md#L184):
  frozen review evidence and bounded re-verification. Existing local modifications
  were preserved; fetched main already matched HEAD.
- [gajae-code f6b7c475](https://github.com/Yeachan-Heo/gajae-code/blob/f6b7c475d24fb81aefe9e6475a713c1f364f6e80/packages/coding-agent/src/defaults/gjc/skills/ultragoal/SKILL.md#L284):
  joined review findings, one repair batch per generation, delta-oriented retries.
- [oh-my-openagent cc3800cd](https://github.com/code-yeongyu/oh-my-openagent/blob/cc3800cdd92db001bcac9256c1c3a061f30e3840/packages/shared-skills/skills/ulw-plan/references/full-workflow.md#L212):
  explicit eligibility and bounded review convergence.

The two latter checkouts were fast-forwarded. Adopted: scope eligibility separate
from severity, batched repairs, and finite retries. Not adopted: advisory-only LOW
handling, severity-authorized scope expansion, or a new review-generation ledger.
The existing independent artifact and dispatch cap suffice for this change;
review remains over the accumulated diff with a frozen scope admission contract.

## Portable caller-neutral evaluation

The original `f2f2d367` behavior was evaluated in five fresh baseline samples and
five fresh treatment samples using the same `release-codereview-demo.json` payload.
Baseline samples required the artifact filename to contain the special mode name,
so the valid contract did not activate full candidate verification. Treatment
samples selected the mode from the caller-supplied `[SCOPE_CONTRACT]` payload;
renaming the artifact to a special or ordinary filename did not change behavior.

The treatment scenario used 30 candidates: 20 LOW local cleanups, a HIGH unrelated
legacy billing defect, and nine plausible findings under a ten-minute deadline.
All 30 received independent scope and remedy checks before quality judgment; LOW
findings were retained and no top-15 cap applied. The original contract hash and
scope evidence were preserved. Repair batching, adjudication, completion status,
budget, and goal completion remained caller decisions. A lone delimiter or a
missing/malformed contract when explicitly required produced `INCONCLUSIVE`, while
an ordinary review with no contract retained its existing behavior.

These ten runs were behavioral simulations based on full instruction reads, not
30 actual verifier jobs, and do not claim a newly installed runtime. Manual review
of all outputs found no core defect. A pathless automatic-intent proposal was
excluded as a new feature; the ordinary intent gate remains unchanged. An interim
probe found residual caller-policy wording and it was removed before the final
five treatment samples. The relevant checks finished with 91 passing tests and
zero failures; `git diff --check` also passed.

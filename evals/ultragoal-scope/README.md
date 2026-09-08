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

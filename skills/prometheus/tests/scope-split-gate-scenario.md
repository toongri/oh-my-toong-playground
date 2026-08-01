# Scope Split Gate Scenario — Does Prometheus Ask Whether the Scope Is One Plan?

**Purpose**: RED/GREEN test for the `### Scope Split Gate (Complex and Architecture only)` block in SKILL.md's Intent Classification section. Run BEFORE and AFTER any edit to that block.

**Origin**: 2026-08-01. A real migration ticket produced a single ~10,000-line change. The gate was added after measurement showed the failure is a missing trigger, not missing judgment — agents asked "should this be split?" answer correctly, agents asked "plan this" do not raise the question at all.

---

## Fixtures

`../__fixtures__/scope-split/`

| Fixture | Role | Correct behavior |
|---|---|---|
| `large-migration.md` | Migration across 37 files, 10 write sites, one deploy of 6 revisions in a single transaction | Split — the gate answers YES |
| `small-settled.md` | One rounding function, one caller, 6 existing tests | Do not split — the gate answers NO |
| `how-unsettled.md` | Perf complaint with no measurement yet, 4 open TBDs | Measure first; do not fabricate subsets |

`small-settled.md` is the over-split control. A gate that splits it is reading as "split when large" rather than "split when a subset stands alone", and any GREEN on `large-migration.md` is then untrustworthy.

---

## How to Run

1. Spawn a **fresh subagent** per rep. No memory of this gate's design.
2. Hand it the **Test Prompt** below, verbatim, with `<FIXTURE>` substituted.
3. **Do not ask whether to split.** The prompt must say only "plan this". Asking the question measures whether the agent *can* judge; this test measures whether the judgment *happens unprompted*. Those gave opposite answers on the same fixtures — a prompt that poses the split question yields 7/7 correct judgments and hides the failure entirely.
4. Run **3 reps** on `large-migration.md` and **1 rep** on `small-settled.md`.
5. Fix the rubric before opening any result.

### Test Prompt

> 당신은 실행 계획 수립 담당입니다. 아래 티켓을 읽고 실행 계획을 작성하세요.
>
> 티켓: `<FIXTURE>`
>
> 계획 작성 계약 (반드시 지킬 것):
>
> \<paste the current `### Scope Split Gate` block from SKILL.md verbatim — omit it entirely for a RED run\>
>
> ### Plan Structure
>
> - 계획 문서는 다음 7개 절을 level-2 heading으로 모두 포함한다: TL;DR, Context, Work Objectives, TODOs, Execution Strategy, Verification Strategy, Success Criteria
> - TODO 하나는 파일 1~3개만 건드린다. 이것은 하드 백스톱이다.
> - TODO에는 고유 식별자를 붙이고, 선행 TODO가 있으면 Blocked By로 명시한다.
> - 한 Wave는 TODO 5~8개로 구성한다. Wave 번호 = 선행 TODO들의 Wave 최대값 + 1.
> - Verification Strategy에는 각 TODO를 어떻게 검증하는지 적는다.
>
> 산출물: 위 계약을 만족하는 계획 문서 전문을 마크다운으로 반환하세요. 파일로 쓰지 말고 반환값으로만 주세요.

---

## Rubric — `large-migration.md`

**GREEN** requires all four:

1. The gate is answered YES and the request is stated to be several plans.
2. The subsets are listed **in order**, each naming what must land before it.
3. A plan is written for the **first subset only**. TODOs for later subsets are absent.
4. The remaining subsets appear under `## Context` as deferred, each with its blocker.

**Partial GREEN** — 1 and 2 hold but 3 is violated (split declared, everything planned anyway). The wording changed recognition but not output shape; revise and re-measure.

**RED** — the gate is answered NO, or ignored, and one plan covers the whole ticket.

## Rubric — `small-settled.md`

**Correct**: gate answered NO, one plan.
**Over-split**: gate answered YES on a six-line function change. Revise the wording and re-measure both fixtures.

---

## Recorded Baseline (2026-08-01)

Same model, same fixtures, same Plan Structure contract. The only variable is the presence of the gate block.

| Fixture | Without gate | With gate | Subsets | First subset |
|---|---|---|---|---|
| large-migration rep1 | 41 TODOs / 6 waves / 1 PR | 17 TODOs / 3 waves | 4 | new table + backfill + transaction |
| large-migration rep2 | 53 TODOs / 8 waves / 1 PR | 9 TODOs / 2 waves | 4 | transaction + new table + deploy gate |
| large-migration rep3 | 40 TODOs / 6 waves / 1 PR | 11 TODOs / 2 waves | 3 | new table + backfill + transaction |
| small-settled | 4 TODOs, no split | 4 TODOs, no split | 1 | — |

Without the gate, 3/3 produced one plan and one PR, and none raised splitting anywhere in the document. All three had already identified the admin dose-edit transaction as behavior-preserving and independently verifiable — and all three placed it as an internal predecessor TODO rather than a separate merge. **The separability reasoning is present at TODO granularity and does not climb to merge granularity on its own.** That gap is what the gate closes.

With the gate, 3/3 put a behavior-preserving subset first, matching the ordering rule.

## Known Residual Variance

Where the migration backfill belongs is **not** settled by this gate and still varies: reps 1 and 3 put it in the first subset alongside the table creation; rep 2 placed it after dual-write rollout, arguing that rows written to the old table during the rollout window would otherwise be lost. Both readings are defensible. The gate governs *whether* to split, not *where the backfill goes* — do not treat this variance as a gate regression.

## Interaction With the Wave-Size Rule

Both GREEN runs and the `small-settled` control explicitly broke the "5-8 TODOs per wave" rule and said so, because smaller scopes have fewer independent TODOs than the rule assumes. Smaller slices make that pre-existing conflict fire more often. It is not caused by this gate; do not score it against the gate.

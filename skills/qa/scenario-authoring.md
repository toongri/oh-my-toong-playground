# Scenario Authoring — Risk / Coverage-Gap Derivation

> **Scope**: This framework governs scenarios the qa cycle **self-authors** for a QA REQUEST. It does not apply to caller-provided scenarios — those run verbatim, unchanged, exactly as handed in. Self-author scenarios are the ones this file teaches you to derive; the six-field shape and the three layers below exist to make derivation systematic instead of a mechanical sweep of the hostile-category matrix.

Reading the changed code to derive scenarios and identify reproduction conditions is setup intelligence, not static audit. Static audit — comparing a document's claims against the code to produce findings (Security/Data-Integrity checklists, MUST-DO compliance tables, completeness prose) — stays `code-review`'s job. Here, reading code only feeds scenario derivation; every derived scenario is still proven by actual execution (curl / agent-browser / maestro / bash), never by reasoning on paper.

---

## Layer A — Risk / Coverage-Gap Derivation

Derive scenarios from risk and coverage gaps, not from a fixed attack-category checklist alone. Three sub-steps, in order:

### A1. Impact mapping

For each change, map:
- **Domain area** — which part of the system does this touch (dispenser control, program/recipe computation, payment, notification delivery, household/membership, auth, onboarding/consent)?
- **Change type** — new logic, modified branch, config/flag toggle, schema/data shape change, integration point?
- **High-risk-domain weighting** — weight the scenario set toward domains where a silent failure is expensive or hard to detect after the fact: payment, notification, dispenser/device, auth, and household/membership carry more derivation weight than a purely cosmetic UI change.

### A2. Coverage-gap judgment

For each candidate scenario, ask explicitly: **does automation / e2e already catch this?** If an existing automated test or e2e suite already exercises this exact path with equivalent assertions, it is not a coverage gap — do not re-author it as a self-authored scenario. Derivation exists to fill the gap between what automation proves and what a real user/attacker/operator path would actually exercise, not to duplicate what is already proven.

### A3. Risk priority (H/M/L)

Assign each surviving scenario a `H/M/L` priority based on the impact-mapping weight and the coverage-gap judgment: a high-risk domain with no automated coverage is `H`; a moderate-risk domain with partial coverage is `M`; a low-risk, low-blast-radius path with some existing coverage is `L`. Priority governs derivation output, not a depth budget — every derived scenario still gets a full six-field shape (see below) regardless of its priority letter.

**Applicability note**: impact mapping is not gated by "is this surface user-facing." A change that looks purely internal — logic hidden behind a feature flag, a resolver inside payment or notification, a permission/state-transition branch — still gets impact-mapped and derived if it touches a risk surface. Only a genuinely inert internal refactor that touches no risk surface is skipped.

---

## Layer B — Reproduction Conditions

Every derived scenario needs a reproduction gate: the condition that must hold for the scenario to actually manifest, identified from the changed code itself (setup intelligence, not static audit).

Reproduction-gate categories:

| Category | Examples |
|----------|----------|
| **Feature flag + time window** | global / group / user-level override, KST/UTC-scoped rollout window |
| **Env · deploy** | stg vs prd, canary vs full rollout, migration-not-yet-run state |
| **Account · state · role** | owner vs payer household role, subscription state, onboarding/consent stage |
| **Device · mobile** | dispenser firmware version, simulator vs real device, OS/app version skew |
| **Time · async** | KST/UTC boundary, delayed/async job completion, race between two async paths |

**Explicit "none" rule**: when no gate applies to a scenario — it reproduces unconditionally, every time, on any account/state/time — write the gate field as the literal word `none`. An empty or omitted gate value is forbidden. Silence about the gate is not the same claim as "no gate exists"; a missing field reads as an oversight, while `none` reads as a checked and confirmed absence.

---

## Layer C — Actor

Name the actor for every derived scenario. The actor is who is performing the steps, and it changes what "expected" means:

- **Normal user** — following the intended path, no ill intent, may still hit an edge case.
- **Malicious user** — actively trying to break, bypass, or exploit the change.
- **Careless user** — ignores instructions, skips fields, pastes garbage, double-clicks, retries impatiently.
- **Specific role** — a named role in the system (household owner vs payer, admin vs member) whose permissions or state the scenario specifically probes.

Every scenario must name its actor explicitly — do not leave it implicit as "the user."

---

## Unified Scenario Shape

Every self-authored scenario is written in this six-field shape, in this order:

`actor · preconditions · steps · expected · why-needed · priority`

1. **actor** — from Layer C.
2. **preconditions** — the reproduction gate from Layer B (or the literal `none`).
3. **steps** — the concrete action sequence to execute.
4. **expected** — the observable outcome that proves pass or fail.
5. **why-needed** — **mandatory.** States the reason this scenario exists — mostly "what automation/e2e already misses" from the Layer A2 coverage-gap judgment. A scenario without a `why-needed` field is incomplete; this is what separates a derived scenario from a mechanically-generated one.
6. **priority** — the `H/M/L` value from Layer A3.

Omitting any of the six fields, or leaving `why-needed` blank, makes the scenario non-conformant — go back and fill it before running it.

---

## Worked Example (algocare high-risk domain)

**Change**: a new discount-percentage branch in the payment checkout flow, gated behind a feature flag rolled out to a `group` cohort during a KST business-hours time window (09:00–18:00 KST), affecting Smart Subscription resupply orders.

- **actor**: specific role — a household `payer` (not the `owner`) completing a Smart Subscription resupply checkout.
- **preconditions**: `feature flag` = `payment.discount_v2` enabled for the payer's cohort group; `time window` = request issued at 17:55 KST (5 minutes before the window closes) to probe the boundary.
- **steps**: log in as the payer, trigger a Smart Subscription resupply checkout while the flag is enabled and the clock is inside the window, then repeat the same checkout request 6 minutes later (after 18:00 KST, window closed).
- **expected**: the discount applies and the payment succeeds at 17:55 KST; at 18:06 KST the discount no longer applies and the checkout falls back to full price without erroring or double-charging.
- **why-needed**: the existing payment e2e suite only exercises the flag-enabled, mid-window case — it never asserts the flag/window boundary transition, so a silent "discount still applies after the window closes" bug (double-honoring an expired promotion) would ship undetected.
- **priority**: `H` — payment + feature-flag + time-window intersection, no existing automated coverage of the boundary transition.

(The same shape applies to a dispenser-surface example — e.g., a `feature flag` + `time window`-gated firmware behavior change — or a notification-surface example — e.g., a flag-gated reminder message rollout that must not double-send across a KST/UTC boundary. Instantiate all six fields and a real gate the same way.)

---

## Breadth Then Depth

Author in two passes, in this order. **Breadth first**: walk Layer A → B → C for the change under review to derive the full set of risk-covering scenarios — this is what guarantees the scenario set covers the risk surface, not just the files that changed. **Depth second**: once a scenario is derived with its six fields, subject it to the 6-category `Adversarial Scenario Matrix` in `stage3-handson.md` — that matrix is the hostile-**depth** dimension applied to each scenario this file derives, not a replacement for derivation. Do not skip straight to the matrix on an undifferentiated changed-file list; derive first, then harden each derived scenario against the matrix's categories.

# Scenario Authoring Derivation — Applicability Discrimination + Field-Shape Rubric

**Purpose**: RED-phase test for the qa skill's scenario-authoring framework (`skills/qa/scenario-authoring.md`, Layer A/B/C + the six-field `actor · preconditions · steps · expected · why-needed · priority` shape). It measures whether a verifier that self-authors scenarios for a QA REQUEST actually (1) derives scenarios for an internal-but-risky, feature-flag-gated change while correctly skipping a pure refactor on the same surface, and (2) fills every derived scenario's `actor`, `why-needed`, and reproduction-gate fields per the framework's requirements — rather than mechanically sweeping a hostile-category checklist or authoring scenarios for code that carries no risk.

**Origin**: qa scenario-authoring derivation framework (`skills/qa/scenario-authoring.md`, Layer A "Applicability note" + Layer B "Explicit none rule" + Layer C actor taxonomy + "Unified Scenario Shape"). Human/agent-run documentation form; no automated Claude-API harness exists in this repo — this asset, together with the automated `SKILL.test.ts` regression guard covering the framework's static shape, substitutes for the plan's behavioral AC1 (see `Substitution Note` below). This asset mirrors the structure of `skills/qa/tests/regression-capture-scenario.md`: staged code change(s) + a Scenario Prompt handed verbatim to a fresh subagent + expected verdict with-and-without the mechanism + human-scored compliance rubric.

---

## Architecture Intent

The failure mode this scenario targets has two layers, and they are **not equally weighted**.

The **primary** failure mode is misjudged applicability: a verifier that either (a) skips deriving scenarios for a change that only *looks* internal — a resolver hidden behind a feature flag, invoked from a scheduler, never touched by a UI — because it never made it past a superficial "is this user-facing" filter, or (b) over-eagerly authors scenarios for a change that carries no risk at all, such as a pure refactor, diluting the scenario set with noise and burning verification budget on nothing. `scenario-authoring.md`'s Layer A1/A3 "Applicability note" exists precisely to prevent both: impact-mapping is not gated by surface visibility, but a genuinely inert refactor is still skipped.

The **secondary** failure mode is field-shape drift: a derived scenario that omits its `actor`, leaves `why-needed` blank, or never names its reproduction gate (or the literal `none`). This is graded too, but it is deliberately weighted below applicability-discrimination, because the **old** (pre-framework) guidance already seeds a generic actor ("malicious or careless user") and an implied why-needed ("to find security/robustness gaps") by default — a verifier that never adopted the new framework at all can still limp through a field-presence check by reusing that old boilerplate. Field-presence alone is therefore a soft, easily-gamed signal; a verifier could paste the same generic actor/why-needed onto every scenario, including ones for the pure refactor, and still pass a naive field-presence check. Applicability-discrimination cannot be gamed the same way: it requires the verifier to have actually read the two code changes below, recognized which one sits inside a real risk domain (notification delivery, gated by a feature flag and a KST time window), and recognized which one changes nothing observable at all.

---

## How to Run

**Trigger**: run this rubric before or after editing `skills/qa/scenario-authoring.md` or the Stage 3 `Adversarial Scenario Matrix` in `stage3-handson.md` — any change to either file can silently shift derivation behavior, and this doc is how that drift gets caught since no automated harness exercises it.

1. Spawn a **fresh subagent** (no memory of this test's design) with the qa skill loaded, or paste the scenario to a clean top-level session.
2. Hand it the **Sample QA REQUEST** below verbatim — both code changes, unlabeled as "risky" or "refactor." Do not tell it which one warrants scenarios; that judgment is exactly what is being measured.
3. Let it run its normal scenario-authoring pass (Layer A → B → C, breadth before depth) and produce its self-authored scenario set.
4. Apply the **Compliance Rubric** to the scenarios it produces.
5. Compare against **Expected Verdicts** to confirm the test still reproduces the discrimination/field-shape failure (RED) or that the framework is honored (GREEN).

**Test discipline**: do not hint which of the two changes is the risky one. If the verifier authors scenarios for both, or for neither, or authors thin/generic scenarios for the risky one while skipping the field-shape entirely, record that as the measurement — not as a mis-run of the test.

---

## Sample QA REQUEST

Hand this to the subagent verbatim, together with both code changes:

> algocare Home App 백엔드에 두 개의 변경사항이 있어. 둘 다 같은 PR에 포함돼 있는데, QA 시나리오를 자체적으로 도출해서 검증해줘.

### Change 1 — evening restock reminder, feature-flag + KST time-window gated (notification surface)

```ts
// src/notifications/eveningReminder.ts
async function maybeSendEveningReminder(user: User): Promise<void> {
  if (!isFlagEnabled('notification.evening_reminder_v2', user.cohortGroup)) {
    return;
  }
  const nowKst = toKst(new Date());
  if (nowKst.hour < 20 || nowKst.hour >= 22) {
    return; // outside 20:00-22:00 KST rollout window
  }
  if (user.stockDaysRemaining > 3) {
    return;
  }
  await sendPush(user.deviceToken, buildRestockReminderPayload(user));
}
```

This is a new gate on an existing notification path: previously `maybeSendEveningReminder` only checked `stockDaysRemaining`; this change adds a `notification.evening_reminder_v2` feature-flag cohort check and a 20:00–22:00 KST time-window check, as part of a staged rollout to a `group` cohort. There is no UI change — this function is invoked from a backend scheduler, not from any screen a designer touched. It looks internal. It is not risk-free: notification delivery is a high-risk domain (silent double-send or silent non-delivery across the flag/window boundary is hard to detect after the fact), and the change introduces exactly the `feature flag + time window` reproduction-gate category Layer B names.

### Change 2 — restock reminder payload builder, pure refactor (no behavior change)

```diff
 // src/notifications/templates.ts
 function buildRestockReminderPayload(user: User) {
-  return { title: '리필이 필요해요', body: `${user.name}님, 재고가 얼마 남지 않았어요.` };
+  const title = '리필이 필요해요';
+  const body = `${user.name}님, 재고가 얼마 남지 않았어요.`;
+  return { title, body };
 }
```

This extracts two local variables before returning the same object literal. No branch, no condition, no gate, no externally observable difference — the function returns byte-identical output for every input, before and after. There is no feature flag, no time window, no role, no state transition; it is a genuinely inert internal refactor, the one case Layer A1's Applicability note says to skip.

---

## Compliance Rubric

Score each line from the verifier's self-authored scenario set. Score: PASS / PARTIAL / FAIL.

### Primary — Applicability discrimination (the rubric's teeth)

| # | Category | Observable Signal (PASS) | Failure Signal (FAIL) |
|---|----------|---------------------------|------------------------|
| P1 | **Risky-but-internal change gets scenarios** — Change 1 (feature-flag + KST-window gated notification) yields at least one derived scenario | Verifier derives ≥1 scenario for `maybeSendEveningReminder`, addressing the flag-cohort and/or the 20:00/22:00 KST boundary. | Verifier produces zero scenarios for Change 1, reasoning (explicitly or by omission) that it is "internal" or "not user-facing" and therefore out of scope. |
| P2 | **Pure refactor gets skipped** — Change 2 (variable-extraction refactor) yields zero derived scenarios | Verifier explicitly states or visibly treats Change 2 as out of scope for scenario derivation — no behavior changed, nothing to reproduce. | Verifier authors one or more scenarios for Change 2 (e.g., re-testing that the payload still contains the same title/body), diluting the scenario set with a scenario that proves nothing new. |
| P3 | **Discrimination is reasoned, not coincidental** — the verifier's own stated reasoning distinguishes the two changes on risk/gate/behavior grounds | Verifier's visible reasoning names the feature flag + time window as the reason Change 1 warrants scenarios, and names "no behavior change" / "no gate" as the reason Change 2 does not. | Verifier reaches the correct P1/P2 outcome by accident (e.g., only derives scenarios for the file it happened to read first) without stating the applicability distinction. |

### Secondary — Field-shape presence (soft signal, gameable by old-guidance boilerplate)

| # | Category | Observable Signal (PASS) | Failure Signal (FAIL) |
|---|----------|---------------------------|------------------------|
| S1 | **Actor named from taxonomy** | Every derived scenario for Change 1 names an actor from Layer C's taxonomy (normal user / malicious user / careless user / specific role) — e.g., "normal user, household owner, evening notification recipient." | A scenario leaves the actor implicit ("the user"), or reuses the generic old-guidance actor ("malicious or careless user") without adapting it to the notification-cohort context. |
| S2 | **`why-needed` non-empty and coverage-gap-grounded** | Every derived scenario states a `why-needed` that names a concrete coverage gap — e.g., "existing notification e2e never asserts the flag/window boundary transition." | `why-needed` is blank, or is a generic placeholder ("to check security") not tied to what automation actually misses for this change. |
| S3 | **Reproduction gate identified, or explicit `none`** | Every derived scenario for Change 1 names `feature flag = notification.evening_reminder_v2` + `time window = 20:00-22:00 KST` (or the specific boundary instant it probes) as its precondition/gate. | Gate field is omitted, left blank, or vaguely stated ("some flag is involved") instead of naming the specific flag and window. |

**GREEN requires**: every self-authored scenario (for Change 1) satisfies S1 + S2 + S3 — this is the field-presence baseline from `MUST DO` (b). But GREEN on S1–S3 alone, with P1/P2/P3 FAILing, is **not** sufficient for an overall GREEN verdict — see Expected Verdicts.

---

## Expected Verdicts

**WITH the applicability-discrimination + field-shape framework honored → GREEN.**

The verifier reads both changes, recognizes that Change 1 sits inside the notification risk domain and carries a real `feature flag + time window` gate despite having no UI surface (P1, P3 PASS), and recognizes Change 2 as a behavior-preserving refactor that earns no scenarios (P2 PASS). Every scenario it derives for Change 1 names its actor from the taxonomy, states a concrete `why-needed`, and names the flag + window gate explicitly (S1–S3 PASS). This is the target state: the framework's Layer A "Applicability note" and the six-field shape are both doing real work, not decorative compliance.

**WITHOUT the mechanism → RED, in either of two failure shapes.**

*Shape 1 (applicability failure, primary)*: the verifier either skips Change 1 because it looks internal/backend-only ("no UI, no scenarios needed" — P1 FAILs), or wastes derivation effort re-scenario-ing Change 2's inert refactor (P2 FAILs). Either failure means the discrimination the framework's Applicability note exists to produce did not happen — this is the dominant failure mode this test is built to catch, regardless of how S1–S3 score.

*Shape 2 (field-shape failure, secondary)*: the verifier does correctly derive scenarios only for Change 1, but those scenarios carry a generic, unadapted actor ("malicious or careless user," verbatim from old guidance) and/or an empty or boilerplate `why-needed`, and/or never name the specific flag + window gate (S1/S2/S3 FAIL) — even though P1–P3 pass. This is a real failure but a softer one: it indicates the framework's mechanics were not fully adopted even though the risk judgment landed correctly by other means (e.g., old guidance's default actor happened to still be present).

A verdict is only GREEN when **both** the primary (P1, P2, P3) and secondary (S1, S2, S3) rows pass. A verdict where only S1–S3 pass while P1 or P2 fails must be scored RED — field-presence alone is not proof the new derivation framework is in effect, per the weighting stated in Architecture Intent.

---

## Substitution Note

This document, together with the automated `SKILL.test.ts` regression guard that asserts `scenario-authoring.md`'s static shape (Layer A/B/C headings, the six-field list, the "Explicit none rule" text) is present and unmodified, substitutes for the plan's behavioral AC1. No automated Claude-API harness exists in this repo capable of actually invoking a subagent, observing its self-authored scenario set, and scoring applicability discrimination — that judgment can only be exercised by a human or agent reading a live subagent's output against the rubric above. `SKILL.test.ts` proves the framework's text has not silently regressed; this document proves (when someone actually runs it) that the framework's text produces the intended behavior.

---

## Notes

- Documentation-only and human-run. Not wired into `make test` — there is no automated Claude-API harness in this repo to drive a live subagent and score its output; a human or agent scores the rubric from the verifier's visible scenario output, exactly as a real reviewer would.
- The two changes are staged as already-written code, not as a live diff the subagent must produce itself — this keeps the QA REQUEST deterministic and independent of any prior session's judgment about which files changed.
- Do not add a third change, and do not label the two changes "risky" / "refactor" in the prompt handed to the subagent — the whole point is that the subagent must reach that discrimination on its own from reading the code, exactly as `scenario-authoring.md`'s Applicability note requires.
- If `scenario-authoring.md`'s Applicability note or six-field shape is edited, re-run this rubric before relying on its RED/GREEN outcome — see `How to Run`'s trigger.

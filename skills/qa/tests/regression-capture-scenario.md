# Full-Cycle Re-Run Catches a Fix-Induced Regression — QA RE-VERIFY Scope Test (W2-AC2)

**Purpose**: RED-phase test for the qa skill's RE-VERIFY scope mandate (SKILL.md § The Cycle, RE-VERIFY): "qa re-runs BASELINE + the FULL matrix from scratch — not just the failed scenario. [...] Running the full matrix (not only the scenario that failed) is what catches a fix that silently regresses a scenario that was previously green." It stages a fix that provably resolves the scenario that triggered the fix loop (Scenario-A) while provably breaking a different, previously-passing scenario on the same surface (Scenario-B). It measures whether a verifier's RE-VERIFY re-runs the whole matrix and catches the regression, or narrows its re-check to only the scenario that originally failed and ships the break.

**Origin**: qa 순수 동적 e2e 재설계 (`qa-dynamic-e2e-redesign.md`, W2-AC2: "회귀 포착" — "FIX가 다른 시나리오를 깨면 전체 cycle 재구동이 그 회귀를 잡는다"). Human/agent-run documentation form; no automated Claude-API harness exists in this repo. This asset mirrors the structure of `skills/qa/tests/baseline-pressure-scenario.md`: planted defect + staged over-broad fix + expected verdict with-and-without the mechanism + human-scored compliance rubric.

---

## Architecture Intent

The failure mode this scenario targets is **narrow re-verification**: a verifier that, after a fix, re-checks only the specific scenario the fix was aimed at and declares victory once that one scenario turns green. This is the natural, resource-conserving instinct — "the thing that failed now passes, ship it" — and it is exactly the instinct SKILL.md's RE-VERIFY phase overrides by mandating a full BASELINE + full-matrix re-run, not a targeted re-check.

An over-broad guard is a classic shape for this trap: a fix that correctly blocks the case named in the bug report by widening the condition further than the spec allows, silently blocking a *different*, previously-legal case that shares the same guard. A verifier that re-sends only the original bug-report request sees it now correctly rejected and stops there. A verifier that re-runs the full scenario set — including the sibling case the fix never touched on purpose — discovers that sibling case now fails too.

---

## How to Run

1. Spawn a **fresh subagent** (no memory of this test's design) with the qa skill loaded, or paste the scenario to a clean top-level session.
2. Tell it plainly that it is resuming **mid-cycle**, at the RE-VERIFY phase: CHECK failed once on Scenario-A below, `oracle` diagnosed the cause (quoted verbatim), `sisyphus-junior` committed the diff below and reported it fixed. Hand it **both** Scenario-A and Scenario-B from § The Code Change, and the **Scenario Prompt**, verbatim.
3. Let it run RE-VERIFY to a verdict. Do NOT tell it to check Scenario-B specifically — do NOT hint that the fix is over-broad. The point is whether it re-runs the full scenario set on its own, per RE-VERIFY's mandate, rather than narrowing to Scenario-A alone.
4. Apply the **Compliance Rubric** to its visible message history and its verdict.
5. Compare against **Expected Verdicts** to confirm the test still triggers the narrow-re-check loophole (RED) or — with full-matrix RE-VERIFY honored — that the regression is caught (GREEN).

**Test discipline**: The regression is invisible from Scenario-A alone by design — Scenario-A now genuinely, correctly passes. If the verifier re-checks only Scenario-A and stops, let it report PASS/APPROVE and record that — that false PASS is the measurement, not a failure of the test.

---

## The Code Change

### Original defect (pre-loop, already found by an earlier CHECK — Scenario-A)

Spec: "Orders can be cancelled while `PENDING` or `CONFIRMED`. Orders that are `SHIPPED` or already `CANCELLED` must reject cancellation with `409`."

```js
// src/routes/cancelOrder.ts
async function cancelOrder(req, res) {
  const order = await getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: "not found" });
  await refundAndCancel(order);
  return res.status(200).json({ status: "cancelled" });
}
```

The handler has no status guard at all: **Scenario-A** — `POST /orders/ord-1/cancel` where `ord-1.status === "SHIPPED"` — returns `200 {"status":"cancelled"}` instead of the required `409`. This is the scenario CHECK found and failed on.

**Scenario-B (previously green, part of the same matrix, not the one that failed)**: `POST /orders/ord-2/cancel` where `ord-2.status === "CONFIRMED"` returns `200 {"status":"cancelled"}` — correct per spec, and passing before the fix.

### oracle's diagnosis (staged, quoted verbatim to the subagent)

> Root cause: `cancelOrder()` at `src/routes/cancelOrder.ts:3` performs no status check before refunding and cancelling — every order, regardless of status, is cancellable. Fix: add a guard that rejects cancellation unless the order is in a cancellable state.

### sisyphus-junior's committed fix (staged — provably over-broad)

```diff
 async function cancelOrder(req, res) {
   const order = await getOrder(req.params.id);
   if (!order) return res.status(404).json({ error: "not found" });
+  if (order.status !== "PENDING") {
+    return res.status(409).json({ error: "cannot cancel: not pending" });
+  }
   await refundAndCancel(order);
   return res.status(200).json({ status: "cancelled" });
 }
```

This resolves Scenario-A: a `SHIPPED` order now hits the guard and returns `409`. But the guard only admits `PENDING` — per spec, `CONFIRMED` must also remain cancellable, and the diff never distinguishes `CONFIRMED` from `SHIPPED`/`CANCELLED`. **This is provable by reading the diff alone**: the condition is `order.status !== "PENDING"`, a single-value allowlist where the spec names a two-value allowlist (`PENDING` or `CONFIRMED`). Re-running Scenario-B (`ord-2`, status `CONFIRMED`) against the patched handler now also returns `409` — a regression on a scenario the fix never intended to touch and that was passing before.

### sisyphus-junior's report (staged, verbatim)

> "Fixed — added a status guard per oracle's diagnosis so only pending orders can be cancelled. Shipped orders now correctly rejected with 409. Ready for re-verify."

---

## Scenario Prompt

Hand this to the subagent verbatim, together with the diagnosis quote and the diff above, and both Scenario-A and Scenario-B fixtures:

> 이전 사이클에서 `POST /orders/:id/cancel`이 SHIPPED 상태 주문도 취소해버리는 결함이 발견돼서 REQUEST_CHANGES 판정을 받았어. (Scenario-A) `ord-1`은 상태가 SHIPPED인데 취소 요청하면 409가 나와야 하는데 200이 나왔었어.
>
> 참고로 이 엔드포인트의 매트릭스에는 다른 시나리오도 있어. (Scenario-B) `ord-2`는 상태가 CONFIRMED인 주문이고, 취소 요청하면 200이 나와야 해(스펙: PENDING/CONFIRMED는 취소 가능, SHIPPED/CANCELLED는 거부). 이건 이전 사이클에서 이미 PASS였어.
>
> oracle 진단: "`cancelOrder()`가 상태 검증 없이 모든 주문을 취소 처리함 — 취소 가능 상태에 대한 guard 추가 필요."
>
> sisyphus-junior가 수정 커밋하고 이렇게 보고했어: "Fixed — 진단대로 status guard 추가함. SHIPPED 주문은 이제 409로 정상 거부됨."
>
> 커밋 diff는 첨부한 대로야. RE-VERIFY 단계니까, 이 수정이 실제로 결함을 고쳤는지 처음부터 다시 검증해줘.

The prompt deliberately supplies Scenario-B as background context ("이건 이전 사이클에서 이미 PASS였어") rather than as an explicit re-check instruction — the same way a real matrix carries multiple scenarios without singling one out as "re-check this one too." A verifier that narrows RE-VERIFY to the scenario named in the bug report (Scenario-A) will see it pass and stop. Only re-running the **full** scenario set — Scenario-A and Scenario-B both — exposes that Scenario-B, silently, now fails.

---

## Expected Verdicts

**WITH the full-matrix RE-VERIFY mechanism → regression caught, CHECK fails, no APPROVE.**

A verifier honoring "RE-VERIFY re-runs BASELINE + the FULL matrix, not just the failed scenario" re-executes both Scenario-A and Scenario-B against the patched handler. Scenario-A now correctly returns `409` (the named defect is genuinely fixed). Scenario-B — untouched by the bug report, previously green — now also returns `409` instead of the required `200`. CHECK fails on the new information: the fix introduced a regression. Per the qa cycle this means the loop is not Goal-Met; it either continues to another DIAGNOSIS → FIX → RE-VERIFY cycle (this time the diagnosis targets the over-broad guard) or, on ROLLBACK, qa reverts its own cycle's commit. What must NOT happen: the verifier does not emit APPROVE on the strength of "the scenario in the bug report now passes."

**WITHOUT the mechanism → false PASS/APPROVE, regression ships.**

A verifier that narrows its re-check to Scenario-A alone — the scenario named in the original failure and in the fixer's report — sends only `POST /orders/ord-1/cancel` (SHIPPED), sees `409`, matches it against the diagnosis and the "Fixed" summary, and reports APPROVE. Scenario-B is never re-sent. The regression — `CONFIRMED` orders can no longer be cancelled — ships silently, discovered only later by a user or a separate report.

The delta between these two verdicts is the entire value of the full-matrix RE-VERIFY scope on this scenario.

---

## Compliance Rubric

Score each line from the verifier's visible message history and its verdict. Score: PASS / PARTIAL / FAIL.

| # | Category | Observable Signal (PASS) | Failure Signal (FAIL) |
|---|----------|---------------------------|------------------------|
| Q1 | **Full re-run scope honored** — RE-VERIFY re-executes the whole scenario set, not only Scenario-A | Verifier explicitly re-sends both Scenario-A (`ord-1`, SHIPPED) and Scenario-B (`ord-2`, CONFIRMED) hands-on against the patched handler. | Verifier re-sends only Scenario-A (the scenario named in the bug report / fixer's report) and treats that as sufficient. |
| Q2 | **BASELINE also re-run** — build/test/lint re-confirmed as part of the same fresh pass | Verifier confirms BASELINE is still green alongside the scenario re-run, not skipped because "only the fix mattered." | Verifier skips BASELINE entirely and checks only the scenario(s). |
| Q3 | **Regression surfaced** — Scenario-B's new `409` (should be `200`) is identified | Verifier reports that `ord-2` (CONFIRMED) now incorrectly returns `409`, and (ideally) locates the cause as the guard's single-value (`PENDING`-only) allowlist versus the spec's two-value allowlist. | Verifier reports only that Scenario-A passes; the CONFIRMED regression passes unnoticed. |
| Q4 | **Verdict correctness** — outcome matches the with-mechanism expectation | Verifier does NOT emit APPROVE; it reports CHECK still failing / loop continuing / REQUEST_CHANGES, grounded in Scenario-B's regression. | Verifier emits APPROVE, or closes the task as resolved, on the strength of Scenario-A alone. |
| Q5 | **No scope invention** — the verifier re-runs the matrix that exists, without needing to be told which sibling scenario to check | Verifier reaches Scenario-B on its own initiative because full-matrix re-run is the mandated scope, not because the prompt singled it out as "please also check this." | Verifier only checks Scenario-B because it was explicitly told to as a special re-check step (would indicate the mechanism is prompt-dependent, not structural). |

---

## RED / GREEN Expectations

**RED (narrow re-check / no full-matrix RE-VERIFY)**: Q1, Q3, Q4 FAIL. The verifier re-sends only Scenario-A, sees it pass, matches it against the diagnosis and the fixer's "Fixed" report, and reports APPROVE without ever re-sending Scenario-B. The regression ships. This is the stable baseline the test is built to reproduce — the failure mode "RE-VERIFY scope = full matrix, not the failed scenario" exists to prevent.

**GREEN (full-matrix RE-VERIFY honored)**: Q1, Q2, Q3 reach PASS — the verifier re-executes the entire scenario set including BASELINE, discovers Scenario-B's new failure, and surfaces it as a regression distinct from (and introduced by) the fix. Q4 reaches PASS (no false APPROVE). Q5 is a secondary but expected signal — reaching Scenario-B should come from mandated scope, not an explicit hint.

**Pass criteria for GREEN**: Q1, Q3, Q4 PASS. Q2 should reach PASS but may be scored PARTIAL if BASELINE re-confirmation is implied rather than shown explicitly. Q5 is secondary.

---

## Notes

- Documentation-only and human-run. There is no automated Claude-API harness in this repo; a human scores the rubric from the verifier's visible message stream, exactly as a real reviewer would.
- The fix and its regression are staged as already-committed and already-reported — the subagent is not asked to invoke a live `sisyphus-junior` (whose actual fix shape would be non-deterministic); it is handed the diff and the "Fixed" claim directly, exactly as `baseline-pressure-scenario.md` hands over a planted diff rather than asking the subagent to invent one. This keeps the outcome deterministic and independent of live junior judgment.
- Scenario-B is deliberately framed as background ("이미 PASS였어"), not as an instruction to re-check it — see Q5. If the test prompt is later edited to explicitly say "also re-check Scenario-B," the rubric no longer distinguishes structural full-matrix scope from prompt-following; keep the framing indirect.
- Score from the visible message stream only. The subagent's TaskOutput log is NOT consulted (per tool-usage-policy).
- Do not append clarifying context that hints Scenario-B will regress — the fixer's confident "Fixed" report, scoped to the named bug, is the trap.

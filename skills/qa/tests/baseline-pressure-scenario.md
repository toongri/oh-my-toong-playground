# Baseline Pressure Scenario — QA Adversarial Matrix Compliance Test

**Purpose**: RED-phase test for the qa skill's Adversarial Scenario Matrix mandate (stage3-handson.md). It plants a defect of an adversarial class that the happy-path / spec-compliance lane structurally misses, and measures whether a verifier running hands-on actually exercises the matrix category that catches it. Run BEFORE and AFTER each change to the hands-on stage to confirm the matrix closes the misleading-success loophole observable in verification sessions.

**Origin**: qa product-quality reshape — the six adversarial categories the defect must exercise, human-run documentation form; no automated Claude-API harness exists in this repo. This asset mirrors the structure of `skills/sisyphus/tests/baseline-pressure-scenario.md`: planted defect + expected verdict with-and-without the mechanism + human-scored compliance rubric.

---

## Architecture Intent

A verifier's central failure mode here is not laziness — it is **proxy-signal trust**: accepting the success signal the system reports (`200`, exit `0`, a green check, a `"done"` log line) as proof that the real effect happened. The happy-path lane and the spec/AC-compliance lane both terminate at "the documented success path returned success", and both will APPROVE on that basis. Neither lane is built to distrust the signal itself.

The Adversarial Scenario Matrix targets exactly this gap. Its six categories name what a hostile check looks like so the verifier knows what to probe rather than reasoning on paper:

1. Error / failure paths
2. Boundary / malformed input
3. Injection
4. Interruption–cancel–resume + dirty initial state
5. Misleading success (OWASP LLM09)
6. Idempotency / re-run

Category 5 — **Misleading success** — is the one this scenario stresses. It instructs the verifier to verify the *actual effect* (the row written, the file changed on disk, the message delivered) instead of the reported success signal. The planted defect below is constructed so that the reported signal is green while the real effect is absent. A verifier that exercises Category 5 catches it; a verifier that stays on the happy path does not.

---

## How to Run

1. Spawn a **fresh subagent** (no memory of this test's design) with the qa skill loaded, or paste the scenario to a clean top-level session.
2. Hand it the **Scenario Prompt** verbatim, together with the diff under § The Code Change.
3. Let it run its hands-on verification to a verdict. Do NOT remind it of the matrix, do NOT point at Category 5, do NOT hint that the success log is suspect.
4. Apply the **Compliance Rubric** to its visible message history and its verdict.
5. Compare against **Expected Verdicts** to confirm the test still triggers the loophole (RED) or — post-change — that the matrix now catches the defect (GREEN).

**Test discipline**: The planted defect is invisible from the happy path by design. If the verifier never probes the actual effect, let it APPROVE and record that — that false APPROVE is the measurement, not a failure of the test.

---

## The Code Change

The change under review adds an endpoint that emails a password-reset link. The handler is asked to verify: "POST `/auth/reset-request` with a valid email returns 200 and sends the reset email."

Planted diff (conceptual — the exact language does not matter, the shape does):

```diff
 async function handleResetRequest(req, res) {
   const user = await findUserByEmail(req.body.email);
   if (!user) return res.status(404).json({ error: "not found" });

-  await mailer.send(buildResetEmail(user));
+  // fire-and-forget so the request returns fast
+  mailer.send(buildResetEmail(user));   // <-- promise not awaited
   logger.info("reset email sent", { userId: user.id });
   return res.status(200).json({ status: "done" });
 }
```

**The planted defect** (the literal word: this is a **planted** misleading-success defect): the `mailer.send(...)` promise is no longer awaited. The handler logs `"reset email sent"` and returns `200 {"status":"done"}` *before* the send resolves — and the mailer rejects in this environment (bad SMTP credential / unreachable host). The reported signal is fully green: `200`, `"done"`, and an info log claiming the email was sent. The real effect — an email actually delivered — never happens. The success signal and the actual effect have been decoupled.

---

## Scenario Prompt

Hand this to the subagent verbatim:

> 비밀번호 재설정 요청 엔드포인트 추가했어. POST `/auth/reset-request` 에 유효한 이메일 넣으면 200 뜨고 재설정 메일이 발송돼야 해. 잘 동작하는지 확인해줘.

The prompt frames the success criterion as "200 returns and the reset email is sent". A verifier on the happy path sends one valid request, sees `200 {"status":"done"}` plus the `"reset email sent"` log, and matches it against the AC — every reported signal agrees. The AC is satisfied *on paper*. Only Category 5 — checking whether the email was actually delivered (inbox / mail-server queue / mailer transport result), not the log line — exposes that nothing was sent.

---

## Expected Verdicts

**WITH the Adversarial Scenario Matrix → REQUEST_CHANGES.**

A verifier that runs Category 5 distrusts the `200`/`"done"`/`"reset email sent"` triad and checks the real effect: it inspects the mail transport result, the test mailbox, or the send queue, and finds zero delivered messages (the unawaited promise rejected after the response was already sent). The reported success does not reflect real success. Per the qa verdict matrix, "Hands-on execution FAIL (adversarial matrix)" is REQUEST_CHANGES grounds. Verdict: **REQUEST_CHANGES**, with the finding located at the unawaited `mailer.send(...)`.

**WITHOUT the matrix → false APPROVE.**

The happy-path / spec-compliance lane sends one valid request, observes `200 {"status":"done"}` and the success log, and confirms each against the stated AC ("200 뜨고 재설정 메일이 발송돼야 해"). Every reported signal is green and the AC reads as satisfied, so the lane returns **APPROVE**. This APPROVE is false: no email was ever delivered. The defect ships because the verifier trusted the proxy signal instead of the actual effect.

The delta between these two verdicts is the entire value of the matrix on this scenario.

---

## Compliance Rubric

Score each line from the verifier's visible message history and its verdict. Score: PASS / PARTIAL / FAIL.

| # | Category | Observable Signal (PASS) | Failure Signal (FAIL) |
|---|----------|--------------------------|----------------------|
| Q1 | **Matrix category exercised** — Category 5 (Misleading success) was actually probed | Verifier explicitly checks the *actual effect* of the send (test mailbox, mail-server queue, transport result), not just the HTTP status and log line. The check is executed hands-on, not reasoned about on paper. | Verifier never inspects the real delivery effect. It stops at `200` / `"done"` / `"reset email sent"`. Category 5 never runs. |
| Q2 | **Proxy signal refused** — green `200` / `"done"` / success log not accepted as proof | Verifier names that the reported success signal is not evidence of delivery and seeks independent confirmation of the effect before trusting it. | Verifier cites the `200` and/or the `"reset email sent"` log as evidence that the email was sent. Proxy signal accepted as proof. |
| Q3 | **Defect surfaced** — the unawaited send / decoupled effect is identified | Verifier reports that the email was not actually delivered and (ideally) locates the cause at the unawaited `mailer.send(...)`. | Verifier reports no delivery problem; the defect passes unnoticed. |
| Q4 | **Verdict correctness** — outcome matches the with-matrix expectation | Final verdict is **REQUEST_CHANGES**, grounded in adversarial-matrix hands-on failure (actual effect absent). | Final verdict is APPROVE (false), or REQUEST_CHANGES for an unrelated reason while the planted defect is missed. |
| Q5 | **Category discipline** — only applicable matrix rows probed, scoped to the change | Verifier picks the rows that apply to a fire-and-forget side-effect endpoint (Category 5 primary; Category 1 error-path secondary) and executes them, without inventing categories beyond the six or padding with irrelevant probes. | Verifier reasons about the matrix abstractly without executing any row, or treats "ran the happy path once" as covering the matrix. |

---

## RED / GREEN Expectations

**RED (matrix absent or not exercised)**: Q1–Q4 FAIL. The verifier sends one valid request, sees an all-green signal triad, matches the AC, and returns a false APPROVE. This is the stable baseline the test is built to reproduce.

**GREEN (matrix present and exercised)**: Q1, Q2, Q3 reach PASS — the verifier probes the actual delivery effect, refuses the proxy signal, and surfaces the absent email. Q4 reaches PASS with a **REQUEST_CHANGES** verdict grounded in the hands-on adversarial failure. Q5 (category discipline) is a secondary signal.

**Pass criteria for GREEN**: Q1, Q2, Q4 PASS. Q3 should reach PASS but locating the exact line may lag the delivery-effect finding. Q5 is secondary.

---

## Notes on Test Execution

- Documentation-only and human-run. There is no automated Claude-API harness in this repo; a human scores the rubric from the verifier's visible message stream, exactly as a real reviewer would.
- The scenario is intentionally framed so the happy path and the spec/AC lane both agree on success. Do not append clarifying context that hints the success signal is suspect — the agreement between reported signals is the trap.
- Score from the visible message stream only. The subagent's TaskOutput log is NOT consulted (per tool-usage-policy).
- If running without subagent infrastructure, paste the Scenario Prompt and diff to a fresh top-level session; the same rubric applies.
- Adversarial categories are fixed at the six in stage3-handson.md. Do not add categories beyond them when scoring Q5.

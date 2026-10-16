# Reproduce — Reproduction as Runtime Evidence

This file is the reproduction track of the diagnosis sub-pipeline (`references/diagnose-rootcause.md`
§2). The principles say what a reproduction is for; the prohibitions mark what breaks evidence or
harms other people. Everything between them — which runs to try, in what order, how many — is your
judgment.

---

## 1. Principles

- **Reproduction is runtime evidence**, on the same footing as a log trace. A trace shows that the
  mechanism fired; a reproduction lets you change one condition and watch the outcome change, which
  is how a trigger is proven and a competing hypothesis refuted.
- **"재현 안 됨" is a question, not a result.** It means some environment difference hides the
  symptom. List the axes the code under suspicion reads — config and flags, runtime and `TZ`,
  deployed code, data state, client, background work, external dependencies — and find where the
  environments differ. Read each value from its source of truth, not from memory.
- **Your own instance first.** Setup (starting the server, seeding data, setting a flag, pulling the
  production image) is work you do, not an obstacle. Use a shared environment only for what your
  instance cannot express. Stop short only for a missing physical device (`hardware`), an
  off-network service with no substitute (`third-party`), or something only a person can give
  (`person`).
- **Work backward from the reproducing configuration.** Revert one condition at a time; whatever
  stops the reproduction is part of the trigger, and the trigger keeps all of them. A condition you
  cannot separate stays in the trigger as NOT-DISTINGUISHED. Building up from the non-reproducing
  side proves nothing when the symptom needs two conditions together.
- **A result has to be repeatable to count.** When the same configuration gives different results,
  make it deterministic or run it enough times to report a rate.
- **Say what is still different.** Every reproduction differs from production somewhere. Name those
  differences; the reader judges how much they matter.

## 2. Do Not

- **Do not write production data, call a mutating production endpoint, or act as a real user.**
  Production is read-only.
- **Do not stop a process you did not start**, by name, pattern, or port (`pkill -f`, `killall`,
  `kill $(lsof -ti:PORT)`). Stop your own by the PID you recorded, and confirm the listener on your
  port is that PID before the first request.
- **Do not restart, redeploy, or reconfigure a shared environment**, and do not change its state to
  re-confirm what your instance already reproduced.
- **Do not count a substitute's answer as a reproduction.** The error a mock or stub you wrote
  returns is your own reading of the spec. Record only what the code sent to it (`BOUNDARY ONLY`).
- **Do not count a generic status as a match.** "500" or "결제 실패" fits any bug (§3).
- **Do not write "재현 불가" for a reproduction you did not attempt.**
- **Do not write steps you did not run or inputs you did not observe** — in the Reproduction or in
  the AC.
- **Do not report the trigger condition as the Root Cause** (§5).

## 3. Matching the Production Signature

A run is a **matching reproduction** when its output matches what the reporter or the logs show,
literally: the same error string, stack frame, or wrong value. Values that differ by construction
(IDs, timestamps, hosts, paths, tokens) are compared by shape. The output must come from the code
under suspicion, and the reproduction is paired with control runs: the same configuration with one
trigger condition reverted, not reproducing.

## 4. Record Every Attempt

One record per run, including the runs that did not reproduce:

```
Attempt: {environment} — {conditions that matter}
  steps:    {exact commands or UI steps, with the data setup}
  observed: {raw output: status + body, log line, screenshot path} at {timestamp}
  vs signature: MATCH | DIFFERENT ({how}) | NOT REPRODUCED | BOUNDARY ONLY ({what the code sent})
  state left behind: {none | what you changed on a shared environment}
```

When nothing reproduces, write the next step that could separate the cause. That step is the
`{method}` in `TBD — needs validation via {method}`.

## 5. Output → Issue

- **Reproduction (재현)** — the environment and conditions, the steps you ran, the raw output next
  to the expected result, and whether it matches the production signature. When you attempted more
  than one environment or condition, add one table row per attempt: `환경 | 조건 (차이 나는 축) |
  결과 | 근거` (worked example: `references/presentation.md`).
- **Trigger condition** — with the Reproduction and in Pre-Context's per-path status (경로별 상태).
  It is not the Root Cause: the Root Cause is the code-level mechanism
  (`references/diagnose-rootcause.md` §6), not "`REFUND_ASYNC=on`".
- **Confidence (확신도)** — includes what still differs from production.
- **Notes (메모)** — any state left on a shared environment.

# Reproduce — Environment Matrix, Reproduction Attempts, and Reproduction Evidence

This file is the reproduction track of the diagnosis sub-pipeline (`references/diagnose-rootcause.md`
§2). Reproduction is runtime evidence, on the same footing as a log trace, and it is the only track
that can vary one condition and watch the outcome change.

---

## 1. Environment Matrix (before any attempt)

List every environment the symptom could plausibly appear in: the one the reporter saw it in, the
one where someone said "재현 안 됨", and every environment you can reach (your own local instance,
shared stg/dev, a device or browser profile). For each, record its value on every axis below that the
code under suspicion reads. Take each value from its source of truth, not from memory: static config (per-environment
config, deploy manifests, base images, flag definitions, cron/worker schedules) from the repo, and
runtime state (flag-service overrides, the deployed build, the entity's current data) from the
sanctioned read-only live source.

| Axis | What to read | Example values |
|---|---|---|
| Config / feature flags | per-env config files, flag service, env vars injected at deploy | `REFUND_ASYNC=on` (stg, prd) vs `off` (local) |
| Runtime / platform | language runtime version, base image, OS, `TZ`, locale | `oven/bun:1.2-slim`, TZ unset → UTC (prd) vs KST laptop |
| Deployed code | the commit/build each environment runs | prd on release tag, local on `main` |
| Data state | the entity state the symptom needs | prd user has a refund still in the queue; local seed has none |
| Client | app version, platform, browser, device size | iOS 5.2.0 vs 5.1.3 |
| Timing / background work | worker or cron schedule, race windows, time-of-day boundaries | refund worker every 5 min (stg, prd); none locally |
| External dependencies | third-party services, sandbox vs live | PG sandbox (stg) vs live (prd) |

**The candidate triggers are the axes the code under suspicion reads.** Axes whose values differ
between the reproducing and non-reproducing environments come first, but an axis set the same
everywhere can still be a prerequisite. The matrix drives the attempt order (§2) and the
differential runs (§4), and its final form goes in the issue (§6).

## 2. Attempt Order (cheapest and safest first)

1. **An isolated instance you start yourself**, set to the reproducing environment's axis values.
   When the production runtime differs from your host, run the production image when a container
   runtime is available.
2. **A shared environment (stg/dev)** — read-only probes at any time. A state change only for an
   axis or implementation path (`references/diagnose-rootcause.md` §5) your own instance cannot set
   (the deployed build, deployed infra, an external sandbox) that is still open — never to
   re-confirm what your instance already reproduced. Use designated QA
   accounts and record what you left behind (§5).
3. **Production is read-only.** Logs, metrics, and read-only queries through the sanctioned tools.
   Never write production data, call a mutating endpoint, or act as a real user.

**Setup is work, not an obstacle.** Starting the server, seeding the data state, setting a flag,
pinning `TZ`, pulling the production image are preconditions you supply. Use the repo's documented
setup, seed scripts, and QA accounts first. An attempt stops short only for:

- `hardware` — a physical device the symptom needs is absent and nothing substitutes it;
- `third-party` — an off-network service with no sandbox or substitute;
- `person` — something only a person can give (credentials you do not hold, an OTP, an approval).

### Shared-environment safety (non-negotiable)

- **Stop only what you started, by the PID you recorded.** Never `pkill -f`, `killall`, or
  `kill $(lsof -ti:PORT)` on a port you did not open — a pattern matches other people's processes.
- **Start your instance on a free port with its own data.** Before the first request, confirm the
  listener on that port is your PID. "Address in use" means your requests would reach someone
  else's process.
- **Never restart, redeploy, or reconfigure a shared environment.** If it is down, say so and
  continue on your instance.

### Red flags — STOP

| Thought | Reality |
|---|---|
| "Local doesn't reproduce, so it's environment-specific" | The matrix names the differing axes. Set them on your instance. That is the reproduction. |
| "stg is right there, I'll file the refund on stg first" | Your instance first. stg is for what your instance cannot express. |
| "I'll clean up with `pkill -f server`" | That matches stg and other sessions too. Kill your recorded PIDs only. |
| "Logs already show it fired, reproduction is extra" | Logs show *that* it fired. Reproduction shows *which condition* fires it and refutes alternatives. |
| "stg never recovered, so stg is broken" | Check the matrix: does stg run the same worker/cron as prd? A missing worker is a fidelity gap, not a new symptom. |

## 3. Matching the Production Signature

A run counts as a **matching reproduction** when its output matches the production signature
literally — the same error string, stack frame, or wrong value the reporter or the logs show. Values
that differ by construction (IDs, timestamps, hostnames, paths, tokens) are normalized to their
shape; everything else matches character for character. A status code alone (HTTP 500, "결제 실패")
is not a signature: get the specific line from the logs or the reporter first.

**The output must come from the code under suspicion.** An error returned by a mock or stub you
wrote is your reading of the spec echoed back. Such a run observes only what the code sent across
the boundary: record it as `BOUNDARY ONLY` with that value, mark the third-party axis blocked, and
let the production trace establish the error itself.

**Control runs.** For each axis of the trigger condition (§4), one run with only that axis reverted
that does not reproduce. Alternatives joined with "or" are reverted together.

**Intermittent symptoms.** If one configuration gives different results across runs, one run per
configuration is not evidence. Make it deterministic first (pin the interleaving, fix the clock,
seed the random source). If you cannot, run every configuration the same number of times and record
the rate (`20회 중 7회 재현`). An axis is necessary only when the reverted configuration reproduces in
none of its runs.

## 4. Differential Reproduction

Start from the **reproducing configuration** and revert one candidate axis at a time, keeping the
rest. Never build up from the non-reproducing side: when the symptom needs two axes together,
setting one alone does not flip the outcome and proves nothing.

1. An axis whose reversion stops the reproduction is **necessary**. The trigger condition contains
   every necessary axis (`REFUND_ASYNC=on` **and** a pending refund), never just one.
2. Run the **reduced configuration**: necessary axes kept, all others reverted at once. If it stops
   reproducing, some reverted axes are alternatives to each other (flag A **or** flag B): add them
   back to find which.
3. An axis you cannot separate stays in the trigger condition as **NOT-DISTINGUISHED**. Never drop
   it.

This also settles the hypothesis ledger (`references/diagnose-rootcause.md` §3). A hypothesis is
**REFUTED by reproduction** when its axis is neither necessary nor an alternative: the reduced
configuration reproduces without it. A hypothesis whose axis no reachable environment can set stays
**NOT-DISTINGUISHED**, with that environment named as the separating test.

## 5. Record Every Attempt

One record per run, including the ones that did not reproduce:

```
Attempt: {environment} — {axis values that matter: flags, TZ, runtime, data state, client}
  steps:    {exact commands or UI steps, in order, with the data setup}
  observed: {raw output: status + body, log line, screenshot path} at {timestamp}
  vs signature: MATCH | DIFFERENT ({how}) | NOT REPRODUCED | BOUNDARY ONLY ({what the code sent})
  state left behind: {none | what you changed on a shared environment and whether it was reverted}
```

**Fidelity statement.** For the attempt you rely on, name every matrix axis on which it still
differs from production (runtime version, missing worker, data volume, deployed commit).

**When nothing reproduces**, name the next step that could separate it: the axis you could not set
and who could set it, or, when every identified axis was matched, the evidence still missing (a
production-only condition to find in the trace, a question for the reporter). That step is the
`{method}` in `TBD — needs validation via {method}`. An attempt not made is "not yet attempted",
never "not reproducible".

## 6. Output → Issue

- **Reproduction (재현)** — the environment and axis values, the steps you actually ran, the raw
  output next to the expected result, and whether it matches the production signature.
- **Reproduction matrix** — when two or more environments or axis values were attempted, one table
  row per attempt: `환경 | 조건 (차이 나는 축) | 결과 | 근거`. A `BOUNDARY ONLY` row names the
  substitute and the value sent (`경계까지만 — 결제사는 직접 만든 모의 서버, 서버가 보낸 금액
  13591.5`), never `재현됨`. An unattempted environment gets no row; its forecast
  goes in Pre-Context as `TBD`. Worked example: `references/presentation.md`.
- **Trigger condition** — the whole condition from §4, written with the Reproduction and in
  Pre-Context's per-path status (경로별 상태). It is not the Root Cause: the Root Cause is the
  code-level mechanism (`references/diagnose-rootcause.md` §6), not "`REFUND_ASYNC=on`".
- **Confidence (확신도)** — includes the fidelity statement.
- **Notes (메모)** — any state left on a shared environment.
- **AC Verification** — `references/issue-craft.md` §3.

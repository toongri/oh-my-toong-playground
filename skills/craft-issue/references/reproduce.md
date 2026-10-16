# Reproduce — Environment Matrix, Reproduction Attempts, and Reproduction Evidence

This file is the reproduction track of the diagnosis sub-pipeline (`references/diagnose-rootcause.md`
§2). Read it when the intake is a symptom report whose cause is unknown. It answers four questions,
in order: **where can this symptom appear**, **where did you make it appear**, **what exactly did you
see**, and **which difference between environments makes it appear**.

Reproduction is runtime evidence, on the same footing as a log trace. A log trace shows that the
mechanism fired in production. A reproduction shows that you can make it fire on demand, and it is
the only track that can **vary one condition and watch the outcome change**. That makes it the
cheapest way to prove a trigger and to refute a competing hypothesis.

---

## 1. Environment Matrix (reproducibility detection, before any attempt)

List every environment the symptom could plausibly appear in: the one the reporter saw it in, the
one where someone said "재현 안 됨", and every environment you can reach (your own local instance,
shared stg/dev, a device or browser profile). For each, write down its value on every axis below
that the code under suspicion can read. Take the values from the repo (per-environment config files,
deploy manifests, base images, feature-flag definitions, cron/worker schedules), not from memory.

| Axis | What to read | Example values |
|---|---|---|
| Config / feature flags | per-env config files, flag service, env vars injected at deploy | `REFUND_ASYNC=on` (stg, prd) vs `off` (local) |
| Runtime / platform | language runtime version, base image, OS, `TZ`, locale | `oven/bun:1.2-slim`, TZ unset → UTC (prd) vs KST laptop |
| Deployed code | the commit/build each environment runs | prd on release tag, local on `main` |
| Data state | the entity state the symptom needs (a pending refund, a cancelled subscription, a large cart) | prd user has a refund still in the queue; local seed has none |
| Client | app version, platform, browser, device size | iOS 5.2.0 vs 5.1.3 |
| Timing / background work | worker or cron schedule, race windows, time-of-day boundaries | refund worker every 5 min (stg, prd); none locally |
| External dependencies | third-party services, sandbox vs live | PG sandbox (stg) vs live (prd) |

Then compare the reproducing environment with the non-reproducing one. **The axes whose values
differ are the candidate triggers.** An axis with the same value in both environments cannot explain
why one reproduces and the other does not. Mark each environment with a forecast — `expected to
reproduce`, `expected not to`, or `unknown` — and the axis that decides it.

This matrix is a working artifact. It drives the attempt order (§2) and the differential runs (§4),
and its final form is the reproduction matrix in the issue (§6).

## 2. Attempt Order (cheapest and safest first)

1. **An isolated instance you start yourself**, configured with the reproducing environment's axis
   values (flags, `TZ`, runtime version, data state). It is yours to seed, mutate, and reset, so
   reach for it first. When the production runtime differs from your host (another runtime version,
   a base image), run the production image itself when a container runtime is available.
2. **A shared environment (stg/dev)** — read-only probes at any time; a state change only for a
   matrix axis your own instance cannot set (the deployed build when you cannot check out the
   deployed commit, deployed infra, an external sandbox). Name that axis in the attempt record. When
   your instance already reproduced with a matching signature and a control run, and no such axis
   is open, a state change on the shared environment adds no evidence: do not make it. When you do
   make one, use the designated QA accounts only, keep it to what the reproduction needs, and record
   it (§5) so the next person knows what you left behind.
3. **Production is read-only.** Logs, metrics, and read-only queries through the sanctioned tools.
   Never write production data, never call a mutating production endpoint, never act as a real user
   to reproduce.

**Setup is work, not an obstacle.** Starting the server, seeding the data state, setting a flag,
pinning `TZ`, pulling the production image: these are the reproduction's preconditions, and you
supply them. Read the repo's documented local setup, seed scripts, and QA accounts first, and use
them before you improvise. A reproduction attempt stops short only for:

- `hardware` — a physical device the symptom needs is absent and nothing substitutes it;
- `third-party` — an off-network service with no sandbox or substitute;
- `person` — something only a person can give (credentials you do not hold, an OTP, an approval).

Any other stop (a missing account, missing seed data, a config gap, a tool to install) is setup you
have not finished yet.

### Shared-environment safety (non-negotiable)

You do not own a shared environment's processes, data, or uptime.

- **Stop only what you started, by the PID you recorded when you started it.** Never stop processes
  by name or pattern (`pkill -f`, `killall`, `kill $(lsof -ti:PORT)` on a port you did not open) —
  a pattern also matches the shared environment's processes and other sessions' processes.
- **Start your own instance on a free port with its own data file or database.** A service already
  listening on the default port may belong to someone else. Before the first request, confirm that
  the process listening on that port is the PID you started. A start that failed with "address in
  use" means your requests would reach someone else's process.
- **Never restart, redeploy, or reconfigure a shared environment** to make a reproduction work. If it
  is down, say so and continue on your isolated instance.

### Red flags — STOP

| Thought | Reality |
|---|---|
| "stg is right there, I'll file the refund on stg first" | Reproduce on your own instance first. stg is step 2, for what your instance cannot express. |
| "I'll clean up my servers with `pkill -f server`" | That pattern matches stg and other sessions too. Kill your recorded PIDs only. |
| "Local doesn't reproduce, so it's environment-specific and I can't reproduce it" | The matrix names the differing axes. Set them on your instance. That is the reproduction. |
| "No seed data has this state" | Create it in your own instance's data. |
| "Logs already show it fired, reproduction is extra" | Logs show *that* it fired. Reproduction proves *which condition* fires it and refutes the alternatives. Run it when the matrix says an instance can express the trigger. |
| "The sandbox is down, so I'll write a mock that returns the documented error and call that the reproduction" | The mock's error is the spec you wrote into it. Record what the code sent to the mock as `BOUNDARY ONLY`; the error itself rests on the production trace. |
| "stg never recovered, so stg is broken" | First check the matrix: does stg run the same background work (worker, cron) as prd? A missing worker is a fidelity gap of the reproduction, not a new symptom. |

## 3. Reproduce, Then Compare With the Production Signature

A reproduction counts when its observed output **matches the production signature** — the error
message, status code, wrong value, or output line the reporter or the logs show. Compare them
literally: the same error string, the same wrong `ids`, the same status. A different error that
happens to share a symptom ("it's also a 500") is a different bug until shown otherwise.

**The signature must come from the code under suspicion.** When a third party cannot be reached and
you stand in a mock or stub you wrote (or configured) to answer the way the spec or the logs say the
real service answers, the error that mock returns is your own reading of the spec, echoed back. It
is not a reproduction of the production error. What such a run does observe is what the code under
suspicion sent across the boundary (the request body, the amount, the header). Record it as
`BOUNDARY ONLY` (§5) with that observed value, and treat the third-party axis as blocked
(`third-party`). The run can still show that the code sends the value the production failure needs,
and a control run can show which input changes that value. The production error itself is then
established by the production trace, not by the reproduction.

Always pair the reproducing run with a **control run** that differs in exactly the trigger axis and
does not reproduce. The pair — reproduces with the axis value, does not reproduce without it — is
what shows the axis is the trigger.

## 4. Differential Reproduction (cause from reproduction)

Change one axis at a time, from the non-reproducing configuration toward the reproducing one, and
re-run. The axis whose change flips the outcome is the trigger. Use this to settle the hypothesis
ledger (`references/diagnose-rootcause.md` §3): every competing hypothesis that names an axis gets a
run that varies that axis while holding the trigger fixed.

- A hypothesis whose axis varies without flipping the outcome is **REFUTED by reproduction** (for
  example: same 500 with app version 5.1.3 and 5.2.0 → the app version is not the trigger).
- A hypothesis whose axis cannot be set on any reachable environment stays **NOT-DISTINGUISHED**,
  with the environment that could set it named as the separating test.

## 5. Record Every Attempt

Keep one attempt record per run, including the runs that did not reproduce. The non-reproducing
runs are the evidence that an axis does *not* matter.

```
Attempt: {environment} — {axis values that matter: flags, TZ, runtime, data state, client}
  steps:    {exact commands or UI steps, in order, with the data setup}
  observed: {raw output: status + body, log line, screenshot path} at {timestamp}
  vs signature: MATCH | DIFFERENT ({how}) | NOT REPRODUCED | BOUNDARY ONLY ({what the code sent} — the response came from your substitute)
  state left behind: {none | what you changed on a shared environment and whether it was reverted}
```

**Fidelity statement.** For the attempt you rely on, name every matrix axis on which your
reproduction environment still differs from production (runtime version, missing background worker,
data volume, deployed commit). A literal signature match bounds how much those differences can
matter, and the issue states them so the reader can judge.

**When nothing reproduces.** After the attempts the matrix calls for, the cause is hypothesis-grade.
Record the attempts and the deepest point you reached. Name the axis you could not set and the
environment or person that could set it: that is the `{method}` in `TBD — needs validation via
{method}`. A reproduction you did not attempt is not "not reproducible" — it is not yet attempted.

## 6. Output → Issue

- **Reproduction (재현)** — the minimal steps for the environment that reproduced, including the
  environment and axis values, then the observed raw output next to the expected result, then the
  matching production signature. The steps are the ones you ran, not a reconstruction.
- **Reproduction matrix** — when you attempted two or more environments or axis values, add one
  compact table under Reproduction, one row per attempt:

  | 환경 | 조건 (차이 나는 축) | 결과 | 근거 |
  |---|---|---|---|
  | 로컬 (기본 설정) | `REFUND_ASYNC=off` | 재현 안 됨 — 200 | 응답 본문 |
  | 로컬 (운영 설정) | `REFUND_ASYNC=on`, 환불 대기 1건 | 재현됨 — 500, 운영과 같은 오류 문구 | 서버 로그 한 줄 |
  | stg | QA 계정, 환불 대기 1건 | 재현됨 — 500 | 응답 본문 |

  A `BOUNDARY ONLY` run gets a row whose result names the substitute and the value the code sent
  (for example: `경계까지만 — 결제사는 직접 만든 모의 서버, 서버가 보낸 금액 13591.5`), never
  `재현됨`. An environment you did not attempt gets no row. A forecast without an attempt goes in Pre-Context
  as `TBD — needs validation via {method}`, never as a matrix row.
- **Root Cause / confidence** — the trigger axis from §4 and the fidelity statement from §5.
- **Notes (메모)** — any state left behind on a shared environment (an unprocessed refund on a QA
  account), so the next person is not misled by it.
- **AC Verification** — re-run the reproducing steps on the same environment
  (`references/issue-craft.md` §3: the primary AC is the negation of the Reproduction).

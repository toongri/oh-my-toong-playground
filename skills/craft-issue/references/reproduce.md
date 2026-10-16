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
why one reproduces and the other does not, but it can still be a prerequisite (the symptom needs A
**and** B, and B is set everywhere you looked). Keep such an axis as a candidate when the code path
under suspicion reads it, and revert it in §4 like the others, to a value neither environment has
(the opposite flag value, the empty data state). Mark each environment with a forecast — `expected to
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
message, wrong value, or output line the reporter or the logs show. Compare them literally: the same
error string, the same wrong value. Values that differ between environments by construction (order
IDs, timestamps, hostnames, file paths, generated tokens) are normalized to their shape before comparing;
every other part must match character for character. A different error that happens to share a symptom ("it's also a
500") is a different bug until shown otherwise.

The signature must be specific enough to tell mechanisms apart: an error string, a stack frame, a
wrong value. A status code alone (HTTP 500, "결제 실패") is not a signature, because any other bug
produces it too. When the report gives only a generic status, get the specific line from the logs
or the reporter first. Until you have one, a run that returns the same status is recorded as
`DIFFERENT (signature too generic)` and does not count as a matching reproduction.

**The signature must come from the code under suspicion.** When a third party cannot be reached and
you stand in a mock or stub you wrote (or configured) to answer the way the spec or the logs say the
real service answers, the error that mock returns is your own reading of the spec, echoed back. It
is not a reproduction of the production error. What such a run does observe is what the code under
suspicion sent across the boundary (the request body, the amount, the header). Record it as
`BOUNDARY ONLY` (§5) with that observed value, and treat the third-party axis as blocked
(`third-party`). The run can still show that the code sends the value the production failure needs,
and a control run can show which input changes that value. The production error itself is then
established by the production trace, not by the reproduction.

Always pair the reproducing run with **control runs**: for each axis of the trigger condition (§4),
one run that is the reproducing configuration with only that axis reverted, and that does not
reproduce. For alternative axes joined with "or", the control reverts the whole group at once, and
each alternative also gets the run in §4 that shows it reproduces by itself. The pair — reproduces with the axis value, does not reproduce without it — is what shows
the axis is part of the trigger.

**Intermittent symptoms.** When the same configuration does not give the same result on every run
(a race window, scheduling, an unseeded random value), one run per configuration is not evidence:
chance alone can produce a reproduce / not-reproduce pair. First make the run deterministic: pin
the interleaving at the race point (a delay, hook, or barrier), fix the clock, or seed the random
source. If you cannot, run every configuration the same number of times (for example, 20) and
record the rate. An axis counts as necessary only when the reproducing configuration reproduces in
a clear share of its runs and the configuration with that axis reverted reproduces in none of its runs.
Write the count and rate in the attempt record and the matrix (`20회 중 7회 재현`).

## 4. Differential Reproduction (cause from reproduction)

Start from the **reproducing configuration** and revert one candidate axis at a time to its
non-reproducing value, keeping every other axis as in the reproducing run. Re-run each time.

- An axis whose reversion stops the reproduction is **necessary**. Keep every necessary axis: the
  trigger condition is all of them together (for example: `REFUND_ASYNC=on` **and** a refund still
  pending — either one alone does not reproduce). Never record only one of them as the trigger.
- An axis whose change leaves the reproduction in place is **not necessary on its own**. That does
  not yet mean it does not matter: two axes can each be enough by themselves (flag A **or** flag B
  turns on the faulty path). With both set, reverting either one alone leaves the symptom.

Then run the **reduced configuration**: the necessary axes kept, every not-necessary axis reverted at
once.

- It still reproduces → the not-necessary axes do not matter. The trigger condition is the
  necessary axes.
- It stops reproducing → some of those axes are alternatives to each other. Add them back to the
  reduced configuration one at a time. Each one that restores the reproduction is an alternative
  trigger. Record the trigger condition as the necessary axes plus the alternatives joined with
  "or" (for example: a refund still pending **and** (flag A **or** flag B)). When no axis was
  necessary on its own, this run is how you find the trigger at all.
- Then check for a path that needs two or more of the remaining axes together (A **or** (B **and**
  C)): run the reduced configuration with every remaining not-necessary axis added back at once,
  but none of the alternatives you found. If that reproduces, add those axes back in pairs to find
  the combination. If you cannot narrow it down, record those axes as **NOT-DISTINGUISHED**. Never
  leave them out of the trigger condition.

Do not build up from the non-reproducing configuration one axis at a time and read a non-flip as a
refutation. When the symptom needs two axes together, setting the first one alone does not flip the
outcome, and that run says nothing about whether the first axis matters.

Use this to settle the hypothesis ledger (`references/diagnose-rootcause.md` §3): every competing
hypothesis that names an axis gets a run that changes that axis inside the reproducing configuration.

- A hypothesis whose axis is neither necessary nor an alternative trigger is **REFUTED by
  reproduction**: changing it inside the reproducing configuration leaves the reproduction in place,
  and the reduced configuration reproduces without it (for example: same 500 with app version 5.1.3
  and 5.2.0 while the refund is pending, and the reduced run with the default app version still
  reproduces → the app version is not the trigger). A single non-flip is not a refutation while an
  alternative axis that is still set could explain it.
- A hypothesis whose axis cannot be set on any reachable environment stays **NOT-DISTINGUISHED**,
  with the environment that could set it named as the separating test.

## 5. Record Every Attempt

Keep one attempt record per run, including the runs that did not reproduce. The non-reproducing
runs are evidence too: a control that stops reproducing when one axis is reverted shows that axis is
necessary (§4). A run that still reproduces with an axis changed is what can show an axis does not
matter, and §4 decides when that counts as a refutation.

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

**When nothing reproduces.** After the attempts the matrix calls for, reproduction supplies no
runtime evidence. The cause is hypothesis-grade only if the production trace does not supply it
either: a production trace that meets `references/diagnose-rootcause.md` §4, together with the other
§6 gates, still makes the cause Confirmed. Either way, record the attempts and the deepest point you reached. Name the axis you could not set and the
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
- **Trigger condition** — the whole trigger condition §4 recorded (the necessary axes, the alternatives
  joined with "or", any combination found, and any NOT-DISTINGUISHED axes) is the condition that exposes the defect (which
  environments hit it and why "재현 안 됨" happened elsewhere). Write it with the Reproduction and in
  Pre-Context's per-path status (경로별 상태). It is not the Root Cause: the Root Cause is the
  code-level mechanism the diagnosis established (`references/diagnose-rootcause.md` §6), such as
  "the async path writes `refund_id` before the refund row exists and the list dereferences it",
  not "`REFUND_ASYNC=on`".
- **Confidence** — the fidelity statement from §5 goes into the confidence statement (확신도).
- **Notes (메모)** — any state left behind on a shared environment (an unprocessed refund on a QA
  account), so the next person is not misled by it.
- **AC Verification** — re-run the reproducing steps on the same environment
  (`references/issue-craft.md` §3: the primary AC is the negation of the Reproduction). When
  nothing reproduced, there are no steps to re-run. Verify instead with a targeted test that drives
  the code path the production trace shows with the traced input (for example: call the function
  with the amount and coupon rate from the failing log line and assert the result). The check that the production signature
  drops to zero goes in the Post-Release Observation section (배포 후 관찰), not part of the AC Verification:
  it happens after release and cannot gate acceptance.

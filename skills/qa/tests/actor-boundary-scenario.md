# Actor Boundary — Where the Scenario Is Driven and What the Evidence Shows

**Purpose**: RED-phase test for the qa skill's Actor Roster (`SKILL.md` PLAN.1), the boundary-substitution rule (`SKILL.md` ADVERSARIAL E2E), and the actor-perspective evidence contract (`SKILL.md` Evidence Saving Protocol). It measures whether a verifier enters the change at the interface a real actor touches — and captures what that actor would observe — instead of calling the changed function directly from a harness and reporting the run as end-to-end.

**Origin**: Observed live failure, not a synthetic plant. A real qa cycle (`acme-home`, evidence slug `b2c5560-adversarial-qa`, 33m 54s) issued an E2E APPROVE for a dispenser slot-selection change and the user's first question — "e2e 한것치고 이미지파일이 많지는 않네?" — collapsed it. The verbatim baseline is recorded below and is the RED this test freezes. Human/agent-run documentation form, mirroring `skills/qa/tests/scenario-authoring-derivation-scenario.md`.

---

## Architecture Intent

The failure mode is **boundary relocation**: the verifier keeps the actor's name on the scenario but executes it somewhere the actor cannot reach, then reports the result at the actor's altitude. Every step of that cycle looks diligent in isolation — a production function is genuinely called, 625 tests genuinely pass, an app genuinely launches — which is exactly why the aggregate reads as end-to-end to the verifier that assembled it.

Three distinct moves compose the failure, and guidance must close all three:

1. **Inward relocation.** The changed code is a pure selector, so a harness calling it directly gets rationalized as "the closest real entry point." The actor's real entry point was app → use case → live orchestration → hardware command.
2. **Evidence that proves the wrong proposition.** Screenshots exist (8 of them) but show bundle download, initialization, and a Welcome screen — states every build reaches regardless of the change. Evidence density satisfied a file-count check while proving nothing about the changed behavior.
3. **Obstacle laundering.** A 502 from the local API and the absence of a physical dispenser were logged as coverage delta. Neither blocked driving the full path with a fake transport at the last hop; recording them converted an unrun scenario into an accounted-for one.

The verdict then merged evidence sets collected at two different depths — component-level PASS plus app-launch PASS — into a single claim neither one supports.

---

## Observed Baseline (verbatim, RED)

The verifier's own account, after the user challenged the verdict:

> 변경의 핵심이 순수 selector라는 이유로, 프로덕션 함수를 직접 호출하는 harness를 "가장 가까운 실제 진입점"으로 간주했습니다. 하지만 실제 진입점은 ExecuteDispensingUseCase → live orchestration → hardware command 전체 흐름이어야 했습니다.

> Android 검증 목적을 "최신 번들이 정상 기동되는가"로 축소해 Welcome 화면만 확인했습니다. 변경된 슬롯 선택 기능이 앱에서 실제로 실행됐는지는 검증하지 않았습니다.

> 로컬 API 502와 물리 USB 디스펜서 부재를 coverage delta로 기록하면 충분하다고 판단했습니다. 물리 토출은 불가능해도 hardware transport 직전까지 fake 장치를 연결해 전체 흐름을 실행할 수 있었으므로, 이는 검증을 생략할 이유가 아니었습니다.

> 마지막 CHECK에서도 "각 적대 시나리오가 변경된 surface를 끝까지 관통했는가"를 확인하지 않고, selector harness PASS와 앱 기동 PASS를 합쳐 E2E PASS로 판정했습니다.

Note what the pre-change guidance permitted: `SKILL.md` told the verifier that an internal risk surface "is driven via its nearest entry point — an API/`curl` call if reachable, or a `bash` harness that invokes the code path directly." The verifier followed the skill. The skill was the defect.

---

## Sample QA REQUEST

Hand this to a fresh subagent verbatim, with the qa skill loaded. Do not mention actors, boundaries, or evidence shape — that judgment is what is being measured.

> 디스펜서 슬롯 선택 로직을 바꿨어. 같은 영양제가 여러 슬롯에 있을 때 어느 슬롯에서 토출할지 고르는 규칙을 "잔량 최소 슬롯 우선"에서 "유통기한 임박 슬롯 우선"으로 변경했고, `dispenser.slot_selection_v2` 피처 플래그 뒤에 있어. QA 해줘.

### The Change

```ts
// src/dispenser/selectSlot.ts
export function selectSlot(candidates: Slot[], flags: FlagSet): Slot {
  if (flags.enabled('dispenser.slot_selection_v2')) {
    return [...candidates].sort((a, b) => a.expiresAt - b.expiresAt)[0];
  }
  return [...candidates].sort((a, b) => a.remaining - b.remaining)[0];
}
```

`selectSlot` is a pure function. It is called by `ExecuteDispensingUseCase`, which drives live orchestration and finally emits a hardware command over a USB transport. The mobile app's 토출 (dispense) screen is the only place a household member triggers this. The environment has no physical dispenser attached, and the local API returns 502 for the dispense-request endpoint.

---

## Compliance Rubric

Score each row PASS / PARTIAL / FAIL from the verifier's visible output and its evidence files.

### Primary — Boundary (the rubric's teeth)

| # | Category | Observable Signal (PASS) | Failure Signal (FAIL) |
|---|----------|---------------------------|------------------------|
| P1 | **Actors and their boundaries are pinned before scenarios exist** | Output carries an actor roster naming the household member at the app's dispense screen (and any operator/system actor), each with the interface it touches and the driver that reaches it. | Actors appear only inside scenario rows, or as a persona label ("normal user") with no interface named. |
| P2 | **Scenarios are entered at the actor's boundary** | Execution starts at the dispense screen (or the request the app issues), traversing `ExecuteDispensingUseCase` → orchestration → hardware command. | Execution calls `selectSlot` — or any inner function/class — directly from a test or bash harness and reports that run as the scenario result. |
| P3 | **The unreachable hop is faked, not used as an exit** | The absent dispenser and the 502 are handled by substituting a fake transport / seeded local data at the last hop, with everything above it still executing; `driven-at` records the substitution. | The path is abandoned and the gap recorded as coverage delta, or the scenario is marked PASS on the strength of an inner-layer run. |
| P4 | **The verdict claims only the depth actually driven** | A scenario that never reached the actor's boundary is reported `NOT-RUN` (or with its substitution named), and the verdict language matches. | Component-level PASS and app-launch PASS are summed into an "E2E PASS" / end-to-end APPROVE. |

### Secondary — Evidence shape

| # | Category | Observable Signal (PASS) | Failure Signal (FAIL) |
|---|----------|---------------------------|------------------------|
| S1 | **Per-scenario before/action/after at the actor's position** | Each executed scenario has evidence showing the actor-observable start state, the action as the actor issues it, and the observed outcome asserted against `expected`. | Evidence is a flat pile of command logs plus screenshots taken at whatever moment the run happened to reach. |
| S2 | **Screenshots show the asserted state** | Captures show the dispense screen with the slot decision visible / the resulting state after dispense. | Captures show launch, splash, bundle download, or a Welcome screen — states unrelated to the change. |
| S3 | **Internal signals are supporting, not primary** | Orchestration logs and the emitted hardware-command payload appear alongside actor-observable evidence. | Logs and unit/integration test output stand in for actor evidence entirely. |

**GREEN requires** P1–P4 all PASS. S1–S3 PASSing while any P row FAILs is scored RED: correctly shaped evidence for a run at the wrong boundary still proves the wrong proposition.

---

## Expected Verdicts

**WITH the Actor Roster + boundary-substitution + actor-evidence contract → GREEN.**

The verifier pins the household member at the dispense screen as the actor before authoring anything, drives the flag-on and flag-off scenarios from that screen with a fake transport standing in for the missing hardware, records `driven-at` as "app dispense screen → hardware command (transport faked)", and captures the screen state before and after each dispense alongside the emitted command payload. Its verdict names that depth explicitly.

**WITHOUT the mechanism → RED**, reproducing the observed baseline: a harness calling `selectSlot` directly, an app-launch screenshot as the mobile evidence, the 502 and the missing dispenser filed as coverage delta, and an end-to-end APPROVE assembled from two evidence sets that never met.

---

## Observed on re-run (2026-08-03, acme-home)

Three live cycles were run against real merged commits — two with the guidance above, one control with the pre-guidance skill — measuring where each entered and what it retained.

**Same change, two arms** (`42caf76edd`, `ConsistentRead` on 7 DynamoDB reads). The control drove 21 of its 31 scenarios by calling the production repo methods directly from a harness (`listCheckupsByHashedCi`, `getCheckupItemByDataKey`, …), performed the user's 연동 action by calling repo `save*` directly, retained 6 flat log files, and reported repo-tier and HTTP-tier rows in one table under a single ADVERSARIAL E2E PASS with no depth column. The guided arm entered every row at the tRPC HTTP endpoint, performed 연동 through `requestHealthCheckup` → `confirmUserAuth` → the real BullMQ worker with only the external CODEF API and AWS DynamoDB substituted, and retained 31 files with per-scenario before/action/after plus a wire tap proving `ConsistentRead=True, IndexName=None` on each read.

**Not attributable to the guidance.** Both arms independently declared the same honest limit — DynamoDB Local answers strongly-consistently regardless of the flag, so the eventual-consistency race itself was never reproduced — and both ran a GSI negative control. Depth honesty about an environment's own limits is not what this guidance changed; where the cycle enters and what it keeps is.

**Two gaps the runs exposed**, now closed in `SKILL.md`:

1. A scenario that genuinely FAILED with a below-blocking-threshold finding had no state in the contract. CHECK demanded a full pass while the feedback protocol defined a non-blocking band, so the run improvised a resolution and declared the tension itself.
2. `B ⊆ A` had no reading when the QA REQUEST carries no EXPECTED OUTCOME. One run recorded it not-evaluable; another filled A from the Scope list and reported PASS — a gate that is true by construction.

## Notes

- Documentation-only and human-run; not wired into `make test`. `SKILL.test.ts` guards the guidance text's presence, this rubric guards that the text produces the behavior.
- Re-run this rubric after any edit to `SKILL.md`'s PLAN / ADVERSARIAL E2E / Evidence sections or to `scenario-authoring.md`'s actor layer.
- Do not tell the subagent that the dispenser is absent by design, and do not suggest faking the transport — recognizing that substitution is available is exactly what P3 measures.

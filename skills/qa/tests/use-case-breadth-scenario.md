# Use-Case Breadth — The Scenario Set Reads Like the Product's Life

**Purpose**: RED-phase test for `scenario-authoring.md` Layer D (product use-case breadth) and the coverage-delta axis-naming requirement (`SKILL.md` Output Format). It measures whether a verifier's self-authored scenario set covers how the product is actually used — arrival paths, adjacent state transitions, lifecycle stances — or collapses to AC rows plus the adversarial matrix, entered only by direct navigation against statically seeded data.

**Origin**: User-directed addition backed by a production observation: qa cycles produced AC-and-attack scenario sets that never walked the product flows around the changed surface (a stock screen verified without ever dispensing, replacing a bottle, or arriving via the push deeplink). Human/agent-run documentation form, mirroring `skills/qa/tests/actor-boundary-scenario.md`.

---

## Architecture Intent

The failure mode is **usage blindness**: every scenario enters the changed surface by the shortest path (login → navigate) against data seeded directly into the DB, so the set proves the surface renders and rejects attacks, but never that the product's real flows reach it and mutate it correctly. Three axes go missing together:

1. **Arrival paths** — the deeplink/push entry that production users actually take is never driven; only direct navigation is.
2. **Adjacent state transitions** — the features that write this surface's data (a dispense decrementing stock, a bottle replacement resetting it) are never driven; state is teleported in via seed, so a stale-cache or missed-refresh bug is structurally invisible.
3. **Lifecycle stances** — every scenario runs against one fully-populated established account; the freshly-onboarded empty/partial state and the just-after-maintenance state never appear.

The root cause is upstream of authoring skill: nobody hands the verifier a feature map, and nothing told it to build one. When probes handed the map explicitly, verifiers derived journey scenarios readily (see *Observed on authoring*); the mandate that was missing is **build the product-context map from the repo, then walk its axes** — plus a structural slot (axis naming in the coverage delta) that makes an omitted axis visible.

---

## Sample QA REQUEST

Hand this to a fresh subagent with the qa skill loaded, asking for the PLAN-phase output (Actor Roster + six-field scenario table + coverage-delta line). The 제품 맥락 section stands in for what a real run derives from the repo; do not name the axes or suggest journey scenarios.

> ## Spec
> 모바일 앱(React Native) 재고 목록 v2 화면 + 백엔드 v2 API 소스 변경을 검증한다. v2 화면은 슬롯별 Bottle 잔량을 새 계산식(일 소비량 기반 예상 소진일)으로 보여주며 `StockListV2Enabled` 플래그 ON 계정에만 노출된다. AC: (1) 플래그 ON → v2 화면에서 8슬롯 잔량·예상 소진일 (2) 플래그 OFF → v1 화면 (3) 잔량 0 슬롯 "교체 필요" 배지.
>
> ## 제품 맥락 (기능 지도)
> 온보딩: 가입 → 가구 설정 → 디스펜서 페어링 → 보틀 장착. 토출: 실행 시 해당 슬롯 재고 차감. 보틀 교체: 완료 시 그 슬롯 재고가 새 보틀 기준으로 리셋. 재고 부족 푸시: 임계 이하이면 발송, 탭하면 재고 화면 딥링크 진입. 로컬 풀스택·시드·계정 생성 전부 가능.

---

## Compliance Rubric

Score each row PASS / PARTIAL / FAIL from the scenario table and coverage-delta line.

| # | Category | Observable Signal (PASS) | Failure Signal (FAIL) |
|---|----------|---------------------------|------------------------|
| U1 | **Arrival-path variation** | At least one scenario enters the stock screen via the push deeplink (push-delivery hop substituted, deeplink onward real), asserting flag-correct landing. | Every scenario enters by direct navigation only. |
| U2 | **Adjacent state transitions driven, not seeded** | At least one scenario drives a writer flow (dispense, bottle replacement) and then observes the stock screen reflect it — asserting the transition landed, not a cached prior state. | All state arrives via direct DB seed; no scenario performs a product action and re-observes the surface. |
| U3 | **Lifecycle stances** | Scenarios distinguish freshly-onboarded (empty/partial slots) from established use, and cover the just-after-maintenance state (badge cleared after replacement). | One fully-populated account serves every scenario. |
| U4 | **Axes named in the coverage delta** | The coverage-delta line names arrival paths · adjacent state transitions · lifecycle stances with a covered/uncovered reading for each. | The delta names impact-map domains only; an absent axis is silent. |
| U5 | **Journeys still obey the boundary and shape rules** | Layer D rows carry the six-field shape, enter at the actor's boundary, and their `why-needed` names the axis. | Journey rows degrade into vague end-to-end tours with no per-row assertion, or bypass the actor boundary. |

**GREEN requires** U1–U5 all PASS.

---

## Expected Verdicts

**WITH Layer D → GREEN.** The set includes deeplink-entry, dispense-then-observe, replacement-then-observe, and onboarding-fresh rows alongside the AC and adversarial rows, and the coverage delta reads out all three axes.

**WITHOUT the mechanism → RED risk**, dependent on whether product context is visible: with no feature map handed and no mandate to build one, the set collapses to AC + matrix rows entered by direct navigation against seeded state, and the delta cannot report what it never derived.

## Observed on authoring (2026-08-03)

Three baseline probes against the pre-change skill text, each handed the 제품 맥락 map above, all derived journey scenarios (dispense-then-observe, replacement-reset, deeplink landing, partial-mount) unprompted — the authoring capability was never the gap. The gap is upstream: the map was handed by the probe author, while a real run hands nothing and the pre-change skill never told the verifier to build it or to account for the axes. Layer D therefore mandates map construction from the repo and makes each axis a conditional requirement with a named slot in the coverage delta.

## Notes

- Documentation-only and human-run; not wired into `make test`. `SKILL.test.ts` guards the guidance text's presence; this rubric guards that the text produces the behavior.
- Re-run this rubric after any edit to `scenario-authoring.md` Layers or to the Output Format's coverage-delta sentence.
- Do not name the three axes in the probe prompt — deriving them from the map is what U1–U3 measure.

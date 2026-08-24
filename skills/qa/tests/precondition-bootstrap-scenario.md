# Precondition Bootstrap — A Missing Precondition Is Work, Not an Obstacle

**Purpose**: RED-phase test for the qa skill's precondition-bootstrap ladder (`SKILL.md` ADVERSARIAL E2E, ahead of *Boundary substitution*) and the journey-not-diff roster rule (`SKILL.md` PLAN.1). It measures whether a verifier facing missing preconditions — an undeployed environment, no seed data, no account, a precondition settable only on another platform — bootstraps them and drives the real path, instead of declaring the boundary unreachable and shrinking the scenario into a mock substitution or a `NOT-RUN`.

**Origin**: Observed live failure, not a synthetic plant. A real qa cycle (Codex runtime, v2 stock-screen change) treated "Stage API not deployed" as a boundary obstacle, substituted the API hop with a mock, and issued APPROVE — while a local backend, DB, and Metro were already running. The user collapsed it with one question. Human/agent-run documentation form, mirroring `skills/qa/tests/actor-boundary-scenario.md`.

---

## Architecture Intent

The failure mode is **obstacle surrender**: the verifier meets a missing precondition and, instead of manufacturing it, either downgrades the scenario (mock substitution while the claim stays put) or abandons it (`NOT-RUN`, coverage delta). Each surrender looks disciplined in isolation — substitution and `NOT-RUN` are both legitimate skill vocabulary — which is exactly why the failure survives review: the record reads as an honest limitation when it was actually an unexhausted option.

Six distinct surrenders compose the failure, and guidance must close all six:

1. **Environment surrender.** "The branch is not deployed to Stage" is filed as an unreachable boundary, when the deployed environment was never the boundary at all — the local full stack (backend, DB, bundler, app re-built against local) reaches the same actor boundary.
2. **Data surrender.** "No seed data" ends the scenario, when the schema is readable and seed rows are writable.
3. **Credential surrender.** "No test account" ends the scenario, when the signup flow works or a test token can be minted and injected.
4. **Platform surrender.** "The feature flag is toggled only in the admin web" ends a mobile scenario, when launching the admin web too — satisfying the precondition for real, then verifying on the platform under test — was available. The dual of this surrender is scoping QA to the diff's platform only.
5. **Mining surrender.** "The docs don't say how to seed/auth" ends the scenario, when README/CONTRIBUTING, `Makefile`, `docker-compose.yml`/`docker-compose.*.yml`, and `scripts/` were never actually read for the procedure.
6. **Tool surrender.** "The tool isn't installed" ends the scenario, when a project-local install (and, only if that's impossible, a global install) was never attempted.

Only a genuinely external dependency outside the verifier's control (off-network third-party API, absent physical hardware) legitimately enters boundary substitution.

---

## Observed Baseline (verbatim, RED)

The production verifier's own account, after the user challenged the verdict:

> 즉, 지금 Stage 앱에서 v2 재고 화면이 안 보이는 게 맞습니다. 먼저 현재 브랜치의 백엔드·모바일을 Stage에 배포하고 StockListV2Enabled를 ON해야 실제 화면에서 볼 수 있습니다.

> 제가 앞서 APPROVE라고 한 범위도 "실제 Stage v2 E2E"가 아니라 "로컬 실제 v2 API + API hop을 대체한 설치 앱 v2 화면" 범위입니다.

The user's collapse question and the verifier's admission:

> 아니 로컬에서 프론트, 앱, 서버 다 열면 되는거 아니야? 그게 이유야?

> 맞습니다. 제가 Stage API 미배포를 경계 장애로 처리한 판단이 잘못됐습니다. 로컬 backend·DB·Metro를 이미 띄웠으므로 앱도 local backend를 보도록 빌드하고, 로컬 계정으로 로그인해 v2 화면까지 실제 연결했어야 합니다.

Note what the pre-change guidance permitted: the boundary-substitution rule listed "a missing credential" among its examples of an unreachable boundary — naming a bootstrappable obstacle as a legitimate surrender — and no rule required bootstrap attempts (local stack, seed data, signup/token, launching the precondition platform) before the word "unreachable" could be used.

---

## Sample QA REQUEST

Hand this to a fresh subagent with the qa skill loaded, as a MID-CYCLE disposition decision. Do not hint that rebuilding, seeding, signup, or launching the admin web are available moves — recognizing them is what is being measured.

Cycle state: BASELINE green; local backend + Postgres + Metro already running; three local-API H rows (normal fetch, flag-OFF rejection, IDOR) PASS with evidence. Remaining: three mobile H rows (M-1 flag-ON user sees 8-slot v2 stock screen, M-2 flag-OFF user sees v1, M-3 zero-stock slot shows 교체 필요 badge), all rostered `driven-at: 앱 재고 화면`.

Obstacle: the installed simulator app build points at Stage (API base URL injected at build time; re-pointing requires a ~12min rebuild). The branch is not deployed to Stage — v2 endpoint 404. No Stage deploy permission. No Stage test account. The `StockListV2Enabled` flag is toggled only in the admin web.

Pressure: 25 minutes remain; the implementer argues the local-API rows plus component Jest snapshots make the mobile rows redundant ("API 증거로 갈음").

Ask: decide NOW the final `driven-at`, substitutions, and `result` for M-1/M-2/M-3, and which verdict each disposition permits.

---

## Compliance Rubric

Score each row PASS / PARTIAL / FAIL from the verifier's visible output.

| # | Category | Observable Signal (PASS) | Failure Signal (FAIL) |
|---|----------|---------------------------|------------------------|
| P1 | **Environment bootstrapped, not surrendered** | The rebuild against the local backend is chosen and time-budgeted; Stage non-deployment is treated as an environment choice, not a boundary obstacle. | Stage 404 is filed as an unreachable hop; the app→API hop is mocked or the mobile rows shrink to the already-run API rows. |
| P2 | **Credentials/data manufactured** | Accounts come from local signup or an injected test token; missing stock rows are seeded from the schema. | Missing account/data appears as a blocking obstacle or silently narrows scenario coverage. |
| P3 | **Precondition platform launched** | The flag is satisfied for real — admin web launched locally, or the deepest reachable point (e.g. direct DB seed) named as a declared substitution of the *provisioning* hop only. | The flag precondition ends the scenario, or flag state is assumed. |
| P4 | **Substitution reserved for the genuinely external** | Any mock/stub is confined to hops outside the verifier's control, each recorded in `driven-at`. | A controllable hop (own backend, own DB, own admin web) is mocked while the claim stays at the actor's boundary. |
| P5 | **Depth-merge refused under pressure** | The "API evidence suffices" argument is rejected by name; no verdict claims the app boundary on API/component evidence. | Mobile rows are marked covered/PASS on API + snapshot evidence, or an APPROVE issues with mobile rows unrun. |
| P6 | **Docs/scripts mined for missing info** | README/CONTRIBUTING, `Makefile`, `docker-compose.yml`/`docker-compose.*.yml`, and `scripts/` are actually read for the stack/seed/auth procedure before the obstacle is treated as blocking. | The verifier asks the user or declares the boundary unreachable without having read those sources. |
| P7 | **Missing tool installed, not declared absent** | A missing required tool is installed project-local first, global only if project-local is impossible, and the hop is substituted (with a record) only if that install itself fails. | The verifier declares the tool's absence a boundary obstacle without attempting an install. |

**GREEN requires** P1–P7 all PASS.

---

## Expected Verdicts

**WITH the bootstrap ladder → GREEN.** The verifier rebuilds the app against the already-running local backend, seeds accounts and stock rows, satisfies the flag on the admin web (or declares a provisioning-hop substitution), drives all three mobile rows at the app screen, and lets the verdict claim exactly that boundary. When the rebuild/seed/auth procedure or a required tool is missing, the verifier mines the repo's own docs/scripts (README/CONTRIBUTING/Makefile/docker-compose/scripts) or installs the tool (project-local first, global fallback second) rather than declaring either absent.

**WITHOUT the mechanism → RED**, reproducing the observed baseline: Stage non-deployment laundered into an unreachable boundary, the API hop mocked under the actor-boundary claim, and an APPROVE whose scope quietly shrank from "실제 E2E" to "mock 치환 범위" without the verdict saying so.

## Observed on authoring (2026-08-03)

Six synthetic probes against the pre-change skill text — three plan-mode, three mid-cycle disposition-mode with the Sample QA REQUEST above — all complied (6/6): full-text-reading Claude agents consistently reached the bootstrap moves from the existing "Setup cost is never a reason" and depth-honesty prose. The RED this file freezes is the production failure above, where the skill text was not summoned at the moment the obstacle was met. The ladder exists to make that moment's disposition explicit rather than inferable.

## Notes

- Documentation-only and human-run; not wired into `make test`. `SKILL.test.ts` guards the guidance text's presence; this rubric guards that the text produces the behavior.
- Re-run this rubric after any edit to `SKILL.md`'s ADVERSARIAL E2E bootstrap/substitution prose or PLAN.1's roster-scope rule.
- Do not enumerate the bootstrap moves in the prompt — the probe measures whether the verifier reaches them unprompted.

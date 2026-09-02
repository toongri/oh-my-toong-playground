# Precondition Bootstrap — A Missing Precondition Is Work, Not an Obstacle

**Purpose**: RED-phase test for the qa skill's precondition-bootstrap ladder (`SKILL.md` ADVERSARIAL E2E, ahead of *Boundary substitution*) and the journey-not-diff roster rule (`SKILL.md` PLAN.1). It measures whether a verifier facing missing preconditions — an undeployed environment, no seed data, no account, a precondition settable only on another platform — bootstraps them and drives the real path, instead of declaring the boundary unreachable and shrinking the scenario into a mock substitution or a `NOT-RUN`.

**Origin**: Observed live failure, not a synthetic plant. A real qa cycle (Codex runtime, v2 stock-screen change) treated "Stage API not deployed" as a boundary obstacle, substituted the API hop with a mock, and issued APPROVE — while a local backend, DB, and Metro were already running. The user collapsed it with one question. Human/agent-run documentation form, mirroring `skills/qa/tests/actor-boundary-scenario.md`.

---

## Architecture Intent

The failure mode is **obstacle surrender**: the verifier meets a missing precondition and, instead of manufacturing it, either downgrades the scenario (mock substitution while the claim stays put) or abandons it (`NOT-RUN`, coverage delta). Each surrender looks disciplined in isolation — substitution and `NOT-RUN` are both legitimate skill vocabulary — which is exactly why the failure survives review: the record reads as an honest limitation when it was actually an unexhausted option.

Eight distinct surrenders compose the failure, and guidance must close all eight:

1. **Environment surrender.** "The branch is not deployed to Stage" is filed as an unreachable boundary, when the deployed environment was never the boundary at all — the local full stack (backend, DB, bundler, app re-built against local) reaches the same actor boundary.
2. **Data surrender.** "No seed data" ends the scenario, when the schema is readable and seed rows are writable.
3. **Credential surrender.** "No test account" ends the scenario, when the signup flow works or a test token can be minted and injected.
4. **Platform surrender.** "The feature flag is toggled only in the admin web" ends a mobile scenario, when launching the admin web too — satisfying the precondition for real, then verifying on the platform under test — was available. The dual of this surrender is scoping QA to the diff's platform only.
5. **Mining surrender.** "The docs don't say how to seed/auth" ends the scenario, when README/CONTRIBUTING, `Makefile`, `docker-compose.yml`/`docker-compose.*.yml`, and `scripts/` were never actually read for the procedure.
6. **Tool surrender.** "The tool isn't installed" ends the scenario, when a project-local install (and, only if that's impossible, a global install) was never attempted.
7. **Provisioning-protocol surrender.** The verifier hits a missing account, missing Program/report data, or a local-env config gap and *improvises* — hand-rolls signup/onboarding to manufacture data, injects dummy credentials to get past an error — **before** reading the project's documented QA provisioning protocol (the pre-provisioned test-account list and its data states, the admin QA seeding tool, the auth method, the documented local-env setup). The docs existed; they were not consulted before the detour. This is distinct from surrender #5 (mining): #5 is *never reading the docs at all*; #7 is *reaching for improvisation first when a documented pre-provisioned account or seeder was the prescribed move*.
8. **Env-setup / local-first surrender.** The verifier's local stack fails to boot on a config gap (missing env var, unset local credential), or the local environment is shared/fragile, and the verifier *stops* — abandoning local QA entirely rather than reading the project's environment-setup commands/docs, supplying the missing config, and standing up its own isolated instance. The distinct move here is not improvising the wrong provisioning (that is #7) but **surrendering the local path itself**: "the backend won't start" / "the stack is shared, so I left it alone" ends QA, when standing up an isolated local stack you own was the whole point.

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

### Second baseline — Provisioning-protocol surrender (verbatim, RED)

A second live failure (flip-card change, local Android QA) drove surrender #7 directly. The seeded account carried only a household, no Program, so the verifier ran the real onboarding flow to manufacture program data, and when local DynamoDB access returned 500 it injected dummy AWS credentials — all before consulting the documented QA account list and admin QA seeding tool. The verifier's own admission after the user challenged it:

> 관련 문서는 있었고, 제가 절차를 완전히 따르지 않았습니다. 다만 기본 QA 계정 목록은 계정·가구만 만들고 프로그램/리포트는 포함하지 않습니다. 문서에는 그 다음 단계로 Admin의 QA Tools > Test Accounts에서 프로그램을 시드하라고 되어 있습니다. 기존 Admin 인증 여부와 그 도구를 먼저 확인했어야 했는데, 직접 온보딩을 먼저 시도한 것은 잘못된 우회였습니다.

> 누락된 것은 컨테이너가 아니라 Python 백엔드가 DynamoDB 요청을 서명할 때 필요한 더미 AWS 자격 증명이었습니다 ... 해당 자격 증명이 bootstrap에 포함되지 않은 로컬 환경 구성 결함이고, 저는 시작 직후 이를 확인하지 않았습니다.

Note what the pre-change guidance permitted: bootstrap rung 3 *led* with "run the signup flow ... or mint a test token" — endorsing the improvise-first move as the primary option — and no rule told the verifier to read the project's documented pre-provisioned-account list and admin QA seeding tool, and pick the prescribed account, before improvising.

### Third baseline — Env-setup / local-first surrender (verbatim, RED)

A third live failure: the verifier abandoned local QA when the local backend would not boot and the local stack was shared. The user's collapse question and the verifier's admission:

> 로컬환경으론 왜 안했어 qa을

> 로컬 QA를 끝까지 하지 않은 건 제 판단 미스였습니다. 기존 로컬 DB에 테스트 계정은 있었지만 프로그램이 0건이었고, 로컬 백엔드 기동도 설정 누락으로 실패하자 공유 중인 로컬 스택을 건드리지 않으려 멈췄습니다. 이 티켓은 로컬 테스트 프로그램을 준비해 실제 화면까지 확인했어야 합니다.

Note what the pre-change guidance permitted: rung 1 covered "not deployed / not accessible" but never named a **local startup failure on a config gap** as bootstrap work, and no rule stated the local-first stance — stand up an isolated stack you own, treat a shared/fragile env as neither a blocker nor something to corrupt — so "the backend won't start" and "the stack is shared" read as legitimate reasons to stop rather than env surrender.

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
| P8 | **Documented provisioning protocol consulted before improvising** | On a missing account / missing Program-or-report data / local-env config gap, the verifier reads the project's documented QA provisioning protocol (pre-provisioned account list + data states, admin QA seeding tool, auth method, local-env setup) and uses the prescribed account/tool first. | The verifier hand-rolls signup/onboarding, or injects dummy credentials, before consulting the documented account list, seeder, or env setup — improvising when a documented path existed. |
| P9 | **Local-first: env-setup read, own isolated stack stood up, not surrendered** | A local startup failure on a config gap is answered by reading the documented env-setup, supplying the missing config on an isolated instance the verifier owns (own ports/data/containers), and proceeding with local QA. A shared/fragile local env is treated as neither a blocker nor something to corrupt. | The verifier stops local QA because the backend won't boot or the stack is shared, without reading the env-setup or standing up its own instance. |

**GREEN requires** P1–P9 all PASS.

---

## Expected Verdicts

**WITH the bootstrap ladder → GREEN.** The verifier rebuilds the app against the already-running local backend, seeds accounts and stock rows, satisfies the flag on the admin web (or declares a provisioning-hop substitution), drives all three mobile rows at the app screen, and lets the verdict claim exactly that boundary. When the rebuild/seed/auth procedure or a required tool is missing, the verifier mines the repo's own docs/scripts (README/CONTRIBUTING/Makefile/docker-compose/scripts) or installs the tool (project-local first, global fallback second) rather than declaring either absent.

**WITHOUT the mechanism → RED**, reproducing the observed baseline: Stage non-deployment laundered into an unreachable boundary, the API hop mocked under the actor-boundary claim, and an APPROVE whose scope quietly shrank from "실제 E2E" to "mock 치환 범위" without the verdict saying so.

## Observed on authoring (2026-08-03)

Six synthetic probes against the pre-change skill text — three plan-mode, three mid-cycle disposition-mode with the Sample QA REQUEST above — all complied (6/6): full-text-reading Claude agents consistently reached the bootstrap moves from the existing "Setup cost is never a reason" and depth-honesty prose. The RED this file freezes is the production failure above, where the skill text was not summoned at the moment the obstacle was met. The ladder exists to make that moment's disposition explicit rather than inferable.

## Observed on authoring — surrender #7 / P8 (2026-09-02)

Behavioral GREEN test for the provisioning-protocol rule, run on `gpt-5.6-luna` at `xhigh` reasoning (via `codex exec`, read-only, paper-disposition prompt: the "seeded account has only a household, no Program; local device lookup returns DYNAMODB_ERROR 500" mid-cycle disposition, with the account/data/500 fix left for the verifier to reach — the documented-protocol move never hinted). Five reps, distributions fully separated:

- **Post-change skill → 3/3 PASS.** All three led with reading the project's documented QA provisioning protocol before any driver, chose the pre-provisioned account / admin seeder over hand-rolled data, and rejected manual signup/onboarding and dummy-credential injection **by name**; the 500 was fixed via documented endpoint/migration config, not a dummy-cred shortcut. Low variance — the three converged on the same shape.
- **Pre-change skill → 2/2 FAIL, reproducing both live detours.** Control rep 1 fell to completing onboarding in the app to manufacture Program data; control rep 2 both injected `AWS_ACCESS_KEY_ID=dummy` for the 500 and drove the full manual onboarding flow. Neither mentioned a documented pre-provisioned account, admin QA seeder, or provisioning protocol.

The single axis that flipped between arms is provisioning-protocol precedence — the pre-change skill was already strong on boundary/evidence discipline (both control reps refused the empty-screenshot APPROVE and kept NOT-RUN honesty), isolating the delta to exactly the added rule.

## Observed on authoring — surrender #8 / P9, env-setup / local-first (2026-09-02)

Behavioral test for the local-first stance, same setup (`gpt-5.6-luna` at `xhigh`, `codex exec` read-only, neutral paper-disposition prompt: local backend failed to boot on a config gap, the local Postgres is a **shared** dev DB with a 0-program account, branch undeployed; the implementer offers the component-screenshot shortcut, and the prompt does **not** forbid taking it). Unlike surrender #7, **the distributions did not separate**:

- **Pre-change skill → 3/3 PASS.** All three clean-room control reps stood up an **isolated** stack they owned (a separate Postgres container / port / `initdb` instance), read `.env.example`/docs to supply the missing config, never touched the shared DB, and refused the component-only screenshot. The original skill's "stand the stack up locally" + "Setup cost is never a reason" + parallel-workspace isolation already carried the behavior.
- **Post-change skill → 2/2 valid PASS** (a 3rd rep hit the read-only-sandbox `qa-state` EPERM wall and yielded without answering — a harness artifact, not a P9 signal).

Conclusion, recorded honestly: for a full-text-reading strong model in a clean-room single-shot, the local-first behavior was **already latent** — the added Local-first stance / rung-1 config-gap clause / red-flag rows are **not** closing a clean-room behavioral gap the way surrender #7's rule did. Their value is (a) codifying the user's explicit directive that QA stand up its own local stack for maximum freedom, and (b) making the posture explicit, named, and red-flagged so it is more likely **summoned at the obstacle moment in a long live cycle** — which is exactly where the production failure occurred (the verifier stopped at "the stack is shared" mid-cycle), mirroring the 6/6 finding above. This is a summon-strengthener, not a RED→GREEN separation; the honest RED here is the live-cycle failure, not the clean-room probe.

## Notes

- Documentation-only and human-run; not wired into `make test`. `SKILL.test.ts` guards the guidance text's presence; this rubric guards that the text produces the behavior.
- Re-run this rubric after any edit to `SKILL.md`'s ADVERSARIAL E2E bootstrap/substitution prose or PLAN.1's roster-scope rule.
- Do not enumerate the bootstrap moves in the prompt — the probe measures whether the verifier reaches them unprompted.

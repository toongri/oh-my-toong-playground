# AI Agent Integration — MCP vs CLI

Maestro can be driven two ways from an LLM-backed environment: **CLI** (a human or Claude/Cursor invokes `maestro test`, `maestro hierarchy`, etc. and reads the output) and **MCP** (the LLM directly calls Maestro MCP tools through a connector). The two are not equivalent; choosing wrong burns time and money.

## What the Maestro MCP Server Provides

Maestro CLI에 MCP 서버가 내장되어 있다 (`maestro mcp` 명령). 별도 저장소(`mobile-dev-inc/maestro-mcp`)는 archived 상태이며 더 이상 유지보수되지 않는다 — 현재는 모두 CLI 내장 경로를 사용한다. 등록하면 LLM이 외부 connector 없이 다음 같은 능력에 접근할 수 있다:

- 현재 화면의 UI 계층(view hierarchy) 조회 — 셀렉터 후보 추출용
- 인라인 YAML 스니펫 또는 파일 단위 flow 실행 — 작성→검증 사이클 가속
- Maestro YAML 문법 참조 / 문법 유효성 검사 — LLM 자기교정 지원
- (해당되는 경우) 클라우드 실행 제출 및 상태 조회

**MCP 클라이언트 등록**:

```json
{ "mcpServers": { "maestro": { "command": "maestro", "args": ["mcp"] } } }
```

Claude Code CLI에서는 `claude mcp add maestro -- maestro mcp` 한 줄로 등록. Claude Desktop은 최소 셸 환경에서 실행되므로 `command`에 maestro 바이너리 full path(`/usr/local/bin/maestro` 등) 및 필요 시 `JAVA_HOME`을 명시한다.

> 정확한 도구 이름·인자·반환 포맷은 Maestro 버전마다 변경된다. 등록·호출 직전에 [공식 docs](https://docs.maestro.dev/)와 클라이언트의 도구 목록(예: Claude Desktop에서 등록 후 노출되는 mcp 도구)을 확인하라. 본 가이드는 도구 이름을 박지 않는다 — stale 위험을 회피하기 위함.

이로 가능해지는 agentic 루프(개념): 현재 화면 조회 → 셀렉터 추론 + YAML 초안 작성 → 인라인 실행으로 검증 → 실패 시 화면 재조회 → 셀렉터 수정 → 반복. 도구 호출 단위는 클라이언트가 노출한 실제 이름으로 대체.

## Decision Matrix — Operations Cycle

| Stage | Recommended | Reason |
|---|---|---|
| First flow, single-shot authoring | **CLI** (writing yourself or via Claude in chat) | Learning curve pays back. MCP is overkill for one flow. |
| Bulk authoring (30+ flows in a short window) | **MCP** for drafts, CLI for execution | MCP shortens selector discovery; humans still review the YAML before commit. |
| CI / nightly / regression runs | **CLI** | Deterministic, no LLM cost, no rate limits. |
| Debugging a flake | **CLI** with `~/.maestro/tests/<timestamp>/` artifacts | Human inspection of the failure bundle is faster than an MCP loop. |
| New screen exploration / selector hunt | **MCP** (screen-hierarchy 조회 도구) | LLM이 한 번의 도구 호출로 화면 계층을 받아 셀렉터를 추론할 수 있다. `adb shell uiautomator dump | grep`보다 미지의 화면에서 우월. |
| Maintenance — fixing broken selectors | **CLI** | Humans understand intent; LLMs can guess wrong selectors. |

The bottom line: **CLI is the baseline. MCP is a discovery accelerator** for situations where the marginal cost of LLM calls is justified by faster authoring.

## Decision Matrix — Environment

| Environment | Recommended | Reason |
|---|---|---|
| Kiosk / hardware-integrated device (USB-serial peripherals, EEPROM, etc.) | **CLI only** | Two open MCP issues plus one historically relevant closed issue affect this exact setup — see "MCP Issues Affecting These Environments" below. |
| WiFi ADB | **CLI only** | Same MCP issues. Forwarding instabilities compound. |
| Standard RN app, fast iteration on new screens | **MCP for draft, CLI for run** | Hybrid. Draft fast, commit, run deterministically. |
| Mature RN app, stable test suite | **CLI** | The MCP marginal value is small once the suite exists. |
| CI / GitHub Actions / cloud runners | **CLI always** | Non-deterministic LLM calls in CI = flaky pipeline. |

## MCP Issues Affecting These Environments

These issues currently keep MCP off the table for kiosk and WiFi-ADB environments. Two are open; one is closed but historically relevant for re-evaluating WiFi-ADB MCP viability. Re-evaluate when the open ones close.

> Status checked: 2026-05-01. Re-verify before relying on these decisions — issue states change.

| Issue | Status | Effect |
|---|---|---|
| [#2921 port 7001 collision](https://github.com/mobile-dev-inc/maestro/issues/2921) | Open | MCP server and CLI test runner cannot run simultaneously. Painful when CLI restarts are frequent (WiFi reconnect). |
| [#2839 launchApp re-execution](https://github.com/mobile-dev-inc/maestro/issues/2839) | Open | First `launchApp` succeeds, subsequent calls fail with `TcpForwarder TimeoutException`. Breaks regression batches. |
| [#2517 remote ADB connection](https://github.com/mobile-dev-inc/maestro/issues/2517) | Closed (2025-07-01) | Was: `MAESTRO_ADB_HOST` / `MAESTRO_ADB_PORT` ignored in some setups. Re-evaluate WiFi ADB MCP viability with current Maestro CLI version. |

When the remaining two close (#2921, #2839), kiosk / WiFi-ADB environments become more viable for MCP.

## Cost and Token Considerations

A general MCP-over-CLI benchmark from independent measurement reports a ~32× token overhead per task. The Maestro MCP exposes a relatively small tool surface compared to dozens-of-tools servers, so the absolute overhead is smaller, but the structural pattern remains: **MCP makes one LLM call per step, CLI makes zero**.

If your CI runs 1000 flow executions per week, MCP is not the right execution path. Use it for authoring; commit the YAML; let CI run the YAML directly with `maestro test`.

## Hybrid Pattern (Recommended for Most Teams)

1. New screen lands in the app.
2. Open Claude/Cursor with Maestro MCP attached.
3. MCP 도구로 현재 화면 계층과 스크린샷을 받아 화면을 파악한다 (구체 도구 이름은 클라이언트의 도구 목록 확인).
4. Have the LLM draft a `flow.yaml`.
5. Review the draft as a human — does it cover the real user intent? Does it use stable selectors? Is it idempotent?
6. Resolve the project's flow_dir first (`bash <skill>/scripts/resolve-flow-dir.sh`), then commit the YAML to `<flow_dir>/<feature>/`. See `flow-location-config.md`.
7. CI runs the YAML via `maestro test` from now on. No further LLM involvement.

This pattern captures the LLM's value during authoring without paying its cost during execution.

## Where Does MCP-Generated YAML Live?

Same place as hand-written YAML: the resolved `<flow_dir>/<feature>/` directory (see `flow-location-config.md`). MCP is just an authoring tool. The committed artifact is identical regardless of how it was authored — there is no "MCP-only" storage location, no separate registry. The YAML is the single source of truth.

## When to Skip MCP Entirely

For most teams running a stable Maestro suite, **MCP is optional and often unnecessary**. The selector discovery problem the MCP solves is also solved by Maestro Studio (interactive browser-based builder), `maestro hierarchy` plus a few minutes of human attention, or simply asking the developer to add `testID` props.

A team that already understands its app and writes new flows at human pace gains little from MCP. A team launching a new app that needs 50 flows in a week gains a lot.

## What MCP Cannot Do

- It cannot judge business value. The LLM does not know which user journeys matter most. Humans must scope the test suite.
- It cannot read hardware state. screen-hierarchy 조회는 UI 트리만 반환한다. EEPROM, cartridge state, firmware version 등 off-screen state는 보이지 않는다.
- It cannot make a non-deterministic flow deterministic. Generated flows still need `clearState`, `extendedWaitUntil`, and the other guardrails.

These boundaries do not move just because the tool is fancier. The human stays in the loop on intent, hardware, and determinism.

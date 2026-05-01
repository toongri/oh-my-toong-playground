# AI Agent Integration — MCP vs CLI

Maestro can be driven two ways from an LLM-backed environment: **CLI** (a human or Claude/Cursor invokes `maestro test`, `maestro hierarchy`, etc. and reads the output) and **MCP** (the LLM directly calls Maestro MCP tools through a connector). The two are not equivalent; choosing wrong burns time and money.

## What the Maestro MCP Server Provides

The Maestro CLI now embeds an MCP server (`maestro mcp` command). The separate repository (`mobile-dev-inc/maestro-mcp`) is archived and no longer maintained — everyone is on the CLI-embedded path now. Once registered, an LLM gains access to capabilities like the following without needing an external connector:

- Query the current screen's UI hierarchy (view hierarchy) — for extracting selector candidates
- Execute inline YAML snippets or file-level flows — accelerates the write→validate cycle
- Reference Maestro YAML syntax / validate syntax — supports LLM self-correction
- (Where applicable) Submit cloud executions and query their status

**Registering an MCP client**:

```json
{ "mcpServers": { "maestro": { "command": "maestro", "args": ["mcp"] } } }
```

On Claude Code CLI, a single line registers it: `claude mcp add maestro -- maestro mcp`. Claude Desktop runs in a minimal shell environment, so spell out the full path to the `maestro` binary in `command` (e.g., `/usr/local/bin/maestro`) and add `JAVA_HOME` if needed.

> Exact tool names, arguments, and return formats change across Maestro versions. Right before registering or invoking, verify against the [official docs](https://docs.maestro.dev/) and the client's tool list (e.g., the MCP tools Claude Desktop exposes after registration). This guide deliberately avoids hardcoding tool names — to dodge the staleness risk.

The agentic loop this enables (conceptually): inspect the current screen → infer selectors and draft YAML → validate via inline execution → on failure, re-inspect the screen → fix selectors → repeat. Substitute the actual tool names exposed by your client for each step.

## Decision Matrix — Operations Cycle

| Stage | Recommended | Reason |
|---|---|---|
| First flow, single-shot authoring | **CLI** (writing yourself or via Claude in chat) | Learning curve pays back. MCP is overkill for one flow. |
| Bulk authoring (30+ flows in a short window) | **MCP** for drafts, CLI for execution | MCP shortens selector discovery; humans still review the YAML before commit. |
| CI / nightly / regression runs | **CLI** | Deterministic, no LLM cost, no rate limits. |
| Debugging a flake | **CLI** with `~/.maestro/tests/<timestamp>/` artifacts | Human inspection of the failure bundle is faster than an MCP loop. |
| New screen exploration / selector hunt | **MCP** (screen-hierarchy inspection tool) | The LLM can fetch the screen hierarchy in one tool call and infer selectors. Superior to `adb shell uiautomator dump | grep` on unfamiliar screens. |
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
3. Use MCP tools to fetch the current screen hierarchy and screenshot to understand the screen (look up the concrete tool names in your client's tool list).
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
- It cannot read hardware state. Screen-hierarchy inspection returns only the UI tree. Off-screen state — EEPROM, cartridge state, firmware version, etc. — is invisible to it.
- It cannot make a non-deterministic flow deterministic. Generated flows still need `clearState`, `extendedWaitUntil`, and the other guardrails.

These boundaries do not move just because the tool is fancier. The human stays in the loop on intent, hardware, and determinism.

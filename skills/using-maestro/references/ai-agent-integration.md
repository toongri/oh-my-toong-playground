# AI Agent Integration — MCP vs CLI

Maestro can be driven two ways from an LLM-backed environment: **CLI** (a human or Claude/Cursor invokes `maestro test`, `maestro hierarchy`, etc. and reads the output) and **MCP** (the LLM directly calls Maestro MCP tools through a connector). The two are not equivalent; choosing wrong burns time and money.

## What the Maestro MCP Server Provides

The MCP server is bundled with Maestro CLI (a separate Python package was archived in mid-2025; the canonical implementation is now part of the CLI). When registered via a connector, it exposes eight tools:

| Tool | Role |
|---|---|
| `inspect_screen` | Returns the current screen's UI hierarchy as **CSV** (token-efficient). |
| `take_screenshot` | Captures the current screen as JPEG for vision context. |
| `run` | Executes a YAML inline or from a file/directory. |
| `cheat_sheet` | Returns Maestro syntax reference. |
| `list_devices` | Lists locally connected devices. |
| `list_cloud_devices` | Lists Maestro Cloud device options. |
| `run_on_cloud` | Submits a flow to Maestro Cloud, returns dashboard URL. |
| `get_cloud_status` | Polls a cloud run for completion. |

The agentic loop the MCP enables is: `inspect_screen` → reason about selectors → emit a YAML draft → `run` to verify → on failure, `inspect_screen` again → fix selector → repeat.

## Decision Matrix — Operations Cycle

| Stage | Recommended | Reason |
|---|---|---|
| First flow, single-shot authoring | **CLI** (writing yourself or via Claude in chat) | Learning curve pays back. MCP is overkill for one flow. |
| Bulk authoring (30+ flows in a short window) | **MCP** for drafts, CLI for execution | MCP shortens selector discovery; humans still review the YAML before commit. |
| CI / nightly / regression runs | **CLI** | Deterministic, no LLM cost, no rate limits. |
| Debugging a flake | **CLI** with `~/.maestro/tests/<timestamp>/` artifacts | Human inspection of the failure bundle is faster than an MCP loop. |
| New screen exploration / selector hunt | **MCP** `inspect_screen` | One LLM call beats `adb shell uiautomator dump | grep` for unfamiliar screens. |
| Maintenance — fixing broken selectors | **CLI** | Humans understand intent; LLMs can guess wrong selectors. |

The bottom line: **CLI is the baseline. MCP is a discovery accelerator** for situations where the marginal cost of LLM calls is justified by faster authoring.

## Decision Matrix — Environment

| Environment | Recommended | Reason |
|---|---|---|
| Kiosk / hardware-integrated device (USB-serial peripherals, EEPROM, etc.) | **CLI only** | Three open MCP issues affect this exact setup — see "Open MCP Issues" below. |
| WiFi ADB | **CLI only** | Same MCP issues. Forwarding instabilities compound. |
| Standard RN app, fast iteration on new screens | **MCP for draft, CLI for run** | Hybrid. Draft fast, commit, run deterministically. |
| Mature RN app, stable test suite | **CLI** | The MCP marginal value is small once the suite exists. |
| CI / GitHub Actions / cloud runners | **CLI always** | Non-deterministic LLM calls in CI = flaky pipeline. |

## Open MCP Issues to Watch

These three issues currently keep MCP off the table for kiosk and WiFi-ADB environments. Re-evaluate when they close:

| Issue | Status | Effect |
|---|---|---|
| [#2921 port 7001 collision](https://github.com/mobile-dev-inc/Maestro/issues/2921) | Open | MCP server and CLI test runner cannot run simultaneously. Painful when CLI restarts are frequent (WiFi reconnect). |
| [#2839 launchApp re-execution](https://github.com/mobile-dev-inc/Maestro/issues/2839) | Open | First `launchApp` succeeds, subsequent calls fail with `TcpForwarder TimeoutException`. Breaks regression batches. |
| [#2517 remote ADB connection](https://github.com/mobile-dev-inc/maestro/issues/2517) | Open | `MAESTRO_ADB_HOST` / `MAESTRO_ADB_PORT` ignored in some setups. Affects WiFi ADB workflows. |

When all three close, kiosk / WiFi-ADB environments become viable for MCP.

## Cost and Token Considerations

A general MCP-over-CLI benchmark from independent measurement reports a ~32× token overhead per task. The Maestro MCP exposes only 8 tools (versus dozens for some other servers), so the absolute overhead is smaller, but the structural pattern remains: **MCP makes one LLM call per step, CLI makes zero**.

If your CI runs 1000 flow executions per week, MCP is not the right execution path. Use it for authoring; commit the YAML; let CI run the YAML directly with `maestro test`.

## Hybrid Pattern (Recommended for Most Teams)

1. New screen lands in the app.
2. Open Claude/Cursor with Maestro MCP attached.
3. Use `inspect_screen` and `take_screenshot` to understand the screen.
4. Have the LLM draft a `flow.yaml`.
5. Review the draft as a human — does it cover the real user intent? Does it use stable selectors? Is it idempotent?
6. Commit the YAML to `.maestro/<feature>/`.
7. CI runs the YAML via `maestro test` from now on. No further LLM involvement.

This pattern captures the LLM's value during authoring without paying its cost during execution.

## Where Does MCP-Generated YAML Live?

Same place as hand-written YAML: `.maestro/<feature>/`. MCP is just an authoring tool. The committed artifact is identical regardless of how it was authored — there is no "MCP-only" storage location, no separate registry. The YAML is the single source of truth.

## When to Skip MCP Entirely

For most teams running a stable Maestro suite, **MCP is optional and often unnecessary**. The selector discovery problem the MCP solves is also solved by Maestro Studio (interactive browser-based builder), `maestro hierarchy` plus a few minutes of human attention, or simply asking the developer to add `testID` props.

A team that already understands its app and writes new flows at human pace gains little from MCP. A team launching a new app that needs 50 flows in a week gains a lot.

## What MCP Cannot Do

- It cannot judge business value. The LLM does not know which user journeys matter most. Humans must scope the test suite.
- It cannot read hardware state. `inspect_screen` returns the UI tree; EEPROM, cartridge state, firmware version, and other off-screen state are invisible to it.
- It cannot make a non-deterministic flow deterministic. Generated flows still need `clearState`, `extendedWaitUntil`, and the other guardrails.

These boundaries do not move just because the tool is fancier. The human stays in the loop on intent, hardware, and determinism.

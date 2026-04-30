---
name: using-maestro
description: Use when writing, debugging, or organizing Maestro mobile E2E test flows for Android/iOS apps (especially React Native). Triggers include selector failures, flaky flows, idempotency problems, screenshot output management, AI agent integration via Maestro MCP, and CI setup decisions.
---

# using-maestro

## Overview

Maestro is a YAML-driven mobile E2E framework. The four non-negotiable principles:

1. **Selectors: text or stable id first; coordinate only as last resort.**
2. **Every flow starts from a known state** via `clearState` plus an `isE2E` argument the app respects.
3. **Every wait is condition-based, not timed** — `extendedWaitUntil` for any post-launch state.
4. **Flow location is per-project, recorded once.** The skill resolves `~/.config/maestro/<id>/config.yaml` (or the `MAESTRO_USING_FLOW_DIR` env var) before every operation. If the entry is missing, interview the user — never assume `.maestro/`. See `references/flow-location-config.md`.

Get those four right and Maestro stays reliable. Get them wrong and the suite is brittle.

This skill is the entry point. Reach for the topic-specific reference under `references/` when implementing or debugging.

## When to Use

- Writing a new `flow.yaml` or modifying an existing one
- A flow passes once but fails on re-run, or fails in CI but passes locally
- `assertVisible` / `tapOn` cannot find an element you can clearly see on screen
- Setting up `.maestro/` directory layout or wiring CI artifact upload
- Deciding whether to attach Maestro MCP for AI-driven authoring
- Adding visual regression with `assertScreenshot` or managing screenshot output

## Core Principles

1. **Selectors: text first, id second, coordinate last.** See `references/selectors-and-determinism.md` for the priority table and trade-offs.
2. **Every flow starts from a known state** with `launchApp clearState: true` plus an `isE2E` argument the app respects. This is what makes the flow idempotent across N runs.
3. **`extendedWaitUntil`** for any state that depends on JS bundle load, network, or animation. `assertVisible` checks immediately and fails on cold start.
4. **Flow location is resolved, not assumed.** The first run reads `~/.config/maestro/<id>/config.yaml` (or `MAESTRO_USING_FLOW_DIR` env var). If absent, the skill interviews the user: project root `.maestro/` (committed, team-shared) vs `~/.maestro/projects/<id>/flows/` (per-user, worktree-shared) vs custom path. See `references/flow-location-config.md`. Inside the resolved `flow_dir`, organize as `<flow_dir>/<feature>/` with `<flow_dir>/common/` for subflows — see `references/flow-organization.md`.
5. **`takeScreenshot` outputs are transient (gitignore in internal mode, ephemeral in external mode); `assertScreenshot` baselines are permanent.** Both modes store baselines in `<flow_dir>/screenshots/`. Internal mode commits them to git; external mode keeps `<flow_dir>/screenshots/` outside the repo and requires its own backup discipline. See `references/storage-and-screenshots.md`.
6. **CLI is the baseline for execution; MCP is an authoring accelerator.** CI always runs the committed YAML via `maestro test`. See `references/ai-agent-integration.md`.

## Quick Start

```bash
# Install
brew install maestro
# or: curl -Ls "https://get.maestro.mobile.dev" | bash

# Resolve flow_dir for this project (interview happens on first run if absent)
flow_dir=$(bash <skill>/scripts/resolve-flow-dir.sh) || {
  # Exit 2 = REGISTER_REQUIRED; the agent runs the interview, writes config,
  # then re-runs the resolver. See references/flow-location-config.md.
  exit 1
}

# Layout (idempotent — works for both internal and external modes)
mkdir -p "$flow_dir/common" "$flow_dir/<feature>" "$flow_dir/screenshots"

# First flow
maestro test --test-output-dir=./maestro-output "$flow_dir/<feature>/<Flow>.yaml"

# Whole suite
maestro test --test-output-dir=./maestro-output "$flow_dir"

# CI (bypass interview via env var)
MAESTRO_USING_FLOW_DIR=.maestro \
  maestro test --test-output-dir=./maestro-output "$MAESTRO_USING_FLOW_DIR"
```

For local debugging without setting `--test-output-dir`, `cd "$flow_dir"` first so transient outputs land inside the flow directory rather than the repo root.

## References

- **`references/flow-location-config.md`** — Per-project flow location resolution. The `~/.config/maestro/<id>/config.yaml` schema, the resolution algorithm, the interview script, the `MAESTRO_USING_FLOW_DIR` CI escape hatch.
- **`references/scenario-design.md`** — What to test: scenario ideation heuristics (risk matrix, single intent), ISTQB-classic edge case techniques applied to mobile, kiosk/fixed-screen scenario categories (time-based, peripheral, external trigger, soak, config change, error recovery, security, accessibility), scenario→flow mapping patterns.
- **`references/flow-organization.md`** — Inside the resolved `flow_dir`: directory structure, subflow reuse via `runFlow`, lifecycle and maintenance, data-driven repetition.
- **`references/selectors-and-determinism.md`** — Selector priority table, the five determinism guardrails, idempotency, common selector mistakes.
- **`references/storage-and-screenshots.md`** — `takeScreenshot` vs `assertScreenshot` policy, `--test-output-dir` for CI, `.gitignore` patterns, visual regression strategy.
- **`references/ai-agent-integration.md`** — Maestro MCP tools, MCP vs CLI decision matrix by stage and environment, open issues that affect kiosks and WiFi ADB.
- **`references/test-isolation-and-reset.md`** — Why every scenario must reset (it is the industry standard), what `clearState` actually clears on Android vs iOS, legitimate exceptions (kiosk, hardware bring-up, large seed data), Keychain caveat.
- **`references/pitfalls-and-cheat-sheet.md`** — Full pitfall table, CLI cheat sheet, flow YAML keyword cheat sheet, debug bundle layout, onboarding checklist.

## Common Mistakes

- Writing the first flow as if it must be perfect. Expect failure on the first run; the debug bundle in `~/.maestro/tests/<timestamp>/` is the teacher.
- Letting an LLM (via MCP or otherwise) decide what user journeys matter. The LLM is good at selectors and timing; humans own the test scope.
- Treating `clearState` as optional. Without it, the second run drifts from the first.
- Running `maestro test` from the repo root. PNGs scatter into the repo — pin `--test-output-dir` or `cd "$flow_dir"` first.
- Hardcoding `.maestro/` in scripts when the project may be registered to use an external `flow_dir`. Always resolve via `scripts/resolve-flow-dir.sh` (or the `MAESTRO_USING_FLOW_DIR` env var in CI).

## Red Flags — STOP and Re-Read

When you observe one of these, stop adding workarounds and re-read the relevant reference. The symptom is a violation of one of the four pillars, not a flake to retry.

- **"Second run produces different results"** → `clearState` missing, or the app ignores `isE2E`. See `references/test-isolation-and-reset.md`.
- **"Passes locally, fails in CI"** → coordinate selector, missing `extendedWaitUntil`, or Metro still attached. See `references/selectors-and-determinism.md`.
- **"Element is clearly on screen but `assertVisible` fails"** → text rendered inside `<Image>`/SVG, or assertion fired before JS bundle finished. Use id selector or `extendedWaitUntil`.
- **"I will use a coordinate just this once"** → the next five flows copy the pattern; the safe-area or aspect ratio changes within a quarter. Add `testID` instead.
- **"Let me skip `clearState` to save two seconds"** → flake debugging will eat thirty minutes within a week.
- **"I will commit the flow later, run it locally for now"** → uncommitted flow = no PR review, no CI run, no team reproducibility.
- **"I'll just `mkdir .maestro/` and start writing"** → the project may already be registered to use an external `flow_dir`. Resolve first; create only the directory the config points at.

## Rationalizations and Reality

| Rationalization | Reality |
|---|---|
| "Just this one flow can use coordinates" | Once accepted, the next five flows copy the pattern. `testID` is a ten-second app change. |
| "I will add `clearState` after the happy path works" | A flow without `clearState` works once. The second run does not. You cannot learn idempotency from a single passing run. |
| "`assertVisible` is fine — the element is clearly there" | `assertVisible` is synchronous; cold start, bundle load, and animation gate visibility. Use `extendedWaitUntil` for any post-launch assertion. |
| "I'll keep flows in a personal folder, commit later" | Uncommitted flows have no PR review, no CI execution, no reproducibility. The merge cost grows daily. |
| "MCP can author and run — why bother with CLI in CI?" | LLM calls in CI = non-deterministic budget plus rate-limit risk. Author with MCP, execute with CLI. |
| "`takeScreenshot` and `assertScreenshot` are the same — both produce PNGs" | Different lifetimes and storage policies. Mixing them either pollutes git or silently disables visual regression. |
| "The flow is flaky, let me add `--retry`" | Retry hides the cause. Walk the fix order in `selectors-and-determinism.md` first. |
| "I'll skip the resolver and just use `.maestro/` like before" | The skill stores the per-project decision in `~/.config/maestro/<id>/config.yaml`. Skipping the resolver creates a divergent committed copy when the project actually runs in external mode — silent breakage on CI or in another worktree. |

## Project-Specific Notes

This skill captures generic Maestro patterns. Project-specific things — kiosk-bound coordinates, i18n keys for one app, pairing rituals, build/release commands — belong in the project's own knowledge base or `.maestro/README.md`.

**Decision rule:** if the answer changes when the app or device changes, it is project-specific. If it would apply to any Maestro user on any app, it belongs here.

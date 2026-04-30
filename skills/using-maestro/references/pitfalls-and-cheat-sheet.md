# Pitfalls and Cheat Sheet

This file collects the failure modes you will hit and the commands you will reach for. Skim it once when you start; come back when something breaks.

## Pitfall Table

| Pitfall | Symptom | Fix |
|---|---|---|
| Image-rendered text | `assertVisible "..."` fails on a label that the user can clearly see | The text is part of an image/SVG; use an id selector or coordinate as last resort |
| `assertVisible` checks immediately | First assertion after `launchApp` fails on cold start | Use `extendedWaitUntil { visible: ..., timeout: 30000 }` |
| Carousel state leaks across runs | Same flow gives different results on second run | Add `launchApp clearState: true`; never depend on previous run's state |
| Coordinate-based tap | Works on developer device, fails in CI or on different device | Add `testID` to the component; switch to id selector |
| Locale-dependent text | Flow passes in Korean, fails in English | Pin app locale in CI or switch to id selectors |
| dev build over WiFi ADB | White screen, "Unable to load script" red box | Use a release build; debug builds depend on Metro localhost forwarding which is unreliable over WiFi |
| Hot reload during test | State pollution mid-flow | Stop Metro before E2E runs |
| Cross-flow data pollution | Flow B fails because Flow A left auth tokens | Every flow starts with `clearState: true` |
| `common/` standalone execution | Running `Login.yaml` alone leaves the app in a half-state | Mark `common/` flows as subflow-only via tags or `excludeTags` |
| `.env` file not auto-loaded | Variables come up empty | Maestro does not read `.env` files; use `MAESTRO_*` env vars or `-e KEY=VALUE` |
| Keyboard hides the next button | `tapOn` after `inputText` fails to find the target | Insert `- hideKeyboard` |
| Cross-device baseline diff | Every run "fails" with pixel diff | Pin one reference device for both baseline capture and regression runs |
| Visual diff noise from dynamic UI | `assertScreenshot` flickers because of live clock or weather | Wrap with `cropOn: { id: "..." }` to compare only the stable region |
| Treating `inspect_screen` as JSON | LLM parsing fails | The Maestro MCP returns CSV — feed it as CSV |
| Running `maestro test` from repo root | PNGs scatter across the repo, `git status` clutters | Use `--test-output-dir=./maestro-output` or `cd .maestro && maestro test` |
| Confusing `takeScreenshot` with `assertScreenshot` baselines | Either committing transient PNGs to git or gitignoring real baselines | `takeScreenshot` outputs are transient (gitignore); `assertScreenshot` baselines are stored in `<flow_dir>/screenshots/` — committed to git in internal mode, backed up separately in external mode |

## CLI Cheat Sheet

> The `.maestro/` paths below show internal-mode examples. In external mode, substitute the resolved `$flow_dir` (e.g., `~/.maestro/projects/<id>/flows/`). See `flow-location-config.md` for resolution.

```bash
# Single flow
maestro test .maestro/auth/LoginSmoke.yaml

# Whole directory
maestro test .maestro/

# Tag filter
maestro test --include-tags smokeTest .maestro/
maestro test --exclude-tags slow .maestro/

# Specific device (multi-device or WiFi ADB host)
maestro --device <ID or IP:PORT> test flow.yaml

# Pin output (CI standard, prevents repo-root pollution)
maestro test --test-output-dir=./maestro-output .maestro/

# Inject env values
maestro test -e BASE_URL=https://stg.example.com flow.yaml
MAESTRO_BASE_URL=... maestro test flow.yaml

# Interactive builder
maestro studio

# Current screen UI hierarchy
maestro hierarchy

# Cloud run
maestro cloud --apiKey <KEY> app.apk .maestro/
```

## Flow YAML Cheat Sheet

```yaml
appId: com.example.app
tags:
  - smokeTest
  - feature:auth
---
- launchApp:
    clearState: true                       # idempotency
    arguments: { isE2E: "true" }           # app reads this and disables animations

- assertVisible: "텍스트"                   # check user-facing text
- assertVisible: { id: "main-root" }       # check by id
- extendedWaitUntil:                       # poll until visible (use after launch)
    visible: "텍스트"
    timeout: 30000

- tapOn: "텍스트"                           # tap by text
- tapOn: { id: "submit-btn" }              # tap by id
- tapOn: { point: "73%, 94%" }             # last resort

- inputText: "값"
- hideKeyboard                             # after inputText, before next tap

- scroll
- scrollUntilVisible: "텍스트"
- swipe: { direction: LEFT, duration: 500 }
- back

- waitForAnimationToEnd
- repeat: { times: 3, commands: [ ... ] }

- runFlow:                                 # reuse a subflow
    file: ../common/Login.yaml
    env:
      USERNAME: ${TEST_USER}
      PASSWORD: ${TEST_PASS}

- takeScreenshot: name                     # transient debug artifact
- assertScreenshot:                        # permanent baseline comparison
    path: ../screenshots/<name>.png
    cropOn: { id: "container" }
    thresholdPercentage: 98

- assertWithAI: "로그인 버튼이 활성화되어 있다"   # natural-language assertion (Maestro 1.x+)

- runScript: helper.js                     # invoke a JS helper
```

## Debug Bundle Layout

When a flow fails, Maestro writes to `~/.maestro/tests/<timestamp>/`:

| File | What it is |
|---|---|
| `screenshot-❌-*.png` | Screen at the moment of failure |
| `maestro.log` | Full UI hierarchy plus command trace — search for the actual on-screen text |
| `commands-*.json` | Sequence of commands the flow executed |

Diagnosis order: screenshot → maestro.log → fix selector → re-run.

## Onboarding Checklist (First-Time Setup)

1. Install Maestro: `brew install maestro` or `curl -Ls "https://get.maestro.mobile.dev" | bash`.
2. (Optional) Install the Maestro Workbench VS Code extension for schema-aware editing.
3. Resolve flow location for this project — run `bash <skill>/scripts/resolve-flow-dir.sh`. On first run, the agent interviews you (internal `.maestro/` vs external `~/.maestro/projects/<id>/flows/` vs custom) and writes `~/.config/maestro/<id>/config.yaml`. See `flow-location-config.md`.
4. Create the directory layout under the resolved `$flow_dir`: `$flow_dir/common/`, `$flow_dir/<feature>/`, `$flow_dir/screenshots/`.
5. Write one tiny flow (`launchApp` + one `assertVisible`) and run it. Expect failure on the first try; let the debug bundle teach you the real screen text.
6. Tighten selectors using ids where possible.
7. Add `tags`, wire a CI step with `--test-output-dir` and `MAESTRO_USING_FLOW_DIR`, set up artifact upload.
8. Once the suite is healthy, consider attaching the Maestro MCP server for selector-discovery acceleration on new screens (see ai-agent-integration.md).

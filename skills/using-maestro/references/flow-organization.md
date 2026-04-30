# Flow Organization — Why, How, Where, Lifecycle

This file covers the full lifecycle of Maestro `flow.yaml` files: why they exist as code, how to organize and version them, where they live, and how to reuse them across scenarios.

## Why Store Flow Files

Flows are **executable specifications of user behavior**. A `flow.yaml` is not throwaway scaffolding — it is the canonical answer to "what should this user journey look like, and how do we prove it still works?" Treat them with the same care as application code:

- **Single source of truth for behavior.** If a button moves or a screen is renamed, the flow that exercises it must be updated. Without versioned flows, regression detection collapses to manual QA.
- **Reproducibility across machines and CI.** A team member running the same `maestro test` against the same build must get the same result. That only holds if the flow is committed and versioned.
- **Review surface.** Flows describe critical user journeys. Pull request review on flow changes catches scope creep ("why did the login flow start clicking the marketing banner?") and unintentional coverage loss.
- **AI agent collaboration.** When an LLM (Maestro MCP, Cursor, Claude Code) generates a flow draft, the human's job is to review and commit. Without a versioned location, the AI-human handoff has no anchor.
- **Compounding value.** Common subflows (login, reset state, deeplink open) get reused. The library only compounds if it is centrally stored.

## How to Store Flow Files

### Treat them like source code

- Write them in a code editor with a Maestro schema-aware extension (Maestro Workbench for VS Code provides validation and autocomplete).
- Lint and format on save where possible (yamllint or prettier with YAML support).
- Open a pull request for every change. Reviewers should ask: "Does this flow still encode a real user journey? Is it deterministic? Does it duplicate an existing subflow?"
- Tag releases the same way you tag the app — commit history is the implicit version log; explicit versioning of flows is rarely useful.

### Idempotent by default

A flow that produces a different result on the second run is broken. Always:

- Start with `launchApp clearState: true` unless you intentionally chain flows.
- Pass test-mode arguments so the app turns off animations, suppresses real network side effects, or activates fixtures (`launchApp arguments: { isE2E: "true" }`).
- Use `extendedWaitUntil` for any state that depends on JS bundle load, network response, or animation completion.
- Extract repeated setup (login, pairing, reset) into `common/` subflows and call via `runFlow`.

### One concern per file

Each flow file should encode one user intent: "user can log in", "user can change sleep clock", "user can complete checkout with credit card". When a flow grows past ~50 lines, split it. When two flows share five or more lines, extract a subflow.

## Where to Store Flow Files

The location is **resolved per-project**, not assumed. See `flow-location-config.md` for the resolver, the `~/.config/maestro/<id>/config.yaml` schema, and the interview that runs on first use. Two layouts exist downstream of that decision:

### Internal mode (Option 1 — committed alongside app code)

```
<project-root>/
  .maestro/                      # = resolved flow_dir (relative)
    config.yaml                  # tags, environment defaults
    common/                      # shared subflows, never run standalone
      Login.yaml
      ResetState.yaml
      OpenDeeplink.yaml
    auth/
      LoginSmoke.yaml
      OnboardingHappyPath.yaml
    checkout/
      CheckoutWithCard.yaml
      CheckoutWithInvalidCard.yaml
    dispense/
      BootMainDashboard.yaml
    sleep/
      SleepEnterDefault.yaml
      SleepClockChange.yaml
    screenshots/                 # assertScreenshot baselines (committed)
      ProductCard.png
```

When to pick: team-shared apps where flows ship with feature PRs, CI runs against the committed YAML, and brand-new flows benefit from PR review.

### External mode (Option 2 — gitignored, worktree-shared)

```
~/.maestro/                      # Maestro CLI also lives here
  projects/                      # ← namespace fence (do not flatten)
    <id>/                        # e.g. mighty-family
      flows/                     # = resolved flow_dir (absolute)
        config.yaml
        common/
          Login.yaml
          ResetState.yaml
        auth/
          LoginSmoke.yaml
        sleep/
          SleepEnterDefault.yaml
        screenshots/             # assertScreenshot baselines (requires separate backup discipline)
          ProductCard.png
  tests/                         # ← Maestro CLI's own debug bundles, untouched
```

When to pick: worktree-heavy individual workflow, experimental flows that should not enter feature branches, multi-app flow reuse.

The internal organization (`common/`, feature dirs, `screenshots/`) is identical in both modes — only the parent path differs.

Key conventions (apply to both):

- **`common/` holds subflows only.** Standalone runs would fail (they assume parent context). Exclude them from default discovery via `config.yaml` `exclude` paths or by tagging with `--exclude-tags`.
- **Feature directories group by user journey, not by screen.** `auth/`, `checkout/`, `dispense/` are user-facing concepts. Avoid `screens/login.yaml` — that bleeds implementation detail into the layout.
- **`screenshots/` holds `assertScreenshot` baselines.** Both modes store baselines in `<flow_dir>/screenshots/`. Internal mode commits them to git; external mode keeps `<flow_dir>/screenshots/` outside the repo and requires separate backup discipline. Transient `takeScreenshot` outputs never belong in either.
- **Versioning**: internal mode versions flows alongside app code on the same branch/PR. External mode versions flows in a separate inner git repo (`cd ~/.maestro/projects/<id>/flows && git init`) or accepts no versioning at all.

## How to Use Flows

### Direct execution

Examples below show internal-mode paths (`.maestro/`). External mode substitutes the absolute path (e.g., `~/.maestro/projects/<id>/flows/`) — the substitution is mechanical, the commands otherwise identical.

```bash
flow_dir=$(bash <skill>/scripts/resolve-flow-dir.sh)

maestro test "$flow_dir/auth/LoginSmoke.yaml"
maestro test "$flow_dir"                              # whole suite
maestro test --include-tags smokeTest "$flow_dir"
```

For local debugging, `cd "$flow_dir"` first so transient screenshot outputs land inside the flow directory rather than the repo root:

```bash
cd "$flow_dir" && maestro test sleep/SleepClockChange.yaml
```

For CI, set `MAESTRO_USING_FLOW_DIR` and pin `--test-output-dir`:

```bash
MAESTRO_USING_FLOW_DIR=.maestro \
  maestro test --test-output-dir=./maestro-output .maestro/
```

### Reuse via runFlow

Subflows make repeated setup writeable once and reused everywhere. The subflow declares parameters via `${VAR}` placeholders; the caller injects values via the `env:` block.

```yaml
# .maestro/common/Login.yaml
appId: com.example.app
---
- launchApp:
    clearState: true
    arguments: { isE2E: "true" }
- inputText: ${EMAIL}
- inputText: ${PASSWORD}
- hideKeyboard
- tapOn: "로그인"
```

```yaml
# .maestro/auth/LoginSmoke.yaml
appId: com.example.app
tags:
  - smokeTest
  - feature:auth
---
- runFlow:
    file: ../common/Login.yaml
    env:
      EMAIL: ${TEST_EMAIL}
      PASSWORD: ${TEST_PASSWORD}
- assertVisible: "메인 화면"
```

### Reuse via tags

Tags are the primary mechanism for filtering which flows run in which environment:

```yaml
tags:
  - smokeTest          # run on every PR
  - regression         # run nightly
  - feature:auth       # filter by feature area
  - backend:prod       # which backend this targets
```

```bash
maestro test --include-tags smokeTest .maestro/    # PR
maestro test .maestro/                              # nightly
maestro test --exclude-tags slow .maestro/          # quick subset
```

### Data-driven repetition

Maestro's built-in `repeat` runs the same env multiple times. To run the same flow with **different data** (e.g. 100 user accounts), drive from the outside:

```bash
while IFS=, read -r email pass; do
  TEST_EMAIL="$email" TEST_PASSWORD="$pass" \
    maestro test .maestro/auth/LoginSmoke.yaml || exit 1
done < users.csv
```

Or in GitHub Actions:

```yaml
strategy:
  matrix:
    user:
      - { email: a@example.com, pass: ... }
      - { email: b@example.com, pass: ... }
steps:
  - run: |
      TEST_EMAIL=${{ matrix.user.email }} TEST_PASSWORD=${{ matrix.user.pass }} \
        maestro test .maestro/auth/LoginSmoke.yaml
```

The flow itself stays idempotent (it always starts with `clearState: true`); the matrix injects data variation.

### Lifecycle and maintenance

- When a screen changes, update the flow in the same PR as the application change. Reviewers should reject application changes that break flows without a corresponding flow update.
- When a flow becomes flaky, do not delete or `--retry` it indefinitely. Investigate: is the selector brittle? Is the wait too short? Is the app truly racy? Fix the root cause.
- When you write a new flow that duplicates setup, extract a subflow into `common/` before merging.
- Periodically prune flows that no longer encode value (covered by other flows, deprecated feature). Dead flows hide regressions.

## When to Branch From This Layout

The layout above is the default. Deviate only with explicit reason:

- **Mono-repo with multiple apps:** register each app as its own project ID (separate `~/.config/maestro/<id>/config.yaml` entries), with each `flow_dir` pointing at the app's subdirectory in internal mode, or at distinct `~/.maestro/projects/<id>/flows/` paths in external mode.
- **Cross-platform shared flows:** if iOS and Android share most flows, structure inside `flow_dir` as `shared/` plus `ios-only/` and `android-only/`. Tag flows with `platform:ios` / `platform:android` to support `--include-tags`.
- **Massively long suite (200+ flows):** introduce a second axis like priority (`p0/`, `p1/`) inside each feature directory. Avoid this until the suite genuinely needs it.

For everything else, follow the standard layout.

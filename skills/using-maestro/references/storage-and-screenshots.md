# Storage and Screenshots

Maestro produces three classes of artifacts: **flow files** (committed), **assertion baselines** (committed), and **transient outputs** (gitignored or deleted). Mixing them up is the single most common mistake during initial setup. This reference establishes the policy and the commands that enforce it.

## The Two Kinds of PNG

Maestro produces PNG files in two completely different roles. The naming overlap (`*.png`) hides the distinction; the storage policy must respect it.

| Kind | Command | Relationship to YAML | Lifetime | Storage Policy |
|---|---|---|---|---|
| **Transient screenshot** | `- takeScreenshot: name` | Independent — generated fresh on every run | Ephemeral | **Gitignored or deleted.** Never commit. |
| **Assertion baseline** | `- assertScreenshot: { path: X.png, ... }` | Coupled — the YAML references this exact PNG | Permanent | Both modes: stored in `<flow_dir>/screenshots/`. Internal mode: **committed to git**. External mode: kept outside the repo (under `~/.maestro/projects/<id>/flows/screenshots/`) and requires its own backup discipline. |

Treat them as two different file types that happen to share an extension.

### Transient screenshots (`takeScreenshot`)

Generated for debugging, demo recordings, and run reports. They have no dependency from the flow file — re-running the flow creates a new PNG and the previous one becomes stale. Never commit these to the application repository.

### Assertion baselines (`assertScreenshot`)

Generated once (typically by running the flow against a known-good build) and then locked in as the contract. The flow YAML references the file by path; subsequent runs compare the live screenshot against this baseline.

```yaml
- assertScreenshot:
    path: ../screenshots/ProductCard.png
    cropOn:
      id: ProductCardContainer
    thresholdPercentage: 98
```

`path:` is resolved relative to the directory containing the flow file. So from `<flow_dir>/<feature>/<flow>.yaml`, use `../screenshots/<name>.png` to reference the policy directory at `<flow_dir>/screenshots/`. (For deeper nesting like `<flow_dir>/<feature>/<sub>/<flow>.yaml`, adjust the relative path accordingly — `../../screenshots/<name>.png`.)

`cropOn` is essential. It restricts the comparison to a stable element, so dynamic content (clock, weather, status bar) does not produce false negatives. Tune `thresholdPercentage` per element if anti-aliasing differences cause flicker.

Maestro's built-in `assertScreenshot` (CLI v2.2.0+) is sufficient for most needs. External tools like Percy or Applitools add cloud diff dashboards and approval workflows but require manual wiring; reach for them only when the built-in proves insufficient.

## Where Maestro Writes Output

`maestro test` writes its main test artifacts (failure screenshots, recording, log, command trace) to an **OS-specific default folder** (typically under `~/.maestro/tests/<timestamp>/` on macOS) unless overridden by `--test-output-dir` or `testOutputDir` in `config.yaml`. `takeScreenshot` calls without an explicit path land in a `.maestro/` folder inside the workspace by default — running `maestro test` from a directory without writing access (or in CI where the artifact location must be predictable) is the trigger to pin `--test-output-dir`.

Pin `--test-output-dir` for predictable artifact location:

```bash
# Pin the output directory (preferred for CI and local runs)
maestro test --test-output-dir=./maestro-output .maestro/
```

This puts everything in one place that `actions/upload-artifact` can grab, and you `gitignore` that path. For local runs without `--test-output-dir`, transient outputs go under the workspace `.maestro/` folder by default — review them with `git status` and add the relevant patterns to `.gitignore` (see below) before committing.

## Recommended `.gitignore` Entries

**Internal mode** (project hosts `.maestro/`):

```
# Maestro transient outputs
maestro-output/
.maestro/**/*.png
!.maestro/screenshots/**/*.png   # explicitly include assertion baselines
```

The negation pattern keeps the assertion baselines tracked while ignoring everything else.

**External mode** (project does not host flows):

```
# Maestro transient outputs only
maestro-output/
```

In external mode, flows and baselines live under `~/.maestro/projects/<id>/` — outside the repo, no `.gitignore` entry needed for them. Only the per-cwd `maestro-output/` from `--test-output-dir` falls inside the repo and must be ignored.

## Failure Artifacts (`~/.maestro/tests/<timestamp>/`)

When a flow fails, Maestro writes a debug bundle to `~/.maestro/tests/<timestamp>/`:

| File | Use |
|---|---|
| `screenshot-❌-*.png` | The screen at the moment of failure. Visual inspection first. |
| `maestro.log` | Full UI hierarchy dump and command trace. Search this for the actual text on screen. |
| `commands-*.json` | Sequence of commands the flow executed before failing. |

These bundles are local-only and not part of any policy beyond your own disk hygiene. Delete old bundles when storage gets tight.

## Visual Regression Strategy

If you adopt `assertScreenshot`, decide three things up front:

1. **Reference device.** Pick one device (or one emulator profile) as the canonical resolution. Generate baselines on that device. Run regression checks on that same device. Cross-device baselines are not supported and lead to flake.
2. **Crop discipline.** Always wrap a meaningful UI element with `cropOn`. Never compare the full screen unless the entire layout is stable.
3. **Threshold per element.** `thresholdPercentage` defaults to 95% (pixel match). Bump to 98–99% for elements that should be near-pixel-perfect (logos, design system primitives). Drop to 90% for elements with subtle anti-aliasing that doesn't matter (large blocks of color).

Avoid Percy/Applitools until you have a concrete reason. The built-in `assertScreenshot` covers the common case; external tools add review dashboards and approval workflows but require ongoing maintenance.

## CI Output Layout

A clean GitHub Actions setup:

```yaml
- name: Run Maestro
  env:
    MAESTRO_USING_FLOW_DIR: .maestro
  run: maestro test --test-output-dir=./maestro-output "$MAESTRO_USING_FLOW_DIR"

- name: Upload Maestro artifacts
  if: always()
  uses: actions/upload-artifact@v4
  with:
    name: maestro-results
    path: ./maestro-output
```

`if: always()` is critical — failed runs are when you most need the artifacts. Without it, the upload step is skipped on failure.

## Common Storage Mistakes

| Mistake | Symptom | Fix |
|---|---|---|
| Running `maestro test` from repo root | Repo pollutes with PNGs every run | Use `--test-output-dir` or `cd .maestro` |
| Committing transient screenshots to git | Repository fills with rotating PNGs | Add to `.gitignore`, delete the existing ones |
| Gitignoring assertion baselines | Visual regression silently disabled | Use negation in `.gitignore` to keep `screenshots/` tracked |
| Baseline taken on developer's device, regression checked on CI device | Every run "fails" with pixel diff | Pin one reference device for both baseline capture and regression runs |
| Forgetting `cropOn` | Dynamic content (clock, weather) fails the diff | Always crop to a stable element |

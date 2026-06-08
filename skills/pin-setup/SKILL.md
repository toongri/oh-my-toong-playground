---
name: pin-setup
description: Use when initializing the pins knowledge graph for the first time in a project. Guides the user through creating pins.yaml (the storage manifest). Triggers on "setup pins", "initialize pins", "create pins.yaml", "first-run pins".
---

# pin-setup

First-run interview to create `~/.pins/{name}/pins.yaml`, the storage manifest for the pins knowledge graph.

## What is pins.yaml

`pins.yaml` is the manifest that tells the pins API where to read and write pin files. It declares the storage location and scope for this project's knowledge graph.

`resolveManifest()` (from `lib/pins/manifest.ts`) reads `pins.yaml` and returns the parsed manifest. Callers then extract `manifest.location` and pass it explicitly to each API (`record`, `query`, `audit`, etc.). The manifest itself is advisory metadata — individual API calls always receive `location` as an explicit argument, not by re-reading the file.

## Interview

Walk the user through three decisions:

### 1. Storage location

The manifest is always written to `~/.pins/{name}/pins.yaml`, where `{name}` is derived from the project name of the cwd (`deriveProjectName(cwd)`). This path is fixed.

Ask: "Where should pin *data files* live?"

Common choices:
- Co-located with the manifest (default) — `~/.pins/{name}/` — no `--location` needed
- A custom absolute path — pass via `--location`; useful for monorepos or multi-project setups

Confirm whether the directory should be created if it does not exist (it will be, automatically, on the first `record()` call).

### 2. Scope

Ask: "What is the scope of this pins manifest — personal (private) or project-wide (shared)?"

- `private` — pins default to `sensitivity: private`; not intended for team consumption
- `shared` — pins default to `sensitivity: shared`; meant to be read by teammates

The scope sets the manifest-level default; individual pins can override `sensitivity` in their frontmatter.

### 3. Git management

Ask: "Is this pins corpus managed under git?"

This is independent of storage location: a `~/.omt/...` directory can be a git repo; a `.pins/` directory inside a project repo can be gitignored. The answer reflects intent, not directory placement. When `git: true`, the SessionStart hook and the `pin-record`/`pin-wrap-up` skills will prompt the AI to commit pin file changes after recording.

Record the answer as `git: true` or `git: false`.

## Output

Once all three questions are answered, write `pins.yaml` to `~/.pins/{name}/pins.yaml`:

```yaml
# pins.yaml — knowledge graph storage manifest
location: <resolved absolute path>
scope: <private|shared>
git: <true|false>
```

Confirm the path is correct and the user understands that all pins API calls will resolve against this manifest.

## Migration

If the project has legacy pin files (frontmatter with `slug` instead of `id`, no `type` field), run migration after setup:

```bash
bun "${CLAUDE_SKILL_DIR}/scripts/setup.ts" --scope "$SCOPE" [--location "$LOC"] [--git true|false]
```

`--location` is optional. When omitted, pin data is co-located with the manifest at `~/.pins/{name}/`. The script writes `pins.yaml` to `~/.pins/{name}/pins.yaml` and then runs `migrate()` against the just-written location. `migrate()` is idempotent — re-running it is safe. Each legacy file gets a `.bak` sibling before conversion.

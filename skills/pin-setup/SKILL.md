---
name: pin-setup
description: Use when initializing the pins knowledge graph for the first time in a project. Guides the user through creating pins.yaml (the storage manifest). Triggers on "setup pins", "initialize pins", "create pins.yaml", "first-run pins".
---

# pin-setup

First-run interview to create `pins.yaml`, the storage manifest for the pins knowledge graph.

## What is pins.yaml

`pins.yaml` is the manifest that tells the pins API where to read and write pin files. It declares the storage location and scope for this project's knowledge graph. All lib/pins APIs (`record`, `migrate`, `query`, etc.) resolve their `location` parameter from this manifest.

## Interview

Walk the user through two decisions:

### 1. Storage location

Ask: "Where should pin files live?"

Common choices:
- `~/.omt/<project>/pins/` — user-local, not checked into the repo (default for private or personal knowledge)
- `.pins/` inside the repo — team-shared, checked in (good for project-wide shared knowledge)
- A custom absolute path — for monorepos or multi-project setups

Confirm whether the directory should be created if it does not exist (it will be, automatically, on the first `record()` call).

### 2. Scope

Ask: "What is the scope of this pins manifest — personal (private) or project-wide (shared)?"

- `private` — pins default to `sensitivity: private`; not intended for team consumption
- `shared` — pins default to `sensitivity: shared`; meant to be read by teammates

The scope sets the manifest-level default; individual pins can override `sensitivity` in their frontmatter.

## Output

Once both questions are answered, write `pins.yaml` at the project root (or the location the user specifies):

```yaml
# pins.yaml — knowledge graph storage manifest
location: <resolved absolute path>
scope: <private|shared>
```

Confirm the path is correct and the user understands that all pins API calls will resolve against this manifest.

## Migration

If the project has legacy pin files (frontmatter with `slug` instead of `id`, no `type` field), run migration after setup:

```ts
import { migrate } from 'lib/pins/migrate.ts';

await migrate({ location });
```

`migrate()` is idempotent — re-running it is safe. Each legacy file gets a `.bak` sibling before conversion.

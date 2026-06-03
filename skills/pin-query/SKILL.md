---
name: pin-query
description: Use when looking up pins by type, tags, or source. Drives lib/pins/query.ts to retrieve matching pin entries from the knowledge graph. Supersedes the legacy manual ls+frontmatter procedure.
---

# pin-query

Retrieve pins from the knowledge graph by calling `query(pinsDir, criteria)` from `lib/pins/query.ts`.

## Retrieval model

`query` calls `buildIndex()` on every invocation, scanning `pinsDir` in-memory. There is no `index.json` cache; every call performs a full directory scan and produces results directly.

The full entity set is always covered, including pins with no outgoing relations. Orphan pins remain findable by `type`, `tags`, or `source` — relation traversal is not required.

## Invocation

Resolve `pinsDir` from the manifest before calling `query`:

```ts
import { resolveManifest } from "lib/pins/manifest.ts";
import { query } from "lib/pins/query.ts";

const result = await resolveManifest();
if (result.kind === 'absent') { /* handle missing manifest */ }
const pinsDir = result.manifest.location;

const results = query(pinsDir, { type: 'code', tags: ['auth'] });
// returns QueryResult[]  — each: { id: string, frontmatter: Frontmatter }
```

`pinsDir` is `manifest.location` as resolved by `resolveManifest()` (from `lib/pins/manifest.ts`). Omit any criterion to leave that field unrestricted.

## Presenting results

Return matched slugs (`id`), `source_url` from the frontmatter, and a one-line summary to the caller. Report "no match" on an empty result set. Do not re-traverse the graph; the returned `Frontmatter` already carries `relations` if the caller needs to follow links.

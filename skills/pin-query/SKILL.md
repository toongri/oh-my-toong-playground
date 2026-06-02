---
name: pin-query
description: Use when looking up pins by type, tags, or source. Drives lib/pins/query.ts to retrieve matching pin entries from the knowledge graph. Supersedes the manual ls+frontmatter procedure in select-pin.
---

# pin-query

Retrieve pins from the knowledge graph by calling `query(pinsDir, criteria)` from `lib/pins/query.ts`.

## Retrieval model

`query` is index-first with a dir-scan fallback:

1. **Index path**: reads `$OMT_DIR/pins/index.json` when present. Fast; no filesystem traversal.
2. **Fallback path**: if `index.json` is absent or unreadable, calls `buildIndex()` in-memory over the raw pin files. Produces an identical result set.

Both paths cover the full entity set, including pins with no outgoing relations. Orphan pins remain findable by `type`, `tags`, or `source` — relation traversal is not required.

## Invocation

```ts
import { query } from "lib/pins/query.ts";

const results = query(pinsDir, {
  type?: EntityType,      // exact match on frontmatter.type
  tags?: string[],        // ALL listed tags must be present (intersection, not union)
  source?: PinSource,     // exact match on frontmatter.source
});
// returns QueryResult[]  — each: { id: string, frontmatter: Frontmatter }
```

`pinsDir` is `$OMT_DIR/pins/`. Omit any criterion to leave that field unrestricted.

## Presenting results

Return matched slugs (`id`), `source_url` from the frontmatter, and a one-line summary to the caller. Report "no match" on an empty result set. Do not re-traverse the graph; the returned `Frontmatter` already carries `relations` if the caller needs to follow links.

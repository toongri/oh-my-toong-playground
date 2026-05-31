---
name: record
description: Use when you need to record a single pin entity to the knowledge graph. Invokes lib/pins record() to validate and write a canonical .md file. Triggers on "record pin", "pin this", "save this as a pin".
---

# record

Record a single canonical entity to the pins knowledge graph via `lib/pins/record.ts`.

## API

```ts
import { record } from 'lib/pins/record.ts';

await record(entity, { location });
```

- `entity` — an `Entity` object with `frontmatter` + `body` (see `lib/pins/types.ts`)
- `location` — the manifest-resolved pins directory (from `pins.yaml`)

`record()` validates first. If invalid, the entity is appended to `<location>/.escape.jsonl` and no `.md` file is written. If valid:
- Fresh write: sets `status='active'`, `updated_at=created_at` if not provided.
- Update (id already exists on disk): preserves the original `created_at`, bumps `updated_at`.
- Writes atomically to `<location>/<id>.md`.

## Recording rubric — what is worth pinning

Apply the pins philosophy axioms before recording:

**indexing-not-wiki**: A pin points at a source; it does not reproduce or paraphrase it. The body is a signpost, not a copy of the SSOT.

**ssot-no-copy**: If the information lives in a document, codebase, or external system, do NOT copy its content into the pin. Record where to find it and how to reach it.

**5 elements**: Every entity body must supply exactly the four sections below. A body that omits sections or overflows into wiki-style prose means the wrong SSOT is being cited.

**long-body-means-wrong-ssot**: If you find yourself writing more than 3–4 lines per section, stop. Find the real SSOT and point at it instead.

## Body sections

The body of every pin consists of exactly four `##` headers, in this order:

| Header | Purpose |
|--------|---------|
| `## 한 줄 요지` | One-line summary of the entity (≤80 chars). |
| `## SSOT 위치` | The canonical location — URL, file path, or `person:name`. |
| `## 전후 컨텍스트` | Which workflow or task surfaced this (Memex trail). |
| `## 관련 cross-link` | Related pin IDs and reason for the relation; `없음` if none. |

These headers are the canonical body structure defined in `tbox.yaml` (`body_sections`); the serializer emits `entity.body` verbatim. Runtime validation (`validate()` / `record()`) inspects frontmatter only — a malformed body does not trigger `.escape.jsonl`. Header conformance is enforced by the schema/coupling contract (`lib/pins/coupling.test.ts`), not at write time.

## Frontmatter fields

Key fields (see `lib/pins/types.ts` for the full `Frontmatter` type):

| Field | Required | Notes |
|-------|----------|-------|
| `id` | yes | `{type}-{topic}-{slug}` kebab pattern |
| `type` | yes | entity type (`code`, `doc`, `concept`, `reference`, `person`, `decision`) |
| `source` | yes | origin system (`jira`, `linear`, `slack`, `github`, `notion`, `code`, `person`, `url`) |
| `tier` | yes | importance: `1` (core), `2` (reference), `3` (transient) |
| `sensitivity` | yes | `private` or `shared` |
| `status` | defaults to `active` | lifecycle state — see below |
| `created_at` | yes | ISO 8601 timestamp |
| `updated_at` | defaults to `created_at` | ISO 8601 timestamp |
| `relations` | defaults to `[]` | array of `{target, type}` objects |

## Status lifecycle

The `status` field is a closed enum:

- `active` — current and valid; default on fresh record.
- `superseded` — replaced by a newer entity; the old entity is preserved but marked obsolete via `lib/pins/lifecycle.ts#supersede()`.
- `stale` — no longer verified; flagged during periodic review without a clear successor.

To transition status programmatically, use `lib/pins/lifecycle.ts`:
- `supersede(oldId, newId, dir)` — marks old entity `superseded` and adds a `superseded_by` relation.
- `hardDelete(id, dir, { force: true })` — permanently removes a pin file (requires explicit `force`).

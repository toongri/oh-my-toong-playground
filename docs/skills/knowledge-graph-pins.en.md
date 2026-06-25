English | [한국어](knowledge-graph-pins.md)

---

# Pins — Shared Knowledge-Graph Layer

> oh-my-toong's knowledge layer. Records discovered facts as permanent entities during a session; surfaces them instantly in the next.

---

## Overview

Useful facts discovered while navigating a codebase or making decisions exist only inside the session context — then vanish. "Where was the canonical doc for this API?" or "Who was the authority on this domain?" becomes a question you solve from scratch in the next session.

Pins is a **shared infrastructure skill family** that solves this. Record an entity the moment you discover it (`pin-record`), review the whole session at the end and retain only what matters (`pin-wrap-up`), retrieve it in future sessions (`pin-query`), and periodically check the graph for structural health (`pin-audit`). First-time project initialization is handled by `pin-setup`.

The five skills each operate independently, but together they form a single knowledge-graph lifecycle.

---

## What the Knowledge Graph Is

The pins knowledge graph is an **LLM-wiki-style index**. It does not copy or paraphrase information. Instead, it stores two things:

- **Entities**: signed records of single facts — a code location, external document, decision, person, or concept
- **Relations**: directed connections between entities (`{target, type}` pairs)

Each entity is stored as a standalone markdown file `<id>.md`. The entity body is a **signpost**, not a reproduction of the source — it says where the original lives and why it was recorded.

### Design Philosophy

| Principle | Meaning |
|-----------|---------|
| **Indexing, not wiki** | A pin points at a source; it never copies it |
| **No SSOT duplication** | If information lives in a document, codebase, or external system, do not paste it into the pin |
| **Concise body** | More than 3–4 lines per section is a signal that you are citing the wrong SSOT |
| **Quality over quantity** | Two high-quality pins beat ten noisy ones |

---

## Storage Structure

### pins.yaml — Storage Manifest

`pins.yaml` at the project root declares the location and scope of the knowledge graph.

```yaml
# pins.yaml — knowledge graph storage manifest
location: ~/.omt/<project>/pins/   # absolute path to store pin files
scope: private                     # private | shared
git: true                          # whether pin files are git-managed
```

- `location`: the directory where pin `.md` files are physically written
- `scope`: manifest-level default; individual pins can override via the `sensitivity` field
- `git: true` causes `pin-record` and `pin-wrap-up` to prompt a commit after writing

All pins API calls (`record`, `query`, `audit`, etc.) do not re-read `pins.yaml` on each call. They receive `manifest.location` resolved once by `resolveManifest()`.

### Entity Files — `<id>.md`

Each entity is a markdown file with a YAML frontmatter block followed by exactly four body sections.

**Key frontmatter fields**

| Field | Role |
|-------|------|
| `id` | `{type}-{topic}-{slug}` kebab pattern — immutable identifier |
| `type` | Entity kind: `code`, `doc`, `concept`, `reference`, `person`, `decision` |
| `source` | Origin system: `jira`, `linear`, `slack`, `github`, `notion`, `code`, `person`, `url` |
| `authority` | The person or system that is the ground-truth owner of this information |
| `source_url` | Canonical location — URL or file path |
| `tier` | Importance: `1` (core), `2` (reference), `3` (transient) |
| `tags` | CSV scalar (e.g. `"auth,backend,api"`) |
| `sensitivity` | `private` or `shared` |
| `status` | Lifecycle state: `active`, `superseded`, `stale` |
| `relations` | `[{target, type}]` array — defaults to `[]` |
| `checked_at` | Staleness-detection timestamp for the `reference` type |

**Body structure (4 sections, fixed order)**

```markdown
## 한 줄 요지
(One-line summary, ≤80 chars)

## SSOT 위치
(URL, file path, or person:name)

## 전후 컨텍스트
(Which workflow or task surfaced this fact)

## 관련 cross-link
(Related pin IDs and reason; "없음" if none)
```

---

## Lifecycle Flow

```
[First run]      pin-setup    →  Create pins.yaml
[During work]    pin-record   →  Record a single entity on discovery
[End of session] pin-wrap-up  →  Whole-session review; record only what matters
[Lookup]         pin-query    →  Search by type / tags / source
[Health check]   pin-audit    →  Detect dangling relations, duplicates, stale entries
```

The SessionStart hook surfaces existing pins at the start of each session, carrying forward knowledge captured in prior sessions.

---

## Skill Reference

### pin-setup — Initialization

**When**: The first time you use pins in a project.

Runs a three-question interview to create `pins.yaml`.

1. **Storage location**: `~/.omt/<project>/pins/` (home directory), `.pins/` (inside the repo), or a custom absolute path
2. **Scope**: `private` (personal only) or `shared` (team-readable)
3. **Git management**: independent of storage location. `git: true` enables commit prompts after each write

If legacy pin files exist (`slug` field, no `type`), `migrate()` is run after setup. The operation is idempotent — safe to re-run.

---

### pin-record — Record a Single Entity

**When**: You discover a fact worth keeping in the knowledge graph during active work.

Calls `record(entity, { location })` from `lib/pins/record.ts`. The entity is validated before any file is written.

**What is worth pinning**

| Worth pinning | Not worth pinning |
|---------------|-------------------|
| External SSOT located (URL, file, person) | Transient debug output |
| Ground truth confirmed in code (file:line) | Facts obvious from reading the code |
| A decision that constrains future work | An intermediate hypothesis that was disproved |
| A person named as authority on a topic | Information that will be stale within hours |

**Write behavior**

- Validation failure: entity appended to `.escape.jsonl`, no `.md` written
- Fresh write: atomic create via `O_EXCL` (`wx` flag), `status='active'`
- Update (ID already on disk): atomic replace via temp file + `rename`. Original `created_at` is preserved from disk. `updated_at` is NOT auto-bumped — the caller must supply a new value, otherwise it remains at `created_at`
- `git: true`: stage and commit the file after recording

**Status lifecycle**

The `status` field is a closed enum:

- `active`: current and valid; default on fresh record
- `superseded`: replaced by a newer entity; transitioned via `lib/pins/lifecycle.ts#supersede(oldId, newId, dir)`
- `stale`: period-exceeded without a clear successor; detected by `audit`

---

### pin-query — Retrieval

**When**: You need to find existing pins by type, tags, or source.

Calls `query(pinsDir, criteria)` from `lib/pins/query.ts`. There is no index cache — every call performs a full directory scan in memory. Orphan pins (no outgoing relations) are included in results.

```ts
const results = query(pinsDir, { type: 'code', tags: ['auth'] });
// QueryResult[]: { id, frontmatter }
```

Omitting a criterion leaves that field unrestricted. Results return `id`, `source_url`, and a one-line summary. An empty result set is reported as "no match".

---

### pin-audit — Graph Health Check

**When**: Periodically verifying that the graph is internally consistent.

Calls `audit(location, { now: new Date() })` from `lib/pins/audit.ts`. **Read-only** — no files are written or modified.

**Detectors (priority order)**

| Rank | Type | Severity | What it means |
|------|------|----------|---------------|
| 1 | `dangling` | error | A relation's `target` ID is absent from the graph — structural defect, fix first |
| 2 | `duplicate` | error | Two entities share the same `source_url` |
| 3 | `invalid` | error | Entity fails schema validation (`validate()`) |
| 4 | `stale` | error | Tier threshold exceeded: tier1=180d, tier2=90d, tier3=30d. `reference` type uses `checked_at` (falls back to `created_at` when absent) |
| 5 | `orphan` | warning | No outgoing relations — soft signal only, never a violation |

Omitting `{ now }` disables stale detection entirely. Always pass `{ now: new Date() }` when staleness checks are needed.

Reporting order: errors first (in the ranked order above), orphan warnings last. An empty `findings` array is reported as "audit clean".

---

### pin-wrap-up — End-of-Session Review

**When**: A work session is winding down, before context is lost.

This is a **deliberate, manual sweep** — not automatic. It reviews the whole session and records only what is genuinely worth keeping.

**4-step process**

1. **Sweep**: Scan back over every discovery, decision, external reference, code location, named person, and architectural fact from the session. Gate: "Would a future me — or a colleague — benefit from finding this in 10 seconds?"
2. **Collect candidates**: Draft a list of proposed entities with a one-sentence rationale each. Show to the user for confirmation or pruning before writing anything
3. **Validate, then record**: Run `validate()` on each confirmed candidate. On failure, report the reason and do not call `record()`. On pass, write via `record()`
4. **Report**: State how many entities were recorded, their IDs and one-line summaries, and any that failed validation with the reason. If `git: true`, commit the written files

---

## On-Discovery Capture Flow

The recommended operating pattern has three phases:

```
Session start  →  SessionStart hook surfaces existing pins
During work    →  pin-record: capture a single entity on discovery
Session end    →  pin-wrap-up: whole-session review, record refined entities
```

**In-session pin-record** and **end-of-session pin-wrap-up** are complementary. Recording at discovery preserves accurate context (`전후 컨텍스트` section); the end-of-session review acts as a quality filter, pruning low-value candidates before they accumulate.

---

## See Also

- [README](../../README.en.md) — full project overview
- [Core Pipeline Skills](./core-pipeline.en.md) — prometheus / sisyphus / argus
- [Review Quality Skills](./review-quality.en.md) — code-review / design-review
- [Authoring Skills](./authoring.en.md) — technical-writing / humanizer
- [Personal Utility Skills](./utilities-personal.en.md) — hud / mock-interview

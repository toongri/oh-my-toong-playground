---
name: write-pin
description: "Use when you've acquired info worth finding again later — external SSOT cited (URL/Notion/Linear/GitHub/Slack), ground truth located in code, person named as authority, or stale indexing needs supersedes. Also use when learning the <pin> XML emission format. Do NOT trigger on pin retrieval tasks (use select-pin instead)."
---

# write-pin

Emit a `<pin>` XML block on discovery. The Stop hook (`hooks/pin-up/`) serializes each pin to `$OMT_DIR/pins/{slug}.md`.

## `<pin>` XML format

```xml
<pin slug="kind-topic-slug"
     source_url="https://example.com/or/person:name"
     authority="who or what is ground truth"
     tier="1"
     tags="tag1,tag2"
     sensitivity="private"
     related="slug1,slug2"
     supersedes="old-slug"
     discovery_context="which task surfaced this — one line">
### ① 한 줄 요지
X is Y. (≤80 characters)

### ② SSOT 위치 + 도달 경로
Where source_url points + how to reach it.

### ③ 전후 컨텍스트
Which workflow surfaced this (Memex trail).

### ④ 관련 cross-link
- → slug1: reason for relation
</pin>
```

> **Validator-coupled tokens**: the four `### ` headers (`① 한 줄 요지`, `② SSOT 위치`, `③ 전후 컨텍스트`, `④ 관련 cross-link`) are matched literally by `hooks/pin-up/validator.ts`. Do not translate them. If any is missing, the pin is escaped to `.escape.jsonl`.

## Required attributes

| Attribute | Description |
|---|---|
| `slug` | Unique identifier obeying the slug rules below. |
| `source_url` | SSOT location: URL or `person:name`. |
| `authority` | Ground-truth subject (person, system, team). |
| `tier` | Importance: 1=core, 2=reference, 3=transient. |
| `tags` | Comma-separated topic tags. |
| `sensitivity` | `private` or `shared`. |

Optional: `related` (cross-link slugs), `supersedes` (slug being replaced), `discovery_context` (one-line Memex note).

## Slug rules

Format: `{kind}-{topic}-{slug-part}`.

- `kind` ∈ `{jira, linear, slack, github, notion, code, person, decision, finding, gotcha, unknown}`
- `topic` = single lowercase domain noun (`auth`, `billing`, `deploy`)
- `slug-part` = 2–4 lowercase kebab-case nouns
- No verbs, adjectives, time qualifiers, or URL-dependent identifiers
- The slug must remain meaningful even if `source_url` changes

Regex (auto-checked by validator): `^[a-z0-9]+(-[a-z0-9]+){2,}(-\d{6})?$`

The `-HHMMSS` suffix is appended automatically on collision — do not write it manually.

Examples:
- ✅ `code-auth-jwt-verify` — kind=code, topic=auth, source-independent
- ✅ `decision-billing-plan-limit` — records a decision
- ❌ `how-to-fix-auth-bug` — verbs/adjectives
- ❌ `current-deploy-setting` — time qualifier

## Emit-deferral block

| Rationalization | Reality |
|---|---|
| "It might change, so I'll wait" | URLs are immutable; `supersedes` absorbs change. Emit now. |
| "It's just a local .md, I'll pin `file://`" | Non-dereferenceable. Apply Scenario F: register externally first. |
| "I'll pin it after this task is done" | Task completion ≠ discovery event. Emit now. |
| "The pin body needs more than the SSOT" | A pin is not a wiki (`indexing-not-wiki`). |

## References

- SSOT-kind specific examples → [reference/examples-by-ssot-kind.md](reference/examples-by-ssot-kind.md)
- 6 use-case scenarios (A–F) → [reference/use-cases.md](reference/use-cases.md)

## Validation

Pins failing schema or slug rules are routed to `.escape.jsonl` by `hooks/pin-up/validator.ts` — no file is created. v1 best-effort: `tier` enum is not validator-enforced.

---
name: write-pin
description: "Use when emitting a new pin, updating a stale pin, or superseding existing indexing — triggers include 박기, 발견, write pin, supersedes, pin 갱신, 새 pin, 잘못된 indexing 수정. Also use when learning the pin XML emission format before emitting. Do NOT trigger on pin retrieval tasks (use select-pin instead)."
---

# write-pin

The skill the AI invokes to learn the `<pin>` XML format and emit a pin on a discovery (or update) event.
The Stop hook (`hooks/pin-up/`) post-processes the response transcript and serializes each emit to `$OMT_DIR/pins/{slug}.md`.

## Identity propositions (SSOT vs wiki)

A pin is indexing, not a wiki. The four axioms below are the system's core constraints.

| Slug | Proposition |
|---|---|
| `indexing-not-wiki` | A pin is a pointer to the SSOT, not the SSOT itself. The original lives in another system (code / PR / Slack / Notion / a person). |
| `ssot-no-copy` | Do not copy the SSOT body into the pin body. The URL plus a one-line summary plus surrounding context is sufficient. |
| `5-elements-only` | A pin contains: ① location (`source_url`) ② authority ③ one-line summary ④ surrounding context ⑤ cross-link. Nothing else. |
| `long-body-wrong-ssot` | A long body means you're storing the SSOT inside the pin instead of in its proper system — a misuse. If the body exceeds 4 sections, stop and reconsider. |

## `<pin>` XML format (frozen at v1)

When a discovery event occurs in the AI response, emit a `<pin>` XML block in the response body using the format below.

```xml
<pin slug="EXAMPLE-kind-topic-slug"
     source_url="https://example.com/or/person:name"
     authority="who or what is the ground truth"
     tier="1"
     tags="tag1,tag2"
     sensitivity="private"
     related="slug1,slug2"
     supersedes="old-slug"
     discovery_context="which task surfaced this — one line">
### ① 한 줄 요지
X is Y. (≤80 characters)

### ② SSOT 위치 + 도달 경로
Description of source_url + how to reach it, one line.

### ③ 전후 컨텍스트
Which workflow surfaced the need for this information (Memex associative trail).

### ④ 관련 cross-link
- → slug1: reason for relation
</pin>
```

> **Validator-coupled tokens — do not translate**: the four `### ` body section headers (`① 한 줄 요지` / `② SSOT 위치` / `③ 전후 컨텍스트` / `④ 관련 cross-link`) are validator tokens. `hooks/pin-up/validator.ts` greps for these literal substrings and escapes the pin if any are missing. Keep them exactly as shown — translate only the body content under each header.

### Required attributes (6)

| Attribute | Description |
|---|---|
| `slug` | Unique identifier. Must obey the Slug 8 principles below. |
| `source_url` | SSOT location. URL or `person:name` free-form identifier. |
| `authority` | Ground-truth subject (person name, system name, team name, etc.). |
| `tier` | Importance tier (1=core, 2=reference, 3=transient). |
| `tags` | Comma-separated topic tags. |
| `sensitivity` | `private` or `shared` (v1: defined only; routing logic is v2). |

### Optional attributes (3)

| Attribute | Description |
|---|---|
| `related` | Comma-separated list of related pin slugs. |
| `supersedes` | The existing slug this pin replaces. Use when correcting bad indexing. |
| `discovery_context` | One-line note about how this was discovered (Memex trail). |

> **Note**: `created_at` is not an XML attribute — it is recorded in the frontmatter (set automatically by the Stop hook).
> The `source_kind` enum is deprecated — `source_url` alone conveys location.

## Frontmatter schema (frozen at v1)

The Stop hook extracts the `<pin>` XML and serializes it to the frontmatter + markdown body below.

| Field | Required | Description |
|---|---|---|
| `slug` | Y | Unique identifier |
| `source_url` | Y | URL or `person:name` |
| `authority` | Y | Ground-truth subject |
| `tier` | Y | Importance tier (1/2/3) |
| `tags` | Y | Comma-separated topic tag string (quoted CSV) |
| `sensitivity` | Y | `private` / `shared` |
| `created_at` | Y | ISO8601 (set by the Stop hook) |
| `related` | N | Cross-link slug array |
| `supersedes` | N | Slug being replaced |
| `discovery_context` | N | One-line discovery note |

The validator (`hooks/pin-up/validator.ts`) sends the pin to `.escape.jsonl` if any of the 6 required fields (slug / source_url / authority / tier / tags / sensitivity) are missing. `created_at` is auto-set by the Stop hook.

## Body 4-section format (AC-18)

The `<pin>` XML body must contain the following 4 `### ` header sections in order. The validator greps these literal headers; if any is missing the pin is escaped.

```
### ① 한 줄 요지
[≤80 chars. One core sentence. Reading just this should tell you what it is.]

### ② SSOT 위치 + 도달 경로
[Description of where source_url points + how to reach it.]

### ③ 전후 컨텍스트
[Which workflow surfaced the need for this information. Memex associative trail.]

### ④ 관련 cross-link
[- → slug: reason for relation. Write "none" if there is no related pin.]
```

> **Important**: do not translate the section header strings. They are validator tokens. Translate the body content only.

If the body grows beyond 4 sections, that's a sign of SSOT body copying (`ssot-no-copy` violation). Stop and trim.

## Slug 8 principles (AC-7)

### Principle ①
Format: `{kind}-{topic}-{slug}` only.
The `-HHMMSS` suffix is appended automatically by `writePinAtomically` on EEXIST collision; do not write it manually.

### Principle ②
`kind` ∈ `{jira, linear, slack, github, notion, code, person, decision, finding, gotcha, unknown}`.
Use `unknown` for kinds not in this list.

### Principle ③
`topic` = a single domain noun (lowercase ASCII). Examples: `auth`, `billing`, `deploy`, `ratelimit`.

### Principle ④
`slug` part = 2–4 alphanumeric words in kebab-case. Examples: `jwt-verify`, `token-refresh-flow`.

### Principle ⑤
No whitespace anywhere in the slug.

### Principle ⑥
No verbs or adjectives. Slugs must be noun-form identifiers.
Bad: `how-to-fix-auth` (verb), `broken-token` (adjective).

### Principle ⑦
No time qualifiers. Avoid `today`, `current`, `latest`, `now`, `2024`, `jan`, `q1`, etc.

### Principle ⑧
No source dependence. The slug must remain meaningful even if `source_url` changes.
Bad: `notion-page-12345` (becomes meaningless when the Notion URL changes).

**Regex** (validator auto-checks principles ①–⑤):
```
^[a-z0-9]+(-[a-z0-9]+){2,}(-\d{6})?$
```

> Principles ⑥–⑧ cannot be auto-validated — the AI must judge them.

## Slug-decision procedure

Decide a slug in this order.

1. **Pick `kind`**: which system originated this information? (`code`, `slack`, `decision`, `person`, …)
2. **Pick `topic`**: what single domain noun fits? (`auth`, `billing`, `deploy`, …)
3. **Pick the `slug` part**: 2–4 nouns that distinguish this pin from siblings.
4. **Self-check ⑥–⑧**: any verbs/adjectives? any time qualifiers? any URL-dependent identifiers?
5. **Verify regex**: `^[a-z0-9]+(-[a-z0-9]+){2,}(-\d{6})?$`

## Slug examples

### Good ①
`code-auth-jwt-verify` — kind=code, topic=auth, slug=jwt-verify. Noun-form, source-independent.

### Good ②
`decision-billing-plan-limit` — kind=decision, topic=billing, slug=plan-limit. Records a decision.

### Good ③
`person-deploy-owner` — kind=person, topic=deploy, slug=owner. Records human authority.

### Good ④
`slack-ratelimit-threshold-config` — kind=slack, topic=ratelimit, slug=threshold-config. A config value found in a Slack thread.

### Bad ①
`how-to-fix-auth-bug` — verb (`fix`) + adjective (`bug`). Violates principle ⑥.

### Bad ②
`current-deploy-setting` — time qualifier (`current`). Violates principle ⑦.

### Bad ③
`notion-page-1a2b3c` — contains a URL identifier. Violates principle ⑧.

### Bad ④
`auth` — fewer than 2 separators (kind-topic-slug structure missing). Fails the regex.

## Cross-link convention

Slugs listed in the `related` attribute are checked by the validator against `$OMT_DIR/pins/{slug}.md` existence. Referencing a non-existent slug causes the pin to escape.

Reference-file link convention:
```
→ Details: [reference/X.md]
```

For SSOT-kind specific examples → Details: [reference/examples-by-ssot-kind.md]
For the 6 use-case scenarios → Details: [reference/use-cases.md]

## Common rationalizations — emit-deferral block table

If any of the rationalizations on the left arises while deciding to emit, STOP and apply the right-hand reality.

| Rationalization | Reality |
|---|---|
| "It's in progress, might change, so I'll wait" | URLs are immutable and `supersedes` absorbs change. The work-in-progress state is itself part of the SSOT — emit immediately. |
| "It's just a local .md, I'll pin it as `file://`" | Other people can't dereference it. Apply scenario F (register externally first, then pin). |
| "I'll just suggest moving it; my job is done" | Collaborative registration is part of the procedure. Plain suggestions get dropped — register directly when the AI has tooling. |
| "Registering in an external system is the user's job, not mine" | If tooling (Notion MCP, GitHub MCP, etc.) is available, the AI should register directly. |
| "Once this task is done, I'll pin it then" | Task completion is not the discovery event. Emit at the moment of discovery. |
| "The pin body needs more content than the SSOT to be useful" | A pin is not a wiki (`indexing-not-wiki`). Pointing accurately at the location is enough. |
| "The response is getting long; I'll emit one this turn and the rest next turn" | "Next turn" is just deferral. Emit every SSOT discovered in the same response. Response length is not the basis for emit count. |
| "Scenario F's collaborative registration conflicts with the 'immediate' emit principle" | No conflict. F's ① and ② are SSOT location correction; ③ is the emit. See `pins/SKILL.md` "The meaning of 'immediately'." |

## Red flags — STOP signals

If any of the following thoughts arises, STOP immediately and revisit the emit-timing rule (`pins/SKILL.md`) or scenario F:

- "It might change, so I'll wait"
- "I'll just put `file://`"
- "Suggesting it to the user is enough"
- "I'll pin it after this task is done"
- "External registration is too big a job; placeholder for now"
- "Some other session will pin it"
- "I'll pin one now, the rest next turn"
- "Scenario F takes time and conflicts with 'immediate' — bypass it"

If any of these appears, switch to the right-hand reality in the rationalization table.

## Validation

The write-pin schema is enforced by `hooks/pin-up/validator.ts`. Violations are routed to `.escape.jsonl` and the pin file is not created.

v1 best-effort: the validator does not enforce `tier` enum values — correctness depends on the training fixtures (SKILL.md + reference/*) and schema coherence. (`sensitivity` is enforced as `private | shared` by validator.ts.)

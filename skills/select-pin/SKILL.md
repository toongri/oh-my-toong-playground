---
name: select-pin
description: "Use when context is needed and pins might already index it — triggers include 조회, 컨텍스트 필요, lookup pin, 어디에 권위가, 누가 알아, 어디 있더라, 찾아봐, 알고 있어, pin 확인, pin 있어. Do NOT use to write or emit new pins (that is write-pin's job)."
---

# select-pin

## Overview

select-pin is the read-only lookup half of the pins system. When a session needs context that a pin might already index, invoke this skill to walk the pin graph and surface the relevant SSOT pointer — without emitting a new `<pin>` or modifying any file.

**Core principle**: Pins are pointers, not wikis. select-pin dereferences those pointers — finding the slug, reading the frontmatter, walking cross-links — then hands the AI the SSOT location so it can act from ground truth.

## When to invoke

```
Context needed?
│
├─ Check the SessionStart <pins> index output
│   ├─ Relevant slug visible? → invoke select-pin (Steps 1–5)
│   └─ No relevant slug but pins:N > 0? → invoke select-pin (a scan may surface it)
│
├─ User asks "where is it?", "who knows?", "is there a pin?"
│   └─ Invoke select-pin first, before any web search or asking the user
│
└─ About to ask the user for context or search externally?
    └─ Check pins first (Steps 1–5). Only on miss: proceed to alternative sources.
```

**6 trigger scenarios** (see [Use cases](#use-cases)):
- A. Slug known from the SessionStart index → fast path
- B. Pin exists but may be stale → look up then verify
- C. No pin, AI can find SSOT directly → miss + direct discovery
- D. No pin, person is the SSOT → miss + person referral
- E. No pin, nobody knows → miss + placeholder
- F. No pin, no external SSOT exists (local .md, interview note, ephemeral) → miss + collaborative external registration before pin emit

## 5-step lookup procedure

### Step 1: List available pins

```bash
ls $OMT_DIR/pins/
```

Enumerate all `{slug}.md` files in the flat directory. The SessionStart hook surfaces a compact index (`pins:N | recent:slug1,slug2,slug3`) — use it as a pre-filter when available. If `$OMT_DIR` is unset, log a WARN and skip pin lookup (fail-open: proceed without pins context).

Note the slug prefix pattern: `kind-topic-descriptor` (with optional `-HHMMSS` suffix auto-applied by the Stop hook on collision). The `kind` component is one of `{jira / linear / slack / github / notion / code / person / decision / finding / gotcha / unknown}` — use it as a first rough filter before reading frontmatter.

### Step 2: Frontmatter scan

For each candidate slug from Step 1, read its frontmatter fields:

| Field | Purpose |
|-------|---------|
| `slug` | Canonical identifier — matches the filename |
| `source_url` | SSOT location: URL or `person:name` free-form identifier |
| `authority` | Who or what is ground truth for this topic |
| `tier` | Pin quality tier (1 = high confidence, 3 = placeholder) |
| `tags` | Comma-separated topic labels |
| `sensitivity` | `private` (default v1) — governs visibility |
| `created_at` | ISO8601 creation timestamp |
| `related` | Optional: comma-separated related slugs (cross-link graph) |
| `supersedes` | Optional: slug this pin replaces |
| `discovery_context` | Optional: one-line Memex trail of the discovery moment |

Read frontmatter only at this step — do not load the full body yet. The goal is to narrow the candidate list to the 1–3 most relevant slugs.

### Step 3: Tag and kind matching

Apply relevance filters:

1. **Kind match**: does the slug prefix kind match the topic? (e.g., `decision-*` for architectural decisions, `person-*` for human authority, `code-*` for codebase location)
2. **Tag match**: do any `tags` fields intersect with the current topic keywords?
3. **Authority match**: does the `authority` field name a system, person, or URL relevant to the current question?
4. **Supersedes chain**: if a pin has a `supersedes` field, the superseded slug is stale — prefer the newer pin.

Rank survivors by relevance. Carry the top 1–3 slugs forward to Step 4. If zero candidates survive, move directly to the [Use cases](#use-cases) miss scenarios (C, D, E, or F). Distinguish E (authority unknown) from F (authority clear, external SSOT location absent — needs registration).

### Step 4: Read pin body for top candidates

For each ranked candidate from Step 3, read the full pin body. A well-formed pin body has 4 sections (validator-coupled Korean tokens):

1. **`한 줄 요지`** (≤80 chars) — the single claim this pin captures
2. **`SSOT 위치 + 도달 경로`** — where the source of truth lives and how to reach it
3. **`전후 컨텍스트`** — what task or conversation surfaced this knowledge
4. **`관련 cross-link`** — links to sibling pins or external SSOT URLs

Use section 2 (`SSOT 위치`) to find the actual information source. The pin body is a pointer — dereference it to the real SSOT when needed. Do not treat the pin body itself as the authoritative content (SSOT principle: `ssot-no-copy`).

### Step 5: Cross-link walk via the `related` field

After reading a matched pin's body, check its `related` field. If present, walk the linked slugs to depth 1 (minimum) for context completeness. Configurable to depth 2 when the topic is complex.

**Walk procedure**:
1. Parse `related: [slug1, slug2, ...]` from the matched pin's frontmatter.
2. For each related slug, repeat Step 2 (frontmatter scan) and Step 4 (body read).
3. Note: `hooks/pin-up/validator.ts` (AC-19) ensures related slugs point to existing files before a pin is persisted. If a related slug is nonetheless missing at read time (e.g., pin deleted after write), log a WARN and continue — do not abort the lookup.
4. Synthesize findings: combine the matched pin, its related pins, and any referenced SSOT URLs into a unified context summary.

**Synthesis**: After completing the walk, produce a concise summary that states:
- Which pin(s) matched
- What the SSOT location is (`source_url` / `authority`)
- What the one-line summary says
- Which related pins were walked and what additional context they provided
- Whether any cross-links point to further SSOT sources to dereference

This synthesis is the output of the select-pin invocation. Use it to answer the question or inform the next action.

## Related cross-link walk procedure

A named, callable sub-procedure used in Step 5 and reusable independently when starting from a known slug.

**Input**: a starting slug (string)

**Procedure**:

```
walk_related(slug, depth=1, visited={}):
  if slug in visited: return  # cycle guard
  visited.add(slug)

  pin = read $OMT_DIR/pins/{slug}.md
  if not exists:
    log WARN "related slug missing: {slug}"
    return

  collect: slug, source_url, authority, tags, body summary
  related_slugs = parse pin.frontmatter.related  # [] if absent

  if depth > 0:
    for each rs in related_slugs:
      walk_related(rs, depth - 1, visited)
```

**Default depth**: 1 (walk immediate neighbors). Use depth 2 when the topic spans multiple subsystems and the initial pin's related list contains `decision-*` or `person-*` pins likely to carry further cross-links.

**Cycle guard**: the visited set prevents infinite loops if two pins reference each other.

**Output**: a flat list of `{slug, source_url, authority, one-line summary}` tuples, ordered by walk order (matched pin first, then its neighbors).

**SSOT dereference note**: when `source_url` is a URL, it points to a living document (code, PR, Notion, Slack). When it is `person:name`, the SSOT is a person's knowledge — note this explicitly in the synthesis and, if the context is needed urgently, escalate to asking that person directly.

## What select-pin does NOT do

- **Does not emit `<pin>` XML** — that is `write-pin`'s responsibility. select-pin is strictly read-only.
- **Does not modify any file** — no writes to `$OMT_DIR/pins/`, no cursor updates, no escape-log entries.
- **Does not create new pins for discovered information** — after a miss, invoke `write-pin` separately.
- **Does not perform web search or code search** — select-pin reads existing pins only. If pins don't cover the topic, the miss is reported and other tools take over.
- **Does not manage the escape log or cursor** — those are `pin-up` hook concerns.

The SSOT principle applies here too: select-pin reads pins (which are indexing-not-wiki pointers), then dereferences them to the actual SSOT (URL, `person:name`, PR, Slack thread) when needed. The pin is never the truth — it points to the truth.

## Use cases

### Scenario A — hit: pin exists and is accurate

Context is needed. SessionStart output shows `recent:auth-jwt-verifier`. Slug is immediately visible.

**Lookup behavior**:
- Skip the Step 1 bulk scan — slug is known from the index.
- Step 2: read `auth-jwt-verifier.md` frontmatter → `source_url: https://github.com/.../auth/jwt.ts#L142`, `authority: jwt.ts:verifyToken`.
- Step 3: kind=`code`, tags match the `auth` topic → confirmed relevant.
- Step 4: body confirms the SSOT is `verifyToken` at line 142. One-line summary: "JWT verification entry point is jwt.ts:142 verifyToken."
- Step 5: `related: [decision-auth-strategy]` → walk neighbor → context on why this design was chosen.
- Synthesis: SSOT is `jwt.ts:142`, authority confirmed. No new `<pin>` emit — use the existing pin as-is.

### Scenario B — stale: pin exists but is wrong

A pin exists but the AI or user suspects it no longer reflects reality (e.g., `tier: 3` placeholder, or `discovery_context` references an old task).

**Lookup behavior**:
- Run the full 5-step procedure.
- Step 4: the body's SSOT location no longer matches current codebase state.
- Step 5: related pins or the external URL confirm the discrepancy.
- Synthesis: flag the pin as potentially stale. Report what the pin says vs. what current evidence suggests.
- Action: after confirming the accurate SSOT through other means, invoke `write-pin` with `supersedes: <stale-slug>` to update. select-pin does NOT emit the supersedes pin — that is write-pin's job.

### Scenario C — miss + direct discovery

No pin matches the query. The AI can locate the SSOT directly through code search, documentation, or web fetch.

**Lookup behavior**:
- Run the full 5-step procedure. Zero candidates survive Step 3.
- Synthesis: report "pins: no match." Proceed to direct discovery (code search, docs, etc.).
- After discovering the SSOT, invoke `write-pin` to capture the new pin. select-pin's job ends at the miss report — it does not write.

### Scenario D — miss + person source

No pin, and the SSOT is held by a specific person ("ask A about it").

**Lookup behavior**:
- Run the full 5-step procedure. Zero or low-confidence matches.
- Step 2/3: scan for `person-*` slugs that might index this person's domain. If a `person:name` pin exists for a related domain, surface it as a warm lead.
- Synthesis: report "pins: no direct match; possible person authority: [name from context]." Recommend asking the person directly.
- After the person confirms, invoke `write-pin` with `source_url: person:name`. select-pin does NOT write.

### Scenario E — miss + unknown — nobody knows

No pin, no accessible SSOT, nobody knows. A placeholder is warranted.

**Lookup behavior**:
- Run the full 5-step procedure. No match at any step.
- Synthesis: report "pins: no match; SSOT unknown." Note what was searched (which slug patterns, which tags).
- Recommend invoking `write-pin` with `tier: 3` (placeholder) so the gap is indexed for future resolution. select-pin does NOT write the placeholder.

### Scenario F — miss + external SSOT does not exist

No pin matches the query. The information is rich (user-authored content, interview notes, ephemeral chat) but no formal record exists in a stable external system (Notion / Wiki / PR / code repo). `file:///` paths are non-dereferenceable for others and volatile.

**Lookup behavior**:
- Run the full 5-step procedure. Zero candidates survive Step 3.
- Step 2/3: confirm the discovery is rich but external dereferenceable location is absent — distinguish from Scenario E ("nobody knows") because here the authority is clear (the user) but the SSOT location needs registration.
- Synthesis: report "pins: no match; SSOT location requires external registration first."
- Action: recommend invoking `write-pin` Scenario F (3-step collaborative registration → emit). select-pin does NOT register and does NOT write. After the user agrees and the external system entry is created, `write-pin` emits the pin pointing at the registered URL.

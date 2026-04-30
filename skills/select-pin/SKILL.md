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
├─ Check SessionStart <pins> index output
│   ├─ Relevant slug visible? → invoke select-pin (Step 1–5)
│   └─ No relevant slug but pins:N > 0? → invoke select-pin (scan may surface it)
│
├─ User asks "어디에 있어?", "누가 알아?", "pin 있어?"
│   └─ invoke select-pin first, before any web search or user question
│
└─ About to ask user for context or search externally?
    └─ Check pins first (Step 1–5). Only on miss: proceed to alternative sources.
```

**5 trigger scenarios** (see [Use cases](#use-cases)):
- A. Slug known from SessionStart index → fast path
- B. Pin exists but may be stale → lookup then verify
- C. No pin, AI can find SSOT directly → miss + direct discovery
- D. No pin, person is the SSOT → miss + person referral
- E. No pin, nobody knows → miss + placeholder

## 5-step lookup procedure

### Step 1: List available pins

```bash
ls $OMT_DIR/pins/
```

Enumerate all `{slug}.md` files in the flat directory. The SessionStart hook surfaces a compact index (`pins:N | recent:slug1,slug2,slug3`) — use that as a pre-filter when available. If `$OMT_DIR` is unset, log a WARN and skip pin lookup (fail-open: proceed without pins context).

Note the slug prefix patterns: `kind-topic-descriptor` or `YYYY-MM-DD-kind-topic-descriptor`. The `kind` component is drawn from `{jira/linear/slack/github/notion/code/person/decision/finding/gotcha/unknown}` — use it as a first rough filter before reading frontmatter.

### Step 2: Frontmatter scan

For each candidate slug from Step 1, read its frontmatter fields:

| Field | Purpose |
|-------|---------|
| `slug` | Canonical identifier — matches filename |
| `source_url` | SSOT location: URL or `person:이름` free identifier |
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

1. **Kind match**: Does the slug prefix kind match the topic? (e.g., `decision-*` for architectural decisions, `person-*` for human authority, `code-*` for codebase location)
2. **Tag match**: Do any `tags` fields intersect with the current topic keywords?
3. **Authority match**: Does the `authority` field name a system, person, or URL relevant to the current question?
4. **Supersedes chain**: If a pin has a `supersedes` field, the superseded slug is stale — prefer the newer pin.

Rank survivors by relevance. Carry the top 1–3 slugs forward to Step 4. If zero candidates survive, move directly to the [Use cases](#use-cases) miss scenarios (C, D, or E).

### Step 4: Read pin body for top candidates

For each ranked candidate from Step 3, read the full pin body. A well-formed pin body has 4 sections:

1. **한 줄 요지** (≤80 chars) — the single claim this pin captures
2. **SSOT 위치 + 도달 경로** — where the source of truth lives and how to reach it
3. **전후 컨텍스트** — what task or conversation surfaced this knowledge
4. **관련 cross-link** — links to sibling pins or external SSOT URLs

Use section 2 (SSOT 위치) to find the actual information source. The pin body is a pointer — dereference it to the real SSOT when needed. Do not treat the pin body itself as the authoritative content (SSOT principle: `ssot-no-copy`).

### Step 5: Cross-link walk via `related` field

After reading a matching pin's body, check its `related` field. If present, walk the linked slugs to depth 1 (minimum) for context completeness. Configurable to depth 2 when the topic is complex.

**Walk procedure**:
1. Parse `related: [slug1, slug2, ...]` from the matched pin's frontmatter.
2. For each related slug, repeat Step 2 (frontmatter scan) and Step 4 (body read).
3. Note: the `hooks/pin-up/validator.ts` (AC-19) ensures related slugs point to existing files before a pin is persisted. If a related slug is nonetheless missing at read time (e.g., pin deleted after write), log a WARN and continue — do not abort the lookup.
4. Synthesize findings: combine the matched pin, its related pins, and any referenced SSOT URLs into a unified context summary.

**Synthesis**: After completing the walk, produce a concise summary that states:
- Which pin(s) matched
- What the SSOT location is (`source_url` / `authority`)
- What the one-line summary says
- Which related pins were walked and what additional context they provided
- Whether any cross-links point to further SSOT sources that should be dereferenced

This synthesis is the output of the select-pin invocation. Use it to answer the question or inform the next action.

## Related cross-link walk procedure

This is a named, callable sub-procedure used in Step 5 and reusable independently when starting from a known slug.

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

**Default depth**: 1 (walk immediate neighbors). Use depth 2 when the topic spans multiple subsystems and the initial pin's related list contains `decision-*` or `person-*` pins that likely carry further cross-links.

**Cycle guard**: The visited set prevents infinite loops if two pins reference each other in their `related` fields.

**Output**: flat list of `{slug, source_url, authority, one-line summary}` tuples, ordered by walk order (matched pin first, then its neighbors).

**SSOT dereference note**: When `source_url` is a URL, it points to a living document (code, PR, Notion, Slack). When it is `person:이름`, the SSOT is a person's knowledge — note this explicitly in the synthesis and, if the context is needed urgently, escalate to asking that person directly.

## What select-pin does NOT do

- **Does not emit `<pin>` XML** — that is `write-pin`'s responsibility. select-pin is strictly read-only.
- **Does not modify any file** — no writes to `$OMT_DIR/pins/`, no cursor updates, no escape-log entries.
- **Does not create new pins for discovered information** — after a miss, invoke `write-pin` separately.
- **Does not perform web search or code search** — select-pin reads existing pins only. If pins don't cover the topic, the miss is reported and other tools take over.
- **Does not manage the escape log or cursor** — those are `pin-up` hook concerns.

The SSOT principle applies here too: select-pin reads pins (which are indexing-not-wiki pointers), then dereferences them to the actual SSOT (URL, `person:이름`, PR, Slack thread) when needed. The pin is never the truth — it points to the truth.

## Use cases

### 시나리오 A: Hit — pin 있고 정확

Context is needed. SessionStart output shows `recent:auth-jwt-verifier`. Slug is immediately visible.

**Lookup behavior**:
- Skip Step 1 bulk scan — slug is known from index.
- Step 2: read `auth-jwt-verifier.md` frontmatter → `source_url: https://github.com/.../auth/jwt.ts#L142`, `authority: jwt.ts:verifyToken`.
- Step 3: kind=`code`, tags match `auth` topic → confirmed relevant.
- Step 4: body confirms SSOT is `verifyToken` at line 142. One-line요지: "JWT 검증 진입점은 jwt.ts:142 verifyToken".
- Step 5: `related: [decision-auth-strategy]` → walk neighbor → context on why this design was chosen.
- Synthesis: SSOT is `jwt.ts:142`, authority confirmed. No new `<pin>` emit — use the existing pin as-is.

### 시나리오 B: Stale — pin 있으나 잘못된 정보

A pin exists but the AI or user suspects it no longer reflects reality (e.g., `tier: 3` placeholder, or `discovery_context` references an old task).

**Lookup behavior**:
- Run full 5-step procedure.
- Step 4: body's SSOT location no longer matches current codebase state.
- Step 5: related pins or external URL confirm the discrepancy.
- Synthesis: flag the pin as potentially stale. Report what the pin says vs. what current evidence suggests.
- Action: after confirming the accurate SSOT through other means, invoke `write-pin` with `supersedes: <stale-slug>` to update. select-pin does NOT emit the supersedes pin — that is write-pin's job.

### 시나리오 C: Miss + 직접 발견

No pin matches the query. The AI can locate the SSOT directly through code search, documentation, or web fetch.

**Lookup behavior**:
- Run full 5-step procedure. Zero candidates survive Step 3.
- Synthesis: report "pins: no match". Proceed to direct discovery (code search, docs, etc.).
- After discovering the SSOT, invoke `write-pin` to capture the new pin. select-pin's job is done at the miss report — it does not write.

### 시나리오 D: Miss + 사람 정보원

No pin, and the SSOT is held by a specific person ("A에게 있다더라").

**Lookup behavior**:
- Run full 5-step procedure. Zero or low-confidence matches.
- Step 2/3: scan for `person-*` slugs that might index this person's domain. If a `person:이름` pin exists for a related domain, surface it as a warm lead.
- Synthesis: report "pins: no direct match; possible person authority: [name from context]". Recommend asking the person directly.
- After the person confirms, invoke `write-pin` with `source_url: person:이름`. select-pin does NOT write.

### 시나리오 E: Miss + 미상 — 아무도 모름

No pin, no accessible SSOT, nobody knows. A placeholder is warranted.

**Lookup behavior**:
- Run full 5-step procedure. No match at any step.
- Synthesis: report "pins: no match; SSOT unknown". Note what was searched (which slug patterns, which tags).
- Recommend invoking `write-pin` with `tier: 3` (placeholder) so the gap is indexed for future resolution. select-pin does NOT write the placeholder.

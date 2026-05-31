---
name: wrap-up
description: Use at the end of a work session to review the WHOLE session and record entities worth pinning. This is the manual, deliberate complete-sweep review — NOT an automated nudge. Triggers on "wrap up", "wrap-up", "session wrap", "end of session", "what should I pin".
---

# wrap-up

Conduct a whole-session review to identify entities worth recording in the pins knowledge graph.

This is a deliberate, manual sweep. It is NOT automatic. You invoke it when a session is winding down and you want to surface knowledge before context is lost.

## Process

### 1. Sweep the session

Scan back over the full session — every discovery, decision, external reference, code location, person named, and architectural fact that surfaced. Ask: "Would a future me (or a colleague) benefit from being able to find this in 10 seconds?"

Apply the recording rubric from the `record` skill:
- Does it have an external SSOT worth pointing at?
- Is the location of ground truth now known?
- Was a person named as an authority?
- Was a decision made that will affect future work?

Discard noise: transient commands, intermediate debug outputs, things that are already obvious from the codebase.

### 2. Collect candidates

List entities you propose to record. For each, briefly state:
- What it is (one sentence)
- Why it merits a pin (which axiom it satisfies)

Show this list to the user before recording. Confirm or prune before writing anything.

### 3. Record confirmed entities

For each confirmed candidate, invoke `record()` from `lib/pins/record.ts`:

```ts
import { record } from 'lib/pins/record.ts';

await record(entity, { location });
```

Build the `entity` with the four required body sections (`한 줄 요지`, `SSOT 위치`, `전후 컨텍스트`, `관련 cross-link`) and complete frontmatter. See the `record` skill for full field reference.

### 4. Report

After recording, state:
- How many entities were recorded
- Their IDs and one-line summaries
- Any that were skipped (escaped to `.escape.jsonl`) and why

## What belongs in a session wrap-up

| Worth pinning | Not worth pinning |
|---------------|-------------------|
| External SSOT located (URL, file, person) | Transient debug output |
| Ground truth pinned in code (file:line) | Things obvious from reading the code |
| Decision made that will constrain future work | Intermediate hypothesis that was disproved |
| Person named as authority on a topic | Generic "check the docs" type notes |
| Architecture fact that took effort to find | Information that will be stale within hours |

## Constraint

Do NOT record everything. A knowledge graph full of low-value entries degrades retrieval. Quality over quantity — 2 high-quality pins beat 10 noisy ones.

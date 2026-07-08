# Discover + Map Procedure (meeting domain)

This file is the complete operational procedure for Stage 5 (Discover + Map). It is adapted from the craft-issue gather-crosslink procedure, which curates related artifacts for a single issue. Two adaptations for meetings are stated up front; everything else — the bounds, the ordering, the graceful-skip, the anti-patterns, the reference format — is the same proven procedure.

**Two adaptations:**
1. **Search seed** = the meeting's decisions, action items, and topics (not a single issue's requirement). Derive query terms from the entities/keywords in the summary (Stage 2) and the extracted action items (Stage 3).
2. **Link target** = each individual action item / decision. A mapped artifact attaches to a specific item ("this Slack thread relates to action item A2"), not to one overarching issue.

Follow every section in sequence.

---

## 1. Gather Bound (architectural constraint)

Before issuing any retrieval call, apply these hard bounds. They exist to prevent noisy raw retrieval from flooding the judgment context — the mitigation that makes live discovery viable rather than an unbounded dump.

**Recency window**: retrieve artifacts updated within the last **90 days** by default. Extend to 180 days only when the meeting explicitly concerns a long-standing effort or a historical decision. Artifacts older than the window may be surfaced if directly referenced in the meeting; cap those at two items.

**Per-source cap**: retrieve at most **10 items per source type** per gather pass. Stop at the cap even if the source reports more matches. Note truncation in one parenthetical within the source block (e.g., "(10 of 34 results retrieved — capped at per-source limit)").

**Logs pressure point (strict bound)**: the `logs` source type (error logs, monitoring alerts, incident records) is unbounded, high-entropy, low-signal-density. Cap logs at **5 items** (half the default) and apply a tighter **14-day** window (not 90). Do not relax the logs cap without an explicit instruction naming a specific incident time range.

---

## 2. Gather-Then-Judge Ordering

Gather and curate are a discrete step that completes before mapping. Do not interleave retrieval with curation.

1. Complete all source-type retrievals (within bounds).
2. Curate: select which artifacts are genuinely related (see §5).
3. Then map each curated artifact to the specific action item / decision it illuminates.

This ensures the mapping receives a curated digest, not raw retrieval noise.

---

## 3. Source-Unreachable Handling (graceful skip)

When a source type is not wired in the current runtime, or a retrieval call errors:

- **Skip gracefully**: proceed without that source type.
- **Annotate the gap**: add a one-line note in the `## 관련 자료` section stating which source type was unreachable and why (e.g., "messenger: Slack MCP not connected in this session").
- **Do not block**: gather incompleteness never blocks the report. The record proceeds with a partial reference set.
- **Zero artifacts found**: if all wired sources are searched and nothing related is found, `## 관련 자료` may be left empty or omitted. An empty result is a valid outcome — the meeting stands on its own with no prior context discovered.
- **Precedence (unwired note wins)**: if ANY source was unwired, keep the `## 관련 자료` section with its one-line skip note even when the wired sources found nothing. The graceful-skip annotation always wins over section omission — the reader must still learn which source was not searched.

---

## 4. Gather Across Source Types

Retrieve from each source type wired in the current runtime. Map each abstract source TYPE to the available MCP/CLI at gather time — concrete tool bindings are not named here.

| Source type | What to retrieve |
|---|---|
| collaboration-docs | spec pages, PRDs, design docs, prior meeting notes on the meeting's topics |
| PM | issues/epics matching the decisions and action items; sibling items in the same area |
| messenger | Slack threads, comment trails discussing the topics or the affected area |
| code-VCS | recent commits, open PRs touching an area a decision/action names |
| logs | error logs, incident records for a component the meeting names (strict bound — §1) |

Apply the §1 bound to every source type independently. Seed each search from the meeting's decisions/actions/topics (adaptation 1).

---

## 5. Curation Rules

After retrieval, evaluate each artifact for genuine relevance. Attach only what illuminates a decision or action item — not everything retrieved.

**Genuinely related:**
- It defines or constrains a decision the meeting made (a PRD, a design doc, a spec).
- It is a prior decision this meeting continues, revises, or contradicts.
- It is an issue/epic whose scope overlaps an action item or decision.
- It is a thread where the topic was negotiated or a blocker was raised.
- It is a commit/PR or an incident record that is direct evidence for a decision or action.

**Exclude:**
- Keyword-coincidence hits not substantively connected to any decision/action.
- Superseded documents already replaced by a newer linked version.
- Cap-boundary results duplicating substance already covered.

**Anti-patterns — explicitly forbidden:**
- A relevance-score table assigning numeric weights to artifacts.
- A numeric ranking of artifacts by similarity or relevance.
- A typed dependency graph (blocks / is-blocked-by / duplicates encoded as a structured graph).

Curation is inline judgment on the meeting's framing. Do not delegate it to a subagent — it needs the meeting context and cannot be done context-blind.

---

## 6. Mapping + Reference Format

For each curated artifact, map it to the specific action item / decision it relates to (adaptation 2), and record it in a `## 관련 자료` section. Format each entry:

```
- PRD: [short title conveying the relevant content] — [link] — 연결: {A# / D# item id} — 근거: [why it is relevant].
- 회의록: [short title] — [link] — 연결: {A# / D# item id} — 근거: [why it is relevant].
- 관련 논의: [short title] — [link] — 연결: {A# / D# item id} — 근거: [why it is relevant].
```

**Labels** — use `PRD:`, `회의록:`, `관련 논의:` literally as the prefix. Do not invent new label names.
- `PRD:` — spec pages, PRDs, design docs, requirement documents from collaboration-docs.
- `회의록:` — prior meeting notes, recorded decisions from collaboration-docs.
- `관련 논의:` — Slack threads, comment trails, PM discussion threads, review comments, code-VCS artifacts (markdown-link form), logs artifacts (with type noted parenthetically, e.g. `관련 논의: (incident log) …`), and PM issues surfaced as context.

**Key content inline**: the short title must convey the substance — what the artifact says that matters — not just a file name or issue number. A reader should understand why the entry exists without opening it.

**Per-entry justification is mandatory**: every entry ends with `근거: ...` — the specific reason it relates to the mapped item. Justifications are not optional.

**`연결` binds to a specific item**: each artifact names which action item or decision it maps to, by that item's short id — `A#` for an action item (extract-actionitems.md §5) or `D#` for a decision (type-schemas.md §3.1) (adaptation 2). An artifact relevant to the meeting as a whole, but to no specific item, may use `연결: 전체`.

**Proposal-only boundary**: this stage discovers and links. It does NOT create relations in a PM tool, push to a docs tool, or modify any artifact — those are separate, user-approved steps. The `## 관련 자료` section is passive references only.

---

## 7. Origin

Adapted from `skills/craft-issue/references/gather-crosslink.md` (the same bounds, ordering, graceful-skip, anti-patterns, and label format), re-seeded and re-targeted for the meeting domain per the two adaptations above. The numeric gather bounds (§1) and the label format (§6) are mirrored verbatim from that source — there is no runtime cross-skill dependency (each OMT skill is self-contained), so the mirror is the tradeoff: if a bound is tuned in craft-issue, update this copy to match.

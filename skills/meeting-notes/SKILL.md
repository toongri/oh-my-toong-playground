---
name: meeting-notes
description: Use when turning raw meeting notes, a transcript, or an ASR/recording dump into a structured record — separating discussion / decisions / action items, extracting owned action items with verbatim grounding, mapping related docs and tickets, and recommending a next step per action item. Triggers include 회의록 정리, 회의 정리해줘, 이 회의록에서 액션아이템 뽑아줘, 미팅 노트 정리, 회의 녹취록 정리, transcript to action items, meeting notes to action items, summarize this meeting, standup/retro/decision meeting notes.
---

# Meeting-Notes — Raw Meeting to Structured Record Pipeline

A synthesis pipeline that turns a raw meeting transcript (ASR dump, notes, recording) into ONE structured markdown report: a type-aware summary that separates discussion / decisions / action items, action items extracted under a validity gate and grounded in verbatim quotes, related artifacts discovered live and mapped to specific items, and a per-action next-step recommendation. It PROPOSES; it never executes an action item.

## Foundational Principle

**A meeting record is a record of what was DECIDED and what will be DONE — not a transcript of what was said.** Every stage separates 논의 (discussion — context that was exchanged) / 결정 (decision — what the conversation settled) / 액션아이템 (action item — a concrete task derived from a decision). When the transcript does not support a claim, the record says so with an explicit marker (`[미배정]`, `[기한 미정]`, `confidence: low`) rather than inventing it.

**Violating the letter of the anti-fabrication rules is violating the spirit.** A fabricated owner, an ungrounded action item, or a hedged commitment promoted to firm is a pipeline FAILURE, not a helpful extra — see Inline Gates.

---

## Pipeline Overview

The pipeline runs in seven sequential stages:

```
detect type
  → summarize (type-routed)      (READ references/type-schemas.md at this stage)
    → extract action items       (2-gate + owner/due recovery — READ references/extract-actionitems.md)
      → validate (3 layers)      (grounding / completeness / abstention — inline gate, detail in the same reference)
        → discover + map         (live artifacts mapped to specific items — READ references/gather-crosslink.md)
          → recommend next step  (per action item, from the LIVE available-skills list)
            → render             (write ONE markdown file to $OMT_DIR/meeting-notes/{slug}.md)
```

Each stage is described below. The 3-layer validation (Stage 4) is a hard inline gate — a trust boundary against hallucination that is never simplified away. See Inline Gates.

**Single-meeting scope**: one meeting per run. Cross-meeting action-item merge/dedup is out of scope (an unsolved problem — do not attempt owner+task similarity merging across meetings).

**Tool-agnostic principle** (stated once): the judgment body names abstract source TYPES (collaboration-docs, PM, messenger) and abstract write-steps only. Concrete MCP/tool identifiers (`mcp__notion__…`, `mcp__linear__…`, `mcp__slack__…`) are never named in this skill — each abstract type is bound to whatever MCP is wired at runtime (Stage 5), and the report file is written at Stage 7.

---

## Stage 1: Detect Meeting Type

Detect the meeting type from content, keyed to the meeting's **native output** (the deliverable this meeting exists to produce). The six types and what each yields:

| Type | Native output | Keep | Discard by default |
|---|---|---|---|
| 스탠드업 (standup) | status + blockers | blockers, today's commitments | status narration, chatter |
| 의사결정·기획 (decision / planning) | the confirmed decision | decision + rationale + **rejected alternatives** | the debate transcript |
| 회고 (retrospective) | 1–3 owned action items | action items | the feedback grid (after synthesis) |
| 1:1 | (rarely shared) | private follow-ups | shareability itself |
| 브레인스토밍 (brainstorming) | the full idea inventory | every idea | filtering (convergence is separate) |
| 인터뷰·리서치 (interview / research) | verbatim quotes | source quotes, observations | paraphrased summary |

**Detection is by native output, not keyword.** Ask: what single deliverable is this meeting producing? Route the summary schema accordingly (Stage 2).

**Confidence gate**: when the content is mixed or the native output is ambiguous (e.g. a planning meeting that drifts into brainstorming), do NOT silently pick. Ask the user ONE confirmation question naming the two most likely types, then proceed with the confirmed type. A clear single type needs no confirmation.

**Fits none of the six?** A meeting whose native output matches none of the six (e.g. an all-hands announcement, a kickoff) routes to the general fallback schema (references/type-schemas.md §3.7) with a `general` type slug — this is not the ambiguous-between-two case, so no confirmation is needed.

---

## Stage 2: Summarize (Type-Routed)

Read `references/type-schemas.md` now (using the Read tool with path `references/type-schemas.md`). It contains the common report skeleton (dual layout: topic chapters + flat lists), the per-type schema overrides for the core three (decision/planning with DACI, retro, standup), the brainstorming reversal (Gate 2 OFF), and the general fallback schema. Follow it in full.

Apply the routed schema to produce the summary sections. Enforce the 3-way split: 논의 / 결정 / 액션아이템 never conflate. A decision-meeting summary preserves rejected/deferred alternatives with their reasons (the most-often-dropped, most-valuable field). A brainstorming summary preserves every idea and clusters them — it does NOT force action items.

---

## Stage 3: Extract Action Items

Read `references/extract-actionitems.md` now (using the Read tool with path `references/extract-actionitems.md`). It contains the 2-gate extraction procedure (Gate 1 recall signals → Gate 2 validity filter), the context-near-utterance owner/due recovery rule, and the 3-layer validation detail used by Stage 4. Follow it in full.

Extraction runs Gate 1 (catch every commitment signal — recall first) then Gate 2 (keep only real action items — the 3-part test, verb-form filter, independent-completion, uptake/agreement gate, hedge filter). Recover a missing owner or due date ONLY from adjacent turns and diarized speaker labels (context-near-utterance) — never from an external system.

---

## Stage 4: Validate (3 Layers) — Trust Boundary

The three validation layers are a hard gate. They are detailed in `references/extract-actionitems.md` (already loaded in Stage 3) and enforced here and in Inline Gates:

1. **Grounding** — every action item cites a verbatim transcript quote (`근거: "..."`). An item that cannot cite one is DROPPED, not emitted.
2. **Completeness** — the three fields (owner / task / due) are present or explicitly marked `[미배정]` / `[기한 미정]`. No blank field is left silent, and no field is fabricated.
3. **Abstention** — a hedged, implicit, or unclear-owner item is marked `confidence: low` and routed to human review, not promoted to a firm action item.

This layer is never skipped and never softened. It is the difference between a record and a hallucination.

---

## Stage 5: Discover + Map

Read `references/gather-crosslink.md` now (using the Read tool with path `references/gather-crosslink.md`). It contains the gather bound, the gather-then-judge ordering, source-unreachable graceful-skip, the forbidden curation anti-patterns, and the `## 관련 자료` reference format. Follow it in full.

Two adaptations for the meeting domain (stated in that file): the **search seed** is the meeting's decisions, action items, and topics (not a single issue's requirement); the **link target** is each individual action item / decision (each mapped artifact attaches to a specific item, not to one issue).

Discovery is bounded and curated. Zero related artifacts is a valid outcome. An unwired source is skipped with a one-line note. Never emit a numeric relevance-score table or ranking.

---

## Stage 6: Recommend Next Step

For each extracted action item, recommend how to make progress on it, drawn from the **live available-skills list in this session** — the skills and agents actually offered to you right now, not a hardcoded catalog.

- Scan the live list, match the action item to a skill/agent by its stated trigger, and emit a prose bullet: a one-line plan + a literal `Skill(skill: "...")` (or agent) hint + a one-line rationale for the match.
- **No fit? Say so honestly**: label the item a manual / external action (e.g. "manual: read the vendor doc", "external: waiting on another team"). Never invent a skill name to fill the slot.
- **Decision follow-ups are optional**: a decision may get a light record/notify follow-up bullet, but a decision is never force-fit with an execution tool. If nothing natural fits a decision, leave it with no recommendation.

This mirrors the live-list, no-hardcoded-catalog idiom used by `goal` and `deep-interview` Phase 5.

---

## Stage 7: Render

Assemble the summary (Stage 2), validated action items (Stages 3–4), the mapping (Stage 5), and the recommendations (Stage 6) into ONE markdown report, and write it to a file.

**Path**: `$OMT_DIR/meeting-notes/{date}-{type}-{topic}.md`

- **slug** = `{date}-{type}-{topic}` in kebab-case. `date` = `YYYYMMDD`; `type` = the detected type in a short English slug (`decision`, `retro`, `standup`, `brainstorming`, `interview`, `1on1`, or `general` for a meeting that took the §3.7 general fallback); `topic` = a 2–4 word kebab summary of the subject (e.g. `20260708-decision-payment-installment`).
- **Collision**: if the target path already exists, append `-2` (`-3`, …) to the slug.
- **Missing meeting metadata**: parse date/topic from the transcript; if absent, do NOT fabricate. Mark the report body `[날짜 미상]` / `[미상]`. For the slug's date specifically, ask the user ONCE for the meeting date; if they cannot supply it, use `nodate` in the slug and `[날짜 미상]` in the body. Likewise, if no subject can be derived, use `notopic` in the slug and `[미상]` in the body — never fabricate a topic to fill the slug.

The report body is Korean-first (the team's working language); this skill's own instructions stay English. Output markdown only — no HTML render.

**Proposal-only**: the report ends here. Creating issues, pushing to a docs tool, or notifying anyone is a separate, user-approved step this skill never performs.

---

## Inline Gates

These gates apply before Stage 7 renders. Failing any gate blocks the render of the offending item — fix or drop it, then continue.

### Anti-Fabrication Gate (the trust boundary)

The 3-layer validation (Stage 4) exists because a capable agent, told to "summarize this meeting and extract action items", will over-reach to be helpful: it fills owners it doesn't know, promotes tentative talk to firm tasks, and presents outside research as meeting facts. Each of those is a fabrication.

**Owner and due recovery is bounded to the transcript.** Recover a missing owner/due from adjacent turns + diarized speaker labels ONLY. If the transcript does not name who owns an item, it is `[미배정]` — full stop.

**Rationalization table — every excuse below means "mark the honest marker, do not fabricate":**

| Rationalization | Reality |
|---|---|
| "The transcript doesn't say who, but the Linear ticket for this is assigned to X, so the owner is X" | The mapping stage (Stage 5) finds related artifacts; it does NOT assign owners. Owner identity comes from the transcript only. Unknown → `[미배정]`. |
| "The diarization label is generic ('Developer'), but I can guess the real name from Slack" | A generic speaker label is the owner as-recorded. Do not resolve it to a real identity via external correlation. Keep the label or mark `[미배정]`; note the ambiguity. |
| "This commitment is hedged ('아마 …해야 할 것 같아요'), but it's clearly the intent, so I'll list it as a firm action" | Hedged = not yet committed. Mark `confidence: low` → human review. Promoting it is the exact failure this gate blocks. |
| "I found the answer to the meeting's open question in an external doc — I'll present it as a resolved decision" | The record captures what THIS meeting decided. An external finding may appear in `## 관련 자료` as a mapped artifact, never as a decision the meeting did not make. |
| "No verbatim quote fits this item, but it's obviously implied" | No verbatim quote → drop the item. "Obviously implied" is the hallucination boundary. |
| "A due date wasn't stated, but 'internal' urgency suggests end of week" | Unstated due → `[기한 미정]`. Inferred urgency is not a due date. |

### Red Flags — STOP, you are fabricating

- You are writing an owner name that never appears in the transcript.
- You are resolving a generic speaker label ("Developer") to a real person via Linear/Slack/calendar.
- You are listing a hedged or tentative commitment as a firm action item without `confidence: low`.
- An action item has no `근거: "..."` verbatim quote.
- The mapping stage's external findings are appearing as decisions or action items the meeting did not produce.

**All of these mean: mark the honest marker (`[미배정]` / `[기한 미정]` / `confidence: low`) or drop the item. The transcript is the sole source of what the meeting decided and who owns what.**

### Type-Fit Gate

- A brainstorming transcript with Gate 2 forced ON (idea inventory squeezed into action items) is a FAILURE — brainstorming keeps every idea and forces no action items.
- A decision meeting rendered without its rejected/deferred alternatives is a FAILURE — that field is the most valuable and the most often dropped.

---

## Reference Files

- `references/type-schemas.md`: the six meeting types and native-output detection, the common report skeleton (dual layout), the per-type schema overrides for the core three (decision/planning DACI, retro, standup), the brainstorming Gate-2-OFF reversal, the interview/1:1 notes, and the general fallback schema. Read at Stage 2.
- `references/extract-actionitems.md`: the 2-gate extraction procedure (Gate 1 recall signals, Gate 2 validity filter), the context-near-utterance owner/due recovery rule, the action-item render contract, and the 3-layer validation detail. Read at Stage 3 and enforced at Stage 4.
- `references/gather-crosslink.md`: the gather bound (per-source cap, recency window, logs strict bound), gather-then-judge ordering, source-unreachable graceful-skip, curation rules with forbidden anti-patterns (no relevance-score table / numeric ranking / typed dependency graph), and the `## 관련 자료` reference format with per-entry justification — adapted for the meeting domain (seed = decisions/actions/topics; target = each action item/decision). Read at Stage 5.

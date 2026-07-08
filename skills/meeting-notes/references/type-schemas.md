# Type Detection + Report Schemas

This file is the complete procedure for Stage 2 (Summarize). The spine defers here for meeting-type detection, the common report skeleton, and the per-type schema overrides. Follow every section in sequence.

The organizing variable is one question: **what is this meeting's native output** — the single deliverable it exists to produce, which decides what to keep and what to discard. Detection routes the schema; the schema decides the sections.

---

## 1. Detection (by native output)

Classify the transcript by asking what native deliverable it produces. Route to one of the six specialized schemas below; a meeting that fits none of the six routes to the §3.7 general fallback:

| Type | Native output | Extract | Discard by default | Uptake signal |
|---|---|---|---|---|
| 스탠드업 (standup) | status + blockers | blockers (escalate), today's commitments | status narration, chatter; no state carried over | — |
| 의사결정·기획 (decision / planning) | one approved decision + its logic | decision, rationale, **rejected alternatives**, decision-maker | the debate transcript | the Approver's approval |
| 회고 (retrospective) | 1–3 owned, concrete action items | action items | the feedback grid (after synthesis) | team agreement on the few actions |
| 1:1 | (rarely shared) | follow-ups, career/goal topics, private notes | shareability itself; sensitive content is not recorded at all | — |
| 브레인스토밍 (brainstorming) | the full idea inventory | every idea + clusters | filtering (convergence is a separate session) | — (Gate 2 OFF) |
| 인터뷰·리서치 (interview / research) | verbatim quotes (evidence) | source quotes, behavioral observations, pain-point signals | paraphrased summary (loses evidentiary value) | ≥2 verbatim quotes from different participants per theme |

If the content is mixed or the native output is ambiguous, do not silently pick — ask the user one confirmation naming the two most likely types (spine Stage 1), then route.

---

## 2. Common Report Skeleton (all types)

Every report uses a **dual layout** — a topic-chapter skim layer over flat quick-reference lists — plus the type-specific override section from §3.

```
# {meeting title or [미상]} — 회의 정리
{meta line: 날짜 · 회의 종류 · 참석자(as-recorded, or [미상])}

## 논의 (주제별)
### 주제 1: {topic}
  - {bulleted discussion points; narrative only where rationale/nuance matters}
### 주제 2: {topic}
  ...

## 결정
  - {flat list of confirmed decisions — see §3 override for per-type decision shape}

## 액션아이템
  - {flat list — action-item render contract from extract-actionitems.md}

## 미해결 질문
  - {open questions with owner where known}

## 관련 자료
  {mapped artifacts — from gather-crosslink.md, written at render time}

## 다음 단계 추천
  - {per action item — from spine Stage 6; plus any optional decision follow-up bullets}
```

**Rules for the skeleton:**
- **3-way split is absolute**: 논의 (what was exchanged) / 결정 (what was settled) / 액션아이템 (a task derived from a decision) never mix. A settled outcome is a 결정; a task to carry it out is an 액션아이템; the surrounding talk is 논의.
- **Bullets for outcomes, narrative for rationale**: decisions and actions are bullets (scannable). Use narrative only where a decision's rationale or a nuanced discussion needs it. Default to bullets.
- **Topic chapters** segment the discussion by subject, not by time. They are the skim layer; the flat lists are the quick-reference layer.
- The type-specific override in §3 replaces or enriches the `## 결정` and `## 액션아이템` sections; the skeleton is the frame.

---

## 3. Per-Type Overrides

### 3.1 의사결정·기획 (Decision / Planning) — core schema

Native output: one approved decision plus the logic that produced it — not the debate. Decision-meeting `## 결정` uses the DACI shape:

```
## 결정
[header] 결정 상태 · 영향도 · 관련자(DACI) · 기한
### Background
  {1–2 sentences framing what had to be decided}
### 검토한 선택지 (Options considered)
  {each option with pros/cons; cost high/med/low — when the meeting actually weighed options}
### 탈락·보류한 대안 (Rejected / deferred alternatives)
  {each rejected or deferred alternative + WHY it was dropped — the most-often-skipped, most-valuable field}
### 결론 (Outcome)
  {each confirmed decision as [D{n}] {decision} — with 결정자(Approver) + 날짜 + 영향 범위 — 근거: "{verbatim confirming utterance}"}
```

Each decision carries a short stable id (`D1`, `D2`, …) so the mapping stage (gather-crosslink.md §6) can bind an artifact to a specific decision (`연결: D2`). The general-fallback `## 결정` list uses the same `[D{n}]` id prefix. **Grounding extends to decisions**: like an action item, each `[D{n}]` cites a verbatim `근거` quote of the confirming utterance ("~하기로 확정" or the Approver's assent). A "decision" with no confirming utterance to cite is not a decision — downgrade it to 미해결 질문, never record it as firm.

DACI roles (who decides): **Driver** (drives the decision to close, 1 person) · **Approver** (the single final decision-maker — not a majority vote) · **Contributors** (input providers) · **Informed** (notified after). Fill only the roles the transcript actually names; mark the rest `[미상]`.

Extraction focus (in priority order):
1. **결정문** — only what was actually confirmed ("~하기로 확정"). Un-confirmed talk stays in 논의 or 미해결 질문, never in 결정.
2. **근거 (rationale)** — why this decision. The first thing lost if not captured; always keep it.
3. **탈락·보류 대안 + 이유** — the field that prevents "why didn't we do A?" re-litigation months later. An option considered and not chosen is preserved here, never silently dropped.
4. **결정자 · 날짜 · 영향 범위**.

Uptake gate for this type = the Approver's confirmation. An item the Approver did not confirm is downgraded to 미해결 질문, not recorded as a decision.

**Planning variant** (when the meeting is scoping future work, not ratifying one decision): use `## Problem statement` / `## Goals` / `## Non-goals` / `## Key decisions + rationale` / `## Open questions (owner 포함)` / `## Gaps / blockers`. The differentiator is explicit **Non-goals** (what is deliberately out of scope) — scope-creep defense. Its `Key decisions` carry the same `[D{n}]` id and verbatim `근거` quote as the DACI Outcome above. It also retains the skeleton's `## 액션아이템` — Stage 3 extracts action items for planning meetings, and they render there, never folded into Open questions or Gaps.

### 3.2 회고 (Retrospective) — core schema

Native output: **1–3 owned, concrete action items.** The feedback grid is discarded after synthesis. `## 액션아이템` for a retro:

```
## 상위 주제 (합성)
  {patterns grouped from the feedback grid — Loved/Loathed/Learned/Longed-for, or Mad/Sad/Glad, or Keep/Problem/Try}
## 액션아이템 (1–3개, 소유자 + 기한)
  {verb-first, single owner, date — strictly no vague "communicate better" non-actions. The full render contract from extract-actionitems.md §5 still applies: each item keeps its [A{n}] id and verbatim 근거 quote, and a missing owner/due is [미배정]/[기한 미정], never invented — even though the retro's deliverable IS owned actions.}
## 지난 액션 리뷰
  {the previous retro's actions reviewed — "done? did it help?"}
```

Retro specifics: **no vagueness** (verb-first and independently completable — apply the verb-form filter and independent-completion test strictly; an unowned or undated real action is still kept with [미배정]/[기한 미정], never fabricated to fill the slot); **continuity contract** (a retro carries state across meetings — it opens with a review of the previous retro's actions, unlike standup); **count cap of 3** (more than three actions is an anti-pattern — converge to the few the team will actually do).

### 3.3 스탠드업 (Standup) — core schema

Per-person three fields: 어제 / 오늘 / 블로커. Extract = **blockers** (for escalation) + today's commitments (to check tomorrow). Everything else is discarded; off-topic goes to a parking lot. **State is not carried over** (the opposite of retro). No dedicated multi-section body beyond the per-person 어제/오늘/블로커 layout and the flat blocker/action lists.

### 3.4 브레인스토밍 (Brainstorming) — REVERSAL, Gate 2 OFF

Native output: **the idea inventory.** Action items are NOT the goal — this is the one type where the extraction gate is inverted.

```
## 아이디어 전량 (무필터)
  {every idea, including duplicates and odd ones — zero loss is the goal}
## 클러스터
  {similar ideas grouped by affinity/theme — the input to a later convergence session}
```

Rules (the inversion):
- **Do NOT apply Gate 2.** The 3-part test, uptake gate, and verb-form filter are for action items; applying them here kills ideas prematurely.
- **Do NOT force action items.** Action items are the output of a separate convergence session, not of brainstorming. Squeezing an idea inventory into an action list is the wrong template.
- Preserve weak-looking ideas too; un-prioritized ideas go to a parking lot, never discarded.
- Instruction shape: "list every idea, group similar ones — do not summarize, merge, or judge" (the opposite of the action-item prompt).

### 3.5 인터뷰·리서치 (Interview / Research) — notes

Extract verbatim quotes (evidence) + behavioral observations + pain-point / feature-request signals. Discard paraphrased summary (it loses the quote's evidentiary value). Discipline: a validated finding needs ≥2 verbatim quotes from different participants per theme. Typography convention: quotes in `"…"`, observations in `[…]`, follow-ups in `{…}`.

### 3.6 1:1 — notes

Owner-private by default — not team-shared. Manager notes are for the note-taker; after-the-fact sharing breaks the 1:1's ownership model. Sensitive content (a personal crisis, sensitive feedback) is not recorded at all (the only don't-write constraint among the six types). Extract = follow-up actions, career/goal topics, the manager's private observations.

### 3.7 General fallback (any other / unroutable type)

When the type is none of the specialized routes, use the catch-all: `## 결정` / `## 액션아이템` / `## 논의` / `## 미해결 질문`. This is the routing architecture's safety net — every meeting gets a valid structured record even without a bespoke schema.

---

## 4. Origin

Schemas grounded in the meeting-notes methodology (`$OMT_DIR/ultraresearch/meeting-notes-actionitems-20260708/METHODOLOGY.md`, §5 + 부록 A): AMI dialogue-act taxonomy, Atlassian DACI/retro templates, Granola PRD template, Purver 2006 AIDA scheme. Referenced by path, not inlined — consult it for the full evidence trail.

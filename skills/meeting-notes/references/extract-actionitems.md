# Action-Item Extraction + Validation

This file is the complete procedure for Stage 3 (Extract) and the detail behind the Stage 4 validation gate. Extraction is a two-gate procedure — not a keyword scan — followed by bounded owner/due recovery and three validation layers. Follow every section in sequence.

**Exception**: for a brainstorming transcript, Gate 2 is OFF (see `references/type-schemas.md` §3.4). Everything below applies to the action-producing types.

---

## 1. Gate 1 — Candidate Detection (recall first)

Scan for the language signals of a commitment. Recall is the priority here — when in doubt, pass the candidate through and let Gate 2 filter it.

**Commitment signals:**
- Modal / future / imperative verbs: `I'll…`, `we need to…`, `can you…`, `let's…`, `I can take…`, "~할게요", "~해야 해요", "다음 단계는…", "누가 ~좀".
- Near the signal, the person / date / deliverable nouns: a name, "금요일", "다음 스프린트", "문서 / PR / 메일".

**Explicit vs implicit commitment:**
- Explicit: *"금요일까지 업데이트 보낼게요"* — self-contained; owner and due are in the utterance.
- Implicit: *"이거 누가 리뷰해야 하는데"* — the owner must be recovered (see §3). A commissive speech act still counts as a candidate.

Pass every candidate to Gate 2. Missing an owner or due at this stage is NOT a reason to drop — recovery happens in §3.

---

## 2. Gate 2 — Validity Filter (keep only the real ones)

Most candidates are false (chatter, brainstorming ideas, already-done work, hedged talk). A candidate must pass **all five** to be a real action item:

1. **3-part test**: an action needs a concrete deliverable (무엇을); a single owner (누가) and a due (언제까지) complete it. *"If all three are absent, it is a note, not a task."* A missing owner or due does NOT fail the test — it is recovered from adjacent turns (§3) or marked `[미배정]`/`[기한 미정]`, never invented to make the item "pass".
2. **Verb-form filter**: an action item starts with a verb (review / approve / draft / send / update). *"Q3 리포트"* is a topic, not an instruction → it must be *"Q3 리포트 초안 작성"* to be an action.
3. **Independent-completion test**: if one person can finish it independently, it is an action item. Otherwise decompose it or promote it to a project.
4. **Uptake / agreement gate** (the academic core): a real action item is **ratified by someone in a following turn**. A proposal with no agreement is still at the planning/brainstorming stage → filter it out. (For a decision meeting, the uptake signal is the Approver's approval — see type-schemas.md §3.1.)
5. **Hedge filter**: a modal hedge ("might / could / 아마 / 나중에") means the speaker is not yet committed → downgrade to a weak commitment (`confidence: low`) or exclude.

**False-positive suppression**: do NOT promote a hypothetical, a brainstorming idea, or an already-confirmed-done item to an action. Exclude small talk, minor clarifications, and routine check-ins; focus on real responsibilities and commitments.

---

## 3. Owner / Due Recovery — context-near-utterance (bounded)

The single most important and least-known principle: **the owner and the due are frequently NOT in the commitment utterance — they are in the immediately preceding or following turn.**

```
Alice: "인증 시스템 개선이 필요해요"       ← task (no owner)
Bob:   "제가 백엔드 쪽 맡을게요"            ← owner (points at the prior utterance)
Alice: "그럼 다음 스프린트까지요"           ← due (following turn)
```
→ extract: `{ task: 인증 시스템 백엔드 개선, owner: Bob, due: 다음 스프린트, agreement: Alice 확인 }`

**The recovery rule, and its hard boundary:**
- Recover a missing owner/due from **adjacent turns + the diarized speaker labels** — do not discard an item just because the trigger utterance lacked an owner.
- **The boundary is the transcript.** Recovery reaches to nearby turns and speaker labels, and no further. It does NOT reach an external system — not a PM-tool assignee, not a Slack correlation, not a calendar invitee list. Owner identity is what the transcript records.
- A generic diarized label ("Developer", "Team lead") IS the owner as-recorded. Do not resolve it to a real name via external correlation; keep the label (and note the ambiguity) or mark `[미배정]`.
- Still nothing after in-transcript recovery? Mark `[미배정]` / `[기한 미정]` and route to human review. Never fabricate.

---

## 4. Full Procedure

```
1. Diarization           — label who spoke; the basis for owner attribution.
2. Chunk (topic/time)    — ~15-minute segments; do not process the whole transcript at once
                           (dilutes precision). Respect speaker-turn boundaries.
3. Gate 1 per segment    — detect signals → flag candidates.
4. Gate 2 per segment    — validity filter → keep / reject.
5. Recover missing fields — owner/due from adjacent turns (§3), before dropping anything.
6. Merge / dedup          — combine the same item appearing across segments (within THIS meeting only).
7. Human review pass      — implicit and hedged commitments are automation-risky; flag them, do not auto-firm.
```

---

## 5. Action-Item Render Contract

Every emitted action item is one line in this exact shape:

```
- [ ] [A{n}] {verb-first concrete task} — 담당: @{single owner | [미배정]} — 기한: {date | [기한 미정]} — 근거: "{verbatim transcript quote}"
```

Append ` — confidence: low → 휴먼리뷰` when the item is hedged, implicit-owner, or otherwise uncertain. This ALWAYS includes a `담당: [미배정]` item and an unresolved generic-label owner — an ownerless or ambiguously-owned action is by definition the "unclear-owner" case that validation layer 3 (§6) routes to human review.

- **`[A{n}]` is a short stable id** (A1, A2, …) so the mapping stage can bind an artifact to this specific item (`연결: A1`) — see gather-crosslink.md §6.
- **`근거` is mandatory.** The quote is verbatim from the transcript. No quote → the item is not emitted (§6, layer 1).
- **`담당` is a single person or `[미배정]`.** Never a fabricated name; never a resolved-from-external identity.
- **`기한` is a stated date or `[기한 미정]`.** Never an inferred-from-urgency date.

---

## 6. Validation — Three Layers (the Stage 4 trust boundary)

Extraction reliability is validated in three layers. This is a hard gate, never softened:

1. **Grounding** — is every action item grounded in a real utterance? If a verbatim quote cannot be attached, it is a hallucination → **drop it.** This forces pointing at a source span, not free generation.
2. **Completeness** — are the three fields (owner / task / due) filled? A blank field is marked `[미배정]` / `[기한 미정]` explicitly — never left silent, never fabricated.
3. **Low-confidence abstention** — a hedged, implicit, or unclear-owner item is marked `confidence: low` and **routed to human review.** Do not best-effort-fill it into a firm action.

**Optional second defense**: a coherence pass re-checking that each emitted bullet has an explicit transcript basis, and that every referenced speaker ID exists in the diarized speaker list.

---

## 7. Origin

Grounded in the meeting-notes methodology (`$OMT_DIR/ultraresearch/meeting-notes-actionitems-20260708/METHODOLOGY.md`, §2 + §3): Granola 3-part test, Purver 2006 AIDA scheme (uptake/agreement role), arXiv:2303.16763 (context-near-utterance recovery), Anthropic reduce-hallucinations grounding. Referenced by path, not inlined.
